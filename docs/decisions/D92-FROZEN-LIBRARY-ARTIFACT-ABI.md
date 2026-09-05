# D92 — Frozen library artifacts preserve released Vel code

Status: accepted — 2026-08-24

Extension note — 2026-09-05: this decision introduced ABI 1 with one root
entry. ABI 1 now also admits optional exact `velar.entries` subpaths. A
root-only build keeps receipt `formatVersion: 1` and its original `index.*`
layout. A multi-entry build uses one ESM splitting graph and writes receipt
`formatVersion: 2`: `entries` contains `.` and every declared subpath,
`sources` is their de-duplicated dependency-graph union, and `chunks` records
every emitted shared JavaScript chunk and mandatory source map with their
hashes. Shared modules therefore retain one runtime state and class identity
across public entries. One receipt covers the complete package entry surface;
consumers select an exact frozen entry and never mix artifact and source
entries. The runtime ABI remains 1. The current normative contract is
[Package source entries](../package-distribution.md#package-source-entries).

## Decision

A released Core or Node library is a dual artifact. Its npm tarball contains:

- the readable `.vel` sources named by `velar.entry` and `velar.entries`;
- one frozen ESM JavaScript entry and source map for each distinct public entry;
- one portable public type interface (`.veli`) for each distinct public entry;
- every shared JavaScript chunk and source map emitted by a multi-entry build;
- one receipt identifying and hashing those inputs and outputs.

`package.json#velar.artifacts` maps exactly one ABI-1 target, `core` or `node`,
to the receipt. Every applicable exact npm export points at the matching
receipt entry.
`velar build-library` is the only writer of this set and replaces its declared
output directory transactionally.

The consumer resolves an admissible artifact before applying the source
language-generation range. It verifies the package/receipt identity and the
complete declared artifact set — every entry, interface, shared chunk, and
source map — once per package and target before decoding the selected interface
through a bounded strict schema. Verification reads each file from the same
authorized file handle and keeps immutable JavaScript/source-map snapshots for
commands that materialize that artifact. Each authenticated map is strict UTF-8
source-map v3 JSON, and each JavaScript snapshot must end in exactly one
`sourceMappingURL` naming its
receipt-declared map. A library that imports another frozen
library emits the original bare package specifier: the dependency remains an
npm dependency of the new library, under its own package owner, rather than
joining the new artifact's bundle graph. Interface bytes have one 8 MiB aggregate limit and
JavaScript entries plus chunks have one 16 MiB aggregate limit across the
receipt. Every relative static import, re-export, and literal dynamic import in
the JavaScript snapshots must resolve to another authenticated entry or chunk;
computed dynamic imports are not part of ABI 1. Absolute paths, URLs, package
aliases, package self-references, and malformed bare specifiers are rejected;
Core artifacts reject Node builtins. Source-level JavaScript data modules are
inlined by the producer, so a residual `data:` edge is rejected rather than
trusted as an unauthenticated second graph. The package's `.vel` files do not join the consumer module
graph. `run` and `test` revalidate installed bytes immediately before launch so
the module URL remains anchored to its real npm dependency owner.
`velar.requires.language` remains the gate for a source-only package or source
fallback.

Nominal identities in both source fallback and artifacts are based on package
name, package version, and source-relative path. Publisher and installer
absolute paths are never type identity and never appear in generated artifacts.

ABI-1 Core artifacts bundle the target-neutral `velar/*` implementation support
they used. In the published library artifact, external npm libraries remain
ordinary package dependencies. Before that artifact is written, each such
dependency must expose an existing ESM entry through explicit Node and browser
export conditions; a legacy or CommonJS-only package cannot support a Core
claim. Every retained bare dependency must also be declared in the publishing
package's `dependencies`, never supplied only by `devDependencies` or a
workspace hoist. A package that declares the Core target may run on every official target;
a Node artifact requires Node.

## Boundary

ABI 1 does not claim Web or Desktop component libraries. Their generated code
depends on a shared reactive/rendering runtime whose cross-release ABI has not
yet been frozen. Such packages remain source packages until that owner-specific
runtime contract exists. This is an explicit unsupported boundary, not an
artifact that happens to work with the compiler that produced it.

The receipt's source hashes establish which readable source produced a release,
but consumers do not re-hash or parse that source. npm tarball and lockfile
integrity protect the receipt itself; the receipt protects its generated files.
An installed package tree must remain unchanged for the lifetime of a running
command; changing it after checking is an explicit command-boundary violation.
Receipt and generated-output paths also reject Windows device names, forbidden
characters, and segments ending in a dot or space; NFC/case aliases and
file-versus-directory aliases cannot coexist in a portable artifact tree.

## Consequences

- A future language generation can consume an existing ABI-1 release without
  rewriting its Vel source.
- Editors and auditors still receive the original source and source map.
- Interface evolution is explicit: an incompatible wire/runtime contract needs
  a new ABI number rather than a permissive decoder.
- Publishing changed source without rebuilding, changing generated bytes after
  the receipt, or pointing npm exports somewhere else fails closed.
