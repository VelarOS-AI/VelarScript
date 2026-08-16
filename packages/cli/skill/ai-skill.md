# The VelarScript AI skill brief

This is the language brief for AI agents working in a VelarScript project. It
is agent-agnostic markdown, it ships inside the toolchain, and `velar skill`
prints it verbatim — no network, no external documentation. Every code fence
in this file compiles against the current compiler; the brief cannot drift
from the language.

## What VelarScript is

VelarScript (Vel) is a language AI writes and maintains, and humans read and
own. The owner supplies intent and reads the result; you write the Vel and
every later change to it; the compiler guards each change. Vel's parents are
JavaScript and Python. JavaScript is the mother: the program runs inside her,
so behavior defers to JS. Python is the father: the visible spelling follows
him. When unsure about behavior ask the mother, about spelling the father.
**Write on your priors, and the compiler will teach you the rest**: where JS
offers five spellings Vel keeps one, and every removed or mistaken spelling
gets a diagnostic naming the one current spelling. Expect to self-correct in
one round.

The working loop:

1. Write ordinary code the way a fluent JS/Python author would.
2. Run `velar check`. Do exactly what each diagnostic says.
3. Run `velar fix` to apply every rewrite the diagnostics already named
   (retired spellings with one successor, line-ending semicolons, and the rest
   of that family); it never rewrites anything that needs a decision, so what
   is left after it is the real work.
4. Run `velar test`. Run `velar format` to settle layout.

Do not invent workarounds for a diagnostic; it is the language telling you
the canonical spelling.

What a program can compute needs no import; what reaches outside the program
must be imported. A prefix is permanent only when it mirrors a namespace-shaped
JavaScript global, so there are exactly four and the list is closed:
`Json.` (`parse`, `tryParse`, `stringify`, `stableStringify`, `clone`,
`isSerializable`), `Promise.` (`all`, `race`, `sleep`, `timeout`, `retry`,
`map`, `series`), `Math.` (`pi`, `e`, `tau`, `infinity`, `min`, `max`, `clamp`,
`sign`, `trunc`, `sqrt`, `cbrt`, `pow`, `exp`, `log`, `log2`, `log10`, `sin`,
`cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `degrees`, `radians`, `hypot`,
`random`, `randomInt`, `gcd`, `lcm`), and `Text.` (`trimStart`, `trimEnd`,
`capitalize`, `title`, `lines`, `lineStarts`, `chunks`, `words`, `slug`,
`normalize`, `truncate`, `indent`, `dedent`, `normalizeWhitespace`, `utf8Size`,
`escapeHtml`, `codePoint`, `fromCodePoint`, `matches`, `findMatch`,
`findMatches`, `replaceMatches`, `splitPattern`). A string method is a core
operation; `Text.*` is the extension toolbox, and nothing moves between them.
Web visual builders are named imports from `velar/look` — there is no `Look`
global in JavaScript, so there is no `Look.` prefix here either. These names
need no import and cannot be shadowed: `const Text = 1` is rejected. `print`,
`str`, `number`, `equals`, and `range` are likewise in the Core prelude —
`equals(a, b)` is the one spelling of content comparison. One roster both
grants these nine names and protects them, so the protection is never a stale
copy: adding a name to Core refuses it as a binding with no list to edit, and
protecting a name the compiler has no type for fails the build. Capability
modules such as `velar/http`, `velar/storage`, and `velar/browser` remain
explicit imports. Core durations use `ms` or `s`, so write
`await Promise.sleep(250ms)`, not a bare number.

## Project setup

A VelarScript project is a directory containing a `velar.json` manifest. Let
the toolchain write it — `velar create my-app` scaffolds the Web template, and
`--template node|desktop|docs|library|component` picks another. Each writes
`velar.json`, a `package.json` whose scripts are the gates, a `src/` tree, a
passing test, and an `AGENTS.md`.

Writing the manifest yourself: `formatVersion` is required, `extensions` may be
omitted by a project that loads none, `entry` defaults to `src/main.vel`,
`outDir` to `dist`, and `publicDir` to `public`.

A Core project (CLI, library, Node) loads no extensions:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "extensions": []
}
```

A Web project activates the Web extension **by package name**. That one line is
what turns on `component`, JSX, `state`, `computed`, `resource`, `action`,
`watch`, `look`, and `mount`; without it `component` is an unknown declaration
keyword and every JSX token is a parse error:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "extensions": ["@velarscript/web"]
}
```

An extension owns its own manifest key — `"web": {"title": "My App"}` sets the
document title. Anything else in `velar.json` is rejected by name.

**Files the toolchain owns.** `dist/` is build output, and in a Web build the
toolchain writes `dist/index.html` itself — the title comes from `web.title`, the
favicon from `web.icon` (a `publicDir`-relative `.svg`/`.png`/`.ico` path; the
build fails if no such file exists), the
mount host is `<div id="app"></div>`, and assets are content-hashed. Never author
that file; a `public/index.html` is overwritten by the generated one, while
everything else in `public/` is copied through. `.velar/` is scratch; both belong in `.gitignore`.

**Tests.** `velar test` finds every `*.test.vel` file under the project (skipping
`outDir` and `publicDir`) and runs its `test "name":` blocks. The name is a
sentence about the code, quoted verbatim by the reporter and unique in its
module; the body may `await` directly and needs no `export`. A file that declares no tests is a failure rather than a skip.
`velar test --browser` runs `*.browser.test.vel` in a real browser — and bare
`--browser` is **Chromium only**. Three engines is `--browser=all` (or
`--browser all`), which is what any cross-browser claim costs;
`--browser=firefox` and `--browser=webkit` pick one.

**Separate the mounted entrypoint from testable code.** A test runs in Node with
no DOM, so a headless test that imports the module calling `mount` fails on
`document`. Keep the entry trivial and put everything worth testing in modules it
imports:

```velar fragment
// src/main.vel — the mounted entrypoint; no test imports this file
import {App} from "./app.vel"

mount(<App />, "#app")
```

Components, functions, and types live in `src/app.vel` and its neighbours;
`src/app.test.vel` tests those exports headlessly and
`src/app.browser.test.vel` drives the mounted application.

**A browser test drives the page; it does not build one.** Its body runs in the
test process against a page already running the production build, so `mount`,
JSX, and `document` are unavailable there — the driving surface is
`velar/web-test`, and selectors are ordinary CSS:

```velar fragment
import {expect} from "velar/test"
import {browser, localStorage} from "velar/web-test"

test "adding a link shows it in the list":
    await browser.open("/")
    await browser.fill("#title", "Vel")
    await browser.click("#add")
    await browser.waitForText("[data-item]", "Vel")
    expect(await browser.text("[data-count]")).toBe("1")
    expect(await localStorage.get("reading")).toBe(`[{"title":"Vel"}]`)
```

`browser` also carries `reload`, `press`, `select`, `attribute`, `count`,
`visible`, `waitFor`, `currentPath`, and `viewport`; `localStorage` and
`sessionStorage` read and write the page's raw storage. Any unhandled error —
in the page or in the test process — fails the test.

`velar/web-test` may be imported **only** from a `*.browser.test.vel` module.
Reaching for it from application code, from a plain `*.test.vel`, through
`import js`, or through a re-export is rejected on the import line — rename the
module or move the browser test into one of its own. Application code that
needs the page reaches it through `velar/browser` instead.

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
| Renaming a binding away from `type`, `state`, `from`, `match`, `as`, `action`, `resource`, `watch`, `look`, `component` | Don't. Declaration words are contextual: each declares only in its own shape, so `const {type, from} = event` and `const state = "ready"` are ordinary code in Core and Web alike. `enum` and `case` are the exceptions — `enum` is a real VelarScript keyword, `case` is reserved by JavaScript — so neither can be a binding name; both stay fine as record fields, member names, and `match` branches. |
| A component's `mounted:` / `cleanup:` block | `@mounted:` / `@cleanup:`. Lifecycle hooks live in the language's `@` namespace, which is why a component can also declare its own `def mounted()`. |
| Two statements on one line | One statement per line; there are no semicolons. A line starting with `.` or `?.` continues the previous line, so method chains format normally. |
| `count++` | `count += 1` |
| `call(name: value)` named argument | `call(name=value)` |
| Importing `range` | `range(...)` is a Core prelude function and needs no import. |
| `import {sqrt} from "velar/math"` | `Math.sqrt(x)`; `Math.` is permanent. `velar fix` performs the rewrite. |
| `Look.spacing(16px)` | `spacing(16px)` with `import {spacing} from "velar/look"`; the `Look.` prefix is retired. `velar fix` performs the rewrite. |
| `"""triple-quoted"""` for a block of text | A layout string: a double quote followed immediately by a newline opens it; a quote back at the opening line's indentation closes it. Backtick strings are real, but always single-line. |
| Escaping `\"` through a JSON, HTML, or selector string | Use backticks: `` `{"name":"Nova"}` `` is the same `string` value, with `"` as ordinary text. Prefixes are orthogonal (`` f` ``, `` r` ``, `` rf` ``), and `velar format` picks the delimiter for you (`"` by default, backticks when the text contains `"`), so write whichever is convenient. |
| `0xFF`, `0b1010`, `007`, `.5` | Decimal only: `255`, `10`, `7`, `0.5`. Group long digits with `_` — `1_000_000`. `Infinity` and `NaN` are not literals: write `1 / 0` and `0 / 0`. |
| `a == b == c` | Equality never chains: `a == b and b == c`. Ordered chains work but must point one way — `0 < index <= size` is fine, `a < b > c` is not. An `in` or `is` test inside a comparison needs parentheses. |
| A line that is only a value — `x == 5`, `items[0]`, `"a note"` | A statement must do something: call, assign, `await`, or `async`. A computed-and-discarded value is a compile error, and a bare string is not a docstring — use `//`. |
| A block comment that starts or ends beside code on a multi-line span | `/* */` exists and nests — commenting out a region that already holds a comment works — but a multi-line one takes whole lines: only `/*` on its opening line, only `*/` on its closing line. Within a single line it can sit anywhere: `call(/* why */ value)`. |
| `x if cond else y` | `cond ? x : y` |
| `&&`, `\|\|`, `!`, `===`, `var`, `elif`, `None`, `undefined` | `and`, `or`, `not`, `==`, `let`/`const`, `else if`, `null`, `null`. |
| `f"{user}"` or `str(user)` on a record | Text conversion accepts strings, numbers, bools, enums, and `null` only. `print(user)` inspects a value; permanent `Json.stringify(user)` builds data text without an import. |
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

A generic body that must order, interpolate, or serialize its type parameter
names a bound — `def label<T: Text>(value: T)`; the diagnostic names the one
you need.

**There are two arrows and they are not interchangeable.** `=>` is the
value-level arrow: it introduces a lambda body. `->` is the type-level arrow:
it names a result. They stand next to each other most often on a callback prop
— the type is written with `->`, the value handed to it with `=>`:

```velar
type Transform = (value: number) -> number

const double: Transform = value => value * 2

component Stepper(step: number, onChange: (next: number) -> null):
    return <button type="button" on:click={() => onChange(step + 1)}>+1</button>

mount(<Stepper step={double(1)} onChange={next => print(next)} />, "#app")
```

Parameter names in a function type are optional but worth writing:
`(title: string, author: string) -> Promise<null>` says at the call site what
`(string, string) -> Promise<null>` makes you guess. An async callback's
**type** names the Promise, while an `async def` **declaration** annotates the
resolved value — `async def loadUser(id: string) -> User` satisfies
`(id: string) -> Promise<User>`.

`type` declares record shapes and aliases, `T?` is optional, and every record
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

Classes use typed body fields, one explicit constructor, and explicit `self`;
instances are called directly, without `new`:

```velar
class Session:
    let active: bool = true

    constructor(const id: string):
        pass

    def close():
        self.active = false

    @dispose:
        self.close()

const session = Session("session-1")
```

`@name` members belong to the language and can never collide with yours.
`@dispose:` is the release contract — never called directly — that
`using name = expression` runs on every exit from the owning scope (block end,
`return`, `break`, `continue`, throw), in reverse declaration order. A derived
`@dispose:` adds to its base's; the compiler runs derived first, then base.
Standard handles already have it, so `using watcher = await watchFiles(path)`
above an `async for` needs no `try`/`finally`. An owned value may not leave its
scope: `return handle`, storing it outside, or capturing it in a closure that
escapes are rejected — return the data you read from it, or move the `using` up
to the scope that really owns it. A JavaScript handle is owned by composition:
hold it in a field of a class whose `@dispose:` releases it.

Components (Web extension) return JSX directly — there is no `render` block.
`state` holds a fact, `computed(() => ...)` derives, `action` performs a
user operation with reactive `pending`/`error`:

```velar
component Counter(label: string):
    state count = 0
    const caption = computed(() => f"{label}: {count}")

    action reset():
        count = 0

    def bump():
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

A `look:` literal is built once, so its conditions and values cannot read state; put a reactive visual on the element with `look={active ? a : b}` or `look:color={...}`. Declare checked motion as a module-level `keyframes:` value and pass it to `animate` from `velar/look`; disable nonessential motion at the CSS layer:

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
Data becomes text through permanent `Json.stringify`. Multi-line text is
a layout string, not a stack of `\n` escapes. Text that contains `"` — a JSON
fixture, a quoted selector — goes in backticks instead of being escaped:

```velar
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
print(Json.stringify({open: count}))
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

    action save():
        await saveDraft(id, draft)

    watch id:
        async ticket.reload()

    return <section>
        <h2>{heading()}</h2>
        <textarea bind:value={draft}></textarea>
        <button disabled={save.pending} on:click={save}>Save</button>
    </section>
```

Lifecycle is two sibling blocks in the language's own `@` namespace —
`@mounted:` runs once after the DOM is inserted and may `await`; `@cleanup:`
runs once before the component is destroyed and is synchronous:

```velar fragment
component Chart(points: List<number>):
    let canvas: CanvasElement? = null

    @mounted:
        if canvas != null:
            drawChart(canvas, points)

    @cleanup:
        releaseChart()

    return <canvas ref={canvas}></canvas>
```

**A resource loads once, at mount, and does not refetch when its inputs
change** — a new `id` prop leaves the old data on screen. "Refetch when the
input changes" is the `watch` above: watch the input, and start `reload()` with
the detached `async` statement, because a watch body is synchronous. `reload()`
re-evaluates the initializer against the current inputs, keeps the last value if
it fails, and puts the failure in `error`. Actions do not queue either: two
clicks run two calls, `pending` means any call is active, so guard with
`disabled={save.pending}`.

Conditional rendering is an ordinary expression — there are no magic JSX
control-flow attributes:

```velar fragment
component Panel:
    return <section>
        {loading ? <p aria-busy="true">Loading…</p> : <Results items={items} />}
        <ul>
            {items.map(item => <li key={item.id}>{item.title}</li>)}
        </ul>
    </section>
```

**A component prop is a readonly projection**, and readonly travels: inside
`component ProjectList(items: List<Item>)` the body sees `readonly List<Item>`,
so a helper it calls takes `items: readonly List<Item>`, and a `List` that
helper builds is `List<readonly Item>`. Declare the helper that way once rather
than copying the data to widen it.

`velar/storage` persists JSON and validates on the way back in, so a read needs
a **named** runtime type — a primitive or generic spelling is a type, not a
value:

```velar fragment
import {storage} from "velar/storage"

type SavedItem:
    title: string

type SavedItems = List<SavedItem>

const items = storage.get("reading", SavedItems, [])
storage.set("reading", items)
```

The third argument is the fallback for missing or invalid data; `session` and
`database(name)` from the same module carry the same shape.

### Errors and async

Throw `Error` (or a subclass) with a message that names the broken rule.
An error's class is its only classification — discriminate with
`if error is FileNotFoundError:` and read `error.code` (the declared class
name) only when the identity must survive a log or JSON boundary. The nameable
capability classes need no import: `FileNotFoundError`, `PermissionError`,
`NotADirectoryError`, `FileExistsError`, `AddressInUseError`, plus
`ValidationError`, `NarrowingError`, and `IndexError`.
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

An expected failure is an optional, not a block: `try expression` produces
`null` when anything in the chain throws, and its result must be consumed —
`const settings = try Settings.parse(raw) ?? defaults`. Use `try`/`catch` when the details matter.

### Modules

Export and import by name; a package's public face is a barrel of explicit
re-exports — `export {measure, firstLine} from "./text.vel"`. There is no
`import type`: Vel does not erase types, so a type carries its runtime
validator and a type import is an ordinary import.

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

print(Payload.parse(load()).id)
```

An `extern module` block governs only the file that contains it, so **declare it
once in an adapter module** and re-export a checked surface. Do not paste extern
blocks across consumers:

```velar
extern module "text-tools":
    export def format(value: string) -> string

    export class Formatter:
        constructor(prefix: string)
        def format(value: number) -> string

import js {Formatter, format} from "text-tools"

export const formatText = format
export type TextFormatter = Formatter

export def formatter(prefix: string) -> Formatter:
    return Formatter(prefix)
```

Consumers then write ordinary Vel — `import {TextFormatter, formatText,
formatter} from "./text-tools.vel"` — and every call, construction, and
annotation is checked. A function export re-exports directly as a value; a class
needs a factory `def` (a class name is not a value) plus an exported `type`
alias so consumers can annotate. Validate anything declared `-> unknown` inside
the adapter, so only checked types leave it.

**Extern arguments are read-only.** What crosses is the raw identity, so a
package that writes into what you passed changes the real data while nothing on
the Vel side observes it — no recompute, no re-render, no refreshed flow fact —
until some unrelated Vel assignment invalidates. Have the package **return** the
data and assign the result on the Vel side.

2. **Quick raw access** — `import js unsafe` admits the value as `any`.
   Operations on an `any` are raw JavaScript with no runtime check anywhere: it
   is assignable to every type without validation, and an `any` holding
   `undefined` even answers `false` to `== null`. The import statement is the
   only correctness boundary — validate with `Type.parse` there, before the
   value touches typed code.
3. **Styling beyond Look** — `import css unsafe "./file.css" before look`
   (or `after look`); trusted markup renders through `unsafe:html`.
4. **A suspected compiler defect blocking you** — run `velar repro` (below),
   then take the final exit: `velar build` output is readable, source-mapped
   JavaScript that runs without the toolchain.

The full decision tree, including the honest limits of each hatch, is
[docs/escape-hatches.md](https://github.com/VelarOS-AI/VelarScript/blob/main/docs/escape-hatches.md).

## When you hit a compiler wall

A diagnostic that cannot be satisfied, an emit that misbehaves, a check that
contradicts this brief: you are this language's reporter as much as its author,
and the channel is the one a human uses. Do not quietly work around a defect and
leave the next reader to rediscover it.

1. **Run `velar repro`.** It writes a self-contained minimal reproduction to
   disk and prints the path — the source the diagnostic touches, `velar.json`,
   the verbatim output, and the versions. It uploads nothing and collects
   nothing about the machine; whether to send it is the human's decision.
2. **Fill in the produced `README.md`.** Two of its three sections are blanks:
   *What I wrote (or wanted to write)* and *How I resolved it* — the workaround,
   or the single word `blocked`. *What the compiler said* is already filled in
   verbatim; do not trim it.
3. **File it** with the repository's defect template
   (`.github/ISSUE_TEMPLATE/`), which asks for exactly those three sections.
   Paste the README.

A word that reads wrong is worth the same trip. The spelling-objection template
exists for it, no alternative word is required, and while there is no
compatibility promise, changing a word costs nothing yet.

## Where to look up what this brief leaves out

The repository carries a **tour** that shows every spelling exactly once, as
compiling projects you can run: `examples/tour/core/` (17 numbered chapters,
values through testing), `examples/tour/web/` (13 — components, Look, routing,
both kinds of test), `examples/tour/desktop/` (4). When you are about to guess
at a spelling, open the chapter instead. `examples/app/` is the companion — one
real application, showing how the pieces are put together.

## The meta-rule

Above everything in this brief: **run `velar check` and do what the
diagnostic says.** Diagnostics name the one current spelling; they are the
canon's enforcement arm, and they outrank any memory of this page. If the
compiler and this brief ever appear to disagree, the compiler is right.
