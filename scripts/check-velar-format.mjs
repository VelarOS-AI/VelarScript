import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSource } from "@velarscript/compiler";
import { velarCompilerExtension as nodeCompilerExtension } from "@velarscript/node/compiler";
import { velarCompilerExtension as webCompilerExtension } from "@velarscript/web/compiler";
import { createTemplateFiles } from "../packages/create/src/templates.ts";
import { VELAR_PROJECT_TEMPLATES } from "../packages/create/src/types.ts";
import { velarSources } from "./velar-projects.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `tests` is walked for the reason D55 rule 127.2 gives: the formatter's
// generic-bracket defect survived because no `.vel` file in the repository
// spelled `: Record<…>`, so a gate that walked only the examples passed for a
// reason unrelated to the formatter being right. `tests/corpus` holds the
// shapes no showcase would naturally write, and `tests/fixtures` holds whole
// projects written in the same language — both are VelarScript source, and
// source this gate cannot reach is source the formatter may rewrite freely.
// A fixture that must stay unformatted belongs on a named exclusion here, with
// its reason: an exclusion is visible, a directory nobody walks is not.
const files = [
  ...await velarSources(join(root, "examples")),
  ...await velarSources(join(root, "packages")),
  ...await velarSources(join(root, "tests")),
].sort();
const failures = [];

// The corpus is the only walk root whose whole purpose is to carry shapes
// nothing else writes, so an empty one is not "nothing to do" — it is this
// gate quietly losing the coverage it was extended for.
const corpusFiles = files.filter((file) => file.startsWith(join(root, "tests", "corpus")));
if (corpusFiles.length === 0) {
  console.error("No VelarScript sources were found in tests/corpus; this gate's corpus coverage cannot pass vacuously.");
  process.exit(1);
}

const isFormatted = (source) => {
  const nodeOwned = /(?:^|\n)\s*(?:export\s+)?server\s+[A-Za-z_][A-Za-z0-9_]*:/u.test(source);
  const webOwned = /(?:^|\n)\s*(?:component|state|resource|action|watch|@mounted|@cleanup)\b|<[A-Za-z][A-Za-z0-9_.:-]*(?:\s|\/?>)/u.test(source);
  return formatSource(source, { extensions: nodeOwned ? [nodeCompilerExtension] : webOwned ? [webCompilerExtension] : [] }) === source;
};

for (const file of files) {
  if (!isFormatted(await readFile(file, "utf8"))) failures.push(relative(root, file));
}

// The project templates are VelarScript source too: a new author's first file
// comes from them, so they answer to the formatter like every other example.
let templateCount = 0;
for (const template of VELAR_PROJECT_TEMPLATES) {
  for (const [name, source] of createTemplateFiles(template, join(root, "example-app"), "0.12.1", 2)) {
    if (!name.endsWith(".vel")) continue;
    templateCount += 1;
    if (!isFormatted(source)) failures.push(`packages/create template ${template}: ${name}`);
  }}

if (failures.length > 0) {
  console.error(`VelarScript source formatting is stale:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} formatted VelarScript source files and ${templateCount} project template sources`);
}
