import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { velarPublishedWorkspacePackages } from "../scripts/velar-packages.mjs";
import { declaredEntryPaths, declaredImportSpecifiers, declaredJsonResourceImportSpecifiers, packageContentFailures, type PackedPackage } from "./package-contract.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "velar-packages-"));
const consumerDirectory = await mkdtemp(join(tmpdir(), "velar-zero-npm-consumer-"));

try {
  // D63 rule 159: pack every publishable toolchain package, source library, and
  // external adapter rather than a list here that has to be kept level with all
  // three workspace layers. A library or adapter joins consumer acceptance
  // without silently joining the version-locked toolchain release.
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
  const node = named("@velarscript/node");
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
  for (const file of ["ai-skill.md", "ai-skill-web.md", "ai-skill-node.md", "ai-skill-desktop.md"]) {
    assert.ok(cli.files.some((entry) => entry.path === `skill/${file}`), `CLI package is missing skill/${file}`);
  }
  assert.ok(compiler.files.some((file) => file.path === "dist/framework-host.js"));
  assert.ok(compiler.files.some((file) => file.path === "dist/application-package-host.js"));
  assert.ok(node.files.some((file) => file.path === "dist/compiler.js"));
  assert.ok(web.files.some((file) => file.path === "dist/host.js"));
  assert.ok(desktop.files.some((file) => file.path === "dist/compiler.js"));
  assert.ok(desktop.files.some((file) => file.path === "dist/host.js"));
  assert.ok(desktop.files.some((file) => file.path === "dist/package-host.js"));
  assert.ok(!desktop.files.some((file) => file.path === "dist/cli.js"));
  assert.ok(desktop.files.some((file) => file.path === "native/macos/VelarDesktopHost.swift"));
  assert.ok(desktop.files.some((file) => file.path === "native/macos/VelarTerminalHost.swift"));

  await writeFile(join(directory, "package.json"), "{}\n", "utf8");
  // The complete set, from the same derived roster that packed it. A tarball
  // list written out here stops matching `packages/*`, `libraries/*`, or
  // `adapters/*`.
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
  assert.equal(installedManifest.dependencies["@velarscript/compiler"], "0.11.1");
  assert.equal(installedManifest.dependencies["@velarscript/node"], "0.11.1");
  assert.equal(
    installedManifest.dependencies["@velarscript/script-analysis"],
    published.find((package_) => package_.name === "@velarscript/script-analysis")?.version,
  );
  assert.equal(installedManifest.dependencies["@velarscript/web"], "0.11.1");
  assert.equal(installedManifest.dependencies["@velarscript/desktop"], "0.11.1");
  assert.equal(installedManifest.dependencies["create-velar"], "0.11.1");
  for (const dependency of ["@velarscript/sqlite", "msgpackr", "fflate", "simplex-noise"]) {
    assert.equal(installedManifest.dependencies[dependency], undefined, `CLI must not hide external adapter dependency ${dependency}`);
  }
  assert.equal(installedManifest.peerDependencies?.["@velarscript/web"], undefined);
  const installedNodeManifest = JSON.parse(await readFile(join(directory, "node_modules", "@velarscript", "node", "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(installedNodeManifest.dependencies["@velarscript/compiler"], "0.11.1");
  assert.equal(installedNodeManifest.dependencies["@velarscript/sqlite"], undefined);
  const installedWebManifest = JSON.parse(await readFile(join(directory, "node_modules", "@velarscript", "web", "package.json"), "utf8")) as {
    velar?: { extension?: { kind?: string; apiVersion?: string; manifestKey?: string; extends?: Record<string, string> } };
  };
  assert.equal(installedWebManifest.velar?.extension?.manifestKey, "web");
  assert.equal(installedWebManifest.velar?.extension?.kind, "application");
  assert.equal(installedWebManifest.velar?.extension?.apiVersion, "0.10");
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
      "@velarscript/web": "0.10",
      "@velarscript/node": "0.10",
    },
  });
  for (const dependency of ["@velarscript/compiler", "@velarscript/node", "@velarscript/web"]) {
    assert.equal(installedDesktopManifest.dependencies[dependency], "0.11.1");
  }
  assert.equal(installedDesktopManifest.dependencies["@velarscript/cli"], undefined);
  assert.equal(installedDesktopManifest.dependencies.esbuild, undefined);
  const version = await run(process.execPath, [installedCli, "--version"], directory);
  assert.equal(version.stdout, "velar 0.11.1\n");
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
  for (const [owner, file] of [["web", "ai-skill-web.md"], ["node", "ai-skill-node.md"], ["desktop", "ai-skill-desktop.md"]] as const) {
    const selected = await run(process.execPath, [installedCli, "skill", owner], directory);
    assert.equal(selected.stdout, await readFile(join(root, "docs", file), "utf8"), `installed skill ${owner} drift`);
  }

  await writeFile(join(directory, "main.vel"), `
import {sum} from "velar/collections"
import {TextBuffer} from "@velarscript/text-buffer"
import {ScriptDocument, ScriptLanguage} from "@velarscript/script-analysis"

export const answer = sum(range(0, 7)) * 2
const buffer = TextBuffer("A😀\\nB")
buffer.insert(buffer.size, "!")
print(answer)
print(Text.utf8Size("A😀游戏"))
print(Text.chunks("A😀游戏", 2).join("|"))
print(f"{str(buffer.size)}:{buffer.lineText(1)}")
const scriptSource = "const answer = 42\\nprint(answer)\\n"
const script = ScriptDocument(ScriptLanguage.typescript, scriptSource)
const reference = (scriptSource.index("print(answer)") ?? 0) + "print(".size
print(f"{str(script.analysis().diagnostics.size)}:{str(script.referencesAt(reference).size)}")
`.trimStart(), "utf8");
  await run(process.execPath, [installedCli, "build", "main.vel", "--out-dir", "dist"], directory);
  assert.match(await readFile(join(directory, "dist", "main.js"), "utf8"), /from "velar\/collections"/u);
  assert.match(await readFile(join(directory, "dist", "node_modules", "velar", "collections.js"), "utf8"), /export function range/u);
  assert.match(await readFile(join(directory, "dist", "node_modules", "velar", "text.js"), "utf8"), /export function chunks/u);
  assert.match(await readFile(join(directory, "dist", "__velar_packages__", "@velarscript", "text-buffer", "src", "index.js"), "utf8"), /class TextBuffer/u);
  assert.match(await readFile(join(directory, "dist", "__velar_packages__", "@velarscript", "script-analysis", "src", "index.js"), "utf8"), /class ScriptDocument/u);
  const built = await run(process.execPath, [join(directory, "dist", "main.js")], directory);
  assert.equal(built.stdout, "42\n11\nA😀|游戏\n5:B!\n0:2\n");

  await writeFile(join(directory, "adapter.vel"), `
import {column, createModelStep, databaseSchema, filter, migration, model, select} from "@velarscript/database"
import {deflate, inflate} from "@velarscript/compression"
import {encode, parse} from "@velarscript/msgpack"
import {simplex2} from "@velarscript/noise"
import {open} from "@velarscript/sqlite"

type PackedUser:
    id: string
    name: string

const users = model("users", PackedUser, {
    id: column.text(primary=true),
    name: column.text(),
})

async def main():
    const wire = deflate(encode({id: "u1", name: "Ada"}))
    const user = parse(inflate(wire), PackedUser)
    using database = await open(":memory:", {queueCapacity: 8, maxRows: 8})
    await database.migrate(databaseSchema("packed", 1, [users.definition], [
        migration(1, [createModelStep(users)]),
    ]))
    await database.insert(users, user)
    const restored = await database.findOne(select(users, where=filter.equal(users, "id", "u1"), limit=1))
    if restored == null:
        throw Error("Packed SQLite adapter did not restore the row")
    const field = simplex2("packed")
    print(f"{restored.name}:{field(0, 0)}")

await main()
`.trimStart(), "utf8");
  await run(process.execPath, [installedCli, "build", "adapter.vel", "--out-dir", "adapter-dist"], directory);
  const adapterBuilt = await run(process.execPath, [join(directory, "adapter-dist", "adapter.js")], directory);
  assert.match(adapterBuilt.stdout, /^Ada:0(?:\.0+)?\n$/u);
  const packedSqliteOutput = join(directory, "adapter-dist", "__velar_packages__", "@velarscript", "sqlite", "src");
  const packedSqliteSource = (await Promise.all((await readdir(packedSqliteOutput))
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFile(join(packedSqliteOutput, name), "utf8")))).join("\n");
  assert.match(packedSqliteSource, /new Worker/u);

  // Anti-lock-in eject gate: the emitted build output is the whole program. It
  // must run standalone in a bare directory with only Node — no compiler, no
  // CLI, no @velarscript packages — so a project can take the readable
  // JavaScript and keep shipping without the Vel toolchain.
  const ejected = join(consumerDirectory, "ejected");
  await mkdir(join(ejected, "node_modules"), { recursive: true });
  await writeFile(join(ejected, "package.json"), `${JSON.stringify({ name: "ejected-app", private: true, type: "module" }, null, 2)}\n`, "utf8");
  await cp(join(directory, "dist", "main.js"), join(ejected, "main.js"));
  await cp(join(directory, "dist", "main.js.map"), join(ejected, "main.js.map"));
  await cp(join(directory, "dist", "node_modules", "velar"), join(ejected, "node_modules", "velar"), { recursive: true });
  await cp(join(directory, "dist", "__velar_packages__"), join(ejected, "__velar_packages__"), { recursive: true });
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
    "import {VELAR_NODE_API_VERSION,VELAR_NODE_MODULES,velarNodeRuntime} from '@velarscript/node'; import {nodeModuleSources,velarNodeCompilerExtension} from '@velarscript/node/compiler'; const fs=nodeModuleSources.get('velar/fs') ?? ''; const http=nodeModuleSources.get('velar/http') ?? ''; const serve=nodeModuleSources.get('velar/serve') ?? ''; if (VELAR_NODE_API_VERSION !== '0.10' || VELAR_NODE_MODULES.length !== 8 || velarNodeRuntime.name !== '@velarscript/node' || velarNodeCompilerExtension.id !== '@velarscript/node' || !fs.includes('export async function readText') || !fs.includes('export async function createText') || !fs.includes('export async function replaceTextIfMatches') || !fs.includes('export async function watchFiles') || !fs.includes('export const FileWatcher') || !fs.includes('__velarNodeHostInvoke(\"fs.createFile\"') || !fs.includes('__velarNodeHostInvoke(\"fs.replaceFileIfMatches\"') || !fs.includes('__velarNodeHostInvoke(\"fs.watchNext\"') || !http.includes('streamText') || !http.includes('__velarAssertJson') || !http.includes('__velarJsonStringify') || !http.includes('__velarNodeHostInvoke(\"http.request\"') || !http.includes('HttpTransportError') || !http.includes('HttpTransportPhase') || !http.includes('maxResponseChunks') || !serve.includes('parse: async (Type') || !serve.includes('ServeRequest.parse') || !nodeModuleSources.get('velar/terminal')?.includes('readLine')) process.exit(1); console.log(velarNodeRuntime.modules.join(','))",
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
    "import {VELAR_DESKTOP_API_VERSION,VELAR_DESKTOP_MODULES,velarDesktopFramework} from '@velarscript/desktop'; import {velarCompilerExtension} from '@velarscript/desktop/compiler'; import {velarFrameworkHost} from '@velarscript/desktop/host'; const desktop=velarCompilerExtension.modules?.sources.get('velar/desktop') ?? ''; const fs=velarCompilerExtension.modules?.sources.get('velar/fs') ?? ''; const http=velarCompilerExtension.modules?.sources.get('velar/http') ?? ''; if (VELAR_DESKTOP_API_VERSION !== '0.10' || !VELAR_DESKTOP_MODULES.includes('velar/desktop') || velarDesktopFramework.programmingModel !== 'single-project' || velarCompilerExtension.contract?.kind !== 'application' || velarFrameworkHost.id !== '@velarscript/desktop' || !desktop.includes('export async function startProjectTask') || !desktop.includes('ProjectTaskCommand') || !desktop.includes('ProjectTaskOutputChannel') || !desktop.includes('export async function projectChanges') || !desktop.includes('ProjectChangeLifecycle') || !desktop.includes('ProjectChangeRisk') || !desktop.includes('export async function openTerminal') || !desktop.includes('TerminalSession') || !fs.includes('export async function createText') || !fs.includes('export async function replaceTextIfMatches') || !fs.includes('export async function watchFiles') || !fs.includes('invoke(\"watchNext\", [this.handle], 0)') || !http.includes('__velarAssertJson') || !http.includes('__velarJsonStringify') || !http.includes('HTTP options fields must be enumerable data values') || !http.includes('HttpTransportError') || !http.includes('HttpTransportPhase') || !http.includes('responseOf') || !http.includes('maxResponseChunks')) process.exit(1); console.log(velarDesktopFramework.name)",
  ], directory);
  assert.equal(desktopApi.stdout, "@velarscript/desktop\n");

  if (process.platform === "darwin") {
    const desktopProject = join(consumerDirectory, "desktop-project");
    await mkdir(join(desktopProject, "src"), { recursive: true });
    await writeFile(join(desktopProject, "package.json"), JSON.stringify({ name: "packed-desktop", version: "0.1.0", private: true, type: "module" }), "utf8");
    await writeFile(join(desktopProject, "velar.json"), JSON.stringify({
      formatVersion: 2,
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
mount(<App />, "#app")
`.trimStart(), "utf8");
    await assert.rejects(readFile(join(desktopProject, "node_modules", "@velarscript", "desktop", "package.json"), "utf8"), /ENOENT/u);
    await run(process.execPath, [installedCli, "check", desktopProject], directory);
    await run(process.execPath, [installedCli, "package", desktopProject], directory);
    const builtDesktop = JSON.parse(await readFile(join(desktopProject, "dist", "desktop", "velar-desktop-build.json"), "utf8")) as {
      formatVersion: number;
      kind: string;
      applicationBundle: string;
      sizes: { languageServerBytes: number; projectTaskBytes: number; buildEngineBytes: number; terminalHostBytes: number; toolchainBytes: number; totalBytes: number };
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
    assert.equal(builtDesktop.formatVersion, 2);
    assert.equal(builtDesktop.kind, "velar-desktop-build");
    assert.ok(builtDesktop.sizes.totalBytes < builtDesktop.sizeBudgetBytes);
    assert.equal(builtDesktop.sizes.toolchainBytes,
      builtDesktop.sizes.languageServerBytes + builtDesktop.sizes.projectTaskBytes + builtDesktop.sizes.buildEngineBytes + builtDesktop.sizes.terminalHostBytes);
    assert.deepEqual(builtDesktop.runtime, {
      kind: "external-node",
      minimumMajor: 24,
      discovery: "environment-and-system-paths",
      embedded: false,
    });
    assert.equal(builtDesktop.runtime.version, undefined);
    assert.equal(builtDesktop.runtime.executableHint, undefined);
    const application = join(desktopProject, "dist", "desktop", builtDesktop.applicationBundle);
    const information = await readFile(join(application, "Contents", "Info.plist"), "utf8");
    assert.match(information, /<key>CFBundleIconFile<\/key><string>VelarScript<\/string>/u);
    const applicationIcon = await readFile(join(application, "Contents", "Resources", "VelarScript.icns"));
    assert.equal(applicationIcon.subarray(0, 4).toString("ascii"), "icns");
    const hostConfigurationText = await readFile(join(application, "Contents", "Resources", "desktop.json"), "utf8");
    const hostConfiguration = JSON.parse(hostConfigurationText) as Record<string, unknown>;
    assert.deepEqual(hostConfiguration.languageServer, { path: "host/language-server.js" });
    assert.deepEqual(hostConfiguration.projectTask, { path: "host/project-task.js", buildEnginePath: "host/build-engine" });
    const packagedLanguageServer = join(application, "Contents", "Resources", "host", "language-server.js");
    const packagedTerminalHost = join(application, "Contents", "Resources", "host", "terminal-host");
    assert.ok((await readFile(packagedLanguageServer)).byteLength > 1024 * 1024);
    assert.ok((await readFile(packagedTerminalHost)).byteLength > 32 * 1024);
    assert.ok((await readFile(join(application, "Contents", "Resources", "host", "project-task.js"))).byteLength > 1024 * 1024);
    assert.equal(JSON.parse(await readFile(join(application, "Contents", "Resources", "host", "playwright-core", "package.json"), "utf8")).name, "playwright-core");
    assert.ok(JSON.parse(await readFile(join(application, "Contents", "Resources", "host", "playwright-core", "browsers.json"), "utf8")).browsers.length >= 3);
    assert.ok((await readFile(join(application, "Contents", "Resources", "host", "build-engine"))).byteLength > 5 * 1024 * 1024);
    await probeLanguageServer(packagedLanguageServer, desktopProject);
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
  assert.equal(docsManifest.dependencies["@velarscript/web"], "^0.11.1");
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
  assert.equal(componentManifest.peerDependencies["@velarscript/web"], "^0.11.1");
  await run(process.execPath, [installedCli, "check", componentProject], directory);

  const nodeProject = join(directory, "created-node");
  const nodeCreated = await run(process.execPath, [installedCreate, nodeProject, "--template", "node"], directory);
  assert.match(nodeCreated.stdout, /Created VelarScript node project/u);
  const nodeManifest = JSON.parse(await readFile(join(nodeProject, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(nodeManifest.dependencies["@velarscript/node"], "^0.11.1");
  assert.deepEqual(JSON.parse(await readFile(join(nodeProject, "velar.json"), "utf8")).extensions, ["@velarscript/node"]);
  assert.match(await readFile(join(nodeProject, "src", "app.vel"), "utf8"), /@get\(p"\/api\/hello"\)/u);
  assert.match(await readFile(join(nodeProject, "public", "index.html"), "utf8"), /velarscript-mark\.svg/u);
  await run(process.execPath, [installedCli, "check", nodeProject], directory);

  const createdDesktopProject = join(directory, "created-desktop");
  const desktopCreated = await run(process.execPath, [installedCreate, createdDesktopProject, "--template", "desktop"], directory);
  assert.match(desktopCreated.stdout, /Created VelarScript desktop project/u);
  const createdDesktopManifest = JSON.parse(await readFile(join(createdDesktopProject, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(createdDesktopManifest.dependencies["@velarscript/desktop"], "^0.11.1");
  assert.match(await readFile(join(createdDesktopProject, "public", "velarscript-mark.svg"), "utf8"), /<path d=/u);
  await run(process.execPath, [installedCli, "check", createdDesktopProject], directory);

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
  await Promise.all([
    rm(directory, { recursive: true, force: true }),
    rm(consumerDirectory, { recursive: true, force: true }),
  ]);
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

async function probeLanguageServer(entry: string, cwd: string): Promise<void> {
  const child = spawn(process.execPath, [entry], { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0);
  let stderr = "";
  const messages: Array<Record<string, unknown>> = [];
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const boundary = buffer.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const match = /Content-Length:\s*(\d+)/iu.exec(buffer.subarray(0, boundary).toString("ascii"));
      if (!match) return;
      const size = Number(match[1]);
      const end = boundary + 4 + size;
      if (buffer.byteLength < end) return;
      messages.push(JSON.parse(buffer.subarray(boundary + 4, end).toString("utf8")) as Record<string, unknown>);
      buffer = buffer.subarray(end);
    }
  });
  const send = (message: unknown): void => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const waitForId = async (id: number): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const message = messages.find((candidate) => candidate.id === id);
      if (message) return message;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    throw new Error(`Installed language server did not respond to ${id}: ${stderr}`);
  };
  const waitForDiagnostics = async (uri: string): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const message = messages.find((candidate) => candidate.method === "textDocument/publishDiagnostics"
        && (candidate.params as { uri?: string } | undefined)?.uri === uri);
      if (message) return message;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    throw new Error(`Installed language server did not publish script diagnostics: ${stderr}`);
  };
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const initialized = await waitForId(1);
    assert.equal((initialized.result as { serverInfo: { name: string } }).serverInfo.name, "VelarScript Language Server");
    assert.equal((initialized.result as { capabilities: { experimental: { velar: { scriptImplementation: string } } } }).capabilities.experimental.velar.scriptImplementation, "velarscript");
    send({ jsonrpc: "2.0", method: "initialized", params: {} });
    const uri = pathToFileURL(join(cwd, "packed-probe.ts")).href;
    const text = "interface User { name: string }\nconst user: User = { name: 'Ada' }\nconst name = user.name\n";
    send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "typescript", version: 1, text } } });
    const diagnostics = await waitForDiagnostics(uri);
    assert.deepEqual((diagnostics.params as { diagnostics: unknown[] }).diagnostics, []);
    send({ jsonrpc: "2.0", id: 2, method: "textDocument/definition", params: { textDocument: { uri }, position: { line: 2, character: 14 } } });
    const definition = await waitForId(2);
    assert.equal((definition.result as { range: { start: { line: number } } }).range.start.line, 1);
    send({ jsonrpc: "2.0", id: 3, method: "textDocument/semanticTokens/full", params: { textDocument: { uri } } });
    const semantic = await waitForId(3);
    assert.ok((semantic.result as { data: number[] }).data.length > 0);
    send({ jsonrpc: "2.0", id: 4, method: "textDocument/formatting", params: { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } } });
    assert.deepEqual((await waitForId(4)).result, []);
    send({ jsonrpc: "2.0", id: 5, method: "shutdown", params: null });
    await waitForId(5);
    send({ jsonrpc: "2.0", method: "exit", params: null });
    child.stdin.end();
    const code = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => rejectExit(new Error("Installed language server did not exit within 5 seconds")), 5_000);
      child.once("error", (error) => { clearTimeout(timer); rejectExit(error); });
      child.once("exit", (exitCode) => { clearTimeout(timer); resolveExit(exitCode); });
    });
    assert.equal(code, 0, stderr);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
