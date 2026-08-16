import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import {
  VELAR_RUNTIME_REGISTRY_KEY,
  VELAR_RUNTIME_SCHEMA_VERSION,
  VELAR_TYPE_REGISTRY_KEY,
  VELAR_TYPE_REGISTRY_RUNTIME,
  VELAR_UTF8_RUNTIME,
} from "@velarscript/compiler/extension";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

function executeModule(source: string) {
  // Passing generated programs through `--eval` is bounded by the host's
  // command-line size (notably Linux ARG_MAX). stdin is the portable module
  // source boundary and keeps this test about the runtime ABI it owns.
  return spawnSync(process.execPath, ["--input-type=module"], {
    input: source,
    encoding: "utf8",
  });
}

test("compiler-owned UTF-8 sizing matches transport encoding semantics", () => {
  const runtime = new Function(`${VELAR_UTF8_RUNTIME}\nreturn { byteLength: __velarUtf8ByteLength, declaredLength: __velarDeclaredLength };`)() as {
    byteLength(value: string): number;
    declaredLength(value: unknown): number | null;
  };
  const { byteLength, declaredLength } = runtime;
  for (const value of ["", "ascii", "é", "汉字", "😀", "a😀汉é", "\uD800", "\uDC00", "\uD800x", "x\uDC00"]) {
    assert.equal(byteLength(value), Buffer.byteLength(value, "utf8"), JSON.stringify(value));
  }
  const originalCharCodeAt = String.prototype.charCodeAt;
  const originalApply = Reflect.apply;
  let poisonedResult = -1;
  try {
    Object.defineProperty(String.prototype, "charCodeAt", { configurable: true, writable: true, value: () => 0 });
    Object.defineProperty(Reflect, "apply", { configurable: true, writable: true, value: () => 0 });
    poisonedResult = byteLength("é😀");
  } finally {
    Object.defineProperty(String.prototype, "charCodeAt", { configurable: true, writable: true, value: originalCharCodeAt });
    Object.defineProperty(Reflect, "apply", { configurable: true, writable: true, value: originalApply });
  }
  assert.equal(poisonedResult, 6);
  assert.deepEqual(
    ["0", "0004", "67108864", "", " 4", "4x"].map(declaredLength),
    [0, 4, 67108864, null, null, null],
  );
  assert.equal(declaredLength("9".repeat(100)), Number.POSITIVE_INFINITY);
  let poisonedDeclaredLength = -1;
  try {
    Object.defineProperty(String.prototype, "charCodeAt", { configurable: true, writable: true, value: () => 0 });
    Object.defineProperty(Reflect, "apply", { configurable: true, writable: true, value: () => 0 });
    poisonedDeclaredLength = declaredLength("100") ?? -1;
  } finally {
    Object.defineProperty(String.prototype, "charCodeAt", { configurable: true, writable: true, value: originalCharCodeAt });
    Object.defineProperty(Reflect, "apply", { configurable: true, writable: true, value: originalApply });
  }
  assert.equal(poisonedDeclaredLength, 100);
  assert.throws(() => byteLength(42 as unknown as string), /requires text/u);
});

test("generated Core and Web code consume the compiler-owned runtime ABI", () => {
  const core = compileCore("const values = [1]\nvalues.append(2)\n");
  assert.deepEqual(core.diagnostics, []);
  assert.match(core.code ?? "", new RegExp(`__velarReactiveBridgeSymbolFor\\(${escapeRegex(JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY))}\\)`, "u"));
  assert.match(core.code ?? "", new RegExp(`version !== ${escapeRegex(JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION))}`, "u"));

  const web = compileCore("component App:\n    return <main>Ready</main>\n", { extensions: [velarCompilerExtension] });
  assert.deepEqual(web.diagnostics, []);
  assert.match(web.code ?? "", new RegExp(`Symbol\\.for\\(${escapeRegex(JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY))}\\)`, "u"));
  assert.match(web.code ?? "", new RegExp(`version: ${escapeRegex(JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION))}`, "u"));
});

test("Desktop capability worker independently enforces shared HTTP response metadata", () => {
  const source = readFileSync("packages/desktop/native/node/worker.js", "utf8");
  assert.doesNotMatch(source, /status !== 0/u);
  assert.match(source, /status < 100 \|\| status > 599/u);
  assert.match(source, /ok !== \(status >= 200 && status <= 299\)/u);
});

test("an incompatible pre-existing runtime registry fails closed", () => {
  const web = compileCore("component App:\n    return <main>Ready</main>\n", { extensions: [velarCompilerExtension] });
  assert.deepEqual(web.diagnostics, []);
  const execution = executeModule(`
Object.defineProperty(globalThis, Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)}), {
  value: Object.freeze({ version: "incompatible" }),
  enumerable: false,
  configurable: false,
  writable: false,
});
${web.code ?? ""}
`);
  assert.notEqual(execution.status, 0);
  assert.match(String(execution.stderr), /VelarScript Web runtime (?:ownership|values) is invalid/u);
});

test("the JavaScript raw bridge retries a missing runtime and caches a valid immutable provider", () => {
  const identitySource = Buffer.from("export function identity(value){return value}", "utf8").toString("base64");
  const core = compileCore(`
import js unsafe {identity} from "data:text/javascript;base64,${identitySource}"

export def cross(value: unknown) -> unknown:
    return identity(value)
`.trimStart());
  assert.deepEqual(core.diagnostics, []);
  const execution = executeModule(`
${core.code ?? ""}
const plain = {};
const first = cross(plain) === plain;
const raw = {};
const proxy = {};
const runtime = Object.create(null);
const fields = {
  version: ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)},
  domQueue: new Set(), watchQueue: new Set(), flushPending: false, activeObserver: null,
  errorHandlers: new Set(), actionFailures: new WeakSet(), lookSources: new WeakMap(), classSources: new WeakMap(),
  dependencies: new WeakMap(), rawToProxy: new WeakMap(), proxyToRaw: new WeakMap(), versions: new WeakMap(), parents: new WeakMap(),
  toRaw: value => value === proxy ? raw : value,
  reactive: value => value, track() {}, trackDeep() {}, trigger() {}, versionOf() { return 0; },
  collectionRead(_value, _key, child) { return child; }, collectionTrigger() {}, collectionUnlink() {},
  report() {}, applyLook() {}, installLook() {},
};
for (const name of Object.keys(fields)) Object.defineProperty(runtime, name, {
  value: fields[name], enumerable: false, configurable: false,
  writable: name === "flushPending" || name === "activeObserver",
});
Object.preventExtensions(runtime);
Object.defineProperty(globalThis, Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)}), {
  value: runtime, enumerable: false, configurable: false, writable: false,
});
const second = cross(proxy) === raw;
const original = runtime.toRaw;
Object.defineProperty(globalThis.Object, "getOwnPropertyDescriptor", { value() { throw new Error("late ambient lookup"); } });
const third = cross(proxy) === raw && runtime.toRaw === original;
console.log(first + "|" + second + "|" + third);
`);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout.trim(), "true|true|true");
});

test("the JavaScript raw bridge rejects accessor-backed runtime operations without invoking them", () => {
  const identitySource = Buffer.from("export function identity(value){return value}", "utf8").toString("base64");
  const core = compileCore(`
import js unsafe {identity} from "data:text/javascript;base64,${identitySource}"
identity({})
`.trimStart());
  assert.deepEqual(core.diagnostics, []);
  const appUrl = `data:text/javascript;base64,${Buffer.from(core.code ?? "").toString("base64")}`;
  const execution = executeModule(`
let reads = 0;
const runtime = Object.create(null);
Object.defineProperty(runtime, "version", { value: ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)}, enumerable: false, configurable: false, writable: false });
Object.defineProperty(runtime, "toRaw", { get() { reads += 1; return value => value; }, enumerable: false, configurable: false });
Object.preventExtensions(runtime);
Object.defineProperty(globalThis, Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)}), {
  value: runtime, enumerable: false, configurable: false, writable: false,
});
try { await import(${JSON.stringify(appUrl)}); }
catch (error) { console.log(reads + "|" + error.message); }
`);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout.trim(), "0|VelarScript reactive runtime field 'toRaw' is invalid");
});

test("runtime Type registry identity is compiler-owned and fails closed without invoking hooks", () => {
  const core = compileCore(`
type User:
    name: string

const valid = User.parse({name: "Ada"})
`.trimStart());
  assert.deepEqual(core.diagnostics, []);
  assert.match(core.code ?? "", /const __velarTypeSymbolFor = globalThis\.Symbol\.for;/u);
  assert.match(core.code ?? "", new RegExp(escapeRegex(JSON.stringify(VELAR_TYPE_REGISTRY_KEY)), "u"));

  const accessor = executeModule(`
let reads = 0;
Object.defineProperty(globalThis, Symbol.for(${JSON.stringify(VELAR_TYPE_REGISTRY_KEY)}), {
  get() { reads += 1; return new WeakSet(); },
  enumerable: false,
  configurable: false,
});
try {
${core.code ?? ""}
} catch (error) {
  console.log(reads + "|" + error.message);
}
`);
  assert.equal(accessor.status, 0, accessor.stderr);
  assert.equal(accessor.stdout.trim(), "0|VelarScript runtime type registry descriptor is invalid");

  const mutable = executeModule(`
Object.defineProperty(globalThis, Symbol.for(${JSON.stringify(VELAR_TYPE_REGISTRY_KEY)}), {
  value: new WeakSet(),
  enumerable: false,
  configurable: true,
  writable: true,
});
try {
${core.code ?? ""}
} catch (error) {
  console.log(error.message);
}
`);
  assert.equal(mutable.status, 0, mutable.stderr);
  assert.equal(mutable.stdout.trim(), "VelarScript runtime type registry descriptor is invalid");

  const poisonedMethod = executeModule(`
const registry = new WeakSet();
let reads = 0;
Object.defineProperty(registry, "add", { get() { reads += 1; throw new Error("poisoned add"); } });
Object.defineProperty(globalThis, Symbol.for(${JSON.stringify(VELAR_TYPE_REGISTRY_KEY)}), {
  value: registry,
  enumerable: false,
  configurable: false,
  writable: false,
});
${core.code ?? ""}
console.log(reads);
`);
  assert.equal(poisonedMethod.status, 0, poisonedMethod.stderr);
  assert.equal(poisonedMethod.stdout.trim(), "0");

  const capturedHosts = executeModule(`
${VELAR_TYPE_REGISTRY_RUNTIME}
const NativeTypeError = TypeError;
const known = __velarRegisterRuntimeType(Object.freeze({ name: "known" }));
const later = Object.freeze({ name: "later" });
const forged = Object.freeze({ name: "forged" });
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new Error("poisoned host"); };
WeakSet.prototype.has = poison;
WeakSet.prototype.add = poison;
Object.getOwnPropertyDescriptor = poison;
Object.defineProperty = poison;
Reflect.apply = poison;
Symbol.for = poison;
globalThis.WeakSet = class PoisonedWeakSet {};
globalThis.Object = class PoisonedObject {};
globalThis.TypeError = class PoisonedTypeError extends Error {};
console.log(__velarRequireRuntimeType(known, "verify") === known);
console.log(__velarRequireRuntimeType(__velarRegisterRuntimeType(later), "verify") === later);
try { __velarRequireRuntimeType(forged, "verify"); }
catch (error) { console.log(error instanceof NativeTypeError, error.message); }
console.log(poisonCalls);
`);
  assert.equal(capturedHosts.status, 0, capturedHosts.stderr);
  assert.equal(capturedHosts.stdout, [
    "true",
    "true",
    "true verify requires a compiler-known VelarScript runtime type",
    "0",
    "",
  ].join("\n"));
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
