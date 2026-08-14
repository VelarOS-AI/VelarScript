# VelarScript best practices

This is the canon: the one idiomatic way to write VelarScript. The project's
core tenet is that **AI writes and modifies the code, and humans read it** —
so the next author of any file is an AI that has never seen it, and the
reviewer is a person who may not program. Both depend on every Vel codebase
having exactly one shape. When two spellings both work,
this document names the one to use. The compiler enforces most of the canon;
`velar format` settles everything about layout. What remains is judgment,
and this page is that judgment, written down.

The meta-rule above all others: **run `velar check` and do what the
diagnostic says**, then `velar fix` for the rewrites that are provably
behavior-preserving. Diagnostics name the one current spelling; they are the
canon's enforcement arm, and they outrank any memory of this page.

## 1. Model the data first

Give every finite state an enum, every shape a `type`, and let unions carry
the alternatives. Data that is modeled precisely makes every function after
it shorter.

```velar
enum TicketStatus:
    open
    pending
    resolved

type Ticket:
    id: string
    title: string
    status: TicketStatus
    assignee: string?
```

When an external protocol owns the wire spelling, map it in the enum instead
of writing a conversion function — a string-backed member already satisfies
`string` contracts directly:

```velar
enum ProviderEventKind:
    textDelta = "response.output_text.delta"
    completed = "response.completed"

def wireName(kind: ProviderEventKind) -> string:
    return kind
```

Return multiple values as a named record with shorthand fields, never
through an out-parameter or a class. The type name is free documentation:

```velar
type TextMeasure:
    lines: number
    words: number

def measure(text: string) -> TextMeasure:
    const lines = text.split("\n").size
    const words = text.split(" ").size
    return {lines, words}
```

## 2. Null discipline

One spelling per job. Test presence with `!= null`, provide a default with
`??`, reach through maybes with `?.`, and narrow once — then use the value
directly. Do not re-wrap optionals or copy them into extra locals.
Equality requires the two sides to share possible values, so compare an
enum against an enum — `Kind.parse(raw) == Kind.textDelta` — rather than
against a raw string.

```velar fragment
if ticket.assignee != null:
    notify(ticket.assignee)

const label = ticket.assignee ?? "unassigned"
const city = account?.profile?.city
```

Use `[]` when the index must exist (it throws on a bug) and `.get()` when
absence is an expected answer. That difference is the reader's signal. The
same split governs removal: `pop(index=-1)` throws on an empty List, so
drain with `while items.size > 0:` rather than testing a result for null.

## 3. Chains over cursors

Collection work is method chains: `filter`, `map`, `sorted(by=...)`,
`reduce`, `sum`. A hand-advanced index loop is the exception reserved for
genuine cursor algorithms, not the default.

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
```

Need the position? Use the two-slot loop, never a shadow counter:

```velar fragment
for ticket, index in tickets:
    print(f"{index}: {ticket.title}")
```

Membership is `in`. Three or more `or value == ...` comparisons means the
values wanted to be a `Set` constant:

```velar
const closingWords = Set(["done", "closed", "resolved"])

def isClosing(word: string) -> bool:
    return word in closingWords
```

Mutate state directly — deep reactivity is the default, so rebuild-the-list
spellings are noise:

```velar fragment
tickets.append(ticket)
tickets[0].done = true
tickets[0].pinned = not tickets[0].pinned
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
        case Status.todo:
            return Status.doing
        case Status.doing:
            return Status.done
        case _:
            return Status.todo
```

## 5. Small functions, guard first

Handle the empty and missing cases with early returns, then write the happy
path unindented. Contracts are `assert condition else "message"` at the top
of the function — one line per rule, message required.

```velar
def firstLine(text: string) -> string:
    assert text.size <= 1000000 else "Text is beyond the supported size"
    if text == "":
        return ""
    return text.split("\n")[0]
```

Callbacks stay arrows while they are one expression; the moment logic needs
two statements, promote it to a named `def` — the name is documentation.
Name arguments at call sites where a bare value would read as a mystery:
`buttonLook(dangerous=true)`, never `buttonLook(true)`.

A type parameter stays unbounded by default. Add a bound only when the body
actually uses the capability — `<T: Text>` because it interpolates the value,
`<T: Comparable>` because it orders it, `<T: Data>` because it serializes it.
A bound the body does not need is a narrower contract for no gain, and it is
the caller who pays. The chain runs `Comparable ⊂ Text ⊂ Data`, so one word
always says it; reach for the weakest one that compiles:

```velar
def summarize<T: Text>(values: List<T>) -> string:
    return values.map(str).join(", ")

print(summarize([1, 2, 3]))
```

## 6. Strings

Text is built with f-strings — numbers, bools, and enums interpolate
directly, and `+` chains or conversion ceremony are noise:

```velar
const count = 3
const summary = f"{count} open tickets"
```

Use double quotes for ordinary inline text and backticks when the text itself
contains double quotes, especially JSON fixtures; `velar format` chooses the
delimiter with fewer escapes. Backticks are still Velar strings, not JavaScript
templates: only an `f` prefix plus `{value}` interpolates, while `${value}` is
literal text.

Data becomes text through `Json.stringify`, never through
interpolation of a record. Multi-line text is a layout string, not a stack
of `\n` escapes.

## 7. Components: four cells, one job each

`state` holds a fact. `computed` derives from facts. `resource` loads async
data. `action` performs a user operation. Choosing the right one removes
most component code:

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

Read a resource as `value != null`; never wrap a plain field read in
another `computed`. In JSX, call a computed once into a `const` if you need
it three times. Render nothing with `null`. Accept children by declaring a
`children: WebNode` prop. Extract every reused look into a named value and
compose with `look={...}`.

## 8. Errors and async

Throw `Error` (or a subclass) with a message that names the rule that was
broken, in the same voice as the assert messages. Validate untrusted data at
the boundary with `Type.parse`, then trust the types inward. `await` every
call whose result or completion you depend on — a dropped promise is a bug,
and the compiler treats it as one.

Every handle a scope opens, that scope owns: write `using` and delete the
`try`/`finally` you were about to write. It covers the exits that are easy to
forget — an early `return`, a `break` out of a pull loop, a throw from three
frames down:

```velar fragment
async def tail(path: string) -> null:
    using watcher = await watchFiles(path)
    async for batch in watcher:
        if batch.rescan:
            return null
```

Give a class an `@dispose:` block only when it truly owns something a scope
should release; delegate it to the `close()` or `stop()` the class already
publishes rather than inventing a second verb, and keep it safe to run twice.

Sort failures by whether the caller already expects them. An expected failure
is an optional — `try` it and supply the fallback at the use site, where a
reader can see the decision. An unexpected one is a `try`/`catch` block,
because the details are what you need. Never hand-write the third shape, a
`def tryParse` that wraps a parse in try/catch and returns null:

```velar fragment
const settings = try Settings.parse(raw) ?? defaultSettings()
```

## 9. Tests are the specification

A test name is a sentence the product owner can read: state what the code must
do, not which function is under test. `test "an empty draft cannot be
submitted":` earns its place in a report; `test "submit validation":` does not.
One behaviour per test, and let the assertions read as the evidence for the
name:

```velar fragment
test "a resolved ticket leaves the open queue":
    const board = boardWith(openTicket)
    resolve(board, openTicket.id)
    expect(openIds(board)).toEqual([])
```

Helpers in a test module stay ordinary `def`s with ordinary names; only the
blocks are tests.

## 10. Modules

Export and import by name. A package's public face is a barrel of explicit
re-exports (`export {x} from "./x.vel"`). If two modules need each other's
values at load time, the shared value wants a third module.

## 11. What elegance means here

The `@velarscript/text-buffer` package is the reference specimen: small pure
functions, structural record returns, one job per function, contracts as
asserts, and not one comment explaining a workaround — because there is
nothing to work around when data is modeled first. Elegant VelarScript is
not clever; it is unsurprising, and it looks the same no matter who — or
what — wrote it.
