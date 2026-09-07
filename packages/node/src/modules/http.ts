/**
 * `velar/http` — the client Web publishes too, and the three error
 * classes a transport can raise
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `nodeModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ClassInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { bytesType, functionType, moduleInterface, namedIntrinsic, nullType, numberType, object, promise, stringMapType, stringType, unknownType } from "./types.ts";

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

export const velarHttpModuleEntry: readonly [string, ModuleInterface] = ["velar/http", moduleInterface(
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
)];
