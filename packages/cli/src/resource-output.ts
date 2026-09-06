import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { writeExclusiveBuildFile } from "./build-staging.ts";
import { requiredCompilerRuntimeModules } from "./compiler-runtime-modules.ts";
import {
  prepareFrozenPackageBuildPlan,
  writeFrozenPackageBuildPlan,
  writeFrozenPackageEntries,
  type FrozenPackageBuildPlan,
  type FrozenPackageInputAuthorization,
} from "./frozen-package-output.ts";
import { portableArtifactPathKey } from "./portable-artifact-path.ts";
import { usesNpmPackageOutput, type PackageOutputLayout } from "./package-output-layout.ts";
import { projectImportKey, type ProjectModule, type ProjectResource, type ProjectResult } from "./project.ts";
import { renderJavaScriptOutput, type JavaScriptBuildMode } from "./javascript-output.ts";

export interface ProjectResourceOutputPaths {
  readonly resource: ProjectResource;
  readonly snapshotPath: string;
  readonly modulePath: string;
}

/** Materializes the exact checked resource bytes plus a portable ESM value wrapper. */
export async function writeProjectResources(
  project: ProjectResult,
  outputRoot: string,
  layout: PackageOutputLayout,
  mode: JavaScriptBuildMode = "readable",
  runtimePackageNames: ReadonlySet<string> = new Set(),
): Promise<void> {
  await Promise.all(projectResourceOutputPaths(project, outputRoot, layout, runtimePackageNames).map(async ({ resource, snapshotPath, modulePath }) => {
    await Promise.all([mkdir(dirname(snapshotPath), { recursive: true }), mkdir(dirname(modulePath), { recursive: true })]);
    const moduleOutput = await renderJavaScriptOutput({
      code: jsonResourceModule(resource.content),
      sourceMap: null,
      sourceFile: resource.inputPath,
      outputFile: modulePath,
      mode,
      sourceMaps: false,
      target: "node24",
    });
    await Promise.all([
      writeResourceOutputFile(snapshotPath, resource.content, `Resource snapshot '${relative(outputRoot, snapshotPath).replaceAll("\\", "/")}'`, layout),
      writeResourceOutputFile(modulePath, moduleOutput.code, `Resource module '${relative(outputRoot, modulePath).replaceAll("\\", "/")}'`, layout),
    ]);
  }));
}

/** Writes raw checked resource bytes when another plan owns the ESM wrappers. */
export async function writeProjectResourceSnapshots(
  project: ProjectResult,
  outputRoot: string,
  layout: PackageOutputLayout,
  runtimePackageNames: ReadonlySet<string> = new Set(),
): Promise<void> {
  await Promise.all(projectResourceOutputPaths(project, outputRoot, layout, runtimePackageNames).map(async ({ resource, snapshotPath }) => {
    await mkdir(dirname(snapshotPath), { recursive: true });
    await writeResourceOutputFile(
      snapshotPath,
      resource.content,
      `Resource snapshot '${relative(outputRoot, snapshotPath).replaceAll("\\", "/")}'`,
      layout,
    );
  }));
}

/** Complete raw/value output pair for every distinct checked project resource. */
export function projectResourceOutputPaths(
  project: ProjectResult,
  outputRoot: string,
  layout: PackageOutputLayout,
  runtimePackageNames: ReadonlySet<string> = new Set(),
): readonly ProjectResourceOutputPaths[] {
  const outputs = new Map<string, ProjectResource>();
  for (const resource of project.resources) {
    const target = resourceOutputPath(project, resource, outputRoot, layout, runtimePackageNames);
    const existing = outputs.get(target);
    if (existing && existing.content !== resource.content) {
      throw new Error(`Resource output '${target}' is claimed with different contents`);
    }
    outputs.set(target, resource);
  }
  return [...outputs].map(([target, resource]) => ({
    resource,
    snapshotPath: resourceSnapshotOutputPath(resource, target),
    modulePath: `${target}.js`,
  }));
}

/** Relative location of a checked resource and its generated value wrapper. */
export function resourceOutputRelativePath(
  project: ProjectResult,
  resource: ProjectResource,
  layout: PackageOutputLayout,
  runtimePackageNames: ReadonlySet<string> = new Set(),
): string {
  if (resource.packageName && resource.packageRelativePath) {
    const packageRoot = layout === "build" && resource.source.startsWith(".")
      && !usesNpmPackageOutput(resource.packageName, layout, runtimePackageNames)
      ? join("__velar_packages__", ...resource.packageName.split("/"))
      : join("node_modules", ...resource.packageName.split("/"));
    return join(packageRoot, ...resource.packageRelativePath.split("/"));
  }
  const path = relative(project.sourceRoot, resource.inputPath);
  if (!path || path === ".." || path.startsWith("../") || path.startsWith("..\\")) {
    throw new Error(`Project resource '${resource.inputPath}' escapes the compiled source root`);
  }
  return path;
}

/** Materializes verified frozen members; the package assembler owns their shared manifest. */
export async function writeProjectPackageContents(
  project: ProjectResult,
  outputRoot: string,
  layout: PackageOutputLayout,
  mode: JavaScriptBuildMode = "production",
  sourceMaps = true,
  runtimeModules: ReadonlySet<string> = requiredCompilerRuntimeModules(project),
  runtimePackageNames: ReadonlySet<string> = new Set(),
  authorizeBuildInputs?: FrozenPackageInputAuthorization,
): Promise<readonly string[]> {
  const resourceOutputs = new Set(projectResourceOutputPaths(project, outputRoot, layout, runtimePackageNames)
    .flatMap((output) => [output.snapshotPath, output.modulePath]));
  const output = await writeFrozenPackageEntries(
    project.velarPackages.filter((package_) => package_.artifacts.size > 0),
    outputRoot,
    layout,
    resourceOutputs,
    mode,
    sourceMaps,
    runtimeModules,
    authorizeBuildInputs,
  );
  return output.inputPaths;
}

/** Relocates one already-authorized package plan into the claimed staging root. */
export async function writeProjectPackageBuildPlan(
  plan: FrozenPackageBuildPlan,
  outputRoot: string,
): Promise<void> {
  await writeFrozenPackageBuildPlan(plan, outputRoot);
}

/**
 * Produces and authorizes the exact frozen package bytes before a directory
 * transaction may recover or replace its destination.
 */
export async function prepareProjectPackageBuildPlan(
  project: ProjectResult,
  logicalOutputRoot: string,
  mode: JavaScriptBuildMode,
  sourceMaps: boolean,
  runtimeModules: ReadonlySet<string> = requiredCompilerRuntimeModules(project),
  runtimePackageNames: ReadonlySet<string> = new Set(),
  authorizeBuildInputs?: FrozenPackageInputAuthorization,
): Promise<FrozenPackageBuildPlan> {
  const resourceOutputs = new Set(projectResourceOutputPaths(
    project,
    logicalOutputRoot,
    "build",
    runtimePackageNames,
  ).flatMap((output) => [output.snapshotPath, output.modulePath]));
  return prepareFrozenPackageBuildPlan(
    project.velarPackages.filter((package_) => package_.artifacts.size > 0),
    logicalOutputRoot,
    resourceOutputs,
    mode,
    sourceMaps,
    runtimeModules,
    authorizeBuildInputs,
  );
}

export function usedPackageResourceExports(
  project: ProjectResult,
  name: string,
  layout: PackageOutputLayout = "sandbox",
): Readonly<Record<string, string>> {
  const exports: Record<string, string> = {};
  for (const resource of project.resources) {
    if (resource.packageName !== name || !resource.packageSubpath || layout === "build" && resource.source.startsWith(".")) continue;
    exports[resource.packageSubpath] = `./${resource.packageRelativePath}.js`;
  }
  return exports;
}

/** Rewrites checked JSON imports to the generated wrapper selected by one output layout. */
export function rewriteProjectResourceImports(
  project: ProjectResult,
  module: ProjectModule,
  code: string,
  layout: PackageOutputLayout,
  moduleOutputRelativePath: string,
  runtimePackageNames: ReadonlySet<string> = new Set(),
): string {
  return code.replace(/(\bfrom\s+["']|\bimport\s+["'])([^"']+)(["'])/gu, (match, prefix: string, source: string, suffix: string) => {
    const resourceSource = source.endsWith(".json.js") ? source.slice(0, -3) : source;
    const resource = project.resourceImports.get(projectImportKey(module.inputPath, resourceSource));
    if (!resource) return match;
    const output = `${resourceOutputRelativePath(project, resource, layout, runtimePackageNames)}.js`;
    let targetImport = relative(dirname(moduleOutputRelativePath), output).replaceAll("\\", "/");
    if (!targetImport.startsWith(".")) targetImport = `./${targetImport}`;
    return `${prefix}${targetImport}${suffix}`;
  });
}

function resourceOutputPath(
  project: ProjectResult,
  resource: ProjectResource,
  outputRoot: string,
  layout: PackageOutputLayout,
  runtimePackageNames: ReadonlySet<string>,
): string {
  return resolve(outputRoot, resourceOutputRelativePath(project, resource, layout, runtimePackageNames));
}

/**
 * A package may legally expose its own package.json as checked JSON data. The
 * generated runtime package still needs that exact package.json path for its
 * import map, so retain the checked bytes in an adjacent non-JSON snapshot and
 * keep the public value wrapper at package.json.js.
 */
function resourceSnapshotOutputPath(resource: ProjectResource, moduleBasePath: string): string {
  return resource.packageName !== null
    && resource.packageRelativePath !== null
    && portableArtifactPathKey(resource.packageRelativePath) === "package.json"
    ? `${moduleBasePath}.velar-resource`
    : moduleBasePath;
}

async function writeResourceOutputFile(
  path: string,
  contents: string | Uint8Array,
  claim: string,
  layout: PackageOutputLayout,
): Promise<void> {
  if (layout === "sandbox") await writeFile(path, contents);
  else await writeExclusiveBuildFile(path, contents, claim);
}

export function jsonResourceModule(content: string): string {
  return `const value = JSON.parse(${JSON.stringify(content)});\nexport default value;\n`;
}
