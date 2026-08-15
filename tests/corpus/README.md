# Test corpus

VelarScript source that exists to be *checked*, not to be read as an example.
D52 rule 115 and D56 rule 131 draw the line: a showcase teaches, a corpus holds
the shapes a showcase would never naturally write. These four modules moved here
from `examples/` when the old example directories were retired.

| module | holds |
|---|---|
| `core.vel` | the Core language contract in one file — records, a class, generics in every annotation position, indexing, `for`/`while`, `try`/`catch`/`finally` |
| `foundation.vel` | the smallest complete program: an export, `let` mutation, a call, a branch |
| `inheritance.vel` | `abstract`/`extends`/`super`/`override`/`static`, and a class extending `Error` |
| `standard-library.vel` | the resident namespaces and the `velar/*` modules a program reaches for first |

Two gates walk this directory, and both matter:

- **`npm run check:format`** formats every `.vel` here and fails if the text
  changes. This is the reason the corpus exists in the first place. D55 rule
  127.2 found the formatter rewriting `x: Record<string>` into
  `x: Record < string >`, and the reason nothing caught it was that
  `: Record<` appeared **zero** times in every `.vel` file the gate walked. The
  gate was passing for a reason unrelated to the formatter being correct.
  `core.vel` now spells that annotation in all three positions — a parameter, a
  record field, and a `const` — so the hole cannot reopen unnoticed.
- **`tests/compiler.test.ts`** runs `velar check` over every module here — found
  by walking this directory, not by a list — and additionally compiles
  `core.vel` in process to assert the shapes it emits.

**Do not "tidy" a spelling out of these files.** A shape that looks redundant
next to its neighbour is usually the whole point: it is the one the compiler or
the formatter gets wrong when nobody is looking.
