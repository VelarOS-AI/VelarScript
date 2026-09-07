/**
 * What 'velar/config' calls answer: the published shape a project's public
 * configuration was declared with.
 *
 * D115 P4 R3a: one family of 'inferWebIntrinsic', in the module that family
 * names.
 */
import { type CompilerIntrinsicAnalysisContext, type ValueType } from "@velarscript/compiler/extension";

export function inferConfigIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, arity, runtimeTypeAt } = context;
  switch (intrinsic.name) {
    case "config.public":
      arity(1, 1);
      return runtimeTypeAt(0);
    default:
      return undefined;
  }
}
