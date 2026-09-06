import type { ModuleInterface } from "@velarscript/compiler";
import { stringType, boolType, apiFunction, intrinsic, object, unknownType, moduleInterface } from "./types.ts";

const urlInfoType = object({
  href: stringType,
  protocol: stringType,
  host: stringType,
  hostname: stringType,
  port: stringType,
  path: stringType,
  query: { kind: "map", key: stringType, value: stringType },
  hash: stringType,
  origin: stringType,
});

/** `velar/url`. */
export const urlModuleInterface: ModuleInterface = moduleInterface(new Map([
  ["parse", apiFunction(["value", "base"], [stringType, stringType], urlInfoType, 1)],
  // join is a pure rest call, so its segments stay positional.
  ["join", intrinsic("url.join", [stringType], stringType)],
  ["query", apiFunction(["params"], [unknownType], stringType)],
  ["parseQuery", apiFunction(["value"], [stringType], { kind: "map", key: stringType, value: stringType })],
  ["withQuery", apiFunction(["value", "params"], [stringType, unknownType], stringType)],
  ["withHash", apiFunction(["value", "hash"], [stringType, stringType], stringType)],
  ["isExternal", apiFunction(["value", "base"], [stringType, stringType], boolType, 1)],
  ["encode", apiFunction(["value"], [stringType], stringType)],
  ["decode", apiFunction(["value"], [stringType], stringType)],
  ["normalize", apiFunction(["value", "base"], [stringType, stringType], stringType, 1)],
]));
