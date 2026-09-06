import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { writeFrozenPackageEntries } from "../packages/cli/src/frozen-package-output.ts";
import { assertGeneratedOutputClaims } from "../packages/cli/src/generated-output-claim.ts";
import { portableArtifactPathKey } from "../packages/cli/src/portable-artifact-path.ts";
import { assertProjectOutputNamespace } from "../packages/cli/src/project-output-namespace.ts";
import type { ProjectResult, VelarSourcePackage } from "../packages/cli/src/project.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

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

test("frozen builds externalize only active compiler-owned package modules", async () => {
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
    /imports external npm dependency/u,
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
