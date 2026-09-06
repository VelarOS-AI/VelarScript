import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * AS-U2 + ER-U2: the compiler-injected guards report in positions and names.
 *
 * `NarrowingError` and the required-value `AssertionError` handed the author a
 * byte offset — `at source offset 135` — while the stack frame printed on the
 * next line already spelled the same place as `file:line:column`. `IndexError`
 * named neither the index nor the size, while charter §18 already promises the
 * field guard reports "naming the field": two compiler-injected guards, two
 * answers to one question.
 */

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

async function runProgram(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "velar-runtime-position-"));
  try {
    const entry = join(directory, "main.vel");
    await writeFile(entry, source.trimStart(), "utf8");
    const result = spawnSync(process.execPath, [cliPath, "run", entry], {
      cwd: directory,
      encoding: "utf8",
      timeout: 300_000,
    });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("[AS-U2] a broken flow narrowing reports file:line:column", async () => {
  const output = await runProgram(`
let value: string? = "x"

def clear():
    value = null

@main:
    if value != null:
        clear()
        print(f"{value.size}")
`);
  assert.match(output, /NarrowingError: Flow narrowing for 'value' no longer holds: expected string at main\.vel:9:18/u);
  assert.doesNotMatch(output, /source offset/u);
});

test("[AS-U2] the required-value unwrap reports file:line:column", async () => {
  const output = await runProgram(`
def find() -> string?:
    return null

@main:
    const v = find()!
    print(v)
`);
  assert.match(output, /AssertionError: Required value 'find\(\.\.\.\)' is absent at main\.vel:5:15/u);
  assert.doesNotMatch(output, /source offset/u);
});

test("[ER-U2] an out-of-range List index names the index and the size", async () => {
  assert.match(await runProgram(`
@main:
    const xs: List<number> = [1]
    print(f"{xs[5]}")
`), /IndexError: List index 5 is out of range for 1 element$/mu);

  assert.match(await runProgram(`
@main:
    const xs: List<number> = [1, 2, 3]
    print(f"{xs[-9]}")
`), /IndexError: List index -9 is out of range for 3 elements$/mu);
});

test("[ER-U2] a non-integer List index names the index", async () => {
  assert.match(await runProgram(`
def at(values: List<number>, index: number) -> number:
    return values[index]

@main:
    print(f"{at([1, 2], 0.5)}")
`), /IndexError: List index 0\.5 is not an integer$/mu);
});
