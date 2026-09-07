/** `velar package`: the checked application handed to its target-owned packaging host. */

import { loadApplicationPackageHost, validateApplicationPackageResult } from "../application-package-host.ts";
import { directoryBuildInputs } from "../build-input-boundary.ts";
import { packageFrameworkOutput, writeFrameworkProductionApplication } from "../build/framework.ts";
import type { VelarProjectConfig } from "../config.ts";
import { hostErrorMessage } from "../host-error.ts";
import type { ProjectResult } from "../project.ts";

export async function packageCheckedApplication(
  project: ProjectResult,
  projectConfig: VelarProjectConfig,
): Promise<number> {
  if (!project.framework) {
    process.stderr.write("velar package: this project does not enable an application target\n");
    return 1;
  }
  try {
    const packageHost = await loadApplicationPackageHost(projectConfig);
    let buildRequests = 0;
    let frameworkBuild: Promise<void> | null = null;
    const packageResult = await packageHost.packageApplication({
      projectRoot: projectConfig.root,
      config: projectConfig.framework!.config,
      buildFramework: async (requestedOutput) => {
        buildRequests += 1;
        if (buildRequests > 1) throw new Error("application package host requested more than one framework build");
        const outputDirectory = packageFrameworkOutput(projectConfig.root, requestedOutput);
        frameworkBuild = writeFrameworkProductionApplication(
          project,
          outputDirectory,
          { forced: false, declared: false, projectRoot: projectConfig.root },
          "production",
          projectConfig.build.sourceMaps,
          await directoryBuildInputs(projectConfig, [project]),
        );
        await frameworkBuild;
      },
    });
    if (buildRequests !== 1 || !frameworkBuild) throw new Error("application package host did not request exactly one checked framework build");
    await frameworkBuild;
    const result = validateApplicationPackageResult(packageResult, projectConfig.root);
    process.stdout.write(`Packaged ${project.framework.host.displayName} application -> ${result.artifactPath}\n`);
    for (const detail of result.details) process.stdout.write(`${detail}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`velar package: ${hostErrorMessage(error)}\n`);
    return 1;
  }
}
