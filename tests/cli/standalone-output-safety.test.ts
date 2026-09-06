import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { ProjectResult } from "../../packages/cli/src/project.ts";
import { acquireBuildOutputClaim } from "../../packages/cli/src/build-output-claim.ts";
import { writeStandaloneOutputTransaction } from "../../packages/cli/src/standalone-output-transaction.ts";
import { STANDALONE_TRANSACTION_EVIDENCE_MARKER } from "../../packages/cli/src/standalone-output-ownership.ts";
import { variadicCliRunner } from "../support/run-cli.ts";
import { linkVelarExtension } from "../support/web-project.ts";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = join(workspaceRoot, "packages", "cli", "src", "cli.ts");

interface Execution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const runCli = variadicCliRunner({ timeout: 120_000 });

async function temporaryRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${name}-`));
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

function assertProgramOutput(path: string, expected: string): void {
  const executed = spawnSync(process.execPath, [path], { encoding: "utf8", timeout: 120_000 });
  assert.equal(executed.status, 0, String(executed.stderr));
  assert.equal(executed.stdout, expected);
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { readonly code?: unknown }).code === code;
}

test("standalone --out cannot replace its checked source by lexical path", async () => {
  const root = await temporaryRoot("velar-standalone-source");
  try {
    const source = join(root, "main.vel");
    const contents = 'print("preserved")\n';
    await write(source, contents);
    const built = runCli(root, "build", source, "--out", source);
    assert.notEqual(built.status, 0, built.stdout + built.stderr);
    assert.match(built.stderr, /--out requires a \.js file path|overlaps checked source/u);
    assert.equal(await readFile(source, "utf8"), contents);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone --out cannot replace its checked source through a symlink alias", async () => {
  const root = await temporaryRoot("velar-standalone-source-alias");
  try {
    const source = join(root, "main.vel");
    const output = join(root, "alias.js");
    const contents = 'print("preserved")\n';
    await write(source, contents);
    await symlink(source, output);
    const built = runCli(root, "build", source, "--out", output);
    assert.equal(built.status, 1, built.stdout + built.stderr);
    assert.match(built.stderr, /overlaps checked source/u);
    assert.equal((await lstat(output)).isSymbolicLink(), true);
    assert.equal(await readFile(source, "utf8"), contents);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit-source standalone output cannot replace its source-package contract", async () => {
  const root = await temporaryRoot("velar-standalone-source-package-manifest");
  try {
    const packageManifest = join(root, "package.json");
    const manifestContents = `${JSON.stringify({
      name: "standalone-source-package-fixture",
      version: "1.0.0",
      type: "module",
      velar: {
        entry: "src/index.vel",
        targets: ["core"],
        requires: { capabilities: [] },
      },
    }, null, 2)}\n`;
    await write(join(root, "velar.json"), `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "src/index.vel",
      outDir: "dist",
    })}\n`);
    await write(packageManifest, manifestContents);
    await write(join(root, "src", "index.vel"), "export const value = 1\n");

    const lexical = runCli(root, "build", "src/index.vel", "--out", "package.json");
    assert.equal(lexical.status, 2, lexical.stdout + lexical.stderr);
    assert.match(lexical.stderr, /--out requires a \.js file path/u);
    assert.equal(await readFile(packageManifest, "utf8"), manifestContents);

    const alias = join(root, "package-contract.js");
    await symlink(packageManifest, alias);
    const canonical = runCli(root, "build", "src/index.vel", "--out", alias, "--no-source-maps");
    assert.equal(canonical.status, 1, canonical.stdout + canonical.stderr);
    assert.match(canonical.stderr, /overlaps checked project package manifest/u);
    assert.equal((await lstat(alias)).isSymbolicLink(), true);
    assert.equal(await readFile(packageManifest, "utf8"), manifestContents);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone --out cannot replace a JavaScript package it just bundled", async () => {
  const root = await temporaryRoot("velar-standalone-npm-input");
  try {
    const packageEntry = join(root, "node_modules", "fixture-package", "index.js");
    const contents = 'export const value = "package-input";\n';
    await write(join(root, "node_modules", "fixture-package", "package.json"), `${JSON.stringify({
      name: "fixture-package",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    })}\n`);
    await write(packageEntry, contents);
    await write(join(root, "main.vel"), [
      'extern module "fixture-package":',
      "    export const value: string",
      'import js {value} from "fixture-package"',
      "print(value)",
      "",
    ].join("\n"));
    const built = runCli(root, "build", "main.vel", "--out", packageEntry);
    assert.equal(built.status, 1, built.stdout + built.stderr);
    assert.match(built.stderr, /overlaps checked JavaScript (?:dependency|package)/u);
    assert.equal(await readFile(packageEntry, "utf8"), contents);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone generated CSS cannot replace an imported CSS resource", async () => {
  const root = await temporaryRoot("velar-standalone-css-resource");
  try {
    await linkVelarExtension(root, "web");
    await write(join(root, "velar.json"), `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "main.vel",
      extensions: ["@velarscript/web"],
    })}\n`);
    await write(join(root, "main.vel"), 'import css unsafe "./bundle.css" before look\nexport const value = 1\n');
    const resource = "body { color: rebeccapurple; }\n";
    await write(join(root, "bundle.css"), resource);
    const built = runCli(root, "build", "main.vel", "--out", "bundle.js");
    assert.equal(built.status, 1, built.stdout + built.stderr);
    assert.match(built.stderr, /overlaps checked compiler resource/u);
    assert.equal(await readFile(join(root, "bundle.css"), "utf8"), resource);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a standalone runtime ownership failure preserves every previous output", async () => {
  const root = await temporaryRoot("velar-standalone-rollback");
  try {
    const output = join(root, "dist", "main.js");
    await write(join(root, "main.vel"), 'import {listen} from "velar/websocket"\nconst open = listen\nprint("new")\n');
    await write(output, "old JavaScript\n");
    await write(`${output}.map`, "old source map\n");
    await write(join(root, "dist", "node_modules", "velar", "package.json"), `${JSON.stringify({
      name: "velar",
      private: true,
      type: "module",
      velarGeneratedRuntime: 1,
    })}\n`);
    const built = runCli(root, "build", "main.vel", "--out", output);
    assert.equal(built.status, 1, built.stdout + built.stderr);
    assert.match(built.stderr, /legacy generated package .* has no standalone output owner/u);
    assert.equal(await readFile(output, "utf8"), "old JavaScript\n");
    assert.equal(await readFile(`${output}.map`, "utf8"), "old source map\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone sidecar preflight preserves an old program when a later claim is invalid", async () => {
  const root = await temporaryRoot("velar-standalone-sidecar-rollback");
  try {
    const output = join(root, "dist", "main.js");
    await write(join(root, "main.vel"), 'print("new")\n');
    await write(output, "old JavaScript\n");
    await write(join(`${output}.map`, "sentinel.txt"), "old directory\n");
    const built = runCli(root, "build", "main.vel", "--out", output, "--source-maps");
    assert.equal(built.status, 1, built.stdout + built.stderr);
    assert.match(built.stderr, /Refusing to replace (?:directory|unowned standalone sidecar).*main\.js\.map/u);
    assert.equal(await readFile(output, "utf8"), "old JavaScript\n");
    assert.equal(await readFile(join(`${output}.map`, "sentinel.txt"), "utf8"), "old directory\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone cleanup preserves sidecars that have no generated owner link", async () => {
  const root = await temporaryRoot("velar-standalone-unowned-sidecars");
  try {
    const output = join(root, "dist", "main.js");
    const receipt = Buffer.from(JSON.stringify({
      formatVersion: 1,
      kind: "velar-standalone-build",
      outputFile: "main.js",
      files: ["main.js", "main.js.map", "main.css"],
    }), "utf8").toString("base64url");
    await write(join(root, "main.vel"), 'print("new")\n');
    await write(output, `author JavaScript\n// @velarscript/standalone-output-v1 ${receipt}\n`);
    await write(`${output}.map`, "author source map\n");
    await write(output.replace(/\.js$/u, ".css"), "author stylesheet\n");
    const built = runCli(root, "build", "main.vel", "--out", output, "--no-source-maps");
    assert.equal(built.status, 0, built.stdout + built.stderr);
    assert.equal(await readFile(`${output}.map`, "utf8"), "author source map\n");
    assert.equal(await readFile(output.replace(/\.js$/u, ".css"), "utf8"), "author stylesheet\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a generic embedded marker cannot replace the standalone owner link", async () => {
  const root = await temporaryRoot("velar-standalone-embedded-owner");
  try {
    const outputRoot = join(root, "dist");
    const output = join(outputRoot, "main.js");
    await write(join(root, "main.vel"), [
      "extern js()`",
      "export const value = 42",
      "`:",
      "    export const value: number",
      "",
      "print(value)",
      "",
    ].join("\n"));
    const first = runCli(root, "build", "main.vel", "--out", output, "--no-source-maps");
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const embeddedName = (await readdir(outputRoot)).find((name) => name.includes(".embedded-") && name.endsWith(".js"));
    assert.ok(embeddedName);
    const authorMain = "author main\n";
    const genericEmbedded = "export const value = 7;\n// @velarscript/generated-embedded-module\n";
    await write(output, authorMain);
    await write(join(outputRoot, embeddedName), genericEmbedded);

    const rebuilt = runCli(root, "build", "main.vel", "--out", output, "--no-source-maps");
    assert.equal(rebuilt.status, 1, rebuilt.stdout + rebuilt.stderr);
    assert.match(rebuilt.stderr, /Refusing to replace unowned standalone sidecar/u);
    assert.equal(await readFile(output, "utf8"), authorMain);
    assert.equal(await readFile(join(outputRoot, embeddedName), "utf8"), genericEmbedded);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone cleanup removes only sidecars linked by its previous owner receipt", async () => {
  const root = await temporaryRoot("velar-standalone-owned-sidecars");
  try {
    const outputRoot = join(root, "dist");
    const output = join(outputRoot, "main.js");
    await write(join(root, "main.vel"), [
      "extern js()`",
      "export const value = 42",
      "`:",
      "    export const value: number",
      "",
      "print(value)",
      "",
    ].join("\n"));
    const first = runCli(root, "build", "main.vel", "--out", output, "--source-maps");
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const oldSidecars = (await readdir(outputRoot)).filter((name) => name !== "main.js");
    assert.ok(oldSidecars.some((name) => name.includes(".embedded-")), JSON.stringify(oldSidecars));
    assert.ok(oldSidecars.includes("main.js.map"), JSON.stringify(oldSidecars));

    await write(join(root, "main.vel"), 'print("replacement")\n');
    const second = runCli(root, "build", "main.vel", "--out", output, "--no-source-maps");
    assert.equal(second.status, 0, second.stdout + second.stderr);
    const remaining = await readdir(outputRoot);
    for (const sidecar of oldSidecars) assert.equal(remaining.includes(sidecar), false, sidecar);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a forged standalone receipt cannot claim an unrelated sibling", async () => {
  const root = await temporaryRoot("velar-standalone-forged-receipt");
  try {
    const output = join(root, "dist", "main.js");
    const victim = join(root, "dist", "victim.txt");
    const victimContents = "author-owned bytes\n";
    const receipt = Buffer.from(JSON.stringify({
      formatVersion: 1,
      kind: "velar-standalone-build",
      outputFile: "main.js",
      files: ["main.js", "victim.txt"],
    }), "utf8").toString("base64url");
    await write(join(root, "main.vel"), 'print("replacement")\n');
    await write(output, `console.log("old")\n// @velarscript/standalone-output-v1 ${receipt}\n`);
    await write(victim, victimContents);

    const built = runCli(root, "build", "main.vel", "--out", output, "--no-source-maps");
    assert.equal(built.status, 0, built.stdout + built.stderr);
    assert.equal(await readFile(victim, "utf8"), victimContents);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a forged interrupted journal cannot delete an unrelated sibling", async () => {
  const root = await temporaryRoot("velar-standalone-forged-journal");
  try {
    const outputRoot = join(root, "dist");
    const output = join(outputRoot, "main.js");
    const victim = join(outputRoot, "victim.txt");
    const staging = join(outputRoot, ".velar-main.js-forged");
    const victimContents = "author-owned bytes\n";
    await write(join(root, "main.vel"), 'print("replacement")\n');
    await write(victim, victimContents);
    await mkdir(staging, { recursive: true });
    await write(join(staging, ".velar-standalone-transaction.json"), `${JSON.stringify({
      formatVersion: 1,
      kind: "velar-standalone-transaction",
      outputPath: output,
      stagingDirectory: staging,
      canonicalOutputRoot: await realpath(outputRoot),
      canonicalStagingDirectory: await realpath(staging),
      ownerPid: 2_147_483_647,
      transactionToken: randomUUID(),
      phase: "installing",
      operations: [{
        target: "victim.txt",
        staged: "missing",
        backup: null,
        kind: "file",
        hadPrevious: false,
      }],
    }, null, 2)}\n`);

    const built = runCli(root, "build", "main.vel", "--out", output, "--no-source-maps");
    assert.equal(built.status, 0, built.stdout + built.stderr);
    assert.equal(await readFile(victim, "utf8"), victimContents);
    assert.equal((await lstat(staging)).isDirectory(), true, "unsafe journal must remain for inspection");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an exact forged main-output journal is inert without matching transaction evidence", async () => {
  const root = await temporaryRoot("velar-standalone-forged-main-journal");
  try {
    const outputRoot = join(root, "dist");
    const output = join(outputRoot, "main.js");
    const source = join(root, "main.vel");
    const staging = join(outputRoot, ".velar-main.js-forged-main");
    const previous = "author-owned main output\n";
    await write(source, 'print("unused")\n');
    await write(output, previous);
    await mkdir(staging, { recursive: true });
    const transactionToken = randomUUID();
    const canonicalOutputRoot = await realpath(outputRoot);
    const canonicalStagingDirectory = await realpath(staging);
    const operation = {
      target: "main.js",
      staged: "missing",
      backup: null,
      kind: "file",
      hadPrevious: false,
      stagedIdentity: { device: "1", inode: "1", kind: "file", sizeBytes: 0, sha256: "0".repeat(64) },
      previousIdentity: null,
    };
    await write(join(staging, ".velar-standalone-transaction.json"), `${JSON.stringify({
      formatVersion: 2,
      kind: "velar-standalone-transaction",
      outputPath: output,
      stagingDirectory: staging,
      canonicalOutputRoot,
      canonicalStagingDirectory,
      ownerPid: 2_147_483_647,
      transactionToken,
      phase: "installing",
      operations: [operation],
    }, null, 2)}\n`);
    const evidence = `${JSON.stringify({
      formatVersion: 2,
      kind: "velar-standalone-transaction-evidence",
      outputPath: output,
      stagingDirectory: staging,
      canonicalOutputRoot,
      canonicalStagingDirectory,
      ownerPid: 2_147_483_647,
      transactionToken,
      operationsSha256: createHash("sha256").update(JSON.stringify([operation])).digest("hex"),
    }, null, 2)}\n`;
    const externalEvidence = `${staging}.velar-transaction.json`;
    const internalEvidence = join(staging, STANDALONE_TRANSACTION_EVIDENCE_MARKER);
    await write(externalEvidence, evidence);
    await write(internalEvidence, evidence);
    assert.notEqual((await lstat(externalEvidence)).ino, (await lstat(internalEvidence)).ino);
    const project = {
      modules: [{ inputPath: source, result: { dependencies: [], resources: [], runtimeModules: [] } }],
      compilerExtensions: [],
      extensionConfig: new Map(),
      publicRoot: join(root, "public"),
      velarPackages: [],
      resources: [],
      externalTypeDependencies: new Map(),
    } as unknown as ProjectResult;

    await assert.rejects(writeStandaloneOutputTransaction({
      outputPath: output,
      project,
      runtimeModules: new Set(),
      claimedFiles: [output],
      cleanupFiles: [],
      generatedSiblingFiles: [],
      additionalInputs: [],
      writeStaged: async () => {
        throw new Error("deliberate staging failure");
      },
    }), /deliberate staging failure/u);
    assert.equal(await readFile(output, "utf8"), previous);
    assert.equal((await lstat(staging)).isDirectory(), true, "forged journal remains available for inspection");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone claims every static transaction path before staging exists", async () => {
  const root = await temporaryRoot("velar-standalone-preclaimed-staging");
  try {
    const output = join(root, "dist", "main.js");
    const sidecar = `${output}.map`;
    const source = join(root, "main.vel");
    const previous = "previous output\n";
    await write(source, 'print("unused")\n');
    await write(output, previous);
    const project = {
      modules: [{ inputPath: source, result: { dependencies: [], resources: [], runtimeModules: ["velar/fs"] } }],
      compilerExtensions: [],
      extensionConfig: new Map(),
      publicRoot: join(root, "public"),
      velarPackages: [],
      resources: [],
      externalTypeDependencies: new Map(),
    } as unknown as ProjectResult;
    let observed = false;

    await assert.rejects(writeStandaloneOutputTransaction({
      outputPath: output,
      project,
      runtimeModules: new Set(["velar/fs"]),
      claimedFiles: [output, sidecar],
      cleanupFiles: [],
      generatedSiblingFiles: [],
      additionalInputs: [],
      observeClaimedStaging: async (staging, evidence) => {
        observed = true;
        for (const [path, kind] of [
          [output, "file"],
          [sidecar, "file"],
          [join(dirname(output), "node_modules", "velar"), "tree"],
          [staging, "tree"],
          [evidence, "file"],
        ] as const) {
          await assert.rejects(acquireBuildOutputClaim(path, kind), /overlaps active/u);
        }
        await assert.rejects(lstat(staging), (error: unknown) => isErrorCode(error, "ENOENT"));
        await assert.rejects(lstat(evidence), (error: unknown) => isErrorCode(error, "ENOENT"));
        throw new Error("deliberate pre-staging stop");
      },
      writeStaged: async () => {
        assert.fail("staging writer must not run after the reservation observer stops the transaction");
      },
    }), /deliberate pre-staging stop/u);
    assert.equal(observed, true);
    assert.equal(await readFile(output, "utf8"), previous);

    for (const collisionKind of ["staging", "evidence"] as const) {
      let collision = "";
      await assert.rejects(writeStandaloneOutputTransaction({
        outputPath: output, project, claimedFiles: [output, sidecar], cleanupFiles: [],
        generatedSiblingFiles: [], additionalInputs: [], runtimeModules: new Set(["velar/fs"]),
        observeClaimedStaging: async (staging, evidence) => {
          collision = collisionKind === "staging" ? join(staging, "thesis.txt") : evidence;
          await write(collision, `${collisionKind} author data\n`);
        },
        writeStaged: async () => assert.fail("a collided transaction must not render output"),
      }), (error: unknown) => isErrorCode(error, "EEXIST"));
      assert.equal(await readFile(collision, "utf8"), `${collisionKind} author data\n`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone claim rejection leaves every missing output parent absent", async () => {
  const root = await temporaryRoot("velar-standalone-claim-before-parent");
  const outputRoot = join(root, "uncreated", "dist");
  const output = join(outputRoot, "main.js");
  await write(join(root, "main.vel"), 'print("unused")\n');
  const blocker = await acquireBuildOutputClaim(output, "file");
  try {
    const built = runCli(root, "build", "main.vel", "--out", output);
    assert.equal(built.status, 1, built.stdout + built.stderr);
    assert.match(built.stderr, /overlaps active file output/u);
    await assert.rejects(lstat(outputRoot), (error: unknown) => isErrorCode(error, "ENOENT"));
    await assert.rejects(lstat(join(root, "uncreated")), (error: unknown) => isErrorCode(error, "ENOENT"));
  } finally {
    await blocker.release();
    await rm(root, { recursive: true, force: true });
  }
});

test("a runtime-free standalone output does not remove another output's runtime", async () => {
  const root = await temporaryRoot("velar-standalone-runtime-two-outputs");
  try {
    const outputRoot = join(root, "dist");
    const firstOutput = join(outputRoot, "a.js");
    const secondOutput = join(outputRoot, "b.js");
    await write(join(root, "a.vel"), 'import {readText} from "velar/fs"\nconst reader = readText\nprint("a")\n');
    await write(join(root, "b.vel"), 'print("b")\n');

    const first = runCli(root, "build", "a.vel", "--out", firstOutput);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const second = runCli(root, "build", "b.vel", "--out", secondOutput);
    assert.equal(second.status, 0, second.stdout + second.stderr);

    const runtimeManifest = JSON.parse(await readFile(
      join(outputRoot, "node_modules", "velar", "package.json"), "utf8",
    )) as Record<string, unknown>;
    assert.equal(runtimeManifest.velarStandaloneOwner, "a.js");
    assertProgramOutput(firstOutput, "a\n");
    assertProgramOutput(secondOutput, "b\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone runtime dependencies stay inside their owner's package tree", async () => {
  const root = await temporaryRoot("velar-standalone-runtime-dependency");
  try {
    const output = join(root, "dist", "main.js");
    await write(join(root, "main.vel"), 'import {listen} from "velar/websocket"\nconst open = listen\nprint("nested")\n');
    const built = runCli(root, "build", "main.vel", "--out", output);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const dependency = JSON.parse(await readFile(
      join(root, "dist", "node_modules", "velar", "node_modules", "ws", "package.json"), "utf8",
    )) as Record<string, unknown>;
    assert.equal(dependency.name, "ws");
    await assert.rejects(lstat(join(root, "dist", "node_modules", "ws")), (error: unknown) => isErrorCode(error, "ENOENT"));
    assertProgramOutput(output, "nested\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone Server runtime resolves its nested YAML dependency", async () => {
  const root = await temporaryRoot("velar-standalone-server-dependency");
  try {
    const project = join(root, "service");
    const created = runCli(root, "create", project, "--template", "node");
    assert.equal(created.status, 0, created.stdout + created.stderr);
    await write(join(project, "src", "main.vel"), [
      'import {applicationConfigurationPath} from "velar/server"',
      "const configurationPath = applicationConfigurationPath",
      "@main:",
      '    print("server")',
      "",
    ].join("\n"));
    const output = join(project, "standalone", "main.js");
    const built = runCli(project, "build", "src/main.vel", "--out", output);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const dependency = JSON.parse(await readFile(
      join(project, "standalone", "node_modules", "velar", "node_modules", "yaml", "package.json"), "utf8",
    )) as Record<string, unknown>;
    assert.equal(dependency.name, "yaml");
    await assert.rejects(lstat(join(project, "standalone", "node_modules", "yaml")), (error: unknown) => isErrorCode(error, "ENOENT"));
    assertProgramOutput(output, "server\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("different standalone runtime owners cannot replace each other's closure", async () => {
  const root = await temporaryRoot("velar-standalone-runtime-owner-conflict");
  try {
    const outputRoot = join(root, "dist");
    const firstOutput = join(outputRoot, "a.js");
    const secondOutput = join(outputRoot, "b.js");
    await write(join(root, "a.vel"), 'import {readText} from "velar/fs"\nconst reader = readText\nprint("a")\n');
    await write(join(root, "b.vel"), 'import {sha256Text} from "velar/hash"\nprint(sha256Text("b"))\n');
    const first = runCli(root, "build", "a.vel", "--out", firstOutput);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    await write(secondOutput, "author b\n");
    const beforeManifest = await readFile(join(outputRoot, "node_modules", "velar", "package.json"), "utf8");
    const beforeFs = await readFile(join(outputRoot, "node_modules", "velar", "fs.js"), "utf8");

    const second = runCli(root, "build", "b.vel", "--out", secondOutput);
    assert.equal(second.status, 1, second.stdout + second.stderr);
    assert.match(second.stderr, /owned by standalone output 'a\.js'.*separate output directory/u);
    assert.equal(await readFile(secondOutput, "utf8"), "author b\n");
    assert.equal(await readFile(join(outputRoot, "node_modules", "velar", "package.json"), "utf8"), beforeManifest);
    assert.equal(await readFile(join(outputRoot, "node_modules", "velar", "fs.js"), "utf8"), beforeFs);
    assertProgramOutput(firstOutput, "a\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the same standalone owner removes its obsolete runtime closure", async () => {
  const root = await temporaryRoot("velar-standalone-runtime-owner-cleanup");
  try {
    const output = join(root, "dist", "main.js");
    const runtimeRoot = join(root, "dist", "node_modules", "velar");
    await write(join(root, "main.vel"), 'import {readText} from "velar/fs"\nconst reader = readText\nprint("runtime")\n');
    const first = runCli(root, "build", "main.vel", "--out", output);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.equal((await lstat(runtimeRoot)).isDirectory(), true);

    await write(join(root, "main.vel"), 'print("clean")\n');
    const second = runCli(root, "build", "main.vel", "--out", output);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    await assert.rejects(lstat(runtimeRoot), (error: unknown) => isErrorCode(error, "ENOENT"));
    assertProgramOutput(output, "clean\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a killed standalone install is recovered before the next build", { timeout: 120_000 }, async () => {
  const root = await temporaryRoot("velar-standalone-kill-recovery");
  let child: ChildProcess | null = null;
  try {
    const outputRoot = join(root, "dist");
    const output = join(outputRoot, "main.js");
    const blocks = Array.from({ length: 256 }, (_, index) => [
      "extern js()`",
      `export const value${index} = ${index}`,
      "`:",
      `    export const value${index}: number`,
      "",
    ].join("\n"));
    await write(join(root, "main.vel"), `import {readText} from "velar/fs"\nconst reader = readText\n\n${blocks.join("\n")}\nprint(value255)\n`);
    await write(output, "old JavaScript\n");
    child = spawn(process.execPath, [cliPath, "build", "main.vel", "--out", output, "--source-maps"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForPartialStandaloneInstall(outputRoot, child);
    assert.equal(child.kill("SIGKILL"), true);
    await new Promise<void>((resolveExit) => child!.once("exit", () => resolveExit()));
    child = null;

    const transactionNames = (await readdir(outputRoot, { withFileTypes: true }))
      .filter((entry) => entry.name.startsWith(".velar-main.js-") && entry.isDirectory())
      .map((entry) => entry.name);
    assert.equal(transactionNames.length, 1, JSON.stringify(transactionNames));
    const external = join(root, "external-runtime");
    await mkdir(external, { recursive: true });
    await rm(join(outputRoot, "node_modules"), { recursive: true, force: true });
    await symlink(external, join(outputRoot, "node_modules"), "dir");
    const blocked = runCli(root, "build", "main.vel", "--out", output, "--source-maps");
    assert.equal(blocked.status, 1, blocked.stdout + blocked.stderr);
    assert.match(blocked.stderr, /output target .* escapes its transaction root/u);
    assert.equal((await readdir(outputRoot)).includes(transactionNames[0]!), true, "unsafe recovery must retain its journal");
    assert.deepEqual(await readdir(external), []);
    await rm(join(outputRoot, "node_modules"), { force: true });

    const recovered = runCli(root, "build", "main.vel", "--out", output, "--source-maps");
    assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
    const executed = spawnSync(process.execPath, [output], { encoding: "utf8", timeout: 120_000 });
    assert.equal(executed.status, 0, String(executed.stderr));
    assert.equal(executed.stdout, "255\n");
    assert.equal((await readdir(outputRoot)).some((name) => name.startsWith(".velar-main.js-")), false);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});

test("Node build refuses an output directory containing its Server configuration", async () => {
  const root = await temporaryRoot("velar-server-config-output");
  try {
    const project = join(root, "service");
    const created = runCli(root, "create", project, "--template", "node");
    assert.equal(created.status, 0, created.stdout + created.stderr);
    const manifestPath = join(project, "velar.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.server = { configuration: "dist/application.yml" };
    await write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const configuration = "server:\n  host: 127.0.0.1\n  port: 3000\n";
    await write(join(project, "dist", "application.yml"), configuration);

    const built = runCli(root, "build", project);
    assert.equal(built.status, 1, built.stdout + built.stderr);
    assert.match(built.stderr, /contains checked input .*dist\/application\.yml/u);
    assert.equal(await readFile(join(project, "dist", "application.yml"), "utf8"), configuration);

    const external = join(root, "external-configuration");
    await write(join(external, "application.yml"), configuration);
    await symlink(external, join(project, "config"), "dir");
    manifest.server = { configuration: "config/application.yml" };
    await write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const escaped = runCli(root, "build", project);
    assert.equal(escaped.status, 1, escaped.stdout + escaped.stderr);
    assert.match(escaped.stderr, /escapes the project root through a symbolic link/u);
    assert.equal(await readFile(join(external, "application.yml"), "utf8"), configuration);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone runtime claims cannot follow an output ancestor symlink", async () => {
  const root = await temporaryRoot("velar-standalone-runtime-alias");
  try {
    const outputRoot = join(root, "dist");
    const output = join(outputRoot, "main.js");
    const external = join(root, "external-node-modules");
    await write(join(root, "main.vel"), 'import {readText} from "velar/fs"\nconst reader = readText\nprint("new")\n');
    await write(output, "old JavaScript\n");
    await mkdir(external, { recursive: true });
    await symlink(external, join(outputRoot, "node_modules"), "dir");

    const built = runCli(root, "build", "main.vel", "--out", output);
    assert.equal(built.status, 1, built.stdout + built.stderr);
    assert.match(built.stderr, /output target .* escapes its transaction root/u);
    assert.equal(await readFile(output, "utf8"), "old JavaScript\n");
    assert.deepEqual(await readdir(external), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a normal standalone single-file build still emits and runs", async () => {
  const root = await temporaryRoot("velar-standalone-success");
  try {
    const output = join(root, "dist", "main.js");
    await write(join(root, "main.vel"), 'print("standalone-ok")\n');
    const built = runCli(root, "build", "main.vel", "--out", output, "--source-maps");
    assert.equal(built.status, 0, built.stdout + built.stderr);
    assert.match(await readFile(output, "utf8"), /sourceMappingURL=main\.js\.map/u);
    JSON.parse(await readFile(`${output}.map`, "utf8"));
    const executed = spawnSync(process.execPath, [output], { encoding: "utf8", timeout: 120_000 });
    assert.equal(executed.status, 0, String(executed.stderr));
    assert.equal(executed.stdout, "standalone-ok\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function waitForPartialStandaloneInstall(outputRoot: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const names = await readdir(outputRoot).catch(() => [] as string[]);
    if (names.some((name) => name.includes(".embedded-") && name.endsWith(".js"))) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`standalone build exited before it could be interrupted (${child.exitCode ?? child.signalCode})`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
  }
  throw new Error("standalone build did not enter its installation phase");
}
