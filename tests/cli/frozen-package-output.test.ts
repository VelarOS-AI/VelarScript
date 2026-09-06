import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { writeFrozenPackageEntries } from "../../packages/cli/src/frozen-package-output.ts";
import { assertGeneratedOutputClaims } from "../../packages/cli/src/generated-output-claim.ts";
import { portableArtifactPathKey } from "../../packages/cli/src/portable-artifact-path.ts";
import { assertProjectOutputNamespace } from "../../packages/cli/src/project-output-namespace.ts";
import type { ProjectResult, VelarSourcePackage } from "../../packages/cli/src/project.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

test("portable generated paths fold common macOS Unicode aliases", () => {
  for (const [left, right] of [
    ["assets/data.json", "aſſets/data.json"],
    ["straße/data.json", "STRASSE/data.json"],
    ["Σ/data.json", "ς/data.json"],
    ["é/data.json", "e\u0301/data.json"],
  ] as const) {
    assert.equal(portableArtifactPathKey(left), portableArtifactPathKey(right));
  }
});

test("portable generated paths bound the emitted UTF-8 segment including its extension", () => {
  const root = join(process.cwd(), ".velar-generated-segment-limit-fixture");
  assert.doesNotThrow(() => assertGeneratedOutputClaims(root, [{
    path: join(root, `${"界".repeat(84)}.js`),
    kind: "file",
    owner: "255-byte module",
  }]));
  assert.throws(() => assertGeneratedOutputClaims(root, [{
    path: join(root, `${"界".repeat(85)}.js`),
    kind: "file",
    owner: "oversized module",
  }]), /oversized module .* exceeds 255 UTF-8 bytes/u);
});

test("large generated namespaces are checked in sorted linear scan order", () => {
  const root = join(process.cwd(), ".velar-generated-claim-performance-fixture");
  const claims = Array.from({ length: 10_000 }, (_, index) => ({
    path: join(root, "assets", index.toString().padStart(5, "0"), "data.json"),
    kind: "file" as const,
    owner: `asset ${index}`,
  }));
  const started = performance.now();
  assert.doesNotThrow(() => assertGeneratedOutputClaims(root, claims));
  assert.ok(performance.now() - started < 2_000, "10,000 namespace claims should not receive a quadratic preflight");
  assert.throws(() => assertGeneratedOutputClaims(root, [
    ...claims,
    { path: join(root, "assets", "05000"), kind: "tree", owner: "conflicting tree" },
  ]), /conflicting tree conflicts with asset 5000/u);
});

test("project output namespace rejects compiled resource and frozen aliases before writing", async () => {
  const root = await makeTemporaryDirectory("velar-project-output-namespace-");
  const outputRoot = join(root, "output");
  const packageRoot = join(root, "package");
  const resource = {
    importerPath: join(root, "main.vel"),
    source: "collision-fixture/data",
    inputPath: join(packageRoot, "assets", "data.json"),
    content: "{}\n",
    kind: "json",
    packageName: "collision-fixture",
    packageRoot,
    packageRelativePath: "assets/data.json",
    packageSubpath: "./data",
  } as const;
  const compiledCollision = {
    projectRoot: root,
    modules: [{ inputPath: join(root, "main.vel"), relativePath: "main.vel", result: { embeddedModules: [] } }],
    resources: [resource],
    velarPackages: [],
  } as unknown as ProjectResult;
  for (const [path, message] of [
    [join(outputRoot, "node_modules", "collision-fixture", "assets", "data.json"), /resource snapshot .* conflicts with compiled module/u],
    [join(outputRoot, "node_modules", "collision-fixture", "assets", "data.json.js"), /resource module .* conflicts with compiled module/u],
  ] as const) {
    assert.throws(() => assertProjectOutputNamespace(compiledCollision, {
      outputRoot,
      layout: "sandbox",
      sourceMaps: false,
      moduleOutputPath: () => path,
    }), message);
  }
  assert.throws(() => assertProjectOutputNamespace(compiledCollision, {
    outputRoot,
    layout: "sandbox",
    sourceMaps: false,
    moduleOutputPath: () => join(outputRoot, "node_modules", "collision-fixture", "package.json"),
  }), /assembled package manifest .* conflicts with compiled module/u);

  const artifactPath = join(packageRoot, "aſſets", "data.json.js");
  const frozenPackage = {
    name: "collision-fixture",
    root: packageRoot,
    artifacts: new Map([[".", { subpath: ".", entryPath: artifactPath }]]),
  } as unknown as VelarSourcePackage;
  const frozenCollision = {
    projectRoot: root,
    modules: [],
    resources: [resource],
    velarPackages: [frozenPackage],
  } as unknown as ProjectResult;
  assert.throws(() => assertProjectOutputNamespace(frozenCollision, {
    outputRoot,
    layout: "sandbox",
    sourceMaps: false,
    moduleOutputPath: () => join(outputRoot, "unused.js"),
  }), /frozen package .* conflicts with resource module/u);
  await assert.rejects(readFile(join(outputRoot, "node_modules", "collision-fixture", "assets", "data.json.js")), { code: "ENOENT" });
});

test("sandbox artifact outputs reject portable resource path collisions", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-output-collision-");
  const packageRoot = join(root, "package");
  const outputRoot = join(root, "output");
  const entryPath = join(packageRoot, "dist", "index.js");
  const sourceMapPath = `${entryPath}.map`;
  const snapshot = { path: entryPath, code: "export {};\n", sourceMapPath, sourceMap: "{}\n" };
  const package_ = {
    name: "collision-fixture",
    root: packageRoot,
    artifacts: new Map([[".", {
      subpath: ".",
      entryPath,
      entrySnapshot: snapshot,
      entrySnapshots: [snapshot],
      chunkSnapshots: [],
    }]]),
  } as unknown as VelarSourcePackage;

  for (const occupiedPath of [
    join(outputRoot, "node_modules", "collision-fixture", "dist", "INDEX.js"),
    join(outputRoot, "node_modules", "collision-fixture", "dist", "index.js", "resource.json"),
  ]) {
    await assert.rejects(
      writeFrozenPackageEntries([package_], outputRoot, "sandbox", new Set([occupiedPath]), "readable", true, new Set()),
      /conflicts with generated resource/u,
    );
  }
});

test("sandbox artifact outputs reject paths unavailable on Windows", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-output-portable-");
  const outputRoot = join(root, "output");
  for (const occupiedPath of [
    join(outputRoot, "cache.", "resource.json"),
    join(outputRoot, "CON", "resource.json"),
  ]) {
    await assert.rejects(
      writeFrozenPackageEntries([], outputRoot, "sandbox", new Set([occupiedPath]), "readable", true, new Set()),
      /(?:trailing dot or space|Windows-reserved path segment)/u,
    );
  }
});

test("frozen build outputs cannot overwrite an earlier compiled-module claim", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-compiled-collision-");
  const packageRoot = join(root, "package");
  const outputRoot = join(root, "output");
  const entryPath = join(packageRoot, "dist", "index.js");
  const sourceMapPath = `${entryPath}.map`;
  const outputPath = join(outputRoot, "node_modules", "collision-fixture", "dist", "index.js");
  const code = "export const frozenValue = 1;\n";
  const sourceMap = `${JSON.stringify({
    version: 3,
    sources: ["index.vel"],
    names: [],
    mappings: "",
    sourcesContent: ["export const frozenValue = 1\n"],
  })}\n`;
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await mkdir(join(outputRoot, "node_modules", "collision-fixture", "dist"), { recursive: true });
  await writeFile(entryPath, code, "utf8");
  await writeFile(sourceMapPath, sourceMap, "utf8");
  await writeFile(outputPath, "export const compiledValue = 2;\n", "utf8");
  const snapshot = { path: entryPath, code, sourceMapPath, sourceMap };
  const package_ = {
    name: "collision-fixture",
    root: packageRoot,
    artifacts: new Map([[".", {
      subpath: ".",
      entryPath,
      receiptPath: join(packageRoot, "dist", "velar-library.json"),
      entrySnapshot: snapshot,
      entrySnapshots: [snapshot],
      chunkSnapshots: [],
    }]]),
  } as unknown as VelarSourcePackage;

  await assert.rejects(
    writeFrozenPackageEntries([package_], outputRoot, "build", new Set(), "readable", true, new Set()),
    /Frozen artifact build output .* conflicts with an existing build output/u,
  );
  assert.equal(await readFile(outputPath, "utf8"), "export const compiledValue = 2;\n");
});

test("frozen builds reserve only active compiler-owned package modules", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-extension-runtime-");
  const packageRoot = join(root, "package");
  const outputRoot = join(root, "output");
  const entryPath = join(packageRoot, "dist", "index.js");
  const sourceMapPath = `${entryPath}.map`;
  const runtime = "@fixture/runtime-extension/runtime";
  const code = `import {runtimeValue} from ${JSON.stringify(runtime)};\nexport const frozenValue = runtimeValue;\n`;
  const sourceMap = `${JSON.stringify({
    version: 3,
    sources: ["index.vel"],
    names: [],
    mappings: "",
    sourcesContent: ["export const frozenValue = 1\n"],
  })}\n`;
  const snapshot = { path: entryPath, code, sourceMapPath, sourceMap };
  const package_ = {
    name: "frozen-extension-consumer",
    root: packageRoot,
    artifacts: new Map([[".", {
      subpath: ".",
      entryPath,
      receiptPath: join(packageRoot, "dist", "velar-library.json"),
      entrySnapshot: snapshot,
      entrySnapshots: [snapshot],
      chunkSnapshots: [],
    }]]),
  } as unknown as VelarSourcePackage;

  await assert.rejects(
    writeFrozenPackageEntries([package_], outputRoot, "build", new Set(), "readable", false, new Set()),
    /Could not resolve "@fixture\/runtime-extension\/runtime"/u,
  );
  await writeFrozenPackageEntries(
    [package_],
    outputRoot,
    "build",
    new Set(),
    "readable",
    false,
    new Set([runtime]),
  );
  const output = await readFile(join(outputRoot, "node_modules", package_.name, "dist", "index.js"), "utf8");
  assert.match(output, new RegExp(`from ${JSON.stringify(runtime)}`, "u"));
});

test("frozen directory builds route file dependencies back through authenticated artifact snapshots", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-file-reentry-");
  const packagePath = join(root, "package");
  const outputRoot = join(root, "output");
  const dependencyPath = join(packagePath, "node_modules", "artifact-reentry-dep");
  const entryFile = join(packagePath, "dist", "index.js");
  const reentryFile = join(packagePath, "dist", "reentry.js");
  const receiptFile = join(packagePath, "dist", "velar-library.json");
  const relativeReentry = relative(dependencyPath, reentryFile).replaceAll("\\", "/");
  await mkdir(dependencyPath, { recursive: true });
  await mkdir(join(packagePath, "dist"), { recursive: true });
  await writeFile(join(dependencyPath, "package.json"), JSON.stringify({
    name: "artifact-reentry-dep",
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
  }), "utf8");
  await writeFile(join(dependencyPath, "index.js"), [
    `import {artifactMarker} from ${JSON.stringify(relativeReentry)};`,
    "export function dependencyMarker() { return artifactMarker(); }",
    "",
  ].join("\n"), "utf8");
  await writeFile(entryFile, "export {};\n", "utf8");
  await writeFile(reentryFile, 'export function artifactMarker() { return "tampered-file"; }\n', "utf8");
  const packageRoot = await realpath(packagePath);
  const entryPath = await realpath(entryFile);
  const reentryPath = await realpath(reentryFile);
  const receiptPath = join(packageRoot, relative(packagePath, receiptFile));

  const entrySnapshot = {
    path: entryPath,
    code: [
      'import {artifactMarker} from "./reentry.js";',
      'import {dependencyMarker} from "artifact-reentry-dep";',
      'export function labels() { return artifactMarker() + "|" + dependencyMarker(); }',
      "",
    ].join("\n"),
    sourceMapPath: `${entryPath}.map`,
    sourceMap: "{}\n",
  };
  const reentrySnapshot = {
    path: reentryPath,
    code: [
      "let calls = 0;",
      'export function artifactMarker() { calls += 1; return "authenticated-" + String(calls); }',
      "",
    ].join("\n"),
    sourceMapPath: `${reentryPath}.map`,
    sourceMap: "{}\n",
  };
  const package_ = {
    name: "artifact-reentry-fixture",
    root: packageRoot,
    artifacts: new Map([[".", {
      subpath: ".",
      entryPath,
      receiptPath,
      entrySnapshot,
      entrySnapshots: [entrySnapshot],
      chunkSnapshots: [reentrySnapshot],
    }]]),
  } as unknown as VelarSourcePackage;

  await writeFrozenPackageEntries(
    [package_],
    outputRoot,
    "build",
    new Set(),
    "readable",
    false,
    new Set(),
  );
  const outputPackageRoot = join(outputRoot, "node_modules", package_.name);
  await writeFile(join(outputPackageRoot, "package.json"), '{"type":"module"}\n', "utf8");
  const output = await import(`${pathToFileURL(join(outputPackageRoot, "dist", "index.js")).href}?fixture=${Date.now()}`) as {
    readonly labels: () => string;
  };
  assert.equal(output.labels(), "authenticated-1|authenticated-2");
});

test("frozen directory builds execute CommonJS dependencies that load Node builtins", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-commonjs-builtin-");
  const packageRoot = join(root, "package");
  const outputRoot = join(root, "output");
  const dependencyRoot = join(packageRoot, "node_modules", "commonjs-builtin-fixture");
  const entryPath = join(packageRoot, "dist", "index.js");
  await mkdir(dependencyRoot, { recursive: true });
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await writeFile(join(dependencyRoot, "package.json"), JSON.stringify({
    name: "commonjs-builtin-fixture",
    version: "1.0.0",
    main: "index.cjs",
  }), "utf8");
  await writeFile(join(dependencyRoot, "index.cjs"), [
    'const __velarCreateRequire = "old-alias";',
    'const createRequire = "local-factory";',
    'const __require = "local-helper";',
    'const callLocal = (require) => require();',
    'const processModule = require("process");',
    "module.exports = {",
    "  runtimePlatform: () => processModule.platform,",
    '  collisionLabels: () => [__velarCreateRequire, createRequire, __require, callLocal(() => "parameter")].join(":"),',
    "};",
    "",
  ].join("\n"), "utf8");
  await writeFile(entryPath, "export {};\n", "utf8");
  const snapshot = {
    path: entryPath,
    code: [
      'import dependency from "commonjs-builtin-fixture";',
      "export const runtimePlatform = dependency.runtimePlatform();",
      "export const collisionLabels = dependency.collisionLabels();",
      "",
    ].join("\n"),
    sourceMapPath: `${entryPath}.map`,
    sourceMap: "{}\n",
  };
  const package_ = {
    name: "commonjs-builtin-artifact",
    root: packageRoot,
    artifacts: new Map([[".", {
      subpath: ".",
      entryPath,
      receiptPath: join(packageRoot, "dist", "velar-library.json"),
      entrySnapshot: snapshot,
      entrySnapshots: [snapshot],
      chunkSnapshots: [],
    }]]),
  } as unknown as VelarSourcePackage;

  await writeFrozenPackageEntries(
    [package_],
    outputRoot,
    "build",
    new Set(),
    "production",
    false,
    new Set(),
  );
  const outputPackageRoot = join(outputRoot, "node_modules", package_.name);
  await writeFile(join(outputPackageRoot, "package.json"), '{"type":"module"}\n', "utf8");
  const output = await import(`${pathToFileURL(join(outputPackageRoot, "dist", "index.js")).href}?fixture=${Date.now()}`) as {
    readonly runtimePlatform: string;
    readonly collisionLabels: string;
  };
  assert.equal(output.runtimePlatform, process.platform);
  assert.equal(output.collisionLabels, "old-alias:local-factory:local-helper:parameter");
});
