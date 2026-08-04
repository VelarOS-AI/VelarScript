# VelarScript

[![VelarScript CI](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml/badge.svg)](https://github.com/VelarOS-AI/VelarScript/actions/workflows/ci.yml)

VelarScript is a Web-first language that compiles to modern JavaScript. It
keeps the JavaScript runtime model—objects, references, garbage collection,
Promises, the event loop, and the prototype chain—but replaces JavaScript's
source surface with a smaller, checked Python/JavaScript blend.

The Web framework is an extension package, not hidden compiler behavior:

- `@velarscript/compiler` owns the Core language.
- `@velarscript/web` adds components, JSX, reactivity, lifecycle, and Look.
- `@velarscript/cli` owns projects, builds, tests, the development server, and
  the language server.
- `create-velar` creates applications, documentation sites, libraries, and
  component packages.

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

The source above produces ordinary JavaScript, DOM operations, and stable,
readable Look selectors. There is no framework-specific browser runtime beyond
the explicit `@velarscript/web` package.

## Language in one page

- Bindings use `const` and `let`.
- Blocks use indentation and `:`.
- Empty values use the Web-native spelling `null`.
- Records and aliases share one `type` keyword.
- Optional values use `T?`; small unions use `A | B`.
- Functions use `def`, and named arguments use `name=value`.
- Declaration and `for` binding patterns use checked record fields and exact
  List shapes; expected shape alternatives belong in `match`.
- `match` supports literals, enum members, type patterns, nested record/List
  destructuring, `_`, `...rest`, `as` bindings, and guards.
- Classes use body fields and an explicit `constructor(...)`.
- Public collections are `List`, `Set`, and `Map` with direct APIs such as
  `append`, `add`, `set`, `remove`, `some`, and `every`.
- JSX, components, state, actions, resources, lifecycle, and Look belong to the
  Web extension.
- Native JavaScript and native CSS are explicit `unsafe` boundaries.

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

```velar
class Session:
    const id: string
    let active: bool

    constructor(id: string):
        self.id = id
        self.active = true

    def close():
        self.active = false
```

## Commands

```text
velar check [entry.vel | project-directory]
velar create <project-directory> [--template <web|docs|library|component>]
velar install
velar add <package[@version]>... [--dev]
velar remove <package>...
velar update [package...]
velar dev [entry.vel | project-directory] [--port <port>]
velar build [entry.vel | project-directory] [--out-dir <directory>]
velar test [project-directory | file.test.vel]
velar test [project-directory] --browser [chromium|firefox|webkit|all]
velar format [file.vel | project-directory] [--check]
velar verify [project-directory | build-directory]
velar preview [project-directory | build-directory] [--port <port>]
velar lsp
```

## Documentation

- [Changelog](CHANGELOG.md)
- [Language reference](docs/language-charter.md)
- [Standard library](docs/standard-library.md)
- [Web framework API](docs/web-api.md)
- [JavaScript boundary](docs/javascript-bridge.md)
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
