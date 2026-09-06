import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import {link, mkdir, mkdtemp, readFile, rename, rm, truncate, writeFile} from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {
  generatedRuntimePackageOwnership,
  VELAR_GENERATED_RUNTIME_PACKAGE_VERSION,
  writeGeneratedRuntimePackageReceipt,
} from "../packages/cli/src/generated-runtime-package.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repositoryRoot, "packages", "cli", "src", "cli.ts");

test("runtime ownership refuses a package root replaced after its identity was inspected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-runtime-owner-swap-"));
  const root = join(directory, "node_modules", "fixture-runtime");
  const replacement = join(directory, "replacement");
  const retired = join(directory, "retired");
  const manifest = `${JSON.stringify({
    name: "fixture-runtime",
    private: true,
    type: "module",
    velarGeneratedRuntime: VELAR_GENERATED_RUNTIME_PACKAGE_VERSION,
    velarStandaloneOwner: "main.js",
  })}\n`;
  await mkdir(root, {recursive: true});
  await mkdir(replacement, {recursive: true});
  await writeFile(join(root, "package.json"), manifest, "utf8");
  // Keep the manifest identity equal so only the package-root identity can
  // distinguish the replacement directory.
  await link(join(root, "package.json"), join(replacement, "package.json"));
  await writeFile(join(replacement, "foreign.js"), "export const foreign = true\n", "utf8");

  const originalLstat = fs.promises.lstat;
  let swapped = false;
  fs.promises.lstat = (async (...arguments_: Parameters<typeof originalLstat>) => {
    const metadata = await originalLstat(...arguments_);
    if (!swapped && resolve(String(arguments_[0])) === resolve(root)) {
      swapped = true;
      await rename(root, retired);
      await rename(replacement, root);
    }
    return metadata;
  }) as typeof fs.promises.lstat;
  syncBuiltinESMExports();
  try {
    assert.deepEqual(
      await generatedRuntimePackageOwnership(root, "fixture-runtime"),
      {kind: "foreign"},
    );
    assert.equal(swapped, true);
  } finally {
    fs.promises.lstat = originalLstat;
    syncBuiltinESMExports();
    await rm(directory, {recursive: true, force: true});
  }
});

test("standalone rebuild refuses added or modified bytes in its generated runtime package", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-runtime-content-receipt-"));
  try {
    const source = join(root, "main.vel");
    const output = join(root, "dist", "main.js");
    const runtime = join(root, "dist", "node_modules", "velar");
    await writeFile(source, [
      'import {readText} from "velar/fs"',
      "const reader = readText",
      'print("runtime-ready")',
      "",
    ].join("\n"), "utf8");
    const first = runCli(root, "build", source, "--out", output);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const outputBefore = await readFile(output);

    const author = join(runtime, "author.js");
    await writeFile(author, "export const author = true\n", "utf8");
    const added = runCli(root, "build", source, "--out", output);
    assert.equal(added.status, 1, added.stdout + added.stderr);
    assert.match(added.stderr, /Refusing to replace non-generated package/u);
    assert.deepEqual(await readFile(output), outputBefore);
    assert.equal(await readFile(author, "utf8"), "export const author = true\n");

    await rm(author);
    const modulePath = join(runtime, "fs.js");
    const modifiedModule = `${await readFile(modulePath, "utf8")}\nexport const authorMutation = true\n`;
    await writeFile(modulePath, modifiedModule, "utf8");
    const modified = runCli(root, "build", source, "--out", output);
    assert.equal(modified.status, 1, modified.stdout + modified.stderr);
    assert.match(modified.stderr, /Refusing to replace non-generated package/u);
    assert.deepEqual(await readFile(output), outputBefore);
    assert.equal(await readFile(modulePath, "utf8"), modifiedModule);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("standalone runtime ownership bounds receipt and package bytes before replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-runtime-content-limits-"));
  try {
    const source = join(root, "main.vel");
    const output = join(root, "dist", "main.js");
    const runtime = join(root, "dist", "node_modules", "velar");
    await writeFile(source, 'import {readText} from "velar/fs"\nconst reader = readText\nprint("ready")\n', "utf8");
    const first = runCli(root, "build", source, "--out", output);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const outputBefore = await readFile(output);

    const receipt = join(runtime, ".velar-runtime-package.json");
    const receiptBefore = await readFile(receipt);
    await truncate(receipt, 8 * 1024 * 1024 + 1);
    const oversizedReceipt = runCli(root, "build", source, "--out", output);
    assert.equal(oversizedReceipt.status, 1, oversizedReceipt.stdout + oversizedReceipt.stderr);
    assert.match(oversizedReceipt.stderr, /receipt .* exceeds 8388608 bytes/u);
    assert.deepEqual(await readFile(output), outputBefore);

    await writeFile(receipt, receiptBefore);
    const oversizedMember = join(runtime, "author.bin");
    await writeFile(oversizedMember, "", "utf8");
    await truncate(oversizedMember, 64 * 1024 * 1024 + 1);
    const oversizedTree = runCli(root, "build", source, "--out", output);
    assert.equal(oversizedTree.status, 1, oversizedTree.stdout + oversizedTree.stderr);
    assert.match(oversizedTree.stderr, /file .* exceeds its byte boundary/u);
    assert.deepEqual(await readFile(output), outputBefore);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("runtime ownership refuses a file added after its root snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-runtime-owner-addition-"));
  const root = join(directory, "fixture-runtime");
  await mkdir(root);
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "fixture-runtime",
    private: true,
    type: "module",
    velarGeneratedRuntime: VELAR_GENERATED_RUNTIME_PACKAGE_VERSION,
    velarStandaloneOwner: "main.js",
  })}\n`, "utf8");
  await writeFile(join(root, "runtime.js"), "export const ready = true\n", "utf8");
  await writeGeneratedRuntimePackageReceipt(root, "fixture-runtime", "main.js");

  const originalLstat = fs.promises.lstat;
  let added = false;
  fs.promises.lstat = (async (...arguments_: Parameters<typeof originalLstat>) => {
    const metadata = await originalLstat(...arguments_);
    if (!added && resolve(String(arguments_[0])) === resolve(root)) {
      added = true;
      await writeFile(join(root, "author.js"), "author bytes\n", "utf8");
    }
    return metadata;
  }) as typeof fs.promises.lstat;
  syncBuiltinESMExports();
  try {
    assert.deepEqual(await generatedRuntimePackageOwnership(root, "fixture-runtime"), {kind: "foreign"});
    assert.equal(await readFile(join(root, "author.js"), "utf8"), "author bytes\n");
  } finally {
    fs.promises.lstat = originalLstat;
    syncBuiltinESMExports();
    await rm(directory, {recursive: true, force: true});
  }
});

function runCli(cwd: string, ...arguments_: readonly string[]): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = spawnSync(process.execPath, [cli, ...arguments_], {cwd, encoding: "utf8", timeout: 120_000});
  return {status: result.status, stdout: String(result.stdout), stderr: String(result.stderr)};
}
