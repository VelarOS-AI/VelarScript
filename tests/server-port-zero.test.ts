import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { velarServerRuntime } from "../packages/server/src/runtime.ts";

const cli = resolve("packages/cli/src/cli.ts");

/**
 * SR-I1 and SV-I6: the two places `@velarscript/server` disagreed with the
 * surface underneath it.
 *
 * `serve(app, port=0)` is the documented way to bind any free port, and the
 * `@velarscript/server` skill teaches it — but `application()` refused
 * `server.port: 0` with a bound (1 through 65535) that appears nowhere in the
 * documentation. And whether a manifest-declared configuration file exists is a
 * fact about the project, which `velar build` refused and `velar check` called
 * clean, so `check` could pass over a tree `build` will not accept.
 */

test("application() accepts server.port 0 as any free port and refuses 65536", async () => {
  const source = velarServerRuntime("application.yml");
  assert.match(source, /\|\| port < 0 \|\| port > 65535/u);
  assert.match(source, /application server\.port must be an integer from 0 through 65535/u);
  assert.doesNotMatch(source, /from 1 through 65535/u);
  // The bound the runtime enforces is the bound the skill states.
  const skill = await readFile("docs/ai-skill-server.md", "utf8");
  assert.match(skill, /`port` is an integer from 0 through 65535, and `0` means "any free/u);
});

test("a Server application binds port 0 and reports the port it got", async () => {
  const project = await mkdtemp(join(tmpdir(), "velar-server-port-zero-"));
  try {
    const created = spawnSync(process.execPath, [cli, "create", project, "--template", "node"], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    // `velar/server` reads YAML through the `yaml` package the template
    // declares; the probe project installs nothing, so the workspace's copy is
    // placed where the generated module resolves it.
    const require = createRequire(import.meta.url);
    await mkdir(join(project, "node_modules"), { recursive: true });
    await cp(resolve(require.resolve("yaml/package.json"), ".."), join(project, "node_modules", "yaml"), { recursive: true });
    await writeFile(join(project, "application.yml"), "server:\n  host: 127.0.0.1\n  port: 0\n", "utf8");
    await writeFile(join(project, "src", "main.vel"), `
import {application} from "velar/server"
import {app as routes} from "./app.vel"

@main:
    const server = await application(routes)
    print(f"BOUND {server.port}")
    await server.stop()
`.trimStart(), "utf8");

    const bound = spawnSync(process.execPath, [cli, "run", project], { encoding: "utf8", cwd: project, timeout: 120_000 });
    assert.equal(bound.status, 0, `${bound.stdout}\n${bound.stderr}`);
    const port = Number(/^BOUND (\d+)$/mu.exec(bound.stdout)?.[1]);
    assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65535, bound.stdout);

    await writeFile(join(project, "application.yml"), "server:\n  host: 127.0.0.1\n  port: 65536\n", "utf8");
    const refused = spawnSync(process.execPath, [cli, "run", project], { encoding: "utf8", cwd: project, timeout: 120_000 });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /application server\.port must be an integer from 0 through 65535/u);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a missing declared Server configuration file fails velar check with the sentence velar build uses", async () => {
  const project = await mkdtemp(join(tmpdir(), "velar-server-configuration-"));
  try {
    const created = spawnSync(process.execPath, [cli, "create", project, "--template", "node"], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    const manifestPath = join(project, "velar.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.server = { configuration: "config/app.yml" };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rm(join(project, "application.yml"), { force: true });
    const sentence = `Configured Server configuration '${join(project, "config", "app.yml")}' does not exist`;

    const checked = spawnSync(process.execPath, [cli, "check", project], { encoding: "utf8" });
    assert.notEqual(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
    assert.ok(checked.stderr.includes(sentence), checked.stderr);

    const built = spawnSync(process.execPath, [cli, "build", project, "--out-dir", join(project, "out")], { encoding: "utf8" });
    assert.notEqual(built.status, 0);
    assert.ok(built.stderr.includes(sentence), built.stderr);

    // The file existing is all it takes: both commands accept the same tree.
    await writeFile(join(project, "application.yml"), "server:\n  host: 127.0.0.1\n  port: 3000\n", "utf8");
    manifest.server = { configuration: "application.yml" };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const clean = spawnSync(process.execPath, [cli, "check", project], { encoding: "utf8" });
    assert.equal(clean.status, 0, `${clean.stdout}\n${clean.stderr}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
