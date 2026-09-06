import assert from "node:assert/strict";
import {lstat, mkdir, mkdtemp, readFile, rm, truncate, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test from "node:test";
import type {ProjectResult} from "../packages/cli/src/project.ts";
import {
  MAX_STANDALONE_SOURCE_MAP_BYTES,
  readStandaloneReceipt,
} from "../packages/cli/src/standalone-output-ownership.ts";
import {
  MAX_STANDALONE_TRANSACTION_OPERATIONS,
  writeStandaloneOutputTransaction,
} from "../packages/cli/src/standalone-output-transaction.ts";

test("an oversized generated source map is rejected before previous standalone bytes change", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-standalone-source-map-limit-"));
  try {
    const source = join(root, "main.vel");
    const output = join(root, "dist", "main.js");
    const map = `${output}.map`;
    const previousOutput = "previous JavaScript\n";
    const previousMap = '{"previous":true}\n';
    await write(source, 'print("unused")\n');
    await write(output, previousOutput);
    await write(map, previousMap);

    await assert.rejects(writeStandaloneOutputTransaction({
      outputPath: output,
      project: projectFixture(root, source),
      runtimeModules: new Set(),
      claimedFiles: [output, map],
      cleanupFiles: [],
      generatedSiblingFiles: [],
      additionalInputs: [],
      writeStaged: async (stagedOutput) => {
        await write(stagedOutput, "new JavaScript\n//# sourceMappingURL=main.js.map\n");
        await write(`${stagedOutput}.map`, "{}\n");
        await truncate(`${stagedOutput}.map`, MAX_STANDALONE_SOURCE_MAP_BYTES + 1);
      },
    }), /Generated source map .* exceeds/u);
    assert.equal(await readFile(output, "utf8"), previousOutput);
    assert.equal(await readFile(map, "utf8"), previousMap);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("a giant author main without a bounded tail receipt grants no sidecar ownership", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-standalone-main-tail-limit-"));
  try {
    const output = join(root, "dist", "main.js");
    await write(output, "author JavaScript\n");
    await truncate(output, 128 * 1024 * 1024);
    assert.equal((await readStandaloneReceipt(output)).size, 0);
    assert.equal((await lstat(output)).size, 128 * 1024 * 1024);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("standalone recovery bounds the output-directory roster before staging", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-standalone-output-inventory-limit-"));
  try {
    const source = join(root, "main.vel");
    const outputRoot = join(root, "dist");
    const output = join(outputRoot, "main.js");
    await write(source, 'print("unused")\n');
    await mkdir(outputRoot, {recursive: true});
    for (let start = 0; start <= MAX_STANDALONE_TRANSACTION_OPERATIONS; start += 128) {
      await Promise.all(Array.from(
        {length: Math.min(128, MAX_STANDALONE_TRANSACTION_OPERATIONS + 1 - start)},
        (_, offset) => writeFile(join(outputRoot, `author-${start + offset}.txt`), "author\n", "utf8"),
      ));
    }

    await assert.rejects(writeStandaloneOutputTransaction({
      outputPath: output,
      project: projectFixture(root, source),
      runtimeModules: new Set(),
      claimedFiles: [output],
      cleanupFiles: [],
      generatedSiblingFiles: [],
      additionalInputs: [],
      writeStaged: async () => assert.fail("an oversized output inventory must fail before staging"),
    }), /Standalone output inventory cannot exceed/u);
    assert.equal(await readFile(join(outputRoot, "author-0.txt"), "utf8"), "author\n");
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

function projectFixture(root: string, source: string): ProjectResult {
  return {
    modules: [{inputPath: source, result: {dependencies: [], resources: [], runtimeModules: []}}],
    compilerExtensions: [],
    extensionConfig: new Map(),
    publicRoot: join(root, "public"),
    velarPackages: [],
    resources: [],
    externalTypeDependencies: new Map(),
  } as unknown as ProjectResult;
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, contents, "utf8");
}
