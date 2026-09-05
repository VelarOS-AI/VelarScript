import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { ModuleInterface } from "@velarscript/compiler";
import { encodeVelarLibraryInterface } from "../packages/cli/src/library-artifact.ts";
import { packageContentFailures } from "./package-contract.ts";

const manifest = {
  name: "velar-packed-artifact-budget-probe",
  version: "1.0.0",
  type: "module",
  exports: { ".": "./dist/index.js", "./worker": "./dist/worker.js" },
  velar: {
    entry: "src/index.vel",
    entries: { "./worker": "src/worker.vel" },
    artifacts: { core: "dist/velar-library.json" },
  },
};

const emptyInterface = Buffer.from(encodeVelarLibraryInterface({
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
} satisfies ModuleInterface));
const source = Buffer.from("export const value = true\n");
const ordinaryJavaScript = Buffer.from("export const value = true\n");
const ordinaryMap = Buffer.from("{}\n");

test("packed receipts apply the consumer's aggregate interface, JavaScript, and artifact-set budgets", async () => {
  const wideInterface = Buffer.from(`${" ".repeat(4 * 1024 * 1024)}${emptyInterface.toString("utf8")}`);
  assert.ok((await inspect({ interface: wideInterface })).some((failure) =>
    failure.includes("artifact interface set exceeds 8388608 bytes")
  ));

  const wideJavaScript = Buffer.from(`${" ".repeat(8 * 1024 * 1024)}export const value = true\n`);
  assert.ok((await inspect({ javascript: wideJavaScript })).some((failure) =>
    failure.includes("artifact JavaScript set exceeds 16777216 bytes")
  ));

  const maximumMap = Buffer.alloc(64 * 1024 * 1024, 0x20);
  const reads: string[] = [];
  const aggregateFailures = await inspect(
    { maps: [maximumMap, maximumMap, maximumMap, maximumMap, maximumMap] },
    (path) => reads.push(path),
  );
  assert.ok(aggregateFailures.some((failure) =>
    failure.includes("artifact set exceeds 268435456 bytes")
  ));
  assert.ok(reads.includes("dist/__velar_chunks/chunk-1.js.map"), "the rejecting file must be read before its size can be accounted");
  assert.ok(!reads.includes("dist/__velar_chunks/chunk-2.js"), "the gate must stop reading and release retained outputs at the first aggregate failure");
});

async function inspect(options: {
  readonly javascript?: Uint8Array;
  readonly interface?: Uint8Array;
  readonly maps?: readonly Uint8Array[];
}, onRead?: (path: string) => void): Promise<string[]> {
  const javascript = options.javascript ?? ordinaryJavaScript;
  const interface_ = options.interface ?? emptyInterface;
  const maps = options.maps ?? [ordinaryMap, ordinaryMap];
  const digests = new Map<Uint8Array, string>();
  const digest = (value: Uint8Array): string => {
    const existing = digests.get(value);
    if (existing !== undefined) return existing;
    const result = createHash("sha256").update(value).digest("hex");
    digests.set(value, result);
    return result;
  };
  const entry = (sourceEntry: string, name: string, sourceMap: string, map: Uint8Array) => ({
    sourceEntry,
    javascript: `${name}.js`,
    sourceMap,
    interface: `${name}.veli.json`,
    sha256: { javascript: digest(javascript), sourceMap: digest(map), interface: digest(interface_) },
  });
  const root = entry("src/index.vel", "index", "index.js.map", maps[0]!);
  const worker = entry("src/worker.vel", "worker", "worker.js.map", maps[1]!);
  const chunks = maps.slice(2).map((map, index) => ({
    javascript: `__velar_chunks/chunk-${index}.js`,
    sourceMap: `__velar_chunks/chunk-${index}.js.map`,
    sha256: { javascript: digest(ordinaryJavaScript), sourceMap: digest(map) },
  }));
  const receipt = Buffer.from(`${JSON.stringify({
    formatVersion: 2,
    kind: "velar-library-artifact",
    abiVersion: 1,
    package: { name: manifest.name, version: manifest.version },
    target: "core",
    compilerVersion: "0.28.1",
    sources: [
      { path: root.sourceEntry, sha256: digest(source) },
      { path: worker.sourceEntry, sha256: digest(source) },
    ],
    entries: { ".": root, "./worker": worker },
    chunks,
  })}\n`);
  const files = new Map<string, Uint8Array>([
    ["src/index.vel", source], ["src/worker.vel", source],
    ["dist/index.js", javascript], ["dist/index.js.map", maps[0]!], ["dist/index.veli.json", interface_],
    ["dist/worker.js", javascript], ["dist/worker.js.map", maps[1]!], ["dist/worker.veli.json", interface_],
    ["dist/velar-library.json", receipt],
  ]);
  for (const [index, chunk] of chunks.entries()) {
    files.set(`dist/${chunk.javascript}`, ordinaryJavaScript);
    files.set(`dist/${chunk.sourceMap}`, maps[index + 2]!);
  }
  const packed = {
    filename: "probe.tgz",
    files: ["LICENSE", "README.md", ...files.keys()].map((path) => ({ path })),
  };
  return packageContentFailures(manifest, packed, async (path) => {
    onRead?.(path);
    return files.get(path)!;
  });
}
