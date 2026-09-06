import type { ValueType } from "@velarscript/compiler";
import { stringType, nullType, optionalStringType, functionType, promiseOf, moduleInterface } from "./types.ts";

// `velar/secure-storage` — the named credential slots `desktop.permissions
// .secureStorage` declares. A name outside that list fails at the call, and a
// stored value never leaves this module in an error, a log line, or a
// diagnostic.
export const secureStorageModuleInterface = moduleInterface(new Map<string, ValueType>([
  ["set", functionType([stringType, stringType], promiseOf(nullType))],
  ["get", functionType([stringType], promiseOf(optionalStringType))],
  ["remove", functionType([stringType], promiseOf(nullType))],
]));
