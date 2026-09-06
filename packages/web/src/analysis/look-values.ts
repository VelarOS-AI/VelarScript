/**
 * How the visual unit types combine — the rule `+` reads, and the rule the
 * length-percentage builders read.
 *
 * D115 §三: one question about types, asked in two places, so it is written
 * once here rather than twice in the middle of the Web analyzer.
 */
import { mechanicalFix, type Diagnostic } from "@velarscript/compiler";
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

/**
 * D114 P6 item 2 (LK-I3): a bare number written where a builder slot takes a
 * `Percentage`.
 *
 * The refusal already exists and is already in the right place — it is core's
 * assignability check on the argument — so this teaches that one the remedy
 * instead of adding a second report of one mistake. The message names the
 * percentage the author meant, and `velar fix` writes it where the argument is
 * a literal; an identifier that folded to a number is a binding whose
 * declaration is the place to change, so it earns the sentence and no rewrite.
 *
 * Returns whether the refusal was found and taught.
 */
export function teachLookPercentageSlot(
  diagnostics: Diagnostic[],
  slot: string,
  argument: Expression,
  literal: number,
): boolean {
  const written = `${Number(literal.toPrecision(12))}%`;
  const rewritable = argument.kind === "LiteralExpression" && typeof argument.value === "number";
  return teachSlotRefusal(diagnostics, argument, "Percentage", (item) => ({
    ...item,
    message: `${slot} is a percentage, and ${literal} is a number; write ${written}`,
    ...(rewritable ? { fix: mechanicalFix(argument.span, written, `Write ${written}`) } : {}),
  }));
}

/**
 * D114 F7-web neighbour: a bare number written in a `min`, `max` or `clamp`
 * slot, which is the same mistake LK-I3 found on `hsl` and had left drawing two
 * reports — core's `Cannot assign number to Length | Percentage |
 * LengthPercentage` and this analyzer's unit advice, side by side, about one
 * number.
 *
 * These three builders exist to mix `%` with `px`, so every slot of theirs
 * takes a length or a percentage and core has already refused the number. That
 * refusal is where the lesson goes — it names the slot, what the slot takes,
 * and both spellings of the remedy — and there is no second report. There is
 * also no `velar fix` edit: `100px` and `100%` are different pictures, and the
 * one the author meant is not the compiler's to guess.
 *
 * Every other length builder takes a number as far as the type system is
 * concerned (`spacing`, `tracks`, `minmax` and their kin publish unions that
 * include `number`), so there the unit advice is the only report there is, and
 * zero is the one unitless length CSS accepts.
 *
 * Returns whether the argument was refused here, which is the caller's record
 * that this call failed its own argument check.
 */
export function teachLookLengthSlot(
  diagnostics: Diagnostic[],
  builder: string,
  position: number,
  argument: Expression,
  literal: number,
): boolean {
  const signature = LOOK_BUILDER_SIGNATURES.get(builder);
  const slot = signature?.result === "length-percentage" && position >= 0 ? signature.parameters[position] : undefined;
  const written = `${Number(literal.toPrecision(12))}`;
  if (slot !== undefined && teachSlotRefusal(diagnostics, argument, "LengthPercentage", (item) => ({
    ...item,
    message: `${builder}'s ${slot} argument is a Length or a Percentage, and ${written} is a number;`
      + ` write ${written}px or ${written}%`,
  }))) return true;
  if (literal === 0) return false;
  diagnostics.push({
    code: "VEL5042",
    message: `${builder} composes CSS lengths, so ${literal} requires a unit;`
      + ` write a unit value such as ${literal}px or ${literal}rem (only 0 is unitless)`,
    span: argument.span,
  });
  return true;
}

/**
 * The search both slot lessons make: core's assignability refusal for exactly
 * this argument, rewritten in place. Diagnostics are collected in source order,
 * so the scan walks back from the end and stops as soon as it is behind the
 * argument. The refused type is named so that a slot's own lesson cannot land
 * on some other refusal that happens to share the span.
 */
function teachSlotRefusal(
  diagnostics: Diagnostic[],
  argument: Expression,
  refused: string,
  rewrite: (item: Diagnostic) => Diagnostic,
): boolean {
  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    const item = diagnostics[index]!;
    if (item.span.start < argument.span.start) break;
    if (item.code !== "VEL4001" || item.span.start !== argument.span.start || item.span.end !== argument.span.end) continue;
    if (!item.message.includes(refused)) continue;
    diagnostics[index] = rewrite(item);
    return true;
  }
  return false;
}
