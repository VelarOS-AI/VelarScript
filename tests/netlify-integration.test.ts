import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { projectNetlifyDeployment } from "../integrations/netlify/src/index.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

async function deploymentFixture(base = "/"): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-netlify-integration-");
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "index.html"), "<!doctype html><main>ready</main>\n", "utf8");
  await writeFile(join(directory, "404.html"), "<!doctype html><main>missing</main>\n", "utf8");
  await writeFile(join(directory, "assets", "main-ABC.js"), "export const ready = true\n", "utf8");
  await writeFile(join(directory, "velar-deploy.json"), `${JSON.stringify({
    formatVersion: 2,
    kind: "velar-static-deployment",
    base,
    spaFallback: { source: "index.html", fallback: "404.html" },
    headers: [
      { path: "/*", values: { "Content-Security-Policy": "default-src 'self'", "X-Content-Type-Options": "nosniff" } },
      { path: "/assets/*", values: { "Cache-Control": "public, max-age=31536000, immutable" } },
    ],
  }, null, 2)}\n`, "utf8");
  return directory;
}

test("Netlify integration keeps provider configuration outside the verified site", async () => {
  const source = await deploymentFixture();
  const output = join(await makeTemporaryDirectory("velar-netlify-output-"), "bundle");
  const before = await readFile(join(source, "velar-deploy.json"));
  const projection = await projectNetlifyDeployment(source, output);

  assert.equal(projection.outputDirectory, output);
  assert.equal(projection.siteDirectory, join(output, "site"));
  assert.deepEqual(projection.files, ["netlify.toml"]);
  assert.deepEqual(await readFile(join(projection.siteDirectory, "velar-deploy.json")), before);
  assert.equal(await readFile(join(projection.siteDirectory, "assets", "main-ABC.js"), "utf8"), "export const ready = true\n");
  await assert.rejects(readFile(join(projection.siteDirectory, "_headers")), /ENOENT/u);
  await assert.rejects(readFile(join(projection.siteDirectory, "_redirects")), /ENOENT/u);

  const configuration = await readFile(join(output, "netlify.toml"), "utf8");
  assert.match(configuration, /^\[build\]\npublish = "site"/u);
  assert.match(configuration, /\[\[headers\]\]\nfor = "\/\*"/u);
  assert.match(configuration, /"Content-Security-Policy" = "default-src 'self'"/u);
  assert.match(configuration, /\[\[redirects\]\]\nfrom = "\/assets\/\*"\nto = "\/404\.html"\nstatus = 404/u);
  assert.match(configuration, /\[\[redirects\]\]\nfrom = "\/\*"\nto = "\/index\.html"\nstatus = 200/u);
  assert.deepEqual(await readFile(join(source, "velar-deploy.json")), before);
  await assert.rejects(projectNetlifyDeployment(source, output), /must not already exist/u);
});

test("Netlify integration rejects non-root and symbolic-link inputs before publication", async () => {
  const subpath = await deploymentFixture("/app/");
  await assert.rejects(projectNetlifyDeployment(subpath, join(await makeTemporaryDirectory("velar-netlify-subpath-"), "bundle")), /requires a root-base deployment/u);

  const linked = await deploymentFixture();
  await symlink(join(linked, "index.html"), join(linked, "linked.html"));
  await assert.rejects(projectNetlifyDeployment(linked, join(await makeTemporaryDirectory("velar-netlify-linked-"), "bundle")), /cannot be a symbolic link/u);
});
