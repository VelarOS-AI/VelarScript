# VelarScript Server Agent Guide

- Server is an explicit application framework extension layered on
  `@velarscript/node`; do not move its conventions into the Node capability.
- Server owns root `application.yml` discovery, application assembly, and
  application-scoped connection lifecycle. Other YAML/JSON names require an
  explicit path.
- Node owns HTTP transport, route syntax, filesystem, process, and the checked
  `velar/serve` primitives consumed here.
- Keep database engines, drivers, models, queries, migrations, and ORM behavior
  in independently installed application libraries. This package owns only the
  typed connect/disconnect lifecycle boundary.
- Configuration parsing must remain bounded, strict, and fail closed. The one
  conventional application configuration file is root `application.yml`.

Use [docs/ai-skill-server.md](../../docs/ai-skill-server.md) for the complete
Server contract.
