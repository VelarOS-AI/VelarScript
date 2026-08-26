import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
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
    abiVersion: number;
    sourceEntry: string;
    entry: { javascript: string; interface: string; sourceMap: string };
  };
  assert.equal(receipt.abiVersion, 1);
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
    velar: { requires: { language?: string } };
  };
  manifest.velar.requires.language = "0.1";
  await writeFile(join(library, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(library, "src", "index.vel"), "export def add():\n    with old_runtime() as value:\n        return value\n", "utf8");

  const checked = await compileProject(join(consumer, "main.vel"), new Map(), { projectRoot: consumer });
  assert.deepEqual(checked.failures, []);
  assert.equal(checked.modules.length, 1, "the installed package source must not join the consumer module graph");
  assert.equal(checked.velarPackages[0]?.artifact?.abiVersion, 1);
  assert.equal(checked.modules[0]?.result.diagnostics.length, 0);
  const webChecked = await compileProject(join(consumer, "main.vel"), new Map(), {
    projectRoot: consumer,
    extensions: [velarCompilerExtension],
  });
  assert.deepEqual(webChecked.failures, [], "a target-neutral Core artifact is admissible to a declared Web target");
  assert.equal(webChecked.velarPackages[0]?.artifact?.target, "core");

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

  await writeFile(join(library, "dist", "index.js"), `${await readFile(join(library, "dist", "index.js"), "utf8")}\n// tampered\n`, "utf8");
  const tampered = await compileProject(join(consumer, "main.vel"), new Map(), { projectRoot: consumer });
  const tamperMessages = [
    ...tampered.failures.map((failure) => failure.message),
    ...tampered.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
  ].join("\n");
  assert.match(tamperMessages, /JavaScript hash mismatch/u);
});
