# VelarScript Web Agent Guide

- Web owns component syntax, browser rendering, browser capabilities, Web
  application configuration, bundling behavior, and Web test semantics.
- Do not add Web syntax or browser types to Core. Integrate through the compiler
  extension and framework-host contracts.
- Keep browser capabilities behind typed `velar/*` Web modules. Ordinary
  reusable Web source packages remain npm packages, not hidden Standard modules.
- Preserve CSP, escaping, hydration/render ownership, cleanup, accessibility,
  cancellation, and bounded browser storage/network behavior.
- Validate compiler output and a real browser path for runtime-facing changes.

Use [docs/ai-skill-web.md](../../docs/ai-skill-web.md) for the complete Web
contract.
