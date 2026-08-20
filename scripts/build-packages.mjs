import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { velarWorkspaceBuildOrder } from "./velar-packages.mjs";

/**
 * Build every publishable workspace package that declares a build, in an order
 * where each one follows workspace packages it depends on. Application
 * libraries and adapters are not workspaces of this repository.
 *
 * This replaces a literal npm script that chained six `npm run build
 * --workspace …` invocations. That chain was a copy of what `packages/*`
 * already says, and it was the third copy: `test:packages` packed a derived
 * roster and then re-listed the same names by hand for its content checks and
 * its clean install (A-024). A publishable package added to the workspace was
 * packed on the day it existed and built on no day at all — so its `dist` was
 * whatever the last manual build had left behind, or nothing.
 *
 * The order is derived, not preserved: `velarWorkspaceBuildOrder` reads each manifest's
 * own `dependencies` and its own `scripts.build`.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const order = await velarWorkspaceBuildOrder(root);
if (order.length === 0) throw new Error("no publishable workspace package declares a build script");

for (const package_ of order) {
  await run(["run", "build", "--workspace", package_.name]);
}

async function run(arguments_) {
  const npm = process.env.npm_execpath;
  const command = npm ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const argv = npm ? [npm, ...arguments_] : arguments_;
  const child = spawn(command, argv, { cwd: root, stdio: "inherit" });
  const code = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", resolveExit);
  });
  if (code !== 0) {
    process.exitCode = code ?? 1;
    throw new Error(`npm ${arguments_.join(" ")} failed (${code})`);
  }
}
