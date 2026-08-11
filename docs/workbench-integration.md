# VelarOS Workbench integration

VelarScript and VelarOS Workbench advance together while remaining independent
products.

Workbench is a general editor. VelarScript is one injected language
contribution hosted by it. The compiler does not depend on Workbench, and the
Workbench core does not implement VelarScript.

## Ownership boundary

| Owner | Responsibilities |
| --- | --- |
| Workbench core | Generic editor UI, files, terminals, commands, extension loading, and a standard external-LSP host. |
| Built-in VelarScript contribution | `.vel` association, project detection, command metadata, local CLI discovery, LSP launch metadata, and minimal lexical fallback. |
| `@velarscript/cli` | `velar lsp`, project configuration, extension loading, diagnostics, formatting, builds, and tests. |
| `@velarscript/compiler` | Core grammar, types, control flow, module semantics, semantic index, and JavaScript lowering. |
| `@velarscript/web` | JSX, components, Web types, reactivity, lifecycle, Look, Web completion, and Web lowering. |

This boundary is intentional:

- Workbench remains usable for JavaScript, TypeScript, Python, VelarScript, and
  related Web files without becoming a VelarScript-specific application.
- The VelarScript contribution can be built in by the Workbench product without
  being hard-coded into the reusable editor core.
- A compiler or Web package update changes language behavior without requiring
  a second implementation in the editor.
- Compiler, Web framework, CLI, and Workbench keep independent package and
  release lifecycles.

## Language server contract

Workbench launches the project-local command:

```sh
velar lsp
```

Resolution order is:

1. the open project's `node_modules/.bin/velar`;
2. an explicitly configured executable;
3. the Workbench-bundled compatible toolchain, when the product provides one.

The project-local toolchain is preferred because `velar.json` may enable a
specific compiler extension such as `@velarscript/web`.

The transport is standard JSON-RPC/LSP over stdio. Workbench should not add a
VelarScript-only protocol branch for language facts.

`velar lsp` owns:

- diagnostics;
- formatting and format checks;
- lexical and semantic tokens;
- completion;
- hover;
- signature help, including named arguments;
- definitions and references;
- same-document occurrences;
- document symbols;
- safe rename;
- inferred-type inlay hints;
- module-path navigation;
- Core and Web extension semantics.

Workbench maps these standard responses into its generic editor UI.

## Contribution surface

The built-in VelarScript contribution may provide:

- `.vel` file association;
- `velar.json` project detection;
- indentation and comment defaults;
- a small fallback keyword list for startup before LSP readiness;
- commands for check, format, dev, test, browser test, build, verify, preview,
  and deployment verification;
- an LSP descriptor and protocol compatibility declaration.

The contribution must not contain its own:

- type checker;
- collection method table;
- JSX prop or event table;
- Look property/builder table;
- Web module signatures;
- route matcher;
- formatter;
- compiler copy;
- state/resource/action runtime.

Those facts come from the installed toolchain. Even lexical Web keywords should
arrive through extension-aware semantic tokens once the language server is
ready.

## Web extension behavior

A Core library project can omit `@velarscript/web`; JSX and Web keywords are
then invalid language features. A Web project declares the extension in
`velar.json`:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "extensions": ["@velarscript/web"]
}
```

The same `velar lsp` process loads that extension and supplies component tags,
checked props, native attributes, events, `state`, computed accessors,
`action`, lifecycle, and Look semantics. Workbench does not switch to a
different VelarScript-specific editor implementation.

## Failure behavior

The integration fails clearly and locally:

- Missing project dependencies produce an install/configuration action, not a
  silent global compiler fallback.
- An incompatible protocol version prevents startup and reports the required
  version.
- A crashed server can be restarted without losing the open file.
- Stale diagnostics are cleared when a document or project closes.
- Rename is applied only from a complete compiler workspace edit; Workbench
  never falls back to textual replacement after a semantic failure.
- Oversized or malformed protocol frames are rejected by both sides.

The editor may retain basic text editing and lexical coloring while the server
is unavailable, but it must not present guessed semantic results as compiler
facts.

## Validation

Changes to the compiler/editor seam should verify:

1. a packed or project-local `velar` executable, not a source import;
2. startup from an ordinary Workbench project;
3. Core diagnostics, hover, completion, definition, references, rename, and
   formatting;
4. Web extension completion and semantic tokens in a Web project;
5. named-argument signature help;
6. List/Set/Map member completion from the current compiler surface;
7. class fields, constructors, getters, inheritance, and private visibility;
8. `match` type patterns, bindings, and guards;
9. server restart and incompatible-version failure paths.

The acceptance criterion is ownership, not just appearance: the result must
come from the project toolchain through the generic Workbench host.
