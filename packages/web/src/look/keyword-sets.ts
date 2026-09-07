/**
 * The pieces `LOOK_PROPERTY_KEYWORDS` is assembled from: the keywords every CSS
 * property shares, the combinators that write out a multi-token grammar, and the
 * per-grammar value groups more than one property selects from.
 */
import { LOOK_MEDIA_SUBJECTS } from "./media.ts";
const cssWideKeywords = ["inherit", "initial", "revert", "revert-layer", "unset"];
export const keywords = (...values: readonly string[]): ReadonlySet<string> => new Set([...cssWideKeywords, ...values]);

/**
 * The five keywords every CSS property accepts. They are kept apart from a
 * property's own vocabulary so a diagnostic can lead with the values that
 * belong to the property being written (D67 rule 174).
 */
export const LOOK_CSS_WIDE_KEYWORDS: readonly string[] = Object.freeze([...cssWideKeywords]);
export const cssWideKeywordSet: ReadonlySet<string> = new Set(cssWideKeywords);

/** Shared sizing words accepted by metric properties without a property-specific table. */
export const LOOK_SHARED_METRIC_KEYWORDS: readonly string[] = Object.freeze([
  "auto", "none", "normal", "min-content", "max-content", "fit-content", "stretch",
]);

/** Named colors accepted by the checked color and background value kinds. */
export const LOOK_COLOR_KEYWORDS: readonly string[] = Object.freeze([
  ...LOOK_CSS_WIDE_KEYWORDS, "transparent", "currentColor", "black", "silver", "gray", "white", "maroon", "red", "purple",
  "fuchsia", "green", "lime", "olive", "yellow", "navy", "blue", "teal", "aqua", "orange", "aliceblue", "rebeccapurple",
]);

/**
 * Every `left right` value of a grammar that takes one token from each of two
 * positions — `y mandatory`, `left top`. D65 rule 169: a closed set holds the
 * complete value the author writes, so a multi-token CSS value is written out
 * here rather than turned into a builder or a token grammar of its own.
 */
export function lookValuePairs(left: Iterable<string>, right: Iterable<string>): readonly string[] {
  const second = [...right];
  return [...left].flatMap((first) => second.map((last) => `${first} ${last}`));
}

/**
 * Every value of a CSS `||` combination: each non-empty selection of the tokens
 * in every order the combinator accepts, so `dense row` is the same value as
 * `row dense` to the author and to the browser.
 */
export function lookValueOrderings(tokens: readonly string[]): readonly string[] {
  return tokens.flatMap((token, index) => {
    const rest = [...tokens.slice(0, index), ...tokens.slice(index + 1)];
    return [token, ...lookValueOrderings(rest).map((tail) => `${token} ${tail}`)];
  });
}

/** Every value of a `[ … ]{1,2}` repetition — `scrollSnapAlign: start end`. */
export function lookValueRepetitions(tokens: readonly string[]): readonly string[] {
  return [...tokens, ...lookValuePairs(tokens, tokens)];
}

// `<position>`'s keyword grid: one placement word, or one from each axis in
// either order. D67 rule 172: the three properties that take a `<position>` are
// all `metric`, so the length and percentage forms are the unit half of that
// kind rather than a value space anyone has to record as excluded.
const horizontalPositions = ["left", "center", "right"];
const verticalPositions = ["top", "center", "bottom"];
export const positionKeywords = [
  ...horizontalPositions, ...verticalPositions,
  ...lookValuePairs(horizontalPositions, verticalPositions),
  ...lookValuePairs(verticalPositions, horizontalPositions),
];

// The line part of the text-decoration family, written once: `textDecoration`
// is the shorthand whose only closed part is this one (D57 rule 134).
export const textDecorationLineKeywords = ["none", ...lookValueOrderings(["underline", "overline", "line-through"])];

// The predefined counter styles of CSS Counter Styles 3 §6, by its own
// grouping. A `<string>` marker and a custom `@counter-style` name are the open
// part and are recorded as excluded.
export const listStyleTypeKeywords = [
  "none",
  // §6.1 numeric
  "decimal", "decimal-leading-zero", "arabic-indic", "armenian", "upper-armenian", "lower-armenian", "bengali",
  "cambodian", "khmer", "cjk-decimal", "devanagari", "georgian", "gujarati", "gurmukhi", "hebrew", "kannada", "lao",
  "malayalam", "mongolian", "myanmar", "oriya", "persian", "lower-roman", "upper-roman", "tamil", "telugu", "thai", "tibetan",
  // §6.2 alphabetic
  "lower-alpha", "lower-latin", "upper-alpha", "upper-latin", "lower-greek",
  "hiragana", "hiragana-iroha", "katakana", "katakana-iroha",
  // §6.3 symbolic
  "disc", "circle", "square", "disclosure-open", "disclosure-closed",
  // §6.4 fixed
  "cjk-earthly-branch", "cjk-heavenly-stem",
  // §6.5 complex, and the two aliases CSS 2.1 shipped
  "japanese-informal", "japanese-formal", "korean-hangul-formal", "korean-hanja-informal", "korean-hanja-formal",
  "simp-chinese-informal", "simp-chinese-formal", "trad-chinese-informal", "trad-chinese-formal",
  "cjk-ideographic", "ethiopic-numeric",
];
export const listStylePositionKeywords = ["inside", "outside"];

// `color-scheme` names the same two schemes `if scheme.dark:` conditions on, so
// it reads that table rather than restating it. `only` may lead or trail the
// scheme list.
export const colorSchemeOrderings = lookValueOrderings([...LOOK_MEDIA_SUBJECTS.get("scheme") ?? []]);

export const scrollSnapAxes = ["x", "y", "block", "inline", "both"];
export const overscrollBehaviors = ["auto", "contain", "none"];

// CSS Box Alignment 3's shared value groups. Nine Look properties select from
// them, and each selects a different combination, so the groups are written
// once and the nine read them (D57 rule 134). The `<overflow-position>` safe
// and unsafe prefixes are the part no set holds, and every one of the nine
// records it. D67 rule 173: `self-start`, `self-end` and the baseline
// positions are real values all nine used to refuse.
export const alignBaselinePositions = ["baseline", "first baseline", "last baseline"];
export const alignSelfPositions = ["center", "start", "end", "self-start", "self-end", "flex-start", "flex-end"];
export const alignContentPositions = ["center", "start", "end", "flex-start", "flex-end"];
export const alignContentDistributions = ["space-between", "space-around", "space-evenly", "stretch"];

// `touch-action`'s single tokens, including the four one-way pans and the pinch
// gesture. D67 rule 173: the property published five of these ten, so
// `pan-left` and `pinch-zoom` -- values a scroll container really takes -- were
// refused. The `||` combinations of a horizontal pan, a vertical pan and
// pinch-zoom are the part no set holds and are recorded as excluded.
export const touchActionKeywords = [
  "auto", "none", "pan-x", "pan-left", "pan-right", "pan-y", "pan-up", "pan-down", "pinch-zoom", "manipulation",
];

// `background-repeat`'s `<repeat-style>`: the two one-axis shorthands, or one
// token per axis. D67 rule 173: `backgroundRepeat = "repeat no-repeat"` is the
// ordinary way to repeat on one axis only, and the set used to hold six of the
// twenty-two values that spell it.
export const backgroundRepeatKeywords = [
  "repeat-x", "repeat-y", ...lookValueRepetitions(["repeat", "space", "round", "no-repeat"]),
];
