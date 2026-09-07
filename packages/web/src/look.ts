/**
 * The Web visual vocabulary's front door. `look.ts` was one 1,041-line module of
 * pure tables; D115 P4 R3e split it into `look/` by the question each part
 * answers, and this facade re-exports every one of the 55 names it published, so
 * no import path in the repository changed.
 *
 * Where to look:
 *
 *  - `look/units.ts`         the unit suffixes and the type names they carry
 *  - `look/media.ts`         media subjects, `@hook` states, `@target` targets
 *  - `look/builders.ts`      every `velar/look` builder's call shape and numeric domain
 *  - `look/tokens.ts`        checked design-token references (D103)
 *  - `look/animation.ts`     easings, directions, fills, what cannot interpolate
 *  - `look/properties.ts`    the published property roster and each one's value kind
 *  - `look/keyword-sets.ts`  the shared pieces the keyword table is assembled from
 *  - `look/css-functions.ts` free-text CSS functions, and the transition vocabulary
 *  - `look/keywords.ts`      each property's closed set, and what the closure leaves open
 *  - `look/shorthands.ts`    which properties write the same CSS declaration
 *  - `look/naming.ts`        the CSS spelling of a Look name, and nearest-name search
 */
export { LOOK_ARITHMETIC_HINT, LOOK_NUMERIC_TYPE_NAMES, LOOK_PUBLIC_TYPE_NAMES, LOOK_UNITLESS_PROPERTIES, LOOK_UNIT_TYPES } from "./look/units.ts";
export type { LookUnitTypeName } from "./look/units.ts";
export { LOOK_ABSENT_MEDIA_SUBJECTS, LOOK_HOOKS, LOOK_MEDIA_LENGTH_UNITS, LOOK_MEDIA_SUBJECTS, LOOK_TARGETS } from "./look/media.ts";
export { LOOK_BORDER_STYLE_NAMES, LOOK_BUILDERS, LOOK_BUILDER_NUMERIC_RANGES, LOOK_BUILDER_SIGNATURES, LOOK_LENGTH_BUILDERS } from "./look/builders.ts";
export type { LookBuilderResultKind, LookBuilderSignature } from "./look/builders.ts";
export { LOOK_TOKEN_NAME_PATTERN, LOOK_TOKEN_NAME_RULE, LOOK_TOKEN_NO_FALLBACK_GUIDANCE, isLookTokenName, isLookVarReference, lookTokenReference, lookVarReferenceName } from "./look/tokens.ts";
export { LOOK_ANIMATION_DIRECTIONS, LOOK_ANIMATION_EASINGS, LOOK_ANIMATION_FILLS, LOOK_NON_ANIMATABLE_PROPERTIES } from "./look/animation.ts";
export { LOOK_PROPERTIES, LOOK_PROPERTY_GROUPS, LOOK_PROPERTY_VALUE_KINDS, lookPropertyDocumentationKey } from "./look/properties.ts";
export type { LookPropertyGroup, LookPropertyValueKind } from "./look/properties.ts";
export { LOOK_COLOR_KEYWORDS, LOOK_CSS_WIDE_KEYWORDS, LOOK_SHARED_METRIC_KEYWORDS } from "./look/keyword-sets.ts";
export { LOOK_PROPERTY_CSS_FUNCTIONS, LOOK_TRANSITION_PROPERTY_KEYWORDS } from "./look/css-functions.ts";
export type { LookCssFunctionSuggestion } from "./look/css-functions.ts";
export { LOOK_EXCLUDED_PROPERTIES, LOOK_KEYWORD_DECIDED_KINDS, LOOK_KEYWORD_LISTING_LIMIT, LOOK_LARGE_KEYWORD_SETS, LOOK_PARTIAL_KEYWORD_PROPERTIES, LOOK_PROPERTY_KEYWORDS, lookBuilderSupportsProperty, lookOwnKeywords, lookPropertyCompletionKeywords } from "./look/keywords.ts";
export { LOOK_SHORTHAND_LONGHANDS, lookShorthandOverlap, lookShorthandParts } from "./look/shorthands.ts";
export { cssPropertyName, nearestLookName } from "./look/naming.ts";
