import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import {
  assertDirectorySnapshotUnchanged,
  inspectBoundedDirectory,
  inspectedFileIdentity,
  MAX_PRODUCTION_DIRECTORY_ENTRIES,
  MAX_PRODUCTION_DIRECTORY_DEPTH,
  MAX_PRODUCTION_DIRECTORIES,
  MAX_PRODUCTION_FILE_BYTES,
  MAX_PRODUCTION_TOTAL_BYTES,
  productionDirectoryPolicy,
  readInspectedJson,
  type BoundedDirectorySnapshot,
} from "./bounded-directory-snapshot.ts";
import {
  authorizeBuildOutputCommit,
  type BuildOutputCommitAuthorization,
} from "./build-output-commit.ts";
import { BUILD_STAGING_MARKER, writeExclusiveBuildFile } from "./build-staging.ts";
import { buildOutputComparisonPath } from "./build-output-claim.ts";
import { canonicalizePotentialPath } from "./canonical-path.ts";
import { MAX_PRODUCTION_ASSETS } from "./file-integrity.ts";
import { isHostErrorCode } from "./host-error.ts";
import {
  ChangedOrdinaryFileError,
} from "./ordinary-file-snapshot.ts";

export const BUILD_OUTPUT_RECEIPT = ".velar-build-output.json";
export const MAX_BUILD_OUTPUT_RECEIPT_BYTES = 64 * 1024 * 1024;

type BuildOutputInventoryEntry =
  | { readonly path: string; readonly kind: "directory" }
  | { readonly path: string; readonly kind: "file"; readonly sizeBytes: number; readonly sha256: string };

interface BuildOutputReceipt {
  readonly formatVersion: 2;
  readonly kind: "velar-directory-build-output";
  readonly outputDirectory: string;
  readonly comparisonPath: string;
  readonly buildId: string;
  readonly inventory: readonly BuildOutputInventoryEntry[];
}

class InvalidBuildOutputReceiptError extends Error {}

export async function writeBuildOutputReceipt(
  staging: string,
  outputDirectory: string,
): Promise<BuildOutputCommitAuthorization> {
  const canonicalOutput = await canonicalizePotentialPath(outputDirectory);
  const captured = await captureBuildOutputInventory(staging);
  const inventory = captured.inventory;
  await assertDirectorySnapshotUnchanged(captured.snapshot, "Directory build output");
  const receipt: BuildOutputReceipt = {
    formatVersion: 2,
    kind: "velar-directory-build-output",
    outputDirectory: canonicalOutput,
    comparisonPath: buildOutputComparisonPath(canonicalOutput),
    buildId: buildOutputInventoryId(inventory),
    inventory,
  };
  const contents = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_BUILD_OUTPUT_RECEIPT_BYTES) {
    throw new RangeError(`Directory build ownership receipt exceeds ${MAX_BUILD_OUTPUT_RECEIPT_BYTES} bytes`);
  }
  await writeExclusiveBuildFile(
    join(staging, BUILD_OUTPUT_RECEIPT),
    contents,
    `Directory build ownership receipt '${BUILD_OUTPUT_RECEIPT}'`,
  );
  return verifyBuildOutputReceiptForCommit(staging, outputDirectory);
}

/** Authenticates the receipt and every byte in the same snapshot later rechecked by commit. */
export async function verifyBuildOutputReceiptForCommit(
  directory: string,
  expectedOutputDirectory = directory,
): Promise<BuildOutputCommitAuthorization> {
  const root = resolve(directory);
  const expectedComparisonPath = buildOutputComparisonPath(
    await canonicalizePotentialPath(expectedOutputDirectory),
  );
  const snapshot = await inspectBuildOutputReceipt(root, expectedComparisonPath);
  return authorizeBuildOutputCommit(root, snapshot, async (installedDirectory) => {
    await inspectBuildOutputReceipt(resolve(installedDirectory), expectedComparisonPath);
  });
}

async function inspectBuildOutputReceipt(
  root: string,
  expectedComparisonPath: string,
): Promise<BoundedDirectorySnapshot> {
  const snapshot = await inspectBoundedDirectory(root, "Directory build output", productionDirectoryPolicy, {
    ignoredRootNames: new Set([BUILD_STAGING_MARKER]),
  });
  const receiptFile = snapshot.files.get(BUILD_OUTPUT_RECEIPT);
  if (!receiptFile) throw invalidReceipt(root);
  const value = await readInspectedJson(
    receiptFile,
    MAX_BUILD_OUTPUT_RECEIPT_BYTES,
    `Directory build ownership receipt '${receiptFile.absolutePath}'`,
  ) as Partial<BuildOutputReceipt>;
  if (!hasExactKeys(value, ["buildId", "comparisonPath", "formatVersion", "inventory", "kind", "outputDirectory"])
    || value.formatVersion !== 2
    || value.kind !== "velar-directory-build-output"
    || typeof value.outputDirectory !== "string"
    || !isAbsolute(value.outputDirectory)
    || resolve(value.outputDirectory) !== value.outputDirectory
    || typeof value.comparisonPath !== "string"
    || value.comparisonPath !== buildOutputComparisonPath(value.outputDirectory)
    || value.comparisonPath !== expectedComparisonPath
    || typeof value.buildId !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.buildId)
    || !validBuildOutputInventory(value.inventory)) throw invalidReceipt(root);
  const inventory = await inventoryFromSnapshot(snapshot, new Set([BUILD_OUTPUT_RECEIPT]));
  if (JSON.stringify(value.inventory) !== JSON.stringify(inventory)
    || value.buildId !== buildOutputInventoryId(inventory)) throw invalidReceipt(root);
  await assertDirectorySnapshotUnchanged(snapshot, "Directory build output");
  return snapshot;
}

export async function hasBuildOutputReceipt(
  directory: string,
  expectedOutputDirectory = directory,
): Promise<boolean> {
  try {
    await verifyBuildOutputReceiptForCommit(directory, expectedOutputDirectory);
    return true;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR") || error instanceof SyntaxError
      || error instanceof InvalidBuildOutputReceiptError || error instanceof ChangedOrdinaryFileError) return false;
    throw error;
  }
}

async function captureBuildOutputInventory(
  root: string,
): Promise<{ readonly inventory: BuildOutputInventoryEntry[]; readonly snapshot: BoundedDirectorySnapshot }> {
  const snapshot = await inspectBoundedDirectory(root, "Directory build output", productionDirectoryPolicy, {
    ignoredRootNames: new Set([BUILD_OUTPUT_RECEIPT, BUILD_STAGING_MARKER]),
  });
  const inventory = await inventoryFromSnapshot(snapshot);
  return { inventory, snapshot };
}

async function inventoryFromSnapshot(
  snapshot: BoundedDirectorySnapshot,
  ignoredFiles: ReadonlySet<string> = new Set(),
): Promise<BuildOutputInventoryEntry[]> {
  const inventory: BuildOutputInventoryEntry[] = [...snapshot.directories.keys()]
    .filter((path) => path !== "")
    .map((path) => ({ path, kind: "directory" }));
  const files = [...snapshot.files.values()]
    .filter((file) => !ignoredFiles.has(file.path))
    .sort((left, right) => comparePath(left.path, right.path));
  for (const file of files) {
    inventory.push({
      path: file.path,
      kind: "file",
      ...await inspectedFileIdentity(file, MAX_PRODUCTION_FILE_BYTES, `Directory build output file '${file.path}'`),
    });
  }
  return inventory.sort((left, right) => comparePath(left.path, right.path));
}

function validBuildOutputInventory(value: unknown): value is readonly BuildOutputInventoryEntry[] {
  if (!Array.isArray(value) || value.length > MAX_PRODUCTION_DIRECTORY_ENTRIES) return false;
  let previous = "";
  let directories = 0;
  let files = 0;
  let totalBytes = 0;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const candidate = entry as Record<string, unknown>;
    if (!hasExactKeys(candidate, candidate.kind === "directory"
      ? ["kind", "path"]
      : ["kind", "path", "sha256", "sizeBytes"])) return false;
    if (!safeInventoryPath(candidate.path) || candidate.path <= previous) return false;
    previous = candidate.path;
    if (candidate.kind === "directory") {
      directories += 1;
      if (directories > MAX_PRODUCTION_DIRECTORIES
        || (candidate.path as string).split("/").length > MAX_PRODUCTION_DIRECTORY_DEPTH) return false;
      continue;
    }
    if (candidate.kind !== "file" || !Number.isSafeInteger(candidate.sizeBytes)
      || (candidate.sizeBytes as number) < 0 || (candidate.sizeBytes as number) > MAX_PRODUCTION_FILE_BYTES
      || typeof candidate.sha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(candidate.sha256)) return false;
    files += 1;
    totalBytes += candidate.sizeBytes as number;
    if (files > MAX_PRODUCTION_ASSETS + 1 || totalBytes > MAX_PRODUCTION_TOTAL_BYTES) return false;
  }
  return true;
}

function safeInventoryPath(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || isAbsolute(value) || value.includes("\\")) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function buildOutputInventoryId(inventory: readonly BuildOutputInventoryEntry[]): string {
  return createHash("sha256").update(JSON.stringify(inventory)).digest("hex");
}

function invalidReceipt(directory: string): InvalidBuildOutputReceiptError {
  return new InvalidBuildOutputReceiptError(`Directory build output '${directory}' has an invalid ownership receipt`);
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}
