import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { ModuleInterface } from "@velarscript/compiler";
import {
  encodeVelarLibraryInterface,
  loadVelarLibraryArtifactSet,
} from "../packages/cli/src/library-artifact.ts";
import {
  assertVelarLibraryArtifactSourceMap,
  assertVelarLibraryArtifactSourceMaps,
} from "../packages/cli/src/library-artifact-snapshot.ts";
import type { VelarPackageSubpath } from "../packages/cli/src/package-entry.ts";

test("source-map snapshots require one linked external v3 map", () => {
  const snapshot = {
    path: resolve("artifact", "dist", "index.js"),
    code: "export const value = true\n//# sourceMappingURL=index.js.map\n",
    sourceMapPath: resolve("artifact", "dist", "index.js.map"),
    sourceMap: sourceMap("index.js"),
  };
  assert.doesNotThrow(() => assertVelarLibraryArtifactSourceMap(snapshot));
  assert.throws(
    () => assertVelarLibraryArtifactSourceMap({ ...snapshot, code: "export const value = true\n" }),
    /exactly one sourceMappingURL/u,
  );
  assert.throws(
    () => assertVelarLibraryArtifactSourceMap({ ...snapshot, code: snapshot.code.replace("index.js.map", "other.js.map") }),
    /must link source map 'index\.js\.map'/u,
  );
  assert.throws(
    () => assertVelarLibraryArtifactSourceMap({ ...snapshot, sourceMap: "{}\n" }),
    /must contain version 3/u,
  );
  const legacy = { ...snapshot, code: "export const value = true\n", sourceMap: "{}\n" };
  assert.doesNotThrow(() => assertVelarLibraryArtifactSourceMaps(1, [legacy]));
  assert.throws(() => assertVelarLibraryArtifactSourceMaps(2, [legacy]), /exactly one sourceMappingURL/u);
});

test("an installed format-1 receipt accepts unlinked JavaScript with a declared conditional dependency", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-artifact-map-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeConditionalCommonJsDependency(root);
    const code = 'import { parse as parseYaml } from "yaml";\nexport const value = parseYaml\n';
    const map = sourceMap("index.js");
    const interface_ = emptyInterface();
    const receipt = {
      formatVersion: 1,
      kind: "velar-library-artifact",
      abiVersion: 1,
      package: { name: "source-map-probe", version: "1.0.0" },
      target: "core",
      compilerVersion: "0.18.0",
      sourceEntry: "src/index.vel",
      sources: [{ path: "src/index.vel", sha256: hash("export const value = true\n") }],
      entry: {
        javascript: "index.js",
        sourceMap: "index.js.map",
        interface: "index.veli.json",
        sha256: { javascript: hash(code), sourceMap: hash(map), interface: hash(interface_) },
      },
    };
    await Promise.all([
      writeFile(join(root, "package.json"), '{"type":"module","dependencies":{"yaml":"2.9.0"}}\n', "utf8"),
      writeFile(join(root, "src", "index.vel"), "export const value = true\n", "utf8"),
      writeFile(join(root, "dist", "index.js"), code, "utf8"),
      writeFile(join(root, "dist", "index.js.map"), map, "utf8"),
      writeFile(join(root, "dist", "index.veli.json"), interface_, "utf8"),
      writeFile(join(root, "dist", "velar-library.json"), `${JSON.stringify(receipt)}\n`, "utf8"),
    ]);
    const artifacts = await loadVelarLibraryArtifactSet({
      packageRoot: root,
      packageName: "source-map-probe",
      packageVersion: "1.0.0",
      packageEntries: new Map([[".", { relativePath: "src/index.vel" }]]),
      descriptor: "dist/velar-library.json",
      target: "core",
      packageExports: { ".": "./dist/index.js" },
      runtimeDependencies: new Set(["yaml"]),
    });
    assert.equal(artifacts.get(".")?.entrySnapshot.code, code);
    assert.equal(artifacts.get(".")?.entrySnapshot.sourceMap, map);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an installed format-2 receipt requires linked source-map v3 and target proof", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-artifact-map-v2-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeConditionalCommonJsDependency(root);
    const rootSource = "export const value = true\n";
    const workerSource = "export const worker = true\n";
    const rootCode = 'import { parse as parseYaml } from "yaml";\nexport const value = parseYaml\n//# sourceMappingURL=index.js.map\n';
    const workerCode = "export const worker = true\n//# sourceMappingURL=worker.js.map\n";
    const invalidMap = "{}\n";
    const workerMap = sourceMap("worker.js");
    const interface_ = emptyInterface();
    const receipt = {
      formatVersion: 2,
      kind: "velar-library-artifact",
      abiVersion: 1,
      package: { name: "source-map-probe", version: "1.0.0" },
      target: "core",
      compilerVersion: "0.28.1",
      sources: [
        { path: "src/index.vel", sha256: hash(rootSource) },
        { path: "src/worker.vel", sha256: hash(workerSource) },
      ],
      entries: {
        ".": artifactEntry("src/index.vel", "index", rootCode, invalidMap, interface_),
        "./worker": artifactEntry("src/worker.vel", "worker", workerCode, workerMap, interface_),
      },
      chunks: [],
    };
    await Promise.all([
      writeFile(join(root, "package.json"), '{"type":"module","dependencies":{"yaml":"2.9.0"}}\n', "utf8"),
      writeFile(join(root, "src", "index.vel"), rootSource, "utf8"),
      writeFile(join(root, "src", "worker.vel"), workerSource, "utf8"),
      writeFile(join(root, "dist", "index.js"), rootCode, "utf8"),
      writeFile(join(root, "dist", "index.js.map"), invalidMap, "utf8"),
      writeFile(join(root, "dist", "index.veli.json"), interface_, "utf8"),
      writeFile(join(root, "dist", "worker.js"), workerCode, "utf8"),
      writeFile(join(root, "dist", "worker.js.map"), workerMap, "utf8"),
      writeFile(join(root, "dist", "worker.veli.json"), interface_, "utf8"),
      writeFile(join(root, "dist", "velar-library.json"), `${JSON.stringify(receipt)}\n`, "utf8"),
    ]);
    const options = {
      packageRoot: root,
      packageName: "source-map-probe",
      packageVersion: "1.0.0",
      packageEntries: new Map<VelarPackageSubpath, { readonly relativePath: string }>([
        [".", { relativePath: "src/index.vel" }],
        ["./worker", { relativePath: "src/worker.vel" }],
      ]),
      descriptor: "dist/velar-library.json",
      target: "core" as const,
      packageExports: { ".": "./dist/index.js", "./worker": "./dist/worker.js" },
      runtimeDependencies: new Set(["yaml"]),
    };
    await assert.rejects(loadVelarLibraryArtifactSet(options), /must contain version 3/u);

    const validRootMap = sourceMap("index.js");
    const targetProofReceipt = {
      ...receipt,
      entries: {
        ...receipt.entries,
        ".": artifactEntry("src/index.vel", "index", rootCode, validRootMap, interface_),
      },
    };
    await Promise.all([
      writeFile(join(root, "dist", "index.js.map"), validRootMap, "utf8"),
      writeFile(join(root, "dist", "velar-library.json"), `${JSON.stringify(targetProofReceipt)}\n`, "utf8"),
    ]);
    await assert.rejects(loadVelarLibraryArtifactSet(options), /not provably ESM for both Node and browser consumers/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function sourceMap(file: string): string {
  return `${JSON.stringify({ version: 3, file, sources: ["../src/index.vel"], sourcesContent: [""], names: [], mappings: "" })}\n`;
}

function emptyInterface(): string {
  return encodeVelarLibraryInterface({
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
}

function artifactEntry(sourceEntry: string, name: string, code: string, map: string, interface_: string) {
  return {
    sourceEntry,
    javascript: `${name}.js`,
    sourceMap: `${name}.js.map`,
    interface: `${name}.veli.json`,
    sha256: { javascript: hash(code), sourceMap: hash(map), interface: hash(interface_) },
  };
}

async function writeConditionalCommonJsDependency(root: string): Promise<void> {
  const packageRoot = join(root, "node_modules", "yaml");
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await mkdir(join(packageRoot, "browser"), { recursive: true });
  await Promise.all([
    writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
      name: "yaml",
      version: "2.9.0",
      type: "commonjs",
      exports: { ".": { node: "./dist/index.js", default: "./browser/index.js" } },
    })}\n`, "utf8"),
    writeFile(join(packageRoot, "browser", "package.json"), '{"type":"module"}\n', "utf8"),
    writeFile(join(packageRoot, "dist", "index.js"), "exports.parse = value => value;\n", "utf8"),
    writeFile(join(packageRoot, "browser", "index.js"), "export const parse = value => value;\n", "utf8"),
  ]);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
