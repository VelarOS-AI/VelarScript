# VelarScript Node Agent Guide

- Node owns server syntax, `p"..."` path-pattern checking, Node application
  configuration, Node capabilities, host isolation, and server lifecycle.
- Keep server syntax and analysis in `packages/node`; Core only exposes the
  generic extension hooks it requires.
- `velar/serve` may compose arbitrary application-owned dependencies through
  providers, but Node must not define database models or depend on a concrete
  database engine.
- Never restore `velar/sqlite`, publish an official driver, or make an
  application library part of this package.
- Bound requests, bodies, queues, streams, background work, caches, and shutdown.
  State concurrency and cancellation behavior explicitly.
- Validate diagnostics, emitted server output, live request behavior, overload,
  cleanup, and graceful shutdown for runtime-facing changes.

Use [docs/ai-skill-node.md](../../docs/ai-skill-node.md) for the complete Node
contract.
