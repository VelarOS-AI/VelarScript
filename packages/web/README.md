# @velarscript/web

The official Web framework for VelarScript. This package is the versioned
authority for the `velar/look`, `velar/app`, `velar/config`, `velar/web`, `velar/forms`,
`velar/http`, `velar/storage`, `velar/browser`, `velar/files`,
`velar/realtime`, `velar/worker`, `velar/websocket`, and `velar/web-test`
language modules. It also owns the
component/JSX, reactive, lifecycle, Look, DOM/CSS lowering, project-manifest,
and editor contributions that a Core-only VelarScript project does not load. Its
compiler entry owns the Web parser, analyzer, semantic index contribution,
intrinsic API rules, dependency/public-interface inspection, and emitter as
one versioned extension boundary. Its separate `./host` entry owns Web document
generation, the development reload client, initial compile-error document, CSP
and deployment projection, browser-test metadata, base-path behavior, and
production source-map policy. The Web editor contribution owns JSX tag/native
HTML/native SVG completion, JSX attribute completion, and the special
`children` rename guard; the generic CLI project semantic layer only supplies
checked symbols and members.

Applications keep the language-level imports:

```velar

import {Head, Link, Router, route} from "velar/web"
import {http} from "velar/http"
import {rgb, spacing} from "velar/look"

const accent = rgb(45, 79, 190)
const pagePadding = spacing(24px, 16px)
```

One-off base properties use the same checked table through JSX directives, and
remain ordered after any composed Look:

```velar fragment
<button
    look={controlLook}
    look:color={paper}
    look:background={accent}
>Save</button>
```

State hooks, viewport conditions, pseudo-elements, and other structural visual
logic remain in a full `look:` value rather than being encoded into directive
names.

`Head` owns route-scoped metadata and accepts a checked `language` tag when an
application switches document language at runtime.

The project declares `"extensions": ["@velarscript/web"]`; the project-local
`velar` CLI resolves this package's compiler contract and injects its browser
runtime. Application code does not import the npm package directly. The
explicit `./compiler` and `./host` exports are tooling infrastructure, not
second application APIs. The CLI discovers those entries from the project
extension list, validates host protocol version 1 and the matching `web`
capability, and never installs or identifies this package itself.
The npm manifest declares generic `velar.extension` metadata with the owned
`web` project field, so `velar add` and `velar remove` can maintain project
activation without teaching the CLI this package's name.

The Web Worker runtime snapshots caller-owned transferable data, then transfers
nested `Bytes`, `UInt8Buffer`, `UInt16Buffer`, `UInt32Buffer`, and
`Float32Buffer` storage after checked request/response validation and a bounded
cycle-safe graph scan. Caller buffers stay intact. Pull WebSockets independently
bound unread message count, aggregate unread bytes, and pending send bytes;
normal EOF preserves queued messages for draining, while receive failure clears
them immediately.

`@velarscript/web` requires the exact matching `@velarscript/compiler`
version. It has no dependency on VelarOS Workbench and does not define the
future Canvas-oriented `velar/game` framework.

Browser HTTP responses expose `.bytes()`, IndexedDB databases expose
`getBytes`, `setBytes`, and atomic `batch`, and the same immutable `Bytes`
contract crosses WebSocket and Worker boundaries. Worker source entries come
from the project manifest, so application source does not construct bundle URLs.
Requests and responses are checked with runtime `Type` values; pools, call
queues, message queues, transfers, cancellation, timeout, and crash convergence
are bounded by the shared Core contracts. `velar/realtime` keeps
`eventStream`; the WebSocket client is `velar/websocket.connect`.

The package also owns Look, the checked visual language integrated with VelarScript
values and JSX. `look:` values, ordinary functions, imports/exports, named
`velar/look` builders, unit-aware properties and arithmetic, bounded `if` conditions, `@state` hooks, and
`@target` blocks lower to extracted standard CSS with stable readable markers.
Native and component JSX accept universal `class` and `look` props; inline
`style` directives are rejected. Raw CSS is available only through an explicit
`import css unsafe` declaration whose mandatory `before look` or `after look`
placement defines source order without inventing priority semantics.
