import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { compileProject } from "../../packages/cli/src/project.ts";
import { nodeModuleSources } from "../../packages/node/src/compiler.ts";
import { materializeNodeRuntimeDependencies, runProcess, runtime } from "../support/node-runtime.ts";

/**
 * D115 §三 — one `velar/*` module per file, split out of the 2,809-line heavy
 * tier `node-platform.slow.test.ts`. Every test here is the one that was
 * there, moved verbatim; the quick-tier core cases D114 GA-U3 lifted out stay
 * in `node-platform.test.ts` and `node-platform-serve.test.ts`.
 *
 * The subject is `velar/http`: the request and response ABI it keeps after the
 * application replaces its intrinsics, the response it isolates and releases
 * unread, the secrets it resolves only inside its own host, and the readers it
 * coalesces. The typed-parsing case opens the file because the shape it
 * rejects — a Promise-assimilated result — is one `http.parse` and a serve
 * handler reach the same way.
 */

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
