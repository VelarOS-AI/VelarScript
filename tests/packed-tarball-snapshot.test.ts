import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { packedTarballFileReader } from "./package-contract.ts";

test("a packed reader serves every member from one stable authorized tarball snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-packed-snapshot-"));
  try {
    const first = await writeArchive(root, "first", { "one.txt": "first-one", "two.txt": "first-two" });
    const second = await writeArchive(root, "second", { "one.txt": "second-one", "two.txt": "second-two" });
    const read = packedTarballFileReader(first);
    assert.equal(Buffer.from(await read("one.txt")).toString("utf8"), "first-one");
    await copyFile(second, first);
    assert.equal(Buffer.from(await read("two.txt")).toString("utf8"), "first-two");
    read.releaseSnapshot?.();
    assert.equal(Buffer.from(await read("one.txt")).toString("utf8"), "second-one", "release must discard the retained archive bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a packed reader rejects a symbolic-link archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-packed-symlink-"));
  try {
    const archive = await writeArchive(root, "ordinary", { "entry.txt": "value" });
    const link = join(root, "linked.tgz");
    await symlink(archive, link);
    await assert.rejects(packedTarballFileReader(link)("entry.txt"), /must be an ordinary file/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a packed reader rejects a symbolic-link member", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-packed-member-"));
  try {
    const source = join(root, "linked", "package");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "target.txt"), "value", "utf8");
    await symlink("target.txt", join(source, "entry.txt"));
    const archive = join(root, "linked.tgz");
    const packed = spawnSync("tar", ["-czf", archive, "-C", join(root, "linked"), "package"], { encoding: "utf8" });
    assert.equal(packed.status, 0, packed.stderr);
    await assert.rejects(packedTarballFileReader(archive)("entry.txt"), /must name one ordinary tarball file/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeArchive(
  root: string,
  name: string,
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const source = join(root, name, "package");
  await mkdir(source, { recursive: true });
  for (const [path, contents] of Object.entries(files)) await writeFile(join(source, path), contents, "utf8");
  const archive = join(root, `${name}.tgz`);
  const packed = spawnSync("tar", ["-czf", archive, "-C", join(root, name), "package"], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  return archive;
}
