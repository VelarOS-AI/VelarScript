import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
 *   node scripts/output-fingerprint.mjs [--write <path>] [--compare <path>] [--quiet]
 *
 * Prints `<sha256>  <project>#<mode>/<path>` for every emitted file, sorted,
 * then one `<digest>  TOTAL <n> files` line over those lines. `--compare`
 * exits 1 with the added / removed / changed files when a listing differs, and
 * names the projects and modes they belong to first, because that is the line a
 * reader acts on. `--quiet` withholds the listing from stdout, for D116's
 * `gate`, which compares against `output-fingerprint.lock` on every run and
 * would otherwise print eight hundred hashes each time.
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

/**
 * D116 — each project builds into its own `.velar/`, at a fixed depth below the
 * project, and never into a temporary directory somewhere else on the machine.
 *
 * This listing is committed as `output-fingerprint.lock` and compared on every
 * `npm run gate`, in every worktree and on every CI runner, so it has to be a
 * fact about the source rather than about where the source is sitting. A
 * temporary output directory is not: a Web project's bundle carries source-map
 * `sources` relative to the output directory, so the number of `../` segments
 * between the two follows the checkout's own path depth, and the bundler's
 * content-hashed asset names — and therefore the HTML and the build manifest
 * that reference them — follow that. Measured: 828 files, of which 6 changed
 * and 24 were renamed purely by moving the checkout three directories deeper.
 * Built at `<project>/.velar/fingerprint/<mode>` the same 828 files are
 * byte-identical across checkouts.
 *
 * `.velar/` is the CLI's own scratch namespace: git ignores it, `velarProjects`
 * and `velarSources` skip it, so nothing here is seen by the next gate's
 * project walk. It is removed before and after each build regardless.
 */
const entries = [];
const scratches = projects.map((project) => join(project, ".velar", "fingerprint"));
try {
  for (const scratch of scratches) await rm(scratch, { recursive: true, force: true });
  for (const project of projects) {
    const name = relative(root, project).replaceAll("\\", "/");
    for (const mode of modes) {
      const output = join(project, ".velar", "fingerprint", mode);
      await mkdir(dirname(output), { recursive: true });
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
  for (const scratch of scratches) await rm(scratch, { recursive: true, force: true });
}

entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
const lines = entries.map((entry) => `${entry.sha256}  ${entry.path}`);
const digest = createHash("sha256").update(`${lines.join("\n")}\n`).digest("hex");
const listing = `${[...lines, `${digest}  TOTAL ${lines.length} files`].join("\n")}\n`;

if (!options.quiet) process.stdout.write(listing);
if (options.write !== undefined) await writeFile(options.write, listing, "utf8");
if (options.compare !== undefined) await compare(options.compare, entries, digest);

/** Parses the three flags this script has. An unknown flag is refused, never ignored. */
function parseArguments(argv) {
  const parsed = { write: undefined, compare: undefined, quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--quiet") {
      parsed.quiet = true;
      continue;
    }
    if (flag !== "--write" && flag !== "--compare") {
      console.error(`Usage: output-fingerprint.mjs [--write <path>] [--compare <path>] [--quiet]\nUnrecognised argument: ${flag}`);
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
  // The projects first: a reader acts on "examples/app#production moved", not
  // on the eleventh of forty chunk hashes underneath it.
  for (const [subject, counts] of byProject([...removed, ...added, ...changed], { removed, added, changed })) {
    report.push(`  ${subject}: ${counts}`);
  }
  report.push("");
  for (const file of removed) report.push(`  removed  ${file}`);
  for (const file of added) report.push(`  added    ${file}`);
  for (const file of changed) report.push(`  changed  ${file}\n             was ${previous.get(file)}\n             now ${now.get(file)}`);
  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    report.push(`  the per-file hashes agree but the total digest does not: ${previousDigest} -> ${currentDigest}`);
  }
  report.push("", `${removed.length} removed, ${added.length} added, ${changed.length} changed, ${now.size} files now.`);
  // The npm form, not the bare script: a listing rewritten without rebuilding
  // the packages first records the output of the toolchain that is on disk
  // rather than the one in the change set.
  report.push("", `Rewrite the listing only when this change means to move the emitted output:  npm run fingerprint -- --write ${relative(root, path) || path}`);
  console.error(report.join("\n"));
  process.exit(1);
}

/** The `<project>#<mode>` subjects a set of differing files belongs to, with per-kind counts. */
function byProject(files, kinds) {
  const subjects = new Map();
  for (const file of files) {
    // `examples/app#production/assets/main.js` → `examples/app#production`: the
    // project and the mode, which is the unit a reader acts on. The project
    // path itself contains slashes, so the subject ends at the first one after
    // the `#`.
    const subject = file.slice(0, file.indexOf("/", file.indexOf("#")));
    if (!subjects.has(subject)) subjects.set(subject, { removed: 0, added: 0, changed: 0 });
    for (const kind of ["removed", "added", "changed"]) {
      if (kinds[kind].includes(file)) subjects.get(subject)[kind] += 1;
    }
  }
  return [...subjects.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([subject, counts]) => [subject, Object.entries(counts).filter(([, count]) => count > 0).map(([kind, count]) => `${count} ${kind}`).join(", ")]);
}
