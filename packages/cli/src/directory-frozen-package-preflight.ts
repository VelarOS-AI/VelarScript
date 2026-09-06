import {
  assertBuildInputsOutsideOutput,
  javascriptBuildInputs,
  type AdditionalBuildInput,
} from "./build-input-boundary.ts";
import type { FrozenPackageBuildPlan } from "./frozen-package-output.ts";
import type { JavaScriptBuildMode } from "./javascript-output.ts";
import { assemblePackageOutput } from "./package-output-assembler.ts";
import type { ProjectResult } from "./project.ts";
import { prepareProjectPackageBuildPlan } from "./resource-output.ts";

/** Resolves and authorizes the frozen-package graph before output recovery begins. */
export async function prepareDirectoryFrozenPackagePlan(
  project: ProjectResult,
  outputDirectory: string,
  mode: JavaScriptBuildMode,
  sourceMaps: boolean,
  runtimeModules: ReadonlySet<string>,
  buildInputs: readonly AdditionalBuildInput[],
): Promise<FrozenPackageBuildPlan> {
  const packageAssembly = assemblePackageOutput({
    outputRoot: outputDirectory,
    layout: "build",
    runtimeModules,
    project,
    mode,
  });
  return prepareProjectPackageBuildPlan(
    project,
    outputDirectory,
    mode,
    sourceMaps,
    runtimeModules,
    packageAssembly.runtimePackageNames,
    (inputPaths) => assertBuildInputsOutsideOutput(project, outputDirectory, [
      ...buildInputs,
      ...javascriptBuildInputs(inputPaths, "frozen artifact bundler input"),
    ]),
  );
}
