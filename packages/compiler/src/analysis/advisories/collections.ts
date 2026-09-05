/**
 * A7 and A13: an empty collection beside a loop that only copies, or only
 * projects, is the expanded form of a compiler-owned conversion or of a List
 * pipeline. Both proofs are deliberately narrow — they accept only stable
 * sources and effect-free projections — because a canonicalization advisory
 * that guesses is lint noise.
 *
 * D115 §三 / D114 R1f: one family of `advisories.ts`.
 */
import { type Expression, type ForStatement, type Statement } from "../../ast.ts";
import { type CollectionOperation } from "../../contracts.ts";
import { span, spanIdentity } from "../../source.ts";
import { boolType, describeType, sameType, type ValueType } from "../../types.ts";
import { canonicalCollectionMemberReadIsStable, type AdvisoryHost } from "./roster.ts";

export class CollectionAdvisories {
  private readonly host: AdvisoryHost;

  constructor(host: AdvisoryHost) {
    this.host = host;
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
        if (!canonicalCollectionMemberReadIsStable(this.host, expression)) return null;
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
}
