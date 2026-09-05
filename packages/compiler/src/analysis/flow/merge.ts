/**
 * Where branches meet: which facts a construct's arms agree on, which of them
 * were still standing when a scope closed, and what a set of branch
 * invalidations does to the facts they all leave behind.
 *
 * D114 R1d: the merge half of the flow cluster. It was nine private methods of
 * `Analyzer` grouped around `VisibleScopeDepth` — the depth of the scope chain
 * at some earlier moment — and around `applyFlowInvalidations`, the one writer
 * that turns "these branches disagreed" back into "so nobody knows". They move
 * together because every one of them answers a question about *two* moments,
 * which is the thing the rest of the analyzer never asks.
 */
import { mergeTypes, sameType, type ValueType } from "../../types.ts";
import { type Binding, type MemberNarrowing, memberNarrowingPrefix, type VisibleScopeDepth } from "../scopes.ts";
import { type FlowFactInvalidations, type FlowFactsSnapshot } from "./facts.ts";

/**
 * Everything the merge half asks of the analyzer that hosts it, and nothing
 * more. The scope stack and the flow-fact store move under it, so both arrive
 * as live getters rather than as values captured at construction.
 */
export interface FlowMergeHost {
  readonly flowFrameDepth: number;
  lookup(name: string): Binding | null;
  readonly memberNarrowings: Map<string, MemberNarrowing>[];
  readonly narrowedNames: Set<string>[];
  recordFlowFactOrigin(binding: Binding): void;
  restoreFlowFacts(snapshot: FlowFactsSnapshot): void;
  readonly scopes: Map<string, Binding>[];
}

export class FlowMerge {
  private readonly host: FlowMergeHost;

  constructor(host: FlowMergeHost) {
    this.host = host;
  }

  visibleBindings(): VisibleScopeDepth {
    return this.host.scopes.length;
  }

  /** The binding a name resolved to when `visible` was captured. */
  visibleBinding(visible: VisibleScopeDepth, name: string): Binding | null {
    for (let index = Math.min(visible, this.host.scopes.length) - 1; index >= 0; index -= 1) {
      const binding = this.host.scopes[index]?.get(name);
      if (binding) return binding;
    }
    return null;
  }

  /**
   * Only a name a narrowing has written can carry a fact, and `narrowedNames`
   * is the roster of those per scope — so this walks the narrowings rather
   * than every name in scope. The member half matches a dotted path against
   * the binding its root names instead of spreading the whole root set per
   * path, which is O(one lookup) rather than O(names in the module).
   */
  narrowingsForVisibleBindings(visible: VisibleScopeDepth): ReadonlyMap<string, ValueType> {
    const narrowed = new Map<string, ValueType>();
    const seen = new Set<string>();
    for (let index = this.host.scopes.length - 1; index >= 0; index -= 1) {
      for (const name of this.host.narrowedNames[index]!) {
        if (seen.has(name)) continue;
        seen.add(name);
        const original = this.visibleBinding(visible, name);
        if (!original) continue;
        const current = this.host.lookup(name);
        if (current?.narrowingFrame === this.host.flowFrameDepth
          && current.span.start === original.span.start
          && current.span.end === original.span.end) narrowed.set(name, current.type);
      }
    }
    for (let index = this.host.memberNarrowings.length - 1; index >= 0; index -= 1) {
      for (const [path, fact] of this.host.memberNarrowings[index]!) {
        if (fact.frame !== this.host.flowFrameDepth || narrowed.has(`${memberNarrowingPrefix}${path}`)) continue;
        if (this.memberNarrowingRootIsVisible(visible, path)) {
          narrowed.set(`${memberNarrowingPrefix}${path}`, fact.type);
        }
      }
    }
    return narrowed;
  }

  /** Whether a member path's root — `<declaration offset>:<name>` — names a binding visible then. */
  private memberNarrowingRootIsVisible(visible: VisibleScopeDepth, path: string): boolean {
    const separator = path.indexOf(":");
    if (separator < 0) return false;
    const dot = path.indexOf(".");
    const start = Number(path.slice(0, separator));
    const name = path.slice(separator + 1, dot < 0 ? path.length : dot);
    return this.visibleBinding(visible, name)?.span.start === start;
  }

  narrowingsInSnapshot(
    snapshot: FlowFactsSnapshot,
    visible: VisibleScopeDepth,
    restore: FlowFactsSnapshot,
  ): ReadonlyMap<string, ValueType> {
    this.host.restoreFlowFacts(snapshot);
    const narrowed = this.narrowingsForVisibleBindings(visible);
    this.host.restoreFlowFacts(restore);
    return narrowed;
  }

  commonNarrowings(branches: readonly ReadonlyMap<string, ValueType>[]): ReadonlyMap<string, ValueType> {
    const first = branches[0];
    if (!first) return new Map();
    const common = new Map<string, ValueType>();
    for (const [key, type] of first) {
      if (branches.slice(1).every((branch) => {
        const candidate = branch.get(key);
        return candidate !== undefined && sameType(candidate, type);
      })) common.set(key, type);
    }
    return common;
  }

  /**
   * FLW-S1: a `while` is left through the condition test taken either on
   * entry or after the back edge, so the fact that holds afterwards is the
   * union of what the two tests prove. A location only one of them names is
   * dropped, because the other test proves nothing about it.
   */
  joinedNarrowings(
    first: ReadonlyMap<string, ValueType>,
    second: ReadonlyMap<string, ValueType>,
  ): ReadonlyMap<string, ValueType> {
    const joined = new Map<string, ValueType>();
    for (const [key, type] of first) {
      const other = second.get(key);
      if (other !== undefined) joined.set(key, sameType(other, type) ? type : mergeTypes(type, other));
    }
    return joined;
  }

  /** Of the facts a scope was entered with, the ones still standing at its end. */
  survivingNarrowings(narrowed: ReadonlyMap<string, ValueType>): ReadonlyMap<string, ValueType> {
    const surviving = new Map<string, ValueType>();
    const scope = this.host.scopes.at(-1)!;
    const memberScope = this.host.memberNarrowings.at(-1)!;
    for (const [key, type] of narrowed) {
      if (key.startsWith(memberNarrowingPrefix)) {
        const current = memberScope.get(key.slice(memberNarrowingPrefix.length));
        if (current?.frame === this.host.flowFrameDepth && sameType(current.type, type)) surviving.set(key, type);
      } else {
        const current = scope.get(key);
        if (current?.narrowingFrame === this.host.flowFrameDepth && sameType(current.type, type)) surviving.set(key, type);
      }
    }
    return surviving;
  }

  applyFlowInvalidations(branches: readonly FlowFactInvalidations[], includeBaseline = true): void {
    if (branches.length > 0) {
      const bindings = new Set(branches.flatMap((branch) => [...branch.storageTypes.keys()]));
      for (const binding of bindings) {
        const candidates = branches.map((branch) => branch.storageTypes.get(binding) ?? binding.storageType);
        if (includeBaseline) candidates.unshift(binding.storageType);
        this.host.recordFlowFactOrigin(binding);
        binding.storageType = candidates.reduce((merged, candidate) => mergeTypes(merged, candidate));
        if (binding.narrowingFrame === null) binding.type = binding.storageType;
      }
    }
    for (const branch of branches) {
      for (const binding of branch.bindings) {
        this.host.recordFlowFactOrigin(binding);
        binding.type = binding.storageType;
        binding.narrowingFrame = null;
        binding.assignedFact = false;
      }
      for (const [index, paths] of branch.members) {
        const scope = this.host.memberNarrowings[index];
        if (!scope) continue;
        for (const path of paths) scope.delete(path);
      }
    }
  }
}
