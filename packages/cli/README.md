# @velarscript/cli

Command-line compiler, project tooling, development/verified-production
servers, Core/browser test runners, production artifact verifier, and language
server for VelarScript. The language server and project graph are compiler-owned;
editors, including the injected VelarOS Workbench contribution, consume them as
independent clients. Requires Node.js 24 or later.

Application framework behavior is injected. For each project extension the CLI
loads its compiler entry and optional host entry, validates the versioned host
protocol, then supplies generic filesystem, bundling, development transport,
preview, and browser-driver services. The CLI distribution includes exact
official Node capability plus Web and Desktop application targets so a zero-`node_modules` project can
consume that toolchain generation, but it owns none of their syntax, HTML,
CSP, lifecycle, runtime, or native packaging behavior. Project-local targets
take precedence and third-party extensions never use this fallback. Application
libraries, database engines, codecs, algorithms, and provider integrations are
owned and installed by consuming projects; the CLI neither publishes them nor
hides their npm dependency graph.

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

For a generated Node service, `velar dev` watches and restarts the last-good
checked `ServeApp`, `velar serve` runs the checked source with production
runtime behavior, and `velar build` writes a standalone Node directory with a
launcher and copied public assets. Web/Desktop development continues through
their framework hosts; `velar run` remains for framework-free CLI programs.

`velar build` defaults to optimized `production` JavaScript for every target.
Select `--mode readable` for one inspectable build, or set top-level
`"build": {"mode": "readable"}` in `velar.json`; the command-line value
overrides the project setting for that invocation.

Source Map is configured independently. Formal builds default to no maps;
set top-level `"build": {"sourceMaps": true}` or pass `--source-maps` to
retain them. Development and test runs keep mappings enabled for diagnostics.

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

The distribution carries separate Core, Web, Node, Server, and Desktop AI skill briefs
under `skill/`, each kept byte-identical to its repository document by a
permanent gate. `velar skill [core|web|node|desktop]` prints one verbatim to
stdout; Core is the default. Generated `AGENTS.md` files name the exact briefs a
project needs.

Use `velar help <command>` or `velar <command> --help` for command-specific
usage and defaults. Project creation is transactional, manifests reject unknown
fields, and production/release verification fails closed rather than serving or
accepting undeclared output.

`velar format path/to/file.vel` resolves the file's nearest project before
formatting and uses that project's official compiler extensions. A Web or
Desktop file therefore keeps its extension-owned angle syntax even when the
caller names one file instead of the project root; a malformed project is not
silently retried as standalone Core source.
