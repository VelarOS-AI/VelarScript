import { optionalOf as optional, type ClassInfo, type CompilerExtension, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import {
  VELAR_CLASS_FIELD_MODULE,
  VELAR_CLASS_FIELD_MODULE_SOURCE,
  VELAR_COLLECTION_HOST_MODULE,
  VELAR_COLLECTION_HOST_MODULE_SOURCE,
  VELAR_COLLECTION_LOWERING_DEPENDENCIES,
  VELAR_COLLECTION_LOWERING_MODULE,
  VELAR_COLLECTION_LOWERING_MODULE_SOURCE,
  VELAR_ERROR_NORMALIZATION_MODULE,
  VELAR_ERROR_NORMALIZATION_MODULE_SOURCE,
  VELAR_ERROR_NORMALIZATION_RUNTIME,
  VELAR_NARROWING_MODULE,
  VELAR_NARROWING_MODULE_SOURCE,
  VELAR_PRIMITIVE_METHOD_MODULE,
  VELAR_PRIMITIVE_METHOD_MODULE_SOURCE,
  VELAR_PROMISE_NORMALIZATION_MODULE,
  VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE,
  VELAR_REACTIVE_BRIDGE_MODULE,
  VELAR_REACTIVE_BRIDGE_MODULE_SOURCE,
  VELAR_RUNTIME_REGISTRY_KEY,
  VELAR_RUNTIME_SCHEMA_VERSION,
  TEXT_NAMESPACE_MEMBERS,
  VELAR_STRICT_JSON_RUNTIME,
  VELAR_TEXT_METHOD_RUNTIME,
  VELAR_TYPE_REGISTRY_RUNTIME,
  VELAR_TYPE_VALIDATION_MODULE,
  VELAR_TYPE_VALIDATION_MODULE_SOURCE,
  VELAR_UTF8_RUNTIME,
} from "@velarscript/compiler/extension";
import { velarNodeCompilerExtension } from "@velarscript/node/compiler";
import { VELAR_STANDARD_API_VERSION } from "./version.ts";

const anyType: ValueType = { kind: "any" };
const nullType: ValueType = { kind: "null" };
const stringType: ValueType = { kind: "string" };
const numberType: ValueType = { kind: "number" };
const boolType: ValueType = { kind: "bool" };
const durationType: ValueType = { kind: "named", name: "Duration" };

function functionType(parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameters, requiredParameters, result };
}

function apiFunction(parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameterNames, parameters, requiredParameters, result };
}

function intrinsic(name: string, parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "intrinsic", name, parameters, requiredParameters, result };
}

function apiIntrinsic(name: string, parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "intrinsic", name, parameterNames, parameters, requiredParameters, result };
}

function promise(value: ValueType): ValueType {
  return { kind: "promise", value };
}

function object(fields: Readonly<Record<string, ValueType>>): ValueType {
  return { kind: "object", fields: new Map(Object.entries(fields)) };
}

const unknownType: ValueType = { kind: "unknown" };
const errorType: ValueType = { kind: "class", name: "Error" };
const cleanupType = apiFunction([], [], nullType);
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
  debug: apiFunction(["message", "fields"], [stringType, logFieldsType], nullType, 1),
  info: apiFunction(["message", "fields"], [stringType, logFieldsType], nullType, 1),
  warn: apiFunction(["message", "fields"], [stringType, logFieldsType], nullType, 1),
  error: apiFunction(["message", "error", "fields"], [stringType, errorType, logFieldsType], nullType, 1),
});

const coreModuleInterfaces = new Map<string, ModuleInterface>([
  ["velar/collections", moduleInterface(new Map([
    ["range", apiIntrinsic("collections.range", ["start", "end", "step"], [numberType, numberType, numberType], listNumber, 1)],
    ["enumerate", apiIntrinsic("collections.enumerate", ["values", "start"], [listAny, numberType], listAny, 1)],
    ["zip", apiIntrinsic("collections.zip", ["left", "right"], [listAny, listAny], listAny)],
    ["unique", apiIntrinsic("collections.unique", ["values"], [listAny], listAny)],
    ["chunk", apiIntrinsic("collections.chunk", ["values", "size"], [listAny, numberType], listAny)],
    ["flatten", apiIntrinsic("collections.flatten", ["values"], [listAny], listAny)],
    ["compact", apiIntrinsic("collections.compact", ["values"], [listAny], listAny)],
    ["reversed", apiIntrinsic("collections.reversed", ["values"], [listAny], listAny)],
    ["take", apiIntrinsic("collections.take", ["values", "count"], [listAny, numberType], listAny)],
    ["drop", apiIntrinsic("collections.drop", ["values", "count"], [listAny, numberType], listAny)],
    ["first", apiIntrinsic("collections.first", ["values"], [listAny], anyType)],
    ["last", apiIntrinsic("collections.last", ["values"], [listAny], anyType)],
    ["find", apiIntrinsic("collections.find", ["values", "test"], [listAny, anyType], anyType)],
    ["index", apiIntrinsic("collections.index", ["values", "value"], [listAny, anyType], optional(numberType))],
    ["has", apiIntrinsic("collections.has", ["values", "value"], [listAny, anyType], boolType)],
    ["count", apiIntrinsic("collections.count", ["values", "value"], [listAny, anyType], numberType)],
    ["some", apiIntrinsic("collections.some", ["values", "test"], [listAny, anyType], boolType)],
    ["every", apiIntrinsic("collections.every", ["values", "test"], [listAny, anyType], boolType)],
    ["partition", apiIntrinsic("collections.partition", ["values", "test"], [listAny, anyType], anyType)],
    ["groupBy", apiIntrinsic("collections.groupBy", ["values", "key"], [listAny, anyType], mapAny)],
    ["keyBy", apiIntrinsic("collections.keyBy", ["values", "key"], [listAny, anyType], mapAny)],
    ["countBy", apiIntrinsic("collections.countBy", ["values", "key"], [listAny, anyType], mapAny)],
    ["sortBy", apiIntrinsic("collections.sortBy", ["values", "key", "descending"], [listAny, anyType, boolType], listAny, 2)],
    ["minBy", apiIntrinsic("collections.minBy", ["values", "key"], [listAny, anyType], anyType)],
    ["maxBy", apiIntrinsic("collections.maxBy", ["values", "key"], [listAny, anyType], anyType)],
    ["sum", apiIntrinsic("collections.sum", ["values"], [listNumber], numberType)],
    ["join", apiIntrinsic("collections.join", ["values", "separator"], [listString, stringType], stringType, 1)],
    ["repeat", apiIntrinsic("collections.repeat", ["value", "count"], [anyType, numberType], listAny)],
  ]))],
  ["velar/text", permanentNamespace(moduleInterface(new Map([
    ["trimStart", apiFunction(["value"], [stringType], stringType)],
    ["trimEnd", apiFunction(["value"], [stringType], stringType)],
    ["capitalize", apiFunction(["value"], [stringType], stringType)],
    ["title", apiFunction(["value"], [stringType], stringType)],
    ["lines", apiFunction(["value"], [stringType], listString)],
    ["lineStarts", apiFunction(["value"], [stringType], listNumber)],
    ["chunks", apiFunction(["value", "size"], [stringType, numberType], listString)],
    ["words", apiFunction(["value"], [stringType], listString)],
    ["slug", apiFunction(["value"], [stringType], stringType)],
    ["normalize", apiFunction(["value", "form"], [stringType, stringType], stringType, 1)],
    ["truncate", apiFunction(["value", "length", "suffix"], [stringType, numberType, stringType], stringType, 2)],
    ["indent", apiFunction(["value", "prefix"], [stringType, stringType], stringType, 1)],
    ["dedent", apiFunction(["value"], [stringType], stringType)],
    ["normalizeWhitespace", apiFunction(["value"], [stringType], stringType)],
    ["utf8Size", apiFunction(["value"], [stringType], numberType)],
    ["escapeHtml", apiFunction(["value"], [stringType], stringType)],
    ["codePoint", apiFunction(["value"], [stringType], optional(numberType))],
    ["fromCodePoint", apiFunction(["value"], [numberType], stringType)],
    ["matches", apiFunction(["value", "expression", "options"], [stringType, stringType, patternOptionsType], boolType, 2)],
    ["findMatch", apiFunction(["value", "expression", "options"], [stringType, stringType, patternOptionsType], optional(textMatchType), 2)],
    ["findMatches", apiFunction(["value", "expression", "options"], [stringType, stringType, patternOptionsType], textMatchArrayType, 2)],
    ["replaceMatches", apiFunction(["value", "expression", "replacement", "options"], [stringType, stringType, stringType, patternOptionsType], stringType, 3)],
    ["splitPattern", apiFunction(["value", "expression", "options"], [stringType, stringType, patternOptionsType], listString, 2)],
  ])), "Text", TEXT_NAMESPACE_MEMBERS)],
  ["velar/math", moduleInterface(new Map([
    ["pi", numberType], ["e", numberType], ["tau", numberType], ["infinity", numberType],
    // min and max are pure rest calls and therefore have no named rest value.
    ["min", intrinsic("math.min", [numberType], numberType)],
    ["max", intrinsic("math.max", [numberType], numberType)],
    ["clamp", apiFunction(["value", "minimum", "maximum"], [numberType, numberType, numberType], numberType)],
    ["sign", apiFunction(["value"], [numberType], numberType)],
    ["trunc", apiFunction(["value"], [numberType], numberType)],
    ["sqrt", apiFunction(["value"], [numberType], numberType)],
    ["cbrt", apiFunction(["value"], [numberType], numberType)],
    ["pow", apiFunction(["base", "exponent"], [numberType, numberType], numberType)],
    ["exp", apiFunction(["value"], [numberType], numberType)],
    ["log", apiFunction(["value", "base"], [numberType, numberType], numberType, 1)],
    ["log2", apiFunction(["value"], [numberType], numberType)],
    ["log10", apiFunction(["value"], [numberType], numberType)],
    ["sin", apiFunction(["value"], [numberType], numberType)],
    ["cos", apiFunction(["value"], [numberType], numberType)],
    ["tan", apiFunction(["value"], [numberType], numberType)],
    ["asin", apiFunction(["value"], [numberType], numberType)],
    ["acos", apiFunction(["value"], [numberType], numberType)],
    ["atan", apiFunction(["value"], [numberType], numberType)],
    ["atan2", apiFunction(["y", "x"], [numberType, numberType], numberType)],
    ["degrees", apiFunction(["radians"], [numberType], numberType)],
    ["radians", apiFunction(["degrees"], [numberType], numberType)],
    ["hypot", apiFunction(["x", "y"], [numberType, numberType], numberType)],
    ["random", apiFunction([], [], numberType)],
    // randomInt has one-bound and minimum/maximum positional forms.
    ["randomInt", functionType([numberType, numberType], numberType, 1)],
    ["gcd", apiFunction(["left", "right"], [numberType, numberType], numberType)],
    ["lcm", apiFunction(["left", "right"], [numberType, numberType], numberType)],
  ]))],
  ["velar/json", permanentNamespace(moduleInterface(new Map([
    ["parse", apiIntrinsic("json.parse", ["text", "target"], [stringType, anyType], unknownType, 1)],
    ["tryParse", apiIntrinsic("json.tryParse", ["text", "target", "fallback"], [stringType, anyType, anyType], unknownType, 1)],
    ["stringify", apiIntrinsic("json.stringify", ["value", "pretty"], [anyType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["stableStringify", apiIntrinsic("json.stableStringify", ["value", "pretty"], [anyType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["clone", apiIntrinsic("json.clone", ["value", "target"], [anyType, anyType], anyType, 1)],
    ["isSerializable", apiFunction(["value"], [anyType], boolType)],
  ])), "Json", ["parse", "tryParse", "stringify", "stableStringify", "clone", "isSerializable"])],
  ["velar/async", permanentNamespace(moduleInterface(new Map([
    ["sleep", apiFunction(["duration"], [durationType], promise(nullType))],
    ["all", apiIntrinsic("async.all", ["values"], [anyType], promise(anyType))],
    ["race", apiIntrinsic("async.race", ["values"], [listAny], promise(anyType))],
    ["timeout", apiIntrinsic("async.timeout", ["value", "duration", "message"], [promise(anyType), durationType, stringType], promise(anyType), 2)],
    ["retry", apiIntrinsic("async.retry", ["task", "attempts", "delay"], [anyType, numberType, durationType], promise(anyType), 1)],
    ["map", apiIntrinsic("async.map", ["values", "worker", "concurrency"], [listAny, anyType, numberType], promise(listAny), 2)],
    ["series", apiIntrinsic("async.series", ["tasks"], [listAny], promise(listAny))],
  ])), "Promise", ["all", "race", "sleep", "timeout", "retry", "map", "series"])],
  ["velar/url", moduleInterface(new Map([
    ["parse", apiFunction(["value", "base"], [stringType, stringType], urlInfoType, 1)],
    // join is a pure rest call, so its segments stay positional.
    ["join", intrinsic("url.join", [stringType], stringType)],
    ["query", apiFunction(["params"], [anyType], stringType)],
    ["parseQuery", apiFunction(["value"], [stringType], { kind: "map", key: stringType, value: stringType })],
    ["withQuery", apiFunction(["value", "params"], [stringType, anyType], stringType)],
    ["withHash", apiFunction(["value", "hash"], [stringType, stringType], stringType)],
    ["isExternal", apiFunction(["value", "base"], [stringType, stringType], boolType, 1)],
    ["encode", apiFunction(["value"], [stringType], stringType)],
    ["decode", apiFunction(["value"], [stringType], stringType)],
    ["normalize", apiFunction(["value", "base"], [stringType, stringType], stringType, 1)],
  ]))],
  ["velar/time", moduleInterface(new Map([
    ["now", apiFunction([], [], numberType)],
    ["monotonic", apiFunction([], [], numberType)],
    ["parse", apiFunction(["value"], [stringType], optional(numberType))],
    ["iso", apiFunction(["value"], [numberType], stringType, 0)],
    ["format", apiFunction(["value", "locale", "timeZone"], [numberType, stringType, stringType], stringType, 1)],
    ["date", apiFunction(["year", "month", "day", "hour", "minute", "second"], [numberType, numberType, numberType, numberType, numberType, numberType], numberType, 3)],
    ["utc", apiFunction(["year", "month", "day", "hour", "minute", "second"], [numberType, numberType, numberType, numberType, numberType, numberType], numberType, 3)],
    ["parts", apiFunction(["value", "timeZone"], [numberType, stringType], timePartsType, 1)],
  ]))],
  ["velar/id", moduleInterface(new Map([
    ["uuid", apiFunction([], [], stringType)],
    ["isUuid", apiFunction(["value"], [stringType], boolType)],
  ]))],
  ["velar/log", moduleInterface(new Map([
    ["log", loggerType],
    ["logger", apiFunction(["scope", "fields"], [stringType, logFieldsType], loggerType, 1)],
    ["level", apiFunction([], [], stringType)],
    ["setLevel", apiFunction(["value"], [stringType], nullType)],
    ["useSink", apiFunction(["sink"], [functionType([logRecordType], unknownType)], cleanupType)],
  ]))],
  ["velar/test", moduleInterface(new Map([
    ["expect", apiIntrinsic("test.expect", ["actual"], [anyType], anyType)],
  ]))],
]);

function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  classes: ReadonlyMap<string, ClassInfo> = new Map(),
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
): ModuleInterface {
  return { exports, mutableExports: new Set(), reactiveExports: new Map(), reExports: new Map(), namedTypes, namedTypeIdentities: new Map(), typeAliases: new Map(), enums: new Map(), classes, tests: [], extensionExports: new Map(), extensionData: new Map() };
}

function permanentNamespace(interface_: ModuleInterface, name: string, members: readonly string[]): ModuleInterface {
  return { ...interface_, permanentNamespace: { name, members: new Set(members) } };
}

export function standardModuleInterfaces(extensions: readonly CompilerExtension[] = []): ReadonlyMap<string, ModuleInterface> {
  const activeExtensions = standardExtensions(extensions);
  return new Map([
    ...coreModuleInterfaces,
    ...combinedExtensionModules<ModuleInterface>(activeExtensions, "interfaces"),
  ]);
}

export function isStandardModule(source: string, extensions: readonly CompilerExtension[] = []): boolean {
  return standardModuleInterface(source, extensions) !== null;
}

export function standardModuleInterface(source: string, extensions: readonly CompilerExtension[] = []): ModuleInterface | null {
  for (const extension of standardExtensions(extensions)) {
    const interface_ = extension.modules?.interfaces.get(source);
    if (interface_) return interface_;
  }
  return coreModuleInterfaces.get(source) ?? null;
}

/** The Core comparison, reached for rather than restated (D50 rule 97.2). */
const collectionLoweringImport = `import { __velarEquals } from "${VELAR_COLLECTION_LOWERING_MODULE}";`;

// Structure walkers shared by the assertion reporter. Content comparison is
// deliberately absent: D50 rule 97.2 makes `toEqual` call the language's own
// `equals`, so a second comparison implementation cannot exist here to
// disagree with it.
const testDisplayRuntime = String.raw`
const __velarDeepNativeArray = globalThis.Array;
const __velarDeepNativeMap = globalThis.Map;
const __velarDeepNativeSet = globalThis.Set;
const __velarDeepNativeWeakSet = globalThis.WeakSet;
const __velarDeepNativeObject = globalThis.Object;
const __velarDeepGetOwnPropertyDescriptor = __velarDeepNativeObject.getOwnPropertyDescriptor;
const __velarDeepGetOwnPropertyNames = __velarDeepNativeObject.getOwnPropertyNames;
const __velarDeepGetOwnPropertySymbols = __velarDeepNativeObject.getOwnPropertySymbols;
const __velarDeepGetPrototypeOf = __velarDeepNativeObject.getPrototypeOf;
const __velarDeepObjectPrototype = __velarDeepGetOwnPropertyDescriptor(__velarDeepNativeObject, "prototype")?.value;
const __velarDeepArrayIsArray = __velarDeepNativeArray.isArray;
const __velarDeepApply = __velarDeepGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarDeepArrayPrototype = __velarDeepGetOwnPropertyDescriptor(__velarDeepNativeArray, "prototype")?.value;
const __velarDeepMapPrototype = __velarDeepGetOwnPropertyDescriptor(__velarDeepNativeMap, "prototype")?.value;
const __velarDeepSetPrototype = __velarDeepGetOwnPropertyDescriptor(__velarDeepNativeSet, "prototype")?.value;
const __velarDeepWeakSetPrototype = __velarDeepGetOwnPropertyDescriptor(__velarDeepNativeWeakSet, "prototype")?.value;
const __velarDeepArraySort = __velarDeepGetOwnPropertyDescriptor(__velarDeepArrayPrototype, "sort")?.value;
const __velarDeepMapSize = __velarDeepGetOwnPropertyDescriptor(__velarDeepMapPrototype, "size")?.get;
const __velarDeepMapEntries = __velarDeepGetOwnPropertyDescriptor(__velarDeepMapPrototype, "entries")?.value;
const __velarDeepSetSize = __velarDeepGetOwnPropertyDescriptor(__velarDeepSetPrototype, "size")?.get;
const __velarDeepSetValues = __velarDeepGetOwnPropertyDescriptor(__velarDeepSetPrototype, "values")?.value;
const __velarDeepWeakSetHas = __velarDeepGetOwnPropertyDescriptor(__velarDeepWeakSetPrototype, "has")?.value;
const __velarDeepWeakSetAdd = __velarDeepGetOwnPropertyDescriptor(__velarDeepWeakSetPrototype, "add")?.value;
const __velarDeepWeakSetDelete = __velarDeepGetOwnPropertyDescriptor(__velarDeepWeakSetPrototype, "delete")?.value;
const __velarDeepMapIterator = __velarDeepApply(__velarDeepMapEntries, new __velarDeepNativeMap(), []);
const __velarDeepMapIteratorNext = __velarDeepGetOwnPropertyDescriptor(__velarDeepGetPrototypeOf(__velarDeepMapIterator), "next")?.value;
const __velarDeepSetIterator = __velarDeepApply(__velarDeepSetValues, new __velarDeepNativeSet(), []);
const __velarDeepSetIteratorNext = __velarDeepGetOwnPropertyDescriptor(__velarDeepGetPrototypeOf(__velarDeepSetIterator), "next")?.value;
function __velarDeepCall(operation, receiver, arguments_) { return __velarDeepApply(operation, receiver, arguments_); }
function __velarPlainRecord(value) { const prototype = __velarDeepGetPrototypeOf(value); return prototype === __velarDeepObjectPrototype || prototype === null; }
function __velarDenseList(value) {
  if (!__velarDeepCall(__velarDeepArrayIsArray, __velarDeepNativeArray, [value]) || value.length > 1000000
    || __velarDeepGetOwnPropertySymbols(value).length !== 0
    || __velarDeepGetOwnPropertyNames(value).length !== value.length + 1) return false;
  const lengthDescriptor = __velarDeepGetOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable
    || lengthDescriptor.configurable || !("value" in lengthDescriptor)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarDeepGetOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) return false;
  }
  return true;
}
function __velarMapSize(value) { try { return __velarDeepCall(__velarDeepMapSize, value, []); } catch { return null; } }
function __velarSetSize(value) { try { return __velarDeepCall(__velarDeepSetSize, value, []); } catch { return null; } }
function __velarDataRecordKeys(value) {
  if (!__velarPlainRecord(value) || __velarDeepGetOwnPropertySymbols(value).length > 0) return null;
  const keys = __velarDeepGetOwnPropertyNames(value);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = __velarDeepGetOwnPropertyDescriptor(value, keys[index]);
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
  }
  __velarDeepCall(__velarDeepArraySort, keys, []);
  return keys;
}
function __velarDeepIteratorValue(iterator, next) { const step = __velarDeepCall(next, iterator, []); const done = __velarDeepGetOwnPropertyDescriptor(step, "done"); if (!done || !("value" in done) || typeof done.value !== "boolean") return { invalid: true }; if (done.value) return null; const value = __velarDeepGetOwnPropertyDescriptor(step, "value"); return !value || !("value" in value) ? { invalid: true } : { invalid: false, value: value.value }; }
`.trimStart();

const listRuntime = String.raw`
const __velarMaxListItems = 1000000;
const __velarListArray = Array;
const __velarListArrayIsArray = Array.isArray;
const __velarListGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarListGetOwnPropertyNames = Object.getOwnPropertyNames;
const __velarListGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const __velarListSymbolFor = Symbol.for;
const __velarListTypeError = TypeError;
const __velarListRangeError = RangeError;
function __velarListReactiveRuntime() {
  const descriptor = __velarListGetOwnPropertyDescriptor(globalThis, __velarListSymbolFor(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)}));
  const runtime = descriptor && "value" in descriptor ? descriptor.value : null;
  return runtime && runtime.version === ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)} && typeof runtime.toRaw === "function"
    && typeof runtime.collectionRead === "function" ? runtime : null;
}
function __velarRequireList(value, name) {
  const reactive = __velarListReactiveRuntime();
  if (reactive) value = reactive.toRaw(value);
  if (!__velarListArrayIsArray(value)) throw new __velarListTypeError(name + " requires a List");
  if (value.length > __velarMaxListItems) throw new __velarListRangeError(name + " cannot exceed " + __velarMaxListItems + " items");
  if (__velarListGetOwnPropertySymbols(value).length > 0
    || __velarListGetOwnPropertyNames(value).length !== value.length + 1) {
    throw new __velarListTypeError(name + " requires a dense List without extra fields");
  }
  const lengthDescriptor = __velarListGetOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable
    || lengthDescriptor.configurable || !("value" in lengthDescriptor)) {
    throw new __velarListTypeError(name + " requires an ordinary mutable List length");
  }
  const output = new __velarListArray(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarListGetOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) {
      throw new __velarListTypeError(name + " requires ordinary mutable List elements");
    }
    output[index] = reactive ? reactive.collectionRead(value, __velarListSymbolFor("velar.reactive.iterate.v1"), descriptor.value) : descriptor.value;
  }
  return output;
}
`.trimStart();

const runtimeTypeRuntime = VELAR_TYPE_REGISTRY_RUNTIME;

const coreModuleSources: ReadonlyMap<string, string> = new Map([
  [VELAR_CLASS_FIELD_MODULE, VELAR_CLASS_FIELD_MODULE_SOURCE],
  [VELAR_COLLECTION_HOST_MODULE, VELAR_COLLECTION_HOST_MODULE_SOURCE],
  [VELAR_COLLECTION_LOWERING_MODULE, VELAR_COLLECTION_LOWERING_MODULE_SOURCE],
  [VELAR_ERROR_NORMALIZATION_MODULE, VELAR_ERROR_NORMALIZATION_MODULE_SOURCE],
  [VELAR_NARROWING_MODULE, VELAR_NARROWING_MODULE_SOURCE],
  [VELAR_PRIMITIVE_METHOD_MODULE, VELAR_PRIMITIVE_METHOD_MODULE_SOURCE],
  [VELAR_PROMISE_NORMALIZATION_MODULE, VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE],
  [VELAR_REACTIVE_BRIDGE_MODULE, VELAR_REACTIVE_BRIDGE_MODULE_SOURCE],
  [VELAR_TYPE_VALIDATION_MODULE, VELAR_TYPE_VALIDATION_MODULE_SOURCE],
  ["velar/collections", String.raw`
${listRuntime}
const maxCollectionTextCodeUnits = 16 * 1024 * 1024;
const __velarCollectionsNativeArray = globalThis.Array;
const __velarCollectionsNativeMap = globalThis.Map;
const __velarCollectionsNativeSet = globalThis.Set;
const __velarCollectionsNativeObject = globalThis.Object;
const __velarCollectionsNativeNumber = globalThis.Number;
const __velarCollectionsNativeMath = globalThis.Math;
const __velarCollectionsNativeTypeError = globalThis.TypeError;
const __velarCollectionsNativeRangeError = globalThis.RangeError;
const __velarCollectionsGetOwnPropertyDescriptor = __velarCollectionsNativeObject.getOwnPropertyDescriptor;
const __velarCollectionsApply = __velarCollectionsGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarCollectionsArrayPrototype = __velarCollectionsGetOwnPropertyDescriptor(__velarCollectionsNativeArray, "prototype")?.value;
const __velarCollectionsMapPrototype = __velarCollectionsGetOwnPropertyDescriptor(__velarCollectionsNativeMap, "prototype")?.value;
const __velarCollectionsSetPrototype = __velarCollectionsGetOwnPropertyDescriptor(__velarCollectionsNativeSet, "prototype")?.value;
function __velarCollectionsHostOperation(owner, key) { const descriptor = __velarCollectionsGetOwnPropertyDescriptor(owner, key); if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") throw new __velarCollectionsNativeTypeError("The JavaScript " + key + " collection API is unavailable"); return descriptor.value; }
const __velarCollectionsArrayJoin = __velarCollectionsHostOperation(__velarCollectionsArrayPrototype, "join");
const __velarCollectionsArraySort = __velarCollectionsHostOperation(__velarCollectionsArrayPrototype, "sort");
const __velarCollectionsMapGet = __velarCollectionsHostOperation(__velarCollectionsMapPrototype, "get");
const __velarCollectionsMapSet = __velarCollectionsHostOperation(__velarCollectionsMapPrototype, "set");
const __velarCollectionsSetHas = __velarCollectionsHostOperation(__velarCollectionsSetPrototype, "has");
const __velarCollectionsSetAdd = __velarCollectionsHostOperation(__velarCollectionsSetPrototype, "add");
const __velarCollectionsObjectFreeze = __velarCollectionsHostOperation(__velarCollectionsNativeObject, "freeze");
const __velarCollectionsObjectIs = __velarCollectionsHostOperation(__velarCollectionsNativeObject, "is");
const __velarCollectionsNumberIsFinite = __velarCollectionsHostOperation(__velarCollectionsNativeNumber, "isFinite");
const __velarCollectionsNumberIsNaN = __velarCollectionsHostOperation(__velarCollectionsNativeNumber, "isNaN");
const __velarCollectionsNumberIsSafeInteger = __velarCollectionsHostOperation(__velarCollectionsNativeNumber, "isSafeInteger");
const __velarCollectionsMathMin = __velarCollectionsHostOperation(__velarCollectionsNativeMath, "min");
const __velarCollectionsMathMax = __velarCollectionsHostOperation(__velarCollectionsNativeMath, "max");
const __velarCollectionsMathFloor = __velarCollectionsHostOperation(__velarCollectionsNativeMath, "floor");
if (typeof __velarCollectionsApply !== "function") throw new __velarCollectionsNativeTypeError("The JavaScript Reflect.apply collection API is unavailable");
function __velarCollectionsCall(operation, receiver, arguments_) { return __velarCollectionsApply(operation, receiver, arguments_); }
function __velarCollectionsFreeze(value) { return __velarCollectionsCall(__velarCollectionsObjectFreeze, __velarCollectionsNativeObject, [value]); }
function __velarCollectionsSame(left, right) { return left === right || __velarCollectionsCall(__velarCollectionsObjectIs, __velarCollectionsNativeObject, [left, right]); }
// TXT-D1: string keys order by code point (= UTF-8 binary order), matching
// every other ordered surface. Surrogate-free operands keep the native path.
const __velarCollectionsNativeString = globalThis.String;
const __velarCollectionsStringPrototype = __velarCollectionsGetOwnPropertyDescriptor(__velarCollectionsNativeString, "prototype")?.value;
const __velarCollectionsCharCodeAt = __velarCollectionsHostOperation(__velarCollectionsStringPrototype, "charCodeAt");
const __velarCollectionsSurrogatePattern = /[\uD800-\uDFFF]/;
const __velarCollectionsRegExpPrototype = __velarCollectionsHostOperation(__velarCollectionsNativeObject, "getPrototypeOf")(__velarCollectionsSurrogatePattern);
const __velarCollectionsSurrogateExec = __velarCollectionsHostOperation(__velarCollectionsRegExpPrototype, "exec");
function __velarCollectionsCharCode(value, index) { return __velarCollectionsCall(__velarCollectionsCharCodeAt, value, [index]); }
function __velarCollectionsHasSurrogate(value) { return __velarCollectionsCall(__velarCollectionsSurrogateExec, __velarCollectionsSurrogatePattern, [value]) !== null; }
function __velarCollectionsCodePointCompare(left, right) {
  if (left === right) return 0;
  if (!__velarCollectionsHasSurrogate(left) && !__velarCollectionsHasSurrogate(right)) return left < right ? -1 : 1;
  let leftOffset = 0;
  let rightOffset = 0;
  while (leftOffset < left.length && rightOffset < right.length) {
    let first = __velarCollectionsCharCode(left, leftOffset);
    let firstUnits = 1;
    if (first >= 0xD800 && first <= 0xDBFF && leftOffset + 1 < left.length) {
      const trail = __velarCollectionsCharCode(left, leftOffset + 1);
      if (trail >= 0xDC00 && trail <= 0xDFFF) { first = (first - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000; firstUnits = 2; }
    }
    let second = __velarCollectionsCharCode(right, rightOffset);
    let secondUnits = 1;
    if (second >= 0xD800 && second <= 0xDBFF && rightOffset + 1 < right.length) {
      const trail = __velarCollectionsCharCode(right, rightOffset + 1);
      if (trail >= 0xDC00 && trail <= 0xDFFF) { second = (second - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000; secondUnits = 2; }
    }
    if (first !== second) return first < second ? -1 : 1;
    leftOffset += firstUnits;
    rightOffset += secondUnits;
  }
  return leftOffset < left.length ? 1 : rightOffset < right.length ? -1 : 0;
}
function __velarCollectionsOrderedCompare(kind, left, right) {
  if (kind === "string") return __velarCollectionsCodePointCompare(left, right);
  return left < right ? -1 : left > right ? 1 : 0;
}
function requireList(value, name) {
  return __velarRequireList(value, name);
}

function requireCount(value, name, positive = false) {
  if (!__velarCollectionsCall(__velarCollectionsNumberIsSafeInteger, __velarCollectionsNativeNumber, [value]) || (positive ? value <= 0 : value < 0)) {
    throw new __velarCollectionsNativeRangeError(name + " requires " + (positive ? "a positive" : "a non-negative") + " integer");
  }
  return value;
}

function requireCallback(value, name) {
  if (typeof value !== "function") throw new __velarCollectionsNativeTypeError(name + " requires a function");
  return value;
}

function predicate(callback, value, name) {
  const result = requireCallback(callback, name)(value);
  if (typeof result !== "boolean") throw new __velarCollectionsNativeTypeError(name + " predicate must return bool");
  return result;
}

function comparable(value, name, expected = null) {
  const type = typeof value;
  if ((type !== "string" && type !== "number") || (type === "number" && __velarCollectionsCall(__velarCollectionsNumberIsNaN, __velarCollectionsNativeNumber, [value]))) {
    throw new __velarCollectionsNativeTypeError(name + " key must be a string or non-NaN number");
  }
  if (expected !== null && type !== expected) throw new __velarCollectionsNativeTypeError(name + " keys must all have the same type");
  return type;
}

export function range(start, stop = null, step = 1) {
  if (stop === null) { stop = start; start = 0; }
  if (!__velarCollectionsCall(__velarCollectionsNumberIsFinite, __velarCollectionsNativeNumber, [start]) || !__velarCollectionsCall(__velarCollectionsNumberIsFinite, __velarCollectionsNativeNumber, [stop]) || !__velarCollectionsCall(__velarCollectionsNumberIsFinite, __velarCollectionsNativeNumber, [step]) || step === 0) throw new __velarCollectionsNativeRangeError("range requires finite numbers and a non-zero step");
  const output = new __velarCollectionsNativeArray();
  if (step > 0) for (let value = start; value < stop;) {
    if (output.length >= __velarMaxListItems) throw new __velarCollectionsNativeRangeError("range cannot produce more than " + __velarMaxListItems + " items");
    output[output.length] = value; const next = value + step;
    if (next === value) throw new __velarCollectionsNativeRangeError("range step is too small to advance at this magnitude");
    value = next;
  } else for (let value = start; value > stop;) {
    if (output.length >= __velarMaxListItems) throw new __velarCollectionsNativeRangeError("range cannot produce more than " + __velarMaxListItems + " items");
    output[output.length] = value; const next = value + step;
    if (next === value) throw new __velarCollectionsNativeRangeError("range step is too small to advance at this magnitude");
    value = next;
  }
  return output;
}

export function enumerate(values, start = 0) {
  values = requireList(values, "enumerate");
  if (!__velarCollectionsCall(__velarCollectionsNumberIsSafeInteger, __velarCollectionsNativeNumber, [start]) || (values.length > 0 && !__velarCollectionsCall(__velarCollectionsNumberIsSafeInteger, __velarCollectionsNativeNumber, [start + values.length - 1]))) throw new __velarCollectionsNativeRangeError("enumerate indexes must be safe integers");
  const output = new __velarCollectionsNativeArray(values.length);
  for (let index = 0; index < values.length; index += 1) output[index] = __velarCollectionsFreeze({ index: start + index, value: values[index] });
  return output;
}

export function zip(left, right) {
  left = requireList(left, "zip"); right = requireList(right, "zip");
  const length = __velarCollectionsCall(__velarCollectionsMathMin, __velarCollectionsNativeMath, [left.length, right.length]);
  const output = new __velarCollectionsNativeArray(length);
  for (let index = 0; index < length; index += 1) output[index] = __velarCollectionsFreeze({ first: left[index], second: right[index] });
  return output;
}

export function unique(values) { values = requireList(values, "unique"); const seen = new __velarCollectionsNativeSet(); const output = new __velarCollectionsNativeArray(); for (let index = 0; index < values.length; index += 1) { const value = values[index]; if (__velarCollectionsCall(__velarCollectionsSetHas, seen, [value])) continue; __velarCollectionsCall(__velarCollectionsSetAdd, seen, [value]); output[output.length] = value; } return output; }

export function chunk(values, size) {
  values = requireList(values, "chunk"); requireCount(size, "chunk size", true);
  const output = new __velarCollectionsNativeArray();
  for (let index = 0; index < values.length; index += size) { const length = __velarCollectionsCall(__velarCollectionsMathMin, __velarCollectionsNativeMath, [size, values.length - index]); const part = new __velarCollectionsNativeArray(length); for (let offset = 0; offset < length; offset += 1) part[offset] = values[index + offset]; output[output.length] = part; }
  return output;
}

export function flatten(values) {
  values = requireList(values, "flatten");
  const output = new __velarCollectionsNativeArray();
  for (let outer = 0; outer < values.length; outer += 1) {
    const nested = requireList(values[outer], "flatten");
    if (output.length + nested.length > __velarMaxListItems) throw new __velarCollectionsNativeRangeError("flatten cannot produce more than " + __velarMaxListItems + " items");
    for (let inner = 0; inner < nested.length; inner += 1) output[output.length] = nested[inner];
  }
  return output;
}

export function compact(values) { values = requireList(values, "compact"); const output = new __velarCollectionsNativeArray(); for (let index = 0; index < values.length; index += 1) if (values[index] != null) output[output.length] = values[index]; return output; }
export function reversed(values) { values = requireList(values, "reversed"); const output = new __velarCollectionsNativeArray(values.length); for (let index = 0; index < values.length; index += 1) output[index] = values[values.length - index - 1]; return output; }
export function take(values, count) { values = requireList(values, "take"); count = __velarCollectionsCall(__velarCollectionsMathMin, __velarCollectionsNativeMath, [values.length, requireCount(count, "take count")]); const output = new __velarCollectionsNativeArray(count); for (let index = 0; index < count; index += 1) output[index] = values[index]; return output; }
export function drop(values, count) { values = requireList(values, "drop"); count = __velarCollectionsCall(__velarCollectionsMathMin, __velarCollectionsNativeMath, [values.length, requireCount(count, "drop count")]); const output = new __velarCollectionsNativeArray(values.length - count); for (let index = count; index < values.length; index += 1) output[index - count] = values[index]; return output; }
export function first(values) { values = requireList(values, "first"); return values.length ? values[0] : null; }
export function last(values) { values = requireList(values, "last"); return values.length ? values[values.length - 1] : null; }
export function find(values, callback) { values = requireList(values, "find"); for (let index = 0; index < values.length; index += 1) if (predicate(callback, values[index], "find")) return values[index]; return null; }
export function index(values, item) { values = requireList(values, "index"); for (let index = 0; index < values.length; index += 1) if (__velarCollectionsSame(values[index], item)) return index; return null; }
export function has(values, value) { return index(values, value) !== null; }
export function count(values, value) { values = requireList(values, "count"); let total = 0; for (let index = 0; index < values.length; index += 1) if (__velarCollectionsSame(values[index], value)) total += 1; return total; }
export function some(values, callback) { values = requireList(values, "some"); for (let index = 0; index < values.length; index += 1) if (predicate(callback, values[index], "some")) return true; return false; }
export function every(values, callback) { values = requireList(values, "every"); for (let index = 0; index < values.length; index += 1) if (!predicate(callback, values[index], "every")) return false; return true; }

export function partition(values, callback) {
  values = requireList(values, "partition");
  const matches = new __velarCollectionsNativeArray(), rest = new __velarCollectionsNativeArray();
  for (let index = 0; index < values.length; index += 1) { const output = predicate(callback, values[index], "partition") ? matches : rest; output[output.length] = values[index]; }
  return __velarCollectionsFreeze({ matches, rest });
}

export function groupBy(values, key) {
  values = requireList(values, "groupBy");
  requireCallback(key, "groupBy");
  const output = new __velarCollectionsNativeMap();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index], name = key(value) ?? null;
    const group = __velarCollectionsCall(__velarCollectionsMapGet, output, [name]);
    if (group) group[group.length] = value; else __velarCollectionsCall(__velarCollectionsMapSet, output, [name, [value]]);
  }
  return output;
}

export function keyBy(values, key) {
  values = requireList(values, "keyBy");
  requireCallback(key, "keyBy");
  const output = new __velarCollectionsNativeMap();
  for (let index = 0; index < values.length; index += 1) __velarCollectionsCall(__velarCollectionsMapSet, output, [key(values[index]) ?? null, values[index]]);
  return output;
}

export function countBy(values, key) {
  values = requireList(values, "countBy");
  requireCallback(key, "countBy");
  const output = new __velarCollectionsNativeMap();
  for (let index = 0; index < values.length; index += 1) { const name = key(values[index]) ?? null; __velarCollectionsCall(__velarCollectionsMapSet, output, [name, (__velarCollectionsCall(__velarCollectionsMapGet, output, [name]) || 0) + 1]); }
  return output;
}

export function sortBy(values, key, descending = false) {
  values = requireList(values, "sortBy"); requireCallback(key, "sortBy");
  if (typeof descending !== "boolean") throw new __velarCollectionsNativeTypeError("sortBy descending must be bool");
  let keyType = null;
  const decorated = new __velarCollectionsNativeArray(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const result = key(value);
    const type = comparable(result, "sortBy", keyType);
    if (keyType === null) keyType = type;
    decorated[index] = { value, index, key: result };
  }
  __velarCollectionsCall(__velarCollectionsArraySort, decorated, [(left, right) => {
    const order = __velarCollectionsOrderedCompare(keyType, left.key, right.key);
    return order === 0 ? left.index - right.index : descending ? -order : order;
  }]);
  const output = new __velarCollectionsNativeArray(decorated.length);
  for (let index = 0; index < decorated.length; index += 1) output[index] = decorated[index].value;
  return output;
}

function extremeBy(values, key, direction, name) {
  values = requireList(values, name); requireCallback(key, name);
  if (!values.length) return null;
  let selected = values[0], selectedKey = key(selected), keyType = comparable(selectedKey, name);
  for (let index = 1; index < values.length; index += 1) {
    const candidate = key(values[index]);
    comparable(candidate, name, keyType);
    const order = __velarCollectionsOrderedCompare(keyType, candidate, selectedKey);
    if ((direction < 0 && order < 0) || (direction > 0 && order > 0)) {
      selected = values[index]; selectedKey = candidate;
    }
  }
  return selected;
}

export function minBy(values, key) { return extremeBy(values, key, -1, "minBy"); }
export function maxBy(values, key) { return extremeBy(values, key, 1, "maxBy"); }
export function sum(values) { values = requireList(values, "sum"); let total = 0; for (let index = 0; index < values.length; index += 1) { if (typeof values[index] !== "number") throw new __velarCollectionsNativeTypeError("sum requires numbers"); total += values[index]; } return total; }
export function join(values, separator = "") {
  if (typeof separator !== "string") throw new __velarCollectionsNativeTypeError("join separator must be a string");
  values = requireList(values, "join");
  let outputCodeUnits = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== "string") throw new __velarCollectionsNativeTypeError("join requires strings");
    if (value.length > maxCollectionTextCodeUnits - outputCodeUnits) {
      throw new __velarCollectionsNativeRangeError("join output cannot exceed 16 MiB");
    }
    outputCodeUnits += value.length;
  }
  const separatorCount = __velarCollectionsCall(__velarCollectionsMathMax, __velarCollectionsNativeMath, [0, values.length - 1]);
  if (separatorCount > 0
    && separator.length > __velarCollectionsCall(__velarCollectionsMathFloor, __velarCollectionsNativeMath, [(maxCollectionTextCodeUnits - outputCodeUnits) / separatorCount])) {
    throw new __velarCollectionsNativeRangeError("join output cannot exceed 16 MiB");
  }
  return __velarCollectionsCall(__velarCollectionsArrayJoin, values, [separator]);
}
export function repeat(value, count) { count = requireCount(count, "repeat count"); if (count > __velarMaxListItems) throw new __velarCollectionsNativeRangeError("repeat cannot produce more than " + __velarMaxListItems + " items"); const output = new __velarCollectionsNativeArray(count); for (let index = 0; index < count; index += 1) output[index] = value; return output; }
`.trimStart()],
  ["velar/text", String.raw`
${VELAR_TEXT_METHOD_RUNTIME}
${VELAR_UTF8_RUNTIME}
const maxTextCodeUnits = __velarMaxTextCodeUnits;
const maxTextItems = __velarMaxTextItems;
const __velarTextGetOwnPropertyNames = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "getOwnPropertyNames")?.value;
const __velarTextGetOwnPropertySymbols = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "getOwnPropertySymbols")?.value;
const __velarTextGetPrototypeOf = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "getPrototypeOf")?.value;
const __velarTextObjectPrototype = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "prototype")?.value;
const __velarTextObjectCreate = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "create")?.value;
const __velarTextObjectFreeze = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "freeze")?.value;
const __velarTextArrayPrototype = __velarTextGetOwnPropertyDescriptor(__velarTextNativeArray, "prototype")?.value;
const __velarTextArrayJoin = __velarTextGetOwnPropertyDescriptor(__velarTextArrayPrototype, "join")?.value;
const __velarTextStringTrimStart = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "trimStart")?.value;
const __velarTextStringTrimEnd = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "trimEnd")?.value;
const __velarTextStringNormalize = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "normalize")?.value;
const nativeRegExpPrototype = __velarTextGetPrototypeOf(/(?:)/u);
const NativeRegExp = __velarTextGetOwnPropertyDescriptor(nativeRegExpPrototype, "constructor")?.value;
const nativeRegExpExec = __velarTextGetOwnPropertyDescriptor(nativeRegExpPrototype, "exec")?.value;
const nativeStringReplaceAll = __velarNativeStringReplaceAll;
const __velarTextStringCodePointAt = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "codePointAt")?.value;
const __velarTextStringFromCodePoint = __velarTextGetOwnPropertyDescriptor(__velarTextNativeString, "fromCodePoint")?.value;
const __velarTextTitleSeparators = /[_\-/]+/gu;
const __velarTextTitleWords = /(^|\s)([\p{L}\p{N}])/gu;
const __velarTextLines = /\r?\n/gu;
const __velarTextWords = /\s+/gu;
const __velarTextMarks = /\p{M}/gu;
const __velarTextSlugSeparators = /[^\p{L}\p{N}]+/gu;
const __velarTextSlugEdges = /^-+|-+$/gu;
const __velarTextWhitespace = /\s+/gu;
function __velarTextAppend(values, value) { values[values.length] = value; }
function __velarTextJoin(values, separator) { return __velarTextCall(__velarTextArrayJoin, values, [separator]); }
function __velarTextRegexReplace(value, pattern, replacement) {
  pattern.lastIndex = 0;
  const output = []; let end = 0, units = 0;
  while (true) {
    const raw = __velarTextCall(nativeRegExpExec, pattern, [value]);
    if (raw === null) break;
    const match = checkedMatchValue(raw, value);
    const before = __velarTextCall(__velarNativeStringSlice, value, [end, match.unitIndex]);
    const next = typeof replacement === "function" ? replacement(match) : replacement;
    if (typeof next !== "string") throw new __velarTextNativeTypeError("Text replacement must produce a string");
    units += before.length + next.length;
    if (units > maxTextCodeUnits) throw new __velarTextNativeRangeError("Text replacement output cannot exceed 16 MiB");
    __velarTextAppend(output, before); __velarTextAppend(output, next);
    end = match.unitIndex + match.value.length;
    if (match.value === "") pattern.lastIndex = nextTextIndex(value, pattern.lastIndex);
  }
  const tail = __velarTextCall(__velarNativeStringSlice, value, [end]);
  if (units + tail.length > maxTextCodeUnits) throw new __velarTextNativeRangeError("Text replacement output cannot exceed 16 MiB");
  __velarTextAppend(output, tail); pattern.lastIndex = 0;
  return __velarTextJoin(output, "");
}
function __velarTextRegexSplit(value, pattern, limit) {
  pattern.lastIndex = 0;
  const output = []; let end = 0;
  while (output.length + 1 < limit) {
    const raw = __velarTextCall(nativeRegExpExec, pattern, [value]);
    if (raw === null) break;
    const match = checkedMatchValue(raw, value);
    __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [end, match.unitIndex]));
    end = match.unitIndex + match.value.length;
    if (match.value === "") pattern.lastIndex = nextTextIndex(value, pattern.lastIndex);
  }
  if (output.length < limit) __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [end]));
  pattern.lastIndex = 0;
  return output;
}
function valueOf(value) { return __velarTextArgument(value, "velar/text value"); }
function textOutput(value, name) { return __velarTextOutput(value, name); }
function textCount(value, name) { return __velarTextCount(value, name); }
function textList(values, name) { return __velarTextList(values, name); }
function htmlOutputUnits(value) {
  let units = value.length;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "&" || character === "'") units += 4;
    else if (character === "<" || character === ">") units += 3;
    else if (character === '"') units += 5;
    if (units > maxTextCodeUnits) return units;
  }
  return units;
}
const codePointLength = __velarTextCodePointLength;
const codePointPrefix = __velarTextCodePointPrefix;
function patternOptions(value) {
  if (value == null) return {};
  const prototype = typeof value === "object" && value !== null ? __velarTextGetPrototypeOf(value) : undefined;
  if (typeof value !== "object" || value === null || __velarTextCall(__velarTextArrayIsArray, __velarTextNativeArray, [value]) || (prototype !== __velarTextObjectPrototype && prototype !== null)) throw new __velarTextNativeTypeError("text pattern options must be a record");
  if (__velarTextGetOwnPropertySymbols(value).length > 0) throw new __velarTextNativeTypeError("text pattern options cannot contain symbol fields");
  const output = __velarTextCall(__velarTextObjectCreate, __velarTextNativeObject, [null]);
  const names = __velarTextGetOwnPropertyNames(value);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const descriptor = __velarTextGetOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarTextNativeTypeError("Text pattern option '" + name + "' must be an enumerable data field");
    if (name !== "ignoreCase" && name !== "multiline" && name !== "dotAll") throw new __velarTextNativeTypeError("Unknown text pattern option '" + name + "'");
    const option = descriptor.value;
    if (option != null && typeof option !== "boolean") throw new __velarTextNativeTypeError("Text pattern option '" + name + "' must be bool");
    output[name] = option;
  }
  return output;
}
function patternOf(expression, options, global = false) {
  expression = valueOf(expression); options = patternOptions(options);
  if (expression.length > 4096) throw new __velarTextNativeRangeError("text patterns cannot exceed 4096 code units");
  let flags = "u";
  if (global) flags += "g";
  if (options.ignoreCase === true) flags += "i";
  if (options.multiline === true) flags += "m";
  if (options.dotAll === true) flags += "s";
  try { return new NativeRegExp(expression, flags); }
  catch { throw new __velarTextNativeTypeError("Invalid text pattern"); }
}
function checkedMatchValue(match, input) {
  if (!__velarTextCall(__velarTextArrayIsArray, __velarTextNativeArray, [match]) || match.length < 1 || match.length > 4097) throw new __velarTextNativeTypeError("The regular expression engine returned an invalid match");
  const groups = new __velarTextNativeArray(match.length - 1);
  for (let index = 0; index < match.length; index += 1) {
    const descriptor = __velarTextGetOwnPropertyDescriptor(match, index);
    if (!descriptor || !("value" in descriptor)) throw new __velarTextNativeTypeError("Regular expression matches must contain data values");
    const value = descriptor.value;
    if (value !== undefined && typeof value !== "string") throw new __velarTextNativeTypeError("Regular expression match values must be strings");
    if (index === 0) {
      if (typeof value !== "string") throw new __velarTextNativeTypeError("A regular expression match requires full text");
    } else groups[index - 1] = value === undefined ? null : value;
  }
  const indexDescriptor = __velarTextGetOwnPropertyDescriptor(match, "index");
  if (!indexDescriptor || !("value" in indexDescriptor) || !__velarTextCall(__velarTextNumberIsSafeInteger, __velarTextNativeNumber, [indexDescriptor.value]) || indexDescriptor.value < 0 || indexDescriptor.value > input.length) throw new __velarTextNativeTypeError("A regular expression match requires a valid index");
  return { value: __velarTextGetOwnPropertyDescriptor(match, 0).value, groups, unitIndex: indexDescriptor.value };
}
function publicMatchValue(checked, input, index = null) {
  if (index === null) index = __velarTextCodePointIndex(input, checked.unitIndex);
  if (index === null) throw new __velarTextNativeTypeError("A regular expression match must begin at a Unicode code-point boundary");
  return __velarTextCall(__velarTextObjectFreeze, __velarTextNativeObject, [{ value: checked.value, index, groups: checked.groups }]);
}
function nextTextIndex(value, index) {
  return index >= value.length ? index + 1 : __velarTextNextCodePointOffset(value, index);
}
function eachMatch(value, pattern, visit) {
  let count = 0, units = 0, previousUnitIndex = 0, previousCodePointIndex = 0;
  while (true) {
    const raw = __velarTextCall(nativeRegExpExec, pattern, [value]);
    if (raw === null) return;
    if (count >= maxTextItems) throw new __velarTextNativeRangeError("Text patterns cannot produce more than " + maxTextItems + " matches");
    count += 1;
    const checked = checkedMatchValue(raw, value);
    const distance = __velarTextCodePointDistance(value, previousUnitIndex, checked.unitIndex);
    if (distance === null) throw new __velarTextNativeTypeError("A regular expression match must begin at a Unicode code-point boundary");
    const match = publicMatchValue(checked, value, previousCodePointIndex + distance);
    previousUnitIndex = checked.unitIndex;
    previousCodePointIndex = match.index;
    units += match.value.length;
    for (let index = 0; index < match.groups.length; index += 1) { const group = match.groups[index]; if (group !== null) units += group.length; }
    if (units > maxTextCodeUnits) throw new __velarTextNativeRangeError("Text pattern results cannot exceed 16 MiB");
    visit(match, checked.unitIndex);
    if (match.value === "") pattern.lastIndex = nextTextIndex(value, pattern.lastIndex);
  }
}
export function trimStart(value) { return __velarTextCall(__velarTextStringTrimStart, valueOf(value), []); }
export function trimEnd(value) { return __velarTextCall(__velarTextStringTrimEnd, valueOf(value), []); }
export function capitalize(value) { value = valueOf(value); if (!value) return ""; const end = __velarTextNextCodePointOffset(value, 0); const first = __velarTextCall(__velarNativeStringSlice, value, [0, end]); const tail = __velarTextCall(__velarNativeStringSlice, value, [end]); return textOutput(__velarTextCall(__velarNativeStringUpper, first, []) + __velarTextCall(__velarNativeStringLower, tail, []), "capitalize"); }
export function title(value) { let output = __velarTextCall(__velarNativeStringLower, valueOf(value), []); output = __velarTextRegexReplace(output, __velarTextTitleSeparators, " "); output = __velarTextRegexReplace(output, __velarTextTitleWords, match => match.groups[0] + __velarTextCall(__velarNativeStringUpper, match.groups[1], [])); return textOutput(output, "title"); }
export function lines(value) { return textList(__velarTextRegexSplit(valueOf(value), __velarTextLines, maxTextItems + 1), "lines"); }
export function lineStarts(value) {
  value = valueOf(value);
  const output = [0];
  let unitOffset = 0, codePointOffset = 0;
  while (unitOffset < value.length) {
    const nextUnitOffset = __velarTextNextCodePointOffset(value, unitOffset);
    if (__velarTextCall(__velarNativeStringCharCodeAt, value, [unitOffset]) === 10) __velarTextAppend(output, codePointOffset + 1);
    unitOffset = nextUnitOffset;
    codePointOffset += 1;
  }
  return textList(output, "lineStarts");
}
export function chunks(value, size) {
  value = valueOf(value);
  size = textCount(size, "chunks size");
  if (size === 0) throw new __velarTextNativeRangeError("chunks size must be greater than zero");
  if (value.length === 0) return [];
  const output = [];
  let start = 0, offset = 0, count = 0;
  while (offset < value.length) {
    offset = __velarTextNextCodePointOffset(value, offset);
    count += 1;
    if (count === size) {
      if (output.length >= maxTextItems) throw new __velarTextNativeRangeError("chunks cannot produce more than " + maxTextItems + " items");
      __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [start, offset]));
      start = offset;
      count = 0;
    }
  }
  if (start < value.length) {
    if (output.length >= maxTextItems) throw new __velarTextNativeRangeError("chunks cannot produce more than " + maxTextItems + " items");
    __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [start]));
  }
  return textList(output, "chunks");
}
export function words(value) { const cleaned = __velarTextCall(__velarNativeStringTrim, valueOf(value), []); return cleaned ? textList(__velarTextRegexSplit(cleaned, __velarTextWords, maxTextItems + 1), "words") : []; }
export function slug(value) { let output = __velarTextCall(__velarTextStringNormalize, valueOf(value), ["NFKD"]); output = __velarTextRegexReplace(output, __velarTextMarks, ""); output = __velarTextCall(__velarNativeStringLower, output, []); output = __velarTextCall(__velarNativeStringTrim, output, []); output = __velarTextRegexReplace(output, __velarTextSlugSeparators, "-"); output = __velarTextRegexReplace(output, __velarTextSlugEdges, ""); return textOutput(output, "slug"); }
// TXT-U3: text equality is code-point-sequence identity, so "café" typed on a
// keyboard (NFC) and the same name read back from a macOS filename (NFD) are
// different values with different sizes. This is the boundary tool that makes
// them one value; the four Unicode forms are the only accepted spellings.
export function normalize(value, form = "NFC") {
  value = valueOf(value);
  form = valueOf(form);
  if (form !== "NFC" && form !== "NFD" && form !== "NFKC" && form !== "NFKD") {
    throw new __velarTextNativeRangeError("normalize form must be NFC, NFD, NFKC, or NFKD");
  }
  return textOutput(__velarTextCall(__velarTextStringNormalize, value, [form]), "normalize");
}
export function truncate(value, length, suffix = "…") { value = valueOf(value); suffix = valueOf(suffix); length = textCount(length, "truncate length"); const valueLength = codePointLength(value); if (valueLength <= length) return value; const suffixLength = codePointLength(suffix); if (suffixLength >= length) return codePointPrefix(suffix, length); return codePointPrefix(value, length - suffixLength) + suffix; }
export function indent(value, prefix = "    ") {
  const rows = lines(valueOf(value)); prefix = valueOf(prefix);
  let units = __velarTextCall(__velarTextMathMax, __velarTextNativeMath, [0, rows.length - 1]);
  const output = new __velarTextNativeArray(rows.length);
  for (let index = 0; index < rows.length; index += 1) {
    units += prefix.length + rows[index].length;
    if (units > maxTextCodeUnits) throw new __velarTextNativeRangeError("indent output cannot exceed 16 MiB");
    output[index] = prefix + rows[index];
  }
  return __velarTextJoin(output, "\n");
}
export function dedent(value) { const rows = lines(valueOf(value)); let width = null; for (let index = 0; index < rows.length; index += 1) { const line = rows[index]; if (__velarTextCall(__velarNativeStringTrim, line, [])) { let current = 0; while (current < line.length && (line[current] === " " || line[current] === "\t")) current += 1; width = width === null ? current : __velarTextCall(__velarTextMathMin, __velarTextNativeMath, [width, current]); } } const output = new __velarTextNativeArray(rows.length); for (let index = 0; index < rows.length; index += 1) output[index] = __velarTextCall(__velarNativeStringSlice, rows[index], [width ?? 0]); return __velarTextJoin(output, "\n"); }
export function normalizeWhitespace(value) { return __velarTextRegexReplace(__velarTextCall(__velarNativeStringTrim, valueOf(value), []), __velarTextWhitespace, " "); }
export function utf8Size(value) { return __velarUtf8ByteLength(valueOf(value)); }
export function escapeHtml(value) {
  value = valueOf(value);
  if (htmlOutputUnits(value) > maxTextCodeUnits) throw new __velarTextNativeRangeError("escapeHtml output cannot exceed 16 MiB");
  const replacements = [["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]];
  for (let index = 0; index < replacements.length; index += 1) {
    const pair = replacements[index];
    value = __velarTextCall(nativeStringReplaceAll, value, [pair[0], pair[1]]);
  }
  return value;
}
// TXT-U4 (D50 rule 90 item 4): one character in, one code point out. Anything
// that is not exactly one code point — empty text, several characters, or a
// lone surrogate half — answers null rather than a partial reading, and the
// inverse refuses to build a surrogate half that could never stand alone.
export function codePoint(value) {
  value = valueOf(value);
  if (value.length === 0 || __velarTextNextCodePointOffset(value, 0) !== value.length) return null;
  const point = __velarTextCall(__velarTextStringCodePointAt, value, [0]);
  if (typeof point !== "number" || point >= 0xD800 && point <= 0xDFFF) return null;
  return point;
}
export function fromCodePoint(value) {
  if (!__velarTextCall(__velarTextNumberIsSafeInteger, __velarTextNativeNumber, [value]) || value < 0 || value > 0x10FFFF) {
    throw new __velarTextNativeRangeError("fromCodePoint requires a code point from 0 through 1114111");
  }
  if (value >= 0xD800 && value <= 0xDFFF) throw new __velarTextNativeRangeError("fromCodePoint refuses surrogate halves; they are not characters on their own");
  return __velarTextCall(__velarTextStringFromCodePoint, __velarTextNativeString, [value]);
}
export function matches(value, expression, options = {}) { value = valueOf(value); return __velarTextCall(nativeRegExpExec, patternOf(expression, options), [value]) !== null; }
export function findMatch(value, expression, options = {}) { value = valueOf(value); const match = __velarTextCall(nativeRegExpExec, patternOf(expression, options), [value]); return match === null ? null : publicMatchValue(checkedMatchValue(match, value), value); }
export function findMatches(value, expression, options = {}) { value = valueOf(value); const output = []; eachMatch(value, patternOf(expression, options, true), match => __velarTextAppend(output, match)); return output; }
export function replaceMatches(value, expression, replacement, options = {}) {
  value = valueOf(value); replacement = valueOf(replacement);
  const output = []; let end = 0, units = 0;
  eachMatch(value, patternOf(expression, options, true), (match, unitIndex) => {
    const before = __velarTextCall(__velarNativeStringSlice, value, [end, unitIndex]);
    units += before.length + replacement.length;
    if (units > maxTextCodeUnits) throw new __velarTextNativeRangeError("replaceMatches output cannot exceed 16 MiB");
    __velarTextAppend(output, before); __velarTextAppend(output, replacement);
    end = unitIndex + match.value.length;
  });
  const tail = __velarTextCall(__velarNativeStringSlice, value, [end]);
  if (units + tail.length > maxTextCodeUnits) throw new __velarTextNativeRangeError("replaceMatches output cannot exceed 16 MiB");
  __velarTextAppend(output, tail);
  return __velarTextJoin(output, "");
}
export function splitPattern(value, expression, options = {}) {
  value = valueOf(value); const output = []; let end = 0;
  eachMatch(value, patternOf(expression, options, true), (match, unitIndex) => { if (output.length >= maxTextItems) throw new __velarTextNativeRangeError("splitPattern cannot produce more than " + maxTextItems + " items"); __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [end, unitIndex])); end = unitIndex + match.value.length; });
  __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [end])); return output;
}
`.trimStart()],
  ["velar/math", String.raw`
const __velarMathNativeMath = globalThis.Math;
const __velarMathNativeNumber = globalThis.Number;
const __velarMathNativeTypeError = globalThis.TypeError;
const __velarMathNativeRangeError = globalThis.RangeError;
const __velarMathGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarMathApply = __velarMathGetOwnPropertyDescriptor(Reflect, "apply")?.value;
function __velarMathHostData(owner, key, kind) {
  const descriptor = __velarMathGetOwnPropertyDescriptor(owner, key);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== kind) throw new __velarMathNativeTypeError("The JavaScript " + key + " math API is unavailable");
  return descriptor.value;
}
function __velarMathHostOperation(owner, key) { return __velarMathHostData(owner, key, "function"); }
const __velarMathMin = __velarMathHostOperation(__velarMathNativeMath, "min");
const __velarMathMax = __velarMathHostOperation(__velarMathNativeMath, "max");
const __velarMathSign = __velarMathHostOperation(__velarMathNativeMath, "sign");
const __velarMathTrunc = __velarMathHostOperation(__velarMathNativeMath, "trunc");
const __velarMathSqrt = __velarMathHostOperation(__velarMathNativeMath, "sqrt");
const __velarMathCbrt = __velarMathHostOperation(__velarMathNativeMath, "cbrt");
const __velarMathPow = __velarMathHostOperation(__velarMathNativeMath, "pow");
const __velarMathExp = __velarMathHostOperation(__velarMathNativeMath, "exp");
const __velarMathLog = __velarMathHostOperation(__velarMathNativeMath, "log");
const __velarMathLog2 = __velarMathHostOperation(__velarMathNativeMath, "log2");
const __velarMathLog10 = __velarMathHostOperation(__velarMathNativeMath, "log10");
const __velarMathSin = __velarMathHostOperation(__velarMathNativeMath, "sin");
const __velarMathCos = __velarMathHostOperation(__velarMathNativeMath, "cos");
const __velarMathTan = __velarMathHostOperation(__velarMathNativeMath, "tan");
const __velarMathAsin = __velarMathHostOperation(__velarMathNativeMath, "asin");
const __velarMathAcos = __velarMathHostOperation(__velarMathNativeMath, "acos");
const __velarMathAtan = __velarMathHostOperation(__velarMathNativeMath, "atan");
const __velarMathAtan2 = __velarMathHostOperation(__velarMathNativeMath, "atan2");
const __velarMathHypot = __velarMathHostOperation(__velarMathNativeMath, "hypot");
const __velarMathRandom = __velarMathHostOperation(__velarMathNativeMath, "random");
const __velarMathFloor = __velarMathHostOperation(__velarMathNativeMath, "floor");
const __velarMathAbs = __velarMathHostOperation(__velarMathNativeMath, "abs");
const __velarMathNumberIsFinite = __velarMathHostOperation(__velarMathNativeNumber, "isFinite");
const __velarMathNumberIsInteger = __velarMathHostOperation(__velarMathNativeNumber, "isInteger");
const __velarMathNumberIsSafeInteger = __velarMathHostOperation(__velarMathNativeNumber, "isSafeInteger");
if (typeof __velarMathApply !== "function") throw new __velarMathNativeTypeError("The JavaScript Reflect.apply math API is unavailable");
function __velarMathCall(operation, arguments_) { return __velarMathApply(operation, undefined, arguments_); }
function requireNumber(value, name) { if (typeof value !== "number") throw new __velarMathNativeTypeError(name + " requires numbers"); return value; }
function unary(value, operation, name) { return __velarMathCall(operation, [requireNumber(value, name)]); }
function binary(left, right, operation, name) { return __velarMathCall(operation, [requireNumber(left, name), requireNumber(right, name)]); }
export const pi = __velarMathHostData(__velarMathNativeMath, "PI", "number");
export const e = __velarMathHostData(__velarMathNativeMath, "E", "number");
export const tau = pi * 2;
export const infinity = __velarMathHostData(__velarMathNativeNumber, "POSITIVE_INFINITY", "number");
export function min(...values) { if (!values.length) throw new __velarMathNativeRangeError("min requires at least one number"); let result = requireNumber(values[0], "min"); for (let index = 1; index < values.length; index += 1) result = __velarMathCall(__velarMathMin, [result, requireNumber(values[index], "min")]); return result; }
export function max(...values) { if (!values.length) throw new __velarMathNativeRangeError("max requires at least one number"); let result = requireNumber(values[0], "max"); for (let index = 1; index < values.length; index += 1) result = __velarMathCall(__velarMathMax, [result, requireNumber(values[index], "max")]); return result; }
export function clamp(value, minimum, maximum) { value = requireNumber(value, "clamp"); minimum = requireNumber(minimum, "clamp"); maximum = requireNumber(maximum, "clamp"); if (minimum > maximum) throw new __velarMathNativeRangeError("clamp minimum cannot exceed maximum"); return __velarMathCall(__velarMathMin, [maximum, __velarMathCall(__velarMathMax, [minimum, value])]); }
export function sign(value) { return unary(value, __velarMathSign, "sign"); }
export function trunc(value) { return unary(value, __velarMathTrunc, "trunc"); }
export function sqrt(value) { return unary(value, __velarMathSqrt, "sqrt"); }
export function cbrt(value) { return unary(value, __velarMathCbrt, "cbrt"); }
export function pow(left, right) { return binary(left, right, __velarMathPow, "pow"); }
export function exp(value) { return unary(value, __velarMathExp, "exp"); }
export function log(value, base = e) { return unary(value, __velarMathLog, "log") / unary(base, __velarMathLog, "log"); }
export function log2(value) { return unary(value, __velarMathLog2, "log2"); }
export function log10(value) { return unary(value, __velarMathLog10, "log10"); }
export function sin(value) { return unary(value, __velarMathSin, "sin"); }
export function cos(value) { return unary(value, __velarMathCos, "cos"); }
export function tan(value) { return unary(value, __velarMathTan, "tan"); }
export function asin(value) { return unary(value, __velarMathAsin, "asin"); }
export function acos(value) { return unary(value, __velarMathAcos, "acos"); }
export function atan(value) { return unary(value, __velarMathAtan, "atan"); }
export function atan2(left, right) { return binary(left, right, __velarMathAtan2, "atan2"); }
export function degrees(value) { return requireNumber(value, "degrees") * 180 / pi; }
export function radians(value) { return requireNumber(value, "radians") * pi / 180; }
export function hypot(left, right) { return binary(left, right, __velarMathHypot, "hypot"); }
export function random() { const value = __velarMathCall(__velarMathRandom, []); if (typeof value !== "number" || !__velarMathCall(__velarMathNumberIsFinite, [value])) throw new __velarMathNativeTypeError("The host random source must return a finite number"); if (value < 0 || value >= 1) throw new __velarMathNativeRangeError("The host random source must return a number from 0 up to but excluding 1"); return value; }
export function randomInt(minimum, maximum = null) { if (maximum === null) { maximum = minimum; minimum = 0; } const width = maximum - minimum; if (!__velarMathCall(__velarMathNumberIsSafeInteger, [minimum]) || !__velarMathCall(__velarMathNumberIsSafeInteger, [maximum]) || !__velarMathCall(__velarMathNumberIsSafeInteger, [width]) || width <= 0) throw new __velarMathNativeRangeError("randomInt requires an increasing safe-integer range"); return __velarMathCall(__velarMathFloor, [random() * width]) + minimum; }
export function gcd(left, right) { if (!__velarMathCall(__velarMathNumberIsSafeInteger, [left]) || !__velarMathCall(__velarMathNumberIsSafeInteger, [right])) throw new __velarMathNativeTypeError("gcd requires safe integers"); left = __velarMathCall(__velarMathAbs, [left]); right = __velarMathCall(__velarMathAbs, [right]); while (right) [left, right] = [right, left % right]; return left; }
export function lcm(left, right) { if (!__velarMathCall(__velarMathNumberIsSafeInteger, [left]) || !__velarMathCall(__velarMathNumberIsSafeInteger, [right])) throw new __velarMathNativeTypeError("lcm requires safe integers"); if (left === 0 || right === 0) return 0; const result = __velarMathCall(__velarMathAbs, [(left / gcd(left, right)) * right]); if (!__velarMathCall(__velarMathNumberIsSafeInteger, [result])) throw new __velarMathNativeRangeError("lcm result is outside the safe-integer range"); return result; }
`.trimStart()],
  ["velar/json", String.raw`
${VELAR_STRICT_JSON_RUNTIME}
${runtimeTypeRuntime}
function runtimeType(Type) { return __velarRequireRuntimeType(Type, "JSON validation", true); }
export function parse(text, Type = null) { if (typeof text !== "string") throw new __velarJsonNativeTypeError("json.parse requires a string"); Type = runtimeType(Type); const value = __velarJsonParse(text); return Type ? Type.parse(value) : value; }
export function tryParse(text, Type = null, fallback = null) { Type = runtimeType(Type); try { return parse(text, Type); } catch { return fallback; } }
export function stringify(value, pretty = false) { return __velarJsonStringify(value, pretty); }
function sorted(value) {
  if (value === null || typeof value !== "object") return value;
  if (__velarJsonApply(__velarJsonArrayIsArray, __velarJsonNativeArray, [value], "Array.isArray")) {
    const output = new __velarJsonNativeArray(value.length);
    for (let index = 0; index < value.length; index += 1) output[index] = sorted(__velarJsonGetOwnPropertyDescriptor(value, index).value);
    return output;
  }
  const result = __velarJsonApply(__velarJsonCreate, __velarJsonNativeObject, [null], "Object.create");
  const keys = __velarJsonGetOwnPropertyNames(value);
  __velarJsonApply(__velarJsonArraySort, keys, [], "Array.sort");
  for (let index = 0; index < keys.length; index += 1) { const key = keys[index]; __velarJsonApply(__velarJsonDefineProperty, __velarJsonNativeObject, [result, key, { value: sorted(__velarJsonGetOwnPropertyDescriptor(value, key).value), enumerable: true, configurable: true, writable: true }], "Object.defineProperty"); }
  return result;
}
export function stableStringify(value, pretty = false) { return __velarJsonStringify(sorted(__velarJsonSnapshot(value).value), pretty); }
export function clone(value, Type = null) { Type = runtimeType(Type); const cloned = __velarJsonClone(value); return Type ? Type.parse(cloned) : cloned; }
export function isSerializable(value) { try { __velarAssertJson(value); return true; } catch { return false; } }
`.trimStart()],
  ["velar/async", String.raw`
${listRuntime}
const __velarMaxTimerMilliseconds = 2147483647;
const __velarMaxAsyncFanout = 10000;
const __velarAsyncGlobal = globalThis;
const __velarAsyncApply = Reflect.apply;
const __velarAsyncPromise = Promise;
const __velarAsyncPromiseThen = Promise.prototype.then;
const __velarAsyncSetTimeout = globalThis.setTimeout;
const __velarAsyncClearTimeout = globalThis.clearTimeout;
const __velarAsyncNumber = Number;
const __velarAsyncNumberIsFinite = Number.isFinite;
const __velarAsyncNumberIsSafeInteger = Number.isSafeInteger;
const __velarAsyncRegExpExec = RegExp.prototype.exec;
const __velarAsyncDurationPattern = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/;
const __velarAsyncGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarAsyncGetOwnPropertyNames = Object.getOwnPropertyNames;
const __velarAsyncGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const __velarAsyncGetPrototypeOf = Object.getPrototypeOf;
const __velarAsyncCreate = Object.create;
const __velarAsyncDefineProperty = Object.defineProperty;
const __velarAsyncTypeError = TypeError;
const __velarAsyncRangeError = RangeError;
const __velarAsyncError = Error;
const __velarAsyncDetachedRegistryKey = Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)});
const __velarAsyncConsole = globalThis.console;
const __velarAsyncConsoleError = __velarAsyncConsole ? __velarAsyncConsole.error : null;
function asyncFanout(values, name) { values = __velarRequireList(values, name); if (values.length > __velarMaxAsyncFanout) throw new __velarAsyncRangeError(name + " cannot start more than 10000 operations at once"); return values; }
function durationMilliseconds(value, name) { if (typeof value !== "string") throw new __velarAsyncTypeError(name + " requires Duration; write a value such as 200ms or 2s"); const match = __velarAsyncApply(__velarAsyncRegExpExec, __velarAsyncDurationPattern, [value]); if (!match) throw new __velarAsyncTypeError(name + " requires Duration; write a value such as 200ms or 2s"); const milliseconds = __velarAsyncNumber(match[1]) * (match[2] === "s" ? 1000 : 1); if (!__velarAsyncNumberIsFinite(milliseconds) || milliseconds < 0 || milliseconds > __velarMaxTimerMilliseconds) throw new __velarAsyncRangeError(name + " requires a Duration from 0ms through 2147483647ms"); return milliseconds; }
export function sleep(duration) { const milliseconds = durationMilliseconds(duration, "sleep"); return new __velarAsyncPromise((resolve) => __velarAsyncApply(__velarAsyncSetTimeout, __velarAsyncGlobal, [() => resolve(null), milliseconds])); }
function normalize(value) { return value === undefined ? null : value; }
function reportAsyncLoser(failure) { try { const runtime = globalThis[__velarAsyncDetachedRegistryKey]; if (runtime && typeof runtime.report === "function") { runtime.report(failure, { phase: "detached", detail: "async combinator loser", unhandled: true }); return null; } if (typeof __velarAsyncConsoleError === "function") __velarAsyncApply(__velarAsyncConsoleError, __velarAsyncConsole, ["Detached async task failed: " + (failure && failure.stack ? failure.stack : String(failure))]); } catch {} return null; }
function actualPromise(value, name) { try { return __velarAsyncApply(__velarAsyncPromiseThen, value, [normalize]); } catch { throw new __velarAsyncTypeError(name + " requires actual Promises"); } }
function optionalActualPromise(value) { try { return __velarAsyncApply(__velarAsyncPromiseThen, value, [normalize]); } catch { return null; } }
function promiseList(values, name) { const output = new __velarListArray(values.length); for (let index = 0; index < values.length; index += 1) output[index] = actualPromise(values[index], name); return output; }
function promiseAll(values) {
  return new __velarAsyncPromise((resolve, reject) => {
    const output = new __velarListArray(values.length);
    if (values.length === 0) { resolve(output); return; }
    let remaining = values.length;
    let settled = false;
    for (let index = 0; index < values.length; index += 1) {
      try {
        __velarAsyncApply(__velarAsyncPromiseThen, values[index], [
          (value) => { output[index] = value; remaining -= 1; if (remaining === 0 && !settled) { settled = true; resolve(output); } },
          (failure) => { if (settled) reportAsyncLoser(failure); else { settled = true; reject(failure); } },
        ]);
      } catch (error) { if (settled) reportAsyncLoser(error); else { settled = true; reject(error); } }
    }
  });
}
function promiseRace(values) {
  return new __velarAsyncPromise((resolve, reject) => {
    let settled = false;
    for (let index = 0; index < values.length; index += 1) {
      try { __velarAsyncApply(__velarAsyncPromiseThen, values[index], [(value) => { if (!settled) { settled = true; resolve(value); } }, (failure) => { if (settled) reportAsyncLoser(failure); else { settled = true; reject(failure); } }]); }
      catch (error) { if (settled) reportAsyncLoser(error); else { settled = true; reject(error); } }
    }
  });
}
function requireSafePromiseResult(value, name) {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return value;
  let owner = value;
  for (let depth = 0; owner !== null && depth < 128; depth += 1) {
    let descriptor;
    try { descriptor = __velarAsyncGetOwnPropertyDescriptor(owner, "then"); }
    catch { throw new __velarAsyncTypeError(name + " result must not expose a callable 'then' or a 'then' getter"); }
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value === "function") throw new __velarAsyncTypeError(name + " result must not expose a callable 'then' or a 'then' getter");
      return value;
    }
    try { owner = __velarAsyncGetPrototypeOf(owner); }
    catch { throw new __velarAsyncTypeError(name + " result must have an inspectable prototype chain"); }
  }
  if (owner !== null) throw new __velarAsyncTypeError(name + " result prototype chain is too deep");
  return value;
}
function promiseRecord(value, name) { if (value === null || typeof value !== "object" || __velarListArrayIsArray(value) || __velarAsyncGetOwnPropertySymbols(value).length > 0) throw new __velarAsyncTypeError(name + " requires a List or record of Promises"); const names = __velarAsyncGetOwnPropertyNames(value); if (names.length > __velarMaxAsyncFanout) throw new __velarAsyncRangeError(name + " cannot start more than 10000 operations at once"); const promises = new __velarListArray(names.length); for (let index = 0; index < names.length; index += 1) { const descriptor = __velarAsyncGetOwnPropertyDescriptor(value, names[index]); if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new __velarAsyncTypeError(name + " record fields must be enumerable data values"); promises[index] = actualPromise(descriptor.value, name); } return __velarAsyncApply(__velarAsyncPromiseThen, promiseAll(promises), [(results) => { const output = __velarAsyncCreate(null); for (let index = 0; index < names.length; index += 1) __velarAsyncDefineProperty(output, names[index], { value: results[index], enumerable: true, configurable: true, writable: true }); return output; }]); }
export async function all(values) { if (__velarListArrayIsArray(values)) { values = asyncFanout(values, "async.all"); return promiseAll(promiseList(values, "async.all")); } return promiseRecord(values, "async.all"); }
export async function race(values) { values = asyncFanout(values, "async.race"); if (values.length === 0) throw new __velarAsyncRangeError("race requires at least one Promise"); return promiseRace(promiseList(values, "async.race")); }
export async function timeout(value, duration, message = "Operation timed out") { value = actualPromise(value, "async.timeout"); const milliseconds = durationMilliseconds(duration, "timeout"); if (typeof message !== "string") throw new __velarAsyncTypeError("timeout message must be a string"); if (message.length > 65536) throw new __velarAsyncRangeError("timeout messages cannot exceed 64 KiB"); let timer; const timeoutPromise = new __velarAsyncPromise((_, reject) => { timer = __velarAsyncApply(__velarAsyncSetTimeout, __velarAsyncGlobal, [() => reject(new __velarAsyncError(message)), milliseconds]); }); try { return normalize(await promiseRace([value, timeoutPromise])); } finally { if (timer !== undefined) __velarAsyncApply(__velarAsyncClearTimeout, __velarAsyncGlobal, [timer]); } }
export async function retry(task, attempts = 3, delay = "0ms") { if (typeof task !== "function") throw new __velarAsyncTypeError("retry requires a function"); if (!__velarAsyncNumberIsSafeInteger(attempts) || attempts < 1 || attempts > 10000) throw new __velarAsyncRangeError("retry attempts must be an integer from 1 through 10000"); durationMilliseconds(delay, "retry delay"); let last; for (let attempt = 0; attempt < attempts; attempt += 1) { try { const candidate = normalize(__velarAsyncApply(task, undefined, [])); const pending = optionalActualPromise(candidate); return pending ? await pending : requireSafePromiseResult(candidate, "async.retry"); } catch (error) { last = error; if (attempt + 1 < attempts && delay !== "0ms") await sleep(delay); } } throw last; }
export async function map(values, worker, concurrency = 4) { values = __velarRequireList(values, "async.map"); if (typeof worker !== "function") throw new __velarAsyncTypeError("async.map requires a worker"); if (!__velarAsyncNumberIsSafeInteger(concurrency) || concurrency < 1 || concurrency > 1024) throw new __velarAsyncRangeError("async.map concurrency must be an integer from 1 through 1024"); const output = new __velarListArray(values.length); let cursor = 0, stopped = false; async function run() { try { while (!stopped) { const index = cursor++; if (index >= values.length) return null; const candidate = normalize(__velarAsyncApply(worker, undefined, [values[index]])); const pending = optionalActualPromise(candidate); output[index] = pending ? await pending : candidate; } return null; } catch (failure) { stopped = true; throw failure; } } const workerCount = concurrency < values.length ? concurrency : values.length; const workers = new __velarListArray(workerCount); for (let index = 0; index < workerCount; index += 1) workers[index] = run(); await promiseAll(workers); return output; }
export async function series(tasks) { tasks = __velarRequireList(tasks, "async.series"); const output = new __velarListArray(tasks.length); for (let index = 0; index < tasks.length; index += 1) { const task = tasks[index]; if (typeof task !== "function") throw new __velarAsyncTypeError("series requires a List of functions"); const candidate = normalize(__velarAsyncApply(task, undefined, [])); const pending = optionalActualPromise(candidate); output[index] = pending ? await pending : candidate; } return output; }
`.trimStart()],
  ["velar/url", String.raw`
${listRuntime}
const fallbackBase = "https://velar.invalid/";
const maxUrlCodeUnits = 2 * 1024 * 1024;
const __velarUrlNativeObject = globalThis.Object;
const __velarUrlNativeMap = globalThis.Map;
const __velarUrlNativeNumber = globalThis.Number;
const __velarUrlNativeString = globalThis.String;
const __velarUrlNativeUrl = globalThis.URL;
const __velarUrlNativeSearchParams = globalThis.URLSearchParams;
const __velarUrlNativeTypeError = globalThis.TypeError;
const __velarUrlNativeRangeError = globalThis.RangeError;
const __velarUrlNativeUriError = globalThis.URIError;
const __velarUrlGetOwnPropertyDescriptor = __velarUrlNativeObject.getOwnPropertyDescriptor;
const __velarUrlGetOwnPropertyNames = __velarUrlNativeObject.getOwnPropertyNames;
const __velarUrlGetOwnPropertySymbols = __velarUrlNativeObject.getOwnPropertySymbols;
const __velarUrlGetPrototypeOf = __velarUrlNativeObject.getPrototypeOf;
const __velarUrlApply = __velarUrlGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
function __velarUrlHostData(owner, key, kind) {
  const descriptor = __velarUrlGetOwnPropertyDescriptor(owner, key);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== kind) throw new __velarUrlNativeTypeError("The JavaScript " + key + " URL API is unavailable");
  return descriptor.value;
}
function __velarUrlHostOperation(owner, key) { return __velarUrlHostData(owner, key, "function"); }
function __velarUrlHostAccessor(owner, key, setter = false) {
  for (let depth = 0; owner !== null && depth < 32; depth += 1) {
    const descriptor = __velarUrlGetOwnPropertyDescriptor(owner, key);
    if (descriptor) {
      const operation = descriptor[setter ? "set" : "get"];
      if (typeof operation !== "function") throw new __velarUrlNativeTypeError("The JavaScript " + key + " URL API must be an accessor");
      return operation;
    }
    owner = __velarUrlGetPrototypeOf(owner);
  }
  throw new __velarUrlNativeTypeError("The JavaScript " + key + " URL API is unavailable");
}
function __velarUrlInheritedDescriptor(owner, key) {
  for (let depth = 0; owner !== null && depth < 32; depth += 1) {
    const descriptor = __velarUrlGetOwnPropertyDescriptor(owner, key);
    if (descriptor) return descriptor;
    owner = __velarUrlGetPrototypeOf(owner);
  }
  return null;
}
function __velarUrlInheritedOperation(owner, key) {
  const descriptor = __velarUrlInheritedDescriptor(owner, key);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") throw new __velarUrlNativeTypeError("The JavaScript " + key + " URL API must be a data function");
  return descriptor.value;
}
const __velarUrlObjectPrototype = __velarUrlHostData(__velarUrlNativeObject, "prototype", "object");
const __velarUrlStringPrototype = __velarUrlHostData(__velarUrlNativeString, "prototype", "object");
const __velarUrlUrlPrototype = __velarUrlHostData(__velarUrlNativeUrl, "prototype", "object");
const __velarUrlSearchParamsPrototype = __velarUrlHostData(__velarUrlNativeSearchParams, "prototype", "object");
const __velarUrlMapPrototype = __velarUrlHostData(__velarUrlNativeMap, "prototype", "object");
const __velarUrlEncodeURIComponent = globalThis.encodeURIComponent;
const __velarUrlDecodeURIComponent = globalThis.decodeURIComponent;
const __velarUrlNumberIsFinite = __velarUrlHostOperation(__velarUrlNativeNumber, "isFinite");
const __velarUrlObjectFreeze = __velarUrlHostOperation(__velarUrlNativeObject, "freeze");
const __velarUrlStringCharCodeAt = __velarUrlHostOperation(__velarUrlStringPrototype, "charCodeAt");
const __velarUrlStringEndsWith = __velarUrlHostOperation(__velarUrlStringPrototype, "endsWith");
const __velarUrlStringSlice = __velarUrlHostOperation(__velarUrlStringPrototype, "slice");
const __velarUrlStringStartsWith = __velarUrlHostOperation(__velarUrlStringPrototype, "startsWith");
const __velarUrlRegExpPattern = /^[a-z][a-z\d+.-]*:/iu;
const __velarUrlHttpPattern = /^https?:$/u;
const __velarUrlRegExpTest = __velarUrlInheritedOperation(__velarUrlRegExpPattern, "test");
const __velarUrlSearchParamsAppend = __velarUrlHostOperation(__velarUrlSearchParamsPrototype, "append");
const __velarUrlSearchParamsEntries = __velarUrlHostOperation(__velarUrlSearchParamsPrototype, "entries");
const __velarUrlSearchParamsToString = __velarUrlHostOperation(__velarUrlSearchParamsPrototype, "toString");
const __velarUrlMapEntries = __velarUrlHostOperation(__velarUrlMapPrototype, "entries");
const __velarUrlMapSet = __velarUrlHostOperation(__velarUrlMapPrototype, "set");
const __velarUrlMapSize = __velarUrlHostAccessor(__velarUrlMapPrototype, "size");
const __velarUrlHref = __velarUrlHostAccessor(__velarUrlUrlPrototype, "href");
const __velarUrlProtocol = __velarUrlHostAccessor(__velarUrlUrlPrototype, "protocol");
const __velarUrlHost = __velarUrlHostAccessor(__velarUrlUrlPrototype, "host");
const __velarUrlHostname = __velarUrlHostAccessor(__velarUrlUrlPrototype, "hostname");
const __velarUrlPort = __velarUrlHostAccessor(__velarUrlUrlPrototype, "port");
const __velarUrlPathname = __velarUrlHostAccessor(__velarUrlUrlPrototype, "pathname");
const __velarUrlSearch = __velarUrlHostAccessor(__velarUrlUrlPrototype, "search");
const __velarUrlSetSearch = __velarUrlHostAccessor(__velarUrlUrlPrototype, "search", true);
const __velarUrlHash = __velarUrlHostAccessor(__velarUrlUrlPrototype, "hash");
const __velarUrlSetHash = __velarUrlHostAccessor(__velarUrlUrlPrototype, "hash", true);
const __velarUrlOrigin = __velarUrlHostAccessor(__velarUrlUrlPrototype, "origin");
const __velarUrlSearchIterator = __velarUrlApply(__velarUrlSearchParamsEntries, new __velarUrlNativeSearchParams(), []);
const __velarUrlSearchIteratorNext = __velarUrlInheritedOperation(__velarUrlSearchIterator, "next");
const __velarUrlMapIterator = __velarUrlApply(__velarUrlMapEntries, new __velarUrlNativeMap(), []);
const __velarUrlMapIteratorNext = __velarUrlInheritedOperation(__velarUrlMapIterator, "next");
const __velarUrlLocation = globalThis.location;
const __velarUrlLocationHrefDescriptor = __velarUrlLocation && (typeof __velarUrlLocation === "object" || typeof __velarUrlLocation === "function") ? __velarUrlInheritedDescriptor(__velarUrlLocation, "href") : null;
const __velarUrlLocationHrefGetter = __velarUrlLocationHrefDescriptor && typeof __velarUrlLocationHrefDescriptor.get === "function" ? __velarUrlLocationHrefDescriptor.get : null;
const __velarUrlLocationHrefData = __velarUrlLocationHrefDescriptor && "value" in __velarUrlLocationHrefDescriptor ? __velarUrlLocationHrefDescriptor.value : null;
if (typeof __velarUrlApply !== "function" || typeof __velarUrlEncodeURIComponent !== "function" || typeof __velarUrlDecodeURIComponent !== "function") throw new __velarUrlNativeTypeError("The JavaScript URL host API is unavailable");
function __velarUrlCall(operation, receiver, arguments_) { return __velarUrlApply(operation, receiver, arguments_); }
function urlText(value, name = "velar/url") { if (typeof value !== "string") throw new __velarUrlNativeTypeError(name + " requires a string"); if (value.length > maxUrlCodeUnits) throw new __velarUrlNativeRangeError(name + " cannot exceed 2 MiB"); return value; }
function ownData(container, key, name) { if (container === null || typeof container !== "object") throw new __velarUrlNativeTypeError(name + " must belong to an object"); const descriptor = __velarUrlGetOwnPropertyDescriptor(container, key); if (!descriptor || !("value" in descriptor)) throw new __velarUrlNativeTypeError(name + " must be an own data field"); return descriptor.value; }
function encodedComponentUnits(value) {
  let units = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = __velarUrlCall(__velarUrlStringCharCodeAt, value, [index]);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57)
      || code === 45 || code === 95 || code === 46 || code === 33 || code === 126
      || code === 42 || code === 39 || code === 40 || code === 41) units += 1;
    else if (code < 0x80) units += 3;
    else if (code < 0x800) units += 6;
    else if (code >= 0xD800 && code <= 0xDBFF) {
      const next = __velarUrlCall(__velarUrlStringCharCodeAt, value, [index + 1]);
      if (next < 0xDC00 || next > 0xDFFF) throw new __velarUrlNativeUriError("URI malformed");
      units += 12;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) throw new __velarUrlNativeUriError("URI malformed");
    else units += 9;
    if (units > maxUrlCodeUnits) return units;
  }
  return units;
}
function baseOf(base) { if (base !== "") return urlText(base, "URL base"); if (!__velarUrlLocationHrefDescriptor) return fallbackBase; const href = __velarUrlLocationHrefGetter ? __velarUrlCall(__velarUrlLocationHrefGetter, __velarUrlLocation, []) : __velarUrlLocationHrefData; return urlText(href, "Browser URL base"); }
function urlOf(value, base = "") { return new __velarUrlNativeUrl(urlText(value), baseOf(base)); }
function urlField(url, operation, name) { return urlText(__velarUrlCall(operation, url, []), name); }
function urlSnapshot(url) {
  const search = urlField(url, __velarUrlSearch, "URL query");
  return __velarUrlCall(__velarUrlObjectFreeze, __velarUrlNativeObject, [{
    href: urlField(url, __velarUrlHref, "URL href"), protocol: urlField(url, __velarUrlProtocol, "URL protocol"), host: urlField(url, __velarUrlHost, "URL host"),
    hostname: urlField(url, __velarUrlHostname, "URL hostname"), port: urlField(url, __velarUrlPort, "URL port"), path: urlField(url, __velarUrlPathname, "URL path"),
    query: queryMap(search, "URL query"), hash: urlField(url, __velarUrlHash, "URL hash"), origin: urlField(url, __velarUrlOrigin, "URL origin"),
  }]);
}
function joinedUrlOutput(parts) {
  let units = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.length > maxUrlCodeUnits - units) throw new __velarUrlNativeRangeError("URL output cannot exceed 2 MiB");
    units += part.length;
  }
  let output = "";
  for (let index = 0; index < parts.length; index += 1) output += parts[index];
  return output;
}
function restore(original, url) {
  const href = urlField(url, __velarUrlHref, "URL href"), host = urlField(url, __velarUrlHost, "URL host"), path = urlField(url, __velarUrlPathname, "URL path");
  const search = urlField(url, __velarUrlSearch, "URL query"), hash = urlField(url, __velarUrlHash, "URL hash");
  if (__velarUrlCall(__velarUrlRegExpTest, __velarUrlRegExpPattern, [original])) return href;
  return __velarUrlCall(__velarUrlStringStartsWith, original, ["//"]) ? joinedUrlOutput(["//", host, path, search, hash]) : joinedUrlOutput([path, search, hash]);
}
function nextEntry(iterator, operation, name) { const step = __velarUrlCall(operation, iterator, []); const done = ownData(step, "done", name + " iterator result"); if (typeof done !== "boolean") throw new __velarUrlNativeTypeError(name + " iterator must return a boolean done field"); if (done) return null; const pair = ownData(step, "value", name + " iterator result"); if (!__velarUrlCall(__velarListArrayIsArray, __velarListArray, [pair]) || pair.length !== 2) throw new __velarUrlNativeTypeError(name + " iterator must return key/value pairs"); return [ownData(pair, 0, name + " key"), ownData(pair, 1, name + " value")]; }
function queryMap(search, name) {
  search = urlText(search, name);
  const output = new __velarUrlNativeMap();
  const iterator = __velarUrlCall(__velarUrlSearchParamsEntries, new __velarUrlNativeSearchParams(search), []);
  let count = 0;
  let codeUnits = 0;
  while (true) {
    const entry = nextEntry(iterator, __velarUrlSearchIteratorNext, name);
    if (entry === null) break;
    const key = entry[0], value = entry[1];
    count += 1;
    if (count > 100000) throw new __velarUrlNativeRangeError(name + " cannot exceed 100000 fields");
    if (typeof key !== "string" || typeof value !== "string") throw new __velarUrlNativeTypeError(name + " must contain string fields");
    codeUnits += key.length + value.length;
    if (codeUnits > 2 * 1024 * 1024) throw new __velarUrlNativeRangeError(name + " cannot exceed 2 MiB");
    __velarUrlCall(__velarUrlMapSet, output, [key, value]);
  }
  return output;
}
function appendQueryValue(output, name, value, budget) {
  if (value == null) return;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new __velarUrlNativeTypeError("URL query value '" + name + "' must be a string, number, bool, null, or List of those values");
  if (typeof value === "number" && !__velarUrlCall(__velarUrlNumberIsFinite, __velarUrlNativeNumber, [value])) throw new __velarUrlNativeTypeError("URL query numbers must be finite");
  const text = __velarUrlCall(__velarUrlNativeString, undefined, [value]);
  budget.units += (name.length + text.length) * 9 + 2;
  if (budget.units > 2 * 1024 * 1024) throw new __velarUrlNativeRangeError("URL query output cannot exceed 2 MiB");
  __velarUrlCall(__velarUrlSearchParamsAppend, output, [name, text]);
}
function appendNamedValue(output, name, value, budget) { if (typeof name !== "string") throw new __velarUrlNativeTypeError("URL query names must be strings"); if (__velarUrlCall(__velarListArrayIsArray, __velarListArray, [value])) { const values = __velarRequireList(value, "URL query list"); for (let index = 0; index < values.length; index += 1) appendQueryValue(output, name, values[index], budget); } else appendQueryValue(output, name, value, budget); }
function appendParams(params, output) {
  let mapSize = null;
  try { mapSize = __velarUrlCall(__velarUrlMapSize, params, []); } catch {}
  const budget = { units: 0 };
  if (mapSize !== null) {
    if (mapSize > 100000) throw new __velarUrlNativeRangeError("URL query values cannot exceed 100000 fields");
    const iterator = __velarUrlCall(__velarUrlMapEntries, params, []);
    for (let index = 0; index < mapSize; index += 1) {
      const entry = nextEntry(iterator, __velarUrlMapIteratorNext, "URL query Map");
      if (entry === null) throw new __velarUrlNativeTypeError("URL query Map ended before its size");
      appendNamedValue(output, entry[0], entry[1], budget);
    }
    if (nextEntry(iterator, __velarUrlMapIteratorNext, "URL query Map") !== null) throw new __velarUrlNativeTypeError("URL query Map exceeded its size");
  } else if (params && typeof params === "object" && !__velarUrlCall(__velarListArrayIsArray, __velarListArray, [params])
    && (__velarUrlGetPrototypeOf(params) === __velarUrlObjectPrototype || __velarUrlGetPrototypeOf(params) === null)
    && __velarUrlGetOwnPropertySymbols(params).length === 0) {
    const names = __velarUrlGetOwnPropertyNames(params);
    if (names.length > 100000) throw new __velarUrlNativeRangeError("URL query values cannot exceed 100000 fields");
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const descriptor = __velarUrlGetOwnPropertyDescriptor(params, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarUrlNativeTypeError("URL query record fields must be enumerable data values");
      appendNamedValue(output, name, descriptor.value, budget);
    }
  } else throw new __velarUrlNativeTypeError("URL query values require a Map or record");
}
export function parse(value, base = "") { return urlSnapshot(urlOf(value, base)); }
export function join(...parts) {
  if (!parts.length) throw new __velarUrlNativeRangeError("url.join requires at least one part");
  let output = urlText(parts[0], "url.join");
  for (let index = 1; index < parts.length; index += 1) {
    const value = urlText(parts[index], "url.join");
    if (!value) continue;
    let start = 0, end = value.length;
    while (start < end && value[start] === "/") start += 1;
    while (end > start && value[end - 1] === "/") end -= 1;
    const segment = __velarUrlCall(__velarUrlStringSlice, value, [start, end]);
    const scheme = __velarUrlCall(__velarUrlStringEndsWith, output, ["://"]);
    let prefixEnd = output.length;
    while (!scheme && prefixEnd > 0 && output[prefixEnd - 1] === "/") prefixEnd -= 1;
    const prefix = scheme ? output : __velarUrlCall(__velarUrlStringSlice, output, [0, prefixEnd]);
    const separator = scheme ? "" : "/";
    if (separator.length + segment.length > maxUrlCodeUnits - prefix.length) {
      throw new __velarUrlNativeRangeError("url.join output cannot exceed 2 MiB");
    }
    output = prefix + separator + segment;
  }
  return output;
}
export function query(params) { const output = new __velarUrlNativeSearchParams(); appendParams(params, output); return urlText(__velarUrlCall(__velarUrlSearchParamsToString, output, []), "URL query output"); }
export function parseQuery(value) { value = urlText(value, "parseQuery"); if (value[0] === "?") value = __velarUrlCall(__velarUrlStringSlice, value, [1]); return queryMap(value, "URL query"); }
export function withQuery(value, params) { const url = urlOf(value); const searchParams = new __velarUrlNativeSearchParams(); appendParams(params, searchParams); const search = urlText(__velarUrlCall(__velarUrlSearchParamsToString, searchParams, []), "URL query output"); __velarUrlCall(__velarUrlSetSearch, url, [search ? "?" + search : ""]); return restore(value, url); }
export function withHash(value, hash) { const url = urlOf(value); hash = urlText(hash, "withHash"); if (hash[0] === "#") hash = __velarUrlCall(__velarUrlStringSlice, hash, [1]); __velarUrlCall(__velarUrlSetHash, url, [hash ? "#" + hash : ""]); return restore(value, url); }
export function isExternal(value, base = "") { value = urlText(value, "isExternal"); if (base) urlText(base, "URL base"); try { const url = urlOf(value, base); const baseUrl = new __velarUrlNativeUrl(baseOf(base)); const origin = urlField(baseUrl, __velarUrlOrigin, "URL origin"); return urlField(url, __velarUrlOrigin, "URL origin") !== origin || !__velarUrlCall(__velarUrlRegExpTest, __velarUrlHttpPattern, [urlField(url, __velarUrlProtocol, "URL protocol")]); } catch { return true; } }
export function encode(value) { value = urlText(value, "encode"); if (encodedComponentUnits(value) > maxUrlCodeUnits) throw new __velarUrlNativeRangeError("encode output cannot exceed 2 MiB"); return urlText(__velarUrlCall(__velarUrlEncodeURIComponent, globalThis, [value]), "encode output"); }
export function decode(value) { return urlText(__velarUrlCall(__velarUrlDecodeURIComponent, globalThis, [urlText(value, "decode")]), "decode output"); }
export function normalize(value, base = "") { const url = urlOf(value, base); return restore(value, url); }
`.trimStart()],
  ["velar/time", String.raw`
const maximumDateMilliseconds = 8_640_000_000_000_000;
const __velarTimeNativeObject = globalThis.Object;
const __velarTimeNativeArray = globalThis.Array;
const __velarTimeNativeNumber = globalThis.Number;
const __velarTimeNativeString = globalThis.String;
const __velarTimeNativeMath = globalThis.Math;
const __velarTimeNativeDate = globalThis.Date;
const __velarTimeNativeTypeError = globalThis.TypeError;
const __velarTimeNativeRangeError = globalThis.RangeError;
const __velarTimeGetOwnPropertyDescriptor = __velarTimeNativeObject.getOwnPropertyDescriptor;
const __velarTimeGetPrototypeOf = __velarTimeNativeObject.getPrototypeOf;
const __velarTimeApply = __velarTimeGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
function __velarTimeHostData(owner, key, kind) {
  const descriptor = __velarTimeGetOwnPropertyDescriptor(owner, key);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== kind) throw new __velarTimeNativeTypeError("The JavaScript " + key + " time API is unavailable");
  return descriptor.value;
}
function __velarTimeHostOperation(owner, key) { return __velarTimeHostData(owner, key, "function"); }
function __velarTimeHostGetter(owner, key) {
  const descriptor = __velarTimeGetOwnPropertyDescriptor(owner, key);
  if (!descriptor || typeof descriptor.get !== "function") throw new __velarTimeNativeTypeError("The JavaScript " + key + " time API is unavailable");
  return descriptor.get;
}
function __velarTimeInheritedOperation(owner, key) {
  for (let depth = 0; owner !== null && depth < 32; depth += 1) {
    const descriptor = __velarTimeGetOwnPropertyDescriptor(owner, key);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") throw new __velarTimeNativeTypeError("The JavaScript " + key + " time API must be a data function");
      return descriptor.value;
    }
    owner = __velarTimeGetPrototypeOf(owner);
  }
  throw new __velarTimeNativeTypeError("The JavaScript " + key + " time API is unavailable");
}
const __velarTimeDatePrototype = __velarTimeHostData(__velarTimeNativeDate, "prototype", "object");
const __velarTimeIntl = __velarTimeHostData(globalThis, "Intl", "object");
const __velarTimeDateTimeFormat = __velarTimeHostOperation(__velarTimeIntl, "DateTimeFormat");
const __velarTimeDateTimeFormatPrototype = __velarTimeHostData(__velarTimeDateTimeFormat, "prototype", "object");
const __velarTimeRegExpPattern = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/u;
const __velarTimeDigitsPattern = /^\d{1,6}$/u;
const __velarTimeRegExpPrototype = __velarTimeGetPrototypeOf(__velarTimeRegExpPattern);
const __velarTimeDateNow = __velarTimeHostOperation(__velarTimeNativeDate, "now");
const __velarTimeMathAbs = __velarTimeHostOperation(__velarTimeNativeMath, "abs");
const __velarTimeNumberIsFinite = __velarTimeHostOperation(__velarTimeNativeNumber, "isFinite");
const __velarTimeNumberIsInteger = __velarTimeHostOperation(__velarTimeNativeNumber, "isInteger");
const __velarTimeNumberIsSafeInteger = __velarTimeHostOperation(__velarTimeNativeNumber, "isSafeInteger");
const __velarTimeArrayIsArray = __velarTimeHostOperation(__velarTimeNativeArray, "isArray");
const __velarTimeObjectFreeze = __velarTimeHostOperation(__velarTimeNativeObject, "freeze");
const __velarTimeStringPadEnd = __velarTimeHostOperation(__velarTimeHostData(__velarTimeNativeString, "prototype", "object"), "padEnd");
const __velarTimeStringSlice = __velarTimeHostOperation(__velarTimeHostData(__velarTimeNativeString, "prototype", "object"), "slice");
const __velarTimeRegExpExec = __velarTimeHostOperation(__velarTimeRegExpPrototype, "exec");
const __velarTimeFormatGetter = __velarTimeHostGetter(__velarTimeDateTimeFormatPrototype, "format");
const __velarTimeFormatToParts = __velarTimeHostOperation(__velarTimeDateTimeFormatPrototype, "formatToParts");
const __velarTimeSetUTCFullYear = __velarTimeHostOperation(__velarTimeDatePrototype, "setUTCFullYear");
const __velarTimeSetUTCHours = __velarTimeHostOperation(__velarTimeDatePrototype, "setUTCHours");
const __velarTimeSetFullYear = __velarTimeHostOperation(__velarTimeDatePrototype, "setFullYear");
const __velarTimeSetHours = __velarTimeHostOperation(__velarTimeDatePrototype, "setHours");
const __velarTimeGetUTCFullYear = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCFullYear");
const __velarTimeGetUTCMonth = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCMonth");
const __velarTimeGetUTCDate = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCDate");
const __velarTimeGetUTCHours = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCHours");
const __velarTimeGetUTCMinutes = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCMinutes");
const __velarTimeGetUTCSeconds = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCSeconds");
const __velarTimeGetUTCMilliseconds = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCMilliseconds");
const __velarTimeGetFullYear = __velarTimeHostOperation(__velarTimeDatePrototype, "getFullYear");
const __velarTimeGetMonth = __velarTimeHostOperation(__velarTimeDatePrototype, "getMonth");
const __velarTimeGetDate = __velarTimeHostOperation(__velarTimeDatePrototype, "getDate");
const __velarTimeGetDay = __velarTimeHostOperation(__velarTimeDatePrototype, "getDay");
const __velarTimeGetHours = __velarTimeHostOperation(__velarTimeDatePrototype, "getHours");
const __velarTimeGetMinutes = __velarTimeHostOperation(__velarTimeDatePrototype, "getMinutes");
const __velarTimeGetSeconds = __velarTimeHostOperation(__velarTimeDatePrototype, "getSeconds");
const __velarTimeGetMilliseconds = __velarTimeHostOperation(__velarTimeDatePrototype, "getMilliseconds");
const __velarTimeGetTime = __velarTimeHostOperation(__velarTimeDatePrototype, "getTime");
const __velarTimeToISOString = __velarTimeHostOperation(__velarTimeDatePrototype, "toISOString");
const __velarTimePerformanceCandidate = globalThis.performance;
const __velarTimePerformance = typeof __velarTimePerformanceCandidate === "object" && __velarTimePerformanceCandidate !== null ? __velarTimePerformanceCandidate : null;
const __velarTimePerformanceNow = __velarTimePerformance === null ? null : __velarTimeInheritedOperation(__velarTimePerformance, "now");
if (typeof __velarTimeApply !== "function") throw new __velarTimeNativeTypeError("The JavaScript Reflect.apply time API is unavailable");
function __velarTimeCall(operation, receiver, arguments_) { return __velarTimeApply(operation, receiver, arguments_); }
function __velarTimeNumber(value) { return __velarTimeCall(__velarTimeNativeNumber, undefined, [value]); }
function __velarTimeFreeze(value) { return __velarTimeCall(__velarTimeObjectFreeze, __velarTimeNativeObject, [value]); }
function weekdayOf(value) {
  if (value === "Sun") return 0;
  if (value === "Mon") return 1;
  if (value === "Tue") return 2;
  if (value === "Wed") return 3;
  if (value === "Thu") return 4;
  if (value === "Fri") return 5;
  if (value === "Sat") return 6;
  return null;
}
function finiteNumber(value, name) { if (!__velarTimeCall(__velarTimeNumberIsFinite, __velarTimeNativeNumber, [value])) throw new __velarTimeNativeTypeError(name + " must be a finite number"); return value; }
function valid(value) { finiteNumber(value, "velar/time timestamp"); if (__velarTimeCall(__velarTimeMathAbs, __velarTimeNativeMath, [value]) > maximumDateMilliseconds) throw new __velarTimeNativeRangeError("velar/time timestamp is outside the JavaScript date range"); return value; }
function timeText(value, name) { if (typeof value !== "string") throw new __velarTimeNativeTypeError(name + " must be a string"); if (value.length > 1024) throw new __velarTimeNativeRangeError(name + " cannot exceed 1024 characters"); return value; }
function timeResultText(value, name, maximum = 65536) { if (typeof value !== "string") throw new __velarTimeNativeTypeError(name + " must return a string"); if (value.length > maximum) throw new __velarTimeNativeRangeError(name + " returned too much text"); return value; }
function ownData(container, key, name) {
  if (container === null || typeof container !== "object") throw new __velarTimeNativeTypeError(name + " must belong to an object");
  const descriptor = __velarTimeGetOwnPropertyDescriptor(container, key);
  if (!descriptor || !("value" in descriptor)) throw new __velarTimeNativeTypeError(name + " must be an own data field");
  return descriptor.value;
}
function boundedInteger(value, name, minimum, maximum) {
  if (!__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [value])) throw new __velarTimeNativeTypeError(name + " must be an integer");
  if (value < minimum || value > maximum) throw new __velarTimeNativeRangeError(name + " is out of range");
  return value;
}
function partInteger(value, name, minimum, maximum) {
  if (typeof value !== "string" || !__velarTimeCall(__velarTimeRegExpExec, __velarTimeDigitsPattern, [value])) throw new __velarTimeNativeTypeError("Time " + name + " part must be decimal text");
  return boundedInteger(__velarTimeNumber(value), "Time " + name + " part", minimum, maximum);
}
function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
function zonedParts(date, timeZone) {
  const formatter = new __velarTimeDateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", second: "numeric", era: "short", hourCycle: "h23" });
  const parts = __velarTimeCall(__velarTimeFormatToParts, formatter, [date]);
  if (!__velarTimeCall(__velarTimeArrayIsArray, __velarTimeNativeArray, [parts])) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat.formatToParts must return a List");
  const partCount = parts.length;
  if (!__velarTimeCall(__velarTimeNumberIsSafeInteger, __velarTimeNativeNumber, [partCount]) || partCount < 0) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned an invalid time part count");
  if (partCount > 32) throw new __velarTimeNativeRangeError("Intl.DateTimeFormat returned too many time parts");
  let yearText = null, monthText = null, dayText = null, weekdayText = null;
  let hourText = null, minuteText = null, secondText = null, era = null;
  for (let index = 0; index < partCount; index += 1) {
    const part = ownData(parts, index, "Intl time part");
    const type = ownData(part, "type", "Intl time part type");
    const value = ownData(part, "value", "Intl time part value");
    timeResultText(type, "Intl time part type", 32);
    timeResultText(value, "Intl time part value", 64);
    if (type === "literal") continue;
    if (type === "year") { if (yearText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate year part"); yearText = value; }
    else if (type === "month") { if (monthText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate month part"); monthText = value; }
    else if (type === "day") { if (dayText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate day part"); dayText = value; }
    else if (type === "weekday") { if (weekdayText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate weekday part"); weekdayText = value; }
    else if (type === "hour") { if (hourText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate hour part"); hourText = value; }
    else if (type === "minute") { if (minuteText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate minute part"); minuteText = value; }
    else if (type === "second") { if (secondText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate second part"); secondText = value; }
    else if (type === "era") { if (era !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate era part"); era = value; }
    else throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned an unsupported time part");
  }
  if (yearText === null || monthText === null || dayText === null || weekdayText === null || hourText === null || minuteText === null || secondText === null || era === null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat omitted a required time part");
  if (era !== "AD" && era !== "BC") throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned an unsupported era");
  const displayedYear = partInteger(yearText, "year", 1, 999999);
  const year = era === "BC" ? 1 - displayedYear : displayedYear;
  const month = partInteger(monthText, "month", 1, 12);
  const day = partInteger(dayText, "day", 1, 31);
  if (day > daysInMonth(year, month)) throw new __velarTimeNativeRangeError("Intl.DateTimeFormat returned an impossible calendar date");
  const weekday = weekdayOf(weekdayText);
  if (weekday === null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned an unsupported weekday");
  return __velarTimeFreeze({
    year,
    month,
    day,
    weekday,
    hour: partInteger(hourText, "hour", 0, 23),
    minute: partInteger(minuteText, "minute", 0, 59),
    second: partInteger(secondText, "second", 0, 59),
    millisecond: boundedInteger(__velarTimeCall(__velarTimeGetUTCMilliseconds, date, []), "Time millisecond part", 0, 999),
  });
}
function calendarParts(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  if (!__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [year])
    || !__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [month])
    || !__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [day])
    || !__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [hour])
    || !__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [minute])
    || !__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [second])
    || !__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [millisecond])) throw new __velarTimeNativeTypeError("velar/time date parts must be integers");
  if (year < 0 || year > 9999) throw new __velarTimeNativeRangeError("velar/time year must be from 0 through 9999");
  if (month < 1 || month > 12) throw new __velarTimeNativeRangeError("velar/time month must be from 1 through 12");
  if (day < 1 || day > 31) throw new __velarTimeNativeRangeError("velar/time day is outside the selected month");
  if (hour < 0 || hour > 23) throw new __velarTimeNativeRangeError("velar/time hour must be from 0 through 23");
  if (minute < 0 || minute > 59 || second < 0 || second > 59) throw new __velarTimeNativeRangeError("velar/time minute and second must be from 0 through 59");
  if (millisecond < 0 || millisecond > 999) throw new __velarTimeNativeRangeError("velar/time millisecond must be from 0 through 999");
  return [year, month, day, hour, minute, second, millisecond];
}
function build(utc, year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  calendarParts(year, month, day, hour, minute, second, millisecond);
  const value = new __velarTimeNativeDate(0);
  if (utc) {
    __velarTimeCall(__velarTimeSetUTCFullYear, value, [year, month - 1, day]);
    __velarTimeCall(__velarTimeSetUTCHours, value, [hour, minute, second, millisecond]);
    if (__velarTimeCall(__velarTimeGetUTCFullYear, value, []) !== year || __velarTimeCall(__velarTimeGetUTCMonth, value, []) !== month - 1 || __velarTimeCall(__velarTimeGetUTCDate, value, []) !== day
      || __velarTimeCall(__velarTimeGetUTCHours, value, []) !== hour || __velarTimeCall(__velarTimeGetUTCMinutes, value, []) !== minute || __velarTimeCall(__velarTimeGetUTCSeconds, value, []) !== second || __velarTimeCall(__velarTimeGetUTCMilliseconds, value, []) !== millisecond) {
      throw new __velarTimeNativeRangeError("velar/time date parts do not form a real UTC date");
    }
  } else {
    __velarTimeCall(__velarTimeSetFullYear, value, [year, month - 1, day]);
    __velarTimeCall(__velarTimeSetHours, value, [hour, minute, second, millisecond]);
    if (__velarTimeCall(__velarTimeGetFullYear, value, []) !== year || __velarTimeCall(__velarTimeGetMonth, value, []) !== month - 1 || __velarTimeCall(__velarTimeGetDate, value, []) !== day
      || __velarTimeCall(__velarTimeGetHours, value, []) !== hour || __velarTimeCall(__velarTimeGetMinutes, value, []) !== minute || __velarTimeCall(__velarTimeGetSeconds, value, []) !== second || __velarTimeCall(__velarTimeGetMilliseconds, value, []) !== millisecond) {
      throw new __velarTimeNativeRangeError("velar/time date parts do not form a real local date");
    }
  }
  return valid(__velarTimeCall(__velarTimeGetTime, value, []));
}
export function now() { return valid(__velarTimeCall(__velarTimeDateNow, __velarTimeNativeDate, [])); }
export function monotonic() { return __velarTimePerformance === null ? now() : finiteNumber(__velarTimeCall(__velarTimePerformanceNow, __velarTimePerformance, []), "velar/time monotonic clock"); }
export function parse(value) {
  if (typeof value !== "string") throw new __velarTimeNativeTypeError("velar/time parse requires an ISO string");
  if (value.length > 64) return null;
  const match = __velarTimeCall(__velarTimeRegExpExec, __velarTimeRegExpPattern, [value]);
  if (!match) return null;
  try {
    const year = __velarTimeNumber(match[1]), month = __velarTimeNumber(match[2]), day = __velarTimeNumber(match[3]);
    if (!match[4]) return build(true, year, month, day);
    const hour = __velarTimeNumber(match[4]), minute = __velarTimeNumber(match[5]), second = __velarTimeNumber(match[6] ?? 0);
    const millisecond = __velarTimeNumber(__velarTimeCall(__velarTimeStringPadEnd, match[7] ?? "", [3, "0"]) || 0);
    const zone = match[8];
    let offset = 0;
    if (zone !== "Z") {
      const sign = zone[0] === "+" ? 1 : -1;
      const offsetHour = __velarTimeNumber(__velarTimeCall(__velarTimeStringSlice, zone, [1, 3]));
      const offsetMinute = __velarTimeNumber(__velarTimeCall(__velarTimeStringSlice, zone, [4, 6]));
      if (offsetHour > 23 || offsetMinute > 59) return null;
      offset = sign * (offsetHour * 60 + offsetMinute);
    }
    return valid(build(true, year, month, day, hour, minute, second, millisecond) - offset * 60_000);
  } catch { return null; }
}
export function iso(value = now()) { const date = new __velarTimeNativeDate(valid(value)); return timeResultText(__velarTimeCall(__velarTimeToISOString, date, []), "Date.toISOString", 64); }
export function format(value, locale = "", timeZone = "") { locale = timeText(locale, "Time locale"); timeZone = timeText(timeZone, "Time zone"); const formatter = new __velarTimeDateTimeFormat(locale || undefined, timeZone ? { dateStyle: "medium", timeStyle: "medium", timeZone } : { dateStyle: "medium", timeStyle: "medium" }); const boundFormat = __velarTimeCall(__velarTimeFormatGetter, formatter, []); if (typeof boundFormat !== "function") throw new __velarTimeNativeTypeError("Intl.DateTimeFormat.format must be a function"); const output = __velarTimeCall(boundFormat, undefined, [new __velarTimeNativeDate(valid(value))]); return timeResultText(output, "Intl.DateTimeFormat.format"); }
export function date(year, month, day, hour = 0, minute = 0, second = 0) { return build(false, year, month, day, hour, minute, second); }
export function utc(year, month, day, hour = 0, minute = 0, second = 0) { return build(true, year, month, day, hour, minute, second); }
export function parts(value, timeZone = "") {
  const date = new __velarTimeNativeDate(valid(value));
  timeZone = timeText(timeZone, "Time zone");
  if (!timeZone) return __velarTimeFreeze({
    year: boundedInteger(__velarTimeCall(__velarTimeGetFullYear, date, []), "Time year part", -271821, 275760),
    month: boundedInteger(__velarTimeCall(__velarTimeGetMonth, date, []) + 1, "Time month part", 1, 12),
    day: boundedInteger(__velarTimeCall(__velarTimeGetDate, date, []), "Time day part", 1, 31),
    weekday: boundedInteger(__velarTimeCall(__velarTimeGetDay, date, []), "Time weekday part", 0, 6),
    hour: boundedInteger(__velarTimeCall(__velarTimeGetHours, date, []), "Time hour part", 0, 23),
    minute: boundedInteger(__velarTimeCall(__velarTimeGetMinutes, date, []), "Time minute part", 0, 59),
    second: boundedInteger(__velarTimeCall(__velarTimeGetSeconds, date, []), "Time second part", 0, 59),
    millisecond: boundedInteger(__velarTimeCall(__velarTimeGetMilliseconds, date, []), "Time millisecond part", 0, 999),
  });
  return zonedParts(date, timeZone);
}
`.trimStart()],
  ["velar/id", String.raw`
${VELAR_ERROR_NORMALIZATION_RUNTIME}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const __velarIdNativeTypeError = globalThis.TypeError;
const __velarIdGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarIdGetPrototypeOf = Object.getPrototypeOf;
const __velarIdRegExpPrototype = __velarIdGetPrototypeOf(uuidPattern);
const __velarIdRegExpTest = __velarIdGetOwnPropertyDescriptor(__velarIdRegExpPrototype, "test")?.value;
const __velarIdCrypto = globalThis.crypto;
let __velarIdRandomUuid = null;
let __velarIdCapabilityFailure = null;

if (!__velarIdCrypto || typeof __velarIdCrypto !== "object") {
  __velarIdCapabilityFailure = new __velarErrorNativeError("Secure UUID generation is unavailable in this JavaScript host");
} else {
  let owner = __velarIdCrypto;
  for (let depth = 0; owner !== null && depth < 32; depth += 1) {
    const descriptor = __velarIdGetOwnPropertyDescriptor(owner, "randomUUID");
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        __velarIdCapabilityFailure = new __velarIdNativeTypeError("crypto.randomUUID must be a data function");
      } else __velarIdRandomUuid = descriptor.value;
      break;
    }
    owner = __velarIdGetPrototypeOf(owner);
  }
  if (!__velarIdRandomUuid && !__velarIdCapabilityFailure) {
    __velarIdCapabilityFailure = new __velarErrorNativeError("Secure UUID generation is unavailable in this JavaScript host");
  }
}

export function uuid() {
  if (__velarIdCapabilityFailure) throw __velarIdCapabilityFailure;
  let value;
  try { value = __velarErrorApply(__velarIdRandomUuid, __velarIdCrypto, [], "crypto.randomUUID"); }
  catch (failure) { if (__velarIsError(failure)) throw failure; throw new __velarErrorNativeError("Secure UUID generation failed", { cause: failure }); }
  if (!isUuid(value)) throw new __velarErrorNativeError("Secure UUID generation returned an invalid UUID");
  return value;
}

export function isUuid(value) {
  return typeof value === "string" && value.length === 36
    && __velarErrorApply(__velarIdRegExpTest, uuidPattern, [value], "RegExp.test");
}
  `.trimStart()],
  ["velar/log", String.raw`
${VELAR_ERROR_NORMALIZATION_RUNTIME}
const __velarLogNativeMap = globalThis.Map;
const __velarLogNativeSet = globalThis.Set;
const __velarLogNativeObject = globalThis.Object;
const __velarLogNativeDate = globalThis.Date;
const __velarLogNativeNumber = globalThis.Number;
const __velarLogNativeMath = globalThis.Math;
const __velarLogNativeTypeError = globalThis.TypeError;
const __velarLogNativeRangeError = globalThis.RangeError;
const __velarLogGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarLogGetPrototypeOf = Object.getPrototypeOf;
const __velarLogDefineProperty = Object.defineProperty;
const __velarLogCreateObject = Object.create;
const __velarLogObjectPrototype = Object.prototype;
const __velarLogFreeze = __velarLogGetOwnPropertyDescriptor(Object, "freeze")?.value;
const __velarLogDateNow = __velarLogGetOwnPropertyDescriptor(Date, "now")?.value;
const __velarLogNumberIsFinite = __velarLogGetOwnPropertyDescriptor(Number, "isFinite")?.value;
const __velarLogMathAbs = __velarLogGetOwnPropertyDescriptor(Math, "abs")?.value;
const __velarLogStringTrim = __velarLogGetOwnPropertyDescriptor(String.prototype, "trim")?.value;
const __velarLogStringToLowerCase = __velarLogGetOwnPropertyDescriptor(String.prototype, "toLowerCase")?.value;
const __velarLogPromiseThen = __velarLogGetOwnPropertyDescriptor(Promise.prototype, "then")?.value;
const __velarLogMapSize = __velarLogGetOwnPropertyDescriptor(__velarLogNativeMap.prototype, "size")?.get;
const __velarLogMapEntries = __velarLogGetOwnPropertyDescriptor(__velarLogNativeMap.prototype, "entries")?.value;
const __velarLogMapHas = __velarLogGetOwnPropertyDescriptor(__velarLogNativeMap.prototype, "has")?.value;
const __velarLogMapSet = __velarLogGetOwnPropertyDescriptor(__velarLogNativeMap.prototype, "set")?.value;
const __velarLogSetSize = __velarLogGetOwnPropertyDescriptor(__velarLogNativeSet.prototype, "size")?.get;
const __velarLogSetValues = __velarLogGetOwnPropertyDescriptor(__velarLogNativeSet.prototype, "values")?.value;
const __velarLogSetHas = __velarLogGetOwnPropertyDescriptor(__velarLogNativeSet.prototype, "has")?.value;
const __velarLogSetAdd = __velarLogGetOwnPropertyDescriptor(__velarLogNativeSet.prototype, "add")?.value;
const __velarLogSetDelete = __velarLogGetOwnPropertyDescriptor(__velarLogNativeSet.prototype, "delete")?.value;
const __velarLogMapIteratorNext = __velarLogGetOwnPropertyDescriptor(__velarLogGetPrototypeOf(__velarErrorApply(__velarLogMapEntries, new __velarLogNativeMap(), [], "Map.entries")), "next")?.value;
const __velarLogSetIteratorNext = __velarLogGetOwnPropertyDescriptor(__velarLogGetPrototypeOf(__velarErrorApply(__velarLogSetValues, new __velarLogNativeSet(), [], "Set.values")), "next")?.value;
const __velarLogConsoleDescriptor = __velarLogGetOwnPropertyDescriptor(globalThis, "console");
const __velarLogConsoleTarget = __velarLogConsoleDescriptor && "value" in __velarLogConsoleDescriptor
  && __velarLogConsoleDescriptor.value !== null && typeof __velarLogConsoleDescriptor.value === "object"
  ? __velarLogConsoleDescriptor.value : null;
const __velarLogConsoleMethods = __velarLogConsoleTarget === null ? null : __velarLogFreezeValue({
  debug: __velarLogHostMethod(__velarLogConsoleTarget, "debug"),
  info: __velarLogHostMethod(__velarLogConsoleTarget, "info"),
  warn: __velarLogHostMethod(__velarLogConsoleTarget, "warn"),
  error: __velarLogHostMethod(__velarLogConsoleTarget, "error"),
  log: __velarLogHostMethod(__velarLogConsoleTarget, "log"),
});
let threshold = "info";
const sinks = new __velarLogNativeSet();
const maxLogFields = 1000;
const maxLogSinks = 1000;
const maximumLogTimestamp = 8_640_000_000_000_000;

function __velarLogApply(operation, receiver, arguments_, label) { return __velarErrorApply(operation, receiver, arguments_, label); }
function __velarLogFreezeValue(value) { return __velarLogApply(__velarLogFreeze, __velarLogNativeObject, [value], "Object.freeze"); }
function __velarLogMapValue(map, operation, arguments_, label) { return __velarLogApply(operation, map, arguments_, label); }
function __velarLogSetValue(set, operation, arguments_, label) { return __velarLogApply(operation, set, arguments_, label); }
function __velarLogCreateMap() { return new __velarLogNativeMap(); }
function __velarLogMapCount(map) { return __velarLogMapValue(map, __velarLogMapSize, [], "Map.size"); }
function __velarLogMapItems(map) {
  const iterator = __velarLogMapValue(map, __velarLogMapEntries, [], "Map.entries");
  const output = [];
  while (true) {
    const step = __velarLogApply(__velarLogMapIteratorNext, iterator, [], "Map iterator next");
    if (step.done) return output;
    output[output.length] = step.value;
  }
}
function __velarLogSetItems(set) {
  const iterator = __velarLogSetValue(set, __velarLogSetValues, [], "Set.values");
  const output = [];
  while (true) {
    const step = __velarLogApply(__velarLogSetIteratorNext, iterator, [], "Set iterator next");
    if (step.done) return output;
    output[output.length] = step.value;
  }
}
function __velarLogCloneMap(value) {
  const output = __velarLogCreateMap();
  const items = __velarLogMapItems(value);
  for (let index = 0; index < items.length; index += 1) {
    const pair = items[index];
    __velarLogMapValue(output, __velarLogMapSet, [pair[0], pair[1]], "Map.set");
  }
  return output;
}
function __velarLogHostMethod(target, name) {
  let owner = target;
  for (let depth = 0; owner !== null && depth < 32; depth += 1) {
    const descriptor = __velarLogGetOwnPropertyDescriptor(owner, name);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") throw new __velarLogNativeTypeError("Host console method " + name + " must be a data function");
      return descriptor.value;
    }
    owner = __velarLogGetPrototypeOf(owner);
  }
  return null;
}
function __velarLogFieldsObject(fields) {
  const output = __velarLogApply(__velarLogCreateObject, __velarLogNativeObject, [__velarLogObjectPrototype], "Object.create");
  const items = __velarLogMapItems(fields);
  for (let index = 0; index < items.length; index += 1) {
    const pair = items[index];
    __velarLogApply(__velarLogDefineProperty, __velarLogNativeObject, [output, pair[0], { value: pair[1], enumerable: true, configurable: true, writable: true }], "Object.defineProperty");
  }
  return output;
}
function logText(value, name, maximum = 65536) { if (typeof value !== "string") throw new __velarLogNativeTypeError(name + " must be a string"); if (value.length > maximum) throw new __velarLogNativeRangeError(name + " is too long"); return value; }
function logTimestamp() {
  const value = __velarLogApply(__velarLogDateNow, __velarLogNativeDate, [], "Date.now");
  if (!__velarLogApply(__velarLogNumberIsFinite, __velarLogNativeNumber, [value], "Number.isFinite")) throw new __velarLogNativeTypeError("The host clock must return a finite timestamp");
  if (__velarLogApply(__velarLogMathAbs, __velarLogNativeMath, [value], "Math.abs") > maximumLogTimestamp) throw new __velarLogNativeRangeError("The host clock returned a timestamp outside the JavaScript date range");
  return value;
}

function fieldsOf(value) {
  if (value == null) return __velarLogCreateMap();
  let size;
  try { size = __velarLogMapCount(value); }
  catch { throw new __velarLogNativeTypeError("VelarScript log fields must be a Map"); }
  if (size > maxLogFields) throw new __velarLogNativeRangeError("VelarScript log fields cannot exceed 1000 entries");
  const fields = __velarLogCreateMap();
  const items = __velarLogMapItems(value);
  for (let index = 0; index < items.length; index += 1) {
    const pair = items[index];
    const key = pair[0];
    if (typeof key !== "string") throw new __velarLogNativeTypeError("VelarScript log field names must be strings");
    if (key.length > 1024) throw new __velarLogNativeRangeError("VelarScript log field names cannot exceed 1024 characters");
    __velarLogMapValue(fields, __velarLogMapSet, [key, pair[1]], "Map.set");
  }
  return fields;
}

function defaultSink(record) {
  if (!__velarLogConsoleDescriptor) return;
  if (__velarLogConsoleTarget === null) throw new __velarLogNativeTypeError("Host console must be an own data object");
  const write = __velarLogConsoleMethods[record.level] ?? __velarLogConsoleMethods.log;
  if (!write) throw new __velarLogNativeTypeError("Host console must provide a callable log method");
  __velarLogApply(write, __velarLogConsoleTarget, [record.scope ? "[" + record.scope + "] " + record.message : record.message, __velarLogFieldsObject(record.fields), record.error ?? ""], "console writer");
}

function sinkFailure(value) {
  const error = __velarNormalizeError(value);
  defaultSink(__velarLogFreezeValue({ timestamp: logTimestamp(), level: "error", scope: "velar/log", message: "Log sink failed", fields: __velarLogCreateMap(), error }));
}
function observeSinkResult(value) {
  try { __velarLogApply(__velarLogPromiseThen, value, [undefined, sinkFailure], "Promise.then"); }
  catch { /* Non-Promise sink results are intentionally ignored. */ }
}

function emit(scope, level, message, fields, error = null) {
  message = logText(message, "Log message");
  fields = fieldsOf(fields);
  if (error != null && !__velarIsError(error)) throw new __velarLogNativeTypeError("Logger error must be an Error");
  if (__velarLogRank(level) < __velarLogRank(threshold)) return null;
  const record = __velarLogFreezeValue({ timestamp: logTimestamp(), level, scope, message, fields, error });
  if (__velarLogSetValue(sinks, __velarLogSetSize, [], "Set.size") === 0) defaultSink(record);
  else {
    const activeSinks = __velarLogSetItems(sinks);
    for (let index = 0; index < activeSinks.length; index += 1) {
      const sink = activeSinks[index];
    try {
      const delivered = __velarLogFreezeValue({ timestamp: record.timestamp, level: record.level, scope: record.scope, message: record.message, fields: __velarLogCloneMap(record.fields), error: record.error });
      const result = sink(delivered);
      observeSinkResult(result);
    } catch (failure) { sinkFailure(failure); }
    }
  }
  return null;
}

function __velarLogRank(value) {
  if (value === "debug") return 10;
  if (value === "info") return 20;
  if (value === "warn") return 30;
  if (value === "error") return 40;
  if (value === "silent") return 100;
  return 100;
}
function createLogger(scope, base = null) {
  const context = fieldsOf(base);
  const merged = (fields) => {
    const output = __velarLogCloneMap(context);
    const items = __velarLogMapItems(fieldsOf(fields));
    for (let index = 0; index < items.length; index += 1) {
      const pair = items[index];
      const key = pair[0];
      if (!__velarLogMapValue(output, __velarLogMapHas, [key], "Map.has") && __velarLogMapCount(output) >= maxLogFields) throw new __velarLogNativeRangeError("Merged log fields cannot exceed 1000 entries");
      __velarLogMapValue(output, __velarLogMapSet, [key, pair[1]], "Map.set");
    }
    return output;
  };
  return __velarLogFreezeValue({
    debug(message, fields = null) { return emit(scope, "debug", message, merged(fields)); },
    info(message, fields = null) { return emit(scope, "info", message, merged(fields)); },
    warn(message, fields = null) { return emit(scope, "warn", message, merged(fields)); },
    error(message, error = null, fields = null) { return emit(scope, "error", message, merged(fields), error); },
  });
}

export const log = createLogger("");
export function logger(scope, fields = null) {
  const name = __velarLogApply(__velarLogStringTrim, logText(scope, "Logger scope", 1024), [], "String.trim");
  if (!name) throw new __velarLogNativeTypeError("A VelarScript logger requires a non-empty scope");
  return createLogger(name, fields);
}
export function level() { return threshold; }
export function setLevel(value) {
  const next = __velarLogApply(__velarLogStringToLowerCase, logText(value, "Log level"), [], "String.toLowerCase");
  if (next !== "debug" && next !== "info" && next !== "warn" && next !== "error" && next !== "silent") throw new __velarLogNativeTypeError("Log level must be debug, info, warn, error, or silent");
  threshold = next;
  return null;
}
export function useSink(sink) {
  if (typeof sink !== "function") throw new __velarLogNativeTypeError("A VelarScript log sink must be callable");
  if (!__velarLogSetValue(sinks, __velarLogSetHas, [sink], "Set.has") && __velarLogSetValue(sinks, __velarLogSetSize, [], "Set.size") >= maxLogSinks) throw new __velarLogNativeRangeError("VelarScript logging cannot install more than 1000 sinks");
  __velarLogSetValue(sinks, __velarLogSetAdd, [sink], "Set.add");
  return () => { __velarLogSetValue(sinks, __velarLogSetDelete, [sink], "Set.delete"); return null; };
}
`.trimStart()],
  ["velar/test", String.raw`
${collectionLoweringImport}
${testDisplayRuntime}
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
function __velarTestAppend(items, value) { items[items.length] = value; }
function __velarTestJoin(items) { return __velarDeepCall(__velarTestArrayJoin, items, [", "]); }
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
    toBe(expected) { if (actual !== expected) throw new __velarTestNativeError("Expected " + display(actual) + " to be " + display(expected)); },
    // D50 rule 97.2: the assertion asks the language, so 'toEqual' and
    // 'equals(a, b)' can never give different answers.
    toEqual(expected) { if (!__velarEquals(actual, expected)) throw new __velarTestNativeError("Expected " + display(actual) + " to deeply equal " + display(expected)); },
    toBeTruthy() { if (actual !== true) throw new __velarTestNativeError("Expected bool true but received " + display(actual)); },
    toBeFalsy() { if (actual !== false) throw new __velarTestNativeError("Expected bool false but received " + display(actual)); },
    toContain(expected) {
      let contains = typeof actual === "string" && typeof expected === "string" && __velarDeepCall(__velarTestStringIncludes, actual, [expected]);
      if (__velarDeepCall(__velarDeepArrayIsArray, __velarDeepNativeArray, [actual]) && __velarDenseList(actual)) {
        contains = false;
        for (let index = 0; index < actual.length; index += 1) {
          if (__velarDeepGetOwnPropertyDescriptor(actual, index).value === expected) { contains = true; break; }
        }
      }
      if (!contains) throw new __velarTestNativeError("Expected " + display(actual) + " to contain " + display(expected));
    },
    toMatch(expected) {
      if (typeof actual !== "string" || typeof expected !== "string") throw new __velarTestNativeTypeError("toMatch requires text and a string pattern");
      if (expected.length > 4096) throw new __velarTestNativeRangeError("toMatch patterns cannot exceed 4096 code units");
      let pattern;
      try { pattern = new __velarTestNativeRegExp(expected, "u"); } catch { throw new __velarTestNativeTypeError("Invalid toMatch pattern"); }
      if (__velarDeepCall(__velarTestRegExpExec, pattern, [actual]) === null) throw new __velarTestNativeError("Expected " + display(actual) + " to match " + display(expected));
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
`.trimStart()],
]);

/**
 * Implementation-only edges onto compiler-owned JavaScript modules. Public
 * ModuleInterface dependencies remain source-level VelarScript imports; this
 * graph only guarantees that unbundled targets materialize every hidden
 * runtime module a generated or standard module reaches for. A standard
 * module may appear on the left when it reuses a Core runtime algorithm
 * rather than restating it.
 */
const coreModuleDependencies: ReadonlyMap<string, readonly string[]> = new Map([
  [VELAR_COLLECTION_LOWERING_MODULE, VELAR_COLLECTION_LOWERING_DEPENDENCIES],
  // D50 rule 97.2: 'toEqual' is the language's own equals(a, b).
  ["velar/test", [VELAR_COLLECTION_LOWERING_MODULE] as readonly string[]],
]);

export function standardModuleSources(extensions: readonly CompilerExtension[] = []): ReadonlyMap<string, string> {
  const activeExtensions = standardExtensions(extensions);
  return new Map([
    ...coreModuleSources,
    ...combinedExtensionModules<string>(activeExtensions, "sources"),
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
  const activeExtensions = standardExtensions(extensions);
  const interfaces = standardModuleInterfaces(activeExtensions);
  return {
    standardVersion: VELAR_STANDARD_API_VERSION,
    extensions: Object.fromEntries(activeExtensions.map((extension) => [extension.id, extension.modules?.apiVersion ?? "unknown"])),
    modules: Object.fromEntries([...interfaces].map(([source, interface_]) => [source, [...interface_.exports.keys()].sort()])),
  };
}

export function standardModuleSource(
  source: string,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): string | null {
  for (const extension of standardExtensions(extensions)) {
    const extensionConfig = projectConfig instanceof Map ? projectConfig.get(extension.id) : projectConfig;
    const framework = extension.modules?.source?.(source, extensionConfig) ?? extension.modules?.sources.get(source) ?? null;
    if (framework !== null) return framework;
  }
  return coreModuleSources.get(source) ?? null;
}

export function standardModuleDependencies(
  source: string,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): readonly string[] | null {
  for (const extension of standardExtensions(extensions)) {
    const extensionConfig = projectConfig instanceof Map ? projectConfig.get(extension.id) : projectConfig;
    const moduleSource = extension.modules?.source?.(source, extensionConfig) ?? extension.modules?.sources.get(source) ?? null;
    if (moduleSource !== null) return extension.modules?.dependencies?.get(source) ?? [];
  }
  return coreModuleSources.has(source) ? coreModuleDependencies.get(source) ?? [] : null;
}

export function standardModuleClosure(
  roots: Iterable<string>,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): ReadonlySet<string> {
  const modules = new Set<string>();
  const visit = (source: string, owner: string | null): void => {
    if (modules.has(source)) return;
    const dependencies = standardModuleDependencies(source, projectConfig, extensions);
    if (dependencies === null) {
      throw new Error(owner === null
        ? `Unknown VelarScript standard module '${source}'`
        : `VelarScript standard module '${owner}' depends on unknown module '${source}'`);
    }
    modules.add(source);
    for (const dependency of dependencies) visit(dependency, source);
  };
  for (const root of roots) visit(root, null);
  return modules;
}

function standardExtensions(extensions: readonly CompilerExtension[]): readonly CompilerExtension[] {
  return [...extensions.filter((extension) => extension.id !== velarNodeCompilerExtension.id), velarNodeCompilerExtension];
}

function combinedExtensionModules<T>(
  extensions: readonly CompilerExtension[],
  field: "interfaces" | "sources",
): ReadonlyMap<string, T> {
  const combined = new Map<string, T>();
  for (const extension of [...extensions].reverse()) {
    const modules = extension.modules?.[field] as ReadonlyMap<string, T> | undefined;
    if (!modules) continue;
    for (const [source, value] of modules) {
      // A higher-priority, explicitly selected target owns both the contract
      // and source when two platforms intentionally share a module name.
      combined.delete(source);
      combined.set(source, value);
    }
  }
  return combined;
}
export function standardModuleAsset(
  pathname: string,
  projectConfig: unknown = { base: "/" },
  extensions: readonly CompilerExtension[] = [],
): string | null {
  const match = /^\/@velar\/([a-z0-9-]+)\.js$/u.exec(pathname);
  return match ? standardModuleSource(`velar/${match[1]}`, projectConfig, extensions) : null;
}
