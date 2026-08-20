# VelarScript Node Agent Guide

- Node owns server syntax, `p"..."` path-pattern checking, Node application
  configuration, Node capabilities, host isolation, and server lifecycle.
- Keep server syntax and analysis in `packages/node`; Core only exposes the
  generic extension hooks it requires.
- `velar/serve` may compose application-provided database contracts, but Node
  must not depend on SQLite or another concrete database engine.
- Use `@velarscript/database` for portable models and `adapters/*` for drivers.
  Never restore `velar/sqlite` or embed a concrete driver in this package.
- Bound requests, bodies, queues, streams, background work, caches, and shutdown.
  State concurrency and cancellation behavior explicitly.
- Validate diagnostics, emitted server output, live request behavior, overload,
  cleanup, and graceful shutdown for runtime-facing changes.

Use [docs/ai-skill-node.md](../../docs/ai-skill-node.md) for the complete Node
contract.
