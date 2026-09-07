/** Which files in a project are browser tests. */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function discoverBrowserTestFiles(root: string, excluded: ReadonlySet<string>, sourceSuffix: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || excluded.has(path)) continue;
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(sourceSuffix)) output.push(path);
    }
  };
  await visit(root);
  return output.sort();
}
