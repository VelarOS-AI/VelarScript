# VelarScript gates

Status: current; the ruling is
[D116](../decisions/D116-SCOPED-GATES.md), and the code organization it is one
half of is [D115](../decisions/D115-AGENT-MAINTAINABLE-CODE-ORGANIZATION.md) §五 P5.

There are two tiers and two commands.

```sh
npm run gate            # the quick tier, scoped to what this change set can move
npm run release:check   # everything, quick tier and heavy tier both
```

`npm run gate` is what a wave runs. It works out what this change set can have
moved, runs exactly that, and prints what it skipped and why. `release:check` is
what a release runs, and it is the only place the heavy tier lives. The one
thing `release:check` does not repeat is the emitted-output fingerprint: that
comparison belongs to `npm run gate`, which runs on every wave and every push,
and a release takes the browser and packed-consumer verdicts directly rather
than through the lock that stands in for them.

## The two tiers

| Tier | What is in it | When it runs |
| --- | --- | --- |
| **Quick** (`npm run gate`) | `check` (the build and every `check:*`), the emitted-output fingerprint against `output-fingerprint.lock`, the planned Node test files, and `velar test` over the example projects the plan reaches | every wave, every merge, every push and pull request in CI |
| **Heavy** (`npm run release:check`) | `check`, the whole unscoped Node quick suite (`npm test`), `test:packages`, `test:browser`, and `test:full` — which adds every `*.slow.test.ts` | before a release; in CI on a `v*` tag, once a day at 03:00 UTC, and on manual dispatch |

A suite is skipped for exactly one reason: this change set cannot alter its
verdict. Two things decide that. The **package dependency closure** says a
change upstream reaches every package downstream of it. The **emitted-output
fingerprint** says the browser and packed-consumer suites only ever run emitted
artifacts, so output that is byte-identical to its committed lock is a verdict
that has not moved. Everything below is those two facts made mechanical.

## How the scope is computed

`scripts/gate-scope.mjs` answers "what can this change have moved?" in four
steps.

**1. The change set comes from git, not from a human.** It is
`git diff --name-only <base>...HEAD` unioned with everything
`git status --porcelain` reports — staged, unstaged and untracked alike, because
a wave's work is uncommitted while its gate runs. `<base>` is the merge base
with `origin/main` by default, `--since <ref>` otherwise, and `HEAD~1` in a
checkout that has neither. A clean tree with no diff has told the gate nothing,
so it runs the whole quick tier and says so.

**2. Every changed path gets one owner.**

| Path | Owner |
| --- | --- |
| `packages/<p>/**` | the package `p` |
| `examples/<project>/**`, `tests/fixtures/<project>/**` | the packages that project's own `velar.json` declares in `surfaces` and `extensions`; a Core-only project is `core`. Not `compiler`: a project is downstream of the compiler, so changing one cannot move a compiler verdict |
| `tests/<package>/**` | the package that directory names — D115 P5's layout, where the directory *is* the ownership |
| `tests/**/*.test.ts` | its directory's package, unioned with what its imports exercise |
| `tests/acceptance/**`, `tests/repo/**`, `tests/support/**`, other `tests/**` harness files | `repo` |
| `scripts/**`, `.github/**`, `package.json`, `package-lock.json`, `tsconfig*.json`, `file-budget-allowlist.json`, `surface-lock.json`, `output-fingerprint.lock`, `tests/ownership.generated.json`, `tests/ownership.exceptions.json` | `repo` |
| `docs/**`, any `*.md` | `docs` |
| anything else | `repo` |

`repo` means everything downstream of the compiler — that is, all of it. `docs`
means `check`, plus the handful of tests that read a repository document and
assert on it: the documentation surface is mostly what `check:docs`,
`check:fence-format` and `check:tour-coverage` already compile and compare, but
`tests/server/server-port-zero.test.ts` reads `docs/ai-skill-server.md` and asserts that
the bound the runtime enforces is the bound the skill states. A suite is skipped
only when the change cannot alter its verdict, and a documentation change can
alter that one, so `docs` is an owner a test can hold like any other.

**3. The owners are closed downstream over the package graph.**

```text
compiler → core → { web, node } → { desktop (web + node), server (node) }
cli, create → downstream of every package
```

Changing `web` puts `web`, `desktop`, `cli` and `create` in the closure;
changing `compiler` puts everything in it; changing only documentation puts
nothing in it. The graph is declared once, in `PACKAGE_UPSTREAM` in
`scripts/gate-scope.mjs`, and a package under `packages/` that is missing from
it is a failure rather than a silently absent edge.

**4. A test runs when anything it exercises is in the running set** — the
closure, plus `docs` when a document changed. A test owned by `{compiler}` alone
does not run for a Web change; a test owned by `{compiler, web}` does, because
`web` is in the closure. `repo` is the one owner not matched by name: it means
"every package", so a `repo`-owned test runs on any change that reaches a
package and not on a documentation-only change, which reaches none.

`npm run gate -- --explain` prints all four steps for the current tree and runs
nothing.

## Where test ownership comes from

`tests/ownership.generated.json` is derived from the test files themselves, and
`check:test-ownership` regenerates it into a temporary file and refuses any
difference — the same contract `check:runtime-sources` has. It is never edited
by hand:

```sh
node scripts/gate-scope.mjs --write-ownership
```

The derivation reads each test file, and every `tests/` helper that file
imports, for six kinds of evidence. It reads the **code**: comments are stripped
first, so a header that describes `packages/node/src/compiler.ts` in a sentence
is prose, while the same path inside a string, a template literal or a dynamic
import is a dependency.

1. `@velarscript/<p>` and `packages/<p>/{src,dist}` paths, in both the import
   spelling and the `join("packages", "<p>", …)` spelling;
2. the `examples/` and `tests/fixtures/` projects it names, resolved through
   each project's own `velar.json`, plus `compiler`, because naming a project in
   a test is compiling it — the one place a project's packages gain `compiler`.
   Written whole or assembled from segments, as with the package paths;
3. `"velar/<module>"` specifiers, resolved through the roster each extension
   publishes — `standardModuleInterfaces()` for Core, `VELAR_WEB_MODULES` and
   its siblings for the targets. A module several packages publish, such as
   `velar/http`, is narrowed by the file's own direct imports when they name one
   of the publishers and otherwise keeps all of them — **except that a leaf
   publisher is never narrowed away**. A leaf is a package with nothing
   downstream of it, which is Desktop and Server, read off `PACKAGE_UPSTREAM`
   rather than listed. Narrowing trades a run for precision, and that trade is
   affordable against a sibling: a file that loads `@velarscript/web` is
   compiling against Web's `velar/http` and never Node's, and Node has its own
   tests. It is not affordable against a leaf. Desktop originates almost nothing
   — it re-publishes Web's and Node's modules — so every test that could notice
   a change to Desktop's copy of `velar/http` reaches it through that shared
   specifier and no other way, and a narrowing that dropped Desktop left a
   Desktop change with nothing but `tests/desktop/` to run. `velar/realtime`,
   which Server and Web both publish, is the same shape. D114 GA-I2 measured the
   loss at 57 of 109 findings; `tests/web/velar-unknown.test.ts` — a census that
   no target may publish `any` — was the clearest case, and had stopped running
   for the one target whose declarations it could not otherwise see;
4. a quoted `scripts/*.mjs`, which is `repo` — the file exercises repository
   infrastructure;
5. a quoted `docs/….md`, which is `docs` — the file reads a repository document;
6. the file name prefix (`web-`, `node-`, `server-`, `desktop-`, `cli-`,
   `core-`, `compiler-`, `create-`), read **only when the five above found
   nothing at all**. It is a tie-breaker, and applying it beside real evidence
   is how `core-message-wording.test.ts` — the Core audit's diagnostic wording,
   compiled with nothing but `@velarscript/compiler` — came to be filed under a
   package it never loads.

The evidence is unioned, because a missing owner is a test that stops running
while a surplus owner is only a test that runs more often than it must. A file
no evidence classifies is `repo` and is listed in the generated file's
`unclassified` array, so the gap is visible rather than absorbed; today that
array is empty.

D115 P5 landed, so the directory is now the declared owner and this derivation
is the check beside it. The two are unioned — a surplus owner only runs a test
more often than it must, while a missing one stops it running at all — and the
generated file's `consistency` section lists every test whose imports reach a
package its directory does not cover. The CLI and `create` are left out of that
report, because they consume every package and a test that spawns a command
would otherwise always appear in it.

### Where an owner came from

An owner in a test's union is not always something the test showed for itself,
and the generated file has two more sections that say which is which. Neither is
a finding, and neither changes what runs; both answer the question a reader of
the file actually has, which is *why does this test run for that package*.

- **`viaHelper`** — owners a `tests/` helper the file imports carries for it,
  listed by helper. D114 GA-I3: 89 of the 109 findings T3 answered held `cli`,
  and every one of them held it because running a VelarScript program at all
  means spawning the CLI through `tests/support/velar-project.ts`. `cli` sits
  below every package, so the extra owner decides nothing — but with nothing
  recording where it came from, a test that runs a program and a test whose
  subject is the CLI read exactly alike, and the day somebody deletes one
  `runVelarProject` import a batch of tests silently becomes skippable. The
  record is what makes that visible. It is not a reason to *ignore* a helper's
  owner: a helper is part of what a test exercises, which is why 34 findings of
  `compiler → web` through `tests/support/compiler-suite.ts` are answered in the
  exceptions file rather than waved through.
- **`viaRoster`** — owners the leaf-publisher rule in evidence 3 kept, listed by
  specifier. These are owners the package graph supplied rather than owners the
  file showed, so they are recorded and not reported: the file named
  `velar/http`, and it is Desktop's *publishing* it that put Desktop in the
  union. Nobody would answer such a finding by moving the file to
  `tests/desktop/`, and the consistency report is only worth reading while every
  line of it is a question somebody has to answer. `cli` and `create` are left
  out of the report for the same reason and have been since D116 §四.

## Answering the consistency report

A finding is never moved by the gate: where a file belongs is a judgment a gate
does not get to make. What the gate does insist on is that somebody made it.
`tests/ownership.exceptions.json` holds one entry per finding, and
`check:test-ownership` is red without it:

```json
"tests/core/hash.test.ts": {
  "exercises": ["node"],
  "reason": "imports packages/node/src/compiler.ts to assert the opposite — that velar/hash is a Core digest contract and is absent from the Node roster."
}
```

There are two answers to a finding, and the exceptions file is the second one.

**Move the file** when the reach is the *subject*: a test under `tests/compiler/`
that exists only to pin a Web runtime behaviour belongs under `tests/web/`. The
union makes the move safe — the owner set does not change — and it makes the
directory tell the truth.

**Write an entry** when the reach is the *means*: a compiler test that loads the
Web extension because an extension is what it needs to compile under, a Core
test that runs a Node probe project because that is how a program runs at all, a
CLI test that imports a `scripts/*.mjs` table because that table is what it
asserts. The entry names the owners it excuses and says in one line what the
means is, so the next reader can check the claim instead of inheriting it.

The check runs in both directions. A finding with no entry, or with an entry
that does not name the owner it reaches, is **unexplained** and red — that is a
reach nobody looked at. An entry whose finding is gone, or that excuses an owner
the file no longer reaches, is **stale** and red, and the failure says which line
to delete: `file-budget-allowlist.json` keeps the same two-sided rule for the
same reason — a list that can only grow stops measuring anything. An entry with
no reason is red too, because a name on a list is not a judgment.

`--write-ownership` never refuses; a wave that adds a test needs the generated
file rewritten before it can answer for it. It prints what is still owed, and
`check:test-ownership` is where the debt comes due.

## The emitted-output lock

`output-fingerprint.lock` is a sha256 per emitted file, for every discovered
example and fixture project, in both `production` and `readable` build modes,
plus one digest over all of them — 832 files today, and the lock's last line
says how many. `npm run gate` rebuilds, re-emits, and compares.

Each project is built into `<project>/.velar/fingerprint/<mode>`, which is a
fixed depth below the project rather than a temporary directory elsewhere on the
machine. That is what makes the lock a fact about the source instead of a fact
about where the source is sitting: a Web project's bundle carries source-map
`sources` relative to its output directory, so the number of `../` segments
between the two follows the checkout's own path depth, and the bundler's
content-hashed asset names — and the HTML and build manifest that reference them
— follow that in turn. Moving this checkout three directories deeper changed 6
of those files and renamed 24 more, measured on the 828-file listing of the
day; built project-relative, every one of them is byte-identical across
checkouts. A listing taken before that change is not comparable with one taken
after it.

- **A refactor slice must leave it untouched.** That is what makes "zero
  semantic change" a mechanical claim instead of a memory of which tests passed:
  every byte the compiler emitted before, it emits after. A refactor that moves
  the lock has changed behaviour and is not a refactor.
- **A wave that means to change what the toolchain emits rewrites it in the same
  change set**, so the change is explicit and in the diff:

```sh
npm run fingerprint -- --write output-fingerprint.lock
```

  The gate's failure names the projects and modes that moved, then every added,
  removed and changed file, so a rewrite is reviewed rather than accepted.
- The lock is also the quick tier's only evidence about the two heavy suites. An
  unmoved lock means the browser and packed-consumer verdicts cannot have moved
  either; a moved lock means they must be looked at before the release, which is
  where the heavy tier runs them.

## The heavy tier

The heavy tier is the `*.slow.test.ts` suffix, and nothing else. `npm run
test:full`, and therefore `release:check` and the heavy CI jobs, run every test;
`npm test` runs every test that is not slow.

`tests/heavy.json` used to carry this as a list of paths with a measured
duration beside each. D115 P5 retired both it and the rule beside it — "a file
whose name begins with `hardening-` waits for `test:full`". History is not a
property of a test: those 147 files pinned live behaviour, and 60.7% of the
suite sat out every gate because of when it was written. What a gate may defer
is a test that is *slow*, and a list of paths in a second file goes stale the
first time one is renamed, so the suffix travels with the file instead. A test
earns it at roughly five seconds, and its header says what costs that — a
process spawn, a browser launch, a deliberate timeout.

### What only the heavy tier holds

Deferring a test is not the same as not having one, but for three claims in this
repository the *only* place they are held is the heavy tier, and a reader of a
green quick-tier summary should know which three. D114's completeness audit
(GA-U1, GA-U2, GA-U6) named them; they stay where they are, because in each case
the thing that earned the suffix is the thing under test.

- **Browser process hygiene, the launcher-death half.** The quick tier's
  `tests/cli/browser-lifecycle.test.ts` covers what happens when the run ends:
  a stubborn process-group descendant is reaped, SIGTERM drains the CLI's
  browser-test owner, a force-killed supervisor makes its worker drain through
  IPC disconnect. What happens when the *launcher* dies —  the gate script
  killed mid-run, a run whose output nobody reads any more, a run with no
  channel and no reader, a worker that ignores every signal it is sent — is
  `tests/cli/browser-process-hygiene.slow.test.ts` alone, and that file is the
  only test that names `browserStopGraceMs`. Every one of its cases kills a real
  process tree and then waits out a grace period to prove nothing outlived it,
  which is seconds apiece and cannot be made cheaper: what it tests *is* a
  timeout.
- **The no-blank-page promise, the real-engine half.** `velar/app` promises the
  compiler-owned accessible fatal state on every initial-render path. The quick
  tier holds that headlessly — `tests/web/web-region-fatal-marker.test.ts`
  drives a fake DOM and asserts the element a failed dynamic region renders.
  That a *browser* shows it, on each engine, is `tests/web/runtime.slow.test.ts`
  (`[WEB-D3] a module-level root whose construction throws shows the fatal state
  on every engine`, and the healthy-root case beside it). Those two launch
  Chromium, Firefox and WebKit in turn, on a ten-minute timeout each.
- **The charter's prose has no tests, by design.** `check:docs` and
  `check:tour-coverage` compile the fenced examples in documentation, never the
  sentences around them: what each charter section asserts is pinned by the
  suites, and its wording is reviewed rather than gated, because a gate over
  prose is a gate over a paraphrase.

## Commands

```sh
npm run gate                       # the quick tier for this change set
npm run gate -- --all              # the whole quick tier, change set ignored
npm run gate -- --since <ref>      # measured against another base
npm run gate -- --explain          # print the plan and run nothing
npm run gate -- --json             # the same plan as JSON
npm run release:check              # quick tier and heavy tier

node scripts/gate-scope.mjs --explain          # the plan alone, no build
node scripts/gate-scope.mjs --json             # the plan as JSON, for CI
node scripts/gate-scope.mjs --write-ownership  # regenerate the ownership file
node scripts/gate-scope.mjs --check-ownership  # what check:test-ownership runs
node scripts/gate.mjs --plan <file> --only node,projects   # one part of a plan
```

## What CI runs

`Velar CI` starts with a `Scope` job that runs
`node scripts/gate-scope.mjs --json --since <base>` over the full history and
publishes the plan as a job output. `<base>` is `github.event.before` on a push
and the pull request's base sha on a pull request; the all-zero sha a first push
reports is read as "no base", which falls back to `HEAD~1`.

- `Source quality` always runs `npm run check`, because `check` is in every
  plan, and then compares the emitted output against the lock when the plan asks
  for it.
- `Node suite` runs on Linux and macOS when the plan names any file, and runs
  the files the plan names — not the whole suite.
- `Browser suite`, `Packed consumers` and `Full Node suite` are the heavy tier.
  They run on a `v*` tag, on the daily schedule, and on manual dispatch, never
  on an ordinary push. The full Node suite adds its macOS runner on tags only;
  the quick tier's matrix already covers macOS on every push.

## What a wave reports

A wave runs `npm run gate` in its own worktree and reports **which suites ran
and which were skipped, with the reason** — the gate prints both, so the report
is a copy of its summary rather than a recollection. The old wording, "all four
gates green", is retired: it described a run nobody could tell apart from a run
that skipped something. The orchestrating session runs `npm run gate` again on
the integration branch, where the change set is what the merge introduced, and a
release runs `npm run release:check`.
