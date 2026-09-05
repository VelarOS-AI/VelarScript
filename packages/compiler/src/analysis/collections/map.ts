/**
 * The Map operations: what one call of a compiler-owned Map member answers.
 *
 * D115 §三: this was one private method of `CollectionInference`. Its cases run
 * in the order the one method evaluated them in, and it answers `null` for a
 * property Map does not publish.
 */
import {
  boolType,
  nullType,
  optionalOf,
  unknownType,
  type ValueType,
} from "../../types.ts";
import { type CollectionCall, type CollectionLoweringFacts } from "./call.ts";
import { iteratorOf } from "./members.ts";
import { type DiagnosticFix } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";

/** What the Map family asks of the analyzer that hosts it, and nothing more. */
export interface MapCallsHost {
  /** What the emitter will lower each collection call to. */
  readonly lowering: CollectionLoweringFacts;
  expandAliases(type: ValueType): ValueType;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void;
  requireMembershipIntersection(probe: ValueType, domain: ValueType, span: Span, operation: string): boolean;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

export class MapCalls {
  private readonly host: MapCallsHost;

  constructor(host: MapCallsHost) {
    this.host = host;
  }

  /** The Map operations. */
  inferMapCall(call: CollectionCall, object: Extract<ValueType, { kind: "map" }>): ValueType | null {
    if (call.member.property === "set") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapSet");
      const keyArgument = call.argumentAt(0);
      const valueArgument = call.argumentAt(1);
      // D85 rule 211: the receiver's declared key and value types are the
      // contextual types of this call, exactly as `List.append` passes its
      // element type. Without them an empty `[]`, an arrow, or any other
      // value that reads its shape from context arrives as `unknown`.
      const key = call.inferArgument(0, object.key);
      const value = call.inferArgument(1, object.value);
      if (keyArgument) this.host.requireAssignable(key, object.key, keyArgument.span);
      if (valueArgument) this.host.requireAssignable(value, object.value, valueArgument.span);
      call.requireCount(2);
      return nullType;
    }
    if (call.member.property === "getOrSet") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapGetOrSet");
      const keyArgument = call.argumentAt(0);
      const valueArgument = call.argumentAt(1);
      const key = call.inferArgument(0, object.key);
      const value = call.inferArgument(1, object.value);
      if (keyArgument) this.host.requireAssignable(key, object.key, keyArgument.span);
      if (valueArgument) this.host.requireAssignable(value, object.value, valueArgument.span);
      call.requireCount(2);
      return object.value;
    }
    if (call.member.property === "getOrSetWith") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapGetOrSetWith");
      const keyArgument = call.argumentAt(0);
      const factoryArgument = call.argumentAt(1);
      const key = call.inferArgument(0, object.key);
      const factoryType: ValueType = {
        kind: "function",
        parameterNames: [],
        parameters: [],
        requiredParameters: 0,
        result: object.value,
      };
      const factory = call.inferArgument(1, factoryType);
      if (keyArgument) this.host.requireAssignable(key, object.key, keyArgument.span);
      if (factoryArgument) this.host.requireAssignable(factory, factoryType, factoryArgument.span);
      call.requireCount(2);
      return object.value;
    }
    if (call.member.property === "update") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapUpdate");
      const argument = call.argumentAt(0);
      const source = argument ? this.host.expandAliases(call.inferArgument(0)) : unknownType;
      if (argument) this.host.requireAssignable(source, object, argument.span);
      call.requireCount(1);
      return nullType;
    }
    if (call.member.property === "get") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapGet");
      if (!call.namedPreanalyzed && call.sourceArguments.length === 2 && !call.sourceArguments.some((argument) => argument.kind === "SpreadExpression")) {
        const key = call.inferArgument(0, call.comparisonKey!);
        const keyArgument = call.argumentAt(0);
        if (keyArgument) this.host.requireMembershipIntersection(key, call.comparisonKey!, keyArgument.span, "Map.get");
        call.inferArgument(1);
        this.host.typeError("Use 'get(key) ?? fallback'; Map.get has one optional-result contract", call.callSpan);
        return optionalOf(call.readonlyValue!);
      }
      call.checkProbeArgument(call.comparisonKey!, "Map.get", "key");
      return optionalOf(call.readonlyValue!);
    }
    if (call.member.property === "iterator") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapIterator");
      call.checkCollectionArguments([]);
      return iteratorOf(call.readonlyKey!);
    }
    if (call.member.property === "keys") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapKeys");
      call.checkCollectionArguments([]);
      return { kind: "list", element: call.readonlyKey! };
    }
    if (call.member.property === "values") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapValues");
      call.checkCollectionArguments([]);
      return { kind: "list", element: call.readonlyValue! };
    }
    if (call.member.property === "entries") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapEntries");
      call.checkCollectionArguments([]);
      return { kind: "list", element: { kind: "object", fields: new Map([["key", call.readonlyKey!], ["value", call.readonlyValue!]]) } };
    }
    if (call.member.property === "has") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapHas");
      call.checkProbeArgument(call.comparisonKey!, "Map.has", "key");
      return boolType;
    }
    if (call.member.property === "remove") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapRemove");
      call.checkProbeArgument(call.comparisonKey!, "Map.remove", "key");
      return boolType;
    }
    if (call.member.property === "clear") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapClear");
      call.checkCollectionArguments([]);
      return nullType;
    }
    if (call.member.property === "copy") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "mapCopy");
      call.checkCollectionArguments([]);
      return { kind: "map", key: call.readonlyKey!, value: call.readonlyValue! };
    }
    return null;
  }
}
