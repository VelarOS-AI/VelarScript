import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acquireBuildOutputClaim } from "../packages/cli/src/build-output-claim.ts";
import { MAXIMUM_SERVER_CONFIGURATION_BYTES } from "../packages/cli/src/server-configuration-limits.ts";
import {
  readStandaloneReceipt,
  standaloneServerConfigurationPath,
} from "../packages/cli/src/standalone-output-ownership.ts";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(workspaceRoot, "packages", "cli", "src", "cli.ts");

interface Execution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(cwd: string, ...arguments_: readonly string[]): Execution {
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

async function temporaryRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${name}-`));
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { readonly code?: unknown }).code === code;
}

test("standalone Server output carries a transactional portable configuration snapshot", async () => {
  const root = await temporaryRoot("velar-standalone-server-configuration");
  try {
    const project = join(root, "service");
    const created = runCli(root, "create", project, "--template", "node");
    assert.equal(created.status, 0, created.stdout + created.stderr);
    await write(join(project, "src", "main.vel"), [
      'import {configuration} from "velar/server"',
      "type ServerSettings:",
      "    host: string",
      "    port: number",
      "    maxBodyBytes: number",
      "type Settings:",
      "    server: ServerSettings",
      "@main:",
      "    const settings = await configuration(Settings)",
      "    print(settings.server.maxBodyBytes)",
      "",
    ].join("\n"));

    const sourceConfiguration = join(project, "application.yml");
    const output = join(project, "standalone", "main.js");
    const configuration = standaloneServerConfigurationPath(output, sourceConfiguration);
    const built = runCli(project, "build", "src/main.vel", "--out", output);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    assert.deepEqual(await readFile(configuration), await readFile(sourceConfiguration));
    assert.equal((await readStandaloneReceipt(output)).has(resolve(configuration)), true);

    const dependency = JSON.parse(await readFile(
      join(project, "standalone", "node_modules", "velar", "node_modules", "yaml", "package.json"),
      "utf8",
    )) as Record<string, unknown>;
    assert.equal(dependency.name, "yaml");
    await assert.rejects(
      lstat(join(project, "standalone", "node_modules", "yaml")),
      (error: unknown) => isErrorCode(error, "ENOENT"),
    );

    const configurationClaim = await acquireBuildOutputClaim(configuration, "file");
    try {
      const claimed = runCli(project, "build", "src/main.vel", "--out", output);
      assert.equal(claimed.status, 1, claimed.stdout + claimed.stderr);
      assert.match(claimed.stderr, /overlaps active file output/u);
    } finally {
      await configurationClaim.release();
    }

    const outputBeforeFailure = await readFile(output);
    const configurationBeforeFailure = await readFile(configuration);
    const sourceConfigurationBeforeFailure = await readFile(sourceConfiguration);
    const authorConfiguration = "# author replaced the generated snapshot\nserver:\n  port: 65535\n";
    await write(configuration, authorConfiguration);
    const replacedSnapshot = runCli(project, "build", "src/main.vel", "--out", output);
    assert.equal(replacedSnapshot.status, 1, replacedSnapshot.stdout + replacedSnapshot.stderr);
    assert.match(replacedSnapshot.stderr, /Refusing to replace unowned standalone sidecar/u);
    assert.deepEqual(await readFile(output), outputBeforeFailure);
    assert.equal(await readFile(configuration, "utf8"), authorConfiguration);

    await writeFile(configuration, configurationBeforeFailure);
    await writeFile(sourceConfiguration, Buffer.alloc(MAXIMUM_SERVER_CONFIGURATION_BYTES + 1, 0x20));
    const oversizedSource = runCli(project, "build", "src/main.vel", "--out", output);
    assert.equal(oversizedSource.status, 1, oversizedSource.stdout + oversizedSource.stderr);
    assert.match(oversizedSource.stderr, /Configured Server configuration .* cannot exceed 1 MiB/u);
    assert.deepEqual(await readFile(output), outputBeforeFailure);
    assert.deepEqual(await readFile(configuration), configurationBeforeFailure);

    await writeFile(sourceConfiguration, sourceConfigurationBeforeFailure);
    const oversizedSidecar = Buffer.alloc(MAXIMUM_SERVER_CONFIGURATION_BYTES + 1, 0x23);
    await writeFile(configuration, oversizedSidecar);
    const rejectedOversizedSidecar = runCli(project, "build", "src/main.vel", "--out", output);
    assert.equal(rejectedOversizedSidecar.status, 1, rejectedOversizedSidecar.stdout + rejectedOversizedSidecar.stderr);
    assert.match(rejectedOversizedSidecar.stderr, /Refusing to replace unowned standalone sidecar/u);
    assert.deepEqual(await readFile(output), outputBeforeFailure);
    assert.deepEqual(await readFile(configuration), oversizedSidecar);

    await writeFile(configuration, configurationBeforeFailure);
    await rm(sourceConfiguration);
    const missingSource = runCli(project, "build", "src/main.vel", "--out", output);
    assert.equal(missingSource.status, 1, missingSource.stdout + missingSource.stderr);
    assert.match(missingSource.stderr, /Configured Server configuration .* does not exist/u);
    assert.deepEqual(await readFile(output), outputBeforeFailure);
    assert.deepEqual(await readFile(configuration), configurationBeforeFailure);

    for (const cwd of [dirname(output), project, root]) {
      const executed = spawnSync(process.execPath, [output], { cwd, encoding: "utf8", timeout: 120_000 });
      assert.equal(executed.status, 0, `${cwd}\n${String(executed.stderr)}`);
      assert.equal(executed.stdout, "16777216\n");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a version-one receipt cannot claim a Server configuration sidecar", async () => {
  const root = await temporaryRoot("velar-standalone-v1-configuration");
  try {
    const output = join(root, "dist", "main.js");
    const configuration = standaloneServerConfigurationPath(output, "application.json");
    const receipt = Buffer.from(JSON.stringify({
      formatVersion: 1,
      kind: "velar-standalone-build",
      outputFile: "main.js",
      files: ["main.js", "main.server.json"],
    }), "utf8").toString("base64url");
    const authorConfiguration = '{"author":true}\n';
    await write(join(root, "main.vel"), 'print("new")\n');
    await write(output, `author JavaScript\n// @velarscript/standalone-output-v1 ${receipt}\n`);
    await write(configuration, authorConfiguration);
    assert.equal((await readStandaloneReceipt(output)).size, 0);

    const built = runCli(root, "build", "main.vel", "--out", output, "--no-source-maps");
    assert.equal(built.status, 0, built.stdout + built.stderr);
    assert.equal(await readFile(configuration, "utf8"), authorConfiguration);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a receipt cannot claim a Server configuration larger than the snapshot boundary", async () => {
  const root = await temporaryRoot("velar-standalone-oversized-configuration-receipt");
  try {
    const output = join(root, "dist", "main.js");
    const configuration = standaloneServerConfigurationPath(output, "application.json");
    const receipt = Buffer.from(JSON.stringify({
      formatVersion: 2,
      kind: "velar-standalone-build",
      outputFile: "main.js",
      files: ["main.js", "main.server.json"],
      configuration: {
        file: "main.server.json",
        sizeBytes: MAXIMUM_SERVER_CONFIGURATION_BYTES + 1,
        sha256: "0".repeat(64),
      },
    }), "utf8").toString("base64url");
    const authorConfiguration = '{"author":true}\n';
    await write(join(root, "main.vel"), 'print("new")\n');
    await write(output, `author JavaScript\n// @velarscript/standalone-output-v2 ${receipt}\n`);
    await write(configuration, authorConfiguration);
    assert.equal((await readStandaloneReceipt(output)).size, 0);

    const built = runCli(root, "build", "main.vel", "--out", output, "--no-source-maps");
    assert.equal(built.status, 0, built.stdout + built.stderr);
    assert.equal(await readFile(configuration, "utf8"), authorConfiguration);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone Server snapshots follow a transitive extension runtime dependency after relocation", async () => {
  const root = await temporaryRoot("velar-transitive-server-configuration");
  try {
    const project = join(root, "service");
    const created = runCli(root, "create", project, "--template", "node");
    assert.equal(created.status, 0, created.stdout + created.stderr);
    const extensionName = "fixture-server-wrapper";
    await write(join(project, "node_modules", extensionName, "package.json"), `${JSON.stringify({
      name: extensionName,
      version: "1.0.0",
      type: "module",
      exports: {"./compiler": "./compiler.js"},
      peerDependencies: {"@velarscript/server": "0.29.2"},
      velar: {extension: {
        kind: "capability",
        apiVersion: "1.0",
        extends: {"@velarscript/server": "0.15"},
      }},
    }, null, 2)}\n`);
    await write(join(project, "node_modules", extensionName, "compiler.js"), [
      "const unknownType = Object.freeze({kind: \"unknown\"})",
      "const stringType = Object.freeze({kind: \"string\"})",
      "const loadType = Object.freeze({kind: \"function\", parameterNames: Object.freeze([\"target\"]), parameters: Object.freeze([unknownType]), requiredParameters: 1, result: Object.freeze({kind: \"promise\", value: unknownType})})",
      "const moduleInterface = Object.freeze({",
      "  exports: new Map([[\"load\", loadType], [\"marker\", stringType]]), mutableExports: new Set(), reactiveExports: new Map(), reExports: new Map(),",
      "  namedTypes: new Map(), namedTypeReadonlyFields: new Map(), namedTypeIdentities: new Map(), genericTypes: new Map(),",
      "  typeAliases: new Map(), enums: new Map(), classes: new Map(), tests: Object.freeze([]), extensionExports: new Map(), extensionData: new Map(),",
      "})",
      "export const velarCompilerExtension = Object.freeze({",
      `  id: ${JSON.stringify(extensionName)},`,
      "  contract: Object.freeze({protocolVersion: 1, apiVersion: \"1.0\", kind: \"capability\", extends: Object.freeze({\"@velarscript/server\": \"0.15\"})}),",
      "  modules: Object.freeze({",
      "    apiVersion: \"1.0\",",
      `    interfaces: new Map([[${JSON.stringify(extensionName + "/runtime")}, moduleInterface]]),`,
      `    sources: new Map([[${JSON.stringify(extensionName + "/runtime")}, 'import {configuration} from "velar/server"; export const load = configuration; export const marker = "extension-ready";\\n']]),`,
      `    dependencies: new Map([[${JSON.stringify(extensionName + "/runtime")}, Object.freeze(["velar/server"])]]),`,
      "  }),",
      "})",
      "",
    ].join("\n"));
    const manifestPath = join(project, "velar.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.extensions = [extensionName];
    await write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await write(join(project, "src", "main.vel"), [
      `import {load} from ${JSON.stringify(extensionName + "/runtime")}`,
      "type ServerSettings:",
      "    host: string",
      "    port: number",
      "    maxBodyBytes: number",
      "type Settings:",
      "    server: ServerSettings",
      "@main:",
      "    const settings = Settings.parse(await load(Settings))",
      "    print(settings.server.maxBodyBytes)",
      "",
    ].join("\n"));
    await write(join(project, "src", "extension.test.vel"), [
      `import {marker} from ${JSON.stringify(extensionName + "/runtime")}`,
      'import {expect} from "velar/test"',
      "",
      'test "a third-party runtime keeps its package namespace in the Node test sandbox":',
      '    expect(marker).toBe("extension-ready")',
      "",
    ].join("\n"));

    const ran = runCli(project, "run", "src/main.vel");
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.equal(ran.stdout, "16777216\n");

    const tested = runCli(project, "test", "src/extension.test.vel");
    assert.equal(tested.status, 0, tested.stdout + tested.stderr);
    assert.match(tested.stdout, /third-party runtime keeps its package namespace/u);

    const directoryOutput = join(project, "directory");
    const directoryBuilt = runCli(
      project,
      "build",
      "src/main.vel",
      "--out-dir",
      directoryOutput,
      "--mode",
      "readable",
    );
    assert.equal(directoryBuilt.status, 0, directoryBuilt.stdout + directoryBuilt.stderr);
    assert.equal((await lstat(join(directoryOutput, "node_modules", extensionName, "runtime.js"))).isFile(), true);
    const directoryExecution = spawnSync(process.execPath, [join(directoryOutput, "src", "main.js")], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(directoryExecution.status, 0, String(directoryExecution.stderr));
    assert.equal(directoryExecution.stdout, "16777216\n");

    const originalOutputRoot = join(project, "standalone");
    const output = join(originalOutputRoot, "main.js");
    const built = runCli(project, "build", "src/main.vel", "--out", output);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const sourceConfiguration = join(project, "application.yml");
    const configuration = standaloneServerConfigurationPath(output, sourceConfiguration);
    assert.deepEqual(await readFile(configuration), await readFile(sourceConfiguration));

    const removedSource = join(root, "removed-application.yml");
    await rename(sourceConfiguration, removedSource);
    const relocatedRoot = join(root, "relocated", "deep", "application");
    await mkdir(dirname(relocatedRoot), {recursive: true});
    await rename(originalOutputRoot, relocatedRoot);
    const relocatedOutput = join(relocatedRoot, "main.js");
    for (const cwd of [root, project, relocatedRoot]) {
      const executed = spawnSync(process.execPath, [relocatedOutput], {cwd, encoding: "utf8", timeout: 120_000});
      assert.equal(executed.status, 0, `${cwd}\n${String(executed.stderr)}`);
      assert.equal(executed.stdout, "16777216\n");
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
