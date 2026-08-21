import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { resolveInstalledExtensionPackage } from "../packages/cli/src/extension-metadata.ts";

// ---------------------------------------------------------------------------
// The same shape D90 R13 had to close in 'velar.requires': a closed manifest
// schema that rejects a field without naming a single field it does accept, so
// a misspelling reads as "this is not allowed" rather than "you meant that".
// 'velar.extension' is the other closed schema the CLI owns.
// ---------------------------------------------------------------------------

after(removeTemporaryDirectories);

test("a closed extension manifest section names the fields it accepts", async () => {
  const root = await makeTemporaryDirectory("velar-extension-manifest-fields-");
  const packageRoot = join(root, "node_modules", "fixture-extension");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture-app", version: "1.0.0" }), "utf8");
  const install = async (extension: Record<string, unknown>): Promise<void> => {
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "fixture-extension",
      version: "1.0.0",
      velar: { extension },
    }), "utf8");
  };

  await install({ kind: "capability", apiVersion: "1.0", manifestKeys: "fixture" });
  await assert.rejects(
    resolveInstalledExtensionPackage(root, "fixture-extension"),
    /'velar\.extension' contains unknown field 'manifestKeys'; the supported fields are 'apiVersion', 'composes', 'extends', 'kind', 'manifestKey'/u,
    "the author who wrote 'manifestKeys' is shown 'manifestKey' rather than only being refused",
  );

  // A section that spells every field correctly is untouched by the naming.
  await install({ kind: "capability", apiVersion: "1.0", manifestKey: "fixture" });
  const resolved = await resolveInstalledExtensionPackage(root, "fixture-extension");
  assert.equal(resolved?.manifestKey, "fixture");
});
