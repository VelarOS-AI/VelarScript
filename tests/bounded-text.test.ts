import assert from "node:assert/strict";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readBoundedBytes, readBoundedText } from "../packages/cli/src/bounded-text.ts";

test("bounded file reads accept the exact limit and reject one extra byte", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-bounded-file-"));
  try {
    const exact = join(root, "exact.txt");
    const oversized = join(root, "oversized.bin");
    await writeFile(exact, "velar", "utf8");
    await writeFile(oversized, Buffer.alloc(6, 0x61));

    assert.equal(await readBoundedText(exact, 5, "fixture"), "velar");
    await assert.rejects(readBoundedBytes(oversized, 5, "fixture"), /fixture exceeds 5 bytes/u);
    await assert.rejects(readBoundedBytes(exact, Number.MAX_SAFE_INTEGER, "fixture"), /invalid byte limit/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounded file reads reject a large sparse file before allocating its size", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-bounded-sparse-"));
  try {
    const path = join(root, "sparse.bin");
    await writeFile(path, "", "utf8");
    await truncate(path, 64 * 1024 * 1024);
    await assert.rejects(readBoundedBytes(path, 1024, "sparse fixture"), /sparse fixture exceeds 1024 bytes/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
