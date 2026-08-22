# The VelarScript Web AI skill brief

Load this after `velar skill core`. This file contains only the Web extension's
contract; Core syntax stays owned by the Core brief. It ships with the
toolchain and `velar skill web` prints it verbatim.

## Ownership

The manifest activates Web explicitly:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "extensions": ["@velarscript/web"],
  "web": {"title": "My App"}
}
```

`@velarscript/web` owns `component`, JSX, `state`, `computed`, `resource`,
`action`, `watch`, `look`, `keyframes`, `mount`, Web units, its standard
modules, and the `web` manifest key. Without that extension these are not Core
syntax. Web visual builders are named imports from `velar/look`; there is no
`Look.` namespace.

`@name` keeps the same language-wide role: it qualifies a compiler-owned name
in the current context. Components own `@mounted:` and `@cleanup:`; Look owns
conditions such as `@hover` and `@before`. They are not decorators, calls, or
values, and user code cannot declare new `@` names.

The toolchain writes `dist/index.html`; do not author it. `web.title` and
`web.icon` supply document metadata, `public/` is copied through, and other
assets are content-hashed.

## Components and reactivity

A component returns JSX directly. The four reactive cells have distinct jobs:

- `state` owns a fact.
- `computed name = ...` derives synchronously and is read bare.
- `resource name: T = load()` owns async loading state.
- `action name():` owns a user operation and exposes `pending` and `error`.

```velar fragment
component TicketPanel(id: string):
    state draft = ""
    resource ticket: Ticket = loadTicket(id)
    computed heading = ticket.value?.title ?? "Loading"

    action save():
        await saveDraft(id, draft)

    watch id:
        async ticket.reload()

    return <section>
        <h2>{heading}</h2>
        <textarea bind:value={draft}></textarea>
        <button disabled={save.pending} on:click={save}>Save</button>
    </section>
```

A resource loads once at mount. Refetching after an input changes is an
explicit `watch` plus detached `async resource.reload()`. Actions do not queue;
disable or otherwise guard a trigger when concurrent calls are unwanted.

A watch subject is a reactive name — a `state`, a `computed`, a prop, or a
resource field — or a read path out of one, such as `items[0].done`. An operator
or a call there is refused; declare the value with `computed` and watch that
name. A subject that is not reactive is refused as well: `watch total:` over a
plain `const` is a body that can never run. `computed` is the only spelling for
a reactive derived value. A `const` inside a component is not a second one: its
initializer is evaluated once at construction and never recomputes, and no
diagnostic marks it.

`@mounted:` runs after insertion and may await. `@cleanup:` runs before removal
and is synchronous. A component may still declare ordinary methods named
`mounted` or `cleanup` because compiler-owned names occupy a separate namespace.

Events use `on:click={handler}`. Writable form paths use `bind:value`,
`bind:checked`, or `bind:group`; do not read `event.target`. A JSX tag body is
received only through an explicitly declared `children: WebNode` prop.
Conditional rendering is an expression, and repeated children need stable
`key` values. Reuse asks two questions: the key must match, and the row it names
must still be the same value. `items = items.map(item => { ...item, done: true })`
rebuilds every row, so the keyed list recognises none of them and destroys and
rebuilds all of its children — an input being typed into loses focus. Change the
field in place, `items[index].done = true`. The compiler raises advisory **A4**
where the rewritten list is the one a keyed position renders; `// velar-allow
A4: <reason>` suppresses it where a `map` is the only spelling, which a
`readonly` list or one API response makes it.

A native element rejects every attribute name beginning with `on` other than
the `on:` directive itself. `onclick`, `onClick`, and `ONCLICK` are one
attribute to the browser, and the browser compiles that attribute's value as
script in the application's origin, which VelarScript reserves for
`unsafe:html`. The prefix is reserved by name rather than by a roster of
handler names, so the next handler spelling the platform adds is closed in
advance. A component prop may still be named `onSave`; the reservation belongs
to the native element.

`host` marks the element that receives what an invocation attaches to a
component — `class`, `look`, `look:*`, and `style:*`. `class:*` is a native
element directive and is not among them; an invocation that writes it is
reported as an unknown prop. A component whose root is a single native element
or a single component needs no marker. A nested component's `host` names that
component's host and never the enclosing one's, wherever the nested component
sits: buried inside one of the enclosing component's elements, or standing
directly among its roots. An enclosing component forwards to a nested
component's host only when it marks no native element of its own, so a
component whose roots are two nested components must mark a native element of
its own to say which one receives the invocation.

Props are live reactive inputs. Their data is mutable unless the author writes
an explicit `readonly` view.

## Look

`look:` is checked visual data. CSS keywords are strings, property names use
DOM camelCase, and units are literals:

```velar fragment
import {border, rgb, spacing} from "velar/look"

const buttonLook = look:
    border = border(0px, rgb(220, 224, 235))
    borderRadius = 10px
    padding = spacing(10px, 14px)
    cursor = "pointer"

    if @hover:
        background = rgb(235, 240, 255)
```

A module-level Look literal is built once and cannot read reactive state. Put a
changing visual on the element with `look={active ? enabledLook : disabledLook}`
or a typed `look:color={...}` binding. Checked motion is a module-level
`keyframes:` value passed to `animate` from `velar/look`; do not use a raw CSS
animation string. Unsupported styling uses explicit `import css unsafe
"./file.css" before look` or `after look`.

A `look` written on a component invocation composes after the look the
component applies to its own host, per property and per condition: declare a
property unconditionally to override the component's outright, and declare it
under a condition to refine that condition alone and leave the component's
other values standing.

## Storage and tests

`velar/storage` stores JSON and validates on read. A generic type spelling is
not a runtime value, so name the complete type:

```velar fragment
import {storage} from "velar/storage"

type SavedItem:
    title: string

type SavedItems = List<SavedItem>

const items = storage.get("reading", SavedItems, [])
storage.set("reading", items)
```

Keep `src/main.vel` as the mounted entry and put testable components and logic
in imported modules. Plain `*.test.vel` files run headlessly. A
`*.browser.test.vel` file drives the already-built page through
`velar/web-test`; it does not mount a second app and cannot use JSX or
`document` in its test body:

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

Bare `velar test --browser` means Chromium; use `--browser=all` for a
cross-browser claim. `velar/web-test` is legal only in browser-test modules.
Application code that needs the page uses checked `velar/browser` APIs.

## Finish

Run `velar format`, `velar check`, `velar test`, the project's browser tests,
and `velar build`. The complete runnable vocabulary lives in
`examples/tour/web/`; diagnostics outrank this brief when the two appear to
disagree.
