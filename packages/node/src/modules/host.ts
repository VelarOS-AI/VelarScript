/**
 * `velar/host`
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `nodeModuleInterfaces` entry they build.
 */
import { type ModuleInterface } from "@velarscript/compiler";
import { functionType, moduleInterface, nullType, numberType, promise } from "./types.ts";

export const velarHostModuleEntry: readonly [string, ModuleInterface] = ["velar/host", moduleInterface(new Map([
  ["exit", functionType(["code"], [numberType], nullType, 0)],
  ["onShutdown", functionType(["cleanup"], [functionType([], [], promise(nullType))], nullType)],
]))];
