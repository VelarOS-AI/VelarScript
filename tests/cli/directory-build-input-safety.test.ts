import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { hasBuildOutputReceipt } from "../../packages/cli/src/build-output-directory.ts";
import { repositoryRoot } from "../support/repository-root.ts";
import { linkVelarExtension } from "../support/web-project.ts";

const cli = join(repositoryRoot, "packages", "cli", "src", "cli.ts");

async function temporaryProject(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

function build(root: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [cli, "build"], { cwd: root, encoding: "utf8", timeout: 300_000 });
}

function buildWith(root: string, cliPath: string, ...arguments_: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [cliPath, "build", ...arguments_], { cwd: root, encoding: "utf8", timeout: 300_000 });
}

test("a directory build cannot replace a compiler extension package it loaded", async () => {
  const root = await temporaryProject("velar-extension-output-boundary-");
  const extensionRoot = join(root, "node_modules", "fixture-extension");
  const manifest = `${JSON.stringify({
    name: "fixture-extension",
    version: "1.0.0",
    type: "module",
    exports: { "./compiler": "./compiler.js" },
    velar: { extension: { kind: "language", apiVersion: "1.0", extends: {} } },
  }, null, 2)}\n`;
  const compiler = [
    "export const velarCompilerExtension = Object.freeze({",
    '  id: "fixture-extension",',
    '  contract: Object.freeze({protocolVersion: 1, apiVersion: "1.0", kind: "language", extends: Object.freeze({})}),',
    "  capabilities: Object.freeze([]),",
    "})",
    "",
  ].join("\n");
  try {
    await writeTree(root, {
      "main.vel": 'print("safe")\n',
      "velar.json": `${JSON.stringify({
        formatVersion: 2,
        entry: "main.vel",
        outDir: "node_modules/fixture-extension",
        extensions: ["fixture-extension"],
      }, null, 2)}\n`,
      "node_modules/fixture-extension/package.json": manifest,
      "node_modules/fixture-extension/compiler.js": compiler,
    });

    const rejected = build(root);
    assert.equal(rejected.status, 1, String(rejected.stdout) + String(rejected.stderr));
    assert.match(String(rejected.stderr), /refusing to replace .*fixture-extension.*contains checked input .*fixture-extension/u);
    assert.equal(await readFile(join(extensionRoot, "package.json"), "utf8"), manifest);
    assert.equal(await readFile(join(extensionRoot, "compiler.js"), "utf8"), compiler);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a directory build preserves the actual esbuild and framework runtime package inputs byte-for-byte", async () => {
  const root = await temporaryProject("velar-toolchain-package-output-boundary-");
  try {
    const isolatedCli = await installIsolatedBuildToolchain(root, "hoisted");
    await writeTree(root, {
      "src/main.vel": [
        'import {applicationConfigurationPath} from "velar/server"',
        'import {listen} from "velar/websocket"',
        "",
        "@main:",
        "    print(applicationConfigurationPath)",
        "    print(listen)",
        "",
      ].join("\n"),
      "application.yml": "server:\n  host: 127.0.0.1\n  port: 3000\n  maxBodyBytes: 16777216\n",
    });

    for (const packageName of ["esbuild", "yaml"] as const) {
      const manifest = `${JSON.stringify({
        formatVersion: 2,
        kind: "application",
        entry: "src/main.vel",
        outDir: `node_modules/${packageName}`,
        extensions: ["@velarscript/server"],
        server: { configuration: "application.yml" },
      }, null, 2)}\n`;
      await writeFile(join(root, "velar.json"), manifest, "utf8");
      const packageRoot = join(root, "node_modules", packageName);
      const before = await snapshotTree(packageRoot);

      const rejected = buildWith(root, isolatedCli);
      assert.equal(rejected.status, 1, String(rejected.stdout) + String(rejected.stderr));
      assert.match(
        String(rejected.stderr),
        new RegExp(`refusing to replace .*node_modules/${packageName}.*contains checked input .*node_modules/${packageName}`, "u"),
      );
      assert.deepEqual(await snapshotTree(packageRoot), before, `${packageName} must remain byte-for-byte unchanged`);
      assert.equal(
        (await readdir(join(root, "node_modules"))).some((name) => name.startsWith(`.${packageName}.velar-`)),
        false,
        "the input boundary must reject before a build staging directory exists",
      );
    }

    await writeFile(join(root, "velar.json"), `${JSON.stringify({
      formatVersion: 2,
      kind: "application",
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/server"],
      server: { configuration: "application.yml" },
    }, null, 2)}\n`, "utf8");
    const esbuildRoot = join(root, "node_modules", "esbuild");
    const beforeStandalone = await snapshotTree(esbuildRoot);
    const refusedStandalone = buildWith(root, isolatedCli, "src/main.vel", "--out", "node_modules/esbuild/lib/main.js");
    assert.equal(refusedStandalone.status, 1, String(refusedStandalone.stdout) + String(refusedStandalone.stderr));
    assert.match(
      String(refusedStandalone.stderr),
      /refusing to write .*node_modules\/esbuild\/lib\/main\.js.*checked toolchain dependency 'esbuild'/u,
    );
    assert.deepEqual(await snapshotTree(esbuildRoot), beforeStandalone, "standalone output must not replace its loaded bundler");
    assert.equal(
      (await readdir(join(esbuildRoot, "lib"))).some((name) => name.startsWith(".velar-main.js-")),
      false,
      "standalone input rejection must happen before staging",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime packages resolve from their declaring owners in an isolated dependency layout", async () => {
  const root = await temporaryProject("velar-isolated-runtime-dependencies-");
  try {
    const isolatedCli = await installIsolatedBuildToolchain(root, "nested");
    await writeTree(root, {
      "src/main.vel": [
        'import {applicationConfigurationPath} from "velar/server"',
        'import {listen} from "velar/websocket"',
        "",
        "@main:",
        "    print(applicationConfigurationPath)",
        "    print(listen)",
        "",
      ].join("\n"),
      "application.yml": "server:\n  host: 127.0.0.1\n  port: 3000\n  maxBodyBytes: 16777216\n",
      "velar.json": `${JSON.stringify({
        formatVersion: 2,
        kind: "application",
        entry: "src/main.vel",
        outDir: "dist",
        extensions: ["@velarscript/server"],
        server: { configuration: "application.yml" },
      }, null, 2)}\n`,
    });

    const built = buildWith(root, isolatedCli);
    assert.equal(built.status, 0, String(built.stdout) + String(built.stderr));
    for (const packageName of ["ws", "yaml"] as const) {
      const source = join(root, "node_modules", "@velarscript", packageName === "ws" ? "node" : "server", "node_modules", packageName);
      assert.deepEqual(
        await snapshotTree(join(root, "dist", "node_modules", "velar", "node_modules", packageName)),
        await snapshotTree(source),
        `${packageName} must be copied from the package that declares it`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a Web build cannot replace a transitive JavaScript package discovered by the bundler", async () => {
  const root = await temporaryProject("velar-web-transitive-output-boundary-");
  const leafRoot = join(root, "node_modules", "leaf-package");
  const leafManifest = `${JSON.stringify({
    name: "leaf-package",
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
  }, null, 2)}\n`;
  const leafModule = 'export const label = "preserved"\n';
  try {
    await linkVelarExtension(root, "web");
    await writeTree(root, {
      "src/main.vel": [
        'extern module "bridge-package":',
        "    export const label: string",
        'import js {label} from "bridge-package"',
        "component App:",
        "    return <main>{label}</main>",
        '@main: mount(<App />, "#app")',
        "",
      ].join("\n"),
      "velar.json": `${JSON.stringify({
        formatVersion: 2,
        entry: "src/main.vel",
        outDir: "node_modules/leaf-package",
        extensions: ["@velarscript/web"],
        web: { title: "Input boundary" },
      }, null, 2)}\n`,
      "node_modules/bridge-package/package.json": `${JSON.stringify({
        name: "bridge-package",
        version: "1.0.0",
        type: "module",
        exports: "./index.js",
      }, null, 2)}\n`,
      "node_modules/bridge-package/index.js": 'export {label} from "leaf-package"\n',
      "node_modules/leaf-package/package.json": leafManifest,
      "node_modules/leaf-package/index.js": leafModule,
    });

    const rejected = build(root);
    assert.equal(rejected.status, 1, String(rejected.stdout) + String(rejected.stderr));
    assert.match(String(rejected.stderr), /refusing to replace .*leaf-package.*contains checked input .*leaf-package/u);
    assert.equal(await readFile(join(leafRoot, "package.json"), "utf8"), leafManifest);
    assert.equal(await readFile(join(leafRoot, "index.js"), "utf8"), leafModule);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a package.json resource remains importable beside the generated runtime package manifest", async () => {
  const root = await temporaryProject("velar-resource-manifest-claim-");
  const packageManifest = `${JSON.stringify({
    name: "fixture-resource",
    version: "1.0.0",
    type: "module",
    exports: { "./metadata": "./package.json" },
    velar: {
      entry: "src/index.vel",
      targets: ["core", "node"],
      requires: { capabilities: [] },
      resources: { "./metadata": { path: "package.json", type: "json" } },
    },
  }, null, 2)}\n`;
  try {
    await writeTree(root, {
      "main.vel": 'print("baseline")\n',
      "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist" }, null, 2)}\n`,
      "node_modules/fixture-resource/package.json": packageManifest,
      "node_modules/fixture-resource/src/index.vel": "export const ready = true\n",
    });
    await writeFile(join(root, "main.vel"), [
      'import json metadata from "fixture-resource/metadata"',
      "type Metadata:",
      "    readonly name: string",
      "",
      "print(Metadata.parse(metadata).name)",
      "",
    ].join("\n"), "utf8");
    const built = build(root);
    assert.equal(built.status, 0, String(built.stdout) + String(built.stderr));
    assert.equal(await readFile(join(root, "node_modules", "fixture-resource", "package.json"), "utf8"), packageManifest);
    const output = join(root, "dist");
    const snapshot = join(output, "node_modules", "fixture-resource", "package.json.velar-resource");
    assert.equal(await readFile(snapshot, "utf8"), packageManifest);
    assert.equal(
      JSON.parse(await readFile(join(output, "node_modules", "fixture-resource", "package.json"), "utf8")).name,
      "fixture-resource",
    );
    assert.equal(await hasBuildOutputReceipt(output), true);
    await writeFile(snapshot, "{}\n", "utf8");
    assert.equal(await hasBuildOutputReceipt(output), false);
    await writeFile(snapshot, packageManifest, "utf8");
    assert.equal(await hasBuildOutputReceipt(output), true);

    await rm(join(root, "node_modules", "fixture-resource"), { recursive: true, force: true });
    const executed = spawnSync(process.execPath, [join(output, "main.js")], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(executed.status, 0, String(executed.stdout) + String(executed.stderr));
    assert.equal(executed.stdout, "fixture-resource\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function installIsolatedBuildToolchain(
  root: string,
  runtimeLayout: "hoisted" | "nested",
): Promise<string> {
  const nodeModules = join(root, "node_modules");
  const scope = join(nodeModules, "@velarscript");
  await mkdir(scope, { recursive: true });
  await Promise.all([
    cp(join(repositoryRoot, "packages", "cli"), join(root, "toolchain", "cli"), { recursive: true }),
    cp(join(repositoryRoot, "packages", "node"), join(scope, "node"), { recursive: true }),
    cp(join(repositoryRoot, "packages", "server"), join(scope, "server"), { recursive: true }),
    cp(join(repositoryRoot, "node_modules", "esbuild"), join(nodeModules, "esbuild"), { recursive: true }),
  ]);
  for (const name of ["compiler", "core"] as const) {
    await symlink(join(repositoryRoot, "packages", name), join(scope, name), "dir");
  }
  await symlink(join(repositoryRoot, "packages", "create"), join(nodeModules, "create-velar"), "dir");
  await symlink(join(repositoryRoot, "node_modules", "@esbuild"), join(nodeModules, "@esbuild"), "dir");

  for (const [owner, packageName] of [["node", "ws"], ["server", "yaml"]] as const) {
    const destination = runtimeLayout === "hoisted"
      ? join(nodeModules, packageName)
      : join(scope, owner, "node_modules", packageName);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(repositoryRoot, "node_modules", packageName), destination, { recursive: true });
  }
  return join(root, "toolchain", "cli", "src", "cli.ts");
}

interface TreeSnapshotEntry {
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly contents?: string;
}

async function snapshotTree(root: string): Promise<readonly TreeSnapshotEntry[]> {
  const paths = await readdir(root, { recursive: true, encoding: "utf8" });
  const output: TreeSnapshotEntry[] = [];
  for (const path of paths.sort()) {
    const absolutePath = join(root, path);
    const metadata = await lstat(absolutePath);
    assert.equal(metadata.isSymbolicLink(), false, `unexpected symbolic link in package input: ${path}`);
    if (metadata.isDirectory()) output.push({ path, kind: "directory" });
    else {
      assert.equal(metadata.isFile(), true, `unexpected package input type: ${path}`);
      output.push({ path, kind: "file", contents: (await readFile(absolutePath)).toString("base64") });
    }
  }
  return output;
}
