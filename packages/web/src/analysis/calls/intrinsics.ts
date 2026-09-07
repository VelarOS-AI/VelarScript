/**
 * The Web surface's intrinsic typing, dispatched to the 'velar/*' module family
 * whose name the intrinsic carries.
 *
 * D115 P4 R3a: 'inferWebIntrinsic' was one 183-line switch over every intrinsic
 * of every Web module. An intrinsic's name is 'family.member', so the family is
 * what the switch was really keyed on, and each family now owns its own arms in
 * its own module. The exported name and its signature are unchanged: this is
 * the function 'compiler.ts' installs as the surface's 'inferIntrinsic'.
 */
import { type CompilerIntrinsicAnalysisContext, type ValueType } from "@velarscript/compiler/extension";
import { inferConfigIntrinsic } from "./intrinsics/config.ts";
import { inferFormsIntrinsic } from "./intrinsics/forms.ts";
import { inferHttpIntrinsic } from "./intrinsics/http.ts";
import { inferReactiveIntrinsic } from "./intrinsics/reactive.ts";
import { inferStorageIntrinsic } from "./intrinsics/storage.ts";
import { inferWebModuleIntrinsic } from "./intrinsics/web.ts";

export function inferWebIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const name = context.intrinsic.name;
  const dot = name.indexOf(".");
  switch (dot < 0 ? name : name.slice(0, dot)) {
    case "config": return inferConfigIntrinsic(context);
    case "forms": return inferFormsIntrinsic(context);
    case "http": return inferHttpIntrinsic(context);
    case "reactive": return inferReactiveIntrinsic(context);
    case "storage": return inferStorageIntrinsic(context);
    case "web": return inferWebModuleIntrinsic(context);
    default: return undefined;
  }
}
