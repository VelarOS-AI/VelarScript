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
  "Length", "Percentage", "LengthPercentage", "TrackFraction", "Duration", "Angle", "Opacity",
]);

export const LOOK_PUBLIC_TYPE_NAMES = Object.freeze([
  "Look", "Length", "Percentage", "LengthPercentage", "TrackFraction", "Color", "Duration", "Angle", "Opacity",
  "Border", "Shadow", "Image", "Track", "TrackList", "Transition", "Spacing",
] as const);

export const LOOK_HOOKS = new Set([
  "hover", "focus", "focusVisible", "active", "current", "disabled", "checked", "invalid", "open",
]);

export const LOOK_TARGETS = new Set([
  "before", "after", "backdrop", "placeholder", "selection", "marker", "fileSelectorButton",
]);

export const LOOK_BUILDERS = new Set([
  "color", "rgb", "rgba", "hsl", "alpha", "lighten", "darken",
  "border", "shadow", "linearGradient", "asset",
  "minmax", "repeat", "tracks", "transition", "spacing", "min", "max", "clamp",
]);

// Look uses the DOM-style camelCase spelling of real CSS properties. A name is
// either the CSS property a Web developer already knows, or it is not valid.
export const LOOK_PROPERTIES = new Set([
  "display", "position", "boxSizing", "isolation", "contain",
  "gridTemplateColumns", "gridTemplateRows", "gridTemplateAreas", "gridAutoFlow", "gridColumn", "gridRow", "gridArea",
  "flex", "flexDirection", "flexGrow", "flexShrink", "flexBasis", "flexWrap", "order",
  "gap", "rowGap", "columnGap", "alignItems", "justifyItems", "justifyContent", "alignContent", "alignSelf", "justifySelf", "placeItems",
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "aspectRatio",
  "inset", "top", "right", "bottom", "left",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "paddingInline", "paddingBlock",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "marginInline", "marginBlock",
  "overflow", "overflowX", "overflowY", "resize", "objectFit", "visibility", "clip", "clipPath",
  "background", "backgroundColor", "backgroundImage", "backgroundPosition", "backgroundSize", "backgroundRepeat",
  "fill", "stroke", "strokeWidth",
  "border", "borderWidth", "borderStyle", "borderColor", "borderTop", "borderRight", "borderBottom", "borderLeft", "borderRadius",
  "boxShadow", "outline", "opacity", "filter", "backdropFilter", "content",
  "color", "font", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
  "textAlign", "textDecoration", "textTransform", "whiteSpace", "textOverflow", "textWrap", "overflowWrap", "wordBreak", "hyphens", "listStyle",
  "translate", "scale", "rotate", "transform", "transformOrigin",
  "transition", "transitionProperty", "transitionDuration", "transitionDelay", "transitionTimingFunction", "animation",
  "cursor", "pointerEvents", "userSelect", "touchAction", "scrollBehavior", "appearance", "zIndex",
]);

export function cssPropertyName(name: string): string {
  return name.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}

function nameDistance(left: string, right: string): number {
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
  const limit = name.length <= 3 ? 1 : 2;
  for (const candidate of vocabulary) {
    const distance = nameDistance(name.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance || (distance === bestDistance && best !== null && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== null && bestDistance <= limit ? best : null;
}
