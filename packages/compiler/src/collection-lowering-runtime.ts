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
  // COL-P1: the emitter names this one directly, for the empty List literal
  // whose ownership only the compiler can vouch for.
  "__velarAdoptList",
  "__velarReactiveListIterator",
  "__velarReactiveSetIterator",
  "__velarReactiveMapKeyIterator",
  "__velarReactiveRecordIterator",
  "__velarReactiveMapPairIterator",
  "__velarReactiveRecordPairIterator",
  "__velarCollectionIterator",
  "__velarCollectionPairIterator",
  "__velarCopyList",
  "__velarOrderedListValue",
  "__velarCreateList",
  "__velarCreateListAsync",
  "__velarCreateSet",
  "__velarCreateMap",
  "__velarCollectionSize",
  "__velarListSize",
  "__velarMapSize",
  "__velarSetSize",
  "__velarRecordSize",
  "__velarCollectionGet",
  "__velarListGet",
  "__velarMapGet",
  "__velarRecordGet",
  "__velarCollectionSlice",
  // COL-U5: `IndexError` is a nameable source type, so a project build must be
  // able to import the one runtime class every List position raises. The
  // standalone path inlines this runtime whole, so an unexported class stayed
  // reachable there while every CLI entry (sharedRuntimeModules) emitted an
  // unbound reference.
  "__VelarIndexError",
  "__velarIndex",
  "__velarListIndexGet",
  "__velarRecordIndexGet",
  "__velarOptionalIndex",
  "__velarSetIndex",
  "__velarListIndexSet",
  "__velarRecordIndexSet",
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
  "__velarListFlatMap",
  "__velarSetAdd",
  "__velarSetUpdate",
  "__velarSetCopy",
  "__velarSetUnion",
  "__velarSetIntersection",
  "__velarSetDifference",
  "__velarMapSet",
  "__velarMapUpdate",
  "__velarMapCopy",
  "__velarRecordFields",
  "__velarRecordSet",
  "__velarRecordCopy",
  "__velarCollectionHas",
  "__velarListHas",
  "__velarMapHas",
  "__velarSetHas",
  "__velarRecordHas",
  "__velarListContains",
  "__velarMapContains",
  "__velarSetContains",
  "__velarRecordContains",
  "__velarContains",
  "__velarCollectionRemove",
  "__velarMapRemove",
  "__velarSetRemove",
  "__velarRecordRemove",
  "__velarCollectionClear",
  "__velarListClear",
  "__velarMapClear",
  "__velarSetClear",
  "__velarRecordClear",
  "__velarCollectionKeys",
  "__velarMapKeys",
  "__velarRecordKeys",
  "__velarCollectionValues",
  "__velarMapValues",
  "__velarSetValues",
  "__velarRecordValues",
  "__velarCollectionEntries",
  "__velarMapEntries",
  "__velarRecordEntries",
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
//
// COL-P1: the memo also records who wrote the elements, because that is what
// decides how much a later read still has to prove. An *owned* List holds only
// elements this runtime wrote: it either allocated and filled the array itself
// (every copy, map, filter, slice, and sorted result) or started from the empty
// List literal the compiler emitted __velarAdoptList for and took every element
// since through a List mutation. Every slot is then an ordinary data element by
// construction, and reading one is a plain load -- the same load List.sorted
// already performs on its own copy. A *checked* List held elements this runtime
// did not write when it first saw it, so every element read re-proves the slot
// with a descriptor, and an accessor installed after validation is still
// refused. Every array that arrives from JavaScript is checked, including one
// handed over empty: the runtime cannot tell that array from a List literal, so
// only the compiler ever adopts an empty array.
//
// Before the split every element read of every List allocated two property
// descriptors, so summing a 1,000,000-element List by index ran ~7x slower
// than the identical plain-JavaScript loop and 'for x in xs' ~9x slower.
//
// One registry answers both halves in one lookup, because a second WeakMap read
// on the checked tier cost every literal-built List ~10% for nothing: an owned
// List records the proved length, a checked List records its bitwise
// complement, and a length is never negative, so the sign is the tier.
const __velarListMemos = new __velarListNativeWeakMap();
const __velarListIsFrozenOperation = __velarCollectionListGetOwnPropertyDescriptor(__velarCollectionNativeObject, "isFrozen")?.value;
// COL-U4: a frozen host array fails every mutability probe below; without
// this check the author sees "requires ordinary mutable List data elements"
// with no way out. Freezing is a whole-value verdict, so it is answered once
// with the copy-on-the-JavaScript-side workflow.
function __velarListRejectFrozen(value, name) {
  if (__velarCollectionHostCall(__velarListIsFrozenOperation, __velarCollectionNativeObject, [value])) {
    throw new __velarCollectionNativeTypeError(name + " received a frozen JavaScript array; copy it on the JavaScript side — [...values] — before passing it to VelarScript");
  }
}
function __velarListMemo(value) { return __velarCollectionHostCall(__velarListWeakMapGetOperation, __velarListMemos, [value]); }
// The owned half of __velarListTier, for the callers that have already
// validated the List and only need to know which element read to use.
function __velarListIsOwned(value) { const memo = __velarListMemo(value); return memo !== undefined && memo === value.length; }
function __velarAdoptList(value) { __velarCollectionHostCall(__velarListWeakMapSetOperation, __velarListMemos, [value, value.length]); return value; }
function __velarMarkCheckedList(value) { __velarCollectionHostCall(__velarListWeakMapSetOperation, __velarListMemos, [value, ~value.length]); return value; }
// A mutation re-records the proved length; it never changes which side of the
// boundary the List came from, so a host List stays checked for its whole life.
function __velarMarkOwnedList(value) {
  const memo = __velarListMemo(value);
  return memo !== undefined && memo < 0 ? __velarMarkCheckedList(value) : __velarAdoptList(value);
}
// COL-U4/COL-P1: freezing is the one foreign change that revokes the right to
// mutate without moving the length, so it survives every memo hit. Every
// operation that writes re-proves this descriptor -- one descriptor per
// operation, never per element -- and no read has to, because reading a slot
// does not require a mutable length. Without it a frozen List answers append,
// index assignment, and pop with the host's own "Cannot assign to read only
// property 'length'" instead of a VelarScript refusal.
function __velarListRequireMutableLength(value, name) {
  const lengthDescriptor = __velarCollectionListGetOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable || lengthDescriptor.configurable || !("value" in lengthDescriptor)) throw new __velarCollectionNativeTypeError(name + " requires an ordinary mutable List length");
}
function __velarValidateDenseList(value, name) {
  value = __velarReactiveRaw(value);
  if (!__velarCollectionListIsArray(value) || value.length > __velarMaxCollectionItems || __velarCollectionListOwnSymbols(value).length > 0 || __velarCollectionListOwnNames(value).length !== value.length + 1) {
    throw new __velarCollectionNativeTypeError(name + " requires a dense VelarScript List");
  }
  __velarListRejectFrozen(value, name);
  __velarListRequireMutableLength(value, name);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarCollectionListGetOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) throw new __velarCollectionNativeTypeError(name + " requires ordinary mutable List data elements");
  }
  // COL-P1: this runtime can vouch for a slot it wrote and for no other, and
  // full validation only ever runs on an array whose slots it did not write --
  // one that arrived from JavaScript, or one whose length moved behind its
  // back, which is itself proof the host is holding the array. The arrays this
  // runtime did write are adopted where they are built, and the empty List
  // literal is adopted by the code the compiler emitted for it, so nothing that
  // reaches here is owned, including an array the host handed over empty.
  return __velarMarkCheckedList(value);
}
// 0 = no memo this runtime can still stand behind, 1 = owned, 2 = checked.
// The registry answers undefined for a primitive, and the recorded length is
// only compared once it exists, so the length is never read off a non-object.
function __velarListTier(value) {
  const memo = __velarListMemo(value);
  if (memo === undefined) return 0;
  if (memo === value.length) return 1;
  return ~memo === value.length ? 2 : 0;
}
function __velarValidateListTier(value, name, tier) {
  // An owned memo hit answers every probe below at once: this runtime wrote
  // every element, proved the array dense with an ordinary mutable length, and
  // re-recorded the length after each of its own mutations since. Reading is
  // all this entry point promises, so it does not re-prove the mutable length;
  // __velarValidateMutableList is the entry point for everything that writes.
  if (tier === 1) return value;
  if (tier === 0) return __velarValidateDenseList(value, name);
  // A checked memo hit already proved the array dense and in range; the length
  // descriptor is the one part of that verdict a foreign write can undo
  // without moving the length itself.
  __velarListRequireMutableLength(value, name);
  return value;
}
function __velarValidateOwnedList(value, name) {
  value = __velarReactiveRaw(value);
  return __velarValidateListTier(value, name, __velarListTier(value));
}
// The entry point for every operation that writes: it proves what a read
// proves and re-proves the mutable length on top of it, on both memo tiers, so
// a frozen List refuses in the same voice whoever built it.
function __velarValidateMutableList(value, name) {
  value = __velarReactiveRaw(value);
  const tier = __velarListTier(value);
  if (tier === 0) return __velarValidateDenseList(value, name);
  __velarListRequireMutableLength(value, name);
  return value;
}
function __velarCheckedListElement(value, index, name) {
  const descriptor = __velarCollectionListGetOwnPropertyDescriptor(value, index);
  if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) throw new __velarCollectionNativeTypeError(name + " requires ordinary mutable List data elements");
  return descriptor.value;
}
// The load is the whole check on an owned List: this runtime wrote every slot,
// so there is nothing left to prove about the shape of one. A slot that reads
// as undefined is the one tamper the load still notices for free -- no List
// element is ever undefined -- so that case pays for the descriptor probe and
// reports the same refusal a checked List would. What it notices is a value
// the load cannot account for, not every foreign edit: a host that keeps a
// reference to a List this runtime owns and then rewrites a slot, installs an
// accessor on it, or empties it while a polluted array prototype answers for
// that index, gets its own value back. That is the residual the split accepts,
// the same one a plain foreign write always had, and [COL-P1] pins it.
function __velarOwnedListElement(value, index, name) {
  const element = value[index];
  return element === undefined ? __velarCheckedListElement(value, index, name) : element;
}
function __velarListElement(value, index, name, owned) {
  return owned ? __velarOwnedListElement(value, index, name) : __velarCheckedListElement(value, index, name);
}
function* __velarReactiveListIterator(value) { __velarReactiveCollectionTrack(value); value = __velarValidateOwnedList(value, "List iteration"); const owned = __velarListIsOwned(value); for (let index = 0; index < value.length; index += 1) yield __velarReactiveCollectionRead(value, __velarReactiveIterateKey, __velarListElement(value, index, "List iteration", owned)); }
function* __velarReactiveSetIterator(value) { const size = __velarCollectionSetMapSetSize(value); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items"); __velarReactiveCollectionTrack(value); const iterator = __velarCollectionSetMapSetValues(value); while (true) { const step = __velarCollectionSetMapSetNext(iterator); if (step.done) return; yield __velarReactiveCollectionRead(value, __velarReactiveIterateKey, step.value); } }
function* __velarReactiveMapKeyIterator(value) { const size = __velarCollectionSetMapMapSize(value); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries"); __velarReactiveCollectionTrack(value, __velarReactiveStructureKey); const iterator = __velarCollectionSetMapMapKeys(value); while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) return; yield __velarReactiveCollectionRead(value, __velarReactiveStructureKey, step.value); } }
function* __velarReactiveRecordIterator(value) { const fields = __velarRecordFields(value, "Record iteration"); __velarReactiveCollectionTrack(value, __velarReactiveStructureKey); for (let index = 0; index < fields.length; index += 1) yield __velarReactiveCollectionRead(value, __velarReactiveStructureKey, fields[index]); }
function __velarCopyList(value, name) {
  // Every callback operation snapshots through here, so this loop is what
  // decides what map costs before its first call: the ownership memo answers
  // the whole-List validation, and on an owned List each element is a load.
  value = __velarValidateOwnedList(value, name);
  const owned = __velarListIsOwned(value);
  const output = [];
  for (let index = 0; index < value.length; index += 1) output[index] = __velarCollectionValue(__velarListElement(value, index, name, owned));
  return __velarAdoptList(output);
}
// TXT-D1: ordered string comparison is code-point order (= UTF-8 binary
// order) everywhere. UTF-16 code-unit order agrees exactly when neither
// operand contains a surrogate, so the one native regex probe keeps the
// decoded walk on surrogate-bearing strings only.
const __velarListNativeString = globalThis.String;
const __velarListStringPrototype = __velarCollectionListGetOwnPropertyDescriptor(__velarListNativeString, "prototype")?.value;
const __velarListStringCharCodeAt = __velarCollectionListGetOwnPropertyDescriptor(__velarListStringPrototype, "charCodeAt")?.value;
const __velarListSurrogatePattern = /[\uD800-\uDFFF]/;
const __velarListRegExpPrototype = __velarCollectionHostCall(__velarCollectionGetPrototypeOf, __velarCollectionNativeObject, [__velarListSurrogatePattern]);
const __velarListSurrogateExecOperation = __velarCollectionListGetOwnPropertyDescriptor(__velarListRegExpPrototype, "exec")?.value;
function __velarListCharCode(value, index) { return __velarCollectionHostCall(__velarListStringCharCodeAt, value, [index]); }
function __velarListHasSurrogate(value) { return __velarCollectionHostCall(__velarListSurrogateExecOperation, __velarListSurrogatePattern, [value]) !== null; }
function __velarCodePointCompare(left, right) {
  if (left === right) return 0;
  if (!__velarListHasSurrogate(left) && !__velarListHasSurrogate(right)) return left < right ? -1 : 1;
  let leftOffset = 0;
  let rightOffset = 0;
  while (leftOffset < left.length && rightOffset < right.length) {
    let first = __velarListCharCode(left, leftOffset);
    let firstUnits = 1;
    if (first >= 0xD800 && first <= 0xDBFF && leftOffset + 1 < left.length) {
      const trail = __velarListCharCode(left, leftOffset + 1);
      if (trail >= 0xDC00 && trail <= 0xDFFF) { first = (first - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000; firstUnits = 2; }
    }
    let second = __velarListCharCode(right, rightOffset);
    let secondUnits = 1;
    if (second >= 0xD800 && second <= 0xDBFF && rightOffset + 1 < right.length) {
      const trail = __velarListCharCode(right, rightOffset + 1);
      if (trail >= 0xDC00 && trail <= 0xDFFF) { second = (second - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000; secondUnits = 2; }
    }
    if (first !== second) return first < second ? -1 : 1;
    leftOffset += firstUnits;
    rightOffset += secondUnits;
  }
  return leftOffset < left.length ? 1 : rightOffset < right.length ? -1 : 0;
}
function __velarOrderedCompare(kind, left, right) {
  if (kind === "string") return __velarCodePointCompare(left, right);
  return left < right ? -1 : left > right ? 1 : 0;
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
function* __velarReactiveMapPairIterator(value) {
  const raw = __velarReactiveRaw(value);
  if (__velarCheckedMapSize(raw, "Map iteration") > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  __velarReactiveCollectionTrack(raw);
  const iterator = __velarCollectionSetMapMapEntries(raw);
  while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) return; const entry = step.value; yield [__velarReactiveCollectionRead(raw, __velarReactiveIterateKey, entry[0]), __velarReactiveCollectionRead(raw, entry[0], entry[1])]; }
}
function* __velarReactiveRecordPairIterator(value) {
  const raw = __velarReactiveRaw(value);
  const fields = __velarRecordFields(raw, "Record iteration");
  __velarReactiveCollectionTrack(raw);
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(raw, field);
    // COL-D1: the key snapshot can outlive the field — a body that removes
    // a later key must see that key skipped (Map iteration parity), not a
    // raw TypeError from reading a missing descriptor.
    if (descriptor === undefined) continue;
    yield [__velarReactiveCollectionRead(raw, __velarReactiveIterateKey, field), __velarReactiveCollectionRead(raw, field, descriptor.value)];
  }
}
function* __velarCollectionPairIterator(value) {
  const raw = __velarReactiveRaw(value);
  if (__velarIsMap(raw)) { yield* __velarReactiveMapPairIterator(raw); return; }
  if (__velarIsRecord(raw)) { yield* __velarReactiveRecordPairIterator(raw); return; }
  let index = 0;
  for (const item of __velarCollectionIterator(value)) yield [item, index++];
}

function __velarCheckedMapSize(value, name) {
  try { return __velarCollectionSetMapMapSize(value); }
  catch { throw new __velarCollectionNativeTypeError(name + " requires a Map"); }
}
function __velarCheckedSetSize(value, name) {
  try { return __velarCollectionSetMapSetSize(value); }
  catch { throw new __velarCollectionNativeTypeError(name + " requires a Set"); }
}
function __velarListSize(value) { value = __velarValidateOwnedList(value, "List size"); __velarReactiveCollectionTrack(value, __velarReactiveStructureKey); return value.length; }
function __velarMapSize(value) { value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value, __velarReactiveStructureKey); const size = __velarCheckedMapSize(value, "Map.size"); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries"); return size; }
function __velarSetSize(value) { value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value, __velarReactiveStructureKey); const size = __velarCheckedSetSize(value, "Set.size"); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items"); return size; }
function __velarRecordSize(value) { value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value, __velarReactiveStructureKey); return __velarRecordFields(value, "Record size").length; }
function __velarCollectionSize(value) {
  const raw = __velarReactiveRaw(value);
  if (__velarCollectionListIsArray(raw)) return __velarListSize(raw);
  if (__velarIsRecord(raw)) return __velarRecordSize(raw);
  if (__velarIsMap(raw)) return __velarMapSize(raw);
  if (__velarIsSet(raw)) return __velarSetSize(raw);
  throw new __velarCollectionNativeTypeError("VelarScript size requires a List, Set, Map, or Record");
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
    const spreadOwned = __velarListIsOwned(values);
    if (output.length + values.length > __velarMaxCollectionItems) throw new __velarCollectionListNativeRangeError("A List cannot exceed 1000000 items");
    for (let index = 0; index < values.length; index += 1) output[output.length] = __velarCollectionValue(__velarListElement(values, index, "List spread", spreadOwned));
  }
  return __velarAdoptList(output);
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
    const spreadOwned = __velarListIsOwned(values);
    if (output.length + values.length > __velarMaxCollectionItems) throw new __velarCollectionListNativeRangeError("A List cannot exceed 1000000 items");
    for (let index = 0; index < values.length; index += 1) output[output.length] = __velarCollectionValue(__velarListElement(values, index, "List spread", spreadOwned));
  }
  return __velarAdoptList(output);
}

// Members and keys are stored raw. Every membership and key lookup unwraps
// its argument (docs/web-api.md: "Map keys and Set members are unwrapped
// before lookup"), so a construction that stored a reactive proxy would split
// member identity and make every later lookup miss.
function __velarCreateSet(value) {
  const output = new __velarCollectionNativeSet();
  if (value === undefined) return output;
  value = __velarReactiveRaw(value);
  if (__velarCollectionListIsArray(value)) { const values = __velarValidateOwnedList(value, "Set construction"); const owned = __velarListIsOwned(values); for (let index = 0; index < values.length; index += 1) __velarCollectionSetMapSetAdd(output, __velarCollectionValue(__velarReactiveRaw(__velarListElement(values, index, "Set construction", owned)))); return output; }
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
    const entriesOwned = __velarListIsOwned(entries);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = __velarValidateOwnedList(__velarListElement(entries, index, "Map construction", entriesOwned), "Map entry construction");
      if (entry.length !== 2) throw new __velarCollectionNativeTypeError("Map entry construction requires exactly [key, value]");
      const entryOwned = __velarListIsOwned(entry);
      __velarCollectionSetMapMapSet(output, __velarCollectionValue(__velarReactiveRaw(__velarListElement(entry, 0, "Map entry construction", entryOwned))), __velarCollectionValue(__velarReactiveRaw(__velarListElement(entry, 1, "Map entry construction", entryOwned))));
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

function __velarListGet(value, key) {
  value = __velarValidateOwnedList(value, "List.get");
  if (!__velarCollectionListIsInteger(key)) throw new __VelarIndexError("List.get index must be an integer");
  const index = key < 0 ? value.length + key : key;
  if (index >= 0 && index < value.length) return __velarReactiveCollectionRead(value, index, __velarListElement(value, index, "List.get", __velarListIsOwned(value)));
  __velarReactiveCollectionTrack(value, key < 0 ? __velarReactiveIterateKey : index);
  __velarReactiveCollectionTrack(value);
  return null;
}
function __velarRecordGet(value, key) {
  value = __velarReactiveRaw(value);
  if (typeof key !== "string") throw new __velarCollectionNativeTypeError("Record.get requires a string key");
  __velarRecordFields(value, "Record.get");
  __velarReactiveCollectionTrack(value, key);
  const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, key);
  return descriptor === undefined ? null : __velarReactiveCollectionRead(value, key, descriptor.value);
}
function __velarMapGet(value, key) {
  value = __velarReactiveRaw(value);
  const size = __velarCheckedMapSize(value, "Map.get");
  if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  key = __velarReactiveRaw(key);
  __velarReactiveCollectionTrack(value, key);
  const item = __velarCollectionSetMapMapGet(value, key);
  return item === undefined ? null : __velarReactiveCollectionRead(value, key, item);
}
function __velarCollectionGet(value, key) {
  const raw = __velarReactiveRaw(value);
  if (__velarCollectionListIsArray(raw)) return __velarListGet(raw, key);
  if (__velarIsRecord(raw)) return __velarRecordGet(raw, key);
  return __velarMapGet(raw, key);
}

function __velarCollectionSlice(value, start = 0, end = null) {
  value = __velarValidateOwnedList(value, "List.slice");
  __velarReactiveCollectionTrack(value);
  if (end === null) end = value.length;
  // COL-I2: every List position error is an IndexError.
  if (!__velarCollectionListIsInteger(start) || !__velarCollectionListIsInteger(end)) {
    throw new __VelarIndexError("List.slice positions must be integers");
  }
  const length = value.length;
  const first = start < 0 ? __velarCollectionListMaximum(length + start, 0) : __velarCollectionListMinimum(start, length);
  const last = end < 0 ? __velarCollectionListMaximum(length + end, 0) : __velarCollectionListMinimum(end, length);
  const owned = __velarListIsOwned(value);
  const output = [];
  for (let index = first; index < __velarCollectionListMaximum(first, last); index += 1) output[output.length] = __velarReactiveCollectionRead(value, index, __velarListElement(value, index, "List.slice", owned));
  return __velarAdoptList(output);
}

class __VelarIndexError extends __velarCollectionListNativeRangeError {
  constructor(message) {
    super(message);
    this.name = "IndexError";
  }
}
// D51 rule 107: 'code' answers with the class a value was constructed from, so
// the compiler-owned class carries the source-level name it reports.
__velarCollectionListDefineProperty(__VelarIndexError, "name", { value: "IndexError", writable: false, enumerable: false, configurable: true });
function __velarStrictListIndex(value, requested) {
  if (!__velarCollectionListIsInteger(requested)) throw new __VelarIndexError("List index must be an in-range integer");
  const index = requested < 0 ? value.length + requested : requested;
  if (index < 0 || index >= value.length) throw new __VelarIndexError("List index must be an in-range integer");
  return index;
}
function __velarListIndexGet(value, index) {
  value = __velarReactiveRaw(value);
  // The hottest read in the language, so it resolves the tier itself rather
  // than through __velarValidateOwnedList, which would read the owned registry
  // a second time. Past this branch the List is checked: a tier-0 value that
  // full validation adopts as owned was empty, and an empty List has no index
  // to read.
  const tier = __velarListTier(value);
  if (tier === 1) {
    index = __velarStrictListIndex(value, index);
    return __velarReactiveCollectionRead(value, index, __velarOwnedListElement(value, index, "List index"));
  }
  value = __velarValidateListTier(value, "List index", tier);
  index = __velarStrictListIndex(value, index);
  return __velarReactiveCollectionRead(value, index, __velarCheckedListElement(value, index, "List index"));
}
function __velarRecordIndexGet(value, index) {
  value = __velarReactiveRaw(value);
  if (typeof index !== "string") throw new __velarCollectionNativeTypeError("Record index requires a plain record and a string key");
  __velarRecordFields(value, "Record index");
  const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, index);
  return __velarReactiveCollectionRead(value, index, descriptor?.value);
}
function __velarIndex(value, index) {
  const raw = __velarReactiveRaw(value);
  return __velarCollectionListIsArray(raw) ? __velarListIndexGet(raw, index) : __velarRecordIndexGet(raw, index);
}
function __velarOptionalIndex(value, index) {
  return value == null ? null : __velarIndex(value, index());
}
function __velarListIndexSet(value, index, next) {
  value = __velarValidateMutableList(value, "List index assignment");
  index = __velarStrictListIndex(value, index);
  const previous = __velarListElement(value, index, "List index assignment", __velarListIsOwned(value));
  next = __velarReactiveRaw(next);
  if (__velarCollectionListObjectIs(__velarReactiveRaw(previous), next)) return next;
  value[index] = next;
  __velarReactiveCollectionUnlink(value, previous);
  __velarReactiveCollectionLink(value, next);
  __velarReactiveCollectionTrigger(value, index, true, false);
  __velarMarkOwnedList(value);
  return next;
}
function __velarRecordIndexSet(value, index, next) {
  value = __velarReactiveRaw(value);
  if (typeof index !== "string") throw new __velarCollectionNativeTypeError("Record index assignment requires a plain record and a string key");
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
function __velarSetIndex(value, index, next) {
  const raw = __velarReactiveRaw(value);
  return __velarCollectionListIsArray(raw) ? __velarListIndexSet(raw, index, next) : __velarRecordIndexSet(raw, index, next);
}

function __velarListAppend(value, item) {
  value = __velarValidateMutableList(value, "List.append");
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
  value = __velarValidateMutableList(value, "List.extend");
  items = __velarValidateOwnedList(items, "List.extend");
  if (value.length + items.length > __velarMaxCollectionItems) throw new __velarCollectionListNativeRangeError("A List cannot exceed 1000000 items");
  const start = value.length;
  const count = items.length;
  const itemsOwned = __velarListIsOwned(items);
  for (let index = 0; index < count; index += 1) { const item = __velarReactiveRaw(__velarListElement(items, index, "List.extend", itemsOwned)); __velarCollectionListDefineProperty(value, value.length, { value: item, writable: true, enumerable: true, configurable: true }); __velarReactiveCollectionLink(value, item); }
  if (count > 0) __velarReactiveCollectionTrigger(value, start, true, true, start);
  __velarMarkOwnedList(value);
  return null;
}

function __velarListInsert(value, index, item) {
  value = __velarValidateMutableList(value, "List.insert");
  // COL-I2: every List position error is an IndexError, and the accepted
  // range 0..size (inclusive) is the charter's insert contract.
  if (!__velarCollectionListIsInteger(index) || index < 0 || index > value.length) throw new __VelarIndexError("List.insert index must be an integer from 0 through size");
  if (value.length >= __velarMaxCollectionItems) throw new __velarCollectionListNativeRangeError("A List cannot exceed 1000000 items");
  item = __velarReactiveRaw(item);
  // COL-P1: the tier is read before the new slot lands, because appending it
  // moves the length past the recorded one, and every shift below would then
  // take the descriptor path on a List this runtime wrote in full.
  const owned = __velarListIsOwned(value);
  __velarCollectionListDefineProperty(value, value.length, { value: item, writable: true, enumerable: true, configurable: true });
  for (let cursor = value.length - 1; cursor > index; cursor -= 1) value[cursor] = __velarListElement(value, cursor - 1, "List.insert", owned);
  value[index] = item;
  __velarMarkOwnedList(value);
  __velarReactiveCollectionLink(value, item);
  __velarReactiveCollectionTrigger(value, index, true, true, index);
  return null;
}

function __velarListPop(value, requested = -1) {
  value = __velarValidateMutableList(value, "List.pop");
  if (!__velarCollectionListIsInteger(requested)) throw new __VelarIndexError("List.pop index must be an integer");
  const index = requested < 0 ? value.length + requested : requested;
  if (value.length === 0) throw new __VelarIndexError("List.pop requires a non-empty List");
  if (index < 0 || index >= value.length) throw new __VelarIndexError("List.pop index must be an in-range integer");
  const owned = __velarListIsOwned(value);
  const item = __velarListElement(value, index, "List.pop", owned);
  for (let cursor = index; cursor < value.length - 1; cursor += 1) value[cursor] = __velarListElement(value, cursor + 1, "List.pop", owned);
  value.length -= 1;
  __velarMarkOwnedList(value);
  __velarReactiveCollectionUnlink(value, item);
  __velarReactiveCollectionTrigger(value, index, true, true, index);
  return item;
}
function __velarListRemove(value, item) { value = __velarValidateOwnedList(value, "List.remove"); item = __velarReactiveRaw(item); const owned = __velarListIsOwned(value); for (let index = 0; index < value.length; index += 1) if (__velarSameValueZero(__velarReactiveRaw(__velarListElement(value, index, "List.remove", owned)), item)) { __velarListPop(value, index); return true; } return false; }
function __velarListCopy(value) { __velarReactiveCollectionTrack(value); return __velarCopyList(value, "List.copy"); }
function __velarListCount(value, item) { value = __velarValidateOwnedList(value, "List.count"); item = __velarReactiveRaw(item); __velarReactiveCollectionTrack(value); const owned = __velarListIsOwned(value); let count = 0; for (let index = 0; index < value.length; index += 1) if (__velarSameValueZero(__velarReactiveRaw(__velarListElement(value, index, "List.count", owned)), item)) count += 1; return count; }
function __velarListFind(value, predicate) { const items = __velarCopyList(value, "List.find"); __velarReactiveCollectionTrack(value); for (let index = 0; index < items.length; index += 1) { const item = __velarReactiveCollectionRead(value, index, items[index]); const accepted = predicate(item); if (typeof accepted !== "boolean") throw new __velarCollectionNativeTypeError("List.find predicate must return bool"); if (accepted) return item; } return null; }
function __velarListIndex(value, item) { value = __velarValidateOwnedList(value, "List.index"); item = __velarReactiveRaw(item); __velarReactiveCollectionTrack(value); const owned = __velarListIsOwned(value); for (let index = 0; index < value.length; index += 1) if (__velarSameValueZero(__velarReactiveRaw(__velarListElement(value, index, "List.index", owned)), item)) return index; return null; }
function __velarListSome(value, predicate) { const items = __velarCopyList(value, "List.some"); __velarReactiveCollectionTrack(value); for (let index = 0; index < items.length; index += 1) { const accepted = predicate(__velarReactiveCollectionRead(value, index, items[index])); if (typeof accepted !== "boolean") throw new __velarCollectionNativeTypeError("List.some predicate must return bool"); if (accepted) return true; } return false; }
function __velarListEvery(value, predicate) { const items = __velarCopyList(value, "List.every"); __velarReactiveCollectionTrack(value); for (let index = 0; index < items.length; index += 1) { const accepted = predicate(__velarReactiveCollectionRead(value, index, items[index])); if (typeof accepted !== "boolean") throw new __velarCollectionNativeTypeError("List.every predicate must return bool"); if (!accepted) return false; } return true; }
function __velarListMap(value, transform) { const items = __velarCopyList(value, "List.map"); __velarReactiveCollectionTrack(value); const output = new __velarCollectionNativeArray(items.length); for (let index = 0; index < items.length; index += 1) { const item = transform(__velarReactiveCollectionRead(value, index, items[index])); output[index] = item === undefined ? null : __velarReactiveRaw(item); } return __velarAdoptList(output); }
function __velarListFilter(value, predicate) { const items = __velarCopyList(value, "List.filter"); __velarReactiveCollectionTrack(value); const output = []; for (let index = 0; index < items.length; index += 1) { const item = __velarReactiveCollectionRead(value, index, items[index]); const accepted = predicate(item); if (typeof accepted !== "boolean") throw new __velarCollectionNativeTypeError("List.filter predicate must return bool"); if (accepted) output[output.length] = __velarReactiveRaw(item); } return __velarAdoptList(output); }
function __velarListReduce(value, combine, initial) { const items = __velarCopyList(value, "List.reduce"); __velarReactiveCollectionTrack(value); let result = initial; for (let index = 0; index < items.length; index += 1) { const next = combine(result, __velarReactiveCollectionRead(value, index, items[index])); result = next === undefined ? null : next; } return result; }
function __velarListJoin(value, separator = "") { value = __velarValidateOwnedList(value, "List.join"); __velarReactiveCollectionTrack(value); if (typeof separator !== "string") throw new __velarCollectionNativeTypeError("List.join separator must be string"); const owned = __velarListIsOwned(value); for (let index = 0; index < value.length; index += 1) if (typeof __velarListElement(value, index, "List.join", owned) !== "string") throw new __velarCollectionNativeTypeError("List.join requires string values"); return __velarCollectionListHostJoin(value, separator); }
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
    __velarCollectionListHostSort(decorated, (left, right) => __velarOrderedCompare(kind, left.key, right.key));
    const selected = new __velarCollectionNativeArray(decorated.length);
    for (let index = 0; index < decorated.length; index += 1) selected[index] = decorated[index].item;
    return __velarAdoptList(selected);
  }
  let kind = null;
  if (compare === null) { for (let index = 0; index < output.length; index += 1) kind = __velarOrderedListValue(output[index], "List.sorted()", kind); }
  const compareValues = compare ?? ((left, right) => { kind = __velarOrderedListValue(left, "List.sorted()", kind); __velarOrderedListValue(right, "List.sorted()", kind); return __velarOrderedCompare(kind, left, right); });
  __velarCollectionListHostSort(output, (left, right) => { const order = compareValues(left, right); if (typeof order !== "number" || !__velarCollectionListIsFinite(order)) throw new __velarCollectionNativeTypeError("List.sorted comparator must return a finite number"); return order; });
  return output;
}
function __velarListSum(value) { const items = __velarCopyList(value, "List.sum"); __velarReactiveCollectionTrack(value); let total = 0; for (let index = 0; index < items.length; index += 1) { const item = __velarReactiveCollectionRead(value, index, items[index]); if (typeof item !== "number") throw new __velarCollectionNativeTypeError("List.sum requires numbers"); if (__velarCollectionListIsNaN(item)) throw new __velarCollectionNativeTypeError("List.sum found NaN, which poisons the total; drop it with filter(x => not x.isNaN()) or fix the upstream computation"); total += item; } return total; }
function __velarListExtremum(value, maximum) { const items = __velarCopyList(value, maximum ? "List.max" : "List.min"); __velarReactiveCollectionTrack(value); if (items.length === 0) return null; let result = __velarReactiveCollectionRead(value, 0, items[0]); let kind = __velarOrderedListValue(result, maximum ? "List.max" : "List.min"); for (let index = 1; index < items.length; index += 1) { const item = __velarReactiveCollectionRead(value, index, items[index]); __velarOrderedListValue(item, maximum ? "List.max" : "List.min", kind); const order = __velarOrderedCompare(kind, item, result); if (maximum ? order > 0 : order < 0) result = item; } return result; }
function __velarListMin(value) { return __velarListExtremum(value, false); }
function __velarListMax(value) { return __velarListExtremum(value, true); }
function __velarListReversed(value) { __velarReactiveCollectionTrack(value); const output = __velarCopyList(value, "List.reversed"); __velarCollectionListHostReverse(output); return output; }
// COL-U1: map-then-flatten-one-level. The transform must return a List for
// every element; its items append in order, under the one 1,000,000 budget.
function __velarListFlatMap(value, transform) {
  const items = __velarCopyList(value, "List.flatMap");
  __velarReactiveCollectionTrack(value);
  const output = [];
  for (let index = 0; index < items.length; index += 1) {
    const part = transform(__velarReactiveCollectionRead(value, index, items[index]));
    const values = __velarValidateOwnedList(part, "List.flatMap transform result");
    const partOwned = __velarListIsOwned(values);
    if (output.length + values.length > __velarMaxCollectionItems) throw new __velarCollectionListNativeRangeError("A List cannot exceed 1000000 items");
    for (let cursor = 0; cursor < values.length; cursor += 1) output[output.length] = __velarCollectionValue(__velarReactiveRaw(__velarListElement(values, cursor, "List.flatMap", partOwned)));
  }
  return __velarAdoptList(output);
}

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
// COL-U2: Set algebra. Each method reads both operands, copies (never
// mutates, exactly like sorted), and answers by SameValueZero membership.
function __velarSetAlgebraOperands(value, other, name) {
  value = __velarReactiveRaw(value);
  other = __velarReactiveRaw(other);
  if (!__velarIsSet(other)) throw new __velarCollectionNativeTypeError(name + " requires a Set");
  if (__velarCollectionSetMapSetSize(value) > __velarMaxCollectionItems || __velarCollectionSetMapSetSize(other) > __velarMaxCollectionItems) {
    throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items");
  }
  __velarReactiveCollectionTrack(value);
  __velarReactiveCollectionTrack(other);
  return [value, other];
}
function __velarSetUnion(value, other) {
  const operands = __velarSetAlgebraOperands(value, other, "Set.union");
  const output = new __velarCollectionNativeSet();
  const first = __velarCollectionSetMapSetValues(operands[0]);
  while (true) { const step = __velarCollectionSetMapSetNext(first); if (step.done) break; __velarCollectionSetMapSetAdd(output, step.value); }
  const second = __velarCollectionSetMapSetValues(operands[1]);
  while (true) {
    const step = __velarCollectionSetMapSetNext(second);
    if (step.done) break;
    const member = __velarCollectionValue(__velarReactiveRaw(step.value));
    if (!__velarCollectionSetMapSetHas(output, member) && __velarCollectionSetMapSetSize(output) >= __velarMaxCollectionItems) {
      throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items");
    }
    __velarCollectionSetMapSetAdd(output, member);
  }
  return output;
}
function __velarSetIntersection(value, other) {
  const operands = __velarSetAlgebraOperands(value, other, "Set.intersection");
  const output = new __velarCollectionNativeSet();
  const iterator = __velarCollectionSetMapSetValues(operands[0]);
  while (true) { const step = __velarCollectionSetMapSetNext(iterator); if (step.done) return output; if (__velarCollectionSetMapSetHas(operands[1], step.value)) __velarCollectionSetMapSetAdd(output, step.value); }
}
function __velarSetDifference(value, other) {
  const operands = __velarSetAlgebraOperands(value, other, "Set.difference");
  const output = new __velarCollectionNativeSet();
  const iterator = __velarCollectionSetMapSetValues(operands[0]);
  while (true) { const step = __velarCollectionSetMapSetNext(iterator); if (step.done) return output; if (!__velarCollectionSetMapSetHas(operands[1], step.value)) __velarCollectionSetMapSetAdd(output, step.value); }
}

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

function __velarListHas(value, item) { value = __velarValidateOwnedList(value, "List.has"); item = __velarReactiveRaw(item); __velarReactiveCollectionTrack(value); const owned = __velarListIsOwned(value); for (let index = 0; index < value.length; index += 1) if (__velarSameValueZero(__velarReactiveRaw(__velarListElement(value, index, "List.has", owned)), item)) return true; return false; }
function __velarRecordHas(value, item) { value = __velarReactiveRaw(value); item = __velarReactiveRaw(item); if (typeof item !== "string") throw new __velarCollectionNativeTypeError("Record.has requires a string key"); __velarRecordFields(value, "Record.has"); __velarReactiveCollectionTrack(value, item); return __velarCollectionRecordGetOwnPropertyDescriptor(value, item) !== undefined; }
function __velarMapHas(value, item) { value = __velarReactiveRaw(value); item = __velarReactiveRaw(item); const size = __velarCheckedMapSize(value, "Map.has"); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries"); __velarReactiveCollectionTrack(value, item); return __velarCollectionSetMapMapHas(value, item); }
function __velarSetHas(value, item) { value = __velarReactiveRaw(value); item = __velarReactiveRaw(item); const size = __velarCheckedSetSize(value, "Set.has"); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items"); __velarReactiveCollectionTrack(value, item); return __velarCollectionSetMapSetHas(value, item); }
function __velarCollectionHas(value, item) {
  const raw = __velarReactiveRaw(value);
  if (__velarCollectionListIsArray(raw)) return __velarListHas(raw, item);
  if (__velarIsRecord(raw)) return __velarRecordHas(raw, item);
  if (__velarIsMap(raw)) return __velarMapHas(raw, item);
  if (__velarIsSet(raw)) return __velarSetHas(raw, item);
  throw new __velarCollectionNativeTypeError("VelarScript membership requires a List, Set, Map, or Record");
}
// Membership keeps source evaluation order (item before container) while the
// method-shaped helpers keep receiver-first order for values.has(item).
function __velarListContains(item, value) { return __velarListHas(value, item); }
function __velarMapContains(item, value) { return __velarMapHas(value, item); }
function __velarSetContains(item, value) { return __velarSetHas(value, item); }
function __velarRecordContains(item, value) { return __velarRecordHas(value, item); }
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
      const leftOwned = __velarListIsOwned(leftList);
      const rightOwned = __velarListIsOwned(rightList);
      for (let index = 0; index < leftList.length; index += 1) {
        if (!__velarEqualsVisit(__velarListElement(leftList, index, "equals", leftOwned), __velarListElement(rightList, index, "equals", rightOwned), active, depth + 1)) return false;
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

function __velarRecordRemove(value, item) {
  value = __velarReactiveRaw(value); item = __velarReactiveRaw(item);
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
function __velarMapRemove(value, item) {
  value = __velarReactiveRaw(value); item = __velarReactiveRaw(item);
  const size = __velarCheckedMapSize(value, "Map.remove");
  if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  const previous = __velarCollectionSetMapMapGet(value, item);
  const removed = __velarCollectionSetMapMapDelete(value, item);
  if (removed) { __velarReactiveCollectionUnlink(value, item); __velarReactiveCollectionUnlink(value, previous); __velarReactiveCollectionTrigger(value, item, true, true); }
  return removed;
}
function __velarSetRemove(value, item) {
  value = __velarReactiveRaw(value); item = __velarReactiveRaw(item);
  const size = __velarCheckedSetSize(value, "Set.remove");
  if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items");
  const removed = __velarCollectionSetMapSetDelete(value, item);
  if (removed) { __velarReactiveCollectionUnlink(value, item); __velarReactiveCollectionTrigger(value, item, true, true); }
  return removed;
}
function __velarCollectionRemove(value, item) {
  const raw = __velarReactiveRaw(value);
  if (__velarIsRecord(raw)) return __velarRecordRemove(raw, item);
  if (__velarIsMap(raw)) return __velarMapRemove(raw, item);
  return __velarSetRemove(raw, item);
}

function __velarListClear(value) {
  value = __velarReactiveRaw(value);
  const previous = __velarCopyList(value, "List.clear");
  if (previous.length === 0) return null;
  __velarListRequireMutableLength(value, "List.clear");
  value.length = 0;
  __velarMarkOwnedList(value);
  for (let index = 0; index < previous.length; index += 1) __velarReactiveCollectionUnlink(value, previous[index]);
  __velarReactiveCollectionTrigger(value, __velarReactiveIterateKey, true, true, 0);
  return null;
}
function __velarRecordClear(value) {
  value = __velarReactiveRaw(value);
  const fields = __velarRecordFields(value, "Record.clear");
  if (fields.length === 0) return null;
  const previous = new __velarCollectionNativeArray(fields.length);
  for (let index = 0; index < fields.length; index += 1) { const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, fields[index]); if (!descriptor.configurable) throw new __velarCollectionNativeTypeError("Record.clear requires configurable data fields"); previous[index] = descriptor.value; }
  for (let index = 0; index < fields.length; index += 1) if (!__velarCollectionRecordDeleteProperty(value, fields[index])) throw new __velarCollectionNativeTypeError("Record.clear could not delete a field");
  for (let index = 0; index < previous.length; index += 1) __velarReactiveCollectionUnlink(value, previous[index]);
  __velarReactiveCollectionTrigger(value, __velarReactiveIterateKey, true, true, null, true);
  return null;
}
function __velarMapClear(value) {
  value = __velarReactiveRaw(value);
  const size = __velarCheckedMapSize(value, "Map.clear");
  if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  if (size === 0) return null;
  const previous = new __velarCollectionNativeArray(size * 2);
  const iterator = __velarCollectionSetMapMapEntries(value);
  let index = 0;
  while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) break; previous[index++] = step.value[0]; previous[index++] = step.value[1]; }
  __velarCollectionSetMapMapClear(value);
  for (let previousIndex = 0; previousIndex < previous.length; previousIndex += 1) __velarReactiveCollectionUnlink(value, previous[previousIndex]);
  __velarReactiveCollectionTrigger(value, __velarReactiveIterateKey, true, true, null, true);
  return null;
}
function __velarSetClear(value) {
  value = __velarReactiveRaw(value);
  const size = __velarCheckedSetSize(value, "Set.clear");
  if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items");
  if (size === 0) return null;
  const previous = new __velarCollectionNativeArray(size);
  const iterator = __velarCollectionSetMapSetValues(value);
  let index = 0;
  while (true) { const step = __velarCollectionSetMapSetNext(iterator); if (step.done) break; previous[index++] = step.value; }
  __velarCollectionSetMapSetClear(value);
  for (let previousIndex = 0; previousIndex < previous.length; previousIndex += 1) __velarReactiveCollectionUnlink(value, previous[previousIndex]);
  __velarReactiveCollectionTrigger(value, __velarReactiveIterateKey, true, true, null, true);
  return null;
}
function __velarCollectionClear(value) {
  const raw = __velarReactiveRaw(value);
  if (__velarCollectionListIsArray(raw)) return __velarListClear(raw);
  if (__velarIsRecord(raw)) return __velarRecordClear(raw);
  if (__velarIsMap(raw)) return __velarMapClear(raw);
  return __velarSetClear(raw);
}

function __velarRecordKeys(value) {
  value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value, __velarReactiveStructureKey);
  const fields = __velarRecordFields(value, "Record.keys");
  const output = new __velarCollectionNativeArray(fields.length);
  for (let index = 0; index < fields.length; index += 1) output[index] = __velarReactiveCollectionRead(value, __velarReactiveStructureKey, fields[index]);
  return __velarAdoptList(output);
}
function __velarMapKeys(value) {
  value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value, __velarReactiveStructureKey);
  const size = __velarCheckedMapSize(value, "Map.keys");
  if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  const output = new __velarCollectionNativeArray(size); const iterator = __velarCollectionSetMapMapKeys(value); let index = 0;
  while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) return __velarAdoptList(output); output[index++] = __velarReactiveCollectionRead(value, __velarReactiveStructureKey, step.value); }
}
function __velarCollectionKeys(value) { value = __velarReactiveRaw(value); return __velarIsRecord(value) ? __velarRecordKeys(value) : __velarMapKeys(value); }

function __velarRecordValues(value) {
  value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value);
  const fields = __velarRecordFields(value, "Record.values"); const output = new __velarCollectionNativeArray(fields.length);
  for (let index = 0; index < fields.length; index += 1) { const field = fields[index]; output[index] = __velarReactiveCollectionRead(value, field, __velarCollectionRecordGetOwnPropertyDescriptor(value, field).value); }
  return __velarAdoptList(output);
}
function __velarMapValues(value) {
  value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value);
  const size = __velarCheckedMapSize(value, "Map.values"); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  const output = new __velarCollectionNativeArray(size); const iterator = __velarCollectionSetMapMapValues(value); let index = 0;
  while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) return __velarAdoptList(output); output[index++] = __velarReactiveCollectionRead(value, __velarReactiveIterateKey, step.value); }
}
function __velarSetValues(value) {
  value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value);
  const size = __velarCheckedSetSize(value, "Set.values"); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Set cannot exceed 1000000 items");
  const output = new __velarCollectionNativeArray(size); const iterator = __velarCollectionSetMapSetValues(value); let index = 0;
  while (true) { const step = __velarCollectionSetMapSetNext(iterator); if (step.done) return __velarAdoptList(output); output[index++] = __velarReactiveCollectionRead(value, __velarReactiveIterateKey, step.value); }
}
function __velarCollectionValues(value) {
  value = __velarReactiveRaw(value);
  if (__velarIsRecord(value)) return __velarRecordValues(value);
  if (__velarIsMap(value)) return __velarMapValues(value);
  return __velarSetValues(value);
}

function __velarRecordEntries(value) {
  value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value);
  const fields = __velarRecordFields(value, "Record.entries"); const output = new __velarCollectionNativeArray(fields.length);
  for (let index = 0; index < fields.length; index += 1) { const field = fields[index]; output[index] = __velarCollectionRecordFreeze({ key: __velarReactiveCollectionRead(value, __velarReactiveIterateKey, field), value: __velarReactiveCollectionRead(value, field, __velarCollectionRecordGetOwnPropertyDescriptor(value, field).value) }); }
  return __velarAdoptList(output);
}
function __velarMapEntries(value) {
  value = __velarReactiveRaw(value); __velarReactiveCollectionTrack(value);
  const size = __velarCheckedMapSize(value, "Map.entries"); if (size > __velarMaxCollectionItems) throw new __velarCollectionSetMapNativeRangeError("A Map cannot exceed 1000000 entries");
  const output = new __velarCollectionNativeArray(size); const iterator = __velarCollectionSetMapMapEntries(value); let index = 0;
  while (true) { const step = __velarCollectionSetMapMapNext(iterator); if (step.done) return __velarAdoptList(output); const entry = step.value; output[index++] = __velarCollectionSetMapFreeze({ key: __velarReactiveCollectionRead(value, __velarReactiveIterateKey, entry[0]), value: __velarReactiveCollectionRead(value, entry[0], entry[1]) }); }
}
function __velarCollectionEntries(value) { value = __velarReactiveRaw(value); return __velarIsRecord(value) ? __velarRecordEntries(value) : __velarMapEntries(value); }
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
