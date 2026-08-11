import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSource } from "@velarscript/compiler";
import { velarCompilerExtension as webCompilerExtension } from "@velarscript/web/compiler";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set(["node_modules", "dist", ".velar"]);
const files = [
  ...await velarFiles(join(root, "examples")),
  ...await velarFiles(join(root, "packages")),
].sort();
const failures = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const webOwned = /(?:^|\n)\s*(?:component|state|resource|action|watch|mounted|cleanup)\b|<[A-Za-z][A-Za-z0-9_.:-]*(?:\s|\/?>)/u.test(source);
  if (formatSource(source, { extensions: webOwned ? [webCompilerExtension] : [] }) !== source) failures.push(relative(root, file));
}

if (failures.length > 0) {
  console.error(`VelarScript source formatting is stale:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} formatted VelarScript source files`);
}

async function velarFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      files.push(...await velarFiles(join(directory, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".vel")) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}
