# Examples

Two things live here, and they teach different halves of writing VelarScript.

|  | teaches | come here when you are asking |
|---|---|---|
| [`tour/`](tour/) | **every spelling, exactly once** | "how do I say *this* in Vel?" |
| [`app/`](app/README.md) | **how a real codebase is put together** — module division, state ownership, routing, tests | "what does Vel at real size look like?" |

They are two kinds of knowledge, not two sizes of the same one. Knowing that
`resource` exists does not tell you whether the release feed belongs in a
resource, in a module store, or in a component; knowing how one application is
laid out does not tell you the syntax for a keyframes block. So the tour puts ten
nearly identical spellings side by side on purpose, and the application never
does that — it shows one choice and says why.

**Read them in this order.** The tour first, skimmed rather than studied: it is a
reference you come back to. Then the application, start to finish, because
structure only makes sense whole.

---

## `tour/` — every spelling, exactly once

Three projects, because VelarScript has three compilation targets and each one
has vocabulary the others do not:

| project | target | what it covers | run it with |
|---|---|---|---|
| [`tour/core/`](tour/core/) | Core (no extension) | 17 chapters: values, types, records and enums, collections, control flow, classes, errors, modules, the JavaScript boundary, files, processes, testing | `velar run examples/tour/core` |
| [`tour/web/`](tour/web/) | `@velarscript/web` | 13 chapters: components and JSX, directives, state and derived values, resources and actions, lifecycle, Look, routing, browser capabilities, storage and connections, both kinds of test | `velar dev examples/tour/web` |
| [`tour/desktop/`](tour/desktop/) | `@velarscript/desktop` | 4 chapters: the desktop host surface, project files and tasks, the desktop test module, and a desktop browser test | `velar dev examples/tour/desktop` previews the renderer; `velar package` builds the native application |

(Inside this repository the CLI is `npm run velar -- <command>`; with VelarScript
installed it is just `velar <command>`.)

**Everything Core can compile lives in `core/`, even when a Web application is
where you would meet it.** `List`, `Map`, `match`, `try`, classes, and modules
are language, not Web — a Node service and a desktop application use them
identically. Keeping them in one place means the Web tour is exactly the Web
addition and nothing else, so "is this part of the language or part of the Web
extension?" is answered by which directory the chapter is in. `tour/web/` and
`tour/desktop/` each cover only what their extension adds on top.

The tour is also gate corpus, which may be the larger of its two payoffs. The
formatter walks every `.vel` under `examples/`, CI checks and builds every project
here, and a coverage gate reverse-queries the compiler's own vocabulary tables and
fails by name when a spelling is missing from the tour. A formatter or analyzer
defect in a corner nothing else exercises used to have somewhere to hide; this is
the corner, and it is now walked on every run.

### The rule anyone adding a chapter has to know

**`velar check` does not check a `.vel` file the entry cannot reach.** It walks
the module graph starting at the manifest's `entry`; a file that nothing imports
is not in that graph, so it is not compiled, and a chapter with a genuine type
error in it will pass the gates in silence.

There is exactly one exception: a `*.test.vel` module (including
`*.browser.test.vel`) is discovered by `velar test` in a second pass of its own,
which is why the testing chapters carry that suffix instead of a `main.vel` line.

Everything else has to be reachable, and bare side-effect imports are not part of
the language. So the arrangement in all three projects is the same, and it is
deliberate rather than decorative:

- every chapter exports at least one name;
- `main.vel` imports each of those names, one line per chapter, written out
  rather than globbed.

**Adding a chapter file without adding its line to `main.vel` silently removes
that chapter from compile coverage.** Formatting coverage stays — the formatter
walks directories, not the module graph — which makes the loss even quieter: the
gates still touch the file, they just stop compiling it. If you add a chapter,
add the import.

---

## `app/` — one complete application

[Release Studio](app/README.md): a release-readiness console with four routes, a
shared store, persisted reader preferences, a form, unit tests, and browser tests
that run the built application in Chromium, Firefox, and WebKit.

Its README is the interesting part — it walks the module map and the four
decisions worth copying: where state belongs, why a component prop is a readonly
view, why the route table lives in one module, and which tests need a browser.

```sh
velar check examples/app
velar test examples/app
velar test examples/app --browser all
velar dev examples/app
```
