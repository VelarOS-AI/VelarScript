# @velarscript/desktop

The optional single-project VelarScript Desktop framework. Application authors
write one ordinary Web-shaped VelarScript source graph; there is no public
renderer/main split, local server, port, Electron main process, or IPC API.

Desktop composes `@velarscript/web` with a least-privilege Node capability
worker and a thin system-WebView shell. It owns only the application host and
permission-scoped implementations of existing language capabilities:

- `velar/desktop`: platform, packaging state, application directories, and the
  native project-directory picker.
- `velar/fs`, `velar/path`, `velar/process`, `velar/http`, and `velar/env`: the
  same checked contracts as Node, restricted by the Desktop manifest.
- `velar/desktop-test`: deterministic platform selection and bounded fixture
  filesystem helpers for official browser tests.

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
    "permissions": {
      "files": ["project"],
      "processes": ["git"],
      "network": ["https://api.example.com"],
      "environment": [],
      "secrets": []
    }
  }
}
```

The permission manifest is the authority. File access is limited to the
`app-data` and `project` scopes. Process grants are exact executable names and
do not imply shell parsing or an operating-system sandbox. Network grants are
exact HTTPS origins (or loopback HTTP origins). Readable environment values
and opaque HTTP secrets are separate allowlists.

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
