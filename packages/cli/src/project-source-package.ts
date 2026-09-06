import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { VelarProjectConfig } from "./config.ts";
import { readBoundedText } from "./bounded-text.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import { NPM_PACKAGE_NAME } from "./package-name.ts";
import { projectPackageTarget } from "./project-package-target.ts";
import type { ProjectOwnedResourcePackage, ProjectResult, VelarSourcePackage } from "./project.ts";
import { packageExportTargets, packageRuntimeExportEnvironments } from "./package-exports.ts";
import {
  assertVelarPackageCompatibility,
  canonicalVelarPackageEntryPaths,
  parseVelarSourcePackageManifest,
  type ParsedVelarSourcePackageManifest,
  type VelarPackageTarget,
} from "./source-package-manifest.ts";

const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;

interface ProjectSourcePackage {
  /** The common source root whose relative paths become ordinary build outputs. */
  readonly sourceRoot: string;
  /** Public source entries in declaration order, with exact aliases deduplicated. */
  readonly entryPaths: readonly string[];
  /** Sanitized producer fields required to reproduce this entry roster. */
  readonly contract: ProjectSourcePackageContract;
  /** Producer declarations used to authorize package-root relative resources. */
  readonly ownedResourcePackage: ProjectOwnedResourcePackage;
  /** Exact bounded package.json text used to select this entry roster. */
  readonly manifestSource: string;
}

export interface ProjectSourcePackageContract {
  /** Validated package identity retained so source-package self imports keep resolving in a reproduction. */
  readonly name: string;
  readonly entry: string;
  readonly entries: Readonly<Record<string, string>>;
  readonly targets: readonly VelarPackageTarget[];
  readonly requires: {
    readonly capabilities: readonly string[];
    readonly language?: string;
  };
  /** Checked JSON resources used by the reproduced graph, not the producer's whole resource roster. */
  readonly resources?: Readonly<Record<string, { readonly path: string; readonly type: "json" }>>;
  /** Minimal npm export routes required for the retained package resources. */
  readonly exports?: Readonly<Record<string, string>>;
}

export interface ProjectCompilationRoots {
  readonly entries: readonly string[];
  /** Stable root used to derive emitted module paths. */
  readonly sourceRoot: string;
  /** Physical boundary for relative VelarScript imports. */
  readonly sourceBoundary: string;
  /** Physical boundary for relative resources, independent of emitted source layout. */
  readonly resourceBoundary: string;
  readonly ownedResourcePackage: ProjectOwnedResourcePackage | null;
  readonly sourcePackage: ProjectSourcePackageContract | null;
  readonly sourcePackageManifest: { readonly path: string; readonly source: string } | null;
}

/** The one entry roster shared by whole-project check/build and the project fixer. */
export async function resolveProjectCompilationRoots(
  config: VelarProjectConfig,
  input: string | null,
  includePackageEntries = true,
  packageManifestSource?: string,
): Promise<ProjectCompilationRoots> {
  if (isExplicitProjectSourceInput(config)) {
    // A manifest-backed file is a narrow execution entry, not a standalone
    // project. Its graph may use any source owned by the project whose manifest
    // selected its extensions and target, and emitted module paths therefore
    // retain their project-relative layout. Treating the entry's own directory
    // as both roots made ordinary tools/check.vel files unable to import ../src
    // even though whole-project check compiled the same graph. A bare file has
    // no wider ownership declaration, so its directory remains both roots.
    const explicitBoundary = config.manifestPath === null ? dirname(config.entryPath) : config.root;
    return {
      entries: Object.freeze([config.entryPath]),
      sourceRoot: explicitBoundary,
      sourceBoundary: explicitBoundary,
      resourceBoundary: explicitBoundary,
      ownedResourcePackage: null,
      sourcePackage: null,
      sourcePackageManifest: null,
    };
  }
  const sourcePackage = includePackageEntries
    ? await resolveProjectSourcePackage(config, input, packageManifestSource)
    : null;
  return {
    entries: Object.freeze([
      ...(sourcePackage?.entryPaths ?? [config.entryPath]),
      ...config.workerEntries.values(),
    ]),
    sourceRoot: sourcePackage?.sourceRoot ?? dirname(config.entryPath),
    sourceBoundary: sourcePackage?.sourceRoot ?? dirname(config.entryPath),
    resourceBoundary: sourcePackage ? config.root : dirname(config.entryPath),
    ownedResourcePackage: sourcePackage?.ownedResourcePackage ?? null,
    sourcePackage: sourcePackage?.contract ?? null,
    sourcePackageManifest: sourcePackage
      ? Object.freeze({ path: join(config.root, "package.json"), source: sourcePackage.manifestSource })
      : null,
  };
}

/** A `.vel` file selected by the resolver, distinguished from a directory whose name ends in `.vel`. */
export function isExplicitProjectSourceInput(config: VelarProjectConfig): boolean {
  return config.explicitSourcePath !== null;
}

/**
 * Retains a producer's identity for a narrow explicit-source check without
 * widening that check to every entry declared by the package. A self import has
 * already made the compiler parse and validate this package manifest; the
 * checked graph is therefore the authority for the minimal entry roster a
 * reproduction needs, and no second manifest read is necessary here.
 */
export function checkedGraphSourcePackageContract(
  config: VelarProjectConfig,
  projects: readonly ProjectResult[],
  declaredContract: ProjectSourcePackageContract | null,
): ProjectSourcePackageContract | null {
  const sourcePackage = projects
    .flatMap((project) => project.velarPackages)
    .find((candidate) => resolve(candidate.root) === resolve(config.root));
  if (!declaredContract && !sourcePackage) return null;
  const contract = declaredContract ?? checkedEntryContract(config, projects, sourcePackage!);
  const resources = new Map<string, { readonly path: string; readonly type: "json" }>();
  for (const project of projects) {
    for (const resource of project.resources) {
      if (resource.packageName !== contract.name || resource.packageRoot === null
        || resolve(resource.packageRoot) !== resolve(config.root) || resource.packageSubpath === null
        || resource.packageRelativePath === null) continue;
      resources.set(resource.packageSubpath, { path: resource.packageRelativePath, type: "json" });
    }
  }
  if (resources.size === 0) return contract;
  const exports = declaredContract
    ? sourceEntryExports(config, contract)
    : new Map<string, string>();
  for (const [subpath, resource] of resources) exports.set(subpath, `./${resource.path}`);
  return {
    ...contract,
    resources: Object.freeze(Object.fromEntries(resources)),
    exports: Object.freeze(Object.fromEntries(exports)),
  };
}

function sourceEntryExports(
  config: VelarProjectConfig,
  contract: ProjectSourcePackageContract,
): Map<string, string> {
  const exports = new Map<string, string>();
  const sourceRoot = dirname(resolve(config.root, ...contract.entry.split("/")));
  for (const [subpath, entry] of [[".", contract.entry], ...Object.entries(contract.entries)] as const) {
    const inputPath = resolve(config.root, ...entry.split("/"));
    const outputPath = join(config.outDir, relative(sourceRoot, inputPath).replace(/\.vel$/u, ".js"));
    exports.set(subpath, `./${relative(config.root, outputPath).replaceAll("\\", "/")}`);
  }
  return exports;
}

function checkedEntryContract(
  config: VelarProjectConfig,
  projects: readonly ProjectResult[],
  sourcePackage: VelarSourcePackage,
): ProjectSourcePackageContract {
  const checkedModules = new Set(projects.flatMap((project) => project.modules.map((module) => resolve(module.inputPath))));
  const declaredRoot = sourcePackage.entries.get(".")!;
  const rootEntry = checkedModules.has(resolve(declaredRoot.inputPath))
    ? declaredRoot.relativePath
    : relative(config.root, config.entryPath).replaceAll("\\", "/");
  const entries = [...sourcePackage.entries]
    .filter(([subpath, entry]) => subpath !== "." && checkedModules.has(resolve(entry.inputPath)));
  return sourcePackageContract(sourcePackage, rootEntry, entries);
}

/**
 * Resolves the source-package contract owned by this library project.
 *
 * A plain library with no package entry declarations keeps the velar.json
 * entry contract it had before. Once package.json declares either
 * `velar.entry` or `velar.entries`, however, it is a source-package producer:
 * the same parser and physical-path checks that protect consumers also protect
 * its whole-project check/build before any output can be written.
 */
async function resolveProjectSourcePackage(
  config: VelarProjectConfig,
  input: string | null,
  packageManifestSource?: string,
): Promise<ProjectSourcePackage | null> {
  if (config.kind !== "library" || isExplicitProjectSourceInput(config)) return null;
  const manifestPath = join(config.root, "package.json");
  let source: string;
  try {
    source = packageManifestSource
      ?? await readBoundedText(manifestPath, MAX_PACKAGE_MANIFEST_BYTES, manifestPath);
    if (Buffer.byteLength(source, "utf8") > MAX_PACKAGE_MANIFEST_BYTES) {
      throw new RangeError(`${manifestPath} exceeds ${MAX_PACKAGE_MANIFEST_BYTES} bytes`);
    }
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`${manifestPath}: ${hostErrorMessage(error)}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${manifestPath} must contain a JSON object`);
  }
  const packageManifest = value as { readonly name?: unknown; readonly velar?: unknown };
  const velar = packageManifest.velar;
  if (velar === null || typeof velar !== "object" || Array.isArray(velar)) return null;
  const declarations = velar as Record<string, unknown>;
  if (!Object.hasOwn(declarations, "entry") && !Object.hasOwn(declarations, "entries")) return null;
  if (typeof packageManifest.name !== "string" || !NPM_PACKAGE_NAME.test(packageManifest.name)) {
    throw new Error(`${manifestPath}: a VelarScript source package requires a valid package name`);
  }

  let manifest: ParsedVelarSourcePackageManifest;
  try {
    manifest = parseVelarSourcePackageManifest(packageManifest.name, config.root, value);
    await canonicalVelarPackageEntryPaths(packageManifest.name, config.root, manifest.entries);
    const capabilities = new Set(config.compilerExtensions.flatMap((extension) => extension.capabilities ?? []));
    assertVelarPackageCompatibility(manifest, projectPackageTarget(config), capabilities);
  } catch (error) {
    throw new Error(`${manifestPath}: ${hostErrorMessage(error)}`);
  }

  const rootEntry = manifest.entries.get(".")!;
  if (resolve(rootEntry.inputPath) !== resolve(config.entryPath)) {
    throw new Error(`${manifestPath}#velar.entry must resolve to the same source as velar.json 'entry'`);
  }
  const sourceRoot = dirname(rootEntry.inputPath);
  for (const [subpath, entry] of manifest.entries) {
    const fromSourceRoot = relative(sourceRoot, entry.inputPath);
    if (fromSourceRoot === ".." || fromSourceRoot.startsWith(`..${sep}`) || isAbsolute(fromSourceRoot)) {
      const label = subpath === "." ? "velar.entry" : `velar.entries[${JSON.stringify(subpath)}]`;
      throw new Error(`${manifestPath}#${label} must stay inside the root entry source directory ${sourceRoot}`);
    }
  }
  try {
    assertSourcePackageExports(manifest, config, sourceRoot);
  } catch (error) {
    throw new Error(`${manifestPath}: ${hostErrorMessage(error)}`);
  }
  const entryPaths = [...new Set([...manifest.entries.values()].map((entry) => resolve(entry.inputPath)))];
  return {
    sourceRoot,
    entryPaths: Object.freeze(entryPaths),
    contract: sourcePackageContract(manifest, rootEntry.relativePath, [...manifest.entries].filter(([subpath]) => subpath !== ".")),
    ownedResourcePackage: Object.freeze({
      name: manifest.name,
      root: config.root,
      resources: Object.freeze([...manifest.resources]),
    }),
    manifestSource: source,
  };
}

function sourcePackageContract(
  sourcePackage: Pick<VelarSourcePackage, "name" | "targets" | "requiredCapabilities" | "requiredLanguage">,
  entry: string,
  entries: readonly (readonly [string, { readonly relativePath: string }])[],
): ProjectSourcePackageContract {
  return {
    name: sourcePackage.name,
    entry,
    entries: Object.freeze(Object.fromEntries(entries.map(([subpath, declaration]) => [subpath, declaration.relativePath]))),
    targets: sourcePackage.targets,
    requires: {
      capabilities: sourcePackage.requiredCapabilities,
      ...(sourcePackage.requiredLanguage ? { language: sourcePackage.requiredLanguage.text } : {}),
    },
  };
}

/** Existing JavaScript exports must route to the files this ordinary build actually emits. */
function assertSourcePackageExports(
  manifest: ParsedVelarSourcePackageManifest,
  config: VelarProjectConfig,
  sourceRoot: string,
): void {
  if (manifest.exports === undefined) return;
  const target = projectPackageTarget(config);
  const environments = packageRuntimeExportEnvironments(target);
  for (const [subpath, entry] of manifest.entries) {
    const output = join(config.outDir, relative(sourceRoot, entry.inputPath).replace(/\.vel$/u, ".js"));
    const expected = `./${relative(config.root, output).replaceAll("\\", "/")}`;
    const selected = packageExportTargets(manifest.exports, subpath, environments);
    if (selected.length === 0) {
      throw new Error(`package.json#exports must expose '${subpath}' as '${expected}' for ${target} source builds`);
    }
    const mismatch = selected.find((candidate) => candidate !== expected);
    if (mismatch) {
      throw new Error(`package.json#exports '${subpath}' selects '${mismatch}', but ${target} source builds emit '${expected}'`);
    }
  }
}
