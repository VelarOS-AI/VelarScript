/**
 * The hover documentation for the Node application syntax: the five route
 * roles, `server`, `p"..."`, `@websocket`, `@notFound` and `@response`. Split
 * out of `compiler.ts` so both files stay inside D115 §一.1's reading budget —
 * this is prose the editor shows, and it is read and edited on its own.
 */

const nodeRouteDocumentation = (method: string, usage: string, input: string): string => [
  `Declares a ${method} route in the current \`server\`. This is a compiler-owned role, not a decorator, function, or runtime value.`,
  "",
  "```velar",
  usage,
  "```",
  "",
  "An optional identifier before `(` is a stable operation identity copied into OpenAPI and checked across composition.",
  "",
  `The first argument is a checked \`p\"/...\"\` RoutePattern. An inline pattern projects its captures as immutable handler locals; append \`as route\` to bind the complete RouteMatch, and use that form for a catalog expression. ${input} The handler may use \`await\` directly and must return Data or a response from \`velar/serve\`.`,
].join("\n");

export const nodeKeywordDocumentation = Object.freeze({
  server: [
    "Declares an immutable Node HTTP route table. `server` is contextual syntax owned by `@velarscript/node`, not a class or mutable runtime registry.",
    "",
    "```velar",
    "export server routes:",
    "    @get health(p\"/health\") => {ok: true}",
    "```",
    "",
    "A server body contains HTTP and `@websocket` route roles, one `@notFound` fallback, one `@response` policy, and `...otherApp` composition entries.",
  ].join("\n"),
  p: [
    "Creates a first-class Node RoutePattern. It is parsed and checked by the compiler; it is not a function call or an ordinary string prefix.",
    "",
    "```velar",
    "@get(p\"/articles/{id:number}\") => {id}",
    "```",
    "",
    "Each `{name:type}` capture becomes an immutable local in direct mode. `p\"/...\" as route` instead exposes `route.pattern`, `route.pathname`, `route.params`, and `route.query`; `str(route)` returns the complete pattern declaration, and referenced catalog patterns require this explicit binding. A type suffix `?` makes a query field optional.",
  ].join("\n"),
  "@get": nodeRouteDocumentation(
    "GET",
    "@get readArticle(p\"/articles/{id:number}?{details:bool?}\") => {id, details}",
    "Inline path and query captures are projected directly as immutable locals.",
  ),
  "@post": nodeRouteDocumentation(
    "POST",
    "@post createArticle(p\"/articles\", input: CreateArticle) => created(input)",
    "One Data parameter may receive the checked JSON request body; query fields belong to the RoutePattern.",
  ),
  "@put": nodeRouteDocumentation(
    "PUT",
    "@put(p\"/articles/{id:string}\", input: UpdateArticle) => {id, input}",
    "One Data parameter may receive the checked JSON request body; query fields belong to the RoutePattern.",
  ),
  "@patch": nodeRouteDocumentation(
    "PATCH",
    "@patch(p\"/articles/{id:string}\", input: ArticlePatch) => {id, input}",
    "One Data parameter may receive the checked JSON request body; query fields belong to the RoutePattern.",
  ),
  "@delete": nodeRouteDocumentation(
    "DELETE",
    "@delete(p\"/articles/{id:string}\") => noContent()",
    "Inline path and query captures are projected directly as immutable locals.",
  ),
  "@websocket": [
    "Declares a framework-owned WebSocket session route in the current `server`. The shared HTTP listener validates the RoutePattern and inputs before upgrading, then owns the handler until the connection ends.",
    "",
    "```velar",
    "@websocket worldRealtime(p\"/worlds/{worldId:string}/realtime\", connection: WebSocketConnection):",
    "    async for message in connection:",
    "        await connection.send(message)",
    "```",
    "",
    "An optional operation identifier is checked across composition and appears in OpenAPI as a GET upgrade with response 101 and `x-velar-transport: websocket`. Exactly one `WebSocketConnection` parameter is required. Route captures use the same direct projection or `as route` rules as HTTP; Request, dependency, security, header, and cookie inputs are resolved before the upgrade. The handler resolves to null and is joined with the application lifecycle.",
  ].join("\n"),
  "@notFound": [
    "Declares the final application's one unmatched-path fallback. It is a compiler-owned server role, not a decorator or ordinary function.",
    "",
    "```velar",
    "@notFound(request: Request) => {error: \"route_not_found\", path: request.path}",
    "```",
    "",
    "The optional parameter must be `Request`. Returning Data keeps status 404; an explicit response may choose another status. It does not catch a matched route's error or method-not-allowed response.",
  ].join("\n"),
  "@response": [
    "Declares the final application's one semantic response policy. It is a compiler-owned server role, not a decorator or ordinary function.",
    "",
    "```velar",
    "@response(outcome: HttpOutcome, request: Request) => json({ok: outcome.ok, data: outcome.value}, status=outcome.status, headers=outcome.headers)",
    "```",
    "",
    "The policy receives route and framework outcomes once and returns Data or one final response. A final response owns its status and headers, so forward the outcome values when only selecting an encoder. The policy cannot return another HttpOutcome.",
  ].join("\n"),
});
