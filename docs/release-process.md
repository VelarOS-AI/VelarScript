# VelarScript Toolchain Release Process

Status: VelarScript 0.10.0 release candidate; registry publication deferred

VelarScript builds the compiler, official Web framework, project creator, and CLI into four
independently installable npm packages, but treats them as one version-locked
release set. Web pins the exact compiler version; CLI pins compiler and creator
while loading Web only when a project explicitly declares `@velarscript/web`.

## Rehearsal

```sh
npm run release:rehearse
npm run release:verify -- release/rehearsal
```

A rehearsal runs `npm pack` for all four workspaces and writes:

- the four package tarballs;
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
- `HEAD` has exactly the `v<version>` tag;
- `origin` matches package repository metadata;
- all four packages have an explicit publishable license;
- compiler, Web, creator, and CLI versions/dependencies match exactly.

The GitHub rehearsal workflow adds an OIDC artifact attestation to the packed
tarballs and uploads them as workflow artifacts. It deliberately contains no
registry token and no publication command. Actual npm publication remains a
separate, explicit release action. npm trusted publishing/provenance must be
configured against the final public repository before that action is added.

Application artifacts have a separate integrity boundary. `velar verify`
recomputes the format-3 framework-build inventory and `buildId`, while `velar preview`
serves only a verified directory. This proves local self-consistency, not
publisher authenticity; the external release pipeline must sign or attest the
application manifest when authenticated application releases are introduced.

## External preview evidence

The manual `External preview verification` workflow accepts one HTTPS origin,
prepares the repository's checked-in root Netlify Release Studio profile with
the checked-out toolchain, and
runs `velar verify-deployment --json`. It attests and uploads the resulting
format-version-1 verification report together with the exact local
`velar-build.json` and `velar-deploy.json`. The workflow has no host deployment
command, registry publication command, provider credential, or secret input;
creating the remote preview remains a separately authorized action.

`npm run preview:prepare` creates the same verified directory locally at
`release/external-preview/site`. Its source paths remain the checked-in Release
Studio paths, so repeated preparation into different output directories has
identical asset bytes, names, manifest, and `buildId`. The profile explicitly
uses root base, the Netlify adapter, and no source maps; deployment metadata is
typed public configuration rather than a hard-coded `/app/` path.

The report alone is an observation rather than publisher authenticity. GitHub
provenance binds its bytes to the workflow run and source revision. Current
`actions/attest@v4` use requires `contents: read`, `id-token: write`,
`attestations: write`, and `artifact-metadata: write` permissions.
