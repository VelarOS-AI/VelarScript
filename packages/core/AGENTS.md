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
- One file per `velar/*` module: its interface table in `src/interfaces/`, the
  JavaScript it is made of in `runtime/`. `src/index.ts` only aggregates, and
  `src/runtime-sources.generated.ts` is written by
  `scripts/generate-runtime-sources.mjs` — edit the `.js`, never the
  transcription.

Use [docs/ai-skill.md](../../docs/ai-skill.md) for the complete language
contract.
