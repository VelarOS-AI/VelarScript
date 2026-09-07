/**
 * `velar build` for a project with no application target: a directory of
 * compiled modules, their resources, the runtime packages they name, and the
 * path-bound receipt that lets the next build replace it.
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type AdditionalBuildInput } from "../build-input-boundary.ts";
import {
  BUILD_OUTPUT_RECEIPT,
  commitBuildOutputDirectory,
  discardBuildStaging,
  writeBuildOutputReceipt,
} from "../build-output-directory.ts";
import { BUILD_STAGING_MARKER } from "../build-staging.ts";
import { requiredCompilerRuntimeModules } from "../compiler-runtime-modules.ts";
import { prepareDirectoryFrozenPackagePlan } from "../directory-frozen-package-preflight.ts";
import { assertUniqueEmbeddedModuleOutputs } from "../embedded-modules.ts";
import type { JavaScriptBuildMode } from "../javascript-output.ts";
import { nodeRuntimeDependencyOutputClaims } from "../node-runtime-dependencies.ts";
import { writeNodeStandardModulesIntoAssembly } from "../node-standard-module-output.ts";
import { assemblePackageOutput } from "../package-output-assembler.ts";
import { projectModuleOutputRelativePath } from "../package-output-layout.ts";
import { assertProjectOutputNamespace } from "../project-output-namespace.ts";
import type { ProjectResult } from "../project.ts";
import { writeProjectPackageBuildPlan, writeProjectResources } from "../resource-output.ts";
import { mapBuildOutputs, rewriteVelarPackageImports, writeCompiled } from "./compiled.ts";
import { type BuildOutputReplacement, prepareBuildStaging } from "./staging.ts";

export async function writeGenericDirectoryApplication(
  project: ProjectResult,
  outputDirectory: string,
  replacement: BuildOutputReplacement,
  mode: JavaScriptBuildMode,
  sourceMaps: boolean,
  buildInputs: readonly AdditionalBuildInput[],
): Promise<void> {
  const runtimeModules = requiredCompilerRuntimeModules(project);
  const packagePlan = await prepareDirectoryFrozenPackagePlan(
    project,
    outputDirectory,
    mode,
    sourceMaps,
    runtimeModules,
    buildInputs,
  );
  const staging = await prepareBuildStaging(outputDirectory, replacement, project, buildInputs);
  try {
    const packageAssembly = assemblePackageOutput({
      outputRoot: staging.directory,
      layout: "build",
      runtimeModules,
      project,
      mode,
    });
    assertProjectOutputNamespace(project, {
      outputRoot: staging.directory,
      layout: "build",
      sourceMaps,
      moduleOutputPath: (module) => join(staging.directory, projectModuleOutputRelativePath(
        project, module, "build", packageAssembly.runtimePackageNames,
      )),
      packageAssembly,
      additionalClaims: [
        ...nodeRuntimeDependencyOutputClaims(join(staging.directory, "node_modules"), runtimeModules),
        { path: join(staging.directory, BUILD_STAGING_MARKER), kind: "file", owner: "directory build staging marker" },
        { path: join(staging.directory, BUILD_OUTPUT_RECEIPT), kind: "file", owner: "directory build receipt" },
      ],
    });
    assertUniqueEmbeddedModuleOutputs(project.modules.map((module) => ({
      ownerPath: join(staging.directory, projectModuleOutputRelativePath(
        project, module, "build", packageAssembly.runtimePackageNames,
      )),
      embeddedModules: module.result.embeddedModules,
    })));
    await mapBuildOutputs(project.modules, async (module) => {
      const outputPath = join(staging.directory, projectModuleOutputRelativePath(
        project, module, "build", packageAssembly.runtimePackageNames,
      ));
      await mkdir(dirname(outputPath), { recursive: true });
      await writeCompiled(outputPath, module.result, false, rewriteVelarPackageImports(
        project, module, packageAssembly.runtimePackageNames,
      ), null, true, sourceMaps, mode);
    });
    await writeProjectResources(project, staging.directory, "build", mode, packageAssembly.runtimePackageNames);
    await writeProjectPackageBuildPlan(packagePlan, staging.directory);
    await writeNodeStandardModulesIntoAssembly(staging.directory, project, packageAssembly, mode);
    const authorization = await writeBuildOutputReceipt(staging.directory, outputDirectory);
    await commitBuildOutputDirectory(staging, authorization);
  } catch (error) {
    await discardBuildStaging(staging, error);
    throw error;
  }
}
