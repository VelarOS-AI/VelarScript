import { access, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { ProjectResult } from "./project.ts";
import { readBoundedText } from "./bounded-text.ts";
import { frameworkBase } from "./framework-host.ts";
import { hostErrorMessage } from "./host-error.ts";

const MAX_BROWSER_NPM_PACKAGES = 4096;
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const MAX_BROWSER_ENTRY_INSPECTION_BYTES = 16 * 1024 * 1024;

// The dev server serves package files to the browser as native ES modules, so
// bare specifiers resolve with the same conditions the production bundler uses
// for a browser import: "browser", "import", and the community "module"
// condition, in the package's own declaration order.
const BROWSER_IMPORT_CONDITIONS: ReadonlySet<string> = new Set(["browser", "import", "module", "default"]);
const NODE_REQUIRE_CONDITIONS: ReadonlySet<string> = new Set(["require", "node", "default"]);

export interface BrowserNpmPackage {
  readonly name: string;
  readonly root: string;
  readonly route: string;
  readonly entryRoute: string;
}

export interface BrowserNpmResolution {
  readonly packages: readonly BrowserNpmPackage[];
  readonly imports: Readonly<Record<string, string>>;
  readonly failures: readonly string[];
}

interface PackageManifest {
  readonly name?: string;
  readonly type?: string;
  readonly exports?: unknown;
  readonly browser?: unknown;
  readonly module?: unknown;
  readonly main?: unknown;
}

export async function resolveBrowserNpm(project: ProjectResult): Promise<BrowserNpmResolution> {
  const base = frameworkBase(project.framework);
  const specifiers = new Set(project.modules.flatMap((module) => module.result.dependencies
    .filter((dependency) => dependency.javascript && !dependency.source.startsWith(".") && !dependency.source.startsWith("/"))
    .map((dependency) => dependency.source)));
  const require = createRequire(pathToFileURL(join(project.sourceRoot, "package.json")));
  const packages = new Map<string, BrowserNpmPackage>();
  const imports: Record<string, string> = {};
  const failures: string[] = [];

  if (specifiers.size > MAX_BROWSER_NPM_PACKAGES) {
    throw new RangeError(`A browser project cannot import more than ${MAX_BROWSER_NPM_PACKAGES} JavaScript packages`);
  }

  const pending = [...specifiers];
  const processed = new Set<string>();
  while (pending.length > 0) {
    const specifier = pending.shift()!;
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
      const resolved = await resolveBrowserPackageEntry(specifier, require);
      const route = `/@npm/${resolved.name}/`;
      const entryRoute = `${route}${relative(resolved.root, resolved.entry).split("\\").join("/")}`;
      if (!packages.has(resolved.name)) {
        packages.set(resolved.name, { name: resolved.name, root: resolved.root, route, entryRoute });
      }
      imports[specifier] = withBase(base, entryRoute);
      for (const dependency of await collectBareImports(resolved.entry)) {
        if (!processed.has(dependency)) pending.push(dependency);
      }
    } catch (error) {
      failures.push(`Cannot resolve browser npm import '${specifier}': ${hostErrorMessage(error)}`);
    }
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
  return { packages: [...packages.values()], imports, failures };
}

export async function npmAsset(packages: readonly BrowserNpmPackage[], pathname: string): Promise<{ readonly path: string; readonly sizeBytes: number; readonly contentType: string } | null> {
  const package_ = packages.find((item) => pathname.startsWith(item.route));
  if (!package_) return null;
  const relativePath = pathname.slice(package_.route.length);
  if (!relativePath || relativePath.split("/").includes("..")) return null;
  const path = resolve(package_.root, relativePath);
  const unresolvedFromRoot = relative(package_.root, path);
  if (!unresolvedFromRoot || unresolvedFromRoot === ".." || unresolvedFromRoot.startsWith(`..${sep}`) || isAbsolute(unresolvedFromRoot)) return null;
  try {
    const [rootPath, assetPath] = await Promise.all([realpath(package_.root), realpath(path)]);
    const assetFromRoot = relative(rootPath, assetPath);
    if (!assetFromRoot || assetFromRoot.startsWith("..") || assetFromRoot.startsWith("/") || assetFromRoot.startsWith("\\")) return null;
    const metadata = await stat(assetPath);
    if (!metadata.isFile()) return null;
    return { path: assetPath, sizeBytes: metadata.size, contentType: npmContentType(assetPath) };
  } catch {
    return null;
  }
}

async function resolveBrowserPackageEntry(
  specifier: string,
  require: NodeJS.Require,
): Promise<{ readonly name: string; readonly root: string; readonly entry: string }> {
  const requestedName = packageNameOf(specifier);
  const subpath = specifier === requestedName ? "." : `.${specifier.slice(requestedName.length)}`;
  const root = await findInstalledPackageRoot(requestedName, specifier, require);
  const manifest = JSON.parse(await readBoundedText(
    join(root, "package.json"),
    MAX_PACKAGE_MANIFEST_BYTES,
    `Package manifest for '${specifier}'`,
  )) as PackageManifest;
  const entry = await selectBrowserEntry(specifier, root, manifest, subpath);
  const entryFromRoot = relative(root, entry);
  if (!entryFromRoot || entryFromRoot.startsWith("..") || isAbsolute(entryFromRoot)) {
    throw new Error(`the resolved entry '${entryFromRoot}' escapes the package directory`);
  }
  await requireServableEsmEntry(specifier, root, manifest, entry);
  return { name: manifest.name ?? requestedName, root, entry };
}

async function findInstalledPackageRoot(name: string, specifier: string, require: NodeJS.Require): Promise<string> {
  for (const directory of require.resolve.paths(specifier) ?? []) {
    const root = join(directory, name);
    try {
      await access(join(root, "package.json"));
      return root;
    } catch {
      // Keep walking the node_modules chain.
    }
  }
  throw new Error(`package '${name}' is not installed in node_modules`);
}

async function selectBrowserEntry(specifier: string, root: string, manifest: PackageManifest, subpath: string): Promise<string> {
  if (manifest.exports !== undefined && manifest.exports !== null) {
    const target = resolveExportsTarget(manifest.exports, subpath, BROWSER_IMPORT_CONDITIONS);
    if (target === null) {
      const requireTarget = resolveExportsTarget(manifest.exports, subpath, NODE_REQUIRE_CONDITIONS);
      if (requireTarget !== null) {
        throw new Error(`the package only publishes a CommonJS entry for '${subpath}' (its "exports" map has no "import", "browser", or "default" condition there); 'velar dev' serves packages to the browser as native ES modules, so the package needs an ESM build ('velar build' can still bundle CommonJS)`);
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

async function requireServableEsmEntry(specifier: string, root: string, manifest: PackageManifest, entry: string): Promise<void> {
  const extension = extname(entry);
  const entryFromRoot = relative(root, entry).split("\\").join("/");
  if (![".js", ".mjs", ".cjs"].includes(extension)) {
    throw new Error(`the entry '${entryFromRoot}' is not a JavaScript module`);
  }
  if (extension === ".mjs" || (extension === ".js" && manifest.type === "module")) return;
  const cjsOnly = (): Error => new Error(`'${specifier}' resolves to the CommonJS file '${entryFromRoot}' and the package publishes no ESM alternative under its "import" or "browser" export conditions; 'velar dev' serves packages to the browser as native ES modules, so the package needs an ESM build ('velar build' can still bundle CommonJS)`);
  if (extension === ".cjs") throw cjsOnly();
  const code = await readBoundedText(entry, MAX_BROWSER_ENTRY_INSPECTION_BYTES, `Browser package entry for '${specifier}'`);
  if (/\b(?:require\s*\(|module\.exports|exports\.)/u.test(code)) throw cjsOnly();
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

// A package entry can pull in further bare specifiers, which the browser can
// only resolve through the import map. Walk the entry's module graph with the
// same bundler the production build uses, keeping packages external, so every
// reachable bare import receives an import-map entry of its own.
async function collectBareImports(entry: string): Promise<readonly string[]> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  const specifiers = new Set<string>();
  for (const input of Object.values(result.metafile.inputs)) {
    for (const item of input.imports) {
      if (!item.external) continue;
      if (item.path.startsWith(".") || item.path.startsWith("/")) continue;
      if (item.path.includes(":") && !item.path.startsWith("node:")) continue;
      specifiers.add(item.path);
    }
  }
  return [...specifiers];
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
