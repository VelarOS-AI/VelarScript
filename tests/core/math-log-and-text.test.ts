import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { standardModuleWithDependencies } from "../support/standard-module-inline.ts";
import { executeModule } from "../support/execute-module.ts";
import { compile, standardModuleSource, emittedCollectionRuntime } from "../support/compiler-suite.ts";

test("velar/math never reintroduces JavaScript numeric coercion", () => {
  const source = standardModuleSource("velar/math") ?? "";
  const execution = executeModule(`${source}
console.log(gcd(54, 24), lcm(6, 8));
for (const operation of [
  () => min(1, "2"),
  () => clamp(1, "0", 2),
  () => pow(2, "3"),
  () => hypot([], 2),
  () => log(1, "2"),
  () => randomInt(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  () => gcd(2.5, 1),
  () => lcm(Number.MAX_SAFE_INTEGER, 2),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
const OriginalTypeError = TypeError;
Math.random = () => 1;
Math.min = () => 99;
Math.max = () => 99;
Math.floor = () => 99;
Math.abs = () => 99;
Number.isFinite = () => false;
Number.isInteger = () => false;
Number.isSafeInteger = () => false;
globalThis.TypeError = class PoisonTypeError extends Error {};
globalThis.RangeError = class PoisonRangeError extends Error {};
const sample = random();
const integer = randomInt(10);
console.log(min(4, 2), max(4, 2), clamp(3, 1, 2), gcd(54, 24), lcm(6, 8), sample >= 0 && sample < 1, integer >= 0 && integer < 10);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "6 24",
    "TypeError", "TypeError", "TypeError", "TypeError",
    "TypeError", "RangeError", "TypeError", "RangeError",
    "2 4 2 6 24 true true", "",
  ].join("\n"));

  for (const [replacement, expected] of [["1", "RangeError"], ['"0.5"', "TypeError"]]) {
    const invalidHost = executeModule(`Math.random = () => ${replacement};
${source}
try { random(); console.log("accepted"); } catch (error) { console.log(error.name); }
`);
    assert.equal(invalidHost.status, 0, String(invalidHost.stderr));
    assert.equal(invalidHost.stdout, `${expected}\n`);
  }
});

test("velar/log validates dynamic inputs and isolates sink snapshots", () => {
  const source = standardModuleSource("velar/log") ?? "";
  const execution = executeModule(`const originalHostConsoleDescriptor = Object.getOwnPropertyDescriptor(globalThis, "console");
const fallbackFailures = [];
Object.defineProperty(globalThis, "console", { ...originalHostConsoleDescriptor, value: {
  debug() {}, info() {}, warn() {}, log() {},
  error(message, fields, error) { fallbackFailures.push(message + ":" + error.message); },
} });
${source}
Object.defineProperty(globalThis, "console", originalHostConsoleDescriptor);
import { runInNewContext } from "node:vm";
const seen = [];
const stopFirst = useSink(record => {
  seen.push("first:" + record.message + ":" + record.fields.get("source"));
  record.fields.set("source", "mutated");
});
const stopSecond = useSink(record => seen.push("second:" + record.message + ":" + record.fields.get("source")));
const foreignFields = runInNewContext('class HostileMap extends Map { get size() { throw new Error("size override") } entries() { throw new Error("entries override") } }; new HostileMap([["source", "runtime"]])');
logger("foreign", foreignFields).info("cross-realm");
logger("build", new Map([["source", "compiler"]])).info("ready");
stopFirst(); stopFirst(); stopSecond();
console.log(seen.join("|"));
const stopHostile = useSink(() => { throw { toString() { fallbackFailures.push("conversion hook ran"); throw Error("conversion failure"); } }; });
log.info("hostile");
stopHostile();
console.log(fallbackFailures.join("|"));
setLevel("DEBUG");
console.log(level());
for (const operation of [
  () => logger(42),
  () => logger("build", new Map([[1, "value"]])),
  () => setLevel(1),
  () => log.info(42),
  () => log.debug("message", new Map([[1, "value"]])),
  () => log.error("failed", "not an error"),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
const originalLogDateNow = Date.now;
let sinkThenReads = 0;
const stopThenable = useSink(() => Object.defineProperty({}, "then", { get() { sinkThenReads += 1; return () => null; } }));
log.info("non-promise sink result");
stopThenable();
console.log(sinkThenReads);
Date.now = () => NaN;
try { log.info("invalid clock"); console.log("accepted"); } catch (error) { console.log(error.name); }
Date.now = originalLogDateNow;
const originalConsoleDescriptor = Object.getOwnPropertyDescriptor(globalThis, "console");
const hostileConsole = {};
let consoleGetterReads = 0;
Object.defineProperty(hostileConsole, "info", { get() { consoleGetterReads += 1; return () => null; } });
Object.defineProperty(globalThis, "console", { ...originalConsoleDescriptor, value: hostileConsole });
let consoleBoundaryFailure = "accepted";
try { log.info("invalid console"); } catch (error) { consoleBoundaryFailure = error.name; }
Object.defineProperty(globalThis, "console", originalConsoleDescriptor);
console.log(consoleBoundaryFailure + ":" + consoleGetterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "first:cross-realm:runtime|second:cross-realm:runtime|first:ready:compiler|second:ready:compiler",
    "[velar/log] Log sink failed:A non-Error value was thrown by JavaScript",
    "debug",
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "0",
    "accepted", "accepted:0", "",
  ].join("\n"));
});

test("velar/log captures its host operations when the module initializes", () => {
const source = standardModuleSource("velar/log") ?? "";
  const execution = executeModule(`${source}
const records = [];
const stop = useSink(record => records.push(record));
const stableFields = new Map([["source", "captured"]]);
const original = {
  dateNow: Date.now,
  freeze: Object.freeze,
  create: Object.create,
  defineProperty: Object.defineProperty,
  finite: Number.isFinite,
  abs: Math.abs,
  trim: String.prototype.trim,
  lower: String.prototype.toLowerCase,
  mapEntries: Map.prototype.entries,
  mapGet: Map.prototype.get,
  mapHas: Map.prototype.has,
  mapSet: Map.prototype.set,
  setValues: Set.prototype.values,
  setHas: Set.prototype.has,
  setAdd: Set.prototype.add,
  setDelete: Set.prototype.delete,
  promiseThen: Promise.prototype.then,
};
Date.now = () => NaN;
Object.freeze = () => { throw new Error("poisoned freeze"); };
Object.create = () => { throw new Error("poisoned create"); };
Object.defineProperty = () => { throw new Error("poisoned defineProperty"); };
Number.isFinite = () => false;
Math.abs = () => Number.POSITIVE_INFINITY;
String.prototype.trim = () => { throw new Error("poisoned trim"); };
String.prototype.toLowerCase = () => { throw new Error("poisoned lower"); };
Map.prototype.entries = () => { throw new Error("poisoned entries"); };
Map.prototype.get = () => { throw new Error("poisoned get"); };
Map.prototype.has = () => { throw new Error("poisoned has"); };
Map.prototype.set = () => { throw new Error("poisoned set"); };
Set.prototype.values = () => { throw new Error("poisoned values"); };
Set.prototype.has = () => { throw new Error("poisoned has"); };
Set.prototype.add = () => { throw new Error("poisoned add"); };
Set.prototype.delete = () => { throw new Error("poisoned delete"); };
Promise.prototype.then = () => { throw new Error("poisoned then"); };
setLevel("INFO");
logger(" stable ", stableFields).info("ready");
stop();
Date.now = original.dateNow;
Object.freeze = original.freeze;
Object.create = original.create;
Object.defineProperty = original.defineProperty;
Number.isFinite = original.finite;
Math.abs = original.abs;
String.prototype.trim = original.trim;
String.prototype.toLowerCase = original.lower;
Map.prototype.entries = original.mapEntries;
Map.prototype.get = original.mapGet;
Map.prototype.has = original.mapHas;
Map.prototype.set = original.mapSet;
Set.prototype.values = original.setValues;
Set.prototype.has = original.setHas;
Set.prototype.add = original.setAdd;
Set.prototype.delete = original.setDelete;
Promise.prototype.then = original.promiseThen;
console.log(records[0].scope + ":" + records[0].message + ":" + records[0].fields.get("source"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "stable:ready:captured\n");
});

test("text methods and velar/text reject native count coercion and accessor options", () => {
  const source = standardModuleSource("velar/text") ?? "";
  const execution = executeModule(`${source}
console.log(__velarStringPadStart("7", 3, "0"));
console.log(truncate("VelarScript", 6));
console.log(chunks("A😀B", 1).join("|"));
let getterReads = 0;
const options = {};
Object.defineProperty(options, "ignoreCase", { enumerable: true, get() { getterReads += 1; return true; } });
for (const operation of [
  () => __velarStringRepeat("x", "2"),
  () => __velarStringPadStart("x", "3"),
  () => __velarStringPadEnd("x", -1),
  () => __velarStringIndex("x", "x", 0.5),
  () => truncate("x", Number.MAX_SAFE_INTEGER + 1),
  () => chunks("x", 0),
  () => chunks("x", "1"),
  () => matches("Velar", "velar", options),
  () => matches("Velar", "velar", new (class PatternOptions { constructor() { this.ignoreCase = true; } })()),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(getterReads);
let optionReads = 0;
const proxyOptions = new Proxy({ ignoreCase: true }, { get(target, key) { optionReads += 1; return Reflect.get(target, key); } });
console.log(matches("VELAR", "velar", proxyOptions), optionReads);
const originalIndexOf = String.prototype.indexOf;
let ambientIndexCalls = 0;
String.prototype.indexOf = () => { ambientIndexCalls += 1; throw new Error("poisoned indexOf"); };
console.log(__velarStringIndex("A😀B", "B"), __velarStringIndex("😀", "\\uDE00"), ambientIndexCalls);
String.prototype.indexOf = originalIndexOf;
console.log(findMatches("💙", "").map(match => match.index).join(","));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "007", "Velar…", "A|😀|B",
    "RangeError", "RangeError", "RangeError", "TypeError", "RangeError", "RangeError", "RangeError", "TypeError", "TypeError", "0",
    "true 0", "2 null 0", "0,1", "",
  ].join("\n"));
});

test("String methods and velar/text capture their complete host ABI at initialization", () => {
  const source = standardModuleSource("velar/text") ?? "";
  const execution = executeModule(`${source}
const OriginalTypeError = TypeError;
const OriginalRangeError = RangeError;
const originalDefineProperty = Object.defineProperty;
const nativeIsFrozen = Object.isFrozen;
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new OriginalTypeError("poisoned text host"); };
for (const [owner, name] of [
  [Array, "isArray"], [Array.prototype, "join"],
  [String.prototype, "indexOf"], [String.prototype, "slice"], [String.prototype, "charCodeAt"],
  [String.prototype, "trim"], [String.prototype, "trimStart"], [String.prototype, "trimEnd"],
  [String.prototype, "toUpperCase"], [String.prototype, "toLowerCase"], [String.prototype, "split"],
  [String.prototype, "replace"], [String.prototype, "replaceAll"], [String.prototype, "repeat"],
  [String.prototype, "normalize"], [Number, "isSafeInteger"], [Number, "isInteger"],
  [Math, "floor"], [Math, "max"], [Math, "min"], [RegExp.prototype, "exec"],
  [Object, "getOwnPropertyDescriptor"], [Object, "getOwnPropertyNames"],
  [Object, "getOwnPropertySymbols"], [Object, "getPrototypeOf"], [Object, "create"], [Object, "freeze"],
  [Reflect, "apply"],
]) originalDefineProperty(owner, name, { configurable: true, writable: true, value: poison });
originalDefineProperty(Array.prototype, Symbol.iterator, { configurable: true, writable: true, value: poison });
originalDefineProperty(String.prototype, Symbol.iterator, { configurable: true, writable: true, value: poison });
globalThis.Array = class PoisonedArray {};
globalThis.String = class PoisonedString {};
globalThis.Number = class PoisonedNumber {};
globalThis.Object = class PoisonedObject {};
globalThis.RegExp = class PoisonedRegExp {};
globalThis.TypeError = class PoisonedTypeError extends OriginalTypeError {};
globalThis.RangeError = class PoisonedRangeError extends OriginalRangeError {};

console.log(__velarStringSize("A😀B"), __velarStringUpper("ab"), __velarStringLower("AB"));
console.log(__velarStringSlice("A😀B", 1, 2), __velarStringChar("A😀B", -1), __velarStringHas("abc", "b"), __velarStringIndex("A😀B", "B"), __velarStringCount("aaaa", "aa"));
console.log(__velarStringStartsWith("abc", "a"), __velarStringEndsWith("abc", "c"), __velarStringSplit("A😀B", "").length, __velarStringReplace("aba", "a", "$&"), __velarStringReplaceAll("aba", "a", "$&"));
console.log(__velarStringPadStart("7", 3, "0"), __velarStringPadEnd("7", 3, "😀"), __velarStringRepeat("ab", 2));
console.log(trimStart("  x"), trimEnd("x  "), capitalize("élan"), title("hello_world/foo-bar"));
const rowList = lines("a\\r\\nb\\n");
const wordList = words("  one   two ");
console.log(rowList.length, rowList[0], rowList[1], rowList[2] === "", wordList.length, wordList[0], wordList[1]);
const starts = lineStarts("A😀\\nB\\n");
console.log(starts.length, starts[0], starts[1], starts[2]);
const chunked = chunks("A😀游戏B", 2);
console.log(chunked.length, chunked[0], chunked[1], chunked[2]);
console.log(slug("Crème brûlée!"), truncate("A😀B", 2));
console.log(indent("a\\nb", "-") === "-a\\n-b", dedent("  a\\n    b") === "a\\n  b");
console.log(normalizeWhitespace("  a\\n b  "), escapeHtml('<a href="x">'));
console.log(utf8Size("A😀游戏"), utf8Size("\\uD800"));
console.log(matches("VELAR", "velar", {ignoreCase: true}));
const one = findMatch("A😀B", "B");
const many = findMatches("💙", "");
console.log(one.value, one.index, nativeIsFrozen(one), many.length, many[0].index, many[1].index);
console.log(replaceMatches("a1b2", "\\\\d", "x"));
const pieces = splitPattern("a1b2", "\\\\d");
console.log(pieces.length, pieces[0], pieces[1], pieces[2] === "");
let typeIdentity = false, rangeIdentity = false;
try { matches("x", 1); } catch (error) { typeIdentity = error instanceof OriginalTypeError; }
try { truncate("x", -1); } catch (error) { rangeIdentity = error instanceof OriginalRangeError; }
console.log(typeIdentity, rangeIdentity, poisonCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "3 AB ab",
    "😀 B true 2 2",
    "true true 3 $&ba $&b$&",
    "007 7😀😀 abab",
    "x x Élan Hello World Foo Bar",
    "3 a b true 2 one two",
    "3 0 3 5",
    "3 A😀 游戏 B",
    "creme-brulee A…",
    "true true",
    "a b &lt;a href=&quot;x&quot;&gt;",
    "11 3",
    "true",
    "B 2 true 2 0 1",
    "axbx",
    "3 a b true",
    "true true 0",
    "",
  ].join("\n"));
});

test("Number methods capture their complete host ABI at initialization", () => {
  const result = compile(`
def numberProbe(value: number) -> string:
    return f"{value.abs()}|{value.round()}|{value.floor()}|{value.ceil()}|{value.sign()}|{value.trunc()}|{value.toFixed(2)}"
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
const OriginalTypeError = TypeError;
const OriginalRangeError = RangeError;
const originalDefineProperty = Object.defineProperty;
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new OriginalTypeError("poisoned number host"); };
for (const [owner, name] of [
  [Math, "abs"], [Math, "round"], [Math, "floor"], [Math, "ceil"], [Math, "sign"], [Math, "trunc"],
  [Number, "isSafeInteger"], [Number.prototype, "toFixed"],
  [Object, "getOwnPropertyDescriptor"], [Reflect, "apply"],
]) originalDefineProperty(owner, name, { configurable: true, writable: true, value: poison });
globalThis.Math = {};
globalThis.Number = class PoisonedNumber {};
globalThis.Object = class PoisonedObject {};
globalThis.TypeError = class PoisonedTypeError extends OriginalTypeError {};
globalThis.RangeError = class PoisonedRangeError extends OriginalRangeError {};

console.log(numberProbe(1.6));
let typeIdentity = false, rangeIdentity = false;
try { __velarNumberAbs("1"); } catch (error) { typeIdentity = error instanceof OriginalTypeError; }
try { __velarNumberToFixed(1, 101); } catch (error) { rangeIdentity = error instanceof OriginalRangeError; }
console.log(typeIdentity, rangeIdentity, poisonCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1.6|2|1|2|1|1|1.60\ntrue true 0\n");
});

test("standard modules bound pathological allocation and timer inputs before effects", () => {
  const collectionExecution = executeModule(`${emittedCollectionRuntime()}
const oversized = []; oversized.length = 1000001;
const originalJoin = Array.prototype.join;
let nativeJoinCalls = 0;
Array.prototype.join = () => { nativeJoinCalls += 1; throw new Error("late join allocation"); };
for (const operation of [
  () => __velarListRepeat(["item"], 1000001),
  () => __velarListSum(oversized),
  () => __velarListJoin(["x".repeat(8 * 1024 * 1024), "x".repeat(8 * 1024 * 1024 + 1)]),
  () => __velarListJoin(["left", "right"], "x".repeat(16 * 1024 * 1024)),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(__velarListJoin(["x".repeat(8 * 1024 * 1024), "x".repeat(8 * 1024 * 1024)]).length);
console.log(__velarListJoin(["only"], "x".repeat(16 * 1024 * 1024 + 1)));
console.log(nativeJoinCalls);
Array.prototype.join = originalJoin;
`);
  assert.equal(collectionExecution.status, 0, String(collectionExecution.stderr));
  // The oversized sparse array fails the member's dense-List proof, which is a
  // TypeError, before its length is ever compared with the item ceiling.
  assert.equal(collectionExecution.stdout, "RangeError\nTypeError\nRangeError\nRangeError\n16777216\nonly\n0\n");

  const text = standardModuleSource("velar/text") ?? "";
  const textExecution = executeModule(`${text}
const originalReplace = String.prototype.replace;
const originalReplaceAll = String.prototype.replaceAll;
let replacementCalls = 0;
String.prototype.replace = () => { replacementCalls += 1; throw new Error("late replacement allocation"); };
String.prototype.replaceAll = () => { replacementCalls += 1; throw new Error("late replacement allocation"); };
for (const operation of [
  () => __velarStringRepeat("ab", 9000000),
  () => __velarStringPadStart("x", 20000000),
  () => __velarStringSplit("x".repeat(1000001), ""),
  () => indent("a\\nb", "x".repeat(9 * 1024 * 1024)),
  () => __velarStringReplace("xx", "x", "y".repeat(16 * 1024 * 1024)),
  () => __velarStringReplaceAll("xx", "x", "y".repeat(9 * 1024 * 1024)),
  () => escapeHtml("&".repeat(4 * 1024 * 1024)),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(__velarStringReplace("abc", "b", "x"));
console.log(__velarStringReplaceAll("aaa", "aa", "x"));
console.log(__velarStringReplaceAll("ab", "", "-"));
console.log(escapeHtml('<a href="x">'));
console.log(replacementCalls);
String.prototype.replace = originalReplace;
String.prototype.replaceAll = originalReplaceAll;
`);
  assert.equal(textExecution.status, 0, String(textExecution.stderr));
  assert.equal(textExecution.stdout, "RangeError\nRangeError\nRangeError\nRangeError\nRangeError\nRangeError\nRangeError\naxc\nxa\n-a-b-\n&lt;a href=&quot;x&quot;&gt;\n0\n");

  const json = standardModuleSource("velar/json") ?? "";
  const jsonExecution = executeModule(`${json}
let nested = {};
for (let index = 0; index < 129; index += 1) nested = { next: nested };
let getterReads = 0;
const accessorList = [];
Object.defineProperty(accessorList, 0, { enumerable: true, get() { getterReads += 1; return 1; } });
accessorList.length = 1;
for (const operation of [() => stringify(nested), () => stringify("\\u0000".repeat(3000000)), () => stringify(accessorList)]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(getterReads);
`);
  assert.equal(jsonExecution.status, 0, String(jsonExecution.stderr));
  assert.equal(jsonExecution.stdout, "TypeError\nTypeError\nTypeError\n0\n");

  const url = standardModuleSource("velar/url") ?? "";
  const urlExecution = executeModule(`${url}
let getterReads = 0;
let encodeCalls = 0;
const accessor = Object.defineProperty({}, "page", { enumerable: true, get() { getterReads += 1; return 1; } });
globalThis.encodeURIComponent = () => { encodeCalls += 1; throw new Error("late encoding allocation"); };
for (const operation of [
  () => query(accessor),
  () => query(new Map([["value", "x".repeat(300000)]])),
  () => encode(" ".repeat(700000)),
  () => join("x".repeat(2 * 1024 * 1024), "tail"),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(getterReads);
console.log(encode("Velar Script"));
console.log(encodeCalls);
`);
  assert.equal(urlExecution.status, 0, String(urlExecution.stderr));
  assert.equal(urlExecution.stdout, "TypeError\nRangeError\nRangeError\nRangeError\n0\nVelar%20Script\n0\n");

  const tinyUrl = url.replace("const maxUrlCodeUnits = 2 * 1024 * 1024;", "const maxUrlCodeUnits = 16;");
  const tinyUrlExecution = executeModule(`${tinyUrl}
const NativeUrl = globalThis.URL;
globalThis.URL = class {
  constructor() { this.href = "x:/"; this.protocol = "x:"; this.host = "host"; this.hostname = "host"; this.port = ""; this.pathname = "/123456789"; this.search = "?123456789"; this.hash = "#123456789"; this.origin = "null"; }
};
try { normalize("/"); console.log("accepted"); } catch (error) { console.log(error.name); }
globalThis.URL = NativeUrl;
`);
  assert.equal(tinyUrlExecution.status, 0, String(tinyUrlExecution.stderr));
  assert.equal(tinyUrlExecution.stdout, "RangeError\n");

  const asyncModule = standardModuleWithDependencies(standardModuleSource("velar/async") ?? "");
  const asyncExecution = executeModule(`${asyncModule}
const operations = new Array(10001).fill(Promise.resolve(null));
for (const operation of [() => all(operations), () => race(operations), () => timeout(Promise.resolve(null), "1ms", "x".repeat(65537))]) {
  try { await operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(asyncExecution.status, 0, String(asyncExecution.stderr));
  assert.equal(asyncExecution.stdout, "RangeError\nRangeError\nRangeError\n");

  const browser = standardModuleSource("velar/browser") ?? "";
  const browserExecution = executeModule(`let timerCalls = 0;
globalThis.setTimeout = () => { timerCalls += 1; return 1; };
${browser}
try { after("2147483648ms", () => null); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(timerCalls);
`);
  assert.equal(browserExecution.status, 0, String(browserExecution.stderr));
  assert.equal(browserExecution.stdout, "RangeError\n0\n");

  const http = standardModuleSource("velar/http") ?? "";
  const httpExecution = executeModule(`let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; return new Response("{}"); };
${http}
for (const operation of [
  () => http.get("/", { timeout: 2147483648 }),
  () => http.get("/", { headers: new Map([["x-large", "x".repeat(65537)]]) }),
  () => http.get("/", { maxBytes: 64 * 1024 * 1024 + 1 }),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(fetchCalls);
`);
  assert.equal(httpExecution.status, 0, String(httpExecution.stderr));
  assert.equal(httpExecution.stdout, "RangeError\nRangeError\nRangeError\n0\n");
});

test("logging, error handlers, time, and IDs keep bounded service inputs", () => {
  const logging = standardModuleSource("velar/log") ?? "";
  const loggingExecution = executeModule(`${logging}
let iteratorCalls = 0;
class HostileMap extends Map { entries() { iteratorCalls += 1; return super.entries(); } [Symbol.iterator]() { iteratorCalls += 1; return super[Symbol.iterator](); } }
const records = [];
const stop = useSink(record => records.push(record));
logger("app", new HostileMap([["ready", true]])).info("started");
stop();
const oversizedFields = new Map();
for (let index = 0; index <= 1000; index += 1) oversizedFields.set("field" + index, index);
for (const operation of [
  () => logger("x".repeat(1025)),
  () => log.info("x".repeat(65537)),
  () => logger("app", oversizedFields),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(records.length + ":" + iteratorCalls);
`);
  assert.equal(loggingExecution.status, 0, String(loggingExecution.stderr));
  assert.equal(loggingExecution.stdout, "RangeError\nRangeError\nRangeError\n1:0\n");

  const app = standardModuleSource("velar/app") ?? "";
  const appExecution = executeModule(`${app}
const stops = [];
for (let index = 0; index < 1000; index += 1) stops.push(onError(() => null));
for (const operation of [
  () => onError(() => null),
  () => reportError(new Error("failure"), "x".repeat(257)),
  () => reportError(new Error("failure"), "manual", "x".repeat(65537)),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
for (const stop of stops) stop();
`);
  assert.equal(appExecution.status, 0, String(appExecution.stderr));
  assert.equal(appExecution.stdout, "RangeError\nRangeError\nRangeError\n");

  const time = standardModuleSource("velar/time") ?? "";
  const id = standardModuleSource("velar/id") ?? "";
  const scalarExecution = executeModule(`${time}\n${id}
console.log(parse("x".repeat(100000)) === null);
console.log(isUuid("x".repeat(100000)));
try { format(0, "x".repeat(1025)); console.log("accepted"); } catch (error) { console.log(error.name); }
`);
  assert.equal(scalarExecution.status, 0, String(scalarExecution.stderr));
  assert.equal(scalarExecution.stdout, "true\nfalse\nRangeError\n");
});
