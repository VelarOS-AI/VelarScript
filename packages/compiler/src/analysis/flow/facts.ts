/**
 * The flow-fact store: what every binding and every member path is known to
 * hold at one moment, and how one moment is snapshotted, restored, and
 * compared against another.
 *
 * D114 R1d: this was four private fields of `Analyzer` (`memberNarrowings`,
 * `narrowedNames`, `flowTouched`, `flowOrigins`) and the dozen methods that
 * read and wrote them, spread across 13,000 lines. They are one thing — the
 * answer to "what does flow analysis currently believe, and what did it
 * believe a moment ago" — so they live in one collaborator the analyzer owns
 * as `this.flowFacts`. The narrowing, loop and merge halves of the cluster
 * (`./narrowing.ts`, `./loops.ts`, `./merge.ts`) read this store through the
 * same shared host object rather than keeping copies of it.
 *
 * What the store asks of its host is one call — `applyFlowInvalidations`,
 * which belongs to the merge half — and that is declared as `FlowFactsHost`.
 */
import { sameType, type ValueType } from "../../types.ts";
import { type Binding, type MemberNarrowing } from "../scopes.ts";

/** The four flow-analysis fields of a binding, as of one moment. */
export interface FlowFactState {
  readonly type: ValueType;
  readonly storageType: ValueType;
  readonly frame: number | null;
  readonly assigned: boolean;
}

export interface FlowFactsSnapshot {
  readonly bindings: ReadonlyMap<Binding, FlowFactState>;
  readonly members: readonly ReadonlyMap<string, MemberNarrowing>[];
}

export interface FlowFactInvalidations {
  readonly bindings: ReadonlySet<Binding>;
  readonly members: ReadonlyMap<number, ReadonlySet<string>>;
  readonly storageTypes: ReadonlyMap<Binding, ValueType>;
}

/**
 * Everything the flow-fact store asks of the analyzer that hosts it, and
 * nothing more.
 */
export interface FlowFactsHost {
  applyFlowInvalidations(branches: readonly FlowFactInvalidations[], includeBaseline?: boolean): void;
}

export class FlowFacts {
  private readonly host: FlowFactsHost;

  readonly memberNarrowings: Map<string, MemberNarrowing>[] = [new Map()];
  /** Per scope depth, the names a narrowing has written there; see `narrowingsForVisibleBindings`. */
  readonly narrowedNames: Set<string>[] = [new Set()];
  /** Per scope depth, the bindings flow analysis has written; see `snapshotFlowFacts`. */
  private readonly flowTouched: Set<Binding>[] = [new Set()];
  /** What each of those held before its first write, or null for a shadow born mid-flow. */
  private readonly flowOrigins = new Map<Binding, FlowFactState | null>();

  constructor(host: FlowFactsHost) {
    this.host = host;
  }

  /** The three per-scope stacks this store keeps, pushed with the scope that owns them. */
  enterScope(): void {
    this.memberNarrowings.push(new Map());
    this.narrowedNames.push(new Set());
    this.flowTouched.push(new Set());
  }

  exitScope(): void {
    this.memberNarrowings.pop();
    this.narrowedNames.pop();
    // The bindings this scope created are unreachable now, so the flow-fact
    // working set shrinks with it rather than growing across the module.
    for (const binding of this.flowTouched.pop() ?? []) this.flowOrigins.delete(binding);
  }

  /**
   * A snapshot used to copy every binding of every live scope, which made a
   * branch cost O(names in the module) and whole-module analysis quadratic in
   * module size. A binding nothing ever narrows cannot differ between two
   * moments, so only the bindings flow analysis has actually written are
   * visited — `flowTouched`, kept per scope depth so an exiting scope drops
   * its own, and `flowOrigins`, which remembers what each one held before its
   * first write. `flowOrigins` answers for a binding a *later* write touched
   * than the snapshot being restored: the snapshot has no entry, and its
   * pre-write state is exactly the state that snapshot recorded. A narrowing
   * shadow born after the snapshot stores `null` instead, because a full-scope
   * snapshot had nothing to restore it to either.
   */
  flowFactState(binding: Binding): FlowFactState {
    return {
      type: binding.type,
      storageType: binding.storageType,
      frame: binding.narrowingFrame,
      assigned: binding.assignedFact === true,
    };
  }

  /** Called immediately before flow analysis writes a binding, so the recorded state is the pre-write one. */
  recordFlowFactOrigin(binding: Binding): void {
    if (this.flowOrigins.has(binding)) return;
    this.flowOrigins.set(binding, this.flowFactState(binding));
    this.trackFlowBinding(binding);
  }

  /** A narrowing shadow created mid-flow: no older snapshot has a state for it. */
  trackNarrowingShadow(shadow: Binding): void {
    this.flowOrigins.set(shadow, null);
    this.trackFlowBinding(shadow);
  }

  private trackFlowBinding(binding: Binding): void {
    const depth = Math.min(binding.flowScope ?? 0, this.flowTouched.length - 1);
    this.flowTouched[depth]!.add(binding);
  }

  /** Every binding whose flow facts may differ from another moment's, outermost scope first. */
  private *touchedFlowBindings(): Generator<Binding> {
    for (const level of this.flowTouched) yield* level;
  }

  /** The state `snapshot` recorded for `binding`, or null when it did not exist yet. */
  private flowStateIn(snapshot: FlowFactsSnapshot, binding: Binding): FlowFactState | null {
    return snapshot.bindings.get(binding) ?? this.flowOrigins.get(binding) ?? null;
  }

  snapshotFlowFacts(): FlowFactsSnapshot {
    const bindings = new Map<Binding, FlowFactState>();
    for (const binding of this.touchedFlowBindings()) bindings.set(binding, this.flowFactState(binding));
    return {
      bindings,
      members: this.memberNarrowings.map((scope) => new Map(scope)),
    };
  }

  restoreFlowFacts(snapshot: FlowFactsSnapshot): void {
    for (const binding of this.touchedFlowBindings()) {
      const state = this.flowStateIn(snapshot, binding);
      if (!state) continue;
      binding.type = state.type;
      binding.storageType = state.storageType;
      binding.narrowingFrame = state.frame;
      binding.assignedFact = state.assigned;
    }
    snapshot.members.forEach((source, index) => {
      const target = this.memberNarrowings[index];
      if (!target) return;
      target.clear();
      for (const [path, narrowing] of source) target.set(path, narrowing);
    });
  }

  analyzeIsolatedFlow(snapshot: FlowFactsSnapshot, analyze: () => void): FlowFactInvalidations {
    this.restoreFlowFacts(snapshot);
    analyze();
    const invalidations = this.flowInvalidationsSince(snapshot);
    this.restoreFlowFacts(snapshot);
    return invalidations;
  }

  flowInvalidationsSince(snapshot: FlowFactsSnapshot): FlowFactInvalidations {
    const bindings = new Set<Binding>();
    const storageTypes = new Map<Binding, ValueType>();
    // Only a written binding can carry a storage type this branch moved. One
    // nothing wrote merges its own storage type with itself, which is the
    // identity, so leaving it out of the set is what the merge already did.
    for (const binding of this.touchedFlowBindings()) {
      const state = this.flowStateIn(snapshot, binding);
      if (!state) continue;
      if (state.frame !== null
        && (binding.narrowingFrame !== state.frame || !sameType(binding.type, state.type))) bindings.add(binding);
      storageTypes.set(binding, binding.storageType);
    }
    const members = new Map<number, ReadonlySet<string>>();
    snapshot.members.forEach((source, index) => {
      const current = this.memberNarrowings[index];
      const invalidated = new Set<string>();
      for (const [path, narrowing] of source) {
        const after = current?.get(path);
        if (!after || after.frame !== narrowing.frame || !sameType(after.type, narrowing.type)) invalidated.add(path);
      }
      if (invalidated.size > 0) members.set(index, invalidated);
    });
    return { bindings, members, storageTypes };
  }

  flowSnapshotAfterInvalidations(
    baseline: FlowFactsSnapshot,
    invalidations: readonly FlowFactInvalidations[],
  ): FlowFactsSnapshot {
    this.restoreFlowFacts(baseline);
    this.host.applyFlowInvalidations(invalidations);
    const result = this.snapshotFlowFacts();
    this.restoreFlowFacts(baseline);
    return result;
  }
}
