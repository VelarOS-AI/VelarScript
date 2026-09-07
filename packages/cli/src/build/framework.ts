/**
 * `velar build` and `velar package` for a project that enables an application
 * framework host: the public assets, the browser bundle, the document, the
 * static deployment projection and the verified production manifest.
 */

import { isAbsolute, join, relative, resolve } from "node:path";
import { assertBuildInputsOutsideOutput, type AdditionalBuildInput, javascriptBuildInputs } from "../build-input-boundary.ts";
import { commitBuildOutputDirectory, discardBuildStaging } from "../build-output-directory.ts";
import { writeExclusiveBuildFile } from "../build-staging.ts";
import { createFrameworkArtifacts } from "../framework-host.ts";
import type { JavaScriptBuildMode } from "../javascript-output.ts";
import { buildProductionFramework, writeProductionManifest } from "../production-build.ts";
import { verifyProductionBuildForCommit } from "../production-verifier.ts";
import type { ProjectResult } from "../project.ts";
import { assertRequiredPublicAssets, copyPublicAssets, writeStaticDeployment } from "../static-deployment.ts";
import { type BuildOutputReplacement, prepareBuildStaging } from "./staging.ts";

export async function writeFrameworkProductionApplication(
  project: ProjectResult,
  outputDirectory: string,
  replacement: BuildOutputReplacement,
  mode: JavaScriptBuildMode,
  sourceMaps: boolean,
  buildInputs: readonly AdditionalBuildInput[],
): Promise<void> {
  if (!project.framework) throw new Error("the checked project has no framework host");
  const framework = project.framework;
  await assertRequiredPublicAssets(
    project.publicRoot,
    project.projectRoot,
    framework.host.requiredPublicAssets?.(framework.config) ?? [],
  );
  const staging = await prepareBuildStaging(outputDirectory, replacement, project, buildInputs);
  try {
    await copyPublicAssets(project.publicRoot, staging.directory);
    const production = await buildProductionFramework(project, staging.directory, mode, sourceMaps);
    await assertBuildInputsOutsideOutput(project, outputDirectory, [
      ...buildInputs,
      ...javascriptBuildInputs(production.inputPaths, "browser bundler input"),
    ]);
    const artifacts = createFrameworkArtifacts(project, false, {}, {
      entryPath: production.entryPath,
      stylesheetPath: production.stylesheetPath,
      includeStandardImports: false,
    });
    if (!artifacts) throw new Error("The framework host did not create an application entry");
    await writeExclusiveBuildFile(join(staging.directory, "index.html"), artifacts.html, "Framework document 'index.html'");
    const deployment = await writeStaticDeployment(
      staging.directory,
      artifacts.html,
      project.framework.host.staticDeployment(project.framework.config),
      production.framework,
    );
    await writeProductionManifest(staging.directory, production, deployment);
    const authorization = await verifyProductionBuildForCommit(staging.directory, process.cwd(), {
      allowBuildStagingMarker: true,
    });
    await commitBuildOutputDirectory(staging, authorization);
  } catch (error) {
    await discardBuildStaging(staging, error);
    throw error;
  }
}

export function packageFrameworkOutput(root: string, input: string): string {
  if (!isAbsolute(input)) throw new Error("application package host requested a non-absolute framework output path");
  const output = resolve(input);
  const fromRoot = relative(root, output);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
    throw new Error("application package host requested a framework output path outside the project root");
  }
  return output;
}
