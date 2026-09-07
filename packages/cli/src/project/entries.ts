import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { lstat } from "node:fs/promises";
import { canonicalizePotentialPath } from "../canonical-path.ts";
import { isHostErrorCode } from "../host-error.ts";
import {
  ChangedOrdinaryFileError,
  NonOrdinaryFileError,
  readOrdinaryFileSnapshot,
  type OrdinaryFileSnapshotOperations,
} from "../ordinary-file-snapshot.ts";
import { assertVelarPackageSubpath } from "../package-entry.ts";
import {
  packageNameOf,
  packageSelfReferenceRoot,
  velarPackageAtRoot,
  type VelarPackageResolutionCache,
  type VelarSourcePackage,
} from "../project-package-resolution.ts";
import type { VelarPackageResource } from "../source-package-manifest.ts";
import type { CompileProjectOptions, ProjectOwnedResourcePackage } from "../project.ts";

export const MAX_JSON_RESOURCE_BYTES = 4 * 1024 * 1024;

export async function resolveJsonResource(
  source: string,
  importerPath: string,
  ownerPackage: VelarSourcePackage | null,
  resourceBoundary: string,
  ownedResourcePackage: ProjectOwnedResourcePackage | null,
  cache: VelarPackageResolutionCache,
): Promise<{
  readonly resource: VelarPackageResource;
  readonly package_: VelarSourcePackage | null;
  readonly owner: ProjectOwnedResourcePackage | VelarSourcePackage | null;
  readonly boundary: string;
}> {
  if (source.startsWith(".")) {
    const inputPath = resolve(dirname(importerPath), source);
    const owner = ownerPackage ?? ownedResourcePackage;
    const boundary = owner?.root ?? resourceBoundary;
    const relativePath = normalizeModulePath(relative(boundary, inputPath));
    const declared = owner?.resources.find((resource) => resource.relativePath === relativePath) ?? null;
    if (owner && !declared) {
      throw new Error(`VelarScript package '${owner.name}' must declare '${relativePath}' in package.json#velar.resources`);
    }
    return {
      resource: declared ?? { subpath: null, relativePath, inputPath, kind: "json" },
      package_: null,
      owner,
      boundary,
    };
  }
  if (isAbsolute(source)) throw new Error("JSON resource paths must be relative or an exact package resource subpath");
  const name = packageNameOf(source);
  if (source === name) throw new Error("A JSON resource import must name a declared package subpath");
  const subpath = `.${source.slice(name.length)}`;
  assertVelarPackageSubpath(subpath, `JSON resource import '${source}'`);
  const package_ = await resolveResourcePackage(name, source, importerPath, cache);
  const resource = package_.resources.find((candidate) => candidate.subpath === subpath);
  if (!resource) throw new Error(`Package '${name}' does not declare JSON resource '${subpath}' in package.json#velar.resources`);
  return { resource, package_, owner: package_, boundary: package_.root };
}

async function resolveResourcePackage(
  name: string,
  source: string,
  importerPath: string,
  cache: VelarPackageResolutionCache,
): Promise<VelarSourcePackage> {
  const selfRoot = await packageSelfReferenceRoot(name, importerPath, cache);
  if (selfRoot !== null) return (await velarPackageAtRoot(name, selfRoot, ".", undefined, undefined, cache)).package_;
  let directory = dirname(importerPath);
  while (true) {
    const root = join(directory, "node_modules", ...name.split("/"));
    try {
      return (await velarPackageAtRoot(name, root, ".", undefined, undefined, cache)).package_;
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      if (!isHostErrorCode(error, "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`package '${name}' is not installed for resource import '${source}'`);
    directory = parent;
  }
}

async function authorizeJsonResourcePath(inputPath: string, boundary: string, source: string): Promise<void> {
  if (extname(inputPath).toLowerCase() !== ".json") throw new Error(`JSON resource '${source}' must point to a .json file`);
  if (escapesRoot(relative(boundary, inputPath))) throw new Error(`JSON resource '${source}' cannot escape '${boundary}'`);
  const [canonicalRoot, canonicalInput, metadata] = await Promise.all([
    canonicalizePotentialPath(boundary),
    canonicalizePotentialPath(inputPath),
    lstat(inputPath),
  ]);
  if (escapesRoot(relative(canonicalRoot, canonicalInput))) throw new Error(`JSON resource '${source}' cannot escape '${boundary}' through a symbolic link`);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`JSON resource '${source}' must be an ordinary file, not a symbolic link`);
}

export interface ProjectJsonResourceReadOperations {
  readonly afterPathInspection?: OrdinaryFileSnapshotOperations["afterPathInspection"];
}

/** Authorizes and reads one JSON resource while its descriptor remains bound to the checked path. */
export async function readProjectJsonResource(
  inputPath: string,
  boundary: string,
  source: string,
  override?: string,
  operations: ProjectJsonResourceReadOperations = {},
): Promise<string> {
  if (override !== undefined) {
    await authorizeJsonResourcePath(inputPath, boundary, source);
    return validateJsonResourceText(override, source);
  }
  if (extname(inputPath).toLowerCase() !== ".json") throw new Error(`JSON resource '${source}' must point to a .json file`);
  if (escapesRoot(relative(boundary, inputPath))) throw new Error(`JSON resource '${source}' cannot escape '${boundary}'`);
  const [canonicalRoot, initialCanonicalInput] = await Promise.all([
    canonicalizePotentialPath(boundary),
    canonicalizePotentialPath(inputPath),
  ]);
  if (escapesRoot(relative(canonicalRoot, initialCanonicalInput))) {
    throw new Error(`JSON resource '${source}' cannot escape '${boundary}' through a symbolic link`);
  }
  let bytes: Buffer;
  try {
    ({ bytes } = await readOrdinaryFileSnapshot(
      inputPath,
      MAX_JSON_RESOURCE_BYTES,
      `JSON resource '${source}'`,
      {
        ...(operations.afterPathInspection ? { afterPathInspection: operations.afterPathInspection } : {}),
        validateOpenedSnapshot: async () => {
          const canonicalInput = await canonicalizePotentialPath(inputPath);
          if (escapesRoot(relative(canonicalRoot, canonicalInput))) {
            throw new Error(`JSON resource '${source}' cannot escape '${boundary}' through a symbolic link`);
          }
          if (canonicalInput !== initialCanonicalInput) {
            throw new ChangedOrdinaryFileError(`JSON resource '${source}' changed its canonical identity while it was read`);
          }
        },
      },
    ));
  } catch (error) {
    if (error instanceof RangeError) {
      throw new RangeError(`json resource '${source}' exceeds ${MAX_JSON_RESOURCE_BYTES} bytes`);
    }
    if (error instanceof NonOrdinaryFileError) {
      throw new Error(`JSON resource '${source}' must be an ordinary file, not a symbolic link`);
    }
    throw error;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("JSON resource is not valid UTF-8");
  }
}

function validateJsonResourceText(content: string, source: string): string {
  if (Buffer.byteLength(content, "utf8") > MAX_JSON_RESOURCE_BYTES) {
    throw new RangeError(`json resource '${source}' exceeds ${MAX_JSON_RESOURCE_BYTES} bytes`);
  }
  return content;
}

/** Auxiliary graphs are wider, but they cannot lend those boundaries to configured source modules. */
export function projectModuleBoundaries(
  package_: VelarSourcePackage | null,
  inputPath: string,
  sourceBoundary: string,
  resourceBoundary: string,
  options: CompileProjectOptions,
): { readonly boundary: string; readonly moduleResourceBoundary: string } {
  if (package_ !== null) return { boundary: package_.root, moduleResourceBoundary: resourceBoundary };
  if (!escapesRoot(relative(sourceBoundary, inputPath))) return { boundary: sourceBoundary, moduleResourceBoundary: resourceBoundary };
  return {
    boundary: resolve(options.auxiliarySourceBoundary ?? sourceBoundary),
    moduleResourceBoundary: resolve(options.auxiliaryResourceBoundary ?? resourceBoundary),
  };
}

export function escapesRoot(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith("../") || relativePath.startsWith("..\\") || isAbsolute(relativePath);
}

export function normalizeModulePath(path: string): string {
  return path.replaceAll("\\", "/");
}
