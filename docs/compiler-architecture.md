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

The [runtime and JavaScript boundary ledger](runtime-boundary.md) is the
required map from language semantics to host inheritance, compiler lowering,
runtime ownership, checked foreign ABI, and explicit unsafe entry points. This
architecture describes how those contracts are implemented; it does not define
user-observable behavior independently from the language charter.

Project builds first load the complete relative `.vel` graph and collect public
interfaces, including exported reactive cells. Safe JavaScript imports first
use manual `extern module` declarations, then a compiler-owned limited `.d.ts`
bridge; unsupported declaration shapes remain `unknown` and produce nonfatal
tooling notices rather than silently becoming `any`. Named reactive imports
retain dependency tracking across module boundaries through one shared browser
scheduler. Safe JavaScript imports without a usable declaration remain
`unknown`; only the explicit unsafe import boundary produces `any`.
These declarations are trusted static ABI contracts rather than runtime schema
validation or sandboxing. Untrusted payloads retain `unknown` until application
code passes them through an explicit runtime `Type` validator.

Project compilation returns structural statistics for module count, compiled,
reused, and affected modules plus elapsed time. The language server owns a
multi-entry incremental session; the development server owns an entry-graph
incremental session and dynamically watches resolved npm VelarScript package roots.
Both reuse the compiler's reverse-dependency invalidation rather than creating
their own semantic cache. The project result also records the exact package
manifest and bounded `.d.ts` graph used by each safe JavaScript import. Editor
sessions track those files with the same content snapshots as VelarScript
sources and resources, so a declaration change invalidates its importer and the
importer's reverse dependency closure without requiring an unrelated source edit.
Opening an explicit `.vel` file still discovers its nearest manifest. Missing
manifests intentionally select standalone Core mode; an existing malformed,
legacy, or unloadable manifest is a project error and is never hidden by
silently retrying the file as standalone source.
Manifest-backed editor sessions key reuse by the SHA-256 identity of the exact
bounded `velar.json` source. They do not serialize extension-owned runtime
configuration to guess whether it changed, so `Map`, `Set`, and other validated
extension config representations cannot collapse to an accidental shared key.

Project modules compile dependency-first. The public interface returned by a
successful compilation is built from that same analyzer's binding types rather
than a second expression guesser. Strongly connected module groups run bounded
interface passes until their complete exported contracts stabilize; a cycle that
cannot converge is a project failure. The convergence identity includes live
and reactive exports, named-type identities and fields, aliases, enums, and the
complete public class contract: constructor names, arity, fixed/rest types,
inheritance, abstract members, getters, fields, and methods.
Extension-owned cross-module interface values must provide their own bounded,
deterministic `interfaceExportIdentity`; missing contracts fail the project
instead of being treated as stable. Changing one of those contracts cannot be
mistaken for a stable pass. Record
display names are kept for editor output, while module-qualified identities own
their field metadata. This lets
two dependencies both declare `Item` without overwriting one another and keeps
an unimported type name out of the consumer's source scope. Compiler diagnostics, imported
contracts, hover, completion, and emitted modules therefore share one semantic
source.

Data `type` declarations remain structurally assignable, but structure is
resolved through those module identities before comparison. Equal display names
never bypass field checking: two hidden `Item` results with compatible fields
compose, while incompatible ones produce a “different Item contract” diagnostic
instead of the nonsensical appearance that `Item` was assignable to every other
module's `Item`.

Semantic type identities use length-delimited nodes rather than punctuation
concatenation. Module paths, extension-provided names, and structural field names
therefore cannot make distinct types collide in equality, union normalization,
declaration caches, or cyclic-interface convergence.

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
record crosses the call boundary. Call spreads are restricted to a declared
rest slot after all fixed arguments and copy the dense source List before native
spread emission, so an instance iterator cannot alter call semantics.

Read-only data is represented by a contextual `ReadonlyTypeSyntax` and one
`readonlyView` qualifier on named/structural records and collection `ValueType`
variants. It is deliberately absent from emitter lowering: mutable-to-readonly
conversion preserves the same JavaScript identity, while Analyzer propagation
turns nested member/index reads, binding patterns, shallow spreads, collection
snapshots, callbacks, generic substitution, control-flow narrowing, and function
boundaries into transitive read-only views. Class, function, Promise, host
capability, primitive, and unconstrained generic nodes stop propagation and
reject a direct readonly annotation.
Assignability decomposes optional and union wrappers before checking whether a
capability would be upgraded from readonly to mutable. Union member writes
separately require every candidate field to be writable, because a primitive
field type cannot itself carry the owning object's readonly bit. Nullable union
arms are canonicalized into one optional wrapper before Analyzer flow or emitter
lowering, preserving the `undefined`-to-`null` boundary on optional access.
Named record field metadata and the qualifier are part of module-interface
identity and survive aliases and re-export chains. A declared readonly record
field projects its value deeply, matching a field reached through a readonly
owner. The Web analyzer applies the same Core view to component data props and
does not maintain a second ownership or parameter-effect analysis for classes
and host values.
Read-only collection targets project their nested types to readonly views and
permit covariance, while mutable targets remain invariant. The qualifier is
erased with the rest of the type system.

Flow analysis invalidates facts for known direct writes but does not compute or
export interprocedural write-effect summaries. Analyzer instead records a
runtime-narrowing hint on each expression whose static type depends on an active
fact. Emitter evaluates that expression once and throws a source-located
`NarrowingError` if its runtime evidence no longer holds. Primitive and nominal
checks lower inline, data checks reuse the runtime validation ABI, and erased
generic or opaque capability types fall back to a presence check rather than
inventing a runtime type object. The guard and its captured native `TypeError`
identity have one compiler-owned source: standalone output inlines it, while
project consumers import `narrow` from a hidden internal module. The constructor
is consistent across project modules but has no public `ModuleInterface`; each
call still supplies its own value, evidence, expected type, description, and
source offset. This mechanism is independent of readonly
conversion.

Body-backed functions, concrete methods, and actions may omit their result
annotation. Predeclaration installs a distinct unresolved-result placeholder,
then isolated Analyzer passes merge reachable return values, callable-result
effects, reachable fallthrough (`null`), and body write summaries until every
local function contract reaches a stable analysis identity. Only the final pass
owns diagnostics, semantic indexes, and lowering hints, so provisional results
or effects cannot leak into generated code. Async inference solves the resolved
value before wrapping the public call result in `Promise<T>`. Project compilation
carries the same metadata through its existing module-SCC interface passes. A
recursive result that remains unresolved or exceeds the bounded fixed point
receives `VEL4025`; extern and abstract declarations instead require an
annotation immediately because they have no body to analyze.

Type syntax is parsed once into named, enum-singleton, generic, optional, union, and function
nodes. Analysis, public interfaces, semantic tooling, and emission resolve that
same tree; no later stage reparses a formatted type string. Web lexical scanning
likewise produces structured JSX elements, attributes, children, and Look lines
during the Core token pass. The Web parser only sends embedded VelarScript
expression slices through the normal nested Core parser; it never receives an
opaque JSX or Look source block to split a second time.

`Type<T>` is a Core `runtimeType` node rather than a library-shaped object
type. Generic binding unwraps only compiler-known record, alias, and enum Type
objects, so a structural object with `is` and `parse` cannot impersonate the
capability. Alias expansion, nominal resolution, public-interface extraction,
import renaming, namespace projection, semantic display, and generic
substitution all recurse through the target `T`. The target relation remains
compile-erased; the emitted value is the existing registry-owned validator.
Because that registry proves validator ownership but does not reify a runtime
identity for `T`, analysis rejects `is Type<T>` and any recursively inspected
record/alias validator position containing `Type<T>` before the emitter can
produce an unsound predicate.

Bindings keep the immutable declared contract used for assignment checks
separate from the current flow-narrowed read type. Branch snapshots merge by
reachable path rather than analysis order.
Contextual collection typing overlays the expected visible element shape onto
the inferred elements instead of replacing them.
Public class interfaces consume the analyzed member tables, so the same
contract survives module boundaries instead of being reconstructed from
annotations.

Bindings carry flow-scoped reference identities: direct aliases, conditional
aliases, narrowed bindings, identity-style callable results, and methods
returning `self` share one identity, while rebinding a variable to a fresh
allocation gives it a distinct one. Member-write invalidation applies to every
alias of that identity.

Source classes keep constructor inputs, one constructor body, instance fields,
static fields, getters, and methods as separate AST collections. Class-body fields require an annotation,
so the project interface can publish their contract before analyzing consumers
without whole-program field inference. Instance initializers are checked in the
constructor-parameter scope and emitted after `super(...)`; static initializers
remain outside that scope and emit as native
class fields. The explicit `constructor(...)` body owns invariant checks and
direct field initialization. A derived constructor must call `super(...)`
before using `self`; the emitter preserves that order in the native JavaScript
constructor. Reads that can observe JavaScript initialization order lower through
one compiler-owned class-field runtime. It captures Reflect field access, Object
prototype/descriptor traversal, invocation, and TypeError identity when the
generated module initializes, so later ambient replacement cannot turn a checked
public, private, inherited static, or own static read into a different result.
Standalone compilation inlines that runtime. Project compilation imports its
three checked read operations from one compiler-internal module, giving every
source module the same captured host ABI without publishing a class-reflection
API or moving class semantics into CLI.
The analyzer, module interface, semantic index, and project member
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

Core strings, numbers, `List`, `Set`, and `Map` remain distinct compiler
values. String and number members are analyzer-owned signatures whose spans
carry primitive-lowering hints; generated code calls bounded compiler helpers
and never trusts a JavaScript prototype method. The same hint path makes a
stored method a receiver-once bound wrapper. The text helper source is shared
with the surviving advanced `velar/text` functions, so Unicode and 16 MiB
limits have one implementation.

Inline and layout strings travel through the same literal and f-string AST
forms. One shared scanner owns prefixes, raw backslashes, interpolation
expressions, and both recovery boundaries. Inline quotes stop at the physical
newline. A quote followed immediately by a newline enters layout mode: the
first content line establishes its structural margin, a delimiter at the
opening line's indentation closes it, and an earlier dedent recovers without
consuming the dedented line. The scanner records a code-unit offset map while
removing structural indentation, so nested interpolation diagnostics and source
maps still address the original source.

The `f`, `r`, and canonical `rf` prefixes independently select interpolation
and raw backslashes. Formatter preprocessing protects complete layout spans
before surrounding line normalization and restores their physical line endings
and value-bearing indentation. Legacy backtick/triple-quote forms and
noncanonical `fr` recover only to emit one-current-spelling guidance;
diagnostics still prevent output.

`List`, `Set`, and `Map` constructors remain compiler-owned. `Set()`
construction accepts zero arguments or one checked List/Set. `Map()` accepts a
Map copy, a dense List of exact two-item Lists, or an ordinary record whose own
enumerable string data fields become entries. Analyzer inference preserves
separate key/value types for literal entry Lists; runtime helpers revalidate
every outer and inner descriptor without invoking accessors or overridable
iterators. Empty collection
inference follows the runtime collection identity across direct aliases and
record fields, freezes when the value crosses an open typed boundary, and is
written back to the semantic index for editor hover. Iteration, membership,
size, indexing, copying, and mutation lower through controlled helpers that
validate dense Lists and invoke native Map/Set prototype operations directly.
The lower identity layer is a separate compiler-owned initialization ABI: it
captures Array/Map/Set brands, record reflection, native size getters, iterator
factories, and iterator `next`. Runtime `Type` checks use this layer and explicit
iterator steps, so replacing globals or collection/iterator prototypes after a
module initializes cannot change `value is List/Set/Map/Record`. Mutation and
reactivity helpers remain a distinct semantic layer rather than being hidden in
the brand check. Emission keeps the brand fragment separate from the descriptor/
iterator traversal fragment, so modules that use ordinary collections without
runtime collection Types do not carry the heavier validation path.
The ordinary List operation layer is another explicit initialization fragment.
It captures dense-data reflection, allocation, integer and numeric predicates,
bounds, join/sort/reverse, Reflect invocation, and Error identities. List
construction, bracket reads/writes, iteration, snapshots, transforms, ordering,
and mutation use indexed loops or these captured operations, so application
code cannot redirect them by replacing globals or Array/Object prototypes after
module initialization. Set/Map/Record operation hosts remain separate follow-up
layers rather than being conflated with List ownership.
Set and Map use their own adjacent operation fragment. It captures constructors,
native size accessors, lookup/membership/mutation methods, keys/values/entries
factories, iterator `next`, record-to-Map reflection, freezing, Reflect, and
Error identities. Construction, one-slot and pair iteration, snapshots, copy,
update, clear, and receiver methods advance captured iterators explicitly; no
ordinary Set/Map path executes a mutable instance/prototype method or `for...of`
over a host iterator. Record operations remain the next independent layer.
Record validation and operations use a third data-object fragment rather than
borrowing List-named reflection. It captures own field discovery/descriptors,
definition, identity, deletion, freezing, Reflect, and Error identities.
Indexing, one-slot and pair iteration, copy, mutation, and keys/values/entries
snapshots use explicit field-index loops. Record literal/spread construction is
still a separate lowering responsibility under `B-LOWER-RECORDS`, but it now
reuses the same initialization-captured discovery/definition/Error operations
and walks generated parts plus source fields by index. It no longer re-enters
ambient Object reflection, `hasOwnProperty.call`, or Array iteration.

Raw identity at a JavaScript call and collection reactivity share a
compiler-owned registry bridge, but they do not share one unconditional output
blob. The base fragment captures the global object and its Object/Symbol/Error
operations needed by its host boundary, validates the immutable registry owner,
and exposes only `toRaw`; registry functions are receiver-independent
compiler-owned callables, so invoking their captured identity does not require a
second ambient reflection path. The collection fragment is emitted separately
and validates only its additional
read/track/link/trigger operations. This keeps a JavaScript-only module from
carrying the collection path. When a Web module itself installs and validates
the runtime foundation, the Web emitter selects a compact local adapter that
captures those already-proved operation fields instead of repeating the
registry verifier. Core-shaped dependencies retain the general bridge because
they may initialize before their Web importer. Resolution there is deliberately late: an ESM
dependency can execute before the Web module that installs the optional runtime
provider. Absence therefore returns the input unchanged and is retried, while
the first valid provider and its data-valued operations are cached. A present
but malformed provider always fails closed. No later replacement of
`globalThis`, Symbol lookup, Object reflection, or Error
identity can redirect the generated bridge.

Standalone compilation and project compilation deliberately package this bridge
differently. `compile()` defaults to a self-contained JavaScript result and
inlines every required compiler runtime fragment, so an editor, embedding host,
or direct compiler consumer never needs CLI-owned resolution. Project
compilation instead enables shared runtime modules. The emitter records the
exact internal module specifiers required by each successful `CompileResult`,
and emits imports rather than repeating the fragment in every source module.
The compiler owns the specifier, source, exports, selection rule, and explicit
implementation-dependency edges. CLI execution adapters serve or bundle imports
directly and recursively materialize the declared dependency closure for
unbundled targets. An extension module's dependency map belongs to the same
source owner as its source override, so a higher-priority replacement cannot
accidentally inherit the replaced implementation's hidden dependencies. Unknown
edges fail the build instead of producing an incomplete package. These modules
intentionally have source but no
`ModuleInterface`, so they are absent from the public standard-module API and
cannot become a user-facing `velar/*` capability by accident. This preserves
standalone portability while giving a project one verifier identity and one
bundled copy.

Compiler-known runtime Types split identity from validation execution. The
global registry fragment owns the immutable cross-module WeakSet identity; a
separate validation fragment owns per-call WeakMap/Set recursion state,
descriptor reads, Array/Promise/class brands, Type-object freezing, Reflect calls,
collection traversal, and ValidationError identity. Standalone compilation
composes those fragments inline. Project compilation imports their stateless
operations from one compiler-internal runtime module; every validation call still
creates fresh recursion state, while each generated record/alias predicate and
each concrete Type object remains in its declaring source module. The internal
module has no `ModuleInterface`, so sharing host operations neither publishes a
reflection surface nor turns module-local type declarations into global names.
Generated validators therefore do not call mutable collection prototypes, and
recursive validation rejects cycles while accepting repeated DAG nodes even
after application code replaces the ambient constructors, prototypes, or a
class's `Symbol.hasInstance` hook.
Reading a collection method as a value lowers to a receiver-once bound wrapper
around the same helper, including optional access; it never leaks a nonexistent
or overridable JavaScript instance method.
Collection runtime ownership is also split from collection values. Standalone
compilation inlines both the captured Array/Map/Set/Object/Reflect host ABI and
the stateless List/Set/Map/Record lowering algorithms. Project compilation uses
two hidden compiler modules: the algorithm module imports the host ABI and the
reactive bridge through its declared implementation dependency graph, while
generated consumers import the algorithm module. A consumer does not repeat
those transitive host/reactive imports merely because it calls a collection
algorithm; it declares them directly only when it also emits module-local
Record construction, binding, or structural-match lowering that calls that ABI.
Within every direct compiler-runtime import, the emitter selects only named
operations referenced by JavaScript identifier tokens in the generated
statements or compiler-owned helper bodies. It skips string, comment, and
template text and compares whole identifiers, so user data cannot look like a
runtime call and `__velarFooBar` cannot accidentally retain `__velarFoo`.
Collection, primitive-method, runtime-Type, and checked class-field
modules therefore keep one complete canonical export surface while each
consumer declares its actual static ABI instead of relying on downstream
tree-shaking to discard hundreds of unused bindings.
Collection
instances, callback values, generated literal operands, and application state
remain arguments owned by the consuming source module; the shared algorithm
module contains no collection store or application-specific reactive graph.
Strict/optional bracket reads and bracket writes belong to that same algorithm
module: they reuse its dense-List and Record proofs plus its reactive
read/link/unlink/trigger bridge. `IndexError` is an internal failure identity,
not a public constructor; project consumers share its captured native
`RangeError` base, while standalone compilation inlines the same canonical
implementation. Optional indexing still receives the index expression as a
thunk and never evaluates it when the receiver is absent.
Generated collection-construction thunks parenthesize every returned expression.
This is semantically required for object literals: bare `() => {field: value}`
is a JavaScript statement block and returns `undefined`, while
`() => ({field: value})` returns the data object promised by VelarScript.
This removes repeated realm discovery and repeated lowering bodies without
creating a project-global collection value or a public reflection API.
Single-slot loops keep their historical iterator helper. A two-slot loop owns a
second binding pattern in the AST and lowers through a pair helper: List/Set/
string values receive a code-point-aware insertion index, while Map entries
receive their key and reactively read value. The iterable expression appears
once in generated JavaScript, and both slots reuse the normal checked binding
pattern lowering.
An `async for` node carries an explicit AST bit instead of desugaring to a
JavaScript loop. Analysis requires a zero-required-argument `next` function
whose result is `Promise<T?>`; module interfaces preserve that structural or
class method contract. Emission captures the source and own data method once,
invokes it with its original receiver, accepts only an actual Promise through
the shared normalization helper, and stops only on normalized `null`. A
compiler-owned counter supplies the optional second slot. The emitted `while`
increments before the source body so `continue` advances, while ordinary
`break` stops without an extra pull or an invented cleanup operation.
List aggregation and keyed sorting reuse the checked shallow snapshot and
reactive-read boundary. A `sorted(by=selector)` call computes one ordered key
per snapshot entry before sorting and rejects simultaneous comparator use.
Membership lowers to a source-shaped `candidate, collection` helper signature,
so ordinary JavaScript argument evaluation preserves the language order without
an extra generated function boundary; a string right operand selects the same
controlled substring contract as `string.has(text)`.
`List.reduce(callback, initial)` likewise analyzes a callable getter or factory
before the initial expression. A literal arrow can receive the initial value's
context afterward because creating that arrow executes no user code; its body
still runs only after all call arguments have evaluated.
Optional collection contexts unwrap only while checking the present value, so
empty literals and constructors receive their collection contract without
changing the declared optional storage type.
Null coalescing applies the same rule to its deferred fallback: the fallback
receives the outer result context when one exists, otherwise the present side
of the optional left type. It is analyzed under the left side's null-path facts.
Spread-bearing List literals use sequential thunks so validation failure stops
later evaluation. When a part contains direct `await`, an async helper awaits
only that marked thunk; ordinary Promise-valued items retain their value identity.
Record literals preserve the same source-ordered construction model. The common
explicit-field case remains a direct JavaScript object literal; spread-bearing
records and the special JavaScript name `__proto__` use a dedicated writer.
Spread sources are copied through descriptors, rejecting symbols and accessors
without invoking them. This removes native object-literal `__proto__` behavior
while retaining an ordinary object prototype and deterministic replacement.
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
`undefined` from changing the language contract. Both object and List binding
helpers reuse the captured collection ABI and explicit indexed rest-copy loops;
post-initialization replacement of Array/Object/Reflect, iterators, prototypes,
or Error constructors cannot redirect them. Shape mismatch is reserved for
`match`; an asserted binding shape fails immediately.

Structural `match` has its own non-throwing lowering contract. Each List/Object
candidate uses captured collection reflection and explicit indexed snapshots;
malformed dense-List descriptors, accessors, symbols in a rest source, or an
oversized shape return a case miss and allow later cases/`else` to run. Rest
values are built with captured definition/allocation rather than native
destructuring. Replacing Array/Object/Reflect or Array iteration after module
initialization therefore cannot change which case is selected.

## Package ownership

- `packages/compiler` owns the Core language, source text, diagnostics,
  extension host, Core analysis, Core JavaScript emission, formatting, and
  source maps. It also owns compiler-internal runtime module identities,
  sources, exports, implementation dependencies, and per-result requirements;
  those modules are an emitted
  implementation detail, not a public Standard API. Component, JSX,
  reactivity, lifecycle, CSS, DOM lowering, and
  Web types are not active Core language features. Its extension protocol has
  explicit parser, analyzer, semantic-index, intrinsic-analysis,
  dependency-inspection, public-interface, module, emitter, lexical-editor, and
  contextual project-editor seams;
  extensions declare opaque primitive types and their parent relations through
  the generic analysis contract, so Core assignability contains no Web type
  names; primitive members are read-only unless their owning extension
  explicitly marks a field writable;
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
- `packages/node` owns the official local-runtime compiler extension, typed
  contracts, and zero-runtime-dependency Node implementations for
  `velar/serve`, `velar/fs`, `velar/env`, `velar/host`, `velar/terminal`,
  `velar/path`, `velar/process`, and the Node target of `velar/http`. It has no command,
  manifest, bundler, editor, or Web-framework ownership; another host may
  compose it without importing the CLI. Shared module names such as
  `velar/http` are selected by the explicit target extension, so Web and Node
  keep one source-level vocabulary without leaking one host implementation
  into the other.
  `velar/process` follows VelarScript's pull protocol directly: `Process.next`
  feeds `async for`, while `wait` owns the final aggregate result. Node and
  Desktop implement the same enum-tagged stdout/stderr chunks, single-reader
  lifecycle, incremental UTF-8 decoding, and consume-before-wait rule; no
  JavaScript callback or async-iterator type enters the public contract.
  Node also owns the internal `VELAR_PROCESS_HOST_RUNTIME` fragment used by
  both targets. This is compiler-extension infrastructure, not a Standard API
  module: it captures process validation, reflection, Map traversal, Promise,
  timer, and result-construction intrinsics once; both process targets compose
  the separate compiler-owned UTF-8 runtime, while Desktop supplies only its
  capability bridge and worker lifecycle. The boundary checker rejects a
  second Desktop copy or direct ambient validation in either generated target.
  Node's `child_process`, EventEmitter, stream, StringDecoder, and Buffer
  transport cannot satisfy that initialization guarantee inside the application
  Realm because Node itself consults public prototypes while spawning. The Node
  target therefore completes an eager handshake with one compiler-owned Worker
  before module evaluation finishes. Application code sees only a captured,
  bounded MessagePort request protocol; the Worker imports static `node:`
  built-ins only, caps unreleased handles at 128, and is ref-counted so idle
  imports exit while running children retain the process lifecycle.
  Environment and graceful-shutdown modules have smaller canonical captured
  host fragments because their effects do not require a second Realm.
  Filesystem, inbound-server, and outbound Node HTTP effects share a separate compiler-owned Worker
  behind the private transitive dependency `velar/node-host-v1`; it has no
  Standard API interface. Application-facing `velar/fs` owns captured
  path/number/UTF-8/typed-byte/result validation, `velar/http` owns lazy Vel
  request objects, option/secret snapshots, timers, Type parsing and host-result
  validation. Request- and response-phase network failures cross the private
  protocol as bounded structured records and become the shared
  `HttpTransportError` type; provider retry/replay policy remains outside the
  target runtime. `velar/serve` owns
  handlers, Velar request/response values, runtime Types, and strict JSON. Only
  the Worker imports `node:fs/promises`, `node:http`, `node:https`, and the Node
  path/stream machinery. Its captured proxy revalidates every message, limits
  pending operations, servers and inbound/outbound requests, avoids live
  identity collisions when handles wrap, releases idle imports, and retains
  active servers and unread HTTP responses. The Worker
  also enforces one 128 MiB aggregate byte budget across cached request bodies,
  static files, buffered responses, and in-flight stream writes. Stable request
  bytes are released only when the response transport is done and every active
  host operation has settled; transient stream-chunk ownership is returned by
  its own flush/failure path. This keeps
  filesystem, sockets, request bodies, static files and response backpressure
  outside the application Realm without publishing a second user-facing host
  abstraction. Terminal transport cannot be
  made stable by capturing `readline` or `Readable` wrappers: Node's own stream
  queue continues through public EventEmitter/Array prototypes. It therefore
  performs line decoding and fd writes in a separate compiler-owned Worker,
  with a bounded captured MessagePort proxy and explicit idle/active/close
  ownership. POSIX stdin uses a descriptor duplicated during official-module
  initialization; the creating Realm closes that duplicate only after the
  Worker acknowledges stream destruction. The Worker itself is ready eagerly,
  but it creates its input stream only for the first `readLine`, so a module
  import or output-only CLI never acquires an active stdin reader.
- `packages/create` owns transactional project creation and the complete
  `web`, `docs`, `library`, and `component` template inventory. The component
  template is an ordinary Web source package with a separate preview entry, not
  a compiler extension. Creator code has no compiler, browser, CLI, or editor
  dependency.
- `packages/cli` owns the format-2 manifest shell, extension resolution,
  commands, the npm-backed project dependency workflow, filesystem graphs, the
  Core Standard modules, Node-extension composition, test discovery,
  optimized production bundling, the dev server, hot
  replacement transport, browser driver, verification, and the language
  server. It materializes compiler-declared internal runtime modules across
  project execution paths without defining their contents or exposing their
  interfaces. Unbundled project builds are written into a sibling staging
  directory and replace the previous owned output only after every source map,
  package module, and transitive runtime dependency succeeds; removed source or
  dependency modules therefore cannot survive as ghost artifacts, while a
  failed compile/build leaves the last complete output intact. A `--out`
  single-file build synchronizes only a synthetic `node_modules/velar` package
  carrying the CLI ownership marker, refuses to overwrite a foreign package,
  and removes an obsolete generated stylesheet when the current result has no
  CSS. The `velar run` adapter owns its spawned program through termination:
  it forwards the first SIGINT/SIGTERM, escalates a second signal or its bounded
  launcher deadline, waits for inherited stdio to close, and maps a
  signal-terminated child to the conventional command status. This orchestration
  stays outside the Node extension; `velar/host` owns only the cleanup semantics
  inside the compiled program. For every
  declared extension it may load an optional `/host` export,
  validates framework-host protocol version 1 and matching compiler capability,
  and composes at most one application host. CLI source neither identifies the
  official Web npm package nor constructs Web HTML/CSP/JSX-editor/lifecycle
  behavior.
- VelarOS Workbench owns the generic editor and LSP host. Its default VelarScript
  contribution owns presentation and connection metadata, but never copies or
  embeds compiler semantics.

The compiler, Node runtime, Web and Desktop frameworks, creator, and CLI build as independent npm packages
containing emitted JavaScript, source maps, and `.d.ts` declarations. Node and Web pin
the exact compiler version. CLI pins the compiler, Node runtime, and creator but neither
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

Null normalization is type-directed. Every
checked expression whose expanded type is optional, `null`, or `unknown`
observes JavaScript `undefined` as VelarScript `null`; `Promise<T>` receives the
same treatment when `T` has that nullish contract. This rule survives values,
objects, collections, classes, aliases, cycles, namespace imports, and dynamic
imports without a second propagation model. Unsafe JavaScript `any` remains
outside the guarantee.
Assignment targets are a separate lowering context: they never receive the
read-side `?? null` normalization. Flow-narrowed reads use the current fact,
while plain assignment is checked against the declared location type and
invalidates stale facts for that location and its descendants.
Short-circuit `and`/`or` analysis evaluates the right operand under the facts
that make it reachable, records only facts valid for the complete result path,
and lowers optional conditions to explicit presence checks. `while` bodies use
the same successful-condition facts rather than a separate loop rule. During
loop analysis, reachable `break` statements are captured only by their owning
loop; a literal-true loop with no captured break is recorded as non-fallthrough
for result inference, explicit return checking, and unreachable-tail analysis.
Optional indexes and calls apply their successful-chain facts only while
checking the deferred index or arguments. A statically skipped index is checked
for diagnostics in isolated flow, so code that cannot execute cannot erase a
continuing fact. Optional callable contexts unwrap only for contextual function
inference and remain optional at the declared storage boundary.
Flow facts snapshot the complete binding state around mutually exclusive `if`,
`match`, `try`/`catch`, and inline conditional branches and around loop bodies.
Only invalidations from paths that can reach the next statement are merged;
unreachable tails cannot mutate the continuing fact set. Facts created with the
same semantic type on every continuing path are intersected back into the outer
scope. Match pattern values and guards are processed in runtime order, so a
failed effectful guard changes the facts available to later cases. Successful
match guards and terminating guard clauses reuse the same fact model.
Narrowed facts persist across ordinary calls, `await`, getter reads, and
f-string interpolation. Exactly two things clear a fact: an assignment to the
narrowed location, including destructuring and compound targets, and merging
branches where such an assignment can reach that location. A getter result is a
computed value rather than a stable location, so narrowing applies to it only
after it is read into a local binding. Narrowing does not flow into a nested
function body, and invalidations remain inside their current flow frame, so
analyzing a deferred function, callback, component, or instance initializer
does not pretend that declaration is an immediate execution.

Assertion messages are analyzed on an isolated failing path with the condition's
negative facts. That path always throws, so message effects never contaminate
the successful continuation where the positive assertion facts apply.

Bindings record assignment permission. Local `let` is assignable, an imported
`export let` is read-only locally even though the exporting module can reassign
it between reads, and `export const` is never reassigned.
`ModuleInterface.mutableExports` survives project fixed-point analysis and
participates in the interface cache identity. Namespace imports reject live exports and expose read-only fields,
avoiding an untrackable mixture of property syntax and ES-module live bindings.

Member writes clear aliased member-path facts even when their source bindings
differ. A plain assignment only locates its target before evaluating the right
side; compound assignment also performs an old-value read before the right
side. The Web analyzer checks component JSX in emitted order—props, children,
invocation.

Catch lowering uses the host's cross-realm Error brand check, then converts
foreign non-Error throws without applying JavaScript string coercion to objects
or functions. Primitive messages remain readable; reference values receive a
deterministic message and are retained as `cause`.
The emitted fragment captures Error branding/construction, primitive String
conversion, Object/Reflect discovery and invocation, and TypeError identity at
module initialization. Standalone output inlines it; project output imports one
compiler-internal normalization module. Web project output imports the same
three operations while retaining report metadata, scheduling, handler
collections, timestamps, and Promise rejection observation in its Web-owned
runtime state. A later script cannot
change catch classification or redirect an application failure by replacing
ambient constructors, static methods, or prototypes.
The analyzer also rejects `return`, or `break`/`continue` that crosses a
`finally` boundary, while permitting control flow owned by a loop nested wholly
inside cleanup. These rules prevent cleanup from silently replacing a pending
return or exception. The compiler exports this generated-runtime fragment
through its extension seam; Web events, resources, actions, routing, timers,
application reports, and the Standard logging sink reuse that one source
instead of maintaining local error wrappers.

Strict JSON follows the same single-source rule. The compiler extension seam
exports the descriptor-based validation, snapshot, size-budget, and stringify
fragment used by both `velar/json` and the Web HTTP, storage, database, and
realtime modules. Those packages still own their public APIs, but they cannot
silently diverge on what counts as JSON or serialize a mutable host object after
validating an earlier view of it. Accessors are rejected without invocation,
and accepted values are serialized from the validated data snapshot.

Checked String methods follow an equivalent compiler-owned text runtime. It
captures string, array, numeric, reflection, Unicode-progress, and Error
operations at module initialization; `velar/text` extends that source with its
captured RegExp constructor/exec and bounded transformation helpers. Pattern
replacement and splitting do not delegate back to mutable RegExp symbol hooks.

Checked Number receiver methods use a separate compiler-owned Number runtime.
It captures the exact Math operations, `Number.isSafeInteger`, native
`Number.prototype.toFixed`, reflection, and Error identities when the generated
module initializes. The emitter only selects the helper; it does not maintain a
second implementation or re-read ambient numeric globals when a method is
called. Standalone results inline the text and Number fragments together as
before. Project results import their compiler-lowered entry points from one
internal primitive-method module, so many Core-shaped source modules share one
captured host ABI and one production copy. The internal module still has no
`ModuleInterface`; `velar/text` remains the separate public Standard API rather
than becoming an alias for compiler lowering internals.

The Node tooling boundary follows the same non-coercion rule without sharing a
browser runtime. CLI extension loading, project compilation, language-server
requests, package resolution, previews, verification, and test reporting read
only bounded own data from native Error values. Foreign objects are summarized
without invoking getters, prototype traps, `toString`, or primitive-conversion
hooks. Node error codes therefore remain usable across realms while an
extension failure cannot break the diagnostic path that reports it.

Release packaging is outside compiler semantics. A repository script builds
all six npm packages, records source and tarball identities, verifies every
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
  for `console`; custom sinks have explicit disposable ownership. Core ID and
  collections, text, JSON/runtime Type, math, URL, time, ID, and logging modules
  capture their List/Map/Set/WeakSet, parse/serialize/reflection, numeric/random,
  URL/location/query, clock/date/internationalization, crypto, Promise, text,
  Error, and fallback-console operations at module initialization, so
  application code cannot silently replace the host ABI after ownership has
  been established.
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
  permits ordered links only for numbers or strings. Each later operand is
  analyzed under facts from every successful earlier link, and the complete
  truthy chain publishes those facts to its controlled body. Emission uses a
  hygienic arrow IIFE with compiler-only `$` bindings so operands evaluate once
  in source order and later links short-circuit; a chain containing direct
  `await` uses an immediately awaited async IIFE, preserving a boolean source
  result.
- Match analysis carries the successful pattern type back to a stable matched
  identifier or owned data-field path. Guard analysis begins with that fact and
  publishes it to the body unless an assignment in the guard invalidates it.
  Representable exclusions such as a rejected `null` or union member feed later
  cases, `else`, and the unmatched continuation.
- Enum member expressions retain a nominal singleton `enumMember` type.
  Enum declaration AST members also retain their explicit serialized string,
  defaulting to the member name. That runtime value never replaces the nominal
  member identity in module interfaces or semantic navigation. Emission writes
  the mapped values into the frozen enum object and builds `is` from a strict
  equality chain, avoiding mutable `Array.prototype` helpers.
  Common-field reads over record unions merge field types, and equality or a
  value/record pattern filters both the field and its stable owning record.
  Writes through a union are accepted only when every variant requires the
  same field type; otherwise the owner must first be narrowed. Module interface
  extraction and import renaming preserve the declaring enum identity while
  semantic display uses the consumer's local enum spelling. Runtime record
  predicates lower singleton fields to strict equality with the registered
  enum member.
- Dynamic JSON objects use a distinct invariant `record` value type behind the
  source spelling `Record<T>`. Contextual object literals validate every own
  field against `T`; index reads are optional, string-key writes and collection
  members lower to controlled record helpers, and runtime `Type<Record<T>>`
  validation rejects prototypes other than `Object.prototype`/`null`, symbols,
  accessors, oversized objects, and values outside `T`. `jsonSerializable`
  descends through `Record<T>` while continuing to reject native Map and Set.
- Binary operands retain source grouping when JavaScript has a lower-precedence
  form such as an arrow function; emitted code never relies on discarded source
  parentheses to remain syntactically valid.
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
- The analyzer rejects a known Promise resolved type whose top-level shape has
  a callable `then` data member or any `then` getter. This check runs on Promise
  type syntax, async declarations/actions/arrows, generic call instantiations,
  calls, awaits, async intrinsics, and the concrete type of every async return.
  A return can still hide the concrete shape through `unknown`, base-class, or
  cross-module widening, so the emitter wraps object-capable async return values in a
  compiler-owned descriptor guard before native Promise adoption. The guard
  preserves actual-Promise adoption, rejects callable `then` data descriptors
  and getters without invoking the getter, and captures its host operations at
  module initialization; primitive and already-checked Promise returns do not
  pay for that guard. The rule is intentionally shallow:
  `Promise<List<Box>>` is valid because native Promise resolution never inspects
  List elements. This rule exposes a JavaScript representation limit instead of
  pretending a callable `then` record can survive native Promise adoption.
- Promise normalization and async pull invocation capture their required
  Reflect, Object, WeakMap, and Promise operations when the generated module
  initializes. Later ambient prototype replacement cannot redirect a checked
  pull, execute an accessor-backed `next`, or turn a thenable into a Promise.
  Standalone compilation inlines the normalization runtime. Project compilation
  imports `normalizePromiseValue` and/or `asyncResolvedValue` from one hidden
  compiler module, so every source module converges on the same immutable
  normalized-Promise WeakMap registry without exposing that cache or absorbing
  the separately module-local async-pull receiver. The registry key is owned by
  `runtime-abi.ts`, not repeated in emitted JavaScript templates.
  `velar/async` applies the same host-ABI rule to List validation, timers,
  numeric guards, reflection, and Promise observation, and does not dispatch
  through input List instance methods.

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
