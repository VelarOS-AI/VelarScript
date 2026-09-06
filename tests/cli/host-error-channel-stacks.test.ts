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
 */

const cliPath = fileURLToPath(new URL("../../packages/cli/src/cli.ts", import.meta.url));

const hiddenLine = /^ {2}\(\d+ Node\.js internal frames hidden; rerun with 'velar run --stack' for the full trace\)$/mu;

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
