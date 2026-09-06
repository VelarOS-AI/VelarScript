import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { BUILD_OUTPUT_RECEIPT } from "../packages/cli/src/build-output-directory.ts";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { checkResolvedProject } from "../packages/cli/src/project-check.ts";
import { VelarProjectSessions } from "../packages/cli/src/project-session.ts";
import { projectSessionDiagnostics } from "../packages/cli/src/project-session-diagnostics.ts";
import { writeReproduction } from "../packages/cli/src/reproduction.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));
const webPackage = fileURLToPath(new URL("../packages/web", import.meta.url));

interface Execution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(root: string, ...arguments_: readonly string[]): Execution {
  const result = spawnSync(process.execPath, [cli, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

async function sourcePackage(
  name: string,
  sources: Readonly<Record<string, string>>,
  entries: Readonly<Record<string, string>> = { "./worker": "src/worker.vel" },
): Promise<string> {
  const root = await makeTemporaryDirectory(name);
  await mkdir(join(root, "node_modules", "@velarscript"), { recursive: true });
  await symlink(webPackage, join(root, "node_modules", "@velarscript", "web"), "dir");
  await writeTree(root, {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "src/index.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
    }, null, 2)}\n`,
    "package.json": `${JSON.stringify({
      name: "web-source-package",
      version: "1.0.0",
      private: true,
      type: "module",
      exports: { ".": "./dist/index.js", "./worker": "./dist/worker.js" },
      velar: {
        entry: "src/index.vel",
        entries,
        targets: ["web", "desktop"],
        requires: { capabilities: ["web"] },
      },
    }, null, 2)}\n`,
    ...sources,
  });
  return root;
}

async function removePackageExports(root: string): Promise<void> {
  const path = join(root, "package.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  Reflect.deleteProperty(manifest, "exports");
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

test("ordinary Web library builds emit every declared source-package entry as one union graph", async () => {
  const root = await sourcePackage("velar-source-package-build-", {
    "src/shared.vel": "export const shared = 42\n",
    "src/index.vel": [
      'import {shared} from "./shared.vel"',
      "export def rootValue() -> number: return shared",
      "",
    ].join("\n"),
    "src/worker.vel": [
      'import {shared} from "./shared.vel"',
      "export def workerValue() -> number: return shared",
      "",
    ].join("\n"),
    "src/orphan.vel": "export const checkedButNotPublished = true\n",
  });

  const checked = runCli(root, "check");
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.match(checked.stdout, /Checked 4 modules/u);

  const built = runCli(root, "build", "--mode", "readable");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.match(built.stdout, /Built readable 3 modules/u);
  assert.deepEqual((await readdir(join(root, "dist"))).sort(), [BUILD_OUTPUT_RECEIPT, "index.js", "shared.js", "worker.js"]);
  assert.match(await readFile(join(root, "dist", "index.js"), "utf8"), /from\s+"\.\/shared\.js"/u);
  assert.match(await readFile(join(root, "dist", "worker.js"), "utf8"), /from\s+"\.\/shared\.js"/u);
});

test("source-package JSON may leave src only through a declared package resource", async () => {
  const root = await sourcePackage("velar-source-package-root-resource-", {
    "src/index.vel": 'import json config from "../data/config.json"\nexport const rawConfig = config\n',
    "src/worker.vel": "export const workerValue = 2\n",
    "data/config.json": '{"name":"velar"}\n',
  });
  const refused = runCli(root, "check");
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /must declare 'data\/config\.json' in package\.json#velar\.resources/u);
  const entry = join(root, "src", "index.vel");
  const snapshot = await new VelarProjectSessions().snapshot(entry);
  assert.ok(projectSessionDiagnostics(snapshot, entry).some((item) =>
    item.message.includes("must declare 'data/config.json'")));
  const fixed = runCli(root, "fix");
  assert.equal(fixed.status, 1, fixed.stdout + fixed.stderr);
  assert.match(fixed.stderr, /must declare 'data\/config\.json'/u);

  const packagePath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(packagePath, "utf8")) as {
    exports: Record<string, string>;
    velar: { resources?: Record<string, unknown> };
  };
  manifest.exports["./config"] = "./data/config.json";
  manifest.velar.resources = { "./config": { path: "data/config.json", type: "json" } };
  await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const checked = runCli(root, "check");
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.deepEqual((await new VelarProjectSessions().snapshot(entry)).project.failures, []);
  const built = runCli(root, "build", "--mode", "readable");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const resource = join(root, "dist", "__velar_packages__", "web-source-package", "data", "config.json");
  assert.equal(await readFile(resource, "utf8"), '{"name":"velar"}\n');
  assert.match(await readFile(join(root, "dist", "index.js"), "utf8"), /__velar_packages__\/web-source-package\/data\/config\.json\.js/u);
});

test("source-package modules cannot leave src or emit through the staging parent", async () => {
  const root = await sourcePackage("velar-source-package-module-escape-", {
    "src/index.vel": 'import {shared} from "../shared.vel"\nexport const value = shared\n',
    "src/worker.vel": "export const workerValue = 2\n",
    "shared.vel": "export const shared = 42\n",
  });
  const built = runCli(root, "build");
  assert.equal(built.status, 1, built.stdout + built.stderr);
  assert.match(built.stderr, /Relative import '\.\.\/shared\.vel' cannot escape the entry source directory/u);
  await assert.rejects(lstat(join(root, "shared.js")), { code: "ENOENT" });
  await assert.rejects(lstat(join(root, "dist")), { code: "ENOENT" });
});

test("only declared library entries gain entry semantics; explicit file commands stay narrow", async () => {
  const root = await sourcePackage("velar-source-package-scope-", {
    "src/index.vel": "export const rootValue = 1\n",
    "src/worker.vel": "export const workerValue = 2\n\n@main: pass\n",
    "src/orphan.vel": "export const orphanValue = 3\n\n@main: pass\n",
  });

  const wholeProject = runCli(root, "check");
  assert.equal(wholeProject.status, 1, wholeProject.stdout + wholeProject.stderr);
  assert.match(wholeProject.stderr, /src\/worker\.vel: A library entry cannot declare '@main'/u);
  assert.doesNotMatch(wholeProject.stderr, /src\/orphan\.vel: A library entry cannot declare '@main'/u);
  const fixed = runCli(root, "fix");
  assert.equal(fixed.status, 1, fixed.stdout + fixed.stderr);
  assert.match(fixed.stderr, /src\/worker\.vel: A library entry cannot declare '@main'/u);

  const explicitCheck = runCli(root, "check", "src/index.vel");
  assert.equal(explicitCheck.status, 0, explicitCheck.stdout + explicitCheck.stderr);
  const explicitOutput = join(root, "single", "index.js");
  const explicitBuild = runCli(root, "build", "src/index.vel", "--out", explicitOutput, "--mode", "readable");
  assert.equal(explicitBuild.status, 0, explicitBuild.stdout + explicitBuild.stderr);
  assert.equal((await readdir(join(root, "single"))).sort().join(","), "index.js");
  assert.match(await readFile(explicitOutput, "utf8"), /rootValue/u);
});

test("ordinary source-package producers reject malformed and missing declared entries", async () => {
  const malformed = await sourcePackage(
    "velar-source-package-malformed-",
    { "src/index.vel": "export const rootValue = 1\n", "src/worker.vel": "export const workerValue = 2\n" },
    { "./*": "src/worker.vel" },
  );
  const malformedCheck = runCli(malformed, "check");
  assert.equal(malformedCheck.status, 1, malformedCheck.stdout + malformedCheck.stderr);
  assert.match(malformedCheck.stderr, /^velar check: /u);
  assert.match(malformedCheck.stderr, /velar\.entries key '\.\/\*' must be an exact '\.\/name' package subpath/u);

  const missing = await sourcePackage(
    "velar-source-package-missing-",
    { "src/index.vel": "export const rootValue = 1\n" },
    { "./worker": "src/missing.vel" },
  );
  const missingBuild = runCli(missing, "build");
  assert.equal(missingBuild.status, 1, missingBuild.stdout + missingBuild.stderr);
  assert.match(missingBuild.stderr, /^velar build: /u);
  assert.match(missingBuild.stderr, /entry '\.\/worker' points to missing source 'src\/missing\.vel'/u);
});

test("declared entries cannot escape the root entry source directory", async () => {
  const root = await sourcePackage(
    "velar-source-package-output-root-",
    { "src/index.vel": "export const rootValue = 1\n", "outside.vel": "export const outsideValue = 2\n" },
    { "./outside": "outside.vel" },
  );
  const built = runCli(root, "build");
  assert.equal(built.status, 1, built.stdout + built.stderr);
  assert.match(built.stderr, /^velar build: /u);
  assert.match(built.stderr, /velar\.entries\["\.\/outside"\] must stay inside the root entry source directory/u);
});

test("a declared entry inside outDir is refused before source or old output can be replaced", async () => {
  const root = await sourcePackage(
    "velar-source-package-output-input-",
    {
      "src/index.vel": "export const rootValue = 1\n",
      "src/dist/worker.vel": "export const workerValue = 2\n",
      "src/dist/sentinel.txt": "old output\n",
    },
    { "./worker": "src/dist/worker.vel" },
  );
  await removePackageExports(root);
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    kind: "library",
    entry: "src/index.vel",
    outDir: "src/dist",
    extensions: ["@velarscript/web"],
  }, null, 2)}\n`, "utf8");
  const source = await readFile(join(root, "src", "dist", "worker.vel"), "utf8");
  const built = runCli(root, "build");
  assert.equal(built.status, 1, built.stdout + built.stderr);
  assert.match(built.stderr, /refusing to replace .*dist.*contains checked input .*worker\.vel/u);
  assert.equal(await readFile(join(root, "src", "dist", "worker.vel"), "utf8"), source);
  assert.equal(await readFile(join(root, "src", "dist", "sentinel.txt"), "utf8"), "old output\n");
});

test("a symlinked entry whose identity is inside outDir is refused without replacing either file", async () => {
  const root = await sourcePackage(
    "velar-source-package-output-symlink-",
    {
      "src/index.vel": "export const rootValue = 1\n",
      "src/dist/worker.vel": "export const workerValue = 2\n",
      "src/dist/sentinel.txt": "old output\n",
    },
    { "./worker": "src/linked-worker.vel" },
  );
  await removePackageExports(root);
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    kind: "library",
    entry: "src/index.vel",
    outDir: "src/dist",
    extensions: ["@velarscript/web"],
  }, null, 2)}\n`, "utf8");
  await symlink("dist/worker.vel", join(root, "src", "linked-worker.vel"));
  const built = runCli(root, "build", "--force");
  assert.equal(built.status, 1, built.stdout + built.stderr);
  assert.match(built.stderr, /refusing to replace .*dist.*contains checked input .*worker\.vel/u);
  assert.equal(await readFile(join(root, "src", "dist", "worker.vel"), "utf8"), "export const workerValue = 2\n");
  assert.equal(await readFile(join(root, "src", "dist", "sentinel.txt"), "utf8"), "old output\n");
});

test("an --out-dir override cannot replace a compiled dependency even with --force", async () => {
  const root = await sourcePackage("velar-source-package-output-override-", {
    "src/index.vel": 'import {value} from "./generated/..worker.vel"\nexport const rootValue = value\n',
    "src/worker.vel": "export const workerValue = 2\n",
    "src/generated/..worker.vel": "export const value = 3\n",
    "src/generated/sentinel.txt": "old output\n",
  });
  const built = runCli(root, "build", "--out-dir", "src/generated", "--force");
  assert.equal(built.status, 1, built.stdout + built.stderr);
  assert.match(built.stderr, /refusing to replace .*generated.*contains checked input .*\.\.worker\.vel/u);
  assert.equal(await readFile(join(root, "src", "generated", "..worker.vel"), "utf8"), "export const value = 3\n");
  assert.equal(await readFile(join(root, "src", "generated", "sentinel.txt"), "utf8"), "old output\n");
});

test("output options cannot silently narrow a directory check or build", async () => {
  const root = await sourcePackage("velar-source-package-output-option-", {
    "src/index.vel": "export const rootValue = 1\n",
    "src/worker.vel": "export const workerValue = 2\n\n@main: pass\n",
  });
  const checked = runCli(root, "check", "--out", "ignored.js");
  assert.equal(checked.status, 2, checked.stdout + checked.stderr);
  assert.match(checked.stderr, /velar check: unknown option '--out'/u);

  const built = runCli(root, "build", "--out", "one.js");
  assert.equal(built.status, 2, built.stdout + built.stderr);
  assert.match(built.stderr, /velar build: --out requires an explicit \.vel source input/u);
  assert.equal(await readFile(join(root, "src", "worker.vel"), "utf8"), "export const workerValue = 2\n\n@main: pass\n");
});

test("existing package exports must match source-relative ordinary build outputs", async () => {
  const root = await sourcePackage(
    "velar-source-package-exports-",
    {
      "src/index.vel": "export const rootValue = 1\n",
      "src/workers/worker.vel": "export const workerValue = 2\n",
    },
    { "./worker": "src/workers/worker.vel" },
  );
  const rejected = runCli(root, "build");
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  assert.match(rejected.stderr, /exports '\.\/worker' selects '\.\/dist\/worker\.js'.*emit '\.\/dist\/workers\/worker\.js'/u);

  const path = join(root, "package.json");
  const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  manifest.exports = { ".": "./dist/index.js", "./worker": "./dist/workers/worker.js" };
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const built = runCli(root, "build", "--mode", "readable");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.equal(await readFile(join(root, "dist", "workers", "worker.js"), "utf8")
    .then((source) => source.includes("workerValue")), true);
});

test("explicit source check, build, and fix do not inspect or rewrite configured workers", async () => {
  const badWorker = 'export def one(value: string) -> bool:\n    return value === "one"\n';
  const root = await sourcePackage("velar-source-package-explicit-worker-", {
    "src/index.vel": "export const rootValue = 1\n",
    "src/worker.vel": "export const workerValue = 2\n",
    "src/bad.vel": badWorker,
  });
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    workers: { bad: "src/bad.vel" },
    extensions: ["@velarscript/web"],
  }, null, 2)}\n`, "utf8");

  const checked = runCli(root, "check", "src/index.vel");
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const built = runCli(root, "build", "src/index.vel", "--out", "single/index.js");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const fixed = runCli(root, "fix", "src/index.vel");
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.equal(await readFile(join(root, "src", "bad.vel"), "utf8"), badWorker);

  const whole = runCli(root, "check");
  assert.equal(whole.status, 1, whole.stdout + whole.stderr);
  assert.match(whole.stderr, /Use '=='; equality is already strict/u);
});

test("single-file output and source-map symlinks cannot overwrite checked source", async () => {
  const source = "export const rootValue = 1\n";
  const root = await sourcePackage("velar-source-package-single-output-", {
    "src/index.vel": source,
    "src/worker.vel": "export const workerValue = 2\n",
  });
  await symlink("index.vel", join(root, "src", "linked.js"));
  const linkedOutput = runCli(root, "build", "src/index.vel", "--out", "src/linked.js");
  assert.equal(linkedOutput.status, 1, linkedOutput.stdout + linkedOutput.stderr);
  assert.match(linkedOutput.stderr, /refusing to write .*linked\.js.*checked source .*index\.vel/u);
  assert.equal(await readFile(join(root, "src", "index.vel"), "utf8"), source);

  await mkdir(join(root, "single"), { recursive: true });
  await symlink("../src/index.vel", join(root, "single", "index.js.map"));
  const linkedMap = runCli(root, "build", "src/index.vel", "--out", "single/index.js", "--source-maps");
  assert.equal(linkedMap.status, 1, linkedMap.stdout + linkedMap.stderr);
  assert.match(linkedMap.stderr, /refusing to write .*index\.js\.map.*checked source .*index\.vel/u);
  assert.equal(await readFile(join(root, "src", "index.vel"), "utf8"), source);
});

test("repro preserves the minimal source-package entry contract", async () => {
  const root = await makeTemporaryDirectory("velar-source-package-repro-");
  await writeTree(root, {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "src/index.vel",
      outDir: "dist",
    }, null, 2)}\n`,
    "package.json": `${JSON.stringify({
      name: "private-producer-name",
      version: "1.0.0",
      private: true,
      velar: {
        entry: "src/index.vel",
        entries: { "./worker": "src/worker.vel" },
        targets: ["core"],
        requires: { capabilities: [] },
      },
    }, null, 2)}\n`,
    "src/index.vel": 'import {workerValue} from "private-producer-name/worker"\nexport const rootValue = workerValue\n',
    "src/worker.vel": "export const workerValue = 2\n\n@main: pass\n",
  });

  const checked = runCli(root, "check");
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.match(checked.stderr, /src\/worker\.vel: A library entry cannot declare '@main'/u);
  const reproduced = runCli(root, "repro");
  assert.equal(reproduced.status, 0, reproduced.stdout + reproduced.stderr);
  assert.match(reproduced.stdout, /The extracted bundle produces the same diagnostics/u);

  const manifest = JSON.parse(await readFile(join(root, ".velar", "repro", "package.json"), "utf8")) as {
    readonly name: string;
    readonly velar: { readonly entry: string; readonly entries: Readonly<Record<string, string>> };
  };
  assert.equal(manifest.name, "private-producer-name");
  assert.equal(manifest.velar.entry, "src/index.vel");
  assert.deepEqual(manifest.velar.entries, { "./worker": "src/worker.vel" });
});

test("explicit-source repro preserves only the checked self-package entry contract", async () => {
  const root = await makeTemporaryDirectory("velar-source-package-explicit-repro-");
  await writeTree(root, {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "src/index.vel",
      outDir: "dist",
    }, null, 2)}\n`,
    "package.json": `${JSON.stringify({
      name: "explicit-producer-name",
      version: "1.0.0",
      private: true,
      scripts: { hidden: "must-not-be-carried" },
      dependencies: { "unused-package": "9.9.9" },
      velar: {
        entry: "src/index.vel",
        entries: {
          "./worker": "src/worker.vel",
          "./unused": "src/unused.vel",
        },
        targets: ["core"],
        requires: { capabilities: [] },
      },
    }, null, 2)}\n`,
    "src/index.vel": [
      'import {workerValue} from "explicit-producer-name/worker"',
      'const broken: number = "bad"',
      "export const rootValue = workerValue",
      "",
    ].join("\n"),
    "src/worker.vel": "export const workerValue = 2\n",
    "src/unused.vel": "export const unusedValue = 3\n",
  });

  const reproduced = runCli(root, "repro", "src/index.vel");
  assert.equal(reproduced.status, 0, reproduced.stdout + reproduced.stderr);
  assert.match(reproduced.stdout, /The extracted bundle produces the same diagnostics/u);
  assert.deepEqual((await readdir(join(root, ".velar", "repro", "src"))).sort(), ["index.vel", "worker.vel"]);

  const manifest = JSON.parse(await readFile(join(root, ".velar", "repro", "package.json"), "utf8")) as {
    readonly name: string;
    readonly scripts?: unknown;
    readonly dependencies?: unknown;
    readonly velar: { readonly entry: string; readonly entries: Readonly<Record<string, string>> };
  };
  assert.equal(manifest.name, "explicit-producer-name");
  assert.equal(manifest.velar.entry, "src/index.vel");
  assert.deepEqual(manifest.velar.entries, { "./worker": "src/worker.vel" });
  assert.equal(manifest.scripts, undefined);
  assert.equal(manifest.dependencies, undefined);
});

test("repro carries only used self-package JSON resources from the checked snapshot", async () => {
  const root = await makeTemporaryDirectory("velar-source-package-resource-repro-");
  const catalog = join(root, "generated", "catalog.json");
  await writeTree(root, {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "src/index.vel",
      outDir: "dist",
    }, null, 2)}\n`,
    "package.json": `${JSON.stringify({
      name: "resource-producer-name",
      version: "1.0.0",
      private: true,
      scripts: { hidden: "must-not-be-carried" },
      dependencies: { "unused-package": "9.9.9" },
      exports: {
        ".": "./dist/index.js",
        "./catalog": "./generated/catalog.json",
        "./unused": "./generated/unused.json",
      },
      velar: {
        entry: "src/index.vel",
        targets: ["core"],
        requires: { capabilities: [] },
        resources: {
          "./catalog": { path: "generated/catalog.json", type: "json" },
          "./unused": { path: "generated/unused.json", type: "json" },
        },
      },
    }, null, 2)}\n`,
    "generated/catalog.json": '{"name":"blocks"}\n',
    "generated/unused.json": '{"unused":true}\n',
    "src/index.vel": [
      'import json rawCatalog from "resource-producer-name/catalog"',
      'const broken: number = "bad"',
      "",
    ].join("\n"),
  });

  const config = await resolveVelarProject(root);
  const checked = await checkResolvedProject(config, root);
  assert.equal(checked.errors.length, 1);
  await writeFile(catalog, "not valid JSON\n", "utf8");
  const output = join(root, "resource-reproduction");
  const reproduced = await writeReproduction({
    config,
    input: root,
    checked,
    outputDirectory: output,
    toolchainEntry: cli,
    cwd: root,
  });
  assert.equal(reproduced.reproduced, true);
  assert.equal(await readFile(join(output, "generated", "catalog.json"), "utf8"), '{"name":"blocks"}\n');
  await assert.rejects(readFile(join(output, "generated", "unused.json"), "utf8"), { code: "ENOENT" });

  const manifest = JSON.parse(await readFile(join(output, "package.json"), "utf8")) as {
    readonly scripts?: unknown;
    readonly dependencies?: unknown;
    readonly exports: Readonly<Record<string, string>>;
    readonly velar: { readonly resources: Readonly<Record<string, unknown>> };
  };
  assert.deepEqual(manifest.exports, {
    ".": "./dist/index.js",
    "./catalog": "./generated/catalog.json",
  });
  assert.deepEqual(Object.keys(manifest.velar.resources), ["./catalog"]);
  assert.equal(manifest.scripts, undefined);
  assert.equal(manifest.dependencies, undefined);
});

test("repro relocates a checked self-package resource that owns package.json", async () => {
  const root = await makeTemporaryDirectory("velar-source-package-manifest-resource-repro-");
  const packageManifest = `${JSON.stringify({
    name: "manifest-resource-producer",
    version: "1.0.0",
    private: true,
    marker: "CHECKED_JSON_SENTINEL",
    exports: {
      ".": "./dist/index.js",
      "./metadata": "./package.json",
    },
    velar: {
      entry: "src/index.vel",
      targets: ["core"],
      requires: { capabilities: [] },
      resources: { "./metadata": { path: "package.json", type: "json" } },
    },
  }, null, 2)}\n`;
  await writeTree(root, {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "src/index.vel",
      outDir: "dist",
    }, null, 2)}\n`,
    "package.json": packageManifest,
    "src/index.vel": [
      'import json metadata from "manifest-resource-producer/metadata"',
      'const broken: number = "bad"',
      "",
    ].join("\n"),
  });

  const config = await resolveVelarProject(root);
  const checked = await checkResolvedProject(config, root);
  assert.equal(checked.errors.length, 1);
  await writeFile(join(root, "package.json"), "{}\n", "utf8");
  const output = join(root, "manifest-resource-reproduction");
  const reproduced = await writeReproduction({
    config,
    input: root,
    checked,
    outputDirectory: output,
    toolchainEntry: cli,
    cwd: root,
  });

  assert.equal(reproduced.reproduced, true);
  const minimal = JSON.parse(await readFile(join(output, "package.json"), "utf8")) as {
    readonly marker?: unknown;
    readonly exports: Readonly<Record<string, string>>;
    readonly velar: { readonly resources: Readonly<Record<string, { readonly path: string }>> };
  };
  assert.equal(minimal.marker, undefined);
  const relocated = minimal.velar.resources["./metadata"]!.path;
  assert.notEqual(relocated, "package.json");
  assert.equal(minimal.exports["./metadata"], `./${relocated}`);
  assert.equal(await readFile(join(output, relocated), "utf8"), packageManifest);
});

test("repro preserves one checked package.json used by both relative and self-package imports", async () => {
  const root = await makeTemporaryDirectory("velar-source-package-relative-manifest-repro-");
  const packageManifest = `${JSON.stringify({
    name: "shared-manifest-resource-producer",
    version: "1.0.0",
    private: true,
    marker: "CHECKED_RELATIVE_JSON_SENTINEL",
    exports: {
      ".": "./dist/main.js",
      "./metadata": "./package.json",
    },
    velar: {
      entry: "main.vel",
      targets: ["core"],
      requires: { capabilities: [] },
      resources: { "./metadata": { path: "package.json", type: "json" } },
    },
  }, null, 2)}\n`;
  const source = [
    'import json relativeMetadata from "./package.json"',
    'import json publishedMetadata from "shared-manifest-resource-producer/metadata"',
    'const broken: number = "bad"',
    "",
  ].join("\n");
  await writeTree(root, {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "main.vel",
      outDir: "dist",
    }, null, 2)}\n`,
    "package.json": packageManifest,
    "main.vel": source,
  });

  const config = await resolveVelarProject(root);
  const checked = await checkResolvedProject(config, root);
  assert.equal(checked.errors.length, 1, checked.errors.join("\n"));
  await writeFile(join(root, "package.json"), "{}\n", "utf8");
  const output = join(root, "relative-manifest-reproduction");
  const reproduced = await writeReproduction({
    config,
    input: root,
    checked,
    outputDirectory: output,
    toolchainEntry: cli,
    cwd: root,
  });

  assert.equal(reproduced.reproduced, true);
  assert.equal(await readFile(join(output, "project", "package.json"), "utf8"), packageManifest);
  assert.equal(await readFile(join(output, "project", "main.vel"), "utf8"), source);
  const bootstrap = JSON.parse(await readFile(join(output, "package.json"), "utf8")) as {
    readonly name: string;
    readonly marker?: unknown;
  };
  assert.equal(bootstrap.name, "velar-reproduction");
  assert.equal(bootstrap.marker, undefined);
  const readme = await readFile(join(output, "README.md"), "utf8");
  assert.match(readme, /npm install\ncd project\nnpx velar check\n/u);
  assert.doesNotMatch(readme, /CHECKED_RELATIVE_JSON_SENTINEL/u,
    "the checked manifest stays in the project snapshot instead of leaking into bootstrap prose");
});

test("repro materializes a checked compiler-resource symlink as an ordinary file", async () => {
  const root = await sourcePackage("velar-source-package-repro-resource-", {
    "src/index.vel": 'import css unsafe "./linked.css" before look\nconst broken: number = "bad"\n',
    "src/worker.vel": "export const workerValue = 2\n",
    "src/resource.css": "body { color: rebeccapurple; }\n",
  });
  await symlink("resource.css", join(root, "src", "linked.css"));

  const config = await resolveVelarProject(root);
  const checked = await checkResolvedProject(config, root);
  await writeFile(join(root, "src", "resource.css"), "body { color: red; }\n", "utf8");
  const output = join(root, "compiler-resource-reproduction");
  const reproduced = await writeReproduction({
    config,
    input: root,
    checked,
    outputDirectory: output,
    toolchainEntry: cli,
    cwd: root,
  });
  assert.equal(reproduced.reproduced, true);
  const carried = join(output, "src", "linked.css");
  const metadata = await lstat(carried);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.isSymbolicLink(), false);
  assert.equal(await readFile(carried, "utf8"), "body { color: rebeccapurple; }\n");
});

test("project sessions index every source but execute only producer entries and observe manifest changes", async () => {
  const root = await sourcePackage("velar-source-package-session-", {
    "src/index.vel": "export const rootValue = 1\n\n@main: pass\n",
    "src/worker.vel": "export const workerValue = 2\n\n@main: pass\n",
    "src/orphan.vel": "export const orphanValue = 3\n\n@main: pass\n",
  });
  const document = join(root, "src", "orphan.vel");
  const packagePath = join(root, "package.json");
  const sessions = new VelarProjectSessions();
  const first = await sessions.snapshot(document);
  const displayed = (paths: ReadonlySet<string>): string[] => [...paths]
    .map((path) => relative(root, path).replaceAll("\\", "/")).sort();
  assert.deepEqual(displayed(first.project.executionEntries), ["src/index.vel", "src/worker.vel"]);
  assert.ok(first.project.modules.some((module) => module.inputPath === document), "the orphan remains indexed");
  assert.deepEqual(first.findings.map((finding) => relative(root, finding.path).replaceAll("\\", "/")), [
    "src/index.vel",
    "src/worker.vel",
  ]);
  for (const path of [join(root, "src", "index.vel"), join(root, "src", "worker.vel")]) {
    assert.ok(projectSessionDiagnostics(first, path).some((diagnostic) => diagnostic.code === "VEL9001"
      && diagnostic.message.includes("A library entry cannot declare '@main'")));
  }

  const manifest = JSON.parse(await readFile(packagePath, "utf8")) as {
    exports: Record<string, string>;
    velar: { entries: Record<string, string> };
  };
  manifest.exports = { ".": "./dist/index.js", "./orphan": "./dist/orphan.js" };
  manifest.velar.entries = { "./orphan": "src/orphan.vel" };
  const packageSource = `${JSON.stringify(manifest, null, 2)}\n`;
  const rootPath = join(root, "src", "index.vel");
  const rootSource = [
    'import {orphanValue} from "web-source-package/orphan"',
    "export const rootValue = orphanValue",
    "",
    "@main: pass",
    "",
  ].join("\n");
  const changed = await sessions.update(
    document,
    new Set([packagePath, rootPath]),
    new Map([[packagePath, packageSource], [rootPath, rootSource]]),
  );
  assert.equal(changed.activity.projectReused, false);
  assert.deepEqual(displayed(changed.project.executionEntries), ["src/index.vel", "src/orphan.vel"]);
  assert.deepEqual(changed.project.failures, []);
  assert.ok(changed.project.modules.every((module) => module.result.diagnostics.length === 0));
  assert.deepEqual(changed.findings.map((finding) => relative(root, finding.path).replaceAll("\\", "/")), [
    "src/index.vel",
    "src/orphan.vel",
  ]);
  const diskManifest = JSON.parse(await readFile(packagePath, "utf8")) as { velar: { entries: Record<string, string> } };
  assert.deepEqual(diskManifest.velar.entries, { "./worker": "src/worker.vel" }, "the override stays an editor snapshot");
});

test("project sessions reuse libraries with no package manifest and detect one when it appears", async () => {
  const root = await makeTemporaryDirectory("velar-source-package-session-optional-");
  const entry = join(root, "src", "index.vel");
  const packagePath = join(root, "package.json");
  await writeTree(root, {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "src/index.vel",
      outDir: "dist",
    }, null, 2)}\n`,
    "src/index.vel": "export const rootValue = 1\n",
  });
  const sessions = new VelarProjectSessions();
  const first = await sessions.snapshot(entry);
  const stable = await sessions.snapshot(entry);
  assert.equal(stable.activity.projectReused, true);
  assert.equal(stable.project, first.project);
  assert.deepEqual([...stable.changedPaths], []);

  await writeFile(packagePath, `${JSON.stringify({
    name: "appearing-source-package",
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      targets: ["core"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`, "utf8");
  const appeared = await sessions.snapshot(entry);
  assert.equal(appeared.activity.projectReused, false);
  assert.deepEqual([...appeared.changedPaths], [packagePath]);
});
