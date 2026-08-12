import { access, chmod, copyFile, mkdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export const VELAR_BUILD_ENGINE_TOOL_ID = "velar-build-engine";

export async function buildBuildEngineTool(outputFile: string): Promise<void> {
  outputFile = resolve(outputFile);
  const require = createRequire(import.meta.url);
  const packageName = `@esbuild/${process.platform}-${process.arch}`;
  let source: string;
  try {
    source = require.resolve(`${packageName}/bin/esbuild`);
  } catch {
    throw new Error(`Official build engine is unavailable for ${process.platform}-${process.arch}`);
  }
  const information = await stat(source);
  if (!information.isFile()) throw new Error("Official build engine must be an ordinary file");
  await access(source, constants.X_OK);
  await mkdir(dirname(outputFile), { recursive: true });
  await copyFile(source, outputFile);
  await chmod(outputFile, 0o755);
}
