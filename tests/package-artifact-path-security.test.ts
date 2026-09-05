import assert from "node:assert/strict";
import test from "node:test";
import {
  assertVelarLibraryArtifactReceiptPackagePaths,
  validateVelarLibraryArtifactReceipt,
  type VelarLibraryArtifactReceiptV2,
} from "../packages/cli/src/library-artifact-receipt.ts";
import { packageContentFailures } from "./package-contract.ts";

const HASH = "0".repeat(64);

test("receipt claims reject portable file/directory hierarchies in their own coordinate spaces", () => {
  const receipt = receiptFixture();
  const forged = {
    ...receipt,
    entries: {
      ...receipt.entries,
      "./worker": {
        ...receipt.entries["./worker"],
        javascript: "Tree.js/worker.js",
      },
    },
  };
  assert.throws(
    () => validateVelarLibraryArtifactReceipt(forged),
    /cannot be both a file and an ancestor directory/u,
  );

  const forgedSources = {
    ...receipt,
    sources: [...receipt.sources, { path: "src", sha256: HASH }],
  };
  assert.throws(
    () => validateVelarLibraryArtifactReceipt(forgedSources),
    /cannot be both a file and an ancestor directory/u,
  );
});

test("package-root receipt claims reject source/output hierarchy aliases", () => {
  const receipt = validateVelarLibraryArtifactReceipt({
    ...receiptFixture(),
    sources: [...receiptFixture().sources, { path: "dist/tree.js", sha256: HASH }],
    entries: {
      ...receiptFixture().entries,
      ".": { ...receiptFixture().entries["."], javascript: "tree.js/entry.js" },
    },
  });
  assert.throws(
    () => assertVelarLibraryArtifactReceiptPackagePaths(receipt, "dist/velar-library.json"),
    /cannot be both a file and an ancestor directory/u,
  );
});

test("the packed gate rejects a forged receipt and publication-wide portable hierarchy", async () => {
  const receipt = receiptFixture();
  const forged = Buffer.from(`${JSON.stringify({
    ...receipt,
    entries: {
      ...receipt.entries,
      "./worker": { ...receipt.entries["./worker"], javascript: "tree.js/worker.js" },
    },
  })}\n`);
  const manifest = {
    name: "packed-hierarchy-probe",
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/tree.js", "./worker": "./dist/tree.js/worker.js" },
    velar: {
      entry: "src/index.vel",
      entries: { "./worker": "src/worker.vel" },
      artifacts: { core: "dist/velar-library.json" },
    },
  };
  const paths = [
    "LICENSE",
    "README.md",
    "src/index.vel",
    "src/worker.vel",
    "dist/tree.js",
    "dist/tree.js/worker.js",
    "dist/velar-library.json",
  ];
  const readPaths: string[] = [];
  const failures = await packageContentFailures(
    manifest,
    { filename: "probe.tgz", files: paths.map((path) => ({ path })) },
    async (path) => {
      readPaths.push(path);
      return path === "dist/velar-library.json" ? forged : Buffer.alloc(0);
    },
  );
  assert.ok(failures.some((failure) => failure.includes("cannot be both a file and an ancestor directory")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("artifact receipt 'dist/velar-library.json' is invalid")), failures.join("\n"));
  assert.deepEqual(readPaths, ["dist/velar-library.json"], "a structurally invalid receipt must fail before reading claims");
});

test("all published paths reject portable file/directory aliases without an artifact receipt", async () => {
  const manifest = { name: "packed-tree-probe", version: "1.0.0", type: "module", main: "Tree" };
  const failures = await packageContentFailures(manifest, {
    filename: "probe.tgz",
    files: ["LICENSE", "README.md", "Tree", "tree/entry.js"].map((path) => ({ path })),
  });
  assert.ok(failures.some((failure) => failure.includes("'Tree' and 'tree/entry.js' cannot be both a file and an ancestor directory")), failures.join("\n"));
});

function receiptFixture(): VelarLibraryArtifactReceiptV2 {
  const entry = (sourceEntry: string, javascript: string) => ({
    sourceEntry,
    javascript,
    sourceMap: `${javascript}.map`,
    interface: `${javascript}.veli.json`,
    sha256: { javascript: HASH, sourceMap: HASH, interface: HASH },
  });
  return {
    formatVersion: 2,
    kind: "velar-library-artifact",
    abiVersion: 1,
    package: { name: "packed-hierarchy-probe", version: "1.0.0" },
    target: "core",
    compilerVersion: "0.28.1",
    sources: [
      { path: "src/index.vel", sha256: HASH },
      { path: "src/worker.vel", sha256: HASH },
    ],
    entries: {
      ".": entry("src/index.vel", "tree.js"),
      "./worker": entry("src/worker.vel", "worker.js"),
    },
    chunks: [],
  };
}
