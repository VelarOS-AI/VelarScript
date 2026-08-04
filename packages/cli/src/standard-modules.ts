import { optionalOf as optional, type ClassInfo, type CompilerExtension, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { VELAR_ERROR_NORMALIZATION_RUNTIME } from "@velarscript/compiler/extension";
import { VELAR_STANDARD_API_VERSION } from "./version.ts";

const anyType: ValueType = { kind: "any" };
const nullType: ValueType = { kind: "null" };
const stringType: ValueType = { kind: "string" };
const numberType: ValueType = { kind: "number" };
const boolType: ValueType = { kind: "bool" };

function functionType(parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameters, requiredParameters, result };
}

function intrinsic(name: string, parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "intrinsic", name, parameters, requiredParameters, result };
}

function promise(value: ValueType): ValueType {
  return { kind: "promise", value };
}

function object(fields: Readonly<Record<string, ValueType>>): ValueType {
  return { kind: "object", fields: new Map(Object.entries(fields)) };
}

const unknownType: ValueType = { kind: "unknown" };
const errorType: ValueType = { kind: "class", name: "Error" };
const cleanupType = functionType([], nullType);
const listAny: ValueType = { kind: "list", element: anyType };
const listNumber: ValueType = { kind: "list", element: numberType };
const listString: ValueType = { kind: "list", element: stringType };
const mapAny: ValueType = { kind: "map", key: anyType, value: anyType };
const mapString = (value: ValueType): ValueType => ({ kind: "map", key: stringType, value });
const patternOptionsType = object({
  ignoreCase: optional(boolType),
  multiline: optional(boolType),
  dotAll: optional(boolType),
});
const textMatchType = object({
  value: stringType,
  index: numberType,
  groups: { kind: "list", element: optional(stringType) },
});
const textMatchArrayType: ValueType = { kind: "list", element: textMatchType };
const urlInfoType = object({
  href: stringType,
  protocol: stringType,
  host: stringType,
  hostname: stringType,
  port: stringType,
  path: stringType,
  query: { kind: "map", key: stringType, value: stringType },
  hash: stringType,
  origin: stringType,
});
const timePartsType = object({
  year: numberType, month: numberType, day: numberType, weekday: numberType,
  hour: numberType, minute: numberType, second: numberType, millisecond: numberType,
});
const logFieldsType = mapString(unknownType);
const logRecordType = object({
  timestamp: numberType,
  level: stringType,
  scope: stringType,
  message: stringType,
  fields: logFieldsType,
  error: optional(errorType),
});
const loggerType = object({
  debug: functionType([stringType, logFieldsType], nullType, 1),
  info: functionType([stringType, logFieldsType], nullType, 1),
  warn: functionType([stringType, logFieldsType], nullType, 1),
  error: functionType([stringType, errorType, logFieldsType], nullType, 1),
});

const coreModuleInterfaces = new Map<string, ModuleInterface>([
  ["velar/collections", moduleInterface(new Map([
    ["range", functionType([numberType, numberType, numberType], listNumber, 1)],
    ["enumerate", intrinsic("collections.enumerate", [listAny, numberType], listAny, 1)],
    ["zip", intrinsic("collections.zip", [listAny, listAny], listAny)],
    ["unique", intrinsic("collections.unique", [listAny], listAny)],
    ["chunk", intrinsic("collections.chunk", [listAny, numberType], listAny)],
    ["flatten", intrinsic("collections.flatten", [listAny], listAny)],
    ["compact", intrinsic("collections.compact", [listAny], listAny)],
    ["reversed", intrinsic("collections.reversed", [listAny], listAny)],
    ["take", intrinsic("collections.take", [listAny, numberType], listAny)],
    ["drop", intrinsic("collections.drop", [listAny, numberType], listAny)],
    ["first", intrinsic("collections.first", [listAny], anyType)],
    ["last", intrinsic("collections.last", [listAny], anyType)],
    ["find", intrinsic("collections.find", [listAny, anyType], anyType)],
    ["index", intrinsic("collections.index", [listAny, anyType], optional(numberType))],
    ["has", intrinsic("collections.has", [listAny, anyType], boolType)],
    ["count", intrinsic("collections.count", [listAny, anyType], numberType)],
    ["some", intrinsic("collections.some", [listAny, anyType], boolType)],
    ["every", intrinsic("collections.every", [listAny, anyType], boolType)],
    ["partition", intrinsic("collections.partition", [listAny, anyType], anyType)],
    ["groupBy", intrinsic("collections.groupBy", [listAny, anyType], mapAny)],
    ["keyBy", intrinsic("collections.keyBy", [listAny, anyType], mapAny)],
    ["countBy", intrinsic("collections.countBy", [listAny, anyType], mapAny)],
    ["sortBy", intrinsic("collections.sortBy", [listAny, anyType, boolType], listAny, 2)],
    ["minBy", intrinsic("collections.minBy", [listAny, anyType], anyType)],
    ["maxBy", intrinsic("collections.maxBy", [listAny, anyType], anyType)],
    ["sum", intrinsic("collections.sum", [listNumber], numberType)],
    ["join", intrinsic("collections.join", [listString, stringType], stringType, 1)],
    ["repeat", intrinsic("collections.repeat", [anyType, numberType], listAny)],
  ]))],
  ["velar/text", moduleInterface(new Map([
    ["trim", functionType([stringType], stringType)],
    ["trimStart", functionType([stringType], stringType)],
    ["trimEnd", functionType([stringType], stringType)],
    ["lower", functionType([stringType], stringType)],
    ["upper", functionType([stringType], stringType)],
    ["capitalize", functionType([stringType], stringType)],
    ["title", functionType([stringType], stringType)],
    ["startsWith", functionType([stringType, stringType], boolType)],
    ["endsWith", functionType([stringType, stringType], boolType)],
    ["includes", functionType([stringType, stringType], boolType)],
    ["split", functionType([stringType, stringType], listString)],
    ["replace", functionType([stringType, stringType, stringType], stringType)],
    ["replaceAll", functionType([stringType, stringType, stringType], stringType)],
    ["repeat", functionType([stringType, numberType], stringType)],
    ["padStart", functionType([stringType, numberType, stringType], stringType, 2)],
    ["padEnd", functionType([stringType, numberType, stringType], stringType, 2)],
    ["lines", functionType([stringType], listString)],
    ["words", functionType([stringType], listString)],
    ["slug", functionType([stringType], stringType)],
    ["truncate", functionType([stringType, numberType, stringType], stringType, 2)],
    ["indent", functionType([stringType, stringType], stringType, 1)],
    ["dedent", functionType([stringType], stringType)],
    ["normalizeWhitespace", functionType([stringType], stringType)],
    ["isBlank", functionType([stringType], boolType)],
    ["escapeHtml", functionType([stringType], stringType)],
    ["matches", functionType([stringType, stringType, patternOptionsType], boolType, 2)],
    ["findMatch", functionType([stringType, stringType, patternOptionsType], optional(textMatchType), 2)],
    ["findMatches", functionType([stringType, stringType, patternOptionsType], textMatchArrayType, 2)],
    ["replaceMatches", functionType([stringType, stringType, stringType, patternOptionsType], stringType, 3)],
    ["splitPattern", functionType([stringType, stringType, patternOptionsType], listString, 2)],
  ]))],
  ["velar/math", moduleInterface(new Map([
    ["pi", numberType], ["e", numberType], ["tau", numberType], ["infinity", numberType],
    ["abs", functionType([numberType], numberType)],
    ["min", intrinsic("math.min", [numberType], numberType)],
    ["max", intrinsic("math.max", [numberType], numberType)],
    ["clamp", functionType([numberType, numberType, numberType], numberType)],
    ["sign", functionType([numberType], numberType)],
    ["round", functionType([numberType, numberType], numberType, 1)],
    ["floor", functionType([numberType], numberType)],
    ["ceil", functionType([numberType], numberType)],
    ["trunc", functionType([numberType], numberType)],
    ["sqrt", functionType([numberType], numberType)],
    ["cbrt", functionType([numberType], numberType)],
    ["pow", functionType([numberType, numberType], numberType)],
    ["exp", functionType([numberType], numberType)],
    ["log", functionType([numberType, numberType], numberType, 1)],
    ["log2", functionType([numberType], numberType)],
    ["log10", functionType([numberType], numberType)],
    ["sin", functionType([numberType], numberType)],
    ["cos", functionType([numberType], numberType)],
    ["tan", functionType([numberType], numberType)],
    ["asin", functionType([numberType], numberType)],
    ["acos", functionType([numberType], numberType)],
    ["atan", functionType([numberType], numberType)],
    ["atan2", functionType([numberType, numberType], numberType)],
    ["degrees", functionType([numberType], numberType)],
    ["radians", functionType([numberType], numberType)],
    ["hypot", functionType([numberType, numberType], numberType)],
    ["random", functionType([], numberType)],
    ["randomInt", functionType([numberType, numberType], numberType, 1)],
    ["isFinite", functionType([numberType], boolType)],
    ["isInteger", functionType([numberType], boolType)],
    ["gcd", functionType([numberType, numberType], numberType)],
    ["lcm", functionType([numberType, numberType], numberType)],
  ]))],
  ["velar/json", moduleInterface(new Map([
    ["parse", intrinsic("json.parse", [stringType, anyType], unknownType, 1)],
    ["tryParse", intrinsic("json.tryParse", [stringType, anyType, anyType], unknownType, 1)],
    ["stringify", intrinsic("json.stringify", [anyType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["stableStringify", intrinsic("json.stableStringify", [anyType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["clone", intrinsic("json.clone", [anyType, anyType], anyType, 1)],
    ["isSerializable", functionType([anyType], boolType)],
    ["deepEqual", functionType([anyType, anyType], boolType)],
  ]))],
  ["velar/async", moduleInterface(new Map([
    ["sleep", functionType([numberType], promise(nullType))],
    ["all", intrinsic("async.all", [listAny], promise(listAny))],
    ["race", intrinsic("async.race", [listAny], promise(anyType))],
    ["timeout", intrinsic("async.timeout", [promise(anyType), numberType, stringType], promise(anyType), 2)],
    ["retry", intrinsic("async.retry", [anyType, numberType], promise(anyType), 1)],
    ["map", intrinsic("async.map", [listAny, anyType, numberType], promise(listAny), 2)],
    ["series", intrinsic("async.series", [listAny], promise(listAny))],
  ]))],
  ["velar/url", moduleInterface(new Map([
    ["parse", functionType([stringType, stringType], urlInfoType, 1)],
    ["join", intrinsic("url.join", [stringType], stringType)],
    ["query", functionType([anyType], stringType)],
    ["parseQuery", functionType([stringType], { kind: "map", key: stringType, value: stringType })],
    ["withQuery", functionType([stringType, anyType], stringType)],
    ["withHash", functionType([stringType, stringType], stringType)],
    ["isExternal", functionType([stringType, stringType], boolType, 1)],
    ["encode", functionType([stringType], stringType)],
    ["decode", functionType([stringType], stringType)],
    ["normalize", functionType([stringType, stringType], stringType, 1)],
  ]))],
  ["velar/time", moduleInterface(new Map([
    ["now", functionType([], numberType)],
    ["monotonic", functionType([], numberType)],
    ["parse", functionType([stringType], optional(numberType))],
    ["iso", functionType([numberType], stringType, 0)],
    ["format", functionType([numberType, stringType, stringType], stringType, 1)],
    ["date", functionType([numberType, numberType, numberType, numberType, numberType, numberType], numberType, 3)],
    ["utc", functionType([numberType, numberType, numberType, numberType, numberType, numberType], numberType, 3)],
    ["parts", functionType([numberType, stringType], timePartsType, 1)],
  ]))],
  ["velar/id", moduleInterface(new Map([
    ["uuid", functionType([], stringType)],
    ["isUuid", functionType([stringType], boolType)],
  ]))],
  ["velar/log", moduleInterface(new Map([
    ["log", loggerType],
    ["logger", functionType([stringType, logFieldsType], loggerType, 1)],
    ["level", functionType([], stringType)],
    ["setLevel", functionType([stringType], nullType)],
    ["useSink", functionType([functionType([logRecordType], unknownType)], cleanupType)],
  ]))],
  ["velar/test", moduleInterface(new Map([
    ["expect", intrinsic("test.expect", [anyType], anyType)],
  ]))],
]);

function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  classes: ReadonlyMap<string, ClassInfo> = new Map(),
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
): ModuleInterface {
  return { exports, mutableExports: new Set(), reactiveExports: new Map(), namedTypes, namedTypeIdentities: new Map(), typeAliases: new Map(), enums: new Map(), classes, testFunctions: [], extensionExports: new Map(), extensionData: new Map() };
}

export function standardModuleInterfaces(extensions: readonly CompilerExtension[] = []): ReadonlyMap<string, ModuleInterface> {
  return new Map([
    ...coreModuleInterfaces,
    ...extensions.flatMap((extension) => extension.modules ? [...extension.modules.interfaces] : []),
  ]);
}

export function isStandardModule(source: string, extensions: readonly CompilerExtension[] = []): boolean {
  return standardModuleInterface(source, extensions) !== null;
}

export function standardModuleInterface(source: string, extensions: readonly CompilerExtension[] = []): ModuleInterface | null {
  for (const extension of extensions) {
    const interface_ = extension.modules?.interfaces.get(source);
    if (interface_) return interface_;
  }
  return coreModuleInterfaces.get(source) ?? null;
}

const strictJsonRuntime = String.raw`
const __velarMaxJsonCodeUnits = 16 * 1024 * 1024;
const __velarMaxJsonNodes = 1000000;
const __velarMaxJsonDepth = 128;
function __velarJsonFailure(path, message) {
  throw new TypeError("Invalid JSON value at " + path + ": " + message);
}
function __velarJsonPath(parent, key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ? parent + "." + key : parent + "[" + JSON.stringify(key) + "]";
}
function __velarJsonStringUnits(value) {
  let units = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) units += 2;
    else if (code <= 31 || (code >= 0xD800 && code <= 0xDFFF && !(code <= 0xDBFF && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF))) units += 6;
    else { units += 1; if (code >= 0xD800 && code <= 0xDBFF) { units += 1; index += 1; } }
    if (units > __velarMaxJsonCodeUnits) return units;
  }
  return units;
}
function __velarJsonBudget(state, path) {
  if (state.nodes > __velarMaxJsonNodes) __velarJsonFailure(path, "data cannot exceed " + __velarMaxJsonNodes + " values");
  if (state.compactUnits > __velarMaxJsonCodeUnits) __velarJsonFailure(path, "encoded JSON cannot exceed 16 MiB");
}
function __velarAssertJson(value, path = "$", state = null) {
  state ??= { active: new Set(), nodes: 0, depth: 0, compactUnits: 0, prettyLines: 0, prettyIndentWeight: 0, prettyColonSpaces: 0 };
  state.nodes += 1;
  if (value === null) { state.compactUnits += 4; __velarJsonBudget(state, path); return state; }
  if (typeof value === "string") { state.compactUnits += __velarJsonStringUnits(value); __velarJsonBudget(state, path); return state; }
  if (typeof value === "boolean") { state.compactUnits += value ? 4 : 5; __velarJsonBudget(state, path); return state; }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) __velarJsonFailure(path, "numbers must be finite");
    state.compactUnits += String(value).length;
    __velarJsonBudget(state, path);
    return state;
  }
  if (typeof value !== "object") __velarJsonFailure(path, typeof value + " is not supported");
  if (state.depth >= __velarMaxJsonDepth) __velarJsonFailure(path, "data cannot exceed " + __velarMaxJsonDepth + " nested collections");
  if (state.active.has(value)) __velarJsonFailure(path, "cyclic data is not supported");
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 1000000) __velarJsonFailure(path, "Lists cannot exceed 1000000 items");
      if (Object.getOwnPropertySymbols(value).length > 0) __velarJsonFailure(path, "List symbol fields are not supported");
      const names = Object.getOwnPropertyNames(value);
      if (names.length !== value.length + 1 || names[names.length - 1] !== "length") {
        __velarJsonFailure(path, "Lists must be dense and cannot have extra fields");
      }
      state.compactUnits += 2 + Math.max(0, value.length - 1);
      if (value.length > 0) {
        state.prettyLines += value.length + 1;
        state.prettyIndentWeight += value.length * (state.depth + 1) + state.depth;
      }
      __velarJsonBudget(state, path);
      state.depth += 1;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor?.enumerable || !("value" in descriptor)) __velarJsonFailure(path + "[" + index + "]", "List entries must be enumerable data values");
        __velarAssertJson(descriptor.value, path + "[" + index + "]", state);
      }
      state.depth -= 1;
      return state;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      __velarJsonFailure(path, "only records and Lists are supported");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > 1000000) __velarJsonFailure(path, "records cannot exceed 1000000 fields");
    state.compactUnits += 2 + Math.max(0, keys.length - 1);
    if (keys.length > 0) {
      state.prettyLines += keys.length + 1;
      state.prettyIndentWeight += keys.length * (state.depth + 1) + state.depth;
      state.prettyColonSpaces += keys.length;
    }
    __velarJsonBudget(state, path);
    state.depth += 1;
    for (const key of keys) {
      if (typeof key !== "string") __velarJsonFailure(path, "record symbol fields are not supported");
      state.compactUnits += __velarJsonStringUnits(key) + 1;
      __velarJsonBudget(state, path);
      const childPath = __velarJsonPath(path, key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        __velarJsonFailure(childPath, "record fields must be enumerable data values");
      }
      __velarAssertJson(descriptor.value, childPath, state);
    }
    state.depth -= 1;
    return state;
  } finally {
    state.active.delete(value);
  }
}
function __velarJsonIndent(pretty) {
  if (pretty === false) return 0;
  if (pretty === true) return 2;
  if (!Number.isInteger(pretty) || pretty < 0 || pretty > 10) {
    throw new RangeError("JSON indentation must be false, true, or an integer from 0 to 10");
  }
  return pretty;
}
function __velarJsonStringify(value, pretty = false) {
  const state = __velarAssertJson(value);
  const indentation = __velarJsonIndent(pretty);
  const estimated = state.compactUnits + (indentation ? state.prettyLines + state.prettyColonSpaces + state.prettyIndentWeight * indentation : 0);
  if (estimated > __velarMaxJsonCodeUnits) throw new RangeError("Encoded JSON cannot exceed 16 MiB");
  const output = JSON.stringify(value, null, indentation);
  if (output.length > __velarMaxJsonCodeUnits) throw new RangeError("Encoded JSON cannot exceed 16 MiB");
  return output;
}
`.trimStart();

const deepEqualRuntime = String.raw`
function __velarPlainRecord(value) { const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }
function __velarDenseList(value) {
  if (!Array.isArray(value) || value.length > 1000000
    || Object.getOwnPropertySymbols(value).length !== 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) return false;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable
    || lengthDescriptor.configurable || !("value" in lengthDescriptor)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) return false;
  }
  return true;
}
function __velarMapSize(value) { try { return Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(value); } catch { return null; } }
function __velarSetSize(value) { try { return Reflect.getOwnPropertyDescriptor(Set.prototype, "size").get.call(value); } catch { return null; } }
function __velarDataRecordKeys(value) {
  if (!__velarPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return null;
  const keys = Object.getOwnPropertyNames(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
  }
  return keys.sort();
}
function __velarEqualValue(left, right, leftActive, rightActive, depth = 0) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (depth >= 512) return false;
  if (leftActive.has(left) || rightActive.has(right)) return false;
  leftActive.add(left); rightActive.add(right);
  try {
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!__velarDenseList(left) || !__velarDenseList(right) || left.length !== right.length) return false;
      for (let index = 0; index < left.length; index += 1) {
        const leftValue = Object.getOwnPropertyDescriptor(left, index).value;
        const rightValue = Object.getOwnPropertyDescriptor(right, index).value;
        if (!__velarEqualValue(leftValue, rightValue, leftActive, rightActive, depth + 1)) return false;
      }
      return true;
    }
    const leftMapSize = __velarMapSize(left);
    const rightMapSize = __velarMapSize(right);
    if (leftMapSize !== null || rightMapSize !== null) {
      if (leftMapSize === null || rightMapSize === null || leftMapSize !== rightMapSize) return false;
      for (const [key, value] of Map.prototype.entries.call(left)) {
        if (!Map.prototype.has.call(right, key)
          || !__velarEqualValue(value, Map.prototype.get.call(right, key), leftActive, rightActive, depth + 1)) return false;
      }
      return true;
    }
    const leftSetSize = __velarSetSize(left);
    const rightSetSize = __velarSetSize(right);
    if (leftSetSize !== null || rightSetSize !== null) {
      if (leftSetSize === null || rightSetSize === null || leftSetSize !== rightSetSize) return false;
      for (const value of Set.prototype.values.call(left)) if (!Set.prototype.has.call(right, value)) return false;
      return true;
    }
    const leftKeys = __velarDataRecordKeys(left);
    const rightKeys = __velarDataRecordKeys(right);
    if (!leftKeys || !rightKeys) return false;
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index]
        && __velarEqualValue(Object.getOwnPropertyDescriptor(left, key).value, Object.getOwnPropertyDescriptor(right, key).value, leftActive, rightActive, depth + 1));
  } finally {
    leftActive.delete(left); rightActive.delete(right);
  }
}
function __velarDeepEqual(left, right) { return __velarEqualValue(left, right, new WeakSet(), new WeakSet()); }
`.trimStart();

const listRuntime = String.raw`
const __velarMaxListItems = 1000000;
function __velarRequireList(value, name) {
  if (!Array.isArray(value)) throw new TypeError(name + " requires a List");
  if (value.length > __velarMaxListItems) throw new RangeError(name + " cannot exceed " + __velarMaxListItems + " items");
  if (Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    throw new TypeError(name + " requires a dense List without extra fields");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable
    || lengthDescriptor.configurable || !("value" in lengthDescriptor)) {
    throw new TypeError(name + " requires an ordinary mutable List length");
  }
  const output = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) {
      throw new TypeError(name + " requires ordinary mutable List elements");
    }
    output[index] = descriptor.value;
  }
  return output;
}
`.trimStart();

const runtimeTypeRuntime = String.raw`
const __velarRuntimeTypeRegistryKey = Symbol.for("velar.type.registry.v1");
const __velarRuntimeTypeRegistry = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, __velarRuntimeTypeRegistryKey);
  if (descriptor) {
    if (!("value" in descriptor)) throw new TypeError("VelarScript runtime type registry cannot be an accessor");
    try { WeakSet.prototype.has.call(descriptor.value, descriptor.value); }
    catch { throw new TypeError("VelarScript runtime type registry is invalid"); }
    return descriptor.value;
  }
  const registry = new WeakSet();
  Object.defineProperty(globalThis, __velarRuntimeTypeRegistryKey, {
    value: registry,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return registry;
})();
function __velarRegisterRuntimeType(value) { __velarRuntimeTypeRegistry.add(value); return value; }
function __velarRequireRuntimeType(value, name, optional = false) {
  if (optional && value == null) return null;
  if (!value || typeof value !== "object" || !WeakSet.prototype.has.call(__velarRuntimeTypeRegistry, value)) {
    throw new TypeError(name + " requires a compiler-known VelarScript runtime type");
  }
  return value;
}
`.trimStart();

const coreModuleSources: ReadonlyMap<string, string> = new Map([
  ["velar/collections", String.raw`
${listRuntime}
function requireList(value, name) {
  return __velarRequireList(value, name);
}

function requireCount(value, name, positive = false) {
  if (!Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) {
    throw new RangeError(name + " requires " + (positive ? "a positive" : "a non-negative") + " integer");
  }
  return value;
}

function requireCallback(value, name) {
  if (typeof value !== "function") throw new TypeError(name + " requires a function");
  return value;
}

function predicate(callback, value, name) {
  const result = requireCallback(callback, name)(value);
  if (typeof result !== "boolean") throw new TypeError(name + " predicate must return bool");
  return result;
}

function comparable(value, name, expected = null) {
  const type = typeof value;
  if ((type !== "string" && type !== "number") || (type === "number" && Number.isNaN(value))) {
    throw new TypeError(name + " key must be a string or non-NaN number");
  }
  if (expected !== null && type !== expected) throw new TypeError(name + " keys must all have the same type");
  return type;
}

export function range(start, stop = null, step = 1) {
  if (stop === null) { stop = start; start = 0; }
  if (![start, stop, step].every(Number.isFinite) || step === 0) throw new RangeError("range requires finite numbers and a non-zero step");
  const output = [];
  if (step > 0) for (let value = start; value < stop;) {
    if (output.length >= __velarMaxListItems) throw new RangeError("range cannot produce more than " + __velarMaxListItems + " items");
    output.push(value); const next = value + step;
    if (next === value) throw new RangeError("range step is too small to advance at this magnitude");
    value = next;
  } else for (let value = start; value > stop;) {
    if (output.length >= __velarMaxListItems) throw new RangeError("range cannot produce more than " + __velarMaxListItems + " items");
    output.push(value); const next = value + step;
    if (next === value) throw new RangeError("range step is too small to advance at this magnitude");
    value = next;
  }
  return output;
}

export function enumerate(values, start = 0) {
  values = requireList(values, "enumerate");
  if (!Number.isSafeInteger(start) || (values.length > 0 && !Number.isSafeInteger(start + values.length - 1))) throw new RangeError("enumerate indexes must be safe integers");
  return values.map((value, index) => Object.freeze({ index: start + index, value }));
}

export function zip(left, right) {
  left = requireList(left, "zip"); right = requireList(right, "zip");
  const length = Math.min(left.length, right.length);
  return Array.from({ length }, (_, index) => Object.freeze({ first: left[index], second: right[index] }));
}

export function unique(values) { return [...new Set(requireList(values, "unique"))]; }

export function chunk(values, size) {
  values = requireList(values, "chunk"); requireCount(size, "chunk size", true);
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

export function flatten(values) {
  values = requireList(values, "flatten");
  const output = [];
  for (const value of values) {
    const nested = requireList(value, "flatten");
    if (output.length + nested.length > __velarMaxListItems) throw new RangeError("flatten cannot produce more than " + __velarMaxListItems + " items");
    for (const item of nested) output.push(item);
  }
  return output;
}

export function compact(values) { return requireList(values, "compact").filter((value) => value != null); }
export function reversed(values) { return requireList(values, "reversed").slice().reverse(); }
export function take(values, count) { return requireList(values, "take").slice(0, requireCount(count, "take count")); }
export function drop(values, count) { return requireList(values, "drop").slice(requireCount(count, "drop count")); }
export function first(values) { values = requireList(values, "first"); return values.length ? values[0] : null; }
export function last(values) { values = requireList(values, "last"); return values.length ? values[values.length - 1] : null; }
export function find(values, callback) { return requireList(values, "find").find((value) => predicate(callback, value, "find")) ?? null; }
export function index(values, item) { const position = requireList(values, "index").findIndex((value) => value === item || Object.is(value, item)); return position < 0 ? null : position; }
export function has(values, value) { return requireList(values, "has").some((item) => item === value || Object.is(item, value)); }
export function count(values, value) { return requireList(values, "count").reduce((total, item) => total + (item === value || Object.is(item, value) ? 1 : 0), 0); }
export function some(values, callback) { return requireList(values, "some").some((value) => predicate(callback, value, "some")); }
export function every(values, callback) { return requireList(values, "every").every((value) => predicate(callback, value, "every")); }

export function partition(values, callback) {
  values = requireList(values, "partition");
  const matches = [], rest = [];
  for (const value of values) (predicate(callback, value, "partition") ? matches : rest).push(value);
  return Object.freeze({ matches, rest });
}

export function groupBy(values, key) {
  values = requireList(values, "groupBy");
  requireCallback(key, "groupBy");
  const output = new Map();
  for (const value of values) {
    const name = key(value) ?? null;
    const group = output.get(name);
    if (group) group.push(value); else output.set(name, [value]);
  }
  return output;
}

export function keyBy(values, key) {
  values = requireList(values, "keyBy");
  requireCallback(key, "keyBy");
  return new Map(values.map((value) => [key(value) ?? null, value]));
}

export function countBy(values, key) {
  values = requireList(values, "countBy");
  requireCallback(key, "countBy");
  const output = new Map();
  for (const value of values) { const name = key(value) ?? null; output.set(name, (output.get(name) || 0) + 1); }
  return output;
}

export function sortBy(values, key, descending = false) {
  values = requireList(values, "sortBy"); requireCallback(key, "sortBy");
  if (typeof descending !== "boolean") throw new TypeError("sortBy descending must be bool");
  let keyType = null;
  return values.map((value, index) => {
    const result = key(value);
    const type = comparable(result, "sortBy", keyType);
    if (keyType === null) keyType = type;
    return { value, index, key: result };
  }).sort((left, right) => {
    const order = left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
    return order === 0 ? left.index - right.index : descending ? -order : order;
  }).map((item) => item.value);
}

function extremeBy(values, key, direction, name) {
  values = requireList(values, name); requireCallback(key, name);
  if (!values.length) return null;
  let selected = values[0], selectedKey = key(selected), keyType = comparable(selectedKey, name);
  for (let index = 1; index < values.length; index += 1) {
    const candidate = key(values[index]);
    comparable(candidate, name, keyType);
    if ((direction < 0 && candidate < selectedKey) || (direction > 0 && candidate > selectedKey)) {
      selected = values[index]; selectedKey = candidate;
    }
  }
  return selected;
}

export function minBy(values, key) { return extremeBy(values, key, -1, "minBy"); }
export function maxBy(values, key) { return extremeBy(values, key, 1, "maxBy"); }
export function sum(values) { return requireList(values, "sum").reduce((total, value) => { if (typeof value !== "number") throw new TypeError("sum requires numbers"); return total + value; }, 0); }
export function join(values, separator = "") { if (typeof separator !== "string") throw new TypeError("join separator must be a string"); return requireList(values, "join").map((value) => { if (typeof value !== "string") throw new TypeError("join requires strings"); return value; }).join(separator); }
export function repeat(value, count) { count = requireCount(count, "repeat count"); if (count > __velarMaxListItems) throw new RangeError("repeat cannot produce more than " + __velarMaxListItems + " items"); return Array.from({ length: count }, () => value); }
`.trimStart()],
  ["velar/text", String.raw`
const maxTextCodeUnits = 16 * 1024 * 1024;
const maxTextItems = 1000000;
function valueOf(value) { if (typeof value !== "string") throw new TypeError("velar/text requires strings"); if (value.length > maxTextCodeUnits) throw new RangeError("velar/text strings cannot exceed 16 MiB"); return value; }
function textOutput(value, name) { if (value.length > maxTextCodeUnits) throw new RangeError(name + " output cannot exceed 16 MiB"); return value; }
function textCount(value, name) { if (!Number.isSafeInteger(value) || value < 0 || value > maxTextCodeUnits) throw new RangeError(name + " must be an integer from 0 through " + maxTextCodeUnits); return value; }
function textList(values, name) { if (values.length > maxTextItems) throw new RangeError(name + " cannot produce more than " + maxTextItems + " items"); return values; }
function codePointLength(value) { let length = 0; for (const _ of value) length += 1; return length; }
function codePointPrefix(value, count) { let output = "", length = 0; for (const character of value) { if (length >= count) break; output += character; length += 1; } return output; }
function patternOptions(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new TypeError("text pattern options must be a record");
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("text pattern options cannot contain symbol fields");
  const allowed = new Set(["ignoreCase", "multiline", "dotAll"]);
  for (const name of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Text pattern option '" + name + "' must be an enumerable data field");
    if (!allowed.has(name)) throw new TypeError("Unknown text pattern option '" + name + "'");
    const option = descriptor.value;
    if (option != null && typeof option !== "boolean") throw new TypeError("Text pattern option '" + name + "' must be bool");
  }
  return value;
}
function patternOf(expression, options, global = false) {
  expression = valueOf(expression); options = patternOptions(options);
  if (expression.length > 4096) throw new RangeError("text patterns cannot exceed 4096 code units");
  let flags = "u";
  if (global) flags += "g";
  if (options.ignoreCase === true) flags += "i";
  if (options.multiline === true) flags += "m";
  if (options.dotAll === true) flags += "s";
  try { return new RegExp(expression, flags); }
  catch (error) { throw new TypeError("Invalid text pattern: " + (error instanceof Error ? error.message : String(error))); }
}
function matchValue(match) {
  return Object.freeze({ value: match[0], index: match.index, groups: match.slice(1).map((value) => value === undefined ? null : value) });
}
export function trim(value) { return valueOf(value).trim(); }
export function trimStart(value) { return valueOf(value).trimStart(); }
export function trimEnd(value) { return valueOf(value).trimEnd(); }
export function lower(value) { return textOutput(valueOf(value).toLowerCase(), "lower"); }
export function upper(value) { return textOutput(valueOf(value).toUpperCase(), "upper"); }
export function capitalize(value) { value = valueOf(value); if (!value) return ""; const first = String.fromCodePoint(value.codePointAt(0)); return textOutput(first.toUpperCase() + value.slice(first.length).toLowerCase(), "capitalize"); }
export function title(value) { return textOutput(valueOf(value).toLowerCase().replace(/[_\-/]+/gu, " ").replace(/(^|\s)([\p{L}\p{N}])/gu, (_, before, char) => before + char.toUpperCase()), "title"); }
export function startsWith(value, prefix) { return valueOf(value).startsWith(valueOf(prefix)); }
export function endsWith(value, suffix) { return valueOf(value).endsWith(valueOf(suffix)); }
export function includes(value, part) { return valueOf(value).includes(valueOf(part)); }
export function split(value, separator) { value = valueOf(value); separator = valueOf(separator); if (!separator && value.length > maxTextItems) throw new RangeError("split cannot produce more than " + maxTextItems + " items"); const result = value.split(separator, maxTextItems + 1); return textList(result, "split"); }
export function replace(value, search, replacement) { return textOutput(valueOf(value).replace(valueOf(search), valueOf(replacement)), "replace"); }
export function replaceAll(value, search, replacement) { value = valueOf(value); search = valueOf(search); replacement = valueOf(replacement); const matches = search ? Math.floor((value.length - value.replaceAll(search, "").length) / search.length) : value.length + 1; const estimated = value.length + matches * (replacement.length - search.length); if (!Number.isSafeInteger(estimated) || estimated > maxTextCodeUnits) throw new RangeError("replaceAll output cannot exceed 16 MiB"); return value.replaceAll(search, replacement); }
export function repeat(value, count) { value = valueOf(value); count = textCount(count, "text.repeat count"); if (value.length > 0 && count > Math.floor(maxTextCodeUnits / value.length)) throw new RangeError("text.repeat output cannot exceed 16 MiB"); return value.repeat(count); }
export function padStart(value, length, fill = " ") { return valueOf(value).padStart(textCount(length, "padStart length"), valueOf(fill)); }
export function padEnd(value, length, fill = " ") { return valueOf(value).padEnd(textCount(length, "padEnd length"), valueOf(fill)); }
export function lines(value) { return textList(valueOf(value).split(/\r?\n/u, maxTextItems + 1), "lines"); }
export function words(value) { const cleaned = valueOf(value).trim(); return cleaned ? textList(cleaned.split(/\s+/u, maxTextItems + 1), "words") : []; }
export function slug(value) { return textOutput(valueOf(value).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/gu, ""), "slug"); }
export function truncate(value, length, suffix = "…") { value = valueOf(value); suffix = valueOf(suffix); length = textCount(length, "truncate length"); const valueLength = codePointLength(value); if (valueLength <= length) return value; const suffixLength = codePointLength(suffix); if (suffixLength >= length) return codePointPrefix(suffix, length); return codePointPrefix(value, length - suffixLength) + suffix; }
export function indent(value, prefix = "    ") { return textOutput(lines(valueOf(value)).map((line) => valueOf(prefix) + line).join("\n"), "indent"); }
export function dedent(value) { const rows = lines(valueOf(value)); let width = null; for (const line of rows) if (line.trim()) { const current = line.match(/^[ \t]*/u)[0].length; width = width === null ? current : Math.min(width, current); } return rows.map((line) => line.slice(width ?? 0)).join("\n"); }
export function normalizeWhitespace(value) { return valueOf(value).trim().replace(/\s+/gu, " "); }
export function isBlank(value) { return valueOf(value).trim().length === 0; }
export function escapeHtml(value) { return textOutput(valueOf(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"), "escapeHtml"); }
export function matches(value, expression, options = {}) { return patternOf(expression, options).test(valueOf(value)); }
export function findMatch(value, expression, options = {}) { const match = patternOf(expression, options).exec(valueOf(value)); return match ? matchValue(match) : null; }
export function findMatches(value, expression, options = {}) { const output = []; for (const match of valueOf(value).matchAll(patternOf(expression, options, true))) { if (output.length >= maxTextItems) throw new RangeError("findMatches cannot produce more than " + maxTextItems + " items"); output.push(matchValue(match)); } return output; }
export function replaceMatches(value, expression, replacement, options = {}) { return textOutput(valueOf(value).replace(patternOf(expression, options, true), () => valueOf(replacement)), "replaceMatches"); }
export function splitPattern(value, expression, options = {}) {
  value = valueOf(value); const output = []; let end = 0;
  for (const match of value.matchAll(patternOf(expression, options, true))) { if (output.length >= maxTextItems) throw new RangeError("splitPattern cannot produce more than " + maxTextItems + " items"); output.push(value.slice(end, match.index)); end = match.index + match[0].length; }
  output.push(value.slice(end)); return output;
}
`.trimStart()],
  ["velar/math", String.raw`
function requireNumber(value, name) { if (typeof value !== "number") throw new TypeError(name + " requires numbers"); return value; }
function unary(value, operation, name) { return operation(requireNumber(value, name)); }
function binary(left, right, operation, name) { return operation(requireNumber(left, name), requireNumber(right, name)); }
export const pi = Math.PI;
export const e = Math.E;
export const tau = Math.PI * 2;
export const infinity = Number.POSITIVE_INFINITY;
export function abs(value) { return unary(value, Math.abs, "abs"); }
export function min(...values) { if (!values.length) throw new RangeError("min requires at least one number"); let result = requireNumber(values[0], "min"); for (let index = 1; index < values.length; index += 1) result = Math.min(result, requireNumber(values[index], "min")); return result; }
export function max(...values) { if (!values.length) throw new RangeError("max requires at least one number"); let result = requireNumber(values[0], "max"); for (let index = 1; index < values.length; index += 1) result = Math.max(result, requireNumber(values[index], "max")); return result; }
export function clamp(value, minimum, maximum) { value = requireNumber(value, "clamp"); minimum = requireNumber(minimum, "clamp"); maximum = requireNumber(maximum, "clamp"); if (minimum > maximum) throw new RangeError("clamp minimum cannot exceed maximum"); return Math.min(maximum, Math.max(minimum, value)); }
export function sign(value) { return unary(value, Math.sign, "sign"); }
export function round(value, digits = 0) {
  value = requireNumber(value, "round");
  if (!Number.isSafeInteger(digits) || digits < -308 || digits > 308) throw new RangeError("round digits must be an integer from -308 through 308");
  if (!Number.isFinite(value) || digits === 0) return Math.round(value);
  const [coefficient, exponent = "0"] = value.toString().split("e");
  const shifted = Math.round(Number(coefficient + "e" + (Number(exponent) + digits)));
  if (!Number.isFinite(shifted)) return value;
  const [rounded, roundedExponent = "0"] = shifted.toString().split("e");
  return Number(rounded + "e" + (Number(roundedExponent) - digits));
}
export function floor(value) { return unary(value, Math.floor, "floor"); }
export function ceil(value) { return unary(value, Math.ceil, "ceil"); }
export function trunc(value) { return unary(value, Math.trunc, "trunc"); }
export function sqrt(value) { return unary(value, Math.sqrt, "sqrt"); }
export function cbrt(value) { return unary(value, Math.cbrt, "cbrt"); }
export function pow(left, right) { return binary(left, right, Math.pow, "pow"); }
export function exp(value) { return unary(value, Math.exp, "exp"); }
export function log(value, base = Math.E) { return Math.log(requireNumber(value, "log")) / Math.log(requireNumber(base, "log")); }
export function log2(value) { return unary(value, Math.log2, "log2"); }
export function log10(value) { return unary(value, Math.log10, "log10"); }
export function sin(value) { return unary(value, Math.sin, "sin"); }
export function cos(value) { return unary(value, Math.cos, "cos"); }
export function tan(value) { return unary(value, Math.tan, "tan"); }
export function asin(value) { return unary(value, Math.asin, "asin"); }
export function acos(value) { return unary(value, Math.acos, "acos"); }
export function atan(value) { return unary(value, Math.atan, "atan"); }
export function atan2(left, right) { return binary(left, right, Math.atan2, "atan2"); }
export function degrees(value) { return requireNumber(value, "degrees") * 180 / Math.PI; }
export function radians(value) { return requireNumber(value, "radians") * Math.PI / 180; }
export function hypot(left, right) { return binary(left, right, Math.hypot, "hypot"); }
export const random = Math.random;
export function randomInt(minimum, maximum = null) { if (maximum === null) { maximum = minimum; minimum = 0; } const width = maximum - minimum; if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || !Number.isSafeInteger(width) || width <= 0) throw new RangeError("randomInt requires an increasing safe-integer range"); return Math.floor(Math.random() * width) + minimum; }
export const isFinite = Number.isFinite;
export const isInteger = Number.isInteger;
export function gcd(left, right) { if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new TypeError("gcd requires safe integers"); left = Math.abs(left); right = Math.abs(right); while (right) [left, right] = [right, left % right]; return left; }
export function lcm(left, right) { if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) throw new TypeError("lcm requires safe integers"); if (left === 0 || right === 0) return 0; const result = Math.abs((left / gcd(left, right)) * right); if (!Number.isSafeInteger(result)) throw new RangeError("lcm result is outside the safe-integer range"); return result; }
`.trimStart()],
  ["velar/json", String.raw`
${strictJsonRuntime}
${deepEqualRuntime}
${runtimeTypeRuntime}
function runtimeType(Type) { return __velarRequireRuntimeType(Type, "JSON validation", true); }
function validate(value, Type) { Type = runtimeType(Type); return Type ? Type.parse(value) : value; }
export function parse(text, Type = null) { if (typeof text !== "string") throw new TypeError("json.parse requires a string"); Type = runtimeType(Type); if (text.length > __velarMaxJsonCodeUnits) throw new RangeError("JSON text cannot exceed 16 MiB"); const value = JSON.parse(text); __velarAssertJson(value); return Type ? Type.parse(value) : value; }
export function tryParse(text, Type = null, fallback = null) { Type = runtimeType(Type); try { return parse(text, Type); } catch { return fallback; } }
export function stringify(value, pretty = false) { return __velarJsonStringify(value, pretty); }
function sorted(value) { if (value === null || typeof value !== "object") return value; if (Array.isArray(value)) return value.map(sorted); const result = Object.create(null); for (const key of Object.keys(value).sort()) result[key] = sorted(value[key]); return result; }
export function stableStringify(value, pretty = false) { __velarAssertJson(value); return __velarJsonStringify(sorted(value), pretty); }
export function clone(value, Type = null) { Type = runtimeType(Type); const cloned = JSON.parse(__velarJsonStringify(value)); return Type ? Type.parse(cloned) : cloned; }
export function isSerializable(value) { try { __velarAssertJson(value); return true; } catch { return false; } }
export function deepEqual(left, right) { return __velarDeepEqual(left, right); }
`.trimStart()],
  ["velar/async", String.raw`
${listRuntime}
const __velarMaxTimerMilliseconds = 2147483647;
const __velarMaxAsyncFanout = 10000;
function asyncFanout(values, name) { values = __velarRequireList(values, name); if (values.length > __velarMaxAsyncFanout) throw new RangeError(name + " cannot start more than 10000 operations at once"); return values; }
export function sleep(milliseconds) { if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > __velarMaxTimerMilliseconds) throw new RangeError("sleep requires milliseconds from 0 through 2147483647"); return new Promise((resolve) => setTimeout(() => resolve(null), milliseconds)); }
function normalize(value) { return value === undefined ? null : value; }
export async function all(values) { return (await Promise.all(asyncFanout(values, "async.all"))).map(normalize); }
export async function race(values) { return normalize(await Promise.race(asyncFanout(values, "async.race"))); }
export async function timeout(value, milliseconds, message = "Operation timed out") { if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > __velarMaxTimerMilliseconds) throw new RangeError("timeout requires milliseconds from 0 through 2147483647"); if (typeof message !== "string") throw new TypeError("timeout message must be a string"); if (message.length > 65536) throw new RangeError("timeout messages cannot exceed 64 KiB"); let timer; try { return normalize(await Promise.race([value, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })])); } finally { clearTimeout(timer); } }
export async function retry(task, attempts = 3) { if (typeof task !== "function") throw new TypeError("retry requires a function"); if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10000) throw new RangeError("retry attempts must be an integer from 1 through 10000"); let last; for (let attempt = 0; attempt < attempts; attempt += 1) { try { return normalize(await task()); } catch (error) { last = error; } } throw last; }
export async function map(values, worker, concurrency = 4) { values = __velarRequireList(values, "async.map"); if (typeof worker !== "function") throw new TypeError("async.map requires a worker"); if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 1024) throw new RangeError("async.map concurrency must be an integer from 1 through 1024"); const output = new Array(values.length); let cursor = 0; async function run() { while (true) { const index = cursor++; if (index >= values.length) return; output[index] = normalize(await worker(values[index])); } } await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run)); return output; }
export async function series(tasks) { tasks = __velarRequireList(tasks, "async.series"); if (tasks.some((task) => typeof task !== "function")) throw new TypeError("series requires a List of functions"); const output = []; for (const task of tasks) output.push(normalize(await task())); return output; }
`.trimStart()],
  ["velar/url", String.raw`
${listRuntime}
const fallbackBase = "https://velar.invalid/";
function urlText(value, name = "velar/url") { if (typeof value !== "string") throw new TypeError(name + " requires a string"); if (value.length > 2 * 1024 * 1024) throw new RangeError(name + " cannot exceed 2 MiB"); return value; }
function baseOf(base) { return base ? urlText(base, "URL base") : (typeof location !== "undefined" ? location.href : fallbackBase); }
function urlOf(value, base = "") { return new URL(urlText(value), baseOf(base)); }
function restore(original, url) { const output = /^[a-z][a-z\d+.-]*:/iu.test(original) ? url.href : original.startsWith("//") ? "//" + url.host + url.pathname + url.search + url.hash : url.pathname + url.search + url.hash; return urlText(output, "URL output"); }
function queryMap(search, name) {
  const output = new Map();
  let count = 0;
  for (const [key, value] of new URLSearchParams(search)) {
    count += 1;
    if (count > 100000) throw new RangeError(name + " cannot exceed 100000 fields");
    output.set(key, value);
  }
  return output;
}
function appendQueryValue(output, name, value, budget) {
  if (value == null) return;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new TypeError("URL query value '" + name + "' must be a string, number, bool, null, or List of those values");
  const text = String(value);
  budget.units += (name.length + text.length) * 9 + 2;
  if (budget.units > 2 * 1024 * 1024) throw new RangeError("URL query output cannot exceed 2 MiB");
  output.append(name, text);
}
function appendParams(params, output) {
  let entries;
  let entryCount;
  let mapSize = null;
  try { mapSize = Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(params); } catch {}
  if (mapSize !== null) {
    entryCount = mapSize;
    entries = Map.prototype.entries.call(params);
  } else if (params && typeof params === "object" && !Array.isArray(params)
    && (Object.getPrototypeOf(params) === Object.prototype || Object.getPrototypeOf(params) === null)
    && Object.getOwnPropertySymbols(params).length === 0) {
    const names = Object.getOwnPropertyNames(params);
    const values = [];
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(params, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("URL query record fields must be enumerable data values");
      values.push([name, descriptor.value]);
    }
    entryCount = values.length;
    entries = values;
  } else throw new TypeError("URL query values require a Map or record");
  if (entryCount > 100000) throw new RangeError("URL query values cannot exceed 100000 fields");
  const budget = { units: 0 };
  for (const [name, value] of entries) {
    if (typeof name !== "string") throw new TypeError("URL query names must be strings");
    if (Array.isArray(value)) for (const item of __velarRequireList(value, "URL query list")) appendQueryValue(output, name, item, budget);
    else appendQueryValue(output, name, value, budget);
  }
}
export function parse(value, base = "") { const url = urlOf(value, base); return Object.freeze({ href: url.href, protocol: url.protocol, host: url.host, hostname: url.hostname, port: url.port, path: url.pathname, query: queryMap(url.search, "URL query"), hash: url.hash, origin: url.origin }); }
export function join(...parts) {
  if (!parts.length) throw new RangeError("url.join requires at least one part");
  let output = urlText(parts[0], "url.join");
  for (const part of parts.slice(1)) {
    const value = urlText(part, "url.join");
    if (!value) continue;
    const segment = value.replace(/^\/+|\/+$/gu, "");
    output = output.endsWith("://") ? output + segment : output.replace(/\/+$/u, "") + "/" + segment;
  }
  return urlText(output, "url.join output");
}
export function query(params) { const output = new URLSearchParams(); appendParams(params, output); return urlText(output.toString(), "URL query output"); }
export function parseQuery(value) { return queryMap(urlText(value, "parseQuery").replace(/^\?/u, ""), "URL query"); }
export function withQuery(value, params) { const url = urlOf(value); url.search = ""; appendParams(params, url.searchParams); return restore(value, url); }
export function withHash(value, hash) { const url = urlOf(value); hash = urlText(hash, "withHash"); url.hash = hash ? "#" + hash.replace(/^#/u, "") : ""; return restore(value, url); }
export function isExternal(value, base = "") { value = urlText(value, "isExternal"); if (base) urlText(base, "URL base"); try { const url = urlOf(value, base); const origin = new URL(baseOf(base)).origin; return url.origin !== origin || !/^https?:$/u.test(url.protocol); } catch { return true; } }
export function encode(value) { return encodeURIComponent(urlText(value, "encode")); }
export function decode(value) { return decodeURIComponent(urlText(value, "decode")); }
export function normalize(value, base = "") { const url = urlOf(value, base); return restore(value, url); }
`.trimStart()],
  ["velar/time", String.raw`
function valid(value) { if (!Number.isFinite(value)) throw new TypeError("velar/time requires a finite timestamp"); return value; }
function timeText(value, name) { if (typeof value !== "string") throw new TypeError(name + " must be a string"); if (value.length > 1024) throw new RangeError(name + " cannot exceed 1024 characters"); return value; }
function calendarParts(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  for (const value of [year, month, day, hour, minute, second, millisecond]) if (!Number.isInteger(value)) throw new TypeError("velar/time date parts must be integers");
  if (year < 0 || year > 9999) throw new RangeError("velar/time year must be from 0 through 9999");
  if (month < 1 || month > 12) throw new RangeError("velar/time month must be from 1 through 12");
  if (day < 1 || day > 31) throw new RangeError("velar/time day is outside the selected month");
  if (hour < 0 || hour > 23) throw new RangeError("velar/time hour must be from 0 through 23");
  if (minute < 0 || minute > 59 || second < 0 || second > 59) throw new RangeError("velar/time minute and second must be from 0 through 59");
  if (millisecond < 0 || millisecond > 999) throw new RangeError("velar/time millisecond must be from 0 through 999");
  return [year, month, day, hour, minute, second, millisecond];
}
function build(utc, year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  calendarParts(year, month, day, hour, minute, second, millisecond);
  const value = new Date(0);
  if (utc) {
    value.setUTCFullYear(year, month - 1, day);
    value.setUTCHours(hour, minute, second, millisecond);
    if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day
      || value.getUTCHours() !== hour || value.getUTCMinutes() !== minute || value.getUTCSeconds() !== second || value.getUTCMilliseconds() !== millisecond) {
      throw new RangeError("velar/time date parts do not form a real UTC date");
    }
  } else {
    value.setFullYear(year, month - 1, day);
    value.setHours(hour, minute, second, millisecond);
    if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day
      || value.getHours() !== hour || value.getMinutes() !== minute || value.getSeconds() !== second || value.getMilliseconds() !== millisecond) {
      throw new RangeError("velar/time date parts do not form a real local date");
    }
  }
  return valid(value.getTime());
}
export function now() { return Date.now(); }
export function monotonic() { return typeof performance === "undefined" ? Date.now() : performance.now(); }
export function parse(value) {
  if (typeof value !== "string") throw new TypeError("velar/time parse requires an ISO string");
  if (value.length > 64) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/u.exec(value);
  if (!match) return null;
  try {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    if (!match[4]) return build(true, year, month, day);
    const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6] || 0);
    const millisecond = Number((match[7] || "").padEnd(3, "0") || 0);
    const zone = match[8];
    let offset = 0;
    if (zone !== "Z") {
      const sign = zone[0] === "+" ? 1 : -1;
      const offsetHour = Number(zone.slice(1, 3)), offsetMinute = Number(zone.slice(4, 6));
      if (offsetHour > 23 || offsetMinute > 59) return null;
      offset = sign * (offsetHour * 60 + offsetMinute);
    }
    return build(true, year, month, day, hour, minute, second, millisecond) - offset * 60_000;
  } catch { return null; }
}
export function iso(value = Date.now()) { return new Date(valid(value)).toISOString(); }
export function format(value, locale = "", timeZone = "") { locale = timeText(locale, "Time locale"); timeZone = timeText(timeZone, "Time zone"); return new Intl.DateTimeFormat(locale || undefined, timeZone ? { dateStyle: "medium", timeStyle: "medium", timeZone } : { dateStyle: "medium", timeStyle: "medium" }).format(new Date(valid(value))); }
export function date(year, month, day, hour = 0, minute = 0, second = 0) { return build(false, year, month, day, hour, minute, second); }
export function utc(year, month, day, hour = 0, minute = 0, second = 0) { return build(true, year, month, day, hour, minute, second); }
export function parts(value, timeZone = "") {
  const date = new Date(valid(value));
  timeZone = timeText(timeZone, "Time zone");
  if (!timeZone) return Object.freeze({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), weekday: date.getDay(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(), millisecond: date.getMilliseconds() });
  const entries = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  const weekdays = new Map([["Sun", 0], ["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6]]);
  return Object.freeze({ year: Number(entries.year), month: Number(entries.month), day: Number(entries.day), weekday: weekdays.get(entries.weekday) ?? 0, hour: Number(entries.hour), minute: Number(entries.minute), second: Number(entries.second), millisecond: date.getUTCMilliseconds() });
}
`.trimStart()],
  ["velar/id", String.raw`
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function uuid() {
  const source = globalThis.crypto;
  if (!source || typeof source.randomUUID !== "function") throw new Error("Secure UUID generation is unavailable in this JavaScript host");
  const value = source.randomUUID();
  if (!isUuid(value)) throw new Error("Secure UUID generation returned an invalid UUID");
  return value;
}

export function isUuid(value) {
  return typeof value === "string" && value.length === 36 && uuidPattern.test(value);
}
  `.trimStart()],
  ["velar/log", String.raw`
${VELAR_ERROR_NORMALIZATION_RUNTIME}
const ranks = new Map([["debug", 10], ["info", 20], ["warn", 30], ["error", 40], ["silent", 100]]);
let threshold = "info";
const sinks = new Set();
const maxLogFields = 1000;
const maxLogSinks = 1000;

function logText(value, name, maximum = 65536) { if (typeof value !== "string") throw new TypeError(name + " must be a string"); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }

function fieldsOf(value) {
  if (value == null) return new Map();
  let size;
  try { size = Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(value); }
  catch { throw new TypeError("VelarScript log fields must be a Map"); }
  if (size > maxLogFields) throw new RangeError("VelarScript log fields cannot exceed 1000 entries");
  const fields = new Map();
  for (const [key, field] of Map.prototype.entries.call(value)) {
    if (typeof key !== "string") throw new TypeError("VelarScript log field names must be strings");
    if (key.length > 1024) throw new RangeError("VelarScript log field names cannot exceed 1024 characters");
    fields.set(key, field);
  }
  return fields;
}

function defaultSink(record) {
  const target = globalThis.console;
  if (!target) return;
  const write = typeof target[record.level] === "function" ? target[record.level] : target.log;
  write.call(target, record.scope ? "[" + record.scope + "] " + record.message : record.message, Object.fromEntries(record.fields), record.error || "");
}

function sinkFailure(value) {
  const error = __velarNormalizeError(value);
  defaultSink(Object.freeze({ timestamp: Date.now(), level: "error", scope: "velar/log", message: "Log sink failed", fields: new Map(), error }));
}

function emit(scope, level, message, fields, error = null) {
  message = logText(message, "Log message");
  fields = fieldsOf(fields);
  if (error != null && !Error.isError(error)) throw new TypeError("Logger error must be an Error");
  if ((ranks.get(level) ?? 100) < (ranks.get(threshold) ?? 20)) return null;
  const record = Object.freeze({ timestamp: Date.now(), level, scope, message, fields, error });
  if (!sinks.size) defaultSink(record);
  else for (const sink of sinks) {
    try {
      const delivered = Object.freeze({ ...record, fields: new Map(record.fields) });
      const result = sink(delivered);
      if (result && typeof result.then === "function") result.catch(sinkFailure);
    } catch (failure) { sinkFailure(failure); }
  }
  return null;
}

function createLogger(scope, base = new Map()) {
  const context = fieldsOf(base);
  const merged = (fields) => {
    const output = new Map(context);
    for (const [key, value] of fieldsOf(fields)) {
      if (!output.has(key) && output.size >= maxLogFields) throw new RangeError("Merged log fields cannot exceed 1000 entries");
      output.set(key, value);
    }
    return output;
  };
  return Object.freeze({
    debug(message, fields = new Map()) { return emit(scope, "debug", message, merged(fields)); },
    info(message, fields = new Map()) { return emit(scope, "info", message, merged(fields)); },
    warn(message, fields = new Map()) { return emit(scope, "warn", message, merged(fields)); },
    error(message, error = null, fields = new Map()) { return emit(scope, "error", message, merged(fields), error); },
  });
}

export const log = createLogger("");
export function logger(scope, fields = new Map()) {
  const name = logText(scope, "Logger scope", 1024).trim();
  if (!name) throw new TypeError("A VelarScript logger requires a non-empty scope");
  return createLogger(name, fields);
}
export function level() { return threshold; }
export function setLevel(value) {
  const next = logText(value, "Log level").toLowerCase();
  if (!ranks.has(next)) throw new TypeError("Log level must be debug, info, warn, error, or silent");
  threshold = next;
  return null;
}
export function useSink(sink) {
  if (typeof sink !== "function") throw new TypeError("A VelarScript log sink must be callable");
  if (!sinks.has(sink) && sinks.size >= maxLogSinks) throw new RangeError("VelarScript logging cannot install more than 1000 sinks");
  sinks.add(sink);
  return () => { sinks.delete(sink); return null; };
}
`.trimStart()],
  ["velar/test", String.raw`
${deepEqualRuntime}
function display(value, active = new WeakSet()) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value !== "object") return String(value);
  if (active.has(value)) return "[cycle]";
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (!__velarDenseList(value)) return "[invalid List]";
      const items = [];
      for (let index = 0; index < value.length; index += 1) items.push(display(Object.getOwnPropertyDescriptor(value, index).value, active));
      return "[" + items.join(", ") + "]";
    }
    if (__velarMapSize(value) !== null) {
      const items = [];
      for (const [key, item] of Map.prototype.entries.call(value)) items.push(display(key, active) + " => " + display(item, active));
      return "Map(" + items.join(", ") + ")";
    }
    if (__velarSetSize(value) !== null) {
      const items = [];
      for (const item of Set.prototype.values.call(value)) items.push(display(item, active));
      return "Set(" + items.join(", ") + ")";
    }
    const keys = __velarDataRecordKeys(value);
    if (keys) return "{" + keys.map((key) => JSON.stringify(key) + ": " + display(Object.getOwnPropertyDescriptor(value, key).value, active)).join(", ") + "}";
    const prototype = Object.getPrototypeOf(value);
    const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
    return "[" + (typeof constructor === "function" && constructor.name ? constructor.name : "object") + "]";
  } finally {
    active.delete(value);
  }
}
export function expect(actual) {
  return Object.freeze({
    toBe(expected) { if (actual !== expected) throw new Error("Expected " + display(actual) + " to be " + display(expected)); },
    toEqual(expected) { if (!__velarDeepEqual(actual, expected)) throw new Error("Expected " + display(actual) + " to deeply equal " + display(expected)); },
    toBeTruthy() { if (actual !== true) throw new Error("Expected bool true but received " + display(actual)); },
    toBeFalsy() { if (actual !== false) throw new Error("Expected bool false but received " + display(actual)); },
    toContain(expected) {
      let contains = typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
      if (Array.isArray(actual) && __velarDenseList(actual)) {
        contains = false;
        for (let index = 0; index < actual.length; index += 1) {
          if (Object.getOwnPropertyDescriptor(actual, index).value === expected) { contains = true; break; }
        }
      }
      if (!contains) throw new Error("Expected " + display(actual) + " to contain " + display(expected));
    },
    toMatch(expected) {
      if (typeof actual !== "string" || typeof expected !== "string") throw new TypeError("toMatch requires text and a string pattern");
      let pattern;
      try { pattern = new RegExp(expected, "u"); } catch (error) { throw new TypeError("Invalid toMatch pattern: " + (error instanceof Error ? error.message : String(error))); }
      if (!pattern.test(actual)) throw new Error("Expected " + display(actual) + " to match " + display(expected));
    },
    toHaveLength(expected) {
      if (!Number.isSafeInteger(expected) || expected < 0) throw new RangeError("Expected length must be a non-negative safe integer");
      const length = typeof actual === "string" ? actual.length : Array.isArray(actual) && __velarDenseList(actual) ? actual.length : null;
      if (length === null) throw new TypeError("toHaveLength requires text or a dense List");
      if (length !== expected) throw new Error("Expected length " + expected + " but received " + length);
    },
    toThrow() {
      if (typeof actual !== "function") throw new TypeError("toThrow requires a function");
      let threw = false; try { actual(); } catch { threw = true; }
      if (!threw) throw new Error("Expected function to throw");
    },
    async toReject() {
      let result;
      if (typeof actual === "function") {
        try { result = actual(); }
        catch (error) { throw new Error("Expected function to return a rejecting Promise, but it threw synchronously: " + display(error)); }
      } else result = actual;
      if (!result || typeof result.then !== "function") throw new TypeError("toReject requires a Promise or a function returning one");
      try { await result; } catch { return null; }
      throw new Error("Expected Promise to reject");
    },
  });
}
`.trimStart()],
]);

export function standardModuleSources(extensions: readonly CompilerExtension[] = []): ReadonlyMap<string, string> {
  return new Map([
    ...coreModuleSources,
    ...extensions.flatMap((extension) => extension.modules ? [...extension.modules.sources] : []),
  ]);
}

export function standardModuleRoute(source: string): string {
  return `/@velar/${source.slice("velar/".length)}.js`;
}

export interface StandardModuleApi {
  readonly standardVersion: string;
  readonly extensions: Readonly<Record<string, string>>;
  readonly modules: Readonly<Record<string, readonly string[]>>;
}

export function standardModuleApi(extensions: readonly CompilerExtension[] = []): StandardModuleApi {
  const interfaces = standardModuleInterfaces(extensions);
  return {
    standardVersion: VELAR_STANDARD_API_VERSION,
    extensions: Object.fromEntries(extensions.map((extension) => [extension.id, extension.modules?.apiVersion ?? "unknown"])),
    modules: Object.fromEntries([...interfaces].map(([source, interface_]) => [source, [...interface_.exports.keys()].sort()])),
  };
}

export function standardModuleSource(
  source: string,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): string | null {
  for (const extension of extensions) {
    const extensionConfig = projectConfig instanceof Map ? projectConfig.get(extension.id) : projectConfig;
    const framework = extension.modules?.source?.(source, extensionConfig) ?? extension.modules?.sources.get(source) ?? null;
    if (framework !== null) return framework;
  }
  return coreModuleSources.get(source) ?? null;
}
export function standardModuleAsset(
  pathname: string,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): string | null {
  const match = /^\/@velar\/([a-z-]+)\.js$/u.exec(pathname);
  return match ? standardModuleSource(`velar/${match[1]}`, projectConfig, extensions) : null;
}
