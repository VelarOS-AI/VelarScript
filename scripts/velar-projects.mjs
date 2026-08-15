import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * D61 rule 156 — which VelarScript projects a gate runs is a derived fact, not
 * a list somebody maintains.
 *
 * `package.json` used to name four example projects for `velar check` and
 * `velar test`. `examples/app` was written, `check:projects` found it because
 * that gate walks directories, and its tests ran nowhere, because the two
 * hand-written lines did not know about it. Every gate that asks "which
 * projects?" now asks this module, so a project cannot be added without being
 * gated, and one that must be skipped is skipped by name and with a reason.
 */

const ignoredDirectories = new Set(["node_modules", "dist", ".velar"]);

/** Every directory at or below `directory` that holds a `velar.json` manifest. */
export async function velarProjects(directory) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  if (entries.some((entry) => entry.isFile() && entry.name === "velar.json")) found.push(directory);
  for (const entry of entries) {
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      found.push(...await velarProjects(join(directory, entry.name)));
    }
  }
  return found.sort();
}

/** Every `.vel` file at or below `directory`, ignoring build and dependency output. */
export async function velarSources(directory) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      found.push(...await velarSources(join(directory, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".vel")) {
      found.push(join(directory, entry.name));
    }
  }
  return found.sort();
}
