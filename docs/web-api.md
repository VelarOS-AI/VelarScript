# VelarScript Web API

Status: active clean-break design
Runtime: existing browser JavaScript engine; no virtual DOM

VelarScript Web applications install and declare `@velarscript/web`. The extension
owns JSX, components, reactivity, lifecycle, controlled Look values, Web types, editor
contributions, and explicit Web modules instead of implicit
browser globals. The compiler reports `VEL3008` for direct source-level use of
`console`, `document`, `window`, `navigator`, `location`, `history`, `fetch`,
`JSON`, `Math`, or `Date` and points to the official module or an explicit
JavaScript boundary. This document defines the current API; removed experiments
do not remain as compatibility aliases.

## One call convention

Every fixed Web API uses the same call rule as an ordinary VelarScript function:
arguments may be positional or explicitly named with `name=value`. Names are part
of the checked API contract, optional values may be omitted, and supplied
expressions still run from left to right as written even when their names are out
of declaration order.

```velar fragment
const request = http.get(options={timeout: 5000}, url="/api/users")
const current = storage.get(target=User, key="current")
storage.set(value=current, key="current")
scrollTo(behavior="smooth", y=400, x=0)
```

Use positional arguments when their meaning is already obvious and named
arguments when they remove ambiguity. The compiler rejects unknown, repeated,
or missing names instead of guessing. Callback parameter names remain local to
the callback; only the function that receives the callback defines the public
call contract.

## Component constructor values

The Web extension exposes `Component` as the structural type of a component
constructor. Use bare `Component` when a host will pass no application props,
or write a named JSX-prop contract such as
`Component<(item: Item, compact?: bool) -> WebNode>`. Optional markers govern
omission: `compact?: bool` may be absent, whereas `compact: bool?` is required
and may contain `null`. All components also accept the implicit optional host
props `class` and `look`.

A compatible constructor accepts every prop the contract permits and adds no
new required prop; additional optional props are allowed. Render a received
constructor with a PascalCase JSX identifier (`<View item={item} />`). It is
not an ordinary callable and is distinct from an already-rendered `WebNode`.
The selected constructor keeps its instance while its identity is unchanged,
including across live prop updates. Replacing it with a different constructor
runs cleanup for the old instance and mounts the new one; host `class` and
`look` forwarding follows the new root.

## Component Handles and `ref`

A component may expose a narrow imperative Handle without exposing its internal
scope, state cells, or component runtime object. The declaration names one
concrete record contract with `exposes T` and provides exactly one matching
record value with `expose expression`:

```velar fragment
type EditorHandle:
    focus: () -> null
    reset: () -> null
    value: () -> string

component Editor(initial: string = "draft") exposes EditorHandle:
    state text = initial

    def focusEditor() -> null:
        pass

    def reset() -> null:
        text = initial

    def value() -> string:
        return text

    expose {focus: focusEditor, reset, value}
    return <input host bind:value={text} />

component Page:
    let editor: EditorHandle? = null

    mounted:
        if editor:
            editor.focus()

    return <Editor ref={editor} look:borderWidth={1px} />
```

`expose` is a position-independent top-level component declaration: it may be
written before or after the single top-level `return`, but not inside a branch,
function, lifecycle block, or other nested scope. Convention keeps `return`
last and places `expose` immediately before it. Regardless of source order, the
root is constructed before the Handle value is evaluated, so exposed element
refs already refer to their constructed native elements.

Component `ref` is a compiler-owned JSX directive rather than a prop. It
requires a mutable optional `let` binding because cleanup restores `null`.
Components without `exposes` reject `ref`, and component props cannot be named
`ref`. The Handle becomes available after the child root has been constructed
and before the parent's `mounted` block runs.

The runtime creates one shallow-frozen Handle per component instance. Callable
fields are guarded capabilities: after the instance is destroyed, a saved old
Handle throws instead of reaching destroyed state or DOM. Conditional removal,
keyed removal, and dynamic constructor replacement all clear the active ref;
identity-checked cleanup prevents an old instance from clearing a newer Handle
stored in the same binding.

Use Handle functions for imperative commands such as `focus`, `reset`, `open`,
`close`, and `scrollTo`. Prefer getter functions over publishing mutable state
objects, and use callback or Component props when the parent is configuring or
replacing behavior. Styling remains declarative: every component accepts
`class`, `look`, and `look:*` on its stable host. A component that wants to
style internal parts should expose named Look props instead of leaking DOM
through its Handle.

The optional second argument of a structural component contract carries the
Handle type across locals, imports, exports, and dynamic component positions:

```velar fragment
type EditorHandle:
    reset: () -> null

type EditorView = Component<(initial?: string) -> WebNode, EditorHandle>
```

Handle compatibility is covariant: a constructor used as `Component<Props,
Handle>` must expose a value assignable to `Handle`. Omitting the second type
argument means callers cannot request a ref through that structural contract.

## `velar/look`

Visual unit suffixes are language syntax and require no import. `px`, `rem`,
`em`, `vw`, `vh`, `vmin`, and `vmax` are `Length` values; `%` is Percentage;
`fr` is TrackFraction; `ms` and `s` are Duration; `deg` and `turn` are Angle.
They can be bound, exported, imported, and calculated outside a `look:` block.

The constructors are ordinary named module functions:

```velar
import {border, clamp, rgb, spacing} from "velar/look"

export const compact = 40rem
const accent = rgb(45, 79, 190)
const fluidWidth: LengthPercentage = 100% - 32px

export const panelLook = look:
    width = fluidWidth
    padding = spacing(24px, 16px)
    border = border(1px, accent)
    fontSize = clamp(16px, 3vw, 24px)

    if viewport.width <= compact:
        padding = 12px
```

Available named functions are `color`, `rgb`, `rgba`, `hsl`, `alpha`,
`lighten`, `darken`, `border`, `shadow`, `linearGradient`, `asset`, `minmax`,
`repeat`, `tracks`, `transition`, `spacing`, `min`, `max`, and `clamp`. Because
they are module values, aliases and higher-order use retain the same checked
signature. There are no implicit Look builder globals.

Visual addition and subtraction require compatible dimensions. Length mixed
with Percentage produces LengthPercentage; mixed units lower to `calc(...)`.
Multiplication and division accept a unit value and a finite scalar. Unit by
unit multiplication, division by a unit, and arithmetic over colors or
composite builders are rejected. Viewport thresholds must resolve at compile
time to a local or imported const `px`, `rem`, or `em` token.

For one-off base properties, native elements and component hosts accept
`look:property="text"` or `look:property={expression}`. The directives use the
same checked camelCase property table as `look:` and form one anonymous Look
after any `look={value}` composition. Duplicate directives fail checking and a
`null` expression removes the composed property. Hooks, media conditions,
pseudo-elements, and spreads remain exclusive to a named or local full Look;
forms such as `look:hover:color` do not exist.

Checked `style:property="text"` and `style:property={expression}` directives
exist only as a native inline-priority compatibility layer. They reuse Look's
camelCase property table, property types, visual builders, safe serialization,
reactive updates, and `null` removal, but write the real CSS property on the
component host instead of producing a Look rule. Prefer Look: inline Style
overrides normal Look and class declarations for the same property, including
stateful Look rules. Raw `style="..."`, Style objects, conditional directive
names, and reusable Style values remain unsupported.

A base Look selector and a simple class selector have equal specificity, so
their winner is determined by ordinary CSS source order; `before look` and
`after look` imports make that order explicit. Compound selectors,
stateful Look selectors, inline Style, and `!important` participate in the
normal CSS cascade rather than receiving a separate Velar priority system.

Official Web modules validate option records as own enumerable data fields and
copy dense Lists before using them. Router, Forms, HTTP, Storage, Files, and
Realtime share those guards rather than maintaining target-specific object
walkers. The guards capture their Object, Array, Set, Symbol, and Reflect
operations when each generated module initializes, so JavaScript loaded later
cannot replace a constructor or prototype method to bypass unknown-field,
accessor, sparse-List, or reactive-List handling. This is a runtime ownership
rule, not a new source-level collection type: ordinary VelarScript records and
Lists keep their documented identities.

## Performance contracts

`computed(() => value)` is the single derived-cache API. It returns a callable
accessor; there is no second `memo` spelling and no manual batching API.
Repeated-computation and assignment-coalescing behavior below is a compiler and
runtime contract rather than additional application controls. Removed
experiments do not remain as aliases — `memo` and `batch` are ordinary
identifiers.

### Synchronous assignment bursts publish once

Consecutive synchronous `state` assignments without an intervening read of an
invalidated computed accessor publish once: every affected computed accessor,
watch, and render observer re-runs a single time per burst, delivered on the
microtask flush after the synchronous work completes. Reading an invalidated
computed accessor synchronously refreshes it immediately; the pending flush
does not recompute it again, and changed results still reach other observers.
Assignments still commit their values immediately — a read between two
assignments always sees the latest value, and computed invalidation is
synchronous through every downstream computed accessor, so a same-turn read of
a derived chain cannot observe an intermediate stale cache and state never
tears — and the burst may span ordinary function calls; the synchronous extent
is what counts. Render and watch observers are still notified only after the
recomputed public result actually changes.

```velar fragment
def commitSend(userMessage: Message, reply: Message) -> null:
    messages = [...messages, userMessage]
    messages = [...messages, reply]
    streamingMessageId = reply.id
```

All three assignments above publish as one commit: a computed accessor reading
`messages` recomputes once, not twice, and a watch on it fires once. The
boundary of the contract is the synchronous extent: a burst spread across
`await` boundaries publishes per assignment, and a throw mid-burst does not
tear state — what was assigned before the failure still publishes on the
flush.

### Deep state tracks the property or collection key that was read

Only ordinary mutable records receive lazy reactive proxies. `List`, `Map`,
and `Set` keep their native identities and are tracked by compiler-owned
collection operations. Classes, functions, DOM and other host objects, frozen
records, and non-extensible records are never wrapped. The proxy cache and
dependency graph have one versioned owner on `globalThis`, so application
modules and lazy chunks share one raw/proxy identity.

The graph does not rediscover JavaScript collection methods while the app is
running. A generated reactive module captures the Set, Map, WeakSet, WeakMap,
Array, Object, Proxy, and Reflect operations used by its cells, observers,
queues, and deep-record proxies when that module initializes. Replacing an
ambient constructor, static helper, or collection prototype later cannot
redirect subscriptions, cleanup, batching, deep mutation, or watch equality.

A reactive observer subscribes to the property or collection key it reads.
Nested mutations bubble a version change to owning state for deep watches, but
unrelated property and `Map`-key consumers remain clean. List size and shifted
indexes, Map/Record key structure, and Map values are distinct dependencies:
inserting at index `i` invalidates only tracked indexes at or after `i`, while
updating an existing Map value does not invalidate `keys()` or `size`.
Clearing a Map, Set, or Record invalidates every concrete key that has an active
subscriber as well as its iteration and structure dependencies.
Temporary Lists produced by `map`/`filter` do not become permanent parents of
every item they expose, and replacing a state root detaches the old root from
the deep parent graph. Keyed JSX rows receive reactive record items even though
dense-List validation intentionally reads raw descriptors.

```velar fragment
state messagesById: Map<string, Message> = Map()
state latestBySession: Map<string, Message> = Map()

def appendChunk(replyId: string, chunk: string) -> null:
    const reply = messagesById.get(replyId)
    if reply:
        reply.text += chunk

return <ul>{sessions.map(session =>
    <SessionRow key={session.id} preview={messagePreview(latestBySession.get(session.id))} />
)}</ul>
```

Appending a chunk performs one `Map.get` and one property assignment. Only the
message body and the row whose preview read that message's `text` are
invalidated; no identity-keyed derivation cache can become stale. Serialization,
storage, HTTP, realtime, forms, unsafe bridges, and equality/test boundaries
unwrap through the same `toRaw` operation before validation. `Map` keys and
`Set` members are unwrapped before lookup so a reactive record and its raw
identity cannot split membership.

## `velar/app`

```velar
import {onError, reportError} from "velar/app"

component RuntimeStatus:
    state message = "ready"

    def capture(phase: string, detail: string) -> null:
        message = phase + ":" + detail

    const stopErrors = onError(report => capture(report.phase, report.error.message))

    def failDeliberately() -> null:
        reportError(Error("Manual failure"), "manual", "diagnostic action")

    cleanup:
        stopErrors()

    return <button on:click={failDeliberately}>{message}</button>
```

- `onError(callback)` observes application failures and returns an explicit
  cleanup function. Reports contain `error`, `phase`, `detail`, `component`,
  and `timestamp`; foreign JavaScript values are normalized to `Error`.
- `reportError(error, phase="manual", detail="")` deliberately submits an
  application error without throwing it again.
- Error metadata is controlled text, never an implicitly converted object.
  Reports cap `phase`, `detail`, and `component` lengths, reject accessors and
  unknown fields at dynamic boundaries, and reuse one versioned runtime owner
  across application modules and lazy chunks. Error timestamps and every
  framework microtask use the Date/queue operations captured with that runtime;
  later ambient replacement cannot stall reactivity or falsify a report. Error
  identity, report freezing, metadata discovery, timestamp validation, handler
  registration, and native Promise rejection observation are captured at module
  initialization too, so post-load changes to Error/Object/Number/Promise/Set
  cannot redirect either manual reports or managed asynchronous failures.
- The compiler reports failures from initial `mount`, reactive `render` and
  synchronous `watch` blocks, synchronous or asynchronous events, `mounted`,
  and `cleanup`.
- Event handlers and lifecycle callbacks are non-tracking execution boundaries.
  Reads performed by `mounted` or `cleanup` cannot become dependencies of an
  enclosing conditional/keyed render that happened to mount or destroy the
  component, and a synchronously dispatched event cannot inherit a framework
  observer. State writes still notify their actual render/watch consumers.
- JSX rendering and `computed` callbacks are synchronous. Async component data
  belongs in `resource`; explicit UI operations belong in `action`, declared in
  the component that triggers them or at module scope when a shared store owns
  the operation and its `pending`/`error` surface; setup that must finish after
  insertion belongs in `mounted`.
- A `computed` failure is cached as part of the derived result state and is
  rethrown to its managed consumer. Recovery from failure to a value is a real
  result transition even when that value equals the last successful value, so
  downstream computed chains wake and recover without publishing a duplicate
  watch value. Once the last consumer is disposed, the computed detaches from
  its upstream dependencies and recomputes only if read again.
- `resource`, `action`, and `tick` use the Promise constructor plus
  `resolve`/`reject`/`then` operations captured when the generated Web module
  initializes. Resource/action surface construction uses the same captured
  Object operations as the reactive graph. Later replacement of those ambient
  constructors, static operations, or prototypes cannot turn an owned async
  start into a synchronous escape or redirect its completion. A disposed
  resource reload remains a resolved no-op; calling a disposed action remains
  a rejected owned `Error`.
- Managed callbacks from browser/media/online/visibility watchers, storage
  watches, WebSocket handlers, and server-sent-event handlers report both
  synchronous failures and rejected promises through the same `velar/app`
  channel. Only actual Promises are observed; arbitrary thenables remain ordinary
  callback results and their properties are not probed. Failures do not escape
  as unowned native event failures.
- Root mounting is lazy. If the initial render fails, the application receives
  the report and renders a compiler-owned accessible fatal state instead of a
  blank page. Component setup and initial JSX construction are transactional:
  failure runs sibling cleanup, destroys the incomplete scope, and preserves
  the original error. Dynamic and keyed updates build the replacement first,
  so a failed update retains the last valid DOM and discards its incomplete
  scope. Ordinary and keyed JSX Lists both read one checked dense List snapshot;
  mutation during rendering and JavaScript iterator overrides cannot change the
  values participating in that update.
- Emitted JSX and runtime-implemented `velar/web` components use the same small
  DOM host ABI. A generated module captures Document/Node identity, node
  factories, mount/removal operations, bounded child collections, and the
  Array/Set/number/string operations needed by DOM rendering when it initializes.
  Code loaded later cannot replace `document`, `Node`, or their prototype
  methods to redirect element/text/fragment creation, mount, destroy, Router,
  Lazy, or dense JSX List expansion. Explicit non-browser test hosts are
  data-only seams; accessor-backed substitutes are not invoked.
- Root construction passed to `mount` is synchronous so the runtime can own its
  failure transaction. Await module-level preload work into a binding before
  calling `mount`; component data continues to use `resource`.
- A direct JSX component root remains a stable host. Any other WebNode root
  expression, including a conditional root, owns a dedicated dynamic child
  scope: updates construct the replacement transactionally, destruction removes
  the currently selected nodes, and component setup is not rerun. One component
  instance may be mounted exactly once; a repeated mount fails explicitly
  instead of silently transferring or losing DOM ownership.
- `unsafe:html` is an explicit wholesale `innerHTML` assignment on every
  reactive update. It does not morph DOM or preserve descendant identity.
  Incremental Markdown therefore requires a parser-owned stable-prefix/dirty-tail
  contract and a separately designed DOM morph boundary; it is not inferred
  from an arbitrary trusted HTML string.
- Cleanup remains the sibling `cleanup` block, not a React-style effect. Its
  independent cleanup steps continue after one fails, and every failure is
  reported. `mounted` may await asynchronous work; `cleanup` remains
  synchronous and should start no unowned background work.
- An automatic failure with no installed handler is surfaced through the host
  runtime rather than silently discarded. Error handlers therefore own their
  lifetime and must be removed during cleanup.
- An application may install at most 1,000 error handlers. Manual report phases
  are limited to 256 characters and details to 64 KiB before entering the
  shared error channel.

## `velar/config`

```json
{
  "web": {
    "publicConfig": {
      "apiBase": "/api",
      "releaseChannel": "preview"
    }
  }
}
```

```velar
import {has, keys, publicConfig} from "velar/config"

type RuntimeConfig:
    apiBase: string
    releaseChannel: string

const config = publicConfig(RuntimeConfig)
```

- `publicConfig(Type)` validates the complete manifest value through the same
  VelarScript `type` declaration used everywhere else and returns the named type.
  `has(key)` and sorted `keys()` support optional capability discovery.
- Only `velar.json.web.publicConfig` is read. It must be a JSON object, is
  limited to 64 KiB, rejects non-finite/non-JSON values and the reserved keys
  `__proto__`, `prototype`, and `constructor`, and is recursively frozen.
- Public configuration is baked into the content-hashed application entry at
  build time. VelarScript never implicitly reads `.env`, `process.env`, server
  configuration, or secrets, and this boundary must contain public values only.

## `velar/web`

```velar fragment
import {Head, Link, NavLink, RouteContext, Router, announce, back, currentRoute, domId, forward, lazy, navigate, redirect, reload, route} from "velar/web"

component PageLoading:
    return <main aria-busy="true">Loading…</main>

component PageFailed(error: Error):
    return <main role="alert">{error.message}</main>

const Reports = lazy(() => import("./pages/reports.vel"), "Reports", PageLoading, PageFailed)
```

- `route(path, component)` declares an application route. A pattern is a pure
  pathname beginning with `/`; query/hash text, backslashes, empty segments,
  and a redundant trailing slash are rejected. It may contain `:name`
  parameters or one whole terminal `*` segment. The wildcard value is exposed
  as `route.params.get("wildcard")`, so a named `:wildcard` parameter cannot be
  combined with `*`.
- `RouteContext` is an importable named data type with `path`, string
  `params`/`query` Maps, and `hash`. A route component may require only its
  `route: RouteContext` prop; invalid path parameters, repeated parameters,
  non-terminal wildcards, non-components, wrong route props, and other required
  props fail checking before browser execution. Dynamic route strings retain
  the same runtime validation.
- `lazy(loader, exportName, loading=null, failed=null)` returns the exported
  component with its original prop contract. It owns one cached successful
  module load, retries after a failed load, mounts only the active child, and
  destroys loading or resolved children when the route leaves. The loader must
  be a zero-argument checked dynamic VelarScript import and `exportName` must be a
  literal component export. Failures report through `velar/app` with the
  `resource` phase and render either the supplied failure component or an
  accessible default alert.
- The lazy boundary also owns failures after the module has loaded: if the
  selected component throws during construction, its transactional cleanup
  finishes before the same lazy failure view is rendered. A failing custom
  failure component is reported as `render`/`lazy-fallback:<name>` and replaced
  by a built-in accessible alert rather than becoming an unhandled rejection.
  Loading and failure fallbacks must actually return components; a callable
  returning an arbitrary DOM value is rejected.
- `Router(routes, fallback=null)` renders the first matching component. Its
  route context contains application-relative `path`, decoded `params`, parsed
  `query`, and `hash`. When no route matches, an omitted fallback renders a
  small accessible `Page not found` view instead of an empty router. A custom
  fallback is a checked route component: it may accept `route: RouteContext`
  and cannot require unrelated props.
- A Router accepts at most 10,000 routes and compiles their matchers once when
  it is constructed. Route/navigation URL text is limited to 2 MiB, route
  patterns to 8,192 code units, and decoded query snapshots to 100,000 fields;
  a hostile direct URL cannot force an unbounded route table or repeated
  pattern compilation.
- Browser path, query, and hash values must already be strings; routing never
  calls conversion hooks on malformed host values. `RouteContext.is/parse`
  inspect only ordinary data fields, reject accessors, and bound the combined
  text stored in params and query Maps.
- A percent-encoded route parameter that cannot be decoded is treated as a
  non-match and reaches the normal 404 fallback. A malformed direct URL cannot
  turn an otherwise recoverable unknown route into an application-fatal render.
- A mounted Router constructs the target component before destroying or
  replacing the active page. If construction fails, the target's transactional
  cleanup completes, the prior page remains mounted, and `velar/app` receives
  phase `render`, detail `router`, component `Router`. The URL reflects the
  attempted navigation and another navigation may recover normally. Failure of
  the initial route is rethrown to the root mount boundary so the accessible
  fatal state is not replaced by an apparently successful empty router. The
  runtime also validates a target returned through an unsafe JavaScript adapter
  before commit; an invalid target follows the same retained-page failure path.
- `Link` preserves native anchor behavior and intercepts only an unmodified
  primary click on an internal application path. Click metadata and
  `preventDefault` come from captured native Event/MouseEvent operations; a
  synthetic accessor-backed click is reported through `velar/app` and cannot
  execute an override before navigation.
- `NavLink(to, exact=false, replace=false)` retains the same native click
  behavior for internal application paths and owns `aria-current="page"` while
  its target is active. Non-exact links match descendant paths except that `/`
  matches only the application root. Matching remains application-relative
  under `web.base`, normalizes trailing slashes, follows history changes, and
  releases its listener with the component.
- `navigate(to, {replace, scroll})`, `redirect`, `back`, `forward`, and
  `reload` expose intentional history operations. `currentRoute()` returns a
  typed snapshot of the current application-relative route. Navigation options
  are a data-only record with boolean `replace`/`scroll` fields and are fully
  validated before history or scrolling changes. Location getters, History
  methods, URL parsing, PopStateEvent dispatch, animation frames, scrolling,
  and route listeners use the host ABI captured when `velar/web` initializes;
  later global replacement or instance shadowing cannot redirect navigation.
- `Head` owns `title`, `description`, `canonical`, `robots`, `image`,
  `themeColor`, and the document `language` tag for its component lifetime and
  restores prior values on cleanup.
- `announce(message, priority="polite")` writes to a compiler-owned live
  region; priority is `polite` or `assertive`.
- `domId(prefix="velar")` returns an application-local, monotonically unique DOM ID
  for component setup. It exists for accessible `aria-labelledby`,
  `aria-describedby`, and label/control relationships without requiring a
  cryptographic UUID. Prefixes must start with a letter, contain only letters,
  numbers, `_`, or `-`, and are limited to 64 characters.

Dynamic `Head`, `Router`, `Link`, and `NavLink` prop records accept only their
documented enumerable data fields. Accessors, symbols, unknown fields, invalid
booleans, and malformed route Lists fail before DOM or history effects; JSX
child Lists use the same dense data-element boundary as Core.

### Native SVG JSX

Inline `<svg>` is part of native VelarScript JSX rather than an image-string or
framework adapter. SVG namespace ownership crosses nested elements, reactive
branches, keyed Lists, fragments, and ordinary or lazy user components. A lazy
SVG boundary uses a native `<g>` host and forwards the namespace to loading,
failure, and resolved components instead of inserting an HTML wrapper. `<foreignObject>` owns
an HTML child subtree, while a nested `<svg>` re-enters SVG. Scoped CSS,
reactive attributes, events, stable keys, refs, and component cleanup retain
their ordinary VelarScript behavior across the boundary.

SVG roots require an accessible name through `<title>`, `aria-label`, or
`aria-labelledby`, unless a decorative graphic explicitly uses
`aria-hidden="true"`. Case-sensitive SVG attributes are preserved, and
`xlink:*`/`xml:*` attributes use their platform namespaces. API Dashboard is
the real production-project gate: it renders data-driven SVG bars through a
checked dynamic component chunk and embeds an HTML summary through `<foreignObject>`.

With `web.base` set to `/studio/`, `navigate("/settings")` resolves to
`/studio/settings` while the router still matches `/settings`. Development
provides deep-route fallback; a production host must apply the emitted SPA
fallback contract.

## `velar/http`

```velar fragment
import {HttpAbortError, HttpError, HttpTransportError, HttpTransportPhase, http} from "velar/http"

const request = http.get("/api/profile", {timeout: 5000})
const profile = await request.parse(Profile)
```

Incremental text bodies do not require buffering the whole response:

```velar fragment
const request = http.get("/api/events", {timeout: 120000})
async def consumeEventChunk(chunk: string) -> null:
    print(chunk)
    return null
await request.streamText(consumeEventChunk)
```

Multipart uploads use an explicit body builder and opaque file records:

```velar fragment
import {formBody, http} from "velar/http"
import {pick} from "velar/files"

const selected = await pick({accept: "image/*", multiple: true})
const body = formBody()
body.field("title", "Profile images")
body.files("images", selected)
const result = await http.post("/api/images", {body: body}).parse(UploadResult)
```

- `request`, `get`, `post`, `put`, `patch`, `delete`, and `head` create lazy
  requests. Options include string `Map` headers, body, timeout, `maxBytes`,
  credentials, and cache mode. `maxBytes` defaults to 16 MiB and may be an
  integer up to 64 MiB. Timeout defaults to 120,000 milliseconds on every HTTP
  target; it must be an integer from 0 through 600,000, and `0` explicitly
  disables the deadline.
- Options are plain data records with only documented fields. Accessors,
  symbols, class instances, unknown fields, non-string headers, invalid Fetch
  methods, and forbidden `CONNECT`/`TRACE`/`TRACK` fail at request creation.
  Credentials are `omit`, `same-origin`, or `include`; cache is `default`,
  `no-store`, `reload`, `no-cache`, or `force-cache`.
- Requests expose `response`, `json`, `text`, `streamText`, `blob`,
  `parse(Type)`, and `cancel`. Responses expose typed status, URL, and header
  fields plus the same body readers. `streamText` incrementally decodes valid
  UTF-8 chunks and awaits each consumer before pulling the next chunk. `blob()`
  returns an opaque checked `Blob`, not `any`; it may be
  passed back as an HTTP body but does not expose the native browser object or
  arbitrary fields.
- Fetch results are snapshotted and validated once before they enter the typed
  response object. Status/`ok`, status text, canonical URL, native headers, and
  body ownership cannot change between validation and use; response headers
  share the 100-field/64-KiB bound and returned URLs the 2-MiB URL bound. A
  response status must be an integer from 100 through 599, and `ok` must be
  exactly equivalent to the 200-through-299 range. Opaque or synthetic
  status-zero responses are rejected as invalid host metadata rather than
  entering `HttpError` or body processing.
- The HTTP module captures Fetch, Headers, native Response accessors, abort and
  timer operations, FormData, Blob, TextDecoder, and byte-array construction
  when it initializes. Later JavaScript replacement cannot redirect requests,
  intercept body assembly, or install response getters inside the typed
  snapshot path. Own accessors placed on a native Response are ignored in
  favor of the captured host prototype contract.
- Response bodies are consumed through captured native stream operations and
  accept only real `Uint8Array` chunks. Each accepted chunk is copied after its
  size passes the running budget, and a pathological stream cannot exceed one
  million chunks. A declared or streamed body over `maxBytes` is cancelled
  before it can be materialized; successful bytes are cached so repeated
  `text`/`json`/`blob` reads are stable, and concurrent buffered readers coalesce
  onto that one body read. `streamText` remains an exclusive incremental reader;
  it does not silently duplicate an active stream. JSON remains subject to the
  separate strict 16 MiB JSON contract even when a larger text/blob budget was
  requested. A `Content-Length` attached to a response with no actual body,
  such as HEAD metadata, describes a representation and does not create a
  false size failure. Declared-length parsing is captured when the module is
  initialized, so later mutation of application string, regex, or reflection
  operations cannot disable the preflight.
- Cancellation is idempotent and owns the whole lazy request. Cancelling before
  the first body reader prevents `fetch` from starting; cancelling an active
  request aborts it and immediately releases its owned deadline timer. Timeout
  ownership continues through `streamText` and all
  buffered body reads; it is not cleared merely because response headers have
  arrived. Cancellation and timeout reject with `HttpAbortError`,
  whose `reason` is `"cancelled"` or `"timeout"`, so application recovery does
  not depend on browser-specific abort errors.
- Native request or response-stream failures reject with
  `HttpTransportError`. Its typed `phase` is `HttpTransportPhase.request` or
  `.response`; the response phase may follow already-delivered `streamText`
  chunks. Fetch/protocol validation, UTF-8, bounds, and consumer failures are
  not relabelled as transport failures. `velar/http` does not retry implicitly;
  status policy, backoff, idempotency, and replay safety belong to the caller.
- Object bodies are snapshotted and JSON encoded when the lazy request object is
  created, not later when a body reader starts Fetch. They receive an
  `application/json` content type unless one was supplied. The generated header
  is included in the same 100-field/64-KiB request-header budget. Non-2xx
  responses throw `HttpError` with `status`, `url`, and an `unknown` body. Its
  URL is the final response URL after redirects; only a synthetic response
  without a URL falls back to the initial request URL.
- JSON request bodies use the same strict lossless data boundary as
  `velar/json`: records, dense Lists, finite primitives, and `null` are accepted;
  Map, Set, class/function values, cycles, sparse Lists, and non-finite numbers
  fail before `fetch` starts. Other bodies are explicit text, Blob, or form
  bodies; primitives are not silently converted, and GET/HEAD bodies fail.
- `formBody()` creates a multipart builder with `field`, `file`, `files`,
  `remove`, `has`, and `names`. String fields may be appended repeatedly;
  `file` accepts only one opaque record returned by `velar/files.pick`, and
  `files` accepts a list of those records. A forged structural object fails at
  runtime even if it resembles the public file metadata: native authority lives
  in a host-private shared WeakMap registry, not a copyable record field.
- Field names/values and optional file names are actual strings. The browser
  owns the multipart boundary. Supplying a `content-type` header
  with a form body is rejected rather than risking an invalid boundary. Native
  `File` and `FormData` are not source-level APIs.
- Headers are capped at 100 fields/64 KiB after generated headers, text and form
  values at 16 MiB of encoded UTF-8 transport bytes, and multipart bodies at
  100,000 fields. JSON first follows its lossless structural/code-unit contract,
  then its serialized text follows the same UTF-8 transport-byte ceiling as a
  plain text body. Timeout uses the host timer range; these limits are checked
  before Fetch or FormData mutation.
- `parse(Type)` uses the existing VelarScript `type` runtime validator; there is no
  second schema system. The browser still performs cancellation underneath,
  while VelarScript normalizes the observable failure contract. A dynamic invalid
  Type fails before a lazy request starts or a response body is consumed.

## `velar/storage`

```velar
import {database, storage} from "velar/storage"

type Settings:
    theme: string

component PreferencesPanel:
    const preferences = storage.scope("studio")
    const stopWatching = preferences.watch("settings", Settings, (next, previous) => print(next), 262144)
    const settings = preferences.get("settings", Settings, {theme: "system"}, 262144)
    const cache = database("release-studio")

    async def save() -> null:
        preferences.set("settings", settings, 262144)
        await cache.set("settings", settings, 262144)

    mounted:
        save()

    cleanup:
        stopWatching()

    return <p>{settings.theme}</p>
```

- `storage` and `session` wrap local and session storage. Both provide typed
  `get`, JSON `set`, `has`, `keys`, `remove`, `clear`, and `watch`.
- `get(key, Type, fallback=null, maxBytes=16777216)`,
  `set(key, value, maxBytes=16777216)`, and
  `watch(key, Type, callback, maxBytes=16777216)` accept a positive integer
  encoded-value budget up to the 16 MiB hard ceiling. Named arguments may set
  `maxBytes` without supplying a fallback. The budget uses the same
  compiler-owned UTF-8 counter as HTTP and `velar/text.utf8Size`, including its
  treatment of surrogate pairs and unpaired surrogates.
- A local/session read whose stored JSON text exceeds `maxBytes` returns the
  declared fallback without parsing it. A write serializes through strict JSON
  and throws `RangeError` before any storage mutation when the encoded text is
  over budget. A watch maps an individually oversized old or new value to
  `null`; it does not deliver partially parsed data. An invalid budget fails
  before reading storage, installing listeners, or opening an IndexedDB
  transaction.
- Local/session storage areas, their native getters and methods, same-page
  event dispatch, and global storage-event listeners are captured when the
  module initializes. Later replacement of a storage global, prototype
  mutation, or instance shadow cannot redirect an official storage operation.
- Read/watch validators must be actual compiler-known VelarScript runtime types even
  when invoked through a dynamic JavaScript boundary; an arbitrary object
  cannot silently disable validation or register a delayed invalid watch.
- Record Types, runtime aliases, and enums use the same registered identity
  across compiled modules. Validation never probes a lookalike object's
  `is`/`parse` getters, and invalid Type, key, or value arguments are rejected
  before local/session storage is accessed.
- `storage.scope(name)` and `session.scope(name)` create one compiler-typed key
  namespace. HMR recreates module state; only explicitly stored values persist.
- `watch` observes same-page writes and browser storage events and returns an
  explicit cleanup function. A throwing callback or rejected callback promise
  is reported through `velar/app` with storage ownership; cleanup still removes
  the listener normally. Event payloads are read only through captured native
  browser getters or enumerable own data fields; a synthetic accessor-backed
  event is ignored without executing its getters.
- `database(name)` provides asynchronous IndexedDB `get`, `set`, `has`,
  `keys`, `remove`, and `clear`. Its `get` and `set` accept the same trailing
  `maxBytes` contract. Values are stored as canonical strict JSON text rather
  than arbitrary structured-clone objects, allowing an oversized value to be
  rejected before parsing. Typed reads use the same VelarScript `type`
  validator and fallback rules; values written directly by JavaScript in a
  different representation are foreign data and return the declared fallback.
- The IndexedDB factory, request getters, database/transaction/object-store
  methods, key-list checks, and event listeners use the same captured host ABI.
  JavaScript may still expose an explicit data-only test double, but ambient or
  instance accessors are never treated as trusted database fields.
- IndexedDB operations resolve only when their transaction commits, not merely
  when the individual request reports success. A later transaction abort is
  observable as the original host rejection. Failed/blocked opens reset the cached connection so
  a later operation may retry, and version changes or unexpected connection
  closes discard stale handles. A transaction-creation failure also resets the
  cached handle so the next operation can reconnect instead of remaining bound
  to a dead database object.
- Storage, scope, database, and key names remain actual strings. Scoped browser
  keys have one bounded 4096-character path, and a key listing snapshots the
  host length once, validates every result, caps its aggregate text, and returns
  an application-owned mutable List sorted for deterministic behavior. Listings
  never invoke methods on host-provided key values. IndexedDB listings likewise
  reject malformed or non-string keys instead of coercing them.
- Every write uses the strict `velar/json` data contract. Unsupported or lossy
  values that are visible to the compiler fail during checking; dynamic values
  are validated again at runtime before local/session storage or IndexedDB is
  mutated. IndexedDB accepts only its strict JSON text representation before
  Type validation, so a `Date`, `Map`, accessor record, object clone, or other
  foreign value written by JavaScript cannot enter Vel through a permissive
  runtime Type; the read returns its declared fallback instead.

## `velar/forms`

```velar
import {checkedValue, clearErrors, errors, fieldValues, focusFirstError, numberValue, read, reset, setError, setPending, textValue, values} from "velar/forms"
```

- `values(form)` returns `Map<string, unknown>` from native form data;
  repeated names become a list. `fieldValue(form, name)` reads one value.
- `textValue(form, name, fallback="")`, `numberValue(form, name)`,
  `checkedValue(form, name)`, and `fieldValues(form, name)` expose common native
  form shapes without leaking `FormData` or forcing application code through
  `unknown`. Numbers use the same signed decimal/exponent grammar as
  `number(text)`; blank, hexadecimal, numeric-separator, and non-finite text
  return `null`. Textual helpers reject native file values instead of coercing
  them silently.
- `read(form, Type)` decodes a flat native form into the existing colon-form
  record type. It supports `string`, finite `number`, `bool` checkboxes, enums,
  `List<string>` repeated fields, and optional string/number/enum fields. Blank
  optional numbers and missing optional scalars become `null`; invalid required
  numbers, enums, native files, nested records, and unsupported collections fail
  explicitly. The compiler supplies the private decoder description and the
  existing `Type.parse` validator checks the result.
- The runtime Type and compiler decoder description are validated as data-only
  contracts before `FormData` is constructed. Decoder Lists cannot be sparse or
  accessor-backed; names, kinds, fallbacks, and error messages are real strings,
  and invalid dynamic arguments cannot read or mutate the form first.
- The module captures native form identity, FormData construction and reads,
  repeated-field Map operations, and strict decimal-parsing intrinsics when it
  initializes. JavaScript loaded afterwards cannot replace `HTMLFormElement`,
  `FormData`, their relevant prototype operations, or constructor
  `Symbol.hasInstance` to reject an already-owned form or intercept submitted
  values. This capture covers value extraction; error-node, focus, reset, and
  pending-state DOM mutations retain their separately documented lifecycle.
- Submitted/decoder/error field names are limited to 1,024 characters, error
  messages and owned accessibility metadata to 64 KiB, and textual fallbacks
  to 16 MiB. Values returned from native form/error nodes are checked before
  becoming a VelarScript Map.
- `read` does not create another schema language or infer business rules.
  Required text, trimming, minimums, custom messages, and submission behavior
  remain application code and ordinary HTML attributes.
- `setError`, `clearError`, and `clearErrors` own field alerts while preserving
  unrelated `aria-describedby` tokens. Duplicate owned nodes for one field are
  cleared together so stale alerts and IDs cannot survive recovery.
  `errors(form)` returns current messages and `focusFirstError(form)` focuses
  the first invalid field.
- `setPending(form, bool)` owns `aria-busy` and temporarily disables fields,
  restoring their previous disabled state afterward. It validates every
  control's native `disabled` value as bool before mutating the form. Live
  control/error collections and repeated field Lists are first copied with one
  bounded length snapshot; sparse/accessor Lists and changing collection lengths
  cannot alter the validated operation midway.
- `reset(form)` restores pending/error ownership and then performs the native
  form reset.
- Error nodes, attributes, text, focus, form/control properties, live DOM
  collections, the pending-state WeakMap, and native reset all use operations
  captured when the Forms module initializes. Branded browser objects are read
  only through native prototype contracts; an explicit data-only test host may
  provide enumerable own fields and methods, but accessor shadows are rejected
  without execution. Later JavaScript replacement cannot redirect an owned
  error, focus, pending restore, or reset operation.
- Helpers require a real form element. Submission remains explicit through
  ordinary VelarScript event directives.
- Event directives pass native browser events. Contextual `KeyboardEvent`,
  `PointerEvent`, `InputEvent`, `CompositionEvent`, and `ClipboardEvent`
  parameters expose their typed fields;
  zero-parameter handlers remain valid and no synthetic event runtime is added.
  Composition start/update/end provide `CompositionEvent.data`. Copy, cut, and
  paste provide `ClipboardEvent`; its raw `DataTransfer` stays hidden behind the
  bounded `velar/browser` text helpers described below.
  Framework-owned `self`, `prevent`, and `stop` modifier work uses captured
  native Event getters and methods, so an own accessor or instance override
  cannot run before the application handler.

## `velar/browser`

```velar
import {after, blur, closeDialog, dialogResult, environment, every, focus, scrollElementTo, scrollMetrics, setTextSelection, showDialog, textSelection, watchOnline, watchVisibility} from "velar/browser"

component EnvironmentStatus:
    const stopReady = after(250, () => print("ready"))
    const stopHeartbeat = every(1000, () => print("heartbeat"))
    const stopOnline = watchOnline(online => print(online))
    const stopVisibility = watchVisibility(visible => print(visible))

    cleanup:
        stopReady()
        stopHeartbeat()
        stopOnline()
        stopVisibility()

    return <p>{environment().online ? "online" : "offline"}</p>
```

`after(milliseconds, callback)` schedules one callback and `every(milliseconds,
callback)` schedules repeated work. Each returns an idempotent `() -> null`
stop function. Durations must be finite and non-negative; `every` requires a
positive duration. Repeating work schedules its next turn only after the
current synchronous or asynchronous callback settles, so slow polling cannot
overlap itself. Stopping cannot abort a callback that has already started, but
prevents every later turn. Callback failures are normalized through
`velar/app` with phase `timer` and detail `after` or `every`. Timer and
microtask functions are captured at module initialization, so later ambient
replacement cannot steal scheduling or cancellation.

Timer handles are explicit component resources: start them during component
setup or `mounted`, retain the returned stop function, and release it from the
sibling `cleanup` block. VelarScript does not expose `setTimeout`, `setInterval`, or a
React-style effect API.

- `location()` and `environment()` return typed snapshots rather than exposing
  mutable browser globals. Host strings and booleans must already have the
  declared type; malformed values are rejected rather than implicitly
  converted. Location, Navigator, Document, MediaQueryList, DOMRect, and dialog
  values are read through captured native prototype getters; own accessors and
  instance shadows are ignored rather than executed.
- Snapshot language lists are application-owned mutable copies limited to 1,000
  entries of at most 256 characters and cannot contain sparse or accessor
  elements; the containing environment record remains read-only. Navigator,
  online, visibility, media-preference, and touch fields are each snapshotted
  once and validated before the record is returned. Layout rectangles use the
  native element operation and must contain finite numbers; animation-frame
  timestamps and dialog results remain bounded typed values before they cross
  back into VelarScript source.
- `media`, `watchMedia`, `watchOnline`, and `watchVisibility` expose common
  environment state. Every watcher returns a cleanup function, and callback
  failures are owned by the application error channel. Media change metadata is
  read through the captured native browser getter or a data-only test-host
  field; a synthetic accessor event is rejected without invoking the getter.
  `matchMedia` and EventTarget add/remove operations are captured as one host
  ABI, so watcher cleanup remains paired even after ambient or instance
  poisoning.
- `copyText` and `readClipboardText` require a secure context and may reject
  when browser permission or user-gesture policy denies access. Each operation
  snapshots the secure-context and native clipboard host once, then uses the
  captured platform method rather than a replaceable instance method.
- `clipboardText(event)` and `setClipboardText(event,text)` are the synchronous
  copy/cut/paste event boundary. They require a native `ClipboardEvent`, use only
  `text/plain`, cap text at 16 MiB, and call captured DataTransfer operations.
  Raw clipboard formats, files, and DataTransfer mutation do not enter source.
  The handler remains responsible for calling `event.preventDefault()` when it
  replaces the browser's default copy, cut, or paste behavior.
- `open`, `scrollTo`, `scrollIntoView`, `scrollMetrics`, `scrollElementTo`,
  `measure`, and `frame` cover intentional
  window, element, layout, and animation-frame operations. Text/URL/query
  inputs are strings, scroll coordinates are finite numbers, and behavior is
  exactly `auto`, `smooth`, or `instant`; invalid values fail before invoking
  the browser capability. `scrollMetrics(element)` returns
  `{x,y,viewportWidth,viewportHeight,contentWidth,contentHeight}` from captured
  native getters, and `scrollElementTo` moves that exact element without
  exposing mutable `scrollTop`/`scrollLeft` fields. Element scrolling and
  measurement call the validated platform prototype rather than an instance
  override.
- `capturePointer(element,pointerId)` and `releasePointer(element,pointerId)`
  keep drag/select ownership on one native Element. IDs are bounded
  non-negative integers and the captured prototype operations retain native
  active-pointer errors; pointer capture state itself is not duplicated in
  VelarScript runtime state.
- `focus(element, preventScroll=false)` and `blur(element)` provide explicit
  accessibility focus ownership for typed JSX refs. They require a real HTML
  element and invoke the native prototype operation rather than an instance
  override; `preventScroll` must be an actual boolean. Components remain
  responsible for choosing when focus should move or return.
- `<dialog ref={value}>` narrows the mutable ref to `DialogElement?` (or the
  general `Element?`). `showDialog` requires a mounted native dialog and opens
  it modally; `closeDialog(dialog, result="")` closes an open dialog, and
  `dialogResult` returns its native string result. These helpers validate the
  browser object without exposing document construction or an untyped DOM.
  Dialog state is read once per operation and opening/closing uses the captured
  native prototype methods, so an instance override cannot replace framework
  behavior.
- `<textarea ref={value}>` narrows the mutable ref to `TextAreaElement?`, a
  subtype of `InputElement`. `textSelection(area)` returns
  `{start,end,direction}` and `setTextSelection(area,start,end,direction="none")`
  updates it. Start/end are Unicode code-point offsets, never DOM UTF-16 units;
  a native selection that splits a surrogate pair is rejected. Ranges must be
  ordered and in bounds, and direction is `none`, `forward`, or `backward`.
  Textarea identity, value/selection getters, and `setSelectionRange` are
  captured when `velar/browser` initializes, so later prototype or instance
  replacement cannot redirect an editor transaction.

## `velar/files`

```velar
import {download, pick, readText} from "velar/files"

const selected = await pick({accept: ".json", multiple: false})
if selected.size > 0:
    const source = await readText(selected[0])
    download("copy.json", source, "application/json")
```

`pick` uses the native file-input path supported by Chromium, Firefox, and
WebKit. It returns `List<File>`, where opaque `File` values expose read-only
`name`, `size`, `type`, and `modified` metadata; only values returned by `pick`
may be read with `readText` or
`readDataUrl` or attached to `velar/http.formBody`. Picker options are a
data-only `accept` string/`multiple` bool record. `download` accepts actual text
for its name, data, and MIME type. Invalid options, forged file records, and
invalid download values fail before an input, reader, Blob, or object URL is
created. `readText(file, maxBytes=16777216)` and
`readDataUrl(file, maxBytes=16777216)` inspect native file size before reading;
the explicit ceiling is 64 MiB. One picker result is limited to 10,000 files,
and text downloads are likewise limited to 64 MiB. Directory access,
persistent file handles, and the File System Access API are deliberately not
part of Web API 0.10.

Returned file names/MIME types, sizes, and modification times are validated
before an opaque `File` is registered. Invalid native picker results reject
the Promise instead of escaping an event callback or leaving it pending.
Missing or malformed native file lists are failures, not implicit empty
selections. Picker results snapshot the native `FileList` length once and use
captured platform prototype operations rather than indexed properties, custom
iterators, or instance overrides. File metadata and text reads use the native
`File`/`Blob` brands and likewise cannot invoke own getters or a replaced
instance `text` method.
`readText` and `readDataUrl` also verify the asynchronous reader result and its
maximum encoded expansion before returning a string.

## `velar/realtime`

```velar
import {eventStream, socket} from "velar/realtime"

component LiveStatus:
    const chat = socket("wss://example.test/chat", {
        message: text => print(text),
        error: message => print(message),
    })
    const updates = eventStream("/api/updates", {message: (text, id) => print(text)})

    cleanup:
        chat.close()
        updates.close()

    return <p>{chat.state()}</p>
```

- `socket` wraps text WebSocket messages and exposes `state`, `send`,
  `sendJson`, and `close`. Binary messages are reported to the error handler
  and close the text-only channel.
- `sendJson` uses the same strict lossless JSON contract as HTTP and storage.
  Known non-data types fail checking; dynamic Map/Set/class/function, cyclic,
  sparse, or non-finite values fail before WebSocket `send` is called.
- `eventStream` wraps server-sent events and exposes `state` and `close`, with
  optional credentials. Event streams report `connecting`, `open`, or `closed`;
  WebSockets additionally expose `closing`. Unknown native state numbers fail
  rather than being mislabeled. Each state observation reads the native value
  once, so validation and the returned label cannot describe different states.
- URLs are strings, EventSource credentials are bool, and handler records
  accept only documented enumerable callable data fields. Accessors and unknown
  fields fail before constructing the native connection. Handler throws and
  rejected promises are reported through `velar/app` with a stable realtime
  phase/detail instead of escaping the native event loop.
- Realtime URLs are limited to 2 MiB and text messages to 16 MiB. Oversized
  outbound messages fail before native `send`; oversized inbound WebSocket
  messages close with code `1009`, and oversized server-sent events close their
  stream after reporting the boundary error. Server-sent event IDs are limited
  to 64 KiB on the same checked return path.
- Resolved native connection URLs are validated again before becoming public
  fields. Inbound message text, event IDs, and WebSocket close codes/reasons are
  each snapshotted once through captured native getters before the typed
  callback runs; malformed or accessor-backed host metadata is reported through
  `velar/app` without implicit conversion or getter execution. Constructors,
  listeners, state getters, send, and close operations likewise use the host ABI
  captured when the module initializes rather than replaceable instance methods.
- WebSocket close codes are `1000` or application codes `3000`–`4999`; reasons
  are strings no longer than 123 UTF-8 bytes. A reason above 123 code units is
  rejected before calculating its encoded size; the runtime owns the bounded
  UTF-8 byte count instead of consulting mutable `TextEncoder`. Invalid
  messages, JSON payloads, codes, and reasons fail before native `send` or
  `close` effects. `sendJson` validates and serializes its argument before
  observing connection state, matching the ordinary `send` argument-first
  contract even on a closed channel.
- Connections are ordinary owned resources. Applications close them explicitly
  from sibling component `cleanup`; the API does not introduce React-style
  effects or hidden lifecycle behavior.

## Core `velar/test` and Web `velar/web-test`

`expect(value)` provides typed `toBe`, `toEqual`, `toBeTruthy`, `toBeFalsy`,
`toContain`, `toMatch`, `toHaveLength`, `toThrow`, and `toReject` matchers.
`toEqual` uses exactly the public `velar/json.deepEqual` contract: it does not
invent a test-only structural model, invoke record getters, accept sparse Lists,
or treat distinct class instances/cycles as equal.
`toBe` follows VelarScript `==` value/reference semantics. The truthy/falsy spellings
accept only actual booleans; they do not reintroduce JS truthiness. Specialized
matchers are exposed only for compatible checked subjects, then validate the
same rule at dynamic boundaries. In particular, `toThrow` requires a function,
and `toReject` requires a Promise (or a function returning one); a synchronous
throw cannot masquerade as a rejected Promise.
Failure rendering is bounded for large/deep Lists, Maps, Sets, records, and
strings. It never calls conversion hooks on functions or unknown objects, and
invalid regular-expression construction uses a stable owned message rather
than formatting a hostile thrown value.
`.test.vel` files and `test_*` discovery remain owned by `velar test`.

Browser application tests use a separate `.browser.test.vel` suffix and run
only through `velar test --browser`:

```velar
import {expect} from "velar/test"
import {browser} from "velar/web-test"

async def test_home_page() -> null:
    await browser.open("/")
    await browser.waitForText("h1", "My VelarScript App")
    expect(await browser.currentPath()).toBe("/")
```

The `browser` controller intentionally exposes a compact automation surface:
`open`, `reload`, `click`, `fill`, `select`, `press`, `scroll`, `text`, `attribute`, `namespace`, `count`,
`visible`, `waitFor`, `waitForText`, `currentPath`, `viewport`, `timings`,
`measureClick`, `measureFill`, and `measurePress`. It is not a
DOM or Playwright escape hatch. The CLI builds a real CSP production site,
starts an isolated local host, creates a fresh browser context for each test,
and automatically fails on page errors or error/warning console messages.
Chromium is the local default; Chromium, Firefox, WebKit, or all three may be
selected explicitly. `namespace(selector)` requires one matched node and
returns its platform namespace URI so SVG/HTML lowering can be asserted without
arbitrary page evaluation. Browser binaries remain an explicit Playwright
install.

The CLI executes the whole browser-test run in a dedicated supervised worker.
One test is bounded to 120 seconds, the aggregate run to 20 minutes, and each
browser/context cleanup to 10 seconds. Browser engines are explicit
BrowserServer owners rather than opaque launches: cleanup closes the connection,
closes the server, escalates to its kill operation, and finally terminates the
dedicated process group on POSIX hosts. SIGHUP, SIGINT, and SIGTERM propagate to
the worker and keep exit codes 129, 130, and 143; an IPC parent disconnect also
starts cleanup. Therefore a timed-out VelarScript Promise, a stuck browser close,
or a killed invoking CLI cannot retain a headless renderer after the supervised
run exits.

`scroll(selector,x,y)` performs one bounded element scroll with finite
coordinates, allowing virtualized products to verify viewport transitions
without exposing page evaluation. Its test-only page owner captures native
Element identity and `scrollTo` before application code, so product prototype
changes cannot redirect the automation seam.

`timings()` returns the current navigation's
`{firstContentfulPaintMs?,domContentLoadedMs,loadMs}` snapshot. FCP is `null`
when the browser supplies no paint entry. The three `measure*` methods perform
the corresponding real automation action and return
`{inputDelayMs,processingDurationMs,nextFrameMs}` for its click or input event.
Text `measureFill`/`measurePress` accepts the first matching `beforeinput` or
`input` event, so a controlled editor that prevents native mutation in
`beforeinput` has the same measurement contract as an uncontrolled field.
Processing duration ends after synchronous event dispatch; `nextFrameMs` is the
end-to-end UI publication metric and therefore also covers queued framework DOM
work and rendering. These records are finite, bounded, fail-closed values
created by a test-only page runtime installed before application code. They do
not expose a clock callback, page evaluation, production global, or arbitrary
event injection to VelarScript source.

`localStorage` and `sessionStorage` from `velar/web-test` expose raw string
`get`, `set`, `remove`, and `clear` operations after `browser.open`. They exist
so recovery paths can plant malformed or legacy storage bytes without shipping
a query parameter, debug button, or script escape in the product. Each browser
test already owns a fresh context, so these controls cannot leak state between
tests and are unavailable outside `velar test --browser`.

`network.respond(path, body, status=200, contentType="text/plain; charset=utf-8",
delayMs=0)` installs a bounded response for one application-relative path, and
`network.clear()` removes the test's routes. This lets a real browser test drive
HTTP and streaming UI behavior without shipping a fake-provider branch in the
application. Routes are confined to the isolated test origin and remain
unavailable outside `velar test --browser`.

## Deliberate boundaries

Web API 0.10 does not define SSR/server execution, workers, service workers/PWA,
WebRTC, WebGPU, directory handles, persistent file handles, or a game runtime.
`CanvasElement.getContext(kind=...)` therefore returns `unknown` rather than an
untyped browser escape hatch; the future game package will own a checked Canvas
surface.
JavaScript packages remain available through checked declarations or an
explicit unsafe boundary when an application needs capabilities outside the
official surface. `velar/game` remains a later Canvas-oriented package built on
this Web platform.

## Compatibility authority

The versioned type interface, emitted runtime source, and framework-host
implementation live together in `@velarscript/web`, under `packages/web`. The
CLI dynamically loads the project-declared `/compiler` and optional `/host`
entries. Web owns HTML/CSP/reload/deployment projection and browser-test
metadata; CLI owns generic routing, filesystem, bundling, transport,
verification, and browser-driver mechanics.
`standardModuleApi()` reports Web API `0.10` under the extension ID, and compiler tests protect
exact names and types, and the Chromium, Firefox, and WebKit
development/production matrix protects runtime behavior. Workbench does not
copy these rules; completion and diagnostics arrive through the project's
installed `velar lsp`.
