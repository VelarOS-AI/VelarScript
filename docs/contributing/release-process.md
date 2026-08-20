# VelarScript Toolchain Release Process

Status: VelarScript 0.12.0 released on 2026-08-20

VelarScript ships the compiler, target-neutral Core Standard API, official Node
runtime, official Web and Desktop frameworks, project creator, and CLI as one
seven-package version-locked release set. Node, Web, and Desktop pin their exact
toolchain dependencies; CLI pins Core, compiler, Node, Web, Desktop, and creator. Independently versioned VelarScript
source libraries live under `libraries/` and are not toolchain release members.
Concrete runtime adapters live under `adapters/`; deployment integrations live
under `integrations/`. Both have the same independent release boundary.

## Rehearsal

```sh
npm run release:rehearse
npm run release:verify -- release/rehearsal
```

A rehearsal runs `npm pack` for all seven toolchain workspaces and writes:

- the seven package tarballs;
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
- all seven packages have an explicit publishable license;
- compiler, Core, Node, Web, Desktop, creator, and CLI versions and internal
  toolchain dependencies match exactly.

The GitHub rehearsal workflow adds an OIDC artifact attestation to the packed
tarballs and uploads them as workflow artifacts. It deliberately contains no
registry token and no publication command.

## Registry publication

`Publish npm toolchain` is a separate manual workflow. Complete compiler,
package-consumer, and browser gates must pass locally before the release commit
is tagged. The workflow accepts only an exact release tag plus the literal
confirmation `publish`, checks that the tag points at the checked-out source and
that its workspace version agrees, then creates a fresh strict candidate from
that tagged source.

The publication helper accepts only that verified candidate on an OIDC-capable
GitHub Actions runner. It publishes in workspace dependency order with npm
provenance under the non-default `next` dist-tag, verifies each registry
integrity, and promotes `latest` only after all seven exact versions are
available. A partially completed run is resumable: an existing version is
accepted only when its npm integrity is byte-for-byte identical to the strict
candidate. Exact-version and dist-tag reads allow up to five minutes for npm's
public index to converge, which is required for first-time package creation.
The first registry generation uses a short-lived repository secret;
after every package exists, each package is bound to this workflow through npm
trusted publishing and the bootstrap secret is removed.

Application artifacts have a separate integrity boundary. `velar verify`
recomputes the format-3 framework-build inventory and `buildId`, while `velar preview`
serves only a verified directory. This proves local self-consistency, not
publisher authenticity; the external release pipeline must sign or attest the
application manifest when authenticated application releases are introduced.

## External preview evidence

The manual `External preview verification` workflow accepts one HTTPS origin,
builds the repository's checked-in provider-neutral root Release Studio profile
with the checked-out toolchain, projects it through the independently versioned
Netlify integration, and
runs `velar verify-deployment --json`. It attests and uploads the resulting
format-version-1 verification report together with the exact local
`velar-build.json` and `velar-deploy.json`. The workflow has no host deployment
command, registry publication command, provider credential, or secret input;
creating the remote preview remains a separately authorized action.

`npm run preview:prepare` creates the same verified directory locally at
`release/external-preview/netlify/site`. Its source paths remain the checked-in Release
Studio paths, so repeated preparation into different output directories has
identical asset bytes, names, manifest, and `buildId`. The profile explicitly
uses root base and no source maps; the separate bundle root contains
`netlify.toml`, while deployment metadata remains provider-neutral.

The report alone is an observation rather than publisher authenticity. GitHub
provenance binds its bytes to the workflow run and source revision. Current
`actions/attest@v4` use requires `contents: read`, `id-token: write`,
`attestations: write`, and `artifact-metadata: write` permissions.

## Independently versioned ecosystem packages

Packages under `libraries/`, `adapters/`, and `integrations/` do not join the
toolchain version or its all-or-nothing publication generation. Rehearse one
package with:

```sh
npm run release:ecosystem:rehearse -- @velarscript/netlify
node scripts/release-ecosystem.mjs verify release/ecosystem/velarscript-netlify/rehearse @velarscript/netlify
```

A publishable candidate requires a clean commit tagged with the exact package
identity, for example `@velarscript/netlify@0.1.0`. The manual `Publish npm
ecosystem package` workflow accepts one derived ecosystem name and requires the
same name again as explicit confirmation. It builds and packs that package in
an isolated checkout, publishes only its verified tarball under `next` with
OIDC provenance, checks registry integrity, and then promotes that one package
to `latest`. It cannot publish a toolchain package or silently include another
ecosystem package. A retry accepts an existing version only when its integrity
is byte-identical to the candidate. The scope token is used to bootstrap a new
package or a new trusted-publisher workflow; provenance still binds the
published tarball to this workflow and source revision. Registry integrity and
`latest` verification use the same bounded five-minute convergence window as
the toolchain publisher.
