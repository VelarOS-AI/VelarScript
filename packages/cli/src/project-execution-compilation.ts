import type { VelarProjectConfig } from "./config.ts";
import { compileProject, type ProjectResult } from "./project.ts";
import { projectManifestBytes } from "./project-manifest-site.ts";
import { projectPackageTarget } from "./project-package-target.ts";
import { resolveProjectCompilationRoots } from "./project-source-package.ts";

interface ExecutionCompileOptions {
  /** Test entries are discovered across the project instead of inside the production source tree. */
  readonly projectWideSource?: boolean;
  readonly exportTestFunctions?: boolean;
}

export interface ProjectExecutionCompilation {
  readonly compile: (entry: string, options?: ExecutionCompileOptions) => Promise<ProjectResult>;
}

/** Freezes one source-package manifest and resource boundary for an execution command. */
export async function createProjectExecutionCompilation(
  config: VelarProjectConfig,
  explicitInput: string | null,
): Promise<ProjectExecutionCompilation> {
  const roots = await resolveProjectCompilationRoots(config, explicitInput);
  const overrides = roots.sourcePackageManifest
    ? new Map([[roots.sourcePackageManifest.path, roots.sourcePackageManifest.source]])
    : new Map<string, string>();
  return Object.freeze({
    compile: async (entry: string, options: ExecutionCompileOptions = {}) => compileProject(entry, overrides, {
      sourceRoot: options.projectWideSource ? config.root : roots.sourceRoot,
      sourceBoundary: options.projectWideSource ? config.root : roots.sourceBoundary,
      resourceBoundary: roots.resourceBoundary,
      ownedResourcePackage: roots.ownedResourcePackage,
      projectRoot: config.root,
      publicRoot: config.publicDir,
      extensions: config.compilerExtensions,
      extensionConfig: config.extensionConfig,
      framework: config.framework,
      packageTarget: projectPackageTarget(config),
      manifest: projectManifestBytes(config),
      ...(options.exportTestFunctions === undefined ? {} : { exportTestFunctions: options.exportTestFunctions }),
    }),
  });
}
