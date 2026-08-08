# JavaScript Declaration Bridge

Status: deliberately limited in VelarScript 0.10

Platform builtins are first-party standard modules; `extern module` and
`import js` are for third-party packages, not for reaching Node's filesystem,
HTTP server, environment, process signals, or shutdown lifecycle.

Safe `import js` first uses an explicit local `extern module` when present; the
manual declaration owns the whole source contract, so the automatic
TypeScript-declaration probe below neither runs nor prints notices for that
module's imports of the declared source. If
there is no manual declaration, the project compiler may read the npm package's
`types`, `typings`, export-map `types`, or adjacent declaration entry. Exact and
single-wildcard package subpaths such as `sdk/client` and `sdk/features/*` use
their own export-map contract rather than silently falling back to the root.

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
- mutable arrays, mutable Set, and Promise. A readonly collection used only as
  an input parameter may accept the corresponding mutable VelarScript
  collection safely; final array-typed rest parameters may likewise use
  TypeScript's conventional `readonly T[]` spelling;
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

`readonly T[]`, `ReadonlyArray<T>`, `ReadonlySet<T>`, and other readonly
collection values that flow from JavaScript into VelarScript degrade to
`unknown`: VelarScript deliberately has no hidden readonly collection family,
so the bridge does not pretend a returned value supports `append`, `add`, or
other mutation. The bridge tracks direction through callbacks, methods, and
Promises rather than treating every nested occurrence as an input. Readonly
object/interface fields remain readable but cannot be assignment targets.

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

    export class Formatter:
        const prefix: string
        let precision: number
        constructor(prefix: string, precision: number = 1)
        static const version: string
        def format(value: number) -> string
        static def create(prefix: string) -> Formatter
```

`export const name: Type` describes a read-only JavaScript export without a
VelarScript initializer. Functions use the same checked parameter/result syntax as
ordinary VelarScript functions. `export class` provides a complete
constructor/instance/static contract directly.

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
reading a `then` accessor.

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
