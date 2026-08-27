# @velarscript/node

The official Node.js runtime boundary for VelarScript. It owns the typed module
contracts and implementations for `velar/fs`, `velar/hash`, `velar/env`, `velar/host`,
`velar/serve`, `velar/path`, `velar/process`, `velar/terminal`,
`velar/worker`, and `velar/websocket`, plus the Node target of `velar/http`.

The API exposes VelarScript contracts rather than Node objects. Filesystem
operations are bounded, process execution is shell-free and starts with a
secret-minimizing environment, and HTTP streaming keeps timeout and
cancellation active until the response body has finished. `secretHeader`
references an environment variable without placing its value in VelarScript
application state; creating a lazy request retains only its validated descriptor,
the official runtime resolves the current value at the first effect and sends it
only across the private host transport, and cross-origin redirects strip it.
`HttpResponseError`, `HttpAbortError`, and `HttpTransportError` separately
represent non-2xx responses, owned cancel/deadline outcomes, and
request/response network transport failure. The transport phase is typed; retry
and replay policy stays with the provider or application.

`velar/hash.sha256Text(text)` is the bounded deterministic build-tool digest:
UTF-8 input, a 16 MiB ceiling, and a 64-character lowercase hexadecimal result.
It does not expose Node's mutable `Hash` handle or a general cipher surface.

The package also owns Node's native server syntax. A low-level project may
activate `@velarscript/node` directly, then declare anonymous checked routes:

```velar
import {created} from "velar/serve"
import {WebSocketConnection} from "velar/websocket"

type CreateArticle:
    title: string

export server app:
    @get health(p"/health") => {ok: true}
    @get readArticle(p"/articles/{id:string}?{details:bool?}") => {id, details: details ?? false}
    @post createArticle(p"/articles", input: CreateArticle) => created(input)

    @websocket worldRealtime(p"/worlds/{worldId:string}/realtime", connection: WebSocketConnection):
        async for message in connection:
            await connection.send(message)
```

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "build": {"mode": "production", "sourceMaps": false},
  "extensions": ["@velarscript/node"],
  "node": {
    "app": "start"
  }
}
```

The entry is an exact zero-argument async function returning `Server` or
`WebSocketServer`. Calling `serve(...)` directly remains available for tests,
embedded servers, and low-level protocol adapters.

An ordinary service activates the separate `@velarscript/server` application
extension instead. It composes this Node capability and owns root
`application.yml`, startup assembly, abstract connection lifecycle, and the
typed `realtimeSession` application wrapper. Without that explicit extension,
`velar/server` is unavailable and application configuration is not loaded.
Host, port, and request ceilings do not belong in `node` manifest settings.

When declarative HTTP and WebSocket routes share one port, the entry may return
`Promise<WebSocketServer>`:

```velar fragment
import {app as routes} from "./app.vel"
import {listen} from "velar/websocket"

export async def start():
    return await listen({
        host: "127.0.0.1",
        port: 3000,
        http: routes,
        origins: ["https://app.example.com"],
        maxBodyBytes: 16777216,
    })
```

The CLI supplies no host, port, or body-limit arguments. Server applications
read those values once through `@velarscript/server` conventions.

`p"..."` is scanned and checked only by this extension; Core does not acquire a
general `p` string prefix. Captures use `{name:type}` with a half-width `:`. An
inline pattern projects captures and query fields directly as immutable handler
locals. A referenced pattern must use `as route`; its `RouteMatch` exposes
`pattern`, `pathname`, `params`, and `query` without injecting hidden names.
`wire={field:type}` maps distinct query names; a redundant same-name mapping is
accepted with advisory `A11` and a mechanical shorthand fix. The five route verbs are context annotations
with compiler-owned route roles rather than decorators. The compiler lowers each `server` to an
immutable `ServeApp`; `velar/serve` owns runtime matching, checked input
decoding, automatic JSON, composition, static files, middleware, errors, and
OpenAPI generation. Middleware stays attached to the route table passed to
`use` when applications are composed; `bodyLimit` narrows inferred JSON input
per route group. Response helpers accept validated header Maps, and the host
accepts only final 200–599 statuses and enforces bodyless `HEAD`, 204, and 304
responses. OpenAPI parameter, request-body, response, content-type, and static
success-status schemas come from compiler-checked route types rather than
runtime reflection; applicable framework-generated 400, 401, 413, 415, and 422
responses are documented automatically. Unexpected handler or middleware failures are
reported on stderr while the client receives only an opaque 500 response.

An optional source identifier between a route role and `(` gives that operation
a stable protocol identity: `@get readArticle(...)` and `@websocket
worldRealtime(...)`. It must be unique after server composition. OpenAPI uses
the exact identity and includes WebSocket routes as GET upgrades with a 101
response and `x-velar-transport: websocket`, so a client can discover both
transports without copying path strings. Omitting the identity keeps the compact
local-route form and generates a descriptive OpenAPI identity from method and
path.

The framework covers the ordinary service surface without adding controller or
decorator vocabulary. Query inputs belong to the `RoutePattern`; other route
defaults may be explicit `input.header`, `input.cookie`, `input.form`, `input.upload`, or
`input.dependency` values; `security` supplies API-key, Basic, Bearer, OAuth2,
and OpenID descriptors. `provide` owns request- and application-scoped values,
deduplicates them, detects cycles, and runs release callbacks at the end of the
owning scope. `lifecycle`, `background`, cookie helpers, SSE, bounded streaming,
multipart uploads, route-scoped middleware, offline `docs`, OpenAPI 3.1, and
the test-only `velar/server-test` client are part of the same checked runtime.
Security descriptors extract credentials and own their transport-level 401
challenge; they do not validate token signatures, sessions, passwords, or
identities. The separate Server extension supplies the provider-neutral
`authenticate` composition helper, while concrete verification remains an
installed library or application dependency.
Repeated scalar `RoutePattern` query fields fail with 422. Applications that
intentionally model repeated query values read `Request.queryAll` explicitly;
checked `List<scalar>` form fields preserve all repeated values. Request paths and queries
are decoded exactly once with invalid UTF-8, encoded separators, NULs, and dot
segments rejected before routing. Multiple cookies stay separate on the wire.
`@websocket` routes own matching, dependency and credential resolution,
handshake rejection, and handler lifetime. Exactly one `WebSocketConnection`
parameter is required. `velar/websocket.listen({http: app, ...})` composes the
ServeApp lifecycle on one HTTP/WebSocket port; when the app contains declarative
WebSocket routes, the listener's legacy single `path` option is rejected.
`host` is non-empty text of at most 255 code units without NUL.
`origins` accepts only exact canonical HTTP/HTTPS
origins. Its default rejects every browser-style upgrade carrying `Origin`;
requests without `Origin` remain available to non-browser clients, and
`origins: ["*"]` is the explicit unrestricted policy. Rejection returns 403
before a connection consumes queue capacity. `maxBodyBytes` applies the same
bounded body ceiling to HTTP requests handled on the shared listener.

Memory limits compose instead of multiplying silently: HTTP owns a 128 MiB
aggregate host budget and at most 4,096 inbound requests; request bodies remain
at or below 16 MiB. Request/application providers, routes, unfinished timed-out
tasks, WebSocket connections, queued messages, pending sends, pending
connections, and their aggregate bytes all have hard ceilings. Request caches,
upload views, application provider caches, connection queues, and development
build sandboxes are released at their explicit lifecycle boundary.

Shutdown is drain-first and idempotent: concurrent `stop`/`close` calls join
one completion, new work is refused once draining starts, admitted requests
receive cooperative cancellation, and application providers are released only
after request and timed-out continuation ownership really finishes. Lifecycle
pairs unwind only for successful startups and in reverse order. These
guarantees protect framework-owned state; cross-request business invariants
still belong in transactions or another explicitly atomic capability.

Started processes expose pull-based, enum-tagged stdout/stderr chunks through
the ordinary VelarScript `async for` protocol. Each channel is decoded as one
incremental UTF-8 stream; only one pull may be active, output is consumed before
`wait`, and the same bounded aggregate remains available from `wait`.
Process value validation and result assembly use one module-initialized host
ABI shared with `@velarscript/desktop`. It captures the relevant JavaScript
reflection, collection, Promise, timer, and immutable-result operations; both
targets separately compose the compiler-owned captured UTF-8 runtime. Later
prototype replacement therefore cannot redefine the official contract. This
internal fragment is exported only from the compiler entry for target
composition; it is not a public VelarScript module or an Agent abstraction.

Node's actual child-process transport runs in one eagerly initialized Worker
that imports only compiler-owned source and Node built-ins. This is necessary
because Node's own spawn path dynamically consults public EventEmitter and
stream prototypes; capturing only the wrapper methods in the application Realm
would leave the official contract redirectable. The application-facing module uses a
captured, bounded MessagePort protocol and revalidates every result. The Worker
is unreferenced while idle, referenced while requests or children are active,
and limits unreleased process handles to 128. None of Worker, MessagePort,
ChildProcess, Buffer, or StringDecoder enters the VelarScript API.

`velar/fs`, `velar/serve`, and the Node target of `velar/http` share a second isolated Worker through the private
compiler dependency `velar/node-host-v1`. The name is an implementation edge,
not an importable Standard API module. The application Realm validates paths,
Velar values, handlers, runtime Types, strict JSON, UTF-8, and immutable result
shapes. The Worker alone owns `node:fs/promises`, HTTP/HTTPS clients and servers,
sockets, request/response streams, incremental fatal UTF-8 decoding, redirects,
static-file reads, response writes, and backpressure. It imports only
compiler-owned source and static Node built-ins; npm dependencies and
VelarScript application code never execute in that Realm.

The shared proxy eagerly completes one readiness handshake and separates a
4,096-operation data lane from a 4,608-operation server lane, leaving control
capacity available while inbound requests are saturated. It is unreferenced
while idle. A pending filesystem, server, or HTTP operation and every active
server or unread HTTP response retain the process. Server and request
handles are bounded, wrap without colliding with live identities, and cap live
servers at 128, inbound requests at 4,096, and outbound HTTP requests at 1,024.
Every message is revalidated on both sides. In addition to each public request/file/stream limit, the Worker owns one
128 MiB aggregate budget for cached request bodies, static files, buffered text
responses, and in-flight stream chunks. A request returns its stable bytes only
after the transport has finished or closed and all concurrent host operations
have settled, preventing both leaks and disconnect-time double release.
Filesystem creation uses one explicit no-clobber primitive: `createText(path,
text)` reaches an OS exclusive-create operation in this Worker. It is never an
existence check followed by `writeText`, so a concurrent creator or symbolic
link cannot be overwritten between two host calls.
Optimistic edits use `replaceTextIfMatches(path, expected, replacement)`. The
Worker coordinates file mutations for one canonical target, compares exact
UTF-8 bytes, and commits matching content with a same-directory rename. It
returns `false` on a detected mismatch. This is atomic against cooperating
operations inside the runtime host and never exposes a partial replacement,
but it deliberately does not claim to lock unrelated processes that bypass the
API.
`watchFiles(path, recursive=false)` returns a resource-owned `FileWatcher`
whose single active `next()` pull yields bounded, sorted, deduplicated absolute
paths. A batch is an invalidation hint, not a lossless operating-system event
log: an unknown filename or exhausted 4,096-path/2 MiB queue yields
`{paths: [], rescan: true}`. At most 128 watchers are live; `close()` is
idempotent, settles a pending pull with `null`, and releases the shared Worker
reference. Native watcher failures are terminal. The returned path List is a
validated ordinary VelarScript List rather than a frozen host collection.
`velar/serve` keeps request and response JSON on the compiler-owned strict JSON
boundary; its public runtime types and response dispatcher inspect own data
descriptors without invoking getters or collection overrides.

`velar/env` and `velar/host` each own a module-initialized host fragment rather
than rediscovering application globals during an operation.
Environment reads retain the original `process.env` identity and inspect only
own data values. Graceful shutdown captures signal, exit, timer, Promise, and
synchronous diagnostic operations. Filesystem validation captures path,
number, decoder/encoder, typed-byte, reflection, and immutable-result
operations; filesystem effects are delegated to the isolated shared Worker,
so neither callback `node:fs` nor `node:fs/promises` is part of the
application-Realm contract.

Binary filesystem and HTTP operations use the target-neutral `Bytes` contract:
`readBytes`, `writeBytes`, `createBytes`, Bytes request bodies, and response
`.bytes()`. Node `Buffer` is confined to the isolated implementation and never
becomes a VelarScript type or API.

Database engines and database-model abstractions are not Node language
capabilities. Each application owns or installs its model contract and concrete
driver, including dialect behavior, isolation, queue and result budgets,
streaming backpressure, cancellation truthfulness, and raw escape hatches. The
server framework accepts application services but never acquires a database
dependency.

`velar/worker` resolves only entries declared in `velar.json`, validates each
request and response, snapshots caller-owned transferable data, and transfers
the snapshot's nested `Bytes`/fixed numeric buffers through a bounded cycle-safe
data-graph scan without detaching the caller's values. It provides single-worker
and bounded pool owners with per-call cancellation and timeout.
`velar/websocket` provides pull connections bounded by unread message count,
pending operations, and aggregate bytes, preserves queued messages through
normal EOF, and discards them on receive failure. `closeInfo()` waits for the
terminal handshake and returns `WebSocketClose {code, reason}`. The module also
provides a Node server;
`listen({http: app, ...})` accepts either a `ServeApp` or low-level handler and
serves the same typed HTTP contract as `velar/serve` on the upgrade port. Its
only external transport dependency is the pinned `ws` package; native socket
objects remain private.

`velar/terminal` supplies bounded program arguments, backpressure-aware stdout
and stderr writes, line input, interactive-terminal detection, and explicit
reader cleanup. It lets a CLI remain pure VelarScript without exposing
`process`, streams, readline events, or an unsafe JavaScript bridge. Closing the
terminal is final even before the first read, and queued or oversized input is
settled through `readLine` Promises rather than thrown from host event callbacks.
The line decoder and fd writes belong to an eagerly initialized isolated
Worker, but its stdin stream is created only by the first `readLine`; importing
the module or writing output cannot make an otherwise idle CLI wait for input.
On POSIX, the application-facing proxy duplicates stdin before dependencies
run; `close()` either seals the never-opened reader or destroys the Worker's
stream, waits for its closed handshake, and then closes that owned duplicate in
the creating Realm. Idle imports and completed reads do not retain the CLI
process.
`velar/host` bounds both cleanup registration and the total graceful-shutdown
window, so a stuck callback cannot indefinitely defeat SIGINT or SIGTERM.

The compiler entry is independently reusable:

```ts
import { compile } from "@velarscript/compiler"
import { velarNodeCompilerExtension } from "@velarscript/node/compiler"

const result = compile(source, { extensions: [velarNodeCompilerExtension] })
```

`@velarscript/cli` composes this extension for local programs. Browser
frameworks remain separate and reject Node-only modules before bundling.
