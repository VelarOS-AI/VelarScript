import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import WebSocket from "ws";

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
    assert.match(guide, /velar skill core.*velar skill node.*velar skill server/su);
    assert.doesNotMatch(guide, /velar skill web/u);

    const checked = spawnSync(process.execPath, [cli, "check", project], {encoding: "utf8"});
    assert.equal(checked.status, 0, checked.stderr);

    const sourcePort = await availablePort();
    await writeFile(join(project, "application.yml"), serverYaml(sourcePort), "utf8");
    const rejectedOverride = spawnSync(process.execPath, [cli, "serve", project, "--port", String(sourcePort)], {encoding: "utf8"});
    assert.equal(rejectedOverride.status, 2);
    assert.match(rejectedOverride.stderr, /unknown option '--port'/u);
    running = spawn(process.execPath, [cli, "serve", project], {stdio: ["ignore", "pipe", "pipe"]});
    await expectHello(running, sourcePort);
    await stop(running);
    running = null;

    const mainPath = join(project, "src", "main.vel");
    const conventionalMain = await readFile(mainPath, "utf8");
    const explicitPort = await availablePort();
    await mkdir(join(project, "config"));
    await writeFile(join(project, "config", "settings.json"), `${JSON.stringify({server: {host: "127.0.0.1", port: explicitPort, maxBodyBytes: 16_777_216}}, null, 2)}\n`, "utf8");
    await writeFile(mainPath, conventionalMain.replace("application(routes)", 'application(routes, path="config/settings.json")'), "utf8");
    running = spawn(process.execPath, [cli, "serve", project], {stdio: ["ignore", "pipe", "pipe"]});
    await expectHello(running, explicitPort);
    await stop(running);
    running = null;
    await writeFile(mainPath, conventionalMain, "utf8");

    const manifestPath = join(project, "velar.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    assert.equal(manifest.node, undefined);
    const buildPort = await availablePort();
    await rm(join(project, "application.yml"));
    await writeFile(join(project, "application.json"), `${JSON.stringify({server: {host: "127.0.0.1", port: buildPort, maxBodyBytes: 16_777_216}}, null, 2)}\n`, "utf8");
    const output = join(project, "production");
    const rejectedConvention = spawnSync(process.execPath, [cli, "build", project, "--out-dir", output], {encoding: "utf8"});
    assert.notEqual(rejectedConvention.status, 0);
    assert.match(rejectedConvention.stderr, /rename it to application\.yml/u);
    await rm(join(project, "application.json"));
    await writeFile(join(project, "application.yml"), serverYaml(buildPort), "utf8");
    const built = spawnSync(process.execPath, [cli, "build", project, "--out-dir", output], {encoding: "utf8"});
    assert.equal(built.status, 0, built.stderr);
    const receipt = JSON.parse(await readFile(join(output, "velar-node.json"), "utf8")) as {
      formatVersion: number;
      kind: string;
      compiler: { name: string; version: string };
      buildId: string;
      mode: string;
      entry: string;
      app: string;
      sourceMaps: boolean;
      assets: Array<{ path: string; role: string }>;
    };
    assert.equal(receipt.formatVersion, 4);
    assert.equal(receipt.kind, "velar-node-build");
    assert.deepEqual(receipt.compiler, { name: "velar", version: "0.19.1" });
    assert.match(receipt.buildId, /^[a-f0-9]{64}$/u);
    assert.equal(receipt.mode, "production");
    assert.equal(receipt.entry, ".velar-node-entry.mjs");
    assert.equal(receipt.app, "start");
    assert.equal(receipt.sourceMaps, false);
    assert.equal(receipt.assets.find((asset) => asset.path === ".velar-node-entry.mjs")?.role, "entry");
    assert.equal(receipt.assets.find((asset) => asset.path === "application.yml")?.role, "configuration");
    assert.deepEqual(receipt.assets.map((asset) => asset.path), [...receipt.assets.map((asset) => asset.path)].sort());
    assert.ok((await readdir(join(output, "public"))).includes("index.html"));
    assert.ok((await readdir(output)).includes("application.yml"));
    assert.ok((await readdir(join(output, "node_modules", "yaml"))).includes("package.json"));
    assert.equal((await readdir(output, {recursive: true})).some((name) => name.endsWith(".map")), false);

    // verify 同时接受具体 Node 构建目录和清单文件，不再尝试从里面寻找
    // velar.json。它对已记录的每个字节重算哈希，并拒绝清单之外的文件。
    const verified = spawnSync(process.execPath, [cli, "verify", output], {encoding: "utf8"});
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, new RegExp(`Verified node build ${receipt.buildId}`, "u"));
    const verifiedManifest = spawnSync(process.execPath, [cli, "verify", join(output, "velar-node.json")], {encoding: "utf8"});
    assert.equal(verifiedManifest.status, 0, verifiedManifest.stderr);

    const entryBytes = await readFile(join(output, ".velar-node-entry.mjs"));
    await writeFile(join(output, ".velar-node-entry.mjs"), `${entryBytes.toString("utf8")}\n`, "utf8");
    const tampered = spawnSync(process.execPath, [cli, "verify", output], {encoding: "utf8"});
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /size does not match|SHA-256 does not match/u);
    await writeFile(join(output, ".velar-node-entry.mjs"), entryBytes);
    await writeFile(join(output, "unexpected.txt"), "not declared\n", "utf8");
    const unexpected = spawnSync(process.execPath, [cli, "verify", output], {encoding: "utf8"});
    assert.notEqual(unexpected.status, 0);
    assert.match(unexpected.stderr, /undeclared file 'unexpected\.txt'/u);
    await rm(join(output, "unexpected.txt"));
    await symlink(join(output, ".velar-node-entry.mjs"), join(output, "linked-entry.mjs"));
    const linked = spawnSync(process.execPath, [cli, "verify", output], {encoding: "utf8"});
    assert.notEqual(linked.status, 0);
    assert.match(linked.stderr, /symbolic link 'linked-entry\.mjs'/u);
    await rm(join(output, "linked-entry.mjs"));

    running = spawn(process.execPath, [join(output, ".velar-node-entry.mjs")], {cwd: output, stdio: ["ignore", "pipe", "pipe"]});
    await expectHello(running, buildPort);
    await stop(running);
    running = null;

    const readableOutput = join(project, "readable");
    const readableBuild = spawnSync(process.execPath, [
      cli, "build", project, "--out-dir", readableOutput, "--mode", "readable",
    ], {encoding: "utf8"});
    assert.equal(readableBuild.status, 0, readableBuild.stderr);
    const readableReceipt = JSON.parse(await readFile(join(readableOutput, "velar-node.json"), "utf8")) as { mode?: unknown };
    assert.equal(readableReceipt.mode, "readable");
    assert.match(await readFile(join(readableOutput, ".velar-node-entry.mjs"), "utf8"), /Server\.parse\(await start\(\)\)/u);
  } finally {
    if (running && running.exitCode === null && running.signalCode === null) {
      running.kill("SIGKILL");
      await new Promise<void>((resolveExit) => running!.once("exit", () => resolveExit()));
    }
    await rm(directory, {recursive: true, force: true});
  }
});

test("Node application production build starts one shared HTTP and WebSocket port with Origin admission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-websocket-application-"));
  const project = join(directory, "service");
  let running: ChildProcess | null = null;
  try {
    const created = spawnSync(process.execPath, [cli, "create", project, "--template", "node"], {encoding: "utf8"});
    assert.equal(created.status, 0, created.stderr);
    const port = await availablePort();
    await writeFile(join(project, "application.yml"), serverYaml(port), "utf8");

    const output = join(project, "production");
    await writeFile(join(project, "src", "main.vel"), `import {listen} from "velar/websocket"

export async def start(port: number):
    return await listen({port})
`, "utf8");
    const rejected = spawnSync(process.execPath, [cli, "build", project, "--out-dir", output], {encoding: "utf8"});
    assert.notEqual(rejected.status, 0, "a WebSocket startup entry with the wrong parameter contract must fail the build");
    assert.match(rejected.stderr, /async zero-argument 'start' startup function/u);

    await writeFile(join(project, "src", "main.vel"), `import {configuration} from "velar/server"
import {app as routes} from "./app.vel"
import {listen} from "velar/websocket"

type SocketServerConfiguration:
    host: string
    port: number
    maxBodyBytes: number

type ApplicationConfiguration:
    server: SocketServerConfiguration

const config = await configuration(ApplicationConfiguration)

export async def start():
    return await listen({
        port: config.server.port,
        host: config.server.host,
        http: routes,
        path: "/api/events",
        origins: ["https://client.test"],
        maxBodyBytes: config.server.maxBodyBytes,
    })
`, "utf8");

    running = spawn(process.execPath, [cli, "serve", project], {stdio: ["ignore", "pipe", "pipe"]});
    await expectHello(running, port);
    assert.equal(await rejectedWebSocketStatus(`ws://127.0.0.1:${port}/api/events`, "https://untrusted.test"), 403);
    const servedSocket = await openedWebSocket(`ws://127.0.0.1:${port}/api/events`, "https://client.test");
    servedSocket.close();
    await stop(running);
    running = null;

    const built = spawnSync(process.execPath, [cli, "build", project, "--out-dir", output], {encoding: "utf8"});
    assert.equal(built.status, 0, built.stderr);
    assert.ok((await readdir(join(output, "node_modules", "ws"))).includes("package.json"), "production WebSocket builds must carry their framework runtime dependency");
    assert.ok((await readdir(join(output, "node_modules", "yaml"))).includes("package.json"), "production configured servers must carry their framework runtime dependency");
    const launcher = await readFile(join(output, ".velar-node-entry.mjs"), "utf8");
    assert.match(launcher, /VelarScript production server listening on port/u);
    assert.match(launcher, /\.parse\(await .+\(\)\)/u);

    running = spawn(process.execPath, [join(output, ".velar-node-entry.mjs")], {cwd: output, stdio: ["ignore", "pipe", "pipe"]});
    await expectHello(running, port);
    assert.equal(await rejectedWebSocketStatus(`ws://127.0.0.1:${port}/api/events`, "https://untrusted.test"), 403);
    const accepted = await openedWebSocket(`ws://127.0.0.1:${port}/api/events`, "https://client.test");
    accepted.close();
    await stop(running);
    running = null;
  } finally {
    if (running && running.exitCode === null && running.signalCode === null) {
      running.kill("SIGKILL");
      await new Promise<void>((resolveExit) => running!.once("exit", () => resolveExit()));
    }
    await rm(directory, {recursive: true, force: true});
  }
});

function serverYaml(port: number): string {
  return `server:\n  host: 127.0.0.1\n  port: ${port}\n  maxBodyBytes: 16777216\n`;
}

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

function rejectedWebSocketStatus(url: string, origin: string): Promise<number> {
  return new Promise((resolveStatus, rejectStatus) => {
    const socket = new WebSocket(url, {origin});
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => finish(() => rejectStatus(new Error("WebSocket rejection did not settle"))), 5_000);
    socket.once("unexpected-response", (_request, response) => finish(() => {
      response.resume();
      resolveStatus(response.statusCode ?? 0);
    }));
    socket.once("open", () => finish(() => {
      socket.close();
      rejectStatus(new Error("WebSocket Origin was unexpectedly accepted"));
    }));
    socket.once("error", error => finish(() => rejectStatus(error)));
  });
}

function openedWebSocket(url: string, origin: string): Promise<WebSocket> {
  return new Promise((resolveSocket, rejectSocket) => {
    const socket = new WebSocket(url, {origin});
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => finish(() => rejectSocket(new Error("WebSocket connection did not open"))), 5_000);
    socket.once("open", () => finish(() => resolveSocket(socket)));
    socket.once("unexpected-response", (_request, response) => finish(() => {
      response.resume();
      rejectSocket(new Error(`WebSocket handshake returned ${response.statusCode ?? 0}`));
    }));
    socket.once("error", error => finish(() => rejectSocket(error)));
  });
}
