import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = new URL("../packages/cli/src/cli.ts", import.meta.url).pathname;

function runCli(arguments_: readonly string[], cwd: string) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], {
    cwd,
    encoding: "utf8",
    timeout: 300_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("build-library bundles package imports aliases and self JavaScript exports", async () => {
  const root = await makeTemporaryDirectory("velar-library-package-js-");
  const library = join(root, "library");
  const consumer = join(root, "consumer");
  await writePackageJavaScriptLibrary(library);

  const built = runCli(["build-library", library, "--mode", "readable"], root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const artifact = await readFile(join(library, "dist", "index.js"), "utf8");
  assert.match(artifact, /internal:/u);
  assert.match(artifact, /public:/u);
  assert.doesNotMatch(artifact, /wrong:/u);
  assert.doesNotMatch(
    artifact,
    /(?:from\s*|import\()\s*["'](?:#internal-helper|package-javascript-fixture\/public-helper)["']/u,
  );

  await rename(join(library, "javascript"), join(root, "javascript-offline"));
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await symlink(library, join(consumer, "node_modules", "package-javascript-fixture"), "dir");
  const input = join(consumer, "main.vel");
  await writeFile(input, [
    'import {decorate} from "package-javascript-fixture"',
    'print(decorate("value"))',
    "",
  ].join("\n"), "utf8");
  const ran = runCli(["run", input], consumer);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(ran.stdout, "public:internal:value\n");
});

async function writePackageJavaScriptLibrary(root: string): Promise<void> {
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "javascript"), { recursive: true });
  await writeFile(join(root, "javascript", "internal.js"), [
    "export function internal(value) {",
    '  return "internal:" + value;',
    "}",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "javascript", "public.js"), [
    "export function decoratePublic(value) {",
    '  return "public:" + value;',
    "}",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "javascript", "wrong.js"), [
    'export function internal(value) { return "wrong:" + value; }',
    'export function decoratePublic(value) { return "wrong:" + value; }',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "src", "index.vel"), [
    'extern module "#internal-helper":',
    "    export def internal(value: string) -> string",
    'extern module "package-javascript-fixture/public-helper":',
    "    export def decoratePublic(value: string) -> string",
    'import js {internal} from "#internal-helper"',
    'import js {decoratePublic} from "package-javascript-fixture/public-helper"',
    "",
    "export def decorate(value: string) -> string:",
    "    return decoratePublic(internal(value))",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "package-javascript-fixture",
    version: "1.0.0",
    type: "module",
    imports: {
      "#internal-helper": {
        import: "./javascript/internal.js",
        default: "./javascript/wrong.js",
      },
    },
    exports: {
      ".": "./dist/index.js",
      "./public-helper": {
        import: "./javascript/public.js",
        default: "./javascript/wrong.js",
      },
    },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
}
