import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";

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

test("[MD-I4] a two-module cycle is advisory A18 on each import that closes it", async () => {
  const reports = await project({
    "main.vel": 'import {fromB} from "./b.vel"\n\nexport def fromA() -> string: return "a"\n\nprint(fromB())\n',
    "b.vel": 'import {fromA} from "./main.vel"\n\nexport def fromB() -> string: return fromA()\n',
  });
  assert.deepEqual(reports.diagnostics, []);
  assert.equal(reports.advisories.length, 2);
  for (const advisory of reports.advisories) {
    assert.match(advisory, /^A18 Circular module dependency includes /u);
  }
});

test("[MD-I4/md24] 'velar-allow A18' suppresses it, and says nothing else", async () => {
  const reports = await project({
    "main.vel": 'import {fromB} from "./b.vel"  // velar-allow A18: the two modules are one unit, split only for size\n\nexport def fromA() -> string: return "a"\n\nprint(fromB())\n',
    "b.vel": 'import {fromA} from "./main.vel"  // velar-allow A18: the two modules are one unit, split only for size\n\nexport def fromB() -> string: return fromA()\n',
  });
  assert.deepEqual(reports.diagnostics, []);
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
