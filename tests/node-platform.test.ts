import assert from "node:assert/strict";
import { Buffer as NodeBuffer } from "node:buffer";
import { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { MessageChannel, MessagePort, Worker } from "node:worker_threads";
import { compileProject } from "../packages/cli/src/project.ts";
import { VELAR_TYPE_REGISTRY_KEY } from "../packages/compiler/src/runtime-abi.ts";
import { standardModuleApi, standardModuleDependencies, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { nodeModuleDependencies, nodeModuleSources, VELAR_NODE_HOST_MODULE } from "../packages/node/src/compiler.ts";
import { VELAR_NODE_HOST_WORKER_SOURCE } from "../packages/node/src/node-host-worker-runtime.ts";
import { VELAR_NODE_PROCESS_WORKER_SOURCE } from "../packages/node/src/process-worker-runtime.ts";
import { VELAR_NODE_TERMINAL_WORKER_SOURCE } from "../packages/node/src/terminal-worker-runtime.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

async function runtime<T>(
  name: string,
  transform: (source: string) => string = (source) => source,
  transformDependency: (name: string, source: string) => string = (_name, source) => source,
): Promise<T> {
  const source = nodeModuleSources.get(name);
  assert.ok(source, `${name} must have a Node runtime source`);
  const directory = await mkdtemp(join(tmpdir(), "velar-node-runtime-"));
  await materializeNodeRuntimeDependencies(directory, name, transformDependency);
  const path = join(directory, `${name.slice("velar/".length)}.mjs`);
  await writeFile(path, transform(source), "utf8");
  const module = await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as T;
  await rm(directory, { recursive: true, force: true });
  return module;
}

async function materializeNodeRuntimeDependencies(
  directory: string,
  source: string,
  transform: (name: string, source: string) => string = (_name, value) => value,
): Promise<void> {
  const dependencies = new Set<string>();
  const visit = (name: string): void => {
    for (const dependency of nodeModuleDependencies.get(name) ?? standardModuleDependencies(name) ?? []) {
      if (dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      visit(dependency);
    }
  };
  visit(source);
  if (dependencies.size === 0) return;
  const root = join(directory, "node_modules", "velar");
  await mkdir(root, {recursive: true});
  const exports_: Record<string, string> = {};
  for (const dependency of dependencies) {
    // A Node runtime module may depend on a compiler-owned Core runtime module
    // (D50 rule 89 put the nameable capability error classes there), so the
    // materializer resolves both registries.
    const moduleSource = nodeModuleSources.get(dependency) ?? standardModuleSource(dependency);
    assert.ok(moduleSource, `missing Node runtime dependency ${dependency}`);
    const name = dependency.slice("velar/".length);
    exports_[`./${name}`] = `./${name}.js`;
    await writeFile(join(root, `${name}.js`), transform(dependency, moduleSource), "utf8");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");
}

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

function registerRuntimeType<T extends object>(value: T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(VELAR_TYPE_REGISTRY_KEY));
  assert.ok(descriptor && "value" in descriptor);
  WeakSet.prototype.add.call(descriptor.value, value);
  return value;
}

test("Node path, filesystem, process, terminal, and HTTP modules expose typed Core contracts while Web owns its HTTP target", async () => {
  const api = standardModuleApi();
  assert.deepEqual(api.modules["velar/path"], ["basename", "contains", "dirname", "extension", "fromFileUrl", "isAbsolute", "join", "normalize", "relative", "resolve", "toFileUrl"]);
  assert.deepEqual(api.modules["velar/process"], ["Process", "ProcessOutputChannel", "run", "start"]);
  assert.deepEqual(api.modules["velar/terminal"], ["terminal"]);
  assert.deepEqual(api.modules["velar/http"], ["HttpAbortError", "HttpError", "HttpTransportError", "HttpTransportPhase", "http", "secretHeader"]);
  assert.ok(api.modules["velar/fs"]?.includes("appendText"));
  assert.ok(api.modules["velar/fs"]?.includes("createText"));
  assert.ok(api.modules["velar/fs"]?.includes("replaceTextIfMatches"));
  assert.ok(api.modules["velar/fs"]?.includes("removeFile"));
  assert.ok(api.modules["velar/fs"]?.includes("FileWatcher"));
  assert.ok(api.modules["velar/fs"]?.includes("watchFiles"));

  const webApi = standardModuleApi([velarCompilerExtension]);
  assert.deepEqual(webApi.modules["velar/http"], ["HttpAbortError", "HttpError", "HttpTransportError", "HttpTransportPhase", "formBody", "http"]);
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
import {HttpAbortError, HttpError, HttpTransportError, HttpTransportPhase, http, secretHeader} from "velar/http"
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

test("Node HTTP and serve typed parsing reject Promise-assimilated result shapes", async () => {
  const entry = join(tmpdir(), "velar-node-http-parse-hazard", "main.vel");
  const source = `
import {http} from "velar/http"
import {ServeRequest} from "velar/serve"

type Dangerous:
    then: () -> number

const value = await http.get("https://example.test").parse(Dangerous)

async def parseIncoming(request: ServeRequest) -> Dangerous:
    return await request.parse(Dangerous, maxBytes=1024)
`.trimStart();
  const project = await compileProject(entry, new Map([[entry, source]]), { extensions: [] });
  assert.deepEqual(project.failures, []);
  assert.ok(project.modules.flatMap((module) => module.result.diagnostics)
    .some((item) => item.code === "VEL4024" && /magic thenable/u.test(item.message)));
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

test("Node process worker keeps an unobserved active child alive and releases the idle module", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-process-worker-lifecycle-"));
  try {
    const source = nodeModuleSources.get("velar/process");
    assert.ok(source);
    const marker = join(directory, "finished.txt");
    const childSource = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "done"), 150)`;
    await writeFile(join(directory, "process.mjs"), source, "utf8");
    await writeFile(join(directory, "runner.mjs"), `
import {start} from "./process.mjs"
await start(process.execPath, ["-e", ${JSON.stringify(childSource)}], {timeout: 1000})
`.trimStart(), "utf8");
    const startedAt = Date.now();
    const runner = spawn(process.execPath, [join(directory, "runner.mjs")], {cwd: directory, env: process.env, stdio: ["ignore", "pipe", "pipe"]});
    let stderr = "";
    runner.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const code = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => {
        runner.kill("SIGKILL");
        rejectExit(new Error("Node process worker did not release its idle module"));
      }, 5000);
      runner.once("error", (error) => { clearTimeout(timer); rejectExit(error); });
      runner.once("exit", (value) => { clearTimeout(timer); resolveExit(value); });
    });
    assert.equal(code, 0, stderr);
    assert.ok(Date.now() - startedAt >= 100, "the runner exited before its unobserved child settled");
    assert.equal(await readFile(marker, "utf8"), "done");
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Node worker crashes fail closed and drain transferred process ownership", async () => {
  const crashingHostWorker = VELAR_NODE_HOST_WORKER_SOURCE.replace(
    'port.on("message", value => {',
    'port.on("message", value => { process.exit(71);',
  );
  assert.notEqual(crashingHostWorker, VELAR_NODE_HOST_WORKER_SOURCE);
  const filesystem = await runtime<{ exists(path: string): Promise<boolean> }>(
    "velar/fs",
    (source) => source,
    (name, source) => name === VELAR_NODE_HOST_MODULE
      ? source.replace(JSON.stringify(VELAR_NODE_HOST_WORKER_SOURCE), JSON.stringify(crashingHostWorker))
      : source,
  );
  let hostFailure: unknown = null;
  try { await filesystem.exists("."); } catch (error) { hostFailure = error; }
  assert.ok(hostFailure instanceof Error);
  const hostRetryStartedAt = Date.now();
  await assert.rejects(filesystem.exists("."), (error: unknown) => error === hostFailure);
  assert.ok(Date.now() - hostRetryStartedAt < 500, "a failed Node host must reject future work without posting to its dead port");

  const crashingTerminalWorker = VELAR_NODE_TERMINAL_WORKER_SOURCE.replace(
    'port.on("message", value => {',
    'port.on("message", value => { process.exit(72);',
  );
  assert.notEqual(crashingTerminalWorker, VELAR_NODE_TERMINAL_WORKER_SOURCE);
  const terminalRuntime = await runtime<{ terminal: { write(text: string): Promise<null> } }>(
    "velar/terminal",
    (source) => source.replace(JSON.stringify(VELAR_NODE_TERMINAL_WORKER_SOURCE), JSON.stringify(crashingTerminalWorker)),
  );
  let terminalFailure: unknown = null;
  try { await terminalRuntime.terminal.write("first"); } catch (error) { terminalFailure = error; }
  assert.ok(terminalFailure instanceof Error);
  const terminalRetryStartedAt = Date.now();
  await assert.rejects(terminalRuntime.terminal.write("second"), (error: unknown) => error === terminalFailure);
  assert.ok(Date.now() - terminalRetryStartedAt < 500, "a failed terminal host must not disguise its failure as normal closure");

  const directory = await mkdtemp(join(tmpdir(), "velar-node-process-worker-crash-"));
  const pidFile = join(directory, "pid.txt");
  let childPid: number | null = null;
  try {
    const withoutWorkerExitCleanup = VELAR_NODE_PROCESS_WORKER_SOURCE.replace(
      'process.once("exit", () => {\n  for (const task of processHandles.values()) signalTree(task.child, "SIGKILL");\n});\n',
      "",
    );
    assert.notEqual(withoutWorkerExitCleanup, VELAR_NODE_PROCESS_WORKER_SOURCE);
    const crashingProcessWorker = withoutWorkerExitCleanup.replace(
      'send({kind: "owned", handle, pid: task.pid});',
      'send({kind: "owned", handle, pid: task.pid}); setTimeout(() => { throw new Error("injected process Worker crash"); }, 100); await new Promise(() => {});',
    );
    assert.notEqual(crashingProcessWorker, withoutWorkerExitCleanup);
    const processRuntime = await runtime<{
      start(command: string, args: readonly string[], options: Record<string, unknown>): Promise<unknown>;
    }>(
      "velar/process",
      (source) => source.replace(JSON.stringify(VELAR_NODE_PROCESS_WORKER_SOURCE), JSON.stringify(crashingProcessWorker)),
    );
    const childSource = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    let processFailure: unknown = null;
    try {
      await processRuntime.start(process.execPath, ["-e", childSource], {timeout: 0, maxOutputBytes: 65536});
    } catch (error) { processFailure = error; }
    assert.ok(processFailure instanceof Error);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { childPid = Number(await readFile(pidFile, "utf8")); break; }
      catch { await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
    }
    assert.ok(childPid !== null && Number.isSafeInteger(childPid));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(childPid as number, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch { childPid = null; break; }
    }
    assert.equal(childPid, null, "the process host crash path must reap a transferred child owner");
    const processRetryStartedAt = Date.now();
    await assert.rejects(
      processRuntime.start(process.execPath, ["-e", "process.exit(0)"], {timeout: 1000, maxOutputBytes: 65536}),
      (error: unknown) => error === processFailure,
    );
    assert.ok(Date.now() - processRetryStartedAt < 500, "a failed process host must reject future starts without posting to its dead port");
  } finally {
    if (childPid !== null) {
      try { process.kill(-childPid, "SIGKILL"); }
      catch { try { process.kill(childPid, "SIGKILL"); } catch {} }
    }
    await rm(directory, {recursive: true, force: true});
  }
});

test("terminal close is final and queued oversized input rejects through the Vel promise", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-terminal-lifecycle-"));
  try {
    const closedEntry = join(directory, "closed.vel");
    await writeFile(closedEntry, `
import {terminal} from "velar/terminal"

terminal.close()
const line = await terminal.readLine()
print(line ?? "closed")
`.trimStart(), "utf8");
    const closed = await runProcess(
      process.execPath,
      [resolve("packages/cli/src/cli.ts"), "run", closedEntry],
      directory,
      process.env,
      "must not reopen\n",
    );
    assert.equal(closed.code, 0, closed.stderr);
    assert.equal(closed.stdout, "closed\n");

    const overflowEntry = join(directory, "overflow.vel");
    await writeFile(overflowEntry, `
import {terminal} from "velar/terminal"

print(await terminal.readLine() ?? "missing")
await Promise.sleep(20ms)
try:
    await terminal.readLine()
    print("unexpected")
catch error:
    print("bounded")
terminal.close()
`.trimStart(), "utf8");
    const overflow = await runProcess(
      process.execPath,
      [resolve("packages/cli/src/cli.ts"), "run", overflowEntry],
      directory,
      process.env,
      `first\n${"x".repeat(1024 * 1024 + 1)}\n`,
    );
    assert.equal(overflow.code, 0, overflow.stderr);
    assert.equal(overflow.stdout, "first\nbounded\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Node terminal worker releases idle imports and close cancels a pending fd read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-terminal-worker-lifecycle-"));
  try {
    const source = nodeModuleSources.get("velar/terminal");
    assert.ok(source);
    assert.match(source, /spawn\(process\.execPath/u);
    await writeFile(join(directory, "terminal.mjs"), source, "utf8");
    await writeFile(join(directory, "idle.mjs"), `
import {terminal} from "./terminal.mjs";
process.stdout.write(String(terminal.isInteractive()));
`.trimStart(), "utf8");
    const idle = spawn(process.execPath, [join(directory, "idle.mjs")], {
      cwd: directory,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let idleStdout = "";
    let idleStderr = "";
    idle.stdout.setEncoding("utf8");
    idle.stderr.setEncoding("utf8");
    idle.stdout.on("data", (chunk: string) => { idleStdout += chunk; });
    idle.stderr.on("data", (chunk: string) => { idleStderr += chunk; });
    const idleCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => {
        idle.kill("SIGKILL");
        rejectExit(new Error(`idle terminal import retained an open stdin pipe: ${idleStdout}\n${idleStderr}`));
      }, 2_000);
      idle.once("exit", (exitCode) => { clearTimeout(timer); resolveExit(exitCode); });
    });
    assert.equal(idleCode, 0, idleStderr);
    assert.equal(idleStdout, "false");
    assert.equal(idleStderr, "");

    await writeFile(join(directory, "pending.mjs"), `
import {terminal} from "./terminal.mjs";
const pending = terminal.readLine();
setTimeout(() => terminal.close(), 25);
process.stdout.write((await pending) === null ? "closed" : "unexpected");
`.trimStart(), "utf8");
    const child = spawn(process.execPath, [join(directory, "pending.mjs")], {
      cwd: directory,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const code = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        rejectExit(new Error(`terminal close did not cancel its pending fd read: ${stdout}\n${stderr}`));
      }, 2_000);
      child.once("exit", (exitCode) => { clearTimeout(timer); resolveExit(exitCode); });
    });
    assert.equal(code, 0, stderr);
    assert.equal(stdout, "closed");
    assert.equal(stderr, "");
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

test("Node serve types and JSON stay on the strict owned-data boundary", async () => {
  const serveRuntime = await runtime<{
    readonly ServeRequest: { is(value: unknown): boolean };
    readonly ServeResponse: { is(value: unknown): boolean };
    readonly Server: { is(value: unknown): boolean };
    readonly serve: (
      handler: (request: {
        readonly path: string;
        json(maxBytes?: number): Promise<unknown>;
        parse<T>(target: { parse(value: unknown): T }, maxBytes?: number): Promise<T>;
      }) => Promise<Record<string, unknown>>,
      port: number,
      host?: string,
    ) => Promise<{ readonly port: number; stop(): Promise<null> }>;
  }>("velar/serve");

  let requestReads = 0;
  const hostileRequest = {
    path: "/",
    query: new Map(),
    headers: new Map(),
    text: async () => "",
    json: async () => null,
    parse: async () => null,
  };
  Object.defineProperty(hostileRequest, "method", {
    enumerable: true,
    get() { requestReads += 1; return "GET"; },
  });
  assert.equal(serveRuntime.ServeRequest.is(hostileRequest), false);
  assert.equal(requestReads, 0);
  assert.equal(serveRuntime.ServeRequest.is({
    method: "GET",
    path: `/${"a".repeat(4097)}`,
    query: new Map(),
    headers: new Map(),
    text: async () => "",
    json: async () => null,
    parse: async () => null,
  }), false);
  assert.equal(serveRuntime.ServeRequest.is({
    method: "GET",
    path: "/",
    query: new Map(),
    headers: new Map(),
    text: async () => "",
    json: async () => null,
    parse: async () => null,
  }), true);

  let serverReads = 0;
  const hostileServer = { stop: async () => null };
  Object.defineProperty(hostileServer, "port", {
    enumerable: true,
    get() { serverReads += 1; return 80; },
  });
  assert.equal(serveRuntime.Server.is(hostileServer), false);
  assert.equal(serverReads, 0);

  let responseReads = 0;
  const hostileResponse = { json: { ok: true } };
  Object.defineProperty(hostileResponse, "status", {
    enumerable: true,
    get() { responseReads += 1; return 200; },
  });
  assert.equal(serveRuntime.ServeResponse.is(hostileResponse), false);
  assert.equal(responseReads, 0);

  let listReads = 0;
  const accessorList: unknown[] = [];
  Object.defineProperty(accessorList, "0", {
    enumerable: true,
    configurable: true,
    get() { listReads += 1; return "unsafe"; },
  });
  accessorList.length = 1;
  assert.equal(serveRuntime.ServeResponse.is({ status: 200, json: accessorList }), false);
  assert.equal(listReads, 0);
  const extraFieldList = ["safe"] as unknown[] & { extra?: string };
  extraFieldList.extra = "not JSON List data";
  assert.equal(serveRuntime.ServeResponse.is({ status: 200, json: extraFieldList }), false);
  assert.equal(serveRuntime.ServeResponse.is({ status: 200, json: { value: Number.POSITIVE_INFINITY } }), false);
  assert.equal(serveRuntime.ServeResponse.is({ status: 200, json: { value: 1 } }), true);

  const User = registerRuntimeType(Object.freeze({
    parse(value: unknown): { name: string } {
      if (!value || typeof value !== "object" || (value as { name?: unknown }).name !== "Ada") throw new TypeError("invalid User");
      return value as { name: string };
    },
  }));
  const forgedType = Object.freeze({ parse: (value: unknown) => value });
  const server = await serveRuntime.serve(async (request) => {
    if (request.path === "/typed") {
      try {
        const parsed = await request.parse(User, 64);
        return { status: 200, json: parsed };
      } catch (error) {
        return { status: 400, text: error instanceof Error ? error.message : "invalid" };
      }
    }
    if (request.path === "/forged") {
      try {
        await request.parse(forgedType, 1);
        return { status: 200, text: "unexpected" };
      } catch (error) {
        return { status: 400, text: error instanceof Error ? error.message : "invalid" };
      }
    }
    try {
      await request.json();
      return { status: 200, json: { ok: true } };
    } catch {
      return { status: 400, text: "invalid" };
    }
  }, 0);
  try {
    const lossy = await fetch(`http://127.0.0.1:${server.port}/`, { method: "POST", body: "1e400" });
    assert.equal(lossy.status, 400);
    assert.equal(await lossy.text(), "invalid");
    const valid = await fetch(`http://127.0.0.1:${server.port}/`, { method: "POST", body: "{\"value\":1}" });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { ok: true });
    const typed = await fetch(`http://127.0.0.1:${server.port}/typed`, { method: "POST", body: "{\"name\":\"Ada\"}" });
    assert.equal(typed.status, 200);
    assert.deepEqual(await typed.json(), { name: "Ada" });
    const mismatched = await fetch(`http://127.0.0.1:${server.port}/typed`, { method: "POST", body: "{\"name\":\"Grace\"}" });
    assert.equal(mismatched.status, 400);
    assert.equal(await mismatched.text(), "invalid User");
    const forged = await fetch(`http://127.0.0.1:${server.port}/forged`, { method: "POST", body: "{}" });
    assert.equal(forged.status, 400);
    assert.match(await forged.text(), /compiler-known VelarScript runtime type/u);
  } finally {
    await server.stop();
  }
});

test("Node serve enforces one aggregate byte budget and releases ownership after completion", async () => {
  const serveRuntime = await runtime<{
    fileResponse(root: string, path: string, fallback?: string | null): Record<string, unknown>;
    serve(
      handler: (request: {readonly path: string; text(maxBytes?: number): Promise<string>}) => Promise<Record<string, unknown>>,
      port: number,
    ): Promise<{readonly port: number; stop(): Promise<null>}>;
  }>(
    "velar/serve",
    source => source,
    (name, source) => name === "velar/node-host-v1"
      ? source.replace("const maxServeAggregateBytes = 128 * 1024 * 1024;", "const maxServeAggregateBytes = 32;")
      : source,
  );
  const directory = await mkdtemp(join(tmpdir(), "velar-node-serve-aggregate-"));
  let releaseHeld = (): void => {};
  let markHeldReady = (): void => {};
  const heldReady = new Promise<void>(resolveReady => { markHeldReady = resolveReady; });
  const heldRelease = new Promise<void>(resolveRelease => { releaseHeld = resolveRelease; });
  try {
    await writeFile(join(directory, "large.txt"), "f".repeat(33), "utf8");
    const server = await serveRuntime.serve(async request => {
      if (request.path === "/held") {
        await request.text();
        markHeldReady();
        await heldRelease;
        return {status: 200, text: ""};
      }
      if (request.path === "/competing") {
        try { await request.text(); return {status: 200, text: ""}; }
        catch { return {status: 503, text: ""}; }
      }
      if (request.path === "/large-response") return {status: 200, text: "r".repeat(33)};
      if (request.path === "/large-file") return serveRuntime.fileResponse(directory, "/large.txt");
      return {status: 200, text: "ok"};
    }, 0);
    try {
      const held = fetch(`http://127.0.0.1:${server.port}/held`, {method: "POST", body: "h".repeat(24)});
      await heldReady;
      const competing = await fetch(`http://127.0.0.1:${server.port}/competing`, {method: "POST", body: "c".repeat(16)});
      assert.equal(competing.status, 503);
      assert.equal(await competing.text(), "");
      releaseHeld();
      const heldResponse = await held;
      assert.equal(heldResponse.status, 200);
      assert.equal(await heldResponse.text(), "");

      const largeResponse = await fetch(`http://127.0.0.1:${server.port}/large-response`);
      assert.equal(largeResponse.status, 500);
      assert.equal(await largeResponse.text(), "Internal server error");
      const largeFile = await fetch(`http://127.0.0.1:${server.port}/large-file`);
      assert.equal(largeFile.status, 500);
      assert.equal(await largeFile.text(), "Internal server error");
      const after = await fetch(`http://127.0.0.1:${server.port}/after`);
      assert.equal(after.status, 200);
      assert.equal(await after.text(), "ok");
    } finally {
      releaseHeld();
      await server.stop();
    }
  } finally {
    releaseHeld();
    await rm(directory, {recursive: true, force: true});
  }
});

test("Node extension Types share the hardened compiler registry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-type-registry-"));
  try {
    const source = nodeModuleSources.get("velar/serve");
    assert.ok(source);
    await materializeNodeRuntimeDependencies(directory, "velar/serve");
    await writeFile(join(directory, "serve.mjs"), source, "utf8");
    await writeFile(join(directory, "driver.mjs"), `
const registry = new WeakSet();
let reads = 0;
Object.defineProperty(registry, "add", { get() { reads += 1; throw new Error("poisoned add"); } });
Object.defineProperty(globalThis, Symbol.for(${JSON.stringify(VELAR_TYPE_REGISTRY_KEY)}), {
  value: registry,
  enumerable: false,
  configurable: false,
  writable: false,
});
const runtime = await import("./serve.mjs");
console.log(reads + "|" + runtime.ServeRequest.is({
  method: "GET",
  path: "/",
  query: new Map(),
  headers: new Map(),
  text: async () => "",
  json: async () => null,
  parse: async () => null,
}));
`.trimStart(), "utf8");
    const result = await runProcess(process.execPath, [join(directory, "driver.mjs")], directory, process.env);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "0|true\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Node serve transport stays isolated after application stream and event prototype replacement", {skip: process.platform === "win32"}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-hostile-serve-"));
  let child: ChildProcess | null = null;
  try {
    const source = nodeModuleSources.get("velar/serve");
    assert.ok(source);
    await materializeNodeRuntimeDependencies(directory, "velar/serve");
    await writeFile(join(directory, "serve.mjs"), source, "utf8");
    await writeFile(join(directory, "driver.mjs"), `
import {EventEmitter} from "node:events";
import {Readable, Writable} from "node:stream";
import {serve} from "./serve.mjs";

const nativeApply = Reflect.apply;
const nativeDefine = Object.defineProperty;
const nativeOwnDescriptor = Object.getOwnPropertyDescriptor;
const nativeWrite = process.stdout.write;
let release;
const released = new Promise(resolve => { release = resolve; });
process.stdin.once("data", () => release());
const responseHeaders = new Map([["X-Velar-Test", "isolated"]]);
const originals = {
  arrayIsArray: nativeOwnDescriptor(Array, "isArray"),
  eventOn: nativeOwnDescriptor(EventEmitter.prototype, "on"),
  eventOnce: nativeOwnDescriptor(EventEmitter.prototype, "once"),
  eventOff: nativeOwnDescriptor(EventEmitter.prototype, "off"),
  mapEntries: nativeOwnDescriptor(Map.prototype, "entries"),
  mapGet: nativeOwnDescriptor(Map.prototype, "get"),
  mapHas: nativeOwnDescriptor(Map.prototype, "has"),
  mapSet: nativeOwnDescriptor(Map.prototype, "set"),
  numberIsFinite: nativeOwnDescriptor(Number, "isFinite"),
  numberIsSafeInteger: nativeOwnDescriptor(Number, "isSafeInteger"),
  objectCreate: nativeOwnDescriptor(Object, "create"),
  objectDefineProperty: nativeOwnDescriptor(Object, "defineProperty"),
  objectFreeze: nativeOwnDescriptor(Object, "freeze"),
  objectGetOwnPropertyDescriptor: nativeOwnDescriptor(Object, "getOwnPropertyDescriptor"),
  objectGetPrototypeOf: nativeOwnDescriptor(Object, "getPrototypeOf"),
  promiseThen: nativeOwnDescriptor(Promise.prototype, "then"),
  regExpTest: nativeOwnDescriptor(RegExp.prototype, "test"),
  readableResume: nativeOwnDescriptor(Readable.prototype, "resume"),
  reflectApply: nativeOwnDescriptor(Reflect, "apply"),
  stringIncludes: nativeOwnDescriptor(String.prototype, "includes"),
  stringStartsWith: nativeOwnDescriptor(String.prototype, "startsWith"),
  stringToLowerCase: nativeOwnDescriptor(String.prototype, "toLowerCase"),
  writableEnd: nativeOwnDescriptor(Writable.prototype, "end"),
  writableWrite: nativeOwnDescriptor(Writable.prototype, "write"),
};
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new Error("application prototype poison reached velar/serve"); };
for (const [target, name, descriptor] of [
  [Array, "isArray", originals.arrayIsArray],
  [EventEmitter.prototype, "on", originals.eventOn],
  [EventEmitter.prototype, "once", originals.eventOnce],
  [EventEmitter.prototype, "off", originals.eventOff],
  [Map.prototype, "entries", originals.mapEntries],
  [Map.prototype, "get", originals.mapGet],
  [Map.prototype, "has", originals.mapHas],
  [Map.prototype, "set", originals.mapSet],
  [Number, "isFinite", originals.numberIsFinite],
  [Number, "isSafeInteger", originals.numberIsSafeInteger],
  [Object, "create", originals.objectCreate],
  [Object, "defineProperty", originals.objectDefineProperty],
  [Object, "freeze", originals.objectFreeze],
  [Object, "getOwnPropertyDescriptor", originals.objectGetOwnPropertyDescriptor],
  [Object, "getPrototypeOf", originals.objectGetPrototypeOf],
  [Promise.prototype, "then", originals.promiseThen],
  [RegExp.prototype, "test", originals.regExpTest],
  [Readable.prototype, "resume", originals.readableResume],
  [Reflect, "apply", originals.reflectApply],
  [String.prototype, "includes", originals.stringIncludes],
  [String.prototype, "startsWith", originals.stringStartsWith],
  [String.prototype, "toLowerCase", originals.stringToLowerCase],
  [Writable.prototype, "end", originals.writableEnd],
  [Writable.prototype, "write", originals.writableWrite],
]) nativeDefine(target, name, {...descriptor, value: poison});

const server = await serve(async request => ({status: 200, text: request.path + "|" + poisonCalls, headers: responseHeaders}), 0);
nativeApply(nativeWrite, process.stdout, ["PORT:" + server.port + "\\n"]);
await released;
const observed = poisonCalls;
for (const [target, name, descriptor] of [
  [Array, "isArray", originals.arrayIsArray],
  [EventEmitter.prototype, "on", originals.eventOn],
  [EventEmitter.prototype, "once", originals.eventOnce],
  [EventEmitter.prototype, "off", originals.eventOff],
  [Map.prototype, "entries", originals.mapEntries],
  [Map.prototype, "get", originals.mapGet],
  [Map.prototype, "has", originals.mapHas],
  [Map.prototype, "set", originals.mapSet],
  [Number, "isFinite", originals.numberIsFinite],
  [Number, "isSafeInteger", originals.numberIsSafeInteger],
  [Object, "create", originals.objectCreate],
  [Object, "defineProperty", originals.objectDefineProperty],
  [Object, "freeze", originals.objectFreeze],
  [Object, "getOwnPropertyDescriptor", originals.objectGetOwnPropertyDescriptor],
  [Object, "getPrototypeOf", originals.objectGetPrototypeOf],
  [Promise.prototype, "then", originals.promiseThen],
  [RegExp.prototype, "test", originals.regExpTest],
  [Readable.prototype, "resume", originals.readableResume],
  [Reflect, "apply", originals.reflectApply],
  [String.prototype, "includes", originals.stringIncludes],
  [String.prototype, "startsWith", originals.stringStartsWith],
  [String.prototype, "toLowerCase", originals.stringToLowerCase],
  [Writable.prototype, "end", originals.writableEnd],
  [Writable.prototype, "write", originals.writableWrite],
]) nativeDefine(target, name, descriptor);
await server.stop();
nativeApply(nativeWrite, process.stdout, ["DONE:" + observed + "\\n"]);
`.trimStart(), "utf8");
    const spawned = spawn(process.execPath, [join(directory, "driver.mjs")], {cwd: directory, env: process.env, stdio: ["pipe", "pipe", "pipe"]});
    child = spawned;
    spawned.stdout.setEncoding("utf8");
    spawned.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    spawned.stdout.on("data", (chunk: string) => { stdout += chunk; });
    spawned.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const port = await new Promise<number>((resolvePort, rejectPort) => {
      const timer = setTimeout(() => { spawned.kill("SIGKILL"); rejectPort(new Error(`hostile serve did not start: ${stdout}\n${stderr}`)); }, 2_000);
      spawned.stdout.on("data", () => {
        const match = /^PORT:(\d+)\n/u.exec(stdout);
        if (!match) return;
        clearTimeout(timer);
        resolvePort(Number(match[1]));
      });
      spawned.once("exit", code => { clearTimeout(timer); rejectPort(new Error(`hostile serve exited early (${code}): ${stdout}\n${stderr}`)); });
    });
    const response = await fetch(`http://127.0.0.1:${port}/isolated`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "/isolated|0");
    spawned.stdin.end("stop\n");
    const code = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => { spawned.kill("SIGKILL"); rejectExit(new Error(`hostile serve did not stop: ${stdout}\n${stderr}`)); }, 2_000);
      spawned.once("exit", exitCode => { clearTimeout(timer); resolveExit(exitCode); });
    });
    assert.equal(code, 0, stderr);
    assert.equal(stdout, `PORT:${port}\nDONE:0\n`);
    assert.equal(stderr, "");
  } finally {
    if (child?.exitCode === null) child.kill("SIGKILL");
    await rm(directory, {recursive: true, force: true});
  }
});

test("Node shutdown bounds cleanup registration and total graceful-exit time", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-host-lifecycle-"));
  try {
    const source = nodeModuleSources.get("velar/host");
    assert.ok(source);
    const focused = source
      .replace("const maxShutdownCleanups = 1024;", "const maxShutdownCleanups = 2;")
      .replace("const shutdownTimeoutMs = 30000;", "const shutdownTimeoutMs = 50;");
    await writeFile(join(directory, "host.mjs"), focused, "utf8");
    await writeFile(join(directory, "limit.mjs"), `
import {onShutdown} from "./host.mjs";
onShutdown(async () => null);
onShutdown(async () => null);
try { onShutdown(async () => null); }
catch (error) { console.log(error.message); }
process.exit(0);
`.trimStart(), "utf8");
    const limited = await runProcess(process.execPath, [join(directory, "limit.mjs")], directory, process.env);
    assert.equal(limited.code, 0, limited.stderr);
    assert.equal(limited.stdout, "onShutdown cannot register more than 1024 cleanups\n");

    await writeFile(join(directory, "timeout.mjs"), `
import {onShutdown} from "./host.mjs";
onShutdown(async () => new Promise(() => {}));
setInterval(() => {}, 1000);
console.log("READY");
`.trimStart(), "utf8");
    const child = spawn(process.execPath, [join(directory, "timeout.mjs")], { cwd: directory, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    await new Promise<void>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error(`host runtime did not become ready: ${stdout}\n${stderr}`)), 2_000);
      const inspect = () => {
        if (!stdout.includes("READY\n")) return;
        clearTimeout(timer);
        child.stdout.off("data", inspect);
        resolveReady();
      };
      child.stdout.on("data", inspect);
      inspect();
    });
    child.kill("SIGTERM");
    const code = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); rejectExit(new Error(`host runtime did not enforce its shutdown deadline: ${stdout}\n${stderr}`)); }, 2_000);
      child.once("exit", (exitCode) => { clearTimeout(timer); resolveExit(exitCode); });
    });
    assert.equal(code, 1, stderr);
    assert.match(stderr, /Shutdown cleanup timed out after 50 ms/u);
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

test("Node filesystem keeps captured validation, Stats, decoder, and result operations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-hostile-fs-"));
  try {
    const source = nodeModuleSources.get("velar/fs");
    assert.ok(source);
    await materializeNodeRuntimeDependencies(directory, "velar/fs");
    await writeFile(join(directory, "fs.mjs"), source, "utf8");
    await writeFile(join(directory, "driver.mjs"), `
import {Stats} from "node:fs";
import * as fs from "./fs.mjs";

const root = process.argv[2];
const file = root + "/note.txt";
const nativeApply = Reflect.apply;
const nativeDefine = Object.defineProperty;
const nativeDelete = Reflect.deleteProperty;
const nativeOwnDescriptor = Object.getOwnPropertyDescriptor;
const nativeWrite = process.stdout.write;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const originals = {
  arrayIsArray: nativeOwnDescriptor(Array, "isArray"),
  arraySort: nativeOwnDescriptor(Array.prototype, "sort"),
  bufferByteLength: nativeOwnDescriptor(Buffer, "byteLength"),
  numberIsFinite: nativeOwnDescriptor(Number, "isFinite"),
  numberIsSafeInteger: nativeOwnDescriptor(Number, "isSafeInteger"),
  objectDefineProperty: nativeOwnDescriptor(Object, "defineProperty"),
  objectFreeze: nativeOwnDescriptor(Object, "freeze"),
  objectGetOwnPropertyDescriptor: nativeOwnDescriptor(Object, "getOwnPropertyDescriptor"),
  objectGetPrototypeOf: nativeOwnDescriptor(Object, "getPrototypeOf"),
  objectKeys: nativeOwnDescriptor(Object, "keys"),
  promiseThen: nativeOwnDescriptor(Promise.prototype, "then"),
  reflectApply: nativeOwnDescriptor(Reflect, "apply"),
  statsIsDirectory: nativeOwnDescriptor(Stats.prototype, "isDirectory"),
  statsIsFile: nativeOwnDescriptor(Stats.prototype, "isFile"),
  statsIsSymbolicLink: nativeOwnDescriptor(Stats.prototype, "isSymbolicLink"),
  stringIncludes: nativeOwnDescriptor(String.prototype, "includes"),
  textDecoderDecode: nativeOwnDescriptor(TextDecoder.prototype, "decode"),
  textEncoderEncode: nativeOwnDescriptor(TextEncoder.prototype, "encode"),
  typedArrayByteLength: nativeOwnDescriptor(typedArrayPrototype, "byteLength"),
};
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new Error("application prototype poison reached velar/fs"); };
nativeDefine(Array, "isArray", {...originals.arrayIsArray, value: poison});
nativeDefine(Array.prototype, "sort", {...originals.arraySort, value: poison});
nativeDefine(Buffer, "byteLength", {...originals.bufferByteLength, value: poison});
nativeDefine(Number, "isFinite", {...originals.numberIsFinite, value: poison});
nativeDefine(Number, "isSafeInteger", {...originals.numberIsSafeInteger, value: poison});
nativeDefine(Object, "defineProperty", {...originals.objectDefineProperty, value: poison});
nativeDefine(Object, "freeze", {...originals.objectFreeze, value: poison});
nativeDefine(Object, "getOwnPropertyDescriptor", {...originals.objectGetOwnPropertyDescriptor, value: poison});
nativeDefine(Object, "getPrototypeOf", {...originals.objectGetPrototypeOf, value: poison});
nativeDefine(Object, "keys", {...originals.objectKeys, value: poison});
nativeDefine(Promise.prototype, "then", {...originals.promiseThen, value: poison});
nativeDefine(Reflect, "apply", {...originals.reflectApply, value: poison});
nativeDefine(Stats.prototype, "isDirectory", {configurable: true, writable: true, value: poison});
nativeDefine(Stats.prototype, "isFile", {configurable: true, writable: true, value: poison});
nativeDefine(Stats.prototype, "isSymbolicLink", {configurable: true, writable: true, value: poison});
nativeDefine(String.prototype, "includes", {...originals.stringIncludes, value: poison});
nativeDefine(TextDecoder.prototype, "decode", {...originals.textDecoderDecode, value: poison});
nativeDefine(TextEncoder.prototype, "encode", {...originals.textEncoderEncode, value: poison});
nativeDefine(typedArrayPrototype, "byteLength", {...originals.typedArrayByteLength, get: poison});

await fs.createText(root + "/zzz-created.txt", "exclusive");
await fs.writeText(file, "one");
await fs.appendText(file, " two");
const text = await fs.readText(file);
const names = await fs.list(root);
const info = await fs.info(file);
const missing = await fs.exists(root + "/missing.txt");
const watcher = await fs.watchFiles(root, true);
const pendingWatch = watcher.next();
// The macOS FSEvents stream behind a recursive watch arms asynchronously, so a
// single write can land before it starts and is then never reported. Re-trigger
// on a timer instead of racing the pull: every combinator that could observe it
// here (Promise.race, .finally, .catch) reads the poisoned Promise.prototype.then.
let watchReported = false;
const watchDeadline = Date.now() + 30000;
const retriggerWatch = async () => {
  if (watchReported) return;
  // Closing settles the outstanding pull with null, so a watch that never
  // reports fails the observed-output assertion instead of hanging the suite.
  if (Date.now() >= watchDeadline) { try { await watcher.close(); } catch {} return; }
  try { await fs.writeText(root + "/watched.txt", "watch"); } catch {}
  if (!watchReported) setTimeout(retriggerWatch, 250);
};
await fs.writeText(root + "/watched.txt", "watch");
setTimeout(retriggerWatch, 250);
const watchBatch = await pendingWatch;
watchReported = true;
await watcher.close();
const observed = [text, names[0], info?.kind, String(missing), String(watchBatch?.paths.length > 0), String(poisonCalls)].join("|");

nativeDefine(Array, "isArray", originals.arrayIsArray);
nativeDefine(Array.prototype, "sort", originals.arraySort);
nativeDefine(Buffer, "byteLength", originals.bufferByteLength);
nativeDefine(Number, "isFinite", originals.numberIsFinite);
nativeDefine(Number, "isSafeInteger", originals.numberIsSafeInteger);
nativeDefine(Object, "defineProperty", originals.objectDefineProperty);
nativeDefine(Object, "freeze", originals.objectFreeze);
nativeDefine(Object, "getOwnPropertyDescriptor", originals.objectGetOwnPropertyDescriptor);
nativeDefine(Object, "getPrototypeOf", originals.objectGetPrototypeOf);
nativeDefine(Object, "keys", originals.objectKeys);
nativeDefine(Promise.prototype, "then", originals.promiseThen);
nativeDefine(Reflect, "apply", originals.reflectApply);
for (const [name, descriptor] of [
  ["isDirectory", originals.statsIsDirectory],
  ["isFile", originals.statsIsFile],
  ["isSymbolicLink", originals.statsIsSymbolicLink],
]) {
  if (descriptor) nativeDefine(Stats.prototype, name, descriptor);
  else nativeDelete(Stats.prototype, name);
}
nativeDefine(String.prototype, "includes", originals.stringIncludes);
nativeDefine(TextDecoder.prototype, "decode", originals.textDecoderDecode);
nativeDefine(TextEncoder.prototype, "encode", originals.textEncoderEncode);
nativeDefine(typedArrayPrototype, "byteLength", originals.typedArrayByteLength);
nativeApply(nativeWrite, process.stdout, [observed + "\\n"]);
`.trimStart(), "utf8");
    const result = await runProcess(
      process.execPath,
      [join(directory, "driver.mjs"), directory],
      directory,
      process.env,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "one two|driver.mjs|file|false|true|0\n");
    assert.equal(result.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Node process and HTTP runtimes preserve secret, cancellation, timeout, and streaming boundaries", async () => {
  const processRuntime = await runtime<{
    readonly ProcessOutputChannel: Readonly<{ readonly stdout: "stdout"; readonly stderr: "stderr" }>;
    run(command: string, args?: readonly string[], options?: Record<string, unknown>): Promise<{ readonly code: number | null; readonly stdout: string }>;
    start(command: string, args?: readonly string[], options?: Record<string, unknown>): Promise<{
      next(): Promise<Readonly<{ readonly channel: "stdout" | "stderr"; readonly text: string }> | null>;
      stop(): Promise<null>;
      wait(): Promise<{ readonly signal: string | null; readonly stdout: string; readonly stderr: string }>;
    }>;
  }>("velar/process");
  assert.deepEqual(
    { stdout: processRuntime.ProcessOutputChannel.stdout, stderr: processRuntime.ProcessOutputChannel.stderr },
    { stdout: "stdout", stderr: "stderr" },
  );
  const secretName = `VELAR_NODE_SECRET_${process.pid}`;
  let escapedPid: number | null = null;
  process.env[secretName] = "must-not-leak";
  try {
    const hidden = await processRuntime.run(process.execPath, ["-e", `process.stdout.write(process.env.${secretName} ?? "hidden")`]);
    assert.equal(hidden.code, 0);
    assert.equal(hidden.stdout, "hidden");
    const explicit = await processRuntime.run(process.execPath, ["-e", "process.stdout.write(process.env.VISIBLE ?? 'missing')"], { env: new Map([["VISIBLE", "yes"]]) });
    assert.equal(explicit.stdout, "yes");
    const timerProbe = setTimeout(() => null, 2147483647);
    const timerPrototype = Object.getPrototypeOf(timerProbe);
    clearTimeout(timerProbe);
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const processIntrinsicDescriptors = {
      arrayIsArray: Object.getOwnPropertyDescriptor(Array, "isArray")!,
      bufferConcat: Object.getOwnPropertyDescriptor(NodeBuffer, "concat")!,
      bufferFrom: Object.getOwnPropertyDescriptor(NodeBuffer, "from")!,
      bufferToString: Object.getOwnPropertyDescriptor(NodeBuffer.prototype, "toString")!,
      childKill: Object.getOwnPropertyDescriptor(ChildProcess.prototype, "kill")!,
      childUnref: Object.getOwnPropertyDescriptor(ChildProcess.prototype, "unref")!,
      eventOn: Object.getOwnPropertyDescriptor(EventEmitter.prototype, "on")!,
      eventRemoveListener: Object.getOwnPropertyDescriptor(EventEmitter.prototype, "removeListener")!,
      mapEntries: Object.getOwnPropertyDescriptor(Map.prototype, "entries")!,
      mapSize: Object.getOwnPropertyDescriptor(Map.prototype, "size")!,
      messageData: Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data")!,
      messagePortPost: Object.getOwnPropertyDescriptor(MessagePort.prototype, "postMessage")!,
      messagePortRef: Object.getOwnPropertyDescriptor(MessagePort.prototype, "ref")!,
      messagePortStart: Object.getOwnPropertyDescriptor(MessagePort.prototype, "start")!,
      messagePortUnref: Object.getOwnPropertyDescriptor(MessagePort.prototype, "unref")!,
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
      stringDecoderEnd: Object.getOwnPropertyDescriptor(StringDecoder.prototype, "end")!,
      stringDecoderWrite: Object.getOwnPropertyDescriptor(StringDecoder.prototype, "write")!,
      timerUnref: Object.getOwnPropertyDescriptor(timerPrototype, "unref")!,
      typedArrayByteLength: Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!,
      processKill: Object.getOwnPropertyDescriptor(process, "kill")!,
      writableEnd: Object.getOwnPropertyDescriptor(Writable.prototype, "end")!,
      workerUnref: Object.getOwnPropertyDescriptor(Worker.prototype, "unref")!,
    };
    let processPoisonCalls = 0;
    const poison = () => { processPoisonCalls += 1; throw new Error("poisoned process intrinsic"); };
    let capturedProcessResult: { readonly stdout: string; readonly stderr: string } | null = null;
    const capturedProcessChunks: Array<Readonly<{ readonly channel: "stdout" | "stderr"; readonly text: string }>> = [];
    try {
      Object.defineProperty(Array, "isArray", { ...processIntrinsicDescriptors.arrayIsArray, value: poison });
      Object.defineProperty(NodeBuffer, "concat", { ...processIntrinsicDescriptors.bufferConcat, value: poison });
      Object.defineProperty(NodeBuffer, "from", { ...processIntrinsicDescriptors.bufferFrom, value: poison });
      Object.defineProperty(NodeBuffer.prototype, "toString", { ...processIntrinsicDescriptors.bufferToString, value: poison });
      Object.defineProperty(ChildProcess.prototype, "kill", { ...processIntrinsicDescriptors.childKill, value: poison });
      Object.defineProperty(ChildProcess.prototype, "unref", { ...processIntrinsicDescriptors.childUnref, value: poison });
      Object.defineProperty(EventEmitter.prototype, "on", { ...processIntrinsicDescriptors.eventOn, value: poison });
      Object.defineProperty(EventEmitter.prototype, "removeListener", { ...processIntrinsicDescriptors.eventRemoveListener, value: poison });
      Object.defineProperty(Map.prototype, "entries", { ...processIntrinsicDescriptors.mapEntries, value: poison });
      Object.defineProperty(Map.prototype, "size", { ...processIntrinsicDescriptors.mapSize, get: poison });
      Object.defineProperty(MessageEvent.prototype, "data", { ...processIntrinsicDescriptors.messageData, get: poison });
      Object.defineProperty(MessagePort.prototype, "postMessage", { ...processIntrinsicDescriptors.messagePortPost, value: poison });
      Object.defineProperty(MessagePort.prototype, "ref", { ...processIntrinsicDescriptors.messagePortRef, value: poison });
      Object.defineProperty(MessagePort.prototype, "start", { ...processIntrinsicDescriptors.messagePortStart, value: poison });
      Object.defineProperty(MessagePort.prototype, "unref", { ...processIntrinsicDescriptors.messagePortUnref, value: poison });
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
      Object.defineProperty(StringDecoder.prototype, "end", { ...processIntrinsicDescriptors.stringDecoderEnd, value: poison });
      Object.defineProperty(StringDecoder.prototype, "write", { ...processIntrinsicDescriptors.stringDecoderWrite, value: poison });
      Object.defineProperty(timerPrototype, "unref", { ...processIntrinsicDescriptors.timerUnref, value: poison });
      Object.defineProperty(typedArrayPrototype, "byteLength", { ...processIntrinsicDescriptors.typedArrayByteLength, get: poison });
      Object.defineProperty(process, "kill", { ...processIntrinsicDescriptors.processKill, value: poison });
      Object.defineProperty(Writable.prototype, "end", { ...processIntrinsicDescriptors.writableEnd, value: poison });
      Object.defineProperty(Worker.prototype, "unref", { ...processIntrinsicDescriptors.workerUnref, value: poison });
      const capturedProcess = await processRuntime.start(process.execPath, ["-e", "process.stdout.write(process.env.VISIBLE);process.stderr.write('safe')"], {
        env: new Map([["VISIBLE", "captured"]]),
        timeout: 1000,
      });
      while (true) {
        const chunk = await capturedProcess.next();
        if (chunk === null) break;
        capturedProcessChunks.push(chunk);
      }
      capturedProcessResult = await capturedProcess.wait();
    } finally {
      Object.defineProperty(Array, "isArray", processIntrinsicDescriptors.arrayIsArray);
      Object.defineProperty(NodeBuffer, "concat", processIntrinsicDescriptors.bufferConcat);
      Object.defineProperty(NodeBuffer, "from", processIntrinsicDescriptors.bufferFrom);
      Object.defineProperty(NodeBuffer.prototype, "toString", processIntrinsicDescriptors.bufferToString);
      Object.defineProperty(ChildProcess.prototype, "kill", processIntrinsicDescriptors.childKill);
      Object.defineProperty(ChildProcess.prototype, "unref", processIntrinsicDescriptors.childUnref);
      Object.defineProperty(EventEmitter.prototype, "on", processIntrinsicDescriptors.eventOn);
      Object.defineProperty(EventEmitter.prototype, "removeListener", processIntrinsicDescriptors.eventRemoveListener);
      Object.defineProperty(Map.prototype, "entries", processIntrinsicDescriptors.mapEntries);
      Object.defineProperty(Map.prototype, "size", processIntrinsicDescriptors.mapSize);
      Object.defineProperty(MessageEvent.prototype, "data", processIntrinsicDescriptors.messageData);
      Object.defineProperty(MessagePort.prototype, "postMessage", processIntrinsicDescriptors.messagePortPost);
      Object.defineProperty(MessagePort.prototype, "ref", processIntrinsicDescriptors.messagePortRef);
      Object.defineProperty(MessagePort.prototype, "start", processIntrinsicDescriptors.messagePortStart);
      Object.defineProperty(MessagePort.prototype, "unref", processIntrinsicDescriptors.messagePortUnref);
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
      Object.defineProperty(StringDecoder.prototype, "end", processIntrinsicDescriptors.stringDecoderEnd);
      Object.defineProperty(StringDecoder.prototype, "write", processIntrinsicDescriptors.stringDecoderWrite);
      Object.defineProperty(timerPrototype, "unref", processIntrinsicDescriptors.timerUnref);
      Object.defineProperty(typedArrayPrototype, "byteLength", processIntrinsicDescriptors.typedArrayByteLength);
      Object.defineProperty(process, "kill", processIntrinsicDescriptors.processKill);
      Object.defineProperty(Writable.prototype, "end", processIntrinsicDescriptors.writableEnd);
      Object.defineProperty(Worker.prototype, "unref", processIntrinsicDescriptors.workerUnref);
    }
    assert.equal(processPoisonCalls, 0);
    assert.deepEqual(capturedProcessResult, { code: 0, signal: null, stdout: "captured", stderr: "safe" });
    assert.equal(capturedProcessChunks.map((chunk) => chunk.text).join(""), "capturedsafe");
    let optionReads = 0;
    const accessorOptions = Object.defineProperty({}, "cwd", {
      enumerable: true,
      get() { optionReads += 1; return process.cwd(); },
    });
    await assert.rejects(processRuntime.run(process.execPath, ["--version"], accessorOptions), /enumerable data values/u);
    assert.equal(optionReads, 0);
    let argumentReads = 0;
    const accessorArguments: string[] = [];
    Object.defineProperty(accessorArguments, "0", {
      enumerable: true,
      configurable: true,
      get() { argumentReads += 1; return "--version"; },
    });
    accessorArguments.length = 1;
    await assert.rejects(processRuntime.run(process.execPath, accessorArguments), /enumerable data values/u);
    assert.equal(argumentReads, 0);
    await assert.rejects(processRuntime.run(process.execPath, ["--version"], { unexpected: true }), /unknown field 'unexpected'/u);
    await assert.rejects(
      processRuntime.run(process.execPath, ["x".repeat(600_000), "y".repeat(600_000)]),
      /arguments cannot exceed 1 MiB/u,
    );
    await assert.rejects(processRuntime.run(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { timeout: 10 }), /timed out/u);
    const streamed = await processRuntime.start(process.execPath, [
      "-e",
      "process.stdout.write('one');setTimeout(()=>process.stderr.write('two'),25)",
    ], { timeout: 1000 });
    const streamedChunks: Array<Readonly<{ channel: "stdout" | "stderr"; text: string }>> = [];
    while (true) {
      const chunk = await streamed.next();
      if (chunk === null) break;
      streamedChunks.push(chunk);
    }
    assert.deepEqual(streamedChunks.map((chunk) => `${chunk.channel}:${chunk.text}`), ["stdout:one", "stderr:two"]);
    const streamedResult = await streamed.wait();
    assert.equal(streamedResult.stdout, "one");
    assert.equal(streamedResult.stderr, "two");
    await assert.rejects(streamed.next(), /consumed before wait/u);

    const delayed = await processRuntime.start(process.execPath, ["-e", "setTimeout(()=>process.stdout.write('ready'),25)"], { timeout: 1000 });
    const firstPull = delayed.next();
    await assert.rejects(delayed.next(), /only one active pull/u);
    assert.deepEqual(await firstPull, { channel: "stdout", text: "ready" });
    assert.equal(await delayed.next(), null);
    await delayed.wait();

    const waitOnly = await processRuntime.start(process.execPath, ["-e", "process.stdout.write('done')"], { timeout: 1000 });
    assert.equal((await waitOnly.wait()).stdout, "done");
    await assert.rejects(waitOnly.next(), /consumed before wait/u);
    const running = await processRuntime.start(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { timeout: 0 });
    await running.stop();
    assert.equal((await running.wait()).signal, "SIGTERM");
    const tree = await processRuntime.start(process.execPath, ["-e", "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:['ignore','inherit','inherit']}); process.stdout.write(String(child.pid)); setTimeout(()=>{},10000)"], { timeout: 0 });
    await new Promise(resolve => setTimeout(resolve, 50));
    await tree.stop();
    const treeResult = await tree.wait();
    const descendantPid = Number(treeResult.stdout);
    assert.equal(Number.isSafeInteger(descendantPid), true);
    // `stop()` kills the whole tree, but the host reaps it asynchronously, so the
    // descendant can still be present the instant `wait()` resolves — observed
    // under a loaded full-suite run, not when this file runs alone. The contract
    // is that the descendant goes away with its owner, not that it is already
    // gone on the first sample, so poll for ESRCH within a bounded window.
    let descendantProbe: unknown = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(descendantPid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch (error) { descendantProbe = error; break; }
    }
    assert.ok(
      descendantProbe instanceof Error && "code" in descendantProbe && descendantProbe.code === "ESRCH",
      "stopping a process must reap its descendant tree",
    );

    if (process.platform !== "win32") {
      const timeoutDirectory = await mkdtemp(join(tmpdir(), "velar-process-timeout-"));
      try {
        const pidFile = join(timeoutDirectory, "descendant.pid");
        const timeoutStartedAt = Date.now();
        await assert.rejects(processRuntime.run(process.execPath, ["-e", `
const {spawn} = require("node:child_process");
const {writeFileSync} = require("node:fs");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
descendant.unref();
writeFileSync(process.env.PID_FILE, String(descendant.pid));
setInterval(() => {}, 1000);
        `], { env: new Map([["PID_FILE", pidFile]]), timeout: 200 }), /timed out after 200 milliseconds/u);
        assert.ok(Date.now() - timeoutStartedAt < 8_000, "Process.run timeout must converge through post-exit pipes");
        escapedPid = Number(await readFile(pidFile, "utf8"));
        assert.equal(Number.isSafeInteger(escapedPid), true);
        assert.doesNotThrow(() => process.kill(escapedPid as number, 0));
        try { process.kill(-(escapedPid as number), "SIGKILL"); }
        catch { try { process.kill(escapedPid as number, "SIGKILL"); } catch {} }
        escapedPid = null;
      } finally {
        await rm(timeoutDirectory, { recursive: true, force: true });
      }

      const abandonedOutput = await processRuntime.start(process.execPath, ["-e", `
const {spawn} = require("node:child_process");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
descendant.unref();
process.stdout.write(String(descendant.pid) + "\\n");
      `], { timeout: 0 });
      let abandonedPidText = "";
      while (!abandonedPidText.includes("\n")) {
        const output = await abandonedOutput.next();
        assert.ok(output);
        abandonedPidText += output.text;
      }
      const abandonedPid = Number(abandonedPidText.trim());
      assert.equal(Number.isSafeInteger(abandonedPid), true);
      escapedPid = abandonedPid;
      const outputDeadlineStartedAt = Date.now();
      await assert.rejects(abandonedOutput.next(), /output streams did not close within 5000 milliseconds after process exit/u);
      assert.ok(Date.now() - outputDeadlineStartedAt < 8_000, "Process output must reject within its post-exit pipe deadline");
      await assert.rejects(abandonedOutput.wait(), /output streams did not close within 5000 milliseconds after process exit/u);
      assert.doesNotThrow(() => process.kill(abandonedPid, 0));
      try { process.kill(-abandonedPid, "SIGKILL"); }
      catch { try { process.kill(abandonedPid, "SIGKILL"); } catch {} }
      escapedPid = null;

      const escaped = await processRuntime.start(process.execPath, ["-e", `
const {spawn} = require("node:child_process");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
process.stdout.write(String(descendant.pid) + "\\n");
setInterval(() => {}, 1000);
      `], { timeout: 0 });
      let escapedPidText = "";
      while (!escapedPidText.includes("\n")) {
        const output = await escaped.next();
        assert.ok(output);
        escapedPidText += output.text;
      }
      const parsedEscapedPid = Number(escapedPidText.trim());
      assert.equal(Number.isSafeInteger(parsedEscapedPid), true);
      escapedPid = parsedEscapedPid;
      const escapedWait = escaped.wait();
      const stopStartedAt = Date.now();
      await assert.rejects(escaped.stop(), /termination could not be confirmed within 5000 milliseconds/u);
      await assert.rejects(escapedWait, /termination could not be confirmed within 5000 milliseconds/u);
      assert.ok(Date.now() - stopStartedAt < 8_000, "Process.stop must reject within its owned confirmation deadline");
      assert.doesNotThrow(() => process.kill(parsedEscapedPid, 0));
      try { process.kill(-parsedEscapedPid, "SIGKILL"); }
      catch { try { process.kill(parsedEscapedPid, "SIGKILL"); } catch {} }
      assert.notEqual((await escaped.wait()).signal, null);
      escapedPid = null;
    }
  } finally {
    if (escapedPid !== null) {
      try { process.kill(-escapedPid, "SIGKILL"); }
      catch { try { process.kill(escapedPid, "SIGKILL"); } catch {} }
    }
    delete process.env[secretName];
  }

  const http = await runtime<{
    readonly HttpAbortError: new (...args: unknown[]) => Error;
    readonly HttpError: new (...args: unknown[]) => Error & { readonly body: unknown };
    readonly HttpTransportError: new (...args: unknown[]) => Error & { readonly phase: "request" | "response" };
    readonly HttpTransportPhase: Readonly<{ readonly request: "request"; readonly response: "response" }>;
    secretHeader(name: string, environment: string, prefix?: string): Readonly<{ name: string; environment: string; prefix: string }>;
    readonly http: {
      get(url: string, options?: Record<string, unknown>): {
        cancel(): null;
        json(): Promise<unknown>;
        parse<T>(target: { parse(value: unknown): T }): Promise<T>;
        text(): Promise<string>;
        response(): Promise<{ parse<T>(target: { parse(value: unknown): T }): Promise<T>; streamText(consume: (chunk: string) => Promise<null>): Promise<null> }>;
      };
      post(url: string, options?: Record<string, unknown>): { text(): Promise<string> };
    };
  }>("velar/http");
  const User = registerRuntimeType(Object.freeze({
    parse(value: unknown): { name: string } {
      if (!value || typeof value !== "object" || (value as { name?: unknown }).name !== "Ada") throw new TypeError("invalid User");
      return value as { name: string };
    },
  }));
  const oversizedHttpBody = "é".repeat(8 * 1024 * 1024 + 1);
  const fullHttpHeaders = new Map<string, string>();
  for (let index = 0; index < 100; index += 1) fullHttpHeaders.set(`x-header-${index}`, "value");
  assert.throws(() => http.http.post("http://127.0.0.1/", { body: oversizedHttpBody }), /cannot exceed 16 MiB/u);
  assert.throws(() => http.http.post("http://127.0.0.1/", { body: { value: oversizedHttpBody } }), /cannot exceed 16 MiB/u);
  assert.throws(() => http.http.post("http://127.0.0.1/", { headers: fullHttpHeaders, body: { value: 1 } }), /cannot exceed 100 fields/u);
  const unavailable = createServer();
  await new Promise<void>((resolve, reject) => {
    unavailable.once("error", reject);
    unavailable.listen(0, "127.0.0.1", resolve);
  });
  const unavailableAddress = unavailable.address();
  assert.ok(unavailableAddress && typeof unavailableAddress !== "string");
  const unavailablePort = unavailableAddress.port;
  await new Promise<void>((resolve) => unavailable.close(() => resolve()));
  await assert.rejects(
    http.http.get(`http://127.0.0.1:${unavailablePort}/`).text(),
    (error: unknown) => error instanceof http.HttpTransportError
      && error.phase === http.HttpTransportPhase.request
      && error.message === "HTTP request transport failed",
  );
  let observedAuthorization: string | undefined;
  let redirectedSecret: string | undefined;
  const redirectTarget = createServer((request, response) => {
    const value = request.headers["x-provider-key"];
    redirectedSecret = typeof value === "string" ? value : undefined;
    if (request.url === "/error-target") {
      response.writeHead(502, { "content-type": "application/json" });
      response.end('{"failed":true}');
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("redirected");
  });
  await new Promise<void>((resolve, reject) => {
    redirectTarget.once("error", reject);
    redirectTarget.listen(0, "127.0.0.1", resolve);
  });
  const redirectAddress = redirectTarget.address();
  assert.ok(redirectAddress && typeof redirectAddress !== "string");
  const server = createServer((request, response) => {
    if (request.url === "/typed") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"name":"Ada"}');
      return;
    }
    if (request.url === "/lossy-json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"value":1e400}');
      return;
    }
    if (request.url === "/lossy-error") {
      response.writeHead(500, { "content-type": "application/json" });
      response.end("1e400");
      return;
    }
    if (request.url === "/slow") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("first");
      setTimeout(() => response.end("second"), 100);
      return;
    }
    if (request.url === "/authorized") {
      observedAuthorization = request.headers.authorization;
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("authorized");
      return;
    }
    if (request.url === "/cancel-final") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("final");
      return;
    }
    if (request.url === "/transport-response") {
      response.writeHead(200, { "content-length": "100", "content-type": "text/plain" });
      response.flushHeaders();
      response.write("partial");
      setTimeout(() => response.socket?.destroy(), 10);
      return;
    }
    if (request.url === "/redirect-secret") {
      response.writeHead(302, { location: `http://127.0.0.1:${redirectAddress.port}/target` });
      response.end();
      return;
    }
    if (request.url === "/redirect-error") {
      response.writeHead(302, { location: `http://127.0.0.1:${redirectAddress.port}/error-target` });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.write("one");
    setTimeout(() => response.end("two"), 10);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await http.http.get(`${base}/typed`).parse(User)).name, "Ada");
    assert.equal((await (await http.http.get(`${base}/typed`).response()).parse(User)).name, "Ada");
    await assert.rejects(http.http.get(`${base}/typed`).parse({ parse: (value: unknown) => value }), /compiler-known VelarScript runtime type/u);
    let optionReads = 0;
    const accessorOptions = Object.defineProperty({}, "body", { enumerable: true, get() { optionReads += 1; return { unsafe: true }; } });
    assert.throws(() => http.http.post(base, accessorOptions), /enumerable data values/u);
    assert.equal(optionReads, 0);
    assert.throws(() => http.http.post(base, { body: new Map([["unsafe", true]]) }), /only records and Lists are supported/u);
    const httpSecretName = `VELAR_HTTP_SECRET_${process.pid}`;
    process.env[httpSecretName] = "host-only-token";
    assert.equal(await http.http.get(`${base}/authorized`, {
      secretHeaders: [http.secretHeader("authorization", httpSecretName, "Bearer ")],
    }).text(), "authorized");
    assert.equal(observedAuthorization, "Bearer host-only-token");
    assert.equal(await http.http.get(`${base}/redirect-secret`, {
      secretHeaders: [http.secretHeader("x-provider-key", httpSecretName)],
    }).text(), "redirected");
    assert.equal(redirectedSecret, undefined);
    const finalErrorUrl = `http://127.0.0.1:${redirectAddress.port}/error-target`;
    await assert.rejects(
      http.http.get(`${base}/redirect-error`).text(),
      (error: unknown) => error instanceof http.HttpError
        && (error as Error & { readonly url?: unknown }).url === finalErrorUrl
        && error.message === `HTTP 502 for ${finalErrorUrl}`
        && (error.body as { failed?: unknown }).failed === true,
    );
    await assert.rejects(http.http.get(base, {
      secretHeaders: [http.secretHeader("authorization", "VELAR_MISSING_SECRET")],
    }).text(), /is unavailable/u);
    delete process.env[httpSecretName];
    const chunks: string[] = [];
    const response = await http.http.get(base).response();
    await response.streamText(async (chunk) => { chunks.push(chunk); return null; });
    assert.equal(chunks.join(""), "onetwo");
    assert.ok(chunks.length >= 2);
    await assert.rejects(http.http.get(`${base}/lossy-json`).json(), /numbers must be finite/u);
    await assert.rejects(
      http.http.get(`${base}/lossy-error`).text(),
      (error: unknown) => error instanceof http.HttpError && error.body === "1e400",
    );
    const timed = http.http.get(`${base}/slow`, { timeout: 20 });
    const timedResponse = await timed.response();
    await assert.rejects(timedResponse.streamText(async () => null), (error: unknown) => error instanceof http.HttpAbortError);
    const cancelled = http.http.get(`${base}/slow`, { timeout: 0 });
    const cancelledResponse = await cancelled.response();
    cancelled.cancel();
    await assert.rejects(cancelledResponse.streamText(async () => null), (error: unknown) => error instanceof http.HttpAbortError);
    const cancelledFromConsumer = http.http.get(`${base}/cancel-final`, { timeout: 0 });
    const finalResponse = await cancelledFromConsumer.response();
    await assert.rejects(finalResponse.streamText(async () => {
      cancelledFromConsumer.cancel();
      return null;
    }), (error: unknown) => error instanceof http.HttpAbortError);
    await assert.rejects(
      http.http.get(`${base}/transport-response`, { timeout: 0 }).text(),
      (error: unknown) => error instanceof http.HttpTransportError
        && error.phase === http.HttpTransportPhase.response
        && error.message === "HTTP response transport failed",
    );
  } finally {
    delete process.env[`VELAR_HTTP_SECRET_${process.pid}`];
    server.closeAllConnections();
    redirectTarget.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => redirectTarget.close(() => resolve())),
    ]);
  }
});

test("Node process wait retains a timed-out handle until termination is confirmed", async () => {
  if (process.platform === "win32") return;
  const delayedSignalSource = VELAR_NODE_PROCESS_WORKER_SOURCE.replace(
    "function signalTree(child, signal) {\n  if (!child.pid) return;",
    "let suppressedProcessSignals = 1;\nfunction signalTree(child, signal) {\n  if (suppressedProcessSignals > 0) { suppressedProcessSignals -= 1; return; }\n  if (!child.pid) return;",
  );
  assert.notEqual(delayedSignalSource, VELAR_NODE_PROCESS_WORKER_SOURCE);
  const channel = new MessageChannel();
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let nextId = 1;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  const worker = new Worker(delayedSignalSource, {
    eval: true,
    workerData: channel.port2,
    transferList: [channel.port2],
  });
  channel.port1.on("message", (message: {
    kind?: unknown;
    id?: unknown;
    ok?: unknown;
    value?: unknown;
    error?: { message?: unknown };
  }) => {
    if (message.kind === "ready") {
      readyResolve?.();
      return;
    }
    if (message.kind !== "response" || !Number.isSafeInteger(message.id)) return;
    const request = pending.get(message.id as number);
    if (!request) return;
    pending.delete(message.id as number);
    if (message.ok === true) request.resolve(message.value);
    else request.reject(new Error(typeof message.error?.message === "string" ? message.error.message : "Process worker request failed"));
  });
  worker.once("error", (error) => {
    const failure = error instanceof Error ? error : new Error("Process worker failed");
    readyReject?.(failure);
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  });
  const call = (operation: string, args: readonly unknown[]): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolveCall, rejectCall) => {
      pending.set(id, { resolve: resolveCall, reject: rejectCall });
      channel.port1.postMessage({ id, operation, args });
    });
  };
  let childPid: number | null = null;
  try {
    await ready;
    const started = await call("start", [process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: undefined,
      env: {},
      stdin: "",
      timeout: 10,
      maxOutputBytes: 65536,
    }]) as { handle: number; pid: number };
    childPid = started.pid;
    const waitStartedAt = Date.now();
    assert.deepEqual(await call("wait", [started.handle]), {
      result: null,
      error: { name: "Error", message: "Process termination could not be confirmed within 5000 milliseconds" },
      retained: true,
    });
    assert.ok(Date.now() - waitStartedAt < 8_000, "Process.wait must bound an unconfirmed execution timeout");
    assert.doesNotThrow(() => process.kill(childPid as number, 0));
    const terminal = await call("wait", [started.handle]) as {
      result: unknown;
      error: { name: string; message: string } | null;
      retained: boolean;
    };
    assert.equal(terminal.result, null);
    assert.equal(terminal.error?.message, "Process timed out after 10 milliseconds");
    assert.equal(terminal.retained, false);
    assert.throws(() => process.kill(childPid as number, 0), (error: unknown) => error instanceof Error && "code" in error && error.code === "ESRCH");
    childPid = null;
  } finally {
    if (childPid !== null) {
      try { process.kill(-childPid, "SIGKILL"); }
      catch { try { process.kill(childPid, "SIGKILL"); } catch {} }
    }
    channel.port1.close();
    await worker.terminate();
  }
});

test("Node HTTP bounds isolated host metadata, UTF-8, declared lengths, and response chunks", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/headers") {
      for (let index = 0; index < 101; index += 1) response.setHeader(`x-velar-${index}`, "value");
      response.end("headers");
      return;
    }
    if (request.url === "/empty") {
      response.writeHead(204, {"content-length": "100"});
      response.end();
      return;
    }
    if (request.url === "/declared") {
      response.writeHead(200, {"content-length": "100"});
      response.end("x");
      return;
    }
    if (request.url === "/invalid-utf8") {
      response.writeHead(200, {"content-type": "text/plain"});
      response.end(NodeBuffer.from([0xff]));
      return;
    }
    if (request.url === "/chunks") {
      response.writeHead(200, {"content-type": "text/plain", "transfer-encoding": "chunked"});
      let chunk = 0;
      const writeChunk = (): void => {
        if (chunk === 4) { response.end(); return; }
        response.write(String(chunk));
        chunk += 1;
        setTimeout(writeChunk, 5);
      };
      writeChunk();
      return;
    }
    response.writeHead(404);
    response.end("missing");
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  let http: {
    HttpError: new (message: unknown, status: unknown, url: unknown) => Error;
    http: {
      get(url: string, options?: Record<string, unknown>): {
        text(): Promise<string>;
        response(): Promise<{ text(): Promise<string>; streamText(consumer: (chunk: string) => Promise<null>): Promise<null> }>;
      };
    };
  };
  http = await runtime<typeof http>("velar/http", (source) => source, (name, source) => name === "velar/node-host-v1"
    ? source.replace("const maxHttpResponseChunks = 1000000;", "const maxHttpResponseChunks = 3;")
    : source);
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    await assert.rejects(http.http.get(`${base}/headers`).response(), /cannot exceed 100 fields/u);

    const empty = await http.http.get(`${base}/empty`, { timeout: 1000 }).response();
    assert.equal(await empty.text(), "");

    const declared = await http.http.get(`${base}/declared`, { maxBytes: 4 }).response();
    await assert.rejects(declared.streamText(async () => null), /exceeds maxBytes/u);

    const captured = await http.http.get(`${base}/declared`, { maxBytes: 4 }).response();
    const originalTest = RegExp.prototype.test;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalApply = Reflect.apply;
    let capturedError: unknown = null;
    try {
      RegExp.prototype.test = () => false;
      String.prototype.charCodeAt = () => 0;
      Reflect.apply = () => 0;
      try { await captured.text(); } catch (error) { capturedError = error; }
    } finally {
      RegExp.prototype.test = originalTest;
      String.prototype.charCodeAt = originalCharCodeAt;
      Reflect.apply = originalApply;
    }
    assert.ok(capturedError instanceof RangeError && /exceeds maxBytes/u.test(capturedError.message));

    await assert.rejects(http.http.get(`${base}/invalid-utf8`).text(), TypeError);
    const chunked = await http.http.get(`${base}/chunks`).response();
    await assert.rejects(chunked.streamText(async () => null), /cannot exceed 1000000 chunks/u);

    assert.throws(() => new http.HttpError("message", 99, "https://example.test/"), /100 through 599/u);
    assert.throws(() => new http.HttpError("x".repeat(65537), 400, "https://example.test/"), RangeError);
    assert.throws(() => new http.HttpError("message", 400, "x".repeat(2 * 1024 * 1024 + 1)), RangeError);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

test("Node HTTP keeps its complete request and response ABI after application intrinsic replacement", async () => {
  let authorization: string | undefined;
  const server = createServer((request, response) => {
    authorization = request.headers.authorization;
    request.resume();
    response.writeHead(200, {"content-type": "text/plain"});
    response.end("ready");
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const directory = await mkdtemp(join(tmpdir(), "velar-node-hostile-http-"));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const source = nodeModuleSources.get("velar/http");
    assert.ok(source);
    await materializeNodeRuntimeDependencies(directory, "velar/http");
    await writeFile(join(directory, "http.mjs"), source, "utf8");
    await writeFile(join(directory, "driver.mjs"), `
const nativeApply = Reflect.apply;
const nativeDefine = Object.defineProperty;
const nativeOwnDescriptor = Object.getOwnPropertyDescriptor;
const nativeWrite = process.stdout.write;
const NativeError = Error;
const http = await import("./http.mjs");
const secretName = "VELAR_HOSTILE_HTTP_SECRET";
process.env[secretName] = "captured";
const descriptor = http.secretHeader("authorization", secretName, "Bearer ");
const options = {
  headers: new Map([["accept", "text/plain"]]),
  secretHeaders: [descriptor],
  body: {value: 3},
  timeout: 1000,
  maxBytes: 1024,
};
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const originals = {
  arrayIsArray: nativeOwnDescriptor(Array, "isArray"),
  arrayIncludes: nativeOwnDescriptor(Array.prototype, "includes"),
  arrayJoin: nativeOwnDescriptor(Array.prototype, "join"),
  arrayPush: nativeOwnDescriptor(Array.prototype, "push"),
  functionCall: nativeOwnDescriptor(Function.prototype, "call"),
  mapGet: nativeOwnDescriptor(Map.prototype, "get"),
  mapKeys: nativeOwnDescriptor(Map.prototype, "keys"),
  mapSet: nativeOwnDescriptor(Map.prototype, "set"),
  numberIsInteger: nativeOwnDescriptor(Number, "isInteger"),
  numberIsSafeInteger: nativeOwnDescriptor(Number, "isSafeInteger"),
  objectCreate: nativeOwnDescriptor(Object, "create"),
  objectFreeze: nativeOwnDescriptor(Object, "freeze"),
  objectGetOwnPropertyDescriptor: nativeOwnDescriptor(Object, "getOwnPropertyDescriptor"),
  objectGetPrototypeOf: nativeOwnDescriptor(Object, "getPrototypeOf"),
  objectKeys: nativeOwnDescriptor(Object, "keys"),
  reflectApply: nativeOwnDescriptor(Reflect, "apply"),
  reflectOwnKeys: nativeOwnDescriptor(Reflect, "ownKeys"),
  regexpTest: nativeOwnDescriptor(RegExp.prototype, "test"),
  setHas: nativeOwnDescriptor(Set.prototype, "has"),
  stringLower: nativeOwnDescriptor(String.prototype, "toLowerCase"),
  stringUpper: nativeOwnDescriptor(String.prototype, "toUpperCase"),
  textDecoder: nativeOwnDescriptor(globalThis, "TextDecoder"),
  textDecoderDecode: nativeOwnDescriptor(TextDecoder.prototype, "decode"),
  typedArrayByteLength: nativeOwnDescriptor(typedArrayPrototype, "byteLength"),
  error: nativeOwnDescriptor(globalThis, "Error"),
  rangeError: nativeOwnDescriptor(globalThis, "RangeError"),
  typeError: nativeOwnDescriptor(globalThis, "TypeError"),
};
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new NativeError("application intrinsic poison reached velar/http"); };
nativeDefine(Array, "isArray", {...originals.arrayIsArray, value: poison});
nativeDefine(Array.prototype, "includes", {...originals.arrayIncludes, value: poison});
nativeDefine(Array.prototype, "join", {...originals.arrayJoin, value: poison});
nativeDefine(Array.prototype, "push", {...originals.arrayPush, value: poison});
nativeDefine(Function.prototype, "call", {...originals.functionCall, value: poison});
nativeDefine(Map.prototype, "get", {...originals.mapGet, value: poison});
nativeDefine(Map.prototype, "keys", {...originals.mapKeys, value: poison});
nativeDefine(Map.prototype, "set", {...originals.mapSet, value: poison});
nativeDefine(Number, "isInteger", {...originals.numberIsInteger, value: poison});
nativeDefine(Number, "isSafeInteger", {...originals.numberIsSafeInteger, value: poison});
nativeDefine(Object, "create", {...originals.objectCreate, value: poison});
nativeDefine(Object, "freeze", {...originals.objectFreeze, value: poison});
nativeDefine(Object, "getOwnPropertyDescriptor", {...originals.objectGetOwnPropertyDescriptor, value: poison});
nativeDefine(Object, "getPrototypeOf", {...originals.objectGetPrototypeOf, value: poison});
nativeDefine(Object, "keys", {...originals.objectKeys, value: poison});
nativeDefine(Reflect, "apply", {...originals.reflectApply, value: poison});
nativeDefine(Reflect, "ownKeys", {...originals.reflectOwnKeys, value: poison});
nativeDefine(RegExp.prototype, "test", {...originals.regexpTest, value: poison});
nativeDefine(Set.prototype, "has", {...originals.setHas, value: poison});
nativeDefine(String.prototype, "toLowerCase", {...originals.stringLower, value: poison});
nativeDefine(String.prototype, "toUpperCase", {...originals.stringUpper, value: poison});
nativeDefine(globalThis, "TextDecoder", {...originals.textDecoder, value: poison});
nativeDefine(originals.textDecoder.value.prototype, "decode", {...originals.textDecoderDecode, value: poison});
nativeDefine(typedArrayPrototype, "byteLength", {...originals.typedArrayByteLength, get: poison});
nativeDefine(globalThis, "Error", {...originals.error, value: poison});
nativeDefine(globalThis, "RangeError", {...originals.rangeError, value: poison});
nativeDefine(globalThis, "TypeError", {...originals.typeError, value: poison});

let text;
try {
  text = await http.http.post(process.argv[2], options).text();
} finally {
  nativeDefine(Array, "isArray", originals.arrayIsArray);
  nativeDefine(Array.prototype, "includes", originals.arrayIncludes);
  nativeDefine(Array.prototype, "join", originals.arrayJoin);
  nativeDefine(Array.prototype, "push", originals.arrayPush);
  nativeDefine(Function.prototype, "call", originals.functionCall);
  nativeDefine(Map.prototype, "get", originals.mapGet);
  nativeDefine(Map.prototype, "keys", originals.mapKeys);
  nativeDefine(Map.prototype, "set", originals.mapSet);
  nativeDefine(Number, "isInteger", originals.numberIsInteger);
  nativeDefine(Number, "isSafeInteger", originals.numberIsSafeInteger);
  nativeDefine(Object, "create", originals.objectCreate);
  nativeDefine(Object, "freeze", originals.objectFreeze);
  nativeDefine(Object, "getOwnPropertyDescriptor", originals.objectGetOwnPropertyDescriptor);
  nativeDefine(Object, "getPrototypeOf", originals.objectGetPrototypeOf);
  nativeDefine(Object, "keys", originals.objectKeys);
  nativeDefine(Reflect, "apply", originals.reflectApply);
  nativeDefine(Reflect, "ownKeys", originals.reflectOwnKeys);
  nativeDefine(RegExp.prototype, "test", originals.regexpTest);
  nativeDefine(Set.prototype, "has", originals.setHas);
  nativeDefine(String.prototype, "toLowerCase", originals.stringLower);
  nativeDefine(String.prototype, "toUpperCase", originals.stringUpper);
  nativeDefine(globalThis, "TextDecoder", originals.textDecoder);
  nativeDefine(originals.textDecoder.value.prototype, "decode", originals.textDecoderDecode);
  nativeDefine(typedArrayPrototype, "byteLength", originals.typedArrayByteLength);
  nativeDefine(globalThis, "Error", originals.error);
  nativeDefine(globalThis, "RangeError", originals.rangeError);
  nativeDefine(globalThis, "TypeError", originals.typeError);
}
const observed = [text, String(poisonCalls)].join("|");
nativeApply(nativeWrite, process.stdout, [observed + "\\n"]);
`.trimStart(), "utf8");
    const result = await runProcess(process.execPath, [join(directory, "driver.mjs"), `http://127.0.0.1:${address.port}/run`], directory, process.env);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "ready|0\n");
    assert.equal(result.stderr, "");
    assert.equal(authorization, "Bearer captured");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("Node HTTP retains an unread isolated response and releases the process after completion", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, {"content-type": "text/plain"});
    response.write("held-");
    setTimeout(() => response.end("complete"), 100);
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const directory = await mkdtemp(join(tmpdir(), "velar-node-http-lifecycle-"));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const source = nodeModuleSources.get("velar/http");
    assert.ok(source);
    await materializeNodeRuntimeDependencies(directory, "velar/http");
    await writeFile(join(directory, "http.mjs"), source, "utf8");
    await writeFile(join(directory, "driver.mjs"), `
import * as runtime from "./http.mjs";
void runtime.http.get(process.argv[2], {timeout: 0}).text().then(text => process.stdout.write(text));
`.trimStart(), "utf8");
    const startedAt = Date.now();
    const result = await runProcess(
      process.execPath,
      [join(directory, "driver.mjs"), `http://127.0.0.1:${address.port}/held`],
      directory,
      process.env,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "held-complete");
    assert.ok(Date.now() - startedAt >= 75);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(directory, {recursive: true, force: true});
  }
});

test("Node HTTP resolves lazy secrets through its captured transport host", async () => {
  const observed: Array<string | undefined> = [];
  const server = createServer((request, response) => {
    observed.push(request.headers.authorization);
    response.writeHead(200, {"content-type": "text/plain"});
    response.end("ok");
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch")!;
  const originalHeadersDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Headers")!;
  const originalUrlDescriptor = Object.getOwnPropertyDescriptor(globalThis, "URL")!;
  const originalAbortControllerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "AbortController")!;
  const originalFromEntriesDescriptor = Object.getOwnPropertyDescriptor(Object, "fromEntries")!;
  let http: {
    secretHeader(name: string, environment: string, prefix?: string): Readonly<{ name: string; environment: string; prefix: string }>;
    http: {
      get(url: string, options?: Record<string, unknown>): { text(): Promise<string> };
    };
  };
  http = await runtime<typeof http>("velar/http");
  const variable = `VELAR_LAZY_HTTP_SECRET_${process.pid}`;
  let ambientReads = 0;
  Object.defineProperty(globalThis, "fetch", { ...originalFetchDescriptor, value: async () => { ambientReads += 1; throw new Error("ambient fetch invoked"); } });
  Object.defineProperty(globalThis, "Headers", { ...originalHeadersDescriptor, value: class { constructor() { ambientReads += 1; throw new Error("ambient Headers invoked"); } } });
  Object.defineProperty(globalThis, "URL", { ...originalUrlDescriptor, value: class { constructor() { ambientReads += 1; throw new Error("ambient URL invoked"); } } });
  Object.defineProperty(globalThis, "AbortController", { ...originalAbortControllerDescriptor, value: class { constructor() { ambientReads += 1; throw new Error("ambient AbortController invoked"); } } });
  Object.defineProperty(Object, "fromEntries", { ...originalFromEntriesDescriptor, value: () => { ambientReads += 1; throw new Error("ambient Object.fromEntries invoked"); } });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const descriptor = http.secretHeader("authorization", variable, "Bearer ");
    process.env[variable] = "value-at-creation";
    const rotated = http.http.get(`${base}/rotated`, { secretHeaders: [descriptor] });
    process.env[variable] = "value-at-start";
    assert.equal(await rotated.text(), "ok");
    assert.equal(observed.at(-1), "Bearer value-at-start");

    delete process.env[variable];
    const suppliedLater = http.http.get(`${base}/supplied-later`, { secretHeaders: [descriptor] });
    process.env[variable] = "late-value";
    assert.equal(await suppliedLater.text(), "ok");
    assert.equal(observed.at(-1), "Bearer late-value");

    delete process.env[variable];
    const missing = http.http.get(`${base}/missing`, { secretHeaders: [descriptor] });
    const callsBeforeMissing = observed.length;
    await assert.rejects(missing.text(), /is unavailable/u);
    assert.equal(observed.length, callsBeforeMissing);

    const hidden: unknown[] = [];
    Object.defineProperty(hidden, "0", { value: descriptor, enumerable: false, configurable: true });
    hidden.length = 1;
    assert.throws(
      () => http.http.get(`${base}/hidden`, { secretHeaders: hidden }),
      /entries must be created by secretHeader/u,
    );
    assert.equal(ambientReads, 0);
  } finally {
    Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
    Object.defineProperty(globalThis, "Headers", originalHeadersDescriptor);
    Object.defineProperty(globalThis, "URL", originalUrlDescriptor);
    Object.defineProperty(globalThis, "AbortController", originalAbortControllerDescriptor);
    Object.defineProperty(Object, "fromEntries", originalFromEntriesDescriptor);
    delete process.env[variable];
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

test("Node HTTP coalesces concurrent buffered response readers", async () => {
  let fetchCalls = 0;
  const server = createServer((_request, response) => {
    fetchCalls += 1;
    response.writeHead(200, {"content-type": "application/json"});
    response.end('{"value":3}');
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  let http: {
    http: {
      get(url: string): {
        response(): Promise<{
          json(): Promise<unknown>;
          text(): Promise<string>;
        }>;
      };
    };
  };
  http = await runtime<typeof http>("velar/http");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await http.http.get(`http://127.0.0.1:${address.port}/value`).response();
    const [text, json] = await Promise.all([response.text(), response.json()]);
    assert.equal(text, '{"value":3}');
    assert.equal((json as { value: number }).value, 3);
    assert.equal(await response.text(), text);
    assert.equal(fetchCalls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

test("compiled VelarScript resolves secret headers only inside the Node HTTP host", async () => {
  let authorization: string | undefined;
  const server = createServer((request, response) => {
    authorization = request.headers.authorization;
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("vel-secret-ready");
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const directory = await mkdtemp(join(tmpdir(), "velar-node-secret-program-"));
  const secretName = `VELAR_COMPILED_SECRET_${process.pid}`;
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const entry = join(directory, "main.vel");
    await writeFile(entry, `
import {http, secretHeader} from "velar/http"

const result = await http.get("http://127.0.0.1:${address.port}/", {
    secretHeaders: [secretHeader("authorization", "${secretName}", prefix="Bearer ")],
}).text()
print(result)
`.trimStart(), "utf8");
    const result = await runProcess(process.execPath, [resolve("packages/cli/src/cli.ts"), "run", entry], directory, {
      ...process.env,
      [secretName]: "compiled-host-token",
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), "vel-secret-ready");
    assert.equal(authorization, "Bearer compiled-host-token");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(directory, { recursive: true, force: true });
  }
});

function runProcess(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  input?: string,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, arguments_, { cwd, env, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", rejectRun);
    child.once("exit", (code) => resolveRun({ code, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}
