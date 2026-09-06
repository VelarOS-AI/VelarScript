const __velarTestNativeString = globalThis.String;
const __velarTestNativeNumber = globalThis.Number;
const __velarTestNativePromise = globalThis.Promise;
const __velarTestNativeJSON = globalThis.JSON;
const __velarTestNativeMath = globalThis.Math;
const __velarTestNativeError = globalThis.Error;
const __velarTestNativeTypeError = globalThis.TypeError;
const __velarTestNativeRangeError = globalThis.RangeError;
const __velarTestFreeze = __velarDeepGetOwnPropertyDescriptor(__velarDeepNativeObject, "freeze")?.value;
const __velarTestStringPrototype = __velarDeepGetOwnPropertyDescriptor(__velarTestNativeString, "prototype")?.value;
const __velarTestStringSlice = __velarDeepGetOwnPropertyDescriptor(__velarTestStringPrototype, "slice")?.value;
const __velarTestStringIncludes = __velarDeepGetOwnPropertyDescriptor(__velarTestStringPrototype, "includes")?.value;
const __velarTestArrayJoin = __velarDeepGetOwnPropertyDescriptor(__velarDeepArrayPrototype, "join")?.value;
const __velarTestNumberIsSafeInteger = __velarDeepGetOwnPropertyDescriptor(__velarTestNativeNumber, "isSafeInteger")?.value;
const __velarTestJsonStringify = __velarDeepGetOwnPropertyDescriptor(__velarTestNativeJSON, "stringify")?.value;
const __velarTestMathMin = __velarDeepGetOwnPropertyDescriptor(__velarTestNativeMath, "min")?.value;
const __velarTestPromisePrototype = __velarDeepGetOwnPropertyDescriptor(__velarTestNativePromise, "prototype")?.value;
const __velarTestPromiseThen = __velarDeepGetOwnPropertyDescriptor(__velarTestPromisePrototype, "then")?.value;
const __velarTestRegExpPrototype = __velarDeepGetPrototypeOf(/(?:)/u);
const __velarTestNativeRegExp = __velarDeepGetOwnPropertyDescriptor(__velarTestRegExpPrototype, "constructor")?.value;
const __velarTestRegExpExec = __velarDeepGetOwnPropertyDescriptor(__velarTestRegExpPrototype, "exec")?.value;
const __velarTestPatternPrefix = /^Invalid regular expression: (?:\/[\s\S]*\/[a-z]*: )?/u;
const __velarTestNativeDate = globalThis.Date;
const __velarTestDateNow = __velarDeepGetOwnPropertyDescriptor(__velarTestNativeDate, "now")?.value;
const maxTestPatternMillis = 250;
function __velarTestAppend(items, value) { items[items.length] = value; }
function __velarTestJoin(items) { return __velarDeepCall(__velarTestArrayJoin, items, [", "]); }
// The same reason-carrying treatment patternOf gives velar/text: toMatch compiles
// in 'u' mode too, so an identity escape rejected only here needs to say so.
function __velarTestPatternReason(error) {
  if (typeof error !== "object" || error === null) return "";
  const descriptor = __velarDeepGetOwnPropertyDescriptor(error, "message");
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") return "";
  const message = descriptor.value;
  const prefix = __velarDeepCall(__velarTestRegExpExec, __velarTestPatternPrefix, [message]);
  const head = prefix === null ? null : __velarDeepGetOwnPropertyDescriptor(prefix, 0);
  const reason = head && typeof head.value === "string" ? __velarDeepCall(__velarTestStringSlice, message, [head.value.length]) : message;
  return reason === "" || reason.length > 200 ? "" : ": " + reason;
}
function __velarTestString(value) { return __velarDeepCall(__velarTestNativeString, undefined, [value]); }
function display(value, state = null) {
  state ??= { active: new __velarDeepNativeWeakSet(), nodes: 0, depth: 0 };
  state.nodes += 1;
  if (state.nodes > 1000) return "…";
  if (value === null) return "null";
  if (typeof value === "string") return __velarDeepCall(__velarTestJsonStringify, __velarTestNativeJSON, [value.length > 256 ? __velarDeepCall(__velarTestStringSlice, value, [0, 256]) + "…" : value]);
  if (typeof value === "function") return "[function]";
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "symbol") return "[symbol]";
  if (typeof value !== "object") return __velarTestString(value);
  if (__velarDeepCall(__velarDeepWeakSetHas, state.active, [value])) return "[cycle]";
  if (state.depth >= 16) return "[depth]";
  __velarDeepCall(__velarDeepWeakSetAdd, state.active, [value]);
  state.depth += 1;
  try {
    if (__velarDeepCall(__velarDeepArrayIsArray, __velarDeepNativeArray, [value])) {
      if (!__velarDenseList(value)) return "[invalid List]";
      const items = [];
      const limit = __velarDeepCall(__velarTestMathMin, __velarTestNativeMath, [value.length, 50]);
      for (let index = 0; index < limit; index += 1) __velarTestAppend(items, display(__velarDeepGetOwnPropertyDescriptor(value, index).value, state));
      if (value.length > limit) __velarTestAppend(items, "…");
      return "[" + __velarTestJoin(items) + "]";
    }
    if (__velarMapSize(value) !== null) {
      const items = [];
      const iterator = __velarDeepCall(__velarDeepMapEntries, value, []);
      while (true) {
        const entry = __velarDeepIteratorValue(iterator, __velarDeepMapIteratorNext);
        if (entry === null) break;
        if (entry.invalid || !__velarDenseList(entry.value) || entry.value.length !== 2) return "[invalid Map]";
        if (items.length >= 50) { __velarTestAppend(items, "…"); break; }
        __velarTestAppend(items, display(__velarDeepGetOwnPropertyDescriptor(entry.value, 0).value, state) + " => " + display(__velarDeepGetOwnPropertyDescriptor(entry.value, 1).value, state));
      }
      return "Map(" + __velarTestJoin(items) + ")";
    }
    if (__velarSetSize(value) !== null) {
      const items = [];
      const iterator = __velarDeepCall(__velarDeepSetValues, value, []);
      while (true) {
        const item = __velarDeepIteratorValue(iterator, __velarDeepSetIteratorNext);
        if (item === null) break;
        if (item.invalid) return "[invalid Set]";
        if (items.length >= 50) { __velarTestAppend(items, "…"); break; }
        __velarTestAppend(items, display(item.value, state));
      }
      return "Set(" + __velarTestJoin(items) + ")";
    }
    const keys = __velarDataRecordKeys(value);
    if (keys) {
      const displayed = [];
      const limit = __velarDeepCall(__velarTestMathMin, __velarTestNativeMath, [keys.length, 50]);
      for (let index = 0; index < limit; index += 1) {
        const key = __velarDeepGetOwnPropertyDescriptor(keys, index).value;
        __velarTestAppend(displayed, __velarDeepCall(__velarTestJsonStringify, __velarTestNativeJSON, [key]) + ": " + display(__velarDeepGetOwnPropertyDescriptor(value, key).value, state));
      }
      if (keys.length > 50) __velarTestAppend(displayed, "…");
      return "{" + __velarTestJoin(displayed) + "}";
    }
    const prototype = __velarDeepGetPrototypeOf(value);
    const constructor = prototype && __velarDeepGetOwnPropertyDescriptor(prototype, "constructor")?.value;
    const name = typeof constructor === "function" ? __velarDeepGetOwnPropertyDescriptor(constructor, "name")?.value : null;
    return "[" + (typeof name === "string" && name ? name : "object") + "]";
  } finally {
    state.depth -= 1;
    __velarDeepCall(__velarDeepWeakSetDelete, state.active, [value]);
  }
}
export function expect(actual) {
  return __velarDeepCall(__velarTestFreeze, __velarDeepNativeObject, [{
    // D59 rule 141: the assertion asks the language, so 'toBe' and '==' can
    // never give different answers. Native '!==' made this the one comparison
    // in the language that disagreed with the language, and NaN was where it
    // showed.
    toBe(expected) { if (!__velarSameValueZero(actual, expected)) throw new __velarTestNativeError("Expected " + display(actual) + " to be " + display(expected)); },
    // D50 rule 97.2: the assertion asks the language, so 'toEqual' and
    // 'equals(a, b)' can never give different answers.
    toEqual(expected) { if (!__velarEquals(actual, expected)) throw new __velarTestNativeError("Expected " + display(actual) + " to deeply equal " + display(expected)); },
    toBeTruthy() { if (actual !== true) throw new __velarTestNativeError("Expected bool true but received " + display(actual)); },
    toBeFalsy() { if (actual !== false) throw new __velarTestNativeError("Expected bool false but received " + display(actual)); },
    // D59 rule 141.1: the List branch asks the language too, so 'toContain'
    // and 'values.has(item)' can never give different answers. Native '==='
    // made this the last comparison in the language that disagreed with the
    // language once 'toBe' was repaired, and NaN was again where it showed.
    // The text branch stays 'String.includes': code-point identity is what
    // containment in text means, not a value comparison.
    toContain(expected) {
      let contains = typeof actual === "string" && typeof expected === "string" && __velarDeepCall(__velarTestStringIncludes, actual, [expected]);
      if (__velarDeepCall(__velarDeepArrayIsArray, __velarDeepNativeArray, [actual]) && __velarDenseList(actual)) {
        contains = false;
        for (let index = 0; index < actual.length; index += 1) {
          if (__velarSameValueZero(__velarDeepGetOwnPropertyDescriptor(actual, index).value, expected)) { contains = true; break; }
        }
      }
      if (!contains) throw new __velarTestNativeError("Expected " + display(actual) + " to contain " + display(expected));
    },
    toMatch(expected) {
      if (typeof actual !== "string" || typeof expected !== "string") throw new __velarTestNativeTypeError("toMatch requires text and a string pattern");
      if (expected.length > 4096) throw new __velarTestNativeRangeError("toMatch patterns cannot exceed 4096 code units");
      let pattern;
      try { pattern = new __velarTestNativeRegExp(expected, "u"); } catch (error) { throw new __velarTestNativeTypeError("Invalid toMatch pattern" + __velarTestPatternReason(error)); }
      // The same time budget velar/text puts on its pattern operations: this is
      // that operation under another name, and an assertion that never returns
      // is a hung suite rather than a failing one.
      const deadline = __velarDeepCall(__velarTestDateNow, __velarTestNativeDate, []) + maxTestPatternMillis;
      const matched = __velarDeepCall(__velarTestRegExpExec, pattern, [actual]) !== null;
      if (__velarDeepCall(__velarTestDateNow, __velarTestNativeDate, []) > deadline) throw new __velarTestNativeRangeError("toMatch pattern matching cannot exceed " + maxTestPatternMillis + " ms");
      if (!matched) throw new __velarTestNativeError("Expected " + display(actual) + " to match " + display(expected));
    },
    toHaveLength(expected) {
      if (!__velarDeepCall(__velarTestNumberIsSafeInteger, __velarTestNativeNumber, [expected]) || expected < 0) throw new __velarTestNativeRangeError("Expected length must be a non-negative safe integer");
      const length = typeof actual === "string" ? actual.length : __velarDeepCall(__velarDeepArrayIsArray, __velarDeepNativeArray, [actual]) && __velarDenseList(actual) ? actual.length : null;
      if (length === null) throw new __velarTestNativeTypeError("toHaveLength requires text or a dense List");
      if (length !== expected) throw new __velarTestNativeError("Expected length " + expected + " but received " + length);
    },
    toThrow() {
      if (typeof actual !== "function") throw new __velarTestNativeTypeError("toThrow requires a function");
      let threw = false; try { actual(); } catch { threw = true; }
      if (!threw) throw new __velarTestNativeError("Expected function to throw");
    },
    async toReject() {
      let result;
      if (typeof actual === "function") {
        try { result = actual(); }
        catch (error) { throw new __velarTestNativeError("Expected function to return a rejecting Promise, but it threw synchronously: " + display(error)); }
      } else result = actual;
      let promise;
      try { promise = __velarDeepCall(__velarTestPromiseThen, result, [value => value]); }
      catch { throw new __velarTestNativeTypeError("toReject requires a Promise or a function returning one"); }
      try { await promise; } catch { return null; }
      throw new __velarTestNativeError("Expected Promise to reject");
    },
  }]);
}
