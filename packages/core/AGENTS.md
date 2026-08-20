# VelarScript Core Standard API Agent Guide

- Core owns only target-neutral `velar/*` contracts, their dependency graph,
  and host-independent runtime sources.
- Do not select Node, Web, Desktop, deployment providers, native drivers, or
  product tooling from this package.
- Keep syntax and general language semantics in `packages/compiler`; add only
  the generic extension hooks required for a target to own its own syntax.
- A Core module must compile and behave without an ambient capability registry.
  Optional target composition may replace only documented internal ABI modules.
- Preserve bounded traversal, captured host intrinsics, strict data validation,
  deterministic output, and generated-code/runtime execution coverage.

Use [docs/ai-skill.md](../../docs/ai-skill.md) for the complete language
contract.
