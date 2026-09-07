/**
 * `velar/serve`'s intrinsics: the calls whose result type the arguments decide,
 * which is why the module table declares a name and this file computes the type.
 *
 * D115 P4 R4a splits the one switch by the family a name belongs to —
 * `serve.response.*`, `serve.input.*`, `serve.security.*`, and the provider
 * pair — and each family answers `undefined` for a name it does not own, the
 * same answer the single switch's `default` gave.
 */
import {
  boolType,
  describeType,
  nullType,
  numberType,
  optionalOf,
  stringType,
  unknownType,
  type CompilerIntrinsicAnalysisContext,
  type ValueType,
} from "@velarscript/compiler/extension";
import { responseHeadersType } from "../../../contracts.ts";
import {
  isNodeProviderType,
  isNodeRouteInputType,
  nodeProviderResult,
  nodeProviderType,
  nodeRouteInputType,
  nodeRouteInputValue,
  serveAppType,
  serveRequestType,
} from "../../../server-types.ts";
import { literalStatus, nodeOutcomeValue, nodeResponseValue, requireResponseValue } from "../../response-shapes.ts";

const sseEventType: ValueType = {kind: "object", fields: new Map([
  ["data", stringType], ["event", optionalOf(stringType)], ["id", optionalOf(stringType)], ["retry", optionalOf(numberType)],
]), optionalFields: new Set(["event", "id", "retry"])};
const sseSendType: ValueType = {kind: "function", parameterNames: ["event"], parameters: [{kind: "union", members: [stringType, sseEventType]}], requiredParameters: 1, result: {kind: "promise", value: nullType}};
const uploadType: ValueType = { kind: "named", name: "Upload", identity: "velar/serve#type:Upload" };

/** Every `serve.*` intrinsic, dispatched to the family that owns its name. */
export function inferServeIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const name = context.intrinsic.name;
  if (name.startsWith("serve.response.")) return serveResponseIntrinsic(context);
  if (name.startsWith("serve.input.")) return serveInputIntrinsic(context);
  if (name.startsWith("serve.security.")) return serveSecurityIntrinsic(context);
  return serveProviderIntrinsic(context);
}

/** The values a handler may answer with, and the two ways one is decorated. */
function serveResponseIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, argumentAt, callSpan, arity, inferAt, callbackAt, expandAliases } = context;
  switch (intrinsic.name) {
    case "serve.response.json": {
      arity(1, 3);
      const value = inferAt(0, unknownType);
      if (argumentAt(1)) inferAt(1, numberType);
      if (argumentAt(2)) inferAt(2, optionalOf(responseHeadersType));
      return nodeResponseValue("json", value, literalStatus(argumentAt(1), 200), "application/json");
    }
    case "serve.response.created": {
      arity(1, 2);
      const value = inferAt(0, unknownType);
      if (argumentAt(1)) inferAt(1, optionalOf(responseHeadersType));
      return nodeOutcomeValue(value, 201);
    }
    case "serve.response.noContent": {
      arity(0, 2);
      if (argumentAt(0)) inferAt(0, nullType);
      if (argumentAt(1)) inferAt(1, optionalOf(responseHeadersType));
      return nodeOutcomeValue(nullType, 204);
    }
    case "serve.response.respond": {
      arity(1, 3);
      const value = inferAt(0, unknownType);
      if (argumentAt(1)) inferAt(1, numberType);
      if (argumentAt(2)) inferAt(2, optionalOf(responseHeadersType));
      return nodeOutcomeValue(value, literalStatus(argumentAt(1), 200));
    }
    case "serve.response.redirect": {
      arity(1, 3);
      inferAt(0, stringType);
      if (argumentAt(1)) inferAt(1, numberType);
      if (argumentAt(2)) inferAt(2, optionalOf(responseHeadersType));
      return nodeResponseValue("text", stringType, literalStatus(argumentAt(1), 302), "text/plain");
    }
    case "serve.response.text": {
      arity(1, 4);
      inferAt(0, stringType);
      if (argumentAt(1)) inferAt(1, numberType);
      if (argumentAt(2)) inferAt(2, stringType);
      if (argumentAt(3)) inferAt(3, optionalOf(responseHeadersType));
      return nodeResponseValue("text", stringType, literalStatus(argumentAt(1), 200), "text/plain");
    }
    case "serve.response.sse": {
      arity(1, 2);
      const producer = callbackAt(0, [sseSendType], {kind: "promise", value: nullType});
      if (argumentAt(1)) inferAt(1, optionalOf(responseHeadersType));
      return nodeResponseValue("stream", producer, 200, "text/event-stream");
    }
    case "serve.response.background": {
      arity(2, 2);
      const inferred = inferAt(0);
      const response = expandAliases(inferred);
      requireResponseValue(context, response, argumentAt(0)?.span ?? callSpan);
      callbackAt(1, [], unknownType);
      return inferred;
    }
    case "serve.response.setCookie": {
      arity(3, 8);
      const inferred = inferAt(0);
      const response = expandAliases(inferred);
      requireResponseValue(context, response, argumentAt(0)?.span ?? callSpan);
      inferAt(1, stringType);
      inferAt(2, stringType);
      if (argumentAt(3)) inferAt(3, stringType);
      if (argumentAt(4)) inferAt(4, boolType);
      if (argumentAt(5)) inferAt(5, boolType);
      if (argumentAt(6)) inferAt(6, stringType);
      if (argumentAt(7)) inferAt(7, optionalOf(numberType));
      return inferred;
    }
    case "serve.response.clearCookie": {
      arity(2, 3);
      const inferred = inferAt(0);
      const response = expandAliases(inferred);
      requireResponseValue(context, response, argumentAt(0)?.span ?? callSpan);
      inferAt(1, stringType);
      if (argumentAt(2)) inferAt(2, stringType);
      return inferred;
    }
    default:
      return undefined;
  }
}

/** The request inputs a route declares as parameter defaults. */
function serveInputIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, argumentAt, callSpan, arity, inferAt, runtimeTypeAt, expandAliases } = context;
  switch (intrinsic.name) {
    case "serve.input.header":
    case "serve.input.cookie": {
      arity(0, 2);
      inferAt(0, stringType);
      const fallback = argumentAt(1);
      let result: ValueType = stringType;
      if (fallback) {
        const inferred = expandAliases(inferAt(1, { kind: "union", members: [stringType, { kind: "null" }] }));
        if (inferred.kind === "null" || inferred.kind === "optional") result = optionalOf(stringType);
      }
      const source = intrinsic.name.slice("serve.input.".length) as "header" | "cookie";
      return nodeRouteInputType(source, result);
    }
    case "serve.input.form": {
      arity(1, 1);
      return nodeRouteInputType("form", runtimeTypeAt(0));
    }
    case "serve.input.upload": {
      arity(0, 2);
      inferAt(0, stringType);
      if (argumentAt(1)) inferAt(1, { kind: "number" });
      return nodeRouteInputType("upload", uploadType);
    }
    case "serve.input.request": {
      arity(0, 0);
      return nodeRouteInputType("request", serveRequestType);
    }
    case "serve.input.dependency": {
      arity(1, 1);
      const provider = expandAliases(inferAt(0));
      if (!isNodeProviderType(provider)) {
        context.typeError(`input.dependency requires a Provider, received ${describeType(provider)}`, argumentAt(0)?.span ?? callSpan);
        return nodeRouteInputType("dependency", unknownType);
      }
      return nodeRouteInputType("dependency", nodeProviderResult(provider));
    }
    default:
      return undefined;
  }
}

/** The five OpenAPI security schemes, each an input carrying its scheme. */
function serveSecurityIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, arity, inferAt } = context;
  switch (intrinsic.name) {
    case "serve.security.apiKey": {
      arity(1, 2);
      inferAt(0, stringType);
      inferAt(1, stringType);
      return nodeRouteInputType("security", stringType, { scheme: "apiKey" });
    }
    case "serve.security.basic": {
      arity(0, 1);
      inferAt(0, stringType);
      return nodeRouteInputType("security", {
        kind: "object",
        fields: new Map([["username", stringType], ["password", stringType]]),
      }, { scheme: "http", protocol: "basic" });
    }
    case "serve.security.bearer": {
      arity(0, 1);
      inferAt(0, stringType);
      return nodeRouteInputType("security", stringType, { scheme: "http", protocol: "bearer" });
    }
    case "serve.security.oauth2": {
      arity(1, 3);
      inferAt(0, stringType);
      inferAt(1, stringType);
      inferAt(2, { kind: "list", element: stringType });
      return nodeRouteInputType("security", stringType, { scheme: "oauth2" });
    }
    case "serve.security.openId": {
      arity(1, 1);
      inferAt(0, stringType);
      return nodeRouteInputType("security", stringType, { scheme: "openIdConnect" });
    }
    default:
      return undefined;
  }
}

/** The dependency pair: what a provider resolves, and what supplying it means. */
function serveProviderIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, argumentAt, callSpan, arity, inferAt, callbackAt, expandAliases } = context;
  switch (intrinsic.name) {
    case "serve.provide": {
      arity(2, 5);
      const inputs = expandAliases(inferAt(0));
      const resolved = new Map<string, ValueType>();
      if (inputs.kind !== "object") {
        context.typeError(`provide inputs must be an object of input descriptors, received ${describeType(inputs)}`, argumentAt(0)?.span ?? callSpan);
      } else {
        for (const [name, value] of inputs.fields) {
          const descriptor = expandAliases(value);
          if (!isNodeRouteInputType(descriptor)) {
            context.typeError(`Provider input '${name}' must be created by input or security, received ${describeType(descriptor)}`, argumentAt(0)?.span ?? callSpan);
            resolved.set(name, unknownType);
          } else resolved.set(name, nodeRouteInputValue(descriptor));
        }
      }
      const values: ValueType = { kind: "object", fields: resolved };
      const resolver = callbackAt(1, [values], unknownType);
      const rawResult = resolver.kind === "function" || resolver.kind === "action" || resolver.kind === "intrinsic"
        ? resolver.result
        : unknownType;
      const result = expandAliases(rawResult).kind === "promise"
        ? (expandAliases(rawResult) as Extract<ValueType, { kind: "promise" }>).value
        : rawResult;
      if (argumentAt(2)) inferAt(2, stringType);
      if (argumentAt(3)) callbackAt(3, [result], unknownType);
      if (argumentAt(4)) inferAt(4, boolType);
      return nodeProviderType(values, result);
    }
    case "serve.supply": {
      arity(3, 3);
      inferAt(0, serveAppType);
      const provider = expandAliases(inferAt(1));
      if (!isNodeProviderType(provider)) {
        context.typeError(`supply provider must be a Provider, received ${describeType(provider)}`, argumentAt(1)?.span ?? callSpan);
        inferAt(2, unknownType);
      } else inferAt(2, nodeProviderResult(provider));
      return serveAppType;
    }
    default:
      return undefined;
  }
}
