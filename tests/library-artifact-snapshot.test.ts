import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import {
  artifactSnapshotContents,
  assertArtifactSnapshotCurrent,
} from "../packages/cli/src/library-artifact.ts";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { checkResolvedProject } from "../packages/cli/src/project-check.ts";
import { bundleStandaloneJavaScript } from "../packages/cli/src/standalone-build.ts";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = new URL("../packages/cli/src/cli.ts", import.meta.url).pathname;

function runCli(arguments_: readonly string[], cwd: string) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function createStandaloneArtifactFixture(root: string): Promise<{
  readonly library: string;
  readonly consumer: string;
  readonly entry: string;
}> {
  const library = join(root, "library");
  const consumer = join(root, "consumer");
  await mkdir(join(library, "src"), { recursive: true });
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await writeFile(join(library, "package.json"), `${JSON.stringify({
    name: "standalone-frozen",
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/index.js", "./worker": "./dist/worker.js" },
    velar: {
      entry: "src/index.vel",
      entries: { "./worker": "src/worker.vel" },
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core"],
      requires: { capabilities: [] },
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
  await writeFile(join(library, "src", "shared.vel"), 'export def decorate(value: string) -> string: return f"<{value}>"\n', "utf8");
  await writeFile(join(library, "src", "worker.vel"), 'import {decorate} from "./shared.vel"\nexport def workerLabel() -> string: return decorate("worker")\n', "utf8");
  await writeFile(join(library, "src", "index.vel"), [
    'import {decorate} from "./shared.vel"',
    'import {workerLabel} from "standalone-frozen/worker"',
    'export def rootLabel() -> string: return f"{decorate(\"root\")}:{workerLabel()}"',
    "",
  ].join("\n"), "utf8");
  const built = runCli(["build-library", library, "--mode", "readable"], root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  await symlink(library, join(consumer, "node_modules", "standalone-frozen"), "dir");
  const entry = join(consumer, "main.vel");
  await writeFile(entry, 'import {rootLabel} from "standalone-frozen"\nprint(rootLabel())\n', "utf8");
  return { library, consumer, entry };
}

interface MutableReceiptEntry {
  readonly interface: string;
  readonly sha256: { interface: string };
}

async function mutateInterface(
  library: string,
  subpath: "." | "./worker",
  bytes: Uint8Array,
): Promise<void> {
  const receiptPath = join(library, "dist", "velar-library.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
    entries: Record<string, MutableReceiptEntry>;
  };
  const entry = receipt.entries[subpath]!;
  await writeFile(join(library, "dist", entry.interface), bytes);
  entry.sha256.interface = createHash("sha256").update(bytes).digest("hex");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

test("artifact consumers keep verified JavaScript and map bytes as one snapshot", async () => {
  const root = await makeTemporaryDirectory("velar-artifact-snapshot-");
  const path = join(root, "entry.js");
  const sourceMapPath = join(root, "entry.js.map");
  const code = "export const value = 1;\n//# sourceMappingURL=entry.js.map\n";
  const sourceMap = '{"version":3,"sources":["entry.vel"],"mappings":""}\n';
  await Promise.all([
    writeFile(path, code, "utf8"),
    writeFile(sourceMapPath, sourceMap, "utf8"),
  ]);
  const snapshot = {
    path: await realpath(path),
    code,
    sourceMapPath: await realpath(sourceMapPath),
    sourceMap,
  };

  await assertArtifactSnapshotCurrent(snapshot);
  assert.doesNotMatch(artifactSnapshotContents(snapshot, false), /sourceMappingURL/u);
  assert.match(artifactSnapshotContents(snapshot, true), /sourceMappingURL=data:application\/json;base64,/u);

  await writeFile(path, "export const value = 2;\n", "utf8");
  await assert.rejects(
    assertArtifactSnapshotCurrent(snapshot),
    /changed after it was checked/u,
  );
});

test("artifact authorization rejects malformed UTF-8 even when its raw-byte hash matches", async () => {
  const root = await makeTemporaryDirectory("velar-artifact-invalid-utf8-");
  const fixture = await createStandaloneArtifactFixture(root);
  await mutateInterface(fixture.library, "./worker", Uint8Array.from([0x7b, 0xc3, 0x28, 0x7d]));

  const checked = runCli(["check", fixture.entry], fixture.consumer);
  assert.equal(checked.status, 1);
  assert.match(`${checked.stdout}\n${checked.stderr}`, /Velar library interface must contain valid UTF-8/u);
  assert.doesNotMatch(`${checked.stdout}\n${checked.stderr}`, /interface hash mismatch/u);
});

test("a complete multi-entry receipt has one strict aggregate interface budget", async () => {
  const root = await makeTemporaryDirectory("velar-artifact-interface-budget-");
  const fixture = await createStandaloneArtifactFixture(root);
  const interfaceBytes = Buffer.from(`${" ".repeat(4 * 1024 * 1024)}{}`, "utf8");
  await mutateInterface(fixture.library, ".", interfaceBytes);
  await mutateInterface(fixture.library, "./worker", interfaceBytes);

  const checked = runCli(["check", fixture.entry], fixture.consumer);
  assert.equal(checked.status, 1);
  assert.match(`${checked.stdout}\n${checked.stderr}`, /artifact interface set exceeds 8388608 bytes/u);
});

test("single-file builds bundle complete verified frozen graphs and reject their npm edges", async () => {
  const root = await makeTemporaryDirectory("velar-standalone-artifact-");
  const fixture = await createStandaloneArtifactFixture(root);
  const output = join(root, "release", "main.js");
  const built = runCli(["build", fixture.entry, "--out", output, "--mode", "readable"], fixture.consumer);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  assert.doesNotMatch(await readFile(output, "utf8"), /standalone-frozen/u);
  const executed = spawnSync(process.execPath, [output], { cwd: dirname(output), encoding: "utf8" });
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.stdout, "<root>:<worker>\n");

  const config = await resolveVelarProject(fixture.entry);
  const checked = await checkResolvedProject(config, fixture.entry);
  assert.deepEqual(checked.errors, []);
  const artifact = [...checked.project.velarArtifactImports.values()][0]!;
  assert.equal(artifact.entrySnapshots.length, 2);
  assert.ok(artifact.chunkSnapshots.length > 0);
  const snapshots = [...artifact.entrySnapshots, ...artifact.chunkSnapshots];
  try {
    for (const snapshot of snapshots) {
      await writeFile(snapshot.path, `${snapshot.code}\nglobalThis.__standaloneTampered = true;\n`, "utf8");
    }
    const snapshotOutput = join(root, "snapshot", "main.js");
    const bundled = await bundleStandaloneJavaScript(
      snapshotOutput,
      checked.project.modules[0]!.result,
      checked.project.resources,
      "readable",
      false,
      checked.project.velarArtifactImports,
    );
    assert.doesNotMatch(bundled.code, /__standaloneTampered|standalone-frozen/u);
    await mkdir(dirname(snapshotOutput), { recursive: true });
    await writeFile(snapshotOutput, bundled.code, "utf8");
    const snapshotExecution = spawnSync(process.execPath, [snapshotOutput], { encoding: "utf8" });
    assert.equal(snapshotExecution.status, 0, snapshotExecution.stderr);
    assert.equal(snapshotExecution.stdout, "<root>:<worker>\n");
  } finally {
    await Promise.all(snapshots.map((snapshot) => writeFile(snapshot.path, snapshot.code, "utf8")));
  }

  const externalEntry = {
    ...artifact.entrySnapshot,
    code: `${artifactSnapshotContents(artifact.entrySnapshot, false)}\nimport "standalone-external";\n`,
  };
  const externalArtifact = {
    ...artifact,
    entrySnapshot: externalEntry,
    entrySnapshots: artifact.entrySnapshots.map((snapshot) => snapshot.path === externalEntry.path ? externalEntry : snapshot),
  };
  const externalImports = new Map([...checked.project.velarArtifactImports].map(([key, value]) => [key, value === artifact ? externalArtifact : value] as const));
  await assert.rejects(
    bundleStandaloneJavaScript(output, checked.project.modules[0]!.result, [], "readable", false, externalImports),
    /external npm dependency 'standalone-external'.*single-file builds require dependency-free frozen artifacts/u,
  );
});
