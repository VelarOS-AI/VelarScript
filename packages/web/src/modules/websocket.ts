/**
 * `velar/websocket` — the Web half of the socket surface: `connect` and nothing that listens.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `webModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ClassInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { bytesType, durationType, moduleInterface, namedFunction, nullType, numberType, object, promise, stringType } from "./types.ts";

const webSocketConnectionIdentity = "velar/websocket#type:WebSocketConnection";
const webSocketCloseIdentity = "velar/websocket#type:WebSocketClose";
const webSocketConnectionType: ValueType = { kind: "named", name: "WebSocketConnection", identity: webSocketConnectionIdentity };
export const webSocketCloseType: ValueType = { kind: "named", name: "WebSocketClose", identity: webSocketCloseIdentity };
export const webSocketMessageType: ValueType = { kind: "union", members: [stringType, bytesType] };
const webSocketCloseFields = new Map<string, ValueType>([
  ["code", numberType],
  ["reason", stringType],
]);
const webSocketConnectionFields = new Map<string, ValueType>([
  // D90 fr-4: one identity, one field roster. A Web connection is always an
  // outbound `connect()` result, which was never upgraded from an Origin and
  // therefore reads back null — the same value the Node runtime gives an
  // outbound connection. Leaving the field off Web instead would make
  // `velar/websocket#type:WebSocketConnection` mean two different things.
  ["origin", optional(stringType)],
  ["state", namedFunction([], [], stringType)],
  ["send", namedFunction(["message"], [webSocketMessageType], promise(nullType))],
  ["next", namedFunction([], [], promise(optional(webSocketMessageType)))],
  ["closeInfo", namedFunction([], [], promise(webSocketCloseType))],
  ["close", namedFunction(["code", "reason"], [numberType, stringType], promise(nullType), 0)],
]);
const webSocketConnectOptions = object({
  timeout: optional(durationType),
  maxMessageBytes: optional(numberType),
  maxQueuedMessages: optional(numberType),
  maxQueuedBytes: optional(numberType),
  maxPendingSendBytes: optional(numberType),
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
    ...[...webSocketErrorIdentities].map(([name, identity]) => [name, { kind: "classConstructor", name, identity } as ValueType] as const),
    ["connect", namedFunction(["url", "options"], [stringType, webSocketConnectOptions], promise(webSocketConnectionType), 1)],
  ]),
  new Map([...webSocketErrorIdentities].map(([name, identity]) => [name, webSocketErrorClass(identity)])),
  new Map([
    ["WebSocketConnection", webSocketConnectionFields],
    ["WebSocketClose", webSocketCloseFields],
  ]),
  new Map([
    ["WebSocketConnection", webSocketConnectionIdentity],
    ["WebSocketClose", webSocketCloseIdentity],
  ]),
  new Map(),
  new Map([
    ["WebSocketConnection", new Set(webSocketConnectionFields.keys())],
    ["WebSocketClose", new Set(webSocketCloseFields.keys())],
  ]),
)];
