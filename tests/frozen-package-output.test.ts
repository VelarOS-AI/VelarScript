import assert from "node:assert/strict";
import { join } from "node:path";
import test, { after } from "node:test";
import { writeFrozenPackageEntries } from "../packages/cli/src/frozen-package-output.ts";
import type { VelarSourcePackage } from "../packages/cli/src/project.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

test("sandbox artifact outputs reject portable resource path collisions", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-output-collision-");
  const packageRoot = join(root, "package");
  const outputRoot = join(root, "output");
  const entryPath = join(packageRoot, "dist", "index.js");
  const sourceMapPath = `${entryPath}.map`;
  const snapshot = { path: entryPath, code: "export {};\n", sourceMapPath, sourceMap: "{}\n" };
  const package_ = {
    name: "collision-fixture",
    root: packageRoot,
    artifacts: new Map([[".", {
      subpath: ".",
      entryPath,
      entrySnapshot: snapshot,
      entrySnapshots: [snapshot],
      chunkSnapshots: [],
    }]]),
  } as unknown as VelarSourcePackage;

  for (const occupiedPath of [
    join(outputRoot, "node_modules", "collision-fixture", "dist", "INDEX.js"),
    join(outputRoot, "node_modules", "collision-fixture", "dist", "index.js", "resource.json"),
  ]) {
    await assert.rejects(
      writeFrozenPackageEntries([package_], outputRoot, "sandbox", new Set([occupiedPath]), "readable", true),
      /conflicts with generated resource/u,
    );
  }
});

test("sandbox artifact outputs reject paths unavailable on Windows", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-output-portable-");
  const outputRoot = join(root, "output");
  for (const occupiedPath of [
    join(outputRoot, "cache.", "resource.json"),
    join(outputRoot, "CON", "resource.json"),
  ]) {
    await assert.rejects(
      writeFrozenPackageEntries([], outputRoot, "sandbox", new Set([occupiedPath]), "readable", true),
      /(?:trailing dot or space|Windows-reserved path segment)/u,
    );
  }
});
