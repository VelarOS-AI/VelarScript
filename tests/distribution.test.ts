import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTemplateFiles } from "../packages/create/src/templates.ts";
import { VELAR_CREATE_VERSION, VELAR_PROJECT_FORMAT_VERSION, VELAR_PROJECT_TEMPLATES } from "../packages/create/src/types.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("the AI skill brief ships byte-identical inside the CLI package and stays within budget", async () => {
  const source = await readFile(join(root, "docs", "ai-skill.md"));
  const packaged = await readFile(join(root, "packages", "cli", "skill", "ai-skill.md"));
  assert.ok(source.equals(packaged),
    "packages/cli/skill/ai-skill.md must stay byte-identical to docs/ai-skill.md; update both in the same commit");
  // D50 rule 98: the ceiling forces ranking, not brevity for its own sake — the
  // brief must teach what an author needs to write ordinary code, and the long
  // tail stays out because the diagnostic names the spelling when they hit it.
  // Reaching this line means cutting the least-needed content, not raising it.
  const lines = source.toString("utf8").split("\n").length;
  assert.ok(lines <= 750, `docs/ai-skill.md must stay within 750 lines (found ${lines}); cut the least-needed content rather than raising the ceiling — the long tail belongs in diagnostics`);
  const manifest = JSON.parse(await readFile(join(root, "packages", "cli", "package.json"), "utf8")) as { files: string[] };
  assert.ok(manifest.files.includes("skill"), "the @velarscript/cli package must publish the skill directory");
});

test("velar skill prints the packaged brief verbatim to stdout", async () => {
  const source = await readFile(join(root, "docs", "ai-skill.md"), "utf8");
  const printed = spawnSync(process.execPath, [join(root, "packages", "cli", "src", "cli.ts"), "skill"], { encoding: "utf8" });
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(printed.stdout, source, "velar skill must print docs/ai-skill.md without modification");
  assert.equal(printed.stderr, "");

  const help = spawnSync(process.execPath, [join(root, "packages", "cli", "src", "cli.ts"), "help", "skill"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Prints the packaged VelarScript AI skill brief verbatim/u);

  const rejected = spawnSync(process.execPath, [join(root, "packages", "cli", "src", "cli.ts"), "skill", "extra"], { encoding: "utf8" });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /does not accept arguments/u);
});

test("every create-velar template scaffolds the AGENTS.md brief pointer", () => {
  for (const template of VELAR_PROJECT_TEMPLATES) {
    const files = createTemplateFiles(template, join(root, "example-app"), VELAR_CREATE_VERSION, VELAR_PROJECT_FORMAT_VERSION);
    const guide = files.get("AGENTS.md");
    assert.ok(guide, `the ${template} template must scaffold a root AGENTS.md`);
    assert.match(guide, /velar skill/u, "AGENTS.md must point agents at the full brief");
    for (const gate of ["`velar check`", "`velar test`", "`velar format`"]) {
      assert.ok(guide.includes(gate), `AGENTS.md must name the ${gate} gate`);
    }
    assert.match(guide, /extern module/u, "AGENTS.md must carry the escape-hatch pointer");
    assert.match(guide, /readable, source-mapped exit/u, "AGENTS.md must name the final readable-JavaScript exit");
    const lines = guide.split("\n").length;
    assert.ok(lines <= 80, `AGENTS.md must stay a pointer, not a copy of the brief (${template}: ${lines} lines)`);
  }
});
