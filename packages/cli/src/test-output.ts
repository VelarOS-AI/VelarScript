import { mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { ProjectModule, ProjectResult, VelarSourcePackage } from "./project.ts";

/**
 * D51 rule 105: the verdict line is the last link in the trust chain, so what
 * it says has to be true. Author text — a test name, a module path — reaches it
 * verbatim today, and a `test "\u{202E}…"` reorders a failing line into a
 * passing one on any bidi-aware terminal. The source-level ban (rule 104) does
 * not cover this: an escape sequence puts the very same code point in the
 * string at runtime.
 *
 * The output is a JSON string literal — the escaping the compiler's own
 * duplicate-name diagnostic already applies — plus the twelve `Bidi_Control`
 * code points, which `JSON.stringify` passes through untouched and which are
 * the whole hazard.
 */
const bidirectionalControls = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

export function quoteReportedText(value: string): string {
  return JSON.stringify(value).replaceAll(
    bidirectionalControls,
    (character) => `\\u${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
  );
}

/**
 * Creates the sandbox directory that receives a compiled test or run tree.
 *
 * The sandbox lives inside the project (`<project>/.velar/<prefix>-*`), not in
 * os.tmpdir(): Node resolves bare JavaScript imports by walking node_modules
 * directories upward from the importing file, so a compiled tree inside the
 * project still reaches the project's real npm dependencies (bridged
 * `import js` packages), while an os.tmpdir() sandbox severs that resolution.
 * The directory is removed after the run; `.velar/` should be gitignored.
 */
export async function createCompiledSandbox(projectRoot: string, prefix: "test" | "run"): Promise<string> {
  const velarRoot = join(projectRoot, ".velar");
  await mkdir(velarRoot, { recursive: true });
  const sandbox = await mkdtemp(join(velarRoot, `${prefix}-`));
  // The compiled tree is always ES modules, regardless of the project's own
  // package.json "type" field.
  await writeFile(join(sandbox, "package.json"), JSON.stringify({ name: `velar-${prefix}`, private: true, type: "module" }), "utf8");
  return sandbox;
}

/** Removes a compiled sandbox and prunes `.velar/` when it becomes empty. */
export async function removeCompiledSandbox(sandbox: string): Promise<void> {
  await rm(sandbox, { recursive: true, force: true });
  try {
    await rmdir(dirname(sandbox));
  } catch {
    // Another run is active or `.velar` holds other entries; leave it in place.
  }
}

export async function writeCompiledTestProject(project: ProjectResult, outputRoot: string): Promise<void> {
  for (const package_ of project.velarPackages) await writePackageManifest(package_, outputRoot);
  for (const module of project.modules) {
    const output = compiledTestModulePath(project, module, outputRoot);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${module.result.code ?? ""}//# sourceMappingURL=${output.split("/").at(-1)}.map\n`, "utf8");
    await writeFile(`${output}.map`, module.result.sourceMap ?? "", "utf8");
  }
}

export function compiledTestModulePath(project: ProjectResult, module: ProjectModule, outputRoot: string): string {
  const package_ = packageForModule(project, module.inputPath);
  if (!package_) return join(outputRoot, module.relativePath.replace(/\.vel$/u, ".js"));
  return join(outputRoot, "node_modules", ...package_.name.split("/"), compiledRelativePath(package_.root, module.inputPath));
}

function packageForModule(project: ProjectResult, inputPath: string): VelarSourcePackage | null {
  for (const package_ of project.velarPackages) {
    const path = relative(package_.root, inputPath);
    if (path === "" || (!path.startsWith("..") && !path.startsWith("/"))) return package_;
  }
  return null;
}

async function writePackageManifest(package_: VelarSourcePackage, outputRoot: string): Promise<void> {
  const root = join(outputRoot, "node_modules", ...package_.name.split("/"));
  const entry = `./${compiledRelativePath(package_.root, package_.entryPath).replaceAll("\\", "/")}`;
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: package_.name,
    private: true,
    type: "module",
    main: entry,
    exports: entry,
  }), "utf8");
}

function compiledRelativePath(root: string, inputPath: string): string {
  return relative(root, inputPath).replace(/\.vel$/u, ".js");
}
