import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { projectSessionDiagnostics } from "../../packages/cli/src/project-session-diagnostics.ts";
import { VelarProjectSessions } from "../../packages/cli/src/project-session.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

test("project sessions give auxiliary roots only the project boundary", async () => {
  const container = await makeTemporaryDirectory("velar-session-auxiliary-boundary-");
  const root = join(container, "project");
  const mainPath = join(root, "src", "main.vel");
  const sourcePath = join(root, "src", "value.vel");
  const sharedPath = join(root, "shared.vel");
  const dataPath = join(root, "data", "tool.json");
  const toolPath = join(root, "tools", "check.vel");
  const escapedToolPath = join(root, "tools", "escape.vel");
  const testPath = join(root, "tests", "value.test.vel");
  const outsidePath = join(container, "outside.vel");
  const write = async (path: string, source: string): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source, "utf8");
  };

  await write(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
  })}\n`);
  await write(mainPath, 'import {value} from "./value.vel"\n\nprint(value)\n');
  await write(sourcePath, 'import {shared} from "../shared.vel"\n\nexport const value = shared\n');
  await write(sharedPath, "export const shared = 42\n");
  await write(dataPath, '{"enabled":true}\n');
  await write(toolPath, [
    'import {value} from "../src/value.vel"',
    'import json toolData from "../data/tool.json"',
    "",
    "export const checked = value",
    "export const enabled = toolData.enabled",
    "",
  ].join("\n"));
  await write(testPath, 'import {value} from "../src/value.vel"\n\nexport const tested = value\n');
  await write(outsidePath, "export const outside = 42\n");
  await write(escapedToolPath, 'import {outside} from "../../outside.vel"\n\nexport const escaped = outside\n');

  const snapshot = await new VelarProjectSessions().snapshot(toolPath);
  const boundaryDiagnostics = (path: string) => projectSessionDiagnostics(snapshot, path)
    .filter((diagnostic) => diagnostic.code === "VEL6001");

  assert.equal(snapshot.project.sourceRoot, join(root, "src"), "editor traversal must not widen the configured source root");
  assert.deepEqual(boundaryDiagnostics(toolPath), [], "a project tool may import configured sources");
  assert.deepEqual(boundaryDiagnostics(testPath), [], "a project test may import configured sources");
  assert.ok(boundaryDiagnostics(sourcePath).some((diagnostic) =>
    diagnostic.message.includes("cannot escape the entry source directory")),
  "a configured source keeps its narrow boundary when an auxiliary root also imports it");
  assert.ok(boundaryDiagnostics(escapedToolPath).some((diagnostic) =>
    diagnostic.message.includes("cannot escape the entry source directory")),
  "an auxiliary source cannot escape the project root");
  assert.deepEqual(snapshot.project.failures, [], "project-owned auxiliary roots must load as modules, not boundary failures");
});
