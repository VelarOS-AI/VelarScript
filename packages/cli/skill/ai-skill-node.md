# The VelarScript Node AI skill brief

Load this after `velar skill core`. This brief contains only the Node owner’s
contract. Core does not learn server declarations, path-pattern strings, Node
capabilities, or application configuration.

## Ownership and application entry

A Node service activates the extension and names one exported `ServeApp` or
one typed WebSocket startup function:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "outDir": "dist",
  "publicDir": "public",
  "extensions": ["@velarscript/node"],
  "node": {
    "app": "app",
    "host": "127.0.0.1",
    "port": 3000,
    "maxBodyBytes": 16777216,
    "build": {"sourceMaps": false}
  }
}
```

The entry exports application data; it does not need a manually named function
or top-level `serve(...)` call:

```velar fragment
import {app as routes} from "./app.vel"

export const app = routes
```

For one shared HTTP/WebSocket application port, `node.app` may instead name
exactly this function shape:

```velar fragment
import {app as routes} from "./app.vel"
import {listen} from "velar/websocket"

export async def start(host: string, port: number, maxBodyBytes: number):
    return await listen({
        host,
        port,
        http: routes,
        path: "/api/events",
        origins: ["https://app.example.com"],
        maxBodyBytes,
    })
```

Set `node.app` to `"start"`. The exact result is
`Promise<WebSocketServer>`; `dev`, `serve`, and the production launcher pass
the same three configured values.

Use `velar dev` while editing, `velar serve` for checked production runtime
behavior, and `velar build` for a standalone Node output directory. A direct
`serve(app, port=0)` call is still correct in integration tests or an embedded
server.

`@name` keeps its one language-wide role: it qualifies a compiler-owned name
in the current context. In a `server` block, the available names are `@get`,
`@post`, `@put`, `@patch`, `@delete`, and `@notFound`. They are not decorators,
functions, imports, annotations, first-class values, or user extension points.

## Routes and checked inputs

A server is an immutable anonymous route table:

```velar
import {HttpError, created} from "velar/serve"

type CreateArticle:
    title: string

export server articles:
    /// Reports whether this service is ready.
    @get(p"/health") => {ok: true}

    @get(p"/articles/{id:number}", details: bool = false):
        if id < 1:
            throw HttpError(404, {error: "article_not_found"})
        return {id, details}

    @post(p"/articles", input: CreateArticle):
        return created({id: 1, title: input.title})

```

The path is written once. A capture such as `{id:number}` declares `id`
directly in the route body, so never repeat it in the argument list. Captures
require an ASCII half-width `:` and accept `string`, `number`, `bool`, or
a named enum. The Node-only `p"..."` prefix marks a compile-time reverse
matcher; an ordinary string is not accepted, and Core does not recognize this
prefix.

Unadorned scalar and `List<scalar>` parameters are query inputs. A default makes
the input optional. Repeated query values populate a List; a repeated scalar is
a 422 error. On `POST`, `PUT`, or `PATCH`, one concrete Data parameter is the
checked JSON body. A `Request` parameter explicitly requests the complete
request, including `queryAll` and cooperative `cancellation`. Ambiguous bodies,
duplicate declarations, conflicting path shapes, and unsupported path types are
compile errors.

`@notFound()` is the one application fallback for a path that matches no
route. It may omit its parameter or accept one explicitly typed `Request`.
Returning Data keeps status 404; return an explicit response such as
`json(value, status=410)` to choose another final status. A matched route's
`HttpError` and framework 405 responses do not enter this fallback. Declare at
most one on the final application; an app that owns `@notFound` cannot be moved
under a non-root `prefix`, because a global fallback has no unambiguous prefix
scope. Compose prefixed route tables first, then declare the fallback on the
outer `server`. A catch-all route such as `staticFiles("/", ...)` is a matched
route and therefore owns its own file fallback instead of entering
`@notFound`.

Use ordinary values for the cases that need more than inference:

```velar
import {input, provide, security} from "velar/serve"

type User:
    id: string

type UploadMetadata:
    title: string

const currentUser = provide(
    inputs={token: security.bearer()},
    resolve=async values => {id: values.token},
)

server account:
    @get(p"/me",
        user=input.dependency(currentUser),
        tenant=input.header("x-tenant"),
        session=input.cookie("session", default=null),
    ) => {id: user.id, tenant, session}

    @post(p"/images",
        metadata=input.form(UploadMetadata),
        image=input.upload("image", maxBytes=8_388_608),
    ) => {title: metadata.title, filename: image.filename}
```

`input.query`, `input.header`, and `input.cookie` select named scalar
values. `input.form(Type)` checks URL-encoded or multipart fields, including
repeated fields for `List<scalar>` properties; duplicate scalar fields fail.
`input.upload` returns an `Upload` whose bytes are valid only for the request
lifetime; copy or persist them before retaining data. `security.apiKey`,
`basic`, `bearer`, `oauth2`, and `openId` parse credentials and also
feed OpenAPI security schemes.

`provide(inputs, resolve, scope="request", release=null, eager=false)` declares
a dependency as data. A request-scoped provider resolves once per request even
when injected repeatedly and releases after response/background completion.
An app-scoped provider may depend only on other app-scoped providers, may be
eager, and releases during shutdown. Cycles and provider-budget exhaustion fail
closed. Do not build a controller or container layer around it.

## Composition, lifecycle, and middleware

Compose route tables as values:

```velar fragment
import {Request, RouteDocumentation, docs, lifecycle, middleware, prefix, staticFiles, use} from "velar/serve"

const service = lifecycle(
    prefix("/api", articles),
    startup=async () => null,
    shutdown=async () => null,
)

const hardened = use(service, [
    middleware.trustedHosts(["api.example.com", "127.0.0.1"]),
    middleware.cors(origins=["https://app.example.com"], credentials=true),
    middleware.requestId(),
    middleware.securityHeaders(),
    middleware.compression(minimumBytes=1024),
    middleware.timeout(10_000),
    middleware.concurrency(256),
])

const articleDocs: RouteDocumentation = {summary: "Read article", tags: ["articles"], errors: Map([[404, "Article not found"]])}
const routeDocs: Map<string, RouteDocumentation> = Map([["GET /api/articles/{id:number}", articleDocs]])

export server app:
    ...docs(hardened, title="Article API", version="1.0.0", routes=routeDocs)
    ...staticFiles("/assets", root="public")
    @notFound(request: Request) => {error: "route_not_found", path: request.path}
```

`prefix` changes a literal route prefix; `bodyLimit` narrows one route
table’s body budget; `use` attaches middleware only to the routes it receives.
A middleware continuation is single-use. Built-ins also include access logging
and explicit error recovery. A timeout response does not pretend downstream
work was cancelled: its request resources remain alive until that work really
ends, and the runtime caps unfinished timed-out tasks.

Overlapping routes are refused by two referees. At compile time the analyzer
follows the path-preserving combinators: `use`, `bodyLimit`, `docs`, and
`lifecycle` carry their app argument’s routes through unchanged, and `prefix`
translates them when its path is a string literal. So
`...prefix("/api", routes)` is checked against the composing server’s own
routes at the translated addresses, and the diagnostic names that address and
the server the route was composed in from. A module-level `const` alias of a
server resolves, and so does a `let` the module never reassigns. A spread the
analyzer cannot resolve, such as an imported server, a computed prefix path, or
an app handed back by a function, is deliberately let through; a false conflict
here would block a correct program. The final route table exists only at
assembly, so the runtime judges it there: an overlapping table refuses to build,
and the failure names both routes, where each one came from, and the method and
path shape they share. Both referees read one definition of that shape, and a
program the compiler rejected never reaches assembly, so nothing is reported
twice.

`lifecycle` owns paired startup and shutdown hooks. Successful startups unwind
in reverse order; a failed startup does not run its paired shutdown.
`background(response, task)` keeps request-scoped resources valid until the
task finishes. `setCookie` and
`clearCookie` add checked cookie headers, preserving separate `Set-Cookie`
fields. Never start long-lived work by
dropping a Promise; use an owned lifecycle, background task, Worker, or process.

`docs` adds a bundled offline UI and OpenAPI 3.1 JSON. Compiler route types
and response helpers supply parameter, body, response, content-type, and static
success-status schemas. Applicable framework-generated 400, 401, 413, 415, and
422 responses are included automatically; a preceding `///` comment supplies
the route description. The optional ordinary typed
`Map<string, RouteDocumentation>` can add
summary, description, tags, success status, documented error statuses, or hide
a route, keyed by strings such as `"GET /articles/{id:number}"`. This metadata
is data, not another `@` category.

## Responses and realtime

Ordinary Data returns JSON. Use the explicit helpers only when transport
semantics matter: `json`, `created`, `noContent`, `redirect`, `text`,
`file`, `stream`, `sse`, `background`, `setCookie`, and
`clearCookie`. `HttpError(status, body, headers=null)` is the expected HTTP
failure. Unexpected failures are reported on stderr and become an opaque 500.

`HEAD` reuses `GET` without a body. `OPTIONS` and 405 responses publish a
complete `Allow` header. Final response statuses are 200 through 599; 204 and
304 are bodyless. Streaming follows write backpressure; each chunk and the
total stream are bounded. SSE accepts text or checked
`{data, event?, id?, retry?}` events. Static and returned files are canonical
root-contained, streamed reads with validators and one byte range.

`velar/websocket.listen({http: app, ...})` serves a `ServeApp` and WebSocket
upgrades on one native server and owns the application lifecycle. Set
`maxBodyBytes` to the supplied application value. `origins` contains exact
canonical HTTP/HTTPS origins. The default rejects any upgrade carrying
`Origin`; no-Origin non-browser clients remain allowed. Use `["*"]` only for an
intentional unrestricted policy. A rejected browser origin receives 403 before
it consumes connection-queue capacity. Connections are pull-based. Always
consume `next()`, handle backpressure, and stop the server.

## Tests

Use `velar/server-test` only from `*.test.vel`. It runs the real ServeApp
router, providers, lifecycle, cookies, forms, uploads, streams, and files in
process without opening a port:

```velar fragment
import {client} from "velar/server-test"
import {expect} from "velar/test"
import {app} from "./app.vel"

test "health endpoint":
    const api = await client(app)
    try:
        const response = await api.get("/api/health")
        expect(response.status).toBe(200)
        expect(await response.text()).toContain("ok")
    finally:
        await api.close()
```

Pass a `Map<Provider, value>` as the second `client` argument to override
dependencies. Request options support headers, JSON, text, form Maps, and file
Maps. Test WebSocket behavior through a real local `velar/websocket` server,
because WebSocket upgrades are a transport boundary rather than an in-process
HTTP request.

## Memory and ownership rules

The runtime has hard ceilings; application code must preserve them:

- Request bodies are at most 16 MiB, with narrower per-route and project limits.
  HTTP request bodies, buffered responses, static files, and stream chunks also
  share one 128 MiB isolated-host budget.
- Live inbound HTTP requests and middleware concurrency are capped at 4,096.
  ServeApp routes, request providers, app providers, and timed-out unfinished
  work have separate count limits.
- WebSocket queued bytes and pending-send bytes share a 128 MiB budget. Global
  limits also cover active connections, pending connection objects, queued
  message objects, and pending send Promises, including zero-byte messages.
- Multipart parsing reuses bounded body storage; an `Upload` is invalidated
  when its request scope ends. Provider caches and release lists are explicitly
  cleared at request or application shutdown.
- Development rebuilds serialize changes, retain one last-good child, stop the
  old child before replacing it, and delete temporary build sandboxes.

Set smaller limits for the domain instead of treating framework maxima as
defaults. Stream large data, consume pull queues promptly, close every owned
capability, and keep caches explicitly bounded.

## Concurrency and shutdown rules

Concurrency limits are admission control, not a lock around application data.
The runtime guarantees that an application-scoped provider initializes once,
concurrent `stop` or `close` calls join the same completion, shutdown refuses
new work, requests receive cooperative cancellation, and provider release begins
only after every admitted request has finished its response, timed-out
continuation, background work, and request cleanup. `stop(grace=30000)` bounds
the drain wait without releasing live request resources early. WebSocket stop
closes connections in parallel with a bounded handshake and releases unread
queues and pending-send reservations.

Application code still owns business-level consistency. Do not use an
unprotected module-level mutable record as a cross-request database. Put
multi-write invariants in a database transaction or another capability that
provides atomic operations. Always await stream writes, allow only one active
pull from an async iterator, and make retryable handlers idempotent. A
`middleware.concurrency` limit protects capacity; it does not make a shared
read-modify-write sequence atomic.

## Node capabilities and finish

Use `velar/fs`, `velar/path`, `velar/process`, `velar/env`,
`velar/terminal`, `velar/http`, `velar/worker`, and `velar/websocket` instead of
ambient Node globals. Database contracts, drivers, codecs, and other
application integrations are project-owned modules or dependencies. Declare
third-party boundaries with checked `extern module`; keep `import js unsafe`
at one narrow validation boundary.

An HTTP response has no `ok` field on any target: `response()` throws
`HttpResponseError` for every non-2xx status before the value exists, so every
response the code can hold already succeeded. Wrap the call in `try:` /
`catch failure:`, narrow with `if failure is HttpResponseError:` —
`HttpResponseError` is imported from `velar/http` — and read `failure.status`
there.

Wire-shaped values arrive as `unknown`, not as a checked shape. An
`HttpError`’s `body`, the payload of a response whose declared type is
`ServeResponse`, the path items of an `openapi(...)` document, the error handed
to a `middleware.errors` handler, and a test response’s parsed body are all
`unknown`: validate one with `Type.parse`, or narrow it, before touching a
member. A middleware reaches no payload at all: `await next()` answers the whole
`ServeResponse` union, whose three variants share no payload field and no
discriminant, so `status` and `headers` are the members it can read.
`request.parse(Report)` is unchanged and stays the checked way in. Constructing
responses is unchanged too; `json` and `created` accept any payload and hand
back a response whose payload keeps the type it was given, and that payload
turns into a read-only `unknown` once the value is widened to `ServeResponse`,
which is what lets a response carrying a concrete payload still be a
`ServeResponse`.

Run `velar format --check`, `velar check`, `velar test`, and
`velar build`. The complete runnable spelling lives in
`examples/tour/node/`; current diagnostics outrank this brief.
