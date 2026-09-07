/**
 * What a Look value may be written as, and the sentence that says so when it is
 * written as something else: the multi-token shorthand strings that have a
 * checked builder equivalent, the CSS filter functions that rewrite into filter
 * builders, and the keyword vocabulary a property publishes once a written
 * value falls outside it.
 *
 * D115 P4 R3a: this is the Look *vocabulary* half of the analyzer's Look work —
 * a value and a property name in, a rewrite or a sentence out — and it reads
 * nothing the analyzer is carrying, so it reads as a module.
 */
import { type Expression } from "@velarscript/compiler/extension";
import {
  LOOK_BORDER_STYLE_NAMES,
  LOOK_BUILDER_NUMERIC_RANGES,
  LOOK_COLOR_KEYWORDS,
  LOOK_CSS_WIDE_KEYWORDS,
  LOOK_LARGE_KEYWORD_SETS,
  LOOK_SHARED_METRIC_KEYWORDS,
  lookShorthandParts,
  nearestLookName,
  type LookPropertyValueKind,
} from "../look.ts";

// Multi-token shorthand strings on properties with a checked builder
// equivalent bypass the builder system, so they are rejected with directive
// guidance that computes the builder call whenever the string decomposes
// cleanly. Single-token keyword strings and hex color strings stay accepted.
const lookSpacingFamily = /^(?:margin|padding|inset)/u;
const lookSpacingProperties = new Set(["borderRadius", "borderWidth"]);
const lookBorderProperties = new Set(["border", "borderTop", "borderRight", "borderBottom", "borderLeft", "outline"]);
// The border() builder's guard, the five border-style properties and this
// shorthand reader are one vocabulary, so they read one table (D57 rule 134).
const lookBorderStyles = LOOK_BORDER_STYLE_NAMES;

function lookBuilderToken(token: string): string {
  if (/^[+-]?\d+(?:\.\d+)?$/u.test(token)) return `${token}px`;
  if (/^[+-]?\d+(?:\.\d+)?[a-z%]+$/iu.test(token)) return token;
  return `"${token}"`;
}

export function numericLiteral(expression: Expression | null): number | null {
  if (expression?.kind === "LiteralExpression" && typeof expression.value === "number") return expression.value;
  if (expression?.kind === "UnaryExpression" && expression.operator === "-"
    && expression.operand.kind === "LiteralExpression" && typeof expression.operand.value === "number") {
    return -expression.operand.value;
  }
  return null;
}

function coreDurationLiteral(expression: Expression | null): { readonly value: number; readonly unit: "ms" | "s"; readonly raw: string } | null {
  if (expression?.kind !== "ExtensionExpression:core:duration") return null;
  return expression as Expression & { readonly value: number; readonly unit: "ms" | "s"; readonly raw: string };
}

export function lookDurationLiteral(expression: Expression | null): number | null {
  const direct = coreDurationLiteral(expression);
  if (direct) {
    return direct.value * (direct.unit === "s" ? 1000 : 1);
  }
  const operand = expression?.kind === "UnaryExpression" ? coreDurationLiteral(expression.operand) : null;
  if (expression?.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-") && operand) {
    const value = operand.value * (operand.unit === "s" ? 1000 : 1);
    return expression.operator === "-" ? -value : value;
  }
  return null;
}

function lookBorderCall(tokens: readonly string[]): string | null {
  let width: string | null = null;
  let style: string | null = null;
  let color: string | null = null;
  for (const token of tokens) {
    if (/^[+-]?\d/u.test(token) && width === null) width = lookBuilderToken(token);
    else if (lookBorderStyles.has(token) && style === null) style = token;
    else if (color === null && /^#[0-9a-f]{3,8}$/iu.test(token)) color = `color("${token}")`;
    else if (color === null && /^[a-z]+$/iu.test(token)) color = `color("${token}")`;
    else return null;
  }
  if (width === null || color === null) return null;
  const buildArguments = style !== null && style !== "solid" ? `${width}, ${color}, "${style}"` : `${width}, ${color}`;
  return `border(${buildArguments})`;
}

export function lookShorthandStringGuidance(name: string, value: Expression): string | null {
  if (value.kind !== "LiteralExpression" || typeof value.value !== "string") return null;
  const text = value.value.trim();
  if ((name === "gridTemplateColumns" || name === "gridTemplateRows") && text !== "none") {
    return "Use the tracks(...) builder for grid templates; for example, write tracks(240px, minmax(0px, 1fr)) instead of CSS track-list text";
  }
  if (name === "backgroundImage" && /^linear-gradient\s*\(/iu.test(text)) {
    return "Use linearGradient(angle, start, end); for example linearGradient(90deg, color(\"red\"), color(\"blue\")) instead of gradient text";
  }
  if (!/\s/u.test(text)) return null;
  const tokens = text.split(/\s+/u);
  if (lookSpacingFamily.test(name) || lookSpacingProperties.has(name)) {
    return `Use 'spacing(${tokens.map(lookBuilderToken).join(", ")})'; Look multi-value shorthand is written with the spacing builder`;
  }
  if (lookBorderProperties.has(name)) {
    const call = lookBorderCall(tokens);
    return call
      ? `Use '${call}'; Look border shorthand is written with the border builder`
      : "Use the 'border(width, color, style)' builder; multi-part border strings bypass the checked Look system";
  }
  if (name === "boxShadow") {
    return "Use the 'shadow(x, y, blur, color)' builder; multi-part shadow strings bypass the checked Look system";
  }
  if (name === "transition") {
    const [property, duration, easing, delay] = tokens;
    const durations = /^[+-]?\d+(?:\.\d+)?(?:ms|s)$/u;
    if (property && duration && durations.test(duration) && tokens.length <= 4
      && (easing === undefined || /^[a-z-]+$/iu.test(easing))
      && (delay === undefined || durations.test(delay))) {
      const buildArguments = [`"${property}"`, duration, ...easing ? [`"${easing}"`] : [], ...delay ? [delay] : []];
      return `Use 'transition(${buildArguments.join(", ")})'; Look transition shorthand is written with the transition builder`;
    }
    return "Use the 'transition(property, duration, easing, delay)' builder; multi-part transition strings bypass the checked Look system";
  }
  return null;
}

export interface LookFilterRewrite {
  readonly call: string;
  readonly builders: readonly string[];
}

interface CssFunctionValue {
  readonly name: string;
  readonly arguments: string;
}

const lookSimpleFilterBuilders: ReadonlyMap<string, { readonly builder: string; readonly argument: "angle" | "length" | "number" }> = new Map([
  ["blur", { builder: "blur", argument: "length" }],
  ["brightness", { builder: "brightness", argument: "number" }],
  ["contrast", { builder: "contrast", argument: "number" }],
  ["grayscale", { builder: "grayscale", argument: "number" }],
  ["hue-rotate", { builder: "hueRotate", argument: "angle" }],
  ["invert", { builder: "invert", argument: "number" }],
  ["opacity", { builder: "filterOpacity", argument: "number" }],
  ["saturate", { builder: "saturate", argument: "number" }],
  ["sepia", { builder: "sepia", argument: "number" }],
]);

function cssFunctionValues(text: string): readonly CssFunctionValue[] | null {
  const values: CssFunctionValue[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && /\s/u.test(text[cursor]!)) cursor += 1;
    if (cursor === text.length) break;
    const matched = /^([a-z-]+)\(/iu.exec(text.slice(cursor));
    if (!matched) return null;
    const name = matched[1]!.toLowerCase();
    const start = cursor + matched[0].length;
    let depth = 1;
    let quote: "\"" | "'" | null = null;
    let escaped = false;
    cursor = start;
    while (cursor < text.length && depth > 0) {
      const character = text[cursor]!;
      if (escaped) escaped = false;
      else if (quote && character === "\\") escaped = true;
      else if (quote && character === quote) quote = null;
      else if (!quote && (character === "\"" || character === "'")) quote = character;
      else if (!quote && character === "(") depth += 1;
      else if (!quote && character === ")") depth -= 1;
      cursor += 1;
    }
    if (depth !== 0 || quote) return null;
    values.push({ name, arguments: text.slice(start, cursor - 1).trim() });
    if (cursor < text.length && !/\s/u.test(text[cursor]!)) return null;
  }
  return values.length > 0 ? values : null;
}

function topLevelWords(text: string): readonly string[] | null {
  const words: string[] = [];
  let start = 0;
  let depth = 0;
  for (let cursor = 0; cursor <= text.length; cursor += 1) {
    const character = text[cursor];
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if ((character === undefined || /\s/u.test(character)) && depth === 0) {
      const word = text.slice(start, cursor).trim();
      if (word) words.push(word);
      start = cursor + 1;
    }
  }
  return depth === 0 ? words : null;
}

function filterLength(text: string): string | null {
  return /^(?:0|\+?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|vw|vh|vmin|vmax))$/u.test(text)
    ? lookBuilderToken(text)
    : null;
}

function filterNumericArgumentsHold(builder: string, values: readonly string[]): boolean {
  const ranges = LOOK_BUILDER_NUMERIC_RANGES.get(builder);
  return values.every((value, index) => {
    const range = ranges?.[index];
    const numeric = Number(value);
    return Number.isFinite(numeric) && (!range || (numeric >= range[1] && numeric <= range[2]));
  });
}

function filterColor(text: string): LookFilterRewrite | null {
  if (/^#[0-9a-f]{3,8}$/iu.test(text) || /^[a-z]+$/iu.test(text)) {
    return { call: `color(${JSON.stringify(text)})`, builders: ["color"] };
  }
  const functional = /^(rgb|rgba)\((.*)\)$/iu.exec(text);
  if (!functional) return null;
  const channels = functional[2]!.split(",").map((channel) => channel.trim());
  const expected = functional[1]!.toLowerCase() === "rgb" ? 3 : 4;
  if (channels.length !== expected || channels.some((channel) => !/^\+?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(channel))) return null;
  const builder = functional[1]!.toLowerCase();
  if (!filterNumericArgumentsHold(builder, channels)) return null;
  return { call: `${builder}(${channels.join(", ")})`, builders: [builder] };
}

function filterFunctionRewrite(value: CssFunctionValue): LookFilterRewrite | null {
  const simple = lookSimpleFilterBuilders.get(value.name);
  if (simple) {
    const argument = simple.argument === "length"
      ? filterLength(value.arguments)
      : simple.argument === "angle"
        ? (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|turn)$/u.test(value.arguments) ? value.arguments : null)
        : (/^\+?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(value.arguments)
            && filterNumericArgumentsHold(simple.builder, [value.arguments]) ? value.arguments : null);
    return argument === null ? null : { call: `${simple.builder}(${argument})`, builders: [simple.builder] };
  }
  if (value.name !== "drop-shadow") return null;
  const words = topLevelWords(value.arguments);
  if (!words || words.length !== 4) return null;
  const lengths = words.slice(0, 3).map(filterLength);
  const color = filterColor(words[3]!);
  if (lengths.some((length) => length === null) || !color) return null;
  return {
    call: `dropShadow(${lengths.join(", ")}, ${color.call})`,
    builders: ["dropShadow", ...color.builders],
  };
}

export function lookFilterRewrite(text: string): LookFilterRewrite | null {
  const functions = cssFunctionValues(text.trim());
  if (!functions) return null;
  const rewritten = functions.map(filterFunctionRewrite);
  if (rewritten.some((item) => item === null)) return null;
  const calls = rewritten as readonly LookFilterRewrite[];
  const builders = [...new Set(calls.flatMap((item) => item.builders))];
  if (calls.length === 1) return { call: calls[0]!.call, builders };
  return { call: `filters(${calls.map((item) => item.call).join(", ")})`, builders: ["filters", ...builders] };
}

/**
 * D104 rule 2 — what a refusal says when two entries in one scope write the
 * same CSS declaration. Written once because two positions raise it: a Look
 * block's entries and an element's `look:` directives lower to the same
 * one-rule-per-property stylesheet, so they have the same defect and deserve
 * the same sentence (D57 rule 134).
 *
 * The message leads with the mechanism, because the pair is legal CSS and the
 * author has every reason to expect source order to settle it. It does not
 * here: see LOOK_SHORTHAND_LONGHANDS for why the winner is decided module-wide.
 */
export function lookShorthandOverlapMessage(shorthand: string, longhand: string, subject: string): string {
  const parts = lookShorthandParts(shorthand);
  return `${subject} sets '${shorthand}' and '${longhand}', and the shorthand writes the longhand. Look lowers every entry to its own CSS rule and orders those rules by where each property first appears in the module rather than by this block, so which of the two wins is not this code's to choose — an unrelated look elsewhere in the module decides it. Write ${parts.join(", ")} in place of '${shorthand}', or drop '${longhand}'`;
}

export const lookCssWideKeywords = new Set(LOOK_CSS_WIDE_KEYWORDS);
export const lookMetricKeywords = new Set([...lookCssWideKeywords, ...LOOK_SHARED_METRIC_KEYWORDS]);
/**
 * D73 rule 187: what a refusal says the property's *other* half is, so the
 * keyword list it goes on to print reads as the keyword half of a real value
 * space rather than as the whole of it.
 */
export function lookVocabularyLead(kind: LookPropertyValueKind): string {
  switch (kind) {
    case "border": return "use the border(width, color, style) builder, or one of";
    case "shadow": return "use the shadow(x, y, blur, color) builder, or one of";
    case "angle": return "write an angle such as 45deg or 0.25turn, or one of";
    case "duration": return "write a duration such as 200ms or 0.3s, or one of";
    case "line-height": return "write a number or a length such as 1.5 or 24px, or one of";
    case "number": return "write a number, or one of";
    case "number-keyword": return "write a number, or one of";
    case "track": return "use the tracks(...) builder, or one of";
    case "transition": return "use the transition(property, duration, easing, delay) builder, or one of";
    default: return "write one of";
  }
}
export const lookColorKeywords = new Set(LOOK_COLOR_KEYWORDS);

/**
 * D67 rule 174 — what a rejected Look string could have been.
 *
 * The message this replaces said "use one of the closed `name` keywords" and
 * stopped there, so the answer to "which ones?" lived only in the source of the
 * table. The evidence that this is not a hypothetical reader problem is that
 * the usage tour — written by someone who knew the design intent — shipped
 * twelve values no property had, and this diagnostic could not have told him.
 *
 * A near miss gets the one spelling meant, because naming the single correct
 * word is the strongest form of the promise. Otherwise a set small enough to
 * read is written out whole, and a larger one says what it holds. The CSS-wide
 * keywords join the search either way, so a misspelled `inherit` is caught the
 * same as a misspelled `groove`.
 */
export function lookVocabularyGuidance(property: string, written: string, own: readonly string[], lead: string): LookValueGuidance {
  const vocabulary = [...new Set([...own, ...LOOK_CSS_WIDE_KEYWORDS])];
  const nearest = nearestLookName(written, vocabulary);
  if (nearest !== null) return { text: `did you mean '${nearest}'?`, named: true };
  const shape = LOOK_LARGE_KEYWORD_SETS.get(property);
  return {
    text: shape === undefined
      ? `${lead} ${vocabulary.join(", ")}`
      : `${lead} ${shape}, and none of them is spelled close to '${written}'`,
    named: false,
  };
}

export interface LookValueGuidance {
  /** The clause that follows "does not accept 'value';". */
  readonly text: string;
  /**
   * Whether the clause named the one spelling the author meant. When it did,
   * the property's recorded exclusion is left off: the record answers "why is
   * my value not here?", and that question is not the one a misspelling asks.
   */
  readonly named: boolean;
}

/**
 * Every string this expression can be when it is written out of literals alone
 * — one literal, or a ternary whose branches are literals all the way down.
 * Answers null when a value is decided anywhere else, which is the signal that
 * a check reading it has nothing static to look at.
 */
export function literalStringValues(expression: Expression): readonly string[] | null {
  if (expression.kind === "LiteralExpression") return typeof expression.value === "string" ? [expression.value] : [];
  if (expression.kind === "ConditionalExpression") {
    const thenValues = literalStringValues(expression.thenValue);
    const elseValues = literalStringValues(expression.elseValue);
    return thenValues && elseValues ? [...thenValues, ...elseValues] : null;
  }
  return null;
}
