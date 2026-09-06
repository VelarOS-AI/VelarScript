import type { ModuleInterface } from "@velarscript/compiler";
import { stringType, numberType, boolType, apiFunction, apiIntrinsic, unknownType, moduleInterface } from "./types.ts";

/** `velar/json`. */
export const jsonModuleInterface: ModuleInterface = moduleInterface(new Map([
  ["parse", apiIntrinsic("json.parse", ["text", "target"], [stringType, unknownType], unknownType, 1)],
  ["tryParse", apiIntrinsic("json.tryParse", ["text", "target", "fallback"], [stringType, unknownType, unknownType], unknownType, 1)],
  ["stringify", apiIntrinsic("json.stringify", ["value", "pretty"], [unknownType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
  ["stableStringify", apiIntrinsic("json.stableStringify", ["value", "pretty"], [unknownType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
  ["clone", apiIntrinsic("json.clone", ["value", "target"], [unknownType, unknownType], unknownType, 1)],
  ["isSerializable", apiFunction(["value"], [unknownType], boolType)],
]));
