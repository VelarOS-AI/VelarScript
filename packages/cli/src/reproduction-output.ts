import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { acquireBuildOutputClaims, finishBuildOutputClaim } from "./build-output-claim.ts";
import { writeExclusiveBuildFile } from "./build-staging.ts";
import { canonicalizePotentialPath } from "./canonical-path.ts";
import { isHostErrorCode } from "./host-error.ts";
import {
  inspectOrdinaryDirectory,
  inspectReproductionTarget,
  recoverReproductionOutputTransactions,
  REPRODUCTION_TRANSACTION_MARKER,
  replaceReproductionDirectory,
  ReproductionReplacementError,
  sameReproductionIdentity,
  type ReproductionDirectoryIdentity,
} from "./reproduction-output-transaction.ts";

export interface ReproductionOutputOptions {
  readonly projectRoot: string;
  readonly outputDirectory: string;
  readonly requestedOutput: string | null;
  readonly defaultOutputName: string;
}

/**
 * Builds beside the destination under an exclusive tree claim, then installs
 * the complete tree with one rename transaction. Until that commit point an
 * old default bundle, or an explicitly supplied empty directory, is untouched.
 */
export async function writeReproductionOutput<Result>(
  options: ReproductionOutputOptions,
  writeStaging: (directory: string) => Promise<Result>,
): Promise<Result> {
  if (options.requestedOutput === "") throw new Error("reproduction output directory cannot be empty");
  const root = resolve(options.projectRoot);
  const target = resolve(options.outputDirectory);
  const initialIdentity = await assertOutputBoundary(root, target, options.requestedOutput);
  const parent = dirname(target);
  const token = randomUUID();
  const staging = join(parent, `.velar-${basename(target)}-repro-${token}`);
  const previous = `${staging}-previous`;
  const recovery = `${staging}-recovery`;
  const transactionEvidence = `${staging}.velar-transaction.json`;
  const claim = await acquireBuildOutputClaims([
    { path: target, kind: "tree" },
    { path: staging, kind: "tree" },
    { path: previous, kind: "tree" },
    { path: recovery, kind: "tree" },
    { path: transactionEvidence, kind: "file" },
  ]);
  let stagingIdentity: ReproductionDirectoryIdentity | null = null;
  let evidenceIdentity: ReproductionDirectoryIdentity | null = null;
  let preserveArtifacts = false;
  let completion: { readonly status: "committed"; readonly value: Result }
    | { readonly status: "failed"; readonly error: unknown };
  try {
    await mkdir(parent, { recursive: true });
    const preparedIdentity = await assertOutputBoundary(root, target, options.requestedOutput);
    assertSameCanonicalIdentity(target, initialIdentity, preparedIdentity);
    const parentIdentity = await inspectOrdinaryDirectory(parent, "Reproduction output parent");
    await recoverReproductionOutputTransactions(target, parentIdentity, claim);
    const claimedIdentity = await assertOutputBoundary(root, target, options.requestedOutput);
    assertSameCanonicalIdentity(target, preparedIdentity, claimedIdentity);
    const displayed = options.requestedOutput ?? options.defaultOutputName;
    const targetSnapshot = await inspectReproductionTarget(target, options.requestedOutput !== null, displayed);
    await mkdir(staging, { mode: 0o700 });
    stagingIdentity = await inspectOrdinaryDirectory(staging, "Reproduction staging directory");
    const evidenceContents = `${JSON.stringify({
      formatVersion: 2,
      kind: "velar-reproduction-output-transaction",
      ownerPid: process.pid,
      token,
      target,
      staging,
      previous,
      recovery,
      recoveryIdentity: null,
      parent,
      parentIdentity: serializedIdentity(parentIdentity),
      targetSnapshot: serializedTargetSnapshot(targetSnapshot),
      stagingIdentity: serializedIdentity(stagingIdentity),
    }, null, 2)}\n`;
    await writeExclusiveBuildFile(
      transactionEvidence,
      evidenceContents,
      "Reproduction output transaction evidence",
    );
    evidenceIdentity = identityOf(await lstat(transactionEvidence));
    await link(transactionEvidence, join(staging, REPRODUCTION_TRANSACTION_MARKER));
    const value = await writeStaging(staging);
    const commitIdentity = await assertOutputBoundary(root, target, options.requestedOutput);
    assertSameCanonicalIdentity(target, claimedIdentity, commitIdentity);
    await replaceReproductionDirectory({
      paths: { target, staging, previous, recovery, transactionEvidence },
      parent,
      parentIdentity,
      targetSnapshot,
      stagingIdentity,
      evidenceIdentity,
      evidenceContents,
      recoveryIdentity: null,
      explicitOutput: options.requestedOutput !== null,
    });
    completion = { status: "committed", value };
  } catch (error) {
    preserveArtifacts = error instanceof ReproductionReplacementError && error.preserveArtifacts;
    completion = { status: "failed", error };
  }
  await finishBuildOutputClaim(claim, completion, async () => {
    if (completion.status !== "failed" || preserveArtifacts) return;
    if (stagingIdentity !== null) await removeOwnedTree(staging, stagingIdentity);
    if (evidenceIdentity !== null) await removeOwnedFile(transactionEvidence, evidenceIdentity);
  });
  if (completion.status === "failed") throw completion.error;
  return completion.value;
}

async function assertOutputBoundary(root: string, target: string, requested: string | null): Promise<string> {
  const [canonicalRoot, canonicalTarget] = await Promise.all([
    realpath(root),
    canonicalizePotentialPath(target),
  ]);
  const lexicallyInsideProject = contains(root, target);
  if (requested === null && (!lexicallyInsideProject || !contains(canonicalRoot, canonicalTarget))) {
    throw new Error(`refusing to replace '${target}': the default reproduction directory escapes the project`);
  }
  if (lexicallyInsideProject) {
    if (!contains(canonicalRoot, canonicalTarget)) {
      throw new Error(`refusing to write '${target}': the reproduction directory escapes the project through a symbolic link`);
    }
    await assertNoSymbolicLinkBelow(root, target);
  }
  return canonicalTarget;
}

function assertSameCanonicalIdentity(target: string, expected: string, actual: string): void {
  if (expected !== actual) {
    throw new Error(`refusing to replace '${target}': the reproduction directory changed physical identity`);
  }
}

async function assertNoSymbolicLinkBelow(root: string, target: string): Promise<void> {
  let current = target;
  while (current !== root) {
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`refusing to use '${target}': a reproduction directory ancestor '${current}' is a symbolic link`);
      }
    } catch (error) {
      if (!isHostErrorCode(error, "ENOENT")) throw error;
    }
    current = dirname(current);
  }
}

function contains(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

async function removeOwnedTree(path: string, expected: ReproductionDirectoryIdentity): Promise<void> {
  try {
    const actual = identityOf(await lstat(path));
    if (!sameReproductionIdentity(expected, actual)) return;
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    if (!isHostErrorCode(error, "ENOENT")) throw error;
  }
}

async function removeOwnedFile(path: string, expected: ReproductionDirectoryIdentity): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return;
    if (!sameReproductionIdentity(expected, identityOf(metadata))) return;
    await rm(path, { force: true });
  } catch (error) {
    if (!isHostErrorCode(error, "ENOENT")) throw error;
  }
}

function identityOf(metadata: Awaited<ReturnType<typeof lstat>>): ReproductionDirectoryIdentity {
  return { device: metadata.dev, inode: metadata.ino };
}

function serializedIdentity(identity: ReproductionDirectoryIdentity): { readonly device: number; readonly inode: number } {
  if (typeof identity.device !== "number" || typeof identity.inode !== "number"
    || !Number.isSafeInteger(identity.device) || !Number.isSafeInteger(identity.inode)) {
    throw new Error("reproduction transaction directory identity cannot be serialized safely");
  }
  return { device: identity.device, inode: identity.inode };
}

function serializedTargetSnapshot(snapshot: Awaited<ReturnType<typeof inspectReproductionTarget>>):
  { readonly status: "missing" }
  | { readonly status: "directory"; readonly identity: { readonly device: number; readonly inode: number }; readonly empty: boolean } {
  return snapshot.status === "missing"
    ? snapshot
    : { ...snapshot, identity: serializedIdentity(snapshot.identity) };
}
