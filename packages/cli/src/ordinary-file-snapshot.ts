import { constants } from "node:fs";
import { lstat, open, stat } from "node:fs/promises";
import { readBoundedFileHandle } from "./bounded-text.ts";
import { isHostErrorCode } from "./host-error.ts";

export interface OrdinaryFileSnapshotIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly size: bigint;
  readonly modified: bigint;
  readonly changed: bigint;
}

export interface OrdinaryFileSnapshot {
  readonly bytes: Buffer;
  readonly identity: OrdinaryFileSnapshotIdentity;
}

export interface OrdinaryFileSnapshotOperations {
  /** Runs after pathname inspection and before descriptor binding. */
  readonly afterPathInspection?: () => Promise<void>;
  /** Preserve callers, such as source readers, that intentionally follow a final symlink. */
  readonly followSymbolicLink?: boolean;
  /** Owner-specific authorization while the descriptor is open and before the final path check. */
  readonly validateOpenedSnapshot?: (identity: OrdinaryFileSnapshotIdentity) => Promise<void>;
}

export class NonOrdinaryFileError extends Error {}
export class ChangedOrdinaryFileError extends Error {}

/** Reads bounded bytes and metadata from one unchanged ordinary-file identity. */
export async function readOrdinaryFileSnapshot(
  path: string,
  maximumBytes: number,
  label: string,
  operations: OrdinaryFileSnapshotOperations = {},
): Promise<OrdinaryFileSnapshot> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let inspected = false;
  try {
    const pathBefore = operations.followSymbolicLink
      ? await stat(path, { bigint: true })
      : await lstat(path, { bigint: true });
    if (!pathBefore.isFile() || (!operations.followSymbolicLink && pathBefore.isSymbolicLink())) {
      throw new NonOrdinaryFileError(`${label} is not an ordinary file`);
    }
    const expected = snapshot(pathBefore);
    inspected = true;
    await operations.afterPathInspection?.();
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK
        | (operations.followSymbolicLink ? 0 : (constants.O_NOFOLLOW ?? 0)),
    );
    const before = snapshot(await handle.stat({ bigint: true }));
    if (!sameSnapshot(expected, before)) throw changedFile(label);
    const bytes = await readBoundedFileHandle(handle, maximumBytes, label);
    const after = snapshot(await handle.stat({ bigint: true }));
    if (!sameSnapshot(before, after)) throw changedFile(label);
    await operations.validateOpenedSnapshot?.(after);
    const pathAfter = operations.followSymbolicLink
      ? await stat(path, { bigint: true })
      : await lstat(path, { bigint: true });
    if (!pathAfter.isFile() || (!operations.followSymbolicLink && pathAfter.isSymbolicLink())
      || !sameSnapshot(after, snapshot(pathAfter))) {
      throw changedFile(label);
    }
    return { bytes, identity: after };
  } catch (error) {
    if (inspected && (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")
      || isHostErrorCode(error, "ELOOP"))) {
      throw changedFile(label);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function snapshot(metadata: {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}): OrdinaryFileSnapshotIdentity {
  return {
    device: metadata.dev,
    inode: metadata.ino,
    size: metadata.size,
    modified: metadata.mtimeNs,
    changed: metadata.ctimeNs,
  };
}

function sameSnapshot(left: OrdinaryFileSnapshotIdentity, right: OrdinaryFileSnapshotIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.size === right.size
    && left.modified === right.modified && left.changed === right.changed;
}

function changedFile(label: string): ChangedOrdinaryFileError {
  return new ChangedOrdinaryFileError(`${label} changed physical identity or contents while it was read`);
}
