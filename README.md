<p align="center">
  <img src="./assets/brand/velarscript-mark.svg" alt="VelarScript" width="116" />
</p>

# VelarScript

[English](README.md) | [简体中文](README.zh-CN.md)

[![VelarScript CI](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml/badge.svg)](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml)

**An extensible programming language for the AI era, where the framework is the
language.**

A model can now write code faster than anyone can check it, so the bottleneck
has moved from writing to trusting. Every existing stack was built for the era
when a person wrote each line and held the whole context, where a silent
mistake was affordable because the author knew what they had meant. That
assumption is gone and the stacks have not moved. Vel answers with two things
that are one thing: it shrinks what has to be verified down to a single
language, and it makes the compiler the thing that verifies it. A wrong CSS
value, a misspelled `aria-*`, a missed reactive dependency, a coercion, an
unowned failure — silent everywhere else, compile errors here.

`component`, `state`, `computed`, `watch`, `look`, and `keyframes` are
keywords, not imports — there is no framework layered on top of the language,
because the framework *is* the language. And Core itself knows none of those
words: it does not know what a DOM, a stylesheet, a filesystem, or a window
is. Every capability arrives as an extension that adds real syntax through a
compiler protocol — `@velarscript/web` brings the words above and JSX,
`@velarscript/desktop` runs that same source model on a system WebView with
permission-scoped capabilities, and `@velarscript/node` adds the server side.
Extensions add syntax, not only libraries, which is what makes the language
extensible rather than merely configurable.

Vel is built from the bones of JavaScript and Python — the two languages every
model already knows best — so a model writes it on prior knowledge alone, and
the language keeps **one obvious spelling per idea** so that output stays
uniform and any Vel codebase reads like any other. You supply the intent and
read the result; the model writes the VelarScript and every later change to
it; the compiler guards each change.

## Start

```sh
npm create velar@latest my-app
cd my-app
npm install
npm run dev
```

Other templates: `--template node | desktop | docs | library | component`.

Then read [Getting started](docs/getting-started.md), or run `velar skill` to
print the brief you hand your model.

## What it looks like

```velar
import {Head} from "velar/web"
import {border, color, rgb, spacing} from "velar/look"

type Task:
    id: string
    title: string
    done: bool

const pageLook = look:
    display = "grid"
    gap = 16px
    maxWidth = 720px
    marginInline = "auto"
    padding = spacing(48px, 20px)

    if viewport.width <= 640px:
        padding = spacing(24px, 16px)

const buttonLook = look:
    border = border(0px, color("transparent"))
    borderRadius = 10px
    padding = spacing(10px, 14px)
    cursor = "pointer"

    if @hover:
        background = rgb(235, 240, 255)

export component App:
    state tasks: List<Task> = []
    state draft = ""

    computed remaining = tasks.filter(task => not task.done).size

    def addTask():
        if draft == "":
            return
        tasks = [
            ...tasks,
            {id: f"task-{tasks.size}", title: draft, done: false},
        ]
        draft = ""

    return <main look={pageLook}>
        <Head title="Tasks · VelarScript" />
        <h1>{remaining} remaining</h1>
        <input bind:value={draft} aria-label="Task title" />
        <button look={buttonLook} type="button" on:click={addTask}>Add task</button>
        <ul>
            {tasks.map(task => <li key={task.id}>{task.title}</li>)}
        </ul>
    </main>
```

That compiles to ordinary JavaScript and DOM calls, with stable readable CSS
selectors. There is no framework runtime in the browser beyond the explicit
`@velarscript/web` package.

## What is actually different

**The compiler teaches instead of trapping.** Every removed or mistaken
spelling gets a diagnostic naming the one current spelling, so a model
self-corrects in a single round and a person learns the language from the
compiler. This is measured by blind tests, not claimed.

**There is no lock-in.** Vel compiles to legible, source-mapped JavaScript. If
Vel itself ever becomes the obstacle, take the emitted output and keep
shipping — an exit enforced by a
[permanent acceptance gate](tests/package.acceptance.ts), not promised in prose.

**It never promises backward compatibility, and that is the point.** This
language exists because its author could not live inside React's pile of
constraints or Vue's template syntax, and the goal is that nobody using Vel
ever has to design a replacement for the same reason. No single constraint
makes anyone rewrite a language — React's are each defensible — it is the
accumulation. And a language that promises compatibility can only add, so
friction it discovers is friction it carries forever.

Refusing the promise is what lets a friction be removed once it is found.
Removed spellings get teaching migration diagnostics, never silent aliases and
never permanent compatibility debt; `velar fix` applies the mechanical part.
Pin your toolchain version. Vel currently fits products that move fast —
prototypes, internal tools, short lifecycles — and a stable channel is a future
milestone earned by evidence rather than declared by a version number.

The full reasoning is in [Why VelarScript exists](docs/why-velarscript.md).

## Documentation

**Using the language**

- [Getting started](docs/getting-started.md) — install, create, run, test
- [The language](docs/language.md) — the whole language in reading order, with runnable code
- [Best practices](docs/best-practices.md) — the house style, one complete program per rule
- [CLI reference](docs/cli.md) — every command, grouped by what you are doing
- [Language charter](docs/language-charter.md) — the full contract
- [Standard library](docs/standard-library.md) · [Web framework](docs/web-api.md)
- [Minecraft readiness](docs/minecraft-readiness.md) — binary memory, deterministic workers, transport, and persistence
- [AI skill brief](docs/ai-skill.md) — what `velar skill` prints
- [Escape hatches](docs/escape-hatches.md) · [JavaScript boundary](docs/javascript-bridge.md)

**Working on the compiler**

- [Contributing](CONTRIBUTING.md) and [contributor docs](docs/contributing/)
- [Design decisions](docs/decisions/) — why the language is shaped this way

## Packages

Core stays target-neutral; every target is an explicit package, not hidden
compiler behavior.

| Package | Owns |
| --- | --- |
| `@velarscript/compiler` | the Core language |
| `@velarscript/node` | filesystem, SQLite, workers, WebSocket/server, HTTP — without exposing the Node.js ABI |
| `@velarscript/web` | components, JSX, reactivity, lifecycle, Look, browser workers, binary storage and transport |
| `@velarscript/desktop` | the same Web source model over a system-WebView host with permission-scoped capabilities |
| `@velarscript/cli` | projects, builds, tests, dev server, language server |
| `create-velar` | project templates |

Vel deliberately has no virtual machine, no second object model, no
TypeScript-style type programming, no React effects, no CSS-module hashes, and
no silent JavaScript coercion.

## License

Apache-2.0. See [LICENSE](LICENSE).
