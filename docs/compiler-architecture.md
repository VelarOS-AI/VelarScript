# VelarScript Compiler Architecture

Status: VelarScript 0.10 internal language, Standard API, secure static Web, semantic-tooling,
and incremental pipeline implemented

## Pipeline

```text
.vel source
-> one Core lexer with extension-owned structured token scanners
-> one source-spanned AST, including structured type, JSX, and Look nodes
-> extension-selected analysis, semantic indexing, intrinsic typing, dependency inspection, and module-interface contribution
-> extension-selected JavaScript emitter and mapped JavaScript node IR
-> readable ESM JavaScript and optional extension artifacts
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
incremental session and dynamically watches resolved npm VelarScript package roots.
Both reuse the compiler's reverse-dependency invalidation rather than creating
their own semantic cache.

Project modules compile dependency-first. The public interface returned by a
successful compilation is built from that same analyzer's binding types rather
than a second expression guesser. Strongly connected module groups run bounded
interface passes until their complete exported contracts stabilize; a cycle that
cannot converge is a project failure. Record display names are kept for editor
output, while module-qualified identities own their field metadata. This lets
two dependencies both declare `Item` without overwriting one another and keeps
an unimported type name out of the consumer's source scope. Compiler diagnostics, imported
contracts, hover, completion, and emitted modules therefore share one semantic
source.

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
native JavaScript `...name` lowering. Named calls keep the original call
expression in place and spread a source-ordered, declaration-arranged argument
list into it. The callee and member receiver therefore evaluate first, `this`
is preserved, optional calls skip argument evaluation, and no keyword-argument
record crosses the call boundary.

Type syntax is parsed once into named, generic, optional, union, and function
nodes. Analysis, public interfaces, semantic tooling, and emission resolve that
same tree; no later stage reparses a formatted type string. Web lexical scanning
likewise produces structured JSX elements, attributes, children, and Look lines
during the Core token pass. The Web parser only sends embedded VelarScript
expression slices through the normal nested Core parser; it never receives an
opaque JSX or Look source block to split a second time.

Source classes keep constructor inputs, one constructor body, instance fields,
static fields, getters, and methods as separate AST collections. Class-body fields require an annotation,
so the project interface can publish their contract before analyzing consumers
without whole-program field inference. Instance initializers are checked in the
constructor-parameter scope and emitted after `super(...)`; static initializers
remain outside that scope and emit as native
class fields. The explicit `constructor(...)` body owns invariant checks and
direct field initialization. A derived constructor must call `super(...)`
before using `self`; the emitter preserves that order in the native JavaScript
constructor. The analyzer, module interface, semantic index, and project member
resolver preserve the static/instance bit, preventing completion,
definition, reference, or rename from resolving a same-named member in the
wrong namespace.

Manual JavaScript class declarations use the same visible shape: body fields,
one `constructor(...)` signature, and body methods. Extern declarations have no
constructor implementation, but they do not reintroduce class-head parameters
or parameter-field shorthand.

Getter contracts remain read-only fields at the public type boundary while a
separate accessor identity preserves native emission, `super.name`, abstract
implementation, explicit override checking, and property-shaped LSP symbols.
Concrete getters lower to native JavaScript `get`; VelarScript deliberately exposes no
setter form because writable state already has the explicit `let` contract.

Visibility is one bit rather than a hierarchy. Public members remain in the
module `ClassInfo`; `private` constructor/body fields, getters, and concrete methods stay
in analyzer-owned class maps, so consumers and subclasses cannot accidentally
observe them. Private member-expression spans carry a lowering hint to native
JavaScript `#` access. Instance private methods lower to private arrow fields so
they retain VelarScript's stable callback receiver; static private methods remain
native class methods. The semantic index marks private declarations, exposes
them only to expressions analyzed inside the owner class, and prevents
project-wide inheritance rename from absorbing them.

Core `List`, `Set`, and `Map` types remain distinct compiler values. `Set()`
construction accepts zero arguments or one checked List/Set. Empty collection
inference follows the runtime collection identity across direct aliases and
record fields, freezes when the value crosses an open typed boundary, and is
written back to the semantic index for editor hover. Iteration, membership,
size, indexing, copying, and mutation lower through controlled helpers that
validate dense Lists and invoke native Map/Set prototype operations directly.
Membership lowers to a source-shaped `candidate, collection` helper signature,
so ordinary JavaScript argument evaluation preserves the language order without
an extra generated function boundary.
`List.reduce(callback, initial)` likewise analyzes a callable getter or factory
before the initial expression. A literal arrow can receive the initial value's
context afterward because creating that arrow executes no user code; its body
still runs only after all call arguments have evaluated.
Native slot checks accept cross-realm Map/Set values while instance overrides,
custom iterators, and Array species cannot change language semantics. Mutating
results normalize to VelarScript `null` without replacing
JavaScript identity, insertion order, or membership semantics.

Declaration and `for` binding patterns do not lower to native JavaScript
destructuring. The analyzer records which record fields are optional, and one
Core lowering path evaluates the source value once, reads only own enumerable
data descriptors, normalizes optional absence to `null`, and builds controlled
rest copies. List bindings reuse dense-List validation and enforce exact length
without rest or minimum length with rest. This keeps binding types sound at
runtime and prevents getters, inherited fields, sparse Lists, or JavaScript
`undefined` from changing the language contract. Shape mismatch is reserved
for `match`; an asserted binding shape fails immediately.

## Package ownership

- `packages/compiler` owns the Core language, source text, diagnostics,
  extension host, Core analysis, Core JavaScript emission, formatting, and
  source maps. Component, JSX, reactivity, lifecycle, CSS, DOM lowering, and
  Web types are not active Core language features. Its extension protocol has
  explicit parser, analyzer, semantic-index, intrinsic-analysis,
  dependency-inspection, public-interface, module, emitter, lexical-editor, and
  contextual project-editor seams;
  loading lexical keywords alone can never silently activate Web semantics.
  Its `framework-host` subpath is a platform-neutral tooling ABI containing
  only protocol types and a version constant; it does not implement HTML,
  filesystem access, servers, bundling, browser automation, or framework
  behavior.
- `packages/web` owns component/JSX syntax activation, reactive and lifecycle
  analysis, semantic symbols/references, Web intrinsic typing, project graph
  traversal, exported component/reactive interfaces, DOM/CSS emission, Web
  type/global guidance, Web standard modules, browser runtime, `web` manifest
  validation, JSX/native-element completion and rename protection, and the
  separate `@velarscript/web/host` implementation. That host owns application
  and compile-error HTML documents, the development reload client, CSP
  construction, static-deployment projection, source-map policy, base URL, and
  browser-test contract. It
  depends on the neutral compiler extension contract, not CLI orchestration or
  an editor host.
- `packages/create` owns transactional project creation and the complete
  `web`, `docs`, `library`, and `component` template inventory. The component
  template is an ordinary Web source package with a separate preview entry, not
  a compiler extension. Creator code has no compiler, browser, CLI, or editor
  dependency.
- `packages/cli` owns the format-2 manifest shell, extension resolution,
  commands, the npm-backed project dependency workflow, filesystem graphs, the
  Core Standard modules, test discovery,
  optimized production bundling, the dev server, hot
  replacement transport, browser driver, verification, and the language
  server. For every declared extension it may load an optional `/host` export,
  validates framework-host protocol version 1 and matching compiler capability,
  and composes at most one application host. CLI source neither identifies the
  official Web npm package nor constructs Web HTML/CSP/JSX-editor/lifecycle
  behavior.
- VelarOS Workbench owns the generic editor and LSP host. Its default VelarScript
  contribution owns presentation and connection metadata, but never copies or
  embeds compiler semantics.

The compiler, Web framework, creator, and CLI build as independent npm packages
containing emitted JavaScript, source maps, and `.d.ts` declarations. Web pins
the exact compiler version. CLI pins the compiler and creator but neither
depends on nor peers with Web; a Web project installs Web directly.
Packed tarballs must install and
execute in a clean consumer; Workbench is neither bundled into nor imported by
any package.

Project manifests declare `formatVersion: 2` and a required `extensions` list.
There is no legacy loader or upgrade command; missing, format-1, and unknown
future versions fail closed before compilation.

Production framework builds are assembled in a sibling staging directory. Public
assets are copied through a confined regular-file walker, bundling and all
manifests finish there, and only then does the complete directory replace the
previous output. Compiler-owned entry/fallback/manifest names and symbolic
links fail closed. The deployment manifest is the provider-neutral authority
for CSP, security headers, cache rules, base paths, and SPA fallback.

The production verifier is the read-side authority for format-3 framework
build output and format-2 static-deployment output. Each build records the
framework package, capability, target, host-protocol version, framework API
version, and framework artifact kind. It
requires the physical regular-file tree to equal the manifest inventory,
recomputes size/SHA-256/build identity, and validates the build/deployment
relationship before preview binds a port. Browser-project tests call this same
verifier and preview server; they do not maintain a parallel static-host model.
The remote deployment verifier composes on top of this authority. It never
trusts a remote manifest alone: it starts from the locally verified identity,
then compares hosted bytes, MIME types, declared headers, and routing behavior
at an explicit origin.

Production bundling loads compiled modules through stable real `.vel` paths and
inline compiler maps rather than random temporary `.js` paths. JavaScript
generation is retained as a parent/child node IR for statements and expressions;
the renderer records exact generated offsets for those nodes and emits line-and-
column source-map segments instead of assigning one source span to a whole
generated statement. Web JSX participates in the same tree: nested elements,
attributes, static text, and dynamic child expressions each own a mapped node
instead of inheriting the previous generated fragment's position. This keeps
content hashes and source maps reproducible across output locations. Linked
production maps are disabled by default and remain an explicit manifest input.
Analyzer-to-emitter lowering hints use the complete source span as node identity.
Parent expressions and their first child often share a start offset, so
start-only keys are forbidden for expression hints such as optional reads,
private members, named calls, conditions, and Web-controlled calls.

Null normalization is type-directed rather than provenance-directed. Every
checked expression whose expanded type is optional, `null`, or `unknown`
observes JavaScript `undefined` as VelarScript `null`; `Promise<T>` receives the
same treatment when `T` has that nullish contract. This rule survives values,
objects, collections, classes, aliases, cycles, namespace imports, and dynamic
imports without a second propagation model. Unsafe JavaScript `any` remains
outside the guarantee. Cross-module fixed-point analysis therefore converges on
complete semantic interface identities, not hidden boundary metadata.
Assignment targets are a separate lowering context: they never receive the
read-side `?? null` normalization. Flow-narrowed reads use the current fact,
while plain assignment is checked against the declared location type and
invalidates stale facts for that location and its descendants.
Short-circuit `and`/`or` analysis evaluates the right operand under the facts
that make it reachable, records only facts valid for the complete result path,
and lowers optional conditions to explicit presence checks. `while` bodies use
the same successful-condition facts rather than a separate loop rule.
Flow facts snapshot the complete binding state around mutually exclusive `if`,
`match`, `try`/`catch`, and inline conditional branches and around loop bodies.
Only invalidations from paths that can reach the next statement are merged;
unreachable tails cannot mutate the continuing fact set. Facts created with the
same semantic type on every continuing path are intersected back into the outer
scope. Match pattern values and guards are processed in runtime order, so a
failed effectful guard changes the facts available to later cases. Successful
match guards and terminating guard clauses reuse the same fact model.
Every ordinary call clears mutable binding facts and member-path facts before
later expressions are checked, matching JavaScript closure and reference
semantics. Getter reads and safe-JavaScript class fields are handled as the same
effect boundary because repeated property access may execute host code. `await`
clears the same facts before the resumed continuation is checked. A local
non-optional `const` is the explicit stable-value boundary. Invalidations remain
inside their current flow frame, so analyzing a deferred function, callback,
component, or instance initializer does not pretend that declaration is an
immediate execution.

Assertion messages are analyzed on an isolated failing path with the condition's
negative facts. That path always throws, so message effects never contaminate
the successful continuation where the positive assertion facts apply.

Bindings separately record assignment permission and stability across effects.
Local `let` has both, an imported `export let` is read-only locally but remains
effect-mutable, and `export const` has neither. `ModuleInterface.mutableExports`
survives project fixed-point analysis and participates in the interface cache
identity. Namespace imports reject live exports and expose read-only fields,
avoiding an untrackable mixture of property syntax and ES-module live bindings.

Member writes clear aliased member-path facts even when their source bindings
differ. Safe-JavaScript writes additionally clear mutable binding facts because
the declared field may be implemented by a setter. A plain assignment only
locates its target before evaluating the right side and applies that setter
boundary afterward; compound assignment also performs an effectful old-value
read before the right side. Object interpolation in an f-string performs the
same operation for a possible `toString` call, and
`instanceof` checks against safe-JavaScript classes do so for a possible
`Symbol.hasInstance` hook. The Web analyzer checks component JSX in emitted
order—props, children, invocation—and marks the final invocation as an effect
boundary.

Catch lowering uses the host's cross-realm Error brand check, then converts
foreign non-Error throws without applying JavaScript string coercion to objects
or functions. Primitive messages remain readable; reference values receive a
deterministic message and are retained as `cause`.
The analyzer also rejects `return`, or `break`/`continue` that crosses a
`finally` boundary, while permitting control flow owned by a loop nested wholly
inside cleanup. These rules prevent cleanup from silently replacing a pending
return or exception. The compiler exports this generated-runtime fragment
through its extension seam; Web events, resources, actions, routing, timers,
application reports, and the Standard logging sink reuse that one source
instead of maintaining local error wrappers.

The Node tooling boundary follows the same non-coercion rule without sharing a
browser runtime. CLI extension loading, project compilation, language-server
requests, package resolution, previews, verification, and test reporting read
only bounded own data from native Error values. Foreign objects are summarized
without invoking getters, prototype traps, `toString`, or primitive-conversion
hooks. Node error codes therefore remain usable across realms while an
extension failure cannot break the diagnostic path that reports it.

Release packaging is outside compiler semantics. A repository script builds
all four npm packages, records source and tarball identities, verifies every
SHA-256, and refuses candidate status without a clean exact tag, matching
remote, stable version, and publishable license. It contains no publish step.

## Resource ceilings

The compiler rejects a source module above 4 MiB before lexing. Lexing stops at
250,000 tokens or 512 delimiter/indent levels, and Core parsing has an explicit
512-level syntax budget reported as `VEL2008`. Only the compiler-owned budget
sentinel becomes that diagnostic; a compiler extension's own `RangeError`
remains an extension failure instead of being hidden as source complexity.
Terminal lexer ceilings stop before parser or extension-parser execution, so
their more precise `VEL1005`/`VEL1006` diagnostics cannot be overwritten.
Project discovery/resolution stops at 4,096 VelarScript
modules. LSP framing rejects messages above 16 MiB. Project/package manifests
are read through bounded regular-file paths; JavaScript package inspection is
limited to 16 MiB and `.d.ts` consumption to 2 MiB.

Production build and verification inventory is limited to 100,000 assets.
Hashing, verified preview responses, and remote deployment identity checks use
streams rather than whole-file buffers; declared or observed remote length
mismatches are cancelled immediately. These bounds protect the existing Node
and browser runtimes and do not define a separate VelarScript memory model.

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
- Ordinary conditional JSX expressions lower through the same dynamic replacement
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
  Generated record validators inspect own enumerable data descriptors instead
  of reading properties. Required fields must be present; optional fields may
  be absent but cannot be inherited or accessor-backed. Getters never run
  during validation.
- Primitive conversion does not delegate source semantics to ambient JavaScript
  constructors. `str` lowers intentionally to string display conversion;
  `number(text)` lowers to a compiler helper that validates the complete decimal
  grammar and finite result before returning a value or `null`.
- Explicit structural equality lives in `velar/json`, not the `==` operator or
  a reflection feature. Its bounded runtime understands owned records, Lists,
  Maps, and Sets, preserves class/non-data reference identity, and terminates
  safely when separate cyclic graphs are encountered.
- Source-level React effects, React lifecycle names, deep Proxy state, and a
  parallel schema declaration are not part of VelarScript.
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
