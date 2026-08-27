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
  gesture brought in, and the read-only `permissionStatus()` probes.
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

The macOS package uses WKWebView and keeps Node external (Node.js 24 or newer).
`velar package` contains only the native host, the capability worker, renderer,
icon, and metadata. The manifest reports each component and the complete tree
hash under one size budget; it does not bundle the CLI, compiler, browser
automation, language server, build engine, project kernel, or PTY helper.

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
