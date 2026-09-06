import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { VELAR_COLLECTION_LOWERING_MODULE } from "@velarscript/compiler/extension";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

test("CLI checks and builds a multi-module project", async () => {
  const directory = await makeTemporaryDirectory("velar-modules-");
  const execution = spawnSync(process.execPath, [
    "packages/cli/src/cli.ts",
    "build",
    "tests/fixtures/modules/main.vel",
    "--out-dir",
    directory,
    "--mode",
    "readable",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(execution.status, 0, String(execution.stderr));
  const main = await readFile(join(directory, "main.js"), "utf8");
  const dependency = await readFile(join(directory, "lib/greeting.js"), "utf8");
  assert.match(main, /from "\.\/lib\/greeting\.js"/);
  assert.match(dependency, /export function greet/);
});

test("unbundled builds replace their owned output without retaining ghost modules", async () => {
  const directory = await makeTemporaryDirectory("velar-clean-build-");
  const output = join(directory, "dist");
  const mainPath = join(directory, "main.vel");
  const dependencyPath = join(directory, "dependency.vel");
  await writeFile(dependencyPath, "export def value() -> number:\n    return [1, 2].sum()\n", "utf8");
  await writeFile(mainPath, 'import {value} from "./dependency.vel"\nprint(value())\n', "utf8");

  const build = () => spawnSync(process.execPath, [
    "packages/cli/src/cli.ts", "build", mainPath, "--out-dir", output,
  ], { cwd: process.cwd(), encoding: "utf8" });

  const first = build();
  assert.equal(first.status, 0, String(first.stderr));
  await readFile(join(output, "dependency.js"), "utf8");
  await readFile(join(output, "node_modules", "velar", `${VELAR_COLLECTION_LOWERING_MODULE.slice("velar/".length)}.js`), "utf8");
  await writeFile(join(output, "ghost.js"), "stale\n", "utf8");

  await unlink(dependencyPath);
  await writeFile(mainPath, 'print("clean")\n', "utf8");
  const second = build();
  assert.equal(second.status, 0, String(second.stderr));
  await assert.rejects(readFile(join(output, "dependency.js"), "utf8"), /ENOENT/u);
  await assert.rejects(readFile(join(output, "ghost.js"), "utf8"), /ENOENT/u);
  await assert.rejects(readFile(join(output, "node_modules", "velar", "package.json"), "utf8"), /ENOENT/u);
  const cleanExecution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(cleanExecution.status, 0, String(cleanExecution.stderr));
  assert.equal(cleanExecution.stdout, "clean\n");

  await writeFile(mainPath, "const broken =\n", "utf8");
  const failed = build();
  assert.equal(failed.status, 1);
  const preservedExecution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(preservedExecution.status, 0, String(preservedExecution.stderr));
  assert.equal(preservedExecution.stdout, "clean\n");
});

test("single-file builds synchronize marked runtime packages and preserve unowned CSS", async () => {
  const directory = await makeTemporaryDirectory("velar-single-clean-build-");
  const sourcePath = join(directory, "main.vel");
  const outputPath = join(directory, "bundle.js");
  const packageRoot = join(directory, "node_modules", "velar");
  const build = (output = outputPath) => spawnSync(process.execPath, [
    "packages/cli/src/cli.ts", "build", sourcePath, "--out", output,
  ], { cwd: process.cwd(), encoding: "utf8" });

  await writeFile(sourcePath, "print([1, 2].sum())\n", "utf8");
  const first = build();
  assert.equal(first.status, 0, String(first.stderr));
  const generated = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>;
  assert.equal(generated.velarGeneratedRuntime, 1);
  await readFile(join(packageRoot, `${VELAR_COLLECTION_LOWERING_MODULE.slice("velar/".length)}.js`), "utf8");

  await writeFile(join(directory, "bundle.css"), "stale\n", "utf8");
  await writeFile(sourcePath, 'print("clean")\n', "utf8");
  const second = build();
  assert.equal(second.status, 0, String(second.stderr));
  await assert.rejects(readFile(join(packageRoot, "package.json"), "utf8"), /ENOENT/u);
  assert.equal(await readFile(join(directory, "bundle.css"), "utf8"), "stale\n");

  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), '{"name":"velar","version":"9.9.9"}\n', "utf8");
  await writeFile(sourcePath, "print([3].sum())\n", "utf8");
  const before = await readFile(outputPath, "utf8");
  const refused = build();
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Refusing to replace non-generated package/u);
  assert.equal(await readFile(join(packageRoot, "package.json"), "utf8"), '{"name":"velar","version":"9.9.9"}\n');
  assert.equal(await readFile(outputPath, "utf8"), before);

  const invalidOutput = build(join(directory, "bundle.mjs"));
  assert.equal(invalidOutput.status, 2);
  assert.match(invalidOutput.stderr, /--out requires a \.js file path/u);
});
