# The VelarScript Desktop AI skill brief

Load this after `velar skill core` and `velar skill web`. Desktop composes the
Web language and owns a separate least-privilege application target. This file
contains only that target contract; `velar skill desktop` prints it verbatim.

## Ownership

Activate Desktop explicitly and declare the smallest required authority:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
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

Desktop owns `velar/desktop`, `velar/window`, `velar/service`,
`velar/notification`, `velar/secure-storage`, `velar/desktop-test`, and permission-scoped
implementations of `velar/fs`, `velar/path`, `velar/process`, `velar/http`, and
`velar/env`. It composes Web components, JSX, Look, state, resources, actions,
and browser tests. It does not expose a user main process, renderer project,
local server, port, or general IPC surface.

The manifest is the authority. Never broaden a grant merely to silence a
failure. File roots, executable identities, network origins, readable
environment names, opaque secret names, link schemes, and credential slot names
are finite allowlists, and `notifications` is a single declaration of intent. A
capability the manifest never declared fails where it is *called*, naming the
line that would grant it — never at the import, and never silently.

## Windows

`desktop.windows` declares every window kind the application may open, keyed by
kind. `main` is required and opens at launch; a kind that is not declared is
refused at the `openWindow` call, by name. Kind names are lowercase words joined
by single hyphens, at most 32 per application. Each kind's fields are closed
vocabularies with defaults: `title` (the product name), `width`/`height`/
`minWidth`/`minHeight`, `titleBar` (`standard` | `hidden-inset`), `material`
(`none` | `sidebar`), `style` (`window` | `panel`), `frame`, `level` (`normal` |
`floating`), `visibleOnAllWorkspaces`, `aspectRatio`, and `resizable`.

Every window loads the same application at the route given to `openWindow`, so
one source graph renders every window; `currentWindowKind()` is how a component
decides which one it is in.

```velar fragment
import {WindowState, currentWindowKind, openWindow, windows} from "velar/window"

async def previewNote(note: string) -> number:
    // Same kind and key focuses the window that already exists.
    using preview = await openWindow("note-preview", {route: f"/preview?note={note}", key: f"note-{note}"})
    const bounds = await preview.bounds()
    await preview.setBounds({x: bounds.x, y: bounds.y, width: 512, height: 320})
    using states = await preview.watchState()
    let seen = 0
    async for state in states:
        seen += 1
        if state == WindowState.closed: break
    return seen + (await windows()).size + currentWindowKind().size
```

A `Window` is an owned resource: `using` closes it, and the release is
idempotent. `currentWindow()` hands back this window rather than one you opened,
so hold it in a `const`. `watchState()` is a bounded pull stream — `moved`,
`resized`, `focused`, `blurred`, `closed` — that drains after `closed`; a slow
consumer coalesces repeated `moved`/`resized` instead of growing a queue.

Two host rules have no knob: closing `main` closes every other window and quits,
and closing the last window quits. Do not build an application that depends on
outliving them, and do not try to share state between windows through the
language — windows do not share a JavaScript context.

## Service processes

`desktop.services` declares the long-running processes the *product* owns. The
language does four things and no more: it starts them, supervises them,
converges them when the application quits, and hands the renderer one
authenticated loopback channel to each. It does not sandbox them — a service
does not go through the capability worker, and declaring one makes it auditable
rather than confined. The service itself is not a language capability: writing
one is the product's job, exactly as the exclusion list at the end of this brief
says.

A service name follows the window kind's rule and at most eight may be declared.
`payload` is a project directory copied whole into
`Contents/Resources/services/<name>/` at package time; `entry` is a JavaScript
file inside it, run by the Node.js runtime the bundle carries. No other
executable is declarable: a short-lived process is `velar/process` with a
`processes` grant, and that is a different model on purpose. `restart` is
`always` (exponential backoff from 1s to a 30s cap, and five consecutive
failures reach the terminal `failed`) or `never`.

The host gives each service a loopback endpoint and a 128-bit token in
`VELAR_SERVICE_ENDPOINT` and `VELAR_SERVICE_TOKEN`, and the service must run a
WebSocket server there. Readiness is the handshake: the host sends
`{"velar":"service-hello","token":"…"}` and the service answers
`{"velar":"service-ready"}`. A connection that opens with any other token must
be refused — a loopback port is reachable by every process on the machine, so the
token is the whole of the channel's authentication. Both sides wait 30 seconds.

```velar fragment
import {ServiceState, connect, watchServices} from "velar/service"

async def indexNote(id: string) -> string:
    using channel = await connect("core")
    await channel.send(f"put {id}")
    return (await channel.next()) ?? ""

async def coreState() -> ServiceState:
    using states = await watchServices()
    const event = await states.next()
    return event?.state ?? ServiceState.stopped
```

Application code never holds the token: the host spends it itself on the first
frame of every connection. An undeclared name fails at the `connect` call, and a
service that is not `ready` is refused by state — services start before the
renderer loads and are not awaited, so read `watchServices()` rather than
assuming one is up. `ServiceConnection` keeps the `velar/websocket` client's
discipline: a backpressured `send`, a bounded pull `next`, and a release `using`
performs. It carries text.

`velar dev` runs the same services from `<project>/<payload>/<entry>` on the
system Node and converges them when the dev server closes. It does not watch or
rebuild them — a service's build is the product's own toolchain.

## Notifications

`desktop.permissions.notifications: true` is the application's declaration that
it may notify at all; without it `requestPermission`, `show`, and `activations`
each fail at the call and name that line. The operating system's own answer is a
second, different gate — ask for it with `requestPermission()`, and expect
`granted`, `denied`, or `undetermined`. `show` on an unauthorized application
fails; it never quietly delivers nothing.

```velar fragment
import {NotificationPermission, activations, requestPermission, show} from "velar/notification"

async def announce(packages: number) -> string:
    if await requestPermission() != NotificationPermission.granted: return "not notified"
    // A tag is the notification's identity: a second notification carrying it
    // replaces the first, and an activation reports it back.
    await show({title: "Build finished", body: f"{packages} packages", tag: "build"})
    using clicks = await activations()
    async for click in clicks: return click.tag ?? "untagged"
    return "no activation"
```

`title` is at most 256 characters, `body` 1024, `tag` 128. `activations()` is a
bounded pull stream of `{tag: string?}`; two clicks on one notification are one
activation, and the host brings the application forward with it, opening `main`
when no window is left.

## Secure storage

`secureStorage` is a finite allowlist of credential slot names, spelled the way
`secrets` names are, and one name may appear in only one of the two lists. They
are different authorities: a `secrets` entry is an opaque value the environment
injects, while a `secureStorage` entry is a slot the application itself writes
and reads — a macOS keychain generic password under the application's bundle
identifier.

```velar fragment
import {get, remove, set} from "velar/secure-storage"

async def rotate(token: string) -> bool:
    await set("CLOUD_SESSION", token)      // at most 8 KiB
    const stored = await get("CLOUD_SESSION")
    await remove("CLOUD_SESSION")          // removing what is absent is not an error
    await remove("CLOUD_SESSION")
    return stored != null
```

A name outside the allowlist fails at the call and lists the declared names.
Never render, log, or serialize a stored value; report whether a credential is
present, not what it is.

## Links, displays, power, dropped files, and probes

```velar fragment
import {PowerState, SystemPermission, displays, openExternal, permissionStatus, watchDroppedFiles, watchPower} from "velar/desktop"

async def sleepAware() -> string:
    await openExternal("https://example.com/guide")   // scheme must be in `links`
    const attached = await displays()
    const ready = await permissionStatus(SystemPermission.screenRecording)
    using states = await watchPower()
    using drops = await watchDroppedFiles()            // needs files: ["dropped"]
    async for state in states:
        if state == PowerState.suspended: break
    async for batch in drops: return f"{batch.paths.size}:{attached.size}:{ready}"
    return "none"
```

`links` is a closed set of `http`, `https`, and `mailto`; any other scheme is
refused at the call and again by the host. `displays()` answers the same
`Display` record a window's own `display()` does. `watchPower()` carries
transitions only — a machine already awake publishes nothing on waking.
`watchDroppedFiles()` needs the `dropped` file root and reports the real paths of
the files a user's drag gesture brought in, in gesture order; the page still gets
its ordinary DOM `drop` event, and the two are the same gesture.
`permissionStatus` only reads. There is no request function: asking the user for
a system permission belongs to the product flow that consumes the answer.

## Capability model

All privileged operations are asynchronous checked calls. Import the official
modules; do not use Node globals, an ambient bridge, a shell command, or
`import js unsafe` to recreate an available capability. Use `using` for owned
handles, consume pull streams to completion, and close work when a user action
retires it early.

Project selection may replace the current grant. Do not cache an old project
path or keep project-owned work alive across replacement. Secrets remain
opaque until a permitted transport resolves them; never print, serialize, or
persist them.

Language servers, semantic project transactions, product task runners,
terminals, editors, database engines, deployment providers, and other product
features are not Desktop language capabilities. Put them in the product that
owns their policy or in an independently versioned integration built on the
public contracts.

## Application shape

Keep the entry identical to a Web application:

```velar fragment
import {App} from "./app.vel"

mount(<App />, "#app")
```

Put target-specific calls in narrow service modules so UI components consume
checked application data instead of transport details. Use
`velar/desktop-test` only from official browser-test modules; plain unit tests
should cover pure policy and conversion logic without platform authority. Its
fake host answers every module above for the page and lets a browser test
produce the host events a real system would. Two of its choices are made before
the first `browser.open()` and sealed by it — `setPlatform` and `setWindowKind`
— and the rest are events inside a running page: `openWindows`, `focusWindow`,
`moveWindow`, `closeWindow`, `setNotificationPermission`, `shownNotifications`,
`activateNotification`, `secureStorageNames`, `publishPower`, `dropFiles`,
`setSystemPermission`, and `openedLinks`. `secureStorageNames` reports the names
the fake keychain holds and never the values: a test seam that handed a
credential back would be the exception that ends that rule.

## Updating the installed application

```velar fragment
import {applyUpdate} from "velar/desktop"

async def install(archivePath: string) -> string:
    try:
        await applyUpdate(archivePath)
        return "replaced; relaunching"
    catch error:
        return f"refused: {error.message}"
```

`applyUpdate` is the mechanism and nothing else. There is no feed, no channel,
no version check, no automatic download, and no delta format — deciding when to
look, where to look, and what to tell the user is the product's, and so is
downloading the archive with the capabilities the application already has.

The host expands the archive elsewhere, requires the application inside it to
carry this application's bundle identifier and this application's signing Team
ID, and only then replaces the installed bundle atomically and relaunches. Every
failure leaves the current install untouched. Do not write a fallback that
retries with a different archive or works around a refusal: a refusal means the
archive is not this application.

A development build is ad-hoc-signed and therefore has **no** Team ID, so
`applyUpdate` refuses it by name. That is not a bug to route around — an update
path where no team matches no team is an update path that accepts every archive
on the machine. Test the flow with `velar/desktop-test`'s `setSigningTeam`,
`stageUpdate` and `appliedUpdates`, and expect the real call to work only in a
Developer ID signed install.

## Build and finish

`velar dev` previews the renderer, `velar build` creates verified renderer
output, and `velar package` creates the native application containing the
system-WebView host and capability worker. It does not embed compiler or
Workbench tooling.

`velar package` output is self-contained: it carries one bare Node.js executable
at `Contents/MacOS/node`, whose version belongs to the toolchain generation
rather than the project. Do not add a manifest field for it, do not check for
Node at install time, and do not tell a user to install one. The first package on
a machine downloads and verifies the official archive; later ones use the
verified cache and need no network.

`desktop.build.sizeBudgetBytes` measures the application's own components; the
runtime is reported separately and has its own toolchain-owned ceiling. Do not
raise the budget to make room for it.

Signing always happens — ad-hoc when `desktop.build.signing.identity` is absent,
so a local build runs on arm64. Set `identity`, `entitlements` and
`notarization.keychainProfile` when the product distributes. Never put an Apple
ID, a password, or an App Store Connect key in `velar.json`: the keychain profile
name is the only credential-shaped thing that belongs there, and it is a
reference the local keychain resolves.

Run `velar format`, `velar check`, `velar test`, the Desktop browser tests,
`velar build`, and the platform packaging gate, whose acceptance is the packaged
host's `--headless-smoke` (host up, capability worker up on the bundled runtime,
one real capability round-trip, every declared service started and through its
authenticated handshake to `ready`, converged, exit 0). `--verify-bundle` is the
static bundle check beside it and is not an acceptance. Runnable target examples live
in `examples/tour/desktop/`; diagnostics and checked manifest vocabulary
outrank this brief if they disagree.
