/**
 * The compiler-owned collection rosters: which member names a List, Map, Set
 * or Record publishes, what lowering operation each one names, which of them
 * mutate their receiver, and which return a fresh value a statement must not
 * discard.
 *
 * D115 §三: this was the head of `analysis/collections.ts`. It is data, not
 * inference — no host, no analyzer — and it is read from three places (the
 * call families here, member resolution in `../members.ts`, and the analyzer's
 * discarded-result check), so it is the one file of this directory that
 * depends on nothing else in it.
 */
import { type CollectionOperation } from "../../contracts.ts";

export const listCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "listGet"], ["slice", "slice"], ["append", "listAppend"], ["extend", "listExtend"],
  ["insert", "listInsert"], ["remove", "listRemove"], ["pop", "listPop"],
  ["clear", "listClear"], ["copy", "listCopy"], ["has", "listHas"], ["count", "listCount"],
  ["index", "listIndex"], ["find", "listFind"], ["some", "listSome"], ["every", "listEvery"],
  ["map", "listMap"], ["filter", "listFilter"], ["flatMap", "listFlatMap"], ["reduce", "listReduce"], ["join", "listJoin"],
  ["sorted", "listSorted"], ["reversed", "listReversed"], ["sum", "listSum"], ["min", "listMin"], ["max", "listMax"],
  // D114 S3: the pipeline members that replaced the retired velar/collections
  // functions. They are compiler-owned checked value methods like the rest.
  ["unique", "listUnique"], ["compact", "listCompact"], ["flatten", "listFlatten"], ["chunk", "listChunk"],
  ["partition", "listPartition"], ["groupBy", "listGroupBy"], ["keyBy", "listKeyBy"], ["countBy", "listCountBy"],
  ["zip", "listZip"], ["repeat", "listRepeat"],
]);
export const mapCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "mapGet"], ["set", "mapSet"], ["getOrSet", "mapGetOrSet"], ["getOrSetWith", "mapGetOrSetWith"], ["update", "mapUpdate"], ["has", "mapHas"],
  ["remove", "mapRemove"], ["clear", "mapClear"], ["copy", "mapCopy"], ["iterator", "mapIterator"],
  ["keys", "mapKeys"], ["values", "mapValues"], ["entries", "mapEntries"],
]);
export const setCollectionOperations = new Map<string, CollectionOperation>([
  ["add", "setAdd"], ["update", "setUpdate"], ["has", "setHas"], ["remove", "setRemove"],
  ["clear", "setClear"], ["copy", "setCopy"], ["values", "setValues"],
  ["union", "setUnion"], ["intersection", "setIntersection"], ["difference", "setDifference"],
]);
export const recordCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "recordGet"], ["set", "recordSet"], ["has", "recordHas"], ["remove", "recordRemove"],
  ["clear", "recordClear"], ["copy", "recordCopy"], ["keys", "recordKeys"], ["values", "recordValues"], ["entries", "recordEntries"],
]);

// D29 item 14: compiler-owned value/collection methods that return a fresh
// value without mutating their receiver. An expression statement that calls
// one of these and drops the result is always a bug. Mutate-and-return
// operations (pop/remove) and null-returning mutators stay legal,
// and user-function purity is deliberately never analyzed (D26 retired that).
export const discardedPureCollectionOperations = new Set<CollectionOperation>([
  "listGet", "mapGet", "recordGet", "slice", "listCopy", "listCount", "listIndex", "listFind", "listSome", "listEvery",
  "listMap", "listFilter", "listFlatMap", "listReduce", "listJoin", "listSorted", "listReversed",
  "listSum", "listMin", "listMax", "setCopy", "setUnion", "setIntersection", "setDifference", "mapCopy", "recordCopy",
  "listUnique", "listCompact", "listFlatten", "listChunk", "listPartition", "listGroupBy", "listKeyBy", "listCountBy",
  "listZip", "listRepeat",
  "listHas", "mapHas", "setHas", "recordHas", "mapIterator", "mapKeys", "recordKeys", "mapValues", "setValues", "recordValues", "mapEntries", "recordEntries",
]);

export const CORE_LIST_METHOD_NAMES = Object.freeze([
  "get", "slice", "append", "extend", "insert", "remove", "pop", "clear", "copy", "has", "count", "index",
  "find", "some", "every", "map", "flatMap", "filter", "reduce", "join", "sorted", "reversed", "sum", "min", "max",
  "unique", "compact", "flatten", "chunk", "partition", "groupBy", "keyBy", "countBy", "zip", "repeat",
] as const);
export const CORE_MAP_METHOD_NAMES = Object.freeze([
  "get", "set", "getOrSet", "getOrSetWith", "update", "has", "remove", "clear", "copy", "iterator", "keys", "values", "entries",
] as const);
export const CORE_SET_METHOD_NAMES = Object.freeze([
  "add", "update", "has", "remove", "clear", "copy", "values", "union", "intersection", "difference",
] as const);
export const CORE_RECORD_METHOD_NAMES = Object.freeze([
  "get", "set", "has", "remove", "clear", "copy", "keys", "values", "entries",
] as const);

/**
 * The collection methods that change their receiver, by the kind of collection
 * the receiver is. `readonly` refuses exactly these through a read-only view,
 * and the Web extension's watch analysis asks the same question of a watch
 * body: a call of one of these on the watched collection is a write of the
 * subject, exactly as an assignment to it is.
 *
 * One roster, one answer. Two copies of it would be one concept with two
 * definitions -- the shape this repository keeps finding -- and the copy that
 * fell behind would be the one that decided whether a program compiles.
 */
export function mutatingCollectionMethods(kind: "list" | "map" | "set" | "record"): ReadonlySet<string> {
  return kind === "list"
    ? new Set(["append", "extend", "insert", "remove", "pop", "clear"])
    : kind === "map" ? new Set(["set", "getOrSet", "getOrSetWith", "update", "remove", "clear"])
      : kind === "set" ? new Set(["add", "update", "remove", "clear"])
        : new Set(["set", "remove", "clear"]);
}
