# create-velar

The official non-interactive project creator for VelarScript. It is the package
behind `npm create velar@latest` and shares the same templates with
`velar create`.

```sh
npm create velar@latest my-app
npm create velar@latest my-service -- --template node
npm create velar@latest my-desktop -- --template desktop
npm create velar@latest my-docs -- --template docs
npm create velar@latest my-library -- --template library
npm create velar@latest my-components -- --template component
```

The first-class application templates are `web`, `node`, and `desktop`. Each
starts with the borderless VelarScript mark and a small Hello experience shaped
like the corresponding JavaScript framework category: an interactive Web page,
a Node HTTP server, or a single-project Desktop window. Specialized templates
remain available as `docs`, `library`, and `component`. The Core
library template publishes a reusable `.vel` entry without Web; the component
template publishes a checked Web component source entry and keeps its preview
application outside that public entry. `game` is reserved for the future
official Canvas framework and deliberately fails until that package exists.

Every generated project includes a root `AGENTS.md` that points coding agents
at `velar skill` — the language brief packaged with the toolchain — together
with the project's gate commands (`velar check`, `velar test`, `velar format`)
and the JavaScript escape-hatch ladder.

Creation is transactional. It refuses non-empty targets and never installs
dependencies, downloads browsers, initializes Git, or contacts a service.
The generated README keeps the first `npm install` explicit, then points to the
installed CLI's npm-backed `velar add`, `remove`, and `update` workflow.
