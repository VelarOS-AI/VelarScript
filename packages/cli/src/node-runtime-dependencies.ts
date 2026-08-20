import { cp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isHostErrorCode } from "./host-error.ts";

const WEBSOCKET_PACKAGE = "ws";
const WEBSOCKET_VERSION = "8.21.1";

export async function writeWebSocketDependency(nodeModulesRoot: string): Promise<void> {
  const target = join(nodeModulesRoot, WEBSOCKET_PACKAGE);
  try {
    const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as Record<string, unknown>;
    if (manifest.name !== WEBSOCKET_PACKAGE || manifest.version !== WEBSOCKET_VERSION) {
      throw new Error(`Refusing to use incompatible WebSocket runtime package '${target}'`);
    }
    return;
  } catch (error) {
    if (!isHostErrorCode(error, "ENOENT")) throw error;
  }
  const require = createRequire(import.meta.url);
  const source = dirname(require.resolve(`${WEBSOCKET_PACKAGE}/package.json`));
  await cp(source, target, { recursive: true, errorOnExist: true });
}
