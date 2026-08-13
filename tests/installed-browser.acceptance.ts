import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "velar-installed-browser-"));

try {
  const compiler = await pack("@velarscript/compiler");
  const node = await pack("@velarscript/node");
  const web = await pack("@velarscript/web");
  const create = await pack("create-velar");
  const cli = await pack("@velarscript/cli");
  const desktop = await pack("@velarscript/desktop");
  const textBuffer = await pack("@velarscript/text-buffer");
  const scriptAnalysis = await pack("@velarscript/script-analysis");
  await writeFile(join(directory, "package.json"), "{}\n", "utf8");
  await runNpm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(directory, compiler),
    join(directory, node),
    join(directory, web),
    join(directory, create),
    join(directory, cli),
    join(directory, desktop),
    join(directory, textBuffer),
    join(directory, scriptAnalysis),
  ], directory);
  const installedCli = join(directory, "node_modules", "@velarscript", "cli", "dist", "cli.js");
  const application = join(directory, "Team & App");
  await run(process.execPath, [installedCli, "create", application], directory);
  await runNpm([
    "install",
    "--save-dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(directory, compiler),
    join(directory, node),
    join(directory, web),
    join(directory, create),
    join(directory, cli),
    join(directory, desktop),
    join(directory, textBuffer),
    join(directory, scriptAnalysis),
  ], application);
  await writeFile(join(application, "src", "web-contract.vel"), `
import {onError} from "velar/app"
import {environment} from "velar/browser"
import {has} from "velar/config"
import {readText} from "velar/files"
import {errors} from "velar/forms"
import {http} from "velar/http"
import {socket} from "velar/realtime"
import {session} from "velar/storage"
import {currentRoute} from "velar/web"

export const installedWebModules = [
    onError,
    environment,
    has,
    readText,
    errors,
    http,
    socket,
    session,
    currentRoute,
].size
`.trimStart(), "utf8");
  await writeFile(join(application, "src", "main.vel"), `
import {App} from "./app.vel"
import {installedWebModules} from "./web-contract.vel"

assert installedWebModules == 9 else "The installed Web package must expose all application modules"
mount(<App />, "#app")
`.trimStart(), "utf8");
  const manifest = JSON.parse(await readFile(join(application, "package.json"), "utf8")) as { scripts: Record<string, string> };
  for (const script of ["format:check", "check", "test", "build", "verify", "test:browser"]) assert.ok(manifest.scripts[script], `missing generated script ${script}`);
  await runNpm(["run", "format:check"], application);
  await runNpm(["run", "check"], application);
  const core = await runNpm(["test"], application);
  assert.match(core.stdout, /app\.test\.vel :: application contract/u);
  await runNpm(["run", "build"], application);
  const verification = await runNpm(["run", "verify"], application);
  assert.match(verification.stdout, /Verified production web build [a-f0-9]{64}/u);
  const result = await runNpm(["run", "test:browser", "--", "chromium"], application);
  assert.match(result.stdout, /chromium :: src\/app\.browser\.test\.vel :: home page/u);
  assert.match(result.stdout, /1 passed, 0 failed/u);

  const documentation = join(directory, "Product Docs");
  await run(process.execPath, [installedCli, "create", documentation, "--template", "docs"], directory);
  await runNpm([
    "install",
    "--save-dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(directory, compiler),
    join(directory, node),
    join(directory, web),
    join(directory, create),
    join(directory, cli),
    join(directory, desktop),
    join(directory, textBuffer),
    join(directory, scriptAnalysis),
  ], documentation);
  await runNpm(["run", "format:check"], documentation);
  await runNpm(["run", "check"], documentation);
  await runNpm(["test"], documentation);
  await runNpm(["run", "build"], documentation);
  await runNpm(["run", "verify"], documentation);
  const docsBrowser = await runNpm(["run", "test:browser", "--", "chromium"], documentation);
  assert.match(docsBrowser.stdout, /chromium :: src\/app\.browser\.test\.vel :: guide route/u);
  assert.match(docsBrowser.stdout, /1 passed, 0 failed/u);

  const component = join(directory, "Info Card");
  await run(process.execPath, [installedCli, "create", component, "--template", "component"], directory);
  await runNpm([
    "install",
    "--save-dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(directory, compiler),
    join(directory, node),
    join(directory, web),
    join(directory, create),
    join(directory, cli),
    join(directory, desktop),
    join(directory, textBuffer),
    join(directory, scriptAnalysis),
  ], component);
  const componentManifest = JSON.parse(await readFile(join(component, "package.json"), "utf8")) as {
    files: string[];
    velar: { entry: string };
    peerDependencies: Record<string, string>;
  };
  assert.deepEqual(componentManifest.files, ["src/index.vel", "README.md"]);
  assert.equal(componentManifest.velar.entry, "src/index.vel");
  assert.equal(componentManifest.peerDependencies["@velarscript/web"], "^0.10.0");
  await runNpm(["run", "format:check"], component);
  await runNpm(["run", "check"], component);
  await runNpm(["test"], component);
  await runNpm(["run", "build"], component);
  await runNpm(["run", "verify"], component);
  const componentBrowser = await runNpm(["run", "test:browser", "--", "chromium"], component);
  assert.match(componentBrowser.stdout, /chromium :: src\/demo\.browser\.test\.vel :: component preview/u);
  assert.match(componentBrowser.stdout, /1 passed, 0 failed/u);
  process.stdout.write("Installed VelarScript browser-project acceptance passed\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function pack(workspace: string): Promise<string> {
  const result = await runNpm(["pack", "--workspace", workspace, "--pack-destination", directory, "--json"], root);
  const values = JSON.parse(result.stdout) as Array<{ filename: string }>;
  assert.equal(values.length, 1);
  return values[0]!.filename;
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
  const code = await new Promise<number | null>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", resolvePromise);
  });
  if (code !== 0) throw new Error(`${command} ${arguments_.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
  return { stdout, stderr };
}
