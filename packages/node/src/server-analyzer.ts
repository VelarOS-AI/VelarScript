/**
 * The Node analyzer's public face, unchanged.
 *
 * D115 P4 R4a moved the analyzer into `analysis/` — the composition root, the
 * route, handler and composition collaborators, the intrinsic families, the
 * response-shape predicates and the OpenAPI derivation — and the route-hint
 * codecs into `contracts.ts`. This module re-exports exactly what it exported
 * before, so `compiler.ts` and `server-emitter.ts` import from the same path
 * they always did (D115 §四: 门面不变).
 */
export { inferNodeIntrinsic } from "./analysis/calls/intrinsics.ts";
export { VelarNodeAnalyzer } from "./analysis/server-analyzer.ts";
export {
  parseRouteCaptureHint,
  parseRouteParameterHint,
  parseRouteResultHint,
  routeCaptureHint,
  routeParameterHint,
  routeResultHint,
  type RouteParameterKind,
  type RouteParameterSource,
} from "./contracts.ts";
