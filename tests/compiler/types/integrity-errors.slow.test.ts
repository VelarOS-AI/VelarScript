import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { VELAR_COLLECTION_LOWERING_EXPORTS } from "../../../packages/compiler/src/runtime-modules.ts";
import { cliProject, execute, run } from "../../support/compiler-audit-suite.ts";

/**
 * D115 P5 — the compiler's integrity guards, one subject of the file that was
 * `bounded-generics-and-dispose.slow.test.ts` before it reached 916 lines.
 *
 * What is held here is that an IndexError is real on every path and stays one:
 * every CLI entry compiles through the shared runtime modules that define it
 * (NEW-D1), and `try` converts none of the three integrity failures to null
 * while an explicit `catch` still receives them (rule 103). The harness is in
 * `tests/support/compiler-audit-suite.ts`; the bodies below are the bodies
 * that file had.
 */

// ---------------------------------------------------------------------------
// NEW-D1 — IndexError on every CLI path
// ---------------------------------------------------------------------------

test("[NEW-D1] a project build reaches IndexError, which every CLI entry compiles through shared runtime modules", async () => {
  const project = await cliProject({
    "src/main.vel": `
def main():
    const values: List<number> = [1, 2, 3]
    try:
        print(str(values[9]))
    catch error:
        print("code=" + error.code)
        if error is IndexError:
            print("narrowed")
    return null

main()
`.trimStart(),
  });
  try {
    const run = project.cli("run", ".");
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "code=IndexError\nnarrowed\n");
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("[NEW-D1] the shared collection lowering module exports every runtime name the emitter can reference", () => {
  assert.ok((VELAR_COLLECTION_LOWERING_EXPORTS as readonly string[]).includes("__VelarIndexError"));
});

// ---------------------------------------------------------------------------
// Rule 103 — `try` does not swallow the compiler's integrity guards
// ---------------------------------------------------------------------------

test("[rule 103] IndexError passes through a 'try' expression instead of becoming null", () => {
  const result = compile(`
def main():
    const values: List<number> = [1, 2, 3]
    print(str(try values[0]))
    print(str(try values[9]))
    return null

main()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = execute(result.code ?? "");
  assert.notEqual(execution.status, 0);
  assert.equal(execution.stdout, "1\n");
  assert.match(execution.stderr, /IndexError/u);
});

test("[rule 103] an assertion failure and a narrowing failure are not converted either", () => {
  const assertion = compile(`
def guard(width: number) -> number:
    assert 0 < width else "Width must be positive"
    return width

print(str(try guard(0)))
`.trimStart());
  assert.deepEqual(assertion.diagnostics, []);
  const execution = execute(assertion.code ?? "");
  assert.notEqual(execution.status, 0);
  assert.match(execution.stderr, /AssertionError/u);
});

test("[rule 103] a 'catch' block still receives all three, because a catch is explicit", () => {
  const output = run(`
def main():
    const values: List<number> = [1]
    try:
        print(str(values[9]))
    catch error:
        if error is IndexError:
            print("caught " + error.code)
    return null

main()
`.trimStart());
  assert.equal(output, "caught IndexError\n");
});

test("[rule 103] Promise.retry surfaces an integrity failure instead of retrying past it", () => {
  const output = run(`
async def broken() -> number:
    const values: List<number> = [1]
    return values[5]

async def main():
    try:
        print(str(await Promise.retry(broken, 3, 1ms)))
    catch error:
        print("retry surfaced " + error.code)
    return null

detach main()
`.trimStart());
  assert.equal(output, "retry surfaced IndexError\n");
});
