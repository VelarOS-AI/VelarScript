# VelarScript Core Agent Guide

This file governs the repository unless a closer `AGENTS.md` narrows the target.

- Treat `packages/compiler` as the language authority. Core owns syntax, types,
  diagnostics, formatting, target-neutral lowering, and Runtime Type behavior.
- Keep `@` single-purpose: it attaches compile-time metadata to the following
  declaration or structural entry. Do not add unrelated runtime invocation or
  database semantics.
- Reserve `velar/*` for language semantics and target capabilities shipped by
  the matching official owner. Project libraries use installed package names,
  `velar.entry`, or project-relative modules. Official non-standard experiments
  use the separate public `@velarscript-labs/*` npm scope.
- Every package owned by this repository lives under `packages/*` and must
  implement the language, official target frameworks, or their required
  tooling. Database models, drivers, codecs, domain algorithms, and deployment
  providers belong to consuming projects; usefulness to VelarScript
  applications is not repository ownership.
- A language change requires parser/analyzer/emitter/formatter/diagnostic and
  round-trip coverage as applicable. A runtime change requires emitted-output
  and execution coverage.
- Preserve unrelated work. Run the narrowest relevant checks first, then the
  repository gates appropriate to the changed boundary.

## Python / JavaScript reflex and canonical-form table

Vel's parents are JavaScript and Python. These reflexes land in Vel source as
something else. `A1`–`A6` are **advisories** for those traps; `A7`–`A9` are
canonical-form advisories, raised only when the compiler can prove the longer
collection or record spelling has one language-owned replacement. The compiler
reports all nine and still emits. The rest are already errors whose message
names the successor.

| Reflex | Write instead | Channel |
| --- | --- | --- |
| `a // b` floor division | `(a / b).floor()` — `//` opens a comment, so `const c = a // b` binds `a` | `A1` |
| `for i, v in nums:` | `for v, i in nums:` — the two-slot `for` gives `value, index`, as JS `forEach` does and Python `enumerate` does not | `A2` |
| `-7 % 3` expecting `2` | Vel's `%` is JavaScript's and yields `-1`; Python's non-negative modulo is `((a % b) + b) % b` | `A3` |
| `items = items.map(item => { ...item, done: true })` over a keyed list | `items[index].done = true` — a rebuilt record is a new value, so the keyed list stops recognising its rows and destroys and rebuilds all of them, and an input being typed into loses focus (Web target only; the advisory that most needs a reasoned suppression, because `readonly` rows or one API response leave `map` as the only spelling) | `A4` |
| `"${value}"`, `` `${value}` `` | `f"{value}"` or `` f`{value}` `` — only the `f` prefix interpolates, and `${...}` is legal literal text everywhere else (generating JavaScript source is a real use, and answers with `velar-allow A5`) | `A5` |
| `f"${value}"` | `f"{value}"` — even under the `f` prefix, `$` keeps the brace after it literal, so `${value}` stays text | `A6` |
| Empty collection + identity-only copy loop | Initialize from the compiler-owned conversion: `set.values()`, `Set(list)`, `map.keys()` / `map.values()`, `Map(record)`, or the matching `.copy()`; transforms, filters, effects, non-empty destinations, computed sources, and non-adjacent loops do not trigger | `A7` |
| `for item in items: if test: return true` followed by `return false` | `return items.some(item => test)` — only the exact single-slot, pure-boolean, early-return query over a List triggers; calls, getters, effects, optional conditions, wider bodies, computed sources, and non-adjacent returns do not | `A8` |
| A closed target literal mirrors two or more same-name fields from one typed record | `Target.from(source, {overrides})` — target fields are the authority; computed/effectful overrides, partial targets, spreads, and mixed sources do not trigger. `.from` uses target declaration order, so preserve an intentional authored wire order with a reasoned suppression | `A9` |
| `enumerate(xs)` | `for value, index in xs:` | error |
| `with X as y:` | `using y = X` | error |
| `raise E(...)` | `throw E(...)` | error |
| `def m(self)` | `self` is implicit; never declare it as a parameter | error |
| `# comment` | `// comment`; `///` documents the following declaration | error |
| `if value:` truthiness | conditions take `bool`/`bool?` only — `if value != null:` | error |

The charter states each rule; [docs/ai-skill.md](docs/ai-skill.md) carries the
long tail.

- **Work with an unresolved advisory is not complete.** Resolve every advisory
  `velar check` prints, one of exactly two ways: change the spelling it names,
  or write `// velar-allow <CODE>: <reason>` on that line saying why the code
  is right as written. A reason that restates the advisory is not a reason.
- A suppression must name one advisory id and carry a non-empty reason, and it
  must still apply; a bare, blanket, or stale `velar-allow` is a compile error.
  Advisories never fail a build, `velar check`, CI, or a release — the rule
  above is what enforces them, not the exit code.

## Three shapes review keeps finding

An audit filed 269 defects against this repository and confirmed 205. These
three shapes account for a large share of them — and for most of what the fix
waves themselves got wrong on the first pass. Check for each before calling a
change done.

- **One concept, two definitions.** The runtime classified a watch that writes
  through a helper as a writer and the compile-time check did not, so the rule
  it enforced was defeated by extracting a function. `->` lexes as `arrow` and
  `=>` as `fatArrow`. Four line models disagreed about what a line is. Two
  classes were both spelled `HttpError`, so `is` against the wrong one compiled
  clean and was always false. When you add a check, find where the same question
  is already answered and answer it the same way.

- **A promise wider than the code.** The charter said props evaluate left to
  right, then children, then the component function; all three clauses were
  false. A source comment cited "charter §14 (GRM-A3)" — no such section
  existed, and the only `GRM-A3` in the tree was an unfinished plan item in an
  archived audit. A test named "an open group is bounded by the history byte
  budget" asserted no bound on the group. State the claim you can demonstrate,
  and verify prose against code, never code against prose.

- **The example fixed, the class left open.** `rgba` gained a range check while
  `hsl` two lines above did not. A nested `host` was resolved at root level but
  not one node deeper. A guard was broadened past its own message. Close the
  sink, not the spelling: after the named case, look for its neighbours in the
  same file and report what you found, fixed or not.

The rulings behind the current language are in
[docs/decisions/D90-AUDIT-SEMANTIC-RULINGS.md](docs/decisions/D90-AUDIT-SEMANTIC-RULINGS.md),
the advisory channel in
[docs/decisions/D89-ADVISORY-CHANNEL.md](docs/decisions/D89-ADVISORY-CHANNEL.md),
and its exact collection canonicalization extensions in
[docs/decisions/D93-CANONICAL-COLLECTION-CONVERSION-ADVISORY.md](docs/decisions/D93-CANONICAL-COLLECTION-CONVERSION-ADVISORY.md)
and [docs/decisions/D94-CANONICAL-LIST-SOME-ADVISORY.md](docs/decisions/D94-CANONICAL-LIST-SOME-ADVISORY.md),
and the exact record projection in
[docs/decisions/D95-EXACT-RECORD-PROJECTION.md](docs/decisions/D95-EXACT-RECORD-PROJECTION.md).

The full Core guide is [docs/ai-skill.md](docs/ai-skill.md). Target code must
follow its nearer guide as well as this repository contract.
