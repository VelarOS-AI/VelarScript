# VelarScript Toolchain Distribution

Status: stable package contract for the published VelarScript toolchain

The repository contains one npm workspace layer: the version-locked language
toolchain and official target frameworks under `packages/`:

- `@velarscript/compiler`: compiler, formatter, diagnostics, semantic index,
  Core lowering APIs, compiler-extension ABI, neutral framework-host ABI, and
  target-neutral application-package-host ABI.
- `@velarscript/node`: Node module contracts and zero-runtime-dependency
  implementations for local filesystem, paths, shell-free processes,
  environment, lifecycle, bounded terminal I/O, HTTP serving, and HTTP clients. It can be composed
  independently of the CLI.
- `@velarscript/server`: the explicit convention-based Server application
  extension. It composes Node, owns root YAML/JSON application configuration,
  startup assembly, provider-neutral request authentication, and abstract
  connection lifecycle, but no concrete token/session implementation, identity
  store, authorization model, database driver, or model layer.
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
All current packages require Node.js 24 or later and contain no Workbench code.
Compiler, Node, Server, Web, Desktop, creator, and CLI publish JavaScript and `.d.ts`
artifacts from `dist`. Web pins the exact
matching compiler version. Node pins compiler. Server pins compiler and Node.
Desktop pins compiler, Node,
and Web, but never imports or executes the CLI. CLI pins Core, compiler, Node,
Server, Web, Desktop, and creator as one complete official release generation,
and installs the four of them it needs in order to load. Server, Web, Desktop
and `playwright` are exact optional peers instead, so a project installs the
targets it declares rather than all of them (D111). It resolves
every compiler/project extension declared by the application's format-v2
manifest from the project first, then discovers and validates optional
protocol-v1 `/host` and `/package-host` entries from the same owner.
Workbench discovers the project-local
`node_modules/.bin/velar` executable and never embeds the compiler.

## Package model

VelarScript does not operate a second registry or invent another dependency graph.
The npm package manager remains authoritative for `package.json`,
`package-lock.json`, installation, integrity, audit, and update ranges. The
public npm registry is the release source for the official language toolchain,
Standard owners, target frameworks, ordinary third-party packages, and the
separately named `@velarscript-labs/*` experimental ecosystem. The scope makes
ownership visible without creating another registry or lockfile. The CLI adds a
project-aware layer for registry packages:

```sh
velar install
velar add <package[@version]>... [--dev]
velar remove <package>...
velar update [package...]
```

Registry package specifications are passed to npm as argument-array data after
`--`; paths, Git URLs, remote tarballs, aliases, and injected npm flags are
intentionally left to direct npm usage. Libraries packages use ordinary exact
registry versions such as `velar add @velarscript-labs/sqlite@0.2.0`. `update`
follows the ranges already declared in `package.json` rather than silently
moving every dependency to a new major.

A reusable VelarScript package keeps its readable source and may publish a
frozen runtime artifact beside it. It declares the mandatory root
`velar.entry`, optional exact `velar.entries`, its supported `velar.targets`,
and a bounded `velar.requires.capabilities` list. A compiler/framework
extension declares `velar.extension`:

```json
{
  "type": "module",
  "files": ["src", "dist"],
  "exports": {
    ".": "./dist/index.js",
    "./worker": "./dist/worker.js"
  },
  "velar": {
    "entry": "src/index.vel",
    "entries": { "./worker": "src/worker.vel" },
    "artifacts": { "core": "dist/velar-library.json" },
    "targets": ["core"],
    "requires": { "capabilities": [] }
  }
}
```

`velar build-library` checks every declared entry, then emits all distinct
entries in one ESM splitting build. A root-only package retains receipt
`formatVersion: 1` and the existing `index.*` layout. A package with subpath
entries writes `formatVersion: 2`: `entries` covers `.` and every exact
subpath, `sources` is the de-duplicated union of their checked source graphs,
and `chunks` lists every generated shared JavaScript chunk and mandatory source
map with their SHA-256 hashes. The shared graph prevents duplicated module
state and runtime class identity while leaving runtime ABI 1 unchanged.

The publication gate verifies every entry, interface, source, shared chunk,
and source map present in the tarball. A consumer verifies the complete
declared artifact set once per package and target before trusting any selected
interface. Interface files share an 8 MiB aggregate limit and JavaScript
entries plus chunks share a 16 MiB aggregate limit per receipt.
JavaScript and source maps are then consumed from those immutable
verified snapshots rather than reopened by a bundler. npm's tarball and
lockfile integrity protect the receipt itself. Format 1 keeps its original
authenticated UTF-8 map contract and permits JavaScript without a
`sourceMappingURL`. Format 2 additionally requires a strict UTF-8 source-map v3
JSON map and exactly one trailing `sourceMappingURL` naming that
receipt-declared map.

The authenticated entries and chunks form a closed local ESM graph. Relative
static imports, re-exports, and literal dynamic imports must resolve inside
that set, and computed dynamic imports are rejected. Absolute and URL imports,
package aliases and self-references, malformed bare specifiers, and Node
builtins in a Core artifact are rejected. `build-library` inlines source-level
JavaScript data modules; a residual `data:` edge therefore fails closed instead
of introducing a second unauthenticated graph. Artifact, source, and
generated-output paths must also survive Windows: device names, forbidden
characters, trailing dots or spaces, NFC/case aliases, and file/directory
hierarchy aliases fail before publication or materialization.

Artifact resolution is deliberately first. When a compatible artifact exists,
the compiler loads the selected entry's interface for type checking and leaves
that package import as an ordinary bare ESM import of `package.json#exports`.
It does not open, parse, or compile the installed `.vel`, so a later language
generation can run that release without rewriting its source. `velar.requires.language` governs
only source fallback. If no compatible artifact exists, the resolver follows
the source-package rules below exactly as before.

ABI 1 accepts one artifact target per package: `core` or `node`. A `core`
artifact is target-neutral and may be consumed by Core, Node, Web, or Desktop;
a `node` artifact is admitted only to Node.
The published frozen library bundles the matching `velar/*` implementation
support, while ordinary npm libraries remain bare imports declared through the
library package's normal npm dependencies. Web/Desktop component artifacts
require a shared reactive/rendering runtime ABI and are not claimed by ABI 1;
those packages continue to use source mode.

Artifact production verifies every retained bare import against the package's
`dependencies` and artifact target. Format 2 loading repeats both checks against
the installed graph. Format 1 loading retains its original dependency-ownership
check without retroactively applying the newer target proof. Source checks
apply the same ownership rule inside package-owned JavaScript helpers reached
through `#imports` or self exports.

Because those npm imports remain runtime-owned, `check` proves their exact
entry before a Core artifact can claim portability. The dependency must have an
explicit `exports` branch that selects an existing ESM file under both Node and
browser conditions. A legacy `main`, a CommonJS-only target, a blocked or
missing subpath, and an unreadable manifest fail as `VEL6006`. Node artifacts
use the Node ESM condition set and may retain Node-compatible legacy packages;
Web and Desktop checks use the browser condition set. Package `imports` aliases
use these same condition authorities, including `node-addons`, `module-sync`,
and `module`, so check and bundling cannot select different branches.

That ownership rule also applies to a frozen VelarScript dependency. If library
`C` imports frozen library `B`, `build-library` authenticates `B`'s complete
receipt and emits the original `B` package specifier. `B` and its relative
entry/chunk closure are not flattened into `C`; an npm dependency imported by
`B` therefore continues to resolve from `B`'s installed package boundary.

`run` and `test` keep a frozen entry anchored to its installed package, so a
dependency installed below that package resolves from its actual owner rather
than from an arbitrary consumer-level copy. They revalidate the package's
complete entry and shared-chunk set immediately before launch; the installed
dependency tree must remain unchanged while the command runs. Portable
framework-free and Node
application builds currently require frozen packages without external npm
imports; they fail explicitly instead of flattening a package-local dependency
tree or silently changing native, optional, dynamic-import, or asset behavior.

Browser development has one import-map target per bare specifier. If actual
importer anchors resolve the same specifier to different canonical package
instances, development fails closed instead of selecting one version
arbitrarily; the dependency graph must be aligned for that mode.

### Package source entries

Importing `toolkit` selects the mandatory `velar.entry`; importing
`toolkit/worker` selects `velar.entries["./worker"]`. Scoped names follow the
same split, so `@scope/toolkit/worker` still selects `./worker`. There is no
directory, `index.vel`, wildcard, or nearest-prefix fallback: an undeclared
subpath is an error.

`velar.entries` maps at most 255 exact public subpaths to source files, for 256
entries including the root. A key matches
`./[A-Za-z0-9][A-Za-z0-9._/-]*`, has no wildcard, empty, `.` or `..` segment,
and does not end in `.vel`. A value is a normalized package-relative `.vel`
path: forward slashes only, no absolute path, control character, or empty,
`.` or `..` segment. All entries share one package identity and the same
language, target, and capability declarations; their relative imports remain
inside that package root. Several public subpaths may intentionally name the
same source file. `velar.entries` and `velar.resources` must not claim the same
public subpath because one import specifier cannot be both code and JSON.

For a frozen artifact, each declared entry must have a matching exact npm
export. A Core build resolves both Node ESM and browser ESM conditions, and a
Node build resolves Node ESM conditions; every applicable branch must select
one generated `.js` or `.mjs` file for that entry. A root-only format-1 receipt
retains the legacy `index.js` output and therefore requires a surviving
`package.json` scope with `"type": "module"`; `.mjs` outputs are available to
multi-entry format-2 receipts. `types` and `require` are
separate package promises and may point elsewhere. `build-library` does not
generate TypeScript declarations, so any declared `.d.ts` must live outside
the transactionally replaced output directory and be published separately.
Different source entries cannot claim the same generated artifact paths; two
subpaths that alias one source may share one artifact only when they export the
same JavaScript file. A compatible receipt covers all entries: resolution does
not mix artifact-backed and source-backed entries from one package. The
`__velar_chunks/` directory below the receipt is reserved for format-2 shared
outputs and cannot be named by an entry export.

Targets are `core`, `node`, `web`, or `desktop`. Declaring `core` means the
package is target-neutral and therefore supports Core, Node, Web, and Desktop;
portable packages write `targets: ["core"]` rather than repeating every host.
Target-specific declarations are exact, so a package shared by two host targets
lists both. An application-owned source package may narrow that list and require
a host capability. Missing, empty,
duplicated, unknown, or incompatible declarations fail package resolution
instead of leaking a native dependency into another target.

`velar.requires.language` is optional and sits beside `capabilities`. It names
the language generation the package's source was written against, as one or two
whitespace-separated clauses over `<major>.<minor>`:

```json
{
  "velar": {
    "entry": "src/index.vel",
    "targets": ["core"],
    "requires": { "capabilities": [], "language": ">=0.11 <0.14" }
  }
}
```

A clause is `>=`, `>`, `<=`, or `<` followed by a generation, at most one lower
bound and one upper bound. A bare generation such as `"0.12"` is that generation
exactly and never combines with a second clause. A patch component
(`"0.13.0"`), a caret range, a wildcard, an empty declaration, a repeated bound,
and a range whose upper bound is below its lower bound — or equal to it without
both bounds being inclusive — are rejected by name. A well-formed range no
generation can satisfy, such as `">0.12 <0.13"`, is not: it is checked like any
other range and reported as an ordinary generation mismatch quoting the range
back. The generation this toolchain implements is its own version without the
patch component, because a patch release never moves the language.

In source fallback, the declaration is checked when the package is resolved: before any of the
package's `.vel` reaches the compiler, and ahead of the `targets` and
`capabilities` checks, which a manifest written for another generation is in no
position to be trusted about. A package the current generation does not satisfy
fails resolution with one message rather than a list of ordinary syntax errors
that read as if the package were simply broken:

```text
package 'example-package' requires VelarScript language >=0.9 <0.11; this
toolchain implements 0.12; install a release of 'example-package' published for
0.12, or run the toolchain the package asks for — its sources are not wrong,
they belong to another generation of the language
```

A source-fallback package that declares no language keeps today's behaviour exactly: its source
compiles, and a generation it cannot survive is still reported as its own
diagnostics. `velar.requires` itself remains mandatory: the language range is
an optional field inside that section, not a relaxation of it.

An extension package instead declares:

```json
{
  "velar": { "extension": {
    "kind": "application",
    "apiVersion": "0.12",
    "manifestKey": "web",
    "extends": {}
  } }
}
```

`apiVersion` is that extension's **surface version**: a counter of how many
times the vocabulary it publishes has changed, independent of the npm version
its package steps with. For the official targets it is the number
`velar --version` prints beside the surface's name, and the one a project
records in `velar.json`'s `surfaces`. The field keeps the spelling `apiVersion`
because it belongs to `protocolVersion: 1` and renaming it would be changing the
protocol; everything a person reads — the CLI, the changelog, the reference
docs, the diagnostics — says *surface version*.

After npm installs such a package, `velar add` atomically adds its package name
to `velar.json.extensions`. `velar remove` removes the extension and its owned
manifest field. The compiler and optional framework-host exports remain the
runtime authority; metadata only controls project activation and never bypasses
protocol validation.

An extension declares its modules under its own package name. That name is a
convention the project load does not verify; what it verifies is the two claims
that would take a module away from someone else. The `velar/*` prefix is a
closed vocabulary owned by the language, and only the official target extensions
this toolchain ships — `@velarscript/web`, `@velarscript/node`, `@velarscript/server`, and
`@velarscript/desktop` — may name it. That exemption is what a target capability
is: `@velarscript/node` replaces `velar/worker` with the Node implementation of
the same contract. Any other extension that declares a `velar/*` module
interface or module source fails the project load with a message naming the
extension and the module it tried to claim, and a specifier a different
extension already owns fails the load naming both owners. The same extension
publishing the same module under its own prefix loads normally; the gate is
about the namespace, not about the extension.

### Package resources

A source package that exposes static JSON data declares an exact resource map
beside its source entries, and exposes the same file through npm `exports`:

```json
{
  "name": "catalog-package",
  "type": "module",
  "files": ["src", "generated/block-catalog.json"],
  "exports": {
    ".": "./dist/index.js",
    "./block-catalog": "./generated/block-catalog.json"
  },
  "velar": {
    "entry": "src/index.vel",
    "targets": ["core"],
    "requires": { "capabilities": [] },
    "resources": {
      "./block-catalog": {
        "path": "generated/block-catalog.json",
        "type": "json"
      }
    }
  }
}
```

Consumers write `import json rawCatalog from
"catalog-package/block-catalog"`. The binding has type `unknown`; a Runtime
Type such as `Catalog.parse(rawCatalog)` must validate it before field access.

Every resource key is an exact `./subpath` with no wildcard. `path` is a
normalized, package-relative `.json` file, and every string leaf under the
matching npm export condition must name exactly `./<path>`. Declared files
must be ordinary files contained by the package after symbolic links are
  resolved, valid UTF-8 JSON, no larger than 4 MiB, and present in the installed
  package tarball. The npm installer and lockfile remain the package and
  integrity authority; `velar.resources`
only tells the compiler which data subpaths it is allowed to copy, watch,
serve, or bundle.

`velar test` reconstructs the used package entries and resource subpath exports
inside its sandbox. Framework-free builds copy the exact checked JSON bytes,
generate an ESM value wrapper, and rewrite emitted imports to that output-local
wrapper so npm self-references cannot escape back to a source package manifest;
browser builds bundle the checked JSON.
This makes `check`, `run`, `test`, `dev`, and `build` consume one resource
graph instead of each command inventing a partial package view.

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
The CLI-installed official Web, Node, Server, and Desktop extensions form a narrow
toolchain fallback for projects that intentionally contain no `node_modules`.
The existing Node standard-module capability remains available without syntax
activation; Node-owned route roles and `p"..."` path patterns are activated by
naming `@velarscript/node` directly or by activating an application extension
such as `@velarscript/server` that explicitly composes it. `velar/server`
itself remains owned only by the Server extension.
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

The `library` creator template publishes a Core-only root source entry. The
`component` template uses the same source-entry mechanism for a Web component,
declares `@velarscript/web` as its peer contract, and keeps its demo application
and tests out of the published `files` inventory. Component packages therefore
remain ordinary source libraries rather than hidden framework extensions.
The complete layering, accessibility, and versioning rules are documented in
[`component-packages.md`](component-packages.md).

`npm run test:packages` is the workspace consumer boundary. It builds the
compiled toolchain packages, runs `npm pack` over the official workspace,
checks the tarball contents, installs the complete set into a clean temporary
consumer, invokes the installed CLI, and builds and runs a VelarScript file that
imports the Core Standard API, a synthetic consumer-owned source package, and
the public compiler API. The
browser package gate additionally creates a project through packed tarballs,
builds and verifies its production output, and runs its browser test. A
successful source build without this consumer test is not considered
publishable.

The packed browser gate does not stop at a minimal framework import. Its
generated application imports all twelve application-facing Web modules from
the installed `@velarscript/web` tarball, including the Core-contracted Web
Worker implementation, and the generated browser test imports
`velar/web-test`. The installed CLI must check, test, build, integrity-verify,
and run the resulting project before the release set is accepted.

`npm run release:rehearse` adds the toolchain release-set boundary: the six
compiler/runtime/framework/tooling tarballs,
deterministic SHA-256 values, source identity, npm integrity, and explicit
publication blockers. Candidate mode fails closed unless Git/version/remote
and license requirements are satisfied. CI may attest and upload these
tarballs. Registry publication is a separately authorized, provenance-bearing
GitHub Actions job that consumes the verified strict candidate.

Application libraries and external-service adapters belong to their consuming
project, an independently owned third-party repository, or the separately
versioned `VelarScript-Libraries` companion repository. Companion packages are
officially curated optional dependencies, not VelarScript Core workspaces,
Standard modules, target frameworks, or toolchain release artifacts. The Core
repository never imports them. Companion packages publish publicly under the
separate `@velarscript-labs/*` npm scope; they never reuse `@velarscript/*` or a
`velar/*` module identity. The compiler resolves an installed package's root
`velar.entry` or exact `velar.entries` subpath through the same public package
protocol used for every other installed dependency and never grants it a hidden
Standard-module path.

The rehearsal builds and packs a private temporary toolchain snapshot. It never
cleans or rewrites the active workspace's `dist` directories, so release checks
cannot race with compiler, editor, or application tests.

Release output replacement refuses repository roots/ancestors, symbolic links,
and non-release directories. Verification accepts exactly the sorted compiler,
Node, Server, Web, Desktop, creator, and CLI package identities, canonical tarball
names, matching versions/sizes/hashes/npm
integrity, the declared checksum file, and no undeclared files. Downstream
consumers independently check the required package subset and tarball SHA-256
values before installing it; they do not import this repository's verifier.

Agent orchestration, canonical `namespace:tool` identity, provider transports,
approval, and execution policy belong to VelarOS ecosystem packages rather
than the language toolchain. Such packages may be authored in VelarScript and
consume this package system, but they are not part of the VelarScript release
set or Standard API.

The workspace, compiler, Node runtime, Server, Web, Desktop, creator, and CLI use Apache-2.0. Every npm tarball contains the
complete license text, and package acceptance verifies the installed metadata
and file rather than trusting the source manifest alone. The current rehearsal
is always marked non-publishable because rehearsal mode is evidence only. A
strict candidate becomes publishable only from the clean, exactly tagged
`v0.14.2` source with the matching remote; registry publication remains a
separate explicit authority and must carry npm provenance.
