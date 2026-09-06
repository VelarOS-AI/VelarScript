import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./repository-root.ts";

/**
 * D115 §一.6 — the one copy of "make this temporary project see an installed
 * target package".
 *
 * Thirty-six sites wrote the same two calls with the package root spelled six
 * ways — joined from a local `root`, from `repositoryRoot`, from a
 * `workspaceRoot`, resolved against the working directory, and two
 * module-level constants — and all six named the same directory. The scope
 * directory is
 * created here rather than by each caller, because `mkdir(…, {recursive: true})`
 * is idempotent and a caller that forgets it has a project that cannot resolve
 * its own extension.
 */
export async function linkVelarExtension(root: string, name: string): Promise<void> {
  const scope = join(root, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(join(repositoryRoot, "packages", name), join(scope, name), "dir");
}
