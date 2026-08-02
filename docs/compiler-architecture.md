# Velar Compiler Architecture

Status: Velar 0.9 internal language, Standard API, secure static Web, semantic-tooling,
and incremental pipeline implemented

## Pipeline

```text
.vel source
-> indentation-aware lexer
-> source-spanned Core + Web AST
-> scope and lightweight type analysis
-> Web validation and lowering hints
-> readable ESM JavaScript + native DOM operations
-> extracted scoped/global CSS + Web assets
-> development source maps / explicitly enabled production source maps
```

Project builds first load the complete relative `.vel` graph and collect public
interfaces, including exported reactive cells. Safe JavaScript imports first
use manual `extern module` declarations, then a compiler-owned limited `.d.ts`
bridge; unsupported declaration shapes remain `unknown` and produce nonfatal
tooling notices rather than silently becoming `any`. Named reactive imports
retain dependency tracking across module boundaries through one shared browser
scheduler. Safe JavaScript imports without a usable declaration remain
`unknown`; only the explicit unsafe import boundary produces `any`.

Project compilation returns structural statistics for module count, compiled,
reused, and affected modules plus elapsed time. The language server owns a
multi-entry incremental session; the development server owns an entry-graph
incremental session and dynamically watches resolved npm Velar package roots.
Both reuse the compiler's reverse-dependency invalidation rather than creating
their own semantic cache.

Literal dynamic `.vel` imports are part of that same graph rather than a
bundler-only escape hatch. Inspection records them as dynamic dependencies,
analysis exposes a typed Promise of the target module interface, reverse graph
invalidation recompiles importers, and semantic navigation resolves the path
through the existing definition provider. Production emission changes only the
edge to native ESM `import()`, allowing deterministic split chunks; arbitrary
paths, dynamic JavaScript, and reactive module namespaces remain rejected.

Function types keep fixed parameters, required arity, and an optional rest
element type as separate compiler data. A source rest binding is analyzed as a
`List<T>`, while calls, exported module interfaces, class-method overrides,
semantic hover/signature text, manual extern declarations, and the limited
`.d.ts` bridge all consume the same element contract. Emission is the final
native JavaScript `...name` lowering; there is no runtime argument wrapper.

Source classes keep constructor inputs, instance fields, static fields,
initialization, getters, and methods as separate AST collections. Class-body fields require an annotation,
so the project interface can publish their contract before analyzing consumers
without whole-program field inference. Instance initializers are checked in the
constructor-parameter scope and emitted after `super(...)` and parameter-field
assignment; static initializers remain outside that scope and emit as native
class fields. One optional `init:` block executes after instance fields and
method binding. The analyzer gives it a synchronous, non-returning execution
boundary while allowing nested functions to own their own boundary; the emitter
places its statements inside the native constructor without publishing it as a
member. The analyzer, module interface, semantic index, and project member
resolver all preserve the static/instance bit, preventing completion,
definition, reference, or rename from resolving a same-named member in the
wrong namespace.

Getter contracts remain read-only fields at the public type boundary while a
separate accessor identity preserves native emission, `super.name`, abstract
implementation, explicit override checking, and property-shaped LSP symbols.
Concrete getters lower to native JavaScript `get`; Velar deliberately exposes no
setter form because writable state already has the explicit `let` contract.

Visibility is one bit rather than a hierarchy. Public members remain in the
module `ClassInfo`; `private` constructor/body fields, getters, and concrete methods stay
in analyzer-owned class maps, so consumers and subclasses cannot accidentally
observe them. Private member-expression spans carry a lowering hint to native
JavaScript `#` access. Instance private methods lower to private arrow fields so
they retain Velar's stable callback receiver; static private methods remain
native class methods. The semantic index marks private declarations, exposes
them only to expressions analyzed inside the owner class, and prevents
project-wide inheritance rename from absorbing them.

Core `List`, `Set`, and `Map` types remain distinct compiler values. `Set()`
construction accepts zero arguments or one checked List/Set, first mutation can
refine an empty local binding, and the refined type is written back to the
semantic index for editor hover. Set iteration emits native iteration, while
the small mutation helpers normalize `add`/`clear` to Velar `none` without
replacing JavaScript identity, insertion order, or membership semantics.

## Package ownership

- `packages/compiler` owns source text, diagnostics, AST, parsing, Core/Web
  analysis, JavaScript/DOM/CSS emission, formatting, and source maps.
- `packages/cli` owns `velar.json`, commands, filesystem graphs, official
  Standard/Web modules, explicit public-config validation, test discovery,
  optimized production bundling, the dev server, hot
  replacement, and the language server.
- VelarOS Workbench owns the generic editor and LSP host. Its default Velar
  contribution owns presentation and connection metadata, but never copies or
  embeds compiler semantics.

The compiler and CLI build as independent npm packages containing emitted
JavaScript, source maps, and `.d.ts` declarations. The CLI pins the exact
compiler version. Packed tarballs must install and execute in a clean consumer;
Workbench is neither bundled into nor imported by either package.

Project manifests declare `formatVersion: 1`. Creation refuses non-empty
targets, upgrades are explicit and inspectable, and unknown future versions
fail closed before compilation.

Production Web builds are assembled in a sibling staging directory. Public
assets are copied through a confined regular-file walker, bundling and all
manifests finish there, and only then does the complete directory replace the
previous output. Compiler-owned entry/fallback/manifest names and symbolic
links fail closed. The deployment manifest is the provider-neutral authority
for CSP, security headers, cache rules, base paths, and SPA fallback.

The production verifier is the read-side authority for format-2 output. It
requires the physical regular-file tree to equal the manifest inventory,
recomputes size/SHA-256/build identity, and validates the build/deployment
relationship before preview binds a port. Browser-project tests call this same
verifier and preview server; they do not maintain a parallel static-host model.
The remote deployment verifier composes on top of this authority. It never
trusts a remote manifest alone: it starts from the locally verified identity,
then compares hosted bytes, MIME types, declared headers, and routing behavior
at an explicit origin.

Production bundling loads compiled modules through stable real `.vel` paths and
inline compiler maps rather than random temporary `.js` paths. This keeps
content hashes and source maps reproducible across output locations. Linked
production maps are disabled by default and remain an explicit manifest input.

Release packaging is outside compiler semantics. A repository script builds
both npm packages, records source and tarball identities, verifies every
SHA-256, and refuses candidate status without a clean exact tag, matching
remote, stable version, and publishable license. It contains no publish step.

## Resource ceilings

The compiler rejects a source module above 4 MiB before lexing. Lexing stops at
250,000 tokens or 512 delimiter/indent levels, parser stack exhaustion is
normalized to `VEL2008`, and project discovery/resolution stops at 4,096 Velar
modules. LSP framing rejects messages above 16 MiB. Project/package manifests
are read through bounded regular-file paths; JavaScript package inspection is
limited to 16 MiB and `.d.ts` consumption to 2 MiB.

Production build and verification inventory is limited to 100,000 assets.
Hashing, verified preview responses, and remote deployment identity checks use
streams rather than whole-file buffers; declared or observed remote length
mismatches are cancelled immediately. These bounds protect the existing Node
and browser runtimes and do not define a separate Velar memory model.

## Runtime invariants

- Generated code runs on the standard JavaScript runtime and browser DOM.
- Components lower to direct DOM creation and updates; there is no virtual DOM.
- Component reactive ownership is destroyed deterministically; module state
  persists with the ESM module and acts as the store boundary.
- DOM jobs commit before watch jobs; computed values remain lazy.
- Component setup and initial JSX construction execute as one ownership
  transaction. A thrown construction path runs sibling cleanup, destroys the
  incomplete reactive scope, and rethrows the original failure into the owning
  mount, dynamic-render, or lazy-component boundary.
- Mounted Router navigation uses the same build-before-commit rule. A target
  construction error leaves the active component and DOM owned, reports one
  `render/router` failure, and keeps subsequent history navigation operational;
  initial route failure continues to root-mount recovery. Target component
  identity is validated before commit, and an unmatched route renders either a
  checked `RouteContext` fallback component or the runtime-owned accessible 404.
- Root mounting evaluates lazily and renders an accessible fatal state on
  failure. Dynamic and keyed updates construct their replacement transactionally
  and retain the last valid DOM when rendering fails.
- Adjacent JSX conditional branches lower through the same dynamic replacement
  transaction. Each selected branch receives a child scope; ref assignment adds
  identity-checked cleanup so an old branch cannot retain a removed node or
  clear the ref installed by its replacement.
- One shared application error channel classifies mount, render, watch, event,
  mounted, and cleanup failures. Synchronous and rejected event work is caught;
  cleanup reports a failing independent step and continues the remaining steps.
- Lazy components cache successful module resolution, retry failed loads,
  replace loading/resolved/error children with deterministic mount and destroy
  ownership, and report loading failures through the application resource phase.
- Public configuration comes only from validated `web.publicConfig`, is frozen
  and embedded per build. Structured logging is the source-level replacement
  for `console`; custom sinks have explicit disposable ownership.
- `type` is the only data-shape declaration for static and runtime checks.
- Primitive conversion does not delegate source semantics to ambient JavaScript
  constructors. `str` lowers intentionally to string display conversion;
  `number(text)` lowers to a compiler helper that validates the complete decimal
  grammar and finite result before returning a value or `none`.
- Explicit structural equality lives in `velar/json`, not the `==` operator or
  a reflection feature. Its bounded runtime understands owned records, Lists,
  Maps, and Sets, preserves class/non-data reference identity, and terminates
  safely when separate cyclic graphs are encountered.
- Source-level React effects, React lifecycle names, deep Proxy state, and a
  parallel schema declaration are not part of Velar.
- Arrow expressions carry their async boundary in the AST. The analyzer owns
  contextual parameters, Promise adoption, and `await` placement; JavaScript
  emission only writes the checked `async` form. JSX analysis rejects Promise
  children before Web lowering. Postfix emission groups awaited, unary, arrow,
  and other precedence-sensitive receivers before access or invocation. An
  object-expression arrow body is parenthesized during JavaScript emission, so
  the expression-only source form cannot become a JavaScript block silently.
  Power has its own right-recursive parse layer rather than generic binary
  precedence; this preserves right association, unary-sign binding, signed
  exponents, and awaited bases while emitting valid JavaScript.
- Adjacent equality and ordered comparisons become one comparison-chain AST
  node rather than nested booleans. Analysis checks every adjacent pair and
  permits ordered links only for numbers or strings. Emission uses a hygienic
  arrow IIFE with compiler-only `$` bindings so operands evaluate once in source
  order and later links short-circuit; a chain containing direct `await` uses an
  immediately awaited async IIFE, preserving a boolean source result.
- `///` documentation is recovered from the authoritative source immediately
  before semantic declarations rather than becoming runtime AST statements.
  The semantic index stores a bounded Markdown string on each symbol; project
  resolution follows imported aliases and declared members, and the generic LSP
  exposes it through standard hover/completion fields. Comments never affect
  module signatures, JavaScript emission, or type checking.
  Delimiter continuation is lexical, so a closing multiline delimiter cannot
  create a synthetic indentation transition.
- Every async declaration exposes one resolved-value contract: source `-> T`
  becomes callable `Promise<T>`, and a returned `Promise<T>` is adopted rather
  than compared as a nested wrapper. Parameter-default analysis is a distinct
  pre-body boundary that rejects direct `await`; a nested async arrow resets the
  boundary because its body executes later in its own function.

## Diagnostics

- `VEL1xxx`: lexical and indentation errors.
- `VEL2xxx`: syntax and structural parsing errors.
- `VEL3xxx`: names, bindings, scopes, and control-flow placement.
- `VEL4xxx`: types, runtime type declarations, calls, and return contracts.
- `VEL5xxx`: Web, JSX, directives, DOM, and accessibility contracts.
- `VEL9xxx`: toolchain/internal failures surfaced safely to users.

Existing codes are never repurposed. The LSP transports the same compiler
diagnostics and nonfatal `VEL9002` declaration notices rather than maintaining
editor-only validation rules.
