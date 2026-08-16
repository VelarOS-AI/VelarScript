import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { officialToolModulesPlugin } from "./official-tool-assets.ts";
import { copyPackagedOfficialTool } from "./packaged-official-tool.ts";

export const VELAR_PROJECT_TASK_TOOL_ID = "velar-project-task";

export async function buildProjectTaskTool(outputFile: string): Promise<void> {
  outputFile = resolve(outputFile);
  if (await copyPackagedOfficialTool(outputFile, "host/project-task.js", 0o644)) return;
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
    banner: { js: "import {createRequire as __velarCreateRequire} from 'node:module';const require=__velarCreateRequire(import.meta.url);" },
    plugins: [
      {
        name: "velar-project-task-boundary",
        setup(buildContext) {
          buildContext.onResolve({ filter: /^\.\/browser-test-runner\.(?:ts|js)$/ }, (args) => ({ path: args.path, external: true }));
        },
      },
      await officialToolModulesPlugin(),
    ],
  });
  await chmod(outputFile, 0o644);
}
