# VelarScript Continuous Integration

Status: VelarScript 0.10 internal gate; publishing remains absent

The repository defines three GitHub Actions workflows:

- `VelarScript CI` runs Node 24 check, tests, and packed-package consumer validation
  on Linux, macOS, and Windows. A separate Linux job installs Playwright's
  Chromium, Firefox, and WebKit dependencies and runs both development-server
  and CSP-enabled production browser matrices, the project-owned
  `.browser.test.vel` suite in all engines, and the same generated browser test
  through packed installed compiler/Web/creator/CLI tarballs. Browser-project execution
  first verifies the exact production asset inventory and uses the public
  preview server.
- The check gate extracts every `velar` fence from README, package guides, and
  language/API documentation. Complete examples must compile with the real Web
  extension and standard modules; explicitly marked `fragment` blocks must
  still pass the real lexer and parser. Project scaffolds are compiled again by
  packed-package consumer acceptance.
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
