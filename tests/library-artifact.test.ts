import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { classApplicationType, genericApplicationType, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { decodeVelarLibraryInterface, encodeVelarLibraryInterface } from "../packages/cli/src/library-artifact.ts";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = new URL("../packages/cli/src/cli.ts", import.meta.url).pathname;

function runCli(arguments_: readonly string[], cwd: string): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("a frozen library runs and type-checks without reading its previous-generation Vel source", async () => {
  const root = await makeTemporaryDirectory("velar-library-artifact-");
  const library = join(root, "library");
  const consumer = join(root, "consumer");
  await mkdir(join(library, "src"), { recursive: true });
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await writeFile(join(library, "package.json"), `${JSON.stringify({
    name: "frozen-fixture",
    version: "1.2.3",
    type: "module",
    files: ["src", "dist"],
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core", "node", "web", "desktop"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(library, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(library, "src", "index.vel"), [
    "export type Sum:",
    "    value: number",
    "",
    "export def add(left: number, right: number) -> Sum:",
    "    return {value: left + right}",
    "",
  ].join("\n"), "utf8");

  const built = runCli(["build-library", library], root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  assert.match(built.stdout, /Built Velar library ABI 1 frozen-fixture@1\.2\.3 \(core\)/u);
  assert.doesNotMatch(await readFile(join(library, "dist", "index.js"), "utf8"), /function add/u);
  const readable = runCli(["build-library", library, "--mode", "readable"], root);
  assert.equal(readable.status, 0, `${readable.stdout}${readable.stderr}`);
  assert.match(await readFile(join(library, "dist", "index.js"), "utf8"), /function add/u);
  const receipt = JSON.parse(await readFile(join(library, "dist", "velar-library.json"), "utf8")) as {
    formatVersion: number;
    abiVersion: number;
    sourceEntry: string;
    entry: { javascript: string; interface: string; sourceMap: string };
    entries?: unknown;
  };
  assert.deepEqual(Object.keys(receipt), [
    "formatVersion", "kind", "abiVersion", "package", "target", "compilerVersion", "sourceEntry", "sources", "entry",
  ]);
  assert.equal(receipt.formatVersion, 1);
  assert.equal(receipt.abiVersion, 1);
  assert.equal(receipt.entries, undefined);
  assert.equal(receipt.sourceEntry, "src/index.vel");
  assert.equal(receipt.entry.javascript, "index.js");
  assert.equal(receipt.entry.sourceMap, "index.js.map");
  assert.equal(receipt.entry.interface, "index.veli.json");

  await symlink(library, join(consumer, "node_modules", "frozen-fixture"), "dir");
  await writeFile(join(consumer, "main.vel"), [
    'import {add} from "frozen-fixture"',
    "",
    "const sum = add(2, 3)",
    "print(sum.value)",
    "",
  ].join("\n"), "utf8");

  // The source is now both syntactically obsolete and declared for another
  // language generation. Artifact mode must never parse or reject it.
  const manifest = JSON.parse(await readFile(join(library, "package.json"), "utf8")) as {
    type: string;
    velar: { entries?: Record<string, string>; requires: { language?: string } };
  };
  manifest.velar.requires.language = "0.1";
  await writeFile(join(library, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(library, "src", "index.vel"), "export def add():\n    with old_runtime() as value:\n        return value\n", "utf8");

  const checked = await compileProject(join(consumer, "main.vel"), new Map(), { projectRoot: consumer });
  assert.deepEqual(checked.failures, []);
  assert.equal(checked.modules.length, 1, "the installed package source must not join the consumer module graph");
  assert.equal(checked.velarPackages[0]?.artifacts.get(".")?.abiVersion, 1);
  assert.equal(checked.modules[0]?.result.diagnostics.length, 0);
  const webChecked = await compileProject(join(consumer, "main.vel"), new Map(), {
    projectRoot: consumer,
    extensions: [velarCompilerExtension],
  });
  assert.deepEqual(webChecked.failures, [], "a target-neutral Core artifact is admissible to a declared Web target");
  assert.equal(webChecked.velarPackages[0]?.artifacts.get(".")?.target, "core");

  const ran = runCli(["run", join(consumer, "main.vel")], consumer);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(ran.stdout.trim(), "5");

  await writeFile(join(consumer, "wrong.vel"), [
    'import {add} from "frozen-fixture"',
    "",
    'const value: string = add(1, 2)',
    "print(value)",
    "",
  ].join("\n"), "utf8");
  const wrong = await compileProject(join(consumer, "wrong.vel"), new Map(), { projectRoot: consumer });
  assert.match(wrong.modules[0]?.result.diagnostics.map((item) => item.message).join("\n") ?? "", /Cannot assign Sum to string/u);

  manifest.type = "commonjs";
  await writeFile(join(library, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const commonJsArtifact = await compileProject(join(consumer, "main.vel"), new Map(), { projectRoot: consumer });
  const commonJsMessages = [
    ...commonJsArtifact.failures.map((failure) => failure.message),
    ...commonJsArtifact.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
  ].join("\n");
  assert.match(commonJsMessages, /must place every \.js Velar library artifact inside a package scope with package\.json 'type' set to 'module'/u);
  manifest.type = "module";
  await writeFile(join(library, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await writeFile(join(library, "dist", "package.json"), '{"type":"commonjs"}\n', "utf8");
  const nestedCommonJsArtifact = await compileProject(join(consumer, "main.vel"), new Map(), { projectRoot: consumer });
  const nestedCommonJsMessages = [
    ...nestedCommonJsArtifact.failures.map((failure) => failure.message),
    ...nestedCommonJsArtifact.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
  ].join("\n");
  assert.match(
    nestedCommonJsMessages,
    /must place every \.js Velar library artifact inside a package scope with package\.json 'type' set to 'module'/u,
  );
  manifest.type = "commonjs";
  await writeFile(join(library, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(library, "dist", "package.json"), '{"type":"module"}\n', "utf8");
  const nestedModuleArtifact = await compileProject(join(consumer, "main.vel"), new Map(), { projectRoot: consumer });
  assert.deepEqual(nestedModuleArtifact.failures, []);
  const nestedModuleRun = runCli(["run", join(consumer, "main.vel")], consumer);
  assert.equal(nestedModuleRun.status, 0, `${nestedModuleRun.stdout}${nestedModuleRun.stderr}`);
  manifest.type = "module";
  await writeFile(join(library, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  manifest.velar.entries = { "./worker": "src/worker.vel" };
  await writeFile(join(library, "src", "worker.vel"), "export const worker = true\n", "utf8");
  await writeFile(join(library, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const widened = await compileProject(join(consumer, "main.vel"), new Map(), { projectRoot: consumer });
  const widenedMessages = [
    ...widened.failures.map((failure) => failure.message),
    ...widened.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
  ].join("\n");
  assert.match(widenedMessages, /formatVersion 1 can cover only the package's root source entry/u);
  delete manifest.velar.entries;
  await writeFile(join(library, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await writeFile(join(library, "dist", "index.js"), `${await readFile(join(library, "dist", "index.js"), "utf8")}\n// tampered\n`, "utf8");
  const tampered = await compileProject(join(consumer, "main.vel"), new Map(), { projectRoot: consumer });
  const tamperMessages = [
    ...tampered.failures.map((failure) => failure.message),
    ...tampered.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
  ].join("\n");
  assert.match(tamperMessages, /JavaScript hash mismatch/u);
});

test("a frozen multi-entry library preserves exact npm subpaths across build, types, and runtime", async () => {
  const root = await makeTemporaryDirectory("velar-library-multi-entry-");
  const library = join(root, "library");
  const consumer = join(root, "consumer");
  await mkdir(join(library, "src"), { recursive: true });
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await writeFile(join(library, "package.json"), `${JSON.stringify({
    name: "frozen-multi",
    version: "2.0.0",
    type: "module",
    files: ["src", "dist", "types"],
    exports: {
      ".": { types: "./types/index.d.ts", require: "./cjs/index.cjs", import: "./dist/index.js" },
      "./worker": { types: "./types/worker.d.ts", require: "./cjs/worker.cjs", browser: "./dist/worker.js", import: "./dist/worker.js" },
    },
    velar: {
      entry: "src/index.vel",
      entries: { "./worker": "src/worker.vel" },
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core", "node", "web", "desktop"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`, "utf8");
  await mkdir(join(library, "types"), { recursive: true });
  await writeFile(join(library, "types", "index.d.ts"), "export declare function rootValue(): string;\n", "utf8");
  await writeFile(join(library, "types", "worker.d.ts"), "export declare function workerValue(): string;\n", "utf8");
  await writeFile(join(library, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(library, "src", "index.vel"), "export def rootValue() -> string:\n    return \"root\"\n", "utf8");
  await writeFile(join(library, "src", "shared.vel"), "export def decorate(value: string) -> string:\n    return f\"<{value}>\"\n", "utf8");
  await writeFile(join(library, "src", "worker.vel"), [
    'import {decorate} from "./shared.vel"',
    "",
    "export def workerValue() -> string:",
    '    return decorate("worker")',
    "",
  ].join("\n"), "utf8");

  const packageManifestPath = join(library, "package.json");
  const packageManifestText = await readFile(packageManifestPath, "utf8");
  const splitRuntimeManifest = JSON.parse(packageManifestText) as { exports: Record<string, unknown> };
  splitRuntimeManifest.exports["./worker"] = {
    types: "./types/worker.d.ts",
    require: "./cjs/worker.cjs",
    module: "./dist/worker.module.js",
    import: "./dist/worker.js",
  };
  await writeFile(packageManifestPath, `${JSON.stringify(splitRuntimeManifest, null, 2)}\n`, "utf8");
  const splitRuntime = runCli(["build-library", library], root);
  assert.equal(splitRuntime.status, 1);
  assert.match(splitRuntime.stderr, /must route Velar entry '\.\/worker' to one ESM JavaScript file on every supported runtime/u);
  const splitAliasManifest = JSON.parse(packageManifestText) as { velar: { entries: { "./worker": string } } };
  splitAliasManifest.velar.entries["./worker"] = "src/index.vel";
  await writeFile(packageManifestPath, `${JSON.stringify(splitAliasManifest, null, 2)}\n`, "utf8");
  const splitAlias = runCli(["build-library", library], root);
  assert.equal(splitAlias.status, 1);
  assert.match(splitAlias.stderr, /alias source 'src\/index\.vel' with different JavaScript outputs/u);

  const resourceConflictManifest = JSON.parse(packageManifestText) as {
    exports: Record<string, unknown>;
    velar: { resources?: Record<string, unknown> };
  };
  resourceConflictManifest.exports["./worker"] = "./data/worker.json";
  resourceConflictManifest.velar.resources = { "./worker": { path: "data/worker.json", type: "json" } };
  await writeFile(packageManifestPath, `${JSON.stringify(resourceConflictManifest, null, 2)}\n`, "utf8");
  const resourceConflict = runCli(["build-library", library], root);
  assert.equal(resourceConflict.status, 1);
  assert.match(resourceConflict.stderr, /declares '\.\/worker' as both a VelarScript entry and a JSON resource/u);

  for (const [field, sourcePath] of [["entry", "dist/root.vel"], ["worker", "dist/worker.vel"]] as const) {
    const sourceBytes = `export const ${field}Source = ${JSON.stringify(field)}\n`;
    await mkdir(join(library, "dist"), { recursive: true });
    await writeFile(join(library, sourcePath), sourceBytes, "utf8");
    const destructiveManifest = JSON.parse(packageManifestText) as {
      velar: { entry: string; entries: { "./worker": string } };
    };
    if (field === "entry") destructiveManifest.velar.entry = sourcePath;
    else destructiveManifest.velar.entries["./worker"] = sourcePath;
    await writeFile(packageManifestPath, `${JSON.stringify(destructiveManifest, null, 2)}\n`, "utf8");
    const destructive = runCli(["build-library", library], root);
    assert.equal(destructive.status, 1);
    assert.ok(destructive.stderr.includes(field === "entry" ? "#velar.entry" : '#velar.entries["./worker"]'));
    assert.match(destructive.stderr, /cannot be inside velar\.json 'outDir'; build-library replaces that directory/u);
    assert.equal(await readFile(join(library, sourcePath), "utf8"), sourceBytes, `${field} source must survive rejection`);
  }

  const commonJsManifest = JSON.parse(packageManifestText) as { type: string; exports: Record<string, unknown> };
  commonJsManifest.type = "commonjs";
  await writeFile(packageManifestPath, `${JSON.stringify(commonJsManifest, null, 2)}\n`, "utf8");
  const commonJs = runCli(["build-library", library], root);
  assert.equal(commonJs.status, 1);
  assert.match(commonJs.stderr, /package\.json 'type' must be 'module'.*exports \.js/u);

  commonJsManifest.exports["."] = { types: "./types/index.d.ts", require: "./cjs/index.cjs", import: "./dist/index.mjs" };
  commonJsManifest.exports["./worker"] = {
    types: "./types/worker.d.ts",
    require: "./cjs/worker.cjs",
    browser: "./dist/worker.mjs",
    import: "./dist/worker.mjs",
  };
  await writeFile(packageManifestPath, `${JSON.stringify(commonJsManifest, null, 2)}\n`, "utf8");
  const builtMjs = runCli(["build-library", library], root);
  assert.equal(builtMjs.status, 0, `${builtMjs.stdout}${builtMjs.stderr}`);
  await readFile(join(library, "dist", "index.mjs"), "utf8");
  await readFile(join(library, "dist", "worker.mjs"), "utf8");
  await symlink(library, join(consumer, "node_modules", "frozen-multi"), "dir");
  const mjsConsumer = join(consumer, "mjs.vel");
  await writeFile(mjsConsumer, [
    'import {rootValue} from "frozen-multi"',
    'import {workerValue} from "frozen-multi/worker"',
    "print(rootValue())",
    "print(workerValue())",
    "",
  ].join("\n"), "utf8");
  const ranMjs = runCli(["run", mjsConsumer], consumer);
  assert.equal(ranMjs.status, 0, `${ranMjs.stdout}${ranMjs.stderr}`);
  assert.equal(ranMjs.stdout, "root\n<worker>\n");
  await writeFile(packageManifestPath, packageManifestText, "utf8");

  const built = runCli(["build-library", library], root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  assert.match(built.stdout, /Built Velar library ABI 1 frozen-multi@2\.0\.0 \(core, 2 entries\)/u);
  const receipt = JSON.parse(await readFile(join(library, "dist", "velar-library.json"), "utf8")) as {
    formatVersion: number;
    sourceEntry?: string;
    entry?: unknown;
    entries: Record<string, { sourceEntry: string; javascript: string; sourceMap: string; interface: string; sha256: unknown }>;
  };
  assert.equal(receipt.formatVersion, 2);
  assert.equal(receipt.sourceEntry, undefined);
  assert.equal(receipt.entry, undefined);
  assert.deepEqual(Object.keys(receipt.entries), [".", "./worker"]);
  assert.deepEqual(receipt.entries["."], {
    sourceEntry: "src/index.vel",
    javascript: "index.js",
    sourceMap: "index.js.map",
    interface: "index.veli.json",
    sha256: receipt.entries["."]!.sha256,
  });
  assert.equal(receipt.entries["./worker"]?.sourceEntry, "src/worker.vel");
  assert.equal(receipt.entries["./worker"]?.javascript, "worker.js");
  await readFile(join(library, "dist", "worker.js"), "utf8");
  await readFile(join(library, "dist", "worker.js.map"), "utf8");
  await readFile(join(library, "dist", "worker.veli.json"), "utf8");

  await writeFile(join(consumer, "main.vel"), [
    'import {rootValue} from "frozen-multi"',
    'import {workerValue} from "frozen-multi/worker"',
    "",
    "print(rootValue())",
    "print(workerValue())",
    "",
  ].join("\n"), "utf8");
  const manifest = JSON.parse(await readFile(join(library, "package.json"), "utf8")) as {
    velar: { requires: { language?: string } };
  };
  manifest.velar.requires.language = "0.1";
  await writeFile(join(library, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(library, "src", "index.vel"), "export def rootValue():\n    with old_runtime() as value:\n        return value\n", "utf8");
  await writeFile(join(library, "src", "worker.vel"), "export def workerValue():\n    with old_runtime() as value:\n        return value\n", "utf8");

  const checked = await compileProject(join(consumer, "main.vel"), new Map(), { projectRoot: consumer });
  assert.deepEqual(checked.failures, []);
  assert.equal(checked.modules.length, 1, "neither frozen entry may fall back to package source");
  assert.deepEqual([...checked.velarPackages[0]!.artifacts.keys()], [".", "./worker"]);
  assert.equal(checked.velarPackages[0]!.artifacts.get("./worker")?.sourceEntry, "src/worker.vel");
  assert.equal(
    checked.velarPackages[0]!.artifacts.get(".")?.chunkPaths,
    checked.velarPackages[0]!.artifacts.get("./worker")?.chunkPaths,
    "one package/target compilation cache must share its authenticated common chunk set",
  );
  const ran = runCli(["run", join(consumer, "main.vel")], consumer);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(ran.stdout, "root\n<worker>\n");

  const receiptPath = join(library, "dist", "velar-library.json");
  const rootOnly = join(consumer, "root-only.vel");
  await writeFile(rootOnly, 'import {rootValue} from "frozen-multi"\nprint(rootValue())\n', "utf8");
  const corruptReceipts = [
    {
      name: "missing",
      value: { ...receipt, entries: { ".": receipt.entries["."] } },
      expected: /formatVersion 2 must contain the root and at least one subpath entry/u,
    },
    {
      name: "extra",
      value: { ...receipt, entries: { ...receipt.entries, "./extra": receipt.entries["./worker"] } },
      expected: /entries must exactly cover package\.json#velar\.entry/u,
    },
    {
      name: "wrong source",
      value: {
        ...receipt,
        entries: {
          ...receipt.entries,
          "./worker": { ...receipt.entries["./worker"]!, sourceEntry: "src/index.vel" },
        },
      },
      expected: /entry '\.\/worker' identifies source 'src\/index\.vel', expected 'src\/worker\.vel'/u,
    },
    {
      name: "portable output collision",
      value: {
        ...receipt,
        entries: {
          ...receipt.entries,
          "./portable": { ...receipt.entries["./worker"]!, javascript: "WORKER.js" },
        },
      },
      expected: /path 'WORKER\.js' is claimed by entries with different source or output metadata/u,
    },
  ] as const;
  for (const corrupted of corruptReceipts) {
    await writeFile(receiptPath, `${JSON.stringify(corrupted.value, null, 2)}\n`, "utf8");
    const rejected = await compileProject(rootOnly, new Map(), { projectRoot: consumer });
    const rejection = [
      ...rejected.failures.map((failure) => failure.message),
      ...rejected.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
    ].join("\n");
    assert.match(rejection, corrupted.expected, `${corrupted.name} unrequested receipt entry must fail closed`);
  }
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

  const workerJavaScriptPath = join(library, "dist", "worker.js");
  const realWorkerJavaScriptPath = `${workerJavaScriptPath}.real`;
  await rename(workerJavaScriptPath, realWorkerJavaScriptPath);
  await symlink(realWorkerJavaScriptPath, workerJavaScriptPath);
  const linkedUnusedEntry = await compileProject(rootOnly, new Map(), { projectRoot: consumer });
  assert.match(
    [
      ...linkedUnusedEntry.failures.map((failure) => failure.message),
      ...linkedUnusedEntry.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
    ].join("\n"),
    /Velar library JavaScript artifact must be an ordinary file/u,
    "loading the root must authorize every file in the complete artifact set before reading outputs",
  );
  await unlink(workerJavaScriptPath);
  await rename(realWorkerJavaScriptPath, workerJavaScriptPath);

  const workerJavaScript = await readFile(workerJavaScriptPath, "utf8");
  await writeFile(workerJavaScriptPath, `${workerJavaScript}\n// tampered\n`, "utf8");
  const tampered = await compileProject(join(consumer, "main.vel"), new Map(), { projectRoot: consumer });
  const tamperMessages = [
    ...tampered.failures.map((failure) => failure.message),
    ...tampered.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
  ].join("\n");
  assert.match(tamperMessages, /JavaScript hash mismatch/u);

  await writeFile(workerJavaScriptPath, workerJavaScript, "utf8");
  const workerInterfacePath = join(library, "dist", "worker.veli.json");
  const workerInterface = await readFile(workerInterfacePath, "utf8");
  await writeFile(workerInterfacePath, `${workerInterface}\n`, "utf8");
  const tamperedInterface = await compileProject(join(consumer, "main.vel"), new Map(), { projectRoot: consumer });
  const interfaceMessages = [
    ...tamperedInterface.failures.map((failure) => failure.message),
    ...tamperedInterface.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
  ].join("\n");
  assert.match(interfaceMessages, /interface hash mismatch/u);

  const oversizedDirectory = join(library, "dist", "__velar_chunks");
  await mkdir(oversizedDirectory, { recursive: true });
  const oversizedChunks = [];
  for (let index = 0; index < 4; index += 1) {
    const javascript = `__velar_chunks/oversized-${index}.js`;
    const sourceMap = `${javascript}.map`;
    await writeFile(join(library, "dist", javascript), "", "utf8");
    await writeFile(join(library, "dist", sourceMap), "", "utf8");
    await truncate(join(library, "dist", sourceMap), 64 * 1024 * 1024);
    oversizedChunks.push({
      javascript,
      sourceMap,
      sha256: { javascript: "0".repeat(64), sourceMap: "0".repeat(64) },
    });
  }
  await writeFile(receiptPath, `${JSON.stringify({ ...receipt, chunks: oversizedChunks }, null, 2)}\n`, "utf8");
  const oversized = await compileProject(rootOnly, new Map(), { projectRoot: consumer });
  assert.match(
    [
      ...oversized.failures.map((failure) => failure.message),
      ...oversized.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
    ].join("\n"),
    /Velar library artifact set exceeds 268435456 bytes/u,
    "the aggregate limit must reject the set from metadata before a stale per-entry hash can win",
  );
});

test("a generic class API survives the complete frozen-library producer and consumer path", async () => {
  const root = await makeTemporaryDirectory("velar-generic-class-artifact-");
  const library = join(root, "library");
  const consumer = join(root, "consumer");
  await mkdir(join(library, "src"), { recursive: true });
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await writeFile(join(library, "package.json"), `${JSON.stringify({
    name: "generic-class-artifact",
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core", "node", "web", "desktop"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(library, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(library, "src", "index.vel"), [
    "export class Box<T: Comparable>:",
    "    let value: T",
    "    constructor(value: T): self.value = value",
    "    def read() -> T: return self.value",
    "",
    "export class NumberBox extends Box<number>:",
    "    constructor(value: number): super(value)",
    "",
    "export def make(value: number) -> Box<number>:",
    "    return NumberBox(value)",
    "",
  ].join("\n"), "utf8");

  const built = runCli(["build-library", library, "--mode", "readable"], root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const interfaceText = await readFile(join(library, "dist", "index.veli.json"), "utf8");
  const interface_ = decodeVelarLibraryInterface(interfaceText);
  const make = interface_.exports.get("make");
  if (make?.kind !== "function" || make.result.kind !== "class") assert.fail("make must retain its generic class result");
  assert.deepEqual(make.result.application?.arguments.map((argument) => argument.kind), ["number"]);
  assert.deepEqual(interface_.classes.get("Box")?.typeParameterNames, ["T"]);
  assert.deepEqual(interface_.classes.get("Box")?.typeParameterBounds, ["Comparable"]);
  assert.deepEqual(interface_.classes.get("NumberBox")?.baseApplication?.arguments.map((argument) => argument.kind), ["number"]);

  await symlink(library, join(consumer, "node_modules", "generic-class-artifact"), "dir");
  await writeFile(join(consumer, "main.vel"), [
    'import {Box, make} from "generic-class-artifact"',
    "const value: Box<number> = make(7)",
    "print(value.read())",
    "",
  ].join("\n"), "utf8");
  const checked = await compileProject(join(consumer, "main.vel"), new Map(), { projectRoot: consumer });
  assert.deepEqual(checked.failures, []);
  assert.deepEqual(checked.modules.flatMap((module) => module.result.diagnostics), []);
  const ran = runCli(["run", join(consumer, "main.vel")], consumer);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(ran.stdout, "7\n");
});

test("the frozen interface schema round-trips every compiler ValueType kind", async () => {
  const path = join(await makeTemporaryDirectory("velar-library-type-schema-"), "schema.vel");
  const project = await compileProject(path, new Map([[path, "export const value = 1\n"]]));
  const applicationArguments = [{ kind: "number" }] as const;
  type ValueTypeRoster = { readonly [Kind in ValueType["kind"]]: Extract<ValueType, { readonly kind: Kind }> };
  const types = {
    unknown: { kind: "unknown", restricted: true, boundary: true },
    any: { kind: "any", textConvertible: true },
    null: { kind: "null" },
    string: { kind: "string" },
    number: { kind: "number" },
    bool: { kind: "bool" },
    optional: { kind: "optional", inner: { kind: "string" } },
    list: { kind: "list", element: { kind: "number" }, readonlyView: true },
    set: { kind: "set", element: { kind: "string" }, readonlyView: true },
    map: { kind: "map", key: { kind: "string" }, value: { kind: "number" }, readonlyView: true },
    record: { kind: "record", value: { kind: "bool" }, readonlyView: true },
    promise: { kind: "promise", value: { kind: "number" } },
    object: {
      kind: "object", fields: new Map<string, ValueType>([["field", { kind: "string" }]]),
      readonlyFields: new Set(["field"]), optionalFields: new Set(["field"]), readonlyView: true, capabilityHandle: true,
    },
    parameter: { kind: "parameter", name: "T", index: 0 },
    named: genericApplicationType("schema#Box", "Box", applicationArguments, true),
    class: classApplicationType("schema#Box", "Box", applicationArguments),
    enum: { kind: "enum", name: "State", identity: "schema#State" },
    enumMember: { kind: "enumMember", name: "State", identity: "schema#State", member: "ready" },
    enumObject: { kind: "enumObject", name: "State", identity: "schema#State", members: new Set(["ready"]) },
    typeObject: { kind: "typeObject", name: "Text", value: { kind: "string" } },
    runtimeType: { kind: "runtimeType", value: { kind: "string" } },
    classConstructor: { kind: "classConstructor", name: "Box", identity: "schema#Box" },
    extension: {
      kind: "extension", extensionId: "schema", family: "node", role: "value", nominal: "schema#node",
      properties: new Map<string, ValueType>([["property", { kind: "string" }]]), requiredProperties: new Set(["property"]),
      arguments: [{ kind: "number" }], metadata: { source: "schema" },
      display: { kind: "properties", name: "Node", result: "Node", hiddenOptionalProperties: new Map([["hidden", "string"]]) },
    },
    function: {
      kind: "function", typeParameterNames: ["T"], typeParameterBounds: ["Data"], parameters: [{ kind: "parameter", name: "T", index: 0 }],
      parameterNames: ["value"], requiredParameters: 1, rest: { kind: "string" }, result: { kind: "parameter", name: "T", index: 0 },
    },
    action: { kind: "action", parameters: [{ kind: "number" }], parameterNames: ["value"], requiredParameters: 1, result: { kind: "null" } },
    intrinsic: { kind: "intrinsic", name: "schema", parameters: [], requiredParameters: 0, result: { kind: "bool" } },
    union: { kind: "union", members: [{ kind: "string" }, { kind: "null" }] },
  } satisfies ValueTypeRoster;
  const interface_: ModuleInterface = {
    ...project.modules[0]!.result.moduleInterface,
    exports: new Map<string, ValueType>(Object.entries(types)),
  };
  const encoded = encodeVelarLibraryInterface(interface_);
  assert.equal(encodeVelarLibraryInterface(decodeVelarLibraryInterface(encoded)), encoded);
});

test("[D102-1] a frozen interface carries an enum's integer wire values across the ABI", async () => {
  const path = join(await makeTemporaryDirectory("velar-library-wire-"), "wire.vel");
  const project = await compileProject(path, new Map([[path, `
export enum KernelProtocol:
    v1 = 1
    v2 = 2

export enum Visibility:
    public = "published"
    private = "restricted"

export enum Plain:
    ready
`.trimStart()]]));
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const interface_ = project.modules[0]!.result.moduleInterface;
  // ABI 1 is a tagged data format, so the two wire-value kinds survive the
  // round trip as themselves: a consumer built against `v2 = 2` must not read
  // back the string "2", which would parse where the number does not.
  const restored = decodeVelarLibraryInterface(encodeVelarLibraryInterface(interface_));
  assert.deepEqual([...restored.enums.get("KernelProtocol")!.wireValues], [["v1", 1], ["v2", 2]]);
  assert.deepEqual([...restored.enums.get("Visibility")!.wireValues], [["public", "published"], ["private", "restricted"]]);
  assert.deepEqual([...restored.enums.get("Plain")!.wireValues], [["ready", "ready"]]);

  // The reader is an untrusted boundary, so it re-checks the integer bound the
  // declaration site enforced rather than assuming the producer was a compiler.
  const text = encodeVelarLibraryInterface(interface_);
  const pinned = /("v2",\s*\n\s*)2\n/u;
  assert.match(text, pinned);
  for (const bad of ["2.5", "9007199254740993", "true"]) {
    assert.throws(
      () => decodeVelarLibraryInterface(text.replace(pinned, `$1${bad}\n`)),
      /must be a string or a safe integer/u,
      `a wire value of ${bad} must be refused`,
    );
  }
});

test("a frozen interface rejects value types beyond its bounded nesting depth", async () => {
  const path = join(await makeTemporaryDirectory("velar-library-type-depth-"), "depth.vel");
  const project = await compileProject(path, new Map([[path, "export const value = 1\n"]]));
  const interface_ = project.modules[0]!.result.moduleInterface;
  let nested: ValueType = { kind: "number" };
  for (let depth = 0; depth < 130; depth += 1) nested = { kind: "optional", inner: nested };
  const tooDeep: ModuleInterface = { ...interface_, exports: new Map([["value", nested]]) };
  assert.throws(() => encodeVelarLibraryInterface(tooDeep), /exceeds the ABI type nesting limit/u);
});
