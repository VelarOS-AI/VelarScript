import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const gatePath = fileURLToPath(new URL("../../scripts/check-module-map.mjs", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * D115 §二, P4 R6 — the module map, and the five ways it can stop describing
 * this repository.
 *
 * The gate this file exercises is a claim about a tree: every directory that
 * holds source is declared, every file over the cap has a stated reason and the
 * file budget agrees with it, no two modules import each other, no composition
 * root has grown a function back, and the document a reader opens still names
 * all of it. An unexercised claim of that size is the weakest kind — so, for
 * the reason `file-budget-gate.test.ts` states about its own gate, this one is
 * pointed at temporary trees with one planted violation each and watched going
 * red, once per rule and in both directions where the rule has two.
 *
 * The fixtures are built in a temporary directory rather than checked in: a
 * checked-in 810-line source file or a checked-in import cycle would be a file
 * this very gate reads, and the fixture would be the violation.
 */

interface Fixture {
  readonly root: string;
  run(...args: readonly string[]): { readonly status: number | null; readonly stdout: string; readonly stderr: string };
}

const DOCUMENT = "docs/contributing/module-map.md";

const BUDGET = {
  gate: "scripts/check-file-budget.mjs",
  decision: "D115",
  limits: { file: 800, function: 120 },
  files: {} as Record<string, number>,
  functions: {},
};

/** A map of one package with one directory in it — the smallest tree that is not vacuous. */
function baseMap(): Record<string, unknown> {
  return {
    gate: "scripts/check-module-map.mjs",
    decision: "D115",
    document: DOCUMENT,
    packages: {
      demo: {
        root: "The entry point and the leaves nothing else owns.",
        directories: { analysis: "The analyzer's collaborators." },
      },
    },
    compositionRoots: {},
    remainders: {},
    allowedCycles: [],
  };
}

/** A source file of `lines` physical lines whose every function is small. */
function paddedModule(lines: number, prologue = ""): string {
  const body = [prologue, "export function small(): number {", "  return 1;", "}"].filter((part) => part !== "");
  const padding = Array.from({ length: lines - body.length }, (_unused, index) => `export const value${index} = ${index};`);
  return `${[...padding, ...body].join("\n")}\n`;
}

/** A class whose one method is `methodLines` long, in a file of `lines` physical lines. */
function rootModule(lines: number, methodLines: number): string {
  const steps = Array.from({ length: methodLines - 4 }, (_unused, index) => `    total += ${index};`);
  const declaration = [
    "export class Host {",
    "  dispatch(): number {",
    "    let total = 0;",
    ...steps,
    "    return total;",
    "  }",
    "}",
  ];
  const padding = Array.from({ length: lines - declaration.length }, (_unused, index) => `export const value${index} = ${index};`);
  return `${[...padding, ...declaration].join("\n")}\n`;
}

/** The prose half, derived from the roster so that only a deliberate omission is missing. */
function documentFor(map: Record<string, unknown>): string {
  const named: string[] = [];
  const packages = map["packages"] as Record<string, { directories: Record<string, string> }>;
  for (const [name, entry] of Object.entries(packages ?? {})) {
    for (const directory of Object.keys(entry.directories)) named.push(`packages/${name}/src/${directory}/`);
  }
  named.push(...Object.keys((map["compositionRoots"] ?? {}) as Record<string, unknown>));
  named.push(...Object.keys((map["remainders"] ?? {}) as Record<string, unknown>));
  return `# Module map\n\n${named.map((path) => `- \`${path}\`\n`).join("")}`;
}

async function fixture(
  files: Readonly<Record<string, string>>,
  map: Record<string, unknown>,
  budget: Readonly<Record<string, unknown>> = BUDGET,
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "velar-module-map-"));
  const written = { [DOCUMENT]: documentFor(map), ...files };
  for (const [name, source] of Object.entries(written)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, source, "utf8");
  }
  await writeFile(join(root, "module-map.json"), `${JSON.stringify(map, null, 2)}\n`, "utf8");
  await writeFile(join(root, "file-budget-allowlist.json"), `${JSON.stringify(budget, null, 2)}\n`, "utf8");
  return {
    root,
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

/** Every fixture starts from the same two-file, one-directory tree. */
const CLEAN_TREE = {
  "packages/demo/src/index.ts": "export const name = \"demo\";\n",
  "packages/demo/src/analysis/one.ts": "export const one = 1;\n",
  "packages/demo/src/analysis/two.ts": "export const two = 2;\n",
};

async function withFixture(tree: Fixture, body: (tree: Fixture) => void): Promise<void> {
  try {
    body(tree);
  } finally {
    await rm(tree.root, { recursive: true, force: true });
  }
}

test("a tree the map describes passes, and says what it compared", async () => {
  const tree = await fixture(CLEAN_TREE, baseMap());
  await withFixture(tree, () => {
    const result = tree.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 packages, 1 declared directories, 3 source files/u);
    assert.match(result.stdout, /cycles {6}: 0 among 3 modules and 0 relative value imports, with no allowed edges/u);
    assert.match(result.stdout, /module-map: the tree matches module-map\.json/u);
  });
});

test("rule (a): a directory that holds source and is not declared fails, and so does a declared directory that is not there", async () => {
  const undeclared = await fixture({ ...CLEAN_TREE, "packages/demo/src/emit/statements.ts": "export const emit = 1;\n" }, baseMap());
  await withFixture(undeclared, () => {
    const result = undeclared.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /packages\/demo\/src\/emit\/ holds source and module-map\.json does not declare it \(D115 §一\.2 — the path is the concept\)\./u);
    assert.match(result.stderr, /"directories": \{ "emit": "…" \}/u);
  });

  const map = baseMap();
  (map["packages"] as Record<string, { directories: Record<string, string> }>)["demo"]!.directories["emit"] = "Nothing, yet.";
  const missing = await fixture(CLEAN_TREE, map);
  await withFixture(missing, () => {
    const result = missing.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /module-map\.json declares packages\/demo\/src\/emit\/, and no source file sits directly in it\./u);
    assert.match(result.stderr, /A map that describes a directory that is not there is worse than no map\./u);
  });
});

test("rule (b): a file over the cap with no stated reason fails, and a stated reason for a file within the cap fails too", async () => {
  const oversized = await fixture(
    { ...CLEAN_TREE, "packages/demo/src/analysis/one.ts": paddedModule(810) },
    baseMap(),
    { ...BUDGET, files: { "packages/demo/src/analysis/one.ts": 810 } },
  );
  await withFixture(oversized, () => {
    const result = oversized.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /packages\/demo\/src\/analysis\/one\.ts is 810 lines, over the 800-line cap, and module-map\.json says nothing about why\./u);
    assert.match(result.stderr, /"compositionRoots": \{ "packages\/demo\/src\/analysis\/one\.ts": \{ "reason": "…", "segments": \{\} \} \}/u);
    assert.match(result.stderr, /"remainders": \{ "packages\/demo\/src\/analysis\/one\.ts": \{ "reason": "…" \} \}/u);
  });

  const map = baseMap();
  map["remainders"] = { "packages/demo/src/analysis/one.ts": { reason: "P9 will split it." } };
  const earned = await fixture(CLEAN_TREE, map, { ...BUDGET, files: { "packages/demo/src/analysis/one.ts": 810 } });
  await withFixture(earned, () => {
    const result = earned.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /module-map\.json lists packages\/demo\/src\/analysis\/one\.ts under "remainders", and it is 1 line — within the 800-line cap\./u);
    assert.match(result.stderr, /It has been earned back\./u);
  });
});

test("rule (b): the map and the file budget must name the same over-budget files, in both directions", async () => {
  // The budget exempts it and the map is silent: the number outlived the reason.
  const unexplained = await fixture({ ...CLEAN_TREE, "packages/demo/src/analysis/one.ts": paddedModule(810) }, baseMap(), {
    ...BUDGET,
    files: { "packages/demo/src/analysis/one.ts": 810 },
  });
  await withFixture(unexplained, () => {
    const result = unexplained.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /file-budget-allowlist\.json exempts packages\/demo\/src\/analysis\/one\.ts from the 800-line cap and module-map\.json gives no reason for it\./u);
  });

  // The map explains it and the budget does not exempt it: the reason outlived the number.
  const map = baseMap();
  map["remainders"] = { "packages/demo/src/analysis/one.ts": { reason: "P9 will split it." } };
  const unexempted = await fixture({ ...CLEAN_TREE, "packages/demo/src/analysis/one.ts": paddedModule(810) }, map);
  await withFixture(unexempted, () => {
    const result = unexempted.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /module-map\.json gives a reason for packages\/demo\/src\/analysis\/one\.ts and file-budget-allowlist\.json does not exempt it\./u);
    assert.match(result.stderr, /node scripts\/check-file-budget\.mjs --write/u);
  });

  // Named in both, and one of them a composition root: green.
  const agreed = baseMap();
  agreed["remainders"] = { "packages/demo/src/analysis/one.ts": { reason: "P9 will split it." } };
  const both = await fixture({ ...CLEAN_TREE, "packages/demo/src/analysis/one.ts": paddedModule(810) }, agreed, {
    ...BUDGET,
    files: { "packages/demo/src/analysis/one.ts": 810 },
  });
  await withFixture(both, () => {
    const result = both.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0 composition roots and 1 remainder \(one\.ts 810\)/u);
  });
});

test("rule (c): two modules that import each other fail, and the same pair joined by `import type` does not", async () => {
  const cycle = await fixture({
    ...CLEAN_TREE,
    "packages/demo/src/analysis/one.ts": "import { two } from \"./two.ts\";\nexport const one = two;\n",
    "packages/demo/src/analysis/two.ts": "import { one } from \"./one.ts\";\nexport const two = 2;\nexport const echo = one;\n",
  }, baseMap());
  await withFixture(cycle, () => {
    const result = cycle.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /packages\/demo\/src\/analysis\/ has an import cycle: one\.ts ↔ two\.ts\./u);
    assert.match(result.stderr, /协作者模块之间不得成环/u);
    assert.match(result.stderr, /`project\/scc\.ts`, `desktop\/window-kind\.ts`/u);
  });

  // A type-only edge is erased before anything runs, so it is not an edge.
  const typeOnly = await fixture({
    ...CLEAN_TREE,
    "packages/demo/src/analysis/one.ts": "import { two } from \"./two.ts\";\nexport type One = number;\nexport const one = two;\n",
    "packages/demo/src/analysis/two.ts": "import type { One } from \"./one.ts\";\nexport const two: One = 2;\n",
  }, baseMap());
  await withFixture(typeOnly, () => {
    const result = typeOnly.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /cycles {6}: 0 among 3 modules and 1 relative value imports/u);
  });
});

test("rule (c): a cycle that crosses two directories is reported as the crossing it is", async () => {
  const map = baseMap();
  (map["packages"] as Record<string, { directories: Record<string, string> }>)["demo"]!.directories["emit"] = "The emitter's collaborators.";
  const tree = await fixture({
    ...CLEAN_TREE,
    "packages/demo/src/analysis/one.ts": "import { emitted } from \"../emit/statements.ts\";\nexport const one = emitted;\n",
    "packages/demo/src/emit/statements.ts": "import { two } from \"../analysis/two.ts\";\nexport const emitted = two;\n",
    "packages/demo/src/analysis/two.ts": "import { one } from \"./one.ts\";\nexport const two = one;\n",
  }, map);
  await withFixture(tree, () => {
    const result = tree.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /packages\/demo\/src has an import cycle across 2 directories: packages\/demo\/src\/analysis\/one\.ts ↔ packages\/demo\/src\/analysis\/two\.ts ↔ packages\/demo\/src\/emit\/statements\.ts\./u);
  });
});

test("rule (c): an allowed edge that is not in the tree is an exemption nobody read", async () => {
  const map = baseMap();
  map["allowedCycles"] = [{ from: "packages/demo/src/analysis/one.ts", to: "packages/demo/src/analysis/two.ts", reason: "temporary" }];
  const tree = await fixture(CLEAN_TREE, map);
  await withFixture(tree, () => {
    const result = tree.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /module-map\.json allows the import packages\/demo\/src\/analysis\/one\.ts → packages\/demo\/src\/analysis\/two\.ts, and packages\/demo\/src\/analysis\/one\.ts does not import packages\/demo\/src\/analysis\/two\.ts\./u);
    assert.match(result.stderr, /Delete it from "allowedCycles"\./u);
  });
});

test("rule (d): a composition root is exempt from the file cap and not from the function cap", async () => {
  const map = baseMap();
  map["compositionRoots"] = {
    "packages/demo/src/analysis/one.ts": { reason: "State, seams, host constructors and dispatchers.", segments: {} },
  };
  const budget = { ...BUDGET, files: { "packages/demo/src/analysis/one.ts": 810 } };
  const grown = await fixture({ ...CLEAN_TREE, "packages/demo/src/analysis/one.ts": rootModule(810, 130) }, map, budget);
  await withFixture(grown, () => {
    const result = grown.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /packages\/demo\/src\/analysis\/one\.ts:\d+ Host\.dispatch is 130 lines, and packages\/demo\/src\/analysis\/one\.ts is a composition root\./u);
    assert.match(result.stderr, /It is not exempt from the 120-line/u);
    assert.match(result.stderr, /"segments": \{ "Host\.dispatch": \{ "role": "dispatcher", "ceiling": 130 \} \}/u);
  });

  // Named, with a role and a ceiling: the exemption D115's revision describes.
  const named = baseMap();
  named["compositionRoots"] = {
    "packages/demo/src/analysis/one.ts": {
      reason: "State, seams, host constructors and dispatchers.",
      segments: { "Host.dispatch": { role: "dispatcher", ceiling: 130 } },
    },
  };
  const declared = await fixture({ ...CLEAN_TREE, "packages/demo/src/analysis/one.ts": rootModule(810, 130) }, named, budget);
  await withFixture(declared, () => {
    const result = declared.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /segments {4}: 1 function over 120 lines inside a composition root/u);
  });

  // …and the same segment back under the cap has to leave the list.
  const shrunk = await fixture({ ...CLEAN_TREE, "packages/demo/src/analysis/one.ts": rootModule(810, 100) }, named, budget);
  await withFixture(shrunk, () => {
    const result = shrunk.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /module-map\.json names "Host\.dispatch" as a segment of packages\/demo\/src\/analysis\/one\.ts, and it is 100 lines — within the 120-line cap\./u);
    assert.match(result.stderr, /An empty `segments` is what a composition root is supposed to look like\./u);
  });
});

test("rule (e): the document has to name what the roster declares", async () => {
  const tree = await fixture({ ...CLEAN_TREE, [DOCUMENT]: "# Module map\n\nNothing here yet.\n" }, baseMap());
  await withFixture(tree, () => {
    const result = tree.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /docs\/contributing\/module-map\.md does not name packages\/demo\/src\/analysis\/, and module-map\.json declares it\./u);
  });
});

test("a roster that is not the shape this gate reads fails before it compares anything", async () => {
  const map = baseMap();
  map["compositionRoots"] = { "packages/demo/src/analysis/one.ts": { reason: "…", segments: { "Host.dispatch": { role: "collaborator", ceiling: 130 } } } };
  const tree = await fixture(CLEAN_TREE, map);
  await withFixture(tree, () => {
    const result = tree.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\.role must be "host-constructor" or "dispatcher" — D115's revision exempts those two shapes and no others/u);
  });
});

test("a tree with no source under packages/*/src is a green run that read nothing, and says so", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-module-map-"));
  try {
    await writeFile(join(root, "module-map.json"), `${JSON.stringify(baseMap(), null, 2)}\n`, "utf8");
    const result = spawnSync(process.execPath, [gatePath, "--root", root], { cwd: repositoryRoot, encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has no TypeScript under packages\/\*\/src; this gate would pass by reading nothing\./u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
