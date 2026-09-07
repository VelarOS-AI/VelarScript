/**
 * Everything this server answers over HTTP: the origin and method guards, the
 * three `/__velar` control routes, and the document, stylesheet, module,
 * standard-module, npm and public-asset routes behind them.
 *
 * Every route reads `state.snapshot` where it needs it rather than taking a
 * copy at the top: a rebuild can land while a request awaits a file, and what
 * the rest of that request answers with is the tree as it now stands.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResolvedFrameworkHost, VelarProjectConfig } from "../config.ts";
import { localRequestRefusal } from "../local-request-guard.ts";
import { moduleOutput, publicAsset } from "../module-assets.ts";
import { npmAsset } from "../npm.ts";
import { standardModuleAsset } from "../standard-modules.ts";
import { send, sendFile, stripBase } from "./http.ts";
import { mapSourcePosition } from "./source-map.ts";
import type { DevelopmentServerState } from "./state.ts";

/** What every route needs: the project, its framework host, the base, and the live state. */
export interface DevelopmentRequestContext {
  readonly config: VelarProjectConfig;
  readonly framework: ResolvedFrameworkHost;
  readonly base: string;
  readonly state: DevelopmentServerState;
}

export async function handleDevelopmentRequest(
  context: DevelopmentRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const { base } = context;
  // Before routing: a page that has rebound its own hostname to 127.0.0.1 is
  // otherwise same-origin with this server and can read `/main.js.map`, whose
  // `sourcesContent` is the project's verbatim source.
  const refusal = localRequestRefusal(request.headers);
  if (refusal) {
    send(response, refusal.status, `Refused: ${refusal.message}\n`, "text/plain; charset=utf-8");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    send(response, 405, "Method not allowed\n", "text/plain; charset=utf-8");
    return;
  }
  let url: URL;
  // The Host header has already been judged above, so the fixed base here only
  // supplies a scheme and authority for path parsing.
  try { url = new URL(request.url ?? "/", "http://127.0.0.1"); }
  catch { send(response, 400, "Bad request path\n", "text/plain; charset=utf-8"); return; }
  let pathname: string;
  // Everything downstream reads a filesystem-shaped path: `publicAsset` and
  // the module routes resolve the pathname literally, so `public/my file.txt`
  // is unreachable until the escape is decoded. `publicAsset` keeps its `..`
  // and `relative()` confinement, which runs after this decoding.
  try { pathname = decodeURIComponent(url.pathname); }
  catch { send(response, 400, "Bad request path\n", "text/plain; charset=utf-8"); return; }
  const routedPath = stripBase(pathname, base);
  if (serveDevelopmentControlRoute(context, request, response, routedPath, url)) return;
  await serveDevelopmentAsset(context, request, response, routedPath, url);
}

/**
 * The three routes this server owns rather than serves: the reload event
 * stream, the source-position query, and the status document. Answers whether
 * the route was one of them.
 */
function serveDevelopmentControlRoute(
  context: DevelopmentRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
  routedPath: string,
  url: URL,
): boolean {
  const { base, framework, state } = context;
  if (routedPath === "/__velar/events") {
    if (request.method === "HEAD") { response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }).end(); return true; }
    if (state.clients.size >= 64) { send(response, 503, "Too many development event clients\n", "text/plain; charset=utf-8"); return true; }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write("event: ready\ndata: connected\n\n");
    if (state.snapshot.errors.length > 0 && state.snapshot.artifacts) {
      response.write(`event: reload\ndata: ${JSON.stringify({ revision: state.revision, errors: state.snapshot.errors, fullReload: false })}\n\n`);
    }
    state.clients.add(response);
    request.on("close", () => state.clients.delete(response));
    return true;
  }
  if (routedPath === "/__velar/map") {
    const file = url.searchParams.get("file");
    const line = Number(url.searchParams.get("line"));
    const column = Number(url.searchParams.get("column"));
    const mapped = file && Number.isInteger(line) && Number.isInteger(column)
      ? mapSourcePosition(state.snapshot.project, stripBase(file, base), line, column)
      : null;
    send(response, mapped ? 200 : 404, JSON.stringify(mapped ?? { error: "Source position was not mapped" }), "application/json; charset=utf-8");
    return true;
  }
  if (routedPath === "/__velar/status") {
    send(response, 200, JSON.stringify({
      framework: framework.host.id,
      protocolVersion: framework.host.protocolVersion,
      apiVersion: framework.host.apiVersion,
      revision: state.revision,
      ready: state.snapshot.errors.length === 0 && state.snapshot.artifacts !== null,
      errors: state.snapshot.errors,
      notices: state.snapshot.notices,
      compilation: state.snapshot.compilation,
      packages: state.snapshot.project.velarPackages.map((item) => item.name).sort(),
    }), "application/json; charset=utf-8");
    return true;
  }
  return false;
}

/** The document, the stylesheet, and every module, standard module, package and public asset behind them. */
async function serveDevelopmentAsset(
  context: DevelopmentRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
  routedPath: string,
  url: URL,
): Promise<void> {
  const { config, framework, state } = context;
  if (routedPath === "/" || routedPath === "/index.html") {
    if (state.snapshot.errors.length > 0 && !state.snapshot.artifacts) {
      send(response, 500, framework.host.createErrorDocument({ config: framework.config, errors: state.snapshot.errors }), "text/html; charset=utf-8");
    } else if (state.snapshot.artifacts) {
      send(response, 200, state.snapshot.artifacts.html, "text/html; charset=utf-8");
    } else {
      send(response, 400, framework.host.createErrorDocument({ config: framework.config, errors: ["The framework host did not create an application entry."] }), "text/html; charset=utf-8");
    }
    return;
  }
  if (routedPath === "/styles.css" && state.snapshot.artifacts) {
    send(response, 200, state.snapshot.artifacts.css, "text/css; charset=utf-8");
    return;
  }
  const workerModule = state.snapshot.workerModules.get(routedPath.replace(/^\//u, ""));
  if (workerModule) {
    send(response, 200, workerModule, "text/javascript; charset=utf-8");
    return;
  }
  const module = moduleOutput(state.snapshot.project, routedPath, url.searchParams.get("velar"));
  if (module) {
    send(response, 200, module.body, module.contentType);
    return;
  }
  const standard = standardModuleAsset(routedPath, config.extensionConfig, config.compilerExtensions);
  if (standard !== null) {
    send(response, 200, standard, "text/javascript; charset=utf-8");
    return;
  }
  const packageAsset = await npmAsset(state.snapshot.npmPackages, routedPath);
  if (packageAsset) {
    await sendFile(response, packageAsset, request.method === "HEAD");
    return;
  }
  const asset = await publicAsset(state.snapshot.project.publicRoot, routedPath);
  if (asset) {
    await sendFile(response, asset, request.method === "HEAD");
    return;
  }
  if (state.snapshot.artifacts && request.method === "GET" && request.headers.accept?.includes("text/html")) {
    send(response, 200, state.snapshot.artifacts.html, "text/html; charset=utf-8");
    return;
  }
  send(response, 404, "Not found\n", "text/plain; charset=utf-8");
}
