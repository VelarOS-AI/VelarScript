import { link, lstat, mkdir, open, opendir, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ProjectResult } from "./project.ts";
import {
  assertBuildOutputClaimsOutsideInputs,
  type AdditionalBuildInput,
  type BuildOutputClaim,
} from "./build-input-boundary.ts";
import { assertEmbeddedModuleOutputWritable } from "./embedded-modules.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
import { canonicalizePotentialPath } from "./canonical-path.ts";
import { readBoundedFileHandle } from "./bounded-text.ts";
import {
  acquireBuildOutputClaims,
  finishBuildOutputClaim,
  type BuildOutputClaimLease,
  type BuildOutputClaimResult,
} from "./build-output-claim.ts";
import {
  assertStandaloneConfigurationReceiptIdentity,
  readStandaloneOutputOwnership,
  STANDALONE_TRANSACTION_EVIDENCE_MARKER,
  STANDALONE_TRANSACTION_MARKER as TRANSACTION_MARKER,
  type StandaloneConfigurationIdentity,
  writeStandaloneReceipt,
} from "./standalone-output-ownership.ts";
import {
  assertAuthorizedStandaloneJournalOperations,
  assertCurrentStandaloneOutputIdentity,
  assertInstalledStandaloneOperations,
  captureStandaloneOutputIdentity,
  captureStandaloneOutputIdentityIfPresent,
  isStandaloneOutputIdentity,
  restoreAppliedStandaloneOperations,
  restoreInterruptedStandaloneOperations,
  StandaloneRestoreError,
  type AppliedStandaloneOperation,
  type StandaloneJournalOperation,
} from "./standalone-output-recovery.ts";
import {
  assertStandaloneRuntimeOperationOwners,
  assertStandaloneTargetShape,
  standaloneOutputOperations,
  type StandaloneOutputOperation,
} from "./standalone-output-operations.ts";
import {
  MAX_STANDALONE_TRANSACTION_METADATA_BYTES,
  MAX_STANDALONE_TRANSACTION_OPERATIONS,
} from "./standalone-output-limits.ts";
import { standardRuntimePackageOutputClaims } from "./node-standard-module-output.ts";

export {MAX_STANDALONE_TRANSACTION_METADATA_BYTES, MAX_STANDALONE_TRANSACTION_OPERATIONS};

export interface StandaloneOutputTransaction {
  readonly outputPath: string;
  readonly project: ProjectResult;
  /** Closed compiler-owned runtime set determined before the transaction starts. */
  readonly runtimeModules: ReadonlySet<string>;
  /** Complete file-level mutation set known before generation starts. */
  readonly claimedFiles: readonly string[];
  /** Optional generated sidecars that the requested build no longer emits. */
  readonly cleanupFiles: readonly string[];
  /** Embedded siblings have an ownership marker and must never replace author files. */
  readonly generatedSiblingFiles: readonly string[];
  /** Optional Server configuration sidecar installed and retired under the main output receipt. */
  readonly configurationPath?: string | null;
  /** Inputs discovered after semantic checking, such as esbuild's closed npm graph. */
  readonly additionalInputs: readonly AdditionalBuildInput[];
  /** Testable transaction boundary: every static path is claimed, but staging does not exist yet. */
  readonly observeClaimedStaging?: (stagingDirectory: string, evidencePath: string) => Promise<void>;
  /** Writes the complete result below the supplied isolated sibling path. */
  readonly writeStaged: (outputPath: string) => Promise<void>;
}

interface TransactionJournal {
  readonly formatVersion: 2;
  readonly kind: "velar-standalone-transaction";
  readonly outputPath: string;
  readonly stagingDirectory: string;
  readonly canonicalOutputRoot: string;
  readonly canonicalStagingDirectory: string;
  readonly ownerPid: number;
  readonly transactionToken: string;
  readonly phase: "staging" | "installing" | "installed";
  readonly operations: readonly StandaloneJournalOperation[];
}

interface TransactionEvidence {
  readonly formatVersion: 2;
  readonly kind: "velar-standalone-transaction-evidence";
  readonly outputPath: string;
  readonly stagingDirectory: string;
  readonly canonicalOutputRoot: string;
  readonly canonicalStagingDirectory: string;
  readonly ownerPid: number;
  readonly transactionToken: string;
  readonly phase: TransactionJournal["phase"];
  readonly operationsSha256: string;
}

interface VerifiedTransactionJournal extends TransactionJournal {
  readonly evidenceDevice: number | bigint;
  readonly evidenceInode: number | bigint;
}

interface VerifiedTransactionEvidence extends TransactionEvidence {
  readonly evidenceDevice: number | bigint;
  readonly evidenceInode: number | bigint;
}

interface TransactionLocation {
  readonly canonicalOutputRoot: string;
  readonly canonicalStagingDirectory: string;
}

interface OrdinaryFileSnapshot {
  readonly contents: string;
  readonly device: number | bigint;
  readonly inode: number | bigint;
}

const TRANSACTION_EVIDENCE_SUFFIX = ".velar-transaction.json";

/**
 * Produces a standalone build without exposing partially rendered output.
 * Every byte is prepared in a same-filesystem sibling directory; only after
 * the entire graph succeeds are its claims authorized and promoted by rename.
 * A failed promotion restores every previous claim from the same directory.
 */
export async function writeStandaloneOutputTransaction(options: StandaloneOutputTransaction): Promise<void> {
  const outputPath = resolve(options.outputPath);
  const outputRoot = dirname(outputPath);
  await assertBuildOutputClaimsOutsideInputs(
    options.project,
    options.claimedFiles.map((path) => ({ path, kind: "file" })),
    options.additionalInputs,
  );
  const staging = join(outputRoot, `.velar-${basename(outputPath)}-${randomUUID()}`);
  const evidencePath = transactionEvidencePath(staging);
  const runtimeClaims = standardRuntimePackageOutputClaims(
    join(outputRoot, "node_modules"),
    options.runtimeModules,
  );
  const claim = await acquireBuildOutputClaims([
    ...[...new Set([...options.claimedFiles, ...options.cleanupFiles])]
      .map((path) => ({ path, kind: "file" as const })),
    ...runtimeClaims.map(({path, kind}) => ({path, kind})),
    { path: staging, kind: "tree" },
    { path: evidencePath, kind: "file" },
  ]);
  let preserveStaging = false;
  let stagingCreated = false;
  let evidenceCreated = false;
  let result: BuildOutputClaimResult = { status: "committed" };
  try {
    await mkdir(outputRoot, { recursive: true });
    await recoverStandaloneTransactions(outputPath, options.project, options.additionalInputs, claim);
    const previousOwnership = await readStandaloneOutputOwnership(outputPath);
    const previousReceipt = previousOwnership.files;
    await claim.extend([...previousReceipt].map((path) => ({ path, kind: "file" })));
    for (const path of options.generatedSiblingFiles) await assertEmbeddedModuleOutputWritable(resolve(path));
    await options.observeClaimedStaging?.(staging, evidencePath);
    await mkdir(staging, { mode: 0o700 });
    stagingCreated = true;
    const location = await transactionLocation(staging, outputPath);
    const transactionToken = randomUUID();
    await writeTransactionEvidence(staging, outputPath, location, transactionToken, "staging", []);
    evidenceCreated = true;
    await writeTransactionJournal(staging, outputPath, location, transactionToken, "staging", []);
    const stagedOutput = join(staging, basename(outputPath));
    await options.writeStaged(stagedOutput);
    for (const path of options.generatedSiblingFiles) await assertEmbeddedModuleOutputWritable(resolve(path));
    await writeStandaloneReceipt(staging, outputPath, options.generatedSiblingFiles, options.configurationPath ?? null);
    const operations = await standaloneOutputOperations(
      staging,
      outputRoot,
      options.cleanupFiles,
      previousReceipt,
      outputPath,
    );
    assertTransactionOperationCount(operations.length);
    await claim.extend(operations.map((operation) => ({ path: operation.path, kind: operation.kind })));
    await assertBuildOutputClaimsOutsideInputs(options.project, operations, options.additionalInputs);
    await assertStandaloneRuntimeOperationOwners(operations);
    await applyOperations(staging, outputPath, location, transactionToken, operations, previousOwnership.configuration);
  } catch (error) {
    preserveStaging = error instanceof StandaloneRestoreError;
    result = { status: "failed", error };
  }
  await finishBuildOutputClaim(claim, result, async () => {
    if (!preserveStaging) {
      let stagingRemoved = !stagingCreated;
      if (stagingCreated) {
        try {
          await rm(staging, { recursive: true, force: true });
          stagingRemoved = true;
        } catch {}
      }
      if (stagingRemoved && evidenceCreated) await rm(evidencePath, { force: true }).catch(() => {});
    }
  });
}

async function applyOperations(
  staging: string,
  outputPath: string,
  location: TransactionLocation,
  transactionToken: string,
  operations: readonly StandaloneOutputOperation[],
  previousConfiguration: StandaloneConfigurationIdentity | null,
): Promise<void> {
  const backupRoot = join(staging, ".previous");
  const applied: AppliedStandaloneOperation[] = [];
  let planned: readonly StandaloneJournalOperation[] = [];
  try {
    planned = await Promise.all(operations.map(async (operation, index): Promise<StandaloneJournalOperation> => {
      const previousIdentity = await captureStandaloneOutputIdentityIfPresent(operation.path, operation.kind);
      const stagedIdentity = operation.stagedPath === null
        ? null
        : await captureStandaloneOutputIdentity(operation.stagedPath, operation.kind);
      return {
        target: safeRelative(dirname(outputPath), operation.path),
        staged: operation.stagedPath === null ? null : safeRelative(staging, operation.stagedPath),
        backup: previousIdentity === null ? null : safeRelative(staging, join(backupRoot, String(index))),
        kind: operation.kind,
        hadPrevious: previousIdentity !== null,
        stagedIdentity,
        previousIdentity,
      };
    }));
    assertStandaloneConfigurationReceiptIdentity(outputPath, previousConfiguration, operations, planned);
    await assertCanonicalTransactionPaths(staging, outputPath, location, planned);
    await assertAuthorizedStandaloneJournalOperations(staging, outputPath, planned);
    for (const operation of operations) await assertStandaloneTargetShape(operation);
    await updateTransactionEvidence(staging, outputPath, location, transactionToken, "installing", planned);
    await writeTransactionJournal(staging, outputPath, location, transactionToken, "installing", planned);
    for (const [index, operation] of operations.entries()) {
      const plan = planned[index]!;
      await assertCanonicalTransactionPaths(staging, outputPath, location, [plan]);
      await assertAuthorizedStandaloneJournalOperations(staging, outputPath, [plan], planned);
      const backupPath = plan.backup === null ? null : join(staging, plan.backup);
      if (backupPath) {
        await assertCurrentStandaloneOutputIdentity(operation.path, plan.previousIdentity!, "Previous standalone output");
        await mkdir(dirname(backupPath), { recursive: true });
        await rename(operation.path, backupPath);
        applied.push({
          targetPath: operation.path,
          backupPath,
          kind: operation.kind,
          installed: false,
          stagedIdentity: plan.stagedIdentity,
          previousIdentity: plan.previousIdentity,
        });
        await assertCurrentStandaloneOutputIdentity(backupPath, plan.previousIdentity!, "Standalone backup");
      } else {
        applied.push({
          targetPath: operation.path,
          backupPath: null,
          kind: operation.kind,
          installed: false,
          stagedIdentity: plan.stagedIdentity,
          previousIdentity: null,
        });
      }
      const appliedIndex = applied.length - 1;
      if (operation.stagedPath !== null) {
        await assertCurrentStandaloneOutputIdentity(operation.stagedPath, plan.stagedIdentity!, "Staged standalone output");
        await mkdir(dirname(operation.path), { recursive: true });
        await rename(operation.stagedPath, operation.path);
        applied[appliedIndex] = { ...applied[appliedIndex]!, installed: true };
        await assertCurrentStandaloneOutputIdentity(operation.path, plan.stagedIdentity!, "Installed standalone output");
      }
    }
    // Evidence moves first, so a cut between the two writes is an authenticated
    // but incomplete transition that recovery preserves instead of guessing.
    await updateTransactionEvidence(staging, outputPath, location, transactionToken, "installed", planned);
    await writeTransactionJournal(staging, outputPath, location, transactionToken, "installed", planned);
  } catch (error) {
    try {
      await assertCanonicalTransactionPaths(staging, outputPath, location, planned);
      await restoreAppliedStandaloneOperations(applied);
    } catch (restoreError) {
      if (restoreError instanceof StandaloneRestoreError) throw restoreError;
      throw new StandaloneRestoreError(
        `Standalone output replacement failed and previous output could not be restored: ${hostErrorMessage(restoreError)}`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function writeTransactionJournal(
  staging: string,
  outputPath: string,
  location: TransactionLocation,
  transactionToken: string,
  phase: TransactionJournal["phase"],
  operations: readonly StandaloneJournalOperation[],
): Promise<void> {
  if (!validTransactionPhase(phase, operations.length)) throw new Error(`Invalid standalone transaction phase '${phase}'`);
  const journal: TransactionJournal = {
    formatVersion: 2,
    kind: "velar-standalone-transaction",
    outputPath,
    stagingDirectory: staging,
    ...location,
    ownerPid: process.pid,
    transactionToken,
    phase,
    operations,
  };
  const next = join(staging, `${TRANSACTION_MARKER}.next`);
  await writeFile(next, transactionMetadataText(journal, "Standalone transaction journal"), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(next, join(staging, TRANSACTION_MARKER));
}

async function writeTransactionEvidence(
  staging: string,
  outputPath: string,
  location: TransactionLocation,
  transactionToken: string,
  phase: TransactionJournal["phase"],
  operations: readonly StandaloneJournalOperation[],
): Promise<void> {
  if (!validTransactionPhase(phase, operations.length)) throw new Error(`Invalid standalone transaction phase '${phase}'`);
  const evidence = transactionEvidence(staging, outputPath, location, transactionToken, phase, operations);
  await writeFile(
    transactionEvidencePath(staging),
    transactionMetadataText(evidence, "Standalone transaction evidence"),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  try {
    await link(
      transactionEvidencePath(staging),
      join(staging, STANDALONE_TRANSACTION_EVIDENCE_MARKER),
    );
  } catch (error) {
    await rm(transactionEvidencePath(staging), { force: true }).catch(() => {});
    throw error;
  }
}

async function updateTransactionEvidence(
  staging: string,
  outputPath: string,
  location: TransactionLocation,
  transactionToken: string,
  phase: TransactionJournal["phase"],
  operations: readonly StandaloneJournalOperation[],
): Promise<void> {
  const externalPath = transactionEvidencePath(staging);
  const internalPath = join(staging, STANDALONE_TRANSACTION_EVIDENCE_MARKER);
  const before = await Promise.all([readOrdinaryFile(externalPath), readOrdinaryFile(internalPath)]);
  if (!sameEvidenceFiles(before[0], before[1])) {
    throw new Error(`Standalone transaction evidence for '${staging}' changed before installation`);
  }
  const evidence = transactionEvidence(staging, outputPath, location, transactionToken, phase, operations);
  const contents = transactionMetadataText(evidence, "Standalone transaction evidence");
  await writeFile(externalPath, contents, { encoding: "utf8", mode: 0o600 });
  const after = await Promise.all([readOrdinaryFile(externalPath), readOrdinaryFile(internalPath)]);
  if (!sameEvidenceFiles(after[0], after[1]) || after[0]!.device !== before[0]!.device
    || after[0]!.inode !== before[0]!.inode || after[0]!.contents !== contents) {
    throw new Error(`Standalone transaction evidence for '${staging}' changed while installation was prepared`);
  }
}

function transactionEvidence(
  staging: string,
  outputPath: string,
  location: TransactionLocation,
  transactionToken: string,
  phase: TransactionJournal["phase"],
  operations: readonly StandaloneJournalOperation[],
): TransactionEvidence {
  assertTransactionOperationCount(operations.length);
  return {
    formatVersion: 2,
    kind: "velar-standalone-transaction-evidence",
    outputPath,
    stagingDirectory: staging,
    ...location,
    ownerPid: process.pid,
    transactionToken,
    phase,
    operationsSha256: operationDigest(operations),
  };
}

async function recoverStandaloneTransactions(
  outputPath: string,
  project: ProjectResult,
  additionalInputs: readonly AdditionalBuildInput[],
  claim: BuildOutputClaimLease,
): Promise<void> {
  const outputRoot = dirname(outputPath);
  const prefix = `.velar-${basename(outputPath)}-`;
  const directory = await opendir(outputRoot);
  let entryCount = 0;
  for await (const entry of directory) {
    if (entryCount >= MAX_STANDALONE_TRANSACTION_OPERATIONS) {
      throw new RangeError(`Standalone output inventory cannot exceed ${MAX_STANDALONE_TRANSACTION_OPERATIONS} entries`);
    }
    entryCount += 1;
    if (!entry.name.startsWith(prefix) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const staging = resolve(outputRoot, entry.name);
    const journal = await readTransactionJournal(staging, outputPath);
    if (!journal) continue;
    if (processIsAlive(journal.ownerPid)) {
      throw new Error(`Standalone output '${outputPath}' is already being written by process ${journal.ownerPid}`);
    }
    const location: TransactionLocation = {
      canonicalOutputRoot: journal.canonicalOutputRoot,
      canonicalStagingDirectory: journal.canonicalStagingDirectory,
    };
    await assertCanonicalTransactionPaths(staging, outputPath, location, journal.operations);
    await assertAuthorizedStandaloneJournalOperations(staging, outputPath, journal.operations);
    await claim.extend([
      { path: staging, kind: "tree" },
      { path: transactionEvidencePath(staging), kind: "file" },
      ...journal.operations.map((operation) => ({
        path: resolve(outputRoot, operation.target),
        kind: operation.kind,
      })),
    ]);
    const claimedJournal = await readTransactionJournal(staging, outputPath);
    if (!claimedJournal || !sameTransactionJournal(journal, claimedJournal)) {
      throw new Error(`Standalone transaction evidence for '${staging}' changed while it was being claimed`);
    }
    await assertBuildOutputClaimsOutsideInputs(project, [
      { path: staging, kind: "tree" },
      ...claimedJournal.operations.map((operation): BuildOutputClaim => ({
        path: resolve(outputRoot, operation.target),
        kind: operation.kind,
      })),
    ], additionalInputs);
    if (claimedJournal.phase === "installing") {
      await restoreInterruptedStandaloneOperations(staging, outputPath, claimedJournal.operations);
    } else if (claimedJournal.phase === "installed") {
      await assertInstalledStandaloneOperations(staging, outputPath, claimedJournal.operations);
    }
    await rm(staging, { recursive: true, force: true });
    await rm(transactionEvidencePath(staging), { force: true });
  }
}

async function readTransactionJournal(staging: string, outputPath: string): Promise<VerifiedTransactionJournal | null> {
  try {
    const stagingMetadata = await lstat(staging);
    const marker = join(staging, TRANSACTION_MARKER);
    const markerFile = await readOrdinaryFile(marker);
    if (!stagingMetadata.isDirectory() || stagingMetadata.isSymbolicLink()
      || markerFile === null) return null;
    const value = JSON.parse(markerFile.contents) as Partial<TransactionJournal>;
    if (!hasExactKeys(value, ["canonicalOutputRoot", "canonicalStagingDirectory", "formatVersion", "kind", "operations", "outputPath", "ownerPid", "phase", "stagingDirectory", "transactionToken"])
      || value.formatVersion !== 2 || value.kind !== "velar-standalone-transaction"
      || value.outputPath !== outputPath || value.stagingDirectory !== staging
      || typeof value.canonicalOutputRoot !== "string" || !isAbsolute(value.canonicalOutputRoot)
      || resolve(value.canonicalOutputRoot) !== value.canonicalOutputRoot
      || typeof value.canonicalStagingDirectory !== "string" || !isAbsolute(value.canonicalStagingDirectory)
      || resolve(value.canonicalStagingDirectory) !== value.canonicalStagingDirectory
      || !Number.isSafeInteger(value.ownerPid) || (value.ownerPid ?? 0) <= 0
      || !validTransactionToken(value.transactionToken)
      || value.phase !== "staging" && value.phase !== "installing" && value.phase !== "installed"
      || !Array.isArray(value.operations)) return null;
    if (value.operations.length > MAX_STANDALONE_TRANSACTION_OPERATIONS) {
      throw new StandaloneRestoreError(
        `Standalone transaction '${staging}' exceeds the operation limit; its outputs and recovery evidence were preserved`,
      );
    }
    const operations: StandaloneJournalOperation[] = [];
    const targets = new Set<string>();
    for (const candidate of value.operations) {
      if (!isJournalOperation(candidate, dirname(outputPath), staging)) return null;
      const target = resolve(dirname(outputPath), candidate.target);
      if (targets.has(target)) return null;
      targets.add(target);
      operations.push(candidate);
    }
    const journal = { ...value, operations } as TransactionJournal;
    const evidence = await readTransactionEvidence(staging, outputPath);
    if (evidence === null) return null;
    if (!sameTransactionEvidence(journal, evidence)) {
      throw new StandaloneRestoreError(
        `Standalone transaction '${staging}' has an incomplete phase transition; its outputs and recovery evidence were preserved`,
      );
    }
    if (!validTransactionPhase(journal.phase, journal.operations.length)) {
      throw new StandaloneRestoreError(
        `Standalone transaction '${staging}' has an invalid ${journal.phase} operation set; its outputs and recovery evidence were preserved`,
      );
    }
    return { ...journal, evidenceDevice: evidence.evidenceDevice, evidenceInode: evidence.evidenceInode };
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function readTransactionEvidence(staging: string, outputPath: string): Promise<VerifiedTransactionEvidence | null> {
  try {
    const external = await readOrdinaryFile(transactionEvidencePath(staging));
    const internal = await readOrdinaryFile(join(staging, STANDALONE_TRANSACTION_EVIDENCE_MARKER));
    if (external === null || internal === null || external.contents !== internal.contents
      || external.device !== internal.device || external.inode !== internal.inode) return null;
    const value = JSON.parse(external.contents) as Partial<TransactionEvidence>;
    if (!hasExactKeys(value, ["canonicalOutputRoot", "canonicalStagingDirectory", "formatVersion", "kind", "operationsSha256", "outputPath", "ownerPid", "phase", "stagingDirectory", "transactionToken"])
      || value.formatVersion !== 2 || value.kind !== "velar-standalone-transaction-evidence"
      || value.outputPath !== outputPath || value.stagingDirectory !== staging
      || typeof value.canonicalOutputRoot !== "string" || !isAbsolute(value.canonicalOutputRoot)
      || resolve(value.canonicalOutputRoot) !== value.canonicalOutputRoot
      || typeof value.canonicalStagingDirectory !== "string" || !isAbsolute(value.canonicalStagingDirectory)
      || resolve(value.canonicalStagingDirectory) !== value.canonicalStagingDirectory
      || !Number.isSafeInteger(value.ownerPid) || (value.ownerPid ?? 0) <= 0
      || !validTransactionToken(value.transactionToken)
      || value.phase !== "staging" && value.phase !== "installing" && value.phase !== "installed"
      || typeof value.operationsSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.operationsSha256)) return null;
    return {
      ...value as TransactionEvidence,
      evidenceDevice: external.device,
      evidenceInode: external.inode,
    };
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR") || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function readOrdinaryFile(path: string): Promise<OrdinaryFileSnapshot | null> {
  try {
    const before = await lstat(path, {bigint: true});
    if (!before.isFile() || before.isSymbolicLink()) return null;
    if (before.size > BigInt(MAX_STANDALONE_TRANSACTION_METADATA_BYTES)) {
      throw new RangeError(`Standalone transaction metadata '${path}' exceeds ${MAX_STANDALONE_TRANSACTION_METADATA_BYTES} bytes`);
    }
    const handle = await open(path, "r");
    try {
      const opened = await handle.stat({bigint: true});
      if (!opened.isFile() || !sameOrdinaryIdentity(before, opened)) return null;
      const contents = (await readBoundedFileHandle(
        handle,
        MAX_STANDALONE_TRANSACTION_METADATA_BYTES,
        `Standalone transaction metadata '${path}'`,
      )).toString("utf8");
      const after = await handle.stat({bigint: true});
      const afterPath = await lstat(path, {bigint: true});
      if (!after.isFile() || !afterPath.isFile() || afterPath.isSymbolicLink()
        || !sameOrdinaryIdentity(opened, after) || !sameOrdinaryIdentity(opened, afterPath)
        || !sameOrdinarySnapshot(opened, after) || !sameOrdinarySnapshot(opened, afterPath)
        || BigInt(Buffer.byteLength(contents, "utf8")) !== after.size) return null;
      return { contents, device: after.dev, inode: after.ino };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
    throw error;
  }
}

function sameTransactionEvidence(journal: TransactionJournal, evidence: TransactionEvidence): boolean {
  return journal.outputPath === evidence.outputPath
    && journal.stagingDirectory === evidence.stagingDirectory
    && journal.canonicalOutputRoot === evidence.canonicalOutputRoot
    && journal.canonicalStagingDirectory === evidence.canonicalStagingDirectory
    && journal.ownerPid === evidence.ownerPid
    && journal.transactionToken === evidence.transactionToken
    && journal.phase === evidence.phase
    && evidence.operationsSha256 === operationDigest(journal.operations);
}

function validTransactionPhase(phase: TransactionJournal["phase"], operationCount: number): boolean {
  return operationCount <= MAX_STANDALONE_TRANSACTION_OPERATIONS
    && (phase === "staging" ? operationCount === 0 : operationCount > 0);
}

interface OrdinaryFileState {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

function sameOrdinaryIdentity(left: OrdinaryFileState, right: OrdinaryFileState): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameOrdinarySnapshot(left: OrdinaryFileState, right: OrdinaryFileState): boolean {
  return left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function assertTransactionOperationCount(operationCount: number): void {
  if (operationCount > MAX_STANDALONE_TRANSACTION_OPERATIONS) {
    throw new RangeError(`Standalone transaction cannot contain more than ${MAX_STANDALONE_TRANSACTION_OPERATIONS} operations`);
  }
}

function transactionMetadataText(value: TransactionJournal | TransactionEvidence, label: string): string {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_STANDALONE_TRANSACTION_METADATA_BYTES) {
    throw new RangeError(`${label} exceeds ${MAX_STANDALONE_TRANSACTION_METADATA_BYTES} bytes`);
  }
  return contents;
}

function sameEvidenceFiles(
  left: OrdinaryFileSnapshot | null,
  right: OrdinaryFileSnapshot | null,
): boolean {
  return left !== null && right !== null && left.contents === right.contents
    && left.device === right.device && left.inode === right.inode;
}

function operationDigest(operations: readonly StandaloneJournalOperation[]): string {
  return createHash("sha256").update(JSON.stringify(operations)).digest("hex");
}

function sameTransactionJournal(left: VerifiedTransactionJournal, right: VerifiedTransactionJournal): boolean {
  return left.outputPath === right.outputPath
    && left.stagingDirectory === right.stagingDirectory
    && left.canonicalOutputRoot === right.canonicalOutputRoot
    && left.canonicalStagingDirectory === right.canonicalStagingDirectory
    && left.ownerPid === right.ownerPid
    && left.transactionToken === right.transactionToken
    && left.phase === right.phase
    && left.evidenceDevice === right.evidenceDevice
    && left.evidenceInode === right.evidenceInode
    && JSON.stringify(left.operations) === JSON.stringify(right.operations);
}

function isJournalOperation(value: unknown, outputRoot: string, staging: string): value is StandaloneJournalOperation {
  if (!hasExactKeys(value, ["backup", "hadPrevious", "kind", "previousIdentity", "staged", "stagedIdentity", "target"])) return false;
  const candidate = value as Partial<StandaloneJournalOperation>;
  return isSafeRelative(outputRoot, candidate.target)
    && (candidate.staged === null || isSafeRelative(staging, candidate.staged))
    && (candidate.backup === null || isSafeRelative(staging, candidate.backup))
    && (candidate.kind === "file" || candidate.kind === "tree")
    && typeof candidate.hadPrevious === "boolean"
    && (candidate.staged === null ? candidate.stagedIdentity === null : isStandaloneOutputIdentity(candidate.stagedIdentity, candidate.kind))
    && (candidate.hadPrevious
      ? candidate.backup !== null && isStandaloneOutputIdentity(candidate.previousIdentity, candidate.kind)
      : candidate.backup === null && candidate.previousIdentity === null)
    && (candidate.stagedIdentity !== null || candidate.previousIdentity !== null);
}

async function transactionLocation(staging: string, outputPath: string): Promise<TransactionLocation> {
  const [canonicalOutputRoot, canonicalStagingDirectory] = await Promise.all([
    canonicalizePotentialPath(dirname(outputPath)),
    canonicalizePotentialPath(staging),
  ]);
  if (!contains(canonicalOutputRoot, canonicalStagingDirectory)) {
    throw new Error(`Standalone staging directory '${staging}' escapes its output directory`);
  }
  return { canonicalOutputRoot, canonicalStagingDirectory };
}

async function assertCanonicalTransactionPaths(
  staging: string,
  outputPath: string,
  expected: TransactionLocation,
  operations: readonly StandaloneJournalOperation[],
): Promise<void> {
  const current = await transactionLocation(staging, outputPath);
  if (current.canonicalOutputRoot !== expected.canonicalOutputRoot
    || current.canonicalStagingDirectory !== expected.canonicalStagingDirectory) {
    throw new Error(`Standalone transaction roots changed before '${outputPath}' could be updated`);
  }
  for (const operation of operations) {
    await assertCanonicalMember(expected.canonicalOutputRoot, resolve(dirname(outputPath), operation.target), "output target");
    if (operation.staged !== null) {
      await assertCanonicalMember(expected.canonicalStagingDirectory, resolve(staging, operation.staged), "staged output");
    }
    if (operation.backup !== null) {
      await assertCanonicalMember(expected.canonicalStagingDirectory, resolve(staging, operation.backup), "output backup");
    }
  }
}

async function assertCanonicalMember(root: string, path: string, label: string): Promise<void> {
  const canonical = await canonicalizePotentialPath(path);
  if (!contains(root, canonical)) throw new Error(`Standalone ${label} '${path}' escapes its transaction root`);
}

function safeRelative(root: string, path: string): string {
  const fromRoot = relative(root, path);
  if (!isSafeRelative(root, fromRoot)) throw new Error(`Standalone transaction path '${path}' escapes '${root}'`);
  return fromRoot;
}

function isSafeRelative(root: string, value: unknown): value is string {
  if (typeof value !== "string" || value === "" || isAbsolute(value)) return false;
  const normalized = resolve(root, value);
  const fromRoot = relative(root, normalized);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith("../")
    && !fromRoot.startsWith("..\\") && !isAbsolute(fromRoot);
}

function contains(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith("../")
    && !fromRoot.startsWith("..\\") && !isAbsolute(fromRoot));
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isHostErrorCode(error, "EPERM");
  }
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

function transactionEvidencePath(staging: string): string {
  return `${resolve(staging)}${TRANSACTION_EVIDENCE_SUFFIX}`;
}

function validTransactionToken(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}
