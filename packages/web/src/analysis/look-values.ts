/**
 * How the visual unit types combine — the rule `+` reads, and the rule the
 * length-percentage builders read.
 *
 * D115 §三: one question about types, asked in two places, so it is written
 * once here rather than twice in the middle of the Web analyzer.
 */
import { type Expression, type ValueType } from "@velarscript/compiler/extension";
import { LOOK_BUILDER_SIGNATURES, LOOK_NUMERIC_TYPE_NAMES } from "../look.ts";

const lookLengthPercentage: ValueType = { kind: "named", name: "LengthPercentage" };
const lengthPercentageNames = new Set(["Length", "Percentage", "LengthPercentage"]);

export function isLookNumericType(type: ValueType): boolean {
  return type.kind === "named" && LOOK_NUMERIC_TYPE_NAMES.has(type.name);
}

/**
 * The type two visual operands add up to: the same kind on both sides keeps it,
 * and a length beside a percentage widens to the type that carries both.
 */
export function lookAdditiveType(left: ValueType, right: ValueType, sameIdentity: boolean): ValueType | null {
  if (!isLookNumericType(left) || !isLookNumericType(right)) return null;
  if (sameIdentity) return left;
  return left.kind === "named" && right.kind === "named"
    && lengthPercentageNames.has(left.name) && lengthPercentageNames.has(right.name)
    ? lookLengthPercentage
    : null;
}

/**
 * D114 0.29.0 LK-C3: `min`, `max` and `clamp` publish the widest of the three
 * length-percentage types, because a slot takes either. A call whose slots are
 * all one kind is still that kind, and the fold is the one `+` already makes.
 * Without it, `clamp(16px, 3vw, 24px)` — the tour's own line, and a legal
 * `lineHeight` — would have started answering `LengthPercentage` and stopped
 * assigning.
 *
 * `inferSlot` both infers a slot and remembers the answer, because the call's
 * own analysis reads each argument again straight afterwards and must not
 * report the argument's diagnostics a second time.
 */
export function foldedLengthPercentage(
  expression: Extract<Expression, { kind: "CallExpression" }>,
  builderOf: (name: string) => string | undefined,
  inferSlot: (argument: Expression) => ValueType,
  join: (left: ValueType, right: ValueType) => ValueType | null,
): ValueType | null {
  if (expression.callee.kind !== "IdentifierExpression") return null;
  const builder = builderOf(expression.callee.name);
  const signature = builder === undefined ? undefined : LOOK_BUILDER_SIGNATURES.get(builder);
  if (!signature || signature.result !== "length-percentage") return null;
  if (expression.arguments.length !== signature.parameters.length) return null;
  let folded: ValueType | null = null;
  for (const argument of expression.arguments) {
    const slot = inferSlot(argument);
    if (!isLookNumericType(slot)) return null;
    folded = folded === null ? slot : join(folded, slot);
    if (folded === null) return null;
  }
  return folded;
}
