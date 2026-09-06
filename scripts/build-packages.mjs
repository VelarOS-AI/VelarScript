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

/**
 * Whether this build is a machine's rather than a person's. GitHub Actions sets
 * `CI`, as does every other runner worth naming; the explicit falsehoods are
 * honoured so a person can turn it off in a shell that sets it for them.
 */
export function isContinuousIntegration(environment = process.env) {
  const value = environment.CI;
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

/**
 * D115 §一.4: the JavaScript a package emits lives in that package's own
 * `runtime/*.js`, and its `src/runtime-sources.generated.ts` is the
 * transcription. Reconciling every root here, before anything is compiled, is
 * what makes it impossible to ship a `dist` built from a stale copy of a
 * runtime somebody edited.
 *
 * Locally that means rewriting the transcription: the runtime source is the
 * authority, and a developer who edits one should not have to remember a second
 * command. On CI it means refusing it. Rewriting on CI made
 * `check:runtime-sources` vacuous — the build ran first and rewrote the very
 * file the gate then compared, so a commit carrying a stale transcription went
 * green locally and on CI alike, which is how one reached the integration
 * branch (D114, the R2b merge). A gate can only see a stale file if nothing has
 * already fixed it behind its back.
 *
 * `generated` is what `generateAllRuntimeSources` produced, taken as an
 * argument rather than read here, so this reconciliation can be pointed at a
 * fixture and watched go red.
 */
export async function synchronizeRuntimeSources(generated, { ci = isContinuousIntegration() } = {}) {
  const notices = [];
  const stale = [];
  for (const [package_, result] of generated) {
    if (result.problems.length > 0) {
      throw new Error(`packages/${package_}: the runtime sources disagree with the constants they were resolved from:\n${result.problems.map((problem) => `  ${problem}`).join("\n")}`);
    }
    const committed = await readFile(result.generated, "utf8").catch(() => null);
    if (committed === result.text) continue;
    if (ci) {
      stale.push(`  packages/${package_}: ${result.manifest.generated} ${describeStaleness(committed, result.text)}`);
      continue;
    }
    await writeFile(result.generated, result.text, "utf8");
    notices.push(`regenerated ${result.manifest.generated} from ${result.files.size} runtime sources`);
  }
  if (stale.length > 0) {
    throw new Error([
      "the committed runtime-source transcriptions are stale, and CI does not rewrite them:",
      "",
      ...stale,
      "",
      "  The runtime `.js` files are the source and these files are their transcription. Run",
      "  `node scripts/generate-runtime-sources.mjs` (or `npm run build:packages` locally, which runs it)",
      "  and commit what it writes.",
    ].join("\n"));
  }
  return notices;
}

/**
 * Where a stale transcription first parts company with the runtime, named by
 * the constant it falls inside rather than by a line number alone: the number
 * says where to look and the constant says what to look at.
 */
function describeStaleness(committed, fresh) {
  if (committed === null) return "is missing";
  const before = committed.split("\n");
  const after = fresh.split("\n");
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    if (before[index] === after[index]) continue;
    for (let back = index; back >= 0; back -= 1) {
      const name = /^export const ([A-Za-z0-9_]+)/u.exec(after[back] ?? before[back] ?? "")?.[1];
      if (name !== undefined) return `first differs at line ${index + 1}, inside ${name}`;
    }
    return `first differs at line ${index + 1}, above the first constant`;
  }
  return "differs in trailing whitespace only";
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Roots are reconciled in `RUNTIME_PACKAGES` order, because a later root's
  // manifest may import a constant an earlier one publishes.
  for (const notice of await synchronizeRuntimeSources(await generateAllRuntimeSources(root))) {
    process.stdout.write(`${notice}\n`);
  }

  const order = await velarWorkspaceBuildOrder(root);
  if (order.length === 0) throw new Error("no publishable workspace package declares a build script");

  for (const package_ of order) {
    await run(["run", "build", "--workspace", package_.name]);
  }
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
