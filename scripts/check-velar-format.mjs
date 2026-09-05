import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatDiagnostic, formatSourceResult, SourceText } from "@velarscript/compiler";
import { velarCompilerExtension as nodeCompilerExtension } from "@velarscript/node/compiler";
import { velarCompilerExtension as desktopCompilerExtension } from "@velarscript/desktop/compiler";
import { velarCompilerExtension as serverCompilerExtension } from "@velarscript/server/compiler";
import { velarCompilerExtension as webCompilerExtension } from "@velarscript/web/compiler";
import { createTemplateFiles } from "../packages/create/src/templates.ts";
import { VELAR_CREATE_VERSION, VELAR_PROJECT_FORMAT_VERSION, VELAR_PROJECT_TEMPLATES } from "../packages/create/src/types.ts";
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

const bundledExtensions = new Map([
  ["@velarscript/web", webCompilerExtension],
  ["@velarscript/node", nodeCompilerExtension],
  ["@velarscript/server", serverCompilerExtension],
  ["@velarscript/desktop", desktopCompilerExtension],
]);

// D114 0.28.0 I-D1. Which extensions a module is written against is a question
// its `velar.json` already answers, and the regex below is only the answer for
// source that has no project — `tests/corpus` and the fragments beside it. The
// regex was the only answer here until the formatter began refusing source it
// cannot parse, and it was wrong for three modules in this repository:
// `export state` puts a word before the head keyword it looks for, and a module
// that only writes `look` units names no head keyword at all. All three were
// being format-checked as though Web syntax were Core syntax. Reading the
// manifest is not a new rule, it is the rule the project layer already uses.
const manifestExtensions = (manifest, name) => {
  let declared;
  try { declared = JSON.parse(manifest).extensions; } catch { return null; }
  if (!Array.isArray(declared)) return null;
  const resolved = declared.map((extension) => bundledExtensions.get(extension));
  // An extension this gate cannot load is named rather than dropped: skipping
  // it would format the module against the wrong language and call it checked.
  if (resolved.some((extension) => extension === undefined)) {
    failures.push(`${name}: velar.json declares an extension this gate cannot load (${declared.join(", ")})`);
    return null;
  }
  return resolved;
};

const guessedExtensions = (source) => {
  const nodeOwned = /(?:^|\n)\s*(?:export\s+)?server\s+[A-Za-z_][A-Za-z0-9_]*:/u.test(source);
  const webOwned = /(?:^|\n)\s*(?:component|state|resource|action|watch|@mounted|@cleanup)\b|<[A-Za-z][A-Za-z0-9_.:-]*(?:\s|\/?>)/u.test(source);
  return nodeOwned ? [nodeCompilerExtension] : webOwned ? [webCompilerExtension] : [];
};

// The formatter answers a source it cannot parse with that source unchanged, so
// "formatted" and "unparsed" now look identical from the text alone. They are
// two different failures with two different fixes — one is a stale layout, the
// other is source that does not compile — so this gate asks for both answers
// and reports the one it got. A file that does not parse is never reported as a
// formatting difference.
const formatFailure = (name, source, manifest) => {
  const extensions = (manifest === null ? null : manifestExtensions(manifest, name)) ?? guessedExtensions(source);
  const { text, blocked } = formatSourceResult(source, { extensions });
  if (blocked) return `${name}: does not parse, so the formatter left it unchanged\n${formatDiagnostic(new SourceText(name, source), blocked)}`;
  return text === source ? null : name;
};

const manifests = new Map();
const nearestManifest = async (file) => {
  let directory = dirname(file);
  while (directory.startsWith(root)) {
    if (!manifests.has(directory)) {
      manifests.set(directory, await readFile(join(directory, "velar.json"), "utf8").catch(() => null));
    }
    const manifest = manifests.get(directory);
    if (manifest !== null) return manifest;
    if (directory === root) break;
    directory = dirname(directory);
  }
  return null;
};

for (const file of files) {
  const failure = formatFailure(relative(root, file), await readFile(file, "utf8"), await nearestManifest(file));
  if (failure !== null) failures.push(failure);
}

// The project templates are VelarScript source too: a new author's first file
// comes from them, so they answer to the formatter like every other example.
let templateCount = 0;
for (const template of VELAR_PROJECT_TEMPLATES) {
  const scaffolded = createTemplateFiles(template, join(root, "example-app"), VELAR_CREATE_VERSION, VELAR_PROJECT_FORMAT_VERSION);
  // A template scaffolds its own manifest, so it answers the extension question
  // for its sources exactly as a project on disk does.
  const manifest = scaffolded.get("velar.json") ?? null;
  for (const [name, source] of scaffolded) {
    if (!name.endsWith(".vel")) continue;
    templateCount += 1;
    const failure = formatFailure(`packages/create template ${template}: ${name}`, source, manifest);
    if (failure !== null) failures.push(failure);
  }}

if (failures.length > 0) {
  console.error(`VelarScript source formatting is stale:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} formatted VelarScript source files and ${templateCount} project template sources`);
}
