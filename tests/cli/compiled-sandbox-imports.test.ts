import assert from "node:assert/strict";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { resolveVelarProject } from "../../packages/cli/src/config.ts";
import { compileBrowserTest, installBrowserCompilerRuntime, writeBrowserTestEntry } from "../../packages/cli/src/browser-test/entry.ts";
import { requiredCompilerRuntimeModules } from "../../packages/cli/src/compiler-runtime-modules.ts";
import { createPackageImportSnapshotBudget, MAX_PACKAGE_IMPORT_COPY_FILES, MAX_PACKAGE_IMPORT_COPY_TOTAL_BYTES, snapshotPackageImportTargets } from "../../packages/cli/src/package-import-sandbox.ts";
import { createSourcePackageImportSnapshots } from "../../packages/cli/src/source-package-imports.ts";
import { privateImportsBrowserProject } from "../support/private-imports-project.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

async function compiled(nativeTarget?: string) {
  const root = await privateImportsBrowserProject(nativeTarget);
  const config = await resolveVelarProject(root);
  const entry = await compileBrowserTest(join(root, "src/app.browser.test.vel"), config);
  assert.ok(entry);
  return {root, config, entry, runtime: requiredCompilerRuntimeModules(entry.project)};
}

test("browser entry materialization captures project and source-package imports before writing", async () => {
  const {root, config, entry, runtime} = await compiled();
  const output = await makeTemporaryDirectory("velar-browser-import-output-");
  const installed = await installBrowserCompilerRuntime(output, config, runtime, [entry]);
  try {
    // Materialization consumes the captured bytes, not a later author-file read.
    await writeFile(join(root, "native/detail.mjs"), 'throw Error("later edit");\n');
    await writeBrowserTestEntry(entry, output, config, runtime, installed.plans.get(entry));
    for (const name of ["project", "first", "second"]) {
      const owner = name === "project" ? output : join(output, "node_modules", name);
      const manifest = JSON.parse(await readFile(join(owner, "package.json"), "utf8"));
      assert.equal(manifest.imports["#native"], "./native/adapter.mjs");
      assert.equal(manifest.imports["#suffix"], "./native/suffix.mjs");
      assert.equal(await readFile(join(owner, "native/detail.mjs"), "utf8"), `export const label=${JSON.stringify(name)};\n`);
    }
    for (const name of ["first", "second"]) await assert.rejects(access(join(root, "node_modules", name, ".velar")), /ENOENT/u);
  } finally { installed.resolver.deregister(); }
});

test("browser root native-output collisions reject the plan before runtime or project writes", async () => {
  const {config, entry, runtime} = await compiled("./src/bridge.js");
  const output = await makeTemporaryDirectory("velar-browser-import-collision-");
  await assert.rejects(installBrowserCompilerRuntime(output, config, runtime, [entry]), /Project private import .* conflicts with compiled module/u);
  assert.deepEqual(await readdir(output), []);
});

test("browser plans share captured owner bytes across their separately compiled test entries", async () => {
  const {config, entry, runtime} = await compiled();
  const second = await compileBrowserTest(entry.file, config);
  assert.ok(second);
  const output = await makeTemporaryDirectory("velar-browser-shared-snapshot-");
  const installed = await installBrowserCompilerRuntime(output, config, runtime, [entry, second]);
  try {
    const firstFiles = installed.plans.get(entry)!.sourceImports.files;
    const secondFiles = installed.plans.get(second)!.sourceImports.files;
    assert.equal(firstFiles.length, 9);
    assert.equal(secondFiles.length, firstFiles.length);
    for (const [index, file] of firstFiles.entries()) assert.equal(secondFiles[index]!.contents, file.contents);
  } finally { installed.resolver.deregister(); }
});

test("later browser entry collisions fail the whole plan before installing runtime files", async () => {
  const first = await compiled();
  const second = await compiled("./src/bridge.js");
  const output = await makeTemporaryDirectory("velar-browser-later-collision-");
  await assert.rejects(installBrowserCompilerRuntime(output, first.config, first.runtime, [first.entry, second.entry]), /Project private import .* conflicts with compiled module/u);
  assert.deepEqual(await readdir(output), []);
});

test("source owners and compiler runtimes participate in the same browser output preflight", async () => {
  for (const target of ["./src/index.js", "./node_modules/velar/test.js", "./package.json"]) {
    const {root, config, entry, runtime} = await compiled();
    const sourceOwner = target === "./src/index.js";
    const owner = sourceOwner ? join(root, "node_modules/first") : root;
    const manifest = JSON.parse(await readFile(join(owner, "package.json"), "utf8"));
    manifest.imports["#native"] = target;
    await writeFile(join(owner, "package.json"), JSON.stringify(manifest));
    if (target !== "./package.json") {
      await mkdir(join(owner, target, ".."), {recursive: true});
      await writeFile(join(owner, target), 'export const nativeLabel="collision";\n');
    }
    const output = await makeTemporaryDirectory("velar-browser-owner-collision-");
    await assert.rejects(installBrowserCompilerRuntime(output, config, runtime, [entry]), /private import .* conflicts with (compiled module|Standard runtime module|sandbox package manifest)/u);
    assert.deepEqual(await readdir(output), []);
  }
});

test("package import snapshot costs remain shared across separate owners", async () => {
  const root = await makeTemporaryDirectory("velar-shared-import-budget-");
  for (const name of ["first", "second"]) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, "index.mjs"), 'export const value="ok";\n');
  }
  const budget = createPackageImportSnapshotBudget();
  budget.files = MAX_PACKAGE_IMPORT_COPY_FILES - 1;
  await snapshotPackageImportTargets(join(root, "first"), {"#native": "./index.mjs"}, budget);
  await assert.rejects(snapshotPackageImportTargets(join(root, "second"), {"#native": "./index.mjs"}, budget), /file graph exceeds 4096 files/u);
  const bytesBudget = createPackageImportSnapshotBudget();
  bytesBudget.bytes = MAX_PACKAGE_IMPORT_COPY_TOTAL_BYTES - Buffer.byteLength('export const value="ok";\n');
  await snapshotPackageImportTargets(join(root, "first"), {"#native": "./index.mjs"}, bytesBudget);
  await assert.rejects(snapshotPackageImportTargets(join(root, "second"), {"#native": "./index.mjs"}, bytesBudget), /file graph exceeds .* bytes/u);
  const syntaxBudget = createPackageImportSnapshotBudget();
  await snapshotPackageImportTargets(join(root, "first"), {"#native": "./index.mjs"}, syntaxBudget);
  syntaxBudget.modules.remainingTokens = 0;
  await assert.rejects(snapshotPackageImportTargets(join(root, "second"), {"#native": "./index.mjs"}, syntaxBudget), /parse complexity limit/u);
});

test("multi-entry owner cache charges candidate files once and shares the plan ceiling", async () => {
  const root = await makeTemporaryDirectory("velar-import-plan-budget-");
  for (const name of ["first", "second"]) {
    const owner = join(root, name);
    await mkdir(owner);
    const imports = Object.fromEntries(Array.from({length: 2050}, (_, index) => [`#native${index}`, `./missing-${index}.mjs`]));
    await writeFile(join(owner, "package.json"), JSON.stringify({imports}));
  }
  const snapshots = createSourcePackageImportSnapshots();
  const first = await snapshots.owner(join(root, "first"));
  assert.equal(await snapshots.owner(join(root, "first")), first);
  await assert.rejects(snapshots.owner(join(root, "second")), /file graph exceeds 4096 files/u);
});
