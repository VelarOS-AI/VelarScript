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

Provider projection is application or deployment-repository code. A project
may consume `velar-deploy.json` after verification and create the configuration
required by its chosen host, but VelarScript does not ship provider packages or
provider-specific release workflows. Such code cannot acquire a `velar/*`
module, compiler hook, manifest keyword, or hidden release coupling.

## Headers and caching

`velar-deploy.json` states the entire header contract, the document caching
rule included. Its `headers` rules are ordered and resolve **last match wins**.
A `<base>*` rule carries the security headers; a second `<base>*` rule assigns
`Cache-Control: no-cache`; `<base>assets/*` then overrides it with
`public, max-age=31536000, immutable`; the enumerated document paths — the
base, `index.html`, both manifests, and the SPA fallback when there is one —
repeat `no-cache` last. So the content-hashed assets keep their immutable year
and every deep route the enumerated paths cannot name revalidates.

Because the `<base>*` rule states the document caching itself, every file
outside `assets/` answers `no-cache` — public JSON, images, and fonts
included. `velar preview` supplies no cache header out of band; it applies
these rules in order, which is what makes a provider that projects the manifest
literally and the preview server indistinguishable to `velar verify-deployment`.
A provider that resolves first match wins instead would not give the hashed
assets their immutable year: project the rules in the order the manifest
states them.

## Security and public configuration

Production source maps are off by default because they contain source text.
Opt in with top-level `build.sourceMaps: true`; maps then participate in the exact
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
