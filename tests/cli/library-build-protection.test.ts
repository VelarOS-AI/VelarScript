import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { variadicCliRunner } from "../support/run-cli.ts";

after(removeTemporaryDirectories);
const runCli = variadicCliRunner({ timeout: 120_000 });

async function library(frozen: boolean): Promise<string> {
  const root = await makeTemporaryDirectory("velar-library-output-protection-");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/index.vel"), "export const value = 42\n");
  await writeFile(join(root, "velar.json"), JSON.stringify({
    formatVersion: 2, kind: "library", entry: "src/index.vel", outDir: "dist", extensions: [],
  }));
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "output-protection", version: "1.0.0", type: "module", exports: { ".": "./dist/index.js" },
    velar: { entry: "src/index.vel", targets: ["core"], requires: { capabilities: [] }, ...(frozen ? { artifacts: { core: "dist/receipt.json" } } : {}) },
  }));
  return root;
}

async function tree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      files[path.slice(root.length + 1)] = (await readFile(path)).toString("base64");
    }
  }
  return files;
}

test("frozen library builds protect all ordinary build paths and verify exact declared inputs", async () => {
  const root = await library(true);
  const built = runCli(root, "build-library", "--mode", "readable");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const expected = await tree(join(root, "dist"));
  await symlink(join(root, "dist"), join(root, "output-alias"));
  for (const args of [
    ["build"], ["build", "src/index.vel"], ["build", "--force"],
    ["build", "src/index.vel", "--out", "dist/index.js"],
    ["build", "src/index.vel", "--out", "output-alias/index.js"],
    ["build", "src/index.vel", "--out", "single/../dist/index.js"],
  ]) {
    const refused = runCli(root, ...args);
    assert.equal(refused.status, 2, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /use 'velar build-library'/u);
    assert.deepEqual(await tree(join(root, "dist")), expected);
  }
  const single = runCli(root, "build", "src/index.vel", "--out", "single/index.js");
  assert.equal(single.status, 0, single.stdout + single.stderr);
  assert.ok((await lstat(join(root, "single/index.js"))).isFile());
  assert.deepEqual(await tree(join(root, "dist")), expected);
  for (const input of [".", "dist", "dist/receipt.json"]) {
    const verified = runCli(root, "verify", input);
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    assert.match(verified.stdout, /Verified Velar library ABI 1/u);
  }
  await writeFile(join(root, "unrelated.json"), "{}");
  const unrelated = runCli(root, "verify", "unrelated.json");
  assert.equal(unrelated.status, 1, unrelated.stdout + unrelated.stderr);
  assert.match(unrelated.stderr, /not this library's/u);
  await writeFile(join(root, "dist/index.js"), "export const tampered = true;\n");
  const tampered = runCli(root, "verify", "dist/receipt.json");
  assert.equal(tampered.status, 1, tampered.stdout + tampered.stderr);
  assert.doesNotMatch(tampered.stdout, /Verified Velar library/u);
});

test("an existing custom receipt protects output after its package declaration changes", async () => {
  const root = await library(true);
  const built = runCli(root, "build-library");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const expected = await tree(join(root, "dist"));
  const packagePath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(packagePath, "utf8")) as { velar: { artifacts?: unknown } };
  delete manifest.velar.artifacts;
  await writeFile(packagePath, JSON.stringify(manifest));
  const refused = runCli(root, "build", "src/index.vel");
  assert.equal(refused.status, 2, refused.stdout + refused.stderr);
  assert.deepEqual(await tree(join(root, "dist")), expected);
  await rename(join(root, "dist"), join(root, "frozen"));
  const alternate = runCli(root, "build", "--out-dir", "frozen", "--force");
  assert.equal(alternate.status, 2, alternate.stdout + alternate.stderr);
  assert.deepEqual(await tree(join(root, "frozen")), expected);
});

test("valid Core source libraries build normally; damaged or unreadable ownership fails closed", async () => {
  const root = await library(false);
  const built = runCli(root, "build");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const expected = await tree(join(root, "dist"));
  const packagePath = join(root, "package.json");
  await writeFile(packagePath, "{broken");
  const malformed = runCli(root, "build", "src/index.vel", "--out", "single.js");
  assert.equal(malformed.status, 2, malformed.stdout + malformed.stderr);
  assert.match(malformed.stderr, /package\.json is not valid JSON/u);
  assert.deepEqual(await tree(join(root, "dist")), expected);
  await rename(packagePath, join(root, "saved-package.json"));
  await mkdir(packagePath);
  const unreadable = runCli(root, "build");
  assert.equal(unreadable.status, 2, unreadable.stdout + unreadable.stderr);
  assert.match(unreadable.stderr, /cannot establish safe library output ownership/u);
  assert.deepEqual(await tree(join(root, "dist")), expected);
});

test("a source library without package.json builds while an existing frozen receipt still protects its output", async () => {
  const root = await library(false);
  await rename(join(root, "package.json"), join(root, "saved-package.json"));
  const built = runCli(root, "build");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  await writeFile(join(root, "dist/velar-library.json"), '{"kind":"velar-library-artifact"}');
  const expected = await tree(join(root, "dist"));
  const refused = runCli(root, "build", "src/index.vel");
  assert.equal(refused.status, 2, refused.stdout + refused.stderr);
  assert.deepEqual(await tree(join(root, "dist")), expected);
});
