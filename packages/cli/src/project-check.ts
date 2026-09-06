import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { formatAdvisory, formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject, compileProjectEntries, type ProjectOwnedResourcePackage, type ProjectResult } from "./project.ts";
import { formatProjectFailures } from "./project-failure.ts";
import { MAX_VELAR_PROJECT_MODULES } from "./source-limits.ts";
import { nodeApplicationConfig } from "./node-application-config.ts";
import { projectLayerFindings } from "./project-layer-findings.ts";
import { configuredServerConfigurationFailure } from "./server-configuration-snapshot.ts";
import { projectPackageTarget } from "./project-package-target.ts";
import {
  checkedGraphSourcePackageContract,
  isExplicitProjectSourceInput,
  resolveProjectCompilationRoots,
  type ProjectSourcePackageContract,
} from "./project-source-package.ts";
import type { VelarPackageTarget } from "./source-package-manifest.ts";

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
  readonly sourcePackage?: ProjectSourcePackageContract | null;
  readonly roots: readonly CheckedProjectRoot[];
  readonly compiled: ReadonlySet<string>;
  readonly notices: readonly string[];
  readonly errors: readonly string[];
  readonly advisories: readonly string[];
}

interface AdditionalProjectRootContext {
  readonly resourceBoundary: string;
  readonly ownedResourcePackage: ProjectOwnedResourcePackage | null;
  readonly packageTarget: VelarPackageTarget;
  readonly emitSourceMaps: boolean;
}

async function checkAdditionalProjectRoots(
  config: VelarProjectConfig,
  sources: readonly string[],
  compiled: Set<string>,
  roots: CheckedProjectRoot[],
  context: AdditionalProjectRootContext,
): Promise<void> {
  const checkAdditionalRoot = async (file: string, isTestModule: boolean): Promise<void> => {
    const rootProject = await compileProject(file, new Map(), {
      sourceRoot: config.root,
      resourceBoundary: context.resourceBoundary,
      ownedResourcePackage: context.ownedResourcePackage,
      projectRoot: config.root,
      publicRoot: config.publicDir,
      extensions: config.compilerExtensions,
      extensionConfig: config.extensionConfig,
      framework: config.framework,
      packageTarget: context.packageTarget,
      ...(isTestModule ? { exportTestFunctions: true } : {}),
      emitSourceMaps: context.emitSourceMaps,
    });
    const errors: string[] = formatProjectFailures(rootProject);
    const advisories: string[] = [];
    for (const module of rootProject.modules) {
      if (compiled.has(module.inputPath)) continue;
      compiled.add(module.inputPath);
      errors.push(...module.result.diagnostics.map((item) => formatDiagnostic(module.result.source, item)));
      advisories.push(...module.result.advisories.map((item) => formatAdvisory(module.result.source, item)));
    }
    roots.push({ result: rootProject, errors, advisories });
  };

  for (const file of sources.filter((path) => path.endsWith(".test.vel"))) {
    await checkAdditionalRoot(file, true);
  }
  // The `compiled` guard stands before compilation: an orphan may import a
  // second orphan that therefore must not be compiled and reported twice.
  for (const file of sources) {
    if (file.endsWith(".test.vel") || compiled.has(file)) continue;
    await checkAdditionalRoot(file, false);
  }
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
  options: {
    readonly emitSourceMaps?: boolean;
    /** `--out` and frozen ABI entry checks retain their explicit single-entry scope. */
    readonly includePackageEntries?: boolean;
    readonly packageTarget?: VelarPackageTarget;
    readonly sourceRoot?: string;
    readonly sourceBoundary?: string;
    readonly resourceBoundary?: string;
    readonly ownedResourcePackage?: ProjectOwnedResourcePackage | null;
  } = {},
): Promise<CheckedProject> {
  const packageTarget = options.packageTarget ?? projectPackageTarget(config);
  const compilationRoots = await resolveProjectCompilationRoots(config, input, options.includePackageEntries !== false);
  const sourceOverrides = compilationRoots.sourcePackageManifest
    ? new Map([[compilationRoots.sourcePackageManifest.path, compilationRoots.sourcePackageManifest.source]])
    : new Map<string, string>();
  const project = await compileProjectEntries(compilationRoots.entries, config.entryPath, sourceOverrides, {
    sourceRoot: options.sourceRoot ?? compilationRoots.sourceRoot,
    sourceBoundary: options.sourceBoundary ?? compilationRoots.sourceBoundary,
    resourceBoundary: options.resourceBoundary ?? compilationRoots.resourceBoundary, ownedResourcePackage: options.ownedResourcePackage ?? compilationRoots.ownedResourcePackage,
    projectRoot: config.root,
    publicRoot: config.publicDir,
    extensions: config.compilerExtensions,
    extensionConfig: config.extensionConfig,
    framework: config.framework,
    packageTarget,
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
  const sources = isExplicitProjectSourceInput(config) ? [] : await discoverVelarSources(config);
  const compiled = new Set(project.modules.map((module) => module.inputPath));
  // MOD-I1: resolution failures and module diagnostics print together —
  // exactly as `velar run` reports them — so one unresolved import can never
  // bury the compiler's own diagnostics for everything else.
  // SV-I6: a manifest that declares a Server configuration file declares part of
  // the project's arrangement, and `velar check` judges the arrangement. Read
  // from the one definition `velar build` reads, so both refuse in one sentence
  // instead of `check` calling a tree clean that `build` then refuses.
  const declaredConfiguration = nodeApplicationConfig(config)?.configuration ?? null;
  const arrangement = declaredConfiguration === null
    ? null
    : await configuredServerConfigurationFailure(config.root, declaredConfiguration);
  const entryErrors = [
    ...(arrangement === null ? [] : [arrangement]),
    ...formatProjectFailures(project),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((item) => formatDiagnostic(module.result.source, item))),
  ];
  const roots: CheckedProjectRoot[] = [{
    result: project,
    errors: entryErrors,
    advisories: project.modules.flatMap((module) => module.result.advisories.map((item) => formatAdvisory(module.result.source, item))),
  }];
  // The project layer's own refusals, on the entry root's channel, from the one
  // function `velar fix` reads them from too.
  entryErrors.push(...projectLayerFindings(config, project).map((finding) => finding.message));
  // One extra root, compiled on its own. It is deliberately *not* folded into
  // the `compileProjectEntries` call above: every entry handed to that call has
  // its `@main` body emitted, so adding roots there would change what a build
  // writes. Compiling each root separately keeps this a check-only widening.
  // A module reached from two roots is compiled twice and reported once —
  // `compiled` is the registry that decides which root reports it.
  // D56 rule 130, the gate that never reads: a `.vel` file nothing imports was
  // walked by no root above, so `check` printed the same module count it would
  // have printed without the file and exited 0 over two plain type errors. The
  // generated AGENTS.md tells an author `velar check` type-checks the whole
  // project, and during a refactor — where a module is orphaned for an
  // afternoon — "the gate is green" and "the tree compiles" have to keep
  // meaning the same thing. Every remaining source is therefore a root too.
  //
  // Files are visited in `discoverVelarSources` order, which is sorted, so
  // which mutually-unreached module becomes the root is deterministic.
  await checkAdditionalProjectRoots(config, sources, compiled, roots, {
    resourceBoundary: compilationRoots.resourceBoundary,
    ownedResourcePackage: compilationRoots.ownedResourcePackage,
    packageTarget,
    emitSourceMaps: options.emitSourceMaps !== false,
  });
  return {
    project,
    sourcePackage: checkedGraphSourcePackageContract(
      config,
      roots.filter((root, index) => index === 0 || root.errors.length > 0).map((root) => root.result),
      compilationRoots.sourcePackage,
    ),
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
  if (isExplicitProjectSourceInput(config)) return [];
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
