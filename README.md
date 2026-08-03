# VelarScript

VelarScript is a clean, Web-first language compiled by the Velar Compiler to
modern JavaScript, CSS, and Web assets. It keeps the JavaScript runtime and
replaces the source surface with a smaller Python/JavaScript blend designed for
Web applications.

```sh
npm create velar@latest my-app
cd my-app
npm install
npm run dev
```

Use `-- --template docs` for a routed documentation site,
`-- --template library` for a Core `.vel` source package, or
`-- --template component` for a reusable Web component package. The same
templates are available through `velar create` once the CLI is installed.
Velar keeps npm as the registry and lockfile authority; after bootstrap,
`velar install`, `velar add`, `velar remove`, and `velar update` provide the
project-aware dependency surface.

This repository was rebuilt from zero. It does not retain source code, Git
history, architecture, or language semantics from the former VelarScript
project.

## Current milestone

Velar 0.9AB has completed the internal application-scale language-and-Web
sequence, and the requirement-by-requirement 1.0 internal engineering audit is
complete. The audited development source is published through
[draft PR #1](https://github.com/VelarOS-AI/VelarScript/pull/1), and the
[official Website source](https://github.com/VelarOS-AI/VelarScript-Website)
is a separate Apache-2.0 project that dogfoods the packed toolchain. npm
publication and hosted deployment remain deliberately deferred. The audit's first pass
closes the ordinary new-project workflow: generated applications now contain a
separate app module, a real Core test, a browser test, project-wide format
scripts, and an installed-package acceptance that uses only those generated
npm scripts. It also replaces lossy ambient JSON serialization with one strict
record/List data contract shared by `velar/json`, storage, IndexedDB, and HTTP
request bodies. Known non-data types fail checking and unsafe/dynamic values
fail before data is silently dropped or a side effect begins.

The internal 1.0 audit now also closes Web hostile-input boundaries, managed
callback and route recovery, IndexedDB commit semantics, lazy HTTP cancellation,
transactional project creation, strict manifest/help/LSP contracts, packed
consumer installation, reproducible release rehearsal, and exact release-set
verification. Chromium, Firefox, and WebKit pass the development and CSP
production matrices for Release Studio, FlowBoard, and SupportDesk. The current
packed toolchain also passes the independently hosted Workbench LSP gate and all
9 focused generic-language-host tests. That generic path now carries standard
LSP inferred-type hints for unannotated `const`/`let`, `state`, and `computed`
bindings while suppressing redundant explicit annotations; resource handle
shapes remain available through hover instead of masquerading as source-level
resource annotations. Same-document symbol occurrences are highlighted from the
compiler reference index without leaking cross-module locations into the open
editor. Both sides of the LSP channel enforce the 16 MiB frame ceiling; semantic
lists are capped at 10,000 items and an oversized rename fails explicitly rather
than emitting a partial workspace edit. Ordinary completion is now lexical and
scope-aware, while member completion reads analyzer-owned signatures for
records, classes, collections, resources, actions, enums, and runtime Types
instead of copying type rules into the editor. Checked intermediate-expression
types are indexed selectively, so chains such as `route.params.get(...)` and
`Type.parse(...).field` receive the same completion and active-parameter
signatures without retaining every literal or identifier expression. JSX tag
positions complete only prefix-matching visible components and a focused native Web element
set; component attribute positions complete checked parameters, native tags
complete supported Web attributes/directives, and typed object literals
complete their missing record fields. Value expressions immediately return to
ordinary lexical completion. This is internal readiness
evidence, not a public production claim: hosted preview observation, independent
users, review and merge of the development source, a stable version/tag, and
publish authority remain
external.

Failure containment is now a retained gate rather than an assumption. Compile,
inspect, and format APIs accept a deterministic malformed-input corpus without
escaping internal exceptions. The development server keeps the last good app
when a watched rebuild throws outside ordinary diagnostics, reports the failure,
recovers on the next edit, and converges to the last of 64 rapid writes.

The latest audit slice also makes resource behavior explicit: compiler source,
token, nesting, project/module and manifest inputs are bounded; standard/Web
data, fan-out, routes/forms/storage, HTTP/file/realtime bodies, and deployment
inventories have checked ceilings. Production hashing, preview delivery, and
remote verification stream bytes, repeated form values accumulate linearly,
and npm assets are realpath-confined before serving. List spread, `Set`/`Map`
construction, and `append`/`extend`/`add`/`set` maintain the same collection ceiling rather
than letting normal source operations escape the runtime contract. Browser host
results are checked on the return path as well: malformed file metadata rejects
the picker Promise, HTTP response metadata/headers stay bounded, and browser,
realtime, file-reader, and secure-UUID results cannot silently violate their
declared Velar types.

The language audit now also separates class construction from body-owned state.
Constructor parameters remain caller input, while explicitly typed `const` and
`let` fields may live in the class body; `static const`/`static let` provide the
matching class-owned surface. These fields retain native JavaScript object and
prototype semantics, compile-time assignment rules, module identities, and
generic LSP completion/navigation/refactoring. API Dashboard validates the
design with a chart-scale class whose derived ratio crosses a lazy SVG component
chunk without appearing as a fake constructor argument.

Classes also support typed read-only derived properties with
`get name() -> Type:`. They read as `value.name`, lower to native JavaScript
getters, participate in explicit inheritance and abstract contracts, and remain
distinct from writable `let` state. API Dashboard uses `ChartScale.top` to
drive a real SVG coordinate without storing duplicate state.

Class members are public by default. One explicit `private` modifier covers
constructor-backed fields, body fields, getters, and synchronous/asynchronous
instance or static methods without adding `public`/`protected` tiers. Source keeps
readable `self.ratio` and `ChartScale.cache` access inside the declaring class;
the compiler lowers those accesses to native JavaScript `#` storage, removes
them from exported class interfaces and outside completion, and rejects class
or subclass access that crosses the boundary. API Dashboard now keeps its
derived chart ratio private instead of merely documenting it as internal.

The next application-driven audit closes concise asynchronous composition.
Expression callbacks may now use `async value => await operation(value)` and
infer `(T) -> Promise<U>` through standard async helpers, module interfaces, and
the LSP. A synchronous arrow no longer inherits permission to `await`, returned
Promises follow JavaScript adoption semantics, and Promise values cannot leak
into JSX. API Dashboard loads two typed metric feeds concurrently through this
surface. That workload also exposed and removed an unnecessary syntax limit:
multiline imports, parameters, type arguments, constructors, and calls now
accept a final comma, with the lexer keeping continuation lines out of the
indentation stack.

The same rule now applies uniformly to block-bodied asynchronous code. An
`async def`, async method, component `action`, or async arrow annotates its
resolved value as `-> T` and may return either `T` or `Promise<T>`; native
JavaScript Promise adoption supplies the single `Promise<T>` call contract.
Direct `await` in a parameter default is rejected because it would be invalid
JavaScript before the body begins, while an explicitly nested async callback
keeps its own valid boundary.

The next application audit corrected expression semantics where a superficially
reasonable lowering could still produce invalid or silently wrong JavaScript.
Power is right-associative, binds before a leading unary sign, accepts signed
exponents, and treats `await` as the resolved base. Expression arrows now make
`value => {value}` an unambiguous object return instead of a JavaScript block.
The same audit adds one synchronous class `init:` block after fields and bound
methods, giving classes a clean place for invariant checks without inventing a
second constructor or runtime. API Dashboard's `ChartScale` now rejects invalid
construction through this real language surface rather than a static helper.
`init` remains contextual, so ordinary bindings, record/object fields, methods,
and JavaScript-facing APIs do not lose a common identifier merely because the
class-body form exists.

The following range audit adds comparison chains such as
`0 < value <= limit`. Operands run left-to-right once and the remaining chain
short-circuits; strict equality links compose naturally, while ordered links
accept only same-kind numbers or strings. This keeps Python's readable range
notation but removes JavaScript's boolean/object coercion trap. API Dashboard
now states its `ChartScale` construction bounds directly with that syntax.

The public-API audit adds `///` documentation comments without importing
JSDoc's parallel type language or Python docstrings as runtime values. Markdown
documentation attaches only when contiguous with a declaration, follows
exports and aliases across modules, and reaches member/top-level hover plus
completion through the standard LSP. API Dashboard documents its chart type,
scale, and coordinate methods; Workbench displays the packed compiler's result
through its generic language host.

The 0.9 sequence began with 0.9A, which was
driven by the independent SupportDesk application. It adds branch-owned
optional narrowing for `? :`, an importable and runtime-validatable
`RouteContext`, checked route-component contracts and path patterns, and typed
native-form value/reset helpers. SupportDesk validates static HTTP loading,
form errors, enum parsing, filtering, sorting, pagination, dynamic detail
routes, persisted updates, production output, and Chromium/Firefox/WebKit.
0.9B closes the next application-navigation gap with base-aware `NavLink`
activity, typed `DialogElement` refs, browser-owned native dialog helpers, and
detail-route data recovery that distinguishes loading from a real missing
record. The compiler/LSP remains the semantic authority while Workbench stays
a generic independently packaged host. 0.9C replaces the manual
`ready`/`loading`/`loadError`/`mounted` pattern exposed by those real
applications with component-owned `resource` declarations. A resource starts
on mount, exposes typed value/loading/ready/error/reload state, reports failures
through `velar/app`, ignores stale completions after retry or destruction, and
keeps effect tracking internal rather than adding a React-style source API.
0.9D addresses the matching user-operation gap with component-owned `action`
declarations. Actions are callable async functions with reactive `pending` and
`error` fields, normalize UI-operation failures into the application error
chain, ignore stale failure state, and stop publishing after component
destruction. Ordinary `async def` keeps rejection semantics for workflows that
need explicit `try`/`catch`.
0.9E closes the component-composition gap with concise function types such as
`(string, number) -> none`. Callback props now retain argument, result, rest,
module, runtime-validation, and editor contracts without adding TypeScript
overloads or user-defined type-level programming; FlowBoard no longer couples
its reusable form/column/card components directly to the global store.
0.9F removes the resulting repetition with transparent aliases such as
`type TaskIdHandler = (string) -> none`. The same `type` keyword still owns both
record data and aliases: aliases expand for checking across transitive module
boundaries, erase when used only statically, and retain opt-in `parse` / `is`
validation without introducing `schema`, nominal wrappers, generics, or a
second type language.
0.9G fixes the next real JSX authoring failure: complete loading/error/content/
empty views no longer need nested ternary expressions. Adjacent JSX elements
may use `if={condition}`, `else-if={condition}`, and valueless `else`; they keep
block-`if` condition rules and optional narrowing while reusing transactional
DOM replacement and deterministic child/ref cleanup.
0.9H makes native Web events usable without leaking an untyped DOM surface.
`on:keydown`, pointer events, and input events contextually provide
`KeyboardEvent`, `PointerEvent`, and `InputEvent`; zero-argument handlers remain
valid, one-argument handlers are checked, and emitted code still receives the
browser's original event object with no framework wrapper.
0.9I removes a false choice exposed by the real applications: an omitted
function, method, or action result now means `none` everywhere instead of
quietly degrading to `unknown`. Side-effect code writes `def save():` and ends
naturally; code that returns a value declares `-> T`, so local checks, imported
module contracts, async signatures, and editor hover all agree without a
complex whole-body inference system.
0.9J removes the next repeated Web-form seam with `velar/forms.read(form, Type)`.
It decodes a flat native form into the existing record `type` family, including
strings, finite numbers, checkboxes, enums, repeated strings, and optional
scalars. It does not add a schema declaration, automatic business validation,
hidden submission lifecycle, or raw `FormData`; SupportDesk keeps ownership of
required-field messages while deleting its manual per-field conversion chain.
0.9K follows the same real form through control flow: a stable optional field
such as `draft.estimate` now narrows after `if draft.estimate`, in the inverse
branch of `not`, under `is`, in inline conditions, and in JSX conditional
branches. Facts are tied to the lexical root binding, so shadowing cannot reuse
an unrelated object's proof; dynamic indexes and calls remain unnarrowed.
0.9L removes the remaining validation workaround with Python-style
`assert condition, "message"`. Assertions remain active in production, accept
the same strict boolean-or-optional conditions as `if`, evaluate a custom
message only on failure, and narrow local names or stable fields for following
statements in the current lexical block. SupportDesk now states its validated
estimate invariant directly instead of wrapping successful submission in a
second presence branch.
0.9M removes position-heavy domain calls without adding Python keyword-argument
metadata or another declaration system. FlowBoard and SupportDesk pass one
existing `type` record into creation operations and use JavaScript-style object
field shorthand such as `{title, description, priority}`. Direct duplicate
fields and quoted fields without `:` are rejected, while explicit spread then
override remains available for immutable updates.
0.9N makes explicit empty-value checks as useful as presence checks. Natural
JavaScript/Python-shaped conditions such as `value != none` and
`value == none ... else` now narrow local names and stable record fields in
blocks, inline conditionals, assertions, and adjacent JSX branches. Operand
order is symmetric, JSX `else-if` sequences accumulate rejected facts, and
present `0`, empty strings, and `false` remain distinct from `none`. Real route,
file-selection, form, and collection access paths use the explicit form where
it communicates intent more clearly.
0.9O promotes block `else if condition:` from an unverified parser path to a
complete language contract. Chains retain every earlier rejection fact,
participate in required-return analysis, and emit flat readable JavaScript
instead of nested `else { if (...) }` blocks. FlowBoard uses the chain for a
real progress-state decision, while `match` remains preferred for finite enums
and inline `? :` remains reserved for short expressions.
0.9P makes the existing simple union syntax usable without growing a
TypeScript-style type language. In `value is Type` chains, a rejected check now
removes that fully covered member from a local or stable field; the final branch
receives the actual remainder. The same bounded rule works through `not`,
successful assertions, optionals, inline branches, and adjacent JSX. FlowBoard
uses `string | number` at a real metric-formatting boundary.
0.9Q fills a basic collection API gap with checked `List.slice()`,
`slice(start)`, and `slice(start, end)`. It returns a typed shallow copy, accepts
negative positions from the end, clamps out-of-range positions, and rejects
non-integer positions instead of inheriting JavaScript coercion. SupportDesk
pagination now expresses its window directly rather than composing
`take(drop(...))`.
The continuing application audit makes List mutation read consistently:
`append(value)` adds one item and `extend(values)` adds a typed List atomically.
Velar no longer exposes JavaScript's variadic, length-returning `push` surface;
both operations still lower to bounded native-array mutation. An unannotated
empty List takes its element type from its first direct append or extension,
then rejects incompatible later writes.
0.9R adds stateless text patterns through `velar/text`: `matches`, `findMatch`,
`findMatches`, `replaceMatches`, and `splitPattern`. Every call creates a fresh
Unicode pattern with typed `ignoreCase`, `multiline`, and `dotAll` options, so
applications gain practical matching without regex literals, mutable
`RegExp.lastIndex`, arbitrary flags, or JavaScript replacement-string traps.
Production Web validates its public release-channel name through this API.
0.9S makes optional access protect one continuous postfix chain. A single
`value?.details.groups[0]` safely propagates `none` through later fields,
checked indexes, calls, and compiler-owned collection helpers without eagerly
evaluating skipped indexes or arguments. Optional chains cannot be assignment
targets, and an optional function still requires a presence proof or an
explicit chain. Newsletter validates and extracts an email domain through this
natural form.
0.9T lets the existing colon-form record `type` describe finite recursive data
without adding schemas or generics. Records may recurse through an optional,
collection, or genuinely terminating union path; required cycles that cannot
construct a finite value fail at compile time. Static structural comparison is
cycle-safe, while runtime `parse` / `is` reject cyclic object graphs and
excessive depth instead of overflowing. Production Web uses one recursive
`ProjectSummary` for its typed project tree, recursive count, and recursive JSX
component.
0.9U closes the unsafe timer gap without exposing JavaScript timer globals or
adding lifecycle syntax. `velar/browser.after(ms, callback)` schedules one
callback and `every(ms, callback)` schedules non-overlapping repeated work;
both return an idempotent stop function owned by the sibling `cleanup` block.
Synchronous and asynchronous failures enter the application `timer` error
channel. Production Web exercises one-shot readiness, a live heartbeat, and
route cleanup across Chromium, Firefox, and WebKit.
0.9V closes the construction-failure ownership gap exposed by those timers.
A component now constructs transactionally: if setup or initial JSX creation
fails after acquiring resources, its sibling cleanup runs step-by-step, its
compiler scope is destroyed, and the original failure continues to the normal
mount/render recovery path. `velar/web.lazy` also catches a successfully loaded
component that fails during construction and renders its checked failure view
instead of leaving an unhandled Promise rejection. Production Web proves this
with a lazy page whose repeating timer would report a delayed leak if cleanup
did not run.
0.9W extends the same transaction to ordinary client-side navigation. A mounted
`Router` constructs the target before touching the active page; if construction
fails, the target cleans itself, the current DOM/component remains active, and
the application receives `render` / `router` instead of a native event escape.
Initial-route failures still reach the root fatal fallback. Production Web
clicks into a deliberately failing route, proves the prior page and its error
handler remain live, then navigates successfully again; a second timer leak
probe guards the rejected route.
0.9X removes the remaining blank-route seam. An unmatched `Router` now renders
a small accessible `Page not found` view when no custom fallback is supplied.
A custom fallback is checked as a route component, receives typed
`RouteContext`, and cannot hide unrelated required props behind the previous
`any` boundary. Runtime targets are validated before the active page is
destroyed, so unsafe JavaScript adapters retain the same transaction rule.
Production Web exercises a typed custom 404 from a direct deep link and then
recovers through ordinary navigation.
0.9Y closes an older coercion leak instead of treating it as JavaScript
compatibility. Ambient `Boolean(...)`, `Number(...)`, and `String(...)` are no
longer Velar globals. `str(value)` remains the explicit text conversion, while
`number(text) -> number?` accepts only a complete finite decimal and returns
`none` for empty, partial, hexadecimal, infinite, or otherwise invalid text.
SupportDesk drives this through direct `?page=2` pagination and proves that
`?page=12px` is not silently truncated or converted.
0.9Z fills the explicit structural-equality promise that the charter previously
showed without an implementation. `velar/json.deepEqual(left, right)` compares
Velar records and Lists recursively, Map values under native key identity, and
Sets under native membership. Class instances, functions, and other non-data
objects remain reference values; distinct cyclic graphs return `false` without
recursion failure. FlowBoard uses it to derive real Sample/Modified state from
its persisted task data.

Velar 0.8 completed the first application-language expansion. 0.8A adds checked dynamic
Velar imports and lazy components. A source expression such as
`import("./pages/about.vel")` is a compiler-owned dependency with a typed module
result, reverse-dependency invalidation, editor definition navigation, and a
real production code chunk. Runtime-computed paths, dynamic JavaScript imports,
and modules with top-level reactive exports fail closed. `velar/web.lazy`
provides loading, failure, retry, mount, and cleanup ownership for routed
components without introducing React-style effects.
0.8B adds indentation-based `match` / `case` / `else` control flow with strict
literal comparison, grouped cases, isolated branch scopes, duplicate/type
diagnostics, and complete-return analysis. It replaces JavaScript `switch`
fallthrough without copying Python's destructuring-pattern complexity.
0.8C closes the first real upload gap with `velar/http.formBody()`: applications
append text and opaque records returned by `velar/files.pick`, while the runtime
privately bridges the native `File` into a browser-owned multipart body. Source
code never receives `File`, `FormData`, boundary headers, or a new unsafe global.
0.8D adds typed rest parameters to named functions, methods, arrow callbacks,
and explicit `extern module` adapters. `...values: number` is a `List<number>`
inside the function while calls remain `total(1, 2, 3)` or
`total(1, ...numbers)`. Rest signatures survive module/LSP boundaries, and the
limited `.d.ts` bridge maps JavaScript array rest declarations without importing
TypeScript's broader type system.
0.8E adds native `Set()` as the third core collection. Construction uses either
`Set()` or `Set(list)`, never a generic constructor spelling; empty sets infer
their element from the first `add`. Typed membership, removal, clearing,
iteration, runtime data validation, module interfaces, LSP signatures, and the
limited `.d.ts` bridge all preserve the same `Set<T>` contract while emitted
code uses JavaScript's insertion-ordered `Set` directly.
0.8F is driven by the independent FlowBoard application. It adds string-backed
nominal enums with exhaustive `match`, stable identities across aliases,
enum-aware JSX bindings and editor navigation; typed `in`, `**`, complete Map
and Set snapshots; and secure UUIDs through Standard API 0.4. FlowBoard verifies
real CRUD, search, persistence, enum filters, lazy analytics, production output,
and browser behavior in Chromium, Firefox, and WebKit.

Velar 0.7 completed the production-hardening engineering sequence. Its first slice completes
application error control flow: source code can throw only `Error` instances,
`try`/`catch`/`finally` normalizes arbitrary JavaScript failures to a reliable
`Error` at the Velar boundary, thrown paths participate in return-completeness
analysis, and `%` / `%=` retain JavaScript remainder semantics. 0.7B adds
application error reporting and recovery, manifest-declared public
configuration, structured leveled logging, lazy root mounting, last-valid-DOM
retention, async mounted blocks, and failure-tolerant cleanup.
0.7C adds project-owned `.browser.test.vel` suites through
`velar test --browser`, a generated-project test, packed-CLI browser execution,
a root-base Netlify deployment adapter, clean format-2 project contracts, and repeated
route/cleanup production soak. 0.7D closes the production-artifact loop with strict
`velar verify` integrity checks and `velar preview`, which refuses to serve an
unverified or modified build. External preview and release authority remain
separate gates.
0.7E removes random temporary paths from bundling so identical inputs produce
byte-identical assets and the same `buildId`; production source maps now require
explicit `web.build.sourceMaps: true` and are off in generated projects.
0.7F adds `velar verify-deployment`: it compares a verified local build against
the actual HTTPS deployment byte-for-byte, checks MIME/security/cache headers,
probes root and SPA routes, and requires missing hashed assets to remain 404.
0.7G makes that evidence machine-readable: `--json` emits a versioned
deployment-verification report, and a credential-free manual GitHub workflow
rebuilds Release Studio, verifies the supplied origin, attests the report and
both manifests, and uploads them without deploying or publishing anything.
The internal 0.7 engineering sequence is complete through 0.7G; real external
preview evidence and release authority remain separate, currently deferred gates.

Velar 0.6 established the language-maturity baseline. 0.6A adds native single inheritance,
explicit base construction, `super`, mandatory `override`, abstract classes and
methods, static methods, built-in `Error` inheritance, subtype checking, and
cross-module inherited-member analysis. 0.6B adds the independently versioned
Core Standard API, and 0.6C establishes its initial surface. Standard API 0.4
now contains 133 exports across collections, text, math, JSON, async, URL,
time, secure IDs, and structured logging modules. Compiler-owned
lightweight polymorphic inference replaces user-facing generics. The compiler,
official `@velarscript/web` framework, project creator, and CLI build reproducible,
version-locked JavaScript plus `.d.ts` tarballs with SHA-256 and source
identity, while rehearsal and strict candidate modes remain incapable of
silently publishing. GitHub CI covers Node 24 on Linux, macOS, and Windows plus
development and production Web flows in three browser engines.

Velar source libraries use npm itself: a package publishes `.vel` source with
`package.json` `velar.entry`, and the compiler checks and bundles that source as
part of the application graph. Compiler/framework packages opt into automatic
project activation through generic `velar.extension` metadata. The CLI passes
registry package operations to npm without a shell, leaves dependency and lock
ownership there, and atomically changes only `velar.json` extension fields.
Development builds provide compile/runtime
overlays, `.vel` stack mapping, full-graph hot invalidation, and a
machine-readable status endpoint. Production builds use isolated staging,
emit hashed assets, strict CSP metadata, static-host fallback/header/cache
contracts, and deterministic format-3 framework build identity with SHA-256
identities. The manifest records the framework package, capability, target,
host-protocol version, API version, and framework artifact kind.

The stable Web API is independently versioned at 0.8. Ten explicit Web
modules provide base-aware routing and metadata, typed HTTP, local/session/
IndexedDB persistence, accessible forms, browser environment helpers,
cross-browser files, WebSocket/SSE realtime connections, typed tests,
application error ownership, and validated public configuration.
Implicit browser globals are rejected in ordinary Velar source and diagnostics
lead to these modules or an explicit JavaScript boundary. The 15-module Release
Studio passes Chromium, Firefox, and WebKit against both the development server
and the CSP-enabled static production build. Packed toolchains also run through
the real generic Workbench LSP host. The 0.6 language baseline and Web API 0.8
are the foundation now being hardened toward production use.
`velar/game`, SSR/server execution, a custom package registry, and a custom
debug protocol remain deferred.

The language authority is [docs/language-charter.md](docs/language-charter.md),
with the current internal 1.0 gate in
[docs/1.0-acceptance.md](docs/1.0-acceptance.md), milestone history in
[docs/0.9-acceptance.md](docs/0.9-acceptance.md), the completed 0.8 gate in
[docs/0.8-acceptance.md](docs/0.8-acceptance.md), and the completed 0.7 gate in
[docs/0.7-acceptance.md](docs/0.7-acceptance.md). The production-readiness
requirements are tracked in
[docs/production-readiness.md](docs/production-readiness.md). The stable public Web surface
is documented in [docs/web-api.md](docs/web-api.md). Implementation status is recorded in
[docs/implementation-status.md](docs/implementation-status.md), and the
compiler/editor joint-delivery contract is documented in
[docs/workbench-integration.md](docs/workbench-integration.md).
The Core API is documented in
[docs/standard-library.md](docs/standard-library.md).
Release and hosting contracts are documented in
[docs/release-process.md](docs/release-process.md) and
[docs/static-deployment.md](docs/static-deployment.md).

## Development

Requires Node.js 24 or later.

```sh
npm install
npm run check
npm test
npm run test:packages
npm run test:browser
```

Check and build a Core program:

```sh
npm run velar -- check examples/core.vel
npm run velar -- build examples/core.vel --out-dir dist
node dist/core.js
```

Run a Web application with live recompilation:

```sh
npm run velar -- dev examples/todo
```

A normal project uses `velar.json`, so commands need no entry argument:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "outDir": "dist",
  "publicDir": "public",
  "extensions": ["@velarscript/web"],
  "web": {
    "title": "My Velar App",
    "base": "/",
    "publicConfig": {},
    "build": { "sourceMaps": false },
    "security": { "contentSecurityPolicy": true },
    "deployment": { "spaFallback": true, "adapter": "neutral" }
  }
}
```

```sh
npm run velar -- dev examples/production-web
npm run velar -- test examples/production-web
npm run velar -- test examples/production-web --browser all
npm run velar -- build examples/production-web
npm run velar -- verify examples/production-web
npm run velar -- preview examples/production-web
npm run velar -- verify-deployment examples/production-web --url https://preview.example.com
npm run velar -- verify-deployment examples/production-web --url https://preview.example.com --json
npm run preview:prepare
```

Create and validate a new project:

```sh
npm run velar -- create my-app
npm run velar -- format my-app --check
npm run velar -- test my-app
```

Format 2 is a clean break: Core projects declare `"extensions": []`; Web
projects install and declare `@velarscript/web`. Legacy manifests are rejected
instead of upgraded implicitly or through a compatibility command.
The project loader discovers the package's independent `/compiler` and `/host`
entries. Web owns HTML, CSP, reload, deployment projection, and browser-test
metadata; CLI owns only generic host mechanics.

Build a Web application:

```sh
npm run velar -- check examples/api-dashboard
npm run velar -- test examples/api-dashboard
npm run velar -- test examples/api-dashboard --browser all
npm run velar -- build examples/api-dashboard
```

Production builds bundle npm and Velar standard modules, tree-shake and minify
the result, split checked dynamic Velar modules, and hash JS/CSS filenames. Linked
source maps back to `.vel` sources are emitted only when explicitly enabled.
Builds also emit `velar-build.json`,
`velar-deploy.json`, and an optional `404.html` SPA fallback.
After deployment, `verify-deployment` accepts an HTTPS origin through `--url`
or `VELAR_DEPLOYMENT_URL`; HTTP is restricted to local loopback verification.
`preview:prepare` builds the checked-in root-base
`examples/production-web/velar.netlify.json` profile into
`release/external-preview/site`. It reuses the Release Studio source graph,
enables the proven Netlify adapter, disables public source maps, verifies the
result, and replaces only a prior verified Velar build directory.

Rehearse and verify the complete non-publishing toolchain artifact:

```sh
npm run release:rehearse
npm run release:verify -- release/rehearsal
```

A reusable Velar package publishes source through ordinary npm metadata:

```json
{
  "name": "my-velar-library",
  "version": "1.0.0",
  "velar": { "entry": "src/index.vel" },
  "files": ["src"]
}
```

Applications import it normally: `import {Button} from "my-velar-library"`.
Package-relative `.vel` imports are confined to the package root.
Reusable Web components follow the same source-package path with an explicit
Web peer contract; see [docs/component-packages.md](docs/component-packages.md).

Start the language server used by VelarOS Workbench:

```sh
npm run velar -- lsp
```

The server advertises standard LSP inlay hints. Editors may display inferred
types after unannotated ordinary, reactive-state, and computed bindings; the
compiler remains the type authority and explicit annotations are not repeated.
It also advertises standard document highlights backed by the same exact symbol
index as references, filtered to the requested document.
Standard full-document semantic tokens classify declarations and exact
references as types, classes, enums, functions, methods, properties, variables,
or parameters, with declaration/readonly/static modifiers. Standard quick fixes
are intentionally limited to semantics-preserving rewrites: JavaScript-style
`===`/`!==` become Velar's already-strict `==`/`!=`, and indentation tabs become
the four spaces the lexer already counts them as.
Completion combines the familiar language/Core surface with visible lexical
symbols. Inner bindings shadow outer names, declarations that are not yet in
scope stay hidden, imports and predeclared module symbols remain available, and
member items carry the exact field or callable type recorded by the analyzer.
Member completion and signature help also follow checked intermediate
expressions, including collection literals, nested record fields, and Web API
chains; local type aliases remain local in displayed signatures. Hover uses the
same expression facts, and member definitions resolve by owning type through
import aliases and inherited classes rather than by globally matching a field
name. Standard-library and anonymous-object members do not claim a source
definition that does not exist.
Source-backed member references use that same owner identity. Record-field
rename is atomic across declarations, typed construction/return keys,
destructuring, runtime-Type object literals, and member access; shorthand keys
expand to preserve their local binding. Class member rename groups inherited
field contracts and complete abstract/override/`super` method chains, while
static and instance fields/getters/methods remain separate. Inherited static members
navigate to their declaring base class instead of stopping at the subclass. A
collision anywhere in the class hierarchy rejects the edit instead of returning
a partial workspace change.
User-component parameters and JSX attributes also share one identity across
module aliases: definition, hover, references, and rename cover the parameter,
component-body uses, and every checked JSX call site. Native attributes remain
Web-owned, and the implicit JSX `children` contract is deliberately
non-renameable because content syntax has no attribute token to rewrite.
Completion follows the same context boundaries: `<Ch` offers matching visible
components, an empty `<` also offers native Web elements, and a component start tag offers its checked parameters,
a native tag offers supported attributes/directives, and a contextually typed
object literal offers only missing fields. Once the cursor enters an attribute
or field value, ordinary lexical symbols are restored.
