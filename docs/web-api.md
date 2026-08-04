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

## `velar/app`

```velar
import {onError, reportError} from "velar/app"

component RuntimeStatus:
    state message = "ready"

    def capture(phase: string, detail: string):
        message = phase + ":" + detail

    const stopErrors = onError(report => capture(report.phase, report.error.message))

    def failDeliberately():
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
  across application modules and lazy chunks.
- The compiler reports failures from initial `mount`, reactive `render` and
  synchronous `watch` blocks, synchronous or asynchronous events, `mounted`,
  and `cleanup`.
- JSX rendering and `computed` expressions are synchronous. Async component data
  belongs in `resource`; explicit UI operations belong in `action`; setup that
  must finish after insertion belongs in `mounted`.
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
- Root construction passed to `mount` is synchronous so the runtime can own its
  failure transaction. Await module-level preload work into a binding before
  calling `mount`; component data continues to use `resource`.
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
  primary click on an internal application path.
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
  validated before history or scrolling changes.
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
import {HttpAbortError, HttpError, http} from "velar/http"

const request = http.get("/api/profile", {timeout: 5000})
const profile = await request.parse(Profile)
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
  integer up to 64 MiB.
- Options are plain data records with only documented fields. Accessors,
  symbols, class instances, unknown fields, non-string headers, invalid Fetch
  methods, and forbidden `CONNECT`/`TRACE`/`TRACK` fail at request creation.
  Credentials are `omit`, `same-origin`, or `include`; cache is `default`,
  `no-store`, `reload`, `no-cache`, or `force-cache`.
- Requests expose `response`, `json`, `text`, `blob`, `parse(Type)`, and
  `cancel`. Responses expose typed status, URL, and header fields plus the same
  body readers. `blob()` returns an opaque checked `Blob`, not `any`; it may be
  passed back as an HTTP body but does not expose the native browser object or
  arbitrary fields.
- Fetch results are validated before they enter the typed response object.
  Status/`ok`, status text, canonical URL, and native response headers must keep
  their declared types; response headers share the 100-field/64-KiB bound and
  returned URLs the 2-MiB URL bound.
- Response bodies are consumed incrementally. A declared or streamed body over
  `maxBytes` is cancelled before it can be materialized; successful bytes are
  cached so repeated `text`/`json`/`blob` reads are stable. JSON remains subject
  to the separate strict 16 MiB JSON contract even when a larger text/blob
  budget was requested.
- Cancellation is idempotent and owns the whole lazy request. Cancelling before
  the first body reader prevents `fetch` from starting; cancelling an active
  request aborts it. Cancellation and timeout reject with `HttpAbortError`,
  whose `reason` is `"cancelled"` or `"timeout"`, so application recovery does
  not depend on browser-specific abort errors.
- Object bodies are JSON encoded and receive an `application/json` content type
  unless one was supplied. Non-2xx responses throw `HttpError` with `status`,
  `url`, and an `unknown` body.
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
- Headers are capped at 100 fields/64 KiB, text and form values at 16 MiB, and
  multipart bodies at 100,000 fields. Timeout uses the host timer range; these
  limits are checked before Fetch or FormData mutation.
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
    const stopWatching = preferences.watch("settings", Settings, (next, previous) => print(next))
    const settings = preferences.get("settings", Settings, {theme: "system"})
    const cache = database("release-studio")

    async def save():
        preferences.set("settings", settings)
        await cache.set("settings", settings)

    mounted:
        save()

    cleanup:
        stopWatching()

    return <p>{settings.theme}</p>
```

- `storage` and `session` wrap local and session storage. Both provide typed
  `get`, JSON `set`, `has`, `keys`, `remove`, `clear`, and `watch`.
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
  the listener normally.
- `database(name)` provides asynchronous IndexedDB `get`, `set`, `has`,
  `keys`, `remove`, and `clear`. Values are JSON-serializable and typed reads
  use the same VelarScript `type` validator and fallback rules.
- IndexedDB operations resolve only when their transaction commits, not merely
  when the individual request reports success. A later transaction abort is
  observable as rejection. Failed/blocked opens reset the cached connection so
  a later operation may retry, and version changes close stale handles.
- Storage, scope, database, and key names remain actual strings. Scoped browser
  keys have one bounded 4096-character path, and a key listing snapshots the
  host length once, validates every result, caps its aggregate text, and returns
  an application-owned mutable List sorted for deterministic behavior. Listings
  never invoke methods on host-provided key values. IndexedDB listings likewise
  reject malformed or non-string keys instead of coercing them.
- Every write uses the strict `velar/json` data contract. Unsupported or lossy
  values that are visible to the compiler fail during checking; dynamic values
  are validated again at runtime before local/session storage or IndexedDB is
  mutated.

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
- Submitted/decoder/error field names are limited to 1,024 characters, error
  messages and owned accessibility metadata to 64 KiB, and textual fallbacks
  to 16 MiB. Values returned from native form/error nodes are checked before
  becoming a VelarScript Map.
- `read` does not create another schema language or infer business rules.
  Required text, trimming, minimums, custom messages, and submission behavior
  remain application code and ordinary HTML attributes.
- `setError`, `clearError`, and `clearErrors` own field alerts while preserving
  unrelated `aria-describedby` tokens. `errors(form)` returns current messages
  and `focusFirstError(form)` focuses the first invalid field.
- `setPending(form, bool)` owns `aria-busy` and temporarily disables fields,
  restoring their previous disabled state afterward. It validates every
  control's native `disabled` value as bool before mutating the form.
- `reset(form)` restores pending/error ownership and then performs the native
  form reset.
- Helpers require a real form element. Submission remains explicit through
  ordinary VelarScript event directives.
- Event directives pass native browser events. Contextual `KeyboardEvent`,
  `PointerEvent`, and `InputEvent` parameters expose bounded stable fields;
  zero-parameter handlers remain valid and no synthetic event runtime is added.

## `velar/browser`

```velar
import {after, blur, closeDialog, dialogResult, environment, every, focus, showDialog, watchOnline, watchVisibility} from "velar/browser"

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
`velar/app` with phase `timer` and detail `after` or `every`.

Timer handles are explicit component resources: start them during component
setup or `mounted`, retain the returned stop function, and release it from the
sibling `cleanup` block. VelarScript does not expose `setTimeout`, `setInterval`, or a
React-style effect API.

- `location()` and `environment()` return typed snapshots rather than exposing
  mutable browser globals. Host strings and booleans must already have the
  declared type; malformed values are rejected rather than implicitly
  converted.
- Snapshot language lists are application-owned mutable copies limited to 1,000
  entries of at most 256 characters and cannot contain sparse or accessor
  elements; the containing environment record remains read-only. Online,
  visibility, media-preference, and touch fields are validated before the
  snapshot is returned. Layout rectangles and animation-frame timestamps must
  contain finite numbers, and dialog results remain bounded strings before
  they cross back into VelarScript source.
- `media`, `watchMedia`, `watchOnline`, and `watchVisibility` expose common
  environment state. Every watcher returns a cleanup function, and callback
  failures are owned by the application error channel.
- `copyText` and `readClipboardText` require a secure context and may reject
  when browser permission or user-gesture policy denies access.
- `open`, `scrollTo`, `scrollIntoView`, `measure`, and `frame` cover intentional
  window, element, layout, and animation-frame operations. Text/URL/query
  inputs are strings, scroll coordinates are finite numbers, and behavior is
  exactly `auto`, `smooth`, or `instant`; invalid values fail before invoking
  the browser capability.
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
  rather than being mislabeled.
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
  fields. Inbound WebSocket close codes/reasons are also checked before the
  typed callback runs; malformed host metadata is reported through
  `velar/app` without implicit conversion.
- WebSocket close codes are `1000` or application codes `3000`–`4999`; reasons
  are strings no longer than 123 UTF-8 bytes. Invalid messages, JSON payloads,
  codes, and reasons fail before native `send` or `close` effects.
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

async def test_home_page():
    await browser.open("/")
    await browser.waitForText("h1", "My VelarScript App")
    expect(await browser.currentPath()).toBe("/")
```

The `browser` controller intentionally exposes a compact automation surface:
`open`, `reload`, `click`, `fill`, `select`, `press`, `text`, `attribute`, `namespace`, `count`,
`visible`, `waitFor`, `waitForText`, `currentPath`, and `viewport`. It is not a
DOM or Playwright escape hatch. The CLI builds a real CSP production site,
starts an isolated local host, creates a fresh browser context for each test,
and automatically fails on page errors or error/warning console messages.
Chromium is the local default; Chromium, Firefox, WebKit, or all three may be
selected explicitly. `namespace(selector)` requires one matched node and
returns its platform namespace URI so SVG/HTML lowering can be asserted without
arbitrary page evaluation. Browser binaries remain an explicit Playwright
install.

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
