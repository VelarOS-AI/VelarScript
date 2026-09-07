/**
 * The Node intrinsics, dispatched to the module family that owns the name.
 *
 * D115 P4 R4a, the shape `packages/compiler/src/analysis/calls/intrinsics.ts`
 * already has. `inferNodeIntrinsic` is what leaves this directory: one call per
 * intrinsic, answering `undefined` for every name this extension does not own,
 * so Core goes on to whatever else may claim it.
 */
import { type CompilerIntrinsicAnalysisContext, type ValueType } from "@velarscript/compiler/extension";
import { inferServeIntrinsic } from "./intrinsics/serve.ts";

export function inferNodeIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  return context.intrinsic.name.startsWith("serve.") ? inferServeIntrinsic(context) : undefined;
}
