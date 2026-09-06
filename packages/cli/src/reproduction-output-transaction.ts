import { lstat, rename, rm, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { BuildOutputClaimLease } from "./build-output-claim.ts";
import {
  assertDirectorySnapshotUnchanged,
  inspectBoundedDirectory,
  productionDirectoryPolicy,
  type BoundedDirectorySnapshot,
} from "./bounded-directory-snapshot.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import { copyReproductionSnapshot } from "./reproduction-output-copy.ts";
import { byCodeUnit } from "./stable-order.ts";
import {
  directoryIsEmpty,
  readTransactionFile,
  sameTransactionFileIdentity,
  scanTransactionCandidates,
  type TransactionFileSnapshot,
} from "./transaction-metadata.ts";

export interface ReproductionDirectoryIdentity {
  readonly device: number | bigint;
  readonly inode: number | bigint;
}

export type ReproductionTargetSnapshot =
  | { readonly status: "missing" }
  | {
      readonly status: "directory";
      readonly identity: ReproductionDirectoryIdentity;
      readonly empty: boolean;
    };

export interface ReproductionReplacementPaths {
  readonly target: string;
  readonly staging: string;
  readonly previous: string;
  readonly recovery: string;
  readonly transactionEvidence: string;
}

export interface ReproductionReplacement {
  readonly paths: ReproductionReplacementPaths;
  readonly parent: string;
  readonly parentIdentity: ReproductionDirectoryIdentity;
  readonly targetSnapshot: ReproductionTargetSnapshot;
  readonly stagingIdentity: ReproductionDirectoryIdentity;
  readonly evidenceIdentity: ReproductionDirectoryIdentity;
  readonly evidenceContents: string;
  readonly recoveryIdentity: ReproductionDirectoryIdentity | null;
  readonly explicitOutput: boolean;
}

export const REPRODUCTION_TRANSACTION_MARKER = ".velar-reproduction-output-transaction.json";

interface SerializedDirectoryIdentity {
  readonly device: number;
  readonly inode: number;
}

type SerializedTargetSnapshot =
  | { readonly status: "missing" }
  | {
      readonly status: "directory";
      readonly identity: SerializedDirectoryIdentity;
      readonly empty: boolean;
    };

interface ReproductionTransactionRecord {
  readonly formatVersion: 2;
  readonly kind: "velar-reproduction-output-transaction";
  readonly ownerPid: number;
  readonly token: string;
  readonly target: string;
  readonly staging: string;
  readonly previous: string;
  readonly recovery: string;
  readonly recoveryIdentity: SerializedDirectoryIdentity | null;
  readonly parent: string;
  readonly parentIdentity: SerializedDirectoryIdentity;
  readonly targetSnapshot: SerializedTargetSnapshot;
  readonly stagingIdentity: SerializedDirectoryIdentity;
}

type OrdinaryFileSnapshot = TransactionFileSnapshot;

interface VerifiedReproductionTransaction {
  readonly record: ReproductionTransactionRecord;
  readonly evidence: OrdinaryFileSnapshot;
  readonly markerLocation: "staging" | "target";
}

export interface ReproductionRecoveryOperations {
  readonly afterTransactionClaim?: () => Promise<void>;
}

export interface ReproductionReplacementResult {
  /** Cleanup can be retried manually from the claimed transaction paths. */
  readonly cleanupDeferred: boolean;
}

/** Test seam for deterministic rename and cleanup failure coverage. */
export interface ReproductionReplacementOperations {
  readonly rename: typeof rename;
  readonly copyTree: (source: BoundedDirectorySnapshot, destination: string) => Promise<void>;
  readonly removeTree: (path: string) => Promise<void>;
  readonly removeFile: (path: string) => Promise<void>;
  readonly afterFirstRename?: () => Promise<void>;
  readonly afterSecondRename?: () => Promise<void>;
}

const HOST_OPERATIONS: ReproductionReplacementOperations = {
  rename,
  copyTree: copyReproductionSnapshot,
  removeTree: async (path) => rm(path, { recursive: true, force: true }),
  removeFile: async (path) => rm(path, { force: true }),
};

export class ReproductionReplacementError extends Error {
  constructor(message: string, options: { readonly cause?: unknown; readonly preserveArtifacts: boolean }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ReproductionReplacementError";
    this.preserveArtifacts = options.preserveArtifacts;
  }

  readonly preserveArtifacts: boolean;
}

export async function inspectReproductionTarget(
  target: string,
  explicitOutput: boolean,
  displayedPath: string,
): Promise<ReproductionTargetSnapshot> {
  let metadata: Stats;
  try {
    metadata = await lstat(target);
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) return { status: "missing" };
    throw error;
  }
  if (metadata.isSymbolicLink()) throw new Error(`'${displayedPath}' cannot be a symbolic link`);
  if (!metadata.isDirectory()) throw new Error(`'${displayedPath}' already exists and is not a directory`);
  const empty = await directoryIsEmpty(target);
  if (explicitOutput && !empty) {
    throw new Error(`'${displayedPath}' already exists and is not empty; name an empty directory`);
  }
  return { status: "directory", identity: identityOf(metadata), empty };
}

export async function inspectOrdinaryDirectory(path: string, label: string): Promise<ReproductionDirectoryIdentity> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`${label} must be an ordinary directory`);
  return identityOf(metadata);
}

export function sameReproductionIdentity(
  left: ReproductionDirectoryIdentity,
  right: ReproductionDirectoryIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

export function sameReproductionTarget(
  left: ReproductionTargetSnapshot,
  right: ReproductionTargetSnapshot,
): boolean {
  return left.status === "missing"
    ? right.status === "missing"
    : right.status === "directory" && sameReproductionIdentity(left.identity, right.identity);
}

/**
 * Reconciles an interrupted replacement only after its complete path set is
 * claimed and the same hard-linked evidence inode is read again. An internal
 * marker binds the record to either the uncommitted staging tree or the
 * installed target tree; an adjacent JSON file on its own is inert.
 */
export async function recoverReproductionOutputTransactions(
  targetPath: string,
  parentIdentity: ReproductionDirectoryIdentity,
  claim: BuildOutputClaimLease,
  operations: ReproductionRecoveryOperations = {},
): Promise<void> {
  const target = resolve(targetPath);
  const parent = dirname(target);
  await assertPathDirectoryIdentity(parent, parentIdentity, "Reproduction output parent");
  const prefix = `.velar-${basename(target)}-repro-`;
  const suffix = ".velar-transaction.json";
  const entries = await scanTransactionCandidates(parent, (entry) =>
    entry.name.startsWith(prefix) && entry.name.endsWith(suffix)
      && entry.isFile() && !entry.isSymbolicLink(), "Reproduction transaction scan");
  entries.sort((left, right) => byCodeUnit(left.name, right.name));
  for (const entry of entries) {
    const evidencePath = join(parent, entry.name);
    const observed = await readReproductionTransaction(evidencePath, target);
    if (observed === null) continue;
    if (observed.record.ownerPid !== process.pid && processIsAlive(observed.record.ownerPid)) {
      throw new Error(`Reproduction output '${target}' is already being written by process ${observed.record.ownerPid}`);
    }
    if (!sameReproductionIdentity(observed.record.parentIdentity, parentIdentity)) {
      throw new Error(`reproduction output parent '${parent}' changed physical identity`);
    }
    await claim.extend(reproductionTransactionClaims(observed.record, evidencePath));
    await operations.afterTransactionClaim?.();
    const transaction = await readReproductionTransaction(evidencePath, target);
    if (transaction === null || !sameVerifiedTransaction(observed, transaction)) {
      throw new Error(`Reproduction transaction evidence '${evidencePath}' changed while it was being claimed`);
    }
    await recoverReproductionTransaction(transaction, parentIdentity, HOST_OPERATIONS);
  }
}

async function recoverReproductionTransaction(
  transaction: VerifiedReproductionTransaction,
  parentIdentity: ReproductionDirectoryIdentity,
  operations: ReproductionReplacementOperations,
): Promise<void> {
  const { record, evidence, markerLocation } = transaction;
  const replacement: ReproductionReplacement = {
    paths: {
      target: record.target,
      staging: record.staging,
      previous: record.previous,
      recovery: record.recovery,
      transactionEvidence: `${record.staging}.velar-transaction.json`,
    },
    parent: record.parent,
    parentIdentity,
    targetSnapshot: record.targetSnapshot,
    stagingIdentity: record.stagingIdentity,
    evidenceIdentity: evidence.identity,
    evidenceContents: evidence.contents,
    recoveryIdentity: record.recoveryIdentity,
    explicitOutput: false,
  };
  await assertParentIdentity(replacement);
  if (markerLocation === "staging") {
    await recoverUncommittedReproduction(replacement, operations);
    return;
  }
  await recoverCommittedReproduction(replacement, operations);
}

async function recoverUncommittedReproduction(
  transaction: ReproductionReplacement,
  operations: ReproductionReplacementOperations,
): Promise<void> {
  const { target, staging, previous, recovery, transactionEvidence } = transaction.paths;
  await assertDirectoryIdentity(staging, transaction.stagingIdentity, "Reproduction staging directory");
  await assertEvidencePair(
    transactionEvidence,
    join(staging, REPRODUCTION_TRANSACTION_MARKER),
    transaction.evidenceIdentity,
    transaction.evidenceContents,
  );
  await assertMissing(recovery, "reproduction recovery copy");
  const currentTarget = await inspectReproductionTarget(target, false, target);
  if (transaction.targetSnapshot.status === "missing") {
    if (currentTarget.status !== "missing") throw changedIdentity(target, true);
    await assertMissing(previous, "reproduction backup");
  } else if (sameReproductionTarget(transaction.targetSnapshot, currentTarget)) {
    await assertMissing(previous, "reproduction backup");
  } else if (currentTarget.status === "missing") {
    await assertDirectoryIdentity(previous, transaction.targetSnapshot.identity, "Previous reproduction directory");
    await assertParentIdentity(transaction);
    await assertMissing(target, "reproduction output during recovery");
    await assertDirectoryIdentity(previous, transaction.targetSnapshot.identity, "Previous reproduction directory");
    await operations.rename(previous, target);
    await assertParentIdentity(transaction);
    await assertDirectoryIdentity(target, transaction.targetSnapshot.identity, "Restored reproduction directory");
  } else {
    throw changedIdentity(target, true);
  }
  await assertParentIdentity(transaction);
  await assertDirectoryIdentity(staging, transaction.stagingIdentity, "Reproduction staging directory");
  await operations.removeTree(staging);
  await assertParentIdentity(transaction);
  await assertFileSnapshot(
    transactionEvidence,
    transaction.evidenceIdentity,
    transaction.evidenceContents,
    "reproduction transaction evidence",
  );
  await operations.removeFile(transactionEvidence);
}

async function recoverCommittedReproduction(
  transaction: ReproductionReplacement,
  operations: ReproductionReplacementOperations,
): Promise<void> {
  const { target, previous, recovery, transactionEvidence } = transaction.paths;
  await assertDirectoryIdentity(target, transaction.stagingIdentity, "Installed reproduction directory");
  await assertEvidencePair(
    transactionEvidence,
    join(target, REPRODUCTION_TRANSACTION_MARKER),
    transaction.evidenceIdentity,
    transaction.evidenceContents,
  );
  let cleanupTransaction = transaction;
  if (transaction.targetSnapshot.status === "directory") {
    if (await pathExists(previous) || await pathExists(recovery) || transaction.recoveryIdentity !== null) {
      cleanupTransaction = await cleanupPreviousReproduction(transaction, operations);
    }
  } else {
    await assertMissing(previous, "reproduction backup");
    await assertMissing(recovery, "reproduction recovery copy");
  }
  await cleanupReproductionEvidence(cleanupTransaction, operations);
}

/**
 * Replaces a reproduction tree without trusting transaction JSON. The active
 * lease and the directory identities captured by its caller are the authority.
 * If the target changes after the final preflight, the first rename captures
 * that exact object in `previous`; it is checked there before anything can be
 * installed or removed and restored on mismatch.
 */
export async function replaceReproductionDirectory(
  transaction: ReproductionReplacement,
  operations: ReproductionReplacementOperations = HOST_OPERATIONS,
): Promise<ReproductionReplacementResult> {
  const { target, staging, previous, recovery, transactionEvidence } = transaction.paths;
  await assertParentIdentity(transaction);
  const currentTarget = await inspectReproductionTarget(
    target,
    transaction.explicitOutput,
    target,
  );
  if (!sameReproductionTarget(transaction.targetSnapshot, currentTarget)) {
    throw changedIdentity(target, false);
  }
  await assertMissing(previous, "reproduction backup");
  await assertMissing(recovery, "reproduction recovery copy");
  await assertDirectoryIdentity(staging, transaction.stagingIdentity, "reproduction staging directory");
  await assertEvidencePair(
    transactionEvidence,
    join(staging, REPRODUCTION_TRANSACTION_MARKER),
    transaction.evidenceIdentity,
    transaction.evidenceContents,
  );

  const previousSnapshot = transaction.targetSnapshot.status === "directory"
    ? await moveAndInspectPreviousReproduction(transaction, transaction.targetSnapshot.identity, operations)
    : null;
  const movedPrevious = previousSnapshot !== null;

  try {
    await assertParentIdentity(transaction);
    await assertMissing(target, "reproduction output");
    await assertDirectoryIdentity(staging, transaction.stagingIdentity, "reproduction staging directory");
    if (previousSnapshot !== null) {
      await assertDirectorySnapshotUnchanged(previousSnapshot, "Previous reproduction directory");
    }
    await assertEvidencePair(
      transactionEvidence,
      join(staging, REPRODUCTION_TRANSACTION_MARKER),
      transaction.evidenceIdentity,
      transaction.evidenceContents,
    );
    await operations.rename(staging, target);
  } catch (error) {
    if (movedPrevious && transaction.targetSnapshot.status === "directory") {
      await restorePrevious(transaction, operations, error, transaction.targetSnapshot.identity);
    }
    throw new ReproductionReplacementError(`Could not install reproduction '${target}'`, {
      cause: error,
      preserveArtifacts: false,
    });
  }

  // The second rename is the commit point. From here on a cleanup failure must
  // leave the complete new bundle installed and the evidence needed to inspect
  // any retained previous tree.
  try {
    await operations.afterSecondRename?.();
    await assertParentIdentity(transaction);
    await assertDirectoryIdentity(target, transaction.stagingIdentity, "installed reproduction directory");
  } catch (error) {
    throw new ReproductionReplacementError(
      `Reproduction '${target}' was installed but its physical identity changed before it could be verified`,
      { cause: error, preserveArtifacts: true },
    );
  }

  let cleanupTransaction = transaction;
  if (movedPrevious) {
    try {
      cleanupTransaction = await cleanupPreviousReproduction(transaction, operations, previousSnapshot);
    } catch {
      return { cleanupDeferred: true };
    }
  }
  try {
    await cleanupReproductionEvidence(cleanupTransaction, operations);
  } catch {
    return { cleanupDeferred: true };
  }
  return { cleanupDeferred: false };
}

async function moveAndInspectPreviousReproduction(
  transaction: ReproductionReplacement,
  expectedIdentity: ReproductionDirectoryIdentity,
  operations: ReproductionReplacementOperations,
): Promise<BoundedDirectorySnapshot> {
  const { target, previous, staging, transactionEvidence } = transaction.paths;
  try {
    await operations.rename(target, previous);
  } catch (error) {
    throw new ReproductionReplacementError(`Could not move the previous reproduction '${target}' aside`, {
      cause: error,
      preserveArtifacts: false,
    });
  }
  let movedIdentity: ReproductionDirectoryIdentity;
  try {
    await operations.afterFirstRename?.();
    movedIdentity = await inspectOrdinaryDirectory(previous, "Previous reproduction directory");
    await assertParentIdentity(transaction);
    await assertEvidencePair(
      transactionEvidence,
      join(staging, REPRODUCTION_TRANSACTION_MARKER),
      transaction.evidenceIdentity,
      transaction.evidenceContents,
    );
  } catch (error) {
    await restorePrevious(transaction, operations, error, expectedIdentity);
    throw changedIdentity(target, false, error);
  }
  if (!sameReproductionIdentity(movedIdentity, expectedIdentity)) {
    const error = new Error(`previous reproduction directory '${previous}' changed physical identity`);
    await restorePrevious(transaction, operations, error, movedIdentity);
    throw changedIdentity(target, false, error);
  }
  try {
    const snapshot = await inspectBoundedDirectory(previous, "Previous reproduction directory", productionDirectoryPolicy);
    await assertDirectorySnapshotUnchanged(snapshot, "Previous reproduction directory");
    return snapshot;
  } catch (error) {
    await restorePrevious(transaction, operations, error, expectedIdentity);
    throw new ReproductionReplacementError(
      `Could not safely retain the previous reproduction '${target}': ${hostErrorMessage(error)}`,
      { cause: error, preserveArtifacts: false },
    );
  }
}

async function cleanupPreviousReproduction(
  transaction: ReproductionReplacement,
  operations: ReproductionReplacementOperations,
  authenticatedSnapshot: BoundedDirectorySnapshot | null = null,
): Promise<ReproductionReplacement> {
  const { previous, recovery } = transaction.paths;
  if (transaction.targetSnapshot.status !== "directory") throw new Error("a missing target cannot have a backup");
  let current = transaction;
  const previousExists = await pathExists(previous);
  const recoveryExists = await pathExists(recovery);
  if (recoveryExists) {
    if (current.recoveryIdentity === null) {
      throw new Error(`Reproduction recovery copy '${recovery}' has no bound physical identity; transaction artifacts were preserved`);
    }
    await assertDirectoryIdentity(recovery, current.recoveryIdentity, "Reproduction recovery copy");
  } else if (current.recoveryIdentity !== null && previousExists) {
    throw new Error(`Reproduction recovery copy '${recovery}' changed physical identity`);
  }
  if (previousExists) {
    await assertDirectoryIdentity(previous, transaction.targetSnapshot.identity, "Previous reproduction directory");
    if (!recoveryExists) {
      // Recursive removal can fail after deleting only part of a tree. Bind a
      // complete copy into the evidence before old-tree deletion can begin.
      const snapshot = authenticatedSnapshot ?? await inspectBoundedDirectory(
        previous,
        "Previous reproduction directory",
        productionDirectoryPolicy,
      );
      await assertDirectorySnapshotUnchanged(snapshot, "Previous reproduction directory");
      await operations.copyTree(snapshot, recovery);
      await assertDirectorySnapshotUnchanged(snapshot, "Previous reproduction directory");
      const recoveryIdentity = await inspectOrdinaryDirectory(recovery, "Reproduction recovery copy");
      current = await bindRecoveryEvidence(current, recoveryIdentity);
      authenticatedSnapshot = snapshot;
    }
    await assertParentIdentity(current);
    if (authenticatedSnapshot !== null) {
      await assertDirectorySnapshotUnchanged(authenticatedSnapshot, "Previous reproduction directory");
    } else {
      await assertDirectoryIdentity(previous, transaction.targetSnapshot.identity, "Previous reproduction directory");
    }
    await operations.removeTree(previous);
  }
  if (await pathExists(recovery)) {
    if (current.recoveryIdentity === null) throw new Error("reproduction recovery identity was not recorded");
    await assertParentIdentity(current);
    await assertDirectoryIdentity(recovery, current.recoveryIdentity, "Reproduction recovery copy");
    await operations.removeTree(recovery);
  }
  return current;
}

async function bindRecoveryEvidence(
  transaction: ReproductionReplacement,
  recoveryIdentity: ReproductionDirectoryIdentity,
): Promise<ReproductionReplacement> {
  const { target, transactionEvidence } = transaction.paths;
  const parsed: unknown = JSON.parse(transaction.evidenceContents);
  if (!isReproductionTransactionRecord(parsed, transactionEvidence, target)) {
    throw new Error(`Reproduction transaction evidence '${transactionEvidence}' cannot bind its recovery copy`);
  }
  const serializableRecovery = serializedIdentity(recoveryIdentity);
  const evidenceContents = `${JSON.stringify({ ...parsed, recoveryIdentity: serializableRecovery }, null, 2)}\n`;
  await assertEvidencePair(
    transactionEvidence,
    join(target, REPRODUCTION_TRANSACTION_MARKER),
    transaction.evidenceIdentity,
    transaction.evidenceContents,
  );
  await writeFile(transactionEvidence, evidenceContents, "utf8");
  await assertEvidencePair(
    transactionEvidence,
    join(target, REPRODUCTION_TRANSACTION_MARKER),
    transaction.evidenceIdentity,
    evidenceContents,
  );
  return { ...transaction, evidenceContents, recoveryIdentity: serializableRecovery };
}

function serializedIdentity(identity: ReproductionDirectoryIdentity): SerializedDirectoryIdentity {
  if (typeof identity.device !== "number" || typeof identity.inode !== "number"
    || !validIdentityNumber(identity.device) || !validIdentityNumber(identity.inode)) {
    throw new Error("reproduction transaction directory identity cannot be serialized safely");
  }
  return { device: identity.device, inode: identity.inode };
}

async function cleanupReproductionEvidence(
  transaction: ReproductionReplacement,
  operations: ReproductionReplacementOperations,
): Promise<void> {
  const { target, transactionEvidence } = transaction.paths;
  const internalEvidence = join(target, REPRODUCTION_TRANSACTION_MARKER);
  await assertEvidencePair(
    transactionEvidence,
    internalEvidence,
    transaction.evidenceIdentity,
    transaction.evidenceContents,
  );
  await operations.removeFile(internalEvidence);
  await assertFileSnapshot(
    transactionEvidence,
    transaction.evidenceIdentity,
    transaction.evidenceContents,
    "reproduction transaction evidence",
  );
  await operations.removeFile(transactionEvidence);
}

async function restorePrevious(
  transaction: ReproductionReplacement,
  operations: ReproductionReplacementOperations,
  cause: unknown,
  expectedIdentity: ReproductionDirectoryIdentity,
): Promise<void> {
  const { target, previous } = transaction.paths;
  try {
    await assertParentIdentity(transaction);
    await assertMissing(target, "reproduction output during rollback");
    await operations.rename(previous, target);
    await assertDirectoryIdentity(target, expectedIdentity, "restored reproduction directory");
  } catch (restoreError) {
    throw new ReproductionReplacementError(
      `Reproduction replacement failed and its old-bundle transaction artifacts were preserved because '${previous}' could not be safely restored`,
      { cause: new AggregateError([cause, restoreError]), preserveArtifacts: true },
    );
  }
}

async function assertParentIdentity(transaction: ReproductionReplacement): Promise<void> {
  const actual = await inspectOrdinaryDirectory(transaction.parent, "Reproduction output parent");
  if (!sameReproductionIdentity(transaction.parentIdentity, actual)) {
    throw new Error(`reproduction output parent '${transaction.parent}' changed physical identity`);
  }
}

async function assertDirectoryIdentity(
  path: string,
  expected: ReproductionDirectoryIdentity,
  label: string,
): Promise<void> {
  const actual = await inspectOrdinaryDirectory(path, label);
  if (!sameReproductionIdentity(expected, actual)) throw new Error(`${label} '${path}' changed physical identity`);
}

async function assertEvidencePair(
  external: string,
  internal: string,
  expected: ReproductionDirectoryIdentity,
  expectedContents: string,
): Promise<void> {
  await assertFileSnapshot(external, expected, expectedContents, "reproduction transaction evidence");
  await assertFileSnapshot(internal, expected, expectedContents, "reproduction transaction marker");
}

async function assertFileSnapshot(
  path: string,
  expected: ReproductionDirectoryIdentity,
  expectedContents: string,
  label: string,
): Promise<void> {
  const actual = await readOrdinaryFile(path);
  if (actual === null || actual.contents !== expectedContents
    || !sameReproductionIdentity(expected, actual.identity)) {
    throw new Error(`${label} '${path}' changed physical identity or contents`);
  }
}

async function assertMissing(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) return;
    throw error;
  }
  throw new Error(`${label} '${path}' already exists`);
}

function changedIdentity(target: string, preserveArtifacts: boolean, cause?: unknown): ReproductionReplacementError {
  return new ReproductionReplacementError(`refusing to replace '${target}': the reproduction directory changed physical identity`, {
    cause,
    preserveArtifacts,
  });
}

function identityOf(metadata: Stats): ReproductionDirectoryIdentity {
  return { device: metadata.dev, inode: metadata.ino };
}

function unreachableIdentity(): ReproductionDirectoryIdentity {
  throw new Error("a missing reproduction target cannot have a previous directory");
}

async function readReproductionTransaction(
  evidencePath: string,
  target: string,
): Promise<VerifiedReproductionTransaction | null> {
  try {
    const evidence = await readOrdinaryFile(evidencePath);
    if (evidence === null) return null;
    const value: unknown = JSON.parse(evidence.contents);
    if (!isReproductionTransactionRecord(value, evidencePath, target)) return null;
    const [stagingMarker, targetMarker] = await Promise.all([
      readOrdinaryFile(join(value.staging, REPRODUCTION_TRANSACTION_MARKER)),
      readOrdinaryFile(join(value.target, REPRODUCTION_TRANSACTION_MARKER)),
    ]);
    const stagingMatches = sameOrdinaryFile(evidence, stagingMarker);
    const targetMatches = sameOrdinaryFile(evidence, targetMarker);
    if (stagingMatches === targetMatches) return null;
    return {
      record: value,
      evidence,
      markerLocation: stagingMatches ? "staging" : "target",
    };
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR") || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function isReproductionTransactionRecord(
  value: unknown,
  evidencePath: string,
  target: string,
): value is ReproductionTransactionRecord {
  if (!hasExactKeys(value, [
    "formatVersion", "kind", "ownerPid", "parent", "parentIdentity", "previous", "recovery", "recoveryIdentity",
    "staging", "stagingIdentity", "target", "targetSnapshot", "token",
  ]) || value.formatVersion !== 2 || value.kind !== "velar-reproduction-output-transaction"
    || !validOwner(value.ownerPid) || !validToken(value.token)
    || typeof value.target !== "string" || value.target !== target
    || typeof value.parent !== "string" || value.parent !== dirname(target)
    || typeof value.staging !== "string" || typeof value.previous !== "string"
    || typeof value.recovery !== "string" || !validSerializedIdentity(value.parentIdentity)
    || value.recoveryIdentity !== null && !validSerializedIdentity(value.recoveryIdentity)
    || !validSerializedIdentity(value.stagingIdentity) || !validSerializedTarget(value.targetSnapshot)) return false;
  const staging = join(value.parent, `.velar-${basename(target)}-repro-${value.token}`);
  return value.staging === staging
    && value.previous === `${staging}-previous`
    && value.recovery === `${staging}-recovery`
    && evidencePath === `${staging}.velar-transaction.json`;
}

function validSerializedTarget(value: unknown): value is SerializedTargetSnapshot {
  if (!hasExactKeys(value, value !== null && typeof value === "object" && "status" in value
    && value.status === "directory" ? ["empty", "identity", "status"] : ["status"])) return false;
  return value.status === "missing"
    || value.status === "directory" && typeof value.empty === "boolean" && validSerializedIdentity(value.identity);
}

function validSerializedIdentity(value: unknown): value is SerializedDirectoryIdentity {
  return hasExactKeys(value, ["device", "inode"])
    && validIdentityNumber(value.device) && validIdentityNumber(value.inode);
}

function validIdentityNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validOwner(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validToken(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

async function readOrdinaryFile(path: string): Promise<OrdinaryFileSnapshot | null> {
  return readTransactionFile(path, `Reproduction transaction evidence '${path}'`);
}

function sameOrdinaryFile(
  left: OrdinaryFileSnapshot | null,
  right: OrdinaryFileSnapshot | null,
): boolean {
  return left !== null && right !== null && left.links >= 2 && right.links >= 2
    && left.contents === right.contents && sameTransactionFileIdentity(left.identity, right.identity);
}

function sameVerifiedTransaction(
  left: VerifiedReproductionTransaction,
  right: VerifiedReproductionTransaction,
): boolean {
  return left.markerLocation === right.markerLocation
    && sameOrdinaryFile(left.evidence, right.evidence);
}

function reproductionTransactionClaims(
  record: ReproductionTransactionRecord,
  evidencePath: string,
): readonly { readonly path: string; readonly kind: "file" | "tree" }[] {
  return [
    { path: record.staging, kind: "tree" },
    { path: record.previous, kind: "tree" },
    { path: record.recovery, kind: "tree" },
    { path: evidencePath, kind: "file" },
  ];
}

async function assertPathDirectoryIdentity(
  path: string,
  expected: ReproductionDirectoryIdentity,
  label: string,
): Promise<void> {
  const actual = await inspectOrdinaryDirectory(path, label);
  if (!sameReproductionIdentity(expected, actual)) throw new Error(`${label} '${path}' changed physical identity`);
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

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isHostErrorCode(error, "EPERM");
  }
}
