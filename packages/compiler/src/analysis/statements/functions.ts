/**
 * A function declaration, from its signature to the result it publishes: the
 * frame a body is analyzed in, the parameters it declares, the arrow that is
 * the same thing in expression position, the callable type a name is bound to,
 * and the Promise hazards an async result carries.
 *
 * D114 R1f: `analysis/functions.ts` beside this directory is the *vocabulary* —
 * the shapes and the sentences a function declaration is written with, which
 * every cluster reads. This module is the *analysis*: the walk over one
 * declaration. `Analyzer` keeps `analyzeFunctionDeclaration`,
 * `inferredFunctionResult`, `resolvedAsyncResult`, `inferParameterDefault` and
 * `contextualFunctionParameterDefault` as `protected` seams, and every call
 * this module makes to one of them goes back through the host, so a Web or
 * Node override is reached exactly as before.
 */
import {
  type ArrowFunctionExpression,
  type Expression,
  type FunctionDeclaration,
  type Statement,
  type TypeParameterDeclaration,
  type TypeReference,
} from "../../ast.ts";
import { type ClassField, type ClassInfo } from "../../contracts.ts";
import { diagnostic, mechanicalFix, type Diagnostic } from "../../diagnostic.ts";
import { REST_PARAMETER_ELEMENT_TYPE_MESSAGE } from "../../language-guidance.ts";
import { span, spanIdentity, type Span } from "../../source.ts";
import {
  describeType,
  invalidType,
  isInvalidType,
  nullType,
  mergeTypes,
  resolvedAsyncType,
  typeContainsAnyOutput,
  unknownType,
  type TypeParameterBound,
  type ValueType,
} from "../../types.ts";
import {
  type AnalyzableFunctionDeclaration,
  asyncResultAnnotationMessage,
  containsInferredResultPlaceholder,
  inferredResultPlaceholderType,
  type ReturnContext,
  sameInferredResult,
} from "../functions.ts";
import { type DeferredReadFrame } from "../modules/initialization.ts";
import { type Binding, type BuiltinTypeNamePosition, type MutableCellTarget } from "../scopes.ts";

/** The lowering facts a function declaration records for the emitter. */
export interface FunctionLoweringFacts {
  readonly asyncResolvedValues: Set<string>;
}

/**
 * Everything the function-declaration analysis asks of the analyzer that hosts
 * it, and nothing more. Every frame the walk pushes and pops — the scopes, the
 * five depths, the return contexts, the deferred-read frames — is a live
 * accessor, because the body being analyzed is what moves them.
 */
export interface FunctionStatementsHost {
  analyzeFunctionDeclaration(statement: AnalyzableFunctionDeclaration, className: string | null, method?: boolean, declareSelf?: boolean, forceAsynchronous?: boolean, declarationKind?: string): void;
  analyzeStatements(statements: readonly Statement[]): void;
  asyncResultContainsPromise(type: ValueType): boolean;
  readonly arrowCaptureFrames: { captured: { readonly handle: string; readonly depth: number } | null }[];
  readonly arrowDeferredFrames: Map<string, DeferredReadFrame>;
  readonly arrowOwnedCaptures: Map<string, { readonly handle: string; readonly depth: number }>;
  readonly asynchronousFunctions: boolean[];
  blockAlwaysReturns(statements: readonly Statement[]): boolean;
  checkTypeParameterDeclarations(declarations: readonly TypeParameterDeclaration[] | undefined): void;
  classFieldInitializerDepth: number;
  classInfo(key: string): ClassInfo | undefined;
  classTypeParameterDeclarations(className: string | null): readonly TypeParameterDeclaration[] | undefined;
  contextuallyAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): boolean;
  contextualFunctionParameterDefault(statement: AnalyzableFunctionDeclaration, parameter: AnalyzableFunctionDeclaration["parameters"][number]): ValueType | null;
  constructorDepth: number;
  currentClass: string | null;
  declareBinding(name: string, mutable: boolean, type: ValueType, declarationSpan: Span, internal?: boolean, declaredType?: ValueType, importSource?: string, typeNamePosition?: BuiltinTypeNamePosition): void;
  readonly deferredConvergenceReports: { readonly report: Diagnostic; readonly resultKey: string; readonly causes: ReadonlySet<string> }[];
  readonly deferredReadFrames: DeferredReadFrame[];
  readonly diagnostics: Diagnostic[];
  enterScope(): void;
  exitScope(): void;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  readonly finalizeFunctionResultInference: boolean;
  finallyLoopDepths: number[];
  flowFrameDepth: number;
  functionDepth: number;
  readonly functionResultKeys: WeakMap<Binding, string>;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferParameterDefault(expression: Expression, contextualType?: ValueType): ValueType;
  inferredFunctionResult(statement: Pick<FunctionDeclaration, "returnType" | "signatureSpan"> & { readonly abstract?: boolean }): ValueType;
  readonly inferredFunctionResultSeeds: ReadonlyMap<string, ValueType>;
  readonly inferredFunctionResultTypes: Map<string, ValueType>;
  readonly localFunctionFrames: Map<Binding, DeferredReadFrame>;
  lookup(name: string): Binding | null;
  loopDepth: number;
  readonly lowering: FunctionLoweringFacts;
  memberTypeParameterFrame(classParameters: readonly TypeParameterDeclaration[] | undefined, ownParameters: readonly TypeParameterDeclaration[] | undefined): ReadonlyMap<string, ValueType>;
  readonly modulePath: string | null;
  parameterDefaultDepth: number;
  readonly predeclared: WeakSet<object>;
  promiseResolutionHazard(type: ValueType): string | null;
  promiseResolutionNeedsRuntimeGuard(type: ValueType): boolean;
  readonly privateFields: Map<string, Map<string, ClassField>>;
  readonly privateMethods: Map<string, Map<string, ValueType>>;
  readonly privateStaticFields: Map<string, Map<string, ClassField>>;
  readonly privateStaticMethods: Map<string, Map<string, ValueType>>;
  recordExportedAny(statement: AnalyzableFunctionDeclaration, className: string | null, reportSpan: Span): void;
  reportPromiseCarrierHazard(type: ValueType, errorSpan: Span): void;
  reportPromiseResolutionHazard(type: ValueType, errorSpan: Span): void;
  recordFlowFactOrigin(binding: Binding): void;
  recordSemanticBinding(key: string, type: ValueType): void;
  rejectClassTypeParameterRedeclaration(classParameters: readonly TypeParameterDeclaration[] | undefined, ownParameters: readonly TypeParameterDeclaration[] | undefined, className: string | null): void;
  readonly reportedResultHoles: Set<string>;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell?: MutableCellTarget | null): void;
  requireSettledCollectionElement(initializer: Expression, declared: ValueType, annotated: boolean): boolean;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  resolveResult(reference: TypeReference | null): ValueType;
  resolvedAsyncResult(type: ValueType): ValueType;
  resolveValidatedAnnotation(reference: TypeReference | null): ValueType;
  resolveValidatedResult(reference: TypeReference | null): ValueType;
  readonly returnContexts: ReturnContext[];
  readonly scopes: Map<string, Binding>[];
  selfClassType(className: string): ValueType;
  staticFieldInitialization: { readonly className: string; readonly initialized: ReadonlySet<string> } | null;
  staticMemberTypeParameters: { readonly className: string; readonly names: ReadonlySet<string> } | null;
  superMemberContext: "instance" | "static" | null;
  typeParameterBoundVector(declarations: readonly TypeParameterDeclaration[] | undefined): readonly (TypeParameterBound | null)[] | null;
  typeParameterFrame(declarations: readonly TypeParameterDeclaration[] | undefined): ReadonlyMap<string, ValueType>;
  readonly typeParameterFrames: ReadonlyMap<string, ValueType>[];
  validateTypeReference(reference: TypeReference, resolve?: (reference: TypeReference) => ValueType): boolean;
  withTypeParameterFrame<T>(frame: ReadonlyMap<string, ValueType>, action: () => T): T;
}

export class FunctionStatements {
  private readonly host: FunctionStatementsHost;

  constructor(host: FunctionStatementsHost) {
    this.host = host;
  }

  analyzeFunctionDeclarationStatement(statement: Extract<Statement, { kind: "FunctionDeclaration" }>): void {
    // MOD-D1: `export def` below module scope emitted invalid JavaScript.
    if (statement.exported && this.host.scopes.length !== 1) {
      this.host.diagnostics.push(diagnostic("VEL3011", "Exports can only be declared at module scope", statement.span));
    }
    // D39 item 53: one spelling. `def test_*` discovery is retired, so the
    // name that used to mean "this is a test" gets pointed at the block.
    if (statement.name.startsWith("test_") && this.host.scopes.length === 1 && (this.host.modulePath ?? "").endsWith(".test.vel")) {
      this.host.diagnostics.push(diagnostic(
        "VEL3019",
        `Write 'test "${statement.name.slice("test_".length).replaceAll("_", " ")}":' and move the body into it; a test's name is a sentence the owner reads, and 'def test_*' discovery is retired`,
        statement.signatureSpan,
      ));
    }
    this.host.analyzeFunctionDeclaration(statement, null);
  }

  /**
   * D58 rule 139: `-> null` is the one result annotation that names nothing a
   * caller can use — a caller that ignores a result already knows as much — so
   * where a body infers exactly that, the annotation is two spellings of one
   * declaration and the written one is refused. `extern` declarations,
   * abstract methods, and function types have no body to infer from and keep
   * declaring it (VEL4023, VEL2001), and a getter's result is the property's
   * type, which the parser requires outright (VEL2023).
   *
   * Deleting an annotation the compiler would infer identically is provably
   * equivalent, so it is a mechanical fix under D50 rule 95 — but only there.
   * D58 correction 2: where the body returns a value, the deletion is not
   * equivalent, it widens the signature and takes VEL4001 down with it, so the
   * refusal is reported without a fix and the author decides whether the body
   * or the intent was wrong. `velar fix` runs unattended because it never does
   * the second kind of thing.
   *
   * D64 rule 162: dropping the fix was only half of that correction. The
   * message still said "delete the annotation" — the one move the ruling had
   * just refused to make — so the diagnostic taught an exit it rejects on the
   * next step, which is the D57 rule 136 shape. The two cases now carry two
   * messages: where the body does infer null the deletion is the answer, and
   * where it does not, the disagreement between the body and the annotation is
   * the answer, and deleting would only widen the signature to hide it.
   */
  private inferredNullResultAnnotation(statement: AnalyzableFunctionDeclaration): TypeReference | null {
    const reference = statement.returnType;
    if (!reference || reference.syntax.kind !== "NamedTypeSyntax" || reference.syntax.name !== "null") return null;
    if ("accessor" in statement) return null;
    return reference;
  }

  private reportInferredNullResult(
    statement: AnalyzableFunctionDeclaration,
    declarationKind: string,
    inferred: ValueType,
  ): void {
    const reference = this.inferredNullResultAnnotation(statement);
    if (!reference) return;
    if (inferred.kind !== "null") {
      this.host.diagnostics.push(diagnostic(
        "VEL4037",
        `${declarationKind} '${statement.name}' takes its result from its body, which returns ${describeType(inferred)}, not null; change the body or the result you meant — deleting the annotation would widen the signature`,
        reference.span,
      ));
      return;
    }
    const deletion = statement.resultAnnotationSpan;
    this.host.diagnostics.push(diagnostic(
      "VEL4037",
      `${declarationKind} '${statement.name}' infers '-> null' from its body; delete the annotation, and write it only where 'extern', 'abstract', or a function type leaves no body to infer`,
      reference.span,
      deletion ? mechanicalFix(deletion, "", "Delete the inferred '-> null'") : undefined,
    ));
  }

  /**
   * D89 (message correction): the one report a `self` parameter earns, and the
   * deletion it names. The removed range reaches to the next parameter's start
   * (or back to the previous one's end), so the separating comma and its
   * whitespace come with it without reading the source text — the rewrite is a
   * spelling change with no judgment in it, which is what D38 §48 requires of
   * a registered fix.
   */
  reportImplicitSelfParameter(
    parameters: readonly { readonly name: string; readonly span: Span }[],
    index: number,
  ): void {
    const parameter = parameters[index]!;
    const next = parameters[index + 1];
    const previous = parameters[index - 1];
    const removal = next
      ? span(parameter.span.start, next.span.start)
      : previous
        ? span(previous.span.end, parameter.span.end)
        : parameter.span;
    this.host.diagnostics.push(diagnostic(
      "VEL3007",
      "'self' is the receiver a method body already has, not a parameter; delete it from the parameter list",
      parameter.span,
      mechanicalFix(removal, "", "Delete the implicit 'self' parameter"),
    ));
  }

  analyzeFunctionDeclaration(
    statement: AnalyzableFunctionDeclaration,
    className: string | null,
    method = false,
    declareSelf = Boolean(className),
    forceAsynchronous = false,
    declarationKind = "accessor" in statement ? "Getter" : method ? "Method" : "Function",
  ): void {
    const outerConstructorDepth = this.host.constructorDepth;
    if (!method && !className && !this.host.predeclared.has(statement)) {
      this.host.declareBinding(statement.name, false, this.functionType(statement as FunctionDeclaration), statement.span);
    }
    const candidateBinding = className === null ? this.host.lookup(statement.name) : null;
    const callableBinding = candidateBinding?.span.start === statement.span.start ? candidateBinding : null;
    // D85 rule 209: the same registration the top-level predeclaration makes,
    // for a `def` nested in a body, which nothing predeclares.
    if (callableBinding && !this.host.functionResultKeys.has(callableBinding)) {
      this.host.functionResultKeys.set(callableBinding, this.functionResultKey(statement as FunctionDeclaration));
    }
    this.host.checkTypeParameterDeclarations(statement.typeParameters);
    // D55 rule 120 layer two: an instance member of a generic class is read
    // under the class's parameters as well as its own; a static one is not,
    // because it belongs to the class rather than to an instantiation.
    const memberClassParameters = declareSelf ? this.host.classTypeParameterDeclarations(className) : undefined;
    this.host.rejectClassTypeParameterRedeclaration(memberClassParameters, statement.typeParameters, className);
    const outerStaticTypeParameters = this.host.staticMemberTypeParameters;
    if (!declareSelf && className) {
      const classParameters = this.host.classTypeParameterDeclarations(className);
      if (classParameters) {
        this.host.staticMemberTypeParameters = { className, names: new Set(classParameters.map((parameter) => parameter.name)) };
      }
    }
    this.host.typeParameterFrames.push(this.host.memberTypeParameterFrame(memberClassParameters, statement.typeParameters));
    this.host.enterScope();
    this.host.flowFrameDepth += 1;
    this.host.functionDepth += 1;
    // D31 item 23: this body is deferred, so its reads of imported bindings
    // become initialization-position reads only when something runs it during
    // module evaluation. Collect them here and let a top-level call decide.
    const deferredFrame: DeferredReadFrame = { reads: [], calls: [] };
    this.host.deferredReadFrames.push(deferredFrame);
    if (callableBinding) this.host.localFunctionFrames.set(callableBinding, deferredFrame);
    const previousLoopDepth = this.host.loopDepth;
    this.host.loopDepth = 0;
    const previousFinallyLoopDepths = this.host.finallyLoopDepths;
    this.host.finallyLoopDepths = [];
    const previousClass = this.host.currentClass;
    const previousSuperMemberContext = this.host.superMemberContext;
    this.host.currentClass = className ?? previousClass;
    this.host.superMemberContext = method && className
      ? "static" in statement && statement.static === true ? "static" : "instance"
      : null;
    const asynchronous = forceAsynchronous || statement.asynchronous === true;
    this.host.asynchronousFunctions.push(asynchronous);
    const inferredReturns = statement.returnType === null ? [] : null;
    const declaredReturn = statement.returnType ? this.host.resolveResult(statement.returnType) : unknownType;
    const returnValid = statement.returnType ? this.host.validateTypeReference(statement.returnType) : true;
    if (asynchronous && statement.returnType && returnValid && this.host.asyncResultContainsPromise(declaredReturn)) {
      this.host.diagnostics.push(diagnostic("VEL4018", asyncResultAnnotationMessage, statement.returnType.span));
    } else if (statement.returnType && returnValid) {
      if (asynchronous) this.host.reportPromiseResolutionHazard(declaredReturn, statement.returnType.span);
      else this.host.reportPromiseCarrierHazard(declaredReturn, statement.returnType.span);
    }
    // D58 correction 2: whether the deletion is provably equivalent is a fact
    // about the body, so the refusal waits until the body has been read.
    const observedReturns: ValueType[] | null = inferredReturns === null && this.inferredNullResultAnnotation(statement)
      ? []
      : null;
    const expectedReturn = returnValid
      ? asynchronous ? this.host.resolvedAsyncResult(declaredReturn) : declaredReturn
      : invalidType;
    const returnContext: ReturnContext = {
      expected: expectedReturn,
      inferredReturns,
      observedReturns,
      declarationKind,
    };
    this.host.returnContexts.push(returnContext);
    if (className && declareSelf) {
      this.host.declareBinding("self", false, this.host.selfClassType(className), statement.span, true);
    }
    this.declareFunctionParameters(statement, className, declareSelf);
    this.host.constructorDepth = 0;
    this.host.analyzeStatements(statement.body);
    if (observedReturns) {
      const inferred = this.inferCollectedFunctionResult(observedReturns, !this.host.blockAlwaysReturns(statement.body));
      this.reportInferredNullResult(statement, declarationKind, inferred);
    }
    const resultKey = this.functionResultKey(statement as FunctionDeclaration);
    this.recordFunctionResultInference(statement, className, callableBinding, inferredReturns, returnContext, declarationKind, asynchronous, declaredReturn, returnValid, resultKey);
    if (statement.returnType && returnValid && expectedReturn.kind !== "null" && !this.host.blockAlwaysReturns(statement.body)) {
      this.host.diagnostics.push(diagnostic("VEL4006", `${declarationKind} '${statement.name}' can finish without returning ${describeType(expectedReturn)}`, statement.span));
    }
    this.host.returnContexts.pop();
    this.host.asynchronousFunctions.pop();
    this.host.currentClass = previousClass;
    this.host.superMemberContext = previousSuperMemberContext;
    this.host.loopDepth = previousLoopDepth;
    this.host.finallyLoopDepths = previousFinallyLoopDepths;
    this.host.deferredReadFrames.pop();
    this.host.functionDepth -= 1;
    this.host.flowFrameDepth -= 1;
    this.host.exitScope();
    this.host.typeParameterFrames.pop();
    this.host.staticMemberTypeParameters = outerStaticTypeParameters;
    this.host.constructorDepth = outerConstructorDepth;
  }

  /**
   * The parameter list of one declaration: the implicit-receiver refusal, the
   * target-owned contextual default, and the binding each parameter declares.
   *
   * D115 §一.1: split out of `analyzeFunctionDeclaration` unchanged so both
   * halves fit in one screen. It reads nothing the loop did not already read
   * and leaves behind no local the rest of the declaration uses.
   */
  private declareFunctionParameters(
    statement: AnalyzableFunctionDeclaration,
    className: string | null,
    declareSelf: boolean,
  ): void {
    for (const [index, parameter] of statement.parameters.entries()) {
      // D89 (message correction): a method body already has `self`, so writing
      // it as a parameter is Python's explicit receiver. It used to earn two
      // reports — "already declared in this scope" and "reserved Core binding"
      // — neither of which named the fix. Only a declaration that really has
      // an implicit receiver takes this branch; a plain or static function's
      // `self` keeps the reserved-binding refusal, which is the truth there.
      // A rest spelling is not the receiver reflex, and its '...' sits outside
      // the parameter span, so deleting the name alone would leave a stray one.
      if (parameter.name === "self" && !parameter.rest && className !== null && declareSelf) {
        this.reportImplicitSelfParameter(statement.parameters, index);
        continue;
      }
      const contextualType = !parameter.type && parameter.defaultValue
        ? this.host.contextualFunctionParameterDefault(statement, parameter)
        : null;
      const type = contextualType ?? this.host.resolveAnnotation(parameter.type);
      const valid = contextualType !== null || (parameter.type ? this.host.validateTypeReference(parameter.type) : true);
      if (parameter.defaultValue && valid && contextualType === null) {
        this.host.requireAssignable(this.host.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      }
      const declared = valid ? type : invalidType;
      this.host.declareBinding(parameter.name, false, parameter.rest ? { kind: "list", element: declared } : declared, parameter.span);
    }
  }

  /**
   * What the declaration publishes as its result: the type the body inferred
   * and the convergence report a recursive contract earns, or the declared
   * result when one was written.
   *
   * D115 §一.1: split out of `analyzeFunctionDeclaration` unchanged. Every
   * value it needs was computed before the body was analyzed, so the split
   * point is the line after `analyzeStatements` and the order is the order it
   * ran in.
   */
  private recordFunctionResultInference(
    statement: AnalyzableFunctionDeclaration,
    className: string | null,
    callableBinding: Binding | null,
    inferredReturns: ValueType[] | null,
    returnContext: ReturnContext,
    declarationKind: string,
    asynchronous: boolean,
    declaredReturn: ValueType,
    returnValid: boolean,
    resultKey: string,
  ): void {
    if (inferredReturns) {
      const inferred = this.inferCollectedFunctionResult(inferredReturns, !this.host.blockAlwaysReturns(statement.body));
      this.host.inferredFunctionResultTypes.set(resultKey, inferred);
      const seeded = this.host.inferredFunctionResultSeeds.get(resultKey) ?? inferredResultPlaceholderType;
      if (returnContext.unsettledResult === true) {
        this.host.reportedResultHoles.add(resultKey);
      } else if (this.host.finalizeFunctionResultInference
        && (containsInferredResultPlaceholder(inferred) || isInvalidType(inferred) || !sameInferredResult(seeded, inferred))) {
        const report = diagnostic(
          "VEL4025",
          `${declarationKind} '${statement.name}' result inference did not converge; add an explicit result annotation to this recursive contract`,
          statement.signatureSpan,
        );
        this.host.diagnostics.push(report);
        // D85 rule 209: a callee whose hole is reported after this caller is
        // analyzed is a hole nobody can know about yet, so the report waits
        // for the whole module before it is kept or deleted as the second
        // half of one mistake.
        const causes = returnContext.resultHoleCauses;
        if (causes && causes.size > 0) this.host.deferredConvergenceReports.push({ report, resultKey, causes });
      }
      // D90 R12: an omitted result annotation publishes whatever the body
      // inferred, so an exported `def` leaks `any` exactly as an exported
      // `const` does. Deliberately not gated on finalizeFunctionResultInference:
      // a probe pass is discarded whole — the driver keeps the first pass's
      // diagnostics only when nothing was left to converge — which is why the
      // VEL4006 below is ungated too.
      if (typeContainsAnyOutput(inferred)) this.host.recordExportedAny(statement, className, statement.signatureSpan);
      this.updateInferredCallableResult(statement, className, callableBinding, inferred, asynchronous);
    } else {
      const effectiveResult = returnValid ? declaredReturn : invalidType;
      this.host.inferredFunctionResultTypes.set(resultKey, effectiveResult);
      this.updateInferredCallableResult(statement, className, callableBinding, effectiveResult, asynchronous);
    }
  }

  inferArrow(expression: ArrowFunctionExpression, contextualType: ValueType): ValueType {
    const expandedContext = this.host.expandAliases(contextualType);
    const expected = expandedContext.kind === "function"
      ? expandedContext
      : expandedContext.kind === "optional" && expandedContext.inner.kind === "function"
        ? expandedContext.inner
        : null;
    const outerClassFieldInitializerDepth = this.host.classFieldInitializerDepth;
    const outerStaticFieldInitialization = this.host.staticFieldInitialization;
    this.host.classFieldInitializerDepth = 0;
    this.host.staticFieldInitialization = null;
    this.host.enterScope();
    this.host.flowFrameDepth += 1;
    this.host.functionDepth += 1;
    // D31 item 23: an arrow bound to a module-local name is the other deferred
    // body a top-level call can run, and the binding does not exist until the
    // declaration finishes, so the frame is filed by the arrow's own span and
    // the declaration claims it afterwards.
    const deferredFrame: DeferredReadFrame = { reads: [], calls: [] };
    this.host.deferredReadFrames.push(deferredFrame);
    this.host.arrowDeferredFrames.set(spanIdentity(expression.span), deferredFrame);
    const previousFinallyLoopDepths = this.host.finallyLoopDepths;
    this.host.finallyLoopDepths = [];
    this.host.asynchronousFunctions.push(expression.asynchronous);
    const parameterTypes: ValueType[] = [];
    let rest: ValueType | undefined;
    let fixedIndex = 0;
    for (const parameter of expression.parameters) {
      const contextualParameter = parameter.rest ? expected?.rest : expected?.parameters[fixedIndex];
      const annotated = parameter.type ? this.host.resolveAnnotation(parameter.type) : null;
      const annotationValid = parameter.type ? this.host.validateTypeReference(parameter.type) : true;
      const defaultType = !annotated && !contextualParameter && parameter.defaultValue
        ? this.host.inferParameterDefault(parameter.defaultValue)
        : null;
      const type = annotationValid ? annotated ?? contextualParameter ?? defaultType ?? unknownType : invalidType;
      // D65 rule 170: the parser let an unannotated rest through so the
      // context could type it the way it types the fixed parameters beside it.
      // If no context arrived, the refusal it deferred is due now.
      if (parameter.rest && !parameter.type && !contextualParameter) {
        this.host.diagnostics.push(diagnostic("VEL2016", REST_PARAMETER_ELEMENT_TYPE_MESSAGE, parameter.span));
      }
      if (parameter.defaultValue && !defaultType && annotationValid) {
        const actualDefault = this.host.inferParameterDefault(parameter.defaultValue, type);
        this.host.requireAssignable(actualDefault, type, parameter.defaultValue.span);
      }
      this.host.declareBinding(parameter.name, false, parameter.rest ? { kind: "list", element: type } : type, parameter.span);
      if (parameter.rest) rest = type;
      else {
        parameterTypes.push(type);
        fixedIndex += 1;
      }
    }
    const expectedResult = expected?.result ?? unknownType;
    const expandedExpectedResult = this.host.expandAliases(expectedResult);
    const contextualResult = expression.asynchronous && expandedExpectedResult.kind === "promise"
      ? resolvedAsyncType(expandedExpectedResult.value)
      : expectedResult;
    const outerParameterDefaultDepth = this.host.parameterDefaultDepth;
    const outerConstructorDepth = this.host.constructorDepth;
    this.host.parameterDefaultDepth = 0;
    this.host.constructorDepth = 0;
    this.host.arrowCaptureFrames.push({ captured: null });
    const bodyResult = this.host.inferExpression(expression.body, contextualResult);
    const captured = this.host.arrowCaptureFrames.pop()?.captured ?? null;
    if (captured) this.host.arrowOwnedCaptures.set(spanIdentity(expression.span), captured);
    this.host.parameterDefaultDepth = outerParameterDefaultDepth;
    this.host.constructorDepth = outerConstructorDepth;
    let checkedBodyResult = expected
      && expandedExpectedResult.kind !== "unknown"
      && expandedExpectedResult.kind !== "any"
      && this.host.contextuallyAssignable(bodyResult, contextualResult, expression.body.span)
      ? contextualResult
      : bodyResult;
    // D85 rule 207: with no contextual result the arrow's body is the only
    // thing that says what it returns, so an empty collection written there
    // has nothing settling it — the same position a body-inferred `return`
    // occupies, reported the same way. Rule 209: once reported, the arrow's
    // result is invalid rather than a `List<unknown>` a caller reports again.
    if (expandedExpectedResult.kind === "unknown"
      && this.host.requireSettledCollectionElement(expression.body, checkedBodyResult, false)) {
      checkedBodyResult = invalidType;
    }
    const result = expression.asynchronous
      ? { kind: "promise", value: this.host.resolvedAsyncResult(checkedBodyResult) } satisfies ValueType
      : checkedBodyResult;
    if (expression.asynchronous) {
      const contextualHazard = expandedExpectedResult.kind === "promise"
        ? this.host.promiseResolutionHazard(expandedExpectedResult.value)
        : null;
      if (!contextualHazard) this.host.reportPromiseCarrierHazard(result, expression.body.span);
      if (result.kind === "promise" && this.host.promiseResolutionNeedsRuntimeGuard(result.value)) {
        this.host.lowering.asyncResolvedValues.add(spanIdentity(expression.body.span));
      }
    }
    this.host.asynchronousFunctions.pop();
    this.host.finallyLoopDepths = previousFinallyLoopDepths;
    this.host.deferredReadFrames.pop();
    this.host.functionDepth -= 1;
    this.host.flowFrameDepth -= 1;
    this.host.exitScope();
    this.host.classFieldInitializerDepth = outerClassFieldInitializerDepth;
    this.host.staticFieldInitialization = outerStaticFieldInitialization;
    return {
      kind: "function",
      parameters: parameterTypes,
      parameterNames: expression.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
      requiredParameters: expression.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { rest } : {}),
      result,
    };
  }

  private callableWithInferredResult(type: ValueType, result: ValueType, asynchronous: boolean): ValueType {
    if (type.kind !== "function" && type.kind !== "action" && type.kind !== "intrinsic") return type;
    return { ...type, result: asynchronous ? { kind: "promise", value: result } : result };
  }

  private updateInferredCallableResult(
    statement: AnalyzableFunctionDeclaration,
    className: string | null,
    binding: Binding | null,
    result: ValueType,
    asynchronous: boolean,
  ): void {
    if (binding) {
      const type = this.callableWithInferredResult(binding.declaredType, result, asynchronous);
      this.host.recordFlowFactOrigin(binding);
      binding.type = type;
      binding.declaredType = type;
      binding.storageType = type;
      this.host.recordSemanticBinding(`${binding.span.start}:${statement.name}`, type);
    }
    if (!className) return;
    const method = statement as FunctionDeclaration & { readonly static?: boolean; readonly private?: boolean; readonly accessor?: boolean };
    const info = this.host.classInfo(className);
    if (!info) return;
    if ("accessor" in method) {
      const fields: ReadonlyMap<string, ClassField> | undefined = method.private
        ? (method.static ? this.host.privateStaticFields : this.host.privateFields).get(className)
        : method.static ? info.staticFields : info.fields;
      const current = fields?.get(statement.name);
      if (current && fields instanceof Map) {
        fields.set(statement.name, {
          ...current,
          type: asynchronous ? { kind: "promise", value: result } : result,
        });
      }
      return;
    }
    const table: ReadonlyMap<string, ValueType> | undefined = method.private
      ? (method.static ? this.host.privateStaticMethods : this.host.privateMethods).get(className)
      : method.static ? info.staticMethods : info.methods;
    const current = table?.get(statement.name);
    if (current && table instanceof Map) {
      table.set(statement.name, this.callableWithInferredResult(current, result, asynchronous));
    }
  }

  functionResultKey(statement: Pick<FunctionDeclaration, "signatureSpan">): string {
    return spanIdentity(statement.signatureSpan);
  }

  inferredFunctionResult(
    statement: Pick<FunctionDeclaration, "returnType" | "signatureSpan"> & { readonly abstract?: boolean },
  ): ValueType {
    if (statement.returnType) {
      return this.host.resolveValidatedResult(statement.returnType);
    }
    if (statement.abstract === true) return invalidType;
    const key = this.functionResultKey(statement);
    return this.host.inferredFunctionResultTypes.get(key)
      ?? this.host.inferredFunctionResultSeeds.get(key)
      ?? inferredResultPlaceholderType;
  }

  inferCollectedFunctionResult(returned: readonly ValueType[], fallsThrough: boolean): ValueType {
    const concrete = returned.filter((type) => !containsInferredResultPlaceholder(type));
    const candidates = concrete.length > 0 ? concrete : [...returned];
    if (fallsThrough || candidates.length === 0) candidates.push(nullType);
    if (candidates.some(isInvalidType)) return invalidType;
    return candidates.reduce((result, candidate) => mergeTypes(result, candidate));
  }

  functionType(statement: FunctionDeclaration, classParameters?: readonly TypeParameterDeclaration[]): ValueType {
    // D55 rule 120 layer two: a method of a generic class is checked under its
    // own parameters *and* the class's, but only its own are solved at a call —
    // the class's are already fixed by the receiver. So the frame carries both
    // and the callable publishes the first ones only; everything above that
    // count is a class parameter, which `substituteClassMemberType` supplies
    // when the class is instantiated.
    const frame = this.host.memberTypeParameterFrame(classParameters, statement.typeParameters);
    const own = this.host.typeParameterFrame(statement.typeParameters);
    const bounds = this.host.typeParameterBoundVector(statement.typeParameters);
    return this.host.withTypeParameterFrame(frame, () => {
      const result = this.host.inferredFunctionResult(statement);
      const rest = statement.parameters.find((parameter) => parameter.rest);
      return {
        kind: "function",
        ...(own.size > 0 ? { typeParameterNames: [...own.keys()] } : {}),
        ...(own.size > 0 && bounds ? { typeParameterBounds: bounds } : {}),
        parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.host.resolveValidatedAnnotation(parameter.type)),
        parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
        requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
        ...(rest ? { rest: this.host.resolveValidatedAnnotation(rest.type) } : {}),
        result: statement.asynchronous ? { kind: "promise", value: this.host.resolvedAsyncResult(result) } : result,
      };
    });
  }
}
