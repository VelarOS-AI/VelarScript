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

`verify-deployment` compares the verified local output to the served HTTPS
origin. CI may provide the same target with `VELAR_DEPLOYMENT_URL`.
`--json` emits the versioned verification report used as external-preview
evidence.

Use `velar help <command>` or `velar <command> --help` for command-specific
usage and defaults. Project creation is transactional, manifests reject unknown
fields, and production/release verification fails closed rather than serving or
accepting undeclared output.
