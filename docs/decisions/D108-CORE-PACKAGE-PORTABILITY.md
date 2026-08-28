# D108 — Core package declarations are portable

Status: accepted — 2026-08-28

## Decision

`velar.targets` describes the environments a package implementation needs.
The `core` target is target-neutral, so declaring `targets: ["core"]` admits
the package in Core, Node, Web, and Desktop projects. A portable package does
not repeat every official host target.

Node, Web, and Desktop declarations remain exact. A package that has separate
support for more than one host lists those targets explicitly. The independent
`velar.requires.capabilities` list still has to be satisfied; a target name
does not manufacture host authority.

Existing manifests that redundantly list `core` together with host targets
remain valid and have the same result. New Core library templates publish the
single canonical declaration.

## Consequences

- Core Libraries state one portable contract instead of four copies of it.
- Adding a future official host does not require republishing every Core
  package merely to extend a target list.
- A Node-only or Web-only package still fails before its source is compiled in
  an incompatible project.
- Frozen Core artifacts follow the same portability rule as source fallback.
