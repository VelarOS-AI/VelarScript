import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_PRODUCTION_DIRECTORY_DEPTH } from "../../packages/cli/src/bounded-directory-snapshot.ts";
import { captureStandaloneOutputIdentity } from "../../packages/cli/src/standalone-output-recovery.ts";

test("standalone identity capture rejects a FIFO swapped into its descriptor-open window", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-standalone-identity-fifo-"));
  const output = join(root, "main.js");
  const original = join(root, "original.js");
  try {
    await writeFile(output, "generated output\n", "utf8");
    const started = Date.now();
    await assert.rejects(captureStandaloneOutputIdentity(output, "file", {
      afterPathInspection: async () => {
        await rename(output, original);
        const fifo = spawnSync("mkfifo", [output], { encoding: "utf8" });
        assert.equal(fifo.status, 0, String(fifo.stderr));
      },
    }), /changed physical identity or contents/u);
    assert.ok(Date.now() - started < 750, "FIFO replacement must not wait for a writer");
    assert.equal(await readFile(original, "utf8"), "generated output\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone identity capture rejects same-inode growth after descriptor binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-standalone-identity-growth-"));
  const output = join(root, "main.js");
  try {
    await writeFile(output, "generated output\n", "utf8");
    const inode = (await lstat(output)).ino;
    await assert.rejects(captureStandaloneOutputIdentity(output, "file", {
      afterDescriptorBound: async () => appendFile(output, "author growth\n", "utf8"),
    }), /changed physical identity or contents/u);
    assert.equal((await lstat(output)).ino, inode);
    assert.equal(await readFile(output, "utf8"), "generated output\nauthor growth\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone tree identity enforces the shared directory depth boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-standalone-identity-depth-"));
  try {
    let directory = root;
    for (let depth = 0; depth <= MAX_PRODUCTION_DIRECTORY_DEPTH; depth += 1) {
      directory = join(directory, "nested");
      await mkdir(directory);
    }
    await assert.rejects(
      captureStandaloneOutputIdentity(root, "tree"),
      /cannot exceed 64 nested directories/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone tree identity revalidates files hashed earlier in the inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-standalone-identity-rewrite-"));
  const earlier = join(root, "a.js");
  try {
    await writeFile(earlier, "first\n", "utf8");
    await writeFile(join(root, "z.js"), "last\n", "utf8");
    const inode = (await lstat(earlier)).ino;
    await assert.rejects(captureStandaloneOutputIdentity(root, "tree", {
      afterTreeFileHashed: async (path) => {
        if (path === "a.js") await writeFile(earlier, "author rewrite on original inode\n", "utf8");
      },
    }), /a\.js.*changed physical identity or contents/u);
    assert.equal((await lstat(earlier)).ino, inode);
    assert.equal(await readFile(earlier, "utf8"), "author rewrite on original inode\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
