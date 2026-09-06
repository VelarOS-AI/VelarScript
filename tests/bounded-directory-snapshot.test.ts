import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertDirectorySnapshotUnchanged,
  inspectBoundedDirectory,
  inspectedFileIdentity,
  productionDirectoryPolicy,
} from "../packages/cli/src/bounded-directory-snapshot.ts";

test("final directory authorization rejects an earlier hashed file rewritten on its original inode", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-directory-snapshot-rewrite-"));
  const earlier = join(root, "a.js");
  try {
    await mkdir(root, { recursive: true });
    await writeFile(earlier, "first\n", "utf8");
    await writeFile(join(root, "z.js"), "last\n", "utf8");
    const snapshot = await inspectBoundedDirectory(root, "Directory snapshot", productionDirectoryPolicy);
    await inspectedFileIdentity(snapshot.files.get("a.js")!, 1024, "Earlier file");
    const inode = (await lstat(earlier)).ino;
    await writeFile(earlier, "rewritten on the same inode\n", "utf8");
    assert.equal((await lstat(earlier)).ino, inode);
    await inspectedFileIdentity(snapshot.files.get("z.js")!, 1024, "Later file");
    await assert.rejects(
      assertDirectorySnapshotUnchanged(snapshot, "Directory snapshot"),
      /a\.js.*changed physical identity or contents/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
