/**
 * The one reactive intrinsic the Web surface still types: a call written around
 * the retired 'computed(...)'.
 *
 * D115 P4 R3a: one family of 'inferWebIntrinsic', in the module that family
 * names.
 */
import { anyType, unknownType, type CompilerIntrinsicAnalysisContext, type ValueType } from "@velarscript/compiler/extension";
import { RETIRED_ACCESSOR_INTRINSIC } from "../../retired-accessors.ts";

export function inferReactiveIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, arity, callbackAt } = context;
  switch (intrinsic.name) {
    case RETIRED_ACCESSOR_INTRINSIC: {
      // A call around the retired `computed(...)` returns the reader it
      // always returned, carrying the callback's own result so an annotated
      // declaration reads its migration message and nothing else. Nothing else
      // is checked here — the shape is already refused, and a second complaint
      // about a spelling that no longer exists teaches the author nothing.
      arity(1, 1);
      const callback = callbackAt(0, [], unknownType);
      const result = callback.kind === "function" || callback.kind === "intrinsic" || callback.kind === "action"
        ? callback.result
        : callback.kind === "any" ? anyType : unknownType;
      return { kind: "function", parameters: [], requiredParameters: 0, result };
    }
    default:
      return undefined;
  }
}
