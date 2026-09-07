/**
 * `velar/path`
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `nodeModuleInterfaces` entry they build.
 */
import { type ModuleInterface } from "@velarscript/compiler";
import { boolType, functionType, listStringType, moduleInterface, stringType } from "./types.ts";

export const velarPathModuleEntry: readonly [string, ModuleInterface] = ["velar/path", moduleInterface(new Map([
  ["resolve", functionType(["parts"], [listStringType], stringType, 0)],
  ["join", functionType(["parts"], [listStringType], stringType, 0)],
  ["normalize", functionType(["path"], [stringType], stringType)],
  ["relative", functionType(["from", "to"], [stringType, stringType], stringType)],
  ["dirname", functionType(["path"], [stringType], stringType)],
  ["basename", functionType(["path"], [stringType], stringType)],
  ["extension", functionType(["path"], [stringType], stringType)],
  ["isAbsolute", functionType(["path"], [stringType], boolType)],
  ["contains", functionType(["root", "target"], [stringType, stringType], boolType)],
  ["toFileUrl", functionType(["path"], [stringType], stringType)],
  ["fromFileUrl", functionType(["url"], [stringType], stringType)],
]))];
