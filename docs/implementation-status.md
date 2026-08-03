# Implementation Status

Status: 1.0 internal engineering audit complete; external preview and release work deferred

Velar Compiler has been rebuilt from zero against the current language charter.
The language-to-browser loop now includes compiler-owned semantic tooling,
reusable npm-distributed Velar source, browser error/HMR hardening, generic
Workbench consumption, base-aware stable Web APIs, incremental dev compilation,
publishable toolchain packages, project lifecycle management, deliberately
limited TypeScript declaration consumption, cross-browser automation,
reproducible release rehearsal, secure static deployment, and production
observability. The compiler-owned 0.6 language baseline and Web API 0.8 are complete;
0.7 closed the internal reliability, configuration, testing, and release
rehearsal sequence. 0.8A–0.8E added checked dynamic modules, strict block
matching, safe multipart uploads, checked rest parameters, and native Set
collections. 0.8F adds real-application-driven finite states, collection
completion, secure IDs, and FlowBoard validation while external-use and
release-integrity evidence remain deliberately deferred. 0.9A adds conditional
optional narrowing, typed route context/contracts, typed native-form reads and
reset, and SupportDesk application validation.
0.9B adds accessible base-aware active navigation, typed native dialog refs and
operations, and correct asynchronous detail-route recovery. 0.9C replaces the
manual asynchronous component-loading pattern uncovered by SupportDesk with
typed component-owned resources, explicit retry, application error reporting,
and stale-completion protection. 0.9D removes the corresponding hand-written
pending/error/finally pattern from user-triggered asynchronous operations with
typed callable component actions and deterministic concurrent ownership. 0.9E
adds concise function-value types and replaces FlowBoard's leaf-component store
coupling with checked callback props across multiple component layers. 0.9F
adds transparent aliases using the existing `type` keyword and proves their
expanded contracts through direct, renamed, and transitive module boundaries.
0.9G replaces application-scale JSX ternary chains with adjacent checked
conditional branches and closes stale-ref ownership during branch replacement.
0.9H adds contextual native keyboard, pointer, input, and base event contracts
without wrapping browser events or weakening the explicit browser boundary.
0.9I makes omitted function, method, and action results mean `none` across
checking, module signatures, async calls, generated JavaScript, and LSP hover;
valued results remain explicit instead of relying on partial body inference.
0.9J adds compiler-described flat native-form decoding through the existing
record `type` family, removing per-field coercion without adding a second schema
system or hiding application validation and accessibility ownership.
0.9K carries optional presence and `is` facts through stable dotted record
fields in block, inline, and JSX branches, with lexical-root identity preventing
shadowed values from inheriting stale proofs.
0.9L adds production-retained Python-style assertions with strict Velar
condition semantics, lazy failure messages, and current-block narrowing for
locals, stable fields, and `is` checks. SupportDesk uses the assertion to state
its post-validation estimate invariant instead of silently skipping a valid
submission path behind another presence branch.
0.9M replaces position-heavy application commands with one existing record
`type` and safe object shorthand. FlowBoard passes `TaskDraft` through callback,
store, and domain boundaries; SupportDesk shares `TicketDraft` from native form
decoding through creation. Duplicate explicit fields and quoted shorthand
mistakes now fail before JavaScript emission, while spread-then-override remains
the intentional immutable-update form.
0.9N aligns explicit empty-value checks with Velar's existing presence flow.
`value != none`, `value == none ... else`, and symmetric operand order narrow
locals and stable fields across block, inline, assertion, and JSX branch forms.
Adjacent JSX conditions inherit earlier rejection facts, and real applications
now express route, selected-file, validated-form, and safe-list invariants
without fallback values or repeated unsafe indexing.
0.9O hardens the existing but previously unverified `else if condition:` parser
path into a first-class block-control contract. Later conditions inherit prior
rejection facts, complete chains satisfy explicit return analysis, and emitted
JavaScript stays flat. FlowBoard's analytics status exercises a four-branch
decision in a real lazy-routed browser view.
0.9P completes the matching simple-union flow: a rejected `value is Type` check
removes only union members fully covered by that runtime type. The rule composes
through `else if`, `not`, assertions, stable fields, optionals, inline branches,
and JSX without adding conditional types or user-defined type operations.
FlowBoard uses a `string | number` display boundary for real analytics metrics.
0.9Q adds a checked non-mutating `List.slice` method with zero, one, or two
positions. It preserves the list element type, supports negative and clamped
positions, rejects non-integer runtime inputs, and replaces SupportDesk's
`take(drop(...))` pagination expression with one direct range.
The subsequent application-language audit replaces the mismatched single-value
`List.push` surface with `append(value)` and adds atomic `extend(values)`.
Both retain native array storage and reactive-state mutation tracking without
exposing JavaScript's length-returning variadic contract. A first direct
mutation also resolves an unannotated empty List's element type for subsequent
reads and mutations, including component state.
0.9R adds a bounded pattern surface to `velar/text` instead of exposing regex
literals or mutable JavaScript `RegExp` values. Fresh Unicode patterns power
typed matching, first/all match records, literal all-match replacement, and
capture-free splitting with three explicit boolean options. Production Web
uses it to validate the public release-channel contract.
0.9S lets one explicit `?.` protect the rest of a continuous postfix chain
across fields, strict list indexes, calls, and compiler-owned collection
helpers. Skipped indexes and arguments stay lazy, present indexes keep strict
bounds, and assignment or unguarded optional-function calls fail closed.
Newsletter exercises the contract while extracting a validated email domain.
0.9T makes the existing record `type` family usable for finite trees and nested
application models. A least-fixed-point productivity check rejects required
self, mutual, alias-hidden, and non-terminating union cycles; cycle-aware static
assignability compares recursive shapes without widening them to `unknown`.
Generated validators preserve finite shared subtrees but fail closed on cyclic
or excessively deep object graphs. Production Web now owns the feature through
one recursive project model, recursive count, and recursive JSX component.
0.9U fills the browser timer gap with `after` and non-overlapping `every`
instead of permitting raw JavaScript timer globals or adding an effect model.
Both APIs validate durations, return idempotent stop functions, normalize
synchronous/asynchronous callback failures through the application `timer`
channel, and retain explicit sibling cleanup ownership. Production Web owns the
capability through timed readiness and a live heartbeat across route teardown.
0.9V fixes the lifecycle hole that the timer workload exposed. Component setup
and initial JSX construction now form an ownership transaction: sibling cleanup
and compiler scope destruction run on failure while independent cleanup errors
cannot mask the original cause. The lazy-component Promise boundary now also
routes post-load component-construction failures into its failure UI and owns a
last-resort alert if that custom fallback fails. Production Web's lazy failure
page starts a repeating timer before throwing; all browser runs remain free of
its delayed leak error.
0.9W applies build-before-commit ownership to mounted Router navigation. A
target component that fails construction now cleans its partial resources,
reports `render/router`, and leaves the active page and its error handler alive;
later navigation remains usable. Initial-route failures still escape to the
root mount fatal boundary. Production Web adds a static failing route with its
own delayed timer leak probe and verifies failure retention plus recovery in all
three browser engines.
0.9X removes two permissive Router leftovers instead of defending them as
flexibility. An unmatched route now produces an accessible default not-found
view rather than an empty comment. A custom fallback is compiler-checked as a
route component with `RouteContext`, while unsafe JavaScript results are
validated before the current page is destroyed. Production Web owns the typed
fallback through a direct unknown deep link and ordinary recovery navigation.
0.9Y removes the ambient JavaScript `Boolean`, `Number`, and `String` coercion
functions from ordinary source. `str(value)` remains intentional display
conversion; new `number(text) -> number?` accepts only complete finite decimal
text and never exposes `NaN`, partial parsing, hexadecimal shortcuts, or
empty-string-to-zero behavior. SupportDesk uses the optional result to restore
query-driven pagination, including a browser proof that `12px` is rejected.
0.9Z implements the structural comparison that the language charter previously
named but the library did not provide. `velar/json.deepEqual` recursively owns
records and Lists, Map values under native key identity, and Sets under native
membership while retaining reference identity for classes and other non-data
objects. Separate cyclic graphs terminate as unequal. FlowBoard now derives
Sample/Modified state from real persisted task structures rather than a manual
flag.
0.9AA closes a contradictory dynamic boundary uncovered by hostile standard-
library tests. Compiler-emitted record Types, runtime aliases, enums, and the
built-in `RouteContext` now share one registered identity across modules.
JSON, config, forms, HTTP, and storage reject lookalike objects without reading
their getters; enums now participate in the same static parsing contract they
already exposed at runtime. JSON validates Type identity before parsing or
cloning, and storage validates Type/key/value arguments before touching browser
storage. A packed multi-module application executes record-alias and enum JSON
parsing as the positive gate.
0.9AB turns resource behavior into an explicit production contract. Compiler
input, tokens, nesting, modules, manifests, runtime collections, JSON/text/URL,
async fan-out, forms/routes/storage, HTTP/file/realtime bodies, and production
asset inventories now have checked ceilings. Production hashes, preview files,
and remote deployment verification stream bytes instead of buffering whole
assets. Runtime List/Map/Set Type checks no longer allocate mirror collections,
form repeated-value accumulation is linear, npm assets are realpath-confined,
and focused hostile-input tests prove rejection before native effects. Compiler
lowering now also preserves the shared collection ceiling through List spread,
`Set`/`Map` construction, and `append`/`extend`/`add`/`set`; bounded logging, error-handler,
time, and UUID inputs close the remaining standard-service paths found by the
same audit. The return side is now equally explicit: file picker/reader results,
HTTP response metadata and headers, browser snapshots/layout/frame timestamps,
SSE event IDs, and secure UUID host output validate before entering a typed
Velar value. Picker validation failures reject instead of escaping the native
event callback and leaving the Promise pending.
The continuing application audit adds explicit `focus` and `blur` operations
for typed JSX refs. SupportDesk now restores focus to the action that opened its
native confirmation dialog after both cancel and asynchronous confirmation,
instead of depending on browser-specific implicit restoration.
The same audit no longer accepts SVG-looking HTML unknown elements. Native SVG
JSX now carries its DOM namespace through reactive/keyed children, fragments,
and ordinary or lazy user-component calls; SVG lazy components use a native
`g` host and forward namespace into loading/failure/resolved views;
`foreignObject` returns its child subtree to HTML,
and prefixed attributes use their native namespaces. SVG roots require an
accessible name or explicit decorative intent. API Dashboard is now a modular
project with typed HTTP data, checked JavaScript-package formatting, Core chart
coordinates, dynamically chunked component-rendered bars, an HTML `foreignObject` summary, and
direct browser namespace assertions.
The packed LSP and independently installed Workbench gate also complete
`svg`, `foreignObject`, `viewBox`, and `stroke-width` from the analyzer-owned
Web context. Those JSX tag/attribute contexts and the `children` rename guard
are now supplied by the Web compiler extension; the generic CLI project-semantic
layer and editor host contain no SVG-, JSX-, or Velar-specific branch.

## Complete

- npm-backed project dependency commands cover install, add, remove, and
  range-respecting update without introducing a Velar registry. Package and
  lockfile changes remain npm-owned; generic `velar.extension` metadata drives
  atomic format-2 extension activation and removal, including cleanup of the
  extension-owned manifest field. Registry arguments are bounded and passed
  after `--` without a shell, invalid activation restores the prior project
  manifest, and packed-consumer acceptance performs a real local-file npm
  install through the installed CLI.
- Indentation-aware lexer/parser, stable `VEL` diagnostics, formatter, source
  maps, and readable ESM JavaScript generation.
- Intentional diagnostics for rejected JavaScript legacy surface, including
  `var`, `null`/`undefined`, dynamic `this`, `new`, prototype manipulation, and
  JavaScript triple-equality and ambient coercion spellings.
- Explicit `str(value)` conversion plus strict `number(text) -> number?`
  decimal parsing with lazy optional narrowing and no `NaN` language value.
- Explicit `velar/json.deepEqual` for record/List/Map/Set data with bounded
  cycle behavior and preserved nominal/reference object semantics.
- `const`/`let`, functions, async/await, closures, strict control flow,
  destructuring, objects, lists, maps, and multi-file modules.
- Object field shorthand with checked identifier references, duplicate-field
  rejection, mandatory values for quoted keys, and ordered spread overrides;
  real domain commands use record inputs instead of fragile positional lists.
- Omitted function/method/action results mean `none` across local checking,
  module interfaces, async signatures, and semantic tooling. Natural completion
  is normalized to `null`; valued results remain explicit and exhaustively
  checked instead of falling into partial whole-body inference.
- Branch-owned optional narrowing for inline `? :`, including the inverse
  `not value` form, with the same safety as block `if` branches.
- Explicit `== none` / `!= none` narrowing for locals and stable fields across
  blocks, inline branches, assertions, and accumulated adjacent JSX rejection
  paths, including symmetric operand order and preserved present-empty values.
- Flat block `else if` chains with accumulated rejection facts, complete-return
  analysis, readable JavaScript emission, and real application coverage.
- Bounded negative `is` narrowing for simple unions and optionals across locals,
  stable fields, assertions, inline expressions, and JSX sequences, without
  facts leaking past their lexical branch.
- Production-retained `assert condition, "message"` statements with lazy
  failure messages, `AssertionError` naming, strict optional presence semantics,
  and following-statement narrowing that remains bounded to the lexical block.
- Typed final rest parameters for functions, methods, expression arrows, and
  extern declarations; function bodies receive `List<T>`, calls accept repeated
  values or checked list spread, and signatures cross module/LSP/`.d.ts`
  boundaries without exposing `arguments`.
- Typed `List.slice` shallow copies with zero-to-two checked integer positions,
  negative-from-end behavior, range clamping, and no JavaScript number coercion.
- Stateless Unicode text matching through `velar/text`, with typed options,
  stable match records, normalized optional capture groups, literal global
  replacement, capture-free splitting, and no exposed `RegExp` state or flags.
- Continuous optional postfix chains across fields, strict indexes, calls, and
  checked collection helpers, with lazy short-circuit operands, single receiver
  evaluation, preserved present-value errors, and rejected assignment targets.
- Productive recursive colon-form record types across static structural
  checking and opt-in runtime validation, with required-cycle diagnostics,
  cyclic-object rejection, bounded depth, and finite shared-subtree support.
- Cancellable browser `after` / `every` timers with finite duration checks,
  non-overlapping async turns, idempotent cleanup, and application-owned timer
  failure reporting without exposed JavaScript timer globals.
- Transactional component construction with sibling cleanup, incomplete-scope
  destruction, original-error preservation, and lazy-boundary recovery for
  post-load component or custom-fallback construction failures.
- Transactional mounted Router navigation with target-first construction,
  retained active DOM/ownership on failure, unified `render/router` reporting,
  and subsequent-navigation recovery.
- Concise `(T, ...U) -> R` function types for typed callback bindings, contextual
  arrows, object fields, component props, runtime validation, module interfaces,
  semantic hover, and cross-module diagnostics. Grouped optional functions and
  unions preserve precedence in both source and editor-visible type text.
- Transparent `type Name = ExistingType` aliases with static erasure, opt-in
  runtime validation, cycle/unknown-target diagnostics, semantic navigation,
  expanded direct/transitive module contracts, and field access through record
  aliases instead of a partially transparent type surface.
- Adjacent JSX `if` / `else-if` / `else` branches with optional narrowing,
  fail-closed sequencing diagnostics, transactional child replacement, and
  identity-checked ref cleanup.
- Contextual native event-handler types for keyboard, pointer, input, and base
  events; zero-parameter handlers remain valid, one-parameter handlers are
  checked structurally, and native event objects pass through unchanged.
- Native `Set()` / `Set(List<T>)` with local first-add inference, typed
  membership/mutation, insertion-order iteration, runtime validation, module
  propagation, semantic-index updates, and bounded `.d.ts` Set mapping.
- String-backed nominal enums with runtime parsing, exhaustive qualified
  `match`, stable cross-module identity under aliases, enum-safe JSX bindings
  and keys, and member completion/hover/definition/references/safe rename
  through the compiler LSP.
- Typed `in`, right-associative exponentiation, Map copy/snapshot operations,
  and Set List snapshots without exposing JavaScript iterator objects.
- Literal relative dynamic `.vel` imports with typed module results, graph/root
  confinement, reverse invalidation, definition navigation, and production
  code splitting; computed paths and dynamic JavaScript fail closed.
- Block `match` / `case` / `else` with strict grouped literal cases, isolated
  scopes, single subject evaluation, duplicate/type diagnostics, no
  fallthrough, and complete-return analysis.
- Typed `throw`, `try`/`catch`/`finally`, reliable `Error` normalization at
  JavaScript boundaries, thrown-path return analysis, and JavaScript-compatible
  `%` / `%=` remainder operations.
- Nominal classes with caller-owned constructor fields plus explicitly typed
  class-body instance/static fields, typed read-only getters, single inheritance, explicit base
  construction, `super`, mandatory `override`, abstract classes and methods,
  static methods, one native-backed `private` visibility boundary, built-in `Error` inheritance, subtype assignment, and
  inherited member checking across Velar module boundaries. Body-owned fields do
  not leak into constructor signatures, and static/instance members retain
  separate compiler/LSP identities.
- One lightweight `type` declaration family: the colon form defines structural
  record data, the equals form names an existing type, and both support static
  assistance plus opt-in runtime parsing / `value is Type`; there is no
  parallel schema system.
- Explicit safe JavaScript boundaries through `extern module` functions and
  read-only constants, nominal external classes with native construction and
  instance/static field, accessor, and method contracts, local declaration export tables, relative type
  imports, export-map package subpaths, and bounded package-local declaration
  graphs across `.d.ts`/`.d.mts`/`.d.cts`, plus the separate `import js unsafe`
  escape hatch.
- Native JSX and compiler-managed components lowered directly to DOM operations
  without a virtual DOM.
- Module and component `state`, lazy `computed`, `watch`, `mounted`, sibling
  `cleanup`, cross-module dependency tracking, deterministic DOM/watch queues,
  and `tick`.
- JSX fragments and declared children, keyed list reuse, event/resource/action
  disposal, string/number/checked form binding, event modifiers, refs,
  class/style directives, unsafe HTML opt-in, and component-scoped CSS.
- Component-only `resource` declarations for typed `Promise<T>` loading with
  reactive value/loading/ready/error state, explicit reload, latest-generation
  ownership, application error reporting, and destruction-safe completion.
- Component-only callable `action` declarations with implicit async bodies,
  typed parameters/results, reactive pending/error state, latest-failure
  ownership, recoverable application reports, and destruction-safe completion.
- Web diagnostics for keys, bindings, refs, events, duplicate attributes,
  unsafe HTML, and basic accessibility contracts.
- `velar.json` plus `velar check`, `build`, `verify`, `preview`, `dev`, `test`,
  `format`, and `lsp`.
- Project format version 2 with an explicit `extensions` list, fail-safe
  `velar create`, and a clean break that rejects legacy manifests instead of
  loading or rewriting them.
- Ten explicit Web modules: `velar/app`, `velar/config`, `velar/web`,
  `velar/http`, `velar/storage`, `velar/forms`, `velar/browser`, `velar/files`,
  `velar/realtime`, and `velar/web-test`; Core assertions remain in
  `velar/test`.
- Independently versioned Standard API 0.4 with 133 exports across
  `velar/collections`, `velar/text`, `velar/math`, `velar/json`, `velar/async`,
  `velar/url`, `velar/time`, `velar/id`, and `velar/log`.
- Compiler-owned lightweight polymorphic signatures preserve list, map,
  callback, optional, runtime-parsed data, and Promise result types without
  adding user-defined generics to the language.
- Core builds carry only their imported `velar/*` runtime modules in a local
  Node package, while Web production builds bundle and tree-shake the same
  module authority.
- Route matching/navigation, typed HTTP parsing and errors, explicit validated
  persistence, and `.test.vel` / `test_*` discovery.
- Safe multipart form bodies with repeated text fields, opaque picked-file
  attachment, browser-owned boundaries, forged-file rejection, and typed HTTP
  response parsing without exposing `File` or `FormData` globals.
- Flat native-form record decoding for strings, finite numbers, booleans,
  enums, repeated strings, and optional scalars, with compiler-generated private
  descriptors and application-owned validation/error behavior.
- Bundled, minified, tree-shaken, content-hashed production JS/CSS with linked
  source maps and a byte/SHA-256 build manifest.
- npm-distributed Velar source packages through `package.json` `velar.entry`,
  including transitive `.vel` compilation and package-root confinement.
- Browser compile/runtime overlays, `.vel` stack mapping, last-good-build
  retention, and full Velar-module-graph hot invalidation. HMR resets module
  state; only explicit storage persists.
- Real Counter and Todo applications plus the modular API Dashboard production
  project with typed data loading, JavaScript-package interop, accessible SVG
  chart components, Core tests, and three-engine browser acceptance.
- FlowBoard, an independent nine-module project application with finite task
  workflows, immutable transforms, secure IDs, validated local persistence,
  CRUD, search/status filtering, lazy analytics, and browser-owned acceptance.
- SupportDesk, an independent eight-module routed application with checked
  `RouteContext`, validated HTTP data, typed native-form extraction, accessible
  field errors, sorting/pagination, direct-route recovery, active navigation,
  native modal confirmation, persisted status changes, and browser-owned
  detail-route acceptance.
- SupportDesk initial/deep-link loading now uses compiler-owned resources rather
  than duplicated ready/loading/error lifecycle state, including retry UI.
- Compiler-owned typed semantic index and incremental project session.
- Versioned language-server protocol with diagnostics, completion, hover,
  formatting, definition, references, fail-closed rename, document symbols,
  signature help, same-document occurrence highlights, and bounded inferred-type
  inlay hints for source-compatible unannotated bindings. Full semantic tokens
  reuse exact compiler declarations/references and standard quick fixes cover
  only semantics-preserving strict-equality and indentation rewrites.
- Scope-aware completion exposes only visible lexical symbols with correct
  shadowing and declaration order. Analyzer-owned member signatures drive
  record/class/collection/resource/action/enum/Type member completion without a
  second LSP or Workbench type table. Selectively indexed checked expressions
  extend the same completion and active-parameter signatures through collection
  literals, nested members, runtime parsing, and Web API chains. Member hover
  reuses those expression types; source-backed record fields and class
  fields/getters/methods navigate by owner identity across aliases and inheritance,
  including inherited static declarations, without textual field-name search.
  Owner-based references and atomic rename cover typed
  record construction/return/destructuring/Type literals and complete class
  field, getter, or method override chains; shorthand keys preserve local bindings and
  hierarchy collisions reject the edit.
- Component parameter identity now crosses module aliases into checked JSX
  attributes. Definition, hover, references, and atomic rename cover the
  declaration, body uses, and call sites; native attributes remain Web-owned
  and implicit `children` is protected from an incomplete rename.
- Contextual completion distinguishes JSX tag names, component attributes,
  native Web attributes/directives, and typed object-literal keys. It offers
  visible components plus focused native tags at `<...`, checked component
  parameters at call sites, and only missing record fields at object-key
  positions; value expressions restore ordinary lexical completion.
- VelarOS Workbench injected `.vel` syntax/LSP/project-command contribution,
  shared generic semantic LSP client, and a focused JS/TS/Python/Velar/Web
  surface. The renderer now consumes external-LSP semantic tokens, exact
  document highlights, non-TypeScript inlay hints, structural completion
  triggers, and safe current-file code actions through generic contracts.
  Workbench and the compiler remain independent products.
- Versioned Velar Web API 0.8 for application error ownership, bounded stable
  DOM IDs, explicit public configuration, routing/navigation, metadata ownership, HTTP,
  storage/IndexedDB, forms, browser environment, files, realtime, and tests;
  compiler interfaces and emitted runtime code share one authority.
- Web 0.8 route/form completion: runtime-validatable
  `RouteContext`, checked route patterns/component props, typed text/number/
  checkbox/multi-value form reads, and owned native reset.
- Web 0.8 navigation/dialog completion: application-relative
  `NavLink` activity with `aria-current`, nominal `DialogElement` refs, and
  mounted native modal open/close/result helpers without untyped DOM access.
- Lazy root mounting surfaces an accessible fatal state; failed dynamic/keyed
  updates retain the last valid DOM. Sync/async event and mounted failures are
  classified through `velar/app`, and independent cleanup steps continue after
  a reported failure.
- Manifest-owned `web.publicConfig` is JSON-only, size/key constrained,
  recursively frozen, type-validated, and embedded as public build input.
  `velar/log` provides leveled scoped logging and explicitly disposable sinks
  without exposing `console` to Velar source or sending telemetry.
- Intentional `VEL3008` diagnostics replace untyped `console`, DOM/window,
  Fetch, JSON, Math, and Date globals with official modules or an explicit
  JavaScript boundary.
- Base-aware `Router`, `Link`, `NavLink`, and `navigate`, including checked
  custom fallback routes, an accessible default not-found view, transactional
  target validation, and browser history helpers.
- Typed `velar/web.lazy` routed components with loading/failure UI, successful
  module caching, failure retry, application error reporting, and deterministic
  child mount/cleanup.
- Project compilation statistics and incremental dev-server rebuilds that
  recompile only changed modules and reverse dependents.
- Dynamic watching for installed and workspace Velar npm package roots.
- Machine-readable development status and deterministic production build
  identity/module composition/asset roles, including framework package,
  capability, target, host-protocol version, API version, and artifact kind.
- Playwright-backed Chromium, Firefox, and WebKit acceptance automation plus a
  121-module application-scale incremental budget.
- A three-module reusable Velar Web library exercising public data types,
  functions, nested components, children, and scoped CSS.
- Publishable `@velarscript/compiler`, `@velarscript/web`, `create-velar`, and
  `@velarscript/cli` JavaScript plus `.d.ts` packages, verified from packed
  tarballs in a clean npm consumer. The creator owns checked `web`, `docs`, and
  `library` templates shared by npm and CLI entry points.
- A deliberately limited `.d.ts` bridge for safe JavaScript package imports;
  constants/functions, nested callback parameters, and simple object/interface
  fields, methods, or directly expandable bases map to Velar types. Unsupported
  constructs remain `unknown` with nonfatal `VEL9002` notices, and inheritance
  never weakens silently by dropping base fields.
- Production dependency summaries that distinguish Velar source packages from
  JavaScript packages.
- Reproducible compiler/Web/creator/CLI release rehearsal with source-tree identity,
  SHA-256 checksums, strict tagged-candidate refusal, and no publication path.
- Linux/macOS/Windows Node 24 CI plus Chromium/Firefox/WebKit development and
  CSP production browser matrices.
- Isolated static builds with last-good output preservation, reserved-file and
  public-symlink rejection, strict default CSP, SPA fallback, header/cache
  contract, format-3 framework build manifests, and format-2 deployment manifests.
- A 15-module Release Studio exercising typed data, async HTTP, routing and
  metadata, accessible forms/progress, browser state, local/session/IndexedDB
  persistence, file selection/downloads, explicit watcher cleanup, reusable
  Velar packages, and safe JavaScript npm packages.
- Local WebSocket and server-sent-event fixtures validate explicit connection
  ownership and clean shutdown across all development/production browser flows.
- Cross-repository Workbench acceptance that installs the packed toolchain into
  a temporary project and obtains diagnostics, completion, and inferred-type
  hints plus document highlights through its generic project-local LSP path,
  including suppression for explicit/resource annotations and current-document
  filtering for exact symbol occurrences.
- Project-owned `.browser.test.vel` suites through `velar test --browser`, with
  restricted typed automation, a real CSP production build, per-test browser
  isolation, automatic runtime-error failure, engine selection, and generated
  project coverage through an installed packed CLI.
- Release Studio recovery plus eight-cycle route/cleanup soak scenarios pass in
  Chromium, Firefox, and WebKit through the product command.
- A root-base Netlify adapter emits official `_headers` and `_redirects` files
  from the neutral deployment manifest; adapter files are reserved and included
  in build hashes and identity.
- Generated Core and Web projects declare their compiler extensions explicitly;
  missing, format-1, and unknown future manifests fail closed with no legacy
  loader or upgrade command.
- Strict application-build verification rejects missing, extra, modified,
  symlinked, unsafe, duplicated, or structurally inconsistent output while
  recomputing every SHA-256 and `buildId` and cross-checking deployment state.
- The production preview server refuses unverified builds, applies the emitted
  base/security/cache contract, supports GET/HEAD only, limits SPA fallback to
  HTML navigation, and leaves missing assets as 404. Browser-project tests use
  this same verifier/server instead of a repository-only approximation.
- Production bundling no longer exposes random temporary module paths to
  esbuild. Repeated builds into distinct directories produce identical asset
  names, bytes, manifest, and `buildId`, including when source maps are enabled.
- Linked production source maps are an explicit `web.build.sourceMaps` opt-in;
  generated and legacy projects default to no public source maps.
- Production document and manifest cache rules are explicit. The Netlify
  adapter preserves missing `/assets/*` responses as 404 before its SPA rewrite.
- `velar verify-deployment` compares the locally verified build to the served
  HTTPS site, including bytes, hashes, MIME types, security/cache headers,
  base/root navigation, SPA fallback, redirects, and missing-asset behavior.
- `verify-deployment --json` emits a versioned evidence report. A manual,
  credential-free GitHub workflow attests it with the exact build/deployment
  manifests and contains no deploy or publish action.
- A checked-in `velar.netlify.json` profile and guarded `preview:prepare`
  command create a reproducible root Netlify Release Studio bundle without
  source maps. Canonical/social metadata comes from typed profile configuration,
  and Chromium exercises that exact prepared bundle.

The current requirement-to-evidence gate is maintained in
[1.0-acceptance.md](1.0-acceptance.md), with milestone history in
[0.9-acceptance.md](0.9-acceptance.md), the completed application-language
matrix in [0.8-acceptance.md](0.8-acceptance.md) and hardening matrix in
[0.7-acceptance.md](0.7-acceptance.md) and broader exit criteria in
[production-readiness.md](production-readiness.md).

## Current stage: authorized external preview preparation

The internal 0.7A–0.7G, 0.8A–0.8F, 0.9A–0.9AB, and 1.0A–1.0L engineering
sequences are complete. Apache-2.0 now covers the repository and packed
toolchain packages. Public commit `0faf7d5`, draft PR #1, and the independent
Website repository now provide the first attributable source identities. The
next evidence stage requires review and merge, an external preview, and later
publication. Compiler, language server, and the independently packaged
Workbench contribution continue on the delivery axis defined in
[workbench-integration.md](workbench-integration.md).

The first audit slice established the ordinary project boundary. Project formatting now operates on an
entire manifest-owned source tree while excluding dependencies, public assets,
and build output. `velar create` produces a separate app/entry, a real Core
test, a browser test, and format scripts; packed installed acceptance installs
the tarballs into that generated project and uses only its npm scripts for
format/check/Core test/build/verify/browser test. The same audit removed lossy
JavaScript JSON behavior: `velar/json`, storage/IndexedDB writes, and HTTP JSON
bodies accept only finite primitive/record/dense-List data, reject known
non-data types during checking, and validate unknown/unsafe values before any
write or request. A type/runtime export-drift test now covers every official
module.

The Web audit then removed unusable route forms. Static and dynamic
route patterns now agree on pathname-only syntax, canonical segments, and one
reserved terminal wildcard capture. Undecodable route parameters become normal
404 non-matches. The verified preview server safely preserves SPA recovery for
an in-base malformed HTML navigation while retaining 400 behavior for the same
asset-shaped request.

Managed Web callback ownership is now uniform. Browser/media/online/visibility
watchers, storage watches, WebSocket handlers, and server-sent-event handlers
route synchronous throws and rejected promises through `velar/app` with stable
phase/detail metadata. Cleanup stays explicit and removes native listeners;
there is no hidden effect lifecycle or second native-event error channel.

HTTP cancellation now agrees with its lazy request model. Cancelling before the
first read prevents `fetch`, active cancellation is idempotent, and timeout or
cancel rejection uses `HttpAbortError` with a stable reason instead of leaking
browser-specific abort values. Non-2xx responses remain `HttpError`.

Realtime JSON no longer bypasses the language data contract. WebSocket
`sendJson` now shares strict validation with `velar/json`, HTTP, and storage;
known lossy types fail checking and dynamic invalid data fails before the
socket sends any bytes.

Core assertions now use the language's one explicit structural-equality rule.
`velar/test.toEqual` delegates to the same `deepEqual` contract as application
code, including dense-List, record-data, Map/Set, class-identity, cycle, and
getter-safety behavior.

Time construction no longer exposes JavaScript's silent calendar rollover or
special 1900 mapping for years 0–99. `velar/time.date` and `utc` validate real
calendar fields, while `parse` accepts one deterministic ISO date/offset grammar
instead of engine-dependent native date text.

Collection semantics now stay inside Velar's equality and boolean rules.
`contains` and `count` agree with `==`; predicate helpers reject truthy non-bool
results; sort/min/max keys are one uniform string or non-NaN number type; and
descending sort remains stable for equal keys. Collection, async, URL query,
form-decoder, and multipart List boundaries reject sparse/extended arrays.

The math module no longer exposes native numeric coercion through direct
`Math.*` exports. Dynamic non-number inputs fail, rounding owns a bounded
decimal-place contract without scale overflow, and random/integer helpers use
safe ranges with explicit overflow failure.

URL helpers now validate actual string inputs, preserve protocol separators
when joining segments, and accept only explicit scalar or dense-List query
values. Arbitrary objects cannot silently become `"[object Object]"` in an
address or request query.

Structured logging now rejects dynamic string/key/Error coercion and delivers
an independent fields snapshot to each sink. A misbehaving capture cannot
rewrite the record observed by another sink.

Text padding/repetition/truncation now requires explicit safe-integer counts,
and pattern option validation accepts only plain data fields. Accessor-backed
options fail without executing the getter.

Runtime Type parameters can no longer be faked by giving an arbitrary object
`is` and `parse` fields. Compiler-emitted record Types, runtime aliases, enums,
and built-in Types carry one shared module-independent identity. JSON,
configuration, forms, HTTP, and storage validate that identity without reading
lookalike getters; storage also finishes key/value validation before accessing
the browser store. Async attempts/messages and time locale/time-zone arguments
continue to reject ambient coercion.

Test matchers now fail closed. The compiler exposes containment/match/length/
throw/reject assertions only for compatible subjects, runtime checks mirror
that contract, `toBe` follows language `==`, and boolean assertions do not
restore JS truthiness. A non-function cannot satisfy `toThrow`, and a sync
throw cannot satisfy `toReject`.

IndexedDB persistence now resolves at transaction completion, so a request
success followed by transaction abort cannot be reported as saved. Failed or
blocked opens clear their cached promise for retry, version changes close stale
handles, keys validate before opening a transaction, and listings are stable.

HTTP construction now fails before Fetch for accessor/unknown options, invalid
methods/policies, non-string headers, coerced primitive bodies, GET/HEAD bodies,
or fake runtime Types. Multipart text is strict, and opaque file authority is
held in a shared WeakMap registry rather than a copyable symbol property.

Public Web option records now cross one data-only boundary: validation copies
accepted fields into an isolated no-prototype record, so accessors and polluted
prototypes cannot run later. `Head`, `Router`, `Link`, `NavLink`, navigation,
forms, file picking, and realtime handlers fail before DOM/history/FormData/
native-file/connection effects. Browser helper strings, finite scroll values,
file downloads, EventSource credentials, WebSocket messages, close codes, and
UTF-8 reason length are explicit. Runtime and compiler-generated `List<T>`
checks also reject accessor elements without reading them.

The toolchain audit now makes project and delivery state fail closed. `velar
create` stages a complete scaffold before replacing only an absent or empty
target; manifest objects reject unknown fields and non-canonical Web bases;
command-specific help and normalized failures are available from installed CLI
packages. The LSP recovers from malformed JSON frames, caps transport messages,
caps semantic result collections at 10,000 entries, rejects rather than partly
applying an oversized rename, ignores stale document versions, and refuses
requests after shutdown without a protocol fork. Release and external-preview
output replacement reject unsafe or unrelated directories, while release
verification requires the exact package set, canonical identities, hashes,
checksums, and file inventory. The generic
Workbench contribution now injects project format/format-check commands and
verifies tarball hashes independently. Its external-LSP path now also maps
standard type inlay hints without a Velar-specific host branch. The installed
current-release gate proves one inferred collection type and one suppressed
explicit annotation, resource-handle suppression, and exact same-document
highlights. It also proves a narrowed local, component resource/action/prop,
checked List members through ordinary completion, a collection-literal
`slice` signature, compiler-owned defaultable/nullable parameter labels,
`route.params` Map completion/signature/hover, and typed
record-field definition plus multi-site rename navigation. External LSP
acceptance also proves a component prop definition/hover/reference and
three-site rename without a Workbench JSX prop table. The packed installed gate
now also creates a real typed npm class and proves its aliased instance member
completion, optional-parameter signature help, and nominal hover through the
same generic host. External LSP
request/response frames are now capped at 16 MiB and
malformed or oversized responses terminate the owned server connection. A
15-second per-request deadline removes stalled work and sends standard LSP
cancellation. All 9 focused generic-language-host tests pass through a narrow
four-method language-path interface without loading the wider Workspace
runtime.

The bounded-resource audit now passes its complete internal delivery matrix:
197 compiler/CLI tests, FlowBoard, SupportDesk, and API Dashboard Core tests, packed consumer
installation, reproducible non-publishing rehearsal, installed Workbench
toolchain acceptance, the 9 generic-host tests, and Chromium/Firefox/WebKit
development plus verified CSP production application suites. The new limits
and streaming paths therefore have compiler, runtime, package, editor-host, and
real-browser evidence rather than isolated unit coverage.

The class-surface audit removes a domain-model workaround rather than adding a
second constructor form. `const`/`let` fields can now live in the class body,
while constructor parameters remain caller input. Explicit field types keep
forward module contracts deterministic; initialization, mutability,
inheritance conflicts, static/instance separation, completion, definition,
references, rename, and emitted native classes share one compiler authority.
API Dashboard owns the feature through `ChartScale`: its body-owned derived pixel
ratio is not a fake constructor parameter, its static default stays on the
class, and the instance crosses the checked lazy SVG component boundary.

The async-expression audit removes another real application workaround. Short
workers now use `async value => expression`, receive contextual parameter types,
infer `Promise<T>`, adopt returned Promises, and own their `await` boundary.
Synchronous arrows can no longer borrow top-level or outer async permission,
and JSX rejects direct or nested Promise children before lowering. API
Dashboard loads two independently validated metric feeds concurrently with the
official async mapper. Its natural multiline call also exposed a lexer/parser
gap: imports, parameters, function types, type arguments, constructors, Lists,
objects, and calls now accept trailing commas without creating false indentation
tokens after a closing delimiter. The real browser workload also caught a
postfix-precedence bug that static checking could not: `(await load()).items`
must not become `await load().items`. Emission now groups awaited, unary, arrow,
and other non-primary receivers before member access or invocation. Compiler
execution, module/LSP signatures, packed Workbench hover/signature behavior,
and all browser engines share the same contract.

The follow-up async-contract audit removes the remaining difference between
expression and block forms. `async def`, async methods, component actions, and
async arrows all annotate the resolved value as `-> T`, accept either `T` or
`Promise<T>` from `return`, and expose one `Promise<T>` call signature through
module interfaces and the LSP. Explicit `-> Promise<T>` on an async declaration
is rejected instead of creating two source spellings. Direct `await` in a
parameter default now fails before emission because JavaScript formal
parameters do not own the async body boundary; a nested async callback remains
valid and resets that boundary. Runtime execution, cross-module analysis, and
the packed Workbench sample cover the contract without adding an artificial
application wrapper.

The expression-emission audit fixes two JavaScript-boundary failures instead of
documenting them as source-language quirks. Power now has an explicit
right-associative grammar with predictable unary-sign, signed-exponent, and
awaited-base behavior, so accepted Velar cannot become a JavaScript exponent
syntax error. Because arrow bodies are expressions only, an object body is
parenthesized during lowering and returns its value rather than silently
becoming a JavaScript label block. Runtime tests cover the ordinary, grouped,
signed, chained, awaited, and async-object forms.

The class-construction audit adds one `init:` block rather than a second
constructor spelling. It runs synchronously after base construction,
parameter-backed fields, body fields, and bound instance methods; direct
`return` and `await` are rejected while nested functions own their own execution
boundary. It is not inherited or exposed as a class member. The AST, parser,
analyzer, emitter, module traversal, semantic index, LSP keyword/completion, and
injected Workbench highlighting share this contract. API Dashboard now proves
the feature through a real `ChartScale` construction failure, and its Core suite
contains three tests. `init` is contextual rather than globally reserved:
bindings, record/object fields, ordinary methods, and refactoring targets may
retain that name without colliding with the direct class-body `init:` form.

The comparison audit adopts Python's readable chained form without adopting
implicit conversion. `0 < value <= limit` and strict equality chains evaluate
each operand once from left to right and short-circuit later links. Ordered
links accept only number/number or string/string; booleans, objects, and mixed
types no longer fall into JavaScript coercion. A direct awaited operand remains
a boolean-producing expression through immediately awaited lowering. API
Dashboard now declares both `ChartScale` bounds with the new form, while
execution tests prove single evaluation, short-circuiting, strict equality,
string order, await behavior, and invalid-type diagnostics.

The public-API documentation audit adds bounded Markdown `///` comments as
compile-time symbol metadata. Contiguous same-indentation lines attach to the
next declaration; blank source lines detach them, and ordinary comments remain
non-documenting. Documentation emits no JavaScript, carries no duplicate type
syntax, resolves across exported aliases and source members, and reaches both
standard LSP hover and completion. API Dashboard owns real documented chart
contracts, while the packed Workbench fixture proves generic-host transport.

The class-encapsulation audit closes the public-state workaround left by the
first class-body-field slice. Members remain public by default, while one
`private` modifier covers constructor-backed fields, typed instance/static
fields, and concrete synchronous/asynchronous methods. The analyzer keeps the
private shape out of published class interfaces and inheritance contracts;
inside-class completion, documentation, definition, references, and rename
retain access, while consumers and subclasses do not. Emission uses native
JavaScript `#` slots, including bound private instance method fields and native
static private methods. Implementation testing rejected the initial idea of a
contextual `private`: JavaScript modules reserve that binding in strict mode,
so Velar reserves it too instead of accepting source that would emit invalid
JavaScript. API Dashboard now makes `ChartScale.pixels` genuinely private, and
the installed Workbench fixture proves that it is visible through `self` but
absent from instance completion outside the class.

The following class-API audit adds one deliberately narrow accessor form:
`get name() -> Type:`. It is parameterless, synchronous, explicitly typed, and
read-only; Velar keeps writable state in `let` fields instead of adding setters.
Public/private and instance/static getters lower to native JavaScript accessors,
abstract getters participate in concrete-class completeness, overrides require
the base result contract, and `super.name` reads the base implementation. Getter
identity survives module interfaces and property-shaped LSP navigation,
documentation, references, and rename. API Dashboard now drives its SVG ceiling
from `ChartScale.top`, and the packed Workbench sample exposes a documented
`ScoreCard.summary` without teaching the editor its own accessor rules.

The failure-containment audit treats malformed and transient development input
as a normal operating condition. A deterministic corpus now drives compile,
inspect, and format APIs across 2,000 malformed modules without allowing an
internal exception to escape. Watched rebuilds catch failures outside ordinary
Velar diagnostics, keep serving the last good module graph, publish the failure
through the status/SSE channel, and retry on the next edit. The retained test
then proves recovery plus convergence after 64 rapid writes. Incremental
sessions separately remove and restore a dependency while retaining the exact
compiled result for an unrelated module.

External preview feedback is still required before a production-ready claim.
The first public repository/tag, npm publication, and preview deployment remain
explicitly deferred external mutations.

`velar/game` remains deferred until the production Web platform is usable and
stable. It will be a Canvas-oriented package, not a second language runtime.
