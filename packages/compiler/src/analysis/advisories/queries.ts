/**
 * A8: a `for` loop whose only body is an early return, followed by the return
 * that says what the loop did not find, is exactly one of three compiler-owned
 * List queries — `some`, `every`, `find`.
 *
 * D115 §三 / D114 R1f: this proof was the one member of the A roster left on
 * `Analyzer`, because it reads the walk's live depths — `functionDepth`,
 * `constructorDepth`, `finallyLoopDepths` — to know it is inside a function
 * body and not inside a `finally`. Those three are now live accessors on
 * `AdvisoryHost`, so the proof lives with the rest of the roster. The A8
 * documentation block below travelled with it: it had been left attached to
 * `analyzeImportDeclaration`, 800 lines from the method it describes.
 */
import { type Expression, type Statement } from "../../ast.ts";
import { span } from "../../source.ts";
import { boolType, sameType } from "../../types.ts";
import { canonicalCollectionMemberReadIsStable, type AdvisoryHost } from "./roster.ts";

export class QueryAdvisories {
  private readonly host: AdvisoryHost;

  constructor(host: AdvisoryHost) {
    this.host = host;
  }

  /**
   * A8: the exact early-return List queries have compiler-owned spellings:
   * `some`, `every`, and `find`. This is a proof, not a general loop-style
   * preference. The source is a plain List binding, the loop has one name
   * slot, and the predicate is a non-optional bool made only from data reads
   * and operators. A call or class member can hide a mutation/getter, and List
   * iteration is live while query methods snapshot their inputs, so either
   * shape keeps the expanded loop silent.
   */
  adviseManualListQuery(previous: Statement | null, statement: Statement): void {
    if (previous?.kind !== "ForStatement" || statement.kind !== "ReturnStatement") return;
    if (this.host.functionDepth === 0 || this.host.constructorDepth > 0 || this.host.finallyLoopDepths.length > 0) return;
    if (previous.asynchronous || previous.secondPattern !== null || previous.pattern.kind !== "NameBindingPattern") return;
    if (previous.iterable.kind !== "IdentifierExpression" || previous.iterable.name === previous.pattern.name) return;
    const iterable = this.host.expandAliases(this.host.inferredExpressionType(previous.iterable));
    if (iterable.kind !== "list") return;

    if (previous.body.length !== 1 || previous.body[0]!.kind !== "IfStatement") return;
    const branch = previous.body[0]!;
    if (branch.elseBody !== null || branch.thenBody.length !== 1 || branch.thenBody[0]!.kind !== "ReturnStatement") return;
    const condition = this.host.expandAliases(this.host.inferredExpressionType(branch.condition));
    if (!sameType(condition, boolType)) return;
    const predicate = this.manualListQueryPredicateSpelling(branch.condition);
    if (predicate === null) return;

    const sourceName = previous.iterable.name;
    const itemName = previous.pattern.name;
    const branchReturn = branch.thenBody[0]!;
    let member: "some" | "every" | "find";
    let callback = predicate;
    if (this.isBooleanLiteralReturn(branchReturn, true) && this.isBooleanLiteralReturn(statement, false)) {
      member = "some";
    } else if (this.isBooleanLiteralReturn(branchReturn, false) && this.isBooleanLiteralReturn(statement, true)) {
      member = "every";
      callback = branch.condition.kind === "UnaryExpression" && branch.condition.operator === "not"
        ? this.manualListQueryPredicateSpelling(branch.condition.operand) ?? ""
        : `not (${predicate})`;
      if (callback === "") return;
    } else if (this.isLoopSlotReturn(branchReturn, itemName) && this.isNullLiteralReturn(statement)) {
      member = "find";
    } else {
      return;
    }

    const replacement = `return ${sourceName}.${member}(${itemName} => ${callback})`;
    this.host.advise(
      "A8",
      `This loop is exactly a List.${member} query written as early returns. Write '${replacement}' instead`,
      previous.iterable.span,
      this.host.commentPreservingMechanicalFix(
        span(previous.span.start, statement.span.end),
        replacement,
        `Use '${sourceName}.${member}(...)'`,
      ),
    );
  }

  private isBooleanLiteralReturn(statement: Statement, expected: boolean): boolean {
    return statement.kind === "ReturnStatement"
      && statement.value?.kind === "LiteralExpression"
      && statement.value.value === expected;
  }

  private isNullLiteralReturn(statement: Statement): boolean {
    return statement.kind === "ReturnStatement"
      && statement.value?.kind === "LiteralExpression"
      && statement.value.value === null;
  }

  private isLoopSlotReturn(statement: Statement, itemName: string): boolean {
    return statement.kind === "ReturnStatement"
      && statement.value?.kind === "IdentifierExpression"
      && statement.value.name === itemName;
  }

  /**
   * Rebuilds only the expression subset whose evaluation cannot hide a call,
   * write, await, dynamic import, or class getter. Parenthesizing nested
   * operators preserves their AST grouping without needing the source text.
   */
  private manualListQueryPredicateSpelling(expression: Expression, nested = false): string | null {
    switch (expression.kind) {
      case "LiteralExpression":
        return expression.raw;
      case "IdentifierExpression":
        return expression.name;
      case "MemberExpression": {
        if (!canonicalCollectionMemberReadIsStable(this.host, expression)) return null;
        const object = this.manualListQueryPredicateSpelling(expression.object, true);
        return object === null ? null : `${object}${expression.optional ? "?." : "."}${expression.property}`;
      }
      case "UnaryExpression": {
        if (expression.operator === "await") return null;
        const operand = this.manualListQueryPredicateSpelling(expression.operand, true);
        if (operand === null) return null;
        const spelling = `${expression.operator === "not" ? "not " : expression.operator}${operand}`;
        return nested ? `(${spelling})` : spelling;
      }
      case "BinaryExpression": {
        const left = this.manualListQueryPredicateSpelling(expression.left, true);
        const right = this.manualListQueryPredicateSpelling(expression.right, true);
        if (left === null || right === null) return null;
        const spelling = `${left} ${expression.operator} ${right}`;
        return nested ? `(${spelling})` : spelling;
      }
      case "ComparisonChainExpression": {
        const operands = expression.operands.map((operand) => this.manualListQueryPredicateSpelling(operand, true));
        if (operands.some((operand) => operand === null)) return null;
        let spelling = operands[0]!;
        for (let index = 0; index < expression.operators.length; index += 1) {
          spelling += ` ${expression.operators[index]} ${operands[index + 1]}`;
        }
        return nested ? `(${spelling})` : spelling;
      }
      case "ConditionalExpression": {
        const condition = this.manualListQueryPredicateSpelling(expression.condition, true);
        const thenValue = this.manualListQueryPredicateSpelling(expression.thenValue, true);
        const elseValue = this.manualListQueryPredicateSpelling(expression.elseValue, true);
        if (condition === null || thenValue === null || elseValue === null) return null;
        const spelling = `${condition} ? ${thenValue} : ${elseValue}`;
        return nested ? `(${spelling})` : spelling;
      }
      default:
        return null;
    }
  }
}
