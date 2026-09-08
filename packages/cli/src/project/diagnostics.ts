import { isBuiltin } from "node:module";
import { dirname, extname, resolve } from "node:path";
import {
  diagnostic,
  permanentNamespaceCoveringModule,
  type Advisory,
  type CompileResult,
  type Diagnostic,
  type ModuleInterface,
} from "@velarscript/compiler";
import { hostErrorMessage } from "../host-error.ts";
import { assertJavaScriptDataModuleTarget } from "../javascript-data-module.ts";
import { judgeJavaScriptSpecifier } from "../javascript-dependency-target.ts";
import {
  CIRCULAR_IMPORT_ADVISORY,
  planCircularImportAdvisories,
  resolveGraphAdvisories,
  type CircularImportReport,
} from "../project-graph-advisories.ts";
import { byCodeUnit } from "../stable-order.ts";
import { stronglyConnectedPaths } from "./scc.ts";
import {
  projectImportKey,
  projectModuleResult,
  type JavaScriptDependencyContext,
  type LoadedModule,
  type ModuleResolutionDiagnostic,
  type ProjectCompilation,
} from "./options.ts";
import type { ProjectFailure, ProjectModule, ProjectNotice } from "../project.ts";

export async function checkJavaScriptDependency(
  source: string,
  importerPath: string,
  context: JavaScriptDependencyContext,
): Promise<void> {
  if (source.startsWith(".")) {
    context.failures.push({
      path: importerPath,
      message: `Relative JavaScript import target '${source}' cannot be emitted; move the JavaScript module into a package and import it by package name`,
    });
    return;
  }
  if (isBuiltin(source)) {
    if (context.packageTarget !== "node") {
      context.recordResolution(
        importerPath,
        source,
        "VEL6006",
        `JavaScript Node builtin import ${JSON.stringify(source)} is available only to the Node target; the current target is '${context.packageTarget}'`,
      );
    }
    return;
  }
  if (source.startsWith("data:")) {
    try {
      assertJavaScriptDataModuleTarget(source, context.packageTarget);
    } catch (error) {
      context.recordResolution(
        importerPath,
        source,
        "VEL6006",
        `Inline JavaScript data module is not valid for the '${context.packageTarget}' target: ${hostErrorMessage(error)}`,
      );
    }
    return;
  }
  if (!context.resolveSpecifiers) return;
  const key = projectImportKey(importerPath, source);
  let verdict = context.verdicts.get(key);
  if (verdict === undefined) {
    verdict = await judgeJavaScriptSpecifier(source, importerPath, context.resolutionTarget, context.packageTarget);
    context.verdicts.set(key, verdict);
  }
  if (verdict) context.recordResolution(importerPath, source, verdict.code, verdict.message);
}


/**
 * D57 rule 136: how one standard module appears in the VEL6003 listing. A
 * module whose every export retired into a permanent namespace is still real —
 * the capability is there, only the spelling changed — so it stays listed and
 * says where its members went. Listing it bare sends the author to an import
 * VEL3008 refuses on the next step, which is the worst kind of diagnostic.
 * The annotation is derived from the migration roster the compiler rejects
 * those imports with, so the listing cannot fall behind a future migration.
 */
export function standardModuleListing(source: string, interfaces: ReadonlyMap<string, ModuleInterface>): string {
  const namespace = permanentNamespaceCoveringModule(source, interfaces.get(source)?.exports.keys() ?? []);
  return namespace ? `${source} (its members read as ${namespace}.name and need no import)` : source;
}

export function migratedStandardPackageDiagnostic(source: string): string | null {
  if (source === "velar/javascript") {
    return "Standard module 'velar/javascript' is not part of VelarScript; JavaScript and TypeScript tooling belongs to the consuming project";
  }
  if (source === "velar/text-buffer") {
    return "Standard module 'velar/text-buffer' is not part of VelarScript; applications must own or install their text-buffer implementation";
  }
  // D114 S3: the module retired into List members. The compiler already names
  // the member each imported function became, one report per name, so this one
  // answers the specifier without calling a retired module unknown.
  if (source === "velar/collections") {
    return "Standard module 'velar/collections' retired; every collection operation is a checked List member — values.groupBy(key) — and 'range' is a Core prelude name that needs no import";
  }
  return null;
}

/**
 * D71 rule 184 widened what `reactiveExports` means without widening its marker:
 * both an exported `state` and an exported `computed` are published as `"state"`
 * so that an imported bare read lowers through `.get()`. The marker therefore
 * says *reactive*, not which word the author wrote — printing it as a noun
 * called an exported `computed` a "state binding" and offered it a mutator it
 * can never have. The message names only what this map establishes, and points
 * at `action`, which is the vocabulary the language actually has; the derived
 * half gets its own sharper VEL5063 from the Web analyzer before it ever
 * reaches here.
 */
export function importedReactiveAssignmentDiagnostics(
  result: CompileResult,
  reactiveImports: ReadonlyMap<string, "state">,
): CompileResult {
  if (reactiveImports.size === 0) return result;
  const diagnostics = result.diagnostics.map((item) => {
    if (item.code !== "VEL3002" || !item.message.startsWith("Cannot assign to imported binding '")) return item;
    const reference = result.semanticIndex.references.find((candidate) => candidate.write
      && candidate.span.start === item.span.start
      && candidate.span.end === item.span.end);
    const imported = reference?.symbolId
      ? result.semanticIndex.imports.find((candidate) => candidate.localSymbolId === reference.symbolId)
      : null;
    const kind = imported ? reactiveImports.get(imported.local) : null;
    if (!kind) return item;
    return {
      ...item,
      message: `Cannot assign to imported reactive binding '${imported!.local}'; it is read-only here. Export an action from the owning module that changes it and call that instead`,
    };
  });
  return diagnostics.some((item, index) => item !== result.diagnostics[index])
    ? { ...result, diagnostics }
    : result;
}

const INITIALIZATION_CYCLE_DIAGNOSTIC = "VEL3019";
/** MOD-I5: the module-resolution diagnostic family (VEL6xxx). */
const MODULE_RESOLUTION_DIAGNOSTIC_PREFIX = "VEL6";

/** How one importer's static dependency specifier resolves to a loaded module, or does not. */
type ResolveDependency = (importerPath: string, source: string) => string | null;

/**
 * Whether either overlay has anything to say about this project. The common
 * project pays only this scan; every other exit recomputes from each module's
 * own compile output, so a report never outlives what produced it.
 */
function initializationCycleRelevance(
  modules: readonly ProjectModule[],
  resolutions: ReadonlyMap<string, readonly ModuleResolutionDiagnostic[]>,
  resolveDependency: ResolveDependency,
): { readonly topologyRelevant: boolean; readonly resolutionRelevant: boolean } {
  const carriesCycleDiagnostic = (module: ProjectModule): boolean =>
    module.result.diagnostics.some((item) => item.code === INITIALIZATION_CYCLE_DIAGNOSTIC);
  const carriesCycleAdvisory = (module: ProjectModule): boolean =>
    module.result.advisories.some((item) => item.code === CIRCULAR_IMPORT_ADVISORY);
  const carriesResolutionDiagnostic = (module: ProjectModule): boolean =>
    module.result.diagnostics.some((item) => item.code.startsWith(MODULE_RESOLUTION_DIAGNOSTIC_PREFIX));
  // Nothing to decide and nothing stale to clear: the common project pays only
  // this scan. Every other exit still recomputes from the module's own compile
  // output, so a diagnostic never outlives the cycle (or the resolution
  // failure) that produced it.
  const cycleRelevant = !modules.every((module) => module.result.initializationImportReads.length === 0 && !carriesCycleDiagnostic(module));
  const topologyRelevant = cycleRelevant
    || modules.some(carriesCycleAdvisory)
    || modules.some((module) => module.result.advisorySuppressions.length > 0) // CO-I2: only this pass can answer one.
    || modules.some((module) => module.result.semanticIndex.moduleReferences.some((reference) =>
      !reference.dynamic && resolveDependency(module.inputPath, reference.source) !== null));
  const resolutionRelevant = resolutions.size > 0 || modules.some(carriesResolutionDiagnostic);
  return { topologyRelevant, resolutionRelevant };
}

/**
 * Static evaluation edges in source order: import and re-export declarations,
 * excluding dynamic imports (they defer evaluation) and JavaScript or standard
 * modules (they are not .vel graph members). The dynamic targets are kept
 * because they are evaluation roots the host does reach.
 */
function staticEvaluationEdges(
  loaded: ReadonlyMap<string, LoadedModule>,
  resolveDependency: ResolveDependency,
  topologyRelevant: boolean,
): { readonly staticDependencies: Map<string, readonly string[]>; readonly dynamicRoots: string[] } {
  const staticDependencies = new Map<string, readonly string[]>();
  const dynamicRoots: string[] = [];
  if (topologyRelevant) {
    for (const [path, module] of loaded) {
      const output: string[] = [];
      const seen = new Set<string>();
      for (const reference of module.inspection.semanticIndex.moduleReferences) {
        const target = resolveDependency(path, reference.source);
        if (target === null) continue;
        if (reference.dynamic) {
          dynamicRoots.push(target);
          continue;
        }
        if (seen.has(target)) continue;
        seen.add(target);
        output.push(target);
      }
      staticDependencies.set(path, output);
    }
  }
  return { staticDependencies, dynamicRoots };
}

/**
 * The ESM evaluation order: dependency-first post-order following declaration
 * order, with in-progress modules skipped exactly as the host module loader
 * skips cycle back-edges. Roots are visited entry first, then dynamic-import
 * targets, then anything else the graph holds, each in a stable order so the
 * same sources always produce the same order.
 */
function initializationEvaluationOrder(
  loaded: ReadonlyMap<string, LoadedModule>,
  entryPath: string,
  staticDependencies: ReadonlyMap<string, readonly string[]>,
  dynamicRoots: readonly string[],
  cyclic: boolean,
): Map<string, number> {
  const order = new Map<string, number>();
  if (cyclic) {
    const visiting = new Set<string>();
    const roots = [entryPath, ...[...new Set(dynamicRoots)].sort(), ...[...loaded.keys()].sort()];
    for (const root of roots) {
      if (!loaded.has(root) || order.has(root)) continue;
      const frames: { readonly path: string; readonly dependencies: readonly string[]; next: number }[] = [];
      const begin = (path: string): void => {
        visiting.add(path);
        frames.push({ path, dependencies: staticDependencies.get(path) ?? [], next: 0 });
      };
      begin(root);
      while (frames.length > 0) {
        const frame = frames.at(-1)!;
        const dependency = frame.dependencies[frame.next];
        if (dependency !== undefined) {
          frame.next += 1;
          if (!order.has(dependency) && !visiting.has(dependency)) begin(dependency);
          continue;
        }
        frames.pop();
        visiting.delete(frame.path);
        if (!order.has(frame.path)) order.set(frame.path, order.size);
      }
    }
  }
  return order;
}

/** What the report below judges each module against: its component, the cycle set, and the order. */
interface InitializationTopology {
  readonly componentOf: ReadonlyMap<string, number>;
  readonly componentSizes: ReadonlyMap<number, number>;
  readonly cyclic: boolean;
  readonly circularImportReports: ReadonlyMap<string, CircularImportReport>;
  readonly order: ReadonlyMap<string, number>;
}

/** Tarjan over the static edges, the cyclic components it finds, and the evaluation order. */
function initializationCycleTopology(
  modules: readonly ProjectModule[],
  loaded: ReadonlyMap<string, LoadedModule>,
  entryPath: string,
  resolveDependency: ResolveDependency,
  topologyRelevant: boolean,
): InitializationTopology {
  const { staticDependencies, dynamicRoots } = staticEvaluationEdges(loaded, resolveDependency, topologyRelevant);
  // Tarjan over the static edges: only strongly connected members can read a
  // later-evaluating module, so everything else is skipped immediately.
  const componentOf = new Map<string, number>();
  if (topologyRelevant) {
    stronglyConnectedPaths(loaded.keys(), (path) => staticDependencies.get(path) ?? [])
      .forEach((members, component) => {
        for (const member of members) componentOf.set(member, component);
      });
  }
  const componentSizes = new Map<number, number>();
  for (const component of componentOf.values()) componentSizes.set(component, (componentSizes.get(component) ?? 0) + 1);
  const cyclicComponents = new Set(
    [...componentSizes.entries()].filter(([, size]) => size > 1).map(([component]) => component),
  );
  for (const [path, dependencies] of staticDependencies) {
    if (dependencies.includes(path)) {
      const component = componentOf.get(path);
      if (component !== undefined) cyclicComponents.add(component);
    }
  }
  const cyclic = cyclicComponents.size > 0;
  const componentMembers = new Map<number, string[]>();
  for (const [path, component] of componentOf) {
    componentMembers.set(component, [...(componentMembers.get(component) ?? []), path]);
  }
  const relativePathByInput = new Map(modules.map((module) => [module.inputPath, module.relativePath]));
  const circularImportReports = cyclic ? planCircularImportAdvisories({ // CO-C3: one cycle, one report.
    componentOf, cyclicComponents, componentMembers, staticDependencies, relativePathByInput, resolveDependency,
    moduleReferences: (path) => loaded.get(path)?.inspection.semanticIndex.moduleReferences ?? [],
  }) : new Map();
  const order = initializationEvaluationOrder(loaded, entryPath, staticDependencies, dynamicRoots, cyclic);
  return { componentOf, componentSizes, cyclic, circularImportReports, order };
}

/** The overlay itself: one pass over the modules, rebuilt from each one's own compile output. */
function applyInitializationCycleReports(
  modules: ProjectModule[],
  loaded: ReadonlyMap<string, LoadedModule>,
  resolutions: ReadonlyMap<string, readonly ModuleResolutionDiagnostic[]>,
  resolveDependency: ResolveDependency,
  topology: InitializationTopology,
): void {
  const { componentOf, componentSizes, cyclic, circularImportReports, order } = topology;
  for (let index = 0; index < modules.length; index += 1) {
    const module = modules[index]!;
    const path = module.inputPath;
    // The overlay is rebuilt from the module's own compile output every time,
    // so it is idempotent under incremental reuse in both directions: a
    // diagnostic is never duplicated, and a module that leaves a cycle gets its
    // emitted code back.
    const compiled = module.compiledResult ?? module.result;
    const additions: Diagnostic[] = [];
    const advisoryAdditions: Advisory[] = [];
    const planned = circularImportReports.get(path);
    if (planned) advisoryAdditions.push(planned.advisory);
    if (cyclic && (componentSizes.get(componentOf.get(path) ?? -1) ?? 0) > 1) {
      for (const read of compiled.initializationImportReads) {
        const imported = resolveDependency(path, read.source);
        const origin = originModule(imported, read.imported, loaded, resolveDependency);
        const target = origin.module;
        if (target === null || target === path) continue;
        if (componentOf.get(target) !== componentOf.get(path)) continue;
        // A `def` emits a hoisted function declaration that the host
        // initializes at link time, so a cycle member may call one before the
        // defining module evaluates. Every other export shape is in its
        // temporal dead zone until then.
        //
        // The exemption is a fact about the *origin* module's own export, so
        // it must be asked with the name that module declares. An aliasing
        // barrel (`export {value as helper}`) renames on the way through, and
        // asking with the import-site alias answered about an unrelated
        // export of the same name: it suppressed a real cycle read whenever
        // the origin happened to have a `def` under the alias, and reported a
        // correct program whenever the origin's `def` was renamed.
        if (origin.name !== null && loaded.get(target)?.inspection.moduleInterface.hoistedExports?.has(origin.name)) continue;
        const modulePosition = order.get(path);
        const targetPosition = order.get(target);
        if (modulePosition === undefined || targetPosition === undefined || targetPosition < modulePosition) continue;
        additions.push(diagnostic(
          INITIALIZATION_CYCLE_DIAGNOSTIC,
          `Move this read into a function, or extract the shared value into a third module; ${uninitializedModuleName(read.source, imported, target, loaded)} has not initialized when this line runs`,
          read.span,
        ));
      }
    }
    // MOD-I5: resolution failures overlay the same way, on the import
    // statement that caused them, rebuilt from the clean compile output so
    // reuse can never duplicate or orphan them.
    {
      const pending = resolutions.get(path) ?? [];
      const seen = new Set<string>();
      for (const item of pending) {
        const reference = compiled.semanticIndex.moduleReferences.find((candidate) => candidate.source === item.source)
          ?? compiled.semanticIndex.moduleReferences[0];
        const span = reference?.span ?? { start: 0, end: Math.min(1, compiled.source.text.length) };
        const key = `${item.code}\0${item.message}\0${span.start}`;
        if (seen.has(key)) continue;
        seen.add(key);
        additions.push(diagnostic(item.code, item.message, span));
      }
    }
    // CO-I2: the module's own diagnostics gate the stale report the way the
    // in-module rule does — an earlier failure can keep the graph from being the whole graph.
    const graph = resolveGraphAdvisories(compiled.source, advisoryAdditions, compiled.diagnostics.length === 0 ? compiled.advisorySuppressions : []);
    additions.push(...graph.diagnostics);
    if (additions.length === 0 && advisoryAdditions.length === 0) {
      if (module.compiledResult === undefined) continue;
      modules[index] = projectModuleResult(module, compiled);
      continue;
    }
    const diagnostics = [...compiled.diagnostics, ...additions]
      .sort((left, right) => left.span.start - right.span.start || byCodeUnit(left.code, right.code));
    const advisories = [...compiled.advisories, ...graph.advisories]
      .sort((left, right) => left.span.start - right.span.start || byCodeUnit(left.code, right.code));
    modules[index] = {
      ...module,
      compiledResult: compiled,
      result: additions.length === 0
        ? { ...compiled, diagnostics, advisories }
        : {
            ...compiled,
            // The compile() contract keeps reports ordered by span. Advisories
            // stay visible without entering this zero-diagnostics emit gate.
            diagnostics,
            advisories,
            code: null,
            sourceMap: null,
            embeddedModules: [],
            css: null,
            styleSegments: null,
            runtimeModules: [],
          },
    };
  }
}

// D31 item 23: module initialization cycles are rejected at compile time.
// The modules of a static import cycle evaluate in the emitted ESM
// post-order, so a module-initialization-position read of a binding whose
// source module evaluates later observes an uninitialized live binding and
// crashes with a bare ReferenceError. The module graph is fully known here,
// so the defect is diagnosed on the reading line instead. Reads inside
// function bodies stay legal — pure function cycles remain executable and
// receive the non-blocking project-graph advisory below — and
// cross-module mutually recursive record types never read a binding at all.
//
// The verdict is a property of the sources alone: it is computed from one
// evaluation order over the whole loaded graph, seeded by the project's own
// entry and then by every remaining evaluation root, never from the caller's
// entry list. `velar check` (one entry) and the language server (every file is
// an entry) therefore agree on the same project, and modules a build reaches
// only through `await import(...)` — additional roots the host does evaluate —
// are ordered instead of skipped.
export function appendInitializationCycleDiagnostics(
  modules: ProjectModule[],
  loaded: ReadonlyMap<string, LoadedModule>,
  velarImports: ReadonlyMap<string, string>,
  entryPath: string,
  resolutions: ReadonlyMap<string, readonly ModuleResolutionDiagnostic[]> = new Map(),
): void {
  const resolveDependency = (importerPath: string, source: string): string | null => {
    const target = source.startsWith(".") && extname(source) === ".vel"
      ? resolve(dirname(importerPath), source)
      : velarImports.get(projectImportKey(importerPath, source)) ?? null;
    return target !== null && loaded.has(target) ? target : null;
  };
  const { topologyRelevant, resolutionRelevant } = initializationCycleRelevance(modules, resolutions, resolveDependency);
  if (!topologyRelevant && !resolutionRelevant) return;
  const topology = initializationCycleTopology(modules, loaded, entryPath, resolveDependency, topologyRelevant);
  applyInitializationCycleReports(modules, loaded, resolutions, resolveDependency, topology);
}

/**
 * The module that declares an imported name, following `export {name} from
 * "source"` barrels, together with the name that module declares it under.
 * Judging a cycle read by the module the import names would let a barrel hide
 * the defining module, whose binding is the one that is actually
 * uninitialized at run time; judging it by the import-site alias would ask
 * the defining module about a name it may not use for this export.
 */
function originModule(
  target: string | null,
  imported: string | null,
  loaded: ReadonlyMap<string, LoadedModule>,
  resolveDependency: (importerPath: string, source: string) => string | null,
): { readonly module: string | null; readonly name: string | null } {
  let current = target;
  let name = imported;
  const seen = new Set<string>();
  while (current !== null && name !== null && !seen.has(`${current}\0${name}`)) {
    seen.add(`${current}\0${name}`);
    const reExport = loaded.get(current)?.inspection.moduleInterface.reExports.get(name);
    if (reExport === undefined) return { module: current, name };
    const next = resolveDependency(current, reExport.source);
    if (next === null) return { module: current, name };
    current = next;
    name = reExport.imported;
  }
  return { module: current, name };
}

/**
 * The module the author must open. Through a re-export barrel the specifier
 * written at the import site names a module that has fully initialized, so
 * naming it alone states something false; name the origin and keep the
 * specifier as the route to it.
 */
function uninitializedModuleName(
  source: string,
  imported: string | null,
  origin: string,
  loaded: ReadonlyMap<string, LoadedModule>,
): string {
  if (imported === origin) return `'${source}'`;
  return `'${loaded.get(origin)?.relativePath ?? origin}' (re-exported by '${source}')`;
}

/** The application host's own project-wide verdict, recorded as ordinary project failures. */
export function appendFrameworkValidationDiagnostics(
  compilation: ProjectCompilation,
  modules: readonly ProjectModule[],
): void {
  const { entryPath, failures, framework } = compilation;
  if (framework?.host.validateProject) {
    try {
      const messages = framework.host.validateProject({
        config: framework.config,
        modules: modules.map((module) => ({
          path: module.inputPath,
          imports: module.result.dependencies.filter((item) => !item.javascript).map((item) => item.source),
        })),
      });
      // DT-D1: a refusal that names a module and a specifier is a diagnostic
      // about that import line, so its span is read out of the module's own
      // module references — the span every VEL6xxx resolution failure lands on.
      // A host that answers with a bare sentence keeps the plain project-level
      // line, because it named no site to point at.
      for (const message of messages) {
        if (typeof message === "string") {
          failures.push({ path: entryPath, message });
          continue;
        }
        const module = modules.find((candidate) => candidate.inputPath === message.module);
        const span = module?.result.semanticIndex.moduleReferences
          .find((reference) => reference.source === message.specifier)?.span;
        failures.push(span === undefined
          ? { path: message.module, message: message.message }
          : { path: message.module, message: message.message, code: message.code, span });
      }
    } catch (error) {
      failures.push({ path: entryPath, message: `Application host validation failed: ${hostErrorMessage(error)}` });
    }
  }
}

export function uniqueFailures(failures: readonly ProjectFailure[]): readonly ProjectFailure[] {
  const seen = new Set<string>();
  return failures.filter((failure) => {
    const key = `${failure.path}\0${failure.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function uniqueNotices(notices: readonly ProjectNotice[]): readonly ProjectNotice[] {
  const seen = new Set<string>();
  return notices.filter((notice) => {
    const key = `${notice.path}\0${notice.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
