import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), "velar-packages-"));

try {
  const compiler = await pack("@velarscript/compiler");
  const cli = await pack("@velarscript/cli");
  for (const package_ of [compiler, cli]) {
    assert.ok(package_.files.some((file) => file.path === "LICENSE"));
    assert.ok(package_.files.some((file) => file.path === "README.md"));
    assert.ok(package_.files.some((file) => file.path.startsWith("dist/") && file.path.endsWith(".js")));
    assert.ok(package_.files.some((file) => file.path.startsWith("dist/") && file.path.endsWith(".d.ts")));
    assert.ok(!package_.files.some((file) => /(?:^|\/)tests?(?:\/|$)/u.test(file.path)));
  }
  assert.ok(cli.files.some((file) => file.path === "dist/browser-test-runner.js"));
  assert.ok(cli.files.some((file) => file.path === "dist/production-verifier.js"));
  assert.ok(cli.files.some((file) => file.path === "dist/preview-server.js"));
  assert.ok(cli.files.some((file) => file.path === "dist/deployment-verifier.js"));

  await writeFile(join(directory, "package.json"), "{}\n", "utf8");
  await runNpm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(directory, compiler.filename),
    join(directory, cli.filename),
  ], directory);

  const installedCli = join(directory, "node_modules", "@velarscript", "cli", "dist", "cli.js");
  const installedManifest = JSON.parse(await readFile(join(directory, "node_modules", "@velarscript", "cli", "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    license: string;
  };
  assert.equal(installedManifest.license, "Apache-2.0");
  assert.match(await readFile(join(directory, "node_modules", "@velarscript", "cli", "LICENSE"), "utf8"), /Apache License\s+Version 2\.0/u);
  assert.equal(installedManifest.dependencies.playwright, "^1.58.2");
  assert.equal(installedManifest.dependencies["@velarscript/compiler"], "0.9.0-dev");
  const version = await run(process.execPath, [installedCli, "--version"], directory);
  assert.equal(version.stdout, "velar 0.9.0-dev\n");
  const help = await run(process.execPath, [installedCli, "help", "build"], directory);
  assert.match(help.stdout, /Usage: velar build/u);
  assert.match(help.stdout, /isolated production Web output/u);

  await writeFile(join(directory, "main.vel"), `
import {range, sum} from "velar/collections"

export const answer = sum(range(0, 7)) * 2
print(answer)
`.trimStart(), "utf8");
  await run(process.execPath, [installedCli, "build", "main.vel", "--out", "main.js"], directory);
  assert.match(await readFile(join(directory, "main.js"), "utf8"), /from "velar\/collections"/u);
  assert.match(await readFile(join(directory, "node_modules", "velar", "collections.js"), "utf8"), /export function range/u);
  const built = await run(process.execPath, [join(directory, "main.js")], directory);
  assert.equal(built.stdout, "42\n");

  const api = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {compile} from '@velarscript/compiler'; const result=compile('const value = 1\\n'); if (result.diagnostics.length || !result.code) process.exit(1); console.log(result.code.trim())",
  ], directory);
  assert.equal(api.stdout, "const value = 1;\n");
  process.stdout.write("Velar packed toolchain consumer acceptance passed\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}

interface PackedPackage {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

async function pack(workspace: string): Promise<PackedPackage> {
  const result = await runNpm(["pack", "--workspace", workspace, "--pack-destination", directory, "--json"], root);
  const packed = JSON.parse(result.stdout) as PackedPackage[];
  assert.equal(packed.length, 1);
  return packed[0]!;
}

async function runNpm(arguments_: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const npm = process.env.npm_execpath;
  return npm
    ? run(process.execPath, [npm, ...arguments_], cwd)
    : run(process.platform === "win32" ? "npm.cmd" : "npm", arguments_, cwd);
}

async function run(command: string, arguments_: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(command, arguments_, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`${command} ${arguments_.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
  return { stdout, stderr };
}
