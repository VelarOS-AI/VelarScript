import { createHash } from "node:crypto";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VELAR_PROJECT_FORMAT_VERSION } from "../../packages/create/src/types.ts";
import { argumentsFirstCliRunner } from "./run-cli.ts";

export const frozenRuntimePackageName = "@fixture/compiler-runtime-artifact";
export { cliPath } from "./run-cli.ts";

export const runCli = argumentsFirstCliRunner({ timeout: 300_000 });

export async function createFrozenCompilerRuntimeLibrary(root: string): Promise<string> {
  const library = join(root, "runtime-library");
  await mkdir(join(library, "src"), { recursive: true });
  await writeFile(join(library, "package.json"), `${JSON.stringify({
    name: frozenRuntimePackageName,
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core"],
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
  await writeFile(
    join(library, "src", "index.vel"),
    'export def artifactLabel() -> string: return "artifact-runtime"\n',
    "utf8",
  );
  const built = runCli(["build-library", library, "--mode", "readable"], root);
  if (built.status !== 0) throw new Error(`${built.stdout}${built.stderr}`);
  await prependFrozenArtifactJavaScript(library, [
    'import {sha256Text as __artifactSha256} from "velar/hash";',
    '__artifactSha256("verified frozen artifact");',
  ].join("\n"));
  return library;
}

export async function linkFrozenCompilerRuntimeLibrary(consumer: string, library: string): Promise<void> {
  const scope = join(consumer, "node_modules", "@fixture");
  await mkdir(scope, { recursive: true });
  await symlink(library, join(scope, "compiler-runtime-artifact"), "dir");
}

export async function createGenericFrozenRuntimeConsumer(root: string, library: string): Promise<string> {
  const consumer = join(root, "consumer");
  await mkdir(join(consumer, "src"), { recursive: true });
  await linkFrozenCompilerRuntimeLibrary(consumer, library);
  await writeFile(join(consumer, "package.json"), '{"private":true,"type":"module"}\n', "utf8");
  await writeFile(join(consumer, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(consumer, "src", "main.vel"), [
    `import {artifactLabel} from "${frozenRuntimePackageName}"`,
    "print(artifactLabel())",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(consumer, "src", "artifact.test.vel"), [
    'import {expect} from "velar/test"',
    `import {artifactLabel} from "${frozenRuntimePackageName}"`,
    'test "frozen artifact compiler runtime": expect(artifactLabel()).toBe("artifact-runtime")',
    "",
  ].join("\n"), "utf8");
  return consumer;
}

/** Prepends code and rewrites the receipt digest, modeling a valid published artifact. */
export async function prependFrozenArtifactJavaScript(library: string, prefix: string): Promise<void> {
  const receiptPath = join(library, "dist", "velar-library.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
    readonly entry?: {
      readonly javascript: string;
      readonly sha256: { javascript: string };
    };
    readonly entries?: Record<string, {
      readonly javascript: string;
      readonly sha256: { javascript: string };
    }>;
  };
  const entry = receipt.entries?.["."] ?? receipt.entry;
  if (!entry) throw new Error("Frozen runtime fixture has no root artifact entry");
  const javascriptPath = join(library, "dist", entry.javascript);
  const javascript = [
    prefix,
    await readFile(javascriptPath, "utf8"),
  ].join("\n");
  await writeFile(javascriptPath, javascript, "utf8");
  entry.sha256.javascript = createHash("sha256").update(javascript).digest("hex");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}
