import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import type { ModuleInterface } from "@velarscript/compiler";
import { encodeVelarLibraryInterface } from "../packages/cli/src/library-artifact.ts";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import { packageContentFailures } from "./package-contract.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = new URL("../packages/cli/src/cli.ts", import.meta.url).pathname;

function runCli(arguments_: readonly string[], cwd: string): { readonly status: number | null; readonly output: string } {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

test("check and build-library reject invalid UTF-8 source bytes even inside a comment", async () => {
  const root = await makeTemporaryDirectory("velar-source-utf8-");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "source-utf8-fixture",
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
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  const invalidSource = Buffer.concat([
    Buffer.from("export const value = true\n// invalid byte: ", "utf8"),
    Buffer.from([0xff]),
    Buffer.from("\n", "utf8"),
  ]);
  await writeFile(join(root, "src", "index.vel"), invalidSource);

  const checked = runCli(["check", root], root);
  assert.equal(checked.status, 1, checked.output);
  assert.match(checked.output, /src\/index\.vel must contain valid UTF-8/u);

  const built = runCli(["build-library", root], root);
  assert.equal(built.status, 1, built.output);
  assert.match(built.output, /src\/index\.vel must contain valid UTF-8/u);
  await assert.rejects(readFile(join(root, "dist", "velar-library.json")), /ENOENT/u);
});

test("the publication contract authenticates raw source bytes and then requires valid UTF-8", async () => {
  const manifest = {
    name: "packed-source-utf8-fixture",
    version: "1.0.0",
    type: "module",
    files: ["src", "dist", "README.md"],
    exports: { ".": "./dist/index.js" },
    velar: { entry: "src/index.vel", artifacts: { core: "dist/velar-library.json" } },
  };
  const source = Buffer.from([0x2f, 0x2f, 0x20, 0xff, 0x0a]);
  const javascript = Buffer.from("export const value = true\n", "utf8");
  const sourceMap = Buffer.from("{}\n", "utf8");
  const interface_ = Buffer.from(encodeVelarLibraryInterface({
    exports: new Map(),
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes: new Map(),
    namedTypeIdentities: new Map(),
    typeAliases: new Map(),
    enums: new Map(),
    classes: new Map(),
    tests: [],
    extensionExports: new Map(),
    extensionData: new Map(),
  } satisfies ModuleInterface));
  const receipt = Buffer.from(`${JSON.stringify({
    formatVersion: 1,
    kind: "velar-library-artifact",
    abiVersion: 1,
    package: { name: manifest.name, version: manifest.version },
    target: "core",
    compilerVersion: "0.28.0",
    sourceEntry: "src/index.vel",
    sources: [{ path: "src/index.vel", sha256: sha256(source) }],
    entry: {
      javascript: "index.js",
      sourceMap: "index.js.map",
      interface: "index.veli.json",
      sha256: {
        javascript: sha256(javascript),
        sourceMap: sha256(sourceMap),
        interface: sha256(interface_),
      },
    },
  })}\n`, "utf8");
  const files = new Map<string, Uint8Array>([
    ["LICENSE", Buffer.from("license\n")],
    ["README.md", Buffer.from("readme\n")],
    ["src/index.vel", source],
    ["dist/index.js", javascript],
    ["dist/index.js.map", sourceMap],
    ["dist/index.veli.json", interface_],
    ["dist/velar-library.json", receipt],
  ]);
  const packed = { filename: "fixture.tgz", files: [...files.keys()].map((path) => ({ path })) };
  const failures = await packageContentFailures(manifest, packed, async (path) => files.get(path)!);
  assert.ok(failures.some((failure) =>
    failure.includes("artifact source 'src/index.vel' is invalid") && failure.includes("valid UTF-8")
  ), failures.join("\n"));
});
