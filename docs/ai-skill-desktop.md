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

Desktop owns `velar/desktop`, `velar/desktop-test`, and permission-scoped
implementations of `velar/fs`, `velar/path`, `velar/process`, `velar/http`, and
`velar/env`. It composes Web components, JSX, Look, state, resources, actions,
and browser tests. It does not expose a user main process, renderer project,
local server, port, or general IPC surface.

The manifest is the authority. Never broaden a grant merely to silence a
failure. File roots, executable identities, network origins, readable
environment names, and opaque secret names are finite allowlists.

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
should cover pure policy and conversion logic without platform authority.

## Build and finish

`velar dev` previews the renderer, `velar build` creates verified renderer
output, and `velar package` creates the native application containing the
system-WebView host and capability worker. It does not embed compiler or
Workbench tooling.

Run `velar format`, `velar check`, `velar test`, the Desktop browser tests,
`velar build`, and the platform packaging gate. Runnable target examples live
in `examples/tour/desktop/`; diagnostics and checked manifest vocabulary
outrank this brief if they disagree.
