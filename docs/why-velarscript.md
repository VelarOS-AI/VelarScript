# Why VelarScript exists

VelarScript is a language AI writes and maintains, and humans read and own.

## The problem

In the AI era, writing code is no longer the bottleneck — models write it.
The bottleneck is what happens next: the person who owns the product cannot
maintain what the model wrote. JavaScript makes this worse in three specific
ways. It permits a thousand spellings for every idea, so model output varies
wildly between prompts, sessions, and models. It hides traps — coercion,
floating promises, `undefined`, prototype surprises — that only experienced
engineers recognize. And it therefore produces codebases that a product
person, a designer, or a founder can neither read nor safely change, even
though the product is theirs.

VelarScript exists to solve that problem, not to be a nicer syntax.

## The bet

Vel is built from the bones of JavaScript and Python — the two languages
every model already knows best. A model can write Vel on prior knowledge
alone, and the compiler owns the rest:

- **One obvious spelling.** Where JS offers five ways, Vel keeps one. Model
  output becomes uniform: any Vel codebase reads like any other, which is
  what makes it maintainable by someone who didn't write it.
- **Diagnostics teach.** Every removed or mistaken spelling gets an error
  that names the one current spelling. A model self-corrects in one round
  without documentation; a person learns the language from the compiler.
  This is measured, not claimed: the release gate includes blind tests where
  an AI that has never seen Vel must produce working programs with no
  documentation, guided only by diagnostics.
- **Traps are removed, not documented.** No coercion, no truthiness, no
  silently dropped statements, no unowned promise failures. The owner of the
  product should never need to debug a category of bug they cannot see.
- **The compiler is the safety net.** Checks, bounded runtimes, validated
  boundaries, and gates stand between model output and production. Trust is
  placed in the gate, not in human review of every line.

The intended division of labor: **the human supplies intent and reads the
result; the model writes the Vel and every later change to it; the compiler
guards each change.** Maintenance is AI work too — which is why uniformity
matters twice: the next session, or the next model, must be able to pick up
any Vel codebase and modify it safely. For a non-programmer owner, reading
matters more than writing:
Vel's surface is close enough to plain structured English (indentation
blocks, `and`/`or`/`not`, `is not`, `await`/`async`, one spelling per idea)
that the owner can verify the code says what they meant.

## No dead ends

A language for real products must never strand a project mid-development.
Vel maintains three exits, in order:

1. **The diagnostic teaches the fix.** Most walls end here, in one round.
2. **Checked escape hatches to JavaScript.** When Vel or its standard
   surface lacks something, `extern module` declares a typed boundary to any
   npm package, `import js unsafe` admits a value as unchecked `any` to
   validate at the edge, `import css unsafe` and `unsafe:html` cover the
   styling and markup boundaries. The escape playbook is part of the
   documentation, not folklore.
3. **The final exit: readable JavaScript.** Vel compiles to legible,
   source-mapped JS. If Vel itself becomes the obstacle, take the emitted
   JavaScript and keep shipping without us. This anti-lock-in property is
   gate-tested, not promised.

## Honest boundaries

- **Vel does not promise backward compatibility.** The language absorbs
  lessons and breaks cleanly; removed spellings get teaching diagnostics,
  never silent aliases and never permanent compatibility debt. Pin your
  toolchain version; migrations are guided.
- **Vel is currently for products that move fast**: prototypes, internal
  tools, short-lifecycle applications — anything where validation speed
  matters more than a ten-year support horizon. A stable channel for
  long-lived products is a future milestone, earned by evidence, not
  declared by a version number.
- Vel keeps the JavaScript runtime it stands on: objects, references,
  Promises, the event loop, the browser. It replaces the source surface, not
  the world.

## How this document binds the project

Every language decision is tested against this mission, in order:

1. Normal-language usage — would a person or model fluent in JS/Python write
   it that way without reading docs?
2. One obvious spelling — does the change keep model output uniform?
3. Teaching diagnostics — does every rejection name the current spelling?
4. Evidence over taste — blind tests and the real-application wall ledger
   decide, not preference.

If a proposal serves engineers but costs the owner's ability to read the
code, it loses.
