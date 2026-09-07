# Getting started

From nothing to a running, tested application. Ten minutes.

You need **Node.js 24 or newer**. Everything else comes from npm. The current
release is **0.32.0**, and every toolchain dependency `velar create` writes is
pinned exactly rather than by range — VelarScript promises no backward
compatibility, so a range would let a different language into the project on
some later install. Only third-party dev dependencies keep a range:

```json
{
  "dependencies": {"@velarscript/web": "0.32.0"},
  "devDependencies": {"@velarscript/cli": "0.32.0", "playwright": "^1.58.2"}
}
```

## 1. Create

```sh
npm create velar@latest my-app
cd my-app
npm install
```

That gives you a Web application. For the other shapes, add a template:

```sh
npm create velar@latest api -- --template node
npm create velar@latest desktop-app -- --template desktop
npm create velar@latest product-docs -- --template docs
npm create velar@latest shared-library -- --template library
npm create velar@latest component-library -- --template component
```

## 2. What you got

```text
my-app/
  velar.json                  project format, entry, surfaces, extension settings
  package.json                npm dependencies and the script names below
  AGENTS.md                   instructions for the model that will write this app
  public/                     files copied to the build as-is
  src/
    main.vel                  entry — mounts the app
    app.vel                   the application itself
    app.test.vel              unit tests, run in Node
    app.browser.test.vel      browser tests, run in a real browser
```

The Web project's `velar.json` starts like this:

```json
{
  "formatVersion": 2,
  "name": "my-app",
  "kind": "application",
  "entry": "src/main.vel",
  "outDir": "dist",
  "build": {"mode": "production", "sourceMaps": false},
  "publicDir": "public",
  "extensions": ["@velarscript/web"],
  "surfaces": {"core": "0.8", "web": "0.14"}
}
```

Three things are worth noticing now.

`velar.json` lists **extensions** explicitly. A Web project activates
`@velarscript/web`; a Server project activates `@velarscript/server`, which
composes Node's `server`, route, path-pattern, and runtime capabilities. A
low-level Node tool may activate `@velarscript/node` directly. A framework-free Core project
activates nothing. The language does not guess what target you are on — see
[project lifecycle](project-lifecycle.md).

`surfaces` records what this project was written against: `core`, plus one
entry for each activated extension. The values are the ones the second line of
`velar --version` prints — for this release,
`core@0.8   web@0.14   node@0.17   server@0.15   desktop@0.10`. The key is
optional, but a declaration that is present must be complete, and when a
declared number no longer matches what is installed every command that loads
the project refuses and names the surface, both numbers, and the changelog
sections to read between them.

`AGENTS.md` is there because the model is the author. It names the Core brief
and the exact framework brief this template needs; `velar skill <owner>` prints
each version-locked document.

The generated `src/main.vel` keeps declarations and imports at module scope and
puts startup in the compiler-owned entry role. Its startup line has this shape:

<!-- velar-preamble
component App:
    return <main>Hello</main>
-->
```velar fragment
@main: mount(<App />, "#app")
```

`@main` may also own an indented body. It runs only when this source is selected
as an entry; importing the same module does not start it.
Generated application manifests state `"kind": "application"`. A reusable
package that needs Web or Node extension capabilities instead states
`"kind": "library"`; its entry may export declarations but cannot declare
`@main`, and no application host is created for it.

## 3. Run it

```sh
npm run dev
```

For Web/Desktop, the dev server rebuilds and serves the renderer. For Server,
it executes the selected entry's `@main`, reads the path declared by
`server.configuration` in `velar.json`, and restarts the last-good build after
a source or configuration change. Edit `src/app.vel`; the
generated Node service answers `/api/hello` and uses `npm start` (`velar serve`)
when a watcher is not wanted.

## 4. Change something, and let the compiler teach you

Open `src/app.vel` and write a JavaScript habit on purpose:

```text
export def visible(done: bool) -> bool:
    return !done
```

Then check it:

```sh
npm run check
```

```text
src/app.vel:2:12 error VEL1005: Use 'not'; VelarScript uses readable logical operators
    return !done
           ^
```

This is the shape of every diagnostic in Vel: it names **the one current
spelling**, not a list of possibilities. You do not have to know the language
to fix it, and neither does a model — which is the point. Write `not done` and
the error goes away.

Where a rewrite is purely mechanical, the compiler will do it for you:

```sh
npx velar fix
```

## 5. Test it

```sh
npm test              # unit tests, in Node
npm run test:browser  # Web/Desktop browser tests, in a real browser
```

A unit test is a named block in a `*.test.vel` module:

```velar
import {expect} from "velar/test"

export def slug(title: string) -> string: return title.lower().replaceAll(" ", "-")

test "a title becomes a url slug":
    expect(slug("Release Notes")).toBe("release-notes")
    expect(slug("Two  Spaces")).toBe("two--spaces")
```

The name is a sentence about the code, not an identifier — it is what you read
when the test fails.

Browser tests live in `*.browser.test.vel` and drive the real page through
`velar/web-test`. They only run under `velar test --browser`, and importing
that module anywhere else is refused at the import line.

## 6. Build it

```sh
npm run build     # produces the target-owned dist/
npm run verify    # Web: checks the static build is deployable
npm run preview   # Web: serves the verified build locally
npm run package   # Desktop: creates the native application package
```

A Node build is a standalone ESM directory containing the compiled entry,
copied public assets, the declared configuration, and `velar-node.json`.
`velar verify` validates the complete Node file inventory, sizes, hashes, entry
relationship, and build ID. Run the manifest's entry with Node from that
directory; the toolchain is not required at runtime.

Or run the whole gate in one command, which is what the generated `validate`
script and CI both run:

```sh
npm run validate
```

## 7. Hand it to your model

```sh
npx velar skill core
npx velar skill web      # then this, for Web and component projects
npx velar skill node     # then this, for low-level Node tools
npx velar skill server   # after Core + Node, for a service
npx velar skill desktop  # after Core + Web, for a Desktop project
```

Each command writes one markdown document to standard output. Nothing is
fetched and there is no account to hold: the briefs ship inside the compiler,
so the version you print is the version you installed. The generated
`AGENTS.md` names the exact sequence for its template, and Core,
[Web](ai-skill-web.md), [Node](ai-skill-node.md), [Server](ai-skill-server.md),
and [Desktop](ai-skill-desktop.md) are separate owner-specific briefs — a
project loads only the ones it needs, because a brief costs context. Calling
`velar skill` with no owner remains the Core shorthand.

## 8. When you move the toolchain

Pin the version you are on; when you raise it, three commands say what changed:

```sh
npx velar --version   # which of the five surfaces moved
npx velar fix         # apply the mechanical part of the migration
npx velar check       # what is left, each naming its one current spelling
```

`velar fix` rewrites only where the rewrite is provably equivalent, so what
`velar check` reports afterwards is the part that needed a decision. Then read
the [changelog](../CHANGELOG.md) sections for the surfaces whose number moved,
and write the new numbers into `velar.json`'s `surfaces` — the project refuses
to load against a toolchain it was not re-read for, which is the whole point of
declaring them.

## Where to go next

- [Best practices](best-practices.md) — the house style, with runnable code
- [Language reference](language-charter.md) — the full contract
- [Standard library](standard-library.md) and [Web framework](web-api.md)
- [Escape hatches](escape-hatches.md) — what to do when Vel is the obstacle
