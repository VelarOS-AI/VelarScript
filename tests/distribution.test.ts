import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTemplateFiles } from "../packages/create/src/templates.ts";
import { VELAR_CREATE_VERSION, VELAR_PROJECT_FORMAT_VERSION, VELAR_PROJECT_TEMPLATES } from "../packages/create/src/types.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const skillFiles = Object.freeze({
  core: "ai-skill.md",
  web: "ai-skill-web.md",
  node: "ai-skill-node.md",
  server: "ai-skill-server.md",
  desktop: "ai-skill-desktop.md",
});

test("the owner-specific AI skill briefs ship byte-identical inside the CLI package and stay within budget", async () => {
  for (const [owner, file] of Object.entries(skillFiles)) {
    const source = await readFile(join(root, "docs", file));
    const packaged = await readFile(join(root, "packages", "cli", "skill", file));
    assert.ok(source.equals(packaged),
      `packages/cli/skill/${file} must stay byte-identical to docs/${file}; update both in the same commit`);
    // Each owner stays bounded independently; cross-target detail belongs in
    // the other owner brief instead of consuming every project's context.
    const lines = source.toString("utf8").split("\n").length;
    assert.ok(lines <= 750, `docs/${file} must stay within 750 lines (found ${lines}); split owner-specific content instead of raising the ceiling (${owner})`);
  }
  const manifest = JSON.parse(await readFile(join(root, "packages", "cli", "package.json"), "utf8")) as { files: string[] };
  assert.ok(manifest.files.includes("skill"), "the @velarscript/cli package must publish the skill directory");
});

test("velar skill selects and prints each packaged owner brief verbatim", async () => {
  const cli = join(root, "packages", "cli", "src", "cli.ts");
  for (const [owner, file] of Object.entries(skillFiles)) {
    const source = await readFile(join(root, "docs", file), "utf8");
    const printed = spawnSync(process.execPath, [cli, "skill", owner], { encoding: "utf8" });
    assert.equal(printed.status, 0, printed.stderr);
    assert.equal(printed.stdout, source, `velar skill ${owner} must print docs/${file} without modification`);
    assert.equal(printed.stderr, "");
  }
  const defaultCore = spawnSync(process.execPath, [cli, "skill"], { encoding: "utf8" });
  assert.equal(defaultCore.status, 0, defaultCore.stderr);
  assert.equal(defaultCore.stdout, await readFile(join(root, "docs", skillFiles.core), "utf8"));

  const help = spawnSync(process.execPath, [cli, "help", "skill"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /core\|web\|node\|server\|desktop/u);
  assert.match(help.stdout, /owner-specific VelarScript AI skill brief/u);

  const rejected = spawnSync(process.execPath, [cli, "skill", "unknown"], { encoding: "utf8" });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /expected core, web, node, server, or desktop/u);
});

test("every create-velar template scaffolds the AGENTS.md brief pointer", () => {
  const expectedBriefs: Readonly<Record<string, readonly string[]>> = Object.freeze({
    library: ["core"],
    web: ["core", "web"],
    docs: ["core", "web"],
    component: ["core", "web"],
    node: ["core", "node", "server"],
    desktop: ["core", "web", "desktop"],
  });
  for (const template of VELAR_PROJECT_TEMPLATES) {
    const files = createTemplateFiles(template, join(root, "example-app"), VELAR_CREATE_VERSION, VELAR_PROJECT_FORMAT_VERSION);
    const guide = files.get("AGENTS.md");
    assert.ok(guide, `the ${template} template must scaffold a root AGENTS.md`);
    for (const owner of expectedBriefs[template] ?? []) {
      assert.ok(guide.includes(`velar skill ${owner}`), `${template} AGENTS.md must load the ${owner} brief`);
    }
    for (const owner of Object.keys(skillFiles).filter((owner) => !(expectedBriefs[template] ?? []).includes(owner))) {
      assert.ok(!guide.includes(`velar skill ${owner}`), `${template} AGENTS.md must not load the unrelated ${owner} brief`);
    }
    for (const gate of ["`velar check`", "`velar test`", "`velar format`"]) {
      assert.ok(guide.includes(gate), `AGENTS.md must name the ${gate} gate`);
    }
    assert.match(guide, /extern module/u, "AGENTS.md must carry the escape-hatch pointer");
    assert.match(guide, /readable, source-mapped exit/u, "AGENTS.md must name the final readable-JavaScript exit");
    const lines = guide.split("\n").length;
    assert.ok(lines <= 80, `AGENTS.md must stay a pointer, not a copy of the brief (${template}: ${lines} lines)`);
  }
});

test("the library template publishes source and a frozen ABI artifact together", () => {
  const files = createTemplateFiles("library", join(root, "example-library"), VELAR_CREATE_VERSION, VELAR_PROJECT_FORMAT_VERSION);
  const manifest = JSON.parse(files.get("package.json") ?? "{}") as {
    files?: string[];
    exports?: Record<string, string>;
    velar?: { entry?: string; artifacts?: Record<string, string> };
    scripts?: Record<string, string>;
  };
  assert.deepEqual(manifest.files, ["src", "dist"]);
  assert.equal(manifest.exports?.["."], "./dist/index.js");
  assert.equal(manifest.velar?.entry, "src/index.vel");
  assert.deepEqual(manifest.velar?.artifacts, { core: "dist/velar-library.json" });
  assert.equal(manifest.scripts?.build, "velar build-library");
  assert.doesNotMatch(files.get(".gitignore") ?? "", /^dist\/$/mu);
});
