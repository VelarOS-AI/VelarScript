/**
 * `for` and `while`, and the `break`/`continue` that leave them: the loop
 * slots' types, the back-edge pass each body earns, and what a loop's exit
 * still knows.
 *
 * D114 R1f: the loop statement forms leave `analyzer.ts`. The back-edge
 * machinery itself already lives in `flow/loops.ts`; what moves here is the
 * statement analysis that pushes a context onto it, so the two halves of a
 * loop — its flow bookkeeping and its syntax — each have one home.
 */
import { type BindingPattern, type Expression, type ForStatement, type Statement } from "../../ast.ts";
import { type CollectionRuntimeKind } from "../../contracts.ts";
import { type PermanentNamespaceName } from "../../core-vocabulary.ts";
import { diagnostic, type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";
import { spanIdentity, type Span } from "../../source.ts";
import {
  binaryStorageKind,
  describeType,
  numberType,
  stringType,
  unknownType,
  type ValueType,
} from "../../types.ts";
import { type FlowFactInvalidations, type FlowFactsSnapshot } from "../flow/facts.ts";
import { type LoopBackEdgeOutcome, type LoopFlowContext } from "../flow/loops.ts";
import { type PendingScopeDeclaration, type VisibleScopeDepth } from "../scopes.ts";

/** The lowering facts a loop records for the emitter. */
export interface LoopLoweringFacts {
  readonly asyncForStatements: Set<number>;
  readonly builtinValueReferences: Map<string, PermanentNamespaceName | "range">;
  readonly collectionIterations: Map<number, CollectionRuntimeKind | "string" | "binary">;
  readonly nativeRangeForStatements: Set<number>;
}

/**
 * Everything the loop statements ask of the analyzer that hosts them, and
 * nothing more. The walk state a loop moves — the loop depth, the scope stack's
 * pending declarations, the contexts the back-edge pass reads — arrives as live
 * accessors, because a loop body is analyzed while all three are being written.
 */
export interface LoopStatementsHost {
  adviseSwappedLoopSlots(statement: ForStatement, iterable: ValueType): void;
  analyzeBlock(statements: readonly Statement[], narrowed?: ReadonlyMap<string, ValueType>): ReadonlyMap<string, ValueType>;
  analyzeIsolatedFlow(snapshot: FlowFactsSnapshot, analyze: () => void): FlowFactInvalidations;
  analyzeStatements(statements: readonly Statement[]): void;
  applyFlowInvalidations(branches: readonly FlowFactInvalidations[], includeBaseline?: boolean): void;
  readonly asynchronousFunctions: boolean[];
  asyncPullElementType(source: ValueType, sourceSpan: Span, statementStart: number): ValueType;
  blockAlwaysExits(statements: readonly Statement[]): boolean;
  blockAlwaysReturns(statements: readonly Statement[]): boolean;
  clearCachedFlowTypesInSpan(sourceSpan: Span): void;
  collectPatternNames(pattern: BindingPattern, add: (name: string) => void): void;
  commonNarrowings(branches: readonly ReadonlyMap<string, ValueType>[]): ReadonlyMap<string, ValueType>;
  readonly constructorDepth: number;
  declarePattern(pattern: BindingPattern, mutable: boolean, type: ValueType, declaredType?: ValueType): void;
  readonly diagnostics: Diagnostic[];
  enterScope(): void;
  exitScope(): void;
  readonly finallyLoopDepths: number[];
  flowInvalidationsSince(snapshot: FlowFactsSnapshot): FlowFactInvalidations;
  readonly functionDepth: number;
  inferAnnotationFreeHead(expression: Expression): ValueType;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  invalidExtensionAwaitContext(): boolean;
  invalidExtensionAwaitMessage(): string | null;
  iterationGuidance(type: ValueType): string;
  iterationSource(expression: Expression, type: ValueType): ValueType;
  joinedNarrowings(left: ReadonlyMap<string, ValueType>, right: ReadonlyMap<string, ValueType>): ReadonlyMap<string, ValueType>;
  readonly loopCaptureFloor: number;
  readonly loopContexts: LoopFlowContext[];
  loopDepth: number;
  readonly lowering: LoopLoweringFacts;
  narrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType>;
  narrowingsForVisibleBindings(visible: VisibleScopeDepth): ReadonlyMap<string, ValueType>;
  negativeNarrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType>;
  readonly nonFallthroughWhileStatements: Set<number>;
  readonly pendingScopeDeclarations: Map<string, PendingScopeDeclaration>[];
  persistNarrowings(narrowed: ReadonlyMap<string, ValueType>): void;
  readonlyDataViewOf(type: ValueType): ValueType;
  reanalyzeLoopBackEdge(
    baseline: FlowFactsSnapshot,
    visible: VisibleScopeDepth,
    backEdges: readonly FlowFactInvalidations[],
    body: readonly Statement[],
    diagnosticStart: number,
    analyze: () => void,
  ): LoopBackEdgeOutcome;
  requireCondition(type: ValueType, condition: Expression): void;
  snapshotFlowFacts(): FlowFactsSnapshot;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  validateKnownBindingShape(pattern: BindingPattern, value: Expression): void;
  visibleBindings(): VisibleScopeDepth;
}

export class LoopStatements {
  private readonly host: LoopStatementsHost;

  constructor(host: LoopStatementsHost) {
    this.host = host;
  }

  analyzeForStatement(statement: Extract<Statement, { kind: "ForStatement" }>): void {
    // The emitted loop head evaluates the iterable inside the loop
    // binding's temporal dead zone, so an iterable reference to a name
    // the pattern declares cannot reach the outer binding the analyzer
    // resolves. The names are pending only while the iterable is
    // inferred: the loop binding owns its name in the loop head and
    // body alone, so earlier statements of the same scope still read
    // the outer binding.
    const pendingLoopNames: string[] = [];
    {
      const pending = this.host.pendingScopeDeclarations.at(-1)!;
      for (const pattern of [statement.pattern, statement.secondPattern]) {
        if (!pattern) continue;
        this.host.collectPatternNames(pattern, (name) => {
          if (!pending.has(name)) {
            pending.set(name, { span: pattern.span, loopHead: true });
            pendingLoopNames.push(name);
          }
        });
      }
    }
    const inferredIterable = this.host.inferAnnotationFreeHead(statement.iterable);
    if (!statement.asynchronous
      && statement.secondPattern === null
      && statement.pattern.kind === "NameBindingPattern"
      && statement.iterable.kind === "CallExpression"
      && statement.iterable.callee.kind === "IdentifierExpression"
      && this.host.lowering.builtinValueReferences.get(spanIdentity(statement.iterable.callee.span)) === "range") {
      this.host.lowering.nativeRangeForStatements.add(statement.span.start);
    }
    // D68 rule 177 + D90 R18: the eight plain consumers project through
    // the synchronous `@iterate:` answer; `async for` reads the
    // asynchronous form's declaration inside asyncPullElementType, so the
    // asynchronous side takes the operand unprojected.
    const iterable = statement.asynchronous ? inferredIterable : this.host.iterationSource(statement.iterable, inferredIterable);
    const binaryIterable = !statement.asynchronous && binaryStorageKind(iterable) !== null;
    if (!statement.asynchronous
      && (iterable.kind === "list" || iterable.kind === "map" || iterable.kind === "set" || iterable.kind === "record" || iterable.kind === "string")) {
      this.host.lowering.collectionIterations.set(statement.span.start, iterable.kind);
    } else if (binaryIterable) {
      this.host.lowering.collectionIterations.set(statement.span.start, "binary");
    }
    for (const name of pendingLoopNames) this.host.pendingScopeDeclarations.at(-1)!.delete(name);
    const { first, second } = this.loopSlotTypes(statement, iterable, binaryIterable);
    if (!statement.asynchronous) this.host.adviseSwappedLoopSlots(statement, iterable);
    const baseline = this.host.snapshotFlowFacts();
    this.host.loopContexts.push({ baseline, visible: this.host.visibleBindings(), carried: [], backEdges: [], breakFacts: [], sawBreak: false });
    const diagnosticStart = this.host.diagnostics.length;
    const bodyInvalidations = this.host.analyzeIsolatedFlow(baseline, () => {
      this.host.enterScope();
      try {
        this.host.declarePattern(statement.pattern, false, first);
        if (statement.secondPattern) this.host.declarePattern(statement.secondPattern, false, second);
        if (!statement.asynchronous && statement.iterable.kind === "ListExpression"
          && statement.iterable.elements.every((item) => item.kind !== "SpreadExpression")) {
          for (const item of statement.iterable.elements) {
            this.host.validateKnownBindingShape(statement.pattern, item);
          }
        }
        this.host.loopDepth += 1;
        this.host.analyzeStatements(statement.body);
        this.host.loopDepth -= 1;
      } finally {
        this.host.exitScope();
      }
    });
    const loopFlow = this.host.loopContexts.pop()!;
    const backEdges = [
      ...(!this.host.blockAlwaysExits(statement.body) ? [bodyInvalidations] : []),
      ...loopFlow.backEdges,
    ];
    this.host.reanalyzeLoopBackEdge(baseline, loopFlow.visible, backEdges, statement.body, diagnosticStart, () => {
      this.host.enterScope();
      try {
        this.host.declarePattern(statement.pattern, false, first);
        if (statement.secondPattern) this.host.declarePattern(statement.secondPattern, false, second);
        if (!statement.asynchronous && statement.iterable.kind === "ListExpression"
          && statement.iterable.elements.every((item) => item.kind !== "SpreadExpression")) {
          for (const item of statement.iterable.elements) {
            this.host.validateKnownBindingShape(statement.pattern, item);
          }
        }
        this.host.loopDepth += 1;
        this.host.analyzeStatements(statement.body);
        this.host.loopDepth -= 1;
      } finally {
        this.host.exitScope();
      }
    });
    if (this.host.blockAlwaysReturns(statement.body)) this.host.applyFlowInvalidations(loopFlow.carried);
    else this.host.applyFlowInvalidations([bodyInvalidations, ...loopFlow.carried]);
  }

  /**
   * What the two `for` slots hold: `value, index` for the synchronous forms, and
   * the pulled element with its ordinal for `async for`.
   */
  private loopSlotTypes(
    statement: Extract<Statement, { kind: "ForStatement" }>,
    iterable: ValueType,
    binaryIterable: boolean,
  ): { readonly first: ValueType; readonly second: ValueType } {
    let first: ValueType;
    let second: ValueType;
    if (statement.asynchronous) {
      const invalidConstructorAwait = this.host.constructorDepth > 0;
      const invalidFunctionAwait = this.host.functionDepth > 0 && !this.host.asynchronousFunctions.at(-1);
      const invalidExtensionAwait = this.host.functionDepth === 0 && this.host.invalidExtensionAwaitContext();
      if (invalidConstructorAwait || invalidFunctionAwait || invalidExtensionAwait) {
        this.host.diagnostics.push(diagnostic(
          "VEL4007",
          invalidConstructorAwait
            ? "'async for' cannot be used directly in a constructor"
            : invalidExtensionAwait
            ? this.host.invalidExtensionAwaitMessage() ?? "'async for' is not valid in this synchronous extension context"
            : "'async for' can only be used in an async function or at module scope",
          statement.span,
        ));
      }
      first = this.host.asyncPullElementType(iterable, statement.iterable.span, statement.span.start);
      second = numberType;
      this.host.lowering.asyncForStatements.add(statement.span.start);
    } else {
      first = binaryIterable ? numberType
        : iterable.kind === "list" || iterable.kind === "set"
        ? iterable.readonlyView ? this.host.readonlyDataViewOf(iterable.element) : iterable.element
        : iterable.kind === "map" ? iterable.readonlyView ? this.host.readonlyDataViewOf(iterable.key) : iterable.key
          : iterable.kind === "record" || iterable.kind === "string" ? stringType : unknownType;
      second = binaryIterable ? numberType
        : iterable.kind === "map" || iterable.kind === "record"
        ? iterable.readonlyView ? this.host.readonlyDataViewOf(iterable.value) : iterable.value
        : iterable.kind === "list" || iterable.kind === "set" || iterable.kind === "string" ? numberType
          : unknownType;
      if (!binaryIterable && iterable.kind !== "list" && iterable.kind !== "set" && iterable.kind !== "map" && iterable.kind !== "record" && iterable.kind !== "string" && iterable.kind !== "any") {
        this.host.typeError(iterable.kind === "enumObject"
          ? `Cannot iterate over the enum itself; ${iterable.name}.values() returns the members as a List — for member in ${iterable.name}.values():`
          : `Cannot iterate over ${describeType(iterable)}${this.host.iterationGuidance(iterable)}`, statement.iterable.span);
      }
    }
    return { first, second };
  }

  analyzeWhileStatement(statement: Extract<Statement, { kind: "WhileStatement" }>): void {
    const condition = this.host.inferExpression(statement.condition);
    this.host.requireCondition(condition, statement.condition);
    const truthy = this.host.narrowingFor(statement.condition, condition);
    const falsy = this.host.negativeNarrowingFor(statement.condition, condition);
    const baseline = this.host.snapshotFlowFacts();
    this.host.loopContexts.push({ baseline, visible: this.host.visibleBindings(), carried: [], backEdges: [], breakFacts: [], sawBreak: false });
    const diagnosticStart = this.host.diagnostics.length;
    const bodyInvalidations = this.host.analyzeIsolatedFlow(baseline, () => {
      this.host.loopDepth += 1;
      this.host.analyzeBlock(statement.body, truthy);
      this.host.loopDepth -= 1;
    });
    const loopFlow = this.host.loopContexts.pop()!;
    const backEdges = [
      ...(!this.host.blockAlwaysExits(statement.body) ? [bodyInvalidations] : []),
      ...loopFlow.backEdges,
    ];
    // FLW-S1: a loop the body can re-enter tests its condition again in
    // the back-edge state, so the exit fact is what both tests agree on.
    let repeatedFalsy: ReadonlyMap<string, ValueType> | null = null;
    const backEdgePass = this.host.reanalyzeLoopBackEdge(baseline, loopFlow.visible, backEdges, statement.body, diagnosticStart, () => {
      this.host.clearCachedFlowTypesInSpan(statement.condition.span);
      const repeatedCondition = this.host.inferExpression(statement.condition);
      this.host.requireCondition(repeatedCondition, statement.condition);
      const repeatedTruthy = this.host.narrowingFor(statement.condition, repeatedCondition);
      repeatedFalsy = this.host.negativeNarrowingFor(statement.condition, repeatedCondition);
      this.host.loopDepth += 1;
      this.host.analyzeBlock(statement.body, repeatedTruthy);
      this.host.loopDepth -= 1;
    });
    if (statement.condition.kind === "LiteralExpression"
      && statement.condition.value === true
      && !loopFlow.sawBreak) {
      this.host.nonFallthroughWhileStatements.add(statement.span.start);
    }
    if (this.host.blockAlwaysReturns(statement.body)) {
      // The loop can only be left through a captured break/continue arm or
      // by the condition failing, so only the carried writes escape it.
      this.host.applyFlowInvalidations(loopFlow.carried);
    } else {
      this.host.applyFlowInvalidations([bodyInvalidations, ...loopFlow.carried]);
    }
    // FLW-S1 (charter section 9): without a break the only way out is the
    // condition failing, so its negated fact holds after the loop — for
    // the common body that neither returns nor breaks, not just the body
    // that always returns. A break can leave while the condition still
    // holds, so one break drops the fact entirely.
    if (!loopFlow.sawBreak) {
      // A widened exit confirmed nothing about the back edge, so it keeps
      // nothing: the condition's fact holds only if the second test agrees.
      this.host.persistNarrowings(backEdgePass.widened
        ? new Map()
        : repeatedFalsy === null ? falsy : this.host.joinedNarrowings(falsy, repeatedFalsy));
    } else if (statement.condition.kind === "LiteralExpression" && statement.condition.value === true) {
      // FLW-N6: `while true:` has no failing condition, so its breaks are
      // its only exits, and what every one of them proves holds after the
      // loop. A loop whose condition can also fail keeps nothing: that
      // exit proves none of it.
      const breakFacts = [...loopFlow.breakFacts, ...(backEdgePass.repeated?.breakFacts ?? [])];
      if (breakFacts.length > 0 && !backEdgePass.widened) this.host.persistNarrowings(this.host.commonNarrowings(breakFacts));
    }
  }

  analyzeBreakStatement(statement: Extract<Statement, { kind: "BreakStatement" }> | Extract<Statement, { kind: "ContinueStatement" }>): void {
    if (this.host.loopDepth === 0) {
      this.host.diagnostics.push(diagnostic("VEL3005", `'${statement.kind === "BreakStatement" ? "break" : "continue"}' can only be used in a loop`, statement.span));
    } else if (this.host.finallyLoopDepths.some((depth) => this.host.loopDepth <= depth)) {
      this.host.diagnostics.push(diagnostic("VEL3015", `'${statement.kind === "BreakStatement" ? "break" : "continue"}' cannot leave a finally block`, statement.span));
    } else {
      const context = this.host.loopContexts.at(-1);
      if (context && this.host.loopContexts.length > this.host.loopCaptureFloor) {
        const invalidations = this.host.flowInvalidationsSince(context.baseline);
        context.carried.push(invalidations);
        if (statement.kind === "ContinueStatement") context.backEdges.push(invalidations);
        if (statement.kind === "BreakStatement") {
          context.sawBreak = true;
          // FLW-N6: this break is one of the loop's exits, so record what
          // it proves. The merge after the loop keeps only what every
          // exit agrees on.
          context.breakFacts.push(this.host.narrowingsForVisibleBindings(context.visible));
        }
      }
    }
  }
}
