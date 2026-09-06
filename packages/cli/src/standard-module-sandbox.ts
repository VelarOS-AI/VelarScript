import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { nodeProjectRootOffsetConfig } from "@velarscript/node/compiler";
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
  // D114 F7-node-b item 2: a sandbox sits below the project it was compiled from
  // — `<project>/.velar/<prefix>-XXXX` for every one the CLI makes — so a
  // relative static root has to travel back up to mean what the author wrote.
  const extensionConfig = nodeProjectRootOffsetConfig(config.extensionConfig, relative(root, config.root));
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
        standardModuleSource(module.source, extensionConfig, config.compilerExtensions)
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
