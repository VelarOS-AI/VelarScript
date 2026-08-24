import { cp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isHostErrorCode } from "./host-error.ts";

const WEBSOCKET_PACKAGE = "ws";
const WEBSOCKET_VERSION = "8.21.1";
const YAML_PACKAGE = "yaml";
const YAML_VERSION = "2.9.0";

export async function writeWebSocketDependency(nodeModulesRoot: string): Promise<void> {
  await writeRuntimeDependency(nodeModulesRoot, WEBSOCKET_PACKAGE, WEBSOCKET_VERSION);
}

export async function writeServerConfigurationDependency(nodeModulesRoot: string): Promise<void> {
  await writeRuntimeDependency(nodeModulesRoot, YAML_PACKAGE, YAML_VERSION);
}

async function writeRuntimeDependency(nodeModulesRoot: string, packageName: string, version: string): Promise<void> {
  const target = join(nodeModulesRoot, packageName);
  try {
    const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as Record<string, unknown>;
    if (manifest.name !== packageName || manifest.version !== version) {
      throw new Error(`Refusing to use incompatible Node runtime package '${target}'`);
    }
    return;
  } catch (error) {
    if (!isHostErrorCode(error, "ENOENT")) throw error;
  }
  const require = createRequire(import.meta.url);
  const source = dirname(require.resolve(`${packageName}/package.json`));
  await cp(source, target, { recursive: true, errorOnExist: true });
}
