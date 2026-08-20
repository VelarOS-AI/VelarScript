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

Use [docs/ai-skill-desktop.md](../../docs/ai-skill-desktop.md) for the complete
Desktop contract.
