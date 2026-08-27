import type { ExtensionValueType, ValueType } from "@velarscript/compiler/extension";

export const VELAR_SERVE_APP_IDENTITY = "velar/serve#type:ServeApp";
export const VELAR_SERVE_REQUEST_IDENTITY = "velar/serve#type:ServeRequest";
export const VELAR_ROUTE_PATTERN_IDENTITY = "velar/serve#type:RoutePattern";
export const VELAR_HTTP_OUTCOME_IDENTITY = "velar/serve#type:HttpOutcome";
export const VELAR_WEBSOCKET_CONNECTION_IDENTITY = "velar/websocket#type:WebSocketConnection";
export const VELAR_NODE_TYPE_EXTENSION_ID = "@velarscript/node";

export type NodeRouteInputSource = "header" | "cookie" | "form" | "upload" | "dependency" | "security" | "request";
export type NodeRouteInputType = ExtensionValueType & {
  readonly extensionId: typeof VELAR_NODE_TYPE_EXTENSION_ID;
  readonly family: "serve-input";
  readonly role: NodeRouteInputSource;
};
export type NodeProviderType = ExtensionValueType & {
  readonly extensionId: typeof VELAR_NODE_TYPE_EXTENSION_ID;
  readonly family: "serve-provider";
  readonly role: "provider";
};
export type NodeBoundRoutePathType = ExtensionValueType & {
  readonly extensionId: typeof VELAR_NODE_TYPE_EXTENSION_ID;
  readonly family: "serve-route-path";
  readonly role: "bound";
};

export const serveAppType: ValueType = Object.freeze({
  kind: "named",
  name: "ServeApp",
  identity: VELAR_SERVE_APP_IDENTITY,
});

export const serveRequestType: ValueType = Object.freeze({
  kind: "named",
  name: "ServeRequest",
  identity: VELAR_SERVE_REQUEST_IDENTITY,
});

export const routePatternType: ValueType = Object.freeze({
  kind: "named",
  name: "RoutePattern",
  identity: VELAR_ROUTE_PATTERN_IDENTITY,
});

export const httpOutcomeType: ValueType = Object.freeze({
  kind: "named",
  name: "HttpOutcome",
  identity: VELAR_HTTP_OUTCOME_IDENTITY,
});

export function isServeRequestType(type: ValueType): boolean {
  return type.kind === "named"
    && (type.identity === VELAR_SERVE_REQUEST_IDENTITY || type.name === "ServeRequest" || type.name === "Request");
}

export function isWebSocketConnectionType(type: ValueType): boolean {
  return type.kind === "named"
    && (type.identity === VELAR_WEBSOCKET_CONNECTION_IDENTITY || type.name === "WebSocketConnection");
}

export function nodeRouteInputType(
  source: NodeRouteInputSource,
  value: ValueType,
  metadata: Readonly<Record<string, string>> = {},
): NodeRouteInputType {
  return {
    kind: "extension",
    extensionId: VELAR_NODE_TYPE_EXTENSION_ID,
    family: "serve-input",
    role: source,
    properties: new Map(),
    requiredProperties: new Set(),
    arguments: [value],
    metadata,
    display: { kind: "named", name: `input.${source}` },
  };
}

export function nodeProviderType(inputs: ValueType, result: ValueType): NodeProviderType {
  return {
    kind: "extension",
    extensionId: VELAR_NODE_TYPE_EXTENSION_ID,
    family: "serve-provider",
    role: "provider",
    properties: new Map(),
    requiredProperties: new Set(),
    arguments: [inputs, result],
    display: { kind: "named", name: "Provider" },
  };
}

export function nodeBoundRoutePathType(params: ValueType, query: ValueType): NodeBoundRoutePathType {
  return {
    kind: "extension",
    extensionId: VELAR_NODE_TYPE_EXTENSION_ID,
    family: "serve-route-path",
    role: "bound",
    // RoutePattern 是静态协议，RouteMatch 是一次请求的匹配结果。分开两者后，
    // 模板文本、实际 pathname 与已解码字段不会继续挤在一个含混的 path 对象里。
    properties: new Map([["pattern", routePatternType], ["pathname", {kind: "string"}], ["params", params], ["query", query]]),
    requiredProperties: new Set(["pattern", "pathname", "params", "query"]),
    arguments: [params, query],
    display: {kind: "named", name: "RouteMatch"},
  };
}

export function isNodeRouteInputType(type: ValueType): type is NodeRouteInputType {
  return type.kind === "extension"
    && type.extensionId === VELAR_NODE_TYPE_EXTENSION_ID
    && type.family === "serve-input";
}

export function isNodeProviderType(type: ValueType): type is NodeProviderType {
  return type.kind === "extension"
    && type.extensionId === VELAR_NODE_TYPE_EXTENSION_ID
    && type.family === "serve-provider"
    && type.role === "provider";
}

export function nodeRouteInputValue(type: NodeRouteInputType): ValueType {
  return type.arguments[0] ?? { kind: "unknown" };
}

export function nodeProviderResult(type: NodeProviderType): ValueType {
  return type.arguments[1] ?? { kind: "unknown" };
}
