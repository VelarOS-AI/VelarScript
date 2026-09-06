import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { writeExclusiveBuildFile } from "./build-staging.ts";
import { frozenPackageEntryExports } from "./frozen-package-output.ts";
import { assertGeneratedOutputClaims, type GeneratedOutputClaim } from "./generated-output-claim.ts";
import {
  GENERATED_RUNTIME_PACKAGE_RECEIPT,
  VELAR_GENERATED_RUNTIME_PACKAGE_VERSION,
} from "./generated-runtime-package.ts";
import type { JavaScriptBuildMode } from "./javascript-output.ts";
import { usesNpmPackageOutput, type PackageOutputLayout } from "./package-output-layout.ts";
import { portableArtifactPathKey } from "./portable-artifact-path.ts";
import type { ProjectResult, VelarSourcePackage } from "./project.ts";
import { usedPackageResourceExports } from "./resource-output.ts";
import { standardRuntimePackageLayout, standardRuntimePackageRoot } from "./standard-runtime-package-layout.ts";
import { byCodeUnit } from "./stable-order.ts";

const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;

interface PackageExportClaim {
  readonly key: string;
  readonly target: string;
  readonly owner: string;
  readonly main: boolean;
}

interface AssembledPackageOutput {
  readonly name: string;
  readonly root: string;
  readonly manifestPath: string;
  readonly manifest: string;
  readonly runtime: boolean;
}

export interface PackageOutputAssembly {
  readonly outputRoot: string;
  readonly layout: PackageOutputLayout;
  readonly runtimeModules: ReadonlySet<string>;
  readonly runtimePackageNames: ReadonlySet<string>;
  readonly project: ProjectResult | null;
  readonly packages: readonly AssembledPackageOutput[];
  readonly claims: readonly GeneratedOutputClaim[];
}

interface PackageOutputAssemblyOptions {
  readonly outputRoot: string;
  readonly layout: PackageOutputLayout;
  readonly runtimeModules: ReadonlySet<string>;
  readonly project?: ProjectResult;
  readonly mode?: JavaScriptBuildMode;
  readonly standaloneOwner?: string | null;
}

interface MutablePackageOutput {
  readonly name: string;
  readonly root: string;
  readonly exports: Map<string, PackageExportClaim>;
  runtime: boolean;
}

/** Plans one portable npm namespace shared by compiler runtime and project package outputs. */
export function assemblePackageOutput(options: PackageOutputAssemblyOptions): PackageOutputAssembly {
  const outputRoot = resolve(options.outputRoot);
  const nodeModulesRoot = join(outputRoot, "node_modules");
  const packages = new Map<string, MutablePackageOutput>();
  const claims: GeneratedOutputClaim[] = [];
  const runtimeLayout = standardRuntimePackageLayout(options.runtimeModules);
  const runtimePackageNames = new Set(runtimeLayout.map((package_) => package_.name));
  for (const runtime of runtimeLayout) {
    const package_ = packageOutput(packages, nodeModulesRoot, runtime.name);
    package_.runtime = true;
    for (const module of runtime.modules) {
      addExport(package_, module.exportName, `./${module.file}`, `Standard runtime module '${module.source}'`, false);
      claims.push({
        path: join(package_.root, module.file),
        kind: "file",
        owner: `Standard runtime module '${module.source}'`,
      });
    }
    if (options.layout === "build") claims.push({
      path: join(package_.root, GENERATED_RUNTIME_PACKAGE_RECEIPT),
      kind: "file",
      owner: `Standard runtime package receipt '${runtime.name}'`,
    });
  }
  if (options.project) addProjectPackageExports(
    packages,
    nodeModulesRoot,
    options.project,
    options.layout,
    runtimePackageNames,
  );
  const assembled = [...packages.values()].sort((left, right) => byCodeUnit(left.name, right.name)).map((package_) => {
    const manifestPath = join(package_.root, "package.json");
    claims.push({path: manifestPath, kind: "file", owner: `assembled package manifest '${package_.name}'`});
    return {
      name: package_.name,
      root: package_.root,
      manifestPath,
      runtime: package_.runtime,
      manifest: packageManifest(package_, options),
    };
  });
  assertGeneratedOutputClaims(outputRoot, claims);
  return {
    outputRoot,
    layout: options.layout,
    runtimeModules: new Set(options.runtimeModules),
    runtimePackageNames,
    project: options.project ?? null,
    packages: assembled,
    claims,
  };
}

/** Writes each assembled package manifest once after all package members are materialized. */
export async function writePackageOutputManifests(assembly: PackageOutputAssembly): Promise<void> {
  await Promise.all(assembly.packages.map(async (package_) => {
    await mkdir(package_.root, {recursive: true});
    if (assembly.layout === "sandbox") await writeFile(package_.manifestPath, package_.manifest, "utf8");
    else await writeExclusiveBuildFile(
      package_.manifestPath,
      package_.manifest,
      `Assembled package manifest '${package_.name}'`,
    );
  }));
}

/** Guards a writer from consuming a plan created for another output or runtime graph. */
export function assertPackageOutputAssembly(
  assembly: PackageOutputAssembly,
  outputRoot: string,
  layout: PackageOutputLayout,
  runtimeModules: ReadonlySet<string>,
  project?: ProjectResult,
): void {
  if (assembly.outputRoot !== resolve(outputRoot) || assembly.layout !== layout
    || !sameSet(assembly.runtimeModules, runtimeModules)
    || project !== undefined && assembly.project !== project) {
    throw new Error("Package output assembly does not match the requested output graph");
  }
}

function addProjectPackageExports(
  packages: Map<string, MutablePackageOutput>,
  nodeModulesRoot: string,
  project: ProjectResult,
  layout: PackageOutputLayout,
  runtimePackageNames: ReadonlySet<string>,
): void {
  const frozen = frozenPackageEntryExports(project.velarPackages, layout);
  for (const sourcePackage of project.velarPackages) {
    if (sourcePackage.artifacts.size === 0
      && !usesNpmPackageOutput(sourcePackage.name, layout, runtimePackageNames)) continue;
    const package_ = packageOutput(packages, nodeModulesRoot, sourcePackage.name);
    const entries = sourcePackage.artifacts.size > 0
      ? frozen.get(sourcePackage.name) ?? {}
      : sourcePackageEntryExports(project, sourcePackage);
    for (const [key, target] of Object.entries(entries)) {
      addExport(package_, key, target, `VelarScript package '${sourcePackage.name}' entry '${key}'`, key === ".");
    }
  }
  const resourcePackages = new Set(project.resources.flatMap((resource) =>
    resource.packageName && resource.packageSubpath && !resource.source.startsWith(".") ? [resource.packageName] : [],
  ));
  for (const name of resourcePackages) {
    const package_ = packageOutput(packages, nodeModulesRoot, name);
    for (const [key, target] of Object.entries(usedPackageResourceExports(project, name, layout))) {
      addExport(package_, key, target, `VelarScript package '${name}' resource '${key}'`, false);
    }
  }
}

function sourcePackageEntryExports(project: ProjectResult, package_: VelarSourcePackage): Record<string, string> {
  return Object.fromEntries([...package_.entries]
    .filter(([, entry]) => project.modules.some((module) => module.inputPath === entry.inputPath))
    .map(([subpath, entry]) => [
      subpath,
      `./${entry.relativePath.replace(/\.vel$/u, ".js").replaceAll("\\", "/")}`,
    ]));
}

function packageOutput(
  packages: Map<string, MutablePackageOutput>,
  nodeModulesRoot: string,
  name: string,
): MutablePackageOutput {
  const existing = packages.get(name);
  if (existing) return existing;
  const created = {
    name,
    root: standardRuntimePackageRoot(nodeModulesRoot, name),
    exports: new Map<string, PackageExportClaim>(),
    runtime: false,
  };
  packages.set(name, created);
  return created;
}

function addExport(
  package_: MutablePackageOutput,
  key: string,
  target: string,
  owner: string,
  main: boolean,
): void {
  const portableKey = key === "." ? "." : `./${portableArtifactPathKey(key.slice(2))}`;
  const existing = package_.exports.get(portableKey);
  if (existing) {
    throw new Error(
      `${owner} conflicts with ${existing.owner} at package '${package_.name}' export '${key}'`,
    );
  }
  package_.exports.set(portableKey, {key, target, owner, main});
}

function packageManifest(
  package_: MutablePackageOutput,
  options: PackageOutputAssemblyOptions,
): string {
  const exports = [...package_.exports.values()].sort((left, right) => byCodeUnit(left.key, right.key));
  const main = exports.find((entry) => entry.key === "." && entry.main)?.target;
  const exportMap = Object.fromEntries(exports.map(({key, target}) => [key, target]));
  const manifest = `${JSON.stringify({
    name: package_.name,
    private: true,
    type: "module",
    ...(package_.runtime && options.layout === "build" ? {
      velarGeneratedRuntime: VELAR_GENERATED_RUNTIME_PACKAGE_VERSION,
      ...(options.standaloneOwner ? {velarStandaloneOwner: basename(options.standaloneOwner)} : {}),
      velarBuildMode: options.mode ?? "readable",
    } : {}),
    ...(main ? {main} : {}),
    exports: exports.length === 1 && main ? main : exportMap,
  }, null, 2)}\n`;
  if (Buffer.byteLength(manifest, "utf8") > MAX_PACKAGE_MANIFEST_BYTES) {
    throw new RangeError(`Assembled package manifest '${package_.name}' exceeds ${MAX_PACKAGE_MANIFEST_BYTES} bytes`);
  }
  return manifest;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
