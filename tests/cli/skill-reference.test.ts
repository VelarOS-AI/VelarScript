import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { CORE_SKILL_TOPICS, SKILL_OWNER_FILES, coreSkillTopicsText } from "../../packages/cli/src/skill-reference.ts";
import { generateCliSkillFiles } from "../../scripts/generate-cli-skill.mjs";
import { checkSkillMarkdownLinks } from "../../scripts/skill-markdown-links.mjs";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
after(removeTemporaryDirectories);

test("installed-layout Core topics are discoverable and readable with only packaged files", async () => {
  const installed = await makeTemporaryDirectory("velar-installed-skill-");
  const payload = await generateCliSkillFiles(root);
  for (const [file, text] of payload) {
    const target = join(installed, file.replace("packages/cli/", ""));
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, text);
  }
  // Follow the graph that physically exists in the isolated installed layout.
  // Resolving against checkout docs would hide precisely the missing-link bug.
  const installedFiles = new Map<string, string>();
  for (const file of payload.keys()) {
    installedFiles.set(file, await readFile(join(installed, file.replace("packages/cli/", "")), "utf8"));
  }
  assert.deepEqual(checkSkillMarkdownLinks(installedFiles), []);
  // Strip the two dependency-free command modules into the installed layout.
  // No checkout docs, generator, node_modules, or network service accompanies it.
  for (const file of ["commands/skill", "skill-reference"]) {
    const source = await readFile(join(root, `packages/cli/src/${file}.ts`), "utf8");
    const target = join(installed, `dist/${file}.js`);
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, stripTypeScriptTypes(source).replace('"../skill-reference.ts"', '"../skill-reference.js"'));
  }
  await writeFile(join(installed, "package.json"), '{"type":"module"}\n');
  const runner = join(installed, "run.mjs");
  await writeFile(runner, 'import {runSkillCommand} from "./dist/commands/skill.js"; process.exitCode = await runSkillCommand(process.argv.slice(2));\n');
  const run = (arguments_: readonly string[]) => spawnSync(process.execPath, [runner, ...arguments_], {cwd: installed, encoding: "utf8"});

  const listed = run(["core", "topics"]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(listed.stdout, coreSkillTopicsText());
  for (const topic of Object.keys(CORE_SKILL_TOPICS)) {
    const printed = run(["core", topic]);
    assert.equal(printed.status, 0, printed.stderr);
    assert.equal(printed.stdout, payload.get(`packages/cli/skill/reference/${topic}.md`));
    assert.equal(printed.stderr, "");
  }
  for (const [owner, file] of Object.entries(SKILL_OWNER_FILES)) {
    const printed = run([owner]);
    assert.equal(printed.status, 0, printed.stderr);
    assert.equal(printed.stdout, payload.get(`packages/cli/skill/${file}`));
  }
  assert.equal(run([]).stdout, payload.get("packages/cli/skill/ai-skill.md"));
  for (const arguments_ of [["missing"], ["core", "missing"], ["core", "__proto__"], ["core", "../api"], ["web", "topics"], ["core", "api", "extra"]]) {
    const refused = run(arguments_);
    assert.equal(refused.status, 2, arguments_.join(" "));
    assert.equal(refused.stdout, "");
    assert.match(refused.stderr, /velar skill core topics/u);
  }
});
