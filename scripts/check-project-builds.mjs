import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { velarProjects } from "./velar-projects.mjs";

/**
 * D60 rule 148 — `velar check` passing is a contract, so what checks must build.
 *
 * An exported `Component<Signature>` alias checked clean and then emitted
 * `Component<(label: string) -> WebNode>.is(value, __state)` — VelarScript type
 * syntax written straight into JavaScript — and the bundler rejected the
 * compiler's own output. The defect survived because nothing ran the two steps
 * back to back: the gates checked four example projects and built none of them,
 * and the tour projects were not gated at all.
 *
 * So every example project now checks and then builds, and the build goes to a
 * throwaway directory rather than the project's own `outDir` so a gate run
 * leaves the tree exactly as it found it.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages", "cli", "dist", "cli.js");

// The same discovery `gate:test` and `gate:test:browser` use (D61 rule 156):
// one answer to "which projects?", so the three gates cannot disagree.
const projects = await velarProjects(join(root, "examples"));
if (projects.length === 0) {
  console.error("No VelarScript example projects were found; this gate cannot pass vacuously.");
  process.exit(1);
}

const failures = [];
const output = await mkdtemp(join(tmpdir(), "velar-project-builds-"));
try {
  for (const project of projects) {
    const name = relative(root, project);
    const checked = velar(["check", project]);
    if (checked.status !== 0) {
      failures.push(`${name}: velar check failed\n${indent(checked.output)}`);
      continue;
    }
    // A project that checks must build. Only a build failure after a clean
    // check is this gate's subject; the check failure above is reported on its
    // own terms so the two are never confused.
    const built = velar(["build", project, "--out-dir", join(output, name.replaceAll("/", "-"))]);
    if (built.status !== 0) failures.push(`${name}: velar check passed but velar build failed\n${indent(built.output)}`);
  }
} finally {
  await rm(output, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`VelarScript projects that do not check and build:\n\n${failures.join("\n\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Checked and built ${projects.length} VelarScript example projects`);
}

function velar(arguments_) {
  const execution = spawnSync(process.execPath, [cli, ...arguments_], { cwd: root, encoding: "utf8" });
  return { status: execution.status, output: `${execution.stdout ?? ""}${execution.stderr ?? ""}`.trimEnd() };
}

function indent(text) {
  return text.split("\n").map((line) => `    ${line}`).join("\n");
}
