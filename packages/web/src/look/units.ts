/**
 * The unit suffixes the Web visual language owns, and the type names they carry.
 *
 * D115 P4 R3e: `look.ts` was one 1,041-line table; the vocabulary is split by
 * the question each part answers and the facade re-exports every name.
 */
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

/**
 * Properties whose CSS grammar takes a bare number. Every other numeric Look
 * property is a length, so a unitless number would reach CSS as a dead
 * declaration; the property tables reject it and the diagnostic teaches the
 * unit (LOK-D3).
 */
export const LOOK_UNITLESS_PROPERTIES = new Set([
  "lineHeight", "opacity", "zIndex", "fontWeight", "flex", "flexGrow", "flexShrink", "order", "scale", "aspectRatio",
]);

export const LOOK_ARITHMETIC_HINT = "@velarscript/web:look-arithmetic";

export const LOOK_NUMERIC_TYPE_NAMES = new Set([
  "Length", "Percentage", "LengthPercentage", "TrackFraction", "Duration", "Angle",
]);

// D50 rule 92: 'Opacity' never appeared here. No builder produces it and the
// 'opacity' property's declared type is number, so the name was unreachable —
// publishing an unreachable name is worse than publishing nothing.
export const LOOK_PUBLIC_TYPE_NAMES = Object.freeze([
  "Look", "Length", "Percentage", "LengthPercentage", "TrackFraction", "Color", "Duration", "Angle",
  "Border", "Shadow", "Filter", "Image", "Track", "TrackList", "Transition", "Spacing", "Keyframes", "Animation",
] as const);
