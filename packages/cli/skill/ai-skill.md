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
the first two rows produce a teaching diagnostic, so `velar check` will catch
them; the first two are the **silent traps** in the list — read them twice.

| Your reflex | Write instead |
| --- | --- |
| `"${value}"` or `` `${value}` `` template interpolation | `f"{value}"` or `` f`{value}` ``. Only the `f` prefix interpolates, in either delimiter; `${...}` is legal literal text in every string — including a backtick one — so nothing warns you. |
| `a // b` floor division | `//` starts a comment, so the rest of the line disappears and `const c = a // b` silently binds `a`. Write `(a / b).floor()`. |
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
| `"""triple-quoted"""` for a block of text | A layout string: a double quote followed immediately by a newline opens it; a quote back at the opening line's indentation closes it. Backtick strings are real, but always single-line. |
| Escaping `\"` through a JSON, HTML, or selector string | Use backticks: `` `{"name":"Nova"}` `` is the same `string` value, with `"` as ordinary text. Prefixes are orthogonal (`` f` ``, `` r` ``, `` rf` ``), and `velar format` picks the delimiter for you (`"` by default, backticks when the text contains `"`), so write whichever is convenient. |
| `0xFF`, `0b1010`, `007`, `.5` | Decimal only: `255`, `10`, `7`, `0.5`. Group long digits with `_` — `1_000_000`. `Infinity` and `NaN` are not literals: write `1 / 0` and `0 / 0`. |
| `a == b == c` | Equality never chains: `a == b and b == c`. Ordered chains work but must point one way — `0 < index <= size` is fine, `a < b > c` is not. An `in` or `is` test inside a comparison needs parentheses. |
| A line that is only a value — `x == 5`, `items[0]`, `"a note"` | A statement must do something: call, assign, `await`, or `async`. A computed-and-discarded value is a compile error, and a bare string is not a docstring — use `//`. |
| A block comment that starts or ends beside code on a multi-line span | `/* */` exists and nests — commenting out a region that already holds a comment works — but a multi-line one takes whole lines: only `/*` on its opening line, only `*/` on its closing line. Within a single line it can sit anywhere: `call(/* why */ value)`. |
| `x if cond else y` | `cond ? x : y` |
| `&&`, `\|\|`, `!`, `===`, `var`, `elif`, `None`, `undefined` | `and`, `or`, `not`, `==`, `let`/`const`, `else if`, `null`, `null`. |
| `f"{user}"` or `str(user)` on a record | Text conversion accepts strings, numbers, bools, enums, and `null` only. `print(user)` inspects a value; `stringify(user)` from `velar/json` builds data text. |
| Calling an async function and moving on | A dropped Promise is a compile error. `await task()` to wait; `async task()` to run it detached. |
| `flag or name ?? fallback` | Parenthesize — `??` never shares an unparenthesized chain with `and`/`or`. |
| `onClick={handler}` | `on:click={handler}`; form binding is `bind:value={state}`. |
| Implicit `{props.children}` | Declare it: a `children: WebNode` prop receives the JSX tag body. |
| `map[key]` reads | `map.get(key)` returns `T?`. On Lists, `[index]` throws on a bug; `.get(index)` returns `null` when absence is an expected answer. |
| `[...text]` or `list(text)` for characters | `text.split("")` — the empty separator splits per Unicode code point. |
| `x !== x` or `Number.isNaN(x)` | Number predicates are members: `x.isNaN()`, `x.isFinite()`, `x.isInteger()`. `NaN == NaN` is `true` — equality is SameValueZero. |
| `text.trim().size == 0` blank test | `text.isBlank()` — `true` for empty or whitespace-only text. |
| `while true:` plus a `pop()` null check to drain a List | `pop(index=-1)` returns `T` and throws `IndexError` when empty or out of range, so drain with `while items.size > 0:`. |
| `1 == "1"`, `user == "a"`, `A.member == B.member`, `raw == Kind.member` | `==`/`!=` require the operand types to intersect. Compare enums with `Kind.parse(raw) == Kind.member` when the text must name a member — `parse` throws otherwise — or `str(Kind.member) == raw` when unknown values must be ignored, as on an open wire protocol. `value == null` on an optional is always fine. |
| `[1, 2] == [1, 2]` content comparison | Collection `==` is identity; `equals(a, b)` compares data deeply (Lists ordered, Sets/Maps by members, SameValueZero leaves) with no import. |
| Iterating or spreading an enum object | `Status.values()` returns the members in declaration order as a fresh `List<Status>`. |
| `sorted()`, `min()`, or `sorted(by=)` over enums | Only `number`, `string`, and single-category unions are ordered. Give the order explicitly with `sorted(by=row => row.rank)` or a string-backed enum (`low = "1-low"`). |

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

A `look:` literal is built once, so its conditions and values cannot read state; put a reactive visual on the element with `look={active ? a : b}` or `look:color={...}`. Declare checked motion as a module-level `keyframes:` value and pass it to `animate`; disable nonessential motion at the CSS layer:

```velar
import {animate} from "velar/look"

const spin = keyframes:
    from:
        rotate = 0deg
    to:
        rotate = 1turn

const rotatingLook = look:
    if not motion.reduced:
        animation = animate(spin, 1s, easing="linear", loop=true)
```

The `animation` property accepts only `Animation`, `List<Animation>`, or `null`; a CSS animation string is rejected. Bind a changing animation on the element with `look:animation={active ? animate(spin, 1s) : null}`. Native animation longhands remain outside Look because `animate` owns the checked contract.

Form state binds with `bind:value={name}` (also a writable path such as `bind:value={form.email}`), `bind:checked={flag}`, and `bind:group={choice}` — radio state holds the selected input's `value`, checkbox `List<string>` state holds the checked values; the event object has no `target`.

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

One-liners worth knowing: `values.flatMap(x => x.parts)` maps then flattens
one level; `values.filter(x => x != null)` — exactly that predicate — drops
absences and narrows `List<T?>` to `List<T>`; Sets combine with the copying
algebra `a.union(b)`, `a.intersection(b)`, `a.difference(b)`.

Mutate state directly — deep reactivity is the default, so rebuild-the-list
spellings are noise: `tasks.append(task)`, `tasks[0].done = true`,
`panel.open = not panel.open`.

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

Build text with f-strings — numbers, bools, enums, and Web unit values with a declared text form interpolate directly.
Data becomes text through `stringify` from `velar/json`. Multi-line text is
a layout string, not a stack of `\n` escapes. Text that contains `"` — a JSON
fixture, a quoted selector — goes in backticks instead of being escaped:

```velar
import {stringify} from "velar/json"

const count = 3
const gap = 16px
const summary = f"{count} open tickets"
const fixture = `{"open":3,"state":"ready"}`
const gapLabel = f"gap: {gap}"
const usage = "
    velar check
    velar test
"
print(summary)
print(fixture)
print(gapLabel)
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
