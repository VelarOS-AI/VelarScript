import { chmod, copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { officialToolModulesPlugin } from "./official-tool-assets.ts";
import { copyPackagedOfficialTool } from "./packaged-official-tool.ts";

export const VELAR_PROJECT_TASK_TOOL_ID = "velar-project-task";

async function copyPlaywrightMetadata(outputFile: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const playwrightCoreRoot = dirname(require.resolve("playwright-core/package.json"));
  const destination = join(dirname(outputFile), "playwright-core");
  await mkdir(destination, { recursive: true });
  await Promise.all([
    copyFile(join(playwrightCoreRoot, "package.json"), join(destination, "package.json")),
    copyFile(join(playwrightCoreRoot, "browsers.json"), join(destination, "browsers.json")),
  ]);
}

export async function buildProjectTaskTool(outputFile: string): Promise<void> {
  outputFile = resolve(outputFile);
  if (await copyPackagedOfficialTool(outputFile, "host/project-task.js", 0o644)) {
    await Promise.all([
      copyPackagedOfficialTool(join(dirname(outputFile), "playwright-core", "package.json"), "host/playwright-core/package.json", 0o644),
      copyPackagedOfficialTool(join(dirname(outputFile), "playwright-core", "browsers.json"), "host/playwright-core/browsers.json", 0o644),
    ]);
    return;
  }
  const sourceExtension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  await mkdir(dirname(outputFile), { recursive: true });
  await build({
    entryPoints: [fileURLToPath(new URL(`./project-task-bundle-entry.${sourceExtension}`, import.meta.url))],
    outfile: outputFile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    minify: true,
    treeShaking: true,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    banner: { js: "import {createRequire as __velarCreateRequire} from 'node:module';import {fileURLToPath as __velarFileURLToPath} from 'node:url';import {dirname as __velarDirname,join as __velarJoin} from 'node:path';const require=__velarCreateRequire(import.meta.url);const __filename=__velarFileURLToPath(import.meta.url);const __dirname=__velarJoin(__velarDirname(__filename),'playwright-core','lib');" },
    plugins: [
      {
        name: "velar-project-task-browser-boundary",
        setup(buildContext) {
          // Browser-test tasks use Playwright's public launchServer/connect
          // surface. Its package also carries optional filesystem watching and
          // Chromium BiDi branches that this finite task never invokes. Keep
          // those native/dynamic edges outside the self-contained task bundle;
          // an accidental call still fails closed at module resolution.
          buildContext.onResolve({ filter: /^(?:fsevents|chromium-bidi\/)/ }, (args) => ({ path: args.path, external: true }));
        },
      },
      await officialToolModulesPlugin(),
    ],
  });
  await copyPlaywrightMetadata(outputFile);
  await chmod(outputFile, 0o644);
}
