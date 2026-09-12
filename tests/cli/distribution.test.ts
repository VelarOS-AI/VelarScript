import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_PROJECT_NAME_LENGTH, assertProjectName } from "../../packages/cli/src/project-format.ts";
import { createTemplateFiles } from "../../packages/create/src/templates.ts";
import { SKILL_OWNER_FILES as skillFiles } from "../../packages/cli/src/skill-reference.ts";
import {
  VELAR_CREATE_VERSION,
  VELAR_PROJECT_FORMAT_VERSION,
  VELAR_PROJECT_TEMPLATES,
  type VelarProjectTemplate,
} from "../../packages/create/src/types.ts";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

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
  assert.equal(defaultCore.stdout, await readFile(join(root, "docs", skillFiles.core!), "utf8"));

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

/**
 * D114 F9-node-cli residual 1: every template names the project it scaffolds.
 *
 * NO-D1 bakes a project identity into every Node output, and without a `name`
 * that identity is the project-relative entry — which every template declares
 * as `src/main.vel`. Two scaffolded projects were therefore one project as far
 * as an output could tell, and a `dist/` dropped beside the second one went on
 * publishing the second one's files. So no template may leave the key out, and
 * this loop is what says so for all six rather than for the one a
 * create-and-run test happens to exercise.
 *
 * The name is the target directory's basename as a person reads it, reduced to
 * what `assertProjectName` accepts and nothing more. The two live in packages
 * that cannot import each other — `create-velar` ships no dependencies — so
 * this is where the rule and the writer are read against each other: every name
 * a template writes is handed to the compiler's own refusal, and a bound
 * lowered on one side without the other is a failure here rather than a
 * `velar create` whose output the next `velar check` refuses.
 */
test("every create-velar template names the project after its directory, in a shape the compiler accepts", () => {
  for (const template of VELAR_PROJECT_TEMPLATES) {
    const name = templateProjectName(template, "Store Front");
    assert.equal(name, "Store Front", `the ${template} template must name its project after the directory`);
    assert.doesNotThrow(() => assertProjectName(name, "velar.json"), `the ${template} template's name must load`);
  }

  // A directory name is not held to the manifest rule, so what a template
  // writes is the basename with exactly what the rule forbids taken out:
  // control characters dropped, the ends trimmed, the length cut, and the ends
  // trimmed once more because the cut can uncover a space. A directory with no
  // usable basename falls back to the same `velar-app` the npm name beside it
  // falls back to, so the two never disagree about what the project is called.
  const reduced: readonly (readonly [string, string])[] = [
    ["  Padded App  ", "Padded App"],
    ["Bell\u0007App", "BellApp"],
    ["y".repeat(MAX_PROJECT_NAME_LENGTH + 1), "y".repeat(MAX_PROJECT_NAME_LENGTH)],
    [`${"y".repeat(MAX_PROJECT_NAME_LENGTH - 1)} tail`, "y".repeat(MAX_PROJECT_NAME_LENGTH - 1)],
    ["   ", "velar-app"],
  ];
  for (const [directory, expected] of reduced) {
    const name = templateProjectName("web", directory);
    assert.equal(name, expected, `a project directory named ${JSON.stringify(directory)} is named ${JSON.stringify(expected)}`);
    assert.doesNotThrow(() => assertProjectName(name, "velar.json"), `${JSON.stringify(directory)} must reduce to a loadable name`);
  }
});

/** The `name` a template's `velar.json` declares for a project created in `directory`. */
function templateProjectName(template: VelarProjectTemplate, directory: string): unknown {
  const files = createTemplateFiles(template, join(root, directory), VELAR_CREATE_VERSION, VELAR_PROJECT_FORMAT_VERSION);
  return (JSON.parse(files.get("velar.json") ?? "{}") as { readonly name?: unknown }).name;
}

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
