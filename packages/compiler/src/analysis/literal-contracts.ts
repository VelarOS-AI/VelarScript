/**
 * Runtime contracts checked against a literal or a proved scalar constant.
 *
 * `"ab".repeat(-1)`, `"abc".char(1.5)` and `Text.findMatch(value, "([")` are
 * decided the moment they are written: the argument is known, the contract
 * is the compiler's own, and the only thing running the program adds is the
 * delay. Nothing here changes what a program means — every message is the
 * sentence the runtime guard would raise, and a non-literal argument is left to
 * that guard, which still runs.
 *
 * The analyzer supplies its bounded lexical constant reader. A call, mutable
 * value or unproved expression remains the runtime guard's responsibility.
 * The sentences are quoted from `packages/compiler/runtime/text.js` and
 * `packages/core/src/index.ts`; the pattern failure asks the same engine the
 * runtime asks, so the reason clause is the engine's own.
 */
import { type Expression } from "../ast.ts";
import { MAX_TEXT_CODE_UNITS, MAX_TEXT_PATTERN_CODE_UNITS } from "../limits.ts";
import type { ConstantValue } from "./constant-values.ts";

/**
 * The literal value an argument is, or `undefined` where it is not a literal.
 * A negative number is a unary minus over a literal, and `-1` is exactly the
 * argument these contracts exist to catch.
 */
function literalValue(argument: Expression | undefined): string | number | boolean | null | undefined {
  if (argument?.kind === "LiteralExpression") return argument.value;
  if (argument?.kind === "UnaryExpression" && argument.operator === "-"
    && argument.operand.kind === "LiteralExpression" && typeof argument.operand.value === "number") {
    return -argument.operand.value;
  }
  return undefined;
}

/** `String.<member>`'s own count and index contracts, for a literal argument. */
export function stringMemberLiteralFailure(
  member: string,
  arguments_: readonly (Expression | undefined)[],
  read: (expression: Expression) => ConstantValue | undefined = literalValue,
): { readonly message: string; readonly argument: Expression } | null {
  const integerPositions: readonly number[] = member === "char" || member === "repeat" || member === "padStart" || member === "padEnd"
    ? [0]
    : member === "slice"
      ? [0, 1]
      : member === "index"
        ? [1]
        : [];
  for (const index of integerPositions) {
    const argument = arguments_[index];
    const value = argument ? read(argument) : undefined;
    if (argument === undefined || typeof value !== "number") continue;
    const counted = member === "repeat" || member === "padStart" || member === "padEnd";
    const name = member === "repeat"
      ? "String.repeat count"
      : member === "padStart" || member === "padEnd"
        ? `String.${member} size`
        : member === "char"
          ? "String.char index"
          : member === "index"
            ? "String.index start"
            : "String.slice positions";
    if (counted) {
      if (Number.isSafeInteger(value) && value >= 0 && value <= MAX_TEXT_CODE_UNITS) continue;
      return { message: `${name} must be an integer from 0 through ${MAX_TEXT_CODE_UNITS}`, argument };
    }
    if (!Number.isInteger(value)) {
      return { message: member === "slice" ? `${name} must be integers` : `${name} must be an integer`, argument };
    }
    // CO-U4: `char` reads forwards, so a negative index names a position that
    // cannot exist. `slice` and `index` do count from the end, and keep it.
    if (member === "char" && value < 0) {
      return { message: `${name} ${value} is out of range; the index domain is 0 through size - 1`, argument };
    }
  }
  return null;
}

/** Which argument of a `Text.` member is the pattern, when one is. */
const textPatternPositions: ReadonlyMap<string, number> = new Map([
  ["matches", 1], ["findMatch", 1], ["findMatches", 1], ["replaceMatches", 1], ["splitPattern", 1],
]);

/** `Text.<member>`'s pattern contract, for a literal pattern. */
export function textPatternLiteralFailure(
  member: string,
  arguments_: readonly Expression[],
  read: (expression: Expression) => ConstantValue | undefined = literalValue,
  argumentNames?: readonly (string | null)[],
): { readonly message: string; readonly argument: Expression } | null {
  const position = textPatternPositions.get(member);
  if (position === undefined) return null;
  const named = argumentNames?.indexOf("expression") ?? -1;
  const argument = named >= 0 ? arguments_[named] : argumentNames?.[position] == null ? arguments_[position] : undefined;
  const pattern = argument ? read(argument) : undefined;
  if (argument === undefined || typeof pattern !== "string") return null;
  if (pattern.length > MAX_TEXT_PATTERN_CODE_UNITS) {
    return { message: `text patterns cannot exceed ${MAX_TEXT_PATTERN_CODE_UNITS} code units`, argument };
  }
  try {
    // The same construction the runtime performs, under the same flag, so the
    // reason clause below is the engine's own words rather than a paraphrase.
    void new RegExp(pattern, "u");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const detail = /Invalid regular expression: [^:]*: (.*)$/u.exec(reason)?.[1] ?? null;
    return { message: `Invalid text pattern${detail === null ? "" : `: ${detail}`}`, argument };
  }
  return null;
}
