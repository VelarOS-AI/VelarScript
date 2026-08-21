import { VELAR_RUNTIME_REGISTRY_KEY, VELAR_RUNTIME_SCHEMA_VERSION } from "./runtime-abi.ts";

export const VELAR_STRICT_JSON_RUNTIME = String.raw`
const __velarMaxJsonCodeUnits = 16 * 1024 * 1024;
const __velarMaxJsonNodes = 1000000;
const __velarMaxJsonDepth = 128;
const __velarJsonNativeArray = globalThis.Array;
const __velarJsonNativeSet = globalThis.Set;
const __velarJsonNativeObject = globalThis.Object;
const __velarJsonNativeNumber = globalThis.Number;
const __velarJsonNativeString = globalThis.String;
const __velarJsonNativeMath = globalThis.Math;
const __velarJsonNativeTypeError = globalThis.TypeError;
const __velarJsonNativeRangeError = globalThis.RangeError;
const __velarJsonGetOwnPropertyDescriptor = __velarJsonNativeObject.getOwnPropertyDescriptor;
const __velarJsonGetOwnPropertyNames = __velarJsonNativeObject.getOwnPropertyNames;
const __velarJsonGetOwnPropertySymbols = __velarJsonNativeObject.getOwnPropertySymbols;
const __velarJsonGetPrototypeOf = __velarJsonNativeObject.getPrototypeOf;
const __velarJsonObjectPrototype = __velarJsonGetOwnPropertyDescriptor(__velarJsonNativeObject, "prototype")?.value;
const __velarJsonCreate = __velarJsonNativeObject.create;
const __velarJsonDefineProperty = __velarJsonNativeObject.defineProperty;
const __velarJsonArrayIsArray = __velarJsonNativeArray.isArray;
const __velarJsonArrayPrototype = __velarJsonGetOwnPropertyDescriptor(__velarJsonNativeArray, "prototype")?.value;
const __velarJsonArraySort = __velarJsonGetOwnPropertyDescriptor(__velarJsonArrayPrototype, "sort")?.value;
const __velarJsonNumberIsFinite = __velarJsonNativeNumber.isFinite;
const __velarJsonNumberIsInteger = __velarJsonNativeNumber.isInteger;
const __velarJsonMathMax = __velarJsonNativeMath.max;
const __velarJsonSymbolFor = globalThis.Symbol.for;
const __velarJsonReflectOwnKeys = globalThis.Reflect.ownKeys;
const __velarNativeReflectApply = __velarJsonGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarJsonSetPrototype = __velarJsonGetOwnPropertyDescriptor(__velarJsonNativeSet, "prototype")?.value;
const __velarJsonSetHas = __velarJsonGetOwnPropertyDescriptor(__velarJsonSetPrototype, "has")?.value;
const __velarJsonSetAdd = __velarJsonGetOwnPropertyDescriptor(__velarJsonSetPrototype, "add")?.value;
const __velarJsonSetDelete = __velarJsonGetOwnPropertyDescriptor(__velarJsonSetPrototype, "delete")?.value;
const __velarJsonStringPrototype = __velarJsonGetOwnPropertyDescriptor(__velarJsonNativeString, "prototype")?.value;
const __velarJsonCharCodeAt = __velarJsonGetOwnPropertyDescriptor(__velarJsonStringPrototype, "charCodeAt")?.value;
const __velarJsonPathPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const __velarJsonRegExpPrototype = __velarJsonGetPrototypeOf(__velarJsonPathPattern);
const __velarJsonRegExpTest = __velarJsonGetOwnPropertyDescriptor(__velarJsonRegExpPrototype, "test")?.value;
function __velarJsonApply(operation, receiver, arguments_, label) {
  if (typeof operation !== "function" || typeof __velarNativeReflectApply !== "function") throw new __velarJsonNativeTypeError("The JavaScript " + label + " JSON API is unavailable");
  return __velarNativeReflectApply(operation, receiver, arguments_);
}
const __velarJsonHostDescriptor = __velarJsonGetOwnPropertyDescriptor(globalThis, "JSON");
const __velarJsonHost = __velarJsonHostDescriptor && "value" in __velarJsonHostDescriptor ? __velarJsonHostDescriptor.value : null;
const __velarNativeJsonParse = __velarJsonHost && __velarJsonGetOwnPropertyDescriptor(__velarJsonHost, "parse")?.value;
const __velarNativeJsonStringify = __velarJsonHost && __velarJsonGetOwnPropertyDescriptor(__velarJsonHost, "stringify")?.value;
function __velarJsonRaw(value) {
  const descriptor = __velarJsonGetOwnPropertyDescriptor(globalThis, __velarJsonApply(__velarJsonSymbolFor, undefined, [${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)}], "Symbol.for"));
  const runtime = descriptor && "value" in descriptor ? descriptor.value : null;
  // Absent is the blessed case: a realm with no reactive runtime keeps ordinary
  // Core behavior. A registry that is present but from another generation is
  // not that case — reading past it would drop reactivity with no trace — so it
  // fails closed, and it is tested before the callable duck-check so a schema
  // bump that also renamed 'toRaw' still reports the version.
  if (!runtime || (typeof runtime !== "object" && typeof runtime !== "function")) return value;
  if (runtime.version !== ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)}) {
    throw new __velarJsonNativeTypeError("VelarScript reactive runtime schema " + (typeof runtime.version === "string" ? runtime.version : "(unknown)") + " does not match this module's schema ${VELAR_RUNTIME_SCHEMA_VERSION}; one build mixed two generations of @velarscript/* — run 'npm ls @velarscript/compiler' and pin one version");
  }
  if (typeof runtime.toRaw !== "function") return value;
  if (typeof runtime.trackDeep === "function") runtime.trackDeep(value);
  return runtime.toRaw(value);
}
function __velarJsonFailure(path, message) {
  throw new __velarJsonNativeTypeError("Invalid JSON value at " + path + ": " + message);
}
function __velarJsonPath(parent, key) {
  return __velarJsonApply(__velarJsonRegExpTest, __velarJsonPathPattern, [key], "RegExp.test") ? parent + "." + key : parent + "[field]";
}
function __velarJsonStringUnits(value) {
  let units = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = __velarJsonApply(__velarJsonCharCodeAt, value, [index], "String.charCodeAt");
    if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) units += 2;
    else if (code <= 31 || (code >= 0xD800 && code <= 0xDFFF && !(code <= 0xDBFF && index + 1 < value.length && __velarJsonApply(__velarJsonCharCodeAt, value, [index + 1], "String.charCodeAt") >= 0xDC00 && __velarJsonApply(__velarJsonCharCodeAt, value, [index + 1], "String.charCodeAt") <= 0xDFFF))) units += 6;
    else { units += 1; if (code >= 0xD800 && code <= 0xDBFF) { units += 1; index += 1; } }
    if (units > __velarMaxJsonCodeUnits) return units;
  }
  return units;
}
function __velarJsonBudget(state, path) {
  if (state.nodes > __velarMaxJsonNodes) __velarJsonFailure(path, "data cannot exceed " + __velarMaxJsonNodes + " values");
  if (state.compactUnits > __velarMaxJsonCodeUnits) __velarJsonFailure(path, "encoded JSON cannot exceed 16 MiB");
}
function __velarJsonState() { return { active: new __velarJsonNativeSet(), nodes: 0, depth: 0, compactUnits: 0, prettyLines: 0, prettyIndentWeight: 0, prettyColonSpaces: 0 }; }
function __velarInspectJson(value, path, state, copy) {
  value = __velarJsonRaw(value);
  state.nodes += 1;
  if (value === null) { state.compactUnits += 4; __velarJsonBudget(state, path); return value; }
  if (typeof value === "string") { state.compactUnits += __velarJsonStringUnits(value); __velarJsonBudget(state, path); return value; }
  if (typeof value === "boolean") { state.compactUnits += value ? 4 : 5; __velarJsonBudget(state, path); return value; }
  if (typeof value === "number") {
    if (!__velarJsonApply(__velarJsonNumberIsFinite, __velarJsonNativeNumber, [value], "Number.isFinite")) __velarJsonFailure(path, "numbers must be finite");
    state.compactUnits += __velarJsonApply(__velarJsonNativeString, undefined, [value], "String").length;
    __velarJsonBudget(state, path);
    return value;
  }
  if (typeof value !== "object") __velarJsonFailure(path, typeof value + " is not supported");
  if (state.depth >= __velarMaxJsonDepth) __velarJsonFailure(path, "data cannot exceed " + __velarMaxJsonDepth + " nested collections");
  if (__velarJsonApply(__velarJsonSetHas, state.active, [value], "Set.has")) __velarJsonFailure(path, "cyclic data is not supported");
  __velarJsonApply(__velarJsonSetAdd, state.active, [value], "Set.add");
  try {
    if (__velarJsonApply(__velarJsonArrayIsArray, __velarJsonNativeArray, [value], "Array.isArray")) {
      if (value.length > 1000000) __velarJsonFailure(path, "Lists cannot exceed 1000000 items");
      if (__velarJsonGetOwnPropertySymbols(value).length > 0) __velarJsonFailure(path, "List symbol fields are not supported");
      const names = __velarJsonGetOwnPropertyNames(value);
      if (names.length !== value.length + 1 || names[names.length - 1] !== "length") {
        __velarJsonFailure(path, "Lists must be dense and cannot have extra fields");
      }
      state.compactUnits += 2 + __velarJsonApply(__velarJsonMathMax, __velarJsonNativeMath, [0, value.length - 1], "Math.max");
      if (value.length > 0) {
        state.prettyLines += value.length + 1;
        state.prettyIndentWeight += value.length * (state.depth + 1) + state.depth;
      }
      __velarJsonBudget(state, path);
      const output = copy ? new __velarJsonNativeArray(value.length) : value;
      state.depth += 1;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = __velarJsonGetOwnPropertyDescriptor(value, index);
        if (!descriptor?.enumerable || !("value" in descriptor)) __velarJsonFailure(path + "[" + index + "]", "List entries must be enumerable data values");
        const child = __velarInspectJson(descriptor.value, path + "[" + index + "]", state, copy);
        if (copy) output[index] = child;
      }
      state.depth -= 1;
      return output;
    }
    const prototype = __velarJsonGetPrototypeOf(value);
    if (prototype !== __velarJsonObjectPrototype && prototype !== null) {
      __velarJsonFailure(path, "only records and Lists are supported");
    }
    const keys = __velarJsonApply(__velarJsonReflectOwnKeys, globalThis.Reflect, [value], "Reflect.ownKeys");
    if (keys.length > 1000000) __velarJsonFailure(path, "records cannot exceed 1000000 fields");
    state.compactUnits += 2 + __velarJsonApply(__velarJsonMathMax, __velarJsonNativeMath, [0, keys.length - 1], "Math.max");
    if (keys.length > 0) {
      state.prettyLines += keys.length + 1;
      state.prettyIndentWeight += keys.length * (state.depth + 1) + state.depth;
      state.prettyColonSpaces += keys.length;
    }
    __velarJsonBudget(state, path);
    const output = copy ? __velarJsonApply(__velarJsonCreate, __velarJsonNativeObject, [null], "Object.create") : value;
    state.depth += 1;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") __velarJsonFailure(path, "record symbol fields are not supported");
      state.compactUnits += __velarJsonStringUnits(key) + 1;
      __velarJsonBudget(state, path);
      const childPath = __velarJsonPath(path, key);
      const descriptor = __velarJsonGetOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        __velarJsonFailure(childPath, "record fields must be enumerable data values");
      }
      const child = __velarInspectJson(descriptor.value, childPath, state, copy);
      if (copy) __velarJsonApply(__velarJsonDefineProperty, __velarJsonNativeObject, [output, key, { value: child, enumerable: true, configurable: true, writable: true }], "Object.defineProperty");
    }
    state.depth -= 1;
    return output;
  } finally {
    __velarJsonApply(__velarJsonSetDelete, state.active, [value], "Set.delete");
  }
}
function __velarAssertJson(value, path = "$", state = null) {
  state ??= __velarJsonState();
  __velarInspectJson(value, path, state, false);
  return state;
}
function __velarJsonSnapshot(value) {
  const state = __velarJsonState();
  return { value: __velarInspectJson(value, "$", state, true), state };
}
function __velarJsonIndent(pretty) {
  if (pretty === false) return 0;
  if (pretty === true) return 2;
  if (!__velarJsonApply(__velarJsonNumberIsInteger, __velarJsonNativeNumber, [pretty], "Number.isInteger") || pretty < 0 || pretty > 10) {
    throw new __velarJsonNativeRangeError("JSON indentation must be false, true, or an integer from 0 to 10");
  }
  return pretty;
}
function __velarJsonDecode(text, name, copy) {
  if (typeof text !== "string") throw new __velarJsonNativeTypeError(name + " must be a string");
  if (text.length > __velarMaxJsonCodeUnits) throw new __velarJsonNativeRangeError(name + " cannot exceed 16 MiB");
  if (typeof __velarNativeJsonParse !== "function" || typeof __velarNativeReflectApply !== "function") {
    throw new __velarJsonNativeTypeError("The host JSON parser is unavailable");
  }
  const value = __velarNativeReflectApply(__velarNativeJsonParse, __velarJsonHost, [text]);
  return __velarInspectJson(value, "$", __velarJsonState(), copy);
}
function __velarJsonParse(text, name = "JSON text") {
  return __velarJsonDecode(text, name, true);
}
// Decoding text straight into a runtime Type rebuilds the value twice and keeps
// only the second rebuild: D90 rule R5's copy builds its result from the Type's
// declared fields, which discards everything the owned-data rebuild made. This
// entry runs the same validating walk — the walk is what enforces the depth,
// node, and encoded size budgets — and skips only the rebuild the Type is about
// to discard. The host parser's tree is brand new with no second holder, so
// nothing the Type reads is aliased, and taking the Type here rather than
// returning the tree is what keeps a value that skipped the rebuild from
// reaching anyone else.
function __velarJsonParseTyped(Type, text, name = "JSON text") {
  return Type.parse(__velarJsonDecode(text, name, false));
}
function __velarJsonStringify(value, pretty = false) {
  const snapshot = __velarJsonSnapshot(value);
  const state = snapshot.state;
  const indentation = __velarJsonIndent(pretty);
  const estimated = state.compactUnits + (indentation ? state.prettyLines + state.prettyColonSpaces + state.prettyIndentWeight * indentation : 0);
  if (estimated > __velarMaxJsonCodeUnits) throw new __velarJsonNativeRangeError("Encoded JSON cannot exceed 16 MiB");
  if (typeof __velarNativeJsonStringify !== "function" || typeof __velarNativeReflectApply !== "function") {
    throw new __velarJsonNativeTypeError("The host JSON serializer is unavailable");
  }
  const output = __velarNativeReflectApply(__velarNativeJsonStringify, __velarJsonHost, [snapshot.value, null, indentation]);
  if (typeof output !== "string") throw new __velarJsonNativeTypeError("The host JSON serializer must return a string");
  if (output.length > __velarMaxJsonCodeUnits) throw new __velarJsonNativeRangeError("Encoded JSON cannot exceed 16 MiB");
  return output;
}
function __velarJsonClone(value) { return __velarJsonParse(__velarJsonStringify(value)); }
`.trimStart();
