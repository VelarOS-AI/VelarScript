/**
 * `velar/storage` — the local, session and scoped key/value areas, the database, and their error classes.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `webModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ClassInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import {
  arrayString,
  boolType,
  bytesType,
  cleanupType,
  moduleInterface,
  namedFunction,
  namedIntrinsic,
  nullType,
  numberType,
  object,
  promise,
  stringType,
  unknownType,
} from "./types.ts";

function createStorageType(): ValueType {
  const common = (): Map<string, ValueType> => new Map([
    ["get", namedIntrinsic("storage.get", ["key", "target", "fallback", "maxBytes"], [stringType, unknownType, unknownType, numberType], unknownType, 2)],
    ["set", namedIntrinsic("storage.set", ["key", "value", "maxBytes"], [stringType, unknownType, numberType], nullType, 2)],
    ["has", namedFunction(["key"], [stringType], boolType)],
    ["keys", namedFunction([], [], arrayString)],
    ["remove", namedFunction(["key"], [stringType], nullType)],
    ["clear", namedFunction([], [], nullType)],
    ["watch", namedIntrinsic("storage.watch", ["key", "target", "callback", "maxBytes"], [stringType, unknownType, unknownType, numberType], cleanupType, 3)],
  ]);
  const scoped: ValueType = { kind: "object", fields: common() };
  const fields = common();
  fields.set("scope", namedFunction(["name"], [stringType], scoped));
  return { kind: "object", fields };
}

const storageType = createStorageType();
const storageBatchChangeType = object({ key: stringType, bytes: optional(bytesType) });
const databaseType = object({
  get: namedIntrinsic("storage.databaseGet", ["key", "target", "fallback", "maxBytes"], [stringType, unknownType, unknownType, numberType], promise(unknownType), 2),
  set: namedIntrinsic("storage.set", ["key", "value", "maxBytes"], [stringType, unknownType, numberType], promise(nullType), 2),
  getBytes: namedFunction(["key", "fallback", "maxBytes"], [stringType, optional(bytesType), numberType], promise(optional(bytesType)), 1),
  setBytes: namedFunction(["key", "value", "maxBytes"], [stringType, bytesType, numberType], promise(nullType), 2),
  batch: namedFunction(["changes"], [{ kind: "list", element: storageBatchChangeType }], promise(nullType)),
  has: namedFunction(["key"], [stringType], promise(boolType)),
  keys: namedFunction([], [], promise(arrayString)),
  remove: namedFunction(["key"], [stringType], promise(nullType)),
  clear: namedFunction([], [], promise(nullType)),
});
const storageQuotaErrorIdentity = "velar/storage#class:StorageQuotaError";
const storageTransactionErrorIdentity = "velar/storage#class:StorageTransactionError";
const storageUpgradeErrorIdentity = "velar/storage#class:StorageUpgradeError";
function storageErrorClass(identity: string): ClassInfo {
  return {
    identity, parameters: [stringType], parameterNames: ["message"], requiredParameters: 0,
    base: "Error", abstract: false, fields: new Map(), getters: new Set(), abstractGetters: new Set(),
    methods: new Map(), abstractMethods: new Set(), staticFields: new Map(), staticGetters: new Set(), staticMethods: new Map(),
  };
}

export const velarStorageModuleEntry: readonly [string, ModuleInterface] = ["velar/storage", moduleInterface(new Map([
  ["storage", storageType],
  ["session", storageType],
  ["database", namedFunction(["name"], [stringType], databaseType)],
  ["StorageQuotaError", { kind: "classConstructor", name: "StorageQuotaError", identity: storageQuotaErrorIdentity }],
  ["StorageTransactionError", { kind: "classConstructor", name: "StorageTransactionError", identity: storageTransactionErrorIdentity }],
  ["StorageUpgradeError", { kind: "classConstructor", name: "StorageUpgradeError", identity: storageUpgradeErrorIdentity }],
]), new Map([
  ["StorageQuotaError", storageErrorClass(storageQuotaErrorIdentity)],
  ["StorageTransactionError", storageErrorClass(storageTransactionErrorIdentity)],
  ["StorageUpgradeError", storageErrorClass(storageUpgradeErrorIdentity)],
]))];
