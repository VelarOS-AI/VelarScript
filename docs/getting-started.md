# Getting started

From nothing to a running, tested application. Ten minutes.

You need **Node.js 24 or newer**. Everything else comes from npm.

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
  velar.json                  project format, entry, extension-owned settings
  package.json                npm dependencies and the script names below
  AGENTS.md                   instructions for the model that will write this app
  public/                     files copied to the build as-is
  src/
    main.vel                  entry — mounts the app
    app.vel                   the application itself
    app.test.vel              unit tests, run in Node
    app.browser.test.vel      browser tests, run in a real browser
```

Two things are worth noticing now.

`velar.json` lists **extensions** explicitly. A Web project activates
`@velarscript/web`; a Server project activates `@velarscript/server`, which
composes Node's `server`, route, path-pattern, and runtime capabilities. A
low-level Node tool may activate `@velarscript/node` directly. A framework-free Core project
activates nothing. The language does not guess what target you are on — see
[project lifecycle](project-lifecycle.md).

`AGENTS.md` is there because the model is the author. It names the Core brief
and the exact framework brief this template needs; `velar skill <owner>` prints
each version-locked document.

## 3. Run it

```sh
npm run dev
```

For Web/Desktop, the dev server rebuilds and serves the renderer. For Server,
it checks the exported zero-argument startup function, loads the root
`application.yml`, and restarts the last-good build after a source or
configuration change. Edit `src/app.vel`; the
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
npm run test:full     # extended historical hardening suite
npm run test:browser  # Web/Desktop browser tests, in Chromium
```

A unit test is a named block in a `*.test.vel` module:

```velar
import {expect} from "velar/test"

export def slug(title: string) -> string:
    return title.lower().replaceAll(" ", "-")

test "a title becomes a url slug":
    expect(slug("Release Notes")).toBe("release-notes")
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

A Node build is a standalone ESM directory containing copied public assets,
`velar-node.json`, and `.velar-node-entry.mjs`. Run the launcher with Node from
that directory; the toolchain is not required at runtime.

Or run the whole gate in one command, which is what CI does:

```sh
npm run validate
```

## 7. Hand it to your model

```sh
npx velar skill core
npx velar skill web      # Web and component projects
npx velar skill node     # Node services
npx velar skill desktop  # after Core + Web for Desktop projects
```

The generated `AGENTS.md` names the exact sequence for its template. Core,
[Web](ai-skill-web.md), [Node](ai-skill-node.md), and
[Desktop](ai-skill-desktop.md) have separate owner-specific briefs, all
version-locked to the installed compiler. Calling `velar skill` with no owner
remains the Core shorthand.

## Where to go next

- [Best practices](best-practices.md) — the house style, with runnable code
- [Language reference](language-charter.md) — the full contract
- [Standard library](standard-library.md) and [Web framework](web-api.md)
- [Escape hatches](escape-hatches.md) — what to do when Vel is the obstacle
