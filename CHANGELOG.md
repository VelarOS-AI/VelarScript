# Changelog

This file records user-visible language, framework, and tooling changes. It is
not a milestone checklist; the repository test suites and CI are the source of
truth for acceptance status.

Since 0.25.0 each release section carries the **surface versions** it shipped.
One installation number covers five surfaces that do not move together, so the
heading of a section says which of them you actually have to re-read. Surface
versions start counting at 0.25.0 — `core` from `0.1` — and `0.N`'s `N` is how
many times that surface has changed *since counting began*, never a maturity
grade: `core@0.1` beside `web@0.11` means Core started counting today, not that
Core is younger. History is deliberately not recomputed (D110 rule 3).

## 0.27.4 — 2026-09-05

Surfaces: `core@0.5` · `web@0.12` · `node@0.16` · `server@0.15` · `desktop@0.10`

### Semantic validation — `core@0.5`

- Added target-neutral `velar/validation` for bounded, path-aware semantic
  rules layered on the existing runtime `Type<T>` structural parser. Primitive,
  field, List-element, optional, custom predicate, and aggregate rules compose
  without a second schema language, coercion, defaults, or environment access.
- `parse`/`safeParse` and reusable `validator(Type, rule)` values now give owned
  boundaries one checked path for structural and domain validation; `inspect`
  retains all semantic issues while `validate` throws the first as
  `ValidationError`.

### Editor semantics

- Hover and completion documentation for standard imports, permanent
  namespaces, collection members, and target-owned modules now comes from the
  active compiler contracts instead of a parallel hand-maintained API list.
- Semantic tokens distinguish framework definitions such as components,
  actions, reactive state, resources, and servers while retaining their
  underlying function or variable role.

### Checked visual filters — `web@0.12`

- Added typed `Filter` builders for blur, brightness, contrast, drop shadows,
  grayscale, hue rotation, inversion, opacity, saturation, sepia, and bounded
  filter-list composition.
- A complete CSS filter string with a provably equivalent builder form now
  receives advisory `A16` and an editor fix that carries the required
  `velar/look` imports. Custom and otherwise unproved CSS remains explicit
  free text.

## 0.27.3 — 2026-09-05

Surfaces: `core@0.4` · `web@0.11` · `node@0.16` · `server@0.15` · `desktop@0.10`

### Publication refresh

- Republished the unchanged 0.27.2 language and framework surfaces as a new,
  immutable npm patch version so downstream projects can consume a fresh,
  fully version-locked eight-package release set.

## 0.27.2 — 2026-09-05

Surfaces: `core@0.4` · `web@0.11` · `node@0.16` · `server@0.15` · `desktop@0.10`

### Collections and canonical forms — `core@0.4`

- `List.map`, `flatMap`, `filter`, `find`, `some`, and `every` callbacks may
  declare a second `index` parameter. It is the zero-based position in the
  stable snapshot those methods already read.
- A13 now recognizes unguarded two-slot List builders and preserves the index
  in a two-parameter callback. The Web extension also proves stable native JSX
  projections, so UI-node builders receive the same editor fix while component
  setup, refs, bindings, effects, and index-changing filter pipelines remain
  explicit.

## 0.27.1 — 2026-09-04

Surfaces: `core@0.3` · `web@0.11` · `node@0.16` · `server@0.15` · `desktop@0.10`

### Language and editor tooling

- Exact, side-effect-free `List` loops can now be shortened through editor
  fixes to `some`, `every`, `find`, `map`, `filter`, or `flatMap`. Fixes are
  withheld when comments, effects, unstable sources, or branch-only type
  narrowing would change meaning.
- Same-name object fields such as `{id: id}` now offer the equivalent
  shorthand `{id}` while preserving surrounding layout and comments.
- Language-service coverage now includes the expanded built-in collection
  vocabulary, Look property/value completions and hover types, and the current
  function and declaration forms.

### Web attributes

- Native element attributes now use one value contract: `null` and `false`
  remove the attribute, `true` writes an empty present attribute, strings stay
  exact, and finite numbers use their text form.
- A native text attribute written as `flag ? "true" : "false"` now offers the
  equivalent `str(flag)` fix. Component props, HTML boolean-presence
  attributes, optional booleans, custom elements, and comment-sensitive forms
  remain explicit.

## 0.27.0 — 2026-09-04

Surfaces: `core@0.3` · `web@0.11` · `node@0.16` · `server@0.15` · `desktop@0.10`

### Core and worker runtimes — `core@0.3`

- `WorkerPool.broadcast(request, cancellation?, timeout?)` initializes or
  notifies every live member once and returns responses in member-creation
  order. Capacity is checked across the whole pool before dispatch, so an
  overloaded broadcast never reaches only part of the pool.
- Node workers now match the Web worker timeout and crash contract: a timed-out
  caller is rejected immediately, its queue slot is released, cancellation is
  acknowledged, and an unresponsive worker is terminated after the bounded
  grace period. Pools skip failed members and report when no live member
  remains.

### Surface-version gate

- Surface digests now include canonical public contracts as well as exported
  names. Changing a method, parameter, field, type, mutability marker, or
  re-export under an existing name can no longer bypass the required surface
  bump. Existing non-Core lock digests were migrated to the stronger encoding
  without changing those unchanged surface counters.

## 0.26.1 — 2026-09-04

Surfaces: `core@0.2` · `web@0.11` · `node@0.16` · `server@0.15` · `desktop@0.10`

### Core runtime

- Fixed partially filled `UInt32Builder` and `Float32Builder` finalization.
  Exact-capacity builders still transfer their backing store without a copy;
  builders with spare capacity now copy only their initialized elements rather
  than attempting to write unused capacity past the shorter result buffer.

## 0.26.0 — 2026-09-04

Surfaces: `core@0.2` · `web@0.11` · `node@0.16` · `server@0.15` · `desktop@0.10`

### Core and CLI — `core@0.2`

- **Breaking**: detached work is now written `detach task()`. `async` has one
  role again: it qualifies functions, arrows, and asynchronous iteration. The
  compiler rejects the previous detached statement spelling and offers the
  mechanical rewrite.
- Local `def` declarations are visible throughout their lexical block, matching
  top-level functions and allowing forward calls and mutually recursive helper
  functions without declaration-order workarounds.
- `readonly type Name:` declares a wholly read-only data record. The contract
  includes inherited fields and projects transitively through nested records
  and collections; mixed records continue to use field-level `readonly`.
- Number sign and truncation are consistently value methods: use
  `value.sign()` and `value.trunc()`. The duplicate `Math.sign` and
  `Math.trunc` namespace entries are removed with mechanical call-site
  guidance.
- `Map.getOrSetWith(key, factory)` adds atomic lazy initialization without
  constructing a fallback on the existing-key path. Its zero-argument factory
  is contextually checked to return the Map's value type.
- `Bytes` and fixed numeric buffers are directly iterable, including the
  optional index slot, so read-only numeric loops no longer allocate a
  `List<number>` snapshot. Builder finalization reuses an already exact backing
  store.
- Typed Worker messages transfer the single validated binary snapshot. A
  receiver adopts a valid worker-owned buffer graph without reparsing it, while
  inputs that still alias caller-owned buffers retain the defensive clone.

## 0.25.0 — 2026-08-29

Surfaces: `core@0.1` · `web@0.11` · `node@0.16` · `server@0.15` · `desktop@0.10`

This is the release that starts counting, so these are the numbers the four
extension contracts already carried plus Core's first one; earlier sections are
not labelled retroactively. From the next release on, a change to a surface
without a bump to its number is a build failure —
`scripts/check-surface-versions.mjs` hashes each surface and compares it against
`surface-lock.json`.

### Core and CLI — `core@0.1`

- Surface versions arrive (D110). Each of the five surfaces — `core`, `web`,
  `node`, `server`, `desktop` — carries a version of its own beside the single
  installation number, `velar --version` prints all five, and `velar.json`
  accepts an optional `surfaces` block that the compiler checks against what is
  installed. The compiler refuses a declaration that no longer matches, so an
  upgrade that moves a surface makes the re-read mandatory rather than
  conscientious. Core's counting starts here at `0.1`; the number is a counter,
  not a maturity grade.

## 0.25.0 — 2026-08-29

### Web

- A component element inside a `{ternary}` interpolation or a keyed map over
  rebuilt records rebuilds by contract; static child positions and keyed rows
  written in place preserve the instance. The semantics were already written —
  this release adds the reconciliation regression suite that pins all four
  positions, and A4 now also recognizes the derived spelling of keyed row
  churn (a `computed` building fresh records through a builder) with the same
  code and the same `velar-allow A4` suppression.
- A component element returned at the root of a markup-answering `def` is
  refused where it is written (`VEL5075`); the runtime could never honor it
  and previously dropped the subtree silently.
- A module-level root whose construction throws now surfaces the compiler-owned
  fatal state and reports once through `velar/app` under the `mount` phase,
  instead of leaving a blank page. Module-level instantiation itself is
  unchanged.
- A reactive render that invalidates itself by writing a collection it reads
  now names the read-write path and the repair in the runaway report.
- A `//` comment attempt on its own line inside a JSX children region is
  refused (`VEL5002`) instead of rendering as screen text; a URL or an inline
  `//` in prose stays text, and the children-region boundary is now stated in
  the charter and Web docs.
- **Breaking**: `font` leaves the Look property table. Write the longhands
  (`fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, …) — the shorthand
  resets the siblings this family publishes as checked properties, and a
  `token()` there fails at computed-value time with no diagnostic. The refusal
  names the longhands. One Look scope holding a shorthand and one of its
  longhands is now refused the way a doubled property already was.
- `verticalAlign` joins the Look table as a metric property with its checked
  keyword set. `keyframes:` stop documentation now names `token()`, and the
  tour animates one.
- **Breaking**: `velar/browser`'s clipboard write is spelled
  `writeClipboardText` (was `copyText`), so the read/write pair reads as a
  pair. No alias; rename call sites.
- `watchIntersection` completes the `velar/browser` watcher family (element
  viewport/container intersection as a bounded watcher). `KeyboardEvent`
  gains `isComposing`, so an Enter-to-send composer can leave IME composition
  alone.

### Core and CLI

- `velar/time.format` accepts `dateStyle` and `timeStyle` (Intl's own
  vocabulary plus `none`), so a time-of-day renders without a second spelling.
- `velar fix` and `velar check` share one diagnostic truth for project-layer
  rules, and the `@main` entry migration is mechanical for the single-statement
  entry class.
- The dev server resolves `#`-mapped self-imports and linked-package
  dependencies the way `velar check` does, and compiled sandboxes carry
  relative `#` targets, fixing `velar test`/`run`/`dev`/`serve` for projects
  using them.
- A project installs the targets it declares instead of all of them (D111).
  `@velarscript/cli` keeps the compiler, Core, the Node runtime and the project
  creator as dependencies — what it needs in order to load — and states Web,
  Server, Desktop and `playwright` as exact optional peers, so a Core project's
  `node_modules` no longer carries three frameworks and a browser driver it
  never asked for. `velar lsp` bundles the targets it can resolve and passes
  over the absent ones without complaint, the templates that ship browser tests
  declare `playwright` themselves, and a project that activates an extension it
  never installed is now told which package to install rather than shown a
  resolver failure. Version locking is untouched: the three targets are still
  pinned exactly, and the release gate still refuses a range.

### Desktop

- `velar/desktop-test`'s served service can push unsolicited frames
  (`pushService`), so browser tests exercise real push ingestion.

## 0.23.4 — 2026-08-28

### Web applications

- `velar/browser.watchIntersection` adds a bounded, typed element-intersection
  watcher with optional roots and threshold lists.
- `KeyboardEvent.isComposing` exposes input-method composition state so Enter
  handlers can avoid committing incomplete CJK input.
- Production builds now identify the HTML script by the exact checked
  VelarScript application entry. Third-party `import()` split points no longer
  compete by output order, so a renderer package with dynamically loaded shader
  modules cannot replace the application entry with an inert shader chunk.

### Desktop testing

- `velar/desktop-test.pushService` sends unsolicited service messages to every
  active test connection and reports the number of recipients.
- Service test cleanup now releases registrations after failures and safely
  replaces abandoned pumps between tests.

## 0.23.3 — 2026-08-28

### Core Standard API

- Added target-neutral `velar/hash.sha256Text`. The synchronous bounded
  SHA-256 implementation is shared unchanged by Core, Node, Web, and Desktop;
  it accepts at most 16 MiB of UTF-8 text and returns 64 lowercase hexadecimal
  characters without exposing a host hash handle or algorithm selector.

### Package environments

- `velar.targets: ["core"]` is now the complete portability declaration for a
  source package or frozen Core artifact. Core packages can be consumed by
  Core, Node, Web, and Desktop without repeating every target; Node, Web, and
  Desktop declarations remain exact, and host capabilities are still checked
  independently.

## 0.23.2 — 2026-08-28

### Editor intelligence

- The Web extension now publishes semantic colors for checked Look and
  keyframe property names, JSX element names, and JSX attributes. Editors can
  distinguish framework syntax from variables without guessing from spelling,
  while visible JSX text remains ordinary content.

## 0.23.1 — 2026-08-28

### Application structure intelligence

- Static module cycles now produce the non-blocking project advisory `VEL6010`
  on every participating import. Safe function and type cycles remain
  executable, while language servers, editor Problems views, and structure
  visualizations receive one compiler-owned architectural warning that clears
  immediately when an incremental edit breaks the cycle.

## 0.23.0 — 2026-08-28

### Web applications

- Look reads a design system's CSS custom properties, through one checked
  spelling. `token("--name")` is a new `velar/look` builder, and it is legal in
  **every** Look property — the metrics, `boxShadow` and `transition` that used
  to refuse a design token outright, the colours that used to take one as
  unread text, the free-text properties, and `keyframes:` stops alike. The
  argument is a literal CSS custom property identifier; a computed name, an
  interpolation, or a name without its leading `--` is refused where it is
  written, because the reference is the whole of what a compiler that cannot
  see a token stylesheet is able to check. There is no fallback argument: a
  missing token is a defect where the design system defines it, not a decision
  re-made at every use site. The call lowers to `var(--name)` while the module
  compiles, so no call survives into the emitted module.
- One spelling replaces two. A literal `var(--name)` string is refused wherever
  a Look value is checked — `color("var(--name)")` included, which used to pass
  it through as text nothing read — and both forms carry the mechanical rewrite
  to `token("--name")`, adding the `velar/look` import when the module has none.
  The free-text properties still accept free text, so a font stack that ends in
  `var(--name)` is unaffected; a free-text value that is *nothing but* one
  reference receives the new advisory `A12` and its rewrite. `animation` is the
  one property a token cannot carry, because Look generates the `@keyframes`
  names an animation value refers to.

### Language and diagnostics

- A `velar-allow` suppression is read inside a `look:` block, a `keyframes:`
  block, and an f-string interpolation. Those regions are lexed by the parser
  rather than by the module lexer, and their suppressions were dropped: a
  reasoned suppression written on a Look entry silenced nothing, and a stale one
  was never reported, so it could rot in place — the failure the suppression
  rules exist to prevent.

## 0.22.1 — 2026-08-28

### Application structure intelligence

- Added the optional Core-owned `@context("…")` marker for naming the business
  context of a top-level declaration or framework structure. The bounded static
  label creates no scope, wrapper, runtime value, or generated JavaScript; code
  without it keeps the complete compiler-inferred structure.
- The compiler semantic index and incremental ownership graph now carry the
  context through stable symbols, patches, focused queries, and language-server
  responses. Human tools can group the same live graph into clear business
  views, while AI tools select compact semantic neighborhoods without consuming
  presentation coordinates or maintaining a second code index.

## 0.22.0 — 2026-08-28

### Code intelligence

- Added `velar graph`, a compiler-owned project logic view for people and AI.
  Its bounded text form summarizes declarations, ownership, imports, calls, and
  affected paths; `--json` exposes the same stable semantic graph for tools,
  while `--focus` and `--depth` select a local neighborhood without rebuilding
  a second index.
- Added the declaration-gated `velar/ownershipGraph` language-server request.
  Responses carry stable node and edge identities, source locations, coverage,
  revision hashes, and either a complete snapshot or a revision-checked patch.
  Open-document overlays take precedence over disk contents, so editor and AI
  requests observe the same current program.
- Incremental graph refresh now re-analyzes the affected module set and returns
  only changed and removed fragments when the consumer supplies its previous
  revision. Hard node and edge limits, cancellation, and activity metadata keep
  large projects bounded and make refresh cost observable.

### Tooling

- `velar fix` can no longer report a clean tree that `velar check` refuses. The
  rules the CLI enforces about how a *project* is arranged — an application
  entry must declare `@main`, a library entry must not — are enforced where the
  project is resolved rather than where a module is compiled, and the fixer read
  only the compiler's diagnostic channel: a Web project whose startup sat at the
  top level failed `check` with exit 1 while `fix` over the same directory
  printed "applied 0 mechanical fixes; 0 diagnostics remain" and exited 0. Both
  commands now collect those rules from one function, under the same scope
  rules, so they cannot answer differently about one tree. A rule with no
  rewrite behind it is reported as the diagnostic it is and counts toward the
  exit code.
- `velar fix` performs the `@main` entry migration where it is provable. An
  entry whose startup is a single non-block statement on one line at the end of
  the module gets `@main:` written in front of it — the inline body has the
  statement semantics of an indented one, so the line is carried across verbatim
  and nothing else in the file moves. Two startup statements, a statement with a
  declaration after it, a statement spread over several lines, and a one-line
  statement heading a block of its own each stay a diagnostic: which statement
  runs first is visible in the source today and a fixer that merged them would
  be choosing an order rather than preserving one, and the inline body accepts
  one non-block statement, so wrapping `if ready: start()` would leave source
  the compiler no longer parses.
- One file is rewritten once per `velar fix` pass, whatever it is called. A
  module the author gave a second name — a link inside `src/` pointing at a
  shared module, a module hard-linked elsewhere in the project — is one file to
  the filesystem and two roots to the compiler, and the second write was
  computed from the same snapshot as the first, so it either raced it or
  reported the same rewrite twice.

## 0.21.0 — 2026-08-28

### Desktop applications

- Replaced the singular `desktop.window` manifest member with `desktop.windows`,
  a map keyed by window kind. `main` is required and is the window the host
  opens at launch; every other kind waits for `openWindow`, and a kind the
  manifest never declared is refused at the call. The error the retired shape
  raises names `velar fix`, which rewrites it.
- Added `velar/window`: `currentWindowKind`, `currentWindow`, `openWindow`,
  `openWindows`, `closeWindow`, and a `WindowState` stream per window.
- Added `velar/notification` and `velar/secure-storage` — the macOS
  notification centre and the keychain — and extended `velar/desktop` with
  `openExternal`, `displays`, `watchPower`, `watchDroppedFiles`,
  `permissionStatus`, and `applyUpdate`.
- Added four grants to `desktop.permissions`: `links`, the URL schemes
  `openExternal` may hand to the system; `notifications`, which declares intent
  only, since the operating system still asks the user; `secureStorage`, the
  keychain slots an application may write and read; and the `dropped` root
  under `files`, which is not a directory but authority to read the files a
  drag gesture brings in and learn their real paths. Each defaults to no
  authority, and the refusal names the manifest line that would grant it.
- Made `velar package` produce a self-contained `.app`: the user needs nothing
  installed. The bundle carries one Node.js runtime this toolchain generation
  pins, downloaded once against the official `SHASUMS256` digest and cached
  under `~/Library/Caches/velarscript/desktop-runtimes`. The runtime is not an
  application component, so it is measured against an integrity ceiling the
  toolchain owns rather than `desktop.build.sizeBudgetBytes`. Signing runs
  inside-out — runtime, then host, then bundle — because macOS seals a
  bundle from its leaves inward, and `desktop.build.signing` adds an optional
  notarization step that resolves its credentials through a keychain profile
  rather than the manifest. `velar-desktop-build.json` is `formatVersion` 4.
- Renamed the packaged host's `--smoke` to `--verify-bundle`, which is what it
  is: a static check that the bundle is complete and a runtime resolves. It
  could never be an acceptance, because resolving a runtime asks
  `node --version`, which answers before V8 has created an isolate. The
  acceptance is the new `--headless-smoke`, which completes a real capability
  round-trip on the runtime it resolved and waits for every declared service to
  answer its handshake. There is no alias for the old spelling.
- Added `desktop.services` and `velar/service`. A product declares at most eight
  long-running processes, each a project directory `velar package` copies into
  the bundle and runs on the Node.js executable the bundle already carries. The
  host allocates a loopback endpoint and a token per service, supervises them
  under an `always` or `never` restart policy, and converges them on quit;
  `velar dev` runs the same services on the system Node.
- Gave a `watchServices()` event a `detail`: for `failed` and `restarting`, up to
  the last 4 KiB of what the service wrote to its own standard error, truncated
  on a character boundary and stripped of every control character but the
  newline, so an application can tell a person why a service died instead of only
  that it did. It is null for every other state, and the whole of a service's
  output goes to a rotating log file at
  `<app-data>/service-logs/<name>.log`. `velar/desktop-test.setServiceState`
  takes the detail as an optional third argument.
- Pinned WebSocket close code 1008 for a hello a service refuses. A dropped
  connection is also what a service that has not finished binding its port looks
  like; the code separates the two, so a wrong token is reported at once instead
  of retried for thirty seconds and then reported as a slow start.
- Added `VELAR_SERVICE_APP_DATA` to the environment every service is started in,
  beside `VELAR_SERVICE_ENDPOINT` and `VELAR_SERVICE_TOKEN`, in both the packaged
  host and `velar dev`. It carries the directory
  `velar/desktop.appDataDirectory()` answers, already created, and it is standard
  because it is the one thing a service needs that a payload cannot carry: it is
  the application's identity resolved against this machine. `desktop.services`
  still has no `env` — a value that is the same on every machine belongs in the
  payload, and a value the renderer knows is a message rather than a variable.
- Counted a service start's failure once. The readiness deadline and a refused
  token each end the process and report the failure, and the termination they
  caused reported it again for the same start, so the five-failure budget was
  spent at twice its rate and the terminal `failed` arrived after three real
  timeouts rather than five. Restarts were never duplicated; only the count was.

### Language and diagnostics

- A cross-module type check no longer writes a type name the emitting module
  does not bind. A module reaching an enum, a class, or a pinned member only
  through an imported signature — `def maybeKind() -> Kind?` imported without
  `Kind` — had that name emitted as a receiver, so `velar check` and
  `velar build` both passed and the application threw
  `ReferenceError: Kind is not defined` the first time the check ran. A name
  the module does have is still reached precisely; one it does not have
  degrades exactly as an unreachable record type already did.
- `Map(record)` now accepts a record a `type` declaration names. The refusal
  listed "a record" among the forms it takes and then refused the most ordinary
  record the language has.
- A mutable cell that inferred an enum-member singleton now says which
  declaration to annotate: `Cannot assign Locale.enUS to Locale.zhCN` carries
  `'state locale: Locale = ...'`, because the line to change is not the line
  the error points at.
- `contains` on a string points at `has`, the way `includes` and `indexOf`
  already do and the List, Set, and Map tables already did.

### Web applications

- Reading `currentRoute()` inside a rendered position now follows navigation.
  `Router` and `NavLink` each listened to history; `currentRoute()` returned a
  dead snapshot, so chrome outside the `Router` — a title bar, a breadcrumb, a
  sidebar marking the open page — could only learn the route from a mounted
  page publishing it back out. One history subscription now serves all three;
  the return value is the same frozen snapshot, and a read outside a reactive
  position subscribes to nothing.

### Server routes

- A route capture typed by an enum whose wire values are all integers now
  decodes before it checks membership. Such a capture compiled, documented
  `{"type":"integer","enum":[1,2]}`, and then refused every request that
  matched it, because the URL segment is text and the members are numbers. The
  decode is the `number` capture's own rule and nothing wider: `/f/1` answers,
  `/f/3` is the same 422 an undecodable segment is, and an enum whose values
  are all strings — or which mixes the two domains — matches the raw text as
  before.

### Tooling

- `velar test --browser=firefox` no longer fails a Desktop test over a bridge
  call the test itself handled. The runner raised such a failure inside the
  document, and Firefox alone reports an asynchronous in-page evaluation's
  rejection as an error the *page* suffered, so a call made before the first
  `browser.open()` — which is ordinary, and which `serveService` makes by
  design — arrived on the page-error channel and failed a test that had already
  recovered from it. Chromium and WebKit were unaffected. The failure now
  belongs to the caller that asked, on every engine, with its message unchanged.

## 0.20.1 — 2026-08-27

### Application entry

- Every application target now performs its startup inside the selected entry's
  `@main` region, and `velar check`, `velar build`, `velar package`, and
  `velar dev` all refuse an entry that declares none. Web, Desktop, Node, and
  Server have different hosts, but all a host does is execute the module
  `velar.json` selects; showing a page, listening on a port, or waiting for a
  service to exit is an application action the entry must own out loud rather
  than one an extension finds by hunting for an exported name. `velar dev` runs
  the same check, so a missing region shows a compile-error page instead of the
  false success of a command that started and a browser that stayed blank.
  Naming a single `.vel` file is still exempt: it scopes the run to that file.
- Added `kind` to `velar.json`. It is `application` or `library`, and defaults
  to `application`. A `kind: "library"` project may use a framework extension's
  syntax, types, and capabilities without being turned into an application that
  needs a page or a listening port: no application host is resolved for it, and
  its entry is refused if it declares `@main` — the same contract read from its
  other end.
- Removed the exported startup binding a Node or Server entry used to declare,
  and with it the `server.app` and `node.app` manifest members; the `node`
  object now accepts no members at all. The
  `export const start = application(routes)` binding becomes a `@main` that
  starts the transport itself: `application(app)` is now `async` and answers a
  `Server` rather than a startup function, and `run(server)` — new in both
  `velar/serve` and `velar/websocket` — hands that server to `velar/host`,
  which stays the sole owner of SIGINT and SIGTERM so two transports cannot
  install competing handlers.
- Made `server.configuration` a required member of `velar.json`, and removed
  the root `application.yml` convention it replaces. The path is
  project-relative, stays inside the project root, and ends in `.yml`, `.yaml`,
  or `.json`; the framework scans for no filename at all. A declared file that
  is missing now fails closed instead of falling back to defaults, and
  `configuration(Type, maxBytes)` lost its path parameter because the manifest
  already names the file. The resolved path is published as
  `applicationConfigurationPath`.
- `velar-node.json` is `formatVersion` 5: it records the compiled entry module
  and the declared configuration in place of a startup binding, and the
  generated `.velar-node-entry.mjs` launcher is no longer written — the
  compiled entry *is* the executable. The Server extension's API version moved
  from `0.14` to `0.15`, and the Desktop extension's pin on it with it.

Migration is one line where the startup is one line: `mount(<App />, "#app")`
becomes `@main: mount(<App />, "#app")`, and several statements become an
indented `@main:` block holding them in the order they already had. `velar fix`
did not carry this rewrite when 0.20.1 shipped; it does now, for an entry whose
startup is a single statement on one line at the end of the module, and it
reports every other shape rather than choosing an order the source did not
state. A Node or Server project has three more edits, none of them mechanical:
delete `server.app` or `node.app`, write `server.configuration`, and replace the
exported startup binding with a `@main` that awaits `application(routes)` and
hands the server to `run`.

### Server applications

- Added `supply(app, provider, value)` to `velar/serve`. A process that already
  built an application-level resource at startup can bind it to an app-scoped
  `Provider` without process-global state: the binding belongs to the
  composition, so `prefix`, middleware, docs, and lifecycle wrappers keep it,
  and the provider's own `release` still owns shutdown. The compiler checks the
  value against the provider's inferred result type. A provider that is not
  app-scoped, a second binding of the same provider, and more than 128 supplied
  providers in one app are each refused.

### Web applications

- A scalar interpolation now renders as one text node. An interpolation whose
  checked type is `string` or `number` used to be bracketed by a
  `velar:start`/`velar:end` comment pair and an owned child scope: on the
  conversation-stream benchmark's 2,000-message transcript that was 607,952
  comment nodes for 303,976 token spans — 1,247,243 DOM nodes against React's
  618,681 for the identical element tree, and a cold mount several times slower
  on every engine. The qualifying set is exactly those two types, and every
  other type is excluded for the same reason: it does not render as *one* node.
  `bool` renders none, an optional renders none or one, and WebNode, lists,
  unions, and enums can render markup or several.

### Tooling and project compilation

- `velar check` now reads **every `.vel` file under the project**, not only the
  ones the entry imports. A module nothing imports yet — a chapter
  mid-refactor, a file whose last importer was just deleted — is compiled as a
  root of its own and its diagnostics are ordinary diagnostics; `build` refuses
  on them too, and still emits only the graph the entry reaches, because
  checking is not emitting. Naming a single file scopes the run to that file's
  graph as before. `velar fix` reads the same roster: widening one without the
  other would have left `check` refusing a mechanically fixable diagnostic
  `fix` could not see.
- Documented the five names a Web module may not bind — `mount`, `tick`,
  `viewport`, `scheme`, and `motion` — which the compiler already refused with
  **VEL3007**, and corrected a published example that read an optional bare as
  a condition where the language requires `!= null`.

## 0.20.0 — 2026-08-27

### Server routes

- A route may now carry a stable operation identity: an optional source
  identifier between the role and `(`, as in `@get readArticle(...)` or
  `@websocket worldRealtime(...)`. It must be unique after server composition,
  survives `prefix`, and is emitted verbatim as the OpenAPI `operationId`. An
  anonymous route stays valid and receives a method- and path-derived identity
  for documentation only, so nothing already written has to be rewritten.
  Uniqueness is checked at compile, again when an app is assembled, and again
  when OpenAPI is generated, because each of the three is a place a duplicate
  can first become reachable.
- Explicit identities are reserved before any derived one is allocated. A
  derived identity now yields to an explicit one rather than competing with it,
  so adding a route can no longer change an `operationId` that has already been
  published; the retired scheme numbered collisions per base name in declaration
  order, which made a published identity depend on the order routes happened to
  be declared in.
- Declarative WebSocket routes now appear in the OpenAPI document, as GET
  upgrades with a 101 response and `x-velar-transport: websocket`, and carry the
  `documented`, `summary`, `description`, and `tags` metadata that used to be
  HTTP-only. One documented path cannot carry both an HTTP GET and a WebSocket
  upgrade, so a client can discover both transports without copying path strings.
- An operation name is highlighted as a function in editors. It declares no
  variable in handler scope, so the function colour says "callable capability"
  without suggesting it is a captured parameter.

### Runtime

- The Node terminal now delivers every byte it read before its input host
  exits. The host closed the IPC channel carrying that input in the same turn
  as its last send, which discarded whatever the channel had not written yet —
  the end of input among it — so a program reading a large input intermittently
  failed with `Node terminal input host exited unexpectedly with code 0`
  instead of receiving what it had already typed.
- A WebSocket `host` must be non-empty text of at most 255 code units without
  NUL. It was checked only for being text.

## 0.19.1 — 2026-08-27

### Performance and build verification

- Removed repeated deep runtime validation from stable local optional values
  after a presence check, while retaining guards for locations that can change.
- Indexed Server routes by method and path segments, skipped unused route-match
  projections, reused JSON serialization snapshots, and removed avoidable
  request-provider, middleware, and realtime byte-copy allocations.
- Extended `velar verify` to Node production builds. Format-4
  `velar-node.json` now binds the compiler identity, deterministic full-file
  inventory, byte sizes, SHA-256 values, entry/source-map relationships, and
  aggregate `buildId`.

## 0.19.0 — 2026-08-27

### Realtime applications

- Added the server target of `velar/realtime`. `realtimeSession` owns typed
  decode and encode, sequential command handling, one bounded outbound
  mailbox and writer, backpressure, setup cleanup, failure policy, and close
  notification without introducing a Hub abstraction.
- Added the browser target of `velar/realtime`. `realtimeClient` provides an
  explicit connection lifecycle, finite reconnect policy, connection
  generations, fresh URL providers, resynchronization callbacks, and typed
  failure/state reporting. Application commands are never buffered or replayed
  across reconnects.
- Kept application command/event types, authentication, authorization,
  subscriptions, acknowledgements, resume cursors, and idempotency in an
  ordinary shared application protocol package.

### WebSocket transport

- Added `WebSocketClose` and `WebSocketConnection.closeInfo()` to the Node and
  browser transports so application lifecycles receive the actual terminal
  close code and reason.
- Split `velar/server` from the server realtime runtime dependency. Conventional
  HTTP applications no longer load the Node WebSocket transport unless they
  import server-target `velar/realtime`.

### Tooling and documentation

- Updated compiler contracts, executable tours, API references, target skills,
  package acceptance, runtime hardening, enum-surface coverage, and lifecycle
  regression tests for the symmetric server/browser realtime model.

## 0.18.1 — 2026-08-27

### Server OpenAPI

- Kept ordinary JSON records with a business `status` field classified as JSON
  in generated OpenAPI metadata. Only actual framework response shapes with a
  `json`, `text`, or `stream` payload now select an explicit response media
  type.

## 0.18.0 — 2026-08-27

### Route semantics

- Made the checked RoutePattern the first positional route argument. An inline
  `p"..."` projects path and query fields as immutable handler locals; a
  RoutePattern stored in a catalog or another expression requires `pattern as
  route` and exposes `route.pattern`, `route.pathname`, `route.params`, and
  `route.query` as one explicit match value.
- Rejected the old `path=` spelling with a mechanical fix. Semantic tokens and
  Hover now distinguish direct parameter declarations from RouteMatch
  properties, so a referenced expression never injects hidden identifiers.

### WebSocket sessions and channels

- Added declarative `@websocket` session routes to `server`. Matching, decoding,
  dependencies, and credentials resolve before upgrade; connection close and
  server shutdown cancel and join the handler before request-owned resources
  are released. Shared listeners no longer require application Hub or accept
  loop code.
- Added the runtime-validated bounded `Channel<T>` to `velar/task`, with
  multi-producer/single-consumer FIFO backpressure, cooperative cancellation,
  draining close, and distinct closed/backpressure failures.

### Tooling and documentation

- Updated compiler output, semantic tokens, Hover, Standard API documentation,
  Node/Server skills, project templates, and the executable tour. Added route
  migration, declarative WebSocket lifecycle, and Channel boundary coverage.

## 0.17.0 — 2026-08-26

### Node server language

- Added first-class `p"..."` `RoutePattern` values. One declaration now owns
  the literal path, typed path parameters, typed query fields, optionality,
  wire-name aliases, runtime binding, and OpenAPI parameter metadata.
- Route handlers receive one compiler-owned `path` value with `definition`,
  `params`, and `query`. Exported `const` route catalogs remain statically
  resolvable across modules, including object members, spreads, aliases, and
  enum wire values that differ from their source member names.
- Added advisory `A11` with a mechanical fix from redundant
  `?field={field:type}` mappings to `?{field:type}`; distinct wire-name aliases
  remain explicit.
- Made route declarations use the function-like `@get(path=pattern, ...)`
  contract. Required and optional query inputs are checked before the handler,
  while repeated low-level query values remain explicitly available through
  `Request.queryAll`.

### Responses and failures

- Added semantic `HttpOutcome` values and one application-wide `@response`
  policy. Plain Data, `created`, `noContent`, route failures, validation
  failures, 404, and 405 now pass through the same policy exactly once.
- Added structured `HttpProblem` failures and RFC 9457-style
  `application/problem+json` defaults with stable codes. Final `json`, `text`,
  `file`, `stream`, `sse`, and `redirect` responses stay explicit and bypass a
  second policy pass.
- Unified content negotiation, framework-generated failures, OpenAPI failure
  schemas, native transport responses, and isolated-host responses around the
  same response contract.

### Tooling and documentation

- Added parser, analyzer, emitter, semantic-token, Hover, cross-module, runtime,
  OpenAPI, failure-policy, and transport coverage for the server model.
- Updated the language guide, standard library reference, Node and Server
  skills, project template, and executable tour to teach the same contract.

## 0.16.2 — 2026-08-26

### Language and diagnostics

- Added concrete record `Target.mapFrom(source, transform)` projection. It
  traverses the target record's declared fields once, reads the same-name
  typed source fields, and builds the target record without an intermediate
  dynamic record or validation round trip.
- Added advisory A10 for large, complete record literals that repeat one
  transform over every same-name source field. Its mechanical fix uses
  `Target.mapFrom(...)` only when target coverage and evaluation order are
  proven equivalent.

### Compiler correctness

- Preserved canonical generic record identities through re-exported aliases,
  including readonly views used across package boundaries.
- Made runtime validation of generic record aliases call the alias type object
  instead of emitting a helper name that only concrete type declarations own.

## 0.16.1 — 2026-08-26

### Language and compiler

- Added `Map.iterator()` with an incremental `next() -> {value: K}?` key
  cursor. It preserves live insertion order, distinguishes a legal `null` key
  from exhaustion, and avoids materializing the full `keys()` snapshot.
- Made parser and analyzed-AST nesting use the same explicit 256-level budget.
  Result inference now reports `VEL2038` when its fixed-point pass budget does
  not settle, while an unmetered compiler stack overflow reports the internal
  error `VEL9001` instead of blaming source complexity.

### Runtime

- Lowered Map cursors through the captured native key iterator in standalone
  and shared project runtimes. Cursor and item records are frozen, and later
  JavaScript global or prototype replacement cannot redirect `next()`.

## 0.16.0 — 2026-08-26

### Language and diagnostics

- Added mutable `Map.getOrSet(key, fallback) -> V` for linear grouping and
  cache construction without weakening stale-flow validation.
- Consolidated each unsupported Unicode source run into one lexer diagnostic
  while preserving recovery for independent errors later in the module.
- Named compiler-owned `@name` roles consistently as context annotations and
  kept their vocabulary closed to the active syntax owner.

### Build output and tooling

- Added target-neutral `production` and `readable` JavaScript build modes.
  Production is the default for every target; readable output remains the
  explicit, toolchain-independent handover form.
- Made Source Map emission independent from JavaScript mode through top-level
  project configuration and command-line overrides, while frozen ABI library
  maps remain mandatory.
- Made package manifests and build adapters reject target-owned configuration
  outside its owning extension and added exact dependency-boundary checks for
  every published workspace package.

### Runtime and performance

- Made safe-integer `range` loop validation constant-time and removed unused
  runtime modules, empty imports, type-only imports, and uncalled helper bodies
  from generated JavaScript.
- Specialized trusted fixed numeric-buffer indexing and stable readonly
  optional copies without weakening validation of host or mutable values.
- Moved the registry-backed reactive bridge into the Web package. Compiler and
  Core retain only the target-neutral private ABI and static non-reactive
  implementation, with a permanent native-JavaScript hot-loop parity gate.

## 0.15.0 — 2026-08-25

### Language syntax

- Added the compiler-owned module entry region `@main:`. It supports both a
  single inline statement and an indented block, must be the final top-level
  region, and may appear only once per module. Its declarations remain local,
  and `return`, `export`, and direct calls to the region are rejected.
- Project compilation now executes `@main` only for the selected program or
  worker entry. Imported modules are still parsed and checked, but their entry
  bodies are not emitted or run. Test modules continue to use named `test`
  declarations instead of an entry region.
- Added indented leading binary-operator continuation. The formatter preserves
  the expression and emits a canonical continuation indentation.

### Tooling and project compilation

- Project graphs now record execution entries and invalidate affected modules
  when an entry role changes.
- Language Server hover, semantic tokens, formatting, project templates, the
  tour, and language documentation now understand and demonstrate `@main`.

## 0.14.9 — 2026-08-25

### Node Standard API

- Added `velar/hash.sha256Text(text)` for deterministic build tooling. It hashes
  at most 16 MiB of UTF-8 text with SHA-256 and returns exactly 64 lowercase
  hexadecimal characters without exposing Node.js's mutable `Hash` object.
- Node's unavailable-global guidance now directs text-digest consumers to
  `velar/hash`, while identifiers and reproducible random streams keep their
  separate `velar/id` and `velar/random` contracts.

## 0.14.8 — 2026-08-25

### Embedded JavaScript

- Checked JavaScript blocks with no captures may use the compact `extern js`
  header. Formatting rewrites the equivalent `extern js()` spelling to this
  canonical form; capture-bearing blocks continue to use parentheses.

## 0.14.7 — 2026-08-25

### Language semantics and diagnostics

- Record fields may use the ordinary member spelling `none` without triggering
  the retired empty-value diagnostic; `none` remains unavailable as a value or
  type binding.

## 0.14.6 — 2026-08-25

### Node language tooling

- Path-pattern captures such as `{worldId:string}` now publish separate
  parameter and type semantic tokens, so editors do not render the declaration
  as undifferentiated string content.

## 0.14.5 — 2026-08-25

### Language tooling and documentation

- Added a compiler-owned syntax-documentation index so Hover resolves special
  forms only at positions the active compiler extension actually parsed.
- Added explanatory Hover content with legal examples and constraints for Core
  class roles, Node `server` routes and `p` patterns, Web lifecycle and reactive
  declarations, Look states and targets, and checked JSX directives.

## 0.14.4 — 2026-08-24

### Language semantics and diagnostics

- Added editor quick fixes for the exact A7 collection conversion, A8
  `List.some` query, and A9 record projection advisories. A fix is withheld
  whenever collapsing the longer form could erase an authored comment.

### Tooling and editor support

- Split Server extension semantic tokens by role: `server` is a language
  keyword, route annotations such as `@get` are decorators, and the `p` path
  prefix keeps its ordinary syntax color.
- Made one simple executable statement the canonical compact suite: short
  blocks format as `if ready: run()`, while a complete line over 120 columns
  expands back to the indented form.

## 0.14.3 — 2026-08-24

### Server application framework

- Added `authenticate(credential, verify)` to the explicit Server extension.
  It accepts only checked `security` descriptors, requires a nullable async
  verifier, injects the verified identity through a request-scoped Provider,
  and turns rejected credentials into the same opaque 401 challenge used by
  Node's transport parser. Identity records, authorization policy, sessions,
  token algorithms, and provider integrations remain application or installed
  library responsibilities.

### Tooling and editor support

- Added compiler-extension semantic syntax tokens so language-server clients
  can highlight Server declarations, route roles, and typed path prefixes.

## 0.14.2 — 2026-08-24

### Language syntax

- Generalized the compact branch spelling into Python-shaped suites: ordinary
  executable blocks may keep one non-block statement after the colon, while
  multiple statements and nested blocks remain indentation-owned.

### Language semantics and diagnostics

- Added `Target.from(source, overrides?)` for compiler-checked, target-owned
  record projection that copies only declared target fields and keeps untrusted
  data validation at the existing `Type.parse` boundary.
- Added the exact A7–A9 canonical-form advisories for identity-only collection
  conversions, pure early-return `List.some` queries, and closed record
  projections. Wider, effectful, or ambiguous forms remain accepted and silent.
- Added bounded `values()` snapshots to fixed numeric buffers, returning one
  independent `List<number>` across every supported numeric width.

### Library distribution

- Added frozen Vel library ABI 1 artifacts: published Core and Node libraries
  can now ship readable source together with hashed JavaScript, source maps,
  portable interfaces, and receipts that later toolchains load without
  recompiling the original source.

## 0.14.1 — 2026-08-24

### Language syntax

- Added compact single-statement branches for `if`, `else if`, `else`, and
  `match case`, while keeping multiple or nested statements indentation-owned.

## 0.14.0 — 2026-08-24

### Server application framework

- Split convention-based server application assembly from the low-level Node
  capability into the explicitly activated `@velarscript/server` extension.
  Root `application.yml` is now the sole conventional runtime configuration
  name and owns host, port, and request-body settings, while `velar.json`
  retains only build and entry selection. Explicit configuration paths may
  still use YAML or JSON.
- Added typed YAML/JSON configuration loading, zero-argument application
  factories, and a generic application-scoped connection lifecycle. Concrete
  database connections, drivers, models, queries, and migrations remain
  application-owned dependencies.

## 0.13.0 — 2026-08-23

### Language semantics and diagnostics

- Added non-blocking advisories for accepted JavaScript and Python reflexes
  whose VelarScript meaning differs, with exact, reasoned `velar-allow`
  suppressions and compile errors for bare, blanket, or stale suppressions.
- Made watch execution follow source, mount, and module-initialization order,
  while preserving fixed-point `computed` settlement before one DOM commit.
  Watch subjects are now explicit state or computed read paths, and the
  duplicate `cached` derived-value spelling has been removed.
- Made foreign and host values enter as `unknown` instead of `any`, rejected
  `any` across exported surfaces, and added async `@iterate` declarations.
- Removed the always-true `HttpResponse.ok` field across Web, Node, and Desktop;
  non-2xx responses remain explicit `HttpResponseError` failures. WebSocket
  clients now use `velar/websocket`, while `velar/realtime` owns event streams.
- Made `Type.parse` return stable validated copies, closed annotated record
  literals, fenced NaN across numeric and collection operations, and aligned
  strings and line boundaries with Unicode code points and all VelarScript line
  endings.

### Compiler, runtime, and tooling

- Closed the 205 confirmed findings from the D90 audit across parsing,
  analysis, emission, formatting, diagnostics, runtimes, and target tooling,
  including indirect aliases, exported class methods, composed route overlap,
  deterministic artifact ordering, and release-version identity checks.
- Hardened build-output ownership, source fixing, local development admission,
  HTTP and static-file boundaries, browser and Desktop navigation, worker
  transport recovery, and package/runtime generation checks.
- Removed super-linear lexer, nested interpolation, flow-analysis, and
  assignability paths, and added focused regression and performance coverage
  for the repaired classes of defect.
- Prevented required `children` presence checks from constructing the slot
  before its rendered position, so resources and other owned child content are
  initialized exactly once.
- Added one `release:check` entry point, stopped compiling example projects
  twice, and split the Node tests into a release-default quick suite and an
  explicit `test:full` historical hardening suite. The browser gate is now one
  platform and Chromium; development and CSP production paths remain covered,
  and the packed-toolchain smoke exercises one representative generated app.

### Node server framework

- Added exact WebSocket Origin admission on shared HTTP/WebSocket listeners.
  Browser upgrades are denied by default, rejected with 403 before connection
  admission, and may use an explicit exact-origin list or `"*"` policy.
- Allowed `node.app` to name a strictly typed WebSocket startup function so
  development, serve, and standalone production builds use the same configured
  host, port, request-body ceiling, HTTP application, and WebSocket listener.

### Repository ownership

- Removed database contracts, concrete drivers, codecs, algorithms, editor
  components, and provider integrations from the language repository. These
  are application-owned dependencies; permanent gates prevent them from
  returning as toolchain or framework dependencies.

## 0.12.1 — 2026-08-20

### Node server framework

- Added one application-level `@notFound` fallback for unmatched request paths,
  while preserving route-owned errors, method-not-allowed handling, middleware,
  lifecycle, and the bounded default 404 response.

## 0.12.0 — 2026-08-20

### Node server framework

- Added compiler-owned anonymous route declarations, typed path-pattern
  parameters, request inputs, providers, middleware, lifespan hooks, OpenAPI,
  security helpers, in-process server tests, graceful shutdown, and bounded
  WebSocket servers to the Node target.
- Kept `@` as one compiler-metadata namespace rather than turning routes into
  runtime decorators, and kept path-pattern strings owned by Node rather than
  changing Core string semantics.

### Package and capability boundaries

- Extracted the target-neutral Standard API into `@velarscript/core`; CLI now
  composes Core and explicit targets rather than owning the language runtime.
- Required every source package to declare supported targets and host
  capabilities before its source can be compiled.
- Added the portable `@velarscript/database` model/query contract and kept the
  concrete SQLite worker implementation in the independent
  `@velarscript/sqlite` adapter.
- Split WebSocket ownership into a client-only Web surface and a Node
  client/server surface.

### Product and provider separation

- Removed product task orchestration, project transactions, and PTY tooling
  from the Desktop language framework and application-package ABI.
- Moved Netlify projection into independently versioned
  `@velarscript/netlify`, leaving verified static output provider-neutral.
- Added independent ecosystem package rehearsal and provenance publication
  workflows, plus owner-specific Core, Web, Node, Desktop, adapter, and
  integration agent guides.

## 0.11.1 — 2026-08-20

### Framework-free JSON resources

- Framework-free builds now rewrite checked JSON resource imports to their
  generated output wrappers, so a source package's own npm self-reference
  cannot redirect built code back to the unwrapped source JSON export.

## 0.11.0 — 2026-08-20

### Package JSON resources

- Added `import json value from "specifier"` as a checked resource boundary;
  imported values are `unknown` and require explicit Runtime Type validation.
- Added exact `package.json#velar.resources` declarations aligned with npm
  subpath exports, including containment, symlink, size, and JSON validation.
- Unified JSON resource watching, serving, bundling, copying, and test-sandbox
  exports across `check`, `run`, `test`, `dev`, and `build`.

### Source-library ownership

- Moved the pure VelarScript `text-buffer` and `script-analysis` libraries from
  the toolchain implementation directory into a distinct `libraries/` layer.
- Restored the toolchain release set to compiler, Node, Web, Desktop, creator,
  and CLI; source libraries retain independent versions while remaining part
  of packed workspace consumer validation.
- Made the CLI language-service build resolve its pinned installed
  `script-analysis` package instead of reaching into a repository-relative
  source directory.

## 0.10.4 — 2026-08-19

### Inherited runtime validation

- Fixed derived record validators losing runtime type dependencies owned by an
  imported base record, including dependencies reached through multiple levels
  of inheritance.
- Kept `.is`, `.parse`, flow narrowing, test compilation, and production builds
  aligned for inherited fields while preserving derived validation paths.

### Collection runtime performance

- Specialized statically typed List, Set, Map, and Record operations onto their
  exact runtime helpers instead of paying repeated dynamic-kind dispatch.
- Split collection lowering, captured host operations, and reactive bridging so
  project output imports only the runtime fragments and named operations it uses.

## 0.10.3 — 2026-08-19

### Runtime record alias validation

- Fixed imported record aliases used as record fields being accepted by static
  analysis but rejected by runtime `is` and `parse` validation.
- Preserved runtime validators for aliases to ordinary and inherited records,
  including nested `List<Alias>` fields and flow narrowing.
- Added a fail-closed emission regression gate so a legal imported alias cannot
  silently lower to a constant `false` validator again.

## 0.10.2 — 2026-08-19

### Record inheritance

- Added single inheritance for structural record declarations with
  `type Child extends Parent:`.
- Inherited fields retain their original types and `readonly` contracts, and
  participate in the child type's static surface and runtime `is`/`parse`
  validation without introducing a JavaScript prototype or nominal subtype.
- Supported local, imported, aliased, forward-declared, and applied generic
  record bases while rejecting inherited-field redeclarations, invalid bases,
  and direct, indirect, alias-mediated, or cross-module inheritance cycles.

## 0.10.1 — 2026-08-19

VelarScript 0.10.1 is the first public npm registry release. It keeps the
0.10 compiler-extension contract and publishes the compiler, Node runtime,
Web and Desktop frameworks, project creator, CLI, text buffer, and script
analysis as one exact, version-locked generation.

### Binary data and structured concurrency

- Added target-neutral `Bytes`, fixed numeric buffers, bounded builders,
  byte-order conversion, checked bitwise operations, and allocation-free
  compiler lowering for direct `range(...)` loops.
- Added deterministic random/noise streams, owned Tasks and Worker pools,
  cancellation and timeouts, transfer-safe checked messages, and bounded
  queue/backpressure behavior.
- Carried binary payloads through Node and Web HTTP, WebSocket, filesystem,
  SQLite, IndexedDB, MessagePack, and compression boundaries with the same
  64 MiB contract and fail-closed handling for hostile compressed input.
- Added a cross-target acceptance project that produces byte-identical data
  in Node and browser Workers and verifies persistence, cancellation,
  transport, backpressure, and cleanup behavior.

### Toolchain and release reliability

- Replaced hand-maintained module dependency switches with structural
  traversal, closing missed imports inside `try`, `using`, tests, getters,
  disposal hooks, and iteration hooks.
- Made package, documentation, tour, browser-readiness, and cross-platform
  gates prove the surfaces they report instead of accepting partial coverage.
- Added durable, permission-aware Desktop project transactions and kept the
  native worker, compiler extension, and installed package contracts aligned.
- Hardened worker, process, terminal, source-map, browser-module, and
  cross-platform path behavior uncovered by the release audit.

## 0.10.0 — 2026-08-16

VelarScript 0.10.0 is the first public source release: a checked, Web-first
language for people who already think in JavaScript and Python, shipped as one
version-locked set of eight packages: compiler, Node runtime, Web and Desktop
frameworks, project creator, CLI, text buffer, and script analysis.

### The reactive grid: `computed` is a declaration, and the function is `cached`

`computed name = expression` now stands beside `state name = value`, and the
`computed(...)` **function is renamed `cached(...)`**. The function is not
retired — it remains a way to cache a value rather than declare one — but a
derived binding is declared, never assigned from a call.

The reason is a defect the owner reported twice, from two directions, without
knowing they were the same defect:

- `const doubled = count * 2` in component setup compiled clean and then never
  updated. `const` freezes, which is precisely what `const` means.
- `const total = computed(() => …)` followed by `watch total:` compiled clean,
  exited 0, emitted no diagnostic — and the watch body could never run. The
  correct spelling was `watch total():`, and the language's own tests had the
  parentheses while nothing said so.

Both trace to one asymmetry: `state` was a declaration and `computed` was a
function, so every derived value had to be parked in a `const` — and `const`
is the thing that freezes reactive reads. The grid now has four cells that
each mean one thing: `let`/`const` are not reactive, `state`/`computed` are,
and within each pair one is written and one is derived. Fixing the spelling
removed the diagnostics that would otherwise have been needed to teach around
it, which is the order this project prefers: a design fix beats a diagnostic
fix, because the diagnostic only teaches after the mistake.

Migration is mechanical and `velar fix` carries it, including across module
boundaries: `const x = computed(() => E)` becomes `computed x = E`, and reads
lose their parentheses only when every read in the module is a plain `x()`.

- **VEL5063** answers the three shapes that survive a half-migrated project:
  `x()` on a computed value (*"it is read bare like state"*), assignment to a
  computed value (which names the `state` spelling that is written instead),
  and assignment to a computed value **imported** from another module, which
  cannot name a local fix and so names the export that would work.
- **VEL5064** refuses a `watch` subject that can never change, naming the
  reactive sources that can: *"This watch subject never changes, so its body
  can never run … watch a 'state', a 'computed', a prop, or a resource field,
  or move these statements to where they should run."* A bare `5` was already
  a compile error (VEL4030); `watch 5:` with a whole block behind it was the
  same rule failing to reach one position. The subject is refused only where
  the compile can *prove* nothing behind it moves, so a call whose reactivity
  lives in another module is left alone.
- The frozen snapshot itself is reported at development time by the runtime,
  and it fires **when the source diverges from the snapshot, never when the
  snapshot is taken** — taking a snapshot on purpose is legitimate, and a
  warning that fires on correct code is one people learn to ignore. The whole
  mechanism installs only when the development host publishes its hooks, so a
  production build pays nothing: no map, no stack capture.

### Component props are mutable by default

A prop is a handle to reactive state, and refusing to write through it forced
callers into ceremony that fought the way the rest of the language reads.
Props now accept assignment; a component that needs the old guarantee writes
`readonly` on the field, and only those props receive readonly-specific
guidance. This aligns a prop with every other reactive value rather than
making it the one exception, and the choice of which contract to offer now
belongs to the component's author.

### Generic types

`type Box<T>`, `type Pair<A, B>`, `type Sorted<T: Comparable>`, and recursive
forms like `type Tree<T>` are available on records and aliases. A readonly
field is covariant and a mutable one is invariant, so variance follows from
what the field already says rather than from a separate annotation.

**Generic classes are deliberately not in this release.** The evaluation found
that `Stack<number>()` has no spelling in today's grammar — five candidate
paths were measured and all five are closed — and shipping a type that can be
declared but not constructed is worse than shipping nothing. The decision that
unblocks them is recorded, and it is larger than generic classes: annotations
will flow into generic call-site inference, which also fixes
`const names: List<string> = empty()`.

### Inline foreign source

JavaScript and CSS can be written inline against a checked contract:
`extern js(captures)` with a backtick block declares a typed boundary, and
`unsafe js` admits an unchecked one. `unsafe css` does the same for styling
and is owned by the Web extension rather than Core — Core does not know what
CSS is, and putting a `css` keyword in it to save a file would have spent that
boundary for convenience.

An inline block is **more checked** than the `import js unsafe` it replaces,
not less: the contract sits three lines below the source, where an entire
module going implicitly `any` is invisible. The data-URL spelling that used to
be the only way to write a module inline now gets a mechanical rewrite to the
block form, which is source-mapped.

A block with captures does not support top-level `await`. That is a decision,
not a gap, and the conditions under which it would be revisited are recorded.

### Classes can say what iterating them means

`@iterate:` gives a class a definition for iteration, so a user type takes part
in the same loops the built-in collections do instead of exposing an internal
list to be iterated on its behalf.

### Web surface

- Element geometry and computed styles are readable through a controlled
  surface — `measure(panel)` and its siblings — rather than through an escape
  hatch. The framing that settled it: this is a library surface, not the
  language, so it does not carry the language's strictness burden.
- `aria-*` booleans render as literal `true`/`false`, which is what ARIA
  actually specifies; the previous rendering was silently wrong for assistive
  technology.
- **Every Look property that accepts keywords now carries its own closed set.**
  A diagnostic used to say *"use one of the closed fontWeight keywords"* when
  `fontWeight` had no closed set to point at — publishing an unreachable table
  is the same defect as publishing an unreachable name. A refused Look value
  now names the values that property really takes, leading with the property's
  own vocabulary and keeping the five CSS-wide keywords separate. The
  invariant is enforced for every value kind that closes over strings, not
  only the one kind where it was first found, and `transitionProperty`'s
  vocabulary is now derived from the Look property table rather than listed by
  hand — it previously accepted only the generic defaults, so no property name
  was writable.
- **VEL5065**: a Web module publishes its own type names, and declaring one
  used to be accepted at the declaration and then lose at every use — `type
  Event:` compiled, and the first use was told it could not assign to `Event`,
  naming a type the author had just written. The refusal now lands on the
  declaration, which is the only place a rename is cheap.
- A module no longer emits type checks against bindings it does not have.

### Spelling

- The `Look.` prefix is retired; `Math` joins the permanent namespaces, which
  are vocabulary rather than values and are legal only as the head of a member
  access.
- Single quotes are retired in JSX attributes.
- Imports return to the named form.
- `-> null` is written only where it cannot be inferred; a body-backed
  declaration that returns nothing omits it.
- A type position that receives `=>` is taught `->` instead of being told the
  syntax is wrong.
- `velar fix` withholds a mechanical rewrite when the body returns a value,
  because the rewrite would not be provably equivalent there.

### Tests

`toBe` and `toContain` use the language's own equality rather than
JavaScript's, so a test agrees with the `==` the author would have written.

### What an adversarial audit found

A ten-track audit was run against the language before this release, briefed to
attack rather than assess and to record for each finding *which gate should
have caught it*. It produced 26 entries, five of them the highest-value kind:
compiled clean, no diagnostic, wrong answer.

- **A dynamic import inside `try`, `using`, a test body, a class getter,
  `@dispose`, or `@iterate` was left out of the module graph.**
  `try await import("./dep.vel")` answered `false` for a module that exists,
  with a clean check and exit 0; the other positions surfaced as a runtime
  module-not-found. Dependency discovery had a hand-written second walk over
  node kinds, which had already drifted past `@iterate` on the day it shipped.
  It is now a structural descent that never asks what a node is, the same
  duplicated walk is gone from the extension protocol, and the regression is a
  matrix of every expression position in the corpus rather than one example.
- **A CSS filename containing a legal `)` walked past the relative-address
  gate** and shipped a stylesheet whose address resolves one directory from the
  asset — measured as a live 404. The same regex refused `content:
  "url(./x.svg)"`, which is text. Both came from a regex standing in for CSS
  grammar; the scanner now tokenizes, which surfaced twenty more wrong shapes
  in both directions, and the `@import` check — a second scanner in the same
  file with lower coverage — reads the same token stream.
- **Three gates claimed more coverage than they had.** The documentation gate's
  fence extractor was a regex rather than CommonMark, so legal fences were
  silently skipped under a report that every block had compiled; the tour
  coverage gate counted a named import as usage, so deleting the only call to a
  name still reported full coverage; and the package gate derived its pack list
  while leaving the content check and clean-install hand-written. A gate that
  overstates its own reach is worse than a missing gate, because it is trusted.

### Corpus, gates, and documentation

- **`examples/` is retired.** Seven legacy directories and four loose files
  are replaced by a 38-chapter usage tour (20 Core, 14 Web, 4 Desktop) and one
  real application. The tour is not illustration: it is **gate corpus**, and
  writing the Web and Desktop chapters alone produced ten findings — two of
  them a class above the rest, because they are the tools breaking what the
  tools promise. `velar format` turned compiling source into source that no
  longer compiled, on the one-line reflow path the charter documents by name;
  the regression now pins the invariant rather than the shape, so source that
  compiles must still compile after formatting. And an exported
  `type X = Component<Signature>` passed `velar check` on two modules and then
  failed `velar build`, because the emitter wrote Vel type syntax into
  JavaScript — a clean check is a contract, and passing check then failing
  build is worse than failing check, because by then the author has believed
  it.
- A gate now requires the tour to cover the language surface, reading the
  compiler's own tables at run time rather than a list maintained beside them.
- A gate audits what each standard module's runtime actually exports against
  what it declares. It audits **one extension at a time**, because merging
  them let Desktop's `velar/fs` mask Node's — the merged form reported 30
  surfaces where there were 36.
- The publishable package set is derived from `packages/*`, reading each
  manifest's own private flag, so a new package joins the toolchain the day it
  exists. The two literal copies it replaces were both correct — the failure
  happened outside the repository, where a brief transcribed a truncated view
  of one of them and shipped six names instead of eight. A list somebody has
  to read and retype is a list somebody eventually gets wrong. Wiring it up
  also revealed that `test:packages` had been red since `velar/collections`
  stopped exporting `range`, because that gate is in CI but was not in the
  three-command sequence being run by hand.
- `check:docs` now compiles every root README rather than only the English
  one, and **prints what it could not fully check** instead of reporting a
  clean pass over a partial scan.
- Ten instances of one defect family — a name list maintained by hand beside
  the authority it was copied from — were replaced by derivation. Core's
  contextual keywords had four copies; they now have one original.
- The user-facing documentation is rewritten for someone arriving rather than
  for the marathon: a shorter README, a new getting-started guide, a new
  language reference in reading order, a rewritten best-practices guide with
  one complete program per rule, and a CLI reference grouped by task.
- `docs/handoff/` becomes `docs/decisions/`, with process artifacts moved to
  an archive and an index that says what each ruling settled.

### Final hardening and language surface

- `IndexError` was unreachable from every CLI path — the class existed but
  was missing from the shared-runtime export list, so `error.code` read
  `Error` while the program's own `catch` swallowed a `ReferenceError` and
  ran recovery against the wrong error. Every existing test sat on the
  standalone compile path, so the gate was blind by construction; the new
  regression is project-level, and a sweep confirmed this was the only
  unexported runtime name.
- `unknown` no longer satisfies every type bound, which had let a record
  reach a `toString` hook through a `<T: Text>` parameter. An owned
  resource may not escape its scope; a derived `@dispose` now runs the
  base's release after its own instead of silently replacing it; `using`
  over an unsafe JavaScript value is rejected with the composition
  spelling that works instead of degrading to a plain `const`; and `try`
  stops swallowing the compiler's own integrity guards, so an assertion,
  narrowing, or index failure can no longer disguise itself as an expected
  absence.
- Permanent namespaces are vocabulary, not values: `Json` and its siblings
  are legal only as the head of a member access, which closes a spread
  that crashed at runtime, a destructuring spelling that revived retired
  names, and an export alias. An `Error` subclass can no longer redeclare
  `name`, `code`, `message`, `stack`, or `cause` — redeclaring `name` had
  been enough to forge `code` — and a host error reports `code = "Error"`
  rather than a name JavaScript can set. The bidirectional-control ban
  covers all twelve control points, and the test reporter escapes author
  text before printing it, so a test name can no longer render its own
  verdict backwards.
- The test runners can no longer report green around a failure. The
  browser runner never watched the host error channel — a browser test
  body runs in the worker, so `mount(...)` failing there printed and
  passed — and the Node runner's fixed 20ms straggler window dropped any
  failure that landed late, against its own comment's promise. The
  unowned-error stance now lives in one shared module both runners
  consume, verdicts wait for event-loop quiescence (which also attributes
  a late failure to the test that started it), the Node runner gains a
  per-test timeout, and compiled stacks map back to `.vel` sources. The
  enumeration of every path a failure can take to a human — 16 in the
  Node runner, 23 in the browser runner — is recorded, each verified.
- The blind-test discoverability gaps close: DOM globals inside a
  `.browser.test.vel` point at `velar/web-test` instead of the wrong
  door, the skill brief carries a runnable browser-test recipe, the first
  storage diagnostic teaches a complete working read (storage already
  parses internally — the five-guess chain was hand-rolling it), and a
  refused readonly component prop names the helper signature that would
  accept it.
- Narrowing gets six long-standing gaps closed: `flag == true` narrows a
  `bool?` the way an enum comparison already did, a non-null optional chain
  proves every link was present, a `while` that cannot `break` keeps its
  condition's negated facts (as the union of what the entry and back-edge
  tests prove), facts cross the `break` edge of a `while true:`, a useless
  check on a getter is reported where it stands and teaches the `const`
  binding rather than `?.`, and a membership test carries its fact back.
  A pre-existing soundness gap fell out of the work: a write cleared only
  the innermost narrowed shadow, so a loop that narrowed a name its body
  assigned kept a falsified fact past the loop — clean at compile time and
  a `NarrowingError` at runtime.
- `Text.normalize` closes the Unicode-normalization trap: two strings that
  render identically compared unequal, sized differently, and missed each
  other as Map keys, and macOS filenames arrive decomposed. Equality is
  code-point-sequence identity, so normalize at the boundary.
- `import type` is not part of VelarScript and now teaches why: Vel does
  not erase types — a type carries its runtime validator — so a type
  import is an ordinary import. The form is recognized and rewritten by
  `velar fix` rather than met with a parse error.
- The diagnostic backlog that wave N-3 silently dropped is closed —
  seventeen items including three approved rulings. `self` in a field
  initializer or static method, extending an extern class, `readonly` on a
  method, a setter, an optional-field annotation, unit spellings in a Core
  file, and a plain import of a JavaScript-only package each get one
  directed message instead of a cascade or a wrong suggestion. Override
  invariance, the injected field-read guards, `unknown` as the end of
  static promises, extern arguments being read-only, and the re-validation
  cost of a narrowed read are now written down.
- Side-effect imports are rejected in both spellings: a module's effects
  must be visible where they happen, so export a function and call it. An
  import that hides what it does is the same problem as a decorator that
  changes what a declaration means.
- `toEqual` in `velar/test` is now the language's own `equals`, not a second
  implementation that disagreed with it on NaN and on Sets of records — an
  assertion that answers differently from the language it tests is the worst
  trap a test framework can carry. A boundary invariant keeps a second
  comparison from reappearing. Namespace imports of retired modules get the
  same migration diagnostic their named imports already had, and the file
  watcher's arming semantics are documented: it reports only changes that
  happen after it starts.
- Errors are discriminable by class, and `error.code` is that class's name —
  one taxonomy with a string projection rather than a parallel code table.
  Five environment failures that a caller recovers from differently get
  their own classes (`FileNotFoundError`, `PermissionError`,
  `NotADirectoryError`, `FileExistsError`, `AddressInUseError`, the
  filesystem ones carrying `path`); the hundreds of argument and protocol
  violations whose only recovery is fixing the code get none. Reading
  `code` cannot pick up a host's `ENOENT`-style value by accident.
- `Text.` joins `Json.`, `Promise.`, and `Look.` as a permanent namespace,
  carrying the pure text toolkit with no import — the core string method
  table is unchanged — and `Json` completes with `tryParse` and
  `isSerializable`. `Json.deepEqual` is gone: measured against `equals` it
  was weaker or wrong in four ways, including answering `false` for two
  identical deep structures.
- Four language features land together. A generic function can now say what
  its type parameter must support — `def label<T: Text>(value: T)` — from a
  closed vocabulary of three compiler-owned bounds, so a body that orders,
  interpolates, or serializes its parameter is finally writable. `using`
  binds a resource whose `@dispose` runs when the scope exits, in reverse
  order, on every exit path including throws; a component body rejects it
  and teaches `@cleanup:`, because a component ends at unmount rather than
  at its last statement. `try` becomes an expression, and tests are written
  `test "the name you want in the report":` — the `def test_*` spelling
  retires.
- `velar fix` applies the mechanical corrections: a diagnostic now carries
  its own replacement where one is provably equivalent, so the command,
  the editor quick fix, and the message all come from one source instead
  of the language server re-deriving rewrites from message text. Fixes
  that would change meaning stay diagnostics — `substr` to `slice` moves
  a length to an end position, and `length` to `size` changes the counting
  unit, so both teach the difference rather than silently applying it.
- The formatter takes ownership of JSX it can see whole, packaging budget
  failures report their composition instead of only the total, and an
  uncaught error prints your `.vel` frames without Node's internal frames
  and banner (`--stack` restores the full trace).
- The statement-head words are contextual, not reserved: `type`, `match`,
  `from`, `as`, and the Web words `state`, `action`, `resource`, `watch`,
  `look`, `component`, `computed`, `mounted`, `cleanup`, `keyframes`,
  `expose` can all be ordinary binding, parameter, field, and argument
  names — and they now behave identically in Core and Web files, closing
  the portability break where the same line compiled in one and failed in
  the other. `case` and `enum` stay out of binding names alone, because
  JavaScript reserves them and the emitted output must keep the names you
  wrote. Component lifecycle hooks move to `@mounted:` and `@cleanup:`, so
  a component can carry both the hook and a method of the same name, and
  the generated-code prefix consolidates on `__velar`.
- Parallel async lands: `Promise.all` takes a record of promises and
  resolves the same shape (`{name, count}` in, `{name, count}` out), and
  `Promise.race` over a union of promise types keeps the union narrowable.
  Pure standard helpers become permanent namespaces needing no import —
  `Json.parse`/`stringify`/`stableStringify`/`clone`, the `Promise.*`
  family, and the Web `Look.*` builders — while capability modules like
  `velar/http` still require their explicit import, because reaching the
  outside world should be visible. The old member imports retire with
  migration diagnostics, and JavaScript's `JSON.`/`Object.`/`Math.`
  spellings get directed guidance.
- Durations are Core: `250ms` and `2s` are values with arithmetic, and
  `Promise.sleep`, `Promise.timeout`, `Promise.retry`, and the Web timers
  take them — a bare number is a type error that teaches the unit.
- Combinator losers no longer lose their failures: after `race`, `timeout`,
  or `all` settles, a later rejection from another input is reported
  through the detached channel instead of vanishing, and `map` stops
  claiming new items after the first failure. `Kind.is(raw)` and
  `User.is(raw)` now narrow in the true branch, so the open-protocol
  pattern is a first-class spelling, and an untyped exported `computed` is
  diagnosed at its export with the annotation to add rather than as
  `unknown` at every consumer.
- The documentation gate now analyzes every example, not just parses the
  fragments. Ninety-eight of the hundred and seventy-two examples were
  parse-checked only, which is how an illegal condition survived in
  web-api.md until a human sweep found it; fragments now run the same
  full project analysis as complete examples, with suppression limited to
  what is inherent to being a fragment — an unresolved name declared in
  the surrounding prose, a neighbouring module that exists only in the
  narrative — decided structurally by span and provenance rather than by
  matching message text. Seven real violations surfaced and are fixed.
  Examples that import Node-only modules are analyzed against the Core
  target instead of being failed by a Web-target mismatch.
- A Core project no longer has to declare an empty `extensions` list: the
  key may be absent, which is what the configuration diagnostic already
  promised and what previously produced a second, different error.
- The Desktop worker test suite can no longer freeze the gate. The hang
  that cost several runs was a macOS FSEvents arming race — a recursive
  watch started just before a write never receives that notification at
  all — sitting under a chain with no deadline anywhere: the worker's
  next-change pull is unbounded by design, the test harness had no
  per-call bound, and `node --test` defaulted to no timeout. Every wait
  now has a bound whose message names the operation, the worker, and the
  likely cause; the lost-notification case re-triggers instead of parking;
  three genuinely unbounded waits inside the Desktop host (the terminal
  ownership handshake and two child stdin frame writes) gained deadlines;
  and a failed terminal spawn no longer escalates a losing rejection into
  a host exit. A reclaim hook clears what a killed run leaves behind, with
  age floors that keep a concurrent suite safe.
- The documentation catches up with twenty waves of behavior. Newly
  written down where only the compiler knew: module initialization order
  (including that statements above an import still run after the
  dependency), dynamic import, the twelve-row operator precedence table,
  iteration order and mutation-during-iteration per collection family,
  the resource contract (props do not refetch; `watch` plus
  `async reload()` is the idiom), action concurrency, the `host` marker,
  fragments, `class:` toggles, event modifiers, cross-component Look
  precedence, what `any` actually means operationally, and the adapter
  module pattern for JavaScript packages. The skill brief gains a project
  setup section — the gap that cost the first blind test fourteen rework
  rounds. A cross-document sweep found and fixed ten prose
  contradictions, including one illegal example that the documentation
  gate had been accepting.
- Animation enters the language checked: `keyframes:` blocks with
  `from`/`to`/percent stops reuse the whole Look property machinery, the
  `animate(...)` builder is compile-checked with `loop=true` standing in
  for infinite, `animation` accepts only checked Animation values — the
  string form that browsers accepted and never ran is rejected toward the
  new form — and the browser regressions assert real rotation via
  getAnimations in all three engines.
- The Look property table is published with its inclusion principle: 225
  explicitly typed properties across fourteen families (up from 123, no
  stringType fallback anywhere), 36 documented exclusions with reasons,
  three-tier absence diagnostics with nearest-name suggestions, and the
  keyword-value tightening queued since D37 — `display = "flexx"`,
  `padding = "big"`, raw grid-template and gradient strings all reject
  toward their checked spellings.
- Unknown element names are compile errors with suggestions against a
  199-element HTML/SVG/MathML table; custom elements follow the WHATWG
  valid-name rule, and PascalCase stays component dispatch. Extension
  types gain text forms: `f"gap: {16px}"` and `str(16px)` render with
  units, closing the broken escape the unit audit recorded.
- Strings gain the backtick delimiter: `` `...` `` is the same string as
  `"..."` with inner double quotes unescaped, so the JSON fixture every
  test writes stops being an escape thicket. Prefixes compose across both
  delimiters, `${...}` stays literal text (generating JavaScript is a real
  use), and `velar format` normalizes the delimiter deterministically —
  double quotes unless the content argues otherwise. Single-quoted strings
  are no longer accepted; the diagnostic names both legal delimiters.
- Source hygiene: `\u{...}` writes any code point visibly (lone
  surrogates rejected), bidirectional control characters are banned raw
  everywhere in a source file — comments included — with the escape as the
  only entry, and raw C0/DEL controls inside literals teach their escapes.
  Emoji joiners and variation selectors are explicitly unaffected.
- Numeric literals: `1_000` separators land; leading zeros, `0x`/`0b`/`0o`
  radix forms, `.5`/`5.`, and bare `Infinity`/`NaN` each teach their one
  VelarScript spelling instead of cascading.
- A statement must have an effect: a bare comparison, literal, identifier,
  or other value-only expression line is rejected with its directed
  answer — `x == 5` alone on a line was silently doing nothing.
- Comparison chains point one way: `a < b <= c` stays legal, `==`/`!=`
  never chain (`a == b == c` silently meant Python's reading where
  JavaScript's differs — the highest-risk ambiguity the grammar audit
  found), and `in`/`is` inside a chain need parentheses or `and`.
- `/* */` block comments land with nesting and a whole-line discipline for
  multi-line forms. The retired `invert x` statement now steers to
  `x = not x`, and the enum-wire equality guidance states the deciding
  fact: `parse` throws on unknown values, so open wire protocols compare
  with `str(...)` deliberately.
- Look stops lying. A `look:` literal that reads component state is
  rejected at the read — it froze at declaration while looking exactly
  like the live forms — with `look={cond ? a : b}` and directive values
  taught as the two forms that update. Bare non-zero numbers no longer
  produce dead CSS (`width = 100` computed as `auto`; literal `0` stays
  legal), builder calls with literal arguments are range-checked at
  compile time, a component-scoped CSS import is rejected instead of
  silently discarded, `viewport`/`scheme`/`motion` are reserved names,
  `motion.reduced` joins the media vocabulary, and `animation` teaches
  the keyframes escape until the checked form lands.
- Forms bind deeper: `bind:value={form.name}` and `{items[0]}` accept
  writable reactive member paths, and `bind:group` lands for radio groups
  and checkbox Lists. JSX accepts `{name ?? <Fallback/>}`, teaches the
  ternary for `and`-rendering and the two comment attempts, diagnoses a
  static `key`, and keyword prop names collapse eleven-error cascades
  into one taught message.
- The module boundary hardens: imports, every export form, re-exports and
  extern modules are module-top-level-only statements instead of emitting
  invalid JavaScript from blocks; two path spellings of one file (case
  variants, links) are rejected instead of silently double-instantiating
  the module's state; a module can no longer import from itself past the
  cycle checker; and `velar check` prints module diagnostics alongside
  resolution failures, with the parser no longer fabricating the empty
  `invalid package name ''` dependency that used to hide them. Resolution
  failures gain diagnostic codes and import-statement spans, near-match
  suggestions, and unknown `velar/*` imports list the standard modules.
- `velar test` takes one stance on trust: any unowned error during a test
  — a detached failure, a module whose initialization touches the DOM in
  a headless run, an unhandled rejection — fails that test, and the
  runner continues. Previously the report printed while the suite stayed
  green. Configuration errors now teach a complete minimal web manifest
  including the `@velarscript/web` extension identity — the gap that cost
  the first blind test most of its rework.
- Ordered string comparison is code-point order everywhere — `<`,
  `sorted()`, `min`/`max`, and the `by=`/`sortBy` family agree with the
  language's code-point contract instead of leaking UTF-16 unit order on
  surrogate-bearing strings. Lists gain `flatMap`, Sets gain `union`,
  `intersection` and `difference`, `filter(x => x != null)` narrows the
  element type, and List position errors are uniformly `IndexError`.
  Spelling guidance now covers the Python column — `len(`, `strip`,
  `startswith`, `find` and friends teach their VelarScript spellings, and
  a format-spec `:` inside an f-string teaches `toFixed`/`padStart`
  instead of cascading.
- The bridge closes its edges: extern blocks own their import names (a
  typo is a check-time error, not a silent unknown), bare `import js`
  package specifiers resolve at check time in both directions, a broken
  `types` path fires the degradation notice, generic extern classes get a
  polite rejection, and a top-level sync throw of a non-Error value is
  normalized instead of reaching the host raw.
- The bare-string identity door closes on its last surfaces: Map and Set
  key types reject unions mixing different enums or enum with string, the
  membership vocabulary (`in`, `has`, `index`, `count`, `remove`,
  `Map.get`) requires the probe to intersect the element type, enum and
  string domains never meet in `==` even through union arms, and `is`
  between disjoint enum types is a compile error. A freshly constructed
  collection literal as an equality operand is rejected — it is never
  identical to anything — and the new prelude `equals(a, b)` provides deep
  structural comparison with SameValueZero leaves for the content
  question.
- Enums round out: `Status.values()` returns the members in declaration
  order, member access follows type aliases, keyword member names can be
  matched (`case S.null:`), a bare `pass` in an enum body is the
  placeholder rather than a member named pass, optional enum subjects get
  the same match exhaustiveness as bare ones, parenthesized member
  patterns keep their coverage credit, and match value patterns agree
  with `==` on NaN. `ValidationError`, `NarrowingError`, and `IndexError`
  are nameable and catchable, and validation failures name the first
  failing field and reason.
- Nested `is` emits correctly parenthesized checks (previously
  `(x is number) is bool` was wrong even with source parentheses, now a
  constant-test compile error), `await` on `any` and `any` in conditions
  are rejected toward validation, checked `Error` gains `cause`, error
  subclasses carry their declared `.name`, and `++i`/`i--`, stray
  semicolons, `|`/`&`/`^`, `function(){}`, and `:=` each teach their one
  VelarScript spelling.
- The standard library sheds its two editor-domain modules:
  `velar/javascript` and `velar/text-buffer` move out as installable
  packages (`@velarscript/script-analysis`, `@velarscript/text-buffer`),
  since `velar/*` is closed vocabulary limited to universal computation
  and capability primitives. The old imports get a directed migration
  diagnostic naming the package, the CLI's own language service consumes
  the package internally, and the install-import-run path for packages is
  now part of the gates. The publish set grows to eight packages.
- Importing `velar/app` no longer breaks reactivity. The runtime registry
  now owns its scheduler, so an application whose module graph stamps the
  registry from the generated `velar/app` module keeps every observed
  `computed` updating — previously one import line froze the DOM on the
  first state write, in development and production builds alike. The first
  velar/app browser regression pins it.
- A recursive `computed` detaches its dependency edges after the owned
  recursion error instead of storming the whole-flush budget, computed
  observers share the documented 100 self-invalidation cap, and an
  unhandled reactive failure during `velar test` fails that one test
  instead of killing the process. The no-blank-page promise now holds on
  all three paths — a dynamic-region failure during the initial render and
  a missing mount target both show the accessible fatal state instead of
  an empty page. A detached action failure reports exactly once, and a
  superseded action failure carries its detail.
- `readonly` accepts only pure data, at every depth. A class type anywhere
  inside a readonly-annotated shape rejects the declaration itself with
  the two ways out, so a readonly view can no longer hand back a freely
  mutable class instance — the promise never exceeds the enforcement.
  Component props follow the same rule: a bare class prop stays legal as a
  visibly behavioral value, while a class buried inside a data-shaped
  record prop is rejected. All twelve existing readonly sites were already
  pure data.
- Class methods live on the prototype, matching the documented lowering:
  instances no longer carry one bound closure per method, `print` shows
  data fields only, and reading a method as a value (`const f = a.read`)
  binds the receiver at the reference site exactly like collection
  methods. Private methods lower to native `#name()` methods.
- A class name is not a value. Calling it, reading statics, extending,
  type positions, `is`/`case` patterns, and re-exports stay legal;
  aliasing or passing the name itself is rejected with the arrow-factory
  spelling (`() => P()`) taught — aligning every class with the rules
  abstract classes already had.
- A match over a class hierarchy must be provably exhaustive, like an enum
  match: end with the subject's type, a base of it, or `case _:` — an open
  hierarchy can never be enumerated, so a silently skipped subject is now
  a compile error instead of nothing happening at runtime.
- The runtime narrowing guard for an imported record type is now the real
  validator instead of a presence check, so a fact staled across a module
  boundary throws `NarrowingError` at the read instead of silently
  delivering wrong-typed data or leaking a bare `TypeError`. The first
  multi-module narrowing regressions pin this — the entire previous suite
  was single-module, which is why the hole survived.
- Record validation accepts only plain data objects: a class instance, an
  `Error`, or any prototyped host object no longer satisfies `Type.is` or
  `Type.parse` (cross-realm plain objects still pass), so a validated
  record view can no longer alias a live class instance and write through
  its `const` fields. The failure hint teaches projecting the fields into
  a record.
- Assignment now establishes a narrowing fact: after
  `const x: string? = "a"` or `x = "a"`, the value is usable as a string
  without a redundant check, including when every branch of an
  `if`/`match`/`try` assigns one. Assigned facts refine reads but never
  make a later test constant, so `value == null` after a literal
  assignment stays legal. A member write invalidates only facts whose
  roots could alias the written path — writing an unrelated variable of a
  disjoint type no longer destroys narrowing.
- Classes close eight compile-to-crash holes: a `class` or `type` in a
  block is rejected at module scope (previously analyzed against the wrong
  shape — a `-> number` function could return a string with zero
  diagnostics, and a block `export class` emitted invalid JavaScript);
  constructor rest parameters are rejected (one spelling was uncallable,
  the other silently wrong); a `super(...)` call anywhere but the first
  statement is rejected; `new` through a narrowed callee parenthesizes
  correctly; a self-instantiating field initializer, a class name used
  before its declaration, and a base constructor observing an abstract or
  overridden member are all compile errors instead of runtime crashes.
- Equality requires the operand types to intersect. `1 == "1"`, a record
  against a string, and two members of different enums no longer compile —
  each was permanently false, which is a silent logical bug rather than the
  coercion bug strict equality was meant to remove. `value == null` on an
  optional is unaffected; enum against raw string is rejected too, so
  compare with `Kind.parse(raw) == Kind.textDelta` or drop to strings
  explicitly with `str(...)`.
- Enums are not ordered. `sorted()` on a List of enums returned members in
  alphabetical order of their runtime values — silently wrong for the common
  `low`/`normal`/`high` shape — so the sort paths now agree with direct
  comparison and reject enums and mixed-category unions. State the order
  explicitly with `sorted(by=rank)`, or use a string-backed enum whose
  values encode it. The four mechanisms that gave three different answers to
  "is this ordered" are now one.
- `pop(index=-1)` throws on an empty List or an out-of-range index, matching
  `[]` and Python, and `removeLast()` is removed as its duplicate. Drain a
  List with `while items.size > 0:` instead of testing the result for null.
- Reactive state no longer retains what it replaces. Replacing a state root
  releases its descendants transitively, so the idiomatic
  `settings = {...settings, field: next}` no longer keeps every previous
  version alive, and deep mutation cost stops growing with the number of
  replacements (3200 generations: 269µs per mutation to 1.15µs). Record
  field writes no longer probe collection identity by throwing, cutting
  them from 4.9µs to 0.4µs. Two watches that invalidate each other are now
  bounded and reported through the error channel instead of freezing the
  page silently, and a keyed re-render with identical keys leaves already
  positioned rows attached, so a focused input keeps focus and IME
  composition survives.
- The runtime boundary gate now covers the whole emitted Web runtime rather
  than three slices of it, with the old slices asserted to stay inside the
  covered span so coverage cannot silently shrink. Closing it surfaced and
  fixed a large set of replaceable-host-member uses across keyed
  reconciliation, look/class/style, events, form binding, and raw HTML.
- The text-conversion whitelist now covers `str` used as a value, not only
  as a direct call: `const convert = str` stays legal, while
  `convert(record)` and `map(str)` over a non-text List are type errors, so
  a record can no longer reach JavaScript string coercion and execute a
  `toString` hook. `Set.update()` publishes each added member, and `Set()`
  and `Map()` construction unwrap reactive values, so membership and key
  lookup agree with the documented contract instead of splitting on
  identity. A detached task whose failure report itself fails, and an
  `async` statement handed a foreign thenable, are both reported through the
  owned channel instead of ending the process.
- Module cycle diagnostics are corrected and entry-independent: a top-level
  call of an imported `def` is legal (functions are hoisted at link time), a
  cycle hidden behind a re-export barrel or a dynamic import is now caught,
  the language server and `velar check` give the same verdict on the same
  sources, and a module that leaves a cycle recovers its emitted output
  under incremental reuse instead of silently serving an empty module.
- Large speedups in emitted code, all covered by the new runtime gate: index
  reads on a list the compiler produced are now O(1) after one validation
  instead of O(n) per read (200,000 reads of a `range(0, 2000)` result:
  39.8s to 42ms), `Set` membership no longer pays a thrown-and-caught
  exception per call (190ms to 12ms per 200,000), `string.slice` takes the
  ASCII fast path its length counterpart already had (300 slices over a
  222,000 code-point corpus: 154ms to under 1ms), and `map`/`filter`/
  `sorted` drop roughly 40% of their per-element overhead.
- Equality is SameValueZero. `NaN == NaN` is now `true` and `x == x` always
  holds, so equality agrees with `Set`, `Map`, and `List` membership instead
  of contradicting them; `-0 == 0` stays true. Operands whose static types
  exclude numbers still lower to plain `===`. Numbers gain `isNaN()`,
  `isFinite()`, and `isInteger()`, and `sum`/`min`/`max`/`sorted` now throw
  on a NaN element rather than returning a poisoned or randomly ordered
  result.
- `case _:` is the only `match` fallback; `else:` inside `match` receives
  guidance. `invert x` is retired — write the ordinary `x = not x`, which is
  now legal and publishes reactive updates. Strings gain `isBlank()`, and
  `split("")` is documented as the per-code-point character split.
- Non-integer indexes are rejected by `List.get`, `List.pop`, and
  `string.char`, matching the strict siblings that already threw;
  out-of-range integer indexes still return `null` and negatives still count
  from the end. `Map` keys are unaffected.
- Discarding the result of a compiler-owned pure value or collection method
  is an error (`VEL4029`): `values.sorted()` as a statement did nothing and
  said nothing. Mutating members that return a value — `pop` and `remove` —
  remain valid statements.
- The toolchain now ships the AI skill brief. `velar skill` prints the
  agent-agnostic language brief to stdout; every generated project scaffolds
  an `AGENTS.md` pointing agents at it, the project gates, and the escape
  hatches; and permanent tests keep the packaged copy byte-identical to
  `docs/ai-skill.md`, under its size budget, and free of drift — every code
  fence in the brief compiles against the current compiler.
- The anti-lock-in exit is now gate-tested: the package acceptance copies a
  built application's emitted output into a bare directory and runs it with
  plain Node — no `@velarscript/*` packages present — proving the readable
  JavaScript exit works. `docs/escape-hatches.md` documents the full escape
  ladder, and `docs/why-velarscript.md` plus the README carry the mission
  and compatibility policy.
- Module initialization cycles are rejected at compile time (`VEL3019`). An
  initializer-position read of an import whose module has not evaluated yet
  under the project's module order — previously a clean compile followed by a
  raw `ReferenceError` at runtime — now diagnoses on the reading line with
  guidance to defer the read into a function or extract a third module.
  Function-body reads across module cycles and mutually recursive record
  types remain legal.
- F-strings and `str()` accept only text-convertible values: strings,
  numbers, bools, enums, and `null`, plus optionals and unions of those
  (`VEL4026`). Records, collections, functions, class instances, `unknown`,
  and `any` are rejected with guidance — `print(value)` to inspect,
  `stringify(value)` for data text. Previously a record interpolated as
  `[object Object]` and an own callable `toString` field was silently
  invoked, violating the conversion-hook ban that the rest of the runtime
  already enforces.
- A Promise-typed expression statement is now an error (`VEL4027`): `await`
  it, or run it detached with the new `async` statement. `async task()`
  requires a `Promise<null>` expression (`VEL4028` otherwise), executes
  detached, and owns its failure — the rejection is normalized and reported
  through the host error channel (stderr on Node without crashing the
  process; the `velar/app` error chain with a `detached` phase in the
  browser). Previously a forgotten `await` compiled silently and a rejection
  crashed the process as a raw unhandled rejection.
- Mixing `??` with `and`/`or` in one unparenthesized chain is now a parse
  error (`VEL2034`), matching JavaScript's rule for `??` with `||`/`&&`:
  the two groupings read differently, so the parentheses are required.
- A statement now must end at its newline. Trailing tokens after a complete
  statement — a missing operator (`price quantity`), a doubled literal
  (`5 7`), or a second statement on the same line — are diagnosed with
  `VEL2032` and recovery continues on the next line. In Web projects the
  percent form gets a targeted message: `10%3` reads as the percentage
  literal `10%`, so the diagnostic teaches `10 % 3` for the remainder
  operator. Previously these shapes compiled silently and discarded the
  trailing tokens.
- Conditions judge truth, not presence. `bool` and `bool?` conditions enter
  the branch only when the value is `true`; `false` and `null` both take the
  else path, and a `bool?` condition lowers to an explicit `=== true` test.
  Any other optional in bare condition position is rejected with guidance to
  write `value != null`. Previously a bare optional condition was a
  presence check, so `if flag:` with `flag == false` entered the true branch.
  Comparison-based narrowing (`!= null`, `== null`) is unchanged; the true
  branch of a `bool?` condition narrows to `bool`.
- The null test has one spelling family: `!= null` and `== null`. `is` tests
  runtime types, equality tests values, and `null` is a value, so `x is null`
  and `x is not null` are removed spellings with parse-level guidance to the
  equality forms. `x is not Error` (type test) and `x not in list`
  (membership) are unaffected.

### Release highlights

- Familiar values now carry their operations directly. Strings and numbers use
  checked method chains; Lists add aggregation and key-based sorting; Set and
  Map retain one controlled collection vocabulary without leaking JavaScript
  prototype behavior.
- Iteration and construction cover the application shapes proven by
  VelarOS-Lite: two-slot `for` loops expose value/index or key/value pairs,
  `range` has one bounded materialized contract, and Set/Map constructors accept
  checked Lists and records.
- One quote family covers inline, raw, interpolated, and indentation-bounded
  layout strings. Markdown fences and HTML remain literal content without a
  backtick delimiter family; assertion messages read as
  `assert condition else message`.
- Web state is deeply reactive by default. Direct nested record assignment and
  compiler-owned List/Map/Set mutation publish at the property or collection-key
  granularity, including through aliases and shared module state. There is no
  public memoization or batching API.
- Core local applications use the first-party `velar/serve`, `velar/fs`,
  `velar/env`, and `velar/host` modules instead of rebuilding Node extern
  surfaces. Browser targets reject those modules before bundling.
- The fourth no-document usability gate covered these new surfaces with one
  independent writer and two complete programs. Its first compile produced 16
  diagnostics, converged 16 → 2 → 2 in three rounds, and found zero missing
  language capabilities; the remaining misses were discoverability of the
  explicit `range` import and JavaScript-style interpolation text.

The detailed entries below retain the development evidence behind this release.

### First-party local platform modules

Standard library and CLI changes:

- Standard API 0.5 adds `velar/serve`, `velar/fs`, `velar/env`, and
  `velar/host` for Core servers and local applications. HTTP callbacks,
  filesystem buffers, environment access, and process signals remain inside
  bounded first-party runtime implementations instead of user `extern`
  declarations.
- `velar/serve` provides checked request/response records, bounded JSON/text
  bodies and async chunk producers, real-root static containment, MIME types,
  SPA fallback, opaque handler failures, actual bound ports, and idempotent
  shutdown. `velar/fs` exposes async bounded text/list/blob operations;
  `Blob` is opaque and non-constructible.
- Web-capable projects reject local platform imports during dependency
  analysis with targeted diagnostics. The browser production bundler retains
  the same refusal as a fail-closed second boundary.
- `velar/host` owns ordered SIGINT/SIGTERM cleanup and double-signal force
  quit; `velar/env` permits only explicit portable variable names. The
  JavaScript bridge remains the third-party package boundary.

### Unified quoted strings and assertion failure branches

Language and compiler changes:

- Inline single- and double-quoted strings remain line-bounded recovery units.
  A quote followed immediately by a newline opens an indentation-bounded layout
  string; its structural margin is removed while internal lines and extra
  indentation remain exact. A missing close recovers at dedent.
- `r"..."` preserves backslashes literally, `f"..."` interpolates, and the
  canonical combined form is `rf"..."`; the same prefixes apply to layout
  strings. Raw inline strings double their delimiter to include it. Backtick
  strings were removed cleanly, and noncanonical `fr`, legacy backticks, and
  triple quotes receive direct current-spelling guidance.
- Assertion messages now read as an explicit failure branch:
  `assert condition else message`. The old comma separator receives a targeted
  migration diagnostic and no longer emits runnable output.

### Two-slot iteration and collection construction

Language and compiler changes:

- `for first, second in value` is a distinct two-slot loop: List/Set/string
  iteration yields value plus insertion/code-point index, while Map iteration
  yields key plus value. Both slots accept full binding patterns. Single-slot
  loops and `for [a, b] in pairs` destructuring are unchanged; a third slot is
  rejected with direct guidance.
- `range` now exposes its three named signatures in addition to positional
  calls. It remains one bounded materialized `List<number>` contract everywhere
  rather than adding a second lazy iterable type.
- `Map` accepts checked dense `[key, value]` entry Lists and ordinary records;
  `Set(List)` remains the checked content constructor. The runtime copies by
  data descriptor and native collection slots, never by replaceable iterators
  or accessors. Record-to-Map diagnostics now point at `Map({...})`.
- Multiline-string work from this batch was superseded in the same development
  cycle by layout strings: the same ordinary quote enters a multiline block
  only when followed immediately by a newline, while `r`, `f`, and `rf` select
  raw and interpolation semantics without a separate delimiter family.
- This batch deliberately does not add truthy conditions, List `+`, async
  iteration, labeled breaks, for-else, or match expressions; their existing
  single-spelling and evidence decisions remain unchanged.

### Checked value methods and List aggregation

Language and compiler changes:

- Strings now expose the checked members `size`, `trim`, `upper`, `lower`,
  `slice`, `char`, `has`, `startsWith`, `endsWith`, `split`, `replace`,
  `replaceAll`, `padStart`, `padEnd`, and `repeat`; numbers expose `abs`,
  `round`, `floor`, `ceil`, and `toFixed`. These methods support named calls,
  optional access, and first-class receiver binding without patching or
  trusting JavaScript prototypes. `0.abs()` and decimal-literal chains lex as
  member access. String size, character access, and slicing retain Unicode
  code-point semantics and the existing 16 MiB bounds.
- The receiver-shaped `velar/text` and `velar/math` exports moved to those
  methods with no compatibility aliases. Old imports, bare calls, JavaScript
  spellings such as `.toUpperCase()`/`.length`, string indexing, and number
  `.toString()` receive one-current-spelling guidance.
- Lists add `sum()`, `min()`, and `max()`. `sorted(by=selector)` computes one
  number/string key per checked snapshot value and is mutually exclusive with
  its comparator form. Empty `min`/`max` return `null`.
- String right operands are explicitly covered by the controlled `in`
  membership contract. `map.get(key, fallback)` now points directly to
  `get(key) ?? fallback`.

### Deep state reactivity is the only default

Web framework changes:

- `state` now publishes direct nested record assignments and direct
  `List`/`Map`/`Set` mutations. State references may be aliased, passed to
  ordinary functions, returned, and mutated through reactive imports; the
  former VEL5046 copy-and-reassign restrictions are removed.
- Ordinary mutable records are lazily proxied with property-level dependency
  tracking. Native collections keep their identities and publish from
  compiler-owned helpers; nested versions bubble to deep watches. A watch of
  a deeply mutated value receives the same reference as `current` and
  `previous`, without an implicit deep snapshot.
- The raw/proxy cache and dependency graph are shared across application
  bundles under runtime foundation version 0.11. Classes, host objects,
  functions, frozen or non-extensible records, and native collections are
  never wrapped; validation and serialization boundaries share one `toRaw`
  operation, including `Map` keys and `Set` membership.
- Component props remain read-only. Direct nested prop assignment or a
  mutating collection call on a prop is reported as VEL5051.
- Identity-keyed memoization and its purity metadata are removed because a
  stable record identity can now contain changing fields. The language still
  exposes no `memo` or `batch` API; synchronous state bursts remain coalesced
  by the scheduler.

### For-loop bindings own their name from the loop head

Language and compiler changes:

- A for-loop binding now follows the shadowed-name ownership rule (VEL3017):
  an iterable expression that references a name the loop's own pattern
  declares — through a simple name or any list or object destructuring,
  including rests — is a compile-time error when that reference would
  resolve to an outer binding, instead of compiling into JavaScript that
  evaluates the iterable in the loop binding's temporal dead zone and
  throws at runtime. The directive names the fixes: rename the loop
  binding, or read the iterable into a differently named binding first —
  the loop binding owns its name only in the loop head and body, so a
  same-scope read above the loop stays legal. An arrow parameter inside
  the iterable that reuses the name keeps being an ordinary inner binding.

### Shadowed names are owned by their shadow's whole scope

Language and compiler changes:

- A declaration that shadows an outer binding now owns its name for its whole
  scope: a reference that would reach the outer binding from earlier in that
  scope — an earlier statement, the shadow's own initializer, a component
  item above a shadowing `state`, or a prop default — is a compile-time
  error (VEL3017) instead of compiling into JavaScript that reads the
  not-yet-initialized shadow at runtime (or, inside an arrow, silently
  captures the wrong binding). The directive names the fix: rename the
  shadow, or read the outer value in an enclosing scope. A function
  parameter default keeps reading the enclosing scope, exactly as emitted
  JavaScript does.

### Keyed conditionals and dev-server npm prebundling

Language and compiler changes:

- The keyed-children fast path now reaches through conditionals: an
  interpolation whose `?:` branches contain `items.map(item => <Row
  key={item.id} />)` compiles each branch to its own gated region, so the
  idiomatic empty-state ternary keeps identity-preserving keyed children instead
  of silently demoting the whole list to rebuild-all dynamic updates. A
  branch that renders a list with `.map(...)` requires a key exactly like a
  bare keyed interpolation (VEL5017 now applies to branches too).
- A `key` attribute the keyed path will never read — on a lone element, on a
  map nested inside a larger expression, or in any other unrecognized
  position inside an interpolation — is now diagnosed (VEL5050) with the
  recognized shape named, instead of being silently ignored at runtime.

Tooling changes:

- `velar dev` now prebundles bare npm imports per package with the production
  bundler and serves the results as native ES modules, cached in
  `<project>/.velar/dev-deps` keyed by package version and invalidated when
  the watcher sees the installed files change. Dual packages whose
  "import"-condition entry wraps their own CommonJS internals (the pattern
  Node's documentation recommends to dual publishers) now load in
  development exactly as they do in `velar build`; imports of other packages
  stay bare and resolve through the import map. A package that cannot be
  prebundled produces a velar-voiced error naming the package instead of a
  raw browser SyntaxError on a package-internal file; a CommonJS-only
  package keeps its explicit refusal, now detected by the bundler's module
  format instead of a source heuristic.

### Module-scope actions

Language and compiler changes:

- `action` may now be declared at module scope, so a shared store owns an async
  operation together with its reactive `pending`/`error` surface next to the
  module `state` and `computed` it drives. A module action behaves exactly like
  a component action — reactive `pending`/`error` fields, failures reported
  through the Web error chain while the call still rejects — but its lifetime
  is the module: it is never disposed. `export action` is supported; the
  exported value is imported and called like a function and its reactive
  fields read without any reactive-import lowering. An action nested in an
  ordinary function body is still rejected (VEL3013, now phrased "module or
  component scope"). `resource` remains component-only because its stale-result
  handling is tied to component destruction; module-scope `resource` keeps
  VEL3012 with guidance toward a module `action`.

### VelarOS-Lite S2 batch: re-exports, bridged-dependency sandboxes, extern default contract

Language and compiler changes:

- Named re-exports: `export {name, other as alias} from "./module.vel"` (also
  from package sources and standard modules) re-exports without creating local
  bindings. Re-exported names join the module interface under their aliases
  with the origin contract; live-export (`export let`) mutability and reactive
  kinds propagate, and the statement lowers to a native ES-module
  `export ... from`. Go-to-definition follows re-export chains to the origin
  declaration. Namespace re-export (`export * from`) is rejected with VEL2029
  guidance toward the named form, and a re-exported name that collides with
  another export of the same module is rejected with VEL3016.
- The extern default-export contract is documented and pinned by tests:
  `export class default:` and `export const default: T` declare a
  default-export-only package, and the bare `import js Name from "pkg"` form is
  the canonical default import (see javascript-bridge.md).

Tooling changes:

- `velar test` and `velar run` now compile into `<project>/.velar/test-*` and
  `<project>/.velar/run-*` sandboxes instead of the system temporary
  directory, so Node's upward `node_modules` walk keeps resolving the
  project's real npm dependencies for bridged `import js` packages. The
  sandbox is removed after each run and `.velar/` is gitignored by the
  project templates; TMPDIR workarounds are no longer needed.
- When a module declares a manual `extern module "pkg"`, the automatic
  TypeScript-declaration probe no longer runs for that module's imports of
  that source, so it emits no notices that second-guess the manual contract.

### Blind-usability batch 3: chains, string functions, Look tightening

Language and compiler changes:

- Leading-dot continuation: a line whose first token is `.` or `?.` continues
  the previous logical line, so method chains can span physical lines in the
  standard formatted style. Trailing-dot continuation stays unsupported, and a
  leading `.` not followed by a member name (such as `.5`) never joins lines.
  The formatter normalizes continuation lines to one level past the statement
  they continue and never reflows existing single-line chains.
- `velar/text` gains the string measurement and access trio: `length(value)`
  (code-point count), `char(value, index)` (code point at an index, negative
  from the end like `List.get`, `null` out of range), and
  `slice(value, start = 0, end = length)` (code-point slice with `List.slice`
  position semantics). Strings expose no members: `value.length`,
  `value.size`, `value.slice(...)`, `value.substring(...)`, `value.charAt(...)`,
  `value.at(...)`, and `value[index]` now report directive guidance to the
  matching `velar/text` function.
- Look rejects multi-token shorthand strings on properties with a checked
  builder equivalent — the spacing family (`margin*`, `padding*`, `inset`,
  plus `borderRadius`/`borderWidth`), the border family (`border`,
  `borderTop/Right/Bottom/Left`, `outline`), `boxShadow`, and `transition` —
  with guidance that computes the builder call where the string decomposes
  cleanly (`Use 'spacing(8px, 12px)'`, `Use 'border(1px, color("#d9dce1"))'`).
  Single-token keyword strings, hex color strings, and out-of-family strings
  such as `fontFamily` stacks stay accepted. `flex` now accepts numbers.

Diagnostic guidance changes:

- A `#` that begins a line is guided to `//` comments and the commented text
  is skipped without an error cascade; bare hex colors keep their quoted-string
  guidance.
- A bare (unbraced) `for name in expr:` written directly as JSX content
  receives the same `.map(...)` guidance as its braced spelling.
- Assignment written inside an expression (an interpolated fragment or an
  arrow body) reports "Assignment is a statement" guidance and recovers, so
  the rest of the module still co-reports its own diagnostics. When an event
  attribute's arrow assigns a state binding from an event field, the Web
  extension additionally guides to `bind:value={binding}`.
- Kebab-case Look properties and multi-value shorthand now recover as their
  guided spelling, so camelCase guidance, builder guidance, JSX attribute
  guidance (`on:` directives, `bind:value`), and semantic diagnostics surface
  together in one compile instead of gating each other.
- A Look hook written as a target (`@hover:` as a block) is guided to the
  `if @hover:` condition form.

### Minimal generics for def functions

Language and compiler changes:

- `def` functions — top-level, exported, extern, and class methods — can
  declare type parameters: `def first<T>(items: List<T>) -> T?`. Type
  arguments are inferred at each call site; there is no explicit instantiation
  syntax. Callback arrows are checked against the bindings solved from fixed
  arguments, and their results solve the remaining parameters. An unsolved
  parameter becomes `unknown`.
- Type parameters are usable in parameter annotations, result annotations, and
  value annotations inside the function body. A generic function is an
  ordinary value: calls through bindings infer per call site, and assigning
  one to a concrete function contract instantiates it against that contract.
- Type parameters are erased at runtime: `is T`, `case T`, and any type
  containing a parameter in a runtime-checked position are rejected with
  VEL4022. Duplicate or type-shadowing parameters and a nested `def` reusing an
  enclosing function's parameter are rejected with VEL4021.
- Generic `type`, `class`, and `component` declarations, bounds, and variance
  are out of scope for this version and report a targeted diagnostic.

### Remove host-origin tracking and call-effect invalidation

Language and compiler changes:

- Narrowed facts now persist across ordinary calls, `await`, string
  interpolation, getter reads, and spreads. A fact is invalidated only by an
  assignment to its location and by merging branches where such an assignment
  can reach that location.
- Host-origin propagation — result origins, storage-origin effects, constructor
  origins, and contains-external instance marks — is removed from the language
  and from module contracts.
- Live `export let` imports now narrow like ordinary bindings.
- Runtime guards are unchanged: bounded collection helpers, record validators,
  and `undefined`-to-`null` normalization stay active.
- Module contract identities changed, so the first build after this change
  performs a one-time full project re-analysis.

### Clarity Reset

Breaking language changes:

- Named arguments use `name=value`; `null` is the only ordinary empty value.
- Classes use body fields and one explicit `constructor(...)` declaration.
- Optional chaining follows JavaScript one hop at a time.
- `List`, `Set`, and `Map` expose one small, consistent API without legacy
  aliases.
- `match` supports literals, enum members, type patterns, bindings, and guards.
- JSX branching uses ordinary expressions and control flow.
- Look uses CSS property names, explicit string values, named arguments, and
  explicit `before look` / `after look` unsafe CSS ordering.

Compiler and framework changes:

- Types now have a structured syntax tree and stable semantic identity.
- Mutable collections and writable structures are invariant.
- Reactive state is deeply tracked through record properties and
  compiler-owned collection operations. Aliases, ordinary calls, returns, and
  reactive imports preserve updates; component props remain read-only in the
  child.
- Web JSX and Look participate in the Core lexical stream through the Web
  extension instead of being captured as opaque source blocks.
- JavaScript generation uses structured nodes with nested source-map positions.
- Actions retain observable pending/error state while preserving normal Promise
  rejection semantics.
- Assignments check the declared location type, invalidate stale optional facts,
  and lower as true JavaScript assignment targets without read-side null
  normalization.
- Short-circuit conditions and `while` bodies share optional narrowing, while
  complete source spans keep nested lowering hints from colliding.
- Mutually exclusive branches, `match` cases, terminating loops, and
  unreachable tails now merge flow facts by reachable path. Match guards narrow
  their body, and ordinary calls invalidate mutable or aliased facts unless the
  checked value was first saved in a local `const`. Getter and safe-JavaScript
  property reads, plus resumed code after `await`, follow the same effect
  boundary.
- Continuing branches now retain facts established on every path;
  `try`/`catch`/`finally`, match guard fallthrough, aliased member writes,
  JavaScript setters, object f-string coercion, and component JSX evaluation all
  follow emitted execution order instead of sharing or guessing flow state.
- Safe-JavaScript class checks now treat `Symbol.hasInstance` as an effectful
  host hook, while local VelarScript `is` checks remain inert.
- Module interfaces now preserve `export let` liveness separately from local
  assignment permission. Named live imports lose stale facts at effect
  boundaries, while namespace imports with live exports fail explicitly and
  all namespace fields remain read-only.
- Named calls now retain native callee-first evaluation, member receivers, and
  optional-call short-circuiting while still evaluating argument expressions
  once in source order before arranging them in declaration order.
- Membership expressions now evaluate their candidate before their collection,
  using a source-shaped controlled helper signature instead of reversing the
  operands during lowering.
- Plain member assignment no longer invents a getter read before its right-hand
  expression; host setter effects occur afterward, while compound assignment
  still models its required old-value read first.
- Assertion messages are checked only on the failing path with rejected
  condition facts; their effects no longer erase facts on the successful path.
- `List.reduce(callback, initial)` analysis now follows runtime argument order
  without losing contextual typing for an effect-free literal arrow callback.
- Optional indexes and calls now expose successful-chain facts to their deferred
  expressions, optional index calls continue safely, and optional function
  annotations contextually type assigned arrows.
- Comparison chains now carry successful-link facts into later operands and
  into bodies controlled by the complete truthy chain.
- Optional collection annotations now contextually type empty List, Set, and
  Map values, including transparent collection aliases.
- Null-coalescing fallbacks now receive the expected or present-value context,
  retain null-path flow facts, and preserve arrow operands in emitted JavaScript.
- Match success and fallthrough now narrow the original stable identifier or
  data field through guards, later cases, and else; effects invalidate stale
  facts.
- List and call spreads now validate dense Lists without invoking instance
  iterators, async List spreads preserve order, and call spread targets only a
  declared rest parameter.
- Record construction now defines controlled own data fields, makes
  `__proto__` an ordinary name, rejects accessor and symbol spreads, normalizes
  unsafe `undefined`, and preserves explicit async evaluation.
- Safe JavaScript records and Lists now retain host-origin metadata through
  declared results and type composition, so reads, reflection, destructuring,
  iteration, spread, and structural matching invalidate stale flow facts.
- Set and Map now carry the same container-level host provenance as List;
  Proxy-sensitive size reads and iteration are effect boundaries, while copy
  construction creates an owned container and retains element provenance.
- Runtime `Type.parse`, `is`, and type-pattern checks now preserve host origin
  when they validate an unchecked value; safe-JavaScript class instances carry
  the same non-display provenance through constructors and method results.
- Cyclic module fixed points now include non-display host-origin metadata in
  their analysis identity without changing visible type equality.
- Explicit variable annotations and mutable rebinding now preserve the current
  value's host origin instead of silently turning an external reference local.
- Declared assignment contracts, current storage provenance, and flow-narrowed
  read types are now separate binding states. Reachable branches merge storage
  provenance symmetrically, including assignments through a narrowed binding,
  so analysis no longer depends on branch order.
- VelarScript functions, async functions, expression arrows, getters, and class
  methods now preserve host origin through returns. Callable contracts retain
  non-display parameter-to-result relationships, including named and rest
  arguments, so one identity helper remains local for local inputs and external
  only for external inputs. Analyzed class member contracts now cross module
  boundaries instead of being rebuilt from source annotations.
- Contextually typed List literals now retain host origin in their element
  types while the newly allocated List itself remains owned.
- Local class construction now distinguishes a host object from a locally
  allocated instance that contains host-origin references. Constructor field
  initializers, parameter assignments, named calls, default values, `super`
  forwarding, hoisted calls, methods returning `self`, runtime checks, and
  module interfaces preserve that distinction without making unrelated
  primitive fields effectful.
- Post-construction field, index, and collection-mutator writes now retain
  contained host origin for local records, classes, Lists, Sets, and Maps.
  Flow-scoped reference identities propagate that state through direct and
  conditional aliases, narrowed bindings, identity functions, and methods
  returning `self`, while a fresh rebind separates the previous object.
- Functions and methods now publish composable storage-origin effects for
  parameter, rest, receiver, default, and captured-value writes. Forwarding,
  named calls, declaration-before-use, inherited mutating getters, module
  boundaries, and conservative safe-JavaScript argument mutation preserve the
  same provenance contract.
- Callable and constructor default provenance is applied only when that
  parameter is omitted; an explicit owned argument is not contaminated by an
  external default it replaces.

Tooling and documentation changes:

- The formatter is syntax-aware and idempotent across Core, JSX, and Look.
- The language server diagnoses and repairs common JavaScript and Python
  spellings directly.
- README, reference documents, templates, real applications, and the
  VelarScript website use the same 0.10 contract.
- CI extracts and compiles documentation and website examples.

## 0.1 through 0.9 — Pre-release development

These development lines established the compiler, CLI, standard modules, Web
framework, package boundary, browser tests, Workbench integration contract, and
static deployment pipeline. Their experimental syntax is superseded by 0.10
and is intentionally not retained as compatibility surface. Detailed history
remains available in Git.
