import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const gatePath = fileURLToPath(new URL("../scripts/check-file-budget.mjs", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * D115 §二 — the file and function budgets, and the allowlist that may only
 * shrink.
 *
 * A gate is a claim about a repository, and an unexercised gate is the weakest
 * kind: `check-tour-coverage.mjs` takes a tour root and
 * `check-surface-versions.mjs` takes a lock path for exactly this reason — "a
 * gate that checks nothing fails silently, so being able to point this one at a
 * mutated lock and watch it go red is part of owning it." This file points
 * `check-file-budget.mjs` at small fixture trees and watches all four of its
 * verdicts: a new violation, a violation that grew past its ceiling, an
 * exemption that has been earned back, and `--write` asked to enlarge the list.
 *
 * The fixtures are built in a temporary directory rather than checked in under
 * `tests/fixtures/`, because a checked-in over-budget `.ts` file would be a
 * file this very gate reads — the fixture would be the violation.
 */

interface Fixture {
  readonly root: string;
  allowlist(content: unknown): Promise<void>;
  readAllowlist(): Promise<{ files: Record<string, number>; functions: Record<string, number> }>;
  run(...args: readonly string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string };
}

/** A source file of `lines` physical lines whose every function is small. */
function paddedModule(lines: number): string {
  const body = ["export function small(): number {", "  return 1;", "}"];
  const padding = Array.from({ length: lines - body.length }, (_unused, index) => `export const value${index} = ${index};`);
  return `${[...padding, ...body].join("\n")}\n`;
}

/** One function of `lines` physical lines, in a file well under the file cap. */
function longFunction(name: string, lines: number): string {
  const middle = Array.from({ length: lines - 4 }, (_unused, index) => `  total += ${index};`);
  return `export function ${name}(): number {\n  let total = 0;\n${middle.join("\n")}\n  return total;\n}\n`;
}

async function fixture(files: Readonly<Record<string, string>>): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "velar-file-budget-"));
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, source, "utf8");
  }
  return {
    root,
    async allowlist(content) {
      await writeFile(join(root, "file-budget-allowlist.json"), `${JSON.stringify(content, null, 2)}\n`, "utf8");
    },
    async readAllowlist() {
      return JSON.parse(await readFile(join(root, "file-budget-allowlist.json"), "utf8"));
    },
    run(...args) {
      const result = spawnSync(process.execPath, [gatePath, "--root", root, ...args], {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 120_000,
      });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
  };
}

const FROZEN = {
  gate: "scripts/check-file-budget.mjs",
  decision: "D115",
  limits: { file: 800, function: 120 },
  files: {},
  functions: {},
};

test("a file over 800 lines and a function over 120 lines each fail, named where a reader finds them", async () => {
  const tree = await fixture({
    "packages/demo/src/big.ts": paddedModule(810),
    "tests/long.test.ts": longFunction("long", 130),
  });
  await tree.allowlist(FROZEN);
  try {
    const result = tree.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /packages\/demo\/src\/big\.ts is 810 lines; the limit is 800/u);
    assert.match(result.stderr, /tests\/long\.test\.ts:1 long is 130 lines; the limit is 120/u);
    // The failure says what to do, in both directions: shrink it, or exempt it
    // as a deliberate act.
    assert.match(result.stderr, /"files": \{ "packages\/demo\/src\/big\.ts": 810 \}/u);
    assert.match(result.stderr, /"functions": \{ "tests\/long\.test\.ts#long": 130 \}/u);
    assert.match(result.stderr, /Adding an exemption is a decision; name it in the commit\./u);
  } finally {
    await rm(tree.root, { recursive: true, force: true });
  }
});

test("an allowlisted file or function that grew past its ceiling fails; one that stayed under it passes", async () => {
  const tree = await fixture({
    "packages/demo/src/big.ts": paddedModule(810),
    "tests/long.test.ts": longFunction("long", 130),
  });
  try {
    await tree.allowlist({ ...FROZEN, files: { "packages/demo/src/big.ts": 805 }, functions: { "tests/long.test.ts#long": 125 } });
    const grew = tree.run();
    assert.equal(grew.status, 1);
    assert.match(grew.stderr, /packages\/demo\/src\/big\.ts is 810 lines, and file-budget-allowlist\.json caps it at 805 — it grew by 5\./u);
    assert.match(grew.stderr, /tests\/long\.test\.ts:1 long is 130 lines, and file-budget-allowlist\.json caps it at 125 — it grew by 5\./u);

    // A ceiling above the current size is the exemption working as intended:
    // an exempt item may sit anywhere at or below what was recorded.
    await tree.allowlist({ ...FROZEN, files: { "packages/demo/src/big.ts": 900 }, functions: { "tests/long.test.ts#long": 200 } });
    const within = tree.run();
    assert.equal(within.status, 0, within.stderr);
    assert.match(within.stdout, /file-budget: 1 files and 1 functions still above the limit; the allowlist only shrinks/u);
  } finally {
    await rm(tree.root, { recursive: true, force: true });
  }
});

test("an exemption that has been earned back must be deleted, and the failure says which line", async () => {
  const tree = await fixture({
    "packages/demo/src/small.ts": paddedModule(40),
    "tests/short.test.ts": longFunction("short", 30),
  });
  await tree.allowlist({
    ...FROZEN,
    files: { "packages/demo/src/small.ts": 900, "packages/demo/src/deleted.ts": 1200 },
    functions: { "tests/short.test.ts#short": 400, "tests/short.test.ts#renamed": 300 },
  });
  try {
    const result = tree.run();
    assert.equal(result.status, 1);
    // Shrunk back under the limit…
    assert.match(result.stderr, /packages\/demo\/src\/small\.ts is 40 lines, within the 800-line limit, but file-budget-allowlist\.json still exempts it at 900\./u);
    assert.match(result.stderr, /tests\/short\.test\.ts:1 short is 30 lines, within the 120-line limit, but file-budget-allowlist\.json still exempts it at 400\./u);
    // …and gone altogether.
    assert.match(result.stderr, /exempts "packages\/demo\/src\/deleted\.ts" at 1200 lines, and this gate reads no such file\./u);
    assert.match(result.stderr, /exempts "tests\/short\.test\.ts#renamed" at 300 lines, and this gate finds no such function\./u);
    for (const line of [`"packages/demo/src/small.ts": 900,`, `"packages/demo/src/deleted.ts": 1200,`, `"tests/short.test.ts#short": 400,`, `"tests/short.test.ts#renamed": 300,`]) {
      assert.ok(result.stderr.includes(line), `the failure prints the line to delete: ${line}`);
    }
    assert.match(result.stderr, /The list only shrinks\./u);
  } finally {
    await rm(tree.root, { recursive: true, force: true });
  }
});

test("--write freezes the current tree, and refuses to grow the list without --accept-growth", async () => {
  const tree = await fixture({
    "packages/demo/src/big.ts": paddedModule(810),
    "tests/long.test.ts": longFunction("long", 130),
  });
  try {
    // First freeze: no list yet, so nothing is being *added* to anything.
    const first = tree.run("--write");
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Wrote file-budget-allowlist\.json: 1 files and 1 functions exempted \(first freeze\)\./u);
    assert.deepEqual(await tree.readAllowlist(), {
      gate: "scripts/check-file-budget.mjs",
      decision: "D115",
      limits: { file: 800, function: 120 },
      files: { "packages/demo/src/big.ts": 810 },
      functions: { "tests/long.test.ts#long": 130 },
    });
    assert.equal(tree.run().status, 0);

    // Now grow the tree and re-run `--write`: regenerating is not a way to
    // agree to growth.
    await writeFile(join(tree.root, "packages/demo/src/second.ts"), paddedModule(900), "utf8");
    await writeFile(join(tree.root, "tests/long.test.ts"), longFunction("long", 150), "utf8");
    const refused = tree.run("--write");
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /--write would grow file-budget-allowlist\.json by 2 entries:/u);
    assert.match(refused.stderr, /\+ file packages\/demo\/src\/second\.ts — 900 lines, new exemption/u);
    assert.match(refused.stderr, /↑ function tests\/long\.test\.ts#long — 130 → 150 lines, ceiling raised/u);
    assert.deepEqual((await tree.readAllowlist()).files, { "packages/demo/src/big.ts": 810 }, "the refused --write wrote nothing");

    const accepted = tree.run("--write", "--accept-growth");
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /Wrote file-budget-allowlist\.json: 2 files and 1 functions exempted, 2 of them added or raised\./u);
    assert.deepEqual(await tree.readAllowlist(), {
      gate: "scripts/check-file-budget.mjs",
      decision: "D115",
      limits: { file: 800, function: 120 },
      files: { "packages/demo/src/big.ts": 810, "packages/demo/src/second.ts": 900 },
      functions: { "tests/long.test.ts#long": 150 },
    });
    assert.equal(tree.run().status, 0);
  } finally {
    await rm(tree.root, { recursive: true, force: true });
  }
});

test("a method, a constructor, an accessor and a named arrow each carry their own budget; an inline callback does not", async () => {
  const filler = (count: number) => Array.from({ length: count }, (_unused, index) => `    total += ${index};`).join("\n");
  const tree = await fixture({
    "packages/demo/src/shapes.ts": [
      "export class Shape {",
      "  total = 0;",
      "  constructor() {",
      filler(126),
      "  }",
      "  measure(): number {",
      filler(126),
      "    return this.total;",
      "  }",
      "  get size(): number {",
      filler(126),
      "    return this.total;",
      "  }",
      "}",
      "export const named = (): number => {",
      filler(126),
      "  return 1;",
      "};",
      "export function host(): number {",
      "  return [1].map((value) => {",
      filler(126),
      "    return value;",
      "  }).length;",
      "}",
      "",
    ].join("\n"),
  });
  await tree.allowlist(FROZEN);
  try {
    const result = tree.run();
    assert.equal(result.status, 1);
    const named = [...result.stderr.matchAll(/"functions": \{ "([^"]+)": (\d+) \}/gu)].map(([, key, lines]) => `${key} ${lines}`);
    // `host` is over budget because the callback it passes to `map` counts
    // against *its* budget; the callback itself is not a separate entry.
    assert.deepEqual(named.sort(), [
      "packages/demo/src/shapes.ts#Shape.constructor 128",
      "packages/demo/src/shapes.ts#Shape.measure 129",
      "packages/demo/src/shapes.ts#Shape.size 129",
      "packages/demo/src/shapes.ts#host 131",
      "packages/demo/src/shapes.ts#named 129",
    ]);
  } finally {
    await rm(tree.root, { recursive: true, force: true });
  }
});

test("the repository runs the gate as part of `npm run check`", async () => {
  const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(manifest.scripts["check:file-budget"], "node scripts/check-file-budget.mjs");
  const gateCheck: string = manifest.scripts["gate:check"] ?? "";
  assert.ok(gateCheck.includes("npm run check:file-budget"), `gate:check does not run the file budget gate:\n${gateCheck}`);
});

test("the repository's own allowlist is frozen at what this commit measures", async () => {
  const recorded = JSON.parse(await readFile(join(repositoryRoot, "file-budget-allowlist.json"), "utf8"));
  assert.equal(recorded.gate, "scripts/check-file-budget.mjs");
  assert.equal(recorded.decision, "D115");
  assert.deepEqual(recorded.limits, { file: 800, function: 120 });
  // The list is a set of ceilings over the repository itself, not a fixture of
  // it: every recorded file exists, and none has grown past its ceiling. The
  // numbers are deliberately not pinned here — the refactor slices shrink them
  // and delete entries as files come under the limit (D115 §二).
  for (const [path, ceiling] of Object.entries(recorded.files as Record<string, number>)) {
    const lines = (await readFile(join(repositoryRoot, path), "utf8")).split("\n").length - 1;
    assert.ok(lines > 800, `${path} is within the file limit; its allowlist entry must be deleted`);
    assert.ok(lines <= ceiling, `${path} has ${lines} lines, above its recorded ceiling ${ceiling}`);
  }
  for (const key of Object.keys(recorded.functions as Record<string, number>)) {
    assert.match(key, /^[^#]+#.+$/u, `function entry '${key}' is not 'path#qualified name'`);
  }
});
