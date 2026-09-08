import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** A real page warning leaves only runner frames, including scoped npm paths. */
export async function assertInstalledBrowserProgramStacks(cli: string, consumer: string): Promise<void> {
  const root = join(consumer, "browser-stack-contract");
  const native = join(root, "node_modules", "stack-warning");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(native, { recursive: true });
  await writeFile(join(native, "package.json"), JSON.stringify({ name: "stack-warning", version: "1.0.0", type: "module", exports: "./index.js" }), "utf8");
  await writeFile(join(native, "index.js"), 'export function warn() { console.warn("page warning sentinel"); }\n', "utf8");
  await writeFile(join(root, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(root, "src", "main.vel"), [
    'extern module "stack-warning":', "    export def warn() -> null", "",
    'import js {warn} from "stack-warning"', "", "component App:",
    '    return <button id="warn" on:click={warn}>Warn</button>', "",
    '@main: mount(<App />, "#app")', "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "src", "warning.browser.test.vel"), [
    'import {browser} from "velar/web-test"', "", 'test "page warning":',
    "    await browser.open()", '    await browser.click("#warn")', "",
  ].join("\n"), "utf8");
  for (const fullStack of [false, true]) {
    const result = spawnSync(process.execPath, [cli, "test", "--browser=chromium", ...(fullStack ? ["--stack"] : [])], {
      cwd: root, encoding: "utf8", timeout: 45_000, killSignal: "SIGTERM", maxBuffer: 1024 * 1024,
    });
    const report = result.stdout + result.stderr;
    assert.equal(result.status, 1, report);
    assert.match(report, /0 passed, 1 failed/u);
    assert.match(report, /warning: page warning sentinel/u);
    if (fullStack) {
      assert.match(report, /node_modules\/@velarscript\/cli\/dist\/browser-test\/worker\.js/u);
      assert.doesNotMatch(report, /outside your program hidden/u);
    } else {
      assert.doesNotMatch(report, /node_modules\/@velarscript\/cli\//u);
      assert.match(report, /velar test --browser --stack/u);
    }
  }
}
