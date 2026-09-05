import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { resolveBrowserNpm } from "../packages/cli/src/npm.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { checkResolvedProject } from "../packages/cli/src/project-check.ts";
import { buildProductionFramework } from "../packages/cli/src/production-build.ts";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = new URL("../packages/cli/src/cli.ts", import.meta.url).pathname;
const webPackageRoot = fileURLToPath(new URL("../packages/web", import.meta.url));
const packageName = "@fixture/frozen-catalog";

function runCli(arguments_: readonly string[], cwd: string): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function linkLibrary(consumer: string, library: string): Promise<void> {
  const scope = join(consumer, "node_modules", "@fixture");
  await mkdir(scope, { recursive: true });
  await symlink(library, join(scope, "frozen-catalog"), "dir");
}

async function linkWebExtension(consumer: string): Promise<void> {
  const scope = join(consumer, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(webPackageRoot, join(scope, "web"), "dir");
}

test("frozen root and subpath entries coexist with a package JSON resource in every Node output", async () => {
  const root = await makeTemporaryDirectory("velar-artifact-resource-");
  const library = join(root, "library");
  const consumer = join(root, "consumer");
  await mkdir(join(library, "src"), { recursive: true });
  await mkdir(join(library, "generated"), { recursive: true });
  await mkdir(join(consumer, "src"), { recursive: true });
  await writeFile(join(library, "package.json"), `${JSON.stringify({
    name: packageName,
    version: "1.0.0",
    type: "module",
    exports: {
      ".": "./dist/index.js",
      "./worker": "./dist/worker.js",
      "./alias": "./dist/worker.js",
      "./catalog": "./generated/catalog.json",
    },
    velar: {
      entry: "src/index.vel",
      entries: { "./worker": "src/worker.vel", "./alias": "src/worker.vel" },
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core", "node"],
      requires: { capabilities: [] },
      resources: { "./catalog": { path: "generated/catalog.json", type: "json" } },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(library, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(library, "generated", "catalog.json"), JSON.stringify({ label: "catalog" }), "utf8");
  await writeFile(join(library, "src", "worker.vel"), "export def workerLabel() -> string:\n    return \"worker\"\n", "utf8");
  await writeFile(join(library, "src", "index.vel"), [
    `import {workerLabel} from "${packageName}/worker"`,
    `import json rawCatalog from "${packageName}/catalog"`,
    "",
    "type Catalog:",
    "    readonly label: string",
    "",
    "export def rootLabel() -> string:",
    "    return f\"root:{workerLabel()}:{Catalog.parse(rawCatalog).label}\"",
    "",
  ].join("\n"), "utf8");

  const builtLibrary = runCli(["build-library", library], root);
  assert.equal(builtLibrary.status, 0, `${builtLibrary.stdout}${builtLibrary.stderr}`);
  assert.match(builtLibrary.stdout, /3 entries/u);

  await linkLibrary(consumer, library);
  await writeFile(join(consumer, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  const imports = [
    `import {rootLabel} from "${packageName}"`,
    `import {workerLabel} from "${packageName}/worker"`,
    `import {workerLabel as aliasLabel} from "${packageName}/alias"`,
    `import json rawCatalog from "${packageName}/catalog"`,
    "",
    "type Catalog:",
    "    readonly label: string",
    "",
  ];
  await writeFile(join(consumer, "src", "main.vel"), [
    ...imports,
    "print(f\"{rootLabel()}:{workerLabel()}:{aliasLabel()}:{Catalog.parse(rawCatalog).label}\")",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(consumer, "src", "catalog.test.vel"), [
    'import {expect} from "velar/test"',
    ...imports,
    'test "the frozen package namespace stays whole":',
    '    expect(f"{rootLabel()}:{workerLabel()}:{aliasLabel()}:{Catalog.parse(rawCatalog).label}").toBe("root:worker:catalog:worker:worker:catalog")',
    "",
  ].join("\n"), "utf8");
  const rootOnly = join(consumer, "src", "root-only.vel");
  await writeFile(rootOnly, [
    `import {rootLabel} from "${packageName}"`,
    "",
    "print(rootLabel())",
    "",
  ].join("\n"), "utf8");

  const checked = runCli(["check"], consumer);
  assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
  const devProject = await compileProject(join(consumer, "src", "main.vel"), new Map(), { projectRoot: consumer });
  const browser = await resolveBrowserNpm(devProject);
  assert.deepEqual(browser.failures, []);
  assert.match(browser.imports[packageName] ?? "", /\/@npm\/@fixture\/frozen-catalog\//u);
  assert.match(browser.imports[`${packageName}/worker`] ?? "", /\/@npm\/@fixture\/frozen-catalog\//u);
  assert.match(browser.imports[`${packageName}/alias`] ?? "", /\/@npm\/@fixture\/frozen-catalog\//u);
  assert.match(browser.imports[`${packageName}/catalog`] ?? "", /\/@npm\/@fixture\/frozen-catalog\/catalog\.js$/u);
  const ran = runCli(["run"], consumer);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(ran.stdout, "root:worker:catalog:worker:worker:catalog\n");
  const ranRootOnly = runCli(["run", rootOnly], consumer);
  assert.equal(ranRootOnly.status, 0, `${ranRootOnly.stdout}${ranRootOnly.stderr}`);
  assert.equal(ranRootOnly.stdout, "root:worker:catalog\n");
  const tested = runCli(["test"], consumer);
  assert.equal(tested.status, 0, `${tested.stdout}${tested.stderr}`);
  assert.match(tested.stdout, /the frozen package namespace stays whole/u);

  const built = runCli(["build", "--source-maps"], consumer);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const manifest = JSON.parse(await readFile(join(consumer, "dist", "node_modules", "@fixture", "frozen-catalog", "package.json"), "utf8")) as {
    readonly exports: Readonly<Record<string, string>>;
  };
  assert.deepEqual(manifest.exports, {
    ".": "./dist/index.js",
    "./worker": "./dist/worker.js",
    "./alias": "./dist/worker.js",
    "./catalog": "./generated/catalog.json.js",
  });
  const frozenBuildEntry = join(consumer, "dist", "node_modules", "@fixture", "frozen-catalog", "dist", "index.js");
  assert.match(await readFile(frozenBuildEntry, "utf8"), /sourceMappingURL=index\.js\.map/u);
  await readFile(`${frozenBuildEntry}.map`, "utf8");
  const runtime = spawnSync(process.execPath, [join(consumer, "dist", "main.js")], { cwd: consumer, encoding: "utf8" });
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.equal(runtime.stdout, "root:worker:catalog:worker:worker:catalog\n");

  const nodeConsumer = join(root, "node-consumer");
  const created = runCli(["create", nodeConsumer, "--template", "node"], root);
  assert.equal(created.status, 0, `${created.stdout}${created.stderr}`);
  await linkLibrary(nodeConsumer, library);
  await writeFile(join(nodeConsumer, "src", "main.vel"), [
    ...imports,
    "@main: print(f\"{rootLabel()}:{workerLabel()}:{aliasLabel()}:{Catalog.parse(rawCatalog).label}\")",
    "",
  ].join("\n"), "utf8");
  const nodeOutput = join(nodeConsumer, "production");
  const nodeBuild = runCli(["build", "--source-maps", "--out-dir", nodeOutput], nodeConsumer);
  assert.equal(nodeBuild.status, 0, `${nodeBuild.stdout}${nodeBuild.stderr}`);
  const nodeRuntime = spawnSync(process.execPath, [join(nodeOutput, "main.js")], { cwd: nodeOutput, encoding: "utf8" });
  assert.equal(nodeRuntime.status, 0, nodeRuntime.stderr);
  assert.equal(nodeRuntime.stdout, "root:worker:catalog:worker:worker:catalog\n");
  const nodeFrozenEntry = join(nodeOutput, "node_modules", "@fixture", "frozen-catalog", "dist", "index.js");
  assert.match(await readFile(nodeFrozenEntry, "utf8"), /sourceMappingURL=index\.js\.map/u);
  await readFile(`${nodeFrozenEntry}.map`, "utf8");
});

test("browser page and Worker builds consume one verified frozen dependency snapshot", async () => {
  const root = await makeTemporaryDirectory("velar-nested-frozen-browser-");
  const frozen = join(root, "frozen");
  const source = join(root, "source");
  const application = join(root, "application");
  await mkdir(join(frozen, "src"), { recursive: true });
  await mkdir(join(frozen, "node_modules", "deep-browser-dep"), { recursive: true });
  await mkdir(join(source, "src"), { recursive: true });
  await mkdir(join(source, "node_modules"), { recursive: true });
  await mkdir(join(application, "src"), { recursive: true });
  await mkdir(join(application, "node_modules"), { recursive: true });
  await writeFile(join(frozen, "package.json"), JSON.stringify({
    name: "nested-frozen",
    version: "1.0.0",
    type: "module",
    dependencies: { "deep-browser-dep": "1.0.0" },
    exports: { ".": "./dist/index.js", "./secondary": "./dist/secondary.js" },
    velar: {
      entry: "src/index.vel",
      entries: { "./secondary": "src/secondary.vel" },
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  }), "utf8");
  await writeFile(join(frozen, "node_modules", "deep-browser-dep", "package.json"), JSON.stringify({
    name: "deep-browser-dep",
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
  }), "utf8");
  await writeFile(join(frozen, "node_modules", "deep-browser-dep", "index.js"), [
    'export function dependencyLabel() { return "artifact-owned-dependency"; }',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(frozen, "velar.json"), JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }), "utf8");
  await writeFile(join(frozen, "src", "shared.vel"), [
    'extern module "deep-browser-dep":',
    "    export def dependencyLabel() -> string",
    "",
    'import js {dependencyLabel} from "deep-browser-dep"',
    "",
    "export def sharedLabel() -> string:",
    '    return f"nested-frozen-value:{dependencyLabel()}"',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(frozen, "src", "index.vel"), [
    'import {sharedLabel} from "./shared.vel"',
    "export def nestedLabel() -> string: return sharedLabel()",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(frozen, "src", "secondary.vel"), [
    'import {sharedLabel} from "./shared.vel"',
    "export def secondaryLabel() -> string: return sharedLabel()",
    "",
  ].join("\n"), "utf8");
  const frozenBuild = runCli(["build-library", frozen], root);
  assert.equal(frozenBuild.status, 0, `${frozenBuild.stdout}${frozenBuild.stderr}`);

  await writeFile(join(source, "package.json"), JSON.stringify({
    name: "source-owner",
    version: "1.0.0",
    type: "module",
    dependencies: { "nested-frozen": "1.0.0" },
    velar: {
      entry: "src/index.vel",
      targets: ["core"],
      requires: { capabilities: [] },
    },
  }), "utf8");
  await writeFile(join(source, "src", "index.vel"), [
    'import {nestedLabel} from "nested-frozen"',
    "export def label() -> string: return nestedLabel()",
    "",
  ].join("\n"), "utf8");
  await symlink(frozen, join(source, "node_modules", "nested-frozen"), "dir");
  await symlink(source, join(application, "node_modules", "source-owner"), "dir");
  await linkWebExtension(application);
  await writeFile(join(application, "velar.json"), JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "application",
    entry: "src/main.vel",
    workers: { nested: "src/nested-worker.vel" },
    outDir: "dist",
    publicDir: "public",
    extensions: ["@velarscript/web"],
    web: { title: "Nested frozen dependency" },
  }), "utf8");
  await writeFile(join(application, "src", "main.vel"), [
    'import {label} from "source-owner"',
    "component App:",
    "    return <main>{label()}</main>",
    "@main: mount(<App />, \"#app\")",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(application, "src", "nested-worker.vel"), [
    'import {label} from "source-owner"',
    "export def workerLabel() -> string: return label()",
    "",
  ].join("\n"), "utf8");

  const config = await resolveVelarProject(application);
  const checked = await checkResolvedProject(config, null);
  assert.deepEqual(checked.errors, []);

  const [artifact] = checked.project.velarArtifactImports.values();
  assert.ok(artifact);
  assert.ok(artifact.chunkSnapshots.length > 0);
  const changedSnapshot = artifact.chunkSnapshots.find((snapshot) => snapshot.code.includes("nested-frozen-value"));
  assert.ok(changedSnapshot, "the shared module must be emitted as a verified chunk snapshot");
  const artifactCode = await readFile(changedSnapshot.path, "utf8");
  assert.match(artifactCode, /nested-frozen-value/u);
  await writeFile(changedSnapshot.path, artifactCode.replace("nested-frozen-value", "mutated-after-check"), "utf8");
  try {
    await rm(join(application, ".velar", "dev-deps"), { recursive: true, force: true });
    const browser = await resolveBrowserNpm(checked.project);
    assert.deepEqual(browser.failures, []);
    assert.match(browser.imports["nested-frozen"] ?? "", /\/@npm\/nested-frozen\/index\.js$/u);
    const frozenPackage = browser.packages.find((package_) => package_.name === "nested-frozen");
    assert.ok(frozenPackage);
    const devMeta = JSON.parse(await readFile(join(frozenPackage.serveRoot, "meta.json"), "utf8")) as {
      readonly formatVersion: number;
      readonly files: readonly string[];
      readonly fingerprint: {
        readonly inputs: Readonly<Record<string, unknown>>;
        readonly snapshots: Readonly<Record<string, { readonly sha256: string }>>;
      };
    };
    assert.equal(devMeta.formatVersion, 3);
    const devBundle = (await Promise.all(devMeta.files.map((file) => readFile(join(frozenPackage.serveRoot, file), "utf8")))).join("\n");
    assert.match(devBundle, /nested-frozen-value/u);
    assert.match(devBundle, /deep-browser-dep/u);
    assert.doesNotMatch(devBundle, /mutated-after-check/u);
    assert.deepEqual(devMeta.fingerprint.inputs, {});
    const authenticatedPaths = new Set([...artifact.entrySnapshots, ...artifact.chunkSnapshots]
      .flatMap((snapshot) => [snapshot.path, snapshot.sourceMapPath]));
    assert.equal(Object.keys(devMeta.fingerprint.snapshots).length, authenticatedPaths.size);
    const frozenIdentity = await realpath(frozen);
    const snapshotPath = relative(frozenIdentity, changedSnapshot.path).replaceAll("\\", "/");
    const sourceMapPath = relative(frozenIdentity, changedSnapshot.sourceMapPath).replaceAll("\\", "/");
    assert.equal(devMeta.fingerprint.snapshots[snapshotPath]?.sha256, createHash("sha256").update(artifactCode).digest("hex"));
    assert.ok(devMeta.fingerprint.snapshots[sourceMapPath], "the authenticated source map must participate in the cache key");
    const reusedBrowser = await resolveBrowserNpm(checked.project);
    assert.deepEqual(reusedBrowser.failures, []);

    const snapshotOutput = join(application, "snapshot-build");
    const snapshotBuild = await buildProductionFramework(checked.project, snapshotOutput, "production", true);
    const snapshotEntry = await readFile(join(snapshotOutput, snapshotBuild.entryPath), "utf8");
    assert.match(snapshotEntry, /nested-frozen-value/u);
    assert.match(snapshotEntry, /artifact-owned-dependency/u);
    assert.doesNotMatch(snapshotEntry, /mutated-after-check/u);
    const snapshotWorker = await readFile(join(snapshotOutput, "nested-worker.js"), "utf8");
    assert.match(snapshotWorker, /nested-frozen-value/u);
    assert.match(snapshotWorker, /artifact-owned-dependency/u);
    assert.doesNotMatch(snapshotWorker, /mutated-after-check/u);
    await readFile(join(snapshotOutput, "nested-worker.js.map"), "utf8");
  } finally {
    await writeFile(changedSnapshot.path, artifactCode, "utf8");
  }

  const built = runCli(["build"], application);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const manifest = JSON.parse(await readFile(join(application, "dist", "velar-build.json"), "utf8")) as {
    readonly entry: string;
    readonly dependencies: { readonly velar: readonly string[] };
  };
  assert.deepEqual(manifest.dependencies.velar, ["nested-frozen", "source-owner"]);
  assert.match(await readFile(join(application, "dist", manifest.entry), "utf8"), /nested-frozen-value/u);
  assert.match(await readFile(join(application, "dist", manifest.entry), "utf8"), /artifact-owned-dependency/u);

  const nodeApplication = join(root, "node-application");
  await mkdir(join(nodeApplication, "node_modules"), { recursive: true });
  await symlink(source, join(nodeApplication, "node_modules", "source-owner"), "dir");
  await writeFile(join(nodeApplication, "main.vel"), [
    'import {label} from "source-owner"',
    "print(label())",
    "",
  ].join("\n"), "utf8");
  const ran = runCli(["run", join(nodeApplication, "main.vel")], nodeApplication);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(ran.stdout, "nested-frozen-value:artifact-owned-dependency\n");
  await writeFile(join(nodeApplication, "velar.json"), JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    entry: "main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }), "utf8");
  const nodeBuild = runCli(["build"], nodeApplication);
  assert.equal(nodeBuild.status, 1);
  assert.match(nodeBuild.stderr, /imports external npm dependency 'deep-browser-dep'.*require dependency-free frozen artifacts/u);

  const sharedSourcePath = join(frozen, "src", "shared.vel");
  const sharedSource = await readFile(sharedSourcePath, "utf8");
  await writeFile(sharedSourcePath, sharedSource.replace("nested-frozen-value", "rebuilt-frozen-value"), "utf8");
  const rebuiltLibrary = runCli(["build-library", frozen], root);
  assert.equal(rebuiltLibrary.status, 0, `${rebuiltLibrary.stdout}${rebuiltLibrary.stderr}`);
  const rebuiltConfig = await resolveVelarProject(application);
  const rebuiltProject = await checkResolvedProject(rebuiltConfig, null);
  assert.deepEqual(rebuiltProject.errors, []);
  const rebuiltBrowser = await resolveBrowserNpm(rebuiltProject.project);
  assert.deepEqual(rebuiltBrowser.failures, []);
  const rebuiltPackage = rebuiltBrowser.packages.find((package_) => package_.name === "nested-frozen");
  assert.ok(rebuiltPackage);
  const rebuiltMeta = JSON.parse(await readFile(join(rebuiltPackage.serveRoot, "meta.json"), "utf8")) as { readonly files: readonly string[] };
  const rebuiltBundle = (await Promise.all(rebuiltMeta.files.map((file) => readFile(join(rebuiltPackage.serveRoot, file), "utf8")))).join("\n");
  assert.match(rebuiltBundle, /rebuilt-frozen-value/u);
  assert.doesNotMatch(rebuiltBundle, /nested-frozen-value/u);
});
