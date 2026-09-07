/**
 * `velar/files` — picking files, reading them, and handing one back as a download.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `webModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ModuleInterface } from "@velarscript/compiler";
import { boolType, fileArrayType, fileType, moduleInterface, namedFunction, nullType, numberType, object, promise, stringType } from "./types.ts";

const fileOptionsType = object({ accept: optional(stringType), multiple: optional(boolType) });

export const velarFilesModuleEntry: readonly [string, ModuleInterface] = ["velar/files", moduleInterface(new Map([
  ["pick", namedFunction(["options"], [fileOptionsType], promise(fileArrayType), 0)],
  ["readText", namedFunction(["file", "maxBytes"], [fileType, numberType], promise(stringType), 1)],
  ["readDataUrl", namedFunction(["file", "maxBytes"], [fileType, numberType], promise(stringType), 1)],
  ["download", namedFunction(["name", "data", "mime"], [stringType, stringType, stringType], nullType, 2)],
]))];
