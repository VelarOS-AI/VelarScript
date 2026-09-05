import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = new URL("../packages/cli/src/cli.ts", import.meta.url).pathname;

function runCli(arguments_: readonly string[], cwd: string) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("multi-entry frozen artifacts preserve one shared module instance", async () => {
  const root = await makeTemporaryDirectory("velar-library-shared-runtime-");
  const library = join(root, "library");
  const consumer = join(root, "consumer");
  await mkdir(join(library, "src"), { recursive: true });
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  const manifest = {
    name: "shared-runtime",
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/index.js", "./worker": "./dist/workers/worker.mjs" },
    velar: {
      entry: "src/index.vel",
      entries: { "./worker": "src/worker.vel" },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  };
  await writeFile(join(library, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(library, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(library, "src", "shared.vel"), [
    "let count = 0",
    "export def next() -> number:",
    "    count += 1",
    "    return count",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(library, "src", "index.vel"), 'export {next} from "./shared.vel"\n', "utf8");
  await writeFile(join(library, "src", "worker.vel"), [
    'import {next} from "./shared.vel"',
    "export def workerNext() -> number: return next()",
    "",
  ].join("\n"), "utf8");
  await symlink(library, join(consumer, "node_modules", "shared-runtime"), "dir");
  const application = join(consumer, "main.vel");
  await writeFile(application, [
    'import {next} from "shared-runtime"',
    'import {workerNext} from "shared-runtime/worker"',
    "print(next())",
    "print(workerNext())",
    "",
  ].join("\n"), "utf8");

  const sourceRun = runCli(["run", application], consumer);
  assert.equal(sourceRun.status, 0, `${sourceRun.stdout}${sourceRun.stderr}`);
  assert.equal(sourceRun.stdout, "1\n2\n");
  Object.assign(manifest.velar, { artifacts: { core: "dist/velar-library.json" } });
  await writeFile(join(library, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const built = runCli(["build-library", library], root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const receipt = JSON.parse(await readFile(join(library, "dist", "velar-library.json"), "utf8")) as {
    readonly formatVersion: number;
    readonly entries: Readonly<Record<string, { readonly javascript: string; readonly sourceMap: string }>>;
    readonly chunks: readonly { readonly javascript: string; readonly sourceMap: string }[];
  };
  assert.equal(receipt.formatVersion, 2);
  assert.equal(receipt.entries["."]?.javascript, "index.js");
  assert.equal(receipt.entries["./worker"]?.javascript, "workers/worker.mjs");
  assert.match(
    await readFile(join(library, "dist", "workers", "worker.mjs"), "utf8"),
    /sourceMappingURL=worker\.mjs\.map/u,
  );
  assert.equal(
    JSON.parse(await readFile(join(library, "dist", "workers", "worker.mjs.map"), "utf8")).file,
    "worker.mjs",
  );
  assert.ok(receipt.chunks.length > 0, "the shared module must be emitted once as a receipt-covered chunk");

  const frozenRun = runCli(["run", application], consumer);
  assert.equal(frozenRun.status, 0, `${frozenRun.stdout}${frozenRun.stderr}`);
  assert.equal(frozenRun.stdout, sourceRun.stdout);

  const chunkPath = join(library, "dist", receipt.chunks[0]!.javascript);
  const chunk = await readFile(chunkPath, "utf8");
  await writeFile(chunkPath, `${chunk}\n`, "utf8");
  const tampered = runCli(["run", application], consumer);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /artifact chunk JavaScript hash mismatch/u);
});
