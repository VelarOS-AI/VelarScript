# VelarScript module map

Status: current; the ruling is
[D115](../decisions/D115-AGENT-MAINTAINABLE-CODE-ORGANIZATION.md) §一.2 and §二,
and the wave that produced this document is its P4 **R6**.

This is the prose half of one map. The machine half is `module-map.json` at the
root of the repository, and `scripts/check-module-map.mjs` — `npm run
check:module-map`, inside `npm run check` — is what stops the two from becoming
a description of a repository that no longer exists.

Read it before you add a file. D115 §一.2 is 「路径即概念」: where a file sits
says what it manages, so a reader who has to change one concept knows which
directory to open *before* reading anything. That only holds while every
directory means one thing, and it stops holding the first time a directory
appears that nobody described.

## The four rules

**A directory is a concept, and it is declared.** Every directory under
`packages/<package>/src` that holds source has one line in `module-map.json`
and one row below, saying what it owns. Files that sit at
the *root* of a package's `src` are not enumerated: `cli` alone has 153 of them,
most one small concept each, and a roster of every leaf file would be a second
copy of `ls` that goes red on every rename. The package root is itself one
declared place, with one line saying what still lives there. A new directory is
a new concept, so it costs a line; if the concept already has a home, the files
go there instead.

**A facade never moves.** When a module is split, the original path stays and
re-exports every name that left it, so no import in the repository — and no
import in anything the repository publishes — has to change. That is D115 §四's
「门面不变」, and it is why `analyzer.ts`, `lexer.ts`, `formatter.ts`,
`semantic.ts`, `project.ts`, `language-server.ts`, `browser-test-runner.ts` and
a dozen others are still the paths everything imports after their contents moved
into the directories below. A split that changes an import path is not this
kind of split, and needs its own decision.

**Imports go one way.** A collaborator module imports within its own directory in
one direction, or from a module the directory shares (`analysis/scopes.ts`,
`project/scc.ts`, `typescript/bridge.ts`, `lsp/protocol.ts`), or from a lower
layer — the layer table in
[compiler-architecture.md](compiler-architecture.md) says which layer owns what,
and `scripts/check-runtime-boundary.mjs` holds that line between packages. **No
two modules import each other**, directly or through anything in between. Two
modules that import each other are one module with two file names, and a reader
who opens either has not bounded what they must read — which was the whole point
of splitting the file. When both sides need one name, the name moves down into a
module both of them import: D114's P4 R4b did it with `project/scc.ts` for
`diagnostics ↔ incremental`, and R6 did it with `desktop/window-kind.ts` for
`config ↔ manifest-migration`, the last cycle in the repository.

**A composition root is the one file allowed to be long.** Every source file is
capped at 800 lines and every function at 120 (D115 §一.1,
`scripts/check-file-budget.mjs`). D115's revision of 2026-09-06 exempts exactly
one shape from the *file* cap: a host class that holds its state fields, its
`protected` seams, its host constructors and its dispatchers — and no analysis,
parsing or emission logic. The reason is in D114's 「R1f 落地」: a host
constructor reads `private` state, so moving it out of the class is TS2341, and
the only way to move it is to widen the class's public face, which costs more
than the length does. The exemption is from the file cap and from nothing else:
the 120-line function cap still applies inside a root, and a function that
exceeds it there has to be named in `module-map.json` with its role
(`host-constructor` or `dispatcher`) — because whether a method is a dispatcher
is a judgment, not something an AST can be asked. Today every root's list is
empty.

## The map

Fifty-three directories, eight packages. One line each, and the same line is in
`module-map.json`.

### `packages/compiler`

At the root: entry points, composition roots and shared leaves — `index.ts` and
`extension.ts`, the `analyzer.ts` / `parser.ts` / `emitter.ts` composition roots,
the `lexer.ts` / `formatter.ts` / `semantic.ts` / `ast.ts` facades over the
directories below, the analyzer-to-emitter `contracts.ts`, and the concepts every
layer reads (source and tokens, diagnostics, limits, the runtime ABI and runtime
module names).

| Directory | Owns |
| --- | --- |
| `packages/compiler/src/analysis/` | The analyzer's collaborators that no narrower family owns: the scope stack, member and vocabulary tables, match coverage, returns, published members, retired imports, the advisory entry point and the lowering recorder. |
| `packages/compiler/src/analysis/advisories/` | One module per advisory family behind the A-roster: collections, queries, records, traps, tuples. |
| `packages/compiler/src/analysis/calls/` | Call analysis: argument checking, contextual and generic-call inference, named arguments, intrinsic dispatch, and inference seeding. |
| `packages/compiler/src/analysis/classes/` | Class analysis: the class registry, members, inheritance, and the `@dispose` / `@iterate` roles. |
| `packages/compiler/src/analysis/collections/` | List / Set / Map / Record analysis: members, operations, element inference, call typing, and retired spellings. |
| `packages/compiler/src/analysis/declarations/` | Declaration analysis: records, aliases, enums, generic parameters, and reference resolution. |
| `packages/compiler/src/analysis/expressions/` | Expression typing: assignability, assignment, binary and equality operators, contextual typing, identifiers, literals, projections, text, and the guidance those produce. |
| `packages/compiler/src/analysis/flow/` | Flow analysis: the fact store, narrowing, loops, branch merges, and the locations facts are keyed on. |
| `packages/compiler/src/analysis/modules/` | Module analysis: imports, exports, and initialization order. |
| `packages/compiler/src/analysis/modules/interfaces/` | The module-interface tables a project graph consumes: declarations, assembly, and the published tables. |
| `packages/compiler/src/analysis/statements/` | One module per statement family: variables, control, loops, functions, `extern`, and async results. |
| `packages/compiler/src/ast/` | The Core AST behind `ast.ts`: the statement and expression construct rosters, and the helpers that read a tree rather than describe one — the structural walk, what a statement declares or opens, the module's startup code, and the direct-await traversal. |
| `packages/compiler/src/ast/nodes/` | One module per node family — statements, expressions, written type syntax, patterns — over the base shapes and the two unions every family reads. |
| `packages/compiler/src/compile/` | The phases `index.ts` composes into one compile: the analysis pass, the context it reads and the result-type fixed point it settles. |
| `packages/compiler/src/emit/` | The JavaScript emitter's collaborators: statements, expressions, classes, matching, validators, type checks, runtime imports, helper names, and source maps. |
| `packages/compiler/src/format/` | `velar format`: token and line layout, inline decisions, strings, markup, types, and the option set. |
| `packages/compiler/src/lexer/` | The scanner's collaborators: tokens, identifiers, numbers, strings, comments, brackets, continuation, punctuation, embedded source, and bidi / control-character hygiene. |
| `packages/compiler/src/parser/` | Parser helpers every statement and expression family shares: token handling, patterns, and type syntax. |
| `packages/compiler/src/parser/expressions/` | Expression parsing by precedence layer: primary, postfix, operators. |
| `packages/compiler/src/parser/statements/` | Statement parsing by family: declarations, control flow, classes, modules. |
| `packages/compiler/src/semantic/` | The semantic index editors read: the indexer, symbols, references, declarations, documentation, and queries. |
| `packages/compiler/src/types/` | The `ValueType` model: assignability, bounds, display, construction from syntax, readonly, and generic unification. |

### `packages/core`

At the root: `index.ts` assembles the Standard surface out of `interfaces/`,
`standard-module-route.ts` maps a `velar/*` name to its route, and
`runtime-sources.generated.ts` carries the runtime JavaScript generated from
`runtime/`.

| Directory | Owns |
| --- | --- |
| `packages/core/src/interfaces/` | One module per `velar/*` Standard module's interface table, plus the shared `ValueType` constructors they are built with. |

### `packages/web`

At the root: the Web extension's entry points, composition roots and shared
leaves — `compiler.ts`, the `analyzer.ts` composition root, the `parser.ts` /
`emitter.ts` / `editor.ts` / `look.ts` facades over the directories below,
`semantic.ts` and `inspection.ts`, the Web AST, the element and CSS vocabularies,
the host, project config, documentation, and the generated runtime sources.

| Directory | Owns |
| --- | --- |
| `packages/web/src/analysis/` | Web analysis collaborators that no narrower family owns: routes, watch cycles, keyed rebuild, renderable checks, declarations, inference, program passes, public config, and the Look / JSX vocabulary and guidance tables. |
| `packages/web/src/analysis/calls/` | Web intrinsic call dispatch: which family a `velar/*` call belongs to. |
| `packages/web/src/analysis/calls/intrinsics/` | One module per browser module family whose calls have arms — config, forms, http, reactive, storage, web. |
| `packages/web/src/analysis/components/` | Component analysis: declarations, contracts, lifecycle, ownership, and the host face they ask of the root. |
| `packages/web/src/analysis/jsx/` | JSX analysis: elements, attributes, keys, security, and the host face they ask of the root. |
| `packages/web/src/analysis/look/` | Look analysis: entries, values, builders, tokens, conditions, edits, and the host face they ask of the root. |
| `packages/web/src/analysis/reactivity/` | Reactive analysis: bindings, derived names, retired accessors, and the host face they ask of the root. |
| `packages/web/src/editor/` | Editor completions for a Web project: the entry point, plus Look and JSX completion. |
| `packages/web/src/emit/` | The Web emitter's collaborators: components, JSX, Look, Look CSS, and runtime imports. |
| `packages/web/src/look/` | The Look vocabulary: properties, keywords and keyword sets, units, shorthands, media, animation, naming, builders, CSS functions, and tokens. |
| `packages/web/src/modules/` | One module per `velar/*` Web surface table, plus the shared `ValueType` constructors they are built with. |
| `packages/web/src/parser/` | Web parser helpers: spans, Look source, keyframes source. |
| `packages/web/src/parser/expressions/` | Web expression parsing: JSX, Look, keyframes, visual blocks. |
| `packages/web/src/parser/statements/` | Web statement parsing: component heads and bodies, reactive declarations, imports, unsafe CSS. |

### `packages/node`

At the root: `compiler.ts` and the ordered module policy, the `server-*` facades
over `analysis/`, route patterns / shapes / overlap, serve-call and serve-problem
analysis, the route-hint contracts, project config, and the generated runtime
sources.

| Directory | Owns |
| --- | --- |
| `packages/node/src/analysis/` | The server analyzer composition root and its collaborators: routes, handlers, composition, collisions, response shapes, OpenAPI. |
| `packages/node/src/analysis/calls/` | Node intrinsic call dispatch: which family a `velar/*` call belongs to. |
| `packages/node/src/analysis/calls/intrinsics/` | One module per Node module family whose calls have arms — today `serve`. |
| `packages/node/src/modules/` | One module per `velar/*` Node surface table, plus the shared `ValueType` constructors they are built with. |

### `packages/server`

The Server extension in six files — analyzer, compiler, entry point, project
config, runtime, and the generated runtime sources. The package is small enough
that no directory has earned a name.

### `packages/desktop`

At the root: the compiler and the application build, the host and the Node
runtime it launches, manifest config and its migration, the window kind both of
those read, signing, the package host, development services, the test runtime,
and the generated runtime sources.

| Directory | Owns |
| --- | --- |
| `packages/desktop/src/interfaces/` | One module per Desktop module's interface table — desktop, window, service, notification, secure storage, desktop-test — plus the shared `ValueType` constructors. |
| `packages/desktop/src/modules/` | The emitted runtime module source each Desktop surface is rendered from, closed over what the application's manifest declares. |

### `packages/cli`

At the root: the toolchain's leaf concepts, one small module each — package and
project identity, output claims and transactions, snapshots and fingerprints,
resolution and sandboxes, limits and budgets — plus the `cli.ts` dispatcher and
the `project.ts` / `language-server.ts` / `project-semantic.ts` /
`typescript-declarations.ts` / `browser-test-runner.ts` facades over the
directories below.

| Directory | Owns |
| --- | --- |
| `packages/cli/src/browser-test/` | `velar test` in a browser: discovery, entry, run, supervisor, worker, timings, and the entry point of the runtime API a test page is given. |
| `packages/cli/src/browser-test/runtime-api/` | One module per family of that runtime API — navigation, interaction, query, waiting, timings, storage, network, framework, and the shared context. |
| `packages/cli/src/build/` | The build writers, one per output shape: generic, framework, node, single-file, staging, compiled. |
| `packages/cli/src/commands/` | One module per `velar` command arm, plus the check / build / package prelude those three share. |
| `packages/cli/src/dev/` | `velar dev`: server state, HTTP, request handling, and source maps. |
| `packages/cli/src/lsp/` | The language server: one module per LSP capability, plus protocol, transport, session, positions, paths, kinds and documentation. |
| `packages/cli/src/project/` | The project compiler's phases: options, graph discovery, incremental state, entries, diagnostics, strongly connected components, and the records the phases pass to each other. |
| `packages/cli/src/project/interfaces/` | Module-interface identity, module resolution, and the analysis context the project graph builds for each module. |
| `packages/cli/src/semantic/` | The project-wide semantic queries behind `project-semantic.ts`: definition, references, rename, symbols, tokens, documentation, completion, signature, targets, members, enums, locations. |
| `packages/cli/src/typescript/` | The TypeScript declaration reader used for JavaScript interop: entry, graph, scanning, declarations, classes, parameters, types, signatures, package exports, and the bridge they share. |

### `packages/create`

`velar create` in five files — entry point, CLI, arguments, templates, types. The
package is small enough that no directory has earned a name.

## Composition roots, and what is left over

Three files under `packages/*/src` are over the 800-line cap, and all three are
composition roots: D115 P2's one remainder, `ast.ts`, became the `ast/` facade
and left the list. The lengths below are what they measured when R6 landed — the
number that is *enforced* lives in `file-budget-allowlist.json`, which may only
shrink, and this map and that allowlist are checked against each other so an
exemption cannot outlive its reason.

| File | Lines | Why |
| --- | --- | --- |
| `packages/compiler/src/analyzer.ts` | 3,167 | **Composition root.** State fields the `analysis/` collaborators read live, host constructors that cannot leave the class because they read `private` state (TS2341 — D114 「R1f 落地」), the `protected` seams the Web / Node / Desktop analyzers override, the statement and expression dispatchers, the public readers. No analysis logic. |
| `packages/compiler/src/emitter.ts` | 1,613 | **Composition root.** Emitter state the `emit/` collaborators read live, the host constructor that hands them their face, the `protected` seams the Web / Node / Desktop emitters override, the statement and expression dispatchers. |
| `packages/compiler/src/parser.ts` | 1,449 | **Composition root.** Parser state the `parser/` collaborators read live, the host constructor that hands them their face, the `protected` seams extensions override to add their own syntax, the statement and expression dispatchers. |

The **segment rule** is what replaces the line cap for a root, from D115's
revision of 2026-09-06: a root may hold state, `protected` seams, host
constructors and dispatchers, each of which is short on its own, and nothing
else. Its length is therefore the sum of many small things rather than a licence
for one large one, and the 120-line function cap is unchanged inside it. A
function in a root that goes over 120 lines must be listed in that root's
`segments` in `module-map.json`, with `"role": "host-constructor"` or
`"role": "dispatcher"` and a ceiling it may not exceed. All three lists are empty
today, which is the check reading "no logic came back".

## What the gate checks

`node scripts/check-module-map.mjs` reads `packages/*/src/**/*.ts` — from the
filesystem, so an orphaned module is still seen — parses each file with the
repository's own `typescript`, and answers five questions. It takes `--root`,
`--map` and `--allowlist` so that `tests/repo/check-module-map.test.ts` can point
it at trees with one planted violation each and watch every answer go red.

1. **Is every directory declared, and does every declared directory exist?**
   Both directions: a roster that may only gain lines stops describing anything.
2. **Does every file over the cap have a stated reason, and is that the same set
   `file-budget-allowlist.json` exempts?** The budget owns the number, the map
   owns the reason, and the two-way comparison is what keeps them together.
3. **Does any pair of modules in one package import each other?** Tarjan over
   the relative **value**-import graph — an `import type` is erased before
   anything runs and is not an edge, while an inline `{ type T }` inside an
   ordinary import is one, because `verbatimModuleSyntax` still emits that
   import. The rule is per package rather than per directory, because the last
   cycle in the repository sat at a package root and because a cycle that
   crosses `analysis/` and `emit/` is the worse one, not the excused one.
4. **Has a composition root grown a function over 120 lines that its `segments`
   do not name?** With the same two-way check: a named segment that has come
   back under the cap has to be removed from the list.
5. **Does this document still name every declared directory and every
   over-budget file?** D115 §二 asks the gate for 「缺行、多行、路径不存在都
   红」, and a `document` field pointing at a file the gate never opens would be
   a gate that checks nothing.

What it deliberately does not check is the other half of the two prose rules
above. That a moved name is still re-exported from its old path is what the
export roster each wave diffs against `dist` proves; that `analysis/` sits below
`emit/` is a judgment about what a layer means, which
[compiler-architecture.md](compiler-architecture.md) owns and
`scripts/check-runtime-boundary.mjs` enforces between packages. The half of the
direction rule that is a fact about a graph — no two modules reach each other —
is question 3, and it is exact.
