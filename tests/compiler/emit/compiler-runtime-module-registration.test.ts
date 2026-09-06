import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import type { CompilerExtension } from "@velarscript/compiler";
import { requiredCompilerRuntimeModules } from "../../../packages/cli/src/compiler-runtime-modules.ts";
import { compileProject } from "../../../packages/cli/src/project.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = fileURLToPath(new URL("../../../packages/cli/src/cli.ts", import.meta.url));
const extensionName = "@fixture/runtime-typo";
const unknownRuntime = `${extensionName}/missing-runtime`;
const diagnostic = /Compiler emitter '@fixture\/runtime-typo' requested unknown runtime module '@fixture\/runtime-typo\/missing-runtime'.*active compiler extensions/u;

test("unknown emitter runtime roots fail project checking and direct materialization", async () => {
  const root = await makeTemporaryDirectory("velar-runtime-registration-");
  const entry = join(root, "main.vel");
  const extension = typoEmitterExtension("web");
  const project = await compileProject(entry, new Map([[entry, "const ready = true\n"]]), {
    sourceRoot: root,
    projectRoot: root,
    extensions: [extension],
    packageTarget: "web",
  });

  assert.equal(project.failures.length, 1);
  assert.match(project.failures[0]!.message, diagnostic);
  assert.throws(() => requiredCompilerRuntimeModules(project), diagnostic);
});

test("CLI commands reject a third-party emitter typo before output or execution", async () => {
  const root = await makeTemporaryDirectory("velar-runtime-registration-cli-");
  await writeFixture(root);

  const commands: readonly (readonly string[])[] = [
    ["check"],
    ["run"],
    ["build", "--mode", "readable"],
    ["test"],
  ];
  for (const arguments_ of commands) {
    const result = spawnSync(process.execPath, [cli, ...arguments_], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(result.status, 1, `${arguments_.join(" ")}\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, diagnostic, arguments_.join(" "));
    assert.doesNotMatch(result.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED|Cannot find package|Cannot find module/u);
  }
});

function typoEmitterExtension(capability: "node" | "web"): CompilerExtension {
  return {
    id: extensionName,
    contract: { protocolVersion: 1, apiVersion: "1.0", kind: "language", extends: {} },
    capabilities: [capability],
    createEmitter: () => ({
      emit: () => "export {};\n",
      sourceMap: () => '{"version":3,"sources":[],"names":[],"mappings":""}',
      runtimeModules: () => [unknownRuntime],
    }),
  };
}

async function writeFixture(root: string): Promise<void> {
  const packageRoot = join(root, "node_modules", ...extensionName.split("/"));
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    name: extensionName,
    version: "1.0.0",
    type: "module",
    exports: { "./compiler": "./compiler.js" },
    velar: { extension: { kind: "language", apiVersion: "1.0", extends: {} } },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(packageRoot, "compiler.js"), [
    `const unknownRuntime = ${JSON.stringify(unknownRuntime)};`,
    "export const velarCompilerExtension = Object.freeze({",
    `  id: ${JSON.stringify(extensionName)},`,
    '  contract: Object.freeze({protocolVersion: 1, apiVersion: "1.0", kind: "language", extends: Object.freeze({})}),',
    "  createEmitter: () => Object.freeze({",
    '    emit: () => "export {};\\n",',
    '    sourceMap: () => \'{"version":3,"sources":[],"names":[],"mappings":""}\',',
    "    runtimeModules: () => Object.freeze([unknownRuntime]),",
    "  }),",
    "});",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    entry: "main.vel",
    outDir: "dist",
    extensions: [extensionName],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "main.vel"), '@main: print("must not run")\n', "utf8");
  await writeFile(join(root, "runtime.test.vel"), 'test "must not run":\n    const ready = true\n', "utf8");
}
