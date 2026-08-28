# @velarscript/desktop

The optional single-project VelarScript Desktop framework. Application authors
write one ordinary Web-shaped VelarScript source graph; there is no public
renderer/main split, local server, port, Electron main process, or IPC API.

Desktop composes `@velarscript/web` with a least-privilege Node capability
worker and a thin system-WebView shell. It owns only the application host and
permission-scoped implementations of existing language capabilities:

- `velar/desktop`: platform, packaging state, application directories, and the
  native project-directory picker.
- `velar/window`: the window kinds `desktop.windows` declares, opened by kind
  and optional instance key. A `Window` is an owned resource whose release
  closes it; `watchState()` is a bounded pull stream of `moved`, `resized`,
  `focused`, `blurred` and `closed`.
- `velar/desktop` also carries the rest of the host surface: `openExternal`
  through a closed scheme allowlist, `displays()`, the `watchPower()`
  sleep/wake stream, the `watchDroppedFiles()` stream of real paths a drag
  gesture brought in, the read-only `permissionStatus()` probes, and
  `applyUpdate()`, which replaces this installed application with a downloaded
  archive of itself.
- `velar/service`: `connect(name)` opens an authenticated loopback channel to a
  process `desktop.services` declares, and `watchServices()` is a bounded pull
  stream of `starting`, `ready`, `restarting`, `failed` and `stopped`, each event
  carrying a `detail` that is the failing service's own last words and is null
  for every state that did not fail. A `ServiceConnection` is an owned resource
  with a backpressured send and a bounded pull receive; it carries text.
- `velar/notification`: `requestPermission`, `show`, and a bounded pull stream of
  activations. The manifest declares whether the application may notify; the
  operating system separately answers whether it may right now.
- `velar/secure-storage`: named credential slots held as macOS keychain generic
  passwords under the application's bundle identifier. A stored value never
  enters a log line, a diagnostic, or a test seam.
- `velar/fs`, `velar/path`, `velar/process`, `velar/http`, and `velar/env`: the
  same checked contracts as Node, restricted by the Desktop manifest.
- `velar/desktop-test`: deterministic platform and window-kind selection, a fake
  window registry, notification centre, keychain, power source, drop source and
  permission probes, a served fake service that answers and pushes over a real
  loopback socket, and bounded fixture filesystem helpers for official browser
  tests.

Language servers, project transactions, product task runners, terminals,
editors, and other Workbench features are not Desktop language capabilities.
Products or independently versioned integrations own those features and may
compose the public filesystem/process/network contracts where appropriate.

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "outDir": "dist/renderer",
  "publicDir": "public",
  "extensions": ["@velarscript/desktop"],
  "desktop": {
    "productName": "Example",
    "identifier": "com.example.app",
    "windows": {
      "main": { "width": 1280, "height": 820 },
      "note-preview": { "style": "panel", "frame": false, "aspectRatio": 1.6, "width": 512, "height": 320 }
    },
    "services": {
      "core": { "payload": "dist/service-core", "entry": "main.js", "restart": "always" }
    },
    "permissions": {
      "files": ["project", "dropped"],
      "processes": ["git"],
      "network": ["https://api.example.com"],
      "environment": [],
      "secrets": [],
      "links": ["https", "mailto"],
      "notifications": true,
      "secureStorage": ["CLOUD_SESSION"]
    }
  }
}
```

`desktop.windows` declares every window kind the application may open. `main` is
required and opens at launch; an undeclared kind is refused at the `openWindow`
call and again by the host. Closing `main` closes every other window and quits,
closing the last window quits, and a packaged application is a single instance —
none of the three is configurable. Each window is its own document generation
with its own capability ownership; windows share no JavaScript context.

## Service processes

`desktop.services` declares the long-running processes the product owns. The
language starts them, supervises them, converges them when the application
quits, and hands the renderer one authenticated channel to each; it does not
sandbox them. A service does not go through the capability worker, and declaring
one in the manifest makes it auditable rather than confined — its policy, its
permissions and its code are the product's.

A service name follows a window kind's rule — lowercase words joined by single
hyphens — and at most eight may be declared. `payload` is a project directory
copied whole into `Contents/Resources/services/<name>/` by `velar package`;
`entry` is a JavaScript file inside it. The only runtime is the Node.js
executable the bundle already carries: no other executable is declarable, because
a second supply surface for long-running processes is exactly what this model
exists to avoid. A short-lived process is `velar/process` with a `processes`
grant instead. `restart` is `always` — an exponential backoff from one second to
a thirty-second cap, with five consecutive failures reaching the terminal
`failed` — or `never`.

Services start before the renderer loads and are not awaited. On quit the host
sends SIGTERM and, thirty seconds later, SIGKILL; a service's exit status never
becomes the application's.

### Why a service failed

A `failed` or `restarting` event carries a `detail`: up to the last 4 KiB of what
that service wrote to its own standard error, truncated on a character boundary
and stripped of every control character but the newline. It is diagnostic text
for a person to read — a stack trace, a bind failure, the line a service printed
before it gave up — and nothing in the language parses it or matches on it. When
the service produced no output at all, the host says what it knows instead: that
the process could not be started, that it exited with a status, that it never
answered the handshake, or that it refused the token. `detail` is null for
`starting`, `ready` and `stopped`, because none of those states failed at
anything.

Four kilobytes is a crash, not a log. The log is a file: the host writes every
service's standard output and standard error, whole and interleaved in the order
they arrived, to

```sh
~/Library/Application Support/<identifier>/service-logs/<name>.log
```

which grows to one megabyte, rotates once to `<name>.log.1`, and keeps nothing
older. It sits beside the application's own `app-data` scope rather than inside
it: the log is the host's record of what the product's process said, and an
application that could rewrite it is an application whose crash report proves
nothing. Under `velar dev` there is no such file — a service's streams are the
terminal's, where a developer is already looking.

### The environment a service is started in

A service inherits the host process's environment and finds three more variables
in it, the same three under `velar dev` as in a packaged application:

```sh
VELAR_SERVICE_ENDPOINT=127.0.0.1:<port>
VELAR_SERVICE_TOKEN=<32 hexadecimal characters>
VELAR_SERVICE_APP_DATA=<the directory appDataDirectory() answers>
```

The first two are this start's channel. The third is the application's own
data directory — the exact path `velar/desktop.appDataDirectory()` returns in
the renderer — and it exists by the time the service reads it. It is standard
rather than something a manifest declares because it is the one thing a service
needs and cannot be told at build time: it is the application's identity
resolved against this machine, so a payload that carried it would carry a guess,
and a service that derived it would be keeping a second copy of the host's rule
where nothing checks it against the first. A product's own configuration is not
this: a value that is the same on every machine belongs in the payload, and
`desktop.services` has no `env`.

There is no fourth. The channel a service is given is the way a renderer talks
to it, so a value the renderer knows is a message rather than a variable.

### The handshake

The service must run a WebSocket server on the endpoint it was given. Every
connection the host opens — the readiness probe and each `connect()` — begins
with exactly two frames, and this is the whole protocol the language imposes:

```json
{"velar":"service-hello","token":"<the value of VELAR_SERVICE_TOKEN>"}
```

```json
{"velar":"service-ready"}
```

The host sends the first as a text frame immediately after the socket opens and
waits up to 30 seconds for the second; a service should apply the same 30-second
bound to a connection that has not sent a hello. A connection whose token is not
the one the host issued must be closed without an answer, with WebSocket close
code **1008**: the endpoint is loopback and every process on the machine can
reach loopback, so the token is the whole of this channel's authentication. The
code is part of the contract rather than a courtesy — a dropped connection is
also what a service that has not finished binding its port looks like, and the
host retries that one for thirty seconds while reporting the refusal at once.
After the two frames the channel carries whatever the product decided it
carries; the language reads none of it.

The readiness probe closes its connection as soon as it has the answer, and it
is indistinguishable from an application `connect()` — the same hello, the same
token, the same close — so a service will see connections open and close that no
window asked for and must not treat a closed authenticated connection as an
application-level event. A service that never answers within the deadline is a
start that failed, and the declared `restart` policy decides what happens next.

`velar dev` runs the same services from `<project>/<payload>/<entry>` on the
system Node and converges them when the dev server closes. It performs the same
handshake and reports the result, and it does not watch or rebuild a service:
that is the product's own toolchain.

`examples/tour/desktop/service-notes-index/main.js` is a complete implementation
of the service side in dependency-free JavaScript, and is the shortest answer to
"what do I actually have to write".

### Multiplexing over one connection

A `ServiceConnection` is one bounded pull: `next()` admits a single outstanding
read, so two calls in flight at once cannot both hold it. The shape that answers
this is a reader and a waiter, and `velar/task`'s `channel(Type, capacity)` is
the waiter — it is a many-producer, single-consumer queue whose `next()` is the
wait, so a caller that is owed an answer parks on a channel of its own instead
of asking again. One reader owns the connection's `next()` and forwards each
answer to the request that is waiting for it; nothing polls, and nothing sleeps
between attempts.

```velar fragment
import {ServiceConnection, connect} from "velar/service"
import {Cancellation, Channel, channel, task} from "velar/task"

// The product's protocol, not the language's: the channel carries whatever the
// product decided it carries, and the correlation key is the product's too.
type Reply:
    id: string
    body: string

// One waiter per request in flight. Each channel has exactly one producer — the
// reader below — and exactly one consumer, the call waiting for its own answer,
// which is the shape a channel is for.
const waiting: Map<string, Channel<Reply>> = Map()

// The reader is the only thing that pulls the connection, which is how the
// single-outstanding-read rule is kept without anyone having to think about it.
// It decides nothing: it matches an answer to the request waiting for it.
async def readReplies(link: ServiceConnection, cancellation: Cancellation):
    while true:
        const text = await link.next()
        if text == null:
            // The connection ended, so every waiter's answer is that there is
            // none: a closed channel drains and then answers null.
            for waiter in waiting.values():
                waiter.close()
            waiting.clear()
            return null
        const reply = Reply.parse(Json.parse(text))
        waiting.get(reply.id)?.trySend(reply)
    return null

async def ask(link: ServiceConnection, id: string, request: string) -> Reply?:
    const answers = channel(Reply, capacity=1)
    waiting.set(id, answers)
    await link.send(request)
    const answer = await answers.next()
    waiting.remove(id)
    return answer

export async def count() -> string:
    using link = await connect("core")
    using reader = task((cancellation) => readReplies(link, cancellation))
    return (await ask(link, "1", "count"))?.body ?? ""
```

### Testing a service, including what it pushes

`velar/desktop-test` serves a fake in the test process, and the fake is not a
stub: `serveService(name, handler)` starts a real loopback WebSocket server,
performs the real handshake, checks the real token, and pumps the application's
channel through it, so a message leaves the page, crosses a socket, reaches the
handler, and comes back. `setServiceState` publishes the transitions a
supervisor would, `serviceRejectsWrongToken` asks the service side to refuse an
issued-by-nobody token, and `stopService` releases it.

A handler can only answer what was asked, and that is half of what a service
does. `pushService(name, message)` is the other half — the frame nobody asked
for, which is what every streaming downlink is made of. It reaches every open
`connect()` to that service, arriving at an ordinary `next()`, because on the
wire a pushed frame and a reply are the same thing and only the product's
protocol distinguishes them. It answers **how many connections took it**, so a
push written before the application connected reports `0` rather than leaving a
`next()` that never settles for a reader to puzzle over. Frames queue in push
order for a connection that has no pull outstanding, exactly as a reply does.

```velar fragment
test "a stream frame the service was not asked for reaches the page":
    await serveService("core", async (request: string) => request)
    await browser.open()
    await browser.click("[data-listen]")
    await browser.waitForText("[data-stream]", "listening")

    expect(await pushService("core", "first token")).toBe(1)
    expect(await pushService("core", "second token")).toBe(1)
    await browser.waitForText("[data-stream]", "first token|second token")
    await stopService("core")
```

The reader is an ordinary `Task`, so `using` cancels and joins it when the scope
that opened the connection ends; a shell that keeps one connection for the
application's lifetime keeps the task the same way it keeps the connection.

The permission manifest is the authority. File access is limited to the
`app-data` and `project` scopes, plus the special `dropped` root that authorizes
reading the files a user's drag gesture brings in and learning their real paths.
Process grants are exact executable names and do not imply shell parsing or an
operating-system sandbox. Network grants are exact HTTPS origins (or loopback
HTTP origins) and govern what the renderer may reach; `links` is a separate
closed set of `http`, `https` and `mailto` and governs only what `openExternal`
may hand to the system. Readable environment values, opaque HTTP secrets, and
named credential slots are three separate allowlists, and `secrets` and
`secureStorage` may not share a name. `notifications` is a single declaration of
intent; the operating system still asks the user.

Every capability fails where it is *called*, with the manifest line that would
grant it named in the error — never at the import, and never silently. The
native host repeats each check on its own side.

`selectProjectDirectory()` opens the native directory chooser. A successful
selection atomically replaces the project grant used by subsequent relative
filesystem, path, and default process-working-directory operations;
`selectedProjectDirectory()` returns only an explicitly selected or restored
grant. The current effective root remains available through
`projectDirectory()`.

Each loaded document owns one private bridge generation. The renderer captures
the bridge and host operations at module initialization. Native code translates
page-local request IDs to host-global IDs, retires old generations on
navigation, bounds pending request and response memory, and reaps owned process
groups on retirement or failure. Filesystem work already issued to the
operating system may settle, but a retired response cannot reach a replacement
document.

The capability worker preserves the public Node contracts: exclusive
`createText`, optimistic `replaceTextIfMatches`, bounded pull-based file
watching, incremental process output with consume-before-wait ownership, and
streamed HTTP bodies with distinct status, abort, and transport failures.
Large request and response values use the bounded chunk transport rather than
depending on WebView message limits.

The macOS package uses WKWebView and is self-contained: it carries one bare
Node.js executable at `Contents/MacOS/node`, and the end user installs nothing.
`velar package` contains only the native host, the capability worker, renderer,
icon, metadata, any declared service payloads, and that runtime. The manifest reports each component and the
complete tree hash; it does not bundle the CLI, compiler, browser automation,
language server, build engine, project kernel, or PTY helper.

The runtime version belongs to the toolchain generation, not the project. One
version and one official `SHASUMS256` digest are pinned per generation; the first
`velar package` downloads the archive from `nodejs.org`, verifies it, and caches
the executable per version, platform and architecture, so later builds need no
network. An entry whose bytes no longer match its receipt is treated as absent.
`desktop.build.sizeBudgetBytes` governs the application's own components; the
runtime is measured separately against a fixed toolchain-owned ceiling, because
no project change removes or shrinks it.

The runtime lives beside the executable rather than in `Contents/Resources`,
where a Mach-O is sealed as a plain resource and never signed — and an unsigned
Mach-O cannot execute on arm64. The bundle is signed inside-out: the runtime
first, with the language's own minimal entitlements file whose single key is
`com.apple.security.cs.allow-jit` (without it the hardened runtime denies V8 its
code range and the worker dies on the first capability call), then the host, then
the bundle. `desktop.build.signing` supplies the product's identity, its own
entitlements, and a `notarytool` keychain-profile name; no credential enters the
build manifest or a log line, and an absent identity means ad-hoc, which is what
lets a local build run.

The packaged host's `--headless-smoke` is the packaging acceptance: it starts,
launches the capability worker on the runtime it resolved, completes one real
capability round-trip, reports whether that runtime was the bundled one, and
exits 0. `--verify-bundle` is the static bundle check beside it; it cannot see a
runtime that resolves but cannot execute JavaScript, which is why it no longer
carries the word smoke. `--headless` runs the application with no visible
windows and no ending. Every report these flags print is serialized JSON, one
object on one line.

`applyUpdate(archivePath)` replaces this installed application with an archive
and relaunches. The host verifies that the `.app` inside carries this bundle
identifier and this signing Team ID — nested code included — before touching
anything on disk, and every failure leaves the current install exactly as it was.
An ad-hoc-signed development install has no Team ID and is refused by name:
accepting "no team matches no team" would accept any archive. Downloading,
scheduling, channels, feeds and rollback policy are the product's.

```sh
velar check .
velar test .
velar test . --browser=all
velar build .
velar package .
```

Browser tests may use `velar/desktop-test` to select the simulated platform and
prepare bounded app-data/project files through the actual page bridge. Native
filesystem, process, network, ownership, and crash-reaping behavior has a
separate worker integration suite.
