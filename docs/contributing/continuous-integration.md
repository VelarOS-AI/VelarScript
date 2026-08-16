# VelarScript Continuous Integration

Status: VelarScript 0.10 internal gate; publishing remains absent

The repository defines three GitHub Actions workflows:

- `Velar CI` runs Node 24 check, tests, and packed-package consumer validation
  on Linux, macOS, and Windows. A separate Linux job installs Playwright's
  Chromium, Firefox, and WebKit dependencies and runs both development-server
  and CSP-enabled production browser matrices, the project-owned
  `.browser.test.vel` suite in all engines, and the same generated browser test
  through the eight packed installed tarballs (compiler, Node, Web, Desktop,
  creator, CLI, text-buffer, and script-analysis). Browser-project execution
  first verifies the exact production asset inventory and uses the public
  preview server. That set is derived from `packages/*` rather than listed:
  every publishable workspace package is built, packed, checked against what
  its own manifest promises a consumer — LICENSE, README, and every path named
  by `main`, `types`, `exports`, `bin` or `velar.entry` — installed into the
  clean consumer, and imported through every specifier it publishes. A package
  added to the workspace therefore enters all four steps on the day it exists.
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
  imports all ten public Web modules from real
  `.vel` source. Its realtime acceptance path creates WebSocket and server-sent
  event resources inside a component, observes their typed callbacks in
  Chromium, Firefox, and WebKit, and releases both resources through component
  cleanup. Host-side tests do not bypass that source contract by importing the
  generated realtime JavaScript module directly.
- Packed-browser acceptance independently creates an application from the eight
  installed tarballs. Its application graph imports every browser application
  module the Web extension publishes — ten today, derived from the extension's
  own interface table rather than listed, so an eleventh fails this acceptance
  until the installed toolchain serves it — while its generated browser test
  loads `velar/web-test`, which application source may not import at all; the
  installed CLI then checks, tests,
  builds, verifies, and executes that project.
- Hosted-deployment acceptance runs the public remote verifier against root and
  subpath product servers and proves that byte tampering, wrong cache headers,
  access redirects, and asset-to-HTML fallback are rejected. A real preview
  environment can run the same command with `VELAR_DEPLOYMENT_URL`.
- `Toolchain release rehearsal` runs the complete compiler gate, creates the
  verified non-publishing toolchain artifact, adds an OIDC artifact attestation,
  and uploads it. A tag switches the packaging step to strict candidate mode.
- `External preview verification` is manual and credential-free. It rebuilds
  the root Netlify Release Studio profile, verifies a required HTTPS origin,
  emits a versioned JSON
  report, attests that report plus the build/deployment manifests, and uploads
  the evidence. It cannot deploy or publish.

The browser job additionally opens the prepared root external-preview bundle
in Chromium, checks its CSP, typed canonical/social metadata, public share
asset, root/deep navigation, reload, and missing-asset 404. This is separate
from the existing `/app/` three-engine matrix so deployment-profile bugs cannot
hide behind the normal subpath fixture.

Browser binaries are installed for the exact locked Playwright version in CI.
They are not cached independently because browser/system dependency caches can
drift from Playwright and do not provide a reliable speed advantage.

No workflow publishes to npm in VelarScript 0.10.
