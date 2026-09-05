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
