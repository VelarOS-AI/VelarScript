# VelarScript Toolchain Distribution

Status: pre-release package contract for VelarScript 0.10; publication deferred

The toolchain is distributed as four independent npm packages:

- `@velarscript/compiler`: compiler, formatter, diagnostics, semantic index,
  Core lowering APIs, compiler-extension ABI, and neutral framework-host ABI.
- `@velarscript/web`: the official Web framework's versioned module contract
  and browser runtime, plus independent compiler and framework-host entries.
- `create-velar`: the lightweight, transactional `npm create velar` entry and
  the single authority for `web`, `docs`, `library`, and reusable Web
  `component` templates.
- `@velarscript/cli`: `velar` CLI, project tooling, development server, test
  runners, npm-backed dependency workflow, production builder/local and remote
  verifiers/preview server, and LSP server.

All four packages require Node.js 24 or later, publish JavaScript and `.d.ts`
artifacts from `dist`, and contain no Workbench code. Web pins the exact
matching compiler version. CLI pins compiler and creator but has no Web
dependency: it resolves every compiler/project extension declared by the
application's format-v2 manifest from that project, then discovers and
validates an optional protocol-v1 `/host` entry from the same package.
Workbench discovers the project-local
`node_modules/.bin/velar` executable and never embeds the compiler.

## Package model

VelarScript does not operate a second registry or invent another dependency graph.
npm remains authoritative for registry resolution, `package.json`,
`package-lock.json`, installation, integrity, audit, and update ranges. The CLI
adds a project-aware layer:

```sh
velar install
velar add <package[@version]>... [--dev]
velar remove <package>...
velar update [package...]
```

Registry package specifications are passed to npm as argument-array data after
`--`; paths, Git URLs, aliases, and injected npm flags are intentionally left
to direct npm usage. `update` follows the ranges already declared in
`package.json` rather than silently moving every dependency to a new major.

A reusable VelarScript source package declares `velar.entry`. A compiler/framework
extension declares `velar.extension`:

```json
{
  "velar": {
    "extension": { "manifestKey": "web" }
  }
}
```

After npm installs such a package, `velar add` atomically adds its package name
to `velar.json.extensions`. `velar remove` removes the extension and its owned
manifest field. The compiler and optional framework-host exports remain the
runtime authority; metadata only controls project activation and never bypasses
protocol validation.

The `library` creator template publishes a Core-only source entry. The
`component` template uses the same `velar.entry` mechanism for a Web component,
declares `@velarscript/web` as its peer contract, and keeps its demo application
and tests out of the published `files` inventory. Component packages therefore
remain ordinary source libraries rather than hidden framework extensions.
The complete layering, accessibility, and versioning rules are documented in
[`component-packages.md`](component-packages.md).

`npm run test:packages` is the release boundary. It builds all four packages,
runs `npm pack`, checks the tarball contents, installs the complete set into a clean
temporary consumer, invokes the installed CLI, builds and runs a VelarScript file
that imports the Core Standard API, and imports the public compiler API. The
browser package gate additionally creates a project through packed tarballs,
builds and verifies its production output, and runs its browser test. A
successful source build without this consumer test is not considered
publishable.

The packed browser gate does not stop at a minimal framework import. Its
generated application imports all nine runtime-facing Web modules from the
installed `@velarscript/web` tarball, and the generated browser test imports
`velar/web-test`. The installed CLI must check, test, build, integrity-verify,
and run the resulting project before the release set is accepted.

`npm run release:rehearse` adds the release-set boundary: all four tarballs,
deterministic SHA-256 values, source identity, npm integrity, and explicit
publication blockers. Candidate mode fails closed unless Git/version/remote
and license requirements are satisfied. CI may attest and upload these
tarballs, but no VelarScript 0.10 workflow invokes `npm publish`.

The rehearsal builds and packs a private temporary toolchain snapshot. It never
cleans or rewrites the active workspace's `dist` directories, so release checks
cannot race with compiler, editor, or application tests.

Release output replacement refuses repository roots/ancestors, symbolic links,
and non-release directories. Verification accepts exactly the sorted compiler,
Web, creator, and CLI package identities, canonical tarball names, matching versions/sizes/
hashes/npm integrity, the declared checksum file, and no undeclared files.
Workbench independently checks the same package set and tarball SHA-256 values
before installing them; it does not import this repository's verifier.

The workspace, compiler, Web framework, creator, and CLI use Apache-2.0. Every npm tarball contains the
complete license text, and package acceptance verifies the installed metadata
and file rather than trusting the source manifest alone. The current rehearsal
remains intentionally not publishable because the development version, source
commit/tag, matching remote, and explicit publication authority are separate
release gates.
