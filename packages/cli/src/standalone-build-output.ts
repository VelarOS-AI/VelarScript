import { basename, dirname, join, relative } from "node:path";
import type { CompileResult } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { embeddedModuleOutputPath } from "./embedded-modules.ts";
import type { JavaScriptBuildMode } from "./javascript-output.ts";
import type { ProjectResult } from "./project.ts";
import {
  bundleStandaloneJavaScript,
  needsStandaloneJavaScriptBundle,
  type StandaloneJavaScriptOutput,
} from "./standalone-build.ts";
import { directoryBuildInputs, javascriptBuildInputs, type AdditionalBuildInput } from "./build-input-boundary.ts";
import { nodeApplicationConfig } from "./node-application-config.ts";
import { requiredCompilerRuntimeModules } from "./compiler-runtime-modules.ts";
import { standardRuntimePackageOutputClaims } from "./node-standard-module-output.ts";
import { standardModuleSources } from "./standard-modules.ts";
import {
  readConfiguredServerConfiguration,
  writeConfiguredServerConfiguration,
  type ConfiguredServerSnapshot,
} from "./server-configuration-snapshot.ts";
import {
  standaloneServerConfigurationPath,
  standaloneServerConfigurationPaths,
} from "./standalone-output-ownership.ts";
import { writeStandaloneOutputTransaction } from "./standalone-output-transaction.ts";
import { assertStaticJavaScriptDeploymentSources } from "./static-javascript-deployment.ts";

export interface StandaloneBuildOutputOptions {
  readonly outputPath: string;
  readonly project: ProjectResult;
  readonly projectConfig: VelarProjectConfig;
  readonly sourceMaps: boolean;
  readonly mode: JavaScriptBuildMode;
  readonly assertRuntimeOutput: (runtimeModules: ReadonlySet<string>) => Promise<void>;
  readonly writeCompiled: (
    outputPath: string,
    result: CompileResult,
    bundled: StandaloneJavaScriptOutput | null,
  ) => Promise<void>;
  readonly writeRuntime: (
    outputRoot: string,
    artifactConfigurationPath: string | null,
    runtimeModules: ReadonlySet<string>,
  ) => Promise<void>;
}

/** Closes, stages, authorizes, and atomically installs one deployable program. */
export async function writeStandaloneBuildOutput(options: StandaloneBuildOutputOptions): Promise<void> {
  const { outputPath, project, projectConfig, sourceMaps } = options;
  const result = project.modules[0]!.result;
  const compilerOwnedModules = new Set(standardModuleSources(project.compilerExtensions).keys());
  const sourceDeployment = assertStaticJavaScriptDeploymentSources([
    { code: result.code ?? "", label: `generated entry '${result.source.path}'` },
    ...result.embeddedModules.map((module) => ({
      code: module.code,
      label: `generated embedded module '${result.source.path}:${module.specifier}'`,
    })),
  ], "Standalone build", compilerOwnedModules);
  const configurationClaims = standaloneServerConfigurationPaths(outputPath);
  const standaloneBundle = sourceDeployment.requiresNodeBundle || needsStandaloneJavaScriptBundle(
    result,
    compilerOwnedModules,
    project.velarArtifactImports,
  );
  const generatedSiblingFiles = standaloneBundle
    ? []
    : result.embeddedModules.map((module) => embeddedModuleOutputPath(outputPath, module.specifier));
  const cleanupFiles = [
    ...(!sourceMaps ? [`${outputPath}.map`, ...generatedSiblingFiles.map((path) => `${path}.map`)] : []),
    ...(!result.css ? [outputPath.replace(/\.js$/u, ".css")] : []),
    ...configurationClaims,
  ];
  const claimedFiles = [outputPath, `${outputPath}.map`, outputPath.replace(/\.js$/u, ".css"),
    ...generatedSiblingFiles.flatMap((path) => [path, `${path}.map`]), ...configurationClaims];
  const additionalInputs: AdditionalBuildInput[] = await directoryBuildInputs(projectConfig, [project]);
  const bundled = standaloneBundle
    ? await bundleStandaloneJavaScript(
        outputPath,
        result,
        compilerOwnedModules,
        project.resources,
        "readable",
        sourceMaps,
        project.velarArtifactImports,
      )
    : null;
  if (bundled) additionalInputs.push(...javascriptBuildInputs(bundled.inputPaths, "bundled JavaScript dependency"));
  const requiredRuntimeModules = requiredCompilerRuntimeModules(project);
  const configuration = await standaloneServerConfiguration(requiredRuntimeModules, project, projectConfig);
  const configurationPath = configuration === null
    ? null
    : standaloneServerConfigurationPath(outputPath, configuration.relativePath);
  if (configuration !== null) additionalInputs.push(
    {path: configuration.sourcePath, kind: "file", label: "Server configuration"},
    {path: configuration.canonicalSourcePath, kind: "file", label: "Server configuration canonical identity"},
  );
  await options.assertRuntimeOutput(requiredRuntimeModules);
  await writeStandaloneOutputTransaction({
    outputPath,
    project,
    claimedFiles,
    cleanupFiles,
    generatedSiblingFiles,
    configurationPath,
    runtimeModules: requiredRuntimeModules,
    additionalInputs,
    writeStaged: async (stagedOutput) => {
      await options.writeCompiled(stagedOutput, result, bundled);
      await options.writeRuntime(
        dirname(stagedOutput),
        configurationPath === null ? null : basename(configurationPath),
        requiredRuntimeModules,
      );
      if (configuration !== null && configurationPath !== null) {
        await writeConfiguredServerConfiguration(
          dirname(stagedOutput),
          {...configuration, relativePath: basename(configurationPath)},
          standaloneReservedClaims(outputPath, claimedFiles, configurationPath, requiredRuntimeModules),
        );
      }
    },
  });
}

async function standaloneServerConfiguration(
  requiredRuntimeModules: ReadonlySet<string>,
  project: ProjectResult,
  projectConfig: VelarProjectConfig,
): Promise<ConfiguredServerSnapshot | null> {
  if (!requiredRuntimeModules.has("velar/server")) return null;
  const application = nodeApplicationConfig(projectConfig);
  return application?.configuration
    ? readConfiguredServerConfiguration(project.projectRoot, application.configuration)
    : null;
}

function standaloneReservedClaims(
  outputPath: string,
  claimedFiles: readonly string[],
  configurationPath: string,
  requiredRuntimeModules: ReadonlySet<string>,
): readonly {readonly relativePath: string; readonly owner: string}[] {
  const outputRoot = dirname(outputPath);
  return [
    ...claimedFiles
      .filter((path) => path !== configurationPath)
      .map((path) => ({
        relativePath: relative(outputRoot, path).replaceAll("\\", "/"),
        owner: "a reserved standalone build output",
      })),
    ...standardRuntimePackageOutputClaims(join(outputRoot, "node_modules"), requiredRuntimeModules).map((claim) => ({
      relativePath: relative(outputRoot, claim.path).replaceAll("\\", "/"),
      owner: claim.owner,
    })),
  ];
}
