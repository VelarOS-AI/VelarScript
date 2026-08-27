import {
  type CompilerExtension,
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
import { VELAR_SERVER_RUNTIME } from "./runtime.ts";

export const VELAR_SERVER_API_VERSION = "0.13";

const unknownType: ValueType = {kind: "unknown"};
const stringType: ValueType = {kind: "string"};
const numberType: ValueType = {kind: "number"};
const serverType: ValueType = {kind: "named", name: "Server", identity: "velar/serve#type:Server"};
const serveAppType: ValueType = {kind: "named", name: "ServeApp", identity: "velar/serve#type:ServeApp"};
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

function moduleInterface(exports: ReadonlyMap<string, ValueType>): ModuleInterface {
  return {
    exports,
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes: new Map(),
    namedTypeReadonlyFields: new Map(),
    namedTypeIdentities: new Map(),
    typeAliases: new Map(),
    enums: new Map(),
    classes: new Map(),
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

const composedModuleInterfaces = new Map(nodeModuleInterfaces);
composedModuleInterfaces.set("velar/server", serverModuleInterface);
export const serverModuleInterfaces: ReadonlyMap<string, ModuleInterface> = composedModuleInterfaces;

const composedModuleSources = new Map(nodeModuleSources);
composedModuleSources.set("velar/server", String.raw`
${VELAR_STRICT_JSON_RUNTIME}
${VELAR_TYPE_REGISTRY_RUNTIME}
${VELAR_SERVER_RUNTIME}
`.trimStart());
export const serverModuleSources: ReadonlyMap<string, string> = composedModuleSources;

const serverModuleDependencies = new Map(nodeModuleDependencies);
serverModuleDependencies.set("velar/server", ["velar/fs", "velar/serve"]);

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
