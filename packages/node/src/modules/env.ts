/**
 * `velar/env`
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `nodeModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ModuleInterface } from "@velarscript/compiler";
import { functionType, moduleInterface, stringType } from "./types.ts";

export const velarEnvironmentModuleEntry: readonly [string, ModuleInterface] = ["velar/env", moduleInterface(new Map([
  ["get", functionType(["name"], [stringType], optional(stringType))],
  ["require", functionType(["name"], [stringType], stringType)],
]))];
