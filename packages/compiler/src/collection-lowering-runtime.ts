import { VELAR_COLLECTION_HOST_EXPORTS, VELAR_COLLECTION_HOST_MODULE } from "./collection-runtime.ts";
import { VELAR_REACTIVE_BRIDGE_MODULE } from "./reactive-bridge-runtime.ts";

export const VELAR_COLLECTION_LOWERING_MODULE = "velar/compiler-runtime-collection-lowering-v1";

/** Stateless collection algorithms shared by project compilation. */
export const VELAR_COLLECTION_LOWERING_EXPORTS = [
  "__velarMaxCollectionItems",
  "__velarCollectionValue",
  "__velarSameValueZero",
  "__velarEquals",
  "__velarValidateDenseList",
  "__velarReactiveListIterator",
  "__velarReactiveSetIterator",
  "__velarReactiveMapKeyIterator",
  "__velarReactiveRecordIterator",
  "__velarCollectionIterator",
  "__velarCollectionPairIterator",
  "__velarCopyList",
  "__velarOrderedListValue",
  "__velarCreateList",
  "__velarCreateListAsync",
  "__velarCreateSet",
  "__velarCreateMap",
  "__velarCollectionSize",
  "__velarCollectionGet",
  "__velarCollectionSlice",
  "__velarIndex",
  "__velarOptionalIndex",
  "__velarSetIndex",
  "__velarListAppend",
  "__velarListExtend",
  "__velarListInsert",
  "__velarListRemove",
  "__velarListPop",
  "__velarListCopy",
  "__velarListCount",
  "__velarListIndex",
  "__velarListFind",
  "__velarListMap",
  "__velarListFilter",
  "__velarListReduce",
  "__velarListEvery",
  "__velarListSome",
  "__velarListSum",
  "__velarListExtremum",
  "__velarListMin",
  "__velarListMax",
  "__velarListJoin",
  "__velarListSorted",
  "__velarListReversed",
  "__velarSetAdd",
  "__velarSetUpdate",
  "__velarSetCopy",
  "__velarMapSet",
  "__velarMapUpdate",
  "__velarMapCopy",
  "__velarRecordFields",
  "__velarRecordSet",
  "__velarRecordCopy",
  "__velarCollectionHas",
  "__velarContains",
  "__velarCollectionRemove",
  "__velarCollectionClear",
  "__velarCollectionKeys",
  "__velarCollectionValues",
  "__velarCollectionEntries",
  "__velarOptionalCollection",
] as const;

export const VELAR_COLLECTION_LOWERING_DEPENDENCIES = [
  VELAR_COLLECTION_HOST_MODULE,
  VELAR_REACTIVE_BRIDGE_MODULE,
] as const;

export const VELAR_COLLECTION_LOWERING_RUNTIME = String.raw`
const __velarMaxCollectionItems = 1000000;
const __velarCollectionValue = value => value === undefined ? null : value;
const __velarSameValueZero = (left, right) => { left = __velarCollectionValue(left); right = __velarCollectionValue(right); return left === right || (left !== left && right !== right); };
const __velarListNativeWeakMap = globalThis.WeakMap;
const __velarListWeakMapPrototype = __velarCollectionListGetOwnPropertyDescriptor(__velarListNativeWeakMap, "prototype")?.value;
const __velarListWeakMapGetOperation = __velarCollectionListGetOwnPropertyDescriptor(__velarListWeakMapPrototype, "get")?.value;
const __velarListWeakMapSetOperation = __velarCollectionListGetOwnPropertyDescriptor(__velarListWeakMapPrototype, "set")?.value;
// Ownership is the memo of a completed dense validation: the registry records
// the element count the List had when it was proved dense. Any foreign length
// change -- an unsafe push, a length assignment, a truncation -- breaks the
// match and sends the List back through full validation, so a List that
// crossed an unsafe boundary is never trusted on the strength of an older
// check. Without the memo every index read on a List the compiler did not
// build (a literal, anything velar/collections returns) revalidated every
// element, making 'for i in range(n): values[i]' quadratic.
const __velarOwnedLists = new __velarListNativeWeakMap();
function __velarListOwnedLength(value) { return __velarCollectionHostCall(__velarListWeakMapGetOperation, __velarOwnedLists, [value]); }
function __velarMarkOwnedList(value) { __velarCollectionHostCall(__velarListWeakMapSetOperation, __velarOwnedLists, [value, value.length]); return value; }
function __velarValidateDenseList(value, name) {
  value = __velarReactiveRaw(value);
  if (!__velarCollectionListIsArray(value) || value.length > __velarMaxCollectionItems || __velarCollectionListOwnSymbols(value).length > 0 || __velarCollectionListOwnNames(value).length !== value.length + 1) {
    throw new __velarCollectionNativeTypeError(name + " requires a dense VelarScript List");
  }
  const lengthDescriptor = __velarCollectionListGetOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable || lengthDescriptor.configurable || !("value" in lengthDescriptor)) throw new __velarCollectionNativeTypeError(name + " requires an ordinary mutable List length");
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarCollectionListGetOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) throw new __velarCollectionNativeTypeError(name + " requires ordinary mutable List data elements");
  }
  return __velarMarkOwnedList(value);
}
function __velarValidateOwnedList(value, name) {
  value = __velarReactiveRaw(value);
  if (!__velarCollectionListIsArray(value) || value.length > __velarMaxCollectionItems) throw new __velarCollectionNativeTypeError(name + " requires a dense VelarScript List");
  if (__velarListOwnedLength(value) !== value.length) return __velarValidateDenseList(value, name);
  const lengthDescriptor = __velarCollectionListGetOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable || lengthDescriptor.configurable || !("value" in lengthDescriptor)) throw new __velarCollectionNativeTypeError(name + " requires an ordinary mutable List length");
  return value;
}
function __velarOwnedListElement(value, index, name) {
  const descriptor = __velarCollectionListGetOwnPropertyDescriptor(value, index);
  if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) throw new __velarCollectionNativeTypeError(name + " requires ordinary mutable List data elements");
  return descriptor.value;
}
function* __velarReactiveListIterator(value) { __velarReactiveCollectionTrack(value); value = __velarValidateOwnedList(value, "List iteration"); for (let index = 0; index < value.length; index += 1) yield __velarReactiveCollectionRead(value, __velarReactiveIterateKey, __velarOwnedListElement(value, index, "List iteration")); }
function* __velarReactiveSetIterator(value) { const size = __velarCollectionSetMapSetSize(value); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items"); __velarReactiveCollectionTrack(value); const iterator = __velarCollectionSetMapSetValues(value); while (true) { const step = __velarCollectionSetMapSetNext(iterator); if (step.done) return; yield __velarReactiveCollectionRead(value, __velarReactiveIterateKey, step.value); } }
function* __velarReactiveMapKeyIterator(value) { const size = __velarCollectionSetMapMapSize(value); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries"); __velarReactiveCollectionTrack(value, __velarReactiveStructureKey); const iterator = __velarCollectionSetMapMapKeys(value); while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) return; yield __velarReactiveCollectionRead(value, __velarReactiveStructureKey, step.value); } }
function* __velarReactiveRecordIterator(value) { const fields = __velarRecordFields(value, "Record iteration"); __velarReactiveCollectionTrack(value, __velarReactiveStructureKey); for (let index = 0; index < fields.length; index += 1) yield __velarReactiveCollectionRead(value, __velarReactiveStructureKey, fields[index]); }
function __velarCopyList(value, name) {
  // Every callback operation snapshots through here, so the owned fast path is
  // what keeps map from revalidating the whole List before the first call.
  value = __velarValidateOwnedList(value, name);
  const output = [];
  for (let index = 0; index < value.length; index += 1) output[index] = __velarCollectionValue(__velarOwnedListElement(value, index, name));
  return __velarMarkOwnedList(output);
}
function __velarRecordFields(value, name) {
  value = __velarReactiveRaw(value);
  if (!__velarIsRecord(value) || __velarCollectionRecordOwnSymbols(value).length > 0) throw new __velarCollectionNativeTypeError(name + " requires a plain Record");
  const fields = __velarCollectionRecordOwnNames(value);
  if (fields.length > __velarMaxCollectionItems) throw new __velarCollectionRecordNativeRangeError("A Record cannot exceed 1000000 fields");
  for (let index = 0; index < fields.length; index += 1) {
    const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, fields[index]);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) throw new __velarCollectionNativeTypeError(name + " requires ordinary mutable enumerable data fields");
  }
  return fields;
}

function __velarCollectionIterator(value) {
  if (typeof value === "string") return String.prototype[Symbol.iterator].call(value);
  value = __velarReactiveRaw(value);
  if (__velarCollectionListIsArray(value)) return __velarReactiveListIterator(value);
  if (__velarIsMap(value)) return __velarReactiveMapKeyIterator(value);
  if (__velarIsSet(value)) return __velarReactiveSetIterator(value);
  if (__velarIsRecord(value)) return __velarReactiveRecordIterator(value);
  throw new __velarCollectionNativeTypeError("VelarScript iteration requires a List, Set, Map, or Record");
}
function* __velarCollectionPairIterator(value) {
  const raw = __velarReactiveRaw(value);
  if (__velarIsMap(raw)) {
    if (__velarCollectionSetMapMapSize(raw) > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
    __velarReactiveCollectionTrack(raw);
    const iterator = __velarCollectionSetMapMapEntries(raw);
    while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) return; const entry = step.value; yield [__velarReactiveCollectionRead(raw, __velarReactiveIterateKey, entry[0]), __velarReactiveCollectionRead(raw, entry[0], entry[1])]; }
  }
  if (__velarIsRecord(raw)) {
    const fields = __velarRecordFields(raw, "Record iteration");
    __velarReactiveCollectionTrack(raw);
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(raw, field);
      yield [__velarReactiveCollectionRead(raw, __velarReactiveIterateKey, field), __velarReactiveCollectionRead(raw, field, descriptor.value)];
    }
    return;
  }
  let index = 0;
  for (const item of __velarCollectionIterator(value)) yield [item, index++];
}

function __velarCollectionSize(value) {
  value = __velarReactiveRaw(value);
  __velarReactiveCollectionTrack(value, __velarReactiveStructureKey);
  if (__velarCollectionListIsArray(value)) return __velarValidateOwnedList(value, "List size").length;
  if (__velarIsRecord(value)) return __velarRecordFields(value, "Record size").length;
  const size = __velarIsMap(value) ? __velarCollectionSetMapMapSize(value) : __velarIsSet(value) ? __velarCollectionSetMapSetSize(value) : null;
  if (size === null) throw new __velarCollectionNativeTypeError("VelarScript size requires a List, Set, Map, or Record");
  if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A collection cannot exceed 1000000 items");
  return size;
}

function __velarCreateList(parts) {
  const output = [];
  __velarValidateDenseList(parts, "List construction parts");
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = __velarValidateDenseList(__velarCollectionListGetOwnPropertyDescriptor(parts, partIndex).value, "List construction part");
    const spread = part[0];
    const read = part[1];
    if (!spread) {
      if (output.length >= __velarMaxCollectionItems) throw new __velarCollectionListNativeRangeError("A List cannot exceed 1000000 items");
      output[output.length] = __velarCollectionValue(read());
      continue;
    }
    const values = __velarValidateOwnedList(read(), "List spread");
    if (output.length + values.length > __velarMaxCollectionItems) throw new __velarCollectionListNativeRangeError("A List cannot exceed 1000000 items");
    for (let index = 0; index < values.length; index += 1) output[output.length] = __velarCollectionValue(__velarOwnedListElement(values, index, "List spread"));
  }
  return __velarMarkOwnedList(output);
}
async function __velarCreateListAsync(parts) {
  const output = [];
  __velarValidateDenseList(parts, "List construction parts");
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = __velarValidateDenseList(__velarCollectionListGetOwnPropertyDescriptor(parts, partIndex).value, "List construction part");
    const spread = part[0];
    const asynchronous = part[1];
    const read = part[2];
    if (!spread) {
      if (output.length >= __velarMaxCollectionItems) throw new __velarCollectionListNativeRangeError("A List cannot exceed 1000000 items");
      output[output.length] = __velarCollectionValue(asynchronous ? await read() : read());
      continue;
    }
    const values = __velarValidateOwnedList(asynchronous ? await read() : read(), "List spread");
    if (output.length + values.length > __velarMaxCollectionItems) throw new __velarCollectionListNativeRangeError("A List cannot exceed 1000000 items");
    for (let index = 0; index < values.length; index += 1) output[output.length] = __velarCollectionValue(__velarOwnedListElement(values, index, "List spread"));
  }
  return __velarMarkOwnedList(output);
}

// Members and keys are stored raw. Every membership and key lookup unwraps
// its argument (docs/web-api.md: "Map keys and Set members are unwrapped
// before lookup"), so a construction that stored a reactive proxy would split
// member identity and make every later lookup miss.
function __velarCreateSet(value) {
  const output = new __velarCollectionNativeSet();
  if (value === undefined) return output;
  value = __velarReactiveRaw(value);
  if (__velarCollectionListIsArray(value)) { const values = __velarValidateOwnedList(value, "Set construction"); for (let index = 0; index < values.length; index += 1) __velarCollectionSetMapSetAdd(output, __velarCollectionValue(__velarReactiveRaw(__velarOwnedListElement(values, index, "Set construction")))); return output; }
  if (!__velarIsSet(value)) throw new __velarCollectionNativeTypeError("Set construction requires a List or Set");
  if (__velarCollectionSetMapSetSize(value) > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items");
  const iterator = __velarCollectionSetMapSetValues(value); while (true) { const step = __velarCollectionSetMapSetNext(iterator); if (step.done) return output; __velarCollectionSetMapSetAdd(output, __velarCollectionValue(__velarReactiveRaw(step.value))); }
}

function __velarCreateMap(value) {
  const output = new __velarCollectionNativeMap();
  if (value === undefined) return output;
  value = __velarReactiveRaw(value);
  if (__velarIsMap(value)) {
    if (__velarCollectionSetMapMapSize(value) > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
    const iterator = __velarCollectionSetMapMapEntries(value); while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) return output; const entry = step.value; __velarCollectionSetMapMapSet(output, __velarCollectionValue(__velarReactiveRaw(entry[0])), __velarCollectionValue(__velarReactiveRaw(entry[1]))); }
  }
  if (__velarCollectionListIsArray(value)) {
    const entries = __velarValidateOwnedList(value, "Map construction");
    for (let index = 0; index < entries.length; index += 1) {
      const entry = __velarValidateOwnedList(__velarOwnedListElement(entries, index, "Map construction"), "Map entry construction");
      if (entry.length !== 2) throw new __velarCollectionNativeTypeError("Map entry construction requires exactly [key, value]");
      __velarCollectionSetMapMapSet(output, __velarCollectionValue(__velarReactiveRaw(__velarOwnedListElement(entry, 0, "Map entry construction"))), __velarCollectionValue(__velarReactiveRaw(__velarOwnedListElement(entry, 1, "Map entry construction"))));
    }
    return output;
  }
  if (value && typeof value === "object") {
    const prototype = __velarCollectionHostCall(__velarCollectionGetPrototypeOf, __velarCollectionNativeObject, [value]);
    const names = __velarCollectionRecordOwnNames(value);
    if ((prototype !== __velarCollectionObjectPrototype && prototype !== null) || __velarCollectionRecordOwnSymbols(value).length > 0 || names.length > __velarMaxCollectionItems) throw new __velarCollectionNativeTypeError("Map record construction requires an ordinary record");
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarCollectionNativeTypeError("Map record construction requires own enumerable data fields");
      __velarCollectionSetMapMapSet(output, name, __velarCollectionValue(__velarReactiveRaw(descriptor.value)));
    }
    return output;
  }
  throw new __velarCollectionNativeTypeError("Map construction requires a Map, a List of [key, value] Lists, or a record");
}

function __velarCollectionGet(value, key) {
  value = __velarReactiveRaw(value);
  if (__velarCollectionListIsArray(value)) {
    __velarValidateOwnedList(value, "List.get");
    if (!__velarCollectionListIsInteger(key)) throw new __VelarIndexError("List.get index must be an integer");
    const index = key < 0 ? value.length + key : key;
    if (index >= 0 && index < value.length) return __velarReactiveCollectionRead(value, index, __velarOwnedListElement(value, index, "List.get"));
    __velarReactiveCollectionTrack(value, key < 0 ? __velarReactiveIterateKey : index);
    __velarReactiveCollectionTrack(value);
    return null;
  }
  if (__velarIsRecord(value)) {
    if (typeof key !== "string") throw new __velarCollectionNativeTypeError("Record.get requires a string key");
    __velarRecordFields(value, "Record.get");
    __velarReactiveCollectionTrack(value, key);
    const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, key);
    return descriptor === undefined ? null : __velarReactiveCollectionRead(value, key, descriptor.value);
  }
  if (!__velarIsMap(value)) throw new __velarCollectionNativeTypeError("Map.get requires a Map");
  const size = __velarCollectionSetMapMapSize(value);
  if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  key = __velarReactiveRaw(key);
  __velarReactiveCollectionTrack(value, key);
  const item = __velarCollectionSetMapMapGet(value, key);
  return item === undefined ? null : __velarReactiveCollectionRead(value, key, item);
}

function __velarCollectionSlice(value, start = 0, end = null) {
  value = __velarValidateOwnedList(value, "List.slice");
  __velarReactiveCollectionTrack(value);
  if (end === null) end = value.length;
  if (!__velarCollectionListIsInteger(start) || !__velarCollectionListIsInteger(end)) {
    throw new __velarCollectionNativeTypeError("List.slice positions must be integers");
  }
  const length = value.length;
  const first = start < 0 ? __velarCollectionListMaximum(length + start, 0) : __velarCollectionListMinimum(start, length);
  const last = end < 0 ? __velarCollectionListMaximum(length + end, 0) : __velarCollectionListMinimum(end, length);
  const output = [];
  for (let index = first; index < __velarCollectionListMaximum(first, last); index += 1) output[output.length] = __velarReactiveCollectionRead(value, index, __velarOwnedListElement(value, index, "List.slice"));
  return __velarMarkOwnedList(output);
}

class __VelarIndexError extends __velarCollectionListNativeRangeError {
  constructor(message) {
    super(message);
    this.name = "IndexError";
  }
}
function __velarStrictListIndex(value, requested) {
  if (!__velarCollectionListIsInteger(requested)) throw new __VelarIndexError("List index must be an in-range integer");
  const index = requested < 0 ? value.length + requested : requested;
  if (index < 0 || index >= value.length) throw new __VelarIndexError("List index must be an in-range integer");
  return index;
}
function __velarIndex(value, index) {
  value = __velarReactiveRaw(value);
  if (__velarCollectionListIsArray(value)) {
    __velarValidateOwnedList(value, "List index");
    index = __velarStrictListIndex(value, index);
    return __velarReactiveCollectionRead(value, index, __velarOwnedListElement(value, index, "List index"));
  }
  if (!__velarIsRecord(value) || typeof index !== "string") throw new __velarCollectionNativeTypeError("Record index requires a plain record and a string key");
  __velarRecordFields(value, "Record index");
  const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, index);
  return __velarReactiveCollectionRead(value, index, descriptor?.value);
}
function __velarOptionalIndex(value, index) {
  return value == null ? null : __velarIndex(value, index());
}
function __velarSetIndex(value, index, next) {
  value = __velarReactiveRaw(value);
  if (__velarCollectionListIsArray(value)) {
    __velarValidateOwnedList(value, "List index assignment");
    index = __velarStrictListIndex(value, index);
    const previous = __velarOwnedListElement(value, index, "List index assignment");
    next = __velarReactiveRaw(next);
    if (__velarCollectionListObjectIs(__velarReactiveRaw(previous), next)) return next;
    value[index] = next;
    __velarReactiveCollectionUnlink(value, previous);
    __velarReactiveCollectionLink(value, next);
    __velarReactiveCollectionTrigger(value, index, true, false);
    __velarMarkOwnedList(value);
    return next;
  }
  if (!__velarIsRecord(value) || typeof index !== "string") throw new __velarCollectionNativeTypeError("Record index assignment requires a plain record and a string key");
  const fields = __velarRecordFields(value, "Record index assignment");
  const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, index);
  if (descriptor === undefined && fields.length >= 1000000) throw new __velarCollectionRecordNativeRangeError("A Record cannot exceed 1000000 fields");
  const previous = descriptor?.value;
  next = __velarReactiveRaw(next);
  if (descriptor !== undefined && __velarCollectionRecordObjectIs(__velarReactiveRaw(previous), next)) return next;
  __velarCollectionRecordDefineProperty(value, index, { value: next, writable: true, enumerable: true, configurable: true });
  __velarReactiveCollectionUnlink(value, previous);
  __velarReactiveCollectionLink(value, next);
  __velarReactiveCollectionTrigger(value, index, true, descriptor === undefined);
  return next;
}

function __velarListAppend(value, item) {
  value = __velarValidateOwnedList(value, "List.append");
  if (value.length >= __velarMaxCollectionItems) throw new __velarCollectionListNativeRangeError("A List cannot exceed 1000000 items");
  item = __velarReactiveRaw(item);
  const index = value.length;
  __velarCollectionListDefineProperty(value, index, { value: item, writable: true, enumerable: true, configurable: true });
  __velarReactiveCollectionLink(value, item);
  __velarReactiveCollectionTrigger(value, index, true, true, index);
  __velarMarkOwnedList(value);
  return null;
}

function __velarListExtend(value, items) {
  value = __velarValidateOwnedList(value, "List.extend");
  items = __velarValidateOwnedList(items, "List.extend");
  if (value.length + items.length > __velarMaxCollectionItems) throw new __velarCollectionListNativeRangeError("A List cannot exceed 1000000 items");
  const start = value.length;
  const count = items.length;
  for (let index = 0; index < count; index += 1) { const item = __velarReactiveRaw(__velarOwnedListElement(items, index, "List.extend")); __velarCollectionListDefineProperty(value, value.length, { value: item, writable: true, enumerable: true, configurable: true }); __velarReactiveCollectionLink(value, item); }
  if (count > 0) __velarReactiveCollectionTrigger(value, start, true, true, start);
  __velarMarkOwnedList(value);
  return null;
}

function __velarListInsert(value, index, item) {
  value = __velarValidateOwnedList(value, "List.insert");
  if (!__velarCollectionListIsInteger(index) || index < 0 || index > value.length) throw new __velarCollectionListNativeRangeError("List.insert index must be an integer from 0 through size");
  if (value.length >= __velarMaxCollectionItems) throw new __velarCollectionListNativeRangeError("A List cannot exceed 1000000 items");
  item = __velarReactiveRaw(item);
  __velarCollectionListDefineProperty(value, value.length, { value: item, writable: true, enumerable: true, configurable: true });
  for (let cursor = value.length - 1; cursor > index; cursor -= 1) value[cursor] = __velarOwnedListElement(value, cursor - 1, "List.insert");
  value[index] = item;
  __velarMarkOwnedList(value);
  __velarReactiveCollectionLink(value, item);
  __velarReactiveCollectionTrigger(value, index, true, true, index);
  return null;
}

function __velarListPop(value, requested = -1) {
  value = __velarValidateOwnedList(value, "List.pop");
  if (!__velarCollectionListIsInteger(requested)) throw new __VelarIndexError("List.pop index must be an integer");
  const index = requested < 0 ? value.length + requested : requested;
  if (value.length === 0) throw new __VelarIndexError("List.pop requires a non-empty List");
  if (index < 0 || index >= value.length) throw new __VelarIndexError("List.pop index must be an in-range integer");
  const item = __velarOwnedListElement(value, index, "List.pop");
  for (let cursor = index; cursor < value.length - 1; cursor += 1) value[cursor] = __velarOwnedListElement(value, cursor + 1, "List.pop");
  value.length -= 1;
  __velarMarkOwnedList(value);
  __velarReactiveCollectionUnlink(value, item);
  __velarReactiveCollectionTrigger(value, index, true, true, index);
  return item;
}
function __velarListRemove(value, item) { value = __velarValidateOwnedList(value, "List.remove"); item = __velarReactiveRaw(item); for (let index = 0; index < value.length; index += 1) if (__velarSameValueZero(__velarReactiveRaw(__velarOwnedListElement(value, index, "List.remove")), item)) { __velarListPop(value, index); return true; } return false; }
function __velarListCopy(value) { __velarReactiveCollectionTrack(value); return __velarCopyList(value, "List.copy"); }
function __velarListCount(value, item) { value = __velarValidateOwnedList(value, "List.count"); item = __velarReactiveRaw(item); __velarReactiveCollectionTrack(value); let count = 0; for (let index = 0; index < value.length; index += 1) if (__velarSameValueZero(__velarReactiveRaw(__velarOwnedListElement(value, index, "List.count")), item)) count += 1; return count; }
function __velarListFind(value, predicate) { const items = __velarCopyList(value, "List.find"); __velarReactiveCollectionTrack(value); for (let index = 0; index < items.length; index += 1) { const item = __velarReactiveCollectionRead(value, index, items[index]); const accepted = predicate(item); if (typeof accepted !== "boolean") throw new __velarCollectionNativeTypeError("List.find predicate must return bool"); if (accepted) return item; } return null; }
function __velarListIndex(value, item) { value = __velarValidateOwnedList(value, "List.index"); item = __velarReactiveRaw(item); __velarReactiveCollectionTrack(value); for (let index = 0; index < value.length; index += 1) if (__velarSameValueZero(__velarReactiveRaw(__velarOwnedListElement(value, index, "List.index")), item)) return index; return null; }
function __velarListSome(value, predicate) { const items = __velarCopyList(value, "List.some"); __velarReactiveCollectionTrack(value); for (let index = 0; index < items.length; index += 1) { const accepted = predicate(__velarReactiveCollectionRead(value, index, items[index])); if (typeof accepted !== "boolean") throw new __velarCollectionNativeTypeError("List.some predicate must return bool"); if (accepted) return true; } return false; }
function __velarListEvery(value, predicate) { const items = __velarCopyList(value, "List.every"); __velarReactiveCollectionTrack(value); for (let index = 0; index < items.length; index += 1) { const accepted = predicate(__velarReactiveCollectionRead(value, index, items[index])); if (typeof accepted !== "boolean") throw new __velarCollectionNativeTypeError("List.every predicate must return bool"); if (!accepted) return false; } return true; }
function __velarListMap(value, transform) { const items = __velarCopyList(value, "List.map"); __velarReactiveCollectionTrack(value); const output = new __velarCollectionNativeArray(items.length); for (let index = 0; index < items.length; index += 1) { const item = transform(__velarReactiveCollectionRead(value, index, items[index])); output[index] = item === undefined ? null : __velarReactiveRaw(item); } return __velarMarkOwnedList(output); }
function __velarListFilter(value, predicate) { const items = __velarCopyList(value, "List.filter"); __velarReactiveCollectionTrack(value); const output = []; for (let index = 0; index < items.length; index += 1) { const item = __velarReactiveCollectionRead(value, index, items[index]); const accepted = predicate(item); if (typeof accepted !== "boolean") throw new __velarCollectionNativeTypeError("List.filter predicate must return bool"); if (accepted) output[output.length] = __velarReactiveRaw(item); } return __velarMarkOwnedList(output); }
function __velarListReduce(value, combine, initial) { const items = __velarCopyList(value, "List.reduce"); __velarReactiveCollectionTrack(value); let result = initial; for (let index = 0; index < items.length; index += 1) { const next = combine(result, __velarReactiveCollectionRead(value, index, items[index])); result = next === undefined ? null : next; } return result; }
function __velarListJoin(value, separator = "") { value = __velarValidateOwnedList(value, "List.join"); __velarReactiveCollectionTrack(value); if (typeof separator !== "string") throw new __velarCollectionNativeTypeError("List.join separator must be string"); for (let index = 0; index < value.length; index += 1) if (typeof __velarOwnedListElement(value, index, "List.join") !== "string") throw new __velarCollectionNativeTypeError("List.join requires string values"); return __velarCollectionListHostJoin(value, separator); }
function __velarOrderedListValue(value, name, kind = null) { const current = typeof value; if (current === "number" && __velarCollectionListIsNaN(value)) throw new __velarCollectionNativeTypeError(name + " found NaN, which has no ordering; drop it with filter(x => not x.isNaN()) or fix the upstream computation"); if ((current !== "string" && current !== "number") || (kind !== null && current !== kind)) throw new __velarCollectionNativeTypeError(name + " requires uniform numbers or strings"); return current; }
function __velarListSorted(value, compare = null, by = null) {
  if (compare !== null && by !== null) throw new __velarCollectionNativeTypeError("List.sorted accepts either a comparator or by, not both");
  if (compare !== null && typeof compare !== "function") throw new __velarCollectionNativeTypeError("List.sorted comparator must be a function");
  if (by !== null && typeof by !== "function") throw new __velarCollectionNativeTypeError("List.sorted by must be a function");
  __velarReactiveCollectionTrack(value);
  const output = __velarCopyList(value, "List.sorted");
  if (by !== null) {
    let kind = null;
    const decorated = new __velarCollectionNativeArray(output.length);
    for (let index = 0; index < output.length; index += 1) { const item = output[index]; const key = by(__velarReactiveCollectionRead(value, index, item)); kind = __velarOrderedListValue(key, "List.sorted by", kind); decorated[index] = { item, key }; }
    __velarCollectionListHostSort(decorated, (left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
    const selected = new __velarCollectionNativeArray(decorated.length);
    for (let index = 0; index < decorated.length; index += 1) selected[index] = decorated[index].item;
    return __velarMarkOwnedList(selected);
  }
  let kind = null;
  if (compare === null) { for (let index = 0; index < output.length; index += 1) kind = __velarOrderedListValue(output[index], "List.sorted()", kind); }
  const compareValues = compare ?? ((left, right) => { kind = __velarOrderedListValue(left, "List.sorted()", kind); __velarOrderedListValue(right, "List.sorted()", kind); return left < right ? -1 : left > right ? 1 : 0; });
  __velarCollectionListHostSort(output, (left, right) => { const order = compareValues(left, right); if (typeof order !== "number" || !__velarCollectionListIsFinite(order)) throw new __velarCollectionNativeTypeError("List.sorted comparator must return a finite number"); return order; });
  return output;
}
function __velarListSum(value) { const items = __velarCopyList(value, "List.sum"); __velarReactiveCollectionTrack(value); let total = 0; for (let index = 0; index < items.length; index += 1) { const item = __velarReactiveCollectionRead(value, index, items[index]); if (typeof item !== "number") throw new __velarCollectionNativeTypeError("List.sum requires numbers"); if (__velarCollectionListIsNaN(item)) throw new __velarCollectionNativeTypeError("List.sum found NaN, which poisons the total; drop it with filter(x => not x.isNaN()) or fix the upstream computation"); total += item; } return total; }
function __velarListExtremum(value, maximum) { const items = __velarCopyList(value, maximum ? "List.max" : "List.min"); __velarReactiveCollectionTrack(value); if (items.length === 0) return null; let result = __velarReactiveCollectionRead(value, 0, items[0]); let kind = __velarOrderedListValue(result, maximum ? "List.max" : "List.min"); for (let index = 1; index < items.length; index += 1) { const item = __velarReactiveCollectionRead(value, index, items[index]); __velarOrderedListValue(item, maximum ? "List.max" : "List.min", kind); if (maximum ? item > result : item < result) result = item; } return result; }
function __velarListMin(value) { return __velarListExtremum(value, false); }
function __velarListMax(value) { return __velarListExtremum(value, true); }
function __velarListReversed(value) { __velarReactiveCollectionTrack(value); const output = __velarCopyList(value, "List.reversed"); __velarCollectionListHostReverse(output); return output; }

function __velarSetAdd(value, item) {
  value = __velarReactiveRaw(value);
  item = __velarReactiveRaw(item);
  const size = __velarCollectionSetMapSetSize(value);
  if (size >= __velarMaxCollectionItems && !__velarCollectionSetMapSetHas(value, item)) throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items");
  if (__velarCollectionSetMapSetHas(value, item)) return null;
  __velarCollectionSetMapSetAdd(value, item);
  __velarReactiveCollectionLink(value, item);
  __velarReactiveCollectionTrigger(value, item, true, true);
  return null;
}

function __velarSetUpdate(value, items) {
  value = __velarReactiveRaw(value);
  items = __velarReactiveRaw(items);
  if (!__velarCollectionListIsArray(items) && !__velarIsSet(items)) throw new __velarCollectionNativeTypeError("Set.update requires a List or Set");
  let entries;
  if (__velarCollectionListIsArray(items)) entries = __velarCopyList(items, "Set.update");
  else { const sourceSize = __velarCollectionSetMapSetSize(items); if (sourceSize > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items"); entries = new __velarCollectionNativeArray(sourceSize); const iterator = __velarCollectionSetMapSetValues(items); let index = 0; while (true) { const step = __velarCollectionSetMapSetNext(iterator); if (step.done) break; entries[index++] = step.value; } }
  const additions = new __velarCollectionNativeSet();
  for (let index = 0; index < entries.length; index += 1) { const item = __velarReactiveRaw(entries[index]); if (!__velarCollectionSetMapSetHas(value, item)) __velarCollectionSetMapSetAdd(additions, item); }
  const size = __velarCollectionSetMapSetSize(value);
  const added = __velarCollectionSetMapSetSize(additions);
  if (size + added > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items");
  const iterator = __velarCollectionSetMapSetValues(additions); while (true) { const step = __velarCollectionSetMapSetNext(iterator); if (step.done) break; const item = step.value; __velarCollectionSetMapSetAdd(value, item); __velarReactiveCollectionLink(value, item); }
  // Every member added publishes its own key exactly as Set.add does: a
  // membership observer (x in tags) tracks the member key, not the iterate
  // key, so triggering only iteration would leave it stale.
  const published = __velarCollectionSetMapSetValues(additions); while (true) { const step = __velarCollectionSetMapSetNext(published); if (step.done) break; __velarReactiveCollectionTrigger(value, step.value, true, true); }
  if (added > 0) __velarReactiveCollectionTrigger(value, __velarReactiveIterateKey, true, true);
  return null;
}
function __velarSetCopy(value) { value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value); const size = __velarCollectionSetMapSetSize(value); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items"); const output = new __velarCollectionNativeSet(); const iterator = __velarCollectionSetMapSetValues(value); while (true) { const step = __velarCollectionSetMapSetNext(iterator); if (step.done) return output; __velarCollectionSetMapSetAdd(output, step.value); } }

function __velarMapSet(value, key, item) {
  value = __velarReactiveRaw(value);
  key = __velarReactiveRaw(key);
  item = __velarReactiveRaw(item);
  const size = __velarCollectionSetMapMapSize(value);
  if (size >= __velarMaxCollectionItems && !__velarCollectionSetMapMapHas(value, key)) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  const present = __velarCollectionSetMapMapHas(value, key);
  const previous = present ? __velarCollectionSetMapMapGet(value, key) : undefined;
  if (present && __velarCollectionListObjectIs(__velarReactiveRaw(previous), item)) return null;
  __velarCollectionSetMapMapSet(value, key, item);
  __velarReactiveCollectionUnlink(value, previous);
  __velarReactiveCollectionLink(value, key);
  __velarReactiveCollectionLink(value, item);
  __velarReactiveCollectionTrigger(value, key, true, !present);
  return null;
}

function __velarMapUpdate(value, items) {
  value = __velarReactiveRaw(value);
  items = __velarReactiveRaw(items);
  if (!__velarIsMap(items)) throw new __velarCollectionNativeTypeError("Map.update requires a Map");
  const sourceSize = __velarCollectionSetMapMapSize(items);
  if (sourceSize > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  const size = __velarCollectionSetMapMapSize(value);
  let additions = 0;
  const keys = __velarCollectionSetMapMapKeys(items); while (true) { const step = __velarCollectionSetMapMapNext(keys); if (step.done) break; if (!__velarCollectionSetMapMapHas(value, step.value)) additions += 1; }
  if (size + additions > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  const entries = __velarCollectionSetMapMapEntries(items); while (true) { const step = __velarCollectionSetMapMapNext(entries); if (step.done) break; const entry = step.value; __velarMapSet(value, entry[0], entry[1]); }
  return null;
}
function __velarMapCopy(value) { value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value); const size = __velarCollectionSetMapMapSize(value); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries"); const output = new __velarCollectionNativeMap(); const iterator = __velarCollectionSetMapMapEntries(value); while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) return output; const entry = step.value; __velarCollectionSetMapMapSet(output, entry[0], entry[1]); } }

function __velarRecordSet(value, key, item) {
  value = __velarReactiveRaw(value);
  if (typeof key !== "string") throw new __velarCollectionNativeTypeError("Record.set requires a string key");
  const fields = __velarRecordFields(value, "Record.set");
  const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, key);
  if (descriptor !== undefined && !descriptor.writable) throw new __velarCollectionNativeTypeError("Record.set requires a writable data field");
  if (descriptor === undefined && fields.length >= __velarMaxCollectionItems) throw new __velarCollectionRecordNativeRangeError("A Record cannot exceed 1000000 fields");
  const previous = descriptor?.value;
  item = __velarReactiveRaw(item);
  if (descriptor !== undefined && __velarCollectionRecordObjectIs(__velarReactiveRaw(previous), item)) return null;
  __velarCollectionRecordDefineProperty(value, key, { value: item, writable: true, enumerable: true, configurable: true });
  __velarReactiveCollectionUnlink(value, previous);
  __velarReactiveCollectionLink(value, item);
  __velarReactiveCollectionTrigger(value, key, true, descriptor === undefined);
  return null;
}
function __velarRecordCopy(value) {
  value = __velarReactiveRaw(value);
  const output = {};
  __velarReactiveCollectionTrack(value);
  const fields = __velarRecordFields(value, "Record.copy");
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, field);
    __velarCollectionRecordDefineProperty(output, field, { value: __velarReactiveCollectionRead(value, field, descriptor.value), writable: true, enumerable: true, configurable: true });
  }
  return output;
}

function __velarCollectionHas(value, item) {
  value = __velarReactiveRaw(value); item = __velarReactiveRaw(item);
  if (__velarCollectionListIsArray(value)) { value = __velarValidateOwnedList(value, "List.has"); __velarReactiveCollectionTrack(value); for (let index = 0; index < value.length; index += 1) if (__velarSameValueZero(__velarReactiveRaw(__velarOwnedListElement(value, index, "List.has")), item)) return true; return false; }
  if (__velarIsRecord(value)) { if (typeof item !== "string") throw new __velarCollectionNativeTypeError("Record.has requires a string key"); __velarRecordFields(value, "Record.has"); __velarReactiveCollectionTrack(value, item); return __velarCollectionRecordGetOwnPropertyDescriptor(value, item) !== undefined; }
  const map = __velarIsMap(value); const set = !map && __velarIsSet(value);
  if (!map && !set) throw new __velarCollectionNativeTypeError("VelarScript membership requires a List, Set, Map, or Record");
  const size = map ? __velarCollectionSetMapMapSize(value) : __velarCollectionSetMapSetSize(value);
  if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A collection cannot exceed 1000000 items");
  __velarReactiveCollectionTrack(value, item);
  return map ? __velarCollectionSetMapMapHas(value, item) : __velarCollectionSetMapSetHas(value, item);
}
function __velarContains(item, value) {
  if (typeof value === "string") { if (typeof item !== "string") throw new __velarCollectionNativeTypeError("String membership requires a string"); return value.includes(item); }
  value = __velarReactiveRaw(value);
  if (__velarIsRecord(value)) {
    if (typeof item !== "string") throw new __velarCollectionNativeTypeError("Record membership requires a string key");
    const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, item);
    if (descriptor !== undefined && (!descriptor.enumerable || !("value" in descriptor))) throw new __velarCollectionNativeTypeError("Record fields must be enumerable data values");
    __velarReactiveCollectionTrack(value, item);
    return descriptor !== undefined;
  }
  return __velarCollectionHas(value, item);
}

// D47 rule 81: equals(a, b) — deep structural comparison. Lists compare
// ordered element-wise, Sets as the same member set, Maps as the same
// key-value pairs, records as the same field set; leaves compare by
// SameValueZero so NaN agrees with '=='. Cyclic structures throw (the same
// stance stringify takes), and so does data nested past the validator depth
// budget, so a pathological input never becomes a silent stack overflow.
function __velarEquals(left, right) {
  return __velarEqualsVisit(left, right, [], 0);
}
function __velarEqualsVisit(left, right, active, depth) {
  left = __velarCollectionValue(__velarReactiveRaw(left));
  right = __velarCollectionValue(__velarReactiveRaw(right));
  if (left === right || (left !== left && right !== right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (depth >= 1000) throw new __velarCollectionNativeTypeError("equals cannot compare data nested more than 1000 collections deep");
  for (let index = 0; index < active.length; index += 1) {
    if (active[index] === left || active[index] === right) throw new __velarCollectionNativeTypeError("equals cannot compare cyclic data");
  }
  active[active.length] = left;
  active[active.length] = right;
  try {
    if (__velarCollectionListIsArray(left)) {
      if (!__velarCollectionListIsArray(right)) return false;
      const leftList = __velarValidateOwnedList(left, "equals");
      const rightList = __velarValidateOwnedList(right, "equals");
      __velarReactiveCollectionTrack(leftList);
      __velarReactiveCollectionTrack(rightList);
      if (leftList.length !== rightList.length) return false;
      for (let index = 0; index < leftList.length; index += 1) {
        if (!__velarEqualsVisit(__velarOwnedListElement(leftList, index, "equals"), __velarOwnedListElement(rightList, index, "equals"), active, depth + 1)) return false;
      }
      return true;
    }
    if (__velarIsSet(left)) {
      if (!__velarIsSet(right)) return false;
      const size = __velarCollectionSetMapSetSize(left);
      if (size > __velarMaxCollectionItems || __velarCollectionSetMapSetSize(right) > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A collection cannot exceed 1000000 items");
      __velarReactiveCollectionTrack(left);
      __velarReactiveCollectionTrack(right);
      if (size !== __velarCollectionSetMapSetSize(right)) return false;
      // The native lookup already answers SameValueZero membership; only
      // structured members without an identical partner fall back to the
      // injective structural matching below. Structural equality is an
      // equivalence relation, so greedy matching is exact.
      const pending = [];
      const leftIterator = __velarCollectionSetMapSetValues(left);
      while (true) {
        const step = __velarCollectionSetMapSetNext(leftIterator);
        if (step.done) break;
        const member = __velarCollectionValue(__velarReactiveRaw(step.value));
        if (__velarCollectionSetMapSetHas(right, member)) continue;
        if (member === null || typeof member !== "object") return false;
        pending[pending.length] = member;
      }
      if (pending.length === 0) return true;
      const candidates = [];
      const rightIterator = __velarCollectionSetMapSetValues(right);
      while (true) {
        const step = __velarCollectionSetMapSetNext(rightIterator);
        if (step.done) break;
        const member = __velarCollectionValue(__velarReactiveRaw(step.value));
        if (__velarCollectionSetMapSetHas(left, member)) continue;
        if (member === null || typeof member !== "object") return false;
        candidates[candidates.length] = member;
      }
      if (candidates.length !== pending.length) return false;
      const used = new __velarCollectionNativeArray(candidates.length);
      for (let leftIndex = 0; leftIndex < pending.length; leftIndex += 1) {
        let matched = false;
        for (let rightIndex = 0; rightIndex < candidates.length; rightIndex += 1) {
          if (used[rightIndex]) continue;
          if (__velarEqualsVisit(pending[leftIndex], candidates[rightIndex], active, depth + 1)) {
            used[rightIndex] = true;
            matched = true;
            break;
          }
        }
        if (!matched) return false;
      }
      return true;
    }
    if (__velarIsMap(left)) {
      if (!__velarIsMap(right)) return false;
      const size = __velarCollectionSetMapMapSize(left);
      if (size > __velarMaxCollectionItems || __velarCollectionSetMapMapSize(right) > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A collection cannot exceed 1000000 items");
      __velarReactiveCollectionTrack(left);
      __velarReactiveCollectionTrack(right);
      if (size !== __velarCollectionSetMapMapSize(right)) return false;
      const pendingKeys = [];
      const pendingValues = [];
      const leftIterator = __velarCollectionSetMapMapEntries(left);
      while (true) {
        const step = __velarCollectionSetMapMapNext(leftIterator);
        if (step.done) break;
        const key = __velarCollectionValue(__velarReactiveRaw(step.value[0]));
        const value = step.value[1];
        if (__velarCollectionSetMapMapHas(right, key)) {
          if (!__velarEqualsVisit(value, __velarCollectionSetMapMapGet(right, key), active, depth + 1)) return false;
          continue;
        }
        if (key === null || typeof key !== "object") return false;
        pendingKeys[pendingKeys.length] = key;
        pendingValues[pendingValues.length] = value;
      }
      if (pendingKeys.length === 0) return true;
      const candidateKeys = [];
      const candidateValues = [];
      const rightIterator = __velarCollectionSetMapMapEntries(right);
      while (true) {
        const step = __velarCollectionSetMapMapNext(rightIterator);
        if (step.done) break;
        const key = __velarCollectionValue(__velarReactiveRaw(step.value[0]));
        if (__velarCollectionSetMapMapHas(left, key)) continue;
        if (key === null || typeof key !== "object") return false;
        candidateKeys[candidateKeys.length] = key;
        candidateValues[candidateValues.length] = step.value[1];
      }
      if (candidateKeys.length !== pendingKeys.length) return false;
      const used = new __velarCollectionNativeArray(candidateKeys.length);
      for (let leftIndex = 0; leftIndex < pendingKeys.length; leftIndex += 1) {
        let matched = false;
        for (let rightIndex = 0; rightIndex < candidateKeys.length; rightIndex += 1) {
          if (used[rightIndex]) continue;
          if (__velarEqualsVisit(pendingKeys[leftIndex], candidateKeys[rightIndex], active, depth + 1)
            && __velarEqualsVisit(pendingValues[leftIndex], candidateValues[rightIndex], active, depth + 1)) {
            used[rightIndex] = true;
            matched = true;
            break;
          }
        }
        if (!matched) return false;
      }
      return true;
    }
    if (__velarIsRecord(left)) {
      if (!__velarIsRecord(right)) return false;
      const leftFields = __velarRecordFields(left, "equals");
      const rightFields = __velarRecordFields(right, "equals");
      __velarReactiveCollectionTrack(left);
      __velarReactiveCollectionTrack(right);
      if (leftFields.length !== rightFields.length) return false;
      for (let index = 0; index < leftFields.length; index += 1) {
        const field = leftFields[index];
        const rightDescriptor = __velarCollectionRecordGetOwnPropertyDescriptor(right, field);
        if (!rightDescriptor || !rightDescriptor.enumerable || !("value" in rightDescriptor)) return false;
        if (!__velarEqualsVisit(__velarCollectionRecordGetOwnPropertyDescriptor(left, field).value, rightDescriptor.value, active, depth + 1)) return false;
      }
      return true;
    }
    // Anything else — class instances, host objects — has no structural
    // content contract; the analyzer rejects those domains statically, so a
    // value reaching here came through 'any' and fails closed.
    return false;
  } finally {
    active.length -= 2;
  }
}

function __velarCollectionRemove(value, item) {
  value = __velarReactiveRaw(value); item = __velarReactiveRaw(item);
  if (__velarIsRecord(value)) {
    if (typeof item !== "string") throw new __velarCollectionNativeTypeError("Record.remove requires a string key");
    __velarRecordFields(value, "Record.remove");
    const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, item);
    if (descriptor === undefined) return false;
    if (!descriptor.configurable) throw new __velarCollectionNativeTypeError("Record.remove requires a configurable data field");
    if (!__velarCollectionRecordDeleteProperty(value, item)) throw new __velarCollectionNativeTypeError("Record.remove could not delete the field");
    __velarReactiveCollectionUnlink(value, descriptor.value);
    __velarReactiveCollectionTrigger(value, item, true, true);
    return true;
  }
  const map = __velarIsMap(value);
  const previous = map ? __velarCollectionSetMapMapGet(value, item) : undefined;
  const removed = map ? __velarCollectionSetMapMapDelete(value, item) : __velarCollectionSetMapSetDelete(value, item);
  // A Set member is its own entry: unlinking it twice repeats an O(children)
  // scan for nothing. Only a Map has a separate value to unlink.
  if (removed) { __velarReactiveCollectionUnlink(value, item); if (map) __velarReactiveCollectionUnlink(value, previous); __velarReactiveCollectionTrigger(value, item, true, true); }
  return removed;
}

function __velarCollectionClear(value) {
  value = __velarReactiveRaw(value);
  if (__velarCollectionListIsArray(value)) {
    const previous = __velarCopyList(value, "List.clear");
    if (previous.length === 0) return null;
    value.length = 0;
    __velarMarkOwnedList(value);
    for (let index = 0; index < previous.length; index += 1) __velarReactiveCollectionUnlink(value, previous[index]);
    __velarReactiveCollectionTrigger(value, __velarReactiveIterateKey, true, true, 0);
    return null;
  }
  if (__velarIsRecord(value)) {
    const fields = __velarRecordFields(value, "Record.clear");
    if (fields.length === 0) return null;
    const previous = new __velarCollectionNativeArray(fields.length);
    for (let index = 0; index < fields.length; index += 1) { const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, fields[index]); if (!descriptor.configurable) throw new __velarCollectionNativeTypeError("Record.clear requires configurable data fields"); previous[index] = descriptor.value; }
    for (let index = 0; index < fields.length; index += 1) if (!__velarCollectionRecordDeleteProperty(value, fields[index])) throw new __velarCollectionNativeTypeError("Record.clear could not delete a field");
    for (let index = 0; index < previous.length; index += 1) __velarReactiveCollectionUnlink(value, previous[index]);
    __velarReactiveCollectionTrigger(value, __velarReactiveIterateKey, true, true, null, true);
    return null;
  }
  const map = __velarIsMap(value);
  const previous = [];
  if (map) { const iterator = __velarCollectionSetMapMapEntries(value); while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) break; const entry = step.value; previous[previous.length] = entry[0]; previous[previous.length] = entry[1]; } }
  else { const iterator = __velarCollectionSetMapSetValues(value); while (true) { const step = __velarCollectionSetMapSetNext(iterator); if (step.done) break; previous[previous.length] = step.value; } }
  if (previous.length === 0) return null;
  if (map) __velarCollectionSetMapMapClear(value); else __velarCollectionSetMapSetClear(value);
  for (let index = 0; index < previous.length; index += 1) __velarReactiveCollectionUnlink(value, previous[index]);
  __velarReactiveCollectionTrigger(value, __velarReactiveIterateKey, true, true, null, true);
  return null;
}

function __velarCollectionKeys(value) {
  value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value, __velarReactiveStructureKey);
  if (__velarIsRecord(value)) { const fields = __velarRecordFields(value, "Record.keys"); const output = new __velarCollectionNativeArray(fields.length); for (let index = 0; index < fields.length; index += 1) output[index] = __velarReactiveCollectionRead(value, __velarReactiveStructureKey, fields[index]); return __velarMarkOwnedList(output); }
  const size = __velarCollectionSetMapMapSize(value); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  const output = new __velarCollectionNativeArray(size); const iterator = __velarCollectionSetMapMapKeys(value); let index = 0; while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) return __velarMarkOwnedList(output); output[index++] = __velarReactiveCollectionRead(value, __velarReactiveStructureKey, step.value); }
}
function __velarCollectionValues(value) {
  value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value);
  if (__velarIsRecord(value)) { const fields = __velarRecordFields(value, "Record.values"); const output = new __velarCollectionNativeArray(fields.length); for (let index = 0; index < fields.length; index += 1) { const field = fields[index]; output[index] = __velarReactiveCollectionRead(value, field, __velarCollectionRecordGetOwnPropertyDescriptor(value, field).value); } return __velarMarkOwnedList(output); }
  const map = __velarIsMap(value); const size = map ? __velarCollectionSetMapMapSize(value) : __velarCollectionSetMapSetSize(value); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A collection cannot exceed 1000000 items");
  const output = new __velarCollectionNativeArray(size); const iterator = map ? __velarCollectionSetMapMapValues(value) : __velarCollectionSetMapSetValues(value); let index = 0; while (true) { const step = map ? __velarCollectionSetMapMapNext(iterator) : __velarCollectionSetMapSetNext(iterator); if (step.done) return __velarMarkOwnedList(output); output[index++] = __velarReactiveCollectionRead(value, __velarReactiveIterateKey, step.value); }
}
function __velarCollectionEntries(value) {
  value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value);
  if (__velarIsRecord(value)) { const fields = __velarRecordFields(value, "Record.entries"); const output = new __velarCollectionNativeArray(fields.length); for (let index = 0; index < fields.length; index += 1) { const field = fields[index]; output[index] = __velarCollectionRecordFreeze({ key: __velarReactiveCollectionRead(value, __velarReactiveIterateKey, field), value: __velarReactiveCollectionRead(value, field, __velarCollectionRecordGetOwnPropertyDescriptor(value, field).value) }); } return __velarMarkOwnedList(output); }
  const size = __velarCollectionSetMapMapSize(value); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  const output = new __velarCollectionNativeArray(size); const iterator = __velarCollectionSetMapMapEntries(value); let index = 0; while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) return __velarMarkOwnedList(output); const entry = step.value; output[index++] = __velarCollectionSetMapFreeze({ key: __velarReactiveCollectionRead(value, __velarReactiveIterateKey, entry[0]), value: __velarReactiveCollectionRead(value, entry[0], entry[1]) }); }
}
function __velarOptionalCollection(value, operation) { return value == null ? null : operation(value); }`;

export const VELAR_COLLECTION_LOWERING_MODULE_SOURCE = String.raw`
import {
${VELAR_COLLECTION_HOST_EXPORTS.map((name) => `  ${name},`).join("\n")}
} from ${JSON.stringify(VELAR_COLLECTION_HOST_MODULE)};
import {
  reactiveIterateKey as __velarReactiveIterateKey,
  reactiveStructureKey as __velarReactiveStructureKey,
  reactiveRaw as __velarReactiveRaw,
  reactiveCollectionRead as __velarReactiveCollectionRead,
  reactiveCollectionTrack as __velarReactiveCollectionTrack,
  reactiveCollectionLink as __velarReactiveCollectionLink,
  reactiveCollectionTrigger as __velarReactiveCollectionTrigger,
  reactiveCollectionUnlink as __velarReactiveCollectionUnlink,
} from ${JSON.stringify(VELAR_REACTIVE_BRIDGE_MODULE)};
${VELAR_COLLECTION_LOWERING_RUNTIME}
export {
${VELAR_COLLECTION_LOWERING_EXPORTS.map((name) => `  ${name},`).join("\n")}
};
`.trimStart();
