/**
 * One `.browser.test.vel` file, compiled once and written into each engine's
 * own tree, so that every engine's pass runs from the same compilation.
 */
import { join, relative } from "node:path";
import { formatDiagnostic, type ModuleTest } from "@velarscript/compiler";
import type { VelarProjectConfig } from "../config.ts";
import { registerNodeCompilerRuntimeResolver } from "../node-compiler-runtime-resolver.ts";
import { formatProjectFailures } from "../project-failure.ts";
import { createProjectExecutionCompilation } from "../project-execution-compilation.ts";
import type { ProjectModule, ProjectResult } from "../project.ts";
import { createSourcePackageImportSnapshots } from "../source-package-imports.ts";
import { writeStandardModuleSandbox } from "../standard-module-sandbox.ts";
import { compiledTestModulePath, portablePath, prepareCompiledTestProject, writeCompiledTestProjectPlan, type CompiledTestProjectPlan } from "../test-output.ts";

/**
 * One compiled test file, held so that every engine's pass can be written from
 * the same compilation instead of paying for — and re-reporting — its own.
 */
export interface BrowserTestEntry {
  readonly file: string;
  readonly project: ProjectResult;
  readonly entry: ProjectModule | undefined;
  readonly tests: readonly ModuleTest[];
}

export async function compileBrowserTest(
  file: string,
  config: VelarProjectConfig,
): Promise<BrowserTestEntry | null> {
  const compilation = await createProjectExecutionCompilation(config, null);
  const project = await compilation.compile(file, { projectWideSource: true, exportTestFunctions: true });
  const errors = [
    ...formatProjectFailures(project),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => formatDiagnostic(module.result.source, diagnostic))),
  ];
  if (errors.length > 0) {
    process.stderr.write(`✗ ${portablePath(relative(config.root, file))}\n${errors.join("\n\n")}\n`);
    return null;
  }
  const entry = project.modules.find((module) => module.inputPath === file);
  const tests = entry?.result.moduleInterface.tests ?? [];
  if (tests.length === 0) {
    process.stderr.write(`✗ ${portablePath(relative(config.root, file))} declares no tests\n`);
    return null;
  }
  return { file, project, entry, tests };
}

/** Writes one compiled test file into an engine's own tree and names its entry. */
export async function writeBrowserTestEntry(
  entry: BrowserTestEntry,
  outputRoot: string,
  config: VelarProjectConfig,
  runtimeModules: ReadonlySet<string>,
  plan?: CompiledTestProjectPlan,
): Promise<string> {
  await writeCompiledTestProjectPlan(plan ?? await prepareCompiledTestProject(entry.project, outputRoot, true, runtimeModules));
  return entry.entry
    ? compiledTestModulePath(entry.project, entry.entry, outputRoot)
    : join(outputRoot, relative(config.root, entry.file).replace(/\.vel$/u, ".js"));
}

export async function installBrowserCompilerRuntime(
  outputRoot: string,
  config: VelarProjectConfig,
  runtimeModules: ReadonlySet<string>,
  entries: readonly BrowserTestEntry[],
): Promise<{
  readonly resolver: ReturnType<typeof registerNodeCompilerRuntimeResolver>;
  readonly plans: ReadonlyMap<BrowserTestEntry, CompiledTestProjectPlan>;
}> {
  // Every test graph names its native and generated outputs before runtime
  // files are written; a later file cannot discover a collision after launch.
  const plans = new Map<BrowserTestEntry, CompiledTestProjectPlan>();
  const snapshots = createSourcePackageImportSnapshots();
  for (const entry of entries) {
    plans.set(entry, await prepareCompiledTestProject(entry.project, outputRoot, true, runtimeModules, snapshots));
  }
  await writeStandardModuleSandbox(outputRoot, config, runtimeModules);
  const resolver = registerNodeCompilerRuntimeResolver(
    outputRoot,
    runtimeModules,
    entries.flatMap((entry) => [...entry.project.velarArtifactImports.values()]),
  );
  return {resolver, plans};
}
