/**
 * The runtime modules the compiler owns: the specifier each one is imported
 * under, and the roster of names it publishes.
 *
 * D115 §一.4 / §三 — the bodies of these modules are real JavaScript under
 * `packages/compiler/runtime/`, reached through `runtime-sources.generated.ts`.
 * What stays here is what is not JavaScript: the module identities, the export
 * rosters that generated code and this repository's gates both read, and the
 * host error names the analyzer needs long before anything is emitted.
 */

export const VELAR_REACTIVE_BRIDGE_MODULE = "velar/compiler-runtime-reactive-v1";

export const VELAR_CLASS_FIELD_MODULE = "velar/compiler-runtime-class-fields-v1";

export const VELAR_NARROWING_MODULE = "velar/compiler-runtime-narrowing-v1";

export const VELAR_PRIMITIVE_METHOD_MODULE = "velar/compiler-runtime-primitives-v1";

export const VELAR_PROMISE_NORMALIZATION_MODULE = "velar/compiler-runtime-promises-v1";

export const VELAR_RANGE_MODULE = "velar/compiler-runtime-range-v1";

export const VELAR_TYPE_VALIDATION_MODULE = "velar/compiler-runtime-types-v1";

export const VELAR_ERROR_NORMALIZATION_MODULE = "velar/compiler-runtime-errors-v1";

/**
 * D50 rule 89: the capability failures a caller recovers from differently.
 * Each name has a real throw site behind a standard capability; none exists
 * for symmetry. `path` carries the resource that failed, because every
 * recovery path — create it, ask for permission, pick another name — needs to
 * know which one it was; it is optional because a hand-written instance has no
 * host path to report. AddressInUseError carries no extra field: "pick another
 * port" needs nothing the message does not already say.
 */
export const VELAR_HOST_ERROR_NAMES = [
  "FileNotFoundError",
  "PermissionError",
  "NotADirectoryError",
  "FileExistsError",
  "AddressInUseError",
] as const;

export const VELAR_HOST_ERROR_PATH_NAMES: readonly string[] = VELAR_HOST_ERROR_NAMES
  .filter((name) => name !== "AddressInUseError");

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
  "__velarCollectionListIsSafeInteger",
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
  "__velarListUnique",
  "__velarListCompact",
  "__velarListFlatten",
  "__velarListChunk",
  "__velarListPartition",
  "__velarListGroupBy",
  "__velarListKeyBy",
  "__velarListCountBy",
  "__velarListZip",
  "__velarListRepeat",
  "__velarSetAdd",
  "__velarSetUpdate",
  "__velarSetCopy",
  "__velarSetUnion",
  "__velarSetIntersection",
  "__velarSetDifference",
  "__velarMapSet",
  "__velarMapGetOrSet",
  "__velarMapGetOrSetWith",
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
  "__velarMapIterator",
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
