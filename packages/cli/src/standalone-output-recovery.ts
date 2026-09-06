import { createHash } from "node:crypto";
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { BuildOutputClaim } from "./build-input-boundary.ts";
import {
  assertDirectorySnapshotUnchanged,
  inspectBoundedDirectory,
  inspectBoundedFile,
  inspectedFileIdentity,
  MAX_PRODUCTION_FILE_BYTES,
  productionDirectoryPolicy,
} from "./bounded-directory-snapshot.ts";
import {
  assertStandaloneRuntimeOwner,
  generatedRuntimePackageName,
  generatedRuntimePackageOwnership,
} from "./generated-runtime-package.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import type { OrdinaryFileSnapshotIdentity } from "./ordinary-file-snapshot.ts";
import {
  readStandaloneConfigurationOwner,
  standaloneFileOwnedByRole,
  standaloneFileRole,
  type StandaloneConfigurationIdentity,
} from "./standalone-output-ownership.ts";

export interface StandaloneOutputIdentity {
  readonly device: string;
  readonly inode: string;
  readonly kind: BuildOutputClaim["kind"];
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface StandaloneJournalOperation {
  readonly target: string;
  readonly staged: string | null;
  readonly backup: string | null;
  readonly kind: BuildOutputClaim["kind"];
  readonly hadPrevious: boolean;
  readonly stagedIdentity: StandaloneOutputIdentity | null;
  readonly previousIdentity: StandaloneOutputIdentity | null;
}

export interface AppliedStandaloneOperation {
  readonly targetPath: string;
  readonly backupPath: string | null;
  readonly kind: BuildOutputClaim["kind"];
  readonly installed: boolean;
  readonly stagedIdentity: StandaloneOutputIdentity | null;
  readonly previousIdentity: StandaloneOutputIdentity | null;
}

type RecoveryAction =
  | { readonly kind: "none" }
  | { readonly kind: "remove-installed"; readonly target: string }
  | { readonly kind: "restore-backup"; readonly target: string; readonly backup: string; readonly removeInstalled: boolean };

type IdentityInventoryEntry =
  | { readonly path: string; readonly kind: "directory" }
  | { readonly path: string; readonly kind: "file"; readonly sizeBytes: number; readonly sha256: string };

export class StandaloneRestoreError extends Error {}

export interface StandaloneIdentityCaptureOperations {
  readonly afterPathInspection?: () => Promise<void>;
  readonly afterDescriptorBound?: () => Promise<void>;
  readonly afterTreeFileHashed?: (path: string, index: number) => Promise<void>;
}

export async function captureStandaloneOutputIdentity(
  path: string,
  kind: BuildOutputClaim["kind"],
  operations: StandaloneIdentityCaptureOperations = {},
): Promise<StandaloneOutputIdentity> {
  const captured = kind === "file"
    ? await inspectBoundedFile(
      path,
      MAX_PRODUCTION_FILE_BYTES,
      `Standalone output '${path}'`,
      {
        ...(operations.afterPathInspection === undefined ? {} : { afterPathInspection: operations.afterPathInspection }),
        ...(operations.afterDescriptorBound === undefined ? {} : { afterDescriptorBound: operations.afterDescriptorBound }),
      },
    )
    : await treeIdentity(path, operations);
  return {
    device: captured.identity.device.toString(),
    inode: captured.identity.inode.toString(),
    kind,
    sizeBytes: captured.sizeBytes,
    sha256: captured.sha256,
  };
}

export async function captureStandaloneOutputIdentityIfPresent(
  path: string,
  kind: BuildOutputClaim["kind"],
): Promise<StandaloneOutputIdentity | null> {
  try {
    return await captureStandaloneOutputIdentity(path, kind);
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
    throw error;
  }
}

export function isStandaloneOutputIdentity(
  value: unknown,
  kind: BuildOutputClaim["kind"],
): value is StandaloneOutputIdentity {
  if (!hasExactKeys(value, ["device", "inode", "kind", "sha256", "sizeBytes"])) return false;
  return value.kind === kind
    && decimalIdentity(value.device, true)
    && decimalIdentity(value.inode, false)
    && Number.isSafeInteger(value.sizeBytes)
    && (value.sizeBytes as number) >= 0
    && typeof value.sha256 === "string"
    && /^[a-f0-9]{64}$/u.test(value.sha256);
}

export function sameStandaloneOutputIdentity(
  left: StandaloneOutputIdentity,
  right: StandaloneOutputIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode && left.kind === right.kind
    && left.sizeBytes === right.sizeBytes && left.sha256 === right.sha256;
}

export async function assertCurrentStandaloneOutputIdentity(
  path: string,
  expected: StandaloneOutputIdentity,
  label: string,
): Promise<void> {
  const actual = await captureStandaloneOutputIdentityIfPresent(path, expected.kind);
  if (actual === null || !sameStandaloneOutputIdentity(actual, expected)) {
    throw new Error(`${label} '${path}' changed before the standalone transaction could mutate it`);
  }
}

export async function assertAuthorizedStandaloneJournalOperations(
  staging: string,
  outputPath: string,
  operations: readonly StandaloneJournalOperation[],
  completeOperations: readonly StandaloneJournalOperation[] = operations,
): Promise<void> {
  const outputRoot = dirname(outputPath);
  const runtimeRoot = resolve(outputRoot, "node_modules");
  const runtimeOwner = basename(outputPath);
  const targets = new Set(completeOperations.map((operation) => resolve(outputRoot, operation.target)));
  const configurationOwners = await transactionConfigurationOwners(staging, outputPath, completeOperations);
  for (const operation of operations) {
    const target = resolve(outputRoot, operation.target);
    const candidates = [
      target,
      ...(operation.staged === null ? [] : [resolve(staging, operation.staged)]),
      ...(operation.backup === null ? [] : [resolve(staging, operation.backup)]),
    ];
    const existingCandidates: string[] = [];
    for (const candidate of candidates) if (await pathExists(candidate)) existingCandidates.push(candidate);
    if (existingCandidates.length === 0) {
      throw new Error(`Standalone transaction target '${target}' has no recoverable ownership evidence`);
    }
    const runtimePackageName = generatedRuntimePackageName(runtimeRoot, target);
    if (runtimePackageName !== null) {
      if (operation.kind !== "tree") refuseJournalTarget(target);
      for (const candidate of existingCandidates) {
        assertStandaloneRuntimeOwner(
          candidate,
          await generatedRuntimePackageOwnership(candidate, runtimePackageName),
          runtimeOwner,
        );
      }
      continue;
    }
    const role = standaloneFileRole(outputPath, target);
    if (operation.kind !== "file" || role === null) refuseJournalTarget(target);
    if (role.kind === "source-map" && role.owner !== runtimeOwner
      && !targets.has(resolve(outputRoot, role.owner))) {
      throw new Error(`Standalone transaction source map '${target}' has no embedded JavaScript operation`);
    }
    for (const candidate of existingCandidates) {
      if (!await standaloneFileOwnedByRole(candidate, role, configurationOwners)) {
        throw new Error(`Standalone transaction file '${candidate}' has no valid owner link to '${runtimeOwner}'`);
      }
    }
  }
}

async function transactionConfigurationOwners(
  staging: string,
  outputPath: string,
  operations: readonly StandaloneJournalOperation[],
): Promise<readonly StandaloneConfigurationIdentity[]> {
  const outputRoot = dirname(outputPath);
  const owner = operations.find((operation) => resolve(outputRoot, operation.target) === resolve(outputPath));
  if (!owner) return [];
  const candidates = [
    outputPath,
    ...(owner.staged === null ? [] : [resolve(staging, owner.staged)]),
    ...(owner.backup === null ? [] : [resolve(staging, owner.backup)]),
  ];
  const configurations: StandaloneConfigurationIdentity[] = [];
  for (const candidate of candidates) {
    const configuration = await readStandaloneConfigurationOwner(candidate, outputPath);
    if (configuration !== null && !configurations.some((item) =>
      item.file === configuration.file && item.sizeBytes === configuration.sizeBytes
      && item.sha256 === configuration.sha256)) configurations.push(configuration);
  }
  return configurations;
}

export async function restoreAppliedStandaloneOperations(
  operations: readonly AppliedStandaloneOperation[],
): Promise<void> {
  try {
    for (const operation of [...operations].reverse()) await validateAppliedOperation(operation);
    for (const operation of [...operations].reverse()) {
      await validateAppliedOperation(operation);
      if (operation.installed) await rm(operation.targetPath, { recursive: operation.kind === "tree" });
      if (operation.backupPath !== null) {
        await mkdir(dirname(operation.targetPath), { recursive: true });
        await rename(operation.backupPath, operation.targetPath);
      }
    }
  } catch (error) {
    throw restoreError("Standalone output replacement failed and previous output could not be restored", error);
  }
}

export async function restoreInterruptedStandaloneOperations(
  staging: string,
  outputPath: string,
  operations: readonly StandaloneJournalOperation[],
): Promise<void> {
  try {
    const actions = await Promise.all(operations.map((operation) => recoveryAction(staging, outputPath, operation)));
    for (const [index, action] of [...actions.entries()].reverse()) {
      const operation = operations[index]!;
      await assertRecoveryAction(staging, outputPath, operation, action);
      if (action.kind === "none") continue;
      if (action.kind === "remove-installed") {
        await rm(action.target, { recursive: operation.kind === "tree" });
        continue;
      }
      if (action.removeInstalled) await rm(action.target, { recursive: operation.kind === "tree" });
      await mkdir(dirname(action.target), { recursive: true });
      await rename(action.backup, action.target);
    }
  } catch (error) {
    if (error instanceof StandaloneRestoreError) throw error;
    throw restoreError("Interrupted standalone output could not be restored", error);
  }
}

export async function assertInstalledStandaloneOperations(
  staging: string,
  outputPath: string,
  operations: readonly StandaloneJournalOperation[],
): Promise<void> {
  try {
    for (const operation of operations) {
      const target = resolve(dirname(outputPath), operation.target);
      const staged = operation.staged === null ? null : resolve(staging, operation.staged);
      const backup = operation.backup === null ? null : resolve(staging, operation.backup);
      if (operation.stagedIdentity === null) await assertMissing(target, "committed cleanup target", backup);
      else await assertIdentity(target, operation.stagedIdentity, "committed standalone output", backup);
      if (staged !== null) await assertMissing(staged, "committed staging source", backup);
      if (backup !== null && await pathExists(backup)) {
        await assertIdentity(backup, operation.previousIdentity!, "standalone backup");
      }
    }
  } catch (error) {
    if (error instanceof StandaloneRestoreError) throw error;
    throw restoreError("Installed standalone output no longer matches its interrupted transaction", error);
  }
}

async function recoveryAction(
  staging: string,
  outputPath: string,
  operation: StandaloneJournalOperation,
): Promise<RecoveryAction> {
  const target = resolve(dirname(outputPath), operation.target);
  const staged = operation.staged === null ? null : resolve(staging, operation.staged);
  const backup = operation.backup === null ? null : resolve(staging, operation.backup);
  const targetIdentity = await captureStandaloneOutputIdentityIfPresent(target, operation.kind);
  const stagedIdentity = staged === null ? null : await captureStandaloneOutputIdentityIfPresent(staged, operation.kind);
  const backupIdentity = backup === null ? null : await captureStandaloneOutputIdentityIfPresent(backup, operation.kind);

  if (operation.previousIdentity !== null) {
    if (backupIdentity !== null) {
      assertSameIdentity(backup!, backupIdentity, operation.previousIdentity, "standalone backup");
      if (stagedIdentity !== null) {
        assertSameIdentity(staged!, stagedIdentity, operation.stagedIdentity!, "staged standalone output");
        if (targetIdentity !== null) changedTarget(target, backup);
        return { kind: "restore-backup", target, backup: backup!, removeInstalled: false };
      }
      if (operation.stagedIdentity !== null) {
        assertSameIdentity(target, targetIdentity, operation.stagedIdentity, "installed standalone output", backup);
        return { kind: "restore-backup", target, backup: backup!, removeInstalled: true };
      }
      if (targetIdentity !== null) changedTarget(target, backup);
      return { kind: "restore-backup", target, backup: backup!, removeInstalled: false };
    }
    assertSameIdentity(target, targetIdentity, operation.previousIdentity, "previous standalone output", backup);
    if (stagedIdentity !== null) {
      assertSameIdentity(staged!, stagedIdentity, operation.stagedIdentity!, "staged standalone output");
    }
    return { kind: "none" };
  }

  if (operation.stagedIdentity === null || staged === null) {
    throw new Error(`transaction operation '${target}' has neither previous nor staged identity`);
  }
  if (stagedIdentity !== null) {
    assertSameIdentity(staged, stagedIdentity, operation.stagedIdentity, "staged standalone output");
    if (targetIdentity !== null) changedTarget(target, null);
    return { kind: "none" };
  }
  if (targetIdentity === null) return { kind: "none" };
  assertSameIdentity(target, targetIdentity, operation.stagedIdentity, "installed standalone output");
  return { kind: "remove-installed", target };
}

async function assertRecoveryAction(
  staging: string,
  outputPath: string,
  operation: StandaloneJournalOperation,
  action: RecoveryAction,
): Promise<void> {
  const current = await recoveryAction(staging, outputPath, operation);
  if (JSON.stringify(current) !== JSON.stringify(action)) {
    throw new Error(`recovery state for '${resolve(dirname(outputPath), operation.target)}' changed before restoration`);
  }
}

async function validateAppliedOperation(operation: AppliedStandaloneOperation): Promise<void> {
  if (operation.installed) {
    await assertIdentity(operation.targetPath, operation.stagedIdentity!, "new standalone output", operation.backupPath);
  } else if (operation.backupPath !== null) {
    await assertMissing(operation.targetPath, "standalone output awaiting rollback", operation.backupPath);
  }
  if (operation.backupPath !== null) {
    await assertIdentity(operation.backupPath, operation.previousIdentity!, "standalone backup");
  }
}

async function assertIdentity(
  path: string,
  expected: StandaloneOutputIdentity,
  label: string,
  backup: string | null = null,
): Promise<void> {
  const actual = await captureStandaloneOutputIdentityIfPresent(path, expected.kind);
  assertSameIdentity(path, actual, expected, label, backup);
}

function assertSameIdentity(
  path: string,
  actual: StandaloneOutputIdentity | null,
  expected: StandaloneOutputIdentity,
  label: string,
  backup: string | null = null,
): void {
  if (actual !== null && sameStandaloneOutputIdentity(actual, expected)) return;
  const retained = backup === null ? "transaction evidence was preserved" : `backup '${backup}' was preserved`;
  throw new StandaloneRestoreError(
    `Refusing to restore interrupted standalone output because ${label} '${path}' changed; ${retained}. Inspect the paths and remove the stale transaction before retrying.`,
  );
}

async function assertMissing(path: string, label: string, backup: string | null = null): Promise<void> {
  if (!await pathExists(path)) return;
  const retained = backup === null ? "transaction evidence was preserved" : `backup '${backup}' was preserved`;
  throw new StandaloneRestoreError(
    `Refusing to restore interrupted standalone output because ${label} '${path}' was replaced; ${retained}. Inspect the paths and remove the stale transaction before retrying.`,
  );
}

function changedTarget(target: string, backup: string | null): never {
  const retained = backup === null ? "transaction evidence was preserved" : `backup '${backup}' was preserved`;
  throw new StandaloneRestoreError(
    `Refusing to restore interrupted standalone output because target '${target}' changed after the transaction was interrupted; ${retained}. Inspect the paths and remove the stale transaction before retrying.`,
  );
}

async function treeIdentity(
  root: string,
  operations: StandaloneIdentityCaptureOperations,
): Promise<{ readonly identity: OrdinaryFileSnapshotIdentity; readonly sizeBytes: number; readonly sha256: string }> {
  const snapshot = await inspectBoundedDirectory(root, "Standalone output tree", productionDirectoryPolicy);
  const inventory: IdentityInventoryEntry[] = [...snapshot.directories.keys()]
    .filter((path) => path !== "").map((path) => ({ path, kind: "directory" }));
  const files = [...snapshot.files.values()].sort((left, right) => comparePath(left.path, right.path));
  let sizeBytes = 0;
  for (const [index, file] of files.entries()) {
    const identity = await inspectedFileIdentity(
      file,
      MAX_PRODUCTION_FILE_BYTES,
      `Standalone output file '${file.path}'`,
    );
    inventory.push({ path: file.path, kind: "file", ...identity });
    sizeBytes += identity.sizeBytes;
    await operations.afterTreeFileHashed?.(file.path, index);
  }
  await assertDirectorySnapshotUnchanged(snapshot, "Standalone output tree");
  inventory.sort((left, right) => comparePath(left.path, right.path));
  const identity = snapshot.directories.get("");
  if (identity === undefined) throw new Error(`Standalone output tree '${root}' has no root identity`);
  return { identity, sizeBytes, sha256: createHash("sha256").update(JSON.stringify(inventory)).digest("hex") };
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return false;
    throw error;
  }
}

function restoreError(message: string, cause: unknown): StandaloneRestoreError {
  return new StandaloneRestoreError(`${message}: ${hostErrorMessage(cause)}`, { cause });
}

function decimalIdentity(value: unknown, allowZero: boolean): value is string {
  return typeof value === "string" && value.length <= 32 && /^[0-9]+$/u.test(value)
    && (allowZero || value !== "0");
}

function refuseJournalTarget(path: string): never {
  throw new Error(`Unsupported standalone transaction target '${path}'`);
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}
