import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

// Two real CLI runs build CSP production output and exercise Chromium,
// Firefox and WebKit. The browser supervisor owns and reaps each engine.
after(removeTemporaryDirectories);

test("browser stack mode reaches test bodies, page startup and page error channels", { timeout: 180_000 }, async () => {
  const root = await makeTemporaryDirectory("velar-browser-stack-");
  await mkdir(join(root, "src"));
  const probe = join(root, "node_modules", "stack-probe");
  await mkdir(probe, { recursive: true });
  await writeFile(join(probe, "package.json"), JSON.stringify({
    name: "stack-probe", version: "1.0.0", type: "module", exports: "./index.js",
  }), "utf8");
  await writeFile(join(root, "velar.json"), JSON.stringify({
    formatVersion: 2, entry: "src/main.vel", extensions: ["@velarscript/web"],
    web: { title: "Stack propagation", security: { contentSecurityPolicy: true, connectSources: [], imageSources: [] } },
  }), "utf8");
  await writeFile(join(probe, "index.js"), [
    'export function mode() { return globalThis[Symbol.for("velar.run.stack")]?.fullStack === true ? "full" : "filtered"; }',
    "export function fail() {",
    '  const failure = new Error("page stack sentinel");',
    // Explicit marker frames test the page-side policy even when production
    // minification has erased the names of real bundled functions.
    '  failure.stack = "Error: page stack sentinel\\n    at __velarPageProbe (http://localhost/probe.js:1:1)\\n    at clicked (http://localhost/probe.js:2:1)";',
    "  throw failure;",
    "}",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "src", "probe.vel"), [
    'extern module "stack-probe":',
    "    export def mode() -> string",
    "    export def fail() -> null",
    "",
    'import js {mode, fail} from "stack-probe"',
    "",
    "export def stackMode() -> string: return mode()",
    "export def failPage(): fail()",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "src", "main.vel"), [
    'import {failPage, stackMode} from "./probe.vel"',
    "",
    "component App:",
    '    return <main><output id="mode">{stackMode()}</output><button id="fail" on:click={failPage}>Fail</button></main>',
    "",
    '@main: mount(<App />, "#app")',
    "",
  ].join("\n"), "utf8");
  for (const fullStack of [false, true]) {
    const expected = fullStack ? "full" : "filtered";
    await writeFile(join(root, "src", "app.browser.test.vel"), [
      'import {expect} from "velar/test"',
      'import {browser} from "velar/web-test"',
      "",
      'test "mode reaches the page":',
      "    await browser.open()",
      `    expect(await browser.text("#mode")).toBe("${expected}")`,
      "",
      'test "body assertion location":',
      "    expect(1).toBe(2)",
      "",
      'test "page host error marker":',
      "    await browser.open()",
      '    await browser.click("#fail")',
      "",
    ].join("\n"), "utf8");
    const result = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test", root, "--browser=all", ...(fullStack ? ["--stack"] : [])], {
      cwd: root, encoding: "utf8", timeout: 75_000, killSignal: "SIGTERM", maxBuffer: 4 * 1024 * 1024,
    });
    const report = result.stdout + result.stderr;
    assert.equal(result.status, 1, report);
    assert.match(report, /3 passed, 6 failed/u, report);
    for (const engine of ["chromium", "firefox", "webkit"]) {
      assert.match(report, new RegExp(`✓ ${engine} :: .*mode reaches the page`), report);
    }
    assert.match(report, /app\.browser\.test\.vel:9:\d+/u, report);
    assert.match(report, /page stack sentinel/u, report);
    if (fullStack) {
      assert.match(report, /__velarPageProbe/u, report);
      assert.match(report, /packages\/cli\/src\/browser-test\/worker\.ts/u, report);
      assert.doesNotMatch(report, /outside your program hidden/u, report);
    } else {
      assert.doesNotMatch(report, /__velarPageProbe/u, report);
      assert.doesNotMatch(report, /packages\/cli\/src\/browser-test\/worker\.ts/u, report);
      assert.match(report, /velar test --browser --stack/u, report);
    }
  }
});
