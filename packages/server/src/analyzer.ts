import {
  describeType,
  nullType,
  nonOptional,
  numberType,
  optionalOf,
  stringType,
  unknownType,
  type CompilerIntrinsicAnalysisContext,
  type ValueType,
} from "@velarscript/compiler/extension";
import {isNodeRouteInputType, nodeProviderType, nodeRouteInputValue} from "@velarscript/node/compiler";

const emptyInputsType: ValueType = {kind: "object", fields: new Map()};

export function inferServerIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const {intrinsic, argumentAt, callSpan, arity, inferAt, callbackAt, runtimeTypeAt, expandAliases} = context;
  switch (intrinsic.name) {
    case "server.authenticate": {
      arity(2, 2);
      const descriptor = expandAliases(inferAt(0));
      let credential = unknownType;
      if (!isNodeRouteInputType(descriptor) || descriptor.role !== "security") {
        context.typeError(`server.authenticate credential must be created by security, received ${describeType(descriptor)}`, argumentAt(0)?.span ?? callSpan);
      } else {
        credential = nodeRouteInputValue(descriptor);
      }
      const verifier = callbackAt(1, [credential], unknownType);
      const raw = verifier.kind === "function" || verifier.kind === "action" || verifier.kind === "intrinsic"
        ? expandAliases(verifier.result)
        : unknownType;
      let identity = unknownType;
      if (raw.kind !== "promise") {
        context.typeError("server.authenticate verify must return a Promise<Identity?>", argumentAt(1)?.span ?? callSpan);
      } else {
        const result = expandAliases(raw.value);
        if (result.kind !== "optional") {
          context.typeError(`server.authenticate verify must return an optional identity, received Promise<${describeType(result)}>`, argumentAt(1)?.span ?? callSpan);
        } else {
          identity = nonOptional(result);
        }
      }
      const inputs: ValueType = {kind: "object", fields: new Map([["credential", credential]])};
      return nodeProviderType(inputs, identity);
    }
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
      return nodeProviderType(emptyInputsType, connection);
    }
    default:
      return undefined;
  }
}
