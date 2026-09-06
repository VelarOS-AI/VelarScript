import { dirname, join, resolve } from "node:path";
import type { CompilerExtension } from "@velarscript/compiler";
import { readBoundedText } from "./bounded-text.ts";
import { isHostErrorCode } from "./host-error.ts";
import {
  loadVelarLibraryArtifactSet,
  type LoadedVelarLibraryArtifact,
} from "./library-artifact.ts";
import { assertVelarPackageEntrySubpath, type VelarPackageSubpath } from "./package-entry.ts";
import { npmPackageNameFromSpecifier } from "./package-name.ts";
import { findPackageSelfReferenceRoot } from "./package-scope.ts";
import {
  assertVelarPackageCompatibility,
  assertVelarPackageTargetCapabilities,
  canonicalVelarPackageEntryPaths,
  parseVelarSourcePackageManifest,
  type ParsedVelarSourcePackageManifest,
  type VelarPackageEntry,
  type VelarPackageLanguageRange,
  type VelarPackageResource,
  type VelarPackageTarget,
} from "./source-package-manifest.ts";

export interface VelarSourcePackage {
  readonly name: string;
  readonly version: string;
  readonly root: string;
  readonly entryPath: string;
  /** Every declared source entry, including the root under `.`. */
  readonly entries: ReadonlyMap<VelarPackageSubpath, VelarPackageEntry>;
  readonly resources: readonly VelarPackageResource[];
  readonly targets: readonly VelarPackageTarget[];
  readonly requiredCapabilities: readonly string[];
  /**
   * D90 R13: the language generation range the package declares it needs, or
   * null when it declares none. Optional is the ruling's own boundary — a
   * package that says nothing is checked exactly as it was before.
   */
  readonly requiredLanguage: VelarPackageLanguageRange | null;
  /** Frozen ABI-1 entries selected by imports in this project, keyed by public subpath. */
  readonly artifacts: ReadonlyMap<VelarPackageSubpath, LoadedVelarLibraryArtifact>;
}

/** A package manifest is one identity; each import selects one exact public entry. */
export interface ResolvedVelarSourcePackage {
  readonly package_: VelarSourcePackage;
  readonly subpath: VelarPackageSubpath;
  readonly entry: VelarPackageEntry;
  readonly artifact: LoadedVelarLibraryArtifact | null;
}

interface CachedVelarSourcePackageManifest {
  readonly key: string;
  readonly manifest: ParsedVelarSourcePackageManifest;
  readonly package_: VelarSourcePackage;
}

export interface VelarPackageResolutionCache {
  readonly manifests: Map<string, Promise<CachedVelarSourcePackageManifest>>;
  readonly artifacts: Map<string, Promise<ReadonlyMap<VelarPackageSubpath, LoadedVelarLibraryArtifact>>>;
  readonly selfRoots: Map<string, Promise<string | null>>;
  readonly overrides: ReadonlyMap<string, string>;
  readonly compilerExtensions: readonly CompilerExtension[];
  readonly extensionConfig: unknown;
}

export function registerVelarPackage(
  packages: Map<string, VelarSourcePackage>,
  candidate: VelarSourcePackage,
): VelarSourcePackage {
  const existing = packages.get(candidate.name);
  if (existing && existing.root !== candidate.root) {
    throw new Error(`VelarScript package '${candidate.name}' resolves to multiple installed versions; use one package instance per application build`);
  }
  if (!existing) {
    packages.set(candidate.name, candidate);
    return candidate;
  }
  const artifacts = new Map(existing.artifacts);
  for (const [subpath, artifact] of candidate.artifacts) artifacts.set(subpath, artifact);
  const merged = artifacts.size === existing.artifacts.size ? existing : { ...existing, artifacts };
  packages.set(candidate.name, merged);
  return merged;
}

export function createVelarPackageResolutionCache(
  overrides: ReadonlyMap<string, string> = new Map(),
  compilerExtensions: readonly CompilerExtension[] = [],
  extensionConfig: unknown = new Map<string, unknown>(),
): VelarPackageResolutionCache {
  return {
    manifests: new Map(),
    artifacts: new Map(),
    selfRoots: new Map(),
    overrides,
    compilerExtensions,
    extensionConfig,
  };
}

export async function resolveVelarSourcePackage(
  source: string,
  importerPath: string,
  target: VelarPackageTarget | undefined,
  capabilities: ReadonlySet<string> | undefined,
  cache: VelarPackageResolutionCache,
): Promise<ResolvedVelarSourcePackage> {
  const name = packageNameOf(source);
  const subpath = packageSubpath(source, name);
  const selfRoot = await packageSelfReferenceRoot(name, importerPath, cache);
  if (selfRoot !== null) {
    // A package checks its current sources, never an artifact left by an older
    // build. The regular manifest parser still owns the exact entry, target,
    // capability, language, and package-root boundaries.
    const resolved = await velarPackageAtRoot(name, selfRoot, subpath, undefined, undefined, cache);
    if (target !== undefined) assertVelarPackageCompatibility(resolved.package_, target, capabilities ?? new Set());
    return resolved;
  }
  let directory = dirname(importerPath);
  while (true) {
    const root = join(directory, "node_modules", ...name.split("/"));
    try {
      return await velarPackageAtRoot(name, root, subpath, target, capabilities, cache);
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      if (!isHostErrorCode(error, "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`package '${name}' is not installed`);
    directory = parent;
  }
}

export async function velarPackageAtRoot(
  name: string,
  root: string,
  subpath: VelarPackageSubpath = ".",
  target?: VelarPackageTarget,
  capabilities?: ReadonlySet<string>,
  cache?: VelarPackageResolutionCache,
): Promise<ResolvedVelarSourcePackage> {
  const resolvedCache = cache ?? createVelarPackageResolutionCache();
  const resolvedManifest = await velarPackageManifestAtRoot(name, root, resolvedCache);
  const { manifest, package_ } = resolvedManifest;
  const entry = manifest.entries.get(subpath);
  if (!entry) {
    throw new Error(`Package '${name}' does not declare VelarScript entry '${subpath}' in package.json#velar.entries`);
  }
  if (target === undefined) return { package_, subpath, entry, artifact: null };
  const directArtifactTarget = target === "core" || target === "node" ? target : null;
  const artifactTarget = directArtifactTarget !== null && manifest.artifactDescriptors.has(directArtifactTarget)
    ? directArtifactTarget
    : target !== "core" && manifest.artifactDescriptors.has("core") ? "core" : null;
  if (artifactTarget === null) {
    assertVelarPackageCompatibility(package_, target, capabilities ?? new Set());
    return { package_, subpath, entry, artifact: null };
  }
  assertVelarPackageTargetCapabilities(package_, target, capabilities ?? new Set());
  const artifactKey = `${resolvedManifest.key}\0${artifactTarget}`;
  let pendingArtifacts = resolvedCache.artifacts.get(artifactKey);
  if (!pendingArtifacts) {
    pendingArtifacts = loadVelarLibraryArtifactSet({
      packageRoot: root,
      packageName: name,
      packageVersion: manifest.version,
      packageEntries: manifest.entries,
      descriptor: manifest.artifactDescriptors.get(artifactTarget)!,
      target: artifactTarget,
      packageExports: manifest.exports,
      runtimeDependencies: manifest.runtimeDependencies,
      compilerExtensions: resolvedCache.compilerExtensions,
      extensionConfig: resolvedCache.extensionConfig,
    });
    resolvedCache.artifacts.set(artifactKey, pendingArtifacts);
  }
  const artifact = (await pendingArtifacts).get(subpath);
  if (!artifact) throw new Error(`Velar library artifact does not publish entry '${subpath}'`);
  return {
    package_: { ...package_, artifacts: new Map([[subpath, artifact]]) },
    subpath,
    entry,
    artifact,
  };
}

export async function packageSelfReferenceRoot(
  name: string,
  importerPath: string,
  cache: VelarPackageResolutionCache,
): Promise<string | null> {
  const key = `${name}\0${dirname(importerPath)}`;
  let pending = cache.selfRoots.get(key);
  if (pending) return pending;
  pending = findPackageSelfReferenceRoot(name, importerPath);
  cache.selfRoots.set(key, pending);
  return pending;
}

async function velarPackageManifestAtRoot(
  name: string,
  root: string,
  cache: VelarPackageResolutionCache,
): Promise<CachedVelarSourcePackageManifest> {
  const key = `${resolve(root)}\0${name}`;
  let pending = cache.manifests.get(key);
  if (!pending) {
    pending = (async () => {
      const path = join(root, "package.json");
      const overridden = cache.overrides.get(path);
      if (overridden !== undefined && Buffer.byteLength(overridden, "utf8") > 1024 * 1024) {
        throw new RangeError(`Package manifest for '${name}' exceeds ${1024 * 1024} bytes`);
      }
      const value = JSON.parse(overridden ?? await readBoundedText(
        path, 1024 * 1024, `Package manifest for '${name}'`,
      ));
      const manifest = parseVelarSourcePackageManifest(name, root, value);
      await canonicalVelarPackageEntryPaths(name, root, manifest.entries);
      return {
        key,
        manifest,
        package_: {
          name,
          version: manifest.version,
          root,
          entryPath: manifest.entries.get(".")!.inputPath,
          entries: manifest.entries,
          resources: manifest.resources,
          targets: manifest.targets,
          requiredCapabilities: manifest.requiredCapabilities,
          requiredLanguage: manifest.requiredLanguage,
          artifacts: new Map(),
        },
      };
    })();
    cache.manifests.set(key, pending);
  }
  return pending;
}

function packageSubpath(source: string, name: string): VelarPackageSubpath {
  if (source === name) return ".";
  const subpath = `.${source.slice(name.length)}`;
  assertVelarPackageEntrySubpath(subpath, `Package import '${source}'`);
  return subpath;
}

export function packageNameOf(source: string): string {
  return npmPackageNameFromSpecifier(source, `Package import '${source}'`);
}
