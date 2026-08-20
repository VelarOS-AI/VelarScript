# VelarScript Core Agent Guide

This file governs the repository unless a closer `AGENTS.md` narrows the target.

- Treat `packages/compiler` as the language authority. Core owns syntax, types,
  diagnostics, formatting, target-neutral lowering, and Runtime Type behavior.
- Keep `@` single-purpose: it attaches compile-time metadata to the following
  declaration or structural entry. Do not add unrelated runtime invocation or
  database semantics.
- Reserve `velar/*` for language semantics and target capabilities shipped by
  the matching official owner. Ordinary libraries and concrete integrations use
  npm package names and `velar.entry`.
- Keep `libraries/*` target-neutral and free of native drivers. Put concrete
  runtime drivers in `adapters/*` and deployment-provider projection in
  `integrations/*`.
- A language change requires parser/analyzer/emitter/formatter/diagnostic and
  round-trip coverage as applicable. A runtime change requires emitted-output
  and execution coverage.
- Preserve unrelated work. Run the narrowest relevant checks first, then the
  repository gates appropriate to the changed boundary.

The full Core guide is [docs/ai-skill.md](docs/ai-skill.md). Target code must
follow its nearer guide as well as this repository contract.
