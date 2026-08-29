import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every first-party package owned and published by this repository lives under
 * packages/. Project libraries, concrete adapters, and provider integrations
 * belong to their consuming projects and never join this workspace graph.
 */
async function workspacePackages(root) {
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
      manifest,
    });
  }
  if (found.length === 0) throw new Error("no workspace packages found under packages/");
  // Code-point order: this list decides the order packages are built,
  // published, and written into a release manifest, so it must not follow the
  // collation the build machine's locale selects. Same comparator as the
  // release manifest and the production build manifest.
  return found.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

/** Compiler, CLI, official targets, and other toolchain implementation packages. */
export async function velarToolchainPackages(root = workspaceRoot) {
  return workspacePackages(root);
}

/** Every publishable package in the toolchain release generation. */
export async function velarPublishedToolchainPackages(root = workspaceRoot) {
  return (await velarToolchainPackages(root)).filter((entry) => !entry.private);
}

/** Alias used by complete installed-workspace consumer gates. */
export async function velarPublishedWorkspacePackages(root = workspaceRoot) {
  return velarPublishedToolchainPackages(root);
}

/** The package names in a complete toolchain candidate. */
export async function velarToolchainPackageNames(root = workspaceRoot) {
  return (await velarPublishedToolchainPackages(root)).map((entry) => entry.name);
}

/** All local tarballs needed to exercise the complete official toolchain. */
export async function velarWorkspacePackageNames(root = workspaceRoot) {
  return velarToolchainPackageNames(root);
}

/**
 * Every compiled publishable package, in dependency-first order.
 *
 * Build membership and dependency edges are derived from package manifests.
 * Peers count as edges: whether a package *installs* another one and whether it
 * *compiles against* it are different questions, and D111 separated them — the
 * CLI states Web, Server and Desktop as optional peers so a project stops
 * installing targets it never declared, while its own sources still need their
 * declarations to type-check. Reading only `dependencies` would have built the
 * CLI before the three packages whose `.d.ts` it compiles against.
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
    for (const dependency of Object.keys({ ...entry.manifest.dependencies, ...entry.manifest.peerDependencies }).sort()) {
      const workspace = byName.get(dependency);
      if (workspace) visit(workspace);
    }
    visiting.delete(entry.name);
    placed.add(entry.name);
    if (entry.manifest.scripts?.build) order.push(entry);
  };
  for (const entry of packages) visit(entry);
  return order;
}

/** Alias used by the complete workspace build gate. */
export async function velarWorkspaceBuildOrder(root = workspaceRoot) {
  return velarToolchainBuildOrder(root);
}
