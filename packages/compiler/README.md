# @velarscript/compiler

Compiler, formatter, diagnostics, semantic index, and Core/Web JavaScript
lowering for VelarScript. It includes checked static and dynamic `.vel` modules,
typed rest parameters, native Set collections, strict `match` blocks, the lightweight runtime type
model, synchronous and asynchronous expression arrows, multiline trailing commas,
uniform resolved-value contracts for asynchronous declarations,
unambiguous object-returning arrows and checked power precedence,
single-evaluation strict comparison chains,
bounded `///` declaration documentation in the semantic index,
native classes with constructor, explicitly typed instance/static body fields,
typed read-only getters, native private fields/getters/methods, and one synchronous `init:` construction block,
native JSX, and the typed Web-module surface. The package requires Node.js 24 or later and ships
JavaScript plus TypeScript declarations; it does not depend on VelarOS
Workbench.

`init` is a contextual class-body word, not a globally reserved identifier, so
record/object fields and JavaScript-facing APIs may continue to use that common
member name.
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
