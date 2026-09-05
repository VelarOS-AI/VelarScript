/**
 * The List operations: what one call of a compiler-owned List member answers,
 * and what it refuses.
 *
 * D115 §三: these were five private methods of `CollectionInference`, tried in
 * the order the one 721-line method evaluated its cases in. That order is
 * preserved by `inferListCall`, which is the whole of what leaves this file —
 * each family still answers `null` for a property it does not own, so a call
 * reaches exactly the case it reached before.
 */
import { type ArrowFunctionExpression, type Expression } from "../../ast.ts";
import {
  boolType,
  describeType,
  isInvalidType,
  nonOptional,
  nullType,
  numberType,
  optionalOf,
  stringType,
  unionOf,
  unknownType,
  type ValueType,
} from "../../types.ts";
import { type CollectionCall, type CollectionLoweringFacts } from "./call.ts";
import { type DiagnosticFix } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";

/** What the List families ask of the analyzer that hosts them, and nothing more. */
export interface ListCallsHost {
  /** What the emitter will lower each collection call to. */
  readonly lowering: CollectionLoweringFacts;
  expandAliases(type: ValueType): ValueType;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferredExpressionType(expression: Expression): ValueType;
  /** `isAssignable` judged against the analyzer as the type environment. */
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  /** D42 item 65's single authority on whether a key carries a runtime order. */
  orderedTypeCategory(source: ValueType): "number" | "string" | "comparable" | "dynamic" | null;
  readonlyDataViewOf(type: ValueType): ValueType;
  rejectCollidingKeyDomain(keySource: ValueType, span: Span, position: string): void;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  unorderedTypeGuidance(...types: readonly ValueType[]): string;
}

export class ListCalls {
  private readonly host: ListCallsHost;

  constructor(host: ListCallsHost) {
    this.host = host;
  }

  /**
   * The List operations, tried in the order the one method evaluated them in.
   * Each family answers null for a property it does not own; every property it
   * does own returns a type, so no family can be skipped by an answer of null.
   */
  inferListCall(call: CollectionCall, object: Extract<ValueType, { kind: "list" }>): ValueType | null {
    return this.inferListTransformCall(call, object)
      ?? this.inferListMutationCall(call, object)
      ?? this.inferListSortedCall(call, object)
      ?? this.inferListQueryCall(call, object)
      ?? this.inferListPipelineCall(call, object);
  }

  /** The callback transforms: `map`, `flatMap`, `filter` and `reduce`. */
  private inferListTransformCall(call: CollectionCall, object: Extract<ValueType, { kind: "list" }>): ValueType | null {
    if (call.member.property === "map" || call.member.property === "flatMap") {
      const flat = call.member.property === "flatMap";
      this.host.lowering.collectionCalls.set(call.member.span.end, flat ? "listFlatMap" : "listMap");
      const callbackArgument = call.argumentAt(0);
      const callback = call.inferListCallback(0, unknownType);
      const concrete = this.host.expandAliases(callback);
      const result = concrete.kind === "function" ? concrete.result : unknownType;
      call.requireCount(1);
      if (flat) {
        // COL-U1: flatMap flattens exactly one level, so the transform
        // must produce a List; the element of that List is the result
        // element.
        const expandedResult = this.host.expandAliases(result);
        if (callbackArgument && expandedResult.kind !== "list" && expandedResult.kind !== "any" && expandedResult.kind !== "unknown" && !isInvalidType(expandedResult)) {
          this.host.typeError(
            `List.flatMap transform must return a List, received ${describeType(expandedResult)}; use map for one-value transforms`,
            callbackArgument.span,
          );
        }
        return { kind: "list", element: expandedResult.kind === "list" ? expandedResult.element : unknownType };
      }
      return { kind: "list", element: result };
    }
    if (call.member.property === "filter") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listFilter");
      const callbackArgument = call.argumentAt(0);
      if (callbackArgument) call.inferListCallback(0, boolType);
      call.requireCount(1);
      // COL-U3: the exact predicate shape `x => x != null` narrows
      // List<T?> to List<T>. This is a closed-vocabulary special case (the
      // NaN twin is already taught); user predicate types stay unanalyzed.
      if (this.isNullExclusionPredicate(call.argumentAt(0)) && this.host.expandAliases(call.readonlyElement!).kind === "optional") {
        return { kind: "list", element: nonOptional(this.host.expandAliases(call.readonlyElement!)) };
      }
      return { kind: "list", element: call.readonlyElement! };
    }
    if (call.member.property === "reduce") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listReduce");
      const callbackArgument = call.argumentAt(0);
      const deferredArrow = callbackArgument?.kind === "ArrowFunctionExpression";
      let callback = callbackArgument && !deferredArrow ? call.inferArgument(0) : unknownType;
      const initial = call.inferArgument(1);
      // D113, completed by D114 S3c: the combine is an element callback, so
      // after the accumulator it receives the element and the element's
      // zero-based position in the snapshot `__velarListReduce` folds over.
      const callbackExpected: ValueType = { kind: "function", parameters: [initial, call.readonlyElement!, numberType], requiredParameters: 3, result: initial };
      if (callbackArgument) {
        if (deferredArrow) callback = call.inferArgument(0, callbackExpected);
        this.host.requireAssignable(callback, callbackExpected, callbackArgument.span);
      }
      call.requireCount(2);
      return initial;
    }
    return null;
  }

  /** The in-place writes, the whole-list copies, and the `==` probes over elements. */
  private inferListMutationCall(call: CollectionCall, object: Extract<ValueType, { kind: "list" }>): ValueType | null {
    if (call.member.property === "append") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listAppend");
      const argument = call.argumentAt(0);
      const value = call.inferArgument(0, object.element);
      if (argument) this.host.requireAssignable(value, object.element, argument.span);
      call.requireCount(1);
      return nullType;
    }
    if (call.member.property === "extend") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listExtend");
      const argument = call.argumentAt(0);
      const source = argument ? this.host.expandAliases(call.inferArgument(0)) : unknownType;
      if (argument) this.host.requireAssignable(source, object, argument.span);
      call.requireCount(1);
      return nullType;
    }
    if (call.member.property === "insert") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listInsert");
      const indexArgument = call.argumentAt(0);
      if (indexArgument) this.host.requireAssignable(call.inferArgument(0, numberType), numberType, indexArgument.span);
      const argument = call.argumentAt(1);
      const value = call.inferArgument(1, object.element);
      if (argument) this.host.requireAssignable(value, object.element, argument.span);
      call.requireCount(2);
      return nullType;
    }
    if (call.member.property === "remove") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listRemove");
      call.checkProbeArgument(call.comparisonElement!, "List.remove");
      return boolType;
    }
    if (call.member.property === "pop") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listPop");
      call.checkCollectionArguments([numberType], 0);
      return object.element;
    }
    if (call.member.property === "clear" || call.member.property === "copy" || call.member.property === "reversed") {
      this.host.lowering.collectionCalls.set(call.member.span.end, call.member.property === "clear" ? "listClear" : call.member.property === "copy" ? "listCopy" : "listReversed");
      call.checkCollectionArguments([]);
      return call.member.property === "clear" ? nullType : { kind: "list", element: call.readonlyElement! };
    }
    if (call.member.property === "has" || call.member.property === "count") {
      this.host.lowering.collectionCalls.set(call.member.span.end, call.member.property === "has" ? "listHas" : "listCount");
      call.checkProbeArgument(call.comparisonElement!, `List.${call.member.property}`);
      return call.member.property === "has" ? boolType : numberType;
    }
    return null;
  }

  /** `sorted`, whose comparator, `by=` selector and `descending=` flag are one rule set. */
  private inferListSortedCall(call: CollectionCall, object: Extract<ValueType, { kind: "list" }>): ValueType | null {
    if (call.member.property === "sorted") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listSorted");
      // A comparator is not an element callback: it receives two elements to
      // weigh against each other, so it keeps its own `(left, right)` shape
      // while `by=` takes the element contract every other callback takes.
      const comparator: ValueType = { kind: "function", parameters: [call.readonlyElement!, call.readonlyElement!], requiredParameters: 2, result: numberType };
      const selector: ValueType = { kind: "function", parameters: [call.readonlyElement!], requiredParameters: 1, result: unionOf([numberType, stringType]) };
      const compareArgument = call.argumentAt(0);
      const byArgument = call.argumentAt(1);
      const descendingArgument = call.argumentAt(2);
      const positionalSelector = !call.namedPreanalyzed
        && compareArgument?.kind === "ArrowFunctionExpression"
        && compareArgument.parameters.length === 1
        && !call.argumentNames?.some((name) => name !== null);
      let byType: ValueType | null = null;
      if (!call.namedPreanalyzed) {
        if (compareArgument) this.host.requireAssignable(call.inferArgument(0, positionalSelector ? selector : comparator), positionalSelector ? selector : comparator, compareArgument.span);
        if (byArgument) byType = call.inferListCallback(1, unionOf([numberType, stringType]), false);
        if (descendingArgument) this.host.requireAssignable(call.inferArgument(2, boolType), boolType, descendingArgument.span);
        if (call.arguments_.length > 3) {
          for (const extra of call.arguments_.slice(3)) this.host.inferExpression(extra);
          this.host.typeError(`Expected 0-3 arguments but received ${call.arguments_.length}`, call.callSpan);
        }
      } else {
        if (compareArgument) this.host.requireAssignable(this.host.inferredExpressionType(compareArgument), comparator, compareArgument.span);
        if (byArgument) byType = call.inferListCallback(1, unionOf([numberType, stringType]), false);
        if (descendingArgument) this.host.requireAssignable(this.host.inferredExpressionType(descendingArgument), boolType, descendingArgument.span);
      }
      // ORD-3: assignability admits an enum key, because an enum call.member is
      // assignable to `string`, so the ordered-key question has to be asked
      // separately at the one decision point.
      const byKey = this.selectorKeyType(byArgument, byType);
      if (byArgument && byKey !== null && !call.rejectedListCallbacks.has(1) && this.host.orderedTypeCategory(byKey) === null) {
        this.host.typeError(
          `sorted(by=) key must return only string or only number, received ${describeType(byKey)}${this.host.unorderedTypeGuidance(byKey)}`,
          byArgument.span,
        );
      }
      if (byArgument && !call.argumentNames?.includes("by")) {
        this.host.typeError("Use 'sorted(by=selector)'; the key-function alternative is named", byArgument.span);
      }
      if (positionalSelector) this.host.typeError("Use 'sorted(by=selector)'; the key-function alternative is named", compareArgument.span);
      if (descendingArgument && !call.argumentNames?.includes("descending")) {
        this.host.typeError("Use 'sorted(descending=true)'; the order flag is named", descendingArgument.span);
      }
      if (compareArgument && byArgument) {
        this.host.typeError("sorted accepts either a comparator or 'by=selector', not both", call.callSpan);
      }
      // D114 S3: a comparator already states the order, so a second way to
      // say it would be two spellings of one fact — and a reader would have
      // to decide which wins.
      if (compareArgument && descendingArgument) {
        this.host.typeError("sorted(descending=) applies to the default order or a 'by=selector'; the comparator already states the order", call.callSpan);
      }
      if (!compareArgument && !byArgument && this.host.orderedTypeCategory(object.element) === null) {
        this.host.typeError(
          `List<${describeType(object.element)}>.sorted() requires an explicit comparator${this.host.unorderedTypeGuidance(object.element)}`,
          call.callSpan,
        );
      }
      return { kind: "list", element: call.readonlyElement! };
    }
    return null;
  }

  /** The aggregates and the queries that answer about the List rather than rebuild it. */
  private inferListQueryCall(call: CollectionCall, object: Extract<ValueType, { kind: "list" }>): ValueType | null {
    if (call.member.property === "sum") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listSum");
      call.checkCollectionArguments([]);
      if (object.element.kind !== "any" && object.element.kind !== "unknown" && !this.host.isAssignableHere(object.element, numberType)) {
        this.host.typeError(`List.sum requires List<number>, received ${describeType(object)}`, call.member.span);
      }
      return numberType;
    }
    if (call.member.property === "min" || call.member.property === "max") {
      this.host.lowering.collectionCalls.set(call.member.span.end, call.member.property === "min" ? "listMin" : "listMax");
      // D114 S3: `by=` completes the selector family the retired
      // velar/collections minBy/maxBy carried, under sorted(by=)'s rules.
      const byArgument = call.argumentAt(0);
      const byType = byArgument ? call.inferListCallback(0, unionOf([numberType, stringType]), false) : null;
      if (!call.namedPreanalyzed && call.arguments_.length > 1) {
        for (const extra of call.arguments_.slice(1)) this.host.inferExpression(extra);
        this.host.typeError(`Expected 0-1 arguments but received ${call.arguments_.length}`, call.callSpan);
      }
      const byKey = this.selectorKeyType(byArgument, byType);
      if (byArgument && byKey !== null && !call.rejectedListCallbacks.has(0) && this.host.orderedTypeCategory(byKey) === null) {
        this.host.typeError(
          `${call.member.property}(by=) key must return only string or only number, received ${describeType(byKey)}${this.host.unorderedTypeGuidance(byKey)}`,
          byArgument.span,
        );
      }
      if (byArgument && !call.argumentNames?.includes("by")) {
        this.host.typeError(`Use '${call.member.property}(by=selector)'; the key-function alternative is named`, byArgument.span);
      }
      if (!byArgument && this.host.orderedTypeCategory(object.element) === null) {
        this.host.typeError(
          `List.${call.member.property} requires List<number> or List<string>, received ${describeType(object)}${this.host.unorderedTypeGuidance(object.element)}`,
          call.member.span,
        );
      }
      return optionalOf(call.readonlyElement!);
    }
    if (["some", "every", "find"].includes(call.member.property)) {
      const callbackArgument = call.argumentAt(0);
      if (callbackArgument) call.inferListCallback(0, boolType);
      call.requireCount(1);
      if (call.member.property === "find") {
        this.host.lowering.collectionCalls.set(call.member.span.end, "listFind");
        return optionalOf(call.readonlyElement!);
      }
      this.host.lowering.collectionCalls.set(call.member.span.end, call.member.property === "some" ? "listSome" : "listEvery");
      return boolType;
    }
    if (call.member.property === "index") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listIndex");
      call.checkProbeArgument(call.comparisonElement!, "List.index");
      return optionalOf(numberType);
    }
    if (call.member.property === "join") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listJoin");
      call.checkCollectionArguments([stringType], 0);
      if (object.element.kind !== "any" && object.element.kind !== "unknown" && !this.host.isAssignableHere(object.element, stringType)) {
        this.host.typeError(`List.join requires List<string>, received ${describeType(object)}`, call.member.span);
      }
      return stringType;
    }
    if (call.member.property === "get") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listGet");
      call.checkCollectionArguments([numberType]);
      return optionalOf(call.readonlyElement!);
    }
    if (call.member.property === "slice") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "slice");
      call.checkCollectionArguments([numberType, numberType], 0);
      return { kind: "list", element: call.readonlyElement! };
    }
    return null;
  }

  /** D114 S3: the pipeline members that replaced the retired velar/collections functions. */
  // ── D114 S3: the pipeline members ────────────────────────────────────
  private inferListPipelineCall(call: CollectionCall, object: Extract<ValueType, { kind: "list" }>): ValueType | null {
    if (call.member.property === "unique") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listUnique");
      call.checkCollectionArguments([]);
      return { kind: "list", element: call.readonlyElement! };
    }
    if (call.member.property === "compact") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listCompact");
      call.checkCollectionArguments([]);
      const element = this.host.expandAliases(call.readonlyElement!);
      // The same stance `x != null` takes on a value that can never be null
      // (section 4): a removal with nothing to remove is a constant, and a
      // silently constant operation is a logic bug. D114 0.28.0 C-I1: the
      // constant runs the other way on `List<null>` — every element goes, and
      // what is left has no element type — so the refusal stands and says which
      // of the two constants it is.
      if (element.kind !== "optional" && element.kind !== "any" && element.kind !== "unknown" && !isInvalidType(element)) {
        this.host.typeError(
          element.kind === "null"
            ? "List<null>.compact() removes every element; the element type is only null, so the result would have no element type — drop the call"
            : `List<${describeType(element)}>.compact() has nothing to remove; the element type has no null arm, so drop the call`,
          call.member.span,
        );
        return { kind: "list", element: call.readonlyElement! };
      }
      return { kind: "list", element: nonOptional(element) };
    }
    if (call.member.property === "flatten") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listFlatten");
      call.checkCollectionArguments([]);
      const element = this.host.expandAliases(call.readonlyElement!);
      if (element.kind === "any" || element.kind === "unknown" || isInvalidType(element)) return { kind: "list", element: unknownType };
      if (element.kind !== "list") {
        this.host.typeError(
          `List.flatten removes exactly one List level, so it requires List<List<T>>, received ${describeType(object)}`,
          call.member.span,
        );
        return { kind: "list", element: unknownType };
      }
      return { kind: "list", element: element.element };
    }
    if (call.member.property === "chunk") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listChunk");
      call.checkCollectionArguments([numberType]);
      call.requireCount(1);
      return { kind: "list", element: { kind: "list", element: call.readonlyElement! } };
    }
    if (call.member.property === "repeat") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listRepeat");
      call.checkCollectionArguments([numberType]);
      call.requireCount(1);
      return { kind: "list", element: call.readonlyElement! };
    }
    if (call.member.property === "partition") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listPartition");
      if (call.argumentAt(0)) call.inferListCallback(0, boolType);
      call.requireCount(1);
      const half: ValueType = { kind: "list", element: call.readonlyElement! };
      return { kind: "object", fields: new Map([["matches", half], ["rest", half]]) };
    }
    if (call.member.property === "groupBy" || call.member.property === "keyBy" || call.member.property === "countBy") {
      this.host.lowering.collectionCalls.set(call.member.span.end, call.member.property === "groupBy"
        ? "listGroupBy"
        : call.member.property === "keyBy" ? "listKeyBy" : "listCountBy");
      const keyArgument = call.argumentAt(0);
      const keyCallback = keyArgument ? call.inferListCallback(0, unknownType, false) : null;
      call.requireCount(1);
      const key = this.selectorKeyType(keyArgument, keyCallback) ?? unknownType;
      // ENM-D1: the result is a Map, so its key obeys the one Map key rule.
      if (keyArgument) this.host.rejectCollidingKeyDomain(key, keyArgument.span, "Map key type");
      return {
        kind: "map",
        key,
        value: call.member.property === "groupBy"
          ? { kind: "list", element: call.readonlyElement! }
          : call.member.property === "keyBy" ? call.readonlyElement! : numberType,
      };
    }
    if (call.member.property === "zip") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "listZip");
      const other = call.argumentAt(0);
      const partner = other ? this.host.expandAliases(call.inferArgument(0)) : unknownType;
      if (other && partner.kind !== "list" && partner.kind !== "any" && partner.kind !== "unknown" && !isInvalidType(partner)) {
        this.host.typeError(`List.zip requires a List partner, received ${describeType(partner)}`, other.span);
      }
      call.requireCount(1);
      // The pair aliases the partner's elements, so they keep exactly the
      // view the partner published — read-only through a read-only List, and
      // the plain element otherwise.
      const second = partner.kind !== "list"
        ? unknownType
        : partner.readonlyView ? this.host.readonlyDataViewOf(partner.element) : partner.element;
      return {
        kind: "list",
        element: { kind: "object", fields: new Map([["first", call.readonlyElement!], ["second", second]]) },
      };
    }
    return null;
  }

  // COL-U3: exactly the predicate `x => x != null` (either operand order).
  // An optional second index parameter does not participate in the proof and
  // therefore preserves the same narrowing contract.
  // The closed shape keeps this a vocabulary rule, not a predicate-type
  // system: any other body — even `x => not (x == null)` — filters without
  // narrowing.
  private isNullExclusionPredicate(argument: Expression | null): boolean {
    if (argument?.kind !== "ArrowFunctionExpression" || argument.asynchronous) return false;
    const parameter = argument.parameters[0];
    const index = argument.parameters[1];
    if (argument.parameters.length < 1 || argument.parameters.length > 2 || !parameter || parameter.rest || parameter.defaultValue) return false;
    if (index?.rest || index?.defaultValue) return false;
    const body = argument.body;
    if (body.kind !== "BinaryExpression" || body.operator !== "!=") return false;
    const matches = (name: Expression, literal: Expression): boolean =>
      name.kind === "IdentifierExpression" && name.name === parameter.name
      && literal.kind === "LiteralExpression" && literal.value === null;
    return matches(body.left, body.right) || matches(body.right, body.left);
  }

  /**
   * D42 item 65: the key a selector answers. A literal arrow reports the
   * contextual key type rather than its own once the body checks out, so the
   * body's recorded type is the honest source for an inline arrow; a named
   * function answers with its declared result.
   */
  private selectorKeyType(argument: Expression | null, selector: ValueType | null): ValueType | null {
    if (!argument || selector === null) return null;
    if (argument.kind === "ArrowFunctionExpression") return this.host.inferredExpressionType(argument.body);
    const callable = this.host.expandAliases(selector);
    return callable.kind === "function" || callable.kind === "action" || callable.kind === "intrinsic"
      ? callable.result
      : null;
  }
}
