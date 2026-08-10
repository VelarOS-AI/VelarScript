# @velarscript/compiler

Compiler, formatter, diagnostics, semantic index, Core JavaScript lowering, and
the explicit compiler-extension host for VelarScript. It includes checked
static and dynamic `.vel` modules,
typed rest parameters, native Set collections, strict `match` blocks, the lightweight runtime type
model with first-class compiler-known `Type<T>` validator carriers, JSON-safe dynamic `Record<T>`, mapped string-backed enum singleton
types and discriminated record-union narrowing, synchronous and asynchronous expression arrows, multiline trailing commas,
uniform resolved-value contracts for asynchronous declarations,
static and runtime guards against JavaScript's callable-`then` Promise trap,
checked `async for` over explicit `next() -> Promise<T?>` pull sources,
unambiguous object-returning arrows and checked power precedence,
single-evaluation strict comparison chains,
bounded `///` declaration documentation in the semantic index,
native classes with one synchronous body-owned `constructor(...)`, explicitly
typed instance/static fields, typed read-only getters, and native private
fields/getters/methods.
JSX, components, reactivity, lifecycle, Look, Web types, and Web modules
are not enabled by Core; they are contributed by `@velarscript/web` through the
extension contract. That contract separates parsing, analysis, semantic
indexing, intrinsic typing, dependency/interface inspection, emission,
modules, lexical editor metadata, and contextual project-editor behavior, so a
framework cannot depend on an implicit Core Web mode. Core supplies the generic
project graph and semantic callbacks; an extension owns syntax-specific
completion contexts and protected-rename rules. The package requires Node.js 24 or later and ships
JavaScript plus TypeScript declarations; it does not depend on VelarOS
Workbench.

The compiler also owns the global identities for the optional reactive runtime
and the separate cross-extension runtime `Type` registry. Official extensions
import those ABI constants from `@velarscript/compiler/extension`; mutable,
accessor-backed, or structurally invalid pre-existing registries fail closed.
VelarScript packages can accept `Type<T>` and call `target.is(value)` or
`target.parse(value)` with generic result inference; the carrier survives module
aliases and namespace imports, while structurally forged validators and runtime
reflection of `Type<T>` itself are rejected.

The `@velarscript/compiler/framework-host` subpath defines the small, versioned
tooling ABI shared by framework packages and application hosts. It is a neutral
contract only: framework implementations remain separate package entrypoints.
The ABI covers generated application/error documents, deployment projection,
base paths, source-map policy, and browser-test discovery, while filesystem,
server, bundler, and browser-driver work stays outside the compiler.

Construction uses the familiar class-body `constructor(...)` form. Derived
constructors call `super(...)` first. `init` is an ordinary identifier, so
record/object fields and JavaScript-facing APIs may use that common member name.
`get` follows the same contextual rule: only the direct class-member form opens
a getter declaration, while ordinary bindings and property names remain valid.

Class members are public by default. `get name() -> Type:` exposes a native
read-only property without introducing setters or cached state. `private` is the one visibility modifier;
it stays in the declaring class's analyzer/semantic scope, is absent from the
published class interface, and lowers to native JavaScript `#` storage. There
is no `public`/`protected` hierarchy or separate privacy runtime.

```ts
import { compile } from "@velarscript/compiler"

const result = compile("const answer = 40 + 2\n")
```

`compile(source)` is Core-only. Tools opt into a framework deliberately:

```ts
import { compile } from "@velarscript/compiler"
import { velarCompilerExtension } from "@velarscript/web/compiler"

const result = compile(source, { extensions: [velarCompilerExtension] })
```
