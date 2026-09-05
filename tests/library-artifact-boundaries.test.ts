import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { packageRuntimeExportTargets } from "../packages/cli/src/package-exports.ts";
import { checkVelarLibraryEntries, resolveVelarLibraryBuild, writeVelarLibraryArtifact } from "../packages/cli/src/library-artifact-build.ts";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = new URL("../packages/cli/src/cli.ts", import.meta.url).pathname;

interface BoundaryManifest {
  readonly name: string;
  readonly version: string;
  dependencies?: Record<string, string>;
  type: string;
  exports: Record<string, unknown>;
  velar: {
    entry: string;
    entries?: Record<string, string>;
    artifacts: Record<string, string>;
    resources?: Record<string, { path: string; type: "json" }>;
    targets: string[];
    requires: { capabilities: string[] };
  };
}

interface BoundaryFixture {
  readonly root: string;
  readonly library: string;
  readonly manifestPath: string;
  readonly manifest: BoundaryManifest;
}

function runCli(arguments_: readonly string[], cwd: string): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function writeManifest(fixture: BoundaryFixture, manifest: BoundaryManifest): Promise<void> {
  await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function createBoundaryFixture(suffix: string): Promise<BoundaryFixture> {
  const root = await makeTemporaryDirectory(`velar-library-boundary-${suffix}-`);
  const library = join(root, "library");
  await mkdir(join(library, "src"), { recursive: true });
  const manifest: BoundaryManifest = {
    name: `frozen-boundary-${suffix}`,
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core", "node", "web", "desktop"],
      requires: { capabilities: [] },
    },
  };
  const manifestPath = join(library, "package.json");
  await writeManifest({ root, library, manifestPath, manifest }, manifest);
  await writeFile(join(library, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(library, "src", "index.vel"), "export def value() -> string:\n    return \"boundary\"\n", "utf8");
  return { root, library, manifestPath, manifest };
}

test("build-library refuses an application project before inferring an artifact target", async () => {
  const fixture = await createBoundaryFixture("application-kind");
  await writeFile(join(fixture.library, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "application",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  const rejected = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /velar\.json 'kind' must be 'library' to build a library artifact/u);
});

test("build-library preserves declared resource, types, and require files inside its replacement directory", async () => {
  const resourceFixture = await createBoundaryFixture("resource");
  const resourceBytes = "{\"stable\":true}\n";
  await mkdir(join(resourceFixture.library, "dist"), { recursive: true });
  await writeFile(join(resourceFixture.library, "dist", "catalog.json"), resourceBytes, "utf8");
  const resourceManifest = structuredClone(resourceFixture.manifest);
  resourceManifest.exports["./catalog"] = "./dist/catalog.json";
  resourceManifest.velar.resources = { "./catalog": { path: "dist/catalog.json", type: "json" } };
  await writeManifest(resourceFixture, resourceManifest);
  const resourceBuild = runCli(["build-library", resourceFixture.library], resourceFixture.root);
  assert.equal(resourceBuild.status, 1);
  assert.match(resourceBuild.stderr, /velar\.resources.*points inside velar\.json 'outDir'/u);
  assert.equal(await readFile(join(resourceFixture.library, "dist", "catalog.json"), "utf8"), resourceBytes);

  const exportFixture = await createBoundaryFixture("exports");
  const typesBytes = "export declare function value(): string;\n";
  const requireBytes = "exports.value = () => 'legacy';\n";
  await mkdir(join(exportFixture.library, "dist"), { recursive: true });
  await writeFile(join(exportFixture.library, "dist", "index.d.ts"), typesBytes, "utf8");
  await writeFile(join(exportFixture.library, "dist", "index.cjs"), requireBytes, "utf8");
  const exportManifest = structuredClone(exportFixture.manifest);
  exportManifest.exports["."] = {
    types: "./dist/index.d.ts",
    require: "./dist/index.cjs",
    import: "./dist/index.js",
  };
  await writeManifest(exportFixture, exportManifest);
  const exportBuild = runCli(["build-library", exportFixture.library], exportFixture.root);
  assert.equal(exportBuild.status, 1);
  assert.match(exportBuild.stderr, /export target .* is inside velar\.json 'outDir' but is not generated/u);
  assert.equal(await readFile(join(exportFixture.library, "dist", "index.d.ts"), "utf8"), typesBytes);
  assert.equal(await readFile(join(exportFixture.library, "dist", "index.cjs"), "utf8"), requireBytes);
});

test("build-library preserves a transitive package source located directly inside outDir", async () => {
  const fixture = await createBoundaryFixture("transitive-output-source");
  const helperPath = join(fixture.library, "dist", "helper.vel");
  const helper = 'export const helper = "still-source"\n';
  await mkdir(join(fixture.library, "dist"), { recursive: true });
  await writeFile(helperPath, helper, "utf8");
  await writeFile(join(fixture.library, "src", "index.vel"), [
    'import {helper} from "../dist/helper.vel"',
    "export def value() -> string: return helper",
    "",
  ].join("\n"), "utf8");

  const rejected = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Library source 'dist\/helper\.vel' cannot be inside velar\.json 'outDir'/u);
  assert.equal(await readFile(helperPath, "utf8"), helper);
});

test("build-library preserves a transitive source whose symlink identity is inside outDir", async () => {
  const fixture = await createBoundaryFixture("transitive-output-identity");
  const helperPath = join(fixture.library, "dist", "helper.vel");
  const helper = 'export const helper = "still-source"\n';
  await mkdir(join(fixture.library, "dist"), { recursive: true });
  await writeFile(helperPath, helper, "utf8");
  await symlink("../dist/helper.vel", join(fixture.library, "src", "helper.vel"));
  await writeFile(join(fixture.library, "src", "index.vel"), [
    'import {helper} from "./helper.vel"',
    "export def value() -> string: return helper",
    "",
  ].join("\n"), "utf8");

  const rejected = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Library source 'src\/helper\.vel' resolves inside velar\.json 'outDir'/u);
  assert.equal(await readFile(helperPath, "utf8"), helper);
  assert.equal(await readFile(join(fixture.library, "src", "helper.vel"), "utf8"), helper);
});

test("build-library reserves its transaction marker and package scope metadata", async () => {
  const fixture = await createBoundaryFixture("reserved");
  for (const [descriptor, expected] of [
    ["dist/.Velar-Build-Staging.json", /reserved build path/u],
    ["dist/PACKAGE.json", /reserved package scope path 'package\.json'/u],
  ] as const) {
    const manifest = structuredClone(fixture.manifest);
    manifest.velar.artifacts.core = descriptor;
    await writeManifest(fixture, manifest);
    const rejected = runCli(["build-library", fixture.library], fixture.root);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, expected);
  }
  await writeManifest(fixture, fixture.manifest);
  const built = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  await readFile(join(fixture.library, "dist", "velar-library.json"), "utf8");
  await assert.rejects(readFile(join(fixture.library, "dist", ".velar-build-staging.json"), "utf8"));
});

test("build-library rejects output segments that alias or fail on Windows", async () => {
  const fixture = await createBoundaryFixture("portable-segments");
  await writeFile(join(fixture.library, "src", "worker.vel"), "export def work() -> number: return 1\n", "utf8");
  for (const [output, expected] of [
    ["./dist/cache./worker.js", /trailing dot or space/u],
    ["./dist/CON/worker.js", /Windows-reserved path segment/u],
  ] as const) {
    const manifest = structuredClone(fixture.manifest);
    manifest.velar.entries = { "./worker": "src/worker.vel" };
    manifest.exports["./worker"] = output;
    await writeManifest(fixture, manifest);
    const rejected = runCli(["build-library", fixture.library], fixture.root);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, expected);
  }
});

test("build-library checks the package scope that survives around its output directory", async () => {
  const fixture = await createBoundaryFixture("builder-scope");
  const manifest = structuredClone(fixture.manifest);
  manifest.velar.artifacts.core = "build/dist/velar-library.json";
  manifest.exports["."] = "./build/dist/index.js";
  await writeManifest(fixture, manifest);
  await writeFile(join(fixture.library, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "build/dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await mkdir(join(fixture.library, "build"), { recursive: true });
  await writeFile(join(fixture.library, "build", "package.json"), '{"type":"commonjs"}\n', "utf8");
  const rejected = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /nearest surviving package scope.*exports \.js/u);

  manifest.type = "commonjs";
  await writeManifest(fixture, manifest);
  await writeFile(join(fixture.library, "build", "package.json"), '{"type":"module"}\n', "utf8");
  const built = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const consumer = join(fixture.root, "scope-consumer");
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await symlink(fixture.library, join(consumer, "node_modules", fixture.manifest.name), "dir");
  const runtime = spawnSync(process.execPath, ["--input-type=module", "--eval", `import(${JSON.stringify(fixture.manifest.name)}).then(({value}) => console.log(value()))`], {
    cwd: consumer,
    encoding: "utf8",
  });
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.equal(runtime.stdout, "boundary\n");
});

test("a root-only formatVersion 1 artifact keeps its index layout", async () => {
  const fixture = await createBoundaryFixture("v1-layout");
  const manifest = structuredClone(fixture.manifest);
  manifest.type = "commonjs";
  manifest.exports["."] = "./dist/custom.mjs";
  await writeManifest(fixture, manifest);
  const rejected = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /formatVersion 1 library artifact must expose '.\/dist\/index\.js'/u);
});

test("build-library refuses an outDir whose symbolic-link ancestor leaves the package", async () => {
  const fixture = await createBoundaryFixture("outdir-symlink");
  const outside = join(fixture.root, "outside");
  const keepPath = join(outside, "dist", "keep.txt");
  await mkdir(join(outside, "dist"), { recursive: true });
  await writeFile(keepPath, "keep\n", "utf8");
  await symlink(outside, join(fixture.library, "link"), "dir");
  const manifest = structuredClone(fixture.manifest);
  manifest.type = "commonjs";
  manifest.velar.artifacts.core = "link/dist/velar-library.json";
  manifest.exports["."] = "./link/dist/index.mjs";
  await writeManifest(fixture, manifest);
  await writeFile(join(fixture.library, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "link/dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  const rejected = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /outDir.*(?:escape.*symbolic link|resolves outside the package root)/u);
  assert.equal(await readFile(keepPath, "utf8"), "keep\n");
});

test("ordinary builds cannot replace through an escaping outDir ancestor or contain their project", async () => {
  const root = await makeTemporaryDirectory("velar-build-output-boundary-");
  const project = join(root, "project");
  const outside = join(root, "outside");
  const keepPath = join(outside, "dist", "keep.txt");
  await mkdir(project, { recursive: true });
  await mkdir(join(outside, "dist"), { recursive: true });
  await writeFile(join(project, "main.vel"), 'print("safe")\n', "utf8");
  await writeFile(keepPath, "keep\n", "utf8");
  await symlink(outside, join(project, "link"), "dir");
  await writeFile(join(project, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    entry: "main.vel",
    outDir: "link/dist",
  })}\n`, "utf8");
  const escaped = runCli(["build"], project);
  assert.equal(escaped.status, 1);
  assert.match(escaped.stderr, /outDir.*escape.*symbolic link/u);
  assert.equal(await readFile(keepPath, "utf8"), "keep\n");

  await writeFile(join(project, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    entry: "main.vel",
    outDir: "dist",
  })}\n`, "utf8");
  const forcedRoot = runCli(["build", "--out-dir", ".", "--force"], project);
  assert.equal(forcedRoot.status, 1);
  assert.match(forcedRoot.stderr, /build output cannot contain the project root/u);
  assert.equal(await readFile(join(project, "main.vel"), "utf8"), 'print("safe")\n');
});

test("project entry, publicDir, and worker declarations cannot escape through symlink ancestors", async () => {
  const root = await makeTemporaryDirectory("velar-project-input-boundary-");
  const project = join(root, "project");
  const outside = join(root, "outside");
  await mkdir(join(outside, "public"), { recursive: true });
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "main.vel"), 'print("safe")\n', "utf8");
  await writeFile(join(outside, "main.vel"), 'print("outside")\n', "utf8");
  await writeFile(join(outside, "worker.vel"), "export const outside = true\n", "utf8");
  await symlink(outside, join(project, "link"), "dir");
  const manifests = [
    { field: "entry", value: { entry: "link/main.vel" } },
    { field: "publicDir", value: { entry: "main.vel", publicDir: "link/public" } },
    { field: "workers.job", value: { entry: "main.vel", workers: { job: "link/worker.vel" } } },
  ] as const;
  for (const item of manifests) {
    await writeFile(join(project, "velar.json"), `${JSON.stringify({
      formatVersion: VELAR_PROJECT_FORMAT_VERSION,
      outDir: "dist",
      ...item.value,
    })}\n`, "utf8");
    const checked = runCli(["check"], project);
    assert.equal(checked.status, 1);
    assert.match(checked.stderr, new RegExp(`'${item.field.replace(".", "\\.")}' cannot escape the project through a symbolic link`, "u"));
  }
});

test("library exports follow ordered Node conditions and accept only exact ESM files", async () => {
  const fixture = await createBoundaryFixture("exports-order");
  const blocked = structuredClone(fixture.manifest);
  blocked.exports["."] = { node: null, import: "./dist/index.js" };
  await writeManifest(fixture, blocked);
  const blockedBuild = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(blockedBuild.status, 1);
  assert.match(blockedBuild.stderr, /must route Velar entry '\.' to one ESM JavaScript file/u);

  const mixed = structuredClone(fixture.manifest);
  mixed.exports.import = "./dist/index.js";
  await writeManifest(fixture, mixed);
  const mixedBuild = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(mixedBuild.status, 1);
  assert.match(mixedBuild.stderr, /cannot mix package subpath keys with condition keys/u);

  const invalidTargets = [
    "./dist/*.js",
    "./dist/index.js?debug",
    "./dist/%2findex.js",
    "./dist/../index.js",
    "./dist/node_modules/index.js",
    "https://example.com/index.js",
  ];
  for (const target of invalidTargets) {
    assert.throws(
      () => packageRuntimeExportTargets({ ".": target }, ".", "core"),
      /exact normalized package-relative (?:ESM file|path)|must start with '\.\/'|traversal or node_modules/u,
      target,
    );
  }
  assert.throws(
    () => packageRuntimeExportTargets({ ".": 42 }, ".", "node"),
    /target must be a string, object, array, or null; received number/u,
  );
  assert.deepEqual(packageRuntimeExportTargets({ ".": [{ browser: "./dist/browser.js" }, "./dist/index.js"] }, ".", "node"), ["./dist/index.js"]);
  assert.deepEqual(packageRuntimeExportTargets({ ".": [{ node: null }, "./dist/index.js"] }, ".", "node"), ["./dist/index.js"]);
  assert.deepEqual(packageRuntimeExportTargets({ ".": [null, "./dist/index.js"] }, ".", "node"), ["./dist/index.js"]);
  assert.deepEqual(packageRuntimeExportTargets({ ".": ["../bad.js", "./dist/index.js"] }, ".", "node"), ["./dist/index.js"]);
  assert.deepEqual(packageRuntimeExportTargets({ ".": ["not-relative", "./dist/index.js"] }, ".", "node"), ["./dist/index.js"]);
  assert.deepEqual(packageRuntimeExportTargets({ ".": [42, "./dist/index.js"] }, ".", "node"), ["./dist/index.js"]);
  assert.deepEqual(packageRuntimeExportTargets({ ".": ["./%2e%2e/bad.js", "./dist/index.js"] }, ".", "node"), ["./dist/index.js"]);
  for (const selectedPortableFailure of ["./bad%2fpath.js", "./bad%5cpath.js", "./valid%20name.js"]) {
    assert.throws(
      () => packageRuntimeExportTargets({ ".": [selectedPortableFailure, "./dist/index.js"] }, ".", "node"),
      /exact normalized package-relative (?:ESM file|path)/u,
    );
  }
  assert.deepEqual(packageRuntimeExportTargets({ ".": [42, null] }, ".", "node"), []);
  assert.throws(
    () => packageRuntimeExportTargets({ ".": [null, 42] }, ".", "node"),
    /target must be a string, object, array, or null; received number/u,
  );

  const fallback = structuredClone(fixture.manifest);
  fallback.exports["."] = ["../bad.js", "not-relative", 42, "./%2e%2e/bad.js", { node: null }, "./dist/index.js"];
  await writeManifest(fixture, fallback);
  const fallbackBuild = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(fallbackBuild.status, 0, `${fallbackBuild.stdout}${fallbackBuild.stderr}`);
  const consumer = join(fixture.root, "array-fallback-consumer");
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await symlink(fixture.library, join(consumer, "node_modules", fallback.name), "dir");
  const node = spawnSync(process.execPath, ["--input-type=module", "--eval", `import(${JSON.stringify(fallback.name)}).then(({value}) => console.log(value()))`], {
    cwd: consumer,
    encoding: "utf8",
  });
  assert.equal(node.status, 0, node.stderr);
  assert.equal(node.stdout, "boundary\n");
  for (const encodedSeparator of ["./bad%2fpath.js", "./bad%5cpath.js"]) {
    fallback.exports["."] = [encodedSeparator, "./dist/index.js"];
    await writeManifest(fixture, fallback);
    const rejectedByNode = spawnSync(process.execPath, ["--input-type=module", "--eval", `import(${JSON.stringify(fallback.name)})`], {
      cwd: consumer,
      encoding: "utf8",
    });
    assert.notEqual(rejectedByNode.status, 0);
    assert.match(rejectedByNode.stderr, /ERR_INVALID_MODULE_SPECIFIER/u);
  }
});

test("artifact checks reject the same null condition that Node blocks at runtime", async () => {
  const fixture = await createBoundaryFixture("node-null");
  const built = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const consumer = join(fixture.root, "consumer");
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await symlink(fixture.library, join(consumer, "node_modules", fixture.manifest.name), "dir");
  const blocked = structuredClone(fixture.manifest);
  blocked.exports["."] = { node: null, import: "./dist/index.js" };
  await writeManifest(fixture, blocked);
  const node = spawnSync(process.execPath, ["--input-type=module", "--eval", `import(${JSON.stringify(fixture.manifest.name)})`], {
    cwd: consumer,
    encoding: "utf8",
  });
  assert.notEqual(node.status, 0);
  assert.match(node.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/u);
  const input = join(consumer, "main.vel");
  await writeFile(input, `import {value} from ${JSON.stringify(fixture.manifest.name)}\nprint(value())\n`, "utf8");
  const checked = await compileProject(input, new Map(), { projectRoot: consumer });
  const messages = [
    ...checked.failures.map((failure) => failure.message),
    ...checked.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
  ].join("\n");
  assert.match(messages, /must export Velar entry '\.' as .* for every supported ESM runtime condition/u);
});

test("canonical package entries reject symlink aliases but allow one declared source and output alias", async () => {
  const fixture = await createBoundaryFixture("source-alias");
  await symlink(join(fixture.library, "src", "index.vel"), join(fixture.library, "src", "alias.vel"));
  const symlinkAlias = structuredClone(fixture.manifest);
  symlinkAlias.exports["./alias"] = "./dist/alias.js";
  symlinkAlias.velar.entries = { "./alias": "src/alias.vel" };
  await writeManifest(fixture, symlinkAlias);
  const rejected = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /same physical source; declare one source path for aliases/u);

  const exactAlias = structuredClone(fixture.manifest);
  exactAlias.exports["./alias"] = "./dist/index.js";
  exactAlias.velar.entries = { "./alias": "src/index.vel" };
  await writeManifest(fixture, exactAlias);
  const config = await resolveVelarProject(fixture.library);
  const library = await resolveVelarLibraryBuild(config);
  const checked = await checkVelarLibraryEntries(library, null);
  assert.equal(checked.failed, false);
  assert.equal(checked.projects.get("."), checked.projects.get("./alias"), "one source/output alias must reuse its checked graph");
  const built = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const receipt = JSON.parse(await readFile(join(fixture.library, "dist", "velar-library.json"), "utf8")) as {
    entries: Record<string, { javascript: string; sourceEntry: string }>;
  };
  assert.deepEqual(receipt.entries["./alias"], receipt.entries["."]);
});

test("generated artifact files cannot also be ancestor directories", async () => {
  const fixture = await createBoundaryFixture("path-hierarchy");
  await writeFile(join(fixture.library, "src", "worker.vel"), "export const worker = true\n", "utf8");
  const manifest = structuredClone(fixture.manifest);
  manifest.exports["."] = "./dist/branch.js";
  manifest.exports["./worker"] = "./dist/branch.js/worker.js";
  manifest.velar.entries = { "./worker": "src/worker.vel" };
  await writeManifest(fixture, manifest);
  const rejected = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /cannot be both a file and an ancestor directory/u);
});

test("a nested public entry may import upward within its package source boundary", async () => {
  const fixture = await createBoundaryFixture("nested-entry");
  await mkdir(join(fixture.library, "src", "workers"), { recursive: true });
  await writeFile(join(fixture.library, "src", "shared.vel"), "export const shared = \"shared\"\n", "utf8");
  await writeFile(join(fixture.library, "src", "workers", "worker.vel"), [
    'import {shared} from "../shared.vel"',
    "export def worker() -> string:",
    "    return shared",
    "",
  ].join("\n"), "utf8");
  const manifest = structuredClone(fixture.manifest);
  manifest.exports["./worker"] = "./dist/worker.js";
  manifest.velar.entries = { "./worker": "src/workers/worker.vel" };
  await writeManifest(fixture, manifest);
  const built = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  await readFile(join(fixture.library, "dist", "worker.js"), "utf8");
});

test("every receipt-covered .js chunk remains inside an ESM package scope", async () => {
  const fixture = await createBoundaryFixture("chunk-scope");
  await writeFile(join(fixture.library, "src", "shared.vel"), 'export const shared = "shared"\n', "utf8");
  await writeFile(join(fixture.library, "src", "index.vel"), [
    'import {shared} from "./shared.vel"',
    "export def value() -> string: return shared",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(fixture.library, "src", "worker.vel"), [
    'import {shared} from "./shared.vel"',
    "export def worker() -> string: return shared",
    "",
  ].join("\n"), "utf8");
  const manifest = structuredClone(fixture.manifest);
  manifest.exports["./worker"] = "./dist/worker.js";
  manifest.velar.entries = { "./worker": "src/worker.vel" };
  await writeManifest(fixture, manifest);
  const built = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const receipt = JSON.parse(await readFile(join(fixture.library, "dist", "velar-library.json"), "utf8")) as {
    readonly chunks: readonly { readonly javascript: string }[];
  };
  assert.ok(receipt.chunks.some((chunk) => chunk.javascript.endsWith(".js")));
  await writeFile(join(fixture.library, "dist", "__velar_chunks", "package.json"), '{"type":"commonjs"}\n', "utf8");

  const consumer = join(fixture.root, "consumer");
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await symlink(fixture.library, join(consumer, "node_modules", manifest.name), "dir");
  const input = join(consumer, "main.vel");
  await writeFile(input, `import {value} from ${JSON.stringify(manifest.name)}\nprint(value())\n`, "utf8");
  const checked = await compileProject(input, new Map(), { projectRoot: consumer });
  assert.match(
    [
      ...checked.failures.map((failure) => failure.message),
      ...checked.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => diagnostic.message)),
    ].join("\n"),
    /must place every \.js Velar library artifact inside a package scope with package\.json 'type' set to 'module'/u,
  );
});

test("a frozen artifact bundles source-only package subpaths and their JSON resources", async () => {
  const fixture = await createBoundaryFixture("source-dependency");
  const dependency = join(fixture.library, "node_modules", "source-helper");
  await mkdir(join(dependency, "src"), { recursive: true });
  await mkdir(join(dependency, "data"), { recursive: true });
  await writeFile(join(dependency, "package.json"), `${JSON.stringify({
    name: "source-helper",
    version: "1.0.0",
    exports: {
      ".": "./dist/index.js",
      "./worker": "./dist/worker.js",
      "./catalog": "./data/catalog.json",
    },
    velar: {
      entry: "src/index.vel",
      entries: { "./worker": "src/worker.vel" },
      resources: { "./catalog": { path: "data/catalog.json", type: "json" } },
      targets: ["core", "node", "web", "desktop"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(dependency, "src", "index.vel"), "export const root = true\n", "utf8");
  await writeFile(join(dependency, "src", "worker.vel"), "export def decorate(value: string) -> string:\n    return f\"<{value}>\"\n", "utf8");
  await writeFile(join(dependency, "data", "catalog.json"), '{"label":"bundled"}\n', "utf8");
  await writeFile(join(fixture.library, "src", "index.vel"), [
    'import {decorate} from "source-helper/worker"',
    'import json rawCatalog from "source-helper/catalog"',
    "",
    "type Catalog:",
    "    readonly label: string",
    "",
    "export def value() -> string:",
    "    return decorate(Catalog.parse(rawCatalog).label)",
    "",
  ].join("\n"), "utf8");
  const built = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  assert.doesNotMatch(await readFile(join(fixture.library, "dist", "index.js"), "utf8"), /source-helper/u);
  await rename(dependency, join(fixture.root, "source-helper-offline"));

  const consumer = join(fixture.root, "consumer");
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await symlink(fixture.library, join(consumer, "node_modules", fixture.manifest.name), "dir");
  const input = join(consumer, "main.vel");
  await writeFile(input, `import {value} from ${JSON.stringify(fixture.manifest.name)}\nprint(value())\n`, "utf8");
  const checked = await compileProject(input, new Map(), { projectRoot: consumer });
  assert.deepEqual(checked.failures, []);
  const ran = runCli(["run", input], consumer);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(ran.stdout, "<bundled>\n");
});

test("build-library preserves a verified frozen dependency as its package-owned bare import", async () => {
  const fixture = await createBoundaryFixture("verified-snapshot");
  const dependency = join(fixture.library, "node_modules", "snapshot-dependency");
  await mkdir(join(dependency, "src"), { recursive: true });
  await writeFile(join(dependency, "package.json"), `${JSON.stringify({
    name: "snapshot-dependency",
    version: "1.0.0",
    type: "module",
    dependencies: { "deep-dep": "1.0.0" },
    exports: { ".": "./dist/index.js", "./worker": "./dist/worker.js" },
    velar: {
      entry: "src/index.vel",
      entries: { "./worker": "src/worker.vel" },
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`, "utf8");
  await mkdir(join(dependency, "node_modules", "deep-dep"), { recursive: true });
  await writeFile(join(dependency, "node_modules", "deep-dep", "package.json"), '{"name":"deep-dep","version":"1.0.0","type":"module","exports":"./index.js"}\n', "utf8");
  await writeFile(join(dependency, "node_modules", "deep-dep", "index.js"), 'export function nestedLabel() { return "nested"; }\n', "utf8");
  await writeFile(join(dependency, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(dependency, "src", "shared.vel"), [
    "export def decorate(label: string) -> string:",
    '    return f"verified:{label}"',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(dependency, "src", "index.vel"), [
    'import {workerLabel} from "snapshot-dependency/worker"',
    'export def rootLabel() -> string: return f"verified:root:{workerLabel()}"',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(dependency, "src", "worker.vel"), [
    'extern module "deep-dep":',
    "    export def nestedLabel() -> string",
    'import js {nestedLabel} from "deep-dep"',
    'import {decorate} from "./shared.vel"',
    "export def workerLabel() -> string: return decorate(nestedLabel())",
    "",
  ].join("\n"), "utf8");
  const dependencyBuild = runCli(["build-library", dependency, "--mode", "readable"], fixture.root);
  assert.equal(dependencyBuild.status, 0, `${dependencyBuild.stdout}${dependencyBuild.stderr}`);
  fixture.manifest.dependencies = { "snapshot-dependency": "1.0.0" };
  await writeManifest(fixture, fixture.manifest);
  await writeFile(join(fixture.library, "src", "index.vel"), [
    'import {rootLabel} from "snapshot-dependency"',
    "export def value() -> string:",
    "    return rootLabel()",
    "",
  ].join("\n"), "utf8");

  const config = await resolveVelarProject(fixture.library);
  const library = await resolveVelarLibraryBuild(config);
  const checked = await checkVelarLibraryEntries(library, null);
  assert.equal(checked.failed, false, checked.output);
  assert.equal(checked.projects.get(".")?.velarArtifactImports.size, 1, "only the root artifact entry is selected by source");

  const staging = join(fixture.root, "verified-staging");
  await writeVelarLibraryArtifact(library, checked.projects, staging, "readable");
  const output = await readFile(join(staging, "index.js"), "utf8");
  assert.match(output, /from "snapshot-dependency"/u);
  assert.doesNotMatch(output, /verified:/u);
  assert.doesNotMatch(output, /from "deep-dep"/u, "the frozen dependency retains ownership of its ordinary npm dependencies");
});

test("build-library validates the package's declared target and host capabilities", async () => {
  const fixture = await createBoundaryFixture("own-compatibility");
  for (const [mutate, expected] of [
    [(manifest: BoundaryManifest) => { manifest.velar.targets = ["node"]; }, /does not support the 'core' target/u],
    [(manifest: BoundaryManifest) => { manifest.velar.requires.capabilities = ["web"]; }, /requires host capability 'web'/u],
  ] as const) {
    const manifest = structuredClone(fixture.manifest);
    mutate(manifest);
    await writeManifest(fixture, manifest);
    const rejected = runCli(["build-library", fixture.library], fixture.root);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, expected);
  }
});

test("build-library requires package-owned relative JSON to be a declared resource", async () => {
  const fixture = await createBoundaryFixture("own-resource");
  const resourcePath = join(fixture.library, "data", "config.json");
  await mkdir(join(fixture.library, "data"), { recursive: true });
  await writeFile(resourcePath, '{"label":"owned"}\n', "utf8");
  await writeFile(join(fixture.library, "src", "index.vel"), [
    'import json rawConfig from "../data/config.json"',
    "type Configuration:",
    "    readonly label: string",
    "export def value() -> string: return Configuration.parse(rawConfig).label",
    "",
  ].join("\n"), "utf8");
  const rejected = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /must declare 'data\/config\.json' in package\.json#velar\.resources/u);
  assert.equal(await readFile(resourcePath, "utf8"), '{"label":"owned"}\n');

  const declared = structuredClone(fixture.manifest);
  declared.exports["./config"] = "./data/config.json";
  declared.velar.resources = { "./config": { path: "data/config.json", type: "json" } };
  await writeManifest(fixture, declared);
  const built = runCli(["build-library", fixture.library], fixture.root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
});
