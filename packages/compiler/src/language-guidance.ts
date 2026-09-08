export interface SourceTypeGuidance {
  readonly message: string;
  readonly replacement: string | null;
  readonly title: string | null;
  /**
   * RE-C3 / RE-U1 (D114 item 9): what to write instead, for a guided spelling
   * whose successor is a shape rather than a single name. `Array` names `List`,
   * so a rewrite carries it; `object` names "a record type you declare", which
   * no rewrite can guess. Both kinds are guided spellings all the same — every
   * type position refuses them — so both refuse a declaration spelled with
   * them, and this clause is what such a refusal offers in place of a name.
   */
  readonly declarationAdvice: string | null;
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
  ["object", typeGuidance("Declare a named 'type' for an object shape, or use 'unknown' at an unchecked boundary", "declare a named 'type' for the shape, or use 'unknown' at an unchecked boundary")],
  ["Object", typeGuidance("Declare a named 'type' for an object shape, or use 'unknown' at an unchecked boundary", "declare a named 'type' for the shape, or use 'unknown' at an unchecked boundary")],
  ["Callable", typeGuidance("Write an explicit function type such as '(value: string) -> bool'", "write an explicit function type such as '(value: string) -> bool'")],
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

/**
 * AS-U3 / AS-I5: the JavaScript `Promise` statics a model writes from prior
 * knowledge, and what VelarScript answers instead. `resolve` and `reject` have
 * no Vel spelling because an `async def` already *is* the constructor of a
 * settled Promise — the value it returns and the error it throws — and
 * `allSettled` has none because `try await` already turns one failure into a
 * value, so the whole-list wait is `Promise.all` over that. The
 * `docs/standard-library.md` `Promise.` table states the same three.
 */
const permanentNamespaceReflectionGuidanceEntries: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  ["Promise", new Map([
    ["resolve", "an 'async def' result is already a Promise, so pass the value itself and let the awaiting side see it"],
    ["reject", "throw the error inside an 'async def'; the throw is the rejection"],
    ["allSettled", "Promise.all is the whole-list wait, and 'try await' turns one failure into null — map each task through it and every result is a value"],
    ["then", "await the Promise; VelarScript has no 'then' chaining"],
    ["catch", "wrap the await in try/catch, or use 'try await' when null is the answer you want"],
    ["finally", "put the cleanup in a 'finally' block around the await"],
  ])],
]);

/** The successor sentence for a JavaScript static written on a permanent namespace, when there is one. */
export function permanentNamespaceReflectionGuidance(namespace: string, member: string): string | null {
  return permanentNamespaceReflectionGuidanceEntries.get(namespace)?.get(member) ?? null;
}

/**
 * RE-I5 / RE-C1: `any` is not one of the Core types charter §5 lists, so every
 * declaring position refuses it with the sentence every annotation position
 * already gives — the word names no type, and `unknown` is what an unchecked
 * boundary value is annotated with. The roster sentence ("every use of it
 * resolves to the built-in") asserted a built-in that does not exist.
 */
export function refusedAnyDeclarationMessage(position: string): string {
  return `'any' is not a VelarScript type, so it cannot name ${/^[aeiou]/iu.test(position) ? "an" : "a"} ${position}`
    + "; an unchecked boundary value is 'unknown', which is what you annotate";
}

/**
 * RE-C3 / RE-U1 (D114 item 9): the roster sentence a declaring position gives a
 * guided spelling whose successor is a shape rather than a name, or `null` when
 * the spelling is not one of those.
 *
 * Charter §5's criterion is that a declaration "would declare a name no
 * annotation can reach". `object`, `Object` and `Callable` met it and were
 * accepted anyway: `class object:` compiled and ran, and every `x: object`
 * after it was refused — the exact "declaration writable, every use refused"
 * shape the 0.29.0 rule exists to remove. The sentence states the rule and
 * carries the guidance's own replacement, because a refusal that names no
 * successor is the report `Object` used to earn.
 */
export function refusedGuidedDeclarationMessage(name: string, position: string): string | null {
  const advice = sourceTypeGuidance.get(name)?.declarationAdvice ?? null;
  if (advice === null) return null;
  return `'${name}' is a guided spelling no type position accepts, so it cannot name ${/^[aeiou]/iu.test(position) ? "an" : "a"} ${position}; ${advice}`;
}

/**
 * CO-I1: the one sentence both duplicate-import reports say.
 *
 * `import {title}` twice, and `import {title}` beside `import {title as
 * other}`, are the same mistake seen from two positions — one export arriving
 * twice — so they cannot give two different answers, and the answer the older
 * of the two gave ("alias one of the imports") is the spelling 0.30.0's own
 * rule then refuses. Deleting one import is the whole fix; an author who really
 * wants a second name for the value writes an ordinary binding, which is not an
 * import at all and collides with nothing.
 */
export function duplicateImportMessage(imported: string, source: string, first: string): string {
  return `Name '${imported}' is already imported from ${JSON.stringify(source)}`
    + `; one export arrives once — delete the duplicate import; to bind it under a second name write 'const other = ${first}'`;
}

/**
 * CO-I1: the alias advice, spelling the *export* the colliding import binds.
 *
 * `import {alpha as shared}` beside `import {beta as shared}` is the one
 * collision 0.31.0 kept an alias for — two different exports wanting one local
 * name — and the sentence it earned spelled the local: `import {shared as
 * other}`. Following that answered `Module './lib.vel' has no export named
 * 'shared'`, because the local is the half that is already wrong. `other` is
 * the placeholder local, the same one `duplicateImportMessage` writes; where
 * the export is itself named `other` the placeholder moves, or the advice would
 * read as a rename to the name it already has.
 */
export function duplicateImportAliasAdvice(name: string, source: string, exported: string, collides: "import" | "declaration"): string {
  const alias = exported === "other" ? "another" : "other";
  return `Name '${name}' is already imported from ${JSON.stringify(source)}; `
    + (collides === "import" ? "alias one of the imports" : "rename this declaration, or alias the import")
    + ` — import {${exported} as ${alias}}`;
}

/**
 * RE-I4: the type-reference nodes whose name the author did not write. A guided
 * spelling in a type position is reported where it stands and then recovered as
 * the name it is guided to, so the node carries a name the source does not
 * spell. Anything that would *quote* that name back at the author asks here
 * first: the guidance already stands at the span, and a second sentence about a
 * word nobody wrote is the report `const value: Array` used to earn ("Unknown
 * type 'List'"). The set lives beside the guidance table because that is what
 * produced the rewrite, and it is keyed on node identity, so an entry lives
 * exactly as long as the tree that owns it.
 */
const guidedTypeNameNodes = new WeakSet<object>();

export function markGuidedTypeName(node: object): void {
  guidedTypeNameNodes.add(node);
}

export function isGuidedTypeName(node: object): boolean {
  return guidedTypeNameNodes.has(node);
}

/**
 * CO-I4: the bare `Function` annotations whose report waits for the initializer.
 *
 * The retired shorthand names no signature, so the parser had nothing to offer
 * but a constant `() -> null` — a spelling that is right at no site, and that
 * then earned the annotation a second report (`Cannot assign (a: number) ->
 * number to () -> null`) for the type the parser invented. Variable and class
 * field initializers can supply the real signature, so their sites are
 * answered by the analyzer. Other positions receive the parser's shape
 * guidance. Every marked node resolves as invalid, never as an invented
 * contract that could cause a follow-on assignment or call diagnostic.
 */
const retiredFunctionAnnotations = new WeakSet<object>();

export function markRetiredFunctionAnnotation(node: object): void {
  retiredFunctionAnnotations.add(node);
}

export function isRetiredFunctionAnnotation(node: object): boolean {
  return retiredFunctionAnnotations.has(node);
}

/** The retired-shorthand sentence: the arrow when it is known, the shape when it is not. */
export function retiredFunctionShorthandMessage(written: "Function" | "Function<...>", spelling: string | null): string {
  return `The '${written}' type shorthand is retired; a function type has one spelling, the arrow — ${spelling === null
    ? "write the parameter types in parentheses, then '->', then the result type this position takes"
    : `write '${spelling}'`}`;
}

/**
 * CO-I5: the validation ritual, written so it can be pasted back.
 *
 * `'Type.parse'` was the toolchain's most repeated remedy and it is not a
 * spelling: `Type` is a builtin *type* name, legal in an annotation
 * (`const t: Type<User> = User`) and bound to no value, so `Type.parse(raw)`
 * answers `Unknown name 'Type'`. Where the refusal already names the type the
 * author declared, the sentence uses that name and the author's own spelling
 * of the value, and compiles verbatim. Where nothing at the site names one —
 * a call on an undeclared foreign value, an `await` on one — the placeholder
 * is written as a placeholder, so that it reads as a blank to fill rather than
 * as an identifier to copy.
 */
export function validationRitual(typeName: string | null, valueText: string | null): string {
  return `'${typeName ?? "<YourType>"}.parse(${valueText ?? "value"})'`;
}

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
    ["sign", "Use 'value.sign()'; number sign is a checked member"],
    ["trunc", "Use 'value.trunc()'; number truncation is a checked member"],
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

function typeGuidance(message: string, declarationAdvice: string | null = null): SourceTypeGuidance {
  return { message, replacement: null, title: null, declarationAdvice };
}

function typeReplacement(message: string, value: string, title: string): SourceTypeGuidance {
  return { message, replacement: value, title, declarationAdvice: null };
}

function memberGuidance(message: string): CollectionMemberGuidance {
  return { message, replacement: null, title: null };
}

function memberReplacement(message: string, value: string, title: string): CollectionMemberGuidance {
  return { message, replacement: value, title };
}

/**
 * CO-I2: the four Core collection names written where a value belongs.
 *
 * `List.repeat(...)`, `Map.get(...)`, `Set.add(...)` and `Record.keys(...)` are
 * one mistake — a collection type name used as if it carried the operations —
 * and they used to earn three different answers: `List` the sentence below,
 * `Map` and `Set` a boundary-validation lecture about declaring `type Map:`
 * (a declaration the very next `velar check` refuses, because the name is
 * built in), and `Record` a bare "Unknown name". Each sentence names how a
 * value of that family is built and where its operations live, and ends on the
 * same clause, because the reason is the same for all four.
 */
export const coreCollectionConstructorGuidance: readonly (readonly [string, string])[] = [
  ["List", "Lists are created with a '[]' literal (or [...values] to copy); 'List<T>' is a type name, not a constructor"],
  ["Map", "Maps are created with a 'Map(...)' call — Map({key: value}) from a record, Map([[key, value]]) from entries — and every operation is a member of the Map value; 'Map<K, V>' is a type name, not a constructor"],
  ["Set", "Sets are created with a 'Set(...)' call — Set([value]) copies a List — and every operation is a member of the Set value; 'Set<T>' is a type name, not a constructor"],
  ["Record", "A record is a '{field: value}' literal, and every operation is a member of that value; 'Record<V>' is a type name, not a constructor"],
];

/** The one sentence a Core collection type name earns where a value belongs. */
export function coreCollectionConstructorMessage(name: string): string | null {
  return coreCollectionConstructorGuidance.find(([key]) => key === name)?.[1] ?? null;
}

/**
 * D90 (coherence): the one report an unresolved global name earns, by name.
 *
 * D115 §三: this table is language guidance, so it lives with the rest of it
 * rather than in the analyzer's composition root; the analyzer copies it into
 * the map an extension may add to.
 */
export const coreGlobalGuidance = new Map([
  ["arguments", "Use named parameters; VelarScript does not expose the JavaScript 'arguments' binding"],
  ["console", "Use print(value) or an explicit JavaScript boundary instead of the console global"],
  ["JSON", "Use 'Json.parse(text)' or 'Json.stringify(value)'; VelarScript namespaces use PascalCase"],
  ["Object", "Use record fields directly or Record<T>.keys(); VelarScript does not expose the JavaScript Object namespace"],
  ["Array", "Use a '[]' List literal and List methods; VelarScript does not expose the JavaScript Array namespace"],
  // D52 rule 116: `Math` is a permanent namespace of its own now, so it
  // resolves as a value and never reaches this table.
  ["Date", "Use velar/time instead of the Date global"],
  ["Boolean", "Use an explicit boolean comparison; VelarScript does not expose JavaScript truthiness conversion"],
  ["Number", "Use number(text), typed forms, or validated data instead of JavaScript Number coercion"],
  ["String", "Use str(value) instead of the JavaScript String global"],
  // COL-U8 / CO-I2: the four collection names in a value position, one
  // sentence each, in `coreCollectionConstructorGuidance` below.
  ...coreCollectionConstructorGuidance,
  // A primitive spelling in a value position is almost always an API asking
  // for a runtime type; the alias is the step that turns the type into a value.
  // `number` is absent because `number(text)` is a real prelude conversion, so
  // the name resolves and never reaches guidance; the runtime-type position
  // says the same thing there.
  ...["string", "bool"].map((name) => [
    name,
    `'${name}' names a type, not a value; declare an alias — 'type Saved = ${name}' — when an API asks for a runtime type to validate against`,
  ] as const),
  // TXT-I1: the Python spellings.
  ["len", "Use 'value.size'; strings and collections measure with the size member"],
  ["parseInt", "Use 'number(text)', then '.floor()' or '.round()' for an integer; VelarScript has one text-to-number conversion"],
  ["parseFloat", "Use 'number(text)'; VelarScript has one text-to-number conversion"],
  // D89 (message correction): `enumerate` and `zip` are the two Python loop
  // reflexes that reached an unadorned "Unknown name" with no successor at all
  // — `zip` even earned a "did you mean 'Map'?". D114 S3 then made both
  // spellings language-owned: the two-slot loop replaces one, and the other is
  // a List member, so neither names a module any more.
  ["enumerate", "Use the two-slot loop — 'for value, index in values:' — which binds the value first; VelarScript has no enumerate function"],
  ["zip", "Use 'left.zip(right)'; pairing two Lists as '{first, second}' up to the shorter length is a List member"],
  ["stringify", "Use Json.stringify(value) directly; VelarScript's pure namespaces need no import"],
  ["parse", "Use Json.parse(text) directly; VelarScript's pure namespaces need no import"],
  // D90 (coherence): the rest of the Python builtin surface a model reaches
  // for. Every one of these had an answer sitting in a roster the compiler
  // already owns, and reached the author either as a bare "Unknown name" or —
  // worse — as a confident edit-distance guess at an unrelated name (`sum` ->
  // `str`, `max` -> `Map`, `map` -> `Map`). Naming the successor also
  // suppresses the guess, because guidance is consulted first.
  ["sum", "Use 'values.sum()'; totalling is a List member"],
  ["min", "Use 'Math.min(a, b)' for two numbers, or 'values.min()' for a List"],
  ["max", "Use 'Math.max(a, b)' for two numbers, or 'values.max()' for a List"],
  ["sorted", "Use 'values.sorted()'; it returns a new List and never mutates the receiver"],
  ["reversed", "Use 'values.reversed()'; it returns a new List and never mutates the receiver"],
  ["any", "Use 'values.some(test)'; the collection members carry the quantifiers"],
  ["all", "Use 'values.every(test)'; the collection members carry the quantifiers"],
  ["filter", "Use 'values.filter(test)'; the collection members carry the transforms"],
  ["map", "Use 'values.map(transform)'; 'Map' with a capital M is the key-value collection, not the transform"],
  ["isinstance", "Use the 'is' operator — 'value is Type' — which also narrows the binding inside the branch"],
  ["pow", "Use 'Math.pow(base, exponent)'"],
  ["divmod", "Use '(a / b).floor()' for the quotient and 'a % b' for the remainder; VelarScript returns one value per operation"],
  ["repr", "Use 'print(value)' to inspect a value, 'str(value)' for its text form, or 'Json.stringify(value)' for data text"],
  ["format", "Use an f-string — 'f\"{value}\"' — and format the value first: 'value.toFixed(2)' for fixed decimals, 'str(value).padStart(size)' for width"],
  ["type", "Use 'value is Type' to test a value's type, and a 'type' declaration to name one; VelarScript has no runtime type-of function"],
  ["iter", "Use a 'for' loop for ordinary traversal; when a Map must be pulled incrementally, call 'map.iterator()'"],
  ["next", "'next()' belongs to a Map cursor — create one with 'const cursor = map.iterator()', then call 'cursor.next()'"],
  ["tuple", "Use a List — '[a, b]' — for a positional sequence, or a record — '{first: a, second: b}' — for named parts; VelarScript has no tuple type"],
  ["bytes", "Import the Bytes type — 'import {Bytes} from \"velar/binary\"' — which is VelarScript's immutable byte snapshot"],
  // The two capability answers. A terminal and a filesystem are target
  // capabilities rather than prelude names, so the message names the module
  // and says which extension carries it instead of implying a bare Core
  // module can import it.
  ["input", "Use velar/terminal — 'terminal.readLine(prompt)' returns the next line — a terminal is a target capability, so it arrives with the @velarscript/node extension rather than the Core prelude"],
  ["open", "Use velar/fs to read or write a file, and 'using name = ...' to own a handle that must be released; a filesystem is a target capability, so it arrives with the @velarscript/node extension rather than the Core prelude"],
  // D90 (coherence): the target-neutral host globals. Each of these is
  // answered by a name a plain Core module can already reach, so the answer
  // belongs here rather than in a target extension. `process`, `Buffer`,
  // `require`, `localStorage` and the rest of the target-specific roster stay
  // with the extension that owns their successor.
  ["setTimeout", "Use 'await Promise.sleep(250ms)' and then run the work; VelarScript waits with a Duration rather than a callback and a millisecond number"],
  ["setInterval", "Use a loop with 'await Promise.sleep(1s)' in it, or velar/task's 'task(work)' when the repetition must be cancellable; VelarScript has no callback scheduler"],
  ...["clearTimeout", "clearInterval"].map((name) => [
    name,
    "There is no callback scheduler to clear; 'await Promise.sleep(250ms)' waits inline, and velar/task's 'task(work)' is the schedule a Cancellation can stop",
  ] as const),
  ["structuredClone", "Use 'Json.clone(value, Target)'; it validates against the runtime type as it copies"],
  ["RegExp", "Use the Text pattern members — 'Text.matches', 'Text.findMatch', 'Text.findMatches', 'Text.replaceMatches' — which take the pattern as text"],
  ["TextEncoder", "Use 'Text.utf8Size(value)' for the byte count, and \"velar/binary\" for the byte vocabulary itself; VelarScript does not expose the TextEncoder global"],
  ["TextDecoder", "Use \"velar/binary\" for the byte vocabulary; VelarScript does not expose the TextDecoder global"],
  ["URL", "Import from \"velar/url\" — 'parse', 'join', 'query', 'withQuery', 'encode' — instead of the URL global"],
  ["AbortController", "Use the Cancellation that velar/task's 'task(work)' passes into its work; VelarScript cancels through that value rather than a signal object"],
  ["Symbol", "VelarScript has no symbol type; use an enum for a closed set of names, or a plain string constant for a unique key"],
  // `velar/worker` is a Core module, so the ambient `Worker` a host offers is
  // answered once here rather than twice in the two extensions that also carry
  // a worker surface.
  ["Worker", "Import the builder — 'import {worker} from \"velar/worker\"' — it starts a typed worker from an entry declared in velar.json, and 'workerPool' runs several of them"],
  ...["length", "char", "slice", "trim", "lower", "upper", "startsWith", "endsWith", "includes", "split", "replace", "replaceAll", "repeat", "padStart", "padEnd", "abs", "round", "floor", "ceil", "isFinite", "isInteger"]
    .map((name) => [name, removedGlobalFunctionGuidance(name)!] as const),
]);
