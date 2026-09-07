/**
 * `velar build <single.vel> --out <file.js>`: one module, its runtime closure
 * beside it, written through the standalone output transaction.
 */

import { basename, dirname } from "node:path";
import type { VelarProjectConfig } from "../config.ts";
import type { JavaScriptBuildMode } from "../javascript-output.ts";
import {
  assertNodeStandardModuleOutputAvailable,
  writeNodeStandardModules,
} from "../node-standard-module-output.ts";
import type { ProjectResult } from "../project.ts";
import { writeStandaloneBuildOutput } from "../standalone-build-output.ts";
import { writeCompiled } from "./compiled.ts";

export async function writeCliStandaloneBuildOutput(
  outputPath: string,
  project: ProjectResult,
  projectConfig: VelarProjectConfig,
  sourceMaps: boolean,
  mode: JavaScriptBuildMode,
): Promise<void> {
  await writeStandaloneBuildOutput({
    outputPath, project, projectConfig, sourceMaps, mode,
    assertRuntimeOutput: async (runtimeModules) => {
      await assertNodeStandardModuleOutputAvailable(
        dirname(outputPath), project, basename(outputPath), runtimeModules,
      );
    },
    writeCompiled: async (stagedOutput, result, bundled) => writeCompiled(
      stagedOutput, result, true, bundled?.code ?? null, bundled?.sourceMap ?? null, bundled === null, sourceMaps, mode,
    ),
    writeRuntime: async (outputRoot, artifactConfigurationPath, runtimeModules) => writeNodeStandardModules(
      outputRoot, project, true, mode, basename(outputPath), artifactConfigurationPath, runtimeModules,
    ),
  });
}
