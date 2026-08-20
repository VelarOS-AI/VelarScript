import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const cli = resolve("packages/cli/src/cli.ts");

test("Node application target creates, serves, and builds a standalone production app", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-application-"));
  const project = join(directory, "service");
  let running: ChildProcess | null = null;
  try {
    const created = spawnSync(process.execPath, [cli, "create", project, "--template", "node"], {encoding: "utf8"});
    assert.equal(created.status, 0, created.stderr);
    const packageJson = JSON.parse(await readFile(join(project, "package.json"), "utf8")) as {scripts: Record<string, string>};
    assert.equal(packageJson.scripts.dev, "velar dev");
    assert.equal(packageJson.scripts.start, "velar serve");
    const guide = await readFile(join(project, "AGENTS.md"), "utf8");
    assert.match(guide, /velar skill core.*velar skill node/su);
    assert.doesNotMatch(guide, /velar skill web/u);

    const checked = spawnSync(process.execPath, [cli, "check", project], {encoding: "utf8"});
    assert.equal(checked.status, 0, checked.stderr);

    const sourcePort = await availablePort();
    running = spawn(process.execPath, [cli, "serve", project, "--port", String(sourcePort)], {stdio: ["ignore", "pipe", "pipe"]});
    await expectHello(running, sourcePort);
    await stop(running);
    running = null;

    const manifestPath = join(project, "velar.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {node: {port: number; build: {sourceMaps: boolean}}};
    const buildPort = await availablePort();
    manifest.node.port = buildPort;
    manifest.node.build.sourceMaps = false;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const output = join(project, "production");
    const built = spawnSync(process.execPath, [cli, "build", project, "--out-dir", output], {encoding: "utf8"});
    assert.equal(built.status, 0, built.stderr);
    const receipt = JSON.parse(await readFile(join(output, "velar-node.json"), "utf8")) as Record<string, unknown>;
    assert.deepEqual(receipt, {
      formatVersion: 1,
      kind: "velar-node-build",
      entry: ".velar-node-entry.mjs",
      app: "app",
      host: "127.0.0.1",
      port: buildPort,
      maxBodyBytes: 16_777_216,
      sourceMaps: false,
    });
    assert.ok((await readdir(join(output, "public"))).includes("index.html"));
    assert.equal((await readdir(output, {recursive: true})).some((name) => name.endsWith(".map")), false);

    running = spawn(process.execPath, [join(output, ".velar-node-entry.mjs")], {cwd: output, stdio: ["ignore", "pipe", "pipe"]});
    await expectHello(running, buildPort);
    await stop(running);
    running = null;
  } finally {
    if (running) {
      running.kill("SIGKILL");
      await new Promise<void>((resolveExit) => running!.once("exit", () => resolveExit()));
    }
    await rm(directory, {recursive: true, force: true});
  }
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  return address.port;
}

async function expectHello(child: ChildProcess, port: number): Promise<void> {
  assert.ok(child.stdout && child.stderr);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const exited = new Promise<number | null>((resolveExit) => child.once("exit", resolveExit));
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const earlyExit = await Promise.race([exited, new Promise<"running">((resolveWait) => setTimeout(() => resolveWait("running"), 25))]);
    if (earlyExit !== "running") assert.fail(`Node application exited with ${earlyExit}\n${stdout}\n${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/hello`);
      if (response.ok) {
        assert.deepEqual(await response.json(), {message: "Hello from VelarScript Node", target: "node"});
        return;
      }
    } catch {}
  }
  assert.fail(`Node application did not listen on ${port}\n${stdout}\n${stderr}`);
}

async function stop(child: ChildProcess): Promise<void> {
  const exited = new Promise<{code: number | null; signal: NodeJS.Signals | null}>((resolveExit) => child.once("exit", (code, signal) => resolveExit({code, signal})));
  child.kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout> | null = null;
  const result = await Promise.race([exited, new Promise<null>((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(null), 10_000); })]);
  if (timer !== null) clearTimeout(timer);
  if (result === null) {
    child.kill("SIGKILL");
    assert.fail("Node application did not stop within 10 seconds");
  }
  assert.ok(result.code === 0 || result.code === 143 || result.signal === "SIGTERM", `unexpected Node application exit ${JSON.stringify(result)}`);
}
