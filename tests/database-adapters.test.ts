import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { nodeModuleInterfaces } from "@velarscript/node/compiler";
import { standardModuleInterfaces } from "../packages/cli/src/standard-modules.ts";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const cli = join(root, "packages", "cli", "dist", "cli.js");
const fixture = join(root, "tests", "fixtures", "database-adapters");

async function run(executable: string, arguments_: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", code => code === 0
      ? resolve(stdout)
      : reject(new Error(`${executable} ${arguments_.join(" ")} failed (${code})\n${stdout}${stderr}`)));
  });
}

test("database contract and SQLite adapter execute models, migrations, streaming, bounds, and ownership", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(root, ".velar-database-adapter-"));
  try {
    const output = join(directory, "dist");
    await run(process.execPath, [cli, "build", fixture, "--out-dir", output], root);
    assert.equal(await run(process.execPath, [join(output, "main.js")], directory), "adapter:3:1:3:4\n");
    const sqliteOutput = join(output, "__velar_packages__", "@velarscript", "sqlite", "src");
    const emitted = (await Promise.all((await readdir(sqliteOutput))
      .filter(name => name.endsWith(".js"))
      .map(name => readFile(join(sqliteOutput, name), "utf8")))).join("\n");
    assert.match(emitted, /new Worker/u);
    assert.match(emitted, /statementCacheCapacity/u);
    assert.match(emitted, /stream\.ack/u);
    assert.match(emitted, /target\.iterate/u);
    assert.match(emitted, /closePromise/u);
    assert.doesNotMatch(emitted, /velar\/sqlite/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concrete adapters no longer occupy the Standard or Node module namespaces", () => {
  for (const specifier of ["velar/msgpack", "velar/compression", "velar/noise"]) {
    assert.equal(standardModuleInterfaces().has(specifier), false, specifier);
  }
  assert.equal(nodeModuleInterfaces.has("velar/sqlite"), false);
});
