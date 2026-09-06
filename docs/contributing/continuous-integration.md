# VelarScript Continuous Integration

Status: current public release and publication gates

The repository defines four GitHub Actions workflows. The complete local
release gate is one command:

```sh
npm run release:check
```

The tiers those gates are divided into, and how a change set chooses its
suites, are in [Gates](gates.md); D116 is the ruling and this document is what
CI does with it.

- `Velar CI` runs the quick tier on every push and pull request, on
  clean-install Node 24. A `Scope` job computes the plan first — which packages
  this change set can move, and therefore which Node test files can change
  their verdict — and the quick-tier jobs consume it.
  - `Scope` runs `node scripts/gate-scope.mjs --json --since <base>` on Linux
    over the full history, with no install and no build.
  - `Source quality` runs `npm run check` on Linux, then compares the emitted
    output against `output-fingerprint.lock` when the plan asks for it.
  - `Node suite` runs the planned Node test files on Linux and on macOS,
    through `node scripts/gate.mjs --plan <file> --only node,projects`.
- The heavy tier is not on the path of a push. `Browser suite`
  (`npm run test:browser`), `Packed consumers` (`npm run test:packages`) and
  `Full Node suite` (`npm run test:full`) run on a `v*` tag, once a day at
  03:00 UTC, and on manual dispatch — the same tier `npm run release:check`
  runs locally. D101 ruling 6 made a green push no weaker than a local
  `release:check`; D116 keeps that claim by moving the release gate to the
  release, and by making `output-fingerprint.lock` the quick tier's standing
  evidence that no emitted byte, and therefore no browser or packed-consumer
  verdict, has moved in between.
- The full Node suite is the quick suite plus every `*.slow.test.ts`. It adds its macOS runner on
  tags only; the quick tier's Node matrix already covers macOS on every push,
  which is where the two gates that carry macOS-only coverage live:
  `tests/desktop/desktop.test.ts` and `tests/acceptance/package.acceptance.ts` both stop before
  `velar package` on any other platform, because @velarscript/desktop 0.10
  builds only the macOS system-WebView host. Linux proves the single-project
  compiler contract there; macOS is the only place the packaged `.app`, its
  size budget, and the installed toolchain's desktop path are produced at all.
  There is no Windows runner: D101 ruling 7 keeps the Windows and Linux
  desktop hosts as later milestones.
- The Node suite is not browser-free — `web-error-paths`, `browser-lifecycle`
  and `module-enum-surface` drive a real Chromium, and the slow tier drives
  several more — so the Node suite and browser jobs install the
  locked Chromium build before running. That download is cached against
  `package-lock.json`, which is what pins the Playwright version whose browser
  revision these gates expect.
- `release:check` runs source quality, Node tests, packed-package consumer
  validation, the browser gate, and the full Node suite locally: the quick tier
  and the heavy tier both. Browser acceptance is 1x1: the
  current host and Chromium. It covers the development server and CSP-enabled
  production output, discovered project-owned `.browser.test.vel` modules, and
  one generated application installed from packed toolchain tarballs.
- `npm test` discovers every Node test that is not `*.slow.test.ts`;
  `npm run gate` runs the subset of them this change set can move. `npm run
  test:full` additionally runs every `*.slow.test.ts`.
  It is the heavy tier's Node half, so it runs in `release:check`
  and in the tag, schedule and dispatch CI jobs rather than on every push.
- The packed-package gate derives the toolchain set from `packages/*`:
  every publishable workspace package is packed and checked against what
  its own manifest promises a consumer — LICENSE, README, and every path named
  by `main`, `types`, `exports`, `bin`, `velar.entry`, `velar.entries`,
  `velar.artifacts`, or `velar.resources` — installed into the clean consumer,
  and imported through every specifier it publishes. A package
  added to the workspace therefore enters all checks on the day it exists.
- The check gate extracts every `velar` fence from README, package guides, and
  language/API documentation. Fences are read by CommonMark's rules rather than
  by a regular expression: up to three columns of indentation, backticks or
  tildes, a closing fence at least as long as its opening, and the opening
  indentation removed from the content. A fence the extractor cannot reach —
  inside a block quote, or indented four or more columns by a nested list — is
  named and fails the gate rather than being skipped, so the example count is
  never larger than the set actually compiled. Every block — complete or `fragment` — is compiled as a whole module under
  full project analysis with the real Web extension and standard modules. A
  `fragment` is excused only from the surrounding context it deliberately
  omits; a type error or a Web-semantic rejection fails the gate in a fragment
  exactly as in a complete example. Project scaffolds are compiled again by
  packed-package consumer acceptance.
- The checked-in Web-capabilities fixture (`tests/fixtures/web-capabilities`)
  imports all twelve application Web modules from real `.vel` source. Its
  Worker acceptance starts a manifest-declared source entry in Chromium and
  crosses the checked request/reply boundary in development and production;
  its realtime path creates WebSocket and server-sent event resources inside a
  component and releases both through component cleanup. Host-side tests do
  not bypass those source contracts by importing generated runtime JavaScript
  directly.
- Packed-browser acceptance independently creates an application from the
  complete locally packed workspace. Its application graph imports every
  browser application module the Web extension publishes — twelve today,
  derived from the public runtime roster and the combined single-owner
  interface view rather than listed, so a thirteenth fails this acceptance
  until the installed toolchain serves it — while its
  generated browser test loads `velar/web-test`, which application source may
  not import at all; the installed CLI then checks, tests, builds, verifies,
  and executes that project in Chromium. Docs and component template structure
  and compilation remain covered by the packed-package and compiler tests; they
  are not installed and browser-run again here.
- `check` also regenerates `tests/ownership.generated.json` from the test files
  themselves and refuses any difference, the way `check:runtime-sources` treats
  the generated runtime constants. Ownership is what decides which Node files a
  plan runs, so a stale ownership file would silently narrow every gate.
- The check gate holds the file and function budgets D115 §二 sets for a
  repository whose maintainer is a model: every TypeScript file under
  `packages/*/src/**` and every test file under `tests/**` is at most 800
  lines, and every function, method, constructor, accessor, or arrow assigned
  to a declaration in them is at most 120 lines, first token to closing brace.
  `scripts/check-file-budget.mjs` parses each file with the repository's own
  `typescript` rather than counting braces, so a template string cannot hide a
  function, and an inline callback belongs to the budget of the function it
  sits in, because that is how it is read. The 800 and 120 are edges, not
  targets — D115 puts the design landing point at 500 and 60 — and
  `*.generated.ts` is exempt from the file cap only, since what a reader reads
  there is the generator. `file-budget-allowlist.json` freezes what was already
  over budget when the gate went in — 42 files and 81 functions — each entry a
  ceiling for one item. The contract is shrink-only, in the shape
  `surface-lock.json` and the coverage gate's floors already use here: a new
  violation is red, an allowlisted item that grows past its ceiling is red, and
  an item that is now within its limit or no longer exists is red until its
  entry is deleted. Every green run prints what remains, because the list's
  length is how much of D115 is left and its target is empty. `--write`
  regenerates the list from the tree and refuses to add an entry or raise a
  ceiling without `--accept-growth`, so agreeing to growth stays a deliberate
  act named in a commit.
- Every long-lived process a gate starts dies with whoever started it. A browser
  run is a supervisor, a worker, a preview server and a Chromium with four
  helpers, spread over three process groups, and it is interrupted by hand often
  — so each of them watches for its launcher three ways at once: `process.ppid`
  changing, which means it was reparented and its parent is gone; `EPIPE` or
  `ERR_STREAM_DESTROYED` on stdout or stderr, which means nothing is reading it
  any more, and listening for which is also what keeps either from becoming an
  uncaught exception; and the IPC `disconnect` event, where a channel exists.
  Any of the three runs the stop its SIGTERM handler runs, so there is one
  teardown path rather than four, and the same watch ends `velar dev` and
  `velar preview`. Gate scripts own their children as process groups rather than
  as processes: `scripts/run-project-gate.mjs` and both browser acceptances
  spawn through `superviseBrowserWorker`, which spawns detached, forwards
  SIGHUP/SIGINT/SIGTERM to the whole group, kills the group once the stop grace
  is up if it is ignored, ends the run on the shared deadline, and kills the
  group from a `process.on("exit")` net for the signals nothing handled. Every
  launch path answers to the same three numbers, exported by
  `packages/cli/src/browser-process-owner.ts`: a twenty-minute run deadline, a
  ten-second cleanup timeout for one teardown operation, and a five-second stop
  grace before a signalled group is ended outright. The stop grace is short on
  purpose and paid once per level rather than once per teardown: a browser gate
  is three supervisors deep, and an allowance that compounds down that chain is
  how a killed gate took nineteen seconds to let go of a Chromium. What the
  grace buys is the group's answer, not the hygiene — Playwright holds its
  browser on a pipe, so a launcher that is gone closes it either way.
  Playwright's browser is also the case that needs the net rather than the group
  — it runs in a process group of its own that no signal of ours reaches, so
  `launchOwnedBrowserServer` registers it and the exit handler kills its group.
  To check a machine for leftovers:
  `ps -axo pid,ppid,pgid,pcpu,etime,command | grep -Ei "velar|chrom|playwright"`.
  `tests/cli/browser-process-hygiene.slow.test.ts` asserts all of it by putting a marker
  in each launch's environment — inherited by every descendant, read back with
  `ps -E` or `/proc/<pid>/environ` — and requiring that no process carries it
  once the launcher is gone. Its window is derived from those numbers rather
  than written down, because the version that was written down was fifteen
  seconds and a hosted four-core runner needed nineteen.
- Hosted-deployment acceptance runs the public remote verifier against root and
  subpath product servers and proves that byte tampering, wrong cache headers,
  access redirects, and asset-to-HTML fallback are rejected. A real preview
  environment can run the same command with `VELAR_DEPLOYMENT_URL`.
- `Toolchain release rehearsal` runs the source-quality gate, creates the
  verified non-publishing toolchain artifact, adds an OIDC artifact attestation,
  and uploads it. It is an explicit packaging diagnostic, not a mandatory
  duplicate of `release:check`.
- `Publish npm toolchain` is manual, requires an exact tag and literal
  publication confirmation, creates a strict candidate, publishes all eight
  toolchain packages with npm provenance under `next`,
  verifies their registry integrity, and exposes `latest` only after the
  complete version-locked graph exists.
- `External preview verification` is manual and credential-free. It rebuilds
  the provider-neutral root Release Studio profile, verifies a required HTTPS
  origin, and emits a versioned JSON
  report, attests that report plus the build/deployment manifests, and uploads
  the evidence. It cannot deploy or publish.

The browser gate uses the exact locked Playwright Chromium build. Development
and production remain separate runtime paths even though they share one engine;
this preserves CSP and static-output coverage without multiplying every test by
Firefox and WebKit.

The rehearsal and external-preview workflows remain non-publishing. Only the
manual toolchain publication workflow has registry authority, and its helper
refuses to run outside an OIDC-capable GitHub Actions runner.
