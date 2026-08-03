# Velar Component Packages

Status: source-package contract under application dogfood

A Velar component package is an ordinary npm package whose public implementation
is checked `.vel` source. It is not a compiler extension, does not provide a
framework host, and cannot silently activate language syntax.

## Package contract

```json
{
  "name": "example-components",
  "version": "1.0.0",
  "type": "module",
  "files": ["src/index.vel", "README.md"],
  "velar": { "entry": "src/index.vel" },
  "peerDependencies": {
    "@velarscript/web": "^1.0.0"
  }
}
```

- `velar.entry` is the one public source entry resolved by the compiler.
- `files` contains the public source and required package documentation. Demo
  applications, browser tests, screenshots, and local project manifests remain
  outside the published inventory.
- `@velarscript/web` is a peer contract because the consuming application owns
  the framework instance and compiler extension. A component library must not
  hide a second Web runtime inside itself.
- Runtime JavaScript dependencies remain ordinary npm dependencies. Framework
  and toolchain dependencies are not smuggled through Velar metadata.

`npm create velar@latest components -- --template component` creates this
shape with a local preview application, Core contract test, browser rendering
test, production build, and verification scripts.

## Layering

Component systems should grow in three layers:

1. Theme-neutral primitives own accessible behavior and small layout contracts.
2. A brand/theme package composes primitives with tokens, typography, color,
   spacing, and visual identity.
3. Product packages compose both layers into navigation, documentation, forms,
   dashboards, or other domain patterns.

The official website dogfoods this split privately as `@velarscript/ui`,
`@velarscript/site-ui`, and `@velarscript/docs-kit`. Those packages do not enter
the public toolchain release merely because they live under the Velar namespace;
promotion requires a stable API, independent package acceptance, and explicit
release scope.

## Accessibility boundary

Primitive components prefer native elements and browser behavior. A wrapper
must preserve the native role, keyboard path, focus target, and accessible name.
ARIA describes behavior that really exists; it is not used to simulate missing
interaction. Skip links require a real focusable target. Reduced-motion rules
belong beside the animation they disable.

Reusable label, title, hint, and error relationships use
`domId(prefix="velar")` from `velar/web`. Component packages do not require
callers to coordinate global ID strings and do not spend cryptographic UUIDs on
ordinary in-document accessibility relationships.

Browser tests verify rendered roles/attributes and the user path. Type checking
alone is not accessibility evidence.

## Versioning

Component packages version independently from the language and Web API. Their
peer range states which Web contract consumers must provide. Breaking props,
rendered semantics, focus behavior, or published source paths require a major
component-package version even when generated JavaScript would still execute.
