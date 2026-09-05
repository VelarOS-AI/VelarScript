import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { writeFrozenPackageEntries } from "./frozen-package-output.ts";
import type { ProjectResource, ProjectResult, VelarSourcePackage } from "./project.ts";
import { renderJavaScriptOutput, type JavaScriptBuildMode } from "./javascript-output.ts";

export type ResourceOutputLayout = "sandbox" | "build";

/** Materializes the exact checked resource bytes plus a portable ESM value wrapper. */
export async function writeProjectResources(
  project: ProjectResult,
  outputRoot: string,
  layout: ResourceOutputLayout,
  mode: JavaScriptBuildMode = "readable",
): Promise<void> {
  const outputs = new Map<string, ProjectResource>();
  for (const resource of project.resources) {
    const target = resourceOutputPath(project, resource, outputRoot, layout);
    const existing = outputs.get(target);
    if (existing && existing.content !== resource.content) {
      throw new Error(`Resource output '${target}' is claimed with different contents`);
    }
    outputs.set(target, resource);
  }
  await Promise.all([...outputs].map(async ([target, resource]) => {
    await mkdir(dirname(target), { recursive: true });
    const modulePath = `${target}.js`;
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
      writeFile(target, resource.content, "utf8"),
      writeFile(modulePath, moduleOutput.code, "utf8"),
    ]);
  }));
}

/** Relative location of a checked resource and its generated value wrapper. */
export function resourceOutputRelativePath(
  project: ProjectResult,
  resource: ProjectResource,
  layout: ResourceOutputLayout,
): string {
  if (resource.packageName && resource.packageRelativePath) {
    const packageRoot = layout === "build" && resource.source.startsWith(".")
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

/** Source-package and resource imports share one package namespace in a run/test sandbox. */
export async function writeSandboxPackageManifests(project: ProjectResult, outputRoot: string): Promise<void> {
  await writeRuntimePackageManifests(project, outputRoot, "sandbox");
}

/** Bare resource imports need a package export in framework-free and Node build output. */
export async function writeBuildResourcePackageManifests(
  project: ProjectResult,
  outputRoot: string,
  mode: JavaScriptBuildMode = "production",
  sourceMaps = true,
): Promise<void> {
  await writeRuntimePackageManifests(project, outputRoot, "build", mode, sourceMaps);
}

async function writeRuntimePackageManifests(
  project: ProjectResult,
  outputRoot: string,
  layout: ResourceOutputLayout,
  mode: JavaScriptBuildMode = "readable",
  sourceMaps = true,
): Promise<void> {
  const packageNames = new Set<string>();
  for (const package_ of project.velarPackages) {
    // Source packages need a sandbox manifest for their relocated compiled
    // modules. Frozen packages must be materialized in both layouts: relying
    // on the original node_modules tree loses a dependency installed below a
    // linked source package once that importer moves into the output tree.
    if (layout === "sandbox" || package_.artifacts.size > 0) packageNames.add(package_.name);
  }
  for (const resource of project.resources) {
    if (!resource.packageName || !resource.packageSubpath || resource.source.startsWith(".")) continue;
    packageNames.add(resource.packageName);
  }
  const resourceOutputs = new Set(project.resources.flatMap((resource) => {
    const target = resourceOutputPath(project, resource, outputRoot, layout);
    return [target, `${target}.js`];
  }));
  const artifactExports = await writeFrozenPackageEntries(
    project.velarPackages.filter((package_) => package_.artifacts.size > 0),
    outputRoot,
    layout,
    resourceOutputs,
    mode,
    sourceMaps,
  );
  await Promise.all([...packageNames].map(async (name) => {
    const package_ = project.velarPackages.find((candidate) => candidate.name === name);
    if (!package_) throw new Error(`Runtime output cannot find checked package '${name}'`);
    const root = join(outputRoot, "node_modules", ...name.split("/"));
    const entryExports = package_.artifacts.size > 0
      ? artifactExports.get(name) ?? {}
      : layout === "sandbox" ? sourcePackageEntryExports(project, package_) : {};
    const resourceExports = usedPackageResourceExports(project, name, layout);
    const exports = { ...entryExports, ...resourceExports };
    const main = entryExports["."];
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "package.json"), `${JSON.stringify({
      name,
      private: true,
      type: "module",
      ...(main ? { main } : {}),
      exports: Object.keys(exports).length === 1 && main ? main : exports,
    }, null, 2)}\n`, "utf8");
  }));
}

function sourcePackageEntryExports(project: ProjectResult, package_: VelarSourcePackage): Record<string, string> {
  return Object.fromEntries([...package_.entries]
    .filter(([, entry]) => project.modules.some((module) => module.inputPath === entry.inputPath))
    .map(([subpath, entry]) => [subpath, `./${relative(package_.root, entry.inputPath).replace(/\.vel$/u, ".js").replaceAll("\\", "/")}`]));
}

export function usedPackageResourceExports(
  project: ProjectResult,
  name: string,
  layout: ResourceOutputLayout = "sandbox",
): Readonly<Record<string, string>> {
  const exports: Record<string, string> = {};
  for (const resource of project.resources) {
    if (resource.packageName !== name || !resource.packageSubpath || layout === "build" && resource.source.startsWith(".")) continue;
    exports[resource.packageSubpath] = `./${resource.packageRelativePath}.js`;
  }
  return exports;
}

function resourceOutputPath(
  project: ProjectResult,
  resource: ProjectResource,
  outputRoot: string,
  layout: ResourceOutputLayout,
): string {
  return resolve(outputRoot, resourceOutputRelativePath(project, resource, layout));
}

export function jsonResourceModule(content: string): string {
  return `const value = JSON.parse(${JSON.stringify(content)});\nexport default value;\n`;
}
