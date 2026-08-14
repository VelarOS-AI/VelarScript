import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Expands the `npm run` links inside a script so a gate is checked by what it
 * actually runs. Public gates delegate their body through `scripts/gate-lock.mjs`,
 * and reading only the outer command would silently stop covering the chain.
 */
function resolveScript(scripts: Record<string, string>, name: string, seen: Set<string> = new Set()): string {
  if (seen.has(name)) return "";
  seen.add(name);
  return (scripts[name] ?? "").replace(
    /npm run (?:--silent )?([\w:.-]+)/gu,
    (match, target: string) => `${match} ${resolveScript(scripts, target, seen)}`,
  );
}

test("CI covers platform, browser, and non-publishing provenance gates", async () => {
  const workspace = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.match(resolveScript(workspace.scripts, "test"), /tests\/release\.acceptance\.ts/u);
  assert.equal(workspace.scripts["release:rehearse"], "node scripts/release-toolchain.mjs rehearse");
  assert.equal(workspace.scripts["preview:prepare"], "node scripts/prepare-external-preview.mjs");

  // A gate that stops taking the checkout lock lets a second run delete a
  // package dist mid-test and fail the first one for no reason.
  for (const gate of ["build:packages", "check", "test", "test:browser", "test:packages", "velar"]) {
    assert.match(workspace.scripts[gate] ?? "", /^node scripts\/gate-lock\.mjs /u, `${gate} must run under the gate lock`);
  }

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
