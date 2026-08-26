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
import { VELAR_REACTIVE_BRIDGE_RUNTIME } from "../packages/web/src/reactive-bridge-runtime.ts";
// Core's rosters, not the CLI facade's: this test exists to recompute the
// numbers the gate prints, and the gate reads Core (its neighbouring checks —
// "Core must not own the target-specific velar/websocket surface" — depend on
// `standardModuleInterfaces()` meaning Core alone). The two differ by one:
// under the facade `velar/serve` carries a Node source and a Desktop source.
// Reading one roster from two places is what let that difference hide.
import { standardModuleInterfaces, standardModuleSources } from "../packages/core/src/index.ts";
import { velarCompilerExtension as velarDesktopCompilerExtension } from "../packages/desktop/src/compiler.ts";
import { velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";
import { velarCompilerExtension as velarServerCompilerExtension } from "../packages/server/src/compiler.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import { esModuleExports } from "../scripts/es-module-exports.mjs";

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
  assert.doesNotMatch(core.code ?? "", new RegExp(escapeRegex(JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)), "u"));
  assert.match(core.code ?? "", /const __velarReactiveIterateKey = null;/u);
  assert.match(core.code ?? "", /function __velarHostRaw\(value\) \{ return value; \}/u);

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
  // D90 fr-7: the schema comparison now runs ahead of the ownership and roster
  // checks and names both generations, because a schema bump usually moves the
  // roster too and "fields are invalid" named neither.
  assert.match(String(execution.stderr), /VelarScript Web runtime schema incompatible does not match this module's schema 0\.12/u);
  assert.match(String(execution.stderr), /npm ls @velarscript\/compiler/u);
});

test("the Web registry raw bridge retries a missing runtime and caches a valid immutable provider", () => {
  const execution = executeModule(`
${VELAR_REACTIVE_BRIDGE_RUNTIME}
function cross(value) { return __velarHostRaw(value); }
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

test("the Web registry raw bridge rejects accessor-backed runtime operations without invoking them", () => {
  const execution = executeModule(`
${VELAR_REACTIVE_BRIDGE_RUNTIME}
let reads = 0;
const runtime = Object.create(null);
Object.defineProperty(runtime, "version", { value: ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)}, enumerable: false, configurable: false, writable: false });
Object.defineProperty(runtime, "toRaw", { get() { reads += 1; return value => value; }, enumerable: false, configurable: false });
Object.preventExtensions(runtime);
Object.defineProperty(globalThis, Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)}), {
  value: runtime, enumerable: false, configurable: false, writable: false,
});
try { __velarHostRaw({}); }
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
// D90 fr-6: registry membership is no longer sufficient on its own -- a value
// must still present the Type surface its caller is about to invoke -- so these
// fixtures answer 'is' and 'parse' the way every registered Type does.
const surface = { is: () => true, parse: (value) => value };
const known = __velarRegisterRuntimeType(Object.freeze({ name: "known", ...surface }));
const later = Object.freeze({ name: "later", ...surface });
const forged = Object.freeze({ name: "forged", ...surface });
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

test("the boundary gate reads a runtime module's exports as syntax, not as two patterns", () => {
  // D57 rule 140 is enforced by comparing what a runtime module publishes
  // against what its interface declares, and what it publishes used to be found
  // with `^export (async )?(function|const|let|class) NAME` and `^export {...}`.
  // Every form below is a name those two patterns never saw, so a runtime that
  // used any of them published names the gate reported as absent. Compiled
  // sources are generated, which is exactly why this is a defect and not a
  // style note: `export function*` is already this repository's own spelling in
  // `packages/compiler/src/ast.ts`, and nothing stops an emitter reaching for
  // it or for `export var`.
  for (const [source, expected] of [
    ["export var counter = 0;", ["counter"]],
    ["export function* walk() { yield 1; }", ["walk"]],
    ["export async function* stream() { yield 1; }", ["stream"]],
    ["export const {alpha, beta: renamed, ...rest} = host;", ["alpha", "renamed", "rest"]],
    ["export const [first, , third = 2, ...tail] = host;", ["first", "third", "tail"]],
    ["  export const indented = 1;", ["indented"]],
    ["\texport const tabbed = 1;", ["tabbed"]],
    ["export let first = 1, second = 2;", ["first", "second"]],
    ["export default function () {}", ["default"]],
    ["export * as everything from \"./other.js\";", ["everything"]],
    ["export const outer = 1;\nfunction hide() { const inner = 2; return inner; }", ["outer"]],
    ["export {local as published, plain};", ["published", "plain"]],
    ["export {renamed as \"quoted name\"};", ["quoted name"]],
  ] as const) {
    const { names, unreadable } = esModuleExports(source);
    assert.deepEqual(unreadable, [], source);
    assert.deepEqual(names, [...expected], source);
  }

  // A name that only looks like an export publishes nothing.
  for (const source of [
    "const host = {export: 1};\nconst read = host.export;",
    "// export const commented = 1;",
    "const text = \"export const inString = 1\";",
    "const pattern = /export const inRegex = 1/u;",
    "const filled = `export const ${\"inTemplate\"} = 1`;",
    "function body() { return 1; }",
  ]) {
    assert.deepEqual(esModuleExports(source).names, [], source);
  }

  // And a form outside the scanner's boundary is named, never skipped: a silent
  // skip is what made the two patterns look like coverage in the first place.
  for (const source of ["export * from \"./other.js\";", "export const unterminated = 1", "export interface Shape {}"]) {
    assert.notEqual(esModuleExports(source).unreadable.length, 0, source);
  }
});

test("the boundary gate reports no number it cannot support", () => {
  // The summary used to open with `Checked ${ids.size} runtime boundary
  // operations`, counting rows of the Markdown table in
  // `docs/contributing/runtime-boundary.md` — a count connected to no check in
  // that gate, which rose by one for every row appended. Pinned here is that
  // every number the gate prints is a number this test can recompute: an
  // unsupported count cannot be re-introduced without failing.
  const surfaces = new Map<string, Set<string>>();
  let publicSurfaces = 0;
  let internalSurfaces = 0;
  for (const extensions of [[], [velarCompilerExtension], [velarNodeCompilerExtension], [velarServerCompilerExtension], [velarDesktopCompilerExtension]]) {
    const interfaces = standardModuleInterfaces(extensions);
    for (const [name, source] of standardModuleSources(extensions)) {
      const seen = surfaces.get(name) ?? new Set<string>();
      if (seen.has(source)) continue;
      seen.add(source);
      surfaces.set(name, seen);
      if (interfaces.has(name)) publicSurfaces += 1;
      else internalSurfaces += 1;
    }
  }
  const gate = spawnSync(process.execPath, ["scripts/check-runtime-boundary.mjs"], { encoding: "utf8" });
  assert.equal(gate.status, 0, `${gate.stdout}\n${gate.stderr}`);
  const reported = String(gate.stdout).match(/\d+/gu) ?? [];
  assert.deepEqual(reported, [String(publicSurfaces), String(internalSurfaces)], gate.stdout);

  // Every internal runtime module is accounted for rather than skipped. Ten of
  // them used to fall through a `continue` that said nothing, so a tenth of the
  // module sources that loop walks passed without being looked at.
  assert.notEqual(internalSurfaces, 0);
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
