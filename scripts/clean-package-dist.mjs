import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";

const root = resolve(process.cwd());
if (!root.includes(`${process.platform === "win32" ? "\\" : "/"}packages${process.platform === "win32" ? "\\" : "/"}`)) {
  throw new Error("Package clean must run from a packages/* directory");
}
if (!basename(root)) throw new Error("Package directory was not resolved");
await rm(resolve(root, "dist"), { recursive: true, force: true });
