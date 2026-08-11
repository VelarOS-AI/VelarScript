# @velarscript/desktop

The optional single-project VelarScript Desktop framework. Application authors
write one ordinary VelarScript source graph with the same components, JSX,
Look, state, derived values, resources, and actions used by
`@velarscript/web`. There is no user-facing renderer project, main project,
local server, port, or IPC layer.

Internally the package composes the Web compiler/runtime with a least-privilege
Node capability host and a thin operating-system WebView shell. Privileged APIs
remain asynchronous and are transported through a versioned bridge generated
by the framework. That separation is an implementation and security boundary,
not a second application programming model.

Each official target module captures the bridge identity, its data-valued
invoke operation, and any platform/environment snapshot fields when that module
initializes. Replacing a global bridge later cannot reroute an official API.
The system-WebView transport also captures its serializer, encoders, timers,
collections, Promise constructor, and native message handler before application
JavaScript executes, so ordinary dependency code cannot monkey-patch an active
capability call into a different transport.
`velar/desktop-test` is the intentional exception: the controller installs a
fresh isolated browser Page for each test, so the helper resolves and validates
one data-only controller snapshot per call instead of retaining authority from
the previous test.

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
    "permissions": {
      "files": ["project"],
      "processes": ["git"],
      "network": ["https://api.example.com"]
    }
  }
}
```

The macOS host uses the system WKWebView and never bundles Chromium, Electron,
or Tauri. Thin builds keep Node external and require Node.js 24 or newer. The
package supplies the borderless VelarScript mark as the default application
icon, so a project receives a branded Dock and Finder identity without owning
platform icon files. A future custom-icon contract must remain an explicit
project setting rather than replacing this package default implicitly.
The host resolves an explicit absolute `VELAR_DESKTOP_NODE`, absolute entries from
the launch environment's `PATH`, and trusted system package-manager locations
without a shell, then verifies the runtime version. Build-machine executable
paths and versions are not embedded in the application.
A future standalone profile must report its runtime bytes separately instead
of hiding them from the application size budget.

Desktop owns `velar/desktop` and permission-scoped target implementations of
`velar/fs`, `velar/path`, `velar/process`, `velar/http`, and `velar/env`.
Applications with the `project` file grant may call
`selectProjectDirectory()` to open the native directory chooser. A successful
choice atomically replaces the single project grant for subsequent relative
`velar/fs`, `velar/path`, and default process-working-directory operations;
cancel returns `null`. `selectedProjectDirectory()` reports only a user-picked
or restored grant, while `projectDirectory()` continues to report the current
effective root, including the private app-data fallback before any selection.
The macOS host persists the user's explicit choice as a bounded bookmark and
restores it before renderer startup. Project selection has no arbitrary timeout
while the native chooser is open. Replacing the grant cancels unpublished
capability work and releases project-owned processes; filesystem effects that
already reached the operating system may still settle, with their retired
results discarded. The capability Worker revalidates the replacement directory
and keeps the independent `app-data` grant unchanged. This is one dynamic
single-project authority, not a renderer-owned allowlist and not a second file
API.
`velar/fs.createText` preserves Node's exclusive no-clobber contract inside the
capability Worker; authorization and creation remain one bounded native effect
rather than a renderer-side check followed by an overwriting write.
`replaceTextIfMatches` carries the same optimistic edit contract: file
mutations for one canonical target are coordinated inside the capability
Worker and a matching replacement commits by same-directory rename. External
processes outside the bridge are not silently described as participants in
that lock.
`watchFiles` also preserves Node's public pull contract and bounds: one active
`next()`, at most 128 live watchers, a 4,096-path/2 MiB coalescing queue, and
`rescan=true` when a native event cannot identify a safe path. Watcher handles
belong to the current document generation and granted roots. Explicit
`close()`, owner retirement, input shutdown, fatal drain, and a successful
project-root replacement all close them; a pending pull cannot publish an
event from the old project after authority changes.
Desktop preserves the shared HTTP failure model across its native bridge:
non-2xx, cancellation/timeout, and request/response transport failures remain
distinct typed errors instead of collapsing Worker failures into one string.
`process.start` is async on Node and Desktop. Process-only applications may
omit file grants and use the launch directory as the default working directory;
an explicit working directory must be inside a granted file root. Exact
executable grants prevent shell parsing but do not claim to OS-sandbox the
native program's own effects—product approval and tool policy remain outside
the language package. Process stdout/stderr crosses the worker bridge as
enum-tagged pull chunks consumed by `async for`; incremental UTF-8 decoding,
single-reader ownership, output bounds, and the consume-before-`wait` lifecycle
match the Node target. The renderer reuses Node's internal process host ABI for
value validation, Map snapshots, Promise operations, and result assembly, and
composes the compiler-owned UTF-8 budget runtime. Desktop does not maintain a
second semantic implementation and adds only its capability bridge and isolated
worker. HTTP response bodies cross the
bridge as bounded pull-based chunks, so timeout and cancellation remain active
through body consumption. Redirects continue only while every exact origin is
granted. `desktop.permissions.secrets` is disjoint from readable environment
permissions; `velar/http.secretHeader` lets the worker inject those values
without exposing them to the renderer, and cross-origin redirects strip every
secret-derived header. Large filesystem, process-input, and HTTP-request values use a bounded
bidirectional chunk transport instead of inheriting WebView message-size
accidents.

Each loaded main document owns a private bridge generation. Page request IDs
may restart at one after reload, but the native host translates the generation
and page ID to a host-global Worker request ID before forwarding. Committed
navigation retires the old generation: late responses are discarded, old
process groups are terminated, old HTTP streams are aborted, and the Worker
rejects any handle used by a different generation. Native completion injection
requires the private generation as well, so application JavaScript cannot
resolve a pending bridge request by invoking the transport hook with only a
guessed numeric ID. Filesystem work that has already reached the OS may finish;
its retired response is never routed into the replacement document.
Pending serialized requests and assembled response chunks each share a 128 MiB
aggregate bridge budget, so the 1,024-request count cannot multiply every
per-request limit into unbounded transport memory. A finite bridge timeout
sends a private generation-qualified cancellation before rejecting. Native
code discards the later response without treating it as an unknown protocol
message, and the Worker aborts an active HTTP request or stops a process that
has not safely transferred its public handle. Filesystem effects remain
non-cancellable and retain their bounded request reservation until they settle.

Filesystem content calls follow symlinks only when the canonical target stays
inside a granted root. Metadata, move, and removal operate on the final entry
instead; dangling links cannot be used as write targets. The renderer, native
worker, and deterministic test host independently enforce the same path,
file-size, list-count, list-text, result-shape, and replacement contracts.
Desktop path composition rejects sparse/accessor-backed Lists and checks the
combined result, not just each input. Native home, app-data, and project paths
must remain absolute and bounded. Readable environment values are snapshotted
from data descriptors under the same 64-variable, 64 KiB item, and 1 MiB total
budgets enforced by the native host.

```sh
velar package .
velar test . --browser=all
```

`velar test --browser` runs `.browser.test.vel` files without opening a window.
It installs a deterministic, permission-aware in-memory Desktop filesystem and
deterministic handles for manifest-granted processes; the native worker keeps
a separate integration suite for real filesystem, process, and network
enforcement. Test modules may import the restricted `velar/desktop-test`
helpers to inspect app-data/project text, seed or remove an external edit or
recovery journal, and create a bounded test directory through the page's actual
capability bridge;
ordinary `velar/fs` remains application-side and is not faked in the test
controller process.
