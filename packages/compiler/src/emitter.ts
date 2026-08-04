import type {
  ClassDeclaration,
  BindingPattern,
  EnumDeclaration,
  Expression,
  MatchPattern,
  Program,
  Statement,
  TypeAliasDeclaration,
  TypeDeclaration,
  TypeReference,
} from "./ast.ts";
import { formatTypeReference, resolveTypeReference, type ValueType } from "./types.ts";
import type { LoweringHints } from "./analyzer.ts";
import type { SourceText, Span } from "./source.ts";

interface JavaScriptNode {
  readonly id: number;
  readonly code: string;
  readonly sourceSpan: Span;
}

interface GeneratedMapping {
  readonly offset: number;
  readonly sourceSpan: Span;
}

const javaScriptNodeMarker = /\u0000VELAR_MAP_(\d+)\u0000/gu;

export class JavaScriptEmitter {
  private readonly typeDeclarations = new Map<string, TypeDeclaration | TypeAliasDeclaration>();
  private readonly runtimeTypes = new Set<string>();
  private readonly expandedRuntimeTypes = new Set<string>();
  protected readonly hints: LoweringHints;
  private readonly forcedFunctionExports: ReadonlySet<string>;
  private needsIndexHelpers = false;
  private needsCollectionHelpers = false;
  private needsRuntimeTypeHelpers = false;
  private needsNumberHelper = false;
  private suppressPromiseNormalization = 0;
  private nextJavaScriptNodeId = 0;
  private readonly javaScriptNodeSpans = new Map<number, Span>();
  private generatedMappings: readonly GeneratedMapping[] = [];
  private generatedCode = "";

  constructor(hints: LoweringHints, forcedFunctionExports: ReadonlySet<string> = new Set()) {
    this.hints = hints;
    this.forcedFunctionExports = forcedFunctionExports;
  }

  emit(program: Program): string {
    this.nextJavaScriptNodeId = 0;
    this.javaScriptNodeSpans.clear();
    this.collectDeclarations(program);
    this.collectRuntimeUses(program);
    const statements = program.body
      .map((statement) => this.emitJavaScriptNode(statement.span, () => this.emitStatement(statement, 0)))
      .filter((item) => item.code.length > 0);

    const helpers: string[] = [...this.additionalHelpers(program)];
    if (this.hints.normalizedPromiseValues.size > 0) {
      helpers.push([
        "const __velarNormalizedPromiseRegistryKey = Symbol.for(\"velar.promise.normalization.v1\");",
        "const __velarNormalizedPromiseValues = (() => {",
        "  const descriptor = Object.getOwnPropertyDescriptor(globalThis, __velarNormalizedPromiseRegistryKey);",
        "  if (descriptor) {",
        "    if (!(\"value\" in descriptor)) throw new TypeError(\"VelarScript Promise normalization registry cannot be an accessor\");",
        "    try { WeakMap.prototype.has.call(descriptor.value, descriptor.value); }",
        "    catch { throw new TypeError(\"VelarScript Promise normalization registry is invalid\"); }",
        "    return descriptor.value;",
        "  }",
        "  const registry = new WeakMap();",
        "  Object.defineProperty(globalThis, __velarNormalizedPromiseRegistryKey, { value: registry, enumerable: false, configurable: false, writable: false });",
        "  return registry;",
        "})();",
        "function __velarNormalizePromiseValue(value) {",
        "  if ((typeof value !== \"object\" && typeof value !== \"function\") || value === null) throw new TypeError(\"Expected a Promise from JavaScript\");",
        "  const known = __velarNormalizedPromiseValues.get(value);",
        "  if (known) return known;",
        "  const normalized = Promise.resolve(value).then((resolved) => resolved ?? null);",
        "  __velarNormalizedPromiseValues.set(value, normalized);",
        "  __velarNormalizedPromiseValues.set(normalized, normalized);",
        "  return normalized;",
        "}",
      ].join("\n"));
    }
    const needsRuntimeTypeRuntime = this.needsRuntimeTypeHelpers || this.runtimeTypes.size > 0
      || program.body.some((statement) => statement.kind === "EnumDeclaration");
    if (needsRuntimeTypeRuntime || this.needsCollectionHelpers) {
      helpers.push([
        "function __velarIsMap(value) {",
        "  try { Reflect.getOwnPropertyDescriptor(Map.prototype, \"size\").get.call(value); return true; }",
        "  catch { return false; }",
        "}",
        "function __velarIsSet(value) {",
        "  try { Reflect.getOwnPropertyDescriptor(Set.prototype, \"size\").get.call(value); return true; }",
        "  catch { return false; }",
        "}",
      ].join("\n"));
    }
    if (needsRuntimeTypeRuntime) {
      helpers.push([
        "const __velarRuntimeTypeRegistryKey = Symbol.for(\"velar.type.registry.v1\");",
        "const __velarRuntimeTypeRegistry = (() => {",
        "  const descriptor = Object.getOwnPropertyDescriptor(globalThis, __velarRuntimeTypeRegistryKey);",
        "  if (descriptor) {",
        "    if (!(\"value\" in descriptor)) throw new TypeError(\"VelarScript runtime type registry cannot be an accessor\");",
        "    try { WeakSet.prototype.has.call(descriptor.value, descriptor.value); }",
        "    catch { throw new TypeError(\"VelarScript runtime type registry is invalid\"); }",
        "    return descriptor.value;",
        "  }",
        "  const registry = new WeakSet();",
        "  Object.defineProperty(globalThis, __velarRuntimeTypeRegistryKey, {",
        "    value: registry,",
        "    enumerable: false,",
        "    configurable: false,",
        "    writable: false,",
        "  });",
        "  return registry;",
        "})();",
        "",
        "function __velarRegisterType(value) {",
        "  __velarRuntimeTypeRegistry.add(value);",
        "  return value;",
        "}",
        "",
        "function __velarListTypeIs(value, check) {",
        "  if (!Array.isArray(value) || value.length > 1000000 || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) return false;",
        "  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, \"length\");",
        "  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable || lengthDescriptor.configurable || !(\"value\" in lengthDescriptor)) return false;",
        "  for (let index = 0; index < value.length; index += 1) {",
        "    const descriptor = Object.getOwnPropertyDescriptor(value, index);",
        "    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !(\"value\" in descriptor) || !check(descriptor.value)) return false;",
        "  }",
        "  return true;",
        "}",
        "",
        "function __velarSetTypeIs(value, check) {",
        "  if (!__velarIsSet(value) || Reflect.getOwnPropertyDescriptor(Set.prototype, \"size\").get.call(value) > 1000000) return false;",
        "  for (const item of Set.prototype.values.call(value)) if (!check(item)) return false;",
        "  return true;",
        "}",
        "",
        "function __velarMapTypeIs(value, check) {",
        "  if (!__velarIsMap(value) || Reflect.getOwnPropertyDescriptor(Map.prototype, \"size\").get.call(value) > 1000000) return false;",
        "  for (const [key, item] of Map.prototype.entries.call(value)) if (!check(key, item)) return false;",
        "  return true;",
        "}",
      ].join("\n"));
      helpers.push("class __VelarValidationError extends TypeError {\n  constructor(message) {\n    super(message);\n    this.name = \"ValidationError\";\n  }\n}");
    }
    if (this.needsIndexHelpers) {
      helpers.push([
        "class __VelarIndexError extends RangeError {",
        "  constructor(message) {",
        "    super(message);",
        "    this.name = \"IndexError\";",
        "  }",
        "}",
        "",
        "function __velarIndex(value, index) {",
        "  __velarValidateDenseList(value, \"List index\");",
        "  if (!Number.isInteger(index) || index < 0 || index >= value.length) {",
        "    throw new __VelarIndexError(`Index ${index} is outside the list`);",
        "  }",
        "  return value[index];",
        "}",
        "",
        "function __velarOptionalIndex(value, index) {",
        "  return value == null ? null : __velarIndex(value, index());",
        "}",
        "",
        "function __velarSetIndex(value, index, next) {",
        "  __velarValidateDenseList(value, \"List index assignment\");",
        "  if (!Number.isInteger(index) || index < 0 || index >= value.length) {",
        "    throw new __VelarIndexError(`Index ${index} is outside the list`);",
        "  }",
        "  value[index] = next;",
        "  return next;",
        "}",
      ].join("\n"));
    }
    if (this.needsCollectionHelpers) {
      helpers.push([
        "const __velarMaxCollectionItems = 1000000;",
        "const __velarSameValueZero = (left, right) => left === right || (left !== left && right !== right);",
        "",
        "function __velarValidateDenseList(value, name) {",
        "  if (!Array.isArray(value) || value.length > __velarMaxCollectionItems || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) {",
        "    throw new TypeError(name + \" requires a dense VelarScript List\");",
        "  }",
        "  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, \"length\");",
        "  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable || lengthDescriptor.configurable || !(\"value\" in lengthDescriptor)) throw new TypeError(name + \" requires an ordinary mutable List length\");",
        "  for (let index = 0; index < value.length; index += 1) {",
        "    const descriptor = Object.getOwnPropertyDescriptor(value, index);",
        "    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !(\"value\" in descriptor)) throw new TypeError(name + \" requires ordinary mutable List data elements\");",
        "  }",
        "  return value;",
        "}",
        "function __velarCopyList(value, name) {",
        "  __velarValidateDenseList(value, name);",
        "  const output = [];",
        "  for (let index = 0; index < value.length; index += 1) output.push(Object.getOwnPropertyDescriptor(value, index).value);",
        "  return output;",
        "}",
        "",
        "function __velarCollectionIterator(value) {",
        "  if (Array.isArray(value)) return Array.prototype.values.call(__velarValidateDenseList(value, \"List iteration\"));",
        "  if (__velarIsMap(value)) {",
        "    if (Reflect.getOwnPropertyDescriptor(Map.prototype, \"size\").get.call(value) > __velarMaxCollectionItems) throw new RangeError(\"A Map cannot exceed 1000000 entries\");",
        "    return Map.prototype.keys.call(value);",
        "  }",
        "  if (__velarIsSet(value)) {",
        "    if (Reflect.getOwnPropertyDescriptor(Set.prototype, \"size\").get.call(value) > __velarMaxCollectionItems) throw new RangeError(\"A Set cannot exceed 1000000 items\");",
        "    return Set.prototype.values.call(value);",
        "  }",
        "  throw new TypeError(\"VelarScript iteration requires a List, Set, or Map\");",
        "}",
        "",
        "function __velarCollectionSize(value) {",
        "  if (Array.isArray(value)) return __velarValidateDenseList(value, \"List size\").length;",
        "  const prototype = __velarIsMap(value) ? Map.prototype : __velarIsSet(value) ? Set.prototype : null;",
        "  if (!prototype) throw new TypeError(\"VelarScript size requires a List, Set, or Map\");",
        "  const size = Reflect.getOwnPropertyDescriptor(prototype, \"size\").get.call(value);",
        "  if (size > __velarMaxCollectionItems) throw new RangeError(\"A collection cannot exceed 1000000 items\");",
        "  return size;",
        "}",
        "",
        "function __velarCreateList(parts) {",
        "  const output = [];",
        "  for (const [spread, read] of parts) {",
        "    if (!spread) {",
        "      if (output.length >= __velarMaxCollectionItems) throw new RangeError(\"A List cannot exceed 1000000 items\");",
        "      output.push(read());",
        "      continue;",
        "    }",
        "    const values = __velarValidateDenseList(read(), \"List spread\");",
        "    if (output.length + values.length > __velarMaxCollectionItems) throw new RangeError(\"A List cannot exceed 1000000 items\");",
        "    for (let index = 0; index < values.length; index += 1) output.push(Object.getOwnPropertyDescriptor(values, index).value);",
        "  }",
        "  return output;",
        "}",
        "",
        "function __velarCreateSet(value) {",
        "  if (value === undefined) return new Set();",
        "  if (Array.isArray(value)) { const values = __velarValidateDenseList(value, \"Set construction\"); const output = new Set(); for (let index = 0; index < values.length; index += 1) Set.prototype.add.call(output, Object.getOwnPropertyDescriptor(values, index).value); return output; }",
        "  if (!__velarIsSet(value)) throw new TypeError(\"Set construction requires a List or Set\");",
        "  if (Reflect.getOwnPropertyDescriptor(Set.prototype, \"size\").get.call(value) > __velarMaxCollectionItems) throw new RangeError(\"A Set cannot exceed 1000000 items\");",
        "  return new Set(Set.prototype.values.call(value));",
        "}",
        "",
        "function __velarCreateMap(value) {",
        "  if (value === undefined) return new Map();",
        "  if (!__velarIsMap(value)) throw new TypeError(\"Map construction requires another Map\");",
        "  if (Reflect.getOwnPropertyDescriptor(Map.prototype, \"size\").get.call(value) > __velarMaxCollectionItems) throw new RangeError(\"A Map cannot exceed 1000000 entries\");",
        "  return new Map(Map.prototype.entries.call(value));",
        "}",
        "",
        "function __velarCollectionGet(value, key) {",
        "  if (Array.isArray(value)) {",
        "    __velarValidateDenseList(value, \"List.get\");",
        "    if (!Number.isInteger(key)) return null;",
        "    const index = key < 0 ? value.length + key : key;",
        "    return index >= 0 && index < value.length ? value[index] : null;",
        "  }",
        "  __velarCollectionSize(value);",
        "  const item = Map.prototype.get.call(value, key);",
        "  return item === undefined ? null : item;",
        "}",
        "",
        "function __velarCollectionSlice(value, start = 0, end = null) {",
        "  __velarValidateDenseList(value, \"List.slice\");",
        "  if (end === null) end = value.length;",
        "  if (!Number.isInteger(start) || !Number.isInteger(end)) {",
        "    throw new TypeError(\"List.slice positions must be integers\");",
        "  }",
        "  const length = value.length;",
        "  const first = start < 0 ? Math.max(length + start, 0) : Math.min(start, length);",
        "  const last = end < 0 ? Math.max(length + end, 0) : Math.min(end, length);",
        "  const output = [];",
        "  for (let index = first; index < Math.max(first, last); index += 1) output.push(value[index]);",
        "  return output;",
        "}",
        "",
        "function __velarListAppend(value, item) {",
        "  __velarValidateDenseList(value, \"List.append\");",
        "  if (value.length >= __velarMaxCollectionItems) throw new RangeError(\"A List cannot exceed 1000000 items\");",
        "  Object.defineProperty(value, value.length, { value: item, writable: true, enumerable: true, configurable: true });",
        "  return null;",
        "}",
        "",
        "function __velarListExtend(value, items) {",
        "  __velarValidateDenseList(value, \"List.extend\");",
        "  items = __velarValidateDenseList(items, \"List.extend\");",
        "  if (value.length + items.length > __velarMaxCollectionItems) throw new RangeError(\"A List cannot exceed 1000000 items\");",
        "  const count = items.length;",
        "  for (let index = 0; index < count; index += 1) Object.defineProperty(value, value.length, { value: Object.getOwnPropertyDescriptor(items, index).value, writable: true, enumerable: true, configurable: true });",
        "  return null;",
        "}",
        "",
        "function __velarListInsert(value, index, item) {",
        "  __velarValidateDenseList(value, \"List.insert\");",
        "  if (!Number.isInteger(index) || index < 0 || index > value.length) throw new RangeError(\"List.insert index must be an integer from 0 through size\");",
        "  if (value.length >= __velarMaxCollectionItems) throw new RangeError(\"A List cannot exceed 1000000 items\");",
        "  Object.defineProperty(value, value.length, { value: item, writable: true, enumerable: true, configurable: true });",
        "  for (let cursor = value.length - 1; cursor > index; cursor -= 1) value[cursor] = value[cursor - 1];",
        "  value[index] = item;",
        "  return null;",
        "}",
        "",
        "function __velarListPop(value, requested = -1) {",
        "  __velarValidateDenseList(value, \"List.pop\");",
        "  if (!Number.isInteger(requested)) return null;",
        "  const index = requested < 0 ? value.length + requested : requested;",
        "  if (index < 0 || index >= value.length) return null;",
        "  const item = value[index];",
        "  for (let cursor = index; cursor < value.length - 1; cursor += 1) value[cursor] = value[cursor + 1];",
        "  value.length -= 1;",
        "  return item;",
        "}",
        "function __velarListRemove(value, item) { __velarValidateDenseList(value, \"List.remove\"); for (let index = 0; index < value.length; index += 1) if (__velarSameValueZero(value[index], item)) { __velarListPop(value, index); return true; } return false; }",
        "function __velarListCopy(value) { return __velarCopyList(value, \"List.copy\"); }",
        "function __velarListCount(value, item) { __velarValidateDenseList(value, \"List.count\"); let count = 0; for (let index = 0; index < value.length; index += 1) if (__velarSameValueZero(value[index], item)) count += 1; return count; }",
        "function __velarListFind(value, predicate) { const items = __velarCopyList(value, \"List.find\"); for (let index = 0; index < items.length; index += 1) { const accepted = predicate(items[index]); if (typeof accepted !== \"boolean\") throw new TypeError(\"List.find predicate must return bool\"); if (accepted) return items[index]; } return null; }",
        "function __velarListIndex(value, item) { __velarValidateDenseList(value, \"List.index\"); for (let index = 0; index < value.length; index += 1) if (__velarSameValueZero(value[index], item)) return index; return null; }",
        "function __velarListSome(value, predicate) { const items = __velarCopyList(value, \"List.some\"); for (let index = 0; index < items.length; index += 1) { const accepted = predicate(items[index]); if (typeof accepted !== \"boolean\") throw new TypeError(\"List.some predicate must return bool\"); if (accepted) return true; } return false; }",
        "function __velarListEvery(value, predicate) { const items = __velarCopyList(value, \"List.every\"); for (let index = 0; index < items.length; index += 1) { const accepted = predicate(items[index]); if (typeof accepted !== \"boolean\") throw new TypeError(\"List.every predicate must return bool\"); if (!accepted) return false; } return true; }",
        "function __velarListMap(value, transform) { const items = __velarCopyList(value, \"List.map\"); const output = new Array(items.length); for (let index = 0; index < items.length; index += 1) { const item = transform(items[index]); output[index] = item === undefined ? null : item; } return output; }",
        "function __velarListFilter(value, predicate) { const items = __velarCopyList(value, \"List.filter\"); const output = []; for (let index = 0; index < items.length; index += 1) { const accepted = predicate(items[index]); if (typeof accepted !== \"boolean\") throw new TypeError(\"List.filter predicate must return bool\"); if (accepted) output.push(items[index]); } return output; }",
        "function __velarListReduce(value, combine, initial) { const items = __velarCopyList(value, \"List.reduce\"); let result = initial; for (let index = 0; index < items.length; index += 1) { const next = combine(result, items[index]); result = next === undefined ? null : next; } return result; }",
        "function __velarListJoin(value, separator = \"\") { __velarValidateDenseList(value, \"List.join\"); if (typeof separator !== \"string\") throw new TypeError(\"List.join separator must be string\"); for (let index = 0; index < value.length; index += 1) if (typeof value[index] !== \"string\") throw new TypeError(\"List.join requires string values\"); return Array.prototype.join.call(value, separator); }",
        "function __velarListSorted(value, compare = null) { const output = __velarCopyList(value, \"List.sorted\"); const compareValues = compare ?? ((left, right) => { if ((typeof left !== \"string\" && typeof left !== \"number\") || typeof left !== typeof right || (typeof left === \"number\" && (!Number.isFinite(left) || !Number.isFinite(right)))) throw new TypeError(\"List.sorted() requires uniform finite numbers or strings\"); return left < right ? -1 : left > right ? 1 : 0; }); Array.prototype.sort.call(output, (left, right) => { const order = compareValues(left, right); if (typeof order !== \"number\" || !Number.isFinite(order)) throw new TypeError(\"List.sorted comparator must return a finite number\"); return order; }); return output; }",
        "function __velarListReversed(value) { const output = __velarCopyList(value, \"List.reversed\"); Array.prototype.reverse.call(output); return output; }",
        "",
        "function __velarSetAdd(value, item) {",
        "  const size = Reflect.getOwnPropertyDescriptor(Set.prototype, \"size\").get.call(value);",
        "  if (size >= __velarMaxCollectionItems && !Set.prototype.has.call(value, item)) throw new RangeError(\"A Set cannot exceed 1000000 items\");",
        "  Set.prototype.add.call(value, item);",
        "  return null;",
        "}",
        "",
        "function __velarSetUpdate(value, items) {",
        "  if (!Array.isArray(items) && !__velarIsSet(items)) throw new TypeError(\"Set.update requires a List or Set\");",
        "  const entries = Array.isArray(items) ? __velarCopyList(items, \"Set.update\") : (__velarCollectionSize(items), [...Set.prototype.values.call(items)]);",
        "  const additions = new Set();",
        "  for (const item of entries) if (!Set.prototype.has.call(value, item)) Set.prototype.add.call(additions, item);",
        "  const size = Reflect.getOwnPropertyDescriptor(Set.prototype, \"size\").get.call(value);",
        "  const added = Reflect.getOwnPropertyDescriptor(Set.prototype, \"size\").get.call(additions);",
        "  if (size + added > __velarMaxCollectionItems) throw new RangeError(\"A Set cannot exceed 1000000 items\");",
        "  for (const item of Set.prototype.values.call(additions)) Set.prototype.add.call(value, item);",
        "  return null;",
        "}",
        "function __velarSetCopy(value) { const size = Reflect.getOwnPropertyDescriptor(Set.prototype, \"size\").get.call(value); if (size > __velarMaxCollectionItems) throw new RangeError(\"A Set cannot exceed 1000000 items\"); return new Set(Set.prototype.values.call(value)); }",
        "",
        "function __velarMapSet(value, key, item) {",
        "  const size = Reflect.getOwnPropertyDescriptor(Map.prototype, \"size\").get.call(value);",
        "  if (size >= __velarMaxCollectionItems && !Map.prototype.has.call(value, key)) throw new RangeError(\"A Map cannot exceed 1000000 entries\");",
        "  Map.prototype.set.call(value, key, item);",
        "  return null;",
        "}",
        "",
        "function __velarMapUpdate(value, items) {",
        "  if (!__velarIsMap(items)) throw new TypeError(\"Map.update requires a Map\");",
        "  const sourceSize = Reflect.getOwnPropertyDescriptor(Map.prototype, \"size\").get.call(items);",
        "  if (sourceSize > __velarMaxCollectionItems) throw new RangeError(\"A Map cannot exceed 1000000 entries\");",
        "  const size = Reflect.getOwnPropertyDescriptor(Map.prototype, \"size\").get.call(value);",
        "  let additions = 0;",
        "  for (const key of Map.prototype.keys.call(items)) if (!Map.prototype.has.call(value, key)) additions += 1;",
        "  if (size + additions > __velarMaxCollectionItems) throw new RangeError(\"A Map cannot exceed 1000000 entries\");",
        "  for (const [key, item] of Map.prototype.entries.call(items)) __velarMapSet(value, key, item);",
        "  return null;",
        "}",
        "function __velarMapCopy(value) { const size = Reflect.getOwnPropertyDescriptor(Map.prototype, \"size\").get.call(value); if (size > __velarMaxCollectionItems) throw new RangeError(\"A Map cannot exceed 1000000 entries\"); return new Map(Map.prototype.entries.call(value)); }",
        "",
        "function __velarCollectionHas(value, item) {",
        "  if (Array.isArray(value)) { __velarValidateDenseList(value, \"List.has\"); for (let index = 0; index < value.length; index += 1) if (__velarSameValueZero(value[index], item)) return true; return false; }",
        "  __velarCollectionSize(value);",
        "  return __velarIsMap(value) ? Map.prototype.has.call(value, item) : Set.prototype.has.call(value, item);",
        "}",
        "function __velarMembership(value, item) {",
        "  if (typeof value === \"string\") { if (typeof item !== \"string\") throw new TypeError(\"String membership requires a string\"); return value.includes(item); }",
        "  return __velarCollectionHas(value, item);",
        "}",
        "",
        "function __velarCollectionRemove(value, item) {",
        "  __velarCollectionSize(value);",
        "  return __velarIsMap(value) ? Map.prototype.delete.call(value, item) : Set.prototype.delete.call(value, item);",
        "}",
        "",
        "function __velarCollectionClear(value) {",
        "  __velarCollectionSize(value);",
        "  if (Array.isArray(value)) value.length = 0;",
        "  else if (__velarIsMap(value)) Map.prototype.clear.call(value);",
        "  else Set.prototype.clear.call(value);",
        "  return null;",
        "}",
        "",
        "function __velarCollectionKeys(value) { const size = Reflect.getOwnPropertyDescriptor(Map.prototype, \"size\").get.call(value); if (size > __velarMaxCollectionItems) throw new RangeError(\"A Map cannot exceed 1000000 entries\"); return [...Map.prototype.keys.call(value)]; }",
        "function __velarCollectionValues(value) { const prototype = __velarIsMap(value) ? Map.prototype : Set.prototype; const size = Reflect.getOwnPropertyDescriptor(prototype, \"size\").get.call(value); if (size > __velarMaxCollectionItems) throw new RangeError(\"A collection cannot exceed 1000000 items\"); return [...prototype.values.call(value)]; }",
        "function __velarCollectionEntries(value) { const size = Reflect.getOwnPropertyDescriptor(Map.prototype, \"size\").get.call(value); if (size > __velarMaxCollectionItems) throw new RangeError(\"A Map cannot exceed 1000000 entries\"); return [...Map.prototype.entries.call(value)].map(([key, item]) => Object.freeze({ key, value: item })); }",
        "function __velarOptionalCollection(value, operation) { return value == null ? null : operation(value); }",
      ].join("\n"));
    }
    if (this.needsNumberHelper) {
      helpers.push([
        "function __velarNumber(value) {",
        "  if (typeof value !== \"string\") throw new TypeError(\"number(text) requires a string\");",
        "  const text = value.trim();",
        "  if (!/^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?$/u.test(text)) return null;",
        "  const parsed = Number(text);",
        "  return Number.isFinite(parsed) ? parsed : null;",
        "}",
      ].join("\n"));
    }

    const chunks: readonly { readonly code: string; readonly mappings: readonly GeneratedMapping[] }[] = [
      ...helpers.map((code) => ({ code, mappings: [] })),
      ...statements.map((node) => this.renderJavaScriptNode(node)),
    ];
    let output = "";
    const mappings: GeneratedMapping[] = [];
    for (const chunk of chunks) {
      if (output.length > 0) output += "\n\n";
      const offset = output.length;
      output += chunk.code;
      mappings.push(...chunk.mappings.map((mapping) => ({ ...mapping, offset: offset + mapping.offset })));
    }
    this.generatedCode = `${output}${output.length > 0 ? "\n" : ""}`;
    this.generatedMappings = mappings.sort((left, right) => left.offset - right.offset);
    return this.generatedCode;
  }

  sourceMap(source: SourceText): string {
    const lineStarts = [0];
    for (let index = 0; index < this.generatedCode.length; index += 1) {
      if (this.generatedCode[index] === "\n") lineStarts.push(index + 1);
    }
    const byLine = new Map<number, Array<{ column: number; span: Span }>>();
    for (const mapping of this.generatedMappings) {
      const line = generatedLineAt(lineStarts, mapping.offset);
      const entries = byLine.get(line) ?? [];
      entries.push({ column: mapping.offset - lineStarts[line]!, span: mapping.sourceSpan });
      byLine.set(line, entries);
    }
    let previousSource = 0;
    let previousLine = 0;
    let previousColumn = 0;
    const mappings = lineStarts.map((_, line) => {
      let previousGeneratedColumn = 0;
      return (byLine.get(line) ?? []).sort((left, right) => left.column - right.column).map((mapped) => {
        const location = source.location(mapped.span.start);
        const originalLine = location.line - 1;
        const originalColumn = location.column - 1;
        const segment = [
          encodeVlq(mapped.column - previousGeneratedColumn),
          encodeVlq(-previousSource),
          encodeVlq(originalLine - previousLine),
          encodeVlq(originalColumn - previousColumn),
        ].join("");
        previousGeneratedColumn = mapped.column;
        previousSource = 0;
        previousLine = originalLine;
        previousColumn = originalColumn;
        return segment;
      }).join(",");
    }).join(";");
    return JSON.stringify({
      version: 3,
      sources: [source.path],
      sourcesContent: [source.text],
      names: [],
      mappings,
    });
  }

  private emitJavaScriptNode(sourceSpan: Span, render: () => string): JavaScriptNode {
    const node = { id: this.nextJavaScriptNodeId++, code: render(), sourceSpan } satisfies JavaScriptNode;
    this.javaScriptNodeSpans.set(node.id, sourceSpan);
    return node;
  }

  private markJavaScriptNode(node: JavaScriptNode): string {
    return node.code.length === 0 ? "" : `\u0000VELAR_MAP_${node.id}\u0000${node.code}`;
  }

  private renderJavaScriptNode(node: JavaScriptNode): { readonly code: string; readonly mappings: readonly GeneratedMapping[] } {
    let code = "";
    let cursor = 0;
    const mappings: GeneratedMapping[] = [{ offset: 0, sourceSpan: node.sourceSpan }];
    for (const marker of node.code.matchAll(javaScriptNodeMarker)) {
      const markerIndex = marker.index;
      code += node.code.slice(cursor, markerIndex);
      const sourceSpan = this.javaScriptNodeSpans.get(Number(marker[1]));
      if (!sourceSpan) throw new Error("A generated JavaScript mapping marker has no source node");
      mappings.push({ offset: code.length, sourceSpan });
      cursor = markerIndex + marker[0].length;
    }
    code += node.code.slice(cursor);
    return { code, mappings };
  }

  protected additionalHelpers(_program: Program): readonly string[] {
    return [];
  }

  protected visitExtensionRuntimeExpression(_expression: Expression, _visitExpression: (expression: Expression) => void): boolean {
    return false;
  }

  protected visitExtensionRuntimeStatement(
    _statement: Statement,
    _visitExpression: (expression: Expression) => void,
    _visitStatement: (statement: Statement) => void,
  ): boolean {
    return false;
  }

  protected extensionExpressionContainsDirectAwait(_expression: Expression): boolean | undefined {
    return undefined;
  }

  private collectDeclarations(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind === "TypeDeclaration" || statement.kind === "TypeAliasDeclaration") {
        this.typeDeclarations.set(statement.name, statement);
        if (statement.exported) {
          this.runtimeTypes.add(statement.name);
        }
      }
    }
    for (const name of [...this.runtimeTypes]) {
      this.markRuntimeType({ kind: "named", name });
    }
  }

  private collectRuntimeUses(program: Program): void {
    const visitExpression = (expression: Expression): void => {
      if (this.visitExtensionRuntimeExpression(expression, visitExpression)) return;
      switch (expression.kind) {
        case "FStringExpression":
          for (const part of expression.parts) {
            if (part.kind === "expression") visitExpression(part.value);
          }
          break;
        case "ListExpression":
          expression.elements.forEach(visitExpression);
          break;
        case "ObjectExpression":
          expression.properties.forEach((property) => visitExpression(property.value));
          break;
        case "SpreadExpression":
          visitExpression(expression.value);
          break;
        case "UnaryExpression":
          visitExpression(expression.operand);
          break;
        case "BinaryExpression":
          visitExpression(expression.left);
          visitExpression(expression.right);
          break;
        case "ComparisonChainExpression":
          expression.operands.forEach(visitExpression);
          break;
        case "ConditionalExpression":
          visitExpression(expression.condition);
          visitExpression(expression.thenValue);
          visitExpression(expression.elseValue);
          break;
        case "IsExpression":
          this.markRuntimeType(resolveTypeReference(expression.type));
          visitExpression(expression.value);
          break;
        case "ArrowFunctionExpression":
          visitExpression(expression.body);
          break;
        case "CallExpression":
          if (expression.callee.kind === "MemberExpression"
            && expression.callee.object.kind === "IdentifierExpression"
            && expression.callee.property === "parse"
            && this.typeDeclarations.has(expression.callee.object.name)) {
            this.markRuntimeType({ kind: "named", name: expression.callee.object.name });
          }
          if (expression.callee.kind === "MemberExpression"
            && this.collectionHelper(expression.callee)) {
            this.needsCollectionHelpers = true;
          }
          visitExpression(expression.callee);
          expression.arguments.forEach(visitExpression);
          break;
        case "MemberExpression":
          visitExpression(expression.object);
          break;
        case "IndexExpression":
          this.needsIndexHelpers = true;
          visitExpression(expression.object);
          visitExpression(expression.index);
          break;
        case "LiteralExpression":
          break;
        case "IdentifierExpression":
          if (this.typeDeclarations.has(expression.name)) {
            this.markRuntimeType({ kind: "named", name: expression.name });
          }
          break;
        case "SuperExpression":
        case "DynamicImportExpression":
          break;
      }
    };

    const visitStatement = (statement: Statement): void => {
      if (this.visitExtensionRuntimeStatement(statement, visitExpression, visitStatement)) return;
      switch (statement.kind) {
        case "VariableDeclaration": visitExpression(statement.initializer); break;
        case "FunctionDeclaration": statement.parameters.forEach((parameter) => { if (parameter.defaultValue) visitExpression(parameter.defaultValue); }); statement.body.forEach(visitStatement); break;
        case "ClassDeclaration":
          statement.parameters.forEach((parameter) => { if (parameter.defaultValue) visitExpression(parameter.defaultValue); });
          statement.base?.arguments.forEach(visitExpression);
          statement.fields.forEach((field) => { if (field.initializer) visitExpression(field.initializer); });
          statement.initialization?.body.forEach(visitStatement);
          statement.getters.forEach(visitStatement);
          statement.methods.forEach(visitStatement);
          break;
        case "ReturnStatement": if (statement.value) visitExpression(statement.value); break;
        case "ThrowStatement": visitExpression(statement.value); break;
        case "AssertStatement": visitExpression(statement.condition); if (statement.message) visitExpression(statement.message); break;
        case "IfStatement": visitExpression(statement.condition); statement.thenBody.forEach(visitStatement); statement.elseBody?.forEach(visitStatement); break;
        case "MatchStatement":
          visitExpression(statement.value);
          statement.cases.forEach((branch) => {
            visitMatchPattern(branch.pattern);
            if (branch.guard) visitExpression(branch.guard);
            branch.body.forEach(visitStatement);
          });
          statement.elseBody?.forEach(visitStatement);
          break;
        case "ForStatement": visitExpression(statement.iterable); statement.body.forEach(visitStatement); break;
        case "WhileStatement": visitExpression(statement.condition); statement.body.forEach(visitStatement); break;
        case "TryStatement": statement.tryBody.forEach(visitStatement); statement.catchBody?.forEach(visitStatement); statement.finallyBody?.forEach(visitStatement); break;
        case "AssignmentStatement": visitExpression(statement.target); visitExpression(statement.value); break;
        case "ExpressionStatement": visitExpression(statement.expression); break;
        case "ImportDeclaration":
        case "ExternModuleDeclaration":
        case "TypeDeclaration":
        case "TypeAliasDeclaration":
        case "EnumDeclaration":
        case "BreakStatement":
        case "ContinueStatement":
        case "PassStatement":
          break;
      }
    };

    const visitMatchPattern = (pattern: MatchPattern): void => {
      switch (pattern.kind) {
        case "MatchValuePattern": pattern.values.forEach(visitExpression); break;
        case "MatchTypePattern": this.markRuntimeType(resolveTypeReference(pattern.type)); break;
        case "MatchAsPattern": visitMatchPattern(pattern.pattern); break;
        case "MatchObjectPattern": pattern.entries.forEach((entry) => visitMatchPattern(entry.pattern)); break;
        case "MatchListPattern": pattern.elements.forEach(visitMatchPattern); break;
        case "MatchWildcardPattern":
        case "MatchCapturePattern":
          break;
      }
    };

    program.body.forEach(visitStatement);
  }

  private markRuntimeType(type: ValueType): void {
    this.needsRuntimeTypeHelpers = true;
    const visit = (value: ValueType): void => {
      if (value.kind === "named" && this.typeDeclarations.has(value.name) && !this.runtimeTypes.has(value.name)) {
        this.runtimeTypes.add(value.name);
      }
      if (value.kind === "named" && this.typeDeclarations.has(value.name) && !this.expandedRuntimeTypes.has(value.name)) {
        this.expandedRuntimeTypes.add(value.name);
        const declaration = this.typeDeclarations.get(value.name)!;
        if (declaration.kind === "TypeDeclaration") {
          declaration.fields.forEach((field) => visit(resolveTypeReference(field.type)));
        } else {
          visit(resolveTypeReference(declaration.target));
        }
      } else if (value.kind === "optional") {
        visit(value.inner);
      } else if (value.kind === "list") {
        visit(value.element);
      } else if (value.kind === "set") {
        visit(value.element);
      } else if (value.kind === "map") {
        visit(value.key);
        visit(value.value);
      } else if (value.kind === "promise") {
        visit(value.value);
      } else if (value.kind === "union") {
        value.members.forEach(visit);
      }
    };
    visit(type);
  }

  protected emitMappedStatement(statement: Statement, depth: number): string {
    return this.markJavaScriptNode(this.emitJavaScriptNode(statement.span, () => this.emitStatement(statement, depth)));
  }

  protected emitStatement(statement: Statement, depth: number): string {
    const indentation = "  ".repeat(depth);
    switch (statement.kind) {
      case "ImportDeclaration":
        return this.emitImport(statement.source, statement.specifiers, indentation);
      case "ExternModuleDeclaration":
        return "";
      case "TypeDeclaration":
        return this.runtimeTypes.has(statement.name) ? this.emitTypeDeclaration(statement, depth) : "";
      case "TypeAliasDeclaration":
        return this.runtimeTypes.has(statement.name) ? this.emitTypeAliasDeclaration(statement, depth) : "";
      case "EnumDeclaration":
        return this.emitEnumDeclaration(statement, depth);
      case "ClassDeclaration":
        return this.emitClass(statement, depth);
      case "VariableDeclaration":
        return `${indentation}${statement.exported ? "export " : ""}${statement.binding} ${this.emitBindingPattern(statement.pattern)} = ${this.emitMappedExpression(statement.initializer)};`;
      case "FunctionDeclaration": {
        const prefix = `${statement.exported || this.forcedFunctionExports.has(statement.name) ? "export " : ""}${statement.asynchronous ? "async " : ""}function`;
        const parameters = statement.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
        const lines = statement.body.map((child) => this.emitMappedStatement(child, depth + 1)).filter(Boolean);
        if (!this.blockAlwaysReturns(statement.body)) lines.push(`${"  ".repeat(depth + 1)}return null;`);
        const body = lines.join("\n");
        return `${indentation}${prefix} ${statement.name}(${parameters}) {${body.length > 0 ? `\n${body}\n${indentation}` : ""}}`;
      }
      case "ReturnStatement":
        return `${indentation}return${statement.value ? ` ${this.emitMappedExpression(statement.value)}` : ""};`;
      case "ThrowStatement":
        return `${indentation}throw ${this.emitMappedExpression(statement.value)};`;
      case "AssertStatement": {
        const message = statement.message ? this.emitMappedExpression(statement.message) : JSON.stringify("Assertion failed");
        return [
          `${indentation}if (!(${this.emitCondition(statement.condition)})) {`,
          `${indentation}  const __velarAssertionError = new Error(${message});`,
          `${indentation}  __velarAssertionError.name = "AssertionError";`,
          `${indentation}  throw __velarAssertionError;`,
          `${indentation}}`,
        ].join("\n");
      }
      case "IfStatement": {
        const thenBody = statement.thenBody.map((child) => this.emitMappedStatement(child, depth + 1)).filter(Boolean).join("\n");
        let output = `${indentation}if (${this.emitCondition(statement.condition)}) {${thenBody.length > 0 ? `\n${thenBody}\n${indentation}` : ""}}`;
        if (statement.elseBody) {
          const chained = statement.elseBody.length === 1 && statement.elseBody[0]?.kind === "IfStatement"
            ? this.emitMappedStatement(statement.elseBody[0], 0)
            : null;
          if (chained) {
            output += ` else ${chained}`;
          } else {
            const elseBody = statement.elseBody.map((child) => this.emitMappedStatement(child, depth + 1)).filter(Boolean).join("\n");
            output += ` else {${elseBody.length > 0 ? `\n${elseBody}\n${indentation}` : ""}}`;
          }
        }
        return output;
      }
      case "MatchStatement": {
        const suffix = statement.span.start;
        const valueName = `__velarMatchValue${suffix}`;
        const matchedName = `__velarMatchDone${suffix}`;
        const lines = [
          `${indentation}{`,
          `${indentation}  const ${valueName} = ${this.emitMappedExpression(statement.value)};`,
          `${indentation}  let ${matchedName} = false;`,
        ];
        for (const branch of statement.cases) {
          const attemptName = `__velarMatchCase${branch.pattern.span.start}`;
          const attempt = this.emitMatchPatternAttempt(branch.pattern, valueName, `${indentation}      `);
          lines.push(`${indentation}  let ${attemptName} = null;`);
          lines.push(`${indentation}  if (!${matchedName} && (${attemptName} = (() => {`);
          lines.push(...attempt.lines);
          lines.push(`${indentation}      return [${attempt.bindings.map((binding) => binding.value).join(", ")}];`);
          lines.push(`${indentation}    })()) !== null) {`);
          attempt.bindings.forEach((binding, index) => {
            lines.push(`${indentation}    const ${binding.name} = ${attemptName}[${index}];`);
          });
          if (branch.guard) {
            lines.push(`${indentation}    if (${this.emitCondition(branch.guard)}) {`);
            lines.push(`${indentation}      ${matchedName} = true;`);
            lines.push(...branch.body.map((child) => this.emitMappedStatement(child, depth + 3)).filter(Boolean));
            lines.push(`${indentation}    }`);
          } else {
            lines.push(`${indentation}    ${matchedName} = true;`);
            lines.push(...branch.body.map((child) => this.emitMappedStatement(child, depth + 2)).filter(Boolean));
          }
          lines.push(`${indentation}  }`);
        }
        if (statement.elseBody) {
          lines.push(`${indentation}  if (!${matchedName}) {`);
          lines.push(...statement.elseBody.map((child) => this.emitMappedStatement(child, depth + 2)).filter(Boolean));
          lines.push(`${indentation}  }`);
        }
        lines.push(`${indentation}}`);
        return lines.join("\n");
      }
      case "ForStatement": {
        this.needsCollectionHelpers = true;
        const body = statement.body.map((child) => this.emitMappedStatement(child, depth + 1)).filter(Boolean).join("\n");
        const iterable = this.emitMappedExpression(statement.iterable);
        return `${indentation}for (const ${this.emitBindingPattern(statement.pattern)} of __velarCollectionIterator(${iterable})) {${body.length > 0 ? `\n${body}\n${indentation}` : ""}}`;
      }
      case "WhileStatement": {
        const body = statement.body.map((child) => this.emitMappedStatement(child, depth + 1)).filter(Boolean).join("\n");
        return `${indentation}while (${this.emitCondition(statement.condition)}) {${body.length > 0 ? `\n${body}\n${indentation}` : ""}}`;
      }
      case "BreakStatement":
        return `${indentation}break;`;
      case "ContinueStatement":
        return `${indentation}continue;`;
      case "PassStatement":
        return "";
      case "TryStatement": {
        const tryBody = statement.tryBody.map((child) => this.emitMappedStatement(child, depth + 1)).filter(Boolean).join("\n");
        let output = `${indentation}try {${tryBody.length > 0 ? `\n${tryBody}\n${indentation}` : ""}}`;
        if (statement.catchBody) {
          const catchBody = statement.catchBody.map((child) => this.emitMappedStatement(child, depth + 1)).filter(Boolean).join("\n");
          const catchName = statement.catchName ?? "error";
          const normalization = `${"  ".repeat(depth + 1)}${catchName} = ${catchName} instanceof Error ? ${catchName} : new Error(String(${catchName}), { cause: ${catchName} });`;
          output += ` catch (${catchName}) {\n${normalization}${catchBody.length > 0 ? `\n${catchBody}` : ""}\n${indentation}}`;
        }
        if (statement.finallyBody) {
          const finallyBody = statement.finallyBody.map((child) => this.emitMappedStatement(child, depth + 1)).filter(Boolean).join("\n");
          output += ` finally {${finallyBody.length > 0 ? `\n${finallyBody}\n${indentation}` : ""}}`;
        }
        return output;
      }
      case "AssignmentStatement":
        if (statement.target.kind === "IndexExpression") {
          this.needsIndexHelpers = true;
          this.needsCollectionHelpers = true;
          const object = this.emitMappedExpression(statement.target.object);
          const index = this.emitMappedExpression(statement.target.index);
          if (statement.operator === "=") {
            return `${indentation}__velarSetIndex(${object}, ${index}, ${this.emitMappedExpression(statement.value)});`;
          }
          const suffix = statement.span.start;
          const objectName = `$velarIndexObject${suffix}`;
          const keyName = `$velarIndexKey${suffix}`;
          const value = this.emitMappedExpression(statement.value);
          return [
            `${indentation}{`,
            `${indentation}  const ${objectName} = ${object};`,
            `${indentation}  const ${keyName} = ${index};`,
            `${indentation}  __velarSetIndex(${objectName}, ${keyName}, __velarIndex(${objectName}, ${keyName}) ${statement.operator.slice(0, -1)} ${value});`,
            `${indentation}}`,
          ].join("\n");
        }
        return `${indentation}${this.emitMappedExpression(statement.target)} ${statement.operator} ${this.emitMappedExpression(statement.value)};`;
      case "ExpressionStatement":
        return `${indentation}${this.emitMappedExpression(statement.expression, false)};`;
      default:
        return "";
    }
  }

  private emitImport(source: string, specifiers: readonly { imported: string; local: string; namespace: boolean }[], indentation: string): string {
    const emittedSource = source.endsWith(".vel") ? `${source.slice(0, -4)}.js` : source;
    const first = specifiers[0];
    if (first?.namespace) {
      return `${indentation}import * as ${first.local} from ${JSON.stringify(emittedSource)};`;
    }
    if (first?.imported === "default" && specifiers.length === 1) {
      return `${indentation}import ${first.local} from ${JSON.stringify(emittedSource)};`;
    }
    const names = specifiers.map((specifier) => specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`).join(", ");
    return `${indentation}import { ${names} } from ${JSON.stringify(emittedSource)};`;
  }

  private emitTypeDeclaration(statement: TypeDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const checkName = this.runtimeTypeCheckName(statement.name);
    const fields = statement.fields.map((field, index) => ({
      field,
      descriptor: `__velarField${index}`,
      type: resolveTypeReference(field.type),
    }));
    const checks = fields.map(({ descriptor, type }) => {
      const present = `${descriptor}?.enumerable && "value" in ${descriptor} && ${this.emitTypeCheck(type, `${descriptor}.value`, "__state")}`;
      return type.kind === "optional" ? `(${descriptor} === undefined || (${present}))` : present;
    });
    const predicate = checks.length > 0 ? checks.join(" && ") : "true";
    const exportPrefix = statement.exported ? "export " : "";
    return [
      `${indentation}function ${checkName}(value, __state = { active: new WeakMap(), depth: 0 }) {`,
      `${indentation}  if (value === null || typeof value !== "object" || Array.isArray(value) || __state.depth >= 1000) return false;`,
      `${indentation}  let __active = __state.active.get(value);`,
      `${indentation}  if (__active?.has(${checkName})) return false;`,
      `${indentation}  if (!__active) {`,
      `${indentation}    __active = new Set();`,
      `${indentation}    __state.active.set(value, __active);`,
      `${indentation}  }`,
      `${indentation}  __active.add(${checkName});`,
      `${indentation}  __state.depth += 1;`,
      `${indentation}  try {`,
      ...fields.map(({ field, descriptor }) => `${indentation}    const ${descriptor} = Object.getOwnPropertyDescriptor(value, ${JSON.stringify(field.name)});`),
      `${indentation}    return Boolean(${predicate});`,
      `${indentation}  } finally {`,
      `${indentation}    __state.depth -= 1;`,
      `${indentation}    __active.delete(${checkName});`,
      `${indentation}    if (__active.size === 0) __state.active.delete(value);`,
      `${indentation}  }`,
      `${indentation}}`,
      "",
      `${indentation}${exportPrefix}const ${statement.name} = __velarRegisterType(Object.freeze({`,
      `${indentation}  is(value, __state) {`,
      `${indentation}    return ${checkName}(value, __state);`,
      `${indentation}  },`,
      `${indentation}  parse(value) {`,
      `${indentation}    if (!${checkName}(value)) {`,
      `${indentation}      throw new __VelarValidationError(${JSON.stringify(`Value does not match ${statement.name}`)});`,
      `${indentation}    }`,
      `${indentation}    return value;`,
      `${indentation}  },`,
      `${indentation}}));`,
    ].join("\n");
  }

  private emitTypeAliasDeclaration(statement: TypeAliasDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const checkName = this.runtimeTypeCheckName(statement.name);
    const predicate = this.emitTypeCheck(resolveTypeReference(statement.target), "value", "__state");
    const exportPrefix = statement.exported ? "export " : "";
    return [
      `${indentation}function ${checkName}(value, __state = { active: new WeakMap(), depth: 0 }) {`,
      `${indentation}  return ${predicate};`,
      `${indentation}}`,
      "",
      `${indentation}${exportPrefix}const ${statement.name} = __velarRegisterType(Object.freeze({`,
      `${indentation}  is(value, __state) {`,
      `${indentation}    return ${checkName}(value, __state);`,
      `${indentation}  },`,
      `${indentation}  parse(value) {`,
      `${indentation}    if (!${checkName}(value)) {`,
      `${indentation}      throw new __VelarValidationError(${JSON.stringify(`Value does not match ${statement.name}`)});`,
      `${indentation}    }`,
      `${indentation}    return value;`,
      `${indentation}  },`,
      `${indentation}}));`,
    ].join("\n");
  }

  private emitEnumDeclaration(statement: EnumDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const values = statement.members.map((member) => JSON.stringify(member.name));
    const members = statement.members.map((member) => `${indentation}  ${member.name}: ${JSON.stringify(member.name)},`);
    const predicate = values.length === 1
      ? `value === ${values[0]}`
      : `[${values.join(", ")}].includes(value)`;
    return [
      `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarRegisterType(Object.freeze({`,
      ...members,
      `${indentation}  is(value) {`,
      `${indentation}    return ${predicate};`,
      `${indentation}  },`,
      `${indentation}  parse(value) {`,
      `${indentation}    if (!${statement.name}.is(value)) {`,
      `${indentation}      throw new __VelarValidationError(${JSON.stringify(`Value does not match ${statement.name}`)});`,
      `${indentation}    }`,
      `${indentation}    return value;`,
      `${indentation}  },`,
      `${indentation}}));`,
    ].join("\n");
  }

  private emitTypeCheck(type: ValueType, value: string, state = "undefined"): string {
    switch (type.kind) {
      case "unknown":
      case "any":
        return "true";
      case "null":
        return `${value} == null`;
      case "string":
      case "number":
      case "bool":
        return `typeof ${value} === ${JSON.stringify(type.kind === "bool" ? "boolean" : type.kind)}`;
      case "optional":
        return `(${value} == null || ${this.emitTypeCheck(type.inner, value, state)})`;
      case "list":
        return `__velarListTypeIs(${value}, (item) => ${this.emitTypeCheck(type.element, "item", state)})`;
      case "set":
        return `__velarSetTypeIs(${value}, (item) => ${this.emitTypeCheck(type.element, "item", state)})`;
      case "map":
        return `__velarMapTypeIs(${value}, (key, item) => ${this.emitTypeCheck(type.key, "key", state)} && ${this.emitTypeCheck(type.value, "item", state)})`;
      case "promise":
        return `(${value} instanceof Promise)`;
      case "named":
        if (type.name === "Event" || type.name === "KeyboardEvent" || type.name === "PointerEvent" || type.name === "InputEvent") {
          return `(typeof ${type.name} !== "undefined" && ${value} instanceof ${type.name})`;
        }
        if (type.name === "Element") return `(typeof Element !== "undefined" && ${value} instanceof Element)`;
        if (type.name === "CanvasElement") return `(typeof HTMLCanvasElement !== "undefined" && ${value} instanceof HTMLCanvasElement)`;
        if (type.name === "DialogElement") return `(typeof HTMLDialogElement !== "undefined" && ${value} instanceof HTMLDialogElement)`;
        if (type.name === "InputElement") {
          return `((typeof HTMLInputElement !== "undefined" && ${value} instanceof HTMLInputElement) || (typeof HTMLSelectElement !== "undefined" && ${value} instanceof HTMLSelectElement) || (typeof HTMLTextAreaElement !== "undefined" && ${value} instanceof HTMLTextAreaElement))`;
        }
        if (this.hints.enumNames.has(type.name)) return `${type.name}.is(${value})`;
        if (this.hints.classNames.has(type.name)) return `${value} instanceof ${type.name}`;
        return this.typeDeclarations.has(type.name)
          ? `${this.runtimeTypeCheckName(type.name)}(${value}, ${state})`
          : `${type.name}.is(${value}, ${state})`;
      case "class":
        return `${value} instanceof ${type.name}`;
      case "enum":
        return `${type.name}.is(${value})`;
      case "union":
        return `(${type.members.map((member) => this.emitTypeCheck(member, value, state)).join(" || ")})`;
      case "object":
        return `${value} !== null && typeof ${value} === "object"`;
      case "function":
      case "action":
      case "intrinsic":
        return `typeof ${value} === "function"`;
      case "typeObject":
      case "enumObject":
      case "classConstructor":
      case "componentConstructor":
      case "node":
        return "false";
    }
  }

  private runtimeTypeCheckName(name: string): string {
    return `__velarTypeCheck_${name}`;
  }

  private emitClass(statement: ClassDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const parameters = statement.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
    const constructorLines: string[] = [];
    const constructorBody = [...(statement.initialization?.body ?? [])];
    const explicitSuper = constructorBody[0]?.kind === "ExpressionStatement"
      && constructorBody[0].expression.kind === "CallExpression"
      && constructorBody[0].expression.callee.kind === "SuperExpression";
    if (statement.base) {
      constructorLines.push(explicitSuper
        ? this.emitMappedStatement(constructorBody.shift()!, depth + 2)
        : `${indentation}    super();`);
    }
    for (const parameter of statement.parameters) {
      if (parameter.binding) {
        constructorLines.push(`${indentation}    this.${parameter.private ? "#" : ""}${parameter.name} = ${parameter.name};`);
      }
    }
    for (const field of statement.fields) {
      if (!field.static && field.initializer) constructorLines.push(`${indentation}    this.${field.private ? "#" : ""}${field.name} = ${this.emitMappedExpression(field.initializer)};`);
    }
    for (const method of statement.methods) {
      if (method.static || method.abstract || method.private) continue;
      constructorLines.push(`${indentation}    this.${method.name} = this.${method.name}.bind(this);`);
    }
    if (statement.initialization) {
      constructorLines.push(`${indentation}    const self = this;`);
      constructorLines.push(...constructorBody.map((child) => this.emitMappedStatement(child, depth + 2)).filter(Boolean));
    }
    const constructor = [
      `${indentation}  constructor(${parameters}) {`,
      ...constructorLines,
      `${indentation}  }`,
    ].join("\n");
    const methodBody = (method: ClassDeclaration["methods"][number] | ClassDeclaration["getters"][number], methodDepth: number): string[] => {
      const lines = method.abstract
        ? [`${"  ".repeat(methodDepth)}throw new Error(${JSON.stringify(`Abstract ${"accessor" in method ? "getter" : "method"} ${statement.name}.${method.name}${"accessor" in method ? "" : "()"} must be implemented`)});`]
        : [
          ...(method.static ? [] : [`${"  ".repeat(methodDepth)}const self = this;`]),
          ...method.body.map((child) => this.emitMappedStatement(child, methodDepth)).filter(Boolean),
        ];
      if (!method.abstract && !this.blockAlwaysReturns(method.body)) lines.push(`${"  ".repeat(methodDepth)}return null;`);
      return lines;
    };
    const methods = statement.methods.filter((method) => !method.private || method.static).map((method) => {
      const methodParameters = method.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
      const lines = methodBody(method, depth + 2);
      const body = lines.join("\n");
      return `${indentation}  ${method.static ? "static " : ""}${method.asynchronous ? "async " : ""}${method.private ? "#" : ""}${method.name}(${methodParameters}) {${body.length > 0 ? `\n${body}\n${indentation}  ` : ""}}`;
    });
    const privateMethods = statement.methods.filter((method) => method.private && !method.static).map((method) => {
      const methodParameters = method.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ");
      const lines = methodBody(method, depth + 2);
      const body = lines.join("\n");
      return `${indentation}  #${method.name} = ${method.asynchronous ? "async " : ""}(${methodParameters}) => {${body.length > 0 ? `\n${body}\n${indentation}  ` : ""}};`;
    });
    const getters = statement.getters.map((getter) => {
      const lines = methodBody(getter, depth + 2);
      const body = lines.join("\n");
      return `${indentation}  ${getter.static ? "static " : ""}get ${getter.private ? "#" : ""}${getter.name}() {${body.length > 0 ? `\n${body}\n${indentation}  ` : ""}}`;
    });
    const privateFields = [
      ...statement.parameters.filter((parameter) => parameter.private).map((parameter) => parameter.name),
      ...statement.fields.filter((field) => field.private && !field.static).map((field) => field.name),
    ].map((name) => `${indentation}  #${name};`);
    const staticFields = statement.fields
      .filter((field) => field.static)
      .map((field) => `${indentation}  static ${field.private ? "#" : ""}${field.name} = ${field.initializer ? this.emitMappedExpression(field.initializer) : "null"};`);
    const extension = statement.base ? ` extends ${statement.base.name}` : "";
    return `${indentation}${statement.exported ? "export " : ""}class ${statement.name}${extension} {\n${[...privateFields, ...privateMethods, ...staticFields, constructor, ...getters, ...methods].join("\n\n")}\n${indentation}}`;
  }

  protected emitParameter(name: string, defaultValue: Expression | null, rest = false): string {
    if (rest) return `...${name}`;
    return defaultValue ? `${name} = ${this.emitMappedExpression(defaultValue)}` : name;
  }

  protected emitMappedExpression(expression: Expression, normalizeNull = true): string {
    return this.markJavaScriptNode(this.emitJavaScriptNode(expression.span, () => {
      const key = `${expression.span.start}:${expression.span.end}`;
      const normalizePromise = normalizeNull
        && this.suppressPromiseNormalization === 0
        && this.hints.normalizedPromiseValues.has(key);
      if (normalizePromise) this.suppressPromiseNormalization += 1;
      let emitted: string;
      try {
        emitted = this.emitExpression(expression);
      } finally {
        if (normalizePromise) this.suppressPromiseNormalization -= 1;
      }
      if (!normalizeNull) return emitted;
      if (normalizePromise) return `__velarNormalizePromiseValue(${emitted})`;
      if (this.hints.normalizedNullResults.has(key)) return `(${emitted}, null)`;
      if (this.hints.normalizedUndefinedExpressions.has(key)) return `(${emitted} ?? null)`;
      return emitted;
    }));
  }

  protected emitExpression(expression: Expression): string {
    switch (expression.kind) {
      case "LiteralExpression":
        return expression.value === null ? "null" : typeof expression.value === "string" ? JSON.stringify(expression.value) : String(expression.value);
      case "FStringExpression":
        return `\`${expression.parts.map((part) => part.kind === "text" ? this.escapeTemplateText(part.value) : `\${${this.emitMappedExpression(part.value)}}`).join("")}\``;
      case "IdentifierExpression":
        if (expression.name === "number") {
          this.needsNumberHelper = true;
          return "__velarNumber";
        }
        return expression.name === "str" ? "String" : expression.name === "print" ? "console.log" : expression.name;
      case "SuperExpression":
        return "super";
      case "DynamicImportExpression": {
        const source = expression.source.endsWith(".vel") ? `${expression.source.slice(0, -4)}.js` : expression.source;
        return `import(${JSON.stringify(source)})`;
      }
      case "ListExpression":
        if (expression.elements.some((element) => element.kind === "SpreadExpression")) {
          this.needsCollectionHelpers = true;
          const parts = expression.elements.map((element) => element.kind === "SpreadExpression"
            ? `[true, () => ${this.emitMappedExpression(element.value)}]`
            : `[false, () => ${this.emitMappedExpression(element)}]`);
          return `__velarCreateList([${parts.join(", ")}])`;
        }
        return `[${expression.elements.map((element) => this.emitMappedExpression(element)).join(", ")}]`;
      case "ObjectExpression":
        return `{ ${expression.properties.map((property) => property.kind === "ObjectProperty" ? `${this.emitObjectKey(property.name)}: ${this.emitMappedExpression(property.value)}` : `...${this.emitMappedExpression(property.value)}`).join(", ")} }`;
      case "SpreadExpression":
        return `...${this.emitMappedExpression(expression.value)}`;
      case "UnaryExpression":
        if (expression.operator === "await") {
          return `await ${this.emitMappedExpression(expression.operand)}`;
        }
        return expression.operator === "not"
          ? this.hints.optionalNegations.has(expression.span.start)
            ? `(${this.emitMappedExpression(expression.operand)} == null)`
            : `!(${this.emitMappedExpression(expression.operand)})`
          : `${expression.operator}(${this.emitMappedExpression(expression.operand)})`;
      case "BinaryExpression": {
        if (expression.operator === "in") {
          const membership = this.hints.membershipChecks.get(expression.span.start);
          if (membership === "string") {
            return `${this.emitPostfixReceiver(expression.right)}.includes(${this.emitMappedExpression(expression.left)})`;
          }
          this.needsCollectionHelpers = true;
          const helper = membership === "collection" ? "__velarCollectionHas" : "__velarMembership";
          return `${helper}(${this.emitMappedExpression(expression.right)}, ${this.emitMappedExpression(expression.left)})`;
        }
        const operator = expression.operator === "and" ? "&&" : expression.operator === "or" ? "||" : expression.operator === "==" ? "===" : expression.operator === "!=" ? "!==" : expression.operator;
        const left = expression.operator === "**" && expression.left.kind === "UnaryExpression"
          ? `(${this.emitMappedExpression(expression.left)})`
          : this.emitMappedExpression(expression.left);
        return `(${left} ${operator} ${this.emitMappedExpression(expression.right)})`;
      }
      case "ComparisonChainExpression":
        return this.emitComparisonChain(expression);
      case "ConditionalExpression":
        return `(${this.emitCondition(expression.condition)} ? ${this.emitMappedExpression(expression.thenValue)} : ${this.emitMappedExpression(expression.elseValue)})`;
      case "IsExpression":
        if (this.hints.classChecks.has(expression.span.start)) {
          return `${this.emitMappedExpression(expression.value)} instanceof ${this.typeRuntimeName(expression.type)}`;
        }
        {
          const checked = resolveTypeReference(expression.type);
          return checked.kind === "named"
            ? `${checked.name}.is(${this.emitMappedExpression(expression.value)})`
            : this.emitTypeCheck(checked, this.emitMappedExpression(expression.value));
        }
      case "ArrowFunctionExpression": {
        const body = this.emitMappedExpression(expression.body);
        const emittedBody = expression.body.kind === "ObjectExpression" ? `(${body})` : body;
        return `${expression.asynchronous ? "async " : ""}${expression.parameters.length === 1 && !expression.parameters[0]!.rest && !expression.parameters[0]!.defaultValue
          ? expression.parameters[0]!.name
          : `(${expression.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, parameter.rest)).join(", ")})`} => ${emittedBody}`;
      }
      case "CallExpression": {
        if (expression.callee.kind === "MemberExpression") {
          const helper = this.collectionHelper(expression.callee);
          if (helper) {
            this.needsCollectionHelpers = true;
            const object = this.emitMappedExpression(expression.callee.object);
            const arguments_ = expression.arguments.map((argument) => this.emitMappedExpression(argument));
            if (this.hints.optionalCallees.has(expression.span.start)) {
              const invocation = `${helper}(__value${arguments_.length > 0 ? `, ${arguments_.join(", ")}` : ""})`;
              return `(__velarOptionalCollection(${object}, __value => ${invocation}) ?? null)`;
            }
            return `${helper}(${[object, ...arguments_].join(", ")})`;
          }
        }
        const sourceArguments = expression.arguments.map((argument) => this.emitMappedExpression(argument));
        const namedOrder = this.hints.namedArgumentOrders.get(expression.span.start);
        const arguments_ = namedOrder
          ? namedOrder.map((source) => source === -1 ? "undefined" : `__namedArguments[${source}]`)
          : sourceArguments;
        const wrapNamed = (value: string): string => namedOrder
          ? `((__namedArguments) => ${value})([${sourceArguments.join(", ")}])`
          : value;
        if (this.hints.optionalCallees.has(expression.span.start)) {
          const call = expression.callee.kind === "MemberExpression"
            ? `${this.emitPostfixReceiver(expression.callee.object)}${expression.callee.optional ? "?." : "."}${expression.callee.property}?.(${arguments_.join(", ")})`
            : `${this.emitPostfixReceiver(expression.callee)}?.(${arguments_.join(", ")})`;
          return wrapNamed(`(${call} ?? null)`);
        }
        if (expression.callee.kind === "MemberExpression" && expression.callee.optional) {
          const call = `${this.emitPostfixReceiver(expression.callee.object)}?.${expression.callee.property}(${arguments_.join(", ")})`;
          return wrapNamed(`(${call} ?? null)`);
        }
        let callee: string;
        if (expression.callee.kind === "IdentifierExpression" && (expression.callee.name === "Map" || expression.callee.name === "Set")) {
          this.needsCollectionHelpers = true;
          callee = expression.callee.name === "Map" ? "__velarCreateMap" : "__velarCreateSet";
        } else {
          callee = this.hints.constructorCalls.has(`${expression.span.start}:${expression.span.end}`)
            ? `new ${this.emitMappedExpression(expression.callee)}`
            : this.emitPostfixReceiver(expression.callee);
        }
        const formRead = this.hints.formReads.get(expression.span.start);
        if (formRead) arguments_.push(JSON.stringify(formRead));
        const call = `${callee}(${arguments_.join(", ")})`;
        return wrapNamed(this.hints.optionalCalls.has(expression.span.start) ? `(${call} ?? null)` : call);
      }
      case "MemberExpression": {
        if (this.hints.collectionSizes.has(expression.span.end)) {
          this.needsCollectionHelpers = true;
          const object = this.emitMappedExpression(expression.object);
          return expression.optional
            ? `(__velarOptionalCollection(${object}, __velarCollectionSize) ?? null)`
            : `__velarCollectionSize(${object})`;
        }
        const publicProperty = expression.property;
        const property = `${this.hints.privateMembers.has(expression.span.start) ? "#" : ""}${publicProperty}`;
        const access = `${this.emitPostfixReceiver(expression.object)}${expression.optional ? "?." : "."}${property}`;
        return this.hints.optionalMembers.has(expression.span.start) ? `(${access} ?? null)` : access;
      }
      case "IndexExpression":
        this.needsIndexHelpers = true;
        this.needsCollectionHelpers = true;
        return this.hints.optionalIndexes.has(expression.span.start)
          ? `__velarOptionalIndex(${this.emitMappedExpression(expression.object)}, () => ${this.emitMappedExpression(expression.index)})`
          : `__velarIndex(${this.emitMappedExpression(expression.object)}, ${this.emitMappedExpression(expression.index)})`;
      default:
        return "null";
    }
  }

  protected emitCondition(expression: Expression): string {
    const value = this.emitMappedExpression(expression);
    return this.hints.presenceConditions.has(expression.span.start) ? `(${value} != null)` : value;
  }

  private emitPostfixReceiver(expression: Expression): string {
    const emitted = this.emitMappedExpression(expression);
    if (expression.kind === "ArrowFunctionExpression"
      || expression.kind === "UnaryExpression"
      || expression.kind === "IsExpression"
      || (expression.kind === "LiteralExpression" && typeof expression.value === "number")) {
      return `(${emitted})`;
    }
    return emitted;
  }

  private emitComparisonChain(expression: Extract<Expression, { kind: "ComparisonChainExpression" }>): string {
    const prefix = `$velarCompare${expression.span.start}`;
    const body = [`const ${prefix}_0 = ${this.emitMappedExpression(expression.operands[0]!)};`];
    for (let index = 1; index < expression.operands.length; index += 1) {
      body.push(`const ${prefix}_${index} = ${this.emitMappedExpression(expression.operands[index]!)};`);
      const sourceOperator = expression.operators[index - 1]!;
      const operator = sourceOperator === "==" ? "===" : sourceOperator === "!=" ? "!==" : sourceOperator;
      body.push(`if (!(${prefix}_${index - 1} ${operator} ${prefix}_${index})) return false;`);
    }
    const asynchronous = expression.operands.some((operand) => this.expressionContainsDirectAwait(operand));
    return `${asynchronous ? "await " : ""}(${asynchronous ? "async " : ""}() => { ${body.join(" ")} return true; })()`;
  }

  protected expressionContainsDirectAwait(expression: Expression): boolean {
    const extensionResult = this.extensionExpressionContainsDirectAwait(expression);
    if (extensionResult !== undefined) return extensionResult;
    switch (expression.kind) {
      case "UnaryExpression":
        return expression.operator === "await" || this.expressionContainsDirectAwait(expression.operand);
      case "FStringExpression":
        return expression.parts.some((part) => part.kind === "expression" && this.expressionContainsDirectAwait(part.value));
      case "ListExpression":
        return expression.elements.some((element) => this.expressionContainsDirectAwait(element));
      case "ObjectExpression":
        return expression.properties.some((property) => this.expressionContainsDirectAwait(property.value));
      case "SpreadExpression":
        return this.expressionContainsDirectAwait(expression.value);
      case "BinaryExpression":
        return this.expressionContainsDirectAwait(expression.left) || this.expressionContainsDirectAwait(expression.right);
      case "ComparisonChainExpression":
        return expression.operands.some((operand) => this.expressionContainsDirectAwait(operand));
      case "ConditionalExpression":
        return this.expressionContainsDirectAwait(expression.condition)
          || this.expressionContainsDirectAwait(expression.thenValue)
          || this.expressionContainsDirectAwait(expression.elseValue);
      case "IsExpression":
        return this.expressionContainsDirectAwait(expression.value);
      case "CallExpression":
        return this.expressionContainsDirectAwait(expression.callee)
          || expression.arguments.some((argument) => this.expressionContainsDirectAwait(argument));
      case "MemberExpression":
        return this.expressionContainsDirectAwait(expression.object);
      case "IndexExpression":
        return this.expressionContainsDirectAwait(expression.object)
          || this.expressionContainsDirectAwait(expression.index);
      case "ArrowFunctionExpression":
      case "DynamicImportExpression":
      case "LiteralExpression":
      case "IdentifierExpression":
      case "SuperExpression":
        return false;
      default:
        return false;
    }
  }

  private typeRuntimeName(reference: TypeReference): string {
    const type = resolveTypeReference(reference);
    return type.kind === "named" ? type.name : formatTypeReference(reference);
  }

  private collectionHelper(expression: Extract<Expression, { kind: "MemberExpression" }>): string | null {
    switch (this.hints.collectionCalls.get(expression.span.end)) {
      case "get": return "__velarCollectionGet";
      case "slice": return "__velarCollectionSlice";
      case "listAppend": return "__velarListAppend";
      case "listExtend": return "__velarListExtend";
      case "listInsert": return "__velarListInsert";
      case "listRemove": return "__velarListRemove";
      case "listPop": return "__velarListPop";
      case "listCopy": return "__velarListCopy";
      case "listCount": return "__velarListCount";
      case "listFind": return "__velarListFind";
      case "listIndex": return "__velarListIndex";
      case "listSome": return "__velarListSome";
      case "listEvery": return "__velarListEvery";
      case "listMap": return "__velarListMap";
      case "listFilter": return "__velarListFilter";
      case "listReduce": return "__velarListReduce";
      case "listJoin": return "__velarListJoin";
      case "listSorted": return "__velarListSorted";
      case "listReversed": return "__velarListReversed";
      case "setAdd": return "__velarSetAdd";
      case "setUpdate": return "__velarSetUpdate";
      case "setCopy": return "__velarSetCopy";
      case "mapSet": return "__velarMapSet";
      case "mapUpdate": return "__velarMapUpdate";
      case "mapCopy": return "__velarMapCopy";
      case "has": return "__velarCollectionHas";
      case "remove": return "__velarCollectionRemove";
      case "clear": return "__velarCollectionClear";
      case "keys": return "__velarCollectionKeys";
      case "values": return "__velarCollectionValues";
      case "entries": return "__velarCollectionEntries";
      default: return null;
    }
  }

  protected emitObjectKey(name: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
  }

  private emitMatchPatternAttempt(
    pattern: MatchPattern,
    valueName: string,
    indentation: string,
  ): {
    readonly lines: readonly string[];
    readonly bindings: readonly { readonly name: string; readonly value: string }[];
  } {
    const lines: string[] = [];
    const bindings = new Map<string, string>();
    let nextTemporary = 0;
    const temporary = (label: string): string => `__velarPattern${pattern.span.start}${label}${nextTemporary++}`;
    const bind = (name: string, value: string): void => {
      if (name !== "_" && !bindings.has(name)) bindings.set(name, value);
    };
    const rejectUnless = (condition: string): void => {
      lines.push(`${indentation}if (!(${condition})) return null;`);
    };

    const emit = (current: MatchPattern, value: string): void => {
      switch (current.kind) {
        case "MatchWildcardPattern":
          break;
        case "MatchCapturePattern":
          bind(current.binding.name, value);
          break;
        case "MatchAsPattern":
          emit(current.pattern, value);
          bind(current.binding.name, value);
          break;
        case "MatchValuePattern":
          rejectUnless(current.values.map((candidate) => `${value} === ${this.emitMappedExpression(candidate)}`).join(" || ") || "false");
          break;
        case "MatchTypePattern":
          rejectUnless(this.emitTypeCheck(resolveTypeReference(current.type), value));
          break;
        case "MatchListPattern": {
          const items = temporary("List");
          const length = current.elements.length;
          rejectUnless(`Array.isArray(${value}) && ${value}.length <= 1000000 && ${value}.length ${current.rest ? ">=" : "==="} ${length} && Object.getOwnPropertySymbols(${value}).length === 0 && Object.getOwnPropertyNames(${value}).length === ${value}.length + 1`);
          const lengthDescriptor = temporary("Length");
          lines.push(`${indentation}const ${lengthDescriptor} = Object.getOwnPropertyDescriptor(${value}, "length");`);
          rejectUnless(`${lengthDescriptor} && ${lengthDescriptor}.writable && !${lengthDescriptor}.enumerable && !${lengthDescriptor}.configurable && "value" in ${lengthDescriptor}`);
          lines.push(`${indentation}const ${items} = [];`);
          const cursor = temporary("Index");
          const descriptor = temporary("Item");
          lines.push(`${indentation}for (let ${cursor} = 0; ${cursor} < ${value}.length; ${cursor} += 1) {`);
          lines.push(`${indentation}  const ${descriptor} = Object.getOwnPropertyDescriptor(${value}, ${cursor});`);
          lines.push(`${indentation}  if (!${descriptor}?.enumerable || !${descriptor}.configurable || !${descriptor}.writable || !("value" in ${descriptor})) return null;`);
          lines.push(`${indentation}  Object.defineProperty(${items}, ${items}.length, { value: ${descriptor}.value, writable: true, enumerable: true, configurable: true });`);
          lines.push(`${indentation}}`);
          current.elements.forEach((child, index) => emit(child, `${items}[${index}]`));
          if (current.rest) {
            const rest = temporary("Rest");
            const restCursor = temporary("RestIndex");
            lines.push(`${indentation}const ${rest} = [];`);
            lines.push(`${indentation}for (let ${restCursor} = ${length}; ${restCursor} < ${items}.length; ${restCursor} += 1) {`);
            lines.push(`${indentation}  Object.defineProperty(${rest}, ${rest}.length, { value: ${items}[${restCursor}], writable: true, enumerable: true, configurable: true });`);
            lines.push(`${indentation}}`);
            bind(current.rest.name, rest);
          }
          break;
        }
        case "MatchObjectPattern": {
          rejectUnless(`${value} !== null && typeof ${value} === "object" && !Array.isArray(${value})`);
          for (const entry of current.entries) {
            const descriptor = temporary("Field");
            const fieldValue = temporary("Value");
            lines.push(`${indentation}const ${descriptor} = Object.getOwnPropertyDescriptor(${value}, ${JSON.stringify(entry.property)});`);
            rejectUnless(`${descriptor}?.enumerable && "value" in ${descriptor}`);
            lines.push(`${indentation}const ${fieldValue} = ${descriptor}.value;`);
            emit(entry.pattern, fieldValue);
          }
          if (current.rest) {
            const rest = temporary("Rest");
            const key = temporary("Key");
            const descriptor = temporary("RestField");
            const selected = current.entries.map((entry) => `${key} === ${JSON.stringify(entry.property)}`).join(" || ") || "false";
            rejectUnless(`Object.getOwnPropertySymbols(${value}).length === 0`);
            lines.push(`${indentation}const ${rest} = {};`);
            lines.push(`${indentation}for (const ${key} of Object.getOwnPropertyNames(${value})) {`);
            lines.push(`${indentation}  if (${selected}) continue;`);
            lines.push(`${indentation}  const ${descriptor} = Object.getOwnPropertyDescriptor(${value}, ${key});`);
            lines.push(`${indentation}  if (!${descriptor}?.enumerable) continue;`);
            lines.push(`${indentation}  if (!("value" in ${descriptor})) return null;`);
            lines.push(`${indentation}  Object.defineProperty(${rest}, ${key}, { value: ${descriptor}.value, writable: true, enumerable: true, configurable: true });`);
            lines.push(`${indentation}}`);
            bind(current.rest.name, rest);
          }
          break;
        }
      }
    };

    emit(pattern, valueName);
    return { lines, bindings: [...bindings].map(([name, value]) => ({ name, value })) };
  }

  protected emitBindingPattern(pattern: BindingPattern): string {
    if (pattern.kind === "NameBindingPattern") return pattern.name;
    if (pattern.kind === "ObjectBindingPattern") {
      const entries = pattern.entries.map((entry) => {
        const emitted = this.emitBindingPattern(entry.pattern);
        return entry.pattern.kind === "NameBindingPattern" && entry.pattern.name === entry.property ? entry.property : `${entry.property}: ${emitted}`;
      });
      if (pattern.rest) entries.push(`...${pattern.rest.name}`);
      return `{ ${entries.join(", ")} }`;
    }
    const entries = pattern.elements.map((element) => element ? this.emitBindingPattern(element) : "");
    if (pattern.rest) entries.push(`...${pattern.rest.name}`);
    return `[${entries.join(", ")}]`;
  }

  private escapeTemplateText(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
  }

  protected blockAlwaysReturns(statements: readonly Statement[]): boolean {
    for (const statement of statements) {
      if (statement.kind === "ReturnStatement" || statement.kind === "ThrowStatement") return true;
      if (statement.kind === "IfStatement" && statement.elseBody
        && this.blockAlwaysReturns(statement.thenBody) && this.blockAlwaysReturns(statement.elseBody)) return true;
      if (statement.kind === "MatchStatement" && (statement.elseBody || this.hints.exhaustiveMatches.has(statement.span.start))
        && statement.cases.every((branch) => this.blockAlwaysReturns(branch.body))
        && (!statement.elseBody || this.blockAlwaysReturns(statement.elseBody))) return true;
      if (statement.kind === "TryStatement") {
        if (statement.finallyBody && this.blockAlwaysReturns(statement.finallyBody)) return true;
        if (statement.catchBody && this.blockAlwaysReturns(statement.tryBody) && this.blockAlwaysReturns(statement.catchBody)) return true;
      }
    }
    return false;
  }
}

const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeVlq(value: number): string {
  let remaining = value < 0 ? ((-value) << 1) | 1 : value << 1;
  let output = "";
  do {
    let digit = remaining & 31;
    remaining >>>= 5;
    if (remaining > 0) digit |= 32;
    output += base64[digit];
  } while (remaining > 0);
  return output;
}

function generatedLineAt(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle]! <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}
