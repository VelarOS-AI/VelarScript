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
  ["void", typeReplacement("Use 'null' for an explicit no-result type; omitted body-backed results are inferred", "null", "Use the VelarScript null type")],
  ["object", typeGuidance("Declare a named 'type' for an object shape, or use 'unknown' at an unchecked boundary")],
  ["Object", typeGuidance("Declare a named 'type' for an object shape, or use 'unknown' at an unchecked boundary")],
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
    ["forEach", memberGuidance("Use a structured loop for side effects — 'for value in values:' followed by the effect in its indented body")],
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
  ["schema", typeKeywordGuidance],
]);

const stringMemberGuidanceEntries = new Map<string, string>([
  ["length", "Use '.size'; strings count Unicode code points like List.size"],
  ["substring", "Use '.slice(start, end)'; VelarScript has one string slicing method"],
  ["substr", "Use '.slice(start, end)'; VelarScript has one string slicing method"],
  ["charAt", "Use '.char(index)'; string positions count Unicode code points"],
  ["at", "Use '.char(index)'; string positions count Unicode code points"],
  ["indexOf", "Use '.index(text, start)'; missing text returns null and string positions count Unicode code points"],
  ["lastIndexOf", "Use '.index(text, start)' to search forward; VelarScript has no reverse string search member"],
  // D51 item "two-round retirement": the destination is the spelling that
  // survives. Naming 'velar/text' here sent the author to an import the
  // project driver retires on the next run, so the guidance taught a loop.
  ["trimStart", "Use Text.trimStart(value); string operations beyond the core members live in the Text namespace, which needs no import"],
  ["trimEnd", "Use Text.trimEnd(value); string operations beyond the core members live in the Text namespace, which needs no import"],
  ["toUpperCase", "Use '.upper()'; VelarScript exposes one string uppercase spelling"],
  ["toLowerCase", "Use '.lower()'; VelarScript exposes one string lowercase spelling"],
  ["includes", "Use '.has(text)'; strings and collections share one membership method"],
  // The List, Set, and Map tables have carried 'contains' since they were
  // written; a string is the fourth thing membership is asked of, and it is the
  // one spelling an author reaches for from Java, C#, Kotlin, or Dart.
  ["contains", "Use '.has(text)'; strings and collections share one membership method"],
  ["toString", "Use 'str(value)' or an f-string; VelarScript has one explicit text conversion spelling"],
  // TXT-I1: the Python spellings, each pointed at the member or the `Text.`
  // namespace function that exists.
  ["strip", "Use '.trim()'; VelarScript trims whitespace with the trim member"],
  ["lstrip", "Use Text.trimStart(value); string operations beyond the core members live in the Text namespace, which needs no import"],
  ["rstrip", "Use Text.trimEnd(value); string operations beyond the core members live in the Text namespace, which needs no import"],
  ["startswith", "Use '.startsWith(text)'; VelarScript member names are camelCase"],
  ["endswith", "Use '.endsWith(text)'; VelarScript member names are camelCase"],
  ["find", "Use '.index(text, start)'; missing text returns null instead of -1"],
  ["splitlines", "Use Text.lines(value); it splits on line boundaries, and the Text namespace needs no import"],
  ["casefold", "Use '.lower()'; VelarScript exposes simple case mapping, not locale case folding"],
  ["format", "Use an f-string — f\"Hello {name}\" — VelarScript interpolates values instead of format()"],
  ["title", "Use Text.title(value); string operations beyond the core members live in the Text namespace, which needs no import"],
  ["capitalize", "Use Text.capitalize(value); string operations beyond the core members live in the Text namespace, which needs no import"],
]);

const removedStandardFunctionGuidanceEntries = new Map<string, ReadonlyMap<string, string>>([
  ["velar/text", new Map([
    ["length", "Use 'value.size'; string measurement is a checked member"],
    ["char", "Use 'value.char(index)'; string access is a checked member"],
    ["slice", "Use 'value.slice(start, end)'; string slicing is a checked member"],
    ["trim", "Use 'value.trim()'; string trimming is a checked member"],
    ["lower", "Use 'value.lower()'; string lowercasing is a checked member"],
    ["upper", "Use 'value.upper()'; string uppercasing is a checked member"],
    ["startsWith", "Use 'value.startsWith(text)'; string prefix checks are checked members"],
    ["endsWith", "Use 'value.endsWith(text)'; string suffix checks are checked members"],
    ["includes", "Use 'value.has(text)'; strings and collections share one membership method"],
    ["indexOf", "Use 'value.index(text, start)'; missing text returns null and string positions count Unicode code points"],
    ["split", "Use 'value.split(separator)'; string splitting is a checked member"],
    ["replace", "Use 'value.replace(from, to)'; string replacement is a checked member"],
    ["replaceAll", "Use 'value.replaceAll(from, to)'; string replacement is a checked member"],
    ["repeat", "Use 'value.repeat(count)'; string repetition is a checked member"],
    ["padStart", "Use 'value.padStart(size, fill)'; string padding is a checked member"],
    ["padEnd", "Use 'value.padEnd(size, fill)'; string padding is a checked member"],
  ])],
  ["velar/math", new Map([
    ["abs", "Use 'value.abs()'; absolute value is a checked number member"],
    ["round", "Use 'value.round()'; number rounding is a checked member"],
    ["floor", "Use 'value.floor()'; number flooring is a checked member"],
    ["ceil", "Use 'value.ceil()'; number ceiling is a checked member"],
    ["isFinite", "Use 'value.isFinite()'; finite-number checks are checked members"],
    ["isInteger", "Use 'value.isInteger()'; integer checks are checked members"],
  ])],
]);

/**
 * LOK-I5: the visual unit vocabulary belongs to `@velarscript/web`, which adds
 * these suffixes to the lexer. Core keeps the list only to recognize the
 * spelling and name the extension that owns it — the same cross-extension
 * guidance D37 rule 45 established for Web statement shapes — instead of
 * reporting a unit the author spelled perfectly well as unknown. Core's own
 * duration suffixes (`ms`, `s`) are not in this list; they are Core's.
 */
const webNumericUnits = new Set(["px", "rem", "em", "vw", "vh", "vmin", "vmax", "%", "fr", "deg", "turn"]);

export function webNumericUnitOwner(suffix: string): string | null {
  return webNumericUnits.has(suffix) ? "@velarscript/web" : null;
}

export function declarationKeywordGuidance(name: string): DeclarationKeywordGuidance | null {
  return declarationKeywordGuidanceEntries.get(name) ?? null;
}

export function stringMemberGuidance(name: string): string | null {
  return stringMemberGuidanceEntries.get(name) ?? null;
}

export function removedStandardFunctionGuidance(source: string, name: string): string | null {
  return removedStandardFunctionGuidanceEntries.get(source)?.get(name) ?? null;
}

export function removedGlobalFunctionGuidance(name: string): string | null {
  for (const entries of removedStandardFunctionGuidanceEntries.values()) {
    const guidance = entries.get(name);
    if (guidance) return guidance;
  }
  return null;
}

/**
 * D65 rule 170: one sentence, two stages. A rest parameter without an element
 * type is refused by the parser in every declaration, and by the analyzer in
 * an arrow, where the contextual function type gets its chance to supply one
 * first — exactly as a fixed parameter's type already arrives. Both stages say
 * the same thing because it is the same refusal.
 */
export const REST_PARAMETER_ELEMENT_TYPE_MESSAGE = "A rest parameter requires an element type";

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
