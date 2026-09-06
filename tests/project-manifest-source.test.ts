import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MAX_PROJECT_MANIFEST_BYTES,
  readProjectManifestSource,
} from "../packages/cli/src/project-manifest-source.ts";
import { resolveVelarProject } from "../packages/cli/src/config.ts";

test("project manifest reads stop at the byte limit and preserve oversized evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-bounded-project-manifest-"));
  const manifest = join(root, "velar.json");
  try {
    await writeFile(manifest, "author manifest\n", "utf8");
    await truncate(manifest, MAX_PROJECT_MANIFEST_BYTES + 1);
    await assert.rejects(readProjectManifestSource(manifest), /project manifest exceeds 1 MiB/u);
    await assert.rejects(resolveVelarProject(root), /Cannot read .*velar\.json: project manifest exceeds 1 MiB/u);
    assert.equal((await lstat(manifest)).size, MAX_PROJECT_MANIFEST_BYTES + 1);
    assert.equal((await readFile(manifest)).subarray(0, 16).toString("utf8"), "author manifest\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project manifest reads reject a pathname replacement without consuming replacement bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-project-manifest-swap-"));
  const manifest = join(root, "velar.json");
  const displaced = join(root, "displaced.json");
  const original = '{"formatVersion":2,"entry":"original.vel"}\n';
  const replacement = '{"formatVersion":2,"entry":"replacement.vel"}\n';
  try {
    await writeFile(manifest, original, "utf8");
    await assert.rejects(readProjectManifestSource(manifest, {
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

test("project manifest reads return one ordinary-file snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-project-manifest-snapshot-"));
  const manifest = join(root, "nested", "velar.json");
  const source = '{"formatVersion":2,"entry":"main.vel"}\n';
  try {
    await mkdir(join(root, "nested"));
    await writeFile(manifest, source, "utf8");
    await writeFile(join(root, "nested", "main.vel"), 'print("snapshot")\n', "utf8");
    assert.equal(await readProjectManifestSource(manifest), source);
    const config = await resolveVelarProject(join(root, "nested"));
    assert.equal(config.manifestSource, source);
    assert.equal(config.manifestIdentity, createHash("sha256").update(source).digest("hex"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
