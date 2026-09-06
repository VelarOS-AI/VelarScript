import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { velarWorkspaceBuildOrder } from "./velar-packages.mjs";
import { generateAllRuntimeSources } from "./generate-runtime-sources.mjs";

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

// D115 §一.4: the JavaScript a package emits lives in that package's own
// `runtime/*.js`, and its `src/runtime-sources.generated.ts` is the
// transcription. Regenerating every root here, before anything is compiled, is
// what makes it impossible to ship a `dist` built from a stale copy of a
// runtime somebody edited. `check:runtime-sources` is the other half: it
// refuses a committed transcription that does not match, so the tree stays
// honest too. Roots are regenerated in `RUNTIME_PACKAGES` order, because a
// later root's manifest may import a constant an earlier one publishes.
for (const [package_, generated] of await generateAllRuntimeSources(root)) {
  if (generated.problems.length > 0) {
    throw new Error(`packages/${package_}: the runtime sources disagree with the constants they were resolved from:\n${generated.problems.map((problem) => `  ${problem}`).join("\n")}`);
  }
  if (await readFile(generated.generated, "utf8").catch(() => null) === generated.text) continue;
  await writeFile(generated.generated, generated.text, "utf8");
  process.stdout.write(`regenerated ${generated.manifest.generated} from ${generated.files.size} runtime sources\n`);
}

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
