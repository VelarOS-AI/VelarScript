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
 * The analyzer's own walk state that a call reads mid-flight — the class being
 * analyzed, the constructor and field-initializer depths, the sanctioned
 * `super(...)` site — is reached through getters on the host, so the reads stay
 * live rather than freezing at construction.
 *
 * D115 §三: this file is the facade of the directory. It holds the callee-kind
 * dispatch and the rules with no family of their own; the generic solver lives
 * in `./generic-calls.ts`, the standard-module intrinsics in `./intrinsics.ts`,
 * the argument planner in `./named-arguments.ts`, and the position seed in
 * `./seeding.ts`. Each of those declares the narrow host it needs; the union of
 * the four is `CallInferenceHost`, which is what the analyzer builds.
 */
import { type Expression } from "../../ast.ts";
import { type ClassInfo, type CompilerAnalysisExtension, type FormReadField } from "../../contracts.ts";
import { diagnostic, recoveredDiagnostic, type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";
import { spanIdentity, type Span } from "../../source.ts";
import {
  anyType,
  describeType,
  invalidType,
  isInvalidType,
  mergeTypes,
  nonOptional,
  nullType,
  numberType,
  optionalOf,
  stringType,
  unknownType,
  type ExtensionValueType,
  type TypeParameterBound,
  type ValueType,
} from "../../types.ts";
import { type CollectionInference } from "../collections/inference.ts";
import { GenericCalls } from "./generic-calls.ts";
import { IntrinsicCalls } from "./intrinsics.ts";
import { NamedArguments, type NamedArgumentPlan } from "./named-arguments.ts";

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
  /**
   * D114 0.28.0 B-I2: whether the call sits in a statement head that has no
   * annotation slot — a `using` binding (VEL2036 refuses `using r: T = ...`)
   * or a `for … in` head. A remedy that says "annotate the position" is not
   * one an author at either head can carry out.
   */
  inAnnotationFreeHead(): boolean;
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

export class CallInference {
  private readonly host: CallInferenceHost;

  /** The three files this facade dispatches to, each holding the same host. */
  private readonly namedArguments: NamedArguments;
  private readonly genericCalls: GenericCalls;
  private readonly intrinsics: IntrinsicCalls;

  constructor(host: CallInferenceHost) {
    this.host = host;
    this.namedArguments = new NamedArguments(host);
    this.genericCalls = new GenericCalls(host, this.namedArguments);
    this.intrinsics = new IntrinsicCalls(host, this.namedArguments);
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
          return this.genericCalls.inferGenericCall(callee, arguments_, argumentNames, callSpan, nonOptional(this.host.expandAliases(contextualType)));
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
    const named = this.namedArguments.planNamedArguments(arguments_, argumentNames, [unknownType], ["source"], 0, callSpan);
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
    const named = this.namedArguments.planNamedArguments(arguments_, argumentNames, [unknownType], ["source"], 0, callSpan);
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
      return this.genericCalls.inferGenericConstruction(
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
      const result = this.intrinsics.inferIntrinsicCall(callee, arguments_, argumentNames, callSpan);
      return result;
    }
    if (callee.kind === "extension") {
      const extensionResult = this.host.inferExtensionCall(callee, arguments_, argumentNames, callSpan);
      if (extensionResult) return extensionResult;
    }
    if (callee.kind === "function" || callee.kind === "action") {
      if (callee.typeParameterNames?.length) {
        const result = this.genericCalls.inferGenericCall(callee, arguments_, argumentNames, callSpan, contextualType);
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
          return this.genericCalls.inferGenericCall(inner, arguments_, argumentNames, callSpan, nonOptional(this.host.expandAliases(contextualType)));
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

  /**
   * The named-argument plan, which the analyzer hands to the collection
   * cluster as well: one planner, one lowering table of argument orders.
   */
  planNamedArguments(
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    parameters: readonly ValueType[],
    parameterNames: readonly string[] | undefined,
    requiredParameters: number,
    callSpan: Span,
    rest?: ValueType,
  ): NamedArgumentPlan | null {
    return this.namedArguments.planNamedArguments(arguments_, argumentNames, parameters, parameterNames, requiredParameters, callSpan, rest);
  }
}
