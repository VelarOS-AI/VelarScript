import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import {
  createJavaScriptModuleGraphBudget,
  inspectJavaScriptModuleWithinBudget,
} from "./javascript-module-budget.ts";
import {
  ChangedOrdinaryFileError,
  NonOrdinaryFileError,
  readOrdinaryFileSnapshot,
} from "./ordinary-file-snapshot.ts";

export const MAX_PROJECT_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
export const MAX_PACKAGE_IMPORT_VALUE_DEPTH = 64;
export const MAX_PACKAGE_IMPORT_VALUE_NODES = 16_384;
export const MAX_PACKAGE_IMPORT_TARGETS = 8_192;
export const MAX_PACKAGE_IMPORT_COPY_FILES = 4_096;
export const MAX_PACKAGE_IMPORT_COPY_DEPTH = 64;
export const MAX_PACKAGE_IMPORT_COPY_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_PACKAGE_IMPORT_COPY_TOTAL_BYTES = 64 * 1024 * 1024;

interface PendingImportTarget {
  readonly source: string;
  readonly depth: number;
}

/** Reads the project's optional imports map from one bounded ordinary-file identity. */
export async function readProjectPackageImports(projectRoot: string): Promise<Record<string, unknown> | null> {
  const manifestPath = join(projectRoot, "package.json");
  let bytes: Buffer;
  try {
    ({ bytes } = await readOrdinaryFileSnapshot(
      manifestPath,
      MAX_PROJECT_PACKAGE_MANIFEST_BYTES,
      `Project package manifest '${manifestPath}'`,
    ));
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
    if (error instanceof RangeError) {
      throw new RangeError(`Project package manifest '${manifestPath}' exceeds 1 MiB`);
    }
    if (error instanceof NonOrdinaryFileError) {
      throw new Error(`Project package manifest '${manifestPath}' must be an ordinary file`);
    }
    throw error;
  }
  let manifest: { readonly imports?: unknown };
  try {
    manifest = JSON.parse(bytes.toString("utf8")) as { readonly imports?: unknown };
  } catch {
    return null;
  }
  return manifest?.imports !== null && typeof manifest?.imports === "object" && !Array.isArray(manifest.imports)
    ? manifest.imports as Record<string, unknown>
    : null;
}

/** Every string leaf of an imports target, traversed without recursive host-stack growth. */
export function packageImportTargets(value: unknown): readonly string[] {
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }];
  const targets: string[] = [];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_PACKAGE_IMPORT_VALUE_NODES) {
      throw new RangeError(`package.json#imports targets exceed ${MAX_PACKAGE_IMPORT_VALUE_NODES} nested values`);
    }
    if (current.depth > MAX_PACKAGE_IMPORT_VALUE_DEPTH) {
      throw new RangeError(`package.json#imports targets exceed ${MAX_PACKAGE_IMPORT_VALUE_DEPTH} levels`);
    }
    if (typeof current.value === "string") {
      targets.push(current.value);
      if (targets.length > MAX_PACKAGE_IMPORT_TARGETS) {
        throw new RangeError(`package.json#imports cannot name more than ${MAX_PACKAGE_IMPORT_TARGETS} targets`);
      }
      continue;
    }
    const children = Array.isArray(current.value)
      ? current.value
      : current.value !== null && typeof current.value === "object"
        ? Object.values(current.value)
        : [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ value: children[index], depth: current.depth + 1 });
    }
  }
  return Object.freeze(targets);
}

/** Copies bounded, project-contained relative imports targets into one compiled sandbox. */
export async function copyPackageImportTargets(
  projectRoot: string,
  sandbox: string,
  imports: Record<string, unknown>,
): Promise<void> {
  const lexicalRoot = resolve(projectRoot);
  const canonicalRoot = await realpath(lexicalRoot);
  const canonicalVelarRoot = await realpath(join(lexicalRoot, ".velar"));
  const pending: PendingImportTarget[] = [];
  const scheduled = new Set<string>();
  const schedule = (source: string, depth: number): void => {
    const absolute = resolve(source);
    if (scheduled.has(absolute)) return;
    if (depth > MAX_PACKAGE_IMPORT_COPY_DEPTH) {
      throw new RangeError(`package.json#imports file graph exceeds ${MAX_PACKAGE_IMPORT_COPY_DEPTH} levels`);
    }
    if (scheduled.size >= MAX_PACKAGE_IMPORT_COPY_FILES) {
      throw new RangeError(`package.json#imports file graph exceeds ${MAX_PACKAGE_IMPORT_COPY_FILES} files`);
    }
    scheduled.add(absolute);
    pending.push({ source: absolute, depth });
  };
  for (const target of packageImportTargets(imports)) {
    if (target.startsWith("./") || target.startsWith("../")) schedule(resolve(lexicalRoot, target), 0);
  }

  let copiedFiles = 0;
  let copiedBytes = 0;
  const moduleBudget = createJavaScriptModuleGraphBudget();
  while (pending.length > 0) {
    const current = pending.pop()!;
    const inside = relative(lexicalRoot, current.source);
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) continue;
    const contents = await readAuthorizedImportTarget(
      current.source,
      canonicalRoot,
      canonicalVelarRoot,
    );
    if (contents === null) continue;
    copiedFiles += 1;
    copiedBytes += contents.byteLength;
    if (copiedFiles > MAX_PACKAGE_IMPORT_COPY_FILES) {
      throw new RangeError(`package.json#imports file graph exceeds ${MAX_PACKAGE_IMPORT_COPY_FILES} files`);
    }
    if (copiedBytes > MAX_PACKAGE_IMPORT_COPY_TOTAL_BYTES) {
      throw new RangeError(`package.json#imports file graph exceeds ${MAX_PACKAGE_IMPORT_COPY_TOTAL_BYTES} bytes`);
    }
    const output = join(sandbox, inside);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, contents);
    if (!/\.[cm]?js$/u.test(current.source)) continue;
    const source = strictJavaScriptSource(contents, current.source);
    let inspection;
    try {
      inspection = inspectJavaScriptModuleWithinBudget(source, moduleBudget);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new RangeError("package.json#imports file graph exceeds the JavaScript parse complexity limit");
      }
      throw new Error(`package.json#imports target '${current.source}' is not a valid ECMAScript module: ${hostErrorMessage(error)}`);
    }
    for (const edge of inspection.edges) {
      if (edge.source?.startsWith("./") || edge.source?.startsWith("../")) {
        schedule(relativeModuleTarget(current.source, edge.source), current.depth + 1);
      }
    }
  }
}

function strictJavaScriptSource(contents: Buffer, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    throw new Error(`package.json#imports target '${path}' is not valid UTF-8`);
  }
}

function relativeModuleTarget(importer: string, specifier: string): string {
  try {
    const target = new URL(specifier, pathToFileURL(importer));
    target.search = "";
    target.hash = "";
    return fileURLToPath(target);
  } catch (error) {
    throw new Error(`package.json#imports target '${importer}' has invalid relative import '${specifier}': ${hostErrorMessage(error)}`);
  }
}

async function readAuthorizedImportTarget(
  source: string,
  canonicalRoot: string,
  canonicalVelarRoot: string,
): Promise<Buffer | null> {
  let canonicalBefore: string;
  try {
    canonicalBefore = await realpath(source);
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
    throw error;
  }
  if (!insideDirectory(canonicalBefore, canonicalRoot) || insideDirectory(canonicalBefore, canonicalVelarRoot)) {
    return null;
  }
  try {
    const { bytes } = await readOrdinaryFileSnapshot(
      source,
      MAX_PACKAGE_IMPORT_COPY_FILE_BYTES,
      `package.json#imports target '${source}'`,
      {
        followSymbolicLink: true,
        validateOpenedSnapshot: async () => {
          const canonicalAfter = await realpath(source);
          if (canonicalAfter !== canonicalBefore
            || !insideDirectory(canonicalAfter, canonicalRoot)
            || insideDirectory(canonicalAfter, canonicalVelarRoot)) {
            throw new ChangedOrdinaryFileError(`package.json#imports target '${source}' changed while it was read`);
          }
        },
      },
    );
    return bytes;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")
      || error instanceof NonOrdinaryFileError) return null;
    if (error instanceof RangeError) {
      throw new RangeError(
        `package.json#imports target '${source}' exceeds ${MAX_PACKAGE_IMPORT_COPY_FILE_BYTES} bytes`,
      );
    }
    throw new Error(`Cannot copy package.json#imports target '${source}': ${hostErrorMessage(error)}`);
  }
}

function insideDirectory(path: string, root: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}
