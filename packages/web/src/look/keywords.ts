/**
 * Every property's own closed value set, what a diagnostic does with a set too
 * long to write out, and the two records of what the closure deliberately leaves
 * open — per value, and per property.
 */
import { LOOK_ANIMATION_EASINGS } from "./animation.ts";
import { LOOK_BORDER_STYLE_NAMES, LOOK_BUILDER_SIGNATURES } from "./builders.ts";
import { LOOK_TRANSITION_PROPERTY_KEYWORDS } from "./css-functions.ts";
import {
  alignBaselinePositions,
  alignContentDistributions,
  alignContentPositions,
  alignSelfPositions,
  backgroundRepeatKeywords,
  colorSchemeOrderings,
  cssWideKeywordSet,
  keywords,
  listStylePositionKeywords,
  listStyleTypeKeywords,
  LOOK_COLOR_KEYWORDS,
  LOOK_CSS_WIDE_KEYWORDS,
  LOOK_SHARED_METRIC_KEYWORDS,
  lookValueOrderings,
  lookValuePairs,
  lookValueRepetitions,
  overscrollBehaviors,
  positionKeywords,
  scrollSnapAxes,
  textDecorationLineKeywords,
  touchActionKeywords,
} from "./keyword-sets.ts";
import { LOOK_PROPERTY_VALUE_KINDS, type LookPropertyValueKind } from "./properties.ts";
export const LOOK_PROPERTY_KEYWORDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  // D67 rule 173: `list-item` is a real display type with no other spelling, so
  // it joins the set. The two-keyword form does not: every pair it writes has a
  // single-keyword name already here, and the table and ruby display types stay
  // out with the table formatting properties LOOK_EXCLUDED_PROPERTIES excludes.
  ["display", keywords("none", "block", "inline", "inline-block", "flow-root", "flex", "inline-flex", "grid", "inline-grid", "contents", "list-item")],
  ["isolation", keywords("auto", "isolate")],
  ["contain", keywords("none", "strict", "content", "size", "inline-size", "layout", "style", "paint")],
  ["backgroundSize", keywords("auto", "cover", "contain")],
  // D67 rule 172: `backgroundPosition`, `transformOrigin` and `objectPosition`
  // are one CSS grammar, so they are one `metric` kind reading one table. The
  // two that used to hold five of the twenty-two placements refused
  // `backgroundPosition = "top left"`, a value the property really has.
  ["backgroundPosition", keywords(...positionKeywords)],
  ["transformOrigin", keywords(...positionKeywords)],
  ["objectPosition", keywords(...positionKeywords)],
  ["transitionProperty", LOOK_TRANSITION_PROPERTY_KEYWORDS],
  ["transitionTimingFunction", keywords(...LOOK_ANIMATION_EASINGS)],
  ["position", keywords("static", "relative", "absolute", "fixed", "sticky")],
  ["boxSizing", keywords("content-box", "border-box")],
  ["visibility", keywords("visible", "hidden", "collapse")],
  ["overflow", keywords("visible", "hidden", "clip", "scroll", "auto")],
  ["overflowX", keywords("visible", "hidden", "clip", "scroll", "auto")],
  ["overflowY", keywords("visible", "hidden", "clip", "scroll", "auto")],
  ["objectFit", keywords("fill", "contain", "cover", "none", "scale-down")],
  ["flexDirection", keywords("row", "row-reverse", "column", "column-reverse")],
  ["flexWrap", keywords("nowrap", "wrap", "wrap-reverse")],
  // Each of the nine takes a different selection of the alignment groups, and
  // the differences are the property's own grammar rather than an oversight:
  // `justifyContent` has no baseline position, `alignContent` has no
  // self-position, and the three `place*` shorthands take only what both of
  // their halves take.
  ["alignItems", keywords("normal", "stretch", ...alignBaselinePositions, ...alignSelfPositions)],
  ["alignContent", keywords("normal", ...alignBaselinePositions, ...alignContentDistributions, ...alignContentPositions)],
  ["alignSelf", keywords("auto", "normal", "stretch", ...alignBaselinePositions, ...alignSelfPositions)],
  ["justifyItems", keywords("normal", "stretch", ...alignBaselinePositions, ...alignSelfPositions, "left", "right")],
  ["justifyContent", keywords("normal", ...alignContentDistributions, ...alignContentPositions, "left", "right")],
  ["justifySelf", keywords("auto", "normal", "stretch", ...alignBaselinePositions, ...alignSelfPositions, "left", "right")],
  ["placeItems", keywords("normal", "stretch", ...alignBaselinePositions, ...alignSelfPositions)],
  ["placeContent", keywords("normal", ...alignContentDistributions, ...alignContentPositions)],
  ["placeSelf", keywords("auto", "normal", "stretch", ...alignBaselinePositions, ...alignSelfPositions)],
  // D67 rule 173: `all-scroll` was the one CSS Basic UI cursor keyword missing.
  ["cursor", keywords("auto", "default", "none", "context-menu", "help", "pointer", "progress", "wait", "cell", "crosshair", "text", "vertical-text", "alias", "copy", "move", "no-drop", "not-allowed", "grab", "grabbing", "all-scroll", "col-resize", "row-resize", "n-resize", "e-resize", "s-resize", "w-resize", "ne-resize", "nw-resize", "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize", "nwse-resize", "zoom-in", "zoom-out")],
  ["textAlign", keywords("start", "end", "left", "right", "center", "justify", "match-parent")],
  ["textTransform", keywords("none", "capitalize", "uppercase", "lowercase", "full-width", "full-size-kana")],
  ["textDecoration", keywords(...textDecorationLineKeywords)],
  ["whiteSpace", keywords("normal", "pre", "nowrap", "pre-wrap", "pre-line", "break-spaces")],
  ["textOverflow", keywords("clip", "ellipsis")],
  ["textWrap", keywords("wrap", "nowrap", "balance", "pretty", "stable")],
  ["overflowWrap", keywords("normal", "break-word", "anywhere")],
  ["wordBreak", keywords("normal", "break-all", "keep-all", "break-word")],
  ["hyphens", keywords("none", "manual", "auto")],
  ["listStyle", keywords(...listStyleTypeKeywords, ...listStylePositionKeywords)],
  ["resize", keywords("none", "both", "horizontal", "vertical", "block", "inline")],
  ["pointerEvents", keywords("auto", "none", "visiblePainted", "visibleFill", "visibleStroke", "visible", "painted", "fill", "stroke", "all")],
  ["userSelect", keywords("auto", "text", "none", "contain", "all")],
  ["touchAction", keywords(...touchActionKeywords)],
  ["appearance", keywords("none", "auto", "textfield", "menulist-button")],
  ["scrollBehavior", keywords("auto", "smooth")],
  ["scrollbarWidth", keywords("auto", "thin", "none")],
  ["backgroundRepeat", keywords(...backgroundRepeatKeywords)],
  ["backgroundAttachment", keywords("scroll", "fixed", "local")],
  ["backgroundClip", keywords("border-box", "padding-box", "content-box", "text")],
  ["backgroundOrigin", keywords("border-box", "padding-box", "content-box")],
  // D104 rule 3: the property an inline badge sits on. It is `metric` because
  // its non-keyword half is a length or a percentage of the line height, and it
  // carries its own table for the same reason `backgroundSize` does — the
  // shared sizing words are not its vocabulary. CSS 2.1 §10.8.1 is the whole
  // set, and nothing is recorded as left out: CSS Inline Layout 3's `first` and
  // `last` baseline sources are unimplemented everywhere, and a `metric`
  // property records no partial exclusion for the reason D67 rule 172 revoked
  // `objectPosition`'s — the lengths are the unit half of the kind rather than
  // a value space to record.
  ["verticalAlign", keywords("baseline", "sub", "super", "text-top", "text-bottom", "middle", "top", "bottom")],
  ["fontStyle", keywords("normal", "italic", "oblique")],
  ["fontKerning", keywords("auto", "normal", "none")],
  ["fontOpticalSizing", keywords("auto", "none")],
  ["writingMode", keywords("horizontal-tb", "vertical-rl", "vertical-lr")],
  ["textOrientation", keywords("mixed", "upright", "sideways")],
  ["direction", keywords("ltr", "rtl")],
  ["unicodeBidi", keywords("normal", "embed", "isolate", "bidi-override", "isolate-override", "plaintext")],

  // ── D65 rule 168 ────────────────────────────────────────────────────────
  // Every entry below used to be absent, and a keyword property with no
  // vocabulary of its own fell back to a shared list that knew nothing about
  // it: it refused `borderStyle = "groove"` and accepted `strokeLinecap =
  // "none"`, which reaches the browser as a declaration it discards. A value
  // set that already exists in another table is read from that table rather
  // than restated (D57 rule 134).
  ["gridAutoFlow", keywords(...lookValueOrderings(["row", "dense"]), ...lookValueOrderings(["column", "dense"]))],
  ["backgroundBlendMode", keywords("normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity")],
  // The five border-style properties and the border() builder's style argument
  // are one vocabulary, so they are one table.
  ...["borderStyle", "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle"]
    .map((property) => [property, keywords(...LOOK_BORDER_STYLE_NAMES)] as const),
  // An outline takes the border styles plus `auto`, minus `hidden`: CSS Basic
  // UI says `hidden` is not a legal outline style, and a border table read
  // straight through would have published a twenty-seventh dead value.
  ["outlineStyle", keywords(...[...LOOK_BORDER_STYLE_NAMES].filter((style) => style !== "hidden"), "auto")],
  ["fontStretch", keywords("normal", "ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "semi-expanded", "expanded", "extra-expanded", "ultra-expanded")],
  // Every single-token value of the shorthand's six sub-properties: position,
  // caps, numeric, alternates, ligatures, and East Asian.
  ["fontVariant", keywords(
    "normal", "none", "sub", "super",
    "small-caps", "all-small-caps", "petite-caps", "all-petite-caps", "titling-caps", "unicase",
    "lining-nums", "oldstyle-nums", "proportional-nums", "tabular-nums", "diagonal-fractions", "stacked-fractions", "ordinal", "slashed-zero",
    "historical-forms",
    "common-ligatures", "no-common-ligatures", "discretionary-ligatures", "no-discretionary-ligatures",
    "historical-ligatures", "no-historical-ligatures", "contextual", "no-contextual",
    "jis78", "jis83", "jis90", "jis04", "simplified", "traditional", "full-width", "proportional-width", "ruby",
  )],
  ["textDecorationLine", keywords(...textDecorationLineKeywords)],
  ["textDecorationStyle", keywords("solid", "double", "dotted", "dashed", "wavy")],
  ["textUnderlinePosition", keywords("auto", "from-font", ...lookValueOrderings(["under", "left"]), ...lookValueOrderings(["under", "right"]))],
  ["textRendering", keywords("auto", "optimizeSpeed", "optimizeLegibility", "geometricPrecision")],
  ["listStyleType", keywords(...listStyleTypeKeywords)],
  ["listStylePosition", keywords(...listStylePositionKeywords)],
  ["strokeLinecap", keywords("butt", "round", "square")],
  ["strokeLinejoin", keywords("miter", "round", "bevel")],
  ["colorScheme", keywords("normal", ...colorSchemeOrderings.flatMap((schemes) => [schemes, `only ${schemes}`, `${schemes} only`]))],
  ["scrollSnapAlign", keywords(...lookValueRepetitions(["none", "start", "end", "center"]))],
  ["scrollSnapStop", keywords("normal", "always")],
  ["scrollSnapType", keywords("none", ...scrollSnapAxes, ...lookValuePairs(scrollSnapAxes, ["mandatory", "proximity"]))],
  ["overscrollBehavior", keywords(...lookValueRepetitions(overscrollBehaviors))],
  ["overscrollBehaviorX", keywords(...overscrollBehaviors)],
  ["overscrollBehaviorY", keywords(...overscrollBehaviors)],

  // ── D73 rule 187: the kinds outside `keyword` that also decide a string ────
  // Each of these used to be answered by a 46-word list shared across every
  // property that had no table of its own. That list both accepted values the
  // property never had — `fontWeight = "circle"` compiled and reached CSS as a
  // declaration the browser drops — and made the diagnostic promise "the closed
  // fontWeight keywords", a table that did not exist. The sets below come from
  // the CSS grammar of each property; what the grammar leaves open is recorded
  // in LOOK_PARTIAL_KEYWORD_PROPERTIES rather than waved through.

  // The shorthands whose non-keyword values are written with a builder. `none`
  // is the whole of their keyword half.
  ...(["border", "borderTop", "borderRight", "borderBottom", "borderLeft", "outline"] as const)
    .map((property) => [property, keywords("none")] as const),
  ["boxShadow", keywords("none")],
  ["textShadow", keywords("none")],

  // CSS Fonts 4: the four named weights. The numeric half is the `number` this
  // property's type already accepts.
  ["fontWeight", keywords("normal", "bold", "bolder", "lighter")],
  ["aspectRatio", keywords("auto")],
  ["scale", keywords("none")],
  // CSS Flexbox 1: the single-token forms of the shorthand — `none`, and the
  // `<'flex-basis'>` keywords, which are the sizing words.
  ["flex", keywords("none", "auto", "content", "min-content", "max-content", "fit-content")],
  ["lineHeight", keywords("normal")],
  ["rotate", keywords("none")],

  // CSS Transitions: `<time>#`. There is no keyword half at all, so the closed
  // set is the CSS-wide words and nothing else — which is a truthful answer
  // where "one of the closed keywords" was not.
  ["transitionDuration", keywords()],
  ["transitionDelay", keywords()],
  ["transition", keywords("none")],

  ["opacity", keywords()],
  ["zIndex", keywords("auto")],
  ["flexGrow", keywords()],
  ["flexShrink", keywords()],
  ["order", keywords()],
  ["tabSize", keywords()],

  // CSS Grid: a template is written with `tracks(...)`, so `none` is its only
  // text. An implicit track takes the three `<track-size>` keywords.
  ["gridTemplateColumns", keywords("none")],
  ["gridTemplateRows", keywords("none")],
  ["gridAutoColumns", keywords("auto", "min-content", "max-content")],
  ["gridAutoRows", keywords("auto", "min-content", "max-content")],
]);

/**
 * D73 rule 187 — every kind whose string values are decided per property. D65
 * rule 168 drew this line at `kind === "keyword"`, which was that wave's
 * boundary rather than the principle: the principle is that publishing a
 * surface which cannot be reached, or which swallows a false value, is worse
 * than not publishing it (D50 rule 92), and that principle does not know about
 * kinds. `metric` is absent because it answers with the sizing words when it
 * has no table of its own, and `color`, `background` and `image` are absent
 * because their diagnostics name a real vocabulary — a color keyword, a builder
 * — rather than a table. `text`, `filter`, `transform` and `animation` accept
 * arbitrary text by construction.
 */
export const LOOK_KEYWORD_DECIDED_KINDS: ReadonlySet<LookPropertyValueKind> = new Set<LookPropertyValueKind>([
  "keyword", "border", "shadow", "number", "number-keyword", "line-height", "angle", "duration", "track", "transition",
]);

/**
 * D65 rule 168, widened by D73 rule 187 — a property whose values are decided
 * per property carries its own closed set or the module refuses to load. The
 * shared fallback vocabulary this replaces was worse than a missing check: it
 * decided values for a property it had never heard of, so the same table that
 * rejected `listStyleType = "upper-roman"` accepted `colorScheme = "none"` and
 * `fontWeight = "circle"` and emitted them as declarations the browser drops.
 * A published name whose values are decided by a table that does not know the
 * property is not a checked property, so this is a load-time fact rather than
 * a test — the same shape as the value-kind invariant above.
 */
for (const [property, kind] of LOOK_PROPERTY_VALUE_KINDS) {
  if (LOOK_KEYWORD_DECIDED_KINDS.has(kind) && !LOOK_PROPERTY_KEYWORDS.has(property)) {
    throw new Error(`Look property '${property}' accepts string keywords and has no closed keyword set`);
  }
}

/** A property's own closed values, without the CSS-wide keywords every property shares. */
export function lookOwnKeywords(property: string): readonly string[] {
  const values = LOOK_PROPERTY_KEYWORDS.get(property);
  return values === undefined ? [] : [...values].filter((value) => !cssWideKeywordSet.has(value));
}

/** Closed, directly writable string values worth offering for one Look property. */
export function lookPropertyCompletionKeywords(property: string): readonly string[] {
  const kind = LOOK_PROPERTY_VALUE_KINDS.get(property);
  if (!kind || kind === "animation") return [];
  const own = LOOK_PROPERTY_KEYWORDS.get(property);
  if (kind === "metric" && own === undefined) return [...LOOK_CSS_WIDE_KEYWORDS, ...LOOK_SHARED_METRIC_KEYWORDS];
  if (kind === "color" || kind === "background") return LOOK_COLOR_KEYWORDS;
  if (kind === "image" || kind === "filter" || kind === "transform") return [...LOOK_CSS_WIDE_KEYWORDS, "none"];
  if (kind === "text") return LOOK_CSS_WIDE_KEYWORDS;
  return own === undefined ? LOOK_CSS_WIDE_KEYWORDS : [...own];
}

/** Whether a velar/look builder's result can be assigned directly to a property. */
export function lookBuilderSupportsProperty(builder: string, property: string): boolean {
  const result = LOOK_BUILDER_SIGNATURES.get(builder)?.result;
  const kind = LOOK_PROPERTY_VALUE_KINDS.get(property);
  if (!result || !kind) return false;
  switch (result) {
    case "string": return kind !== "animation";
    case "animation": return kind === "animation";
    case "border": return kind === "border";
    case "color": return kind === "color" || kind === "background";
    case "filter": return kind === "filter";
    case "image": return kind === "image" || kind === "background";
    case "length": return kind === "metric" || kind === "line-height";
    case "length-percentage": return kind === "metric"; // a percentage is no bare line height
    case "shadow": return kind === "shadow";
    case "spacing": return kind === "metric" || kind === "number-keyword";
    case "track": return false;
    case "track-list": return kind === "track";
    case "transition": return kind === "transition";
  }
}

/**
 * D67 rule 174 — how many of a property's own values a diagnostic writes out
 * before it names the shape of the set instead.
 *
 * The number is not load-bearing at its exact value: the published tables fall
 * into two clumps with nothing between them, the largest single-grammar set
 * holding twenty-two values and the next set up holding thirty-five. Anything
 * in that gap draws the same line. What matters is that a set on the far side
 * of it still says something an author can act on, which is what
 * LOOK_LARGE_KEYWORD_SETS below is for.
 */
export const LOOK_KEYWORD_LISTING_LIMIT = 24;

/**
 * What a vocabulary too long to write out holds, in the terms the author would
 * look it up by. A diagnostic reads this when the value it rejected is not a
 * near miss of anything, so that "one of the closed keywords" is never the
 * whole of the answer (D67 rule 174).
 */
export const LOOK_LARGE_KEYWORD_SETS: ReadonlyMap<string, string> = new Map([
  ["cursor", "the CSS Basic UI cursor keywords, including the eight directional and four bidirectional resize cursors"],
  ["fontVariant", "the single-token values of the six font-variant feature groups: position, caps, numeric, alternates, ligatures, and East Asian"],
  ["listStyleType", "the predefined counter styles of CSS Counter Styles 3, by numeric, alphabetic, symbolic, fixed, and complex system"],
  ["listStyle", "the predefined counter styles of CSS Counter Styles 3 plus the inside and outside marker positions"],
  ["transitionProperty", "none, all, and the CSS spelling of every animatable Look property"],
]);

for (const [property] of LOOK_PROPERTY_KEYWORDS) {
  const own = lookOwnKeywords(property);
  if (own.length > LOOK_KEYWORD_LISTING_LIMIT && !LOOK_LARGE_KEYWORD_SETS.has(property)) {
    throw new Error(`Look property '${property}' publishes ${own.length} keywords, more than a diagnostic writes out, and records no description of what the set holds`);
  }
}

for (const [property] of LOOK_LARGE_KEYWORD_SETS) {
  if (lookOwnKeywords(property).length <= LOOK_KEYWORD_LISTING_LIMIT) {
    throw new Error(`Look property '${property}' describes its keyword set but is small enough to write out, so the description would never be read`);
  }
}

/**
 * D65 rule 169 — what a partly closable property leaves out, and why.
 *
 * Some CSS value spaces cannot be written as a set: `listStyleType` reaches
 * into `@counter-style` names, `fontVariant` into a combination of six feature
 * groups, `fontStretch` into percentages. Such a property publishes the subset it
 * can close and records the remainder here, so the boundary is visible in the
 * table and in the diagnostic instead of being waved through by a fallback
 * vocabulary. This is the per-value sibling of LOOK_EXCLUDED_PROPERTIES, which
 * records the properties left out whole.
 */
export const LOOK_PARTIAL_KEYWORD_PROPERTIES: ReadonlyMap<string, string> = new Map([
  // D67 rule 172 revoked `objectPosition`'s record: the lengths it named as
  // excluded are the unit half of the `metric` kind it now shares with the
  // other two `<position>` properties, so nothing is left out to record.
  ["contain","Combinations of size, layout, style and paint are outside the closed set, which holds the single tokens plus the named strict and content shorthands"],
  ["backgroundBlendMode", "A comma-separated per-layer blend list is outside the closed set, because a checked Look background is one layer"],
  ["borderStyle", "The one-to-four value per-side form is outside the closed set; borderTopStyle, borderRightStyle, borderBottomStyle and borderLeftStyle write it"],
  ["fontStretch", "Percentage font widths are outside the closed set, which holds the named widths"],
  ["fontVariant", "Combining feature groups in one value, and the annotation(), character-variant(), ornaments(), styleset() and swash() notations, are outside the closed set, which holds each group's single-token values; fontFeatureSettings carries a combination"],
  ["textDecorationLine", "The blink line is outside the closed set: browsers parse it and draw nothing, so it is a declaration with no effect. The spelling-error and grammar-error lines are outside it too, because a document cannot ask for them the way a spell checker does"],
  ["strokeLinejoin", "The SVG2 arcs and miter-clip joins are outside the closed set, because no browser implements them"],
  ["textDecoration", "The style, color and thickness parts of the shorthand are outside the closed set; textDecorationStyle, textDecorationColor and textDecorationThickness write them"],
  ["listStyle", "The image part and multi-part combinations of the shorthand are outside the closed set; listStyleType, listStylePosition and listStyleImage write them"],
  ["listStyleType", "A literal string marker and a custom @counter-style name are outside the closed set, which holds the predefined counter styles"],

  // ── D67 rule 173 ────────────────────────────────────────────────────────
  // The rest of the seventy-seven, recorded rather than completed. Rule 173's
  // deliverable is the boundary, not the value count: a property may publish a
  // subset of its CSS grammar as long as the subset's edge is written down here
  // and the diagnostic reads it out. Each entry below names a value space that
  // is open (a string, an angle, a custom ident), redundant with a spelling the
  // set already holds, owned by another property, or unimplemented.
  ["display", "The two-keyword <display-outside> <display-inside> form is outside the closed set, and writes nothing the single-keyword names here do not: block flow is block, inline flow-root is inline-block. The table, ruby and run-in display types are outside it too, with the table formatting properties and for the same reason"],
  ["overflow", "The two-value x y form is outside the closed set; overflowX and overflowY write it"],
  ["fontStyle", "An oblique slant angle such as 'oblique 14deg' is outside the closed set, which holds the named slants"],
  ["textOverflow", "A literal ellipsis string, and the two-value start end form, are outside the closed set, which holds clip and ellipsis"],
  ["textAlign", "The justify-all keyword is outside the closed set, because no browser justifies the last line for it"],
  ["textTransform", "Combining a case transform with full-width or full-size-kana in one value is outside the closed set, which holds each of them alone"],
  ["writingMode", "The sideways-rl and sideways-lr modes are outside the closed set, because only one browser engine implements them"],
  ["touchAction", "Combining a horizontal pan, a vertical pan and pinch-zoom in one value is outside the closed set, which holds each of them alone"],
  ["appearance", "The compat-auto aliases such as button, checkbox and menulist are outside the closed set, because each of them renders exactly as auto"],
  ["colorScheme", "A custom scheme ident is outside the closed set, which holds the two schemes 'if scheme.dark:' conditions on"],
  ["cursor", "A url() cursor image and its fallback list are outside the closed set, which holds the keyword cursors"],
  // D49 gave `animate(easing=)` and this property one easing table, so the
  // functions absent from it are absent on purpose. Recording that is how the
  // closure stays legible without being mistaken for a gap to fill.
  ["transitionTimingFunction", "The cubic-bezier(), steps() and linear() easing functions are outside the closed set, which is the same easing table animate(easing=) reads"],
  // D60 rule 150 derived this set from the Look property table minus the
  // properties that do not interpolate. The subtraction is the boundary.
  ["transitionProperty", "A property whose value does not interpolate is outside the closed set, for the same reason a 'keyframes:' stop rejects it"],
  // The nine Box Alignment properties. Each records the overflow-position
  // prefixes; the three shorthands also record the two-value form, the way
  // borderStyle records its per-side form.
  ...["alignItems", "alignContent", "alignSelf", "justifyItems", "justifyContent", "justifySelf"]
    .map((property) => [property, "The safe and unsafe overflow-position prefixes are outside the closed set, which holds the alignments themselves"] as const),
  ["placeItems", "The two-value form and the safe and unsafe overflow-position prefixes are outside the closed set; alignItems and justifyItems write the two halves separately"],
  ["placeContent", "The two-value form and the safe and unsafe overflow-position prefixes are outside the closed set; alignContent and justifyContent write the two halves separately"],
  ["placeSelf", "The two-value form and the safe and unsafe overflow-position prefixes are outside the closed set; alignSelf and justifySelf write the two halves separately"],
  // The background layer properties. A checked Look background is one layer,
  // which is one design fact met in five places, so it is recorded in all five.
  ...["backgroundRepeat", "backgroundAttachment", "backgroundClip", "backgroundOrigin"]
    .map((property) => [property, "A comma-separated per-layer list is outside the closed set, because a checked Look background is one layer"] as const),

  // ── D73 rule 187: what the newly closed kinds leave open ───────────────────
  // Each of these has a real CSS value space that no set can hold, and each has
  // a checked Look spelling that reaches it. Recording that is what keeps the
  // closure legible rather than looking like a gap to fill.
  ...["border", "borderTop", "borderRight", "borderBottom", "borderLeft", "outline"]
    .map((property) => [property, "The width, style and color halves are outside the closed set; they are written with the border(width, color, style) builder"] as const),
  ...["boxShadow", "textShadow"]
    .map((property) => [property, "The offsets, blur, spread and color are outside the closed set; they are written with the shadow(x, y, blur, color) builder"] as const),
  ["aspectRatio", "The <ratio> form such as 16 / 9 is outside the closed set; write the ratio as a number"],
  ["scale", "The two- and three-axis forms are outside the closed set; a single number scales every axis"],
  ["flex", "The multi-value form such as 1 1 auto is outside the closed set; write flexGrow, flexShrink and flexBasis separately"],
  ["rotate", "The axis forms such as x 45deg are outside the closed set; a plain angle rotates in the plane"],
  ["transition", "Every transition other than none is outside the closed set; it is written with the transition(property, duration, easing, delay) builder, for the same reason a multi-part border string is"],
  ...["gridTemplateColumns", "gridTemplateRows"]
    .map((property) => [property, "Track lists, subgrid and masonry are outside the closed set; a track list is written with the tracks(...) builder"] as const),
  ...["gridAutoColumns", "gridAutoRows"]
    .map((property) => [property, "The minmax() and fit-content() track functions are outside the closed set; they are written with the minmax(...) builder inside tracks(...)"] as const),
]);

for (const [property] of LOOK_PARTIAL_KEYWORD_PROPERTIES) {
  if (!LOOK_PROPERTY_KEYWORDS.has(property)) throw new Error(`Look property '${property}' records an excluded value space but publishes no keyword set`);
}

/** Real CSS properties deliberately outside the checked Look domain. */
export const LOOK_EXCLUDED_PROPERTIES: ReadonlyMap<string, string> = new Map([
  // D104 rule 1. `font` was a published `text` property, so `font =
  // token("--ui-font-body")` type-checked, emitted `font:var(--…)`, and — when
  // the token held a size and no family — was invalid at computed-value time,
  // which resets every longhand the shorthand owns rather than dropping one
  // declaration. Look emits one rule per property, so that reset reached the
  // font-weight, font-family and line-height written three lines above it: a
  // consumer carried thirty-six such declarations, none of them live and none
  // of them diagnosed. Nothing in the value was checkable, because free text is
  // what the kind accepted; and nothing needed to be, because this family
  // publishes every part of the shorthand as a checked longhand. That is the
  // surface D50 rule 92 calls worse than publishing nothing.
  ["font", "the font shorthand is owned by its longhands — fontStyle, fontVariant, fontWeight, fontStretch, fontSize, lineHeight and fontFamily — because a shorthand's value is free text no compile can check, and a value that is not a legal shorthand fails at computed-value time and resets all seven, including the ones written beside it. A design token carrying a size belongs in fontSize"],
  ["float", "legacy float layout is outside the Grid and Flex layout model"],
  ["clear", "legacy float clearing is outside the Grid and Flex layout model"],
  ...["tableLayout", "borderCollapse", "borderSpacing", "captionSide", "emptyCells"].map((name) => [name, "table formatting properties remain excluded until a typed table-layout contract has evidence"] as const),
  ...["columns", "columnCount", "columnWidth", "columnFill", "columnRule", "columnRuleColor", "columnRuleStyle", "columnRuleWidth", "columnSpan"].map((name) => [name, "multi-column layout remains excluded until its value and fragmentation model is typed"] as const),
  ...["animationName", "animationDuration", "animationTimingFunction", "animationDelay", "animationIterationCount", "animationDirection", "animationFillMode", "animationPlayState", "animationTimeline", "animationRangeStart", "animationRangeEnd"].map((name) => [name, "animation longhands are owned by keyframes plus animate()"] as const),
  ...["counterIncrement", "counterReset", "counterSet", "quotes"].map((name) => [name, "generated-content counters and quoting are not modeled by checked Look values"] as const),
  ...["breakAfter", "breakBefore", "breakInside", "orphans", "widows"].map((name) => [name, "paged and fragmented media are outside the Web application target"] as const),
]);
