<p align="center">
  <img src="./assets/brand/velarscript-mark.svg" alt="VelarScript" width="116" />
</p>

# VelarScript

[English](README.md) | [简体中文](README.zh-CN.md)

[![VelarScript CI](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml/badge.svg)](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml)

**An extensible application-layer programming language for the AI era, where
the framework is the language.**

**VelarScript is the language. Velar is the application platform it runs on** —
the Core compiler, the target extensions, and the toolchain. You write
VelarScript and you install Velar, the way you write C# and install .NET; the
difference is scope, because Velar is only ever the application layer —
interface, state, style, server, desktop.

> `Velar` is said `/ˈwaɪ.lɛr/` — the `V` sounds like a `W`, and the ending
> rhymes with *well*, not *car*. The short form `Vel` is said like *well*.

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
keywords, not imports: the framework *is* the language. Core itself knows none
of those words — not what a DOM, a stylesheet, a filesystem, or a window is.
Every capability arrives as an extension that adds real syntax through a
compiler protocol, which makes the language extensible rather than merely
configurable. And Vel is built from the bones of JavaScript and Python — the
two languages every model already knows best — keeping **one obvious spelling
per idea**, so a model writes it on prior knowledge alone and any Vel codebase
reads like any other. You supply the intent and read the result; the model
writes the VelarScript and every later change to it; the compiler guards each
change.

## Start

Node.js 24 or newer. Everything else comes from npm.

```sh
npm create velar@latest my-app
cd my-app
npm install
npm run dev
```

Other templates: `--template node | desktop | docs | library | component`.

Then read [Getting started](docs/getting-started.md), or follow the generated
`AGENTS.md` and run the `velar skill` commands it names.

## What it looks like

```velar
import {Head} from "velar/web"
import {rgb, spacing} from "velar/look"

type Task:
    id: string
    title: string
    done: bool

const pageLook = look:
    display = "grid"
    gap = 16px
    maxWidth = 720px
    padding = spacing(48px, 20px)

    if viewport.width <= 640px:
        padding = spacing(24px, 16px)

const buttonLook = look:
    borderRadius = 10px
    padding = spacing(10px, 14px)

    if @hover:
        background = rgb(235, 240, 255)

export component App:
    state tasks: List<Task> = []
    state draft = ""

    computed remaining = tasks.filter(task => not task.done).size

    def addTask():
        if draft == "": return
        tasks = [...tasks, {id: f"task-{tasks.size}", title: draft, done: false}]
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

That compiles to ordinary JavaScript and DOM calls with stable readable CSS
selectors, and no framework runtime in the browser beyond `@velarscript/web`.

## What is actually different

**The compiler teaches instead of trapping.** Every removed or mistaken
spelling gets a diagnostic naming the one current spelling, so a model
self-corrects in a single round and a person learns the language from the
compiler. This is measured by blind tests, not claimed.

**There is no lock-in.** Vel emits legible JavaScript, with an independently
enabled Source Map. If Vel itself ever becomes the obstacle, take the output
and keep shipping — an exit enforced by a
[permanent acceptance gate](tests/acceptance/package.acceptance.ts), not
promised in prose.

**It never promises backward compatibility, and that is the point.** This
language exists because its author could not live inside React's pile of
constraints or Vue's template syntax, and the goal is that nobody using Vel
ever has to design a replacement for the same reason. No single constraint
makes anyone rewrite a language — React's are each defensible — it is the
accumulation, and a language that promises compatibility can only add, so
friction it finds is friction it carries forever. Refusing the promise is what
lets a friction be removed once it is found. Vel fits products that move fast;
a stable channel is a future milestone earned by evidence.

The full reasoning is in [Why VelarScript exists](docs/why-velarscript.md).

## Versions, and what to re-read after an upgrade

Every package in a release steps to the same number, so that number says what
you installed and not what moved. The second line of `velar --version` says
what moved:

```text
velar 0.30.0
  core@0.8   web@0.14   node@0.17   server@0.15   desktop@0.10
```

Each of the five observable surfaces — the language itself and the Web, Node,
Server and Desktop extensions — has a counter of its own, and a number that did
not move is a surface you do not have to re-read. The `N` in `0.N` counts
changes, never maturity: the labelling started in 0.25.0, where `core` began at
`0.1` and the four extension contracts carried the numbers they already had, so
a low number beside a high one says only that the two started counting at
different times. A gate hashes each surface's whole vocabulary rather than
anyone typing it, and a project records what it was written against in
`velar.json`'s `surfaces`, where a mismatch is refused by name.

Pin your toolchain version, and run three commands when you move it:

```sh
npx velar --version   # which of the five surfaces moved
npx velar fix         # apply the mechanical part of the migration
npx velar check       # what is left, each naming its one current spelling
```

Then read the [changelog](CHANGELOG.md) sections for the surfaces that moved.

## Documentation

- [Getting started](docs/getting-started.md) — install, create, run, test
- [The language](docs/language.md) — the whole language in reading order, with runnable code
- [Best practices](docs/best-practices.md) · [CLI reference](docs/cli.md) · [Language charter](docs/language-charter.md) — the house style, every command, the full contract
- [Standard library](docs/standard-library.md) · [Web framework](docs/web-api.md) · [Binary data and concurrency](docs/binary-data-and-concurrency.md)
- [AI skill briefs](docs/ai-skill.md) — Core, plus [Web](docs/ai-skill-web.md), [Node](docs/ai-skill-node.md), [Server](docs/ai-skill-server.md), and [Desktop](docs/ai-skill-desktop.md)
- [Escape hatches](docs/escape-hatches.md) · [JavaScript boundary](docs/javascript-bridge.md)

## What Velar is made of

Eight packages, released as one version-locked set. Core stays target-neutral,
every target is an explicit package rather than hidden compiler behavior, and
no package on this list is *the framework* — the framework is the language.

| Package | Owns |
| --- | --- |
| `@velarscript/compiler` | the Core language — syntax, types, analysis, JavaScript emission, the extension protocol |
| `@velarscript/core` | the target-neutral Standard API, including `velar/hash` and `velar/validation` |
| `@velarscript/web` | components, JSX, reactivity, lifecycle, Look, browser workers, binary storage and transport |
| `@velarscript/node` | filesystem, processes, workers, WebSocket, HTTP, and the native `server` route syntax — without exposing the Node.js ABI |
| `@velarscript/server` | service configuration, startup assembly, authentication composition, connection ownership |
| `@velarscript/desktop` | the same Web source model over a system-WebView host with permission-scoped capabilities |
| `@velarscript/cli` | projects, builds, tests, dev server, language server |
| `create-velar` | project templates |

## Working on this repository

[Contributing](CONTRIBUTING.md) says what a useful report looks like: the most
useful one is a word that reads wrong, not a pull request. To build it,
`npm ci`, then two gate commands and only two
([D116](docs/decisions/D116-SCOPED-GATES.md)):

```sh
npm run gate            # the quick tier, scoped to what this change set can move
npm run release:check   # quick tier and heavy tier both, before a release
```

`gate` works out what the change set can have moved — the package dependency
closure, plus the emitted-output fingerprint against `output-fingerprint.lock`
— runs exactly that, and prints what it skipped and why. The browser suite,
the packed-consumer acceptance and every `*.slow.test.ts` live only in
`release:check`; [docs/contributing/gates.md](docs/contributing/gates.md) has
the whole rule, and a change reports which suites ran and which were skipped.

The code organization is
[D115](docs/decisions/D115-AGENT-MAINTAINABLE-CODE-ORGANIZATION.md)'s: one
directory per compilation stage under `packages/compiler/src/` — `lexer/`,
`parser/`, `types/`, `analysis/`, `emit/`, `format/`, `semantic/` — with the
target packages taking the same shape as they land; the runtime JavaScript as
real source files under `packages/<name>/runtime/`, from which the
`src/*.generated.ts` tables are derived and gated; and `tests/<name>/`
mirroring that source tree. Source and test files are held to 800 lines and
functions to 120 against a shrink-only allowlist, and a refactor leaves the
emitted output byte-identical — `npm run fingerprint` proves it.

## License

Apache-2.0. See [LICENSE](LICENSE).
