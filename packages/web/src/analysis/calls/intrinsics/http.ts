/**
 * What 'velar/http' calls answer, and the one thing an HTTP request's options
 * are checked for: a body the surface can actually serialize.
 *
 * D115 P4 R3a: one family of 'inferWebIntrinsic', in the module that family
 * names.
 */
import { describeType, type CompilerIntrinsicAnalysisContext, type ValueType } from "@velarscript/compiler/extension";

export function inferHttpIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, argumentAt, callSpan, arity, inferAt } = context;
  switch (intrinsic.name) {
    case "http.request": {
      arity();
      let options: ValueType | null = null;
      for (const [index, expected] of intrinsic.parameters.entries()) {
        const actual = inferAt(index, expected);
        if (index === intrinsic.parameters.length - 1 && argumentAt(index)) options = actual;
      }
      const fields = options?.kind === "object" ? options.fields : null;
      const body = fields?.get("body");
      const expandedBody = body ? context.expandAliases(body) : null;
      const blob = expandedBody?.kind === "named" && expandedBody.name === "Blob";
      if (body && !context.isHttpFormBody(body) && !blob && context.jsonSerializable(body) === false) {
        const optionsExpression = argumentAt(intrinsic.parameters.length - 1);
        const bodyExpression = optionsExpression?.kind === "ObjectExpression"
          ? optionsExpression.properties.find((property) => property.kind === "ObjectProperty" && property.name === "body")?.value
          : null;
        context.typeError(`HTTP JSON bodies accept only records, Lists, enums, primitives, and optionals; received ${describeType(body)}`, bodyExpression?.span ?? optionsExpression?.span ?? callSpan);
      }
      return intrinsic.result;
    }
    default:
      return undefined;
  }
}
