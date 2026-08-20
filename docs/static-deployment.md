# VelarScript static deployment contract

`velar build` creates one provider-neutral static Web application in an
isolated staging directory. Only a successful build replaces the configured
output, so stale files disappear and a failed build preserves the last complete
artifact.

```sh
velar build
velar verify
velar preview --port 4173
velar verify-deployment --url https://preview.example.com
```

`verify` requires exact equality between the directory and the format-3
`velar-build.json` inventory. It rejects symbolic links and unsafe or duplicate
paths, verifies every byte count and SHA-256, recomputes `buildId`, and
cross-checks entry, stylesheet, source-map, CSP, cache, and fallback facts.
`preview` always performs that verification before serving.

`verify-deployment` compares every public file with an explicit HTTPS origin
by decoded byte size and SHA-256. It also checks MIME types, applicable
security/cache headers, root and deep SPA navigation, and a unique missing
hashed asset. Redirects and login pages are not followed. Loopback HTTP is
accepted only for local acceptance. A JSON report is observation evidence;
publisher authenticity still requires an external signature or attestation.

## Generated files

- `index.html`: framework-owned HTML entry.
- `404.html`: optional provider-neutral SPA fallback document.
- `velar-deploy.json`: format-2 base, framework identity, fallback, headers,
  and caching contract.
- `velar-build.json`: format-3 build identity and exact file inventory.
- `assets/*`: content-hashed JavaScript, CSS, and optional maps.

The CLI never emits provider control files and the Web manifest has no
provider/adapter selector. `web.deployment` contains only portable behavior:

```json
{
  "web": {
    "base": "/",
    "deployment": { "spaFallback": true }
  }
}
```

Provider integrations are ordinary, independently versioned packages. They
consume `velar-deploy.json` after the neutral build and cannot acquire a
`velar/*` module, compiler hook, manifest keyword, or hidden release coupling.

## Netlify integration

Install and run `@velarscript/netlify` separately:

```sh
velar build
npx velar-netlify dist netlify-bundle
```

The integration copies the exact verified build to `netlify-bundle/site` and
writes `netlify-bundle/netlify.toml` beside it. Netlify uses the bundle root and
publishes `site/`. Provider configuration therefore never alters the
compiler-owned file inventory or build identity. The integration currently
accepts root-base builds only, rejects symbolic links, enforces file/byte
ceilings, and requires a new output directory.

The repository's `npm run preview:prepare` flow applies this same external
projection to the checked-in provider-neutral preview profile. Deployment
remains a separate authorized action.

## Security and public configuration

Production source maps are off by default because they contain source text.
Opt in with `web.build.sourceMaps: true`; maps then participate in the exact
inventory and `buildId`.

`web.publicConfig` is validated and compiled into the content-hashed entry.
It is public and must never contain secrets. Static provider integrations do
not inject environment variables into application JavaScript.

Production HTML and deployment headers default to a restrictive Content
Security Policy. Additional connect/image origins are structured exact origins:

```json
{
  "web": {
    "security": {
      "contentSecurityPolicy": true,
      "connectSources": ["https://api.example.com"],
      "imageSources": ["https://images.example.com"]
    }
  }
}
```

Paths, credentials, queries, hashes, and arbitrary CSP fragments are rejected.
The production pipeline reserves only its provider-neutral generated names:
`index.html`, `404.html`, `velar-build.json`, and `velar-deploy.json`. Public
symbolic links are rejected, and manifest-referenced public files such as
`web.icon` must exist as ordinary files.
