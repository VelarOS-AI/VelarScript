import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";

/**
 * MD-U3: one export arrives once.
 *
 * `import {title}` on one line and `import {title as other}` on the next bound
 * the same value under two names in silence, while the same pair spelled with
 * one local collided in the scope and earned VEL3004 — one shape with a rule
 * and its twin without. The locals have to differ for this report to be the
 * one that fires: where they are the same spelling the scope collision already
 * names it, and this would be a second report of one mistake.
 *
 * The JavaScript boundary is excluded on purpose. `import js {createHash}` and
 * `import js unsafe {createHash as raw}` bind a checked value and an unchecked
 * one — two values — and the default export has two legal spellings a module
 * may deliberately show side by side.
 */

const library = `
export def title(value: string) -> string:
    return value

export def other(value: string) -> string:
    return value
`.trimStart();

async function diagnostics(main: string): Promise<readonly string[]> {
  const directory = await mkdtemp(join(tmpdir(), "velar-import-duplicates-"));
  try {
    await writeFile(join(directory, "lib.vel"), library, "utf8");
    const mainPath = join(directory, "main.vel");
    await writeFile(mainPath, main.trimStart(), "utf8");
    const project = await compileProject(mainPath, new Map(), {});
    assert.deepEqual(project.failures.map((failure) => failure.message), []);
    return project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("[MD-U3] the same export imported twice across two clauses reports VEL3004", async () => {
  assert.deepEqual(await diagnostics(`
import {title} from "./lib.vel"
import {title as alias} from "./lib.vel"

@main:
    print(f"{title("a")} {alias("b")}")
`), [
    `VEL3004 Name 'title' is already imported from "./lib.vel" as 'title'; importing it twice binds one value under two`
    + ` names — drop this import and use 'title'`,
  ]);
});

test("[MD-U3] the single-clause form answers the same way", async () => {
  assert.deepEqual(await diagnostics(`
import {title, title as alias} from "./lib.vel"

@main:
    print(f"{title("a")} {alias("b")}")
`), [
    `VEL3004 Name 'title' is already imported from "./lib.vel" as 'title'; importing it twice binds one value under two`
    + ` names — drop this import and use 'title'`,
  ]);
});

test("[MD-U3] two different names from one module are clean", async () => {
  assert.deepEqual(await diagnostics(`
import {title} from "./lib.vel"
import {other} from "./lib.vel"

@main:
    print(f"{title("a")} {other("b")}")
`), []);
});

test("[MD-U3] the same local twice keeps the scope collision it already had", async () => {
  assert.deepEqual(await diagnostics(`
import {title} from "./lib.vel"
import {title} from "./lib.vel"

@main:
    print(f"{title("a")}")
`), [
    `VEL3004 Name 'title' is already imported from "./lib.vel"; alias one of the imports — import {title as other}`,
  ]);
});

test("[MD-U3] a namespace import beside a named one is clean", async () => {
  assert.deepEqual(await diagnostics(`
import {title} from "./lib.vel"
import * as library from "./lib.vel"

@main:
    print(f"{title("a")} {library.other("b")}")
`), []);
});
