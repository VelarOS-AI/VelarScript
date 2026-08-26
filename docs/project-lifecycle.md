# VelarScript Project Lifecycle

Status: project format 2, explicit compiler extensions

Projects are created through `npm create velar` or the installed CLI. Both
commands use the same transactional `create-velar` implementation:

```sh
npm create velar@latest my-app
npm create velar@latest api -- --template node
npm create velar@latest desktop-app -- --template desktop
npm create velar@latest product-docs -- --template docs
npm create velar@latest shared-library -- --template library
npm create velar@latest component-library -- --template component

velar create my-app
velar create api --template node
velar create desktop-app --template desktop
velar create product-docs --template docs
velar create shared-library --template library
velar create component-library --template component
```

Creation refuses non-empty targets and assembles the complete project in a
sibling staging directory before the final rename. It does not install
dependencies, browsers, initialize Git, publish, or deploy.

The first install remains ordinary npm bootstrap because a newly created
project does not yet have its local `velar` executable. After that, dependency
maintenance can stay inside the project-aware CLI:

```sh
cd my-app
npm install
npm exec velar -- add package-name
npm exec velar -- add test-package --dev
npm exec velar -- update
npm exec velar -- remove package-name
```

These commands do not replace npm. npm owns dependency resolution and the lock;
VelarScript validates that it is operating inside a format-2 project and synchronizes
only extension activation metadata. An extension package opts in through its
own `package.json` `velar.extension` object, so compiler composition has no
official Web or future Game source-semantic branch. The installed CLI carries
an explicit allowlist of its matching official Web and Desktop application targets
solely as a zero-`node_modules` distribution fallback; arbitrary extensions
still resolve only from the project.

Format 2 makes the language/framework boundary explicit:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "outDir": "dist",
  "publicDir": "public",
  "build": { "mode": "production", "sourceMaps": false },
  "extensions": ["@velarscript/web"],
  "web": {
    "title": "My VelarScript App",
    "base": "/",
    "icon": "velarscript-mark.svg",
    "publicConfig": {},
    "security": { "contentSecurityPolicy": true },
    "deployment": { "spaFallback": true }
  }
}
```

`web.icon` names the document favicon as a path relative to `publicDir`. The
framework host emits `<link rel="icon">` with `web.base` applied and the media
type derived from a closed extension set: `.svg`, `.png`, `.ico`. Naming a file
that `publicDir` does not contain fails the build. Leaving the key out emits
`<link rel="icon" href="data:,">`, an empty inline icon that stops the browser
from requesting `/favicon.ico` on its own — the right default offline and under
the production Content Security Policy. The favicon is a build-time document
fact like `web.title`, so it belongs to the manifest rather than to the `Head`
component, which owns what changes during a component's lifetime.

`extensions` is required. A Core library uses `"extensions": []` and does not
install `@velarscript/web`. A Web application installs and declares
`@velarscript/web`; that package contributes component/JSX syntax, reactive and
lifecycle semantics, Web types, standard modules, runtime code, manifest
validation, and syntax-aware project-editor behavior. The CLI only resolves and composes those
contributions. Its separate `/host` export also provides the framework-owned
application/error HTML, CSP/reload/deployment/browser-test contract; the CLI validates protocol
version 1 and supplies only generic host mechanics.

There is deliberately no legacy manifest loader and no `velar upgrade`
command. Missing, format-1, and unknown future versions fail before source is
compiled. This is a clean architectural break rather than a compatibility
transition. Unknown project fields and unknown extension-owned fields also fail
closed.

The `web`, `node`, `desktop`, `docs`, `library`, and `component` templates share
the same creator. The three application targets begin with a branded Hello
experience while retaining their target's ordinary project model: Web uses an
interactive component, Node uses a checked HTTP server, and Desktop remains one
system-WebView project with no renderer/main source split. Web, Desktop, and
docs projects include Core tests plus browser tests. `library` is a
framework-free Core dual-source/artifact package built with `velar build-library`.
`component` is a Web source package with a
single published `velar.entry`, a local preview application, a Core contract
test, a browser rendering test, and `@velarscript/web` as both a development
dependency and consumer peer contract. Assertions come from `velar/test`.
Browser automation is a Web extension surface imported from `velar/web-test`
and runs only through `velar test --browser`; the import is legal only inside a
`*.browser.test.vel` module and is refused anywhere else.

`velar run [entry.vel | project-directory] [--stack] [-- <program-arguments>...]`
compiles the resolved Core module graph and executes its entry module once on
Node.js with inherited stdio; the program's exit code becomes the command's
exit code, arguments after `--` reach the program through `process.argv`, and
stack traces map back to `.vel` sources. Entry resolution mirrors
`velar check`. An uncaught program error is presented as a VelarScript failure
with the `.vel` frame that raised it; `--stack` prints the full Node.js trace
instead. Projects that enable a web application framework are rejected
and belong to `velar dev` and `velar build`.

The command remains the lifecycle owner of that compiled child. Its first
SIGINT or SIGTERM is forwarded so `velar/host.onShutdown` can finish the
program's registered cleanup; the launcher's deadline exceeds the public
30-second cleanup window. A second signal, or an expired launcher deadline,
force-terminates the child. The CLI waits for the child's inherited
stdio to close and reports conventional status 130 or 143 when the child exits
from the forwarded signal, so terminating the command cannot leave a detached
VelarScript program holding files, ports, or output streams.

`velar test` holds one trust rule, and `velar test --browser` holds the same
one: any unowned error during a test fails that test. A detached-task failure
report, an uncaught exception or unhandled rejection (a module whose
initialization touches the DOM in a headless run is the canonical case), a page
error or error/warning console message in a browser run, or anything else that
reaches the host error channel while a test runs marks that test failed; an
unowned error while a test file loads fails that file's tests before they can
run green. A `.browser.test.vel` body runs in the test process rather than in
the page, so a page API called from it reports through that same host channel
and fails the test there. The runner itself keeps running — the failure belongs
to the test, never to the process — and the exit code reports it. A green suite
therefore means no test printed an error anywhere, not merely that every awaited
assertion passed.

Work a test starts is work the test owns, so the rule reaches past the test's
own return. The Node runner waits for the thread a test ran in to have nothing
left to do before it takes that test's verdict, which is what attributes a
late failure to the test that started it rather than to whichever test happens
to be running when it lands. A fixed grace window cannot do that job: a
failure one millisecond past it is a failure nobody counts. The wait carries
an owned upper bound, and its expiry is itself a failure — work that never
finishes is work whose failure could never be reported. A test that does not
finish within its own bound is reported the same way: the bound reports the
failure the test could not.

The bound a synchronously spinning test obeys cannot live in the thread that
test wedged, because the timer that would report it is work that thread never
yields to. Each `.test.vel` file therefore runs in its own worker thread, and
the runner ends that thread. The test is reported failed, and the file resumes
in a fresh thread one test past the one that ended its predecessor, so the
tests after it are still judged. Ending the thread also ends the abandoned
body, which is what stops a timed-out test from going on mutating state a later
test asserts against; the runner waits for that body's own last failure before
it moves on, so a failure the body produces after its bound expired is charged
to the test that produced it rather than to whichever test it lands during.

A thread per test file is also what resets the module graph. A fresh thread
evaluates every module the file imports again, not only the file itself, so a
file that passes on its own passes whatever its neighbours are named and
whichever order discovery ran them in. Tests inside one file still share their
file's module state, which is what a module-level fixture is for. The cost is
one thread startup and one full evaluation of that import graph per test file,
paid before the file's first test runs.

A file that resumes past a wedged test initializes its modules a second time.
Module work that can only be done once fails the resumed thread as a load
failure, and the report says which test the file resumed at.

A `.browser.test.vel` body runs in the browser-test worker process rather than
in the page, and a process cannot be resumed the way a thread can. Its
supervisor names the wedged test, writes the counts through it, and ends the
run there, so the browser tests after it are not reported. One process also
runs every browser test in the run, so that runner cannot wait for it to have
nothing left to do between tests without ending the process the remaining tests
need. It flushes the reports already queued before each verdict instead, and
waits for the process to have nothing left to do once, under its own bound,
after the last test of the run. A failure from work a browser test left running
is therefore charged to whichever test is running when it lands, or reported
against the run when it lands after the last one; an expired wait fails the run
in its own right.

`velar test` and `velar run` compile into a short-lived sandbox inside the
project — `.velar/test-*` and `.velar/run-*` — rather than the system
temporary directory. Keeping the compiled tree inside the project preserves
Node's upward `node_modules` resolution, so bridged JavaScript dependencies
(`import js` packages declared in `package.json`) resolve against the
project's real installation with no environment overrides. The sandbox is
removed after each run; add `.velar/` to `.gitignore` (the project templates
already do).

`velar format` recursively owns project `.vel` files while excluding `.git`,
`node_modules`, `.velar`, `publicDir`, and `outDir`. `velar format --check` is read-only.
Build, verification, preview, and remote-deployment verification continue to
operate on isolated, integrity-checked production output.
For application targets with a native package host, `velar package` first runs
the same checked production build and then delegates native container assembly
to that target. `velar build` remains the renderer/static artifact command.

An explicit manifest file may be passed instead of the conventional project
directory. This supports checked-in deployment profiles sharing source and
public roots while declaring different Web base paths, source-map
policy, or public configuration. Extension selection is always declared in the
selected manifest and is never inferred from source text.
