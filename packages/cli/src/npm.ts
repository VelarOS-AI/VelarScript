import { access, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProjectResult } from "./project.ts";
import { readBoundedText } from "./bounded-text.ts";
import { frameworkBase } from "./framework-host.ts";
import { hostErrorMessage } from "./host-error.ts";

const MAX_BROWSER_NPM_PACKAGES = 4096;
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const MAX_BROWSER_ENTRY_INSPECTION_BYTES = 16 * 1024 * 1024;

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

  for (const specifier of specifiers) {
    if (specifier.startsWith("node:")) {
      failures.push(`Node builtin '${specifier}' cannot run in a browser build`);
      continue;
    }
    try {
      const entry = require.resolve(specifier);
      if (![".js", ".mjs"].includes(extname(entry))) throw new Error("entry is not an ESM JavaScript file");
      const root = await findPackageRoot(entry);
      const manifest = JSON.parse(await readBoundedText(join(root, "package.json"), MAX_PACKAGE_MANIFEST_BYTES, `Package manifest for '${specifier}'`)) as { name?: string; type?: string };
      const name = manifest.name ?? packageNameOf(specifier);
      if (manifest.type !== "module" && extname(entry) !== ".mjs") {
        const code = await readBoundedText(entry, MAX_BROWSER_ENTRY_INSPECTION_BYTES, `Browser package entry for '${specifier}'`);
        if (/\b(?:require\s*\(|module\.exports|exports\.)/u.test(code)) {
          throw new Error("CommonJS is not supported by the first browser package bridge; use an ESM entry");
        }
      }
      const route = `/@npm/${name}/`;
      const entryRoute = `${route}${relative(root, entry).split("\\").join("/")}`;
      packages.set(name, { name, root, route, entryRoute });
      imports[specifier] = withBase(base, entryRoute);
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

async function findPackageRoot(entry: string): Promise<string> {
  let current = dirname(entry);
  while (true) {
    try {
      await access(join(current, "package.json"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error("package.json was not found");
      current = parent;
    }
  }
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
