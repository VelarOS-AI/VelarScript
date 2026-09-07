/**
 * The free-text CSS functions a specific Look property accepts, and the property
 * vocabulary `transitionProperty` and the `transition(...)` builder share.
 */
import { LOOK_NON_ANIMATABLE_PROPERTIES } from "./animation.ts";
import { keywords } from "./keyword-sets.ts";
import { cssPropertyName } from "./naming.ts";
import { LOOK_PROPERTIES } from "./properties.ts";
export interface LookCssFunctionSuggestion {
  /** CSS function name shown by completion. */
  readonly name: string;
  /** A complete, directly insertable example without surrounding quotes. */
  readonly example: string;
}

const lookFilterFunctions: readonly LookCssFunctionSuggestion[] = Object.freeze([
  { name: "blur", example: "blur(4px)" },
  { name: "brightness", example: "brightness(1)" },
  { name: "contrast", example: "contrast(1)" },
  { name: "drop-shadow", example: "drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.25))" },
  { name: "grayscale", example: "grayscale(1)" },
  { name: "hue-rotate", example: "hue-rotate(0deg)" },
  { name: "invert", example: "invert(1)" },
  { name: "opacity", example: "opacity(1)" },
  { name: "saturate", example: "saturate(1)" },
  { name: "sepia", example: "sepia(1)" },
  { name: "url", example: "url('#filter')" },
]);

/**
 * Free-text CSS functions that are legal for a specific Look property. This is
 * editor vocabulary, not a second validator: only free-text properties appear
 * here, while closed properties keep using their checked keyword/builder sets.
 */
export const LOOK_PROPERTY_CSS_FUNCTIONS: ReadonlyMap<string, readonly LookCssFunctionSuggestion[]> = new Map([
  ["filter", lookFilterFunctions],
  ["backdropFilter", lookFilterFunctions],
  ["clipPath", Object.freeze([
    { name: "inset", example: "inset(0px)" },
    { name: "circle", example: "circle(50%)" },
    { name: "ellipse", example: "ellipse(50% 50%)" },
    { name: "polygon", example: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)" },
  ])],
]);

/**
 * D60 rule 150: `transitionProperty` published a name no author could reach —
 * its only accepted values were the generic defaults, so no property name was
 * writable. The vocabulary is derived from the Look property table rather than
 * listed by hand (D57 rule 134): every animatable Look property, spelled the
 * way CSS spells it, plus the two aggregate keywords. A property that does not
 * participate in interpolation is excluded for the same reason `keyframes:`
 * rejects it.
 *
 * The set is published because the longhand is not its only reader: charter
 * section 3549 says the `transition(property, ...)` builder takes the same
 * vocabulary, so the analyzer's literal-argument check and the builder's own
 * runtime guard read this table rather than restating it.
 */
export const LOOK_TRANSITION_PROPERTY_KEYWORDS: ReadonlySet<string> = keywords("none", "all", ...[...LOOK_PROPERTIES]
  .filter((property) => !LOOK_NON_ANIMATABLE_PROPERTIES.has(property))
  .map(cssPropertyName));
