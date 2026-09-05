import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateRuntimeSources } from "./generate-runtime-sources.mjs";

/**
 * D115 §二 `check:runtime-sources` — `packages/compiler/runtime/**` is the one
 * true source of the JavaScript the compiler emits, and
 * `src/runtime-sources.generated.ts` is only its transcription.
 *
 * The generated module is committed because tests and every workspace package
 * import those constants from `src/`. A committed generated file is a file
 * that can be edited, and an edit to it is a runtime change that no JavaScript
 * parser ever read — exactly the state D115 §一.4 removed. So this gate
 * regenerates into a temporary file and refuses any difference, and it refuses
 * a `runtime/*.js` that the manifest does not name, because a file nothing
 * generates from is a file whose edits go nowhere.
 */

const GATE = "scripts/check-runtime-sources.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPath = join(root, "packages", "compiler", "src", "runtime-sources.generated.ts");
const runtimeDirectory = join(root, "packages", "compiler", "runtime");

const failures = [];
const generated = await generateRuntimeSources(root);
failures.push(...generated.problems);

const named = new Set(generated.manifest.files.map((entry) => entry.file));
for (const entry of await readdir(runtimeDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
  if (!named.has(entry.name)) {
    failures.push(`packages/compiler/runtime/${entry.name}: no manifest entry names this file, so nothing is generated from it`);
  }
}
for (const file of named) {
  if (generated.files.get(file) === "") failures.push(`packages/compiler/runtime/${file}: is empty`);
}

const committed = await readFile(generatedPath, "utf8").catch(() => null);
if (committed === null) {
  failures.push(`packages/compiler/src/runtime-sources.generated.ts is missing; regenerate it with \`node scripts/generate-runtime-sources.mjs\``);
} else if (committed !== generated.text) {
  const scratch = await mkdtemp(join(tmpdir(), "velar-runtime-sources-"));
  const fresh = join(scratch, "runtime-sources.generated.ts");
  await writeFile(fresh, generated.text, "utf8");
  failures.push([
    "packages/compiler/src/runtime-sources.generated.ts does not match what packages/compiler/runtime/ generates.",
    "",
    `  A fresh generation is at ${fresh}; the difference is ${describe(committed, generated.text)}.`,
    "",
    "  The runtime `.js` files are the source and this file is their transcription, so the fix is never",
    "  to edit the generated file: run `node scripts/generate-runtime-sources.mjs` (or `npm run build:packages`,",
    "  which runs it) and commit what it writes.",
  ].join("\n"));
}

/** The first line that differs, because a byte count is not navigable. */
function describe(left, right) {
  const before = left.split("\n");
  const after = right.split("\n");
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    if (before[index] === after[index]) continue;
    const which = before[index] === undefined ? "missing" : after[index] === undefined ? "extra" : "changed";
    const name = /export const ([A-Z0-9_]+)/u.exec(after[index] ?? before[index] ?? "")?.[1];
    return `at line ${index + 1} (${which}${name === undefined ? "" : `, ${name}`})`;
  }
  return "trailing whitespace only";
}

if (failures.length > 0) {
  process.stderr.write(`${failures.map((failure) => `  ${failure}`).join("\n")}\n\n`);
  process.stderr.write(`${GATE}: ${failures.length} problem${failures.length === 1 ? "" : "s"}.\n`);
  process.exit(1);
}
process.stdout.write(
  `Checked ${generated.files.size} runtime sources against ${generated.values.size} generated constants`
  + `, and every resolved interpolation against the constant it was rendered from\n`,
);
