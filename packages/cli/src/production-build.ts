import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import { projectStyles } from "./framework-host.ts";
import { projectImportKey, type ProjectResult } from "./project.ts";
import { standardModuleSource } from "./standard-modules.ts";
import { VELAR_VERSION } from "./version.ts";
import type { StaticDeploymentSummary } from "./static-deployment.ts";
import { fileIdentity, MAX_PRODUCTION_ASSETS } from "./file-integrity.ts";
import { hostErrorMessage } from "./host-error.ts";
import { resolveBrowserNpmEntry } from "./npm.ts";
import { isNodeOnlyModule, nodeModuleDiagnostic } from "@velarscript/node/compiler";
import { assertUniqueEmbeddedModuleOutputs, embeddedModuleOutputPath } from "./embedded-modules.ts";

export interface ProductionBuildResult {
  readonly framework: ProductionFrameworkIdentity;
  readonly entryPath: string;
  readonly stylesheetPath: string | null;
  readonly modules: ProductionModuleSummary;
  readonly dependencies: ProductionDependencySummary;
  readonly sourceMaps: boolean;
}

export interface ProductionFrameworkIdentity {
  readonly id: string;
  readonly capability: string;
  readonly target: "browser";
  readonly protocolVersion: number;
  readonly apiVersion: string;
  readonly artifactKind: string;
}

export interface ProductionDependencySummary {
  readonly velar: readonly string[];
  readonly javascript: readonly string[];
}

export interface ProductionModuleSummary {
  readonly total: number;
  readonly application: number;
  readonly packages: readonly {
    readonly name: string;
    readonly modules: number;
  }[];
}

export const PRODUCTION_MANIFEST_NAME = "velar-build.json";

export interface ProductionBuildManifest {
  readonly formatVersion: 3;
  readonly kind: "velar-framework-build";
  readonly framework: ProductionFrameworkIdentity;
  readonly compiler: {
    readonly name: "velar";
    readonly version: string;
  };
  readonly buildId: string;
  readonly sourceMaps: boolean;
  readonly entry: string;
  readonly stylesheet: string | null;
  readonly modules: ProductionModuleSummary;
  readonly dependencies: ProductionDependencySummary;
  readonly deployment: StaticDeploymentSummary;
  readonly assets: readonly {
    readonly path: string;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly role: "entry" | "stylesheet" | "source-map" | "html" | "deployment" | "adapter" | "asset";
  }[];
}

export async function buildProductionFramework(project: ProjectResult, outputDirectory: string): Promise<ProductionBuildResult> {
  const framework = project.framework;
  if (!framework) throw new Error("A production application build requires a framework host");
  await mkdir(outputDirectory, { recursive: true });
  const result = await build({
    absWorkingDir: project.projectRoot,
    entryPoints: [project.entryPath],
    outdir: outputDirectory,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    treeShaking: true,
    sourcemap: framework.host.sourceMaps(framework.config) ? "linked" : false,
    sourcesContent: framework.host.sourceMaps(framework.config),
    legalComments: "none",
    metafile: true,
    entryNames: "assets/[name]-[hash]",
    chunkNames: "assets/chunk-[name]-[hash]",
    assetNames: "assets/[name]-[hash]",
    plugins: [velarModules(project)],
    logLevel: "silent",
  });
  const entryOutput = Object.entries(result.metafile.outputs).find(([, output]) => Boolean(output.entryPoint));
  if (!entryOutput) throw new Error("The production bundler did not emit the VelarScript entry module");
  const entryPath = relative(outputDirectory, resolve(project.projectRoot, entryOutput[0])).replaceAll("\\", "/");

  const css = projectStyles(project);
  let stylesheetPath: string | null = null;
  if (css) {
    const hash = createHash("sha256").update(css).digest("hex").slice(0, 10);
    stylesheetPath = `assets/styles-${hash}.css`;
    await mkdir(join(outputDirectory, "assets"), { recursive: true });
    await writeFile(join(outputDirectory, stylesheetPath), css, "utf8");
  }
  return {
    framework: {
      id: framework.host.id,
      capability: framework.host.capability,
      target: framework.host.target,
      protocolVersion: framework.host.protocolVersion,
      apiVersion: framework.host.apiVersion,
      artifactKind: framework.host.artifactKind,
    },
    entryPath,
    stylesheetPath,
    modules: moduleSummary(project),
    dependencies: dependencySummary(project),
    sourceMaps: framework.host.sourceMaps(framework.config),
  };
}

export async function writeProductionManifest(
  outputDirectory: string,
  build: ProductionBuildResult,
  deployment: StaticDeploymentSummary,
): Promise<ProductionBuildManifest> {
  const paths: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name !== PRODUCTION_MANIFEST_NAME) {
        paths.push(path);
        if (paths.length > MAX_PRODUCTION_ASSETS) throw new RangeError(`A production build cannot contain more than ${MAX_PRODUCTION_ASSETS} assets`);
      }
    }
  };
  await visit(outputDirectory);
  const assets: ProductionBuildManifest["assets"][number][] = [];
  for (const path of paths.sort()) {
    const identity = await fileIdentity(path);
    const relativePath = relative(outputDirectory, path).replaceAll("\\", "/");
    assets.push({
      path: relativePath,
      sizeBytes: identity.sizeBytes,
      sha256: identity.sha256,
      role: assetRole(relativePath, build),
    });
  }
  const buildId = createHash("sha256")
    .update(assets.map((asset) => `${asset.path}\0${asset.sha256}`).join("\n"))
    .digest("hex");
  const manifest: ProductionBuildManifest = {
    formatVersion: 3,
    kind: "velar-framework-build",
    framework: build.framework,
    compiler: { name: "velar", version: VELAR_VERSION },
    buildId,
    sourceMaps: build.sourceMaps,
    entry: build.entryPath,
    stylesheet: build.stylesheetPath,
    modules: build.modules,
    dependencies: build.dependencies,
    deployment,
    assets,
  };
  await writeFile(join(outputDirectory, PRODUCTION_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function dependencySummary(project: ProjectResult): ProductionDependencySummary {
  const javascript = new Set<string>();
  for (const module of project.modules) {
    for (const dependency of module.result.dependencies) {
      if (!dependency.javascript || dependency.source.startsWith(".") || dependency.source.startsWith("/")) continue;
      javascript.add(packageNameOf(dependency.source));
    }
  }
  return {
    velar: project.velarPackages.map((item) => item.name).sort(),
    javascript: [...javascript].sort(),
  };
}

function packageNameOf(source: string): string {
  const parts = source.split("/");
  return source.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] ?? source;
}

function moduleSummary(project: ProjectResult): ProductionModuleSummary {
  const packages = project.velarPackages.map((package_) => ({
    name: package_.name,
    modules: project.modules.filter((module) => isWithin(package_.root, module.inputPath)).length,
  })).sort((left, right) => left.name.localeCompare(right.name));
  const packageModules = packages.reduce((total, package_) => total + package_.modules, 0);
  return { total: project.modules.length, application: project.modules.length - packageModules, packages };
}

function isWithin(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !pathFromRoot.startsWith("/"));
}

function assetRole(path: string, build: ProductionBuildResult): ProductionBuildManifest["assets"][number]["role"] {
  if (path === build.entryPath) return "entry";
  if (path === build.stylesheetPath) return "stylesheet";
  if (path === "velar-deploy.json") return "deployment";
  if (path === "_headers" || path === "_redirects") return "adapter";
  if (build.sourceMaps && path.startsWith("assets/") && path.endsWith(".map")) return "source-map";
  if (path.endsWith(".html")) return "html";
  return "asset";
}

function velarModules(project: ProjectResult): Plugin {
  const modulesByPath = new Map<string, ProjectResult["modules"][number]>();
  const embeddedByPath = new Map<string, { readonly module: ProjectResult["modules"][number]; readonly code: string; readonly sourceMap: string }>();
  assertUniqueEmbeddedModuleOutputs(project.modules.map((module) => ({
    ownerPath: module.inputPath.replace(/\.vel$/u, ".js"),
    embeddedModules: module.result.embeddedModules,
  })));
  for (const module of project.modules) {
    modulesByPath.set(resolve(module.inputPath), module);
    try {
      modulesByPath.set(realpathSync(module.inputPath), module);
    } catch {
      // Compilation already reports missing source modules. Keep bundler lookup fail-closed.
    }
    for (const embedded of module.result.embeddedModules) {
      embeddedByPath.set(resolve(embeddedModuleOutputPath(module.inputPath.replace(/\.vel$/u, ".js"), embedded.specifier)), {
        module,
        code: embedded.code,
        sourceMap: embedded.sourceMap,
      });
    }
  }
  const moduleAt = (path: string): ProjectResult["modules"][number] | undefined => modulesByPath.get(resolve(path));
  return {
    name: "velar-modules",
    setup(context) {
      context.onLoad({ filter: /\.vel$/, namespace: "file" }, (arguments_) => {
        const module = moduleAt(arguments_.path);
        if (!module) return { errors: [{ text: `VelarScript module '${arguments_.path}' was not compiled` }] };
        const sourceMap = module.result.sourceMap
          ? `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(module.result.sourceMap).toString("base64")}\n`
          : "";
        return {
          contents: `${module.result.code ?? ""}${sourceMap}`,
          loader: "js",
          resolveDir: dirname(module.inputPath),
        };
      });
      context.onLoad({ filter: /.*/, namespace: "velar-embedded" }, (arguments_) => {
        const embedded = embeddedByPath.get(resolve(arguments_.path));
        if (!embedded) return { errors: [{ text: `Embedded JavaScript module '${arguments_.path}' was not compiled` }] };
        const sourceMap = embedded.sourceMap
          ? `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(embedded.sourceMap).toString("base64")}\n`
          : "";
        return {
          contents: `${embedded.code}${sourceMap}`,
          loader: "js",
          resolveDir: dirname(embedded.module.inputPath),
        };
      });
      context.onResolve({ filter: /^velar\// }, (arguments_) => ({ path: arguments_.path, namespace: "velar-standard" }));
      context.onLoad({ filter: /.*/, namespace: "velar-standard" }, (arguments_) => {
        if (isNodeOnlyModule(arguments_.path)
          && !project.compilerExtensions.some((extension) => extension.id !== "@velarscript/node" && extension.modules?.interfaces.has(arguments_.path))) {
          return { errors: [{ text: nodeModuleDiagnostic(arguments_.path) }] };
        }
        const contents = standardModuleSource(arguments_.path, project.extensionConfig, project.compilerExtensions);
        return contents ? { contents, loader: "js" } : { errors: [{ text: `Unknown VelarScript standard module '${arguments_.path}'` }] };
      });
      context.onResolve({ filter: /^\.\.?\// }, (arguments_) => {
        const sourceModule = moduleAt(arguments_.importer);
        if (!sourceModule || !arguments_.path.endsWith(".js")) return null;
        const embeddedPath = resolve(dirname(sourceModule.inputPath), arguments_.path);
        if (embeddedByPath.has(embeddedPath)) return { path: embeddedPath, namespace: "velar-embedded" };
        const targetPath = resolve(dirname(sourceModule.inputPath), arguments_.path.replace(/\.js$/u, ".vel"));
        const targetModule = moduleAt(targetPath);
        return targetModule ? { path: targetModule.inputPath } : null;
      });
      context.onResolve({ filter: /^[^./]/ }, async (arguments_) => {
        if (arguments_.path.startsWith("velar/")) return null;
        // Package-internal `imports` aliases belong to the importing package's
        // manifest. esbuild already resolves them with browser/import
        // conditions; they are not installed package names.
        if (arguments_.path.startsWith("#")) return null;
        if (arguments_.path.startsWith("node:")) {
          return { errors: [{ text: `Node builtin '${arguments_.path}' cannot run in a browser build` }] };
        }
        try {
          const sourceModule = moduleAt(arguments_.importer) ?? null;
          if (sourceModule) {
            const velarTarget = project.velarImports.get(projectImportKey(sourceModule.inputPath, arguments_.path));
            if (velarTarget) {
              const targetModule = moduleAt(velarTarget);
              if (!targetModule) return { errors: [{ text: `VelarScript package module '${arguments_.path}' was not compiled` }] };
              return { path: targetModule.inputPath };
            }
          }
          const base = sourceModule ? dirname(sourceModule.inputPath) : arguments_.resolveDir || project.projectRoot;
          return { path: await resolveBrowserNpmEntry(arguments_.path, base) };
        } catch (error) {
          return { errors: [{ text: `Cannot resolve browser import '${arguments_.path}': ${hostErrorMessage(error)}` }] };
        }
      });
    },
  };
}
