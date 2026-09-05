/**
 * The collection half of inference: what a List, Map, Set or Record publishes
 * as its members, what one call of a member means, and the migration off the
 * `velar/collections` module those members replaced.
 *
 * D114 R1b: this was `inferCollectionCall` (721 lines), the four member
 * resolvers, the operation rosters and the retirement machinery, spread through
 * `Analyzer`. They are one cohesive thing — the compiler-owned collection
 * vocabulary and its checking — so they live in one collaborator the analyzer
 * owns as `this.collections`. What the collaborator needs back from the
 * analyzer is declared as `CollectionInferenceHost`: that interface is the
 * exact record of this cluster's dependency on the analyzer, and nothing
 * widens it silently.
 *
 * `inferCollectionCall` is now a prologue and four per-kind dispatchers, and
 * the List dispatcher is five operation families. The order the original
 * evaluated its cases in is the order they are tried in, and each family
 * answers `null` for a property it does not own, so a call reaches exactly the
 * case it reached before. Everything the families share — the resolved
 * arguments, the read-only views of the receiver's element/key/value, and the
 * argument helpers — is one per-call `CollectionCall` object built once by the
 * prologue.
 */
import { type ArrowFunctionExpression, type Expression, type Program, type Statement } from "../ast.ts";
import { type CollectionOperation } from "../contracts.ts";
import { mechanicalEdits, recoveredDiagnostic, type Diagnostic, type DiagnosticEdit, type DiagnosticFix } from "../diagnostic.ts";
import { RetiredCollectionMigration } from "./retired-collections.ts";
import { spanIdentity, type Span } from "../source.ts";
import {
  boolType,
  describeType,
  invalidType,
  isInvalidType,
  mergeTypes,
  nonOptional,
  nullType,
  numberType,
  optionalOf,
  stringType,
  unionOf,
  unknownType,
  type ValueType,
} from "../types.ts";

export const listCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "listGet"], ["slice", "slice"], ["append", "listAppend"], ["extend", "listExtend"],
  ["insert", "listInsert"], ["remove", "listRemove"], ["pop", "listPop"],
  ["clear", "listClear"], ["copy", "listCopy"], ["has", "listHas"], ["count", "listCount"],
  ["index", "listIndex"], ["find", "listFind"], ["some", "listSome"], ["every", "listEvery"],
  ["map", "listMap"], ["filter", "listFilter"], ["flatMap", "listFlatMap"], ["reduce", "listReduce"], ["join", "listJoin"],
  ["sorted", "listSorted"], ["reversed", "listReversed"], ["sum", "listSum"], ["min", "listMin"], ["max", "listMax"],
  // D114 S3: the pipeline members that replaced the retired velar/collections
  // functions. They are compiler-owned checked value methods like the rest.
  ["unique", "listUnique"], ["compact", "listCompact"], ["flatten", "listFlatten"], ["chunk", "listChunk"],
  ["partition", "listPartition"], ["groupBy", "listGroupBy"], ["keyBy", "listKeyBy"], ["countBy", "listCountBy"],
  ["zip", "listZip"], ["repeat", "listRepeat"],
]);
export const mapCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "mapGet"], ["set", "mapSet"], ["getOrSet", "mapGetOrSet"], ["getOrSetWith", "mapGetOrSetWith"], ["update", "mapUpdate"], ["has", "mapHas"],
  ["remove", "mapRemove"], ["clear", "mapClear"], ["copy", "mapCopy"], ["iterator", "mapIterator"],
  ["keys", "mapKeys"], ["values", "mapValues"], ["entries", "mapEntries"],
]);
export const setCollectionOperations = new Map<string, CollectionOperation>([
  ["add", "setAdd"], ["update", "setUpdate"], ["has", "setHas"], ["remove", "setRemove"],
  ["clear", "setClear"], ["copy", "setCopy"], ["values", "setValues"],
  ["union", "setUnion"], ["intersection", "setIntersection"], ["difference", "setDifference"],
]);
export const recordCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "recordGet"], ["set", "recordSet"], ["has", "recordHas"], ["remove", "recordRemove"],
  ["clear", "recordClear"], ["copy", "recordCopy"], ["keys", "recordKeys"], ["values", "recordValues"], ["entries", "recordEntries"],
]);

// D29 item 14: compiler-owned value/collection methods that return a fresh
// value without mutating their receiver. An expression statement that calls
// one of these and drops the result is always a bug. Mutate-and-return
// operations (pop/remove) and null-returning mutators stay legal,
// and user-function purity is deliberately never analyzed (D26 retired that).
export const discardedPureCollectionOperations = new Set<CollectionOperation>([
  "listGet", "mapGet", "recordGet", "slice", "listCopy", "listCount", "listIndex", "listFind", "listSome", "listEvery",
  "listMap", "listFilter", "listFlatMap", "listReduce", "listJoin", "listSorted", "listReversed",
  "listSum", "listMin", "listMax", "setCopy", "setUnion", "setIntersection", "setDifference", "mapCopy", "recordCopy",
  "listUnique", "listCompact", "listFlatten", "listChunk", "listPartition", "listGroupBy", "listKeyBy", "listCountBy",
  "listZip", "listRepeat",
  "listHas", "mapHas", "setHas", "recordHas", "mapIterator", "mapKeys", "recordKeys", "mapValues", "setValues", "recordValues", "mapEntries", "recordEntries",
]);

export const CORE_LIST_METHOD_NAMES = Object.freeze([
  "get", "slice", "append", "extend", "insert", "remove", "pop", "clear", "copy", "has", "count", "index",
  "find", "some", "every", "map", "flatMap", "filter", "reduce", "join", "sorted", "reversed", "sum", "min", "max",
  "unique", "compact", "flatten", "chunk", "partition", "groupBy", "keyBy", "countBy", "zip", "repeat",
] as const);
export const CORE_MAP_METHOD_NAMES = Object.freeze([
  "get", "set", "getOrSet", "getOrSetWith", "update", "has", "remove", "clear", "copy", "iterator", "keys", "values", "entries",
] as const);
export const CORE_SET_METHOD_NAMES = Object.freeze([
  "add", "update", "has", "remove", "clear", "copy", "values", "union", "intersection", "difference",
] as const);
export const CORE_RECORD_METHOD_NAMES = Object.freeze([
  "get", "set", "has", "remove", "clear", "copy", "keys", "values", "entries",
] as const);

/**
 * The collection methods that change their receiver, by the kind of collection
 * the receiver is. `readonly` refuses exactly these through a read-only view,
 * and the Web extension's watch analysis asks the same question of a watch
 * body: a call of one of these on the watched collection is a write of the
 * subject, exactly as an assignment to it is.
 *
 * One roster, one answer. Two copies of it would be one concept with two
 * definitions -- the shape this repository keeps finding -- and the copy that
 * fell behind would be the one that decided whether a program compiles.
 */
export function mutatingCollectionMethods(kind: "list" | "map" | "set" | "record"): ReadonlySet<string> {
  return kind === "list"
    ? new Set(["append", "extend", "insert", "remove", "pop", "clear"])
    : kind === "map" ? new Set(["set", "getOrSet", "getOrSetWith", "update", "remove", "clear"])
      : kind === "set" ? new Set(["add", "update", "remove", "clear"])
        : new Set(["set", "remove", "clear"]);
}

/**
 * A synchronous cursor returns an optional wrapper rather than `T?` directly.
 * The wrapper keeps exhaustion distinct from a legitimate `null` collection
 * value: `null` means there is no next item, while `{value: null}` is an item.
 */
const iteratorOf = (value: ValueType): ValueType => {
  const step: ValueType = {
    kind: "object",
    fields: new Map([["value", value]]),
    readonlyFields: new Set(["value"]),
  };
  return {
    kind: "object",
    fields: new Map([["next", {kind: "function", parameters: [], requiredParameters: 0, result: optionalOf(step)}]]),
    readonlyFields: new Set(["next"]),
  };
};


/** The types every List member contract is written in terms of. */
interface ListMemberShapes {
  readonly element: ValueType;
  readonly comparison: ValueType;
  readonly owned: ValueType;
  readonly test: ValueType;
  readonly compare: ValueType;
  readonly selectKey: ValueType;
  readonly selectAnyKey: ValueType;
}

/** One published member contract: its named parameters, their types, its result. */
const memberCallable = (
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType => ({ kind: "function", parameterNames, parameters, requiredParameters, result });

/**
 * D114 0.28.0 I-I1: one published contract for the three `…By` members, whose
 * result is a Map over whatever key the selector answers. The key is the
 * contract's own type parameter, so a bound or `?.` call solves it from the
 * selector exactly as the direct call solves it from the arrow's body.
 */
const keyedCallable = (selector: ValueType, result: (key: ValueType) => ValueType): ValueType => {
  const key: ValueType = { kind: "parameter", name: "K", index: 0 };
  const selected = selector.kind === "function" ? { ...selector, result: key } : selector;
  return { kind: "function", typeParameterNames: ["K"], parameterNames: ["key"], parameters: [selected], requiredParameters: 1, result: result(key) };
};

/** The receiver kinds that publish compiler-owned collection members. */
type CollectionReceiverType = Extract<ValueType, { readonly kind: "list" | "map" | "set" | "record" }>;

type CallableValueType = Extract<ValueType, { readonly kind: "function" | "action" | "intrinsic" }>;

/**
 * The views of the receiver one call is judged against: what a read through it
 * publishes (`readonly*`, which is the read-only data view when the receiver is
 * a read-only view) and what a `==` probe is weighed against (`comparison*`,
 * always the read-only data view). Each is null for a receiver kind that has no
 * such position.
 */
interface CollectionReceiverViews {
  readonly readonlyElement: ValueType | null;
  readonly comparisonElement: ValueType | null;
  readonly readonlyKey: ValueType | null;
  readonly comparisonKey: ValueType | null;
  readonly readonlyValue: ValueType | null;
}

/** The arguments of one call, after a named-argument plan has resolved them. */
interface ResolvedCollectionArguments {
  readonly arguments_: readonly Expression[];
  readonly namedPreanalyzed: boolean;
}

/** A named-argument plan answered the call outright; no operation family runs. */
interface AnsweredCollectionCall {
  readonly answer: ValueType;
}

/**
 * The lowering side tables one collection call writes. `LoweringRecorder`
 * satisfies this; naming only what is written keeps the recorder's other 50
 * tables out of this cluster's dependency face.
 */
interface CollectionLoweringFacts {
  readonly collectionCalls: Map<number, CollectionOperation>;
}

/**
 * Everything the collection cluster asks of the analyzer that hosts it, and
 * nothing more.
 */
export interface CollectionInferenceHost {
  /** The module source, read to withhold a rewrite that would erase a comment. */
  readonly sourceText: string;
  /** The sink `reportRetiredCollectionImports` writes its recovered reports to. */
  readonly diagnostics: Diagnostic[];
  /** What the emitter will lower each collection call to. */
  readonly lowering: CollectionLoweringFacts;
  /** The receiver type each member access resolved to, for the semantic index. */
  readonly semanticExpressionOwners: Map<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void;
  requireMembershipIntersection(probe: ValueType, domain: ValueType, span: Span, operation: string): boolean;
  rejectFreshCollectionProbe(probe: Expression, operation: string, probes: "element" | "key"): boolean;
  rejectCollidingKeyDomain(keySource: ValueType, span: Span, position: string): void;
  expandAliases(type: ValueType): ValueType;
  readonlyDataViewOf(type: ValueType): ValueType;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferredOrAnalyze(expression: Expression): ValueType;
  inferredExpressionType(expression: Expression): ValueType;
  recordSemanticExpression(expression: Expression, type: ValueType): void;
  concreteCallableFor(actual: ValueType, expected: ValueType, errorSpan?: Span): ValueType;
  /**
   * `isAssignable` judged against the analyzer as the type environment, which
   * is the whole of what `List.sum` and `List.join` ask of it. Asking for the
   * answer rather than for the environment keeps every optional hook of
   * `TypeEnvironment` out of this cluster's dependency face.
   */
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  checkArguments(
    arguments_: readonly Expression[],
    parameters: readonly ValueType[],
    callSpan: Span,
    requiredParameters?: number,
  ): void;
  /**
   * The named-argument plan, declared structurally: the plan itself is call
   * machinery, and naming its type here would make this module depend on the
   * module that owns it for a shape it only reads.
   */
  planNamedArguments(
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    parameters: readonly ValueType[],
    parameterNames: readonly string[] | undefined,
    requiredParameters: number,
    callSpan: Span,
    rest?: ValueType,
  ): {
    readonly ordered: readonly Expression[];
    readonly targets: readonly (number | null)[];
    readonly valid: boolean;
  } | null;
  /** D42 item 65's single authority on whether a key carries a runtime order. */
  orderedTypeCategory(source: ValueType): "number" | "string" | "comparable" | "dynamic" | null;
  unorderedTypeGuidance(...types: readonly ValueType[]): string;
  /** Renders the import line a partly-migrated `velar/collections` import becomes. */
  renderNamedImport(source: string, specifiers: readonly { readonly imported: string; readonly local: string }[]): string;
}

/**
 * One collection call in flight. The prologue of `inferCollectionCall` used to
 * declare these as closures over its own locals; they are the same code, and
 * they are held here so the operation families can be separate methods without
 * passing eight values to each of them.
 */
class CollectionCall {
  private readonly host: CollectionInferenceHost;
  readonly member: Extract<Expression, { kind: "MemberExpression" }>;
  readonly sourceArguments: readonly Expression[];
  readonly argumentNames: readonly (string | null)[] | undefined;
  readonly callSpan: Span;
  readonly readonlyElement: ValueType | null;
  readonly comparisonElement: ValueType | null;
  readonly readonlyKey: ValueType | null;
  readonly comparisonKey: ValueType | null;
  readonly readonlyValue: ValueType | null;
  /** The arguments in parameter order, and whether they are already inferred. */
  readonly arguments_: readonly Expression[];
  readonly namedPreanalyzed: boolean;
  /**
   * `judgeResult` is false for a key selector, whose *shape* is what
   * assignability judges: whether the key it answers is ordered, or usable as
   * a Map key, is asked once by the single authority for that question, so a
   * `Comparable`-bounded key is not refused by the union spelling here
   * (D42 item 65). A selector the shape check already refused is recorded, so
   * that authority stays silent instead of naming the same argument twice.
   */
  readonly rejectedListCallbacks = new Set<number>();

  constructor(
    host: CollectionInferenceHost,
    member: Extract<Expression, { kind: "MemberExpression" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    views: CollectionReceiverViews,
    resolved: ResolvedCollectionArguments,
  ) {
    this.host = host;
    this.member = member;
    this.sourceArguments = sourceArguments;
    this.argumentNames = argumentNames;
    this.callSpan = callSpan;
    this.readonlyElement = views.readonlyElement;
    this.comparisonElement = views.comparisonElement;
    this.readonlyKey = views.readonlyKey;
    this.comparisonKey = views.comparisonKey;
    this.readonlyValue = views.readonlyValue;
    this.arguments_ = resolved.arguments_;
    this.namedPreanalyzed = resolved.namedPreanalyzed;
  }

  private omitted(argument: Expression | undefined): boolean {
    return argument?.kind === "IdentifierExpression" && argument.name === "\u0000omitted-named-argument";
  }

  argumentAt(index: number): Expression | null {
    const argument = this.arguments_[index];
    return !argument || this.omitted(argument) ? null : argument;
  }

  inferArgument(index: number, contextualType: ValueType = unknownType): ValueType {
    const argument = this.argumentAt(index);
    if (!argument) return unknownType;
    return this.namedPreanalyzed ? this.host.inferredExpressionType(argument) : this.host.inferExpression(argument, contextualType);
  }

  checkCollectionArguments(parameters: readonly ValueType[], requiredParameters = parameters.length): void {
    if (!this.namedPreanalyzed) {
      this.host.checkArguments(this.arguments_, parameters, this.callSpan, requiredParameters);
      return;
    }
    for (const [index, expected] of parameters.entries()) {
      const argument = this.argumentAt(index);
      if (argument) this.host.requireAssignable(this.host.inferredExpressionType(argument), expected, argument.span);
    }
  }

  requireCount(count: number): void {
    if (!this.namedPreanalyzed && this.arguments_.length !== count) this.host.typeError(`Expected ${count} argument${count === 1 ? "" : "s"} but received ${this.arguments_.length}`, this.callSpan);
  }

  // D113, completed by D114 S3b item A: one contract for every List operation
  // that receives an element — the value and the zero-based position in the
  // snapshot the operation reads. A callback that needs only the value
  // declares only the value and is assignable to that contract the way
  // JavaScript admits it, by ignoring an argument it did not ask for, so the
  // contract the author is shown is the contract assignability judges.
  private listCallbackContract(result: ValueType): ValueType {
    return {
      kind: "function",
      parameters: [this.readonlyElement!, numberType],
      requiredParameters: 2,
      result,
    };
  }

  inferListCallback(index: number, result: ValueType, judgeResult = true): ValueType {
    const argument = this.argumentAt(index);
    if (!argument) return unknownType;
    const expected = this.listCallbackContract(result);
    const judged = judgeResult ? expected : this.listCallbackContract(unknownType);
    let callback = this.namedPreanalyzed ? this.host.inferredExpressionType(argument) : this.inferArgument(index, expected);
    callback = this.host.concreteCallableFor(callback, judged, argument.span);
    const reported = this.host.diagnostics.length;
    this.host.requireAssignable(callback, judged, argument.span);
    if (this.host.diagnostics.length > reported) this.rejectedListCallbacks.add(index);
    return callback;
  }

  // ENM-I3: a membership probe (`has`, `index`, `count`, `remove`, and the
  // Map/Record key of `get`) is judged by intersection with the element or
  // key domain — the per-element `==` question — rather than assignability,
  // whose enum -> string one-way exit would launder a bare-string match.
  checkProbeArgument(domain: ValueType, operation: string, probes: "element" | "key" = "element"): void {
    this.requireCount(1);
    const argument = this.argumentAt(0);
    if (!argument) return;
    if (argument.kind === "SpreadExpression") {
      this.host.inferExpression(argument.value);
      return;
    }
    const probe = this.namedPreanalyzed ? this.host.inferredExpressionType(argument) : this.host.inferExpression(argument, domain);
    // The domain mismatch is the more precise answer where both apply, so
    // the fresh-literal rejection speaks only when the probe's type is right
    // and identity is the sole reason it can never match.
    if (!this.host.requireMembershipIntersection(probe, domain, argument.span, operation)) {
      this.host.rejectFreshCollectionProbe(argument, operation, probes);
    }
    if (!this.namedPreanalyzed) {
      for (const extra of this.arguments_.slice(1)) {
        if (!this.omitted(extra)) this.host.inferExpression(extra.kind === "SpreadExpression" ? extra.value : extra);
      }
    }
  }
}

export class CollectionInference {

  private readonly host: CollectionInferenceHost;

  /** The migration off `velar/collections`, whose members this cluster owns. */
  readonly retired: RetiredCollectionMigration;

  constructor(host: CollectionInferenceHost) {
    this.host = host;
    this.retired = new RetiredCollectionMigration(host);
  }

  /**
   * One call of a compiler-owned collection member. The prologue resolves the
   * receiver, refuses a mutation through a read-only view, publishes the
   * member's contract and settles the arguments; the receiver's kind then
   * selects the family that types the operation. Every step runs in the order
   * it ran when this was one method, because each one writes diagnostics or
   * lowering the next may read.
   */
  inferCollectionCall(
    member: Extract<Expression, { kind: "MemberExpression" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType | null {
    const object = this.host.expandAliases(this.host.inferredOrAnalyze(member.object));
    if (object.kind !== "list" && object.kind !== "map" && object.kind !== "set" && object.kind !== "record") return null;
    const mutating = mutatingCollectionMethods(object.kind);
    if (object.readonlyView && mutating.has(member.property)) {
      for (const argument of sourceArguments) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.host.typeError(`Cannot call mutating method '${member.property}' through ${describeType(object)}; it is a read-only view`, member.span);
      return invalidType;
    }
    const views = this.receiverViews(object);
    this.host.semanticExpressionOwners.set(`${member.span.start}:${member.span.end}`, nonOptional(object));
    const memberType = object.kind === "list" ? this.listMember(object, member.property)
      : object.kind === "map" ? this.mapMember(object, member.property)
        : object.kind === "set" ? this.setMember(object, member.property)
          : object.kind === "record" ? this.recordMember(object, member.property)
          : unknownType;
    this.host.recordSemanticExpression(member, memberType ?? unknownType);
    const resolved = this.resolveArguments(member, object, sourceArguments, argumentNames, callSpan, memberType, views.readonlyElement);
    if ("answer" in resolved) return resolved.answer;
    const call = new CollectionCall(this.host, member, sourceArguments, argumentNames, callSpan, views, resolved);
    const lowered = object.kind === "list"
      ? (CORE_LIST_METHOD_NAMES as readonly string[]).includes(member.property)
      : object.kind === "map" ? (CORE_MAP_METHOD_NAMES as readonly string[]).includes(member.property)
        : object.kind === "set" ? (CORE_SET_METHOD_NAMES as readonly string[]).includes(member.property)
          : object.kind === "record" ? (CORE_RECORD_METHOD_NAMES as readonly string[]).includes(member.property) : false;
    if (lowered && call.arguments_.some((argument) => argument.kind === "SpreadExpression")) {
      this.host.typeError(`Spread arguments are not supported by ${describeType(object)}.${member.property}`, callSpan);
    }
    if (object.kind === "list") return this.inferListCall(call, object);
    if (object.kind === "map") return this.inferMapCall(call, object);
    if (object.kind === "record") return this.inferRecordCall(call, object);
    return this.inferSetCall(call, object);
  }

  /** The read-only and comparison views of the receiver's element, key and value. */
  private receiverViews(object: CollectionReceiverType): CollectionReceiverViews {
    return {
      readonlyElement: (object.kind === "list" || object.kind === "set") && object.readonlyView
        ? this.host.readonlyDataViewOf(object.element)
        : object.kind === "list" || object.kind === "set" ? object.element : null,
      comparisonElement: object.kind === "list" || object.kind === "set" ? this.host.readonlyDataViewOf(object.element) : null,
      readonlyKey: object.kind === "map" && object.readonlyView ? this.host.readonlyDataViewOf(object.key) : object.kind === "map" ? object.key : null,
      comparisonKey: object.kind === "map" ? this.host.readonlyDataViewOf(object.key) : null,
      readonlyValue: (object.kind === "map" || object.kind === "record") && object.readonlyView
        ? this.host.readonlyDataViewOf(object.value)
        : object.kind === "map" || object.kind === "record" ? object.value : null,
    };
  }

  /**
   * The arguments the operation families see. A named-argument call is planned
   * against the member's published parameter names and every argument is
   * inferred here, before any family runs; a positional call is passed through
   * untouched. A plan that did not resolve answers the whole call.
   */
  private resolveArguments(
    member: Extract<Expression, { kind: "MemberExpression" }>,
    object: CollectionReceiverType,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    memberType: ValueType | null,
    readonlyElement: ValueType | null,
  ): ResolvedCollectionArguments | AnsweredCollectionCall {
    const callableMember: CallableValueType | null = memberType
      && (memberType.kind === "function" || memberType.kind === "action" || memberType.kind === "intrinsic")
      ? memberType
      : null;
    const named = callableMember
      ? this.host.planNamedArguments(
        sourceArguments,
        argumentNames,
        callableMember.parameters,
        callableMember.parameterNames,
        callableMember.requiredParameters,
        callSpan,
        callableMember.rest,
      )
      : null;
    if (!named) return { arguments_: sourceArguments, namedPreanalyzed: false };
    const inferSource = (contextForTarget: (target: number) => ValueType): void => {
      for (const [source, target] of named.targets.entries()) {
        const argument = sourceArguments[source]!;
        this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument, target === null ? unknownType : contextForTarget(target));
      }
    };
    if (!named.valid) {
      // A plan that did not resolve cannot solve a published type parameter
      // either — `reduce`'s accumulator is the only one — so the arguments
      // are inferred without a contextual type and the call answers
      // `unknown` rather than leaking the parameter into the program.
      const open = (callableMember!.typeParameterNames?.length ?? 0) > 0;
      inferSource((target) => open ? unknownType : callableMember!.parameters[target] ?? unknownType);
      return { answer: open ? unknownType : callableMember!.result };
    }
    if (object.kind === "list" && member.property === "reduce") {
      let initial = unknownType;
      let deferred: ArrowFunctionExpression | null = null;
      for (const [source, target] of named.targets.entries()) {
        const argument = sourceArguments[source]!;
        if (target === 0 && argument.kind === "ArrowFunctionExpression") deferred = argument;
        else if (target === 1) initial = this.host.inferExpression(argument);
        else this.host.inferExpression(argument);
      }
      if (deferred) {
        this.host.inferExpression(deferred, {
          kind: "function",
          parameters: [initial, readonlyElement!, numberType],
          requiredParameters: 3,
          result: initial,
        });
      }
    } else {
      inferSource((target) => callableMember!.parameters[target] ?? unknownType);
    }
    return { arguments_: named.ordered, namedPreanalyzed: true };
  }

  /**
   * The List operations, tried in the order the one method evaluated them in.
   * Each family answers null for a property it does not own; every property it
   * does own returns a type, so no family can be skipped by an answer of null.
   */
  private inferListCall(call: CollectionCall, object: Extract<ValueType, { kind: "list" }>): ValueType | null {
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

  /** The Map operations. */
  private inferMapCall(call: CollectionCall, object: Extract<ValueType, { kind: "map" }>): ValueType | null {
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

  /** The Record operations. */
  private inferRecordCall(call: CollectionCall, object: Extract<ValueType, { kind: "record" }>): ValueType | null {
    if (call.member.property === "set") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordSet");
      call.checkCollectionArguments([stringType, object.value]);
      return nullType;
    }
    if (call.member.property === "get") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordGet");
      call.checkProbeArgument(stringType, "Record.get", "key");
      return optionalOf(call.readonlyValue!);
    }
    if (call.member.property === "keys") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordKeys");
      call.checkCollectionArguments([]);
      return { kind: "list", element: stringType };
    }
    if (call.member.property === "values") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordValues");
      call.checkCollectionArguments([]);
      return { kind: "list", element: call.readonlyValue! };
    }
    if (call.member.property === "entries") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordEntries");
      call.checkCollectionArguments([]);
      return { kind: "list", element: { kind: "object", fields: new Map([["key", stringType], ["value", call.readonlyValue!]]) } };
    }
    if (call.member.property === "has") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordHas");
      call.checkProbeArgument(stringType, "Record.has", "key");
      return boolType;
    }
    if (call.member.property === "remove") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordRemove");
      call.checkProbeArgument(stringType, "Record.remove", "key");
      return boolType;
    }
    if (call.member.property === "clear") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordClear");
      call.checkCollectionArguments([]);
      return nullType;
    }
    if (call.member.property === "copy") {
      this.host.lowering.collectionCalls.set(call.member.span.end, "recordCopy");
      call.checkCollectionArguments([]);
      return { kind: "record", value: call.readonlyValue! };
    }
    return null;
  }

  /** The Set operations, including the set algebra. */
  private inferSetCall(call: CollectionCall, object: Extract<ValueType, { kind: "set" }>): ValueType | null {
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

  /**
   * What a List publishes under `property`, or null when it publishes nothing
   * under that name. The two halves own disjoint member names and neither
   * writes anything, so the answer is the answer the one switch gave.
   */
  listMember(list: Extract<ValueType, { kind: "list" }>, property: string): ValueType | null {
    const element = list.readonlyView ? this.host.readonlyDataViewOf(list.element) : list.element;
    // D113, completed by D114 S3b item A: every callback that receives an
    // element is handed the value and the snapshot index, so the published
    // contract says two arguments arrive. A callback that declares only `value`
    // is assignable to it the way JavaScript admits one — by ignoring the
    // argument it did not ask for.
    const shapes: ListMemberShapes = {
      element,
      comparison: this.host.readonlyDataViewOf(list.element),
      owned: { kind: "list", element },
      test: { kind: "function", parameters: [element, numberType], requiredParameters: 2, result: boolType },
      compare: { kind: "function", parameters: [element, element], requiredParameters: 2, result: numberType },
      selectKey: { kind: "function", parameters: [element, numberType], requiredParameters: 2, result: unionOf([numberType, stringType]) },
      selectAnyKey: { kind: "function", parameters: [element, numberType], requiredParameters: 2, result: unknownType },
    };
    return this.listCoreMember(list, shapes, property) ?? this.listPipelineMember(shapes, property);
  }

  /** The positional, mutating, probing and ordering members. */
  private listCoreMember(
    list: Extract<ValueType, { kind: "list" }>,
    shapes: ListMemberShapes,
    property: string,
  ): ValueType | null {
    const { element, comparison, owned, compare, selectKey } = shapes;
    switch (property) {
      case "size":
        return numberType;
      case "get":
        return memberCallable(["index"], [numberType], optionalOf(element));
      case "slice":
        return memberCallable(["start", "end"], [numberType, numberType], owned, 0);
      case "append":
        if (list.readonlyView) return null;
        return memberCallable(["value"], [list.element], nullType);
      case "extend":
        if (list.readonlyView) return null;
        return memberCallable(["values"], [list], nullType);
      case "insert":
        if (list.readonlyView) return null;
        return memberCallable(["index", "value"], [numberType, list.element], nullType);
      case "remove":
        if (list.readonlyView) return null;
        return memberCallable(["value"], [comparison], boolType);
      case "pop":
        if (list.readonlyView) return null;
        return memberCallable(["index"], [numberType], list.element, 0);
      case "clear":
        if (list.readonlyView) return null;
        return memberCallable([], [], nullType);
      case "copy":
      case "reversed":
        return memberCallable([], [], owned);
      case "has":
        return memberCallable(["value"], [comparison], boolType);
      case "count":
        return memberCallable(["value"], [comparison], numberType);
      case "sorted":
        return memberCallable(["compare", "by", "descending"], [compare, selectKey, boolType], owned, 0);
      case "sum":
        return memberCallable([], [], numberType);
      case "min":
      case "max":
        return memberCallable(["by"], [selectKey], optionalOf(element), 0);
      default:
        return null;
    }
  }

  /**
   * D114 S3: the pipeline members. Each answers a fresh container, so a
   * read-only receiver publishes them exactly as `map` and `filter`.
   */
  private listPipelineMember(shapes: ListMemberShapes, property: string): ValueType | null {
    const { element, comparison, owned, test, selectAnyKey } = shapes;
    switch (property) {
      case "unique":
        return memberCallable([], [], owned);
      case "repeat":
        return memberCallable(["count"], [numberType], owned);
      case "compact":
        return memberCallable([], [], { kind: "list", element: nonOptional(this.host.expandAliases(element)) });
      case "flatten": {
        const inner = this.host.expandAliases(element);
        return memberCallable([], [], { kind: "list", element: inner.kind === "list" ? inner.element : unknownType });
      }
      case "chunk":
        return memberCallable(["size"], [numberType], { kind: "list", element: owned });
      case "partition":
        return memberCallable(["test"], [test], { kind: "object", fields: new Map([["matches", owned], ["rest", owned]]) });
      // D114 0.28.0 I-I1: a member whose result depends on a type the call
      // solves publishes that type as its own parameter, exactly as `reduce`
      // publishes its accumulator. Without it a bound `const group =
      // values.groupBy` and a `values?.groupBy(...)` answered `Map<unknown,
      // …>` while the direct call answered `Map<bool, …>` — one member, two
      // results.
      case "groupBy":
        return keyedCallable(selectAnyKey, (key) => ({ kind: "map", key, value: owned }));
      case "keyBy":
        return keyedCallable(selectAnyKey, (key) => ({ kind: "map", key, value: element }));
      case "countBy":
        return keyedCallable(selectAnyKey, (key) => ({ kind: "map", key, value: numberType }));
      case "zip": {
        // The partner's element is the second half of every pair, so it is the
        // call's own type parameter: `List<U>` unifies with any concrete List
        // the way `Map<K, …>` does, and the invariance a fixed `List<T>`
        // parameter would impose never arises.
        const partner: ValueType = { kind: "parameter", name: "U", index: 0 };
        return {
          kind: "function",
          typeParameterNames: ["U"],
          parameterNames: ["other"],
          parameters: [{ kind: "list", element: partner }],
          requiredParameters: 1,
          result: { kind: "list", element: { kind: "object", fields: new Map([["first", element], ["second", partner]]) } },
        };
      }
      case "map":
      case "flatMap": {
        const produced: ValueType = { kind: "parameter", name: "R", index: 0 };
        const transformed: ValueType = property === "map" ? produced : { kind: "list", element: produced };
        return {
          kind: "function",
          typeParameterNames: ["R"],
          parameterNames: ["transform"],
          parameters: [{ kind: "function", parameters: [element, numberType], requiredParameters: 2, result: transformed }],
          requiredParameters: 1,
          result: { kind: "list", element: produced },
        };
      }
      case "filter":
        return memberCallable(["test"], [test], owned);
      // D113, completed by D114 S3c: the combine receives an element, so it
      // receives that element's snapshot position too, in the parameter after
      // the element. The accumulator is the fold's own type, bound from
      // `initial`, so the published contract names it rather than erasing it to
      // `unknown` — the contract a bound `const fold = values.reduce` and a
      // `values?.reduce(...)` are checked against is then the same
      // `(accumulator, value, index)` the direct call and the runtime use.
      case "reduce": {
        const accumulator: ValueType = { kind: "parameter", name: "U", index: 0 };
        return {
          kind: "function",
          typeParameterNames: ["U"],
          parameterNames: ["combine", "initial"],
          parameters: [
            { kind: "function", parameters: [accumulator, element, numberType], requiredParameters: 3, result: accumulator },
            accumulator,
          ],
          requiredParameters: 2,
          result: accumulator,
        };
      }
      case "some":
      case "every":
        return memberCallable(["test"], [test], boolType);
      case "find":
        return memberCallable(["test"], [test], optionalOf(element));
      case "index":
        return memberCallable(["value"], [comparison], optionalOf(numberType));
      case "join":
        return memberCallable(["separator"], [stringType], stringType, 0);
      default:
        return null;
    }
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

  mapMember(map: Extract<ValueType, { kind: "map" }>, property: string): ValueType | null {
    const key = map.readonlyView ? this.host.readonlyDataViewOf(map.key) : map.key;
    const comparisonKey = this.host.readonlyDataViewOf(map.key);
    const value = map.readonlyView ? this.host.readonlyDataViewOf(map.value) : map.value;
    const copy: ValueType = { kind: "map", key, value };
    const callable = (parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType): ValueType => ({
      kind: "function", parameterNames, parameters, requiredParameters: parameters.length, result,
    });
    switch (property) {
      case "size":
        return numberType;
      case "get":
        return memberCallable(["key"], [comparisonKey], optionalOf(value));
      case "set":
        if (map.readonlyView) return null;
        return memberCallable(["key", "value"], [map.key, map.value], nullType);
      case "getOrSet":
        if (map.readonlyView) return null;
        return memberCallable(["key", "fallback"], [map.key, map.value], map.value);
      case "getOrSetWith":
        if (map.readonlyView) return null;
        return memberCallable(["key", "factory"], [map.key, callable([], [], map.value)], map.value);
      case "update":
        if (map.readonlyView) return null;
        return memberCallable(["values"], [map], nullType);
      case "has":
        return memberCallable(["key"], [comparisonKey], boolType);
      case "remove":
        if (map.readonlyView) return null;
        return memberCallable(["key"], [comparisonKey], boolType);
      case "clear":
        if (map.readonlyView) return null;
        return memberCallable([], [], nullType);
      case "copy":
        return memberCallable([], [], copy);
      case "iterator":
        return memberCallable([], [], iteratorOf(key));
      case "keys":
        return memberCallable([], [], { kind: "list", element: key });
      case "values":
        return memberCallable([], [], { kind: "list", element: value });
      case "entries":
        return memberCallable([], [], { kind: "list", element: { kind: "object", fields: new Map([["key", key], ["value", value]]) } });
      default:
        return null;
    }
  }

  recordMember(record: Extract<ValueType, { kind: "record" }>, property: string): ValueType | null {
    const value = record.readonlyView ? this.host.readonlyDataViewOf(record.value) : record.value;
    const copy: ValueType = { kind: "record", value };
    const callable = (parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType): ValueType => ({
      kind: "function", parameterNames, parameters, requiredParameters: parameters.length, result,
    });
    switch (property) {
      case "size": return numberType;
      case "get": return callable(["key"], [stringType], optionalOf(value));
      case "set": return record.readonlyView ? null : callable(["key", "value"], [stringType, record.value], nullType);
      case "has": return callable(["key"], [stringType], boolType);
      case "remove": return record.readonlyView ? null : callable(["key"], [stringType], boolType);
      case "clear": return record.readonlyView ? null : callable([], [], nullType);
      case "copy": return callable([], [], copy);
      case "keys": return callable([], [], { kind: "list", element: stringType });
      case "values": return callable([], [], { kind: "list", element: value });
      case "entries": return callable([], [], { kind: "list", element: { kind: "object", fields: new Map([["key", stringType], ["value", value]]) } });
      default: return null;
    }
  }

  setMember(set: Extract<ValueType, { kind: "set" }>, property: string): ValueType | null {
    const element = set.readonlyView ? this.host.readonlyDataViewOf(set.element) : set.element;
    const comparison = this.host.readonlyDataViewOf(set.element);
    const copy: ValueType = { kind: "set", element };
    const callable = (parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType): ValueType => ({
      kind: "function", parameterNames, parameters, requiredParameters: parameters.length, result,
    });
    switch (property) {
      case "size":
        return numberType;
      case "add":
        if (set.readonlyView) return null;
        return memberCallable(["value"], [set.element], nullType);
      case "update":
        if (set.readonlyView) return null;
        return memberCallable(["values"], [{ kind: "union", members: [set, { kind: "list", element: set.element }] }], nullType);
      case "has":
        return memberCallable(["value"], [comparison], boolType);
      case "remove":
        if (set.readonlyView) return null;
        return memberCallable(["value"], [comparison], boolType);
      case "clear":
        if (set.readonlyView) return null;
        return memberCallable([], [], nullType);
      case "copy":
        return memberCallable([], [], copy);
      case "values":
        return memberCallable([], [], { kind: "list", element });
      case "union":
      case "intersection":
      case "difference":
        // COL-U2: the Set algebra copies — like sorted — and never mutates
        // either operand. The other operand is judged by the same
        // element-domain comparison question the membership probes use.
        return memberCallable(["other"], [{ kind: "set", element: comparison }], copy);
      default:
        return null;
    }
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
