import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Runs only the installed files, so the reporter cannot borrow checkout source. */
export async function assertInstalledProgramStacks(cli: string, consumer: string): Promise<void> {
  const root = join(consumer, "program-stack-contract");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "velar.json"), JSON.stringify({
    formatVersion: 2, entry: "src/main.vel", extensions: [],
  }), "utf8");
  await writeFile(join(root, "src", "main.vel"), [
    "type Payload:", "    name: string", "", "@main:",
    "    const raw: unknown = null", "    print(Payload.parse(raw))", "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "src", "shape.test.vel"), [
    'import {expect} from "velar/test"', "", 'test "installed assertion":',
    "    expect(1).toBe(2)", "",
  ].join("\n"), "utf8");
  for (const command of ["run", "test"]) {
    for (const fullStack of [false, true]) {
      const result = spawnSync(process.execPath, [cli, command, ...(fullStack ? ["--stack"] : [])], {
        cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
      });
      const report = result.stdout + result.stderr;
      assert.equal(result.status, 1, report);
      assert.match(report, command === "run" ? /main\.vel:6:\d+/u : /shape\.test\.vel:4:\d+/u);
      assert.match(report, command === "run" ? /print\(Payload\.parse\(raw\)\)/u : /expect\(1\)\.toBe\(2\)/u);
      if (fullStack) {
        assert.match(report, command === "run" ? /__velarParse/u : /node_modules\/velar\/test\.js/u);
        assert.doesNotMatch(report, /outside your program hidden/u);
      } else {
        assert.ok(report.includes(`rerun with 'velar ${command} --stack'`), report);
        assert.doesNotMatch(report, /__velarParse|node:internal/u);
      }
    }
  }
}
