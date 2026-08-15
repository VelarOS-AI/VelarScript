import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import test from "node:test";

/**
 * D56 rule 131 — a fixture is not an example.
 *
 * The retired Web example carried three pages that exist only to fail:
 * `broken.vel`, `construction-failure.vel`, and `state-lab.vel`. They were
 * error-path *test fixtures* sitting inside an application, which is the main
 * reason that example did not read like one. They now live in
 * `tests/fixtures/web-error-paths`, and this test is what runs them, so the
 * coverage survives the retirement of the example that used to host it.
 *
 * What is under test is the runtime's behaviour on the paths an application
 * cannot demonstrate without deliberately breaking: a lazy route whose chunk
 * throws, a route that fails while it is constructed (the current page must
 * survive), a malformed percent-encoded path, and the identity contracts —
 * which component instances live through a prop change, a branch swap, and a
 * keyed reorder.
 *
 * The evidence for every one of these is a live page, so the probe is a browser
 * run rather than an emitted-module read. One engine here is deliberate:
 * `velar test <project> --browser all` over the same fixture belongs in the
 * browser gate, and this keeps the ordinary test gate honest without paying for
 * three engines.
 */

const root = resolve(new URL("..", import.meta.url).pathname);
const cli = join(root, "packages", "cli", "src", "cli.ts");
const fixture = join(root, "tests", "fixtures", "web-error-paths");

test("[D56-131] the web error-path fixtures still hold in a real browser", { timeout: 300_000 }, async () => {
  const output = await runCommand(process.execPath, [cli, "test", fixture, "--browser", "chromium"]);
  assert.match(output, /6 passed, 0 failed/u);
});

test("[D56-131] the error-path fixture project checks like any other", async () => {
  // Every fixture project checks — that is `tests/fixture-projects.test.ts`,
  // by discovery. What is pinned here is this one's module count, so a page
  // dropping out of the graph shows up as a number rather than as a browser
  // test that quietly stops covering something.
  const output = await runCommand(process.execPath, [cli, "check", fixture]);
  assert.match(output, /Checked 6 modules/u);
});

function runCommand(command: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { output += chunk; });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(output || `Command exited with ${String(code)}`));
    });
  });
}
