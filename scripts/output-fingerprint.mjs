import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { velarProjects } from "./velar-projects.mjs";

/**
 * D114 R0 — what the toolchain emits, byte for byte.
 *
 * The D114 refactor (R1–R6) is a structural split with zero semantic change,
 * and its acceptance criterion is stronger than "the tests still pass": every
 * byte the compiler emits for every gated project must be the byte it emitted
 * before. Tests assert what somebody thought to assert; a hash of the output
 * asserts everything, including the things nobody wrote a test for — chunk
 * names, module order, minified identifier choice, CSS ordering, manifest key
 * order, source-map mappings.
 *
 * Which projects are fingerprinted is derived, not listed (D61 rule 156): the
 * same `velarProjects` walk the gates use over `examples/`, plus the fixture
 * projects under `tests/fixtures/` that carry a `velar.json` and are otherwise
 * only reached through test files.
 *
 * Two build modes are fingerprinted per project. `production` is what ships;
 * `readable` is the separate un-minified emission path, where a lowering
 * difference shows up as readable JavaScript rather than as a changed hash of
 * minified text. `velar check` and `velar run` emit through the same compiler
 * but write no directory a run can be pointed at — `run` compiles into a
 * temporary launcher it deletes — so `build` is the only emitted artifact a
 * fingerprint can hold, and these two modes are it.
 *
 * Usage:
 *   node scripts/output-fingerprint.mjs [--write <path>] [--compare <path>]
 *
 * Prints `<sha256>  <project>#<mode>/<path>` for every emitted file, sorted,
 * then one `<digest>  TOTAL <n> files` line over those lines. `--compare`
 * exits 1 with the added / removed / changed files when a listing differs.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages", "cli", "dist", "cli.js");
const modes = ["production", "readable"];

const options = parseArguments(process.argv.slice(2));

const projects = [
  ...await velarProjects(join(root, "examples")),
  ...await velarProjects(join(root, "tests", "fixtures")),
];
if (projects.length === 0) {
  console.error("No VelarScript projects were found; this fingerprint cannot be taken vacuously.");
  process.exit(2);
}

// Never inside the repository: a build directory under the checkout would be
// seen by the next gate's project walk and by git.
const scratch = await mkdtemp(join(tmpdir(), "velar-fingerprint-"));
const entries = [];
try {
  for (const project of projects) {
    const name = relative(root, project).replaceAll("\\", "/");
    for (const mode of modes) {
      const output = join(scratch, `${name.replaceAll("/", "-")}-${mode}`);
      const built = velar(["build", project, "--out-dir", output, "--mode", mode]);
      if (built.status !== 0) {
        console.error(`velar build --mode ${mode} failed for ${name}:\n${built.output}`);
        process.exit(2);
      }
      for (const file of await filesUnder(output)) {
        entries.push({
          path: `${name}#${mode}/${relative(output, file).replaceAll("\\", "/")}`,
          sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
        });
      }
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
const lines = entries.map((entry) => `${entry.sha256}  ${entry.path}`);
const digest = createHash("sha256").update(`${lines.join("\n")}\n`).digest("hex");
const listing = `${[...lines, `${digest}  TOTAL ${lines.length} files`].join("\n")}\n`;

process.stdout.write(listing);
if (options.write !== undefined) await writeFile(options.write, listing, "utf8");
if (options.compare !== undefined) await compare(options.compare, entries, digest);

/** Parses the two flags this script has. An unknown flag is refused, never ignored. */
function parseArguments(argv) {
  const parsed = { write: undefined, compare: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--write" && flag !== "--compare") {
      console.error(`Usage: output-fingerprint.mjs [--write <path>] [--compare <path>]\nUnrecognised argument: ${flag}`);
      process.exit(2);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      console.error(`${flag} requires a path`);
      process.exit(2);
    }
    parsed[flag.slice(2)] = resolve(value);
    index += 1;
  }
  return parsed;
}

/** Every file at or below `directory`, absolute, in no particular order. */
async function filesUnder(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

function velar(arguments_) {
  const execution = spawnSync(process.execPath, [cli, ...arguments_], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: execution.status, output: `${execution.stdout ?? ""}${execution.stderr ?? ""}`.trimEnd() };
}

/** Reports this run against a saved listing, and fails when they disagree. */
async function compare(path, current, currentDigest) {
  let saved;
  try {
    saved = await readFile(path, "utf8");
  } catch (error) {
    console.error(`Could not read the baseline listing ${path}: ${error.message}`);
    process.exit(2);
  }
  const previous = new Map();
  let previousDigest;
  for (const line of saved.split("\n")) {
    if (line.trim() === "") continue;
    const separator = line.indexOf("  ");
    if (separator === -1) {
      console.error(`Malformed line in ${path}: ${line}`);
      process.exit(2);
    }
    const hash = line.slice(0, separator);
    const subject = line.slice(separator + 2);
    if (subject.startsWith("TOTAL ")) previousDigest = hash;
    else previous.set(subject, hash);
  }

  const now = new Map(current.map((entry) => [entry.path, entry.sha256]));
  const added = [...now.keys()].filter((file) => !previous.has(file)).sort();
  const removed = [...previous.keys()].filter((file) => !now.has(file)).sort();
  const changed = [...now.keys()].filter((file) => previous.has(file) && previous.get(file) !== now.get(file)).sort();

  if (added.length === 0 && removed.length === 0 && changed.length === 0 && previousDigest === currentDigest) {
    console.error(`Emitted output is byte-identical to ${path} (${now.size} files).`);
    return;
  }

  const report = [`Emitted output differs from ${path}:`, ""];
  for (const file of removed) report.push(`  removed  ${file}`);
  for (const file of added) report.push(`  added    ${file}`);
  for (const file of changed) report.push(`  changed  ${file}\n             was ${previous.get(file)}\n             now ${now.get(file)}`);
  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    report.push(`  the per-file hashes agree but the total digest does not: ${previousDigest} -> ${currentDigest}`);
  }
  report.push("", `${removed.length} removed, ${added.length} added, ${changed.length} changed, ${now.size} files now.`);
  console.error(report.join("\n"));
  process.exit(1);
}
