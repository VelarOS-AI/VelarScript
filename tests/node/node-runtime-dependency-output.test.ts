import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { writeNodeRuntimeDependencies } from "../../packages/cli/src/node-runtime-dependencies.ts";
import { standardRuntimePackageLayout } from "../../packages/cli/src/standard-runtime-package-layout.ts";
import { repositoryRoot } from "../support/repository-root.ts";
import { variadicCliRunner } from "../support/run-cli.ts";

const cli = join(repositoryRoot, "packages", "cli", "src", "cli.ts");
const require = createRequire(import.meta.url);

interface RuntimeDependencyFixture {
  readonly packageName: "ws" | "yaml";
  readonly standardModule: "velar/websocket" | "velar/server";
  readonly importedName: "listen" | "applicationConfigurationPath";
}

const fixtures: readonly RuntimeDependencyFixture[] = [
  { packageName: "ws", standardModule: "velar/websocket", importedName: "listen" },
  { packageName: "yaml", standardModule: "velar/server", importedName: "applicationConfigurationPath" },
];

test("a compiler extension package root and its index subpath have distinct runtime files", () => {
  const [package_] = standardRuntimePackageLayout(["fixture-runtime", "fixture-runtime/index"]);
  assert.equal(package_?.name, "fixture-runtime");
  assert.deepEqual(package_?.modules.map(({source, exportName, file}) => ({source, exportName, file})), [
    {source: "fixture-runtime", exportName: ".", file: ".velar-runtime-root.mjs"},
    {source: "fixture-runtime/index", exportName: "./index", file: "index.js"},
  ]);
  assert.throws(
    () => standardRuntimePackageLayout(["fixture-runtime/Foo", "fixture-runtime/foo"]),
    /portable output collision/u,
  );
  assert.throws(
    () => standardRuntimePackageLayout([`fixture-runtime/${"a".repeat(253)}`]),
    /output contains path segment .* exceeds 255 UTF-8 bytes/u,
  );
  assert.throws(
    () => standardRuntimePackageLayout(["a".repeat(256)]),
    /Standard runtime package .* exceeds 255 UTF-8 bytes/u,
  );
});

test("a Node runtime dependency package root is an exclusive copy claim", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-runtime-dependency-race-"));
  const nodeModules = join(directory, "node_modules");
  try {
    await mkdir(nodeModules);
    const results = await Promise.allSettled([
      writeNodeRuntimeDependencies(nodeModules, new Set(["velar/websocket"])),
      writeNodeRuntimeDependencies(nodeModules, new Set(["velar/websocket"])),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.match(String(rejected.reason), /Node runtime dependency 'ws'.*conflicts with an existing build output/u);
    const copiedManifest = JSON.parse(await readFile(
      join(nodeModules, "velar", "node_modules", "ws", "package.json"), "utf8",
    )) as {
      readonly name?: unknown;
    };
    assert.equal(copiedManifest.name, "ws");
    assert.equal((await lstat(join(nodeModules, "velar", "node_modules", "ws", "index.js"))).isFile(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("application ws and velar websocket resolve from separate package owners after check", async () => {
  const project = await mkdtemp(join(tmpdir(), "velar-application-ws-owner-"));
  const output = join(project, "dist");
  const applicationWs = join(project, "node_modules", "ws");
  try {
    await mkdir(join(project, "src"), { recursive: true });
    await mkdir(applicationWs, { recursive: true });
    await writeFile(join(project, "velar.json"), `${JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/node"],
    }, null, 2)}\n`, "utf8");
    await writeFile(join(applicationWs, "package.json"), `${JSON.stringify({
      name: "ws",
      version: "99.0.0-application",
      type: "module",
      exports: "./index.js",
    }, null, 2)}\n`, "utf8");
    await writeFile(join(applicationWs, "index.js"), 'export function marker() { return "application-ws"; }\n', "utf8");
    await writeFile(join(project, "src", "main.vel"), [
      'extern module "ws":',
      "    export def marker() -> string",
      'import js {marker} from "ws"',
      'import {listen} from "velar/websocket"',
      "",
      "@main:",
      "    const runtimeListen = listen",
      "    print(marker())",
      "",
    ].join("\n"), "utf8");

    for (const command of [["check"], ["run"], ["build", "--mode", "readable"]] as const) {
      const result = runCli(project, ...command);
      assert.equal(result.status, 0, `${command.join(" ")}\n${String(result.stdout)}${String(result.stderr)}`);
      if (command[0] === "run") assert.equal(result.stdout, "application-ws\n");
    }
    const nestedManifest = JSON.parse(await readFile(
      join(output, "node_modules", "velar", "node_modules", "ws", "package.json"), "utf8",
    )) as {readonly name?: unknown; readonly version?: unknown};
    assert.equal(nestedManifest.name, "ws");
    assert.notEqual(nestedManifest.version, "99.0.0-application");
    await assert.rejects(lstat(join(output, "node_modules", "ws")), isMissingPath);
    const executed = spawnSync(process.execPath, [join(output, "main.js")], {
      cwd: project,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(executed.status, 0, String(executed.stdout) + String(executed.stderr));
    assert.equal(executed.stdout, "application-ws\n");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a generic directory build reserves its selected Node runtime dependency tree", async () => {
  const project = await mkdtemp(join(tmpdir(), "velar-generic-runtime-dependency-"));
  const output = join(project, "dist");
  const mainPath = join(project, "src", "main.vel");
  const claimedManifestPath = join(project, "src", "node_modules", "velar", "node_modules", "ws", "package.json");
  try {
    await mkdir(dirname(mainPath), { recursive: true });
    await writeFile(join(project, "velar.json"), `${JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/node"],
    }, null, 2)}\n`, "utf8");
    await writeFile(mainPath, sourceFor(fixtures[0]!, false), "utf8");
    const baseline = runCli(project, "build", "--mode", "readable");
    assert.equal(baseline.status, 0, String(baseline.stdout) + String(baseline.stderr));
    const baselineOutput = await snapshotTree(output);

    const claimedManifest = '{"name":"author-owned-ws"}\n';
    await mkdir(dirname(claimedManifestPath), { recursive: true });
    await writeFile(claimedManifestPath, claimedManifest, "utf8");
    const claimedSource = sourceFor(fixtures[0]!, true);
    await writeFile(mainPath, claimedSource, "utf8");

    const rejected = runCli(project, "build", "--mode", "readable");
    assert.equal(rejected.status, 1, String(rejected.stdout) + String(rejected.stderr));
    assert.match(
      String(rejected.stderr),
      /Node runtime dependency 'ws'.*conflicts with resource snapshot/u,
    );
    assert.equal(await readFile(mainPath, "utf8"), claimedSource);
    assert.equal(await readFile(claimedManifestPath, "utf8"), claimedManifest);
    assert.deepEqual(await snapshotTree(output), baselineOutput);
    const verified = runCli(project, "verify", output);
    assert.equal(verified.status, 0, String(verified.stdout) + String(verified.stderr));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

for (const fixture of fixtures) {
  test(`a checked resource cannot impersonate the ${fixture.packageName} Node runtime dependency`, async () => {
    const directory = await mkdtemp(join(tmpdir(), `velar-${fixture.packageName}-output-claim-`));
    const project = join(directory, "service");
    const output = join(project, "dist");
    try {
      const created = runCli(directory, "create", project, "--template", "node");
      assert.equal(created.status, 0, String(created.stdout) + String(created.stderr));

      const mainPath = join(project, "src", "main.vel");
      await writeFile(mainPath, sourceFor(fixture, false), "utf8");
      const baseline = runCli(project, "build", "--mode", "readable");
      assert.equal(baseline.status, 0, String(baseline.stdout) + String(baseline.stderr));
      const baselineOutput = await snapshotTree(output);
      const baselineRun = spawnSync(process.execPath, [join(output, "main.js")], {
        cwd: output,
        encoding: "utf8",
        timeout: 30_000,
      });
      assert.equal(baselineRun.status, 0, String(baselineRun.stdout) + String(baselineRun.stderr));

      const installedManifest = JSON.parse(await readFile(
        require.resolve(`${fixture.packageName}/package.json`), "utf8",
      )) as { readonly version?: unknown };
      assert.equal(typeof installedManifest.version, "string");
      const claimedManifest = `${JSON.stringify({
        name: fixture.packageName,
        version: installedManifest.version,
        type: "module",
        exports: "./index.js",
      }, null, 2)}\n`;
      const claimedManifestPath = join(
        project, "src", "node_modules", "velar", "node_modules", fixture.packageName, "package.json",
      );
      await mkdir(dirname(claimedManifestPath), { recursive: true });
      await writeFile(claimedManifestPath, claimedManifest, "utf8");
      const claimedSource = sourceFor(fixture, true);
      await writeFile(mainPath, claimedSource, "utf8");

      const rejected = runCli(project, "build", "--mode", "readable");
      assert.equal(rejected.status, 1, String(rejected.stdout) + String(rejected.stderr));
      assert.match(
        String(rejected.stderr),
        new RegExp(`Node runtime dependency '${fixture.packageName}'.*conflicts with resource snapshot`, "u"),
      );
      assert.equal(await readFile(mainPath, "utf8"), claimedSource, "the checked source module must remain unchanged");
      assert.equal(
        await readFile(claimedManifestPath, "utf8"),
        claimedManifest,
        "the checked resource must remain unchanged",
      );
      assert.deepEqual(await snapshotTree(output), baselineOutput, "a rejected build must preserve the previous output tree");
      const verified = runCli(project, "verify", output);
      assert.equal(verified.status, 0, String(verified.stdout) + String(verified.stderr));

      const claimedModulePath = join(
        project, "src", "node_modules", "velar", "node_modules", fixture.packageName, "injected.vel",
      );
      const claimedModule = "export const injected = true\n";
      await writeFile(claimedModulePath, claimedModule, "utf8");
      const compiledClaimSource = [
        `import {injected} from "./node_modules/velar/node_modules/${fixture.packageName}/injected.vel"`,
        sourceFor(fixture, false),
      ].join("\n");
      await writeFile(mainPath, compiledClaimSource, "utf8");
      const compiledRejected = runCli(project, "build", "--mode", "readable");
      assert.equal(compiledRejected.status, 1, String(compiledRejected.stdout) + String(compiledRejected.stderr));
      assert.match(
        String(compiledRejected.stderr),
        new RegExp(`Node runtime dependency '${fixture.packageName}'.*conflicts with compiled module`, "u"),
      );
      assert.equal(await readFile(mainPath, "utf8"), compiledClaimSource);
      assert.equal(await readFile(claimedModulePath, "utf8"), claimedModule);
      assert.deepEqual(await snapshotTree(output), baselineOutput);
      const compiledVerified = runCli(project, "verify", output);
      assert.equal(compiledVerified.status, 0, String(compiledVerified.stdout) + String(compiledVerified.stderr));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("server configuration cannot be placed inside a required Node runtime dependency tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-runtime-dependency-configuration-"));
  const project = join(directory, "service");
  const output = join(project, "dist");
  try {
    const created = runCli(directory, "create", project, "--template", "node");
    assert.equal(created.status, 0, String(created.stdout) + String(created.stderr));
    const mainPath = join(project, "src", "main.vel");
    const originalMain = await readFile(mainPath, "utf8");
    const manifestPath = join(project, "velar.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    const baseline = runCli(project, "build", "--mode", "readable");
    assert.equal(baseline.status, 0, String(baseline.stdout) + String(baseline.stderr));
    const baselineOutput = await snapshotTree(output);

    for (const fixture of fixtures) {
      const configurationRelativePath = `node_modules/velar/node_modules/${fixture.packageName}/injected.json`;
      const configurationPath = join(project, configurationRelativePath);
      const configuration = `${JSON.stringify({ server: { host: "127.0.0.1", port: 0 } })}\n`;
      await mkdir(dirname(configurationPath), { recursive: true });
      await writeFile(configurationPath, configuration, "utf8");
      await writeFile(mainPath, fixture.packageName === "ws"
        ? `import {listen} from "velar/websocket"\n${originalMain}`
        : originalMain, "utf8");
      manifest.server = { configuration: configurationRelativePath };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const rejected = runCli(project, "build", "--mode", "readable");
      assert.equal(rejected.status, 1, String(rejected.stdout) + String(rejected.stderr));
      assert.match(
        String(rejected.stderr),
        new RegExp(`server configuration snapshot conflicts with Node runtime dependency '${fixture.packageName}'`, "u"),
      );
      assert.equal(await readFile(configurationPath, "utf8"), configuration);
      assert.deepEqual(await snapshotTree(output), baselineOutput);
      const verified = runCli(project, "verify", output);
      assert.equal(verified.status, 0, String(verified.stdout) + String(verified.stderr));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function sourceFor(fixture: RuntimeDependencyFixture, claimed: boolean): string {
  return [
    ...(claimed ? [`import json packageMetadata from "./node_modules/velar/node_modules/${fixture.packageName}/package.json"`] : []),
    `import {${fixture.importedName}} from "${fixture.standardModule}"`,
    "",
    "@main:",
    ...(claimed ? ["    print(packageMetadata)"] : []),
    `    print(${fixture.importedName})`,
    "",
  ].join("\n");
}

interface TreeEntrySnapshot {
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly contents?: string;
}

async function snapshotTree(root: string): Promise<readonly TreeEntrySnapshot[]> {
  const paths = await readdir(root, { recursive: true, encoding: "utf8" });
  const output: TreeEntrySnapshot[] = [];
  for (const path of paths.sort()) {
    const absolutePath = join(root, path);
    const metadata = await lstat(absolutePath);
    assert.equal(metadata.isSymbolicLink(), false, `unexpected symbolic link in build output: ${path}`);
    if (metadata.isDirectory()) output.push({ path, kind: "directory" });
    else {
      assert.equal(metadata.isFile(), true, `unexpected build output type: ${path}`);
      output.push({ path, kind: "file", contents: (await readFile(absolutePath)).toString("base64") });
    }
  }
  return output;
}

const runCli = variadicCliRunner({ timeout: 300_000 });

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
