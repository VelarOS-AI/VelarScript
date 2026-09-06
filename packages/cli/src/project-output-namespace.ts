import { relative } from "node:path";
import { embeddedModuleOutputPath } from "./embedded-modules.ts";
import { frozenPackageGeneratedOutputClaims } from "./frozen-package-output.ts";
import { assertGeneratedOutputClaims, type GeneratedOutputClaim } from "./generated-output-claim.ts";
import {
  assemblePackageOutput,
  assertPackageOutputAssembly,
  type PackageOutputAssembly,
} from "./package-output-assembler.ts";
import type { PackageOutputLayout } from "./package-output-layout.ts";
import type { ProjectModule, ProjectResult } from "./project.ts";
import { projectResourceOutputPaths } from "./resource-output.ts";

interface ProjectOutputNamespaceOptions {
  readonly outputRoot: string;
  readonly layout: PackageOutputLayout;
  readonly sourceMaps: boolean;
  readonly moduleOutputPath: (module: ProjectModule) => string;
  readonly packageAssembly?: PackageOutputAssembly;
  readonly additionalClaims?: readonly GeneratedOutputClaim[];
}

/** Owns every deterministic project output path before project bytes reach the filesystem. */
export function assertProjectOutputNamespace(
  project: ProjectResult,
  options: ProjectOutputNamespaceOptions,
): void {
  const claims: GeneratedOutputClaim[] = [];
  for (const module of project.modules) {
    const output = options.moduleOutputPath(module);
    const display = relative(options.outputRoot, output).replaceAll("\\", "/");
    claims.push({ path: output, kind: "file", owner: `compiled module '${display}'` });
    if (options.sourceMaps) claims.push({ path: `${output}.map`, kind: "file", owner: `compiled module source map '${display}.map'` });
    for (const embedded of module.result.embeddedModules) {
      const embeddedPath = embeddedModuleOutputPath(output, embedded.specifier);
      claims.push({ path: embeddedPath, kind: "file", owner: `embedded module '${embedded.specifier}' for '${display}'` });
      if (options.sourceMaps) claims.push({ path: `${embeddedPath}.map`, kind: "file", owner: `embedded module source map '${embedded.specifier}.map' for '${display}'` });
    }
  }
  const packageAssembly = options.packageAssembly ?? assemblePackageOutput({
    outputRoot: options.outputRoot,
    layout: options.layout,
    runtimeModules: new Set(),
    project,
  });
  assertPackageOutputAssembly(
    packageAssembly,
    options.outputRoot,
    options.layout,
    packageAssembly.runtimeModules,
    project,
  );
  for (const output of projectResourceOutputPaths(
    project,
    options.outputRoot,
    options.layout,
    packageAssembly.runtimePackageNames,
  )) {
    const source = relative(project.projectRoot, output.resource.inputPath).replaceAll("\\", "/");
    claims.push({ path: output.snapshotPath, kind: "file", owner: `resource snapshot '${source}'` });
    claims.push({ path: output.modulePath, kind: "file", owner: `resource module '${source}'` });
  }
  claims.push(...packageAssembly.claims);
  claims.push(...frozenPackageGeneratedOutputClaims(
    project.velarPackages,
    options.outputRoot,
    options.layout,
    options.sourceMaps,
  ));
  claims.push(...options.additionalClaims ?? []);
  assertGeneratedOutputClaims(options.outputRoot, claims);
}
