import type { ModuleInterface } from "@velarscript/compiler";
import { nullType, stringType, numberType, durationType, apiFunction, apiIntrinsic, promise, unknownType, listUnknown, moduleInterface } from "./types.ts";

/** `velar/async`. */
export const asyncModuleInterface: ModuleInterface = moduleInterface(new Map([
  ["sleep", apiFunction(["duration"], [durationType], promise(nullType))],
  ["all", apiIntrinsic("async.all", ["values"], [unknownType], promise(unknownType))],
  ["race", apiIntrinsic("async.race", ["values"], [listUnknown], promise(unknownType))],
  ["timeout", apiIntrinsic("async.timeout", ["value", "duration", "message"], [promise(unknownType), durationType, stringType], promise(unknownType), 2)],
  ["retry", apiIntrinsic("async.retry", ["task", "attempts", "delay"], [unknownType, numberType, durationType], promise(unknownType), 1)],
  ["map", apiIntrinsic("async.map", ["values", "worker", "concurrency"], [listUnknown, unknownType, numberType], promise(listUnknown), 2)],
  ["series", apiIntrinsic("async.series", ["tasks"], [listUnknown], promise(listUnknown))],
]));
