import { optionalOf as optional, type ClassInfo, type CompilerExtension, type EnumInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import {
  VELAR_ERROR_NORMALIZATION_MODULE,
  VELAR_COLLECTION_LOWERING_MODULE,
  type AnalysisContext,
  type CompilerAnalysisExtension,
  type CompilerEmitterOptions,
  type CompilerLexicalExtension,
  type ExtensionValueType,
  type LoweringHints,
  type Token,
} from "@velarscript/compiler/extension";
import { velarNodeServeSource } from "./modules/serve.ts";
import {
  VELAR_NODE_ENV_RUNTIME,
  VELAR_NODE_FS_MODULE_SOURCE,
  VELAR_NODE_HOST_RUNTIME,
  VELAR_NODE_HTTP_RUNTIME,
  VELAR_NODE_PATH_MODULE_SOURCE,
  VELAR_NODE_PROCESS_MODULE_SOURCE,
  VELAR_NODE_SERVER_TEST_MODULE_SOURCE,
  VELAR_NODE_TERMINAL_MODULE_SOURCE,
  VELAR_NODE_WEBSOCKET_RUNTIME,
  VELAR_NODE_WORKER_RUNTIME,
  VELAR_SHARED_NODE_HOST_RUNTIME,
} from "./runtime-sources.generated.ts";
import { NODE_STATEMENT_CONSTRUCTS, nodeServerStatementContainsDirectAwait, nodeStatementConstructKey } from "./server-ast.ts";
import { inferNodeIntrinsic, VelarNodeAnalyzer } from "./server-analyzer.ts";
import { NodeJavaScriptEmitter } from "./server-emitter.ts";
import { velarNodeInspectionExtension } from "./server-inspection.ts";
import { scanNodePathPatternForFormatting, scanNodeToken } from "./server-lexer.ts";
import { VelarNodeParser } from "./server-parser.ts";
import { nodeKeywordDocumentation } from "./server-documentation.ts";
import { velarNodeSemanticExtension } from "./server-semantic.ts";
import { httpOutcomeType, routePatternType, serveAppType, serveRequestType, VELAR_HTTP_OUTCOME_IDENTITY, VELAR_HTTP_PROBLEM_IDENTITY, VELAR_ROUTE_PATTERN_IDENTITY } from "./server-types.ts";

// The Desktop target of `velar/process` inlines this same host-intrinsic
// boundary, and reaches it here rather than restating a second copy of it.
export { VELAR_PROCESS_HOST_RUNTIME } from "./runtime-sources.generated.ts";

export const VELAR_NODE_API_VERSION = "0.17";
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
const httpProblemIdentity = VELAR_HTTP_PROBLEM_IDENTITY;
const httpProblemOptionsType = object({
  status: numberType,
  reason: stringType,
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
    ["reason", { mutable: false, type: stringType }], // D114 P6 item 12: `code` is the class name; see serve-problem-analysis.ts
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
      ["run", functionType(["server"], [webSocketServerType], promise(nullType))],
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
      ["supply", namedIntrinsic("serve.supply", ["app", "provider", "value"], [serveAppType, providerType, unknownType], serveAppType)],
      ["middleware", middlewareFactoriesType],
      ["serve", functionType(["app", "port", "host", "maxBodyBytes"], [serveTargetType, numberType, stringType, numberType], promise(serverType), 2)],
      ["run", functionType(["server"], [serverType], promise(nullType))],
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
  ["velar/server-test", VELAR_NODE_SERVER_TEST_MODULE_SOURCE],
  ["velar/websocket", VELAR_NODE_WEBSOCKET_RUNTIME],
  ["velar/worker", VELAR_NODE_WORKER_RUNTIME],
  [VELAR_NODE_HOST_MODULE, VELAR_SHARED_NODE_HOST_RUNTIME],
  ["velar/fs", VELAR_NODE_FS_MODULE_SOURCE],
  ["velar/path", VELAR_NODE_PATH_MODULE_SOURCE],
  ["velar/process", VELAR_NODE_PROCESS_MODULE_SOURCE],
  ["velar/http", VELAR_NODE_HTTP_RUNTIME],
  ["velar/env", VELAR_NODE_ENV_RUNTIME],
  ["velar/host", VELAR_NODE_HOST_RUNTIME],
  ["velar/terminal", VELAR_NODE_TERMINAL_MODULE_SOURCE],
  // D90 R19(c): `velar/serve` closes over the one route-shape definition, read
  // off the compiled function the analyzer calls, so it is assembled rather
  // than generated.
  ["velar/serve", velarNodeServeSource()],
]);

export const nodeModuleDependencies: ReadonlyMap<string, readonly string[]> = new Map([
  ["velar/server-test", ["velar/serve"]],
  ["velar/worker", ["velar/worker-manifest", "velar/task", "velar/binary"]],
  ["velar/websocket", ["velar/serve", "velar/host"]],
  ["velar/http", [VELAR_NODE_HOST_MODULE, "velar/binary"]],
  ["velar/fs", [VELAR_NODE_HOST_MODULE, "velar/binary"]],
  ["velar/serve", [VELAR_NODE_HOST_MODULE, VELAR_ERROR_NORMALIZATION_MODULE, VELAR_COLLECTION_LOWERING_MODULE, "velar/binary", "velar/fs", "velar/host", "velar/task"]],
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

/**
 * SV-C2: the Standard API promises "platform-specific guidance" for a local
 * module a Web target refuses, and guidance is where to go, not only that this
 * door is shut. Every local module says it here — including the three that
 * honestly have no Web equivalent, because "there is none" is guidance too and
 * is what stops an author looking for one.
 */
const nodeModuleWebGuidance: ReadonlyMap<string, string> = new Map([
  ["velar/serve", "web applications are served by the dev server in development and by static hosting in production; call an HTTP API with velar/http"],
  ["velar/path", "use velar/url to build and read URL paths; the Web has no filesystem paths"],
  ["velar/fs", "use velar/files for files the person using the application picks or saves"],
  ["velar/env", "use velar/config for values the build supplies"],
  ["velar/host", "the Web has no equivalent: a page does not own the process it runs in"],
  ["velar/terminal", "the Web has no equivalent: a page has no terminal"],
  ["velar/process", "the Web has no equivalent: a page cannot start local programs"],
]);

export function nodeModuleDiagnostic(source: string): string {
  const guidance = nodeModuleWebGuidance.get(source);
  return `${source} is a local runtime module and cannot run in a web application`
    + (guidance === undefined ? "" : `; ${guidance}`);
}


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
