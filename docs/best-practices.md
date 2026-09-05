# VelarScript best practices

This is the canon: the one idiomatic way to write VelarScript. The project's
core tenet is that **AI writes and modifies the code, and humans read it** —
so the next author of any file is an AI that has never seen it, and the
reviewer is a person who may not program. Both depend on every Vel codebase
having exactly one shape. When two spellings both work,
this document names the one to use. The compiler enforces most of the canon;
`velar format` settles everything about layout. What remains is judgment,
and this page is that judgment, written down.

**Every program on this page is complete and runs as written.** Copy one into
`src/main.vel` and `velar run` it; the test module goes in a `*.test.vel` file
and the component program in a Web project. Nothing here is a sketch with the
hard parts elided — the code you are being asked to imitate is code that
compiles.

The meta-rule above all others: **run `velar check` and do what the
diagnostic says**, then `velar fix` for the rewrites that are provably
behavior-preserving. Diagnostics name the one current spelling; they are the
canon's enforcement arm, and they outrank any memory of this page.

## 1. Model the data first

Give every finite state an enum, every shape a `type`, and let unions carry
the alternatives. Data that is modeled precisely makes every function after
it shorter. Return multiple values as a named record with shorthand fields,
never through an out-parameter or a class — the type name is free
documentation. When an external protocol owns the wire spelling, map it in the
enum instead of writing a conversion function: a member already satisfies
contracts for the scalar its wire value is — `string` for a mapped string,
`number` for a pinned integer such as `v2 = 2`.

```velar
enum TicketStatus:
    open
    pending
    resolved

enum ProviderEventKind:
    textDelta = "response.output_text.delta"
    completed = "response.completed"

type Ticket:
    id: string
    title: string
    status: TicketStatus
    assignee: string?

type Triage:
    open: number
    unassigned: number

def triage(tickets: List<Ticket>) -> Triage:
    const open = tickets.filter(ticket => ticket.status == TicketStatus.open).size
    const unassigned = tickets.filter(ticket => ticket.assignee == null).size
    return {open, unassigned}

def wireName(kind: ProviderEventKind) -> string: return kind

const board: List<Ticket> = [
    {id: "t-1", title: "Crash on save", status: TicketStatus.open, assignee: null},
    {id: "t-2", title: "Slow search", status: TicketStatus.pending, assignee: "ada"},
    {id: "t-3", title: "Stale cache", status: TicketStatus.open, assignee: "lin"},
]

const counts = triage(board)
print(f"{counts.open} open, {counts.unassigned} unassigned")
print(wireName(ProviderEventKind.textDelta))
```

## 2. Null discipline

One spelling per job. Test presence with `!= null`, provide a default with
`??`, reach through maybes with `?.`, and narrow once — then use the value
directly. Do not re-wrap optionals or copy them into extra locals.
Equality requires the two sides to share possible values, so compare an
enum against an enum — `Kind.parse(raw) == Kind.textDelta` — rather than
against a raw string.

Use `[]` when the index must exist (it throws on a bug) and `.get()` when
absence is an expected answer. That difference is the reader's signal. The
same split governs removal: `pop(index=-1)` throws on an empty List, so
drain with `while items.size > 0:` rather than testing a result for null.

```velar
enum Channel:
    email
    push

type Profile:
    city: string?

type Account:
    profile: Profile?

type Ticket:
    title: string
    assignee: string?

def notify(name: string): print(f"notifying {name}")

def announce(ticket: Ticket, account: Account?, raw: string):
    if ticket.assignee != null: notify(ticket.assignee)
    const label = ticket.assignee ?? "unassigned"
    const city = account?.profile?.city ?? "unknown"
    const channel = Channel.parse(raw) == Channel.push ? "push" : "mail"
    print(f"{ticket.title}: {label} in {city} by {channel}")

def drain(queue: List<Ticket>) -> number:
    let handled = 0
    while queue.size > 0:
        const ticket = queue.pop(index=-1)
        handled += 1
        print(f"handled {ticket.title}")
    return handled

const queue: List<Ticket> = [
    {title: "Crash on save", assignee: null},
    {title: "Slow search", assignee: "ada"},
]

announce(queue[0], {profile: {city: "Delft"}}, "push")
print(f"{drain(queue)} handled")
```

## 3. Chains over cursors

Collection work is method chains: `filter`, `map`, `sorted(by=...)`,
`reduce`, `sum`. A hand-advanced index loop is the exception reserved for
genuine cursor algorithms, not the default. A List callback that needs its
snapshot position declares the parameter after the element, as in
`items.map((item, index) => ...)` and
`items.reduce((total, item, index) => ..., 0)`. Imperative work uses the
two-slot loop; never maintain a shadow counter.

When a loop only fills a fresh List from another List, use the collection API
that states the data flow: `map` for projection, `filter` for selection,
`filter(...).map(...)` for both, and `flatMap` when each input contributes a
List. Queries likewise use `some`, `every`, and `find`. Keep an explicit `for`
for mutation, custom early exits, multiple outputs, stateful accumulation, or
effects. `velar check` reports A8/A13 when it can prove an expanded loop is one
of these APIs.

Membership is `in`. Three or more `or value == ...` comparisons means the
values wanted to be a `Set` constant. Mutate state directly — deep reactivity
is the default, so rebuild-the-list spellings are noise.

```velar
type Task:
    title: string
    priority: number
    done: bool

const closingWords = Set(["done", "closed", "resolved"])

def isClosing(word: string) -> bool: return word in closingWords

def openTitles(tasks: List<Task>) -> List<string>:
    return tasks
        .filter(task => not task.done)
        .sorted(by=task => task.priority)
        .map(task => task.title)

const tasks: List<Task> = [
    {title: "Ship the parser", priority: 2, done: false},
    {title: "Write the tour", priority: 1, done: false},
    {title: "Fix the gate", priority: 3, done: true},
]

for title, index in openTitles(tasks): print(f"{index}: {title}")

tasks.append({title: "Review the brief", priority: 4, done: false})
tasks[0].done = true
tasks[0].done = not tasks[0].done

const weight = tasks.map(task => task.priority).sum()
const closing = isClosing("resolved")
print(f"{tasks.size} tasks, weight {weight}, closing {closing}")
```

## 4. Dispatch with match

A finite state fans out through one `match` with `case _:` as the only
fallback. An `else if x == ...` ladder over an enum is the anti-pattern; so
is a family of parallel mapping functions that each re-list the members.

```velar
enum Status:
    todo
    doing
    done

def advance(status: Status) -> Status:
    match status:
        case Status.todo: return Status.doing
        case Status.doing: return Status.done
        case _: return Status.todo

let status = Status.todo
for step in range(4):
    status = advance(status)
    print(f"{step}: {status}")
```

## 5. Small functions, guard first

Handle the empty and missing cases with early returns, then write the happy
path unindented. Contracts are `assert condition else "message"` at the top
of the function — one line per rule, message required.

Callbacks stay arrows while they are one expression; the moment logic needs
two statements, promote it to a named `def` — the name is documentation.
Name arguments at call sites where a bare value would read as a mystery:
`label(dangerous=true)`, never `label(true)`.

A type parameter stays unbounded by default. Add a bound only when the body
actually uses the capability — `<T: Text>` because it interpolates the value,
`<T: Comparable>` because it orders it, `<T: Data>` because it serializes it.
A bound the body does not need is a narrower contract for no gain, and it is
the caller who pays. The chain runs `Comparable ⊂ Text ⊂ Data`, so one word
always says it; reach for the weakest one that compiles.

```velar
def firstLine(text: string) -> string:
    assert text.size <= 1000000 else "Text is beyond the supported size"
    if text == "": return ""
    return text.split("\n")[0]

def summarize<T: Text>(values: List<T>) -> string: return values.map(str).join(", ")

def label(text: string, dangerous: bool = false) -> string: return dangerous ? f"! {text}" : text

print(firstLine("first\nsecond"))
print(summarize([1, 2, 3]))
print(label("Delete", dangerous=true))
```

## 6. Strings

Text is built with f-strings — numbers, bools, and enums interpolate
directly, and `+` chains or conversion ceremony are noise.

Use double quotes for ordinary inline text and backticks when the text itself
contains double quotes, especially JSON fixtures; `velar format` chooses the
delimiter with fewer escapes. Backticks are still Velar strings, not JavaScript
templates: only an `f` prefix plus `{value}` interpolates, while `${value}` is
literal text.

Data becomes text through `Json.stringify`, never through
interpolation of a record. Multi-line text is a layout string, not a stack
of `\n` escapes.

```velar
type Report:
    open: number
    ready: bool

const report: Report = {open: 3, ready: true}
const summary = f"{report.open} open tickets, ready {report.ready}"
const fixture = `{"open":3,"state":"ready"}`
const usage = "
    velar check
    velar test
"

print(summary)
print(fixture)
print(usage)
print(Json.stringify(report))
```

## 7. Components: four cells, one job each

`state` holds a fact. `computed name = ...` derives from facts. `resource` loads
async data. `action` performs a user operation. Choosing the right one removes
most component code.

The first two are one half of a grid, and reading it that way is what makes the
choice obvious:

|            | not reactive | reactive   |
| ---------- | ------------ | ---------- |
| writable   | `let`        | `state`    |
| read-only  | `const`      | `computed` |

Reach for `const` when you mean *this never changes* — that is now a promise the
word keeps — and for `computed` when the value is derived and therefore does.

Read a resource as `value != null`; never wrap a plain field read in
another `computed`. A `computed` is read bare, like state, so there is nothing
to hoist into a `const` when you use it three times. Render nothing with
`null`. Accept children by declaring a
`children: WebNode` prop. Extract every reused look into a named value and
compose with `look={...}`.

```velar
import {spacing} from "velar/look"

type Ticket:
    id: string
    title: string

const panelLook = look:
    display = "grid"
    gap = 12px
    padding = spacing(16px, 20px)

async def loadTicket(id: string) -> Ticket: return {id, title: f"Ticket {id}"}

async def saveDraft(id: string, draft: string): print(f"{id}: {draft}")

component TicketPanel(id: string):
    state draft = ""
    resource ticket: Ticket = loadTicket(id)
    computed heading = ticket.value?.title ?? "Loading"

    action save():
        await saveDraft(id, draft)

    return <section look={panelLook}>
        <h2>{heading}</h2>
        <textarea bind:value={draft}></textarea>
        <button type="button" disabled={save.pending} on:click={save}>Save</button>
    </section>

mount(<TicketPanel id="t-1" />, "#app")
```

## 8. Keep store writes easy to find

Props are live reactive inputs and their data is mutable by default. Use that
when a component genuinely owns the edit. For shared product state, keep the
writes in store actions and pass a `readonly` prop to presentation components:
one writer list makes validation, telemetry, and business rules easy to audit.
The qualifier is a deliberate component contract, not ceremony to put on every
prop — add it when the component should render or request a change, and leave it
off when direct editing is the component's job.

```velar
type Task:
    id: string
    title: string
    done: bool

state tasks: List<Task> = [
    {id: "ship", title: "Ship the compiler", done: false},
    {id: "docs", title: "Publish the guide", done: false},
]

def toggleTask(id: string):
    const task = tasks.find(item => item.id == id)
    if task != null: task.done = not task.done

component TaskRow(task: readonly Task, onToggle: (id: string) -> null):
    def choose(): onToggle(task.id)

    return <li>
        <button type="button" on:click={choose}>{task.done ? "Reopen" : "Complete"}</button>
        <span>{task.title}</span>
    </li>

component App:
    return <main>
        <h1>Release tasks</h1>
        <ul>{tasks.map(task => <TaskRow key={task.id} task={task} onToggle={toggleTask} />)}</ul>
    </main>

mount(<App />, "#app")
```

## 9. Errors and async

Throw `Error` (or a subclass) with a message that names the rule that was
broken, in the same voice as the assert messages. Validate untrusted data at
the boundary with `Type.parse`, then trust the types inward. `await` every
call whose result or completion you depend on — a dropped promise is a bug,
and the compiler treats it as one.

Sort failures by whether the caller already expects them. An expected failure
is an optional — `try` it and supply the fallback at the use site, where a
reader can see the decision. An unexpected one is a `try`/`catch` block,
because the details are what you need. Never hand-write the third shape, a
`def tryParse` that wraps a parse in try/catch and returns null.

Every handle a scope opens, that scope owns: write `using` and delete the
`try`/`finally` you were about to write. It covers the exits that are easy to
forget — an early `return`, a `break` out of a pull loop, a throw from three
frames down. Give a class an `@dispose:` block only when it truly owns
something a scope should release; delegate it to the `close()` or `stop()` the
class already publishes rather than inventing a second verb, and keep it safe
to run twice.

```velar
type Settings:
    retries: number

class Session:
    let open: bool = true

    constructor(const name: string): pass

    def close(): self.open = false

    @dispose: self.close()

def defaultSettings() -> Settings: return {retries: 3}

def load(raw: unknown) -> Settings:
    const settings = try Settings.parse(raw) ?? defaultSettings()
    if settings.retries < 0: throw Error("Settings requires a non-negative retry count")
    return settings

async def replay(raw: unknown) -> string:
    using session = Session("replay")
    const settings = load(raw)
    await Promise.sleep(1ms)
    return f"{session.name}: {settings.retries} retries"

async def main():
    print(await replay({retries: 5}))
    print(await replay("not a settings record"))

detach main()
```

## 10. Tests are the specification

A test name is a sentence the product owner can read: state what the code must
do, not which function is under test. `test "an empty draft cannot be
submitted":` earns its place in a report; `test "submit validation":` does not.
One behaviour per test, and let the assertions read as the evidence for the
name. Helpers in a test module stay ordinary `def`s with ordinary names; only
the blocks are tests.

```velar
import {expect} from "velar/test"

type Ticket:
    id: string
    open: bool

def openIds(board: List<Ticket>) -> List<string>: return board.filter(ticket => ticket.open).map(ticket => ticket.id)

def resolve(board: List<Ticket>, id: string):
    for ticket in board:
        if ticket.id == id: ticket.open = false

def boardWithOneOpenTicket() -> List<Ticket>: return [{id: "t-1", open: true}]

test "a resolved ticket leaves the open queue":
    const board = boardWithOneOpenTicket()
    resolve(board, "t-1")
    expect(openIds(board)).toEqual([])

test "an unrelated resolution leaves the queue alone":
    const board = boardWithOneOpenTicket()
    resolve(board, "t-9")
    expect(openIds(board)).toEqual(["t-1"])
```

### Change every reactive source at least once

A reactive source that a test only ever reads at its default value is a source
whose reactivity is untested, and the failure this hides is specific: a value
frozen at construction and a value that follows are **textually identical** at
the default. The site bug that produced this rule shipped a sidebar frozen at
the first language it loaded; the suite asserted the sidebar's text, the first
load was the language the authors used, and every assertion was green.

So the rule is not "test the reactive parts". It is: for every `state` the
program owns, some test changes it and then asserts. One test that flips a
theme, switches a locale, and re-sorts a list is worth more than three that read
each of them once.

```velar fragment
test "the summary follows the board rather than snapshotting it":
    const board = boardWithOneOpenTicket()
    expect(openIds(board)).toEqual(["t-1"])
    resolve(board, "t-1")
    // The second assertion is the whole test: the first one passes either way.
    expect(openIds(board)).toEqual([])
```

## 11. Modules

Export and import by name. A package's public face is a barrel of explicit
re-exports (`export {measure} from "./text.vel"`). If two modules need each
other's values at load time, the shared value wants a third module. There is
no `import type`: Vel does not erase types, so a type carries its runtime
validator and a type import is an ordinary import.

```velar
export type TextMeasure:
    lines: number
    words: number

export def measure(text: string) -> TextMeasure:
    const lines = text.split("\n").size
    const words = text.split(" ").size
    return {lines, words}

export def firstLine(text: string) -> string: return text.split("\n")[0]

const sample = "
    one two
    three
"

@main:
    const measured = measure(sample)
    print(f"{measured.lines} lines, {measured.words} words")
```

## 12. What elegance means here

A well-owned application library is the reference specimen: small pure
functions, structural record returns, one job per function, contracts as
asserts, and no workaround disguised as abstraction. Elegant VelarScript is not
clever; it is unsurprising, and it looks the same no matter who — or what —
wrote it.

```velar
type Span:
    start: number
    end: number

type Cursor:
    line: number
    column: number

def lineStarts(text: string) -> List<number>:
    let offsets: List<number> = [0]
    let offset = 0
    for line in text.split("\n"):
        offset += line.size + 1
        offsets.append(offset)
    return offsets

def cursorAt(text: string, offset: number) -> Cursor:
    assert offset >= 0 else "A cursor offset is never negative"
    const starts = lineStarts(text)
    const line = starts.filter(start => start <= offset).size - 1
    return {line, column: offset - starts[line]}

def spanOfLine(text: string, line: number) -> Span:
    const starts = lineStarts(text)
    assert line >= 0 and line < starts.size - 1 else "That line is not in the text"
    return {start: starts[line], end: starts[line + 1] - 1}

const sample = "
    first line
    second line
    third line
"
const cursor = cursorAt(sample, 14)
const span = spanOfLine(sample, 1)
print(f"line {cursor.line}, column {cursor.column}")
print(f"span {span.start}..{span.end}")
```
