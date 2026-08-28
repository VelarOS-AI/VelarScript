# VelarScript Toolchain Release Process

Release line: VelarScript 0.23.1 on 2026-08-28

VelarScript ships the compiler, target-neutral Core Standard API, official Node
runtime, official Server, Web and Desktop frameworks, project creator, and CLI
as one eight-package version-locked release set. Node, Server, Web, and Desktop
pin their exact toolchain dependencies; CLI pins Core, compiler, Node, Server,
Web, Desktop, and creator.
Application libraries, external-service adapters, and provider integrations are
not workspaces or release artifacts of this repository.

## Pre-release check

```sh
npm run release:check
```

This is the one required local entry point. It runs source quality, the quick
Node regression suite, packed-package consumer acceptance, and the browser gate
under one checkout lock. The browser gate is deliberately one platform by one engine:
Chromium on the current host. It still exercises both the development server
and the CSP-enabled production build, every discovered project-owned browser
test, and one generated application installed from the packed toolchain.

The source-quality gate already checks every discovered example project, so the
unit project runner does not compile those projects a second time before
running their tests. The quick Node suite keeps current baseline and closeout
coverage. Historical `hardening-*` waves — many of which deliberately wait for
process, browser, or regular-expression deadlines — remain available through
`npm run test:full` for broad language/runtime changes without taxing every
small release.

## Optional rehearsal

```sh
npm run release:rehearse
npm run release:verify -- release/rehearsal
```

A rehearsal is useful when changing package contents or release metadata; it is
not another mandatory pass before every release. It runs `npm pack` for all
eight toolchain workspaces and writes:

- the eight package tarballs;
- `SHA256SUMS`;
- `velar-toolchain-release.json` containing package name, version, filename,
  byte size, SHA-256, npm integrity, source-tree identity, and publication
  blockers.

The command never invokes `npm publish`. Repeated rehearsals of unchanged
source must produce the same tarball SHA-256 values. A working tree without a
commit can still rehearse, but its manifest is explicitly not publishable.

## Strict candidate

```sh
npm run build:packages
node scripts/release-toolchain.mjs candidate --output-dir release/toolchain
```

Candidate mode fails unless all of these are true:

- the version is stable rather than `-dev` or another prerelease;
- Git has a committed, clean `HEAD`;
- the exact `v<version>` tag resolves to `HEAD` (independent-package tags may
  resolve to the same commit);
- `origin` matches package repository metadata;
- all eight packages have an explicit publishable license;
- compiler, Core, Node, Server, Web, Desktop, creator, and CLI versions and internal
  toolchain dependencies match exactly.

The GitHub rehearsal workflow adds an OIDC artifact attestation to the packed
tarballs and uploads them as workflow artifacts. It deliberately contains no
registry token and no publication command.

## Registry publication

`Publish npm toolchain` is a separate manual workflow. `npm run release:check`
must pass before the release commit is tagged. The workflow accepts only an
exact release tag plus the literal
confirmation `publish`, checks that the tag points at the checked-out source and
that its workspace version agrees, then creates a fresh strict candidate from
that tagged source.

The publication helper accepts only that verified candidate on an OIDC-capable
GitHub Actions runner. It publishes in workspace dependency order with npm
provenance under the non-default `next` dist-tag, verifies each registry
integrity, and promotes `latest` only after all eight exact versions are
available. A partially completed run is resumable: an existing version is
accepted only when its npm integrity is byte-for-byte identical to the strict
candidate. Exact-version and dist-tag reads allow up to five minutes for npm's
public index to converge, which is required for first-time package creation.
The first registry generation uses a short-lived repository secret;
after every package exists, each package is bound to this workflow through npm
trusted publishing and the bootstrap secret is removed.

Application artifacts have a separate integrity boundary. `velar verify`
recognizes both format-4 Web and Node builds, recomputes their complete file
inventory and `buildId`, and checks the target-specific entry and source-map
relationships. `velar preview` remains Web-only and serves only a verified
static directory. This proves local self-consistency, not publisher
authenticity; the external release pipeline must sign or attest the application
manifest when authenticated application releases are introduced.

## External preview evidence

The manual `External preview verification` workflow accepts one HTTPS origin,
builds the repository's checked-in provider-neutral root Release Studio profile
with the checked-out toolchain, and runs `velar verify-deployment --json`
against the application deployment. It attests and uploads the resulting
format-version-1 verification report together with the exact local
`velar-build.json` and `velar-deploy.json`. The workflow has no host deployment
command, registry publication command, provider credential, or secret input;
creating the remote preview remains a separately authorized action.

The workflow's local output remains provider-neutral. Any provider projection
and provider configuration belongs to the deployment repository that owns the
application and does not enter VelarScript's release graph.

The report alone is an observation rather than publisher authenticity. GitHub
provenance binds its bytes to the workflow run and source revision. Current
`actions/attest@v4` use requires `contents: read`, `id-token: write`,
`attestations: write`, and `artifact-metadata: write` permissions.
