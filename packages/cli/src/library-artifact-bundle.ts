import { realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { build, type BuildOptions, type OnLoadResult, type OnResolveArgs, type OnResolveResult, type Plugin, type PluginBuild } from "esbuild";
import {
  type LoadedVelarLibraryArtifact,
  type VelarLibraryArtifactJavaScriptSnapshot,
  type VelarLibraryArtifactTarget,
} from "./library-artifact.ts";
import { projectImportKey, type ProjectModule, type ProjectResource, type ProjectResult, type VelarSourcePackage } from "./project.ts";
import { jsonResourceModule } from "./resource-output.ts";
import { isNpmPackageSelfSpecifier } from "./package-name.ts";
import { standardModuleSource } from "./standard-modules.ts";
import type { JavaScriptBuildMode } from "./javascript-output.ts";
import { BROWSER_ESM_PACKAGE_CONDITIONS, NODE_ESM_PACKAGE_CONDITIONS } from "./package-exports.ts";

export interface VelarLibraryBundleEntry {
  readonly key: string;
  readonly inputPath: string;
  readonly outputPath: string;
}

export interface VelarLibraryBundledEntry {
  readonly code: string;
  readonly sourceMap: string;
}

export interface VelarLibraryBundledChunk extends VelarLibraryBundledEntry {
  readonly javascript: string;
  readonly sourceMapPath: string;
}

export interface VelarLibraryMultiEntryBundle {
  readonly entries: ReadonlyMap<string, VelarLibraryBundledEntry>;
  readonly chunks: readonly VelarLibraryBundledChunk[];
}

interface GeneratedBundleEntry extends VelarLibraryBundleEntry {
  readonly generatedOutputPath: string;
}

interface ArtifactBundleGraph {
  readonly modules: ReadonlyMap<string, ProjectModule>;
  readonly portableModules: ReadonlyMap<string, ProjectModule>;
  readonly embedded: ReadonlyMap<string, EmbeddedModule>;
  readonly portableEmbedded: ReadonlyMap<string, EmbeddedModule>;
  readonly resources: ReadonlyMap<string, ProjectResource>;
  readonly portableResources: ReadonlyMap<string, ProjectResource>;
}

interface EmbeddedModule {
  readonly owner: ProjectModule;
  readonly code: string;
  readonly sourceMap: string;
  readonly portablePath: string;
}

/** Bundles the legacy root-only artifact without changing ABI-1 bytes. */
export async function bundleVelarLibraryEntry(
  project: ProjectResult,
  entry: ProjectModule,
  packageName: string,
  target: VelarLibraryArtifactTarget,
  finalJavaScriptPath: string,
  mode: JavaScriptBuildMode,
): Promise<VelarLibraryBundledEntry> {
  if (entry.result.code === null) throw new Error("The VelarScript library entry did not emit JavaScript");
  const result = await build({
    ...libraryBundleOptions(project, entry, packageName, target, mode),
    outfile: finalJavaScriptPath,
    stdin: {
      contents: mappedJavaScript(entry.result.code, entry.result.sourceMap),
      loader: "js",
      resolveDir: dirname(entry.inputPath),
      sourcefile: entry.inputPath,
    },
  });
  const code = result.outputFiles?.find((file) => resolve(file.path) === resolve(finalJavaScriptPath));
  const sourceMap = result.outputFiles?.find((file) => resolve(file.path) === resolve(`${finalJavaScriptPath}.map`));
  if (!code || !sourceMap) throw new Error("The Velar library bundler did not emit JavaScript and its source map");
  return { code: code.text, sourceMap: sourceMap.text };
}

/** One splitting build gives all public entries one shared ESM module graph. */
export async function bundleVelarLibraryEntries(
  projects: readonly ProjectResult[],
  entries: readonly VelarLibraryBundleEntry[],
  packageName: string,
  target: VelarLibraryArtifactTarget,
  outputRoot: string,
  mode: JavaScriptBuildMode,
): Promise<VelarLibraryMultiEntryBundle> {
  if (entries.length === 0) throw new Error("A multi-entry library bundle requires at least one emitted entry");
  const project = mergeLibraryProjects(projects);
  const extensions = new Set(entries.map((entry) => extname(entry.outputPath)));
  if ([...extensions].some((extension) => extension !== ".js" && extension !== ".mjs")) {
    throw new Error("Velar artifact entries must end in .js or .mjs");
  }
  const generatedExtension = extensions.size === 1 && extensions.has(".mjs") ? ".mjs" : ".js";
  const generatedEntries = entries.map((entry, index): GeneratedBundleEntry => ({
    ...entry,
    generatedOutputPath: posix.join(
      posix.dirname(entry.outputPath),
      `__velar_entry_${index}${generatedExtension}`,
    ),
  }));
  const result = await build({
    ...libraryBundleOptions(project, null, packageName, target, mode),
    entryPoints: generatedEntries.map((entry) => ({
      in: entry.inputPath,
      out: entry.generatedOutputPath.slice(0, -generatedExtension.length),
    })),
    entryNames: "[dir]/[name]",
    chunkNames: "__velar_chunks/[name]-[hash]",
    outdir: outputRoot,
    outExtension: { ".js": generatedExtension },
    splitting: true,
  });
  return collectMultiEntryBundle(result.outputFiles ?? [], generatedEntries, outputRoot);
}

function collectMultiEntryBundle(
  outputFiles: readonly { readonly path: string; readonly text: string }[],
  entries: readonly GeneratedBundleEntry[],
  outputRoot: string,
): VelarLibraryMultiEntryBundle {
  const files = new Map(outputFiles.map((file) => [outputPath(outputRoot, file.path), file.text]));
  const bundledEntries = new Map<string, VelarLibraryBundledEntry>();
  const claimed = new Set<string>();
  for (const entry of entries) {
    const code = files.get(entry.generatedOutputPath);
    const sourceMapPath = `${entry.generatedOutputPath}.map`;
    const sourceMap = files.get(sourceMapPath);
    if (code === undefined || sourceMap === undefined) {
      throw new Error(`The Velar library bundler did not emit entry '${entry.outputPath}' and its source map`);
    }
    bundledEntries.set(entry.key, retargetBundledEntry(code, sourceMap, entry));
    claimed.add(entry.generatedOutputPath);
    claimed.add(sourceMapPath);
  }
  const chunks: VelarLibraryBundledChunk[] = [];
  for (const [path, code] of files) {
    if (claimed.has(path) || path.endsWith(".map")) continue;
    const sourceMapPath = `${path}.map`;
    const sourceMap = files.get(sourceMapPath);
    if (!path.startsWith("__velar_chunks/") || sourceMap === undefined) {
      throw new Error(`The Velar library bundler emitted unexpected output '${path}'`);
    }
    claimed.add(path);
    claimed.add(sourceMapPath);
    chunks.push({ javascript: path, sourceMapPath, code, sourceMap });
  }
  const unexpected = [...files.keys()].find((path) => !claimed.has(path));
  if (unexpected) throw new Error(`The Velar library bundler emitted unexpected output '${unexpected}'`);
  chunks.sort((left, right) => left.javascript < right.javascript ? -1 : left.javascript > right.javascript ? 1 : 0);
  return { entries: bundledEntries, chunks };
}

function retargetBundledEntry(
  code: string,
  sourceMap: string,
  entry: GeneratedBundleEntry,
): VelarLibraryBundledEntry {
  const generatedMapName = `${posix.basename(entry.generatedOutputPath)}.map`;
  const outputMapName = `${posix.basename(entry.outputPath)}.map`;
  const marker = `//# sourceMappingURL=${generatedMapName}`;
  const parsed = JSON.parse(sourceMap) as Record<string, unknown>;
  parsed.file = posix.basename(entry.outputPath);
  return {
    code: code.includes(marker) ? code.replace(marker, `//# sourceMappingURL=${outputMapName}`) : code,
    sourceMap: `${JSON.stringify(parsed)}\n`,
  };
}

function outputPath(root: string, path: string): string {
  const output = relative(root, path);
  if (!output || output === ".." || output.startsWith(`..${sep}`) || isAbsolute(output)) {
    throw new Error(`The Velar library bundler emitted outside its output directory: '${path}'`);
  }
  return output.replaceAll("\\", "/");
}

function libraryBundleOptions(
  project: ProjectResult,
  entry: ProjectModule | null,
  packageName: string,
  target: VelarLibraryArtifactTarget,
  mode: JavaScriptBuildMode,
): BuildOptions {
  return {
    absWorkingDir: project.projectRoot,
    bundle: true,
    format: "esm",
    platform: target === "node" ? "node" : "neutral",
    target: target === "node" ? "node24" : "es2022",
    conditions: [...(target === "node" ? NODE_ESM_PACKAGE_CONDITIONS : BROWSER_ESM_PACKAGE_CONDITIONS)],
    minify: mode === "production",
    keepNames: mode === "readable",
    ...(target === "node" ? { define: { require: "globalThis.require" } } : {}),
    sourcemap: "linked",
    sourcesContent: true,
    legalComments: "none",
    logLevel: "silent",
    preserveSymlinks: true,
    write: false,
    plugins: [libraryArtifactPlugin(project, entry, packageName)],
  };
}

function libraryArtifactPlugin(project: ProjectResult, entry: ProjectModule | null, packageName: string): Plugin {
  const graph = artifactBundleGraph(project);
  const resolvingPackageOwnedJavaScript = Symbol("velar-library-package-owned-javascript");
  return {
    name: "velar-library-artifact",
    setup(context) {
      context.onResolve({ filter: /^velar\// }, (arguments_) => ({ path: arguments_.path, namespace: "velar-standard" }));
      context.onLoad({ filter: /.*/, namespace: "velar-standard" }, (arguments_) => {
        const source = standardModuleSource(arguments_.path, project.extensionConfig, project.compilerExtensions);
        return source === null
          ? { errors: [{ text: `Unknown VelarScript standard module '${arguments_.path}'` }] }
          : { contents: source, loader: "js", resolveDir: project.projectRoot };
      });
      context.onLoad({ filter: /\.vel$/, namespace: "file" }, (arguments_) => {
        const path = isAbsolute(arguments_.path) ? resolve(arguments_.path) : resolve(project.projectRoot, arguments_.path);
        const module = graph.modules.get(path);
        return module
          ? loadCompiledModule(module)
          : { errors: [{ text: `VelarScript library entry '${path}' was not present in the checked multi-entry graph (${[...graph.modules.keys()].join(", ")})` }] };
      });
      context.onResolve({ filter: /^\.\.?\// }, (arguments_) => resolveRelativeBundleImport(arguments_, project, graph));
      context.onLoad({ filter: /.*/, namespace: "velar-module" }, (arguments_) => loadCompiledModule(graph.portableModules.get(arguments_.path)));
      context.onLoad({ filter: /.*/, namespace: "velar-embedded" }, (arguments_) => {
        const item = graph.portableEmbedded.get(arguments_.path);
        return item ? {
          contents: mappedJavaScript(item.code, item.sourceMap),
          loader: "js",
          resolveDir: dirname(item.owner.inputPath),
        } : null;
      });
      context.onLoad({ filter: /.*/, namespace: "velar-resource" }, (arguments_) => {
        const resource = graph.portableResources.get(arguments_.path);
        return resource ? { contents: jsonResourceModule(resource.content), loader: "js", resolveDir: dirname(resource.inputPath) } : null;
      });
      context.onResolve({ filter: /^[^./]/ }, async (arguments_) => {
        if (arguments_.pluginData === resolvingPackageOwnedJavaScript) return null;
        if (arguments_.path.startsWith("velar/")) return null;
        // `import js` supports inline data modules. They are not an external
        // runtime owner: esbuild must parse and inline their complete graph so
        // a forged receipt cannot hide an unauthenticated edge in the URL.
        if (arguments_.path.startsWith("data:")) return null;
        return await resolveLibraryBareImport(
          arguments_,
          project,
          entry,
          packageName,
          graph,
          context,
          resolvingPackageOwnedJavaScript,
        );
      });
    },
  };
}

function artifactBundleGraph(project: ProjectResult): ArtifactBundleGraph {
  const modules = new Map(project.modules.map((module) => [resolve(module.inputPath), module]));
  const portableModules = new Map(project.modules.map((module) => [portableBundlePath(project, module.inputPath), module]));
  const embedded = new Map<string, EmbeddedModule>();
  const portableEmbedded = new Map<string, EmbeddedModule>();
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
  return { modules, portableModules, embedded, portableEmbedded, resources, portableResources };
}

function loadCompiledModule(module: ProjectModule | undefined): OnLoadResult | null {
  return module?.result.code ? {
    contents: mappedJavaScript(module.result.code, module.result.sourceMap),
    loader: "js",
    resolveDir: dirname(module.inputPath),
  } : module ? { errors: [{ text: `VelarScript module '${module.inputPath}' was not compiled` }] } : null;
}

function resolveRelativeBundleImport(
  arguments_: OnResolveArgs,
  project: ProjectResult,
  graph: ArtifactBundleGraph,
): OnResolveResult | null {
  const path = resolve(arguments_.resolveDir, arguments_.path);
  const embedded = graph.embedded.get(path);
  if (embedded) return { path: embedded.portablePath, namespace: "velar-embedded" };
  if (arguments_.path.endsWith(".json.js")) {
    const resourcePath = resolve(arguments_.resolveDir, arguments_.path.slice(0, -3));
    if (graph.resources.has(resourcePath)) return { path: portableBundlePath(project, resourcePath), namespace: "velar-resource" };
  }
  if (arguments_.path.endsWith(".js")) {
    const modulePath = resolve(arguments_.resolveDir, arguments_.path.replace(/\.js$/u, ".vel"));
    if (graph.modules.has(modulePath)) return { path: portableBundlePath(project, modulePath), namespace: "velar-module" };
  }
  return null;
}

async function resolveLibraryBareImport(
  arguments_: OnResolveArgs,
  project: ProjectResult,
  entry: ProjectModule | null,
  packageName: string,
  graph: ArtifactBundleGraph,
  context: PluginBuild,
  resolvingPackageOwnedJavaScript: symbol,
): Promise<OnResolveResult | null> {
  const importer = libraryImporterPath(arguments_, project, entry, graph);
  if (importer !== undefined) {
    const key = projectImportKey(importer, arguments_.path);
    const sourcePath = project.velarImports.get(key);
    if (sourcePath !== undefined) {
      const module = graph.modules.get(resolve(sourcePath));
      return module
        ? { path: portableBundlePath(project, module.inputPath), namespace: "velar-module" }
        : { errors: [{ text: `VelarScript package module '${arguments_.path}' was not compiled` }] };
    }
    const resource = project.resourceImports.get(key);
    if (resource !== undefined) {
      const path = portableBundlePath(project, resource.inputPath);
      return graph.portableResources.has(path)
        ? { path, namespace: "velar-resource" }
        : { errors: [{ text: `VelarScript package resource '${arguments_.path}' was not loaded` }] };
    }
    if (project.velarArtifactImports.has(key)) {
      // The artifact loader has already authenticated the entry and its complete
      // relative module closure. Keep the package import external so Node still
      // resolves B's ordinary npm dependencies from B, rather than flattening
      // them into this newly published package's ownership boundary.
      return { path: arguments_.path, external: true };
    }
    const owner = velarPackageOwner(project, importer);
    if (owner && resolve(owner.root) !== resolve(project.projectRoot)) return null;
    if (arguments_.path.startsWith("#") || isNpmPackageSelfSpecifier(arguments_.path, packageName)) {
      return await resolvePackageOwnedJavaScript(
        arguments_,
        importer,
        project.projectRoot,
        packageName,
        context,
        resolvingPackageOwnedJavaScript,
      );
    }
  }
  return { path: arguments_.path, external: true };
}

async function resolvePackageOwnedJavaScript(
  arguments_: OnResolveArgs,
  importer: string,
  packageRoot: string,
  packageName: string,
  context: PluginBuild,
  marker: symbol,
): Promise<OnResolveResult> {
  const resolved = await context.resolve(arguments_.path, {
    importer,
    resolveDir: dirname(importer),
    namespace: "file",
    kind: arguments_.kind,
    pluginData: marker,
    with: arguments_.with,
  });
  if (resolved.errors.length > 0) return resolved;
  if (!resolved.external && resolved.namespace === "file"
    && await packageOwnsJavaScriptPath(packageRoot, resolved.path)) return resolved;
  if (!isNpmPackageSelfSpecifier(arguments_.path, packageName)) {
    return { path: arguments_.path, external: true, warnings: resolved.warnings };
  }
  return {
    errors: [{ text: `Package self JavaScript import '${arguments_.path}' must resolve to a file owned by '${packageName}'` }],
    warnings: resolved.warnings,
  };
}

async function packageOwnsJavaScriptPath(packageRoot: string, path: string): Promise<boolean> {
  const lexical = relative(packageRoot, path);
  if (escapesRoot(lexical) || lexical.split(sep).includes("node_modules")) return false;
  const [rootIdentity, pathIdentity] = await Promise.all([realpath(packageRoot), realpath(path)]);
  return !escapesRoot(relative(rootIdentity, pathIdentity));
}

function escapesRoot(path: string): boolean {
  return path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

function libraryImporterPath(
  arguments_: OnResolveArgs,
  project: ProjectResult,
  entry: ProjectModule | null,
  graph: ArtifactBundleGraph,
): string | undefined {
  if (arguments_.importer === "" || arguments_.importer === "<stdin>") return entry?.inputPath;
  return graph.portableModules.get(arguments_.importer)?.inputPath
    ?? graph.portableEmbedded.get(arguments_.importer)?.owner.inputPath
    ?? graph.modules.get(isAbsolute(arguments_.importer)
      ? resolve(arguments_.importer)
      : resolve(project.projectRoot, arguments_.importer))?.inputPath
    ?? (arguments_.namespace === "file" && isAbsolute(arguments_.importer) ? resolve(arguments_.importer) : undefined);
}

function mappedJavaScript(code: string, sourceMap: string | null): string {
  if (!sourceMap) return code;
  return `${code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(sourceMap).toString("base64")}\n`;
}

function portableBundlePath(project: ProjectResult, path: string): string {
  const owner = velarPackageOwner(project, path);
  if (owner && resolve(owner.root) !== resolve(project.projectRoot)) {
    return `__velar_packages__/${owner.name}/${relative(owner.root, path).replaceAll("\\", "/")}`;
  }
  if (inside(project.projectRoot, path)) return relative(project.projectRoot, path).replaceAll("\\", "/");
  if (owner) return `__velar_packages__/${owner.name}/${relative(owner.root, path).replaceAll("\\", "/")}`;
  throw new Error(`Library bundle input '${path}' is outside the project and its declared VelarScript packages`);
}

function mergeLibraryProjects(projects: readonly ProjectResult[]): ProjectResult {
  const unique = [...new Set(projects)];
  const first = unique[0];
  if (!first) throw new Error("A Velar library bundle requires at least one checked project");
  const modules = new Map<string, ProjectModule>();
  const resources = new Map<string, ProjectResource>();
  const packages = new Map<string, VelarSourcePackage>();
  for (const project of unique) mergeProjectGraph(project, modules, resources, packages);
  return {
    ...first,
    executionEntries: new Set(unique.flatMap((project) => [...project.executionEntries])),
    modules: [...modules.values()],
    moduleInterfaces: mergeMaps(unique.map((project) => project.moduleInterfaces)),
    failures: unique.flatMap((project) => project.failures),
    notices: unique.flatMap((project) => project.notices),
    velarPackages: [...packages.values()],
    velarImports: mergeMaps(unique.map((project) => project.velarImports), (value) => value),
    velarArtifactInterfaces: mergeMaps(unique.map((project) => project.velarArtifactInterfaces)),
    velarArtifactImports: mergeArtifactImportMaps(unique.map((project) => project.velarArtifactImports)),
    resources: [...resources.values()],
    resourceImports: mergeMaps(unique.map((project) => project.resourceImports), (value) => value.inputPath),
    externalTypeDependencies: mergeDependencyMaps(unique.map((project) => project.externalTypeDependencies)),
  };
}

function mergeArtifactImportMaps(
  maps: readonly ReadonlyMap<string, LoadedVelarLibraryArtifact>[],
): ReadonlyMap<string, LoadedVelarLibraryArtifact> {
  const output = new Map<string, LoadedVelarLibraryArtifact>();
  for (const map of maps) {
    for (const [key, artifact] of map) {
      const existing = output.get(key);
      if (existing && !sameLoadedArtifact(existing, artifact)) {
        throw new Error(`Checked library entries resolved '${key}' to different verified artifact snapshots`);
      }
      if (!existing) output.set(key, artifact);
    }
  }
  return output;
}

function sameLoadedArtifact(left: LoadedVelarLibraryArtifact, right: LoadedVelarLibraryArtifact): boolean {
  return resolve(left.receiptPath) === resolve(right.receiptPath)
    && left.target === right.target
    && left.subpath === right.subpath
    && sameArtifactSnapshot(left.entrySnapshot, right.entrySnapshot)
    && left.entrySnapshots.length === right.entrySnapshots.length
    && left.entrySnapshots.every((snapshot, index) => sameArtifactSnapshot(snapshot, right.entrySnapshots[index]!))
    && left.chunkSnapshots.length === right.chunkSnapshots.length
    && left.chunkSnapshots.every((snapshot, index) => sameArtifactSnapshot(snapshot, right.chunkSnapshots[index]!));
}

function sameArtifactSnapshot(
  left: VelarLibraryArtifactJavaScriptSnapshot,
  right: VelarLibraryArtifactJavaScriptSnapshot,
): boolean {
  return left.path === right.path
    && left.code === right.code
    && left.sourceMapPath === right.sourceMapPath
    && left.sourceMap === right.sourceMap;
}

function mergeProjectGraph(
  project: ProjectResult,
  modules: Map<string, ProjectModule>,
  resources: Map<string, ProjectResource>,
  packages: Map<string, VelarSourcePackage>,
): void {
  for (const module of project.modules) {
    const key = resolve(module.inputPath);
    const existing = modules.get(key);
    if (existing && (existing.result.source.text !== module.result.source.text || existing.result.code !== module.result.code)) {
      throw new Error(`Library source '${module.inputPath}' changed between entry compilations`);
    }
    modules.set(key, existing ?? module);
  }
  for (const resource of project.resources) {
    const key = resolve(resource.inputPath);
    const existing = resources.get(key);
    if (existing && existing.content !== resource.content) throw new Error(`Library resource '${resource.inputPath}' changed between entry compilations`);
    resources.set(key, existing ?? resource);
  }
  for (const package_ of project.velarPackages) mergeProjectPackage(packages, package_);
}

function mergeProjectPackage(packages: Map<string, VelarSourcePackage>, package_: VelarSourcePackage): void {
  const existing = packages.get(package_.name);
  if (existing && resolve(existing.root) !== resolve(package_.root)) {
    throw new Error(`VelarScript package '${package_.name}' resolves to multiple installed versions across library entries`);
  }
  if (!existing) {
    packages.set(package_.name, package_);
    return;
  }
  const artifacts = new Map(existing.artifacts);
  for (const [subpath, artifact] of package_.artifacts) artifacts.set(subpath, artifact);
  packages.set(package_.name, artifacts.size === existing.artifacts.size ? existing : { ...existing, artifacts });
}

function mergeMaps<K, V>(
  maps: readonly ReadonlyMap<K, V>[],
  identity?: (value: V) => unknown,
): ReadonlyMap<K, V> {
  const output = new Map<K, V>();
  for (const map of maps) {
    for (const [key, value] of map) {
      const existing = output.get(key);
      if (existing !== undefined && identity && identity(existing) !== identity(value)) {
        throw new Error(`Checked library entries resolved '${String(key)}' inconsistently`);
      }
      if (existing === undefined) output.set(key, value);
    }
  }
  return output;
}

function mergeDependencyMaps(
  maps: readonly ReadonlyMap<string, ReadonlySet<string>>[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const output = new Map<string, Set<string>>();
  for (const map of maps) {
    for (const [path, importers] of map) {
      const merged = output.get(path) ?? new Set<string>();
      for (const importer of importers) merged.add(importer);
      output.set(path, merged);
    }
  }
  return output;
}

export function velarPackageOwner(project: ProjectResult, path: string): VelarSourcePackage | null {
  let owner: VelarSourcePackage | null = null;
  for (const candidate of project.velarPackages) {
    if (inside(candidate.root, path) && (!owner || candidate.root.length > owner.root.length)) owner = candidate;
  }
  return owner;
}

function inside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}
