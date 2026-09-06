import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { GeneratedOutputClaim } from "./generated-output-claim.ts";
import {
  assertStandaloneRuntimeOwner,
  generatedRuntimePackageOwnership,
  writeGeneratedRuntimePackageReceipt,
} from "./generated-runtime-package.ts";
import { writeExclusiveBuildFile } from "./build-staging.ts";
import { renderJavaScriptOutput, type JavaScriptBuildMode } from "./javascript-output.ts";
import { requiredCompilerRuntimeModules } from "./compiler-runtime-modules.ts";
import { writeNodeRuntimeDependencies } from "./node-runtime-dependencies.ts";
import { serverArtifactExtensionConfig } from "./node-application-config.ts";
import {
  assemblePackageOutput,
  assertPackageOutputAssembly,
  type PackageOutputAssembly,
  writePackageOutputManifests,
} from "./package-output-assembler.ts";
import type { ProjectResult } from "./project.ts";
import {
  standardRuntimePackageLayout,
  standardRuntimePackageRoot,
  type StandardRuntimePackageOutput,
} from "./standard-runtime-package-layout.ts";
import { standardModuleSource } from "./standard-modules.ts";

/** Package roots generated for the selected compiler-owned runtime modules. */
export function standardRuntimePackageOutputClaims(
  nodeModulesRoot: string,
  used: ReadonlySet<string>,
): readonly GeneratedOutputClaim[] {
  return standardRuntimePackageLayout(used).map(({name}) => ({
    path: standardRuntimePackageRoot(nodeModulesRoot, name),
    kind: "tree",
    owner: `Standard runtime package '${name}'`,
  }));
}

/** Writes each namespace to its actual npm package instead of assuming `velar/*`. */
export async function writeNodeStandardModules(
  outputRoot: string,
  project: ProjectResult,
  replaceExisting = false,
  mode: JavaScriptBuildMode = "readable",
  standaloneOwner: string | null = null,
  artifactConfigurationPath: string | null = null,
  selectedRuntimeModules: ReadonlySet<string> = requiredCompilerRuntimeModules(project),
): Promise<void> {
  const used = selectedRuntimeModules;
  const nodeModulesRoot = join(outputRoot, "node_modules");
  const packages = standardRuntimePackageLayout(used);
  for (const package_ of packages) {
    const root = standardRuntimePackageRoot(nodeModulesRoot, package_.name);
    const ownership = await generatedRuntimePackageOwnership(root, package_.name);
    if (ownership.kind !== "absent") {
      if (!replaceExisting) throw new Error(`Standard runtime package '${package_.name}' conflicts with '${root}'`);
      if (standaloneOwner === null) {
        if (ownership.kind === "foreign") throw new Error(`Refusing to replace non-generated package '${root}'`);
      } else assertStandaloneRuntimeOwner(root, ownership, standaloneOwner);
    }
  }
  const assembly = assemblePackageOutput({
    outputRoot,
    layout: "build",
    runtimeModules: used,
    mode,
    standaloneOwner,
  });
  await writeNodeStandardModulesIntoAssembly(
    outputRoot,
    project,
    assembly,
    mode,
    standaloneOwner,
    artifactConfigurationPath,
  );
}

/** Completes a preflighted package assembly without claiming its shared roots twice. */
export async function writeNodeStandardModulesIntoAssembly(
  outputRoot: string,
  project: ProjectResult,
  assembly: PackageOutputAssembly,
  mode: JavaScriptBuildMode = "readable",
  standaloneOwner: string | null = null,
  artifactConfigurationPath: string | null = null,
): Promise<void> {
  const used = assembly.runtimeModules;
  assertPackageOutputAssembly(assembly, outputRoot, "build", used);
  const nodeModulesRoot = join(outputRoot, "node_modules");
  const packages = standardRuntimePackageLayout(used);
  for (const package_ of packages) await writeNodeStandardModulePackageContents(
    standardRuntimePackageRoot(nodeModulesRoot, package_.name),
    package_,
    project,
    mode,
    artifactConfigurationPath,
  );
  await writeNodeRuntimeDependencies(nodeModulesRoot, used);
  await writePackageOutputManifests(assembly);
  for (const package_ of packages) {
    await writeGeneratedRuntimePackageReceipt(
      standardRuntimePackageRoot(nodeModulesRoot, package_.name),
      package_.name,
      standaloneOwner === null ? null : basename(standaloneOwner),
    );
  }
}

/** Rejects foreign or differently-owned package roots before standalone staging starts. */
export async function assertNodeStandardModuleOutputAvailable(
  outputRoot: string,
  project: ProjectResult,
  standaloneOwner: string,
  selectedRuntimeModules: ReadonlySet<string> = requiredCompilerRuntimeModules(project),
): Promise<void> {
  const nodeModulesRoot = join(outputRoot, "node_modules");
  for (const package_ of standardRuntimePackageLayout(selectedRuntimeModules)) {
    const root = standardRuntimePackageRoot(nodeModulesRoot, package_.name);
    const ownership = await generatedRuntimePackageOwnership(root, package_.name);
    if (ownership.kind !== "absent") assertStandaloneRuntimeOwner(root, ownership, standaloneOwner);
  }
}

async function writeNodeStandardModulePackageContents(
  root: string,
  package_: StandardRuntimePackageOutput,
  project: ProjectResult,
  mode: JavaScriptBuildMode,
  artifactConfigurationPath: string | null,
): Promise<void> {
  await mkdir(root, {recursive: true});
  const extensionConfig = serverArtifactExtensionConfig(project.extensionConfig, artifactConfigurationPath);
  for (const module of package_.modules) {
    const source = standardModuleSource(module.source, extensionConfig, project.compilerExtensions);
    if (source === null) throw new Error(`Unknown VelarScript standard module '${module.source}'`);
    const outputPath = join(root, module.file);
    await mkdir(dirname(outputPath), {recursive: true});
    const output = await renderJavaScriptOutput({
      code: source,
      sourceMap: null,
      sourceFile: module.source,
      outputFile: outputPath,
      mode,
      sourceMaps: false,
      target: "node24",
    });
    await writeExclusiveBuildFile(outputPath, output.code, `Standard runtime module '${module.source}'`);
  }
}
