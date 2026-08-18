import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import { WebSocketServer } from "ws";
import { startProductionPreview } from "../packages/cli/src/preview-server.ts";
import { verifyProductionBuild } from "../packages/cli/src/production-verifier.ts";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const fixture = join(root, "tests", "fixtures", "minecraft-readiness");
const cli = join(root, "packages", "cli", "dist", "cli.js");

async function run(executable: string, arguments_: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve(stdout) : reject(new Error(`${executable} ${arguments_.join(" ")} failed (${code})\n${stdout}${stderr}`)));
  });
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

test("direct range loops lower to bounded native counters without the historical hot-path penalty", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-range-readiness-"));
  try {
    await writeFile(join(directory, "velar.json"), `${JSON.stringify({ formatVersion: 2, entry: "main.vel" }, null, 2)}\n`);
    await writeFile(join(directory, "main.vel"), `
export def rangeLoop(count: number) -> number:
    let total = 0
    for index in range(count):
        total += index & 7
    return total

export def whileLoop(count: number) -> number:
    let total = 0
    let index = 0
    while index < count:
        total += index & 7
        index += 1
    return total
`.trimStart());
    await run(process.execPath, [cli, "build", directory], root);
    const emitted = await readFile(join(directory, "dist", "main.js"), "utf8");
    assert.match(emitted, /for \(let __velarRangeBounds/u);
    assert.doesNotMatch(emitted, /for \([^)]* of __velarRange/u);
    const module = await import(`${pathToFileURL(join(directory, "dist", "main.js")).href}?run=${Date.now()}`) as {
      rangeLoop(count: number): number;
      whileLoop(count: number): number;
    };
    const count = 1_000_000;
    module.rangeLoop(10_000);
    module.whileLoop(10_000);
    const rangeTimes: number[] = [];
    const whileTimes: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      let started = performance.now();
      assert.equal(module.rangeLoop(count), 3_500_000);
      rangeTimes.push(performance.now() - started);
      started = performance.now();
      assert.equal(module.whileLoop(count), 3_500_000);
      whileTimes.push(performance.now() - started);
    }
    const ratio = median(rangeTimes) / Math.max(median(whileTimes), 0.01);
    assert.ok(ratio < 10, `optimized range loop regressed to ${ratio.toFixed(1)}x the while loop`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Minecraft readiness runs one shared world core through Node and Chromium with byte-identical persistence", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-minecraft-readiness-"));
  let preview: Awaited<ReturnType<typeof startProductionPreview>> | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let echoServer: WebSocketServer | null = null;
  try {
    await cp(fixture, directory, { recursive: true });
    for (const source of ["world-core.vel", "terrain-worker.vel", "node-main.vel", "web-main.vel"]) {
      assert.doesNotMatch(await readFile(join(directory, "src", source), "utf8"), /unsafe\s+js/u);
    }

    await cp(join(directory, "velar.node.json"), join(directory, "velar.json"));
    await run(process.execPath, [cli, "build", directory], root);
    const nodeOutput = await run(process.execPath, [join(directory, "dist", "node-main.js")], directory);
    assert.match(nodeOutput, /^ready:\/health:2465281121:8192\n$/u);
    const nodeChunk = await readFile(join(directory, "chunk.bin"));
    assert.equal(nodeChunk.byteLength, 8192);

    echoServer = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve, reject) => {
      echoServer!.once("listening", resolve);
      echoServer!.once("error", reject);
    });
    echoServer.on("connection", socket => socket.on("message", (data, binary) => socket.send(data, { binary })));
    const echoAddress = echoServer.address();
    if (echoAddress === null || typeof echoAddress === "string") throw new Error("WebSocket echo server did not bind a TCP address");
    const socketUrl = `ws://127.0.0.1:${echoAddress.port}`;
    const webManifest = JSON.parse(await readFile(join(directory, "velar.web.json"), "utf8")) as {
      web: { publicConfig: { socketUrl: string }; security: { connectSources: string[] } };
    };
    webManifest.web.publicConfig.socketUrl = socketUrl;
    webManifest.web.security.connectSources = [socketUrl];
    await writeFile(join(directory, "velar.json"), `${JSON.stringify(webManifest, null, 2)}\n`);
    await run(process.execPath, [cli, "build", directory], root);
    assert.equal((await readFile(join(directory, "dist", "terrain-worker.js"))).byteLength > 0, true);
    preview = await startProductionPreview(await verifyProductionBuild(join(directory, "dist")), 0);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on("console", message => { if (message.type() === "error") failures.push(message.text()); });
    page.on("pageerror", error => failures.push(error.stack ?? error.message));
    await page.goto(preview.url, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("[data-minecraft-readiness]")?.getAttribute("data-minecraft-readiness") !== "pending", undefined, { timeout: 30_000 });
    assert.equal(await page.locator("[data-minecraft-readiness]").getAttribute("data-minecraft-readiness"), "2465281121:8192");
    const browserChunk = await page.evaluate(async () => {
      const request = indexedDB.open("velar:minecraft-readiness", 1);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction("values", "readonly");
      const get = transaction.objectStore("values").get("chunk-copy");
      const value = await new Promise<Uint8Array>((resolve, reject) => {
        get.onsuccess = () => resolve(get.result as Uint8Array);
        get.onerror = () => reject(get.error);
      });
      database.close();
      return Array.from(value);
    });
    assert.deepEqual(browserChunk, Array.from(nodeChunk));
    assert.deepEqual(failures, []);
  } finally {
    await browser?.close();
    await preview?.close();
    if (echoServer) await new Promise<void>(resolve => echoServer!.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
