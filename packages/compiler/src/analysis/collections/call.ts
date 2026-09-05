/**
 * One collection call in flight, and the exact list of what this directory
 * asks of the analyzer that hosts it.
 *
 * D115 §三: the operation families (`./list.ts`, `./map.ts`, `./set.ts`,
 * `./record.ts`) and the member resolvers (`./members.ts`) are separate files
 * now, and all of them are written against the same two things — the per-call
 * object the prologue builds and the host interface. Both live here so no
 * family imports another, and so `./inference.ts` is the only file of the
 * directory anything outside it constructs.
 */
import { type Expression } from "../../ast.ts";
import { type CollectionOperation } from "../../contracts.ts";
import { type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";
import {
  numberType,
  unknownType,
  type ValueType,
} from "../../types.ts";

/** The receiver kinds that publish compiler-owned collection members. */
export type CollectionReceiverType = Extract<ValueType, { readonly kind: "list" | "map" | "set" | "record" }>;

export type CallableValueType = Extract<ValueType, { readonly kind: "function" | "action" | "intrinsic" }>;

/**
 * The views of the receiver one call is judged against: what a read through it
 * publishes (`readonly*`, which is the read-only data view when the receiver is
 * a read-only view) and what a `==` probe is weighed against (`comparison*`,
 * always the read-only data view). Each is null for a receiver kind that has no
 * such position.
 */
export interface CollectionReceiverViews {
  readonly readonlyElement: ValueType | null;
  readonly comparisonElement: ValueType | null;
  readonly readonlyKey: ValueType | null;
  readonly comparisonKey: ValueType | null;
  readonly readonlyValue: ValueType | null;
}

/** The arguments of one call, after a named-argument plan has resolved them. */
export interface ResolvedCollectionArguments {
  readonly arguments_: readonly Expression[];
  readonly namedPreanalyzed: boolean;
}

/** A named-argument plan answered the call outright; no operation family runs. */
export interface AnsweredCollectionCall {
  readonly answer: ValueType;
}

/**
 * The lowering side tables one collection call writes. `LoweringRecorder`
 * satisfies this; naming only what is written keeps the recorder's other 50
 * tables out of this cluster's dependency face.
 */
export interface CollectionLoweringFacts {
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
export class CollectionCall {
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
