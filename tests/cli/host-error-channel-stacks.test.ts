import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * AS-I1 + PR-U4: one stack policy for everything `velar run` prints.
 *
 * The uncaught path hid the frames the author does not own and offered
 * `--stack`; the host error channel — a detached task's failure, a release that
 * failed while another error was in flight — printed the raw trace and
 * `--stack` controlled nothing there. Two definitions of one concept. The
 * compiler's own runtime frames count as internal in both, because an author
 * never wrote a frame under `node_modules/velar` and cannot act on one.
 *
 * CO-I6 found a third writer of the same sentence — `velar/async`'s own
 * detached reporter — still printing the raw trace, so the policy moved into
 * `packages/compiler/runtime/error.js` and every channel calls it. CO-U1, CO-U2
 * and CO-U3 are the three things that policy still got wrong: `--stack` traded
 * the source snippet away, an inlined runtime frame escaped a path test and
 * leaked a deleted sandbox directory, and one position printed two frames.
 */

const cliPath = fileURLToPath(new URL("../../packages/cli/src/cli.ts", import.meta.url));

const hiddenLine = /^ {2}\(\d+ frames? outside your program hidden; rerun with 'velar run --stack' for the full trace\)$/mu;

async function runProgram(source: string, flags: readonly string[] = []): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "velar-host-error-"));
  try {
    const entry = join(directory, "main.vel");
    await writeFile(entry, source.trimStart(), "utf8");
    const result = spawnSync(process.execPath, [cliPath, "run", entry, ...flags], {
      cwd: directory,
      encoding: "utf8",
      timeout: 300_000,
    });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const detached = `
async def save():
    throw Error("detached boom")

@main:
    detach save()
    print("after detach")
`;

const release = `
class Bad:
    @dispose:
        throw Error("release failed")

def go():
    using bad = Bad()
    throw Error("original")

@main:
    go()
`;

test("[AS-I1] a detached task's failure hides internal frames and says so", async () => {
  const output = await runProgram(detached);
  assert.match(output, /Detached task failed: Error: detached boom/u);
  assert.match(output, /at save \(.*main\.vel:2:11\)/u);
  assert.match(output, hiddenLine);
  assert.doesNotMatch(output, /node:internal/u);
});

test("[AS-I1] '--stack' restores the frames on the same channel", async () => {
  const output = await runProgram(detached, ["--stack"]);
  assert.match(output, /Detached task failed: Error: detached boom/u);
  assert.match(output, /node:internal/u);
  assert.doesNotMatch(output, hiddenLine);
});

test("[AS-I1] a release failure reported beside another error follows the same policy", async () => {
  const hidden = await runProgram(release);
  assert.match(hidden, /Resource release failed while another error was in flight: Error: release failed/u);
  assert.match(hidden, hiddenLine);

  const full = await runProgram(release, ["--stack"]);
  assert.match(full, /Resource release failed while another error was in flight: Error: release failed/u);
  assert.match(full, /node:internal/u);
});

test("[PR-U4] the compiler's own runtime frames are internal on the uncaught path", async () => {
  const source = `
let value: string? = "x"

def clear():
    value = null

@main:
    if value != null:
        clear()
        print(f"{value.size}")
`;
  const hidden = await runProgram(source);
  assert.match(hidden, /NarrowingError: Flow narrowing for 'value' no longer holds/u);
  assert.doesNotMatch(hidden, /node_modules\/velar\//u);
  assert.match(hidden, hiddenLine);

  const full = await runProgram(source, ["--stack"]);
  assert.match(full, /at __velarNarrow \(.*node_modules\/velar\//u);
});

const nestedBudgets = `
async def inner() -> string:
    await Promise.sleep(200ms)
    return "inner"

async def outer() -> string:
    return await Promise.timeout(inner(), 150ms, "inner budget")

@main:
    try:
        await Promise.timeout(outer(), 60ms, "outer budget")
    catch error:
        print(f"caught {error.message}")
    await Promise.sleep(400ms)
`;

test("[CO-I6] velar/async's own detached reporter follows the one policy too", async () => {
  // Nested `Promise.timeout` is an ordinary spelling, and it lands on this
  // writer rather than on the emitted one. It printed three frames — all of
  // them Node-internal or language-runtime — with no hidden-frame line, no
  // `--stack` effect, and a first frame naming a sandbox directory the run had
  // already deleted.
  const hidden = await runProgram(nestedBudgets);
  assert.match(hidden, /caught outer budget/u);
  assert.match(hidden, /Detached task failed: TimeoutError: inner budget/u);
  assert.match(hidden, hiddenLine);
  assert.doesNotMatch(hidden, /node:internal/u);
  assert.doesNotMatch(hidden, /\.velar\/run-/u);

  const full = await runProgram(nestedBudgets, ["--stack"]);
  assert.match(full, /Detached task failed: TimeoutError: inner budget/u);
  assert.match(full, /node:internal/u);
  assert.doesNotMatch(full, hiddenLine);
});

test("[CO-U2] an inlined runtime helper's frame is hidden by its name, not by its path", async () => {
  // `__velarRequired` is emitted into the program's own module, so it is under
  // neither `node:` nor `node_modules/velar/`: the path test let it through,
  // and what it showed the author was a path inside the deleted sandbox.
  const source = `
def lookup(key: string) -> string?:
    return null

@main:
    const value = lookup("a")!
    print(value)
`;
  const hidden = await runProgram(source);
  assert.match(hidden, /AssertionError: Required value 'lookup\(\.\.\.\)' is absent/u);
  assert.match(hidden, /at <anonymous> \(.*main\.vel:5:19\)/u);
  assert.doesNotMatch(hidden, /\.velar\/run-/u);
  assert.match(hidden, hiddenLine);

  // `--stack` is the way back to it, and it names the same frame it always did.
  const full = await runProgram(source, ["--stack"]);
  assert.match(full, /at __velarRequired \(.*\.velar\/run-/u);
});

test("[CO-U1] '--stack' only ever adds: the source snippet stays", async () => {
  const source = `
@main:
    let n = -1
    print("ab".repeat(n))
`;
  const snippet = /\n {4}print\("ab"\.repeat\(n\)\)\n {10}\^\n/u;
  const hidden = await runProgram(source);
  assert.match(hidden, snippet);
  const full = await runProgram(source, ["--stack"]);
  assert.match(full, snippet, "the snippet the default output prints survives --stack");
  assert.match(full, /node:internal/u, "and the frames it hides are what --stack adds");
});

test("[CO-U3] one position prints one frame", async () => {
  // A runtime narrowing guard is an arrow applied at the read it guards, so a
  // failed guard puts two byte-identical frames at one file:line:column.
  const source = `
type Box:
    label: string?

def clear(box: Box):
    box.label = null

@main:
    const box: Box = {label: "a"}
    if box.label != null:
        clear(box)
        print(box.label)
`;
  const output = await runProgram(source);
  assert.match(output, /NarrowingError: Flow narrowing for '\.label' no longer holds/u);
  const positions = [...output.matchAll(/^ {4}at <anonymous> \(.*main\.vel:11:15\)$/gmu)];
  assert.equal(positions.length, 1, output);
});

test("[CO-U8] the emitted '@dispose:' method is named after the block the author wrote", async () => {
  // The key stays unspellable — that is what keeps the role uncallable from
  // source — but the stack said `Handle.__velar:dispose`, a compiler-internal
  // spelling no document had ever shown the author.
  const output = await runProgram(`
class Handle:
    @dispose:
        throw Error("release blew up")

def work():
    using handle = Handle()
    throw Error("body blew up")

@main:
    try:
        work()
    catch error:
        print(f"caught: {error.message}")
`);
  assert.match(output, /at Handle\.dispose \(.*main\.vel:3:15\)/u);
  assert.doesNotMatch(output, /__velar:dispose/u);
});
