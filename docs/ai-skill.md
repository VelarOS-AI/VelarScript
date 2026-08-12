# The VelarScript AI skill brief

This is the language brief for AI agents working in a VelarScript project. It
is agent-agnostic markdown, it ships inside the toolchain, and `velar skill`
prints it verbatim — no network, no external documentation. Every code fence
in this file compiles against the current compiler; the brief cannot drift
from the language.

## What VelarScript is

VelarScript (Vel) is a language AI writes and maintains, and humans read and
own. The person who owns the product supplies intent and reads the result;
you write the Vel and every later change to it; the compiler guards each
change. Vel's parents are JavaScript and Python — the two languages you
already know best. JavaScript is the mother: the program runs inside her, so
behavior defers to JS. Python is the father: the visible spelling follows
him. When unsure about behavior, ask the mother; when unsure about spelling,
follow the father. **Write on your priors, and the compiler will teach you
the rest**: where JS offers five spellings, Vel keeps one, and every removed
or mistaken spelling gets a diagnostic that names the one current spelling.
Expect to self-correct in one round.

The working loop:

1. Write ordinary code the way a fluent JS/Python author would.
2. Run `velar check`. Do exactly what each diagnostic says.
3. Run `velar test`. Run `velar format` to settle layout.

Do not invent workarounds for a diagnostic; it is the language telling you
the canonical spelling.

## The traps your reflexes will hit

Everything in this table was hit by real models writing Vel blind. All but
the first row produce a teaching diagnostic, so `velar check` will catch
them; the first row is the **one silent trap** in the list — read it twice.

| Your reflex | Write instead |
| --- | --- |
| `"${value}"` template interpolation | `f"{value}"`. Only the `f` prefix interpolates; `${...}` inside any string is legal literal text, so nothing warns you. |
| `# comment` | `// comment` (`///` documents the following declaration). |
| `function f(...)`, `fn f(...)` | `def f(...) -> Result:` |
| `interface X:`, `record X:`, `struct X:` | `type X:` — one keyword for record shapes and aliases. |
| `items.length` | `items.size` (also on strings, Sets, Maps). |
| `items.push(x)` | `items.append(x)`. There is no `splice`/`shift`/`unshift`/mutating `sort`; use `insert`, `pop`, `remove`, `extend`, and the copying `sorted()`/`reversed()`. |
| `if value:` truthiness | Conditions accept only `bool`/`bool?`. Test presence explicitly: `if value != null:`. |
| `value is null` | `value == null` / `value != null` — `is` tests runtime types, `null` is a value. |
| `switch`, or an `if`/`else if` ladder over an enum | `match` with `case _:` as the only fallback. |
| Two statements on one line | One statement per line; there are no semicolons. A line starting with `.` or `?.` continues the previous line, so method chains format normally. |
| `count++` | `count += 1` |
| `call(name: value)` named argument | `call(name=value)` |
| Bare `range(5)` | `range` is a normal import: `import {range} from "velar/collections"`. |
| `"""triple-quoted"""` or backtick strings | A layout string: a quote followed immediately by a newline opens it; a quote back at the opening line's indentation closes it. |
| `x if cond else y` | `cond ? x : y` |
| `&&`, `\|\|`, `!`, `===`, `var`, `elif`, `None`, `undefined` | `and`, `or`, `not`, `==`, `let`/`const`, `else if`, `null`, `null`. |
| `f"{user}"` or `str(user)` on a record | Text conversion accepts strings, numbers, bools, enums, and `null` only. `print(user)` inspects a value; `stringify(user)` from `velar/json` builds data text. |
| Calling an async function and moving on | A dropped Promise is a compile error. `await task()` to wait; `async task()` to run it detached. |
| `flag or name ?? fallback` | Parenthesize — `??` never shares an unparenthesized chain with `and`/`or`. |
| `onClick={handler}` | `on:click={handler}`; form binding is `bind:value={state}`. |
| Implicit `{props.children}` | Declare it: a `children: WebNode` prop receives the JSX tag body. |
| `map[key]` reads | `map.get(key)` returns `T?`. On Lists, `[index]` throws on a bug; `.get(index)` returns `null` when absence is an expected answer. |

The long tail is deliberately not in this table: the diagnostic will name
the current spelling when you hit it.

## Declarations at a glance

Functions are `def`, with typed parameters, defaults, and `name=value` calls:

```velar
def formatName(name: string, prefix: string = "@") -> string:
    return f"{prefix}{name}"

print(formatName("ada"))
print(formatName("ada", prefix="#"))
```

`type` declares record shapes and aliases; `T?` is optional; every record
type carries a runtime validator for untrusted data:

```velar
type User:
    id: string
    name: string
    avatar: string?

type UserId = string

def load(untrusted: unknown) -> User:
    return User.parse(untrusted)
```

`enum` declares finite string-backed states; a member may map an external
wire spelling without losing its nominal identity:

```velar
enum Status:
    pending
    active
    done

enum ProviderEventKind:
    textDelta = "response.output_text.delta"
    completed = "response.completed"

const status: Status = Status.active
print(ProviderEventKind.textDelta)
```

Classes use typed body fields, one explicit constructor, and explicit
`self`; instances are called directly, without `new`:

```velar
class Session:
    let active: bool = true

    constructor(const id: string):
        pass

    def close() -> null:
        self.active = false

const session = Session("session-1")
session.close()
```

Components (Web extension) return JSX directly — there is no `render` block.
`state` holds a fact, `computed(() => ...)` derives, `action` performs a
user operation with reactive `pending`/`error`:

```velar
component Counter(label: string):
    state count = 0
    const caption = computed(() => f"{label}: {count}")

    action reset() -> null:
        count = 0

    def bump() -> null:
        count += 1

    return <section>
        <button type="button" on:click={bump}>{caption()}</button>
        <button type="button" disabled={reset.pending} on:click={reset}>Reset</button>
    </section>

mount(<Counter label="Clicks" />, "#app")
```

`look` is the checked visual language — a value, composed per element with
`look={...}`. CSS keywords are quoted strings; property names are real DOM
camelCase; units are literal:

```velar
import {border, rgb, spacing} from "velar/look"

const buttonLook = look:
    border = border(0px, rgb(220, 224, 235))
    borderRadius = 10px
    padding = spacing(10px, 14px)
    cursor = "pointer"

    if @hover:
        background = rgb(235, 240, 255)

component SaveButton(children: WebNode):
    return <button look={buttonLook} type="button">{children}</button>
```

## The idioms

These are the canonical shapes, distilled from the project's best-practices
canon. When two spellings both work, use the one shown here.

### Model the data first

Give every finite state an enum, every shape a `type`, and return multiple
values as a named record with shorthand fields — never an out-parameter:

```velar
type TextMeasure:
    lines: number
    words: number

def measure(text: string) -> TextMeasure:
    const lines = text.split("\n").size
    const words = text.split(" ").size
    return {lines, words}
```

### Null discipline

One spelling per job: test presence with `!= null`, default with `??`,
reach through maybes with `?.`, and narrow once — then use the value
directly:

```velar
type Ticket:
    title: string
    assignee: string?

def notifyLine(ticket: Ticket) -> string:
    if ticket.assignee != null:
        return f"notify {ticket.assignee}"
    return f"unassigned: {ticket.title}"

def owner(ticket: Ticket) -> string:
    return ticket.assignee ?? "unassigned"
```

### Chains over cursors

Collection work is method chains; a hand-advanced index loop is the
exception for genuine cursor algorithms. Need the position? Use the
two-slot loop, never a shadow counter. Three or more `or value == ...`
comparisons want a `Set`:

```velar
type Task:
    title: string
    priority: number
    done: bool

const tasks: List<Task> = []
const titles = tasks
    .filter(task => not task.done)
    .sorted(by=task => task.priority)
    .map(task => task.title)

for title, index in titles:
    print(f"{index}: {title}")

const closingWords = Set(["done", "closed", "resolved"])

def isClosing(word: string) -> bool:
    return word in closingWords
```

Mutate state directly — deep reactivity is the default, so rebuild-the-list
spellings are noise: `tasks.append(task)`, `tasks[0].done = true`.

### Dispatch with match

A finite state fans out through one `match` with `case _:` as the only
fallback:

```velar
enum Phase:
    todo
    doing
    done

def advance(phase: Phase) -> Phase:
    match phase:
        case Phase.todo:
            return Phase.doing
        case Phase.doing:
            return Phase.done
        case _:
            return Phase.todo
```

### Small functions, guard first

Handle empty and missing cases with early returns, then write the happy
path unindented. Contracts are one `assert condition else "message"` per
rule at the top:

```velar
def firstLine(text: string) -> string:
    assert text.size <= 1000000 else "Text is beyond the supported size"
    if text == "":
        return ""
    return text.split("\n")[0]
```

Callbacks stay arrows while they are one expression; promote two-statement
logic to a named `def`. Name arguments where a bare value would read as a
mystery: `buttonLook(dangerous=true)`, never `buttonLook(true)`.

### Strings

Build text with f-strings — numbers, bools, and enums interpolate directly.
Data becomes text through `stringify` from `velar/json`. Multi-line text is
a layout string, not a stack of `\n` escapes:

```velar
import {stringify} from "velar/json"

const count = 3
const summary = f"{count} open tickets"
const usage = "
    velar check
    velar test
"
print(summary)
print(usage)
print(stringify({open: count}))
```

### Components: four cells, one job each

`state` holds a fact. `computed` derives from facts. `resource` loads async
data. `action` performs a user operation. Read a resource as
`value != null`; render nothing with `null`; key dynamic children:

```velar fragment
component TicketPanel(id: string):
    state draft = ""
    resource ticket: Ticket = loadTicket(id)
    const heading = computed(() => ticket.value?.title ?? "Loading")

    action save() -> null:
        await saveDraft(id, draft)

    return <section>
        <h2>{heading()}</h2>
        <textarea bind:value={draft}></textarea>
        <button disabled={save.pending} on:click={save}>Save</button>
    </section>
```

Conditional rendering is an ordinary expression — there are no magic JSX
control-flow attributes:

```velar fragment
return <section>
    {loading ? <p aria-busy="true">Loading…</p> : <Results items={items} />}
    <ul>
        {items.map(item => <li key={item.id}>{item.title}</li>)}
    </ul>
</section>
```

### Errors and async

Throw `Error` (or a subclass) with a message that names the broken rule.
Validate untrusted data at the boundary with `Type.parse`, then trust the
types inward. `await` every call whose result or completion you depend on:

```velar
type Config:
    baseUrl: string

def parseConfig(raw: unknown) -> Config:
    const config = Config.parse(raw)
    if config.baseUrl == "":
        throw Error("Config requires a non-empty baseUrl")
    return config
```

### Modules

Export and import by name; a package's public face is a barrel of explicit
re-exports:

```velar fragment
export {measure, firstLine} from "./text.vel"
```

## When Vel is in your way

Vel maintains checked exits so a missing capability never strands the
project. In order:

1. **Missing stdlib capability or a third-party npm package** — declare a
   checked boundary with `extern module`; it is the first choice:

```velar
type Payload:
    id: string

extern module "some-sdk":
    export def load() -> unknown

import js {load} from "some-sdk"

const payload = Payload.parse(load())
print(payload.id)
```

2. **Quick raw access** — `import js unsafe` admits the value as `any`;
   validate it with `Type.parse` at the edge before it touches typed code.
3. **Styling beyond Look** — `import css unsafe "./file.css" before look`
   (or `after look`); trusted markup renders through `unsafe:html`.
4. **A suspected compiler defect blocking you** — build a minimal repro,
   then take the final exit: `velar build` output is readable, source-mapped
   JavaScript that runs without the toolchain.

The full decision tree, including the honest limits of each hatch, is
[docs/escape-hatches.md](escape-hatches.md) in the VelarScript repository.

## The meta-rule

Above everything in this brief: **run `velar check` and do what the
diagnostic says.** Diagnostics name the one current spelling; they are the
canon's enforcement arm, and they outrank any memory of this page. If the
compiler and this brief ever appear to disagree, the compiler is right.
