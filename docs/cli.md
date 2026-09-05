# CLI reference

Every command, grouped by what you are doing. Run `velar --help` for the same
list from the toolchain you actually have installed.

Inside a project, npm scripts wrap most of these — `npm run dev`, `npm test`,
`npm run build`. Use `npx velar <command>` for the rest.

`velar --version` prints two lines: the release you installed, and the
**surface versions** it ships.

```text
velar <release>
  core@<count>   web@<count>   node@<count>   server@<count>   desktop@<count>
```

The numbers are deliberately not reproduced here — run the command and read
them off the toolchain you have, which is the only copy that cannot be stale.
The second line names the surfaces this project has installed. A project
installs the targets it declares, so a Core project — which declares none —
prints `core` and `node` alone: there is no Web, Server or Desktop package
present for a number to be read out of, and one written down here instead
would be exactly the stale copy this whole mechanism removes.

Every package in a release steps to the same number, so the first line cannot
say which of the five observable surfaces — the language itself, and the Web,
Node, Server and Desktop extensions — actually moved. The second line can. A
surface version is a counter: any addition, removal, or change to that surface
raises it by one, so a release that leaves a number alone is saying that
surface is unchanged and the code using it needs no re-reading. The `N` in
`0.N` is how many times that surface has moved since counting began, not a
maturity grade: a low number beside a high one means that surface started
counting later, and nothing more. Counting began for all five in the release
whose changelog section introduces them, and history was not recomputed. None
of these numbers is written by hand anywhere: a repository gate hashes each
surface's complete vocabulary and fails the build when a surface changes
without its version.

A project records what it was written against with `surfaces` in `velar.json`;
see [project lifecycle](project-lifecycle.md).

## Writing code

```text
velar check [entry.vel | project-directory]
velar graph [entry.vel | project-directory] [--focus <symbol|path>] [--depth <0-6>] [--json]
velar format [file.vel | project-directory] [--check]
velar fix [entry.vel | project-directory]
velar repro [entry.vel | project-directory] [--out-dir <directory>]
velar lsp
```

`check` compiles and reports diagnostics without producing output. Over a
project it reads **every `.vel` file under the project directory**, not only the
ones the entry imports: a module nothing imports yet — a chapter mid-refactor, a
file whose last importer was just deleted — is compiled as a root of its own and
its diagnostics are ordinary diagnostics. `build` refuses on them too, and still
emits only the graph the entry reaches, because checking is not emitting. Naming
a single file instead (`velar check src/main.vel`) scopes the run to that file's
own graph. It reports
**advisories** too — the second channel, for a spelling VelarScript accepts
with a meaning other than the one a Python or JavaScript reflex intended. An
advisory never fails anything: `check` prints it, names the count in its summary
line (`Checked 12 modules from src/main.vel — 3 advisories`), and exits 0, and
`build`, `test`, CI, and release never fail because of one. Answer one by
writing the spelling it names, or with a `// velar-allow <CODE>: <reason>`
comment on that line; a suppression with no reason, and one that no longer
applies, are both ordinary compile errors. The rules are in the
[language reference](language-charter.md#advisories).
`format` is the single canonical layout — there are no options, because a
second layout would be a second spelling, and it preserves a `velar-allow`
comment and its reason verbatim. `fix` applies the rewrites that are
**provably** equivalent, which is why it is safe to run unattended; anything
requiring a judgment call stays a diagnostic for you to answer, and that
includes every advisory — swapping the two names of a `for` header changes
which name binds which value, so an editor offers it as a quick fix and `fix`
leaves it alone. `lsp` speaks the Language Server Protocol for editors, and
shows an advisory as a warning rather than an error.

`graph` prints the compiler-owned logic view of the current project. Its compact
default keeps modules, components, state, computed values, actions, functions,
types, capabilities, and their exact ownership, call, read, write, and
derivation edges. `--json` exposes the same stable IDs and source spans to
tools. A model can ask for `--focus <symbol> --depth 2` to load only that
symbol's callers and dependencies when its context is bounded. The command
reads the current project on every invocation. Editor hosts keep one incremental
compiler session and ask `velar/ownershipGraph` with the previous revision; the
server reuses graph fragments for compiler-reused modules and returns a node/edge
patch for the unsaved document version. A truncated base or broad invalidation
falls back to one bounded full snapshot, with the update strategy reported in
`activity`.

Formatting is idempotent, and both `format` and the language server verify it:
if formatting the result would change it again, the file keeps the bytes you
wrote, `format` names it and exits non-zero rather than writing an unstable
layout, and the language server offers no edit at all.

`fix` rewrites only the source the project owns. An installed frozen library
loads its portable interface and never reaches the fixer; a source-fallback
package compiles as part of your project, so its diagnostics are reported beside
your own — on the same channel `check` reports them on — but `fix` never writes
a file that came out of one: a rewrite there is invisible to git, is destroyed by
the next `npm ci`, and makes the installed tree diverge from the tarball it was
published as. The boundary is the real path, so a module reached through a
symbolic link inside `src/` is left alone as well when the link points into an
installed tree. Inside the project, a read-only module is refused and named
rather than replaced, and a module hard-linked under a second name is written in
place so both names keep pointing at the same file. Every file is re-read
immediately before it is written, and one that changed since the compile that
computed the rewrite is left untouched and named as a file `fix` could not
write — a save that lands mid-pass survives verbatim instead of being reverted
without a word. A run that could not write a file, or that leaves a diagnostic
behind, exits non-zero.

`fix` migrates `velar.json` too, and does it first, because a manifest written
against a shape this compiler removed is what fails before anything else can
run. A target that retires a manifest shape carries the rewrite with it, and the
error the old shape raises names this command: `desktop.window` reports that
`desktop.windows` replaced it, and `velar fix` rewrites `window: {…}` as
`windows: {"main": {…}}`. The edit is surgical — the one member changes, and the
rest of the manifest keeps its bytes, key order and indentation — and running it
a second time changes nothing.

`fix` answers the project's own rules as well as the compiler's. A rule about
how the *project* is arranged — an application entry must declare `@main`, a
library entry must not — is enforced where the project is resolved rather than
where a module is compiled, and both commands now read it from one place, so
`fix` can no longer report "0 diagnostics remain" over a tree `check` refuses.
One of those rules migrates mechanically. An entry whose startup is a **single
non-block statement on one line at the end of the module** gets `@main:` written
in front of it, which is the rewrite the author would have made letter for
letter: the inline body has the statement semantics of an indented one, and
nothing else in the file moves. Two startup statements, a statement with a
declaration after it, a statement spread over several lines, and a one-line
statement that heads a block of its own all stay diagnostics — which statement
runs first is visible in the source today and a fixer that merged them would be
choosing an order rather than preserving one, and the inline body accepts one
non-block statement, so wrapping `if ready: start()` would leave source the
compiler no longer parses. Naming a single file scopes those rules out exactly
as it scopes out the tree walk.

`lsp` orders workspace symbols by match quality first, then by name ignoring
case, then by path. Ignoring case is the Unicode default case mapping rather
than a locale-tailored one, so `apple` comes before `Banana` on every machine
and no editor's picker reorders itself because one developer's `LC_ALL` differs
from a colleague's.

`repro` is for the case where the compiler itself looks wrong. It writes a
self-contained minimal reproduction — the source the diagnostic touches,
`velar.json`, the verbatim output, and the toolchain, Node, and platform
versions — into `.velar/repro`, then prints the path. Its `README.md` arrives
already laid out in the three sections a defect report carries, with *What the
compiler said* filled in for you. It writes to disk and does nothing else: no
upload, no network call, nothing collected about your machine, and every
absolute path rewritten to a project-relative one. Before it finishes it
extracts the bundle to a temporary directory and re-checks it there, and if the
copy stops reproducing it says so rather than handing you a false lead. A
failing `velar check` ends with the one line that names it. The doctrine it
mechanizes is [escape hatches](escape-hatches.md#4-a-suspected-compiler-defect).

## Running and testing

```text
velar dev [entry.vel | project-directory] [--port <port>]
velar serve [project-directory]
velar run [entry.vel | project-directory] [--stack] [-- <program-arguments>...]
velar test [project-directory | file.test.vel]
velar test [project-directory] --browser [chromium|firefox|webkit|all]
```

`dev` rebuilds on save and serves a Web/Desktop application or restarts the
last-good Server/Node entry module. Every application target executes the
selected source's `@main`. Web defaults to port 5173. Server host, port, and
request limits come only from the file named by `server.configuration` in
`velar.json`; Node `--port` and `serve --host` are not parallel configuration
channels. `serve` checks and runs the same entry with production runtime
behavior and no file watcher.
`run` executes a framework-free CLI program; `--stack` keeps the full trace
instead of hiding internal frames. `test` runs
`*.test.vel` modules in Node; `--browser` runs `*.browser.test.vel` modules in
a real browser, which requires the matching Playwright browsers to be
installed. A browser test that does not finish within its bound ends the run:
the supervisor names the test and the bound it outlived, writes the counts up to
it, and exits, so the browser tests after it are neither run nor reported. A
`.test.vel` file resumes past a wedged test instead; see
[project lifecycle](project-lifecycle.md).

The dev server a Web or Desktop project starts, and `preview`, bind the loopback
interface and answer only requests that address them as one. A request is
refused with `403` unless its `Host` header names `127.0.0.1`, `localhost` or
`[::1]`; unless its `Sec-Fetch-Site` header is absent, `none` or `same-origin`;
and unless its `Origin` header, when it sends one, is an `http` origin on a
loopback host **and on the same port the request was addressed to**. The refusal
body names the header it refused and the value it saw. Binding the interface is
not the whole defence: a page whose own hostname has been pointed at 127.0.0.1
is otherwise same-origin with the development server and can read
`/<module>.js.map`, whose `sourcesContent` carries your verbatim `.vel` source
and whose `sources` carries its absolute on-disk path. A second local server on
another port is a different origin, and the `Origin` rule refuses it like any
other; a tunnel that forwards its own hostname fails the `Host` rule instead —
run it with host-header rewriting, `ngrok http --host-header=rewrite 5173`, so
the request reaches the server addressed to localhost.

`dev`'s watcher ignores `node_modules/`, `.git/`, `.velar/` and the project's
`outDir`, at every depth and on every platform, for a Node project as well as a
framework one. A `velar build` or `velar test`
running in a second terminal writes into those directories, and without the
exclusion each write rebuilt the application and pushed a full-page reload that
discarded the page state being debugged. Request paths are percent-decoded
before a public asset is resolved, so `public/my file.txt` and a file with a
non-ASCII name are reachable in development exactly as they are after
deployment; a malformed percent escape is answered with `400`.

## Building and shipping

```text
velar build [entry.vel | project-directory] [--out-dir <directory>] [--mode <production|readable>] [--source-maps|--no-source-maps]
velar build <single.vel> --out <file.js> [--mode <production|readable>] [--source-maps|--no-source-maps]
velar build-library [project-directory] [--mode <production|readable>]
velar verify [project-directory | build-directory]
velar preview [project-directory | build-directory] [--port <port>]
velar verify-deployment [project-directory | build-directory] --url <https-origin> [--json]
velar package [project-directory]
```

`build` defaults to `production`: generated modules, target runtimes and bundled
applications are minified and safely tree-shaken. Use `--mode readable` for one
inspectable handover build, or make it the project default in `velar.json`:

```json
{
  "formatVersion": 2,
  "kind": "application",
  "entry": "src/main.vel",
  "build": { "mode": "readable", "sourceMaps": true }
}
```

JavaScript mode and Source Map are independent. `build.sourceMaps` defaults to
`false` for distributable builds and can be overridden for one invocation with
`--source-maps` or `--no-source-maps`. Development and test execution retain
their own enabled mappings regardless of the production build setting.

`build-library` is the release build for a `kind: "library"` Core or Node
library whose `package.json` declares the root `velar.entry`, optional exact
`velar.entries`, one `velar.artifacts` receipt, and a matching exact npm export
for every entry. It checks every entry independently, then emits all distinct
public entries through one ESM splitting build. Receipt format 2 records `.`
and every exact subpath in `entries`, the union of checked sources in `sources`,
and every shared JavaScript/source-map pair in `chunks`. Entry files and shared
chunks are hashed as one package artifact set. Consumers authenticate the full
set once per package and target. Commands that materialize a selected artifact
use its verified in-memory JavaScript/source-map snapshots; `build-library`
keeps an imported frozen package as its original bare npm specifier so that
package continues to own its dependency graph. The set must be a closed local ESM graph;
computed dynamic imports and relative edges outside its receipt fail closed.
Root-only packages retain
receipt format 1 and the original `index.*` layout. The `.vel` sources remain
separate published inputs; consumers use one compatible artifact set first and
compile source only as a fallback. ABI 1 does not build Web/Desktop component
packages. Exact subpath and conditional-export rules are in
[package distribution](package-distribution.md#package-source-entries).

The Source Map switch belongs to application/module `build` output. A frozen
entry map and every format-2 shared-chunk map remain mandatory because ABI 1
hashes and verifies them as part of the released artifact set.

For frozen dependencies, `run` and `test` preserve resolution from the
installed artifact owner and revalidate its bytes immediately before launch.
The installed dependency tree must remain unchanged while the command runs.
Framework-free and Node `build` currently require a
dependency-free frozen artifact and reject its external npm imports rather than
silently flattening or changing their runtime behavior.

`verify` checks that a build is actually deployable rather than merely present.
For a Node application, `build` instead writes a standalone ESM directory with
the compiled `@main` entry, copied public assets, the manifest-declared Server
configuration, and `velar-node.json`; run the recorded entry with Node from
that output directory. A WebSocket entry uses the same host, port, body limit,
and shared HTTP/WebSocket listener after build; its pinned transport dependency
is copied into the output.
Top-level `build.sourceMaps` controls whether source-map files are retained.
All commands read the same checked JSON-resource graph: `dev` watches and
serves it, `test` reconstructs used package resource exports in its sandbox,
browser builds bundle it, and framework-free builds copy its exact bytes and
portable ESM wrapper. Package resources must follow the manifest contract in
[package distribution](package-distribution.md#package-resources).
`verify-deployment` runs the same checks against a live origin. `package`
builds the target-owned native application package for a project whose
framework host implements that operation. Reusable Core/Node libraries publish
source and frozen artifacts through npm; Web/Desktop component packages remain
source packages. Their generated `validate` scripts run the appropriate build
and `npm pack --dry-run --json` so the package contents are checked before
publication. See [package distribution](package-distribution.md) and
[static deployment](static-deployment.md).

A Desktop project declares the windows it may open in `desktop.windows`, keyed
by **window kind**. `main` is required and is the window the host opens at
launch; every other kind waits for `openWindow`, and a kind that is not declared
here is refused at the call. A kind name is lowercase words joined by single
hyphens, and one application declares at most 32 of them. Every field has a
default, and each one is a closed vocabulary — an unknown field is named with
its exact path:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "extensions": ["@velarscript/desktop"],
  "desktop": {
    "productName": "Example",
    "identifier": "com.example.app",
    "windows": {
      "main": {
        "title": "Example",
        "width": 1280, "height": 820,
        "minWidth": 720, "minHeight": 520,
        "titleBar": "standard",
        "material": "none"
      },
      "note-preview": {
        "style": "panel",
        "frame": false,
        "level": "floating",
        "visibleOnAllWorkspaces": true,
        "aspectRatio": 1.6,
        "resizable": false,
        "width": 512, "height": 320
      }
    },
    "services": {
      "core": { "payload": "dist/service-core", "entry": "main.js", "restart": "always" }
    },
    "permissions": {
      "files": ["project", "dropped"],
      "processes": ["git"],
      "network": ["https://api.example.com"],
      "environment": [],
      "secrets": [],
      "links": ["https", "mailto"],
      "notifications": true,
      "secureStorage": ["CLOUD_SESSION"]
    }
  }
}
```

`title` defaults to `productName`. `titleBar` is `standard` or `hidden-inset`;
`material` is `none` or `sidebar` (macOS vibrancy, which implies the page paints
no background of its own); `style` is `window` or `panel`, where a panel is
non-activating, floats, and stays out of the window cycle; `frame`, `resizable`
and `visibleOnAllWorkspaces` are booleans defaulting to `true`, `true` and
`false`; `level` is `normal` or `floating`, and a panel defaults to `floating`
because that is what a panel is; `aspectRatio` locks the width-to-height ratio
when present. The older singular `desktop.window` was removed —
[`velar fix`](#writing-code) migrates it.

`desktop.services` declares the long-running processes the product owns — at
most eight, keyed by a name that follows a window kind's rule. `payload` is a
project directory `velar package` copies whole into
`Contents/Resources/services/<name>/`, and `entry` is a JavaScript file inside
it. The only runtime is the Node.js executable the bundle already carries: no
other executable is declarable, and a short-lived process is `velar/process`
with a `processes` grant instead. `restart` is `always` — an exponential backoff
from one second to a thirty-second cap, with five consecutive failures reaching
the terminal `failed` — or `never`.

The host allocates a loopback endpoint and a 128-bit token per service, hands
both to the process in `VELAR_SERVICE_ENDPOINT` and `VELAR_SERVICE_TOKEN`, and
expects a WebSocket server there; the handshake frames are pinned in
[`packages/desktop/README.md`](../packages/desktop/README.md). A third variable,
`VELAR_SERVICE_APP_DATA`, carries the application's own data directory — the
path `velar/desktop.appDataDirectory()` answers — because a service's data root
is the application's identity resolved on this machine and cannot be written
into a payload at build time. Those three are the whole of what the host adds:
`desktop.services` has no `env`. Services start before the renderer loads and
are not awaited, and quitting sends SIGTERM and then SIGKILL thirty seconds
later. A service payload is application code, so its
bytes are inside `desktop.build.sizeBudgetBytes` and any `.node` or `.dylib` it
carries is signed with the rest of the bundle. `velar dev` runs the same
services on the system Node, in the same three variables with the same values,
and converges them when the dev server closes; it does not watch or rebuild
them.

`desktop.permissions` is eight finite allowlists and one flag, and every one of
them defaults to no authority at all. A capability the manifest never declared
is refused where the program *calls* it, with the manifest line that would grant
it named in the error, and the native host asks the same question again on its
own side:

| Field | Grants | Vocabulary |
| --- | --- | --- |
| `files` | `velar/fs`, `velar/path`, and the paths a drag gesture brings in | `app-data`, `project`, `dropped` |
| `processes` | `velar/process` | exact executable names, never paths or shell text |
| `network` | `velar/http` and renderer navigation to an outside origin | exact HTTPS origins, or exact loopback HTTP origins |
| `environment` | `velar/env` | uppercase variable names |
| `secrets` | `velar/http` secret headers | uppercase variable names |
| `links` | `openExternal` | `http`, `https`, `mailto` |
| `notifications` | `velar/notification` | `true` or `false` |
| `secureStorage` | `velar/secure-storage` | uppercase variable names |

`dropped` is not a directory: it authorizes reading the files a user's own drag
gesture brings in and learning their real filesystem paths — the gesture is the
grant, and it lasts the session. `links` governs `openExternal`, which hands a
URL to the system default handler; `network` separately governs what the
renderer itself may reach, so a link the application opens and an origin it
fetches from are two grants rather than one. `secrets` and `secureStorage` share
a spelling rule and may not share a name: the first is an opaque value the
environment injects, the second is a credential slot the application writes and
reads in the macOS keychain, and one name naming both would be two authorities
wearing one label. `notifications` declares intent only — the operating system
still asks the user, and `requestPermission()` is how the application learns that
answer.

### Packaging a Desktop application

`velar package` produces a **self-contained** `.app`: the user needs nothing
installed. The bundle carries one bare Node.js executable at
`Contents/MacOS/node`, and the version is the toolchain generation's rather than
the project's — `velar.json` has no field for it, and every application this
toolchain builds carries the same interpreter. The first `velar package` on a
machine downloads the official archive from `nodejs.org`, checks it against the
`SHASUMS256` digest this toolchain pins, and caches the executable under
`~/Library/Caches/velarscript/desktop-runtimes/<version>/<platform>-<arch>`
(`VELAR_DESKTOP_RUNTIME_CACHE` moves that directory and nothing else). Later
builds are offline. A cache entry whose bytes no longer match its receipt is
treated as absent rather than trusted, and an offline build with nothing cached
names the version and the directory to prime.

`desktop.build.sizeBudgetBytes` (32 MiB by default) governs the **application's**
components — native host, renderer, capability host, metadata. The runtime is not
one of them: no project change removes or shrinks it, so it is reported
separately and held to a fixed 200 MiB integrity ceiling the toolchain owns.

The bundle is always signed, because an arm64 Mach-O with no signature cannot be
executed. `desktop.build.signing` carries the three answers that belong to the
product, and nothing about the mechanics:

```json
{
  "desktop": {
    "build": {
      "signing": {
        "identity": "Developer ID Application: Example Inc (TEAMID1234)",
        "entitlements": "build/app.entitlements",
        "notarization": { "keychainProfile": "example-notary" }
      }
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `identity` | The `codesign` identity. Omit it for an ad-hoc signature, which is what a local build gets; writing `"-"` is refused, because absence already means ad-hoc. |
| `entitlements` | A project-relative entitlements plist applied to the host and the bundle. The embedded runtime is signed separately with the language's own minimal file. |
| `notarization.keychainProfile` | A profile `xcrun notarytool store-credentials` already stored. It is a reference the local keychain resolves, so no credential reaches the manifest, the build log, or the build receipt. Requires `identity`: Apple does not notarize an ad-hoc signature. |

Signing runs inside-out — the runtime first, then the host, then the bundle —
because macOS seals a bundle from its leaves inward and re-signing the bundle
invalidates anything signed after it. The runtime's own entitlements are supplied
by the language and contain exactly one key,
`com.apple.security.cs.allow-jit`: without it the hardened runtime refuses V8 its
code range, and the application dies on its first capability call rather than at
build time. The file is written beside the build manifest as
`velar-desktop-runtime.entitlements` so the signature is auditable.

`velar-desktop-build.json` is `formatVersion` 4. Its `runtime` is
`{"kind": "embedded-node", "version", "embedded": true, "bytes", "sha256"}`,
where `sha256` is the official archive digest that was verified — provenance,
not a hash of the shipped bytes, which this build's own signature has already
changed. `services` lists each declared service with its entry, restart policy,
byte count and the digest of the entry file the host will run. `sizes` reports
`applicationBytes` and `runtimeBytes` beside the component breakdown — including
`servicesBytes`, which is inside the application's budget — and `signing`
records the mode and whether the build was notarized, never by whom. There is no
reader for version 3.

The packaged host accepts `--headless-smoke`: it starts, launches the capability
worker on whichever runtime it resolved, completes one real capability
round-trip, starts every declared service and waits for each to answer the
authenticated handshake, converges them, prints what answered, and exits 0. That is the packaging gate's
acceptance, and it is the only thing this host calls a smoke. `--verify-bundle`
is the static check beside it: the bundle is complete and a runtime resolves.
It cannot be an acceptance, because resolving a runtime means asking
`node --version`, which returns before V8 has created an isolate — a bundle
whose interpreter cannot execute JavaScript passes it. The check was once
called `--smoke`, which is why it was believed; the flag now says what it does
and there is no alias for the old spelling.

Build output is fixed by the toolchain, not by the machine that runs it.
Project modules are ordered by UTF-16 code unit over their POSIX-normalized
project-relative path, and that order decides the concatenated stylesheet's
bytes, its content hash, and `buildId`, so two builds of the same source agree
whatever `LANG` or `LC_ALL` the build machine has set. The manifest inventory,
the package lists in `velar-build.json`, and every other list the toolchain
promises to reproduce use that same order — the order a plain
`Array.prototype.sort` gives, which is the order `verify` checks against.

`velar-deploy.json` states its `headers` rules in order, and they resolve
**last match wins**. The `<base>*` rule carries the security headers and
`Cache-Control: no-cache`; the later `<base>assets/*` rule overrides that with
`public, max-age=31536000, immutable` for the content-hashed output, and the
enumerated document paths restate `no-cache`. A provider that applies
first-match-wins instead would give the hashed assets `no-cache`, so project the
rules in the order the manifest states them. Because `<base>*` states the
document rule itself rather than `preview` supplying it out of band, every file
outside `assets/` — public JSON, images, and fonts included — answers
`no-cache`, a provider that projects the manifest literally is indistinguishable
from `preview`, and `verify-deployment` checks the resolved value for every file
it fetches.

## Projects and dependencies

```text
velar create <project-directory> [--template <web|node|desktop|docs|library|component>]
velar install
velar add <package[@version]>... [--dev]
velar remove <package>...
velar update [package...]
```

npm still owns dependency resolution and the lockfile. These commands add a
project-aware surface on top of it and keep extension activation in
`velar.json` synchronized — they do not replace npm, and they do not introduce
a second registry. Details in [project lifecycle](project-lifecycle.md).

A manifest this toolchain cannot read is reported in the direction it is wrong
in. `unsupported formatVersion 3: newer than this toolchain supports (2);
upgrade @velarscript/cli` means a later toolchain wrote the project.
`unsupported formatVersion 1: no longer supported by this toolchain (2)` means
the format is one this compiler no longer reads. There is no migration command,
and there is deliberately no reader for a legacy format.

A VelarScript toolchain is one generation. `@velarscript/cli` pins every
official target extension to its own version, and a project resolves its
extensions before the toolchain does, so a target extension installed from
another release would otherwise load its own nested compiler with nothing in the
load path able to tell — `protocolVersion` has never moved, and `apiVersion` is
compared against the extension's own manifest. Every command that loads a
project therefore compares the version the project resolves against the version
this CLI was published against, and refuses a mismatch by name and version:

```text
node_modules/@velarscript/node/package.json: this project resolves
@velarscript/node 0.99.0, but @velarscript/cli 0.14.2 is built against
@velarscript/node 0.14.2; a VelarScript toolchain is one generation, so install
@velarscript/node 0.14.2 or @velarscript/cli 0.99.0
```

The path is the manifest the resolution actually read, and the running command
prefixes its own name to the line. Install either version the message names.
`create` writes exact versions for this reason: a caret range lets `npm install`
pair a newer target extension with the pinned CLI.

## Handing work to a model

```text
velar skill [core|web|node|desktop]
velar graph [project-directory] [--focus <symbol|path>] [--depth <0-6>] [--json]
```

Prints one owner-specific language brief, version-locked to the installed
compiler. Core is the default; framework projects load Core plus the briefs
named by their generated `AGENTS.md`: [Web](ai-skill-web.md),
[Node](ai-skill-node.md), or [Desktop](ai-skill-desktop.md).
Use `velar graph` before a project-wide edit to obtain the current global
semantic view; use `--focus` for a smaller caller/dependency neighborhood.
