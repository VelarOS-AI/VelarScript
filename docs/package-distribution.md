# Velar Toolchain Distribution

Status: pre-release package contract for Velar 0.9; publication deferred

The toolchain is distributed as two independent npm packages:

- `@velarscript/compiler`: compiler, formatter, diagnostics, semantic index,
  and Core/Web lowering APIs.
- `@velarscript/cli`: `velar` CLI, project tooling, development server, test
  runners, production builder/local and remote verifiers/preview server, and
  LSP server.

Both packages require Node.js 24 or later, publish JavaScript and `.d.ts`
artifacts from `dist`, and contain no Workbench code. The CLI depends on the
exact matching compiler version. Workbench discovers the project-local
`node_modules/.bin/velar` executable and never embeds the compiler.

`npm run test:packages` is the release boundary. It builds both packages, runs
`npm pack`, checks the tarball contents, installs both tarballs into a clean
temporary consumer, invokes the installed CLI, builds and runs a Velar file
that imports the Core Standard API, and imports the public compiler API. The
browser package gate additionally creates a project through packed tarballs,
builds and verifies its production output, and runs its browser test. A
successful source build without this consumer test is not considered
publishable.

`npm run release:rehearse` adds the release-set boundary: both tarballs,
deterministic SHA-256 values, source identity, npm integrity, and explicit
publication blockers. Candidate mode fails closed unless Git/version/remote
and license requirements are satisfied. CI may attest and upload these
tarballs, but no Velar 0.9 workflow invokes `npm publish`.

Release output replacement refuses repository roots/ancestors, symbolic links,
and non-release directories. Verification accepts exactly the sorted compiler
and CLI package identities, canonical tarball names, matching versions/sizes/
hashes/npm integrity, the declared checksum file, and no undeclared files.
Workbench independently checks the same package set and tarball SHA-256 values
before installing them; it does not import this repository's verifier.

The workspace, compiler, and CLI use Apache-2.0. Both npm tarballs contain the
complete license text, and package acceptance verifies the installed metadata
and file rather than trusting the source manifest alone. The current rehearsal
remains intentionally not publishable because the development version, source
commit/tag, matching remote, and explicit publication authority are separate
release gates.
