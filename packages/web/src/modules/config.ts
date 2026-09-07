/**
 * `velar/config` — the validated, manifest-declared public configuration a build supplies.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `webModuleInterfaces` entry they build.
 */
import { type ModuleInterface } from "@velarscript/compiler";
import { arrayString, boolType, moduleInterface, namedFunction, namedIntrinsic, stringType, unknownType } from "./types.ts";

export const velarConfigModuleEntry: readonly [string, ModuleInterface] = ["velar/config", moduleInterface(new Map([
  ["publicConfig", namedIntrinsic("config.public", ["target"], [unknownType], unknownType)],
  ["has", namedFunction(["key"], [stringType], boolType)],
  ["keys", namedFunction([], [], arrayString)],
]))];
