import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import type { ModuleInterface } from "@velarscript/compiler";
import { encodeVelarLibraryInterface } from "../packages/cli/src/library-artifact.ts";
import {
  velarPublishedToolchainPackages,
  velarPublishedWorkspacePackages,
  velarToolchainBuildOrder,
  velarWorkspaceBuildOrder,
} from "../scripts/velar-packages.mjs";
import { parseNpmPackResult } from "../scripts/npm-pack-result.mjs";
import { declaredEntryPaths, declaredImportSpecifiers, declaredJsonResourceImportSpecifiers, packageContentFailures, packedTarballFileReader, type PackedPackage } from "./package-contract.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// ---------------------------------------------------------------------------
// A-024 — `test:packages` is the release boundary, and it was checking a set it
// had stopped deriving. `velarWorkspacePackageNames()` produced the roster, `pack()`
// consumed it, and everything after `pack()` re-spelled the same eight names by
// hand: content checks over six of them, an install listing eight literal
// tarball paths, and a sixth copy in the `gate:build:packages` npm script.
//
// The probe that found it added one publishable package with no LICENSE, no
// README, no `dist`, and an `exports` pointing at a file that does not exist.
// `npm run test:packages` printed "VelarScript packed toolchain consumer
// acceptance passed" and exited 0, while the same package's tarball held
// exactly one file and a clean consumer importing it died with
// ERR_MODULE_NOT_FOUND.
//
// These tests rebuild that package and prove the contract now refuses it, in
// both places the old gate waved it through: the tarball's contents, and a real
// consumer's `import`.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

after(removeTemporaryDirectories);

/** The manifest from the A-024 reproduction, verbatim. */
const brokenManifest = {
  name: "@velarscript/broken-probe",
  version: "0.10.4",
  license: "UNLICENSED",
  type: "module",
  exports: "./dist/does-not-exist.js",
} as const;

const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

const emptyArtifactInterface = encodeVelarLibraryInterface({
  exports: new Map(),
  mutableExports: new Set(),
  reactiveExports: new Map(),
  reExports: new Map(),
  namedTypes: new Map(),
  namedTypeIdentities: new Map(),
  typeAliases: new Map(),
  enums: new Map(),
  classes: new Map(),
  tests: [],
  extensionExports: new Map(),
  extensionData: new Map(),
} satisfies ModuleInterface);

function artifactEntry(
  sourceEntry: string,
  name: string,
  contents: { readonly javascript: string; readonly sourceMap: string; readonly interface: string },
) {
  return {
    sourceEntry,
    javascript: `${name}.js`,
    sourceMap: `${name}.js.map`,
    interface: `${name}.veli.json`,
    sha256: {
      javascript: sha256(contents.javascript),
      sourceMap: sha256(contents.sourceMap),
      interface: sha256(contents.interface),
    },
  };
}

function externalSourceMap(file: string, source: string): string {
  return `${JSON.stringify({ version: 3, file, sources: [source], sourcesContent: [""], names: [], mappings: "" })}\n`;
}

function linkedJavaScript(code: string, sourceMap: string): string {
  return `${code.trimEnd()}\n//# sourceMappingURL=${sourceMap}\n`;
}

function npm(arguments_: readonly string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const execpath = process.env.npm_execpath;
  const execution = execpath
    ? spawnSync(process.execPath, [execpath, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", arguments_, { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: execution.status, stdout: execution.stdout ?? "", stderr: execution.stderr ?? "" };
}

/** A package directory, packed for real, reported the way `npm pack` reports it. */
async function packageOf(manifest: object, files: Record<string, string> = {}): Promise<{ directory: string; packed: PackedPackage; readPackedFile: ReturnType<typeof packedTarballFileReader> }> {
  const temporary = await makeTemporaryDirectory("velar-package-contract-");
  const directory = join(temporary, "package");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content, "utf8");
  }
  const result = npm(["pack", "--json", "--ignore-scripts", "--pack-destination", temporary, directory], directory);
  assert.equal(result.status, 0, result.stderr);
  const packed = parseNpmPackResult(result.stdout, String((manifest as { name?: unknown }).name ?? "probe")) as PackedPackage;
  return { directory, packed, readPackedFile: packedTarballFileReader(join(temporary, packed.filename)) };
}

test("npm pack receipts accept the npm 11 array and npm 12 keyed-object envelopes", () => {
  const receipt = { name: "probe", version: "1.0.0", filename: "probe-1.0.0.tgz", files: [] };
  assert.deepEqual(parseNpmPackResult(JSON.stringify([receipt]), "probe"), receipt);
  assert.deepEqual(parseNpmPackResult(JSON.stringify({ probe: receipt }), "probe"), receipt);
  assert.throws(() => parseNpmPackResult("{}", "probe"), /invalid result for probe/u);
});

test("[A-024] a crippled publishable package fails the content contract", async () => {
  const { packed } = await packageOf(brokenManifest);
  // The reproduction's own evidence: one file in the tarball.
  assert.equal(packed.files.length, 1, JSON.stringify(packed.files));
  const failures = await packageContentFailures(brokenManifest, packed);
  assert.ok(failures.some((failure) => failure.includes("no LICENSE")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("no README.md")), failures.join("\n"));
  assert.ok(
    failures.some((failure) => failure.includes("points at 'dist/does-not-exist.js', which is not in the tarball")),
    failures.join("\n"),
  );
});

test("[A-024] a crippled publishable package fails a clean consumer's import", async () => {
  // The other half, and the one that matters on release day: the package
  // installs without complaint and the first `import` of it fails. The gate's
  // consumer step imports every specifier each manifest publishes, derived the
  // same way, so this package cannot reach a consumer un-imported.
  const { directory } = await packageOf(brokenManifest);
  const consumer = await makeTemporaryDirectory("velar-broken-consumer-");
  await writeFile(join(consumer, "package.json"), `${JSON.stringify({ name: "broken-consumer", private: true, type: "module" }, null, 2)}\n`, "utf8");
  const installed = join(consumer, "node_modules", "@velarscript", "broken-probe");
  await mkdir(installed, { recursive: true });
  // Installed the way npm lays a tarball down, without asking a registry for
  // anything: this test must run on a machine with no network.
  await writeFile(join(installed, "package.json"), await readFile(join(directory, "package.json"), "utf8"), "utf8");

  const specifiers = declaredImportSpecifiers(brokenManifest);
  assert.deepEqual(specifiers, ["@velarscript/broken-probe"]);
  const execution = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    specifiers.map((specifier) => `await import(${JSON.stringify(specifier)});`).join("\n"),
  ], { cwd: consumer, encoding: "utf8", timeout: 300_000 });
  assert.equal(execution.status, 1, `${execution.stdout ?? ""}${execution.stderr ?? ""}`);
  assert.match(execution.stderr ?? "", /ERR_MODULE_NOT_FOUND/u);
});

test("[A-024] a package that keeps its promises passes both halves", async () => {
  // The contract has to be satisfiable, or the test above proves only that it
  // refuses everything.
  const manifest = {
    name: "velar-contract-probe",
    version: "0.10.4",
    license: "Apache-2.0",
    type: "module",
    files: ["dist", "README.md"],
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
    bin: { "contract-probe": "./dist/cli.js" },
  };
  const { packed } = await packageOf(manifest, {
    LICENSE: "Apache License\n",
    "README.md": "# probe\n",
    "dist/index.js": "export const value = 1\n",
    "dist/index.d.ts": "export declare const value: number;\n",
    "dist/cli.js": "#!/usr/bin/env node\n",
  });
  assert.deepEqual(await packageContentFailures(manifest, packed), []);
});

test("the packed contract rejects Windows aliases and reserved segments", async () => {
  const manifest = { name: "portable-contract-probe", version: "1.0.0", exports: "./dist/index.js" };
  const packed = {
    filename: "portable-contract-probe-1.0.0.tgz",
    files: [
      { path: "LICENSE" },
      { path: "README.md" },
      { path: "dist/index.js" },
      { path: "dist/cache/value.js" },
      { path: "dist/CACHE./value.js" },
      { path: "dist/CON/data.json" },
    ],
  };
  const failures = await packageContentFailures(manifest, packed);
  assert.ok(failures.some((failure) => /trailing dot or space/u.test(failure)), failures.join("\n"));
  assert.ok(failures.some((failure) => /Windows-reserved path segment/u.test(failure)), failures.join("\n"));
});

test("[A-024] the contract is derived from the manifest, not from a list of names", async () => {
  // A subpath nobody has written before is required the day a manifest names
  // it. This is the property the old gate lost: its checks named packages, so
  // they could only ever check the packages somebody had named.
  const manifest = {
    name: "velar-contract-probe",
    version: "0.10.4",
    type: "module",
    exports: {
      ".": { default: "./dist/index.js" },
      "./brand-new-subpath": { types: "./dist/brand-new.d.ts", default: "./dist/brand-new.js" },
    },
    velar: { entry: "src/index.vel" },
  };
  assert.deepEqual(declaredEntryPaths(manifest), [
    "dist/index.js",
    "dist/brand-new.d.ts",
    "dist/brand-new.js",
    "src/index.vel",
  ]);
  assert.deepEqual(declaredImportSpecifiers(manifest), ["velar-contract-probe", "velar-contract-probe/brand-new-subpath"]);
  const { packed } = await packageOf(manifest, { LICENSE: "x\n", "README.md": "x\n", "dist/index.js": "export const value = 1\n" });
  const failures = await packageContentFailures(manifest, packed);
  assert.ok(failures.some((failure) => failure.includes("dist/brand-new.js")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("src/index.vel")), failures.join("\n"));
});

test("package resource files and matching npm subpath exports are part of the packed contract", async () => {
  const manifest = {
    name: "velar-resource-probe",
    version: "0.11.0",
    type: "module",
    files: ["src", "generated", "dist", "README.md"],
    exports: {
      ".": "./dist/index.js",
      "./catalog": "./generated/catalog.json",
    },
    velar: {
      entry: "src/index.vel",
      resources: {
        "./catalog": { path: "generated/catalog.json", type: "json" as const },
      },
    },
  };
  assert.ok(declaredEntryPaths(manifest).includes("generated/catalog.json"));
  assert.deepEqual(declaredJsonResourceImportSpecifiers(manifest), ["velar-resource-probe/catalog"]);
  assert.deepEqual(declaredImportSpecifiers(manifest), ["velar-resource-probe"]);
  const complete = await packageOf(manifest, {
    LICENSE: "x\n",
    "README.md": "x\n",
    "dist/index.js": "export const value = 1\n",
    "src/index.vel": "export const value = 1\n",
    "generated/catalog.json": "{}\n",
  });
  assert.deepEqual(await packageContentFailures(manifest, complete.packed), []);

  const mismatched = {
    ...manifest,
    exports: { ...manifest.exports, "./catalog": "./generated/other.json" },
  };
  const broken = await packageOf(mismatched, {
    LICENSE: "x\n",
    "README.md": "x\n",
    "dist/index.js": "export const value = 1\n",
    "src/index.vel": "export const value = 1\n",
    "generated/catalog.json": "{}\n",
    "generated/other.json": "{}\n",
  });
  assert.ok((await packageContentFailures(mismatched, broken.packed)).some((failure) =>
    failure.includes("resource './catalog' must export './generated/catalog.json' in every condition")
  ));

  const blocked = { ...manifest, exports: { ...manifest.exports, "./catalog": { browser: null, default: "./generated/catalog.json" } } };
  const blockedPackage = await packageOf(blocked, {
    LICENSE: "x\n",
    "README.md": "x\n",
    "dist/index.js": "export const value = 1\n",
    "src/index.vel": "export const value = 1\n",
    "generated/catalog.json": "{}\n",
  });
  assert.ok((await packageContentFailures(blocked, blockedPackage.packed)).some((failure) =>
    failure.includes("resource './catalog' has no matching npm export")
  ));

  const mixed = { ...manifest, exports: { "./catalog": "./generated/catalog.json", browser: "./dist/index.js" } };
  const mixedPackage = await packageOf(mixed, {
    LICENSE: "x\n",
    "README.md": "x\n",
    "dist/index.js": "export const value = 1\n",
    "src/index.vel": "export const value = 1\n",
    "generated/catalog.json": "{}\n",
  });
  assert.ok((await packageContentFailures(mixed, mixedPackage.packed)).some((failure) =>
    failure.includes("resource './catalog' has an invalid npm export")
      && failure.includes("cannot mix package subpath keys with condition keys")
  ));
});

test("exact VelarScript subpath entries are packed and stay disjoint from resources", async () => {
  const manifest = {
    name: "velar-entry-probe",
    version: "0.28.0",
    type: "module",
    files: ["src", "generated", "README.md"],
    exports: { "./snapshot": "./generated/snapshot.json" },
    velar: {
      entry: "src/index.vel",
      entries: {
        "./worker": "src/worker.vel",
        "./tools/snapshot": "src/snapshot.vel",
      },
      resources: {
        "./snapshot": { path: "generated/snapshot.json", type: "json" as const },
      },
    },
  };
  assert.deepEqual(declaredEntryPaths(manifest), [
    "generated/snapshot.json",
    "src/index.vel",
    "src/worker.vel",
    "src/snapshot.vel",
  ]);
  const { packed } = await packageOf(manifest, {
    LICENSE: "x\n",
    "README.md": "x\n",
    "src/index.vel": "export const root = true\n",
    "src/worker.vel": "export const worker = true\n",
    "generated/snapshot.json": "{}\n",
  });
  const failures = await packageContentFailures(manifest, packed);
  assert.ok(failures.some((failure) => failure.includes("src/snapshot.vel")), failures.join("\n"));

  const conflicting = {
    ...manifest,
    velar: {
      ...manifest.velar,
      entries: { ...manifest.velar.entries, "./snapshot": "src/snapshot.vel" },
    },
  };
  assert.ok((await packageContentFailures(conflicting, packed)).some((failure) =>
    failure.includes("'./snapshot' cannot be both a VelarScript entry and a JSON resource")
  ));

  for (const [entries, expected] of [
    [{ "./*": "src/worker.vel" }, /must be an exact '\.\/name' package subpath/u],
    [{ "./worker": 42 }, /must be a normalized package-relative \.vel source path/u],
    [null, /must be an object mapping exact package subpaths/u],
  ] as const) {
    const malformed = {
      ...manifest,
      velar: { ...manifest.velar, entries },
    } as unknown as Parameters<typeof packageContentFailures>[0];
    const malformedFailures = await packageContentFailures(malformed, packed);
    assert.ok(
      malformedFailures.some((failure) => failure.includes("VelarScript package entries are invalid") && expected.test(failure)),
      malformedFailures.join("\n"),
    );
  }
});

test("a v1 Velar library receipt promises its JavaScript, source map, and interface", async () => {
  const manifest = {
    name: "velar-artifact-probe",
    version: "1.0.0",
    type: "module",
    files: ["src", "dist", "README.md"],
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
    },
  };
  assert.deepEqual(declaredEntryPaths(manifest), [
    "dist/index.js",
    "src/index.vel",
    "dist/velar-library.json",
  ]);
  const source = "export const value = 1\n";
  const internalSource = "export const internal = true\n";
  const contents = {
    javascript: linkedJavaScript("export const value = 1", "index.js.map"),
    sourceMap: externalSourceMap("index.js", "../src/index.vel"),
    interface: emptyArtifactInterface,
  };
  const entry = artifactEntry("src/index.vel", "index", contents);
  const receipt = {
    formatVersion: 1,
    kind: "velar-library-artifact",
    abiVersion: 1,
    package: { name: manifest.name, version: manifest.version },
    target: "core",
    compilerVersion: "0.28.1",
    sourceEntry: entry.sourceEntry,
    sources: [
      { path: entry.sourceEntry, sha256: sha256(source) },
      { path: "src/internal.vel", sha256: sha256(internalSource) },
    ],
    entry: {
      javascript: entry.javascript,
      sourceMap: entry.sourceMap,
      interface: entry.interface,
      sha256: entry.sha256,
    },
  };
  const complete = await packageOf(manifest, {
    LICENSE: "x\n",
    "README.md": "x\n",
    "src/index.vel": source,
    "src/internal.vel": internalSource,
    "dist/index.js": contents.javascript,
    "dist/alternate.js": "export const value = 2\n",
    "dist/index.js.map": contents.sourceMap,
    "dist/index.veli.json": contents.interface,
    "dist/velar-library.json": `${JSON.stringify(receipt)}\n`,
  });
  assert.deepEqual(await packageContentFailures(manifest, complete.packed, complete.readPackedFile), []);
  const mismatchedExport = { ...manifest, exports: { ".": "./dist/alternate.js" } };
  const exportFailures = await packageContentFailures(mismatchedExport, complete.packed, complete.readPackedFile);
  assert.ok(exportFailures.some((failure) =>
    failure.includes("artifact entry '.' must export './dist/index.js' on every supported ESM runtime")
  ), exportFailures.join("\n"));
  const missingReceipt = { ...complete.packed, files: complete.packed.files.filter((file) => file.path !== "dist/velar-library.json") };
  const receiptFailures = await packageContentFailures(manifest, missingReceipt, complete.readPackedFile);
  assert.ok(receiptFailures.some((failure) => failure.includes("manifest points at 'dist/velar-library.json'")), receiptFailures.join("\n"));
  for (const output of ["dist/index.js", "dist/index.js.map", "dist/index.veli.json"]) {
    const missing = { ...complete.packed, files: complete.packed.files.filter((file) => file.path !== output) };
    const failures = await packageContentFailures(manifest, missing, complete.readPackedFile);
    assert.ok(failures.some((failure) => failure.includes(`'${output}' is not in the tarball`)), failures.join("\n"));
  }
  const missingSource = { ...complete.packed, files: complete.packed.files.filter((file) => file.path !== "src/internal.vel") };
  assert.ok((await packageContentFailures(manifest, missingSource, complete.readPackedFile)).some((failure) =>
    failure.includes("artifact source 'src/internal.vel' is not in the tarball")
  ));
  const read = complete.readPackedFile;
  for (const [path, replacement] of [
    ["src/index.vel", `${source} `],
    ["dist/index.js", `${contents.javascript} `],
    ["dist/index.js.map", `${contents.sourceMap} `],
    ["dist/index.veli.json", `${contents.interface} `],
  ] as const) {
    const failures = await packageContentFailures(manifest, complete.packed, (candidate) =>
      candidate === path ? Promise.resolve(Buffer.from(replacement)) : read(candidate)
    );
    assert.ok(failures.some((failure) => failure.includes(`'${path}'`) && failure.includes("hash mismatch")), failures.join("\n"));
  }
  const invalidUtf8Bytes = new Uint8Array([0xff]);
  const invalidUtf8Receipt = {
    ...receipt,
    entry: { ...receipt.entry, sha256: { ...receipt.entry.sha256, interface: sha256(invalidUtf8Bytes) } },
  };
  const invalidUtf8 = await packageContentFailures(manifest, complete.packed, async (candidate) => {
    if (candidate === "dist/velar-library.json") return Buffer.from(`${JSON.stringify(invalidUtf8Receipt)}\n`);
    if (candidate === "dist/index.veli.json") return invalidUtf8Bytes;
    return read(candidate);
  });
  assert.ok(invalidUtf8.some((failure) =>
    failure.includes("artifact interface 'dist/index.veli.json' is invalid")
    && failure.includes("valid UTF-8")
  ), invalidUtf8.join("\n"));

  const duplicated = { ...complete.packed, files: [...complete.packed.files, { path: "dist/index.js" }] };
  const duplicateFailures = await packageContentFailures(manifest, duplicated, read);
  assert.ok(duplicateFailures.some((failure) => failure.includes("artifact JavaScript 'dist/index.js' occurs 2 times")), duplicateFailures.join("\n"));

  const invalidInterface = "{}\n";
  const invalidInterfaceReceipt = {
    ...receipt,
    entry: {
      ...receipt.entry,
      sha256: { ...receipt.entry.sha256, interface: sha256(invalidInterface) },
    },
  };
  const invalidInterfaceFailures = await packageContentFailures(manifest, complete.packed, async (path) => {
    if (path === "dist/velar-library.json") return Buffer.from(`${JSON.stringify(invalidInterfaceReceipt)}\n`);
    if (path === "dist/index.veli.json") return Buffer.from(invalidInterface);
    return read(path);
  });
  assert.ok(invalidInterfaceFailures.some((failure) =>
    failure.includes("artifact interface 'dist/index.veli.json' is invalid")
    && failure.includes("formatVersion")
  ), invalidInterfaceFailures.join("\n"));

  const invalidSourceMap = "{}\n";
  const invalidSourceMapReceipt = {
    ...receipt,
    entry: {
      ...receipt.entry,
      sha256: { ...receipt.entry.sha256, sourceMap: sha256(invalidSourceMap) },
    },
  };
  const sourceMapFailures = await packageContentFailures(manifest, complete.packed, async (path) => {
    if (path === "dist/velar-library.json") return Buffer.from(`${JSON.stringify(invalidSourceMapReceipt)}\n`);
    if (path === "dist/index.js.map") return Buffer.from(invalidSourceMap);
    return read(path);
  });
  assert.ok(sourceMapFailures.some((failure) =>
    failure.includes("packed artifact source map is invalid")
    && failure.includes("must contain version 3")
  ), sourceMapFailures.join("\n"));

  const escapingJavaScript = linkedJavaScript('import "/outside.js";\nexport const value = 1', "index.js.map");
  const escapingReceipt = {
    ...receipt,
    entry: {
      ...receipt.entry,
      sha256: { ...receipt.entry.sha256, javascript: sha256(escapingJavaScript) },
    },
  };
  const escapingFailures = await packageContentFailures(manifest, complete.packed, async (path) => {
    if (path === "dist/velar-library.json") return Buffer.from(`${JSON.stringify(escapingReceipt)}\n`);
    if (path === "dist/index.js") return Buffer.from(escapingJavaScript);
    return read(path);
  });
  assert.ok(escapingFailures.some((failure) =>
    failure.includes("packed artifact ESM closure is invalid")
    && failure.includes("/outside.js")
  ), escapingFailures.join("\n"));
});

test("a v2 Velar library receipt covers every exact package entry and packed output", async () => {
  const manifest = {
    name: "velar-multi-artifact-probe",
    version: "1.0.0",
    type: "module",
    files: ["src", "dist", "README.md"],
    exports: { ".": "./dist/index.js", "./worker": "./dist/worker.js" },
    velar: {
      entry: "src/index.vel",
      entries: { "./worker": "src/worker.vel" },
      artifacts: { core: "dist/velar-library.json" },
    },
  };
  const rootSource = "export const root = true\n";
  const workerSource = "export const worker = true\n";
  const rootContents = {
    javascript: linkedJavaScript("export const root = true", "index.js.map"),
    sourceMap: externalSourceMap("index.js", "../src/index.vel"),
    interface: emptyArtifactInterface,
  };
  const workerContents = {
    javascript: linkedJavaScript("export const worker = true", "worker.js.map"),
    sourceMap: externalSourceMap("worker.js", "../src/worker.vel"),
    interface: emptyArtifactInterface,
  };
  const rootEntry = artifactEntry("src/index.vel", "index", rootContents);
  const workerEntry = artifactEntry("src/worker.vel", "worker", workerContents);
  const chunkContents = {
    javascript: linkedJavaScript("export const shared = true", "chunk-probe.js.map"),
    sourceMap: externalSourceMap("chunk-probe.js", "../../src/shared.vel"),
  };
  const chunk = {
    javascript: "__velar_chunks/chunk-probe.js",
    sourceMap: "__velar_chunks/chunk-probe.js.map",
    sha256: { javascript: sha256(chunkContents.javascript), sourceMap: sha256(chunkContents.sourceMap) },
  };
  const receipt = {
    formatVersion: 2,
    kind: "velar-library-artifact",
    abiVersion: 1,
    package: { name: manifest.name, version: manifest.version },
    target: "core",
    compilerVersion: "0.28.1",
    sources: [
      { path: rootEntry.sourceEntry, sha256: sha256(rootSource) },
      { path: workerEntry.sourceEntry, sha256: sha256(workerSource) },
    ],
    entries: { ".": rootEntry, "./worker": workerEntry },
    chunks: [chunk],
  };
  const complete = await packageOf(manifest, {
    LICENSE: "x\n",
    "README.md": "x\n",
    "src/index.vel": rootSource,
    "src/worker.vel": workerSource,
    "dist/index.js": rootContents.javascript,
    "dist/index.js.map": rootContents.sourceMap,
    "dist/index.veli.json": rootContents.interface,
    "dist/worker.js": workerContents.javascript,
    "dist/alternate-worker.js": "export const worker = false\n",
    "dist/worker.js.map": workerContents.sourceMap,
    "dist/worker.veli.json": workerContents.interface,
    "dist/__velar_chunks/chunk-probe.js": chunkContents.javascript,
    "dist/__velar_chunks/chunk-probe.js.map": chunkContents.sourceMap,
    "dist/velar-library.json": `${JSON.stringify(receipt)}\n`,
  });
  const read = complete.readPackedFile;
  assert.deepEqual(await packageContentFailures(manifest, complete.packed, read), []);

  const mismatchedExport = {
    ...manifest,
    exports: {
      ...manifest.exports,
      "./worker": {
        node: "./dist/alternate-worker.js",
        browser: "./dist/worker.js",
        default: "./dist/worker.js",
      },
    },
  };
  const exportFailures = await packageContentFailures(mismatchedExport, complete.packed, read);
  assert.ok(exportFailures.some((failure) =>
    failure.includes("artifact entry './worker' must export './dist/worker.js' on every supported ESM runtime")
  ), exportFailures.join("\n"));

  const missing = { ...complete.packed, files: complete.packed.files.filter((file) => file.path !== "dist/worker.veli.json") };
  const failures = await packageContentFailures(manifest, missing, read);
  assert.ok(failures.some((failure) => failure.includes("artifact interface 'dist/worker.veli.json' is not in the tarball")), failures.join("\n"));

  const missingChunk = { ...complete.packed, files: complete.packed.files.filter((file) => file.path !== "dist/__velar_chunks/chunk-probe.js") };
  const chunkFailures = await packageContentFailures(manifest, missingChunk, read);
  assert.ok(chunkFailures.some((failure) => failure.includes("artifact shared JavaScript 'dist/__velar_chunks/chunk-probe.js' is not in the tarball")), chunkFailures.join("\n"));

  const invalid = { ...receipt, entries: { ...receipt.entries, "./worker": { ...workerEntry, javascript: "../escape.js" } } };
  const invalidFailures = await packageContentFailures(manifest, complete.packed, async (path) =>
    path === "dist/velar-library.json" ? Buffer.from(JSON.stringify(invalid)) : read(path)
  );
  assert.ok(invalidFailures.some((failure) => failure.includes("must be a normalized relative path")), invalidFailures.join("\n"));
});

test("artifact receipt inspection rejects unknown shape and oversized JSON", async () => {
  const manifest = {
    name: "velar-artifact-limits-probe",
    version: "1.0.0",
    velar: { entry: "src/index.vel", artifacts: { core: "dist/velar-library.json" } },
  };
  const packed = {
    filename: "probe.tgz",
    files: ["LICENSE", "README.md", "src/index.vel", "dist/velar-library.json"].map((path) => ({ path })),
  };
  const entry = artifactEntry("src/index.vel", "index", { javascript: "", sourceMap: "", interface: "" });
  const receipt = {
    formatVersion: 1,
    kind: "velar-library-artifact",
    abiVersion: 1,
    package: { name: manifest.name, version: manifest.version },
    target: "core",
    compilerVersion: "0.28.1",
    sourceEntry: entry.sourceEntry,
    sources: [{ path: entry.sourceEntry, sha256: sha256("") }],
    entry: { javascript: entry.javascript, sourceMap: entry.sourceMap, interface: entry.interface, sha256: entry.sha256 },
    unexpected: true,
  };
  const malformed = await packageContentFailures(manifest, packed, async () => Buffer.from(JSON.stringify(receipt)));
  assert.ok(malformed.some((failure) => failure.includes("unknown field 'unexpected'")), malformed.join("\n"));

  const oversized = await packageContentFailures(manifest, packed, async () => new Uint8Array(4 * 1024 * 1024 + 1));
  assert.ok(oversized.some((failure) => failure.includes("receipt exceeds 4194304 bytes")), oversized.join("\n"));
});

test("[A-024] every publishable toolchain package that declares a build is built, dependencies first", async () => {
  // The third copy of the roster was the `gate:build:packages` npm script, six
  // workspaces chained by hand. A publishable package added with a build script
  // would have been packed and content-checked against a `dist` nothing built.
  const published = await velarPublishedToolchainPackages(root);
  const order = await velarToolchainBuildOrder(root);
  const built = order.map((package_) => package_.name);
  const shouldBuild = published.filter((package_) => package_.manifest.scripts?.build).map((package_) => package_.name);
  assert.deepEqual([...built].sort(), [...shouldBuild].sort(), "a publishable package declares a build the gate does not run");
  // Peers are edges too. D111 moved Web, Server and Desktop out of the CLI's
  // `dependencies` so a project stops installing targets it never declared,
  // while the CLI's own sources still compile against their declarations — an
  // order derived from `dependencies` alone ran the CLI's `tsc` before the three
  // `.d.ts` sets it reads. Whether a package installs another and whether it
  // builds after one are different questions.
  for (const [index, package_] of order.entries()) {
    const workspaceDependencies = Object.keys({ ...package_.manifest.dependencies, ...package_.manifest.peerDependencies })
      .filter((name) => built.includes(name));
    for (const dependency of workspaceDependencies) {
      assert.ok(built.indexOf(dependency) < index, `${package_.name} is built before its workspace dependency ${dependency}`);
    }
  }
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(manifest.scripts["gate:build:packages"], "node scripts/build-packages.mjs");
});

test("the repository owns one package layer and no application package directories", async () => {
  const workspaceOrder = await velarWorkspaceBuildOrder(root);
  const toolchainOrder = await velarToolchainBuildOrder(root);
  assert.deepEqual(workspaceOrder.map((package_) => package_.name), toolchainOrder.map((package_) => package_.name));
  const rootDirectories = new Set((await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name));
  for (const forbidden of ["libraries", "adapters", "integrations"]) {
    assert.equal(rootDirectories.has(forbidden), false, `${forbidden}/ must not become a first-party application package layer`);
  }
});

test("[A-024] workspace acceptance walks all derived package layers", async () => {
  // Structural, and deliberately so: what went wrong was not a wrong list, it
  // was a second list. The acceptance script may name a package to make a
  // specific claim about it — `native/macos/VelarDesktopHost.swift` is a fact
  // about Desktop alone — but the roster it walks has to be the derived one.
  const acceptance = await readFile(join(root, "tests", "package.acceptance.ts"), "utf8");
  assert.match(acceptance, /const published = await velarPublishedWorkspacePackages\(root\)/u);
  assert.match(acceptance, /for \(const package_ of published\)[\s\S]*packageContentFailures\(/u);
  assert.match(acceptance, /\.\.\.published\.map\(\(package_\) => join\(directory, named\(package_\.name\)\.filename\)\)/u);
  // And no tarball path is spelled out beside them.
  assert.doesNotMatch(acceptance, /join\(directory, (?:compiler|node|web|create|cli|desktop)\.filename\)/u);
});

test("[A-024] every acceptance script that installs the toolchain derives its set", async () => {
  // The first repair covered `package.acceptance.ts` and left the copy in
  // `installed-browser.acceptance.ts` standing — one literal `pack()` list and
  // four literal install lists — under a documentation sentence that already
  // claimed the browser job installs the derived set. Naming both files here is
  // the point: a meta-test that reads one file is itself a hand-kept list.
  for (const name of ["package.acceptance.ts", "installed-browser.acceptance.ts"]) {
    const source = await readFile(join(root, "tests", name), "utf8");
    assert.match(source, /velar-packages\.mjs/u, `${name} installs the toolchain without reading the derived roster`);
    assert.doesNotMatch(
      source,
      /await pack\("(?:@velarscript\/[a-z-]+|create-velar)"\)/u,
      `${name} packs a package by literal name; pack the derived workspace layers`,
    );
  }
});

test("no tracked text file carries a NUL byte that hides it from every text tool", async () => {
  // `scripts/check-runtime-boundary.mjs` held a literal NUL inside a template
  // literal — a deduplication key written as the character rather than the `\0`
  // escape — and `packages/compiler/src/mechanical-fix.ts` held two more. One
  // byte is enough: `grep` classifies the whole file as binary and reports
  // nothing from it, so `grep -rn standardModuleSources scripts/` came back
  // empty while the gate script imported and called it on the next line. The
  // largest gate in the repository was invisible to every plain text search
  // anybody would run over it, which is the quietest possible way for a file to
  // stop being reviewed.
  //
  // Which files are text is decided without reference to the byte under test:
  // a file counts as text when, ignoring NULs, it decodes as UTF-8 and carries
  // no other control characters. Deciding it by the NUL — which is how git and
  // grep themselves decide — would make this assertion vacuous.
  const listed = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const offenders: string[] = [];
  let checked = 0;
  for (const file of listed.stdout.split("\n").filter((name) => name !== "")) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(root, file));
    } catch {
      continue;
    }
    const withoutNul = bytes.filter((byte) => byte !== 0);
    try {
      decoder.decode(withoutNul);
    } catch {
      continue;
    }
    if (withoutNul.some((byte) => byte < 9 || (byte > 13 && byte < 32) || byte === 127)) continue;
    checked += 1;
    if (bytes.includes(0)) offenders.push(file);
  }
  assert.ok(checked > 100, `only ${checked} tracked text files were read`);
  assert.deepEqual(offenders, [], "these text files carry a NUL byte, so grep and diff treat them as binary");
});
