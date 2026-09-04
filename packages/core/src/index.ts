import {
  optionalOf as optional,
  VELAR_BYTES_TYPE_IDENTITY,
  VELAR_FLOAT32_BUFFER_TYPE_IDENTITY,
  VELAR_UINT8_BUFFER_TYPE_IDENTITY,
  VELAR_UINT16_BUFFER_TYPE_IDENTITY,
  VELAR_UINT32_BUFFER_TYPE_IDENTITY,
  type ClassInfo,
  type CompilerExtension,
  type GenericTypeInfo,
  type ModuleInterface,
  type ValueType,
} from "@velarscript/compiler";
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
  VELAR_NON_REACTIVE_BRIDGE_MODULE_SOURCE,
  VELAR_RUNTIME_REGISTRY_KEY,
  VELAR_RUNTIME_SCHEMA_VERSION,
  VELAR_STRICT_JSON_RUNTIME,
  VELAR_TEXT_METHOD_RUNTIME,
  VELAR_TYPE_REGISTRY_RUNTIME,
  VELAR_TYPE_VALIDATION_MODULE,
  VELAR_TYPE_VALIDATION_MODULE_SOURCE,
  VELAR_UTF8_RUNTIME,
} from "@velarscript/compiler/extension";
import { VELAR_CORE_HASH_RUNTIME } from "./hash-runtime.ts";
export const CORE_WORKER_CONFIG_KEY = "velar:core-workers-v1";
export const VELAR_STANDARD_API_VERSION = "0.6";

export const VELAR_WORKER_MANIFEST_MODULE = "velar/worker-manifest";

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
// D90 R17: accept-anything positions are `unknown`, the top type for
// assignment targets; the analyzer's intrinsic handlers compute the real
// per-call types, so nothing here ever hands back an unchecked `any`.
const listUnknown: ValueType = { kind: "list", element: unknownType };
const listNumber: ValueType = { kind: "list", element: numberType };
const listString: ValueType = { kind: "list", element: stringType };
const mapUnknown: ValueType = { kind: "map", key: unknownType, value: unknownType };
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
/**
 * D59 rule 145.3 and D65 rule 171: `useSink` hands a record to the sink, so a
 * sink written as a named `def` needs a name for that record's type. The
 * fields are registered as `velar/log`'s `LogRecord` and the name is exported,
 * the way `velar/serve` publishes `ServeRequest` and `velar/fs` publishes
 * `FileWatchBatch`. One field map, read as the parameter type and as the
 * module's named type, so the two cannot drift.
 */
const logRecordFields: Readonly<Record<string, ValueType>> = {
  timestamp: numberType,
  level: stringType,
  scope: stringType,
  message: stringType,
  fields: logFieldsType,
  error: optional(errorType),
};
const logRecordType = object(logRecordFields);
const loggerType = object({
  debug: apiFunction(["message", "fields"], [stringType, logFieldsType], nullType, 1),
  info: apiFunction(["message", "fields"], [stringType, logFieldsType], nullType, 1),
  warn: apiFunction(["message", "fields"], [stringType, logFieldsType], nullType, 1),
  error: apiFunction(["message", "error", "fields"], [stringType, errorType, logFieldsType], nullType, 1),
});
const byteOrderIdentity = "velar/binary#enum:ByteOrder";
const byteOrderMembers = new Set(["little", "big"]);
const byteOrderWireValues = new Map([...byteOrderMembers].map((member) => [member, member]));
const byteOrderType: ValueType = { kind: "enum", name: "ByteOrder", identity: byteOrderIdentity };
const bytesType: ValueType = { kind: "named", name: "Bytes", identity: VELAR_BYTES_TYPE_IDENTITY };
const uint8BufferType: ValueType = { kind: "named", name: "UInt8Buffer", identity: VELAR_UINT8_BUFFER_TYPE_IDENTITY };
const uint16BufferType: ValueType = { kind: "named", name: "UInt16Buffer", identity: VELAR_UINT16_BUFFER_TYPE_IDENTITY };
const uint32BufferType: ValueType = { kind: "named", name: "UInt32Buffer", identity: VELAR_UINT32_BUFFER_TYPE_IDENTITY };
const float32BufferType: ValueType = { kind: "named", name: "Float32Buffer", identity: VELAR_FLOAT32_BUFFER_TYPE_IDENTITY };
const uint32BuilderType: ValueType = { kind: "named", name: "UInt32Builder", identity: "velar/binary#type:UInt32Builder" };
const float32BuilderType: ValueType = { kind: "named", name: "Float32Builder", identity: "velar/binary#type:Float32Builder" };
const binaryBufferFields = (type: ValueType, ordered: boolean): ReadonlyMap<string, ValueType> => new Map([
  ["size", numberType],
  ["copy", apiFunction([], [], type)],
  ["slice", apiFunction(["start", "end"], [numberType, numberType], type, 0)],
  ["toBytes", ordered ? apiFunction(["order"], [byteOrderType], bytesType) : apiFunction([], [], bytesType)],
  ["values", apiFunction([], [], listNumber)],
]);
const binaryBuilderFields = (type: ValueType): ReadonlyMap<string, ValueType> => new Map([
  ["size", numberType],
  ["maxElements", numberType],
  ["push", apiFunction(["value"], [numberType], nullType)],
  ["finish", apiFunction([], [], type)],
]);
const binaryNamedTypes = new Map([
  ["Bytes", new Map([
    ["size", numberType],
  ])],
  ["UInt8Buffer", binaryBufferFields(uint8BufferType, false)],
  ["UInt16Buffer", binaryBufferFields(uint16BufferType, true)],
  ["UInt32Buffer", binaryBufferFields(uint32BufferType, true)],
  ["Float32Buffer", binaryBufferFields(float32BufferType, true)],
  ["UInt32Builder", binaryBuilderFields(uint32BufferType)],
  ["Float32Builder", binaryBuilderFields(float32BufferType)],
]);
const binaryReadonlyFields = new Map([
  ["Bytes", new Set(["size"])],
  ["UInt8Buffer", new Set(["size", "copy", "slice", "toBytes", "values"])],
  ["UInt16Buffer", new Set(["size", "copy", "slice", "toBytes", "values"])],
  ["UInt32Buffer", new Set(["size", "copy", "slice", "toBytes", "values"])],
  ["Float32Buffer", new Set(["size", "copy", "slice", "toBytes", "values"])],
  ["UInt32Builder", new Set(["size", "maxElements", "push", "finish"])],
  ["Float32Builder", new Set(["size", "maxElements", "push", "finish"])],
]);
const randomIdentity = "velar/random#type:Random";
const randomType: ValueType = { kind: "named", name: "Random", identity: randomIdentity };
const randomSeedType: ValueType = { kind: "union", members: [stringType, numberType] };
const randomElementType: ValueType = { kind: "parameter", name: "T", index: 0 };
const randomNamedTypes = new Map([
  ["Random", new Map([
    ["number", apiFunction([], [], numberType)],
    ["int", apiFunction(["start", "end"], [numberType, numberType], numberType, 1)],
    ["bool", apiFunction(["probability"], [numberType], boolType, 0)],
    ["pick", { kind: "function", typeParameterNames: ["T"], parameters: [{ kind: "list", element: randomElementType }], parameterNames: ["values"], requiredParameters: 1, result: randomElementType } satisfies ValueType],
    ["shuffle", { kind: "function", typeParameterNames: ["T"], parameters: [{ kind: "list", element: randomElementType }], parameterNames: ["values"], requiredParameters: 1, result: { kind: "list", element: randomElementType } } satisfies ValueType],
    ["fork", apiFunction(["label"], [stringType], randomType)],
  ])],
]);
const randomReadonlyFields = new Map([["Random", new Set(["number", "int", "bool", "pick", "shuffle", "fork"])]]);
const cancellationIdentity = "velar/task#type:Cancellation";
const taskIdentity = "velar/task#type:Task";
const channelIdentity = "velar/task#type:Channel";
const cancellationType: ValueType = { kind: "named", name: "Cancellation", identity: cancellationIdentity };
const taskElementType: ValueType = { kind: "parameter", name: "T", index: 0 };
const taskOf = (value: ValueType): ValueType => ({
  kind: "named",
  name: `Task<${value.kind === "parameter" ? value.name : "T"}>`,
  identity: taskIdentity,
  application: { declaration: taskIdentity, name: "Task", arguments: [value] },
});
const taskTemplate: GenericTypeInfo = {
  identity: taskIdentity,
  name: "Task",
  parameterNames: ["T"],
  parameterBounds: [null],
  fields: new Map([
    ["result", apiFunction([], [], promise(taskElementType))],
    ["cancel", apiFunction(["reason"], [stringType], promise(nullType), 0)],
    ["close", apiFunction([], [], promise(nullType))],
  ]),
  readonlyFields: new Set(["result", "cancel", "close"]),
};
const channelOf = (value: ValueType): ValueType => ({
  kind: "named",
  name: `Channel<${value.kind === "parameter" ? value.name : "T"}>`,
  identity: channelIdentity,
  application: { declaration: channelIdentity, name: "Channel", arguments: [value] },
});
const channelTemplate: GenericTypeInfo = {
  identity: channelIdentity,
  name: "Channel",
  parameterNames: ["T"],
  parameterBounds: [null],
  fields: new Map([
    ["capacity", numberType],
    ["size", numberType],
    ["closed", boolType],
    ["send", {kind: "function", parameterNames: ["value", "cancellation"], parameters: [taskElementType, optional(cancellationType)], requiredParameters: 1, result: promise(nullType)}],
    ["trySend", apiFunction(["value"], [taskElementType], boolType)],
    ["next", {kind: "function", parameterNames: ["cancellation"], parameters: [optional(cancellationType)], requiredParameters: 0, result: promise(optional(taskElementType))}],
    ["close", apiFunction([], [], nullType)],
  ]),
  readonlyFields: new Set(["capacity", "size", "closed", "send", "trySend", "next", "close"]),
};
const cancellationFields = new Map([
  ["cancelled", boolType],
  ["reason", optional(stringType)],
  ["checkpoint", apiFunction([], [], promise(nullType))],
]);
const taskErrorClass = (identity: string): ClassInfo => ({
  identity,
  parameters: [stringType], parameterNames: ["message"], requiredParameters: 0,
  base: "Error", abstract: false,
  fields: new Map(), getters: new Set(), abstractGetters: new Set(), methods: new Map(), abstractMethods: new Set(),
  staticFields: new Map(), staticGetters: new Set(), staticMethods: new Map(),
});
const cancellationErrorIdentity = "velar/task#class:CancellationError";
const taskTimeoutErrorIdentity = "velar/task#class:TaskTimeoutError";
const channelClosedErrorIdentity = "velar/task#class:ChannelClosedError";
const channelBackpressureErrorIdentity = "velar/task#class:ChannelBackpressureError";
const workerIdentity = "velar/worker#type:Worker";
const workerPoolIdentity = "velar/worker#type:WorkerPool";
const workerRequestType: ValueType = { kind: "parameter", name: "Request", index: 0 };
const workerResponseType: ValueType = { kind: "parameter", name: "Response", index: 1 };
const workerApplication = (identity: string, name: string, request: ValueType, response: ValueType): ValueType => ({
  kind: "named", name: `${name}<Request, Response>`, identity,
  application: { declaration: identity, name, arguments: [request, response] },
});
const workerCallFields = new Map<string, ValueType>([
  ["call", { kind: "function", parameterNames: ["request", "cancellation", "timeout"], parameters: [workerRequestType, optional(cancellationType), optional(durationType)], requiredParameters: 1, result: promise(workerResponseType) }],
  ["close", apiFunction([], [], promise(nullType))],
]);
const workerTemplate = (identity: string, name: string): GenericTypeInfo => ({
  identity, name, parameterNames: ["Request", "Response"], parameterBounds: [null, null], fields: workerCallFields,
  readonlyFields: new Set(["call", "close"]),
});
const workerErrorIdentities = new Map([
  ["WorkerBackpressureError", "velar/worker#class:WorkerBackpressureError"],
  ["WorkerCallError", "velar/worker#class:WorkerCallError"],
  ["WorkerCrashedError", "velar/worker#class:WorkerCrashedError"],
  ["WorkerClosedError", "velar/worker#class:WorkerClosedError"],
]);
const coreModuleInterfaces = new Map<string, ModuleInterface>([
  ["velar/collections", moduleInterface(new Map([
    ["range", apiIntrinsic("collections.range", ["start", "end", "step"], [numberType, numberType, numberType], listNumber, 1)],
    ["enumerate", apiIntrinsic("collections.enumerate", ["values", "start"], [listUnknown, numberType], listUnknown, 1)],
    ["zip", apiIntrinsic("collections.zip", ["left", "right"], [listUnknown, listUnknown], listUnknown)],
    ["unique", apiIntrinsic("collections.unique", ["values"], [listUnknown], listUnknown)],
    ["chunk", apiIntrinsic("collections.chunk", ["values", "size"], [listUnknown, numberType], listUnknown)],
    ["flatten", apiIntrinsic("collections.flatten", ["values"], [listUnknown], listUnknown)],
    ["compact", apiIntrinsic("collections.compact", ["values"], [listUnknown], listUnknown)],
    ["reversed", apiIntrinsic("collections.reversed", ["values"], [listUnknown], listUnknown)],
    ["take", apiIntrinsic("collections.take", ["values", "count"], [listUnknown, numberType], listUnknown)],
    ["drop", apiIntrinsic("collections.drop", ["values", "count"], [listUnknown, numberType], listUnknown)],
    ["first", apiIntrinsic("collections.first", ["values"], [listUnknown], unknownType)],
    ["last", apiIntrinsic("collections.last", ["values"], [listUnknown], unknownType)],
    ["find", apiIntrinsic("collections.find", ["values", "test"], [listUnknown, unknownType], unknownType)],
    ["index", apiIntrinsic("collections.index", ["values", "value"], [listUnknown, unknownType], optional(numberType))],
    ["has", apiIntrinsic("collections.has", ["values", "value"], [listUnknown, unknownType], boolType)],
    ["count", apiIntrinsic("collections.count", ["values", "value"], [listUnknown, unknownType], numberType)],
    ["some", apiIntrinsic("collections.some", ["values", "test"], [listUnknown, unknownType], boolType)],
    ["every", apiIntrinsic("collections.every", ["values", "test"], [listUnknown, unknownType], boolType)],
    ["partition", apiIntrinsic("collections.partition", ["values", "test"], [listUnknown, unknownType], unknownType)],
    ["groupBy", apiIntrinsic("collections.groupBy", ["values", "key"], [listUnknown, unknownType], mapUnknown)],
    ["keyBy", apiIntrinsic("collections.keyBy", ["values", "key"], [listUnknown, unknownType], mapUnknown)],
    ["countBy", apiIntrinsic("collections.countBy", ["values", "key"], [listUnknown, unknownType], mapUnknown)],
    ["sortBy", apiIntrinsic("collections.sortBy", ["values", "key", "descending"], [listUnknown, unknownType, boolType], listUnknown, 2)],
    ["minBy", apiIntrinsic("collections.minBy", ["values", "key"], [listUnknown, unknownType], unknownType)],
    ["maxBy", apiIntrinsic("collections.maxBy", ["values", "key"], [listUnknown, unknownType], unknownType)],
    ["sum", apiIntrinsic("collections.sum", ["values"], [listNumber], numberType)],
    ["join", apiIntrinsic("collections.join", ["values", "separator"], [listString, stringType], stringType, 1)],
    ["repeat", apiIntrinsic("collections.repeat", ["value", "count"], [unknownType, numberType], listUnknown)],
  ]))],
  ["velar/text", moduleInterface(new Map([
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
  ]))],
  ["velar/math", moduleInterface(new Map([
    ["pi", numberType], ["e", numberType], ["tau", numberType], ["infinity", numberType],
    // min and max are pure rest calls and therefore have no named rest value.
    ["min", intrinsic("math.min", [numberType], numberType)],
    ["max", intrinsic("math.max", [numberType], numberType)],
    ["clamp", apiFunction(["value", "minimum", "maximum"], [numberType, numberType, numberType], numberType)],
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
  ["velar/binary", moduleInterface(
    new Map([
      ["ByteOrder", { kind: "enumObject", name: "ByteOrder", identity: byteOrderIdentity, members: byteOrderMembers }],
      ["Bytes", { kind: "typeObject", name: "Bytes", value: bytesType }],
      ["UInt8Buffer", { kind: "typeObject", name: "UInt8Buffer", value: uint8BufferType }],
      ["UInt16Buffer", { kind: "typeObject", name: "UInt16Buffer", value: uint16BufferType }],
      ["UInt32Buffer", { kind: "typeObject", name: "UInt32Buffer", value: uint32BufferType }],
      ["Float32Buffer", { kind: "typeObject", name: "Float32Buffer", value: float32BufferType }],
      ["UInt32Builder", { kind: "typeObject", name: "UInt32Builder", value: uint32BuilderType }],
      ["Float32Builder", { kind: "typeObject", name: "Float32Builder", value: float32BuilderType }],
      ["uint8Buffer", apiFunction(["size"], [numberType], uint8BufferType)],
      ["uint16Buffer", apiFunction(["size"], [numberType], uint16BufferType)],
      ["uint32Buffer", apiFunction(["size"], [numberType], uint32BufferType)],
      ["float32Buffer", apiFunction(["size"], [numberType], float32BufferType)],
      ["uint8FromBytes", apiFunction(["snapshot"], [bytesType], uint8BufferType)],
      ["uint16FromBytes", apiFunction(["snapshot", "order"], [bytesType, byteOrderType], uint16BufferType)],
      ["uint32FromBytes", apiFunction(["snapshot", "order"], [bytesType, byteOrderType], uint32BufferType)],
      ["float32FromBytes", apiFunction(["snapshot", "order"], [bytesType, byteOrderType], float32BufferType)],
      ["uint32Builder", apiFunction(["maxElements"], [numberType], uint32BuilderType)],
      ["float32Builder", apiFunction(["maxElements"], [numberType], float32BuilderType)],
    ]),
    new Map(),
    binaryNamedTypes,
    new Map(),
    binaryReadonlyFields,
    new Map([
      ["Bytes", VELAR_BYTES_TYPE_IDENTITY],
      ["UInt8Buffer", VELAR_UINT8_BUFFER_TYPE_IDENTITY],
      ["UInt16Buffer", VELAR_UINT16_BUFFER_TYPE_IDENTITY],
      ["UInt32Buffer", VELAR_UINT32_BUFFER_TYPE_IDENTITY],
      ["Float32Buffer", VELAR_FLOAT32_BUFFER_TYPE_IDENTITY],
      ["UInt32Builder", "velar/binary#type:UInt32Builder"],
      ["Float32Builder", "velar/binary#type:Float32Builder"],
    ]),
    new Map([["ByteOrder", { identity: byteOrderIdentity, members: byteOrderMembers, wireValues: byteOrderWireValues }]]),
  )],
  ["velar/hash", moduleInterface(new Map([
    ["sha256Text", apiFunction(["text"], [stringType], stringType)],
  ]))],
  ["velar/random", moduleInterface(
    new Map([
      ["Random", { kind: "typeObject", name: "Random", value: randomType }],
      ["random", apiFunction(["seed"], [randomSeedType], randomType)],
    ]),
    new Map(),
    randomNamedTypes,
    new Map(),
    randomReadonlyFields,
    new Map([["Random", randomIdentity]]),
  )],
  ["velar/task", moduleInterface(
    new Map([
      ["Cancellation", { kind: "typeObject", name: "Cancellation", value: cancellationType }],
      ["Task", { kind: "typeObject", name: "Task" }],
      ["Channel", { kind: "typeObject", name: "Channel" }],
      ["CancellationError", { kind: "classConstructor", name: "CancellationError", identity: cancellationErrorIdentity }],
      ["TaskTimeoutError", { kind: "classConstructor", name: "TaskTimeoutError", identity: taskTimeoutErrorIdentity }],
      ["ChannelClosedError", { kind: "classConstructor", name: "ChannelClosedError", identity: channelClosedErrorIdentity }],
      ["ChannelBackpressureError", { kind: "classConstructor", name: "ChannelBackpressureError", identity: channelBackpressureErrorIdentity }],
      ["task", { kind: "function", typeParameterNames: ["T"], parameterNames: ["work", "parent"], parameters: [
        { kind: "function", parameterNames: ["cancellation"], parameters: [cancellationType], requiredParameters: 1, result: promise(taskElementType) },
        optional(cancellationType),
      ], requiredParameters: 1, result: taskOf(taskElementType) }],
      ["withTimeout", { kind: "function", typeParameterNames: ["T"], parameterNames: ["source", "duration"], parameters: [taskOf(taskElementType), durationType], requiredParameters: 2, result: promise(taskElementType) }],
      ["channel", { kind: "function", typeParameterNames: ["T"], parameterNames: ["Type", "capacity"], parameters: [{ kind: "runtimeType", value: taskElementType }, numberType], requiredParameters: 1, result: channelOf(taskElementType) }],
    ]),
    new Map([
      ["CancellationError", taskErrorClass(cancellationErrorIdentity)],
      ["TaskTimeoutError", taskErrorClass(taskTimeoutErrorIdentity)],
      ["ChannelClosedError", taskErrorClass(channelClosedErrorIdentity)],
      ["ChannelBackpressureError", taskErrorClass(channelBackpressureErrorIdentity)],
    ]),
    new Map([["Cancellation", cancellationFields]]),
    new Map(),
    new Map([["Cancellation", new Set(["cancelled", "reason", "checkpoint"])]]),
    new Map([["Cancellation", cancellationIdentity]]),
    new Map(),
    new Map([["Task", taskTemplate], [taskIdentity, taskTemplate], ["Channel", channelTemplate], [channelIdentity, channelTemplate]]),
  )],
  ["velar/worker", moduleInterface(
    new Map([
      ["Worker", { kind: "typeObject", name: "Worker" }],
      ["WorkerPool", { kind: "typeObject", name: "WorkerPool" }],
      ...[...workerErrorIdentities].map(([name, identity]) => [name, { kind: "classConstructor", name, identity } as ValueType] as const),
      ["worker", { kind: "function", typeParameterNames: ["Request", "Response"], parameterNames: ["name", "RequestType", "ResponseType", "capacity"], parameters: [stringType, { kind: "runtimeType", value: workerRequestType }, { kind: "runtimeType", value: workerResponseType }, numberType], requiredParameters: 3, result: workerApplication(workerIdentity, "Worker", workerRequestType, workerResponseType) }],
      ["workerPool", { kind: "function", typeParameterNames: ["Request", "Response"], parameterNames: ["name", "RequestType", "ResponseType", "size", "capacity"], parameters: [stringType, { kind: "runtimeType", value: workerRequestType }, { kind: "runtimeType", value: workerResponseType }, numberType, numberType], requiredParameters: 4, result: workerApplication(workerPoolIdentity, "WorkerPool", workerRequestType, workerResponseType) }],
      ["serveWorker", { kind: "function", typeParameterNames: ["Request", "Response"], parameterNames: ["RequestType", "ResponseType", "handler", "capacity"], parameters: [
        { kind: "runtimeType", value: workerRequestType }, { kind: "runtimeType", value: workerResponseType },
        { kind: "function", parameterNames: ["request", "cancellation"], parameters: [workerRequestType, cancellationType], requiredParameters: 2, result: promise(workerResponseType) }, numberType,
      ], requiredParameters: 3, result: nullType }],
    ]),
    new Map([...workerErrorIdentities].map(([name, identity]) => [name, taskErrorClass(identity)])),
    new Map(), new Map(), new Map(), new Map(), new Map(),
    new Map([
      ["Worker", workerTemplate(workerIdentity, "Worker")], [workerIdentity, workerTemplate(workerIdentity, "Worker")],
      ["WorkerPool", workerTemplate(workerPoolIdentity, "WorkerPool")], [workerPoolIdentity, workerTemplate(workerPoolIdentity, "WorkerPool")],
    ]),
  )],
  ["velar/json", moduleInterface(new Map([
    ["parse", apiIntrinsic("json.parse", ["text", "target"], [stringType, unknownType], unknownType, 1)],
    ["tryParse", apiIntrinsic("json.tryParse", ["text", "target", "fallback"], [stringType, unknownType, unknownType], unknownType, 1)],
    ["stringify", apiIntrinsic("json.stringify", ["value", "pretty"], [unknownType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["stableStringify", apiIntrinsic("json.stableStringify", ["value", "pretty"], [unknownType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["clone", apiIntrinsic("json.clone", ["value", "target"], [unknownType, unknownType], unknownType, 1)],
    ["isSerializable", apiFunction(["value"], [unknownType], boolType)],
  ]))],
  ["velar/async", moduleInterface(new Map([
    ["sleep", apiFunction(["duration"], [durationType], promise(nullType))],
    ["all", apiIntrinsic("async.all", ["values"], [unknownType], promise(unknownType))],
    ["race", apiIntrinsic("async.race", ["values"], [listUnknown], promise(unknownType))],
    ["timeout", apiIntrinsic("async.timeout", ["value", "duration", "message"], [promise(unknownType), durationType, stringType], promise(unknownType), 2)],
    ["retry", apiIntrinsic("async.retry", ["task", "attempts", "delay"], [unknownType, numberType, durationType], promise(unknownType), 1)],
    ["map", apiIntrinsic("async.map", ["values", "worker", "concurrency"], [listUnknown, unknownType, numberType], promise(listUnknown), 2)],
    ["series", apiIntrinsic("async.series", ["tasks"], [listUnknown], promise(listUnknown))],
  ]))],
  ["velar/url", moduleInterface(new Map([
    ["parse", apiFunction(["value", "base"], [stringType, stringType], urlInfoType, 1)],
    // join is a pure rest call, so its segments stay positional.
    ["join", intrinsic("url.join", [stringType], stringType)],
    ["query", apiFunction(["params"], [unknownType], stringType)],
    ["parseQuery", apiFunction(["value"], [stringType], { kind: "map", key: stringType, value: stringType })],
    ["withQuery", apiFunction(["value", "params"], [stringType, unknownType], stringType)],
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
    // D104 rule 5: the two style arguments are how `format` answers for a part
    // of a time rather than the whole of it. `dateStyle="none"` is the
    // time-of-day rendering a message list wants, and it is the locale's own —
    // `parts()` plus hand-written zero padding gives every locale a
    // twenty-four-hour clock, which is wrong wherever the reader expects
    // AM/PM. Styles are `Intl`'s own vocabulary, projected rather than
    // reinvented: full, long, medium, short, and `none` for the half this call
    // leaves out.
    ["format", apiFunction(["value", "locale", "timeZone", "dateStyle", "timeStyle"], [numberType, stringType, stringType, stringType, stringType], stringType, 1)],
    ["date", apiFunction(["year", "month", "day", "hour", "minute", "second"], [numberType, numberType, numberType, numberType, numberType, numberType], numberType, 3)],
    ["utc", apiFunction(["year", "month", "day", "hour", "minute", "second"], [numberType, numberType, numberType, numberType, numberType, numberType], numberType, 3)],
    ["parts", apiFunction(["value", "timeZone"], [numberType, stringType], timePartsType, 1)],
  ]))],
  ["velar/id", moduleInterface(new Map([
    ["uuid", apiFunction([], [], stringType)],
    ["isUuid", apiFunction(["value"], [stringType], boolType)],
  ]))],
  ["velar/log", moduleInterface(
    new Map([
      ["LogRecord", { kind: "typeObject", name: "LogRecord" }],
      ["log", loggerType],
      ["logger", apiFunction(["scope", "fields"], [stringType, logFieldsType], loggerType, 1)],
      ["level", apiFunction([], [], stringType)],
      ["setLevel", apiFunction(["value"], [stringType], nullType)],
      ["useSink", apiFunction(["sink"], [functionType([logRecordType], unknownType)], cleanupType)],
    ]),
    new Map(),
    new Map(),
    new Map([["LogRecord", logRecordType]]),
  )],
  ["velar/test", moduleInterface(new Map([
    ["expect", apiIntrinsic("test.expect", ["actual"], [unknownType], unknownType)],
  ]))],
]);

function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  classes: ReadonlyMap<string, ClassInfo> = new Map(),
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  typeAliases: ReadonlyMap<string, ValueType> = new Map(),
  namedTypeReadonlyFields: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
  enums: ModuleInterface["enums"] = new Map(),
  genericTypes: NonNullable<ModuleInterface["genericTypes"]> = new Map(),
): ModuleInterface {
  return { exports, mutableExports: new Set(), reactiveExports: new Map(), reExports: new Map(), namedTypes, namedTypeReadonlyFields, namedTypeIdentities, genericTypes, typeAliases, enums, classes, tests: [], extensionExports: new Map(), extensionData: new Map() };
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

/**
 * The two Core comparisons, reached for rather than restated (D50 rule 97.2,
 * D59 rule 141): `__velarEquals` is what `equals(a, b)` calls, and
 * `__velarSameValueZero` is what `==` lowers to.
 */
const collectionLoweringImport = `import { __velarEquals, __velarSameValueZero } from "${VELAR_COLLECTION_LOWERING_MODULE}";`;

// Structure walkers shared by the assertion reporter. Value and content
// comparison are both deliberately absent: D50 rule 97.2 makes `toEqual` call
// the language's own `equals` and D59 rule 141 makes `toBe` call the language's
// own `==`, so no second comparison implementation can exist here to disagree
// with either.
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
  // No registry means no reactive runtime in this realm, which is ordinary Core
  // behavior. A registry from another generation is a mixed build: reading past
  // it would copy raw values and silently lose every collectionRead dependency,
  // so it fails closed ahead of the callable duck-checks.
  if (!runtime || (typeof runtime !== "object" && typeof runtime !== "function")) return null;
  if (runtime.version !== ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)}) {
    throw new __velarListTypeError("VelarScript reactive runtime schema " + (typeof runtime.version === "string" ? runtime.version : "(unknown)") + " does not match this module's schema ${VELAR_RUNTIME_SCHEMA_VERSION}; one build mixed two generations of @velarscript/* — run 'npm ls @velarscript/compiler' and pin one version");
  }
  return typeof runtime.toRaw === "function" && typeof runtime.collectionRead === "function" ? runtime : null;
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
  [VELAR_WORKER_MANIFEST_MODULE, "export const workerEntries = Object.freeze({});\n"],
  [VELAR_CLASS_FIELD_MODULE, VELAR_CLASS_FIELD_MODULE_SOURCE],
  [VELAR_COLLECTION_HOST_MODULE, VELAR_COLLECTION_HOST_MODULE_SOURCE],
  [VELAR_COLLECTION_LOWERING_MODULE, VELAR_COLLECTION_LOWERING_MODULE_SOURCE],
  [VELAR_ERROR_NORMALIZATION_MODULE, VELAR_ERROR_NORMALIZATION_MODULE_SOURCE],
  [VELAR_NARROWING_MODULE, VELAR_NARROWING_MODULE_SOURCE],
  [VELAR_PRIMITIVE_METHOD_MODULE, VELAR_PRIMITIVE_METHOD_MODULE_SOURCE],
  [VELAR_PROMISE_NORMALIZATION_MODULE, VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE],
  [VELAR_REACTIVE_BRIDGE_MODULE, VELAR_NON_REACTIVE_BRIDGE_MODULE_SOURCE],
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
const __velarCollectionsObjectDefineProperty = __velarCollectionsHostOperation(__velarCollectionsNativeObject, "defineProperty");
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
  // R1: comparable() already fences NaN upstream, so this is defence in depth —
  // the ordering primitive must never answer "equal" for an unordered value.
  if (left !== left || right !== right) throw new __velarCollectionsNativeTypeError("ordered comparison found NaN, which has no ordering");
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

// Compiler-only entry point for a direct counted range loop. Validation
// deliberately completes before the loop body starts, matching range()'s
// eager errors without allocating the produced List.
function __velarCountedRange(start, stop = null, step = 1) {
  if (stop === null) { stop = start; start = 0; }
  if (!__velarCollectionsCall(__velarCollectionsNumberIsFinite, __velarCollectionsNativeNumber, [start]) || !__velarCollectionsCall(__velarCollectionsNumberIsFinite, __velarCollectionsNativeNumber, [stop]) || !__velarCollectionsCall(__velarCollectionsNumberIsFinite, __velarCollectionsNativeNumber, [step]) || step === 0) throw new __velarCollectionsNativeRangeError("range requires finite numbers and a non-zero step");
  // World and binary workloads use many small integer ranges. Their iteration
  // count is exact arithmetic, so validate the million-item bound in constant
  // time instead of replaying the complete counter before the emitted loop.
  // Floating-point and very large ranges retain the step-by-step path below,
  // including its exact non-advancing-number behaviour.
  if (__velarCollectionsCall(__velarCollectionsNumberIsSafeInteger, __velarCollectionsNativeNumber, [start])
    && __velarCollectionsCall(__velarCollectionsNumberIsSafeInteger, __velarCollectionsNativeNumber, [stop])
    && __velarCollectionsCall(__velarCollectionsNumberIsSafeInteger, __velarCollectionsNativeNumber, [step])) {
    const distance = step > 0 ? stop - start : start - stop;
    if (distance <= 0) return [start, stop, step];
    if (__velarCollectionsCall(__velarCollectionsNumberIsSafeInteger, __velarCollectionsNativeNumber, [distance])) {
      const magnitude = step > 0 ? step : -step;
      const count = __velarCollectionsCall(__velarCollectionsMathFloor, __velarCollectionsNativeMath, [(distance - 1) / magnitude]) + 1;
      if (count > __velarMaxListItems) throw new __velarCollectionsNativeRangeError("range cannot produce more than " + __velarMaxListItems + " items");
      return [start, stop, step];
    }
  }
  let count = 0;
  if (step > 0) for (let value = start; value < stop;) {
    if (count >= __velarMaxListItems) throw new __velarCollectionsNativeRangeError("range cannot produce more than " + __velarMaxListItems + " items");
    count += 1; const next = value + step;
    if (next === value) throw new __velarCollectionsNativeRangeError("range step is too small to advance at this magnitude");
    value = next;
  } else for (let value = start; value > stop;) {
    if (count >= __velarMaxListItems) throw new __velarCollectionsNativeRangeError("range cannot produce more than " + __velarMaxListItems + " items");
    count += 1; const next = value + step;
    if (next === value) throw new __velarCollectionsNativeRangeError("range step is too small to advance at this magnitude");
    value = next;
  }
  // The tuple is a compiler-private handoff consumed immediately by generated
  // scalar locals. It never reaches VelarScript code, so freezing it only adds
  // allocation work to every nested counter loop without strengthening a
  // source-visible boundary.
  return [start, stop, step];
}
__velarCollectionsCall(__velarCollectionsObjectDefineProperty, __velarCollectionsNativeObject, [range, "__velarCounted", {
  value: __velarCountedRange,
  enumerable: false,
  configurable: false,
  writable: false,
}]);

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
export function sum(values) { values = requireList(values, "sum"); let total = 0; for (let index = 0; index < values.length; index += 1) { if (typeof values[index] !== "number") throw new __velarCollectionsNativeTypeError("sum requires numbers"); if (values[index] !== values[index]) throw new __velarCollectionsNativeTypeError("sum found NaN, which poisons the total; drop it with filter(x => not x.isNaN()) or fix the upstream computation"); total += values[index]; } return total; }
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
const maxTextPatternMillis = 250;
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
const __velarTextNativeDate = globalThis.Date;
const __velarTextDateNow = __velarTextGetOwnPropertyDescriptor(__velarTextNativeDate, "now")?.value;
const nativeRegExpPrototype = __velarTextGetPrototypeOf(/(?:)/u);
const NativeRegExp = __velarTextGetOwnPropertyDescriptor(nativeRegExpPrototype, "constructor")?.value;
const nativeRegExpExec = __velarTextGetOwnPropertyDescriptor(nativeRegExpPrototype, "exec")?.value;
const nativeStringReplaceAll = __velarNativeStringReplaceAll;
const __velarTextStringCodePointAt = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "codePointAt")?.value;
const __velarTextStringFromCodePoint = __velarTextGetOwnPropertyDescriptor(__velarTextNativeString, "fromCodePoint")?.value;
const __velarTextTitleSeparators = /[_\-/]+/gu;
const __velarTextTitleWords = /(^|\s)([\p{L}\p{N}])/gu;
// A line ends at CRLF, at a lone CR, or at LF — the same three the language
// itself accepts as a statement separator and the same three
// SourceText indexes for diagnostics. A text API that disagreed with its
// own language would make Text.lineStarts on Vel source compute line
// numbers the compiler does not report.
const __velarTextLines = /\r\n|[\r\n]/gu;
const __velarTextWords = /\s+/gu;
const __velarTextLatinMarks = /(?<=\p{Script=Latin})\p{M}+/gu;
const __velarTextBaselessMarks = /(?<![\p{L}\p{N}\p{M}])\p{M}+/gu;
const __velarTextSlugSeparators = /[^\p{L}\p{N}\p{M}]+/gu;
const __velarTextSlugEdges = /^-+|-+$/gu;
const __velarTextWhitespace = /\s+/gu;
const __velarTextPatternPrefix = /^Invalid regular expression: (?:\/[\s\S]*\/[a-z]*: )?/u;
function __velarTextAppend(values, value) { values[values.length] = value; }
function __velarTextJoin(values, separator) { return __velarTextCall(__velarTextArrayJoin, values, [separator]); }
// TXT-P2: bounded work is already the promise on this surface — the code-unit
// and item caps are here — and time was the dimension that was missed, so a
// backtracking pattern over hostile input could run for as long as it liked.
// Every operation that runs a pattern the author supplied gets a fresh budget,
// checked at every exec boundary. The engine is not interruptible, so one
// catastrophic exec is caught when it returns rather than pre-empted; that
// still turns a silent unbounded hang into a loud bounded failure and stops
// the amplification a per-match loop would otherwise give it. The budget is
// deliberately not charged to slug, title or normalizeWhitespace: they run
// this module's own linear patterns, so their only bound is on size, and a
// wall clock would otherwise make a large but legal text succeed or fail by
// how busy the machine is.
function patternDeadline() { return __velarTextCall(__velarTextDateNow, __velarTextNativeDate, []) + maxTextPatternMillis; }
function checkPatternDeadline(deadline) {
  if (__velarTextCall(__velarTextDateNow, __velarTextNativeDate, []) > deadline) throw new __velarTextNativeRangeError("text pattern matching cannot exceed " + maxTextPatternMillis + " ms");
}
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
// TXT-P1: the engine's reason is the only actionable half of an invalid-pattern
// failure. Patterns compile in 'u' mode, so an identity escape that is tolerated
// everywhere else in JavaScript is an error here, and "[a-z" and "\\@" are
// otherwise byte-identical failures. The host-shaped prefix is stripped so the
// engine's own text does not travel verbatim, and a caught value that is not an
// Error, or carries no usable message, falls back to the bare message.
function patternReason(error) {
  if (typeof error !== "object" || error === null) return "";
  const descriptor = __velarTextGetOwnPropertyDescriptor(error, "message");
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") return "";
  const message = descriptor.value;
  const prefix = __velarTextCall(nativeRegExpExec, __velarTextPatternPrefix, [message]);
  const head = prefix === null ? null : __velarTextGetOwnPropertyDescriptor(prefix, 0);
  const reason = head && typeof head.value === "string" ? __velarTextCall(__velarNativeStringSlice, message, [head.value.length]) : message;
  return reason === "" || reason.length > 200 ? "" : ": " + reason;
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
  catch (error) { throw new __velarTextNativeTypeError("Invalid text pattern" + patternReason(error)); }
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
  const deadline = patternDeadline();
  let count = 0, units = 0, previousUnitIndex = 0, previousCodePointIndex = 0;
  while (true) {
    const raw = __velarTextCall(nativeRegExpExec, pattern, [value]);
    checkPatternDeadline(deadline);
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
    const code = __velarTextCall(__velarNativeStringCharCodeAt, value, [unitOffset]);
    // CRLF is one break, not two: consume the LF with the CR so the following
    // line starts once. A lone CR breaks as well — see __velarTextLines.
    if (code === 13 && __velarTextCall(__velarNativeStringCharCodeAt, value, [nextUnitOffset]) === 10) {
      __velarTextAppend(output, codePointOffset + 2);
      unitOffset = __velarTextNextCodePointOffset(value, nextUnitOffset);
      codePointOffset += 2;
      continue;
    }
    if (code === 10 || code === 13) __velarTextAppend(output, codePointOffset + 1);
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
// TXT-U4: the NFKD pass is folding machinery, not a result. Text equality is
// code-point-sequence identity, so a decomposed slug misses the text it renders
// as — a Hangul syllable comes back as conjoining jamo and never matches the
// title it was made from. The output is recomposed to NFC before it leaves.
// Folding only reaches marks sitting on a Latin base, because dropping a mark
// is meaning-preserving there and meaning-destroying everywhere else: every
// other script keeps its marks, and those slugs are percent-encoded in a URL.
// Marks the separator pass now has to keep must still have something to sit
// on: a mark run with no letter or digit before it — a variation selector left
// behind by a dropped emoji, a stray accent — is invisible in a URL, so two
// slugs that read alike would name different pages. Those runs go.
export function slug(value) { let output = __velarTextCall(__velarTextStringNormalize, valueOf(value), ["NFKD"]); output = __velarTextRegexReplace(output, __velarTextLatinMarks, ""); output = __velarTextRegexReplace(output, __velarTextBaselessMarks, ""); output = __velarTextCall(__velarNativeStringLower, output, []); output = __velarTextCall(__velarNativeStringTrim, output, []); output = __velarTextRegexReplace(output, __velarTextSlugSeparators, "-"); output = __velarTextRegexReplace(output, __velarTextSlugEdges, ""); return textOutput(__velarTextCall(__velarTextStringNormalize, output, ["NFC"]), "slug"); }
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
export function matches(value, expression, options = {}) { value = valueOf(value); const pattern = patternOf(expression, options); const deadline = patternDeadline(); const found = __velarTextCall(nativeRegExpExec, pattern, [value]) !== null; checkPatternDeadline(deadline); return found; }
export function findMatch(value, expression, options = {}) { value = valueOf(value); const pattern = patternOf(expression, options); const deadline = patternDeadline(); const match = __velarTextCall(nativeRegExpExec, pattern, [value]); checkPatternDeadline(deadline); return match === null ? null : publicMatchValue(checkedMatchValue(match, value), value); }
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
  __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [end])); return textList(output, "splitPattern");
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
// R1: a NaN may be held and tested with .isNaN(), but nothing compares or
// aggregates it. The self-inequality test cannot be redirected by a host.
function requireOrderedNumber(value, name) { requireNumber(value, name); if (value !== value) throw new __velarMathNativeTypeError(name + " found NaN, which has no ordering; drop it with filter(x => not x.isNaN()) or fix the upstream computation"); return value; }
function unary(value, operation, name) { return __velarMathCall(operation, [requireNumber(value, name)]); }
function binary(left, right, operation, name) { return __velarMathCall(operation, [requireNumber(left, name), requireNumber(right, name)]); }
export const pi = __velarMathHostData(__velarMathNativeMath, "PI", "number");
export const e = __velarMathHostData(__velarMathNativeMath, "E", "number");
export const tau = pi * 2;
export const infinity = __velarMathHostData(__velarMathNativeNumber, "POSITIVE_INFINITY", "number");
export function min(...values) { if (!values.length) throw new __velarMathNativeRangeError("min requires at least one number"); let result = requireOrderedNumber(values[0], "Math.min"); for (let index = 1; index < values.length; index += 1) result = __velarMathCall(__velarMathMin, [result, requireOrderedNumber(values[index], "Math.min")]); return result; }
export function max(...values) { if (!values.length) throw new __velarMathNativeRangeError("max requires at least one number"); let result = requireOrderedNumber(values[0], "Math.max"); for (let index = 1; index < values.length; index += 1) result = __velarMathCall(__velarMathMax, [result, requireOrderedNumber(values[index], "Math.max")]); return result; }
export function clamp(value, minimum, maximum) { value = requireOrderedNumber(value, "Math.clamp"); minimum = requireOrderedNumber(minimum, "Math.clamp"); maximum = requireOrderedNumber(maximum, "Math.clamp"); if (minimum > maximum) throw new __velarMathNativeRangeError("clamp minimum cannot exceed maximum"); return __velarMathCall(__velarMathMin, [maximum, __velarMathCall(__velarMathMax, [minimum, value])]); }
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
  ["velar/binary", String.raw`
import { __VelarIndexError } from ${JSON.stringify(VELAR_COLLECTION_LOWERING_MODULE)};
${VELAR_TYPE_REGISTRY_RUNTIME}

const __velarBinaryNativeObject = globalThis.Object;
const __velarBinaryNativeArray = globalThis.Array;
const __velarBinaryNativeNumber = globalThis.Number;
const __velarBinaryNativeUint8Array = globalThis.Uint8Array;
const __velarBinaryNativeUint16Array = globalThis.Uint16Array;
const __velarBinaryNativeUint32Array = globalThis.Uint32Array;
const __velarBinaryNativeFloat32Array = globalThis.Float32Array;
const __velarBinaryNativeDataView = globalThis.DataView;
const __velarBinaryNativeWeakMap = globalThis.WeakMap;
const __velarBinaryNativeFunction = globalThis.Function;
const __velarBinaryNativeTypeError = globalThis.TypeError;
const __velarBinaryNativeRangeError = globalThis.RangeError;
const __velarBinaryGetOwnPropertyDescriptor = __velarBinaryNativeObject.getOwnPropertyDescriptor;
const __velarBinaryGetPrototypeOf = __velarBinaryNativeObject.getPrototypeOf;
const __velarBinaryFreeze = __velarBinaryNativeObject.freeze;
const __velarBinaryApply = __velarBinaryGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarBinaryFunctionPrototype = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeFunction, "prototype")?.value;
const __velarBinaryBind = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryFunctionPrototype, "bind")?.value;
const __velarBinaryNumberIsInteger = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeNumber, "isInteger")?.value;
const __velarBinaryNumberIsSafeInteger = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeNumber, "isSafeInteger")?.value;
const __velarBinaryNumberIsFinite = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeNumber, "isFinite")?.value;
const __velarBinaryTypedArrayPrototype = __velarBinaryGetPrototypeOf(__velarBinaryNativeUint8Array.prototype);
const __velarBinaryTypedArrayTag = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryTypedArrayPrototype, globalThis.Symbol.toStringTag)?.get;
const __velarBinaryTypedArrayLength = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryTypedArrayPrototype, "length")?.get;
const __velarBinaryTypedArraySet = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryTypedArrayPrototype, "set")?.value;
const __velarBinaryWeakMapPrototype = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeWeakMap, "prototype")?.value;
const __velarBinaryWeakMapGet = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryWeakMapPrototype, "get")?.value;
const __velarBinaryWeakMapSet = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryWeakMapPrototype, "set")?.value;
if (typeof __velarBinaryApply !== "function" || typeof __velarBinaryBind !== "function" || typeof __velarBinaryNumberIsInteger !== "function"
  || typeof __velarBinaryNumberIsSafeInteger !== "function" || typeof __velarBinaryTypedArrayTag !== "function"
  || typeof __velarBinaryNumberIsFinite !== "function" || typeof __velarBinaryTypedArrayLength !== "function"
  || typeof __velarBinaryTypedArraySet !== "function" || typeof __velarBinaryNativeArray !== "function" || typeof __velarBinaryNativeDataView !== "function"
  || typeof __velarBinaryNativeWeakMap !== "function" || typeof __velarBinaryWeakMapGet !== "function"
  || typeof __velarBinaryWeakMapSet !== "function") {
  throw new __velarBinaryNativeTypeError("The JavaScript typed-array runtime is unavailable");
}
function __velarBinaryCall(operation, receiver, arguments_) { return __velarBinaryApply(operation, receiver, arguments_); }
function __velarBinaryKind(value) {
  try { return __velarBinaryCall(__velarBinaryTypedArrayTag, value, []); }
  catch { return null; }
}
function __velarBinaryLength(value, expected, name) {
  if (__velarBinaryKind(value) !== expected) throw new __velarBinaryNativeTypeError(name + " requires " + expected);
  return __velarBinaryCall(__velarBinaryTypedArrayLength, value, []);
}
function __velarBinaryOrder(order) {
  if (order !== "little" && order !== "big") throw new __velarBinaryNativeTypeError("Byte order must be ByteOrder.little or ByteOrder.big");
  return order;
}
function __velarBinaryCheckedIndex(value, index, expected, name) {
  const length = __velarBinaryLength(value, expected, name);
  if (!__velarBinaryCall(__velarBinaryNumberIsInteger, __velarBinaryNativeNumber, [index]) || index < 0 || index >= length) {
    throw new __VelarIndexError(name + " index must be an integer from 0 up to but excluding size");
  }
  return index;
}
// 编译器和标准库创建的定长缓冲区已经在入口处完成了品牌与容量校验。把长度
// 记录在私有 WeakMap 中，热路径只需一次不可伪造的身份查询和整数边界判断；
// 来自宿主、尚未经过 parse 的值仍回退到完整品牌检查，安全边界不被放宽。
const __velarBinaryTrustedLengths = new __velarBinaryNativeWeakMap();
// 预绑定捕获的 WeakMap 方法，热路径可直接调用原生 bound function，不必为每次
// 索引重新构造 Reflect.apply 的参数数组。绑定目标和接收者都不再经过可变原型。
const __velarBinaryTrustedLengthGet = __velarBinaryCall(__velarBinaryBind, __velarBinaryWeakMapGet, [__velarBinaryTrustedLengths]);
const __velarBinaryTrustedLengthSet = __velarBinaryCall(__velarBinaryBind, __velarBinaryWeakMapSet, [__velarBinaryTrustedLengths]);
function __velarBinaryTrust(value, length) {
  __velarBinaryTrustedLengthSet(value, length);
  return value;
}
function __velarBinaryTrustedIndex(value, index, expected, name) {
  const trustedLength = __velarBinaryTrustedLengthGet(value);
  if (trustedLength === undefined) return __velarBinaryCheckedIndex(value, index, expected, name);
  if (!__velarBinaryNumberIsInteger(index) || index < 0 || index >= trustedLength) {
    throw new __VelarIndexError(name + " index must be an integer from 0 up to but excluding size");
  }
  return index;
}
function __velarBinarySnapshot(value, expected, Constructor, name) {
  const length = __velarBinaryLength(value, expected, name);
  const bytes = expected === "Uint8Array" ? 1 : expected === "Uint16Array" ? 2 : 4;
  __velarBinarySizeLimit(length, bytes, name);
  const output = new Constructor(length);
  __velarBinaryCall(__velarBinaryTypedArraySet, output, [value]);
  return __velarBinaryTrust(output, length);
}
function __velarBinaryWithinLimit(value, expected, bytes) {
  return __velarBinaryKind(value) === expected
    && __velarBinaryCall(__velarBinaryTypedArrayLength, value, []) <= (64 * 1024 * 1024) / bytes;
}
function __velarBinarySpec(value, name = "Binary buffer") {
  switch (__velarBinaryKind(value)) {
    case "Uint8Array": return { name: "UInt8Buffer", bytes: 1, Constructor: __velarBinaryNativeUint8Array, minimum: 0, maximum: 255, integer: true };
    case "Uint16Array": return { name: "UInt16Buffer", bytes: 2, Constructor: __velarBinaryNativeUint16Array, minimum: 0, maximum: 65535, integer: true };
    case "Uint32Array": return { name: "UInt32Buffer", bytes: 4, Constructor: __velarBinaryNativeUint32Array, minimum: 0, maximum: 4294967295, integer: true };
    case "Float32Array": return { name: "Float32Buffer", bytes: 4, Constructor: __velarBinaryNativeFloat32Array, minimum: -3.4028234663852886e38, maximum: 3.4028234663852886e38, integer: false };
    default: throw new __velarBinaryNativeTypeError(name + " requires a supported fixed numeric buffer");
  }
}
function __velarBinarySizeLimit(size, bytes, name) {
  if (!__velarBinaryCall(__velarBinaryNumberIsSafeInteger, __velarBinaryNativeNumber, [size]) || size < 0 || size > (64 * 1024 * 1024) / bytes) {
    throw new __velarBinaryNativeRangeError(name + " size exceeds the 64 MiB binary-memory limit");
  }
  return size;
}
function __velarBinaryAllocate(Constructor, bytes, size, name) {
  const length = __velarBinarySizeLimit(size, bytes, name);
  return __velarBinaryTrust(new Constructor(length), length);
}
function __velarBinaryValue(spec, value) {
  const valid = typeof value === "number" && __velarBinaryCall(__velarBinaryNumberIsFinite, __velarBinaryNativeNumber, [value])
    && value >= spec.minimum && value <= spec.maximum
    && (!spec.integer || __velarBinaryCall(__velarBinaryNumberIsInteger, __velarBinaryNativeNumber, [value]));
  if (!valid) throw new __velarBinaryNativeRangeError(spec.name + " value is outside its supported numeric range");
  return value;
}

export const ByteOrder = __velarRegisterRuntimeType(__velarBinaryFreeze({
  little: "little",
  big: "big",
  is(value) { return value === "little" || value === "big"; },
  parse(value) {
    if (!ByteOrder.is(value)) throw new __velarBinaryNativeTypeError("Value does not match ByteOrder");
    return value;
  },
  values() { return ["little", "big"]; },
}));
export const Bytes = __velarRegisterRuntimeType(__velarBinaryFreeze({
  is(value) { return __velarBinaryWithinLimit(value, "Uint8Array", 1); },
  parse(value) { return __velarBinarySnapshot(value, "Uint8Array", __velarBinaryNativeUint8Array, "Bytes.parse"); },
  __velarSize: __velarBinarySize,
  __velarIndex: __velarBytesIndex,
  __velarSetIndex: __velarBytesSetIndex,
  __velarUInt8Index,
  __velarUInt8SetIndex,
  __velarUInt16Index,
  __velarUInt16SetIndex,
  __velarUInt32Index,
  __velarUInt32SetIndex,
  __velarFloat32Index,
  __velarFloat32SetIndex,
  __velarBufferCopy,
  __velarBufferSlice,
  __velarBufferToBytes,
  __velarBufferValues,
  __velarBufferIterator,
  __velarBufferPairIterator,
  __velarAdoptTransferredBuffer,
}));
export const UInt8Buffer = __velarRegisterRuntimeType(__velarBinaryFreeze({
  is(value) { return __velarBinaryWithinLimit(value, "Uint8Array", 1); },
  parse(value) { return __velarBinarySnapshot(value, "Uint8Array", __velarBinaryNativeUint8Array, "UInt8Buffer.parse"); },
}));
export const UInt16Buffer = __velarRegisterRuntimeType(__velarBinaryFreeze({
  is(value) { return __velarBinaryWithinLimit(value, "Uint16Array", 2); },
  parse(value) { return __velarBinarySnapshot(value, "Uint16Array", __velarBinaryNativeUint16Array, "UInt16Buffer.parse"); },
}));
export const UInt32Buffer = __velarRegisterRuntimeType(__velarBinaryFreeze({
  is(value) { return __velarBinaryWithinLimit(value, "Uint32Array", 4); },
  parse(value) { return __velarBinarySnapshot(value, "Uint32Array", __velarBinaryNativeUint32Array, "UInt32Buffer.parse"); },
}));
export const Float32Buffer = __velarRegisterRuntimeType(__velarBinaryFreeze({
  is(value) { return __velarBinaryFloat32Is(value); },
  parse(value) { return __velarBinaryFloat32Snapshot(value, "Float32Buffer.parse"); },
}));

export function uint8Buffer(size) { return __velarBinaryAllocate(__velarBinaryNativeUint8Array, 1, size, "uint8Buffer"); }
export function uint16Buffer(size) { return __velarBinaryAllocate(__velarBinaryNativeUint16Array, 2, size, "uint16Buffer"); }
export function uint32Buffer(size) { return __velarBinaryAllocate(__velarBinaryNativeUint32Array, 4, size, "uint32Buffer"); }
export function float32Buffer(size) { return __velarBinaryAllocate(__velarBinaryNativeFloat32Array, 4, size, "float32Buffer"); }
export function uint8FromBytes(snapshot) { return __velarBinarySnapshot(snapshot, "Uint8Array", __velarBinaryNativeUint8Array, "uint8FromBytes"); }
export function uint16FromBytes(snapshot, order) {
  return __velarBufferFromBytes(snapshot, order, __velarBinaryNativeUint16Array, 2, "uint16FromBytes", "getUint16");
}
export function uint32FromBytes(snapshot, order) { return __velarBufferFromBytes(snapshot, order, __velarBinaryNativeUint32Array, 4, "uint32FromBytes", "getUint32"); }
export function float32FromBytes(snapshot, order) { return __velarBufferFromBytes(snapshot, order, __velarBinaryNativeFloat32Array, 4, "float32FromBytes", "getFloat32", __velarBinaryFloat32Value); }
function __velarBinarySize(value) {
  const kind = __velarBinaryKind(value);
  if (kind !== "Uint8Array" && kind !== "Uint16Array" && kind !== "Uint32Array" && kind !== "Float32Array") throw new __velarBinaryNativeTypeError("Binary size requires Bytes or a fixed numeric buffer");
  return __velarBinaryCall(__velarBinaryTypedArrayLength, value, []);
}
function __velarBytesIndex(value, index) {
  return value[__velarBinaryTrustedIndex(value, index, "Uint8Array", "Bytes")];
}
function __velarBytesSetIndex() {
  throw new __velarBinaryNativeTypeError("Bytes is a read-only binary snapshot");
}
function __velarBinaryIntegerValue(value, minimum, maximum, name) {
  if (!__velarBinaryCall(__velarBinaryNumberIsInteger, __velarBinaryNativeNumber, [value]) || value < minimum || value > maximum) throw new __velarBinaryNativeRangeError(name + " value is outside its supported integer range");
  return value;
}
function __velarBinaryFloat32Value(value) {
  if (typeof value !== "number" || !__velarBinaryCall(__velarBinaryNumberIsFinite, __velarBinaryNativeNumber, [value]) || value < -3.4028234663852886e38 || value > 3.4028234663852886e38) throw new __velarBinaryNativeRangeError("Float32Buffer value is outside its supported finite range");
  return value;
}
function __velarBinaryFloat32Is(value) {
  if (__velarBinaryKind(value) !== "Float32Array") return false;
  const length = __velarBinaryCall(__velarBinaryTypedArrayLength, value, []);
  if (length > (64 * 1024 * 1024) / 4) return false;
  for (let index = 0; index < length; index += 1) {
    const item = value[index];
    if (typeof item !== "number" || !__velarBinaryCall(__velarBinaryNumberIsFinite, __velarBinaryNativeNumber, [item])) return false;
  }
  return true;
}
function __velarBinaryFloat32Snapshot(value, name) {
  const length = __velarBinaryLength(value, "Float32Array", name);
  __velarBinarySizeLimit(length, 4, name);
  const output = new __velarBinaryNativeFloat32Array(length);
  for (let index = 0; index < length; index += 1) output[index] = __velarBinaryFloat32Value(value[index]);
  return __velarBinaryTrust(output, length);
}
function __velarUInt8Index(value, index) { return value[__velarBinaryTrustedIndex(value, index, "Uint8Array", "UInt8Buffer")]; }
function __velarUInt8SetIndex(value, index, next) {
  index = __velarBinaryTrustedIndex(value, index, "Uint8Array", "UInt8Buffer");
  value[index] = __velarBinaryIntegerValue(next, 0, 255, "UInt8Buffer");
  return next;
}
function __velarUInt16Index(value, index) { return value[__velarBinaryTrustedIndex(value, index, "Uint16Array", "UInt16Buffer")]; }
function __velarUInt16SetIndex(value, index, next) {
  index = __velarBinaryTrustedIndex(value, index, "Uint16Array", "UInt16Buffer");
  value[index] = __velarBinaryIntegerValue(next, 0, 65535, "UInt16Buffer");
  return next;
}
function __velarUInt32Index(value, index) { return value[__velarBinaryTrustedIndex(value, index, "Uint32Array", "UInt32Buffer")]; }
function __velarUInt32SetIndex(value, index, next) {
  index = __velarBinaryTrustedIndex(value, index, "Uint32Array", "UInt32Buffer");
  value[index] = __velarBinaryIntegerValue(next, 0, 4294967295, "UInt32Buffer");
  return next;
}
function __velarFloat32Index(value, index) { return value[__velarBinaryTrustedIndex(value, index, "Float32Array", "Float32Buffer")]; }
function __velarFloat32SetIndex(value, index, next) {
  index = __velarBinaryTrustedIndex(value, index, "Float32Array", "Float32Buffer");
  value[index] = __velarBinaryFloat32Value(next);
  return next;
}
function __velarBufferCopy(value) { return __velarBufferSlice(value, 0, __velarBinarySize(value)); }
function __velarBufferValues(value) {
  const spec = __velarBinarySpec(value);
  const length = __velarBinarySize(value);
  if (length > 1000000) throw new __velarBinaryNativeRangeError(spec.name + ".values cannot produce more than 1000000 List items");
  const output = new __velarBinaryNativeArray(length);
  for (let index = 0; index < length; index += 1) output[index] = value[index];
  return output;
}
function* __velarBufferIterator(value) {
  const spec = __velarBinarySpec(value);
  const length = __velarBinarySize(value);
  __velarBinarySizeLimit(length, spec.bytes, spec.name + " iteration");
  for (let index = 0; index < length; index += 1) yield value[index];
}
function* __velarBufferPairIterator(value) {
  let index = 0;
  for (const item of __velarBufferIterator(value)) yield [item, index++];
}
// Worker structured cloning gives the receiver exclusive ownership of every
// transferred full-buffer view. Validate that view once and register its
// length in the same private fast-path memo used by standard-library-created
// buffers; no public source operation can claim this privilege.
function __velarAdoptTransferredBuffer(value) {
  const spec = __velarBinarySpec(value, "Transferred binary buffer");
  const length = __velarBinarySize(value);
  __velarBinarySizeLimit(length, spec.bytes, spec.name + " transfer");
  if (!spec.integer) {
    for (let index = 0; index < length; index += 1) __velarBinaryFloat32Value(value[index]);
  }
  return __velarBinaryTrust(value, length);
}
function __velarBufferSlice(value, start = 0, end = __velarBinarySize(value)) {
  const spec = __velarBinarySpec(value);
  const length = __velarBinarySize(value);
  if (!__velarBinaryCall(__velarBinaryNumberIsSafeInteger, __velarBinaryNativeNumber, [start]) || !__velarBinaryCall(__velarBinaryNumberIsSafeInteger, __velarBinaryNativeNumber, [end]) || start < 0 || end < start || end > length) {
    throw new __velarBinaryNativeRangeError(spec.name + ".slice requires 0 <= start <= end <= size");
  }
  const output = new spec.Constructor(end - start);
  for (let index = start; index < end; index += 1) output[index - start] = value[index];
  return __velarBinaryTrust(output, end - start);
}
function __velarBufferToBytes(value, order = null) {
  const spec = __velarBinarySpec(value);
  const length = __velarBinarySize(value);
  if (spec.bytes === 1) return __velarBinarySnapshot(value, "Uint8Array", __velarBinaryNativeUint8Array, "UInt8Buffer.toBytes");
  order = __velarBinaryOrder(order);
  const output = new __velarBinaryNativeUint8Array(length * spec.bytes);
  const view = new __velarBinaryNativeDataView(output.buffer);
  const operation = spec.name === "UInt16Buffer" ? "setUint16" : spec.name === "UInt32Buffer" ? "setUint32" : "setFloat32";
  const setter = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeDataView.prototype, operation)?.value;
  if (typeof setter !== "function") throw new __velarBinaryNativeTypeError("DataView " + operation + " is unavailable");
  for (let index = 0; index < length; index += 1) {
    __velarBinaryCall(setter, view, [index * spec.bytes, value[index], order === "little"]);
  }
  return __velarBinaryTrust(output, length * spec.bytes);
}
function __velarBufferFromBytes(snapshot, order, Constructor, bytes, name, operation, validate = null) {
  const length = __velarBinaryLength(snapshot, "Uint8Array", name);
  __velarBinarySizeLimit(length, 1, name);
  order = __velarBinaryOrder(order);
  if (length % bytes !== 0) throw new __velarBinaryNativeRangeError(name + " requires a byte length divisible by " + bytes);
  const output = __velarBinaryAllocate(Constructor, bytes, length / bytes, name);
  const view = new __velarBinaryNativeDataView(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength);
  const getter = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeDataView.prototype, operation)?.value;
  if (typeof getter !== "function") throw new __velarBinaryNativeTypeError("DataView " + operation + " is unavailable");
  for (let index = 0; index < output.length; index += 1) {
    const item = __velarBinaryCall(getter, view, [index * bytes, order === "little"]);
    output[index] = validate === null ? item : validate(item);
  }
  return output;
}
const __velarBinaryBuilders = new __velarBinaryNativeWeakMap();
const __velarBinaryBuilderPrototype = __velarBinaryFreeze({
  get size() { const state = __velarBinaryCall(__velarBinaryWeakMapGet, __velarBinaryBuilders, [this]); if (!state) throw new __velarBinaryNativeTypeError("Builder size requires a binary builder"); return state.size; },
  get maxElements() { const state = __velarBinaryCall(__velarBinaryWeakMapGet, __velarBinaryBuilders, [this]); if (!state) throw new __velarBinaryNativeTypeError("Builder maxElements requires a binary builder"); return state.maximum; },
  push(value) {
    const state = __velarBinaryCall(__velarBinaryWeakMapGet, __velarBinaryBuilders, [this]); if (!state || state.finished) throw new __velarBinaryNativeTypeError("Binary builder is finished");
    if (state.size >= state.maximum) throw new __velarBinaryNativeRangeError(state.spec.name + " builder exceeds maxElements");
    if (state.size === state.storage.length) { let capacity = state.storage.length * 2; if (capacity < 8) capacity = 8; if (capacity > state.maximum) capacity = state.maximum; const storage = new state.spec.Constructor(capacity); __velarBinaryCall(__velarBinaryTypedArraySet, storage, [state.storage]); state.storage = storage; }
    state.storage[state.size] = __velarBinaryValue(state.spec, value); state.size += 1; return null;
  },
  finish() {
    const state = __velarBinaryCall(__velarBinaryWeakMapGet, __velarBinaryBuilders, [this]); if (!state || state.finished) throw new __velarBinaryNativeTypeError("Binary builder is finished");
    let output = state.storage;
    if (state.size !== output.length) { output = new state.spec.Constructor(state.size); __velarBinaryCall(__velarBinaryTypedArraySet, output, [state.storage]); }
    state.finished = true; state.storage = null; return __velarBinaryTrust(output, state.size);
  },
});
function __velarBinaryBuilder(maximum, Constructor, bytes, name) {
  maximum = __velarBinarySizeLimit(maximum, bytes, name);
  const value = __velarBinaryFreeze(__velarBinaryNativeObject.create(__velarBinaryBuilderPrototype));
  const empty = new Constructor(maximum < 256 ? maximum : 256);
  __velarBinaryCall(__velarBinaryWeakMapSet, __velarBinaryBuilders, [value, { maximum, size: 0, storage: empty, spec: __velarBinarySpec(empty), finished: false }]);
  return value;
}
function __velarBinaryBuilderType(name, Constructor) { return __velarRegisterRuntimeType(__velarBinaryFreeze({ is(value) { const state = __velarBinaryCall(__velarBinaryWeakMapGet, __velarBinaryBuilders, [value]); return !!state && state.spec.Constructor === Constructor && !state.finished; }, parse(value) { if (!this.is(value)) throw new __velarBinaryNativeTypeError("Value does not match " + name); return value; } })); }
export const UInt32Builder = __velarBinaryBuilderType("UInt32Builder", __velarBinaryNativeUint32Array);
export const Float32Builder = __velarBinaryBuilderType("Float32Builder", __velarBinaryNativeFloat32Array);
export function uint32Builder(maxElements) { return __velarBinaryBuilder(maxElements, __velarBinaryNativeUint32Array, 4, "uint32Builder"); }
export function float32Builder(maxElements) { return __velarBinaryBuilder(maxElements, __velarBinaryNativeFloat32Array, 4, "float32Builder"); }
`.trimStart()],
  ["velar/hash", VELAR_CORE_HASH_RUNTIME],
  ["velar/random", String.raw`
${VELAR_TYPE_REGISTRY_RUNTIME}
const __velarRandomNativeObject = globalThis.Object;
const __velarRandomNativeNumber = globalThis.Number;
const __velarRandomNativeArray = globalThis.Array;
const __velarRandomNativeWeakMap = globalThis.WeakMap;
const __velarRandomNativeTypeError = globalThis.TypeError;
const __velarRandomNativeRangeError = globalThis.RangeError;
const __velarRandomNativeMath = globalThis.Math;
const __velarRandomGetOwnPropertyDescriptor = __velarRandomNativeObject.getOwnPropertyDescriptor;
const __velarRandomFreeze = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeObject, "freeze")?.value;
const __velarRandomCreate = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeObject, "create")?.value;
const __velarRandomApply = __velarRandomGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarRandomNumberIsSafeInteger = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeNumber, "isSafeInteger")?.value;
const __velarRandomArrayIsArray = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeArray, "isArray")?.value;
const __velarRandomMathImul = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeMath, "imul")?.value;
const __velarRandomMathFloor = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeMath, "floor")?.value;
const __velarRandomStringPrototype = __velarRandomGetOwnPropertyDescriptor(globalThis.String, "prototype")?.value;
const __velarRandomStringCharCodeAt = __velarRandomGetOwnPropertyDescriptor(__velarRandomStringPrototype, "charCodeAt")?.value;
const __velarRandomWeakMapPrototype = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeWeakMap, "prototype")?.value;
const __velarRandomWeakMapGet = __velarRandomGetOwnPropertyDescriptor(__velarRandomWeakMapPrototype, "get")?.value;
const __velarRandomWeakMapHas = __velarRandomGetOwnPropertyDescriptor(__velarRandomWeakMapPrototype, "has")?.value;
const __velarRandomWeakMapSet = __velarRandomGetOwnPropertyDescriptor(__velarRandomWeakMapPrototype, "set")?.value;
if (typeof __velarRandomFreeze !== "function" || typeof __velarRandomCreate !== "function" || typeof __velarRandomApply !== "function"
  || typeof __velarRandomNumberIsSafeInteger !== "function" || typeof __velarRandomArrayIsArray !== "function"
  || typeof __velarRandomMathImul !== "function" || typeof __velarRandomMathFloor !== "function"
  || typeof __velarRandomStringCharCodeAt !== "function" || typeof __velarRandomWeakMapGet !== "function"
  || typeof __velarRandomWeakMapHas !== "function" || typeof __velarRandomWeakMapSet !== "function") {
  throw new __velarRandomNativeTypeError("The deterministic random runtime is unavailable");
}
function __velarRandomCall(operation, receiver, arguments_) { return __velarRandomApply(operation, receiver, arguments_); }
function __velarRandomImul(left, right) { return __velarRandomCall(__velarRandomMathImul, __velarRandomNativeMath, [left, right]); }
function __velarRandomRotl(value, count) { return (value << count | value >>> (32 - count)) >>> 0; }
function __velarRandomHash(text) {
  let first = (1779033703 ^ text.length) >>> 0;
  let second = (3144134277 ^ text.length) >>> 0;
  let third = (1013904242 ^ text.length) >>> 0;
  let fourth = (2773480762 ^ text.length) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = __velarRandomCall(__velarRandomStringCharCodeAt, text, [index]);
    first = second ^ __velarRandomImul(first ^ code, 597399067);
    second = third ^ __velarRandomImul(second ^ code, 2869860233);
    third = fourth ^ __velarRandomImul(third ^ code, 951274213);
    fourth = first ^ __velarRandomImul(fourth ^ code, 2716044179);
  }
  first = __velarRandomImul(third ^ first >>> 18, 597399067);
  second = __velarRandomImul(fourth ^ second >>> 22, 2869860233);
  third = __velarRandomImul(first ^ third >>> 17, 951274213);
  fourth = __velarRandomImul(second ^ fourth >>> 19, 2716044179);
  const output = new __velarRandomNativeArray(4);
  output[0] = first >>> 0;
  output[1] = second >>> 0;
  output[2] = third >>> 0;
  output[3] = fourth >>> 0;
  if ((output[0] | output[1] | output[2] | output[3]) === 0) output[0] = 1;
  return output;
}
function __velarRandomSeed(seed) {
  if (typeof seed === "string") return __velarRandomHash("s:" + seed);
  if (typeof seed !== "number" || !__velarRandomCall(__velarRandomNumberIsSafeInteger, __velarRandomNativeNumber, [seed])) {
    throw new __velarRandomNativeTypeError("random seed must be a string or safe integer");
  }
  return __velarRandomHash("n:" + seed);
}
const __velarRandomStates = new __velarRandomNativeWeakMap();
function __velarRandomState(value) {
  const state = __velarRandomCall(__velarRandomWeakMapGet, __velarRandomStates, [value]);
  if (state === undefined) throw new __velarRandomNativeTypeError("Random method requires a Random receiver");
  return state;
}
function __velarRandomNext(receiver) {
  const state = __velarRandomState(receiver).state;
  const result = __velarRandomImul(__velarRandomRotl(__velarRandomImul(state[1], 5) >>> 0, 7), 9) >>> 0;
  const temporary = state[1] << 9;
  state[2] ^= state[0]; state[3] ^= state[1]; state[1] ^= state[2]; state[0] ^= state[3]; state[2] ^= temporary;
  state[3] = __velarRandomRotl(state[3], 11);
  state[0] >>>= 0; state[1] >>>= 0; state[2] >>>= 0;
  return result;
}
function __velarRandomRange(start, end) {
  if (end === null) { end = start; start = 0; }
  const width = end - start;
  if (!__velarRandomCall(__velarRandomNumberIsSafeInteger, __velarRandomNativeNumber, [start])
    || !__velarRandomCall(__velarRandomNumberIsSafeInteger, __velarRandomNativeNumber, [end])
    || !__velarRandomCall(__velarRandomNumberIsSafeInteger, __velarRandomNativeNumber, [width])
    || width <= 0) {
    throw new __velarRandomNativeRangeError("Random.int requires an increasing safe-integer range");
  }
  return [start, width];
}
const __velarRandomPrototype = {
  number() { return __velarRandomNext(this) / 4294967296; },
  int(start, end = null) {
    const range = __velarRandomRange(start, end);
    if (range[1] <= 4294967296) {
      const limit = __velarRandomCall(__velarRandomMathFloor, __velarRandomNativeMath, [4294967296 / range[1]]) * range[1];
      let value; do { value = __velarRandomNext(this); } while (value >= limit);
      return range[0] + value % range[1];
    }
    const limit = __velarRandomCall(__velarRandomMathFloor, __velarRandomNativeMath, [9007199254740992 / range[1]]) * range[1];
    let value; do { value = __velarRandomNext(this) * 2097152 + (__velarRandomNext(this) >>> 11); } while (value >= limit);
    return range[0] + value % range[1];
  },
  bool(probability = 0.5) {
    if (typeof probability !== "number" || probability < 0 || probability > 1 || probability !== probability) throw new __velarRandomNativeRangeError("Random.bool probability must be a number from 0 through 1");
    if (probability === 0) return false;
    if (probability === 1) return true;
    return this.number() < probability;
  },
  pick(values) {
    if (!__velarRandomCall(__velarRandomArrayIsArray, __velarRandomNativeArray, [values])) throw new __velarRandomNativeTypeError("Random.pick requires a List");
    if (values.length === 0) throw new __velarRandomNativeRangeError("Random.pick requires a non-empty List");
    return values[this.int(values.length)];
  },
  shuffle(values) {
    if (!__velarRandomCall(__velarRandomArrayIsArray, __velarRandomNativeArray, [values])) throw new __velarRandomNativeTypeError("Random.shuffle requires a List");
    const output = new __velarRandomNativeArray(values.length);
    for (let index = 0; index < values.length; index += 1) output[index] = values[index];
    for (let index = output.length - 1; index > 0; index -= 1) { const other = this.int(index + 1); const value = output[index]; output[index] = output[other]; output[other] = value; }
    return output;
  },
  fork(label) {
    if (typeof label !== "string") throw new __velarRandomNativeTypeError("Random.fork label must be a string");
    const key = __velarRandomState(this).key;
    return __velarRandomMake(__velarRandomHash("f:" + key[0] + ":" + key[1] + ":" + key[2] + ":" + key[3] + ":" + label));
  },
};
__velarRandomFreeze(__velarRandomPrototype);
function __velarRandomMake(key) {
  const value = __velarRandomCreate(__velarRandomPrototype);
  __velarRandomCall(__velarRandomWeakMapSet, __velarRandomStates, [value, { key: [key[0], key[1], key[2], key[3]], state: [key[0], key[1], key[2], key[3]] }]);
  return __velarRandomFreeze(value);
}
export const Random = __velarRegisterRuntimeType(__velarRandomFreeze({
  is(value) { return (typeof value === "object" || typeof value === "function") && value !== null && __velarRandomCall(__velarRandomWeakMapHas, __velarRandomStates, [value]); },
  parse(value) { if (!Random.is(value)) throw new __velarRandomNativeTypeError("Value does not match Random"); return value; },
}));
export function random(seed) { return __velarRandomMake(__velarRandomSeed(seed)); }
`.trimStart()],
  ["velar/task", String.raw`
${VELAR_TYPE_REGISTRY_RUNTIME}
const __velarTaskNativeObject = globalThis.Object;
const __velarTaskNativeArray = globalThis.Array;
const __velarTaskNativeNumber = globalThis.Number;
const __velarTaskNativePromise = globalThis.Promise;
const __velarTaskNativeWeakMap = globalThis.WeakMap;
const __velarTaskNativeSet = globalThis.Set;
const __velarTaskNativeError = globalThis.Error;
const __velarTaskNativeTypeError = globalThis.TypeError;
const __velarTaskNativeRangeError = globalThis.RangeError;
const __velarTaskGlobal = globalThis;
const __velarTaskSetTimeout = globalThis.setTimeout;
const __velarTaskClearTimeout = globalThis.clearTimeout;
const __velarTaskGetOwnPropertyDescriptor = __velarTaskNativeObject.getOwnPropertyDescriptor;
const __velarTaskFreeze = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeObject, "freeze")?.value;
const __velarTaskCreate = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeObject, "create")?.value;
const __velarTaskDefineProperties = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeObject, "defineProperties")?.value;
const __velarTaskApply = __velarTaskGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarTaskNumberIsFinite = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeNumber, "isFinite")?.value;
const __velarTaskNumberIsSafeInteger = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeNumber, "isSafeInteger")?.value;
const __velarTaskArrayPrototype = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeArray, "prototype")?.value;
const __velarTaskArrayPush = __velarTaskGetOwnPropertyDescriptor(__velarTaskArrayPrototype, "push")?.value;
const __velarTaskArrayShift = __velarTaskGetOwnPropertyDescriptor(__velarTaskArrayPrototype, "shift")?.value;
const __velarTaskArraySplice = __velarTaskGetOwnPropertyDescriptor(__velarTaskArrayPrototype, "splice")?.value;
const __velarTaskArrayIndexOf = __velarTaskGetOwnPropertyDescriptor(__velarTaskArrayPrototype, "indexOf")?.value;
const __velarTaskPromiseThen = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativePromise.prototype, "then")?.value;
const __velarTaskWeakMapPrototype = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeWeakMap, "prototype")?.value;
const __velarTaskWeakMapGet = __velarTaskGetOwnPropertyDescriptor(__velarTaskWeakMapPrototype, "get")?.value;
const __velarTaskWeakMapHas = __velarTaskGetOwnPropertyDescriptor(__velarTaskWeakMapPrototype, "has")?.value;
const __velarTaskWeakMapSet = __velarTaskGetOwnPropertyDescriptor(__velarTaskWeakMapPrototype, "set")?.value;
const __velarTaskSetPrototype = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeSet, "prototype")?.value;
const __velarTaskSetAdd = __velarTaskGetOwnPropertyDescriptor(__velarTaskSetPrototype, "add")?.value;
const __velarTaskSetDelete = __velarTaskGetOwnPropertyDescriptor(__velarTaskSetPrototype, "delete")?.value;
const __velarTaskSetValues = __velarTaskGetOwnPropertyDescriptor(__velarTaskSetPrototype, "values")?.value;
const __velarTaskSetIterator = __velarTaskApply(__velarTaskSetValues, new __velarTaskNativeSet(), []);
const __velarTaskSetIteratorNext = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeObject.getPrototypeOf(__velarTaskSetIterator), "next")?.value;
const __velarTaskRegExpExec = __velarTaskGetOwnPropertyDescriptor(globalThis.RegExp.prototype, "exec")?.value;
const __velarTaskDurationPattern = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/;
if (typeof __velarTaskFreeze !== "function" || typeof __velarTaskCreate !== "function" || typeof __velarTaskDefineProperties !== "function"
  || typeof __velarTaskApply !== "function" || typeof __velarTaskPromiseThen !== "function" || typeof __velarTaskSetTimeout !== "function"
  || typeof __velarTaskClearTimeout !== "function" || typeof __velarTaskWeakMapGet !== "function" || typeof __velarTaskWeakMapHas !== "function"
  || typeof __velarTaskWeakMapSet !== "function" || typeof __velarTaskSetAdd !== "function" || typeof __velarTaskSetDelete !== "function"
  || typeof __velarTaskSetValues !== "function" || typeof __velarTaskSetIteratorNext !== "function" || typeof __velarTaskRegExpExec !== "function"
  || typeof __velarTaskNumberIsSafeInteger !== "function" || typeof __velarTaskArrayPush !== "function" || typeof __velarTaskArrayShift !== "function"
  || typeof __velarTaskArraySplice !== "function" || typeof __velarTaskArrayIndexOf !== "function") {
  throw new __velarTaskNativeTypeError("The structured task runtime is unavailable");
}
function __velarTaskCall(operation, receiver, arguments_) { return __velarTaskApply(operation, receiver, arguments_); }
export class CancellationError extends __velarTaskNativeError {
  constructor(message = "Task cancelled") { super(message); this.name = "CancellationError"; }
}
export class TaskTimeoutError extends __velarTaskNativeError {
  constructor(message = "Task timed out") { super(message); this.name = "TaskTimeoutError"; }
}
export class ChannelClosedError extends __velarTaskNativeError {
  constructor(message = "Channel is closed") { super(message); this.name = "ChannelClosedError"; }
}
export class ChannelBackpressureError extends __velarTaskNativeError {
  constructor(message = "Channel backpressure limit reached") { super(message); this.name = "ChannelBackpressureError"; }
}
const __velarCancellationStates = new __velarTaskNativeWeakMap();
const __velarTaskStates = new __velarTaskNativeWeakMap();
const __velarChannelStates = new __velarTaskNativeWeakMap();
function __velarCancellationState(value) {
  const state = __velarTaskCall(__velarTaskWeakMapGet, __velarCancellationStates, [value]);
  if (state === undefined) throw new __velarTaskNativeTypeError("Cancellation method requires a Cancellation receiver");
  return state;
}
function __velarOwnedTaskState(value) {
  const state = __velarTaskCall(__velarTaskWeakMapGet, __velarTaskStates, [value]);
  if (state === undefined) throw new __velarTaskNativeTypeError("Task method requires a Task receiver");
  return state;
}
function __velarCancelToken(token, reason) {
  const state = __velarCancellationState(token);
  if (state.cancelled) return;
  state.cancelled = true;
  state.reason = reason;
  const iterator = __velarTaskCall(__velarTaskSetValues, state.children, []);
  while (true) {
    const next = __velarTaskCall(__velarTaskSetIteratorNext, iterator, []);
    if (next.done) break;
    __velarCancelToken(next.value, reason);
  }
  const listeners = __velarTaskCall(__velarTaskSetValues, state.listeners, []);
  while (true) { const next = __velarTaskCall(__velarTaskSetIteratorNext, listeners, []); if (next.done) break; next.value(reason); }
}
const __velarCancellationPrototype = {};
__velarTaskDefineProperties(__velarCancellationPrototype, {
  cancelled: { enumerable: true, get() { return __velarCancellationState(this).cancelled; } },
  reason: { enumerable: true, get() { return __velarCancellationState(this).reason; } },
  checkpoint: { enumerable: true, value() {
    const receiver = this;
    __velarCancellationState(receiver);
    return new __velarTaskNativePromise((resolve, reject) => {
      __velarTaskCall(__velarTaskSetTimeout, __velarTaskGlobal, [() => {
        const state = __velarCancellationState(receiver);
        if (state.cancelled) reject(new CancellationError(state.reason ?? "Task cancelled"));
        else resolve(null);
      }, 0]);
    });
  } },
});
__velarTaskFreeze(__velarCancellationPrototype);
function __velarMakeCancellation(parent) {
  if (parent !== null && !Cancellation.is(parent)) throw new __velarTaskNativeTypeError("task parent must be a Cancellation value or null");
  const value = __velarTaskCreate(__velarCancellationPrototype);
  const state = { cancelled: false, reason: null, parent, children: new __velarTaskNativeSet(), listeners: new __velarTaskNativeSet() };
  __velarTaskCall(__velarTaskWeakMapSet, __velarCancellationStates, [value, state]);
  if (parent !== null) {
    const parentState = __velarCancellationState(parent);
    __velarTaskCall(__velarTaskSetAdd, parentState.children, [value]);
    if (parentState.cancelled) __velarCancelToken(value, parentState.reason);
  }
  return __velarTaskFreeze(value);
}
function __velarDetachCancellation(token) {
  const state = __velarCancellationState(token);
  if (state.parent !== null) __velarTaskCall(__velarTaskSetDelete, __velarCancellationState(state.parent).children, [token]);
}
function __velarCreateCancellation(parent = null) { return __velarMakeCancellation(parent); }
function __velarCancelCancellation(token, reason = "Task cancelled") {
  if (typeof reason !== "string") throw new __velarTaskNativeTypeError("Cancellation reason must be a string");
  __velarCancelToken(token, reason);
  return null;
}
function __velarOnCancellation(token, callback) {
  const state = __velarCancellationState(token);
  if (typeof callback !== "function") throw new __velarTaskNativeTypeError("Cancellation listener must be a function");
  if (state.cancelled) { callback(state.reason); return () => null; }
  __velarTaskCall(__velarTaskSetAdd, state.listeners, [callback]);
  return () => { __velarTaskCall(__velarTaskSetDelete, state.listeners, [callback]); return null; };
}
function __velarSettleCancellation(token, callback, value) { __velarDetachCancellation(token); return callback(value); }
function __velarAwaitStop(state) {
  return new __velarTaskNativePromise((resolve, reject) => {
    __velarTaskCall(__velarTaskPromiseThen, state.promise, [() => resolve(null), failure => failure instanceof CancellationError ? resolve(null) : reject(failure)]);
  });
}
const __velarTaskPrototype = {
  result() { return __velarOwnedTaskState(this).promise; },
  cancel(reason = "Task cancelled") {
    if (typeof reason !== "string") throw new __velarTaskNativeTypeError("Task.cancel reason must be a string");
    const state = __velarOwnedTaskState(this); __velarCancelToken(state.cancellation, reason); return __velarAwaitStop(state);
  },
  close() { const state = __velarOwnedTaskState(this); __velarCancelToken(state.cancellation, "Task scope ended"); return __velarAwaitStop(state); },
};
__velarTaskFreeze(__velarTaskPrototype);
function __velarMakeTask(work, parent) {
  if (typeof work !== "function") throw new __velarTaskNativeTypeError("task requires an async function");
  const cancellation = __velarMakeCancellation(parent);
  const value = __velarTaskCreate(__velarTaskPrototype);
  let startResolve;
  const start = new __velarTaskNativePromise(resolve => { startResolve = resolve; });
  const state = { cancellation, promise: null };
  __velarTaskCall(__velarTaskWeakMapSet, __velarTaskStates, [value, state]);
  state.promise = __velarTaskCall(__velarTaskPromiseThen, start, [() => work(cancellation)]);
  state.promise = __velarTaskCall(__velarTaskPromiseThen, state.promise, [
    result => __velarSettleCancellation(cancellation, value => value, result === undefined ? null : result),
    failure => __velarSettleCancellation(cancellation, value => { throw value; }, failure),
  ]);
  startResolve(null);
  return __velarTaskFreeze(value);
}
function __velarChannelState(value) {
  const state = __velarTaskCall(__velarTaskWeakMapGet, __velarChannelStates, [value]);
  if (state === undefined) throw new __velarTaskNativeTypeError("Channel method requires a Channel receiver");
  return state;
}
function __velarChannelResolved(value) { return new __velarTaskNativePromise(resolve => resolve(value)); }
function __velarChannelRejected(error) { return new __velarTaskNativePromise((_, reject) => reject(error)); }
function __velarChannelRemove(values, value) {
  const index = __velarTaskCall(__velarTaskArrayIndexOf, values, [value]);
  if (index >= 0) __velarTaskCall(__velarTaskArraySplice, values, [index, 1]);
}
function __velarChannelCancellation(value, operation) {
  if (value === null) return null;
  if (!Cancellation.is(value)) throw new __velarTaskNativeTypeError(operation + " cancellation must be a Cancellation value or null");
  return value;
}
function __velarChannelFinishWaiter(waiter) {
  if (!waiter.active) return false;
  waiter.active = false;
  if (waiter.unsubscribe !== null) waiter.unsubscribe();
  return true;
}
function __velarChannelDeliver(receiver, value) {
  if (!__velarChannelFinishWaiter(receiver)) return false;
  receiver.resolve(value);
  return true;
}
function __velarChannelPromoteSender(state) {
  while (state.senders.length > 0) {
    const sender = __velarTaskCall(__velarTaskArrayShift, state.senders, []);
    if (!__velarChannelFinishWaiter(sender)) continue;
    __velarTaskCall(__velarTaskArrayPush, state.values, [sender.value]);
    sender.resolve(null);
    return;
  }
}
const __velarChannelPrototype = {};
__velarTaskDefineProperties(__velarChannelPrototype, {
  capacity: { enumerable: true, get() { return __velarChannelState(this).capacity; } },
  size: { enumerable: true, get() { return __velarChannelState(this).values.length; } },
  closed: { enumerable: true, get() { return __velarChannelState(this).closed; } },
  send: { enumerable: true, value(value, cancellation = null) {
    const state = __velarChannelState(this);
    cancellation = __velarChannelCancellation(cancellation, "Channel.send");
    if (state.closed) return __velarChannelRejected(new ChannelClosedError());
    try { value = state.Type.parse(value); }
    catch (error) { return __velarChannelRejected(error); }
    if (state.receiver !== null) {
      const receiver = state.receiver;
      state.receiver = null;
      __velarChannelDeliver(receiver, value);
      return __velarChannelResolved(null);
    }
    if (state.values.length < state.capacity) {
      __velarTaskCall(__velarTaskArrayPush, state.values, [value]);
      return __velarChannelResolved(null);
    }
    if (state.senders.length >= state.capacity) {
      return __velarChannelRejected(new ChannelBackpressureError("Channel has too many waiting senders"));
    }
    return new __velarTaskNativePromise((resolve, reject) => {
      const waiter = {value, resolve, reject, active: true, unsubscribe: null};
      __velarTaskCall(__velarTaskArrayPush, state.senders, [waiter]);
      if (cancellation !== null) waiter.unsubscribe = __velarOnCancellation(cancellation, reason => {
        if (!__velarChannelFinishWaiter(waiter)) return;
        __velarChannelRemove(state.senders, waiter);
        reject(new CancellationError(reason ?? "Channel send cancelled"));
      });
    });
  } },
  trySend: { enumerable: true, value(value) {
    const state = __velarChannelState(this);
    if (state.closed) throw new ChannelClosedError();
    value = state.Type.parse(value);
    if (state.receiver !== null) {
      const receiver = state.receiver;
      state.receiver = null;
      __velarChannelDeliver(receiver, value);
      return true;
    }
    if (state.values.length >= state.capacity) return false;
    __velarTaskCall(__velarTaskArrayPush, state.values, [value]);
    return true;
  } },
  next: { enumerable: true, value(cancellation = null) {
    const state = __velarChannelState(this);
    cancellation = __velarChannelCancellation(cancellation, "Channel.next");
    if (state.values.length > 0) {
      const value = __velarTaskCall(__velarTaskArrayShift, state.values, []);
      __velarChannelPromoteSender(state);
      return __velarChannelResolved(value);
    }
    if (state.closed) return __velarChannelResolved(null);
    if (state.receiver !== null) return __velarChannelRejected(new ChannelBackpressureError("Only one Channel.next call may wait at a time"));
    return new __velarTaskNativePromise((resolve, reject) => {
      const waiter = {resolve, reject, active: true, unsubscribe: null};
      state.receiver = waiter;
      if (cancellation !== null) waiter.unsubscribe = __velarOnCancellation(cancellation, reason => {
        if (!__velarChannelFinishWaiter(waiter)) return;
        if (state.receiver === waiter) state.receiver = null;
        reject(new CancellationError(reason ?? "Channel receive cancelled"));
      });
    });
  } },
  close: { enumerable: true, value() {
    const state = __velarChannelState(this);
    if (state.closed) return null;
    state.closed = true;
    while (state.senders.length > 0) {
      const sender = __velarTaskCall(__velarTaskArrayShift, state.senders, []);
      if (!__velarChannelFinishWaiter(sender)) continue;
      sender.reject(new ChannelClosedError());
    }
    if (state.values.length === 0 && state.receiver !== null) {
      const receiver = state.receiver;
      state.receiver = null;
      __velarChannelDeliver(receiver, null);
    }
    return null;
  } },
});
__velarTaskFreeze(__velarChannelPrototype);
function __velarMakeChannel(Type, capacity) {
  Type = __velarRequireRuntimeType(Type, "channel");
  if (!__velarTaskCall(__velarTaskNumberIsSafeInteger, __velarTaskNativeNumber, [capacity]) || capacity < 1 || capacity > 65536) {
    throw new __velarTaskNativeRangeError("channel capacity must be an integer from 1 through 65536");
  }
  const value = __velarTaskCreate(__velarChannelPrototype);
  __velarTaskCall(__velarTaskWeakMapSet, __velarChannelStates, [value, {Type, capacity, values: [], senders: [], receiver: null, closed: false}]);
  return __velarTaskFreeze(value);
}
function __velarTaskDuration(value) {
  if (typeof value !== "string") throw new __velarTaskNativeTypeError("withTimeout requires Duration; write a value such as 200ms or 2s");
  const match = __velarTaskCall(__velarTaskRegExpExec, __velarTaskDurationPattern, [value]);
  if (!match) throw new __velarTaskNativeTypeError("withTimeout requires Duration; write a value such as 200ms or 2s");
  const milliseconds = __velarTaskNativeNumber(match[1]) * (match[2] === "s" ? 1000 : 1);
  if (!__velarTaskCall(__velarTaskNumberIsFinite, __velarTaskNativeNumber, [milliseconds]) || milliseconds < 0 || milliseconds > 2147483647) throw new __velarTaskNativeRangeError("withTimeout duration must be from 0ms through 2147483647ms");
  return milliseconds;
}
export const Cancellation = __velarRegisterRuntimeType(__velarTaskFreeze({
  is(value) { return value !== null && (typeof value === "object" || typeof value === "function") && __velarTaskCall(__velarTaskWeakMapHas, __velarCancellationStates, [value]); },
  parse(value) { if (!Cancellation.is(value)) throw new __velarTaskNativeTypeError("Value does not match Cancellation"); return value; },
  __velarCreate(parent = null) { return __velarCreateCancellation(parent); },
  __velarCancel(token, reason = "Task cancelled") { return __velarCancelCancellation(token, reason); },
  __velarOn(token, callback) { return __velarOnCancellation(token, callback); },
}));
const __velarTaskType = __velarTaskFreeze({
  is(value) { return value !== null && (typeof value === "object" || typeof value === "function") && __velarTaskCall(__velarTaskWeakMapHas, __velarTaskStates, [value]); },
  parse(value) { if (!__velarTaskType.is(value)) throw new __velarTaskNativeTypeError("Value does not match Task"); return value; },
});
export const Task = __velarRegisterRuntimeType(__velarTaskFreeze({ ...__velarTaskType, of() { return __velarTaskType; } }));
const __velarChannelType = __velarTaskFreeze({
  is(value) { return value !== null && (typeof value === "object" || typeof value === "function") && __velarTaskCall(__velarTaskWeakMapHas, __velarChannelStates, [value]); },
  parse(value) { if (!__velarChannelType.is(value)) throw new __velarTaskNativeTypeError("Value does not match Channel"); return value; },
});
export const Channel = __velarRegisterRuntimeType(__velarTaskFreeze({ ...__velarChannelType, of() { return __velarChannelType; } }));
export function task(work, parent = null) { return __velarMakeTask(work, parent); }
export function channel(Type, capacity = 64) { return __velarMakeChannel(Type, capacity); }
export function withTimeout(source, duration) {
  const state = __velarOwnedTaskState(source);
  const milliseconds = __velarTaskDuration(duration);
  return new __velarTaskNativePromise((resolve, reject) => {
    let settled = false;
    const timer = __velarTaskCall(__velarTaskSetTimeout, __velarTaskGlobal, [() => {
      if (settled) return;
      settled = true;
      __velarCancelToken(state.cancellation, "Task timed out");
      __velarTaskCall(__velarTaskPromiseThen, state.promise, [
        () => reject(new TaskTimeoutError("Task timed out after " + duration)),
        () => reject(new TaskTimeoutError("Task timed out after " + duration)),
      ]);
    }, milliseconds]);
    __velarTaskCall(__velarTaskPromiseThen, state.promise, [
      value => { if (!settled) { settled = true; __velarTaskCall(__velarTaskClearTimeout, __velarTaskGlobal, [timer]); resolve(value); } },
      failure => { if (!settled) { settled = true; __velarTaskCall(__velarTaskClearTimeout, __velarTaskGlobal, [timer]); reject(failure); } },
    ]);
  });
}
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
// D51 rule 103: the same list the \`try\` expression refuses to swallow. A
// combinator that turns a failure into a value — or retries past it — must not
// hide the language saying "this program has a bug".
function __velarAsyncIsIntegrityFailure(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  const descriptor = __velarAsyncGetOwnPropertyDescriptor(value, "name");
  if (!descriptor || !("value" in descriptor)) return false;
  const name = descriptor.value;
  return name === "AssertionError" || name === "NarrowingError" || name === "IndexError";
}
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
function reportAsyncLoser(failure) { try { const runtime = globalThis[__velarAsyncDetachedRegistryKey]; if (runtime && typeof runtime.report === "function") { runtime.report(failure, { phase: "detached", detail: "async combinator loser", unhandled: true }); return null; } if (typeof __velarAsyncConsoleError === "function") __velarAsyncApply(__velarAsyncConsoleError, __velarAsyncConsole, ["Detached task failed: " + (failure && failure.stack ? failure.stack : String(failure))]); } catch {} return null; }
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
export async function retry(task, attempts = 3, delay = "0ms") { if (typeof task !== "function") throw new __velarAsyncTypeError("retry requires a function"); if (!__velarAsyncNumberIsSafeInteger(attempts) || attempts < 1 || attempts > 10000) throw new __velarAsyncRangeError("retry attempts must be an integer from 1 through 10000"); durationMilliseconds(delay, "retry delay"); let last; for (let attempt = 0; attempt < attempts; attempt += 1) { try { const candidate = normalize(__velarAsyncApply(task, undefined, [])); const pending = optionalActualPromise(candidate); return pending ? await pending : requireSafePromiseResult(candidate, "async.retry"); } catch (error) { if (__velarAsyncIsIntegrityFailure(error)) throw error; last = error; if (attempt + 1 < attempts && delay !== "0ms") await sleep(delay); } } throw last; }
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
const localDayWindowMilliseconds = 108_000_000;
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
const __velarTimeRegExpPattern = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([Zz]|[+-]\d{2}(?::?\d{2})?))?$/u;
const __velarTimeDigitsPattern = /^\d{1,6}$/u;
const __velarTimeRegExpPrototype = __velarTimeGetPrototypeOf(__velarTimeRegExpPattern);
const __velarTimeDateNow = __velarTimeHostOperation(__velarTimeNativeDate, "now");
const __velarTimeMathAbs = __velarTimeHostOperation(__velarTimeNativeMath, "abs");
const __velarTimeMathFloor = __velarTimeHostOperation(__velarTimeNativeMath, "floor");
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
const __velarTimeSetTime = __velarTimeHostOperation(__velarTimeDatePrototype, "setTime");
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
function timeStyleName(value, name) {
  value = timeText(value, name);
  if (value !== "full" && value !== "long" && value !== "medium" && value !== "short" && value !== "none") {
    throw new __velarTimeNativeTypeError(name + " must be one of full, long, medium, short, or none");
  }
  return value;
}
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
function localDayOrder(value, year, month, day) {
  const currentYear = __velarTimeCall(__velarTimeGetFullYear, value, []);
  if (currentYear !== year) return currentYear < year ? -1 : 1;
  const currentMonth = __velarTimeCall(__velarTimeGetMonth, value, []) + 1;
  if (currentMonth !== month) return currentMonth < month ? -1 : 1;
  const currentDay = __velarTimeCall(__velarTimeGetDate, value, []);
  return currentDay === day ? 0 : currentDay < day ? -1 : 1;
}
function build(utc, year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0, resolveGap = false) {
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
    // A local wall clock that a daylight-saving fall-back repeats names two real
    // instants and round-trips for both, so this resolves to the earlier,
    // pre-transition one, which is the ECMAScript LocalTZA default.
    __velarTimeCall(__velarTimeSetFullYear, value, [year, month - 1, day]);
    __velarTimeCall(__velarTimeSetHours, value, [hour, minute, second, millisecond]);
    if (localDayOrder(value, year, month, day) !== 0
      || __velarTimeCall(__velarTimeGetHours, value, []) !== hour || __velarTimeCall(__velarTimeGetMinutes, value, []) !== minute || __velarTimeCall(__velarTimeGetSeconds, value, []) !== second || __velarTimeCall(__velarTimeGetMilliseconds, value, []) !== millisecond) {
      // A caller who supplied a wall clock still gets the rejection. A caller who
      // named a calendar day and nothing else did not, so where a transition skips
      // local midnight the day resolves forward to its first existing instant
      // rather than becoming unrepresentable. A gap opens at 00:15 or 00:45 as
      // readily as at 01:00, so the window around the requested day is searched
      // to the millisecond for the least instant that has reached the day.
      if (!resolveGap) throw new __velarTimeNativeRangeError("velar/time date parts do not form a real local date");
      const anchor = __velarTimeCall(__velarTimeGetTime, value, []);
      let low = anchor - localDayWindowMilliseconds, high = anchor + localDayWindowMilliseconds;
      while (low < high) {
        const middle = low + __velarTimeCall(__velarTimeMathFloor, __velarTimeNativeMath, [(high - low) / 2]);
        __velarTimeCall(__velarTimeSetTime, value, [middle]);
        if (localDayOrder(value, year, month, day) < 0) low = middle + 1; else high = middle;
      }
      __velarTimeCall(__velarTimeSetTime, value, [low]);
      // The search answers the first instant at or after the requested day, so a
      // day the zone skipped whole lands on the next one and is still rejected.
      if (localDayOrder(value, year, month, day) !== 0) throw new __velarTimeNativeRangeError("velar/time date parts do not form a real local date");
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
    const millisecond = __velarTimeNumber(__velarTimeCall(__velarTimeStringPadEnd, __velarTimeCall(__velarTimeStringSlice, match[7] ?? "", [0, 3]), [3, "0"]) || 0);
    const zone = match[8];
    let offset = 0;
    if (zone !== "Z" && zone !== "z") {
      // Three spellings name one offset: '+HH:MM', the basic-format '+HHMM' that
      // log lines and databases emit, and the hour-only '+HH'. The minutes sit
      // at the end whenever they are written at all.
      const sign = zone[0] === "+" ? 1 : -1;
      const offsetHour = __velarTimeNumber(__velarTimeCall(__velarTimeStringSlice, zone, [1, 3]));
      const offsetMinute = zone.length === 3 ? 0 : __velarTimeNumber(__velarTimeCall(__velarTimeStringSlice, zone, [zone.length - 2]));
      if (offsetHour > 23 || offsetMinute > 59) return null;
      offset = sign * (offsetHour * 60 + offsetMinute);
    }
    // RFC 3339 §5.7 writes an inserted leap second as ':60'. No JavaScript clock
    // counts it, so it names the second that follows it, which is the instant a
    // reader of the timestamp means. A leap second is only ever inserted at the
    // end of a UTC day, which is the local 23:59 in 'Z' and some other wall
    // clock under an offset, so the rule is checked on the UTC instant rather
    // than on the written hour. Elsewhere ':60' is a typo, not a timestamp, and
    // still answers null instead of being absorbed as a one-second shift.
    const leap = second === 60;
    const instant = build(true, year, month, day, hour, minute, leap ? 59 : second, millisecond) - offset * 60_000;
    if (leap) {
      const second59 = instant - millisecond;
      if (second59 - __velarTimeCall(__velarTimeMathFloor, __velarTimeNativeMath, [second59 / 86_400_000]) * 86_400_000 !== 86_399_000) return null;
    }
    return valid(instant + (leap ? 1000 : 0));
  } catch { return null; }
}
export function iso(value = now()) { const date = new __velarTimeNativeDate(valid(value)); return timeResultText(__velarTimeCall(__velarTimeToISOString, date, []), "Date.toISOString", 64); }
export function format(value, locale = "", timeZone = "", dateStyle = "medium", timeStyle = "medium") {
  locale = timeText(locale, "Time locale");
  timeZone = timeText(timeZone, "Time zone");
  dateStyle = timeStyleName(dateStyle, "Time date style");
  timeStyle = timeStyleName(timeStyle, "Time time style");
  if (dateStyle === "none" && timeStyle === "none") throw new __velarTimeNativeTypeError("velar/time format needs a date style or a time style; both cannot be none");
  const options = {
    ...dateStyle === "none" ? {} : { dateStyle },
    ...timeStyle === "none" ? {} : { timeStyle },
    ...timeZone ? { timeZone } : {},
  };
  const formatter = new __velarTimeDateTimeFormat(locale || undefined, options);
  const boundFormat = __velarTimeCall(__velarTimeFormatGetter, formatter, []);
  if (typeof boundFormat !== "function") throw new __velarTimeNativeTypeError("Intl.DateTimeFormat.format must be a function");
  const output = __velarTimeCall(boundFormat, undefined, [new __velarTimeNativeDate(valid(value))]);
  return timeResultText(output, "Intl.DateTimeFormat.format");
}
export function date(year, month, day, hour = null, minute = null, second = null) { return build(false, year, month, day, hour ?? 0, minute ?? 0, second ?? 0, 0, hour === null && minute === null && second === null); }
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
// D7: 'isUuid' answers the textual question its name and documentation ask —
// 36 characters, hyphenated 8-4-4-4-12, hexadecimal in either case. Constraining
// the version and variant nibbles rejected canonical text a caller cannot fix:
// the nil and max UUIDs of RFC 9562 and every GUID from a variant other than
// RFC 4122, which is what a .NET 'Guid.Empty' or an older partner system sends.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
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
  const debugRank = __velarLogRank("debug");
  const infoRank = __velarLogRank("info");
  const warnRank = __velarLogRank("warn");
  const errorRank = __velarLogRank("error");
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
  // A call below the active level returns before it builds anything: the
  // context is not merged, the message and fields are not validated, and no
  // bound is checked, so turning a level off is both free and side-effect-free.
  // 'threshold' is read per call, so 'setLevel' keeps reaching loggers that
  // already exist. The gate inside 'emit' stays as the belt to these braces.
  return __velarLogFreezeValue({
    debug(message, fields = null) { if (debugRank < __velarLogRank(threshold)) return null; return emit(scope, "debug", message, merged(fields)); },
    info(message, fields = null) { if (infoRank < __velarLogRank(threshold)) return null; return emit(scope, "info", message, merged(fields)); },
    warn(message, fields = null) { if (warnRank < __velarLogRank(threshold)) return null; return emit(scope, "warn", message, merged(fields)); },
    error(message, error = null, fields = null) { if (errorRank < __velarLogRank(threshold)) return null; return emit(scope, "error", message, merged(fields), error); },
  });
}

function __velarLogRecordField(value, name) {
  const descriptor = __velarLogGetOwnPropertyDescriptor(value, name);
  if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarLogNativeTypeError("Value does not match LogRecord");
  return descriptor.value;
}
function __velarLogRecordValue(value) {
  if (!value || typeof value !== "object" || __velarLogGetPrototypeOf(value) !== __velarLogObjectPrototype) {
    throw new __velarLogNativeTypeError("Value does not match LogRecord");
  }
  const timestamp = __velarLogRecordField(value, "timestamp");
  if (typeof timestamp !== "number"
    || !__velarLogApply(__velarLogNumberIsFinite, __velarLogNativeNumber, [timestamp], "Number.isFinite")
    || __velarLogApply(__velarLogMathAbs, __velarLogNativeMath, [timestamp], "Math.abs") > maximumLogTimestamp) {
    throw new __velarLogNativeTypeError("Value does not match LogRecord");
  }
  const level = __velarLogRecordField(value, "level");
  if (level !== "debug" && level !== "info" && level !== "warn" && level !== "error") {
    throw new __velarLogNativeTypeError("Value does not match LogRecord");
  }
  logText(__velarLogRecordField(value, "scope"), "LogRecord scope", 1024);
  logText(__velarLogRecordField(value, "message"), "LogRecord message");
  const error = __velarLogRecordField(value, "error");
  if (error !== null && !__velarIsError(error)) throw new __velarLogNativeTypeError("Value does not match LogRecord");
  const fields = __velarLogRecordField(value, "fields");
  if (fields == null) throw new __velarLogNativeTypeError("Value does not match LogRecord");
  fieldsOf(fields);
  return value;
}

// D59 rule 145.3 and D65 rule 171: the record 'useSink' hands to a sink now
// has a published name, so a sink can be a named 'def' with an annotated
// parameter. An exported type name is a runtime value in VelarScript — the
// emitter proves it for every 'export type' — so the name ships the same
// frozen 'is'/'parse' pair 'velar/fs' publishes for FileWatchBatch.
export const LogRecord = __velarLogFreezeValue({
  is(value) { try { __velarLogRecordValue(value); return true; } catch { return false; } },
  parse(value) { return __velarLogRecordValue(value); },
});

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
  ["velar/binary", [VELAR_COLLECTION_LOWERING_MODULE]],
  ["velar/hash", ["velar/binary"]],
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
  if (source === VELAR_WORKER_MANIFEST_MODULE) {
    const configured = projectConfig instanceof Map ? projectConfig.get(CORE_WORKER_CONFIG_KEY) : undefined;
    const entries = configured && typeof configured === "object" && !Array.isArray(configured)
      ? Object.fromEntries(Object.entries(configured as Record<string, unknown>)
        .filter(([name, path]) => /^[a-z][a-z0-9_-]{0,63}$/u.test(name) && typeof path === "string")
        .map(([name, path]) => [name, path]))
      : {};
    return `export const workerEntries = Object.freeze(${JSON.stringify(entries)});\n`;
  }
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
  return [...extensions];
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
