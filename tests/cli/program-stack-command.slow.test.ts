import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

// Repeated real CLI launches compile records, aliases and enums, and start
// isolated test workers in both source and distributed-CLI modes.
after(removeTemporaryDirectories);
const sourceCli = resolve("packages/cli/src/cli.ts");
const builtCli = resolve("packages/cli/dist/cli.js");

test("parse errors select the caller for record, generic, alias and enum Types", async () => {
  for (const [declaration, typeName] of [
    ["type Target:\n    value: string", "Target"],
    ["type Box<T>:\n    value: T\n\ntype Target = Box<string>", "Box<string>"],
    ["type Target = number", "Target"],
    ["enum Target:\n    ready", "Target"],
  ]) {
    const root = await fixture();
    const invocation = "    print(Target.parse(raw))";
    const source = `${declaration}\n\n@main:\n    const raw: unknown = null\n${invocation}\n`;
    await writeFile(join(root, "src", "main.vel"), source, "utf8");
    const line = source.trimEnd().split("\n").length;
    for (const fullStack of [false, true]) {
      const result = run(root, sourceCli, "run", fullStack);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.ok(result.stderr.includes(`ValidationError: Value does not match ${typeName}`), result.stderr);
      assert.ok(result.stderr.includes(`${invocation}\n`), result.stderr);
      assert.match(result.stderr, new RegExp(`main\\.vel:${line}:\\d+`), result.stderr);
      if (fullStack) assert.match(result.stderr, /__velarParse/u);
      else assert.doesNotMatch(result.stderr, /__velarParse|Node\.js internal/u);
    }
  }
});

test("source and built test commands carry stack mode into test and detached failures", async () => {
  const root = await fixture();
  await writeFile(join(root, "src", "main.vel"), "export const ready = true\n", "utf8");
  await writeFile(join(root, "src", "shape.test.vel"), [
    'import {expect} from "velar/test"',
    "",
    "type Target:",
    "    value: string",
    "",
    'test "assertion position":',
    "    expect(1).toBe(2)",
    "",
    'test "parse position":',
    "    const raw: unknown = null",
    "    print(Target.parse(raw))",
    "",
    "async def fail():",
    '    throw Error("detached stack sentinel")',
    "",
    'test "detached position":',
    "    detach fail()",
    "",
  ].join("\n"), "utf8");
  for (const cli of [sourceCli, builtCli]) {
    for (const fullStack of [false, true]) {
      const result = run(root, cli, "test", fullStack);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /0 passed, 3 failed/u);
      assert.match(result.stderr, /shape\.test\.vel:7:\d+/u);
      assert.match(result.stderr, /shape\.test\.vel:11:\d+/u);
      assert.match(result.stderr, /at <test>/u);
      assert.match(result.stderr, /Detached task failed: Error: detached stack sentinel/u);
      assert.doesNotMatch(result.stderr, /velar run --stack/u);
      if (fullStack) {
        assert.match(result.stderr, /__velarParse/u);
        assert.doesNotMatch(result.stderr, /outside your program hidden/u);
      } else {
        assert.match(result.stderr, /outside your program hidden; rerun with 'velar test --stack'/u);
        assert.doesNotMatch(result.stderr, /__velar|node:internal/u);
      }
    }
  }
});

async function fixture(): Promise<string> {
  const root = await makeTemporaryDirectory("velar-program-stack-");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: [] }), "utf8");
  return root;
}

function run(root: string, cli: string, command: string, fullStack: boolean) {
  return spawnSync(process.execPath, [cli, command, ...(fullStack ? ["--stack"] : [])], {
    cwd: root, encoding: "utf8", timeout: 30_000,
  });
}
