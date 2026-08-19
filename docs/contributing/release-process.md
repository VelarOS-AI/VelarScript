# VelarScript Toolchain Release Process

Status: VelarScript 0.10.3 public npm registry release

VelarScript ships the compiler, official Node runtime, official Web and Desktop frameworks, project creator, CLI, and the
two domain libraries as eight
independently installable npm packages, but treats them as one version-locked
release set. Node, Web, and Desktop pin their exact toolchain dependencies; CLI pins compiler, Node, Web, Desktop, creator,
and script-analysis as one complete release generation, while a project's `@velarscript/web` declaration is what activates the Web extension at compile time.

## Rehearsal

```sh
npm run release:rehearse
npm run release:verify -- release/rehearsal
```

A rehearsal runs `npm pack` for all eight release workspaces and writes:

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
- `HEAD` has exactly the `v<version>` tag;
- `origin` matches package repository metadata;
- all eight packages have an explicit publishable license;
- compiler, Node, Web, Desktop, creator, CLI, text-buffer, and script-analysis
  versions/dependencies match exactly.

The GitHub rehearsal workflow adds an OIDC artifact attestation to the packed
tarballs and uploads them as workflow artifacts. It deliberately contains no
registry token and no publication command.

## Registry publication

`Publish npm toolchain` is a separate manual workflow. It accepts only an exact
release tag plus the literal confirmation `publish`, checks that the tag and
workspace version agree, reruns the complete compiler, package-consumer, and
browser gates, and creates a fresh strict candidate from that tagged source.

The publication helper accepts only that verified candidate on an OIDC-capable
GitHub Actions runner. It publishes in workspace dependency order with npm
provenance under the non-default `next` dist-tag, verifies each registry
integrity, and promotes `latest` only after all eight exact versions are
available. A partially completed run is resumable: an existing version is
accepted only when its npm integrity is byte-for-byte identical to the strict
candidate. The first registry generation uses a short-lived repository secret;
after every package exists, each package is bound to this workflow through npm
trusted publishing and the bootstrap secret is removed.

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
