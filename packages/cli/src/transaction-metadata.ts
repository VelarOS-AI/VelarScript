import { constants, type BigIntStats, type Dirent } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { readBoundedFileHandle } from "./bounded-text.ts";
import { isHostErrorCode } from "./host-error.ts";

export const TRANSACTION_JSON_MAX_BYTES = 64 * 1024;
export const TRANSACTION_CANDIDATE_LIMIT = 128;

export interface TransactionFileIdentity {
  readonly device: number;
  readonly inode: number;
}

export interface TransactionFileSnapshot {
  readonly contents: string;
  readonly identity: TransactionFileIdentity;
  readonly links: number;
}

/** Test seam for replacing a path after its descriptor has been bound. */
export interface TransactionFileReadOperations {
  /** Runs after pathname inspection and before the descriptor is opened. */
  readonly beforeDescriptorOpen?: () => Promise<void>;
  readonly afterDescriptorBound?: () => Promise<void>;
}

/**
 * Reads transaction evidence through one descriptor and accepts it only while
 * the path, descriptor, size, and mutation timestamps describe one unchanged
 * ordinary file. Oversized files fail instead of being treated as inert JSON.
 */
export async function readTransactionFile(
  path: string,
  label: string,
  maximumBytes = TRANSACTION_JSON_MAX_BYTES,
  operations: TransactionFileReadOperations = {},
): Promise<TransactionFileSnapshot | null> {
  try {
    const pathBefore = await lstat(path, { bigint: true });
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) return null;
    await operations.beforeDescriptorOpen?.();
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const descriptorBefore = await handle.stat({ bigint: true });
      if (!sameFileVersion(pathBefore, descriptorBefore)) return null;
      await operations.afterDescriptorBound?.();
      const contents = (await readBoundedFileHandle(handle, maximumBytes, label)).toString("utf8");
      const descriptorAfter = await handle.stat({ bigint: true });
      const pathAfter = await lstat(path, { bigint: true });
      if (!pathAfter.isFile() || pathAfter.isSymbolicLink()
        || !sameFileVersion(descriptorBefore, descriptorAfter)
        || !sameFileVersion(descriptorAfter, pathAfter)) return null;
      return {
        contents,
        identity: safeIdentity(descriptorAfter, label),
        links: safeNumber(descriptorAfter.nlink, label, "link count"),
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")
      || isHostErrorCode(error, "ELOOP")) return null;
    throw error;
  }
}

/** Collects only matching transaction candidates and stops at a fixed bound. */
export async function scanTransactionCandidates(
  directory: string,
  accepts: (entry: Dirent) => boolean,
  label: string,
  maximumCandidates = TRANSACTION_CANDIDATE_LIMIT,
): Promise<Dirent[]> {
  if (!Number.isSafeInteger(maximumCandidates) || maximumCandidates < 0) {
    throw new RangeError(`${label} has an invalid candidate limit`);
  }
  const handle = await opendir(directory);
  const matches: Dirent[] = [];
  try {
    while (true) {
      const entry = await handle.read();
      if (entry === null) return matches;
      if (!accepts(entry)) continue;
      if (matches.length === maximumCandidates) {
        throw new Error(`${label} exceeds ${maximumCandidates} candidates`);
      }
      matches.push(entry);
    }
  } finally {
    await handle.close();
  }
}

export async function directoryIsEmpty(directory: string): Promise<boolean> {
  const handle = await opendir(directory);
  try {
    return await handle.read() === null;
  } finally {
    await handle.close();
  }
}

export function sameTransactionFileIdentity(
  left: TransactionFileIdentity,
  right: TransactionFileIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function sameFileVersion(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function safeIdentity(metadata: BigIntStats, label: string): TransactionFileIdentity {
  return {
    device: safeNumber(metadata.dev, label, "device"),
    inode: safeNumber(metadata.ino, label, "inode"),
  };
}

function safeNumber(value: bigint, label: string, field: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0) {
    throw new Error(`${label} has an unsafe ${field}`);
  }
  return converted;
}
