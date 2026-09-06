import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { VelarProjectConfig } from "./config.ts";
import { writeNodeRuntimeDependencies } from "./node-runtime-dependencies.ts";
import { assemblePackageOutput, writePackageOutputManifests } from "./package-output-assembler.ts";
import {
  standardRuntimePackageLayout,
  standardRuntimePackageRoot,
} from "./standard-runtime-package-layout.ts";
import { standardModuleSource, standardModuleSources } from "./standard-modules.ts";

/** Materializes only the runtime vocabulary selected by this target's extensions. */
export async function writeStandardModuleSandbox(
  root: string,
  config: VelarProjectConfig,
  selected?: ReadonlySet<string>,
): Promise<void> {
  const available = standardModuleSources(config.compilerExtensions);
  const nodeModulesRoot = join(root, "node_modules");
  const sources = selected ?? new Set(available.keys());
  for (const source of sources) {
    if (!available.has(source)) throw new Error(`Unknown VelarScript standard module '${source}'`);
  }
  for (const package_ of standardRuntimePackageLayout(sources)) {
    const packageRoot = standardRuntimePackageRoot(nodeModulesRoot, package_.name);
    await mkdir(packageRoot, {recursive: true});
    for (const module of package_.modules) {
      const outputPath = join(packageRoot, module.file);
      await mkdir(dirname(outputPath), {recursive: true});
      await writeFile(
        outputPath,
        standardModuleSource(module.source, config.extensionConfig, config.compilerExtensions)
          ?? available.get(module.source)!,
        "utf8",
      );
    }
  }
  await writePackageOutputManifests(assemblePackageOutput({
    outputRoot: root,
    layout: "sandbox",
    runtimeModules: sources,
  }));
}

/** Node sandboxes also carry the host packages imported by selected runtimes. */
export async function writeNodeStandardModuleSandbox(
  root: string,
  config: VelarProjectConfig,
  selected?: ReadonlySet<string>,
): Promise<void> {
  const used = selected ?? new Set(standardModuleSources(config.compilerExtensions).keys());
  await writeStandardModuleSandbox(root, config, used);
  await writeNodeRuntimeDependencies(join(root, "node_modules"), used);
}
