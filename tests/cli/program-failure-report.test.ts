import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { parseTestArguments } from "../../packages/cli/src/arguments.ts";
import { formatProgramFailure, installProgramStackContext } from "../../packages/cli/src/program-failure-report.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

test("test stack flags compose with each browser spelling and reject repeats", () => {
  for (const [arguments_, browser] of [
    [[], null], [["--stack"], null], [["--stack", "--browser"], "chromium"],
    [["--browser=all", "--stack"], "all"], [["--browser", "webkit", "--stack"], "webkit"],
  ] as const) {
    assert.deepEqual(parseTestArguments(arguments_), { input: null, browser, fullStack: arguments_.some((argument) => argument === "--stack") });
  }
  assert.equal(parseTestArguments(["--stack", "--stack"]), "--stack may be provided only once");
});

test("only an exact source-mapped test entry escapes the runtime prefix rule", () => {
  const error = new Error("bad shape");
  error.stack = [
    "Error: bad shape",
    "    at Object.__velarParse [as parse] (/project/main.vel:1:1)",
    "    at __velarTestFake (/project/main.vel:2:1)",
    "    at __velarTest8 (/project/spec.test.vel:4:3)",
    "    at __velarTest8 (/project/spec.test.vel:4:3)",
    "    at ModuleJob.run (node:internal/modules/esm/module_job:10:3)",
  ].join("\n");
  const hidden = formatProgramFailure(error);
  assert.match(hidden, /at <test> \(\/project\/spec\.test\.vel:4:3\)/u);
  assert.equal(hidden.match(/at <test>/gu)?.length, 1);
  assert.match(hidden, /3 frames outside your program hidden; rerun with 'velar test --stack'/u);
  assert.doesNotMatch(hidden, /__velar|node:internal/u);
  const full = formatProgramFailure(error, undefined, true);
  assert.match(full, /Object\.__velarParse/u);
  assert.match(full, /node:internal/u);
  assert.doesNotMatch(full, /outside your program hidden/u);
});

test("browser-style frame names use the same classification and browser rerun command", (context) => {
  const key = Symbol.for("velar.run.stack");
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  context.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
  installProgramStackContext(false, "velar test --browser");
  const error = new Error("page error");
  error.stack = "Error: page error\n__velarParse@http://localhost/main.js:1:1\nclicked@http://localhost/main.js:20:3";
  const hidden = formatProgramFailure(error);
  assert.match(hidden, /clicked@http:\/\/localhost\/main\.js:20:3/u);
  assert.match(hidden, /1 frame outside your program hidden; rerun with 'velar test --browser --stack'/u);
  assert.doesNotMatch(hidden, /__velarParse/u);
});

test("reporting does not invoke thrown-value name, stack or cause getters", () => {
  const error = new Error("original");
  let calls = 0;
  for (const property of ["name", "stack", "cause"]) {
    Object.defineProperty(error, property, { get() { calls += 1; throw new Error("foreign getter"); } });
  }
  const report = formatProgramFailure(error);
  assert.match(report, /Error: original/u);
  assert.equal(calls, 0);
});

test("source snippets are bounded before allocation and retain causes", async () => {
  const directory = await makeTemporaryDirectory("velar-error-source-");
  const path = join(directory, "main.vel");
  await writeFile(path, 'throw Error("bad")\n', "utf8");
  const error = new Error("bad", { cause: new Error("reason") });
  error.stack = `Error: bad\n    at action (${path}:1:7)`;
  assert.match(formatProgramFailure(error), /throw Error\("bad"\)\n {6}\^\n/u);
  assert.match(formatProgramFailure(error), /caused by:\nError: reason/u);
  error.stack = `Error: bad\n    at action (${path}:1:9007199254740990)`;
  assert.ok(formatProgramFailure(error).length < 4096);
  await writeFile(path, "x".repeat(4 * 1024 * 1024 + 1), "utf8");
  error.stack = `Error: bad\n    at action (${path}:1:1)`;
  assert.ok(formatProgramFailure(error).length < 4096);
});
