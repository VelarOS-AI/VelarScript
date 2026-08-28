# VelarScript Continuous Integration

Status: current public release and publication gates

The repository defines four GitHub Actions workflows. The complete local
release gate is one command:

```sh
npm run release:check
```

- `Velar CI` runs the complete gate on every push and pull request, on
  clean-install Node 24, split into six jobs. D101 ruling 6 makes this the
  0.20 stability criterion: a green push is no weaker than a local
  `release:check`.
  - `Source quality` runs `npm run check` on Linux.
  - `Node suite` runs `npm run test:full` on Linux and on macOS.
  - `Packed consumers` runs `npm run test:packages` on Linux and on macOS.
  - `Browser suite` runs `npm run test:browser` on Linux.
- CI runs `test:full` where `release:check` runs `test`, because the full Node
  suite is the quick suite plus every historical `hardening-*` wave. The two
  gates that repeat on macOS are the two that carry macOS-only coverage:
  `tests/desktop.test.ts` and `tests/package.acceptance.ts` both stop before
  `velar package` on any other platform, because @velarscript/desktop 0.10
  builds only the macOS system-WebView host. Linux proves the single-project
  compiler contract there; macOS is the only place the packaged `.app`, its
  size budget, and the installed toolchain's desktop path are produced at all.
  There is no Windows runner: D101 ruling 7 keeps the Windows and Linux
  desktop hosts as later milestones.
- The Node suite is not browser-free — `web-error-paths`, `browser-lifecycle`
  and `module-enum-surface` drive a real Chromium, and the historical hardening
  waves drive several more — so the Node suite and browser jobs install the
  locked Chromium build before running. That download is cached against
  `package-lock.json`, which is what pins the Playwright version whose browser
  revision these gates expect.
- `release:check` runs source quality, Node tests, packed-package consumer
  validation, and the browser gate locally. Browser acceptance is 1x1: the
  current host and Chromium. It covers the development server and CSP-enabled
  production output, discovered project-owned `.browser.test.vel` modules, and
  one generated application installed from packed toolchain tarballs.
- `npm test` discovers the current baseline and closeout Node regression files.
  `npm run test:full` additionally runs every historical `hardening-*` wave.
  Locally it is the suite for broad compiler/runtime changes rather than a
  duplicate release step; CI runs it on every push, which is what makes a
  green push stronger than a local `release:check` rather than weaker.
- The packed-package gate derives the toolchain set from `packages/*`:
  every publishable workspace package is packed and checked against what
  its own manifest promises a consumer — LICENSE, README, and every path named
  by `main`, `types`, `exports`, `bin` or `velar.entry` — installed into the
  clean consumer, and imported through every specifier it publishes. A package
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
- Hosted-deployment acceptance runs the public remote verifier against root and
  subpath product servers and proves that byte tampering, wrong cache headers,
  access redirects, and asset-to-HTML fallback are rejected. A real preview
  environment can run the same command with `VELAR_DEPLOYMENT_URL`.
- `Toolchain release rehearsal` runs the source-quality gate, creates the
  verified non-publishing toolchain artifact, adds an OIDC artifact attestation,
  and uploads it. It is an explicit packaging diagnostic, not a mandatory
  duplicate of `release:check`.
- `Publish npm toolchain` is manual, requires an exact tag and literal
  publication confirmation, creates a strict candidate, publishes all seven
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
