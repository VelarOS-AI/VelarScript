# VelarScript Desktop Agent Guide

- Desktop composes explicit Core, Web, and permission-scoped Node contracts. It
  does not inherit hidden behavior from another target.
- Keep native container, packaging, permission, and bridge behavior in Desktop;
  do not add Desktop semantics to Core or Web.
- Renderer code receives only declared typed capabilities. Native handles and
  ambient host globals never cross the bridge.
- Preserve deterministic headless tests, cleanup, path containment, CSP, and
  artifact size/integrity checks.
- Validate both source semantics and packaged-host behavior when the native
  boundary changes.
- One file per capability module: its interface table in `src/interfaces/`, the
  JavaScript it is made of in `runtime/`, and — where the module bakes in a
  manifest grant — the lines that carry that grant in `src/modules/`.
  `src/runtime-sources.generated.ts` is written by
  `scripts/generate-runtime-sources.mjs`; edit the `.js`, never the
  transcription.
- `VELAR_DESKTOP_APP_DATA_ROOT` moves the application-support root both hosts
  work from — what `appDataDirectory()` answers, the default project directory,
  and `service-logs`. It is unset in a product, where that root is the user's
  own Application Support and nothing about it changes. It exists for tests:
  the shipped root is one path for the whole machine, so two checkouts running
  their suites at once were deleting and counting each other's service logs,
  and `scripts/run-node-tests.mjs` now gives each run a root of its own. Both
  hosts must honour it — `desktopApplicationSupportRoot()` in
  `src/development-services.ts` for `velar dev`, and
  `velarApplicationSupportRoot()` in `native/macos/VelarDesktopHost.swift` for a
  packaged application — or the two forms stop answering one path.

Use [docs/ai-skill-desktop.md](../../docs/ai-skill-desktop.md) for the complete
Desktop contract.
