import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VELAR_TYPE_REGISTRY_KEY } from "../../packages/compiler/src/runtime-abi.ts";
import { nodeModuleSources } from "../../packages/node/src/compiler.ts";
import { materializeNodeRuntimeDependencies, runProcess } from "../support/node-runtime.ts";

/**
 * D115 §三 — one `velar/*` module per file, split out of the 2,809-line heavy
 * tier `node-platform.slow.test.ts`. Every test here is the one that was
 * there, moved verbatim; the quick-tier core cases D114 GA-U3 lifted out stay
 * in `node-platform.test.ts` and `node-platform-serve.test.ts`.
 *
 * The subject is what `velar/serve` keeps when the application under it is
 * hostile: the hardened compiler registry its extension Types share, and the
 * transport that stays isolated after the stream and event prototypes it was
 * built on are replaced.
 */

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
  bytes: async () => new Uint8Array(),
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
