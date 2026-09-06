# Contributing to VelarScript

VelarScript is still a pre-1.0 language and Web framework. Changes should make
the language clearer or the Web development loop more complete; compatibility
with an accidental earlier implementation is not a goal by itself.

## You do not need to write code to contribute

The most useful thing you can send this project right now is not a pull request.
It is a report that a word reads wrong.

VelarScript has made no backward-compatibility promise yet. Changing a spelling
today costs nothing; changing it after 1.0 costs everyone who wrote against it.
That window is open now and will close, and it can only be spent on objections
people actually file. A language designed to be read by someone who did not
write the code cannot find its own blind spots — the people who read it can.

- **A word reads wrong, or you guessed its meaning and guessed wrong** →
  [Spelling objection](.github/ISSUE_TEMPLATE/2-spelling.yml). You do not need to
  propose a better word. The wrong guess is the useful part.
- **The compiler did something wrong** → run `velar repro`, then
  [Defect](.github/ISSUE_TEMPLATE/1-defect.yml). The report format is three
  sections, fixed and short; `velar repro` fills in the hardest one for you, and
  it never uploads anything.
- **A page is wrong, unclear, or hard work to read** →
  [Documentation](.github/ISSUE_TEMPLATE/3-docs.yml). "I had to read this twice"
  is a valid report. So is "the Chinese reads like a translation".

This applies to models as well as people. If a model working in a VelarScript
codebase hits a compiler wall, it should run `velar repro` and file through the
same channel — the project's premise is that models write and people own, so a
model's report of an unwritable spelling is first-hand evidence, not noise.

Defects that arrive with a repro are treated as gate failures rather than
folklore: they become tests that stay in the suite.

## Ownership boundaries

- `packages/compiler` owns Core syntax, types, analysis, JavaScript emission,
  semantic metadata, and extension/framework-host protocols.
- `packages/web` owns JSX, components, reactivity, lifecycle, browser types,
  Web runtime behavior, and deployment projection.
- `packages/cli` composes installed extensions and owns generic project,
  package, build, test, preview, and LSP processes. It must not become a second
  Web framework.
- `packages/create` owns transactional project templates.
- The independent Workbench repository is a generic editor host. Language
  intelligence must arrive from the project-local VelarScript LSP.

## Language and API changes

A user-visible language change should update the language charter, diagnostics,
compiler/runtime behavior, semantic tooling, and focused tests together. If a
real application exposes an awkward rule, fix the language or framework seam
instead of adding an application-only workaround.

Keep the type layer small and operational. Do not introduce TypeScript-style
type-level programming, hidden JavaScript coercion, ambient browser globals, or
a second runtime model. JavaScript interop must cross an explicit checked
boundary.

## Local validation

VelarScript requires Node.js 24 or later and npm.

```sh
npm ci
npm run gate            # the quick tier, scoped to what this change set can move
npm run release:check   # quick tier and heavy tier both, before a release
```

`gate` works out which packages the change set can have moved, runs their
checks, the emitted-output fingerprint and the Node tests they own, and prints
what it skipped and why. The heavy tier — the browser suite, which installs and
exercises Chromium, Firefox, and WebKit, the packed-consumer acceptance, and
every `*.slow.test.ts` — runs only in `release:check`
([D116](docs/decisions/D116-SCOPED-GATES.md);
[docs/contributing/gates.md](docs/contributing/gates.md) has the whole rule). A
change that touches packaging or delivery should also run the non-publishing
release rehearsal documented in `docs/contributing/release-process.md`. Editor-facing
changes must be checked through a packed toolchain in the independent Workbench
gate; do not link compiler source into the editor.

Gates in one checkout run one at a time. Every gate rebuilds `packages/*/dist`
through a clean step, binds fixed test ports, and writes sandboxes under
`examples/*/.velar`; a second gate started in the same working tree would delete
a package `dist` while the first one is importing it and fail that run with an
`ERR_MODULE_NOT_FOUND` the code did not cause. `build:packages`, `check`,
`test`, `test:browser`, `test:packages`, `gate`, `release:check`, and `velar`
therefore run under
`scripts/gate-lock.mjs`, which is keyed by the checkout path: a later gate
prints what it is waiting for and starts when the running one finishes.
Separate checkouts, git worktrees, and CI jobs never wait on each other, and the
release and preview scripts build in a temporary workspace so they are not
serialized at all. The `gate:*` scripts are the unlocked bodies of those gates
and exist only to be wrapped; running one directly skips the lock.

Because separate checkouts run at the same time on purpose, a test may not reach
for a path that belongs to the machine rather than to the run.
`scripts/run-node-tests.mjs` therefore points `TMPDIR` at an area derived from
the checkout, so the fixed directory names test files spell under `os.tmpdir()`
are per-checkout, and sets `VELAR_DESKTOP_APP_DATA_ROOT` so the Desktop host
writes its application data and service logs under a root of this run's own —
both hosts honour that variable, and a product leaves it unset. TCP had the same
shape and no longer does: the dev-server tests used to bind sixteen fixed ports
(42879–42896) and fetch them by number, so two checkouts running the suite
together collided on them. They now ask the operating system for a free one
through `tests/support/free-port.ts`. That is a hand-off rather than a hold —
the window between releasing the probe socket and the child's own `listen` is
small but real — and it is the only shape available while `velar dev` prints the
port it was *asked* for rather than the one it bound.

Do not publish npm packages, create a stable tag, deploy a preview, or weaken a
release blocker as part of an ordinary contribution.
