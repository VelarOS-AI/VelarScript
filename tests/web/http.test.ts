import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { executeModule } from "../support/execute-module.ts";
import { standardModuleSource } from "../support/compiler-suite.ts";

test("lazy HTTP cancellation and timeout have stable owned semantics", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`let fetchCount = 0;
globalThis.fetch = async (_url, options) => {
  fetchCount += 1;
  return await new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason));
  });
};
${http}

const beforeStart = http.get("https://example.test/before");
beforeStart.cancel();
beforeStart.cancel();
try { await beforeStart.response(); console.log("accepted"); }
catch (error) { console.log(error instanceof HttpAbortError, error.name, error.reason, fetchCount); }

const active = http.get("https://example.test/active");
const activeResult = active.response();
active.cancel();
try { await activeResult; console.log("accepted"); }
catch (error) { console.log(error instanceof HttpAbortError, error.reason, fetchCount); }

const timed = http.get("https://example.test/timeout", { timeout: 1 });
try { await timed.response(); console.log("accepted"); }
catch (error) { console.log(error instanceof HttpAbortError, error.reason, fetchCount); }

try { new HttpAbortError("other"); console.log("accepted"); }
catch (error) { console.log(error.name); }
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "true HttpAbortError cancelled 0",
    "true cancelled 1",
    "true timeout 2",
    "TypeError",
    "",
  ].join("\n"));
});

test("Web HTTP classifies request and response transport failures without swallowing consumer errors", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`const encoder = new TextEncoder();
globalThis.fetch = async (url) => {
  if (String(url).endsWith("/request")) throw new Error("native request failure");
  if (String(url).endsWith("/response")) {
    return new Response(new ReadableStream({start(controller) { controller.error(new Error("native response failure")); }}), {status: 200});
  }
  return new Response(new ReadableStream({start(controller) { controller.enqueue(encoder.encode("value")); controller.close(); }}), {status: 200});
};
${http}
try { await http.get("https://example.test/request", {timeout: 0}).text(); console.log("accepted"); }
catch (error) { console.log(error instanceof HttpTransportError, error.phase === HttpTransportPhase.request, error.message); }
try { await http.get("https://example.test/response", {timeout: 0}).text(); console.log("accepted"); }
catch (error) { console.log(error instanceof HttpTransportError, error.phase === HttpTransportPhase.response, error.message); }
try { await http.get("https://example.test/consumer", {timeout: 0}).streamText(async () => { throw new Error("consumer failed"); }); console.log("accepted"); }
catch (error) { console.log(error instanceof HttpTransportError, error.message); }
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "true true HTTP request transport failed",
    "true true HTTP response transport failed",
    "false consumer failed",
    "",
  ].join("\n"));
});

test("Web HTTP shares the bounded cross-target timeout contract", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`const delays = [];
globalThis.setTimeout = (_callback, delay) => { delays.push(delay); return 1; };
globalThis.clearTimeout = () => {};
globalThis.fetch = async (_url, options) => await new Promise((_resolve, reject) => {
  options.signal.addEventListener("abort", () => reject(options.signal.reason));
});
${http}
const bounded = http.get("https://example.test/default-timeout");
const pending = bounded.response();
await Promise.resolve();
console.log(delays.join(","));
bounded.cancel();
try { await pending; } catch {}
const disabled = http.get("https://example.test/no-timeout", {timeout: 0});
const disabledPending = disabled.response();
await Promise.resolve();
console.log(delays.join(","));
disabled.cancel();
try { await disabledPending; } catch {}
for (const timeout of [1.5, 600001]) {
  try { http.get("https://example.test/invalid-timeout", {timeout}); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "120000\n120000\nRangeError\nRangeError\n");
});

test("HTTP validates options, methods, bodies, headers, and runtime types before fetch", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`import { runInNewContext } from "node:vm";
let fetchCount = 0;
let captured = null;
globalThis.fetch = async (url, options) => {
  fetchCount += 1;
  captured = { url, method: options.method, body: options.body, contentType: options.headers.get("content-type"), credentials: options.credentials, cache: options.cache };
  return new Response('{"value":2}', { status: 200, headers: { "content-type": "application/json" } });
};
${http}
const Result = __velarRegisterRuntimeType(Object.freeze({ is(value) { return typeof value?.value === "number"; }, parse(value) { if (!this.is(value)) throw new TypeError("invalid result"); return value; } }));
const foreignHeaders = runInNewContext('class HostileMap extends Map { get size() { throw new Error("size override") } entries() { throw new Error("entries override") } }; new HostileMap([["x-test", "yes"]])');
console.log((await http.post("/items", { headers: foreignHeaders, body: { value: 1 }, timeout: 10, credentials: "include", cache: "no-cache" }).parse(Result)).value);
console.log(captured.url, captured.method, captured.body, captured.contentType, captured.credentials, captured.cache, fetchCount);
let getterReads = 0;
const accessorOptions = {};
Object.defineProperty(accessorOptions, "timeout", { enumerable: true, get() { getterReads += 1; return 10; } });
const forgedType = Object.defineProperty({ is() { return true; } }, "parse", { enumerable: true, get() { getterReads += 1; return value => value; } });
let forgedFileGetterReads = 0;
const forgedFileRecord = Object.freeze({ name: "forged.txt", size: 1, type: "text/plain", modified: 0 });
const forgedNativeFile = Object.defineProperty({}, "name", { get() { forgedFileGetterReads += 1; return "forged.txt"; } });
Object.getOwnPropertyDescriptor(globalThis, Symbol.for("velar.file.registry.v1")).value.set(forgedFileRecord, forgedNativeFile);
try { formBody().file("upload", forgedFileRecord); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(forgedFileGetterReads);
for (const operation of [
  () => http.get(42),
  () => http.request("TRACE", "/items"),
  () => http.request("bad method", "/items"),
  () => http.get("/items", { unknown: true }),
  () => http.get("/items", accessorOptions),
  () => http.get("/items", { headers: new Map([[1, "value"]]) }),
  () => http.get("/items", { credentials: "always" }),
  () => http.get("/items", { cache: "only-if-cached" }),
  () => http.get("/items", { body: "not allowed" }),
  () => http.post("/items", { body: 42 }),
  () => new HttpResponseError(42, 400, "/items"),
  () => new HttpResponseError("failed", 99, "/items"),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
try { await http.get("/items").parse({}); console.log("accepted"); } catch (error) { console.log(error.name); }
try { await http.get("/items").parse(forgedType); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(getterReads, fetchCount);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "2",
    '/items POST {"value":1} application/json include no-cache 1',
    "TypeError", "0",
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError",
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "RangeError",
    "TypeError", "TypeError", "0 1", "",
  ].join("\n"));
});

test("HTTP snapshots JSON and enforces UTF-8 body and generated-header budgets before fetch", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`let fetchCount = 0;
let capturedBody = null;
globalThis.fetch = async (_url, options) => {
  fetchCount += 1;
  capturedBody = options.body;
  return new Response("ok");
};
${http}
const oversized = "é".repeat(8 * 1024 * 1024 + 1);
const fullHeaders = new Map();
for (let index = 0; index < 100; index += 1) fullHeaders.set("x-header-" + index, "value");
for (const operation of [
  () => http.post("/items", {body: oversized}),
  () => http.post("/items", {body: {value: oversized}}),
  () => formBody().field("value", oversized),
  () => http.post("/items", {headers: fullHeaders, body: {value: 1}}),
]) {
  try { operation(); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
const mutable = {value: "before"};
const request = http.post("/items", {body: mutable});
mutable.value = "after";
await request.text();
console.log(capturedBody);
console.log(fetchCount);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, ["RangeError", "RangeError", "RangeError", "RangeError", '{"value":"before"}', "1", ""].join("\n"));
});

test("HTTP rejects malformed request headers before invoking browser fetch", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`let fetchCount = 0;
globalThis.fetch = async () => { fetchCount += 1; return new Response("ok"); };
${http}
for (const headers of [
  new Map([["bad name", "value"]]),
  new Map([["x-value", "first\\nsecond"]]),
]) {
  try { http.get("/items", {headers}); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
for (const operation of [
  () => new HttpResponseError("x".repeat(65537), 400, "/items"),
  () => new HttpResponseError("failed", 400, "x".repeat(2 * 1024 * 1024 + 1)),
]) {
  try { operation(); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
console.log(fetchCount);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "TypeError\nTypeError\nRangeError\nRangeError\n0\n");
});

test("HTTP response maxBytes cancels oversized streams and permits repeat typed reads", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`let fetchCalls = 0;
let cancelled = false;
let declaredCancelled = false;
let wrongChunkCancelled = false;
globalThis.fetch = async (url) => {
  fetchCalls += 1;
  if (url === "/large") {
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("large")); },
      cancel() { cancelled = true; },
    }));
  }
  if (url === "/declared-large") {
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("x")); controller.close(); },
      cancel() { declaredCancelled = true; },
    }), { headers: { "content-length": "100" } });
  }
  if (url === "/declared-empty") return new Response(null, { headers: { "content-length": "100" } });
  if (url === "/wrong-chunk") {
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint16Array([1])); },
      cancel() { wrongChunkCancelled = true; },
    }));
  }
  if (url === "/invalid-utf8") return new Response(new Uint8Array([0xc3, 0x28]));
  return new Response('{"value":3}', { headers: { "content-type": "application/json" } });
};
${http}
try { await http.get("/large", { maxBytes: 4 }).text(); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(cancelled);
try { await http.get("/declared-large", { maxBytes: 4 }).streamText(async () => null); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(declaredCancelled);
console.log(await http.get("/declared-empty", { maxBytes: 4 }).text() === "");
const response = await http.get("/cached").response();
const [cachedText, cachedJson] = await Promise.all([response.text(), response.json()]);
console.log(cachedText);
console.log(cachedJson.value);
try { await http.get("/wrong-chunk").text(); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(wrongChunkCancelled);
try { await http.get("/invalid-utf8").text(); console.log("accepted"); }
catch (error) { console.log(error.name); }
const invalidCached = await http.get("/invalid-utf8").response();
await invalidCached.bytes();
try { await invalidCached.streamText(async () => null); console.log("accepted"); }
catch (error) { console.log(error.name); }
try { http.get("/invalid", { maxBytes: 0 }); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(fetchCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, 'RangeError\ntrue\nRangeError\ntrue\ntrue\n{"value":3}\n3\nTypeError\ntrue\nTypeError\nTypeError\nRangeError\n7\n');
});

test("HTTP declared-length preflight retains compiler-owned transport intrinsics", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`let cancelled = false;
globalThis.fetch = async () => new Response(new ReadableStream({
  start(controller) { controller.enqueue(new TextEncoder().encode("x")); controller.close(); },
  cancel() { cancelled = true; },
}), { headers: { "content-length": "100" } });
${http}
const response = await http.get("/declared", { maxBytes: 4 }).response();
const originalTest = RegExp.prototype.test;
const originalCharCodeAt = String.prototype.charCodeAt;
const originalApply = Reflect.apply;
let outcome = "accepted";
try {
  RegExp.prototype.test = () => false;
  String.prototype.charCodeAt = () => 0;
  Reflect.apply = () => 0;
  try { await response.text(); }
  catch (error) { outcome = error.name; }
} finally {
  RegExp.prototype.test = originalTest;
  String.prototype.charCodeAt = originalCharCodeAt;
  Reflect.apply = originalApply;
}
console.log(outcome, cancelled);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError true\n");
});

test("HTTP validates response metadata and bounds returned headers", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`let mode = "headers";
let statusReads = 0;
let okReads = 0;
let headerReads = 0;
let rejectedBodyCancelled = false;
globalThis.fetch = async () => {
  if (mode === "zero") return Response.error();
  const headers = new Headers();
  if (mode === "headers") for (let index = 0; index <= 100; index += 1) headers.set("x-field-" + index, "value");
  const body = mode === "headers" ? new ReadableStream({cancel() { rejectedBodyCancelled = true; }}) : "ok";
  const response = new Response(body, { headers });
  if (mode === "url") Object.defineProperty(response, "url", { value: "x".repeat(2 * 1024 * 1024 + 1) });
  if (mode === "status") Object.defineProperty(response, "status", { value: Number.NaN });
  if (mode === "consistency") Object.defineProperty(response, "ok", { value: false });
  if (mode === "snapshot") {
    const nativeHeaders = response.headers;
    Object.defineProperty(response, "ok", { get() { okReads += 1; return true; } });
    Object.defineProperty(response, "status", { get() { statusReads += 1; return statusReads === 1 ? 200 : Number.NaN; } });
    Object.defineProperty(response, "headers", { get() { headerReads += 1; return headerReads === 1 ? nativeHeaders : { get() { throw new Error("headers changed"); } }; } });
  }
  return response;
};
${http}
for (const selected of ["headers", "url", "status", "zero", "consistency"]) {
  mode = selected;
  try { const response = await http.get("/probe").response(); await response.text(); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
console.log(rejectedBodyCancelled);
mode = "snapshot";
const snapshot = await http.get("/probe").response();
console.log(snapshot.status, statusReads, okReads, headerReads);
console.log(await snapshot.text());
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError\naccepted\naccepted\nTypeError\naccepted\ntrue\n200 0 0 0\nok\n");
});

test("HTTP errors identify the final response URL after redirects", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`const HostResponse = globalThis.Response;
class RedirectResponse {
  constructor(url) { this.urlValue = url; this.response = new HostResponse('{"failed":true}', { status: 502, headers: { "content-type": "application/json" } }); }
  get ok() { return false; }
  get status() { return 502; }
  get statusText() { return "Bad Gateway"; }
  get url() { return this.urlValue; }
  get headers() { return this.response.headers; }
  get body() { return this.response.body; }
}
globalThis.Response = RedirectResponse;
globalThis.fetch = async (url) => {
  return new RedirectResponse(url === "/synthetic" ? "" : "https://final.example.test/failure");
};
${http}
for (const url of ["/initial", "/synthetic"]) {
  try { await http.get(url).text(); }
  catch (error) { console.log(error.url); console.log(error.message); console.log(error.body.failed); }
}
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "https://final.example.test/failure",
    "HTTP 502 for https://final.example.test/failure",
    "true",
    "/synthetic",
    "HTTP 502 for /synthetic",
    "true",
    "",
  ].join("\n"));
});

test("Web HTTP uses its captured host after ambient transport replacement", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`const HostHeaders = globalThis.Headers;
const HostResponse = globalThis.Response;
const HostFormData = globalThis.FormData;
const HostBlob = globalThis.Blob;
const hostHeaderGet = Object.getOwnPropertyDescriptor(HostHeaders.prototype, "get").value;
const hostFormGet = Object.getOwnPropertyDescriptor(HostFormData.prototype, "get").value;
let hostCalls = 0;
let ambientReads = 0;
const observed = [];
const timers = [];
globalThis.fetch = async (_url, options) => {
  hostCalls += 1;
  observed.push({
    body: typeof options.body === "string" ? options.body : options.body instanceof HostFormData ? Reflect.apply(hostFormGet, options.body, ["value"]) : null,
    contentType: Reflect.apply(hostHeaderGet, options.headers, ["content-type"]),
  });
  return new HostResponse("ok", {headers: {"content-type": "text/plain"}});
};
globalThis.setTimeout = (_callback, delay) => { timers.push("set:" + delay); return 7; };
globalThis.clearTimeout = value => { timers.push("clear:" + value); };
${http}
for (const name of ["fetch", "Headers", "Response", "AbortController", "FormData", "Blob", "TextDecoder", "Uint8Array"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: class { constructor() { ambientReads += 1; throw new Error("ambient " + name + " invoked"); } } });
}
globalThis.setTimeout = () => { ambientReads += 1; throw new Error("ambient timer invoked"); };
globalThis.clearTimeout = () => { ambientReads += 1; throw new Error("ambient timer cleanup invoked"); };
console.log(await http.post("/json", {body: {ready: true}, timeout: 10}).text());
const form = formBody();
form.field("value", "field-ready");
console.log(await http.post("/form", {body: form, timeout: 10}).text());
console.log((await http.get("/blob", {timeout: 10}).blob()) instanceof HostBlob);
console.log(hostCalls, ambientReads);
console.log(JSON.stringify(observed));
console.log(timers.join(","));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "ok",
    "ok",
    "true",
    "3 0",
    '[{"body":"{\\"ready\\":true}","contentType":"application/json"},{"body":"field-ready","contentType":null},{"body":null,"contentType":null}]',
    "set:10,clear:7,set:10,clear:7,set:10,clear:7",
    "",
  ].join("\n"));
});

test("Web shared option and List guards retain their initialization-time intrinsics", () => {
  const http = standardModuleSource("velar/http") ?? "";
const execution = executeModule(`const HostObject = globalThis.Object;
const HostArray = globalThis.Array;
const HostSet = globalThis.Set;
const HostSymbol = globalThis.Symbol;
const hostDefineProperty = HostObject.getOwnPropertyDescriptor(HostObject, "defineProperty").value;
const hostArrayJoin = HostObject.getOwnPropertyDescriptor(HostArray.prototype, "join").value;
const hostReflectApply = HostObject.getOwnPropertyDescriptor(Reflect, "apply").value;
const allowed = new HostSet(["ready"]);
let ambientReads = 0;
${http}
const poison = () => { ambientReads += 1; throw new Error("ambient intrinsic invoked"); };
for (const name of ["getPrototypeOf", "getOwnPropertySymbols", "getOwnPropertyNames", "getOwnPropertyDescriptor", "create", "defineProperty", "freeze"]) {
  hostDefineProperty(HostObject, name, { configurable: true, value: poison });
}
hostDefineProperty(HostArray, "isArray", { configurable: true, value: poison });
hostDefineProperty(HostSet.prototype, "has", { configurable: true, value: poison });
hostDefineProperty(HostSet.prototype, "add", { configurable: true, value: poison });
hostDefineProperty(HostSymbol, "for", { configurable: true, value: poison });
hostDefineProperty(Reflect, "apply", { configurable: true, value: poison });
hostDefineProperty(globalThis, "Array", { configurable: true, value: class { constructor() { poison(); } } });
hostDefineProperty(globalThis, "Set", { configurable: true, value: class { constructor() { poison(); } } });
const options = __velarOptions({ready: true}, "Probe options", allowed);
const capturedOptions = __velarOptions({ready: true}, "Captured options", __velarOptionFields(["ready"]));
const values = __velarRequireList(["one", "two"], "Probe values");
console.log(options.ready);
console.log(capturedOptions.ready);
console.log(hostReflectApply(hostArrayJoin, values, [","]));
console.log(ambientReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\none,two\n0\n");
});

test("the Web List guard tells an absent reactive runtime apart from a foreign generation", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`const hostDefineProperty = Object.getOwnPropertyDescriptor(Object, "defineProperty").value;
const registryKey = Symbol.for("velar.runtime.v1");
${http}
console.log(__velarRequireList(["one", "two"], "Probe values").join(","));
hostDefineProperty(globalThis, registryKey, {
  configurable: true,
  value: {version: "0.11", toRaw: value => value, collectionRead: () => {}},
});
try { __velarRequireList(["one"], "Probe values"); console.log("accepted"); }
catch (error) { console.log(error.name + ": " + error.message); }
// D90 fr-5: a generation old enough to have no version field at all is still a
// generation, and Core, the JSON bridge and the Web reactive foundation all
// refuse it. The Web List guard reads the same global slot, so it applies the
// same rule rather than a looser one of its own.
hostDefineProperty(globalThis, registryKey, {
  configurable: true,
  value: {report: () => {}},
});
try { __velarRequireList(["one"], "Probe values"); console.log("accepted"); }
catch (error) { console.log(error.name + ": " + error.message); }
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "one,two",
    "TypeError: VelarScript reactive runtime schema 0.11 does not match this module's schema 0.12; one build mixed two generations of @velarscript/* — run 'npm ls @velarscript/compiler' and pin one version",
    "TypeError: VelarScript reactive runtime schema (unknown) does not match this module's schema 0.12; one build mixed two generations of @velarscript/* — run 'npm ls @velarscript/compiler' and pin one version",
    "",
  ].join("\n"), "an absent registry stays silent; every present generation names both schemas");
});
