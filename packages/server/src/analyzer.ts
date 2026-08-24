import {
  nullType,
  numberType,
  optionalOf,
  stringType,
  unknownType,
  type CompilerIntrinsicAnalysisContext,
  type ValueType,
} from "@velarscript/compiler/extension";

const emptyInputsType: ValueType = {kind: "object", fields: new Map()};

function nodeProviderType(result: ValueType): ValueType {
  return {
    kind: "extension",
    extensionId: "@velarscript/node",
    family: "serve-provider",
    role: "provider",
    properties: new Map(),
    requiredProperties: new Set(),
    arguments: [emptyInputsType, result],
    display: {kind: "named", name: "Provider"},
  };
}

export function inferServerIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const {intrinsic, argumentAt, callSpan, arity, inferAt, callbackAt, runtimeTypeAt, expandAliases} = context;
  switch (intrinsic.name) {
    case "server.configuration": {
      arity(1, 3);
      const result = runtimeTypeAt(0);
      if (argumentAt(1)) inferAt(1, optionalOf(stringType));
      if (argumentAt(2)) inferAt(2, numberType);
      return {kind: "promise", value: result};
    }
    case "server.database": {
      arity(2, 2);
      const connector = callbackAt(0, [], unknownType);
      const raw = connector.kind === "function" || connector.kind === "action" || connector.kind === "intrinsic"
        ? expandAliases(connector.result)
        : unknownType;
      const connection = raw.kind === "promise" ? raw.value : unknownType;
      if (raw.kind !== "promise") context.typeError("server.database connect must return a Promise", argumentAt(0)?.span ?? callSpan);
      callbackAt(1, [connection], {kind: "promise", value: nullType});
      return nodeProviderType(connection);
    }
    default:
      return undefined;
  }
}
