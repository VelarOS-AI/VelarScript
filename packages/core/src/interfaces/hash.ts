import type { ModuleInterface } from "@velarscript/compiler";
import { stringType, apiFunction, moduleInterface } from "./types.ts";

/** `velar/hash`. */
export const hashModuleInterface: ModuleInterface = moduleInterface(new Map([
  ["sha256Text", apiFunction(["text"], [stringType], stringType)],
]));
