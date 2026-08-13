import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSource } from "@velarscript/compiler";
import { velarCompilerExtension as webCompilerExtension } from "@velarscript/web/compiler";
import { createTemplateFiles } from "../packages/create/src/templates.ts";
import { VELAR_PROJECT_TEMPLATES } from "../packages/create/src/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set(["node_modules", "dist", ".velar"]);
const files = [
  ...await velarFiles(join(root, "examples")),
  ...await velarFiles(join(root, "packages")),
].sort();
const failures = [];

const isFormatted = (source) => {
  const webOwned = /(?:^|\n)\s*(?:component|state|resource|action|watch|mounted|cleanup)\b|<[A-Za-z][A-Za-z0-9_.:-]*(?:\s|\/?>)/u.test(source);
  return formatSource(source, { extensions: webOwned ? [webCompilerExtension] : [] }) === source;
};

for (const file of files) {
  if (!isFormatted(await readFile(file, "utf8"))) failures.push(relative(root, file));
}

// The project templates are VelarScript source too: a new author's first file
// comes from them, so they answer to the formatter like every other example.
let templateCount = 0;
for (const template of VELAR_PROJECT_TEMPLATES) {
  for (const [name, source] of createTemplateFiles(template, join(root, "example-app"), "0.10.0", 2)) {
    if (!name.endsWith(".vel")) continue;
    templateCount += 1;
    if (!isFormatted(source)) failures.push(`packages/create template ${template}: ${name}`);
  }
}

if (failures.length > 0) {
  console.error(`VelarScript source formatting is stale:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} formatted VelarScript source files and ${templateCount} project template sources`);
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
