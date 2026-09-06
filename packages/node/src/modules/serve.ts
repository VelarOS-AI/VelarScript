import { NODE_PROJECT_IDENTITY_SOURCE, portableProjectIdentity, portableProjectRootOffset } from "../project-config.ts";
import { ROUTE_SHAPE_FROM_SEGMENTS_SOURCE } from "../route-shape.ts";
import { VELAR_NODE_SERVE_BODY, VELAR_NODE_SERVE_PREFIX } from "../runtime-sources.generated.ts";

/**
 * `velar/serve`, closed over the one route-shape definition and the one fact
 * about its own placement that only a build knows.
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
 *
 * D114 F7-node-b item 2 adds the second such line. The config a build renders
 * this module from carries `projectRootOffset`: the path from the directory the
 * emitted entry lands in back to the project root — `..` for a directory build
 * inside the project, `../..` for the `velar run` sandbox under
 * `<project>/.velar/` — and it is what lets a relative static `root` mean the
 * directory the author wrote it against rather than wherever this build
 * happened to put the entry. Only the build knows it, so it cannot be resolved
 * into the runtime file either. No config is the honest answer for every caller
 * that is not a build — an editor, a test host, the module read straight out of
 * the sources map — and leaves the entry's own directory as the only candidate,
 * which is what `velar/serve` did before.
 *
 * D114 F9-node-cli (audit NO-D1) adds the third and fourth. `projectIdentity` is
 * who the project at that offset has to be, and `__velarServeProjectIdentityOf`
 * is the compiled source of the one function that decides it, so the build and
 * the emitted module read a `velar.json` the same way. Without them the offset
 * named a *place*, and any directory standing in that place was believed.
 *
 * `project-config.ts`'s `velarNodeServeProjectConfig` is where those facts are
 * put, for every extension set that carries this module rather than for
 * `@velarscript/node` alone (D114 SV-X1).
 */
export function velarNodeServeSource(projectConfig: unknown = null): string {
  const nodeConfig = projectConfig && typeof projectConfig === "object" && !Array.isArray(projectConfig)
    ? projectConfig as {readonly projectRootOffset?: unknown; readonly projectIdentity?: unknown}
    : null;
  return `${VELAR_NODE_SERVE_PREFIX}const __velarServeProjectRootOffset = ${JSON.stringify(portableProjectRootOffset(nodeConfig?.projectRootOffset))};
const __velarServeProjectIdentity = ${JSON.stringify(portableProjectIdentity(nodeConfig?.projectIdentity))};
const __velarServeProjectIdentityOf = ${NODE_PROJECT_IDENTITY_SOURCE};
const __velarServeRouteShapeFromSegments = ${ROUTE_SHAPE_FROM_SEGMENTS_SOURCE};
${VELAR_NODE_SERVE_BODY}`;
}
