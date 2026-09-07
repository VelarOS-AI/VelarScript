/**
 * `velar/fs`
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `nodeModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { boolType, bytesType, functionType, listStringType, moduleInterface, nullType, numberType, object, promise, stringType } from "./types.ts";

const fileInfoType = object({
  name: stringType,
  kind: stringType,
  size: numberType,
  modifiedAt: numberType,
});
const fileWatchBatchType = object({
  paths: listStringType,
  rescan: boolType,
});
const fileWatcherType: ValueType = { kind: "named", name: "FileWatcher", identity: "velar/fs#type:FileWatcher" };

export const velarFilesystemModuleEntry: readonly [string, ModuleInterface] = ["velar/fs", moduleInterface(
  new Map([
    ["FileWatchBatch", { kind: "typeObject", name: "FileWatchBatch" }],
    ["FileWatcher", { kind: "typeObject", name: "FileWatcher" }],
    ["readText", functionType(["path", "maxBytes"], [stringType, numberType], promise(stringType), 1)],
    ["readBytes", functionType(["path", "maxBytes"], [stringType, numberType], promise(bytesType), 1)],
    ["createText", functionType(["path", "text"], [stringType, stringType], promise(nullType))],
    ["createBytes", functionType(["path", "bytes"], [stringType, bytesType], promise(nullType))],
    ["replaceTextIfMatches", functionType(["path", "expected", "replacement"], [stringType, stringType, stringType], promise(boolType))],
    ["writeText", functionType(["path", "text"], [stringType, stringType], promise(nullType))],
    ["writeBytes", functionType(["path", "bytes"], [stringType, bytesType], promise(nullType))],
    ["appendText", functionType(["path", "text"], [stringType, stringType], promise(nullType))],
    ["exists", functionType(["path"], [stringType], promise(boolType))],
    ["list", functionType(["path", "maxItems"], [stringType, numberType], promise(listStringType), 1)],
    ["info", functionType(["path"], [stringType], promise(optional(fileInfoType)))],
    ["canonical", functionType(["path"], [stringType], promise(stringType))],
    ["makeDirectory", functionType(["path"], [stringType], promise(nullType))],
    ["copyFile", functionType(["source", "target", "replace"], [stringType, stringType, boolType], promise(nullType), 2)],
    ["move", functionType(["source", "target", "replace"], [stringType, stringType, boolType], promise(nullType), 2)],
    ["removeFile", functionType(["path"], [stringType], promise(nullType))],
    ["watchFiles", functionType(["path", "recursive"], [stringType, boolType], promise(fileWatcherType), 1)],
  ]),
  new Map([
    ["FileWatcher", new Map([
      ["next", functionType([], [], promise(optional(fileWatchBatchType)))],
      ["close", functionType([], [], promise(nullType))],
    ])],
  ]),
  new Map([["FileWatcher", "velar/fs#type:FileWatcher"]]),
  new Map([["FileWatchBatch", fileWatchBatchType]]),
)];
