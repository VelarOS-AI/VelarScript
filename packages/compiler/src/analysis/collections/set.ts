/**
 * The Set operations, including the set algebra: what one call of a
 * compiler-owned Set member answers.
 *
 * D115 §三: this was one private method of `CollectionInference`. Its cases run
 * in the order the one method evaluated them in, and it answers `null` for a
 * property Set does not publish.
 */
import {
  boolType,
  describeType,
  isInvalidType,
  mergeTypes,
  nullType,
  unknownType,
  type ValueType,
} from "../../types.ts";
import { type CollectionCall, type CollectionLoweringFacts } from "./call.ts";
import { type DiagnosticFix } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";

/** What the Set family asks of the analyzer that hosts it, and nothing more. */
export interface SetCallsHost {
  /** What the emitter will lower each collection call to. */
  readonly lowering: CollectionLoweringFacts;
  expandAliases(type: ValueType): ValueType;
  readonlyDataViewOf(type: ValueType): ValueType;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void;
  requireMembershipIntersection(probe: ValueType, domain: ValueType, span: Span, operation: string): boolean;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

export class SetCalls {
  private readonly host: SetCallsHost;

  constructor(host: SetCallsHost) {
    this.host = host;
  }

  /** The Set operations, including the set algebra. */
  inferSetCall(call: CollectionCall, object: Extract<ValueType, { kind: "set" }>): ValueType | null {
    if (call.member.property === "add") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "setAdd");
      const argument = call.argumentAt(0);
      const value = call.inferArgument(0, object.element);
      call.requireCount(1);
      if (argument) this.host.requireAssignable(value, object.element, argument.span);
      return nullType;
    }
    if (call.member.property === "update") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "setUpdate");
      const argument = call.argumentAt(0);
      const accepted: ValueType = { kind: "union", members: [object, { kind: "list", element: object.element }] };
      const source = argument ? this.host.expandAliases(call.inferArgument(0)) : unknownType;
      if (argument) this.host.requireAssignable(source, accepted, argument.span);
      call.requireCount(1);
      return nullType;
    }
    if (call.member.property === "has") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "setHas");
      call.checkProbeArgument(call.comparisonElement!, "Set.has");
      return boolType;
    }
    if (call.member.property === "remove") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "setRemove");
      call.checkProbeArgument(call.comparisonElement!, "Set.remove");
      return boolType;
    }
    if (call.member.property === "clear") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "setClear");
      call.checkCollectionArguments([]);
      return nullType;
    }
    if (call.member.property === "values") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "setValues");
      call.checkCollectionArguments([]);
      return { kind: "list", element: call.readonlyElement! };
    }
    if (call.member.property === "copy") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "setCopy");
      call.checkCollectionArguments([]);
      return { kind: "set", element: call.readonlyElement! };
    }
    if (call.member.property === "union" || call.member.property === "intersection" || call.member.property === "difference") {
      // COL-U2: the Set algebra. Each copies; the other operand's element
      // domain must intersect this Set's (the same per-call.member `==`
      // question the probes ask), so an enum Set never meets a bare-string
      // Set here.
      this.host.lowering.collectionCalls.set(
        call.member.span.end,
        call.member.property === "union" ? "setUnion" : call.member.property === "intersection" ? "setIntersection" : "setDifference",
      );
      const argument = call.argumentAt(0);
      const source = argument ? this.host.expandAliases(call.inferArgument(0, { kind: "set", element: call.comparisonElement! })) : unknownType;
      call.requireCount(1);
      if (argument && source.kind === "set") {
        this.host.requireMembershipIntersection(source.element, call.comparisonElement!, argument.span, `Set.${call.member.property}`);
      } else if (argument && source.kind !== "any" && !isInvalidType(source)) {
        this.host.typeError(`Set.${call.member.property} requires a Set, received ${describeType(source)}`, argument.span);
      }
      if (call.member.property === "union" && argument && source.kind === "set") {
        return { kind: "set", element: mergeTypes(call.readonlyElement!, this.host.readonlyDataViewOf(source.element)) };
      }
      return { kind: "set", element: call.readonlyElement! };
    }
    return null;
  }
}
