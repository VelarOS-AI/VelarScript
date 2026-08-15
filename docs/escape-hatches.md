# Escape hatches: the no-dead-ends playbook

A language for real products must never strand a project mid-development.
This page is the playbook for every "Vel lacks something" or "Vel broke"
moment: a decision tree from the mildest exit to the final one, each exit a
supported product surface rather than folklore. The goal is that a developer
— or an AI agent — finds the way out in five minutes, without abandoning the
project.

The exits, in order:

1. **The diagnostic teaches the fix.** Most walls end here, in one round —
   run `velar check` and do what it says, and `velar fix` where the rewrite is
   provably behavior-preserving. The rest of this page is for the
   walls that remain.
2. **A missing capability or npm package** → [`extern module`](#1-missing-capability-or-npm-package--extern-module),
   the checked boundary and the first choice.
3. **Quick raw access to a JavaScript value** → [`import js unsafe`](#2-quick-raw-access--import-js-unsafe),
   validated at the edge.
4. **Styling or markup beyond Look** → [`import css unsafe` and `unsafe:html`](#3-styling-and-markup-beyond-look).
5. **A suspected compiler defect blocking you** → [minimal repro, issue, workaround ladder](#4-a-suspected-compiler-defect).
6. **The final exit** → [take the emitted readable JavaScript and keep shipping](#5-the-final-exit-readable-javascript).

## 1. Missing capability or npm package → `extern module`

When the standard surface lacks something, or the product needs a
third-party npm package, declare a checked boundary. `extern module`
describes the JavaScript module's runtime exports — constants, functions,
and classes — and every use is then checked like ordinary VelarScript:

```velar
extern module "text-tools":
    export const version: string
    export def format(value: string) -> string

    export class Formatter:
        constructor(prefix: string)
        def format(value: number) -> string

import js {Formatter, format, version} from "text-tools"

const formatter = Formatter(">")
print(format(version))
print(formatter.format(42))
```

Declared exports are presence-checked when the module loads, so a missing
export fails at the boundary with a named diagnostic instead of binding
`undefined` and failing far from the cause. Data the package does not
guarantee should cross as `unknown` and enter typed code through the runtime
validator:

```velar
type User:
    id: string
    name: string

extern module "user-sdk":
    export def loadUser() -> unknown

import js {loadUser} from "user-sdk"

const user = User.parse(loadUser())
print(user.name)
```

Many packages also work without a manual declaration: safe `import js`
reads the package's own TypeScript declarations when they map onto Vel's
lightweight types. The exact supported shapes and adaptations are specified
in the [JavaScript declaration bridge](javascript-bridge.md).

### The honest limit: one signature per export

Each extern export, constructor, or method has exactly one declared
signature. JavaScript APIs built on overloads — or on event names that
change the listener's shape, such as `on("data", ...)` versus
`on("close", ...)` — cannot be declared per-variant today. This is the known
narrow spot of the hatch. The two honest current solutions:

- **Cross with `unknown` and narrow at runtime.** Declare the payload as
  `unknown`, then validate per event where the shape is known:

```velar
type MessagePayload:
    text: string

extern module "event-source":
    export def on(event: string, listener: (payload: unknown) -> null) -> null

import js {on} from "event-source"

def handleMessage(payload: unknown):
    const message = MessagePayload.parse(payload)
    print(message.text)

on("message", handleMessage)
```

- **Write one fixed adapter facade.** A small JavaScript module in a package
  you own can flatten the overload set into fixed single-signature functions
  (`onMessage(listener)`, `onClose(listener)`), each declared precisely with
  `extern module`.

## 2. Quick raw access → `import js unsafe`

When a checked declaration is not worth the ceremony yet, `import js unsafe`
admits the value as `any`. Nothing about it is checked, so treat the import
statement as the boundary of trust: validate with `Type.parse` at the edge,
and let only typed values flow inward:

```velar
import js unsafe {legacyValue} from "legacy-package"

type Config:
    baseUrl: string

const config = Config.parse(legacyValue)
print(config.baseUrl)
```

Unsafe imports are for speed, not for permanence. When the boundary
stabilizes, promote it to an `extern module` declaration and the compiler
starts checking every call site.

## 3. Styling and markup beyond Look

When a design needs CSS that Look does not express, native CSS is an
explicit unsafe boundary with a declared position relative to Look's output:

```velar fragment
import css unsafe "./legacy.css" before look
import css unsafe "./overrides.css" after look
```

`before look` and `after look` set source order only; specificity and
`!important` remain the stylesheet author's responsibility.

### A stylesheet that ships inside an npm package

`import css unsafe` takes a relative project path — `"./legacy.css"` — and
nothing else. There is no `import css unsafe "some-package/dist/style.css"`, so a
component library whose CSS lives in `node_modules` is brought in by copying it
into the project, which is a two-line build step and a deliberate one: the file
becomes a reviewable artifact whose version is visible in the repository instead
of a silent dependency of the visual layer.

```json
{
  "scripts": {
    "sync:vendor-css": "cp node_modules/some-ui/dist/style.css src/vendor/some-ui.css",
    "prebuild": "npm run sync:vendor-css"
  }
}
```

```velar fragment
import css unsafe "./vendor/some-ui.css" before look
```

Three points make this workflow honest rather than a workaround. Import the copy
`before look` so the application's own Look wins equal-specificity conflicts.
Commit the copied file, and re-run the copy when the package updates — a
`prebuild` (or `postinstall`) script keeps that mechanical. And treat the copy as
read-only: local edits belong in a second stylesheet imported `after look`, or in
Look itself, so the next sync does not silently discard them. Blessing package
CSS paths directly is a possible future addition; today the copy is the supported
path.

Trusted HTML renders through the string-only `unsafe:html` boundary. It is a
wholesale `innerHTML` assignment on every reactive update, and it cannot be
combined with children. Style that markup through the unsafe CSS route
above, not through Look:

```velar fragment
component Preview(trustedMarkup: string):
    return <article unsafe:html={trustedMarkup} />
```

## 4. A suspected compiler defect

When the compiler itself appears wrong — a diagnostic that cannot be
satisfied, an emit that misbehaves, a check that contradicts this
documentation — do not abandon the project and do not fight the wall
blindly. The path:

1. **Reduce to a minimal repro.** Cut the program down to the smallest
   `.vel` file that still shows the behavior. Most "compiler bugs" resolve
   into a teaching diagnostic during this step; the rest become perfect
   reports.
2. **File the issue with three sections** (the same structure the project's
   blind-test ledger uses):

```text
What I wrote (or wanted to write):
    <the minimal .vel source>

What the compiler said:
    <the verbatim diagnostics, or the wrong output>

How I resolved it:
    <the workaround that unblocked the project, or "blocked">
```

3. **Climb the workaround ladder while waiting.** In order: respell the
   construct (a neighboring canonical spelling usually avoids the edge);
   isolate the troublesome part into a small JavaScript module you own and
   declare it with `extern module`; and if the defect still blocks the
   project, take the final exit below. VelarScript makes no
   backward-compatibility promise, but defects with a repro are treated as
   gate failures, not as folklore.

## 5. The final exit: readable JavaScript

`velar build` emits legible, source-mapped JavaScript — ordinary modules
with your names in them, plus a generated `node_modules/velar` directory
containing the standard-module runtime as plain readable JavaScript. That
generated runtime is part of the build output, not part of the toolchain.

If Vel itself becomes the obstacle, take the build output and keep shipping
without us: the emitted program runs in a bare directory with nothing but
Node — no `@velarscript/*` packages, no compiler, no CLI. This anti-lock-in
property is enforced by a permanent acceptance gate
([tests/package.acceptance.ts](../tests/package.acceptance.ts)) that builds
a program, copies only the emitted output into an empty directory, and runs
it with Node alone.

Ejecting is one-way — you maintain the JavaScript from then on — which is
exactly what makes it an honest exit: the code you leave with is code a
JavaScript team can own.
