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
velar lsp
```

`check` compiles and reports diagnostics without producing output. `format` is
the single canonical layout — there are no options, because a second layout
would be a second spelling. `fix` applies the rewrites that are **provably**
equivalent, which is why it is safe to run unattended; anything requiring a
judgment call stays a diagnostic for you to answer. `lsp` speaks the Language
Server Protocol for editors.

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
prepares a library or component package for publication — see
[package distribution](package-distribution.md) and
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
