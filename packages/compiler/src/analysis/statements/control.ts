/**
 * The control-flow statement forms: `@main`, `return`, `throw`, `assert`,
 * `if`, `try`, an expression on its own line, `detach`, and a `test` block —
 * plus the three refusals an expression statement earns when its result goes
 * nowhere.
 *
 * D114 R1f: these leave `analyzer.ts` together because they are the statements
 * whose whole job is where control goes next; the flow *facts* they push and
 * merge already live under `flow/`, and this module only decides which branch
 * they belong to.
 */
import { type DetachStatement, type Expression, type Statement, type TestDeclaration } from "../../ast.ts";
import { type CollectionOperation, type PrimitiveOperation } from "../../contracts.ts";
import { diagnostic, type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";
import { spanIdentity, type Span } from "../../source.ts";
import {
  describeType,
  invalidType,
  isInvalidType,
  nullType,
  stringType,
  unknownType,
  type ValueType,
} from "../../types.ts";
import { discardedPureCollectionOperations } from "../collections/operations.ts";
import { type FlowFactInvalidations, type FlowFactsSnapshot } from "../flow/facts.ts";
import { type ReturnContext } from "../functions.ts";
import { discardedPurePrimitiveOperations } from "../members.ts";
import { type Binding, type BuiltinTypeNamePosition, type MutableCellTarget, type VisibleScopeDepth } from "../scopes.ts";

/** The lowering facts a control statement records for the emitter. */
export interface ControlLoweringFacts {
  readonly asyncResolvedValues: Set<string>;
  readonly collectionCalls: Map<number, CollectionOperation>;
  readonly primitiveCalls: Map<number, PrimitiveOperation>;
}

/**
 * Everything the control statements ask of the analyzer that hosts them, and
 * nothing more. The frame state a `test` block and a `try` move — the function,
 * flow and loop depths, the finally-loop stack, the return contexts — arrives
 * as live accessors, because the body being analyzed is what changes them.
 */
export interface ControlStatementsHost {
  analyzeBlock(statements: readonly Statement[], narrowed?: ReadonlyMap<string, ValueType>): ReadonlyMap<string, ValueType>;
  analyzeIsolatedFlow(snapshot: FlowFactsSnapshot, analyze: () => void): FlowFactInvalidations;
  analyzeStatements(statements: readonly Statement[]): void;
  applyFlowInvalidations(branches: readonly FlowFactInvalidations[], includeBaseline?: boolean): void;
  readonly asynchronousFunctions: boolean[];
  blockAlwaysExits(statements: readonly Statement[]): boolean;
  blockAlwaysReturns(statements: readonly Statement[]): boolean;
  collectResultHoleSources(expression: Expression, causes: Set<string>): boolean;
  commonNarrowings(branches: readonly ReadonlyMap<string, ValueType>[]): ReadonlyMap<string, ValueType>;
  readonly constructorDepth: number;
  declareBinding(name: string, mutable: boolean, type: ValueType, declarationSpan: Span, internal?: boolean, declaredType?: ValueType, importSource?: string, typeNamePosition?: BuiltinTypeNamePosition): void;
  readonly declaredTestTitles: Set<string>;
  deferredExecutionDepth: number;
  readonly diagnostics: Diagnostic[];
  enterScope(): void;
  readonly executeMain: boolean;
  exitScope(): void;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  finallyLoopDepths: number[];
  flowFrameDepth: number;
  flowSnapshotAfterInvalidations(baseline: FlowFactsSnapshot, invalidations: readonly FlowFactInvalidations[]): FlowFactsSnapshot;
  functionDepth: number;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferNarrowedExpression(expression: Expression, narrowed: ReadonlyMap<string, ValueType>, contextualType: ValueType): ValueType;
  inModuleInitializationPosition(): boolean;
  isSubclassOf(actual: string, expected: string): boolean;
  loopDepth: number;
  readonly lowering: ControlLoweringFacts;
  readonly modulePath: string | null;
  narrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType>;
  narrowingsForVisibleBindings(visible: VisibleScopeDepth): ReadonlyMap<string, ValueType>;
  negativeNarrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType>;
  persistNarrowings(narrowed: ReadonlyMap<string, ValueType>): void;
  promiseResolutionHazard(type: ValueType): string | null;
  promiseResolutionNeedsRuntimeGuard(type: ValueType): boolean;
  rejectOwnedResourceEscape(expression: Expression | null, action: string, errorSpan: Span): boolean;
  reportPromiseResolutionHazard(type: ValueType, errorSpan: Span): void;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell?: MutableCellTarget | null): void;
  requireCondition(type: ValueType, condition: Expression): void;
  requireSettledCollectionElement(initializer: Expression, declared: ValueType, annotated: boolean): boolean;
  resolvedAsyncResult(type: ValueType): ValueType;
  restoreFlowFacts(snapshot: FlowFactsSnapshot): void;
  readonly returnContexts: ReturnContext[];
  readonly scopes: Map<string, Binding>[];
  snapshotFlowFacts(): FlowFactsSnapshot;
  readonly testExpectOperands: ReadonlyMap<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  readonly unreachableDiagnosticDepth: number;
  visibleBindings(): VisibleScopeDepth;
}

export class ControlStatements {
  private readonly host: ControlStatementsHost;

  constructor(host: ControlStatementsHost) {
    this.host = host;
  }

  analyzeMainBlock(statement: Extract<Statement, { kind: "MainBlock" }>): void {
    if (this.host.scopes.length !== 1) {
      this.host.diagnostics.push(diagnostic("VEL3011", "'@main' can only be declared at module scope", statement.keywordSpan));
    }
    if ((this.host.modulePath ?? "").endsWith(".test.vel")) {
      this.host.diagnostics.push(diagnostic(
        "VEL3011",
        "A test module declares named 'test' blocks and cannot also declare an '@main' program entry",
        statement.keywordSpan,
      ));
    }
    // 依赖模块的正文仍要完整类型检查，但它不会在这次程序中执行，所以其中的
    // 导入读取不能被误记成依赖模块的初始化读取。入口模块则保留真实的初始化
    // 语义，继续参与循环导入检查和宿主错误归一化。
    if (!this.host.executeMain) this.host.deferredExecutionDepth += 1;
    try {
      this.host.analyzeBlock(statement.body);
    } finally {
      if (!this.host.executeMain) this.host.deferredExecutionDepth -= 1;
    }
  }

  analyzeReturnStatement(statement: Extract<Statement, { kind: "ReturnStatement" }>): void {
    if (this.host.constructorDepth > 0) {
      this.host.diagnostics.push(diagnostic("VEL3014", "'return' cannot be used directly in a constructor", statement.span));
      return;
    }
    if (this.host.functionDepth === 0) {
      this.host.diagnostics.push(diagnostic("VEL3003", "'return' can only be used inside a function", statement.span));
      return;
    }
    if (this.host.finallyLoopDepths.length > 0) {
      this.host.diagnostics.push(diagnostic("VEL3015", "'return' cannot leave a finally block; assign a result before finally and return afterward", statement.span));
    }
    const returnContext = this.host.returnContexts.at(-1);
    const expected = returnContext?.expected ?? unknownType;
    const inferredReturns = returnContext?.inferredReturns ?? null;
    const actual = statement.value ? this.host.inferExpression(statement.value, inferredReturns ? unknownType : expected) : nullType;
    // D51 rule 101: a return always leaves the scope that releases.
    if (statement.value) this.host.rejectOwnedResourceEscape(statement.value, "returning it", statement.value.span);
    const asynchronous = this.host.asynchronousFunctions.at(-1) === true;
    const returned = asynchronous ? this.host.resolvedAsyncResult(actual) : actual;
    if (asynchronous && statement.value) {
      if (inferredReturns || !this.host.promiseResolutionHazard(expected)) {
        this.host.reportPromiseResolutionHazard(returned, statement.value.span);
      }
      if (this.host.promiseResolutionNeedsRuntimeGuard(returned)) {
        this.host.lowering.asyncResolvedValues.add(spanIdentity(statement.value.span));
      }
    }
    if (inferredReturns) {
      // D85 rule 207: a body-inferred result has no annotation to settle
      // an empty collection, and the name that reads it can be in another
      // module — `export def make(): return []` publishes `List<unknown>`
      // across the interface. An annotated result is a contextual type and
      // settles the construction before it ever gets here. Rule 209: a
      // reported hole contributes `invalidType`, so the caller's
      // `const values: List<string> = make()` does not report the same
      // mistake a second time in a line that has no `[]` in it.
      const unsettled = statement.value !== null && this.host.requireSettledCollectionElement(statement.value, actual, false);
      if (returnContext) {
        // The hole reaches the result through whatever the author wrote
        // between it and the `return` — a name, a chain of them, or a call
        // to a local function whose own VEL4039 already reported. Each of
        // those is the same one mistake, so the convergence failure it
        // produces below is not a second problem to report.
        const causes = returnContext.resultHoleCauses ?? new Set<string>();
        const carried = statement.value !== null && this.host.collectResultHoleSources(statement.value, causes);
        if (causes.size > 0) returnContext.resultHoleCauses = causes;
        if (unsettled || carried) returnContext.unsettledResult = true;
      }
      if (this.host.unreachableDiagnosticDepth === 0) inferredReturns.push(unsettled ? invalidType : returned);
      return;
    }
    if (this.host.unreachableDiagnosticDepth === 0) returnContext?.observedReturns?.push(returned);
    this.host.requireAssignable(returned, expected, statement.value?.span ?? statement.span);
  }

  analyzeThrowStatement(statement: Extract<Statement, { kind: "ThrowStatement" }>): void {
    const thrown = this.host.inferExpression(statement.value);
    const throwable = (type: ValueType): boolean => type.kind === "class"
      ? this.host.isSubclassOf(type.identity ?? type.name, "Error")
      : type.kind === "union" && type.members.every(throwable);
    if (!throwable(thrown) && !isInvalidType(thrown)) {
      this.host.typeError(`Only Error values can be thrown, received ${describeType(thrown)}`, statement.value.span);
    }
  }

  analyzeAssertStatement(statement: Extract<Statement, { kind: "AssertStatement" }>): void {
    const condition = this.host.inferExpression(statement.condition);
    this.host.requireCondition(condition, statement.condition);
    if (statement.message) {
      const baseline = this.host.snapshotFlowFacts();
      this.host.analyzeIsolatedFlow(baseline, () => {
        const message = this.host.inferNarrowedExpression(
          statement.message!,
          this.host.negativeNarrowingFor(statement.condition, condition),
          stringType,
        );
        this.host.requireAssignable(message, stringType, statement.message!.span);
      });
    }
    this.host.persistNarrowings(this.host.narrowingFor(statement.condition, condition));
  }

  analyzeIfStatement(statement: Extract<Statement, { kind: "IfStatement" }>): void {
    const condition = this.host.inferExpression(statement.condition);
    this.host.requireCondition(condition, statement.condition);
    const truthy = this.host.narrowingFor(statement.condition, condition);
    const falsy = this.host.negativeNarrowingFor(statement.condition, condition);
    const baseline = this.host.snapshotFlowFacts();
    const continuingInvalidations: FlowFactInvalidations[] = [];
    let thenFacts: ReadonlyMap<string, ValueType> = new Map();
    const thenInvalidations = this.host.analyzeIsolatedFlow(baseline, () => {
      thenFacts = this.host.analyzeBlock(statement.thenBody, truthy);
    });
    // A branch ending in return/throw never rejoins this flow; a branch
    // ending in break/continue never reaches the statement after the if
    // either — its writes are carried to the enclosing loop's merge points
    // by the break/continue capture instead.
    const thenExits = this.host.blockAlwaysExits(statement.thenBody);
    if (!thenExits) continuingInvalidations.push(thenInvalidations);
    let elseFacts: ReadonlyMap<string, ValueType> = new Map();
    let elseExits = false;
    if (statement.elseBody) {
      const elseInvalidations = this.host.analyzeIsolatedFlow(baseline, () => {
        elseFacts = this.host.analyzeBlock(statement.elseBody!, falsy);
      });
      elseExits = this.host.blockAlwaysExits(statement.elseBody);
      if (!elseExits) continuingInvalidations.push(elseInvalidations);
    }
    this.host.applyFlowInvalidations(continuingInvalidations, !statement.elseBody);
    if (!statement.elseBody && thenExits) this.host.persistNarrowings(falsy);
    else if (statement.elseBody && thenExits && !elseExits) this.host.persistNarrowings(elseFacts);
    else if (statement.elseBody && elseExits && !thenExits) this.host.persistNarrowings(thenFacts);
    else if (statement.elseBody && !thenExits && !elseExits) {
      this.host.persistNarrowings(this.host.commonNarrowings([thenFacts, elseFacts]));
    }
  }

  analyzeTryStatement(statement: Extract<Statement, { kind: "TryStatement" }>): void {
    const baseline = this.host.snapshotFlowFacts();
    let tryFacts: ReadonlyMap<string, ValueType> = new Map();
    const tryInvalidations = this.host.analyzeIsolatedFlow(baseline, () => {
      tryFacts = this.host.analyzeBlock(statement.tryBody);
    });
    const continuingInvalidations: FlowFactInvalidations[][] = [];
    const continuingFacts: ReadonlyMap<string, ValueType>[] = [];
    if (!this.host.blockAlwaysReturns(statement.tryBody)) {
      continuingInvalidations.push([tryInvalidations]);
      continuingFacts.push(tryFacts);
    }

    let catchInvalidations: FlowFactInvalidations | null = null;
    if (statement.catchBody) {
      const catchBaseline = this.host.flowSnapshotAfterInvalidations(baseline, [tryInvalidations]);
      let catchFacts: ReadonlyMap<string, ValueType> = new Map();
      catchInvalidations = this.host.analyzeIsolatedFlow(catchBaseline, () => {
        const visible = this.host.visibleBindings();
        this.host.enterScope();
        try {
          if (statement.catchName) {
            this.host.declareBinding(statement.catchName, false, { kind: "class", name: "Error" }, statement.span);
          }
          this.host.analyzeStatements(statement.catchBody!);
          catchFacts = this.host.narrowingsForVisibleBindings(visible);
        } finally {
          this.host.exitScope();
        }
      });
      if (!this.host.blockAlwaysReturns(statement.catchBody)) {
        continuingInvalidations.push([tryInvalidations, catchInvalidations]);
        continuingFacts.push(catchFacts);
      }
    }

    if (statement.finallyBody) {
      const beforeFinally = this.host.flowSnapshotAfterInvalidations(
        baseline,
        catchInvalidations ? [tryInvalidations, catchInvalidations] : [tryInvalidations],
      );
      let finallyFacts: ReadonlyMap<string, ValueType> = new Map();
      const finallyInvalidations = this.host.analyzeIsolatedFlow(beforeFinally, () => {
        this.host.finallyLoopDepths.push(this.host.loopDepth);
        try {
          finallyFacts = this.host.analyzeBlock(statement.finallyBody!);
        } finally {
          this.host.finallyLoopDepths.pop();
        }
      });
      if (!this.host.blockAlwaysReturns(statement.finallyBody) && continuingFacts.length > 0) {
        this.host.restoreFlowFacts(beforeFinally);
        this.host.applyFlowInvalidations([finallyInvalidations]);
        this.host.persistNarrowings(finallyFacts);
      } else {
        this.host.restoreFlowFacts(baseline);
      }
    } else {
      this.host.restoreFlowFacts(baseline);
      this.host.applyFlowInvalidations(continuingInvalidations.flat());
      if (continuingFacts.length > 0) {
        this.host.persistNarrowings(this.host.commonNarrowings(continuingFacts));
      }
    }
  }

  analyzeExpressionStatement(statement: Extract<Statement, { kind: "ExpressionStatement" }>): void {
    // D39 item 51: a bare `try` statement is a swallow nobody can see. The
    // result has to be consumed; deliberately ignoring a failure is
    // try/catch, which says so.
    if (statement.expression.kind === "TryExpression") {
      this.host.diagnostics.push(diagnostic(
        "VEL4034",
        "A 'try' result must be consumed — bind it, test it, or supply a fallback with '??'; to run something and ignore its failure on purpose, use a try/catch block",
        statement.span,
      ));
      // One mistake, one diagnostic: the generic discarded-result message
      // would repeat this in weaker words.
      this.host.inferExpression(statement.expression);
      return;
    }
    const type = this.host.inferExpression(statement.expression);
    this.checkFloatingPromiseStatement(type, statement.expression);
    this.checkDiscardedExpressionResult(statement.expression, type);
    this.checkDiscardedPureResult(statement.expression);
  }

  // D32 item 30: a Promise-typed expression statement is a floating promise —
  // nothing waits for it and nothing owns its failure. The diagnostic teaches
  // both current spellings: 'await' waits, while 'detach' owns a detached task.
  private checkFloatingPromiseStatement(type: ValueType, expression: Expression): void {
    if (isInvalidType(type)) return;
    if (!this.carriesPromise(this.host.expandAliases(type))) return;
    const spelling = this.callSpelling(expression);
    this.host.diagnostics.push(diagnostic(
      "VEL4027",
      spelling
        ? `This call returns ${describeType(type)}; 'await ${spelling}' to wait for it, or 'detach ${spelling}' to run it detached`
        : `This expression is ${describeType(type)}; 'await' it to wait for it, or prefix it with 'detach' to run it detached`,
      expression.span,
    ));
  }

  // D30 item 17: the only general expression statements are shapes whose top
  // level may perform an effect. A call remains legal (D29 separately rejects
  // compiler-proven pure methods), and `await` owns asynchronous completion.
  // Every other result is a likely `=`/`==` typo, a Python docstring reflex,
  // or a value accidentally left on its own line.
  private checkDiscardedExpressionResult(expression: Expression, type: ValueType): void {
    if (isInvalidType(type) || this.carriesPromise(this.host.expandAliases(type))
      || expression.kind === "CallExpression" || expression.kind === "AssignmentExpression") return;
    if (expression.kind === "UnaryExpression" && expression.operator === "await") return;
    let message: string;
    if (expression.kind === "LiteralExpression" && typeof expression.value === "string") {
      message = "A bare string is not a docstring; use '//' for a comment, or use the string value";
    } else if (expression.kind === "ComparisonChainExpression"
      || expression.kind === "IsExpression"
      || (expression.kind === "BinaryExpression"
        && (expression.operator === "==" || expression.operator === "!=" || expression.operator === "<"
          || expression.operator === "<=" || expression.operator === ">" || expression.operator === ">="
          || expression.operator === "in" || expression.operator === "not in"))) {
      message = "This comparison result is discarded; use '=' to assign, or use the result";
    } else if (expression.kind === "UnaryExpression"
      && (expression.operator === "+" || expression.operator === "-")
      && expression.operand.kind === "UnaryExpression"
      && expression.operand.operator === expression.operator
      && expression.operand.operand.kind === "IdentifierExpression") {
      message = expression.operator === "+"
        ? `VelarScript has no '++' operator; write '${expression.operand.operand.name} += 1'`
        : `VelarScript has no '--' operator; write '${expression.operand.operand.name} -= 1'`;
    } else {
      message = "This expression result is discarded; call a function, assign the value, or use the result";
    }
    this.host.diagnostics.push(diagnostic("VEL4030", message, expression.span));
  }

  private carriesPromise(type: ValueType): boolean {
    if (type.kind === "promise") return true;
    if (type.kind === "optional") return this.carriesPromise(this.host.expandAliases(type.inner));
    if (type.kind === "union") return type.members.some((member) => this.carriesPromise(this.host.expandAliases(member)));
    return false;
  }

  // D29 item 14: an expression statement whose top level calls a
  // compiler-owned pure value/collection method throws its only product away.
  // The operation tables already prove which method the call lowered to, so
  // the check needs no user-function purity analysis.
  private checkDiscardedPureResult(expression: Expression): void {
    if (expression.kind !== "CallExpression") return;
    // D29 item 14's own rationale reaches `expect(...)` with no matcher:
    // building an expectation object and never asking it anything throws the
    // only product away, and the statement reads as an assertion that passes.
    // D30 item 17's general CallExpression exemption is untouched — a bare
    // call may perform an effect — because `testExpectOperands` already
    // proves this one call lowered to `test.expect`, which performs none.
    if (this.host.testExpectOperands.has(spanIdentity(expression.span))) {
      this.host.diagnostics.push(diagnostic(
        "VEL4030",
        "'expect(...)' builds an expectation and asserts nothing on its own; add a matcher such as '.toBe(expected)'",
        expression.span,
      ));
      return;
    }
    if (expression.callee.kind !== "MemberExpression") return;
    const collectionOperation = this.host.lowering.collectionCalls.get(expression.callee.span.end);
    const primitiveOperation = this.host.lowering.primitiveCalls.get(expression.callee.span.end);
    const pure = (collectionOperation !== undefined && discardedPureCollectionOperations.has(collectionOperation))
      || (primitiveOperation !== undefined && discardedPurePrimitiveOperations.has(primitiveOperation));
    if (!pure) return;
    this.host.diagnostics.push(diagnostic(
      "VEL4029",
      `'${expression.callee.property}' does not modify its receiver, so the result is discarded; keep the returned value or remove the call`,
      expression.span,
    ));
  }

  // Reconstructs a call spelling such as "boom()" or "user.save(...)" for the
  // floating-promise teaching message; complex callees use generic phrasing.
  private callSpelling(expression: Expression): string | null {
    if (expression.kind !== "CallExpression") return null;
    const path = (value: Expression): string | null => {
      if (value.kind === "IdentifierExpression") return value.name;
      if (value.kind === "MemberExpression") {
        const object = path(value.object);
        return object === null ? null : `${object}${value.optional ? "?." : "."}${value.property}`;
      }
      return null;
    };
    const callee = path(expression.callee);
    return callee === null ? null : `${callee}(${expression.arguments.length > 0 ? "..." : ""})`;
  }

  // D32 item 30: 'detach <expression>' runs detached, so only Promise<null>
  // may detach — a non-null resolved value would be lost silently, and a
  // non-Promise value has nothing to detach.
  analyzeDetachStatement(statement: DetachStatement): void {
    const type = this.host.inferExpression(statement.expression);
    if (isInvalidType(type)) return;
    const expanded = this.host.expandAliases(type);
    if (expanded.kind !== "promise") {
      this.host.diagnostics.push(diagnostic(
        "VEL4028",
        `'detach' requires a Promise<null> expression; this expression is ${describeType(type)}`,
        statement.expression.span,
      ));
      return;
    }
    const resolved = this.host.expandAliases(expanded.value);
    if (resolved.kind === "null" || isInvalidType(resolved)) return;
    this.host.diagnostics.push(diagnostic(
      "VEL4028",
      "The result would be lost; await it, or discard it explicitly in an async def",
      statement.expression.span,
    ));
  }

  /**
   * D39 item 53: `test "name":` is one test. Its body is an async frame — a
   * test awaits its own work — and its name is the product specification a
   * person reads, so it must be present, unique in the module, and declared
   * where the runner actually looks.
   */
  analyzeTestDeclaration(statement: TestDeclaration): void {
    if (!this.host.inModuleInitializationPosition() || this.host.scopes.length !== 1) {
      this.host.diagnostics.push(diagnostic("VEL3019", "A test is declared at module top level", statement.span));
    } else if (!(this.host.modulePath ?? "").endsWith(".test.vel")) {
      this.host.diagnostics.push(diagnostic(
        "VEL3019",
        "Tests live in a '*.test.vel' module, which is where the runner looks; move this test beside the code it specifies",
        statement.span,
      ));
    }
    if (statement.title.trim() === "") {
      this.host.diagnostics.push(diagnostic("VEL3019", "A test name states what the code must do; this one is empty", statement.titleSpan));
    } else if (this.host.declaredTestTitles.has(statement.title)) {
      this.host.diagnostics.push(diagnostic(
        "VEL3019",
        `This module already declares a test named ${JSON.stringify(statement.title)}; a report has to be able to name one failing test`,
        statement.titleSpan,
      ));
    }
    this.host.declaredTestTitles.add(statement.title);

    this.host.enterScope();
    this.host.flowFrameDepth += 1;
    this.host.functionDepth += 1;
    const previousLoopDepth = this.host.loopDepth;
    this.host.loopDepth = 0;
    const previousFinallyLoopDepths = this.host.finallyLoopDepths;
    this.host.finallyLoopDepths = [];
    this.host.asynchronousFunctions.push(true);
    this.host.returnContexts.push({ expected: nullType, inferredReturns: null, observedReturns: null, declarationKind: "Function" });
    this.host.analyzeStatements(statement.body);
    this.host.returnContexts.pop();
    this.host.asynchronousFunctions.pop();
    this.host.loopDepth = previousLoopDepth;
    this.host.finallyLoopDepths = previousFinallyLoopDepths;
    this.host.functionDepth -= 1;
    this.host.flowFrameDepth -= 1;
    this.host.exitScope();
  }
}
