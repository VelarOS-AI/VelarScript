import assert from "node:assert/strict";
import test from "node:test";
import { projectManifestSite } from "../../packages/cli/src/project-manifest-site.ts";

test("manifest sites follow the last JSON member and decode escaped keys", () => {
  const text = '{"entry":"old.vel","ent\\u0072y":"new.vel"}';
  const site = projectManifestSite(text, ["entry"]);
  assert.ok(site);
  assert.equal(text.slice(site.key.start, site.key.end), "ent\\u0072y");
  assert.equal(text.slice(site.value.start, site.value.end), JSON.parse(text).entry);
});

test("a later ancestor replaces earlier nested manifest sites even when the key disappears", () => {
  const replaced = '{"server":{"configuration":"old.yml"},"server":{"configuration":"new.yml"}}';
  const site = projectManifestSite(replaced, ["server", "configuration"]);
  assert.ok(site);
  assert.equal(replaced.slice(site.value.start, site.value.end), "new.yml");
  for (const value of ['{}', '{"other":"x"}', 'null']) {
    const text = `{"server":{"configuration":"old.yml"},"server":${value}}`;
    assert.equal(projectManifestSite(text, ["server", "configuration"]), null);
  }
});

test("manifest locators skip nested arrays and quoted braces without changing the reported bytes", () => {
  const text = '{"other":[{"entry":"wrong.vel","text":"}\\\""}],"entry":"src\\u002fmain.vel"}';
  const site = projectManifestSite(text, ["entry"]);
  assert.ok(site);
  assert.equal(text.slice(site.value.start, site.value.end), "src\\u002fmain.vel");
  assert.equal(projectManifestSite(text, ["missing"]), null);
});
