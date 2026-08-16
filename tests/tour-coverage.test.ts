import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { CORE_CONTEXTUAL_KEYWORD_WORDS, CORE_NUMERIC_SUFFIXES } from "../packages/compiler/src/core-vocabulary.ts";
import { keywordKinds } from "../packages/compiler/src/token.ts";
import { LOOK_PROPERTIES, LOOK_TARGETS } from "../packages/web/src/look.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// ---------------------------------------------------------------------------
// D56 rules 129 and 130 — `scripts/check-tour-coverage.mjs` is the gate that
// turns "the tour shows every usage" from a claim into a check. The worst way
// for a coverage gate to fail is not to go red: it is to go green having
// examined nothing, which is why every test below either counts what the gate
// looked at or removes exactly one spelling from a copy of the tour and demands
// the gate name it.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts", "check-tour-coverage.mjs");
const tour = join(root, "examples", "tour");

after(removeTemporaryDirectories);

function runGate(tourRoot: string) {
  const execution = spawnSync(process.execPath, [gate, tourRoot], { cwd: root, encoding: "utf8", timeout: 300_000 });
  return { status: execution.status, output: `${execution.stdout ?? ""}${execution.stderr ?? ""}` };
}

/** A private copy of the tour, so a mutation never touches the repository. */
async function copyOfTour(): Promise<string> {
  const directory = join(await makeTemporaryDirectory("velar-tour-coverage-"), "tour");
  await cp(tour, directory, { recursive: true, filter: (path) => !path.split("/").includes("dist") });
  return directory;
}

async function mutate(directory: string, file: string, replace: string, replacement: string): Promise<void> {
  const path = join(directory, file);
  const text = await readFile(path, "utf8");
  assert.ok(text.includes(replace), `${file} no longer contains ${JSON.stringify(replace)}; retarget this mutation`);
  await writeFile(path, text.replace(replace, replacement));
}

test("the coverage gate passes on the tour and reports what it examined", () => {
  const { status, output } = runGate(tour);
  assert.equal(status, 0, output);
  // Every category the gate owns has to appear with a non-zero required count.
  // A table that starts reading empty would otherwise sail through as 0/0.
  for (const category of [
    "hard-keyword", "contextual-keyword", "reserved-binding", "numeric-suffix", "extension-global",
    "permanent-namespace", "prelude-name", "namespace-member", "module-export", "type-parameter-bound",
    "web-test-member", "look-property", "look-hook", "look-target", "look-media-feature",
  ]) {
    const line = output.split("\n").find((item) => item.trimStart().startsWith(`${category} `));
    assert.ok(line, `${category} is missing from the gate's report:\n${output}`);
    const counts = /(?<covered>\d+)\/(?<required>\d+)/u.exec(line)?.groups;
    assert.ok(counts, `${category} reports no counts:\n${line}`);
    assert.ok(Number(counts.required) > 0, `${category} required 0 names — its table read empty:\n${line}`);
    assert.equal(counts.covered, counts.required, `${category} is not fully covered:\n${line}`);
  }
  // The headline count is the honest answer to "how much did you check": it
  // must at least account for the forty hard keywords, the Look property table
  // and the standard-module surface.
  const checked = Number((/Checked (\d+) compiler-declared names/u.exec(output) ?? [])[1]);
  assert.ok(
    checked >= Object.keys(keywordKinds).length + LOOK_PROPERTIES.size + LOOK_TARGETS.size,
    `the gate reported only ${checked} names:\n${output}`,
  );
});

test("[D62-157/158] the gate requires Core's own contextual keywords and numeric suffixes", () => {
  // Both tables were holes this gate could only print: one had no enumerable
  // source at all, and the other was reachable only because the Web extension
  // republishes `ms` and `s` through LOOK_UNIT_TYPES, so a Core-only checkout
  // required neither. This test is the reverse direction of the roster — it
  // fails if the gate ever stops *requiring* Core's words, which the "covered
  // equals required" assertion above cannot notice on its own, because a table
  // that requires nothing is trivially fully covered.
  const { status, output } = runGate(tour);
  assert.equal(status, 0, output);
  const required = (category: string) => {
    const line = output.split("\n").find((item) => item.trimStart().startsWith(`${category} `));
    assert.ok(line, `${category} is missing from the gate's report:\n${output}`);
    return Number(/\d+\/(?<required>\d+)/u.exec(line)?.groups?.required);
  };
  // The Web extension publishes ten contextual keywords and thirteen numeric
  // suffixes; Core's ten words are disjoint from those, and its two suffixes
  // are the pair the Web extension republishes. Requiring *at least* Core's own
  // counts is what a Core-only checkout must also satisfy.
  assert.ok(required("contextual-keyword") >= CORE_CONTEXTUAL_KEYWORD_WORDS.length,
    `the gate required fewer contextual keywords than Core alone declares:\n${output}`);
  assert.ok(required("numeric-suffix") >= CORE_NUMERIC_SUFFIXES.length,
    `the gate required fewer numeric suffixes than Core alone declares:\n${output}`);
  // And the gate no longer prints either as a hole it cannot reach.
  assert.match(output, /Not reverse-queryable \(holes, not exemptions\):\n\s+none\b/u);
  assert.doesNotMatch(output, /Core's own contextual keywords/u);
  assert.doesNotMatch(output, /Core's built-in numeric suffixes/u);
});

test("removing one spelling from the tour turns the gate red and names it", async () => {
  // One deletion per vocabulary family, each the smallest edit that removes the
  // spelling and nothing else. The expected message is the whole point: a gate
  // that says "coverage incomplete" without naming the name is unactionable.
  // A spelling shown in more than one chapter needs every site removed, since
  // coverage is satisfied by any single one of them.
  const cases = [
    {
      family: "a resident-namespace member",
      expected: "namespace-member: Text.slug",
      edits: [{ file: "core/06-text-and-numbers.vel", replace: 'Text.slug("Velar Script 1.0")', replacement: 'Text.dedent("Velar Script 1.0")' }],
    },
    {
      family: "a Look property",
      expected: "look-property: hyphens:",
      edits: [{ file: "web/06-look.vel", replace: '    hyphens = "none"\n', replacement: "" }],
    },
    {
      family: "a Look target",
      expected: "look-target: @marker",
      edits: [{ file: "web/06-look.vel", replace: "    @marker:\n        color = ink\n", replacement: "" }],
    },
    {
      family: "a hard keyword",
      expected: "hard-keyword: continue",
      edits: [
        { file: "core/09-control-flow.vel", replace: "            continue\n", replacement: "            pass\n" },
        { file: "core/11-errors-and-assertions.vel", replace: "                continue\n", replacement: "                pass\n" },
      ],
    },
    {
      family: "an extension's contextual keyword",
      expected: "contextual-keyword: css",
      edits: [
        { file: "web/08-look-escape.vel", replace: 'import css unsafe "./before.css" before look\n', replacement: "" },
        { file: "web/08-look-escape.vel", replace: 'import css unsafe "./after.css" after look\n', replacement: "" },
      ],
    },
    {
      family: "a type-parameter bound",
      expected: "type-parameter-bound: <T: Data>",
      edits: [{ file: "core/05-functions-and-calls.vel", replace: "<T: Data>", replacement: "<T: Comparable>" }],
    },
    {
      family: "a velar/web-test browser control",
      expected: "web-test-member: browser.box",
      edits: [{
        file: "web/13-browser.browser.test.vel",
        replace: 'const vocabularyBox = await browser.box("[data-vocabulary]")',
        replacement: "const vocabularyBox = {x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0}",
      }],
    },
    {
      // The Desktop browser chapter still uses browser.open. This only turns
      // red if the gate really owns Web chapter 13 rather than accepting use
      // anywhere in the tour as a substitute for that chapter's inventory.
      family: "a velar/web-test control also used outside the full showcase",
      expected: "web-test-member: browser.open",
      edits: [
        { file: "web/13-browser.browser.test.vel", replace: "    await browser.open()\n", replacement: "    pass\n" },
        { file: "web/13-browser.browser.test.vel", replace: '    await browser.open("/section/units")\n', replacement: "    pass\n" },
      ],
    },
    {
      family: "a velar/web-test computed-style control",
      expected: "web-test-member: browser.style",
      edits: [{
        file: "web/13-browser.browser.test.vel",
        replace: 'expect(await browser.style("[data-vocabulary]", "gap")).toBe("16px")',
        replacement: 'expect("16px").toBe("16px")',
      }],
    },
  ];

  for (const item of cases) {
    const directory = await copyOfTour();
    for (const edit of item.edits) {
      const path = join(directory, edit.file);
      const text = await readFile(path, "utf8");
      assert.ok(text.includes(edit.replace), `${item.family}: ${edit.file} no longer contains ${JSON.stringify(edit.replace)}; retarget this mutation`);
      await writeFile(path, text.replaceAll(edit.replace, edit.replacement));
    }
    const { status, output } = runGate(directory);
    assert.equal(status, 1, `${item.family}: the gate stayed green after the deletion:\n${output}`);
    assert.ok(output.includes(item.expected), `${item.family}: the gate did not name it:\n${output}`);
    await rm(directory, { recursive: true, force: true });
  }
});

test("the gate refuses a chapter no import reaches", async () => {
  // D56 rule 128: `velar check` never looks at a module the entry cannot reach,
  // so a chapter added without an import in `main.vel` would silently lose the
  // compile half of its gate coverage.
  const directory = await copyOfTour();
  await writeFile(join(directory, "core", "99-orphan.vel"), 'export const orphanName = "nobody imports this"\n');
  const { status, output } = runGate(directory);
  assert.equal(status, 1, output);
  assert.match(output, /99-orphan\.vel: no import reaches this module/u);
});

test("coverage is judged on resolved references, not on the text of the tour", async () => {
  // A gate that grepped for `Text.slug` could be satisfied by a module that
  // declares its own `Text`. D57 rule 135 made that particular forgery
  // impossible — the binding is refused — and the gate reports the refusal
  // rather than counting the forged coverage.
  const directory = await copyOfTour();
  await mutate(
    directory,
    "core/06-text-and-numbers.vel",
    'const slugified = Text.slug("Velar Script 1.0")',
    'const Text = {slug: "forged"}\nconst slugified = Text.slug',
  );
  const { status, output } = runGate(directory);
  assert.equal(status, 1, output);
  assert.match(output, /VEL3007 'Text' is a reserved Core binding/u);
  await rm(directory, { recursive: true, force: true });
});

test("the coverage gate runs as part of npm run check", async () => {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(manifest.scripts["check:tour-coverage"], "node scripts/check-tour-coverage.mjs");
  const gateCheck = manifest.scripts["gate:check"] ?? "";
  assert.ok(gateCheck.includes("npm run check:tour-coverage"), `gate:check does not run the tour coverage gate:\n${gateCheck}`);
});
