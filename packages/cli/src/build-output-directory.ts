import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, opendir, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  assertAuthorizedInstalledBuildOutput,
  assertAuthorizedStagingBuildOutput,
  restorePreviousBuildOutput,
  rollbackVisibleBuildOutput,
  verifyAuthorizedInstalledBuildOutput,
  type BuildOutputAuthorization,
  type BuildOutputCommitAuthorization,
  type BuildOutputTargetSnapshot,
  type BuildStagingOwnership,
  type DirectoryBuildTransactionOperations,
  type VerifiedBuildStagingOwnership,
} from "./build-output-commit.ts";
import {
  acquireBuildOutputClaims,
  finishBuildOutputClaim,
  type BuildOutputClaimLease,
  type BuildOutputClaimRequest,
  type BuildOutputClaimResult,
} from "./build-output-claim.ts";
import {
  directoryRemovalPath,
  removeOwnedDirectory,
  type BuildDirectoryIdentity,
} from "./build-output-directory-removal.ts";
import { BUILD_STAGING_MARKER, writeExclusiveBuildFile } from "./build-staging.ts";
import { readBoundedFileHandle } from "./bounded-text.ts";
import { MAX_PRODUCTION_ASSETS } from "./file-integrity.ts";
import { hostErrorMessage, isHostErrorCode } from "./host-error.ts";
export {
  BUILD_OUTPUT_RECEIPT,
  hasBuildOutputReceipt,
  verifyBuildOutputReceiptForCommit,
  writeBuildOutputReceipt,
} from "./build-output-receipt.ts";
export const BUILD_STAGING_TRANSACTION_SUFFIX = ".velar-transaction.json";
export const MAX_BUILD_STAGING_EVIDENCE_BYTES = 256 * 1024;
const MAX_BUILD_RECOVERY_TRANSACTIONS = 1024;
const MAX_BUILD_RECOVERY_DIRECTORY_ENTRIES = MAX_PRODUCTION_ASSETS * 2;

export type { BuildDirectoryIdentity } from "./build-output-directory-removal.ts";
export type {
  BuildOutputAuthorization,
  BuildOutputTargetSnapshot,
  BuildStagingOwnership,
  DirectoryBuildTransactionOperations,
  VerifiedBuildStagingOwnership,
} from "./build-output-commit.ts";

interface OrdinaryJsonSnapshot {
  readonly value: unknown;
  readonly contents: string;
  readonly device: number | bigint;
  readonly inode: number | bigint;
}

class BuildOutputRestoreError extends Error {}

export interface ReservedBuildStaging {
  readonly directory: string;
  readonly outputDirectory: string;
  readonly transactionPath: string;
  readonly claim: BuildOutputClaimLease;
}

export interface PreparedBuildStaging extends ReservedBuildStaging {
  readonly ownership: VerifiedBuildStagingOwnership;
}

/** Atomically reserves the final tree and every same-parent transaction path before creating any of them. */
export async function reserveBuildStaging(outputDirectory: string): Promise<ReservedBuildStaging> {
  const output = resolve(outputDirectory);
  const directory = join(dirname(output), `.velar-${basename(output)}-${randomUUID()}`);
  const transactionPath = buildStagingTransactionPath(directory);
  const claim = await acquireBuildOutputClaims([
    { path: output, kind: "tree" },
    ...buildStagingClaimRequests(directory),
  ]);
  return { directory, outputDirectory: output, transactionPath, claim };
}

/** Binds the exact parent and target identities that a caller authorized for replacement. */
export async function validateBuildOutputTarget(
  outputDirectory: string,
  validate: () => Promise<void>,
): Promise<BuildOutputAuthorization> {
  const output = resolve(outputDirectory);
  const parent = dirname(output);
  const before = {
    parentIdentity: await inspectOrdinaryDirectory(parent, "build output parent"),
    targetSnapshot: await inspectTarget(output),
  };
  await validate();
  const after = {
    parentIdentity: await inspectOrdinaryDirectory(parent, "build output parent"),
    targetSnapshot: await inspectTarget(output),
  };
  if (!sameIdentity(before.parentIdentity, after.parentIdentity)) {
    throw new Error(`build output parent '${parent}' changed physical identity during replacement authorization`);
  }
  if (!sameTargetSnapshot(before.targetSnapshot, after.targetSnapshot)) throw changedTarget(output);
  return after;
}

export async function prepareClaimedBuildStaging(
  reserved: ReservedBuildStaging,
  authorization: BuildOutputAuthorization,
): Promise<PreparedBuildStaging> {
  const staging = resolve(reserved.directory);
  const output = resolve(reserved.outputDirectory);
  const transactionPath = reserved.transactionPath;
  const parent = dirname(output);
  const parentIdentity = await inspectOrdinaryDirectory(parent, "build output parent");
  const targetSnapshot = await inspectTarget(output);
  if (!sameIdentity(authorization.parentIdentity, parentIdentity)
    || !sameTargetSnapshot(authorization.targetSnapshot, targetSnapshot)) {
    throw changedTarget(output);
  }
  await mkdir(staging, { mode: 0o700 });
  const stagingIdentity = await inspectOrdinaryDirectory(staging, "directory build staging");
  const transactionToken = randomUUID();
  let transactionCreated = false;
  const ownership: BuildStagingOwnership = {
    formatVersion: 3,
    kind: "velar-build-staging",
    outputDirectory: output,
    stagingDirectory: staging,
    ownerPid: process.pid,
    transactionToken,
    parentIdentity,
    stagingIdentity,
    targetSnapshot,
  };
  let evidenceIdentity: BuildDirectoryIdentity | null = null;
  try {
    const ownershipContents = `${JSON.stringify(ownership, null, 2)}\n`;
    if (Buffer.byteLength(ownershipContents, "utf8") > MAX_BUILD_STAGING_EVIDENCE_BYTES) {
      throw new RangeError(`Directory build transaction evidence exceeds ${MAX_BUILD_STAGING_EVIDENCE_BYTES} bytes`);
    }
    await writeExclusiveBuildFile(
      transactionPath,
      ownershipContents,
      "Directory build transaction evidence",
    );
    transactionCreated = true;
    evidenceIdentity = identityOf(await lstat(transactionPath));
    await link(transactionPath, join(staging, BUILD_STAGING_MARKER));
    await assertDirectoryIdentity(parent, parentIdentity, "build output parent");
    await assertTargetSnapshot(output, targetSnapshot);
    await assertDirectoryIdentity(staging, stagingIdentity, "directory build staging");
    const verified = await readBuildStagingOwnership(staging, output, staging);
    if (!verified) throw new Error("Directory build transaction evidence changed while it was created");
    return {
      directory: staging,
      outputDirectory: output,
      transactionPath,
      claim: reserved.claim,
      ownership: verified,
    };
  } catch (error) {
    await removeOwnedDirectory(staging, stagingIdentity).catch(() => {});
    if (transactionCreated && evidenceIdentity) {
      await removeOwnedFile(transactionPath, evidenceIdentity).catch(() => {});
    }
    throw error;
  }
}

export async function releaseBuildStagingReservation(staging: ReservedBuildStaging): Promise<void> {
  try {
    await staging.claim.release();
  } catch {}
}

export function buildStagingClaimRequests(stagingDirectory: string): readonly BuildOutputClaimRequest[] {
  const staging = resolve(stagingDirectory);
  const previous = `${staging}-previous`;
  return [
    { path: staging, kind: "tree" },
    { path: previous, kind: "tree" },
    { path: directoryRemovalPath(staging), kind: "tree" },
    { path: directoryRemovalPath(previous), kind: "tree" },
    { path: buildStagingTransactionPath(staging), kind: "file" },
  ];
}

export async function readBuildStagingOwnership(
  directory: string,
  outputDirectory: string,
  expectedStaging: string | null,
): Promise<VerifiedBuildStagingOwnership | null> {
  const marker = await readOrdinaryJson(join(directory, BUILD_STAGING_MARKER));
  if (marker === null) return null;
  const ownership = parseBuildStagingOwnership(marker.value, outputDirectory, expectedStaging);
  if (ownership === null) return null;
  const evidence = await readOrdinaryJson(buildStagingTransactionPath(ownership.stagingDirectory));
  if (evidence === null || marker.contents !== evidence.contents
    || marker.device !== evidence.device || marker.inode !== evidence.inode) return null;
  try {
    const [parentIdentity, containerIdentity] = await Promise.all([
      inspectOrdinaryDirectory(dirname(resolve(outputDirectory)), "build output parent"),
      inspectOrdinaryDirectory(directory, "directory build transaction container"),
    ]);
    return sameIdentity(parentIdentity, ownership.parentIdentity)
      && sameIdentity(containerIdentity, ownership.stagingIdentity)
      ? { ...ownership, evidenceDevice: evidence.device, evidenceInode: evidence.inode }
      : null;
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
    throw error;
  }
}

/** Recovery must retain the exact hard-link pair observed before extending its lease. */
export function sameBuildStagingOwnership(
  left: VerifiedBuildStagingOwnership,
  right: VerifiedBuildStagingOwnership,
): boolean {
  return left.outputDirectory === right.outputDirectory
    && left.stagingDirectory === right.stagingDirectory
    && left.ownerPid === right.ownerPid
    && left.transactionToken === right.transactionToken
    && sameIdentity(left.parentIdentity, right.parentIdentity)
    && sameIdentity(left.stagingIdentity, right.stagingIdentity)
    && sameTargetSnapshot(left.targetSnapshot, right.targetSnapshot)
    && left.evidenceDevice === right.evidenceDevice
    && left.evidenceInode === right.evidenceInode;
}

export async function replaceOutputDirectory(
  staging: PreparedBuildStaging,
  operations: DirectoryBuildTransactionOperations = {},
): Promise<void> {
  await finishOutputDirectoryReplacement(staging, null, operations);
}

/** Commits only the exact semantically verified staging snapshot supplied by its producer. */
export async function commitBuildOutputDirectory(
  staging: PreparedBuildStaging,
  authorization: BuildOutputCommitAuthorization,
  operations: DirectoryBuildTransactionOperations = {},
): Promise<void> {
  await finishOutputDirectoryReplacement(staging, authorization, operations);
}

async function finishOutputDirectoryReplacement(
  staging: PreparedBuildStaging,
  authorization: BuildOutputCommitAuthorization | null,
  operations: DirectoryBuildTransactionOperations,
): Promise<void> {
  let result: BuildOutputClaimResult;
  try {
    await replaceClaimedOutputDirectory(staging, authorization, operations);
    result = { status: "committed" };
  } catch (error) {
    result = { status: "failed", error };
  }
  await finishBuildOutputClaim(staging.claim, result, async () => {
    if (result.status === "failed" && !(result.error instanceof BuildOutputRestoreError)) {
      await cleanupUninstalledTransaction(staging.ownership, operations);
    }
  });
}

export async function discardBuildStaging(staging: PreparedBuildStaging, failure?: unknown): Promise<void> {
  if (!(failure instanceof BuildOutputRestoreError)) {
    try {
      await cleanupUninstalledTransaction(staging.ownership, {});
    } catch {}
  }
  try {
    await staging.claim.release();
  } catch {}
}

async function replaceClaimedOutputDirectory(
  staging: PreparedBuildStaging,
  authorization: BuildOutputCommitAuthorization | null,
  operations: DirectoryBuildTransactionOperations,
): Promise<void> {
  const renamePath = operations.renamePath ?? rename;
  const ownership = await requirePreparedOwnership(staging);
  const { outputDirectory: output, stagingDirectory: stagingPath } = ownership;
  const previous = `${stagingPath}-previous`;
  let movedPrevious = false;
  let secondRenameStarted = false;
  let installed = false;
  try {
    await assertTransactionInputs(ownership);
    await operations.beforeStagingCommitValidation?.();
    if (authorization !== null) await assertAuthorizedStagingBuildOutput(ownership, authorization);
    if (ownership.targetSnapshot.status === "directory") {
      await assertMissing(previous, "previous directory build output");
      await renamePath(output, previous);
      movedPrevious = true;
      await operations.afterFirstRename?.();
      await assertDirectoryIdentity(previous, ownership.targetSnapshot.identity, "previous directory build output");
    }
    await assertDirectoryIdentity(dirname(output), ownership.parentIdentity, "build output parent");
    await assertMissing(output, "directory build output");
    await assertDirectoryIdentity(stagingPath, ownership.stagingIdentity, "directory build staging");
    if (ownership.targetSnapshot.status === "directory") {
      await assertDirectoryIdentity(previous, ownership.targetSnapshot.identity, "previous directory build output");
    }
    if (authorization !== null) await assertAuthorizedStagingBuildOutput(ownership, authorization);
    secondRenameStarted = true;
    await renamePath(stagingPath, output);
    installed = true;
    await operations.afterSecondRename?.();
    await assertDirectoryIdentity(dirname(output), ownership.parentIdentity, "build output parent");
    await assertDirectoryIdentity(output, ownership.stagingIdentity, "installed directory build output");
    if (ownership.targetSnapshot.status === "directory") {
      await assertDirectoryIdentity(previous, ownership.targetSnapshot.identity, "previous directory build output");
    }
    if (authorization !== null) {
      await assertAuthorizedInstalledBuildOutput(ownership, authorization);
      await verifyAuthorizedInstalledBuildOutput(ownership, authorization);
      await assertAuthorizedInstalledBuildOutput(ownership, authorization);
    }
  } catch (error) {
    if (installed || secondRenameStarted && await pathExists(output)) {
      try {
        await rollbackVisibleBuildOutput(ownership, previous, renamePath);
      } catch (restoreError) {
        throw new BuildOutputRestoreError(
          `Build output '${output}' became visible but its physical identity could not be verified; previous output and transaction evidence were preserved: ${hostErrorMessage(restoreError)}`,
          { cause: error },
        );
      }
      throw error;
    }
    if (movedPrevious) {
      try {
        await restorePreviousBuildOutput(ownership, previous, renamePath);
      } catch (restoreError) {
        throw new BuildOutputRestoreError(
          `Build output replacement failed and the previous output could not be restored: ${hostErrorMessage(restoreError)}`,
          { cause: error },
        );
      }
    }
    throw error;
  }

  try {
    await cleanupInstalledTransaction(ownership, operations);
  } catch {}
}

async function requirePreparedOwnership(staging: PreparedBuildStaging): Promise<VerifiedBuildStagingOwnership> {
  const current = await readBuildStagingOwnership(
    staging.directory, staging.outputDirectory, staging.directory,
  );
  if (!current || !sameBuildStagingOwnership(staging.ownership, current)) {
    throw new Error(`Directory build staging '${staging.directory}' changed physical identity`);
  }
  return current;
}

async function assertTransactionInputs(ownership: VerifiedBuildStagingOwnership): Promise<void> {
  await assertDirectoryIdentity(dirname(ownership.outputDirectory), ownership.parentIdentity, "build output parent");
  await assertTargetSnapshot(ownership.outputDirectory, ownership.targetSnapshot);
  await assertDirectoryIdentity(ownership.stagingDirectory, ownership.stagingIdentity, "directory build staging");
}

async function cleanupInstalledTransaction(
  ownership: VerifiedBuildStagingOwnership,
  operations: DirectoryBuildTransactionOperations,
): Promise<void> {
  const removePath = operations.removePath ?? rm;
  const previous = `${ownership.stagingDirectory}-previous`;
  await assertDirectoryIdentity(dirname(ownership.outputDirectory), ownership.parentIdentity, "build output parent");
  await assertDirectoryIdentity(ownership.outputDirectory, ownership.stagingIdentity, "installed directory build output");
  await assertEvidenceFile(join(ownership.outputDirectory, BUILD_STAGING_MARKER), ownership);
  await assertEvidenceFile(buildStagingTransactionPath(ownership.stagingDirectory), ownership);
  if (ownership.targetSnapshot.status === "directory") {
    await operations.beforePreviousCleanup?.();
    await removeOwnedDirectory(
      previous,
      ownership.targetSnapshot.identity,
      operations.renamePath ?? rename,
      removePath,
    );
  } else {
    await assertMissing(previous, "previous directory build output");
  }
  await assertDirectoryIdentity(ownership.outputDirectory, ownership.stagingIdentity, "installed directory build output");
  await removeOwnedFile(buildStagingTransactionPath(ownership.stagingDirectory), evidenceIdentity(ownership));
  await assertDirectoryIdentity(ownership.outputDirectory, ownership.stagingIdentity, "installed directory build output");
  await removeOwnedFile(join(ownership.outputDirectory, BUILD_STAGING_MARKER), evidenceIdentity(ownership));
}

async function cleanupUninstalledTransaction(
  ownership: VerifiedBuildStagingOwnership,
  operations: DirectoryBuildTransactionOperations,
): Promise<void> {
  const stagingContainer = await transactionStagingContainer(ownership);
  await assertDirectoryIdentity(dirname(ownership.outputDirectory), ownership.parentIdentity, "build output parent");
  await assertEvidenceFile(join(stagingContainer, BUILD_STAGING_MARKER), ownership);
  await assertEvidenceFile(buildStagingTransactionPath(ownership.stagingDirectory), ownership);
  await operations.beforeStagingCleanup?.();
  await removeOwnedDirectory(
    ownership.stagingDirectory,
    ownership.stagingIdentity,
    operations.renamePath ?? rename,
    operations.removePath ?? rm,
  );
  await removeOwnedFile(buildStagingTransactionPath(ownership.stagingDirectory), evidenceIdentity(ownership));
}

async function transactionStagingContainer(ownership: VerifiedBuildStagingOwnership): Promise<string> {
  try {
    await assertDirectoryIdentity(ownership.stagingDirectory, ownership.stagingIdentity, "directory build staging");
    return ownership.stagingDirectory;
  } catch (error) {
    if (!isHostErrorCode(error, "ENOENT") && !isHostErrorCode(error, "ENOTDIR")) throw error;
  }
  const removing = directoryRemovalPath(ownership.stagingDirectory);
  await assertDirectoryIdentity(removing, ownership.stagingIdentity, "directory build staging removal isolation");
  return removing;
}

/** Recovers only crash residue whose directory and evidence identities still match its record. */
export async function recoverInterruptedBuilds(
  outputDirectory: string,
  claim: BuildOutputClaimLease,
  verifyGeneratedOutput: (directory: string, expectedOutput: string) => Promise<boolean>,
  operations: DirectoryBuildTransactionOperations = {},
): Promise<void> {
  const output = resolve(outputDirectory);
  const parent = dirname(output);
  const parentIdentity = await inspectOrdinaryDirectory(parent, "build output parent");
  const installedCandidate = await readBuildStagingOwnership(output, output, null);
  if (installedCandidate) {
    if (processIsAlive(installedCandidate.ownerPid)) {
      throw new Error(`Directory build output '${output}' has an active replacement transaction in process ${installedCandidate.ownerPid}`);
    }
    await claim.extend(buildStagingClaimRequests(installedCandidate.stagingDirectory));
    await operations.afterRecoveryClaim?.();
    const installed = await readBuildStagingOwnership(output, output, installedCandidate.stagingDirectory);
    if (!installed || !sameBuildStagingOwnership(installedCandidate, installed)) {
      throw new Error(`Interrupted build evidence for '${output}' changed while it was being claimed`);
    }
    await assertDirectoryIdentity(parent, parentIdentity, "build output parent");
    if (!await verifyGeneratedOutput(output, output)) {
      throw new Error(`interrupted build backup '${installed.stagingDirectory}-previous' was preserved because '${output}' has no verified build receipt; inspect the residue before retrying`);
    }
    await assertDirectoryIdentity(output, installed.stagingIdentity, "installed directory build output");
    await validateRecoveryPrevious(installed);
    await cleanupInstalledTransaction(installed, operations);
  }

  await assertDirectoryIdentity(parent, parentIdentity, "build output parent");
  const candidates: string[] = [];
  let entries = 0;
  for await (const entry of await opendir(parent)) {
    entries += 1;
    if (entries > MAX_BUILD_RECOVERY_DIRECTORY_ENTRIES) {
      throw new RangeError(`Directory build recovery cannot inspect more than ${MAX_BUILD_RECOVERY_DIRECTORY_ENTRIES} sibling entries`);
    }
    const prefix = `.velar-${basename(output)}-`;
    if (!entry.name.startsWith(prefix) || !entry.isDirectory()
      || entry.name.endsWith("-previous") || entry.name.endsWith("-previous-removing")) continue;
    candidates.push(entry.name);
    if (candidates.length > MAX_BUILD_RECOVERY_TRANSACTIONS) {
      throw new RangeError(`Directory build recovery cannot inspect more than ${MAX_BUILD_RECOVERY_TRANSACTIONS} transaction candidates`);
    }
  }
  for (const candidateName of candidates) {
    const container = resolve(parent, candidateName);
    const staging = candidateName.endsWith("-removing")
      ? container.slice(0, -"-removing".length)
      : container;
    const candidate = await readBuildStagingOwnership(container, output, staging);
    if (!candidate) continue;
    if (processIsAlive(candidate.ownerPid)) {
      throw new Error(`Directory build output '${output}' has an active replacement transaction in process ${candidate.ownerPid}`);
    }
    await claim.extend(buildStagingClaimRequests(staging));
    await operations.afterRecoveryClaim?.();
    const ownership = await readBuildStagingOwnership(container, output, staging);
    if (!ownership || !sameBuildStagingOwnership(candidate, ownership)) {
      throw new Error(`Interrupted build evidence for '${container}' changed while it was being claimed`);
    }
    await recoverUninstalledTransaction(ownership, operations);
  }
}

async function validateRecoveryPrevious(
  ownership: VerifiedBuildStagingOwnership,
): Promise<void> {
  const previous = `${ownership.stagingDirectory}-previous`;
  if (ownership.targetSnapshot.status === "missing") {
    await assertMissing(previous, "interrupted directory build backup");
    return;
  }
  try {
    await assertDirectoryIdentity(previous, ownership.targetSnapshot.identity, "interrupted directory build backup");
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return;
    throw error;
  }
}

async function recoverUninstalledTransaction(
  ownership: VerifiedBuildStagingOwnership,
  operations: DirectoryBuildTransactionOperations,
): Promise<void> {
  const output = ownership.outputDirectory;
  const previous = `${ownership.stagingDirectory}-previous`;
  const currentTarget = await inspectTarget(output);
  const previousTarget = await inspectTarget(previous);
  if (ownership.targetSnapshot.status === "missing") {
    if (previousTarget.status === "directory" || currentTarget.status === "directory") {
      throw new Error(`interrupted build residue was preserved because a later directory appeared at '${currentTarget.status === "directory" ? output : previous}'`);
    }
    await cleanupUninstalledTransaction(ownership, operations);
    return;
  }
  if (previousTarget.status === "directory") {
    if (!sameIdentity(previousTarget.identity, ownership.targetSnapshot.identity)) {
      throw new Error(`interrupted directory build backup '${previous}' changed physical identity; it was preserved for inspection`);
    }
    if (currentTarget.status === "directory") {
      throw new Error(`interrupted build has both output '${output}' and backup '${previous}'; both were preserved for inspection`);
    }
    await operations.beforeRecoveryRestore?.();
    await assertDirectoryIdentity(dirname(output), ownership.parentIdentity, "build output parent");
    await assertMissing(output, "directory build output during recovery");
    await assertDirectoryIdentity(previous, ownership.targetSnapshot.identity, "interrupted directory build backup");
    await (operations.renamePath ?? rename)(previous, output);
    await assertDirectoryIdentity(output, ownership.targetSnapshot.identity, "restored directory build output");
    await cleanupUninstalledTransaction(ownership, operations);
    return;
  }
  if (currentTarget.status === "directory"
    && sameIdentity(currentTarget.identity, ownership.targetSnapshot.identity)) {
    await cleanupUninstalledTransaction(ownership, operations);
    return;
  }
  throw new Error(`interrupted build residue for '${output}' no longer matches its authorized target; all paths were preserved for inspection`);
}

export function buildStagingTransactionPath(stagingDirectory: string): string {
  return `${resolve(stagingDirectory)}${BUILD_STAGING_TRANSACTION_SUFFIX}`;
}

function parseBuildStagingOwnership(
  value: unknown,
  outputDirectory: string,
  expectedStaging: string | null,
): BuildStagingOwnership | null {
  if (!hasExactKeys(value, [
    "formatVersion", "kind", "outputDirectory", "ownerPid", "parentIdentity",
    "stagingDirectory", "stagingIdentity", "targetSnapshot", "transactionToken",
  ])) return null;
  const staging = value.stagingDirectory;
  return value.formatVersion === 3
    && value.kind === "velar-build-staging"
    && value.outputDirectory === resolve(outputDirectory)
    && typeof staging === "string"
    && isAbsolute(staging)
    && resolve(staging) === staging
    && dirname(staging) === dirname(resolve(outputDirectory))
    && basename(staging).startsWith(`.velar-${basename(outputDirectory)}-`)
    && (expectedStaging === null || staging === resolve(expectedStaging))
    && validOwner(value.ownerPid)
    && validToken(value.transactionToken)
    && validDirectoryIdentity(value.parentIdentity)
    && validDirectoryIdentity(value.stagingIdentity)
    && validTargetSnapshot(value.targetSnapshot)
    ? value as unknown as BuildStagingOwnership
    : null;
}

async function readOrdinaryJson(path: string): Promise<OrdinaryJsonSnapshot | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const pathBefore = await lstat(path);
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) return null;
    handle = await open(path, "r");
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== pathBefore.dev || before.ino !== pathBefore.ino) return null;
    const contents = (await readBoundedFileHandle(
      handle,
      MAX_BUILD_STAGING_EVIDENCE_BYTES,
      `Directory build transaction evidence '${path}'`,
    )).toString("utf8");
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino
      || !pathAfter.isFile() || pathAfter.isSymbolicLink()
      || after.dev !== pathAfter.dev || after.ino !== pathAfter.ino) return null;
    return { value: JSON.parse(contents), contents, device: after.dev, inode: after.ino };
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR") || error instanceof SyntaxError) return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function inspectTarget(path: string): Promise<BuildOutputTargetSnapshot> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error(`refusing to replace '${path}': it is a symbolic link`);
    if (!metadata.isDirectory()) throw new Error(`refusing to replace '${path}': it is not a directory`);
    return { status: "directory", identity: identityOf(metadata) };
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT")) return { status: "missing" };
    throw error;
  }
}

async function inspectOrdinaryDirectory(path: string, label: string): Promise<BuildDirectoryIdentity> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} '${path}' must be an ordinary directory`);
  }
  return identityOf(metadata);
}

async function assertDirectoryIdentity(
  path: string,
  expected: BuildDirectoryIdentity,
  label: string,
): Promise<void> {
  const actual = await inspectOrdinaryDirectory(path, label);
  if (!sameIdentity(expected, actual)) throw new Error(`${label} '${path}' changed physical identity`);
}

async function assertTargetSnapshot(path: string, expected: BuildOutputTargetSnapshot): Promise<void> {
  if (!sameTargetSnapshot(expected, await inspectTarget(path))) throw changedTarget(path);
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

async function assertEvidenceFile(
  path: string,
  ownership: VerifiedBuildStagingOwnership,
): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || metadata.dev !== ownership.evidenceDevice || metadata.ino !== ownership.evidenceInode) {
    throw new Error(`directory build transaction evidence '${path}' changed physical identity`);
  }
}

async function removeOwnedFile(path: string, expected: BuildDirectoryIdentity): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !sameIdentity(identityOf(metadata), expected)) return;
    await unlink(path);
  } catch (error) {
    if (!isHostErrorCode(error, "ENOENT") && !isHostErrorCode(error, "ENOTDIR")) throw error;
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

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isHostErrorCode(error, "EPERM");
  }
}

function identityOf(metadata: { readonly dev: number | bigint; readonly ino: number | bigint }): BuildDirectoryIdentity {
  return { device: metadata.dev.toString(), inode: metadata.ino.toString() };
}

function evidenceIdentity(ownership: VerifiedBuildStagingOwnership): BuildDirectoryIdentity {
  return { device: ownership.evidenceDevice.toString(), inode: ownership.evidenceInode.toString() };
}

function sameIdentity(left: BuildDirectoryIdentity, right: BuildDirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function sameTargetSnapshot(left: BuildOutputTargetSnapshot, right: BuildOutputTargetSnapshot): boolean {
  return left.status === "missing"
    ? right.status === "missing"
    : right.status === "directory" && sameIdentity(left.identity, right.identity);
}

function changedTarget(path: string): Error {
  return new Error(`refusing to replace '${path}': the build output changed physical identity`);
}

function validDirectoryIdentity(value: unknown): value is BuildDirectoryIdentity {
  return hasExactKeys(value, ["device", "inode"])
    && decimalIdentity(value.device, true) && decimalIdentity(value.inode, false);
}

function validTargetSnapshot(value: unknown): value is BuildOutputTargetSnapshot {
  if (!hasExactKeys(value, value !== null && typeof value === "object"
    && !Array.isArray(value) && (value as { readonly status?: unknown }).status === "missing"
    ? ["status"] : ["identity", "status"])) return false;
  return value.status === "missing" || value.status === "directory" && validDirectoryIdentity(value.identity);
}

function decimalIdentity(value: unknown, allowZero: boolean): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)
    && (allowZero || value !== "0");
}

function validOwner(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validToken(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}
