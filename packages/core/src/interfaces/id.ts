import type { ModuleInterface } from "@velarscript/compiler";
import { stringType, boolType, apiFunction, moduleInterface } from "./types.ts";

/** `velar/id`. */
export const idModuleInterface: ModuleInterface = moduleInterface(new Map([
  ["uuid", apiFunction([], [], stringType)],
  ["isUuid", apiFunction(["value"], [stringType], boolType)],
]));
