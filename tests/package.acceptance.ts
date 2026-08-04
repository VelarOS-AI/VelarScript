import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "velar-packages-"));

try {
  const compiler = await pack("@velarscript/compiler");
  const web = await pack("@velarscript/web");
  const create = await pack("create-velar");
  const cli = await pack("@velarscript/cli");
  for (const package_ of [compiler, web, create, cli]) {
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
  assert.ok(compiler.files.some((file) => file.path === "dist/framework-host.js"));
  assert.ok(web.files.some((file) => file.path === "dist/host.js"));

  await writeFile(join(directory, "package.json"), "{}\n", "utf8");
  await runNpm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(directory, compiler.filename),
    join(directory, web.filename),
    join(directory, create.filename),
    join(directory, cli.filename),
  ], directory);

  const installedCli = join(directory, "node_modules", "@velarscript", "cli", "dist", "cli.js");
  const installedCreate = join(directory, "node_modules", "create-velar", "dist", "cli.js");
  const installedCreateManifest = JSON.parse(await readFile(join(directory, "node_modules", "create-velar", "package.json"), "utf8")) as {
    bin: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  assert.equal(installedCreateManifest.bin["create-velar"], "./dist/cli.js");
  assert.deepEqual(installedCreateManifest.dependencies ?? {}, {});
  const installedManifest = JSON.parse(await readFile(join(directory, "node_modules", "@velarscript", "cli", "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    peerDependencies?: Record<string, string>;
    license: string;
  };
  assert.equal(installedManifest.license, "Apache-2.0");
  assert.match(await readFile(join(directory, "node_modules", "@velarscript", "cli", "LICENSE"), "utf8"), /Apache License\s+Version 2\.0/u);
  assert.equal(installedManifest.dependencies.playwright, "^1.58.2");
  assert.equal(installedManifest.dependencies["@velarscript/compiler"], "0.10.0-dev");
  assert.equal(installedManifest.dependencies["create-velar"], "0.10.0-dev");
  assert.equal(installedManifest.peerDependencies?.["@velarscript/web"], undefined);
  assert.equal(installedManifest.dependencies["@velarscript/web"], undefined);
  const installedWebManifest = JSON.parse(await readFile(join(directory, "node_modules", "@velarscript", "web", "package.json"), "utf8")) as {
    velar?: { extension?: { manifestKey?: string } };
  };
  assert.equal(installedWebManifest.velar?.extension?.manifestKey, "web");
  const version = await run(process.execPath, [installedCli, "--version"], directory);
  assert.equal(version.stdout, "velar 0.10.0-dev\n");
  const help = await run(process.execPath, [installedCli, "help", "build"], directory);
  assert.match(help.stdout, /Usage: velar build/u);
  assert.match(help.stdout, /isolated framework application output/u);

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

  const framework = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {VELAR_WEB_API_VERSION, VELAR_WEB_MODULES, velarWebFramework, webModuleSource} from '@velarscript/web'; if (VELAR_WEB_API_VERSION !== '0.10' || VELAR_WEB_MODULES.length !== 10 || velarWebFramework.name !== '@velarscript/web' || !webModuleSource('velar/web')?.includes('export function domId')) process.exit(1); console.log(velarWebFramework.modules.join(','))",
  ], directory);
  assert.match(framework.stdout, /velar\/app,velar\/config,velar\/web/u);
  const host = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION} from '@velarscript/compiler/framework-host'; import {velarFrameworkHost} from '@velarscript/web/host'; if (VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION !== 1 || velarFrameworkHost.protocolVersion !== 1 || velarFrameworkHost.capability !== 'web' || velarFrameworkHost.target !== 'browser') process.exit(1); console.log(velarFrameworkHost.id)",
  ], directory);
  assert.equal(host.stdout, "@velarscript/web\n");

  const docsProject = join(directory, "created-docs");
  const created = await run(process.execPath, [installedCreate, docsProject, "--template", "docs"], directory);
  assert.match(created.stdout, /Created VelarScript docs project/u);
  const docsManifest = JSON.parse(await readFile(join(docsProject, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(docsManifest.dependencies["@velarscript/web"], "0.10.0-dev");
  await run(process.execPath, [installedCli, "check", docsProject], directory);

  const componentProject = join(directory, "created-component");
  const componentCreated = await run(process.execPath, [installedCreate, componentProject, "--template", "component"], directory);
  assert.match(componentCreated.stdout, /Created VelarScript component project/u);
  const componentManifest = JSON.parse(await readFile(join(componentProject, "package.json"), "utf8")) as {
    files: string[];
    velar: { entry: string };
    peerDependencies: Record<string, string>;
  };
  assert.deepEqual(componentManifest.files, ["src/index.vel", "README.md"]);
  assert.equal(componentManifest.velar.entry, "src/index.vel");
  assert.equal(componentManifest.peerDependencies["@velarscript/web"], "0.10.0-dev");
  await run(process.execPath, [installedCli, "check", componentProject], directory);

  const localDependency = join(directory, "local-dependency");
  const managedProject = join(directory, "managed-project");
  await mkdir(join(managedProject, "src"), { recursive: true });
  await mkdir(localDependency);
  await writeFile(join(localDependency, "package.json"), `${JSON.stringify({ name: "local-dependency", version: "1.0.0" }, null, 2)}\n`, "utf8");
  await writeFile(join(managedProject, "package.json"), `${JSON.stringify({
    name: "managed-project",
    private: true,
    type: "module",
    dependencies: { "local-dependency": "file:../local-dependency" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(managedProject, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(managedProject, "src", "main.vel"), "export const value = 1\n", "utf8");
  const installedDependencies = await run(process.execPath, [installedCli, "install"], managedProject);
  assert.match(installedDependencies.stdout, /Installed and validated VelarScript project dependencies/u);
  assert.equal(JSON.parse(await readFile(join(managedProject, "node_modules", "local-dependency", "package.json"), "utf8")).name, "local-dependency");
  assert.equal(JSON.parse(await readFile(join(managedProject, "package-lock.json"), "utf8")).lockfileVersion, 3);
  process.stdout.write("VelarScript packed toolchain consumer acceptance passed\n");
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
