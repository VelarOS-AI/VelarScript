import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { ProjectResource, ProjectResult } from "./project.ts";
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

/** Bare resource imports need a package export in framework-free build output. */
export async function writeBuildResourcePackageManifests(project: ProjectResult, outputRoot: string): Promise<void> {
  const packages = new Map<string, Record<string, string>>();
  for (const resource of project.resources) {
    if (!resource.packageName || !resource.packageSubpath || resource.source.startsWith(".")) continue;
    const exports = packages.get(resource.packageName) ?? {};
    exports[resource.packageSubpath] = `./${resource.packageRelativePath}.js`;
    packages.set(resource.packageName, exports);
  }
  await Promise.all([...packages].map(async ([name, exports]) => {
    const root = join(outputRoot, "node_modules", ...name.split("/"));
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "package.json"), `${JSON.stringify({
      name,
      private: true,
      type: "module",
      exports,
    }, null, 2)}\n`, "utf8");
  }));
}

export function usedPackageResourceExports(project: ProjectResult, name: string): Readonly<Record<string, string>> {
  const exports: Record<string, string> = {};
  for (const resource of project.resources) {
    if (resource.packageName !== name || !resource.packageSubpath) continue;
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
