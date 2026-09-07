/**
 * `velar/serve`: the surface, and the runtime module a build renders it from.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `nodeModuleInterfaces` entry they build. `velar/serve` is the
 * one module whose emitted JavaScript a build parameterizes, so the function
 * that assembles that source is here too, below the contract it serves.
 */
import { optionalOf as optional, type ClassInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { NODE_PROJECT_IDENTITY_SOURCE, portableProjectIdentity, portableProjectRootOffset } from "../project-config.ts";
import { ROUTE_SHAPE_FROM_SEGMENTS_SOURCE } from "../route-shape.ts";
import { VELAR_NODE_SERVE_BODY, VELAR_NODE_SERVE_PREFIX } from "../runtime-sources.generated.ts";
import { VELAR_HTTP_OUTCOME_IDENTITY, VELAR_HTTP_PROBLEM_IDENTITY, VELAR_ROUTE_PATTERN_IDENTITY, httpOutcomeType, routePatternType, serveAppType, serveRequestType } from "../server-types.ts";
import { boolType, bytesType, cancellationType, functionType, listStringType, moduleInterface, namedIntrinsic, nullType, numberType, object, promise, stringMapType, stringType, unknownType } from "./types.ts";

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
export const serveResponseAlias: ValueType = { kind: "union", members: [jsonResponseType, textResponseType, streamResponseType] };
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
export const providerType: ValueType = { kind: "extension", extensionId: "@velarscript/node", family: "serve-provider", role: "provider", properties: new Map(), requiredProperties: new Set(), arguments: [unknownType, unknownType], display: { kind: "named", name: "Provider" } };
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

export const velarServeModuleEntry: readonly [string, ModuleInterface] = ["velar/serve", moduleInterface(
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
)];

/**
 * `velar/serve`, closed over the one route-shape definition and the one fact
 * about its own placement that only a build knows.
 *
 * D90 R19(c): a route's shape — its method-independent collision key — is one
 * concept with one definition, in `route-shape.ts`. The static analyzer calls
 * that function; the emitted module carries its **compiled source**, so the two
 * referees cannot drift. That source is therefore not a generation-time
 * constant: it reads differently depending on whether `route-shape.ts` was
 * type-stripped from `src` or compiled into `dist`. Resolving either form into
 * `runtime/serve.js` would silently change what the other one emits, so the
 * runtime is cut at that line and this function is what puts it back — the same
 * treatment `velar/server` gets for the configuration path a project selected
 * (D115 §一.4, `runtime/manifest.json` `assemblies`).
 *
 * D114 F7-node-b item 2 adds the second such line. The config a build renders
 * this module from carries `projectRootOffset`: the path from the directory the
 * emitted entry lands in back to the project root — `..` for a directory build
 * inside the project, `../..` for the `velar run` sandbox under
 * `<project>/.velar/` — and it is what lets a relative static `root` mean the
 * directory the author wrote it against rather than wherever this build
 * happened to put the entry. Only the build knows it, so it cannot be resolved
 * into the runtime file either. No config is the honest answer for every caller
 * that is not a build — an editor, a test host, the module read straight out of
 * the sources map — and leaves the entry's own directory as the only candidate,
 * which is what `velar/serve` did before.
 *
 * D114 F9-node-cli (audit NO-D1) adds the third and fourth. `projectIdentity` is
 * who the project at that offset has to be, and `__velarServeProjectIdentityOf`
 * is the compiled source of the one function that decides it, so the build and
 * the emitted module read a `velar.json` the same way. Without them the offset
 * named a *place*, and any directory standing in that place was believed.
 *
 * `project-config.ts`'s `velarNodeServeProjectConfig` is where those facts are
 * put, for every extension set that carries this module rather than for
 * `@velarscript/node` alone (D114 SV-X1).
 */
export function velarNodeServeSource(projectConfig: unknown = null): string {
  const nodeConfig = projectConfig && typeof projectConfig === "object" && !Array.isArray(projectConfig)
    ? projectConfig as {readonly projectRootOffset?: unknown; readonly projectIdentity?: unknown}
    : null;
  return `${VELAR_NODE_SERVE_PREFIX}const __velarServeProjectRootOffset = ${JSON.stringify(portableProjectRootOffset(nodeConfig?.projectRootOffset))};
const __velarServeProjectIdentity = ${JSON.stringify(portableProjectIdentity(nodeConfig?.projectIdentity))};
const __velarServeProjectIdentityOf = ${NODE_PROJECT_IDENTITY_SOURCE};
const __velarServeRouteShapeFromSegments = ${ROUTE_SHAPE_FROM_SEGMENTS_SOURCE};
${VELAR_NODE_SERVE_BODY}`;
}
