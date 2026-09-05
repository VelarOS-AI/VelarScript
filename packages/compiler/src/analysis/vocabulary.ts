/**
 * The permanent Core vocabulary: the types the language publishes under names
 * no module has to import.
 *
 * D114 R1b: these were module constants in `analyzer.ts`, read from three
 * clusters at once. A constant that names a language-owned type is not
 * inference state, so it lives where its name says it does and every cluster
 * imports the one definition.
 */
import { type CoreVocabularyName, type PermanentNamespaceName } from "../core-vocabulary.ts";
import {
  boolType,
  boundaryUnknownType,
  nullType,
  numberType,
  optionalOf,
  stringType,
  textConvertibleType,
  unknownType,
  type TypeParameterBound,
  type ValueType,
} from "../types.ts";

export const durationType: ValueType = { kind: "named", name: "Duration" };

/**
 * D41 item 61: the one sentence each type-parameter bound is explained with,
 * wherever it is refused — at a call, at a construction, at a generic
 * application in a type position, or against a contract that solves it.
 *
 * D114: it was defined in `./calls/generic-calls.ts` and read from three
 * clusters, which made `declarations` import `calls` to print a sentence. The
 * bound vocabulary is closed and language-owned, so the table belongs with the
 * rest of the vocabulary and every refusal site reads the one definition.
 */
export const boundVocabularyGuidance: Readonly<Record<TypeParameterBound, string>> = {
  Text: "a Text parameter accepts the types with a hook-free text form — strings, numbers, bools, enums, and null",
  Comparable: "a Comparable parameter accepts the types with a runtime order — numbers and strings",
  Data: "a Data parameter accepts JSON-shaped data — strings, numbers, bools, null, enums, and the Lists, records, and Records built from them",
};

const namespaceFunction = (
  name: string,
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType => ({ kind: "intrinsic", name, parameterNames, parameters, requiredParameters, result });
const promiseOf = (value: ValueType): ValueType => ({ kind: "promise", value });
/**
 * D114 0.28.0 G-I1: a Core parameter that accepts *any* value is spelled with
 * the same `unknown` a program writes in an annotation. `def take(value:
 * unknown)` resolves to `boundaryUnknownType`, and Core's own signatures used
 * the inference seed instead — one concept with two definitions, and A17 read
 * the difference: `print(["a", 1])` was advised to write a record while the
 * author's own `take(["a", 1])` was silent. Handing data to something that
 * takes anything is not the tuple reflex, so both are silent now.
 */
const anyValueParameter: ValueType = boundaryUnknownType;
const jsonNamespaceType: ValueType = {
  kind: "object",
  fields: new Map([
    ["parse", namespaceFunction("json.parse", ["text", "target"], [stringType, unknownType], unknownType, 1)],
    ["tryParse", namespaceFunction("json.tryParse", ["text", "target", "fallback"], [stringType, unknownType, unknownType], unknownType, 1)],
    ["stringify", namespaceFunction("json.stringify", ["value", "pretty"], [anyValueParameter, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["stableStringify", namespaceFunction("json.stableStringify", ["value", "pretty"], [anyValueParameter, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["clone", namespaceFunction("json.clone", ["value", "target"], [anyValueParameter, unknownType], unknownType, 1)],
    ["isSerializable", { kind: "function", parameterNames: ["value"], parameters: [anyValueParameter], requiredParameters: 1, result: boolType }],
  ]),
  readonlyFields: new Set(["parse", "tryParse", "stringify", "stableStringify", "clone", "isSerializable"]),
};
// D50 rule 90: every pure computation lives in a permanent namespace. `Text.`
// is the extension toolbox beside the core string methods — the method table
// stays exactly as it is, and these are the operations most programs never
// touch but must still be able to find without an import.
const textFunction = (
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType => ({ kind: "function", parameterNames, parameters, requiredParameters, result });
const listOfString: ValueType = { kind: "list", element: stringType };
const listOfNumber: ValueType = { kind: "list", element: numberType };
const textPatternOptionsType: ValueType = {
  kind: "object",
  fields: new Map([
    ["ignoreCase", optionalOf(boolType)],
    ["multiline", optionalOf(boolType)],
    ["dotAll", optionalOf(boolType)],
  ]),
};
const textMatchType: ValueType = {
  kind: "object",
  fields: new Map([
    ["value", stringType],
    ["index", numberType],
    ["groups", { kind: "list", element: optionalOf(stringType) }],
  ]),
};
const textNamespaceMembers: ReadonlyMap<string, ValueType> = new Map([
  ["trimStart", textFunction(["value"], [stringType], stringType)],
  ["trimEnd", textFunction(["value"], [stringType], stringType)],
  ["capitalize", textFunction(["value"], [stringType], stringType)],
  ["title", textFunction(["value"], [stringType], stringType)],
  ["lines", textFunction(["value"], [stringType], listOfString)],
  ["lineStarts", textFunction(["value"], [stringType], listOfNumber)],
  ["chunks", textFunction(["value", "size"], [stringType, numberType], listOfString)],
  ["words", textFunction(["value"], [stringType], listOfString)],
  ["slug", textFunction(["value"], [stringType], stringType)],
  // TXT-U3: equality is code-point-sequence identity, so canonically
  // equivalent text is not equal. `normalize` is the boundary tool that makes
  // it equal — macOS filenames arrive NFD while typed text is usually NFC.
  ["normalize", textFunction(["value", "form"], [stringType, stringType], stringType, 1)],
  ["truncate", textFunction(["value", "length", "suffix"], [stringType, numberType, stringType], stringType, 2)],
  ["indent", textFunction(["value", "prefix"], [stringType, stringType], stringType, 1)],
  ["dedent", textFunction(["value"], [stringType], stringType)],
  ["normalizeWhitespace", textFunction(["value"], [stringType], stringType)],
  ["utf8Size", textFunction(["value"], [stringType], numberType)],
  ["escapeHtml", textFunction(["value"], [stringType], stringType)],
  // TXT-U4: one code point in, one code point out. `codePoint` answers null
  // when the argument is not exactly one character, and `fromCodePoint`
  // rejects surrogate halves so no call can build unpaired text.
  ["codePoint", textFunction(["value"], [stringType], optionalOf(numberType))],
  ["fromCodePoint", textFunction(["value"], [numberType], stringType)],
  ["matches", textFunction(["value", "expression", "options"], [stringType, stringType, textPatternOptionsType], boolType, 2)],
  ["findMatch", textFunction(["value", "expression", "options"], [stringType, stringType, textPatternOptionsType], optionalOf(textMatchType), 2)],
  ["findMatches", textFunction(["value", "expression", "options"], [stringType, stringType, textPatternOptionsType], { kind: "list", element: textMatchType }, 2)],
  ["replaceMatches", textFunction(["value", "expression", "replacement", "options"], [stringType, stringType, stringType, textPatternOptionsType], stringType, 3)],
  ["splitPattern", textFunction(["value", "expression", "options"], [stringType, stringType, textPatternOptionsType], listOfString, 2)],
]);
export const TEXT_NAMESPACE_MEMBERS: readonly string[] = [...textNamespaceMembers.keys()];
const textNamespaceType: ValueType = {
  kind: "object",
  fields: new Map(textNamespaceMembers),
  readonlyFields: new Set(textNamespaceMembers.keys()),
};
const promiseNamespaceType: ValueType = {
  kind: "object",
  fields: new Map([
    ["all", namespaceFunction("async.all", ["values"], [unknownType], promiseOf(unknownType))],
    ["race", namespaceFunction("async.race", ["values"], [{ kind: "list", element: unknownType }], promiseOf(unknownType))],
    ["sleep", { kind: "function", parameterNames: ["duration"], parameters: [durationType], requiredParameters: 1, result: promiseOf(nullType) }],
    ["timeout", namespaceFunction("async.timeout", ["value", "duration", "message"], [promiseOf(unknownType), durationType, stringType], promiseOf(unknownType), 2)],
    ["retry", namespaceFunction("async.retry", ["task", "attempts", "delay"], [unknownType, numberType, durationType], promiseOf(unknownType), 1)],
    ["map", namespaceFunction("async.map", ["values", "worker", "concurrency"], [{ kind: "list", element: unknownType }, unknownType, numberType], promiseOf({ kind: "list", element: unknownType }), 2)],
    ["series", namespaceFunction("async.series", ["tasks"], [{ kind: "list", element: unknownType }], promiseOf({ kind: "list", element: unknownType }))],
  ]),
  readonlyFields: new Set(["all", "race", "sleep", "timeout", "retry", "map", "series"]),
};
// D52 rule 116: `JSON`, `Promise`, and `Math` are the three namespace-shaped
// globals every JavaScript author already has in muscle memory. We carried the
// first two and made the third an import, which was an oversight rather than a
// decision. What belongs on a number is already a number method (`abs`,
// `round`, `floor`, `ceil`, `isFinite`, `isInteger`), so what remains here is
// exactly what cannot be one: the constants, the multi-argument functions, and
// the transcendentals.
const numberFunction = (
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  requiredParameters = parameters.length,
): ValueType => ({ kind: "function", parameterNames, parameters, requiredParameters, result: numberType });
const mathNamespaceMembers: ReadonlyMap<string, ValueType> = new Map<string, ValueType>([
  ["pi", numberType], ["e", numberType], ["tau", numberType], ["infinity", numberType],
  // min and max are pure rest calls and therefore have no named rest value.
  ["min", { kind: "intrinsic", name: "math.min", parameters: [numberType], requiredParameters: 1, result: numberType }],
  ["max", { kind: "intrinsic", name: "math.max", parameters: [numberType], requiredParameters: 1, result: numberType }],
  ["clamp", numberFunction(["value", "minimum", "maximum"], [numberType, numberType, numberType])],
  ["sqrt", numberFunction(["value"], [numberType])],
  ["cbrt", numberFunction(["value"], [numberType])],
  ["pow", numberFunction(["base", "exponent"], [numberType, numberType])],
  ["exp", numberFunction(["value"], [numberType])],
  ["log", numberFunction(["value", "base"], [numberType, numberType], 1)],
  ["log2", numberFunction(["value"], [numberType])],
  ["log10", numberFunction(["value"], [numberType])],
  ["sin", numberFunction(["value"], [numberType])],
  ["cos", numberFunction(["value"], [numberType])],
  ["tan", numberFunction(["value"], [numberType])],
  ["asin", numberFunction(["value"], [numberType])],
  ["acos", numberFunction(["value"], [numberType])],
  ["atan", numberFunction(["value"], [numberType])],
  ["atan2", numberFunction(["y", "x"], [numberType, numberType])],
  ["degrees", numberFunction(["radians"], [numberType])],
  ["radians", numberFunction(["degrees"], [numberType])],
  ["hypot", numberFunction(["x", "y"], [numberType, numberType])],
  ["random", numberFunction([], [])],
  // randomInt has one-bound and minimum/maximum positional forms.
  ["randomInt", { kind: "function", parameters: [numberType, numberType], requiredParameters: 1, result: numberType }],
  ["gcd", numberFunction(["left", "right"], [numberType, numberType])],
  ["lcm", numberFunction(["left", "right"], [numberType, numberType])],
]);
export const MATH_NAMESPACE_MEMBERS: readonly string[] = [...mathNamespaceMembers.keys()];
const mathNamespaceType: ValueType = {
  kind: "object",
  fields: new Map(mathNamespaceMembers),
  readonlyFields: new Set(mathNamespaceMembers.keys()),
};

/**
 * D57 rule 135: the Core vocabulary's types, keyed by the roster itself. The
 * `Record<CoreVocabularyName, ValueType>` annotation is the pin — a namespace
 * or prelude name added to `core-vocabulary.ts` and not given a type here (or
 * given one here and left off the roster) is a compile error, and the binding
 * refusal in `source-names.ts` reads the same roster, so the protection can
 * never lag the vocabulary again.
 */
export const coreVocabularyTypes: Record<CoreVocabularyName, ValueType> = {
  number: { kind: "function", parameterNames: ["text"], parameters: [stringType], requiredParameters: 1, result: optionalOf(numberType) },
  // D32 item 29: `str` is compiler-owned text conversion, so its parameter
  // carries the conversion domain rather than `any`. A bare `str` stays a
  // legal first-class value, and every indirect call site — `const c = str`,
  // `values.map(str)` — is checked against the same whitelist the direct
  // call form uses instead of executing a 'toString' hook.
  str: { kind: "function", parameterNames: ["value"], parameters: [textConvertibleType], requiredParameters: 1, result: stringType },
  // `print` inspects any value by contract; its domain is the top type for
  // assignment targets (D90 R17 keeps `any` for boundary declarations only).
  print: { kind: "function", parameterNames: ["value"], parameters: [anyValueParameter], requiredParameters: 1, result: nullType },
  // D47 rule 81: equals(a, b) — deep structural comparison over data.
  // Pure computation, so it lives in the prelude beside str/print; the
  // call site owns the domain checks (inferEqualsCall).
  equals: { kind: "intrinsic", name: "core.equals", parameterNames: ["a", "b"], parameters: [anyValueParameter, anyValueParameter], requiredParameters: 2, result: boolType },
  range: { kind: "intrinsic", name: "collections.range", parameterNames: ["start", "end", "step"], parameters: [numberType, numberType, numberType], requiredParameters: 1, result: { kind: "list", element: numberType } },
  Json: jsonNamespaceType,
  Promise: promiseNamespaceType,
  Text: textNamespaceType,
  Math: mathNamespaceType,
};

export function coreVocabularyType(name: string): ValueType | null {
  return Object.hasOwn(coreVocabularyTypes, name) ? coreVocabularyTypes[name as CoreVocabularyName] : null;
}

/**
 * D50 rule 90 / D52 rule 116: the modules whose named imports retired, and the
 * prefix that replaced them. `velar/collections` is the odd one — `range` went
 * to the Core prelude rather than to a namespace, so its migration drops the
 * import and adds no prefix at all.
 *
 * D57 rule 136: the member sets are read off the namespace types rather than
 * restated, so this table cannot claim a member the namespace does not carry.
 */
export const permanentNamespaceImportRosters: ReadonlyMap<string, { readonly namespace: PermanentNamespaceName | null; readonly members: ReadonlySet<string> }> = new Map([
  ["velar/json", { namespace: "Json", members: namespaceMemberNames(jsonNamespaceType) }],
  ["velar/async", { namespace: "Promise", members: namespaceMemberNames(promiseNamespaceType) }],
  ["velar/text", { namespace: "Text", members: namespaceMemberNames(textNamespaceType) }],
  ["velar/math", { namespace: "Math", members: namespaceMemberNames(mathNamespaceType) }],
  ["velar/collections", { namespace: null, members: new Set(["range"]) }],
]);

function namespaceMemberNames(namespace: ValueType): ReadonlySet<string> {
  return new Set(namespace.kind === "object" ? namespace.fields.keys() : []);
}

export function permanentNamespaceImportRoster(source: string): { readonly namespace: PermanentNamespaceName | null; readonly members: ReadonlySet<string> } | null {
  return permanentNamespaceImportRosters.get(source) ?? null;
}

/**
 * D57 rule 136: the permanent namespace that reaches every export of a retired
 * standard module, or null while the module still publishes something of its
 * own. Derived from the roster VEL3008 rejects imports with, so a diagnostic
 * cannot list a module as importable after its members moved behind a prefix.
 */
export function permanentNamespaceCoveringModule(source: string, exports: Iterable<string>): PermanentNamespaceName | null {
  const roster = permanentNamespaceImportRosters.get(source);
  if (!roster?.namespace) return null;
  for (const name of exports) if (!roster.members.has(name)) return null;
  return roster.namespace;
}
