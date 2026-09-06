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
 * D114 F7-web-b: a bare number written in a builder slot that will not take
 * one — the mistake LK-I3 found on `hsl`, which on the length builders had been
 * left drawing two reports about one number: core's `Cannot assign number to
 * Length` and this analyzer's unit advice, side by side.
 *
 * Which slots those are is the builder's own published type, handed in by the
 * caller, so there is no second table of builder positions kept in step by
 * hand. Three shapes, three lessons:
 *
 *   - a slot whose type is exactly `Length` — `blur`'s radius, `border`'s
 *     width, the offsets and spread of `shadow` and `dropShadow` — has one
 *     natural unit, so the sentence names it and `velar fix` writes `4px`;
 *   - a slot that takes a length *or* a percentage — `min`, `max` and `clamp`,
 *     the three builders that exist to mix them — names both spellings and
 *     offers no rewrite, because `100px` and `100%` are different pictures and
 *     the one the author meant is not the compiler's to guess;
 *   - a slot whose union admits `number` as well — `spacing`, `tracks`,
 *     `minmax` — draws no refusal from core at all, so the unit advice is the
 *     whole diagnosis and zero, the one unitless length CSS accepts, passes.
 *
 * Zero is refused in the first two: `blur(0)` and `min(0, 600px)` are not CSS,
 * so the slot says what to write. A slot that admits no length at all — a
 * colour, a border style, `inset` — is not this rule's business and earns
 * nothing here.
 *
 * Returns whether the argument was refused here, which is the caller's record
 * that this call failed its own argument check.
 */
export function teachLookLengthSlot(
  diagnostics: Diagnostic[],
  builder: string,
  position: number,
  slotType: ValueType | undefined,
  argument: Expression,
  literal: number,
): boolean {
  const slot = position < 0 ? undefined : LOOK_BUILDER_SIGNATURES.get(builder)?.parameters[position];
  const written = `${Number(literal.toPrecision(12))}`;
  if (slot !== undefined && slotType?.kind === "named" && slotType.name === "Length"
    && teachSlotRefusal(diagnostics, argument, "Length", (item) => ({
      ...item,
      message: `${builder}'s ${slot} argument is a Length, and ${written} is a number; write ${written}px`,
      ...(argument.kind === "LiteralExpression" && typeof argument.value === "number"
        ? { fix: mechanicalFix(argument.span, `${written}px`, `Write ${written}px`) }
        : {}),
    }))) return true;
  if (!slotAdmitsLength(slotType)) return false;
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

/** Whether a slot's published type carries a length at all, on its own or as one member of its union. */
function slotAdmitsLength(type: ValueType | undefined): boolean {
  if (type === undefined) return false;
  if (type.kind === "named") return lengthPercentageNames.has(type.name);
  return type.kind === "union" && type.members.some((member) => member.kind === "named" && lengthPercentageNames.has(member.name));
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
