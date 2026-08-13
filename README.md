<p align="center">
  <img src="./assets/brand/velarscript-mark.svg" alt="VelarScript" width="116" />
</p>

# VelarScript

[![VelarScript CI](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml/badge.svg)](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml)

VelarScript is a language AI writes and maintains, and humans read and own.
The person who owns the product supplies intent and reads the result; the
model writes the VelarScript and every later change to it; the compiler
guards each change. Vel is built from the bones of JavaScript and Python —
the two languages every model already knows best — so a model writes it on
prior knowledge alone, and the language keeps **one obvious spelling** per
idea: model output stays uniform, and any Vel codebase reads like any other.

Where JavaScript would trap a non-programmer owner, the compiler teaches
instead: every removed or mistaken spelling gets a **diagnostic that names
the one current spelling**, so a model self-corrects in one round and a
person learns the language from the compiler — a property measured by blind
tests, not claimed. And because Vel compiles to legible, source-mapped
JavaScript, there is no lock-in: if Vel itself ever becomes the obstacle,
take the emitted JavaScript and keep shipping — an exit enforced by a
[permanent acceptance gate](tests/package.acceptance.ts), not promised in
prose. The full mission is written down in
[Why VelarScript exists](docs/why-velarscript.md).

## Compatibility policy

VelarScript **never promises backward compatibility**. The language absorbs
evidence and breaks cleanly: removed spellings get teaching migration
diagnostics, never silent aliases and never permanent compatibility debt.
Pin your toolchain version; migrations are guided. Vel currently fits
products that move fast — prototypes, internal tools, short-lifecycle
applications. A stable channel for long-lived products is a future
milestone, earned by evidence, not declared by a version number.

## One language, explicit packages

VelarScript compiles to modern JavaScript and keeps the JavaScript runtime
model—objects, references, garbage collection, Promises, the event loop, and
the prototype chain—while replacing JavaScript's source surface with a
smaller, checked Python/JavaScript blend. Core stays target-neutral; the Web
framework is an extension package, not hidden compiler behavior:

- `@velarscript/compiler` owns the Core language.
- `@velarscript/node` adds bounded filesystem, path, process, terminal, server, and HTTP
  capabilities for local applications without exposing the Node.js ABI.
- `@velarscript/web` adds components, JSX, reactivity, lifecycle, and Look.
- `@velarscript/desktop` uses the same Web source model for one native-style
  project, while a thin system-WebView host provides permission-scoped files,
  paths, processes, HTTP, and environment capabilities.
- `@velarscript/cli` owns projects, builds, tests, the development server, and
  the language server.
- `create-velar` creates first-class Web, Node, and Desktop applications plus
  documentation sites, libraries, and component packages.

VelarScript deliberately does not introduce a virtual machine, a second object
model, TypeScript-style type programming, React effects, CSS Modules hashes, or
silent JavaScript coercion.

## Create an application

```sh
npm create velar@latest my-app
cd my-app
npm install
npm run dev
```

Available templates:

```sh
npm create velar@latest node-service -- --template node
npm create velar@latest desktop-app -- --template desktop
npm create velar@latest docs-site -- --template docs
npm create velar@latest domain-kit -- --template library
npm create velar@latest component-kit -- --template component
```

VelarScript uses npm as its package registry and lockfile authority. The CLI
adds a project-aware surface without inventing another registry:

```sh
velar install
velar add package-name
velar add package-name --dev
velar remove package-name
velar update
```

## A small example

```velar

import {Head} from "velar/web"

type Task:
    id: string
    title: string
    done: bool

const pageLook = look:
    display = "grid"
    gap = 16px
    maxWidth = 720px
    marginInline = "auto"
    padding = Look.spacing(48px, 20px)

    if viewport.width <= 640px:
        padding = Look.spacing(24px, 16px)

const buttonLook = look:
    border = Look.border(0px, Look.color("transparent"))
    borderRadius = 10px
    padding = Look.spacing(10px, 14px)
    cursor = "pointer"

    if @hover:
        background = Look.rgb(235, 240, 255)

export component App:
    state tasks: List<Task> = []
    state draft = ""

    const remaining = computed(() => tasks.filter(task => not task.done).size)

    def addTask() -> null:
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

The source above produces ordinary JavaScript, DOM operations, and stable,
readable Look selectors. There is no framework-specific browser runtime beyond
the explicit `@velarscript/web` package.

## Language in one page

- Bindings use `const` and `let`.
- Blocks use indentation and `:`.
- Empty values use the Web-native spelling `null`.
- Records and aliases share one `type` keyword.
- Optional values use `T?`; small unions use `A | B`.
- `readonly T` creates a transitive compile-time view of records and collection
  data without changing runtime identity; `readonly field: T` also protects the
  field's nested data. Classes, functions, promises, and host objects stay
  outside this qualifier.
- Enum members such as `Status.pending` are singleton types and can discriminate
  record unions across `if`, `assert`, and `match`; an external wire protocol
  may use `textDelta = "response.output_text.delta"` without losing that nominal
  member identity.
- Functions use `def`, and named arguments use `name=value`.
- `def` functions can declare type parameters, such as `def first<T>(items: List<T>) -> T?`,
  inferred at each call site and erased at runtime.
- Declaration and `for` binding patterns use checked record fields and exact
  List shapes; expected shape alternatives belong in `match`.
- `match` supports literals, enum members, type patterns, nested record/List
  destructuring, `_`, `...rest`, `as` bindings, and guards.
- Classes use body fields and an explicit `constructor(...)`.
- Public collections are `List`, `Set`, and `Map` with direct APIs such as
  `append`, `add`, `set`, `remove`, `some`, and `every`.
- `Record<T>` models JSON objects whose string keys are dynamic, without
  weakening `Map<K, V>` into a lossy wire-format alias.
- JSX, components, state, actions, resources, lifecycle, and Look belong to the
  Web extension.
- Native JavaScript and native CSS are explicit `unsafe` boundaries.
- Desktop applications remain one VelarScript project; renderer/main, local
  ports, and IPC are internal framework boundaries rather than source concepts.

```velar fragment
match response:
    case {kind: "success", users: [first, ...rest]}:
        print(first.name)
        print(rest.size)
    case User as user if user.active:
        print(user.name)
    case Error as error:
        throw error
    case null:
        print("No response")
```

```velar fragment
enum EventKind:
    text
    tool

type TextEvent:
    kind: EventKind.text
    text: string

type ToolEvent:
    kind: EventKind.tool
    toolId: string

type Event = TextEvent | ToolEvent
```

```velar
class Session:
    const id: string
    let active: bool

    constructor(id: string):
        self.id = id
        self.active = true

    def close() -> null:
        self.active = false
```

## Commands

```text
velar check [entry.vel | project-directory]
velar create <project-directory> [--template <web|node|desktop|docs|library|component>]
velar install
velar add <package[@version]>... [--dev]
velar remove <package>...
velar update [package...]
velar dev [entry.vel | project-directory] [--port <port>]
velar build [entry.vel | project-directory] [--out-dir <directory>]
velar package [project-directory]
velar run [entry.vel | project-directory] [-- <program-arguments>...]
velar test [project-directory | file.test.vel]
velar test [project-directory] --browser [chromium|firefox|webkit|all]
velar format [file.vel | project-directory] [--check]
velar skill
velar verify [project-directory | build-directory]
velar preview [project-directory | build-directory] [--port <port>]
velar lsp
```

## Documentation

- [Changelog](CHANGELOG.md)
- [Why VelarScript exists](docs/why-velarscript.md)
- [Best practices](docs/best-practices.md)
- [AI skill brief](docs/ai-skill.md) (printed verbatim by `velar skill`)
- [Escape hatches](docs/escape-hatches.md)
- [Language reference](docs/language-charter.md)
- [Standard library](docs/standard-library.md)
- [Web framework API](docs/web-api.md)
- [JavaScript boundary](docs/javascript-bridge.md)
- [Runtime and JavaScript boundary ledger](docs/runtime-boundary.md)
- [Project lifecycle](docs/project-lifecycle.md)
- [Compiler architecture](docs/compiler-architecture.md)
- [Workbench integration](docs/workbench-integration.md)

## Repository validation

```sh
npm run build:packages
npm run check:docs
npm test
npm run test:browser
npm run test:packages
```

Browser tests require the corresponding Playwright browsers. Release and
deployment operations remain separate, explicit commands.

## License

Apache-2.0. See [LICENSE](LICENSE).
