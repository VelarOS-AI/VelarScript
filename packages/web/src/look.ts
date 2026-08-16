export type LookUnitTypeName = "Length" | "Percentage" | "TrackFraction" | "Duration" | "Angle";

/**
 * One source of truth for every suffix owned by the Web visual language.
 * The lexer, analyzer, public-interface inference, and editor all consume this
 * table so a unit cannot silently mean different things at different stages.
 */
export const LOOK_UNIT_TYPES: ReadonlyMap<string, LookUnitTypeName> = new Map([
  ...["px", "rem", "em", "vw", "vh", "vmin", "vmax"].map((unit) => [unit, "Length"] as const),
  ["%", "Percentage"],
  ["fr", "TrackFraction"],
  ...["ms", "s"].map((unit) => [unit, "Duration"] as const),
  ...["deg", "turn"].map((unit) => [unit, "Angle"] as const),
]);

export const LOOK_MEDIA_LENGTH_UNITS = new Set(["px", "rem", "em"]);

/**
 * The closed set of media-condition subjects a Look condition may name. Every
 * subject lowers to a CSS media query, so the whole set stays live for the
 * lifetime of the page. The names are reserved bindings in a Web module: a
 * user binding of the same name would otherwise be shadowed by this table
 * inside Look conditions only (LOK-D4).
 */
export const LOOK_MEDIA_SUBJECTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["viewport", new Set(["width", "height"])],
  ["scheme", new Set(["dark", "light"])],
  ["motion", new Set(["reduced"])],
]);

/** Media features a Web developer may reach for that Look deliberately omits. */
export const LOOK_ABSENT_MEDIA_SUBJECTS = new Set(["container", "print", "orientation", "screen", "device", "pointer", "resolution", "display", "contrast", "colors"]);

/**
 * Properties whose CSS grammar takes a bare number. Every other numeric Look
 * property is a length, so a unitless number would reach CSS as a dead
 * declaration; the property tables reject it and the diagnostic teaches the
 * unit (LOK-D3).
 */
export const LOOK_UNITLESS_PROPERTIES = new Set([
  "lineHeight", "opacity", "zIndex", "fontWeight", "flex", "flexGrow", "flexShrink", "order", "scale", "aspectRatio",
]);

/** Builders that compose lengths: a unitless argument other than 0 is dead CSS. */
export const LOOK_LENGTH_BUILDERS = new Set(["spacing", "tracks", "minmax", "min", "max", "clamp", "border", "shadow"]);

/**
 * The numeric domains the velar/look builders enforce at run time. A literal
 * argument is checked in the same terms while the module compiles, so an
 * out-of-range colour never reaches a blank page (LOK-U8).
 */
export const LOOK_BUILDER_NUMERIC_RANGES: ReadonlyMap<string, readonly (readonly [string, number, number] | null)[]> = new Map([
  ["rgb", [["RGB channel 1", 0, 255], ["RGB channel 2", 0, 255], ["RGB channel 3", 0, 255]]],
  ["rgba", [["RGB channel 1", 0, 255], ["RGB channel 2", 0, 255], ["RGB channel 3", 0, 255], ["RGB alpha", 0, 1]]],
  ["hsl", [null, ["HSL saturation", 0, 100], ["HSL lightness", 0, 100]]],
  ["alpha", [null, ["Color opacity", 0, 1]]],
  ["lighten", [null, ["Color amount", 0, 1]]],
  ["darken", [null, ["Color amount", 0, 1]]],
]);

/** The border styles the border builder accepts, mirroring its runtime guard. */
export const LOOK_BORDER_STYLE_NAMES = new Set(["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"]);

export const LOOK_ARITHMETIC_HINT = "@velarscript/web:look-arithmetic";

export const LOOK_NUMERIC_TYPE_NAMES = new Set([
  "Length", "Percentage", "LengthPercentage", "TrackFraction", "Duration", "Angle",
]);

// D50 rule 92: 'Opacity' never appeared here. No builder produces it and the
// 'opacity' property's declared type is number, so the name was unreachable —
// publishing an unreachable name is worse than publishing nothing.
export const LOOK_PUBLIC_TYPE_NAMES = Object.freeze([
  "Look", "Length", "Percentage", "LengthPercentage", "TrackFraction", "Color", "Duration", "Angle",
  "Border", "Shadow", "Image", "Track", "TrackList", "Transition", "Spacing", "Keyframes", "Animation",
] as const);

export const LOOK_HOOKS = new Set([
  "hover", "focus", "focusVisible", "active", "current", "disabled", "checked", "invalid", "open",
]);

export const LOOK_TARGETS = new Set([
  "before", "after", "backdrop", "placeholder", "selection", "marker", "fileSelectorButton",
]);

export interface LookBuilderSignature {
  /** Parameter names, in declaration order. */
  readonly parameters: readonly string[];
  /** How many leading parameters a call must supply. */
  readonly required: number;
  /** Whether the final parameter collects the remaining arguments. */
  readonly rest?: boolean;
}

/**
 * Every velar/look builder and the shape of its call. Three consumers read this
 * one table — the published module interface, the named-argument check, and the
 * static lowering that has to put a named argument back at its position when a
 * builder call appears inside a `keyframes:` stop. D57 rule 134: a list two
 * places need is written once and derived from.
 */
export const LOOK_BUILDER_SIGNATURES: ReadonlyMap<string, LookBuilderSignature> = new Map<string, LookBuilderSignature>([
  ["color", { parameters: ["value"], required: 1 }],
  ["rgb", { parameters: ["red", "green", "blue"], required: 3 }],
  ["rgba", { parameters: ["red", "green", "blue", "alpha"], required: 4 }],
  ["hsl", { parameters: ["hue", "saturation", "lightness"], required: 3 }],
  ["alpha", { parameters: ["color", "opacity"], required: 2 }],
  ["lighten", { parameters: ["color", "amount"], required: 2 }],
  ["darken", { parameters: ["color", "amount"], required: 2 }],
  ["border", { parameters: ["width", "color", "style"], required: 2 }],
  ["shadow", { parameters: ["x", "y", "blur", "color", "spread", "inset"], required: 4 }],
  ["linearGradient", { parameters: ["angle", "start", "end"], required: 3 }],
  ["asset", { parameters: ["path"], required: 1 }],
  ["minmax", { parameters: ["minimum", "maximum"], required: 2 }],
  ["repeat", { parameters: ["count", "size"], required: 2 }],
  ["tracks", { parameters: ["first"], required: 1, rest: true }],
  ["transition", { parameters: ["property", "duration", "easing", "delay"], required: 2 }],
  ["spacing", { parameters: ["first", "second", "third", "fourth"], required: 1 }],
  ["min", { parameters: ["first", "second"], required: 2 }],
  ["max", { parameters: ["first", "second"], required: 2 }],
  ["clamp", { parameters: ["minimum", "preferred", "maximum"], required: 3 }],
  ["animate", { parameters: ["frames", "duration", "easing", "delay", "count", "loop", "direction", "fill"], required: 2 }],
]);

export const LOOK_BUILDERS = new Set(LOOK_BUILDER_SIGNATURES.keys());

export const LOOK_ANIMATION_EASINGS = new Set([
  "linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end",
]);

export const LOOK_ANIMATION_DIRECTIONS = new Set(["normal", "reverse", "alternate", "alternate-reverse"]);
export const LOOK_ANIMATION_FILLS = new Set(["none", "forwards", "backwards", "both"]);

/** Properties whose CSS values do not participate in interpolated animation. */
export const LOOK_NON_ANIMATABLE_PROPERTIES = new Set([
  "display", "position", "overflow", "overflowX", "overflowY", "pointerEvents", "cursor", "userSelect",
  "content", "visibility", "resize", "touchAction", "scrollBehavior", "appearance", "isolation", "contain",
  "animation", "transition", "transitionProperty", "transitionDuration", "transitionDelay", "transitionTimingFunction",
]);

export interface LookPropertyGroup {
  readonly family: string;
  readonly properties: readonly string[];
}

/** Published Look vocabulary, grouped by the job each property performs. */
export const LOOK_PROPERTY_GROUPS: readonly LookPropertyGroup[] = Object.freeze([
  { family: "layout and containment", properties: ["display", "position", "boxSizing", "isolation", "contain", "visibility", "zIndex", "overflow", "overflowX", "overflowY", "resize", "clip", "clipPath", "objectFit", "objectPosition", "aspectRatio"] },
  { family: "grid", properties: ["gridTemplateColumns", "gridTemplateRows", "gridTemplateAreas", "gridAutoColumns", "gridAutoRows", "gridAutoFlow", "gridColumn", "gridColumnStart", "gridColumnEnd", "gridRow", "gridRowStart", "gridRowEnd", "gridArea"] },
  { family: "flex and alignment", properties: ["flex", "flexDirection", "flexGrow", "flexShrink", "flexBasis", "flexWrap", "order", "gap", "rowGap", "columnGap", "alignItems", "justifyItems", "justifyContent", "alignContent", "alignSelf", "justifySelf", "placeItems", "placeContent", "placeSelf"] },
  { family: "size and inset", properties: ["width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "inlineSize", "blockSize", "minInlineSize", "maxInlineSize", "minBlockSize", "maxBlockSize", "inset", "top", "right", "bottom", "left", "insetInline", "insetBlock", "insetInlineStart", "insetInlineEnd", "insetBlockStart", "insetBlockEnd"] },
  { family: "spacing", properties: ["padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "paddingInline", "paddingBlock", "paddingInlineStart", "paddingInlineEnd", "paddingBlockStart", "paddingBlockEnd", "margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "marginInline", "marginBlock", "marginInlineStart", "marginInlineEnd", "marginBlockStart", "marginBlockEnd"] },
  { family: "background", properties: ["background", "backgroundColor", "backgroundImage", "backgroundPosition", "backgroundSize", "backgroundRepeat", "backgroundAttachment", "backgroundClip", "backgroundOrigin", "backgroundBlendMode"] },
  { family: "border and outline", properties: ["border", "borderWidth", "borderStyle", "borderColor", "borderTop", "borderRight", "borderBottom", "borderLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "borderRadius", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius", "outline", "outlineWidth", "outlineStyle", "outlineColor", "outlineOffset"] },
  { family: "effects", properties: ["boxShadow", "textShadow", "opacity", "filter", "backdropFilter", "content"] },
  { family: "typography and international text", properties: ["color", "font", "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontVariant", "fontKerning", "fontOpticalSizing", "fontFeatureSettings", "fontVariationSettings", "lineHeight", "letterSpacing", "wordSpacing", "textAlign", "textIndent", "textDecoration", "textDecorationColor", "textDecorationLine", "textDecorationStyle", "textDecorationThickness", "textUnderlineOffset", "textUnderlinePosition", "textTransform", "textRendering", "whiteSpace", "textOverflow", "textWrap", "overflowWrap", "wordBreak", "hyphens", "tabSize", "writingMode", "textOrientation", "direction", "unicodeBidi"] },
  { family: "lists", properties: ["listStyle", "listStyleType", "listStylePosition", "listStyleImage"] },
  { family: "SVG paint", properties: ["fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "strokeDasharray", "strokeDashoffset"] },
  { family: "transform and transition", properties: ["translate", "scale", "rotate", "transform", "transformOrigin", "transition", "transitionProperty", "transitionDuration", "transitionDelay", "transitionTimingFunction", "animation"] },
  { family: "interaction and form theme", properties: ["cursor", "pointerEvents", "userSelect", "touchAction", "appearance", "accentColor", "caretColor", "colorScheme"] },
  { family: "scroll", properties: ["scrollBehavior", "scrollMargin", "scrollMarginTop", "scrollMarginRight", "scrollMarginBottom", "scrollMarginLeft", "scrollPadding", "scrollPaddingTop", "scrollPaddingRight", "scrollPaddingBottom", "scrollPaddingLeft", "scrollSnapAlign", "scrollSnapStop", "scrollSnapType", "overscrollBehavior", "overscrollBehaviorX", "overscrollBehaviorY", "scrollbarColor", "scrollbarWidth"] },
]);

export const LOOK_PROPERTIES = new Set(LOOK_PROPERTY_GROUPS.flatMap((group) => group.properties));

export type LookPropertyValueKind =
  | "animation" | "angle" | "background" | "border" | "color" | "duration" | "filter" | "image" | "keyword"
  | "line-height" | "metric" | "number" | "number-keyword" | "shadow" | "text" | "track" | "transform" | "transition";

const propertyKinds: readonly (readonly [LookPropertyValueKind, readonly string[]])[] = [
  ["animation", ["animation"]],
  ["angle", ["rotate"]],
  ["background", ["background"]],
  ["border", ["border", "borderTop", "borderRight", "borderBottom", "borderLeft", "outline"]],
  ["color", ["color", "backgroundColor", "borderColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor", "textDecorationColor", "accentColor", "caretColor", "fill", "stroke"]],
  ["duration", ["transitionDuration", "transitionDelay"]],
  ["filter", ["filter", "backdropFilter"]],
  ["image", ["backgroundImage", "listStyleImage"]],
  ["line-height", ["lineHeight"]],
  ["metric", ["gap", "rowGap", "columnGap", "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "inlineSize", "blockSize", "minInlineSize", "maxInlineSize", "minBlockSize", "maxBlockSize", "inset", "top", "right", "bottom", "left", "insetInline", "insetBlock", "insetInlineStart", "insetInlineEnd", "insetBlockStart", "insetBlockEnd", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "paddingInline", "paddingBlock", "paddingInlineStart", "paddingInlineEnd", "paddingBlockStart", "paddingBlockEnd", "margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "marginInline", "marginBlock", "marginInlineStart", "marginInlineEnd", "marginBlockStart", "marginBlockEnd", "flexBasis", "borderWidth", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderRadius", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius", "outlineWidth", "outlineOffset", "fontSize", "letterSpacing", "wordSpacing", "textIndent", "textDecorationThickness", "textUnderlineOffset", "strokeWidth", "strokeDashoffset", "scrollMargin", "scrollMarginTop", "scrollMarginRight", "scrollMarginBottom", "scrollMarginLeft", "scrollPadding", "scrollPaddingTop", "scrollPaddingRight", "scrollPaddingBottom", "scrollPaddingLeft", "translate", "transformOrigin", "backgroundPosition", "backgroundSize"]],
  ["number", ["opacity", "zIndex", "flexGrow", "flexShrink", "order", "tabSize"]],
  ["number-keyword", ["fontWeight", "aspectRatio", "scale", "flex"]],
  ["shadow", ["boxShadow", "textShadow"]],
  ["text", ["content", "font", "fontFamily", "fontFeatureSettings", "fontVariationSettings", "gridTemplateAreas", "gridColumn", "gridColumnStart", "gridColumnEnd", "gridRow", "gridRowStart", "gridRowEnd", "gridArea", "clip", "clipPath", "strokeDasharray", "scrollbarColor"]],
  ["track", ["gridTemplateColumns", "gridTemplateRows", "gridAutoColumns", "gridAutoRows"]],
  ["transform", ["transform"]],
  ["transition", ["transition"]],
  ["keyword", ["display", "position", "boxSizing", "isolation", "contain", "visibility", "overflow", "overflowX", "overflowY", "resize", "objectFit", "objectPosition", "gridAutoFlow", "flexDirection", "flexWrap", "alignItems", "justifyItems", "justifyContent", "alignContent", "alignSelf", "justifySelf", "placeItems", "placeContent", "placeSelf", "backgroundRepeat", "backgroundAttachment", "backgroundClip", "backgroundOrigin", "backgroundBlendMode", "borderStyle", "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle", "outlineStyle", "fontStyle", "fontStretch", "fontVariant", "fontKerning", "fontOpticalSizing", "textAlign", "textDecoration", "textDecorationLine", "textDecorationStyle", "textUnderlinePosition", "textTransform", "textRendering", "whiteSpace", "textOverflow", "textWrap", "overflowWrap", "wordBreak", "hyphens", "writingMode", "textOrientation", "direction", "unicodeBidi", "listStyle", "listStyleType", "listStylePosition", "strokeLinecap", "strokeLinejoin", "transitionProperty", "transitionTimingFunction", "cursor", "pointerEvents", "userSelect", "touchAction", "appearance", "colorScheme", "scrollBehavior", "scrollSnapAlign", "scrollSnapStop", "scrollSnapType", "overscrollBehavior", "overscrollBehaviorX", "overscrollBehaviorY", "scrollbarWidth"]],
];

export const LOOK_PROPERTY_VALUE_KINDS: ReadonlyMap<string, LookPropertyValueKind> = new Map(
  propertyKinds.flatMap(([kind, properties]) => properties.map((property) => [property, kind] as const)),
);

for (const property of LOOK_PROPERTIES) {
  if (!LOOK_PROPERTY_VALUE_KINDS.has(property)) throw new Error(`Look property '${property}' has no declared value kind`);
}

const cssWideKeywords = ["inherit", "initial", "revert", "revert-layer", "unset"];
const keywords = (...values: readonly string[]): ReadonlySet<string> => new Set([...cssWideKeywords, ...values]);

/**
 * D60 rule 150: `transitionProperty` published a name no author could reach —
 * its only accepted values were the generic defaults, so no property name was
 * writable. The vocabulary is derived from the Look property table rather than
 * listed by hand (D57 rule 134): every animatable Look property, spelled the
 * way CSS spells it, plus the two aggregate keywords. A property that does not
 * participate in interpolation is excluded for the same reason `keyframes:`
 * rejects it.
 */
const transitionPropertyKeywords = keywords("none", "all", ...[...LOOK_PROPERTIES]
  .filter((property) => !LOOK_NON_ANIMATABLE_PROPERTIES.has(property))
  .map(cssPropertyName));

/**
 * Every `left right` value of a grammar that takes one token from each of two
 * positions — `y mandatory`, `left top`. D65 rule 169: a closed set holds the
 * complete value the author writes, so a multi-token CSS value is written out
 * here rather than turned into a builder or a token grammar of its own.
 */
function lookValuePairs(left: Iterable<string>, right: Iterable<string>): readonly string[] {
  const second = [...right];
  return [...left].flatMap((first) => second.map((last) => `${first} ${last}`));
}

/**
 * Every value of a CSS `||` combination: each non-empty selection of the tokens
 * in every order the combinator accepts, so `dense row` is the same value as
 * `row dense` to the author and to the browser.
 */
function lookValueOrderings(tokens: readonly string[]): readonly string[] {
  return tokens.flatMap((token, index) => {
    const rest = [...tokens.slice(0, index), ...tokens.slice(index + 1)];
    return [token, ...lookValueOrderings(rest).map((tail) => `${token} ${tail}`)];
  });
}

/** Every value of a `[ … ]{1,2}` repetition — `scrollSnapAlign: start end`. */
function lookValueRepetitions(tokens: readonly string[]): readonly string[] {
  return [...tokens, ...lookValuePairs(tokens, tokens)];
}

// `<position>`'s keyword grid: one placement word, or one from each axis in
// either order. The length and percentage forms are the part no closed set
// holds; LOOK_PARTIAL_KEYWORD_PROPERTIES records that.
const horizontalPositions = ["left", "center", "right"];
const verticalPositions = ["top", "center", "bottom"];
const positionKeywords = [
  ...horizontalPositions, ...verticalPositions,
  ...lookValuePairs(horizontalPositions, verticalPositions),
  ...lookValuePairs(verticalPositions, horizontalPositions),
];

// The line part of the text-decoration family, written once: `textDecoration`
// is the shorthand whose only closed part is this one (D57 rule 134).
const textDecorationLineKeywords = ["none", ...lookValueOrderings(["underline", "overline", "line-through"])];

// The predefined counter styles of CSS Counter Styles 3 §6, by its own
// grouping. A `<string>` marker and a custom `@counter-style` name are the open
// part and are recorded as excluded.
const listStyleTypeKeywords = [
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
const listStylePositionKeywords = ["inside", "outside"];

// `color-scheme` names the same two schemes `if scheme.dark:` conditions on, so
// it reads that table rather than restating it. `only` may lead or trail the
// scheme list.
const colorSchemeOrderings = lookValueOrderings([...LOOK_MEDIA_SUBJECTS.get("scheme") ?? []]);

const scrollSnapAxes = ["x", "y", "block", "inline", "both"];
const overscrollBehaviors = ["auto", "contain", "none"];

export const LOOK_PROPERTY_KEYWORDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["display", keywords("none", "block", "inline", "inline-block", "flow-root", "flex", "inline-flex", "grid", "inline-grid", "contents")],
  ["isolation", keywords("auto", "isolate")],
  ["contain", keywords("none", "strict", "content", "size", "inline-size", "layout", "style", "paint")],
  ["backgroundSize", keywords("auto", "cover", "contain")],
  ["backgroundPosition", keywords("center", "top", "right", "bottom", "left")],
  ["transformOrigin", keywords("center", "top", "right", "bottom", "left")],
  ["transitionProperty", transitionPropertyKeywords],
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
  ["alignItems", keywords("normal", "stretch", "center", "start", "end", "flex-start", "flex-end", "baseline")],
  ["alignContent", keywords("normal", "stretch", "center", "start", "end", "flex-start", "flex-end", "space-between", "space-around", "space-evenly")],
  ["alignSelf", keywords("auto", "normal", "stretch", "center", "start", "end", "flex-start", "flex-end", "baseline")],
  ["justifyItems", keywords("normal", "stretch", "center", "start", "end", "left", "right")],
  ["justifyContent", keywords("normal", "stretch", "center", "start", "end", "flex-start", "flex-end", "left", "right", "space-between", "space-around", "space-evenly")],
  ["justifySelf", keywords("auto", "normal", "stretch", "center", "start", "end", "left", "right")],
  ["placeItems", keywords("normal", "stretch", "center", "start", "end")],
  ["placeContent", keywords("normal", "stretch", "center", "start", "end", "space-between", "space-around", "space-evenly")],
  ["placeSelf", keywords("auto", "normal", "stretch", "center", "start", "end")],
  ["cursor", keywords("auto", "default", "none", "context-menu", "help", "pointer", "progress", "wait", "cell", "crosshair", "text", "vertical-text", "alias", "copy", "move", "no-drop", "not-allowed", "grab", "grabbing", "col-resize", "row-resize", "n-resize", "e-resize", "s-resize", "w-resize", "ne-resize", "nw-resize", "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize", "nwse-resize", "zoom-in", "zoom-out")],
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
  ["touchAction", keywords("auto", "none", "pan-x", "pan-y", "manipulation")],
  ["appearance", keywords("none", "auto", "textfield", "menulist-button")],
  ["scrollBehavior", keywords("auto", "smooth")],
  ["scrollbarWidth", keywords("auto", "thin", "none")],
  ["backgroundRepeat", keywords("repeat", "repeat-x", "repeat-y", "space", "round", "no-repeat")],
  ["backgroundAttachment", keywords("scroll", "fixed", "local")],
  ["backgroundClip", keywords("border-box", "padding-box", "content-box", "text")],
  ["backgroundOrigin", keywords("border-box", "padding-box", "content-box")],
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
  ["objectPosition", keywords(...positionKeywords)],
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
]);

/**
 * D65 rule 168 — a `keyword` property carries its own closed set or the module
 * refuses to load. The shared fallback vocabulary this replaces was worse than
 * a missing check: it decided values for a property it had never heard of, so
 * the same table that rejected `listStyleType = "upper-roman"` accepted
 * `colorScheme = "none"` and emitted it as a declaration the browser drops.
 * A published name whose values are decided by a table that does not know the
 * property is not a checked property, so this is a load-time fact rather than
 * a test — the same shape as the value-kind invariant above.
 */
for (const [property, kind] of LOOK_PROPERTY_VALUE_KINDS) {
  if (kind === "keyword" && !LOOK_PROPERTY_KEYWORDS.has(property)) {
    throw new Error(`Look property '${property}' is a keyword property with no closed keyword set`);
  }
}

/**
 * D65 rule 169 — what a partly closable property leaves out, and why.
 *
 * Some CSS value spaces cannot be written as a set: `objectPosition` reaches
 * into lengths, `listStyleType` into `@counter-style` names, `fontVariant` into
 * a combination of six feature groups. Such a property publishes the subset it
 * can close and records the remainder here, so the boundary is visible in the
 * table and in the diagnostic instead of being waved through by a fallback
 * vocabulary. This is the per-value sibling of LOOK_EXCLUDED_PROPERTIES, which
 * records the properties left out whole.
 */
export const LOOK_PARTIAL_KEYWORD_PROPERTIES: ReadonlyMap<string, string> = new Map([
  ["objectPosition", "Positions written as a length or percentage are outside the closed set, which holds the placement keywords"],
  ["contain", "Combinations of size, layout, style and paint are outside the closed set, which holds the single tokens plus the named strict and content shorthands"],
  ["backgroundBlendMode", "A comma-separated per-layer blend list is outside the closed set, because a checked Look background is one layer"],
  ["borderStyle", "The one-to-four value per-side form is outside the closed set; borderTopStyle, borderRightStyle, borderBottomStyle and borderLeftStyle write it"],
  ["fontStretch", "Percentage font widths are outside the closed set, which holds the named widths"],
  ["fontVariant", "Combining feature groups in one value is outside the closed set, which holds each group's single-token values; fontFeatureSettings carries a combination"],
  ["textDecorationLine", "The blink line is outside the closed set: browsers parse it and draw nothing, so it is a declaration with no effect"],
  ["strokeLinejoin", "The SVG2 arcs and miter-clip joins are outside the closed set, because no browser implements them"],
  ["textDecoration", "The style, color and thickness parts of the shorthand are outside the closed set; textDecorationStyle, textDecorationColor and textDecorationThickness write them"],
  ["listStyle", "The image part and multi-part combinations of the shorthand are outside the closed set; listStyleType, listStylePosition and listStyleImage write them"],
  ["listStyleType", "A literal string marker and a custom @counter-style name are outside the closed set, which holds the predefined counter styles"],
]);

for (const [property] of LOOK_PARTIAL_KEYWORD_PROPERTIES) {
  if (!LOOK_PROPERTY_KEYWORDS.has(property)) throw new Error(`Look property '${property}' records an excluded value space but publishes no keyword set`);
}

/** Real CSS properties deliberately outside the checked Look domain. */
export const LOOK_EXCLUDED_PROPERTIES: ReadonlyMap<string, string> = new Map([
  ["float", "legacy float layout is outside the Grid and Flex layout model"],
  ["clear", "legacy float clearing is outside the Grid and Flex layout model"],
  ...["tableLayout", "borderCollapse", "borderSpacing", "captionSide", "emptyCells"].map((name) => [name, "table formatting properties remain excluded until a typed table-layout contract has evidence"] as const),
  ...["columns", "columnCount", "columnWidth", "columnFill", "columnRule", "columnRuleColor", "columnRuleStyle", "columnRuleWidth", "columnSpan"].map((name) => [name, "multi-column layout remains excluded until its value and fragmentation model is typed"] as const),
  ...["animationName", "animationDuration", "animationTimingFunction", "animationDelay", "animationIterationCount", "animationDirection", "animationFillMode", "animationPlayState", "animationTimeline", "animationRangeStart", "animationRangeEnd"].map((name) => [name, "animation longhands are owned by keyframes plus animate()"] as const),
  ...["counterIncrement", "counterReset", "counterSet", "quotes"].map((name) => [name, "generated-content counters and quoting are not modeled by checked Look values"] as const),
  ...["breakAfter", "breakBefore", "breakInside", "orphans", "widows"].map((name) => [name, "paged and fragmented media are outside the Web application target"] as const),
]);

export function cssPropertyName(name: string): string {
  return name.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}

function nameDistance(left: string, right: string): number {
  if (left.length === right.length) {
    const mismatches: number[] = [];
    for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) mismatches.push(index);
    if (mismatches.length === 2 && mismatches[1] === mismatches[0]! + 1
      && left[mismatches[0]!] === right[mismatches[1]!] && left[mismatches[1]!] === right[mismatches[0]!]) return 1;
  }
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]!;
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const candidate = Math.min(
        previous[column]! + 1,
        previous[column - 1]! + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = previous[column]!;
      previous[column] = candidate;
    }
  }
  return previous[right.length]!;
}

/**
 * The closest vocabulary entry to a misspelling, or null when nothing is close
 * enough to name. Case differences and one or two edits count as near misses;
 * anything further apart is a different word and gets the full vocabulary.
 */
export function nearestLookName(name: string, vocabulary: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const limit = 2;
  for (const candidate of vocabulary) {
    const distance = nameDistance(name.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance || (distance === bestDistance && best !== null && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== null && bestDistance <= limit ? best : null;
}
