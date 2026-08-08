# D19–D24 language ergonomics batch (user mandate: strengthen proactively)

## D19 — two-slot for (spec confirmed with user)
Single-slot behavior UNCHANGED. `for a, b in x:` = two-slot iteration; `for [a, b] in x:`
stays element destructuring (zero grammar ambiguity). Both slots accept full binding
patterns (`for {id}, index in tasks:`; `for key, {name} in users:`).
List: item, index · Map: key, value · Set: value, index (JS insertion order) ·
string: char, index (code-point index). No three-slot form.

## D20 — range
Core function usable anywhere a List<number> iterable is expected in `for`:
`range(end)`, `range(start, end)`, `range(start, end, step)` — half-open like Python,
step != 0 checked, negative steps count down. Implementation choice free: a lazy
core iterable the for-loop lowers efficiently (preferred — no materialized List for
`range(1000000)`) or a bounded List builder; report which and why. Works with D19:
`for i in range(3):`. Named args per signature.

## D21 — collection constructors with contents
`Set(values: List<T>)` — from a checked dense List. `Map(entries)` where entries is
`List` of two-item Lists `[key, value]` (validated shape), AND `Map(record)` for
Map<string, V> from a record literal (own enumerable string fields, the shape blind
writers reached for). `List` needs no constructor (literals exist). Empty-call forms
unchanged. Update the `{}`-vs-Map guidance to point at `Map({...})` now that it exists.

## D22 — List aggregation + key-function sort
On `List<number>`: `.sum() -> number`; on `List<T>` where T ordered (number|string):
`.min() -> T?`, `.max() -> T?` (null for empty). `.sorted(...)` gains a `by` named
alternative: `sorted(by = item => key)` with key number|string, mutually exclusive
with the comparator parameter (diagnostic if both). All through the checked collection
machinery (bounded, snapshot semantics like other callbacks, named-arg contracts,
first-class bindable).

## D23 — string membership `in`
`"ad" in title` = substring test, same evaluation-order contract as collection
membership, lowers через the controlled helper family. Symmetric with D17's .has().

## D24 — multiline strings (SUPERSEDED BY THE POST-D18 USER CLEAN-BREAK)
The initial backtick design landed during L2, then the user removed the separate
delimiter family before the next major stage. Inline quotes remain line-bounded;
a quote followed immediately by a newline enters an indentation-bounded layout
string whose missing close recovers at dedent. `f` selects interpolation, `r`
selects literal backslashes, and `rf` is the sole combined prefix. Backticks and
triple quotes are legacy input only and always diagnose with guidance to quoted
layout strings; `fr` likewise guides to canonical `rf`.

## Guidance addition
`map.get(key, fallback)` two-arg call → directive: "Use get(key) ?? fallback".

## Deliberate exclusions (record in CHANGELOG rationale or leave to ledger)
match-expression (charter-explicit statement design), truthiness conditions,
List `+` concat (spread is the one spelling), async iteration (deferred with
evidence), labeled break, for-else.

## Batching for execution (after memo/batch agent lands — tests-file contention)
L1: D17 (see D17-METHOD-STYLE.md) + D22 + D23 + get-default guidance.
L2: D19 + D20 + D21 + D24.
Each batch: parser/analyzer/emitter/formatter as needed + charter §7/§8/§9/§3 updates
+ standard-library.md + CHANGELOG + tests (incl. execution tests) + full gates
(npm run build:packages, compiler tests, npm run check, npm test) + Lite adoption
where it simplifies real code (separate Lite commit, ledger note).
