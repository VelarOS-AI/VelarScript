import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];

/**
 * Creates a temporary root under the system temp directory and records it so
 * {@link removeTemporaryDirectories} can reclaim it. Tests that create their
 * roots this way do not have to unwind them by hand, and a failing assertion
 * still leaves nothing behind.
 */
export async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  roots.push(directory);
  return directory;
}

/** Removes every root handed out by {@link makeTemporaryDirectory}. */
export async function removeTemporaryDirectories(): Promise<void> {
  const pending = roots.splice(0);
  await Promise.all(pending.map((directory) => rm(directory, { recursive: true, force: true })));
}
