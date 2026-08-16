import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * D63 rule 159 — which packages make up the toolchain is a derived fact, not a
 * list somebody maintains.
 *
 * `tests/package.acceptance.ts` named eight packages as literal `pack()` calls
 * and `scripts/release-toolchain.mjs` held the same eight in a literal array.
 * Both were correct, and both were copies of what `packages/*` already says.
 *
 * The cost was paid outside the repository. A blind-test brief transcribed a
 * truncated view of one of those lists, shipped six names instead of eight, and
 * the tester lost two installs to E404 before finding the rest by hand. A list
 * anybody has to read and retype is a list somebody will eventually get wrong;
 * a command nobody has to retype removes the failure mode rather than the
 * mistake.
 *
 * Publishability is read from each manifest's own `private` flag, so a package
 * added to the workspace joins the toolchain the day it exists, and one that
 * must stay unpublished says so where it is defined.
 */

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every publishable workspace package, in dependency-friendly name order.
 * Returns `{name, version, directory, private}` records.
 */
export async function velarPackages(root = workspaceRoot) {
  const packagesDirectory = join(root, "packages");
  const entries = await readdir(packagesDirectory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(packagesDirectory, entry.name);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (typeof manifest.name !== "string") continue;
    found.push({
      name: manifest.name,
      version: manifest.version,
      directory,
      private: manifest.private === true,
    });
  }
  if (found.length === 0) throw new Error("no workspace packages found under packages/");
  return found.sort((left, right) => left.name.localeCompare(right.name));
}

/** The names a complete offline install needs — the answer the old lists spelled out. */
export async function velarPackageNames(root = workspaceRoot) {
  return (await velarPackages(root)).filter((entry) => !entry.private).map((entry) => entry.name);
}
