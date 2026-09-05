/**
 * The runtime helper a lowered expression calls, by name. Every one of these is
 * a lookup: the analyzer already decided that this member access is a List
 * `map` or a UInt8Buffer index, and recorded it in `LoweringHints`; what is
 * left is the exported name of the runtime function that performs it.
 *
 * D114 R1c: these were `JavaScriptEmitter` methods beside the expression
 * emission that calls them. They are one cohesive thing — the map from a
 * lowering decision to a runtime name — and both the statement and the
 * expression families read them, so they are their own collaborator.
 */
import type { BinaryStorageKind } from "../types.ts";
import type { Expression } from "../ast.ts";
import type { LoweringHints } from "../contracts.ts";

export interface RuntimeHelperNameHost {
  readonly hints: LoweringHints;
}

export class RuntimeHelperNames {
  private readonly host: RuntimeHelperNameHost;

  constructor(host: RuntimeHelperNameHost) {
    this.host = host;
  }

  collectionHelper(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null {
    switch (this.host.hints.collectionCalls.get(expression.span.end)) {
      case "listGet": return "__velarListGet";
      case "mapGet": return "__velarMapGet";
      case "recordGet": return "__velarRecordGet";
      case "slice": return "__velarCollectionSlice";
      case "listAppend": return "__velarListAppend";
      case "listExtend": return "__velarListExtend";
      case "listInsert": return "__velarListInsert";
      case "listRemove": return "__velarListRemove";
      case "listPop": return "__velarListPop";
      case "listClear": return "__velarListClear";
      case "listCopy": return "__velarListCopy";
      case "listHas": return "__velarListHas";
      case "listCount": return "__velarListCount";
      case "listFind": return "__velarListFind";
      case "listIndex": return "__velarListIndex";
      case "listSome": return "__velarListSome";
      case "listEvery": return "__velarListEvery";
      case "listMap": return "__velarListMap";
      case "listFilter": return "__velarListFilter";
      case "listFlatMap": return "__velarListFlatMap";
      case "listReduce": return "__velarListReduce";
      case "listJoin": return "__velarListJoin";
      case "listSorted": return "__velarListSorted";
      case "listReversed": return "__velarListReversed";
      case "listSum": return "__velarListSum";
      case "listMin": return "__velarListMin";
      case "listMax": return "__velarListMax";
      case "listUnique": return "__velarListUnique";
      case "listCompact": return "__velarListCompact";
      case "listFlatten": return "__velarListFlatten";
      case "listChunk": return "__velarListChunk";
      case "listPartition": return "__velarListPartition";
      case "listGroupBy": return "__velarListGroupBy";
      case "listKeyBy": return "__velarListKeyBy";
      case "listCountBy": return "__velarListCountBy";
      case "listZip": return "__velarListZip";
      case "listRepeat": return "__velarListRepeat";
      case "setAdd": return "__velarSetAdd";
      case "setUpdate": return "__velarSetUpdate";
      case "setHas": return "__velarSetHas";
      case "setRemove": return "__velarSetRemove";
      case "setClear": return "__velarSetClear";
      case "setValues": return "__velarSetValues";
      case "setCopy": return "__velarSetCopy";
      case "setUnion": return "__velarSetUnion";
      case "setIntersection": return "__velarSetIntersection";
      case "setDifference": return "__velarSetDifference";
      case "mapSet": return "__velarMapSet";
      case "mapGetOrSet": return "__velarMapGetOrSet";
      case "mapGetOrSetWith": return "__velarMapGetOrSetWith";
      case "mapUpdate": return "__velarMapUpdate";
      case "mapHas": return "__velarMapHas";
      case "mapRemove": return "__velarMapRemove";
      case "mapClear": return "__velarMapClear";
      case "mapIterator": return "__velarMapIterator";
      case "mapKeys": return "__velarMapKeys";
      case "mapValues": return "__velarMapValues";
      case "mapEntries": return "__velarMapEntries";
      case "mapCopy": return "__velarMapCopy";
      case "recordSet": return "__velarRecordSet";
      case "recordHas": return "__velarRecordHas";
      case "recordRemove": return "__velarRecordRemove";
      case "recordClear": return "__velarRecordClear";
      case "recordKeys": return "__velarRecordKeys";
      case "recordValues": return "__velarRecordValues";
      case "recordEntries": return "__velarRecordEntries";
      case "recordCopy": return "__velarRecordCopy";
      default: return null;
    }
  }

  collectionSizeHelper(kind: "list" | "map" | "set" | "record"): string {
    switch (kind) {
      case "list": return "__velarListSize";
      case "map": return "__velarMapSize";
      case "set": return "__velarSetSize";
      case "record": return "__velarRecordSize";
    }
  }

  collectionIteratorHelper(kind: "list" | "map" | "set" | "record" | "string" | "binary", pair: boolean): string {
    if (kind === "binary") return pair
      ? "__velarBinaryRuntime.__velarBufferPairIterator"
      : "__velarBinaryRuntime.__velarBufferIterator";
    if (pair) {
      if (kind === "map") return "__velarReactiveMapPairIterator";
      if (kind === "record") return "__velarReactiveRecordPairIterator";
      return "__velarCollectionPairIterator";
    }
    switch (kind) {
      case "list": return "__velarReactiveListIterator";
      case "map": return "__velarReactiveMapKeyIterator";
      case "set": return "__velarReactiveSetIterator";
      case "record": return "__velarReactiveRecordIterator";
      case "string": return "__velarCollectionIterator";
    }
  }

  binaryHelper(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null {
    switch (this.host.hints.binaryCalls.get(expression.span.end)) {
      case "bufferCopy": return "__velarBinaryRuntime.__velarBufferCopy";
      case "bufferSlice": return "__velarBinaryRuntime.__velarBufferSlice";
      case "bufferToBytes": return "__velarBinaryRuntime.__velarBufferToBytes";
      case "bufferValues": return "__velarBinaryRuntime.__velarBufferValues";
      default: return null;
    }
  }

  binaryIndexHelper(kind: BinaryStorageKind): string {
    switch (kind) {
      case "bytes": return "__velarIndex";
      case "uint8": return "__velarUInt8Index";
      case "uint16": return "__velarUInt16Index";
      case "uint32": return "__velarUInt32Index";
      case "float32": return "__velarFloat32Index";
    }
  }

  binarySetIndexHelper(kind: Exclude<BinaryStorageKind, "bytes">): string {
    switch (kind) {
      case "uint8": return "__velarUInt8SetIndex";
      case "uint16": return "__velarUInt16SetIndex";
      case "uint32": return "__velarUInt32SetIndex";
      case "float32": return "__velarFloat32SetIndex";
    }
  }

  primitiveHelper(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null {
    switch (this.host.hints.primitiveCalls.get(expression.span.end)) {
      case "stringTrim": return "__velarStringTrim";
      case "stringUpper": return "__velarStringUpper";
      case "stringLower": return "__velarStringLower";
      case "stringSlice": return "__velarStringSlice";
      case "stringChar": return "__velarStringChar";
      case "stringHas": return "__velarStringHas";
      case "stringIndex": return "__velarStringIndex";
      case "stringCount": return "__velarStringCount";
      case "stringStartsWith": return "__velarStringStartsWith";
      case "stringEndsWith": return "__velarStringEndsWith";
      case "stringSplit": return "__velarStringSplit";
      case "stringReplace": return "__velarStringReplace";
      case "stringReplaceAll": return "__velarStringReplaceAll";
      case "stringPadStart": return "__velarStringPadStart";
      case "stringPadEnd": return "__velarStringPadEnd";
      case "stringRepeat": return "__velarStringRepeat";
      case "stringIsBlank": return "__velarStringIsBlank";
      case "numberAbs": return "__velarNumberAbs";
      case "numberRound": return "__velarNumberRound";
      case "numberFloor": return "__velarNumberFloor";
      case "numberCeil": return "__velarNumberCeil";
      case "numberSign": return "__velarNumberSign";
      case "numberTrunc": return "__velarNumberTrunc";
      case "numberToFixed": return "__velarNumberToFixed";
      case "numberIsInteger": return "__velarNumberIsInteger";
      case "numberIsNaN": return "__velarNumberIsNaN";
      case "numberIsFinite": return "__velarNumberIsFinite";
      default: return null;
    }
  }
}
