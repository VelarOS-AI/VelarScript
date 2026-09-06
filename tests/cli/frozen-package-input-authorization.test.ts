import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, readFile, readdir, realpath, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import {
  prepareFrozenPackageBuildPlan,
  writeFrozenPackageBuildPlan,
} from "../../packages/cli/src/frozen-package-output.ts";
import { byCodeUnit } from "../../packages/cli/src/stable-order.ts";
import type { VelarSourcePackage } from "../../packages/cli/src/project.ts";
import {
  cliPath,
  createFrozenCompilerRuntimeLibrary,
  createGenericFrozenRuntimeConsumer,
  frozenRuntimePackageName,
  linkFrozenCompilerRuntimeLibrary,
  prependFrozenArtifactJavaScript,
  runCli,
} from "../support/frozen-artifact.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

test("frozen output preflight authorizes actual inputs before output exists and materializes the same graph", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-input-authorization-");
  const packageRoot = join(root, "package");
  const dependencyRoot = join(packageRoot, "node_modules", "visible-dep");
  const outputRoot = join(root, "output");
  const entryPath = join(packageRoot, "dist", "index.js");
  const sourceMapPath = `${entryPath}.map`;
  await Promise.all([
    mkdir(join(packageRoot, "dist"), { recursive: true }),
    mkdir(dependencyRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "authorization-fixture",
      version: "1.0.0",
      type: "module",
      dependencies: { "visible-dep": "1.0.0" },
    }), "utf8"),
    writeFile(join(dependencyRoot, "package.json"), JSON.stringify({
      name: "visible-dep",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }), "utf8"),
    writeFile(join(dependencyRoot, "index.js"), "export const value = 1;\n", "utf8"),
  ]);
  const code = 'import {value} from "visible-dep";\nexport const result = value;\n';
  const snapshot = { path: entryPath, code, sourceMapPath, sourceMap: "{}\n" };
  const package_ = {
    name: "authorization-fixture",
    root: packageRoot,
    artifacts: new Map([[".", {
      subpath: ".",
      entryPath,
      receiptPath: join(packageRoot, "dist", "velar-library.json"),
      entrySnapshot: snapshot,
      entrySnapshots: [snapshot],
      chunkSnapshots: [],
    }]]),
  } as unknown as VelarSourcePackage;
  let inputs: readonly string[] = [];

  await assert.rejects(
    prepareFrozenPackageBuildPlan(
      [package_],
      outputRoot,
      new Set(),
      "readable",
      false,
      new Set(),
      async (actualInputs) => {
        inputs = actualInputs;
        throw new Error("input boundary refused the build");
      },
    ),
    /input boundary refused the build/u,
  );
  assert.ok(inputs.includes(await realpath(join(dependencyRoot, "index.js"))));
  await assert.rejects(
    readFile(join(outputRoot, "node_modules", package_.name, "dist", "index.js"), "utf8"),
    { code: "ENOENT" },
  );
  await assert.rejects(
    readFile(join(outputRoot, "node_modules", ".velar-artifact-chunks", "package.json"), "utf8"),
    { code: "ENOENT" },
  );

  const plan = await prepareFrozenPackageBuildPlan(
    [package_],
    outputRoot,
    new Set(),
    "readable",
    false,
    new Set(),
  );
  await writeFile(join(dependencyRoot, "index.js"), "export const value = 999;\n", "utf8");
  await writeFrozenPackageBuildPlan(plan, outputRoot);
  const output = await readFile(join(outputRoot, "node_modules", package_.name, "dist", "index.js"), "utf8");
  assert.match(output, /value = 1/u);
  assert.doesNotMatch(output, /999/u);
});

test("generic and Node builds reject an actual frozen input before touching transaction or target paths", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-directory-preflight-");
  const library = await createFrozenCompilerRuntimeLibrary(root);
  const dependencyRoot = join(library, "node_modules", "preflight-visible-dep");
  await mkdir(dependencyRoot, { recursive: true });
  const libraryManifestPath = join(library, "package.json");
  const libraryManifest = JSON.parse(await readFile(libraryManifestPath, "utf8")) as Record<string, unknown>;
  libraryManifest.dependencies = { "preflight-visible-dep": "1.0.0" };
  await Promise.all([
    writeFile(libraryManifestPath, `${JSON.stringify(libraryManifest, null, 2)}\n`, "utf8"),
    writeFile(join(dependencyRoot, "package.json"), `${JSON.stringify({
      name: "preflight-visible-dep",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }, null, 2)}\n`, "utf8"),
  ]);
  await prependFrozenArtifactJavaScript(library, [
    'import {preflightValue as __preflightValue} from "preflight-visible-dep";',
    "void __preflightValue;",
  ].join("\n"));

  const generic = await createGenericFrozenRuntimeConsumer(root, library);
  const node = join(root, "node-consumer");
  const created = runCli(["create", node, "--template", "node"], root);
  assert.equal(created.status, 0, `${created.stdout}${created.stderr}`);
  await linkFrozenCompilerRuntimeLibrary(node, library);
  await writeFile(join(node, "src", "main.vel"), [
    `import {artifactLabel} from ${JSON.stringify(frozenRuntimePackageName)}`,
    "@main: print(artifactLabel())",
    "",
  ].join("\n"), "utf8");

  for (const consumer of [generic, node]) {
    const output = join(consumer, "dist");
    const hidden = join(output, "node_modules", "preflight-hidden-input");
    await mkdir(hidden, { recursive: true });
    await Promise.all([
      writeFile(join(hidden, "package.json"), `${JSON.stringify({
        name: "preflight-hidden-input",
        version: "1.0.0",
        type: "module",
      }, null, 2)}\n`, "utf8"),
      writeFile(join(hidden, "index.js"), 'export const preflightValue = "must-survive";\n', "utf8"),
    ]);
    const dependencyEntry = join(dependencyRoot, "index.js");
    await unlink(dependencyEntry).catch(() => {});
    await symlink(join(hidden, "index.js"), dependencyEntry, "file");
    const before = await snapshotDirectory(output);
    const beforeIdentity = await directoryIdentity(output);
    const observed: string[] = [];
    const watcher = watch(consumer, (_event, filename) => {
      if (filename !== null) observed.push(filename.toString());
    });
    const rejected = await runCliAsync(["build"], consumer);
    await new Promise<void>((resolve) => setImmediate(resolve));
    watcher.close();

    assert.equal(rejected.status, 1, `${rejected.stdout}${rejected.stderr}`);
    assert.match(
      rejected.stderr,
      /refusing to replace .*dist.*contains checked input .*preflight-hidden-input\/index\.js/u,
    );
    assert.deepEqual(await snapshotDirectory(output), before, "the final output must remain byte-for-byte unchanged");
    assert.deepEqual(await directoryIdentity(output), beforeIdentity, "the final output directory must not be renamed or mutated");
    assert.deepEqual(
      (await readdir(consumer)).filter((name) => name.startsWith(".velar-dist-")),
      [],
      "input refusal must leave no staging or transaction evidence path",
    );
    assert.deepEqual(
      observed.filter((name) => name.startsWith(".velar-dist-")),
      [],
      "input refusal must happen before staging, transaction evidence, or recovery",
    );
  }
});

async function runCliAsync(
  arguments_: readonly string[],
  cwd: string,
): Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string }> {
  const child = spawn(process.execPath, [cliPath, ...arguments_], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const status = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { status, stdout, stderr };
}

async function directoryIdentity(path: string): Promise<Record<string, bigint>> {
  const metadata = await stat(path, { bigint: true });
  return {
    inode: metadata.ino,
    modified: metadata.mtimeNs,
    changed: metadata.ctimeNs,
    born: metadata.birthtimeNs,
  };
}

async function snapshotDirectory(
  root: string,
): Promise<readonly { readonly path: string; readonly kind: "directory" | "file"; readonly bytes?: string }[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return Promise.all(entries.map(async (entry) => {
    const path = join(entry.parentPath, entry.name);
    if (entry.isDirectory()) return { path: path.slice(root.length + 1), kind: "directory" as const };
    assert.equal(entry.isFile(), true, `unexpected target entry '${path}'`);
    return {
      path: path.slice(root.length + 1),
      kind: "file" as const,
      bytes: (await readFile(path)).toString("base64"),
    };
  })).then((snapshot) => snapshot.sort((left, right) => byCodeUnit(left.path, right.path)));
}
