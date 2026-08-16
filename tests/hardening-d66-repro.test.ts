import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { DEFECT_REPORT_SECTIONS, reproductionHint } from "../packages/cli/src/reproduction.ts";

// ---------------------------------------------------------------------------
// D66 rulings 7A, 7B and 7D — the minimal-repro doctrine gets an exit.
//
// The doctrine was already written and already good: docs/escape-hatches.md
// fixes both the reduce-to-minimal ladder and the exact three sections a defect
// report carries. What it never had was a way out — no issue template, no CLI
// command, and no line at the end of a failing check pointing at either. These
// rulings mechanize the doctrine that exists; they do not invent a second one,
// which is why the first test below holds the CLI's own copy of the three
// sections against the prose that owns them.
//
// The evidence for all three rulings is execution-level — what the toolchain
// prints and what it writes to disk — so every probe here runs the real CLI
// over a real project and reads the real bundle.
// ---------------------------------------------------------------------------

const root = resolve(new URL("..", import.meta.url).pathname);
const cli = join(root, "packages", "cli", "src", "cli.ts");

after(removeTemporaryDirectories);

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(arguments_: readonly string[]): Run {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function project(prefix: string, files: Readonly<Record<string, string>>): Promise<string> {
  const directory = await realpath(await makeTemporaryDirectory(prefix));
  for (const [path, content] of Object.entries(files)) {
    const target = join(directory, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return directory;
}

async function filesUnder(directory: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else output.push(relative(directory, path).split(sep).join("/"));
    }
  };
  await visit(directory);
  return output.sort();
}

const failingProject: Readonly<Record<string, string>> = {
  "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }, null, 2)}\n`,
  "src/helper.vel": "export def double(value: number) -> number:\n    return value * 2\n",
  "src/main.vel": 'import {double} from "./helper.vel"\n\nconst total: number = "not a number"\nprint(double(total))\n',
};

test("D66 7A the CLI's three report sections are the ones docs/escape-hatches.md fixed", async () => {
  // The whole point of ruling 7 is that the CLI, the issue template, and the
  // prose quote one source. Nothing stops them drifting except this test.
  const doctrine = await readFile(join(root, "docs", "escape-hatches.md"), "utf8");
  const template = await readFile(join(root, ".github", "ISSUE_TEMPLATE", "1-defect.yml"), "utf8");
  assert.equal(DEFECT_REPORT_SECTIONS.length, 3);
  for (const section of DEFECT_REPORT_SECTIONS) {
    assert.ok(doctrine.split("\n").some((line) => line.trim() === section),
      `docs/escape-hatches.md must still own the report section '${section}'; the CLI copies it verbatim`);
    assert.ok(template.includes(section.slice(0, -1)),
      `.github/ISSUE_TEMPLATE/1-defect.yml must ask for '${section.slice(0, -1)}' in the doctrine's own words`);
  }
});

test("D66 7A velar repro writes a reproduction that reproduces, and prints where it went", async () => {
  const directory = await project("velar-d66-repro-happy-", failingProject);

  const checked = run(["check", directory]);
  assert.equal(checked.status, 1, checked.stderr);
  const diagnostics = checked.stderr.slice(0, -`${reproductionHint(directory)}\n`.length);

  const produced = run(["repro", directory]);
  assert.equal(produced.status, 0, produced.stderr);
  assert.equal(produced.stderr, "");
  const bundle = join(directory, ".velar", "repro");
  assert.ok(produced.stdout.includes(bundle), `velar repro must print the reproduction's path, got: ${produced.stdout}`);
  assert.ok(produced.stdout.includes("The extracted bundle produces the same diagnostics."), produced.stdout);

  assert.deepEqual(await filesUnder(bundle), [
    "README.md",
    "package.json",
    "src/helper.vel",
    "src/main.vel",
    "velar.json",
  ]);
  assert.equal(await readFile(join(bundle, "src", "main.vel"), "utf8"), failingProject["src/main.vel"]);
  assert.equal(await readFile(join(bundle, "velar.json"), "utf8"), failingProject["velar.json"]);

  const readme = await readFile(join(bundle, "README.md"), "utf8");
  for (const section of DEFECT_REPORT_SECTIONS) assert.ok(readme.includes(`## ${section}`), `the README must carry '${section}'`);
  // "What the compiler said" is pre-filled from the real run, verbatim apart
  // from the absolute paths this machine would otherwise leak.
  assert.ok(readme.includes(diagnostics.split(directory + sep).join("").trimEnd()),
    `the README must quote the diagnostics verbatim, got:\n${readme}`);
  assert.match(readme, /^Versions: velar \d+\.\d+\.\d+ · node v\d+\.\d+\.\d+ · \w+ \w+$/mu);
  assert.ok(readme.includes("npm install\nnpx velar check\n"), "the README must give the reproduce instructions");
  // The two sections the human (or model) owns are blanks, not answers.
  assert.equal(readme.match(/^TODO — this section is yours to write\./gmu)?.length, 2, readme);

  // `npm install && npx velar check` has to have something to install.
  const manifest = JSON.parse(await readFile(join(bundle, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
  assert.ok(manifest.devDependencies["@velarscript/cli"], "the reproduction must name the toolchain it needs");
});

test("D66 7A a reproduction carries no absolute host path and no environment data", async () => {
  // Discipline 2 of the ruling. The marker is in the project's own path, so a
  // single leaked absolute path anywhere in the bundle fails this. A dedicated
  // environment sentinel proves the second half without treating a static
  // product string such as the GitHub repository name as collected host data.
  const environmentSentinel = "velar-d66-environment-sentinel-7d2b91c4";
  const previousSentinel = process.env.VELAR_D66_ENVIRONMENT_SENTINEL;
  process.env.VELAR_D66_ENVIRONMENT_SENTINEL = environmentSentinel;
  const directory = await project("velar-d66-repro-nothing-collected-", failingProject);
  const produced = (() => {
    try {
      return run(["repro", directory]);
    } finally {
      if (previousSentinel === undefined) delete process.env.VELAR_D66_ENVIRONMENT_SENTINEL;
      else process.env.VELAR_D66_ENVIRONMENT_SENTINEL = previousSentinel;
    }
  })();
  assert.equal(produced.status, 0, produced.stderr);

  const bundle = join(directory, ".velar", "repro");
  const forbidden = [
    directory,
    directory.split(sep).join("/"),
    await realpath(directory),
    root,
    process.execPath,
    environmentSentinel,
  ];
  for (const file of await filesUnder(bundle)) {
    const content = await readFile(join(bundle, file), "utf8");
    for (const secret of forbidden) {
      assert.ok(!content.includes(secret), `${file} leaked '${secret}' out of the host machine`);
    }
    assert.doesNotMatch(content, /(?:^|[\s"'(])[/\\](?:Users|home|var|private|tmp)[/\\]/mu,
      `${file} still holds an absolute host path`);
  }
});

test("D66 7A a module the bundle cannot carry is named relative to the project, never as it sits here", async () => {
  // The one path that reaches the README without passing through a diagnostic.
  // An installed VelarScript source package is real source the check read, so
  // the README says it was left to `npm install` — and says it in the project's
  // terms, because an absolute path here would leak the host machine into a
  // file meant to be handed to a stranger.
  const directory = await project("velar-d66-repro-installed-package-", {
    "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }, null, 2)}\n`,
    "node_modules/chart-kit/package.json": JSON.stringify({ name: "chart-kit", version: "1.0.0", velar: { entry: "src/index.vel" } }),
    "node_modules/chart-kit/src/index.vel": "export def scale(value: number) -> number:\n    return value * 4\n",
    "src/main.vel": 'import {scale} from "chart-kit"\n\nconst total: number = "not a number"\nprint(scale(total))\n',
  });

  const produced = run(["repro", directory]);
  assert.equal(produced.status, 0, produced.stderr);
  const bundle = join(directory, ".velar", "repro");
  const readme = await readFile(join(bundle, "README.md"), "utf8");
  assert.ok(readme.includes("node_modules/chart-kit/src/index.vel"),
    `the README must name the module it could not carry, got:\n${readme}`);
  assert.ok(!readme.includes(directory), "and must not name it by its path on this machine");
  assert.ok(!(await filesUnder(bundle)).some((file) => file.startsWith("node_modules/")),
    "an installed package is restored by npm install, not copied into a minimal reproduction");
});

test("D66 7A velar repro never uploads and never reaches the network", async () => {
  // Discipline 1: it writes to disk and prints the path. Whether to send it is
  // the author's decision, so there is no client here to send it with — not
  // even an opt-in one.
  const source = await readFile(join(root, "packages", "cli", "src", "reproduction.ts"), "utf8");
  for (const forbidden of ["node:http", "node:https", "node:net", "node:dgram", "fetch(", "XMLHttpRequest", "WebSocket"]) {
    assert.ok(!source.includes(forbidden),
      `packages/cli/src/reproduction.ts must not reach the network; found '${forbidden}'`);
  }
  assert.ok(!source.includes("process.env"), "a reproduction collects nothing from the environment");
});

test("D66 7A a bundle that stops reproducing says so instead of handing over a false lead", async () => {
  // Discipline 3. The check here resolves an installed JavaScript package, and
  // installed packages are restored by `npm install` rather than copied into a
  // minimal reproduction — so the extracted copy really does behave differently
  // and the command has to admit it.
  const directory = await project("velar-d66-repro-honesty-", {
    "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }, null, 2)}\n`,
    "node_modules/measure-tool/package.json": JSON.stringify({ name: "measure-tool", type: "module", exports: "./index.js" }),
    "node_modules/measure-tool/index.js": "export function measure() { return 7; }\n",
    "src/main.vel": 'extern module "measure-tool":\n    export def measure() -> number\n\n'
      + 'import js {measure} from "measure-tool"\n\nconst total: number = "not a number"\nprint(measure() + total)\n',
  });

  const produced = run(["repro", directory]);
  assert.equal(produced.status, 0, produced.stderr);
  assert.ok(produced.stdout.includes("Reproduces on this machine but not in the extracted bundle"),
    `velar repro must not report a clean reproduction it could not confirm, got: ${produced.stdout}`);

  const readme = await readFile(join(directory, ".velar", "repro", "README.md"), "utf8");
  assert.ok(readme.includes("it reproduces on this machine but not in the extracted\nbundle."), readme);
  assert.ok(readme.includes("## What the extracted copy said instead"), readme);
  // The evidence for the difference is in the file, so the reader is not left
  // guessing what changed.
  assert.match(readme, /VEL6006/u);
  // The report itself still quotes the run that actually failed.
  assert.match(readme, /VEL4001: Cannot assign string to number/u);
});

test("D66 7A a reproduction carries the entry's modules and the failing test, and nothing else", async () => {
  const directory = await project("velar-d66-repro-minimal-", {
    "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }, null, 2)}\n`,
    "src/util.vel": "export def triple(value: number) -> number:\n    return value * 3\n",
    "src/main.vel": 'import {triple} from "./util.vel"\nprint(triple(2))\n',
    "src/util.test.vel": 'import {expect} from "velar/test"\nimport {triple} from "./util.vel"\n\n'
      + 'test "triple":\n    const wrong: number = "six"\n    expect(triple(2)).toBe(wrong)\n',
    "src/clean.test.vel": 'import {expect} from "velar/test"\n\ntest "clean":\n    expect(1).toBe(1)\n',
    "src/unreached.vel": "export const orphan = 1\n",
  });

  const produced = run(["repro", directory]);
  assert.equal(produced.status, 0, produced.stderr);
  assert.deepEqual(await filesUnder(join(directory, ".velar", "repro")), [
    "README.md",
    "package.json",
    "src/main.vel",
    "src/util.test.vel",
    "src/util.vel",
    "velar.json",
  ], "a reproduction is the entry graph plus the test roots that failed — not a copy of the project");
});

test("D66 7A velar repro matches the CLI's argument conventions", async () => {
  const directory = await project("velar-d66-repro-arguments-", failingProject);

  assert.equal(run(["repro", "--nope"]).status, 2);
  assert.match(run(["repro", "--nope"]).stderr, /^velar repro: unknown option '--nope'\n$/u);
  assert.match(run(["repro", "a", "b"]).stderr, /^velar repro: unexpected extra input 'b'\n$/u);
  assert.match(run(["repro", "--out-dir"]).stderr, /^velar repro: --out-dir requires a path\n$/u);
  assert.match(run(["repro", directory, "--out-dir", "one", "--out-dir", "two"]).stderr, /--out-dir may be provided only once/u);

  const help = run(["help", "repro"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: velar repro \[entry\.vel \| project-directory\] \[--out-dir <directory>\]/u);
  assert.match(run(["--help"]).stdout, /^ {2}velar repro \[entry\.vel \| project-directory\] \[--out-dir <directory>\]$/mu);

  // An empty directory the author named is used; a directory holding their work
  // is never emptied for them.
  const chosen = join(await makeTemporaryDirectory("velar-d66-repro-out-dir-"), "bundle");
  const first = run(["repro", directory, "--out-dir", chosen]);
  assert.equal(first.status, 0, first.stderr);
  assert.ok(first.stdout.includes(chosen), first.stdout);
  const second = run(["repro", directory, "--out-dir", chosen]);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /already exists and is not empty; name an empty directory/u);

  // A single-file input keeps the command that reproduces it honest.
  const file = join(await makeTemporaryDirectory("velar-d66-repro-file-"), "bundle");
  assert.equal(run(["repro", join(directory, "src", "main.vel"), "--out-dir", file]).status, 0);
  assert.ok((await readFile(join(file, "README.md"), "utf8")).includes("npx velar check src/main.vel"));
});

test("D66 7A velar repro on a project that checks clean has nothing to reproduce", async () => {
  const directory = await project("velar-d66-repro-clean-", {
    "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }, null, 2)}\n`,
    "src/main.vel": "print(1)\n",
  });
  const produced = run(["repro", directory]);
  assert.equal(produced.status, 1);
  assert.match(produced.stderr, /^velar repro: .* checks without errors; there is no failure to reproduce\n$/u);
  assert.equal(produced.stdout, "");
});

test("D66 7B a failing velar check ends with one line naming the command that bundles it", async () => {
  const directory = await project("velar-d66-repro-hint-", failingProject);

  const failed = run(["check", directory]);
  assert.equal(failed.status, 1);
  const lines = failed.stderr.trimEnd().split("\n");
  assert.equal(lines.at(-1), reproductionHint(directory), failed.stderr);
  assert.equal(lines.filter((line) => line.startsWith("Run 'velar repro")).length, 1,
    "the hint appears exactly once, at the end");
  // No persuasion and no telemetry notice: one line, one command, nothing else.
  assert.doesNotMatch(failed.stderr, /telemetr|anonym|upload|send|report to|help us|please/iu);

  // Only on failure.
  const clean = await project("velar-d66-repro-hint-clean-", {
    "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }, null, 2)}\n`,
    "src/main.vel": "print(1)\n",
  });
  const passed = run(["check", clean]);
  assert.equal(passed.status, 0, passed.stderr);
  assert.doesNotMatch(passed.stdout + passed.stderr, /velar repro/u);

  // Only `check`. The ruling names it, and it is the command the reproduction's
  // own README tells a reader to run.
  const built = run(["build", directory]);
  assert.equal(built.status, 1);
  assert.doesNotMatch(built.stderr, /velar repro/u);

  // The hint reproduces what the author actually ran, not a guess.
  assert.equal(reproductionHint(null), "Run 'velar repro' to write a minimal reproduction of this failure.");
});

test("D66 7D the AI skill brief sends a model down the same channel a human uses", async () => {
  const brief = await readFile(join(root, "docs", "ai-skill.md"), "utf8");
  const mirror = await readFile(join(root, "packages", "cli", "skill", "ai-skill.md"), "utf8");
  assert.equal(brief, mirror, "packages/cli/skill/ai-skill.md must stay byte-identical to docs/ai-skill.md");

  assert.match(brief, /`velar repro`/u, "the brief must name the command that bundles a compiler wall");
  for (const section of DEFECT_REPORT_SECTIONS) {
    assert.ok(brief.includes(section.slice(0, -1)),
      `the brief must send a model to the doctrine's own '${section.slice(0, -1)}' section, not a second format`);
  }
  assert.match(brief, /ISSUE_TEMPLATE|issue template/u, "the brief must point at the repository's template");

  const printed = run(["skill"]);
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(printed.stdout, brief);
});
