import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../../packages/cli/src/project.ts";

/**
 * D114 MD-I4: the circular-module-dependency report went through the advisory
 * channel and into the advisory count under a `VELxxxx` code, and
 * `diagnostic.ts` says in as many words that an advisory id is "deliberately
 * not the VELxxxx family". The repository contract gives an author exactly two
 * ways to resolve an advisory — change the spelling, or write
 * `// velar-allow <CODE>: <reason>` — and the second was refused by the very
 * compiler that printed the code: `velar-allow VEL6010` answered "must name the
 * advisory it suppresses". It is `A18` now.
 */

interface Reports {
  readonly diagnostics: readonly string[];
  readonly advisories: readonly string[];
}

async function project(files: Readonly<Record<string, string>>, entry = "main.vel"): Promise<Reports> {
  const directory = await mkdtemp(join(tmpdir(), "velar-a18-"));
  try {
    for (const [name, source] of Object.entries(files)) await writeFile(join(directory, name), source, "utf8");
    const compiled = await compileProject(join(directory, entry), new Map(), {});
    return {
      diagnostics: compiled.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`)),
      advisories: compiled.modules.flatMap((module) => module.result.advisories.map((item) => `${item.code} ${item.message}`)),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("[CO-C3] a cycle is one A18, on the import that closes it", async () => {
  const reports = await project({
    "main.vel": 'import {fromB} from "./b.vel"\n\nexport def fromA() -> string: return "a"\n\nprint(fromB())\n',
    "b.vel": 'import {fromA} from "./main.vel"\n\nexport def fromB() -> string: return fromA()\n',
  });
  assert.deepEqual(reports.diagnostics, []);
  assert.deepEqual(reports.advisories, [
    "A18 Circular module dependency includes b.vel, main.vel; extract shared contracts into a lower-level module"
    + " so dependencies flow in one direction",
  ]);
});

test("[CO-C3] a three-module cycle is still one A18", async () => {
  const reports = await project({
    "main.vel": 'import {fromB} from "./b.vel"\n\nexport def fromA() -> string: return "a"\n\nprint(fromB())\n',
    "b.vel": 'import {fromC} from "./c.vel"\n\nexport def fromB() -> string: return fromC()\n',
    "c.vel": 'import {fromA} from "./main.vel"\n\nexport def fromC() -> string: return fromA()\n',
  });
  assert.deepEqual(reports.diagnostics, []);
  assert.deepEqual(reports.advisories, [
    "A18 Circular module dependency includes b.vel, c.vel, main.vel; extract shared contracts into a lower-level"
    + " module so dependencies flow in one direction",
  ]);
});

test("[CO-C3] one 'velar-allow A18' answers the whole cycle", async () => {
  // The charter's contract: A18 is the graph's advisory, raised once the graph
  // is read, and answered by one comment on the import that closes the cycle.
  // Writing N reasons for one fact was what left N-1 of them rotting the moment
  // the cycle shrank — the shape CO-I2 reports as stale below.
  //
  // Reading the chain from its first-named module, `b.vel` imports `main.vel`
  // and `main.vel` imports `b.vel` back; that second import is the one that
  // closes, and the one the comment goes on.
  const reports = await project({
    "main.vel": 'import {fromB} from "./b.vel"  // velar-allow A18: the two modules are one unit, split only for size\n\nexport def fromA() -> string: return "a"\n\nprint(fromB())\n',
    "b.vel": 'import {fromA} from "./main.vel"\n\nexport def fromB() -> string: return fromA()\n',
  });
  assert.deepEqual(reports.diagnostics, []);
  assert.deepEqual(reports.advisories, []);
});

test("[CO-I2] a 'velar-allow A18' that suppresses nothing is stale, like every other one", async () => {
  const reports = await project({
    "main.vel": 'import {fromB} from "./b.vel"\n\nexport def fromA() -> string: return "a"\n\nprint(fromB())\n',
    "b.vel": 'import {fromA} from "./main.vel"  // velar-allow A18: this is not the line that closes it\n\nexport def fromB() -> string: return fromA()\n',
  });
  assert.deepEqual(reports.diagnostics, [
    "VEL1012 No A18 advisory is reported on this line, so this 'velar-allow' suppresses nothing; delete it",
  ]);
  assert.equal(reports.advisories.length, 1);
});

test("[CO-I2] a 'velar-allow A18' in a project with no cycle at all is stale too", async () => {
  const reports = await project({
    "main.vel": 'import {fromB} from "./b.vel"  // velar-allow A18: the cycle this answered is gone\n\nprint(fromB())\n',
    "b.vel": 'export def fromB() -> string: return "b"\n',
  });
  assert.deepEqual(reports.diagnostics, [
    "VEL1012 No A18 advisory is reported on this line, so this 'velar-allow' suppresses nothing; delete it",
  ]);
  assert.deepEqual(reports.advisories, []);
});

test("[MD-I4/md24] 'velar-allow VEL6010' is not an advisory id and says so", async () => {
  const reports = await project({
    "main.vel": 'import {fromB} from "./b.vel"  // velar-allow VEL6010: the old spelling\n\nexport def fromA() -> string: return "a"\n\nprint(fromB())\n',
    "b.vel": 'import {fromA} from "./main.vel"\n\nexport def fromB() -> string: return fromA()\n',
  });
  assert.deepEqual(reports.diagnostics, [
    "VEL1011 A 'velar-allow' comment must name the advisory it suppresses ('A1', 'A2', …) and say why:"
    + " write '// velar-allow A1: why this spelling is intended'. There is no blanket form",
  ]);
});

test("[MD-I4/md19] a module importing from itself still names the self edge", async () => {
  const reports = await project({
    "main.vel": 'import {greet} from "./main.vel"\n\nexport def greet() -> string: return "hi"\n\nprint(greet())\n',
  });
  assert.ok(reports.advisories.some((item) => item.startsWith("A18 Circular module dependency includes ")), String(reports.advisories));
  assert.ok(reports.diagnostics.some((item) => item.startsWith("VEL6004 ")), String(reports.diagnostics));
});
