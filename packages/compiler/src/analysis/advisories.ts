/**
 * The A roster: the advisory proofs that report a Python/JavaScript reflex or a
 * longer spelling of a compiler-owned canonical form. AGENTS.md's table names
 * each one; the proof for each lives here.
 *
 * D114 R1a: these were 20 private methods on `Analyzer`, interleaved with the
 * inference they run beside. They are one cohesive thing — the roster reports
 * and never decides — so they live in one collaborator the analyzer owns as
 * `this.advisoryRoster`. What each proof needs back from the analyzer is
 * declared here as `AdvisoryHost`: that interface is the exact record of this
 * roster's dependency on the analyzer, and nothing widens it silently.
 *
 * The sink stays with the analyzer. `advise` deduplicates by code and span
 * (loop back-edge re-analysis runs a body twice), `advisedIdentities` is its
 * cursor, and `advisories` is the array `analyzedAdvisories()` publishes — all
 * three are the analyzer's, and this roster reaches them only through
 * `AdvisoryHost.advise`.
 *
 * A8 (`adviseManualListQuery`) is not here. Its proof reads the analyzer's live
 * walk depths — `functionDepth`, `constructorDepth`, `finallyLoopDepths` — to
 * know it is inside a function body and not inside a `finally`. That is
 * inference state read mid-flight, so the proof stays where the state is.
 */
import { type BindingPattern, type Expression, type ForStatement, type Statement } from "../ast.ts";
import { type CollectionOperation, type RecordFromHint } from "../contracts.ts";
import { mechanicalEdits, type DiagnosticFix } from "../diagnostic.ts";
import { span, spanIdentity, type Span } from "../source.ts";
import { boolType, describeType, sameType, type ValueType } from "../types.ts";

/** The part of a resolved binding the proofs read. */
export interface AdvisoryBinding {
  readonly type: ValueType;
  readonly storageType: ValueType;
  readonly span: Span;
}

/** The record shape `Target.from` / `Target.mapFrom` projections are proved against. */
export interface AdvisoryRecordShape {
  readonly fields: ReadonlyMap<string, ValueType>;
  readonly optionalFields: ReadonlySet<string>;
  readonly readonlyFields: ReadonlySet<string>;
  readonly readonlyView: boolean;
}

/**
 * The one analysis-extension hook the roster calls (A13). Declared structurally
 * rather than imported: `CompilerAnalysisExtension` lives in `extension.ts`,
 * which imports the analyzer, and naming it here would put this module back
 * inside the five-module import ring `contracts.ts` was extracted to shrink.
 * `CompilerAnalysisExtension` satisfies this shape.
 */
export interface CanonicalCollectionProjectionExtension {
  readonly canonicalCollectionProjection?: (
    expression: Expression,
    pure: (expression: Expression) => boolean,
  ) => boolean | undefined;
}

/** The lowering facts a proof consults before claiming a call is compiler-owned. */
export interface AdvisoryLoweringFacts {
  readonly collectionCalls: ReadonlyMap<number, CollectionOperation>;
  readonly recordFromCalls: ReadonlyMap<string, RecordFromHint>;
  expressionUsesRuntimeNarrowing(expression: Expression): boolean;
}

/**
 * Everything the roster asks of the analyzer that hosts it, and nothing more.
 */
export interface AdvisoryHost {
  /** The module source: quoted in a message, and read to withhold a comment-erasing fix. */
  readonly sourceText: string;
  /** Asked whether a target extension owns an expression form the pipeline proof met (A13). */
  readonly analysisExtensions: readonly CanonicalCollectionProjectionExtension[];
  /** Searched for the name a projected record type is written as (A9/A10). */
  readonly typeAliases: ReadonlyMap<string, ValueType>;
  /** What the emitter will lower a call to, when a proof needs the call to be compiler-owned. */
  readonly lowering: AdvisoryLoweringFacts;
  advise(code: string, message: string, adviceSpan: Span, fix?: DiagnosticFix): void;
  expandAliases(type: ValueType): ValueType;
  inferredExpressionType(expression: Expression): ValueType;
  lookup(name: string): AdvisoryBinding | null;
  collectPatternNames(pattern: BindingPattern, add: (name: string) => void): void;
  commentPreservingMechanicalFix(rewriteSpan: Span, replacement: string, title: string): DiagnosticFix | undefined;
  canonicalCollectionMemberReadIsStable(expression: Extract<Expression, { kind: "MemberExpression" }>): boolean;
  recordProjectionShape(type: ValueType): AdvisoryRecordShape | null;
  stableDataMember(objectExpression: Expression, property: string): boolean;
}

// D89 A2's two rosters. They are deliberately short: every name here is one a
// Python author reaches for without thinking, and a name that has to be argued
// for is a name the advisory would be guessing about.
const loopIndexSlotNames = new Set(["i", "idx", "index", "pos", "position"]);
const loopValueSlotNames = new Set(["v", "value", "item", "el", "element"]);

/**
 * The singular of the iterated collection's own name, so `for i, user in
 * users` reads as the same swap as `for i, v in users`. Only a plain name is
 * read; an arbitrary expression has no name to make singular.
 */
function singularIterableName(iterable: Expression): string | null {
  const name = iterable.kind === "IdentifierExpression" ? iterable.name
    : iterable.kind === "MemberExpression" ? iterable.property
      : null;
  if (name === null || !name.endsWith("s") || name.endsWith("ss")) return null;
  if (name.endsWith("ies")) return `${name.slice(0, -3)}y`;
  if (/(?:ch|sh|[sxz])es$/u.test(name)) return name.slice(0, -2);
  return name.slice(0, -1);
}

export class Advisories {
  private readonly host: AdvisoryHost;

  constructor(host: AdvisoryHost) {
    this.host = host;
  }

  /**
   * D89 A2: the two-slot `for` over a List, Set, or string binds
   * `value, index`, which matches JavaScript's `forEach((v, i) => …)` and
   * inverts Python's `enumerate`. Python's own spelling is already a loud
   * error, so nothing silent comes from it; the silence happens when a model
   * writes `for i, v in nums`, a hybrid neither language has, and both names
   * quietly hold the other one's value.
   *
   * Both rosters must hit. One name alone proves nothing — `for index, total
   * in scores` may be counting exactly what it says — and a wrong guess here
   * would tell a correct author to break working code. The value slot also
   * accepts the singular of the collection's own name, because `for i, user
   * in users` is the same reflex spelled from the data instead of a letter.
   */
  adviseSwappedLoopSlots(statement: ForStatement, iterable: ValueType): void {
    if (iterable.kind !== "list" && iterable.kind !== "set" && iterable.kind !== "string") return;
    const indexSlot = statement.pattern;
    const valueSlot = statement.secondPattern;
    if (indexSlot.kind !== "NameBindingPattern" || valueSlot?.kind !== "NameBindingPattern") return;
    if (!loopIndexSlotNames.has(indexSlot.name)) return;
    if (!loopValueSlotNames.has(valueSlot.name) && valueSlot.name !== singularIterableName(statement.iterable)) return;
    this.host.advise(
      "A2",
      `A two-slot 'for' binds 'value, index', so '${indexSlot.name}' receives the element and '${valueSlot.name}' receives the position; write 'for ${valueSlot.name}, ${indexSlot.name} in ...' to bind them the way the names read`,
      span(indexSlot.span.start, valueSlot.span.end),
      mechanicalEdits(
        [{ span: indexSlot.span, text: valueSlot.name }, { span: valueSlot.span, text: indexSlot.name }],
        `Swap '${indexSlot.name}' and '${valueSlot.name}'`,
      ),
    );
  }

  /**
   * A7: an adjacent empty collection plus an identity-only copy loop has one
   * compiler-owned spelling. Unlike A1-A6 this is not a foreign-language
   * spelling with different semantics; it is the deliberately narrow
   * canonicalization exception admitted after those advisories. The trigger
   * proves the replacement is the same fresh collection in the same order:
   *
   *     const result: List<string> = []
   *     for value in values:
   *         result.append(value)
   *
   * becomes an initialization from `values.values()`. Any intervening
   * statement, non-name source, transform, filter, second body statement, or
   * non-empty destination withholds the advisory. Those shapes need judgment,
   * and a canonicalization warning that guesses is only lint noise.
   */
  adviseManualCollectionConversion(previous: Statement | null, statement: Statement): void {
    if (previous?.kind !== "VariableDeclaration" || statement.kind !== "ForStatement") return;
    if (statement.asynchronous || previous.pattern.kind !== "NameBindingPattern") return;
    if (statement.iterable.kind !== "IdentifierExpression") return;

    const targetName = previous.pattern.name;
    if (statement.iterable.name === targetName) return;
    let shadowsTarget = false;
    this.host.collectPatternNames(statement.pattern, (name) => { if (name === targetName) shadowsTarget = true; });
    if (statement.secondPattern) this.host.collectPatternNames(statement.secondPattern, (name) => { if (name === targetName) shadowsTarget = true; });
    if (shadowsTarget) return;
    const targetBinding = this.host.lookup(targetName);
    if (!targetBinding || targetBinding.span.start !== previous.pattern.span.start || targetBinding.span.end !== previous.pattern.span.end) return;
    const target = this.host.expandAliases(targetBinding.storageType);
    if (!this.isEmptyCollectionInitializer(previous.initializer, target.kind)) return;

    if (statement.body.length !== 1 || statement.body[0]!.kind !== "ExpressionStatement") return;
    const call = statement.body[0]!.expression;
    if (call.kind !== "CallExpression" || call.optional || call.callee.kind !== "MemberExpression" || call.callee.optional) return;
    if (call.callee.object.kind !== "IdentifierExpression" || call.callee.object.name !== targetName) return;

    const source = this.host.expandAliases(this.host.inferredExpressionType(statement.iterable));
    const operation = this.host.lowering.collectionCalls.get(call.callee.span.end);
    const replacement = this.manualCollectionReplacement(target.kind, source.kind, operation, call, statement, statement.iterable.name);
    if (replacement === null) return;

    this.host.advise(
      "A7",
      `This empty ${describeType(target)} is filled only by copying '${statement.iterable.name}' in iteration order; '${replacement}' already creates the same fresh ${describeType(target)}. Initialize '${targetName}' with '${replacement}' instead of writing this loop`,
      statement.iterable.span,
      this.host.commentPreservingMechanicalFix(
        span(previous.initializer.span.start, statement.span.end),
        replacement,
        `Initialize '${targetName}' with '${replacement}'`,
      ),
    );
  }

  private isEmptyCollectionInitializer(initializer: Expression, targetKind: ValueType["kind"]): boolean {
    if (targetKind === "list") return initializer.kind === "ListExpression" && initializer.elements.length === 0;
    if (targetKind !== "set" && targetKind !== "map") return false;
    return initializer.kind === "CallExpression"
      && !initializer.optional
      && initializer.arguments.length === 0
      && initializer.callee.kind === "IdentifierExpression"
      && initializer.callee.name === (targetKind === "set" ? "Set" : "Map");
  }

  private manualCollectionReplacement(
    targetKind: ValueType["kind"],
    sourceKind: ValueType["kind"],
    operation: CollectionOperation | undefined,
    call: Extract<Expression, { kind: "CallExpression" }>,
    loop: ForStatement,
    sourceName: string,
  ): string | null {
    if (targetKind === "list" && operation === "listAppend") {
      const [value] = this.orderedDirectCallArguments(call, ["value"]);
      const slot = value ? this.manualCollectionLoopSlot(loop, value) : null;
      if (slot === null) return null;
      if (sourceKind === "list" && slot === "first") return `${sourceName}.copy()`;
      if (sourceKind === "set" && slot === "first") return `${sourceName}.values()`;
      if ((sourceKind === "map" || sourceKind === "record") && slot === "first") return `${sourceName}.keys()`;
      if ((sourceKind === "map" || sourceKind === "record") && slot === "second") return `${sourceName}.values()`;
      return null;
    }

    if (targetKind === "set" && operation === "setAdd") {
      const [value] = this.orderedDirectCallArguments(call, ["value"]);
      const slot = value ? this.manualCollectionLoopSlot(loop, value) : null;
      if (slot === null) return null;
      if (sourceKind === "list" && slot === "first") return `Set(${sourceName})`;
      if (sourceKind === "set" && slot === "first") return `${sourceName}.copy()`;
      if ((sourceKind === "map" || sourceKind === "record") && slot === "first") return `Set(${sourceName}.keys())`;
      if ((sourceKind === "map" || sourceKind === "record") && slot === "second") return `Set(${sourceName}.values())`;
      return null;
    }

    if (targetKind === "map" && operation === "mapSet" && (sourceKind === "map" || sourceKind === "record")) {
      const [key, value] = this.orderedDirectCallArguments(call, ["key", "value"]);
      if (!key || !value || this.manualCollectionLoopSlot(loop, key) !== "first" || this.manualCollectionLoopSlot(loop, value) !== "second") return null;
      return sourceKind === "map" ? `${sourceName}.copy()` : `Map(${sourceName})`;
    }

    return null;
  }

  private orderedDirectCallArguments(
    call: Extract<Expression, { kind: "CallExpression" }>,
    parameterNames: readonly string[],
  ): readonly (Expression | null)[] {
    if (call.arguments.length !== parameterNames.length || call.arguments.some((argument) => argument.kind === "SpreadExpression")) {
      return parameterNames.map(() => null);
    }
    const ordered: (Expression | null)[] = parameterNames.map(() => null);
    let positional = 0;
    for (const [index, argument] of call.arguments.entries()) {
      const named = call.argumentNames?.[index] ?? null;
      const target = named === null ? positional++ : parameterNames.indexOf(named);
      if (target < 0 || target >= ordered.length || ordered[target] !== null) return parameterNames.map(() => null);
      ordered[target] = argument;
    }
    return ordered;
  }

  private manualCollectionLoopSlot(loop: ForStatement, expression: Expression): "first" | "second" | null {
    if (expression.kind !== "IdentifierExpression") return null;
    if (loop.pattern.kind === "NameBindingPattern" && expression.name === loop.pattern.name) return "first";
    if (loop.secondPattern?.kind === "NameBindingPattern" && expression.name === loop.secondPattern.name) return "second";
    return null;
  }

  /**
   * A13: a fresh List filled by one pure projection, with an optional pure
   * guard, is the expanded form of List.map or List.filter(...).map(...).
   *
   * This stays deliberately narrower than a general loop-style lint. List
   * pipelines snapshot their input while a `for` observes live growth, so the
   * proof accepts only stable List data, stable data reads/operators, and the
   * compiler-owned pure `Type.from(value)` projection. Calls, getters, index
   * reads, writes, a second body statement, two-slot loops, and reads from the
   * destination keep the loop silent.
  */
  adviseManualListPipeline(previous: Statement | null, statement: Statement): void {
    if (previous?.kind !== "VariableDeclaration" || statement.kind !== "ForStatement") return;
    if (statement.asynchronous || statement.pattern.kind !== "NameBindingPattern") return;
    if (statement.secondPattern !== null && statement.secondPattern.kind !== "NameBindingPattern") return;
    if (previous.pattern.kind !== "NameBindingPattern") return;

    const targetName = previous.pattern.name;
    const itemName = statement.pattern.name;
    const indexName = statement.secondPattern?.name ?? null;
    if (itemName === targetName) return;
    if (indexName === targetName || indexName === itemName) return;
    const targetBinding = this.host.lookup(targetName);
    if (!targetBinding || targetBinding.span.start !== previous.pattern.span.start || targetBinding.span.end !== previous.pattern.span.end) return;
    const target = this.host.expandAliases(targetBinding.storageType);
    if (target.kind !== "list" || !this.isEmptyCollectionInitializer(previous.initializer, "list")) return;

    const source = this.host.expandAliases(this.host.inferredExpressionType(statement.iterable));
    if (source.kind !== "list") return;
    const sourceSpelling = this.manualListPipelineSourceSpelling(statement.iterable, targetName);
    if (sourceSpelling === null) return;

    let predicate: string | null = null;
    let appendStatement: Statement | null = statement.body[0] ?? null;
    if (statement.body.length !== 1) return;
    if (appendStatement?.kind === "IfStatement") {
      // Filtering changes the position seen by a following map. Keep an
      // indexed guarded loop explicit until one pipeline operator can preserve
      // the original position across both steps.
      if (indexName !== null) return;
      if (appendStatement.elseBody !== null || appendStatement.thenBody.length !== 1) return;
      const condition = this.host.expandAliases(this.host.inferredExpressionType(appendStatement.condition));
      if (!sameType(condition, boolType)) return;
      predicate = this.manualListPipelineExpressionSpelling(appendStatement.condition, new Set([targetName]));
      if (predicate === null) return;
      appendStatement = appendStatement.thenBody[0] ?? null;
    }

    const write = this.manualListPipelineWrite(appendStatement, targetName);
    if (write === null) return;
    const transform = this.manualListPipelineExpressionSpelling(write.value, new Set([targetName]));
    if (transform === null) return;
    // The `if` body can read a value under a flow fact, while a later `map`
    // callback is analyzed independently from the preceding `filter`. Keep the
    // conservative boundary at every narrowed projection: some facts may come
    // from an enclosing branch and survive the rewrite, but admitting those
    // would require proving their origin. This guarantees the advertised
    // pipeline compiles (notably for `row.label != null` then `row.label`).
    if (predicate !== null && this.host.lowering.expressionUsesRuntimeNarrowing(write.value)) return;

    const identity = write.operation === "append"
      && write.value.kind === "IdentifierExpression"
      && write.value.name === itemName;
    // A7 already owns the unfiltered identity copy and names List.copy().
    if (predicate === null && identity) return;
    const filtered = predicate === null ? sourceSpelling : `${sourceSpelling}.filter(${itemName} => ${predicate})`;
    const projection = write.operation === "extend" ? "flatMap" : "map";
    const parameters = indexName === null ? itemName : `(${itemName}, ${indexName})`;
    const replacement = identity ? filtered : `${filtered}.${projection}(${parameters} => ${transform})`;
    const operation = predicate === null
      ? `List.${projection}`
      : identity ? "List.filter" : `List.filter(...).${projection}`;
    this.host.advise(
      "A13",
      `This empty List is filled only by a pure per-item ${predicate === null ? "projection" : "filter and projection"}; ${operation} is the canonical collection pipeline. Initialize '${targetName}' with '${replacement}' instead of writing this loop`,
      statement.iterable.span,
      this.host.commentPreservingMechanicalFix(
        span(previous.initializer.span.start, statement.span.end),
        replacement,
        `Initialize '${targetName}' with a collection pipeline`,
      ),
    );
  }

  private manualListPipelineSourceSpelling(expression: Expression, targetName: string): string | null {
    if (expression.kind === "IdentifierExpression") return expression.name === targetName ? null : expression.name;
    if (expression.kind !== "MemberExpression" || expression.optional || !this.host.stableDataMember(expression.object, expression.property)) return null;
    const object = this.manualListPipelineSourceSpelling(expression.object, targetName);
    return object === null ? null : `${object}.${expression.property}`;
  }

  private manualListPipelineWrite(
    statement: Statement | null,
    targetName: string,
  ): { readonly operation: "append" | "extend"; readonly value: Expression } | null {
    if (statement?.kind !== "ExpressionStatement") return null;
    const call = statement.expression;
    if (call.kind !== "CallExpression" || call.optional || call.callee.kind !== "MemberExpression" || call.callee.optional) return null;
    if (call.callee.object.kind !== "IdentifierExpression" || call.callee.object.name !== targetName) return null;
    const operation = this.host.lowering.collectionCalls.get(call.callee.span.end);
    if (operation !== "listAppend" && operation !== "listExtend") return null;
    const [value] = this.orderedDirectCallArguments(call, [operation === "listAppend" ? "value" : "values"]);
    return value ? { operation: operation === "listAppend" ? "append" : "extend", value } : null;
  }

  /** Rebuilds the pure data-expression subset admitted inside an A13 pipeline. */
  private manualListPipelineExpressionSpelling(
    expression: Expression,
    forbiddenNames: ReadonlySet<string>,
    nested = false,
  ): string | null {
    switch (expression.kind) {
      case "LiteralExpression":
        return expression.raw;
      case "IdentifierExpression":
        return forbiddenNames.has(expression.name) ? null : expression.name;
      case "MemberExpression": {
        if (!this.host.canonicalCollectionMemberReadIsStable(expression)) return null;
        const object = this.manualListPipelineExpressionSpelling(expression.object, forbiddenNames, true);
        return object === null ? null : `${object}${expression.optional ? "?." : "."}${expression.property}`;
      }
      case "UnaryExpression": {
        if (expression.operator === "await") return null;
        const operand = this.manualListPipelineExpressionSpelling(expression.operand, forbiddenNames, true);
        if (operand === null) return null;
        const spelling = `${expression.operator === "not" ? "not " : expression.operator}${operand}`;
        return nested ? `(${spelling})` : spelling;
      }
      case "BinaryExpression": {
        const left = this.manualListPipelineExpressionSpelling(expression.left, forbiddenNames, true);
        const right = this.manualListPipelineExpressionSpelling(expression.right, forbiddenNames, true);
        if (left === null || right === null) return null;
        const spelling = `${left} ${expression.operator} ${right}`;
        return nested ? `(${spelling})` : spelling;
      }
      case "ComparisonChainExpression": {
        const operands = expression.operands.map((operand) => this.manualListPipelineExpressionSpelling(operand, forbiddenNames, true));
        if (operands.some((operand) => operand === null)) return null;
        let spelling = operands[0]!;
        for (let index = 0; index < expression.operators.length; index += 1) {
          spelling += ` ${expression.operators[index]} ${operands[index + 1]}`;
        }
        return nested ? `(${spelling})` : spelling;
      }
      case "ConditionalExpression": {
        const condition = this.manualListPipelineExpressionSpelling(expression.condition, forbiddenNames, true);
        const thenValue = this.manualListPipelineExpressionSpelling(expression.thenValue, forbiddenNames, true);
        const elseValue = this.manualListPipelineExpressionSpelling(expression.elseValue, forbiddenNames, true);
        if (condition === null || thenValue === null || elseValue === null) return null;
        const spelling = `${condition} ? ${thenValue} : ${elseValue}`;
        return nested ? `(${spelling})` : spelling;
      }
      case "FStringExpression": {
        for (const part of expression.parts) {
          if (part.kind === "expression" && this.manualListPipelineExpressionSpelling(part.value, forbiddenNames) === null) return null;
        }
        const written = this.host.sourceText.slice(expression.span.start, expression.span.end);
        return written.length > 0 ? written : null;
      }
      case "CallExpression": {
        if (expression.optional || expression.arguments.length !== 1 || expression.argumentNames?.some((name) => name !== null)) return null;
        if (expression.callee.kind === "IdentifierExpression" && expression.callee.name === "str") {
          const argument = this.manualListPipelineExpressionSpelling(expression.arguments[0]!, forbiddenNames);
          return argument === null ? null : `str(${argument})`;
        }
        if (!this.host.lowering.recordFromCalls.has(spanIdentity(expression.span))) return null;
        if (expression.callee.kind !== "MemberExpression" || expression.callee.optional
          || expression.callee.property !== "from" || expression.callee.object.kind !== "IdentifierExpression") return null;
        const argument = this.manualListPipelineExpressionSpelling(expression.arguments[0]!, forbiddenNames);
        return argument === null ? null : `${expression.callee.object.name}.from(${argument})`;
      }
      default: {
        for (const extension of this.host.analysisExtensions) {
          const accepted = extension.canonicalCollectionProjection?.(
            expression,
            (child) => this.manualListPipelineExpressionSpelling(child, forbiddenNames) !== null,
          );
          if (accepted === undefined) continue;
          if (!accepted) return null;
          const written = this.host.sourceText.slice(expression.span.start, expression.span.end);
          return written.length > 0 ? written : null;
        }
        return null;
      }
    }
  }

  /**
   * A9: a closed target literal that merely mirrors the same record field by
   * field has the exact projection spelling `Target.from(source, overrides)`.
   *
   * This is intentionally narrower than a visual resemblance check. An
   * override call could mutate the source before a later manual field read,
   * so the advisory requires every target field, two or more same-name data
   * reads from one identifier, and only identifiers or literals for the
   * remaining fields. Optional omissions, computed values, calls, spreads,
   * and mixed sources all remain ordinary object literals. Authored key order
   * may differ: the report calls out that `.from` deliberately canonicalizes
   * the result to target declaration order, so an intentional wire order has
   * one honest reason to suppress it.
   */
  adviseManualRecordProjection(
    expression: Extract<Expression, { kind: "ObjectExpression" }>,
    target: ValueType | null,
    writtenTarget: ValueType,
  ): void {
    if (target?.kind !== "named") return;
    const shape = this.host.recordProjectionShape(target);
    if (!shape || expression.properties.some((property) => property.kind !== "ObjectProperty")) return;
    const properties = expression.properties as readonly Extract<(typeof expression.properties)[number], { kind: "ObjectProperty" }>[];
    const targetFields = [...shape.fields.keys()];
    if (properties.length !== targetFields.length || targetFields.some((name) => !properties.some((property) => property.name === name))) return;

    let sourceName: string | null = null;
    let mirrors = 0;
    const overrides: string[] = [];
    for (const property of properties) {
      const value = property.value;
      if (value.kind === "MemberExpression"
        && !value.optional
        && value.object.kind === "IdentifierExpression"
        && value.property === property.name
        && this.host.stableDataMember(value.object, value.property)) {
        if (sourceName !== null && sourceName !== value.object.name) return;
        sourceName = value.object.name;
        mirrors += 1;
        continue;
      }
      if (value.kind === "IdentifierExpression") {
        overrides.push(value.name === property.name ? property.name : `${property.name}: ${value.name}`);
        continue;
      }
      if (value.kind === "LiteralExpression") {
        overrides.push(`${property.name}: ${value.raw}`);
        continue;
      }
      return;
    }
    if (sourceName === null || mirrors < 2) return;
    const sourceBinding = this.host.lookup(sourceName);
    if (!sourceBinding || !this.host.recordProjectionShape(sourceBinding.type)) return;

    const targetName = this.recordProjectionTypeName(target, writtenTarget);
    const replacement = `${targetName}.from(${sourceName}${overrides.length > 0 ? `, {${overrides.join(", ")}}` : ""})`;
    this.host.advise(
      "A9",
      `This ${targetName} literal mirrors ${mirrors} same-name fields from '${sourceName}'; '${replacement}' is the canonical exact projection and keeps ${targetName}'s declared field set and declaration order. Write that instead of copying the fields one by one; suppress A9 only when this literal's authored Record order is intentional`,
      expression.span,
      this.host.commentPreservingMechanicalFix(
        expression.span,
        replacement,
        `Use '${targetName}.from(...)'`,
      ),
    );
  }

  /**
   * A10: a large closed record literal that applies one transform to every
   * same-name field is the long form of `Target.mapFrom(source, transform)`.
   *
   * Four fields is the deliberately conservative threshold: below it the
   * literal is often clearer, while a larger block is maintenance-heavy and
   * likely to drift. Because the transform may have effects, this proof also
   * requires authored property order to equal target declaration order.
   */
  adviseManualMappedRecordProjection(
    expression: Extract<Expression, { kind: "ObjectExpression" }>,
    target: ValueType | null,
    writtenTarget: ValueType,
  ): void {
    if (target?.kind !== "named") return;
    const shape = this.host.recordProjectionShape(target);
    if (!shape || expression.properties.some((property) => property.kind !== "ObjectProperty")) return;
    const properties = expression.properties as readonly Extract<(typeof expression.properties)[number], { kind: "ObjectProperty" }>[];
    const targetFields = [...shape.fields.keys()];
    if (targetFields.length < 4 || properties.length !== targetFields.length) return;
    if (properties.some((property, index) => property.name !== targetFields[index])) return;

    let sourceName: string | null = null;
    let transformName: string | null = null;
    for (const property of properties) {
      const value = property.value;
      if (value.kind !== "CallExpression"
        || value.optional
        || value.callee.kind !== "IdentifierExpression"
        || value.arguments.length !== 1
        || value.argumentNames?.some((name) => name !== null)) return;
      const argument = value.arguments[0];
      if (!argument || argument.kind !== "MemberExpression"
        || argument.optional
        || argument.object.kind !== "IdentifierExpression"
        || argument.property !== property.name
        || !this.host.stableDataMember(argument.object, argument.property)) return;
      if (sourceName !== null && sourceName !== argument.object.name) return;
      if (transformName !== null && transformName !== value.callee.name) return;
      sourceName = argument.object.name;
      transformName = value.callee.name;
    }
    if (sourceName === null || transformName === null) return;
    const sourceBinding = this.host.lookup(sourceName);
    const transformBinding = this.host.lookup(transformName);
    if (!sourceBinding || !this.host.recordProjectionShape(sourceBinding.type)) return;
    const transformType = transformBinding ? this.host.expandAliases(transformBinding.type) : null;
    if (!transformType || (transformType.kind !== "function" && transformType.kind !== "action")) return;

    const targetName = this.recordProjectionTypeName(target, writtenTarget);
    const replacement = `${targetName}.mapFrom(${sourceName}, ${transformName})`;
    this.host.advise(
      "A10",
      `This ${targetName} literal repeats '${transformName}(${sourceName}.field)' for all ${targetFields.length} fields; '${replacement}' maps the complete target field table in declaration order. Write that instead of maintaining one conversion per field`,
      expression.span,
      this.host.commentPreservingMechanicalFix(
        expression.span,
        replacement,
        `Use '${targetName}.mapFrom(...)'`,
      ),
    );
  }

  /** Returns a name that is legal in the Type-object position of the fix. */
  private recordProjectionTypeName(target: Extract<ValueType, { kind: "named" }>, writtenTarget: ValueType): string {
    if (writtenTarget.kind === "named" && this.host.lookup(writtenTarget.name)?.type.kind === "typeObject") {
      return writtenTarget.name;
    }
    for (const [name, alias] of this.host.typeAliases) {
      if (sameType(this.host.expandAliases(alias), target)) return name;
    }
    return target.name;
  }

  /**
   * A15: `{name: name}` and `{name}` are the same record entry when both
   * occurrences are ordinary identifiers. Quoted and keyword-named keys are
   * deliberately excluded: the AST keeps their decoded value, so comparing
   * names alone would erase syntax the author actually wrote. Parenthesized,
   * member, call, and every different-name value remain ordinary mappings.
   *
   * The edit owns only the entry, never its comma or surrounding layout. A
   * comment between the key and value withholds the edit rather than dropping
   * prose; a trailing comment sits outside the entry span and is preserved.
   */
  adviseRedundantObjectProperty(
    property: Extract<Expression, { kind: "ObjectExpression" }>["properties"][number] & { kind: "ObjectProperty" },
  ): void {
    if (!property.sameNameIdentifierValue) return;
    this.host.advise(
      "A15",
      `Object field '${property.name}' repeats the same-name identifier it reads; use the shorthand '{${property.name}}'`,
      property.span,
      this.host.commentPreservingMechanicalFix(property.span, property.name, `Use object shorthand '${property.name}'`),
    );
  }

  /**
   * D114 ⑤ — A17: Python's `return a, b` and JavaScript's `return [a, b]` both
   * land here as a List literal whose elements are of different types. Vel
   * accepts it and types it `List<string | number>`, so the author does not
   * learn anything until a member read three lines later reports "no common
   * field". The record is the spelling this language has for a fixed group of
   * differently typed values, and it gives each value a name.
   *
   * The admission is deliberately narrow, at D89's near-zero-false-positive
   * bar. Two or more written elements, every one of them in a primitive
   * category — string, number, bool, or enum — and at least two different
   * categories among them. A `null` element is ignored rather than counted:
   * `["a", null]` is a `List<string?>`, which is one element type. Anything
   * else in the literal — a spread, a record, a class, a collection, a
   * function, a union, `unknown` — keeps the whole literal silent, because a
   * heterogeneous list of records is a real data shape and this advisory may
   * not guess. Two different enums are one category, so `[Kind.a, Status.b]`
   * is silent as well.
   *
   * The literal must also stand where nothing declared its element type. An
   * annotated binding, a declared result, an annotated field, and an argument
   * to a `List<string | number>` parameter all arrive here with a contextual
   * type: the author wrote the union, and the advisory has nothing to say. An
   * unannotated binding, a body-inferred `return`, and an arrow body with no
   * contextual function type arrive with none.
   *
   * There is no mechanical fix. The rewrite has to invent a field name for
   * each value, which is a judgement, exactly as A7's is.
   */
  adviseTupleShapedListLiteral(
    expression: Extract<Expression, { kind: "ListExpression" }>,
    contextualType: ValueType,
    writtenElementTypes: readonly ValueType[],
    element: ValueType,
  ): void {
    if (contextualType.kind !== "unknown" || contextualType.boundary === true) return;
    if (expression.elements.length < 2 || writtenElementTypes.length !== expression.elements.length) return;

    const categories = new Set<string>();
    for (const type of writtenElementTypes) {
      const category = this.tupleElementCategory(type);
      if (category === null) return;
      if (category !== "") categories.add(category);
    }
    if (categories.size < 2) return;

    const quoted = this.boundedSourceQuote(expression.span);
    const record = this.tupleRecordSpelling(expression, writtenElementTypes);
    this.host.advise(
      "A17",
      `A List holds one element type, so every value read back out of ${quoted} is '${describeType(element)}'. VelarScript spells a fixed group of differently typed values as a record, which gives each one a name — ${record === null ? "write '{name: value, ...}' with a field per value" : `write '${record}'`}, or declare a type for it`,
      expression.span,
    );
  }

  /**
   * A17's element classification. Answers the primitive category an element
   * contributes, `""` for an element that is ignored (`null`, and the `null`
   * arm of an optional), and `null` for one that keeps the whole literal
   * silent.
   */
  private tupleElementCategory(type: ValueType): string | null {
    const expanded = this.host.expandAliases(type);
    if (expanded.kind === "optional") return this.tupleElementCategory(expanded.inner);
    switch (expanded.kind) {
      case "null": return "";
      case "string": return "string";
      case "number": return "number";
      case "bool": return "bool";
      case "enum":
      case "enumMember": return "enum";
      default: return null;
    }
  }

  /** The record an A17 literal would be written as, or null when it is too long to quote. */
  private tupleRecordSpelling(
    expression: Extract<Expression, { kind: "ListExpression" }>,
    writtenElementTypes: readonly ValueType[],
  ): string | null {
    const names: string[] = [];
    for (const [index, item] of expression.elements.entries()) {
      const name = this.tupleFieldName(item, writtenElementTypes[index]!);
      names.push(names.includes(name) ? `${name}${index + 1}` : name);
    }
    const entries = expression.elements.map((item, index) => {
      const written = this.host.sourceText.slice(item.span.start, item.span.end);
      return written.includes("\n") || written.includes("//") || written.includes("/*") ? null : `${names[index]}: ${written}`;
    });
    if (entries.some((entry) => entry === null)) return null;
    const spelling = `{${entries.join(", ")}}`;
    return spelling.length > 72 ? null : spelling;
  }

  /** The field name a value suggests: the name it already reads, else its category. */
  private tupleFieldName(item: Expression, type: ValueType): string {
    if (item.kind === "IdentifierExpression") return item.name;
    if (item.kind === "MemberExpression" && !item.optional) return item.property;
    if (item.kind === "CallExpression" && !item.optional && item.callee.kind === "MemberExpression" && !item.callee.optional) {
      return item.callee.property;
    }
    const category = this.tupleElementCategory(type);
    return category === "string" ? "text" : category === "number" ? "count" : category === "bool" ? "flag" : "value";
  }

  /** One written expression, quoted for a message and clipped when it runs long. */
  private boundedSourceQuote(quoted: Span): string {
    const written = this.host.sourceText.slice(quoted.start, quoted.end).replaceAll(/\s+/gu, " ").trim();
    return written.length === 0 ? "this literal"
      : written.length > 60 ? `'${written.slice(0, 59)}…'`
        : `'${written}'`;
  }

  /**
   * D89 A3: `%` follows JavaScript and keeps the dividend's sign, so `-7 % 3`
   * is `-1` where Python answers `2`. Nothing here reports an error — both
   * languages accept the spelling, they just disagree about the result.
   *
   * Only a literal negative dividend triggers. A variable's sign is not
   * knowable, and advising every `%` whose left side might go negative would
   * be the noise the tier exists to avoid. The shape matched is a unary minus
   * wrapping a numeric literal, because that is what `-7` parses as; there is
   * no negative-valued literal for a value test to find.
   *
   * The admission bar is "Vel accepts the spelling as a different meaning", so
   * every shape whose two answers are the same is silent rather than advised:
   * a remainder of zero (`-6 % 3`) agrees, `% 0` answers NaN here and raises
   * in Python so there is no Python answer to name, and a non-finite dividend
   * answers NaN on both sides. A message that states a disagreement and then
   * prints the same number twice is a new defect, not a weaker advisory.
   */
  adviseNegativeLiteralModulo(leftExpression: Expression, rightExpression: Expression, operationSpan: Span): void {
    if (leftExpression.kind !== "UnaryExpression" || leftExpression.operator !== "-") return;
    const dividend = leftExpression.operand;
    if (dividend.kind !== "LiteralExpression" || typeof dividend.value !== "number") return;
    const divisor = rightExpression.kind === "LiteralExpression" && typeof rightExpression.value === "number"
      ? rightExpression
      : null;
    if (divisor !== null) {
      const divisorValue = Number(divisor.value);
      if (divisorValue === 0) return;
      // `-0` renders as `0`, so a zero remainder would print one number on
      // both sides of a sentence claiming they differ.
      const remainder = -Number(dividend.value) % divisorValue;
      if (!Number.isFinite(remainder) || remainder === 0) return;
      // A literal divisor is always positive — a negative one parses as a
      // unary minus, not a literal — so Python's answer, which takes the
      // divisor's sign, is this remainder lifted by one divisor.
      const python = remainder + divisorValue;
      // The rewrite the message advertises is its own remedy, so quoting an
      // answer that rewrite does not produce would be false. The two part ways
      // only when the lift rounds back onto the divisor; the general sentence
      // below covers that without naming a number.
      if ((remainder + divisorValue) % divisorValue === python) {
        this.host.advise(
          "A3",
          `VelarScript's '%' follows JavaScript and keeps the dividend's sign, so '-${dividend.raw} % ${divisor.raw}' is ${remainder} where Python answers ${python}; write '((a % b) + b) % b' for the Python answer`,
          operationSpan,
        );
        return;
      }
    }
    this.host.advise(
      "A3",
      "VelarScript's '%' follows JavaScript and keeps the dividend's sign, so a negative dividend leaves a remainder that is negative or zero, where Python's takes the divisor's sign; write '((a % b) + b) % b' for the Python answer",
      operationSpan,
    );
  }
}
