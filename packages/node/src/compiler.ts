import { optionalOf as optional, type ClassInfo, type CompilerExtension, type EnumInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { VELAR_STRICT_JSON_RUNTIME, VELAR_TYPE_REGISTRY_RUNTIME, VELAR_UTF8_RUNTIME } from "@velarscript/compiler/extension";
import { VELAR_NODE_ENV_RUNTIME } from "./environment-runtime.ts";
import { VELAR_NODE_FILESYSTEM_RUNTIME } from "./filesystem-runtime.ts";
import { VELAR_NODE_HTTP_RUNTIME } from "./http-runtime.ts";
import { VELAR_NODE_HOST_RUNTIME } from "./host-runtime.ts";
import { VELAR_NODE_HOST_RUNTIME as VELAR_SHARED_NODE_HOST_RUNTIME } from "./node-host-runtime.ts";
import { VELAR_NODE_HOST_WORKER_SOURCE } from "./node-host-worker-runtime.ts";
import { VELAR_PROCESS_HOST_RUNTIME } from "./process-runtime.ts";
import { VELAR_NODE_PROCESS_WORKER_SOURCE } from "./process-worker-runtime.ts";
import { VELAR_NODE_SERVE_RUNTIME } from "./serve-runtime.ts";
import { VELAR_NODE_TERMINAL_RUNTIME } from "./terminal-runtime.ts";
import { VELAR_NODE_TERMINAL_WORKER_SOURCE } from "./terminal-worker-runtime.ts";

export { VELAR_PROCESS_HOST_RUNTIME } from "./process-runtime.ts";

export const VELAR_NODE_API_VERSION = "0.10";
export const VELAR_NODE_HOST_MODULE = "velar/node-host-v1";

const anyType: ValueType = { kind: "any" };
const unknownType: ValueType = { kind: "unknown" };
const nullType: ValueType = { kind: "null" };
const stringType: ValueType = { kind: "string" };
const numberType: ValueType = { kind: "number" };
const boolType: ValueType = { kind: "bool" };
const listStringType: ValueType = { kind: "list", element: stringType };
const stringMapType: ValueType = { kind: "map", key: stringType, value: stringType };

function promise(value: ValueType): ValueType {
  return { kind: "promise", value };
}

function functionType(
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType {
  return { kind: "function", parameterNames, parameters, requiredParameters, result };
}

function namedIntrinsic(
  name: string,
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType {
  return { kind: "intrinsic", name, parameterNames, parameters, requiredParameters, result };
}

function object(fields: Readonly<Record<string, ValueType>>, optionalFields: readonly string[] = []): ValueType {
  return {
    kind: "object",
    fields: new Map(Object.entries(fields)),
    ...(optionalFields.length > 0 ? { optionalFields: new Set(optionalFields) } : {}),
  };
}

function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
  typeAliases: ReadonlyMap<string, ValueType> = new Map(),
  classes: ReadonlyMap<string, ClassInfo> = new Map(),
  enums: ReadonlyMap<string, EnumInfo> = new Map(),
): ModuleInterface {
  return {
    exports,
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes,
    namedTypeIdentities,
    typeAliases,
    enums,
    classes,
    testFunctions: [],
    extensionExports: new Map(),
    extensionData: new Map(),
  };
}

const serveRequestType: ValueType = { kind: "named", name: "ServeRequest", identity: "velar/serve#type:ServeRequest" };
const serverType: ValueType = { kind: "named", name: "Server", identity: "velar/serve#type:Server" };
const requestBodyTooLargeErrorIdentity = "velar/serve#class:RequestBodyTooLargeError";
const requestBodyTooLargeErrorClass: ClassInfo = {
  identity: requestBodyTooLargeErrorIdentity,
  parameters: [],
  requiredParameters: 0,
  base: "Error",
  abstract: true,
  fields: new Map([["maxBytes", { mutable: false, type: numberType }]]),
  getters: new Set(),
  abstractGetters: new Set(),
  methods: new Map(),
  abstractMethods: new Set(),
  staticFields: new Map(),
  staticGetters: new Set(),
  staticMethods: new Map(),
};
const blobIdentity = "velar/fs#class:Blob";
const blobType: ValueType = { kind: "class", name: "Blob", identity: blobIdentity };
const blobClass: ClassInfo = {
  identity: blobIdentity,
  parameters: [],
  requiredParameters: 0,
  base: null,
  abstract: true,
  fields: new Map(),
  getters: new Set(),
  abstractGetters: new Set(),
  methods: new Map(),
  abstractMethods: new Set(),
  staticFields: new Map(),
  staticGetters: new Set(),
  staticMethods: new Map(),
};
const writeChunkType = functionType(["chunk"], [stringType], promise(nullType));
const streamProducerType = functionType(["write"], [writeChunkType], promise(nullType));
const responseHeadersType = stringMapType;
const jsonResponseType = object({ status: numberType, json: anyType, headers: responseHeadersType }, ["headers"]);
const textResponseType = object({ status: numberType, text: stringType, contentType: stringType, headers: responseHeadersType }, ["contentType", "headers"]);
const streamResponseType = object({ status: numberType, stream: streamProducerType, headers: responseHeadersType }, ["headers"]);
const serveResponseAlias: ValueType = { kind: "union", members: [jsonResponseType, textResponseType, streamResponseType] };
const handlerType = functionType(["request"], [serveRequestType], promise(serveResponseAlias));
const fileInfoType = object({
  name: stringType,
  kind: stringType,
  size: numberType,
  modifiedAt: numberType,
});
const fileWatchBatchType = object({
  paths: listStringType,
  rescan: boolType,
});
const fileWatcherType: ValueType = { kind: "named", name: "FileWatcher", identity: "velar/fs#type:FileWatcher" };
const processResultType = object({
  code: optional(numberType),
  signal: optional(stringType),
  stdout: stringType,
  stderr: stringType,
});
const processOutputChannelIdentity = "velar/process#enum:ProcessOutputChannel";
const processOutputChannelMembers = new Set(["stdout", "stderr"]);
const processOutputChannelType: ValueType = { kind: "enum", name: "ProcessOutputChannel", identity: processOutputChannelIdentity };
const processOutputType = object({
  channel: processOutputChannelType,
  text: stringType,
});
const processOptionsType = object({
  cwd: optional(stringType),
  env: optional(stringMapType),
  stdin: optional(stringType),
  timeout: optional(numberType),
  maxOutputBytes: optional(numberType),
}, ["cwd", "env", "stdin", "timeout", "maxOutputBytes"]);
const processType: ValueType = { kind: "named", name: "Process", identity: "velar/process#type:Process" };
const httpChunkConsumerType = functionType(["chunk"], [stringType], promise(nullType));
const httpSecretHeaderType = object({
  name: stringType,
  environment: stringType,
  prefix: stringType,
});
const httpSecretHeadersType: ValueType = { kind: "list", element: httpSecretHeaderType };
const nodeHttpResponseType = object({
  ok: boolType,
  status: numberType,
  statusText: stringType,
  url: stringType,
  headers: stringMapType,
  json: functionType([], [], promise(unknownType)),
  text: functionType([], [], promise(stringType)),
  streamText: functionType(["consume"], [httpChunkConsumerType], promise(nullType)),
  parse: namedIntrinsic("runtime.parseAsync", ["target"], [anyType], promise(anyType)),
});
const nodeHttpRequestType = object({
  response: functionType([], [], promise(nodeHttpResponseType)),
  json: functionType([], [], promise(unknownType)),
  text: functionType([], [], promise(stringType)),
  streamText: functionType(["consume"], [httpChunkConsumerType], promise(nullType)),
  parse: namedIntrinsic("runtime.parseAsync", ["target"], [anyType], promise(anyType)),
  cancel: functionType([], [], nullType),
});
const nodeHttpOptionsType = object({
  headers: optional(stringMapType),
  secretHeaders: optional(httpSecretHeadersType),
  body: optional(unknownType),
  timeout: optional(numberType),
  maxBytes: optional(numberType),
}, ["headers", "secretHeaders", "body", "timeout", "maxBytes"]);
const terminalType = object({
  args: functionType([], [], listStringType),
  isInteractive: functionType([], [], boolType),
  readLine: functionType(["prompt"], [stringType], promise(optional(stringType)), 0),
  write: functionType(["text"], [stringType], promise(nullType)),
  writeError: functionType(["text"], [stringType], promise(nullType)),
  close: functionType([], [], nullType),
});
const nodeHttpType = object({
  request: functionType(["method", "url", "options"], [stringType, stringType, nodeHttpOptionsType], nodeHttpRequestType, 2),
  get: functionType(["url", "options"], [stringType, nodeHttpOptionsType], nodeHttpRequestType, 1),
  post: functionType(["url", "options"], [stringType, nodeHttpOptionsType], nodeHttpRequestType, 1),
  put: functionType(["url", "options"], [stringType, nodeHttpOptionsType], nodeHttpRequestType, 1),
  patch: functionType(["url", "options"], [stringType, nodeHttpOptionsType], nodeHttpRequestType, 1),
  delete: functionType(["url", "options"], [stringType, nodeHttpOptionsType], nodeHttpRequestType, 1),
  head: functionType(["url", "options"], [stringType, nodeHttpOptionsType], nodeHttpRequestType, 1),
});
const httpTransportPhaseIdentity = "velar/http#enum:HttpTransportPhase";
const httpTransportPhaseMembers = new Set(["request", "response"]);
const httpTransportPhaseType: ValueType = { kind: "enum", name: "HttpTransportPhase", identity: httpTransportPhaseIdentity };
const httpAbortErrorIdentity = "velar/http#class:HttpAbortError";
const httpErrorIdentity = "velar/http#class:HttpError";
const httpTransportErrorIdentity = "velar/http#class:HttpTransportError";
const httpAbortErrorClass: ClassInfo = {
  identity: httpAbortErrorIdentity,
  parameters: [stringType], parameterNames: ["reason"], requiredParameters: 1,
  base: "Error", abstract: false,
  fields: new Map([["reason", { mutable: false, type: stringType }]]),
  getters: new Set(), abstractGetters: new Set(), methods: new Map(), abstractMethods: new Set(),
  staticFields: new Map(), staticGetters: new Set(), staticMethods: new Map(),
};
const httpErrorClass: ClassInfo = {
  identity: httpErrorIdentity,
  parameters: [stringType, numberType, stringType, unknownType], parameterNames: ["message", "status", "url", "body"], requiredParameters: 3,
  base: "Error", abstract: false,
  fields: new Map([
    ["status", { mutable: false, type: numberType }],
    ["url", { mutable: false, type: stringType }],
    ["body", { mutable: false, type: unknownType }],
  ]),
  getters: new Set(), abstractGetters: new Set(), methods: new Map(), abstractMethods: new Set(),
  staticFields: new Map(), staticGetters: new Set(), staticMethods: new Map(),
};
const httpTransportErrorClass: ClassInfo = {
  identity: httpTransportErrorIdentity,
  parameters: [stringType, httpTransportPhaseType], parameterNames: ["message", "phase"], requiredParameters: 2,
  base: "Error", abstract: false,
  fields: new Map([["phase", { mutable: false, type: httpTransportPhaseType }]]),
  getters: new Set(), abstractGetters: new Set(), methods: new Map(), abstractMethods: new Set(),
  staticFields: new Map(), staticGetters: new Set(), staticMethods: new Map(),
};

export const nodeModuleInterfaces: ReadonlyMap<string, ModuleInterface> = new Map([
  ["velar/serve", moduleInterface(
    new Map([
      ["ServeRequest", { kind: "typeObject", name: "ServeRequest" }],
      ["ServeResponse", { kind: "typeObject", name: "ServeResponse" }],
      ["Server", { kind: "typeObject", name: "Server" }],
      ["RequestBodyTooLargeError", { kind: "classConstructor", name: "RequestBodyTooLargeError", identity: requestBodyTooLargeErrorIdentity }],
      ["serve", functionType(["handler", "port", "host"], [handlerType, numberType, stringType], promise(serverType), 2)],
      ["fileResponse", functionType(["root", "path", "fallback"], [stringType, stringType, optional(stringType)], serveResponseAlias, 2)],
    ]),
    new Map([
      ["ServeRequest", new Map([
        ["method", stringType],
        ["path", stringType],
        ["query", stringMapType],
        ["headers", stringMapType],
        ["text", functionType(["maxBytes"], [numberType], promise(stringType), 0)],
        ["json", functionType(["maxBytes"], [numberType], promise(unknownType), 0)],
        ["parse", namedIntrinsic("runtime.parseAsync", ["target", "maxBytes"], [anyType, numberType], promise(anyType), 1)],
      ])],
      ["Server", new Map([
        ["port", numberType],
        ["stop", functionType([], [], promise(nullType))],
      ])],
    ]),
    new Map([
      ["ServeRequest", "velar/serve#type:ServeRequest"],
      ["Server", "velar/serve#type:Server"],
    ]),
    new Map([["ServeResponse", serveResponseAlias]]),
    new Map([["RequestBodyTooLargeError", requestBodyTooLargeErrorClass]]),
  )],
  ["velar/fs", moduleInterface(
    new Map([
      ["Blob", { kind: "classConstructor", name: "Blob", identity: blobIdentity }],
      ["FileWatchBatch", { kind: "typeObject", name: "FileWatchBatch" }],
      ["FileWatcher", { kind: "typeObject", name: "FileWatcher" }],
      ["readText", functionType(["path", "maxBytes"], [stringType, numberType], promise(stringType), 1)],
      ["createText", functionType(["path", "text"], [stringType, stringType], promise(nullType))],
      ["replaceTextIfMatches", functionType(["path", "expected", "replacement"], [stringType, stringType, stringType], promise(boolType))],
      ["writeText", functionType(["path", "text"], [stringType, stringType], promise(nullType))],
      ["appendText", functionType(["path", "text"], [stringType, stringType], promise(nullType))],
      ["exists", functionType(["path"], [stringType], promise(boolType))],
      ["list", functionType(["path", "maxItems"], [stringType, numberType], promise(listStringType), 1)],
      ["info", functionType(["path"], [stringType], promise(optional(fileInfoType)))],
      ["canonical", functionType(["path"], [stringType], promise(stringType))],
      ["makeDirectory", functionType(["path"], [stringType], promise(nullType))],
      ["copyFile", functionType(["source", "target", "replace"], [stringType, stringType, boolType], promise(nullType), 2)],
      ["move", functionType(["source", "target", "replace"], [stringType, stringType, boolType], promise(nullType), 2)],
      ["removeFile", functionType(["path"], [stringType], promise(nullType))],
      ["readBlob", functionType(["path", "maxBytes"], [stringType, numberType], promise(blobType), 1)],
      ["watchFiles", functionType(["path", "recursive"], [stringType, boolType], promise(fileWatcherType), 1)],
    ]),
    new Map([
      ["FileWatcher", new Map([
        ["next", functionType([], [], promise(optional(fileWatchBatchType)))],
        ["close", functionType([], [], promise(nullType))],
      ])],
    ]),
    new Map([["FileWatcher", "velar/fs#type:FileWatcher"]]),
    new Map([["FileWatchBatch", fileWatchBatchType]]),
    new Map([["Blob", blobClass]]),
  )],
  ["velar/env", moduleInterface(new Map([
    ["get", functionType(["name"], [stringType], optional(stringType))],
    ["require", functionType(["name"], [stringType], stringType)],
  ]))],
  ["velar/host", moduleInterface(new Map([
    ["exit", functionType(["code"], [numberType], nullType, 0)],
    ["onShutdown", functionType(["cleanup"], [functionType([], [], promise(nullType))], nullType)],
  ]))],
  ["velar/terminal", moduleInterface(new Map([
    ["terminal", terminalType],
  ]))],
  ["velar/path", moduleInterface(new Map([
    ["resolve", functionType(["parts"], [listStringType], stringType, 0)],
    ["join", functionType(["parts"], [listStringType], stringType, 0)],
    ["normalize", functionType(["path"], [stringType], stringType)],
    ["relative", functionType(["from", "to"], [stringType, stringType], stringType)],
    ["dirname", functionType(["path"], [stringType], stringType)],
    ["basename", functionType(["path"], [stringType], stringType)],
    ["extension", functionType(["path"], [stringType], stringType)],
    ["isAbsolute", functionType(["path"], [stringType], boolType)],
    ["contains", functionType(["root", "target"], [stringType, stringType], boolType)],
  ]))],
  ["velar/process", moduleInterface(
    new Map([
      ["Process", { kind: "typeObject", name: "Process" }],
      ["ProcessOutputChannel", { kind: "enumObject", name: "ProcessOutputChannel", identity: processOutputChannelIdentity, members: processOutputChannelMembers }],
      ["start", functionType(["command", "args", "options"], [stringType, listStringType, processOptionsType], promise(processType), 1)],
      ["run", functionType(["command", "args", "options"], [stringType, listStringType, processOptionsType], promise(processResultType), 1)],
    ]),
    new Map([
      ["Process", new Map([
        ["pid", numberType],
        ["next", functionType([], [], promise(optional(processOutputType)))],
        ["wait", functionType([], [], promise(processResultType))],
        ["stop", functionType([], [], promise(nullType))],
      ])],
    ]),
    new Map([["Process", "velar/process#type:Process"]]),
    new Map(),
    new Map(),
    new Map([["ProcessOutputChannel", { identity: processOutputChannelIdentity, members: processOutputChannelMembers }]]),
  )],
  ["velar/http", moduleInterface(
    new Map([
      ["http", nodeHttpType],
      ["secretHeader", functionType(["name", "environment", "prefix"], [stringType, stringType, stringType], httpSecretHeaderType, 2)],
      ["HttpTransportPhase", { kind: "enumObject", name: "HttpTransportPhase", identity: httpTransportPhaseIdentity, members: httpTransportPhaseMembers }],
      ["HttpAbortError", { kind: "classConstructor", name: "HttpAbortError", identity: httpAbortErrorIdentity }],
      ["HttpError", { kind: "classConstructor", name: "HttpError", identity: httpErrorIdentity }],
      ["HttpTransportError", { kind: "classConstructor", name: "HttpTransportError", identity: httpTransportErrorIdentity }],
    ]),
    new Map(),
    new Map(),
    new Map(),
    new Map([
      ["HttpAbortError", httpAbortErrorClass],
      ["HttpError", httpErrorClass],
      ["HttpTransportError", httpTransportErrorClass],
    ]),
    new Map([["HttpTransportPhase", { identity: httpTransportPhaseIdentity, members: httpTransportPhaseMembers }]]),
  )],
]);

export const nodeModuleSources: ReadonlyMap<string, string> = new Map([
  [VELAR_NODE_HOST_MODULE, VELAR_SHARED_NODE_HOST_RUNTIME.replace("WORKER_SOURCE", JSON.stringify(VELAR_NODE_HOST_WORKER_SOURCE))],
  ["velar/fs", String.raw`
${VELAR_UTF8_RUNTIME}
${VELAR_NODE_FILESYSTEM_RUNTIME}
`.trimStart()],
  ["velar/path", String.raw`
import { basename as nodeBasename, dirname as nodeDirname, extname, isAbsolute as nodeIsAbsolute, join as nodeJoin, normalize as nodeNormalize, relative as nodeRelative, resolve as nodeResolve } from "node:path";

const maxPathCodeUnits = 4096;
const pathApply = Reflect.apply;
const pathArrayIsArray = Array.isArray;
const pathGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const pathStringIncludes = String.prototype.includes;
const pathStringStartsWith = String.prototype.startsWith;
const pathSeparator = process.platform === "win32" ? "\\" : "/";
function stringIncludes(value, search) { return pathApply(pathStringIncludes, value, [search]); }
function stringStartsWith(value, search) { return pathApply(pathStringStartsWith, value, [search]); }
function pathValue(value, operation) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(operation + " requires a non-empty path string");
  if (value.length > maxPathCodeUnits || stringIncludes(value, "\0")) throw new RangeError(operation + " path is outside the supported bounds");
  return value;
}
function pathParts(values, operation) {
  if (!pathArrayIsArray(values) || values.length > 256) throw new TypeError(operation + " requires a bounded List<string>");
  const output = [];
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = pathGetOwnPropertyDescriptor(values, index);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(operation + " path parts must contain enumerable data values");
    output[output.length] = pathValue(descriptor.value, operation);
  }
  return output;
}
function bounded(value, operation) {
  if (value.length > maxPathCodeUnits) throw new RangeError(operation + " result is outside the supported bounds");
  return value;
}

export function resolve(parts = []) { return bounded(pathApply(nodeResolve, undefined, pathParts(parts, "resolve")), "resolve"); }
export function join(parts = []) { return bounded(pathApply(nodeJoin, undefined, pathParts(parts, "join")), "join"); }
export function normalize(path) { return bounded(nodeNormalize(pathValue(path, "normalize")), "normalize"); }
export function relative(from, to) { return bounded(nodeRelative(pathValue(from, "relative"), pathValue(to, "relative")), "relative"); }
export function dirname(path) { return bounded(nodeDirname(pathValue(path, "dirname")), "dirname"); }
export function basename(path) { return nodeBasename(pathValue(path, "basename")); }
export function extension(path) { return extname(pathValue(path, "extension")); }
export function isAbsolute(path) { return nodeIsAbsolute(pathValue(path, "isAbsolute")); }
export function contains(root, target) {
  root = nodeResolve(pathValue(root, "contains"));
  target = nodeResolve(pathValue(target, "contains"));
  const path = nodeRelative(root, target);
  return path === "" || (path !== ".." && !stringStartsWith(path, ".." + pathSeparator) && !nodeIsAbsolute(path));
}
`.trimStart()],
  ["velar/process", String.raw`
import { EventEmitter } from "node:events";
import { MessageChannel, MessagePort, Worker } from "node:worker_threads";
${VELAR_TYPE_REGISTRY_RUNTIME}
${VELAR_UTF8_RUNTIME}
${VELAR_PROCESS_HOST_RUNTIME}

const maxTextBytes = 16 * 1024 * 1024;
const safeEnvironmentNames = ["HOME", "LANG", "LC_ALL", "PATH", "SHELL", "TERM", "TMPDIR", "USER", "SystemRoot", "WINDIR"];
const processOptionFields = new __velarProcessNativeSet(["cwd", "env", "stdin", "timeout", "maxOutputBytes"]);
const processStartFields = new __velarProcessNativeSet(["handle", "pid"]);
const processResultFields = new __velarProcessNativeSet(["code", "signal", "stdout", "stderr"]);
const processOutputFields = new __velarProcessNativeSet(["channel", "text"]);
const processStopFields = new __velarProcessNativeSet(["result", "error"]);
const processWaitFields = new __velarProcessNativeSet(["result", "error", "retained"]);
const processErrorFields = new __velarProcessNativeSet(["name", "message"]);
const processHostMessageFields = new __velarProcessNativeSet(["kind", "id", "ok", "value", "error", "handle", "pid"]);
const __velarNodeProcessToken = Symbol("velar.node.process");
const __velarNodeProcessNativeProcess = process;
const __velarNodeProcessEnvironment = __velarNodeProcessNativeProcess.env;
const __velarNodeProcessKill = __velarProcessDataOperation(__velarNodeProcessNativeProcess, "kill");
const __velarNodeProcessPlatform = __velarNodeProcessNativeProcess.platform;
export const ProcessOutputChannel = __velarRegisterRuntimeType(__velarProcessFreeze({
  stdout: "stdout",
  stderr: "stderr",
  is(value) { return value === "stdout" || value === "stderr"; },
  parse(value) {
    if (!ProcessOutputChannel.is(value)) throw new __velarProcessNativeTypeError("Value does not match ProcessOutputChannel");
    return value;
  },
}));

function boundedText(value, name, maxCodeUnits = 4096) {
  if (typeof value !== "string" || value.length === 0) throw new __velarProcessNativeTypeError(name + " must be non-empty text");
  if (value.length > maxCodeUnits || __velarProcessIncludes(value, "\0")) throw new __velarProcessNativeRangeError(name + " is outside the supported bounds");
  return value;
}
function argumentsOf(value) {
  if (value == null) return [];
  if (!__velarProcessIsArray(value) || value.length > 1000) throw new __velarProcessNativeTypeError("Process args must be a bounded List<string>");
  let units = 0;
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarProcessOwnDescriptor(value, __velarProcessNativeString(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarProcessNativeTypeError("Process args must contain enumerable data values");
    const item = descriptor.value;
    units += boundedText(item, "Process argument", 1024 * 1024).length;
    if (units > 1024 * 1024) throw new __velarProcessNativeRangeError("Process arguments cannot exceed 1 MiB");
    output[output.length] = item;
  }
  return output;
}
function plainRecord(value) {
  return __velarProcessRecord(value == null ? {} : value, "Process options", processOptionFields);
}
function environmentValue(name) {
  const descriptor = __velarProcessOwnDescriptor(__velarNodeProcessEnvironment, name);
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : null;
}
function environmentOf(value) {
  const output = __velarProcessCreate(null);
  for (const name of safeEnvironmentNames) {
    const item = environmentValue(name);
    if (item !== null) output[name] = item;
  }
  if (value == null) return output;
  const snapshot = __velarProcessMapSnapshot(value);
  if (snapshot.size > 1000) throw new __velarProcessNativeRangeError("Process env cannot exceed 1000 entries");
  let units = 0;
  for (let index = 0; index < snapshot.entries.length; index += 1) {
    const name = snapshot.entries[index][0];
    const item = snapshot.entries[index][1];
    if (!__velarProcessEnvironmentName(name) || typeof item !== "string" || __velarProcessIncludes(item, "\0")) throw new __velarProcessNativeTypeError("Process env must contain valid string variables");
    units += name.length + item.length;
    if (units > 1024 * 1024) throw new __velarProcessNativeRangeError("Process env cannot exceed 1 MiB");
    output[name] = item;
  }
  return output;
}
function optionsOf(value) {
  value = plainRecord(value);
  const cwd = value.cwd == null ? undefined : boundedText(value.cwd, "Process cwd");
  const stdin = value.stdin ?? "";
  if (typeof stdin !== "string" || __velarUtf8ByteLength(stdin) > maxTextBytes) throw new __velarProcessNativeRangeError("Process stdin cannot exceed 16 MiB");
  const timeout = value.timeout ?? 120000;
  if (!__velarProcessIsSafeInteger(timeout) || timeout < 0 || timeout > 600000) throw new __velarProcessNativeRangeError("Process timeout must be an integer from 0 through 600000 milliseconds");
  const maxOutputBytes = value.maxOutputBytes ?? 4 * 1024 * 1024;
  if (!__velarProcessIsSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > maxTextBytes) throw new __velarProcessNativeRangeError("Process maxOutputBytes must be an integer from 1 through 16777216");
  return { cwd, env: environmentOf(value.env), stdin, timeout, maxOutputBytes };
}

function processErrorOf(value) {
  value = __velarProcessRecord(value, "Node process host error", processErrorFields);
  if (typeof value.name !== "string" || value.name !== "Error" && value.name !== "RangeError" && value.name !== "TypeError"
    || typeof value.message !== "string" || value.message.length === 0 || value.message.length > 65536) {
    throw new __velarProcessNativeTypeError("Node process host returned an invalid error");
  }
  if (value.name === "RangeError") return new __velarProcessNativeRangeError(value.message);
  if (value.name === "TypeError") return new __velarProcessNativeTypeError(value.message);
  return new __velarProcessNativeError(value.message);
}
function startValueOf(value) {
  value = __velarProcessRecord(value, "Node process start result", processStartFields);
  if (!__velarProcessIsSafeInteger(value.handle) || value.handle < 1
    || !__velarProcessIsSafeInteger(value.pid) || value.pid < 0) {
    throw new __velarProcessNativeTypeError("Node process host returned an invalid start result");
  }
  return value;
}
function resultOf(value, maxOutputBytes) {
  value = __velarProcessRecord(value, "Node process result", processResultFields);
  if ((value.code !== null && !__velarProcessIsSafeInteger(value.code))
    || (value.signal !== null && (typeof value.signal !== "string" || value.signal.length === 0 || value.signal.length > 128))
    || typeof value.stdout !== "string" || typeof value.stderr !== "string") {
    throw new __velarProcessNativeTypeError("Node process host returned an invalid result");
  }
  if (__velarUtf8ByteLength(value.stdout) + __velarUtf8ByteLength(value.stderr) > maxOutputBytes) {
    throw new __velarProcessNativeRangeError("Node process result exceeded maxOutputBytes");
  }
  return __velarProcessFreeze({code: value.code, signal: value.signal, stdout: value.stdout, stderr: value.stderr});
}
function outputOf(value, maxOutputBytes) {
  if (value === null) return null;
  value = __velarProcessRecord(value, "Node process output", processOutputFields);
  if (!ProcessOutputChannel.is(value.channel) || typeof value.text !== "string" || value.text.length === 0) {
    throw new __velarProcessNativeTypeError("Node process host returned invalid output");
  }
  const bytes = __velarUtf8ByteLength(value.text);
  if (bytes > maxOutputBytes) throw new __velarProcessNativeRangeError("Node process output exceeded maxOutputBytes");
  return __velarProcessFreeze({channel: value.channel, text: value.text, bytes});
}
function stopValueOf(value, maxOutputBytes) {
  value = __velarProcessRecord(value, "Node process stop result", processStopFields);
  if (value.result !== null && value.error !== null) throw new __velarProcessNativeTypeError("Node process stop result is contradictory");
  return {
    result: value.result === null ? null : resultOf(value.result, maxOutputBytes),
    error: value.error === null ? null : processErrorOf(value.error),
  };
}
function waitValueOf(value, maxOutputBytes) {
  value = __velarProcessRecord(value, "Node process wait result", processWaitFields);
  if (typeof value.retained !== "boolean"
    || value.result !== null && value.error !== null
    || value.retained && (value.result !== null || value.error === null)
    || !value.retained && value.result === null && value.error === null) {
    throw new __velarProcessNativeTypeError("Node process wait result is invalid or contradictory");
  }
  return {
    result: value.result === null ? null : resultOf(value.result, maxOutputBytes),
    error: value.error === null ? null : processErrorOf(value.error),
    retained: value.retained,
  };
}

const __velarNodeProcessMessagePortPost = __velarProcessDataOperation(MessagePort.prototype, "postMessage");
const __velarNodeProcessMessagePortStart = __velarProcessDataOperation(MessagePort.prototype, "start");
const __velarNodeProcessMessagePortRef = __velarProcessDataOperation(MessagePort.prototype, "ref");
const __velarNodeProcessMessagePortUnref = __velarProcessDataOperation(MessagePort.prototype, "unref");
const __velarNodeProcessMessagePortClose = __velarProcessDataOperation(MessagePort.prototype, "close");
const __velarNodeProcessWorkerUnref = __velarProcessDataOperation(Worker.prototype, "unref");
const __velarNodeProcessEventOn = __velarProcessDataOperation(EventEmitter.prototype, "on");
const __velarNodeProcessMessageData = __velarProcessOwnDescriptor(globalThis.MessageEvent.prototype, "data")?.get;
if (typeof __velarNodeProcessMessageData !== "function") throw new __velarProcessNativeError("Node process MessageEvent data operation is unavailable");
const __velarNodeProcessPending = __velarProcessCreate(null);
const __velarNodeProcessOwners = __velarProcessCreate(null);
const __velarNodeProcessUnconfirmedOwners = __velarProcessCreate(null);
const __velarNodeProcessSettledOwners = __velarProcessCreate(null);
const __velarNodeProcessMaxPending = 1024;
let __velarNodeProcessNextRequest = 1;
let __velarNodeProcessPendingCount = 0;
let __velarNodeProcessRunningCount = 0;
let __velarNodeProcessReady = false;
let __velarNodeProcessFailure = null;
let __velarNodeProcessReaper = null;
let __velarNodeProcessReaperAttempts = 0;
let __velarNodeProcessReadyResolve;
let __velarNodeProcessReadyReject;
const __velarNodeProcessReadyPromise = new __velarProcessNativePromise((resolve, reject) => {
  __velarNodeProcessReadyResolve = resolve;
  __velarNodeProcessReadyReject = reject;
});
const __velarNodeProcessChannel = new MessageChannel();
const __velarNodeProcessPort = __velarNodeProcessChannel.port1;

function __velarNodeProcessUpdateReference() {
  const operation = __velarNodeProcessPendingCount > 0 || __velarNodeProcessRunningCount > 0
    ? __velarNodeProcessMessagePortRef
    : __velarNodeProcessMessagePortUnref;
  __velarProcessCall(operation, __velarNodeProcessPort, []);
}
function __velarNodeProcessSignal(pid, signal) {
  try {
    __velarProcessCall(__velarNodeProcessKill, __velarNodeProcessNativeProcess, [__velarNodeProcessPlatform === "win32" ? pid : -pid, signal]);
  } catch {
    try { __velarProcessCall(__velarNodeProcessKill, __velarNodeProcessNativeProcess, [pid, signal]); }
    catch {}
  }
}
function __velarNodeProcessOwnerAlive(pid) {
  try {
    __velarProcessCall(__velarNodeProcessKill, __velarNodeProcessNativeProcess, [__velarNodeProcessPlatform === "win32" ? pid : -pid, 0]);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" ? __velarProcessOwnDescriptor(error, "code") : null;
    return !code || !("value" in code) || code.value !== "ESRCH";
  }
}
function __velarNodeProcessReapOwners() {
  __velarNodeProcessReaper = null;
  __velarNodeProcessReaperAttempts += 1;
  const keys = __velarProcessKeys(__velarNodeProcessOwners);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const descriptor = __velarProcessOwnDescriptor(__velarNodeProcessOwners, key);
    if (!descriptor || !("value" in descriptor)) continue;
    const pid = descriptor.value;
    __velarNodeProcessSignal(pid, "SIGKILL");
    if (!__velarNodeProcessOwnerAlive(pid)) delete __velarNodeProcessOwners[key];
  }
  if (__velarProcessKeys(__velarNodeProcessOwners).length > 0 && __velarNodeProcessReaperAttempts < 100) {
    __velarNodeProcessReaper = __velarProcessCall(__velarProcessSetTimeout, globalThis, [__velarNodeProcessReapOwners, 50]);
  } else if (__velarNodeProcessReaperAttempts >= 100) {
    const abandonedKeys = __velarProcessKeys(__velarNodeProcessOwners);
    for (let index = 0; index < abandonedKeys.length; index += 1) delete __velarNodeProcessOwners[abandonedKeys[index]];
  }
}
function __velarNodeProcessBeginReaping() {
  if (__velarNodeProcessReaper === null && __velarProcessKeys(__velarNodeProcessOwners).length > 0) {
    __velarNodeProcessReaperAttempts = 0;
    __velarNodeProcessReapOwners();
  }
}
function __velarNodeProcessFail(error) {
  if (__velarNodeProcessFailure) return;
  const failure = error instanceof __velarProcessNativeError ? error : new __velarProcessNativeError("Node process worker failed");
  __velarNodeProcessFailure = failure;
  if (!__velarNodeProcessReady) __velarNodeProcessReadyReject(failure);
  const keys = __velarProcessKeys(__velarNodeProcessPending);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const descriptor = __velarProcessOwnDescriptor(__velarNodeProcessPending, key);
    if (descriptor && "value" in descriptor) descriptor.value.reject(failure);
    delete __velarNodeProcessPending[key];
  }
  __velarNodeProcessPendingCount = 0;
  __velarNodeProcessRunningCount = 0;
  const settledKeys = __velarProcessKeys(__velarNodeProcessSettledOwners);
  for (let index = 0; index < settledKeys.length; index += 1) delete __velarNodeProcessSettledOwners[settledKeys[index]];
  const unconfirmedKeys = __velarProcessKeys(__velarNodeProcessUnconfirmedOwners);
  for (let index = 0; index < unconfirmedKeys.length; index += 1) delete __velarNodeProcessUnconfirmedOwners[unconfirmedKeys[index]];
  __velarNodeProcessUpdateReference();
  __velarNodeProcessBeginReaping();
  __velarProcessCall(__velarNodeProcessMessagePortClose, __velarNodeProcessPort, []);
}
function __velarNodeProcessMessage(value) {
  const message = __velarProcessRecord(value, "Node process host message", processHostMessageFields);
  if (message.kind === "ready") {
    if (__velarNodeProcessReady) throw new __velarProcessNativeError("Node process worker sent duplicate readiness");
    __velarNodeProcessReady = true;
    __velarNodeProcessReadyResolve(null);
    return;
  }
  if (message.kind === "owned") {
    if (!__velarProcessIsSafeInteger(message.handle) || message.handle < 1
      || !__velarProcessIsSafeInteger(message.pid) || message.pid < 1
      || __velarProcessOwnDescriptor(__velarNodeProcessOwners, __velarProcessNativeString(message.handle))
      || __velarProcessOwnDescriptor(__velarNodeProcessSettledOwners, __velarProcessNativeString(message.handle))) {
      throw new __velarProcessNativeTypeError("Node process worker returned an invalid owned handle");
    }
    __velarNodeProcessOwners[message.handle] = message.pid;
    __velarNodeProcessUnconfirmedOwners[message.handle] = true;
    __velarNodeProcessRunningCount += 1;
    __velarNodeProcessUpdateReference();
    return;
  }
  if (message.kind === "settled") {
    const owner = __velarProcessIsSafeInteger(message.handle) && message.handle > 0
      ? __velarProcessOwnDescriptor(__velarNodeProcessOwners, __velarProcessNativeString(message.handle))
      : null;
    if (!owner || !("value" in owner) || __velarNodeProcessRunningCount < 1) {
      throw new __velarProcessNativeTypeError("Node process worker returned an invalid settled handle");
    }
    delete __velarNodeProcessOwners[message.handle];
    if (__velarProcessOwnDescriptor(__velarNodeProcessUnconfirmedOwners, __velarProcessNativeString(message.handle))) {
      __velarNodeProcessSettledOwners[message.handle] = owner.value;
    }
    __velarNodeProcessRunningCount -= 1;
    __velarNodeProcessUpdateReference();
    return;
  }
  if (message.kind !== "response" || !__velarProcessIsSafeInteger(message.id) || message.id < 1 || typeof message.ok !== "boolean") {
    throw new __velarProcessNativeTypeError("Node process worker returned an invalid response");
  }
  const descriptor = __velarProcessOwnDescriptor(__velarNodeProcessPending, __velarProcessNativeString(message.id));
  if (!descriptor || !("value" in descriptor)) throw new __velarProcessNativeError("Node process worker returned an unknown response");
  const pending = descriptor.value;
  let responseValue = message.value;
  let responseError = null;
  if (message.ok) {
    if (pending.operation === "start") {
      const started = startValueOf(message.value);
      const owner = __velarProcessOwnDescriptor(__velarNodeProcessOwners, __velarProcessNativeString(started.handle))
        ?? __velarProcessOwnDescriptor(__velarNodeProcessSettledOwners, __velarProcessNativeString(started.handle));
      if (!owner || !("value" in owner) || owner.value !== started.pid) {
        throw new __velarProcessNativeError("Node process worker resolved start without transferring cleanup ownership");
      }
      delete __velarNodeProcessUnconfirmedOwners[started.handle];
      delete __velarNodeProcessSettledOwners[started.handle];
      responseValue = started;
    }
  } else responseError = processErrorOf(message.error);
  delete __velarNodeProcessPending[message.id];
  __velarNodeProcessPendingCount -= 1;
  __velarNodeProcessUpdateReference();
  if (responseError) pending.reject(responseError);
  else pending.resolve(responseValue);
}

__velarNodeProcessPort.onmessage = event => {
  try {
    __velarNodeProcessMessage(__velarProcessCall(__velarNodeProcessMessageData, event, []));
  } catch (error) { __velarNodeProcessFail(error); }
};
__velarNodeProcessPort.onmessageerror = () => __velarNodeProcessFail(new __velarProcessNativeError("Node process worker returned an unreadable message"));
__velarProcessCall(__velarNodeProcessMessagePortStart, __velarNodeProcessPort, []);
const __velarNodeProcessWorker = new Worker(${JSON.stringify(VELAR_NODE_PROCESS_WORKER_SOURCE)}, {
  eval: true,
  workerData: __velarNodeProcessChannel.port2,
  transferList: [__velarNodeProcessChannel.port2],
});
__velarProcessCall(__velarNodeProcessEventOn, __velarNodeProcessWorker, ["error", () => __velarNodeProcessFail(new __velarProcessNativeError("Node process worker failed"))]);
__velarProcessCall(__velarNodeProcessEventOn, __velarNodeProcessWorker, ["exit", code => {
  __velarNodeProcessFail(new __velarProcessNativeError("Node process worker exited unexpectedly with code " + code));
}]);
const __velarNodeProcessReadyTimer = __velarProcessCall(__velarProcessSetTimeout, globalThis, [
  () => __velarNodeProcessReadyReject(new __velarProcessNativeError("Node process worker did not become ready")),
  10000,
]);

try { await __velarNodeProcessReadyPromise; }
finally { __velarProcessCall(__velarProcessClearTimeout, globalThis, [__velarNodeProcessReadyTimer]); }
__velarProcessCall(__velarNodeProcessWorkerUnref, __velarNodeProcessWorker, []);
__velarProcessCall(__velarNodeProcessMessagePortUnref, __velarNodeProcessPort, []);

function invoke(operation, args) {
  if (__velarNodeProcessFailure) return __velarProcessReject(__velarNodeProcessFailure);
  if (__velarNodeProcessPendingCount >= __velarNodeProcessMaxPending) {
    return __velarProcessReject(new __velarProcessNativeRangeError("Node process host cannot have more than 1024 pending operations"));
  }
  let attempts = 0;
  while (__velarProcessOwnDescriptor(__velarNodeProcessPending, __velarProcessNativeString(__velarNodeProcessNextRequest))) {
    __velarNodeProcessNextRequest = __velarNodeProcessNextRequest >= __velarProcessNativeNumber.MAX_SAFE_INTEGER ? 1 : __velarNodeProcessNextRequest + 1;
    attempts += 1;
    if (attempts > __velarNodeProcessMaxPending) return __velarProcessReject(new __velarProcessNativeRangeError("Node process request identity space is unavailable"));
  }
  const id = __velarNodeProcessNextRequest;
  __velarNodeProcessNextRequest = id >= __velarProcessNativeNumber.MAX_SAFE_INTEGER ? 1 : id + 1;
  return new __velarProcessNativePromise((resolve, reject) => {
    __velarNodeProcessPending[id] = {operation, resolve, reject};
    __velarNodeProcessPendingCount += 1;
    __velarNodeProcessUpdateReference();
    try {
      __velarProcessCall(__velarNodeProcessMessagePortPost, __velarNodeProcessPort, [{id, operation, args}]);
    } catch (error) {
      delete __velarNodeProcessPending[id];
      __velarNodeProcessPendingCount -= 1;
      __velarNodeProcessUpdateReference();
      reject(error);
    }
  });
}

class ProcessHandle {
  constructor(token, handle, pid, maxOutputBytes) {
    if (token !== __velarNodeProcessToken || !__velarProcessIsSafeInteger(handle) || handle < 1
      || !__velarProcessIsSafeInteger(pid) || pid < 0) {
      throw new __velarProcessNativeTypeError("Process values are created only by velar/process.start");
    }
    this.handle = handle;
    this.pid = pid;
    this.maxOutputBytes = maxOutputBytes;
    this.outputBytes = 0;
    this.outputReading = false;
    this.waitStarted = false;
    this.result = null;
    this.stopping = null;
    this.stopRequested = false;
    this.cleanup = null;
    this.next = async () => {
      if (this.waitStarted) throw new __velarProcessNativeError("Process output must be consumed before wait()");
      if (this.stopRequested) throw new __velarProcessNativeError("Process output is unavailable after stop()");
      if (this.outputReading) throw new __velarProcessNativeError("Process.next() allows only one active pull");
      this.outputReading = true;
      try {
        const output = outputOf(await invoke("read", [this.handle]), this.maxOutputBytes);
        if (output === null) return null;
        this.outputBytes += output.bytes;
        if (this.outputBytes > this.maxOutputBytes) throw new __velarProcessNativeRangeError("Process output exceeded maxOutputBytes");
        return __velarProcessFreeze({channel: output.channel, text: output.text});
      } finally {
        this.outputReading = false;
      }
    };
    __velarProcessSeal(this);
  }
  wait() {
    if (this.outputReading) return __velarProcessReject(new __velarProcessNativeError("Process wait() cannot run while next() is pending"));
    this.waitStarted = true;
    if (!this.result) {
      let result;
      result = __velarProcessThen(invoke("wait", [this.handle]), value => {
        let outcome;
        try { outcome = waitValueOf(value, this.maxOutputBytes); }
        catch (error) {
          if (this.result === result) this.result = null;
          throw error;
        }
        if (outcome.retained) {
          if (this.result === result) this.result = null;
          throw outcome.error;
        }
        if (outcome.error) throw outcome.error;
        return outcome.result;
      }, error => {
        if (this.result === result) this.result = null;
        throw error;
      });
      this.result = result;
    }
    return this.result;
  }
  async stop() {
    return await __velarProcessRetryableStop(this, () => __velarProcessThen(invoke("stop", [this.handle]), value => {
        const outcome = stopValueOf(value, this.maxOutputBytes);
        if (outcome.error) this.result = __velarProcessObservedReject(outcome.error);
        else if (outcome.result) this.result = __velarProcessResolve(outcome.result);
        return null;
      }));
  }
}

export const Process = __velarProcessFreeze({
  is(value) { return value instanceof ProcessHandle; },
  parse(value) { if (!(value instanceof ProcessHandle)) throw new __velarProcessNativeTypeError("Process values are created only by velar/process.start"); return value; },
});
export async function start(command, args = [], options = {}) {
  const wire = optionsOf(options);
  const value = startValueOf(await invoke("start", [boundedText(command, "Process command"), argumentsOf(args), wire]));
  return new ProcessHandle(__velarNodeProcessToken, value.handle, value.pid, wire.maxOutputBytes);
}
export async function run(command, args = [], options = {}) {
  const owner = await start(command, args, options);
  try { return await owner.wait(); }
  catch (error) {
    if (!owner.result) __velarProcessRetainRun(owner);
    throw error;
  }
}
`.trimStart()],
  ["velar/http", VELAR_NODE_HTTP_RUNTIME],
  ["velar/env", VELAR_NODE_ENV_RUNTIME],
  ["velar/host", VELAR_NODE_HOST_RUNTIME],
  ["velar/terminal", String.raw`
${VELAR_UTF8_RUNTIME}
${VELAR_NODE_TERMINAL_RUNTIME.replace("WORKER_SOURCE", JSON.stringify(VELAR_NODE_TERMINAL_WORKER_SOURCE))}
`.trimStart()],
  ["velar/serve", String.raw`
${VELAR_STRICT_JSON_RUNTIME}
${VELAR_TYPE_REGISTRY_RUNTIME}
${VELAR_UTF8_RUNTIME}
${VELAR_NODE_SERVE_RUNTIME}
`.trimStart()],
]);

export const nodeModuleDependencies: ReadonlyMap<string, readonly string[]> = new Map([
  ["velar/http", [VELAR_NODE_HOST_MODULE]],
  ["velar/fs", [VELAR_NODE_HOST_MODULE]],
  ["velar/serve", [VELAR_NODE_HOST_MODULE]],
]);

const nodeModules = new Set(nodeModuleInterfaces.keys());
const sharedPlatformModules = new Set(["velar/http"]);

export function isNodeModule(source: string): boolean {
  return nodeModules.has(source);
}

export function isNodeOnlyModule(source: string): boolean {
  return nodeModules.has(source) && !sharedPlatformModules.has(source);
}

export function nodeModuleDiagnostic(source: string): string {
  if (source === "velar/serve") return "velar/serve is a local runtime module; web applications use the dev server and velar/http";
  return `${source} is a local runtime module and cannot run in a web application`;
}

export const velarNodeCompilerExtension: CompilerExtension = Object.freeze({
  id: "@velarscript/node",
  contract: Object.freeze({ protocolVersion: 1, apiVersion: VELAR_NODE_API_VERSION, kind: "capability", extends: Object.freeze({}) }),
  capabilities: Object.freeze(["node"]),
  modules: Object.freeze({
    apiVersion: VELAR_NODE_API_VERSION,
    interfaces: nodeModuleInterfaces,
    sources: nodeModuleSources,
    dependencies: nodeModuleDependencies,
  }),
});
