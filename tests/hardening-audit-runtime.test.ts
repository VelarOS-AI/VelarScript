import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "@velarscript/compiler";

// Wave N-2b-2 (audit fix wave, CLI + runtime): regressions for the module
// system's check-passes-then-crashes family (MOD-D1/D2/D3, MOD-I1/I3/I4/I5,
// MOD-U2/U5/U6/U8, BRG-D1), the test runner's unified unowned-error stance
// (ASY-D2 + BLD-D1), race's runtime-empty guard (ASY-U1), the web-config
// teaching (BLD-U1), the collections runtime (COL-D1/D2, COL-I2,
// COL-U1/U2/U3/U4/U8/U9/U10), code-point string ordering (TXT-D1), the
// spelling and format-spec teachings (TXT-I1/I2), and the bridge edge
// closures (BRG-N1/N2, BRG-U2/U3/U6/U10).

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

/** Compiles cleanly and runs to completion; returns stdout. */
function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => item.message), [], source);
  assert.ok(result.code, source);
  const execution = executeModule(result.code);
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

function rejects(source: string, code: string, pattern: RegExp): void {
  const result = compile(source.trimStart());
  assert.equal(result.code, null, source);
  const matched = result.diagnostics.find((item) => item.code === code && pattern.test(item.message));
  assert.ok(
    matched,
    `${source}\nexpected ${code} ${String(pattern)}, received ${JSON.stringify(result.diagnostics.map((item) => `${item.code}: ${item.message}`))}`,
  );
}

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Writes a fixture tree to disk and runs one CLI command over it. */
async function runCli(
  files: Readonly<Record<string, string>>,
  command: readonly string[],
  prepare?: (directory: string) => Promise<void>,
): Promise<CliResult> {
  const directory = await mkdtemp(join(tmpdir(), "velar-audit-runtime-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      const path = join(directory, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text, "utf8");
    }
    await prepare?.(directory);
    const execution = spawnSync(process.execPath, [cliPath, ...command.map((part) => part.replace("<dir>", directory))], {
      encoding: "utf8",
      timeout: 180_000,
      cwd: directory,
    });
    return { status: execution.status, stdout: String(execution.stdout), stderr: String(execution.stderr) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// A. Module system.
// ---------------------------------------------------------------------------

test("[MOD-D1] the whole module-boundary family is module-top-level only", () => {
  // A function-body import used to bind `unknown` (the dependency walk reads
  // program.body only); block-level export forms emitted invalid JavaScript.
  rejects("def f() -> number:\n    import {x} from \"./lib.vel\"\n    return 1\nprint(str(f()))\n", "VEL3011", /Imports can only be declared at module scope/u);
  rejects("if true:\n    export const flag = 1\nprint(\"k\")\n", "VEL3011", /Exports can only be declared at module scope/u);
  rejects("if true:\n    export def f() -> number:\n        return 1\nprint(\"k\")\n", "VEL3011", /Exports can only be declared at module scope/u);
  rejects("if true:\n    export {a} from \"./lib.vel\"\nprint(\"k\")\n", "VEL3011", /Exports can only be declared at module scope/u);
  rejects("if true:\n    import js {x} from \"some-lib\"\nprint(\"k\")\n", "VEL3011", /Imports can only be declared at module scope/u);
  rejects(`
if true:
    extern module "some-lib":
        export const version: string
print("k")
`, "VEL3011", /Extern modules can only be declared at module scope/u);
});

test("[MOD-D2] two spellings of one module file are rejected instead of silently double-instantiating", async () => {
  const result = await runCli({
    "store.vel": "export let count = 0\nprint(\"store init\")\n",
    "main.vel": "import {count} from \"./store.vel\"\nimport {count as other} from \"./Store.vel\"\nprint(str(count))\n",
  }, ["check", "<dir>/main.vel"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  // On a case-insensitive filesystem the second spelling resolves to the same
  // file (VEL6005); on a case-sensitive one it simply does not exist
  // (VEL6001 with the near-name suggestion). Both refuse with a position.
  assert.match(result.stderr, /VEL600[15]/u);
  assert.match(result.stderr, /main\.vel:2:/u);
  assert.doesNotMatch(result.stderr, /store init/u);
});

test("[MOD-D3] self-import is rejected at the import instead of crashing with a raw ReferenceError", async () => {
  const result = await runCli({
    "self3.vel": "export const a = 1\nimport {a as b} from \"./self3.vel\"\nprint(str(b))\n",
  }, ["run", "<dir>/self3.vel"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /VEL6004/u);
  assert.match(result.stderr, /A module cannot import from itself; use the declaration directly/u);
  assert.doesNotMatch(result.stderr, /ReferenceError/u);
});

test("[MOD-U8] self re-export is rejected teaching declare-under-the-exported-name", async () => {
  const result = await runCli({
    "barrel.vel": "export const a = 1\nexport {a as b} from \"./barrel.vel\"\n",
  }, ["check", "<dir>/barrel.vel"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /VEL6004/u);
  assert.match(result.stderr, /A module cannot re-export from itself; declare the binding under the exported name/u);
});

test("[MOD-I1] velar check prints module diagnostics alongside resolution failures", async () => {
  const result = await runCli({
    "lib.vel": "export const present = 1\n",
    "main.vel": "import {missing} from \"./lib.vel\"\nconst bad: number = \"text\"\nprint(str(bad))\n",
  }, ["check", "<dir>/main.vel"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /has no export named 'missing'/u);
  // The diagnostic black hole: this used to be swallowed by the failure exit.
  assert.match(result.stderr, /Cannot assign string to number/u);
});

test("[MOD-I1 + BRG-D1] a recovered import never fabricates an empty-source dependency", async () => {
  // `import type` and `import unsafe` (forgot js) both died behind "invalid
  // package name ''" while the parser's own diagnostics were generated and
  // hidden. D50 rule 100 later gave `import type` its own teaching, so the two
  // spellings now differ in message but agree on naming a real module.
  for (const line of ["import type {User} from \"./lib.vel\"", "import unsafe {x} from \"./lib.vel\""]) {
    const result = await runCli({
      "lib.vel": "export const x = 1\n",
      "main.vel": `${line}\nprint("k")\n`,
    }, ["check", "<dir>/main.vel"]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.doesNotMatch(result.stderr, /invalid package name/u);
    assert.match(result.stderr, /VEL20(01|29)/u);
  }
  // `import type` recovers as the ordinary import the teaching names, so its
  // dependency is that module — never the empty source.
  const compiled = compile("import type {User} from \"./lib.vel\"\nprint(\"k\")\n");
  assert.deepEqual(compiled.dependencies, [{
    source: "./lib.vel",
    span: { start: 24, end: 35 },
    javascript: false,
    unsafe: false,
    dynamic: false,
    specifiers: [{ imported: "User", local: "User", namespace: false }],
  }]);
});

test("[MOD-I3] assigning an imported binding says imported, names the module, and keeps the reactive rewrite", async () => {
  const result = await runCli({
    "lib.vel": "export let level = 1\n",
    "main.vel": "import {level} from \"./lib.vel\"\nlevel = 2\nprint(str(level))\n",
  }, ["check", "<dir>/main.vel"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Cannot assign to imported binding 'level'; imports are read-only\. Change the value in its owning module \("\.\/lib\.vel"\)/u);
  assert.doesNotMatch(result.stderr, /const binding 'level'/u);
});

test("[MOD-I4] import/local collisions blame the later declaration and name the earlier one's origin", () => {
  // Local first, import later: the import is the later declaration.
  const importLater = compile("const x = 1\nimport {x} from \"./lib.vel\"\nprint(str(x))\n");
  const later = importLater.diagnostics.find((item) => item.code === "VEL3004");
  assert.ok(later, JSON.stringify(importLater.diagnostics));
  assert.match(later.message, /Import 'x' collides with the earlier declaration in this module; alias it — import \{x as other\} from "\.\/lib\.vel"/u);
  // Import first, local later: the local is blamed and the import's source named.
  const localLater = compile("import {x} from \"./lib.vel\"\nconst x = 1\nprint(str(x))\n");
  const local = localLater.diagnostics.find((item) => item.code === "VEL3004");
  assert.ok(local, JSON.stringify(localLater.diagnostics));
  assert.match(local.message, /Name 'x' is already imported from "\.\/lib\.vel"; rename this declaration, or alias the import/u);
  // Two imports of one name.
  const twice = compile("import {x} from \"./a.vel\"\nimport {x} from \"./b.vel\"\nprint(str(x))\n");
  const second = twice.diagnostics.find((item) => item.code === "VEL3004");
  assert.ok(second, JSON.stringify(twice.diagnostics));
  assert.match(second.message, /Name 'x' is already imported from "\.\/a\.vel"; alias one of the imports/u);
});

test("[MOD-I5 + MOD-U5] a missing module is an owned positional diagnostic with the nearest on-disk name", async () => {
  const result = await runCli({
    "store.vel": "export const count = 1\n",
    "main.vel": "import {count} from \"./stor.vel\"\nprint(str(count))\n",
  }, ["check", "<dir>/main.vel"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /main\.vel:1:\d+ error VEL6001: Module "\.\/stor\.vel" does not exist; did you mean "\.\/store\.vel"\?/u);
  assert.doesNotMatch(result.stderr, /ENOENT/u);
});

test("[MOD-U5] absolute paths and bare .vel specifiers each teach the relative spelling", async () => {
  const absolute = await runCli({
    "main.vel": "import {x} from \"/somewhere/lib.vel\"\nprint(\"k\")\n",
  }, ["check", "<dir>/main.vel"]);
  assert.equal(absolute.status, 1);
  assert.match(absolute.stderr, /VEL6002: Module paths are relative to the importing file; write '\.\/name\.vel'/u);
  const bare = await runCli({
    "lib.vel": "export const x = 1\n",
    "main.vel": "import {x} from \"lib.vel\"\nprint(str(x))\n",
  }, ["check", "<dir>/main.vel"]);
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /VEL6002: Import "\.\/lib\.vel"; a module path without '\.\/' names an installed package, not a file/u);
});

test("[MOD-U6] an unknown velar/* module lists the standard modules with a near-name suggestion", async () => {
  const result = await runCli({
    "main.vel": "import {sha256Text} from \"velar/hashh\"\nprint(\"k\")\n",
  }, ["check", "<dir>/main.vel"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /VEL6003: Unknown standard module "velar\/hashh"; did you mean "velar\/hash"\?/u);
  assert.match(result.stderr, /velar\/json/u);
  assert.doesNotMatch(result.stderr, /subpaths are not supported/u);
});

test("[MOD-U2] default import and export both teach the named forms", async () => {
  rejects("export default def f() -> number:\n    return 1\n", "VEL2001", /VelarScript modules have no default export; export the declaration by name/u);
  const importDefault = await runCli({
    "lib.vel": "export const x = 1\n",
    "main.vel": "import lib from \"./lib.vel\"\nprint(\"k\")\n",
  }, ["check", "<dir>/main.vel"]);
  assert.equal(importDefault.status, 1);
  assert.match(importDefault.stderr, /VelarScript modules have no default export; import the names you need — import \{name\} from "\.\/lib\.vel"/u);
});

// ---------------------------------------------------------------------------
// B. Test-runner trust and configuration teaching.
// ---------------------------------------------------------------------------

test("[ASY-D2 + BLD-D1] any unowned error during a test fails that test; the runner continues and exits nonzero", async () => {
  // The blind pilot's shape: a headless test imports a module whose
  // initialization schedules DOM work. The error reaches the host channel,
  // not the test's await chain — and the suite used to stay green.
  const domInit = await runCli({
    "node_modules/dom-toucher/package.json": JSON.stringify({ name: "dom-toucher", type: "module", exports: "./index.js" }),
    "node_modules/dom-toucher/index.js": "export const ready = true;\nPromise.resolve().then(() => { globalThis.document.createElement(\"div\"); });\n",
    "app.vel": "extern module \"dom-toucher\":\n    export const ready: bool\n\nimport js {ready} from \"dom-toucher\"\n\nexport def isReady() -> bool:\n    return ready\n",
    "app.test.vel": "import {isReady} from \"./app.vel\"\n\ntest \"the app is ready\":\n    assert isReady()\n",
  }, ["test", "<dir>/app.test.vel"]);
  assert.equal(domInit.status, 1, domInit.stdout + domInit.stderr);
  assert.match(domInit.stdout, /0 passed, 1 failed/u);
  assert.match(domInit.stderr, /unowned error/u);
  assert.match(domInit.stderr, /createElement/u);

  // The timer variant of the same shape may land during a test or after the
  // last one; either way the run reports it and exits nonzero.
  const timerInit = await runCli({
    "node_modules/dom-timer/package.json": JSON.stringify({ name: "dom-timer", type: "module", exports: "./index.js" }),
    "node_modules/dom-timer/index.js": "export const ready = true;\nsetTimeout(() => { globalThis.document.createElement(\"div\"); }, 0);\n",
    "app.vel": "extern module \"dom-timer\":\n    export const ready: bool\n\nimport js {ready} from \"dom-timer\"\n\nexport def isReady() -> bool:\n    return ready\n",
    "app.test.vel": "import {isReady} from \"./app.vel\"\n\ntest \"the app is ready\":\n    assert isReady()\n",
  }, ["test", "<dir>/app.test.vel"]);
  assert.equal(timerInit.status, 1, timerInit.stdout + timerInit.stderr);
  assert.match(timerInit.stdout, /1 failed/u);
  assert.match(timerInit.stderr, /unowned error/u);

  // A detached failure during one test fails that test; later tests still run.
  const detached = await runCli({
    "boom.test.vel": "async def boom():\n    throw Error(\"detached failure\")\n\ntest \"green\":\n    detach boom()\n\ntest \"still runs\":\n    pass\n",
  }, ["test", "<dir>/boom.test.vel"]);
  assert.equal(detached.status, 1, detached.stdout + detached.stderr);
  assert.match(detached.stderr, /green/u);
  assert.match(detached.stderr, /an unowned error was reported while this test ran/u);
  assert.match(detached.stdout, /✓.*still runs/u);
  assert.match(detached.stdout, /1 passed, 1 failed/u);
});

test("[ASY-U1] a runtime-empty race List throws RangeError instead of hanging forever", async () => {
  const result = await runCli({
    "main.vel": `
def empty() -> List<Promise<null>>:
    return []

try:
    const winner = await Promise.race(empty())
    print("settled")
catch error:
    print("caught: " + error.message)
`.trimStart(),
  }, ["run", "<dir>/main.vel"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /caught: race requires at least one Promise/u);
});

test("[BLD-U1] configuration diagnostics teach a complete valid web manifest", async () => {
  // No velar.json anywhere near the working directory.
  const missing = await runCli({}, ["check"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /velar\.json was not found/u);
  assert.match(missing.stderr, /"formatVersion": 2/u);
  assert.match(missing.stderr, /"extensions": \["@velarscript\/web"\]/u);
  // A manifest without formatVersion teaches the same complete example.
  const incomplete = await runCli({
    "velar.json": JSON.stringify({ entry: "src/main.vel", extensions: [] }),
    "src/main.vel": "print(\"k\")\n",
  }, ["check", "<dir>"]);
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stderr, /'formatVersion' is required/u);
  assert.match(incomplete.stderr, /"extensions": \["@velarscript\/web"\]/u);
  // The example teaches dropping the key for a Node/CLI project, so a manifest
  // that follows the teaching has to check — not report a second error.
  assert.match(missing.stderr, /\(drop "extensions" for a Node\/CLI project\)/u);
  const core = await runCli({
    "velar.json": JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }),
    "src/main.vel": "print(\"k\")\n",
  }, ["check", "<dir>"]);
  assert.equal(core.status, 0, core.stdout + core.stderr);
  // Only an absent key is the empty list; a malformed one still teaches.
  const malformed = await runCli({
    "velar.json": JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: null }),
    "src/main.vel": "print(\"k\")\n",
  }, ["check", "<dir>"]);
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /'extensions' must be a list of installed package names/u);
});

// ---------------------------------------------------------------------------
// C. Collections runtime.
// ---------------------------------------------------------------------------

test("[COL-D1] removing an unvisited key during two-slot Record iteration skips it (Map parity)", () => {
  const output = run(`
const r: Record<number> = {a: 1, b: 2, c: 3}
for key, value in r:
    if key == "a":
        r.remove("c")
    print(key + str(value))
print("done")
`);
  assert.equal(output, "a1\nb2\ndone\n");
});

test("[COL-D2] spreading a named record into a Record context is rejected like the direct assignment", () => {
  rejects(`
type User:
    name: string

const raw: unknown = {name: "n", age: 39}
assert raw is User
const u = raw
const bag: Record<string> = {...u}
print(str(bag.size))
`, "VEL4001", /Cannot spread User into a Record value: a named record is open.*copy the declared fields explicitly — \{name: value\.name\}/u);
});

test("[COL-I2] every List position error is a catchable IndexError, and insert states the 0..size bound", () => {
  const output = run(`
const v = [1, 2, 3]
try:
    const s = v.slice(0.5)
    print("no")
catch error:
    if error is IndexError:
        print("slice: " + error.message)
let w = [1, 2, 3]
try:
    w.insert(-1, 9)
catch error:
    if error is IndexError:
        print("insert: " + error.message)
try:
    w.insert(9, 0)
catch error:
    if error is IndexError:
        print("high: " + error.message)
`);
  assert.equal(output, [
    "slice: List.slice positions must be integers",
    "insert: List.insert index must be an integer from 0 through size",
    "high: List.insert index must be an integer from 0 through size",
    "",
  ].join("\n"));
});

test("[COL-U1] flatMap maps then flattens one level and requires a List-returning transform", () => {
  const output = run(`
const v = [[1, 2], [3]]
const flat = v.flatMap(x => x)
print(str(flat.sum()))
const words = ["a b", "c"]
print(words.flatMap(w => w.split(" ")).join(","))
`);
  assert.equal(output, "6\na,b,c\n");
  rejects("const v = [1, 2]\nconst out = v.flatMap(x => x + 1)\nprint(str(out.size))\n", "VEL4001", /List\.flatMap transform must return a List, received number; use map for one-value transforms/u);
});

test("[COL-U2] Set union/intersection/difference copy and leave both operands untouched", () => {
  const output = run(`
const a = Set([1, 2, 3])
const b = Set([2, 3, 4])
print(str(a.union(b).size))
print(str(a.intersection(b).size))
print(str(a.difference(b).size))
print(str(a.size) + str(b.size))
`);
  assert.equal(output, "4\n2\n1\n33\n");
  // The element domains must intersect — the same per-member `==` question.
  rejects(`
enum Status:
    open
const a = Set([Status.open])
const b = Set(["open"])
print(str(a.union(b).size))
`, "VEL4001", /enum and string domains never meet in 'Set\.union'/u);
});

test("[COL-U3] filter(x => x != null) — exactly that predicate — narrows List<T?> to List<T>", () => {
  // join requires List<string>, so compiling is the narrowing proof.
  const output = run(`
const v: List<string?> = ["a", null, "b"]
print(v.filter(x => x != null).join(","))
`);
  assert.equal(output, "a,b\n");
  const indexed = run(`
const v: List<string?> = ["a", null, "b"]
print(v.filter((x, index) => x != null).join(","))
`);
  assert.equal(indexed, "a,b\n");
  // Any other predicate shape keeps the optional element type.
  rejects(`
const v: List<string?> = ["a", null]
print(v.filter(x => not (x == null)).join(","))
`, "VEL4001", /List\.join requires List<string>/u);
});

test("[COL-U4] a frozen host array teaches the copy-on-the-JavaScript-side workflow", async () => {
  const result = await runCli({
    "node_modules/frozen-feed/package.json": JSON.stringify({ name: "frozen-feed", type: "module", exports: "./index.js" }),
    "node_modules/frozen-feed/index.js": "export const values = Object.freeze([1, 2, 3]);\n",
    "main.vel": `
extern module "frozen-feed":
    export const values: List<number>

import js {values} from "frozen-feed"

try:
    print(str(values.sum()))
catch error:
    print("caught: " + error.message)
`.trimStart(),
  }, ["run", "<dir>/main.vel"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /caught: .*received a frozen JavaScript array; copy it on the JavaScript side — \[\.\.\.values\]/u);
});

test("[COL-U8] List() and Array() in value position teach the literal", () => {
  rejects("const v = List()\nprint(\"k\")\n", "VEL3008", /Lists are created with a '\[\]' literal.*'List<T>' is a type name, not a constructor/u);
  rejects("const v = Array()\nprint(\"k\")\n", "VEL3008", /Use a '\[\]' List literal/u);
});

test("[COL-U9] List transforms and predicates expose the stable snapshot index", () => {
  const output = run(`
const values = ["a", "b", "c"]
def label(value: string, index: number) -> string: return value + str(index)
def keep(value: string) -> bool: return value != "b"
print(values.map((value, index) => value + str(index)).join(","))
print(values.map(transform=label).join(","))
print(values.filter(test=keep).join(","))
print(values.filter((value, index) => index % 2 == 0).join(","))
print(str(values.some((value, index) => index == 1)))
print(str(values.every((value, index) => index < 3)))
print(values.find((value, index) => index == 1) ?? "missing")
print(values.flatMap((value, index) => [value, str(index)]).join(","))
`);
  assert.equal(output, "a0,b1,c2\na0,b1,c2\na,c\na,c\ntrue\ntrue\nb\na,0,b,1,c,2\n");
  rejects(`
const values = ["a"]
print(values.map((value, index, extra) => value).join(","))
`, "VEL4001", /Cannot assign|parameter/u);
});

test("[COL-U10] cross-collection mismatches teach the bridge spellings", () => {
  rejects("def wants(values: List<number>) -> number:\n    return values.size\nconst s = Set([1])\nprint(str(wants(s)))\n", "VEL4001", /Set\.values\(\) returns the members as a List/u);
  rejects("def wants(values: List<string>) -> number:\n    return values.size\nconst m: Map<string, number> = Map()\nm.set(\"a\", 1)\nprint(str(wants(m)))\n", "VEL4001", /Map\.keys\(\), Map\.values\(\), or Map\.entries\(\)/u);
  rejects("def wants(values: Set<number>) -> number:\n    return values.size\nprint(str(wants([1, 2])))\n", "VEL4001", /Set\(values\) builds a Set from a List/u);
  rejects("def wants(values: Map<string, number>) -> number:\n    return values.size\nconst r: Record<number> = {a: 1}\nprint(str(wants(r)))\n", "VEL4001", /Map\(record\) builds a string-keyed Map from a record/u);
});

// ---------------------------------------------------------------------------
// D. Text.
// ---------------------------------------------------------------------------

test("[TXT-D1] ordered string comparison is code-point order on every surface", () => {
  // U+FFFD (one code unit) versus U+1F525 (a surrogate pair): UTF-16 code
  // units said false; code points say true.
  const output = run(`
print(str("�" < "\u{1F525}"))
print(["z", "\u{1F525}", "�"].sorted().join(","))
const v = ["\u{1F525}", "�"]
print(str(v.min()) + "|" + str(v.max()))
const rows = [{k: "\u{1F525}"}, {k: "�"}]
print(rows.sorted(by=row => row.k).map(row => row.k).join(","))
print(str("�" <= "\u{1F525}"))
`);
  assert.equal(output, `true\nz,�,\u{1F525}\n�|\u{1F525}\n�,\u{1F525}\ntrue\n`);
});

test("[TXT-D1] sorted(by=)/min(by=)/max(by=) use the same code-point order", async () => {
  const result = await runCli({
    "main.vel": `
type Row:
    label: string

const rows: List<Row> = [{label: "\u{1F525}"}, {label: "�"}]
const ordered = rows.sorted(by=row => row.label)
print(ordered.map(row => row.label).join(","))
const low = rows.min(by=row => row.label)
const high = rows.max(by=row => row.label)
assert low != null
assert high != null
print(low.label + "|" + high.label)
`.trimStart(),
  }, ["run", "<dir>/main.vel"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, `�,\u{1F525}\n�|\u{1F525}\n`);
});

test("[TXT-I1] the spelling guidance table covers the Python column", () => {
  rejects("print(str(len(\"abc\")))\n", "VEL3008", /Use 'value\.size'; strings and collections measure with the size member/u);
  rejects("print(\"  a \".strip())\n", "VEL4001", /Use '\.trim\(\)'/u);
  rejects("print(\"a\".lstrip())\n", "VEL4001", /Use Text\.trimStart\(value\); string operations beyond the core members live in the Text namespace, which needs no import/u);
  rejects("print(\"a\".rstrip())\n", "VEL4001", /Use Text\.trimEnd\(value\); string operations beyond the core members live in the Text namespace, which needs no import/u);
  rejects("print(str(\"ab\".startswith(\"a\")))\n", "VEL4001", /Use '\.startsWith\(text\)'/u);
  rejects("print(str(\"ab\".endswith(\"b\")))\n", "VEL4001", /Use '\.endsWith\(text\)'/u);
  rejects("print(str(\"ab\".find(\"b\")))\n", "VEL4001", /Use '\.index\(text, start\)'; missing text returns null instead of -1/u);
  rejects("print(str(\"a\\nb\".splitlines().size))\n", "VEL4001", /Use Text\.lines\(value\); it splits on line boundaries, and the Text namespace needs no import/u);
  rejects("print(\"AB\".casefold())\n", "VEL4001", /Use '\.lower\(\)'/u);
  rejects("print(\"hi {}\".format(1))\n", "VEL4001", /Use an f-string/u);
  rejects("print(\"ab\".title())\n", "VEL4001", /Use Text\.title\(value\); string operations beyond the core members live in the Text namespace, which needs no import/u);
  rejects("print(\"ab\".capitalize())\n", "VEL4001", /Use Text\.capitalize\(value\); string operations beyond the core members live in the Text namespace, which needs no import/u);
  rejects("print(str(\"ab\".lastIndexOf(\"b\")))\n", "VEL4001", /VelarScript has no reverse string search member/u);
  rejects("print(str(number(\"5\")))\nprint(str(parseInt(\"5\")))\n", "VEL3008", /Use 'number\(text\)', then '\.floor\(\)' or '\.round\(\)'/u);
  rejects("print(str(parseFloat(\"5.5\")))\n", "VEL3008", /Use 'number\(text\)'; VelarScript has one text-to-number conversion/u);
  // "ab".toString() teaches exactly like (5).toString() already does.
  rejects("print(\"ab\".toString())\n", "VEL4001", /Use 'str\(value\)' or an f-string; VelarScript has one explicit text conversion spelling/u);
});

test("[TXT-I2] a top-level ':' in an f-string interpolation gets one directed format-spec diagnostic", () => {
  const result = compile("const x = 3.14159\nprint(f\"{x:.2f}\")\n");
  const messages = result.diagnostics.map((item) => `${item.code}: ${item.message}`);
  assert.ok(messages.some((message) => /VEL2009: An interpolation holds one expression; VelarScript has no ':' format specs\. Format the value first — value\.toFixed\(2\) for fixed decimals/u.test(message)), JSON.stringify(messages));
  // No numeric-unit cascade from the spec text.
  assert.ok(!messages.some((message) => /Unknown numeric unit/u.test(message)), JSON.stringify(messages));
  // The one taught spelling works; ternaries inside interpolations still parse.
  const output = run("const x = 3.14159\nprint(f\"{x.toFixed(2)}\")\nconst flag = true\nprint(f\"{flag ? \"y\" : \"n\"}\")\n");
  assert.equal(output, "3.14\ny\n");
});

// ---------------------------------------------------------------------------
// E. Bridge.
// ---------------------------------------------------------------------------

test("[BRG-N1] an extern block owns the source contract, so an undeclared imported name is a check error", () => {
  rejects(`
extern module "some-lib":
    export const version: string

import js {version, mystery} from "some-lib"
print(version)
`, "VEL4001", /Extern module 'some-lib' does not declare 'mystery'; add it to the extern block, or fix the imported name/u);
});

test("[BRG-N2] the extern member rejection lists export class among the legal forms", () => {
  rejects(`
extern module "some-lib":
    export version: string
print("k")
`, "VEL2010", /export def.*export const name: Type.*export class Name:/u);
});

test("[BRG-U2] bare import js specifiers resolve at check time in both directions", async () => {
  const missing = await runCli({
    "main.vel": "import js {x} from \"not-a-real-package-xyz\"\nprint(\"k\")\n",
  }, ["check", "<dir>/main.vel"]);
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /VEL6006: JavaScript package import "not-a-real-package-xyz" does not resolve to an installed package/u);

  const velThroughJs = await runCli({
    "node_modules/vel-widgets/package.json": JSON.stringify({ name: "vel-widgets", velar: { entry: "index.vel", targets: ["web"], requires: { capabilities: ["web"] } } }),
    "node_modules/vel-widgets/index.vel": "export const banner = \"w\"\n",
    "main.vel": "import js {banner} from \"vel-widgets\"\nprint(\"k\")\n",
  }, ["check", "<dir>/main.vel"]);
  assert.equal(velThroughJs.status, 1, velThroughJs.stdout + velThroughJs.stderr);
  assert.match(velThroughJs.stderr, /VEL6006: 'vel-widgets' is a VelarScript package; import it without 'js' — import \{name\} from "vel-widgets"/u);
});

test("[BRG-U3] a types entry pointing at an unreadable file fires the polite degradation notice", async () => {
  const result = await runCli({
    "node_modules/broken-types/package.json": JSON.stringify({ name: "broken-types", type: "module", exports: "./index.js", types: "./missing.d.ts" }),
    "node_modules/broken-types/index.js": "export const value = 1;\n",
    "main.vel": "import js {value} from \"broken-types\"\nprint(\"k\")\n",
  }, ["check", "<dir>/main.vel"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /notice: broken-types: package 'broken-types' declares types '\.\/missing\.d\.ts', but that is not a readable declaration file inside the package; the import is typed as unknown/u);
});

test("[BRG-U6] generic extern classes get the polite rejection and extern extends teaches constructor redeclaration", () => {
  rejects(`
extern module "some-lib":
    export class Box<T>:
        constructor(value: string)
        def read() -> unknown
print("k")
`, "VEL2025", /Extern class 'Box' cannot declare type parameters; declare the class without them and use generic 'def' members or 'unknown'/u);
  rejects(`
extern module "some-lib":
    export class Base:
        constructor(name: string)
        def read() -> string

    export class Derived extends Base:
        pass

import js {Derived} from "some-lib"
const value = Derived("x")
print("k")
`, "VEL4001", /extern constructors are not inherited from the base class; redeclare 'constructor\(\.\.\.\)' on 'Derived' with the base signature/u);
});

test("[BRG-U10] a top-level synchronous non-Error throw from an extern call reaches the host as a normalized Error", async () => {
  const result = await runCli({
    "node_modules/angry-lib/package.json": JSON.stringify({ name: "angry-lib", type: "module", exports: "./index.js" }),
    "node_modules/angry-lib/index.js": "export function explode() { throw \"boom\"; }\n",
    "main.vel": `
extern module "angry-lib":
    export def explode() -> null

import js {explode} from "angry-lib"

explode()
print("unreached")
`.trimStart(),
  }, ["run", "<dir>/main.vel"]);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  // Normalized through the owned channel: an Error whose message is the
  // thrown string, never the raw unowned value shape.
  assert.match(result.stderr, /Error: boom/u);
});

// ---------------------------------------------------------------------------
// Case sensitivity note for MOD-D2: on a case-insensitive filesystem the
// duplicate-spelling probe exercises the canonical-identity rejection; the
// assertion above accepts the missing-file answer on case-sensitive hosts so
// the suite stays portable. The canonical-identity path is additionally
// pinned here through a same-case link when the platform can create one.
// ---------------------------------------------------------------------------

test("[MOD-D2] the canonical-identity rejection names both spellings when the filesystem folds case", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "velar-audit-case-"));
  try {
    await writeFile(join(directory, "store.vel"), "export const count = 1\n", "utf8");
    if (!existsSync(join(directory, "STORE.VEL"))) {
      context.skip("case-sensitive filesystem");
      return;
    }
    await writeFile(join(directory, "main.vel"), "import {count} from \"./store.vel\"\nimport {count as other} from \"./Store.vel\"\nprint(str(count + other))\n", "utf8");
    const execution = spawnSync(process.execPath, [cliPath, "check", join(directory, "main.vel")], { encoding: "utf8", timeout: 120_000 });
    assert.equal(execution.status, 1, String(execution.stdout) + String(execution.stderr));
    assert.match(String(execution.stderr), /VEL6005/u);
    assert.match(String(execution.stderr), /names the same file as/u);
    assert.match(String(execution.stderr), /one spelling/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
