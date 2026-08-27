import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { isAbsoluteBrowserImportPath } from "../packages/cli/src/production-build.ts";

const cli = resolve("packages/cli/src/cli.ts");

test("production import resolution keeps absolute host paths out of npm lookup", () => {
  assert.equal(isAbsoluteBrowserImportPath("/workspace/src/main.vel"), true);
  assert.equal(isAbsoluteBrowserImportPath("D:\\workspace\\src\\main.vel"), true);
  assert.equal(isAbsoluteBrowserImportPath("\\\\server\\share\\src\\main.vel"), true);
  assert.equal(isAbsoluteBrowserImportPath("browser-sdk"), false);
  assert.equal(isAbsoluteBrowserImportPath("@scope/browser-sdk"), false);
});

test("Desktop checks and bundles import-only ESM package roots and subpaths", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "velar-desktop-import-only-"));
  try {
    await linkDesktopExtension(projectRoot);
    const packageRoot = join(projectRoot, "node_modules", "import-only-sdk");
    await mkdir(join(packageRoot, "dist", "features"), { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "import-only-sdk",
      version: "1.0.0",
      type: "module",
      imports: { "#root-token": "./dist/root-token.js" },
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./direct": { types: "./dist/direct.d.ts", import: "./dist/direct.js" },
        "./features/*": { types: "./dist/features/*.d.ts", import: "./dist/features/*.js" },
      },
    }, null, 2), "utf8");
    await writeFile(join(packageRoot, "dist", "root-token.js"), "export const rootToken = 'ROOT_IMPORT_CONDITION'\n", "utf8");
    await writeFile(join(packageRoot, "dist", "index.js"), "import {rootToken} from '#root-token'\nexport const rootValue = () => rootToken\n", "utf8");
    await writeFile(join(packageRoot, "dist", "index.d.ts"), "export declare function rootValue(): string;\n", "utf8");
    await writeFile(join(packageRoot, "dist", "direct.js"), "export const directValue = () => 'DIRECT_IMPORT_CONDITION'\n", "utf8");
    await writeFile(join(packageRoot, "dist", "direct.d.ts"), "export declare function directValue(): string;\n", "utf8");
    await writeFile(join(packageRoot, "dist", "features", "format.js"), "export const featureValue = () => 'WILDCARD_IMPORT_CONDITION'\n", "utf8");
    await writeFile(join(packageRoot, "dist", "features", "format.d.ts"), "export declare function featureValue(): string;\n", "utf8");
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({
      name: "desktop-import-only-fixture",
      version: "0.1.0",
      private: true,
      type: "module",
    }), "utf8");
    await writeFile(join(projectRoot, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "main.vel",
      extensions: ["@velarscript/desktop"],
      desktop: {
        productName: "Import-only fixture",
        identifier: "dev.velarscript.import-only-fixture",
        permissions: {},
      },
    }, null, 2), "utf8");
    await writeFile(join(projectRoot, "main.vel"), `
import js {rootValue} from "import-only-sdk"
import js {directValue} from "import-only-sdk/direct"
import js {featureValue} from "import-only-sdk/features/format"

component App:
    const rootLabel: string = rootValue()
    const directLabel: string = directValue()
    const featureLabel: string = featureValue()
    return <main>{rootLabel}:{directLabel}:{featureLabel}</main>

@main: mount(<App />, "#app")
`.trimStart(), "utf8");

    const checked = spawnSync(process.execPath, [cli, "check"], { cwd: projectRoot, encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);

    const built = spawnSync(process.execPath, [cli, "build", "--out-dir", "build"], { cwd: projectRoot, encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    const bundledSource = await readJavaScriptTree(join(projectRoot, "build"));
    assert.match(bundledSource, /ROOT_IMPORT_CONDITION/u);
    assert.match(bundledSource, /DIRECT_IMPORT_CONDITION/u);
    assert.match(bundledSource, /WILDCARD_IMPORT_CONDITION/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function linkDesktopExtension(projectRoot: string): Promise<void> {
  const scope = join(projectRoot, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(resolve("packages/desktop"), join(scope, "desktop"), "dir");
}

async function readJavaScriptTree(root: string): Promise<string> {
  const sources: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".js")) sources.push(await readFile(path, "utf8"));
    }
  };
  await visit(root);
  return sources.join("\n");
}
