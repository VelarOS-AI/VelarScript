import { isBuiltin } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import {
  assertEsbuildExternalImportsClosed,
  ordinaryEsbuildInputPaths,
} from "./esbuild-inputs.ts";
import { createEsbuildJavaScriptSnapshotCapture } from "./esbuild-javascript-snapshot.ts";
import {
  registerFrozenArtifactFileReentry,
  resolveFrozenArtifactNodeImport,
} from "./frozen-artifact-node-resolution.ts";
import {
  artifactSnapshotContents,
  assertArtifactSnapshotCurrent,
  type LoadedVelarLibraryArtifact,
  type VelarLibraryArtifactJavaScriptSnapshot,
} from "./library-artifact.ts";
import type { JavaScriptBuildMode } from "./javascript-output.ts";
import { assertVelarLibraryArtifactStaticDeployment } from "./library-artifact-module-closure.ts";
import { NODE_ESM_COMMONJS_RUNTIME_PLUGIN } from "./node-esm-bundle-runtime.ts";
import type { VelarSourcePackage } from "./project.ts";
import { assertPortableArtifactPath, portableArtifactPathKey } from "./portable-artifact-path.ts";
import { NODE_ESBUILD_PACKAGE_CONDITIONS } from "./package-exports.ts";
import { writeExclusiveBuildFile } from "./build-staging.ts";
import type { PackageOutputLayout } from "./package-output-layout.ts";
import { standardRuntimePackageLayout, standardRuntimePackageRoot } from "./standard-runtime-package-layout.ts";

export interface FrozenPackageGeneratedOutputClaim {
  readonly path: string;
  readonly kind: "file" | "tree";
  readonly owner: string;
}

/** Public exports selected from verified frozen artifacts before any output is written. */
export function frozenPackageEntryExports(
  packages: readonly VelarSourcePackage[],
  layout: PackageOutputLayout,
): ReadonlyMap<string, Readonly<Record<string, string>>> {
  const exportsByPackage = new Map<string, Record<string, string>>();
  for (const package_ of packages) {
    if (package_.artifacts.size === 0) continue;
    const packageExports: Record<string, string> = {};
    for (const [subpath, artifact] of package_.artifacts) {
      packageExports[subpath] = `./${frozenEntryOutputRelativePath(package_, artifact, layout).replaceAll("\\", "/")}`;
    }
    exportsByPackage.set(package_.name, packageExports);
  }
  return exportsByPackage;
}

interface FrozenEntryOutput {
  readonly packageName: string;
  readonly artifact: LoadedVelarLibraryArtifact;
  readonly outputPath: string;
}

export interface FrozenPackageWriteResult {
  readonly exportsByPackage: ReadonlyMap<string, Readonly<Record<string, string>>>;
  /** Ordinary npm files esbuild read while closing the deployable graph. */
  readonly inputPaths: readonly string[];
}

export type FrozenPackageInputAuthorization = (inputPaths: readonly string[]) => Promise<void>;

/**
 * An authenticated, relocatable write:false esbuild result. Its output bytes
 * stay private so materialization cannot substitute another graph after input
 * authorization succeeds.
 */
export interface FrozenPackageBuildPlan {
  readonly exportsByPackage: ReadonlyMap<string, Readonly<Record<string, string>>>;
  readonly inputPaths: readonly string[];
}

interface FrozenPackageBuildPlanState {
  readonly files: readonly {
    readonly relativePath: string;
    readonly contents: Uint8Array;
  }[];
  readonly writesChunkManifest: boolean;
}

const frozenPackageBuildPlanStates = new WeakMap<FrozenPackageBuildPlan, FrozenPackageBuildPlanState>();

/** Deterministic paths a frozen package owns before esbuild or the filesystem is touched. */
export function frozenPackageGeneratedOutputClaims(
  packages: readonly VelarSourcePackage[],
  outputRoot: string,
  layout: PackageOutputLayout,
  sourceMaps: boolean,
): readonly FrozenPackageGeneratedOutputClaim[] {
  const outputs = new Map<string, { readonly entryPath: string; readonly owner: string }>();
  for (const package_ of packages) {
    if (package_.artifacts.size === 0) continue;
    if (package_.name === "velar") {
      throw new Error("Frozen package name 'velar' is reserved for generated Standard runtime modules");
    }
    const packageOutputRoot = join(outputRoot, "node_modules", ...package_.name.split("/"));
    for (const [subpath, artifact] of package_.artifacts) {
      const inputRelative = artifactRelativePath(package_, artifact);
      const outputRelative = layout === "sandbox" || extname(inputRelative) === ".js"
        ? inputRelative
        : `${inputRelative}.js`;
      const path = resolve(packageOutputRoot, outputRelative);
      const owner = `frozen package '${package_.name}' entry '${subpath}'`;
      const existing = outputs.get(path);
      if (existing && resolve(existing.entryPath) !== resolve(artifact.entryPath)) {
        throw new Error(`Frozen package output '${path}' is claimed by different artifact entries`);
      }
      outputs.set(path, existing ?? { entryPath: artifact.entryPath, owner });
    }
  }
  const claims: FrozenPackageGeneratedOutputClaim[] = [...outputs].flatMap(([path, output]) => [
    { path, kind: "file" as const, owner: output.owner },
    ...(layout === "build" && sourceMaps
      ? [{ path: `${path}.map`, kind: "file" as const, owner: `${output.owner} source map` }]
      : []),
  ]);
  if (layout === "build" && outputs.size > 0) {
    claims.push({
      path: resolve(outputRoot, "node_modules", ".velar-artifact-chunks"),
      kind: "tree",
      owner: "frozen artifact chunk tree",
    });
  }
  return claims;
}

/** Materializes all selected frozen entries without flattening their npm resolution graph. */
export async function writeFrozenPackageEntries(
  packages: readonly VelarSourcePackage[],
  outputRoot: string,
  layout: PackageOutputLayout,
  occupiedPaths: ReadonlySet<string>,
  mode: JavaScriptBuildMode,
  sourceMaps: boolean,
  standardModules: ReadonlySet<string>,
  authorizeBuildInputs?: FrozenPackageInputAuthorization,
): Promise<FrozenPackageWriteResult> {
  if (layout === "build") {
    const plan = await prepareFrozenPackageBuildPlan(
      packages,
      outputRoot,
      occupiedPaths,
      mode,
      sourceMaps,
      standardModules,
      authorizeBuildInputs,
    );
    await writeFrozenPackageBuildPlan(plan, outputRoot);
    return { exportsByPackage: plan.exportsByPackage, inputPaths: plan.inputPaths };
  }
  const exportsByPackage = frozenPackageEntryExports(packages, layout);
  const outputs = frozenEntryOutputs(packages, outputRoot, layout, occupiedPaths, standardModules);
  if (outputs.size === 0) return { exportsByPackage, inputPaths: [] };
  const entries = [...outputs.values()].sort((left, right) => compare(left.outputPath, right.outputPath));
  await writeSandboxEntries(entries);
  return { exportsByPackage, inputPaths: [] };
}

/**
 * Runs the complete frozen-artifact bundler and authorizes its actual ordinary
 * inputs without creating the eventual output root. The returned object owns
 * the exact bytes that were produced by that graph.
 */
export async function prepareFrozenPackageBuildPlan(
  packages: readonly VelarSourcePackage[],
  logicalOutputRoot: string,
  occupiedPaths: ReadonlySet<string>,
  mode: JavaScriptBuildMode,
  sourceMaps: boolean,
  standardModules: ReadonlySet<string>,
  authorizeBuildInputs?: FrozenPackageInputAuthorization,
): Promise<FrozenPackageBuildPlan> {
  const outputRoot = resolve(logicalOutputRoot);
  const exportsByPackage = frozenPackageEntryExports(packages, "build");
  const outputs = frozenEntryOutputs(packages, outputRoot, "build", occupiedPaths, standardModules);
  const entries = [...outputs.values()].sort((left, right) => compare(left.outputPath, right.outputPath));
  const bundled = entries.length === 0
    ? { files: [], inputPaths: [] }
    : await planBuildEntries(entries, outputRoot, occupiedPaths, mode, sourceMaps, standardModules);
  await authorizeBuildInputs?.(bundled.inputPaths);
  const plan: FrozenPackageBuildPlan = Object.freeze({
    exportsByPackage,
    inputPaths: Object.freeze([...bundled.inputPaths]),
  });
  frozenPackageBuildPlanStates.set(plan, {
    files: bundled.files,
    writesChunkManifest: entries.length > 0,
  });
  return plan;
}

/** Writes only the private output bytes captured by one successful preflight. */
export async function writeFrozenPackageBuildPlan(
  plan: FrozenPackageBuildPlan,
  outputRoot: string,
): Promise<void> {
  const state = frozenPackageBuildPlanStates.get(plan);
  if (!state) throw new Error("Frozen package build plan was not produced by this toolchain process");
  const root = resolve(outputRoot);
  await Promise.all(state.files.map(async (file) => {
    const path = join(root, ...file.relativePath.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeExclusiveBuildFile(
      path,
      file.contents,
      `Frozen artifact build output '${file.relativePath}'`,
    );
  }));
  if (!state.writesChunkManifest) return;
  const chunkRoot = join(root, "node_modules", ".velar-artifact-chunks");
  await mkdir(chunkRoot, { recursive: true });
  await writeExclusiveBuildFile(
    join(chunkRoot, "package.json"),
    '{"private":true,"type":"module"}\n',
    "Frozen artifact chunk package manifest 'node_modules/.velar-artifact-chunks/package.json'",
  );
}

function frozenEntryOutputs(
  packages: readonly VelarSourcePackage[],
  outputRoot: string,
  layout: PackageOutputLayout,
  occupiedPaths: ReadonlySet<string>,
  standardModules: ReadonlySet<string>,
): ReadonlyMap<string, FrozenEntryOutput> {
  const outputs = new Map<string, FrozenEntryOutput>();
  const outputClaims = new Map<string, string>();
  for (const path of occupiedPaths) claimOutputPath(outputClaims, outputRoot, path, "generated resource");
  claimStandardRuntimeModuleOutputs(outputClaims, outputRoot, standardModules);
  for (const package_ of [...packages].sort((left, right) => compare(left.name, right.name))) {
    if (package_.name === "velar") {
      throw new Error("Frozen package name 'velar' is reserved for generated Standard runtime modules");
    }
    const packageOutputRoot = join(outputRoot, "node_modules", ...package_.name.split("/"));
    if (layout === "build") {
      const snapshots = new Map<string, VelarLibraryArtifactJavaScriptSnapshot>();
      for (const artifact of package_.artifacts.values()) {
        for (const snapshot of [...artifact.entrySnapshots, ...artifact.chunkSnapshots]) {
          snapshots.set(snapshot.path, snapshot);
        }
      }
      assertVelarLibraryArtifactStaticDeployment([...snapshots.values()], package_.name);
    }
    for (const [subpath, artifact] of [...package_.artifacts].sort(([left], [right]) => compare(left, right))) {
      const outputRelative = frozenEntryOutputRelativePath(package_, artifact, layout);
      const outputPath = resolve(packageOutputRoot, outputRelative);
      const existing = outputs.get(outputPath);
      if (existing && resolve(existing.artifact.entryPath) !== resolve(artifact.entryPath)) {
        throw new Error(`Frozen package output '${outputPath}' is claimed by different artifact entries`);
      }
      if (occupiedPaths.has(outputPath)) {
        throw new Error(`Frozen package '${package_.name}' artifact entry '${subpath}' conflicts with a generated resource output`);
      }
      if (!existing) {
        claimOutputPath(outputClaims, outputRoot, outputPath, `frozen package '${package_.name}' entry '${subpath}'`);
        outputs.set(outputPath, { packageName: package_.name, artifact, outputPath });
      }
    }
  }
  return outputs;
}

function frozenEntryOutputRelativePath(
  package_: VelarSourcePackage,
  artifact: LoadedVelarLibraryArtifact,
  layout: PackageOutputLayout,
): string {
  const inputRelative = artifactRelativePath(package_, artifact);
  return layout === "sandbox" || extname(inputRelative) === ".js" ? inputRelative : `${inputRelative}.js`;
}

function artifactRelativePath(package_: VelarSourcePackage, artifact: LoadedVelarLibraryArtifact): string {
  const path = relative(package_.root, artifact.entryPath);
  if (!path || path === ".." || path.startsWith("../") || path.startsWith("..\\") || isAbsolute(path)) {
    throw new Error(`Frozen package '${package_.name}' artifact entry '${artifact.subpath}' escapes its package root`);
  }
  return path;
}

async function writeSandboxEntries(entries: readonly FrozenEntryOutput[]): Promise<void> {
  const snapshots = new Map<string, VelarLibraryArtifactJavaScriptSnapshot>();
  for (const entry of entries) {
    for (const snapshot of entry.artifact.entrySnapshots) snapshots.set(snapshot.path, snapshot);
    for (const snapshot of entry.artifact.chunkSnapshots) snapshots.set(snapshot.path, snapshot);
  }
  // The proxy deliberately keeps Node's package-owner resolution semantics.
  // Revalidate before materialization, then the sandbox's exact load hook
  // serves these authenticated snapshots under their original URLs; it never
  // reopens an entry or chunk after this authorization boundary.
  for (const snapshot of snapshots.values()) await assertArtifactSnapshotCurrent(snapshot);
  await Promise.all(entries.map(async (entry) => {
    await mkdir(dirname(entry.outputPath), { recursive: true });
    await writeFile(
      entry.outputPath,
      `export * from ${JSON.stringify(pathToFileURL(entry.artifact.entrySnapshot.path).href)};\n`,
      "utf8",
    );
  }));
}

async function planBuildEntries(
  entries: readonly FrozenEntryOutput[],
  outputRoot: string,
  occupiedPaths: ReadonlySet<string>,
  mode: JavaScriptBuildMode,
  sourceMaps: boolean,
  standardModules: ReadonlySet<string>,
): Promise<{
  readonly files: readonly { readonly relativePath: string; readonly contents: Uint8Array }[];
  readonly inputPaths: readonly string[];
}> {
  const inputSnapshots = createEsbuildJavaScriptSnapshotCapture("Frozen artifact build");
  const chunkRoot = resolve(outputRoot, "node_modules", ".velar-artifact-chunks");
  for (const path of occupiedPaths) {
    const fromChunkRoot = relative(chunkRoot, path);
    if (fromChunkRoot === "" || !fromChunkRoot.startsWith("..") && !isAbsolute(fromChunkRoot)) {
      throw new Error(`Generated resource output '${path}' conflicts with the frozen artifact chunk directory`);
    }
  }
  const occupiedClaims = new Map<string, string>();
  for (const path of occupiedPaths) claimOutputPath(occupiedClaims, outputRoot, path, "generated resource");
  claimStandardRuntimeModuleOutputs(occupiedClaims, outputRoot, standardModules);
  claimOutputPath(occupiedClaims, outputRoot, join(chunkRoot, "package.json"), "frozen artifact chunk package manifest");
  const entryPoints = Object.fromEntries(entries.map((entry) => {
    const output = relative(outputRoot, entry.outputPath).replaceAll("\\", "/");
    return [output.slice(0, -".js".length), entry.artifact.entryPath];
  }));
  const result = await build({
    absWorkingDir: outputRoot,
    bundle: true,
    chunkNames: "node_modules/.velar-artifact-chunks/[name]-[hash]",
    conditions: [...NODE_ESBUILD_PACKAGE_CONDITIONS],
    entryNames: "[dir]/[name]",
    entryPoints,
    external: [...standardModules],
    format: "esm",
    keepNames: mode === "readable",
    legalComments: "none",
    logLevel: "silent",
    metafile: true,
    minify: mode === "production",
    outdir: outputRoot,
    packages: "bundle",
    platform: "node",
    plugins: [
      NODE_ESM_COMMONJS_RUNTIME_PLUGIN,
      frozenArtifactBuildPlugin(entries, sourceMaps, standardModules),
      inputSnapshots.plugin,
    ],
    sourcemap: sourceMaps ? "linked" : false,
    sourcesContent: sourceMaps,
    splitting: true,
    target: "node24",
    write: false,
  });
  assertEsbuildExternalImportsClosed(result.metafile, standardModules, "Frozen artifact build");
  const inputPaths = ordinaryEsbuildInputPaths(result.metafile, outputRoot);
  await inputSnapshots.assertInputs(inputPaths);
  const outputFiles = result.outputFiles ?? [];
  for (const file of outputFiles) {
    claimOutputPath(occupiedClaims, outputRoot, file.path, "frozen artifact build output");
  }
  return {
    files: outputFiles.map((file) => ({
      relativePath: relative(outputRoot, file.path).replaceAll("\\", "/"),
      contents: new Uint8Array(file.contents),
    })),
    inputPaths,
  };
}

function frozenArtifactBuildPlugin(
  entries: readonly FrozenEntryOutput[],
  sourceMaps: boolean,
  standardModules: ReadonlySet<string>,
): Plugin {
  const entryIdentities = new Map<string, string>();
  const artifactFiles = new Map<string, {
    readonly packageName: string;
    readonly receiptPath: string;
    readonly snapshot: VelarLibraryArtifactJavaScriptSnapshot;
  }>();
  for (const entry of entries) {
    entryIdentities.set(resolve(entry.artifact.entryPath), entry.artifact.entrySnapshot.path);
    for (const snapshot of entry.artifact.entrySnapshots) registerArtifactFile(
      artifactFiles,
      entry.packageName,
      entry.artifact.receiptPath,
      snapshot,
    );
    for (const snapshot of entry.artifact.chunkSnapshots) registerArtifactFile(
      artifactFiles,
      entry.packageName,
      entry.artifact.receiptPath,
      snapshot,
    );
  }
  const verifiedSnapshots = new Map([...artifactFiles].map(([path, item]) => [path, item.snapshot]));
  return {
    name: "velar-frozen-package-boundary",
    setup(context) {
      context.onResolve({ filter: /.*/ }, (arguments_) => {
        if (arguments_.kind !== "entry-point") return null;
        const identity = entryIdentities.get(resolve(arguments_.path));
        return identity ? { path: identity, namespace: "velar-frozen-artifact" } : null;
      });
      context.onResolve({ filter: /.*/, namespace: "velar-frozen-artifact" }, async (arguments_) => {
        if (arguments_.path.startsWith("./") || arguments_.path.startsWith("../")) {
          const target = resolve(dirname(arguments_.importer), arguments_.path);
          const importer = artifactFiles.get(arguments_.importer);
          const imported = artifactFiles.get(target);
          return importer && imported?.receiptPath === importer.receiptPath
            ? { path: target, namespace: "velar-frozen-artifact" }
            : { errors: [{ text: `Frozen artifact relative import '${arguments_.path}' is not covered by its verified receipt` }] };
        }
        if (isBuiltin(arguments_.path) || standardModules.has(arguments_.path)) {
          return { path: arguments_.path, external: true };
        }
        const owner = artifactFiles.get(arguments_.importer);
        return owner
          ? resolveFrozenArtifactNodeImport(
              context,
              arguments_,
              owner.snapshot,
              verifiedSnapshots,
              "velar-frozen-artifact",
            )
          : { errors: [{ text: `Frozen artifact importer '${arguments_.importer}' was not present in its verified snapshot` }] };
      });
      context.onLoad({ filter: /.*/, namespace: "velar-frozen-artifact" }, (arguments_) => {
        const item = artifactFiles.get(arguments_.path);
        return item
          ? {
              contents: artifactSnapshotContents(item.snapshot, sourceMaps),
              loader: "js",
              resolveDir: dirname(item.snapshot.path),
            }
          : { errors: [{ text: `Frozen artifact module '${arguments_.path}' was not present in its verified snapshot` }] };
      });
      registerFrozenArtifactFileReentry(
        context,
        verifiedSnapshots,
        "velar-frozen-artifact",
      );
    },
  };
}

function registerArtifactFile(
  files: Map<string, {
    readonly packageName: string;
    readonly receiptPath: string;
    readonly snapshot: VelarLibraryArtifactJavaScriptSnapshot;
  }>,
  packageName: string,
  receiptPath: string,
  snapshot: VelarLibraryArtifactJavaScriptSnapshot,
): void {
  const existing = files.get(snapshot.path);
  if (existing && (existing.receiptPath !== receiptPath || existing.snapshot.code !== snapshot.code
    || existing.snapshot.sourceMapPath !== snapshot.sourceMapPath || existing.snapshot.sourceMap !== snapshot.sourceMap)) {
    throw new Error(`Frozen artifact '${snapshot.path}' has conflicting verified snapshots`);
  }
  files.set(snapshot.path, { packageName, receiptPath, snapshot });
}

function claimOutputPath(claims: Map<string, string>, root: string, path: string, owner: string): void {
  const fromRoot = relative(root, resolve(path));
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${owner} escapes the generated output directory`);
  }
  const portablePath = fromRoot.replaceAll("\\", "/");
  assertPortableArtifactPath(portablePath, owner);
  const key = portableArtifactPathKey(portablePath);
  for (const [claimed, claimedOwner] of claims) {
    if (claimed === key || claimed.startsWith(`${key}/`) || key.startsWith(`${claimed}/`)) {
      throw new Error(`${owner} conflicts with ${claimedOwner} at generated path '${fromRoot.replaceAll("\\", "/")}'`);
    }
  }
  claims.set(key, owner);
}

function claimStandardRuntimeModuleOutputs(
  claims: Map<string, string>,
  outputRoot: string,
  standardModules: ReadonlySet<string>,
): void {
  const nodeModulesRoot = join(outputRoot, "node_modules");
  for (const package_ of standardRuntimePackageLayout(standardModules)) {
    const packageRoot = standardRuntimePackageRoot(nodeModulesRoot, package_.name);
    for (const module of package_.modules) {
      claimOutputPath(
        claims,
        outputRoot,
        join(packageRoot, module.file),
        `generated Standard runtime module '${module.source}'`,
      );
    }
  }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
