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
