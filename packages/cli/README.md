# @velarscript/cli

Command-line compiler, project tooling, development/verified-production
servers, Core/browser test runners, production artifact verifier, and language
server for VelarScript. The language server and project graph are compiler-owned;
editors, including the injected VelarOS Workbench contribution, consume them as
independent clients. Requires Node.js 24 or later.

The same server routes JavaScript and TypeScript documents to the pure
VelarScript `@velarscript/script-analysis` package through an internal bundled
tool edge. That package publishes bounded lexical
and local structural diagnostics, symbols, hover, definition, references,
rename, completion, and semantic tokens with incremental lexical updates. It is
not the TypeScript compiler: cross-file/package type checking and JavaScript/
TypeScript formatting remain unsupported and are never synthesized by the CLI.

Application framework behavior is injected. For each project extension the CLI
loads its compiler entry and optional host entry, validates the versioned host
protocol, then supplies generic filesystem, bundling, development transport,
preview, and browser-driver services. The CLI distribution includes exact
official Node capability plus Web and Desktop application targets so a zero-`node_modules` project can
consume that toolchain generation, but it owns none of their syntax, HTML,
CSP, lifecycle, runtime, or native packaging behavior. Project-local targets
take precedence and third-party extensions never use this fallback.

```sh
npx @velarscript/cli create my-app
npx @velarscript/cli create api --template node
npx @velarscript/cli create desktop-app --template desktop
npx @velarscript/cli create product-docs --template docs
npx @velarscript/cli create design-kit --template component
cd my-app
npm install
npm exec velar -- format --check
npm exec velar -- test
npm exec velar -- dev
```

Project creation delegates to the exact matching `create-velar` package, the
same implementation used by `npm create velar@latest`. First-class application
templates are `web`, `node`, and `desktop`; `docs`, `library`, and `component`
remain available for specialized projects. Creation never installs or initializes Git.

VelarScript deliberately uses npm as its package registry, resolver, installer, and
lockfile authority. After the initial `npm install`, the project-aware commands
provide a smaller everyday surface:

```sh
npm exec velar -- install
npm exec velar -- add chart-library
npm exec velar -- add test-helper --dev
npm exec velar -- remove chart-library
npm exec velar -- update
```

`add` accepts npm registry names and versions, not paths, Git URLs, aliases, or
raw npm flags. Packages that publish `velar.extension` metadata are also added
to `velar.json`; removal deletes that declaration and its owned manifest field.
The npm operation remains authoritative for `package.json`, `package-lock.json`,
and `node_modules`, while VelarScript atomically owns only its project manifest.

```sh
npm exec velar -- test --browser
npm exec velar -- build
npm exec velar -- package
npm exec velar -- verify
npm exec velar -- preview
npm exec velar -- verify-deployment --url https://preview.example.com
npm exec velar -- verify-deployment --url https://preview.example.com --json
```

Browser tests run in a dedicated supervised process, not in the long-lived CLI
owner. Each test has a 120-second deadline, the complete run has a 20-minute
deadline, and browser/context cleanup has a 10-second deadline. The supervisor
owns a private process group on POSIX hosts, forwards SIGHUP/SIGINT/SIGTERM,
escalates to SIGKILL, and reaps any remaining BrowserServer or renderer process
before it returns. The worker also observes parent IPC disconnect, so terminating
or force-killing the invoking CLI cannot leave a browser test running. Signals
retain conventional exit codes 129, 130, and 143.

`verify-deployment` compares the verified local output to the served HTTPS
origin. CI may provide the same target with `VELAR_DEPLOYMENT_URL`.
`--json` emits the versioned verification report used as external-preview
evidence.

`velar repro` is for the case where the compiler itself looks wrong. It writes
a self-contained minimal reproduction — the source the diagnostic touches,
`velar.json`, the verbatim output, and the toolchain, Node, and platform
versions — into `.velar/repro`, then prints the path. Its `README.md` arrives
laid out in the three sections a defect report carries, with *What the compiler
said* already filled in. Nothing is uploaded, nothing about the machine is
collected, and every absolute path is rewritten to a project-relative one. The
bundle is extracted to a temporary directory and re-checked before the command
returns; a copy that stops reproducing is reported as such rather than handed
over as a clean report. A failing `velar check` ends with the one line naming
the command.

The distribution also carries the VelarScript AI skill brief
(`skill/ai-skill.md`, kept byte-identical to the repository's
`docs/ai-skill.md` by a permanent gate). `velar skill` prints it verbatim to
stdout, so any coding agent can load the language brief with one offline
command.

Use `velar help <command>` or `velar <command> --help` for command-specific
usage and defaults. Project creation is transactional, manifests reject unknown
fields, and production/release verification fails closed rather than serving or
accepting undeclared output.

`velar format path/to/file.vel` resolves the file's nearest project before
formatting and uses that project's official compiler extensions. A Web or
Desktop file therefore keeps its extension-owned angle syntax even when the
caller names one file instead of the project root; a malformed project is not
silently retried as standalone Core source.
