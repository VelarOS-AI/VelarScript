import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { velarCompilerExtension } from "../packages/desktop/src/compiler.ts";
import { VELAR_TYPE_REGISTRY_KEY } from "../packages/compiler/src/runtime-abi.ts";
import { desktopBrowserTestInitScript } from "../packages/desktop/src/test-runtime.ts";

const bridgeKey = Symbol.for("velar.desktop.bridge.v1");

function registerRuntimeType<T extends object>(value: T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(VELAR_TYPE_REGISTRY_KEY));
  assert.ok(descriptor && "value" in descriptor);
  WeakSet.prototype.add.call(descriptor.value, value);
  return value;
}

test("Desktop renderer proxies preserve pull-based process and HTTP streaming", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-runtime-"));
  const calls: Array<{ capability: string; operation: string; args: readonly unknown[]; timeout: number }> = [];
  const processChunks = new Map<number, unknown[]>();
  const httpChunks = new Map<number, unknown[]>();
  const httpResponseFailures = new Set<number>();
  const pendingRequests = new Map<number, { reject(error: Error): void }>();
  const pendingProcessRead = { resolve: null as ((value: unknown) => void) | null };
  const languageServerMessages = ['{"jsonrpc":"2.0","id":1,"result":null}'];
  const stopWaitRace = { reject: null as ((error: Error) => void) | null };
  let pendingProcessReadDelivered = false;
  let hostileResponseReads = 0;
  let hostileProcessReads = 0;
  let hostileFilesystemReads = 0;
  let retriableProcessStops = 0;
  let retriableProcessWaits = 0;
  let transportProcessWaits = 0;
  let terminalProcessWaits = 0;
  let retainedRunStops = 0;
  let invalidProcessWaits = 0;
  let malformedWatcherCloses = 0;
  let currentProjectDirectory = directory;
  let selectedProjectDirectory: string | null = null;
  const transportFailure = (phase: "request" | "response"): Error => {
    const error = new Error(phase === "request" ? "HTTP request transport failed" : "HTTP response transport failed");
    Object.defineProperty(error, "name", { value: "VelarDesktopHttpTransportError" });
    Object.defineProperty(error, "phase", { value: phase, enumerable: true });
    return error;
  };
  const bridge = Object.freeze({
    platform: "test",
    packaged: false,
    projectDirectory: directory,
    projectDirectoryValue() { return currentProjectDirectory; },
    environment: Object.freeze({ LANG: "en_US.UTF-8" }),
    async invoke(capability: string, operation: string, args: readonly unknown[], timeout = 30000): Promise<unknown> {
      calls.push({ capability, operation, args, timeout });
      if (capability === "desktop") {
        if (operation === "homeDirectory") return "/home/test";
        if (operation === "appDataDirectory") return "/app-data/test";
        if (operation === "projectDirectory") return currentProjectDirectory;
        if (operation === "selectedProjectDirectory") return selectedProjectDirectory;
        if (operation === "selectProjectDirectory") {
          selectedProjectDirectory = join(directory, "selected");
          currentProjectDirectory = selectedProjectDirectory;
          return selectedProjectDirectory;
        }
      }
      if (capability === "language-server") {
        if (operation === "start") return 1_000_000_000;
        if (operation === "send" || operation === "close") return null;
        if (operation === "next") return languageServerMessages.shift() ?? null;
      }
      if (capability === "process" && operation === "start") {
        if (args[0] === "hostile-start") {
          return Object.defineProperty({ pid: 700 }, "handle", {
            enumerable: true,
            get() { hostileProcessReads += 1; return 8; },
          });
        }
        if (args[0] === "hostile-wait") return { handle: 8, pid: 700 };
        if (args[0] === "stream") {
          processChunks.set(9, [{ channel: "stdout", text: "one" }, { channel: "stderr", text: "two" }, null]);
          return { handle: 9, pid: 701 };
        }
        if (args[0] === "hostile-read") return { handle: 10, pid: 702 };
        if (args[0] === "pending-read") return { handle: 11, pid: 703 };
        if (args[0] === "retry-stop") return { handle: 12, pid: 704 };
        if (args[0] === "failed-stop") return { handle: 13, pid: 705 };
        if (args[0] === "retry-wait") return { handle: 14, pid: 706 };
        if (args[0] === "retry-run") return { handle: 15, pid: 707 };
        if (args[0] === "transport-wait") return { handle: 16, pid: 708 };
        if (args[0] === "terminal-wait") return { handle: 17, pid: 709 };
        if (args[0] === "invalid-wait") return { handle: 18, pid: 710 };
        if (args[0] === "stop-wait-race") return { handle: 19, pid: 711 };
        return { handle: 7, pid: 700 };
      }
      if (capability === "process" && operation === "read") {
        if (args[0] === 10) {
          return Object.defineProperty({ channel: "stdout" }, "text", {
            enumerable: true,
            get() { hostileProcessReads += 1; return "unsafe"; },
          });
        }
        if (args[0] === 11) {
          if (pendingProcessReadDelivered) return null;
          pendingProcessReadDelivered = true;
          return new Promise((resolve) => { pendingProcessRead.resolve = resolve; });
        }
        const chunks = processChunks.get(args[0] as number);
        if (!chunks?.length) return null;
        return chunks.shift();
      }
      if (capability === "process" && operation === "wait") {
        if (args[0] === 8) {
          return {
            result: Object.defineProperty({ code: 0, signal: null, stderr: "" }, "stdout", {
              enumerable: true,
              get() { hostileProcessReads += 1; return "unsafe"; },
            }),
            error: null,
            retained: false,
          };
        }
        if (args[0] === 9) return { result: { code: 0, signal: null, stdout: "one", stderr: "two" }, error: null, retained: false };
        if (args[0] === 14 && retriableProcessWaits++ === 0) {
          return { result: null, error: { name: "Error", message: "termination unconfirmed" }, retained: true };
        }
        if (args[0] === 15) return { result: null, error: { name: "Error", message: "run cleanup unconfirmed" }, retained: true };
        if (args[0] === 16 && transportProcessWaits++ === 0) throw new Error("process wait transport failed");
        if (args[0] === 17) {
          terminalProcessWaits += 1;
          return { result: null, error: { name: "Error", message: "terminal process failure" }, retained: false };
        }
        if (args[0] === 18 && invalidProcessWaits++ === 0) {
          return { result: { code: 0, signal: null, stdout: "invalid", stderr: "" }, error: null, retained: true };
        }
        if (args[0] === 19) return new Promise((_resolve, reject) => { stopWaitRace.reject = reject; });
        return { result: { code: 0, signal: null, stdout: "ready", stderr: "" }, error: null, retained: false };
      }
      if (capability === "process" && operation === "stop") {
        if (args[0] === 12 && retriableProcessStops++ === 0) throw new Error("termination unconfirmed");
        if (args[0] === 13) return { result: null, error: { name: "Error", message: "Process timed out before termination" } };
        if (args[0] === 15) retainedRunStops += 1;
        if (args[0] === 19) setImmediate(() => stopWaitRace.reject?.(new Error("process handle is unknown or already released")));
        return { result: { code: null, signal: "SIGTERM", stdout: "", stderr: "" }, error: null };
      }
      if (capability === "fs") {
        const path = args[0];
        if (operation === "watchStart") return path === "malformed-watch" ? 42 : 41;
        if (operation === "watchNext") return args[0] === 42
          ? { paths: ["/project/z.vel", "/project/a.vel"], rescan: false }
          : { paths: ["/project/note.txt"], rescan: false };
        if (operation === "watchClose") {
          if (args[0] === 42) malformedWatcherCloses += 1;
          return true;
        }
        if (operation === "readText") return path === "oversized.txt" ? "too large" : "value";
        if (operation === "replaceTextIfMatches") return path === "invalid-replace" ? "yes" : true;
        if (operation === "exists") return path === "invalid-exists" ? "yes" : true;
        if (operation === "list") {
          if (path === "hostile-list") {
            const value: string[] = [];
            Object.defineProperty(value, "0", { enumerable: true, get() { hostileFilesystemReads += 1; return "unsafe"; } });
            value.length = 1;
            return value;
          }
          return ["zeta", "alpha"];
        }
        if (operation === "info") {
          if (path === "hostile-info") {
            return Object.defineProperty({ kind: "file", size: 1, modifiedAt: 0 }, "name", {
              enumerable: true,
              get() { hostileFilesystemReads += 1; return "unsafe"; },
            });
          }
          return { name: "note.txt", kind: "file", size: 5, modifiedAt: 0 };
        }
        if (operation === "canonical") return "/project/note.txt";
        if (operation === "readBlob") return path === "invalid-blob" ? { base64: "%%%" } : { base64: "dmFsdWU=" };
        if (operation === "writeText" && path === "bad-result") return {};
        return null;
      }
      if (capability === "http" && operation === "request") {
        const handle = args[0] as number;
        const url = args[2] as string;
        if (url.endsWith("/transport-request")) throw transportFailure("request");
        if (url.endsWith("/transport-response")) {
          httpResponseFailures.add(handle);
          return { ok: true, status: 200, statusText: "OK", url, headers: [], body: true };
        }
        if (url.endsWith("/pending")) {
          return new Promise((_resolve, reject) => pendingRequests.set(handle, { reject }));
        }
        if (url.endsWith("/hostile-response")) {
          return Object.defineProperty({ ok: true, statusText: "OK", url, headers: [], body: false }, "status", {
            enumerable: true,
            get() { hostileResponseReads += 1; return 200; },
          });
        }
        if (url.endsWith("/invalid-response")) {
          return { ok: true, status: 200, statusText: "OK", url, headers: [], body: "yes" };
        }
        if (url.endsWith("/status-zero")) {
          return { ok: false, status: 0, statusText: "", url, headers: [], body: false };
        }
        if (url.endsWith("/inconsistent-status")) {
          return { ok: true, status: 500, statusText: "Internal Server Error", url, headers: [], body: false };
        }
        if (url.endsWith("/redirect-error")) {
          httpChunks.set(handle, [
            { done: false, text: '{"failed":true}' },
            { done: true, text: "" },
          ]);
          return {
            ok: false,
            status: 502,
            statusText: "Bad Gateway",
            url: "https://final.example.test/failure",
            headers: [["content-type", "application/json"]],
            body: true,
          };
        }
        if (url.endsWith("/empty")) {
          return { ok: true, status: 204, statusText: "No Content", url, headers: [], body: false };
        }
        if (url.endsWith("/too-many-chunks")) {
          httpChunks.set(handle, [
            { done: false, text: "" }, { done: false, text: "" },
            { done: false, text: "" }, { done: false, text: "" },
            { done: true, text: "" },
          ]);
          return { ok: true, status: 200, statusText: "OK", url, headers: [], body: true };
        }
        if (url.endsWith("/invalid-chunk")) {
          httpChunks.set(handle, [{ done: false, text: "", extra: true }]);
          return { ok: true, status: 200, statusText: "OK", url, headers: [], body: true };
        }
        if (url.endsWith("/cancel-final")) {
          httpChunks.set(handle, [{ done: true, text: "final" }]);
          return { ok: true, status: 200, statusText: "OK", url, headers: [], body: true };
        }
        const typed = url.endsWith("/typed");
        const lossy = typed || url.endsWith("/lossy-json") || url.endsWith("/lossy-error");
        httpChunks.set(handle, lossy
          ? [{ done: false, text: typed ? '{"name":"Ada"}' : url.endsWith("/lossy-json") ? '{"value":1e400}' : "1e400" }, { done: true, text: "" }]
          : [{ done: false, text: "first " }, { done: false, text: "chunk" }, { done: true, text: "" }]);
        const failed = url.endsWith("/lossy-error");
        return { ok: !failed, status: failed ? 500 : 200, statusText: failed ? "Internal Server Error" : "OK", url, headers: [["content-type", lossy ? "application/json" : "text/plain"]], body: true };
      }
      if (capability === "http" && operation === "read") {
        if (httpResponseFailures.delete(args[0] as number)) throw transportFailure("response");
        const chunks = httpChunks.get(args[0] as number);
        if (!chunks?.length) throw new Error("missing HTTP chunk");
        return chunks.shift();
      }
      if (capability === "http" && operation === "cancel") {
        pendingRequests.get(args[0] as number)?.reject(new Error("HTTP request cancelled"));
        pendingRequests.delete(args[0] as number);
        return null;
      }
      throw new Error(`Unexpected Desktop bridge call ${capability}.${operation}`);
    },
  });
  Object.defineProperty(globalThis, bridgeKey, { value: bridge, configurable: true });
  try {
    const processRuntime = await runtime<{
      readonly ProcessOutputChannel: Readonly<{ readonly stdout: "stdout"; readonly stderr: "stderr" }>;
      start(command: string, args?: readonly string[], options?: Record<PropertyKey, unknown>): Promise<{
        readonly pid: number;
        next(): Promise<Readonly<{ readonly channel: "stdout" | "stderr"; readonly text: string }> | null>;
        wait(): Promise<{ readonly signal: string | null; readonly stdout: string; readonly stderr: string }>;
        stop(): Promise<null>;
      }>;
      run(command: string): Promise<{ readonly stdout: string }>;
    }>(directory, "process", "velar/process");
    assert.deepEqual(
      { stdout: processRuntime.ProcessOutputChannel.stdout, stderr: processRuntime.ProcessOutputChannel.stderr },
      { stdout: "stdout", stderr: "stderr" },
    );
    const child = await processRuntime.start("node");
    assert.equal(child.pid, 700);
    assert.equal((await child.wait()).stdout, "ready");
    assert.equal((await child.wait()).stdout, "ready");
    assert.equal((await processRuntime.run("node")).stdout, "ready");
    const processCallsBeforeValidation = calls.filter((call) => call.capability === "process" && call.operation === "start").length;
    let processOptionReads = 0;
    const processAccessorOptions = Object.defineProperty({}, "cwd", {
      enumerable: true,
      get() { processOptionReads += 1; return directory; },
    });
    await assert.rejects(processRuntime.start("node", [], processAccessorOptions), /enumerable data values/u);
    assert.equal(processOptionReads, 0);
    let processArgumentReads = 0;
    const processAccessorArguments: string[] = [];
    Object.defineProperty(processAccessorArguments, "0", {
      enumerable: true,
      configurable: true,
      get() { processArgumentReads += 1; return "--version"; },
    });
    processAccessorArguments.length = 1;
    await assert.rejects(processRuntime.start("node", processAccessorArguments), /enumerable data values/u);
    assert.equal(processArgumentReads, 0);
    await assert.rejects(processRuntime.start("node", [], { unexpected: true }), /unknown field 'unexpected'/u);
    await assert.rejects(processRuntime.start("node", ["x".repeat(600_000), "y".repeat(600_000)]), /arguments cannot exceed 1 MiB/u);
    assert.equal(calls.filter((call) => call.capability === "process" && call.operation === "start").length, processCallsBeforeValidation);
    await assert.rejects(processRuntime.start("hostile-start"), /enumerable data values/u);
    assert.equal(hostileProcessReads, 0);
    const hostileWait = await processRuntime.start("hostile-wait");
    await assert.rejects(hostileWait.wait(), /enumerable data values/u);
    assert.equal(hostileProcessReads, 0);

    const retriableStop = await processRuntime.start("retry-stop");
    await assert.rejects(retriableStop.stop(), /termination unconfirmed/u);
    await assert.rejects(retriableStop.next(), /unavailable after stop/u);
    await retriableStop.stop();
    assert.equal(retriableProcessStops, 2);
    assert.deepEqual(await retriableStop.wait(), { code: null, signal: "SIGTERM", stdout: "", stderr: "" });

    const failedStop = await processRuntime.start("failed-stop");
    await failedStop.stop();
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(failedStop.wait(), /timed out before termination/u);

    const retriableWait = await processRuntime.start("retry-wait");
    const firstRetriableWait = retriableWait.wait();
    assert.equal(retriableWait.wait(), firstRetriableWait);
    await assert.rejects(firstRetriableWait, /termination unconfirmed/u);
    assert.equal((await retriableWait.wait()).stdout, "ready");
    assert.equal(retriableProcessWaits, 2);

    const transportWait = await processRuntime.start("transport-wait");
    await assert.rejects(transportWait.wait(), /process wait transport failed/u);
    assert.equal((await transportWait.wait()).stdout, "ready");
    assert.equal(transportProcessWaits, 2);

    const terminalWait = await processRuntime.start("terminal-wait");
    const firstTerminalWait = terminalWait.wait();
    assert.equal(terminalWait.wait(), firstTerminalWait);
    await assert.rejects(firstTerminalWait, /terminal process failure/u);
    await assert.rejects(terminalWait.wait(), /terminal process failure/u);
    assert.equal(terminalProcessWaits, 1);

    const invalidWait = await processRuntime.start("invalid-wait");
    await assert.rejects(invalidWait.wait(), /invalid or contradictory/u);
    assert.equal((await invalidWait.wait()).stdout, "ready");
    assert.equal(invalidProcessWaits, 2);

    const stopWaitOwner = await processRuntime.start("stop-wait-race");
    const losingWait = stopWaitOwner.wait();
    await stopWaitOwner.stop();
    await assert.rejects(losingWait, /unknown or already released/u);
    assert.equal((await stopWaitOwner.wait()).signal, "SIGTERM");

    await assert.rejects(processRuntime.run("retry-run"), /run cleanup unconfirmed/u);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(retainedRunStops, 1);

    const processStream = await processRuntime.start("stream");
    assert.deepEqual(await processStream.next(), { channel: "stdout", text: "one" });
    assert.deepEqual(await processStream.next(), { channel: "stderr", text: "two" });
    assert.equal(await processStream.next(), null);
    assert.deepEqual(await processStream.wait(), { code: 0, signal: null, stdout: "one", stderr: "two" });
    await assert.rejects(processStream.next(), /consumed before wait/u);
    assert.ok(calls.some((call) => call.capability === "process" && call.operation === "read" && call.timeout === 0));

    const processIntrinsicDescriptors = {
      arrayIsArray: Object.getOwnPropertyDescriptor(Array, "isArray")!,
      mapEntries: Object.getOwnPropertyDescriptor(Map.prototype, "entries")!,
      mapSize: Object.getOwnPropertyDescriptor(Map.prototype, "size")!,
      numberIsSafeInteger: Object.getOwnPropertyDescriptor(Number, "isSafeInteger")!,
      objectCreate: Object.getOwnPropertyDescriptor(Object, "create")!,
      objectFreeze: Object.getOwnPropertyDescriptor(Object, "freeze")!,
      objectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")!,
      objectGetPrototypeOf: Object.getOwnPropertyDescriptor(Object, "getPrototypeOf")!,
      objectSeal: Object.getOwnPropertyDescriptor(Object, "seal")!,
      reflectOwnKeys: Object.getOwnPropertyDescriptor(Reflect, "ownKeys")!,
      regExpTest: Object.getOwnPropertyDescriptor(RegExp.prototype, "test")!,
      setHas: Object.getOwnPropertyDescriptor(Set.prototype, "has")!,
      stringIncludes: Object.getOwnPropertyDescriptor(String.prototype, "includes")!,
    };
    let processPoisonCalls = 0;
    const poison = () => { processPoisonCalls += 1; throw new Error("poisoned process intrinsic"); };
    const capturedChunks: Array<Readonly<{ readonly channel: "stdout" | "stderr"; readonly text: string }>> = [];
    let capturedResult: { readonly stdout: string; readonly stderr: string } | null = null;
    try {
      Object.defineProperty(Array, "isArray", { ...processIntrinsicDescriptors.arrayIsArray, value: poison });
      Object.defineProperty(Map.prototype, "entries", { ...processIntrinsicDescriptors.mapEntries, value: poison });
      Object.defineProperty(Map.prototype, "size", { ...processIntrinsicDescriptors.mapSize, get: poison });
      Object.defineProperty(Number, "isSafeInteger", { ...processIntrinsicDescriptors.numberIsSafeInteger, value: poison });
      Object.defineProperty(Object, "create", { ...processIntrinsicDescriptors.objectCreate, value: poison });
      Object.defineProperty(Object, "freeze", { ...processIntrinsicDescriptors.objectFreeze, value: poison });
      Object.defineProperty(Object, "getOwnPropertyDescriptor", { ...processIntrinsicDescriptors.objectGetOwnPropertyDescriptor, value: poison });
      Object.defineProperty(Object, "getPrototypeOf", { ...processIntrinsicDescriptors.objectGetPrototypeOf, value: poison });
      Object.defineProperty(Object, "seal", { ...processIntrinsicDescriptors.objectSeal, value: poison });
      Object.defineProperty(Reflect, "ownKeys", { ...processIntrinsicDescriptors.reflectOwnKeys, value: poison });
      Object.defineProperty(RegExp.prototype, "test", { ...processIntrinsicDescriptors.regExpTest, value: poison });
      Object.defineProperty(Set.prototype, "has", { ...processIntrinsicDescriptors.setHas, value: poison });
      Object.defineProperty(String.prototype, "includes", { ...processIntrinsicDescriptors.stringIncludes, value: poison });
      const capturedProcess = await processRuntime.start("stream", [], { env: new Map([["SAFE", "value"]]) });
      while (true) {
        const chunk = await capturedProcess.next();
        if (chunk === null) break;
        capturedChunks.push(chunk);
      }
      capturedResult = await capturedProcess.wait();
    } finally {
      Object.defineProperty(Array, "isArray", processIntrinsicDescriptors.arrayIsArray);
      Object.defineProperty(Map.prototype, "entries", processIntrinsicDescriptors.mapEntries);
      Object.defineProperty(Map.prototype, "size", processIntrinsicDescriptors.mapSize);
      Object.defineProperty(Number, "isSafeInteger", processIntrinsicDescriptors.numberIsSafeInteger);
      Object.defineProperty(Object, "create", processIntrinsicDescriptors.objectCreate);
      Object.defineProperty(Object, "freeze", processIntrinsicDescriptors.objectFreeze);
      Object.defineProperty(Object, "getOwnPropertyDescriptor", processIntrinsicDescriptors.objectGetOwnPropertyDescriptor);
      Object.defineProperty(Object, "getPrototypeOf", processIntrinsicDescriptors.objectGetPrototypeOf);
      Object.defineProperty(Object, "seal", processIntrinsicDescriptors.objectSeal);
      Object.defineProperty(Reflect, "ownKeys", processIntrinsicDescriptors.reflectOwnKeys);
      Object.defineProperty(RegExp.prototype, "test", processIntrinsicDescriptors.regExpTest);
      Object.defineProperty(Set.prototype, "has", processIntrinsicDescriptors.setHas);
      Object.defineProperty(String.prototype, "includes", processIntrinsicDescriptors.stringIncludes);
    }
    assert.equal(processPoisonCalls, 0);
    assert.deepEqual(capturedChunks, [{ channel: "stdout", text: "one" }, { channel: "stderr", text: "two" }]);
    assert.deepEqual(capturedResult, { code: 0, signal: null, stdout: "one", stderr: "two" });

    const hostileRead = await processRuntime.start("hostile-read");
    await assert.rejects(hostileRead.next(), /enumerable data values/u);
    assert.equal(hostileProcessReads, 0);

    const pendingRead = await processRuntime.start("pending-read");
    const firstRead = pendingRead.next();
    await assert.rejects(pendingRead.next(), /only one active pull/u);
    await assert.rejects(pendingRead.wait(), /while next\(\) is pending/u);
    assert.ok(pendingProcessRead.resolve);
    pendingProcessRead.resolve({ channel: "stdout", text: "ready" });
    assert.deepEqual(await firstRead, { channel: "stdout", text: "ready" });
    assert.equal(await pendingRead.next(), null);
    await pendingRead.wait();

    const fsRuntime = await runtime<{
      Blob: new (...args: unknown[]) => unknown;
      readText(path: string, maxBytes?: number): Promise<string>;
      createText(path: string, text: string): Promise<null>;
      replaceTextIfMatches(path: string, expected: string, replacement: string): Promise<boolean>;
      writeText(path: string, text: string): Promise<null>;
      exists(path: string): Promise<boolean>;
      list(path: string, maxItems?: number): Promise<string[]>;
      info(path: string): Promise<{ readonly name: string; readonly kind: string } | null>;
      canonical(path: string): Promise<string>;
      readBlob(path: string, maxBytes?: number): Promise<unknown>;
      watchFiles(path: string, recursive?: boolean): Promise<{
        next(): Promise<{ readonly paths: readonly string[]; readonly rescan: boolean } | null>;
        close(): Promise<null>;
      }>;
    }>(directory, "fs", "velar/fs");
    assert.equal(await fsRuntime.readText("note.txt", 16), "value");
    assert.equal(await fsRuntime.createText("created.txt", "value"), null);
    assert.equal(await fsRuntime.replaceTextIfMatches("note.txt", "value", "next"), true);
    await assert.rejects(fsRuntime.replaceTextIfMatches("invalid-replace", "value", "next"), /invalid replaceTextIfMatches result/u);
    await assert.rejects(fsRuntime.readText("oversized.txt", 4), /exceeds maxBytes/u);
    const fsCallsBeforeValidation = calls.filter((call) => call.capability === "fs").length;
    await assert.rejects(fsRuntime.readText("", 16), /non-empty path/u);
    await assert.rejects(fsRuntime.readText("note.txt", 0), /maxBytes/u);
    assert.equal(calls.filter((call) => call.capability === "fs").length, fsCallsBeforeValidation);
    assert.deepEqual(await fsRuntime.list(".", 2), ["alpha", "zeta"]);
    await assert.rejects(fsRuntime.list("hostile-list"), /invalid directory list/u);
    assert.equal(hostileFilesystemReads, 0);
    assert.deepEqual(await fsRuntime.info("note.txt"), { name: "note.txt", kind: "file", size: 5, modifiedAt: 0 });
    await assert.rejects(fsRuntime.info("hostile-info"), /enumerable data values/u);
    assert.equal(hostileFilesystemReads, 0);
    assert.equal(await fsRuntime.canonical("note.txt"), "/project/note.txt");
    assert.equal(await fsRuntime.exists("note.txt"), true);
    await assert.rejects(fsRuntime.exists("invalid-exists"), /invalid file existence/u);
    assert.ok(await fsRuntime.readBlob("note.txt", 16) instanceof fsRuntime.Blob);
    await assert.rejects(fsRuntime.readBlob("invalid-blob", 16), /invalid Blob/u);
    await assert.rejects(fsRuntime.writeText("bad-result", "value"), /invalid writeText result/u);
    const watcher = await fsRuntime.watchFiles(".", true);
    const fileWatchBatch = await watcher.next();
    assert.deepEqual(fileWatchBatch, { paths: ["/project/note.txt"], rescan: false });
    assert.equal(Object.isFrozen(fileWatchBatch?.paths), false);
    assert.equal(calls.at(-1)?.timeout, 0);
    assert.equal(await watcher.close(), null);
    assert.equal(await watcher.next(), null);
    const malformedWatcher = await fsRuntime.watchFiles("malformed-watch", true);
    await assert.rejects(malformedWatcher.next(), /invalid file watch paths/u);
    assert.equal(malformedWatcherCloses, 1);
    assert.equal(await malformedWatcher.next(), null);

    const pathRuntime = await runtime<{
      basename(path: string): string;
      contains(root: string, target: string): boolean;
      dirname(path: string): string;
      extension(path: string): string;
      fromFileUrl(url: string): string;
      isAbsolute(path: string): boolean;
      join(parts?: readonly string[]): string;
      normalize(path: string): string;
      relative(from: string, to: string): string;
      resolve(parts?: readonly string[]): string;
      toFileUrl(path: string): string;
    }>(directory, "path", "velar/path");
    assert.equal(pathRuntime.resolve(["src", "main.vel"]), `${directory}/src/main.vel`);
    const encodedPath = `${directory}/space and 雪#100%.vel`;
    const encodedUrl = pathRuntime.toFileUrl(encodedPath);
    assert.equal(encodedUrl, pathToFileURL(encodedPath).href);
    assert.equal(pathRuntime.fromFileUrl(encodedUrl), encodedPath);
    assert.equal(pathRuntime.fromFileUrl(`file://localhost${pathToFileURL(encodedPath).pathname}`), encodedPath);
    assert.throws(() => pathRuntime.fromFileUrl("https://example.test/main.vel"), /requires a local file URL/u);
    assert.throws(() => pathRuntime.fromFileUrl("file:///project%2Fescape.vel"), /requires a local file URL/u);
    assert.equal(pathRuntime.join(["src", "main.vel"]), "src/main.vel");
    assert.equal(pathRuntime.contains(directory, `${directory}/src/main.vel`), true);
    assert.equal(pathRuntime.contains(`${directory}/src`, directory), false);
    assert.throws(() => pathRuntime.join(["x".repeat(4096), "tail"]), /result is outside/u);
    assert.throws(() => pathRuntime.resolve(["x".repeat(4096)]), /result is outside/u);
    let pathPartReads = 0;
    const pathParts: string[] = [];
    Object.defineProperty(pathParts, "0", {
      enumerable: true,
      configurable: true,
      get() { pathPartReads += 1; return "src"; },
    });
    pathParts.length = 1;
    assert.throws(() => pathRuntime.join(pathParts), /enumerable data values/u);
    assert.equal(pathPartReads, 0);
    const sparsePathParts: string[] = [];
    sparsePathParts.length = 1;
    assert.throws(() => pathRuntime.join(sparsePathParts), /enumerable data values/u);

    const pathSamples = [
      ".", "..", "...", ".profile", "..profile", "foo", "foo/", "foo/.", "foo/..", "foo/../bar",
      "foo/./bar", "foo/bar/../", "a//b///c", "../a/..", "/", "//", "///foo", "//foo/bar",
      "/foo/.", "/foo/..", "foo.", "foo..bar", "foo/.hidden", "foo/a..b",
    ];
    const pathCorpus = new Set(pathSamples);
    const pathAtoms = ["a", "b", ".", "..", ".hidden", "a.b", "...", "x-"];
    for (const left of pathAtoms) {
      pathCorpus.add(left);
      pathCorpus.add(`/${left}`);
      pathCorpus.add(`//${left}`);
      pathCorpus.add(`${left}/`);
      for (const right of pathAtoms) {
        for (const separator of ["/", "//", "///"]) {
          pathCorpus.add(`${left}${separator}${right}`);
          pathCorpus.add(`/${left}${separator}${right}`);
          pathCorpus.add(`${left}${separator}${right}/`);
        }
      }
    }
    for (const value of pathCorpus) {
      assert.equal(pathRuntime.normalize(value), posix.normalize(value), `normalize(${JSON.stringify(value)})`);
      assert.equal(pathRuntime.dirname(value), posix.dirname(value), `dirname(${JSON.stringify(value)})`);
      assert.equal(pathRuntime.basename(value), posix.basename(value), `basename(${JSON.stringify(value)})`);
      assert.equal(pathRuntime.extension(value), posix.extname(value), `extension(${JSON.stringify(value)})`);
      assert.equal(pathRuntime.isAbsolute(value), posix.isAbsolute(value), `isAbsolute(${JSON.stringify(value)})`);
    }
    const partSamples = [
      [] as string[],
      ["src", "main.vel"],
      ["src", "..", "main.vel"],
      ["/tmp", "nested", "..", "note.txt"],
      ["alpha", "/absolute", "tail"],
    ];
    for (const values of partSamples) {
      assert.equal(pathRuntime.join(values), posix.join(...values), `join(${JSON.stringify(values)})`);
      assert.equal(pathRuntime.resolve(values), posix.resolve(directory, ...values), `resolve(${JSON.stringify(values)})`);
    }
    const relativeSamples = [
      [".", "."], [".", "src/main.vel"], ["src", "src/main.vel"], ["src/main.vel", "src"],
      ["foo/..", "bar"], ["/tmp/one", "/tmp/two"], ["../one", "../two"],
    ] as const;
    for (const [from, to] of relativeSamples) {
      assert.equal(
        pathRuntime.relative(from, to),
        posix.relative(posix.resolve(directory, from), posix.resolve(directory, to)),
        `relative(${JSON.stringify(from)}, ${JSON.stringify(to)})`,
      );
    }
    for (const from of pathCorpus) {
      for (const to of pathCorpus) {
        assert.equal(
          pathRuntime.relative(from, to),
          posix.relative(posix.resolve(directory, from), posix.resolve(directory, to)),
          `relative(${JSON.stringify(from)}, ${JSON.stringify(to)})`,
        );
      }
    }
    const defineProperty = Object.defineProperty;
    const stringIndexOf = Object.getOwnPropertyDescriptor(String.prototype, "indexOf")!;
    const stringSlice = Object.getOwnPropertyDescriptor(String.prototype, "slice")!;
    const stringToLowerCase = Object.getOwnPropertyDescriptor(String.prototype, "toLowerCase")!;
    const urlPathname = Object.getOwnPropertyDescriptor(URL.prototype, "pathname")!;
    const urlProtocol = Object.getOwnPropertyDescriptor(URL.prototype, "protocol")!;
    const arrayJoin = Object.getOwnPropertyDescriptor(Array.prototype, "join")!;
    const arrayIsArray = Object.getOwnPropertyDescriptor(Array, "isArray")!;
    const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")!;
    let capturedJoin = "";
    let capturedExtension = "";
    let capturedContains = false;
    try {
      defineProperty(String.prototype, "indexOf", { ...stringIndexOf, value: () => { throw new Error("poisoned indexOf"); } });
      defineProperty(String.prototype, "slice", { ...stringSlice, value: () => { throw new Error("poisoned slice"); } });
      defineProperty(String.prototype, "toLowerCase", { ...stringToLowerCase, value: () => { throw new Error("poisoned toLowerCase"); } });
      defineProperty(URL.prototype, "pathname", { ...urlPathname, get: () => { throw new Error("poisoned URL pathname"); } });
      defineProperty(URL.prototype, "protocol", { ...urlProtocol, get: () => { throw new Error("poisoned URL protocol"); } });
      defineProperty(Array.prototype, "join", { ...arrayJoin, value: () => { throw new Error("poisoned join"); } });
      defineProperty(Array, "isArray", { ...arrayIsArray, value: () => { throw new Error("poisoned isArray"); } });
      defineProperty(Object, "getOwnPropertyDescriptor", { ...getOwnPropertyDescriptor, value: () => { throw new Error("poisoned descriptor"); } });
      capturedJoin = pathRuntime.join(["alpha", "..", "stable.txt"]);
      capturedExtension = pathRuntime.extension("archive.tar.gz");
      capturedContains = pathRuntime.contains(directory, `${directory}/stable.txt`);
      assert.equal(pathRuntime.fromFileUrl(pathRuntime.toFileUrl(`${directory}/stable.txt`)), `${directory}/stable.txt`);
    } finally {
      defineProperty(String.prototype, "indexOf", stringIndexOf);
      defineProperty(String.prototype, "slice", stringSlice);
      defineProperty(String.prototype, "toLowerCase", stringToLowerCase);
      defineProperty(URL.prototype, "pathname", urlPathname);
      defineProperty(URL.prototype, "protocol", urlProtocol);
      defineProperty(Array.prototype, "join", arrayJoin);
      defineProperty(Array, "isArray", arrayIsArray);
      defineProperty(Object, "getOwnPropertyDescriptor", getOwnPropertyDescriptor);
    }
    assert.equal(capturedJoin, "stable.txt");
    assert.equal(capturedExtension, ".gz");
    assert.equal(capturedContains, true);

    const desktopRuntime = await runtime<{
      appDataDirectory(): Promise<string>;
      homeDirectory(): Promise<string>;
      packaged(): boolean;
      platform(): string;
      projectDirectory(): Promise<string>;
      selectedProjectDirectory(): Promise<string | null>;
      selectProjectDirectory(): Promise<string | null>;
      LanguageServer: { is(value: unknown): boolean; parse(value: unknown): unknown };
      languageServer(): Promise<{ send(message: string): Promise<null>; next(): Promise<string | null>; close(): Promise<null> }>;
    }>(directory, "desktop", "velar/desktop");
    assert.equal(desktopRuntime.platform(), "test");
    assert.equal(desktopRuntime.packaged(), false);
    assert.equal(await desktopRuntime.homeDirectory(), "/home/test");
    assert.equal(await desktopRuntime.appDataDirectory(), "/app-data/test");
    assert.equal(await desktopRuntime.projectDirectory(), directory);
    assert.equal(await desktopRuntime.selectedProjectDirectory(), null);
    assert.equal(await desktopRuntime.selectProjectDirectory(), join(directory, "selected"));
    assert.equal(calls.find((call) => call.capability === "desktop" && call.operation === "selectProjectDirectory")?.timeout, 0);
    assert.equal(await desktopRuntime.selectedProjectDirectory(), join(directory, "selected"));
    assert.equal(await desktopRuntime.projectDirectory(), join(directory, "selected"));
    assert.equal(pathRuntime.resolve(["dynamic.vel"]), join(directory, "selected", "dynamic.vel"));
    const languageServer = await desktopRuntime.languageServer();
    assert.equal(desktopRuntime.LanguageServer.is(languageServer), true);
    assert.equal(desktopRuntime.LanguageServer.parse(languageServer), languageServer);
    assert.equal(await languageServer.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'), null);
    assert.equal(await languageServer.next(), '{"jsonrpc":"2.0","id":1,"result":null}');
    assert.equal(calls.find((call) => call.capability === "language-server" && call.operation === "next")?.timeout, 0);
    assert.equal(await languageServer.close(), null);
    assert.equal(await languageServer.next(), null);

    const environment = await runtime<{ get(name: string): string | null; require(name: string): string }>(directory, "env", "velar/env");
    assert.equal(environment.get("LANG"), "en_US.UTF-8");
    assert.equal(environment.get("SECRET"), null);
    assert.throws(() => environment.require("SECRET"), /is required/u);

    const httpRuntime = await runtime<{
      secretHeader(name: string, environment: string, prefix?: string): Readonly<{ name: string; environment: string; prefix: string }>;
      http: {
        request(method: string, url: string, options?: Record<string, unknown>): { text(): Promise<string> };
        get(url: string, options?: Record<string, unknown>): {
          streamText(consumer: (chunk: string) => Promise<null>): Promise<null>;
          json(): Promise<unknown>;
          text(): Promise<string>;
          parse<T>(target: { parse(value: unknown): T }): Promise<T>;
          response(): Promise<{ json(): Promise<unknown>; parse<T>(target: { parse(value: unknown): T }): Promise<T>; text(): Promise<string> }>;
          cancel(): null;
        };
        post(url: string, options?: Record<string, unknown>): { text(): Promise<string> };
      };
      HttpAbortError: new (reason: string) => Error & { readonly reason: string };
      HttpError: new (...args: unknown[]) => Error & { readonly body: unknown; readonly url: string };
      HttpTransportError: new (...args: unknown[]) => Error & { readonly phase: "request" | "response" };
      HttpTransportPhase: Readonly<{ readonly request: "request"; readonly response: "response" }>;
    }>(directory, "http", "velar/http", (source) => source.replace("const maxResponseChunks = 1000000;", "const maxResponseChunks = 3;"));
    const User = registerRuntimeType(Object.freeze({
      parse(value: unknown): { name: string } {
        if (!value || typeof value !== "object" || (value as { name?: unknown }).name !== "Ada") throw new TypeError("invalid User");
        return value as { name: string };
      },
    }));
    const requestsBeforeValidation = calls.filter((call) => call.capability === "http" && call.operation === "request").length;
    assert.throws(() => httpRuntime.http.request("TRACE", "https://example.test/"), /invalid or forbidden/u);
    assert.throws(() => httpRuntime.http.get("file:///tmp/value"), /must use http or https/u);
    assert.throws(() => httpRuntime.http.get("https://user:secret@example.test/"), /credentials are not allowed/u);
    assert.throws(() => new httpRuntime.HttpError("x".repeat(65537), 400, "https://example.test/"), RangeError);
    assert.throws(() => new httpRuntime.HttpError("message", 400, "x".repeat(2 * 1024 * 1024 + 1)), RangeError);
    const oversizedHttpBody = "é".repeat(8 * 1024 * 1024 + 1);
    const fullHttpHeaders = new Map<string, string>();
    for (let index = 0; index < 100; index += 1) fullHttpHeaders.set(`x-header-${index}`, "value");
    assert.throws(() => httpRuntime.http.post("https://example.test/", { body: oversizedHttpBody }), /cannot exceed 16 MiB/u);
    assert.throws(() => httpRuntime.http.post("https://example.test/", { body: { value: oversizedHttpBody } }), /cannot exceed 16 MiB/u);
    assert.throws(() => httpRuntime.http.post("https://example.test/", { headers: fullHttpHeaders, body: { value: 1 } }), /cannot exceed 100 fields/u);
    assert.equal(calls.filter((call) => call.capability === "http" && call.operation === "request").length, requestsBeforeValidation);
    await assert.rejects(
      httpRuntime.http.get("https://example.test/transport-request").text(),
      (error: unknown) => error instanceof httpRuntime.HttpTransportError
        && error.phase === httpRuntime.HttpTransportPhase.request,
    );
    await assert.rejects(
      httpRuntime.http.get("https://example.test/transport-response").text(),
      (error: unknown) => error instanceof httpRuntime.HttpTransportError
        && error.phase === httpRuntime.HttpTransportPhase.response,
    );
    assert.equal((await httpRuntime.http.get("https://example.test/typed").parse(User)).name, "Ada");
    assert.equal((await (await httpRuntime.http.get("https://example.test/typed").response()).parse(User)).name, "Ada");
    const concurrentResponse = await httpRuntime.http.get("https://example.test/typed").response();
    const [concurrentText, concurrentJson] = await Promise.all([concurrentResponse.text(), concurrentResponse.json()]);
    assert.equal(concurrentText, '{"name":"Ada"}');
    assert.equal((concurrentJson as { name: string }).name, "Ada");
    assert.equal(await concurrentResponse.text(), concurrentText);
    const requestsBeforeInvalidType = calls.filter((call) => call.capability === "http" && call.operation === "request").length;
    await assert.rejects(httpRuntime.http.get("https://example.test/typed").parse({ parse: (value: unknown) => value }), /compiler-known VelarScript runtime type/u);
    assert.equal(calls.filter((call) => call.capability === "http" && call.operation === "request").length, requestsBeforeInvalidType);
    const streamed: string[] = [];
    await httpRuntime.http.get("https://example.test/stream").streamText(async (chunk) => { streamed.push(chunk); return null; });
    assert.deepEqual(streamed, ["first ", "chunk"]);
    assert.ok(calls.some((call) => call.capability === "http" && call.operation === "read" && call.timeout === 0));
    await httpRuntime.http.get("https://example.test/authorized", {
      secretHeaders: [httpRuntime.secretHeader("authorization", "OPENAI_API_KEY", "Bearer ")],
    }).text();
    const authorized = calls.find((call) => call.capability === "http" && call.operation === "request" && call.args[2] === "https://example.test/authorized");
    assert.deepEqual((authorized?.args[3] as { secretHeaders?: unknown }).secretHeaders, [
      { name: "authorization", environment: "OPENAI_API_KEY", prefix: "Bearer " },
    ]);
    let optionReads = 0;
    const accessorOptions = Object.defineProperty({}, "body", { enumerable: true, get() { optionReads += 1; return { unsafe: true }; } });
    assert.throws(() => httpRuntime.http.post("https://example.test/accessor", accessorOptions), /enumerable data values/u);
    assert.equal(optionReads, 0);
    assert.throws(() => httpRuntime.http.post("https://example.test/map", { body: new Map([["unsafe", true]]) }), /only records and Lists are supported/u);
    await httpRuntime.http.post("https://example.test/json-body", { body: { ready: true } }).text();
    const jsonBody = calls.find((call) => call.capability === "http" && call.operation === "request" && call.args[2] === "https://example.test/json-body");
    assert.deepEqual((jsonBody?.args[3] as { body?: unknown; headers?: unknown }).body, '{"ready":true}');
    assert.deepEqual((jsonBody?.args[3] as { body?: unknown; headers?: unknown }).headers, [["content-type", "application/json"]]);
    await assert.rejects(httpRuntime.http.get("https://example.test/lossy-json").json(), /numbers must be finite/u);
    await assert.rejects(
      httpRuntime.http.get("https://example.test/lossy-error").text(),
      (error: unknown) => error instanceof httpRuntime.HttpError && error.body === "1e400",
    );
    await assert.rejects(
      httpRuntime.http.get("https://example.test/redirect-error").text(),
      (error: unknown) => error instanceof httpRuntime.HttpError
        && error.url === "https://final.example.test/failure"
        && error.message === "HTTP 502 for https://final.example.test/failure"
        && (error.body as { failed?: unknown }).failed === true,
    );
    await assert.rejects(httpRuntime.http.get("https://example.test/hostile-response").response(), /enumerable data values/u);
    assert.equal(hostileResponseReads, 0);
    await assert.rejects(httpRuntime.http.get("https://example.test/invalid-response").response(), /body marker must be boolean/u);
    const invalidCall = calls.find((call) => call.capability === "http" && call.operation === "request" && call.args[2] === "https://example.test/invalid-response");
    assert.ok(invalidCall);
    assert.ok(calls.some((call) => call.capability === "http" && call.operation === "cancel" && call.args[0] === invalidCall.args[0]));
    await assert.rejects(httpRuntime.http.get("https://example.test/status-zero").response(), /invalid HTTP response metadata/u);
    await assert.rejects(httpRuntime.http.get("https://example.test/inconsistent-status").response(), /invalid HTTP response metadata/u);

    const emptyRequest = httpRuntime.http.get("https://example.test/empty", { timeout: 10 });
    const emptyResponse = await emptyRequest.response();
    assert.equal(await emptyResponse.text(), "");
    const emptyCall = calls.find((call) => call.capability === "http" && call.operation === "request" && call.args[2] === "https://example.test/empty");
    assert.ok(emptyCall);
    assert.equal(calls.some((call) => call.capability === "http" && call.operation === "read" && call.args[0] === emptyCall.args[0]), false);

    await assert.rejects(httpRuntime.http.get("https://example.test/too-many-chunks").text(), /cannot exceed 1000000 chunks/u);
    await assert.rejects(httpRuntime.http.get("https://example.test/invalid-chunk").text(), /invalid HTTP chunk/u);

    const pending = httpRuntime.http.get("https://example.test/pending", { timeout: 0 });
    const text = pending.text();
    pending.cancel();
    await assert.rejects(text, (error: unknown) => error instanceof httpRuntime.HttpAbortError && error.reason === "cancelled");
    assert.ok(calls.some((call) => call.capability === "http" && call.operation === "cancel"));
    const cancelledFromConsumer = httpRuntime.http.get("https://example.test/cancel-final", { timeout: 0 });
    await assert.rejects(cancelledFromConsumer.streamText(async () => {
      cancelledFromConsumer.cancel();
      return null;
    }), (error: unknown) => error instanceof httpRuntime.HttpAbortError && error.reason === "cancelled");

    let poisonedBridgeReads = 0;
    let poisonedBridgeCalls = 0;
    const poisonedBridge = Object.defineProperty({}, "invoke", {
      enumerable: true,
      get() {
        poisonedBridgeReads += 1;
        return () => {
          poisonedBridgeCalls += 1;
          throw new Error("poisoned Desktop bridge invoked");
        };
      },
    });
    Object.defineProperty(globalThis, bridgeKey, { value: poisonedBridge, configurable: true });
    assert.equal(desktopRuntime.platform(), "test");
    assert.equal(await desktopRuntime.projectDirectory(), join(directory, "selected"));
    assert.equal(pathRuntime.resolve(["captured"]), join(directory, "selected", "captured"));
    assert.equal(environment.get("LANG"), "en_US.UTF-8");
    assert.equal(await fsRuntime.readText("captured.txt", 16), "value");
    assert.equal((await processRuntime.run("node")).stdout, "ready");
    assert.equal(await httpRuntime.http.get("https://example.test/captured").text(), "first chunk");
    assert.equal(poisonedBridgeReads, 0);
    assert.equal(poisonedBridgeCalls, 0);
    Object.defineProperty(globalThis, bridgeKey, { value: bridge, configurable: true });

    let projectDirectoryReads = 0;
    const hostilePathBridge = {
      platform: "test",
      packaged: false,
      environment: Object.freeze({}),
      invoke: bridge.invoke,
    };
    Object.defineProperty(hostilePathBridge, "projectDirectoryValue", {
      enumerable: true,
      get() { projectDirectoryReads += 1; return () => directory; },
    });
    Object.defineProperty(globalThis, bridgeKey, { value: hostilePathBridge, configurable: true });
    await assert.rejects(runtime(directory, "path-hostile", "velar/path"), /data value/u);
    assert.equal(projectDirectoryReads, 0);

    let environmentReads = 0;
    const hostileEnvironment = Object.defineProperty({}, "LANG", {
      enumerable: true,
      get() { environmentReads += 1; return "unsafe"; },
    });
    const hostileEnvironmentBridge = {
      platform: "test",
      packaged: false,
      projectDirectory: directory,
      environment: hostileEnvironment,
      invoke: bridge.invoke,
    };
    Object.defineProperty(globalThis, bridgeKey, { value: hostileEnvironmentBridge, configurable: true });
    const hostileEnvironmentRuntime = await runtime<{ get(name: string): string | null }>(directory, "env-hostile", "velar/env");
    assert.throws(() => hostileEnvironmentRuntime.get("LANG"), /enumerable data values/u);
    assert.equal(environmentReads, 0);

    const tooManyEnvironment = Object.fromEntries(Array.from({ length: 65 }, (_value, index) => [`VALUE_${index}`, "x"]));
    Object.defineProperty(globalThis, bridgeKey, {
      value: {
        platform: "test",
        packaged: false,
        projectDirectory: directory,
        environment: tooManyEnvironment,
        invoke: bridge.invoke,
      },
      configurable: true,
    });
    const tooManyEnvironmentRuntime = await runtime<{ get(name: string): string | null }>(directory, "env-too-many", "velar/env");
    assert.throws(() => tooManyEnvironmentRuntime.get("VALUE_0"), /cannot exceed 64 variables/u);

    Object.defineProperty(globalThis, bridgeKey, {
      value: {
        platform: "test",
        packaged: false,
        projectDirectory: directory,
        environment: { TOO_LARGE: "x".repeat(64 * 1024 + 1) },
        invoke: bridge.invoke,
      },
      configurable: true,
    });
    const oversizedEnvironmentRuntime = await runtime<{ get(name: string): string | null }>(directory, "env-oversized", "velar/env");
    assert.throws(() => oversizedEnvironmentRuntime.get("TOO_LARGE"), /exceeds its size boundary/u);

    const aggregateEnvironment = Object.fromEntries(Array.from({ length: 17 }, (_value, index) => [`VALUE_${index}`, "x".repeat(64 * 1024)]));
    Object.defineProperty(globalThis, bridgeKey, {
      value: {
        platform: "test",
        packaged: false,
        projectDirectory: directory,
        environment: aggregateEnvironment,
        invoke: bridge.invoke,
      },
      configurable: true,
    });
    const aggregateEnvironmentRuntime = await runtime<{ get(name: string): string | null }>(directory, "env-aggregate", "velar/env");
    assert.throws(() => aggregateEnvironmentRuntime.get("VALUE_0"), /exceeds its size boundary/u);

    let platformReads = 0;
    const hostileDesktopBridge = {
      packaged: false,
      projectDirectory: directory,
      environment: Object.freeze({}),
      invoke: bridge.invoke,
    };
    Object.defineProperty(hostileDesktopBridge, "platform", {
      enumerable: true,
      get() { platformReads += 1; return "unsafe"; },
    });
    Object.defineProperty(globalThis, bridgeKey, { value: hostileDesktopBridge, configurable: true });
    await assert.rejects(runtime(directory, "desktop-accessor", "velar/desktop"), /data value/u);
    assert.equal(platformReads, 0);

    const invalidDesktopBridge = {
      platform: "test",
      packaged: false,
      projectDirectory: directory,
      environment: Object.freeze({}),
      async invoke(capability: string): Promise<unknown> { return capability === "desktop" ? "relative/path" : null; },
    };
    Object.defineProperty(globalThis, bridgeKey, { value: invalidDesktopBridge, configurable: true });
    const invalidDesktopRuntime = await runtime<{ projectDirectory(): Promise<string> }>(directory, "desktop-hostile", "velar/desktop");
    await assert.rejects(invalidDesktopRuntime.projectDirectory(), /invalid absolute path/u);
    const invalidOptionalDesktopRuntime = invalidDesktopRuntime as unknown as { selectProjectDirectory(): Promise<string | null> };
    await assert.rejects(invalidOptionalDesktopRuntime.selectProjectDirectory(), /invalid optional project path/u);

    let invokeReads = 0;
    const accessorInvokeBridge = {
      platform: "test",
      packaged: false,
      projectDirectory: directory,
      environment: Object.freeze({}),
    };
    Object.defineProperty(accessorInvokeBridge, "invoke", {
      enumerable: true,
      get() {
        invokeReads += 1;
        return bridge.invoke;
      },
    });
    Object.defineProperty(globalThis, bridgeKey, { value: accessorInvokeBridge, configurable: true });
    await assert.rejects(runtime(directory, "fs-invoke-accessor", "velar/fs"), /function data value/u);
    assert.equal(invokeReads, 0);
  } finally {
    delete (globalThis as { [key: symbol]: unknown })[bridgeKey];
    await rm(directory, { recursive: true, force: true });
  }
});

test("Desktop CLI test host provides deterministic manifest-scoped process handles", async () => {
  const context = vm.createContext({ TextEncoder, btoa });
  const initScript = desktopBrowserTestInitScript({
    productName: "Test",
    identifier: "dev.velarscript.test",
    window: { title: "Test", width: 800, height: 600, minWidth: 480, minHeight: 320 },
    permissions: { files: ["project"], processes: ["git"], network: [], environment: ["PRODUCTION_MODE"], secrets: ["PROVIDER_KEY"] },
    build: { outDir: "dist/desktop", sizeBudgetBytes: 10 * 1024 * 1024 },
  })
    .replace("const maxListTextUnits = 2 * 1024 * 1024;", "const maxListTextUnits = 8;")
    .replace("const maxWatchPaths = 4096;", "const maxWatchPaths = 1;");
  vm.runInContext(`${initScript}\nglobalThis.__bridgeUnderTest = globalThis[Symbol.for("velar.desktop.bridge.v1")]`, context);
  const bridge = (context as { __bridgeUnderTest?: { environment: Readonly<Record<string, string>>; invoke(capability: string, operation: string, args: unknown[]): Promise<unknown> } }).__bridgeUnderTest;
  assert.ok(bridge);
  assert.equal(Object.prototype.hasOwnProperty.call(bridge.environment, "PRODUCTION_MODE"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bridge.environment, "PROVIDER_KEY"), false);
  await assert.rejects(bridge.invoke("fs", "readText", ["README.md", 4]), /exceeds maxBytes/u);
  assert.equal(await bridge.invoke("fs", "makeDirectory", ["nested/one/two"]), null);
  assert.equal(await bridge.invoke("fs", "createText", ["exclusive.txt", "first"]), null);
  await assert.rejects(bridge.invoke("fs", "createText", ["exclusive.txt", "second"]), /createText target already exists/u);
  assert.equal(await bridge.invoke("fs", "replaceTextIfMatches", ["exclusive.txt", "first", "updated"]), true);
  assert.equal(await bridge.invoke("fs", "replaceTextIfMatches", ["exclusive.txt", "first", "lost"]), false);
  const watcherHandle = await bridge.invoke("fs", "watchStart", ["/velar-test/project", true]) as number;
  const watchedChange = bridge.invoke("fs", "watchNext", [watcherHandle]) as Promise<{paths: string[]; rescan: boolean}>;
  assert.equal(await bridge.invoke("fs", "writeText", ["nested/one/two/value.txt", "value"]), null);
  const watchedBatch = await watchedChange;
  assert.equal(watchedBatch.rescan, false);
  assert.deepEqual([...watchedBatch.paths], ["/velar-test/project/nested/one/two/value.txt"]);
  const pendingWatch = bridge.invoke("fs", "watchNext", [watcherHandle]);
  assert.equal(await bridge.invoke("fs", "watchClose", [watcherHandle]), true);
  assert.equal(await pendingWatch, null);
  const overflowWatcher = await bridge.invoke("fs", "watchStart", ["/velar-test/project", true]) as number;
  assert.equal(await bridge.invoke("fs", "writeText", ["overflow-one.vel", "one"]), null);
  assert.equal(await bridge.invoke("fs", "writeText", ["overflow-two.vel", "two"]), null);
  const overflowBatch = await bridge.invoke("fs", "watchNext", [overflowWatcher]) as {paths: string[]; rescan: boolean};
  assert.equal(overflowBatch.rescan, true);
  assert.deepEqual([...overflowBatch.paths], []);
  assert.equal(await bridge.invoke("fs", "watchClose", [overflowWatcher]), true);
  assert.equal(await bridge.invoke("fs", "readText", ["nested/one/two/value.txt", 16]), "value");
  await assert.rejects(bridge.invoke("fs", "writeText", ["nested", "not-a-file"]), /requires a file path/u);
  assert.equal(await bridge.invoke("fs", "makeDirectory", ["budget"]), null);
  assert.equal(await bridge.invoke("fs", "writeText", ["budget/alpha", "a"]), null);
  assert.equal(await bridge.invoke("fs", "writeText", ["budget/bravo", "b"]), null);
  await assert.rejects(bridge.invoke("fs", "list", ["budget", 10]), /2 MiB of text/u);
  assert.equal(await bridge.invoke("fs", "move", ["nested", "moved", false]), null);
  assert.equal((await bridge.invoke("fs", "info", ["moved/one/two/value.txt"]) as { kind: string }).kind, "file");
  await assert.rejects(bridge.invoke("fs", "move", ["/velar-test/project", "moved-root", false]), /refuses a granted Desktop file root/u);
  const started = await bridge.invoke("process", "start", ["git", ["--version"], { maxOutputBytes: 1024 }]) as { handle: number; pid: number };
  assert.ok(started.handle > 0);
  assert.equal(started.pid, 0);
  const output = await bridge.invoke("process", "read", [started.handle]) as { channel: string; text: string };
  assert.deepEqual({ channel: output.channel, text: output.text }, {
    channel: "stdout",
    text: "[desktop-test] git --version\n",
  });
  assert.equal(await bridge.invoke("process", "read", [started.handle]), null);
  const wait = await bridge.invoke("process", "wait", [started.handle]) as {
    result: { code: number; signal: string | null; stdout: string; stderr: string };
    error: null;
    retained: false;
  };
  const result = wait.result;
  assert.deepEqual({ code: result.code, signal: result.signal, stdout: result.stdout, stderr: result.stderr }, {
    code: 0,
    signal: null,
    stdout: "[desktop-test] git --version\n",
    stderr: "",
  });
  await assert.rejects(bridge.invoke("process", "start", ["sh", [], {}]), /not granted/u);
});

async function runtime<T>(directory: string, file: string, moduleName: string, transform: (source: string) => string = (source) => source): Promise<T> {
  const source = velarCompilerExtension.modules?.sources.get(moduleName);
  assert.ok(source, `${moduleName} must have a Desktop runtime source`);
  const path = join(directory, `${file}.mjs`);
  await writeFile(path, transform(source), "utf8");
  return import(`${pathToFileURL(path).href}?test=${Date.now()}`) as Promise<T>;
}
