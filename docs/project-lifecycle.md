# VelarScript Project Lifecycle

Status: project format 2, explicit compiler extensions

Projects are created through `npm create velar` or the installed CLI. Both
commands use the same transactional `create-velar` implementation:

```sh
npm create velar@latest my-app
npm create velar@latest product-docs -- --template docs
npm create velar@latest shared-library -- --template library
npm create velar@latest component-library -- --template component

velar create my-app
velar create product-docs --template docs
velar create shared-library --template library
velar create component-library --template component
```

Creation refuses non-empty targets and assembles the complete project in a
sibling staging directory before the final rename. It does not install
dependencies, browsers, initialize Git, publish, or deploy.

The first install remains ordinary npm bootstrap because a newly created
project does not yet have its local `velar` executable. After that, dependency
maintenance can stay inside the project-aware CLI:

```sh
cd my-app
npm install
npm exec velar -- add package-name
npm exec velar -- add test-package --dev
npm exec velar -- update
npm exec velar -- remove package-name
```

These commands do not replace npm. npm owns dependency resolution and the lock;
VelarScript validates that it is operating inside a format-2 project and synchronizes
only extension activation metadata. An extension package opts in through its
own `package.json` `velar.extension` object, so the CLI has no official Web or
future Game package-name branch.

Format 2 makes the language/framework boundary explicit:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "outDir": "dist",
  "publicDir": "public",
  "extensions": ["@velarscript/web"],
  "web": {
    "title": "My VelarScript App",
    "base": "/",
    "publicConfig": {},
    "build": { "sourceMaps": false },
    "security": { "contentSecurityPolicy": true },
    "deployment": { "spaFallback": true, "adapter": "neutral" }
  }
}
```

`extensions` is required. A Core library uses `"extensions": []` and does not
install `@velarscript/web`. A Web application installs and declares
`@velarscript/web`; that package contributes component/JSX syntax, reactive and
lifecycle semantics, Web types, standard modules, runtime code, manifest
validation, and syntax-aware project-editor behavior. The CLI only resolves and composes those
contributions. Its separate `/host` export also provides the framework-owned
application/error HTML, CSP/reload/deployment/browser-test contract; the CLI validates protocol
version 1 and supplies only generic host mechanics.

There is deliberately no legacy manifest loader and no `velar upgrade`
command. Missing, format-1, and unknown future versions fail before source is
compiled. This is a clean architectural break rather than a compatibility
transition. Unknown project fields and unknown extension-owned fields also fail
closed.

The `web`, `docs`, `library`, and `component` templates share the same creator.
Web and docs projects include Core tests plus browser tests. `library` is a
framework-free Core source package. `component` is a Web source package with a
single published `velar.entry`, a local preview application, a Core contract
test, a browser rendering test, and `@velarscript/web` as both a development
dependency and consumer peer contract. Assertions come from `velar/test`.
Browser automation is a Web extension surface imported from `velar/web-test`
and runs only through `velar test --browser`.

`velar run [entry.vel | project-directory] [-- <program-arguments>...]`
compiles the resolved Core module graph and executes its entry module once on
Node.js with inherited stdio; the program's exit code becomes the command's
exit code, arguments after `--` reach the program through `process.argv`, and
stack traces map back to `.vel` sources. Entry resolution mirrors
`velar check`. Projects that enable a web application framework are rejected
and belong to `velar dev` and `velar build`.

The command remains the lifecycle owner of that compiled child. Its first
SIGINT or SIGTERM is forwarded so `velar/host.onShutdown` can finish the
program's registered cleanup; the launcher's deadline exceeds the public
30-second cleanup window. A second signal, or an expired launcher deadline,
force-terminates the child. The CLI waits for the child's inherited
stdio to close and reports conventional status 130 or 143 when the child exits
from the forwarded signal, so terminating the command cannot leave a detached
VelarScript program holding files, ports, or output streams.

`velar test` and `velar run` compile into a short-lived sandbox inside the
project — `.velar/test-*` and `.velar/run-*` — rather than the system
temporary directory. Keeping the compiled tree inside the project preserves
Node's upward `node_modules` resolution, so bridged JavaScript dependencies
(`import js` packages declared in `package.json`) resolve against the
project's real installation with no environment overrides. The sandbox is
removed after each run; add `.velar/` to `.gitignore` (the project templates
already do).

`velar format` recursively owns project `.vel` files while excluding `.git`,
`node_modules`, `.velar`, `publicDir`, and `outDir`. `velar format --check` is read-only.
Build, verification, preview, and remote-deployment verification continue to
operate on isolated, integrity-checked production output.

An explicit manifest file may be passed instead of the conventional project
directory. This supports checked-in deployment profiles sharing source and
public roots while declaring different Web base paths, adapters, source-map
policy, or public configuration. Extension selection is always declared in the
selected manifest and is never inferred from source text.
