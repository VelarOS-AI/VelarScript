# The VelarScript language

This is the **reading path**: the whole language in the order it makes sense to
learn it, with a runnable program at every step. It is not the contract. The
contract is [the language charter](language-charter.md) — three thousand lines
that answer *exactly* what happens in every corner, and that the compiler is
tested against. This page gets you to the point where you can read the charter
when you need it, and not before.

Read it top to bottom once. Each section ends with **↳ charter §N**, which is
where to go when you need the exact rule rather than the working idea.

If you have not built anything yet, start with
[Getting started](getting-started.md) — ten minutes to a running application.
When you want the house style rather than the mechanics, that is
[Best practices](best-practices.md).

**Two parents.** Vel's behaviour comes from JavaScript and its spelling comes
from Python. When you are unsure how something *behaves*, guess JavaScript;
when you are unsure how something is *written*, guess Python. Where the two
disagree about which of five spellings to keep, Vel keeps one — and the
compiler names it when you write another.

---

## 1. The shape of a file

A VelarScript file is a `.vel` file. A block opens with `:` and is carried by
indentation, exactly as in Python — four spaces by convention, and `velar
format` settles it either way. There are no semicolons and no braces around
statement blocks. One statement per line; as in Python, an ordinary executable
suite may instead put its single non-block statement after the colon. Multiple
statements, nested blocks, and structural member or branch lists keep the
indented form. A line that begins with `.` or `?.` continues the previous line,
which is what lets method chains break naturally.

Comments are `//` for a line, `///` for documentation attached to the following
declaration, and `/* */` for a region — the block form nests, and a multi-line
one takes whole lines.

A statement must *do* something. A line that only computes a value and drops it
is a compile error, so a bare string is not a docstring.

```velar
/// Returns the greeting shown on the dashboard.
def greeting(name: string) -> string:
    // One statement per line; no semicolons.
    return f"Hello, {name}"

print(greeting("Ada"))
```

↳ charter [§2 Files, comments, and blocks](language-charter.md#2-files-comments-and-blocks)

## 2. Bindings and literals

`const` binds a name that cannot be reassigned; `let` binds one that can.
There is no `var`. Integers may use explicit `0x`, `0b`, or `0o` radix prefixes;
legacy leading-zero octal and bare `.5` remain invalid, and long digits group
with `_`. `true`/`false`/`null` are
the three keyword literals; there is no `undefined`.

Strings come in three delimiters and two prefixes that combine. Double quotes
are the default; backticks hold text that itself contains `"` (a JSON fixture, a
CSS selector) without escaping; a quote followed immediately by a newline opens
a **layout string**, closed by a quote back at the opening line's indentation.
The prefixes are `f` (interpolation) and `r` (raw), and `rf` is both. Only an
`f` prefix interpolates — `${value}` is ordinary text in every string.

```velar
const limit = 1_000_000
let attempts = 0
attempts += 1

const name = "Ada"
const greeting = f"Hello, {name}"
const fixture = `{"name":"Ada"}`
const pattern = r"\d+"
const usage = "
    velar check
    velar test
"

print(f"{limit} {attempts} {greeting} {fixture} {pattern}")
print(usage)
```

↳ charter [§3 Bindings and literals](language-charter.md#3-bindings-and-literals)

## 3. Operators, and what a condition is

Arithmetic and comparison read as you expect. The words are `and`, `or`, `not`
— not `&&`, `||`, `!value`. Equality is `==`/`!=` and it never coerces: the two
sides must have overlapping possible values, so `1 == "1"` does not compile.
Equality also never chains — write `a == b and b == c`. Ordered comparisons do
chain, but must point one way: `0 < index <= size`.

**A condition judges truth, not presence.** `if`, `while`, `and`, `or`, `not`,
and `? :` accept `bool` and `bool?` only. There is no truthiness, so an
optional is tested explicitly with `!= null`. The conditional expression is
`cond ? a : b`; there is no `x if cond else y`.

`??` supplies a default for an optional and `?.` reaches through one, but `??`
never shares an unparenthesized chain with `and`/`or`. `value!` takes the third
road: it unwraps an optional and raises where the value turns out to be absent,
for the places where absence would mean the program is wrong. It checks — there
is no spelling that merely claims. `!` after a value is that unwrap; `!` before
one is the negation above, and `!=` still wins by longest match, so an unwrap
before an equality test needs its space: `value! == other`.

Integer literals may use `0x`, `0b`, or `0o`. Bitwise `~`, `&`, `|`, `^`,
`<<`, `>>`, and `>>>` (and their compound assignments) accept only checked
32-bit integers; shift counts outside `0..31` fail instead of wrapping.

```velar
type Account:
    nickname: string?

def title(account: Account, index: number) -> string:
    const named = account.nickname != null and index > 0
    const label = account.nickname ?? "anonymous"
    return named ? f"{index}. {label}" : label

print(title({nickname: "ada"}, 1))
print(title({nickname: null}, 0))
```

↳ charter [§4 Operators](language-charter.md#4-operators)

## 4. Types

The core types are `string`, `number`, `bool`, `null`, and `unknown`. `T?` is
an optional. Types are **not erased**: a Vel type carries a runtime validator,
which is why there is no `import type` and why `Type.parse(value)` exists at
every boundary.

`unknown` is the honest type for data that has not been validated yet — you
cannot use it until you narrow it. `any` is *not* a type you may write, and no
boundary hands one back either: an unsafe JavaScript import arrives as
`unknown`, exactly like every other unvalidated value. Foreign data therefore
obeys one rule, and it is the checked one — narrow it with `value is T`, or
parse a declared shape.

Numbers and strings carry their operations as **methods**, not as free
functions: `value.round()`, `value.sign()`, `value.trunc()`, `value.isNaN()`, `text.isBlank()`,
`text.split("\n")`.

```velar
type Reading:
    label: string
    celsius: number

def describe(untrusted: unknown) -> string:
    const reading = Reading.parse(untrusted)
    const rounded = reading.celsius.round()
    const blank = reading.label.isBlank()
    return f"{reading.label}: {rounded} (blank {blank})"

print(describe({label: "kitchen", celsius: 21.4}))
```

↳ charter [§5 Core types](language-charter.md#5-core-types)

## 5. Records, aliases, and enums

One keyword, `type`, declares both record shapes and aliases. A record type is
structural — any value with the right fields satisfies it — and it carries
`parse` and `is` for untrusted data. Fields may be optional (`name: string?`)
and individually `readonly`. A record may extend one concrete record; the child
inherits its fields and validator checks while assignability stays structural.
Use `readonly type Name:` when the entire record contract, including inherited
fields and nested data, is read-only.

`enum` declares a finite state backed by a wire value. A member may carry an
external spelling — a string (`textDelta = "response.output_text.delta"`) or a
safe integer where a protocol pins a version (`v2 = 2`) — without losing its
nominal identity, and `Kind.values()` returns the members in declaration order.
An enum member in type position discriminates a union.

```velar
enum Status:
    pending
    active
    done

type UserId = string

type Entity:
    id: UserId

type User extends Entity:
    name: string
    avatar: string?
    status: Status

def line(user: User) -> string:
    return f"{user.id} {user.name} {user.status}"

const user: User = {id: "u-1", name: "Ada", avatar: null, status: Status.active}
print(line(user))
print(f"{Status.values().size} states")
print(f"{Status.parse("done")}")
```

↳ charter [§6 Records, aliases, and enums](language-charter.md#6-records-aliases-and-enums)

## 6. Functions and calls

Functions are `def`, with typed parameters, optional defaults, and a result
annotated after `->`. A call may name its arguments with `name=value` — not
`name: value`. Lambdas use `=>` and are single expressions.

**There are two arrows.** `=>` is the value-level arrow: it introduces a lambda
body. `->` is the type-level arrow: it names a result. They meet on a callback,
where the *type* is written with `->` and the *value* passed to it with `=>`.

A generic function names a bound only when its body needs the capability:
`<T: Comparable>` to order, `<T: Text>` to interpolate, `<T: Data>` to
serialize.

A `def` is visible throughout its lexical block, so a helper may be written
after its first call and sibling helpers may recurse into each other.

```velar
type Transform = (value: number) -> number

def apply(values: List<number>, using: Transform) -> List<number>:
    return values.map(using)

def scale(value: number, factor: number = 2) -> number:
    return value * factor

def join<T: Text>(values: List<T>) -> string:
    return values.map(str).join(", ")

const doubled = apply([1, 2, 3], value => scale(value))
print(join(doubled))
print(str(scale(10, factor=3)))
```

↳ charter [§7 Functions and calls](language-charter.md#7-functions-and-calls)

## 7. Collections

`List<T>`, `Set<T>`, `Map<K, V>`, and `Record<T>` are the four, and their
methods are compiler-checked rather than inherited from JavaScript. Size is
`.size` everywhere — on strings too. Appending is `.append(x)`; there is no
`push`, `splice`, `shift`, or mutating `sort`. Sorting and reversing copy:
`.sorted(by=...)`, `.reversed()`.

Prefer the collection API when it states the whole operation: `filter`, `map`,
and `flatMap` for stateless selection and projection; `some`, `every`, and
`find` for queries; `sum`, `min`, `max`, and `reduce` for intentional folds;
`groupBy`, `keyBy`, `countBy`, `partition`, `chunk`, `zip`, `unique`,
`compact`, and `flatten` when the answer is a different collection.
Every callback that receives an element — predicate, transform, and key
selector alike, `sorted(by=)` included — receives the value and, when declared,
its stable snapshot index: `tasks.map((task, index) => f"{index}: {task.title}")`.
Use `for` when the work mutates state, has custom exits, writes multiple
outputs, or depends on ordered effects. `velar check` reports A8/A13 only for
the narrow loop shapes it can prove equivalent.

`[index]` **throws** when the index is out of range, and `.get(index)` returns
`T?`. Choose by whether absence is a bug or an expected answer — that choice is
the signal the next reader gets. Membership is `in`.

```velar
type Task:
    title: string
    priority: number

const tasks: List<Task> = [
    {title: "Ship the parser", priority: 2},
    {title: "Write the tour", priority: 1},
]

tasks.append({title: "Fix the gate", priority: 3})

const ordered = tasks.sorted(by=task => task.priority).map(task => task.title)
const urgent = tasks.sorted(by=task => task.priority, descending=true)
const byPriority = tasks.groupBy(task => task.priority)
const total = tasks.map(task => task.priority).sum()
const first = tasks[0].title
const missing = tasks.get(99)?.title ?? "none"

const owners = Map([["t-1", "ada"], ["t-2", "lin"]])
const ownerCursor = owners.iterator()
const firstOwner = ownerCursor.next()
const eventsByDay: Map<string, List<Task>> = Map()
eventsByDay.getOrSet("today", []).append(tasks[0])
eventsByDay.getOrSetWith("tomorrow", () => []).append(tasks[1])
const words = Set(["done", "closed"])

print(ordered.join(" | "))
if firstOwner != null: print(firstOwner.value)
print(f"{total} {first} {missing} {owners.get("t-1")} {"done" in words}")
print(f"{urgent[0].title} {byPriority.size}")
```

↳ charter [§8 Collections](language-charter.md#8-collections)

## 8. Control flow

`if` / `else if` / `else`, `while`, and `for … in …`. The `for` loop takes a
second slot for the position — `for value, index in values:` — so a shadow
counter is never needed. `range(...)` is in the prelude and needs no import. A
direct one-slot `for value in range(...):` is compiled as a checked native
counter loop; using `range(...)` as a value still returns the ordinary bounded
`List<number>`.

An ordinary executable suite with one non-block statement may stay on one line,
as in `def stop(): return` or `while pending: poll()`. An `if` branch follows
the same rule. The formatter preserves the author's choice between that spelling
and an indented suite; it does not collapse or expand the block. Multiple
statements and nested blocks keep the indented form. Conditional values are
still written `condition ? then : else`.

`match` is the dispatcher: one subject, `case` branches that may destructure
records and lists, an optional `if` guard, and `case _:` as the only fallback.
An `else if` ladder over an enum is the shape `match` exists to replace.
Like an `if` branch, a case with one non-block statement may stay on its header
line: `case Status.done: return "done"`.

```velar
enum Phase:
    todo
    doing
    done

type Charge:
    kind: string
    amount: number

def advance(phase: Phase) -> Phase:
    match phase:
        case Phase.todo:
            return Phase.doing
        case Phase.doing:
            return Phase.done
        case _:
            return Phase.todo

def describe(event: Charge) -> string:
    match event:
        case {kind: "charge", amount} if amount > 100:
            return f"large charge of {amount}"
        case {kind: "charge", amount}:
            return f"charge of {amount}"
        case _:
            return "other"

let phase = Phase.todo
for step in range(3):
    phase = advance(phase)
    print(f"{step}: {phase}")

print(describe({kind: "charge", amount: 250}))
```

↳ charter [§9 Control flow](language-charter.md#9-control-flow)

## 9. Classes, and who owns a handle

Classes have typed body fields, **one** explicit constructor, and an explicit
`self`. Instances are called directly — there is no `new`. A `const`/`let`
prefix on a constructor parameter declares the field at the same time.

VelarScript calls `@name` a **context marker**; `@` is the **marker
introducer**. A context marker attaches a compiler-owned compile-time role to
the following declaration or structural entry, chosen by the current syntax
context. It is not a function call or runtime decorator, and source code cannot
define one. The class context currently accepts `@dispose:` and `@iterate:`.
That closed vocabulary can never collide with yours. `@dispose:` is the
release contract: `using name = expression` runs it on **every** exit from the
owning scope — block end, `return`, `break`, `continue`, a throw three frames
down — in reverse declaration order. An owned value may not leave its scope,
so return the data you read from it rather than the handle.

The same rule covers every context marker; the active context decides
the closed vocabulary and the editor hover explains the exact role and a legal
example:

| Context | Compiler-owned names | Meaning |
| --- | --- | --- |
| Module | `@main:` | The program entry selected by `run`, an application host, or another executable target |
| Class | `@dispose:`, `@iterate:` | Release and iteration contracts |
| Node `server` | `@get`, `@post`, `@put`, `@patch`, `@delete`, `@notFound` | Anonymous checked HTTP routes and the final fallback |
| Web component | `@mounted:`, `@cleanup:` | Component insertion and destruction lifecycle |
| Web `look:` | `@hover` and the other state names; `@before:` and the other target names | Live CSS states and checked pseudo-element targets |

These names cannot be imported, aliased, passed as values, called, or extended
by user code. A valid hover comes from the compiler's parsed semantic position,
so text that merely happens to contain the same spelling is not treated as the
language feature.

```velar
class Session:
    let open: bool = true

    constructor(const name: string):
        pass

    def close():
        self.open = false

    @dispose:
        self.close()

def work(name: string) -> string:
    using session = Session(name)
    return f"{session.name} open: {session.open}"

print(work("import"))
```

↳ charter [§10 Classes](language-charter.md#10-classes)

## 10. Errors and assertions

`assert condition else "message"` states a contract at the top of a function;
the message is required and reads as a sentence. Failures that the caller does
**not** expect are `try` / `catch` / `finally` blocks. Failures the caller
*does* expect are the `try` **expression**, which produces `null` when anything
in the chain throws — its result must be consumed, usually by `??`.

An error's **class** is its classification: discriminate with
`if error is FileNotFoundError:`. `error.code` is that same identity in string
form, for when it must survive a log or a JSON boundary.

```velar
type Settings:
    retries: number

def defaultSettings() -> Settings:
    return {retries: 3}

def load(raw: unknown) -> Settings:
    const settings = try Settings.parse(raw) ?? defaultSettings()
    assert settings.retries >= 0 else "A retry count is never negative"
    return settings

def read(values: List<number>, index: number) -> string:
    try:
        return str(values[index])
    catch error:
        if error is IndexError:
            return "out of range"
        throw error

print(str(load({retries: 5}).retries))
print(str(load("not a settings record").retries))
print(read([1, 2, 3], 99))
```

↳ charter [§11 Errors and assertions](language-charter.md#11-errors-and-assertions)

## 11. Modules, and the JavaScript boundary

Export and import by name. A package's public face is a barrel of explicit
re-exports. Declarations initialize when a module is imported; application
startup belongs to the module's `@main` region and runs only when that module is
selected as a program entry.

What a program can *compute* needs no import; what reaches *outside* the
program must be imported. Four namespaces are permanent because they mirror a
JavaScript global — `Json.`, `Promise.`, `Math.`, and `Text.` — and everything
else, including `velar/http`, `velar/storage`, and `velar/look`, is an ordinary
named import.

Third-party JavaScript enters through a **checked** boundary: `extern module`
declares the shape you are relying on, and `import js` then reads as ordinary
Vel. Declare the extern block once, in an adapter module, and re-export a
checked surface from it.

```velar
type Payload:
    id: string

extern module "some-sdk":
    export def load() -> unknown

import js {load} from "some-sdk"

export def payload() -> Payload:
    return Payload.parse(load())

@main: print(f"{Math.max(1, 2)} {Json.stringify({id: "p-1"})}")
```

↳ charter [§12 Modules and JavaScript boundaries](language-charter.md#12-modules-and-javascript-boundaries)
· [Escape hatches](escape-hatches.md) · [JavaScript bridge](javascript-bridge.md)

## 12. Tests

A test lives in a `*.test.vel` module as a `test "name":` block. The name is a
sentence about the behaviour, quoted verbatim by the reporter. The body may
`await` directly and needs no `export`; `expect` comes from `velar/test`. A
`*.browser.test.vel` module drives a real page instead, through `velar/web-test`.

```velar
import {expect} from "velar/test"

def initials(name: string) -> string:
    return name.split(" ").map(part => part.slice(0, 1)).join("")

test "a full name becomes its initials":
    expect(initials("Ada Lovelace")).toBe("AL")

test "a single name keeps one initial":
    expect(initials("Ada")).toBe("A")
```

↳ charter [§12 Modules and JavaScript boundaries](language-charter.md#12-modules-and-javascript-boundaries)
· [CLI reference](cli.md)

---

## Node services

An application service activates `@velarscript/server` in `velar.json`; that
application extension composes `@velarscript/node`. `server` declares
an immutable route table; the five HTTP verbs are context markers with
compiler-owned route roles, not decorators. A Node-owned `p"..."` value is a
first-class `RoutePattern`: it declares path and query fields once. An inline
pattern projects those fields directly into the anonymous handler; a referenced
pattern uses an explicit `as route` binding. One Data
record on a writing route comes from JSON. Distinct URL and field names use
`wire={field:type}`; redundant same-name mappings receive advisory `A11` and a
mechanical shorthand fix.

```velar
import {HttpProblem, Request, created} from "velar/serve"

type CreateArticle:
    title: string

export server app:
    @get(p"/health") => {ok: true}

    @get(p"/articles/{id:number}?{details:bool?}"):
        if id < 1:
            throw HttpProblem({status: 404, code: "article.not_found", title: "Article not found"})
        return {id, details: details ?? false}

    @post(p"/articles", input: CreateArticle) => created({id: 1, title: input.title})

    @notFound(request: Request) => {error: "route_not_found", path: request.path}

```

`p"..."` belongs to the Node extension rather than Core's string system.
`f"..."` therefore keeps its one job—forward runtime interpolation—while a
path pattern is a reverse matcher checked entirely at compile time.
The selected entry starts the server inside `@main`; importing that module does
not run the entry body. `server.configuration` in `velar.json` explicitly names
the project-relative YAML or JSON file that owns host, port, request limits,
and application settings.
`velar dev` watches and restarts it, `velar serve` runs it with production
behavior, and `velar build` emits the standalone Node application. Direct
`serve(...)` remains an ordinary Node operation for integration tests and
embedded servers.
`authenticate(security.bearer(), verify)` composes Node's checked credential
input with a nullable async verifier and exposes its non-null identity as a
request Provider. The framework owns the 401 boundary; installed libraries own
token/session algorithms, and the application owns user and authorization
policy.
`@notFound` is the single application fallback for a path that matches no
route. Its optional parameter must be `Request`; Data keeps the 404 status,
while an explicit response may select another status. It does not intercept a
matched route's `HttpProblem` or a method-not-allowed response. Semantic route
results are finalized once by the framework; an optional application-wide
`@response(outcome: HttpOutcome, request: Request)` policy may define a shared
envelope, while explicit `json`, `text`, `file`, `stream`, `sse`, and
`redirect` results remain final representations.

↳ charter [§3 Bindings and literals](language-charter.md#3-bindings-and-literals)
· [Standard library: `velar/serve`](standard-library.md#velarserve)

---

The remaining sections belong to the **Web extension**, which a project turns
on by naming `@velarscript/web` in `velar.json`. Without that line, `component`
is an unknown declaration keyword and every JSX token is a parse error. A Core
project—or a Node service after the section above—stops reading here.

## 13. Components and JSX

`component` declares a component; props are its parameters; it returns JSX
directly, with no `render` block. JSX is expression syntax, so conditional
rendering is `cond ? a : b` and lists are `items.map(...)` with a `key` —
there are no control-flow attributes.

Event handlers are `on:click={handler}`, form bindings are
`bind:value={state}`, and children arrive through a declared `children: WebNode`
prop. Props are live reactive inputs, and their data is mutable by default:
writing a field or using a collection's mutating method publishes through the
same deep-reactive path as writing the source state. Declare `readonly T` on a
prop when the component author deliberately wants a read-only contract; that
explicit view travels into helpers and nested data without copying or freezing.

```velar
type Item:
    id: string
    title: string

component Empty:
    return <p>Nothing yet</p>

component ItemList(items: readonly List<Item>, children: WebNode):
    return <section>
        {items.size == 0 ? <Empty /> : <ul>
            {items.map(item => <li key={item.id}>{item.title}</li>)}
        </ul>}
        {children}
    </section>

mount(<ItemList items={[{id: "i-1", title: "Read the charter"}]}>
    <footer>1 item</footer>
</ItemList>, "#app")
```

↳ charter [§13 Web extension boundary](language-charter.md#13-web-extension-boundary)
· [§14 Components and JSX](language-charter.md#14-components-and-jsx)
· [Web framework reference](web-api.md)

## 14. State, computed values, resources, and actions

Four cells, one job each. `state` holds a fact. `computed name = ...` derives
from facts and is read bare, like `state`. `resource` loads async data — it
exposes `value`, `loading`, `error`, and `reload()`. `action` performs a user
operation and exposes `pending` and `error`.

The two synchronous ones complete a grid the whole language already had:

|            | not reactive | reactive   |
| ---------- | ------------ | ---------- |
| writable   | `let`        | `state`    |
| read-only  | `const`      | `computed` |

`state` is to `let` what `computed` is to `const`. That is what makes `const`
worth reading: it now promises the value never changes. There is no third
spelling: a derived value is declared, and the declaration already caches.

Reactivity is deep, so you mutate state directly rather than rebuilding it.
Two things surprise newcomers, both deliberate: **a resource loads once, at
mount**, and does not refetch when its inputs change — `watch` the input and
call `reload()`; and **an action does not queue**, so two clicks run two calls
and you guard with `disabled={save.pending}`.

<!-- velar-preamble
type Ticket:
    id: string
    title: string

async def loadTicket(id: string) -> Ticket:
    return {id, title: f"Ticket {id}"}

async def saveDraft(id: string, draft: string):
    print(f"{id}: {draft}")
-->
```velar fragment
component TicketPanel(id: string):
    state draft = ""
    resource ticket: Ticket = loadTicket(id)
    computed heading = ticket.value?.title ?? "Loading"

    action save():
        await saveDraft(id, draft)

    watch id:
        detach ticket.reload()

    return <section>
        <h2>{heading}</h2>
        <textarea bind:value={draft}></textarea>
        <button type="button" disabled={save.pending} on:click={save}>Save</button>
    </section>
```

(`Ticket`, `loadTicket`, and `saveDraft` are declared for the compiler in a
Markdown comment above this fence, so the example shows only the four cells and
the gate still checks it in full.)

↳ charter [§15 State, computed values, resources, and actions](language-charter.md#15-state-computed-values-resources-and-actions)

## 15. Lifecycle

The component context has two context markers. `@mounted:` runs once after
the DOM is inserted and may `await`. `@cleanup:` runs once before the component
is destroyed and is synchronous. `@` is the same marker introducer used in
classes and Look; it does not mean "lifecycle". Because these markers are
compiler-owned, a component can still declare its own ordinary
`def mounted()`.

```velar
component Chart(points: readonly List<number>):
    let canvas: CanvasElement? = null

    @mounted:
        if canvas != null:
            print(f"drawing {points.size} points")

    @cleanup:
        print("releasing")

    return <canvas ref={canvas}></canvas>

mount(<Chart points={[1, 2, 3]} />, "#app")
```

↳ charter [§16 Lifecycle](language-charter.md#16-lifecycle)

## 16. Look

Look is the checked visual language, and it is a **value**: `look:` builds one,
`look={...}` applies it to an element. Property names are real DOM camelCase,
CSS keywords are quoted strings, and units are literal (`16px`, `1turn`, `1s`).
Builders such as `spacing`, `border`, `rgb`, and `animate` are named imports
from `velar/look`.

A `look:` literal is built once, so its conditions cannot read state — put a
reactive visual on the element (`look={active ? a : b}`) instead. Conditions
inside a literal cover the static axes: `@hover`, `viewport.width <= 640px`,
`motion.reduced`.

```velar
import {animate, border, rgb, spacing} from "velar/look"

const spin = keyframes:
    from:
        rotate = 0deg
    to:
        rotate = 1turn

const cardLook = look:
    display = "grid"
    gap = 12px
    border = border(1px, rgb(220, 224, 235))
    borderRadius = 10px
    padding = spacing(16px, 20px)

    if @hover:
        background = rgb(245, 247, 255)

    if viewport.width <= 640px:
        padding = spacing(12px, 14px)

const busyLook = look:
    if not motion.reduced:
        animation = animate(spin, 1s, easing="linear", loop=true)

component Card(busy: bool, children: WebNode):
    return <article look={cardLook}>
        <span look={busy ? busyLook : null}>*</span>
        {children}
    </article>

mount(<Card busy={true}><p>Loading</p></Card>, "#app")
```

A design system's CSS custom properties are read with `token("--name")`, the one
checked spelling, legal in every Look property. The compiler checks the
reference — a literal `--name` — and the design system owns the value behind it,
so a theme swaps values under the same names without recompiling:

```velar
import {token} from "velar/look"

const shellChrome = look:
    width = token("--shell-sidebar-expanded-width")
    borderRadius = token("--ui-radius-panel")
    boxShadow = token("--shell-sidebar-shadow")
    color = token("--ui-color-foreground")
```

↳ charter [§17 Look](language-charter.md#17-look-controlled-visual-language)
· [appendix: the published visual vocabulary](language-charter.md#appendix-to-section-17-published-web-visual-vocabulary)

---

## What is deliberately not here

Vel is small on purpose, and the charter lists the absences with the reason for
each: no `switch`, no `var` or `undefined`, no `new` or `this`, no `typeof` /
`instanceof` / `eval`, no `yield`, no user-defined decorators, no
TypeScript-style type programming, no React-style `effect`. If you reach for
one of these, the compiler names what to write instead — that is the design,
not a gap.

↳ charter [§19 Deliberately absent source features](language-charter.md#19-deliberately-absent-source-features)

## What the compiler emits

Readable, source-mapped JavaScript that runs without the toolchain, with stable
CSS selectors and no framework runtime beyond the explicit `@velarscript/web`
package. This is a product promise, not an implementation detail: if Vel itself
ever becomes the obstacle, you take the emitted output and keep shipping.

↳ charter [§18 Generated JavaScript semantics](language-charter.md#18-generated-javascript-semantics)
· [Escape hatches](escape-hatches.md)

## Where to go next

- [Best practices](best-practices.md) — the house style, one complete program per rule
- [Standard library](standard-library.md) — the permanent namespaces and the capability modules
- [Web framework](web-api.md) — the full component, routing, and Look surface
- [CLI reference](cli.md) — every command, grouped by what you are doing
- [The language charter](language-charter.md) — the contract, when you need the exact rule
- `examples/tour/` — every spelling exactly once, as projects you can run
