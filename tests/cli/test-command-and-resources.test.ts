import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

test("velar test discovers test blocks without requiring exports", async () => {
  const directory = await makeTemporaryDirectory("velar-test-project-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), "export def add(left: number, right: number) -> number:\n    return left + right\n", "utf8");
  await writeFile(join(directory, "src", "math.test.vel"), `
import {expect} from "velar/test"
import {add} from "./main.vel"

test "it adds numbers":
    expect(add(2, 3)).toEqual(5)

test "it awaits async code":
    await Promise.sleep(0ms)
    const value = "ready"
    expect(value).toEqual("ready")
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "ignored.browser.test.vel"), "this is intentionally not valid core test source\n", "utf8");

  const execution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.match(execution.stdout, /math\.test\.vel" :: "it adds numbers"/);
  assert.match(execution.stdout, /2 passed, 0 failed/);
});

/**
 * GA-I3: a failing test is the one moment an author most needs the position of
 * the failure, and it was the one report that had none — `Expected "a" to be
 * "b"` with no file, no line, no column and no frames, for the same
 * `AssertionError` `velar run` located exactly. The report now reads the way
 * `velar run` reports an uncaught failure: the thrown value's own line, the
 * `.vel` line under a caret, and the frames the author owns.
 */
test("[GA-I3] a failing test reports file:line:column, a code frame, and program frames", async () => {
  const directory = await makeTemporaryDirectory("velar-test-failure-shape-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), [
    "export def greet(name: string) -> string:",
    "    assert name != \"\" else \"A greeting requires a name\"",
    "    return \"Hello, \" + name",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(directory, "src", "greeting.test.vel"), [
    'import {expect} from "velar/test"',
    'import {greet} from "./main.vel"',
    "",
    'test "an expect mismatch is located":',
    '    expect(greet("Velar")).toBe("Hello, WRONG")',
    "",
    'test "a thrown error keeps its frames":',
    '    expect(greet("")).toBe("unreachable")',
    "",
  ].join("\n"), "utf8");

  const execution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 1, execution.stdout + execution.stderr);
  assert.match(execution.stdout, /0 passed, 2 failed/u, execution.stdout);

  // The mismatch is located at the assertion that failed, with its own line
  // under a caret and the test body as the frame that raised it.
  assert.match(execution.stderr, /Error: Expected "Hello, Velar" to be "Hello, WRONG"/u, execution.stderr);
  assert.match(execution.stderr, /\n {4}expect\(greet\("Velar"\)\)\.toBe\("Hello, WRONG"\)\n {17}\^\n/u, execution.stderr);
  assert.match(execution.stderr, /at <test> \(.*src\/greeting\.test\.vel:5:18\)/u, execution.stderr);

  // A thrown error keeps the frame that raised it and the test that called it,
  // and the compiler's own emitted name never reaches the report.
  assert.match(execution.stderr, /AssertionError: A greeting requires a name/u, execution.stderr);
  assert.match(execution.stderr, /at greet \(.*src\/main\.vel:2:20\)/u, execution.stderr);
  assert.match(execution.stderr, /at <test> \(.*src\/greeting\.test\.vel:8:12\)/u, execution.stderr);
  assert.doesNotMatch(execution.stderr, /__velar/u, execution.stderr);
  assert.doesNotMatch(execution.stderr, /node:internal/u, execution.stderr);
});

test("velar test executes transitive installed VelarScript source packages", async () => {
  const directory = await makeTemporaryDirectory("velar-test-packages-");
  const suffixRoot = join(directory, "node_modules", "velar-suffix");
  const greeterRoot = join(directory, "node_modules", "velar-greeter");
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(suffixRoot, "src"), { recursive: true });
  await mkdir(join(greeterRoot, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), "export const ready = true\n", "utf8");
  await writeFile(join(suffixRoot, "package.json"), JSON.stringify({ name: "velar-suffix", velar: { entry: "src/index.vel", targets: ["core", "node"], requires: { capabilities: [] } } }), "utf8");
  await writeFile(join(suffixRoot, "src", "index.vel"), "export const suffix = \"!\"\n", "utf8");
  await writeFile(join(greeterRoot, "package.json"), JSON.stringify({ name: "velar-greeter", velar: { entry: "src/index.vel", targets: ["core", "node"], requires: { capabilities: [] } } }), "utf8");
  await writeFile(join(greeterRoot, "src", "index.vel"), `
import {suffix} from "velar-suffix"

export def greet(name: string) -> string:
    return name + suffix
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "package.test.vel"), `
import {expect} from "velar/test"
import {greet} from "velar-greeter"

test "the package graph resolves":
    expect(greet("Velar")).toBe("Velar!")
`.trimStart(), "utf8");

  const execution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.match(execution.stdout, /package\.test\.vel" :: "the package graph resolves"/u);
});

test("declared JSON package resources survive check test run and framework-free build", async () => {
  const directory = await makeTemporaryDirectory("velar-package-resource-");
  const packageRoot = join(directory, "node_modules", "catalog-package");
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await mkdir(join(packageRoot, "generated"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), `
import {catalogName} from "catalog-package"
import json rawCatalog from "catalog-package/catalog"

type Catalog:
    readonly name: string

print(catalogName + ":" + Catalog.parse(rawCatalog).name)
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "catalog.test.vel"), `
import {expect} from "velar/test"
import {catalogName} from "catalog-package"

test "the declared package resource loads":
    expect(catalogName).toBe("blocks")
`.trimStart(), "utf8");
  const packageManifest = {
    name: "catalog-package",
    version: "1.0.0",
    type: "module",
    exports: {
      ".": "./dist/index.js",
      "./catalog": "./generated/catalog.json",
    },
    velar: {
      entry: "src/index.vel",
      targets: ["core", "node"],
      requires: { capabilities: [] },
      resources: {
        "./catalog": { path: "generated/catalog.json", type: "json" },
      },
    },
  };
  await writeFile(join(packageRoot, "package.json"), JSON.stringify(packageManifest), "utf8");
  await writeFile(join(packageRoot, "generated", "catalog.json"), JSON.stringify({ name: "blocks" }), "utf8");
  await writeFile(join(packageRoot, "src", "index.vel"), `
import json rawCatalog from "../generated/catalog.json"

type Catalog:
    readonly name: string

const catalog = Catalog.parse(rawCatalog)
export const catalogName = catalog.name
`.trimStart(), "utf8");

  const runExecution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "run"], { cwd: directory, encoding: "utf8" });
  assert.equal(runExecution.status, 0, String(runExecution.stderr));
  assert.equal(runExecution.stdout, "blocks:blocks\n");

  const testExecution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test"], { cwd: directory, encoding: "utf8" });
  assert.equal(testExecution.status, 0, String(testExecution.stderr));
  assert.match(testExecution.stdout, /catalog\.test\.vel" :: "the declared package resource loads"/u);

  const output = join(directory, "dist");
  const buildExecution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build"], { cwd: directory, encoding: "utf8" });
  assert.equal(buildExecution.status, 0, String(buildExecution.stderr));
  assert.equal(await readFile(join(output, "node_modules", "catalog-package", "generated", "catalog.json"), "utf8"), JSON.stringify({ name: "blocks" }));
  const generatedManifest = JSON.parse(await readFile(join(output, "node_modules", "catalog-package", "package.json"), "utf8")) as { exports: Record<string, string> };
  assert.equal(generatedManifest.exports["./catalog"], "./generated/catalog.json.js");
  const runtime = spawnSync(process.execPath, [join(output, "main.js")], { cwd: directory, encoding: "utf8" });
  assert.equal(runtime.status, 0, String(runtime.stderr));
  assert.equal(runtime.stdout, "blocks:blocks\n");
  assert.equal(
    await readFile(join(output, "__velar_packages__", "catalog-package", "generated", "catalog.json"), "utf8"),
    JSON.stringify({ name: "blocks" }),
  );

  await writeFile(join(packageRoot, "generated", "catalog.json"), "{broken", "utf8");
  const invalidJson = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check"], { cwd: directory, encoding: "utf8" });
  assert.equal(invalidJson.status, 1);
  assert.match(invalidJson.stderr, /Cannot load json resource 'catalog-package\/catalog'.*JSON is invalid/u);

  await writeFile(join(packageRoot, "generated", "catalog.json"), new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
  const invalidUtf8 = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check"], { cwd: directory, encoding: "utf8" });
  assert.equal(invalidUtf8.status, 1);
  assert.match(invalidUtf8.stderr, /Cannot load json resource 'catalog-package\/catalog'.*not valid UTF-8/u);

  await writeFile(join(packageRoot, "generated", "catalog.json"), JSON.stringify({ name: "blocks" }), "utf8");
  packageManifest.exports["./catalog"] = "./generated/other.json";
  await writeFile(join(packageRoot, "package.json"), JSON.stringify(packageManifest), "utf8");
  const mismatchedExport = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check"], { cwd: directory, encoding: "utf8" });
  assert.equal(mismatchedExport.status, 1);
  assert.match(mismatchedExport.stderr, /resource '\.\/catalog' must point to '\.\/generated\/catalog\.json' in every package\.json export condition/u);

  packageManifest.exports["./catalog"] = "./generated/catalog.json";
  await writeFile(join(packageRoot, "package.json"), JSON.stringify(packageManifest), "utf8");
  const outside = join(directory, "outside.json");
  await writeFile(outside, JSON.stringify({ name: "outside" }), "utf8");
  await unlink(join(packageRoot, "generated", "catalog.json"));
  await symlink(outside, join(packageRoot, "generated", "catalog.json"));
  const linkedResource = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check"], { cwd: directory, encoding: "utf8" });
  assert.equal(linkedResource.status, 1);
  assert.match(linkedResource.stderr, /cannot escape .* through a symbolic link/u);
});

test("framework-free builds isolate self-package JSON resource imports from the source manifest", async () => {
  const directory = await makeTemporaryDirectory("velar-self-package-resource-");
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "generated"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/index.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "package.json"), JSON.stringify({
    name: "self-catalog",
    version: "1.0.0",
    type: "module",
    exports: {
      ".": "./dist/index.js",
      "./catalog": "./generated/catalog.json",
    },
    velar: {
      entry: "src/index.vel",
      targets: ["node"],
      requires: { capabilities: ["node"] },
      resources: {
        "./catalog": { path: "generated/catalog.json", type: "json" },
      },
    },
  }), "utf8");
  await writeFile(join(directory, "generated", "catalog.json"), JSON.stringify({ name: "blocks" }), "utf8");
  await writeFile(join(directory, "src", "index.vel"), `
import json rawCatalog from "self-catalog/catalog"

type Catalog:
    readonly name: string

print(Catalog.parse(rawCatalog).name)
`.trimStart(), "utf8");

  const build = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build", "--mode", "readable"], { cwd: directory, encoding: "utf8" });
  assert.equal(build.status, 0, String(build.stderr));
  const output = await readFile(join(directory, "dist", "index.js"), "utf8");
  assert.match(output, /from "\.\/node_modules\/self-catalog\/generated\/catalog\.json\.js"/u);
  const runtime = spawnSync(process.execPath, [join(directory, "dist", "index.js")], { cwd: directory, encoding: "utf8" });
  assert.equal(runtime.status, 0, String(runtime.stderr));
  assert.equal(runtime.stdout, "blocks\n");
});
