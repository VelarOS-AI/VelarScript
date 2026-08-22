import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// Wave r1a: D90 R1-a, and D90 R21 revoking it.
//
// R1 made a flush settle every watch in a single pass and promised that a
// watch's declaration order is not observable in the output. Two watches that
// both assign one state broke the promise, so R1-a made that shape a compile
// error (VEL5069). The error then had to find the writes, and each round of
// this file found the next spelling that hid one: a helper call, a `const`
// alias, a `let` alias, a member path, a mutating method. R16 replaced the
// inference with a `writes` header and two runtime referees.
//
// On 2026-08-23 the owner overturned the promise all of that served. Execution
// order is the order the watches are written; two watches writing one state is
// not an error, and whichever is written second is the one that lands. So the
// rule, the diagnostic, the alias-following call graph and both referees are
// gone, and every case in this file went with them -- except one.
//
// The one that stays is the case that pinned the promise: "swapping the two
// aliased watches changes nothing". Under R21 it is the opposite claim, and it
// is kept rather than deleted because a reversal needs a test that shows the
// behaviour reversed. It is now execution-level, because with the compile-time
// analysis gone there is nothing to ask at compile time but silence.

function compile(text: string) {
  return compileCore(text.trimStart(), { extensions: [velarCompilerExtension] });
}

/** Runs the emitted module and answers everything it wrote to stdout and stderr. */
async function runEmitted(source: string): Promise<string> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const directory = await mkdtemp(join(tmpdir(), "velar-r1a-"));
  try {
    const file = join(directory, "main.mjs");
    await writeFile(file, result.code ?? "", "utf8");
    return await new Promise<string>((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { output += chunk; });
      child.stderr.on("data", (chunk: string) => { output += chunk; });
      child.once("error", rejectPromise);
      child.once("exit", () => resolvePromise(output));
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Two watches writing one state through `const`-aliased helpers, in the two orders. */
function aliasedApplication(scaleFirst: boolean): string {
  const bump = `watch t:\n    chosenBump()`;
  const scale = `watch t:\n    chosenScale()`;
  return `
state t = 0
state x = 1

def bump():
    x = x + 1

def scale():
    x = x * 10

const chosenBump = bump
const chosenScale = scale

${scaleFirst ? scale : bump}

${scaleFirst ? bump : scale}

action main():
    t = 1
    await tick()
    print(f"x={x}")

async main()
`;
}

test("[R21] swapping the two aliased watches changes the result", { timeout: 60_000 }, async () => {
  // The turned-around case. Its R1-a name was "swapping the two aliased watches
  // changes nothing", and it existed to prove that a `const` alias could not
  // hide a write from the rule that kept the two orders equal. There is no such
  // rule now: both writes take effect, the second one is applied to the result
  // of the first, and the two orders answer 11 and 20.
  const scaleFirst = await runEmitted(aliasedApplication(true));
  const bumpFirst = await runEmitted(aliasedApplication(false));
  assert.notEqual(scaleFirst, bumpFirst);
  assert.equal(scaleFirst, "x=11\n");
  assert.equal(bumpFirst, "x=20\n");
  // Neither order is reported at compile time: the alias-following call graph
  // that used to answer "does this watch write?" no longer exists.
  assert.deepEqual(compile(aliasedApplication(true)).diagnostics, []);
});
