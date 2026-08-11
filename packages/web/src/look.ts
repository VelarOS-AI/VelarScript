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
