# VelarScript Core AI skill brief

Use this brief for decisions the compiler cannot reliably make from local
syntax. `velar skill core` prints this file verbatim. Projects may add the
separate `web`, `node`, `server`, or `desktop` brief named by their `AGENTS.md`.

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

What a program can compute needs no import; what reaches outside the program
must cross an explicit imported capability. Keep project-specific codecs,
storage, protocols, and algorithms in project-owned modules or dependencies.
Use compiler completion and the installed package contracts for the current API
surface instead of keeping an API inventory here.

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
