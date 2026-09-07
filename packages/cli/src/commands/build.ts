/**
 * Where `velar build` writes: one file, an isolated framework application, a
 * standalone Node application, or a directory of compiled modules.
 */

import { resolve } from "node:path";
import type { CommandArguments } from "../arguments.ts";
import { directoryBuildInputs } from "../build-input-boundary.ts";
import { writeFrameworkProductionApplication } from "../build/framework.ts";
import { writeGenericDirectoryApplication } from "../build/generic.ts";
import { writeNodeProductionApplication } from "../build/node.ts";
import { writeCliStandaloneBuildOutput } from "../build/single-file.ts";
import type { BuildOutputReplacement } from "../build/staging.ts";
import type { VelarProjectConfig } from "../config.ts";
import { displayInput } from "../help.ts";
import { hostErrorMessage } from "../host-error.ts";
import { nodeApplicationConfig } from "../node-application-config.ts";
import type { ProjectResult } from "../project.ts";

export async function writeBuildCommandOutput(
  parsed: CommandArguments,
  project: ProjectResult,
  projectConfig: VelarProjectConfig,
): Promise<number> {
  // JavaScript 表达形式和 Source Map 是两个正交选择。命令行只覆盖本次构建，
  // 项目配置保存稳定默认；两者不能互相推导，否则切到 readable 会意外改变
  // 发布目录的文件集合。
  const buildMode = parsed.mode ?? projectConfig.build.mode;
  const buildSourceMaps = parsed.sourceMaps ?? projectConfig.build.sourceMaps;

  if (parsed.output && project.modules.length !== 1) {
    process.stderr.write("velar build: --out is only valid for a single-file build; use --out-dir for module projects\n");
    return 2;
  }

  if (parsed.output) {
    const outputPath = resolve(parsed.output);
    try {
      await writeCliStandaloneBuildOutput(outputPath, project, projectConfig, buildSourceMaps, buildMode);
    } catch (error) {
      process.stderr.write(`velar build: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    process.stdout.write(`Built ${buildMode} ${displayInput(parsed.input, projectConfig)} -> ${outputPath}\n`);
    return 0;
  }

  const outputDirectory = parsed.outputDirectory ? resolve(parsed.outputDirectory) : projectConfig.outDir;
  // Manifest outDir declares Velar ownership; an override must prove it.
  const replacement: BuildOutputReplacement = { forced: parsed.force, declared: outputDirectory === projectConfig.outDir, projectRoot: projectConfig.root };
  if (project.framework) {
    try {
      await writeFrameworkProductionApplication(
        project, outputDirectory, replacement, buildMode, buildSourceMaps, await directoryBuildInputs(projectConfig, [project]),
      );
    } catch (error) {
      process.stderr.write(`velar build: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    process.stdout.write(`Built ${buildMode} ${project.framework.host.displayName} app -> ${outputDirectory}\n`);
    return 0;
  }
  const nodeConfig = nodeApplicationConfig(projectConfig);
  if (nodeConfig) {
    try {
      await writeNodeProductionApplication(
        project, outputDirectory, nodeConfig, replacement, buildMode, buildSourceMaps, await directoryBuildInputs(projectConfig, [project]),
      );
    } catch (error) {
      process.stderr.write(`velar build: ${hostErrorMessage(error)}\n`);
      return 1;
    }
    process.stdout.write(`Built ${buildMode} Node app -> ${outputDirectory}\n`);
    return 0;
  }
  try {
    await writeGenericDirectoryApplication(
      project, outputDirectory, replacement, buildMode, buildSourceMaps, await directoryBuildInputs(projectConfig, [project]),
    );
  } catch (error) {
    process.stderr.write(`velar build: ${hostErrorMessage(error)}\n`);
    return 1;
  }
  process.stdout.write(`Built ${buildMode} ${project.modules.length} module${project.modules.length === 1 ? "" : "s"} -> ${outputDirectory}\n`);
  return 0;
}
