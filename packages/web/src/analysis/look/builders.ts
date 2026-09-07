/**
 * The compile-time half of the velar/look builders: the numeric domains each
 * one publishes, the animation vocabulary `animate` takes, and the record of
 * which calls were refused on their own arguments.
 *
 * D115 P4 R3b. That record lives with the check that made it because a
 * `keyframes:` stop lowers its builder calls at compile time — no call survives
 * to run the runtime guard, so the stop reads what this file already decided
 * rather than reporting the same argument twice.
 */
import { type Span } from "@velarscript/compiler";
import { type Expression, spanIdentity } from "@velarscript/compiler/extension";
import { evaluateLookStaticExpression } from "../../look-static.ts";
import { LOOK_ANIMATION_DIRECTIONS, LOOK_ANIMATION_EASINGS, LOOK_ANIMATION_FILLS, LOOK_BORDER_STYLE_NAMES, LOOK_BUILDER_NUMERIC_RANGES, LOOK_BUILDER_SIGNATURES, LOOK_LENGTH_BUILDERS } from "../../look.ts";
import { teachLookLengthSlot, teachLookPercentageSlot } from "../look-values.ts";
import { lookDurationLiteral, numericLiteral } from "../look-vocabulary-guidance.ts";
import { diagnostic } from "../web-types.ts";
import { type LookAnalysisHost } from "./host.ts";
import { checkLookTokenCall, reportLookColorVarReference } from "./tokens.ts";
import { validateLookStringVocabulary } from "./values.ts";

/**
 * LOK-U8: the velar/look builders check their numeric domains at run time, so
 * a literal out-of-range colour used to compile clean and blank the page on
 * the first paint. Literal arguments are checked in the same terms while the
 * module compiles; dynamic arguments keep the runtime guard.
 */
export function checkLookBuilderCall(host: LookAnalysisHost, expression: Extract<Expression, { kind: "CallExpression" }>): void {
  const callee = expression.callee.kind === "IdentifierExpression" ? expression.callee.name : "";
  const builder = host.lookBuilderNames.get(callee);
  if (!builder) return;
  const key = spanIdentity(expression.span);
  if (host.checkedBuilderCalls.has(key)) return;
  host.checkedBuilderCalls.add(key);
  if (builder === "animate") {
    checkAnimateBuilderCall(host, expression);
    return;
  }
  if (builder === "token") {
    checkLookTokenCall(host, expression);
    return;
  }
  const ranges = LOOK_BUILDER_NUMERIC_RANGES.get(builder);
  // A named argument fills the same slot its positional spelling does, so the
  // position comes from the builder's own signature — the one table the
  // module interface, the named-argument arity check, and the `keyframes:`
  // lowering already derive from. Reading `-1` here instead put every check
  // in this loop out of reach of the named spelling, not only the range
  // table: `rgba(0, 0, 0, alpha=2)` compiled clean while `rgba(0, 0, 0, 2)`
  // was refused.
  const parameters = LOOK_BUILDER_SIGNATURES.get(builder)?.parameters;
  // LOK-D3: which slots take a length is the builder's own published type,
  // read from the binding this call resolved through — the declaration core's
  // assignability check refused against — and not a second table of positions.
  const declared = host.expandAliases(host.lookup(callee)?.type ?? { kind: "unknown" });
  const before = host.diagnostics.length;
  let taught = false;
  for (const [index, argument] of expression.arguments.entries()) {
    const named = expression.argumentNames?.[index] ?? null;
    const position = named === null ? index : parameters?.indexOf(named) ?? -1;
    const range = position >= 0 ? ranges?.[position] : undefined;
    // LOK-U8 completed: a `keyframes:` stop lowers its builder calls at
    // compile time, so no call survives to run the runtime guard. Reading the
    // folded value rather than the literal node is what makes the promise
    // "a computed argument keeps the same check" true where the run time the
    // charter names does not exist.
    const folded = evaluateLookStaticExpression(argument, host.lookStatic.values);
    const literal = folded?.kind === "number" ? folded.value : null;
    // D114 P6 item 2 (LK-I3): a slot whose domain carries a unit states its
    // bound in that unit and reads the value out of the unit's own number, so
    // `hsl(200, 120%, 50%)` is refused in the same VEL5042 wording that
    // refused `hsl(200, 120, 50)` before the slot became a `Percentage`.
    const rangeUnit = range?.[3];
    const ranged = rangeUnit === undefined ? literal
      : folded?.kind === "unit" && folded.unit === rangeUnit ? folded.value : null;
    if (range && ranged !== null && (ranged < range[1] || ranged > range[2])) {
      const unit = rangeUnit ?? "";
      host.diagnostics.push(diagnostic("VEL5042", `${range[0]} must be from ${range[1]}${unit} through ${range[2]}${unit}; ${builder} received ${ranged}${unit}`, argument.span));
    }
    if (rangeUnit === "%" && literal !== null && teachLookPercentageSlot(host.diagnostics, range![0], argument, literal, host.lookStatic.sites)) taught = true;
    const nonNegativeBlur = (builder === "blur" && position === 0) || (builder === "dropShadow" && position === 2);
    if (nonNegativeBlur && folded?.kind === "unit" && folded.value < 0) {
      host.diagnostics.push(diagnostic("VEL5042", `${builder} blur cannot be negative`, argument.span));
    }
    // LOK-D3, builder half: a unitless number in a length position is dead
    // CSS exactly as it is on a property — except in a slot whose own type
    // refuses the number outright, where core's refusal is already the report
    // and gains the remedy rather than a neighbour.
    if (LOOK_LENGTH_BUILDERS.has(builder) && literal !== null
      && teachLookLengthSlot(host.diagnostics, builder, position, declared, argument, literal, host.lookStatic.sites)) taught = true;
    if (builder === "border" && position === 2 && argument.kind === "LiteralExpression" && typeof argument.value === "string"
      && !LOOK_BORDER_STYLE_NAMES.has(argument.value)) {
      host.diagnostics.push(diagnostic("VEL5042", `Border style '${argument.value}' is not a CSS border style; use one of ${[...LOOK_BORDER_STYLE_NAMES].join(", ")}`, argument.span));
    }
    // D60 rule 150 gave `transitionProperty` a real vocabulary and the
    // charter says the builder takes the same one. It took none, so the
    // longhand's refusal taught the camelCase spelling the builder accepted
    // and the browser discarded. Routing the argument through the property's
    // own checker keeps one vocabulary and one message.
    if (builder === "transition" && position === 0) {
      validateLookStringVocabulary(host, "transitionProperty", argument, "The transition builder's property argument");
    }
    // D103 rule 4: one spelling. `color(string)` used to be the only checked
    // Look value that let a design token through, and it let it through as
    // text nobody read — so the same reference was legal on `color` and
    // refused on `width`, and the accepting half checked nothing.
    if (builder === "color" && position === 0) reportLookColorVarReference(host, expression, argument);
  }
  if (builder === "tracks" && expression.arguments.length > 1024) {
    host.diagnostics.push(diagnostic("VEL5042", "tracks cannot contain more than 1024 values", expression.span));
  }
  if (builder === "filters" && expression.arguments.length > 64) {
    host.diagnostics.push(diagnostic("VEL5042", "filters cannot compose more than 64 values", expression.span));
  }
  // D114 0.29.0 LK-I2: a call its own argument check refused is recorded so a `keyframes:` stop can drop the consequence. The record is the call rather than the code, because a bad token name and a stop's one-declaration rule are two facts about one value (D103-2) and both are still reported. A slot lesson written *into* core's refusal grows no diagnostic, so it says so itself.
  if (taught || host.diagnostics.length > before) host.refusedBuilderCalls.push(expression.span);
}

export function checkAnimateBuilderCall(host: LookAnalysisHost, expression: Extract<Expression, { kind: "CallExpression" }>): void {
  const argument = (name: string, position: number): Expression | null => {
    const named = expression.argumentNames?.findIndex((candidate) => candidate === name) ?? -1;
    if (named >= 0) return expression.arguments[named] ?? null;
    const sourceName = expression.argumentNames?.[position];
    return sourceName === null || sourceName === undefined ? expression.arguments[position] ?? null : null;
  };
  const duration = argument("duration", 1);
  const delay = argument("delay", 3);
  const count = argument("count", 4);
  const loop = argument("loop", 5);
  const easing = argument("easing", 2);
  const direction = argument("direction", 6);
  const fill = argument("fill", 7);
  const durationValue = lookDurationLiteral(duration);
  const delayValue = lookDurationLiteral(delay);
  if (durationValue !== null && durationValue <= 0) {
    host.diagnostics.push(diagnostic("VEL5060", "Animation duration must be greater than zero", duration!.span));
  }
  if (delayValue !== null && delayValue < 0) {
    host.diagnostics.push(diagnostic("VEL5060", "Animation delay cannot be negative", delay!.span));
  }
  const countValue = numericLiteral(count);
  if (countValue !== null && (!Number.isInteger(countValue) || countValue <= 0 || countValue > 1_000_000)) {
    host.diagnostics.push(diagnostic("VEL5060", "Animation count must be a positive integer no greater than 1000000", count!.span));
  }
  if (count && loop) {
    host.diagnostics.push(diagnostic("VEL5060", "animate accepts either count or loop, not both: count names the number of runs, and loop=true replaces that count with an unbounded one", expression.span));
  }
  checkAnimationKeyword(host, easing, "easing", LOOK_ANIMATION_EASINGS);
  checkAnimationKeyword(host, direction, "direction", LOOK_ANIMATION_DIRECTIONS);
  checkAnimationKeyword(host, fill, "fill", LOOK_ANIMATION_FILLS);
}

export function checkAnimationKeyword(host: LookAnalysisHost, value: Expression | null, name: string, vocabulary: ReadonlySet<string>): void {
  if (!value || value.kind !== "LiteralExpression" || typeof value.value !== "string") return;
  if (!vocabulary.has(value.value)) {
    host.diagnostics.push(diagnostic("VEL5060", `Animation ${name} '${value.value}' is not supported; use one of ${[...vocabulary].join(", ")}`, value.span));
  }
}

/** Whether a builder call this compile refused on its own arguments lies inside `sourceSpan`. */
export function refusedBuilderCallWithin(host: LookAnalysisHost, sourceSpan: Span): boolean {
  return host.refusedBuilderCalls.some((call) => call.start >= sourceSpan.start && call.end <= sourceSpan.end);
}
