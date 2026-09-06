import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { acquireBuildOutputClaims } from "../packages/cli/src/build-output-claim.ts";
import {
  readTransactionFile,
  scanTransactionCandidates,
} from "../packages/cli/src/transaction-metadata.ts";

const TRANSACTION_MARKER = ".velar-release-output-transaction.json";
const releaseClaimLeases = new WeakMap();

/**
 * Chooses every path a release can mutate before acquiring one canonical
 * file/tree claim lease for the complete set. The parent deliberately remains
 * outside the claim: independent sibling outputs may still build concurrently.
 */
export async function acquireReleaseOutputClaim(outputDirectory, options = {}) {
  const output = resolve(outputDirectory);
  const token = options.token ?? randomUUID();
  if (!validToken(token)) throw new Error("release output transaction token must be a UUID v4");
  const prefix = `.velar-${basename(output)}-release`;
  const staging = join(dirname(output), `${prefix}-staging-${token}`);
  const backup = join(dirname(output), `${prefix}-backup-${token}`);
  const marker = join(backup, TRANSACTION_MARKER);
  const anchor = transactionAnchor(output, token);
  const lease = await acquireBuildOutputClaims([
    { path: output, kind: "tree" },
    { path: staging, kind: "tree" },
    { path: backup, kind: "tree" },
    // The backup tree covers its marker, but name the evidence path explicitly
    // so this complete mutation set stays visible at the protocol boundary.
    { path: marker, kind: "file" },
    { path: anchor, kind: "file" },
  ]);
  const state = { lease, released: false, parentIdentity: null, targetSnapshot: null, stagingIdentity: null };
  const claim = Object.freeze({
    token,
    outputDirectory: output,
    stagingDirectory: staging,
    backupDirectory: backup,
    transactionMarkerPath: marker,
    transactionAnchorPath: anchor,
    release: async () => {
      if (state.released) return;
      await lease.release();
      state.released = true;
    },
  });
  releaseClaimLeases.set(claim, state);
  return claim;
}

/**
 * Completes or rolls back a same-parent directory replacement. Once staging has
 * been installed, cleanup is deliberately best-effort: the new release is the
 * committed result and a later run can reclaim the authenticated backup.
 */
export async function replaceReleaseDirectory(
  claim,
  validateReplaceable,
  operations = {},
) {
  const state = requireReleaseClaimState(claim);
  const staging = claim.stagingDirectory;
  const output = claim.outputDirectory;
  const parent = dirname(output);
  const backup = claim.backupDirectory;
  const marker = claim.transactionMarkerPath;
  const anchor = claim.transactionAnchorPath;
  const renamePath = operations.renamePath ?? rename;
  const removePath = operations.removePath ?? rm;
  const previous = join(backup, "previous");

  const parentIdentity = await bindReleaseParentIdentity(state, parent);
  const validatedTarget = await validatedTargetSnapshot(output, validateReplaceable);
  const targetSnapshot = state.targetSnapshot ?? validatedTarget;
  if (!sameTargetSnapshot(targetSnapshot, validatedTarget)) throw changedIdentity(output);
  state.targetSnapshot = targetSnapshot;
  const validatedStaging = await validatedDirectoryIdentity(staging, validateReplaceable, "release staging directory");
  const stagingIdentity = state.stagingIdentity ?? validatedStaging;
  if (!sameFile(stagingIdentity, validatedStaging)) {
    throw new Error(`release staging directory '${staging}' changed physical identity`);
  }
  state.stagingIdentity = stagingIdentity;
  await assertDirectoryIdentity(parent, parentIdentity, "release output parent");

  await mkdir(backup, { mode: 0o700 });
  const backupIdentity = await inspectOrdinaryDirectory(backup, "release backup directory");
  const record = {
    formatVersion: 2,
    kind: "velar-release-output-transaction",
    outputDirectory: output,
    parentDirectory: parent,
    parentIdentity: serializedIdentity(parentIdentity),
    targetSnapshot: serializedTargetSnapshot(targetSnapshot),
    previousDirectory: previous,
    previousIdentity: targetSnapshot.status === "directory" ? serializedIdentity(targetSnapshot.identity) : null,
    stagingDirectory: staging,
    stagingIdentity: serializedIdentity(stagingIdentity),
    backupDirectory: resolve(backup),
    backupIdentity: serializedIdentity(backupIdentity),
    anchorPath: anchor,
    ownerPid: process.pid,
    token: claim.token,
  };
  let markerIdentity = null;
  let transactionEvidence;
  try {
    await writeFile(marker, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    markerIdentity = identityOf(await lstat(marker));
    // A recovery record is authoritative only while this same inode is also
    // present at its independently derived sibling anchor path.
    await link(marker, anchor);
    transactionEvidence = await readTransaction(backup, output);
    if (!transactionEvidence) throw new Error("release output transaction evidence changed while it was created");
    assertRecordAuthority(transactionEvidence.record, {
      parentIdentity,
      targetSnapshot,
      stagingIdentity,
      backupIdentity,
    });
  } catch (error) {
    await removeOwnedDirectory(backup, backupIdentity, removePath);
    if (markerIdentity !== null) await removeOwnedFile(anchor, markerIdentity);
    throw error;
  }

  let movedPrevious = false;
  let secondRenameStarted = false;
  let installed = false;
  try {
    await assertDirectoryIdentity(parent, parentIdentity, "release output parent");
    await assertTargetSnapshot(output, targetSnapshot);
    await assertDirectoryIdentity(staging, stagingIdentity, "release staging directory");
    await assertDirectoryIdentity(backup, backupIdentity, "release backup directory");
    await assertEvidencePair(marker, anchor, transactionEvidence.identity, transactionEvidence.contents);
    if (targetSnapshot.status === "directory") {
      await assertMissing(previous, "previous release directory");
      await renamePath(output, previous);
      movedPrevious = true;
      await operations.afterFirstRename?.();
      await assertDirectoryIdentity(parent, parentIdentity, "release output parent");
      await assertDirectoryIdentity(backup, backupIdentity, "release backup directory");
      await assertEvidencePair(marker, anchor, transactionEvidence.identity, transactionEvidence.contents);
      await assertDirectoryIdentity(staging, stagingIdentity, "release staging directory");
      const movedIdentity = await inspectOrdinaryDirectory(previous, "previous release directory");
      if (!sameFile(movedIdentity, targetSnapshot.identity)) throw changedIdentity(output);
    }

    await assertDirectoryIdentity(parent, parentIdentity, "release output parent");
    await assertMissing(output, "release output");
    await assertDirectoryIdentity(staging, stagingIdentity, "release staging directory");
    await assertDirectoryIdentity(backup, backupIdentity, "release backup directory");
    await assertEvidencePair(marker, anchor, transactionEvidence.identity, transactionEvidence.contents);
    if (targetSnapshot.status === "directory") {
      await assertDirectoryIdentity(previous, targetSnapshot.identity, "previous release directory");
    }
    secondRenameStarted = true;
    await renamePath(staging, output);
    installed = true;
    await operations.afterSecondRename?.();
    await assertDirectoryIdentity(parent, parentIdentity, "release output parent");
    await assertDirectoryIdentity(output, stagingIdentity, "installed release directory");
    await assertDirectoryIdentity(backup, backupIdentity, "release backup directory");
    await assertEvidencePair(marker, anchor, transactionEvidence.identity, transactionEvidence.contents);
    if (targetSnapshot.status === "directory") {
      await assertDirectoryIdentity(previous, targetSnapshot.identity, "previous release directory");
    }
  } catch (error) {
    if (installed || (secondRenameStarted && await pathExists(output))) {
      throw new Error(
        `release output '${output}' became visible but its physical identity could not be verified; previous release and transaction evidence were preserved`,
        { cause: error },
      );
    }
    if (movedPrevious) {
      try {
        const movedIdentity = await inspectOrdinaryDirectory(previous, "previous release directory");
        await restoreMovedRelease(parent, parentIdentity, previous, output, movedIdentity, renamePath);
        movedPrevious = false;
      } catch (restoreError) {
        throw new Error(
          `release output replacement failed and the previous release could not be restored: ${errorMessage(restoreError)}`,
          { cause: error },
        );
      }
    }
    try {
      await cleanupOwnedTransaction({
        output,
        parent,
        parentIdentity,
        backup,
        backupIdentity,
        anchor,
        evidenceIdentity: transactionEvidence.identity,
        evidenceContents: transactionEvidence.contents,
        staging,
        installedIdentity: null,
        previousIdentity: null,
        quarantinedIdentity: null,
      }, renamePath, removePath);
    } catch {}
    throw error;
  }

  // Installation above is the commit point. A cleanup failure leaves both
  // sides of the record for recoverReleaseOutputTransactions and is not a
  // failed release after the new output has already become visible.
  try {
    await cleanupOwnedTransaction({
      output,
      parent,
      parentIdentity,
      backup,
      backupIdentity,
      anchor,
      evidenceIdentity: transactionEvidence.identity,
      evidenceContents: transactionEvidence.contents,
      staging,
      installedIdentity: stagingIdentity,
      previousIdentity: targetSnapshot.status === "directory" ? targetSnapshot.identity : null,
      quarantinedIdentity: null,
    }, renamePath, removePath);
  } catch {}
}

/**
 * Restores an interrupted pre-commit move or removes a post-commit backup. A
 * forged backup marker alone is inert: its independently derived sibling anchor
 * must be the same inode, directory shape is exact, and `previous` must pass the
 * release owner's full replaceability validation before it can move or delete.
 */
export async function recoverReleaseOutputTransactions(claim, validateReplaceable, operations = {}) {
  const state = requireReleaseClaimState(claim);
  const lease = state.lease;
  const output = claim.outputDirectory;
  const parent = dirname(output);
  const renamePath = operations.renamePath ?? rename;
  const removePath = operations.removePath ?? rm;
  const parentIdentity = await bindReleaseParentIdentity(state, parent);
  await bindExistingStagingIdentity(state, claim.stagingDirectory);
  const prefix = `.velar-${basename(output)}-release-backup-`;
  let entries;
  try {
    entries = await scanTransactionCandidates(parent, (entry) =>
      entry.name.startsWith(prefix) && entry.isDirectory() && !entry.isSymbolicLink(), "Release transaction scan");
  }
  catch (error) {
    if (hostErrorCode(error) === "ENOENT") return;
    throw error;
  }
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const backup = resolve(parent, entry.name);
    const observed = await readTransaction(backup, output);
    if (!observed) continue;
    const { record } = observed;
    if (record.ownerPid !== process.pid && processIsAlive(record.ownerPid)) {
      throw new Error(`release output '${output}' has an active replacement transaction in process ${record.ownerPid}`);
    }
    if (!sameFile(record.parentIdentity, parentIdentity)) {
      throw new Error(`release output parent '${parent}' changed physical identity`);
    }
    await lease.extend(transactionClaimRequests(record, observed.anchor));
    await operations.afterTransactionClaim?.();
    const transaction = await readTransaction(backup, output);
    if (!transaction || !sameTransactionEvidence(observed, transaction)) {
      throw new Error(`release output transaction '${backup}' changed while its paths were being claimed`);
    }
    await recoverReleaseTransaction(transaction, parentIdentity, validateReplaceable, renamePath, removePath);
  }
  const targetSnapshot = await validatedTargetSnapshot(output, validateReplaceable);
  if (state.targetSnapshot !== null && !sameTargetSnapshot(state.targetSnapshot, targetSnapshot)) {
    throw changedIdentity(output);
  }
  state.targetSnapshot = targetSnapshot;
}

async function recoverReleaseTransaction(transaction, parentIdentity, validateReplaceable, renamePath, removePath) {
  const { record, anchor, identity: evidenceIdentity, contents: evidenceContents } = transaction;
  const output = record.outputDirectory;
  const parent = record.parentDirectory;
  const staging = record.stagingDirectory;
  const backup = record.backupDirectory;
  const marker = join(backup, TRANSACTION_MARKER);
  const previous = record.previousDirectory;
  const targetSnapshot = record.targetSnapshot;
  const stagingIdentity = record.stagingIdentity;
  const backupIdentity = record.backupIdentity;

  await assertDirectoryIdentity(parent, parentIdentity, "release output parent");
  await assertDirectoryIdentity(backup, backupIdentity, "release backup directory");
  await assertEvidencePair(marker, anchor, evidenceIdentity, evidenceContents);
  const outputSnapshot = await inspectTarget(output);
  const currentStaging = await inspectOptionalDirectory(staging, "release staging directory");
  const currentPrevious = await inspectOptionalDirectory(previous, "previous release directory");
  await assertBackupShape(backup, currentPrevious !== null);

  if (outputSnapshot.status === "directory" && sameFile(outputSnapshot.identity, stagingIdentity)) {
    await validateRecordedDirectory(output, stagingIdentity, validateReplaceable, "installed release directory");
    if (targetSnapshot.status === "missing") {
      if (currentPrevious !== null || currentStaging !== null) throw changedRecoveryState(output);
      await cleanupOwnedTransaction({
        output, parent, parentIdentity, staging, backup, backupIdentity, anchor,
        evidenceIdentity, evidenceContents, installedIdentity: stagingIdentity,
        previousIdentity: null, quarantinedIdentity: null,
      }, renamePath, removePath);
      return;
    }
    if (currentPrevious !== null && sameFile(currentPrevious, targetSnapshot.identity) && currentStaging === null) {
      await validateRecordedDirectory(previous, targetSnapshot.identity, validateReplaceable, "previous release directory");
      await cleanupOwnedTransaction({
        output, parent, parentIdentity, staging, backup, backupIdentity, anchor,
        evidenceIdentity, evidenceContents, installedIdentity: stagingIdentity,
        previousIdentity: targetSnapshot.identity, quarantinedIdentity: null,
      }, renamePath, removePath);
      return;
    }
    if (currentPrevious === null && currentStaging !== null && sameFile(currentStaging, targetSnapshot.identity)) {
      await validateRecordedDirectory(staging, targetSnapshot.identity, validateReplaceable, "quarantined previous release directory");
      await cleanupOwnedTransaction({
        output, parent, parentIdentity, staging, backup, backupIdentity, anchor,
        evidenceIdentity, evidenceContents, installedIdentity: stagingIdentity,
        previousIdentity: null, quarantinedIdentity: targetSnapshot.identity,
      }, renamePath, removePath);
      return;
    }
    if (currentPrevious === null && currentStaging === null) {
      await cleanupOwnedTransaction({
        output, parent, parentIdentity, staging, backup, backupIdentity, anchor,
        evidenceIdentity, evidenceContents, installedIdentity: stagingIdentity,
        previousIdentity: null, quarantinedIdentity: null,
      }, renamePath, removePath);
      return;
    }
    throw changedRecoveryState(output);
  }

  if (sameTargetSnapshot(outputSnapshot, targetSnapshot) && currentPrevious === null) {
    if (targetSnapshot.status === "directory") {
      await validateRecordedDirectory(output, targetSnapshot.identity, validateReplaceable, "previous release directory");
    }
    await removeStaleStaging({
      output, parent, parentIdentity, staging, currentStaging, stagingIdentity,
      backup, backupIdentity, marker, anchor, evidenceIdentity, evidenceContents,
    }, validateReplaceable, removePath);
    await cleanupOwnedTransaction({
      output, parent, parentIdentity, staging, backup, backupIdentity, anchor,
      evidenceIdentity, evidenceContents, installedIdentity: null,
      previousIdentity: null, quarantinedIdentity: null,
    }, renamePath, removePath);
    return;
  }

  if (outputSnapshot.status === "missing" && targetSnapshot.status === "directory"
    && currentPrevious !== null && sameFile(currentPrevious, targetSnapshot.identity)) {
    await validateRecordedDirectory(previous, targetSnapshot.identity, validateReplaceable, "previous release directory");
    if (currentStaging !== null && !sameFile(currentStaging, stagingIdentity)) throw changedRecoveryState(output);
    if (currentStaging !== null) {
      await validateRecordedDirectory(staging, stagingIdentity, validateReplaceable, "release staging directory");
    }
    await assertRecoveryAuthority({ parent, parentIdentity, backup, backupIdentity, marker, anchor, evidenceIdentity, evidenceContents });
    await renamePath(previous, output);
    const restoredIdentity = await inspectOrdinaryDirectory(output, "restored release directory");
    if (!sameFile(restoredIdentity, targetSnapshot.identity)) {
      await restoreMovedRelease(parent, parentIdentity, output, previous, restoredIdentity, renamePath);
      throw changedRecoveryState(output);
    }
    await assertDirectoryIdentity(parent, parentIdentity, "release output parent");
    await assertDirectoryIdentity(output, targetSnapshot.identity, "restored release directory");
    await assertRecoveryAuthority({ parent, parentIdentity, backup, backupIdentity, marker, anchor, evidenceIdentity, evidenceContents });
    await removeStaleStaging({
      output, parent, parentIdentity, staging, currentStaging, stagingIdentity,
      backup, backupIdentity, marker, anchor, evidenceIdentity, evidenceContents,
    }, validateReplaceable, removePath);
    await cleanupOwnedTransaction({
      output, parent, parentIdentity, staging, backup, backupIdentity, anchor,
      evidenceIdentity, evidenceContents, installedIdentity: null,
      previousIdentity: null, quarantinedIdentity: null,
    }, renamePath, removePath);
    return;
  }
  throw changedRecoveryState(output);
}

async function removeStaleStaging(transaction, validateReplaceable, removePath) {
  const { staging, currentStaging, stagingIdentity } = transaction;
  if (currentStaging === null) return;
  if (!sameFile(currentStaging, stagingIdentity)) throw changedRecoveryState(transaction.output);
  await validateRecordedDirectory(staging, stagingIdentity, validateReplaceable, "release staging directory");
  await assertRecoveryAuthority(transaction);
  await removePath(staging, { recursive: true, force: true });
  await assertDirectoryIdentity(transaction.parent, transaction.parentIdentity, "release output parent");
  await assertMissing(staging, "release staging directory");
  await assertDirectoryIdentity(transaction.backup, transaction.backupIdentity, "release backup directory");
  await assertEvidencePair(transaction.marker, transaction.anchor, transaction.evidenceIdentity, transaction.evidenceContents);
}

async function assertRecoveryAuthority(transaction) {
  await assertDirectoryIdentity(transaction.parent, transaction.parentIdentity, "release output parent");
  await assertDirectoryIdentity(transaction.backup, transaction.backupIdentity, "release backup directory");
  await assertEvidencePair(
    transaction.marker,
    transaction.anchor,
    transaction.evidenceIdentity,
    transaction.evidenceContents,
  );
}

async function readTransaction(backup, output) {
  const marker = join(backup, TRANSACTION_MARKER);
  try {
    const markerSnapshot = await readTransactionFile(marker, `Release transaction marker '${marker}'`);
    if (markerSnapshot === null || markerSnapshot.links < 2) return null;
    const value = JSON.parse(markerSnapshot.contents);
    if (!validTransactionRecord(value, backup, output)) return null;
    const anchor = transactionAnchor(output, value.token);
    if (value.anchorPath !== anchor) return null;
    const anchorSnapshot = await readTransactionFile(anchor, `Release transaction anchor '${anchor}'`);
    if (anchorSnapshot === null || anchorSnapshot.links < 2
      || markerSnapshot.contents !== anchorSnapshot.contents
      || !sameEvidenceIdentity(markerSnapshot.identity, anchorSnapshot.identity)) return null;
    return {
      record: value,
      anchor,
      contents: markerSnapshot.contents,
      identity: releaseEvidenceIdentity(markerSnapshot.identity),
    };
  } catch (error) {
    if (hostErrorCode(error) === "ENOENT" || hostErrorCode(error) === "ENOTDIR" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function validTransactionRecord(value, backup, output) {
  if (!hasExactKeys(value, [
    "anchorPath", "backupDirectory", "backupIdentity", "formatVersion", "kind", "outputDirectory",
    "ownerPid", "parentDirectory", "parentIdentity", "previousDirectory", "previousIdentity",
    "stagingDirectory", "stagingIdentity", "targetSnapshot", "token",
  ]) || value.formatVersion !== 2 || value.kind !== "velar-release-output-transaction"
    || value.outputDirectory !== output || value.parentDirectory !== dirname(output)
    || !validIdentity(value.parentIdentity) || !validIdentity(value.stagingIdentity)
    || !validIdentity(value.backupIdentity) || !validTargetSnapshot(value.targetSnapshot)
    || value.previousIdentity !== null && !validIdentity(value.previousIdentity)
    || !validOwner(value.ownerPid) || !validToken(value.token)) return false;
  const prefix = `.velar-${basename(output)}-release`;
  return value.stagingDirectory === join(value.parentDirectory, `${prefix}-staging-${value.token}`)
    && value.backupDirectory === join(value.parentDirectory, `${prefix}-backup-${value.token}`)
    && value.previousDirectory === join(value.backupDirectory, "previous")
    && value.backupDirectory === backup
    && value.anchorPath === transactionAnchor(output, value.token)
    && (value.targetSnapshot.status === "missing"
      ? value.previousIdentity === null
      : value.previousIdentity !== null && sameFile(value.previousIdentity, value.targetSnapshot.identity));
}

function transactionAnchor(output, token) {
  return join(dirname(output), `.velar-${basename(output)}-release-transaction-${token}.json`);
}

function transactionClaimRequests(record, anchor) {
  return [
    { path: record.stagingDirectory, kind: "tree" },
    { path: record.backupDirectory, kind: "tree" },
    { path: record.previousDirectory, kind: "tree" },
    { path: join(record.backupDirectory, TRANSACTION_MARKER), kind: "file" },
    { path: anchor, kind: "file" },
  ];
}

function assertRecordAuthority(record, expected) {
  const expectedPrevious = expected.targetSnapshot.status === "directory" ? expected.targetSnapshot.identity : null;
  if (!sameFile(record.parentIdentity, expected.parentIdentity)
    || !sameTargetSnapshot(record.targetSnapshot, expected.targetSnapshot)
    || !sameOptionalFile(record.previousIdentity, expectedPrevious)
    || !sameFile(record.stagingIdentity, expected.stagingIdentity)
    || !sameFile(record.backupIdentity, expected.backupIdentity)) {
    throw new Error("release output transaction record did not preserve its captured directory identities");
  }
}

function sameOptionalFile(left, right) {
  return left === null ? right === null : right !== null && sameFile(left, right);
}

function serializedIdentity(identity) {
  if (!validIdentity(identity)) throw new Error("release output directory identity cannot be serialized safely");
  return { dev: identity.dev, ino: identity.ino };
}

function serializedTargetSnapshot(snapshot) {
  return snapshot.status === "missing"
    ? { status: "missing" }
    : { status: "directory", identity: serializedIdentity(snapshot.identity) };
}

function validTargetSnapshot(value) {
  if (hasExactKeys(value, ["status"]) && value.status === "missing") return true;
  return hasExactKeys(value, ["identity", "status"])
    && value.status === "directory" && validIdentity(value.identity);
}

function validIdentity(value) {
  return hasExactKeys(value, ["dev", "ino"])
    && validIdentityNumber(value.dev) && validIdentityNumber(value.ino);
}

function validIdentityNumber(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function requireReleaseClaimState(claim) {
  const state = claim !== null && typeof claim === "object" ? releaseClaimLeases.get(claim) : undefined;
  if (!state || state.released) throw new Error("release output replacement requires its active transaction claim");
  return state;
}

async function bindReleaseParentIdentity(state, parent) {
  const actual = await inspectOrdinaryDirectory(parent, "release output parent");
  if (state.parentIdentity !== null && !sameFile(state.parentIdentity, actual)) {
    throw new Error(`release output parent '${parent}' changed physical identity`);
  }
  state.parentIdentity = actual;
  return actual;
}

async function bindExistingStagingIdentity(state, staging) {
  let actual;
  try {
    actual = await inspectOrdinaryDirectory(staging, "release staging directory");
  } catch (error) {
    if (hostErrorCode(error) === "ENOENT") return;
    throw error;
  }
  if (state.stagingIdentity !== null && !sameFile(state.stagingIdentity, actual)) {
    throw new Error(`release staging directory '${staging}' changed physical identity`);
  }
  state.stagingIdentity = actual;
}

async function validatedTargetSnapshot(path, validateReplaceable) {
  const before = await inspectTarget(path);
  await validateReplaceable(path);
  const after = await inspectTarget(path);
  if (!sameTargetSnapshot(before, after)) throw changedIdentity(path);
  return after;
}

async function validatedDirectoryIdentity(path, validateReplaceable, label) {
  const before = await inspectOrdinaryDirectory(path, label);
  await validateReplaceable(path);
  const after = await inspectOrdinaryDirectory(path, label);
  if (!sameFile(before, after)) throw new Error(`${label} '${path}' changed physical identity`);
  return after;
}

async function inspectTarget(path) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`release output '${path}' must be an ordinary directory`);
    }
    return { status: "directory", identity: identityOf(metadata) };
  } catch (error) {
    if (hostErrorCode(error) === "ENOENT") return { status: "missing" };
    throw error;
  }
}

async function inspectOrdinaryDirectory(path, label) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`${label} '${path}' must be an ordinary directory`);
  return identityOf(metadata);
}

async function inspectOptionalDirectory(path, label) {
  try {
    return await inspectOrdinaryDirectory(path, label);
  } catch (error) {
    if (hostErrorCode(error) === "ENOENT" || hostErrorCode(error) === "ENOTDIR") return null;
    throw error;
  }
}

async function validateRecordedDirectory(path, expected, validateReplaceable, label) {
  await assertDirectoryIdentity(path, expected, label);
  await validateReplaceable(path);
  await assertDirectoryIdentity(path, expected, label);
}

async function assertBackupShape(backup, hasPrevious) {
  const actual = (await scanTransactionCandidates(backup, () => true, `Release backup '${backup}'`, 2))
    .map((entry) => entry.name).sort();
  const expected = hasPrevious ? [TRANSACTION_MARKER, "previous"].sort() : [TRANSACTION_MARKER];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`release backup directory '${backup}' contains unrecognized transaction entries`);
  }
}

async function assertDirectoryIdentity(path, expected, label) {
  const actual = await inspectOrdinaryDirectory(path, label);
  if (!sameFile(expected, actual)) throw new Error(`${label} '${path}' changed physical identity`);
}

async function assertTargetSnapshot(path, expected) {
  const actual = await inspectTarget(path);
  if (!sameTargetSnapshot(expected, actual)) throw changedIdentity(path);
}

async function assertMissing(path, label) {
  try {
    await lstat(path);
  } catch (error) {
    if (hostErrorCode(error) === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} '${path}' already exists`);
}

async function restoreMovedRelease(parent, parentIdentity, previous, output, movedIdentity, renamePath) {
  await assertDirectoryIdentity(parent, parentIdentity, "release output parent");
  await assertMissing(output, "release output during rollback");
  await assertDirectoryIdentity(previous, movedIdentity, "previous release directory");
  await renamePath(previous, output);
  await assertDirectoryIdentity(parent, parentIdentity, "release output parent");
  await assertDirectoryIdentity(output, movedIdentity, "restored release directory");
}

async function cleanupOwnedTransaction(transaction, renamePath, removePath) {
  const {
    output, parent, parentIdentity, staging, backup, backupIdentity, anchor,
    evidenceIdentity, evidenceContents, installedIdentity, previousIdentity, quarantinedIdentity,
  } = transaction;
  const marker = join(backup, TRANSACTION_MARKER);
  const previous = join(backup, "previous");
  const authority = async () => {
    await assertDirectoryIdentity(parent, parentIdentity, "release output parent");
    if (installedIdentity !== null) {
      await assertDirectoryIdentity(output, installedIdentity, "installed release directory");
    }
    await assertDirectoryIdentity(backup, backupIdentity, "release backup directory");
    await assertEvidencePair(marker, anchor, evidenceIdentity, evidenceContents);
  };
  await authority();
  if (previousIdentity !== null) {
    await assertDirectoryIdentity(previous, previousIdentity, "previous release directory");
    await assertMissing(staging, "release cleanup quarantine");
    await renamePath(previous, staging);
    const movedIdentity = await inspectOrdinaryDirectory(staging, "quarantined previous release directory");
    if (!sameFile(movedIdentity, previousIdentity)) {
      await restoreMovedRelease(parent, parentIdentity, staging, previous, movedIdentity, renamePath);
      throw new Error(`previous release directory '${previous}' changed physical identity before cleanup`);
    }
    await assertMissing(previous, "previous release directory");
    await authority();
    await removePath(staging, { recursive: true, force: true });
    await assertMissing(staging, "release cleanup quarantine");
  } else if (quarantinedIdentity !== null) {
    await assertMissing(previous, "previous release directory");
    await assertDirectoryIdentity(staging, quarantinedIdentity, "quarantined previous release directory");
    await authority();
    await removePath(staging, { recursive: true, force: true });
    await assertMissing(staging, "release cleanup quarantine");
  } else {
    await assertMissing(previous, "previous release directory");
    if (installedIdentity !== null) await assertMissing(staging, "release cleanup quarantine");
  }
  // Keep both hard-linked evidence paths until every old release inode has gone.
  await authority();
  await assertBackupShape(backup, false);
  await removePath(backup, { recursive: true, force: true });
  await assertDirectoryIdentity(parent, parentIdentity, "release output parent");
  if (installedIdentity !== null) {
    await assertDirectoryIdentity(output, installedIdentity, "installed release directory");
  }
  await removeOwnedFile(anchor, evidenceIdentity, evidenceContents);
}

async function removeOwnedDirectory(path, expected, removePath) {
  try {
    await assertDirectoryIdentity(path, expected, "release transaction directory");
    await removePath(path, { recursive: true, force: true });
  } catch (error) {
    if (hostErrorCode(error) !== "ENOENT") throw error;
  }
}

async function removeOwnedFile(path, expected, expectedContents = null) {
  try {
    if (expectedContents === null) {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || !sameFile(identityOf(metadata), expected)) return;
    } else {
      await assertFileSnapshot(path, expected, expectedContents, "release transaction evidence");
    }
    await unlink(path);
  } catch (error) {
    if (hostErrorCode(error) !== "ENOENT") throw error;
  }
}

async function assertFileSnapshot(path, expected, expectedContents, label, requireHardLink = false) {
  const actual = await readTransactionFile(path, `${label} '${path}'`);
  if (actual === null || requireHardLink && actual.links < 2 || actual.contents !== expectedContents
    || !sameFile(releaseEvidenceIdentity(actual.identity), expected)) {
    throw new Error(`${label} '${path}' changed physical identity or contents`);
  }
}

async function assertEvidencePair(marker, anchor, expected, expectedContents) {
  await assertFileSnapshot(marker, expected, expectedContents, "release transaction marker", true);
  await assertFileSnapshot(anchor, expected, expectedContents, "release transaction anchor", true);
}

function sameTargetSnapshot(left, right) {
  return left.status === "missing"
    ? right.status === "missing"
    : right.status === "directory" && sameFile(left.identity, right.identity);
}

function identityOf(metadata) {
  return { dev: metadata.dev, ino: metadata.ino };
}

function releaseEvidenceIdentity(identity) {
  return { dev: identity.device, ino: identity.inode };
}

function sameEvidenceIdentity(left, right) {
  return left.device === right.device && left.inode === right.inode;
}

function changedIdentity(path) {
  return new Error(`refusing to replace '${path}': the release directory changed physical identity`);
}

function changedRecoveryState(path) {
  return new Error(`release output transaction for '${path}' no longer matches its persisted directory identities`);
}

function sameTransactionEvidence(left, right) {
  return left.anchor === right.anchor && left.contents === right.contents && sameFile(left.identity, right.identity);
}

function hasExactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validOwner(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validToken(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return hostErrorCode(error) === "EPERM"; }
}

async function pathExists(path) {
  try { await lstat(path); return true; }
  catch (error) {
    if (hostErrorCode(error) === "ENOENT" || hostErrorCode(error) === "ENOTDIR") return false;
    throw error;
  }
}

function hostErrorCode(error) {
  return error && typeof error === "object" && typeof error.code === "string" ? error.code : null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
