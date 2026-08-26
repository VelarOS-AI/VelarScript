# CLI reference

Every command, grouped by what you are doing. Run `velar --help` for the same
list from the toolchain you actually have installed.

Inside a project, npm scripts wrap most of these — `npm run dev`, `npm test`,
`npm run build`. Use `npx velar <command>` for the rest.

## Writing code

```text
velar check [entry.vel | project-directory]
velar format [file.vel | project-directory] [--check]
velar fix [entry.vel | project-directory]
velar repro [entry.vel | project-directory] [--out-dir <directory>]
velar lsp
```

`check` compiles and reports diagnostics without producing output. It reports
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
last-good exported Server/Node zero-argument startup function. Web defaults to
port 5173. Server host, port, and request limits come only from root
`application.yml`; Node `--port` and `serve --host` are not parallel
configuration channels. `serve` checks and
runs the server startup function with production runtime behavior and no file
watcher.
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
  "entry": "src/main.vel",
  "build": { "mode": "readable", "sourceMaps": true }
}
```

JavaScript mode and Source Map are independent. `build.sourceMaps` defaults to
`false` for distributable builds and can be overridden for one invocation with
`--source-maps` or `--no-source-maps`. Development and test execution retain
their own enabled mappings regardless of the production build setting.

`build-library` is the release build for a Core or Node library whose
`package.json` declares `velar.entry`, one `velar.artifacts` receipt, and a root
npm export. It replaces that declared artifact directory transactionally with
frozen ABI-1 JavaScript, its ABI-owned source map, a portable type interface, and their hash
receipt. The `.vel` source remains a separate published input; consumers use
the artifact first and compile source only as a fallback. ABI 1 does not build
Web/Desktop component packages.

The Source Map switch belongs to application/module `build` output. A frozen
library map remains mandatory because ABI 1 hashes and verifies it as part of
the released artifact set.

`verify` checks that a build is actually deployable rather than merely present.
For a Node application, `build` instead writes a standalone ESM directory with
copied public assets, `.velar-node-entry.mjs`, and `velar-node.json`; run the
launcher with Node from that output directory. A typed WebSocket startup entry
uses the same host, port, body limit, and shared HTTP/WebSocket listener after
build; its pinned transport dependency is copied into the output.
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
```

Prints one owner-specific language brief, version-locked to the installed
compiler. Core is the default; framework projects load Core plus the briefs
named by their generated `AGENTS.md`: [Web](ai-skill-web.md),
[Node](ai-skill-node.md), or [Desktop](ai-skill-desktop.md).
