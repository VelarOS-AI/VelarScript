/**
 * A loop's back edge: the second pass over a body, run with the facts the
 * first pass falsified already removed, so that what the loop's exit keeps is
 * true on every iteration and not only on the first.
 *
 * D114 R1d: `loopFlowContexts`, `loopReanalysisDepth`, `reanalyzeLoopBackEdge`
 * and the three helpers that pass exists for — the budget test, the duplicate
 * diagnostics a second pass would otherwise report twice, and the cached
 * per-span answers the second pass has to forget — move together. The
 * statement forms that push and pop a context stay on the analyzer's `for` and
 * `while` handling and reach the stack through `contexts`.
 */
import { type Statement } from "../../ast.ts";
import { type RuntimeNarrowingGuard } from "../../contracts.ts";
import { type Diagnostic } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";
import { type ValueType } from "../../types.ts";
import { type VisibleScopeDepth } from "../scopes.ts";
import { type FlowFactInvalidations, type FlowFactsSnapshot } from "./facts.ts";

/**
 * How many back-edge passes may be running at once. One is what a single-level
 * loop needs, and three covers a loop nest three deep — the deepest anyone
 * writes on purpose — with every level analyzed exactly as before. Past that
 * the count stops doubling per level: fourteen levels went from 3.2 seconds to
 * 0.2, and seventeen from 30 seconds to 0.4.
 */
const maximumLoopReanalysisDepth = 3;

/** What a loop's back-edge pass answered: its context, or that the budget widened the exit. */
export interface LoopBackEdgeOutcome {
  readonly repeated: LoopFlowContext | null;
  /** True when the pass was skipped, so the loop's exit may keep no unconfirmed fact. */
  readonly widened: boolean;
}

export interface LoopFlowContext {
  readonly baseline: FlowFactsSnapshot;
  /** The scopes visible outside the loop, so a break's facts can be stated in their terms. */
  readonly visible: VisibleScopeDepth;
  readonly carried: FlowFactInvalidations[];
  readonly backEdges: FlowFactInvalidations[];
  /** FLW-N6: the facts holding at each `break`, one entry per break edge. */
  readonly breakFacts: ReadonlyMap<string, ValueType>[];
  sawBreak: boolean;
}

/**
 * Everything the loop half asks of the analyzer that hosts it, and nothing
 * more. The three caches a back-edge pass invalidates arrive as live maps: the
 * pass runs while they are being written.
 */
export interface LoopFlowHost {
  analyzeIsolatedFlow(snapshot: FlowFactsSnapshot, analyze: () => void): FlowFactInvalidations;
  readonly diagnostics: Diagnostic[];
  flowSnapshotAfterInvalidations(
    baseline: FlowFactsSnapshot,
    invalidations: readonly FlowFactInvalidations[],
  ): FlowFactsSnapshot;
  readonly inferredExpressionTypes: Map<string, ValueType>;
  readonly logicalConditionNarrowings: Map<string, {
    readonly truthy: ReadonlyMap<string, ValueType>;
    readonly falsy: ReadonlyMap<string, ValueType>;
  }>;
  restoreFlowFacts(snapshot: FlowFactsSnapshot): void;
  readonly runtimeNarrowings: Map<string, RuntimeNarrowingGuard>;
}

export class LoopFlow {
  private readonly host: LoopFlowHost;

  /** The loops whose bodies are being analyzed, innermost last. */
  readonly contexts: LoopFlowContext[] = [];
  /** How many loop back-edge passes are running; see `reanalyzeLoopBackEdge`. */
  private reanalysisDepth = 0;

  constructor(host: LoopFlowHost) {
    this.host = host;
  }

  /**
   * A loop's back-edge pass re-runs the whole body, and a nested loop inside
   * that pass runs its own, so the work doubled with every level of loop
   * nesting: fourteen levels of `while` in a 91-line file took 2.4 seconds and
   * seventeen took 35. The passes are budgeted by how many back-edge passes
   * are already running. Past the budget a loop analyzes its body once and its
   * exit keeps nothing — `widened` — which is what the loop would answer if
   * its back edge had falsified every fact, so the degradation only ever
   * removes a fact, never invents one. Real code does not nest loops four
   * deep, so nothing reachable by hand reaches the budget.
   */
  reanalyzeLoopBackEdge(
    baseline: FlowFactsSnapshot,
    visible: VisibleScopeDepth,
    backEdges: readonly FlowFactInvalidations[],
    body: readonly Statement[],
    diagnosticStart: number,
    analyze: () => void,
  ): LoopBackEdgeOutcome {
    if (!this.flowInvalidationsAffectFacts(backEdges)) return { repeated: null, widened: false };
    if (this.reanalysisDepth >= maximumLoopReanalysisDepth) return { repeated: null, widened: true };
    const loopHead = this.host.flowSnapshotAfterInvalidations(baseline, backEdges);
    this.contexts.push({ baseline: loopHead, visible, carried: [], backEdges: [], breakFacts: [], sawBreak: false });
    const secondDiagnosticStart = this.host.diagnostics.length;
    this.clearCachedFlowTypes(body);
    let repeated: LoopFlowContext | null = null;
    this.reanalysisDepth += 1;
    try {
      this.host.analyzeIsolatedFlow(loopHead, analyze);
      this.deduplicateDiagnostics(diagnosticStart, secondDiagnosticStart);
    } finally {
      this.reanalysisDepth -= 1;
      repeated = this.contexts.pop() ?? null;
      this.host.restoreFlowFacts(baseline);
    }
    return { repeated, widened: false };
  }

  flowInvalidationsAffectFacts(invalidations: readonly FlowFactInvalidations[]): boolean {
    return invalidations.some((item) => item.bindings.size > 0
      || [...item.members.values()].some((paths) => paths.size > 0));
  }

  private deduplicateDiagnostics(firstStart: number, secondStart: number): void {
    const repeated = this.host.diagnostics.splice(secondStart);
    const seen = new Set(this.host.diagnostics.slice(firstStart).map((item) =>
      `${item.code}\u0000${item.message}\u0000${item.span.start}\u0000${item.span.end}`));
    for (const item of repeated) {
      const key = `${item.code}\u0000${item.message}\u0000${item.span.start}\u0000${item.span.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.host.diagnostics.push(item);
    }
  }

  clearCachedFlowTypes(statements: readonly Statement[]): void {
    const first = statements[0];
    const last = statements.at(-1);
    if (!first || !last) return;
    this.clearCachedFlowTypesInSpan({ start: first.span.start, end: last.span.end });
  }

  clearCachedFlowTypesInSpan(sourceSpan: Span): void {
    const insideBody = (key: string): boolean => {
      const separator = key.indexOf(":");
      if (separator < 0) return false;
      const start = Number(key.slice(0, separator));
      const end = Number(key.slice(separator + 1));
      return start >= sourceSpan.start && end <= sourceSpan.end;
    };
    for (const key of this.host.inferredExpressionTypes.keys()) {
      if (insideBody(key)) this.host.inferredExpressionTypes.delete(key);
    }
    for (const key of this.host.logicalConditionNarrowings.keys()) {
      if (insideBody(key)) this.host.logicalConditionNarrowings.delete(key);
    }
    // Runtime narrowing guards recorded by the first pass are re-derived by
    // the reanalysis. A guard kept from the first pass while the second pass
    // no longer proves its fact would throw NarrowingError on later loop
    // iterations of perfectly legal code (the fact holds on iteration one,
    // the back edge invalidates it, and the stale guard still expects it).
    for (const key of this.host.runtimeNarrowings.keys()) {
      if (insideBody(key)) this.host.runtimeNarrowings.delete(key);
    }
  }
}
