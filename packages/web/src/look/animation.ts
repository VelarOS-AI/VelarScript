/** The animation vocabulary: easings, directions, fills, and what cannot interpolate. */
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
