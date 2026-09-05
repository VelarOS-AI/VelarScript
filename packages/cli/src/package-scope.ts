import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { readBoundedText } from "./bounded-text.ts";
import { canonicalizePotentialPath } from "./canonical-path.ts";
import { isHostErrorCode } from "./host-error.ts";

const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const MAX_PACKAGE_SCOPE_DEPTH = 128;

/** Finds the nearest authoring package only when it owns the requested self name. */
export async function findPackageSelfReferenceRoot(name: string, importerPath: string): Promise<string | null> {
  let directory = dirname(importerPath);
  while (true) {
    try {
      const manifest = JSON.parse(await readBoundedText(
        join(directory, "package.json"),
        MAX_PACKAGE_MANIFEST_BYTES,
        `Package manifest for '${name}'`,
      )) as { readonly name?: unknown };
      return manifest.name === name ? directory : null;
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      if (!isHostErrorCode(error, "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/** Authorizes the physical target before a build recursively replaces it. */
export async function assertBuildOutputBoundary(
  projectRoot: string,
  outputRoot: string,
  declared: boolean,
): Promise<void> {
  const [projectIdentity, outputIdentity] = await Promise.all([
    canonicalizePotentialPath(projectRoot),
    canonicalizePotentialPath(outputRoot),
  ]);
  if (isContained(outputIdentity, projectIdentity)) {
    throw new Error(`refusing to replace '${outputRoot}': a build output cannot contain the project root`);
  }
  if (declared && !isContained(projectIdentity, outputIdentity)) {
    throw new Error(`refusing to replace '${outputRoot}': the declared outDir escapes the project through a symbolic link`);
  }
}

/** Finds the Node package scope for an existing ordinary artifact file. */
export async function nearestPackageTypeForFile(packageRoot: string, filePath: string, label: string): Promise<string | null> {
  const [rootIdentity, metadata] = await Promise.all([realpath(packageRoot), lstat(filePath)]);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be an ordinary file`);
  const identity = await realpath(filePath);
  assertContained(rootIdentity, identity, label);
  return packageTypeFromDirectory(rootIdentity, dirname(identity), label);
}

/** Finds the nearest scope that remains after an output directory is replaced. */
export async function nearestPackageTypeOutsideOutput(packageRoot: string, outputRoot: string, label: string): Promise<string | null> {
  const [rootIdentity, outputIdentity] = await Promise.all([
    realpath(packageRoot),
    canonicalizePotentialPath(outputRoot),
  ]);
  assertContained(rootIdentity, outputIdentity, label);
  if (outputIdentity === rootIdentity) throw new Error(`${label} must be a directory inside its package root`);
  return packageTypeFromDirectory(rootIdentity, dirname(outputIdentity), label);
}

async function packageTypeFromDirectory(root: string, start: string, label: string): Promise<string | null> {
  let directory = start;
  for (let depth = 0; depth < MAX_PACKAGE_SCOPE_DEPTH; depth += 1) {
    const manifestPath = join(directory, "package.json");
    try {
      const manifest = JSON.parse(await readPackageManifest(root, manifestPath, label)) as unknown;
      if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new Error(`${label} package scope '${manifestPath}' must contain a JSON object`);
      }
      const type = (manifest as Record<string, unknown>).type;
      return typeof type === "string" ? type : null;
    } catch (error) {
      if (!isHostErrorCode(error, "ENOENT") && !isHostErrorCode(error, "ENOTDIR")) throw error;
    }
    if (directory === root) return null;
    const parent = dirname(directory);
    assertContained(root, parent, `${label} package scope`);
    directory = parent;
  }
  throw new Error(`${label} package scope exceeds ${MAX_PACKAGE_SCOPE_DEPTH} directories`);
}

async function readPackageManifest(root: string, path: string, label: string): Promise<string> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} package scope must be an ordinary package.json file`);
  const identity = await realpath(path);
  assertContained(root, identity, `${label} package scope`);
  return readBoundedText(identity, MAX_PACKAGE_MANIFEST_BYTES, `${label} package scope`);
}

function assertContained(root: string, path: string, label: string): void {
  if (!isContained(root, path)) {
    throw new Error(`${label} escapes its package directory`);
  }
}

function isContained(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith("../") && !fromRoot.startsWith("..\\") && !isAbsolute(fromRoot));
}
