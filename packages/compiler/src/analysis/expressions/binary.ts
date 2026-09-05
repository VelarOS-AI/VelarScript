/**
 * `a + b`, `a and b`, `a ?? b`, `a == b`, `a < b` — one binary operator's
 * result type and the checks its operands earn — plus the comparison chain
 * `a < b < c` and the Core duration literals arithmetic reads.
 *
 * D115 §三: this was `inferBinary`, the chain rule, and the three duration
 * helpers. The equality, ordering and enum-domain rules the operators consult
 * live in `./equality.ts`; what is here is which rule an operator asks for.
 */
import { type Expression } from "../../ast.ts";
import { type DiagnosticFix } from "../../diagnostic.ts";
import { type Span, span, spanIdentity } from "../../source.ts";
import {
  type ValueType,
  boolType,
  describeType,
  invalidType,
  isInvalidType,
  mergeTypes,
  nonOptional,
  numberType,
  stringType,
} from "../../types.ts";
import { LoweringRecorder } from "../lowering-recorder.ts";
import { type MutableCellTarget } from "../scopes.ts";
import { durationType } from "../vocabulary.ts";

/** What the binary operators asks of the analyzer that hosts it, and nothing more. */
export interface BinaryExpressionsHost {
  adviseNegativeLiteralModulo(leftExpression: Expression, rightExpression: Expression, operationSpan: Span): void;
  applyNarrowings(narrowed: ReadonlyMap<string, ValueType>, narrowingSpan: Span): void;
  assignedFactDomain(expression: Expression, inferred: ValueType): ValueType;
  coalescingFallbackContext(left: ValueType, contextualType: ValueType): ValueType;
  coalescingSubjectContext(operator: string, contextualType: ValueType): ValueType;
  combineNarrowings(first: ReadonlyMap<string, ValueType>, second: ReadonlyMap<string, ValueType>): ReadonlyMap<string, ValueType>;
  enterScope(): void;
  equalityOperandMayBeNaN(expression: Expression, type: ValueType): boolean;
  exitScope(): void;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  readonly extensionCalls: Map<string, string>;
  inferConditionWithNarrowings(expression: Expression, narrowed: ReadonlyMap<string, ValueType>): { readonly type: ValueType; readonly truthy: ReadonlyMap<string, ValueType>; readonly falsy: ReadonlyMap<string, ValueType>; readonly surviving: ReadonlyMap<string, ValueType>; };
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferNarrowedExpression(expression: Expression, narrowed: ReadonlyMap<string, ValueType>, contextualType: ValueType): ValueType;
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  iterationGuidance(type: ValueType): string;
  iterationSource(expression: Expression, type: ValueType): ValueType;
  readonly logicalConditionNarrowings: Map<string, { readonly truthy: ReadonlyMap<string, ValueType>; readonly falsy: ReadonlyMap<string, ValueType>; }>;
  readonly lowering: LoweringRecorder;
  narrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType>;
  negativeNarrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType>;
  readonlyDataViewOf(type: ValueType): ValueType;
  rejectFreshCollectionEquality(left: Expression, right: Expression, operator: string): boolean;
  rejectFreshCollectionProbe(probe: Expression, operation: string, probes: "element" | "key"): boolean;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell?: MutableCellTarget | null): void;
  requireCondition(type: ValueType, condition: Expression): void;
  requireIntersectingEquality(leftType: ValueType, rightType: ValueType, operator: string, leftExpression: Expression, rightExpression: Expression, operationSpan: Span): void;
  requireMembershipIntersection(probe: ValueType, domain: ValueType, span: Span, operation: string): boolean;
  requireOrderedComparison(leftType: ValueType, rightType: ValueType, leftExpression: Expression, rightExpression: Expression, operationSpan: Span): void;
  survivingNarrowings(narrowed: ReadonlyMap<string, ValueType>): ReadonlyMap<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

export class BinaryExpressions {
  private readonly host: BinaryExpressionsHost;

  constructor(host: BinaryExpressionsHost) {
    this.host = host;
  }

  inferBinary(
    leftExpression: Expression,
    operator: string,
    rightExpression: Expression,
    operationSpan: Span,
    contextualType: ValueType,
  ): ValueType {
    const left = this.host.inferExpression(leftExpression, this.host.coalescingSubjectContext(operator, contextualType));
    if (operator === "and" || operator === "or") {
      this.host.requireCondition(left, leftExpression);
      const leftTruthy = this.host.narrowingFor(leftExpression, left);
      const leftFalsy = this.host.negativeNarrowingFor(leftExpression, left);
      const rightContext = operator === "and" ? leftTruthy : leftFalsy;
      const rightCondition = this.host.inferConditionWithNarrowings(rightExpression, rightContext);
      this.host.logicalConditionNarrowings.set(spanIdentity(operationSpan), {
        truthy: operator === "and" ? this.host.combineNarrowings(rightCondition.surviving, rightCondition.truthy) : new Map(),
        falsy: operator === "or" ? this.host.combineNarrowings(rightCondition.surviving, rightCondition.falsy) : new Map(),
      });
      return isInvalidType(left) || isInvalidType(rightCondition.type) ? invalidType : boolType;
    }
    if (operator === "??") {
      const expandedLeft = this.host.expandAliases(left);
      const fallbackContext = this.host.coalescingFallbackContext(expandedLeft, contextualType);
      const right = this.host.inferNarrowedExpression(
        rightExpression,
        this.host.negativeNarrowingFor(leftExpression, left),
        fallbackContext,
      );
      if (isInvalidType(left) || isInvalidType(right)) return invalidType;
      // D44 rule 71: `??` is a presence test, so an assignment-established
      // fact never makes it a rejected constant — the operand is judged (and
      // runtime-guarded) as its declared domain, exactly like `== null`.
      const domainLeft = this.host.assignedFactDomain(leftExpression, left);
      const expandedDomain = domainLeft === left ? expandedLeft : this.host.expandAliases(domainLeft);
      if (domainLeft !== left) this.host.lowering.runtimeNarrowings.delete(spanIdentity(leftExpression.span));
      if (expandedDomain.kind !== "optional" && expandedDomain.kind !== "null" && expandedDomain.kind !== "any") {
        this.host.typeError(`Left side of '??' is not optional: ${describeType(domainLeft)}`, leftExpression.span);
      }
      return mergeTypes(nonOptional(expandedLeft), right);
    }
    const right = this.host.inferExpression(rightExpression);
    if (isInvalidType(left) || isInvalidType(right)) return invalidType;
    if (operator === "in" || operator === "not in") {
      // D68 rule 177: `item in bag` and `for item in bag` consume the same
      // contract. Letting one work while the other refused is the trap the
      // ruling names — the author would have no way to see where the line is.
      const container = this.host.iterationSource(rightExpression, right);
      if (container.kind === "list" || container.kind === "map" || container.kind === "set" || container.kind === "record" || container.kind === "string") {
        this.host.lowering.collectionMemberships.set(spanIdentity(operationSpan), container.kind);
      }
      if (container.kind === "list" || container.kind === "set") {
        // COL-I3 second half: `in` is the thirteenth membership probe and the
        // one that does not route through `checkProbeArgument`, so it carries
        // the fresh-literal rejection itself — against the probe only, never
        // the container, because the fresh List in `x in [1, 2, 3]` is the
        // domain being searched rather than the question being asked.
        if (!this.host.requireMembershipIntersection(left, this.host.readonlyDataViewOf(container.element), leftExpression.span, operator)) {
          this.host.rejectFreshCollectionProbe(leftExpression, operator, "element");
        }
      } else if (container.kind === "map") {
        if (!this.host.requireMembershipIntersection(left, this.host.readonlyDataViewOf(container.key), leftExpression.span, operator)) {
          this.host.rejectFreshCollectionProbe(leftExpression, operator, "key");
        }
      } else if (container.kind === "record") {
        this.host.requireMembershipIntersection(left, stringType, leftExpression.span, operator);
      } else if (container.kind === "string") {
        this.host.requireMembershipIntersection(left, stringType, leftExpression.span, operator);
      } else if (container.kind !== "any") {
        this.host.typeError(
          `Membership requires a List, Set, Map, Record, or string, received ${describeType(container)}${this.host.iterationGuidance(container)}`,
          rightExpression.span,
        );
      }
      return boolType;
    }
    if (operator === "==" || operator === "!=") {
      if (this.host.rejectFreshCollectionEquality(leftExpression, rightExpression, operator)) return boolType;
      this.host.requireIntersectingEquality(left, right, operator, leftExpression, rightExpression, operationSpan);
      if (this.host.equalityOperandMayBeNaN(leftExpression, left) && this.host.equalityOperandMayBeNaN(rightExpression, right)) {
        this.host.lowering.sameValueZeroEqualities.add(spanIdentity(operationSpan));
      }
      return boolType;
    }
    if (["<", "<=", ">", ">="].includes(operator)) {
      this.host.requireOrderedComparison(left, right, leftExpression, rightExpression, operationSpan);
      return boolType;
    }
    if (operator === "+" && (left.kind === "string" || right.kind === "string")) {
      if (left.kind === "string" && right.kind === "string") return stringType;
      this.host.typeError(
        `String concatenation requires two strings; use an f-string or str(value), received ${describeType(left)} and ${describeType(right)}`,
        operationSpan,
      );
      return stringType;
    }
    if (operator === "%") this.host.adviseNegativeLiteralModulo(leftExpression, rightExpression, operationSpan);
    this.host.requireAssignable(left, numberType, leftExpression.span);
    this.host.requireAssignable(right, numberType, rightExpression.span);
    return numberType;
  }

  inferComparisonChain(expression: Extract<Expression, { kind: "ComparisonChainExpression" }>, contextualType: ValueType): ValueType {
      const types: ValueType[] = [this.host.inferExpression(expression.operands[0]!)];
      let successful = new Map<string, ValueType>();
      for (let index = 0; index < expression.operators.length; index += 1) {
        const left = expression.operands[index]!;
        const right = expression.operands[index + 1]!;
        const operator = expression.operators[index]!;
        this.host.enterScope();
        try {
          this.host.applyNarrowings(successful, right.span);
          const rightType = this.host.inferExpression(right);
          types.push(rightType);
          const surviving = this.host.survivingNarrowings(successful);
          if (operator !== "==" && operator !== "!=") {
            this.host.requireOrderedComparison(types[index]!, rightType, left, right, expression.span);
          } else if (this.host.rejectFreshCollectionEquality(index === 0 ? left : right, right, operator)) {
            // A fresh literal chain link is already constant; nothing else to learn.
          } else if (this.host.equalityOperandMayBeNaN(left, types[index]!) && this.host.equalityOperandMayBeNaN(right, rightType)) {
            this.host.lowering.sameValueZeroEqualities.add(spanIdentity({ start: left.span.start, end: right.span.end }));
          }
          const link: Expression = {
            kind: "BinaryExpression",
            left,
            operator,
            right,
            span: { start: left.span.start, end: right.span.end },
          };
          successful = new Map([...surviving, ...this.host.narrowingFor(link, boolType)]);
        } finally {
          this.host.exitScope();
        }
      }
      this.host.logicalConditionNarrowings.set(spanIdentity(expression.span), { truthy: successful, falsy: new Map() });
      return types.some(isInvalidType) ? invalidType : boolType;
  }

  private isCoreDurationLiteral(expression: Expression): boolean {
    return expression.kind === "ExtensionExpression:core:duration";
  }

  private containsCoreDuration(expression: Expression): boolean {
    if (this.isCoreDurationLiteral(expression)) return true;
    if (expression.kind === "UnaryExpression") return this.containsCoreDuration(expression.operand);
    return expression.kind === "BinaryExpression"
      && (this.containsCoreDuration(expression.left) || this.containsCoreDuration(expression.right));
  }

  inferCoreDurationExpression(expression: Expression): ValueType | null {
    if (this.isCoreDurationLiteral(expression)) return durationType;
    if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")
      && this.containsCoreDuration(expression.operand)) {
      const operand = this.host.inferExpression(expression.operand);
      if (!this.host.isAssignableHere(operand, durationType)) this.host.typeError(`Duration unary '${expression.operator}' requires Duration, received ${describeType(operand)}`, expression.span);
      this.host.extensionCalls.set(spanIdentity(expression.span), "core.duration-arithmetic");
      return durationType;
    }
    if (expression.kind !== "BinaryExpression" || !["+", "-", "*", "/"].includes(expression.operator)
      || !this.containsCoreDuration(expression)) return null;
    const left = this.host.inferExpression(expression.left);
    const right = this.host.inferExpression(expression.right);
    const leftDuration = this.host.isAssignableHere(left, durationType);
    const rightDuration = this.host.isAssignableHere(right, durationType);
    const valid = (expression.operator === "+" || expression.operator === "-")
      ? leftDuration && rightDuration
      : leftDuration && right.kind === "number" || expression.operator === "*" && left.kind === "number" && rightDuration;
    if (!valid) {
      this.host.typeError(`Duration arithmetic cannot apply '${expression.operator}' to ${describeType(left)} and ${describeType(right)}`, expression.span);
      return invalidType;
    }
    if (expression.operator === "/" && expression.right.kind === "LiteralExpression" && expression.right.value === 0) {
      this.host.typeError("Duration arithmetic cannot divide by zero", expression.span);
      return invalidType;
    }
    this.host.extensionCalls.set(spanIdentity(expression.span), "core.duration-arithmetic");
    return durationType;
  }
}
