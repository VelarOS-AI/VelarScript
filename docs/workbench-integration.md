# VelarOS Workbench Integration

VelarScript and VelarOS Workbench advance as one product chain while remaining
independent products. Workbench is the general editor host; a default built-in
Velar contribution supplies the first-generation Velar editing experience, and
the compiler and language server remain the semantic authority.

## Stable seam

- The reusable Workbench core does not know `.vel`, Velar commands, or the
  Velar protocol. It owns only generic language-contribution and stdio LSP
  host contracts.
- The separately packaged Workbench Velar contribution is injected by the app
  and supplies `.vel` association, Core syntax coloring, indentation presentation,
  `velar.json` detection, generic check/format/format-check/dev/Core-test/browser-test/build/verify/
  preview/deployed-site-verification/project-check command metadata,
  the LSP descriptor, and
  protocol compatibility declaration.
- The Workbench contribution contains no Web keyword, type, JSX directive, or
  module table. A format-v2 project that declares `@velarscript/web` receives
  those editor semantics from the project-local compiler extension through LSP
  completion and semantic tokens.
- `velar lsp` owns diagnostics, completion, hover, formatting, definition,
  references, same-document symbol highlights, safe rename, document symbols,
  signature help, inferred-type inlay hints, and all future semantic features.
- Static and dynamic `.vel` path strings use that same generic definition
  capability to open the target module. 0.8A adds no Workbench-only resolver,
  command, protocol branch, or embedded compiler dependency.
- 0.8B adds `match` and `case` only to the injected Velar lexical contribution;
  parsing, type compatibility, duplicate detection, and return analysis remain
  entirely compiler/LSP-owned.
- 0.8D rest parameters reuse the existing `...` lexical surface. Rest-list
  binding types and variadic signature help come from the compiler semantic
  index, so neither the generic Workbench host nor the injected contribution
  needs a new type rule or protocol version.
- 0.8E `Set` remains an ordinary compiler-owned Core binding and type. Hover,
  diagnostics, imported signatures, and inferred `Set<T>` symbols flow through
  the existing LSP channel; Workbench adds no collection semantics.
- 0.9A branch narrowing, `RouteContext`, checked route calls, and typed form
  helpers remain compiler/LSP and standard-module semantics. Workbench receives
  them through the same installed toolchain without a generic-host branch.
- 0.9B `NavLink`, `DialogElement`, and native dialog helpers follow the same
  boundary. Installed-toolchain acceptance checks the named type and imports;
  Workbench adds no route-matching, DOM, or dialog semantics.
- 0.9C `resource` adds only a keyword to the injected lexical contribution.
  Promise checking, inferred resource fields, diagnostics, hover, lifecycle,
  retry, and stale-completion behavior remain compiler/LSP/runtime-owned;
  Workbench has no resource state machine or Velar-specific host branch.
- 0.9D `action` follows the same seam: Workbench highlights the injected
  keyword, while callable typing, pending/error members, diagnostics,
  concurrency, failure reporting, and component disposal stay entirely in the
  compiler/LSP/runtime and packed-toolchain acceptance.
- 0.9E function types reuse existing punctuation and require no lexical-host
  change. Parsing, callback variance, component-prop checking, imported
  signatures, hover, and diagnostics are compiler/LSP-owned and verified by
  the packed project-local toolchain in the generic host.
- 0.9F aliases reuse the existing injected `type` keyword. Alias expansion,
  runtime validation, transitive module contracts, hover, definition, and
  references remain compiler/LSP-owned; Workbench adds no alias model.
- 0.9G JSX branches reuse ordinary JSX attribute tokenization. Sequence
  diagnostics, optional narrowing, ref contracts, and DOM ownership remain in
  the compiler/LSP/runtime; Workbench adds no template directive engine.
- 0.9H native event payloads reuse the same JSX attributes and semantic index.
  Contextual parameter inference, signature diagnostics, hover, and runtime
  pass-through remain compiler-owned; Workbench adds no event table.
- 0.9I omitted result annotations reuse existing function syntax. The compiler
  defines them as `none`, exports that signature, and normalizes completion;
  Workbench only displays the installed LSP result and adds no inference rule.
- 0.9J typed form reads are a compiler intrinsic plus `velar/forms` runtime API.
  Record validation, supported field diagnostics, decoded result type, and
  hover stay in the installed toolchain; Workbench adds no schema or form model.
- 0.9K dotted optional-field narrowing is analyzer and semantic-index behavior.
  Workbench consumes the narrowed-result hover through the same LSP and adds no flow
  analysis, keyword, or protocol branch.
- 0.9L assertions add one injected lexical keyword. Condition diagnostics,
  lazy failure behavior, lexical proof scope, completion, and narrowed result
  types remain compiler/LSP-owned; Workbench adds no assertion runtime or flow
  engine.
- 0.9M record inputs reuse ordinary object literals, destructuring, and the
  existing `type` surface. Shorthand reference checking, duplicate diagnostics,
  inferred record types, and hover remain compiler/LSP-owned; Workbench needs no
  grammar or protocol branch.
- 0.9N explicit `none` comparisons reuse existing equality tokens. Positive and
  negative branch facts, stable-field identity, assertion continuation, and JSX
  rejection accumulation remain compiler/LSP-owned; Workbench adds no keyword,
  grammar rule, host flow engine, or protocol branch.
- 0.9O block `else if` chains reuse the existing injected `else` and `if`
  keywords. Parsing, accumulated rejection facts, return completeness, flat
  JavaScript emission, diagnostics, and formatting remain compiler/LSP-owned;
  Workbench adds no combined token, host flow rule, or protocol branch.
- 0.9P simple-union exclusion reuses the existing `is`, `not`, and union
  punctuation. Positive and rejected-member facts, stable-field identity,
  assertion continuation, JSX sequencing, diagnostics, and hover remain
  compiler/LSP-owned; Workbench adds no type algebra or protocol branch.
- 0.9Q `List.slice` is an ordinary collection member owned by the compiler and
  generated runtime helper. Arity, element preservation, integer validation,
  diagnostics, and hover arrive through the installed LSP; Workbench adds no
  method table, lowering rule, keyword, or protocol branch.
- 0.9R text patterns are ordinary `velar/text` exports owned by the compiler and
  Standard API runtime. Signatures, option checking, result records, runtime
  behavior, diagnostics, and hover arrive through the installed LSP; Workbench
  adds no regex grammar, pattern table, flag interpretation, lowering rule, or
  protocol branch.
- 0.9S continuous optional chains reuse the existing `?.` token. Chained type
  propagation, lazy short-circuiting, strict index/collection lowering,
  assignment diagnostics, and hover remain compiler/LSP-owned; Workbench adds
  no flow engine, chain table, lowering rule, keyword, or protocol branch.
- 0.9T recursive records reuse the existing colon-form `type` and `List<T>`
  annotation surface. Productivity analysis, cycle-safe structural comparison,
  bounded runtime validation, diagnostics, and nested-field hover remain
  compiler/LSP-owned; Workbench adds no type graph, validator, grammar fork,
  keyword, or protocol branch.
- 0.9U browser timers are ordinary `velar/browser` exports. Duration and
  callback checking, cleanup-handle typing, non-overlapping scheduling, failure
  reporting, and runtime behavior stay compiler/Web-owned; Workbench adds no
  timer table, lifecycle engine, lowering rule, keyword, or protocol branch.
- 0.9V component-construction transactions and lazy post-load recovery are
  compiler/Web-runtime ownership behavior. They add no source token, semantic
  service capability, editor lifecycle engine, host branch, or protocol change;
  the installed packed compiler remains the sole lowering authority.
- 0.9W Router build-before-commit navigation and retained-page recovery are
  ordinary `velar/web` runtime semantics. Workbench adds no route state,
  navigation transaction, failure UI, host branch, or protocol change.
- 0.9X typed Router fallbacks, default not-found rendering, and pre-commit
  runtime target validation remain compiler and `velar/web` ownership. The
  installed sample passes a `RouteContext` fallback through the ordinary
  injected LSP; Workbench adds no router prop checker or 404 UI.
- 0.9Y strict `number(text) -> number?` parsing and rejection of ambient
  JavaScript coercion globals are compiler/Core semantics. The installed sample
  hovers the optional result through the existing LSP; Workbench adds no
  conversion table, type rule, keyword, or lowering branch.
- 0.9Z `velar/json.deepEqual` is an ordinary typed standard-module export. Its
  record/List/Map/Set and cycle behavior stays in the package runtime; the
  installed compiler hovers the boolean result through generic LSP plumbing and
  Workbench adds no equality engine, reflection model, or protocol branch.
- Workbench maps those standard capabilities through one generic external-LSP
  path shared with Python and future injected languages. It does not branch on
  Velar semantics.
- Type hints use the standard `textDocument/inlayHint` request. The compiler
  emits source-compatible inferred types for unannotated `const`/`let`, `state`,
  and `computed` bindings, omits redundant explicit annotations, bounds each
  response, and leaves resource handle shapes in hover because they are not the
  same type written after a source-level resource annotation. Workbench only
  maps the standard hint kind, label, and position into its generic editor
  contract. The CodeMirror request gate follows semantic language contributions,
  so `.vel` and Python are no longer accidentally excluded by a TypeScript-only
  renderer check.
- Occurrence highlighting uses standard `textDocument/documentHighlight` and
  the compiler's existing exact reference index. The LSP filters results to the
  requested document and caps the response; Workbench maps those ranges through
  the same language-neutral feature already used by TypeScript. No lexical text
  search or Velar-specific host path is involved. The renderer replaces its
  plain-text same-word fallback with these exact ranges for semantic languages,
  including injected `.vel` documents.
- The installed language server also exposes standard
  `textDocument/semanticTokens/full` from compiler-owned declaration/reference
  identity and `textDocument/codeAction` for the narrow safe rewrites
  `===`/`!==` to Velar equality and indentation tabs to spaces. These introduce
  no Velar-specific transport extension. The generic Workbench host maps both:
  CodeMirror overlays semantic classifications on the injected syntax tokenizer,
  and diagnostic actions apply only proven, non-overlapping current-file edits
  against the unchanged document.
- The server bounds diagnostics, completions, references, document symbols,
  highlights, hints, and rename edits to 10,000 items and clips individual
  display text at 64 KiB. References may return the deterministic prefix;
  rename is atomic and instead fails when the proven edit set exceeds the cap,
  so an editor can never apply a silently partial rename. Every outgoing frame
  is checked against the same 16 MiB limit as incoming frames.
- Ordinary completion walks the compiler-owned lexical scope graph at the
  requested offset. It includes visible parameters, locals, reactive bindings,
  imports, functions, components, classes, enums, and Types; inner declarations
  shadow outer names and later non-hoisted bindings are absent. The analyzer
  records each binding's checked member signatures in the semantic index, so
  member completion for records, classes, List/Map/Set, resources, actions,
  enum values, and `Type.parse` uses the same authority as diagnostics and
  hover. The index also retains only checked intermediate expressions that are
  callable or expose members. This makes `route.params.` and
  `Type.parse(...).field` complete naturally and gives collection/Web chains
  exact active-parameter signatures without indexing every literal or simple
  identifier. Workbench receives ordinary standard completion/signature items
  and owns no scope graph, expression resolver, or member table. The same typed
  member occurrence provides hover and source definition: record fields and
  class fields, getters, and methods resolve through import aliases and inherited class metadata,
  while runtime-only or anonymous members remain intentionally non-navigable.
  References and rename use the same member identity. Typed record construction,
  return objects, destructuring, runtime-Type literals, inherited class fields,
  abstract/override declarations, and `super` calls participate in one atomic
  edit. Shorthand record keys expand to preserve local names; static and
  instance fields/getters/methods are distinct; hierarchy collisions fail before an
  edit is emitted.
  User-component parameters extend the same contract to checked JSX attributes
  across module aliases, including body references and call-site workspace
  edits. Native DOM attributes and Web directives are not treated as component
  parameters. The implicit `children` prop refuses rename because JSX content
  contains no attribute token that could be rewritten safely.
- Completion context is compiler-owned too. JSX tag-name positions return only
  visible components and a focused native Web element set. Component attribute
  positions return checked parameters plus JSX controls; native elements return
  supported attributes and directives. Contextually typed object key positions
  return only missing fields, while attribute/field values immediately restore
  ordinary lexical completion. Workbench adds no tag, prop, or record-field
  catalog.
- The generic external-LSP transport bounds request and response frames at
  16 MiB and response headers at 8 KiB. Oversized or malformed server output
  closes that language-server connection and rejects pending requests instead
  of growing the editor process indefinitely. Every request also has a 15-second
  deadline; expiry removes the pending request, sends standard
  `$/cancelRequest`, and returns an actionable failure instead of hanging the
  editor operation forever.
- Rename is fail-closed. If the compiler cannot prove the symbol/edit set or
  reports a collision, Workbench does not fall back to textual replacement.
- The initialize response exposes `capabilities.experimental.velar.protocolVersion`.
  Workbench refuses an incompatible protocol instead of silently degrading.
- Protocol version: `1`.
- Standard and Web API versioning are independent of the compiler and LSP
  transport versions. Velar `0.9.0-dev` uses Standard API `0.4`, Web API `0.7`, and
  protocol `1`, so Workbench requires no Velar-specific host change; new module
  names, signatures, and diagnostics flow through the compiler-owned LSP.

Workbench first resolves `velar` from the project-local `node_modules/.bin`,
then from `PATH`. This keeps every project tied to its own compiler toolchain.
Published compiler/Web/creator/CLI packages contain emitted JavaScript and `.d.ts` files;
Workbench invokes the local CLI executable and does not depend on its source
layout.
The editor never imports or embeds `@velarscript/compiler`; the compiler never
depends on Workbench.

The cross-repository installed-toolchain gate packs the compiler, Web framework, creator, and CLI,
installs the complete release set into a temporary Velar project, and asks the real generic
Workbench language host for diagnostics, completion, signature help,
inferred-type hints, same-document symbol highlights, semantic tokens, and safe
code actions. It checks that an inferred `List<number>` is
displayed, an explicit `TreeNode` annotation is not duplicated, a resource
handle is not mislabeled as a source annotation, and all uses of a local record
binding are highlighted, `[1, 2, 3].slice(...)` reports its second active
parameter and its compiler-owned `slice(number = default, number = default)`
label, and `route.params.get(...)` exposes checked Map members and its
`get(string) -> string?` signature. The installed sample also hovers the nested
`params` field and navigates `tree.children` to the local `TreeNode` field
declaration, then renames that recursive record field across its declaration,
two typed object keys, and member access through the generic workspace-edit
mapping. It also resolves, hovers, references, and performs a three-site rename
for `Choice.show` across the component declaration, body, and JSX use. It also
requests completion at `<Ch`, inside the `Choice` start tag, and at a typed
`FormDraft` object key, verifying that component/native tags, checked props, and
missing fields arrive without ordinary keyword noise. A separate installed
source proves declaration/property semantic tokens and the preferred
`===`-to-`==` workspace edit through the same host. The installed sample now
also declares `ScoreCard` class-body state and proves that instance completion
contains public `total` and documented read-only `summary` but not private
`history` or static `category`, while
completion on `self` inside the class includes `history`; class completion
contains `category` but not instance fields, and a field use navigates to its
body declaration. Workbench highlights the injected `private` token but owns no
visibility table. Its `init:` block is accepted by the packed compiler, resolves a
field use through the same semantic index, and arrives as an ordinary keyword
completion; Workbench only highlights the injected token and owns no
construction semantics. Its `get summary() -> string` member likewise arrives
through the compiler's ordinary property completion/documentation contract;
the installed gate also navigates a use back to its getter declaration.
Workbench only highlights the injected `get` token and owns no accessor model.
The same packed sample now includes a multiline async expression
arrow and call. Its parameter hover is compiler-contextual `string`, its call
signature is `loadTicket(string) -> Promise<string>`, and the installed LSP
accepts the final commas. A named `loadTicketLabel() -> Promise<string>` also
returns that arrow's Promise directly, proving uniform Promise adoption through
the packed compiler rather than a source-tree build. Workbench contributes no
Promise inference, arrow parser, return rule, or indentation rule; it only maps
the generic semantic responses.
The fixture also declares `0 < answer <= 10`; the installed compiler accepts
the chain and returns its inferred `bool` through ordinary hover and inlay-hint
responses. Workbench adds no comparison parser, evaluator, or coercion rule.
`ScoreCard` now also carries a `///` declaration comment. The packed compiler
returns its Markdown through standard completion documentation and hover
content, and the generic Workbench host maps those existing LSP fields without
owning a Velar comment parser or documentation store.
Together this proves that local binary discovery, stdio
transport, protocol negotiation, and standard semantic mapping work without a
source-tree link in either direction. Before installation, Workbench validates
the release format, exact compiler/Web/creator/CLI set, canonical package paths, byte sizes,
and SHA-256 values itself rather than trusting a shared source checkout.

## Joint delivery gate

Every language syntax, type, diagnostic, or Web semantic change must update all
affected layers in one delivery:

1. Language charter and executable `.vel` examples.
2. Compiler parser/analyzer/emitter and golden tests.
3. `velar lsp` behavior, semantic-index, incremental-session, and protocol tests.
4. The injected Workbench Velar contribution when the visible editor contract
   or versioned LSP seam changes.
5. Velar compiler tests, Workbench language tests, and a real editor/browser
   smoke test.

Workbench must never reimplement Velar type rules. Editor-only lexical behavior
may improve display, but compiler/LSP diagnostics remain authoritative.
