import { lstat, type rename, type rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  assertDirectorySnapshotUnchanged,
  type BoundedDirectorySnapshot,
} from "./bounded-directory-snapshot.ts";
import type { BuildDirectoryIdentity } from "./build-output-directory-removal.ts";
import { isHostErrorCode } from "./host-error.ts";

export type BuildOutputTargetSnapshot =
  | { readonly status: "missing" }
  | { readonly status: "directory"; readonly identity: BuildDirectoryIdentity };

export interface BuildOutputAuthorization {
  readonly parentIdentity: BuildDirectoryIdentity;
  readonly targetSnapshot: BuildOutputTargetSnapshot;
}

export interface BuildStagingOwnership {
  readonly formatVersion: 3;
  readonly kind: "velar-build-staging";
  readonly outputDirectory: string;
  readonly stagingDirectory: string;
  readonly ownerPid: number;
  readonly transactionToken: string;
  readonly parentIdentity: BuildDirectoryIdentity;
  readonly stagingIdentity: BuildDirectoryIdentity;
  readonly targetSnapshot: BuildOutputTargetSnapshot;
}

export interface VerifiedBuildStagingOwnership extends BuildStagingOwnership {
  /** Physical identity shared by the marker and its external hard-link anchor. */
  readonly evidenceDevice: number | bigint;
  readonly evidenceInode: number | bigint;
}

export interface DirectoryBuildTransactionOperations {
  readonly renamePath?: typeof rename;
  readonly removePath?: typeof rm;
  readonly afterFirstRename?: () => Promise<void>;
  readonly afterSecondRename?: () => Promise<void>;
  readonly afterRecoveryClaim?: () => Promise<void>;
  readonly beforeRecoveryRestore?: () => Promise<void>;
  readonly beforePreviousCleanup?: () => Promise<void>;
  readonly beforeStagingCleanup?: () => Promise<void>;
  /** Deterministic seam after receipt verification and before commit revalidation. */
  readonly beforeStagingCommitValidation?: () => Promise<void>;
}

/** Exact verified staging tree accepted by the final directory transaction. */
export interface BuildOutputCommitAuthorization {
  readonly directory: string;
}

interface BuildOutputCommitAuthorizationState {
  readonly directory: string;
  readonly snapshot: BoundedDirectorySnapshot;
  readonly verifyInstalledDirectory: (directory: string) => Promise<void>;
}

const issuedBuildOutputAuthorizations = new WeakMap<
  BuildOutputCommitAuthorization,
  BuildOutputCommitAuthorizationState
>();

/** Keeps semantic verification separate while binding its snapshot to one pathname. */
export function authorizeBuildOutputCommit(
  directory: string,
  snapshot: BoundedDirectorySnapshot,
  verifyInstalledDirectory: (directory: string) => Promise<void>,
): BuildOutputCommitAuthorization {
  const normalized = resolve(directory);
  if (resolve(snapshot.root) !== normalized || !snapshot.directories.has("")) {
    throw new Error(`Verified build output snapshot does not belong to '${normalized}'`);
  }
  const authorization = Object.freeze({ directory: normalized });
  issuedBuildOutputAuthorizations.set(authorization, {
    directory: normalized,
    snapshot: cloneDirectorySnapshot(snapshot),
    verifyInstalledDirectory,
  });
  return authorization;
}

export async function assertAuthorizedStagingBuildOutput(
  ownership: VerifiedBuildStagingOwnership,
  authorization: BuildOutputCommitAuthorization,
): Promise<void> {
  const authorized = requireAuthorizationForStaging(ownership, authorization);
  await assertDirectorySnapshotUnchanged(authorized.snapshot, "Verified directory build output");
}

export async function assertAuthorizedInstalledBuildOutput(
  ownership: VerifiedBuildStagingOwnership,
  authorization: BuildOutputCommitAuthorization,
): Promise<void> {
  const authorized = requireAuthorizationForStaging(ownership, authorization);
  await assertDirectorySnapshotUnchanged(
    authorized.snapshot,
    "Installed verified directory build output",
    ownership.outputDirectory,
  );
}

export async function verifyAuthorizedInstalledBuildOutput(
  ownership: VerifiedBuildStagingOwnership,
  authorization: BuildOutputCommitAuthorization,
): Promise<void> {
  const authorized = requireAuthorizationForStaging(ownership, authorization);
  await authorized.verifyInstalledDirectory(ownership.outputDirectory);
}

export async function restorePreviousBuildOutput(
  ownership: VerifiedBuildStagingOwnership,
  previous: string,
  renamePath: typeof rename,
): Promise<void> {
  if (ownership.targetSnapshot.status !== "directory") return;
  await assertDirectoryIdentity(dirname(ownership.outputDirectory), ownership.parentIdentity, "build output parent");
  await assertMissing(ownership.outputDirectory, "directory build output during rollback");
  await assertDirectoryIdentity(previous, ownership.targetSnapshot.identity, "previous directory build output");
  await renamePath(previous, ownership.outputDirectory);
  await assertDirectoryIdentity(ownership.outputDirectory, ownership.targetSnapshot.identity, "restored directory build output");
}

export async function rollbackVisibleBuildOutput(
  ownership: VerifiedBuildStagingOwnership,
  previous: string,
  renamePath: typeof rename,
): Promise<void> {
  await assertDirectoryIdentity(dirname(ownership.outputDirectory), ownership.parentIdentity, "build output parent");
  await assertDirectoryIdentity(ownership.outputDirectory, ownership.stagingIdentity, "invalid installed directory build output");
  await assertMissing(ownership.stagingDirectory, "directory build staging during rollback");
  if (ownership.targetSnapshot.status === "directory") {
    await assertDirectoryIdentity(previous, ownership.targetSnapshot.identity, "previous directory build output");
  } else {
    await assertMissing(previous, "previous directory build output");
  }
  await renamePath(ownership.outputDirectory, ownership.stagingDirectory);
  await assertDirectoryIdentity(ownership.stagingDirectory, ownership.stagingIdentity, "rolled-back directory build staging");
  await assertMissing(ownership.outputDirectory, "directory build output after staging rollback");
  await restorePreviousBuildOutput(ownership, previous, renamePath);
}

function requireAuthorizationForStaging(
  ownership: VerifiedBuildStagingOwnership,
  authorization: BuildOutputCommitAuthorization,
): BuildOutputCommitAuthorizationState {
  const authorized = issuedBuildOutputAuthorizations.get(authorization);
  const staging = resolve(ownership.stagingDirectory);
  const rootIdentity = authorized?.snapshot.directories.get("");
  if (authorized === undefined || authorization.directory !== authorized.directory
    || authorized.directory !== staging || resolve(authorized.snapshot.root) !== staging || rootIdentity === undefined
    || rootIdentity.device.toString() !== ownership.stagingIdentity.device
    || rootIdentity.inode.toString() !== ownership.stagingIdentity.inode) {
    throw new Error(`Verified build output snapshot does not belong to staging directory '${staging}'`);
  }
  return authorized;
}

function cloneDirectorySnapshot(snapshot: BoundedDirectorySnapshot): BoundedDirectorySnapshot {
  return Object.freeze({
    root: snapshot.root,
    files: new Map([...snapshot.files].map(([path, file]) => [path, Object.freeze({
      absolutePath: file.absolutePath,
      path: file.path,
      identity: Object.freeze({ ...file.identity }),
    })])),
    directories: new Map([...snapshot.directories].map(([path, identity]) => [
      path,
      Object.freeze({ ...identity }),
    ])),
    entries: snapshot.entries,
    totalBytes: snapshot.totalBytes,
  });
}

async function assertDirectoryIdentity(
  path: string,
  expected: BuildDirectoryIdentity,
  label: string,
): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || metadata.dev.toString() !== expected.device || metadata.ino.toString() !== expected.inode) {
    throw new Error(`${label} '${path}' changed physical identity`);
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
