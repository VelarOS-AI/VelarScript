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
3. **One JavaScript value, validated at the edge** → [`import js unsafe`](#2-one-value-validated-at-the-edge--import-js-unsafe),
   one `Type.parse` instead of a signature for every export.
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

## 1b. JavaScript with no package to import from → an inline block

Both hatches above name a package. A global, a shim, or a handful of lines that
exist only for one module has no package, and therefore no import spelling.
Write the JavaScript inline instead, with its contract directly underneath:

```velar
const tokenBytes = 16

extern js(tokenBytes: number)`
    export function sessionToken() {
        const buffer = new Uint8Array(tokenBytes)
        globalThis.crypto.getRandomValues(buffer)
        return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("")
    }
`:
    export def sessionToken() -> string

print(sessionToken())
```

The parenthesized list captures Vel bindings of the same name and passes them
to the emitted module as checked arguments — not text substitution. Drop the
contract and it becomes `unsafe js`, whose exports are `unknown` and carry
every caveat of section 2.

**This is the tighter hatch, not the looser one.** `import js unsafe` leaves a
whole module's exports `unknown` from another file, with nothing beside the
import saying what any of them is; a block puts the contract three lines under
the source it governs, and the block compiles to a sibling `.js` with a source
map back to these lines. If you were reaching for a
`data:text/javascript,` import to inline a module, that spelling is now
rejected with a mechanical rewrite into this one.

**The honest limit:** captures are handed to a synchronous factory, so a block
that takes them cannot use top-level `await`. Await on the Vel side and capture
the result.

The CSS counterpart is `unsafe css`, in section 3.

## 2. One value, validated at the edge → `import js unsafe`

`import js unsafe` skips the signature ceremony, not the checking. Where
`extern module` declares a type for every export before any of them can be
used, an unsafe import declares nothing and admits the value as `unknown`, so
the value carries no guarantee and the compiler refuses to read a field off it,
call it, or judge it as a condition. The import statement is the boundary of
trust: parse one declared shape with `Type.parse` at the edge, and let only
typed values flow inward:

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

When the CSS is a few rules that belong to this module rather than a file worth
keeping, write it inline. The placement is mandatory here too — there is no
default order:

```velar fragment
unsafe css`
    @media print {
        article { break-inside: avoid; orphans: 3; widows: 3 }
    }
` after look
```

Paged media is the honest example: `print` is not a Look media subject and
`break-inside`, `orphans`, and `widows` are excluded properties, because paged
and fragmented media are outside the Web application target. So there is no
Look spelling being avoided — this reaches something Look does not cover at
all, which is what an escape hatch is for.

Reading a design system's CSS custom properties is not one of those things, and
this is the mistake worth naming here, because it used to be true. Every metric
Look property — width, padding, gap, `borderRadius`, `fontSize` — once refused
`var(--x)` and named this page as the only way out, so a whole visual layer
would follow its design tokens into a stylesheet. `token("--name")` is now the
checked spelling and it is legal in every Look property, so a token-driven
design stays inside Look; a raw `var(--name)` string is refused with `token()`
named, and `velar fix` migrates it.

`unsafe css` belongs to the Web extension rather than Core, for the same reason
Core has no `look`: Core does not know what a stylesheet is.

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
   reports. When it still fails, `velar repro` bundles what is left: it writes
   a self-contained directory — the source the diagnostic touches, `velar.json`,
   the verbatim output, the versions, and a `README.md` already laid out in the
   three sections below — then prints the path. It uploads nothing and collects
   nothing about your machine; sending it is your decision. In the recorded
   output, paths inside the project keep their project-relative shape, and a
   module from outside it — a linked package, a `node_modules` tree above the
   project root — is named by its file alone, as `<external>/<name>`; the
   directories leading to it are not part of the defect. That module is still
   named in full, relative to the project, where the `README.md` lists what the
   bundle could not carry, because that list is what tells you which package to
   install.
2. **File the issue with three sections** (the same structure the project's
   blind-test ledger uses, and the fields the repository's defect template
   asks for):

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

For the Node target, `velar build --mode readable --source-maps` emits legible, source-mapped JavaScript —
ordinary modules with your names in them, plus a generated
`node_modules/velar` directory containing the standard-module runtime as
plain readable JavaScript. That generated runtime is part of the build
output, not part of the toolchain.

The default `production` mode bundles or minifies every target for deployment,
so that artifact is not the form you read. Pass `--mode readable`, or set
`"build": {"mode": "readable"}` in `velar.json`, to preserve generated names
and structure. Source maps are an independent switch: set
`"build": {"sourceMaps": true}` or pass `--source-maps` when they are needed.

If Vel itself becomes the obstacle, take the emitted output and keep
shipping without us: an emitted Node program runs in a bare directory with
nothing but Node — no `@velarscript/*` packages, no compiler, no CLI — and
a built web `dist/` is self-contained static assets. The Node half of this
anti-lock-in property is enforced by a permanent acceptance gate
([tests/package.acceptance.ts](../tests/package.acceptance.ts)) that builds
a program, copies only the emitted output into an empty directory, and runs
it with Node alone.

Ejecting is one-way — you maintain the JavaScript from then on — which is
exactly what makes it an honest exit: the code you leave with is code a
JavaScript team can own.
