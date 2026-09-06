import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FINGERPRINT_LOCK,
  buildPlan,
  explainPlan,
  parseScopeArguments,
  summarizePlan,
} from "./gate-scope.mjs";
import { velarProjects, velarSources } from "./velar-projects.mjs";

/**
 * D116 §二.3 — the default gate. One command that works out what this change
 * set can have moved, runs exactly that, and says what it skipped and why.
 *
 * The quick tier is four steps: build and `check`, the emitted-output
 * fingerprint against its committed lock, the planned Node test files, and the
 * example projects' own `velar test`. The browser suite and the packed-consumer
 * suite are never here — D116 §三 puts them in the heavy tier, which
 * `release:check` runs before a release, and the fingerprint is what stands in
 * for them until then: byte-identical emitted output is an unchanged verdict
 * for two suites that only ever run emitted output.
 *
 * Usage:
 *   npm run gate                       the change set since origin/main
 *   npm run gate -- --all              the whole quick tier, change set ignored
 *   npm run gate -- --since <ref>      measured against another base
 *   npm run gate -- --explain          print the plan and run nothing
 *   npm run gate -- --json             the same plan as JSON
 *   node scripts/gate.mjs --plan <f>   run a plan another job already computed
 *   node scripts/gate.mjs --only node  run one part of the plan (CI splits the
 *                                      quick tier over jobs, so each job runs
 *                                      the part it is for)
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The `node --test` invocation is `run-node-tests.mjs`'s own, replicated rather
 * than imported: that script exports its file discovery — which is what this
 * gate needs and does use — and runs its spawn from the module's own entry
 * clause, so there is no function to call. The flags below are its flags, and
 * `tests/repo/gate-scope.test.ts` pins the two against each other so they cannot
 * drift apart quietly.
 */
const NODE_TEST_ARGUMENTS = ["--test", "--test-concurrency=1", "--test-timeout=120000"];

const SUITES = ["check", "fingerprint", "node", "projects"];

const options = readArguments(process.argv.slice(2));
const only = readOnly(options.rest["--only"]);
const plan = options.rest["--plan"] === undefined
  ? await buildPlan({ since: options.since, all: options.all })
  : JSON.parse(await readFile(resolve(options.rest["--plan"]), "utf8"));

if (options.json) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exit(0);
}
process.stdout.write(`${explainPlan(plan)}\n\n`);
if (options.explain) process.exit(0);

const ran = [];
const failed = [];

await step("check", only.has("check") && plan.suites.check, () => npm("run", "check"));
await step(`fingerprint (${FINGERPRINT_LOCK})`, only.has("fingerprint") && plan.suites.fingerprint, fingerprint);
await step(`Node suite (${plan.suites.node.length} files)`, only.has("node") && plan.suites.node.length > 0, nodeTests);
await step("project unit gate", only.has("projects") && plan.suites.projectUnit && await ownsGatedProject(plan), () => node("scripts/run-project-gate.mjs", "unit"));

process.stdout.write(`\n${summarizePlan(plan, ran.length === 0 ? ["nothing to run"] : ran)}\n`);
if (failed.length > 0) {
  process.stderr.write(`\ngate failed: ${failed.join(", ")}\n`);
  process.exitCode = 1;
}

/** Runs one suite when the plan calls for it, and records the verdict either way. */
async function step(label, wanted, run) {
  if (!wanted) return;
  if (failed.length > 0) {
    process.stdout.write(`\n─── ${label}: not started, an earlier suite failed ───\n`);
    return;
  }
  process.stdout.write(`\n─── ${label} ───\n`);
  const code = await run();
  ran.push(label);
  if (code !== 0) failed.push(label);
}

/** The emitted-output fingerprint against the lock this change set is allowed to move. */
async function fingerprint() {
  const code = await node("scripts/output-fingerprint.mjs", "--quiet", "--compare", FINGERPRINT_LOCK);
  if (code !== 0) {
    // The command is on the line the comparison itself just printed; what is
    // added here is the rule that decides whether running it is the right move.
    process.stderr.write([
      "",
      `  This change set does not update ${FINGERPRINT_LOCK}, so one of the two is wrong.`,
      "",
      "  A refactor slice must leave the lock untouched — an unmoved lock is what proves it changed no",
      "  output. A wave that means to change what the toolchain emits rewrites the lock in the same change",
      "  set, with the command above, and the diff is then the record of what it changed.",
      "",
    ].join("\n"));
  }
  return code;
}

/** The planned Node test files, through the runner's own invocation. */
function nodeTests() {
  return spawnStep(process.execPath, [...NODE_TEST_ARGUMENTS, ...plan.suites.node.map((file) => join(root, file))]);
}

/**
 * Whether any example project the unit gate would run belongs to a package in
 * this plan. `run-project-gate.mjs` discovers every project rather than taking
 * a filter, so the choice a plan can make is to run it or not.
 */
async function ownsGatedProject(current) {
  for (const project of await velarProjects(join(root, "examples"))) {
    const sources = await velarSources(project);
    if (!sources.some((file) => basename(file).endsWith(".test.vel") && !basename(file).endsWith(".browser.test.vel"))) continue;
    const manifest = JSON.parse(await readFile(join(project, "velar.json"), "utf8"));
    const declared = new Set(Object.keys(manifest.surfaces ?? {}));
    for (const extension of manifest.extensions ?? []) {
      const name = /^@velarscript\/([a-z]+)$/u.exec(extension)?.[1];
      if (name !== undefined) declared.add(name);
    }
    if ([...declared].some((package_) => current.closure.includes(package_))) return true;
  }
  return false;
}

function node(...arguments_) {
  return spawnStep(process.execPath, arguments_);
}

/**
 * npm is reached through the running npm's own entry point, the way
 * `gate-lock.mjs` does it, so this gate does not depend on a shell or on how a
 * platform resolves `npm` on PATH.
 */
function npm(...arguments_) {
  const entry = process.env.npm_execpath;
  return entry === undefined
    ? spawnStep(process.platform === "win32" ? "npm.cmd" : "npm", arguments_)
    : spawnStep(process.execPath, [entry, ...arguments_]);
}

function spawnStep(executable, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise(signal ? 1 : code ?? 1));
  });
}

function readArguments(argv) {
  try {
    return parseScopeArguments(argv, new Set(["--plan", "--only"]));
  } catch (error) {
    process.stderr.write(`${error.message}\n\nUsage: gate.mjs [--since <ref>] [--all] [--explain | --json] [--plan <file>] [--only ${SUITES.join(",")}]\n`);
    process.exit(2);
  }
}

/** The suites this run is for. Absent means all of them; an unknown name is refused. */
function readOnly(value) {
  if (value === undefined) return new Set(SUITES);
  const wanted = value.split(",").map((name) => name.trim()).filter((name) => name !== "");
  const unknown = wanted.filter((name) => !SUITES.includes(name));
  if (wanted.length === 0 || unknown.length > 0) {
    process.stderr.write(`--only takes a comma-separated subset of ${SUITES.join(",")}; ${unknown.join(", ") || "it was empty"}\n`);
    process.exit(2);
  }
  return new Set(wanted);
}
