/**
 * `velar build` for a Node application: the compiled modules, the copied public
 * tree, the server configuration snapshot, the reserved package manifest, and
 * the verified Node production manifest.
 */

import { mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { type AdditionalBuildInput } from "../build-input-boundary.ts";
import { commitBuildOutputDirectory, discardBuildStaging } from "../build-output-directory.ts";
import { BUILD_STAGING_MARKER, writeExclusiveBuildFile } from "../build-staging.ts";
import { requiredCompilerRuntimeModules } from "../compiler-runtime-modules.ts";
import { prepareDirectoryFrozenPackagePlan } from "../directory-frozen-package-preflight.ts";
import { assertUniqueEmbeddedModuleOutputs } from "../embedded-modules.ts";
import type { JavaScriptBuildMode } from "../javascript-output.ts";
import type { NodeApplicationConfig } from "../node-application-config.ts";
import { nodeApplicationEntry } from "../node-application.ts";
import { NODE_BUILD_MANIFEST_NAME, writeNodeProductionManifest } from "../node-production-build.ts";
import { verifyNodeProductionBuildForCommit } from "../node-production-verifier.ts";
import { nodeRuntimeDependencyOutputClaims } from "../node-runtime-dependencies.ts";
import { writeNodeStandardModulesIntoAssembly } from "../node-standard-module-output.ts";
import { assemblePackageOutput } from "../package-output-assembler.ts";
import { projectModuleOutputRelativePath } from "../package-output-layout.ts";
import { assertProjectOutputNamespace } from "../project-output-namespace.ts";
import type { ProjectResult } from "../project.ts";
import { writeProjectPackageBuildPlan, writeProjectResources } from "../resource-output.ts";
import { readConfiguredServerConfiguration, writeConfiguredServerConfiguration } from "../server-configuration-snapshot.ts";
import { copyPublicAssets } from "../static-deployment.ts";
import { mapBuildOutputs, rewriteVelarPackageImports, writeCompiled } from "./compiled.ts";
import { type BuildOutputReplacement, prepareBuildStaging } from "./staging.ts";

export async function writeNodeProductionApplication(
  project: ProjectResult,
  outputDirectory: string,
  config: NodeApplicationConfig,
  replacement: BuildOutputReplacement,
  mode: JavaScriptBuildMode,
  sourceMaps: boolean,
  buildInputs: readonly AdditionalBuildInput[],
): Promise<void> {
  const application = nodeApplicationEntry(project);
  const runtimeModules = requiredCompilerRuntimeModules(project);
  const entry = application.entry;
  const configuration = config.configuration === null
    ? null
    : await readConfiguredServerConfiguration(project.projectRoot, config.configuration);
  const configuredBuildInputs: readonly AdditionalBuildInput[] = [
    ...buildInputs,
    ...(configuration === null ? [] : [
      { path: configuration.sourcePath, kind: "file" as const, label: "Server configuration" },
      { path: configuration.canonicalSourcePath, kind: "file" as const, label: "Server configuration canonical identity" },
    ]),
  ];
  const packagePlan = await prepareDirectoryFrozenPackagePlan(
    project,
    outputDirectory,
    mode,
    sourceMaps,
    runtimeModules,
    configuredBuildInputs,
  );
  const staging = await prepareBuildStaging(outputDirectory, replacement, project, configuredBuildInputs);
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
        { path: join(staging.directory, "public"), kind: "tree", owner: "copied public asset tree" },
        { path: join(staging.directory, "package.json"), kind: "file", owner: "Node package manifest" },
        { path: join(staging.directory, NODE_BUILD_MANIFEST_NAME), kind: "file", owner: "Node production manifest" },
        { path: join(staging.directory, BUILD_STAGING_MARKER), kind: "file", owner: "directory build staging marker" },
        ...(configuration === null
          ? []
          : [{ path: join(staging.directory, configuration.relativePath), kind: "file" as const, owner: "server configuration snapshot" }]),
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
    await writeNodeStandardModulesIntoAssembly(
      staging.directory,
      project,
      packageAssembly,
      mode,
      null,
      configuration?.relativePath ?? null,
    );
    await copyPublicAssets(project.publicRoot, join(staging.directory, "public"), true);
    if (configuration !== null) await writeConfiguredServerConfiguration(staging.directory, configuration, [
      { relativePath: "package.json", owner: "the reserved Node package manifest" },
      { relativePath: NODE_BUILD_MANIFEST_NAME, owner: "the reserved Node production manifest" },
    ]);
    const entryPath = `./${relative(project.sourceRoot, entry.inputPath).replace(/\.vel$/u, ".js").replaceAll("\\", "/")}`;
    await writeExclusiveBuildFile(
      join(staging.directory, "package.json"),
      `${JSON.stringify({ name: "velar-node-build", private: true, type: "module" }, null, 2)}\n`,
      "Node package manifest 'package.json'",
    );
    await writeNodeProductionManifest(staging.directory, { mode, entry: entryPath.slice(2), configuration: config.configuration, sourceMaps });
    const authorization = await verifyNodeProductionBuildForCommit(staging.directory, process.cwd(), {
      allowBuildStagingMarker: true,
    });
    await commitBuildOutputDirectory(staging, authorization);
  } catch (error) {
    await discardBuildStaging(staging, error);
    throw error;
  }
}
