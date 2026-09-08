# VelarScript Desktop API

Status: active clean-break design
Surface: `desktop@0.10`, published by `@velarscript/desktop`

This is the reference for the six modules the Desktop target owns:
`velar/desktop`, `velar/window`, `velar/service`, `velar/notification`,
`velar/secure-storage`, and `velar/desktop-test`. Each section below lists every
name that module publishes, the grant in `velar.json` its calls require, the
failures it raises, and one compiled example.

The rest of a Desktop application is documented where it is owned.
[`web-api.md`](web-api.md) is the whole renderer vocabulary — components, JSX,
reactivity, Look, resources, actions, `velar/web-test` — because Desktop
composes `@velarscript/web` unchanged. [`standard-library.md`](standard-library.md)
is Core plus the permission-scoped `velar/fs`, `velar/path`, `velar/process`,
`velar/http`, and `velar/env` a Desktop project shares with Node.
[`ai-skill-desktop.md`](ai-skill-desktop.md) is the same target contract written
as a brief for a model; this document is written for a person with the
repository open.

## What a Desktop project is

One VelarScript project behind one system WebView. There is no renderer/main
split, no local server, no port, and no general IPC surface: the module that
declares a component may call the host directly through the capabilities its
manifest grants. `velar create --template desktop`
writes that project — a `velar.json` with `"extensions": ["@velarscript/desktop"]`
and a `desktop` block, a Web-shaped `src/main.vel` that ends in
`mount(<App />, "#app")`, a `.test.vel` unit test, and a `.browser.test.vel`
browser test.

The **renderer** is the source graph you write: Web components rendered by the
system WebView, one document generation per window, no shared JavaScript context
between windows. Checked host requests go to their capability owner: the native
shell owns windows and system integration, while a least-privilege **Node
capability worker** handles scoped filesystem, process, network, and environment
operations. The bundle carries the worker's Node.js executable. `velar package`
produces the renderer, worker, and native shell;
[`packages/desktop/README.md`](../packages/desktop/README.md) documents the
packaging, signing, and service-supervision contracts around them.

The `desktop` manifest block is the whole declaration of authority:

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
      "note-preview": { "style": "panel", "frame": false, "width": 512, "height": 320 }
    },
    "services": {
      "core": { "payload": "dist/service-core", "entry": "main.js", "restart": "always" }
    },
    "permissions": {
      "files": ["project", "app-data", "dropped"],
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

### Which import requires which declaration

Seven modules are refused at project validation when the manifest grants them
nothing at all, because a module whose every export would fail is a manifest
mistake rather than a program to run. The check reads the project's imports and
reports one failure per module:

| Import | Required declaration | Reported as |
| --- | --- | --- |
| `velar/fs` | `desktop.permissions.files` is non-empty | `Desktop source imports 'velar/fs' but desktop.permissions.files grants no file root` |
| `velar/process` | `desktop.permissions.processes` is non-empty | `… but desktop.permissions.processes grants no executable` |
| `velar/http` | `desktop.permissions.network` is non-empty | `… but desktop.permissions.network grants no origin` |
| `velar/env` | `desktop.permissions.environment` is non-empty | `… but desktop.permissions.environment grants no variable` |
| `velar/notification` | `desktop.permissions.notifications` is `true` | `… but desktop.permissions.notifications is not true` |
| `velar/secure-storage` | `desktop.permissions.secureStorage` is non-empty | `… but desktop.permissions.secureStorage grants no name` |
| `velar/service` | `desktop.services` declares a service | `… but desktop.services declares no service` |

`velar/desktop`, `velar/window`, and `velar/desktop-test` have no import-level
requirement. Everything else is checked at the call: an individual capability
the manifest *does* declare and the author reaches wrongly — an undeclared
window kind, an ungranted link scheme, a credential slot outside the allowlist —
fails where it is used, naming the manifest field that would grant it. Never
broaden a grant to silence a failure.

### Errors these modules raise

None of the six declares an error class. Argument validation, capability
refusals, and host failures use ordinary `Error`, `TypeError`, or `RangeError`.
Grant refusals name the relevant manifest field; host failures may instead need
an operating-system permission, an available service, or another operational
recovery. Display error messages rather than using their text as a protocol.
Use the permission enums and service-state events for state-dependent behavior.
The permission-scoped
`velar/fs` and `velar/http` a Desktop project also uses keep their own classes
(`FileNotFoundError`, `PermissionError`, and the rest); those are documented in
[`standard-library.md`](standard-library.md).

### Owned handles and pull streams

Two shapes recur in every section. An **owned handle** — `Window`,
`ServiceConnection` — is released by `close()`, so `using` performs the release
and a second release is not an error. An **event source** is a bounded pull
stream with `next()` and `close()` and no callback registry: `next()` answers
`null` when the stream has drained, only one pull may be active at a time, and a
queues stay bounded. Their overflow policy belongs to the particular stream:
window state can coalesce transitions, while a service channel can reject an
overflow. `async for` consumes these pull streams.

## `velar/desktop`

The host itself: which platform this is, where the application's directories
are, what screens are attached, and the system event sources that belong to no
other module.

| Export | Signature | Meaning |
| --- | --- | --- |
| `DesktopPlatform` | enum `macos`, `test` | The host this build is running on. `test` is the deterministic browser-test host; `macos` is the native host that ships today. |
| `Display` | `{id, bounds, workArea, scale, primary}` | One attached screen: two `{x, y, width, height}` rectangles, a device scale, and whether it is the primary display. |
| `DroppedFiles` | `{paths: List<string>}` | The real paths one drag gesture brought in, in gesture order. |
| `DroppedFilesStream` | `next() -> Promise<DroppedFiles?>`, `close() -> Promise<null>` | The pull stream `watchDroppedFiles()` opens. |
| `PermissionStatus` | enum `granted`, `denied`, `undetermined` | What the operating system currently answers for a system permission. |
| `PowerState` | enum `suspended`, `resumed` | A sleep/wake transition. |
| `PowerStream` | `next() -> Promise<PowerState?>`, `close() -> Promise<null>` | The pull stream `watchPower()` opens. |
| `SystemPermission` | enum `screenRecording`, `accessibility`, `microphone` | The read-only system probes `permissionStatus` answers. |
| `platform()` | `-> DesktopPlatform` | Synchronous. Which host answers this application's calls. |
| `packaged()` | `-> bool` | Synchronous. Whether this build is running from a packaged application rather than from `velar dev`. |
| `homeDirectory()` | `-> Promise<string>` | The current user's home directory, as one validated absolute path. |
| `appDataDirectory()` | `-> Promise<string>` | This application's own data directory, created if absent. The same path the host gives a service in `VELAR_SERVICE_APP_DATA`. |
| `projectDirectory()` | `-> Promise<string>` | The project root the `project` file grant is scoped to. |
| `selectedProjectDirectory()` | `-> Promise<string?>` | Reads what the user has already chosen; `null` when nothing is chosen. A query, not a dialog. |
| `selectProjectDirectory()` | `-> Promise<string?>` | Opens the native picker; `null` when the user cancels. Selection may replace the current grant. |
| `openExternal(url)` | `-> Promise<null>` | Hands one absolute URL to the system default handler. |
| `applyUpdate(archivePath)` | `-> Promise<null>` | Replaces this installed application with a downloaded archive of itself and relaunches. |
| `displays()` | `-> Promise<List<Display>>` | Every attached screen, at most 64. |
| `permissionStatus(kind)` | `-> Promise<PermissionStatus>` | Reads one system permission. There is no request function. |
| `watchPower()` | `-> Promise<PowerStream>` | Opens the sleep/wake stream. |
| `watchDroppedFiles()` | `-> Promise<DroppedFilesStream>` | Opens the drag-gesture path stream. |

**Grants.** The module needs none to be imported. `openExternal` needs the URL's
scheme in `desktop.permissions.links`, a closed set of `http`, `https`, and
`mailto`; any other scheme is refused at the call, naming the granted schemes,
and refused again by the host. `watchDroppedFiles` needs the `dropped` root in
`desktop.permissions.files` — the gesture is the grant, and it lasts for the
session — and the refusal names that field. Everything else here is ungated.

**Bounds and semantics.** Every path this module returns is absolute, NUL-free,
and at most 4,096 code units; a host answer outside that is a `TypeError` rather
than a value. `Display.bounds` and `Display.workArea` are the same structural
record `velar/window` publishes as `WindowBounds`, so a window's own `display()`
and `displays()` answer one shape rather than two that look alike.
`watchPower()` carries transitions only: a machine that is already awake
publishes nothing on waking. `watchDroppedFiles()` reports the real paths behind
a drag gesture in gesture order and caps a batch at 4,096 paths and 2,097,152
UTF-16 code units of path text; the page
still receives its ordinary DOM `drop` event, and the two are the same gesture.
`applyUpdate` is the mechanism and nothing else — no feed, no channel, no
version check, no download, no delta format. The host expands the archive
elsewhere, requires the application inside it to carry this application's bundle
identifier and signing Team ID, and only then replaces the install atomically.
Every failure leaves the current install untouched, and a development build is
ad-hoc-signed, so it has no Team ID and `applyUpdate` refuses it by name.

```velar
import {DesktopPlatform, PermissionStatus, PowerState, SystemPermission, appDataDirectory, applyUpdate, displays, homeDirectory, openExternal, packaged, permissionStatus, platform, projectDirectory, selectProjectDirectory, selectedProjectDirectory, watchDroppedFiles, watchPower} from "velar/desktop"

export def hostSummary() -> string:
    if platform() == DesktopPlatform.macos: return f"macos|{packaged()}"
    return f"test|{packaged()}"

export async def roots() -> string:
    const home = await homeDirectory()
    const data = await appDataDirectory()
    const project = await selectedProjectDirectory() ?? await projectDirectory()
    return f"{home}|{data}|{project}"

export async def chooseProject() -> string: return await selectProjectDirectory() ?? "the picker was cancelled"

export async def readyToRecord() -> bool:
    return await permissionStatus(SystemPermission.screenRecording) == PermissionStatus.granted

export async def openGuide() -> number:
    await openExternal("https://example.com/guide")
    return (await displays()).size

export async def firstDropAfterWake() -> string:
    using power = await watchPower()
    using drops = await watchDroppedFiles()
    async for state in power:
        if state == PowerState.resumed: break
    const batch = await drops.next()
    if batch == null: return "no drop"
    return f"{batch.paths.size} files"

export async def install(archivePath: string) -> string:
    try:
        await applyUpdate(archivePath)
        return "replaced; relaunching"
    catch error: return f"refused: {error.message}"
```

## `velar/window`

The window kinds `desktop.windows` declares, opened by kind and optional
instance key. Nothing here invents a kind.

| Export | Signature | Meaning |
| --- | --- | --- |
| `Window` | `focus()`, `close()`, `bounds()`, `setBounds(bounds)`, `display()`, `watchState()` | An owned window handle. Every member answers a Promise; `close()` is the release `using` performs and is idempotent. |
| `WindowBounds` | `{x: number, y: number, width: number, height: number}` | One screen rectangle. Coordinates are finite and within 1,000,000 points; sizes are at least 1 point. |
| `WindowState` | enum `moved`, `resized`, `focused`, `blurred`, `closed` | The closed vocabulary a window's state stream publishes. |
| `WindowStateStream` | `next() -> Promise<WindowState?>`, `close() -> Promise<null>` | The pull stream `Window.watchState()` opens. It drains after `closed`, and coalesces repeated `moved`/`resized` for a slow consumer. |
| `currentWindowKind()` | `-> string` | Synchronous. Which declared kind this document is rendering, so one source graph can decide what it is. |
| `currentWindow()` | `-> Window` | Synchronous. This window rather than one you opened; hold it in a `const`. |
| `openWindow(kind, options)` | `-> Promise<Window>` | Opens a declared kind at `options.route`, with optional `key` and `bounds`. The same kind and key focuses the window that already exists. |
| `windows()` | `-> Promise<List<{kind: string, key: string?, focused: bool}>>` | Every open window, at most 256. |

`Window` members:

| Member | Result |
| --- | --- |
| `focus()` | `Promise<null>` |
| `close()` | `Promise<null>` |
| `bounds()` | `Promise<WindowBounds>` |
| `setBounds(bounds: WindowBounds)` | `Promise<null>` |
| `display()` | `Promise<Display>` — the record from `velar/desktop` |
| `watchState()` | `Promise<WindowStateStream>` |

**Grants.** The module needs none to be imported. `openWindow` requires the kind
to appear in `desktop.windows`; an undeclared kind is refused at the call,
naming that field and listing the declared kinds, and refused again by the host.
`main` is required, opens at launch, and is the kind `currentWindowKind()`
answers there. Kind names are lowercase words joined by single hyphens, at most
32 per application. An instance `key` is at most 128 characters of letters,
digits, `.`, `_`, `:` or `-`. `openWindow`'s `route` must start with `/` and stay
inside this application.

**Two host rules have no knob**: closing `main` closes every other window and
quits, and closing the last window quits. Every window loads the same
application at the route it was opened with, and windows share no JavaScript
context — do not try to share state between them through the language.

```velar
import {WindowBounds, WindowState, currentWindow, currentWindowKind, openWindow, windows} from "velar/window"

export def describe(bounds: WindowBounds) -> string: return f"{bounds.width}x{bounds.height}+{bounds.x}+{bounds.y}"

export async def previewNote(note: string) -> string:
    if currentWindowKind() != "main": return "only the main window opens previews"
    using preview = await openWindow("note-preview", {route: f"/preview?note={note}", key: f"note-{note}"})
    await preview.focus()
    const bounds = await preview.bounds()
    await preview.setBounds({x: bounds.x, y: bounds.y, width: 512, height: 320})
    using states = await preview.watchState()
    async for state in states:
        if state == WindowState.closed: break
    return describe(bounds)

export async def openCount() -> number: return (await windows()).size

export async def thisWindowScale() -> number: return (await currentWindow().display()).scale
```

## `velar/service`

The channel to the long-running processes `desktop.services` declares. The
language starts them, supervises them, converges them on quit, and hands the
renderer one authenticated loopback channel to each. It owns nothing inside a
service: declaring one makes it auditable, not confined.

| Export | Signature | Meaning |
| --- | --- | --- |
| `ServiceClose` | `{code: number, reason: string}` | Why a channel closed. |
| `ServiceConnection` | `state()`, `send(message)`, `next()`, `closeInfo()`, `close(code=1000, reason="")` | An owned channel. `state()` answers `"open"` or `"closed"`; `close()` is the release `using` performs. |
| `ServiceState` | enum `starting`, `ready`, `restarting`, `failed`, `stopped` | The supervisor's transitions. |
| `ServiceStateEvent` | `{name: string, state: ServiceState, detail: string?}` | One transition. `detail` is carried by `failed` and `restarting` and is `null` for every other state. |
| `ServiceStateStream` | `next() -> Promise<ServiceStateEvent?>`, `close() -> Promise<null>` | The pull stream `watchServices()` opens. |
| `connect(name)` | `-> Promise<ServiceConnection>` | Opens the authenticated channel to one declared service. |
| `watchServices()` | `-> Promise<ServiceStateStream>` | Opens the supervision stream for every declared service. |

`ServiceConnection` members:

| Member | Result |
| --- | --- |
| `state()` | `Promise<string>` — `"open"` or `"closed"` |
| `send(message: string)` | `Promise<null>` |
| `next()` | `Promise<string?>` |
| `closeInfo()` | `Promise<ServiceClose>` — waits for closure |
| `close(code: number = 1000, reason: string = "")` | `Promise<null>` |

**Grants.** Importing the module requires at least one entry under
`desktop.services`; `watchServices()` says the same thing again at the call. An
undeclared name is refused by `connect`, naming `desktop.services` and listing
what is declared. A service that is not `ready` is refused by state — services
start before the renderer loads and are not awaited, so read `watchServices()`
rather than assuming one is up.

**The channel.** `ServiceConnection` keeps the `velar/websocket` client's
discipline under its own identity: `send` is backpressured and settles when the
frame has left, `next` is a bounded pull that permits one active pull and
answers `null` after release, and the release is what `using` performs. It
carries text, up to 8 MiB per frame; a close `code` is 1000 through 4999 and a
`reason` at most 123 UTF-8 bytes. Application code never holds the token that
authenticates the channel — the host spends it itself on the first frame — so
there is no credential to leak through this API.

**`detail`** is the only thing the language says about the inside of a service:
up to the last 4 KiB the process wrote to its own standard error, truncated on a
character boundary. Show it to a person; never parse or match on it. The whole
of a service's output is a rotating log file under the app-data directory, which
[`packages/desktop/README.md`](../packages/desktop/README.md) names.

```velar
import {ServiceClose, ServiceState, ServiceStateEvent, connect, watchServices} from "velar/service"

export def label(event: ServiceStateEvent) -> string:
    if event.state != ServiceState.failed: return event.name
    const detail = event.detail ?? "no detail"
    return f"{event.name} failed: {detail}"

export async def firstState() -> string:
    using states = await watchServices()
    const event = await states.next()
    if event == null: return "no event"
    return label(event)

export async def indexNote(id: string) -> string:
    using channel = await connect("core")
    await channel.send(f"put {id}")
    const reply = await channel.next() ?? ""
    const open = await channel.state()
    await channel.close(1000, "done")
    const closed: ServiceClose = await channel.closeInfo()
    return f"{open}|{reply}|{closed.code}|{closed.reason}"
```

## `velar/notification`

System notification delivery and the activations it produces.

| Export | Signature | Meaning |
| --- | --- | --- |
| `NotificationActivation` | `{tag?: string?}` | One click on a delivered notification, reporting the tag it carried. |
| `NotificationActivationStream` | `next() -> Promise<NotificationActivation?>`, `close() -> Promise<null>` | The pull stream `activations()` opens. |
| `NotificationPermission` | enum `granted`, `denied`, `undetermined` | The operating system's own answer. |
| `requestPermission()` | `-> Promise<NotificationPermission>` | Asks the operating system and answers what it said. |
| `show(notification)` | `-> Promise<null>` | Delivers one `{title: string, body: string, tag?: string?}`. |
| `activations()` | `-> Promise<NotificationActivationStream>` | Opens the activation stream. |

**Grants.** There are two gates and they are different. The manifest's
`desktop.permissions.notifications: true` is the application's declaration that
it may notify at all; without it `requestPermission`, `show`, and `activations`
each fail at the call and name that line — which is also why the import itself
is refused when the flag is absent. The operating system's own answer is the
second gate: ask for it with `requestPermission()`. `show` on an unauthorized
application fails; it never quietly delivers nothing.

**Bounds.** `title` is at most 256 UTF-16 code units, `body` 1024, and `tag` 128.
The required title and body must be non-empty and NUL-free; an omitted or `null`
tag is allowed, and a provided string must be non-empty and NUL-free. A `tag` is
the notification's identity — a
second notification carrying it replaces the first, and an activation reports it
back. Two clicks on one notification are one activation, and the host brings the
application forward with it, opening `main` when no window is left.

```velar
import {NotificationActivation, NotificationPermission, activations, requestPermission, show} from "velar/notification"

export def tagOf(activation: NotificationActivation) -> string: return activation.tag ?? "untagged"

export async def announce(packages: number) -> string:
    if await requestPermission() != NotificationPermission.granted: return "not notified"
    using clicks = await activations()
    await show({title: "Build finished", body: f"{packages} packages", tag: "build"})
    const click = await clicks.next()
    if click == null: return "no activation"
    return tagOf(click)
```

## `velar/secure-storage`

The named credential slots `desktop.permissions.secureStorage` declares, held as
macOS keychain generic passwords under the application's bundle identifier.

| Export | Signature | Meaning |
| --- | --- | --- |
| `set(name, value)` | `-> Promise<null>` | Writes one declared slot. |
| `get(name)` | `-> Promise<string?>` | Reads one declared slot; `null` when it holds nothing. |
| `remove(name)` | `-> Promise<null>` | Clears one declared slot. Removing what is absent is not an error. |

**Grants.** Importing the module requires a non-empty
`desktop.permissions.secureStorage`. A name outside that allowlist fails at the
call, naming the field and listing the declared names. Slot names follow the
`secrets` spelling rule — `[A-Z_][A-Z0-9_]{0,127}` — and one name may appear in
only one of the two lists, because they are different authorities: a `secrets`
entry is an opaque value the environment injects and only a permitted transport
resolves, while a `secureStorage` entry is a slot the application itself writes
and reads.

**`get` returns the credential to the caller.** Values are capped at 8 KiB of
UTF-8 data. Validation errors describe a rejected value's size, not its content,
and the host's diagnostics and test seam do not expose stored values:
`velar/desktop-test` reports which names the fake keychain holds, not their
contents. The application must keep returned credentials out of its own logs
and UI; report whether a credential is present, not what it is.

```velar
import {get, remove, set} from "velar/secure-storage"

export async def rotate(token: string) -> bool:
    await set("CLOUD_SESSION", token)
    const stored = await get("CLOUD_SESSION")
    await remove("CLOUD_SESSION")
    await remove("CLOUD_SESSION")
    return stored != null
```

## `velar/desktop-test`

The test-process door into the Desktop host, the way `velar/web-test` is the
door into the running page. It is the one place a Desktop capability is a call a
test controls rather than a request to a machine.

**What `velar test --browser` drives.** The command builds a real CSP production
site from the project, starts an isolated local host, and creates a fresh
browser context for each `*.browser.test.vel` test. For a Desktop project it
also installs a deterministic fake host in the page, which answers every module
above — `velar/desktop`, `velar/window`, `velar/service`,
`velar/notification`, `velar/secure-storage`, and the permission-scoped
`velar/fs` — from the project's own manifest, above the granted roots. This
module is the test process's handle on that fake host: it produces the events a
real system would and reads back what the application did. Its runtime exists
only under that command; calls without the browser-test runtime are refused with
`velar/desktop-test requires 'velar test --browser'`. Put these tests in
`*.browser.test.vel`; ordinary `.test.vel` files exercise target-independent
logic without this host seam.

Two choices are made **before** the first `browser.open()` and are sealed by it —
`setPlatform` and `setWindowKind`. Start `serveService` before opening the page
too, so its initial service registry contains that ready server. Service
controls (`serveService`, `pushService`, `serviceRejectsWrongToken`, and
`stopService`) run in the test process; the remaining helpers operate on the
running page's fake host. In particular, call `setSigningTeam` after
`browser.open()`.

| Export | Signature | Meaning |
| --- | --- | --- |
| `setPlatform(value)` | `-> Promise<null>` | Selects the `DesktopPlatform` the page will report. Before the first `browser.open()`. |
| `setWindowKind(kind)` | `-> Promise<null>` | Selects the declared kind the page renders as. Before the first `browser.open()`. |
| `appDataDirectory()` | `-> Promise<string>` | The fake host's app-data root, as the test process sees it. |
| `projectDirectory()` | `-> Promise<string>` | The fake host's project root, as the test process sees it. |
| `makeDirectory(path)` | `-> Promise<null>` | Creates a fixture directory under a granted root. |
| `readText(path, maxBytes)` | `-> Promise<string>` | Reads a fixture file under an explicit budget of 1 byte to 16 MiB. |
| `writeText(path, text)` | `-> Promise<null>` | Writes a fixture file. |
| `removeFile(path)` | `-> Promise<null>` | Removes a fixture file. |
| `openWindows()` | `-> Promise<List<{kind: string, key: string?, focused: bool}>>` | The fake window registry's contents, at most 256. |
| `focusWindow(kind, key=null)` | `-> Promise<null>` | Produces the host focus event for one window. |
| `moveWindow(kind, key, bounds)` | `-> Promise<null>` | Produces the host move/resize event with one `WindowBounds`. |
| `closeWindow(kind, key=null)` | `-> Promise<null>` | Produces the host close event for one window. |
| `setNotificationPermission(permission)` | `-> Promise<null>` | The answer the operating system's dialog would give. |
| `shownNotifications()` | `-> Promise<List<{title: string, body: string, tag: string?}>>` | The fake notification centre's inbox, at most 256. |
| `activateNotification(tag=null)` | `-> Promise<null>` | The click on a delivered notification. |
| `setServiceState(name, state, detail=null)` | `-> Promise<null>` | Injects a supervisor transition. A `detail` is accepted only for `failed` and `restarting`, and is capped at 4 KiB. |
| `serveService(name, handler)` | `-> Promise<null>` | Runs a real loopback WebSocket server for one service in the test process; `handler` is `(string) -> Promise<string>` and stays in VelarScript. |
| `pushService(name, message)` | `-> Promise<number>` | Emits an unrequested frame to every open connection, at most 8 MiB, and answers how many took it. |
| `serviceRejectsWrongToken(name)` | `-> Promise<bool>` | Whether the service side refuses a connection opened with a token that is not the host's. |
| `stopService(name)` | `-> Promise<null>` | Releases a served service: the server closes, both pumps settle, the application sees it stopped. |
| `secureStorageNames()` | `-> Promise<List<string>>` | The names the fake keychain holds, at most 64. Never the values. |
| `publishPower(state)` | `-> Promise<null>` | Produces one `PowerState` transition. |
| `dropFiles(paths)` | `-> Promise<null>` | Produces one drag gesture of 1 to 4,096 absolute paths. |
| `setSystemPermission(kind, status)` | `-> Promise<null>` | Sets what `permissionStatus` will answer for one `SystemPermission`. |
| `openedLinks()` | `-> Promise<List<string>>` | What was handed to the system link handler, at most 256. |
| `setSigningTeam(team=null)` | `-> Promise<null>` | What Team ID this install carries; `null` is the ad-hoc-signed development build. |
| `stageUpdate(archivePath, bundleIdentifier, team=null)` | `-> Promise<null>` | What an archive on disk claims to be, so `applyUpdate`'s four refusals are reachable. |
| `appliedUpdates()` | `-> Promise<List<string>>` | Which archives the host actually applied, at most 64. |

**Grants.** The module has no import-level grant. Its filesystem helpers still
require the matching `app-data` or `project` entry in
`desktop.permissions.files`, and reject paths outside those granted roots as
the application's own `velar/fs` calls do.

**Two rules the seam keeps.** The fake keychain reports names and never values:
a seam that handed a credential back would be the exception that ends that rule.
And the service fake is not a stub — `serveService` starts a real loopback
WebSocket server, so a message leaves the application, crosses a socket, reaches
the handler, and comes back; `serviceRejectsWrongToken` lets a test watch the
same server refuse a connection whose token is not the host's. A test owns the
work it starts, so `stopService` is how it hands the server back.

```velar
import {DesktopPlatform, PermissionStatus, PowerState, SystemPermission} from "velar/desktop"
import {NotificationPermission} from "velar/notification"
import {ServiceState} from "velar/service"
import {expect} from "velar/test"
import {activateNotification, appDataDirectory, appliedUpdates, closeWindow, dropFiles, focusWindow, makeDirectory, moveWindow, openWindows, openedLinks, projectDirectory, publishPower, pushService, readText, removeFile, secureStorageNames, serveService, serviceRejectsWrongToken, setNotificationPermission, setPlatform, setServiceState, setSigningTeam, setSystemPermission, setWindowKind, shownNotifications, stageUpdate, stopService, writeText} from "velar/desktop-test"
import {browser} from "velar/web-test"

test "the fixture filesystem writes, reads back, and removes":
    await setPlatform(DesktopPlatform.macos)
    await setWindowKind("main")
    await browser.open()
    const folder = f"{await appDataDirectory()}/fixtures"
    const file = f"{folder}/note.txt"
    await makeDirectory(folder)
    await writeText(file, "written by the test")
    expect(await readText(file, 4096)).toBe("written by the test")
    await removeFile(file)
    expect((await projectDirectory()).startsWith("/")).toBe(true)

test "the fake host produces the events a real system would":
    await browser.open()
    await focusWindow("main", null)
    await moveWindow("main", null, {x: 40, y: 60, width: 512, height: 320})
    await setNotificationPermission(NotificationPermission.granted)
    await activateNotification("build")
    expect(await shownNotifications()).toHaveLength(0)
    await publishPower(PowerState.resumed)
    await dropFiles(["/tmp/one.txt", "/tmp/two.txt"])
    await setSystemPermission(SystemPermission.screenRecording, PermissionStatus.granted)
    expect(await openedLinks()).toHaveLength(0)
    expect(await secureStorageNames()).toHaveLength(0)
    await closeWindow("main", null)
    expect(await openWindows()).toHaveLength(0)

test "a served service authenticates clients and accepts supervisor events":
    await serveService("core", async (request: string) => request)
    try:
        await browser.open()
        expect(await serviceRejectsWrongToken("core")).toBe(true)
        expect(await pushService("core", "nobody is listening yet")).toBe(0)
        await setServiceState("core", ServiceState.restarting, "the process exited")
    finally: await stopService("core")

test "the update identity a running application cannot read about itself":
    await browser.open()
    await setSigningTeam("ABCDE12345")
    await stageUpdate("/tmp/Example.zip", "com.example.app", "ABCDE12345")
    expect(await appliedUpdates()).toHaveLength(0)
```

## Deliberate boundaries

Desktop surface 0.10 publishes no user main process, renderer project, local
server, port, or general IPC surface, and no request function for a system
permission — asking the user belongs to the product flow that consumes the
answer. Language servers, semantic project transactions, product task runners,
terminals, editors, database engines, deployment providers, and other product
features are not Desktop language capabilities: they belong to the product that
owns their policy, or to an independently versioned integration built on the
public contracts above. A short-lived process is `velar/process` with a
`processes` grant, which is a different model on purpose; `desktop.services` is
only for the long-running processes the product owns.

Diagnostics and the checked manifest vocabulary outrank this document if they
disagree. Runnable Desktop examples live in `examples/tour/desktop/`.
