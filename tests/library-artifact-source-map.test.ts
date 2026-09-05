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
import { assertVelarLibraryArtifactSourceMap } from "../packages/cli/src/library-artifact-snapshot.ts";

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
});

test("an installed receipt cannot authenticate an opaque or malformed source map", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-artifact-map-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    const code = "export const value = true\n//# sourceMappingURL=index.js.map\n";
    const map = "{}\n";
    const interface_ = emptyInterface();
    const receipt = {
      formatVersion: 1,
      kind: "velar-library-artifact",
      abiVersion: 1,
      package: { name: "source-map-probe", version: "1.0.0" },
      target: "core",
      compilerVersion: "0.28.1",
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
      writeFile(join(root, "package.json"), '{"type":"module"}\n', "utf8"),
      writeFile(join(root, "src", "index.vel"), "export const value = true\n", "utf8"),
      writeFile(join(root, "dist", "index.js"), code, "utf8"),
      writeFile(join(root, "dist", "index.js.map"), map, "utf8"),
      writeFile(join(root, "dist", "index.veli.json"), interface_, "utf8"),
      writeFile(join(root, "dist", "velar-library.json"), `${JSON.stringify(receipt)}\n`, "utf8"),
    ]);
    await assert.rejects(loadVelarLibraryArtifactSet({
      packageRoot: root,
      packageName: "source-map-probe",
      packageVersion: "1.0.0",
      packageEntries: new Map([[".", { relativePath: "src/index.vel" }]]),
      descriptor: "dist/velar-library.json",
      target: "core",
      packageExports: { ".": "./dist/index.js" },
    }), /must contain version 3/u);
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

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
