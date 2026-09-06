/**
 * How the visual unit types combine — the rule `+` reads, and the rule the
 * length-percentage builders read.
 *
 * D115 §三: one question about types, asked in two places, so it is written
 * once here rather than twice in the middle of the Web analyzer.
 */
import { mechanicalFix, type Diagnostic } from "@velarscript/compiler";
import { type Expression, type Span, type ValueType } from "@velarscript/compiler/extension";
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
 * Where the bare number a builder slot refused is actually written, and the
 * binding it came through when that is not the argument itself.
 *
 * D114 F9-web (WB-I7): `hsl(210, sat, 45%)` under `const sat = 70` folds to a
 * number, and the report was drawn under `sat` while its remedy said `70%` — so
 * an author editing at the caret replaced the binding's use with a literal. The
 * number is written in the binding's initializer, so that is where the caret
 * goes, and the sentence names the binding so the line it lands on is explained.
 * A constant imported from another module has no site here and keeps the
 * argument's own span, which is the only position this compile can point at.
 */
export type LookStaticSites = ReadonlyMap<string, Span>;

interface LookSlotOrigin {
  readonly span: Span;
  readonly binding: string | null;
}

function lookSlotOrigin(argument: Expression, sites: LookStaticSites): LookSlotOrigin {
  if (argument.kind !== "IdentifierExpression") return { span: argument.span, binding: null };
  const site = sites.get(argument.name);
  return site === undefined ? { span: argument.span, binding: null } : { span: site, binding: argument.name };
}

/** "4 is a number", or "'n' holds 4, a number" where the argument folded through a binding. */
function heldNumber(origin: LookSlotOrigin, written: string, refused: string): string {
  return origin.binding === null ? `${written} is ${refused}` : `'${origin.binding}' holds ${written}, ${refused}`;
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
 * declaration is the place to change, so it earns the sentence there and no
 * rewrite — retyping the binding is not a mechanical edit, because every other
 * use of it is part of the answer.
 *
 * Returns whether the refusal was found and taught.
 */
export function teachLookPercentageSlot(
  diagnostics: Diagnostic[],
  slot: string,
  argument: Expression,
  literal: number,
  sites: LookStaticSites,
): boolean {
  const written = `${Number(literal.toPrecision(12))}%`;
  const origin = lookSlotOrigin(argument, sites);
  const rewritable = argument.kind === "LiteralExpression" && typeof argument.value === "number";
  return teachSlotRefusal(diagnostics, argument, "Percentage", (item) => ({
    ...item,
    span: origin.span,
    message: `${slot} is a percentage, and ${heldNumber(origin, String(literal), "a number")}; write ${written}`,
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
 *     whole diagnosis, and zero passes because that union really does take it.
 *
 * D114 F9-web (WB-I2): all three sentences are one sentence, built from the
 * slot's own published type, because the advice used to be written twice. The
 * unit advice said "(only 0 is unitless)" for every builder that composes
 * lengths — true of the third shape, whose union takes a bare `0`, and a
 * falsehood on `blur` and `shadow`, where `blur(0)` is refused. A slot cannot
 * now be told what it takes by anything but its type: `slotAccepts` reads it,
 * and the "or 0" clause exists exactly where a bare number is accepted.
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
  sites: LookStaticSites,
): boolean {
  const slot = position < 0 ? undefined : LOOK_BUILDER_SIGNATURES.get(builder)?.parameters[position];
  const accepts = slotAccepts(slotType);
  if (slot === undefined || accepts === null) return false;
  const written = `${Number(literal.toPrecision(12))}`;
  const origin = lookSlotOrigin(argument, sites);
  const spellings = accepts === "a Length" ? `${written}px`
    : accepts === "a Percentage" ? `${written}%` : `${written}px or ${written}%`;
  // `tracks` is the one length builder whose name ends in an s, and "tracks's"
  // is not how the possessive is written.
  const lesson = `${builder}${builder.endsWith("s") ? "'" : "'s"} ${slot} argument is ${accepts},`
    + ` and ${heldNumber(origin, written, accepts.endsWith("or 0") ? "none of those" : "a number")}; write ${spellings}`;
  if (accepts === "a Length" && teachSlotRefusal(diagnostics, argument, "Length", (item) => ({
    ...item,
    span: origin.span,
    message: lesson,
    ...(argument.kind === "LiteralExpression" && typeof argument.value === "number"
      ? { fix: mechanicalFix(argument.span, `${written}px`, `Write ${written}px`) }
      : {}),
  }))) return true;
  // The refused type is the slot's own, so a slot that takes only a percentage
  // finds its refusal too rather than falling through and reporting twice.
  if (accepts !== "a Length" && teachSlotRefusal(diagnostics, argument, accepts === "a Percentage" ? "Percentage" : "LengthPercentage", (item) => ({
    ...item,
    span: origin.span,
    message: lesson,
  }))) return true;
  // A slot whose union takes a bare number takes `0`, and CSS writes that one
  // length without a unit; every other number in it is the dead declaration
  // this report exists for.
  if (literal === 0 && accepts.endsWith("or 0")) return false;
  diagnostics.push({ code: "VEL5042", message: lesson, span: origin.span });
  return true;
}

/**
 * What a slot's published type accepts, in the words the lesson names it with,
 * or null where the slot carries no length at all. The "or 0" tail is the one
 * fact a reader has to be able to trust in both directions, so it is read from
 * the type rather than written into a sentence by hand.
 */
function slotAccepts(type: ValueType | undefined): string | null {
  if (type === undefined) return null;
  if (type.kind === "named") {
    if (!lengthPercentageNames.has(type.name)) return null;
    return type.name === "Length" ? "a Length" : type.name === "Percentage" ? "a Percentage" : "a Length or a Percentage";
  }
  if (type.kind !== "union") return null;
  if (!type.members.some((member) => member.kind === "named" && lengthPercentageNames.has(member.name))) return null;
  return type.members.some((member) => member.kind === "number") ? "a Length, a Percentage, or 0" : "a Length or a Percentage";
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
