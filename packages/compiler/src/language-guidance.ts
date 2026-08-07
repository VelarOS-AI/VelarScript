export interface SourceTypeGuidance {
  readonly message: string;
  readonly replacement: string | null;
  readonly title: string | null;
}

export type CollectionKind = "List" | "Set" | "Map";

export interface CollectionMemberGuidance {
  readonly message: string;
  readonly replacement: string | null;
  readonly title: string | null;
}

const sourceTypeGuidance = new Map<string, SourceTypeGuidance>([
  ["Array", typeReplacement("Use 'List<T>' for ordered collections; VelarScript exposes one source-level List type", "List", "Use the VelarScript List type")],
  ["array", typeReplacement("Use 'List<T>' for ordered collections; VelarScript exposes one source-level List type", "List", "Use the VelarScript List type")],
  ["list", typeReplacement("Use 'List<T>' for ordered collections", "List", "Use the VelarScript List type")],
  ["dict", typeReplacement("Use 'Map<K, V>' for keyed collections", "Map", "Use the VelarScript Map type")],
  ["set", typeReplacement("Use 'Set<T>' for unique collections", "Set", "Use the VelarScript Set type")],
  ["str", typeReplacement("Use 'string' for text values; str(value) is only the explicit text conversion function", "string", "Use the VelarScript string type")],
  ["String", typeReplacement("Use 'string' for text values; JavaScript wrapper-object types are not exposed", "string", "Use the VelarScript string type")],
  ["Number", typeReplacement("Use 'number'; JavaScript wrapper-object types are not exposed", "number", "Use the VelarScript number type")],
  ["boolean", typeReplacement("Use 'bool' for boolean values", "bool", "Use the VelarScript bool type")],
  ["Boolean", typeReplacement("Use 'bool'; JavaScript wrapper-object types are not exposed", "bool", "Use the VelarScript bool type")],
  ["void", typeReplacement("Use 'null' for an explicit no-result type, or omit a function result annotation", "null", "Use the VelarScript null type")],
  ["object", typeGuidance("Declare a named 'type' for an object shape, or use 'unknown' at an unchecked boundary")],
  ["Object", typeGuidance("Declare a named 'type' for an object shape, or use 'unknown' at an unchecked boundary")],
  ["Function", typeGuidance("Write an explicit function type such as '(value: string) -> bool'")],
  ["Callable", typeGuidance("Write an explicit function type such as '(value: string) -> bool'")],
]);

const collectionGuidance = new Map<CollectionKind, ReadonlyMap<string, CollectionMemberGuidance>>([
  ["List", new Map([
    ["length", memberReplacement("Use 'size'", "size", "Use List size")],
    ["at", memberReplacement("Use 'get(index)'", "get", "Use List.get")],
    ["includes", memberReplacement("Use 'has(value)'", "has", "Use List.has")],
    ["contains", memberReplacement("Use 'has(value)'", "has", "Use List.has")],
    ["add", memberReplacement("Use 'append(value)'", "append", "Use List.append")],
    ["addAll", memberReplacement("Use 'extend(values)'", "extend", "Use List.extend")],
    ["push", memberReplacement("Use 'append(value)'", "append", "Use List.append")],
    ["unshift", memberGuidance("Use 'insert(0, value)'")],
    ["shift", memberGuidance("Use 'pop(0)'")],
    ["set", memberGuidance("Use indexed assignment such as 'values[index] = value'")],
    ["delete", memberGuidance("Use 'remove(value)' to remove by value, or 'pop(index)' to remove by index")],
    ["deleteAt", memberReplacement("Use 'pop(index)'", "pop", "Use List.pop")],
    ["first", memberGuidance("Use 'get(0)'")],
    ["last", memberGuidance("Use 'get(-1)'")],
    ["findIndex", memberGuidance("Use 'find(test)' when you need the matching value, or 'index(value)' when locating a known value")],
    ["indexOf", memberReplacement("Use 'index(value)'", "index", "Use List.index")],
    ["any", memberReplacement("Use 'some(test)'", "some", "Use List.some")],
    ["all", memberReplacement("Use 'every(test)'", "every", "Use List.every")],
    ["sort", memberGuidance("Use non-mutating 'sorted(compare)' and keep its returned List")],
    ["reverse", memberGuidance("Use non-mutating 'reversed()' and keep its returned List")],
    ["splice", memberGuidance("Use 'insert', 'remove', 'pop', or 'slice' for one explicit operation")],
  ])],
  ["Set", new Map([
    ["length", memberReplacement("Use 'size'", "size", "Use Set size")],
    ["addAll", memberReplacement("Use 'update(values)'", "update", "Use Set.update")],
    ["append", memberReplacement("Use 'add(value)'", "add", "Use Set.add")],
    ["push", memberReplacement("Use 'add(value)'", "add", "Use Set.add")],
    ["includes", memberReplacement("Use 'has(value)'", "has", "Use Set.has")],
    ["contains", memberReplacement("Use 'has(value)'", "has", "Use Set.has")],
    ["delete", memberReplacement("Use 'remove(value)'", "remove", "Use Set.remove")],
  ])],
  ["Map", new Map([
    ["length", memberReplacement("Use 'size'", "size", "Use Map size")],
    ["setAll", memberReplacement("Use 'update(other)'", "update", "Use Map.update")],
    ["put", memberReplacement("Use 'set(key, value)'", "set", "Use Map.set")],
    ["includes", memberReplacement("Use 'has(key)'", "has", "Use Map.has")],
    ["includesKey", memberReplacement("Use 'has(key)'", "has", "Use Map.has")],
    ["contains", memberReplacement("Use 'has(key)'", "has", "Use Map.has")],
    ["containsKey", memberReplacement("Use 'has(key)'", "has", "Use Map.has")],
    ["delete", memberReplacement("Use 'remove(key)'", "remove", "Use Map.remove")],
  ])],
]);

export interface DeclarationKeywordGuidance {
  readonly message: string;
  readonly keyword: "def" | "type";
}

const functionKeywordGuidance: DeclarationKeywordGuidance = { message: "Use 'def'; VelarScript declares functions with 'def name(...)'", keyword: "def" };
const typeKeywordGuidance: DeclarationKeywordGuidance = { message: "Use 'type'; VelarScript declares record shapes with 'type Name:'", keyword: "type" };

const declarationKeywordGuidanceEntries = new Map<string, DeclarationKeywordGuidance>([
  ["fn", functionKeywordGuidance],
  ["func", functionKeywordGuidance],
  ["function", functionKeywordGuidance],
  ["record", typeKeywordGuidance],
  ["struct", typeKeywordGuidance],
  ["interface", typeKeywordGuidance],
]);

const stringMemberGuidanceEntries = new Map<string, string>([
  ["trim", "Use trim(value) from 'velar/text'; string operations are functions"],
  ["trimStart", "Use trimStart(value) from 'velar/text'; string operations are functions"],
  ["trimEnd", "Use trimEnd(value) from 'velar/text'; string operations are functions"],
  ["toUpperCase", "Use upper(value) from 'velar/text'; string operations are functions"],
  ["toLowerCase", "Use lower(value) from 'velar/text'; string operations are functions"],
  ["upper", "Use upper(value) from 'velar/text'; string operations are functions"],
  ["lower", "Use lower(value) from 'velar/text'; string operations are functions"],
  ["includes", "Use includes(value, part) from 'velar/text'; string operations are functions"],
  ["startsWith", "Use startsWith(value, prefix) from 'velar/text'; string operations are functions"],
  ["endsWith", "Use endsWith(value, suffix) from 'velar/text'; string operations are functions"],
  ["split", "Use split(value, separator) from 'velar/text'; string operations are functions"],
  ["replace", "Use replace(value, search, replacement) from 'velar/text'; string operations are functions"],
  ["replaceAll", "Use replaceAll(value, search, replacement) from 'velar/text'; string operations are functions"],
  ["padStart", "Use padStart(value, length) from 'velar/text'; string operations are functions"],
  ["padEnd", "Use padEnd(value, length) from 'velar/text'; string operations are functions"],
  ["repeat", "Use repeat(value, count) from 'velar/text'; string operations are functions"],
]);

export function declarationKeywordGuidance(name: string): DeclarationKeywordGuidance | null {
  return declarationKeywordGuidanceEntries.get(name) ?? null;
}

export function stringMemberGuidance(name: string): string | null {
  return stringMemberGuidanceEntries.get(name) ?? null;
}

export function sourceTypeNameGuidance(name: string): SourceTypeGuidance | null {
  return sourceTypeGuidance.get(name) ?? null;
}

export function collectionMemberGuidance(kind: CollectionKind, member: string): CollectionMemberGuidance | null {
  return collectionGuidance.get(kind)?.get(member) ?? null;
}

function typeGuidance(message: string): SourceTypeGuidance {
  return { message, replacement: null, title: null };
}

function typeReplacement(message: string, value: string, title: string): SourceTypeGuidance {
  return { message, replacement: value, title };
}

function memberGuidance(message: string): CollectionMemberGuidance {
  return { message, replacement: null, title: null };
}

function memberReplacement(message: string, value: string, title: string): CollectionMemberGuidance {
  return { message, replacement: value, title };
}
