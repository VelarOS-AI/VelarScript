import { rm } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(process.cwd());
const parts = relative(workspaceRoot, packageRoot).split(/[\\/]/u);
if (parts.length !== 2 || parts[0] !== "packages" || !basename(packageRoot)) {
  throw new Error("Package clean must run from one direct workspace package directory");
}
await rm(resolve(packageRoot, "dist"), { recursive: true, force: true });
