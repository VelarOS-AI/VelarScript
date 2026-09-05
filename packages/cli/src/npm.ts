import { mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type Metafile } from "esbuild";
import { projectImportKey, type ProjectResult } from "./project.ts";
import { readBoundedText } from "./bounded-text.ts";
import { frameworkBase } from "./framework-host.ts";
import { hostErrorMessage } from "./host-error.ts";
import { resolveInstalledPackageRoot } from "./installed-package.ts";
import {
  devDependencyFingerprint,
  invalidateDevDependencyFingerprint,
  MAX_DEV_DEPENDENCY_INPUTS,
  normalizedPrebundlePath,
  rememberDevDependencyFingerprint,
  reusableDevDependencyFingerprint,
  validDevDependencyFingerprint,
  type DevDependencyFingerprint,
} from "./npm-prebundle-cache.ts";
import { NPM_PACKAGE_NAME, npmPackageNameFromSpecifier } from "./package-name.ts";
import {
  resolvePackageImportsSpecifier,
  type JavaScriptPackageManifest,
} from "./package-imports.ts";
import type { VelarPackageSubpath } from "./package-entry.ts";
import { VELAR_VERSION } from "./version.ts";
import type { VelarLibraryArtifactJavaScriptSnapshot } from "./library-artifact.ts";
import {
  FROZEN_ARTIFACT_NAMESPACE_PREFIX,
  frozenArtifactInputPath,
  frozenArtifactPrebundle,
  matchingFrozenArtifact,
  projectFrozenArtifacts,
  type FrozenArtifactSnapshotSet,
} from "./npm-frozen-artifact.ts";
import {
  BROWSER_ESM_PACKAGE_CONDITIONS,
  externalPackageExportTargets,
} from "./package-exports.ts";

const MAX_BROWSER_NPM_PACKAGES = 4096;
// npm's own package-name grammar, the same one the extension loader applies to
// an extension's identity. A dependency's self-declared `name` reaches a cache
// directory that is later removed recursively, a dev-server route, and an
// import-map key, so it is untrusted input until it parses as a package name.
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const MAX_DEV_DEPENDENCY_META_BYTES = 1024 * 1024;

// The dev server serves package code to the browser as native ES modules, so
// bare specifiers resolve with the same conditions the production bundler uses
// for a browser import: "browser", "import", and the community "module"
// condition, in the package's own declaration order.
const BROWSER_IMPORT_CONDITIONS = BROWSER_ESM_PACKAGE_CONDITIONS;
const NODE_REQUIRE_CONDITIONS: ReadonlySet<string> = new Set(["require", "node", "default"]);

export interface BrowserNpmPackage {
  readonly name: string;
  /** The installed package root; the dev server watches it for edits. */
  readonly root: string;
  readonly route: string;
  /** The prebundle cache directory whose files are served under the route. */
  readonly serveRoot: string;
}

export interface BrowserNpmResolution {
  readonly packages: readonly BrowserNpmPackage[];
  readonly imports: Readonly<Record<string, string>>;
  readonly failures: readonly string[];
}

type PackageManifest = JavaScriptPackageManifest;

// One prebundled package version in <project>/.velar/dev-deps. The metadata
// file makes a cache hit self-describing: entry outputs for the import map,
// every emitted file for completeness checks, and the external bare imports
// that still need import-map entries of their own.
interface DevDependencyMeta {
  readonly formatVersion: 3;
  readonly velar: string;
  readonly name: string;
  readonly version: string;
  readonly entries: Readonly<Record<string, string>>;
  readonly files: readonly string[];
  readonly externals: readonly string[];
  readonly fingerprint: DevDependencyFingerprint;
}


interface PackageState {
  readonly name: string;
  readonly version: string;
  readonly root: string;
  readonly manifest: PackageManifest;
  readonly route: string;
  readonly cacheDir: string;
  readonly entries: Map<string, string>;
  artifactReceiptPath: string | null;
  artifactSnapshots: ReadonlyMap<string, VelarLibraryArtifactJavaScriptSnapshot>;
  meta: DevDependencyMeta | null;
  bundled: boolean;
  failure: string | null;
}

interface InstalledBrowserImport {
  readonly requestedName: string;
  readonly subpath: string;
  readonly root: string;
  readonly manifest: PackageManifest;
  readonly entry: string;
}

export interface BrowserNpmEntryResolution {
  readonly entry: string;
  readonly packageRoot: string;
}

/** Resolve one bare package import exactly as a browser ESM import. */
export async function resolveBrowserNpmEntry(specifier: string, baseDirectory: string): Promise<string> {
  return (await resolveBrowserNpmEntryWithRoot(specifier, baseDirectory)).entry;
}

/** Resolve an entry and retain the package root a development watcher owns. */
export async function resolveBrowserNpmEntryWithRoot(
  specifier: string,
  baseDirectory: string,
): Promise<BrowserNpmEntryResolution> {
  const resolved = await resolveInstalledBrowserImport(specifier, requireAt(baseDirectory), baseDirectory);
  return { entry: resolved.entry, packageRoot: resolved.root };
}

function attachFrozenArtifact(state: PackageState, artifact: FrozenArtifactSnapshotSet): void {
  if (state.artifactReceiptPath && state.artifactReceiptPath !== artifact.receiptPath) {
    throw new Error(`Browser package '${state.name}' resolves entries from more than one frozen artifact receipt`);
  }
  state.artifactReceiptPath = artifact.receiptPath;
  state.artifactSnapshots = artifact.snapshots;
}

function packageStateForBrowserImport(
  states: Map<string, PackageState>,
  resolvedImport: InstalledBrowserImport,
  cacheRoot: string,
  artifact: FrozenArtifactSnapshotSet | null,
): PackageState {
  const { requestedName, root, manifest } = resolvedImport;
  const name = browserPackageIdentity(manifest, requestedName);
  const existing = states.get(name);
  if (existing) {
    if (artifact) attachFrozenArtifact(existing, artifact);
    return existing;
  }
  const version = typeof manifest.version === "string" && manifest.version !== "" ? manifest.version : "0.0.0";
  const state: PackageState = {
    name,
    version,
    root,
    manifest,
    route: `/@npm/${name}/`,
    cacheDir: prebundleCacheDirectory(cacheRoot, name, version),
    entries: new Map(),
    artifactReceiptPath: artifact?.receiptPath ?? null,
    artifactSnapshots: artifact?.snapshots ?? new Map(),
    meta: null,
    bundled: false,
    failure: null,
  };
  states.set(name, state);
  return state;
}

// Native browser ESM cannot load CommonJS, and many npm packages either
// publish only CommonJS internals behind a thin ESM wrapper (the dual-package
// pattern Node's own documentation recommends) or depend on packages that do.
// The dev server therefore prebundles every bare npm import per package with
// the same bundler the production build uses: internal CommonJS converts to
// ESM, other bare packages stay external and resolve through the import map,
// and the result is cached in <project>/.velar/dev-deps keyed by package
// version so an unchanged dependency bundles once per install.
export async function resolveBrowserNpm(
  project: ProjectResult,
  invalidateRoots: ReadonlySet<string> = new Set(),
  includedModulePaths: ReadonlySet<string> | null = null,
): Promise<BrowserNpmResolution> {
  const base = frameworkBase(project.framework);
  const frozenArtifacts = projectFrozenArtifacts(project);
  // Every specifier carries the directories it may be resolved from, in the
  // order they were learned. `velar build` resolves each import from its own
  // importer (production-build.ts passes `dirname(sourceModule.inputPath)`) and
  // `velar test` hands the whole question to Node, so both find a linked
  // package's dependency where that dependency actually lives. This server used
  // to resolve everything from one require anchored at the consumer's source
  // root, so a `file:`-linked package's own dependency -- and then its whole
  // transitive closure -- had to be flattened onto the consumer's node_modules
  // chain before the page would load. A browser has one import map and
  // therefore one URL per specifier, so the resolution is still one per
  // specifier; what changed is that the anchors that can answer it are tried.
  const anchors = new Map<string, string[]>();
  const anchor = (specifier: string, directory: string): void => {
    const known = anchors.get(specifier);
    if (!known) anchors.set(specifier, [directory]);
    else if (!known.includes(directory)) known.push(directory);
  };
  const includedModules = includedModulePaths === null
    ? project.modules
    : project.modules.filter((module) => includedModulePaths.has(resolve(module.inputPath)));
  for (const module of includedModules) {
    for (const dependency of module.result.dependencies) {
      if (dependency.source.startsWith(".") || dependency.source.startsWith("/")) continue;
      const frozen = project.velarArtifactImports.has(projectImportKey(module.inputPath, dependency.source));
      if (dependency.javascript || frozen) anchor(dependency.source, dirname(module.inputPath));
    }
  }
  const cacheRoot = resolve(project.projectRoot, ".velar", "dev-deps");
  const states = new Map<string, PackageState>();
  const targets = new Map<string, { readonly state: PackageState; readonly subpath: string }>();
  const imports: Record<string, string> = {};
  const failures: string[] = [];

  if (anchors.size > MAX_BROWSER_NPM_PACKAGES) {
    throw new RangeError(`A browser project cannot import more than ${MAX_BROWSER_NPM_PACKAGES} JavaScript packages`);
  }

  const processed = new Set<string>();
  let queue = [...anchors.keys()];
  while (queue.length > 0) {
    const wave = queue;
    queue = [];
    for (const specifier of wave) {
      if (processed.has(specifier)) continue;
      processed.add(specifier);
      if (processed.size > MAX_BROWSER_NPM_PACKAGES) {
        throw new RangeError(`A browser project cannot import more than ${MAX_BROWSER_NPM_PACKAGES} JavaScript packages`);
      }
      if (specifier.startsWith("node:")) {
        failures.push(`Node builtin '${specifier}' cannot run in a browser build`);
        continue;
      }
      try {
        const resolvedImport = await resolveFromAnchors(specifier, anchors.get(specifier) ?? [project.sourceRoot]);
        const { subpath, entry } = resolvedImport;
        const frozenArtifact = matchingFrozenArtifact(frozenArtifacts, specifier, entry);
        const state = packageStateForBrowserImport(states, resolvedImport, cacheRoot, frozenArtifact);
        // Two specifiers can name one file — a `#` alias whose target is a
        // package's own entry, `.` and `./index` in one exports map — and the
        // prebundle reports an output per entry *file*, so registering the file
        // twice loses one of them. The second specifier takes the subpath the
        // first was given instead, and both import-map keys land on that one
        // output.
        const shared = [...state.entries].find(([, existing]) => existing === entry)?.[0];
        const routedSubpath = shared ?? subpath;
        if (!state.entries.has(routedSubpath)) {
          const entryFromRoot = relative(state.root, entry);
          if (!entryFromRoot || entryFromRoot.startsWith("..") || isAbsolute(entryFromRoot)) {
            throw new Error(`the resolved entry '${entryFromRoot}' escapes the package directory`);
          }
          state.entries.set(routedSubpath, entry);
          state.bundled = false;
        }
        targets.set(specifier, { state, subpath: routedSubpath });
      } catch (error) {
        failures.push(`Cannot resolve browser npm import '${specifier}': ${hostErrorMessage(error)}`);
      }
    }
    for (const state of states.values()) {
      if (state.failure !== null || state.bundled) continue;
      try {
        state.meta = await ensurePackageBundle(state, invalidateRoots.has(state.root));
        state.bundled = true;
        for (const external of state.meta.externals) {
          // A dependency left external by this package's prebundle is resolved
          // from *this* package, which is where it is installed when the
          // package is linked from outside the consumer's tree.
          anchor(external, state.root);
          if (!processed.has(external)) queue.push(external);
        }
      } catch (error) {
        state.failure = hostErrorMessage(error);
      }
    }
  }

  const packages: BrowserNpmPackage[] = [];
  for (const state of states.values()) {
    if (state.failure !== null || !state.meta) continue;
    packages.push({ name: state.name, root: state.root, route: state.route, serveRoot: state.cacheDir });
  }
  for (const [specifier, target] of targets) {
    if (target.state.failure !== null) {
      failures.push(`Cannot resolve browser npm import '${specifier}': ${target.state.failure}`);
      continue;
    }
    const output = target.state.meta?.entries[target.subpath];
    if (typeof output !== "string") {
      failures.push(`Cannot resolve browser npm import '${specifier}': the development prebundle did not emit an entry for '${target.subpath}'`);
      continue;
    }
    imports[specifier] = withBase(base, `${target.state.route}${output}`);
  }
  if (includedModulePaths === null) {
    for (const package_ of project.velarPackages) {
      // Artifact packages were prebundled above; source fallback points at compiled modules.
      if (package_.artifacts.size > 0) continue;
      for (const [subpath, declared] of package_.entries) {
        const entry = project.modules.find((module) => module.inputPath === declared.inputPath);
        if (entry) imports[velarPackageSpecifier(package_.name, subpath)] = sourcePackageRoute(base, entry.relativePath);
      }
    }
  } else {
    for (const module of includedModules) {
      for (const dependency of module.result.dependencies) {
        const target = project.velarImports.get(projectImportKey(module.inputPath, dependency.source));
        if (!target) continue;
        const entry = project.modules.find((candidate) => candidate.inputPath === target);
        if (entry) imports[dependency.source] = sourcePackageRoute(base, entry.relativePath);
      }
    }
  }
  return { packages, imports, failures };
}

function sourcePackageRoute(base: string, relativePath: string): string {
  return withBase(base, `/${relativePath.replace(/\.vel$/u, ".js").replaceAll("\\", "/")}`);
}

function velarPackageSpecifier(name: string, subpath: "." | `./${string}`): string {
  return subpath === "." ? name : `${name}/${subpath.slice(2)}`;
}

export async function npmAsset(packages: readonly BrowserNpmPackage[], pathname: string): Promise<{ readonly path: string; readonly sizeBytes: number; readonly contentType: string } | null> {
  const package_ = packages.find((item) => pathname.startsWith(item.route));
  if (!package_) return null;
  const relativePath = pathname.slice(package_.route.length);
  if (!relativePath || relativePath.split("/").includes("..")) return null;
  const path = resolve(package_.serveRoot, relativePath);
  const unresolvedFromRoot = relative(package_.serveRoot, path);
  if (!unresolvedFromRoot || unresolvedFromRoot === ".." || unresolvedFromRoot.startsWith(`..${sep}`) || isAbsolute(unresolvedFromRoot)) return null;
  try {
    const [rootPath, assetPath] = await Promise.all([realpath(package_.serveRoot), realpath(path)]);
    const assetFromRoot = relative(rootPath, assetPath);
    if (!assetFromRoot || assetFromRoot.startsWith("..") || assetFromRoot.startsWith("/") || assetFromRoot.startsWith("\\")) return null;
    const metadata = await stat(assetPath);
    if (!metadata.isFile()) return null;
    return { path: assetPath, sizeBytes: metadata.size, contentType: npmContentType(assetPath) };
  } catch {
    return null;
  }
}

/**
 * The identity a resolved package is cached, routed, and imported under. The
 * manifest's own `name` is whatever the dependency wrote about itself — a
 * backslash in it is a path separator `join` honours on Windows — so it is
 * taken only when it parses as an npm package name and names the package that
 * was actually resolved. Every other reader of an installed manifest in this
 * CLI makes the same comparison (extension-metadata.ts:173, project.ts:1679,
 * typescript-declarations.ts:89); this one was missed.
 */
export function browserPackageIdentity(manifest: PackageManifest, requestedName: string): string {
  const declared = manifest.name;
  if (typeof declared === "string" && declared === requestedName && NPM_PACKAGE_NAME.test(declared)) return declared;
  return requestedName;
}

/**
 * Where one package version is prebundled. `ensurePackageBundle` removes this
 * path recursively before writing, and the version half of the name is as
 * unvalidated as the name half was — a dependency declaring
 * `"version": "../../build"` walks out of the cache just as a hostile name
 * would. The same containment the resolved entry gets is applied here, so the
 * directory a build deletes is always inside the cache this project owns.
 */
export function prebundleCacheDirectory(cacheRoot: string, name: string, version: string): string {
  const cacheDir = join(cacheRoot, `${name.replaceAll("/", "+")}@${version}`);
  const fromRoot = relative(cacheRoot, cacheDir);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`the prebundle directory for '${name}@${version}' escapes ${cacheRoot}`);
  }
  return cacheDir;
}

/** Resolve every answering anchor and refuse a browser-global ambiguity. */
async function resolveFromAnchors(specifier: string, directories: readonly string[]): Promise<InstalledBrowserImport> {
  const resolved: InstalledBrowserImport[] = [];
  const unresolved: { readonly anchor: string; readonly message: string }[] = [];
  for (const directory of directories) {
    try {
      resolved.push(await resolveInstalledBrowserImport(specifier, requireAt(directory), directory));
    } catch (error) {
      unresolved.push({ anchor: resolve(directory), message: hostErrorMessage(error) });
    }
  }
  if (unresolved.length > 0) {
    const anchors = unresolved
      .sort((left, right) => left.anchor < right.anchor ? -1 : left.anchor > right.anchor ? 1 : 0)
      .map((item) => `${JSON.stringify(item.anchor)}: ${item.message}`);
    throw new Error(`actual importer ${anchors.length === 1 ? "anchor cannot" : "anchors cannot all"} resolve it: ${anchors.join("; ")}; a browser import map cannot supply a dependency that an actual importer cannot resolve`);
  }
  if (resolved.length === 0) throw new Error("no importer to resolve it from");
  const targets = new Map(resolved.map((item) => [`${item.root}\0${item.entry}`, item]));
  if (targets.size > 1) {
    const descriptions = [...targets.values()]
      .sort((left, right) => left.root < right.root ? -1 : left.root > right.root ? 1 : left.entry < right.entry ? -1 : 1)
      .map((item) => {
        const version = typeof item.manifest.version === "string" && item.manifest.version !== ""
          ? item.manifest.version
          : "0.0.0";
        return `${JSON.stringify(item.root)} (version ${JSON.stringify(version)}, entry ${JSON.stringify(`./${relative(item.root, item.entry).replaceAll("\\", "/")}`)})`;
      });
    throw new Error(`importer anchors resolve it to multiple canonical package targets: ${descriptions.join("; ")}; a browser import map can expose only one target for a bare specifier`);
  }
  return resolved[0]!;
}

function requireAt(directory: string): NodeJS.Require {
  return createRequire(pathToFileURL(join(directory, "__velar_browser_import__.js")));
}

async function resolveInstalledBrowserImport(specifier: string, require: NodeJS.Require, baseDirectory: string): Promise<InstalledBrowserImport> {
  if (specifier.startsWith("#")) return await resolvePackageImportsAlias(specifier, baseDirectory);
  const requestedName = npmPackageNameFromSpecifier(specifier, `Browser npm import '${specifier}'`);
  const subpath = (specifier === requestedName ? "." : `.${specifier.slice(requestedName.length)}`) as VelarPackageSubpath;
  if (subpath.split("/").includes("..")) throw new Error(`the subpath '${subpath}' escapes the package directory`);
  const root = await resolveInstalledPackageRoot(requestedName, specifier, require);
  const manifest = JSON.parse(await readBoundedText(
    join(root, "package.json"),
    MAX_PACKAGE_MANIFEST_BYTES,
    `Package manifest for '${specifier}'`,
  )) as PackageManifest;
  const entry = await realpath(await selectBrowserEntry(specifier, root, manifest, subpath));
  return { requestedName, subpath, root, manifest, entry };
}

/**
 * A `#` specifier is not a package. `docs/javascript-bridge.md` lists it as the
 * fourth legal `import js` shape -- "a `#`-mapped import from the importing
 * package's own `imports` map resolves too" -- and says the host owns resolving
 * it. Check, development, and production all select it through the shared
 * target-aware resolver; a literal `#` can therefore remain only as the
 * import-map key, never in the URL where a browser would read it as a fragment.
 *
 * Relative targets are routed through the package that declares the map. An
 * external-package target keeps that package's own identity and bundle; only
 * the import-map key stays `#x`, because that is what emitted code requests.
 */
async function resolvePackageImportsAlias(specifier: string, baseDirectory: string): Promise<InstalledBrowserImport> {
  const resolved = await resolvePackageImportsSpecifier(specifier, baseDirectory, "browser");
  if (resolved.target.kind === "external") {
    if (isBuiltin(resolved.target.specifier)) {
      throw new Error(`Node builtin '${resolved.target.specifier}' cannot run in a browser build`);
    }
    return resolveInstalledBrowserImport(
      resolved.target.specifier,
      requireAt(resolved.ownerRoot),
      resolved.ownerRoot,
    );
  }
  return {
    requestedName: importsOwnerIdentity(resolved.ownerManifest, resolved.ownerRoot),
    subpath: specifier,
    root: resolved.ownerRoot,
    manifest: resolved.ownerManifest,
    entry: resolved.target.path,
  };
}

/**
 * The route and cache name for a package that declares an `imports` map. A
 * project's own manifest is not an installed dependency and may carry no name
 * at all, so the directory name stands in, and anything that is not an npm
 * package name is replaced rather than reaching a path.
 */
function importsOwnerIdentity(manifest: PackageManifest, root: string): string {
  const declared = manifest.name;
  if (typeof declared === "string" && NPM_PACKAGE_NAME.test(declared)) return declared;
  const fromDirectory = basename(root).toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^[^a-z0-9]+/u, "");
  return NPM_PACKAGE_NAME.test(fromDirectory) ? fromDirectory : "velar-package-imports";
}

async function selectBrowserEntry(
  specifier: string,
  root: string,
  manifest: PackageManifest,
  subpath: VelarPackageSubpath,
): Promise<string> {
  if (manifest.exports !== undefined && manifest.exports !== null) {
    const target = resolveExportsTarget(manifest.exports, subpath, BROWSER_IMPORT_CONDITIONS);
    if (target === null) {
      const requireTarget = resolveExportsTarget(manifest.exports, subpath, NODE_REQUIRE_CONDITIONS);
      if (requireTarget !== null) {
        throw new Error(`the package only publishes a CommonJS entry for '${subpath}' (its "exports" map has no "import", "browser", or "default" condition there); browser targets require an ESM export for that subpath`);
      }
      throw new Error(`the package does not export '${subpath}' for browser import conditions`);
    }
    if (!target.startsWith("./") || target.split("/").includes("..")) {
      throw new Error(`the package exports map maps '${subpath}' to the invalid target '${target}'`);
    }
    const entry = await firstExistingFile([resolve(root, target)]);
    if (!entry) throw new Error(`the package exports map maps '${subpath}' to '${target}', which does not exist`);
    return entry;
  }
  if (subpath !== ".") {
    const direct = resolve(root, subpath);
    const entry = await firstExistingFile([direct, `${direct}.js`, `${direct}.mjs`, join(direct, "index.js")]);
    if (!entry) throw new Error(`the package file '${subpath}' does not exist`);
    return entry;
  }
  for (const field of [manifest.browser, manifest.module, manifest.main]) {
    if (typeof field !== "string" || field === "") continue;
    const direct = resolve(root, field);
    const entry = await firstExistingFile([direct, `${direct}.js`, join(direct, "index.js")]);
    if (entry) return entry;
  }
  const fallback = await firstExistingFile([join(root, "index.js")]);
  if (!fallback) throw new Error("the package declares no entry file");
  return fallback;
}

// Prebundles one package version: every requested subpath becomes an entry
// point of a single splitting build so shared internals stay one module
// instance, internal CommonJS converts to ESM, and other packages remain bare
// imports for the import map. A valid cache is reused without running the
// bundler; `force` drops it after the watcher saw the installed files change.
async function ensurePackageBundle(state: PackageState, force: boolean): Promise<DevDependencyMeta> {
  const metaPath = join(state.cacheDir, "meta.json");
  if (force) invalidateDevDependencyFingerprint(metaPath);
  if (!force) {
    const cached = await readDevDependencyMeta(metaPath);
    if (cached
      && cached.velar === VELAR_VERSION
      && cached.name === state.name
      && cached.version === state.version
      && [...state.entries.keys()].every((subpath) => typeof cached.entries[subpath] === "string")
      && await filesExist(state.cacheDir, cached.files)
      && await reusableDevDependencyFingerprint(metaPath, state, cached.fingerprint)) {
      return cached;
    }
  }
  const outputNames = assignEntryOutputNames([...state.entries.keys()]);
  const result = await build({
    absWorkingDir: state.root,
    entryPoints: Object.fromEntries([...state.entries].map(([subpath, entry]) => [outputNames.get(subpath)!, entry])),
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    conditions: [...BROWSER_ESM_PACKAGE_CONDITIONS],
    target: "es2022",
    outdir: state.cacheDir,
    write: false,
    metafile: true,
    packages: "external",
    plugins: state.artifactReceiptPath ? [frozenArtifactPrebundle(state)] : [],
    chunkNames: "chunk-[hash]",
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });
  const entryFileSubpaths = new Map<string, string>();
  for (const [subpath, entry] of state.entries) {
    const canonical = resolve(entry);
    entryFileSubpaths.set(state.artifactSnapshots.has(canonical)
      ? frozenArtifactInputPath(canonical)
      : relative(state.root, canonical).replaceAll("\\", "/"), subpath);
  }
  const entries: Record<string, string> = {};
  const files: string[] = [];
  for (const [outputPath, output] of Object.entries(result.metafile.outputs)) {
    const relativeOutput = relative(state.cacheDir, resolve(state.root, outputPath)).replaceAll("\\", "/");
    files.push(relativeOutput);
    if (!output.entryPoint) continue;
    const subpath = entryFileSubpaths.get(output.entryPoint.replaceAll("\\", "/"));
    if (!subpath) continue;
    // Native ESM has no interop for CommonJS named exports, so a package whose
    // resolved entry itself parses as CommonJS would silently diverge from
    // Node and from 'velar build' (both provide named imports). Refuse it
    // loudly instead; internal CommonJS behind an ESM entry converts fine.
    if (result.metafile.inputs[output.entryPoint]?.format === "cjs") {
      const specifier = subpath === "." ? state.name : `${state.name}/${subpath.slice(2)}`;
      const entryFromRoot = relative(state.root, state.entries.get(subpath)!).replaceAll("\\", "/");
      throw new Error(`'${specifier}' resolves to the CommonJS file '${entryFromRoot}' and the package publishes no ESM alternative under its "import" or "browser" export conditions; 'velar dev' serves packages to the browser as native ES modules and cannot reproduce CommonJS named exports, so the package needs an ESM build ('velar build' can still bundle CommonJS)`);
    }
    entries[subpath] = relativeOutput;
  }
  const fingerprint = await devDependencyFingerprint(state, Object.keys(result.metafile.inputs)
    .filter((input) => !input.startsWith(FROZEN_ARTIFACT_NAMESPACE_PREFIX)));
  const meta: DevDependencyMeta = {
    formatVersion: 3,
    velar: VELAR_VERSION,
    name: state.name,
    version: state.version,
    entries,
    files: files.sort(),
    externals: [...collectExternalImports(result.metafile)].sort(),
    fingerprint,
  };
  await rm(state.cacheDir, { recursive: true, force: true });
  await mkdir(state.cacheDir, { recursive: true });
  for (const file of result.outputFiles) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents);
  }
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  rememberDevDependencyFingerprint(metaPath, fingerprint);
  return meta;
}


async function readDevDependencyMeta(path: string): Promise<DevDependencyMeta | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBoundedText(path, MAX_DEV_DEPENDENCY_META_BYTES, "Development prebundle metadata"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const meta = parsed as Partial<DevDependencyMeta>;
  if (meta.formatVersion !== 3 || typeof meta.velar !== "string" || typeof meta.name !== "string" || typeof meta.version !== "string") return null;
  if (!meta.entries || typeof meta.entries !== "object" || Array.isArray(meta.entries)) return null;
  if (!Array.isArray(meta.files) || meta.files.length > MAX_DEV_DEPENDENCY_INPUTS * 2
    || !meta.files.every((file) => typeof file === "string" && normalizedPrebundlePath(file))) return null;
  if (!Array.isArray(meta.externals) || meta.externals.length > MAX_BROWSER_NPM_PACKAGES
    || !meta.externals.every((item) => typeof item === "string")) return null;
  if (Object.keys(meta.entries).length > MAX_BROWSER_NPM_PACKAGES
    || !Object.values(meta.entries).every((value) => typeof value === "string" && normalizedPrebundlePath(value))) return null;
  if (!validDevDependencyFingerprint(meta.fingerprint, MAX_BROWSER_NPM_PACKAGES)) return null;
  return meta as DevDependencyMeta;
}

async function filesExist(root: string, files: readonly string[]): Promise<boolean> {
  for (const file of files) {
    try {
      const metadata = await stat(join(root, file));
      if (!metadata.isFile()) return false;
    } catch {
      return false;
    }
  }
  return files.length > 0;
}

// Deterministic output names for entry subpaths: the package root becomes
// index.js, a subpath keeps its own path spelling with unsafe characters
// replaced, and collisions gain a numeric suffix in sorted order.
function assignEntryOutputNames(subpaths: readonly string[]): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const subpath of [...subpaths].sort()) {
    // `.`, an exports subpath `./a/b`, or a package `imports` alias `#a`. The
    // resolvers refuse a `..` segment before a subpath reaches here; the sink
    // is closed a second time because this name is joined onto a cache
    // directory the next build removes recursively.
    const preferred = subpath === "."
      ? "index"
      : (subpath.startsWith("#") ? subpath.slice(1) : subpath.slice(2))
        .split("/")
        .map((segment) => (segment === ".." ? "-" : segment).replace(/[^A-Za-z0-9_.-]+/gu, "-"))
        .join("/") || "index";
    let name = preferred;
    for (let counter = 2; used.has(name); counter += 1) name = `${preferred}-${counter}`;
    used.add(name);
    names.set(subpath, name);
  }
  return names;
}

// A prebundle keeps other packages external, so every reachable bare import
// still needs an import-map entry (and prebundle) of its own. Node builtins
// stay in the list so they surface the established browser-build refusal.
function collectExternalImports(metafile: Metafile): readonly string[] {
  const specifiers = new Set<string>();
  for (const input of Object.values(metafile.inputs)) {
    for (const item of input.imports) {
      if (!item.external) continue;
      if (item.path.startsWith(".") || item.path.startsWith("/")) continue;
      if (item.path.includes(":") && !item.path.startsWith("node:")) continue;
      specifiers.add(item.path);
    }
  }
  return [...specifiers];
}

function resolveExportsTarget(
  exports: unknown,
  subpath: VelarPackageSubpath,
  conditions: ReadonlySet<string>,
): string | null {
  return externalPackageExportTargets(exports, subpath, [conditions])[0] ?? null;
}

async function firstExistingFile(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      const metadata = await stat(candidate);
      if (metadata.isFile()) return candidate;
    } catch {
      // Try the next candidate spelling.
    }
  }
  return null;
}

function npmContentType(path: string): string {
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function withBase(base: string, path: string): string {
  return `${base}${path.replace(/^\/+/, "")}`;
}
