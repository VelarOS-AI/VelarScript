const __velarGraphNativeObject = globalThis.Object;
const __velarGraphNativeArray = globalThis.Array;
const __velarGraphNativeSet = globalThis.Set;
const __velarGraphNativeMap = globalThis.Map;
const __velarGraphNativeWeakSet = globalThis.WeakSet;
const __velarGraphNativeWeakMap = globalThis.WeakMap;
const __velarGraphNativeProxy = globalThis.Proxy;
const __velarGraphReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarGraphArrayIsArray = Object.getOwnPropertyDescriptor(Array, "isArray")?.value;
const __velarGraphArrayPrototype = Object.getOwnPropertyDescriptor(__velarGraphNativeArray, "prototype")?.value;
const __velarGraphArraySort = __velarGraphArrayPrototype && Object.getOwnPropertyDescriptor(__velarGraphArrayPrototype, "sort")?.value;
const __velarGraphObjectIs = Object.getOwnPropertyDescriptor(Object, "is")?.value;
const __velarGraphObjectFreeze = Object.getOwnPropertyDescriptor(Object, "freeze")?.value;
const __velarGraphObjectDefineProperty = Object.getOwnPropertyDescriptor(Object, "defineProperty")?.value;
const __velarGraphObjectIsExtensible = Object.getOwnPropertyDescriptor(Object, "isExtensible")?.value;
const __velarGraphObjectGetPrototypeOf = Object.getOwnPropertyDescriptor(Object, "getPrototypeOf")?.value;
const __velarGraphObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")?.value;
const __velarGraphObjectGetOwnPropertyNames = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyNames")?.value;
const __velarGraphObjectCreate = Object.getOwnPropertyDescriptor(Object, "create")?.value;
const __velarGraphSetPrototype = Object.getOwnPropertyDescriptor(__velarGraphNativeSet, "prototype")?.value;
const __velarGraphSetHas = __velarGraphSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphSetPrototype, "has")?.value;
const __velarGraphSetAdd = __velarGraphSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphSetPrototype, "add")?.value;
const __velarGraphSetDelete = __velarGraphSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphSetPrototype, "delete")?.value;
const __velarGraphSetClear = __velarGraphSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphSetPrototype, "clear")?.value;
const __velarGraphSetValues = __velarGraphSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphSetPrototype, "values")?.value;
const __velarGraphSetSize = __velarGraphSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphSetPrototype, "size")?.get;
const __velarGraphMapPrototype = Object.getOwnPropertyDescriptor(__velarGraphNativeMap, "prototype")?.value;
const __velarGraphMapHas = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "has")?.value;
const __velarGraphMapGet = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "get")?.value;
const __velarGraphMapSet = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "set")?.value;
const __velarGraphMapDelete = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "delete")?.value;
const __velarGraphMapClear = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "clear")?.value;
const __velarGraphMapValues = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "values")?.value;
const __velarGraphMapKeys = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "keys")?.value;
const __velarGraphMapSize = __velarGraphMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphMapPrototype, "size")?.get;
const __velarGraphWeakSetPrototype = Object.getOwnPropertyDescriptor(__velarGraphNativeWeakSet, "prototype")?.value;
const __velarGraphWeakSetHas = __velarGraphWeakSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakSetPrototype, "has")?.value;
const __velarGraphWeakSetAdd = __velarGraphWeakSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakSetPrototype, "add")?.value;
const __velarGraphWeakSetDelete = __velarGraphWeakSetPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakSetPrototype, "delete")?.value;
const __velarGraphWeakMapPrototype = Object.getOwnPropertyDescriptor(__velarGraphNativeWeakMap, "prototype")?.value;
const __velarGraphWeakMapHas = __velarGraphWeakMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakMapPrototype, "has")?.value;
const __velarGraphWeakMapGet = __velarGraphWeakMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakMapPrototype, "get")?.value;
const __velarGraphWeakMapSet = __velarGraphWeakMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakMapPrototype, "set")?.value;
const __velarGraphWeakMapDelete = __velarGraphWeakMapPrototype && Object.getOwnPropertyDescriptor(__velarGraphWeakMapPrototype, "delete")?.value;
const __velarGraphReflectGet = Object.getOwnPropertyDescriptor(Reflect, "get")?.value;
const __velarGraphReflectSet = Object.getOwnPropertyDescriptor(Reflect, "set")?.value;
const __velarGraphReflectHas = Object.getOwnPropertyDescriptor(Reflect, "has")?.value;
const __velarGraphReflectDeleteProperty = Object.getOwnPropertyDescriptor(Reflect, "deleteProperty")?.value;
function __velarGraphApply(operation, receiver, arguments_, label) {
  if (typeof operation !== "function" || typeof __velarGraphReflectApply !== "function") {
    throw new TypeError("The JavaScript " + label + " API is unavailable");
  }
  return __velarGraphReflectApply(operation, receiver, arguments_);
}
function __velarGraphCreateSet(values) {
  const output = new __velarGraphNativeSet();
  if (values !== undefined) for (const value of values) __velarGraphSetInsert(output, value);
  return output;
}
function __velarGraphCreateMap(values) {
  const output = new __velarGraphNativeMap();
  if (values !== undefined) for (const entry of values) __velarGraphMapWrite(output, entry[0], entry[1]);
  return output;
}
function __velarGraphCreateWeakSet() { return new __velarGraphNativeWeakSet(); }
function __velarGraphCreateWeakMap() { return new __velarGraphNativeWeakMap(); }
function __velarGraphSetContains(value, item) { return __velarGraphApply(__velarGraphSetHas, value, [item], "Set.has"); }
function __velarGraphSetInsert(value, item) { return __velarGraphApply(__velarGraphSetAdd, value, [item], "Set.add"); }
function __velarGraphSetRemove(value, item) { return __velarGraphApply(__velarGraphSetDelete, value, [item], "Set.delete"); }
function __velarGraphSetEmpty(value) { return __velarGraphApply(__velarGraphSetClear, value, [], "Set.clear"); }
function __velarGraphSetItems(value) { return __velarGraphApply(__velarGraphSetValues, value, [], "Set.values"); }
function __velarGraphSetCount(value) { return __velarGraphApply(__velarGraphSetSize, value, [], "Set.size"); }
function __velarGraphMapContains(value, key) { return __velarGraphApply(__velarGraphMapHas, value, [key], "Map.has"); }
function __velarGraphMapRead(value, key) { return __velarGraphApply(__velarGraphMapGet, value, [key], "Map.get"); }
function __velarGraphMapWrite(value, key, item) { return __velarGraphApply(__velarGraphMapSet, value, [key, item], "Map.set"); }
function __velarGraphMapRemove(value, key) { return __velarGraphApply(__velarGraphMapDelete, value, [key], "Map.delete"); }
function __velarGraphMapItems(value) { return __velarGraphApply(__velarGraphMapValues, value, [], "Map.values"); }
function __velarGraphMapEmpty(value) { return __velarGraphApply(__velarGraphMapClear, value, [], "Map.clear"); }
function __velarGraphMapKeyItems(value) { return __velarGraphApply(__velarGraphMapKeys, value, [], "Map.keys"); }
function __velarGraphMapCount(value) { return __velarGraphApply(__velarGraphMapSize, value, [], "Map.size"); }
function __velarGraphWeakSetContains(value, item) { return __velarGraphApply(__velarGraphWeakSetHas, value, [item], "WeakSet.has"); }
function __velarGraphWeakSetInsert(value, item) { return __velarGraphApply(__velarGraphWeakSetAdd, value, [item], "WeakSet.add"); }
function __velarGraphWeakSetRemove(value, item) { return __velarGraphApply(__velarGraphWeakSetDelete, value, [item], "WeakSet.delete"); }
function __velarGraphWeakMapContains(value, key) { return __velarGraphApply(__velarGraphWeakMapHas, value, [key], "WeakMap.has"); }
function __velarGraphWeakMapRead(value, key) { return __velarGraphApply(__velarGraphWeakMapGet, value, [key], "WeakMap.get"); }
function __velarGraphWeakMapWrite(value, key, item) { return __velarGraphApply(__velarGraphWeakMapSet, value, [key, item], "WeakMap.set"); }
function __velarGraphWeakMapRemove(value, key) { return __velarGraphApply(__velarGraphWeakMapDelete, value, [key], "WeakMap.delete"); }
function __velarGraphIsList(value) { return __velarGraphApply(__velarGraphArrayIsArray, __velarGraphNativeArray, [value], "Array.isArray"); }
// D114 F2: a plain record, as against a List, a Map, a Set or a class instance -- what a proxy is built over, what a report option must be, and which word a nested write is described with.
function __velarGraphIsRecord(value) { const prototype = __velarGraphPrototype(value); return prototype === null || prototype === __velarGraphNativeObject.prototype; }
function __velarGraphOrder(value, compare) { return __velarGraphApply(__velarGraphArraySort, value, [compare], "Array.sort"); }
function __velarGraphSame(left, right) { return __velarGraphApply(__velarGraphObjectIs, __velarGraphNativeObject, [left, right], "Object.is"); }
function __velarGraphFreeze(value) { return __velarGraphApply(__velarGraphObjectFreeze, __velarGraphNativeObject, [value], "Object.freeze"); }
function __velarGraphDefine(value, key, descriptor) { return __velarGraphApply(__velarGraphObjectDefineProperty, __velarGraphNativeObject, [value, key, descriptor], "Object.defineProperty"); }
function __velarGraphIsExtensible(value) { return __velarGraphApply(__velarGraphObjectIsExtensible, __velarGraphNativeObject, [value], "Object.isExtensible"); }
function __velarGraphPrototype(value) { return __velarGraphApply(__velarGraphObjectGetPrototypeOf, __velarGraphNativeObject, [value], "Object.getPrototypeOf"); }
function __velarGraphOwnDescriptor(value, key) { return __velarGraphApply(__velarGraphObjectGetOwnPropertyDescriptor, __velarGraphNativeObject, [value, key], "Object.getOwnPropertyDescriptor"); }
function __velarGraphOwnNames(value) { return __velarGraphApply(__velarGraphObjectGetOwnPropertyNames, __velarGraphNativeObject, [value], "Object.getOwnPropertyNames"); }
function __velarGraphCreateRecord() { return __velarGraphApply(__velarGraphObjectCreate, __velarGraphNativeObject, [null], "Object.create"); }
function __velarGraphGet(value, key, receiver) { return __velarGraphApply(__velarGraphReflectGet, null, [value, key, receiver], "Reflect.get"); }
function __velarGraphSet(value, key, item, receiver) { return __velarGraphApply(__velarGraphReflectSet, null, [value, key, item, receiver], "Reflect.set"); }
function __velarGraphHas(value, key) { return __velarGraphApply(__velarGraphReflectHas, null, [value, key], "Reflect.has"); }
function __velarGraphDelete(value, key) { return __velarGraphApply(__velarGraphReflectDeleteProperty, null, [value, key], "Reflect.deleteProperty"); }
