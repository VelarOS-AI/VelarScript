import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testDirectory = join(root, "tests");
const nodeAcceptanceFiles = new Set(["ci.acceptance.ts", "release.acceptance.ts"]);

/**
 * The quick suite is the release default: current baseline tests plus the
 * closeout regressions for the present compiler generation. Historical
 * `hardening-*` waves remain executable as the full suite, but their many
 * intentional process timeouts no longer tax every small change and release.
 */
export async function nodeTestFiles(directory, mode) {
  if (mode !== "quick" && mode !== "full") throw new Error(`unknown Node test mode '${mode}'`);
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".test.ts") || nodeAcceptanceFiles.has(entry.name)))
    .map((entry) => entry.name)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (mode === "full") return names.map((name) => join(directory, name));
  return names
    .filter((name) => !name.startsWith("hardening-") || name.startsWith("hardening-closeout-"))
    .map((name) => join(directory, name));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode !== "quick" && mode !== "full") {
    process.stderr.write("Usage: run-node-tests.mjs <quick|full>\n");
    process.exit(2);
  }
  const files = await nodeTestFiles(testDirectory, mode);
  if (files.length === 0) throw new Error(`the ${mode} Node test suite discovered no files`);
  const all = await nodeTestFiles(testDirectory, "full");
  const deferred = all.length - files.length;
  process.stdout.write(
    `Running ${mode} Node suite: ${files.length} files${deferred > 0 ? `, ${deferred} historical hardening files reserved for test:full` : ""}\n`,
  );
  const child = spawn(process.execPath, [
    "--test",
    "--test-concurrency=1",
    "--test-timeout=120000",
    ...files,
  ], { cwd: root, stdio: "inherit" });
  const code = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", resolveExit);
  });
  process.exitCode = code ?? 1;
}
