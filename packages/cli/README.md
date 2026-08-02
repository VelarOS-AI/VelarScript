# @velarscript/cli

Command-line compiler, project tooling, development/verified-production
servers, Core/browser test runners, production artifact verifier, and language
server for VelarScript. The language server and project graph are compiler-owned;
editors, including the injected VelarOS Workbench contribution, consume them as
independent clients. Requires Node.js 24 or later.

```sh
npx @velarscript/cli create my-app
cd my-app
npm install
npx velar format --check
npx velar test
npx velar dev
```

```sh
npx velar test --browser
npx velar build
npx velar verify
npx velar preview
npx velar verify-deployment --url https://preview.example.com
npx velar verify-deployment --url https://preview.example.com --json
```

`verify-deployment` compares the verified local output to the served HTTPS
origin. CI may provide the same target with `VELAR_DEPLOYMENT_URL`.
`--json` emits the versioned verification report used as external-preview
evidence.

Use `velar help <command>` or `velar <command> --help` for command-specific
usage and defaults. Project creation is transactional, manifests reject unknown
fields, and production/release verification fails closed rather than serving or
accepting undeclared output.
