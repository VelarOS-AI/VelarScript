# Velar Static Deployment Contract

Status: production contract retained for Velar 0.9 internal development

`velar build` creates a complete static Web application in an isolated staging
directory. Only a successful build replaces the configured output directory.
This removes stale assets and leaves the previous complete build intact when
compilation, public-asset validation, bundling, or manifest generation fails.

After building, use the product-owned integrity and local-hosting commands:

```sh
velar verify
velar preview --port 4173
velar verify-deployment --url https://preview.example.com
```

`verify` requires exact equality between the output file tree and the format-3
framework-build asset inventory, rejects symbolic links and unsafe/duplicate paths, checks
every size and SHA-256, recomputes `buildId`, and cross-checks entry,
stylesheet, deployment, CSP, cache, fallback, and adapter contracts. `preview`
always runs this verification first. It applies the declared base and headers,
supports GET/HEAD only, uses SPA fallback only for HTML navigation, and returns
404 for a missing asset instead of hiding deployment defects. An undecodable
percent sequence is served through the SPA fallback only for an in-base HTML
navigation, allowing the typed/default application 404 to recover; the same
malformed path with an asset request remains a 400 response.

`verify-deployment` closes the gap between a correct directory and what users
actually receive. It reuses the local verifier, then compares every public file
and `velar-build.json` with the explicit HTTPS origin by decoded byte size and
SHA-256. It checks MIME types, all applicable security/cache headers, root and
deep SPA navigation, and a unique missing hashed asset. Redirects and login
pages are not followed. `VELAR_DEPLOYMENT_URL` is the CI alternative to
`--url`; HTTP is accepted only for localhost/loopback acceptance.
`--json` emits a format-version-1 report containing the timestamp, exact target,
compiler/API identity, source-map policy, `buildId`, and check counts. The
report records a successful observation; it becomes provenance evidence only
when an external system signs or attests it.

The repository prepares its exact deployable preview with
`npm run preview:prepare`. The command builds the checked-in root Netlify
profile from the same Release Studio source files, disables source maps, runs
the production verifier, and atomically writes
`release/external-preview/site`. It refuses to replace an arbitrary directory.
Deployment remains a separate explicit action; the prepared directory is the
only directory the external-preview workflow expects at the target origin.

This is integrity and self-consistency verification, not publisher
authentication. Authenticity still requires a trusted release signature or
provenance over the build manifest in the external release pipeline.

Production source maps are not emitted by default because linked maps contain
Velar source content. An application may opt in with
`web.build.sourceMaps: true`; the policy is recorded in `velar-build.json`, and
maps participate in the exact file inventory and `buildId`. Repeated builds of
identical inputs must produce identical manifest and asset bytes even when the
output directories differ.

## Generated deployment files

- `index.html`: framework-host-owned HTML entry with production CSP metadata.
- `404.html`: optional SPA fallback copy for simple static hosts.
- `velar-deploy.json`: format version 2 provider-neutral base path, framework
  identity, fallback, header, and cache contract.
- `velar-build.json`: format version 3 build identity, framework/host-protocol
  identity, and hashes for every emitted file, including deployment files.
- `assets/*`: content-hashed JavaScript, CSS, and maps.
- `_headers` and `_redirects`: CLI deployment-adapter files when the explicit Netlify
  adapter is selected.

`web.publicConfig` is validated and compiled into the content-hashed JavaScript
entry. Changing it therefore changes the build identity and must go through a
new build. Static adapters do not inject environment variables at request time,
and secrets must never be placed in this public object.

Static host adapters consume `velar-deploy.json`. They must apply its security
headers and rewrite unknown application paths to `index.html` without rewriting
real asset requests. Content-hashed assets are immutable for one year; HTML and
manifests use `no-cache`.

## Netlify adapter

Root-base applications may select the first concrete adapter:

```json
{
  "web": {
    "base": "/",
    "deployment": {
      "spaFallback": true,
      "adapter": "netlify"
    }
  }
}
```

The CLI deployment adapter translates every framework-projected header rule to Netlify's `_headers` syntax. Its
redirects first map a nonexistent `/assets/*` request to `404.html` with status
404, then apply `/* /index.html 200` as the SPA rewrite. Netlify's documented
shadowing keeps existing assets available while preventing a missing script
from becoming `index.html`. These are the provider's
documented file-based [custom-header](https://docs.netlify.com/manage/routing/headers/)
and [rewrite](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/)
contracts. The adapter files are hashed assets in `velar-build.json`; a public
asset cannot override them. Root HTML, fallback HTML, and both Velar manifests
have explicit `no-cache` rules; content-hashed assets remain immutable.

The Netlify adapter currently rejects non-root `web.base`. Velar's neutral
manifest and local production server support a subpath, but silently pretending
that Netlify will strip that prefix would misroute physical assets. A future
path-aware adapter must prove that mapping before this restriction is relaxed.

## Default security policy

Production HTML and the deployment header contract default to a restrictive
Content Security Policy: scripts and fonts are same-origin, objects and base
URLs are disabled, forms remain same-origin, and only explicit secure API/image
origins may be added. `style-src-attr 'unsafe-inline'` is retained narrowly for
runtime Look values whose checked properties depend on application state;
script execution never receives an inline escape hatch.

Additional origins are configured structurally:

```json
{
  "web": {
    "security": {
      "contentSecurityPolicy": true,
      "connectSources": ["https://api.example.com"],
      "imageSources": ["https://images.example.com"]
    },
    "deployment": {
      "spaFallback": true,
      "adapter": "neutral"
    }
  }
}
```

Only secure origin values are accepted. Paths, credentials, queries, hashes,
and arbitrary CSP fragments fail configuration loading.

The framework/CLI production pipeline reserves `index.html`, `404.html`,
`velar-build.json`, `velar-deploy.json`, `_headers`, and `_redirects`. Files with those names in
`publicDir` fail the build rather than overriding the security boundary. Public
symbolic links are also rejected so a build cannot copy files outside the
declared asset root.
