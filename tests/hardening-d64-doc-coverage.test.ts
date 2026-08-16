import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// ---------------------------------------------------------------------------
// D64 rule 167 — `check:docs` used to report one number, "Checked N examples",
// while 73% of its fragments were passing for reasons that had nothing to do
// with being correct: an unresolved reference suppresses its own diagnostic,
// suppresses everything reported on an expression enclosing it, suppresses
// every complaint about the `unknown` type it introduces — and, worse than all
// three, stops the analyzer from checking anything downstream of it, so a
// defect there produces no diagnostic to suppress in the first place.
//
// Two things are tested here, in the order the ruling puts them:
//   1. The gate prints the number of fragments it could NOT check in full.
//      A coverage gap nobody prints is a coverage gap nobody closes.
//   2. A fragment may declare the names it borrows in a `velar-preamble`
//      Markdown comment, and a fragment that does is checked in full — the
//      same defect that stays silently green without one goes red with one.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts", "check-documentation-examples.mjs");

after(removeTemporaryDirectories);

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

async function checkMarkdown(name: string, markdown: string): Promise<Run> {
  const directory = await makeTemporaryDirectory("velar-doc-coverage-");
  const path = join(directory, `${name}.md`);
  await writeFile(path, markdown, "utf8");
  const execution = spawnSync(process.execPath, [gate, path], { cwd: root, encoding: "utf8", timeout: 300_000 });
  const stdout = execution.stdout ?? "";
  const stderr = execution.stderr ?? "";
  return { status: execution.status, stdout, stderr, output: `${stdout}${stderr}` };
}

/** The defect D59 rule 144.2 found in the charter: masked, then declared. */
const maskedDefect = [
  "```velar fragment",
  "const name: string = await fetchUser(\"42\")",
  "print(name)",
  "```",
  "",
].join("\n");

const declaredDefect = [
  "<!-- velar-preamble",
  "async def fetchUser(id: string) -> number:",
  "    return id.size",
  "-->",
  maskedDefect,
].join("\n");

test("check:docs reports the fragments it could not check in full", async () => {
  const partial = await checkMarkdown("partial", maskedDefect);
  assert.equal(partial.status, 0, partial.output);
  assert.match(partial.stdout, /Coverage: 1 of 1 fragments were NOT checked in full/u);
  // The reason is printed with the number, because the number alone reads as a
  // tolerance rather than as a gap.
  assert.match(partial.stdout, /stops the analyzer downstream/u);
  assert.match(partial.stdout, /velar-preamble/u);

  // A fragment that resolves everything it names is checked in full already,
  // and the gate says so rather than staying silent about its own coverage.
  const whole = await checkMarkdown("whole", "```velar fragment\nconst count: number = 1\nprint(count)\n```\n");
  assert.equal(whole.status, 0, whole.output);
  assert.match(whole.stdout, /Coverage: all 1 fragments were checked in full/u);
});

test("check:docs counts every partially checked fragment, not just the first", async () => {
  const run = await checkMarkdown("counted", [
    "```velar fragment",
    "print(missingOne)",
    "```",
    "",
    "```velar fragment",
    "print(missingTwo)",
    "```",
    "",
    "```velar fragment",
    "print(\"resolved\")",
    "```",
    "",
  ].join("\n"));
  assert.equal(run.status, 0, run.output);
  assert.match(run.stdout, /Coverage: 2 of 3 fragments were NOT checked in full/u);
});

test("check:docs --partial names every fragment behind the number", async () => {
  const directory = await makeTemporaryDirectory("velar-doc-coverage-");
  const path = join(directory, "listed.md");
  await writeFile(path, ["```velar fragment", "print(missingOne)", "```", ""].join("\n"), "utf8");
  const execution = spawnSync(process.execPath, [gate, "--partial", path], { cwd: root, encoding: "utf8", timeout: 300_000 });
  const output = `${execution.stdout ?? ""}${execution.stderr ?? ""}`;
  assert.equal(execution.status, 0, output);
  assert.match(execution.stdout, /listed\.md:1 — 1 suppressed/u);
});

const coverageLine = /^Coverage: (all \d+ fragments were checked in full|\d+ of \d+ fragments were NOT checked in full)/mu;

test("the coverage number is printed on a red run too", async () => {
  // The gap must never be hidden behind a failure: a run that reports defects
  // is exactly the run whose reader most needs to know what went unexamined.
  const run = await checkMarkdown("red", [
    "```velar fragment",
    "print(missingName)",
    "```",
    "",
    "```velar",
    "const broken: string = 1",
    "print(broken)",
    "```",
    "",
  ].join("\n"));
  assert.equal(run.status, 1, run.output);
  assert.match(run.stderr, /Cannot assign number to string/u);
  assert.match(run.stdout, coverageLine, run.output);
});

test("the whole documentation tree reports its coverage on every run", () => {
  // No status assertion on purpose: this test owns the coverage report, not the
  // health of every document in the tree, and coupling the two would make an
  // unrelated broken fence look like a coverage regression.
  const execution = spawnSync(process.execPath, [gate], { cwd: root, encoding: "utf8", timeout: 300_000 });
  const output = `${execution.stdout ?? ""}${execution.stderr ?? ""}`;
  assert.match(execution.stdout, coverageLine, output);
});

test("a declared preamble turns a masked documentation defect red", async () => {
  // Without the declaration the reference is unresolved, so `fetchUser(...)` is
  // typed `unknown` and the assignment is never checked: the gate is green on a
  // defective example, which is exactly how the charter's bad async arrow lived
  // there for weeks.
  const masked = await checkMarkdown("masked", maskedDefect);
  assert.equal(masked.status, 0, masked.output);
  assert.doesNotMatch(masked.output, /Cannot assign/u);

  const declared = await checkMarkdown("declared", declaredDefect);
  assert.equal(declared.status, 1, declared.output);
  assert.match(declared.stderr, /VEL4001 Cannot assign number to string/u);
  assert.match(declared.stdout, /Coverage: all 1 fragments were checked in full/u);
});

test("a declared preamble restores the checks an unresolved reference switched off", async () => {
  // The harder half of rule 167: this defect produces no diagnostic at all
  // without the declaration, so no suppression clause is even consulted.
  const silent = await checkMarkdown("silent", [
    "```velar fragment",
    "const account = loadAccount(\"42\")",
    "print(account.noSuchFieldAtAll)",
    "```",
    "",
  ].join("\n"));
  assert.equal(silent.status, 0, silent.output);

  const declared = await checkMarkdown("declared-field", [
    "<!-- velar-preamble",
    "type Account:",
    "    name: string",
    "",
    "def loadAccount(id: string) -> Account:",
    "    return {name: id}",
    "-->",
    "```velar fragment",
    "const account = loadAccount(\"42\")",
    "print(account.noSuchFieldAtAll)",
    "```",
    "",
  ].join("\n"));
  assert.equal(declared.status, 1, declared.output);
  assert.match(declared.stderr, /Type 'Account' has no field 'noSuchFieldAtAll'/u);
});

test("a preamble is compiled, so a defect inside it fails the gate too", async () => {
  const run = await checkMarkdown("bad-preamble", [
    "<!-- velar-preamble",
    "def total(values: List<number>) -> string:",
    "    return values.sum()",
    "-->",
    "```velar fragment",
    "print(total([1, 2, 3]))",
    "```",
    "",
  ].join("\n"));
  assert.equal(run.status, 1, run.output);
  assert.match(run.stderr, /Cannot (assign|return) number/u);
});

test("a preamble that lost its fence is reported rather than ignored", async () => {
  const drifted = await checkMarkdown("drifted", [
    "<!-- velar-preamble",
    "const helper = 1",
    "-->",
    "",
    "Prose stands between the declaration and the fence.",
    "",
    "```velar fragment",
    "print(helper)",
    "```",
    "",
  ].join("\n"));
  assert.equal(drifted.status, 1, drifted.output);
  assert.match(drifted.stderr, /a velar-preamble comment must stand immediately before a ```velar fence/u);

  const complete = await checkMarkdown("on-complete", [
    "<!-- velar-preamble",
    "const helper = 1",
    "-->",
    "```velar",
    "print(1)",
    "```",
    "",
  ].join("\n"));
  assert.equal(complete.status, 1, complete.output);
  assert.match(complete.stderr, /already checked in full/u);
});

// ---------------------------------------------------------------------------
// A-022 — the fence *extractor*. Everything above tests what the gate does with
// an example once it has one; these test which examples it has at all.
//
// The extractor was a regex that fixed the opening backticks at column 0, that
// required the closing fence to have exactly the opening fence's length, and
// that knew only backticks. Every one of those is stricter than CommonMark, and
// every one of them fails the same way: a legal fence goes unextracted,
// uncompiled and uncounted, under a headline claiming every block was checked.
// A gate that skips an example silently is worse than no gate, because its
// number is read as an answer. The cases below are one per rule, each carrying
// an example that must fail — a fence that is extracted but valid would pass
// whether or not the extractor ever saw it.
// ---------------------------------------------------------------------------

const brokenExample = "const broken: string = 1";
const brokenDiagnostic = /Cannot assign number to string/u;

test("[A-022] a fence indented inside a list item is extracted, dedented and compiled", async () => {
  const run = await checkMarkdown("indented", [
    "- Nested example:",
    "",
    "   ```velar",
    `   ${brokenExample}`,
    "   print(broken)",
    "   ```",
    "",
  ].join("\n"));
  assert.equal(run.status, 1, run.output);
  // The dedent is load-bearing rather than cosmetic: VelarScript is
  // indentation-sensitive, so a fence whose three spaces were not removed would
  // fail with an indentation error instead of the type error the example has.
  assert.match(run.stderr, brokenDiagnostic, run.output);
});

test("[A-022] a closing fence longer than its opening closes the block", async () => {
  const run = await checkMarkdown("long-close", [
    "```velar",
    brokenExample,
    "print(broken)",
    "````",
    "",
  ].join("\n"));
  assert.equal(run.status, 1, run.output);
  assert.match(run.stderr, brokenDiagnostic, run.output);
});

test("[A-022] a tilde fence is a fence", async () => {
  const run = await checkMarkdown("tilde", [
    "~~~velar",
    brokenExample,
    "print(broken)",
    "~~~",
    "",
  ].join("\n"));
  assert.equal(run.status, 1, run.output);
  assert.match(run.stderr, brokenDiagnostic, run.output);
});

test("[A-022] the headline counts the legal fences a regex could not reach", async () => {
  // The reproduction as it was filed: one ordinary fence, then a second in a
  // shape the old extractor could not see. The gate answered "Checked 1 …" and
  // exit 0 — the number was wrong and the defective example was never compiled.
  for (const second of [
    ["- Nested example:", "", "   ```velar", "   print(\"two\")", "   ```"],
    ["```velar", "print(\"two\")", "````"],
    ["~~~velar", "print(\"two\")", "~~~"],
  ]) {
    const run = await checkMarkdown("counted-shapes", [
      "```velar",
      "print(\"one\")",
      "```",
      "",
      ...second,
      "",
    ].join("\n"));
    assert.equal(run.status, 0, run.output);
    assert.match(run.stdout, /Checked 2 VelarScript documentation examples \(2 complete, 0 fragments\)/u, run.output);
  }
});

test("[A-022] a shorter fence inside a longer one stays content", async () => {
  // The one thing the old regex got right, kept: a VelarScript example may show
  // a Markdown fence as literal text, and CommonMark's "at least as long" rule
  // preserves that because the inner fence is shorter than the opening one.
  const run = await checkMarkdown("nested-fence", [
    "````velar",
    "const markdown = \"",
    " ```",
    "\"",
    "print(markdown)",
    "````",
    "",
  ].join("\n"));
  assert.equal(run.status, 0, run.output);
  assert.match(run.stdout, /Checked 1 VelarScript documentation examples/u, run.output);
});

test("[A-022] a velar fence the extractor cannot reach is named, not skipped", async () => {
  // The scanner reads CommonMark's fenced-code-block rules and nothing else, so
  // a fence whose indentation is measured from a block container is out of its
  // reach. That is a boundary, not a licence to skip: the gate says where the
  // example is and goes red, because an example nobody compiles under a
  // headline that claims otherwise is the whole defect.
  for (const container of [
    ["> ```velar", "> print(\"quoted\")", "> ```"],
    ["- Item:", "", "    - Nested item:", "", "        ```velar", "        print(\"deep\")", "        ```"],
  ]) {
    const run = await checkMarkdown("unreachable", [...container, ""].join("\n"));
    assert.equal(run.status, 1, run.output);
    assert.match(run.stderr, /opens a VelarScript fence inside a Markdown container this gate does not parse/u, run.output);
  }
});

test("[A-022] a preamble attaches to an indented fence", async () => {
  const run = await checkMarkdown("indented-preamble", [
    "- Nested example:",
    "",
    "   <!-- velar-preamble",
    "   def total(values: List<number>) -> string:",
    "       return values.sum()",
    "   -->",
    "   ```velar fragment",
    "   print(total([1, 2, 3]))",
    "   ```",
    "",
  ].join("\n"));
  assert.equal(run.status, 1, run.output);
  assert.match(run.stderr, /Cannot (assign|return) number/u, run.output);
});

test("a preamble shown inside a code block is documentation, not a declaration", async () => {
  // D64 itself writes the mechanism out inside a fence; documentation about a
  // mechanism must not trip the mechanism.
  const run = await checkMarkdown("quoted", [
    "Declare the names a fragment borrows like this:",
    "",
    "````",
    "<!-- velar-preamble",
    "def fetchUser(id: string) -> string:",
    "    return id",
    "-->",
    "````",
    "",
    "```velar fragment",
    "print(\"unrelated\")",
    "```",
    "",
  ].join("\n"));
  assert.equal(run.status, 0, run.output);
  assert.doesNotMatch(run.output, /must stand immediately before/u);
});
