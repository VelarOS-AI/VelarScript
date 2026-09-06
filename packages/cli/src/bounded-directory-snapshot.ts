import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, opendir, unlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  ChangedOrdinaryFileError,
  type OrdinaryFileSnapshotIdentity,
  readOrdinaryFileSnapshot,
} from "./ordinary-file-snapshot.ts";
import { MAX_PRODUCTION_ASSETS } from "./file-integrity.ts";

const READ_CHUNK_BYTES = 64 * 1024;

export const MAX_PRODUCTION_DIRECTORY_DEPTH = 64;
export const MAX_PRODUCTION_DIRECTORIES = 8_192;
export const MAX_PRODUCTION_DIRECTORY_ENTRIES = MAX_PRODUCTION_ASSETS + MAX_PRODUCTION_DIRECTORIES + 2;
export const MAX_PRODUCTION_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_PRODUCTION_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_PRODUCTION_MANIFEST_BYTES = 64 * 1024 * 1024;
export const MAX_PUBLIC_ASSET_BYTES = 256 * 1024 * 1024;
export const MAX_PUBLIC_ASSET_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

export const productionDirectoryPolicy: BoundedDirectoryPolicy = Object.freeze({
  maximumFiles: MAX_PRODUCTION_ASSETS + 1,
  maximumDirectories: MAX_PRODUCTION_DIRECTORIES,
  maximumEntries: MAX_PRODUCTION_DIRECTORY_ENTRIES,
  maximumDepth: MAX_PRODUCTION_DIRECTORY_DEPTH,
  maximumFileBytes: MAX_PRODUCTION_FILE_BYTES,
  maximumTotalBytes: MAX_PRODUCTION_TOTAL_BYTES,
});

export const publicAssetDirectoryPolicy: BoundedDirectoryPolicy = Object.freeze({
  maximumFiles: MAX_PRODUCTION_ASSETS,
  maximumDirectories: MAX_PRODUCTION_DIRECTORIES,
  maximumEntries: MAX_PRODUCTION_DIRECTORY_ENTRIES,
  maximumDepth: MAX_PRODUCTION_DIRECTORY_DEPTH,
  maximumFileBytes: MAX_PUBLIC_ASSET_BYTES,
  maximumTotalBytes: MAX_PUBLIC_ASSET_TOTAL_BYTES,
});

export interface BoundedDirectoryPolicy {
  readonly maximumFiles: number;
  readonly maximumDirectories: number;
  readonly maximumEntries: number;
  readonly maximumDepth: number;
  readonly maximumFileBytes: number;
  readonly maximumTotalBytes: number;
}

export interface InspectedDirectoryFile {
  readonly absolutePath: string;
  readonly path: string;
  readonly identity: OrdinaryFileSnapshotIdentity;
}

export interface BoundedDirectorySnapshot {
  readonly root: string;
  readonly files: ReadonlyMap<string, InspectedDirectoryFile>;
  readonly directories: ReadonlyMap<string, OrdinaryFileSnapshotIdentity>;
  readonly entries: number;
  readonly totalBytes: number;
}

export interface BoundedDirectoryInspectionOptions {
  readonly ignoredRootNames?: ReadonlySet<string>;
}

export interface BoundedFileInspectionOptions {
  readonly afterPathInspection?: () => Promise<void>;
  readonly afterDescriptorBound?: () => Promise<void>;
}

/** Hashes one pathname only after binding its inventoried identity to a descriptor. */
export async function inspectBoundedFile(
  path: string,
  maximumBytes: number,
  label: string,
  options: BoundedFileInspectionOptions = {},
): Promise<{ readonly identity: OrdinaryFileSnapshotIdentity; readonly sizeBytes: number; readonly sha256: string }> {
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} is not an ordinary file`);
  const file: InspectedDirectoryFile = { absolutePath: path, path, identity: snapshot(metadata) };
  await options.afterPathInspection?.();
  const operations = options.afterDescriptorBound === undefined
    ? {}
    : { afterDescriptorBound: options.afterDescriptorBound };
  return { identity: file.identity, ...await inspectedFileIdentity(file, maximumBytes, label, operations) };
}

/** Streams one directory tree while bounding every dimension that can grow independently. */
export async function inspectBoundedDirectory(
  root: string,
  label: string,
  policy: BoundedDirectoryPolicy,
  options: BoundedDirectoryInspectionOptions = {},
): Promise<BoundedDirectorySnapshot> {
  assertPolicy(policy, label);
  const state = {
    directories: new Map<string, OrdinaryFileSnapshotIdentity>(),
    entries: 0,
    files: new Map<string, InspectedDirectoryFile>(),
    totalBytes: 0,
  };
  await inspectDirectory(root, root, label, policy, options.ignoredRootNames ?? new Set(), state, 0);
  return { root, ...state };
}

async function inspectDirectory(
  root: string,
  directory: string,
  label: string,
  policy: BoundedDirectoryPolicy,
  ignoredRootNames: ReadonlySet<string>,
  state: MutableDirectorySnapshot,
  depth: number,
): Promise<void> {
  if (depth > policy.maximumDepth) {
    throw new RangeError(`${label} cannot exceed ${policy.maximumDepth} nested directories`);
  }
  const displayDirectory = displayPath(root, directory);
  const beforeMetadata = await inspectPath(directory, label, displayDirectory || ".", depth > 0);
  if (!beforeMetadata.isDirectory() || beforeMetadata.isSymbolicLink()) {
    throw new Error(`${label} contains non-directory '${displayDirectory || "."}'`);
  }
  const before = snapshot(beforeMetadata);
  state.directories.set(displayDirectory, before);
  if (state.directories.size - 1 > policy.maximumDirectories) {
    throw new RangeError(`${label} cannot contain more than ${policy.maximumDirectories} directories`);
  }

  let handle: Awaited<ReturnType<typeof opendir>>;
  try {
    handle = await opendir(directory);
  } catch (error) {
    if (isChangedPathError(error)) throw changedPath(label, displayDirectory || ".");
    throw error;
  }
  try {
    while (true) {
      const entry = await handle.read();
      if (entry === null) break;
      state.entries += 1;
      if (state.entries > policy.maximumEntries) {
        throw new RangeError(`${label} cannot contain more than ${policy.maximumEntries} entries`);
      }
      if (directory === root && ignoredRootNames.has(entry.name)) continue;
      const path = join(directory, entry.name);
      const display = displayPath(root, path);
      const metadata = await inspectPath(path, label, display, true);
      if (metadata.isSymbolicLink()) throw new Error(`${label} contains symbolic link '${display}'`);
      if (metadata.isDirectory()) {
        await inspectDirectory(root, path, label, policy, ignoredRootNames, state, depth + 1);
      } else if (metadata.isFile()) {
        inspectFile(path, display, metadata, label, policy, state);
      } else {
        throw new Error(`${label} contains unsupported file '${display}'`);
      }
    }
  } finally {
    await handle.close();
  }
  const afterMetadata = await inspectPath(directory, label, displayDirectory || ".", true);
  if (!afterMetadata.isDirectory() || afterMetadata.isSymbolicLink()
    || !sameSnapshot(before, snapshot(afterMetadata))) {
    throw changedPath(label, displayDirectory || ".");
  }
}

function inspectFile(
  absolutePath: string,
  path: string,
  metadata: BigIntStats,
  label: string,
  policy: BoundedDirectoryPolicy,
  state: MutableDirectorySnapshot,
): void {
  if (metadata.size > BigInt(policy.maximumFileBytes)) {
    throw new RangeError(`${label} file '${path}' exceeds ${policy.maximumFileBytes} bytes`);
  }
  state.totalBytes += Number(metadata.size);
  if (state.totalBytes > policy.maximumTotalBytes) {
    throw new RangeError(`${label} exceeds ${policy.maximumTotalBytes} total file bytes`);
  }
  if (state.files.size >= policy.maximumFiles) {
    throw new RangeError(`${label} cannot contain more than ${policy.maximumFiles} files`);
  }
  state.files.set(path, { absolutePath, path, identity: snapshot(metadata) });
}

/** Rechecks empty directories too, so replacing a path cannot evade file-bound reads. */
export async function assertDirectorySnapshotUnchanged(
  snapshot_: BoundedDirectorySnapshot,
  label: string,
  rootOverride?: string,
): Promise<void> {
  const root = rootOverride === undefined ? snapshot_.root : resolve(rootOverride);
  const relocated = resolve(snapshot_.root) !== resolve(root);
  for (const [path, expected] of snapshot_.directories) {
    const absolute = path === "" ? root : join(root, path);
    let metadata: BigIntStats;
    try {
      metadata = await lstat(absolute, { bigint: true });
    } catch (error) {
      if (isChangedPathError(error)) throw changedPath(label, path || ".");
      throw error;
    }
    const actual = snapshot(metadata);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()
      || !(relocated && path === "" ? sameRelocatedRootSnapshot(expected, actual) : sameSnapshot(expected, actual))) {
      throw changedPath(label, path || ".");
    }
  }
  for (const file of snapshot_.files.values()) {
    const absolute = join(root, file.path);
    let metadata: BigIntStats;
    try {
      metadata = await lstat(absolute, { bigint: true });
    } catch (error) {
      if (isChangedPathError(error)) throw changedPath(label, file.path);
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()
      || !sameSnapshot(file.identity, snapshot(metadata))) {
      throw changedPath(label, file.path);
    }
  }
}

/** Parses bounded JSON only from the exact ordinary file found by the directory inventory. */
export async function readInspectedJson(
  file: InspectedDirectoryFile,
  maximumBytes: number,
  label: string,
): Promise<unknown> {
  const { bytes } = await readOrdinaryFileSnapshot(file.absolutePath, maximumBytes, label, {
    validateOpenedSnapshot: async (identity) => {
      if (!sameSnapshot(identity, file.identity)) throw changedPath(label, file.path);
    },
  });
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

/** Hashes one already-inventoried ordinary file through one unchanged descriptor. */
export async function inspectedFileIdentity(
  file: InspectedDirectoryFile,
  maximumBytes: number,
  label: string,
  operations: { readonly afterDescriptorBound?: () => Promise<void> } = {},
): Promise<{ readonly sizeBytes: number; readonly sha256: string }> {
  if (file.identity.size > BigInt(maximumBytes)) throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(
      file.absolutePath,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameSnapshot(file.identity, snapshot(opened))) throw changedPath(label, file.path);
    await operations.afterDescriptorBound?.();
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      sizeBytes += bytesRead;
      if (sizeBytes > maximumBytes) throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
      hash.update(buffer.subarray(0, bytesRead));
    }
    const [after, pathAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(file.absolutePath, { bigint: true }),
    ]);
    if (!after.isFile() || !pathAfter.isFile() || pathAfter.isSymbolicLink()
      || !sameSnapshot(file.identity, snapshot(after))
      || !sameSnapshot(file.identity, snapshot(pathAfter))
      || after.size !== BigInt(sizeBytes)) {
      throw changedPath(label, file.path);
    }
    return { sizeBytes, sha256: hash.digest("hex") };
  } catch (error) {
    if (error instanceof ChangedOrdinaryFileError) throw error;
    if (isChangedPathError(error)) throw changedPath(label, file.path);
    throw error;
  } finally {
    await handle?.close();
  }
}

/** Copies only the inventoried bytes and removes the destination if source authorization changes. */
export async function copyInspectedFile(
  file: InspectedDirectoryFile,
  destination: string,
  maximumBytes: number,
  label: string,
): Promise<number> {
  if (file.identity.size > BigInt(maximumBytes)) throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
  let source: Awaited<ReturnType<typeof open>> | null = null;
  let output: Awaited<ReturnType<typeof open>> | null = null;
  let created = false;
  try {
    source = await open(
      file.absolutePath,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = await source.stat({ bigint: true });
    if (!opened.isFile() || !sameSnapshot(file.identity, snapshot(opened))) throw changedPath(label, file.path);
    output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o666);
    created = true;
    let sizeBytes = 0;
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      sizeBytes += bytesRead;
      if (sizeBytes > maximumBytes) throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
      await writeAll(output, buffer.subarray(0, bytesRead));
    }
    const [after, pathAfter] = await Promise.all([
      source.stat({ bigint: true }),
      lstat(file.absolutePath, { bigint: true }),
    ]);
    if (!after.isFile() || !pathAfter.isFile() || pathAfter.isSymbolicLink()
      || !sameSnapshot(file.identity, snapshot(after))
      || !sameSnapshot(file.identity, snapshot(pathAfter))
      || after.size !== BigInt(sizeBytes)) {
      throw changedPath(label, file.path);
    }
    return sizeBytes;
  } catch (error) {
    await output?.close().catch(() => undefined);
    output = null;
    if (created) {
      try {
        await unlink(destination);
      } catch (cleanupError) {
        if (!hasHostCode(cleanupError, "ENOENT")) {
          throw new AggregateError([error, cleanupError], `${label} failed and its incomplete destination could not be removed`);
        }
      }
    }
    if (error instanceof ChangedOrdinaryFileError) throw error;
    if (isChangedPathError(error)) throw changedPath(label, file.path);
    throw error;
  } finally {
    await output?.close();
    await source?.close();
  }
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (written.bytesWritten === 0) throw new Error("Cannot make progress while writing a copied file");
    offset += written.bytesWritten;
  }
}

interface MutableDirectorySnapshot {
  readonly files: Map<string, InspectedDirectoryFile>;
  readonly directories: Map<string, OrdinaryFileSnapshotIdentity>;
  entries: number;
  totalBytes: number;
}

function snapshot(metadata: BigIntStats): OrdinaryFileSnapshotIdentity {
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

/** Renaming a directory changes only that directory inode's ctime on supported hosts. */
function sameRelocatedRootSnapshot(
  left: OrdinaryFileSnapshotIdentity,
  right: OrdinaryFileSnapshotIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode && left.size === right.size
    && left.modified === right.modified;
}

function displayPath(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function changedPath(label: string, path: string): ChangedOrdinaryFileError {
  return new ChangedOrdinaryFileError(`${label} path '${path}' changed physical identity or contents while it was inspected`);
}

function isChangedPathError(error: unknown): boolean {
  return hasHostCode(error, "ENOENT") || hasHostCode(error, "ENOTDIR") || hasHostCode(error, "ELOOP");
}

function hasHostCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function inspectPath(
  path: string,
  label: string,
  display: string,
  treatMissingAsChange: boolean,
): Promise<BigIntStats> {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (treatMissingAsChange && isChangedPathError(error)) throw changedPath(label, display);
    throw error;
  }
}

function assertPolicy(policy: BoundedDirectoryPolicy, label: string): void {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} has an invalid ${name} boundary`);
  }
}
