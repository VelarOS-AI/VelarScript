/**
 * `velar/realtime` — the server-sent event stream, and the typed reconnecting client composed over `velar/websocket`.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `webModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ClassInfo, type GenericTypeInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import {
  boolType,
  capabilityHandle,
  durationType,
  errorType,
  functionType,
  moduleInterface,
  namedFunction,
  nullType,
  numberType,
  object,
  promise,
  stringType,
  unknownType,
} from "./types.ts";
import { webSocketCloseType, webSocketMessageType } from "./websocket.ts";

// D51 (audit 12): the realtime handle is a standard capability handle that
// publishes `close()`, so `using` supplies its release contract (charter
// section 16). It is declared structurally rather than as a named type, and
// the marker is what lets Core see it without ever detecting a shape.
//
// `velar/websocket.connect` remains the sole raw WebSocket transport. The
// higher-level `realtimeClient` below composes it with typed codecs, lifecycle,
// and reconnect policy; it does not duplicate framing or invent a second
// socket contract.
const eventStreamHandlersType = object({
  open: optional(functionType([], unknownType)),
  message: optional(functionType([stringType, stringType], unknownType)),
  error: optional(functionType([stringType], unknownType)),
});
const eventStreamType = capabilityHandle({ url: stringType, state: namedFunction([], [], stringType), close: namedFunction([], [], nullType) });

const realtimeWireType = webSocketMessageType;
const realtimeCodecIdentity = "velar/realtime#type:RealtimeCodec";
const realtimeClientIdentity = "velar/realtime#type:RealtimeClient";
const realtimeFailureIdentity = "velar/realtime#type:RealtimeFailure";
const realtimeOpenIdentity = "velar/realtime#type:RealtimeOpen";
const realtimeClientStateIdentity = "velar/realtime#enum:RealtimeClientState";
const realtimeFailureActionIdentity = "velar/realtime#enum:RealtimeClientFailureAction";
const realtimeUnavailableIdentity = "velar/realtime#class:RealtimeUnavailableError";
const realtimeClientStates = new Set(["idle", "connecting", "open", "reconnecting", "closed"]);
const realtimeFailureActions = new Set(["continue", "reconnect", "stop"]);
const realtimeClientStateType: ValueType = {kind: "enum", name: "RealtimeClientState", identity: realtimeClientStateIdentity};
const realtimeFailureActionType: ValueType = {kind: "enum", name: "RealtimeClientFailureAction", identity: realtimeFailureActionIdentity};
const realtimeFailureType: ValueType = {kind: "named", name: "RealtimeFailure", identity: realtimeFailureIdentity};
const realtimeOpenType: ValueType = {kind: "named", name: "RealtimeOpen", identity: realtimeOpenIdentity};
const realtimeCodecIncoming: ValueType = {kind: "parameter", name: "Incoming", index: 0};
const realtimeCodecOutgoing: ValueType = {kind: "parameter", name: "Outgoing", index: 1};
const realtimeClientOutgoing: ValueType = {kind: "parameter", name: "T", index: 0};
const realtimeInput: ValueType = {kind: "parameter", name: "Incoming", index: 0};
const realtimeOutput: ValueType = {kind: "parameter", name: "Outgoing", index: 1};

function realtimeGenericApplication(name: string, identity: string, arguments_: readonly ValueType[]): ValueType {
  const labels = arguments_.map((argument, index) => argument.kind === "parameter" ? argument.name : `T${index + 1}`);
  return {kind: "named", name: `${name}<${labels.join(", ")}>`, identity, application: {declaration: identity, name, arguments: arguments_}};
}

const realtimeCodecOf = (incoming: ValueType, outgoing: ValueType): ValueType => realtimeGenericApplication("RealtimeCodec", realtimeCodecIdentity, [incoming, outgoing]);
const realtimeClientOf = (outgoing: ValueType): ValueType => realtimeGenericApplication("RealtimeClient", realtimeClientIdentity, [outgoing]);
const realtimeCodecTemplate: GenericTypeInfo = {
  identity: realtimeCodecIdentity,
  name: "RealtimeCodec",
  parameterNames: ["Incoming", "Outgoing"],
  parameterBounds: [null, null],
  fields: new Map([
    ["decode", namedFunction(["message"], [realtimeWireType], realtimeCodecIncoming)],
    ["encode", namedFunction(["message"], [realtimeCodecOutgoing], realtimeWireType)],
  ]),
  readonlyFields: new Set(["decode", "encode"]),
};
const realtimeClientTemplate: GenericTypeInfo = {
  identity: realtimeClientIdentity,
  name: "RealtimeClient",
  parameterNames: ["T"],
  parameterBounds: [null],
  fields: new Map([
    ["state", namedFunction([], [], realtimeClientStateType)],
    ["generation", namedFunction([], [], numberType)],
    ["start", namedFunction([], [], promise(nullType))],
    ["whenOpen", namedFunction([], [], promise(numberType))],
    ["whenClosed", namedFunction([], [], promise(nullType))],
    ["send", namedFunction(["message"], [realtimeClientOutgoing], promise(nullType))],
    ["close", namedFunction(["code", "reason"], [numberType, stringType], promise(nullType), 0)],
  ]),
  readonlyFields: new Set(["state", "generation", "start", "whenOpen", "whenClosed", "send", "close"]),
};
const realtimeGenericTypes = new Map<string, GenericTypeInfo>([
  ["RealtimeCodec", realtimeCodecTemplate],
  ["RealtimeClient", realtimeClientTemplate],
]);
const realtimeFailureFields = new Map<string, ValueType>([
  ["phase", stringType],
  ["error", errorType],
  ["recoverable", boolType],
]);
const realtimeOpenFields = new Map<string, ValueType>([
  ["generation", numberType],
  ["reconnected", boolType],
]);
const realtimeClientOptions = object({
  connectTimeout: optional(durationType),
  maxMessageBytes: optional(numberType),
  maxQueuedMessages: optional(numberType),
  maxQueuedBytes: optional(numberType),
  maxPendingSendBytes: optional(numberType),
  reconnectDelays: optional({kind: "list", element: durationType}),
  reconnectJitter: optional(numberType),
  retryInitial: optional(boolType),
});
const realtimeClientOutput = realtimeClientOf(realtimeOutput);
const realtimeUrlType: ValueType = {kind: "union", members: [stringType, namedFunction([], [], stringType)]};
const realtimeReceive = namedFunction(["message", "client"], [realtimeInput, realtimeClientOutput], promise(nullType));
const realtimeOpened = namedFunction(["client", "open"], [realtimeClientOutput, realtimeOpenType], promise(nullType));
const realtimeFailed = namedFunction(["failure", "client"], [realtimeFailureType, realtimeClientOutput], promise(realtimeFailureActionType));
const realtimeClosed = namedFunction(["client", "close"], [realtimeClientOutput, webSocketCloseType], promise(nullType));
const realtimeStateChanged = namedFunction(["client", "state"], [realtimeClientOutput, realtimeClientStateType], promise(nullType));
const realtimeClientFunction: ValueType = {
  kind: "function",
  typeParameterNames: ["Incoming", "Outgoing"],
  parameterNames: ["url", "codec", "receive", "opened", "failed", "closed", "stateChanged", "options"],
  parameters: [
    realtimeUrlType,
    realtimeCodecOf(realtimeInput, realtimeOutput),
    realtimeReceive,
    optional(realtimeOpened),
    optional(realtimeFailed),
    optional(realtimeClosed),
    optional(realtimeStateChanged),
    realtimeClientOptions,
  ],
  requiredParameters: 3,
  result: realtimeClientOutput,
};
const realtimeUnavailableClass: ClassInfo = {
  identity: realtimeUnavailableIdentity,
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
};

export const velarRealtimeModuleEntry: readonly [string, ModuleInterface] = ["velar/realtime", moduleInterface(
  new Map([
    ["RealtimeClient", {kind: "typeObject", name: "RealtimeClient", value: realtimeClientOf(realtimeClientOutgoing)}],
    ["RealtimeClientFailureAction", {kind: "enumObject", name: "RealtimeClientFailureAction", identity: realtimeFailureActionIdentity, members: realtimeFailureActions}],
    ["RealtimeClientState", {kind: "enumObject", name: "RealtimeClientState", identity: realtimeClientStateIdentity, members: realtimeClientStates}],
    ["RealtimeCodec", {kind: "typeObject", name: "RealtimeCodec", value: realtimeCodecOf(realtimeCodecIncoming, realtimeCodecOutgoing)}],
    ["RealtimeFailure", {kind: "typeObject", name: "RealtimeFailure", value: realtimeFailureType}],
    ["RealtimeOpen", {kind: "typeObject", name: "RealtimeOpen", value: realtimeOpenType}],
    ["RealtimeUnavailableError", {kind: "classConstructor", name: "RealtimeUnavailableError", identity: realtimeUnavailableIdentity}],
    ["eventStream", namedFunction(["url", "handlers", "credentials"], [stringType, eventStreamHandlersType, boolType], eventStreamType, 1)],
    ["realtimeClient", realtimeClientFunction],
  ]),
  new Map([["RealtimeUnavailableError", realtimeUnavailableClass]]),
  new Map([
    ["RealtimeFailure", realtimeFailureFields],
    ["RealtimeOpen", realtimeOpenFields],
  ]),
  new Map([
    ["RealtimeFailure", realtimeFailureIdentity],
    ["RealtimeOpen", realtimeOpenIdentity],
  ]),
  new Map([
    ["RealtimeClientFailureAction", {identity: realtimeFailureActionIdentity, members: realtimeFailureActions, wireValues: new Map([...realtimeFailureActions].map((member) => [member, member]))}],
    ["RealtimeClientState", {identity: realtimeClientStateIdentity, members: realtimeClientStates, wireValues: new Map([...realtimeClientStates].map((member) => [member, member]))}],
  ]),
  new Map([
    ["RealtimeFailure", new Set(realtimeFailureFields.keys())],
    ["RealtimeOpen", new Set(realtimeOpenFields.keys())],
  ]),
  realtimeGenericTypes,
)];
