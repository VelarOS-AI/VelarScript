function __velarListTypeIs(value, check) {
  if (!__velarCollectionHostCall(__velarCollectionArrayIsArray, __velarCollectionNativeArray, [value]) || value.length > 1000000 || __velarCollectionHostCall(__velarCollectionOwnSymbols, __velarCollectionNativeObject, [value]).length > 0 || __velarCollectionHostCall(__velarCollectionOwnNames, __velarCollectionNativeObject, [value]).length !== value.length + 1) return false;
  const lengthDescriptor = __velarCollectionHostCall(__velarCollectionGetOwnPropertyDescriptor, __velarCollectionNativeObject, [value, "length"]);
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable || lengthDescriptor.configurable || !("value" in lengthDescriptor)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarCollectionHostCall(__velarCollectionGetOwnPropertyDescriptor, __velarCollectionNativeObject, [value, index]);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor) || !check(descriptor.value)) return false;
  }
  return true;
}

function __velarSetTypeIs(value, check) {
  if (!__velarIsSet(value) || __velarCollectionHostCall(__velarCollectionSetSize, value, []) > 1000000) return false;
  const iterator = __velarCollectionSetTypeIterator(value);
  while (true) { const step = __velarCollectionSetTypeNext(iterator); if (step.done) break; if (!check(step.value)) return false; }
  return true;
}

function __velarMapTypeIs(value, check) {
  if (!__velarIsMap(value) || __velarCollectionHostCall(__velarCollectionMapSize, value, []) > 1000000) return false;
  const iterator = __velarCollectionMapTypeIterator(value);
  while (true) { const step = __velarCollectionMapTypeNext(iterator); if (step.done) break; const entry = step.value; if (!check(entry[0], entry[1])) return false; }
  return true;
}

function __velarRecordTypeIs(value, check) {
  if (!__velarIsRecord(value)) return false;
  const keys = __velarCollectionHostCall(__velarCollectionOwnKeys, __velarCollectionNativeReflect, [value]);
  if (keys.length > 1000000) return false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") return false;
    const descriptor = __velarCollectionHostCall(__velarCollectionGetOwnPropertyDescriptor, __velarCollectionNativeObject, [value, key]);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor) || !check(descriptor.value)) return false;
  }
  return true;
}
