import { chmod } from "node:fs/promises";
import { resolve } from "node:path";

const paths = process.argv.slice(2);
if (paths.length === 0) throw new Error("mark-package-bin requires at least one generated command path");
await Promise.all(paths.map((path) => chmod(resolve(path), 0o755)));
