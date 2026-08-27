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

Desktop owns `velar/desktop`, `velar/window`, `velar/desktop-test`, and
permission-scoped implementations of `velar/fs`, `velar/path`, `velar/process`,
`velar/http`, and `velar/env`. It composes Web components, JSX, Look, state,
resources, actions, and browser tests. It does not expose a user main process,
renderer project, local server, port, or general IPC surface.

The manifest is the authority. Never broaden a grant merely to silence a
failure. File roots, executable identities, network origins, readable
environment names, and opaque secret names are finite allowlists.

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
fake window registry answers `velar/window` for the page and lets a browser test
produce the host events a window system would: `setWindowKind` before the first
`browser.open()`, then `openWindows`, `focusWindow`, `moveWindow`, and
`closeWindow`.

## Build and finish

`velar dev` previews the renderer, `velar build` creates verified renderer
output, and `velar package` creates the native application containing the
system-WebView host and capability worker. It does not embed compiler or
Workbench tooling.

Run `velar format`, `velar check`, `velar test`, the Desktop browser tests,
`velar build`, and the platform packaging gate. Runnable target examples live
in `examples/tour/desktop/`; diagnostics and checked manifest vocabulary
outrank this brief if they disagree.
