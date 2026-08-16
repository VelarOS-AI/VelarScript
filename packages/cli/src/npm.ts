import { mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type Metafile } from "esbuild";
import type { ProjectResult } from "./project.ts";
import { readBoundedText } from "./bounded-text.ts";
import { frameworkBase } from "./framework-host.ts";
import { hostErrorMessage } from "./host-error.ts";
import { resolveInstalledPackageRoot } from "./installed-package.ts";
import { VELAR_VERSION } from "./version.ts";

const MAX_BROWSER_NPM_PACKAGES = 4096;
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const MAX_DEV_DEPENDENCY_META_BYTES = 1024 * 1024;

// The dev server serves package code to the browser as native ES modules, so
// bare specifiers resolve with the same conditions the production bundler uses
// for a browser import: "browser", "import", and the community "module"
// condition, in the package's own declaration order.
const BROWSER_IMPORT_CONDITIONS: ReadonlySet<string> = new Set(["browser", "import", "module", "default"]);
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

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly type?: string;
  readonly exports?: unknown;
  readonly browser?: unknown;
  readonly module?: unknown;
  readonly main?: unknown;
}

// One prebundled package version in <project>/.velar/dev-deps. The metadata
// file makes a cache hit self-describing: entry outputs for the import map,
// every emitted file for completeness checks, and the external bare imports
// that still need import-map entries of their own.
interface DevDependencyMeta {
  readonly formatVersion: 1;
  readonly velar: string;
  readonly name: string;
  readonly version: string;
  readonly entries: Readonly<Record<string, string>>;
  readonly files: readonly string[];
  readonly externals: readonly string[];
}

interface PackageState {
  readonly name: string;
  readonly version: string;
  readonly root: string;
  readonly manifest: PackageManifest;
  readonly route: string;
  readonly cacheDir: string;
  readonly entries: Map<string, string>;
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

/** Resolve one bare package import exactly as a browser ESM import. */
export async function resolveBrowserNpmEntry(specifier: string, baseDirectory: string): Promise<string> {
  const require = createRequire(pathToFileURL(join(baseDirectory, "__velar_browser_import__.js")));
  return (await resolveInstalledBrowserImport(specifier, require)).entry;
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
): Promise<BrowserNpmResolution> {
  const base = frameworkBase(project.framework);
  const specifiers = new Set(project.modules.flatMap((module) => module.result.dependencies
    .filter((dependency) => dependency.javascript && !dependency.source.startsWith(".") && !dependency.source.startsWith("/"))
    .map((dependency) => dependency.source)));
  const require = createRequire(pathToFileURL(join(project.sourceRoot, "package.json")));
  const cacheRoot = resolve(project.projectRoot, ".velar", "dev-deps");
  const states = new Map<string, PackageState>();
  const targets = new Map<string, { readonly state: PackageState; readonly subpath: string }>();
  const imports: Record<string, string> = {};
  const failures: string[] = [];

  if (specifiers.size > MAX_BROWSER_NPM_PACKAGES) {
    throw new RangeError(`A browser project cannot import more than ${MAX_BROWSER_NPM_PACKAGES} JavaScript packages`);
  }

  const processed = new Set<string>();
  let queue = [...specifiers];
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
        const resolvedImport = await resolveInstalledBrowserImport(specifier, require);
        const { requestedName, subpath, root, manifest, entry } = resolvedImport;
        const name = manifest.name ?? requestedName;
        let state = states.get(name);
        if (!state) {
          const version = typeof manifest.version === "string" && manifest.version !== "" ? manifest.version : "0.0.0";
          state = {
            name,
            version,
            root,
            manifest,
            route: `/@npm/${name}/`,
            cacheDir: join(cacheRoot, `${name.replaceAll("/", "+")}@${version}`),
            entries: new Map(),
            meta: null,
            bundled: false,
            failure: null,
          };
          states.set(name, state);
        }
        if (!state.entries.has(subpath)) {
          const entryFromRoot = relative(state.root, entry);
          if (!entryFromRoot || entryFromRoot.startsWith("..") || isAbsolute(entryFromRoot)) {
            throw new Error(`the resolved entry '${entryFromRoot}' escapes the package directory`);
          }
          state.entries.set(subpath, entry);
          state.bundled = false;
        }
        targets.set(specifier, { state, subpath });
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
  for (const package_ of project.velarPackages) {
    const entry = project.modules.find((module) => module.inputPath === package_.entryPath);
    if (!entry) {
      failures.push(`VelarScript package '${package_.name}' entry was not compiled`);
      continue;
    }
    imports[package_.name] = withBase(
      base,
      `/${entry.relativePath.replace(/\.vel$/u, ".js").replaceAll("\\", "/")}`,
    );
  }
  return { packages, imports, failures };
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

async function resolveInstalledBrowserImport(specifier: string, require: NodeJS.Require): Promise<InstalledBrowserImport> {
  const requestedName = packageNameOf(specifier);
  const subpath = specifier === requestedName ? "." : `.${specifier.slice(requestedName.length)}`;
  if (subpath.split("/").includes("..")) throw new Error(`the subpath '${subpath}' escapes the package directory`);
  const root = await resolveInstalledPackageRoot(requestedName, specifier, require);
  const manifest = JSON.parse(await readBoundedText(
    join(root, "package.json"),
    MAX_PACKAGE_MANIFEST_BYTES,
    `Package manifest for '${specifier}'`,
  )) as PackageManifest;
  const entry = await selectBrowserEntry(specifier, root, manifest, subpath);
  return { requestedName, subpath, root, manifest, entry };
}

async function selectBrowserEntry(specifier: string, root: string, manifest: PackageManifest, subpath: string): Promise<string> {
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
  if (!force) {
    const cached = await readDevDependencyMeta(metaPath);
    if (cached
      && cached.velar === VELAR_VERSION
      && cached.name === state.name
      && cached.version === state.version
      && [...state.entries.keys()].every((subpath) => typeof cached.entries[subpath] === "string")
      && await filesExist(state.cacheDir, cached.files)) {
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
    target: "es2022",
    outdir: state.cacheDir,
    write: false,
    metafile: true,
    packages: "external",
    chunkNames: "chunk-[hash]",
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });
  const entryFileSubpaths = new Map<string, string>();
  for (const [subpath, entry] of state.entries) {
    entryFileSubpaths.set(relative(state.root, entry).replaceAll("\\", "/"), subpath);
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
  const meta: DevDependencyMeta = {
    formatVersion: 1,
    velar: VELAR_VERSION,
    name: state.name,
    version: state.version,
    entries,
    files: files.sort(),
    externals: [...collectExternalImports(result.metafile)].sort(),
  };
  await rm(state.cacheDir, { recursive: true, force: true });
  await mkdir(state.cacheDir, { recursive: true });
  for (const file of result.outputFiles) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents);
  }
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
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
  if (meta.formatVersion !== 1 || typeof meta.velar !== "string" || typeof meta.name !== "string" || typeof meta.version !== "string") return null;
  if (!meta.entries || typeof meta.entries !== "object" || Array.isArray(meta.entries)) return null;
  if (!Array.isArray(meta.files) || !meta.files.every((file) => typeof file === "string")) return null;
  if (!Array.isArray(meta.externals) || !meta.externals.every((item) => typeof item === "string")) return null;
  if (!Object.values(meta.entries).every((value) => typeof value === "string")) return null;
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
    const preferred = subpath === "."
      ? "index"
      : subpath.slice(2).split("/").map((segment) => segment.replace(/[^A-Za-z0-9_.-]+/gu, "-")).join("/") || "index";
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

function resolveExportsTarget(exports: unknown, subpath: string, conditions: ReadonlySet<string>): string | null {
  const map = normalizeExports(exports);
  const exact = map.get(subpath);
  if (exact !== undefined) return resolveTargetValue(exact, "", conditions);
  let bestKey: string | null = null;
  let bestPrefix = -1;
  for (const key of map.keys()) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (subpath.length >= prefix.length + suffix.length
      && subpath.startsWith(prefix)
      && subpath.endsWith(suffix)
      && prefix.length > bestPrefix) {
      bestKey = key;
      bestPrefix = prefix.length;
    }
  }
  if (bestKey === null) return null;
  const suffixLength = bestKey.length - bestKey.indexOf("*") - 1;
  const matched = subpath.slice(bestPrefix, subpath.length - suffixLength);
  return resolveTargetValue(map.get(bestKey), matched, conditions);
}

function normalizeExports(exports: unknown): ReadonlyMap<string, unknown> {
  if (typeof exports === "string" || Array.isArray(exports)) return new Map([[".", exports]]);
  if (exports !== null && typeof exports === "object") {
    const entries = Object.entries(exports);
    if (entries.every(([key]) => key === "." || key.startsWith("./"))) return new Map(entries);
    return new Map([[".", exports]]);
  }
  return new Map();
}

function resolveTargetValue(target: unknown, starReplacement: string, conditions: ReadonlySet<string>): string | null {
  if (typeof target === "string") return target.replaceAll("*", starReplacement);
  if (Array.isArray(target)) {
    for (const item of target) {
      const resolved = resolveTargetValue(item, starReplacement, conditions);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  if (target !== null && typeof target === "object") {
    for (const [condition, value] of Object.entries(target)) {
      if (!conditions.has(condition)) continue;
      const resolved = resolveTargetValue(value, starReplacement, conditions);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  return null;
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

function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] ?? specifier;
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
