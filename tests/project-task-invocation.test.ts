import assert from "node:assert/strict";
import test from "node:test";
import { projectTaskCliArguments, projectTaskCommands } from "../packages/cli/src/project-task-invocation.ts";

const root = "/project";

test("Desktop project tasks map a closed capability vocabulary to exact CLI arguments", () => {
  assert.deepEqual(projectTaskCommands, ["check", "test", "build", "fix", "package", "run"]);
  assert.deepEqual(projectTaskCliArguments(["check", root]), ["check", root]);
  assert.deepEqual(projectTaskCliArguments(["test", root]), ["test", root]);
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
