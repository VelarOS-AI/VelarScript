import type { ModuleInterface } from "@velarscript/compiler";
import { apiIntrinsic, unknownType, moduleInterface } from "./types.ts";

/** `velar/test`. */
export const testModuleInterface: ModuleInterface = moduleInterface(new Map([
  ["expect", apiIntrinsic("test.expect", ["actual"], [unknownType], unknownType)],
]));
