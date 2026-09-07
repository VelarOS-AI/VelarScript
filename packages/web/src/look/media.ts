/**
 * What a Look condition matches on and what a Look block targets: the media
 * subjects, the element states spelled `@hook`, and the visual targets spelled
 * `@target`.
 */
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

export const LOOK_HOOKS = new Set([
  "hover", "focus", "focusVisible", "active", "current", "disabled", "checked", "invalid", "open",
]);

export const LOOK_TARGETS = new Set([
  "before", "after", "backdrop", "placeholder", "selection", "marker", "fileSelectorButton",
]);
