# The VelarScript Desktop AI skill brief

Load this after `velar skill core` and `velar skill web`. Desktop composes the
Web language but owns a separate least-privilege application target. This file
contains only that target contract; `velar skill desktop` prints it verbatim.

## Ownership

Activate Desktop explicitly and declare authority in its own manifest key:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "extensions": ["@velarscript/desktop"],
  "desktop": {
    "productName": "Example",
    "identifier": "com.example.app",
    "permissions": {
      "files": ["project"],
      "processes": ["git"],
      "terminal": true,
      "network": ["https://api.example.com"],
      "environment": [],
      "secrets": []
    }
  }
}
```

Desktop owns the `desktop` manifest key, `velar/desktop`,
`velar/desktop-test`, and permission-scoped target implementations of
`velar/fs`, `velar/path`, `velar/process`, `velar/http`, and `velar/env`. It
composes Web components, JSX, Look, state, resources, actions, and browser
tests; it does not introduce a user main process, renderer project, local
server, port, or IPC API.

The permission manifest is the authority. Never broaden it merely to silence a
failure. Add the smallest file root, executable identity, network origin,
environment name, secret name, or terminal grant that the product behavior
actually requires. Renderer code cannot invent authority at runtime.

## Capability model

All privileged operations are asynchronous checked calls. Import their
standard modules; do not reach for Node globals, Electron, a shell command, or
an ambient bridge. Returned capability values are owned handles: use `using`
where the scope should release them, consume pull streams to completion, and
close them explicitly when a user action retires them early.

`velar/desktop` exposes finite product operations including project selection,
the packaged language server, reviewable project changes, official project
tasks, and a permission-gated terminal. Their public choices are enums and
checked records, not arbitrary executables, working directories, environment
maps, command strings, or file-operation payloads.

Project-relative filesystem work follows the current project grant. A user
selection may replace that grant, so do not cache an old absolute path or keep
project-owned work alive across a replacement. Secrets remain opaque until a
permitted transport resolves them; do not print, serialize, or persist them.

## Application shape

Keep the entry identical to a Web application:

```velar fragment
import {App} from "./app.vel"

mount(<App />, "#app")
```

Components remain ordinary Web components. Put target-specific capability
calls in narrow service modules so UI code depends on checked application data
rather than transport details. A platform behavior that can be expressed with
an official Desktop capability must not be rebuilt with `import js unsafe`.

Use `velar/desktop-test` only from browser-test modules driven by the official
test host. Plain unit tests should cover pure conversion and policy logic
without requesting platform authority.

## Build and finish

`velar dev` previews the renderer. `velar build` creates verified renderer
output, and `velar package` creates the native application with the official
capability host and system WebView assets. Treat size and permission reports as
part of the product contract, not incidental build noise.

Run `velar format`, `velar check`, `velar test`, the Desktop browser tests,
`velar build`, and the project's packaging gate. Runnable target examples live
in `examples/tour/desktop/`; diagnostics and the checked manifest vocabulary
outrank this brief when they appear to disagree.
