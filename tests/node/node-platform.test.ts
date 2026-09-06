import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compileProject } from "../../packages/cli/src/project.ts";
import { standardModuleApi, standardModuleSource } from "../../packages/cli/src/standard-modules.ts";
import { nodeModuleSources } from "../../packages/node/src/compiler.ts";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";
import { runProcess, runtime } from "../support/node-runtime.ts";

/**
 * D114 GA-U3 — one core case per `velar/*` module Node publishes on the host
 * side: `velar/path`, `velar/fs`, `velar/process`, `velar/terminal`,
 * `velar/env` and `velar/host`.
 *
 * `node-platform.slow.test.ts` was the only end-to-end suite `packages/node`
 * had, 3,617 lines of it, and the `.slow` suffix kept every one of them out of
 * `npm run gate` — including on a change to `packages/node` itself. What a
 * gate may defer is a test that is *slow*, and these are not: the six here run
 * in about two seconds between them. The hostile-ABI sweeps, the load cases and
 * the multi-second lifecycle probes are what stayed behind.
 *
 * `node-platform-serve.test.ts` is the same tier for the three network
 * modules; it is a second file rather than more of this one because D115 holds
 * a test file to 800 lines and the two together do not fit under it.
 */

const WATCHED_CHANGE_RETRIGGER_MS = 250;
const WATCHED_CHANGE_TIMEOUT_MS = 30_000;

/**
 * Awaits one reported filesystem change, re-triggering it while the pull is
 * outstanding. `fs.watch` with `recursive: true` arms its macOS FSEvents
 * stream asynchronously on another thread, so a write that lands before the
 * stream starts is never reported — under concurrent load that happens for
 * roughly one pull in ten, and the pull then never settles.
 */
async function reportedChange<T>(pull: Promise<T>, change: () => Promise<unknown>, path: string, label: string): Promise<T> {
  let settled = false;
  const outcome = pull.finally(() => { settled = true; });
  const deadline = Date.now() + WATCHED_CHANGE_TIMEOUT_MS;
  while (!settled) {
    await change();
    if (Date.now() >= deadline) {
      throw new Error(`${label} never reported ${path} within ${WATCHED_CHANGE_TIMEOUT_MS} milliseconds of repeated changes; the operating-system watch is not delivering notifications for this root.`);
    }
    await Promise.race([outcome.catch(() => {}), new Promise((resolveWait) => setTimeout(resolveWait, WATCHED_CHANGE_RETRIGGER_MS))]);
  }
  return outcome;
}

test("Node path, filesystem, process, terminal, and HTTP modules expose typed Core contracts while Web owns its HTTP target", async () => {
  const api = standardModuleApi();
  assert.deepEqual(api.modules["velar/path"], ["basename", "contains", "dirname", "extension", "fromFileUrl", "isAbsolute", "join", "normalize", "relative", "resolve", "toFileUrl"]);
  assert.deepEqual(api.modules["velar/process"], ["Process", "ProcessOutputChannel", "run", "start"]);
  assert.deepEqual(api.modules["velar/terminal"], ["terminal"]);
  assert.deepEqual(api.modules["velar/http"], ["HttpAbortError", "HttpResponseError", "HttpTransportError", "HttpTransportPhase", "http", "secretHeader"]);
  assert.ok(api.modules["velar/fs"]?.includes("appendText"));
  assert.ok(api.modules["velar/fs"]?.includes("createText"));
  assert.ok(api.modules["velar/fs"]?.includes("replaceTextIfMatches"));
  assert.ok(api.modules["velar/fs"]?.includes("removeFile"));
  assert.ok(api.modules["velar/fs"]?.includes("FileWatcher"));
  assert.ok(api.modules["velar/fs"]?.includes("watchFiles"));

  const webApi = standardModuleApi([velarCompilerExtension]);
  assert.deepEqual(webApi.modules["velar/http"], ["HttpAbortError", "HttpResponseError", "HttpTransportError", "HttpTransportPhase", "formBody", "http"]);
  assert.match(standardModuleSource("velar/http", {}, [velarCompilerExtension]) ?? "", /export function formBody/u);
  assert.doesNotMatch(standardModuleSource("velar/http", {}, [velarCompilerExtension]) ?? "", /HTTP URL credentials are not allowed/u);

  const directory = await mkdtemp(join(tmpdir(), "velar-node-contract-"));
  try {
    const entry = join(directory, "main.vel");
    await writeFile(entry, `
import {FileWatchBatch, FileWatcher, appendText, canonical, copyFile, createText, info, makeDirectory, move, removeFile, replaceTextIfMatches, watchFiles} from "velar/fs"
import {basename, contains, extension, join, resolve} from "velar/path"
import {Process, ProcessOutputChannel, run, start} from "velar/process"
import {terminal} from "velar/terminal"
import {HttpAbortError, HttpResponseError, HttpTransportError, HttpTransportPhase, http, secretHeader} from "velar/http"
import {ServeRequest} from "velar/serve"

type User:
    name: string

async def consume(chunk: string):
    print(chunk)
    return null

async def parseIncoming(request: ServeRequest) -> User:
    return await request.parse(User, maxBytes=1024)

def transportPhase(error: Error) -> string:
    if error is HttpTransportError:
        return error.phase == HttpTransportPhase.request ? "request" : "response"
    return "none"

const root = resolve(["."])
const file = join([root, "note.txt"])
const watcher: FileWatcher = await watchFiles(root, recursive=true)
const changed: FileWatchBatch? = await watcher.next()
await watcher.close()
const child: Process = await start("node", ["--version"])
const args: List<string> = terminal.args()
const interactive: bool = terminal.isInteractive()
let childOutput = ""
async for output in child:
    if output.channel == ProcessOutputChannel.stdout:
        childOutput += output.text
    else:
        childOutput += output.text
const result = await child.wait()
const response = await http.get("http://127.0.0.1:1", {timeout: 1, secretHeaders: [secretHeader("authorization", "VELAR_TEST_TOKEN", prefix="Bearer ")]}).response()
const parsedRequest: User = await http.get("http://127.0.0.1:1", {timeout: 1}).parse(User)
const parsedResponse: User = await response.parse(User)
await response.streamText(consume)
print(basename(file))
print(extension(file))
print(contains(root, file))
print(childOutput)
`.trimStart(), "utf8");
    const project = await compileProject(entry, new Map(), { extensions: [] });
    assert.deepEqual(project.failures, []);
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
    const code = project.modules.find((module) => module.inputPath === entry)?.result.code ?? "";
    assert.match(code, /watchFiles/u);
    assert.match(code, /\.next\(\)/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("compiled VelarScript CLI reads arguments and terminal input without a JavaScript bridge", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-terminal-program-"));
  try {
    const entry = join(directory, "main.vel");
    await writeFile(entry, `
import {terminal} from "velar/terminal"

await terminal.write(terminal.args().join("|") + "\\n")
const line = await terminal.readLine("prompt> ")
await terminal.write((line ?? "eof") + "\\n")
await terminal.writeError("diagnostic\\n")
terminal.close()
`.trimStart(), "utf8");
    const result = await runProcess(
      process.execPath,
      [resolve("packages/cli/src/cli.ts"), "run", entry, "--", "alpha", "two words"],
      directory,
      process.env,
      "hello terminal\n",
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "alpha|two words\nprompt> hello terminal\n");
    assert.equal(result.stderr, "diagnostic\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("compiled VelarScript consumes official Process output through async for", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-process-pull-program-"));
  try {
    const entry = join(directory, "main.vel");
    await writeFile(entry, `
import {ProcessOutputChannel, start} from "velar/process"

const child = await start("node", ["-e", "process.stdout.write('out');setTimeout(()=>process.stderr.write('err'),25)"], {timeout: 1000})
let stdout = ""
let stderr = ""
async for output in child:
    if output.channel == ProcessOutputChannel.stdout:
        stdout += output.text
    else:
        stderr += output.text
const result = await child.wait()
print(stdout + "|" + stderr + "|" + result.stdout + "|" + result.stderr)
`.trimStart(), "utf8");
    const result = await runProcess(
      process.execPath,
      [resolve("packages/cli/src/cli.ts"), "run", entry],
      directory,
      process.env,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "out|err|out|err\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Node env and terminal keep their captured host ABI after application prototype replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-hostile-env-terminal-"));
  try {
    const envSource = nodeModuleSources.get("velar/env");
    const terminalSource = nodeModuleSources.get("velar/terminal");
    assert.ok(envSource);
    assert.ok(terminalSource);
    await writeFile(join(directory, "env.mjs"), envSource, "utf8");
    await writeFile(join(directory, "terminal.mjs"), terminalSource, "utf8");
    await writeFile(join(directory, "driver.mjs"), `
import {EventEmitter} from "node:events";
import {Readable, Writable} from "node:stream";
import {StringDecoder} from "node:string_decoder";
import {get} from "./env.mjs";
import {terminal} from "./terminal.mjs";

const originalEnvironment = process.env;
originalEnvironment.VELAR_HOSTILE_ENV = "captured";
Object.defineProperty(process, "env", {
  value: {VELAR_HOSTILE_ENV: "redirected"},
  enumerable: true,
  configurable: true,
  writable: true,
});
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new Error("application prototype poison reached the official Node ABI"); };
const originals = {
  regExpTest: RegExp.prototype.test,
  ownDescriptor: Object.getOwnPropertyDescriptor,
  reflectApply: Reflect.apply,
  bufferByteLength: Buffer.byteLength,
  arrayJoin: Array.prototype.join,
  arrayPush: Array.prototype.push,
  arrayShift: Array.prototype.shift,
  arraySlice: Array.prototype.slice,
  stringIncludes: String.prototype.includes,
  stringSlice: String.prototype.slice,
  decoderWrite: StringDecoder.prototype.write,
  decoderEnd: StringDecoder.prototype.end,
  eventOn: EventEmitter.prototype.on,
  eventRemoveListener: EventEmitter.prototype.removeListener,
  readablePause: Readable.prototype.pause,
  readableResume: Readable.prototype.resume,
  writableWrite: Writable.prototype.write,
};
RegExp.prototype.test = poison;
Object.getOwnPropertyDescriptor = poison;
Reflect.apply = poison;
Buffer.byteLength = poison;
Array.prototype.join = poison;
Array.prototype.push = poison;
Array.prototype.shift = poison;
Array.prototype.slice = poison;
String.prototype.includes = poison;
String.prototype.slice = poison;
StringDecoder.prototype.write = poison;
StringDecoder.prototype.end = poison;
EventEmitter.prototype.on = poison;
EventEmitter.prototype.removeListener = poison;
Readable.prototype.pause = poison;
Readable.prototype.resume = poison;
Writable.prototype.write = poison;

const first = await terminal.readLine();
const second = await terminal.readLine();
const third = await terminal.readLine();
await terminal.write(terminal.args()[0] + "|" + get("VELAR_HOSTILE_ENV") + "|" + first + "|" + second + "|" + third + "|" + poisonCalls + "\\n");
terminal.close();
RegExp.prototype.test = originals.regExpTest;
Object.getOwnPropertyDescriptor = originals.ownDescriptor;
Reflect.apply = originals.reflectApply;
Buffer.byteLength = originals.bufferByteLength;
Array.prototype.join = originals.arrayJoin;
Array.prototype.push = originals.arrayPush;
Array.prototype.shift = originals.arrayShift;
Array.prototype.slice = originals.arraySlice;
String.prototype.includes = originals.stringIncludes;
String.prototype.slice = originals.stringSlice;
StringDecoder.prototype.write = originals.decoderWrite;
StringDecoder.prototype.end = originals.decoderEnd;
EventEmitter.prototype.on = originals.eventOn;
EventEmitter.prototype.removeListener = originals.eventRemoveListener;
Readable.prototype.pause = originals.readablePause;
Readable.prototype.resume = originals.readableResume;
Writable.prototype.write = originals.writableWrite;
`.trimStart(), "utf8");
    const result = await runProcess(
      process.execPath,
      [join(directory, "driver.mjs"), "alpha"],
      directory,
      process.env,
      "one\r\ntwo\rthree\n",
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "alpha|captured|one|two|three|0\n");
    assert.equal(result.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Node host shutdown keeps captured signal, Promise, timer, and exit operations", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-hostile-host-"));
  try {
    const hostSource = nodeModuleSources.get("velar/host");
    assert.ok(hostSource);
    await writeFile(join(directory, "host.mjs"), hostSource, "utf8");
    await writeFile(join(directory, "driver.mjs"), `
import {EventEmitter} from "node:events";
import {onShutdown} from "./host.mjs";

const nativeWrite = process.stdout.write;
const nativeApply = Reflect.apply;
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new Error("application prototype poison reached velar/host"); };
EventEmitter.prototype.on = poison;
process.on = poison;
Date.now = poison;
Number.isSafeInteger = poison;
Promise.resolve = poison;
Promise.prototype.then = poison;
Array.prototype.push = poison;
globalThis.setTimeout = poison;
globalThis.clearTimeout = poison;
process.exit = poison;
onShutdown(async () => null);
nativeApply(nativeWrite, process.stdout, ["READY|" + poisonCalls + "\\n"]);
setInterval(() => {}, 1000);
`.trimStart(), "utf8");
    const child = spawn(process.execPath, [join(directory, "driver.mjs")], {
      cwd: directory,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    await new Promise<void>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error(`hostile host runtime did not become ready: ${stdout}\n${stderr}`)), 2_000);
      const inspect = () => {
        if (!stdout.includes("READY|0\n")) return;
        clearTimeout(timer);
        child.stdout.off("data", inspect);
        resolveReady();
      };
      child.stdout.on("data", inspect);
      inspect();
    });
    child.kill("SIGTERM");
    const code = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        rejectExit(new Error(`hostile host runtime did not exit: ${stdout}\n${stderr}`));
      }, 2_000);
      child.once("exit", (exitCode) => { clearTimeout(timer); resolveExit(exitCode); });
    });
    assert.equal(code, 143, stderr);
    assert.equal(stdout, "READY|0\n");
    assert.equal(stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Node filesystem and path runtimes keep destructive operations bounded and explicit", async () => {
  const fs = await runtime<{
    appendText(path: string, text: string): Promise<null>;
    canonical(path: string): Promise<string>;
    copyFile(source: string, target: string, replace?: boolean): Promise<null>;
    createText(path: string, text: string): Promise<null>;
    info(path: string): Promise<{ readonly kind: string; readonly size: number } | null>;
    makeDirectory(path: string): Promise<null>;
    move(source: string, target: string, replace?: boolean): Promise<null>;
    readText(path: string, maxBytes?: number): Promise<string>;
    replaceTextIfMatches(path: string, expected: string, replacement: string): Promise<boolean>;
    removeFile(path: string): Promise<null>;
    writeText(path: string, text: string): Promise<null>;
    watchFiles(path: string, recursive?: boolean): Promise<{
      next(): Promise<{ readonly paths: readonly string[]; readonly rescan: boolean } | null>;
      close(): Promise<null>;
    }>;
  }>("velar/fs");
  const path = await runtime<{
    contains(root: string, target: string): boolean;
    fromFileUrl(url: string): string;
    join(parts?: readonly string[]): string;
    resolve(parts?: readonly string[]): string;
    toFileUrl(path: string): string;
  }>("velar/path");
  const directory = await mkdtemp(join(tmpdir(), "velar-node-fs-"));
  try {
    const encodedPath = path.join([directory, "space and 雪#100%.vel"]);
    const encodedUrl = path.toFileUrl(encodedPath);
    assert.equal(encodedUrl, pathToFileURL(encodedPath).href);
    assert.equal(path.fromFileUrl(encodedUrl), encodedPath);
    assert.throws(() => path.fromFileUrl("https://example.test/main.vel"), /requires a file URL/u);
    const nested = path.join([directory, "nested", "one", "two"]);
    const first = path.join([nested, "first.txt"]);
    const copy = path.join([nested, "copy.txt"]);
    const moved = path.join([nested, "moved.txt"]);
    await fs.makeDirectory(nested);
    const watcher = await fs.watchFiles(nested, true);
    try {
      const firstChange = watcher.next();
      await assert.rejects(watcher.next(), /already has an active pull/u);
      const watched = path.join([nested, "watched.txt"]);
      const batch = await reportedChange(
        firstChange,
        () => fs.writeText(watched, "watched"),
        watched,
        "the recursive Node file watch",
      );
      assert.ok(batch !== null);
      assert.equal(batch.rescan, false);
      assert.equal(Object.isFrozen(batch.paths), false);
      assert.ok(batch.paths.includes(await fs.canonical(watched)));
      const pending = watcher.next();
      await watcher.close();
      assert.equal(await pending, null);
      assert.equal(await watcher.next(), null);
    } finally {
      await watcher.close();
    }
    const exclusive = path.join([nested, "exclusive.txt"]);
    const competingCreates = await Promise.allSettled([
      fs.createText(exclusive, "first"),
      fs.createText(exclusive, "second"),
    ]);
    assert.equal(competingCreates.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(competingCreates.filter((item) => item.status === "rejected").length, 1);
    assert.match(String((competingCreates.find((item) => item.status === "rejected") as PromiseRejectedResult).reason), /createText target already exists/u);
    assert.ok(["first", "second"].includes(await fs.readText(exclusive)));
    const optimistic = path.join([nested, "optimistic.txt"]);
    await fs.writeText(optimistic, "base");
    const competingReplacements = await Promise.all([
      fs.replaceTextIfMatches(optimistic, "base", "first"),
      fs.replaceTextIfMatches(optimistic, "base", "second"),
    ]);
    assert.deepEqual([...competingReplacements].sort(), [false, true]);
    assert.ok(["first", "second"].includes(await fs.readText(optimistic)));
    assert.equal(await fs.replaceTextIfMatches(optimistic, "stale", "lost"), false);
    for (let iteration = 0; iteration < 16; iteration += 1) {
      await fs.writeText(optimistic, "base");
      await Promise.all([
        fs.replaceTextIfMatches(optimistic, "base", "replacement"),
        fs.writeText(optimistic, "writer"),
      ]);
      assert.equal(await fs.readText(optimistic), "writer");
    }
    await fs.writeText(optimistic, "base");
    const [replaceBeforeAppend] = await Promise.all([
      fs.replaceTextIfMatches(optimistic, "base", "replacement"),
      fs.appendText(optimistic, "!"),
    ]);
    assert.equal(await fs.readText(optimistic), replaceBeforeAppend ? "replacement!" : "base!");
    await fs.writeText(optimistic, "base");
    await Promise.allSettled([
      fs.replaceTextIfMatches(optimistic, "base", "replacement"),
      fs.removeFile(optimistic),
    ]);
    assert.equal(await fs.info(optimistic), null);
    await assert.rejects(fs.writeText(nested, "not-a-file"), /requires a file path/u);
    await assert.rejects(fs.appendText(nested, "not-a-file"), /requires a file path/u);
    await assert.rejects(fs.copyFile(nested, path.join([directory, "directory-copy"])), /regular file source/u);
    await fs.writeText(first, "one");
    await fs.appendText(first, " two");
    assert.equal(await fs.readText(first), "one two");
    await assert.rejects(fs.readText(first, 2), /exceeds maxBytes/u);
    assert.equal((await fs.info(first))?.kind, "file");
    assert.equal(await fs.canonical(first), path.join([await fs.canonical(nested), "first.txt"]));
    assert.equal(path.contains(directory, first), true);
    assert.equal(path.contains(directory, path.resolve([directory, ".."])) , false);
    assert.throws(() => path.join(["x".repeat(4096), "tail"]), /result is outside/u);
    let pathPartReads = 0;
    const hostileParts: string[] = [];
    Object.defineProperty(hostileParts, "0", {
      enumerable: true,
      configurable: true,
      get() { pathPartReads += 1; return "nested"; },
    });
    hostileParts.length = 1;
    assert.throws(() => path.join(hostileParts), /enumerable data values/u);
    assert.equal(pathPartReads, 0);
    const sparseParts: string[] = [];
    sparseParts.length = 1;
    assert.throws(() => path.join(sparseParts), /enumerable data values/u);
    const capturedParts = [directory, "captured", "..", "stable.txt"];
    const capturedTarget = join(directory, "stable.txt");
    const stringIncludes = Object.getOwnPropertyDescriptor(String.prototype, "includes")!;
    const stringStartsWith = Object.getOwnPropertyDescriptor(String.prototype, "startsWith")!;
    const arrayIsArray = Object.getOwnPropertyDescriptor(Array, "isArray")!;
    let capturedJoin = "";
    let capturedContains = false;
    try {
      Object.defineProperty(String.prototype, "includes", { ...stringIncludes, value: () => { throw new Error("poisoned includes"); } });
      Object.defineProperty(String.prototype, "startsWith", { ...stringStartsWith, value: () => { throw new Error("poisoned startsWith"); } });
      Object.defineProperty(Array, "isArray", { ...arrayIsArray, value: () => { throw new Error("poisoned isArray"); } });
      capturedJoin = path.join(capturedParts);
      capturedContains = path.contains(directory, capturedTarget);
    } finally {
      Object.defineProperty(String.prototype, "includes", stringIncludes);
      Object.defineProperty(String.prototype, "startsWith", stringStartsWith);
      Object.defineProperty(Array, "isArray", arrayIsArray);
    }
    assert.equal(capturedJoin, capturedTarget);
    assert.equal(capturedContains, true);
    await fs.copyFile(first, copy);
    await assert.rejects(fs.copyFile(first, copy), /target already exists/u);
    await fs.move(copy, moved);
    await fs.removeFile(moved);
    await assert.rejects(fs.removeFile(nested), /refuses directories/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
