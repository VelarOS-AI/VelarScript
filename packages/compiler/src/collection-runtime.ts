/** Canonical generated runtime for collection identity and runtime-Type traversal. */
export const VELAR_COLLECTION_IDENTITY_RUNTIME = String.raw`
const __velarCollectionNativeArray = globalThis.Array;
const __velarCollectionNativeMap = globalThis.Map;
const __velarCollectionNativeSet = globalThis.Set;
const __velarCollectionNativeObject = globalThis.Object;
const __velarCollectionNativeReflect = globalThis.Reflect;
const __velarCollectionNativeWeakMap = globalThis.WeakMap;
const __velarCollectionNativeTypeError = globalThis.TypeError;
const __velarCollectionGetOwnPropertyDescriptor = __velarCollectionNativeObject.getOwnPropertyDescriptor;
const __velarCollectionReflectApply = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeReflect, "apply")?.value;
const __velarCollectionArrayIsArray = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeArray, "isArray")?.value;
const __velarCollectionGetPrototypeOf = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "getPrototypeOf")?.value;
const __velarCollectionObjectPrototype = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "prototype")?.value;
const __velarCollectionMapPrototype = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeMap, "prototype")?.value;
const __velarCollectionSetPrototype = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeSet, "prototype")?.value;
const __velarCollectionMapSize = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapPrototype, "size")?.get;
const __velarCollectionSetSize = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionSetPrototype, "size")?.get;
function __velarCollectionHostCall(operation, receiver, arguments_) {
  if (typeof operation !== "function" || typeof __velarCollectionReflectApply !== "function") throw new __velarCollectionNativeTypeError("The JavaScript collection runtime is unavailable");
  return __velarCollectionReflectApply(operation, receiver, arguments_);
}
const __velarCollectionWeakMapPrototype = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeWeakMap, "prototype")?.value;
const __velarCollectionWeakMapGetOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionWeakMapPrototype, "get")?.value;
const __velarCollectionWeakMapSetOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionWeakMapPrototype, "set")?.value;
const __velarCollectionBrands = new __velarCollectionNativeWeakMap();
// The only unforgeable, cross-realm Map/Set test JavaScript offers is invoking
// the prototype 'size' getter and observing whether it throws, and a thrown and
// caught exception costs roughly 1.8us -- paid by every Set membership test,
// which probes Map first. Internal slots are fixed at construction, so the
// verdict can never change for a given object: probe once, then answer from a
// WeakMap. 0 = neither, 1 = Map, 2 = Set.
function __velarCollectionBrand(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return 0;
  const known = __velarCollectionHostCall(__velarCollectionWeakMapGetOperation, __velarCollectionBrands, [value]);
  if (known !== undefined) return known;
  let brand = 0;
  try { __velarCollectionHostCall(__velarCollectionMapSize, value, []); brand = 1; }
  catch {
    try { __velarCollectionHostCall(__velarCollectionSetSize, value, []); brand = 2; }
    catch { brand = 0; }
  }
  __velarCollectionHostCall(__velarCollectionWeakMapSetOperation, __velarCollectionBrands, [value, brand]);
  return brand;
}
function __velarIsMap(value) {
  return __velarCollectionBrand(value) === 1;
}
function __velarIsSet(value) {
  return __velarCollectionBrand(value) === 2;
}
function __velarIsRecord(value) {
  if (value === null || typeof value !== "object" || __velarCollectionHostCall(__velarCollectionArrayIsArray, __velarCollectionNativeArray, [value])) return false;
  const prototype = __velarCollectionHostCall(__velarCollectionGetPrototypeOf, __velarCollectionNativeObject, [value]);
  return prototype === __velarCollectionObjectPrototype || prototype === null;
}
`.trimStart();

/** Additional host traversal used only when a module emits runtime collection Types. */
export const VELAR_COLLECTION_TYPE_RUNTIME = String.raw`
const __velarCollectionOwnNames = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "getOwnPropertyNames")?.value;
const __velarCollectionOwnSymbols = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "getOwnPropertySymbols")?.value;
const __velarCollectionOwnKeys = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeReflect, "ownKeys")?.value;
const __velarCollectionMapEntries = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapPrototype, "entries")?.value;
const __velarCollectionSetValues = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionSetPrototype, "values")?.value;
const __velarCollectionMapIteratorPrototype = __velarCollectionHostCall(__velarCollectionGetPrototypeOf, __velarCollectionNativeObject, [__velarCollectionHostCall(__velarCollectionMapEntries, new __velarCollectionNativeMap(), [])]);
const __velarCollectionSetIteratorPrototype = __velarCollectionHostCall(__velarCollectionGetPrototypeOf, __velarCollectionNativeObject, [__velarCollectionHostCall(__velarCollectionSetValues, new __velarCollectionNativeSet(), [])]);
const __velarCollectionMapIteratorNext = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapIteratorPrototype, "next")?.value;
const __velarCollectionSetIteratorNext = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionSetIteratorPrototype, "next")?.value;
function __velarCollectionMapTypeIterator(value) { return __velarCollectionHostCall(__velarCollectionMapEntries, value, []); }
function __velarCollectionSetTypeIterator(value) { return __velarCollectionHostCall(__velarCollectionSetValues, value, []); }
function __velarCollectionMapTypeNext(iterator) { return __velarCollectionHostCall(__velarCollectionMapIteratorNext, iterator, []); }
function __velarCollectionSetTypeNext(iterator) { return __velarCollectionHostCall(__velarCollectionSetIteratorNext, iterator, []); }
`.trimStart();

/** Host operations required by ordinary List validation and receiver methods. */
export const VELAR_COLLECTION_LIST_RUNTIME = String.raw`
const __velarCollectionListNativeNumber = globalThis.Number;
const __velarCollectionListNativeMath = globalThis.Math;
const __velarCollectionListNativeRangeError = globalThis.RangeError;
const __velarCollectionListArrayPrototype = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeArray, "prototype")?.value;
const __velarCollectionListOwnNamesOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "getOwnPropertyNames")?.value;
const __velarCollectionListOwnSymbolsOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "getOwnPropertySymbols")?.value;
const __velarCollectionListDefinePropertyOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "defineProperty")?.value;
const __velarCollectionListObjectIsOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "is")?.value;
const __velarCollectionListIntegerOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListNativeNumber, "isInteger")?.value;
const __velarCollectionListNaNOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListNativeNumber, "isNaN")?.value;
const __velarCollectionListFiniteOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListNativeNumber, "isFinite")?.value;
const __velarCollectionListMaximumOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListNativeMath, "max")?.value;
const __velarCollectionListMinimumOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListNativeMath, "min")?.value;
const __velarCollectionListJoinOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListArrayPrototype, "join")?.value;
const __velarCollectionListSortOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListArrayPrototype, "sort")?.value;
const __velarCollectionListReverseOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListArrayPrototype, "reverse")?.value;
function __velarCollectionListIsArray(value) { return __velarCollectionHostCall(__velarCollectionArrayIsArray, __velarCollectionNativeArray, [value]); }
function __velarCollectionListGetOwnPropertyDescriptor(value, key) { return __velarCollectionHostCall(__velarCollectionGetOwnPropertyDescriptor, __velarCollectionNativeObject, [value, key]); }
function __velarCollectionListOwnNames(value) { return __velarCollectionHostCall(__velarCollectionListOwnNamesOperation, __velarCollectionNativeObject, [value]); }
function __velarCollectionListOwnSymbols(value) { return __velarCollectionHostCall(__velarCollectionListOwnSymbolsOperation, __velarCollectionNativeObject, [value]); }
function __velarCollectionListDefineProperty(value, key, descriptor) { return __velarCollectionHostCall(__velarCollectionListDefinePropertyOperation, __velarCollectionNativeObject, [value, key, descriptor]); }
function __velarCollectionListObjectIs(left, right) { return __velarCollectionHostCall(__velarCollectionListObjectIsOperation, __velarCollectionNativeObject, [left, right]); }
function __velarCollectionListIsInteger(value) { return __velarCollectionHostCall(__velarCollectionListIntegerOperation, __velarCollectionListNativeNumber, [value]); }
function __velarCollectionListIsNaN(value) { return __velarCollectionHostCall(__velarCollectionListNaNOperation, __velarCollectionListNativeNumber, [value]); }
function __velarCollectionListIsFinite(value) { return __velarCollectionHostCall(__velarCollectionListFiniteOperation, __velarCollectionListNativeNumber, [value]); }
function __velarCollectionListMaximum(...values) { return __velarCollectionHostCall(__velarCollectionListMaximumOperation, __velarCollectionListNativeMath, values); }
function __velarCollectionListMinimum(...values) { return __velarCollectionHostCall(__velarCollectionListMinimumOperation, __velarCollectionListNativeMath, values); }
function __velarCollectionListHostJoin(value, separator) { return __velarCollectionHostCall(__velarCollectionListJoinOperation, value, [separator]); }
function __velarCollectionListHostSort(value, compare) { return __velarCollectionHostCall(__velarCollectionListSortOperation, value, [compare]); }
function __velarCollectionListHostReverse(value) { return __velarCollectionHostCall(__velarCollectionListReverseOperation, value, []); }
`.trimStart();

/** Host operations required by ordinary Set and Map construction and receiver methods. */
export const VELAR_COLLECTION_SET_MAP_RUNTIME = String.raw`
const __velarCollectionSetMapNativeRangeError = globalThis.RangeError;
const __velarCollectionSetMapFreezeOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "freeze")?.value;
const __velarCollectionSetAddOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionSetPrototype, "add")?.value;
const __velarCollectionSetHasOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionSetPrototype, "has")?.value;
const __velarCollectionSetDeleteOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionSetPrototype, "delete")?.value;
const __velarCollectionSetClearOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionSetPrototype, "clear")?.value;
const __velarCollectionSetValuesOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionSetPrototype, "values")?.value;
const __velarCollectionMapGetOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapPrototype, "get")?.value;
const __velarCollectionMapSetOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapPrototype, "set")?.value;
const __velarCollectionMapHasOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapPrototype, "has")?.value;
const __velarCollectionMapDeleteOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapPrototype, "delete")?.value;
const __velarCollectionMapClearOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapPrototype, "clear")?.value;
const __velarCollectionMapKeysOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapPrototype, "keys")?.value;
const __velarCollectionMapValuesOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapPrototype, "values")?.value;
const __velarCollectionMapEntriesOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionMapPrototype, "entries")?.value;
const __velarCollectionSetMapMapIteratorPrototype = __velarCollectionHostCall(__velarCollectionGetPrototypeOf, __velarCollectionNativeObject, [__velarCollectionHostCall(__velarCollectionMapEntriesOperation, new __velarCollectionNativeMap(), [])]);
const __velarCollectionSetMapSetIteratorPrototype = __velarCollectionHostCall(__velarCollectionGetPrototypeOf, __velarCollectionNativeObject, [__velarCollectionHostCall(__velarCollectionSetValuesOperation, new __velarCollectionNativeSet(), [])]);
const __velarCollectionSetMapMapIteratorNext = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionSetMapMapIteratorPrototype, "next")?.value;
const __velarCollectionSetMapSetIteratorNext = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionSetMapSetIteratorPrototype, "next")?.value;
function __velarCollectionSetMapFreeze(value) { return __velarCollectionHostCall(__velarCollectionSetMapFreezeOperation, __velarCollectionNativeObject, [value]); }
function __velarCollectionSetMapSetSize(value) { return __velarCollectionHostCall(__velarCollectionSetSize, value, []); }
function __velarCollectionSetMapMapSize(value) { return __velarCollectionHostCall(__velarCollectionMapSize, value, []); }
function __velarCollectionSetMapSetAdd(value, item) { return __velarCollectionHostCall(__velarCollectionSetAddOperation, value, [item]); }
function __velarCollectionSetMapSetHas(value, item) { return __velarCollectionHostCall(__velarCollectionSetHasOperation, value, [item]); }
function __velarCollectionSetMapSetDelete(value, item) { return __velarCollectionHostCall(__velarCollectionSetDeleteOperation, value, [item]); }
function __velarCollectionSetMapSetClear(value) { return __velarCollectionHostCall(__velarCollectionSetClearOperation, value, []); }
function __velarCollectionSetMapSetValues(value) { return __velarCollectionHostCall(__velarCollectionSetValuesOperation, value, []); }
function __velarCollectionSetMapSetNext(iterator) { return __velarCollectionHostCall(__velarCollectionSetMapSetIteratorNext, iterator, []); }
function __velarCollectionSetMapMapGet(value, key) { return __velarCollectionHostCall(__velarCollectionMapGetOperation, value, [key]); }
function __velarCollectionSetMapMapSet(value, key, item) { return __velarCollectionHostCall(__velarCollectionMapSetOperation, value, [key, item]); }
function __velarCollectionSetMapMapHas(value, key) { return __velarCollectionHostCall(__velarCollectionMapHasOperation, value, [key]); }
function __velarCollectionSetMapMapDelete(value, key) { return __velarCollectionHostCall(__velarCollectionMapDeleteOperation, value, [key]); }
function __velarCollectionSetMapMapClear(value) { return __velarCollectionHostCall(__velarCollectionMapClearOperation, value, []); }
function __velarCollectionSetMapMapKeys(value) { return __velarCollectionHostCall(__velarCollectionMapKeysOperation, value, []); }
function __velarCollectionSetMapMapValues(value) { return __velarCollectionHostCall(__velarCollectionMapValuesOperation, value, []); }
function __velarCollectionSetMapMapEntries(value) { return __velarCollectionHostCall(__velarCollectionMapEntriesOperation, value, []); }
function __velarCollectionSetMapMapNext(iterator) { return __velarCollectionHostCall(__velarCollectionSetMapMapIteratorNext, iterator, []); }
`.trimStart();

/** Host operations required by ordinary Record validation and receiver methods. */
export const VELAR_COLLECTION_RECORD_RUNTIME = String.raw`
const __velarCollectionRecordNativeRangeError = globalThis.RangeError;
const __velarCollectionRecordOwnNamesOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "getOwnPropertyNames")?.value;
const __velarCollectionRecordOwnSymbolsOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "getOwnPropertySymbols")?.value;
const __velarCollectionRecordDefinePropertyOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "defineProperty")?.value;
const __velarCollectionRecordObjectIsOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "is")?.value;
const __velarCollectionRecordDeletePropertyOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeReflect, "deleteProperty")?.value;
const __velarCollectionRecordFreezeOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "freeze")?.value;
function __velarCollectionRecordGetOwnPropertyDescriptor(value, key) { return __velarCollectionHostCall(__velarCollectionGetOwnPropertyDescriptor, __velarCollectionNativeObject, [value, key]); }
function __velarCollectionRecordOwnNames(value) { return __velarCollectionHostCall(__velarCollectionRecordOwnNamesOperation, __velarCollectionNativeObject, [value]); }
function __velarCollectionRecordOwnSymbols(value) { return __velarCollectionHostCall(__velarCollectionRecordOwnSymbolsOperation, __velarCollectionNativeObject, [value]); }
function __velarCollectionRecordDefineProperty(value, key, descriptor) { return __velarCollectionHostCall(__velarCollectionRecordDefinePropertyOperation, __velarCollectionNativeObject, [value, key, descriptor]); }
function __velarCollectionRecordObjectIs(left, right) { return __velarCollectionHostCall(__velarCollectionRecordObjectIsOperation, __velarCollectionNativeObject, [left, right]); }
function __velarCollectionRecordDeleteProperty(value, key) { return __velarCollectionHostCall(__velarCollectionRecordDeletePropertyOperation, __velarCollectionNativeReflect, [value, key]); }
function __velarCollectionRecordFreeze(value) { return __velarCollectionHostCall(__velarCollectionRecordFreezeOperation, __velarCollectionNativeObject, [value]); }
`.trimStart();

export const VELAR_COLLECTION_HOST_MODULE = "velar/compiler-runtime-collections-v1";

/** Names consumed by module-local collection algorithms from the shared host ABI. */
export const VELAR_COLLECTION_HOST_EXPORTS = [
  "__velarCollectionNativeArray",
  "__velarCollectionNativeMap",
  "__velarCollectionNativeSet",
  "__velarCollectionNativeObject",
  "__velarCollectionNativeTypeError",
  "__velarCollectionGetPrototypeOf",
  "__velarCollectionObjectPrototype",
  "__velarCollectionHostCall",
  "__velarIsMap",
  "__velarIsSet",
  "__velarIsRecord",
  "__velarCollectionListNativeRangeError",
  "__velarCollectionListIsArray",
  "__velarCollectionListGetOwnPropertyDescriptor",
  "__velarCollectionListOwnNames",
  "__velarCollectionListOwnSymbols",
  "__velarCollectionListDefineProperty",
  "__velarCollectionListObjectIs",
  "__velarCollectionListIsInteger",
  "__velarCollectionListIsNaN",
  "__velarCollectionListIsFinite",
  "__velarCollectionListMaximum",
  "__velarCollectionListMinimum",
  "__velarCollectionListHostJoin",
  "__velarCollectionListHostSort",
  "__velarCollectionListHostReverse",
  "__velarCollectionSetMapNativeRangeError",
  "__velarCollectionSetMapFreeze",
  "__velarCollectionSetMapSetSize",
  "__velarCollectionSetMapMapSize",
  "__velarCollectionSetMapSetAdd",
  "__velarCollectionSetMapSetHas",
  "__velarCollectionSetMapSetDelete",
  "__velarCollectionSetMapSetClear",
  "__velarCollectionSetMapSetValues",
  "__velarCollectionSetMapSetNext",
  "__velarCollectionSetMapMapGet",
  "__velarCollectionSetMapMapSet",
  "__velarCollectionSetMapMapHas",
  "__velarCollectionSetMapMapDelete",
  "__velarCollectionSetMapMapClear",
  "__velarCollectionSetMapMapKeys",
  "__velarCollectionSetMapMapValues",
  "__velarCollectionSetMapMapEntries",
  "__velarCollectionSetMapMapNext",
  "__velarCollectionRecordNativeRangeError",
  "__velarCollectionRecordGetOwnPropertyDescriptor",
  "__velarCollectionRecordOwnNames",
  "__velarCollectionRecordOwnSymbols",
  "__velarCollectionRecordDefineProperty",
  "__velarCollectionRecordObjectIs",
  "__velarCollectionRecordDeleteProperty",
  "__velarCollectionRecordFreeze",
] as const;

/** Project-shared immutable host operations for module-local collection algorithms. */
export const VELAR_COLLECTION_HOST_MODULE_SOURCE = String.raw`
${VELAR_COLLECTION_IDENTITY_RUNTIME}
${VELAR_COLLECTION_LIST_RUNTIME}
${VELAR_COLLECTION_SET_MAP_RUNTIME}
${VELAR_COLLECTION_RECORD_RUNTIME}
export {
${VELAR_COLLECTION_HOST_EXPORTS.map((name) => `  ${name},`).join("\n")}
};
`.trimStart();
