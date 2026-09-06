import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rename, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readInstalledPackageManifestSource } from "../../packages/cli/src/installed-package-closure.ts";

test("installed package manifest reads reject sparse oversized evidence without changing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-bounded-installed-manifest-"));
  const manifest = join(root, "package.json");
  try {
    await writeFile(manifest, "author package\n", "utf8");
    await truncate(manifest, 1024 * 1024 + 1);
    await assert.rejects(readInstalledPackageManifestSource(manifest), /exceeds 1 MiB/u);
    assert.equal((await lstat(manifest)).size, 1024 * 1024 + 1);
    assert.equal((await readFile(manifest)).subarray(0, 15).toString("utf8"), "author package\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed package manifest reads reject a pathname replacement and preserve both files", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-installed-manifest-swap-"));
  const manifest = join(root, "package.json");
  const displaced = join(root, "displaced.json");
  const original = '{"name":"original","version":"1.0.0"}\n';
  const replacement = '{"name":"replacement","version":"1.0.0"}\n';
  try {
    await writeFile(manifest, original, "utf8");
    await assert.rejects(readInstalledPackageManifestSource(manifest, {
      afterPathInspection: async () => {
        await rename(manifest, displaced);
        await writeFile(manifest, replacement, "utf8");
      },
    }), /changed physical identity or contents while it was read/u);
    assert.equal(await readFile(displaced, "utf8"), original);
    assert.equal(await readFile(manifest, "utf8"), replacement);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
