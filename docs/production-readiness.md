# VelarScript Production Readiness

Status: internal engineering gate complete; external preview and release evidence pending; do not describe VelarScript as production-ready yet

Production-ready means an ordinary team can create, operate, evolve, debug,
test, deploy, and recover a real Velar Web application without depending on
repository-internal knowledge or unsafe browser globals. A green compiler suite
alone is not sufficient evidence.

## Exit criteria

| Area | Required evidence | Current state |
| --- | --- | --- |
| Language reliability | Errors, async failures, cleanup, return analysis, arithmetic, modules, classes, and runtime validation execute with documented JS semantics | Passing internally: Core semantics remain coercion-free; source/token/nesting/module, LSP input/output/result, documentation, and runtime data ceilings fail deterministically. Native source classes separate caller constructor inputs from explicitly typed instance/static body fields, provide one synchronous post-field `init:` invariant boundary, one typed read-only native getter form, and one native-backed `private` boundary without adding setters or `public`/`protected` tiers. Every async declaration annotates its resolved value, adopts returned Promises uniformly, owns `await`, rejects direct `await` in parameter defaults, and prevents Promise leakage into JSX. Expression arrows return object bodies unambiguously; power keeps right association and valid unary/await lowering; strict comparison chains evaluate once and reject bool/object/mixed ordered coercion; multiline delimiters accept final commas without false indentation. Bounded `///` Markdown follows declarations and aliases without runtime output or a second type syntax. API Dashboard exercises documented private chart state, a derived `ChartScale.top` SVG property, class initialization and bounded ranges, lazy SVG, and concurrent typed metric feeds. JavaScript package classes retain declaration identity through bounded `.d.ts` graphs, and the compiler/CLI suite plus FlowBoard/SupportDesk/API Dashboard Core applications pass. External workload diversity remains an external-use requirement rather than unfinished internal semantics |
| Application recovery | A production build can surface, classify, report, and recover from render, event, async, resource, and action failures without a blank page or leaked ownership | Passing internally: route/callback recovery and lazy HTTP cancellation remain covered; bounded HTTP/file/realtime bodies, forms, routes, browser helpers, and storage reject hostile dynamic inputs before native side effects; invalid asynchronous file/HTTP/browser/realtime host results reject or report through their owned channel rather than hanging or escaping native callbacks |
| Public configuration | Development and production can receive explicit public configuration with validation; server secrets are never read or bundled implicitly | Passing: only bounded validated `web.publicConfig` is frozen and embedded; environment/secret loading is absent |
| Operational logging | Structured, leveled logs work in Node and browsers and can be redirected without exposing `console` as a language global | Passing internally: Standard API runtime and Release Studio cover scoped logs/disposable sinks; the 1.0 audit additionally rejects coerced or oversized messages/keys/scopes, bounds fields and installed sinks, and isolates each sink's fields snapshot |
| Project testing | A generated application can run Core tests and browser component/application tests through documented CLI commands | Passing internally: generated and packed-installed projects run their own Core/browser scripts; the 1.0 audit additionally made matchers subject-typed and fail-closed so invalid values, sync throws, and JS truthiness cannot create false positives |
| Browser/deployment compatibility | Chromium, Firefox, and WebKit pass development and CSP production flows; deployment manifest has at least one exercised host adapter | Passing internally: browser matrices pass; root-base Netlify files preserve asset 404 before SPA fallback; `verify-deployment` checks real hosted bytes, MIME, headers, and routes; a live provider run remains external-use evidence |
| Application artifact integrity | Teams can prove that a production directory exactly matches its build/deployment manifests and run that exact output locally | Passing: `velar verify` checks complete inventory/hash/relationship integrity; hashing and preview delivery stream regular files, production inventory is capped at 100,000 assets, and the same verified server powers browser-project tests |
| Reproducibility/source disclosure | Identical production inputs produce identical bytes and source code is not published accidentally | Passing: stable virtual Velar inputs remove random-path hashing; cross-directory builds are byte-identical and linked source maps are explicit/off by default |
| Package/project stability | Packed toolchains install cleanly, exact versions match, and the project-extension boundary is explicit and fail-closed | Passing: packed consumers create format-v2 Core and Web projects; missing, format-1, and unknown future manifests are rejected without a compatibility loader or upgrade command |
| Editor independence | Project-local LSP works through the generic Workbench host with diagnostics, completion, navigation, rename, formatting, type hints, occurrence highlights, semantic tokens, code actions, and commands | Current packed-toolchain acceptance and 9/9 focused generic-host tests pass. Completion is lexical/scope-aware and member items come from analyzer-owned signatures rather than a host type table. Selectively indexed checked expressions preserve completion, hover, and active-parameter signatures through collection literals and nested Web chains; JSX tag/attribute and typed object-key positions are context-aware and restore lexical symbols inside values. The installed gate proves collection and route signatures, HTML/component/SVG completion, typed object keys, recursive-record and component-prop refactors, semantic tokens, safe equality fixes, a real npm class, native `ScoreCard` class-body fields plus `init:`, a private history field that appears through `self` but not consumer completion, and a documented read-only `summary` getter delivered as an ordinary property. It also covers comparison-chain `bool` hover/inlay hints, packed `///` documentation in completion/hover, an async arrow with contextual parameter hover plus `Promise` signature help, and a named async function that directly adopts its Promise result. Record/class members navigate across aliases and inheritance, including inherited static declarations; private members instead keep owner-local navigation/refactors. CodeMirror consumes all of this through generic LSP contracts. The host validates tarball hashes independently and injects format/format-check commands without owning language rules. The wider Workbench tree remains mid Platform migration; that unrelated baseline is not Velar evidence. |
| Release integrity | Stable clean tagged source produces verified reproducible tarballs with license, provenance, and explicit publish authority | Partial: Apache-2.0 is applied to the workspace and all four package tarballs; rehearsal/candidate refusal exists; attributable public development source and remote CI now exist, while review/merge, the stable tag, and public release authority remain external decisions |
| External use | More than the repository's own examples are built, deployed, and operated; feedback is converted into compatibility tests | Missing: a reproducible root Netlify candidate, remote verifier, signed-report workflow, and Chromium candidate smoke now exist, but no authorized live deployment or external user evidence exists yet |

## Completed internal sequence

1. 0.7A: complete — reliable language error control flow and essential arithmetic.
2. 0.7B: complete — application error recovery/reporting, explicit public
   configuration, and structured logging.
3. 0.7C: complete — browser-project test command, host-adapter acceptance,
   format-v2 project-boundary checks, and production soak/failure tests.
4. 0.7D: complete — strict application artifact verification and verified
   production preview.
5. 0.7E: complete — reproducible production bundling and opt-in source maps.
6. 0.7F: complete — hosted-output verification and provider-semantics probes.
7. 0.7G: complete — machine-readable, attested external-preview evidence path.
8. 0.8A: complete — checked dynamic modules, production chunks, and typed lazy
   Web components.
9. 0.8B: complete — strict literal `match` blocks with complete-return analysis.
10. 0.8C: complete — opaque picked-file multipart uploads through the typed HTTP
    API.
11. 0.8D: complete — typed final rest parameters across functions, methods,
    modules, LSP signatures, extern declarations, and the limited `.d.ts` bridge.
12. 0.8E: complete — native typed Set construction, inference, mutation,
    iteration, runtime validation, modules, LSP signatures, and `.d.ts` mapping.
13. 0.8F: complete — nominal finite workflow states, complete collections,
    secure IDs, and independent FlowBoard application validation.
14. 0.9A: complete — typed route context/contracts, native form reads/reset,
    conditional optional narrowing, and independent SupportDesk validation.
15. 0.9B: complete — base-aware active navigation, nominal dialog refs/native
    operations, and correct direct-route data recovery.
16. 0.9C: complete — typed component resources with mount ownership, retry,
    application error reporting, and stale-completion protection.
17. 0.9D: complete — callable component actions with implicit async bodies,
    pending/error state, latest-failure ownership, and recoverable reporting.
18. 0.9E: complete — concise function types and checked callback props across
    FlowBoard's form, page, column, and card composition boundaries.
19. 0.9F: complete — transparent aliases using the existing `type` family,
    including static erasure, runtime validation, and transitive module expansion.
20. 0.9G: complete — readable adjacent JSX conditional branches with narrowing,
    transactional replacement, fail-closed sequencing, and ref cleanup.
21. 0.9H: complete — native keyboard, pointer, input, and base event payloads
    with contextual handler checks and three-engine runtime evidence.
22. 0.9I: complete — omitted function, method, and action result annotations
    mean `none` across checking, module signatures, async calls, runtime
    normalization, and editor hover.
23. 0.9J: complete — flat native forms decode into the existing record `type`
    family without a second schema or hidden validation/submission lifecycle.
24. 0.9K: complete — stable dotted optional fields narrow across block, inline,
    `is`, inverse, and JSX branches without leaking facts across shadowed roots.
25. 0.9L: complete — explicit production-retained assertions turn validated
    invariants into following-statement type facts without leaking proofs into
    nested blocks or deferred execution frames.
26. 0.9M: complete — real creation paths use one record input and checked
    object shorthand instead of position-heavy calls, with packed editor and
    three-engine application evidence.
27. 0.9N: complete — explicit
    `none` comparisons narrow all owned branch forms, and adjacent JSX branches
    accumulate rejection facts, with compiler, real-application, three-engine,
    packaged-toolchain, release-rehearsal, and isolated Workbench evidence.
28. 0.9O: complete — block
    `else if` chains retain rejected facts, satisfy complete-return analysis,
    and emit flat JavaScript, with compiler, real-application, three-engine,
    packaged-toolchain, release-rehearsal, and isolated Workbench evidence.
29. 0.9P: complete — rejected `is`
    checks remove fully covered members from simple unions and optionals across
    every owned branch form, with compiler, real-application, three-engine,
    packaged-toolchain, release-rehearsal, and isolated Workbench evidence.
30. 0.9Q: complete — checked typed
    List slicing replaces nested pagination helpers without exposing JavaScript
    number coercion, with compiler, real-application, three-engine,
    packaged-toolchain, release-rehearsal, and isolated Workbench evidence.
31. 0.9R: complete — stateless typed
    text patterns provide matching, records, literal replacement, and splitting
    without exposed `RegExp` state or arbitrary flags, with compiler,
    real-application, three-engine, packaged-toolchain, release-rehearsal, and
    isolated Workbench evidence.
32. 0.9S: complete — one explicit optional access
    safely continues through fields, strict indexes, calls, and checked
    collection helpers with lazy short-circuiting and no assignable chain, with
    compiler, real-application, three-engine, packaged-toolchain,
    release-rehearsal, and isolated Workbench evidence.
33. 0.9T: complete — productive recursive record types retain cycle-safe static
    structure and bounded runtime validation while required infinite shapes fail
    at compile time, with a recursively rendered real Web project tree,
    three-engine, packaged-toolchain, release-rehearsal, and isolated Workbench
    evidence.
34. 0.9U: complete — `after` and non-overlapping `every` provide cancellable,
    explicitly cleaned browser timers with unified failure reporting, with
    compiler/runtime, real-application, three-engine, packaged-toolchain,
    release-rehearsal, and isolated Workbench evidence.
35. 0.9V: complete — failed component setup/initial JSX runs sibling cleanup
    and destroys its incomplete scope without masking the original cause, while
    lazy post-load construction failures retain accessible recovery, with a
    real timer-leak probe, three-engine, packaged-toolchain, release-rehearsal,
    and isolated Workbench evidence.
36. 0.9W: complete — mounted Router navigation constructs before commit,
    retains the active page on target failure, reports `render/router`, and
    recovers on later navigation, with a second timer-leak probe, three-engine,
    packaged-toolchain, release-rehearsal, and isolated Workbench evidence.
37. 0.9X: complete — unmatched routes render an accessible default or checked
    `RouteContext` fallback, unsafe adapter results validate before commit, and
    Production Web recovers from a direct unknown deep link, with compiler,
    three-engine, packaged-toolchain, release-rehearsal, and isolated Workbench
    evidence.
38. 0.9Y: complete — ambient JavaScript coercion globals are removed and strict
    `number(text) -> number?` parsing accepts only complete finite decimals,
    with SupportDesk query pagination, compiler/runtime, three-engine,
    packaged-toolchain, release-rehearsal, and isolated Workbench evidence.
39. 0.9Z: complete — explicit `velar/json.deepEqual` compares owned
    record/List/Map/Set data with reference-preserving and cycle-bounded
    semantics, with FlowBoard dirty-state derivation, compiler/runtime,
    three-engine, packaged-toolchain, release-rehearsal, and isolated Workbench
    evidence.
40. 1.0 audit A: complete — project-wide checked formatting, modular generated
    application plus real Core/browser tests, installed project-owned npm
    lifecycle acceptance, safe package/title normalization, strict lossless
    JSON across Core/storage/HTTP, and complete standard-module type/runtime
    export parity.
41. 1.0 audit B: complete — bounded compiler/project inputs, standard/Web
    runtime resource contracts, streamed production/deployment bytes,
    realpath-confined npm assets, linear repeated-form accumulation, and
    hostile-input and host-result regression coverage; 197 compiler/CLI tests,
    real Core and three-engine application suites, packed installation, non-publishing
    rehearsal, installed Workbench acceptance, and 9 generic-host tests pass.
42. 1.0 audit C: complete — namespace-correct inline SVG JSX across static,
    reactive, keyed, fragment, ordinary-component, and lazy chunk boundaries; HTML re-entry
    through `foreignObject`; accessible-name diagnostics; and a modular API
    Dashboard with typed HTTP, JavaScript-package interop, Core chart tests, and
    direct Chromium/Firefox/WebKit namespace evidence.
43. 1.0 audit D: complete — explicitly typed class-body instance/static fields
    keep internal state out of constructor signatures, preserve native
    initialization and `const`/`let` rules, cross module and generic-editor
    semantic boundaries, and drive API Dashboard's checked lazy chart scale.
44. 1.0 audit E: complete — async expression arrows own `await`, contextual
    typing, Promise adoption, module/LSP contracts, and JSX rejection; natural
    multiline trailing commas no longer corrupt indentation state, and
    parenthesized awaited results retain postfix precedence. API Dashboard
    concurrently loads two typed metric feeds, with compiler,
    three-engine, packed-toolchain, release-rehearsal, and generic Workbench
    evidence.
45. 1.0 audit F: complete — `async def`, async methods, component actions, and
    async arrows share one resolved-value annotation and native Promise-adoption
    rule across checking, execution, modules, and the LSP. Direct `await` in
    parameter defaults fails before invalid JavaScript can be emitted, while a
    nested async callback owns a valid later boundary. Compiler runtime tests
    and the packed Workbench toolchain exercise both sides of the contract.
46. 1.0 audit G: complete — exponent, unary-sign, and `await` precedence lower
    to valid right-associative JavaScript, and expression arrows with object
    bodies return objects instead of becoming label blocks. Compiler execution
    tests cover the synchronous and asynchronous boundaries.
47. 1.0 audit H: complete — one synchronous class `init:` block runs after
    fields and bound methods, owns a non-returning/non-awaiting execution
    boundary, remains contextual instead of globally reserving a common member
    name, crosses module/LSP/editor seams, and replaces API Dashboard's static
    validation workaround with a real construction invariant.
48. 1.0 audit I: complete — comparison chains preserve strict equality,
    single left-to-right evaluation, short-circuiting, and direct `await`, while
    ordered links accept only number/number or string/string. API Dashboard owns
    its real construction ranges with the syntax instead of duplicate checks.
49. 1.0 audit J: complete — bounded `///` Markdown attaches to declarations,
    remains absent from runtime output, crosses module aliases and members, and
    reaches packed Workbench hover/completion through standard LSP fields.
50. 1.0 audit K: complete — one `private` class modifier lowers constructor,
    instance/static field, and concrete sync/async method storage to native
    JavaScript `#` members; public interfaces and inheritance omit it while
    owner-local analysis and editor operations retain it. API Dashboard owns
    real private chart state and Workbench proves inside/outside completion.
51. 1.0 audit L: complete — typed read-only `get` properties lower to native
    accessors, preserve private/static/abstract/override and `super` contracts,
    cross module/LSP boundaries as properties, and leave all writable state in
    explicit `let` fields. API Dashboard and the installed Workbench fixture
    exercise the feature in real code.
52. 1.0 audit M: complete — deterministic malformed input remains contained by
    compile/inspect/format APIs; watched rebuild exceptions retain the last good
    application, publish a managed failure, recover on the next edit, and
    converge after a 64-write burst. Incremental sessions also recover deleted
    dependencies without recompiling unrelated modules.
53. External preview: real applications and compatibility feedback, followed by
    a release-candidate audit against every row above.

## Non-blocking omissions

`velar/game`, SSR/server rendering, WebRTC, WebGPU, service workers/PWA,
directory handles, and a custom package registry are not required for the first
production-ready static Web release. They remain separate capabilities and must
not destabilize the language or Web 0.7 contracts.
