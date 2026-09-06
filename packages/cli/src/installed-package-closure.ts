import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import {
  readOrdinaryFileSnapshot,
  type OrdinaryFileSnapshotOperations,
} from "./ordinary-file-snapshot.ts";

interface InstalledPackageManifest {
  readonly name: string;
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
}

export interface InstalledPackageIdentity {
  readonly name: string;
  readonly version: string;
  readonly root: string;
  readonly manifestPath: string;
  readonly manifest: InstalledPackageManifest;
}

export interface InstalledPackageClosureSeed {
  readonly manifestPath: string;
  readonly label: string;
}

export interface InstalledPackageTree {
  readonly path: string;
  readonly label: string;
}

const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
export const MAX_INSTALLED_PACKAGE_DEPENDENCIES = 256;
export const MAX_INSTALLED_PACKAGE_CLOSURE = 1024;

export type InstalledPackageManifestReadOperations = OrdinaryFileSnapshotOperations;

/** Finds the package that owns a loaded source or distribution module. */
export async function enclosingInstalledPackage(
  modulePath: string,
  expectedName?: string,
): Promise<InstalledPackageIdentity> {
  let directory = dirname(resolve(modulePath));
  const filesystemRoot = parse(directory).root;
  while (true) {
    const manifestPath = join(directory, "package.json");
    const package_ = await readInstalledPackageManifest(manifestPath, true);
    if (package_ !== null && (expectedName === undefined || package_.name === expectedName)) {
      return installedPackageIdentity(package_, directory, manifestPath);
    }
    if (directory === filesystemRoot) break;
    directory = dirname(directory);
  }
  throw new Error(`Cannot locate${expectedName ? ` ${expectedName}` : " an installed package"} above '${modulePath}'`);
}

/**
 * Resolves one dependency from the package that declares it. The owner-relative
 * resolver is essential under isolated package-manager layouts: a CLI package
 * must not rely on a dependency of its sibling being hoisted beside itself.
 */
export async function resolveInstalledPackageDependency(
  owner: InstalledPackageIdentity,
  dependencyName: string,
  optional = false,
): Promise<InstalledPackageIdentity | null> {
  assertPackageName(dependencyName);
  // Node resolves ordinary package symlinks through their physical package
  // root. Match that behavior here: npm workspaces and pnpm's isolated store
  // both place the owner's resolvable dependencies beside that physical root.
  const require = createRequire(await realpath(owner.manifestPath));
  const searchPaths = require.resolve.paths(dependencyName) ?? [];
  for (const searchPath of searchPaths) {
    const manifestPath = join(searchPath, ...dependencyName.split("/"), "package.json");
    const package_ = await readInstalledPackageManifest(manifestPath, true);
    if (package_ !== null) {
      if (package_.name !== dependencyName) {
        throw new Error(
          `Installed dependency path '${manifestPath}' contains '${package_.name}' instead of '${dependencyName}'`,
        );
      }
      // Copy and hash the physical package rather than a package-manager
      // symlink. pnpm exposes dependencies through symlinked owner-local
      // node_modules entries; preserving such a link in a deployable output
      // would point back into the build machine's store.
      const canonicalManifestPath = await realpath(manifestPath);
      return installedPackageIdentity(package_, dirname(canonicalManifestPath), canonicalManifestPath);
    }
  }
  if (optional) return null;
  throw new Error(`Installed package '${owner.name}' cannot resolve its declared dependency '${dependencyName}'`);
}

/**
 * Returns every installed package tree reachable through runtime dependencies
 * from the loaded seed packages. Optional dependencies participate when they
 * are installed; dev and peer packages do not become build inputs merely by
 * being named in a manifest.
 */
export async function installedPackageTreeClosure(
  seeds: readonly InstalledPackageClosureSeed[],
): Promise<readonly InstalledPackageTree[]> {
  if (seeds.length > MAX_INSTALLED_PACKAGE_CLOSURE) {
    throw new RangeError(`Toolchain package closure cannot start from more than ${MAX_INSTALLED_PACKAGE_CLOSURE} packages`);
  }
  const queue: Array<{ readonly package_: InstalledPackageIdentity; readonly label: string }> = [];
  const queued = new Set<string>();
  const enqueue = async (package_: InstalledPackageIdentity, label: string): Promise<void> => {
    const identity = await realpath(package_.manifestPath);
    if (queued.has(identity)) return;
    if (queued.size >= MAX_INSTALLED_PACKAGE_CLOSURE) {
      throw new RangeError(`Toolchain package closure cannot exceed ${MAX_INSTALLED_PACKAGE_CLOSURE} installed packages`);
    }
    queued.add(identity);
    queue.push({ package_, label });
  };
  for (const seed of seeds) {
    const package_ = await installedPackageAtManifest(seed.manifestPath);
    await enqueue(package_, seed.label);
  }

  const trees: InstalledPackageTree[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    trees.push({ path: current.package_.root, label: current.label });

    const optionalNames = new Set(Object.keys(current.package_.manifest.optionalDependencies));
    const dependencyNames = new Set([
      ...Object.keys(current.package_.manifest.dependencies),
      ...optionalNames,
    ]);
    for (const name of [...dependencyNames].sort(byCodePoint)) {
      const dependency = await resolveInstalledPackageDependency(current.package_, name, optionalNames.has(name));
      if (dependency !== null) await enqueue(dependency, `toolchain dependency '${name}'`);
    }
  }
  return trees.sort((left, right) => byCodePoint(left.path, right.path));
}

/** Resolves a deployment dependency through its framework package owner. */
export async function resolveOwnedRuntimeDependency(
  ownerName: string,
  dependencyName: string,
): Promise<InstalledPackageIdentity> {
  const cli = await enclosingInstalledPackage(fileURLToPath(import.meta.url), "@velarscript/cli");
  const ownerRange = declaredRange(cli.manifest, ownerName, true);
  const owner = await resolveInstalledPackageDependency(cli, ownerName);
  if (owner === null) throw new Error(`Installed toolchain package '${ownerName}' is unavailable`);
  if (owner.version !== ownerRange) {
    throw new Error(`Installed toolchain package '${owner.root}' does not match ${ownerName}@${ownerRange}`);
  }

  const dependencyVersion = declaredRange(owner.manifest, dependencyName, false);
  const dependency = await resolveInstalledPackageDependency(owner, dependencyName);
  if (dependency === null) throw new Error(`Installed runtime dependency '${dependencyName}' is unavailable`);
  if (dependency.version !== dependencyVersion) {
    throw new Error(
      `Installed runtime dependency '${dependency.root}' does not match ${dependencyName}@${dependencyVersion} declared by ${ownerName}`,
    );
  }
  return dependency;
}

async function installedPackageAtManifest(manifestPath: string): Promise<InstalledPackageIdentity> {
  const normalized = resolve(manifestPath);
  const package_ = await readInstalledPackageManifest(normalized, false);
  if (package_ === null) throw new Error(`Installed package manifest '${normalized}' is missing`);
  return installedPackageIdentity(package_, dirname(normalized), normalized);
}

function installedPackageIdentity(
  manifest: InstalledPackageManifest,
  root: string,
  manifestPath: string,
): InstalledPackageIdentity {
  return { name: manifest.name, version: manifest.version, root, manifestPath, manifest };
}

async function readInstalledPackageManifest(
  manifestPath: string,
  missingIsNull: boolean,
): Promise<InstalledPackageManifest | null> {
  let source: string;
  try {
    source = await readInstalledPackageManifestSource(manifestPath);
  } catch (error) {
    if (missingIsNull && (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR"))) return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Cannot read installed package manifest '${manifestPath}': ${hostErrorMessage(error)}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Installed package manifest '${manifestPath}' must contain an object`);
  }
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string" || !manifest.name || !manifest.version) {
    throw new Error(`Installed package manifest '${manifestPath}' has invalid identity`);
  }
  const dependencies = dependencyMap(manifest.dependencies, manifestPath, "dependencies");
  const optionalDependencies = dependencyMap(manifest.optionalDependencies, manifestPath, "optionalDependencies");
  if (new Set([...Object.keys(dependencies), ...Object.keys(optionalDependencies)]).size
    > MAX_INSTALLED_PACKAGE_DEPENDENCIES) {
    throw new RangeError(
      `Installed package manifest '${manifestPath}' cannot declare more than ${MAX_INSTALLED_PACKAGE_DEPENDENCIES} runtime dependencies`,
    );
  }
  return {
    name: manifest.name,
    version: manifest.version,
    dependencies,
    optionalDependencies,
    peerDependencies: dependencyMap(manifest.peerDependencies, manifestPath, "peerDependencies"),
  };
}

/** Reads one bounded installed manifest from a single ordinary-file identity. */
export async function readInstalledPackageManifestSource(
  manifestPath: string,
  operations: InstalledPackageManifestReadOperations = {},
): Promise<string> {
  try {
    const { bytes } = await readOrdinaryFileSnapshot(
      manifestPath,
      MAX_PACKAGE_MANIFEST_BYTES,
      `Installed package manifest '${manifestPath}'`,
      operations,
    );
    return bytes.toString("utf8");
  } catch (error) {
    if (error instanceof RangeError) throw new RangeError(`Installed package manifest '${manifestPath}' exceeds 1 MiB`);
    throw error;
  }
}

function dependencyMap(value: unknown, manifestPath: string, field: string): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Installed package manifest '${manifestPath}' has invalid ${field}`);
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_INSTALLED_PACKAGE_DEPENDENCIES) {
    throw new RangeError(
      `Installed package manifest '${manifestPath}' cannot declare more than ${MAX_INSTALLED_PACKAGE_DEPENDENCIES} ${field}`,
    );
  }
  const output: Record<string, string> = {};
  for (const [name, range] of entries) {
    assertPackageName(name);
    if (typeof range !== "string" || !range) {
      throw new Error(`Installed package manifest '${manifestPath}' has invalid ${field}.${name}`);
    }
    output[name] = range;
  }
  return Object.freeze(output);
}

function declaredRange(manifest: InstalledPackageManifest, name: string, allowPeer: boolean): string {
  const range = manifest.dependencies[name] ?? manifest.optionalDependencies[name]
    ?? (allowPeer ? manifest.peerDependencies[name] : undefined);
  if (range === undefined) throw new Error(`Package '${manifest.name}' does not declare runtime dependency '${name}'`);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(range)) {
    throw new Error(`Package '${manifest.name}' must pin deployable runtime dependency '${name}' to one exact version`);
  }
  return range;
}

function assertPackageName(name: string): void {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(name)) {
    throw new Error(`Invalid installed package name '${name}'`);
  }
}

function byCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
