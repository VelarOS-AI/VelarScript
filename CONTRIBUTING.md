# Contributing to VelarScript

VelarScript is still a pre-1.0 language and Web framework. Changes should make
the language clearer or the Web development loop more complete; compatibility
with an accidental earlier implementation is not a goal by itself.

## Ownership boundaries

- `packages/compiler` owns Core syntax, types, analysis, JavaScript emission,
  semantic metadata, and extension/framework-host protocols.
- `packages/web` owns JSX, components, reactivity, lifecycle, browser types,
  Web runtime behavior, and deployment projection.
- `packages/cli` composes installed extensions and owns generic project,
  package, build, test, preview, and LSP processes. It must not become a second
  Web framework.
- `packages/create` owns transactional project templates.
- The independent Workbench repository is a generic editor host. Language
  intelligence must arrive from the project-local VelarScript LSP.

## Language and API changes

A user-visible language change should update the language charter, diagnostics,
compiler/runtime behavior, semantic tooling, and focused tests together. If a
real application exposes an awkward rule, fix the language or framework seam
instead of adding an application-only workaround.

Keep the type layer small and operational. Do not introduce TypeScript-style
type-level programming, hidden JavaScript coercion, ambient browser globals, or
a second runtime model. JavaScript interop must cross an explicit checked
boundary.

## Local validation

VelarScript requires Node.js 24 or later and npm.

```sh
npm ci
npm run check
npm test
npm run test:packages
npm run test:browser
```

The browser gate installs and exercises Chromium, Firefox, and WebKit. A change
that touches packaging or delivery should also run the non-publishing release
rehearsal documented in `docs/release-process.md`. Editor-facing changes must
be checked through a packed toolchain in the independent Workbench gate; do not
link compiler source into the editor.

Gates in one checkout run one at a time. Every gate rebuilds `packages/*/dist`
through a clean step, binds fixed test ports, and writes sandboxes under
`examples/*/.velar`; a second gate started in the same working tree would delete
a package `dist` while the first one is importing it and fail that run with an
`ERR_MODULE_NOT_FOUND` the code did not cause. `build:packages`, `check`,
`test`, `test:browser`, `test:packages`, and `velar` therefore run under
`scripts/gate-lock.mjs`, which is keyed by the checkout path: a later gate
prints what it is waiting for and starts when the running one finishes.
Separate checkouts, git worktrees, and CI jobs never wait on each other, and the
release and preview scripts build in a temporary workspace so they are not
serialized at all. The `gate:*` scripts are the unlocked bodies of those gates
and exist only to be wrapped; running one directly skips the lock.

Do not publish npm packages, create a stable tag, deploy a preview, or weaken a
release blocker as part of an ordinary contribution.
