# Release Studio

A complete VelarScript Web application: a release-readiness console for a team
that ships a toolchain. Four routes, one shared store, persisted reader
preferences, a form, a checklist, and two kinds of test.

**What this example teaches is structure** — how to divide modules, where state
belongs, how routing is declared, and which tests belong in a browser. It does
not try to show every spelling in the language; that is [the tour](../README.md),
and the two are meant to be read in that order.

## Run it

From the repository root:

```sh
velar check examples/app                 # types, imports, and the whole module graph
velar test examples/app                  # unit tests, no browser
velar test examples/app --browser all    # the same application in Chromium, Firefox, and WebKit
velar dev examples/app                   # a dev server
velar build examples/app                 # a production build in examples/app/dist
```

Inside this repository the CLI is `npm run velar -- <command>`; from inside the
project directory the argument is just `.`.

## The domain

The board tracks releases. Each release has a stage (`planned` → `building` →
`verifying` → `released`), a target date, and a checklist. One rule holds the
application together: **a release may leave `verifying` only once its checklist
is clear.** Everything else — the readiness percentages, the metric tiles, the
blocked count — is arithmetic over that.

## The module map

```text
src/
  main.vel                  entry: restore preferences, mount one root
  app.vel                   the shell — header, route table, loading/failed/not-found views
  config.vel                the manifest's publicConfig, validated once
  model/
    release.vel             types and pure functions: readiness, the stage machine, the rule
    release.test.vel        unit tests for all of the above — no page, no store
  state/
    board.vel               the shared store: module state + every way it may change
    board.test.vel          unit tests for the store's transitions
    preferences.vel         the reader's appearance and density, persisted via velar/storage
  look/
    theme.vel               palette and shared Look values; the two presentation enums
  components/
    readiness.vel           ReadinessBar and StagePill — values in, markup out
    metrics.vel             a label/value tile grid, reused by two pages
    release-list.vel        the board as a list of links
    check-list.vel          the checklist, and the readonly-props lesson
    add-check-form.vel      a form, its own draft state, and velar/forms validation
    activity-feed.vel       server data as a component-owned `resource`
  pages/
    dashboard.vel           "/"
    release.vel             "/releases/:id"
    settings.vel            "/settings"
    about.vel               "/about", loaded on demand
  app.browser.test.vel      the flows that only a real browser can answer
public/
  data/activity.json        the feed the activity panel fetches
  mark.svg, robots.txt      ordinary static assets
```

The layering is one-way. `model/`, `look/`, and `config.vel` are leaves — they
import from the standard modules and from nothing in this application. `state/`
reads them. `components/` and `pages/` read `state/`. `app.vel` composes the
pages, and `main.vel` starts everything. Nothing imports upwards, which is what
makes `model/` testable in milliseconds and keeps the answer to "where does this
change happen?" short.

## Four decisions worth copying

**1. State lives at the scope of the question it answers.** The board is a fact
about the application, so it is module `state` in `state/board.vel` — the header,
the dashboard, and the detail page read the same cell, and a page that unmounts
does not take the data with it. A half-typed check title is a fact about one
form, so it is `state` inside `AddCheckForm` and disappears with it. Server data
that is only interesting while a panel is on screen is a `resource` inside that
panel, so a slow response cannot write into a page that has gone away.

**2. A component prop is a transitive readonly view.** `CheckList` receives
`release: readonly Release`; `check.done = not check.done` inside it is a compile
error. This is not an obstacle to work around with a copy — it is the shape that
keeps a store honest. A view asks for a change by identifier, through the store:
`toggleCheck(release.id, check.id)`. The store owns the data, so the exported
functions of `state/board.vel` are the complete list of ways the board can
change.

**3. Routing is declared in one module.** `app.vel` holds the route table and the
three views a router needs off the happy path: still loading, failed to load, and
no such page. A route table spread across the pages it names reads fine until
someone asks what URLs the application answers.

**4. The two test kinds answer different questions.** Arithmetic and store
transitions are checked in `model/release.test.vel` and `state/board.test.vel`,
which run in the ordinary test process in milliseconds. What needs a real engine
— routing, rendering, form validation, whether a preference survives a reload —
is in `app.browser.test.vel`, which imports `velar/web-test`. That import is only
legal from a `*.browser.test.vel` module, which is the compiler making the split
for you.

Two smaller things that cost people time, both written down where they happen:
a module store is a singleton, so the store's tests each begin with
`resetBoard()` rather than trusting the test above them (`state/board.test.vel`);
and a state write publishes on the reactive flush, so a test that reads a
`computed` waits for `await tick()` first.

## What this example is not

It is not a vocabulary reference. There is exactly one `resource` here, one
`lazy` route, one form, and no attempt at completeness — a real application uses
what it needs. When the question is "how do I write X in Vel", the answer is in
`../tour/`, where every spelling appears exactly once; [the map one level
up](../README.md) says how to read it.
