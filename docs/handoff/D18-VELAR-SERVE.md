# D14'' addendum (settled with user 2026-08-09): NO memoization keyword.
# Three tiers: (1) auto-memo in computed for provably-pure per-item derivations
# (D14' in flight); (2) follow-up after D14' lands — editor-level HINT (not error)
# when a computed's .map(f) narrowly fails the purity proof, naming the capture
# that broke it (the W-19/VEL5050 "no silent performance cliffs" pattern);
# (3) a computed-sibling keyword with hard purity checking is SPEC-SHELVED,
# escalation trigger = repeated real-world need for guaranteed granularity.

# D18 — first-party local platform surface (velar/serve, velar/fs, velar/env, velar/host)

Positioning (locked): Node stays the engine; these are STDLIB modules (like velar/json),
NOT a compiler extension (no syntax). Available under velar run / server projects.
The extern bridge remains for third-party JS; the platform builtins stop needing it.
Evidence base: Lite S5 (LEDGER W-21..W-26) — its server/src/main.vel extern surface is
the requirements document; the goal is that Lite's server rewrites to these modules
and deletes every extern declaration.

## velar/serve

```velar fragment
import {serve, fileResponse} from "velar/serve"

const server = await serve(handle, port=8787)

async def handle(request: ServeRequest) -> ServeResponse:
    match request.path:
        case "/api/health":
            return {status: 200, json: {ok: true}}
        case _:
            return fileResponse(root="dist", path=request.path, fallback="index.html")
```

- `serve(handler, port, host="127.0.0.1") -> Promise<Server>`; `Server` record:
  `port` (actual bound port), `stop() -> Promise<null>`.
- `ServeRequest` record: `method` (enum-like string), `path`, `query: Map<string,string>`,
  `headers: Map<string,string>`, `text() -> Promise<string>`, `json() -> Promise<unknown>`.
- `ServeResponse` = plain record, one of three bodies (checked): `{status, json}` |
  `{status, text, contentType="text/plain; charset=utf-8"}` | `{status, stream}` where
  `stream` is an async producer `(write: (chunk: string) -> Promise<null>) -> Promise<null>`
  (chunked transfer; covers S5's streaming shape without async iteration syntax).
  Optional `headers: Map<string,string>` on all three.
- `fileResponse(root, path, fallback=null) -> ServeResponse` — bounded static serving:
  traversal-rejected, content-type table owned by the stdlib, SPA fallback param
  (exactly what S5 hand-rolled).
- Handler errors → 500 with a velar-voiced body in dev, opaque in production? v1: always
  opaque body + stderr report (no dev/prod split yet — note as future).

## velar/fs

`readText(path) -> Promise<string>` · `writeText(path, text) -> Promise<null>` ·
`exists(path) -> Promise<bool>` · `list(path) -> Promise<List<string>>` ·
`readBlob(path) -> Promise<Blob>` (opaque binary handle — the W-26 bytes story stays
deferred; Blob passes through to ServeResponse via fileResponse internally).
All bounded (size guards consistent with stdlib style), promise-shaped, no sync forms,
no streams in v1.

## velar/env

`get(name) -> string?` · `require(name) -> string` (throws with a velar-voiced message
naming the variable). No process-wide record dump in v1 (encourages explicit reads).

## velar/host

`exit(code = 0)` · `onShutdown(cleanup: () -> Promise<null>) -> null` (SIGINT/SIGTERM,
cleanups run in registration order, then exit; double-signal force-quits).
S5's teardown shape, first-party.

## Implementation notes

- Lives with the other standard modules (packages/cli standard-modules family);
  under velar dev / browser builds these modules REFUSE at compile time with a
  targeted diagnostic ("velar/serve is a local runtime module; web applications
  use the dev server and velar/http") — platform gating must be a clear compile
  error, not a runtime crash. Check how velar/* modules are currently gated per
  target and follow/extend that mechanism.
- Runtime implementation bridges node:http/fs internally (plain JS inside the
  stdlib, like other runtime helpers) — the callback/emitter complexity lives here
  once, never in user extern declarations.
- Tests: unit (routing/static/content types), integration via velar run (mirror the
  S5 smoke: health, JSON body validation, streaming chunk arrival, traversal
  rejection, SPA fallback, SIGINT cleanup order + exit code).
- Docs: standard-library.md new sections; javascript-bridge.md gains one sentence
  ("platform builtins are first-party; extern is for third-party packages").
- Lite adoption (separate Lite commit): server/src rewritten onto velar/serve + fs +
  env + host; extern declarations deleted; ledger closes W-21..W-26 exposure for
  builtins with before/after LOC; bin bootstrap unchanged.

## Sequencing
After L1+L2 land (stdlib/test file contention). One agent, both repos.
