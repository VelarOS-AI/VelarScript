import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

/**
 * `velar check` covers every `.vel` source under the project, not only the ones
 * an import reaches.
 *
 * The defect this file pins was found while building the conversation-stream
 * benchmark (F4): a `src/orphan.vel` carrying two plain errors — a member that
 * does not exist, and the `!value` spelling VEL1005 exists to refuse — sat in a
 * scaffolded project while `velar check` printed the same module count it would
 * have printed without the file and exited 0. `velar build` produced a bundle.
 * `npm run validate` passed. Meanwhile the AGENTS.md the toolchain writes into
 * every project says `velar check` type-checks the whole project, which is the
 * sentence an AI author reads and believes.
 *
 * That is D56 rule 130's shape — a gate that looks like it covers something it
 * never reads — and the repo has closed it once before: audit 12 found `check`
 * blind to `*.test.vel` and widened the scan rather than narrowing the claim.
 * Unimported sources are now roots on the same terms.
 *
 * The boundary the tests below hold is the other half of the ruling: checking
 * is not emitting. An unimported module is compiled and reported; it never
 * reaches build output, and it never gains a `@main` body.
 */

interface CliProject {
  readonly root: string;
  cli(...commandArguments: readonly string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string };
}

async function cliProject(files: Readonly<Record<string, string>>): Promise<CliProject> {
  const root = await mkdtemp(join(tmpdir(), "velar-check-coverage-"));
  await writeFile(join(root, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }), "utf8");
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, source, "utf8");
  }
  return {
    root,
    cli(...commandArguments) {
      const result = spawnSync(process.execPath, [cliPath, ...commandArguments], { cwd: root, encoding: "utf8", timeout: 120_000 });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
  };
}

const REACHABLE = {
  "src/main.vel": `import {greet} from "./greeting.vel"

@main:
    print(greet("world"))
`,
  "src/greeting.vel": `export def greet(name: string) -> string:
    return f"Hello, {name}"
`,
};

/** The F4 orphan verbatim: one absent member, one JS-habit negation. */
const BROKEN_ORPHAN = `export def broken(value: string) -> number:
    return value.thisMemberDoesNotExist(!value)
`;

test("[F4] an unimported module's errors fail 'velar check' and name the file", async () => {
  const project = await cliProject({ ...REACHABLE, "src/orphan.vel": BROKEN_ORPHAN });
  try {
    const result = project.cli("check", ".");
    assert.equal(result.status, 1, `check should refuse the orphan: ${result.stdout}`);
    // Both defects report, at their own spans, through the ordinary diagnostic
    // formatter — an unimported root is not a second-class one.
    assert.match(result.stderr, /src\/orphan\.vel:2:12 error VEL4001: string has no member 'thisMemberDoesNotExist'/u);
    assert.match(result.stderr, /src\/orphan\.vel:2:41 error VEL1005: Use 'not'/u);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[F4] an unimported module that compiles passes, and counts toward the summary", async () => {
  const project = await cliProject({
    ...REACHABLE,
    "src/orphan.vel": `export def shout(value: string) -> string:
    return f"{value}!"
`,
  });
  try {
    const result = project.cli("check", ".");
    assert.equal(result.status, 0, result.stderr);
    // Two reachable modules plus the orphan. The count is the honest number: it
    // is what tells an author the file was read at all.
    assert.match(result.stdout, /Checked 3 modules/u);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[F4] an unimported module that imports another is checked once, not once per root", async () => {
  const project = await cliProject({
    ...REACHABLE,
    "src/orphan.vel": `import {helper} from "./orphan-helper.vel"

export def shout(value: string) -> string:
    return helper(value)
`,
    "src/orphan-helper.vel": `export def helper(value: string) -> string:
    return value.nope()
`,
  });
  try {
    const result = project.cli("check", ".");
    assert.equal(result.status, 1, result.stdout);
    // `orphan-helper.vel` is reached by `orphan.vel`'s own walk *and* is itself
    // an unimported file. Reporting it twice would teach an author to read past
    // duplicate diagnostics, so the compiled-module registry decides which root
    // carries it and the other stays quiet.
    const occurrences = result.stderr.match(/has no member 'nope'/gu) ?? [];
    assert.equal(occurrences.length, 1, `expected one report, got ${occurrences.length}:\n${result.stderr}`);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[F4] 'velar build' refuses an unimported module's error but never emits it", async () => {
  const project = await cliProject({ ...REACHABLE, "src/orphan.vel": BROKEN_ORPHAN });
  try {
    // `build` shares `check`'s analysis, so "build implies checked" stays true
    // over the whole tree rather than over the reachable part of it.
    const refused = project.cli("build", ".");
    assert.equal(refused.status, 1, `build should refuse the orphan: ${refused.stdout}`);
    assert.match(refused.stderr, /src\/orphan\.vel:2:41 error VEL1005: Use 'not'/u);

    await writeFile(join(project.root, "src", "orphan.vel"), `export def shout(value: string) -> string:
    return f"{value}!"
`, "utf8");
    const built = project.cli("build", ".");
    assert.equal(built.status, 0, built.stderr);
    // Checking is not emitting: the orphan was compiled and reported on, and
    // the bundle still holds exactly the graph the entry reaches.
    const emitted = (await readdir(join(project.root, "dist"))).sort();
    assert.deepEqual(emitted, ["greeting.js", "main.js"]);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[F4] 'velar fix' reaches every source 'velar check' refuses over", async () => {
  const project = await cliProject({
    ...REACHABLE,
    "src/orphan.vel": `export def count(values: Array<number>) -> number:
    return values.length
`,
  });
  try {
    // Widening `check` without widening `fix` would have left the two
    // disagreeing about the same tree: `check` refusing a mechanically fixable
    // diagnostic that `fix` could not see, and `fix` answering "0 diagnostics
    // remain" over it — the same false claim as F4, pointed the other way.
    assert.equal(project.cli("check", ".").status, 1);
    const fixed = project.cli("fix", ".");
    assert.equal(fixed.status, 0, fixed.stderr);
    assert.match(fixed.stdout, /src\/orphan\.vel:1:26 fixed VEL2012/u);
    assert.match(fixed.stdout, /src\/orphan\.vel:2:19 fixed VEL4001/u);
    assert.match(fixed.stdout, /0 diagnostics remain/u);
    const checked = project.cli("check", ".");
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /Checked 3 modules/u);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[F4] 'velar check <file>' still scopes itself to that file's graph", async () => {
  const project = await cliProject({ ...REACHABLE, "src/orphan.vel": BROKEN_ORPHAN });
  try {
    // A single-file input names its own scope. Widening *that* to the whole
    // project would take away the one way an author has to ask a narrow
    // question, so the tree walk is skipped and the orphan stays unread.
    const result = project.cli("check", "src/main.vel");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Checked 2 modules/u);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[F4] an unimported module's '@main' body is checked, and still never reaches output", async () => {
  const project = await cliProject({
    ...REACHABLE,
    // An unimported module is compiled as a root of its own, so its `@main`
    // body is live source to the analyzer rather than dead text — which is the
    // point, because startup code is exactly where an orphaned refactor leaves
    // its wreckage. `@main` runs only when its source is selected as an entry,
    // and this one never is: `build` emits the graph the project entry reaches
    // and nothing else, so checking the body cannot add a second startup.
    "src/orphan.vel": `@main:
    const n: number = "not a number"
    print(n)
`,
  });
  try {
    const result = project.cli("check", ".");
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /src\/orphan\.vel:2:23 error VEL4001: Cannot assign string to number/u);

    await writeFile(join(project.root, "src", "orphan.vel"), `@main:
    print("second startup")
`, "utf8");
    const built = project.cli("build", ".");
    assert.equal(built.status, 0, built.stderr);
    const emitted = (await readdir(join(project.root, "dist"))).sort();
    assert.deepEqual(emitted, ["greeting.js", "main.js"], "an unimported entry role must not become a second startup");
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});
