# VelarScript Core AI skill brief

Read this brief before writing VelarScript. It explains how to choose among the
language's capabilities, including decisions the compiler cannot infer from
local syntax. `velar skill core` prints this file verbatim. Projects also load
the `web`, `node`, `server`, or `desktop` brief required by their manifest.

Run `velar skill core topics` to discover the installed, version-matched Core
reference. Read the relevant topic before inventing syntax, adding a helper,
or deciding that an API is missing. For example, `velar skill core collections`
prints collection contracts and `velar skill core types` prints data modeling,
generics, optional values, and readonly rules. These references work offline.

## Capability map

Choose a feature because it expresses the task's meaning. A shorter expression
that hides state changes, ordering, ownership, or field meanings is a worse
result. A feature does not need to occur in every project to be useful.

| Task | Core capability and decision | Reference topic |
| --- | --- | --- |
| Write ordinary computation | `const` for a fixed binding, `let` for reassignment; `def` for functions; indentation for suites, `//` for comments, `///` for declaration documentation | syntax |
| Select or compose values | `condition ? value : fallback`, `??`, optional member/index/call access, `minimum <= value < maximum`, `and`/`or`/`not`, `in`/`not in` | syntax |
| Produce text | `f"{value}"` for interpolation; layout strings for indented multiline text; `str` for primitive text, `Json.stringify` for data, `print` for inspection | syntax, api |
| Name a data contract | `type Name:` for fields; a type alias for an existing contract; single record inheritance for shared fields; use field names for multiple business results | types |
| Describe finite states | enum members, optional values, and record unions with an enum-member discriminator; map enum members to external wire strings or safe integers when needed | types, control |
| Protect writes | `readonly type` for all record slots, a field modifier for selected slots, `readonly List<T>` for list structure; each nested type retains its own permissions | types |
| Reuse a typed algorithm or shape | Generic functions, records, and classes; constraints describe required capabilities; calls infer type arguments from their arguments/context | types, functions, classes |
| Define a clear call | Parameter names, defaults, named arguments, function types, arrow functions, and explicit return types at public boundaries; source argument order owns evaluation order | functions |
| Read or transform collections | `map`, `filter`, `flatMap`, `find`, `some`, `every`, `sum`, `min`, `max`, `sorted`, `groupBy`, `keyBy`, `countBy`, `partition`, `zip`, `chunk`, `unique`, `compact`, `flatten` | collections |
| Build or adapt a collection | Typed empty List/Map/Set, compiler-owned conversions, `.copy()`, spread, record/list destructuring; Pair supplies named `first`/`second` results from zip | collections |
| Perform ordered work | `for`, optional second loop binding, `while`, `break` and `continue`; preserve explicit loops for mutation, multiple outputs, or state carried between items | control |
| Classify or unpack input | Exhaustive `match`, enum/type/record/List patterns, alternatives, guards and `as`; `case _: pass` explicitly handles a remaining no-op case | control |
| Validate a boundary | `is`/`Type.is` for shape checks, `Type.parse` for checked data copies, `Type.from` for a shallow projection of typed data, semantic validation for domain rules | types, validation |
| Represent absence or failure | `T?`, explicit presence checks, `??`, `try expression` for an expected recoverable failure, typed `catch` when the error matters, assertions for invariants | control |
| Own behavior and resources | Classes with explicit constructors, implicit `self`, methods/getters, inheritance and overrides; `using` and `@dispose` for scope-owned resources | classes, control |
| Own asynchronous work | `async def`, `await`, `detach`, Promise combinators, duration values such as `250ms`, `async for` for checked pull contracts | functions, control, api |
| Organize and cross boundaries | Named imports/re-exports, module `@main`, literal dynamic imports, checked JSON imports, one `extern module` adapter per foreign contract; validated `unknown` for unsafe entry | modules |
| Verify the program | `test "description":`, assertions and `velar/test` expectations; compiler checks, formatter, and the project's affected tests | modules, api |

For the standard's promises and limits, read `velar skill core contract`.
The map above is an index; the topic reference supplies exact spellings,
signatures, evaluation behavior, failures, and examples.

### A few choices that prevent indirect code

- Return a named record when results have distinct meanings. Four numbers such
  as gridX, gridZ, amountX and amountZ are a shape, not a numeric sequence whose
  positions a caller should memorize. Use List for sequence operations and
  Pair for generic two-item pairing.
- Use enum-based unions for state-dependent fields instead of one record full
  of unrelated nullable fields or open strings checked throughout the program.
- Use a target record's `.from(source, {overrides})` when it expresses an exact
  typed projection. A handwritten literal is appropriate when it combines
  different sources or has meaningful evaluation order.
- Use collection queries for a complete stateless operation. Do not force a
  stateful loop into `reduce` or split one ordered pass into unrelated pipelines.
- Check the library before writing conversion, grouping, counting, lazy Map
  initialization, validation, numeric-boundary, or resource-cleanup helpers.
- A public API's field names, optionality, mutation, errors, and ownership are
  part of its contract. Do not hide those decisions behind convenience wrappers.

## Working contract

1. Before a project-wide change, run `velar graph`; narrow large graphs with
   `velar graph --focus <symbol> --depth 2`. Treat this compiler-owned graph as
   the source of module, call, state, derivation, ownership, and capability
   relationships.
2. Make the smallest change that preserves those boundaries.
3. Run `velar fix`, then `velar check`. The compiler owns syntax migration and
   locally provable canonical forms, so follow its diagnostics instead of
   copying correction rules into prompts. Resolve every advisory too, or keep
   the intentional spelling with `// velar-allow <CODE>: <reason>`.
4. Run the affected tests and `velar format`. Use the repository's broader
   gates when the change crosses packages, targets, generated artifacts, or
   public contracts.

## Ownership and environment

Core owns target-neutral computation. Web, Node, Server, and Desktop extensions
own their host syntax, modules, manifest keys, and runtime capabilities. Do not
move a host operation into Core or recreate an extension API in application
code. Load only the briefs for the project's declared owners.

Use the permanent namespaces for their established Core operations and named
imports for chosen toolboxes and external-resource capabilities. Core ownership
and a permanent name do not promise purity: random values, task scheduling and
diagnostic output have observable behavior. Judge effects by the operation's
contract. Keep project-specific codecs, storage, protocols, and algorithms in
project-owned modules or dependencies. Use the installed reference and compiler
completion for the current API surface.

Let the toolchain create projects and manifests. `velar create` chooses the
owner and writes the gates. A declared `surfaces` map is an exact compatibility
receipt, not a version range: copy its values from `velar --version`, and update
them only after reviewing the named surface changes. A Core library declares
the Core target and publishes its `.vel` source with the frozen artifact made by
`velar build-library`; host-specific targets remain exact.

## Semantics the compiler cannot infer for you

### Silent alternate meanings

- `//` always starts a comment. The compiler can recognize arithmetic-looking
  comment text, but `const ratio = total // divisor` silently binds `total`
  because `divisor` looks like prose. Floor division is
  `(total / divisor).floor()`.
- Collection `==` compares identity. Use `equals(left, right)` for deep data
  equality. This matters most when both operands are bindings, where no literal
  gives the compiler evidence that content comparison was intended.
- `Type.parse(value)` validates untrusted data and returns a copy. Later writes
  to the input and parsed result do not meet again, except at deliberately
  opaque positions such as `unknown` fields and class instances.

### Collections and evaluation

Use collection APIs when they express the whole stateless operation:
`filter`, `map`, `flatMap`, `some`, `every`, `find`, `sum`, `min`, `max`, or a
pure `reduce` with an explicit initial value. When the answer is a different
collection, the member says so: `groupBy`, `keyBy`, `countBy`, `partition`,
`chunk`, `zip`, `unique`, `compact`, `flatten`, `repeat`, `min(by=)`,
`max(by=)`, and `sorted(by=, descending=)`. Keep an explicit `for` when work
mutates state, has custom exits, writes multiple outputs, depends on ordered
effects, or carries state between items. The compiler corrects the narrow forms
it can prove; this rule covers larger designs it cannot prove locally.

List callback operations read a stable checked snapshot. A `for` loop observes
the List's live length, so appending during iteration extends that loop. Choose
between them deliberately; do not refactor a mutating loop into a callback
pipeline merely because the result looks similar.

For Maps, use `getOrSet` for a cheap missing value and `getOrSetWith` when
creation must be lazy. Use a pull iterator when only the first entry is needed;
copying `keys()` or `values()` is appropriate only when a stable List snapshot
is actually required.

NaN is a valid `number`, and equality follows SameValueZero, so `NaN == NaN`.
Operations that promise ordering or an aggregate answer reject NaN rather than
silently ordering it: `Math.min`, `Math.max`, `Math.clamp`, collection sorting,
`min`, `max`, and `sum`. Filter or reject NaN before those operations when input
is not already constrained.

### Data and boundaries

Model finite application states as enums and stable shapes as named records.
Validate `unknown` once at the boundary with `Type.parse`, then keep the inside
typed. Use `Type.from` for a shallow, target-owned projection from one already
typed record; surplus source fields never enter the result.

JSON resources and unsafe JavaScript imports produce `unknown`. Do not spread
validation across consumers: adapt and validate in the module that owns the
boundary, then export a checked application type.

Use `Type.parse` alone for structural shape. When already typed data also has
domain constraints—integer ranges, non-blank identifiers, cross-field rules,
or bounded collections—compose them with `velar/validation` in the module that
owns those constraints. Reuse that validator at construction and parsing
boundaries instead of repeating assertions in configuration loaders.

An `extern module` is the preferred boundary for a third-party package with a
contract. Declare it once in an adapter module and export an application-owned
surface. Use `import js unsafe` only when there is no honest contract to write;
validate its `unknown` result before typed code reads it.

Extern arguments cross by raw identity and are read-only from VelarScript's
point of view. If foreign code mutates one, VelarScript reactivity does not see
that write. Prefer a foreign operation that returns new data, then assign the
result on the VelarScript side.

### Ownership, effects, and failures

Place a resource's `using` binding in the scope that truly owns its lifetime.
`@dispose:` is cleanup, not an ordinary method: scope exit runs it in reverse
ownership order. Return data read from an owned handle, not the handle itself.
For a foreign handle, wrap it in an application class whose `@dispose:` releases
it.

Await work whose result or completion matters. Detach only genuinely
independent work whose failure has an owner. Prefer optionals for expected
absence, typed errors for failures callers distinguish, and assertions for
broken invariants. Validate external data before side effects so a rejected
value cannot leave partial state behind.

Deep reactive state observes VelarScript-owned field and collection mutations.
Mutate that state directly when identity should survive; rebuild a value only
when replacement itself is the intended event. Calls, getters, awaits, and
foreign mutations are semantic boundaries—do not assume a previous narrowing
or derived value stays valid across them unless the compiler proves it.

## When the language surface is insufficient

Use this order:

1. Look for a checked standard or installed-package contract.
2. Add one project-owned adapter with an `extern module` contract.
3. If no contract is possible, isolate `import js unsafe`, validate immediately,
   and keep `unknown` from escaping the adapter.
4. If the compiler itself blocks a valid design, reproduce and report it rather
   than distributing a workaround.

`velar build --mode readable --source-maps` is the inspection exit when emitted
JavaScript must be understood. Ordinary builds should retain the project's
production mode.

## Compiler defects

For a diagnostic that cannot be satisfied, incorrect emitted behavior, or a
check that contradicts the installed surface:

1. Run `velar repro`. It writes a local, self-contained reproduction and uploads
   nothing.
2. Complete the generated README sections **What I wrote (or wanted to write)**
   and **How I resolved it**. Use `blocked` when there is no workaround. Keep
   **What the compiler said** verbatim.
3. File it with the repository's `.github/ISSUE_TEMPLATE/` defect template.

For language detail not decided here, inspect the compiling tour under
`examples/tour/` or the relevant owner documentation. The installed compiler is
authoritative when this brief and the current toolchain differ.

## Readonly ownership

`readonly` protects one layer. `readonly List<State>` protects list slots and
keeps mutable State values; `List<readonly State>` protects State slots and
keeps a mutable list. Declare `readonly type State:` when every State field
slot is readonly and use State directly. A readonly field prevents replacing
that field and preserves the value's own type. Apply qualifiers to nested
collections explicitly when their contents must not be replaced. Follow A20
and A21 for equivalent declaration and qualifier simplifications.
