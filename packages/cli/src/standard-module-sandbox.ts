import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { velarNodeServeProjectConfig } from "@velarscript/node/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { nodeApplicationConfig, serverArtifactExtensionConfig } from "./node-application-config.ts";
import { nodeProjectIdentityOfManifest } from "./node-project-identity.ts";
import { writeNodeRuntimeDependencies } from "./node-runtime-dependencies.ts";
import { assemblePackageOutput, writePackageOutputManifests } from "./package-output-assembler.ts";
import {
  standardRuntimePackageLayout,
  standardRuntimePackageRoot,
} from "./standard-runtime-package-layout.ts";
import { projectCompilerExtensions, standardModuleSource, standardModuleSources } from "./standard-modules.ts";

/**
 * D114 F10-node, audit NO-D2: where a sandboxed program reads
 * `server.configuration` from.
 *
 * The declared path is project-relative — `application.yml` beside `velar.json`
 * — and a directory build resolves it by baking the output-relative path the
 * emitted `velar/server` joins onto its own directory. A sandbox baked nothing,
 * so the path was used verbatim against the process's working directory:
 * `velar dev` and `velar serve` survived only because they spawn the program
 * with the project root as its cwd, and `velar run`, which does not, failed on
 * an unmodified `velar create --template node` from every directory but one.
 *
 * A sandbox is an output directory like any other, so it bakes the same fact:
 * the path from the sandbox root back to the configuration file the project
 * declared. The offset a relative static root travels is already computed the
 * same way three lines below, and the two now agree — one project directory,
 * whichever command opened it.
 */
function sandboxServerConfigurationPath(root: string, config: VelarProjectConfig): string | null {
  const application = nodeApplicationConfig(config);
  if (!application || application.configuration === null) return null;
  return relative(root, resolve(config.root, application.configuration)).replaceAll("\\", "/");
}

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
  // D114 F9-node-cli item NO-D1: and *which* project it is, so an output that
  // ends up standing somewhere else does not read that directory as its own.
  // D114 SV-X1: both facts are filed under whichever extension carries
  // `velar/serve` for this project, so `velar run`, `velar dev` and `velar test`
  // bake them for a Server project as they always did for a Node one.
  const extensionConfig = velarNodeServeProjectConfig(
    serverArtifactExtensionConfig(config.extensionConfig, sandboxServerConfigurationPath(root, config)),
    projectCompilerExtensions(config.compilerExtensions),
    relative(root, config.root),
    nodeProjectIdentityOfManifest(config.manifestSource),
  );
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
