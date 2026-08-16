import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  projectTaskBrowserWorkerCliArguments,
  projectTaskCliArguments,
  projectTaskCommands,
} from "../packages/cli/src/project-task-invocation.ts";

const root = "/project";

test("Desktop project tasks map a closed capability vocabulary to exact CLI arguments", () => {
  assert.deepEqual(projectTaskCommands, ["check", "test", "browserTest", "build", "fix", "package", "run"]);
  assert.deepEqual(projectTaskCliArguments(["check", root]), ["check", root]);
  assert.deepEqual(projectTaskCliArguments(["test", root]), ["test", root]);
  assert.deepEqual(projectTaskCliArguments(["browserTest", root]), ["test", root, "--browser=all"]);
  assert.deepEqual(projectTaskCliArguments(["build", root]), ["build", root]);
  assert.deepEqual(projectTaskCliArguments(["fix", root]), ["fix", root]);
  assert.deepEqual(projectTaskCliArguments(["package", root]), ["package", root]);
  assert.deepEqual(projectTaskCliArguments(["run", root]), ["run", root]);
  assert.deepEqual(projectTaskCliArguments(["run", root, "--", "one", "two"]), ["run", root, "--", "one", "two"]);
});

test("Desktop project tasks reject anything outside the finite owner contract", () => {
  for (const arguments_ of [
    ["publish", root],
    ["check", "relative"],
    ["check", root, "--quiet"],
    ["test", root, "--browser", "chromium"],
    ["package", root, "--out", "/tmp"],
    ["run", root, "one"],
  ]) {
    assert.equal(projectTaskCliArguments(arguments_), "invalid package-owned task invocation");
  }
});

test("Desktop project tasks admit only the official supervised browser worker shape", () => {
  const limits = JSON.stringify({ processTimeoutMs: 300000 });
  const browserSite = join(tmpdir(), "velar-browser-tests-owner", "site");
  assert.deepEqual(
    projectTaskBrowserWorkerCliArguments(["test", root, "--browser=all"], limits),
    ["test", root, "--browser=all"],
  );
  assert.deepEqual(
    projectTaskBrowserWorkerCliArguments(
      ["build", root, "--out-dir", browserSite],
      limits,
    ),
    ["build", root, "--out-dir", browserSite],
  );
  for (const [arguments_, marker] of [
    [["test", root, "--browser=all"], undefined],
    [["test", root, "--browser=all"], "null"],
    [["test", "relative", "--browser=all"], limits],
    [["test", root, "--browser=unknown"], limits],
    [["test", root, "--browser=all", "escape"], limits],
    [["publish", root, "--browser=all"], limits],
    [["build", root, "--out-dir", "/tmp/not-a-browser-owner/site"], limits],
    [["build", root, "--out-dir", "/tmp/velar-browser-tests-owner/escape"], limits],
  ] as const) {
    assert.match(String(projectTaskBrowserWorkerCliArguments(arguments_, marker)), /invalid supervised browser-test/u);
  }
});
