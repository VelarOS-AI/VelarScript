# JavaScript Declaration Bridge

Status: deliberately limited in VelarScript 0.10

This bridge is the checked and unsafe foreign-code portion of the
[runtime and JavaScript boundary ledger](runtime-boundary.md). The language
charter owns observable semantics; this document defines the deliberately
limited declaration shapes and adaptations that implement that boundary.

Platform builtins are first-party standard modules; `extern module` and
`import js` are for third-party packages, not for reaching Node's filesystem,
HTTP server, environment, process signals, or shutdown lifecycle.

Safe `import js` first uses an explicit local `extern module` when present; the
manual declaration owns the whole source contract, so the automatic
TypeScript-declaration probe below neither runs nor prints notices for that
module's imports of the declared source. Ownership cuts both ways: importing a
name the extern block does not declare is a check-time error naming the block
and the fix — a typo can never silently bind `unknown`. If
there is no manual declaration, the project compiler may read the npm package's
`types`, `typings`, export-map `types`, or adjacent declaration entry. Exact and
single-wildcard package subpaths such as `sdk/client` and `sdk/features/*` use
their own export-map contract rather than silently falling back to the root.
A declared `types` path that names an unreadable file degrades to `unknown`
with the same non-blocking `VEL9002` notice the unsupported shapes use — a
broken declared path is a package defect worth one line, not silence.

An `import js` specifier names a module the host can resolve on its own, and the
legal space is exactly three shapes:

- a **package** specifier — `"lodash"`, `"@scope/name"`, or a package subpath
  such as `"highlight.js/lib/common"`;
- a **host builtin** — `"node:process"` and the other `node:` modules, plus the
  bare builtin names;
- a **`data:` URL** — `"data:text/javascript,export const x = 1"`, which is how
  first-party tests declare a tiny module inline.

A `#`-mapped import from the importing package's own `imports` map resolves too.
A **relative path is not legal**: `import js {x} from "./local.js"` is refused,
because the emitted program is a directory of modules whose relative structure
belongs to the compiler, and a hand-written sibling `.js` file has no place in
it. Move that JavaScript into a package — a workspace package is enough — and
import it by name.

Bare `import js` specifiers resolve at check time in a project compile: a
package that is not installed next to the importer is a check error instead of
a raw `ERR_MODULE_NOT_FOUND` pointing at emitted artifacts, and a VelarScript
source package reached through `import js` is answered with the
reverse-direction teaching (import it without `js`). Node builtins, `node:`,
`data:`, and `#`-mapped specifiers are exempt from that existence probe because
the host owns their resolution.

Here, safe means statically checked against one trusted declaration contract.
It does not sandbox JavaScript, attest a package, or automatically inspect every
runtime argument, return value, object field, or class instance. The package and
its declaration must honor the same ABI. VelarScript performs only the explicit
boundary adaptations documented below, such as `undefined` to `null`
normalization and actual-Promise enforcement; it does not silently turn a false
declaration into a runtime schema.

The bridge understands only the TypeScript declaration shapes that map directly
to VelarScript's lightweight type system:

- exported functions and constants;
- string, number, boolean, output literals, and explicit nullish results:
  `null`, `void`, or a standalone returned `undefined` become `null`, while
  `T | undefined` flowing out of JavaScript becomes `T?`;
- simple unions;
- mutable arrays, mutable Set, Promise, and read-only array/Set views. A
  read-only input accepts the corresponding mutable VelarScript collection,
  while a read-only result keeps its non-mutating checked surface; final
  array-typed rest parameters may use TypeScript's conventional
  `readonly T[]` spelling;
- object/interface fields, simple method signatures, simple non-generic
  interface inheritance, and simple aliases;
- non-generic callback function types, including callbacks nested in exported
  function parameters;
- final array-typed rest parameters, mapped to VelarScript rest element types;
- simple classes with one constructor, public mutable/read-only fields,
  getter-only or same-typed getter/setter properties, instance methods, static
  mutable/read-only fields/accessors, static methods, and `this`
  results, plus simple local or relatively imported class inheritance when every
  base contract is accepted. Class identity is the declaration file plus local
  class name, so aliases preserve identity while equally named classes from
  different packages are not assignable;
- direct `export` declarations and the common bundled form that declares local
  classes, functions, constants, interfaces, or aliases first and exports them
  through a final `export {Name as Alias}` / `export type {Name}` table. Type-only
  exports never fabricate JavaScript runtime values;
- simple relative named declaration imports used by signatures and base classes;
  they contribute type contracts but do not become runtime exports;
- package-local relative `export {Name as Alias} from "./module"` and
  `export * from "./module"` declaration graphs. Resolution follows only real
  `.d.ts`, `.d.mts`, or `.d.cts` files inside the package root, to at most 64 files, 16 levels,
  and 2 MiB in aggregate; cycles, missing names, and ambiguous star exports
  degrade safely instead of selecting an arbitrary contract.

TypeScript's `value?: T` parameter spelling controls call arity only. The bridge
shows it as `T = default`: omission is allowed, but an explicit VelarScript
`null` is rejected unless the declaration also contains `null`. Likewise,
`T | undefined` flowing out of JavaScript is normalized to an optional/null
result, while an input position never pretends that VelarScript `null` is the
same JavaScript argument as `undefined` or TypeScript `void`.

`readonly T[]`, `ReadonlyArray<T>`, `ReadonlySet<T>`, and
`ReadonlyMap<K, V>` map to VelarScript's compile-time read-only collection views
in parameters, results, callbacks, methods, and Promises. Mutable `Array`,
`Set`, and `Map` declarations map to their mutable VelarScript counterparts.
They keep the native JavaScript value and identity, while mutating members such
as `append`, `add`, and `set` are absent from the checked read-only surface.
Mutable VelarScript collections may be supplied to these read-only inputs; a
value returned as read-only cannot be passed to a mutable collection parameter.
Readonly object/interface fields are shallow: the field cannot be assigned,
while an object stored in that field keeps its own declared mutability.

TypeScript `Record<K, V>` also degrades to `unknown`. A Record is a plain
JavaScript object, not a native `Map`; mapping it to `Map<K, V>` would create a
false runtime contract. Use an explicit object interface with known fields or a
manual adapter that returns a real Map.

Namespace declaration imports, abstract/generic classes, unresolved or complex
inheritance, constructor or method overloads, setter-only or incompatible
accessors, index signatures, generics, conditional/mapped/indexed types,
declaration merging, recursive aliases, export assignments, external-package
re-exports, and computed re-export graphs do not
become a hidden TypeScript compiler. They degrade to `unknown` with a non-blocking
`VEL9002` notice. Calling or accessing the resulting unknown value remains a
normal safe-boundary error. `import js unsafe` still provides the explicit
escape hatch, while `extern module` remains the precise manual adapter.

Manual adapters describe only runtime exports and never execute declarations:

```velar
extern module "text-tools":
    export const version: string
    export def format(value: string) -> string
    export async def load(id: string) -> string

    export class Formatter:
        const prefix: string
        let precision: number
        constructor(prefix: string, precision: number = 1)
        static const version: string
        get label() -> string
        def format(value: number) -> string
        static def create(prefix: string) -> Formatter
```

`export const name: Type` describes a read-only JavaScript export without a
VelarScript initializer. Functions use the same checked parameter/result syntax as
ordinary VelarScript functions. `export class` provides a complete
constructor/instance/static contract directly.

Extern classes take no type parameters — a generic extern class is rejected
with guidance (declare the class without them; generic `def` members and
`unknown` carry the varying types), exactly like a generic source class.
`extends` between extern classes inherits fields, getters, and methods, but
never the constructor: a derived extern class without its own
`constructor(...)` line takes zero construction arguments — the opposite of
JavaScript's default — so a derived class that is constructed with arguments
redeclares the constructor signature it accepts.

`readonly` does not apply to extern classes, methods, or getters. A manual
adapter describes their callable shape, but it does not make a purity or
receiver-mutation promise. Narrowed data read after such a call is revalidated
at runtime like data read after any other opaque call.

Each manual export, constructor, or method has exactly one declared signature.
An extern default parameter controls call arity only: omitting it sends no
argument to JavaScript, and the written default expression is never executed as
a declaration body. APIs with overloads or event-name-dependent callback
shapes should expose one fixed adapter facade (or cross through `unknown` and
validate) rather than importing JavaScript's overload system into VelarScript.
This is deliberate: overload resolution alone cannot prove that `on("data",
listener)` and `on("close", listener)` require different listener contracts
without adding literal types and a second public type-programming surface.
First-party platform APIs such as `velar/serve` own those host-specific shapes
internally; `extern module` remains the fixed-contract boundary for third-party
packages.

Declared exports are presence-checked at load. When a module imports names
governed by an `extern module` declaration, the emitted bridge verifies at
module initialization that each imported name actually exists on the
JavaScript module — one namespace-membership probe per imported binding — and
refuses with an error naming the source, the export, and the likely fix
instead of binding `undefined` and failing far from the cause. This is
existence only, consistent with the trusted-ABI stance above: no shapes, no
runtime schema. A declared export whose value is legitimately `undefined`
still loads, because the boundary is membership in the module namespace, not
the bound value.

An import of a name the package does not export therefore has two failure
shapes, and which one an author sees depends on whether a declaration governs
the source. Under an `extern module` block, a name the block does not declare is
a check error naming the block, and a name the block declares but the package
does not export is the owned initialization error above — both name the source,
the export, and the fix. Without a declaration, the failure is the host's:
`import js unsafe` of a missing export produces the native ES-module
`SyntaxError: The requested module 'pkg' does not provide an export named 'x'`.
That message is source-mapped but unowned, which is one more reason to promote a
stabilizing boundary to `extern module`.

Default-export-only packages are declared with the export name `default`. This
is a supported contract, not a parser accident: `default` is not a VelarScript
keyword, so it names the extern export directly, and the bare `import js Name
from "pkg"` form imports exactly that name. Both the class shape and the
constant shape work:

```velar
type MarkdownItOptions:
    html: bool

type Highlighter:
    highlight: (code: string, language: string) -> string

extern module "markdown-it":
    export class default:
        constructor(options: MarkdownItOptions)
        def render(source: string) -> string

extern module "highlight.js/lib/common":
    export const default: Highlighter

import js MarkdownIt from "markdown-it"
import js hljs from "highlight.js/lib/common"

const renderer = MarkdownIt({html: false})
```

The bare form `import js MarkdownIt from "markdown-it"` is the canonical
default import; the explicit spelling
`import js {default as MarkdownIt} from "markdown-it"` is equivalent, and both
lower through the same presence-checked bridge as any other declared export.
Because `default` is a reserved word in JavaScript, the imported binding must
always carry another local name — which both forms provide. Use the constant
shape for default-exported singletons (it tells no lies about
constructability) and the class shape when the default export is genuinely
constructed with `new`.
Calls lower to native JavaScript `new`, including namespace imports, while
VelarScript keeps the declared class nominal and enforces read-only members.
Before a generated JavaScript call crosses the host boundary, reactive record
arguments are converted to their raw identity through the optional shared Web
runtime. That lookup is a compiler-owned, late-binding ABI rather than a live
`globalThis[Symbol.for(...)]` probe on every call: the generated module captures
the global object and reflection operations at initialization, retries only
while the provider is genuinely absent, then caches the first valid immutable
provider operation. A present accessor-backed, mutable, extensible, or otherwise
incompatible registry fails closed without running its hooks. This adaptation
does not make `import js unsafe` checked; it only prevents a framework proxy from
being mistaken for the application value the host API was given.
An `async def` in an extern block declares a member whose JavaScript returns a
Promise; `def load(id: string) -> Promise<string>` declares the same contract,
and the two spellings are equivalent. Either way the value crossing the boundary
is normalized at the call site, so a foreign thenable fails there with an owned
error rather than being adopted.

## Extern arguments are read-only

What crosses the call is the **raw identity** — the same object, without the
reactive wrapper the VelarScript side reads through. That is what makes host
APIs work at all: a DOM call receives the value the DOM expects. It is also the
reason an extern argument is read-only by contract.

If the package writes into the object it was given, the write lands on the real
data and nothing on the VelarScript side hears it. Reactive reads are
invalidated by VelarScript-side assignment; a foreign write performs no
assignment, so no computed value recomputes, no component re-renders, and no
watcher runs. The change becomes visible at the next VelarScript-triggered
invalidation that happens for some unrelated reason — data appearing to change
with no cause at the point where it is finally noticed. Flow facts have the
same blind spot: a narrowing established before the call is not re-established
by a foreign write, and the value the compiler proved is not the value in the
object any more.

So each call carries data one way. A package that produces data **returns** it,
and the VelarScript side assigns the result:

```velar fragment
extern module "text-tools":
    export def formatEntries(entries: readonly List<string>) -> List<string>

import js {formatEntries} from "text-tools"

let entries: List<string> = ["beta", "alpha"]
entries = formatEntries(entries)
```

Declaring the parameter `readonly` states the contract in the signature where a
reader will find it. Everything passed across the bridge is borrowed for the
duration of the call.

Direct `compile()` results inline this bridge and remain independently
executable. A project compile instead reports a compiler-internal runtime-module
requirement and imports that one shared implementation from every module that
crosses the boundary. Dev, test, run, and production adapters materialize the
same compiler-owned source; it has no public `ModuleInterface` and is not a
user-importable JavaScript bridge or Standard API package.
After a statically `null` call or `await` is evaluated, its observable result is
normalized to `null`. Every checked expression typed as optional, `null`, or
`unknown` translates JavaScript `undefined` to `null`. The decision follows the
checked type, not where a value originated, so it remains valid through
assignment, destructuring, objects, collections, member access, functions,
classes, aliases, cycles, namespace imports, and dynamic imports. Normalization
is idempotent, evaluates an expression once, and preserves side effects and
errors. Explicit `import js unsafe` values remain the caller's responsibility
because `any` has no checked result contract.

Every checked `Promise<T>` is adapted when it enters a VelarScript expression,
not only when it is awaited. As everywhere else in the language, a JavaScript
`undefined` resolution becomes `null`. The adapter preserves rejection and its
cache is shared by generated VelarScript modules, so the same Promise remains
the same VelarScript Promise even when it is exported, stored, compared,
imported through any supported module form, or passed through `velar/async`
before awaiting. A
JavaScript export declared as `Promise<T>` must return an actual native Promise
(including one from another realm); arbitrary thenables are rejected without
reading a `then` accessor. Native Promise resolution itself reserves the
top-level `then` property, so a checked resolved `T` cannot expose a callable
`then` data member or any `then` getter. The compiler rejects known bridge
contracts with that shape. A non-callable data `then` field and nested
then-shaped values inside a List or record remain ordinary data. VelarScript
async functions additionally guard their concrete return value before native
adoption, because a checked `unknown`, base-class, or cross-module contract can
hide a more specific JavaScript shape. This return guard reads descriptors
rather than the `then` property and therefore rejects an accessor without
executing it.

An exported constant whose interface contains ordinary methods remains a plain
checked object boundary. For example, `request(path: string): Promise<string>`
maps to a callable `request` field. This does not create a class, infer
overloads, execute declaration code, or import TypeScript's type-level rules.
Optional function-valued members are displayed without ambiguity, for example
`(() -> null)?` rather than a function returning an optional result.
Direct non-generic interface bases are flattened only when every base resolves
to a plain object contract. Generic/complex bases, cycles, and declaration
merging degrade the complete affected interface to `unknown`; the bridge never
silently drops inherited fields and keeps checking a weaker partial shape.

Thrown non-Error values normalize at the boundary everywhere. Velar `catch`
normalizes what it catches, async paths normalize through the rejection
channel, and a synchronous extern call in module-initialization position
rethrows through the same owned normalization — so a JavaScript library that
throws a bare string can never reach the host as an unowned raw value, in any
position.

Untrusted host, network, storage, or plugin data should cross the declaration as
`unknown`, then enter application code through the existing runtime `Type`
validator:

```velar
type User:
    id: string
    name: string

extern module "user-sdk":
    export def loadUser() -> unknown

import js {loadUser} from "user-sdk"

const user = User.parse(loadUser())
```

Declaring `loadUser() -> User` instead is an assertion that the JavaScript
package already owns and guarantees that runtime contract. It is not a request
for the compiler to wrap the package with implicit validation.

## `any`: the operational model

`import js unsafe` admits a value as `any`. The charter's section 12 owns the
rule; this is what it means while writing code against a package.

**Operations on an `any` are raw JavaScript, with no adaptation.** Member reads
and writes, calls, indexing, arithmetic, `match`, and `is` go straight to the
host. The `undefined`-to-`null` normalization that every checked type receives
does not apply, so the language's one presence test lies about an `any`: an `any`
holding `undefined` answers `false` to `== null` and `true` to `!= null`.
Assigning it into a checked optional first — `const value: string? = raw` —
restores the normalization, which is a reason to annotate at the edge rather than
to test in place. Four operations are refused instead of passed through, because
each one would let raw JavaScript semantics back into checked code silently: an
f-string and `str()` (JavaScript coercion would run foreign conversion hooks), a
condition (JavaScript truthiness would send `0` and `""` to the `else` branch),
and `await` (an unchecked thenable runs foreign hooks and can resolve to raw
`undefined`).

**An `any` is assignable to every type, and nothing is checked at run time.**

```velar fragment
import js unsafe {payload} from "legacy-package"

const label: string = payload.title
```

That compiles, emits no check, and believes the annotation. If `payload.title` is
an object, `label + "!"` produces `"[object Object]!"` — the implicit conversion
the language exists to reject, reintroduced by one unvalidated assignment.
Validation happens only where validation already happens: `Type.parse`,
`Type.is`, a checked collection operation, a `match` pattern.

**So the import statement is the only correctness boundary that exists.**
Validate there — `Config.parse(payload)` — and let only checked values inward.
An `any` carried deeper into a program carries the absence of guarantees with it,
and the eventual failure appears wherever the value is finally used, not where it
entered.

## The adapter module

An `extern module` declaration is **module-local**. It governs the `import js`
statements in the file that contains it and nowhere else: a second module that
writes `import js {…} from "text-tools"` without its own declaration gets
`unknown` bindings, and an extern class name is not a type that other modules
can import. The naive consequence is an extern block pasted into every consumer,
which is four copies of one contract to keep in sync.

Declare it once instead, in an adapter module that owns the boundary and
re-exports a checked surface:

```velar
extern module "text-tools":
    export const version: string
    export def format(value: string) -> string
    export async def load(id: string) -> string

    export class Formatter:
        let precision: number
        constructor(prefix: string, precision: number = 1)
        def format(value: number) -> string

import js {Formatter, format, version} from "text-tools"

/// The package's version, as an ordinary checked export.
export const textToolsVersion = version

/// A function export is a value: re-export it directly.
export const formatText = format

/// A class is not a value, so construction crosses through a factory...
export def formatter(prefix: string, precision: number = 1) -> Formatter:
    return Formatter(prefix, precision)

/// ...and an alias publishes the instance type for annotations.
export type TextFormatter = Formatter
```

Consumers then import ordinary VelarScript:

```velar fragment
import {TextFormatter, formatText, formatter} from "./text-tools.vel"

const shared: TextFormatter = formatter(">", precision=2)

print(formatText("value"))
print(shared.format(3.14159))
```

Every call, construction, and member access on the consumer side is checked, and
the package name appears exactly once in the project. The adapter is also where
narrowing belongs: an export declared `-> unknown` is validated with
`Type.parse` inside the adapter, so consumers receive the application's own
types and never an unvalidated value. When the package's contract changes, one
file changes.

Declaration files and JavaScript files in installed npm packages are watched by
the development server. A declaration change performs a full safe reanalysis;
a runtime JavaScript change reloads the application.

The development server serves npm packages to the browser as native ES
modules by prebundling each package with the same bundler the production
build uses. A package's resolved browser entries become one bundle in
`<project>/.velar/dev-deps`, keyed by package version and reused until the
version or the installed files change; internal CommonJS converts to ESM (the
common dual-package wrapper whose ESM entry imports its own CommonJS
internals works unchanged), while imports of other packages stay bare and
resolve through the import map. A package that publishes no ESM entry at all
is refused with an error naming the package — native ES modules cannot
reproduce CommonJS named exports — and `velar build` can still bundle it.
