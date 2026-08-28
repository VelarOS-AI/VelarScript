import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));
const webPackageRoot = fileURLToPath(new URL("../packages/web", import.meta.url));

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

/**
 * A Web project, which is the smallest tree the application-entry contract
 * applies to: the rule reads `config.framework`, so a plain Core project — the
 * one every test above uses — never reaches it.
 */
async function webProject(files: Readonly<Record<string, string>>): Promise<CliProject> {
  const root = await mkdtemp(join(tmpdir(), "velar-project-layer-"));
  const scope = join(root, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(webPackageRoot, join(scope, "web"), "dir");
  await writeFile(join(root, "velar.json"), JSON.stringify({
    formatVersion: 2,
    kind: "application",
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { base: "/", deployment: { spaFallback: true } },
  }), "utf8");
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

/** The count `velar fix`'s summary line reports, or -1 when it printed no summary. */
function remainingDiagnostics(stdout: string): number {
  return Number(/; (\d+) diagnostics? remains?$/mu.exec(stdout)?.[1] ?? "-1");
}

const COMPONENT = "component App:\n    return <main><h1>Labs</h1></main>\n";

/**
 * The trees a project-layer rule refuses, plus the ones it accepts.
 *
 * The defect: `velar check` refused a Web entry that performed its startup at
 * the top level instead of inside `@main`, and `velar fix` over the same
 * directory printed "applied 0 mechanical fixes; 0 diagnostics remain" and
 * exited 0. The fixer read the compiler's diagnostic channel, and this rule was
 * never on it — so the one command an author runs to be told what is wrong
 * answered that nothing was.
 *
 * `fixed` says whether the shape admits a provably equivalent rewrite. It is
 * deliberately true for exactly one of the four refusals: startup order is the
 * author's, and a fixer that guessed at it would be wrong silently.
 */
const PROJECT_LAYER_FIXTURES: readonly {
  readonly title: string;
  readonly files: Readonly<Record<string, string>>;
  readonly refused: boolean;
  readonly fixed: boolean;
}[] = [
  {
    title: "the migration shape: one startup statement, at the end of the entry",
    files: { "src/main.vel": `${COMPONENT}\nmount(<App />, "#app")\n` },
    refused: true,
    fixed: true,
  },
  {
    title: "two startup statements, whose order is the author's",
    files: { "src/main.vel": `${COMPONENT}\nprint("starting")\nmount(<App />, "#app")\n` },
    refused: true,
    fixed: false,
  },
  {
    title: "a startup statement with a declaration after it",
    files: { "src/main.vel": `${COMPONENT}\nmount(<App />, "#app")\n\ndef unused() -> number:\n    return 1\n` },
    refused: true,
    fixed: false,
  },
  {
    title: "an entry that performs no startup at all",
    files: { "src/main.vel": COMPONENT },
    refused: true,
    fixed: false,
  },
  {
    title: "a startup statement spread over several lines",
    files: { "src/main.vel": `${COMPONENT}\nmount(\n    <App />,\n    "#app",\n)\n` },
    refused: true,
    fixed: false,
  },
  {
    // The inline `@main: <statement>` body accepts one *non-block* statement,
    // so wrapping this one where it stands would produce source the compiler
    // refuses. A rewrite has to leave a tree that still compiles, not merely a
    // tree that answers the rule it was reaching for.
    title: "a one-line startup statement that heads a block of its own",
    files: { "src/main.vel": `${COMPONENT}\nif true: mount(<App />, "#app")\n` },
    refused: true,
    fixed: false,
  },
  {
    title: "an entry that already owns its startup",
    files: { "src/main.vel": `${COMPONENT}\n@main: mount(<App />, "#app")\n` },
    refused: false,
    fixed: false,
  },
  {
    title: "a mechanically fixable compiler diagnostic beside a lawful entry",
    files: {
      "src/main.vel": `${COMPONENT}\n@main: mount(<App />, "#app")\n`,
      "src/orphan.vel": "export def one(value: string) -> bool:\n    return value === \"one\"\n",
    },
    refused: true,
    fixed: true,
  },
  {
    title: "a compiler diagnostic no rewrite answers, beside a lawful entry",
    files: {
      "src/main.vel": `${COMPONENT}\n@main: mount(<App />, "#app")\n`,
      "src/orphan.vel": "export def one() -> number:\n    return \"not a number\"\n",
    },
    refused: true,
    fixed: false,
  },
];

test("[D101] 'velar fix' reports diagnostics remaining exactly when 'velar check' refuses the tree it leaves", async () => {
  for (const fixture of PROJECT_LAYER_FIXTURES) {
    const project = await webProject(fixture.files);
    try {
      const before = project.cli("check", ".");
      assert.equal(before.status !== 0, fixture.refused, `${fixture.title}: check\n${before.stdout}${before.stderr}`);

      const fixed = project.cli("fix", ".");
      const remaining = remainingDiagnostics(fixed.stdout);
      assert.notEqual(remaining, -1, `${fixture.title}: fix printed no summary\n${fixed.stdout}${fixed.stderr}`);

      // The agreement, in the only form that means anything: both commands are
      // asked about the tree as it stands after `fix` has written whatever it
      // was going to write, and they must give the same verdict about it.
      const after = project.cli("check", ".");
      assert.equal(
        remaining > 0,
        after.status !== 0,
        `${fixture.title}: fix reported ${remaining} remaining and check exited ${after.status}\n${fixed.stdout}${after.stderr}`,
      );
      // And the exit code carries the same claim the summary line makes, so a
      // script that reads only the status learns the same thing a reader does.
      assert.equal(fixed.status !== 0, remaining > 0, `${fixture.title}: fix exit ${fixed.status} with ${remaining} remaining`);
      assert.equal(after.status === 0, fixture.fixed || !fixture.refused, `${fixture.title}: check after fix exited ${after.status}`);
    } finally {
      await rm(project.root, { recursive: true, force: true });
    }
  }
});

test("[D101] the entry migration rewrites the one provable shape and reports the rest verbatim", async () => {
  const migrated = await webProject({ "src/main.vel": `${COMPONENT}\nmount(<App />, "#app")\n` });
  try {
    const fixed = migrated.cli("fix", ".");
    assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
    assert.match(fixed.stdout, /src\/main\.vel:4:1 fixed application-entry: Move the entry's startup statement into its '@main' region/u);
    // The region is written where the statement stood, in the inline form the
    // parser gives the statement semantics of an indented body — so the entry
    // is the author's own line with a marker in front of it, and nothing else
    // in the file moved.
    assert.equal(await readFile(join(migrated.root, "src", "main.vel"), "utf8"), `${COMPONENT}\n@main: mount(<App />, "#app")\n`);
    // The canonical layout accepts it, which is what makes `fix` then `format`
    // and `format` then `fix` the same tree.
    assert.equal(migrated.cli("format", ".", "--check").status, 0);
    assert.equal(migrated.cli("check", ".").status, 0);
  } finally {
    await rm(migrated.root, { recursive: true, force: true });
  }
});

test("[D101] a two-statement startup is reported rather than rewritten into a guessed order", async () => {
  const source = `${COMPONENT}\nprint("starting")\nmount(<App />, "#app")\n`;
  const project = await webProject({ "src/main.vel": source });
  try {
    const fixed = project.cli("fix", ".");
    assert.equal(fixed.status, 1, fixed.stdout + fixed.stderr);
    assert.match(fixed.stderr, /Application entry must declare '@main'/u);
    assert.match(fixed.stdout, /applied 0 mechanical fixes; 1 diagnostic remains/u);
    // Which statement runs first is visible in the source today. A fixer that
    // merged the two into one region would be asserting that the order it chose
    // is the order that was meant, so the file keeps the bytes the author wrote.
    assert.equal(await readFile(join(project.root, "src", "main.vel"), "utf8"), source);
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[D101] a library entry's refusal reaches 'velar fix' too, and carries no rewrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-project-layer-library-"));
  try {
    const source = "@main: pass\n";
    await writeFile(join(root, "velar.json"), JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "src/index.vel",
      outDir: "dist",
    }), "utf8");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "index.vel"), source, "utf8");
    const run = (...commandArguments: readonly string[]) =>
      spawnSync(process.execPath, [cliPath, ...commandArguments], { cwd: root, encoding: "utf8", timeout: 120_000 });

    assert.equal(run("check", ".").status, 1);
    const fixed = run("fix", ".");
    assert.equal(fixed.status, 1, fixed.stdout + fixed.stderr);
    assert.match(fixed.stderr, /A library entry cannot declare '@main'/u);
    assert.match(fixed.stdout, /applied 0 mechanical fixes; 1 diagnostic remains/u);
    // Deleting the region would delete the startup the author wrote, and moving
    // it needs an application project that does not exist yet.
    assert.equal(await readFile(join(root, "src", "index.vel"), "utf8"), source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[D101] 'velar fix <file>' scopes the project-layer rules out, exactly as 'velar check <file>' does", async () => {
  const source = `${COMPONENT}\nmount(<App />, "#app")\n`;
  const project = await webProject({ "src/main.vel": source });
  try {
    // A single-file input names its own scope for both commands. Asking a
    // project-arrangement question about one file would answer it about a
    // project the author did not name — and would rewrite that file besides.
    const checked = project.cli("check", "src/main.vel");
    assert.equal(checked.status, 0, checked.stderr);
    const fixed = project.cli("fix", "src/main.vel");
    assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
    assert.match(fixed.stdout, /0 diagnostics remain/u);
    assert.equal(await readFile(join(project.root, "src", "main.vel"), "utf8"), source);
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
