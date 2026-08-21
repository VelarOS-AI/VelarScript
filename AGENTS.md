# VelarScript Core Agent Guide

This file governs the repository unless a closer `AGENTS.md` narrows the target.

- Treat `packages/compiler` as the language authority. Core owns syntax, types,
  diagnostics, formatting, target-neutral lowering, and Runtime Type behavior.
- Keep `@` single-purpose: it attaches compile-time metadata to the following
  declaration or structural entry. Do not add unrelated runtime invocation or
  database semantics.
- Reserve `velar/*` for language semantics and target capabilities shipped by
  the matching official owner. Project libraries use npm package names,
  `velar.entry`, or project-relative modules.
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

## Python / JavaScript reflex table

Vel's parents are JavaScript and Python. These reflexes land in Vel source as
something else. `A1`/`A2`/`A3` are **advisories**: Vel accepts the spelling and
means something else, so the compiler reports and still emits. The rest are
already errors whose message names the successor, except the last row, which
nothing catches.

| Reflex | Write instead | Channel |
| --- | --- | --- |
| `a // b` floor division | `(a / b).floor()` — `//` opens a comment, so `const c = a // b` binds `a` | `A1` |
| `for i, v in nums:` | `for v, i in nums:` — the two-slot `for` gives `value, index`, as JS `forEach` does and Python `enumerate` does not | `A2` |
| `-7 % 3` expecting `2` | Vel's `%` is JavaScript's and yields `-1`; Python's non-negative modulo is `((a % b) + b) % b` | `A3` |
| `enumerate(xs)` | `for value, index in xs:` | error |
| `with X as y:` | `using y = X` | error |
| `raise E(...)` | `throw E(...)` | error |
| `def m(self)` | `self` is implicit; never declare it as a parameter | error |
| `# comment` | `// comment`; `///` documents the following declaration | error |
| `if value:` truthiness | conditions take `bool`/`bool?` only — `if value != null:` | error |
| `"${value}"`, `` `${value}` `` | `f"{value}"` or `` f`{value}` `` — only the `f` prefix interpolates, and `${...}` is legal literal text everywhere else | silent |

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

The full Core guide is [docs/ai-skill.md](docs/ai-skill.md). Target code must
follow its nearer guide as well as this repository contract.
