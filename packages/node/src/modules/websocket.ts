/**
 * `velar/websocket` — the client half Web also publishes, plus the
 * server half only a local runtime can have
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `nodeModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ClassInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { serveAppType, serveRequestType } from "../server-types.ts";
import { serveResponseAlias } from "./serve.ts";
import { bytesType, functionType, listStringType, moduleInterface, nullType, numberType, object, promise, stringType } from "./types.ts";

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

export const velarWebSocketModuleEntry: readonly [string, ModuleInterface] = ["velar/websocket", moduleInterface(
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
)];
