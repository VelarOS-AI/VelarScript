import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../../packages/cli/src/project.ts";

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
 * CO-I1: the two reports say one sentence. They are the same mistake seen from
 * two positions, and the answer the scope collision used to give — "alias one
 * of the imports" — is the spelling this very rule then refuses, so following
 * it turned one `velar check` into two. Deleting one import is the whole fix,
 * and an author who wants a second name for the value binds one. A collision
 * between two *different* exports is a different mistake and keeps the alias.
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
    `VEL3004 Name 'title' is already imported from "./lib.vel"; one export arrives once — delete the duplicate import;`
    + ` to bind it under a second name write 'const other = title'`,
  ]);
});

test("[MD-U3] the single-clause form answers the same way", async () => {
  assert.deepEqual(await diagnostics(`
import {title, title as alias} from "./lib.vel"

@main:
    print(f"{title("a")} {alias("b")}")
`), [
    `VEL3004 Name 'title' is already imported from "./lib.vel"; one export arrives once — delete the duplicate import;`
    + ` to bind it under a second name write 'const other = title'`,
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

test("[CO-I1] the same local twice says the same sentence the alias form says", async () => {
  assert.deepEqual(await diagnostics(`
import {title} from "./lib.vel"
import {title} from "./lib.vel"

@main:
    print(f"{title("a")}")
`), [
    `VEL3004 Name 'title' is already imported from "./lib.vel"; one export arrives once — delete the duplicate import;`
    + ` to bind it under a second name write 'const other = title'`,
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

test("[CO-I1] two different exports that want one local name still answer with an alias", async () => {
  // The alias advice spells the *export* the colliding specifier binds. It used
  // to spell the local — `import {title as other}` here — and the local is the
  // half that is already wrong: following that produced `Module './lib.vel' has
  // no export named 'title'` on the very next run, in the one branch 0.31.0
  // kept the alias for. `other` is the placeholder local, so where the export
  // is itself named `other` the placeholder moves instead.
  assert.deepEqual(await diagnostics(`
import {title} from "./lib.vel"
import {other as title} from "./lib.vel"

@main:
    print(f"{title("a")}")
`), [
    `VEL3004 Name 'title' is already imported from "./lib.vel"; alias one of the imports — import {other as another}`,
  ]);
});

test("[CO-I1] the alias the report names compiles, and so does the same collision through aliases", async () => {
  assert.deepEqual(await diagnostics(`
import {title} from "./lib.vel"
import {other as another} from "./lib.vel"

@main:
    print(f"{title("a")} {another("b")}")
`), []);
  assert.deepEqual(await diagnostics(`
import {title as shared} from "./lib.vel"
import {other as shared} from "./lib.vel"

@main:
    print(f"{shared("a")}")
`), [
    `VEL3004 Name 'shared' is already imported from "./lib.vel"; alias one of the imports — import {other as another}`,
  ]);
  assert.deepEqual(await diagnostics(`
import {title as shared} from "./lib.vel"
import {other as another} from "./lib.vel"

@main:
    print(f"{shared("a")} {another("b")}")
`), []);
});

test("[CO-I1] the fix the duplicate report names compiles", async () => {
  assert.deepEqual(await diagnostics(`
import {title} from "./lib.vel"

@main:
    const other = title
    print(f"{title("a")} {other("b")}")
`), []);
});

test("[CO-I1] an aliased import colliding with a declaration names the real export in either order", async () => {
  const imported = 'import {title as shared} from "./lib.vel"';
  const local = 'const shared = "local"';
  for (const main of [`${imported}\n${local}\n`, `${local}\n${imported}\n`]) {
    const reports = await diagnostics(main);
    assert.equal(reports.length, 1);
    assert.match(reports[0]!, /import \{title as other\}/);
    assert.deepEqual(await diagnostics(main.replace(imported, 'import {title as other} from "./lib.vel"')), []);
  }
});
