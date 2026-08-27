import { optionalOf as optional, type ClassInfo, type CompilerExtension, type EnumInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import {
  VELAR_ERROR_NORMALIZATION_MODULE,
  VELAR_COLLECTION_LOWERING_MODULE,
  VELAR_STRICT_JSON_RUNTIME,
  VELAR_TYPE_REGISTRY_RUNTIME,
  VELAR_UTF8_RUNTIME,
  type AnalysisContext,
  type CompilerAnalysisExtension,
  type CompilerEmitterOptions,
  type CompilerLexicalExtension,
  type ExtensionValueType,
  type LoweringHints,
  type Token,
} from "@velarscript/compiler/extension";
import { VELAR_NODE_ENV_RUNTIME } from "./environment-runtime.ts";
import { VELAR_NODE_FILESYSTEM_RUNTIME } from "./filesystem-runtime.ts";
import { VELAR_NODE_HTTP_RUNTIME } from "./http-runtime.ts";
import { VELAR_NODE_HOST_RUNTIME } from "./host-runtime.ts";
import { VELAR_NODE_HASH_RUNTIME } from "./hash-runtime.ts";
import { VELAR_NODE_HOST_RUNTIME as VELAR_SHARED_NODE_HOST_RUNTIME } from "./node-host-runtime.ts";
import { VELAR_NODE_HOST_WORKER_SOURCE } from "./node-host-worker-runtime.ts";
import { VELAR_PROCESS_HOST_RUNTIME } from "./process-runtime.ts";
import { VELAR_NODE_PROCESS_WORKER_SOURCE } from "./process-worker-runtime.ts";
import { VELAR_NODE_SERVE_RUNTIME } from "./serve-runtime.ts";
import { VELAR_NODE_TERMINAL_RUNTIME } from "./terminal-runtime.ts";
import { VELAR_NODE_TERMINAL_WORKER_SOURCE } from "./terminal-worker-runtime.ts";
import { VELAR_NODE_WORKER_RUNTIME } from "./worker-runtime.ts";
import { VELAR_NODE_WEBSOCKET_RUNTIME } from "./websocket-runtime.ts";
import { NODE_STATEMENT_CONSTRUCTS, nodeServerStatementContainsDirectAwait, nodeStatementConstructKey } from "./server-ast.ts";
import { inferNodeIntrinsic, VelarNodeAnalyzer } from "./server-analyzer.ts";
import { NodeJavaScriptEmitter } from "./server-emitter.ts";
import { velarNodeInspectionExtension } from "./server-inspection.ts";
import { scanNodePathPatternForFormatting, scanNodeToken } from "./server-lexer.ts";
import { VelarNodeParser } from "./server-parser.ts";
import { velarNodeSemanticExtension } from "./server-semantic.ts";
import { httpOutcomeType, routePatternType, serveAppType, serveRequestType, VELAR_HTTP_OUTCOME_IDENTITY, VELAR_ROUTE_PATTERN_IDENTITY } from "./server-types.ts";

export { VELAR_PROCESS_HOST_RUNTIME } from "./process-runtime.ts";

export const VELAR_NODE_API_VERSION = "0.14";
export const VELAR_NODE_HOST_MODULE = "velar/node-host-v1";

const unknownType: ValueType = { kind: "unknown" };
const nullType: ValueType = { kind: "null" };
const stringType: ValueType = { kind: "string" };
const numberType: ValueType = { kind: "number" };
const boolType: ValueType = { kind: "bool" };
const bytesType: ValueType = { kind: "named", name: "Bytes", identity: "velar/binary#type:Bytes" };
const cancellationType: ValueType = { kind: "named", name: "Cancellation", identity: "velar/task#type:Cancellation" };
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

/** A structurally declared standard capability handle; see ValueType.capabilityHandle. */
function capabilityHandle(fields: Readonly<Record<string, ValueType>>): ValueType {
  return { kind: "object", fields: new Map(Object.entries(fields)), capabilityHandle: true };
}

function object(fields: Readonly<Record<string, ValueType>>, optionalFields: readonly string[] = [], readonlyFields: readonly string[] = []): ValueType {
  return {
    kind: "object",
    fields: new Map(Object.entries(fields)),
    ...(optionalFields.length > 0 ? { optionalFields: new Set(optionalFields) } : {}),
    ...(readonlyFields.length > 0 ? { readonlyFields: new Set(readonlyFields) } : {}),
  };
}

function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
  typeAliases: ReadonlyMap<string, ValueType> = new Map(),
  classes: ReadonlyMap<string, ClassInfo> = new Map(),
  enums: ReadonlyMap<string, EnumInfo> = new Map(),
  namedTypeReadonlyFields: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): ModuleInterface {
  return {
    exports,
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes,
    namedTypeReadonlyFields,
    namedTypeIdentities,
    typeAliases,
    enums,
    classes,
    tests: [],
    extensionExports: new Map(),
    extensionData: new Map(),
  };
}

const serverType: ValueType = { kind: "named", name: "Server", identity: "velar/serve#type:Server" };
const requestBodyTooLargeErrorIdentity = "velar/serve#class:RequestBodyTooLargeError";
const responseHeadersType = stringMapType;
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
const httpProblemIdentity = "velar/serve#class:HttpProblem";
const httpProblemOptionsType = object({
  status: numberType,
  code: stringType,
  title: optional(stringType),
  detail: optional(stringType),
  type: optional(stringType),
  instance: optional(stringType),
  source: optional(stringType),
  parameter: optional(stringType),
  headers: optional(responseHeadersType),
}, ["title", "detail", "type", "instance", "source", "parameter", "headers"]);
const httpProblemClass: ClassInfo = {
  identity: httpProblemIdentity,
  parameters: [httpProblemOptionsType],
  parameterNames: ["options"],
  requiredParameters: 1,
  base: "Error",
  abstract: false,
  fields: new Map([
    ["status", { mutable: false, type: numberType }],
    ["code", { mutable: false, type: stringType }],
    ["title", { mutable: false, type: stringType }],
    ["detail", { mutable: false, type: optional(stringType) }],
    ["type", { mutable: false, type: stringType }],
    ["instance", { mutable: false, type: optional(stringType) }],
    ["source", { mutable: false, type: optional(stringType) }],
    ["parameter", { mutable: false, type: optional(stringType) }],
    ["headers", { mutable: false, type: responseHeadersType }],
  ]),
  getters: new Set(), abstractGetters: new Set(), methods: new Map(), abstractMethods: new Set(),
  staticFields: new Map(), staticGetters: new Set(), staticMethods: new Map(),
};
const writeChunkType = functionType(["chunk"], [stringType], promise(nullType));
const streamProducerType = functionType(["write"], [writeChunkType], promise(nullType));
const sseEventType = object({
  data: stringType,
  event: optional(stringType),
  id: optional(stringType),
  retry: optional(numberType),
}, ["event", "id", "retry"]);
const sseSendType = functionType(["event"], [{ kind: "union", members: [stringType, sseEventType] }], promise(nullType));
const sseProducerType = functionType(["send"], [sseSendType], promise(nullType));
// The payload field is readonly: the runtime freezes every response value, and a mutable
// structural field is invariant, which would make `json: unknown` accept only unknown instead of
// accepting any payload and answering unknown to readers (D90 R17).
const jsonResponseType = object({ status: numberType, json: unknownType, headers: responseHeadersType }, ["headers"], ["json"]);
const textResponseType = object({ status: numberType, text: stringType, contentType: stringType, headers: responseHeadersType }, ["contentType", "headers"]);
const streamResponseType = object({ status: numberType, stream: streamProducerType, headers: responseHeadersType }, ["headers"]);
const serveResponseAlias: ValueType = { kind: "union", members: [jsonResponseType, textResponseType, streamResponseType] };
const serveResultAlias: ValueType = {kind: "union", members: [serveResponseAlias, httpOutcomeType]};
const httpOutcomeFields = new Map<string, ValueType>([
  ["ok", boolType],
  ["status", numberType],
  ["value", unknownType],
  ["problem", optional({kind: "class", name: "HttpProblem", identity: httpProblemIdentity})],
  ["headers", responseHeadersType],
]);
const openApiDocumentType = object({
  openapi: stringType,
  info: object({ title: stringType, version: stringType }),
  paths: { kind: "record", value: unknownType },
});
const routeDocumentationType = object({
  summary: optional(stringType),
  description: optional(stringType),
  tags: optional(listStringType),
  status: optional(numberType),
  errors: optional({ kind: "map", key: numberType, value: stringType }),
  documented: optional(boolType),
}, ["summary", "description", "tags", "status", "errors", "documented"]);
const routeDocumentationMapType: ValueType = { kind: "map", key: stringType, value: routeDocumentationType };
const routePatternFields = new Map<string, ValueType>([["definition", stringType]]);
const handlerType = functionType(["request"], [serveRequestType], promise(serveResultAlias));
const serveTargetType: ValueType = { kind: "union", members: [handlerType, serveAppType] };
const middlewareNextType = functionType([], [], promise(serveResponseAlias));
// 中间件接到的 next 已经经过应用的 @response 策略，因而它处理的是最终响应。
// 需要提前终止时使用 json/text/redirect 等明确表示，避免在中间件外再开启一轮策略。
const middlewareType = functionType(["request", "next"], [serveRequestType, middlewareNextType], promise(serveResponseAlias));
const middlewareListType: ValueType = { kind: "list", element: middlewareType };
const middlewareInputType: ValueType = { kind: "union", members: [middlewareType, middlewareListType] };
const providerType: ValueType = { kind: "extension", extensionId: "@velarscript/node", family: "serve-provider", role: "provider", properties: new Map(), requiredProperties: new Set(), arguments: [unknownType, unknownType], display: { kind: "named", name: "Provider" } };
// 这里只是内建函数签名的占位类型；分析器会把每次调用替换为准确的输入来源。
const routeInputType: ValueType = { kind: "extension", extensionId: "@velarscript/node", family: "serve-input", role: "request", properties: new Map(), requiredProperties: new Set(), arguments: [unknownType], display: { kind: "named", name: "RouteInput" } };
const uploadType: ValueType = { kind: "named", name: "Upload", identity: "velar/serve#type:Upload" };
const stringOrNullType: ValueType = { kind: "union", members: [stringType, nullType] };
const inputType = object({
  header: namedIntrinsic("serve.input.header", ["name", "default"], [stringType, stringOrNullType], routeInputType, 0),
  cookie: namedIntrinsic("serve.input.cookie", ["name", "default"], [stringType, stringOrNullType], routeInputType, 0),
  form: namedIntrinsic("serve.input.form", ["target"], [unknownType], routeInputType),
  upload: namedIntrinsic("serve.input.upload", ["name", "maxBytes"], [stringType, numberType], routeInputType, 0),
  dependency: namedIntrinsic("serve.input.dependency", ["provider"], [unknownType], routeInputType),
  request: namedIntrinsic("serve.input.request", [], [], routeInputType, 0),
});
const securityType = object({
  apiKey: namedIntrinsic("serve.security.apiKey", ["name", "source"], [stringType, stringType], routeInputType, 1),
  basic: namedIntrinsic("serve.security.basic", ["realm"], [stringType], routeInputType, 0),
  bearer: namedIntrinsic("serve.security.bearer", ["scheme"], [stringType], routeInputType, 0),
  oauth2: namedIntrinsic("serve.security.oauth2", ["authorizationUrl", "tokenUrl", "scopes"], [stringType, stringType, listStringType], routeInputType, 1),
  openId: namedIntrinsic("serve.security.openId", ["url"], [stringType], routeInputType),
});
const releaseProviderType = functionType(["value"], [unknownType], unknownType);
const errorHandlerType = functionType(["error", "request"], [unknownType, serveRequestType], promise(serveResponseAlias));
const accessLoggerType = functionType(["entry"], [object({method: stringType, path: stringType, status: numberType, durationMs: numberType})], unknownType);
const middlewareFactoriesType = object({
  cors: functionType(["origins", "methods", "headers", "credentials", "maxAge"], [listStringType, listStringType, listStringType, boolType, numberType], middlewareType, 0),
  trustedHosts: functionType(["hosts"], [listStringType], middlewareType),
  requestId: functionType(["header"], [stringType], middlewareType, 0),
  accessLog: functionType(["write"], [accessLoggerType], middlewareType),
  securityHeaders: functionType([], [], middlewareType),
  compression: functionType(["minimumBytes"], [numberType], middlewareType, 0),
  errors: functionType(["handle"], [errorHandlerType], middlewareType),
  timeout: functionType(["milliseconds"], [numberType], middlewareType),
  concurrency: functionType(["maximum"], [numberType], middlewareType),
});
const lifecycleHookType = functionType([], [], unknownType);
const backgroundTaskType = functionType([], [], unknownType);
const testResponseType: ValueType = { kind: "named", name: "TestResponse", identity: "velar/server-test#type:TestResponse" };
const testClientType: ValueType = { kind: "named", name: "TestClient", identity: "velar/server-test#type:TestClient" };
const testUploadType = object({filename: stringType, contentType: optional(stringType), data: {kind: "union", members: [stringType, bytesType]}}, ["contentType"]);
// `json` is readonly for the same invariance reason as the response payload: the options record
// is a request snapshot, and a mutable unknown field would accept only unknown.
const testRequestOptionsType = object({
  headers: optional(stringMapType),
  json: optional(unknownType),
  text: optional(stringType),
  form: optional(stringMapType),
  files: optional({kind: "map", key: stringType, value: testUploadType}),
}, ["headers", "json", "text", "form", "files"], ["json"]);
const testRequestType = functionType(["method", "path", "options"], [stringType, stringType, testRequestOptionsType], promise(testResponseType), 2);
const testMethodType = functionType(["path", "options"], [stringType, testRequestOptionsType], promise(testResponseType), 1);
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
const processOutputChannelWireValues = new Map([...processOutputChannelMembers].map((member) => [member, member]));
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
// D90 R20, the Node half of the same removal Web made: `ok` is gone from the
// response. `response()` throws `HttpResponseError` for every non-2xx before
// an author can hold the value, so the only response that exists has
// `ok === true` — a field that is always true is a lie in the type, and
// `if not r.ok:` was a dead branch the tour taught. The failure path is a
// `catch` narrowed with `is HttpResponseError`, and the Node analyzer says so
// when the old field is read or written.
const nodeHttpResponseType = object({
  status: numberType,
  statusText: stringType,
  url: stringType,
  headers: stringMapType,
  json: functionType([], [], promise(unknownType)),
  text: functionType([], [], promise(stringType)),
  bytes: functionType([], [], promise(bytesType)),
  streamText: functionType(["consume"], [httpChunkConsumerType], promise(nullType)),
  parse: namedIntrinsic("runtime.parseAsync", ["target"], [unknownType], promise(unknownType)),
});
const nodeHttpRequestType = object({
  response: functionType([], [], promise(nodeHttpResponseType)),
  json: functionType([], [], promise(unknownType)),
  text: functionType([], [], promise(stringType)),
  bytes: functionType([], [], promise(bytesType)),
  streamText: functionType(["consume"], [httpChunkConsumerType], promise(nullType)),
  parse: namedIntrinsic("runtime.parseAsync", ["target"], [unknownType], promise(unknownType)),
  cancel: functionType([], [], nullType),
});
const nodeHttpOptionsType = object({
  headers: optional(stringMapType),
  secretHeaders: optional(httpSecretHeadersType),
  body: optional(unknownType),
  timeout: optional(numberType),
  maxBytes: optional(numberType),
}, ["headers", "secretHeaders", "body", "timeout", "maxBytes"]);
// D51 (audit 12): the terminal is a standard capability handle that publishes
// `close()`, so `using` supplies its release contract (charter section 16). The
// marker is set by this target, never inferred from the shape.
const terminalType = capabilityHandle({
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
const httpTransportPhaseWireValues = new Map([...httpTransportPhaseMembers].map((member) => [member, member]));
const httpTransportPhaseType: ValueType = { kind: "enum", name: "HttpTransportPhase", identity: httpTransportPhaseIdentity };
const httpAbortErrorIdentity = "velar/http#class:HttpAbortError";
const httpResponseErrorIdentity = "velar/http#class:HttpResponseError";
const httpTransportErrorIdentity = "velar/http#class:HttpTransportError";
const httpAbortErrorClass: ClassInfo = {
  identity: httpAbortErrorIdentity,
  parameters: [stringType], parameterNames: ["reason"], requiredParameters: 1,
  base: "Error", abstract: false,
  fields: new Map([["reason", { mutable: false, type: stringType }]]),
  getters: new Set(), abstractGetters: new Set(), methods: new Map(), abstractMethods: new Set(),
  staticFields: new Map(), staticGetters: new Set(), staticMethods: new Map(),
};
const httpResponseErrorClass: ClassInfo = {
  identity: httpResponseErrorIdentity,
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

const webSocketConnectionIdentity = "velar/websocket#type:WebSocketConnection";
const webSocketCloseIdentity = "velar/websocket#type:WebSocketClose";
const webSocketServerIdentity = "velar/websocket#type:WebSocketServer";
const webSocketConnectionType: ValueType = { kind: "named", name: "WebSocketConnection", identity: webSocketConnectionIdentity };
const webSocketCloseType: ValueType = { kind: "named", name: "WebSocketClose", identity: webSocketCloseIdentity };
const webSocketServerType: ValueType = { kind: "named", name: "WebSocketServer", identity: webSocketServerIdentity };
const webSocketMessageType: ValueType = { kind: "union", members: [stringType, bytesType] };
const webSocketCloseFields = new Map<string, ValueType>([
  ["code", numberType],
  ["reason", stringType],
]);
const webSocketConnectionFields = new Map<string, ValueType>([
  ["origin", optional(stringType)],
  ["state", functionType([], [], stringType)],
  ["send", functionType(["message"], [webSocketMessageType], promise(nullType))],
  ["next", functionType([], [], promise(optional(webSocketMessageType)))],
  ["closeInfo", functionType([], [], promise(webSocketCloseType))],
  ["close", functionType(["code", "reason"], [numberType, stringType], promise(nullType), 0)],
]);
const webSocketServerFields = new Map<string, ValueType>([
  ["port", numberType],
  ["next", functionType([], [], promise(optional(webSocketConnectionType)))],
  ["stop", functionType([], [], promise(nullType))],
]);
const webSocketConnectOptions = object({
  timeout: optional({ kind: "named", name: "Duration" }),
  maxMessageBytes: optional(numberType),
  maxQueuedMessages: optional(numberType),
  maxQueuedBytes: optional(numberType),
  maxPendingSendBytes: optional(numberType),
});
const webSocketListenOptions = object({
  port: numberType,
  host: optional(stringType),
  path: optional(stringType),
  http: optional({ kind: "union", members: [functionType(["request"], [serveRequestType], promise(serveResponseAlias)), serveAppType] }),
  origins: optional(listStringType),
  maxBodyBytes: optional(numberType),
  maxMessageBytes: optional(numberType),
  maxQueuedMessages: optional(numberType),
  maxQueuedBytes: optional(numberType),
  maxPendingSendBytes: optional(numberType),
  maxConnections: optional(numberType),
  maxPendingConnections: optional(numberType),
});
const webSocketErrorIdentities = new Map([
  ["WebSocketBackpressureError", "velar/websocket#class:WebSocketBackpressureError"],
  ["WebSocketClosedError", "velar/websocket#class:WebSocketClosedError"],
  ["WebSocketProtocolError", "velar/websocket#class:WebSocketProtocolError"],
  ["WebSocketTimeoutError", "velar/websocket#class:WebSocketTimeoutError"],
]);
const webSocketErrorClass = (identity: string): ClassInfo => ({
  identity,
  parameters: [stringType],
  parameterNames: ["message"],
  requiredParameters: 0,
  base: "Error",
  abstract: false,
  fields: new Map(),
  getters: new Set(),
  abstractGetters: new Set(),
  methods: new Map(),
  abstractMethods: new Set(),
  staticFields: new Map(),
  staticGetters: new Set(),
  staticMethods: new Map(),
});

export const nodeModuleInterfaces: ReadonlyMap<string, ModuleInterface> = new Map([
  ["velar/websocket", moduleInterface(
    new Map([
      ["WebSocketConnection", { kind: "typeObject", name: "WebSocketConnection", value: webSocketConnectionType }],
      ["WebSocketClose", { kind: "typeObject", name: "WebSocketClose", value: webSocketCloseType }],
      ["WebSocketServer", { kind: "typeObject", name: "WebSocketServer", value: webSocketServerType }],
      ...[...webSocketErrorIdentities].map(([name, identity]) => [name, { kind: "classConstructor", name, identity } as ValueType] as const),
      ["connect", functionType(["url", "options"], [stringType, webSocketConnectOptions], promise(webSocketConnectionType), 1)],
      ["listen", functionType(["options"], [webSocketListenOptions], promise(webSocketServerType))],
    ]),
    new Map([
      ["WebSocketConnection", webSocketConnectionFields],
      ["WebSocketClose", webSocketCloseFields],
      ["WebSocketServer", webSocketServerFields],
    ]),
    new Map([
      ["WebSocketConnection", webSocketConnectionIdentity],
      ["WebSocketClose", webSocketCloseIdentity],
      ["WebSocketServer", webSocketServerIdentity],
    ]),
    new Map(),
    new Map([...webSocketErrorIdentities].map(([name, identity]) => [name, webSocketErrorClass(identity)])),
    new Map(),
    new Map([
      ["WebSocketConnection", new Set(webSocketConnectionFields.keys())],
      ["WebSocketClose", new Set(webSocketCloseFields.keys())],
      ["WebSocketServer", new Set(webSocketServerFields.keys())],
    ]),
  )],
  ["velar/server-test", moduleInterface(
    new Map([
      ["TestClient", {kind: "typeObject", name: "TestClient", value: testClientType}],
      ["TestResponse", {kind: "typeObject", name: "TestResponse", value: testResponseType}],
      ["client", functionType(["app", "overrides"], [serveAppType, {kind: "map", key: providerType, value: unknownType}], promise(testClientType), 1)],
    ]),
    new Map([
      ["TestClient", new Map([
        ["request", testRequestType], ["get", testMethodType], ["post", testMethodType], ["put", testMethodType], ["patch", testMethodType], ["delete", testMethodType], ["close", functionType(["grace"], [numberType], promise(nullType), 0)],
      ])],
      ["TestResponse", new Map([
        ["status", numberType], ["headers", stringMapType], ["text", functionType([], [], promise(stringType))], ["json", functionType([], [], promise(unknownType))],
      ])],
    ]),
    new Map([["TestClient", "velar/server-test#type:TestClient"], ["TestResponse", "velar/server-test#type:TestResponse"]]),
  )],
  ["velar/serve", moduleInterface(
    new Map([
      ["Request", { kind: "typeObject", name: "Request", value: serveRequestType }],
      ["ServeRequest", { kind: "typeObject", name: "ServeRequest" }],
      ["ServeResponse", { kind: "typeObject", name: "ServeResponse" }],
      ["HttpOutcome", {kind: "typeObject", name: "HttpOutcome", value: httpOutcomeType}],
      ["ServeApp", { kind: "typeObject", name: "ServeApp", value: serveAppType }],
      ["RoutePattern", { kind: "typeObject", name: "RoutePattern", value: routePatternType }],
      ["Server", { kind: "typeObject", name: "Server" }],
      ["HttpProblem", {kind: "classConstructor", name: "HttpProblem", identity: httpProblemIdentity}],
      ["RequestBodyTooLargeError", { kind: "classConstructor", name: "RequestBodyTooLargeError", identity: requestBodyTooLargeErrorIdentity }],
      ["Upload", { kind: "typeObject", name: "Upload", value: uploadType }],
      ["Provider", { kind: "typeObject", name: "Provider", value: providerType }],
      ["RouteDocumentation", { kind: "typeObject", name: "RouteDocumentation" }],
      ["input", inputType],
      ["security", securityType],
      ["provide", namedIntrinsic("serve.provide", ["inputs", "resolve", "scope", "release", "eager"], [unknownType, unknownType, stringType, releaseProviderType, boolType], providerType, 2)],
      ["middleware", middlewareFactoriesType],
      ["serve", functionType(["app", "port", "host", "maxBodyBytes"], [serveTargetType, numberType, stringType, numberType], promise(serverType), 2)],
      ["json", namedIntrinsic("serve.response.json", ["value", "status", "headers"], [unknownType, numberType, optional(responseHeadersType)], jsonResponseType, 1)],
      ["respond", namedIntrinsic("serve.response.respond", ["value", "status", "headers"], [unknownType, numberType, optional(responseHeadersType)], httpOutcomeType, 1)],
      ["created", namedIntrinsic("serve.response.created", ["value", "headers"], [unknownType, optional(responseHeadersType)], httpOutcomeType, 1)],
      ["noContent", namedIntrinsic("serve.response.noContent", ["completion", "headers"], [nullType, optional(responseHeadersType)], httpOutcomeType, 0)],
      ["redirect", namedIntrinsic("serve.response.redirect", ["location", "status", "headers"], [stringType, numberType, optional(responseHeadersType)], textResponseType, 1)],
      ["text", namedIntrinsic("serve.response.text", ["value", "status", "contentType", "headers"], [stringType, numberType, stringType, optional(responseHeadersType)], textResponseType, 1)],
      ["stream", functionType(["producer", "status", "headers"], [streamProducerType, numberType, optional(responseHeadersType)], streamResponseType, 1)],
      ["sse", namedIntrinsic("serve.response.sse", ["producer", "headers"], [sseProducerType, optional(responseHeadersType)], streamResponseType, 1)],
      ["file", functionType(["path", "root", "fallback"], [stringType, stringType, optional(stringType)], serveResponseAlias, 1)],
      ["prefix", functionType(["path", "app"], [stringType, serveAppType], serveAppType)],
      ["staticFiles", functionType(["path", "root", "fallback"], [stringType, stringType, optional(stringType)], serveAppType, 2)],
      ["use", functionType(["app", "middleware"], [serveAppType, middlewareInputType], serveAppType)],
      ["bodyLimit", functionType(["app", "maxBytes"], [serveAppType, numberType], serveAppType)],
      ["openapi", functionType(["app", "title", "version"], [serveAppType, optional(stringType), stringType], openApiDocumentType, 1)],
      ["docs", functionType(["app", "title", "version", "path", "openapiPath", "routes"], [serveAppType, optional(stringType), stringType, stringType, stringType, routeDocumentationMapType], serveAppType, 1)],
      ["lifecycle", functionType(["app", "startup", "shutdown"], [serveAppType, lifecycleHookType, lifecycleHookType], serveAppType, 1)],
      ["background", namedIntrinsic("serve.response.background", ["response", "task"], [serveResultAlias, backgroundTaskType], serveResultAlias)],
      ["setCookie", namedIntrinsic("serve.response.setCookie", ["response", "name", "value", "path", "httpOnly", "secure", "sameSite", "maxAge"], [serveResultAlias, stringType, stringType, stringType, boolType, boolType, stringType, optional(numberType)], serveResultAlias, 3)],
      ["clearCookie", namedIntrinsic("serve.response.clearCookie", ["response", "name", "path"], [serveResultAlias, stringType, stringType], serveResultAlias, 2)],
      ["fileResponse", functionType(["root", "path", "fallback"], [stringType, stringType, optional(stringType)], serveResponseAlias, 2)],
    ]),
    new Map([
      ["Request", new Map([
        ["method", stringType],
        ["path", stringType],
        ["query", stringMapType],
        ["queryAll", {kind: "map", key: stringType, value: listStringType}],
        ["headers", stringMapType],
        ["cancellation", cancellationType],
        ["text", functionType(["maxBytes"], [numberType], promise(stringType), 0)],
        ["bytes", functionType(["maxBytes"], [numberType], promise(bytesType), 0)],
        ["json", functionType(["maxBytes"], [numberType], promise(unknownType), 0)],
        ["parse", namedIntrinsic("runtime.parseAsync", ["target", "maxBytes"], [unknownType, numberType], promise(unknownType), 1)],
      ])],
      ["ServeRequest", new Map([
        ["method", stringType],
        ["path", stringType],
        ["query", stringMapType],
        ["queryAll", {kind: "map", key: stringType, value: listStringType}],
        ["headers", stringMapType],
        ["cancellation", cancellationType],
        ["text", functionType(["maxBytes"], [numberType], promise(stringType), 0)],
        ["bytes", functionType(["maxBytes"], [numberType], promise(bytesType), 0)],
        ["json", functionType(["maxBytes"], [numberType], promise(unknownType), 0)],
        ["parse", namedIntrinsic("runtime.parseAsync", ["target", "maxBytes"], [unknownType, numberType], promise(unknownType), 1)],
      ])],
      ["Server", new Map([
        ["port", numberType],
        ["stop", functionType(["grace"], [numberType], promise(nullType), 0)],
      ])],
      ["ServeApp", new Map()],
      ["RoutePattern", routePatternFields],
      ["HttpOutcome", httpOutcomeFields],
      ["Upload", new Map([
        ["name", stringType],
        ["filename", stringType],
        ["contentType", stringType],
        ["size", numberType],
        ["text", functionType([], [], promise(stringType))],
        ["bytes", functionType([], [], promise(bytesType))],
        ["save", functionType(["path", "root"], [stringType, stringType], promise(nullType))],
      ])],
    ]),
    new Map([
      ["Request", "velar/serve#type:ServeRequest"],
      ["ServeRequest", "velar/serve#type:ServeRequest"],
      ["ServeApp", "velar/serve#type:ServeApp"],
      ["RoutePattern", VELAR_ROUTE_PATTERN_IDENTITY],
      ["HttpOutcome", VELAR_HTTP_OUTCOME_IDENTITY],
      ["Server", "velar/serve#type:Server"],
      ["Upload", "velar/serve#type:Upload"],
    ]),
    new Map<string, ValueType>([["ServeResponse", serveResponseAlias], ["Provider", providerType], ["RouteDocumentation", routeDocumentationType]]),
    new Map([["HttpProblem", httpProblemClass], ["RequestBodyTooLargeError", requestBodyTooLargeErrorClass]]),
  )],
  ["velar/fs", moduleInterface(
    new Map([
      ["FileWatchBatch", { kind: "typeObject", name: "FileWatchBatch" }],
      ["FileWatcher", { kind: "typeObject", name: "FileWatcher" }],
      ["readText", functionType(["path", "maxBytes"], [stringType, numberType], promise(stringType), 1)],
      ["readBytes", functionType(["path", "maxBytes"], [stringType, numberType], promise(bytesType), 1)],
      ["createText", functionType(["path", "text"], [stringType, stringType], promise(nullType))],
      ["createBytes", functionType(["path", "bytes"], [stringType, bytesType], promise(nullType))],
      ["replaceTextIfMatches", functionType(["path", "expected", "replacement"], [stringType, stringType, stringType], promise(boolType))],
      ["writeText", functionType(["path", "text"], [stringType, stringType], promise(nullType))],
      ["writeBytes", functionType(["path", "bytes"], [stringType, bytesType], promise(nullType))],
      ["appendText", functionType(["path", "text"], [stringType, stringType], promise(nullType))],
      ["exists", functionType(["path"], [stringType], promise(boolType))],
      ["list", functionType(["path", "maxItems"], [stringType, numberType], promise(listStringType), 1)],
      ["info", functionType(["path"], [stringType], promise(optional(fileInfoType)))],
      ["canonical", functionType(["path"], [stringType], promise(stringType))],
      ["makeDirectory", functionType(["path"], [stringType], promise(nullType))],
      ["copyFile", functionType(["source", "target", "replace"], [stringType, stringType, boolType], promise(nullType), 2)],
      ["move", functionType(["source", "target", "replace"], [stringType, stringType, boolType], promise(nullType), 2)],
      ["removeFile", functionType(["path"], [stringType], promise(nullType))],
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
  )],
  ["velar/hash", moduleInterface(new Map([
    ["sha256Text", functionType(["text"], [stringType], stringType)],
  ]))],
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
    ["toFileUrl", functionType(["path"], [stringType], stringType)],
    ["fromFileUrl", functionType(["url"], [stringType], stringType)],
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
    new Map([["ProcessOutputChannel", { identity: processOutputChannelIdentity, members: processOutputChannelMembers, wireValues: processOutputChannelWireValues }]]),
  )],
  ["velar/http", moduleInterface(
    new Map([
      ["http", nodeHttpType],
      ["secretHeader", functionType(["name", "environment", "prefix"], [stringType, stringType, stringType], httpSecretHeaderType, 2)],
      ["HttpTransportPhase", { kind: "enumObject", name: "HttpTransportPhase", identity: httpTransportPhaseIdentity, members: httpTransportPhaseMembers }],
      ["HttpAbortError", { kind: "classConstructor", name: "HttpAbortError", identity: httpAbortErrorIdentity }],
      ["HttpResponseError", { kind: "classConstructor", name: "HttpResponseError", identity: httpResponseErrorIdentity }],
      ["HttpTransportError", { kind: "classConstructor", name: "HttpTransportError", identity: httpTransportErrorIdentity }],
    ]),
    new Map(),
    new Map(),
    new Map(),
    new Map([
      ["HttpAbortError", httpAbortErrorClass],
      ["HttpResponseError", httpResponseErrorClass],
      ["HttpTransportError", httpTransportErrorClass],
    ]),
    new Map([["HttpTransportPhase", { identity: httpTransportPhaseIdentity, members: httpTransportPhaseMembers, wireValues: httpTransportPhaseWireValues }]]),
  )],
]);

export const nodeModuleSources: ReadonlyMap<string, string> = new Map([
  ["velar/server-test", String.raw`
import { ServeApp as __velarServerTestApp } from "velar/serve";
const __velarServerTestBridge = __velarServerTestApp.__velarCompilerBridge;
export async function client(app, overrides = null) { return await __velarServerTestBridge.testClient(app, overrides); }
export const TestClient = Object.freeze({is(value) { return !!value && typeof value === "object" && typeof value.request === "function" && typeof value.close === "function"; }, parse(value) { if (!TestClient.is(value)) throw new TypeError("Value does not match TestClient"); return value; }});
export const TestResponse = Object.freeze({is(value) { return !!value && typeof value === "object" && Number.isSafeInteger(value.status) && typeof value.text === "function" && typeof value.json === "function"; }, parse(value) { if (!TestResponse.is(value)) throw new TypeError("Value does not match TestResponse"); return value; }});
`.trimStart()],
  ["velar/websocket", VELAR_NODE_WEBSOCKET_RUNTIME],
  ["velar/worker", VELAR_NODE_WORKER_RUNTIME],
  [VELAR_NODE_HOST_MODULE, VELAR_SHARED_NODE_HOST_RUNTIME.replace("WORKER_SOURCE", JSON.stringify(VELAR_NODE_HOST_WORKER_SOURCE))],
  ["velar/fs", String.raw`
${VELAR_UTF8_RUNTIME}
${VELAR_NODE_FILESYSTEM_RUNTIME}
`.trimStart()],
  ["velar/hash", String.raw`
${VELAR_UTF8_RUNTIME}
${VELAR_NODE_HASH_RUNTIME}
`.trimStart()],
  ["velar/path", String.raw`
import { basename as nodeBasename, dirname as nodeDirname, extname, isAbsolute as nodeIsAbsolute, join as nodeJoin, normalize as nodeNormalize, relative as nodeRelative, resolve as nodeResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
export function toFileUrl(path) { return pathToFileURL(nodeResolve(pathValue(path, "toFileUrl"))).href; }
export function fromFileUrl(url) {
  url = pathValue(url, "fromFileUrl");
  if (!stringStartsWith(url, "file:")) throw new TypeError("fromFileUrl requires a file URL");
  return bounded(fileURLToPath(url), "fromFileUrl");
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
  // D60 rule 149: values() is the third name charter section 6 reserves on
  // every enum, and it returns a fresh mutable List in declaration order.
  values() { return ["stdout", "stderr"]; },
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
  ["velar/server-test", ["velar/serve"]],
  ["velar/worker", ["velar/worker-manifest", "velar/task"]],
  ["velar/websocket", ["velar/serve"]],
  ["velar/http", [VELAR_NODE_HOST_MODULE, "velar/binary"]],
  ["velar/fs", [VELAR_NODE_HOST_MODULE, "velar/binary"]],
  ["velar/serve", [VELAR_NODE_HOST_MODULE, VELAR_ERROR_NORMALIZATION_MODULE, VELAR_COLLECTION_LOWERING_MODULE, "velar/binary", "velar/fs", "velar/task"]],
  // D50 rule 89: the host proxy rebuilds the compiler-owned capability error
  // classes, so its module carries that dependency edge.
  [VELAR_NODE_HOST_MODULE, [VELAR_ERROR_NORMALIZATION_MODULE]],
]);

const nodeModules = new Set(nodeModuleInterfaces.keys());
const sharedPlatformModules = new Set(["velar/http", "velar/websocket"]);

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

const nodeRouteDocumentation = (method: string, usage: string, input: string): string => [
  `Declares a ${method} route in the current \`server\`. This is a compiler-owned role, not a decorator, function, or runtime value.`,
  "",
  "```velar",
  usage,
  "```",
  "",
  "An optional identifier before `(` is a stable operation identity copied into OpenAPI and checked across composition.",
  "",
  `The first argument is a checked \`p\"/...\"\` RoutePattern. An inline pattern projects its captures as immutable handler locals; append \`as route\` to bind the complete RouteMatch, and use that form for a catalog expression. ${input} The handler may use \`await\` directly and must return Data or a response from \`velar/serve\`.`,
].join("\n");

const nodeKeywordDocumentation = Object.freeze({
  server: [
    "Declares an immutable Node HTTP route table. `server` is contextual syntax owned by `@velarscript/node`, not a class or mutable runtime registry.",
    "",
    "```velar",
    "export server routes:",
    "    @get health(p\"/health\") => {ok: true}",
    "```",
    "",
    "A server body contains HTTP and `@websocket` route roles, one `@notFound` fallback, one `@response` policy, and `...otherApp` composition entries.",
  ].join("\n"),
  p: [
    "Creates a first-class Node RoutePattern. It is parsed and checked by the compiler; it is not a function call or an ordinary string prefix.",
    "",
    "```velar",
    "@get(p\"/articles/{id:number}\") => {id}",
    "```",
    "",
    "Each `{name:type}` capture becomes an immutable local in direct mode. `p\"/...\" as route` instead exposes `route.pattern`, `route.pathname`, `route.params`, and `route.query`; `str(route)` returns the complete pattern declaration, and referenced catalog patterns require this explicit binding. A type suffix `?` makes a query field optional.",
  ].join("\n"),
  "@get": nodeRouteDocumentation(
    "GET",
    "@get readArticle(p\"/articles/{id:number}?{details:bool?}\") => {id, details}",
    "Inline path and query captures are projected directly as immutable locals.",
  ),
  "@post": nodeRouteDocumentation(
    "POST",
    "@post createArticle(p\"/articles\", input: CreateArticle) => created(input)",
    "One Data parameter may receive the checked JSON request body; query fields belong to the RoutePattern.",
  ),
  "@put": nodeRouteDocumentation(
    "PUT",
    "@put(p\"/articles/{id:string}\", input: UpdateArticle) => {id, input}",
    "One Data parameter may receive the checked JSON request body; query fields belong to the RoutePattern.",
  ),
  "@patch": nodeRouteDocumentation(
    "PATCH",
    "@patch(p\"/articles/{id:string}\", input: ArticlePatch) => {id, input}",
    "One Data parameter may receive the checked JSON request body; query fields belong to the RoutePattern.",
  ),
  "@delete": nodeRouteDocumentation(
    "DELETE",
    "@delete(p\"/articles/{id:string}\") => noContent()",
    "Inline path and query captures are projected directly as immutable locals.",
  ),
  "@websocket": [
    "Declares a framework-owned WebSocket session route in the current `server`. The shared HTTP listener validates the RoutePattern and inputs before upgrading, then owns the handler until the connection ends.",
    "",
    "```velar",
    "@websocket worldRealtime(p\"/worlds/{worldId:string}/realtime\", connection: WebSocketConnection):",
    "    async for message in connection:",
    "        await connection.send(message)",
    "```",
    "",
    "An optional operation identifier is checked across composition and appears in OpenAPI as a GET upgrade with response 101 and `x-velar-transport: websocket`. Exactly one `WebSocketConnection` parameter is required. Route captures use the same direct projection or `as route` rules as HTTP; Request, dependency, security, header, and cookie inputs are resolved before the upgrade. The handler resolves to null and is joined with the application lifecycle.",
  ].join("\n"),
  "@notFound": [
    "Declares the final application's one unmatched-path fallback. It is a compiler-owned server role, not a decorator or ordinary function.",
    "",
    "```velar",
    "@notFound(request: Request) => {error: \"route_not_found\", path: request.path}",
    "```",
    "",
    "The optional parameter must be `Request`. Returning Data keeps status 404; an explicit response may choose another status. It does not catch a matched route's error or method-not-allowed response.",
  ].join("\n"),
  "@response": [
    "Declares the final application's one semantic response policy. It is a compiler-owned server role, not a decorator or ordinary function.",
    "",
    "```velar",
    "@response(outcome: HttpOutcome, request: Request) => json({ok: outcome.ok, data: outcome.value}, status=outcome.status, headers=outcome.headers)",
    "```",
    "",
    "The policy receives route and framework outcomes once and returns Data or one final response. A final response owns its status and headers, so forward the outcome values when only selecting an encoder. The policy cannot return another HttpOutcome.",
  ].join("\n"),
});

export const velarNodeCompilerExtension: CompilerExtension = Object.freeze({
  id: "@velarscript/node",
  contract: Object.freeze({ protocolVersion: 1, apiVersion: VELAR_NODE_API_VERSION, kind: "capability", extends: Object.freeze({}) }),
  capabilities: Object.freeze(["node"]),
  formatting: Object.freeze({
    scanOpaqueSource: scanNodePathPatternForFormatting,
  }),
  lexical: Object.freeze({
    contextualKeywords: new Set(["server"]),
    scan: scanNodeToken,
  }),
  parser: Object.freeze({
    create(tokens: readonly Token[], lexicalExtensions: readonly CompilerLexicalExtension[]) {
      return new VelarNodeParser(tokens, lexicalExtensions);
    },
  }),
  syntax: Object.freeze({
    statementConstructs: NODE_STATEMENT_CONSTRUCTS,
    statementConstructKey: nodeStatementConstructKey,
  }),
  analyzer: Object.freeze({
    create(context: AnalysisContext, extensions: readonly CompilerAnalysisExtension[]) {
      return new VelarNodeAnalyzer(context, extensions);
    },
  }),
  semantic: velarNodeSemanticExtension,
  inspection: velarNodeInspectionExtension,
  analysis: Object.freeze({
    directAwaitStatement: nodeServerStatementContainsDirectAwait,
    inferIntrinsic: inferNodeIntrinsic,
    memberType(type: ExtensionValueType, property: string) {
      if (type.extensionId === "@velarscript/node" && type.family === "serve-route-path") {
        return type.properties.get(property) ?? null;
      }
      return undefined;
    },
    textForm(type: ValueType) {
      if (type.kind === "named" && type.identity === VELAR_ROUTE_PATTERN_IDENTITY) return true;
      return type.kind === "extension" && type.extensionId === "@velarscript/node" && type.family === "serve-route-path" ? true : undefined;
    },
    // The Node guide already rules that the ambient Node globals are not the
    // door — "use velar/fs, velar/path, velar/process, velar/env,
    // velar/terminal, velar/http, velar/worker, and velar/websocket instead of
    // ambient Node globals" — but the rule had no enforcement arm, so every
    // one of those names fell through to a bare `Unknown name`. The Web
    // surface answers the same class of mistake with the module that replaced
    // it; this is the Node half of that answer.
    //
    // Only the names a Node reflex reaches for live here. The target-neutral
    // globals (setTimeout, structuredClone, URL, RegExp, TextEncoder,
    // AbortController, Symbol) are answered once in Core's own roster, and
    // localStorage/sessionStorage belong to Web — one mistake keeps one
    // answer, in one file.
    //
    // `module` is not listed: it is a VelarScript keyword, so it never reaches
    // name resolution and already reports that it cannot be a name.
    globalGuidance: new Map([
      // The three uses a Node author spells `process` for are three different
      // modules, so the message names all three rather than guessing. There is
      // no argv or cwd successor in the registry, so it names none.
      ["process", `Use "velar/env" 'get'/'require' for environment variables, "velar/process" 'run'/'start' to run a child process, and "velar/host" 'exit' to stop this one; VelarScript has no ambient process global`],
      ["Buffer", `Import from "velar/binary" — 'Bytes' and the typed buffers — instead of the Buffer global`],
      ["require", `VelarScript modules use 'import {name} from "..."'; there is no require`],
      ["exports", `VelarScript modules use 'export' on the declaration itself; there is no exports object`],
      ["global", "VelarScript has no ambient global object; import the capability you need"],
      ["__dirname", `Use "velar/path" — 'resolve', 'join', 'dirname', 'basename' — to build a path; a module's own address is not an ambient global`],
      ["__filename", `Use "velar/path" — 'resolve', 'join', 'dirname', 'basename' — to build a path; a module's own address is not an ambient global`],
      // Word for word the Web extension's sentence: one mistake, one answer,
      // on both surfaces.
      ["fetch", "Use velar/http instead of the raw fetch global"],
      // The sentence quoted above names velar/websocket too, and Node 22 does
      // carry an ambient `WebSocket`, so the reflex reaches this surface the
      // same way `fetch` does. The successor is extension-owned rather than
      // Core's, which is why it is answered here: a browser can only
      // `connect`, while this surface can `listen` as well.
      ["WebSocket", `Use "velar/websocket" — 'connect' opens a connection and 'listen' accepts them — instead of the WebSocket global`],
      // The `const path = require("path")` reflex reaches this surface as a
      // bare *module specifier* rather than as a global, and it is the one
      // shape in this file that answered wrongly rather than emptily: `path`
      // earned `did you mean 'Math'?`, a confident guess at an unrelated
      // namespace, which is the worst way a rejection can miss.
      //
      // These names are Node's own — a Core author never writes
      // `worker_threads` — so the Node extension answers them even where the
      // successor module belongs to Core. Core's roster holds none of them, so
      // no mistake gains a second answer; the test asserts that boundary.
      ["path", `Import what you need — 'import {join, resolve, dirname, basename} from "velar/path"' — VelarScript has no bare module names`],
      ["fs", `Import what you need — 'import {readText, writeText, exists, list} from "velar/fs"' — VelarScript has no bare module names`],
      ["http", `Import the client — 'import {http} from "velar/http"' — then call 'http.get(url)'; VelarScript has no bare module names`],
      ["url", `Import what you need — 'import {parse, join, withQuery, encode} from "velar/url"' — VelarScript has no bare module names`],
      ["child_process", `Import from "velar/process" — 'run' waits for a command and 'start' keeps a child running — VelarScript has no bare module names`],
      ["worker_threads", `Import from "velar/worker" — 'worker' starts one typed worker and 'workerPool' runs several — VelarScript has no bare module names`],
      // 每种密码学相关用途都保留独立、明确的契约：标识符、可复现随机流和有界
      // 文本摘要不是同一种能力。通用加密接口需要先明确密钥、nonce、字节数据和
      // 生命周期规则，因此在出现具体需求之前不加入标准 API。
      ["crypto", `Use 'import {uuid} from "velar/id"' for an identifier, "velar/random" 'random(seed)' for a reproducible stream, or 'import {sha256Text} from "velar/hash"' for a bounded UTF-8 SHA-256 digest; VelarScript has no general cipher module`],
      // Core answers `setTimeout`/`setInterval` because both hosts carry them.
      // `setImmediate` is Node's alone, so its answer is here rather than a
      // second copy there.
      ["setImmediate", "Use 'await Promise.sleep(0ms)' to yield before the work, or velar/task's 'task(work)' to run it alongside; VelarScript has no callback scheduler"],
      ["clearImmediate", "There is no callback scheduler to clear; 'await Promise.sleep(0ms)' yields inline, and velar/task's 'task(work)' is the schedule a Cancellation can stop"],
    ]),
  }),
  modules: Object.freeze({
    apiVersion: VELAR_NODE_API_VERSION,
    interfaces: nodeModuleInterfaces,
    sources: nodeModuleSources,
    dependencies: nodeModuleDependencies,
  }),
  editor: Object.freeze({
    keywordDocumentation: nodeKeywordDocumentation,
  }),
  createEmitter(
    hints: LoweringHints,
    forcedFunctionExports: ReadonlySet<string>,
    _resourceContents: ReadonlyMap<string, string>,
    _extensionImports: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
    options: CompilerEmitterOptions,
  ) {
    return new NodeJavaScriptEmitter(hints, forcedFunctionExports, options);
  },
});

/** Conventional package entry used by the project extension loader. */
export const velarCompilerExtension = velarNodeCompilerExtension;

export { velarProjectExtension, type VelarNodeConfig } from "./project-config.ts";
export {isNodeRouteInputType, nodeProviderType, nodeRouteInputValue} from "./server-types.ts";
