import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compile } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { repositoryRoot } from "./repository-root.ts";
import { after } from "node:test";

// D39 item 53 — `test "name":` blocks.

const root = repositoryRoot;

after(async () => {
  await removeTemporaryDirectories();
});

function diagnostics(source: string, path = "probe.test.vel"): readonly string[] {
  return compile(source.trimStart(), { path }).diagnostics.map((item) => `${item.code} ${item.message}`);
}

async function runProject(files: ReadonlyMap<string, string>): Promise<{ readonly status: number; readonly stdout: string; readonly stderr: string }> {
  const directory = await makeTemporaryDirectory("velar-wave-m-tests-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }), "utf8");
  for (const [name, contents] of files) await writeFile(join(directory, name), contents, "utf8");
  const execution = spawnSync(process.execPath, [join(root, "packages", "cli", "src", "cli.ts"), "test", directory], {
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: execution.status ?? 1, stdout: String(execution.stdout), stderr: String(execution.stderr) };
}

test("[D39 53] the runner discovers blocks and reports each name verbatim", async () => {
  const execution = await runProject(new Map([
    ["src/main.vel", "export def total(values: List<number>) -> number:\n    return values.sum()\n"],
    ["src/main.test.vel", `
import {expect} from "velar/test"
import {total} from "./main.vel"

test "an empty list totals zero":
    expect(total([])).toBe(0)

test "a list totals its members, in any order":
    expect(total([3, 1, 2])).toBe(6)
`.trimStart()],
  ]));
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /✓ "src\/main\.test\.vel" :: "an empty list totals zero"/u);
  assert.match(execution.stdout, /✓ "src\/main\.test\.vel" :: "a list totals its members, in any order"/u);
  assert.match(execution.stdout, /2 passed, 0 failed/u);
});

test("[D39 53] a failing test is attributed to its own name and the run continues", async () => {
  const execution = await runProject(new Map([
    ["src/main.vel", "export const answer = 41\n"],
    ["src/main.test.vel", `
import {expect} from "velar/test"
import {answer} from "./main.vel"

test "the answer is right":
    expect(answer).toBe(42)

test "the answer is a number":
    expect(answer).toBe(41)
`.trimStart()],
  ]));
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /✗ "src\/main\.test\.vel" :: "the answer is right"/u);
  assert.match(execution.stdout, /✓ "src\/main\.test\.vel" :: "the answer is a number"/u);
  assert.match(execution.stdout, /1 passed, 1 failed/u);
});

test("[D39 53] a test body awaits directly", async () => {
  const execution = await runProject(new Map([
    ["src/main.vel", "export async def load() -> string:\n    await Promise.sleep(1ms)\n    return \"loaded\"\n"],
    ["src/main.test.vel", `
import {expect} from "velar/test"
import {load} from "./main.vel"

test "loading resolves to its value":
    expect(await load()).toBe("loaded")
`.trimStart()],
  ]));
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /✓ "src\/main\.test\.vel" :: "loading resolves to its value"/u);
});

test("[D39 53] the unowned-error stance applies to a block: a detached failure fails its test", async () => {
  const execution = await runProject(new Map([
    ["src/main.vel", `
export async def failLater():
    await Promise.sleep(1ms)
    throw Error("detached failure")
`.trimStart()],
    ["src/main.test.vel", `
import {expect} from "velar/test"
import {failLater} from "./main.vel"

test "a detached failure belongs to the test that started it":
    async failLater()
    await Promise.sleep(10ms)
    expect(1).toBe(1)
`.trimStart()],
  ]));
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /✗ "src\/main\.test\.vel" :: "a detached failure belongs to the test that started it"/u);
  assert.match(execution.stderr, /an unowned error was reported while this test ran/u);
});

test("[D39 53] a test module that declares no tests fails rather than passing empty", async () => {
  const execution = await runProject(new Map([
    ["src/main.vel", "export const answer = 42\n"],
    ["src/main.test.vel", "import {answer} from \"./main.vel\"\n\nprint(f\"{answer}\")\n"],
  ]));
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /declares no tests/u);
});

test("[D39 53] a test is declared at the top level of a test module, and nowhere else", () => {
  assert.deepEqual(diagnostics(`
test "a name":
    print("x")
`, "src/app.vel"), ["VEL3019 Tests live in a '*.test.vel' module, which is where the runner looks; move this test beside the code it specifies"]);

  assert.ok(diagnostics(`
def main():
    test "inner":
        print("x")
`).some((item) => /^VEL3019 A test is declared at module top level/u.test(item)));
});

test("[D39 53] names are present and unique within a module", () => {
  assert.ok(diagnostics(`
test "":
    print("x")
`).some((item) => /^VEL3019 A test name states what the code must do/u.test(item)));

  assert.ok(diagnostics(`
test "same":
    print("x")

test "same":
    print("y")
`).some((item) => /^VEL3019 This module already declares a test named "same"/u.test(item)));
});

test("[D39 53] 'def test_*' discovery is retired and points at the block", () => {
  const reported = diagnostics(`
def test_chart_scale_rejects_invalid_values():
    print("x")
`);
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /^VEL3019 Write 'test "chart scale rejects invalid values":'/u);
  assert.match(reported[0]!, /'def test_\*' discovery is retired/u);

  // Helpers in a test module keep ordinary names and stay ordinary functions.
  assert.deepEqual(diagnostics(`
def buildScale() -> number:
    return 1

test "a scale is built":
    print(f"{buildScale()}")
`), []);
});

test("[D39 53] 'test' stays an ordinary name everywhere else", () => {
  assert.deepEqual(diagnostics(`
def test(name: string) -> string:
    return name

const value = test("x")
print(value)
`, "src/app.vel"), []);
});

test("[D39 53] the module interface carries both the emitted name and the author's name", () => {
  const result = compile(`
test "a name with \\"quotes\\" and, punctuation":
    print("x")
`.trimStart(), { path: "probe.test.vel" });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.moduleInterface.tests.length, 1);
  assert.equal(result.moduleInterface.tests[0]!.title, 'a name with "quotes" and, punctuation');
  assert.match(result.moduleInterface.tests[0]!.name, /^__velarTest\d+$/u);
  assert.match(result.code ?? "", /export async function __velarTest\d+\(\) \{/u);
});
