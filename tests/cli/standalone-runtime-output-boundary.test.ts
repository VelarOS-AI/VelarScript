import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {writeGeneratedRuntimePackageReceipt} from "../../packages/cli/src/generated-runtime-package.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(repositoryRoot, "packages", "cli", "src", "cli.ts");

test("standalone standard-runtime tree cannot consume a checked source", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-standalone-runtime-source-"));
  try {
    const runtimeRoot = join(root, "dist", "node_modules", "velar");
    const source = join(runtimeRoot, "main.vel");
    await write(join(runtimeRoot, "package.json"), `${JSON.stringify({
      name: "velar",
      private: true,
      type: "module",
      velarGeneratedRuntime: 1,
      velarStandaloneOwner: "main.js",
    })}\n`);
    const contents = 'import {readText} from "velar/fs"\nconst reader = readText\nprint("preserved")\n';
    await write(source, contents);
    await writeGeneratedRuntimePackageReceipt(runtimeRoot, "velar", "main.js");
    const built = spawnSync(process.execPath, [cli, "build", source, "--out", join(root, "dist", "main.js")], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(built.status, 1, String(built.stdout) + String(built.stderr));
    assert.match(String(built.stderr), /node_modules\/velar.*overlaps checked source/u);
    assert.equal(await readFile(source, "utf8"), contents);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, contents, "utf8");
}
