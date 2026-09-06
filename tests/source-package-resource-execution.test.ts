import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

function runCli(root: string, ...arguments_: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [cli, ...arguments_], { cwd: root, encoding: "utf8", timeout: 120_000 });
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

test("one checked package.json resource serves relative and bare imports in run test and build", async () => {
  const root = await makeTemporaryDirectory("velar-source-package-shared-manifest-resource-");
  const packageManifest = `${JSON.stringify({
    name: "shared-manifest-resource",
    version: "1.0.0",
    private: true,
    type: "module",
    exports: { ".": "./dist/index.js", "./metadata": "./package.json" },
    velar: {
      entry: "src/index.vel",
      targets: ["core"],
      requires: { capabilities: [] },
      resources: { "./metadata": { path: "package.json", type: "json" } },
    },
  }, null, 2)}\n`;
  await writeTree(root, {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "src/index.vel",
      outDir: "dist",
    }, null, 2)}\n`,
    "package.json": packageManifest,
    "src/index.vel": [
      'import json relativeMetadata from "../package.json"',
      'import json publishedMetadata from "shared-manifest-resource/metadata"',
      "type Metadata:",
      "    readonly name: string",
      "",
      "export const resourceName = Metadata.parse(relativeMetadata).name + \"/\" + Metadata.parse(publishedMetadata).name",
      "print(resourceName)",
      "",
    ].join("\n"),
    "src/resource.test.vel": [
      'import {expect} from "velar/test"',
      'import {resourceName} from "./index.vel"',
      "",
      'test "relative and bare package metadata share one value":',
      '    expect(resourceName).toBe("shared-manifest-resource/shared-manifest-resource")',
      "",
    ].join("\n"),
  });

  const run = runCli(root, "run");
  assert.equal(run.status, 0, String(run.stdout) + String(run.stderr));
  assert.equal(run.stdout, "shared-manifest-resource/shared-manifest-resource\n");
  const tested = runCli(root, "test");
  assert.equal(tested.status, 0, String(tested.stdout) + String(tested.stderr));
  assert.match(String(tested.stdout), /relative and bare package metadata share one value/u);

  const built = runCli(root, "build", "--mode", "readable");
  assert.equal(built.status, 0, String(built.stdout) + String(built.stderr));
  for (const path of [
    join(root, "dist", "__velar_packages__", "shared-manifest-resource", "package.json.velar-resource"),
    join(root, "dist", "node_modules", "shared-manifest-resource", "package.json.velar-resource"),
  ]) assert.equal(await readFile(path, "utf8"), packageManifest);
  const runtime = spawnSync(process.execPath, [join(root, "dist", "index.js")], {
    cwd: join(root, "dist"), encoding: "utf8",
  });
  assert.equal(runtime.status, 0, String(runtime.stdout) + String(runtime.stderr));
  assert.equal(runtime.stdout, "shared-manifest-resource/shared-manifest-resource\n");
});
