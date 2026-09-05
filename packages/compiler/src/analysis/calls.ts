/**
 * Call inference: what a call expression means. The callee's kind selects the
 * rule — a construction, a generic `def`, a standard-module intrinsic, an
 * optional callable, an extern JavaScript value — and every one of them shares
 * the named-argument plan that turns `f(b=2, a=1)` into positions.
 *
 * D114 R1b: this was `inferCall` (394 lines), `inferIntrinsicCall` (303), the
 * three-phase generic solver and the argument planner, spread through
 * `Analyzer`. They are one cohesive thing — everything that happens between a
 * call's parentheses — so they live in one collaborator the analyzer owns as
 * `this.calls`. What the collaborator needs back from the analyzer is declared
 * as `CallInferenceHost`: that interface is the exact record of this cluster's
 * dependency on the analyzer, and nothing widens it silently. It is wide,
 * because a call is where every other rule of the language meets.
 *
 * `inferIntrinsicCall` stays here rather than with the standard-module
 * vocabulary: two thirds of it is the named-argument plan and the argument
 * helpers `inferCall` and `inferGenericCall` use, it reads none of the
 * vocabulary tables (`jsonNamespaceType`, `mathNamespaceMembers`, ...), and it
 * is reached from nowhere but `inferCall`. What it holds is per-intrinsic
 * argument *checking*, which is call checking.
 *
 * The analyzer's own walk state that a call reads mid-flight — the class being
 * analyzed, the constructor and field-initializer depths, the sanctioned
 * `super(...)` site — is reached through getters on the host, so the reads stay
 * live rather than freezing at construction.
 */
import { type ArrowFunctionExpression, type Expression } from "../ast.ts";
import { type ClassInfo, type CompilerAnalysisExtension, type FormReadField } from "../contracts.ts";
import { diagnostic, recoveredDiagnostic, type Diagnostic, type DiagnosticFix } from "../diagnostic.ts";
import { spanIdentity, type Span } from "../source.ts";
import {
  anyType,
  boolType,
  classApplicationType,
  collectGenericBoundViolations,
  describeType,
  invalidType,
  isInvalidType,
  mergeTypes,
  mutableViewOf,
  nonOptional,
  nullType,
  numberType,
  optionalOf,
  stringType,
  substituteTypeParameters,
  typeContainsParameter,
  unifyTypeParameters,
  unionOf,
  unknownType,
  type ExtensionValueType,
  type GenericApplication,
  type TypeParameterBound,
  type ValueType,
} from "../types.ts";
import { type CollectionInference } from "./collections.ts";
import { durationType } from "./vocabulary.ts";

/**
 * D41 item 61: the one sentence each type-parameter bound is explained with,
 * wherever it is refused — at a call, at a construction, or at a generic
 * application in a type position.
 */
export const boundVocabularyGuidance: Readonly<Record<TypeParameterBound, string>> = {
  Text: "a Text parameter accepts the types with a hook-free text form — strings, numbers, bools, enums, and null",
  Comparable: "a Comparable parameter accepts the types with a runtime order — numbers and strings",
  Data: "a Data parameter accepts JSON-shaped data — strings, numbers, bools, null, enums, and the Lists, records, and Records built from them",
};


export function argumentNoun(expected: string): "argument" | "arguments" {
  return expected === "1" || expected === "at least 1" ? "argument" : "arguments";
}

export function trimTrailingOmittedArguments(sources: readonly number[]): readonly number[] {
  let length = sources.length;
  while (length > 0 && sources[length - 1] === -1) length -= 1;
  return sources.slice(0, length);
}

/** Whether a call's callee already sits inside an optional access chain. */
export function continuesOptionalChain(expression: Expression): boolean {
  if (expression.kind === "MemberExpression") {
    return expression.optional || continuesOptionalChain(expression.object);
  }
  if (expression.kind === "IndexExpression") {
    return expression.optional || continuesOptionalChain(expression.object);
  }
  if (expression.kind === "CallExpression") {
    return continuesOptionalChain(expression.callee);
  }
  return false;
}


export interface NamedArgumentPlan {
  readonly ordered: readonly Expression[];
  readonly targets: readonly (number | null)[];
  readonly valid: boolean;
}

/**
 * The solver one generic call threads through its three phases: the bindings
 * being filled in, the parameters an `unknown` argument reached, and the four
 * closures the phases share. It is the locals of the one method, named.
 */
interface GenericCallSolver {
  readonly bindings: (ValueType | null)[];
  readonly unknownParameters: Set<number>;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  expandAliases(type: ValueType): ValueType;
  substitute(declared: ValueType): ValueType;
  solvedContext(declared: ValueType): ValueType;
}

/** One argument of a generic call, with the parameter it was planned onto. */
export interface PlannedArgument {
  readonly value: Expression;
  readonly declared: ValueType | null;
  readonly errorSpan: Span;
  readonly spreadList: boolean;
}

/**
 * The lowering side tables one call writes. `LoweringRecorder` satisfies this;
 * naming only what is written keeps its other tables out of this cluster's
 * dependency face.
 */
interface CallLoweringFacts {
  readonly constructorCalls: Set<string>;
  readonly equalsCalls: Set<string>;
  readonly formReads: Map<string, readonly FormReadField[]>;
  readonly javaScriptCallBoundaries: Set<string>;
  readonly moduleTopLevelHostCalls: Set<string>;
  readonly namedArgumentOrders: Map<string, readonly number[]>;
  readonly optionalCallees: Set<string>;
  readonly optionalCalls: Set<string>;
}

/**
 * Everything the call cluster asks of the analyzer that hosts it, and nothing
 * more.
 */
export interface CallInferenceHost {
  readonly allowedSuperCall: string | null;
  readonly analysisExtensions: readonly CompilerAnalysisExtension[];
  boundaryReceiverText(expression: Expression): string | null;
  readonly callExpressionCallees: Set<string>;
  checkArguments(arguments_: readonly Expression[], parameters: readonly ValueType[], callSpan: Span, requiredParameters?: number, rest?: ValueType, argumentNames?: readonly (string | null)[], parameterNames?: readonly string[]): void;
  checkTestMatcherComparand(calleeExpression: Expression, arguments_: readonly Expression[]): void;
  readonly classFieldInitializerDepth: number;
  classInfo(key: string): ClassInfo | undefined;
  readonly classes: Map<string, ClassInfo>;
  readonly collections: CollectionInference;
  commentPreservingMechanicalFix(rewriteSpan: Span, replacement: string, title: string): DiagnosticFix | undefined;
  concreteCallableFor(actual: ValueType, expected: ValueType, errorSpan?: Span): ValueType;
  readonly constructorDepth: number;
  contextualCollectionType(type: ValueType): Extract<ValueType, { kind: "list" | "map" | "set" }> | null;
  readonly currentClass: string | null;
  readonly diagnostics: Diagnostic[];
  enumMeetDomain(left: ValueType, right: ValueType): "string" | "number";
  equalityGuidance(leftSource: ValueType, rightSource: ValueType): string;
  equalityTypesIntersect(leftSource: ValueType, rightSource: ValueType): boolean;
  equalsDomainViolation(source: ValueType, seen?: Set<string>): string | null;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  formReadField(name: string, source: ValueType, fieldSpan: Span): FormReadField | null;
  inModuleInitializationPosition(): boolean;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferExtensionCall( _callee: ExtensionValueType, _arguments: readonly Expression[], _argumentNames: readonly (string | null)[] | undefined, _callSpan: Span, ): ValueType | undefined;
  inferPrimitiveCall( member: Extract<Expression, { kind: "MemberExpression" }>, arguments_: readonly Expression[], argumentNames: readonly (string | null)[] | undefined, callSpan: Span, ): ValueType | null;
  inferRecordFromCall( member: Extract<Expression, { kind: "MemberExpression" }>, sourceArguments: readonly Expression[], argumentNames: readonly (string | null)[] | undefined, callSpan: Span, ): ValueType | null;
  inferRecordMapFromCall( member: Extract<Expression, { kind: "MemberExpression" }>, sourceArguments: readonly Expression[], argumentNames: readonly (string | null)[] | undefined, callSpan: Span, ): ValueType | null;
  inferredExpressionType(expression: Expression): ValueType;
  readonly instanceFieldInitializerDepth: number;
  readonly invalidDeclaredTypes: Set<string>;
  invalidateMutableCollectionCallReceiver(callee: Extract<Expression, { kind: "MemberExpression" }>): void;
  isHttpFormBody(source: ValueType): boolean;
  isSubclassOf(actual: string, expected: string): boolean;
  iterationGuidance(type: ValueType): string;
  iterationSource(expression: Expression, type: ValueType): ValueType;
  readonly javaScriptBindings: Set<string>;
  jsonSerializable(source: ValueType, seen?: ReadonlySet<string>): boolean | null;
  /** The binding a name resolves to; a call reads only the type it holds. */
  lookup(name: string): { readonly type: ValueType } | null;
  readonly lowering: CallLoweringFacts;
  readonly memberAccessReceivers: Set<string>;
  readonly namedTypes: Map<string, ReadonlyMap<string, ValueType>>;
  noteGenericApplications(type: ValueType, seen?: Set<string>): void;
  optionalExecutionNarrowings(expression: Expression): ReadonlyMap<string, ValueType>;
  readonlyDataViewOf(type: ValueType): ValueType;
  recordMemberAccessProperty(expression: Extract<Expression, { kind: "MemberExpression" }>): void;
  recordRuntimeObjectShape(expression: Extract<Expression, { kind: "ObjectExpression" }>, owner: Extract<ValueType, { kind: "named" }>): void;
  rejectCollidingKeyDomain(keySource: ValueType, span: Span, position: string): void;
  rejectDisjointEnumValidatorProbe(calleeExpression: Expression, arguments_: readonly Expression[]): void;
  reportPromiseCarrierHazard(type: ValueType, errorSpan: Span): void;
  reportPromiseResolutionHazard(type: ValueType, errorSpan: Span): void;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void;
  requireTextConvertible(type: ValueType, span: Span, site: "f-string" | "str"): void;
  runtimeTypeObjectValue(type: Extract<ValueType, { kind: "typeObject" }>): ValueType;
  satisfiesBound(type: ValueType, bound: TypeParameterBound): boolean;
  readonly sourceText: string;
  readonly testExpectOperands: Map<string, ValueType>;
  readonly typeAliases: Map<string, ValueType>;
  readonly typeArgumentsRemovedCalls: Set<string>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  typesIntersect(leftSource: ValueType, rightSource: ValueType, enumStringVeto: boolean): boolean;
  withTemporaryNarrowings<T>( narrowed: ReadonlyMap<string, ValueType>, narrowingSpan: Span, analyze: () => T, ): T;
  /**
   * `isAssignable` judged against the analyzer as the type environment, which
   * is all the intrinsic extension hook asks of it.
   */
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
}

/** The arguments of one intrinsic call, after its named-argument plan resolved them. */
interface ResolvedIntrinsicArguments {
  readonly arguments_: readonly Expression[];
  readonly namedPreanalyzed: boolean;
  readonly deferredNamedArrows: Set<Expression>;
}

/**
 * One intrinsic call in flight. The prologue of `inferIntrinsicCall` used to
 * declare these as closures over its own locals; they are the same code, held
 * here so the per-module rules can be separate methods, and so the analysis
 * extension hook is handed the same helpers it was handed before.
 */
class IntrinsicCall {
  private readonly host: CallInferenceHost;
  private readonly intrinsic: Extract<ValueType, { kind: "intrinsic" }>;
  private readonly callSpan: Span;
  readonly arguments_: readonly Expression[];
  readonly namedPreanalyzed: boolean;
  readonly deferredNamedArrows: Set<Expression>;
  readonly suppliedCount: number;

  constructor(
    host: CallInferenceHost,
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    callSpan: Span,
    resolved: ResolvedIntrinsicArguments,
  ) {
    this.host = host;
    this.intrinsic = intrinsic;
    this.callSpan = callSpan;
    this.arguments_ = resolved.arguments_;
    this.namedPreanalyzed = resolved.namedPreanalyzed;
    this.deferredNamedArrows = resolved.deferredNamedArrows;
    this.suppliedCount = this.arguments_.reduce((count, argument) => count + (this.omitted(argument) ? 0 : 1), 0);
  }

  private omitted(argument: Expression | undefined): boolean {
    return argument?.kind === "IdentifierExpression" && argument.name === "\u0000omitted-named-argument";
  }

  argumentAt(index: number): Expression | null {
    const argument = this.arguments_[index];
    return !argument || this.omitted(argument) ? null : argument;
  }

  arity(minimum = this.intrinsic.requiredParameters, maximum = this.intrinsic.parameters.length): void {
    if (this.suppliedCount < minimum || this.suppliedCount > maximum) {
      const expected = maximum === Number.POSITIVE_INFINITY
        ? `at least ${minimum}`
        : minimum === maximum ? String(minimum) : `${minimum}-${maximum}`;
      this.host.typeError(`Expected ${expected} ${argumentNoun(expected)} but received ${this.suppliedCount}`, this.callSpan);
    }
  }

  inferAt(index: number, expected: ValueType = unknownType): ValueType {
    const argument = this.argumentAt(index);
    if (!argument) return unknownType;
    const deferred = this.deferredNamedArrows.has(argument);
    const actual = this.namedPreanalyzed && !deferred
      ? this.host.inferredExpressionType(argument)
      : this.host.inferExpression(argument, expected);
    if (deferred) this.deferredNamedArrows.delete(argument);
    if (expected.kind !== "unknown") this.host.requireAssignable(actual, expected, argument.span);
    return actual;
  }

  arrayAt(index: number): { readonly type: ValueType; readonly element: ValueType } {
    const type = this.inferAt(index);
    if (type.kind === "list") return { type, element: type.element };
    if (type.kind === "any") return { type, element: anyType };
    const argument = this.argumentAt(index);
    if (argument) this.host.typeError(`Expected a List, received ${describeType(type)}`, argument.span);
    return { type, element: unknownType };
  }

  callbackAt(index: number, parameters: readonly ValueType[], result: ValueType): ValueType {
    const expected: ValueType = { kind: "function", parameters, requiredParameters: parameters.length, result };
    return this.host.concreteCallableFor(this.inferAt(index, expected), expected, this.argumentAt(index)?.span);
  }

  callbackResult(type: ValueType): ValueType {
    return type.kind === "function" || type.kind === "action" || type.kind === "intrinsic" ? type.result : type.kind === "any" ? anyType : unknownType;
  }

  promiseValue(type: ValueType, index: number): ValueType {
    if (type.kind === "promise") return type.value;
    if (type.kind === "any") return anyType;
    const argument = this.argumentAt(index);
    if (argument) this.host.typeError(`Expected a Promise, received ${describeType(type)}`, argument.span);
    return unknownType;
  }

  runtimeTypeAt(index: number): ValueType {
    const type = this.inferAt(index);
    if (type.kind === "typeObject") return this.host.runtimeTypeObjectValue(type);
    if (type.kind === "enumObject") return { kind: "enum", name: type.name, identity: type.identity };
    if (type.kind === "runtimeType") return type.value;
    if (type.kind === "any") return anyType;
    const argument = this.argumentAt(index);
    if (argument) {
      this.host.typeError(
        "Runtime parsing requires a VelarScript runtime type: pass a declared type, enum, or alias name — 'type Saved = List<Item>' makes 'Saved' one. A primitive spelling ('string') and a generic spelling ('List<Item>') are types, not values",
        argument.span,
      );
    }
    return unknownType;
  }
}

export class CallInference {
  private readonly host: CallInferenceHost;

  constructor(host: CallInferenceHost) {
    this.host = host;
  }

  /**
   * D114 定案: a class type parameter still unsolved at the construction is an
   * error at the construction — the same stance section 8 takes for an empty
   * collection, and reported with the same code, because it is the same
   * sentence: nothing at this position says what the value holds. The report
   * names both ways out, an annotation on the position and an argument that
   * fixes the parameter, because those are the only two there are.
   */
  private inferGenericConstruction(
    callee: Extract<ValueType, { kind: "classConstructor" }>,
    info: ClassInfo,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    contextualType: ValueType,
    suppressUnsolvedReport = false,
  ): ValueType {
    const names = info.typeParameterNames ?? [];
    const declaration = info.identity ?? callee.identity ?? callee.name;
    const pattern = classApplicationType(
      declaration,
      callee.name,
      names.map((name, index): ValueType => ({ kind: "parameter", name, index })),
    );
    const constructor: Extract<ValueType, { kind: "function" }> = {
      kind: "function",
      typeParameterNames: names,
      ...(info.typeParameterBounds ? { typeParameterBounds: info.typeParameterBounds } : {}),
      parameters: info.parameters,
      ...(info.parameterNames ? { parameterNames: info.parameterNames } : {}),
      requiredParameters: info.requiredParameters,
      ...(info.constructorRest ? { rest: info.constructorRest } : {}),
      result: pattern,
    };
    const unsolved = new Set<number>();
    const reportsBefore = this.host.diagnostics.length;
    const result = this.inferGenericCall(constructor, arguments_, argumentNames, callSpan, contextualType, unsolved);
    // A construction the inference already reported on — a wrong argument
    // count, most of all — has one mistake on record, and the unsolved
    // parameter is downstream of it. One mistake, one report.
    if (this.host.diagnostics.length > reportsBefore) return result;
    // A position whose own annotation was already refused has said what it had
    // to say; the construction reads as unsolved only because of that report.
    const positionAlreadyReported = isInvalidType(this.host.expandAliases(contextualType));
    if (unsolved.size > 0 && !suppressUnsolvedReport && !positionAlreadyReported) {
      const listed = [...unsolved].map((index) => `'${names[index]}'`).join(", ");
      const example = `${callee.name}<${names.map((name, index) => unsolved.has(index) ? "string" : name).join(", ")}>`;
      this.host.diagnostics.push(diagnostic(
        "VEL4039",
        `Constructing '${callee.name}' leaves type parameter${unsolved.size === 1 ? "" : "s"} ${listed} unsolved; nothing at this position says what ${unsolved.size === 1 ? "it stands" : "they stand"} for — annotate the binding ('const value: ${example} = ${callee.name}(...)'), or pass an argument that solves ${unsolved.size === 1 ? "it" : "them"}`,
        callSpan,
      ));
    }
    return result;
  }

  inferCall(
    calleeExpression: Expression,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    contextualType: ValueType = unknownType,
    optionalCall = false,
  ): ValueType {
    const mathMethod = this.inferMathNumberMethodCall(calleeExpression, arguments_, callSpan);
    if (mathMethod) return mathMethod;
    const hasNamed = argumentNames?.some((name) => name !== null) ?? false;
    const javaScriptBoundary = this.javaScriptBoundaryCallee(calleeExpression);
    if (javaScriptBoundary) {
      this.host.lowering.javaScriptCallBoundaries.add(spanIdentity(callSpan));
      // BRG-U10: at module initialization, a synchronous non-Error throw
      // from an extern call would reach the host raw; the emitter wraps
      // these sites so the value is normalized through the owned channel.
      if (this.host.inModuleInitializationPosition()) this.host.lowering.moduleTopLevelHostCalls.add(spanIdentity(callSpan));
    }
    if (calleeExpression.kind === "SuperExpression") return this.inferSuperCall(arguments_, argumentNames, callSpan, optionalCall);
    if (optionalCall) return this.inferOptionalCall(calleeExpression, arguments_, argumentNames, callSpan, contextualType);
    const converted = this.inferStrCall(calleeExpression, arguments_, argumentNames);
    if (converted) return converted;
    if (calleeExpression.kind === "IdentifierExpression" && calleeExpression.name === "Map") {
      return this.inferMapConstruction(arguments_, argumentNames, callSpan, contextualType);
    }
    if (calleeExpression.kind === "IdentifierExpression" && calleeExpression.name === "Set") {
      return this.inferSetConstruction(arguments_, argumentNames, callSpan, contextualType);
    }

    const memberResult = this.inferMemberCall(calleeExpression, arguments_, argumentNames, callSpan);
    if (memberResult) return memberResult;

    // A direct call is a sanctioned class-name position (D45 rule 75), and a
    // member callee is a method call rather than a method-value read (D44
    // rule 74). Both facts are recorded before the callee is inferred.
    this.host.callExpressionCallees.add(spanIdentity(calleeExpression.span));
    const diagnosticsBeforeCallee = this.host.diagnostics.length;
    const inferredCallee = this.host.inferExpression(calleeExpression);
    const callee = this.host.expandAliases(inferredCallee);
    const calleeAlreadyDiagnosed = this.host.diagnostics.length > diagnosticsBeforeCallee;
    if (callee.kind === "classConstructor") {
      return this.inferConstructionCall(callee, arguments_, argumentNames, callSpan, contextualType);
    }
    return this.inferCalleeKindCall(callee, calleeExpression, arguments_, argumentNames, callSpan, contextualType, hasNamed, calleeAlreadyDiagnosed);
  }

  /**
   * D52: `Math.sign(x)` and `Math.trunc(x)` are number methods, and the
   * namespace spelling is answered with the rewrite rather than a member
   * error. The report is recovered, so the call still types as a number.
   */
  private inferMathNumberMethodCall(calleeExpression: Expression, arguments_: readonly Expression[], callSpan: Span): ValueType | null {
    if (calleeExpression.kind === "MemberExpression"
      && !calleeExpression.optional
      && calleeExpression.object.kind === "IdentifierExpression"
      && calleeExpression.object.name === "Math"
      && (calleeExpression.property === "sign" || calleeExpression.property === "trunc")
      && arguments_.length === 1
      && arguments_[0]!.kind !== "SpreadExpression") {
      const argument = arguments_[0]!;
      this.host.requireAssignable(this.host.inferExpression(argument), numberType, argument.span);
      const method = calleeExpression.property;
      const replacement = `(${this.host.sourceText.slice(argument.span.start, argument.span.end)}).${method}()`;
      this.host.diagnostics.push(recoveredDiagnostic(
        "VEL3008",
        `Use '${replacement}'; '${method}' is a number method, not a Math namespace member`,
        callSpan,
        this.host.commentPreservingMechanicalFix(callSpan, replacement, `Use number method '.${method}()'`),
      ));
      return numberType;
    }
    return null;
  }

  /** `super(...)`: only the first statement of a derived constructor, never optional. */
  private inferSuperCall(arguments_: readonly Expression[], argumentNames: readonly (string | null)[] | undefined, callSpan: Span, optionalCall: boolean): ValueType {
    if (optionalCall) this.host.typeError("A base constructor call cannot be optional", callSpan);
    const baseName = this.host.currentClass ? this.host.classInfo(this.host.currentClass)?.base ?? null : null;
    if (this.host.constructorDepth === 0 || !baseName || spanIdentity(callSpan) !== this.host.allowedSuperCall) {
      this.host.typeError("'super(...)' is only available as the first statement of a derived constructor", callSpan);
      for (const argument of arguments_) this.host.inferExpression(argument);
      return nullType;
    }
    const base = this.host.classInfo(baseName);
    this.host.checkArguments(arguments_, base?.parameters ?? [], callSpan, base?.requiredParameters, base?.constructorRest, argumentNames, base?.parameterNames);
    return nullType;
  }

  /** `f?.(...)`: the callee is executed under its own presence narrowing. */
  private inferOptionalCall(calleeExpression: Expression, arguments_: readonly Expression[], argumentNames: readonly (string | null)[] | undefined, callSpan: Span, contextualType: ValueType): ValueType {
    const original = this.host.inferExpression(calleeExpression);
    const resolvedOriginal = this.host.expandAliases(original);
    const callee = resolvedOriginal.kind === "optional" ? resolvedOriginal.inner : resolvedOriginal;
    if (isInvalidType(callee)) return invalidType;
    if (callee.kind === "function" || callee.kind === "action") {
      const result = this.host.withTemporaryNarrowings(this.host.optionalExecutionNarrowings(calleeExpression), callSpan, () => {
        if (callee.typeParameterNames?.length) {
          return this.inferGenericCall(callee, arguments_, argumentNames, callSpan, nonOptional(this.host.expandAliases(contextualType)));
        }
        this.host.checkArguments(arguments_, callee.parameters, callSpan, callee.requiredParameters, callee.rest, argumentNames, callee.parameterNames);
        return callee.result;
      });
      this.host.lowering.optionalCallees.add(spanIdentity(callSpan));
      return optionalOf(result);
    }
    if (callee.kind === "any") {
      this.host.withTemporaryNarrowings(this.host.optionalExecutionNarrowings(calleeExpression), callSpan, () => {
        for (const argument of arguments_) this.host.inferExpression(argument);
      });
      this.host.lowering.optionalCallees.add(spanIdentity(callSpan));
      return anyType;
    }
    this.host.typeError(`Optional call requires a function, received ${describeType(original)}`, callSpan);
    for (const argument of arguments_) this.host.inferExpression(argument);
    return unknownType;
  }

  /**
    * The built-in str() shares the f-string text-conversion contract: its
    * argument is checked against the conversion whitelist instead of the
    * declared 'any' parameter. A user binding named 'str' shadows the
    * builtin and keeps its own declared parameter checking.
    */
  private inferStrCall(calleeExpression: Expression, arguments_: readonly Expression[], argumentNames: readonly (string | null)[] | undefined): ValueType | null {
    if (calleeExpression.kind === "IdentifierExpression" && calleeExpression.name === "str"
      && !this.host.lookup("str") && arguments_.length === 1
      && arguments_[0]!.kind !== "SpreadExpression"
      && (argumentNames?.[0] == null || argumentNames[0] === "value")) {
      const argument = arguments_[0]!;
      this.host.requireTextConvertible(this.host.inferExpression(argument), argument.span, "str");
      return stringType;
    }
    return null;
  }

  /** `Map(source)`: the entry list, the record, and every shape `__velarCreateMap` reads. */
  private inferMapConstruction(arguments_: readonly Expression[], argumentNames: readonly (string | null)[] | undefined, callSpan: Span, contextualType: ValueType): ValueType {
    const collectionContext = this.host.contextualCollectionType(contextualType);
    const expectedMap = collectionContext?.kind === "map" ? collectionContext : null;
    const named = this.planNamedArguments(arguments_, argumentNames, [unknownType], ["source"], 0, callSpan);
    if (named && !named.valid) {
      for (const argument of arguments_) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      return expectedMap ?? { kind: "map", key: unknownType, value: unknownType };
    }
    const ordered = named?.ordered ?? arguments_;
    if (ordered.length > 1) this.host.typeError(`Expected 0-1 arguments but received ${ordered.length}`, callSpan);
    const argument = ordered[0];
    if (!argument || (argument.kind === "IdentifierExpression" && argument.name === "\u0000omitted-named-argument")) {
      return expectedMap ?? { kind: "map", key: unknownType, value: unknownType };
    }
    if (argument.kind === "ListExpression") {
      let key = unknownType;
      let value = unknownType;
      for (const entry of argument.elements) {
        if (entry.kind !== "ListExpression" || entry.elements.length !== 2 || entry.elements.some((item) => item.kind === "SpreadExpression")) {
          this.host.inferExpression(entry);
          this.host.typeError("Map entry construction requires each List item to contain exactly [key, value]", entry.span);
          continue;
        }
        const entryKey = this.host.inferExpression(entry.elements[0]!, expectedMap?.key ?? unknownType);
        const entryValue = this.host.inferExpression(entry.elements[1]!, expectedMap?.value ?? unknownType);
        if (expectedMap) {
          this.host.requireAssignable(entryKey, expectedMap.key, entry.elements[0]!.span);
          this.host.requireAssignable(entryValue, expectedMap.value, entry.elements[1]!.span);
        }
        key = mergeTypes(key, entryKey);
        value = mergeTypes(value, entryValue);
      }
      for (const extra of ordered.slice(1)) this.host.inferExpression(extra);
      if (argument.elements.length > 0) this.host.rejectCollidingKeyDomain(key, argument.span, "Map key type");
      return argument.elements.length === 0 && expectedMap ? expectedMap : { kind: "map", key, value };
    }
    // D68 rule 177: `Map(bag)` reads what `@iterate:` answers, so a class
    // that iterates as a Map converts like the Map it names.
    const source = this.host.iterationSource(argument, this.host.inferExpression(argument, expectedMap ?? unknownType));
    for (const extra of ordered.slice(1)) this.host.inferExpression(extra);
    if (source.kind === "map") return {
      kind: "map",
      key: source.readonlyView ? this.host.readonlyDataViewOf(source.key) : source.key,
      value: source.readonlyView ? this.host.readonlyDataViewOf(source.value) : source.value,
    };
    if (source.kind === "list") {
      const sourceElement = source.readonlyView ? this.host.readonlyDataViewOf(source.element) : source.element;
      if (sourceElement.kind === "list") {
        const entryElement = sourceElement.readonlyView ? this.host.readonlyDataViewOf(sourceElement.element) : sourceElement.element;
        this.host.rejectCollidingKeyDomain(entryElement, argument.span, "Map key type");
        return { kind: "map", key: entryElement, value: entryElement };
      }
    }
    if (source.kind === "object") {
      let value = unknownType;
      for (const field of source.fields.values()) value = mergeTypes(value, source.readonlyView ? this.host.readonlyDataViewOf(field) : field);
      if (expectedMap) {
        this.host.requireAssignable(stringType, expectedMap.key, argument.span);
        for (const field of source.fields.values()) {
          this.host.requireAssignable(source.readonlyView ? this.host.readonlyDataViewOf(field) : field, expectedMap.value, argument.span);
        }
      }
      return source.fields.size === 0 && expectedMap ? expectedMap : { kind: "map", key: stringType, value };
    }
    // The same hole one shape further out: a `type` declaration is the most
    // ordinary record the language has, and it arrives as `named`, so
    // `Map(pair)` was refused with a message that listed "a record" among the
    // forms it takes. `fieldsOf` is what tells a record-shaped name from an
    // extension host scalar or an erased generic, exactly as `Promise.all`
    // asks it. The runtime has read ordinary records all along.
    if (source.kind === "named") {
      const fields = this.host.fieldsOf(source.identity ?? source.name);
      if (fields) {
        let value = unknownType;
        const fieldType = (field: ValueType): ValueType => source.readonlyView ? this.host.readonlyDataViewOf(field) : field;
        for (const field of fields.values()) value = mergeTypes(value, fieldType(field));
        if (expectedMap) {
          this.host.requireAssignable(stringType, expectedMap.key, argument.span);
          for (const field of fields.values()) this.host.requireAssignable(fieldType(field), expectedMap.value, argument.span);
        }
        return fields.size === 0 && expectedMap ? expectedMap : { kind: "map", key: stringType, value };
      }
    }
    // A `Record<V>` is the dynamic-key record, and `__velarCreateMap` has
    // always read it. Only the structural `object` shape was accepted here,
    // so the diagnostic below listed "a record" among the forms it takes and
    // then refused one. Keys of a record are strings by construction.
    if (source.kind === "record") {
      const value = source.readonlyView ? this.host.readonlyDataViewOf(source.value) : source.value;
      if (expectedMap) {
        this.host.requireAssignable(stringType, expectedMap.key, argument.span);
        this.host.requireAssignable(value, expectedMap.value, argument.span);
      }
      return { kind: "map", key: stringType, value };
    }
    if (source.kind === "any") return { kind: "map", key: anyType, value: anyType };
    this.host.typeError(`Map construction requires a Map, a List of [key, value] Lists, or a record, received ${describeType(source)}${this.host.iterationGuidance(source)}`, argument.span);
    return { kind: "map", key: unknownType, value: unknownType };
  }

  /** `Set(source)`: the List or Set it copies, read through the same iteration contract. */
  private inferSetConstruction(arguments_: readonly Expression[], argumentNames: readonly (string | null)[] | undefined, callSpan: Span, contextualType: ValueType): ValueType {
    const collectionContext = this.host.contextualCollectionType(contextualType);
    const named = this.planNamedArguments(arguments_, argumentNames, [unknownType], ["source"], 0, callSpan);
    if (named && !named.valid) {
      for (const argument of arguments_) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      return collectionContext?.kind === "set" ? collectionContext : { kind: "set", element: unknownType };
    }
    const ordered = named?.ordered ?? arguments_;
    if (ordered.length > 1) this.host.typeError(`Expected 0-1 arguments but received ${ordered.length}`, callSpan);
    const argument = ordered[0];
    if (!argument || (argument.kind === "IdentifierExpression" && argument.name === "\u0000omitted-named-argument")) {
      return collectionContext?.kind === "set" ? collectionContext : { kind: "set", element: unknownType };
    }
    // D68 rule 177: `Set(bag)` reads the same contract every other consumer
    // reads, so the eight sites never disagree about what a class iterates as.
    const source = this.host.iterationSource(
      argument,
      this.host.inferExpression(argument, collectionContext?.kind === "set" ? { kind: "list", element: collectionContext.element } : unknownType),
    );
    for (const extra of ordered.slice(1)) this.host.inferExpression(extra);
    if (source.kind === "list" || source.kind === "set") {
      const element = source.readonlyView ? this.host.readonlyDataViewOf(source.element) : source.element;
      this.host.rejectCollidingKeyDomain(element, argument.span, "Set element type");
      return { kind: "set", element };
    }
    if (source.kind === "any") return { kind: "set", element: anyType };
    this.host.typeError(`Set construction requires a List or Set, received ${describeType(source)}${this.host.iterationGuidance(source)}`, argument.span);
    return { kind: "set", element: unknownType };
  }

  /**
   * A member callee that one of the compiler-owned member families answers:
   * a record projection, a primitive method, or a collection operation. They
   * are tried in the order the one method tried them.
   */
  private inferMemberCall(calleeExpression: Expression, arguments_: readonly Expression[], argumentNames: readonly (string | null)[] | undefined, callSpan: Span): ValueType | null {
    if (calleeExpression.kind === "MemberExpression" && calleeExpression.object.kind !== "SuperExpression") {
      // The collection/primitive call paths infer the receiver before
      // inferMember can sanction it, so a class-name receiver (`P.make(...)`)
      // is sanctioned here first (D45 rule 75).
      this.host.memberAccessReceivers.add(spanIdentity(calleeExpression.object.span));
      this.host.recordMemberAccessProperty(calleeExpression);
      const recordFromResult = this.host.inferRecordFromCall(calleeExpression, arguments_, argumentNames, callSpan);
      if (recordFromResult) return recordFromResult;
      const recordMapFromResult = this.host.inferRecordMapFromCall(calleeExpression, arguments_, argumentNames, callSpan);
      if (recordMapFromResult) return recordMapFromResult;
      const primitiveResult = this.host.inferPrimitiveCall(calleeExpression, arguments_, argumentNames, callSpan);
      if (primitiveResult) return primitiveResult;
      const collectionResult = this.host.collections.inferCollectionCall(calleeExpression, arguments_, argumentNames, callSpan);
      if (collectionResult) {
        this.host.invalidateMutableCollectionCallReceiver(calleeExpression);
        return collectionResult;
      }
    }

    return null;
  }

  /** Constructing a class: abstract, extern-constructor and generic construction rules. */
  private inferConstructionCall(callee: Extract<ValueType, { kind: "classConstructor" }>, arguments_: readonly Expression[], argumentNames: readonly (string | null)[] | undefined, callSpan: Span, contextualType: ValueType): ValueType {
    this.host.lowering.constructorCalls.add(spanIdentity(callSpan));
    const info = this.host.classInfo(callee.identity ?? callee.name) ?? this.host.classInfo(callee.name);
    if (info?.abstract) this.host.typeError(`Cannot instantiate abstract class '${callee.name}'`, callSpan);
    // A field initializer runs on every construction, so constructing the
    // declaring class (or one of its subclasses, whose construction runs
    // these same initializers) can never finish — it overflows the stack at
    // the first construction. Arrows inside the initializer stay legal:
    // they defer the construction (classFieldInitializerDepth is zeroed).
    if (this.host.classFieldInitializerDepth > 0 && this.host.instanceFieldInitializerDepth > 0 && this.host.currentClass
      && (callee.name === this.host.currentClass || this.host.isSubclassOf(callee.name, this.host.currentClass))) {
      this.host.typeError(
        `Field initializer constructs '${callee.name}' on every '${this.host.currentClass}' construction and can never finish; assign it in the constructor from a parameter, or create it lazily`,
        callSpan,
      );
    }
    // BRG-U6: extern constructors are not inherited (a derived extern
    // class without its own `constructor(...)` takes zero arguments —
    // opposite of JavaScript), so calling one with arguments teaches the
    // redeclaration instead of a bare arity mismatch.
    if (info && callee.identity?.startsWith("js:") === true && info.base !== null
      && info.parameters.length === 0 && info.requiredParameters === 0 && !info.constructorRest
      && arguments_.length > 0 && !argumentNames?.some((name) => name !== null)) {
      for (const argument of arguments_) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.host.typeError(
        `Extern class '${callee.name}' declares no constructor, and extern constructors are not inherited from the base class; redeclare 'constructor(...)' on '${callee.name}' with the base signature`,
        callSpan,
      );
      return {
        kind: "class",
        name: callee.name,
        ...(callee.identity ? { identity: callee.identity } : {}),
      };
    }
    // D55 rule 120 layer two: constructing a generic class is a generic call
    // whose result pattern is the class at its own parameters. The
    // constructor's arguments solve what they can (phases 1 and 2) and the
    // position solves the rest (phase 3, D114 item ①) — the same three phases
    // a generic `def` goes through, because it is the same question.
    if (info?.typeParameterNames?.length) {
      return this.inferGenericConstruction(
        callee,
        info,
        arguments_,
        argumentNames,
        callSpan,
        contextualType,
        // `Stack<number>()` already told the author where the arguments go
        // (VEL2031, D55 rule 123); naming the missing solution here would
        // report one mistake twice and contradict the fix already offered.
        this.host.typeArgumentsRemovedCalls.has(spanIdentity(callSpan)),
      );
    }
    this.host.checkArguments(arguments_, info?.parameters ?? [], callSpan, info?.requiredParameters, info?.constructorRest, argumentNames, info?.parameterNames);
    return {
      kind: "class",
      name: callee.name,
      ...(callee.identity ? { identity: callee.identity } : {}),
    };
  }

  /** Every remaining callee kind, in the order the one method tested them. */
  private inferCalleeKindCall(callee: ValueType, calleeExpression: Expression, arguments_: readonly Expression[], argumentNames: readonly (string | null)[] | undefined, callSpan: Span, contextualType: ValueType, hasNamed: boolean, calleeAlreadyDiagnosed: boolean): ValueType {
    if (callee.kind === "intrinsic") {
      const result = this.inferIntrinsicCall(callee, arguments_, argumentNames, callSpan);
      return result;
    }
    if (callee.kind === "extension") {
      const extensionResult = this.host.inferExtensionCall(callee, arguments_, argumentNames, callSpan);
      if (extensionResult) return extensionResult;
    }
    if (callee.kind === "function" || callee.kind === "action") {
      if (callee.typeParameterNames?.length) {
        const result = this.inferGenericCall(callee, arguments_, argumentNames, callSpan, contextualType);
        this.host.reportPromiseCarrierHazard(result, callSpan);
        if (result.kind === "optional") this.host.lowering.optionalCalls.add(spanIdentity(callSpan));
        return result;
      }
      if (calleeExpression.kind === "MemberExpression" && calleeExpression.property === "parse"
        && arguments_[0]?.kind === "ObjectExpression" && callee.result.kind === "named") {
        this.host.recordRuntimeObjectShape(arguments_[0], callee.result);
      }
      const diagnosticsBeforeArguments = this.host.diagnostics.length;
      this.host.checkArguments(arguments_, callee.parameters, callSpan, callee.requiredParameters, callee.rest, argumentNames, callee.parameterNames);
      this.host.rejectDisjointEnumValidatorProbe(calleeExpression, arguments_);
      // One mistake, one diagnostic: the matcher gate speaks only when the
      // argument itself checked out, because an unassignable comparand has
      // already been named in the words the author needs.
      if (this.host.diagnostics.length === diagnosticsBeforeArguments) {
        this.host.checkTestMatcherComparand(calleeExpression, arguments_);
      }
      this.host.reportPromiseCarrierHazard(callee.result, callSpan);
      if (callee.result.kind === "optional") this.host.lowering.optionalCalls.add(spanIdentity(callSpan));
      return callee.result;
    }
    if (callee.kind === "optional" && (callee.inner.kind === "function" || callee.inner.kind === "action")) {
      const inner = callee.inner;
      const result = this.host.withTemporaryNarrowings(this.host.optionalExecutionNarrowings(calleeExpression), callSpan, () => {
        if (inner.typeParameterNames?.length) {
          return this.inferGenericCall(inner, arguments_, argumentNames, callSpan, nonOptional(this.host.expandAliases(contextualType)));
        }
        this.host.checkArguments(arguments_, inner.parameters, callSpan, inner.requiredParameters, inner.rest, argumentNames, inner.parameterNames);
        return inner.result;
      });
      this.host.reportPromiseCarrierHazard(result, callSpan);
      if (!continuesOptionalChain(calleeExpression)) {
        this.host.typeError("Use a presence check or an optional access chain before calling an optional function", calleeExpression.span);
      }
      this.host.lowering.optionalCalls.add(spanIdentity(callSpan));
      this.host.lowering.optionalCallees.add(spanIdentity(callSpan));
      return optionalOf(result);
    }
    if (callee.kind === "any") {
      if (hasNamed) this.host.typeError("Named arguments require a statically known callable signature", callSpan);
      for (const argument of arguments_) {
        this.host.inferExpression(argument);
      }
      return anyType;
    }
    if (callee.kind === "unknown") {
      if (isInvalidType(callee)) return invalidType;
      if (!calleeAlreadyDiagnosed) {
        if (hasNamed) this.host.typeError("Named arguments require a statically known callable signature", callSpan);
        for (const argument of arguments_) {
          this.host.inferExpression(argument);
        }
        // D90 R17: a call needs a declared signature — `Type.parse` validates
        // data, so the way in for a callable is the extern contract.
        const receiver = calleeExpression ? this.host.boundaryReceiverText(calleeExpression) : null;
        this.host.typeError(
          `Cannot call an unknown JavaScript value without a declaration or validation; declare the signature — an 'extern module' contract or a contracted 'extern js' block gives ${receiver ? `'${receiver}'` : "the value"} a checked type — or validate the data it came from with 'Type.parse' first`,
          callSpan,
        );
      }
      return unknownType;
    }
    if (callee.kind === "typeObject") {
      for (const argument of arguments_) {
        this.host.inferExpression(argument);
      }
      this.host.typeError(
        `Use a record literal '{field: value, ...}' to build a '${callee.name}' value; a 'type' declares a shape, not a constructor`,
        callSpan,
      );
      return this.host.invalidDeclaredTypes.has(callee.name)
        ? invalidType
        : this.host.typeAliases.get(callee.name) ?? { kind: "named", name: callee.name };
    }
    for (const argument of arguments_) {
      this.host.inferExpression(argument);
    }
    this.host.typeError(`${describeType(callee)} is not callable`, callSpan);
    return unknownType;
  }

  private javaScriptBoundaryCallee(expression: Expression): boolean {
    if (expression.kind === "IdentifierExpression") {
      if (this.host.javaScriptBindings.has(expression.name)) return true;
      const type = this.host.lookup(expression.name)?.type;
      return (type?.kind === "class" || type?.kind === "classConstructor") && type.identity?.startsWith("js:") === true;
    }
    if (expression.kind !== "MemberExpression") return false;
    if (this.javaScriptBoundaryCallee(expression.object)) return true;
    const type = expression.object.kind === "IdentifierExpression" ? this.host.lookup(expression.object.name)?.type : null;
    return (type?.kind === "class" || type?.kind === "classConstructor") && type.identity?.startsWith("js:") === true;
  }

  // Three-phase call-site unification for generic callables: phase 1 infers
  // non-arrow arguments and collects bindings; phase 2 gives arrows contextual
  // types with the phase-1 substitution applied, then unifies their results;
  // phase 3 (D114 item ①) matches the declared result against the type the
  // position expects and seeds whatever the arguments left open. Type
  // parameters no phase solved substitute unknown.
  private inferGenericCall(
    callee: Extract<ValueType, { kind: "function" | "action" }>,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    contextualType: ValueType = unknownType,
    unsolved?: Set<number>,
  ): ValueType {
    const parameterCount = callee.typeParameterNames?.length ?? 0;
    const bindings: (ValueType | null)[] = Array.from({ length: parameterCount }, () => null);
    // D55 rule 120 layer two: a method of a generic class carries the class's
    // parameters above its own, at indexes the published list does not reach.
    // Those are fixed by the receiver, never solved by the call, so they are
    // bound to themselves before unification and restored after it — otherwise
    // `self.mapTo(f)` would let an argument redefine the class's own `T`.
    const rigid = new Map<number, ValueType>();
    const noteRigid = (type: ValueType): void => {
      typeContainsParameter(type, (parameter) => {
        if (parameter.index >= parameterCount) rigid.set(parameter.index, parameter);
        return false;
      });
    };
    for (const parameter of callee.parameters) noteRigid(parameter);
    if (callee.rest) noteRigid(callee.rest);
    noteRigid(callee.result);
    for (const [index, type] of rigid) bindings[index] = type;
    // NEW-D3: parameters an `unknown` argument reached are solved-to-unknown,
    // which no bound admits; they are tracked apart from `bindings` so that
    // `unknown` still never poisons a merge with a concrete argument.
    const unknownParameters = new Set<number>();
    const fieldsOf = (identity: string): ReadonlyMap<string, ValueType> | null => this.host.fieldsOf(identity);
    // A solved type argument is canonicalized the same way an annotation's is;
    // see the `parameter` branch of `unifyInto` for why the `Type<T>` path is
    // the one that would otherwise carry an unexpanded alias into `Channel<T>`.
    const expandAliases = (type: ValueType): ValueType => this.host.expandAliases(type);
    // D55 rule 121: substituting into `Box<T>` produces an instantiation this
    // module may never have written down, and it still has to have a field
    // table — otherwise `def unwrap<T>(box: Box<T>)` would solve T correctly
    // and then fail to accept the very record that solved it.
    const substitute = (declared: ValueType): ValueType => {
      const substituted = substituteTypeParameters(declared, bindings);
      this.host.noteGenericApplications(substituted);
      return substituted;
    };
    const solvedContext = (declared: ValueType): ValueType =>
      typeContainsParameter(declared, (parameter) => bindings[parameter.index] == null) ? unknownType : substitute(declared);

    const solver: GenericCallSolver = { bindings, unknownParameters, fieldsOf, expandAliases, substitute, solvedContext };
    const planned = this.planGenericArguments(callee, arguments_, argumentNames, callSpan, solver);
    if ("answer" in planned) return planned.answer;
    const actuals = this.unifyPlannedArguments(planned, solver);
    for (const [index, type] of rigid) bindings[index] = type;
    const seeded = this.seedTypeParametersFromPosition(callee.result, bindings, unknownParameters, contextualType, fieldsOf, expandAliases);
    for (let index = 0; index < parameterCount; index += 1) {
      if (bindings[index] == null && !unknownParameters.has(index)) unsolved?.add(index);
    }
    this.reportGenericBoundViolations(callee, bindings, planned, callSpan, unknownParameters, seeded);
    for (const item of planned) {
      const actual = actuals.get(item) ?? unknownType;
      if (!item.declared) continue;
      if (item.spreadList) {
        const expanded = this.host.expandAliases(actual);
        if (expanded.kind === "list") this.host.requireAssignable(expanded.element, substitute(item.declared), item.errorSpan);
        else if (expanded.kind !== "any") this.host.typeError(`Call spread requires a List, received ${describeType(actual)}${this.host.iterationGuidance(actual)}`, item.errorSpan);
        continue;
      }
      this.host.requireAssignable(actual, substitute(item.declared), item.errorSpan);
    }
    return substitute(callee.result);
  }

  /**
   * The arguments of a generic call, paired with the parameter each one was
   * planned onto. A named plan that did not resolve answers the whole call,
   * because there is no position left to solve a type parameter from.
   */
  private planGenericArguments(
    callee: Extract<ValueType, { kind: "function" | "action" }>,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    solver: GenericCallSolver,
  ): PlannedArgument[] | { readonly answer: ValueType } {
    const planned: PlannedArgument[] = [];
    const plan = this.planNamedArguments(arguments_, argumentNames, callee.parameters, callee.parameterNames, callee.requiredParameters, callSpan, callee.rest);
    if (plan) {
      for (const [source, target] of plan.targets.entries()) {
        const argument = arguments_[source]!;
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        planned.push({ value, declared: target === null ? null : callee.parameters[target] ?? callee.rest ?? null, errorSpan: argument.span, spreadList: false });
      }
      if (!plan.valid) {
        for (const item of planned) this.host.inferExpression(item.value, item.declared ? solver.solvedContext(item.declared) : unknownType);
        return { answer: solver.substitute(callee.result) };
      }
    } else {
      const hasSpread = arguments_.some((argument) => argument.kind === "SpreadExpression");
      if (!hasSpread && (arguments_.length < callee.requiredParameters || (!callee.rest && arguments_.length > callee.parameters.length))) {
        const expected = callee.rest
          ? `at least ${callee.requiredParameters}`
          : callee.requiredParameters === callee.parameters.length ? String(callee.parameters.length) : `${callee.requiredParameters}-${callee.parameters.length}`;
        this.host.typeError(`Expected ${expected} ${argumentNoun(expected)} but received ${arguments_.length}`, callSpan);
      }
      let fixedIndex = 0;
      let sawSpread = false;
      for (const argument of arguments_) {
        if (argument.kind === "SpreadExpression") {
          sawSpread = true;
          if (!callee.rest) this.host.typeError("Call spread requires a callable with a rest parameter", argument.span);
          else if (fixedIndex < callee.parameters.length) {
            this.host.typeError(`Provide all ${callee.parameters.length} fixed argument${callee.parameters.length === 1 ? "" : "s"} before a call spread`, argument.span);
          }
          planned.push({ value: argument.value, declared: callee.rest ?? null, errorSpan: argument.span, spreadList: true });
          fixedIndex = callee.parameters.length;
          continue;
        }
        const declared = sawSpread ? callee.rest ?? null : callee.parameters[fixedIndex] ?? callee.rest ?? null;
        planned.push({ value: argument, declared, errorSpan: argument.span, spreadList: false });
        if (!sawSpread && fixedIndex < callee.parameters.length) fixedIndex += 1;
      }
    }
    return planned;
  }

  /**
   * Phases 1 and 2: every non-arrow argument is inferred and unified into the
   * bindings, then each arrow is inferred against the substitution the first
   * phase produced and unified in turn.
   */
  private unifyPlannedArguments(planned: readonly PlannedArgument[], solver: GenericCallSolver): Map<PlannedArgument, ValueType> {
    const actuals = new Map<PlannedArgument, ValueType>();
    const deferredArrows: PlannedArgument[] = [];
    for (const item of planned) {
      if (item.value.kind === "ArrowFunctionExpression") {
        deferredArrows.push(item);
        continue;
      }
      const context = item.declared
        ? solver.solvedContext(item.spreadList ? { kind: "list", element: item.declared } : item.declared)
        : unknownType;
      // D68 rule 177: a call spread consumes an iterable, so it reads the
      // `@iterate:` answer — `f(...bag)` is `f(...bag.items)`, refusal included.
      const actual = item.spreadList
        ? this.host.iterationSource(item.value, this.host.inferExpression(item.value, context))
        : this.host.inferExpression(item.value, context);
      actuals.set(item, actual);
      if (!item.declared) continue;
      if (item.spreadList) {
        const expanded = this.host.expandAliases(actual);
        if (expanded.kind === "list") unifyTypeParameters(item.declared, expanded.element, solver.bindings, solver.fieldsOf, solver.unknownParameters, solver.expandAliases);
      } else {
        unifyTypeParameters(item.declared, actual, solver.bindings, solver.fieldsOf, solver.unknownParameters, solver.expandAliases);
      }
    }
    for (const item of deferredArrows) {
      const context = item.declared ? solver.substitute(item.declared) : unknownType;
      const actual = this.host.inferExpression(item.value, context);
      actuals.set(item, actual);
      if (item.declared) unifyTypeParameters(item.declared, actual, solver.bindings, solver.fieldsOf, solver.unknownParameters, solver.expandAliases);
    }
    return actuals;
  }

  /**
   * D114 item ①, the ruling D77 rule 194 left open: a type parameter the
   * arguments leave open is solved from the position the call is written in.
   * The position is the one `contextualType` already carries — the same
   * channel section 8 reads to settle an empty `[]`, `Set()`, or `Map()` — so
   * "what is a contextual type" has one definition and cannot drift into
   * `const names: List<string> = []` passing while `= empty()` does not.
   *
   * Two disciplines make this seeding and never a guess:
   *
   * - It never overrides. Candidates are unified into a separate table and
   *   copied back only where the arguments solved nothing, so a disagreement
   *   between an argument and the annotation stays the ordinary mismatch the
   *   position already reported (D114 item ①), not a new diagnostic. A
   *   parameter only an `unknown` argument reached counts as reached: its
   *   bound violation is the argument's, and seeding over it would move that
   *   report to the position and change its words.
   * - It matches structurally, through `unifyTypeParameters` — the same walk
   *   an argument takes, so the shapes a type argument can be read out of are
   *   one list rather than two: a container's element, a Map's key and value,
   *   a Record's or a Promise's value, an optional's inner type, a callable's
   *   parameters and result, one generic record application's arguments
   *   against the same declaration, and so on down. A shape that walk does not
   *   pair leaves the parameter open, and phase 4 substitutes `unknown` as
   *   before.
   *
   * The `readonly` qualifier belongs to the position rather than to the type
   * argument: `readonly List<string>` seeds `T = string`, and a bare `T` in
   * result position takes the mutable spelling of the expected type, which is
   * the only one a type argument can be written with. An optional annotation
   * is read through for the same reason section 8 reads it through
   * (`contextualCollectionType` recurses on `optional`, so `const tags:
   * Set<string>? = Set()` keeps its element contract): a result that is itself
   * optional pairs with it directly, and any other result shape matches the
   * type the annotation holds.
   */
  private seedTypeParametersFromPosition(
    result: ValueType,
    bindings: (ValueType | null)[],
    unknownParameters: ReadonlySet<number>,
    contextualType: ValueType,
    fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
    expandAliases: (type: ValueType) => ValueType,
  ): ReadonlySet<number> {
    const seeded = new Set<number>();
    const open = (parameter: Extract<ValueType, { kind: "parameter" }>): boolean =>
      bindings[parameter.index] == null && !unknownParameters.has(parameter.index);
    if (!typeContainsParameter(result, open)) return seeded;
    const expected = expandAliases(mutableViewOf(contextualType));
    // `unknown` and `any` are the two positions that say nothing about the
    // value they receive, which is why section 8 refuses to settle an empty
    // collection at either; a type argument reads them the same way.
    if (expected.kind === "unknown" || expected.kind === "any" || isInvalidType(expected)) return seeded;
    const match = (against: ValueType, pattern: ValueType = result): (ValueType | null)[] => {
      const table: (ValueType | null)[] = bindings.map(() => null);
      unifyTypeParameters(pattern, against, table, fieldsOf, undefined, expandAliases);
      return table;
    };
    let candidates = match(expected);
    if (expected.kind === "optional" && candidates.every((candidate) => candidate === null)) {
      candidates = match(expandAliases(expected.inner));
    }
    // D55 rule 120 layer two: the position may name a *base* of what the call
    // produces — `const numbers: Stack<number> = Boxes()`. The pattern matched
    // against it is then this result's own ancestor that applies the
    // declaration the position named, with the call's parameters still in it.
    if (candidates.every((candidate) => candidate === null)) {
      const ancestor = this.classPatternForPosition(result, expected.kind === "optional" ? expandAliases(expected.inner) : expected);
      if (ancestor) candidates = match(expected.kind === "optional" ? expandAliases(expected.inner) : expected, ancestor);
    }
    for (const [index, candidate] of candidates.entries()) {
      if (!candidate || bindings[index] != null || unknownParameters.has(index)) continue;
      if (candidate.kind === "unknown" || isInvalidType(candidate)) continue;
      bindings[index] = candidate;
      seeded.add(index);
    }
    return seeded;
  }

  /**
   * The ancestor of a class result that applies the declaration a position
   * named, with this call's own type parameters carried through the chain. A
   * class is invariant in its arguments (D77 rule 194 item 1), so this walks
   * the *declaration* chain only — it never widens an argument.
   */
  private classPatternForPosition(result: ValueType, expected: ValueType): ValueType | null {
    if (result.kind !== "class" || !result.application) return null;
    if (expected.kind !== "class") return null;
    const target = expected.application?.declaration ?? expected.identity ?? expected.name;
    let application: GenericApplication = result.application;
    const seen = new Set<string>();
    while (!seen.has(application.declaration)) {
      if (application.declaration === target || application.name === target) {
        return classApplicationType(application.declaration, application.name, application.arguments);
      }
      seen.add(application.declaration);
      const template = this.host.classes.get(application.declaration) ?? this.host.classes.get(application.name);
      const base = template?.baseApplication;
      if (!base) return null;
      const names = template?.typeParameterNames ?? [];
      const table = names.map((_, index) => application.arguments[index] ?? unknownType);
      application = { ...base, arguments: base.arguments.map((argument) => substituteTypeParameters(argument, table)) };
    }
    return null;
  }

  /**
   * D41 item 61 check site 1: once the two-phase inference has solved the
   * bindings, every bound is verified before the ordinary assignability loop
   * runs, so a rejected type argument is reported once, at its cause.
   */
  private reportGenericBoundViolations(
    callee: Extract<ValueType, { kind: "function" | "action" | "intrinsic" }>,
    bindings: readonly (ValueType | null)[],
    planned: readonly { readonly declared: ValueType | null; readonly errorSpan: Span }[],
    callSpan: Span,
    unknownParameters?: ReadonlySet<number>,
    seeded?: ReadonlySet<number>,
  ): void {
    const violations = collectGenericBoundViolations(callee, bindings, (type, bound) => this.host.satisfiesBound(type, bound), unknownParameters);
    for (const violation of violations) {
      // "Report at the cause" (D31 item 27). The one shape it cannot serve is
      // a parameter several arguments merged into: there is no single cause,
      // so the call itself reports and names the type that was solved.
      // A seeded parameter (D114 item ①) has no argument cause at all — the
      // position solved it — so it reports at the call and names the solver
      // it actually had. Same sentence, true subject.
      const causes = seeded?.has(violation.index)
        ? []
        : planned.filter((item) => item.declared !== null
          && typeContainsParameter(item.declared, (parameter) => parameter.index === violation.index));
      const solver = seeded?.has(violation.index) ? "the expected type solves" : "the arguments solve";
      const guidance = boundVocabularyGuidance[violation.bound];
      this.host.diagnostics.push(causes.length === 1
        ? diagnostic(
          "VEL4031",
          `Type parameter '${violation.name}' is bound by ${violation.bound}, so this argument cannot be ${describeType(violation.solved)}; ${guidance}`,
          causes[0]!.errorSpan,
        )
        : diagnostic(
          "VEL4031",
          `Type parameter '${violation.name}' is bound by ${violation.bound} but ${solver} it to ${describeType(violation.solved)}; ${guidance}`,
          callSpan,
        ));
    }
  }

  inferIntrinsicCall(
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType {
    if (intrinsic.name === "collections.range") {
      return this.inferRangeCall(intrinsic, sourceArguments, argumentNames, callSpan);
    }
    if (intrinsic.name === "core.equals") {
      return this.inferEqualsCall(intrinsic, sourceArguments, argumentNames, callSpan);
    }
    const resolved = this.resolveIntrinsicArguments(intrinsic, sourceArguments, argumentNames, callSpan);
    if ("answer" in resolved) return resolved.answer;
    const call = new IntrinsicCall(this.host, intrinsic, callSpan, resolved);
    const extended = this.inferExtensionIntrinsic(call, intrinsic, callSpan);
    if (extended) return extended;
    return this.inferJsonIntrinsic(call, intrinsic, callSpan)
      ?? this.inferAsyncIntrinsic(call, intrinsic, callSpan)
      ?? this.inferOtherIntrinsic(call, intrinsic, callSpan);
  }

  /**
   * The arguments the per-intrinsic rules see. A named call is planned against
   * the intrinsic's published parameter names and inferred here, before any
   * rule runs; arrow arguments are held back so the rule that knows their
   * contract infers them. A plan that did not resolve answers the whole call.
   */
  private resolveIntrinsicArguments(
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ResolvedIntrinsicArguments | { readonly answer: ValueType } {
    let arguments_ = sourceArguments;
    let namedPreanalyzed = false;
    const deferredNamedArrows = new Set<Expression>();
    const named = this.planNamedArguments(
      sourceArguments,
      argumentNames,
      intrinsic.parameters,
      intrinsic.parameterNames,
      intrinsic.requiredParameters,
      callSpan,
      intrinsic.rest,
    );
    if (named) {
      for (const [source, target] of named.targets.entries()) {
        const argument = sourceArguments[source]!;
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        if (value.kind === "ArrowFunctionExpression") deferredNamedArrows.add(value);
        else {
          const declared = target === null ? unknownType : intrinsic.parameters[target] ?? intrinsic.rest ?? unknownType;
          // D90 R17: an accept-anything parameter is spelled `List<unknown>`
          // in the vocabulary tables, and that spelling carries no element
          // information — preanalyzing a literal against it would launder
          // `[1, 2]` into a list the handler can read no numbers from, so the
          // literal keeps its own inferred element and the handler's own
          // expected type does the checking.
          const context = declared.kind === "list" && declared.element.kind === "unknown" ? unknownType : declared;
          this.host.inferExpression(value, context);
        }
      }
      if (!named.valid) {
        for (const argument of deferredNamedArrows) this.host.inferExpression(argument);
        return { answer: intrinsic.result };
      }
      arguments_ = named.ordered;
      namedPreanalyzed = true;
    }
    return { arguments_, namedPreanalyzed, deferredNamedArrows };
  }

  /** A target extension may own an intrinsic of its own vocabulary; it is asked first. */
  private inferExtensionIntrinsic(
    call: IntrinsicCall,
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    callSpan: Span,
  ): ValueType | null {
    for (const extension of this.host.analysisExtensions) {
      const result = extension.inferIntrinsic?.({
        intrinsic,
        argumentAt: (index) => call.argumentAt(index),
        callSpan,
        arity: (minimum, maximum) => { call.arity(minimum, maximum); },
        inferAt: (index, expected) => call.inferAt(index, expected),
        callbackAt: (index, parameters, result) => call.callbackAt(index, parameters, result),
        runtimeTypeAt: (index) => call.runtimeTypeAt(index),
        typeError: (message, errorSpan) => this.host.typeError(message, errorSpan),
        isAssignable: (actual, expected) => this.host.isAssignableHere(actual, expected),
        expandAliases: (type) => this.host.expandAliases(type),
        jsonSerializable: (type) => this.host.jsonSerializable(type),
        isHttpFormBody: (type) => this.host.isHttpFormBody(type),
        declaredFieldsOf: (name) => this.host.namedTypes.get(name) ?? null,
        formReadField: (name, type, fieldSpan) => this.host.formReadField(name, type, fieldSpan),
        recordFormRead: (sourceSpan, fields) => this.host.lowering.formReads.set(spanIdentity(sourceSpan), fields),
      });
      if (result) return result;
    }
    return null;
  }

  /** The `velar/json` intrinsics and the runtime-Type parse they share. */
  private inferJsonIntrinsic(call: IntrinsicCall, intrinsic: Extract<ValueType, { kind: "intrinsic" }>, callSpan: Span): ValueType | null {
    switch (intrinsic.name) {
      case "json.parse": {
        call.arity(1, 2);
        call.inferAt(0, stringType);
        return call.argumentAt(1) ? call.runtimeTypeAt(1) : unknownType;
      }
      case "json.tryParse": {
        call.arity(1, 3);
        call.inferAt(0, stringType);
        const parsed = call.argumentAt(1) ? call.runtimeTypeAt(1) : unknownType;
        if (call.argumentAt(2)) {
          call.inferAt(2, parsed);
          return parsed;
        }
        return optionalOf(parsed);
      }
      case "json.stringify":
      case "json.stableStringify": {
        call.arity(1, 2);
        const value = call.inferAt(0);
        const serializable = this.host.jsonSerializable(value);
        const argument = call.argumentAt(0);
        if (serializable === false && argument) {
          this.host.typeError(`JSON accepts only records, Lists, enums, primitives, and optionals; received ${describeType(value)}`, argument.span);
        }
        call.inferAt(1, { kind: "union", members: [boolType, numberType] });
        return stringType;
      }
      case "json.clone": {
        call.arity(1, 2);
        const original = call.inferAt(0);
        const argument = call.argumentAt(0);
        if (this.host.jsonSerializable(original) === false && argument) {
          this.host.typeError(`JSON accepts only records, Lists, enums, primitives, and optionals; received ${describeType(original)}`, argument.span);
        }
        return call.argumentAt(1) ? call.runtimeTypeAt(1) : original;
      }
      case "runtime.parseAsync": {
        call.arity();
        const parsed = call.runtimeTypeAt(0);
        for (let index = 1; index < intrinsic.parameters.length; index += 1) {
          call.inferAt(index, intrinsic.parameters[index]);
        }
        this.host.reportPromiseResolutionHazard(parsed, call.argumentAt(0)?.span ?? callSpan);
        return { kind: "promise", value: parsed };
      }
      default:
        return null;
    }
  }

  /** The `velar/async` intrinsics: the combinators over Promises. */
  private inferAsyncIntrinsic(call: IntrinsicCall, intrinsic: Extract<ValueType, { kind: "intrinsic" }>, callSpan: Span): ValueType | null {
    switch (intrinsic.name) {
      case "async.all":
      case "async.race": {
        call.arity(1, 1);
        const argument = call.argumentAt(0);
        const input = call.inferAt(0);
        const unwrap = (source: ValueType): ValueType | null => {
          const expanded = this.host.expandAliases(source);
          if (expanded.kind === "promise") return expanded.value;
          if (expanded.kind === "any") return anyType;
          if (expanded.kind === "union") {
            const members = expanded.members.map(unwrap);
            return members.every((member): member is ValueType => member !== null) ? unionOf(members) : null;
          }
          return null;
        };
        if (intrinsic.name === "async.all" && (input.kind === "object" || input.kind === "record"
          || input.kind === "named" && this.host.fieldsOf(input.identity ?? input.name) !== null)) {
          if (input.kind === "record") {
            const resolved = unwrap(input.value);
            if (!resolved) this.host.typeError(`Promise.all requires every record field to be a Promise, received ${describeType(input)}`, argument?.span ?? callSpan);
            return { kind: "promise", value: { kind: "record", value: resolved ?? unknownType } };
          }
          const fields = input.kind === "object" ? input.fields : this.host.fieldsOf(input.identity ?? input.name) ?? new Map();
          const output = new Map<string, ValueType>();
          for (const [name, field] of fields) {
            const resolved = unwrap(field);
            if (!resolved) this.host.typeError(`Promise.all record field '${name}' must be a Promise, received ${describeType(field)}`, argument?.span ?? callSpan);
            output.set(name, resolved ?? unknownType);
          }
          return { kind: "promise", value: { kind: "object", fields: output } };
        }
        if (input.kind !== "list" && input.kind !== "any") {
          this.host.typeError(`Expected a List of Promises${intrinsic.name === "async.all" ? " or a record of Promises" : ""}, received ${describeType(input)}`, argument?.span ?? callSpan);
          return { kind: "promise", value: intrinsic.name === "async.all" ? { kind: "list", element: unknownType } : unknownType };
        }
        const value = input.kind === "list" ? input.element : anyType;
        const resolved = unwrap(value);
        if (!resolved) this.host.typeError(`Expected a List of Promises, received List<${describeType(value)}>`, argument?.span ?? callSpan);
        if (intrinsic.name === "async.all" && this.host.expandAliases(value).kind === "union") {
          this.host.typeError("Mixed result types need named fields; use Promise.all({name: loadName(), count: loadCount()})", argument?.span ?? callSpan);
        }
        const result = resolved ?? unknownType;
        if (intrinsic.name === "async.race") this.host.reportPromiseResolutionHazard(result, argument?.span ?? callSpan);
        return { kind: "promise", value: intrinsic.name === "async.all" ? { kind: "list", element: result } : result };
      }
      case "async.timeout": {
        call.arity(2, 3);
        const value = call.promiseValue(call.inferAt(0), 0);
        this.host.reportPromiseResolutionHazard(value, call.argumentAt(0)?.span ?? callSpan);
        call.inferAt(1, durationType);
        call.inferAt(2, stringType);
        return { kind: "promise", value };
      }
      case "async.retry": {
        call.arity(1, 3);
        const task = call.callbackAt(0, [], unknownType);
        call.inferAt(1, numberType);
        call.inferAt(2, durationType);
        const result = call.callbackResult(task);
        const resolved = result.kind === "promise" ? result.value : result;
        this.host.reportPromiseResolutionHazard(resolved, call.argumentAt(0)?.span ?? callSpan);
        return { kind: "promise", value: resolved };
      }
      case "async.map": {
        call.arity(2, 3);
        const element = call.arrayAt(0).element;
        const worker = call.callbackAt(1, [element], unknownType);
        call.inferAt(2, numberType);
        const result = call.callbackResult(worker);
        return { kind: "promise", value: { kind: "list", element: result.kind === "promise" ? result.value : result } };
      }
      case "async.series": {
        call.arity(1, 1);
        const task = call.arrayAt(0).element;
        if (task.kind !== "function" && task.kind !== "intrinsic" && task.kind !== "any") {
          this.host.typeError(`series expects a List of functions, received List<${describeType(task)}>`, call.argumentAt(0)?.span ?? callSpan);
        }
        const result = call.callbackResult(task);
        return { kind: "promise", value: { kind: "list", element: result.kind === "promise" ? result.value : result } };
      }
      default:
        return null;
    }
  }

  /** The remaining standard-module intrinsics, and the declared-signature default. */
  private inferOtherIntrinsic(call: IntrinsicCall, intrinsic: Extract<ValueType, { kind: "intrinsic" }>, callSpan: Span): ValueType {
    switch (intrinsic.name) {
      case "url.join": {
        call.arity(1, Number.POSITIVE_INFINITY);
        for (let index = 0; index < call.arguments_.length; index += 1) call.inferAt(index, stringType);
        return stringType;
      }
      case "math.min":
      case "math.max": {
        call.arity(1, Number.POSITIVE_INFINITY);
        for (let index = 0; index < call.arguments_.length; index += 1) call.inferAt(index, numberType);
        return numberType;
      }
      case "test.expect": {
        call.arity(1, 1);
        const actual = call.inferAt(0);
        const matched = this.host.expandAliases(actual);
        this.host.testExpectOperands.set(spanIdentity(callSpan), matched);
        const dynamic = matched.kind === "any" || matched.kind === "unknown";
        const fields = new Map<string, ValueType>([
          ["toBe", { kind: "function", parameterNames: ["expected"], parameters: [actual], requiredParameters: 1, result: nullType }],
          ["toEqual", { kind: "function", parameterNames: ["expected"], parameters: [actual], requiredParameters: 1, result: nullType }],
        ]);
        if (matched.kind === "bool" || dynamic) {
          fields.set("toBeTruthy", { kind: "function", parameters: [], requiredParameters: 0, result: nullType });
          fields.set("toBeFalsy", { kind: "function", parameters: [], requiredParameters: 0, result: nullType });
        }
        if (matched.kind === "list" || matched.kind === "string" || dynamic) {
          // D90 R17: an accept-anything parameter position is `unknown`, the
          // top type for assignment targets; `any` stays a value kind only.
          const contained = matched.kind === "list" ? matched.element : matched.kind === "string" ? stringType : unknownType;
          fields.set("toContain", { kind: "function", parameterNames: ["expected"], parameters: [contained], requiredParameters: 1, result: nullType });
          fields.set("toHaveLength", { kind: "function", parameterNames: ["length"], parameters: [numberType], requiredParameters: 1, result: nullType });
        }
        if (matched.kind === "string" || dynamic) {
          fields.set("toMatch", { kind: "function", parameterNames: ["expression"], parameters: [stringType], requiredParameters: 1, result: nullType });
        }
        const callable = matched.kind === "function" || matched.kind === "intrinsic" || matched.kind === "action";
        if (callable || dynamic) fields.set("toThrow", { kind: "function", parameters: [], requiredParameters: 0, result: nullType });
        if (matched.kind === "promise" || dynamic || (callable && matched.result.kind === "promise")) {
          fields.set("toReject", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: nullType } });
        }
        return { kind: "object", fields };
      }
      default:
        this.host.checkArguments(call.arguments_, intrinsic.parameters, callSpan, intrinsic.requiredParameters, intrinsic.rest);
        return intrinsic.result;
    }
  }

  private inferRangeCall(
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType {
    const hasNamed = argumentNames?.some((name) => name !== null) ?? false;
    if (!hasNamed) {
      if (arguments_.length < 1 || arguments_.length > 3) {
        this.host.typeError(`Expected 1-3 arguments but received ${arguments_.length}`, callSpan);
      }
      for (const argument of arguments_) {
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        if (argument.kind === "SpreadExpression") this.host.typeError("range does not accept a call spread", argument.span);
        this.host.requireAssignable(this.host.inferExpression(value, numberType), numberType, value.span);
      }
      return intrinsic.result;
    }

    const plan = this.planNamedArguments(
      arguments_,
      argumentNames,
      intrinsic.parameters,
      intrinsic.parameterNames,
      0,
      callSpan,
    );
    if (!plan) return intrinsic.result;
    for (const [source, target] of plan.targets.entries()) {
      const argument = arguments_[source]!;
      const value = argument.kind === "SpreadExpression" ? argument.value : argument;
      const expected = target === null ? unknownType : numberType;
      const actual = this.host.inferExpression(value, expected);
      if (target !== null) this.host.requireAssignable(actual, numberType, value.span);
    }
    if (!plan.valid) return intrinsic.result;

    const sources = Array<number>(3).fill(-1);
    for (const [source, target] of plan.targets.entries()) if (target !== null) sources[target] = source;
    const hasStart = sources[0] !== -1;
    const hasEnd = sources[1] !== -1;
    const hasStep = sources[2] !== -1;
    if (!hasEnd || (!hasStart && hasStep)) {
      this.host.typeError(
        "Named range calls use range(end = ...), range(start = ..., end = ...), or range(start = ..., end = ..., step = ...)",
        callSpan,
      );
      return intrinsic.result;
    }
    this.host.lowering.namedArgumentOrders.set(
      spanIdentity(callSpan),
      trimTrailingOmittedArguments(hasStart ? [sources[0]!, sources[1]!, sources[2]!] : [sources[1]!]),
    );
    return intrinsic.result;
  }

  // D47 rule 81: equals(a, b) is deep structural comparison over data, so the
  // call site enforces the data domain — class instances compare by identity
  // ('=='), functions and Promises have no structural content, unknown/any
  // must be validated first — and the two operands must intersect, D42's own
  // constant-comparison principle.
  private inferEqualsCall(
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType {
    const plan = this.planNamedArguments(
      sourceArguments,
      argumentNames,
      intrinsic.parameters,
      intrinsic.parameterNames,
      intrinsic.requiredParameters,
      callSpan,
    );
    const operands: { type: ValueType; span: Span }[] = [];
    if (plan) {
      for (const [source, target] of plan.targets.entries()) {
        const argument = sourceArguments[source]!;
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        if (argument.kind === "SpreadExpression") this.host.typeError("equals does not accept a call spread", argument.span);
        const type = this.host.inferExpression(value);
        if (target === 0 || target === 1) operands[target] = { type, span: value.span };
      }
      if (!plan.valid) return intrinsic.result;
      this.host.lowering.namedArgumentOrders.set(spanIdentity(callSpan), trimTrailingOmittedArguments(
        [0, 1].map((target) => {
          for (const [source, mapped] of plan.targets.entries()) if (mapped === target) return source;
          return -1;
        }),
      ));
    } else {
      if (sourceArguments.length !== 2) {
        this.host.typeError(`Expected 2 arguments but received ${sourceArguments.length}`, callSpan);
      }
      for (const argument of sourceArguments) {
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        if (argument.kind === "SpreadExpression") this.host.typeError("equals does not accept a call spread", argument.span);
        const type = this.host.inferExpression(value);
        if (operands.length < 2) operands.push({ type, span: value.span });
      }
      if (sourceArguments.length !== 2) return intrinsic.result;
    }
    let violated = false;
    for (const operand of operands) {
      if (!operand) continue;
      const violation = this.host.equalsDomainViolation(operand.type);
      if (violation) {
        this.host.typeError(`equals compares data structurally, and ${violation}`, operand.span);
        violated = true;
      }
    }
    if (!violated && operands[0] && operands[1] && !this.host.equalityTypesIntersect(operands[0].type, operands[1].type)) {
      this.host.typeError(
        this.host.typesIntersect(operands[0].type, operands[1].type, false)
          ? `${describeType(operands[0].type)} and ${describeType(operands[1].type)} can meet only where an enum member matches a raw ${this.host.enumMeetDomain(operands[0].type, operands[1].type)},`
            + ` and the enum and ${this.host.enumMeetDomain(operands[0].type, operands[1].type)} domains never meet in equals${this.host.equalityGuidance(operands[0].type, operands[1].type)}`
          : `${describeType(operands[0].type)} and ${describeType(operands[1].type)} have no values in common, so equals(a, b) is always false${this.host.equalityGuidance(operands[0].type, operands[1].type)}`,
        callSpan,
      );
    }
    this.host.lowering.equalsCalls.add(spanIdentity(callSpan));
    return intrinsic.result;
  }

  planNamedArguments(
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    parameters: readonly ValueType[],
    parameterNames: readonly string[] | undefined,
    requiredParameters: number,
    callSpan: Span,
    rest?: ValueType,
  ): NamedArgumentPlan | null {
    if (!argumentNames?.some((name) => name !== null)) return null;
    if (!parameterNames || parameterNames.length !== parameters.length || parameterNames.some((name) => !name)) {
      this.host.typeError("This callable does not expose stable parameter names", callSpan);
      return {
        ordered: arguments_,
        targets: arguments_.map(() => null),
        valid: false,
      };
    }

    const sources = Array<number>(parameters.length).fill(-1);
    const targets: (number | null)[] = [];
    let nextPositional = 0;
    let valid = !arguments_.some((argument) => argument.kind === "SpreadExpression");
    if (!valid) this.host.typeError("Named arguments cannot be combined with a call spread", callSpan);
    for (const [source, argument] of arguments_.entries()) {
      const name = argumentNames[source] ?? null;
      let target: number;
      if (name === null) {
        while (nextPositional < sources.length && sources[nextPositional] !== -1) nextPositional += 1;
        target = nextPositional++;
      } else {
        target = parameterNames.indexOf(name);
        if (target === -1) {
          this.host.typeError(`Unknown named argument '${name}'`, argument.span);
          targets.push(null);
          valid = false;
          continue;
        }
      }
      if (target >= sources.length) {
        this.host.typeError(rest
          ? "Named calls cannot pass values to a rest parameter"
          : "This fixed-arity call has no position for another argument", argument.span);
        targets.push(null);
        valid = false;
        continue;
      }
      if (sources[target] !== -1) {
        this.host.typeError(`Parameter '${parameterNames[target]}' is provided more than once`, argument.span);
        targets.push(null);
        valid = false;
        continue;
      }
      sources[target] = source;
      targets.push(target);
    }
    const missing = parameterNames.filter((_, index) => index < requiredParameters && sources[index] === -1);
    if (missing.length > 0) {
      this.host.typeError(`Missing required named argument${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`, callSpan);
      valid = false;
    }
    this.host.lowering.namedArgumentOrders.set(spanIdentity(callSpan), trimTrailingOmittedArguments(sources));
    return {
      ordered: sources.map((source) => source === -1
        ? { kind: "IdentifierExpression", name: "\u0000omitted-named-argument", span: callSpan } satisfies Expression
        : arguments_[source]!),
      targets,
      valid,
    };
  }

}
