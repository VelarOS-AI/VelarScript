# @velarscript/web

The official Web framework for VelarScript. This package is the versioned
authority for the `velar/app`, `velar/config`, `velar/web`, `velar/forms`,
`velar/http`, `velar/storage`, `velar/browser`, `velar/files`,
`velar/realtime`, and `velar/web-test` language modules. It also owns the
component/JSX, reactive, lifecycle, style, DOM/CSS lowering, project-manifest,
and editor contributions that a Core-only Velar project does not load. Its
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
```

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

`@velarscript/web` requires the exact matching `@velarscript/compiler`
version. It has no dependency on VelarOS Workbench and does not define the
future Canvas-oriented `velar/game` framework.
