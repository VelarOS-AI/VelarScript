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
  permission probes, and bounded fixture filesystem helpers for official browser
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
icon, metadata, and that runtime. The manifest reports each component and the
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
exits 0. `--smoke` remains a static bundle check; it cannot see a runtime that
resolves but cannot execute JavaScript. `--headless` runs the application with no
visible windows and no ending.

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
