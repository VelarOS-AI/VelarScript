// D90 R19(c): the shape of a route — its method-independent collision key — is
// one concept, so it has exactly one definition. The static analyzer imports
// the function below; the velar/serve runtime interpolates its source into the
// emitted module. Two referees, one rule: a shape the compiler and the
// assembly check disagree about is the defect class this file exists to
// prevent.

/**
 * Folds a route path's pre-split segments into its shape: every `{name:type}`
 * capture collapses to `{}` and every literal segment stays itself, so two
 * paths share a shape exactly when a request cannot tell them apart by
 * position. The body uses only indexed access, `.length` and primitive string
 * concatenation — no method lookups — because the serve runtime embeds this
 * exact source inside its hardened primordial Realm, where prototypes are
 * assumed hostile. Callers split on "/" themselves with whatever split they
 * trust.
 */
export function routeShapeFromSegments(segments: readonly string[]): string {
  let shape = "";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const capture = segment !== undefined && segment[0] === "{" && segment[segment.length - 1] === "}";
    shape += (index === 0 ? "" : "/") + (capture ? "{}" : segment);
  }
  return shape;
}

/**
 * The same definition as JavaScript source, for the serve runtime template.
 * Deriving it from the compiled function keeps the rule written once: editing
 * `routeShapeFromSegments` edits both referees.
 */
export const ROUTE_SHAPE_FROM_SEGMENTS_SOURCE: string = routeShapeFromSegments.toString();

/** The shape of a full route path, for callers outside the hardened Realm. */
export function routeShape(path: string): string {
  return routeShapeFromSegments(path.split("/"));
}
