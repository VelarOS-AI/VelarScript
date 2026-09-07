/**
 * `velar/http` — the request and response shapes, the form body, and the three error classes.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `webModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import {
  arrayString,
  blobType,
  boolType,
  bytesType,
  fileArrayType,
  fileType,
  mapString,
  moduleInterface,
  namedFunction,
  namedIntrinsic,
  nullType,
  numberType,
  object,
  promise,
  stringType,
  unknownType,
} from "./types.ts";

const formBodyType = object({
  field: namedFunction(["name", "value"], [stringType, stringType], nullType),
  file: namedFunction(["name", "value", "fileName"], [stringType, fileType, stringType], nullType, 2),
  files: namedFunction(["name", "values"], [stringType, fileArrayType], nullType),
  remove: namedFunction(["name"], [stringType], nullType),
  has: namedFunction(["name"], [stringType], boolType),
  names: namedFunction([], [], arrayString),
});
const httpChunkConsumerType = namedFunction(["chunk"], [stringType], promise(nullType));
const httpTransportPhaseIdentity = "velar/http#enum:HttpTransportPhase";
const httpTransportPhaseMembers = new Set(["request", "response"]);
const httpTransportPhaseWireValues = new Map([...httpTransportPhaseMembers].map((member) => [member, member]));
const httpTransportPhaseType: ValueType = { kind: "enum", name: "HttpTransportPhase", identity: httpTransportPhaseIdentity };
const httpTransportErrorIdentity = "velar/http#class:HttpTransportError";

// D90 R20: `ok` is gone from the response. `response()` throws
// `HttpResponseError` for every non-2xx, so the only response an author can
// hold has `ok === true` — a field that is always true is a lie in the type,
// and `if not r.ok:` was a dead branch the tour taught twice. The failure
// path is a `catch` that narrows with `is HttpResponseError`, and the
// analyzer says so when the old field is read.
const httpResponseType = object({
  status: numberType,
  statusText: stringType,
  url: stringType,
  headers: mapString(stringType),
  json: namedFunction([], [], promise(unknownType)),
  text: namedFunction([], [], promise(stringType)),
  bytes: namedFunction([], [], promise(bytesType)),
  streamText: namedFunction(["consume"], [httpChunkConsumerType], promise(nullType)),
  blob: namedFunction([], [], promise(blobType)),
  parse: namedIntrinsic("runtime.parseAsync", ["target"], [unknownType], promise(unknownType)),
});

const requestType = object({
  response: namedFunction([], [], promise(httpResponseType)),
  json: namedFunction([], [], promise(unknownType)),
  text: namedFunction([], [], promise(stringType)),
  bytes: namedFunction([], [], promise(bytesType)),
  streamText: namedFunction(["consume"], [httpChunkConsumerType], promise(nullType)),
  blob: namedFunction([], [], promise(blobType)),
  parse: namedIntrinsic("runtime.parseAsync", ["target"], [unknownType], promise(unknownType)),
  cancel: namedFunction([], [], nullType),
});

const httpOptionsType = object({
  headers: optional(mapString(stringType)),
  body: optional(unknownType),
  timeout: optional(numberType),
  maxBytes: optional(numberType),
  credentials: optional(stringType),
  cache: optional(stringType),
});
const httpType = object({
  request: namedIntrinsic("http.request", ["method", "url", "options"], [stringType, stringType, httpOptionsType], requestType, 2),
  get: namedIntrinsic("http.request", ["url", "options"], [stringType, httpOptionsType], requestType, 1),
  post: namedIntrinsic("http.request", ["url", "options"], [stringType, httpOptionsType], requestType, 1),
  put: namedIntrinsic("http.request", ["url", "options"], [stringType, httpOptionsType], requestType, 1),
  patch: namedIntrinsic("http.request", ["url", "options"], [stringType, httpOptionsType], requestType, 1),
  delete: namedIntrinsic("http.request", ["url", "options"], [stringType, httpOptionsType], requestType, 1),
  head: namedIntrinsic("http.request", ["url", "options"], [stringType, httpOptionsType], requestType, 1),
});

export const velarHttpModuleEntry: readonly [string, ModuleInterface] = ["velar/http", moduleInterface(new Map([
  ["http", httpType],
  ["formBody", namedFunction([], [], formBodyType)],
  ["HttpTransportPhase", { kind: "enumObject", name: "HttpTransportPhase", identity: httpTransportPhaseIdentity, members: httpTransportPhaseMembers }],
  ["HttpAbortError", { kind: "classConstructor", name: "HttpAbortError" }],
  ["HttpResponseError", { kind: "classConstructor", name: "HttpResponseError" }],
  ["HttpTransportError", { kind: "classConstructor", name: "HttpTransportError", identity: httpTransportErrorIdentity }],
]), new Map([
  ["HttpAbortError", {
    parameters: [stringType],
    parameterNames: ["reason"],
    requiredParameters: 1,
    base: "Error",
    abstract: false,
    fields: new Map([["reason", { mutable: false, type: stringType }]]),
    getters: new Set(),
    abstractGetters: new Set(),
    methods: new Map(),
    abstractMethods: new Set(),
    staticFields: new Map(),
    staticGetters: new Set(),
    staticMethods: new Map(),
  }],
  ["HttpResponseError", {
    parameters: [stringType, numberType, stringType, unknownType],
    parameterNames: ["message", "status", "url", "body"],
    requiredParameters: 3,
    base: "Error",
    abstract: false,
    fields: new Map([
      ["status", { mutable: false, type: numberType }],
      ["url", { mutable: false, type: stringType }],
      ["body", { mutable: false, type: unknownType }],
    ]),
    getters: new Set(),
    abstractGetters: new Set(),
    methods: new Map(),
    abstractMethods: new Set(),
    staticFields: new Map(),
    staticGetters: new Set(),
    staticMethods: new Map(),
  }],
  ["HttpTransportError", {
    identity: httpTransportErrorIdentity,
    parameters: [stringType, httpTransportPhaseType],
    parameterNames: ["message", "phase"],
    requiredParameters: 2,
    base: "Error",
    abstract: false,
    fields: new Map([["phase", { mutable: false, type: httpTransportPhaseType }]]),
    getters: new Set(),
    abstractGetters: new Set(),
    methods: new Map(),
    abstractMethods: new Set(),
    staticFields: new Map(),
    staticGetters: new Set(),
    staticMethods: new Map(),
  }],
]), new Map(), new Map(), new Map([["HttpTransportPhase", { identity: httpTransportPhaseIdentity, members: httpTransportPhaseMembers, wireValues: httpTransportPhaseWireValues }]]))];
