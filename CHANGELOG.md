# Changelog

This file records user-visible language, framework, and tooling changes. It is
not a milestone checklist; the repository test suites and CI are the source of
truth for acceptance status.

## 0.10.0-dev — VelarOS-Lite S2 batch: re-exports, bridged-dependency sandboxes, extern default contract

Language and compiler changes:

- Named re-exports: `export {name, other as alias} from "./module.vel"` (also
  from package sources and standard modules) re-exports without creating local
  bindings. Re-exported names join the module interface under their aliases
  with the origin contract; live-export (`export let`) mutability and reactive
  kinds propagate, and the statement lowers to a native ES-module
  `export ... from`. Go-to-definition follows re-export chains to the origin
  declaration. Namespace re-export (`export * from`) is rejected with VEL2029
  guidance toward the named form, and a re-exported name that collides with
  another export of the same module is rejected with VEL3016.
- The extern default-export contract is documented and pinned by tests:
  `export class default:` and `export const default: T` declare a
  default-export-only package, and the bare `import js Name from "pkg"` form is
  the canonical default import (see javascript-bridge.md).

Tooling changes:

- `velar test` and `velar run` now compile into `<project>/.velar/test-*` and
  `<project>/.velar/run-*` sandboxes instead of the system temporary
  directory, so Node's upward `node_modules` walk keeps resolving the
  project's real npm dependencies for bridged `import js` packages. The
  sandbox is removed after each run and `.velar/` is gitignored by the
  project templates; TMPDIR workarounds are no longer needed.
- When a module declares a manual `extern module "pkg"`, the automatic
  TypeScript-declaration probe no longer runs for that module's imports of
  that source, so it emits no notices that second-guess the manual contract.

## 0.10.0-dev — Blind-usability batch 3: chains, string functions, Look tightening

Language and compiler changes:

- Leading-dot continuation: a line whose first token is `.` or `?.` continues
  the previous logical line, so method chains can span physical lines in the
  standard formatted style. Trailing-dot continuation stays unsupported, and a
  leading `.` not followed by a member name (such as `.5`) never joins lines.
  The formatter normalizes continuation lines to one level past the statement
  they continue and never reflows existing single-line chains.
- `velar/text` gains the string measurement and access trio: `length(value)`
  (code-point count), `char(value, index)` (code point at an index, negative
  from the end like `List.get`, `null` out of range), and
  `slice(value, start = 0, end = length)` (code-point slice with `List.slice`
  position semantics). Strings expose no members: `value.length`,
  `value.size`, `value.slice(...)`, `value.substring(...)`, `value.charAt(...)`,
  `value.at(...)`, and `value[index]` now report directive guidance to the
  matching `velar/text` function.
- Look rejects multi-token shorthand strings on properties with a checked
  builder equivalent — the spacing family (`margin*`, `padding*`, `inset`,
  plus `borderRadius`/`borderWidth`), the border family (`border`,
  `borderTop/Right/Bottom/Left`, `outline`), `boxShadow`, and `transition` —
  with guidance that computes the builder call where the string decomposes
  cleanly (`Use 'spacing(8px, 12px)'`, `Use 'border(1px, color("#d9dce1"))'`).
  Single-token keyword strings, hex color strings, and out-of-family strings
  such as `fontFamily` stacks stay accepted. `flex` now accepts numbers.

Diagnostic guidance changes:

- A `#` that begins a line is guided to `//` comments and the commented text
  is skipped without an error cascade; bare hex colors keep their quoted-string
  guidance.
- A bare (unbraced) `for name in expr:` written directly as JSX content
  receives the same `.map(...)` guidance as its braced spelling.
- Assignment written inside an expression (an interpolated fragment or an
  arrow body) reports "Assignment is a statement" guidance and recovers, so
  the rest of the module still co-reports its own diagnostics. When an event
  attribute's arrow assigns a state binding from an event field, the Web
  extension additionally guides to `bind:value={binding}`.
- Kebab-case Look properties and multi-value shorthand now recover as their
  guided spelling, so camelCase guidance, builder guidance, JSX attribute
  guidance (`on:` directives, `bind:value`), and semantic diagnostics surface
  together in one compile instead of gating each other.
- A Look hook written as a target (`@hover:` as a block) is guided to the
  `if @hover:` condition form.

## 0.10.0-dev — Minimal generics for def functions

Language and compiler changes:

- `def` functions — top-level, exported, extern, and class methods — can
  declare type parameters: `def first<T>(items: List<T>) -> T?`. Type
  arguments are inferred at each call site; there is no explicit instantiation
  syntax. Callback arrows are checked against the bindings solved from fixed
  arguments, and their results solve the remaining parameters. An unsolved
  parameter becomes `unknown`.
- Type parameters are usable in parameter annotations, result annotations, and
  value annotations inside the function body. A generic function is an
  ordinary value: calls through bindings infer per call site, and assigning
  one to a concrete function contract instantiates it against that contract.
- Type parameters are erased at runtime: `is T`, `case T`, and any type
  containing a parameter in a runtime-checked position are rejected with
  VEL4022. Duplicate or type-shadowing parameters and a nested `def` reusing an
  enclosing function's parameter are rejected with VEL4021.
- Generic `type`, `class`, and `component` declarations, bounds, and variance
  are out of scope for this version and report a targeted diagnostic.

## 0.10.0-dev — Remove host-origin tracking and call-effect invalidation

Language and compiler changes:

- Narrowed facts now persist across ordinary calls, `await`, string
  interpolation, getter reads, and spreads. A fact is invalidated only by an
  assignment to its location and by merging branches where such an assignment
  can reach that location.
- Host-origin propagation — result origins, storage-origin effects, constructor
  origins, and contains-external instance marks — is removed from the language
  and from module contracts.
- Live `export let` imports now narrow like ordinary bindings.
- Runtime guards are unchanged: bounded collection helpers, record validators,
  and `undefined`-to-`null` normalization stay active.
- Module contract identities changed, so the first build after this change
  performs a one-time full project re-analysis.

## 0.10.0-dev — Clarity Reset

Breaking language changes:

- Named arguments use `name=value`; `null` is the only ordinary empty value.
- Classes use body fields and one explicit `constructor(...)` declaration.
- Optional chaining follows JavaScript one hop at a time.
- `List`, `Set`, and `Map` expose one small, consistent API without legacy
  aliases.
- `match` supports literals, enum members, type patterns, bindings, and guards.
- JSX branching uses ordinary expressions and control flow.
- Look uses CSS property names, explicit string values, named arguments, and
  explicit `before look` / `after look` unsafe CSS ordering.

Compiler and framework changes:

- Types now have a structured syntax tree and stable semantic identity.
- Mutable collections and writable structures are invariant.
- Reactive reference state cannot silently escape through aliases, nested
  mutation, component props, ordinary calls, or returns; copy and reassign is
  the explicit update model.
- Web JSX and Look participate in the Core lexical stream through the Web
  extension instead of being captured as opaque source blocks.
- JavaScript generation uses structured nodes with nested source-map positions.
- Actions retain observable pending/error state while preserving normal Promise
  rejection semantics.
- Assignments check the declared location type, invalidate stale optional facts,
  and lower as true JavaScript assignment targets without read-side null
  normalization.
- Short-circuit conditions and `while` bodies share optional narrowing, while
  complete source spans keep nested lowering hints from colliding.
- Mutually exclusive branches, `match` cases, terminating loops, and
  unreachable tails now merge flow facts by reachable path. Match guards narrow
  their body, and ordinary calls invalidate mutable or aliased facts unless the
  checked value was first saved in a local `const`. Getter and safe-JavaScript
  property reads, plus resumed code after `await`, follow the same effect
  boundary.
- Continuing branches now retain facts established on every path;
  `try`/`catch`/`finally`, match guard fallthrough, aliased member writes,
  JavaScript setters, object f-string coercion, and component JSX evaluation all
  follow emitted execution order instead of sharing or guessing flow state.
- Safe-JavaScript class checks now treat `Symbol.hasInstance` as an effectful
  host hook, while local VelarScript `is` checks remain inert.
- Module interfaces now preserve `export let` liveness separately from local
  assignment permission. Named live imports lose stale facts at effect
  boundaries, while namespace imports with live exports fail explicitly and
  all namespace fields remain read-only.
- Named calls now retain native callee-first evaluation, member receivers, and
  optional-call short-circuiting while still evaluating argument expressions
  once in source order before arranging them in declaration order.
- Membership expressions now evaluate their candidate before their collection,
  using a source-shaped controlled helper signature instead of reversing the
  operands during lowering.
- Plain member assignment no longer invents a getter read before its right-hand
  expression; host setter effects occur afterward, while compound assignment
  still models its required old-value read first.
- Assertion messages are checked only on the failing path with rejected
  condition facts; their effects no longer erase facts on the successful path.
- `List.reduce(callback, initial)` analysis now follows runtime argument order
  without losing contextual typing for an effect-free literal arrow callback.
- Optional indexes and calls now expose successful-chain facts to their deferred
  expressions, optional index calls continue safely, and optional function
  annotations contextually type assigned arrows.
- Comparison chains now carry successful-link facts into later operands and
  into bodies controlled by the complete truthy chain.
- Optional collection annotations now contextually type empty List, Set, and
  Map values, including transparent collection aliases.
- Null-coalescing fallbacks now receive the expected or present-value context,
  retain null-path flow facts, and preserve arrow operands in emitted JavaScript.
- Match success and fallthrough now narrow the original stable identifier or
  data field through guards, later cases, and else; effects invalidate stale
  facts.
- List and call spreads now validate dense Lists without invoking instance
  iterators, async List spreads preserve order, and call spread targets only a
  declared rest parameter.
- Record construction now defines controlled own data fields, makes
  `__proto__` an ordinary name, rejects accessor and symbol spreads, normalizes
  unsafe `undefined`, and preserves explicit async evaluation.
- Safe JavaScript records and Lists now retain host-origin metadata through
  declared results and type composition, so reads, reflection, destructuring,
  iteration, spread, and structural matching invalidate stale flow facts.
- Set and Map now carry the same container-level host provenance as List;
  Proxy-sensitive size reads and iteration are effect boundaries, while copy
  construction creates an owned container and retains element provenance.
- Runtime `Type.parse`, `is`, and type-pattern checks now preserve host origin
  when they validate an unchecked value; safe-JavaScript class instances carry
  the same non-display provenance through constructors and method results.
- Cyclic module fixed points now include non-display host-origin metadata in
  their analysis identity without changing visible type equality.
- Explicit variable annotations and mutable rebinding now preserve the current
  value's host origin instead of silently turning an external reference local.
- Declared assignment contracts, current storage provenance, and flow-narrowed
  read types are now separate binding states. Reachable branches merge storage
  provenance symmetrically, including assignments through a narrowed binding,
  so analysis no longer depends on branch order.
- VelarScript functions, async functions, expression arrows, getters, and class
  methods now preserve host origin through returns. Callable contracts retain
  non-display parameter-to-result relationships, including named and rest
  arguments, so one identity helper remains local for local inputs and external
  only for external inputs. Analyzed class member contracts now cross module
  boundaries instead of being rebuilt from source annotations.
- Contextually typed List literals now retain host origin in their element
  types while the newly allocated List itself remains owned.
- Local class construction now distinguishes a host object from a locally
  allocated instance that contains host-origin references. Constructor field
  initializers, parameter assignments, named calls, default values, `super`
  forwarding, hoisted calls, methods returning `self`, runtime checks, and
  module interfaces preserve that distinction without making unrelated
  primitive fields effectful.
- Post-construction field, index, and collection-mutator writes now retain
  contained host origin for local records, classes, Lists, Sets, and Maps.
  Flow-scoped reference identities propagate that state through direct and
  conditional aliases, narrowed bindings, identity functions, and methods
  returning `self`, while a fresh rebind separates the previous object.
- Functions and methods now publish composable storage-origin effects for
  parameter, rest, receiver, default, and captured-value writes. Forwarding,
  named calls, declaration-before-use, inherited mutating getters, module
  boundaries, and conservative safe-JavaScript argument mutation preserve the
  same provenance contract.
- Callable and constructor default provenance is applied only when that
  parameter is omitted; an explicit owned argument is not contaminated by an
  external default it replaces.

Tooling and documentation changes:

- The formatter is syntax-aware and idempotent across Core, JSX, and Look.
- The language server diagnoses and repairs common JavaScript and Python
  spellings directly.
- README, reference documents, templates, real applications, and the
  VelarScript website use the same 0.10 contract.
- CI extracts and compiles documentation and website examples.

## 0.1 through 0.9 — Pre-release development

These development lines established the compiler, CLI, standard modules, Web
framework, package boundary, browser tests, Workbench integration contract, and
static deployment pipeline. Their experimental syntax is superseded by 0.10
and is intentionally not retained as compatibility surface. Detailed history
remains available in Git.
