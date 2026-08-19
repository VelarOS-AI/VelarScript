# @velarscript/node

The official Node.js runtime boundary for VelarScript. It owns the typed module
contracts and implementations for `velar/fs`, `velar/env`, `velar/host`,
`velar/serve`, `velar/path`, `velar/process`, `velar/terminal`,
`velar/sqlite`, `velar/worker`, and `velar/websocket`, plus the Node target of
`velar/http`.

The API exposes VelarScript contracts rather than Node objects. Filesystem
operations are bounded, process execution is shell-free and starts with a
secret-minimizing environment, and HTTP streaming keeps timeout and
cancellation active until the response body has finished. `secretHeader`
references an environment variable without placing its value in VelarScript
application state; creating a lazy request retains only its validated descriptor,
the official runtime resolves the current value at the first effect and sends it
only across the private host transport, and cross-origin redirects strip it.
`HttpError`, `HttpAbortError`, and `HttpTransportError` separately represent
non-2xx responses, owned cancel/deadline outcomes, and request/response network
transport failure. The transport phase is typed; retry and replay policy stays
with the provider or application.

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

The shared proxy eagerly completes one readiness handshake, caps pending
operations at 1,024, and is unreferenced while idle. A pending filesystem,
server, or HTTP operation and every active server or unread HTTP response retain
the process. Server and request
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

`velar/sqlite` owns a dedicated database Worker. It provides parameterized
`execute`, runtime-Type checked `one`/`all`, prepared statements, bounded queues
and results, `Bytes` BLOB values, and explicit transaction handles. Closing an
uncommitted transaction rolls it back. Synchronous `node:sqlite` work never runs
on the application thread.

`velar/worker` resolves only entries declared in `velar.json`, validates each
request and response, snapshots caller-owned transferable data, and transfers
the snapshot's nested `Bytes`/fixed numeric buffers through a bounded cycle-safe
data-graph scan without detaching the caller's values. It provides single-worker
and bounded pool owners with per-call cancellation and timeout.
`velar/websocket` provides pull connections bounded by both unread message count
and aggregate bytes, preserves queued messages through normal EOF, and discards
them on receive failure, plus a Node server; `listen({http: handler, ...})`
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
