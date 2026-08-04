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
  "overflow", "overflowX", "overflowY", "objectFit", "visibility", "clip", "clipPath",
  "background", "backgroundColor", "backgroundImage", "backgroundPosition", "backgroundSize", "backgroundRepeat",
  "fill", "stroke", "strokeWidth",
  "border", "borderWidth", "borderStyle", "borderColor", "borderTop", "borderRight", "borderBottom", "borderLeft", "borderRadius",
  "boxShadow", "outline", "opacity", "filter", "backdropFilter", "content",
  "color", "font", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
  "textAlign", "textDecoration", "textTransform", "whiteSpace", "textOverflow", "wordBreak", "listStyle",
  "translate", "scale", "rotate", "transform", "transformOrigin",
  "transition", "transitionProperty", "transitionDuration", "transitionDelay", "transitionTimingFunction", "animation",
  "cursor", "pointerEvents", "userSelect", "touchAction", "scrollBehavior", "appearance", "zIndex",
]);

export function cssPropertyName(name: string): string {
  return name.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}
