# @velarscript/netlify

An independently versioned deployment integration. It reads the neutral
`velar-deploy.json` contract from a completed VelarScript browser build and
projects it into a new external Netlify bundle. The exact verified Web build
is copied to `site/`; provider configuration lives beside it in
`netlify.toml`, so provider files never enter or alter the compiler-owned build
inventory.

```sh
velar build
npx velar-netlify dist netlify-bundle
```

Deploy `netlify-bundle` as the Netlify base directory; its generated
configuration publishes `netlify-bundle/site`. The source build is never
modified. The output must not already exist, symbolic
links are rejected, and file count and aggregate-byte limits are enforced while
copying. The current Netlify projection accepts root-base applications only.
