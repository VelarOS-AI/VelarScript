import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { velarPublishedWorkspacePackages } from "../scripts/velar-packages.mjs";
import { parseNpmPackResult } from "../scripts/npm-pack-result.mjs";
import { declaredEntryPaths, declaredImportSpecifiers, declaredJsonResourceImportSpecifiers, packageContentFailures, type PackedPackage } from "./package-contract.ts";
import { DESKTOP_NODE_RUNTIME_ARCHIVES, DESKTOP_NODE_RUNTIME_VERSION } from "../packages/desktop/src/config.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "velar-packages-"));
const consumerDirectory = await mkdtemp(join(tmpdir(), "velar-zero-npm-consumer-"));

try {
  // Pack every publishable package under packages/. Application libraries,
  // concrete adapters, and provider integrations are intentionally absent.
  //
  // A-024: the roster was derived and then immediately re-spelled by hand for
  // everything that came after `pack()`. The content checks walked six of the
  // eight names, the install listed all eight as literal tarball paths, and a
  // package that had neither LICENSE, README, `dist`, nor the file its own
  // `exports` pointed at sailed through both while a real consumer importing it
  // failed with ERR_MODULE_NOT_FOUND. Everything below walks `published`.
  const published = await velarPublishedWorkspacePackages(root);
  const packed = new Map<string, PackedPackage>();
  for (const package_ of published) packed.set(package_.name, await pack(package_.name));
  const named = (name: string) => {
    const entry = packed.get(name);
    assert.ok(entry, `the workspace no longer publishes ${name}; this gate assumed it does`);
    return entry;
  };
  const compiler = named("@velarscript/compiler");
  const core = named("@velarscript/core");
  const node = named("@velarscript/node");
  const server = named("@velarscript/server");
  const web = named("@velarscript/web");
  const create = named("create-velar");
  const cli = named("@velarscript/cli");
  const desktop = named("@velarscript/desktop");
  // What every published package must contain, asked of each manifest rather
  // than of a list: its licence, its README, and every file it points a
  // consumer at through `main`, `types`, `exports`, `bin` or `velar.entry`.
  const contentFailures = published.flatMap((package_) => packageContentFailures(package_.manifest, named(package_.name)));
  assert.deepEqual(contentFailures, [], `packed packages do not contain what their manifests promise:\n${contentFailures.join("\n")}`);
  // The compiled packages additionally publish types beside their JavaScript.
  // Derived the same way: a package that promises a `.d.ts` anywhere in its
  // manifest is one that must ship types.
  for (const package_ of published) {
    if (!declaredEntryPaths(package_.manifest).some((path) => path.endsWith(".d.ts"))) continue;
    assert.ok(named(package_.name).files.some((file) => file.path.endsWith(".d.ts")), `${package_.name} promises types and packs none`);
  }
  assert.ok(cli.files.some((file) => file.path === "dist/browser-test-runner.js"));
  assert.ok(cli.files.some((file) => file.path === "dist/production-verifier.js"));
  assert.ok(cli.files.some((file) => file.path === "dist/preview-server.js"));
  assert.ok(cli.files.some((file) => file.path === "dist/deployment-verifier.js"));
  assert.ok(!cli.files.some((file) => file.path.startsWith("stdlib/")));
  for (const file of ["ai-skill.md", "ai-skill-web.md", "ai-skill-node.md", "ai-skill-server.md", "ai-skill-desktop.md"]) {
    assert.ok(cli.files.some((entry) => entry.path === `skill/${file}`), `CLI package is missing skill/${file}`);
  }
  assert.ok(compiler.files.some((file) => file.path === "dist/framework-host.js"));
  assert.ok(core.files.some((file) => file.path === "dist/index.js"));
  assert.ok(compiler.files.some((file) => file.path === "dist/application-package-host.js"));
  assert.ok(node.files.some((file) => file.path === "dist/compiler.js"));
  assert.ok(server.files.some((file) => file.path === "dist/compiler.js"));
  assert.ok(web.files.some((file) => file.path === "dist/host.js"));
  assert.ok(desktop.files.some((file) => file.path === "dist/compiler.js"));
  assert.ok(desktop.files.some((file) => file.path === "dist/host.js"));
  assert.ok(desktop.files.some((file) => file.path === "dist/package-host.js"));
  assert.ok(!desktop.files.some((file) => file.path === "dist/cli.js"));
  assert.ok(desktop.files.some((file) => file.path === "native/macos/VelarDesktopHost.swift"));
  assert.ok(!desktop.files.some((file) => file.path === "native/macos/VelarTerminalHost.swift"));

  await writeFile(join(directory, "package.json"), "{}\n", "utf8");
  // The complete set comes from the same derived roster that packed it.
  await runNpm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...published.map((package_) => join(directory, named(package_.name).filename)),
  ], directory);

  // What the installed set actually offers a consumer, asked of the manifests:
  // every file each one points at must be on disk, and every specifier each one
  // publishes must import. A package whose `exports` names a file that was
  // never built installs without complaint and fails at the first `import`,
  // which is exactly the release-day failure this gate exists to prevent.
  for (const package_ of published) {
    for (const path of declaredEntryPaths(package_.manifest)) {
      if (path.includes("*")) continue;
      await readFile(join(directory, "node_modules", ...package_.name.split("/"), path));
    }
  }
  const specifiers = published.flatMap((package_) => declaredImportSpecifiers(package_.manifest));
  assert.ok(specifiers.length >= published.length, `the installed set publishes only ${specifiers.length} import specifiers`);
  await run(process.execPath, [
    "--input-type=module",
    "--eval",
    `${specifiers.map((specifier) => `await import(${JSON.stringify(specifier)});`).join("\n")}\nconsole.log("resolved");`,
  ], directory);
  const resourceSpecifiers = published.flatMap((package_) => declaredJsonResourceImportSpecifiers(package_.manifest));
  if (resourceSpecifiers.length > 0) {
    await run(process.execPath, [
      "--input-type=module",
      "--eval",
      `${resourceSpecifiers.map((specifier) => `await import(${JSON.stringify(specifier)}, { with: { type: "json" } });`).join("\n")}\nconsole.log("resolved resources");`,
    ], directory);
  }

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
  assert.equal(installedManifest.dependencies["@velarscript/compiler"], "0.23.0");
  assert.equal(installedManifest.dependencies["@velarscript/core"], "0.23.0");
  assert.equal(installedManifest.dependencies["@velarscript/node"], "0.23.0");
  assert.equal(installedManifest.dependencies["@velarscript/server"], "0.23.0");
  assert.equal(installedManifest.dependencies["@velarscript/web"], "0.23.0");
  assert.equal(installedManifest.dependencies["@velarscript/desktop"], "0.23.0");
  assert.equal(installedManifest.dependencies["create-velar"], "0.23.0");
  for (const dependency of [
    "@velarscript/database",
    "@velarscript/sqlite",
    "@velarscript/msgpack",
    "@velarscript/compression",
    "@velarscript/noise",
    "@velarscript/netlify",
    "@velarscript/script-analysis",
    "@velarscript/text-buffer",
    "@velarscript-labs/compression",
    "@velarscript-labs/database",
    "@velarscript-labs/editor-kit",
    "@velarscript-labs/msgpack",
    "@velarscript-labs/noise",
    "@velarscript-labs/sqlite",
    "@velarscript-labs/text-buffer",
    "@velarscript-labs/yaml",
  ]) {
    assert.equal(installedManifest.dependencies[dependency], undefined, `CLI must not own application package ${dependency}`);
  }
  assert.equal(installedManifest.peerDependencies?.["@velarscript/web"], undefined);
  const installedNodeManifest = JSON.parse(await readFile(join(directory, "node_modules", "@velarscript", "node", "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(installedNodeManifest.dependencies["@velarscript/compiler"], "0.23.0");
  assert.equal(installedNodeManifest.dependencies["@velarscript/sqlite"], undefined);
  assert.equal(installedNodeManifest.dependencies["@velarscript-labs/sqlite"], undefined);
  assert.equal(installedNodeManifest.dependencies.yaml, undefined);
  const installedServerManifest = JSON.parse(await readFile(join(directory, "node_modules", "@velarscript", "server", "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    velar: {extension: {kind: string; apiVersion: string; manifestKey: string; extends?: Record<string, string>; composes: Record<string, string>}};
  };
  assert.deepEqual(installedServerManifest.velar.extension, {
    kind: "application",
    apiVersion: "0.15",
    manifestKey: "server",
    composes: {"@velarscript/node": "0.15"},
  });
  assert.equal(installedServerManifest.dependencies["@velarscript/compiler"], "0.23.0");
  assert.equal(installedServerManifest.dependencies["@velarscript/node"], "0.23.0");
  assert.equal(installedServerManifest.dependencies.yaml, "^2.9.0");
  const installedWebManifest = JSON.parse(await readFile(join(directory, "node_modules", "@velarscript", "web", "package.json"), "utf8")) as {
    velar?: { extension?: { kind?: string; apiVersion?: string; manifestKey?: string; extends?: Record<string, string> } };
  };
  assert.equal(installedWebManifest.velar?.extension?.manifestKey, "web");
  assert.equal(installedWebManifest.velar?.extension?.kind, "application");
  assert.equal(installedWebManifest.velar?.extension?.apiVersion, "0.11");
  assert.deepEqual(installedWebManifest.velar?.extension?.extends, {});
  const installedDesktopManifest = JSON.parse(await readFile(join(directory, "node_modules", "@velarscript", "desktop", "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    velar: {
      extension: {
        kind: string;
        apiVersion: string;
        manifestKey: string;
        extends: Record<string, string>;
        composes: Record<string, string>;
      };
    };
  };
  assert.deepEqual(installedDesktopManifest.velar.extension, {
    kind: "application",
    apiVersion: "0.10",
    manifestKey: "desktop",
    extends: {},
    composes: {
      "@velarscript/web": "0.11",
      "@velarscript/node": "0.15",
    },
  });
  for (const dependency of ["@velarscript/compiler", "@velarscript/node", "@velarscript/web"]) {
    assert.equal(installedDesktopManifest.dependencies[dependency], "0.23.0");
  }
  assert.equal(installedDesktopManifest.dependencies["@velarscript/cli"], undefined);
  assert.equal(installedDesktopManifest.dependencies.esbuild, undefined);
  const version = await run(process.execPath, [installedCli, "--version"], directory);
  assert.equal(version.stdout, "velar 0.23.0\n");
  const help = await run(process.execPath, [installedCli, "help", "build"], directory);
  assert.match(help.stdout, /Usage: velar build/u);
  assert.match(help.stdout, /standalone Node application/u);
  const packageHelp = await run(process.execPath, [installedCli, "help", "package"], directory);
  assert.match(packageHelp.stdout, /target-owned native packaging host/u);
  const installedSkill = await run(process.execPath, [installedCli, "skill"], directory);
  assert.equal(
    installedSkill.stdout,
    await readFile(join(root, "docs", "ai-skill.md"), "utf8"),
    "the installed 'velar skill' must print docs/ai-skill.md verbatim",
  );
  for (const [owner, file] of [["web", "ai-skill-web.md"], ["node", "ai-skill-node.md"], ["server", "ai-skill-server.md"], ["desktop", "ai-skill-desktop.md"]] as const) {
    const selected = await run(process.execPath, [installedCli, "skill", owner], directory);
    assert.equal(selected.stdout, await readFile(join(root, "docs", file), "utf8"), `installed skill ${owner} drift`);
  }

  const helperRoot = join(directory, "node_modules", "consumer-helper");
  await mkdir(join(helperRoot, "src"), { recursive: true });
  await writeFile(join(helperRoot, "package.json"), JSON.stringify({
    name: "consumer-helper",
    version: "1.0.0",
    velar: { entry: "src/index.vel", targets: ["core", "node", "web", "desktop"], requires: { capabilities: [] } },
  }), "utf8");
  await writeFile(join(helperRoot, "src", "index.vel"), "export def double(value: number) -> number:\n    return value * 2\n", "utf8");

  await writeFile(join(directory, "main.vel"), `
import {sum} from "velar/collections"
import {double} from "consumer-helper"

export const answer = double(sum(range(0, 7)))
print(answer)
print(Text.utf8Size("A😀游戏"))
print(Text.chunks("A😀游戏", 2).join("|"))
`.trimStart(), "utf8");
  await run(process.execPath, [installedCli, "build", "main.vel", "--out-dir", "dist"], directory);
  const productionCode = await readFile(join(directory, "dist", "main.js"), "utf8");
  assert.match(productionCode, /from\s*["']velar\/collections["']/u);
  assert.doesNotMatch(productionCode, /export const answer/u, "an installed CLI must default to production JavaScript");
  const built = await run(process.execPath, [join(directory, "dist", "main.js")], directory);
  assert.equal(built.stdout, "42\n11\nA😀|游戏\n");

  // 逃生出口必须由用户显式选择：它保留稳定、可读的声明名称，同时仍然是
  // 可以直接执行和独立搬走的完整 JavaScript 程序。
  await run(process.execPath, [installedCli, "build", "main.vel", "--out-dir", "dist-readable", "--mode", "readable", "--source-maps"], directory);
  assert.match(await readFile(join(directory, "dist-readable", "main.js"), "utf8"), /from "velar\/collections"/u);
  assert.match(await readFile(join(directory, "dist-readable", "node_modules", "velar", "collections.js"), "utf8"), /export function range/u);
  assert.match(await readFile(join(directory, "dist-readable", "node_modules", "velar", "text.js"), "utf8"), /export function chunks/u);
  assert.match(await readFile(join(directory, "dist-readable", "__velar_packages__", "consumer-helper", "src", "index.js"), "utf8"), /function double/u);

  // Anti-lock-in eject gate: the emitted build output is the whole program. It
  // must run standalone in a bare directory with only Node — no compiler, no
  // CLI, no @velarscript packages — so a project can take the readable
  // JavaScript and keep shipping without the Vel toolchain.
  const ejected = join(consumerDirectory, "ejected");
  await mkdir(join(ejected, "node_modules"), { recursive: true });
  await writeFile(join(ejected, "package.json"), `${JSON.stringify({ name: "ejected-app", private: true, type: "module" }, null, 2)}\n`, "utf8");
  await cp(join(directory, "dist-readable", "main.js"), join(ejected, "main.js"));
  await cp(join(directory, "dist-readable", "main.js.map"), join(ejected, "main.js.map"));
  await cp(join(directory, "dist-readable", "node_modules", "velar"), join(ejected, "node_modules", "velar"), { recursive: true });
  await cp(join(directory, "dist-readable", "__velar_packages__"), join(ejected, "__velar_packages__"), { recursive: true });
  const ejectedCode = await readFile(join(ejected, "main.js"), "utf8");
  assert.match(ejectedCode, /\/\/# sourceMappingURL=main\.js\.map/u, "emitted output must stay source-mapped after ejecting");
  assert.doesNotMatch(ejectedCode, /from ["']@velarscript\//u, "emitted output must not import the Vel toolchain");
  assert.deepEqual(await readdir(join(ejected, "node_modules")), ["velar"],
    "the ejected directory may contain only the generated readable runtime, never toolchain packages");
  const ejectedRun = await run(process.execPath, [join(ejected, "main.js")], ejected);
  assert.equal(ejectedRun.stdout, built.stdout, "ejected output must run identically without the Vel toolchain");
  process.stdout.write("VelarScript anti-lock-in eject acceptance passed: built output ran standalone without the Vel toolchain\n");

  const api = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {compile} from '@velarscript/compiler'; const result=compile('const value = 1\\n'); if (result.diagnostics.length || !result.code) process.exit(1); console.log(result.code.trim())",
  ], directory);
  assert.equal(api.stdout, "const value = 1;\n");

  const nodeRuntime = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {VELAR_NODE_API_VERSION,VELAR_NODE_MODULES,velarNodeRuntime} from '@velarscript/node'; import {nodeModuleSources,velarNodeCompilerExtension} from '@velarscript/node/compiler'; const fs=nodeModuleSources.get('velar/fs') ?? ''; const hash=nodeModuleSources.get('velar/hash') ?? ''; const http=nodeModuleSources.get('velar/http') ?? ''; const serve=nodeModuleSources.get('velar/serve') ?? ''; const websocket=nodeModuleSources.get('velar/websocket') ?? ''; if (VELAR_NODE_API_VERSION !== '0.15' || VELAR_NODE_MODULES.length !== 12 || velarNodeRuntime.name !== '@velarscript/node' || velarNodeCompilerExtension.id !== '@velarscript/node' || !fs.includes('export async function readText') || !fs.includes('export async function createText') || !fs.includes('export async function replaceTextIfMatches') || !fs.includes('export async function watchFiles') || !fs.includes('export const FileWatcher') || !fs.includes('__velarNodeHostInvoke(\"fs.createFile\"') || !fs.includes('__velarNodeHostInvoke(\"fs.replaceFileIfMatches\"') || !fs.includes('__velarNodeHostInvoke(\"fs.watchNext\"') || !hash.includes('export function sha256Text') || !http.includes('streamText') || !http.includes('__velarAssertJson') || !http.includes('__velarJsonStringify') || !http.includes('__velarNodeHostInvoke(\"http.request\"') || !http.includes('HttpTransportError') || !http.includes('HttpTransportPhase') || !http.includes('maxResponseChunks') || !serve.includes('parse: async (Type') || !serve.includes('ServeRequest.parse') || !serve.includes('export async function run') || !websocket.includes('export async function listen') || !websocket.includes('export async function run') || !websocket.includes('closeInfo()') || !nodeModuleSources.get('velar/server-test')?.includes('export async function client') || !nodeModuleSources.get('velar/terminal')?.includes('readLine')) process.exit(1); console.log(velarNodeRuntime.modules.join(','))",
  ], directory);
  assert.equal(nodeRuntime.stdout, "velar/server-test,velar/serve,velar/fs,velar/hash,velar/env,velar/host,velar/terminal,velar/path,velar/process,velar/http,velar/worker,velar/websocket\n");

  const serverRuntime = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {VELAR_SERVER_API_VERSION,VELAR_SERVER_MODULES,velarServerFramework} from '@velarscript/server'; import {serverModuleSources,velarCompilerExtension} from '@velarscript/server/compiler'; const configured=velarCompilerExtension.modules?.source?.('velar/server', {configuration:'config/server.yml'}) ?? ''; const server=serverModuleSources.get('velar/server') ?? ''; const realtime=serverModuleSources.get('velar/realtime') ?? ''; if (VELAR_SERVER_API_VERSION !== '0.15' || VELAR_SERVER_MODULES.length !== 2 || velarServerFramework.name !== '@velarscript/server' || velarCompilerExtension.contract?.kind !== 'application' || velarCompilerExtension.contract?.composes?.['@velarscript/node'] !== '0.15' || !configured.includes('applicationConfigurationPath = \"config/server.yml\"') || !server.includes('applicationConfigurationPath = \"\"') || server.includes('applicationConfigurationPath = \"application.yml\"') || !server.includes('export async function application') || !server.includes('export function authenticate') || !server.includes('export function database') || server.includes('export async function realtimeSession') || !realtime.includes('export async function realtimeSession')) process.exit(1); console.log(VELAR_SERVER_MODULES.join(','))",
  ], directory);
  assert.equal(serverRuntime.stdout, "velar/server,velar/realtime\n");

  const framework = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {VELAR_WEB_API_VERSION, VELAR_WEB_MODULES, velarWebFramework, webModuleSource} from '@velarscript/web'; if (VELAR_WEB_API_VERSION !== '0.11' || VELAR_WEB_MODULES.length !== 12 || velarWebFramework.name !== '@velarscript/web' || !webModuleSource('velar/web')?.includes('export function domId') || !webModuleSource('velar/look')?.includes('export function rgb') || !webModuleSource('velar/websocket')?.includes('export function connect') || !webModuleSource('velar/realtime')?.includes('export function realtimeClient')) process.exit(1); console.log(velarWebFramework.modules.join(','))",
  ], directory);
  assert.match(framework.stdout, /velar\/app,velar\/config,velar\/web/u);
  const host = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION} from '@velarscript/compiler/framework-host'; import {velarFrameworkHost} from '@velarscript/web/host'; if (VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION !== 3 || velarFrameworkHost.protocolVersion !== 3 || velarFrameworkHost.capability !== 'web' || velarFrameworkHost.target !== 'browser') process.exit(1); console.log(velarFrameworkHost.id)",
  ], directory);
  assert.equal(host.stdout, "@velarscript/web\n");
  const desktopApi = await run(process.execPath, [
    "--input-type=module",
    "--eval",
    "import {VELAR_DESKTOP_API_VERSION,VELAR_DESKTOP_MODULES,velarDesktopFramework} from '@velarscript/desktop'; import {velarCompilerExtension} from '@velarscript/desktop/compiler'; import {velarFrameworkHost} from '@velarscript/desktop/host'; const desktop=velarCompilerExtension.modules?.sources.get('velar/desktop') ?? ''; const fs=velarCompilerExtension.modules?.sources.get('velar/fs') ?? ''; const http=velarCompilerExtension.modules?.sources.get('velar/http') ?? ''; const retired=/startProjectTask|ProjectTaskCommand|ProjectTaskOutputChannel|projectChanges|ProjectChangeLifecycle|ProjectChangeRisk|openTerminal|TerminalSession|languageServer/; if (VELAR_DESKTOP_API_VERSION !== '0.10' || !VELAR_DESKTOP_MODULES.includes('velar/desktop') || velarDesktopFramework.programmingModel !== 'single-project' || velarCompilerExtension.contract?.kind !== 'application' || velarFrameworkHost.id !== '@velarscript/desktop' || retired.test(desktop) || !desktop.includes('export async function selectProjectDirectory') || !fs.includes('export async function createText') || !fs.includes('export async function replaceTextIfMatches') || !fs.includes('export async function watchFiles') || !fs.includes('invoke(\"watchNext\", [this.handle], 0)') || !http.includes('__velarAssertJson') || !http.includes('__velarJsonStringify') || !http.includes('HTTP options fields must be enumerable data values') || !http.includes('HttpTransportError') || !http.includes('HttpTransportPhase') || !http.includes('responseOf') || !http.includes('maxResponseChunks')) process.exit(1); console.log(velarDesktopFramework.name)",
  ], directory);
  assert.equal(desktopApi.stdout, "@velarscript/desktop\n");

  if (process.platform === "darwin") {
    const desktopProject = join(consumerDirectory, "desktop-project");
    await mkdir(join(desktopProject, "src"), { recursive: true });
    await writeFile(join(desktopProject, "package.json"), JSON.stringify({ name: "packed-desktop", version: "0.1.0", private: true, type: "module" }), "utf8");
    await writeFile(join(desktopProject, "velar.json"), JSON.stringify({
      formatVersion: 2,
      kind: "application",
      entry: "src/main.vel",
      outDir: "dist/renderer",
      publicDir: "public",
      extensions: ["@velarscript/desktop"],
      desktop: { productName: "Packed Desktop", identifier: "dev.velarscript.packed", build: {sizeBudgetBytes: 32 * 1024 * 1024} },
    }), "utf8");
    await writeFile(join(desktopProject, "src", "main.vel"), `
import {platform} from "velar/desktop"
component App:
    return <main>{platform()}</main>

@main: mount(<App />, "#app")
`.trimStart(), "utf8");
    await assert.rejects(readFile(join(desktopProject, "node_modules", "@velarscript", "desktop", "package.json"), "utf8"), /ENOENT/u);
    await run(process.execPath, [installedCli, "check", desktopProject], directory);
    await run(process.execPath, [installedCli, "package", desktopProject], directory);
    const builtDesktop = JSON.parse(await readFile(join(desktopProject, "dist", "desktop", "velar-desktop-build.json"), "utf8")) as {
      formatVersion: number;
      kind: string;
      applicationBundle: string;
      sizes: {
        hostBytes: number;
        rendererBytes: number;
        capabilityHostBytes: number;
        metadataBytes: number;
        applicationBytes: number;
        runtimeBytes: number;
        totalBytes: number;
      };
      sizeBudgetBytes: number;
      signing: { mode: string; hardenedRuntime: boolean; notarized: boolean };
      runtime: { kind: string; version: string; embedded: boolean; bytes: number; sha256: string };
    };
    assert.equal(builtDesktop.formatVersion, 4);
    assert.equal(builtDesktop.kind, "velar-desktop-build");
    // The budget is the application's; the interpreter it carries is measured
    // separately and dwarfs it.
    assert.ok(builtDesktop.sizes.applicationBytes < builtDesktop.sizeBudgetBytes);
    assert.ok(builtDesktop.sizes.runtimeBytes > builtDesktop.sizes.applicationBytes * 10);
    assert.ok(builtDesktop.sizes.metadataBytes > 0);
    assert.deepEqual(builtDesktop.runtime, {
      kind: "embedded-node",
      version: DESKTOP_NODE_RUNTIME_VERSION,
      embedded: true,
      bytes: builtDesktop.sizes.runtimeBytes,
      sha256: DESKTOP_NODE_RUNTIME_ARCHIVES[`${process.platform}-${process.arch}`]!.sha256,
    });
    assert.deepEqual(builtDesktop.signing, { mode: "ad-hoc", hardenedRuntime: true, notarized: false });
    const application = join(desktopProject, "dist", "desktop", builtDesktop.applicationBundle);
    const information = await readFile(join(application, "Contents", "Info.plist"), "utf8");
    assert.match(information, /<key>CFBundleIconFile<\/key><string>VelarScript<\/string>/u);
    const applicationIcon = await readFile(join(application, "Contents", "Resources", "VelarScript.icns"));
    assert.equal(applicationIcon.subarray(0, 4).toString("ascii"), "icns");
    const hostConfigurationText = await readFile(join(application, "Contents", "Resources", "desktop.json"), "utf8");
    const hostConfiguration = JSON.parse(hostConfigurationText) as Record<string, unknown>;
    assert.equal(hostConfiguration.languageServer, undefined);
    assert.equal(hostConfiguration.projectTask, undefined);
    assert.equal(hostConfiguration.terminalHost, undefined);
    assert.deepEqual((await readdir(join(application, "Contents", "Resources", "host"))).sort(), ["worker.js"]);
    assert.equal(hostConfiguration.nodeExecutableHint, undefined);
    assert.ok(!hostConfigurationText.includes(process.execPath));
    const verification = await run(join(application, "Contents", "MacOS", "VelarDesktopHost"), ["--verify-bundle"], desktopProject, {
      ...process.env,
      VELAR_DESKTOP_NODE: process.execPath,
      VELAR_DESKTOP_PROJECT_ROOT: desktopProject,
    });
    assert.deepEqual(JSON.parse(verification.stdout), {
      kind: "velar-desktop-bundle-verification",
      protocolVersion: 1,
      identifier: "dev.velarscript.packed",
      // The template declares the one window kind every manifest declares, and
      // the packaged host reports the kinds it will actually open.
      windowKinds: ["main"],
      services: [],
    });
    // The packaging acceptance, from a packed consumer that never saw this
    // checkout. This project grants no filesystem scope at all, so the round
    // trip that proves the interpreter works comes back as the refusal the
    // worker computed — which only a running interpreter could have computed.
    const accepted = await run(join(application, "Contents", "MacOS", "VelarDesktopHost"), ["--headless-smoke"], desktopProject, {
      ...process.env,
      VELAR_DESKTOP_PROJECT_ROOT: desktopProject,
    });
    const { runtime, ...report } = JSON.parse(accepted.stdout) as { runtime: string };
    assert.deepEqual(report, {
      kind: "velar-desktop-headless-smoke",
      protocolVersion: 1,
      identifier: "dev.velarscript.packed",
      runtimeSource: "bundled",
      capability: "fs.list",
      fileScope: false,
      windowKinds: ["main"],
      services: [],
    }, accepted.stdout);
    assert.equal(runtime.endsWith("/Contents/MacOS/node"), true, runtime);
  }

  const docsProject = join(directory, "created-docs");
  const created = await run(process.execPath, [installedCreate, docsProject, "--template", "docs"], directory);
  assert.match(created.stdout, /Created VelarScript docs project/u);
  const docsManifest = JSON.parse(await readFile(join(docsProject, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(docsManifest.dependencies["@velarscript/web"], "0.23.0");
  await run(process.execPath, [installedCli, "check", docsProject], directory);

  const componentProject = join(directory, "created-component");
  const componentCreated = await run(process.execPath, [installedCreate, componentProject, "--template", "component"], directory);
  assert.match(componentCreated.stdout, /Created VelarScript component project/u);
  const componentManifest = JSON.parse(await readFile(join(componentProject, "package.json"), "utf8")) as {
    files: string[];
    velar: { entry: string; targets: string[]; requires: { capabilities: string[] } };
    peerDependencies: Record<string, string>;
  };
  assert.deepEqual(componentManifest.files, ["src/index.vel", "README.md"]);
  assert.equal(componentManifest.velar.entry, "src/index.vel");
  assert.deepEqual(componentManifest.velar.targets, ["web", "desktop"]);
  assert.deepEqual(componentManifest.velar.requires.capabilities, []);
  assert.equal(componentManifest.peerDependencies["@velarscript/web"], "^0.23.0");
  await run(process.execPath, [installedCli, "check", componentProject], directory);

  const nodeProject = join(directory, "created-node");
  const nodeCreated = await run(process.execPath, [installedCreate, nodeProject, "--template", "node"], directory);
  assert.match(nodeCreated.stdout, /Created VelarScript node project/u);
  const nodeManifest = JSON.parse(await readFile(join(nodeProject, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(nodeManifest.dependencies["@velarscript/server"], "0.23.0");
  assert.equal(nodeManifest.dependencies["@velarscript/node"], undefined);
  const nodeVelarManifest = JSON.parse(await readFile(join(nodeProject, "velar.json"), "utf8"));
  assert.deepEqual(nodeVelarManifest.extensions, ["@velarscript/server"]);
  assert.equal(nodeVelarManifest.server?.configuration, "application.yml");
  assert.match(await readFile(join(nodeProject, "application.yml"), "utf8"), /port: 3000/u);
  assert.match(await readFile(join(nodeProject, "src", "app.vel"), "utf8"), /@get\(p"\/api\/hello"\)/u);
  assert.match(await readFile(join(nodeProject, "src", "main.vel"), "utf8"), /@main:/u);
  assert.match(await readFile(join(nodeProject, "public", "index.html"), "utf8"), /velarscript-mark\.svg/u);
  await run(process.execPath, [installedCli, "check", nodeProject], directory);

  const createdDesktopProject = join(directory, "created-desktop");
  const desktopCreated = await run(process.execPath, [installedCreate, createdDesktopProject, "--template", "desktop"], directory);
  assert.match(desktopCreated.stdout, /Created VelarScript desktop project/u);
  const createdDesktopManifest = JSON.parse(await readFile(join(createdDesktopProject, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(createdDesktopManifest.dependencies["@velarscript/desktop"], "0.23.0");
  assert.match(await readFile(join(createdDesktopProject, "public", "velarscript-mark.svg"), "utf8"), /<path d=/u);
  await run(process.execPath, [installedCli, "check", createdDesktopProject], directory);

  const localDependency = join(directory, "local-dependency");
  const managedProject = join(directory, "managed-project");
  await mkdir(join(managedProject, "src"), { recursive: true });
  await mkdir(join(localDependency, "src"), { recursive: true });
  await writeFile(join(localDependency, "package.json"), `${JSON.stringify({
    name: "local-dependency",
    version: "1.0.0",
    velar: { entry: "src/index.vel", targets: ["core", "node", "web", "desktop"], requires: { capabilities: [] } },
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
  await Promise.all([
    rm(directory, { recursive: true, force: true }),
    rm(consumerDirectory, { recursive: true, force: true }),
  ]);
}

async function pack(workspace: string): Promise<PackedPackage> {
  const result = await runNpm(["pack", "--ignore-scripts", "--workspace", workspace, "--pack-destination", directory, "--json"], root);
  return parseNpmPackResult(result.stdout, workspace) as PackedPackage;
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
