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

`check` compiles and reports diagnostics without producing output. `format` is
the single canonical layout — there are no options, because a second layout
would be a second spelling. `fix` applies the rewrites that are **provably**
equivalent, which is why it is safe to run unattended; anything requiring a
judgment call stays a diagnostic for you to answer. `lsp` speaks the Language
Server Protocol for editors.

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
velar run [entry.vel | project-directory] [--stack] [-- <program-arguments>...]
velar test [project-directory | file.test.vel]
velar test [project-directory] --browser [chromium|firefox|webkit|all]
```

`dev` rebuilds on save and serves the app. `run` executes a Node/CLI project;
`--stack` keeps the full trace instead of hiding internal frames. `test` runs
`*.test.vel` modules in Node; `--browser` runs `*.browser.test.vel` modules in
a real browser, which requires the matching Playwright browsers to be
installed.

## Building and shipping

```text
velar build [entry.vel | project-directory] [--out-dir <directory>]
velar build <single.vel> --out <file.js>
velar verify [project-directory | build-directory]
velar preview [project-directory | build-directory] [--port <port>]
velar verify-deployment [project-directory | build-directory] --url <https-origin> [--json]
velar package [project-directory]
```

`verify` checks that a build is actually deployable rather than merely present.
`verify-deployment` runs the same checks against a live origin. `package`
builds the target-owned native application package for a project whose
framework host implements that operation. Reusable library and component
source packages are published through npm; their generated `validate` script
runs `npm pack --dry-run --json` so the package receipt is checked before
publication. See [package distribution](package-distribution.md) and
[static deployment](static-deployment.md).

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

## Handing work to a model

```text
velar skill
```

Prints the full language brief, version-locked to the installed compiler. It is
the same document as [the AI skill brief](ai-skill.md).
