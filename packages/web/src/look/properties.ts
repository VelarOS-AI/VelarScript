/**
 * The published Look property roster, grouped by the job each property performs,
 * and the value kind each one is checked as.
 */
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
  // D104: `font` is not here. It is the one shorthand whose whole value space
  // this family already publishes as checked longhands, and see
  // LOOK_EXCLUDED_PROPERTIES for why publishing it beside them was worse than
  // publishing nothing.
  { family: "typography and international text", properties: ["color", "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontVariant", "fontKerning", "fontOpticalSizing", "fontFeatureSettings", "fontVariationSettings", "lineHeight", "verticalAlign", "letterSpacing", "wordSpacing", "textAlign", "textIndent", "textDecoration", "textDecorationColor", "textDecorationLine", "textDecorationStyle", "textDecorationThickness", "textUnderlineOffset", "textUnderlinePosition", "textTransform", "textRendering", "whiteSpace", "textOverflow", "textWrap", "overflowWrap", "wordBreak", "hyphens", "tabSize", "writingMode", "textOrientation", "direction", "unicodeBidi"] },
  { family: "lists", properties: ["listStyle", "listStyleType", "listStylePosition", "listStyleImage"] },
  { family: "SVG paint", properties: ["fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "strokeDasharray", "strokeDashoffset"] },
  { family: "transform and transition", properties: ["translate", "scale", "rotate", "transform", "transformOrigin", "transition", "transitionProperty", "transitionDuration", "transitionDelay", "transitionTimingFunction", "animation"] },
  { family: "interaction and form theme", properties: ["cursor", "pointerEvents", "userSelect", "touchAction", "appearance", "accentColor", "caretColor", "colorScheme"] },
  { family: "scroll", properties: ["scrollBehavior", "scrollMargin", "scrollMarginTop", "scrollMarginRight", "scrollMarginBottom", "scrollMarginLeft", "scrollPadding", "scrollPaddingTop", "scrollPaddingRight", "scrollPaddingBottom", "scrollPaddingLeft", "scrollSnapAlign", "scrollSnapStop", "scrollSnapType", "overscrollBehavior", "overscrollBehaviorX", "overscrollBehaviorY", "scrollbarColor", "scrollbarWidth"] },
]);

export const LOOK_PROPERTIES = new Set(LOOK_PROPERTY_GROUPS.flatMap((group) => group.properties));

/** Stable editor-documentation key for one checked Look property. */
export function lookPropertyDocumentationKey(property: string): string {
  return `look:property:${property}`;
}

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
  ["metric", ["gap", "rowGap", "columnGap", "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "inlineSize", "blockSize", "minInlineSize", "maxInlineSize", "minBlockSize", "maxBlockSize", "inset", "top", "right", "bottom", "left", "insetInline", "insetBlock", "insetInlineStart", "insetInlineEnd", "insetBlockStart", "insetBlockEnd", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "paddingInline", "paddingBlock", "paddingInlineStart", "paddingInlineEnd", "paddingBlockStart", "paddingBlockEnd", "margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "marginInline", "marginBlock", "marginInlineStart", "marginInlineEnd", "marginBlockStart", "marginBlockEnd", "flexBasis", "borderWidth", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderRadius", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius", "outlineWidth", "outlineOffset", "fontSize", "verticalAlign", "letterSpacing", "wordSpacing", "textIndent", "textDecorationThickness", "textUnderlineOffset", "strokeWidth", "strokeDashoffset", "scrollMargin", "scrollMarginTop", "scrollMarginRight", "scrollMarginBottom", "scrollMarginLeft", "scrollPadding", "scrollPaddingTop", "scrollPaddingRight", "scrollPaddingBottom", "scrollPaddingLeft", "translate", "transformOrigin", "backgroundPosition", "objectPosition", "backgroundSize"]],
  ["number", ["opacity", "zIndex", "flexGrow", "flexShrink", "order", "tabSize"]],
  ["number-keyword", ["fontWeight", "aspectRatio", "scale", "flex"]],
  ["shadow", ["boxShadow", "textShadow"]],
  ["text", ["content", "fontFamily", "fontFeatureSettings", "fontVariationSettings", "gridTemplateAreas", "gridColumn", "gridColumnStart", "gridColumnEnd", "gridRow", "gridRowStart", "gridRowEnd", "gridArea", "clip", "clipPath", "strokeDasharray", "scrollbarColor"]],
  ["track", ["gridTemplateColumns", "gridTemplateRows", "gridAutoColumns", "gridAutoRows"]],
  ["transform", ["transform"]],
  ["transition", ["transition"]],
  ["keyword", ["display", "position", "boxSizing", "isolation", "contain", "visibility", "overflow", "overflowX", "overflowY", "resize", "objectFit", "gridAutoFlow", "flexDirection", "flexWrap", "alignItems", "justifyItems", "justifyContent", "alignContent", "alignSelf", "justifySelf", "placeItems", "placeContent", "placeSelf", "backgroundRepeat", "backgroundAttachment", "backgroundClip", "backgroundOrigin", "backgroundBlendMode", "borderStyle", "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle", "outlineStyle", "fontStyle", "fontStretch", "fontVariant", "fontKerning", "fontOpticalSizing", "textAlign", "textDecoration", "textDecorationLine", "textDecorationStyle", "textUnderlinePosition", "textTransform", "textRendering", "whiteSpace", "textOverflow", "textWrap", "overflowWrap", "wordBreak", "hyphens", "writingMode", "textOrientation", "direction", "unicodeBidi", "listStyle", "listStyleType", "listStylePosition", "strokeLinecap", "strokeLinejoin", "transitionProperty", "transitionTimingFunction", "cursor", "pointerEvents", "userSelect", "touchAction", "appearance", "colorScheme", "scrollBehavior", "scrollSnapAlign", "scrollSnapStop", "scrollSnapType", "overscrollBehavior", "overscrollBehaviorX", "overscrollBehaviorY", "scrollbarWidth"]],
];

export const LOOK_PROPERTY_VALUE_KINDS: ReadonlyMap<string, LookPropertyValueKind> = new Map(
  propertyKinds.flatMap(([kind, properties]) => properties.map((property) => [property, kind] as const)),
);

for (const property of LOOK_PROPERTIES) {
  if (!LOOK_PROPERTY_VALUE_KINDS.has(property)) throw new Error(`Look property '${property}' has no declared value kind`);
}
