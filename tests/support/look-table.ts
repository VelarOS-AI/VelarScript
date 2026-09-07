import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./repository-root.ts";

const lookDirectory = join(repositoryRoot, "packages", "web", "src", "look");

/**
 * D65 rule 168 and D73 rule 187 are load-time facts: the module that declares a
 * Look property's keyword set throws when a property that decides string values
 * publishes none. Both probes prove it the same way — load a copy of the table
 * with one entry removed and assert the module refuses to come up — so staging
 * that copy is written here once.
 *
 * D115 P4 R3e split `look.ts` into `look/`, and `look/keywords.ts` is where the
 * table and its invariant now live. A copy of it has to find its collaborators,
 * so the whole directory travels with it and the manifest makes every file in
 * the destination a module.
 */
export async function stageLookTable(directory: string): Promise<string> {
  await writeFile(join(directory, "package.json"), '{"type":"module"}\n', "utf8");
  for (const name of await readdir(lookDirectory)) {
    await copyFile(join(lookDirectory, name), join(directory, name));
  }
  return readFile(join(lookDirectory, "keywords.ts"), "utf8");
}
