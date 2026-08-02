import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CI covers platform, browser, and non-publishing provenance gates", async () => {
  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  for (const platform of ["ubuntu-latest", "macos-latest", "windows-latest"]) assert.match(ci, new RegExp(platform, "u"));
  assert.match(ci, /node-version: "24\.x"/u);
  assert.match(ci, /playwright install --with-deps chromium firefox webkit/u);
  assert.match(ci, /npm run test:browser/u);

  const release = await readFile(".github/workflows/release-rehearsal.yml", "utf8");
  assert.match(release, /id-token: write/u);
  assert.match(release, /attestations: write/u);
  assert.match(release, /artifact-metadata: write/u);
  assert.match(release, /actions\/attest@v4/u);
  assert.match(release, /release-toolchain\.mjs candidate/u);
  assert.doesNotMatch(release, /npm publish/u);

  const externalPreview = await readFile(".github/workflows/external-preview-verification.yml", "utf8");
  assert.match(externalPreview, /workflow_dispatch:/u);
  assert.match(externalPreview, /deployment_url:/u);
  assert.match(externalPreview, /VELAR_DEPLOYMENT_URL/u);
  assert.match(externalPreview, /verify-deployment release\/external-preview\/site --json/u);
  assert.match(externalPreview, /actions\/attest@v4/u);
  assert.match(externalPreview, /artifact-metadata: write/u);
  assert.match(externalPreview, /actions\/upload-artifact@v5/u);
  assert.doesNotMatch(externalPreview, /netlify deploy|npm publish|secrets\./u);
});
