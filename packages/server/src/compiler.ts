import {
  type CompilerExtension,
  type EnumInfo,
  type GenericTypeInfo,
  type ModuleInterface,
  type ValueType,
} from "@velarscript/compiler";
import {
  VELAR_STRICT_JSON_RUNTIME,
  VELAR_TYPE_REGISTRY_RUNTIME,
  type CompilerIntrinsicAnalysisContext,
} from "@velarscript/compiler/extension";
import {
  VELAR_NODE_API_VERSION,
  nodeModuleDependencies,
  nodeModuleInterfaces,
  nodeModuleSources,
  velarNodeCompilerExtension,
} from "@velarscript/node/compiler";
import { inferServerIntrinsic } from "./analyzer.ts";
import { VELAR_SERVER_REALTIME_RUNTIME } from "./realtime-runtime.ts";
import { VELAR_SERVER_RUNTIME } from "./runtime.ts";

export const VELAR_SERVER_API_VERSION = "0.14";

const unknownType: ValueType = {kind: "unknown"};
const stringType: ValueType = {kind: "string"};
const numberType: ValueType = {kind: "number"};
const boolType: ValueType = {kind: "bool"};
const nullType: ValueType = {kind: "null"};
const errorType: ValueType = {kind: "class", name: "Error"};
const bytesType: ValueType = {kind: "named", name: "Bytes", identity: "velar/binary#type:Bytes"};
const durationType: ValueType = {kind: "named", name: "Duration"};
const serverType: ValueType = {kind: "named", name: "Server", identity: "velar/serve#type:Server"};
const serveAppType: ValueType = {kind: "named", name: "ServeApp", identity: "velar/serve#type:ServeApp"};
const webSocketConnectionType: ValueType = {kind: "named", name: "WebSocketConnection", identity: "velar/websocket#type:WebSocketConnection"};
const webSocketCloseType: ValueType = {kind: "named", name: "WebSocketClose", identity: "velar/websocket#type:WebSocketClose"};
const providerType: ValueType = {
  kind: "extension",
  extensionId: "@velarscript/node",
  family: "serve-provider",
  role: "provider",
  properties: new Map(),
  requiredProperties: new Set(),
  arguments: [unknownType, unknownType],
  display: {kind: "named", name: "Provider"},
};

function promise(value: ValueType): ValueType {
  return {kind: "promise", value};
}

function functionType(
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType {
  return {kind: "function", parameterNames, parameters, requiredParameters, result};
}

function intrinsic(
  name: string,
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType {
  return {kind: "intrinsic", name, parameterNames, parameters, requiredParameters, result};
}

const realtimeWireType: ValueType = {kind: "union", members: [stringType, bytesType]};
const realtimeFailureIdentity = "velar/realtime#type:RealtimeFailure";
const realtimeFailureType: ValueType = {kind: "named", name: "RealtimeFailure", identity: realtimeFailureIdentity};
const realtimeFailureActionIdentity = "velar/realtime#enum:RealtimeFailureAction";
const realtimeFailureActionMembers = new Set(["continue", "close"]);
const realtimeFailureActionType: ValueType = {kind: "enum", name: "RealtimeFailureAction", identity: realtimeFailureActionIdentity};
const realtimePeerStateIdentity = "velar/realtime#enum:RealtimePeerState";
const realtimePeerStateMembers = new Set(["open", "closing", "closed"]);
const realtimePeerStateType: ValueType = {kind: "enum", name: "RealtimePeerState", identity: realtimePeerStateIdentity};
const realtimeBackpressureIdentity = "velar/realtime#class:RealtimeBackpressureError";
const realtimePeerIdentity = "velar/realtime#type:RealtimePeer";
const realtimeCodecIdentity = "velar/realtime#type:RealtimeCodec";
const realtimePeerElement: ValueType = {kind: "parameter", name: "T", index: 0};
const realtimeCodecIncoming: ValueType = {kind: "parameter", name: "Incoming", index: 0};
const realtimeCodecOutgoing: ValueType = {kind: "parameter", name: "Outgoing", index: 1};

function genericApplication(name: string, identity: string, arguments_: readonly ValueType[]): ValueType {
  const labels = arguments_.map((argument, index) => argument.kind === "parameter" ? argument.name : `T${index + 1}`);
  return {kind: "named", name: `${name}<${labels.join(", ")}>`, identity, application: {declaration: identity, name, arguments: arguments_}};
}

const realtimePeerOf = (value: ValueType): ValueType => genericApplication("RealtimePeer", realtimePeerIdentity, [value]);
const realtimeCodecOf = (incoming: ValueType, outgoing: ValueType): ValueType => genericApplication("RealtimeCodec", realtimeCodecIdentity, [incoming, outgoing]);
const realtimePeerTemplate: GenericTypeInfo = {
  identity: realtimePeerIdentity,
  name: "RealtimePeer",
  parameterNames: ["T"],
  parameterBounds: [null],
  fields: new Map<string, ValueType>([
    ["state", functionType([], [], realtimePeerStateType)],
    ["send", functionType(["message"], [realtimePeerElement], promise(nullType))],
    ["trySend", functionType(["message"], [realtimePeerElement], boolType)],
    ["close", functionType(["code", "reason"], [numberType, stringType], promise(nullType), 0)],
  ]),
  readonlyFields: new Set(["state", "send", "trySend", "close"]),
};
const realtimeCodecTemplate: GenericTypeInfo = {
  identity: realtimeCodecIdentity,
  name: "RealtimeCodec",
  parameterNames: ["Incoming", "Outgoing"],
  parameterBounds: [null, null],
  fields: new Map([
    ["decode", functionType(["message"], [realtimeWireType], realtimeCodecIncoming)],
    ["encode", functionType(["message"], [realtimeCodecOutgoing], realtimeWireType)],
  ]),
  readonlyFields: new Set(["decode", "encode"]),
};
const realtimeGenericTypes = new Map<string, GenericTypeInfo>([
  ["RealtimePeer", realtimePeerTemplate],
  ["RealtimeCodec", realtimeCodecTemplate],
]);
const realtimeFailureFields = new Map<string, ValueType>([
  ["phase", stringType],
  ["error", errorType],
  ["recoverable", boolType],
]);
const realtimeFailureActionInfo: EnumInfo = {
  identity: realtimeFailureActionIdentity,
  members: realtimeFailureActionMembers,
  wireValues: new Map([...realtimeFailureActionMembers].map((member) => [member, member])),
};
const realtimePeerStateInfo: EnumInfo = {
  identity: realtimePeerStateIdentity,
  members: realtimePeerStateMembers,
  wireValues: new Map([...realtimePeerStateMembers].map((member) => [member, member])),
};
const realtimeBackpressureClass: ModuleInterface["classes"] extends ReadonlyMap<string, infer C> ? C : never = {
  identity: realtimeBackpressureIdentity,
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
const realtimeSessionOptions: ValueType = {
  kind: "object",
  fields: new Map<string, ValueType>([
    ["maxQueuedMessages", numberType],
    ["maxQueuedBytes", numberType],
    ["drainTimeout", durationType],
  ]),
  optionalFields: new Set(["maxQueuedMessages", "maxQueuedBytes", "drainTimeout"]),
};
const realtimeInput: ValueType = {kind: "parameter", name: "Incoming", index: 0};
const realtimeOutput: ValueType = {kind: "parameter", name: "Outgoing", index: 1};
const realtimePeerOutput = realtimePeerOf(realtimeOutput);
const realtimeCleanup = functionType([], [], promise(nullType));
const realtimeOpened = functionType(["peer"], [realtimePeerOutput], promise({kind: "optional", inner: realtimeCleanup}));
const realtimeReceive = functionType(["message", "peer"], [realtimeInput, realtimePeerOutput], promise(nullType));
const realtimeFailed = functionType(["failure", "peer"], [realtimeFailureType, realtimePeerOutput], promise(realtimeFailureActionType));
const realtimeClosed = functionType(["peer", "close"], [realtimePeerOutput, webSocketCloseType], promise(nullType));
const optionalFunction = (value: ValueType): ValueType => ({kind: "optional", inner: value});
const realtimeSessionFunction: ValueType = {
  kind: "function",
  typeParameterNames: ["Incoming", "Outgoing"],
  parameterNames: ["connection", "codec", "receive", "opened", "failed", "closed", "options"],
  parameters: [
    webSocketConnectionType,
    realtimeCodecOf(realtimeInput, realtimeOutput),
    realtimeReceive,
    optionalFunction(realtimeOpened),
    optionalFunction(realtimeFailed),
    optionalFunction(realtimeClosed),
    realtimeSessionOptions,
  ],
  requiredParameters: 3,
  result: promise(nullType),
};

function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
  enums: ReadonlyMap<string, EnumInfo> = new Map(),
  classes: ModuleInterface["classes"] = new Map(),
  namedTypeReadonlyFields: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  genericTypes: NonNullable<ModuleInterface["genericTypes"]> = new Map(),
): ModuleInterface {
  return {
    exports,
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes,
    namedTypeReadonlyFields,
    namedTypeIdentities,
    genericTypes,
    typeAliases: new Map(),
    enums,
    classes,
    tests: [],
    extensionExports: new Map(),
    extensionData: new Map(),
  };
}

const serverModuleInterface = moduleInterface(new Map([
    ["application", functionType(["app", "path"], [serveAppType, {kind: "union", members: [stringType, {kind: "null"}]}], functionType([], [], promise(serverType)), 1)],
    ["authenticate", intrinsic("server.authenticate", ["credential", "verify"], [unknownType, unknownType], providerType)],
    ["configuration", intrinsic("server.configuration", ["target", "path", "maxBytes"], [unknownType, {kind: "union", members: [stringType, {kind: "null"}]}, numberType], promise(unknownType), 1)],
    ["database", intrinsic("server.database", ["connect", "disconnect"], [unknownType, unknownType], providerType)],
  ]));

const serverRealtimeModuleInterface = moduleInterface(new Map<string, ValueType>([
    ["RealtimeBackpressureError", {kind: "classConstructor", name: "RealtimeBackpressureError", identity: realtimeBackpressureIdentity}],
    ["RealtimeCodec", {kind: "typeObject", name: "RealtimeCodec", value: realtimeCodecOf(realtimeCodecIncoming, realtimeCodecOutgoing)}],
    ["RealtimeFailure", {kind: "typeObject", name: "RealtimeFailure", value: realtimeFailureType}],
    ["RealtimeFailureAction", {kind: "enumObject", name: "RealtimeFailureAction", identity: realtimeFailureActionIdentity, members: realtimeFailureActionMembers}],
    ["RealtimePeer", {kind: "typeObject", name: "RealtimePeer", value: realtimePeerOf(realtimePeerElement)}],
    ["RealtimePeerState", {kind: "enumObject", name: "RealtimePeerState", identity: realtimePeerStateIdentity, members: realtimePeerStateMembers}],
    ["realtimeSession", realtimeSessionFunction],
  ]),
  new Map([["RealtimeFailure", realtimeFailureFields]]),
  new Map([["RealtimeFailure", realtimeFailureIdentity]]),
  new Map([
    ["RealtimeFailureAction", realtimeFailureActionInfo],
    ["RealtimePeerState", realtimePeerStateInfo],
  ]),
  new Map([["RealtimeBackpressureError", realtimeBackpressureClass]]),
  new Map([["RealtimeFailure", new Set(realtimeFailureFields.keys())]]),
  realtimeGenericTypes,
);

const composedModuleInterfaces = new Map(nodeModuleInterfaces);
composedModuleInterfaces.set("velar/server", serverModuleInterface);
composedModuleInterfaces.set("velar/realtime", serverRealtimeModuleInterface);
export const serverModuleInterfaces: ReadonlyMap<string, ModuleInterface> = composedModuleInterfaces;

const composedModuleSources = new Map(nodeModuleSources);
composedModuleSources.set("velar/server", String.raw`
${VELAR_STRICT_JSON_RUNTIME}
${VELAR_TYPE_REGISTRY_RUNTIME}
${VELAR_SERVER_RUNTIME}
`.trimStart());
composedModuleSources.set("velar/realtime", VELAR_SERVER_REALTIME_RUNTIME);
export const serverModuleSources: ReadonlyMap<string, string> = composedModuleSources;

const serverModuleDependencies = new Map(nodeModuleDependencies);
serverModuleDependencies.set("velar/server", ["velar/fs", "velar/serve"]);
serverModuleDependencies.set("velar/realtime", ["velar/websocket"]);

export const velarCompilerExtension: CompilerExtension = Object.freeze({
  id: "@velarscript/server",
  contract: Object.freeze({
    protocolVersion: 1,
    apiVersion: VELAR_SERVER_API_VERSION,
    kind: "application",
    extends: Object.freeze({}),
    composes: Object.freeze({"@velarscript/node": VELAR_NODE_API_VERSION}),
  }),
  capabilities: Object.freeze(["node", "server"]),
  formatting: velarNodeCompilerExtension.formatting!,
  lexical: velarNodeCompilerExtension.lexical!,
  parser: velarNodeCompilerExtension.parser!,
  syntax: velarNodeCompilerExtension.syntax!,
  analyzer: velarNodeCompilerExtension.analyzer!,
  semantic: velarNodeCompilerExtension.semantic!,
  inspection: velarNodeCompilerExtension.inspection!,
  analysis: Object.freeze({
    ...velarNodeCompilerExtension.analysis,
    inferIntrinsic(context: CompilerIntrinsicAnalysisContext) {
      return inferServerIntrinsic(context) ?? velarNodeCompilerExtension.analysis?.inferIntrinsic?.(context);
    },
  }),
  editor: velarNodeCompilerExtension.editor!,
  createEmitter: velarNodeCompilerExtension.createEmitter!,
  modules: Object.freeze({
    apiVersion: VELAR_SERVER_API_VERSION,
    interfaces: serverModuleInterfaces,
    sources: serverModuleSources,
    dependencies: serverModuleDependencies,
  }),
});

export {velarProjectExtension, type VelarServerConfig} from "./project-config.ts";
