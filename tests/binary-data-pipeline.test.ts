import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import { WebSocketServer } from "ws";
import { gzipSync } from "fflate";
import { startProductionPreview } from "../packages/cli/src/preview-server.ts";
import { verifyProductionBuild } from "../packages/cli/src/production-verifier.ts";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const fixture = join(root, "tests", "fixtures", "binary-data-pipeline");
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
  const directory = await mkdtemp(join(tmpdir(), "velar-range-lowering-"));
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
    assert.match(emitted, /const __velarRangeEnd/u);
    assert.match(emitted, /const __velarRangeStep/u);
    assert.match(emitted, /for \(; __velarRangeStep/u);
    assert.doesNotMatch(emitted, /for \([^;]*;[^;]*__velarRangeBounds/u);
    assert.doesNotMatch(emitted, /for \([^)]* of __velarRange/u);
    const module = await import(`${pathToFileURL(join(directory, "dist", "main.js")).href}?run=${Date.now()}`) as {
      rangeLoop(count: number): number;
      whileLoop(count: number): number;
    };
    const count = 1_000_000;
    for (let warmup = 0; warmup < 4; warmup += 1) {
      module.rangeLoop(count);
      module.whileLoop(count);
    }
    const rangeTimes: number[] = [];
    const whileTimes: number[] = [];
    const expected = 3_500_000;
    const batches = 8;
    for (let round = 0; round < 7; round += 1) {
      const measure = (operation: (value: number) => number): number => {
        const started = performance.now();
        for (let batch = 0; batch < batches; batch += 1) assert.equal(operation(count), expected);
        return performance.now() - started;
      };
      if (round % 2 === 0) {
        rangeTimes.push(measure(module.rangeLoop));
        whileTimes.push(measure(module.whileLoop));
      } else {
        whileTimes.push(measure(module.whileLoop));
        rangeTimes.push(measure(module.rangeLoop));
      }
    }
    const ratio = median(rangeTimes) / Math.max(median(whileTimes), 0.01);
    assert.ok(ratio < 4, `optimized range loop regressed to ${ratio.toFixed(1)}x the while loop`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("numeric buffers stay checked and decompression stops at maxBytes", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(root, ".velar-numeric-buffers-"));
  try {
    await writeFile(join(directory, "velar.json"), `${JSON.stringify({ formatVersion: 2, entry: "main.vel" }, null, 2)}\n`);
    await writeFile(join(directory, "main.vel"), `
import {ByteOrder, Bytes, Float32Buffer, float32Buffer, float32Builder, float32FromBytes, uint8Buffer, uint16Buffer, uint32Buffer, uint32Builder, uint32FromBytes} from "velar/binary"
import {gunzip} from "@velarscript/compression"

const environment = uint8Buffer(2)
environment[0] = 255
environment[1] = 7
const environmentCopy = environment.copy()
const samples = uint16Buffer(2)
samples[0] = 65535
const indices = uint32Buffer(2)
indices[0] = 0xffffffff
indices[1] = 9
const restoredIndices = uint32FromBytes(indices.slice(0, 1).toBytes(ByteOrder.big), ByteOrder.big)
const positions = float32Buffer(2)
positions[0] = 1.25
positions[1] = -2.5
const restoredPositions = float32FromBytes(positions.toBytes(ByteOrder.little), ByteOrder.little)
const indexBuilder = uint32Builder(2)
indexBuilder.push(3)
indexBuilder.push(4)
const builtIndices = indexBuilder.finish()
const positionBuilder = float32Builder(2)
positionBuilder.push(0.5)
const builtPositions = positionBuilder.finish()
print(f"{environmentCopy[0]}:{samples[0]}:{restoredIndices[0]}:{restoredPositions[0]}:{restoredPositions[1]}:{builtIndices.size}:{builtPositions.size}")

export def limitedGunzip(value: Bytes) -> Bytes:
    return gunzip(value, 1024)

export def defaultGunzip(value: Bytes) -> Bytes:
    return gunzip(value)

export def setEnvironment(value: number):
    environment[0] = value

export def setPosition(value: number):
    positions[0] = value

export def restorePosition(value: Bytes) -> Float32Buffer:
    return float32FromBytes(value, ByteOrder.little)

export def readEnvironment(index: number) -> number:
    return environment[index]

export def overflowBuilder():
    const builder = uint32Builder(1)
    builder.push(1)
    builder.push(2)
`.trimStart());
    await run(process.execPath, [cli, "build", directory], root);
    const output = await run(process.execPath, [join(directory, "dist", "main.js")], directory);
    assert.equal(output, "255:65535:4294967295:1.25:-2.5:2:1\n");
    const compressionDirectory = join(directory, "dist", "__velar_packages__", "@velarscript", "compression", "src");
    const compressionRuntime = (await Promise.all((await readdir(compressionDirectory))
      .filter(name => name.endsWith(".js"))
      .map(name => readFile(join(compressionDirectory, name), "utf8")))).join("\n");
    assert.match(compressionRuntime, /new (?:Gunzip|Unzlib)/u);
    assert.match(compressionRuntime, /estimated > 256/u);
    assert.match(compressionRuntime, /remaining \/ 1032/u);
    assert.doesNotMatch(compressionRuntime, /gunzipSync|unzlibSync|\{ out: storage \}|maximum \+ 1/u);
    const binary = await import(`${pathToFileURL(join(directory, "dist", "node_modules", "velar", "binary.js")).href}?float=${Date.now()}`) as {
      Bytes: { is(value: unknown): boolean; parse(value: unknown): Uint8Array };
      UInt8Buffer: { is(value: unknown): boolean; parse(value: unknown): Uint8Array };
      UInt16Buffer: { is(value: unknown): boolean; parse(value: unknown): Uint16Array };
      UInt32Buffer: { is(value: unknown): boolean; parse(value: unknown): Uint32Array };
      Float32Buffer: { is(value: unknown): boolean; parse(value: unknown): Float32Array };
    };
    const module = await import(`${pathToFileURL(join(directory, "dist", "main.js")).href}?bomb=${Date.now()}`) as {
      defaultGunzip(value: Uint8Array): Uint8Array;
      limitedGunzip(value: Uint8Array): Uint8Array;
      overflowBuilder(): void;
      readEnvironment(index: number): number;
      restorePosition(value: Uint8Array): Float32Array;
      setEnvironment(value: number): void;
      setPosition(value: number): void;
    };
    const bomb = gzipSync(new Uint8Array(2 * 1024 * 1024));
    assert.throws(() => module.limitedGunzip(bomb), /Decompressed output exceeds maxBytes/u);
    const bombPath = join(directory, "bomb.gz");
    const smallPath = join(directory, "small.gz");
    const allocationProbe = join(directory, "allocation-probe.mjs");
    await writeFile(bombPath, bomb);
    await writeFile(smallPath, gzipSync(Uint8Array.of(1, 2, 3, 4)));
    await writeFile(allocationProbe, `
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
const compressed = await readFile(process.argv[3]);
const small = await readFile(process.argv[4]);
const NativeUint8Array = globalThis.Uint8Array;
const nativeSubarray = NativeUint8Array.prototype.subarray;
let largestAllocation = 0;
let consumedEnd = 0;
globalThis.Uint8Array = new Proxy(NativeUint8Array, {
  construct(target, arguments_) {
    if (typeof arguments_[0] === "number") largestAllocation = Math.max(largestAllocation, arguments_[0]);
    return Reflect.construct(target, arguments_, target);
  },
});
Object.defineProperty(NativeUint8Array.prototype, "subarray", {configurable: true, writable: true, value(start, end) {
  if (this.byteLength === compressed.byteLength && this[0] === compressed[0] && this[1] === compressed[1] && typeof end === "number" && end >= 0) consumedEnd = Math.max(consumedEnd, end);
  return Reflect.apply(nativeSubarray, this, [start, end]);
}});
const module = await import(pathToFileURL(process.argv[2]).href + "?allocation-probe=" + Date.now());
largestAllocation = 0;
const restored = module.defaultGunzip(small);
if (restored.byteLength !== 4 || restored[0] !== 1 || restored[3] !== 4) throw new Error("Default gunzip changed the small payload");
const smallAllocation = largestAllocation;
largestAllocation = 0;
let rejected = false;
try { module.limitedGunzip(compressed); }
catch (error) { if (/Decompressed output exceeds maxBytes/u.test(String(error?.message))) rejected = true; else throw error; }
if (!rejected) throw new Error("The compressed bomb was not rejected");
console.log(JSON.stringify({smallAllocation, limitedAllocation: largestAllocation, consumedEnd, compressedBytes: compressed.byteLength}));
`.trimStart());
    const allocationOutput = await run(process.execPath, [allocationProbe, join(directory, "dist", "main.js"), bombPath, smallPath], directory);
    const allocation = JSON.parse(allocationOutput.trim().split("\n").at(-1)!) as { smallAllocation: number; limitedAllocation: number; consumedEnd: number; compressedBytes: number };
    assert.ok(allocation.smallAllocation < 1024 * 1024, `default gunzip allocated a ${allocation.smallAllocation}-byte Uint8Array for a four-byte payload`);
    assert.ok(allocation.limitedAllocation < 1024 * 1024, `limited gunzip allocated a ${allocation.limitedAllocation}-byte Uint8Array for a 1 KiB limit`);
    assert.ok(allocation.consumedEnd < allocation.compressedBytes / 4, `limited gunzip consumed ${allocation.consumedEnd} of ${allocation.compressedBytes} compressed bytes before stopping`);

    const largeBomb = gzipSync(new Uint8Array(64 * 1024 * 1024));
    const measureRejected = (value: Uint8Array): number => {
      const samples: number[] = [];
      for (let round = 0; round < 5; round += 1) {
        const started = performance.now();
        assert.throws(() => module.limitedGunzip(value), /Decompressed output exceeds maxBytes/u);
        samples.push(performance.now() - started);
      }
      return median(samples);
    };
    measureRejected(bomb);
    measureRejected(largeBomb);
    const smallBombTime = measureRejected(bomb);
    const largeBombTime = measureRejected(largeBomb);
    assert.ok(largeBombTime < smallBombTime * 8 + 5, `limited gunzip still scaled with full hostile output: 2 MiB ${smallBombTime.toFixed(2)}ms, 64 MiB ${largeBombTime.toFixed(2)}ms`);
    assert.throws(() => module.setEnvironment(256), /UInt8Buffer value/u);
    assert.throws(() => module.setPosition(Number.POSITIVE_INFINITY), /Float32Buffer value/u);
    assert.equal(binary.Float32Buffer.is(new Float32Array([Number.NaN])), false);
    assert.equal(binary.Float32Buffer.is(new Float32Array([Number.NEGATIVE_INFINITY])), false);
    assert.throws(() => binary.Float32Buffer.parse(new Float32Array([Number.NaN])), /Float32Buffer value/u);
    assert.throws(() => binary.Float32Buffer.parse(new Float32Array([Number.NEGATIVE_INFINITY])), /Float32Buffer value/u);
    assert.throws(() => module.restorePosition(Uint8Array.of(0, 0, 192, 127)), /Float32Buffer value/u);
    assert.throws(() => module.restorePosition(Uint8Array.of(0, 0, 128, 127)), /Float32Buffer value/u);
    assert.throws(() => module.readEnvironment(2), /UInt8Buffer index/u);
    assert.throws(() => module.overflowBuilder(), /exceeds maxElements/u);

    const maximumBytes = 64 * 1024 * 1024;
    const exactStorage = new ArrayBuffer(maximumBytes);
    const exactCases: Array<[string, { is(value: unknown): boolean; parse(value: unknown): ArrayBufferView }, ArrayBufferView]> = [
      ["Bytes", binary.Bytes, new Uint8Array(exactStorage)],
      ["UInt8Buffer", binary.UInt8Buffer, new Uint8Array(exactStorage)],
      ["UInt16Buffer", binary.UInt16Buffer, new Uint16Array(exactStorage)],
      ["UInt32Buffer", binary.UInt32Buffer, new Uint32Array(exactStorage)],
      ["Float32Buffer", binary.Float32Buffer, new Float32Array(exactStorage)],
    ];
    for (const [name, Type, value] of exactCases) {
      assert.equal(Type.is(value), true, `${name}.is rejected the exact 64 MiB boundary`);
      assert.equal(Type.parse(value).byteLength, maximumBytes, `${name}.parse rejected the exact 64 MiB boundary`);
    }
    const oversizedStorage = new ArrayBuffer(maximumBytes + 4);
    const oversizedCases: Array<[string, { is(value: unknown): boolean; parse(value: unknown): ArrayBufferView }, ArrayBufferView]> = [
      ["Bytes", binary.Bytes, new Uint8Array(oversizedStorage, 0, maximumBytes + 1)],
      ["UInt8Buffer", binary.UInt8Buffer, new Uint8Array(oversizedStorage, 0, maximumBytes + 1)],
      ["UInt16Buffer", binary.UInt16Buffer, new Uint16Array(oversizedStorage, 0, maximumBytes / 2 + 1)],
      ["UInt32Buffer", binary.UInt32Buffer, new Uint32Array(oversizedStorage, 0, maximumBytes / 4 + 1)],
      ["Float32Buffer", binary.Float32Buffer, new Float32Array(oversizedStorage, 0, maximumBytes / 4 + 1)],
    ];
    for (const [name, Type, value] of oversizedCases) {
      assert.equal(Type.is(value), false, `${name}.is accepted more than 64 MiB`);
      assert.throws(() => Type.parse(value), /64 MiB binary-memory limit/u, `${name}.parse copied more than 64 MiB`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("one shared binary data core runs through Node and Chromium with byte-identical persistence", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(root, ".velar-binary-data-pipeline-"));
  let preview: Awaited<ReturnType<typeof startProductionPreview>> | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let echoServer: WebSocketServer | null = null;
  try {
    await cp(fixture, directory, { recursive: true });
    for (const source of ["shared-data.vel", "data-worker.vel", "node-main.vel", "web-main.vel"]) {
      assert.doesNotMatch(await readFile(join(directory, "src", source), "utf8"), /unsafe\s+js/u);
    }

    await cp(join(directory, "velar.node.json"), join(directory, "velar.json"));
    await run(process.execPath, [cli, "build", directory], root);
    const nodeWorkerRuntime = await readFile(join(directory, "dist", "node_modules", "velar", "worker.js"), "utf8");
    assert.match(nodeWorkerRuntime, /visited < 10000/u);
    assert.match(nodeWorkerRuntime, /Uint32Array.*Float32Array/u);
    const nodeOutput = await run(process.execPath, [join(directory, "dist", "node-main.js")], directory);
    assert.match(nodeOutput, /^ready:\/health:2399488945:8192\n$/u);
    const nodeData = await readFile(join(directory, "snapshot.bin"));
    assert.equal(nodeData.byteLength, 8192);

    echoServer = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve, reject) => {
      echoServer!.once("listening", resolve);
      echoServer!.once("error", reject);
    });
    echoServer.on("connection", (socket, request) => {
      if (request.url?.includes("overflow=1")) {
        socket.send("12345678");
        socket.send("abcdefgh");
        return;
      }
      if (request.url?.includes("drain=1")) {
        socket.send("first");
        socket.send("second");
        socket.close(1000, "done");
        return;
      }
      socket.on("message", (data, binary) => socket.send(data, { binary }));
    });
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
    assert.equal((await readFile(join(directory, "dist", "data-worker.js"))).byteLength > 0, true);
    preview = await startProductionPreview(await verifyProductionBuild(join(directory, "dist")), 0);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on("console", message => { if (message.type() === "error") failures.push(message.text()); });
    page.on("pageerror", error => failures.push(error.stack ?? error.message));
    await page.goto(preview.url, { waitUntil: "load" });
    try {
      await page.waitForFunction(() => document.querySelector("[data-binary-data-pipeline]")?.getAttribute("data-binary-data-pipeline") !== "pending", undefined, { timeout: 30_000 });
    } catch (error) {
      assert.fail(`${String(error)}\n${failures.join("\n")}`);
    }
    assert.equal(await page.locator("[data-binary-data-pipeline]").getAttribute("data-binary-data-pipeline"), "2399488945:8192");
    const browserData = await page.evaluate(async () => {
      const request = indexedDB.open("velar:binary-data-pipeline", 1);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction("values", "readonly");
      const get = transaction.objectStore("values").get("snapshot-copy");
      const value = await new Promise<Uint8Array>((resolve, reject) => {
        get.onsuccess = () => resolve(get.result as Uint8Array);
        get.onerror = () => reject(get.error);
      });
      database.close();
      return Array.from(value);
    });
    assert.deepEqual(browserData, Array.from(nodeData));
    assert.deepEqual(failures, []);
  } finally {
    await browser?.close();
    await preview?.close();
    if (echoServer) await new Promise<void>(resolve => echoServer!.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
