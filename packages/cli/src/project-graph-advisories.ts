/**
 * A18, the project graph's own advisory: where a circular module dependency is
 * reported, and how many times.
 *
 * CO-C3 + CO-I2. The charter states the contract this module implements:
 *
 * > `A18` reports a circular module dependency, and it is the project graph's
 * > advisory rather than any one module's: it is raised once the whole graph is
 * > read, and a `velar-allow A18` on the import line that closes the cycle
 * > answers it.
 *
 * What 0.30.0 shipped was one advisory per import edge of the cycle, so a
 * three-module cycle earned three identical reports and an author who meant
 * "this cycle is deliberate" had to write the same reason three times — of
 * which two became suppressions that suppressed nothing the moment the cycle
 * shrank, and which nothing ever reported as stale (CO-I2). One fact about a
 * graph is one report, and the line it lands on is the one the charter names:
 * the import that closes the cycle.
 *
 * "Closes" is decided the way a reader decides it — by walking the cycle and
 * finding the edge that returns to a module already on the walk. The walk is
 * seeded and ordered deterministically, so the same sources always name the
 * same line and a suppression written against it keeps working.
 *
 * D115 §一.1 / §三: this is `packages/cli/src/project.ts`'s graph-advisory half,
 * lifted out rather than added to a file already at its recorded ceiling.
 */
import { basename } from "node:path";
import {
  advisory,
  resolveDeferredAdvisorySuppressions,
  type Advisory,
  type AdvisorySuppression,
  type Diagnostic,
  type SourceText,
} from "@velarscript/compiler";
import { byCodeUnit } from "./stable-order.ts";

/** D114 MD-I4: an advisory's id is an A-roster id, so 'velar-allow' can name it. */
export const CIRCULAR_IMPORT_ADVISORY = "A18";

/** One static import edge as the graph pass sees it: where it is written and what it reaches. */
export interface ModuleReferenceEdge {
  readonly source: string;
  readonly span: { readonly start: number; readonly end: number };
  readonly dynamic: boolean;
}

export interface CircularImportPlanInput {
  /** The component id of every module the graph holds. */
  readonly componentOf: ReadonlyMap<string, number>;
  /** The components that are cycles — more than one member, or a self edge. */
  readonly cyclicComponents: ReadonlySet<number>;
  /** The members of every component, in whatever order the walk produced them. */
  readonly componentMembers: ReadonlyMap<number, readonly string[]>;
  /** Static evaluation edges in source order, as `appendInitializationCycleDiagnostics` built them. */
  readonly staticDependencies: ReadonlyMap<string, readonly string[]>;
  /** The project-relative name a reported module is named by; `basename` answers for the rest. */
  readonly relativePathByInput: ReadonlyMap<string, string>;
  /** The import and re-export references a module wrote, in source order. */
  readonly moduleReferences: (path: string) => readonly ModuleReferenceEdge[];
  /** The module an import specifier resolves to, or null when it leaves the graph. */
  readonly resolveDependency: (importerPath: string, source: string) => string | null;
}

/** The one report a cycle earns: which module writes it, where, and what it says. */
export interface CircularImportReport {
  readonly path: string;
  readonly advisory: Advisory;
}

/**
 * One `A18` per cyclic component, keyed by the module whose import closes it.
 *
 * The walk starts at the component member with the first project-relative name
 * and follows each module's dependencies in source order, restricted to the
 * component — every module of a strongly connected component reaches every
 * other, so the start does not change *whether* a cycle is found, only which of
 * its edges is the closing one, and a stable start makes that answer stable.
 * The first edge that reaches a module already on the walk is the one that
 * closes; it is the last import a reader following the chain would read before
 * arriving back where they began.
 */
export function planCircularImportAdvisories(input: CircularImportPlanInput): ReadonlyMap<string, CircularImportReport> {
  const reports = new Map<string, CircularImportReport>();
  for (const component of [...input.cyclicComponents].sort((left, right) => left - right)) {
    const members = (input.componentMembers.get(component) ?? []).slice()
      .sort((left, right) => byCodeUnit(displayName(input, left), displayName(input, right)));
    if (members.length === 0) continue;
    const closing = closingEdge(input, component, members);
    if (closing === null) continue;
    const message = `Circular module dependency includes ${members.map((member) => displayName(input, member)).join(", ")}`
      + "; extract shared contracts into a lower-level module so dependencies flow in one direction";
    reports.set(closing.path, { path: closing.path, advisory: advisory(CIRCULAR_IMPORT_ADVISORY, message, closing.span) });
  }
  return reports;
}

/**
 * Applies a module's deferred `velar-allow` clauses to the graph advisories
 * raised over it, and reports the ones that suppressed nothing.
 *
 * CO-I2: this is the stage the charter's third suppression rule was missing.
 * The compile that read the comment could not decide staleness — it is not the
 * stage that raises `A18` — and the stage that does raise it only filtered.
 */
export function resolveGraphAdvisories(
  source: SourceText,
  raised: readonly Advisory[],
  deferred: readonly AdvisorySuppression[],
): { readonly advisories: readonly Advisory[]; readonly diagnostics: readonly Diagnostic[] } {
  return resolveDeferredAdvisorySuppressions(source, raised, deferred);
}

function displayName(input: CircularImportPlanInput, path: string): string {
  return input.relativePathByInput.get(path) ?? basename(path);
}

/**
 * The import that closes this component's cycle: an iterative depth-first walk
 * whose first back edge wins. `visiting` is the walk's own stack, so an edge
 * into it is exactly an edge that returns to a module the reader is still
 * inside — including a module that imports itself.
 */
function closingEdge(
  input: CircularImportPlanInput,
  component: number,
  members: readonly string[],
): { readonly path: string; readonly span: { readonly start: number; readonly end: number } } | null {
  const visiting = new Set<string>();
  const finished = new Set<string>();
  const frames: { readonly path: string; readonly dependencies: readonly string[]; next: number }[] = [];
  const begin = (path: string): void => {
    visiting.add(path);
    frames.push({
      path,
      dependencies: (input.staticDependencies.get(path) ?? []).filter((target) => input.componentOf.get(target) === component),
      next: 0,
    });
  };
  begin(members[0]!);
  while (frames.length > 0) {
    const frame = frames.at(-1)!;
    const dependency = frame.dependencies[frame.next];
    if (dependency === undefined) {
      frames.pop();
      visiting.delete(frame.path);
      finished.add(frame.path);
      continue;
    }
    frame.next += 1;
    if (visiting.has(dependency)) {
      const span = referenceSpan(input, frame.path, dependency);
      if (span !== null) return { path: frame.path, span };
      continue;
    }
    if (!finished.has(dependency)) begin(dependency);
  }
  return null;
}

/** Where an importer writes the import that reaches `target`, or null when it does not. */
function referenceSpan(
  input: CircularImportPlanInput,
  importerPath: string,
  target: string,
): { readonly start: number; readonly end: number } | null {
  for (const reference of input.moduleReferences(importerPath)) {
    if (reference.dynamic) continue;
    if (input.resolveDependency(importerPath, reference.source) === target) return reference.span;
  }
  return null;
}
