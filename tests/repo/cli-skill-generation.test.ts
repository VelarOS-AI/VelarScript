import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { CORE_SKILL_REFERENCES, CORE_SKILL_TOPICS, SKILL_OWNER_FILES } from "../../packages/cli/src/skill-reference.ts";
import { generateCliSkillFiles, selectSkillSections, synchronizeCliSkill } from "../../scripts/generate-cli-skill.mjs";
import { parseNpmPackResult } from "../../scripts/npm-pack-result.mjs";
import { checkSkillMarkdownLinks } from "../../scripts/skill-markdown-links.mjs";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
after(removeTemporaryDirectories);
const referenceCount = Object.keys(CORE_SKILL_TOPICS).length + Object.keys(CORE_SKILL_REFERENCES).length + 1;

test("the committed CLI skill payload is derived from the canonical documents and topic roster", async () => {
  const generated = await generateCliSkillFiles(root);
  assert.equal(generated.size, Object.keys(SKILL_OWNER_FILES).length + referenceCount);
  for (const [file, text] of generated) {
    assert.equal(await readFile(join(root, file), "utf8"), text, `${file}: run node scripts/generate-cli-skill.mjs`);
  }
  const api = generated.get("packages/cli/skill/reference/api.md")!;
  assert.match(api, /^## `Math\.`/mu);
  assert.match(api, /^### `velar\/validation`/mu);
  assert.doesNotMatch(api, /^## Local platform modules|^### `velar\/(?:serve|fs|env|host|terminal|process)`/mu);
  for (const [file, text] of generated) {
    if (file.includes("/reference/")) {
      assert.doesNotMatch(text, /^## (?:14\. Components and JSX|15\. State, computed values, resources, and actions|17\. Look: controlled visual language)/mu);
    }
  }
});

test("Core references retain only reachable offline links and bounded supporting contracts", async () => {
  const generated = await generateCliSkillFiles(root);
  assert.deepEqual(checkSkillMarkdownLinks(generated), []);
  assert.match(generated.get("packages/cli/skill/reference/contract.md")!, /\]\(index\.md\)/u);
  assert.match(generated.get("packages/cli/skill/reference/types.md")!, /\]\(readonly\.md\)/u);
  assert.match(generated.get("packages/cli/skill/reference/control.md")!, /\]\(contract\.md#c7--验证错误使用共同的结构化路径\)/u);
  assert.match(generated.get("packages/cli/skill/reference/modules.md")!, /\]\(package-distribution\.md#package-resources\)/u);
  const distribution = generated.get("packages/cli/skill/reference/package-distribution.md")!;
  assert.match(distribution, /^### Package source entries$/mu);
  assert.match(distribution, /^### Package resources$/mu);
  assert.doesNotMatch(distribution, /An extension may give one of its JavaScript module sources/u);
  const desktop = generated.get("packages/cli/skill/reference/desktop-services.md")!;
  assert.match(desktop, /^### Multiplexing over one connection$/mu);
  assert.doesNotMatch(desktop, /^### Testing a service|^## Service processes$/mu);
});

test("skill extraction includes subsections and ignores heading-like text inside fences", () => {
  const source = "# Book\n## Chosen\nfirst\n```text\n## Next\n```\n### Nested\nsecond\n## Next\nlast\n";
  assert.equal(selectSkillSections(source, ["## Chosen"], "book.md"), "## Chosen\nfirst\n```text\n## Next\n```\n### Nested\nsecond");
  assert.equal(selectSkillSections(source, ["## Next"], "book.md"), "## Next\nlast");
  assert.throws(() => selectSkillSections(source, ["## Missing"], "book.md"), /expected exactly one canonical heading/u);
  assert.throws(() => selectSkillSections(source + "## Chosen\n", ["## Chosen"], "book.md"), /found 2/u);
});

test("CLI prebuild and prepack synchronize locally but CI rejects stale content without rewriting", async () => {
  const fixture = await makeTemporaryDirectory("velar-skill-generation-");
  const sourceFiles = new Set([
    "packages/cli/package.json",
    ...Object.values(SKILL_OWNER_FILES).map((file) => `docs/${file}`),
    ...Object.values(CORE_SKILL_TOPICS).flatMap((topic) => topic.sources.map((source) => source.file)),
    ...Object.values(CORE_SKILL_REFERENCES).flatMap((reference) => reference.sources.map((source) => source.file)),
  ]);
  for (const file of sourceFiles) {
    await mkdir(dirname(join(fixture, file)), {recursive: true});
    await writeFile(join(fixture, file), await readFile(join(root, file)));
  }
  const manifest = JSON.parse(await readFile(join(fixture, "packages/cli/package.json"), "utf8"));
  assert.equal(manifest.scripts.prebuild, "node ../../scripts/generate-cli-skill.mjs --build");
  assert.equal(manifest.scripts.prepack, "npm run build");
  const initial = await synchronizeCliSkill(fixture, {ci: false});
  assert.equal(initial.updated.length, Object.keys(SKILL_OWNER_FILES).length + referenceCount);
  const brief = join(fixture, "packages/cli/skill/ai-skill.md");
  const before = await readFile(brief, "utf8");
  await writeFile(join(fixture, "docs/ai-skill.md"), `${before}\nUpdated canonical brief.\n`);
  await assert.rejects(synchronizeCliSkill(fixture, {ci: true}), /CLI skill payload is stale/u);
  await assert.rejects(synchronizeCliSkill(fixture, {ci: false, check: true}), /CLI skill payload is stale/u);
  assert.equal(await readFile(brief, "utf8"), before, "a failed check must not silently repair the artifact");
  await synchronizeCliSkill(fixture, {ci: false});
  assert.equal(await readFile(brief, "utf8"), `${before}\nUpdated canonical brief.\n`);
  manifest.version = "99.1.2";
  await writeFile(join(fixture, "packages/cli/package.json"), JSON.stringify(manifest));
  await assert.rejects(synchronizeCliSkill(fixture, {ci: true}), /reference\/contract.md/u);
  const changed = await synchronizeCliSkill(fixture, {ci: false});
  assert.equal(changed.updated.length, referenceCount);
  assert.match(await readFile(join(fixture, "packages/cli/skill/reference/contract.md"), "utf8"), /@velarscript\/cli 99\.1\.2/u);
  await synchronizeCliSkill(fixture, {ci: true});
});

test("CLI skill generator keeps status diagnostics off machine-readable stdout", () => {
  for (const argument of ["--check", "--build"]) {
    const result = spawnSync(process.execPath, [join(root, "scripts/generate-cli-skill.mjs"), argument], {
      cwd: root,
      env: {...process.env, CI: "1"},
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "", `${argument} must not contaminate npm pack --json output`);
    assert.match(result.stderr, /^CLI skill payload: \d+ files, 0 updated, 0 retired\n$/u);
  }
});

test("a prepack skill generation step preserves the npm JSON receipt", async () => {
  const fixture = await makeTemporaryDirectory("velar-skill-prepack-");
  await writeFile(join(fixture, "package.json"), JSON.stringify({
    name: "velar-skill-prepack-fixture",
    version: "1.0.0",
    files: ["README.md"],
    scripts: {prepack: "node prepack.mjs"},
  }));
  await writeFile(join(fixture, "README.md"), "Skill prepack output fixture.\n");
  await writeFile(join(fixture, "prepack.mjs"), [
    'import { spawnSync } from "node:child_process";',
    `const result = spawnSync(process.execPath, [${JSON.stringify(join(root, "scripts/generate-cli-skill.mjs"))}, "--build"], {stdio: "inherit"});`,
    "process.exitCode = result.status ?? 1;",
  ].join("\n"));
  const arguments_ = ["pack", "--json", "--pack-destination", fixture];
  const npmScript = process.env.npm_execpath;
  const result = spawnSync(npmScript ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm", npmScript ? [npmScript, ...arguments_] : arguments_, {
    cwd: fixture,
    env: {...process.env, CI: "1"},
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = parseNpmPackResult(result.stdout, "skill prepack fixture");
  assert.equal(receipt.name, "velar-skill-prepack-fixture");
  assert.equal(receipt.version, "1.0.0");
});
