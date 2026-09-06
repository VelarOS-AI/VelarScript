import { lstat, rename, rm } from "node:fs/promises";
import { isHostErrorCode } from "./host-error.ts";

export interface BuildDirectoryIdentity {
  readonly device: string;
  readonly inode: string;
}

export function directoryRemovalPath(path: string): string {
  return `${path}-removing`;
}

/** Moves a verified generated tree into a caller-claimed isolation before recursively deleting it. */
export async function removeOwnedDirectory(
  path: string,
  expected: BuildDirectoryIdentity,
  renamePath: typeof rename = rename,
  removePath: typeof rm = rm,
): Promise<void> {
  const isolation = directoryRemovalPath(path);
  const source = await inspectDirectory(path);
  let isolated = await inspectDirectory(isolation);
  if (source !== null) {
    if (!sameIdentity(source, expected)) throw changedIdentity(path);
    if (isolated !== null) {
      throw new Error(`directory build removal isolation '${isolation}' already exists; both trees were preserved`);
    }
    await renamePath(path, isolation);
    isolated = await inspectDirectory(isolation);
    if (isolated === null || !sameIdentity(isolated, expected)) {
      await restoreUnexpectedDirectory(path, isolation, isolated, renamePath);
      throw new Error(`directory build transaction directory '${path}' changed at its removal boundary`);
    }
  }
  if (isolated === null) return;
  if (!sameIdentity(isolated, expected)) throw changedIdentity(isolation);
  try {
    await removePath(isolation, { recursive: true, force: true });
  } catch (error) {
    const remaining = await inspectDirectory(isolation);
    if (remaining !== null && sameIdentity(remaining, expected)) {
      await restoreUnexpectedDirectory(path, isolation, remaining, renamePath);
    }
    throw error;
  }
}

async function restoreUnexpectedDirectory(
  source: string,
  isolation: string,
  isolated: BuildDirectoryIdentity | null,
  renamePath: typeof rename,
): Promise<void> {
  if (isolated === null || await pathExists(source)) return;
  await renamePath(isolation, source);
  const restored = await inspectDirectory(source);
  if (restored === null || !sameIdentity(restored, isolated)) {
    throw new Error(`unexpected directory moved during cleanup could not be restored to '${source}'`);
  }
}

async function inspectDirectory(path: string): Promise<BuildDirectoryIdentity | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw changedIdentity(path);
    return { device: metadata.dev.toString(), inode: metadata.ino.toString() };
  } catch (error) {
    if (isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) return null;
    throw error;
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

function sameIdentity(left: BuildDirectoryIdentity, right: BuildDirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function changedIdentity(path: string): Error {
  return new Error(`directory build transaction directory '${path}' changed physical identity`);
}
