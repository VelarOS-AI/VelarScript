import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { readTransactionFile, TRANSACTION_JSON_MAX_BYTES } from "../packages/cli/src/transaction-metadata.ts";

const execFile = promisify(execFileCallback);

test("transaction evidence read rejects a path replaced after descriptor binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-transaction-metadata-swap-"));
  const evidence = join(root, "transaction.json");
  const original = join(root, "original-transaction.json");
  const incoming = join(root, "incoming-author.json");
  try {
    await writeFile(evidence, "{\"transaction\":true}\n", "utf8");
    await writeFile(incoming, "preserve author bytes\n", "utf8");
    const snapshot = await readTransactionFile(evidence, "transaction evidence", TRANSACTION_JSON_MAX_BYTES, {
      afterDescriptorBound: async () => {
        await rename(evidence, original);
        await rename(incoming, evidence);
      },
    });
    assert.equal(snapshot, null);
    assert.equal(await readFile(evidence, "utf8"), "preserve author bytes\n");
    assert.equal(await readFile(original, "utf8"), "{\"transaction\":true}\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("transaction evidence does not block when a FIFO replaces the inspected path", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-transaction-metadata-fifo-"));
  const evidence = join(root, "transaction.json");
  const original = join(root, "original-transaction.json");
  try {
    await writeFile(evidence, "{\"transaction\":true}\n", "utf8");
    const snapshot = await readTransactionFile(evidence, "transaction evidence", TRANSACTION_JSON_MAX_BYTES, {
      beforeDescriptorOpen: async () => {
        await rename(evidence, original);
        await execFile("mkfifo", [evidence]);
      },
    });
    assert.equal(snapshot, null);
    assert.equal(await readFile(original, "utf8"), "{\"transaction\":true}\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
