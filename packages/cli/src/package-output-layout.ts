import { isAbsolute, join, relative, sep } from "node:path";
import type { ProjectModule, ProjectResult, VelarSourcePackage } from "./project.ts";

export type PackageOutputLayout = "sandbox" | "build";

/** Whether this target materializes one source package in its real npm namespace. */
export function usesNpmPackageOutput(
  name: string,
  layout: PackageOutputLayout,
  runtimePackageNames: ReadonlySet<string>,
): boolean {
  return layout === "sandbox" || runtimePackageNames.has(name);
}

/** Maps checked source modules into the same npm tree as an extension's runtime. */
export function projectModuleOutputRelativePath(
  project: ProjectResult,
  module: ProjectModule,
  layout: PackageOutputLayout,
  runtimePackageNames: ReadonlySet<string>,
): string {
  const package_ = projectPackageForInput(project, module.inputPath);
  if (!package_ || !usesNpmPackageOutput(package_.name, layout, runtimePackageNames)) {
    return module.relativePath.replace(/\.vel$/u, ".js");
  }
  return join(
    "node_modules",
    ...package_.name.split("/"),
    packageRelativeModulePath(package_, module.inputPath),
  );
}

export function projectPackageForInput(project: ProjectResult, inputPath: string): VelarSourcePackage | null {
  let selected: VelarSourcePackage | null = null;
  for (const package_ of project.velarPackages) {
    const path = relative(package_.root, inputPath);
    if (path === "" || path !== ".." && !path.startsWith(`..${sep}`)
      && !isAbsolute(path)) {
      if (selected === null || package_.root.length > selected.root.length) selected = package_;
    }
  }
  return selected;
}

function packageRelativeModulePath(package_: VelarSourcePackage, inputPath: string): string {
  return relative(package_.root, inputPath).replace(/\.vel$/u, ".js");
}
