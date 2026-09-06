import { ROUTE_SHAPE_FROM_SEGMENTS_SOURCE } from "../route-shape.ts";
import { VELAR_NODE_SERVE_BODY, VELAR_NODE_SERVE_PREFIX } from "../runtime-sources.generated.ts";

/**
 * `velar/serve`, closed over the one route-shape definition.
 *
 * D90 R19(c): a route's shape — its method-independent collision key — is one
 * concept with one definition, in `route-shape.ts`. The static analyzer calls
 * that function; the emitted module carries its **compiled source**, so the two
 * referees cannot drift. That source is therefore not a generation-time
 * constant: it reads differently depending on whether `route-shape.ts` was
 * type-stripped from `src` or compiled into `dist`. Resolving either form into
 * `runtime/serve.js` would silently change what the other one emits, so the
 * runtime is cut at that line and this function is what puts it back — the same
 * treatment `velar/server` gets for the configuration path a project selected
 * (D115 §一.4, `runtime/manifest.json` `assemblies`).
 */
export function velarNodeServeSource(): string {
  return `${VELAR_NODE_SERVE_PREFIX}const __velarServeRouteShapeFromSegments = ${ROUTE_SHAPE_FROM_SEGMENTS_SOURCE};
${VELAR_NODE_SERVE_BODY}`;
}
