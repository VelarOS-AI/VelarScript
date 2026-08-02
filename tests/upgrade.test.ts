import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const cli = resolve("packages/cli/src/cli.ts");
const fixtures = resolve("tests/fixtures/upgrades");

test("current CLI upgrades and production-builds the 0.3 through 0.6 project matrix", async () => {
  for (const version of ["0.3", "0.4", "0.5", "0.6"]) {
    const temporary = await mkdtemp(join(tmpdir(), `velar-upgrade-${version.replace(".", "")}-`));
    await cp(join(fixtures, version), temporary, { recursive: true });
    const before = JSON.parse(await readFile(join(temporary, "velar.json"), "utf8")) as {
      formatVersion?: number;
      web: { title: string; base: string };
    };

    const check = spawnSync(process.execPath, [cli, "upgrade", "--check"], { cwd: temporary, encoding: "utf8" });
    assert.equal(check.status, version === "0.3" ? 1 : 0, `${version}: ${check.stderr}`);
    const upgrade = spawnSync(process.execPath, [cli, "upgrade"], { cwd: temporary, encoding: "utf8" });
    assert.equal(upgrade.status, 0, `${version}: ${upgrade.stderr}`);
    const after = JSON.parse(await readFile(join(temporary, "velar.json"), "utf8")) as {
      formatVersion: number;
      web: { title: string; base: string };
    };
    assert.equal(after.formatVersion, 1);
    assert.equal(after.web.title, before.web.title);
    assert.equal(after.web.base, before.web.base);

    const checked = spawnSync(process.execPath, [cli, "check"], { cwd: temporary, encoding: "utf8" });
    assert.equal(checked.status, 0, `${version}: ${checked.stderr}`);
    const built = spawnSync(process.execPath, [cli, "build"], { cwd: temporary, encoding: "utf8" });
    assert.equal(built.status, 0, `${version}: ${built.stderr}`);
    const manifest = JSON.parse(await readFile(join(temporary, "dist", "velar-build.json"), "utf8")) as {
      formatVersion: number;
      apiVersion: string;
      deployment: { adapter: string };
    };
    assert.equal(manifest.formatVersion, 2);
    assert.equal(manifest.apiVersion, "0.6");
    assert.equal(manifest.deployment.adapter, "neutral");
  }
});
