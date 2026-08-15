import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { velarProjects } from "../scripts/velar-projects.mjs";

/**
 * D56 rule 131 and D61 rule 156, applied to the other half of the tree.
 *
 * `examples/` holds what teaches; `tests/fixtures/` holds the VelarScript
 * projects that exist to be broken, probed, or measured. Both halves are real
 * projects the compiler must keep accepting, and a fixture that stops compiling
 * is a defect whose only symptom would otherwise be a browser gate failing
 * twenty minutes later for reasons that read like a browser problem.
 *
 * So the fixtures are discovered here the same way the examples are discovered
 * in `scripts/run-project-gate.mjs` — by walking for `velar.json`, never by a
 * list. What each fixture *does* is proved by the test that owns it; what this
 * proves is that all of them still check.
 */

const root = resolve(new URL("..", import.meta.url).pathname);
const cli = join(root, "packages", "cli", "src", "cli.ts");

test("[D61-156] every fixture project under tests/fixtures still checks", async () => {
  const projects = await velarProjects(join(root, "tests", "fixtures"));
  assert.ok(projects.length >= 3, `expected the fixture projects to be discovered, found ${String(projects.length)}`);

  for (const project of projects) {
    const name = relative(root, project);
    const execution = spawnSync(process.execPath, [cli, "check", project], { cwd: root, encoding: "utf8" });
    assert.equal(execution.status, 0, `${name}: ${execution.stdout}${execution.stderr}`);
    assert.match(execution.stdout, /Checked \d+ modules/u, name);
  }
});
