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

`@mounted:` runs after insertion and may await. `@cleanup:` runs before removal
and is synchronous. A component may still declare ordinary methods named
`mounted` or `cleanup` because compiler-owned names occupy a separate namespace.

Events use `on:click={handler}`. Writable form paths use `bind:value`,
`bind:checked`, or `bind:group`; do not read `event.target`. A JSX tag body is
received only through an explicitly declared `children: WebNode` prop.
Conditional rendering is an expression, and repeated children need stable
`key` values.

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
