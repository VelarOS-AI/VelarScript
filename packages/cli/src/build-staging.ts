import { open } from "node:fs/promises";
import { isHostErrorCode } from "./host-error.ts";

/** Ownership marker carried through the atomic output-directory rename. */
export const BUILD_STAGING_MARKER = ".velar-build-staging.json";

/** Creates one generated claim without permitting an earlier staging producer to be overwritten. */
export async function writeExclusiveBuildFile(
  path: string,
  contents: string | Uint8Array,
  claim: string,
): Promise<void> {
  let handle;
  try {
    handle = await open(path, "wx");
  } catch (error) {
    if (isOutputCollision(error)) throw new Error(`${claim} conflicts with an existing build output`);
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error(`${claim} must be an ordinary file`);
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
}

function isOutputCollision(error: unknown): boolean {
  return isHostErrorCode(error, "EEXIST") || isHostErrorCode(error, "EISDIR") || isHostErrorCode(error, "ENOTDIR");
}
