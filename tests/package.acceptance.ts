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
  const node = await pack("@velarscript/node");
  const web = await pack("@velarscript/web");
  const create = await pack("create-velar");
  const cli = await pack("@velarscript/cli");
  const desktop = await pack("@velarscript/desktop");
  for (const package_ of [compiler, node, web, create, cli, desktop]) {
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
  assert.ok(node.files.some((file) => file.path === "dist/compiler.js"));
  assert.ok(web.files.some((file) => file.path === "dist/host.js"));
  assert.ok(desktop.files.some((file) => file.path === "dist/compiler.js"));
  assert.ok(desktop.files.some((file) => file.path === "dist/host.js"));
  assert.ok(desktop.files.some((file) => file.path === "dist/cli.js"));
  assert.ok(desktop.files.some((file) => file.path === "native/macos/VelarDesktopHost.swift"));

  await writeFile(join(directory, "package.json"), "{}\n", "utf8");
  await runNpm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    join(directory, compiler.filename),
    join(directory, node.filename),
    join(directory, web.filename),
    join(directory, create.filename),
    join(directory, cli.filename),
    join(directory, desktop.filename),
  ], directory);

  const installedCli = join(directory, "node_modules", "@velarscript", "cli", "dist", "cli.js");
  const installedCreate = join(directory, "node_modules", "create-velar", "dist", "cli.js");
  const installedDesktopCli = join(directory, "node_modules", "@velarscript", "desktop", "dist", "cli.js");
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
  assert.equal(installedManifest.dependencies["@velarscript/compiler"], "0.10.0");
  assert.equal(installedManifest.dependencies["@velarscript/node"], "0.10.0");
  assert.equal(installedManifest.dependencies["create-velar"], "0.10.0");
  assert.equal(installedManifest.peerDependencies?.["@velarscript/web"], undefined);
  assert.equal(installedManifest.dependencies["@velarscript/web"], undefined);
  const installedNodeManifest = JSON.parse(await readFile(join(directory, "node_modules", "@velarscript", "node", "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(installedNodeManifest.dependencies["@velarscript/compiler"], "0.10.0");
  const installedWebManifest = JSON.parse(await readFile(join(directory, "node_modules", "@velarscript", "web", "package.json"), "utf8")) as {
    velar?: { extension?: { kind?: string; apiVersion?: string; manifestKey?: string; extends?: Record<string, string> } };
  };
  assert.equal(installedWebManifest.velar?.extension?.manifestKey, "web");
  assert.equal(installedWebManifest.velar?.extension?.kind, "application");
  assert.equal(installedWebManifest.velar?.extension?.apiVersion, "0.10");
  assert.deepEqual(installedWebManifest.velar?.extension?.extends, {});
  const installedDesktopManifest = JSON.parse(await readFile(join(directory, "node_modules", "@velarscript", "desktop", "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    velar: { extension: { kind: string; apiVersion: string; manifestKey: string; extends: Record<string, string> } };
  };
  assert.deepEqual(installedDesktopManifest.velar.extension, {
    kind: "application",
    apiVersion: "0.10",
    manifestKey: "desktop",
    extends: {},
  });
  for (const dependency of ["@velarscript/compiler", "@velarscript/node", "@velarscript/web", "@velarscript/cli"]) {
    assert.equal(installedDesktopManifest.dependencies[dependency], "0.10.0");
  }
  assert.equal(installedDesktopManifest.dependencies.esbuild, undefined);
  const version = await run(process.execPath, [installedCli, "--version"], directory);
  assert.equal(version.stdout, "velar 0.10.0\n");
  const help = await run(process.execPath, [installedCli, "help", "build"], directory);
  assert.match(help.stdout, /Usage: velar build/u);
  assert.match(help.stdout, /isolated framework application output/u);

  await writeFile(join(directory, "main.vel"), `
import {range, sum} from "velar/collections"
import {utf8Size} from "velar/text"

export const answer = sum(range(0, 7)) * 2
print(answer)
print(utf8Size("A😀游戏"))
`.trimStart(), "utf8");
  await run(process.execPath, [installedCli, "build", "main.vel", "--out", "main.js"], directory);
  assert.match(await readFile(join(directory, "main.js"), "utf8"), /from "velar\/collections"/u);
  assert.match(await readFile(join(directory, "node_modules", "velar", "collections.js"), "utf8"), /export function range/u);
  assert.match(await readFile(join(directory, "node_modules", "velar", "text.js"), "utf8"), /export function utf8Size/u);
  const built = await run(process.execPath, [join(directory, "main.js")], directory);
  assert.equal(built.stdout, "42\n11\n");

  const api = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {compile} from '@velarscript/compiler'; const result=compile('const value = 1\\n'); if (result.diagnostics.length || !result.code) process.exit(1); console.log(result.code.trim())",
  ], directory);
  assert.equal(api.stdout, "const value = 1;\n");

  const nodeRuntime = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {VELAR_NODE_API_VERSION,VELAR_NODE_MODULES,velarNodeRuntime} from '@velarscript/node'; import {nodeModuleSources,velarNodeCompilerExtension} from '@velarscript/node/compiler'; const fs=nodeModuleSources.get('velar/fs') ?? ''; const http=nodeModuleSources.get('velar/http') ?? ''; const serve=nodeModuleSources.get('velar/serve') ?? ''; if (VELAR_NODE_API_VERSION !== '0.10' || VELAR_NODE_MODULES.length !== 8 || velarNodeRuntime.name !== '@velarscript/node' || velarNodeCompilerExtension.id !== '@velarscript/node' || !fs.includes('export async function readText') || !fs.includes('export async function createText') || !fs.includes('export async function replaceTextIfMatches') || !fs.includes('__velarNodeHostInvoke(\"fs.createFile\"') || !fs.includes('__velarNodeHostInvoke(\"fs.replaceFileIfMatches\"') || !http.includes('streamText') || !http.includes('__velarAssertJson') || !http.includes('__velarJsonStringify') || !http.includes('__velarNodeHostInvoke(\"http.request\"') || !http.includes('HttpTransportError') || !http.includes('HttpTransportPhase') || !http.includes('maxResponseChunks') || !serve.includes('parse: async (Type') || !serve.includes('ServeRequest.parse') || !nodeModuleSources.get('velar/terminal')?.includes('readLine')) process.exit(1); console.log(velarNodeRuntime.modules.join(','))",
  ], directory);
  assert.equal(nodeRuntime.stdout, "velar/serve,velar/fs,velar/env,velar/host,velar/terminal,velar/path,velar/process,velar/http\n");

  const framework = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {VELAR_WEB_API_VERSION, VELAR_WEB_MODULES, velarWebFramework, webModuleSource} from '@velarscript/web'; if (VELAR_WEB_API_VERSION !== '0.10' || VELAR_WEB_MODULES.length !== 11 || velarWebFramework.name !== '@velarscript/web' || !webModuleSource('velar/web')?.includes('export function domId') || !webModuleSource('velar/look')?.includes('export function rgb')) process.exit(1); console.log(velarWebFramework.modules.join(','))",
  ], directory);
  assert.match(framework.stdout, /velar\/app,velar\/config,velar\/web/u);
  const host = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION} from '@velarscript/compiler/framework-host'; import {velarFrameworkHost} from '@velarscript/web/host'; if (VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION !== 1 || velarFrameworkHost.protocolVersion !== 1 || velarFrameworkHost.capability !== 'web' || velarFrameworkHost.target !== 'browser') process.exit(1); console.log(velarFrameworkHost.id)",
  ], directory);
  assert.equal(host.stdout, "@velarscript/web\n");
  const desktopApi = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {VELAR_DESKTOP_API_VERSION,VELAR_DESKTOP_MODULES,velarDesktopFramework} from '@velarscript/desktop'; import {velarCompilerExtension} from '@velarscript/desktop/compiler'; import {velarFrameworkHost} from '@velarscript/desktop/host'; const fs=velarCompilerExtension.modules?.sources.get('velar/fs') ?? ''; const http=velarCompilerExtension.modules?.sources.get('velar/http') ?? ''; if (VELAR_DESKTOP_API_VERSION !== '0.10' || !VELAR_DESKTOP_MODULES.includes('velar/desktop') || velarDesktopFramework.programmingModel !== 'single-project' || velarCompilerExtension.contract?.kind !== 'application' || velarFrameworkHost.id !== '@velarscript/desktop' || !fs.includes('export async function createText') || !fs.includes('export async function replaceTextIfMatches') || !http.includes('__velarAssertJson') || !http.includes('__velarJsonStringify') || !http.includes('HTTP options fields must be enumerable data values') || !http.includes('HttpTransportError') || !http.includes('HttpTransportPhase') || !http.includes('responseOf') || !http.includes('maxResponseChunks')) process.exit(1); console.log(velarDesktopFramework.name)",
  ], directory);
  assert.equal(desktopApi.stdout, "@velarscript/desktop\n");

  if (process.platform === "darwin") {
    const desktopProject = join(directory, "desktop-project");
    await mkdir(join(desktopProject, "src"), { recursive: true });
    await writeFile(join(desktopProject, "package.json"), JSON.stringify({ name: "packed-desktop", version: "0.1.0", private: true, type: "module" }), "utf8");
    await writeFile(join(desktopProject, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist/renderer",
      publicDir: "public",
      extensions: ["@velarscript/desktop"],
      desktop: { productName: "Packed Desktop", identifier: "dev.velarscript.packed" },
    }), "utf8");
    await writeFile(join(desktopProject, "src", "main.vel"), `
import {platform} from "velar/desktop"
component App:
    return <main>{platform()}</main>
mount(<App />, "#app")
`.trimStart(), "utf8");
    await run(process.execPath, [installedCli, "check", desktopProject], directory);
    await run(process.execPath, [installedDesktopCli, "build", desktopProject], directory);
    const builtDesktop = JSON.parse(await readFile(join(desktopProject, "dist", "desktop", "velar-desktop-build.json"), "utf8")) as {
      kind: string;
      applicationBundle: string;
      sizes: { totalBytes: number };
      sizeBudgetBytes: number;
      runtime: {
        kind: string;
        minimumMajor: number;
        discovery: string;
        embedded: boolean;
        version?: unknown;
        executableHint?: unknown;
      };
    };
    assert.equal(builtDesktop.kind, "velar-desktop-build");
    assert.ok(builtDesktop.sizes.totalBytes < builtDesktop.sizeBudgetBytes);
    assert.deepEqual(builtDesktop.runtime, {
      kind: "external-node",
      minimumMajor: 24,
      discovery: "environment-and-system-paths",
      embedded: false,
    });
    assert.equal(builtDesktop.runtime.version, undefined);
    assert.equal(builtDesktop.runtime.executableHint, undefined);
    const application = join(desktopProject, "dist", "desktop", builtDesktop.applicationBundle);
    const hostConfigurationText = await readFile(join(application, "Contents", "Resources", "desktop.json"), "utf8");
    const hostConfiguration = JSON.parse(hostConfigurationText) as Record<string, unknown>;
    assert.equal(hostConfiguration.nodeExecutableHint, undefined);
    assert.ok(!hostConfigurationText.includes(process.execPath));
    const smoke = await run(join(application, "Contents", "MacOS", "VelarDesktopHost"), ["--smoke"], desktopProject, {
      ...process.env,
      VELAR_DESKTOP_NODE: process.execPath,
      VELAR_DESKTOP_PROJECT_ROOT: desktopProject,
    });
    assert.deepEqual(JSON.parse(smoke.stdout), {
      kind: "velar-desktop-smoke",
      protocolVersion: 1,
      identifier: "dev.velarscript.packed",
    });
  }

  const docsProject = join(directory, "created-docs");
  const created = await run(process.execPath, [installedCreate, docsProject, "--template", "docs"], directory);
  assert.match(created.stdout, /Created VelarScript docs project/u);
  const docsManifest = JSON.parse(await readFile(join(docsProject, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(docsManifest.dependencies["@velarscript/web"], "^0.10.0");
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
  assert.equal(componentManifest.peerDependencies["@velarscript/web"], "^0.10.0");
  await run(process.execPath, [installedCli, "check", componentProject], directory);

  const localDependency = join(directory, "local-dependency");
  const managedProject = join(directory, "managed-project");
  await mkdir(join(managedProject, "src"), { recursive: true });
  await mkdir(join(localDependency, "src"), { recursive: true });
  await writeFile(join(localDependency, "package.json"), `${JSON.stringify({
    name: "local-dependency",
    version: "1.0.0",
    velar: { entry: "src/index.vel" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(localDependency, "src", "index.vel"), `
export def decode<T>(value: unknown, target: Type<T>) -> T:
    return target.parse(value)

export enum EventKind:
    text = "response.output_text.delta"
    tool = "response.output_item.done"

export type TextEvent:
    kind: EventKind.text
    text: string

export type ToolEvent:
    kind: EventKind.tool
    toolId: string

export type Event = TextEvent | ToolEvent

export def decodeEvent(value: unknown) -> Event:
    return Event.parse(value)

export type Property:
    type: string
    description: string

export type Properties = Record<Property>

export def decodeProperties(value: unknown) -> Properties:
    return Properties.parse(value)
`.trimStart(), "utf8");
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
  await writeFile(join(managedProject, "src", "main.vel"), `
import {Event, EventKind, Properties, decode, decodeEvent, decodeProperties} from "local-dependency"

type User:
    name: string

export const user: User = decode({name: "Ada"}, User)

def describe(event: Event) -> string:
    if event.kind == EventKind.text:
        return event.text
    return event.toolId

print(describe(decodeEvent({kind: "response.output_item.done", toolId: "fs:read"})))
const properties: Properties = {path: {type: "string", description: "Relative path"}}
properties["limit"] = {type: "integer", description: "Result limit"}
print(properties["path"]?.description ?? "missing")
print(decodeProperties({query: {type: "string", description: "Search query"}})["query"]?.type ?? "missing")

export def decodeInstalledProperties(value: unknown) -> Properties:
    return decodeProperties(value)
`.trimStart(), "utf8");
  const installedDependencies = await run(process.execPath, [installedCli, "install"], managedProject);
  assert.match(installedDependencies.stdout, /Installed and validated VelarScript project dependencies/u);
  assert.equal(JSON.parse(await readFile(join(managedProject, "node_modules", "local-dependency", "package.json"), "utf8")).name, "local-dependency");
  assert.equal(JSON.parse(await readFile(join(managedProject, "package-lock.json"), "utf8")).lockfileVersion, 3);
  await run(process.execPath, [installedCli, "check", managedProject], directory);
  await run(process.execPath, [installedCli, "build", managedProject], directory);
  const managed = await run(process.execPath, [join(managedProject, "dist", "main.js")], managedProject);
  assert.equal(managed.stdout, "fs:read\nRelative path\nstring\n");
  const installedRecordProbe = join(managedProject, "dist", "record-probe.mjs");
  await writeFile(installedRecordProbe, `
import { decodeInstalledProperties } from "./main.js";
for (const value of [
  Object.freeze({ path: { type: "string", description: "path" } }),
  Object.seal({ path: { type: "string", description: "path" } }),
  Object.defineProperty({}, "path", { value: { type: "string", description: "path" }, enumerable: true, configurable: true, writable: false }),
]) {
  let rejected = false;
  try { decodeInstalledProperties(value); } catch { rejected = true; }
  if (!rejected) throw new Error("Installed Type<Record<T>> accepted a non-mutable host record");
}
`, "utf8");
  await run(process.execPath, [installedRecordProbe], managedProject);
  process.stdout.write("VelarScript packed toolchain consumer acceptance passed\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}

interface PackedPackage {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

async function pack(workspace: string): Promise<PackedPackage> {
  const result = await runNpm(["pack", "--ignore-scripts", "--workspace", workspace, "--pack-destination", directory, "--json"], root);
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

async function run(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(command, arguments_, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
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
