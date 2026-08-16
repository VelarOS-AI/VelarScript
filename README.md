<p align="center">
  <img src="./assets/brand/velarscript-mark.svg" alt="VelarScript" width="116" />
</p>

# VelarScript

[English](README.md) | [简体中文](README.zh-CN.md)

[![VelarScript CI](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml/badge.svg)](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml)

**A language AI writes and maintains, and humans read and own.**

You supply the intent and read the result. The model writes the VelarScript
and every later change to it. The compiler guards each change.

Vel is built from the bones of JavaScript and Python — the two languages every
model already knows best — so a model writes it on prior knowledge alone. And
the language keeps **one obvious spelling per idea**, so model output stays
uniform and any Vel codebase reads like any other.

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

    const remaining = computed(() => tasks.filter(task => not task.done).size)

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
        <h1>{remaining()} remaining</h1>
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

**It never promises backward compatibility.** The language absorbs evidence and
breaks cleanly: removed spellings get teaching migration diagnostics, never
silent aliases and never permanent compatibility debt. Pin your toolchain
version; migrations are guided and `velar fix` applies the mechanical ones. Vel
currently fits products that move fast — prototypes, internal tools, short
lifecycles. A stable channel for long-lived products is a future milestone,
earned by evidence rather than declared by a version number.

The full reasoning is in [Why VelarScript exists](docs/why-velarscript.md).

## Documentation

**Using the language**

- [Getting started](docs/getting-started.md) — install, create, run, test
- [The language](docs/language.md) — the whole language in reading order, with runnable code
- [Best practices](docs/best-practices.md) — the house style, one complete program per rule
- [CLI reference](docs/cli.md) — every command, grouped by what you are doing
- [Language charter](docs/language-charter.md) — the full contract
- [Standard library](docs/standard-library.md) · [Web framework](docs/web-api.md)
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
| `@velarscript/node` | filesystem, path, process, terminal, server, HTTP — without exposing the Node.js ABI |
| `@velarscript/web` | components, JSX, reactivity, lifecycle, Look |
| `@velarscript/desktop` | the same Web source model over a system-WebView host with permission-scoped capabilities |
| `@velarscript/cli` | projects, builds, tests, dev server, language server |
| `create-velar` | project templates |

Vel deliberately has no virtual machine, no second object model, no
TypeScript-style type programming, no React effects, no CSS-module hashes, and
no silent JavaScript coercion.

## License

Apache-2.0. See [LICENSE](LICENSE).
