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
