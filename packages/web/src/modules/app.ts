/**
 * `velar/app` — the application error report, and explicit ownership of the handler.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `webModuleInterfaces` entry they build.
 */
import { type ModuleInterface } from "@velarscript/compiler";
import { cleanupType, errorType, functionType, moduleInterface, namedFunction, nullType, numberType, object, stringType, unknownType } from "./types.ts";

const appErrorType = object({
  error: errorType,
  phase: stringType,
  detail: stringType,
  component: stringType,
  timestamp: numberType,
});

export const velarAppModuleEntry: readonly [string, ModuleInterface] = ["velar/app", moduleInterface(new Map([
  ["onError", namedFunction(["handler"], [functionType([appErrorType], unknownType)], cleanupType)],
  ["reportError", namedFunction(["error", "phase", "detail"], [errorType, stringType, stringType], nullType, 1)],
]))];
