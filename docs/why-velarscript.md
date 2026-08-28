# Why VelarScript exists

**An extensible application-layer programming language for the AI era, where
the framework is the language.**

Two names for one thing: **VelarScript** is the language, and **Velar** is the
platform it runs on — the Core compiler, the target extensions, and the
toolchain. Nothing in that list is *the framework*, because the framework is
the language.

## What it is for

A model can now write code faster than anyone can check it. The bottleneck
moved from writing to trusting.

Every stack in use today was built for the other era — the one where a person
wrote each line and held the whole context in their head. That era could
afford silent mistakes, because the author knew what they had meant. The
assumption is gone. The stacks have not moved.

VelarScript exists so that code a person did not write can still be owned by
that person: verified by a compiler rather than by reading every line.

## What problem it solves

Two things break when a model writes the code, and neither is "the model
cannot program".

**The seams.** One feature in a conventional web stack has to be
simultaneously correct against JavaScript semantics, JSX, some CSS approach,
a state library, a router, a build configuration, and a test runner. Most
failures land in the joints between those ecosystems rather than inside any
one of them. Vel removes the joints: styling is syntax, state is syntax, tests
are syntax. The task shrinks from *compose six ecosystems correctly* to *write
one language correctly*.

**The silence.** In JavaScript most mistakes compile and pass — a misspelled
CSS property, a wrong `aria-*` value, a missing reactive dependency, a
coercion, a floating promise. The person who owns the product, who often
cannot read the code, has no way to know whether the model got it right.
Vel makes those loud: every Look property that takes keywords carries its own
closed set, ARIA is checked, reactive dependencies are discovered rather than
declared, and there is no coercion, no truthiness, no silently dropped
statement, and no unowned failure. The compiler is the reviewer.

There is a third, quieter one. Model output varies between prompts, sessions,
and models, so a codebase written across many sessions reads like several
codebases. **One obvious spelling per idea** is what makes any Vel codebase
read like any other — which is what makes it maintainable by whoever, or
whatever, picks it up next.

## Why it appeared now

Its author could not live inside React's pile of constraints or Vue's template
syntax. That is where it started, but it is not why it could be built.

No single constraint makes anyone rewrite a language. React's are each
defensible, each documented, each justified when it was added. It is the
accumulation nobody can stand — which means the dangerous constraints are
exactly the ones that look worth it individually. A language that promises
backward compatibility can only add, so the friction it discovers is friction
it carries forever, and it drifts toward being the thing you wanted to escape.

The only way out is to be able to *remove*. Removal has always been possible
in principle and unaffordable in practice, because migration was human labour
and someone always depended on the old spelling.

**That is what changed.** When the model is the author, a breaking change
costs a rewrite the model performs and a diagnostic that teaches it in one
round. Vel could not have been built before this moment — not because the
syntax needed models, but because its central mechanism did.

## Design tenets

Two parents. **JavaScript is the mother**: the program lives and runs inside
her, so behaviour defers to her. **Python is the father**: the visible surface
carries his name, so spelling and readability follow him. A semantic question
asks the mother; a spelling question follows the father. Where an inherited
behaviour is a trap, Vel removes it instead of documenting it.

Every proposal is tested against these, in order:

1. **Normal-language usage.** Would someone fluent in JS and Python write it
   that way without reading documentation?
2. **One obvious spelling.** Does the change keep output uniform?
3. **Teaching diagnostics.** Does every rejection name the current spelling?
4. **Evidence over taste.** Blind tests and the real-application wall ledger
   decide, not preference.

Three more that decide the hard cases:

- **A design fix beats a diagnostic fix.** A diagnostic teaches after the
  mistake; the right spelling prevents it. When a defect can be repaired by
  changing what the language looks like, that is the repair.
- **Core knows nothing.** Core does not know what a DOM, a stylesheet, a
  filesystem, or a window is. Every capability arrives as an extension that
  adds real syntax through a compiler protocol. This is what keeps
  unification from becoming a kitchen sink: the surface being verified stays
  one language, and Core stays small.
- **A published name must be reachable.** Publishing a name, or a table of
  values, that no author can reach is worse than publishing nothing.

If a proposal serves engineers but costs the owner's ability to read the code,
it loses.

## Why you would choose it

- You want a model to build and maintain a real product, and you want to read
  and own the result without reading every line.
- You want the compiler to be the reviewer.
- You are building something that is still moving — a prototype, an internal
  tool, a product still finding its shape.
- You do not want to be trapped: the emitted JavaScript is legible and
  source-mapped, and the exit is enforced by a permanent gate rather than
  promised in prose.

**Why you would not.** If you need a ten-year support horizon, Vel does not
have one yet. If you have a large JavaScript codebase you cannot rewrite, Vel
replaces the source surface rather than adopting it incrementally. If your
project's value is in ecosystem breadth, npm is reachable here through
declared boundaries rather than by default, and that boundary is work.

## What it is good at

- **One language for the whole application** — markup, styling, state, tests,
  and the server side.
- **Surfaces others leave as strings are checked**: Look property values, ARIA,
  DOM attributes.
- **No dependency arrays.** A reactive computation subscribes to the reads it
  performs while it runs, so dependencies are discovered rather than declared,
  and cannot be forgotten.
- **Diagnostics name the one correct spelling**, so a model self-corrects in a
  single round and a person learns the language from the compiler. This is
  measured by blind tests in which a model that has never seen Vel must
  produce working programs with no documentation.
- **Readable, source-mapped output**, with no framework runtime in the browser
  beyond the explicit package.
- **No coercion, no truthiness, no silently dropped statements, no unowned
  failures.**
- **Extensions add syntax**, which is what makes the language extensible
  rather than merely configurable.

## What it promises

- Every removed or mistaken spelling gets a diagnostic that names the one
  current spelling — never a silent alias, never permanent compatibility debt.
  `velar fix` applies the mechanical part, and only where the rewrite is
  provably equivalent.
- **No dead ends**, in three exits, in order: the diagnostic teaches the fix;
  checked escape hatches reach JavaScript (`extern module`, inline
  `extern js` and `unsafe js` blocks, `import js unsafe`, `unsafe css`,
  `unsafe:html`); and the final exit is the emitted JavaScript itself — if Vel
  becomes the obstacle, take the output and keep shipping without us.
- Traps are removed rather than documented.
- The claims above are gates, not prose: the anti-lock-in exit, the blind
  tests, and the language's own usage tour are all things CI can fail on.

## What it does not promise

- **Backward compatibility. Ever.** This is the mechanism, not a caveat about
  immaturity: refusing the promise is what lets a friction be removed once it
  is found. You pin your toolchain version, and you migrate when you move it.
- **A stable channel for long-lived products.** That is a future milestone, to
  be earned by evidence rather than declared by a version number.
- **Ecosystem breadth by default.** The npm ecosystem is reachable, through
  declared boundaries that cost you something to write.
- **A new runtime.** Vel keeps the JavaScript it stands on — objects,
  references, Promises, the event loop, the browser. It replaces the source
  surface, not the world.
- **That migration is free.** It is not. The cost is real, and it is the price
  of being able to remove.
- **Anything under the application layer.** Interface, state, style, server and
  desktop are the whole of the surface. Kernels, drivers, engines, and numerics
  are not a later milestone; that boundary is what keeps Core from accumulating
  the pile Vel was built to escape, so it is defended rather than scheduled.
