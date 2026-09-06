import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertDirectorySnapshotUnchanged,
  copyInspectedFile,
  MAX_PRODUCTION_FILE_BYTES,
  type BoundedDirectorySnapshot,
} from "./bounded-directory-snapshot.ts";

/** Copies only files and directories authenticated by a bounded source snapshot. */
export async function copyReproductionSnapshot(
  snapshot: BoundedDirectorySnapshot,
  destination: string,
): Promise<void> {
  await assertDirectorySnapshotUnchanged(snapshot, "Previous reproduction directory");
  await mkdir(destination, { mode: 0o700 });
  const directories = [...snapshot.directories.keys()].filter((path) => path !== "").sort(compareTreePath);
  for (const directory of directories) await mkdir(join(destination, directory));
  let copiedBytes = 0;
  const files = [...snapshot.files.values()].sort((left, right) => comparePath(left.path, right.path));
  for (const file of files) {
    const output = join(destination, file.path);
    await mkdir(dirname(output), { recursive: true });
    copiedBytes += await copyInspectedFile(
      file,
      output,
      MAX_PRODUCTION_FILE_BYTES,
      `Previous reproduction file '${file.path}'`,
    );
  }
  if (copiedBytes !== snapshot.totalBytes) {
    throw new Error("Previous reproduction changed total size while its recovery copy was written");
  }
  await assertDirectorySnapshotUnchanged(snapshot, "Previous reproduction directory");
}

function compareTreePath(left: string, right: string): number {
  const depth = pathDepth(left) - pathDepth(right);
  return depth === 0 ? comparePath(left, right) : depth;
}

function pathDepth(path: string): number {
  return path.split("/").length;
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
