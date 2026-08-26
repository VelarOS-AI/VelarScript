import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import type { VelarProjectConfig } from "./config.ts";
import {
  encodeVelarLibraryInterface,
  packageStableModulePath,
  rebaseModuleInterfaceIdentities,
  sha256Text,
  type VelarLibraryArtifactReceipt,
  type VelarLibraryArtifactTarget,
} from "./library-artifact.ts";
import type { ProjectModule, ProjectResult } from "./project.ts";
import { jsonResourceModule } from "./resource-output.ts";
import { standardModuleSource } from "./standard-modules.ts";
import { VELAR_VERSION } from "./version.ts";
import type { JavaScriptBuildMode } from "./javascript-output.ts";

const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const PACKAGE_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export interface VelarLibraryBuildConfig {
  readonly project: VelarProjectConfig;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly sourceEntry: string;
  readonly target: VelarLibraryArtifactTarget;
  readonly receiptPath: string;
  readonly outputRoot: string;
}

export interface WrittenVelarLibraryArtifact {
  readonly receipt: VelarLibraryArtifactReceipt;
  readonly outputRoot: string;
}

export async function resolveVelarLibraryBuild(config: VelarProjectConfig): Promise<VelarLibraryBuildConfig> {
  const packagePath = join(config.root, "package.json");
  const source = await readFile(packagePath, "utf8");
  if (Buffer.byteLength(source, "utf8") > MAX_PACKAGE_MANIFEST_BYTES) throw new RangeError(`${packagePath} exceeds ${MAX_PACKAGE_MANIFEST_BYTES} bytes`);
  const manifest = JSON.parse(source) as Record<string, unknown>;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${packagePath} must contain a JSON object`);
  if (typeof manifest.name !== "string" || !PACKAGE_NAME.test(manifest.name)) throw new Error(`${packagePath}: a library artifact requires a valid package name`);
  if (typeof manifest.version !== "string" || !PACKAGE_VERSION.test(manifest.version)) throw new Error(`${packagePath}: a library artifact requires a semantic package version`);
  const velar = manifest.velar;
  if (!velar || typeof velar !== "object" || Array.isArray(velar)) throw new Error(`${packagePath}: a library artifact requires the 'velar' package section`);
  const fields = velar as Record<string, unknown>;
  const sourceEntry = normalizedRelativePath(fields.entry, `${packagePath}#velar.entry`);
  if (!sourceEntry.endsWith(".vel")) throw new Error(`${packagePath}#velar.entry must point to a .vel source file`);
  const entryPath = resolve(config.root, ...sourceEntry.split("/"));
  const fromRoot = relative(config.root, entryPath);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error(`${packagePath}#velar.entry escapes the package root`);
  const target = libraryTarget(config);
  const artifacts = fields.artifacts;
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
    throw new Error(`${packagePath}: 'velar.artifacts' must map '${target}' to the generated receipt path`);
  }
  const descriptors = artifacts as Record<string, unknown>;
  const unknown = Object.keys(descriptors).find((key) => key !== "core" && key !== "node");
  if (unknown) throw new Error(`${packagePath}: Velar library ABI 1 does not support artifact target '${unknown}'; supported targets are core and node`);
  if (Object.keys(descriptors).length !== 1 || descriptors[target] === undefined) {
    throw new Error(`${packagePath}: Velar library ABI 1 requires exactly one '${target}' artifact per package`);
  }
  const descriptor = normalizedRelativePath(descriptors[target], `${packagePath}#velar.artifacts.${target}`);
  if (!descriptor.endsWith(".json")) throw new Error(`${packagePath}#velar.artifacts.${target} must point to a .json receipt`);
  const receiptPath = resolve(config.root, ...descriptor.split("/"));
  const outputRoot = dirname(receiptPath);
  const outputFromRoot = relative(config.root, outputRoot);
  if (!outputFromRoot || outputFromRoot.startsWith("..") || isAbsolute(outputFromRoot)) throw new Error(`${packagePath}#velar.artifacts.${target} escapes the package root`);
  if (resolve(outputRoot) !== resolve(config.outDir)) {
    throw new Error(`${packagePath}#velar.artifacts.${target} must live directly in the velar.json outDir so library builds cannot replace a source or unrelated directory`);
  }
  const exports = manifest.exports;
  const expectedEntry = `./${relative(config.root, join(outputRoot, "index.js")).replaceAll("\\", "/")}`;
  const rootExports = packageExportTargets(exports, ".");
  if (rootExports.length === 0 || rootExports.some((item) => item !== expectedEntry)) {
    throw new Error(`${packagePath}: package.json 'exports' must expose the generated library artifact as '${expectedEntry}'`);
  }
  return {
    project: { ...config, entryPath },
    packageName: manifest.name,
    packageVersion: manifest.version,
    sourceEntry,
    target,
    receiptPath,
    outputRoot,
  };
}

export async function writeVelarLibraryArtifact(
  buildConfig: VelarLibraryBuildConfig,
  project: ProjectResult,
  stagingRoot: string,
  mode: JavaScriptBuildMode = "production",
): Promise<WrittenVelarLibraryArtifact> {
  if (project.failures.length > 0) throw new Error("Cannot write a library artifact from a project with resolution failures");
  const diagnostics = project.modules.flatMap((module) => module.result.diagnostics);
  if (diagnostics.length > 0) throw new Error("Cannot write a library artifact from a project with compiler diagnostics");
  const entry = project.modules.find((module) => module.inputPath === buildConfig.project.entryPath);
  if (!entry?.result.code) throw new Error("The VelarScript library entry did not emit JavaScript");
  const output = await bundleLibrary(project, entry, buildConfig.target, buildConfig.outputRoot, mode);
  const interface_ = project.moduleInterfaces.get(entry.inputPath) ?? entry.result.moduleInterface;
  const replacements = identityReplacements(buildConfig, project);
  const interfaceText = encodeVelarLibraryInterface(rebaseModuleInterfaceIdentities(interface_, replacements));
  const sourceMap = portableSourceMap(output.sourceMap, buildConfig.project.root, buildConfig.outputRoot);
  const javascript = output.code.endsWith("\n") ? output.code : `${output.code}\n`;
  const sources = project.modules
    .filter((module) => inside(buildConfig.project.root, module.inputPath))
    .map((module) => ({
      path: relative(buildConfig.project.root, module.inputPath).replaceAll("\\", "/"),
      sha256: sha256Text(module.result.source.text),
    }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (sources.length === 0) throw new Error("The VelarScript library artifact has no package-owned source modules");
  const receipt: VelarLibraryArtifactReceipt = {
    formatVersion: 1,
    kind: "velar-library-artifact",
    abiVersion: 1,
    package: { name: buildConfig.packageName, version: buildConfig.packageVersion },
    target: buildConfig.target,
    compilerVersion: VELAR_VERSION,
    sourceEntry: buildConfig.sourceEntry,
    sources,
    entry: {
      javascript: "index.js",
      sourceMap: "index.js.map",
      interface: "index.veli.json",
      sha256: {
        javascript: sha256Text(javascript),
        sourceMap: sha256Text(sourceMap),
        interface: sha256Text(interfaceText),
      },
    },
  };
  await Promise.all([
    writeFile(join(stagingRoot, "index.js"), javascript, "utf8"),
    writeFile(join(stagingRoot, "index.js.map"), sourceMap, "utf8"),
    writeFile(join(stagingRoot, "index.veli.json"), interfaceText, "utf8"),
    writeFile(join(stagingRoot, relative(buildConfig.outputRoot, buildConfig.receiptPath)), `${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
  ]);
  return { receipt, outputRoot: buildConfig.outputRoot };
}

async function bundleLibrary(
  project: ProjectResult,
  entry: ProjectModule,
  target: VelarLibraryArtifactTarget,
  finalOutputRoot: string,
  mode: JavaScriptBuildMode,
): Promise<{ readonly code: string; readonly sourceMap: string }> {
  if (entry.result.code === null) throw new Error("The VelarScript library entry did not emit JavaScript");
  const modules = new Map(project.modules.map((module) => [resolve(module.inputPath), module]));
  const portableModules = new Map(project.modules.map((module) => [portableBundlePath(project, module.inputPath), module]));
  const embedded = new Map<string, { readonly owner: ProjectModule; readonly code: string; readonly sourceMap: string; readonly portablePath: string }>();
  const portableEmbedded = new Map<string, { readonly owner: ProjectModule; readonly code: string; readonly sourceMap: string; readonly portablePath: string }>();
  for (const module of project.modules) {
    for (const item of module.result.embeddedModules) {
      const physicalPath = resolve(dirname(module.inputPath), item.specifier);
      const value = { owner: module, code: item.code, sourceMap: item.sourceMap, portablePath: portableBundlePath(project, physicalPath) };
      embedded.set(physicalPath, value);
      portableEmbedded.set(value.portablePath, value);
    }
  }
  const resources = new Map(project.resources.map((resource) => [resolve(resource.inputPath), resource]));
  const portableResources = new Map(project.resources.map((resource) => [portableBundlePath(project, resource.inputPath), resource]));
  const plugin: Plugin = {
    name: "velar-library-artifact",
    setup(context) {
      context.onResolve({ filter: /^velar\// }, (arguments_) => ({ path: arguments_.path, namespace: "velar-standard" }));
      context.onLoad({ filter: /.*/, namespace: "velar-standard" }, (arguments_) => {
        const source = standardModuleSource(arguments_.path, project.extensionConfig, project.compilerExtensions);
        return source === null
          ? { errors: [{ text: `Unknown VelarScript standard module '${arguments_.path}'` }] }
          : { contents: source, loader: "js", resolveDir: project.projectRoot };
      });
      context.onResolve({ filter: /^\.\.?\// }, (arguments_) => {
        const path = resolve(arguments_.resolveDir, arguments_.path);
        const embeddedModule = embedded.get(path);
        if (embeddedModule) return { path: embeddedModule.portablePath, namespace: "velar-embedded" };
        if (arguments_.path.endsWith(".json.js")) {
          const resourcePath = resolve(arguments_.resolveDir, arguments_.path.slice(0, -3));
          if (resources.has(resourcePath)) return { path: portableBundlePath(project, resourcePath), namespace: "velar-resource" };
        }
        if (arguments_.path.endsWith(".js")) {
          const modulePath = resolve(arguments_.resolveDir, arguments_.path.replace(/\.js$/u, ".vel"));
          if (modules.has(modulePath)) return { path: portableBundlePath(project, modulePath), namespace: "velar-module" };
        }
        return null;
      });
      context.onLoad({ filter: /.*/, namespace: "velar-module" }, (arguments_) => {
        const module = portableModules.get(arguments_.path);
        return module?.result.code ? {
          contents: mappedJavaScript(module.result.code, module.result.sourceMap),
          loader: "js",
          resolveDir: dirname(module.inputPath),
        } : { errors: [{ text: `VelarScript module '${arguments_.path}' was not compiled` }] };
      });
      context.onLoad({ filter: /.*/, namespace: "velar-embedded" }, (arguments_) => {
        const item = portableEmbedded.get(arguments_.path);
        return item ? {
          contents: mappedJavaScript(item.code, item.sourceMap),
          loader: "js",
          resolveDir: dirname(item.owner.inputPath),
        } : null;
      });
      context.onLoad({ filter: /.*/, namespace: "velar-resource" }, (arguments_) => {
        const resource = portableResources.get(arguments_.path);
        return resource ? { contents: jsonResourceModule(resource.content), loader: "js", resolveDir: dirname(resource.inputPath) } : null;
      });
      context.onResolve({ filter: /^[^./]/ }, (arguments_) => {
        if (arguments_.path.startsWith("velar/")) return null;
        return { path: arguments_.path, external: true };
      });
    },
  };
  const result = await build({
    absWorkingDir: project.projectRoot,
    bundle: true,
    format: "esm",
    platform: target === "node" ? "node" : "neutral",
    target: target === "node" ? "node24" : "es2022",
    conditions: ["import", "default"],
    packages: "external",
    minify: mode === "production",
    keepNames: mode === "readable",
    // Node's `Worker(..., {eval:true})` executes CommonJS source and exposes
    // `globalThis.require`. Naming that explicitly prevents esbuild from
    // closing over its ESM `__require` shim inside a function whose source is
    // later serialized with `toString()` (the SQLite adapter's bounded Worker
    // is the concrete case). A top-level require was never valid in the ESM
    // artifact; embedded modules use imports for their own execution.
    ...(target === "node" ? { define: { require: "globalThis.require" } } : {}),
    outfile: join(finalOutputRoot, "index.js"),
    sourcemap: "external",
    sourcesContent: true,
    legalComments: "none",
    logLevel: "silent",
    write: false,
    plugins: [plugin],
    stdin: {
      contents: mappedJavaScript(entry.result.code, entry.result.sourceMap),
      loader: "js",
      resolveDir: dirname(entry.inputPath),
      sourcefile: portableBundlePath(project, entry.inputPath),
    },
  });
  const code = result.outputFiles?.find((file) => resolve(file.path) === resolve(finalOutputRoot, "index.js"));
  const sourceMap = result.outputFiles?.find((file) => resolve(file.path) === resolve(finalOutputRoot, "index.js.map"));
  if (!code || !sourceMap) throw new Error("The Velar library bundler did not emit JavaScript and its source map");
  return { code: code.text, sourceMap: sourceMap.text };
}

function mappedJavaScript(code: string, sourceMap: string | null): string {
  if (!sourceMap) return code;
  return `${code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(sourceMap).toString("base64")}\n`;
}

function portableBundlePath(project: ProjectResult, path: string): string {
  if (inside(project.projectRoot, path)) return relative(project.projectRoot, path).replaceAll("\\", "/");
  const owner = project.velarPackages.find((package_) => inside(package_.root, path));
  if (owner) return `__velar_packages__/${owner.name}/${relative(owner.root, path).replaceAll("\\", "/")}`;
  throw new Error(`Library bundle input '${path}' is outside the project and its declared VelarScript packages`);
}

function identityReplacements(
  config: VelarLibraryBuildConfig,
  project: ProjectResult,
): readonly { readonly physical: string; readonly logical: string }[] {
  const replacements: { physical: string; logical: string }[] = [];
  for (const module of project.modules) {
    if (inside(config.project.root, module.inputPath)) {
      replacements.push({
        physical: module.inputPath,
        logical: packageStableModulePath(config.packageName, config.packageVersion, relative(config.project.root, module.inputPath)),
      });
      continue;
    }
    const owner = project.velarPackages.find((package_) => inside(package_.root, module.inputPath));
    if (owner) replacements.push({
      physical: module.inputPath,
      logical: packageStableModulePath(owner.name, owner.version, relative(owner.root, module.inputPath)),
    });
  }
  return replacements;
}

function portableSourceMap(text: string, packageRoot: string, outputRoot: string): string {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (Array.isArray(parsed.sources)) {
    parsed.sources = parsed.sources.map((source) => {
      if (typeof source !== "string") return source;
      const path = source.startsWith("file://") ? new URL(source) : null;
      const physical = path ? path.pathname : isAbsolute(source) ? source : resolve(packageRoot, source);
      return inside(packageRoot, physical)
        ? relative(outputRoot, physical).replaceAll("\\", "/")
        : source.replaceAll("\\", "/");
    });
  }
  return `${JSON.stringify(parsed)}\n`;
}

function libraryTarget(config: VelarProjectConfig): VelarLibraryArtifactTarget {
  const capabilities = new Set(config.compilerExtensions.flatMap((extension) => extension.capabilities ?? []));
  if (capabilities.has("desktop") || capabilities.has("web")) {
    throw new Error("Velar library ABI 1 supports Core and Node libraries; Web/Desktop libraries require the shared Web runtime ABI");
  }
  return capabilities.has("node") ? "node" : "core";
}

function normalizedRelativePath(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "" || /[\u0000-\u001f\u007f]/u.test(value) || isAbsolute(value) || value.includes("\\")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be a normalized relative path`);
  }
  return value;
}

function inside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot !== "" && !fromRoot.startsWith("..") && !isAbsolute(fromRoot);
}

function packageExportTargets(exports: unknown, subpath: string): string[] {
  if (typeof exports === "string") return subpath === "." ? [exports] : [];
  if (exports === null || typeof exports !== "object" || Array.isArray(exports)) return [];
  const fields = exports as Record<string, unknown>;
  const target = Object.keys(fields).some((key) => key.startsWith(".")) ? fields[subpath] : subpath === "." ? exports : undefined;
  const output: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") output.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(target);
  return output;
}
