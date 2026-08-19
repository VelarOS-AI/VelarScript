# VelarScript Toolchain Distribution

Status: stable package contract for the published VelarScript 0.10 toolchain

The repository distributes six toolchain packages and two installable
VelarScript domain-library packages through npm:

- `@velarscript/compiler`: compiler, formatter, diagnostics, semantic index,
  Core lowering APIs, compiler-extension ABI, neutral framework-host ABI, and
  target-neutral application-package-host ABI.
- `@velarscript/node`: Node module contracts and zero-runtime-dependency
  implementations for local filesystem, paths, shell-free processes,
  environment, lifecycle, bounded terminal I/O, HTTP serving, and HTTP clients. It can be composed
  independently of the CLI.
- `@velarscript/web`: the official Web framework's versioned module contract
  and browser runtime, plus independent compiler and framework-host entries.
- `@velarscript/desktop`: the optional single-project Desktop framework. It
  composes Web source semantics, permission-scoped Node capabilities, a thin
  system-WebView host, deterministic headless tests, and auditable small-bundle
  packaging without exposing renderer/main or IPC concepts to source code.
- `create-velar`: the lightweight, transactional `npm create velar` entry and
  the single authority for the `web`, `node`, `desktop`, `docs`, `library`, and
  reusable Web `component` templates.
- `@velarscript/cli`: `velar` CLI, project tooling, development server, test
  runners, npm-backed dependency workflow, production builder/local and remote
  verifiers/preview server, and LSP server.
- `@velarscript/text-buffer`: a pure VelarScript incremental text buffer,
  published as a source package with `velar.entry`.
- `@velarscript/script-analysis`: pure VelarScript JavaScript/TypeScript lexical
  and local structural analysis. It depends exactly on
  `@velarscript/text-buffer` and is bundled internally by the CLI language
  server without acquiring a `velar/*` Standard identity.

All eight packages require Node.js 24 or later and contain no Workbench code.
Compiler, Node, Web, Desktop, creator, and CLI publish JavaScript and `.d.ts`
artifacts from `dist`; text-buffer and script-analysis publish their checked
`.vel` source entries. Web pins the exact
matching compiler version. Node pins compiler. Desktop pins compiler, Node,
and Web, but never imports or executes the CLI. Script-analysis pins
text-buffer. CLI pins compiler, Node, Web, Desktop, creator, and script-analysis
as one complete official release generation. It resolves
every compiler/project extension declared by the application's format-v2
manifest from the project first, then discovers and validates optional
protocol-v1 `/host` and `/package-host` entries from the same owner.
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
  "velar": { "extension": {
    "kind": "application",
    "apiVersion": "0.10",
    "manifestKey": "web",
    "extends": {}
  } }
}
```

After npm installs such a package, `velar add` atomically adds its package name
to `velar.json.extensions`. `velar remove` removes the extension and its owned
manifest field. The compiler and optional framework-host exports remain the
runtime authority; metadata only controls project activation and never bypasses
protocol validation.

An extension may give one of its JavaScript module sources an explicit
implementation-only dependency list. This list is not a package dependency and
does not create a public VelarScript module contract: npm still installs the
extension package, while the CLI uses the list only to materialize the complete
standard/runtime-module closure in unbundled output. Dependencies are resolved
from the same extension owner as the selected source, are replaced together
with a higher-priority source override, and fail closed when a named module is
unknown. Source-level imports still require a `ModuleInterface`; hidden runtime
dependencies deliberately do not.

`extends` describes semantic extension inheritance, not package installation.
Every declared parent must also be an exact peer dependency. The CLI resolves
the installed graph parent-first, requires matching major/minor API contracts,
rejects cycles, duplicate module ownership, and multiple application
frameworks, and records direct versus inherited nodes in the project config.
npm and `package-lock.json` remain the only version/integrity graph; VelarScript
adds no second lockfile.
Extension package versions follow SemVer 2.0, including build metadata; API
versions use canonical non-zero-padded `major.minor` components. npm remains
the authority for evaluating dependency and peer ranges.
Extension lookup follows Node's nearest `node_modules` search order but never
falls through an existing malformed, symbolic, or unreadable package manifest
to an ancestor package with the same name. Only a genuinely missing candidate
continues the search.
The CLI-installed official Web and Desktop application extensions form a narrow
toolchain fallback for projects that intentionally contain no `node_modules`;
the CLI's existing Node capability remains available without manifest activation.
A project-local official target always wins, and an invalid local manifest
fails closed instead of falling back. Third-party extensions never use the
toolchain fallback and remain project-installed npm dependencies. Thus npm
still owns every installed version and integrity graph while a zero-npm
consumer may use the exact official targets shipped with its `velar` command.
Project discovery follows the same nearest-owner rule. An existing local
`velar.json` must be an ordinary file; directories, symbolic links, and read
errors cannot silently select an ancestor project, and package commands use the
same identity as checking, building, testing, and the language server.

`velar package` resolves the selected application's optional `/package-host`.
The CLI compiles and writes the already-checked framework renderer exactly
once inside the project; the target package owns only its native container,
size accounting, and platform artifacts. Desktop therefore cannot invoke the
CLI recursively, and the CLI contains no Desktop-specific packaging branch.

Removing a direct extension recomputes reachability from the remaining direct
extensions over that semantic graph. Project fields owned by the removed node
and by inherited parents that are no longer reachable are removed atomically
from `velar.json`; a parent still shared by another direct child and its
configuration remain intact. This keeps package removal aligned with the same
parent-first graph used by checking, building, testing, and the language
server, instead of leaving an orphan field that makes the project unreadable
after npm has already changed its dependency tree.

Removal uses a staged project declaration. The CLI first verifies the current
project, writes and resolves the candidate `velar.json` while every installed
extension is still available, and only then asks npm to uninstall packages. An
npm failure restores the exact original declaration. After npm succeeds, a
remaining installed-graph failure is reported without rolling the manifest
back to names that npm has already removed. Addition keeps the complementary
rule: npm installs first, and an invalid new extension remains an ordinary npm
dependency but is not activated in `velar.json`.
Every staged write and restoration is guarded by the exact source text the
command previously read. If an editor or another process changes `velar.json`
while npm is running, that newer declaration is preserved and the dependency
command reports the conflict instead of overwriting user work.
The CLI also measures the final formatted declaration in UTF-8 before staging;
formatting cannot turn a valid compact manifest into an oversized broken file.

Package commands and project compilation share the same extension metadata
reader. Optional empty `extends` metadata therefore has one meaning everywhere,
and a successful npm subprocess cannot be reported as a successful `velar add`
unless the requested package is actually resolvable from the project.
Extension-owned manifest keys cannot claim Core fields such as `entry` or
`extensions`, nor host-object keys such as `constructor`; project-format
ownership is checked before any extension code or configuration parser runs.

The `library` creator template publishes a Core-only source entry. The
`component` template uses the same `velar.entry` mechanism for a Web component,
declares `@velarscript/web` as its peer contract, and keeps its demo application
and tests out of the published `files` inventory. Component packages therefore
remain ordinary source libraries rather than hidden framework extensions.
The complete layering, accessibility, and versioning rules are documented in
[`component-packages.md`](component-packages.md).

`npm run test:packages` is the release boundary. It builds the compiled packages,
runs `npm pack`, checks the tarball contents, installs the complete set into a clean
temporary consumer, invokes the installed CLI, builds and runs a VelarScript file
that imports the Core Standard API and imports the public compiler API. The
browser package gate additionally creates a project through packed tarballs,
builds and verifies its production output, and runs its browser test. A
successful source build without this consumer test is not considered
publishable.

The packed browser gate does not stop at a minimal framework import. Its
generated application imports all nine runtime-facing Web modules from the
installed `@velarscript/web` tarball, and the generated browser test imports
`velar/web-test`. The installed CLI must check, test, build, integrity-verify,
and run the resulting project before the release set is accepted.

`npm run release:rehearse` adds the release-set boundary: all eight tarballs,
deterministic SHA-256 values, source identity, npm integrity, and explicit
publication blockers. Candidate mode fails closed unless Git/version/remote
and license requirements are satisfied. CI may attest and upload these
tarballs. Registry publication is a separately authorized, provenance-bearing
GitHub Actions job that consumes the verified strict candidate.

The rehearsal builds and packs a private temporary toolchain snapshot. It never
cleans or rewrites the active workspace's `dist` directories, so release checks
cannot race with compiler, editor, or application tests.

Release output replacement refuses repository roots/ancestors, symbolic links,
and non-release directories. Verification accepts exactly the sorted compiler,
Node, Web, Desktop, creator, CLI, text-buffer, and script-analysis package
identities, canonical tarball names, matching versions/sizes/hashes/npm
integrity, the declared checksum file, and no undeclared files. Downstream
consumers independently check the required package subset and tarball SHA-256
values before installing it; they do not import this repository's verifier.

Agent orchestration, canonical `namespace:tool` identity, provider transports,
approval, and execution policy belong to VelarOS ecosystem packages rather
than the language toolchain. Such packages may be authored in VelarScript and
consume this package system, but they are not part of the VelarScript release
set or Standard API.

The workspace, compiler, Node runtime, Web, Desktop, creator, and CLI use Apache-2.0. Every npm tarball contains the
complete license text, and package acceptance verifies the installed metadata
and file rather than trusting the source manifest alone. The current rehearsal
is always marked non-publishable because rehearsal mode is evidence only. A
strict candidate becomes publishable only from the clean, exactly tagged
`v0.10.2` source with the matching remote; registry publication remains a
separate explicit authority and must carry npm provenance.
