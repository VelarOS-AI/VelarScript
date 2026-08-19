import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * D63 rule 159 — which packages make up the toolchain is a derived fact, not a
 * list somebody maintains. Toolchain implementations live under `packages/`;
 * ordinary VelarScript source libraries live under `libraries/`. npm sees both
 * as workspaces, but only the first directory defines a toolchain release.
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
 * Publishability is read from each manifest's own `private` flag. A package
 * added under `packages/` joins the toolchain; a package added under
 * `libraries/` joins source-library acceptance without silently joining the
 * compiler/runtime release generation.
 *
 * A-024: deriving the *names* was only the first consumer. `test:packages`
 * packed this roster and then rewrote the same eight names by hand for the
 * content checks and for the clean install, and `gate:build:packages` held a
 * sixth copy as a literal npm script — so a new publishable package was packed
 * on the day it existed and content-checked, installed and built on no day at
 * all. Every consumer reads this module now, and each record carries its whole
 * manifest so a consumer can ask what the package promises rather than
 * remembering it.
 */

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every workspace entry under one owned directory, in name order.
 * Returns `{name, version, directory, private}` records.
 */
async function workspacePackagesUnder(root, directoryName) {
  const packagesDirectory = join(root, directoryName);
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
      manifest,
    });
  }
  if (found.length === 0) throw new Error(`no workspace packages found under ${directoryName}/`);
  return found.sort((left, right) => left.name.localeCompare(right.name));
}

/** Compiler, CLI, official targets, and other toolchain implementation packages. */
export async function velarToolchainPackages(root = workspaceRoot) {
  return workspacePackagesUnder(root, "packages");
}

/** Ordinary installable libraries authored in VelarScript source. */
export async function velarLibraries(root = workspaceRoot) {
  return workspacePackagesUnder(root, "libraries");
}

/** Every publishable package in the six-package toolchain release generation. */
export async function velarPublishedToolchainPackages(root = workspaceRoot) {
  return (await velarToolchainPackages(root)).filter((entry) => !entry.private);
}

/** Every publishable first-party VelarScript source library. */
export async function velarPublishedLibraries(root = workspaceRoot) {
  return (await velarLibraries(root)).filter((entry) => !entry.private);
}

/** Every publishable workspace package, used by source-package consumer gates. */
export async function velarPublishedWorkspacePackages(root = workspaceRoot) {
  const workspaces = [
    ...await velarPublishedToolchainPackages(root),
    ...await velarPublishedLibraries(root),
  ].sort((left, right) => left.name.localeCompare(right.name));
  for (let index = 1; index < workspaces.length; index += 1) {
    if (workspaces[index - 1].name === workspaces[index].name) {
      throw new Error(`duplicate workspace package name ${workspaces[index].name}`);
    }
  }
  return workspaces;
}

/** The package names in a complete toolchain candidate. */
export async function velarToolchainPackageNames(root = workspaceRoot) {
  return (await velarPublishedToolchainPackages(root)).map((entry) => entry.name);
}

/** All local tarballs needed to exercise toolchain and source libraries together. */
export async function velarWorkspacePackageNames(root = workspaceRoot) {
  return (await velarPublishedWorkspacePackages(root)).map((entry) => entry.name);
}

/**
 * The publishable packages that have to be compiled, in an order where every
 * package follows the workspace packages it depends on.
 *
 * Both facts are read from the manifests: a package is built when it declares a
 * `build` script, and it waits for the workspace packages named in its own
 * `dependencies`. The npm script this replaces named six workspaces in a fixed
 * chain, which was correct and was a copy — a seventh compiled package would
 * have been packed by the release gate without ever having been built.
 */
export async function velarToolchainBuildOrder(root = workspaceRoot) {
  const packages = await velarPublishedToolchainPackages(root);
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  const order = [];
  const placed = new Set();
  const visiting = new Set();
  const visit = (entry) => {
    if (placed.has(entry.name)) return;
    if (visiting.has(entry.name)) throw new Error(`workspace dependency cycle through ${entry.name}`);
    visiting.add(entry.name);
    for (const dependency of Object.keys(entry.manifest.dependencies ?? {}).sort()) {
      const workspace = byName.get(dependency);
      if (workspace) visit(workspace);
    }
    visiting.delete(entry.name);
    placed.add(entry.name);
    if (entry.manifest.scripts?.build) order.push(entry);
  };
  // The toolchain roster is sorted by name, so the traversal — and therefore
  // the build order — is the same on every machine.
  for (const entry of packages) visit(entry);
  return order;
}
