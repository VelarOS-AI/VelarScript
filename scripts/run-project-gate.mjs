import { spawnSync } from "node:child_process";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { velarProjects, velarSources } from "./velar-projects.mjs";

/**
 * D61 rule 156 — `velar check` and `velar test` over every example project,
 * discovered rather than listed.
 *
 * `gate:test` and `gate:test:browser` used to name four projects each. That is
 * the D57 rule 134 family: a list with an authoritative source kept by hand. It
 * never fails, it just cannot see new members — `examples/app` was gated by
 * nothing at all while carrying twenty-one tests, because nobody edited those
 * two lines when it was written.
 *
 * So the list is gone rather than corrected. What runs is decided here:
 *
 *   unit     every project with a `*.test.vel` module that is not a browser
 *            test runs `velar test`. The separate source-quality gate checks
 *            every project once, so the release chain does not compile them
 *            again here before running their tests.
 *   browser  every project with a `*.browser.test.vel` module runs
 *            `velar test --browser chromium`.
 *
 * A project that genuinely must be skipped goes in `excluded` below with its
 * reason: an exclusion is visible in this file and in the gate's own output,
 * while a project missing from a list is visible nowhere.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages", "cli", "dist", "cli.js");

/** Projects deliberately not gated, each with the reason it is not. */
const excluded = new Map([
  // Empty on purpose. Add `["examples/<name>", "why"]`, never a silent removal.
]);

const mode = process.argv[2];
if (mode !== "unit" && mode !== "browser") {
  console.error("Usage: run-project-gate.mjs <unit|browser>");
  process.exit(2);
}

const discovered = await velarProjects(join(root, "examples"));
if (discovered.length === 0) {
  console.error("No VelarScript example projects were found; this gate cannot pass vacuously.");
  process.exit(1);
}

const failures = [];
const ran = [];
const skipped = [];
const executed = new Set();

for (const project of discovered) {
  const name = relative(root, project);
  const reason = excluded.get(name);
  if (reason !== undefined) {
    skipped.push(`${name}: excluded — ${reason}`);
    continue;
  }
  const sources = await velarSources(project);
  const browserTests = sources.filter((file) => basename(file).endsWith(".browser.test.vel"));
  const unitTests = sources.filter((file) => basename(file).endsWith(".test.vel") && !basename(file).endsWith(".browser.test.vel"));

  if (mode === "unit") {
    if (unitTests.length === 0) {
      skipped.push(`${name}: no unit tests to run`);
      continue;
    }
    executed.add(name);
    const tested = velar(["test", project]);
    if (tested.status !== 0) failures.push(`${name}: velar test failed\n${indent(tested.output)}`);
    else ran.push(`${name}: ${summarize(tested.output)}`);
    continue;
  }

  if (browserTests.length === 0) {
    skipped.push(`${name}: no browser tests to run`);
    continue;
  }
  executed.add(name);
  const tested = velar(["test", project, "--browser", "chromium"]);
  if (tested.status !== 0) failures.push(`${name}: velar test --browser chromium failed\n${indent(tested.output)}`);
  else ran.push(`${name}: ${summarize(tested.output)}`);
}

for (const line of ran) console.log(`  ${line}`);
for (const line of skipped) console.log(`  ${line}`);

if (failures.length > 0) {
  console.error(`VelarScript example projects that failed the ${mode} gate:\n\n${failures.join("\n\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Ran the ${mode} gate over ${executed.size} of ${discovered.length} discovered VelarScript example projects`);
}

function velar(arguments_) {
  const execution = spawnSync(process.execPath, [cli, ...arguments_], { cwd: root, encoding: "utf8" });
  return { status: execution.status, output: `${execution.stdout ?? ""}${execution.stderr ?? ""}`.trimEnd() };
}

function summarize(output) {
  const totals = output.split("\n").filter((line) => /^\d+ passed, \d+ failed$/u.test(line.trim()));
  return totals.at(-1)?.trim() ?? "completed";
}

function indent(text) {
  return text.split("\n").map((line) => `    ${line}`).join("\n");
}
