import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject, type ProjectResult } from "./project.ts";
import { MAX_VELAR_PROJECT_MODULES } from "./source-limits.ts";

/**
 * One compiled root of a `velar check` run: the project entry first, then every
 * `*.test.vel` module, which no import reaches and which therefore has to be
 * compiled as a root of its own.
 */
export interface CheckedProjectRoot {
  readonly result: ProjectResult;
  readonly errors: readonly string[];
}

export interface CheckedProject {
  readonly project: ProjectResult;
  readonly roots: readonly CheckedProjectRoot[];
  readonly compiled: ReadonlySet<string>;
  readonly notices: readonly string[];
  readonly errors: readonly string[];
}

/**
 * D66 ruling 7A: `velar repro` has to bundle the failure `velar check` reports,
 * so both commands read the project through this one function. A repro that
 * compiled the project its own way would eventually bundle a different failure
 * than the one the author saw.
 */
export async function checkResolvedProject(config: VelarProjectConfig, input: string | null): Promise<CheckedProject> {
  const project = await compileProject(config.entryPath, new Map(), {
    projectRoot: config.root,
    publicRoot: config.publicDir,
    extensions: config.compilerExtensions,
    extensionConfig: config.extensionConfig,
    framework: config.framework,
  });
  // A `*.test.vel` module is not reachable from the entry, so the module-graph
  // walk never saw one: `const n: number = "not a number"` inside a test passed
  // `check` and `build` (audit 12). Test source is source the author owns and
  // answers to the same compiler; it stays out of the build *output*, because
  // checking is not emitting.
  const testModules = input?.endsWith(".vel") ? [] : await projectTestModules(config);
  const compiled = new Set(project.modules.map((module) => module.inputPath));
  // MOD-I1: resolution failures and module diagnostics print together —
  // exactly as `velar run` reports them — so one unresolved import can never
  // bury the compiler's own diagnostics for everything else.
  const roots: CheckedProjectRoot[] = [{
    result: project,
    errors: [
      ...project.failures.map((failure) => `${failure.path}: ${failure.message}`),
      ...project.modules.flatMap((module) => module.result.diagnostics.map((item) => formatDiagnostic(module.result.source, item))),
    ],
  }];
  for (const file of testModules) {
    const testProject = await compileProject(file, new Map(), {
      sourceRoot: config.root,
      projectRoot: config.root,
      publicRoot: config.publicDir,
      extensions: config.compilerExtensions,
      extensionConfig: config.extensionConfig,
      framework: config.framework,
      exportTestFunctions: true,
    });
    const errors: string[] = testProject.failures.map((failure) => `${failure.path}: ${failure.message}`);
    for (const module of testProject.modules) {
      if (compiled.has(module.inputPath)) continue;
      compiled.add(module.inputPath);
      errors.push(...module.result.diagnostics.map((item) => formatDiagnostic(module.result.source, item)));
    }
    roots.push({ result: testProject, errors });
  }
  return {
    project,
    roots,
    compiled,
    notices: project.notices.map((notice) => `${notice.path}: notice: ${notice.message}`),
    errors: roots.flatMap((root) => root.errors),
  };
}

/** Exactly what a `velar check` run writes to stderr, without the repro hint. */
export function formatCheckOutput(checked: CheckedProject): string {
  const notices = checked.notices.map((notice) => `${notice}\n`).join("");
  return checked.errors.length > 0 ? `${notices}${checked.errors.join("\n\n")}\n` : notices;
}

/** Every `*.test.vel` root in the project — the modules no import reaches. */
export async function projectTestModules(config: VelarProjectConfig): Promise<string[]> {
  return (await discoverVelarSources(config)).filter((path) => path.endsWith(".test.vel"));
}

export async function discoverVelarSources(config: VelarProjectConfig): Promise<string[]> {
  const output: string[] = [];
  const excluded = new Set([config.outDir, config.publicDir]);
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".velar" || excluded.has(path)) continue;
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".vel")) {
        output.push(path);
        if (output.length > MAX_VELAR_PROJECT_MODULES) {
          throw new RangeError(`A VelarScript project cannot contain more than ${MAX_VELAR_PROJECT_MODULES} source modules`);
        }
      }
    }
  };
  await visit(config.root);
  return output.sort();
}
