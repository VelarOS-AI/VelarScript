# JavaScript Declaration Bridge

Status: deliberately limited in VelarScript 0.10

Safe `import js` first uses an explicit local `extern module` when present. If
there is no manual declaration, the project compiler may read the npm package's
`types`, `typings`, export-map `types`, or adjacent declaration entry. Exact and
single-wildcard package subpaths such as `sdk/client` and `sdk/features/*` use
their own export-map contract rather than silently falling back to the root.

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
Calls lower to native JavaScript `new`, including namespace imports, while
VelarScript keeps the declared class nominal and enforces read-only members.
After a statically `null` call or `await` is evaluated, its observable result is
normalized to `null`. Every checked expression typed as optional, `null`, or
`unknown` translates a JavaScript `undefined` to `null` only while the analyzer
can prove that the value originated at a safe JavaScript boundary. Provenance is
preserved through assignment, destructuring, indexing, member access,
type-preserving function forwarding, returned functions, and class instance or
static members. Ordinary VelarScript optional values already contain only
VelarScript `null`, so they are not wrapped again. This keeps the generated code
minimal without allowing JavaScript `undefined` to leak into checked values.
Side effects and errors are preserved. Explicit `import js unsafe` values remain
the caller's responsibility because `any` has no checked result contract.

When a VelarScript module re-exports JavaScript-boundary values, consumers must
import those values by name. A namespace import or dynamic import of that module
is rejected because it would erase which fields carry boundary provenance. This
is a deliberate precision rule, not a restriction on ordinary VelarScript
modules or on a direct safe `import js` namespace.

Promise values whose checked result can contain `null`, an optional, or
`unknown` are adapted when they enter a VelarScript expression, not only when
they are awaited. The adapter is rejection-preserving and its cache is shared
by generated VelarScript modules, so the same Promise remains the same
VelarScript Promise even when it is exported, stored, compared, or passed
through `velar/async` before awaiting.

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

Declaration files and JavaScript files in installed npm packages are watched by
the development server. A declaration change performs a full safe reanalysis;
a runtime JavaScript change reloads the application.
