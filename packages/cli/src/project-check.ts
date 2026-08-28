import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { formatAdvisory, formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject, compileProjectEntries, type ProjectResult } from "./project.ts";
import { MAX_VELAR_PROJECT_MODULES } from "./source-limits.ts";
import { nodeApplicationConfig } from "./node-application.ts";
import { applicationEntry, applicationEntryMigration, type ApplicationEntryMigration } from "./application-entry.ts";

/**
 * One compiled root of a `velar check` run: the project entry first, then every
 * `*.test.vel` module, then every remaining `.vel` source in the project that
 * nothing reached — each of them a module no import walks to, and each therefore
 * compiled as a root of its own.
 */
export interface CheckedProjectRoot {
  readonly result: ProjectResult;
  readonly errors: readonly string[];
  /**
   * D89: the advisory channel, kept out of `errors` on purpose. `velar check`
   * prints these and still exits 0, so nothing that decides pass/fail may read
   * this field.
   */
  readonly advisories: readonly string[];
}

export interface CheckedProject {
  readonly project: ProjectResult;
  readonly roots: readonly CheckedProjectRoot[];
  readonly compiled: ReadonlySet<string>;
  readonly notices: readonly string[];
  readonly errors: readonly string[];
  readonly advisories: readonly string[];
}

/**
 * D66 ruling 7A: `velar repro` has to bundle the failure `velar check` reports,
 * so both commands read the project through this one function. A repro that
 * compiled the project its own way would eventually bundle a different failure
 * than the one the author saw.
 */
export async function checkResolvedProject(
  config: VelarProjectConfig,
  input: string | null,
  options: { readonly emitSourceMaps?: boolean } = {},
): Promise<CheckedProject> {
  const project = await compileProjectEntries([config.entryPath, ...config.workerEntries.values()], config.entryPath, new Map(), {
    projectRoot: config.root,
    publicRoot: config.publicDir,
    extensions: config.compilerExtensions,
    extensionConfig: config.extensionConfig,
    framework: config.framework,
    emitSourceMaps: options.emitSourceMaps !== false,
  });
  // Every `.vel` file in the project, walked once and split between the two
  // extra-root passes below. Neither kind is reachable from the entry, and the
  // rule they share is the one audit 12 wrote down for tests: source the author
  // owns answers to the same compiler, and it stays out of the build *output*,
  // because checking is not emitting.
  //
  // A single-file `velar check src/thing.vel` names its own scope, so it keeps
  // it — the walk is skipped and that file's graph is the whole run.
  const sources = input?.endsWith(".vel") ? [] : await discoverVelarSources(config);
  const testModules = sources.filter((path) => path.endsWith(".test.vel"));
  const compiled = new Set(project.modules.map((module) => module.inputPath));
  // MOD-I1: resolution failures and module diagnostics print together —
  // exactly as `velar run` reports them — so one unresolved import can never
  // bury the compiler's own diagnostics for everything else.
  const entryErrors = [
    ...project.failures.map((failure) => `${failure.path}: ${failure.message}`),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((item) => formatDiagnostic(module.result.source, item))),
  ];
  const roots: CheckedProjectRoot[] = [{
    result: project,
    errors: entryErrors,
    advisories: project.modules.flatMap((module) => module.result.advisories.map((item) => formatAdvisory(module.result.source, item))),
  }];
  // The project layer's own refusals, on the entry root's channel, from the one
  // function `velar fix` reads them from too.
  entryErrors.push(...projectLayerFindings(config, input, project).map((finding) => finding.message));
  // One extra root, compiled on its own. It is deliberately *not* folded into
  // the `compileProjectEntries` call above: every entry handed to that call has
  // its `@main` body emitted, so adding roots there would change what a build
  // writes. Compiling each root separately keeps this a check-only widening.
  // A module reached from two roots is compiled twice and reported once —
  // `compiled` is the registry that decides which root reports it.
  const checkAdditionalRoot = async (file: string, isTestModule: boolean): Promise<void> => {
    const rootProject = await compileProject(file, new Map(), {
      sourceRoot: config.root,
      projectRoot: config.root,
      publicRoot: config.publicDir,
      extensions: config.compilerExtensions,
      extensionConfig: config.extensionConfig,
      framework: config.framework,
      ...(isTestModule ? { exportTestFunctions: true } : {}),
      emitSourceMaps: options.emitSourceMaps !== false,
    });
    const errors: string[] = rootProject.failures.map((failure) => `${failure.path}: ${failure.message}`);
    const advisories: string[] = [];
    for (const module of rootProject.modules) {
      if (compiled.has(module.inputPath)) continue;
      compiled.add(module.inputPath);
      errors.push(...module.result.diagnostics.map((item) => formatDiagnostic(module.result.source, item)));
      advisories.push(...module.result.advisories.map((item) => formatAdvisory(module.result.source, item)));
    }
    roots.push({ result: rootProject, errors, advisories });
  };
  for (const file of testModules) await checkAdditionalRoot(file, true);
  // D56 rule 130, the gate that never reads: a `.vel` file nothing imports was
  // walked by no root above, so `check` printed the same module count it would
  // have printed without the file and exited 0 over two plain type errors. The
  // generated AGENTS.md tells an author `velar check` type-checks the whole
  // project, and during a refactor — where a module is orphaned for an
  // afternoon — "the gate is green" and "the tree compiles" have to keep
  // meaning the same thing. Every remaining source is therefore a root too.
  //
  // The `compiled` guard stands *before* the compile, not only before the
  // report: one orphan may import another, and the importer's own walk already
  // checked it. Files are visited in `discoverVelarSources` order, which is
  // sorted, so which of two mutually-unreached modules becomes the root — and
  // therefore which root's diagnostics list carries a shared module — does not
  // depend on the filesystem's iteration order.
  for (const file of sources) {
    if (file.endsWith(".test.vel") || compiled.has(file)) continue;
    await checkAdditionalRoot(file, false);
  }
  return {
    project,
    roots,
    compiled,
    notices: project.notices.map((notice) => `${notice.path}: notice: ${notice.message}`),
    errors: roots.flatMap((root) => root.errors),
    advisories: roots.flatMap((root) => root.advisories),
  };
}

/**
 * Exactly what a `velar check` run writes to stderr, without the repro hint.
 * D89: advisories print between the notices and the errors — after the
 * project-level remarks, before the failures — and they print whether or not
 * the check failed, because an advisory is not a failure and is never the
 * reason a build stopped.
 */
export function formatCheckOutput(checked: CheckedProject): string {
  const notices = checked.notices.map((notice) => `${notice}\n`).join("");
  const advisories = checked.advisories.length > 0 ? `${checked.advisories.join("\n\n")}\n` : "";
  return checked.errors.length > 0
    ? `${notices}${advisories}${checked.errors.join("\n\n")}\n`
    : `${notices}${advisories}`;
}

/**
 * A refusal the CLI's project layer owns rather than the compiler: a rule about
 * how the *project* is arranged, which no single module's compile can see.
 *
 * `message` is what both commands print, verbatim. `fix` is the provably
 * equivalent rewrite that answers it, where the shape admits one; a finding with
 * no fix is a finding `velar fix` reports and leaves alone.
 */
export interface ProjectLayerFinding {
  readonly message: string;
  readonly fix: ApplicationEntryMigration | null;
}

/**
 * Every project-layer rule, evaluated once, for whichever command asked.
 *
 * This function is the reason `velar fix` cannot answer "0 diagnostics remain"
 * over a tree `velar check` refuses. The fixer reads the compiler's diagnostic
 * channel, and these rules were never on it: an entry missing its `@main` region
 * failed `check` with exit 1 while `fix` reported a clean tree and exited 0 —
 * the F4 falsehood again, from the one channel the F4 wave did not share. Roots
 * were the first half of that sharing (`additionalProjectRoots`); this is the
 * other half, and neither command owns a copy of a rule.
 *
 * Both preconditions are part of the rule set rather than of either caller:
 *
 *  - A single-file input names its own scope, exactly as it does for the tree
 *    walk. Asking a project-arrangement question about one file answers it
 *    about a project the author did not name.
 *  - A tree the compiler already refused is not asked. "Does the entry declare
 *    `@main`" has no reliable answer over a module that did not parse, and
 *    `check` is already refusing for a better reason.
 */
export function projectLayerFindings(
  config: VelarProjectConfig,
  input: string | null,
  project: ProjectResult,
): readonly ProjectLayerFinding[] {
  if (input?.endsWith(".vel")) return [];
  if (project.failures.length > 0 || project.modules.some((module) => module.result.diagnostics.length > 0)) return [];
  // Web、Desktop、Node 和 Server 共用同一入口契约：外部宿主只执行清单选中的
  // 模块，真正的启动动作必须写在该模块的 @main 区域中。单文件检查仍允许
  // 检查普通库模块；完整应用项目则在这里统一拦截缺少入口区域的情况。
  if (config.kind === "application" && (config.framework || nodeApplicationConfig(config))) {
    try { applicationEntry(project); }
    catch (error) {
      return [{
        message: error instanceof Error ? error.message : "Application entry validation failed",
        fix: applicationEntryMigration(project),
      }];
    }
  } else if (config.kind === "library") {
    const entry = project.modules.find((module) => module.inputPath === project.entryPath);
    if (entry?.result.hasMain) {
      // Deleting the region would delete the startup the author wrote, and
      // moving it needs an application project that does not exist yet. There is
      // no rewrite here that is the author's own, so there is no fix.
      return [{
        message: `${project.entryPath}: A library entry cannot declare '@main'; move startup into an application project`,
        fix: null,
      }];
    }
  }
  return [];
}

/**
 * Every source a whole-project run treats as a root beyond the entry's own
 * graph — `*.test.vel` modules and the files nothing imports alike.
 *
 * `velar check` and `velar fix` read this one roster so that a diagnostic
 * `check` refuses over is always a diagnostic `fix` can reach. When they
 * disagreed, `fix` answered "0 diagnostics remain" over a tree `check` was
 * refusing, which is the same false claim in the opposite direction.
 *
 * A root an earlier root already walked is dropped by the caller rather than
 * here: which files those are is known only once something has been compiled.
 */
export async function additionalProjectRoots(config: VelarProjectConfig, input: string | null): Promise<string[]> {
  // A single-file input names its own scope, exactly as it does for `check`.
  if (input?.endsWith(".vel")) return [];
  return (await discoverVelarSources(config)).filter((path) => path !== config.entryPath);
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
