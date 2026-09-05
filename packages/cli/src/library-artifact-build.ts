import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BUILD_STAGING_MARKER } from "./build-staging.ts";
import { canonicalizePotentialPath } from "./canonical-path.ts";
import type { VelarProjectConfig } from "./config.ts";
import {
  encodeVelarLibraryInterface,
  packageStableModulePath,
  rebaseModuleInterfaceIdentities,
  sha256Text,
  type VelarLibraryArtifactChunkReceipt,
  type VelarLibraryArtifactReceipt,
  type VelarLibraryArtifactEntryReceipt,
  type VelarLibraryArtifactTarget,
} from "./library-artifact.ts";
import { bundleVelarLibraryEntries, bundleVelarLibraryEntry, velarPackageOwner } from "./library-artifact-bundle.ts";
import { validateVelarLibraryArtifactReceipt } from "./library-artifact-receipt.ts";
import { assertVelarLibraryArtifactModuleClosure } from "./library-artifact-module-closure.ts";
import type { VelarLibraryArtifactJavaScriptSnapshot } from "./library-artifact-snapshot.ts";
import type { VelarPackageSubpath } from "./package-entry.ts";
import { packageRuntimeExportTargets } from "./package-exports.ts";
import { nearestPackageTypeOutsideOutput } from "./package-scope.ts";
import { assertArtifactRuntimeDependencies } from "./package-runtime-dependencies.ts";
import { assertPortableArtifactPath, portableArtifactPathKey } from "./portable-artifact-path.ts";
import type { ProjectResult } from "./project.ts";
import { checkResolvedProject, formatCheckOutput } from "./project-check.ts";
import { projectPackageTarget } from "./project-package-target.ts";
import {
  canonicalVelarPackageEntryPaths,
  assertVelarPackageTargetCapabilities,
  parseVelarSourcePackageManifest,
  type VelarPackageEntry,
  type VelarPackageResource,
} from "./source-package-manifest.ts";
import { VELAR_VERSION } from "./version.ts";
import type { JavaScriptBuildMode } from "./javascript-output.ts";

const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const PACKAGE_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

interface GeneratedArtifactClaim {
  readonly path: string;
  readonly sourceEntry: string;
  readonly subpath: VelarPackageSubpath;
}

export interface VelarLibraryBuildConfig {
  readonly project: VelarProjectConfig;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly sourceEntry: string;
  readonly target: VelarLibraryArtifactTarget;
  readonly receiptPath: string;
  readonly outputRoot: string;
  readonly entries: ReadonlyMap<VelarPackageSubpath, VelarLibraryBuildEntry>;
  readonly resources: readonly VelarPackageResource[];
  readonly runtimeDependencies: ReadonlySet<string>;
}

export interface VelarLibraryBuildEntry {
  readonly subpath: VelarPackageSubpath;
  readonly sourceEntry: string;
  readonly entryPath: string;
  readonly javascript: string;
  readonly sourceMap: string;
  readonly interface: string;
}

export interface WrittenVelarLibraryArtifact {
  readonly receipt: VelarLibraryArtifactReceipt;
  readonly outputRoot: string;
}

export interface CheckedVelarLibraryEntries {
  readonly projects: ReadonlyMap<VelarPackageSubpath, ProjectResult>;
  readonly output: string;
  readonly failed: boolean;
}

interface LibraryBuildEntryResolution {
  readonly packagePath: string;
  readonly packageRoot: string;
  readonly outputRoot: string;
  readonly canonicalOutputRoot: string;
  readonly sourceManifest: ReturnType<typeof parseVelarSourcePackageManifest>;
  readonly canonicalEntries: ReadonlyMap<VelarPackageSubpath, string>;
  readonly exports: unknown;
  readonly target: VelarLibraryArtifactTarget;
}

/** Checks every independently reachable public entry without widening its emitted graph. */
export async function checkVelarLibraryEntries(
  library: VelarLibraryBuildConfig,
  input: string | null,
): Promise<CheckedVelarLibraryEntries> {
  const projects = new Map<VelarPackageSubpath, ProjectResult>();
  const checkedEntries = new Map<string, ProjectResult>();
  let output = "";
  for (const [subpath, entry] of library.entries) {
    const key = `${entry.entryPath}\0${entry.javascript}\0${library.target}`;
    const existing = checkedEntries.get(key);
    if (existing) {
      projects.set(subpath, existing);
      continue;
    }
    const config = { ...library.project, entryPath: entry.entryPath };
    const checked = await checkResolvedProject(
      config,
      subpath === "." ? input ?? config.root : entry.entryPath,
      { sourceRoot: config.root, packageTarget: library.target },
    );
    output += formatCheckOutput(checked);
    if (checked.errors.length > 0) return { projects, output, failed: true };
    projects.set(subpath, checked.project);
    checkedEntries.set(key, checked.project);
  }
  return { projects, output, failed: false };
}

export async function resolveVelarLibraryBuild(config: VelarProjectConfig): Promise<VelarLibraryBuildConfig> {
  if (config.kind !== "library") throw new Error("velar.json 'kind' must be 'library' to build a library artifact");
  const packagePath = join(config.root, "package.json");
  const source = await readFile(packagePath, "utf8");
  if (Buffer.byteLength(source, "utf8") > MAX_PACKAGE_MANIFEST_BYTES) throw new RangeError(`${packagePath} exceeds ${MAX_PACKAGE_MANIFEST_BYTES} bytes`);
  const manifest = JSON.parse(source) as Record<string, unknown>;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${packagePath} must contain a JSON object`);
  if (typeof manifest.name !== "string" || !PACKAGE_NAME.test(manifest.name)) throw new Error(`${packagePath}: a library artifact requires a valid package name`);
  if (typeof manifest.version !== "string" || !PACKAGE_VERSION.test(manifest.version)) throw new Error(`${packagePath}: a library artifact requires a semantic package version`);
  const sourceManifest = parseVelarSourcePackageManifest(manifest.name, config.root, manifest);
  const rootEntry = sourceManifest.entries.get(".")!;
  const sourceEntry = rootEntry.relativePath;
  const entryPath = rootEntry.inputPath;
  const target = projectPackageTarget(config);
  if (target === "web" || target === "desktop") {
    throw new Error("Velar library ABI 1 supports Core and Node libraries; Web/Desktop libraries require the shared Web runtime ABI");
  }
  const capabilities = new Set(config.compilerExtensions.flatMap((extension) => extension.capabilities ?? []));
  assertVelarPackageTargetCapabilities(sourceManifest, target, capabilities);
  if (sourceManifest.artifactDescriptors.size !== 1 || !sourceManifest.artifactDescriptors.has(target)) {
    throw new Error(`${packagePath}: Velar library ABI 1 requires exactly one '${target}' artifact per package`);
  }
  const descriptor = sourceManifest.artifactDescriptors.get(target)!;
  if (!descriptor.endsWith(".json")) throw new Error(`${packagePath}#velar.artifacts.${target} must point to a .json receipt`);
  const receiptPath = resolve(config.root, ...descriptor.split("/"));
  const outputRoot = dirname(receiptPath);
  const outputFromRoot = relative(config.root, outputRoot);
  if (!outputFromRoot || outputFromRoot.startsWith("..") || isAbsolute(outputFromRoot)) throw new Error(`${packagePath}#velar.artifacts.${target} escapes the package root`);
  if (resolve(outputRoot) !== resolve(config.outDir)) {
    throw new Error(`${packagePath}#velar.artifacts.${target} must live directly in the velar.json outDir so library builds cannot replace a source or unrelated directory`);
  }
  const exports = manifest.exports;
  const [canonicalEntries, canonicalPackageRoot, canonicalOutputRoot] = await Promise.all([
    canonicalVelarPackageEntryPaths(manifest.name, config.root, sourceManifest.entries),
    canonicalizePotentialPath(config.root),
    canonicalizePotentialPath(outputRoot),
  ]);
  if (outputRelativePath(canonicalPackageRoot, canonicalOutputRoot) === null
    || canonicalOutputRoot === canonicalPackageRoot) {
    throw new Error(`${packagePath}#velar.artifacts.${target} resolves outside the package root through velar.json 'outDir'`);
  }
  const { entries, outputClaims } = resolveLibraryBuildEntries({
    packagePath,
    packageRoot: config.root,
    outputRoot,
    canonicalOutputRoot,
    sourceManifest,
    canonicalEntries,
    exports,
    target,
  });
  if (entries.size === 1 && entries.get(".")?.javascript !== "index.js") {
    throw new Error(`${packagePath}: a formatVersion 1 library artifact must expose './${relative(config.root, join(outputRoot, "index.js")).replaceAll("\\", "/")}'`);
  }
  if ([...entries.values()].some((entry) => entry.javascript.endsWith(".js"))
    && await nearestPackageTypeOutsideOutput(config.root, outputRoot, "Velar library output") !== "module") {
    const remedy = entries.size === 1
      ? "formatVersion 1 always exports index.js"
      : "use .mjs for every ESM entry instead";
    throw new Error(`${packagePath}: package.json 'type' must be 'module' in the nearest surviving package scope when a Velar library artifact exports .js; ${remedy}`);
  }
  const receiptFromOutput = relative(outputRoot, receiptPath).replaceAll("\\", "/");
  assertAvailableGeneratedPath(receiptFromOutput, `${packagePath}#velar.artifacts.${target}`);
  const receiptKey = portableArtifactPathKey(receiptFromOutput);
  if (outputClaims.has(receiptKey)) {
    throw new Error(`${packagePath}#velar.artifacts.${target} conflicts with generated artifact file '${receiptFromOutput}'`);
  }
  const receiptHierarchy = generatedPathHierarchyConflict(outputClaims, receiptKey);
  if (receiptHierarchy) {
    throw new Error(`${packagePath}#velar.artifacts.${target} path '${receiptFromOutput}' conflicts hierarchically with generated artifact '${receiptHierarchy.path}'`);
  }
  const generatedPaths = new Map([...outputClaims].map(([key, claim]) => [key, claim.path]));
  generatedPaths.set(receiptKey, receiptFromOutput);
  await assertPackageFilesSurviveOutputReplacement(
    config.root,
    outputRoot,
    canonicalOutputRoot,
    packagePath,
    sourceManifest.resources,
    exports,
    generatedPaths,
  );
  return {
    project: { ...config, entryPath },
    packageName: manifest.name,
    packageVersion: manifest.version,
    sourceEntry,
    target,
    receiptPath,
    outputRoot,
    entries,
    resources: sourceManifest.resources,
    runtimeDependencies: sourceManifest.runtimeDependencies,
  };
}

function resolveLibraryBuildEntries(
  resolution: LibraryBuildEntryResolution,
): { readonly entries: ReadonlyMap<VelarPackageSubpath, VelarLibraryBuildEntry>; readonly outputClaims: ReadonlyMap<string, GeneratedArtifactClaim> } {
  const entries = new Map<VelarPackageSubpath, VelarLibraryBuildEntry>();
  const outputClaims = new Map<string, GeneratedArtifactClaim>();
  const sourceOutputs = new Map<string, { readonly sourceEntry: string; readonly javascript: string; readonly subpath: VelarPackageSubpath }>();
  for (const [subpath, declaredEntry] of orderedEntries(resolution.sourceManifest.entries)) {
    const sourceEntry = declaredEntry.relativePath;
    const entryLabel = subpath === "."
      ? `${resolution.packagePath}#velar.entry`
      : `${resolution.packagePath}#velar.entries[${JSON.stringify(subpath)}]`;
    if (declaredEntry.inputPath === resolution.outputRoot || inside(resolution.outputRoot, declaredEntry.inputPath)) {
      throw new Error(`${entryLabel} cannot be inside velar.json 'outDir'; build-library replaces that directory`);
    }
    const sourceIdentity = resolution.canonicalEntries.get(subpath)!;
    if (outputRelativePath(resolution.canonicalOutputRoot, sourceIdentity) !== null) {
      throw new Error(`${entryLabel} resolves inside velar.json 'outDir'; build-library replaces that directory`);
    }
    const runtimeTargets = packageRuntimeExportTargets(resolution.exports, subpath, resolution.target);
    if (runtimeTargets.length === 0 || runtimeTargets.some((item) => item !== runtimeTargets[0])) {
      throw new Error(`${resolution.packagePath}: package.json 'exports' must route Velar entry '${subpath}' to one ESM JavaScript file on every supported runtime`);
    }
    const outputPath = resolve(resolution.packageRoot, ...runtimeTargets[0]!.slice(2).split("/"));
    const fromOutput = relative(resolution.outputRoot, outputPath);
    if (!fromOutput || fromOutput.startsWith("..") || isAbsolute(fromOutput)) {
      throw new Error(`${resolution.packagePath}#exports.${subpath} must stay inside the velar.json outDir`);
    }
    const javascript = fromOutput.replaceAll("\\", "/");
    const sourceKey = portableArtifactPathKey(sourceIdentity);
    const priorOutput = sourceOutputs.get(sourceKey);
    if (priorOutput && priorOutput.javascript !== javascript) {
      throw new Error(`${resolution.packagePath}: Velar entries '${priorOutput.subpath}' and '${subpath}' alias source '${sourceEntry}' with different JavaScript outputs`);
    }
    sourceOutputs.set(sourceKey, { sourceEntry, javascript, subpath });
    const stem = javascript.replace(/\.(?:m?js)$/u, "");
    for (const path of [javascript, `${javascript}.map`, `${stem}.veli.json`]) {
      claimGeneratedArtifactPath(outputClaims, path, sourceEntry, subpath, resolution.packagePath);
    }
    entries.set(subpath, {
      subpath,
      sourceEntry,
      entryPath: declaredEntry.inputPath,
      javascript,
      sourceMap: `${javascript}.map`,
      interface: `${stem}.veli.json`,
    });
  }
  return { entries, outputClaims };
}

function claimGeneratedArtifactPath(
  outputClaims: Map<string, GeneratedArtifactClaim>,
  path: string,
  sourceEntry: string,
  subpath: VelarPackageSubpath,
  packagePath: string,
): void {
  assertAvailableGeneratedPath(path, `${packagePath}#exports.${subpath}`);
  const key = portableArtifactPathKey(path);
  const claimed = outputClaims.get(key);
  if (claimed && (claimed.sourceEntry !== sourceEntry || claimed.path !== path)) {
    throw new Error(`${packagePath}: Velar entries '${claimed.subpath}' and '${subpath}' generate conflicting portable artifact paths '${claimed.path}' and '${path}'`);
  }
  const hierarchy = generatedPathHierarchyConflict(outputClaims, key);
  if (hierarchy) {
    throw new Error(`${packagePath}: generated artifact paths '${hierarchy.path}' and '${path}' cannot be both a file and an ancestor directory`);
  }
  outputClaims.set(key, { path, sourceEntry, subpath });
}

export async function writeVelarLibraryArtifact(
  buildConfig: VelarLibraryBuildConfig,
  projects: ReadonlyMap<VelarPackageSubpath, ProjectResult> | ProjectResult,
  stagingRoot: string,
  mode: JavaScriptBuildMode = "production",
): Promise<WrittenVelarLibraryArtifact> {
  const resolvedProjects: ReadonlyMap<VelarPackageSubpath, ProjectResult> = "modules" in projects
    ? new Map([[".", projects]])
    : projects;
  if (resolvedProjects.size !== buildConfig.entries.size
    || [...buildConfig.entries.keys()].some((subpath) => !resolvedProjects.has(subpath))) {
    throw new Error("Cannot write a library artifact without one checked project for every declared package entry");
  }
  await assertCheckedLibrarySourcesSurviveOutputReplacement(buildConfig, resolvedProjects);
  assertCheckedLibraryResourcesDeclared(buildConfig, resolvedProjects);
  const outputs = new Map<string, string>();
  const sources = new Map<string, string>();
  for (const [subpath, entryConfig] of buildConfig.entries) {
    const project = resolvedProjects.get(subpath)!;
    assertBuildableEntryProject(project, entryConfig);
  }
  const built = buildConfig.entries.size === 1
    ? {
        receipts: {
          ".": await buildLibraryEntry(buildConfig, buildConfig.entries.get(".")!, resolvedProjects.get(".")!, mode, outputs, sources),
        },
        chunks: [] as readonly VelarLibraryArtifactChunkReceipt[],
      }
    : await buildMultiEntryLibrary(buildConfig, resolvedProjects, mode, outputs, sources);
  const sourceList = [...sources]
    .map(([path, sha256]) => ({ path, sha256 }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (sourceList.length === 0) throw new Error("The VelarScript library artifact has no package-owned source modules");
  const root = built.receipts["."]!;
  const common = {
    kind: "velar-library-artifact" as const,
    abiVersion: 1 as const,
    package: { name: buildConfig.packageName, version: buildConfig.packageVersion },
    target: buildConfig.target,
    compilerVersion: VELAR_VERSION,
    sources: sourceList,
  };
  const receipt: VelarLibraryArtifactReceipt = buildConfig.entries.size === 1
    ? {
        formatVersion: 1,
        kind: common.kind,
        abiVersion: common.abiVersion,
        package: common.package,
        target: common.target,
        compilerVersion: common.compilerVersion,
        sourceEntry: root.sourceEntry,
        sources: sourceList,
        entry: {
          javascript: root.javascript,
          sourceMap: root.sourceMap,
          interface: root.interface,
          sha256: root.sha256,
        },
      }
    : { formatVersion: 2, ...common, entries: built.receipts, chunks: built.chunks };
  validateVelarLibraryArtifactReceipt(receipt);
  await assertGeneratedArtifactModuleClosure(buildConfig, receipt, outputs);
  const receiptOutput = relative(buildConfig.outputRoot, buildConfig.receiptPath).replaceAll("\\", "/");
  outputs.set(receiptOutput, `${JSON.stringify(receipt, null, 2)}\n`);
  await Promise.all([...outputs].map(async ([path, text]) => {
    const output = join(stagingRoot, ...path.split("/"));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, text, "utf8");
  }));
  return { receipt, outputRoot: buildConfig.outputRoot };
}

async function assertGeneratedArtifactModuleClosure(
  buildConfig: VelarLibraryBuildConfig,
  receipt: VelarLibraryArtifactReceipt,
  outputs: ReadonlyMap<string, string>,
): Promise<void> {
  const declared = receipt.formatVersion === 1
    ? [{ javascript: receipt.entry.javascript, sourceMap: receipt.entry.sourceMap }]
    : [
        ...Object.values(receipt.entries).map((entry) => ({ javascript: entry.javascript, sourceMap: entry.sourceMap })),
        ...receipt.chunks,
      ];
  const files = [...new Map(declared.map((file) => [file.javascript, file])).values()];
  const snapshots = files.map((file): VelarLibraryArtifactJavaScriptSnapshot => {
    const code = outputs.get(file.javascript), sourceMap = outputs.get(file.sourceMap);
    if (code === undefined || sourceMap === undefined) {
      throw new Error(`Generated artifact module '${file.javascript}' is missing its JavaScript or source map output`);
    }
    return {
      path: join(buildConfig.outputRoot, ...file.javascript.split("/")),
      code,
      sourceMapPath: join(buildConfig.outputRoot, ...file.sourceMap.split("/")),
      sourceMap,
    };
  });
  const external = assertVelarLibraryArtifactModuleClosure(snapshots, buildConfig.packageName, buildConfig.target);
  await assertArtifactRuntimeDependencies(
    external,
    buildConfig.runtimeDependencies,
    buildConfig.project.root,
    buildConfig.packageName,
    buildConfig.target,
  );
}

function assertCheckedLibraryResourcesDeclared(
  buildConfig: VelarLibraryBuildConfig,
  projects: ReadonlyMap<VelarPackageSubpath, ProjectResult>,
): void {
  const declared = new Set(buildConfig.resources.map((resource) => resource.relativePath));
  for (const project of projects.values()) {
    for (const resource of project.resources) {
      if (!resource.source.startsWith(".")
        || !moduleBelongsToLibrary(buildConfig, project, resource.importerPath)) continue;
      const path = relative(buildConfig.project.root, resource.inputPath).replaceAll("\\", "/");
      if (!declared.has(path)) {
        throw new Error(`VelarScript package '${buildConfig.packageName}' must declare '${path}' in package.json#velar.resources`);
      }
    }
  }
}

async function assertCheckedLibrarySourcesSurviveOutputReplacement(
  buildConfig: VelarLibraryBuildConfig,
  projects: ReadonlyMap<VelarPackageSubpath, ProjectResult>,
): Promise<void> {
  const canonicalOutputRoot = await canonicalizePotentialPath(buildConfig.outputRoot);
  const checked = new Set<string>();
  for (const project of projects.values()) {
    for (const module of project.modules) {
      const sourcePath = resolve(module.inputPath);
      if (checked.has(sourcePath)
        || !sourcePath.endsWith(".vel")
        || !moduleBelongsToLibrary(buildConfig, project, sourcePath)) continue;
      checked.add(sourcePath);
      const source = relative(buildConfig.project.root, sourcePath).replaceAll("\\", "/");
      if (outputRelativePath(buildConfig.outputRoot, sourcePath) !== null) {
        throw new Error(`Library source '${source}' cannot be inside velar.json 'outDir'; build-library replaces that directory`);
      }
      const canonicalSource = await canonicalizePotentialPath(sourcePath);
      if (outputRelativePath(canonicalOutputRoot, canonicalSource) !== null) {
        throw new Error(`Library source '${source}' resolves inside velar.json 'outDir'; build-library replaces that directory`);
      }
    }
  }
}

function assertBuildableEntryProject(project: ProjectResult, entry: VelarLibraryBuildEntry): void {
  if (project.entryPath !== entry.entryPath) {
    throw new Error(`Checked project entry '${project.entryPath}' does not match package entry '${entry.sourceEntry}'`);
  }
  if (project.failures.length > 0) throw new Error(`Cannot write library entry '${entry.subpath}' from a project with resolution failures`);
  const diagnostics = project.modules.flatMap((module) => module.result.diagnostics);
  if (diagnostics.length > 0) throw new Error(`Cannot write library entry '${entry.subpath}' from a project with compiler diagnostics`);
  const module = project.modules.find((candidate) => candidate.inputPath === entry.entryPath);
  if (!module?.result.code) throw new Error(`VelarScript library entry '${entry.subpath}' did not emit JavaScript`);
}

async function buildLibraryEntry(
  buildConfig: VelarLibraryBuildConfig,
  entryConfig: VelarLibraryBuildEntry,
  project: ProjectResult,
  mode: JavaScriptBuildMode,
  outputs: Map<string, string>,
  sources: Map<string, string>,
): Promise<VelarLibraryArtifactEntryReceipt> {
  const entry = project.modules.find((module) => module.inputPath === entryConfig.entryPath)!;
  const finalJavaScriptPath = join(buildConfig.outputRoot, ...entryConfig.javascript.split("/"));
  const bundled = await bundleVelarLibraryEntry(
    project,
    entry,
    buildConfig.packageName,
    buildConfig.target,
    finalJavaScriptPath,
    mode,
  );
  return writeLibraryEntryReceipt(buildConfig, entryConfig, project, bundled, outputs, sources);
}

function writeLibraryEntryReceipt(
  buildConfig: VelarLibraryBuildConfig,
  entryConfig: VelarLibraryBuildEntry,
  project: ProjectResult,
  bundled: { readonly code: string; readonly sourceMap: string },
  outputs: Map<string, string>,
  sources: Map<string, string>,
): VelarLibraryArtifactEntryReceipt {
  const entry = project.modules.find((module) => module.inputPath === entryConfig.entryPath)!;
  const finalJavaScriptPath = join(buildConfig.outputRoot, ...entryConfig.javascript.split("/"));
  const interface_ = project.moduleInterfaces.get(entry.inputPath) ?? entry.result.moduleInterface;
  const replacements = identityReplacements(buildConfig, project);
  const interfaceText = encodeVelarLibraryInterface(rebaseModuleInterfaceIdentities(interface_, replacements));
  const sourceMap = portableSourceMap(bundled.sourceMap, buildConfig.project.root, dirname(finalJavaScriptPath));
  const javascript = bundled.code.endsWith("\n") ? bundled.code : `${bundled.code}\n`;
  addOutput(outputs, entryConfig.javascript, javascript);
  addOutput(outputs, entryConfig.sourceMap, sourceMap);
  addOutput(outputs, entryConfig.interface, interfaceText);
  for (const module of project.modules.filter((candidate) => moduleBelongsToLibrary(buildConfig, project, candidate.inputPath))) {
    const path = relative(buildConfig.project.root, module.inputPath).replaceAll("\\", "/");
    const digest = module.sourceSha256;
    const previous = sources.get(path);
    if (previous !== undefined && previous !== digest) throw new Error(`Library source '${path}' changed between entry compilations`);
    sources.set(path, digest);
  }
  return {
    sourceEntry: entryConfig.sourceEntry,
    javascript: entryConfig.javascript,
    sourceMap: entryConfig.sourceMap,
    interface: entryConfig.interface,
    sha256: {
      javascript: sha256Text(javascript),
      sourceMap: sha256Text(sourceMap),
      interface: sha256Text(interfaceText),
    },
  };
}

async function buildMultiEntryLibrary(
  buildConfig: VelarLibraryBuildConfig,
  projects: ReadonlyMap<VelarPackageSubpath, ProjectResult>,
  mode: JavaScriptBuildMode,
  outputs: Map<string, string>,
  sources: Map<string, string>,
): Promise<{
  readonly receipts: Record<string, VelarLibraryArtifactEntryReceipt>;
  readonly chunks: readonly VelarLibraryArtifactChunkReceipt[];
}> {
  const unique = new Map<string, { readonly config: VelarLibraryBuildEntry; readonly project: ProjectResult }>();
  for (const [subpath, config] of buildConfig.entries) {
    const key = `${config.entryPath}\0${config.javascript}`;
    if (!unique.has(key)) unique.set(key, { config, project: projects.get(subpath)! });
  }
  const bundle = await bundleVelarLibraryEntries(
    [...new Set(projects.values())],
    [...unique].map(([key, item]) => ({ key, inputPath: item.config.entryPath, outputPath: item.config.javascript })),
    buildConfig.packageName,
    buildConfig.target,
    buildConfig.outputRoot,
    mode,
  );
  const builtEntries = new Map<string, VelarLibraryArtifactEntryReceipt>();
  for (const [key, item] of unique) {
    const bundled = bundle.entries.get(key);
    if (!bundled) throw new Error(`The Velar library bundler omitted entry '${item.config.subpath}'`);
    builtEntries.set(key, writeLibraryEntryReceipt(buildConfig, item.config, item.project, bundled, outputs, sources));
  }
  const receipts: Record<string, VelarLibraryArtifactEntryReceipt> = {};
  for (const [subpath, config] of buildConfig.entries) receipts[subpath] = builtEntries.get(`${config.entryPath}\0${config.javascript}`)!;
  const chunks = bundle.chunks.map((chunk) => writeSharedChunkReceipt(buildConfig, chunk, outputs));
  return { receipts, chunks };
}

function writeSharedChunkReceipt(
  buildConfig: VelarLibraryBuildConfig,
  chunk: { readonly javascript: string; readonly sourceMapPath: string; readonly code: string; readonly sourceMap: string },
  outputs: Map<string, string>,
): VelarLibraryArtifactChunkReceipt {
  const finalJavaScriptPath = join(buildConfig.outputRoot, ...chunk.javascript.split("/"));
  const javascript = chunk.code.endsWith("\n") ? chunk.code : `${chunk.code}\n`;
  const sourceMap = portableSourceMap(chunk.sourceMap, buildConfig.project.root, dirname(finalJavaScriptPath));
  addOutput(outputs, chunk.javascript, javascript);
  addOutput(outputs, chunk.sourceMapPath, sourceMap);
  return {
    javascript: chunk.javascript,
    sourceMap: chunk.sourceMapPath,
    sha256: { javascript: sha256Text(javascript), sourceMap: sha256Text(sourceMap) },
  };
}

function addOutput(outputs: Map<string, string>, path: string, text: string): void {
  const previous = outputs.get(path);
  if (previous !== undefined && previous !== text) throw new Error(`Library entries produced different content for '${path}'`);
  outputs.set(path, text);
}

function identityReplacements(
  config: VelarLibraryBuildConfig,
  project: ProjectResult,
): readonly { readonly physical: string; readonly logical: string }[] {
  const replacements: { physical: string; logical: string }[] = [];
  for (const module of project.modules) {
    const owner = velarPackageOwner(project, module.inputPath);
    if (!owner || resolve(owner.root) === resolve(config.project.root)) {
      replacements.push({
        physical: module.inputPath,
        logical: packageStableModulePath(config.packageName, config.packageVersion, relative(config.project.root, module.inputPath)),
      });
      continue;
    }
    replacements.push({
      physical: module.inputPath,
      logical: packageStableModulePath(owner.name, owner.version, relative(owner.root, module.inputPath)),
    });
  }
  return replacements;
}

function moduleBelongsToLibrary(
  config: VelarLibraryBuildConfig,
  project: ProjectResult,
  path: string,
): boolean {
  const owner = velarPackageOwner(project, path);
  return owner ? resolve(owner.root) === resolve(config.project.root) : inside(config.project.root, path);
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

function orderedEntries(
  entries: ReadonlyMap<VelarPackageSubpath, VelarPackageEntry>,
): readonly (readonly [VelarPackageSubpath, VelarPackageEntry])[] {
  return [...entries].sort(([left], [right]) => left === "." ? -1 : right === "." ? 1 : left < right ? -1 : left > right ? 1 : 0);
}

async function assertPackageFilesSurviveOutputReplacement(
  packageRoot: string,
  outputRoot: string,
  canonicalOutputRoot: string,
  packagePath: string,
  resources: readonly VelarPackageResource[],
  exports: unknown,
  generatedPaths: ReadonlyMap<string, string>,
): Promise<void> {
  for (const resource of resources) {
    const canonicalResource = await canonicalizePotentialPath(resource.inputPath);
    if (outputRelativePath(outputRoot, resource.inputPath) !== null
      || outputRelativePath(canonicalOutputRoot, canonicalResource) !== null) {
      throw new Error(`${packagePath}#velar.resources[${JSON.stringify(resource.subpath)}] points inside velar.json 'outDir'; build-library replaces that directory`);
    }
  }
  for (const target of packageExportStringLeaves(exports)) {
    if (!target.startsWith("./")) continue;
    const targetPath = resolve(packageRoot, ...target.slice(2).split("/"));
    const output = outputRelativePath(outputRoot, targetPath);
    if (output === null) {
      const canonicalTarget = await canonicalizePotentialPath(targetPath);
      if (outputRelativePath(canonicalOutputRoot, canonicalTarget) === null) continue;
      throw new Error(`${packagePath}: package.json export target '${target}' resolves inside velar.json 'outDir' but is not generated by build-library`);
    }
    const generated = generatedPaths.get(portableArtifactPathKey(output));
    if (generated === output) continue;
    if (generated !== undefined) {
      throw new Error(`${packagePath}: package.json export target '${target}' conflicts portably with generated artifact '${generated}'`);
    }
    throw new Error(`${packagePath}: package.json export target '${target}' is inside velar.json 'outDir' but is not generated by build-library`);
  }
}

function packageExportStringLeaves(value: unknown): readonly string[] {
  const pending: unknown[] = [value];
  const output: string[] = [];
  while (pending.length > 0) {
    const item = pending.pop();
    if (typeof item === "string") output.push(item);
    else if (Array.isArray(item)) pending.push(...item);
    else if (item !== null && typeof item === "object") pending.push(...Object.values(item as Record<string, unknown>));
  }
  return output;
}

function assertAvailableGeneratedPath(path: string, label: string): void {
  assertPortableArtifactPath(path, label);
  const key = portableArtifactPathKey(path);
  if (key === portableArtifactPathKey(BUILD_STAGING_MARKER)) {
    throw new Error(`${label} cannot use reserved build path '${BUILD_STAGING_MARKER}'`);
  }
  if (portableArtifactPathKey(basename(path)) === "package.json") {
    throw new Error(`${label} cannot use reserved package scope path 'package.json'`);
  }
  if (key === "__velar_chunks" || key.startsWith("__velar_chunks/")) {
    throw new Error(`${label} cannot use reserved multi-entry chunk path '__velar_chunks'`);
  }
}

function generatedPathHierarchyConflict(
  claims: ReadonlyMap<string, GeneratedArtifactClaim>,
  key: string,
): GeneratedArtifactClaim | null {
  for (const [claimedKey, claim] of claims) {
    if (key !== claimedKey && (key.startsWith(`${claimedKey}/`) || claimedKey.startsWith(`${key}/`))) return claim;
  }
  return null;
}

function outputRelativePath(root: string, path: string): string | null {
  const fromRoot = relative(root, path);
  if (fromRoot === "") return "";
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
  return fromRoot.replaceAll("\\", "/");
}

function inside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}
