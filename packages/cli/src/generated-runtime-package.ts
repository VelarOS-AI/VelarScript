import { createHash } from "node:crypto";
import type { BigIntStats, Dirent } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { readBoundedFileHandle } from "./bounded-text.ts";
import { writeExclusiveBuildFile } from "./build-staging.ts";
import { isHostErrorCode } from "./host-error.ts";
import { NPM_PACKAGE_NAME } from "./package-name.ts";
import { byCodeUnit } from "./stable-order.ts";

export const VELAR_GENERATED_RUNTIME_PACKAGE_VERSION = 1;
export const GENERATED_RUNTIME_PACKAGE_RECEIPT = ".velar-runtime-package.json";
const MAX_GENERATED_RUNTIME_MANIFEST_BYTES = 1024 * 1024;
const MAX_GENERATED_RUNTIME_RECEIPT_BYTES = 8 * 1024 * 1024;
const MAX_GENERATED_RUNTIME_PACKAGE_ENTRIES = 16_384;
const MAX_GENERATED_RUNTIME_FILE_BYTES = 64 * 1024 * 1024;
const MAX_GENERATED_RUNTIME_PACKAGE_BYTES = 256 * 1024 * 1024;

export type GeneratedRuntimePackageOwnership =
  | { readonly kind: "absent" }
  | { readonly kind: "foreign" }
  | { readonly kind: "legacy"; readonly standaloneOwner: string | null }
  | { readonly kind: "generated"; readonly standaloneOwner: string | null };

type GeneratedRuntimeInventoryEntry =
  | {readonly path: string; readonly kind: "directory"}
  | {readonly path: string; readonly kind: "file"; readonly sizeBytes: number; readonly sha256: string};

interface GeneratedRuntimePackageReceipt {
  readonly formatVersion: 1;
  readonly kind: "velar-generated-runtime-package";
  readonly packageName: string;
  readonly standaloneOwner: string | null;
  readonly inventory: readonly GeneratedRuntimeInventoryEntry[];
}

/** Returns the exact npm package represented by a direct node_modules member. */
export function generatedRuntimePackageName(nodeModulesRoot: string, candidate: string): string | null {
  const fromRoot = relative(nodeModulesRoot, candidate);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
  const parts = fromRoot.split(sep);
  const name = parts[0]?.startsWith("@") && parts.length === 2
    ? `${parts[0]}/${parts[1]}`
    : parts.length === 1 ? parts[0]! : "";
  return NPM_PACKAGE_NAME.test(name) ? name : null;
}

/** Writes the content-bound authorization consumed by later replace/cleanup operations. */
export async function writeGeneratedRuntimePackageReceipt(
  root: string,
  packageName: string,
  standaloneOwner: string | null,
): Promise<void> {
  const rootIdentity = await runtimePackageRootIdentity(root);
  if (rootIdentity === null) throw new Error(`Generated runtime package '${root}' is not an ordinary directory`);
  const manifest = await runtimePackageManifest(root, packageName);
  if (manifest === null || manifest.standaloneOwner !== standaloneOwner) {
    throw new Error(`Generated runtime package '${root}' has an invalid package manifest`);
  }
  const inventory = await runtimePackageInventory(root);
  const beforeReceipt = await lstat(root, {bigint: true});
  if (!sameFileIdentity(rootIdentity, beforeReceipt) || !sameFileSnapshot(rootIdentity, beforeReceipt)) {
    throw new Error(`Generated runtime package '${root}' changed before its receipt was written`);
  }
  const receipt: GeneratedRuntimePackageReceipt = {
    formatVersion: 1,
    kind: "velar-generated-runtime-package",
    packageName,
    standaloneOwner,
    inventory,
  };
  const contents = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_GENERATED_RUNTIME_RECEIPT_BYTES) {
    throw new RangeError(`Generated runtime package receipt '${root}' exceeds ${MAX_GENERATED_RUNTIME_RECEIPT_BYTES} bytes`);
  }
  await writeExclusiveBuildFile(
    join(root, GENERATED_RUNTIME_PACKAGE_RECEIPT),
    contents,
    `Generated runtime package receipt '${packageName}'`,
  );
  const afterReceipt = await lstat(root, {bigint: true});
  if (!sameFileIdentity(rootIdentity, afterReceipt)) {
    throw new Error(`Generated runtime package '${root}' changed while its receipt was written`);
  }
}

/** Authorizes a runtime tree only when its complete current inventory matches its receipt. */
export async function generatedRuntimePackageOwnership(
  root: string,
  expectedName = "velar",
): Promise<GeneratedRuntimePackageOwnership> {
  const rootIdentity = await runtimePackageRootIdentity(root);
  if (rootIdentity === null) return await pathMissing(root) ? {kind: "absent"} : {kind: "foreign"};
  try {
    const receiptSnapshot = await readOrdinaryBoundedFile(
      join(root, GENERATED_RUNTIME_PACKAGE_RECEIPT),
      MAX_GENERATED_RUNTIME_RECEIPT_BYTES,
      `Generated runtime package receipt '${root}'`,
    );
    const manifest = await runtimePackageManifest(root, expectedName);
    if (receiptSnapshot === null) {
      return manifest === null || !await sameRuntimePackageRoot(root, rootIdentity)
        ? {kind: "foreign"}
        : {kind: "legacy", standaloneOwner: manifest.standaloneOwner};
    }
    const receipt = parsedRuntimePackageReceipt(receiptSnapshot.contents, expectedName);
    if (receipt === null || manifest === null || manifest.standaloneOwner !== receipt.standaloneOwner) {
      return {kind: "foreign"};
    }
    const inventory = await runtimePackageInventory(root);
    if (JSON.stringify(inventory) !== JSON.stringify(receipt.inventory)
      || !await sameRuntimePackageRoot(root, rootIdentity)) return {kind: "foreign"};
    return {kind: "generated", standaloneOwner: receipt.standaloneOwner};
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")
      || error instanceof SyntaxError) return {kind: "foreign"};
    throw error;
  }
}

async function runtimePackageRootIdentity(root: string): Promise<BigIntStats | null> {
  try {
    const metadata = await lstat(root, {bigint: true});
    return metadata.isDirectory() && !metadata.isSymbolicLink() ? metadata : null;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
    throw error;
  }
}

async function sameRuntimePackageRoot(root: string, expected: FileIdentity): Promise<boolean> {
  const current = await runtimePackageRootIdentity(root);
  return current !== null && sameFileIdentity(current, expected) && sameFileSnapshot(current, expected);
}

async function pathMissing(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return true;
    throw error;
  }
}

async function runtimePackageManifest(
  root: string,
  expectedName: string,
): Promise<{readonly standaloneOwner: string | null} | null> {
  const snapshot = await readOrdinaryBoundedFile(
    join(root, "package.json"),
    MAX_GENERATED_RUNTIME_MANIFEST_BYTES,
    `Generated runtime package manifest '${join(root, "package.json")}'`,
  );
  if (snapshot === null) return null;
  const value = JSON.parse(snapshot.contents.toString("utf8")) as Record<string, unknown>;
  if (value.name !== expectedName || value.private !== true || value.type !== "module"
    || value.velarGeneratedRuntime !== VELAR_GENERATED_RUNTIME_PACKAGE_VERSION) return null;
  if (value.velarStandaloneOwner === undefined) return {standaloneOwner: null};
  return typeof value.velarStandaloneOwner === "string" && value.velarStandaloneOwner !== ""
    && basename(value.velarStandaloneOwner) === value.velarStandaloneOwner
    ? {standaloneOwner: value.velarStandaloneOwner}
    : null;
}

function parsedRuntimePackageReceipt(
  contents: Buffer,
  expectedName: string,
): GeneratedRuntimePackageReceipt | null {
  const value = JSON.parse(contents.toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  if (Object.keys(receipt).sort().join("\0") !== "formatVersion\0inventory\0kind\0packageName\0standaloneOwner"
    || receipt.formatVersion !== 1 || receipt.kind !== "velar-generated-runtime-package"
    || receipt.packageName !== expectedName || !validStandaloneOwner(receipt.standaloneOwner)
    || !validRuntimePackageInventory(receipt.inventory)) return null;
  return receipt as unknown as GeneratedRuntimePackageReceipt;
}

function validStandaloneOwner(value: unknown): value is string | null {
  return value === null || typeof value === "string" && value !== "" && basename(value) === value;
}

function validRuntimePackageInventory(value: unknown): value is readonly GeneratedRuntimeInventoryEntry[] {
  if (!Array.isArray(value) || value.length > MAX_GENERATED_RUNTIME_PACKAGE_ENTRIES) return false;
  let previous = "";
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const candidate = entry as Record<string, unknown>;
    const keys = Object.keys(candidate).sort().join("\0");
    if (typeof candidate.path !== "string" || !safeInventoryPath(candidate.path)
      || candidate.path <= previous || candidate.path === GENERATED_RUNTIME_PACKAGE_RECEIPT) return false;
    previous = candidate.path;
    if (candidate.kind === "directory" && keys === "kind\0path") continue;
    if (candidate.kind !== "file" || keys !== "kind\0path\0sha256\0sizeBytes"
      || !Number.isSafeInteger(candidate.sizeBytes) || (candidate.sizeBytes as number) < 0
      || typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(candidate.sha256)) return false;
  }
  return true;
}

function safeInventoryPath(path: string): boolean {
  return !isAbsolute(path) && !path.includes("\\")
    && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

async function runtimePackageInventory(root: string): Promise<GeneratedRuntimeInventoryEntry[]> {
  const inventory: GeneratedRuntimeInventoryEntry[] = [];
  let totalBytes = 0;
  let discoveredEntries = 0;
  const visit = async (directory: string): Promise<void> => {
    const beforeDirectory = await lstat(directory, {bigint: true});
    if (!beforeDirectory.isDirectory() || beforeDirectory.isSymbolicLink()) {
      throw new Error(`Generated runtime package contains non-directory '${directory}'`);
    }
    const entries: Dirent[] = [];
    for await (const entry of await opendir(directory)) {
      if (directory === root && entry.name === GENERATED_RUNTIME_PACKAGE_RECEIPT) continue;
      if (discoveredEntries >= MAX_GENERATED_RUNTIME_PACKAGE_ENTRIES) {
        throw new RangeError(`Generated runtime package cannot contain more than ${MAX_GENERATED_RUNTIME_PACKAGE_ENTRIES} entries`);
      }
      discoveredEntries += 1;
      entries.push(entry);
    }
    entries.sort((left, right) => byCodeUnit(left.name, right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const display = relative(root, path).replaceAll("\\", "/");
      const metadata = await lstat(path, {bigint: true});
      if (metadata.isSymbolicLink()) throw new Error(`Generated runtime package contains symbolic link '${display}'`);
      if (metadata.isDirectory()) {
        inventory.push({path: display, kind: "directory"});
        await visit(path);
      } else if (metadata.isFile()) {
        const identity = await boundedFileIdentity(path, metadata, MAX_GENERATED_RUNTIME_PACKAGE_BYTES - totalBytes);
        totalBytes += identity.sizeBytes;
        inventory.push({path: display, kind: "file", ...identity});
      } else throw new Error(`Generated runtime package contains unsupported entry '${display}'`);
    }
    const afterDirectory = await lstat(directory, {bigint: true});
    if (!sameFileIdentity(beforeDirectory, afterDirectory) || !sameFileSnapshot(beforeDirectory, afterDirectory)) {
      throw new Error(`Generated runtime package directory '${directory}' changed while it was inspected`);
    }
  };
  await visit(root);
  return inventory.sort((left, right) => byCodeUnit(left.path, right.path));
}

async function boundedFileIdentity(
  path: string,
  before: BigIntStats,
  remainingPackageBytes: number,
): Promise<{readonly sizeBytes: number; readonly sha256: string}> {
  if (before.size > BigInt(MAX_GENERATED_RUNTIME_FILE_BYTES)
    || before.size > BigInt(Math.max(0, remainingPackageBytes))) {
    throw new RangeError(`Generated runtime package file '${path}' exceeds its byte boundary`);
  }
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat({bigint: true});
    if (!opened.isFile() || !sameFileIdentity(before, opened) || !sameFileSnapshot(before, opened)) {
      throw new Error(`Generated runtime package file '${path}' changed before it was read`);
    }
    const hash = createHash("sha256");
    let sizeBytes = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      const {bytesRead} = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      sizeBytes += bytesRead;
      if (sizeBytes > MAX_GENERATED_RUNTIME_FILE_BYTES || sizeBytes > remainingPackageBytes) {
        throw new RangeError(`Generated runtime package file '${path}' exceeds its byte boundary`);
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
    const [after, afterPath] = await Promise.all([
      handle.stat({bigint: true}),
      lstat(path, {bigint: true}),
    ]);
    if (!after.isFile() || !afterPath.isFile() || afterPath.isSymbolicLink()
      || !sameFileIdentity(opened, after) || !sameFileIdentity(opened, afterPath)
      || !sameFileSnapshot(opened, after) || !sameFileSnapshot(opened, afterPath)
      || after.size !== BigInt(sizeBytes)) {
      throw new Error(`Generated runtime package file '${path}' changed while it was read`);
    }
    return {sizeBytes, sha256: hash.digest("hex")};
  } finally {
    await handle.close();
  }
}

async function readOrdinaryBoundedFile(
  path: string,
  maximumBytes: number,
  label: string,
): Promise<{readonly contents: Buffer} | null> {
  let before: BigIntStats;
  try {
    before = await lstat(path, {bigint: true});
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink()) return null;
  if (before.size > BigInt(maximumBytes)) throw new RangeError(`${label} exceeds ${maximumBytes} bytes`);
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat({bigint: true});
    if (!opened.isFile() || !sameFileIdentity(before, opened) || !sameFileSnapshot(before, opened)) return null;
    const contents = await readBoundedFileHandle(handle, maximumBytes, label);
    const [after, afterPath] = await Promise.all([handle.stat({bigint: true}), lstat(path, {bigint: true})]);
    if (!after.isFile() || !afterPath.isFile() || afterPath.isSymbolicLink()
      || !sameFileIdentity(opened, after) || !sameFileIdentity(opened, afterPath)
      || !sameFileSnapshot(opened, after) || !sameFileSnapshot(opened, afterPath)
      || after.size !== BigInt(contents.byteLength)) return null;
    return {contents};
  } finally {
    await handle.close();
  }
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileSnapshot(left: FileIdentity, right: FileIdentity): boolean {
  return left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

export function assertStandaloneRuntimeOwner(
  root: string,
  ownership: GeneratedRuntimePackageOwnership,
  requestedOwner: string,
): void {
  if (ownership.kind === "absent") return;
  if (ownership.kind === "foreign") throw new Error(`Refusing to replace non-generated package '${root}'`);
  if (ownership.kind === "legacy") {
    if (ownership.standaloneOwner === null) {
      throw new Error(
        `Refusing to replace legacy generated package '${root}' because it has no standalone output owner; `
        + `use a separate output directory or remove that package explicitly before rebuilding '${requestedOwner}'`,
      );
    }
    throw new Error(
      `Refusing to replace legacy generated package '${root}' because it has no content-bound receipt; `
      + `remove that package explicitly before rebuilding '${requestedOwner}'`,
    );
  }
  if (ownership.standaloneOwner === null) {
    throw new Error(
      `Refusing to replace legacy generated package '${root}' because it has no standalone output owner; `
      + `use a separate output directory or remove that package explicitly before rebuilding '${requestedOwner}'`,
    );
  }
  if (ownership.standaloneOwner !== requestedOwner) {
    throw new Error(
      `Refusing to replace runtime package '${root}' owned by standalone output '${ownership.standaloneOwner}'; `
      + `build '${requestedOwner}' in a separate output directory`,
    );
  }
}
