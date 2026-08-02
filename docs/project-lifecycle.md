# Velar Project Lifecycle

Status: format version 1

New applications are created with:

```sh
velar create my-app
```

The command refuses to write into a non-empty directory. It first creates the
complete project in a sibling staging directory, then renames it over only an
absent or verified-empty target; a partial scaffold is never exposed as a
successful project. It creates a minimal
`src/app.vel` module, `src/main.vel` entry, `src/app.test.vel` Core test,
`src/app.browser.test.vel` browser test, versioned `velar.json`, private npm
application manifest, and ignore file. The application name stays an ordinary
Velar string expression, so filesystem characters such as `&` cannot be
misinterpreted as JSX markup. The generated npm package name is normalized to
a valid unscoped form. The generated scripts include project-level `format` /
`format:check`, Core and Chromium browser tests, plus production `build`, `verify`, `preview`, and
`verify:deployment`. The last command reads an explicit `--url` argument passed
through npm or `VELAR_DEPLOYMENT_URL`; no hosting target is embedded in a new
project. It does not install dependencies, browser binaries, or
initialize Git implicitly.

`velar format` run inside a project recursively formats its `.vel` sources;
`velar format --check` is read-only and exits unsuccessfully after listing
files that differ. A source file or another project directory may be passed
explicitly. Project traversal excludes `.git`, `node_modules`, `publicDir`, and
`outDir`, so public assets, dependencies, and built output are never rewritten.

`velar.json` now declares `formatVersion: 1`. Manifests created before 0.4 that
omit the field remain readable and report `needsUpgrade`; they can be checked
or upgraded explicitly:

```sh
velar upgrade --check
velar upgrade
```

The check form never writes and exits unsuccessfully when an upgrade is needed.
The write form adds the current format version while preserving existing
fields. Unknown future versions fail closed instead of being interpreted by an
older compiler. Single-file builds have no manifest and therefore no project
upgrade operation. Unknown fields at the project, `web`, `build`, `security`,
or `deployment` levels also fail closed, so spelling mistakes cannot silently
select defaults.

A command may receive an explicit manifest file instead of the conventional
project directory. This supports checked-in deployment profiles that share one
source/public root while declaring different base, adapter, source-map, or
public configuration. Release Studio uses `velar.json` for `/app/`
compatibility testing and `velar.netlify.json` for its root external preview;
the profile is explicit input and is never selected from an environment
variable. `web.base` is normalized to one trailing slash and otherwise must be
a canonical pathname without query/hash text, empty/dot segments, backslashes,
malformed percent escapes, or encoded path separators.

Velar 0.5 adds optional `web.security` and `web.deployment` fields without
changing format version 1. Their absence selects the secure CSP and SPA
fallback defaults, so older format-1 projects remain equivalent and need no
mechanical rewrite. Output, public, and entry paths are validated as
non-overlapping before an isolated production build can replace anything.

Velar 0.7 adds optional `web.publicConfig` without changing format version 1.
It is an explicitly public, build-time JSON object rather than an environment
loader. Values are limited to 64 KiB, dangerous prototype keys and non-JSON
values fail loading, and the emitted object is recursively frozen. Projects
created by the current compiler include an empty object and depend on
`@velarscript/cli` `^0.9.0`;
existing format-1 projects require no migration when they omit it.

The additive `web.build.sourceMaps` boolean also keeps format version 1. Its
safe default is `false`, including generated projects. Setting it to `true`
explicitly publishes linked maps with Velar `sourcesContent`; teams should do
so only when that disclosure is intended.

The 0.7 compatibility matrix keeps fixed 0.3 through 0.6 project fixtures. The
current CLI runs `upgrade --check`, explicit upgrade, semantic check, and a
production build for every fixture. Additive format-1 fields keep their prior
values; only the pre-0.4 manifest without `formatVersion` is rewritten.
