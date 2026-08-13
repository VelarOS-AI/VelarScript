import { blockContainsDirectAwait } from "./ast.ts";
import type {
  ArrowFunctionExpression,
  AssignmentStatement,
  AsyncStatement,
  BindingPattern,
  ClassDeclaration,
  ClassDisposeBlock,
  Expression,
  ExternClassDeclaration,
  ExternFunctionDeclaration,
  ExternConstantDeclaration,
  FunctionDeclaration,
  MatchPattern,
  MatchValue,
  Program,
  Statement,
  TypeDeclaration,
  TypeAliasDeclaration,
  TypeParameterDeclaration,
  TestDeclaration,
  TypeReference,
  TypeSyntax,
  UsingDeclaration,
} from "./ast.ts";
import { diagnostic, type Diagnostic } from "./diagnostic.ts";
import type { CompilerAnalysisExtension } from "./extension.ts";
import { collectionMemberGuidance, removedGlobalFunctionGuidance, stringMemberGuidance, type CollectionKind } from "./language-guidance.ts";
import { bindingNameRestriction } from "./source-names.ts";
import { spanIdentity, type Span } from "./source.ts";
import {
  analysisTypeIdentity,
  anyType,
  boolType,
  boundGrants,
  collectGenericBoundViolations,
  describeType,
  instantiateGenericCallable,
  invalidType,
  isInvalidType,
  isAssignable,
  isReadonlyView,
  isTextConvertibleType,
  isTypeParameterBound,
  typeParameterBoundNames,
  mergeTypes,
  mutableViewOf,
  nullType,
  nonOptional,
  numberType,
  optionalOf,
  resolveTypeReference,
  readonlyViewOf,
  resolvedAsyncType,
  semanticTypeIdentity,
  sameType,
  sameTypeIgnoringCallableParameterNames,
  stringType,
  substituteTypeParameters,
  textConvertibleType,
  typeContainsParameter,
  typeContainsRuntimeTypeCheck,
  unifyTypeParameters,
  unionOf,
  unknownType,
  type EnumInfo,
  type ExtensionValueType,
  type GenericBoundViolation,
  type TypeEnvironment,
  type TypeParameterBound,
  type ValueType,
} from "./types.ts";

interface Binding {
  readonly mutable: boolean;
  type: ValueType;
  declaredType: ValueType;
  storageType: ValueType;
  readonly storageBinding?: Binding;
  readonly span: Span;
  narrowingFrame: number | null;
  /**
   * D44 rule 71: true while the active narrowing was established by an
   * assignment (or a declaration initializer) rather than a check. Only
   * meaningful when narrowingFrame is not null. Assigned facts refine reads;
   * equality tests still judge the declared domain (storageType).
   */
  assignedFact?: boolean;
  // Exact reactive identity belongs to the resolved lexical binding, not to
  // its spelling. Lowering records each resolved read/write span so local
  // state can shadow (and be shadowed by) ordinary bindings safely.
  reactiveKind?: "state" | "prop";
}

interface CollectionInferenceGroup {
  readonly type: ValueType;
  readonly bindings: Map<Binding, string>;
  open: boolean;
}

interface MemberNarrowing {
  readonly type: ValueType;
  readonly frame: number;
  /**
   * D44 rule 71: true when the fact was established by an assignment rather
   * than a check. Assigned facts refine reads, but an equality test still
   * asks about the declared domain, so `x == null` after `x = "a"` stays a
   * real question instead of a rejected constant.
   */
  readonly assigned?: boolean;
  /** The declared type of the location an assigned fact refines (its test-domain). */
  readonly domain?: ValueType;
}

interface PendingScopeDeclaration {
  readonly span: Span;
  readonly loopHead: boolean;
}

interface FlowFactsSnapshot {
  readonly bindings: ReadonlyMap<Binding, {
    readonly type: ValueType;
    readonly storageType: ValueType;
    readonly frame: number | null;
    readonly assigned: boolean;
  }>;
  readonly members: readonly ReadonlyMap<string, MemberNarrowing>[];
}

interface FlowFactInvalidations {
  readonly bindings: ReadonlySet<Binding>;
  readonly members: ReadonlyMap<number, ReadonlySet<string>>;
  readonly storageTypes: ReadonlyMap<Binding, ValueType>;
}

interface ReturnContext {
  readonly expected: ValueType;
  readonly inferredReturns: ValueType[] | null;
  readonly declarationKind: string;
}

type CallableValueType = Extract<ValueType, { readonly kind: "function" | "action" | "intrinsic" }>;

interface NamedArgumentPlan {
  readonly ordered: readonly Expression[];
  readonly targets: readonly (number | null)[];
  readonly valid: boolean;
}

interface AnalyzableFunctionDeclaration {
  readonly kind: string;
  readonly name: string;
  readonly typeParameters?: readonly TypeParameterDeclaration[];
  readonly parameters: FunctionDeclaration["parameters"];
  readonly returnType: FunctionDeclaration["returnType"];
  readonly signatureSpan: FunctionDeclaration["signatureSpan"];
  readonly body: FunctionDeclaration["body"];
  readonly span: Span;
  readonly asynchronous?: boolean;
}

function continuesOptionalChain(expression: Expression): boolean {
  if (expression.kind === "MemberExpression") {
    return expression.optional || continuesOptionalChain(expression.object);
  }
  if (expression.kind === "IndexExpression") {
    return expression.optional || continuesOptionalChain(expression.object);
  }
  if (expression.kind === "CallExpression") {
    return continuesOptionalChain(expression.callee);
  }
  return false;
}

export interface ClassField {
  readonly mutable: boolean;
  readonly type: ValueType;
}

export interface ClassInfo {
  readonly identity?: string;
  /** D43 item 69: the class declares `@dispose:`, and whether releasing awaits. */
  readonly dispose?: "sync" | "async";
  readonly parameters: readonly ValueType[];
  readonly parameterNames?: readonly string[];
  readonly requiredParameters: number;
  readonly constructorRest?: ValueType;
  readonly base: string | null;
  readonly abstract: boolean;
  readonly fields: ReadonlyMap<string, ClassField>;
  readonly getters: ReadonlySet<string>;
  readonly abstractGetters: ReadonlySet<string>;
  readonly methods: ReadonlyMap<string, ValueType>;
  readonly abstractMethods: ReadonlySet<string>;
  readonly staticFields: ReadonlyMap<string, ClassField>;
  readonly staticGetters: ReadonlySet<string>;
  readonly staticMethods: ReadonlyMap<string, ValueType>;
}

export type CollectionOperation = "get" | "slice" | "listAppend" | "listExtend" | "listInsert" | "listRemove" | "listPop" | "listCopy" | "listCount" | "listIndex" | "listFind" | "listSome" | "listEvery" | "listMap" | "listFilter" | "listFlatMap" | "listReduce" | "listJoin" | "listSorted" | "listReversed" | "listSum" | "listMin" | "listMax" | "setAdd" | "setUpdate" | "setCopy" | "setUnion" | "setIntersection" | "setDifference" | "mapSet" | "mapUpdate" | "mapCopy" | "recordSet" | "recordCopy" | "has" | "remove" | "clear" | "keys" | "values" | "entries";

export type PrimitiveOperation = "stringTrim" | "stringUpper" | "stringLower" | "stringSlice" | "stringChar" | "stringHas" | "stringIndex" | "stringCount" | "stringStartsWith" | "stringEndsWith" | "stringSplit" | "stringReplace" | "stringReplaceAll" | "stringPadStart" | "stringPadEnd" | "stringRepeat" | "stringIsBlank" | "numberAbs" | "numberRound" | "numberFloor" | "numberCeil" | "numberToFixed" | "numberIsInteger" | "numberIsNaN" | "numberIsFinite";

const listCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "get"], ["slice", "slice"], ["append", "listAppend"], ["extend", "listExtend"],
  ["insert", "listInsert"], ["remove", "listRemove"], ["pop", "listPop"],
  ["clear", "clear"], ["copy", "listCopy"], ["has", "has"], ["count", "listCount"],
  ["index", "listIndex"], ["find", "listFind"], ["some", "listSome"], ["every", "listEvery"],
  ["map", "listMap"], ["filter", "listFilter"], ["flatMap", "listFlatMap"], ["reduce", "listReduce"], ["join", "listJoin"],
  ["sorted", "listSorted"], ["reversed", "listReversed"], ["sum", "listSum"], ["min", "listMin"], ["max", "listMax"],
]);
const mapCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "get"], ["set", "mapSet"], ["update", "mapUpdate"], ["has", "has"],
  ["remove", "remove"], ["clear", "clear"], ["copy", "mapCopy"],
  ["keys", "keys"], ["values", "values"], ["entries", "entries"],
]);
const setCollectionOperations = new Map<string, CollectionOperation>([
  ["add", "setAdd"], ["update", "setUpdate"], ["has", "has"], ["remove", "remove"],
  ["clear", "clear"], ["copy", "setCopy"], ["values", "values"],
  ["union", "setUnion"], ["intersection", "setIntersection"], ["difference", "setDifference"],
]);
const recordCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "get"], ["set", "recordSet"], ["has", "has"], ["remove", "remove"],
  ["clear", "clear"], ["copy", "recordCopy"], ["keys", "keys"], ["values", "values"], ["entries", "entries"],
]);
const stringPrimitiveOperations = new Map<string, PrimitiveOperation>([
  ["trim", "stringTrim"], ["upper", "stringUpper"], ["lower", "stringLower"], ["slice", "stringSlice"],
  ["char", "stringChar"], ["has", "stringHas"], ["index", "stringIndex"], ["count", "stringCount"], ["startsWith", "stringStartsWith"], ["endsWith", "stringEndsWith"],
  ["split", "stringSplit"], ["replace", "stringReplace"], ["replaceAll", "stringReplaceAll"],
  ["padStart", "stringPadStart"], ["padEnd", "stringPadEnd"], ["repeat", "stringRepeat"], ["isBlank", "stringIsBlank"],
]);
const numberPrimitiveOperations = new Map<string, PrimitiveOperation>([
  ["abs", "numberAbs"], ["round", "numberRound"], ["floor", "numberFloor"], ["ceil", "numberCeil"], ["toFixed", "numberToFixed"],
  ["isInteger", "numberIsInteger"], ["isNaN", "numberIsNaN"], ["isFinite", "numberIsFinite"],
]);

// D29 item 14: compiler-owned value/collection methods that return a fresh
// value without mutating their receiver. An expression statement that calls
// one of these and drops the result is always a bug. Mutate-and-return
// operations (pop/remove) and null-returning mutators stay legal,
// and user-function purity is deliberately never analyzed (D26 retired that).
const discardedPureCollectionOperations = new Set<CollectionOperation>([
  "get", "slice", "listCopy", "listCount", "listIndex", "listFind", "listSome", "listEvery",
  "listMap", "listFilter", "listFlatMap", "listReduce", "listJoin", "listSorted", "listReversed",
  "listSum", "listMin", "listMax", "setCopy", "setUnion", "setIntersection", "setDifference", "mapCopy", "recordCopy",
  "has", "keys", "values", "entries",
]);
const discardedPurePrimitiveOperations = new Set<PrimitiveOperation>([
  "stringTrim", "stringUpper", "stringLower", "stringSlice", "stringChar",
  "stringStartsWith", "stringEndsWith", "stringReplace", "stringReplaceAll",
  "stringPadStart", "stringPadEnd", "stringRepeat", "stringSplit", "stringIsBlank",
  "numberAbs", "numberRound", "numberFloor", "numberCeil", "numberToFixed",
  "numberIsInteger", "numberIsNaN", "numberIsFinite",
]);
export interface FormReadField {
  readonly name: string;
  readonly kind: "string" | "number" | "bool" | "enum" | "strings";
  readonly optional: boolean;
  readonly enumValues?: readonly string[];
}

export interface LoweringHints {
  readonly collectionCalls: ReadonlyMap<number, CollectionOperation>;
  readonly collectionSizes: ReadonlySet<number>;
  readonly primitiveCalls: ReadonlyMap<number, PrimitiveOperation>;
  readonly stringSizes: ReadonlySet<number>;
  readonly constructorCalls: ReadonlySet<string>;
  readonly javaScriptCallBoundaries: ReadonlySet<string>;
  readonly classChecks: ReadonlySet<string>;
  readonly privateMembers: ReadonlySet<string>;
  readonly classNames: ReadonlySet<string>;
  /** Class names whose chain reaches the builtin Error — their lowering stamps `.name` (audit 4 micro-ruling). */
  readonly errorSubclassNames: ReadonlySet<string>;
  readonly enumNames: ReadonlySet<string>;
  /**
   * Module-scope bindings that hold runtime Type objects: local `type`
   * declarations and aliases, plus imported ones. A narrowing recheck for any
   * of these names may call `Name.is(value)` — the exporting module always
   * emits the validator object for an exported type. Names outside this set
   * (erased generics, extension host types such as DOM interfaces) have no
   * such binding and keep the presence-only recheck.
   */
  readonly runtimeTypeObjectNames: ReadonlySet<string>;
  readonly optionalMembers: ReadonlySet<string>;
  readonly optionalCalls: ReadonlySet<string>;
  readonly optionalIndexes: ReadonlySet<string>;
  readonly optionalCallees: ReadonlySet<string>;
  readonly truthConditions: ReadonlySet<string>;
  readonly normalizedNullResults: ReadonlySet<string>;
  readonly normalizedPromiseValues: ReadonlySet<string>;
  readonly asyncResolvedValues: ReadonlySet<string>;
  readonly asyncForStatements: ReadonlySet<number>;
  readonly normalizedUndefinedExpressions: ReadonlySet<string>;
  readonly instanceFieldReads: ReadonlySet<string>;
  readonly privateInstanceFieldReads: ReadonlySet<string>;
  readonly staticFieldReads: ReadonlyMap<string, number>;
  /**
   * Member spans that read a class method as a value rather than calling it.
   * Methods live on the prototype, so these emit as receiver-evaluated-once
   * plus a bind at the reference site (charter sections 8 and 18).
   */
  readonly classMethodReferences: ReadonlySet<string>;
  readonly optionalBindingEntries: ReadonlySet<number>;
  readonly reactiveReferences: ReadonlyMap<string, "state" | "prop">;
  readonly enumValueBindings: ReadonlyMap<number, string>;
  readonly exhaustiveMatches: ReadonlySet<number>;
  readonly formReads: ReadonlyMap<string, readonly FormReadField[]>;
  readonly namedArgumentOrders: ReadonlyMap<string, readonly number[]>;
  readonly extensionLiterals: ReadonlyMap<string, string>;
  readonly extensionCalls: ReadonlyMap<string, string>;
  /** Prelude and permanent-namespace reads, keyed by span so lexical shadows win. */
  readonly builtinValueReferences: ReadonlyMap<string, "Json" | "Promise" | "Look" | "range">;
  readonly runtimeNarrowings: ReadonlyMap<string, RuntimeNarrowingGuard>;
  /**
   * Span identities of `==`/`!=` operations (and comparison-chain links)
   * whose operands may both be NaN at runtime. These lower to SameValueZero;
   * every other equality elides the repair and emits plain `===` (D36 item 41).
   */
  readonly sameValueZeroEqualities: ReadonlySet<string>;
  /**
   * Span identities of match value candidates that must compare by
   * SameValueZero — the subject and the candidate can both be NaN — so
   * `case box.nan:` agrees with `==` (ENM-D2, charter section 8). Everything
   * else keeps plain `===`.
   */
  readonly sameValueZeroMatchValues: ReadonlySet<string>;
  /** Span identities of calls to the prelude's equals(a, b) (D47 rule 81). */
  readonly equalsCalls: ReadonlySet<string>;
  /**
   * Span identities of ordered comparisons (`< <= > >=`, including
   * comparison-chain links) whose operands are strings. These lower through
   * the code-point comparator so string order is code-point order everywhere
   * (TXT-D1); number comparisons keep the plain operator.
   */
  readonly stringOrderings: ReadonlySet<string>;
  /**
   * Span identities of ordered comparisons between `Comparable`-bounded type
   * parameters (D41 item 61). The runtime category is not known statically,
   * so these lower through the dispatching comparator, which keeps a string
   * pair in code-point order exactly as a monomorphic string comparison is.
   */
  readonly dynamicOrderings: ReadonlySet<string>;
  /**
   * How each `using` statement releases its value, keyed by the statement's
   * span identity (D43 item 69). The analyzer resolves the contract because it
   * is the only stage that knows the value's type.
   */
  readonly usingDisposals: ReadonlyMap<string, DisposalContract>;
  /**
   * Span identities of JavaScript-boundary calls in synchronous
   * module-initialization position. A non-Error value thrown there would
   * reach the host uncaught and unnormalized — the last unowned failure
   * shape at the bridge — so these sites rethrow through the owned Error
   * normalization channel (BRG-U10).
   */
  readonly moduleTopLevelHostCalls: ReadonlySet<string>;
}

export interface RuntimeNarrowingGuard {
  readonly expected: ValueType;
  readonly description: string;
}

export interface AnalysisContext {
  readonly imports?: ReadonlyMap<string, ValueType>;
  readonly dynamicImports?: ReadonlyMap<string, ValueType>;
  readonly reactiveImports?: ReadonlyMap<string, "state">;
  readonly namedTypes?: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  readonly namedTypeReadonlyFields?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly namedTypeIdentities?: ReadonlyMap<string, string>;
  readonly typeAliases?: ReadonlyMap<string, ValueType>;
  readonly enums?: ReadonlyMap<string, EnumInfo>;
  readonly classes?: ReadonlyMap<string, ClassInfo>;
  readonly extensionImports?: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  readonly extensionModules?: ReadonlyMap<string, readonly unknown[]>;
  readonly resources?: ReadonlyMap<string, string>;
  /** Compiler-owned seeds used while omitted function results converge. */
  readonly inferredFunctionResults?: ReadonlyMap<string, ValueType>;
  /** True only for the final semantic pass after result inference converges. */
  readonly finalizeFunctionResultInference?: boolean;
  /** The module's own path; `test "name":` is only declared in a `*.test.vel` module. */
  readonly path?: string;
}

/**
 * A direct read of an imported binding from a module-initialization position
 * (top-level initializers and expression statements, static class fields,
 * extension top-level initializers). The project driver combines these with
 * the module graph to reject import cycles whose source module has not
 * evaluated when the read runs (D31 item 23).
 */
export interface InitializationImportRead {
  readonly local: string;
  readonly source: string;
  /**
   * The name the source module exports, which may differ from `local`. The
   * project driver follows it through re-export barrels to the module that
   * actually declares the binding; a namespace import has no single name and
   * records null.
   */
  readonly imported: string | null;
  readonly span: Span;
}

// A distinct unknown-like value lets recursive result inference remain
// fail-closed without confusing an unresolved call with an explicitly unknown
// result. It may cross an in-memory module interface during project SCC passes.
export const inferredResultPlaceholderType: ValueType = Object.freeze({ kind: "unknown", restricted: true });


function containsInferredResultPlaceholder(type: ValueType): boolean {
  if (type === inferredResultPlaceholderType) return true;
  switch (type.kind) {
    case "optional": return containsInferredResultPlaceholder(type.inner);
    case "list":
    case "set": return containsInferredResultPlaceholder(type.element);
    case "map": return containsInferredResultPlaceholder(type.key) || containsInferredResultPlaceholder(type.value);
    case "record":
    case "promise":
    case "runtimeType": return containsInferredResultPlaceholder(type.value);
    case "object": return [...type.fields.values()].some(containsInferredResultPlaceholder);
    case "function":
    case "action":
    case "intrinsic":
      return type.parameters.some(containsInferredResultPlaceholder)
        || Boolean(type.rest && containsInferredResultPlaceholder(type.rest))
        || containsInferredResultPlaceholder(type.result);
    case "union": return type.members.some(containsInferredResultPlaceholder);
    default: return false;
  }
}

function sameInferredResult(left: ValueType, right: ValueType): boolean {
  if (containsInferredResultPlaceholder(left) !== containsInferredResultPlaceholder(right)) return false;
  return sameType(left, right);
}

const corePrimitiveNames = new Set(["string", "number", "bool", "null", "unknown", "Duration"]);
const builtinTypeNames = new Set(["string", "number", "bool", "null", "unknown", "any", "List", "Set", "Map", "Record", "Promise", "Function", "Type", "Duration"]);
const memberNarrowingPrefix = "\u0000member:";
/**
 * D43 item 69: the emitted member behind a class's `@dispose:` block. The key
 * is not a source-shaped identifier, so no author member can collide with it —
 * `@dispose` is the language's name, not a name in the author's namespace.
 */
export const disposeMemberKey = "__velar:dispose";

/** How a `using` binding releases its value at scope exit. */
export interface DisposalContract {
  readonly member: string;
  readonly asynchronous: boolean;
  readonly owner: "class" | "capability";
}

/** What each bound admits, written the way a rejected call needs to hear it. */
const boundVocabularyGuidance: Readonly<Record<TypeParameterBound, string>> = {
  Text: "a Text parameter accepts the types with a hook-free text form — strings, numbers, bools, enums, and null",
  Comparable: "a Comparable parameter accepts the types with a runtime order — numbers and strings",
  Data: "a Data parameter accepts JSON-shaped data — strings, numbers, bools, null, enums, and the Lists, records, and Records built from them",
};
const coreGlobalGuidance = new Map([
  ["arguments", "Use named parameters; VelarScript does not expose the JavaScript 'arguments' binding"],
  ["console", "Use print(value) or an explicit JavaScript boundary instead of the console global"],
  ["JSON", "Use 'Json.parse(text)' or 'Json.stringify(value)'; VelarScript namespaces use PascalCase"],
  ["Object", "Use record fields directly or Record<T>.keys(); VelarScript does not expose the JavaScript Object namespace"],
  ["Array", "Use a '[]' List literal and List methods; VelarScript does not expose the JavaScript Array namespace"],
  ["Math", "Use number methods such as value.abs(), value.round(), value.isFinite(), and value.isInteger(); VelarScript does not expose the JavaScript Math namespace"],
  ["Date", "Use velar/time instead of the Date global"],
  ["Boolean", "Use an explicit boolean comparison; VelarScript does not expose JavaScript truthiness conversion"],
  ["Number", "Use number(text), typed forms, or validated data instead of JavaScript Number coercion"],
  ["String", "Use str(value) instead of the JavaScript String global"],
  // COL-U8: Set() and Map() are real constructors, so the List/Array
  // asymmetry is a trap worth naming: a List is built with a literal.
  ["List", "Lists are created with a '[]' literal (or [...values] to copy); 'List<T>' is a type name, not a constructor"],
  // TXT-I1: the Python spellings.
  ["len", "Use 'value.size'; strings and collections measure with the size member"],
  ["parseInt", "Use 'number(text)', then '.floor()' or '.round()' for an integer; VelarScript has one text-to-number conversion"],
  ["parseFloat", "Use 'number(text)'; VelarScript has one text-to-number conversion"],
  ["stringify", "Use Json.stringify(value) directly; VelarScript's pure namespaces need no import"],
  ["parse", "Use Json.parse(text) directly; VelarScript's pure namespaces need no import"],
  ...["length", "char", "slice", "trim", "lower", "upper", "startsWith", "endsWith", "includes", "split", "replace", "replaceAll", "repeat", "padStart", "padEnd", "abs", "round", "floor", "ceil", "isFinite", "isInteger"]
    .map((name) => [name, removedGlobalFunctionGuidance(name)!] as const),
]);

const durationType: ValueType = { kind: "named", name: "Duration" };
const namespaceFunction = (
  name: string,
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType => ({ kind: "intrinsic", name, parameterNames, parameters, requiredParameters, result });
const promiseOf = (value: ValueType): ValueType => ({ kind: "promise", value });
const jsonNamespaceType: ValueType = {
  kind: "object",
  fields: new Map([
    ["parse", namespaceFunction("json.parse", ["text", "target"], [stringType, anyType], unknownType, 1)],
    ["stringify", namespaceFunction("json.stringify", ["value", "pretty"], [anyType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["stableStringify", namespaceFunction("json.stableStringify", ["value", "pretty"], [anyType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["clone", namespaceFunction("json.clone", ["value", "target"], [anyType, anyType], anyType, 1)],
  ]),
  readonlyFields: new Set(["parse", "stringify", "stableStringify", "clone"]),
};
const promiseNamespaceType: ValueType = {
  kind: "object",
  fields: new Map([
    ["all", namespaceFunction("async.all", ["values"], [anyType], promiseOf(anyType))],
    ["race", namespaceFunction("async.race", ["values"], [{ kind: "list", element: anyType }], promiseOf(anyType))],
    ["sleep", { kind: "function", parameterNames: ["duration"], parameters: [durationType], requiredParameters: 1, result: promiseOf(nullType) }],
    ["timeout", namespaceFunction("async.timeout", ["value", "duration", "message"], [promiseOf(anyType), durationType, stringType], promiseOf(anyType), 2)],
    ["retry", namespaceFunction("async.retry", ["task", "attempts", "delay"], [anyType, numberType, durationType], promiseOf(anyType), 1)],
    ["map", namespaceFunction("async.map", ["values", "worker", "concurrency"], [{ kind: "list", element: anyType }, anyType, numberType], promiseOf({ kind: "list", element: anyType }), 2)],
    ["series", namespaceFunction("async.series", ["tasks"], [{ kind: "list", element: anyType }], promiseOf({ kind: "list", element: anyType }))],
  ]),
  readonlyFields: new Set(["all", "race", "sleep", "timeout", "retry", "map", "series"]),
};

function argumentNoun(expected: string): "argument" | "arguments" {
  return expected === "1" || expected === "at least 1" ? "argument" : "arguments";
}

function trimTrailingOmittedArguments(sources: readonly number[]): readonly number[] {
  let length = sources.length;
  while (length > 0 && sources[length - 1] === -1) length -= 1;
  return sources.slice(0, length);
}

export function isCorePrimitiveName(name: string): boolean {
  return corePrimitiveNames.has(name);
}

// The human-readable origin of a nominal contract, recovered from its
// identity: extern classes name their JavaScript source and Velar nominals
// name their declaring module. Structural types have no origin.
function contractOrigin(type: ValueType): string | null {
  const identity = type.kind === "class" || type.kind === "classConstructor" || type.kind === "named" || type.kind === "enum" || type.kind === "enumMember" || type.kind === "enumObject"
    ? type.identity
    : undefined;
  if (!identity) return null;
  const separator = identity.lastIndexOf("#");
  if (separator < 0) return null;
  if (identity.startsWith("js:")) return `the extern class from "${identity.slice(3, separator)}"`;
  if (identity.startsWith("velar:")) return `declared in ${identity.slice(6, separator)}`;
  return null;
}

// The structural contract of an extern class declaration, canonicalized so
// that declarations of the same JavaScript class from different modules can
// be compared for agreement. Parameter names are intentionally excluded:
// extern constructors take positional arguments only.
function externClassContract(info: ClassInfo): string {
  const fieldEntries = (fields: ReadonlyMap<string, ClassField>): readonly string[] =>
    [...fields].map(([name, field]) => `${name}\0${field.mutable ? "let" : "const"}\0${semanticTypeIdentity(field.type)}`).sort();
  const methodEntries = (methods: ReadonlyMap<string, ValueType>): readonly string[] =>
    [...methods].map(([name, type]) => `${name}\0${semanticTypeIdentity(type)}`).sort();
  return JSON.stringify([
    info.parameters.map((parameter) => semanticTypeIdentity(parameter)),
    info.requiredParameters,
    info.constructorRest ? semanticTypeIdentity(info.constructorRest) : null,
    info.base,
    fieldEntries(info.fields),
    [...info.getters].sort(),
    methodEntries(info.methods),
    fieldEntries(info.staticFields),
    [...info.staticGetters].sort(),
    methodEntries(info.staticMethods),
  ]);
}

export class Analyzer implements TypeEnvironment {
  protected readonly diagnostics: Diagnostic[] = [];
  private readonly scopes: Map<string, Binding>[] = [new Map()];
  private readonly memberNarrowings: Map<string, MemberNarrowing>[] = [new Map()];
  private readonly namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly namedTypeReadonlyFields = new Map<string, ReadonlySet<string>>();
  private readonly namedTypeIdentities = new Map<string, string>();
  private readonly typeAliases = new Map<string, ValueType>();
  private readonly invalidDeclaredTypes = new Set<string>();
  private readonly typeReferenceValidity = new WeakMap<TypeReference, boolean>();
  private readonly typeParameterFrames: ReadonlyMap<string, ValueType>[] = [];
  private readonly typeParameterFrameBounds = new WeakMap<ReadonlyMap<string, ValueType>, ReadonlyMap<string, TypeParameterBound>>();
  private readonly invalidExternTypeReferences = new WeakSet<TypeReference>();
  private readonly enums = new Map<string, EnumInfo>();
  private readonly classes = new Map<string, ClassInfo>();
  private readonly classDisplayNames = new Map<string, string>();
  private readonly externModules = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly externTypeImports = new Map<string, ValueType>();
  private readonly externClassDeclarations = new Map<string, ReadonlySet<string>>();
  private readonly returnContexts: ReturnContext[] = [];
  private readonly asynchronousFunctions: boolean[] = [];
  private readonly collectionCalls = new Map<number, CollectionOperation>();
  private readonly collectionSizes = new Set<number>();
  private readonly primitiveCalls = new Map<number, PrimitiveOperation>();
  private readonly sameValueZeroEqualities = new Set<string>();
  private readonly sameValueZeroMatchValues = new Set<string>();
  private readonly equalsCalls = new Set<string>();
  private readonly stringOrderings = new Set<string>();
  private readonly dynamicOrderings = new Set<string>();
  private readonly reportedBoundViolations = new Set<string>();
  private readonly usingDisposals = new Map<string, DisposalContract>();
  private readonly declaredTestTitles = new Set<string>();
  private readonly moduleTopLevelHostCalls = new Set<string>();
  private readonly stringSizes = new Set<number>();
  private readonly constructorCalls = new Set<string>();
  private readonly javaScriptBindings = new Set<string>();
  private readonly javaScriptCallBoundaries = new Set<string>();
  private readonly classChecks = new Set<string>();
  private readonly privateMembers = new Set<string>();
  private readonly optionalMembers = new Set<string>();
  private readonly optionalCalls = new Set<string>();
  private readonly optionalIndexes = new Set<string>();
  private readonly optionalCallees = new Set<string>();
  private readonly constructorFieldInitializations = new Set<number>();
  private readonly truthConditions = new Set<string>();
  private readonly normalizedNullResults = new Set<string>();
  private readonly normalizedPromiseValues = new Set<string>();
  private readonly asyncResolvedValues = new Set<string>();
  private readonly asyncForStatements = new Set<number>();
  // A literal-true loop with no reachable break is a synchronization boundary:
  // control cannot continue after it even when the body itself can iterate.
  private readonly nonFallthroughWhileStatements = new Set<number>();
  private readonly reportedPromiseResolutionHazards = new Set<string>();
  private readonly normalizedUndefinedExpressions = new Set<string>();
  private readonly instanceFieldReads = new Set<string>();
  private readonly privateInstanceFieldReads = new Set<string>();
  private readonly staticFieldReads = new Map<string, number>();
  // D44 rule 74: member spans that read a class method as a value (not as a
  // call's callee). The emitter binds these at the reference site, the same
  // rule collection method values follow (charter section 8).
  private readonly classMethodReferences = new Set<string>();
  // D45 rule 75: the only expression positions where a class name may appear —
  // as the callee of a direct call and as the receiver of a member access.
  // Everything else rejects the class name as a value.
  private readonly callExpressionCallees = new Set<string>();
  private readonly memberAccessReceivers = new Set<string>();
  // D44 rule 72: memoized per-identity verdicts for the deep readonly class
  // scan. Only cycle-free computations are cached; a verdict found through a
  // cycle cut stays local to that traversal.
  private readonly readonlyClassScanVerdicts = new Map<string, { readonly suffix: string; readonly className: string } | null>();
  private readonly optionalBindingEntries = new Set<number>();
  protected readonly reactiveBindings = new Map<string, "state">();
  private readonly reactiveReferences = new Map<string, "state" | "prop">();
  private readonly pendingScopeDeclarations: Map<string, PendingScopeDeclaration>[] = [new Map()];
  private readonly reportedShadowedReads = new Set<string>();
  protected readonly enumValueBindings = new Map<number, string>();
  private readonly exhaustiveMatches = new Set<number>();
  private readonly formReads = new Map<string, readonly FormReadField[]>();
  private readonly namedArgumentOrders = new Map<string, readonly number[]>();
  protected readonly extensionLiterals = new Map<string, string>();
  protected readonly extensionCalls = new Map<string, string>();
  private readonly builtinValueReferences = new Map<string, "Json" | "Promise" | "Look" | "range">();
  private readonly semanticBindingTypes = new Map<string, ValueType>();
  private readonly semanticBindingMembers = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly semanticMemberCache = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly semanticExpressionTypes = new Map<string, ValueType>();
  private readonly semanticExpressionMembers = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly semanticExpressionOwners = new Map<string, ValueType>();
  private readonly semanticObjectPropertyOwners = new Map<string, ValueType>();
  private readonly semanticBindingEntryOwners = new Map<string, ValueType>();
  protected readonly semanticJsxAttributeOwners = new Map<string, ValueType>();
  private readonly semanticExpressionContexts = new Map<string, ValueType>();
  private readonly semanticExpressionContextMembers = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly contextualAssignments = new Map<string, ValueType>();
  private readonly inferredExpressionTypes = new Map<string, ValueType>();
  private readonly runtimeNarrowings = new Map<string, RuntimeNarrowingGuard>();
  private readonly inferredFunctionResultSeeds: ReadonlyMap<string, ValueType>;
  private readonly inferredFunctionResultTypes = new Map<string, ValueType>();
  private readonly finalizeFunctionResultInference: boolean;
  private readonly logicalConditionNarrowings = new Map<string, {
    readonly truthy: ReadonlyMap<string, ValueType>;
    readonly falsy: ReadonlyMap<string, ValueType>;
  }>();
  private readonly collectionInferenceGroups = new WeakMap<Binding, CollectionInferenceGroup>();
  private readonly collectionInferenceTypes = new WeakMap<object, CollectionInferenceGroup>();
  private readonly privateFields = new Map<string, Map<string, ClassField>>();
  private readonly privateGetters = new Map<string, Set<string>>();
  private readonly privateMethods = new Map<string, Map<string, ValueType>>();
  private readonly privateStaticFields = new Map<string, Map<string, ClassField>>();
  private readonly privateStaticGetters = new Map<string, Set<string>>();
  private readonly privateStaticMethods = new Map<string, Map<string, ValueType>>();
  private readonly predeclared = new WeakSet<object>();
  private functionDepth = 0;
  private parameterDefaultDepth = 0;
  private loopDepth = 0;
  private finallyLoopDepths: number[] = [];
  private unreachableDiagnosticDepth = 0;
  private readonly loopFlowContexts: {
    readonly baseline: FlowFactsSnapshot;
    readonly carried: FlowFactInvalidations[];
    readonly backEdges: FlowFactInvalidations[];
    sawBreak: boolean;
  }[] = [];
  private loopCaptureFloor = 0;
  private currentClass: string | null = null;
  private superMemberContext: "instance" | "static" | null = null;
  private classFieldInitializerDepth = 0;
  // Module-initialization-position classification (D31 item 23): a read is
  // eager when it runs while the module itself evaluates. Function bodies
  // bump functionDepth; the two extra counters cover deferred positions that
  // do not (instance field initializers run at construction, and extension
  // bodies such as components render after module evaluation).
  private instanceFieldInitializerDepth = 0;
  protected deferredExecutionDepth = 0;
  private readonly importedBindingSources = new Map<Binding, { readonly source: string; readonly imported: string | null }>();
  // Every import (JavaScript ones included) remembers its module specifier so
  // assignment and collision diagnostics can say "imported" and name the
  // owning module (MOD-I3 / MOD-I4).
  private readonly importedBindingOrigins = new Map<Binding, string>();
  /** Namespace import locals by name, known before signature validation runs (ENM-I9 teaching). */
  private readonly namespaceImportLocals = new Map<string, string>();
  private readonly initializationImportReadSites = new Map<string, InitializationImportRead>();
  /** Local class bindings mapped to the source offset where their `class` statement evaluates (CLS-D8). */
  private readonly hoistedClassDeclarations = new Map<Binding, number>();
  /** Module-scope names bound to runtime Type objects (local and imported); see LoweringHints.runtimeTypeObjectNames. */
  private readonly runtimeTypeObjectNames = new Set<string>();
  private staticFieldInitialization: {
    readonly className: string;
    readonly initialized: ReadonlySet<string>;
  } | null = null;
  protected constructorDepth = 0;
  // The one `super(...)` call a derived constructor may make: the span
  // identity of its first top-level statement's call expression. Any other
  // super call — a second one, or one nested in a branch or loop — would
  // crash at runtime ("Super constructor may only be called once" or
  // "must call super before accessing 'this'"), so it is rejected here.
  private allowedSuperCall: string | null = null;
  protected flowFrameDepth = 0;
  private readonly primitiveNames = new Set(corePrimitiveNames);
  private readonly primitiveParents = new Map<string, Set<string>>();
  private readonly primitiveMutableFields = new Map<string, Set<string>>();
  private readonly extensionGlobals = new Map<string, ValueType>();
  private readonly extensionReservedBindings = new Set<string>();
  private readonly globalGuidance = new Map(coreGlobalGuidance);
  private readonly analysisExtensions: readonly CompilerAnalysisExtension[];

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    this.analysisExtensions = extensions;
    this.inferredFunctionResultSeeds = context.inferredFunctionResults ?? new Map();
    this.finalizeFunctionResultInference = context.finalizeFunctionResultInference === true;
    this.classes.set("Error", {
      parameters: [stringType],
      parameterNames: ["message"],
      requiredParameters: 0,
      base: null,
      abstract: false,
      fields: new Map([
        ["name", { mutable: false, type: stringType }],
        ["message", { mutable: false, type: stringType }],
        ["stack", { mutable: false, type: optionalOf(stringType) }],
        // ASY-U3: charter section 11 promises a non-Error rejection remains
        // available as the JavaScript cause; the member makes that reachable.
        ["cause", { mutable: false, type: unknownType }],
      ]),
      getters: new Set(),
      abstractGetters: new Set(),
      methods: new Map(),
      abstractMethods: new Set(),
      staticFields: new Map(),
      staticGetters: new Set(),
      staticMethods: new Map(),
    });
    // ENM-U4 + COL-U5: the three compiler-raised error types are nameable —
    // catchable, `is`-narrowable, and constructible — wired exactly like
    // Error. ValidationError additionally carries the failure detail its
    // parse sites report (path, field, reason).
    for (const [name, detailFields] of [
      ["ValidationError", [
        ["path", { mutable: false, type: optionalOf(stringType) }],
        ["field", { mutable: false, type: optionalOf(stringType) }],
        ["reason", { mutable: false, type: optionalOf(stringType) }],
      ]],
      ["NarrowingError", []],
      ["IndexError", []],
    ] as const) {
      this.classes.set(name, {
        parameters: [stringType],
        parameterNames: ["message"],
        requiredParameters: 0,
        base: "Error",
        abstract: false,
        fields: new Map(detailFields as readonly (readonly [string, ClassField])[]),
        getters: new Set(),
        abstractGetters: new Set(),
        methods: new Map(),
        abstractMethods: new Set(),
        staticFields: new Map(),
        staticGetters: new Set(),
        staticMethods: new Map(),
      });
    }
    this.modulePath = context.path ?? null;
    this.importBindings = new Map(context.imports);
    this.dynamicImports = new Map(context.dynamicImports);
    for (const [name, kind] of context.reactiveImports ?? []) this.reactiveBindings.set(name, kind);
    for (const [name, fields] of context.namedTypes ?? []) this.namedTypes.set(name, fields);
    for (const [name, fields] of context.namedTypeReadonlyFields ?? []) this.namedTypeReadonlyFields.set(name, fields);
    for (const [name, identity] of context.namedTypeIdentities ?? []) this.namedTypeIdentities.set(name, identity);
    for (const [name, type] of context.typeAliases ?? []) this.typeAliases.set(name, type);
    for (const [name, members] of context.enums ?? []) this.enums.set(name, members);
    for (const [name, info] of context.classes ?? []) this.classes.set(name, info);
    for (const extension of extensions) {
      for (const name of extension.primitiveTypes ?? []) this.primitiveNames.add(name);
      for (const [name, parents] of extension.primitiveParents ?? []) {
        const collected = this.primitiveParents.get(name) ?? new Set<string>();
        for (const parent of parents) collected.add(parent);
        this.primitiveParents.set(name, collected);
      }
      for (const [name, fields] of extension.primitiveMutableFields ?? []) {
        const collected = this.primitiveMutableFields.get(name) ?? new Set<string>();
        for (const field of fields) collected.add(field);
        this.primitiveMutableFields.set(name, collected);
      }
      for (const [name, type] of extension.globals ?? []) this.extensionGlobals.set(name, type);
      for (const name of extension.reservedBindings ?? []) this.extensionReservedBindings.add(name);
      for (const [name, guidance] of extension.globalGuidance ?? []) this.globalGuidance.set(name, guidance);
    }
  }

  private readonly modulePath: string | null;
  private readonly importBindings: ReadonlyMap<string, ValueType>;
  private readonly dynamicImports: ReadonlyMap<string, ValueType>;

  analyze(program: Program): readonly Diagnostic[] {
    this.registerEnumShapes(program);
    this.registerAliasShapes(program);
    // Class identities must exist before record fields are resolved. Otherwise a
    // record field annotated with a class is frozen as a structural named type.
    this.registerClassNames(program);
    this.registerExternTypeImports(program);
    this.registerTypeShapes(program);
    this.validateDataTypeDeclarations(program);
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration") continue;
      for (const specifier of statement.specifiers) {
        if (specifier.namespace) this.namespaceImportLocals.set(specifier.local, statement.source);
      }
    }
    this.validateCoreDeclarationSignatures(program);
    this.registerClassShapes(program);
    this.rejectUnproductiveRecursiveTypes(program);
    this.registerExternClassDeclarations(program);
    this.validateExternDeclarations(program);
    this.registerExternModules(program);
    this.validateReExports(program);
    this.predeclareTopLevel(program);
    for (const statement of program.body) {
      this.analyzeStatement(statement);
    }
    return this.diagnostics;
  }

  private registerExternTypeImports(program: Program): void {
    const classesBySource = new Map<string, ReadonlySet<string>>();
    for (const statement of program.body) {
      if (statement.kind !== "ExternModuleDeclaration" || classesBySource.has(statement.source)) continue;
      classesBySource.set(statement.source, new Set(statement.classes.map((declaration) => declaration.name)));
    }
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration" || !statement.javascript || statement.unsafe) continue;
      const classNames = classesBySource.get(statement.source);
      if (!classNames) continue;
      for (const specifier of statement.specifiers) {
        if (specifier.namespace || !classNames.has(specifier.imported)) continue;
        this.externTypeImports.set(specifier.local, {
          kind: "class",
          name: specifier.local,
          identity: this.externClassIdentity(statement.source, specifier.imported),
        });
      }
    }
  }

  private validateDataTypeDeclarations(program: Program): void {
    const declarations = program.body.filter((statement): statement is TypeDeclaration | TypeAliasDeclaration =>
      statement.kind === "TypeDeclaration" || statement.kind === "TypeAliasDeclaration");
    for (const declaration of declarations) {
      let valid = declaration.kind === "TypeAliasDeclaration"
        ? this.validateTypeReference(declaration.target)
        : declaration.fields.map((field) => this.validateTypeReference(field.type)).every(Boolean);
      if (valid) {
        const runtimeCheckedReferences = declaration.kind === "TypeAliasDeclaration"
          ? [declaration.target]
          : declaration.fields.map((field) => field.type);
        for (const reference of runtimeCheckedReferences) {
          if (!typeContainsRuntimeTypeCheck(this.resolveAnnotation(reference))) continue;
          this.diagnostics.push(diagnostic(
            "VEL4022",
            "Type<T> is a static runtime-Type carrier and cannot be embedded in a runtime-validated 'type'; keep it in a function, class, or ordinary value instead",
            reference.span,
          ));
          valid = false;
        }
      }
      // D44 rule 72: a `readonly` field modifier makes the same deep promise
      // as a `readonly T` annotation, so it obeys the same pure-data rule.
      if (valid && declaration.kind === "TypeDeclaration") {
        for (const field of declaration.fields) {
          if (!field.readonly) continue;
          const violation = this.findClassInReadonlyData(this.resolveAnnotation(field.type));
          if (!violation) continue;
          this.typeError(
            `'readonly' accepts only pure data at every depth; '${declaration.name}.${field.name}${violation.suffix}' is class '${violation.className}' — model it as a data record, or drop 'readonly'`,
            field.span,
          );
          valid = false;
        }
      }
      if (!valid) this.invalidDeclaredTypes.add(declaration.name);
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const declaration of declarations) {
        if (this.invalidDeclaredTypes.has(declaration.name)) continue;
        const syntaxes = declaration.kind === "TypeAliasDeclaration"
          ? [declaration.target.syntax]
          : declaration.fields.map((field) => field.type.syntax);
        if (!syntaxes.some((syntax) => this.typeSyntaxReferencesInvalidDeclaration(syntax))) continue;
        this.invalidDeclaredTypes.add(declaration.name);
        changed = true;
      }
    }
  }

  private validateCoreDeclarationSignatures(program: Program): void {
    const validateFunction = (statement: Pick<FunctionDeclaration, "typeParameters" | "parameters" | "returnType">): void => {
      this.withTypeParameterFrame(this.typeParameterFrame(statement.typeParameters), () => {
        for (const parameter of statement.parameters) {
          if (parameter.type) this.validateTypeReference(parameter.type);
        }
        if (statement.returnType) this.validateTypeReference(statement.returnType);
      });
    };
    for (const statement of program.body) {
      if (statement.kind === "VariableDeclaration") {
        if (statement.type) this.validateTypeReference(statement.type);
      } else if (statement.kind === "FunctionDeclaration") {
        validateFunction(statement);
      } else if (statement.kind === "ClassDeclaration") {
        for (const parameter of statement.parameters) {
          if (parameter.type) this.validateTypeReference(parameter.type);
        }
        for (const field of statement.fields) this.validateTypeReference(field.type);
        for (const getter of statement.getters) validateFunction(getter);
        for (const method of statement.methods) validateFunction(method);
      }
    }
  }

  private typeSyntaxReferencesInvalidDeclaration(syntax: TypeSyntax): boolean {
    switch (syntax.kind) {
      case "NamedTypeSyntax":
        return this.invalidDeclaredTypes.has(syntax.name);
      case "EnumMemberTypeSyntax":
        return false;
      case "GenericTypeSyntax":
        return syntax.arguments.some((argument) => this.typeSyntaxReferencesInvalidDeclaration(argument));
      case "ReadonlyTypeSyntax":
      case "OptionalTypeSyntax":
        return this.typeSyntaxReferencesInvalidDeclaration(syntax.inner);
      case "UnionTypeSyntax":
        return syntax.members.some((member) => this.typeSyntaxReferencesInvalidDeclaration(member));
      case "FunctionTypeSyntax":
        return syntax.parameters.some((parameter) => this.typeSyntaxReferencesInvalidDeclaration(parameter.type))
          || this.typeSyntaxReferencesInvalidDeclaration(syntax.result);
    }
  }

  private rejectUnproductiveRecursiveTypes(program: Program): void {
    const declarations = new Map(program.body
      .filter((statement) => statement.kind === "TypeDeclaration")
      .map((statement) => [statement.name, statement]));
    const productive = new Set<string>();
    const typeIsProductive = (source: ValueType): boolean => {
      const type = this.expandAliases(source);
      if (type.kind === "named") return !declarations.has(type.name) || productive.has(type.name);
      if (type.kind === "union") return type.members.some(typeIsProductive);
      if (type.kind === "object") return [...type.fields.values()].every(typeIsProductive);
      if (type.kind === "optional" || type.kind === "list" || type.kind === "set" || type.kind === "map" || type.kind === "record" || type.kind === "promise") return true;
      return true;
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (const [name] of declarations) {
        if (productive.has(name)) continue;
        const fields = this.namedTypes.get(name);
        if (fields && [...fields.values()].every(typeIsProductive)) {
          productive.add(name);
          changed = true;
        }
      }
    }
    for (const [name, declaration] of declarations) {
      if (!productive.has(name)) this.diagnostics.push(diagnostic("VEL4009", `Recursive type '${name}' cannot construct a finite value; add an optional, collection, or terminating union path`, declaration.span));
    }
  }

  private predeclareTopLevel(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind === "ImportDeclaration") {
        for (const specifier of statement.specifiers) {
          if (statement.javascript) this.javaScriptBindings.add(specifier.local);
          this.declareBinding(
            specifier.local,
            false,
            this.importType(statement, specifier.local, specifier.imported, specifier.namespace, specifier.span),
            specifier.span,
            false,
            undefined,
            statement.source,
          );
          this.recordImportedBindingSource(statement.javascript, statement.source, specifier.local, specifier.namespace ? null : specifier.imported);
          this.recordImportedBindingOrigin(specifier.local, statement.source, specifier.span);
          const reactive = this.reactiveBindings.get(specifier.local);
          if (reactive) this.markDeclaredBindingReactive(specifier.local, reactive);
        }
        this.predeclared.add(statement);
      } else if (statement.kind === "TypeDeclaration" || statement.kind === "TypeAliasDeclaration") {
        this.declareBinding(statement.name, false, { kind: "typeObject", name: statement.name }, statement.span);
        this.predeclared.add(statement);
      } else if (statement.kind === "EnumDeclaration") {
        const info = this.enums.get(statement.name) ?? { identity: statement.name, members: new Set(statement.members.map((member) => member.name)) };
        this.declareBinding(statement.name, false, { kind: "enumObject", name: statement.name, identity: info.identity, members: info.members }, statement.span);
        this.predeclared.add(statement);
      } else if (statement.kind === "ClassDeclaration") {
        this.declareBinding(statement.name, false, { kind: "classConstructor", name: statement.name }, statement.span);
        // The name is hoisted for analysis so deferred bodies may reference
        // classes declared later, but the emitted `class` statement is not
        // hoisted at runtime. Remember where the declaration evaluates so an
        // immediate earlier use is rejected instead of loading into a raw
        // ReferenceError.
        const hoisted = this.scopes.at(-1)?.get(statement.name);
        if (hoisted) this.hoistedClassDeclarations.set(hoisted, statement.span.start);
        this.predeclared.add(statement);
      } else if (statement.kind === "FunctionDeclaration") {
        this.declareBinding(statement.name, false, this.functionType(statement), statement.span);
        this.predeclared.add(statement);
      } else if (this.predeclareExtensionStatement(statement)) {
        this.predeclared.add(statement);
      }
    }
  }

  private registerExternClassDeclarations(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ExternModuleDeclaration") continue;
      for (const declaration of statement.classes) {
        const sources = new Set(this.externClassDeclarations.get(declaration.name));
        sources.add(statement.source);
        this.externClassDeclarations.set(declaration.name, sources);
      }
    }
  }

  private validateExternDeclarations(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ExternModuleDeclaration") continue;
      const classNames = new Set(statement.classes.map((declaration) => declaration.name));
      const validate = (reference: TypeReference | null): boolean => {
        if (!reference) return true;
        const valid = this.validateTypeReference(reference, (value) => this.resolveExternAnnotation(value, statement.source, classNames));
        if (!valid) this.invalidExternTypeReferences.add(reference);
        return valid;
      };
      for (const declaration of statement.classes) {
        for (const parameter of declaration.parameters) validate(parameter.type);
        for (const field of declaration.fields) validate(field.type);
        for (const getter of declaration.getters) validate(getter.type);
        for (const method of declaration.methods) {
          if (!method.returnType) {
            this.diagnostics.push(diagnostic(
              "VEL4023",
              `Extern method '${method.name}' requires an explicit result annotation; write '-> null' when it has no result`,
              method.signatureSpan,
            ));
          }
          this.withTypeParameterFrame(this.typeParameterFrame(method.typeParameters), () => {
            for (const parameter of method.parameters) validate(parameter.type);
            validate(method.returnType);
          });
        }
      }
      for (const declaration of statement.functions) {
        if (!declaration.returnType) {
          this.diagnostics.push(diagnostic(
            "VEL4023",
            `Extern function '${declaration.name}' requires an explicit result annotation; write '-> null' when it has no result`,
            declaration.signatureSpan,
          ));
        }
        this.withTypeParameterFrame(this.typeParameterFrame(declaration.typeParameters), () => {
          for (const parameter of declaration.parameters) validate(parameter.type);
          validate(declaration.returnType);
        });
      }
      for (const declaration of statement.constants) validate(declaration.type);
    }
  }

  private validateReExports(program: Program): void {
    const exported = new Set<string>();
    const addPatternNames = (pattern: BindingPattern): void => {
      if (pattern.kind === "NameBindingPattern") {
        exported.add(pattern.name);
        return;
      }
      if (pattern.kind === "ListBindingPattern") {
        for (const element of pattern.elements) if (element) addPatternNames(element);
        if (pattern.rest) exported.add(pattern.rest.name);
        return;
      }
      for (const entry of pattern.entries) addPatternNames(entry.pattern);
      if (pattern.rest) exported.add(pattern.rest.name);
    };
    for (const statement of program.body) {
      if (statement.kind === "ReExportDeclaration" || !("exported" in statement) || !statement.exported) continue;
      if (statement.kind === "VariableDeclaration") addPatternNames(statement.pattern);
      else if ("name" in statement && typeof statement.name === "string") exported.add(statement.name);
    }
    for (const statement of program.body) {
      if (statement.kind !== "ReExportDeclaration") continue;
      for (const specifier of statement.specifiers) {
        if (exported.has(specifier.exported)) {
          this.diagnostics.push(diagnostic(
            "VEL3016",
            `Export '${specifier.exported}' is declared more than once in this module; rename the re-export with 'as'`,
            specifier.span,
          ));
          continue;
        }
        exported.add(specifier.exported);
      }
    }
  }

  private registerExternModules(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ExternModuleDeclaration") continue;
      if (this.externModules.has(statement.source)) {
        this.diagnostics.push(diagnostic("VEL4005", `Extern module '${statement.source}' is declared more than once`, statement.span));
        continue;
      }
      const exports = new Map<string, ValueType>();
      const classNames = new Set(statement.classes.map((declaration) => declaration.name));
      for (const declaration of statement.classes) {
        if (exports.has(declaration.name)) {
          this.diagnostics.push(diagnostic("VEL4005", `Extern export '${declaration.name}' is declared more than once`, declaration.span));
          continue;
        }
        const identity = this.externClassIdentity(statement.source, declaration.name);
        const fields = new Map<string, ClassField>();
        const staticFields = new Map<string, ClassField>();
        for (const parameter of declaration.parameters) {
          if (parameter.binding) fields.set(parameter.name, {
            mutable: parameter.binding === "let",
            type: this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames),
          });
        }
        for (const field of declaration.fields) {
          (field.static ? staticFields : fields).set(field.name, {
            mutable: field.mutable,
            type: this.resolveValidatedExternAnnotation(field.type, statement.source, classNames),
          });
        }
        const getters = new Set<string>();
        const staticGetters = new Set<string>();
        for (const getter of declaration.getters) {
          (getter.static ? staticFields : fields).set(getter.name, {
            mutable: false,
            type: this.resolveValidatedExternAnnotation(getter.type, statement.source, classNames),
          });
          (getter.static ? staticGetters : getters).add(getter.name);
        }
        const methods = new Map<string, ValueType>();
        const staticMethods = new Map<string, ValueType>();
        for (const method of declaration.methods) {
          (method.static ? staticMethods : methods).set(method.name, this.externFunctionType(
            method,
            (reference) => this.resolveValidatedExternAnnotation(reference, statement.source, classNames),
          ));
        }
        const rest = declaration.parameters.find((parameter) => parameter.rest);
        const info: ClassInfo = {
          identity,
          parameters: declaration.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames)),
          requiredParameters: declaration.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
          ...(rest ? { constructorRest: this.resolveValidatedExternAnnotation(rest.type, statement.source, classNames) } : {}),
          base: declaration.base ? this.externClassIdentity(statement.source, declaration.base) : null,
          abstract: false,
          fields,
          getters,
          abstractGetters: new Set(),
          methods,
          abstractMethods: new Set(),
          staticFields,
          staticGetters,
          staticMethods,
        };
        // A class already registered under the same identity is the same
        // nominal class declared by another module (or bridged declaration).
        // Matching shapes share the one contract silently; a disagreement is
        // reported here, at the later declaration, instead of forking the
        // identity into two contracts that can never assign to each other.
        const existing = this.classes.get(identity);
        if (existing && externClassContract(existing) !== externClassContract(info)) {
          this.diagnostics.push(diagnostic(
            "VEL4005",
            `Extern class '${declaration.name}' from '${statement.source}' is already declared with a different shape; every declaration of an extern class shares one contract`,
            declaration.span,
          ));
        }
        this.classes.set(identity, info);
        exports.set(declaration.name, { kind: "classConstructor", name: declaration.name, identity });
      }
      for (const declaration of [...statement.functions, ...statement.constants]) {
        if (exports.has(declaration.name)) {
          this.diagnostics.push(diagnostic("VEL4005", `Extern export '${declaration.name}' is declared more than once`, declaration.span));
        }
        exports.set(declaration.name, "parameters" in declaration
          ? this.externFunctionType(declaration, (reference) => this.resolveValidatedExternAnnotation(reference, statement.source, classNames))
          : this.resolveValidatedExternAnnotation(declaration.type, statement.source, classNames));
      }
      this.externModules.set(statement.source, exports);
    }
  }

  loweringHints(): LoweringHints {
    return {
      collectionCalls: this.collectionCalls,
      collectionSizes: this.collectionSizes,
      primitiveCalls: this.primitiveCalls,
      stringSizes: this.stringSizes,
      constructorCalls: this.constructorCalls,
      javaScriptCallBoundaries: this.javaScriptCallBoundaries,
      classChecks: this.classChecks,
      privateMembers: this.privateMembers,
      classNames: new Set([...this.classes.keys(), ...this.classDisplayNames.values()]),
      errorSubclassNames: new Set([...this.classes.keys()].filter((name) => name !== "Error" && this.isSubclassOf(name, "Error"))),
      enumNames: new Set(this.enums.keys()),
      runtimeTypeObjectNames: this.runtimeTypeObjectNames,
      optionalMembers: this.optionalMembers,
      optionalCalls: this.optionalCalls,
      optionalIndexes: this.optionalIndexes,
      optionalCallees: this.optionalCallees,
      truthConditions: this.truthConditions,
      normalizedNullResults: this.normalizedNullResults,
      normalizedPromiseValues: this.normalizedPromiseValues,
      asyncResolvedValues: this.asyncResolvedValues,
      asyncForStatements: this.asyncForStatements,
      normalizedUndefinedExpressions: this.normalizedUndefinedExpressions,
      instanceFieldReads: this.instanceFieldReads,
      privateInstanceFieldReads: this.privateInstanceFieldReads,
      staticFieldReads: this.staticFieldReads,
      classMethodReferences: this.classMethodReferences,
      optionalBindingEntries: this.optionalBindingEntries,
      reactiveReferences: this.reactiveReferences,
      enumValueBindings: this.enumValueBindings,
      exhaustiveMatches: this.exhaustiveMatches,
      formReads: this.formReads,
      namedArgumentOrders: this.namedArgumentOrders,
      extensionLiterals: this.extensionLiterals,
      extensionCalls: this.extensionCalls,
      builtinValueReferences: this.builtinValueReferences,
      runtimeNarrowings: this.runtimeNarrowings,
      sameValueZeroEqualities: this.sameValueZeroEqualities,
      sameValueZeroMatchValues: this.sameValueZeroMatchValues,
      equalsCalls: this.equalsCalls,
      stringOrderings: this.stringOrderings,
      dynamicOrderings: this.dynamicOrderings,
      usingDisposals: this.usingDisposals,
      moduleTopLevelHostCalls: this.moduleTopLevelHostCalls,
    };
  }

  semanticTypes(): ReadonlyMap<string, ValueType> {
    return this.semanticBindingTypes;
  }

  inferredFunctionResults(): ReadonlyMap<string, ValueType> {
    return this.inferredFunctionResultTypes;
  }

  static inferredFunctionResultsMatch(
    left: ReadonlyMap<string, ValueType>,
    right: ReadonlyMap<string, ValueType>,
  ): boolean {
    if (left.size !== right.size) return false;
    for (const [key, type] of left) {
      const candidate = right.get(key);
      if (!candidate || !sameInferredResult(type, candidate)) return false;
    }
    return true;
  }

  semanticMembers(): ReadonlyMap<string, ReadonlyMap<string, ValueType>> {
    return this.semanticBindingMembers;
  }

  analyzedClasses(): ReadonlyMap<string, ClassInfo> {
    return this.classes;
  }

  semanticExpressions(): {
    readonly types: ReadonlyMap<string, ValueType>;
    readonly members: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
    readonly owners: ReadonlyMap<string, ValueType>;
    readonly objectPropertyOwners: ReadonlyMap<string, ValueType>;
    readonly bindingEntryOwners: ReadonlyMap<string, ValueType>;
    readonly jsxAttributeOwners: ReadonlyMap<string, ValueType>;
    readonly contexts: ReadonlyMap<string, ValueType>;
    readonly contextMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  } {
    return {
      types: this.semanticExpressionTypes,
      members: this.semanticExpressionMembers,
      owners: this.semanticExpressionOwners,
      objectPropertyOwners: this.semanticObjectPropertyOwners,
      bindingEntryOwners: this.semanticBindingEntryOwners,
      jsxAttributeOwners: this.semanticJsxAttributeOwners,
      contexts: this.semanticExpressionContexts,
      contextMembers: this.semanticExpressionContextMembers,
    };
  }

  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null {
    return this.namedTypes.get(identity) ?? this.extensionFieldsOf(identity);
  }

  isExtensionTypeAssignable(
    actual: ExtensionValueType,
    expected: ExtensionValueType,
    assign: (actual: ValueType, expected: ValueType) => boolean,
  ): boolean | undefined {
    for (const extension of this.analysisExtensions) {
      const result = extension.isTypeAssignable?.(actual, expected, assign);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  extensionTextForm(type: ValueType): boolean | undefined {
    for (const extension of this.analysisExtensions) {
      const result = extension.textForm?.(type);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  protected readonlyDataViewOf(type: ValueType): ValueType {
    if (type.kind === "optional") return optionalOf(this.readonlyDataViewOf(type.inner));
    if (type.kind === "union") return unionOf(type.members.map((member) => this.readonlyDataViewOf(member)));
    if (type.kind === "named" && this.isPrimitiveType(type.name)) return mutableViewOf(type);
    return readonlyViewOf(type);
  }

  readonlyFieldsOf(identity: string): ReadonlySet<string> | null {
    return this.namedTypeReadonlyFields.get(identity) ?? null;
  }

  /**
   * D44 rule 72: `readonly T` promises that everything reachable through the
   * view is protected data, so a class type at any depth is rejected at the
   * declaration site — otherwise the promise would silently end at the class
   * member. Bare type parameters stay legal (opacity is as good as
   * immutability), `unknown`/`any` are already where static promises end, and
   * function types are behavior boundaries whose signatures are not data.
   * Named records are memoized per identity; a verdict computed through a
   * recursion cut stays local to that traversal so shared types keep sound
   * cached answers.
   */
  protected findClassInReadonlyData(
    type: ValueType,
    seen: Set<string> = new Set(),
    sawCycle: { cut: boolean } = { cut: false },
  ): { readonly suffix: string; readonly className: string } | null {
    const resolved = this.expandAliases(type);
    switch (resolved.kind) {
      case "class":
      case "classConstructor":
        return { suffix: "", className: resolved.name };
      case "optional":
        return this.findClassInReadonlyData(resolved.inner, seen, sawCycle);
      case "union": {
        for (const member of resolved.members) {
          const found = this.findClassInReadonlyData(member, seen, sawCycle);
          if (found) return found;
        }
        return null;
      }
      case "list":
      case "set": {
        const found = this.findClassInReadonlyData(resolved.element, seen, sawCycle);
        return found ? { suffix: `[element]${found.suffix}`, className: found.className } : null;
      }
      case "map": {
        const key = this.findClassInReadonlyData(resolved.key, seen, sawCycle);
        if (key) return { suffix: `[key]${key.suffix}`, className: key.className };
        const value = this.findClassInReadonlyData(resolved.value, seen, sawCycle);
        return value ? { suffix: `[value]${value.suffix}`, className: value.className } : null;
      }
      case "record":
      case "promise": {
        const found = this.findClassInReadonlyData(resolved.value, seen, sawCycle);
        return found ? { suffix: `[value]${found.suffix}`, className: found.className } : null;
      }
      case "object": {
        for (const [name, field] of resolved.fields) {
          const found = this.findClassInReadonlyData(field, seen, sawCycle);
          if (found) return { suffix: `.${name}${found.suffix}`, className: found.className };
        }
        return null;
      }
      case "named": {
        const identity = resolved.identity ?? resolved.name;
        const cached = this.readonlyClassScanVerdicts.get(identity);
        if (cached !== undefined) return cached;
        if (seen.has(identity)) {
          sawCycle.cut = true;
          return null;
        }
        const fields = this.fieldsOf(identity);
        if (!fields) return null;
        seen.add(identity);
        const innerCycle = { cut: false };
        let verdict: { readonly suffix: string; readonly className: string } | null = null;
        for (const [name, field] of fields) {
          const found = this.findClassInReadonlyData(field, seen, innerCycle);
          if (found) {
            verdict = { suffix: `.${name}${found.suffix}`, className: found.className };
            break;
          }
        }
        seen.delete(identity);
        if (innerCycle.cut) sawCycle.cut = true;
        // A found class is constructive and always cacheable; a clean verdict
        // is cacheable only when no recursion cut hid part of the type.
        if (verdict !== null || !innerCycle.cut) this.readonlyClassScanVerdicts.set(identity, verdict);
        return verdict;
      }
      default:
        return null;
    }
  }

  protected predeclareExtensionStatement(_statement: Statement): boolean {
    return false;
  }

  protected analyzeExtensionStatement(_statement: Statement): boolean {
    return false;
  }

  protected prescanExtensionScopeDeclaration(_statement: Statement): { readonly name: string; readonly span: Span } | null {
    return null;
  }

  protected inferExtensionExpression(_expression: Expression, _contextualType: ValueType): ValueType | undefined {
    return undefined;
  }

  protected inferExtensionCall(
    _callee: ExtensionValueType,
    _arguments: readonly Expression[],
    _argumentNames: readonly (string | null)[] | undefined,
    _callSpan: Span,
  ): ValueType | undefined {
    return undefined;
  }

  protected validateExtensionTypeSyntax(
    _syntax: TypeSyntax,
    _validate: (syntax: TypeSyntax) => boolean,
    _resolve: (reference: TypeReference) => ValueType,
  ): boolean | undefined {
    return undefined;
  }

  protected extensionFieldsOf(_name: string): ReadonlyMap<string, ValueType> | null {
    return null;
  }

  protected invalidExtensionAwaitContext(): boolean {
    return false;
  }

  protected invalidExtensionAwaitMessage(): string | null {
    return null;
  }

  protected isTopLevelScope(): boolean {
    return this.scopes.length === 1;
  }

  protected isPredeclared(statement: object): boolean {
    return this.predeclared.has(statement);
  }

  isSubclassOf(actual: string, expected: string): boolean {
    let current: string | null = actual;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      if (current === expected) return true;
      visited.add(current);
      const info = this.classes.get(current);
      if (info?.identity === expected) return true;
      current = info?.base ?? null;
    }
    return false;
  }

  isPrimitiveType(name: string): boolean {
    return this.primitiveNames.has(name);
  }

  isPrimitiveSubtype(actual: string, expected: string): boolean {
    if (!this.primitiveNames.has(actual) || !this.primitiveNames.has(expected)) return false;
    const pending = [actual];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      if (current === expected) return true;
      visited.add(current);
      for (const parent of this.primitiveParents.get(current) ?? []) pending.push(parent);
    }
    return false;
  }

  private registerAliasShapes(program: Program): void {
    const declarations = new Map<string, TypeAliasDeclaration>();
    for (const statement of program.body) {
      if (statement.kind !== "TypeAliasDeclaration") continue;
      this.typeAliases.delete(statement.name);
      if (declarations.has(statement.name)) {
        this.diagnostics.push(diagnostic("VEL4004", `Type '${statement.name}' is declared more than once`, statement.span));
      }
      declarations.set(statement.name, statement);
    }
    const resolving = new Set<string>();
    const reported = new Set<string>();
    const expand = (type: ValueType): ValueType => {
      if (type.kind === "named") {
        const readonly = type.readonlyView === true;
        const declaration = declarations.get(type.name);
        if (!declaration) {
          const resolved = this.typeAliases.get(type.name) ?? type;
          return readonly ? this.readonlyDataViewOf(resolved) : resolved;
        }
        const cached = this.typeAliases.get(type.name);
        if (cached && !resolving.has(type.name)) return readonly ? this.readonlyDataViewOf(cached) : cached;
        if (resolving.has(type.name)) {
          if (!reported.has(type.name)) {
            this.diagnostics.push(diagnostic("VEL4017", `Type alias '${type.name}' is recursive`, declaration.span));
            reported.add(type.name);
          }
          return unknownType;
        }
        resolving.add(type.name);
        const resolved = expand(this.resolveRawTypeReference(declaration.target));
        resolving.delete(type.name);
        this.typeAliases.set(type.name, resolved);
        return readonly ? this.readonlyDataViewOf(resolved) : resolved;
      }
      if (type.kind === "optional") return optionalOf(expand(type.inner));
      if (type.kind === "list") return { ...type, element: expand(type.element) };
      if (type.kind === "set") return { ...type, element: expand(type.element) };
      if (type.kind === "map") return { ...type, key: expand(type.key), value: expand(type.value) };
      if (type.kind === "record") return { ...type, value: expand(type.value) };
      if (type.kind === "promise") return { kind: "promise", value: expand(type.value) };
      if (type.kind === "runtimeType") return { kind: "runtimeType", value: expand(type.value) };
      if (type.kind === "typeObject") return type.value ? { ...type, value: expand(type.value) } : type;
      if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, expand(value)])) };
      if (type.kind === "extension") {
        return {
          ...type,
          properties: new Map([...type.properties].map(([name, value]) => [name, expand(value)])),
          arguments: type.arguments.map(expand),
        };
      }
      if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
        ...type,
        parameters: type.parameters.map(expand),
        ...(type.rest ? { rest: expand(type.rest) } : {}),
        result: expand(type.result),
      };
      if (type.kind === "union") return { kind: "union", members: type.members.map(expand) };
      return type;
    };
    for (const name of declarations.keys()) expand({ kind: "named", name });
  }

  protected expandAliases(type: ValueType, seen: ReadonlySet<string> = new Set()): ValueType {
    if (type.kind === "named" && this.typeAliases.has(type.name)) {
      if (seen.has(type.name)) return unknownType;
      const expanded = this.expandAliases(this.typeAliases.get(type.name)!, new Set([...seen, type.name]));
      return type.readonlyView ? this.readonlyDataViewOf(expanded) : expanded;
    }
    if (type.kind === "optional") {
      const inner = this.expandAliases(type.inner, seen);
      return inner === type.inner ? type : optionalOf(inner);
    }
    if (type.kind === "list" || type.kind === "set") {
      const element = this.expandAliases(type.element, seen);
      return element === type.element ? type : { ...type, element };
    }
    if (type.kind === "map") {
      const key = this.expandAliases(type.key, seen);
      const value = this.expandAliases(type.value, seen);
      return key === type.key && value === type.value ? type : { ...type, key, value };
    }
    if (type.kind === "record") {
      const value = this.expandAliases(type.value, seen);
      return value === type.value ? type : { ...type, value };
    }
    if (type.kind === "promise") {
      const value = this.expandAliases(type.value, seen);
      return value === type.value ? type : { kind: "promise", value };
    }
    if (type.kind === "runtimeType") {
      const value = this.expandAliases(type.value, seen);
      return value === type.value ? type : { kind: "runtimeType", value };
    }
    if (type.kind === "typeObject" && type.value) {
      const value = this.expandAliases(type.value, seen);
      return value === type.value ? type : { ...type, value };
    }
    if (type.kind === "object") {
      let changed = false;
      const fields = new Map([...type.fields].map(([name, value]) => {
        const expanded = this.expandAliases(value, seen);
        changed ||= expanded !== value;
        return [name, expanded] as const;
      }));
      return changed ? { ...type, fields } : type;
    }
    if (type.kind === "extension") {
      let changed = false;
      const properties = new Map([...type.properties].map(([name, value]) => {
        const expanded = this.expandAliases(value, seen);
        changed ||= expanded !== value;
        return [name, expanded] as const;
      }));
      const arguments_ = type.arguments.map((argument) => this.expandAliases(argument, seen));
      changed ||= arguments_.some((argument, index) => argument !== type.arguments[index]);
      return changed ? { ...type, properties, arguments: arguments_ } : type;
    }
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") {
      const parameters = type.parameters.map((parameter) => this.expandAliases(parameter, seen));
      const rest = type.rest ? this.expandAliases(type.rest, seen) : undefined;
      const result = this.expandAliases(type.result, seen);
      return parameters.every((parameter, index) => parameter === type.parameters[index]) && rest === type.rest && result === type.result
        ? type
        : { ...type, parameters, ...(rest ? { rest } : {}), result };
    }
    if (type.kind === "union") {
      const members = type.members.map((member) => this.expandAliases(member, seen));
      return members.every((member, index) => member === type.members[index]) ? type : { kind: "union", members };
    }
    return type;
  }

  private registerTypeShapes(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "TypeDeclaration") {
        continue;
      }
      const fields = new Map<string, ValueType>();
      const readonlyFields = new Set<string>();
      for (const field of statement.fields) {
        fields.set(field.name, this.resolveAnnotation(field.type));
        if (field.readonly) readonlyFields.add(field.name);
      }
      this.namedTypes.set(statement.name, fields);
      if (readonlyFields.size > 0) this.namedTypeReadonlyFields.set(statement.name, readonlyFields);
    }
  }

  private registerEnumShapes(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "EnumDeclaration") continue;
      this.enums.set(statement.name, { identity: statement.name, members: new Set(statement.members.map((member) => member.name)) });
    }
  }

  private registerClassNames(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ClassDeclaration" || this.classes.has(statement.name)) continue;
      this.classes.set(statement.name, {
        parameters: [],
        requiredParameters: 0,
        base: statement.base?.name ?? null,
        abstract: statement.abstract,
        fields: new Map(),
        getters: new Set(),
        abstractGetters: new Set(),
        methods: new Map(),
        abstractMethods: new Set(),
        staticFields: new Map(),
        staticGetters: new Set(),
        staticMethods: new Map(),
      });
    }
  }

  private registerClassShapes(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ClassDeclaration") {
        continue;
      }
      const fields = new Map<string, ClassField>();
      const staticFields = new Map<string, ClassField>();
      const privateFields = new Map<string, ClassField>();
      const privateStaticFields = new Map<string, ClassField>();
      const getters = new Set<string>();
      const abstractGetters = new Set<string>();
      const staticGetters = new Set<string>();
      const privateGetters = new Set<string>();
      const privateStaticGetters = new Set<string>();
      for (const parameter of statement.parameters) {
        if (parameter.binding) {
          (parameter.private ? privateFields : fields).set(parameter.name, {
            mutable: parameter.binding === "let",
            type: this.resolveValidatedAnnotation(parameter.type),
          });
        }
      }
      for (const field of statement.fields) {
        const target = field.private
          ? field.static ? privateStaticFields : privateFields
          : field.static ? staticFields : fields;
        target.set(field.name, {
          mutable: field.binding === "let",
          type: this.resolveValidatedAnnotation(field.type),
        });
      }
      for (const getter of statement.getters) {
        const target = getter.private
          ? getter.static ? privateStaticFields : privateFields
          : getter.static ? staticFields : fields;
        target.set(getter.name, { mutable: false, type: this.resolveValidatedResult(getter.returnType) });
        if (getter.private) (getter.static ? privateStaticGetters : privateGetters).add(getter.name);
        else if (getter.static) staticGetters.add(getter.name);
        else {
          getters.add(getter.name);
          if (getter.abstract) abstractGetters.add(getter.name);
        }
      }
      const methods = new Map<string, ValueType>();
      const abstractMethods = new Set<string>();
      const staticMethods = new Map<string, ValueType>();
      const privateMethods = new Map<string, ValueType>();
      const privateStaticMethods = new Map<string, ValueType>();
      for (const method of statement.methods) {
        const type = this.functionType(method);
        if (method.private) (method.static ? privateStaticMethods : privateMethods).set(method.name, type);
        else if (method.static) staticMethods.set(method.name, type);
        else {
          methods.set(method.name, type);
          if (method.abstract) abstractMethods.add(method.name);
        }
      }
      this.privateFields.set(statement.name, privateFields);
      this.privateGetters.set(statement.name, privateGetters);
      this.privateMethods.set(statement.name, privateMethods);
      this.privateStaticFields.set(statement.name, privateStaticFields);
      this.privateStaticGetters.set(statement.name, privateStaticGetters);
      this.privateStaticMethods.set(statement.name, privateStaticMethods);
      this.classes.set(statement.name, {
        ...(statement.dispose
          ? { dispose: blockContainsDirectAwait(statement.dispose.body) ? "async" : "sync" }
          : {}),
        parameters: statement.parameters.map((parameter) => this.resolveValidatedAnnotation(parameter.type)),
        parameterNames: statement.parameters.map((parameter) => parameter.name),
        requiredParameters: statement.parameters.filter((parameter) => !parameter.defaultValue).length,
        base: statement.base?.name ?? null,
        abstract: statement.abstract,
        fields,
        getters,
        abstractGetters,
        methods,
        abstractMethods,
        staticFields,
        staticGetters,
        staticMethods,
      });
    }
  }

  protected analyzeStatement(statement: Statement): void {
    if (this.analyzeExtensionStatement(statement)) return;
    switch (statement.kind) {
      case "ImportDeclaration":
        // MOD-D1: the whole module-boundary family is module-top-level only.
        // A block-level import emitted invalid JavaScript, and a
        // function-body import silently bound `unknown` (the dependency walk
        // reads program.body only).
        if (this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "Imports can only be declared at module scope", statement.span));
        }
        if (!this.predeclared.has(statement)) {
          for (const specifier of statement.specifiers) {
            this.declareBinding(
              specifier.local,
              false,
              this.importType(statement, specifier.local, specifier.imported, specifier.namespace, specifier.span),
              specifier.span,
              false,
              undefined,
              statement.source,
            );
            this.recordImportedBindingSource(statement.javascript, statement.source, specifier.local, specifier.namespace ? null : specifier.imported);
            this.recordImportedBindingOrigin(specifier.local, statement.source, specifier.span);
            const reactive = this.reactiveBindings.get(specifier.local);
            if (reactive) this.markDeclaredBindingReactive(specifier.local, reactive);
          }
        }
        break;
      case "ReExportDeclaration":
        if (this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "Exports can only be declared at module scope", statement.span));
        }
        break;
      case "ExternModuleDeclaration":
        if (this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "Extern modules can only be declared at module scope", statement.span));
        }
        {
          const classNames = new Set(statement.classes.map((declaration) => declaration.name));
          const bases = new Map(statement.classes.map((declaration) => [declaration.name, declaration.base]));
          for (const declaration of statement.classes) {
            const members = new Set<string>();
            if (declaration.base && !classNames.has(declaration.base)) {
              this.typeError(`Unknown extern base class '${declaration.base}'`, declaration.span);
            } else if (declaration.base) {
              const visited = new Set([declaration.name]);
              let current: string | null = declaration.base;
              while (current) {
                if (visited.has(current)) {
                  this.typeError(`Extern class '${declaration.name}' has a cyclic inheritance relationship`, declaration.span);
                  break;
                }
                visited.add(current);
                current = bases.get(current) ?? null;
              }
            }
            for (const parameter of declaration.parameters) {
              const type = this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames);
              const valid = !parameter.type || !this.invalidExternTypeReferences.has(parameter.type);
              if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
              if (parameter.binding) members.add(`instance:${parameter.name}`);
            }
            for (const field of declaration.fields) {
              this.validateClassMemberName(field.name, field.span, true);
              const key = `${field.static ? "static" : "instance"}:${field.name}`;
              if (members.has(key)) this.typeError(`Extern class '${declaration.name}' declares member '${field.name}' more than once`, field.span);
              members.add(key);
            }
            for (const getter of declaration.getters) {
              this.validateClassMemberName(getter.name, getter.span, true);
              const key = `${getter.static ? "static" : "instance"}:${getter.name}`;
              if (members.has(key)) this.typeError(`Extern class '${declaration.name}' declares member '${getter.name}' more than once`, getter.span);
              members.add(key);
            }
            for (const method of declaration.methods) {
              this.validateClassMemberName(method.name, method.span, true);
              const key = `${method.static ? "static" : "instance"}:${method.name}`;
              if (members.has(key)) this.typeError(`Extern class '${declaration.name}' declares member '${method.name}' more than once`, method.span);
              members.add(key);
              this.checkTypeParameterDeclarations(method.typeParameters);
              this.withTypeParameterFrame(this.typeParameterFrame(method.typeParameters), () => {
                for (const parameter of method.parameters) {
                  const type = this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames);
                  const valid = !parameter.type || !this.invalidExternTypeReferences.has(parameter.type);
                  if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
                }
                if (method.returnType) {
                  const result = this.resolveValidatedExternAnnotation(method.returnType, statement.source, classNames);
                  if (!this.invalidExternTypeReferences.has(method.returnType) && method.asynchronous && this.asyncResultContainsPromise(result)) {
                    this.diagnostics.push(diagnostic("VEL4018", "An async result annotation names the resolved value; write '-> T', not '-> Promise<T>'", method.returnType.span));
                  } else if (!this.invalidExternTypeReferences.has(method.returnType)) {
                    if (method.asynchronous) this.reportPromiseResolutionHazard(result, method.returnType.span);
                    else this.reportPromiseCarrierHazard(result, method.returnType.span);
                  }
                }
              });
            }
            if (declaration.base && classNames.has(declaration.base)) {
              const base = this.externClassIdentity(statement.source, declaration.base);
              const ownFields = [
                ...declaration.parameters.filter((parameter) => parameter.binding).map((parameter) => ({
                  name: parameter.name,
                  mutable: parameter.binding === "let",
                  type: this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames),
                  span: parameter.span,
                })),
                ...declaration.fields.filter((field) => !field.static).map((field) => ({
                  name: field.name,
                  mutable: field.mutable,
                  type: this.resolveValidatedExternAnnotation(field.type, statement.source, classNames),
                  span: field.span,
                })),
              ];
              for (const field of ownFields) {
                if (this.findMethod(base, field.name) || this.findGetter(base, field.name)) {
                  this.typeError(`Extern field '${field.name}' conflicts with an inherited executable member`, field.span);
                }
                const inherited = this.findField(base, field.name);
                if (inherited && (inherited.mutable !== field.mutable || !sameType(inherited.type, field.type))) {
                  this.typeError(`Inherited extern field '${field.name}' must keep its ${inherited.mutable ? "let" : "const"} ${describeType(inherited.type)} contract`, field.span);
                }
              }
              for (const getter of declaration.getters.filter((item) => !item.static)) {
                if (this.findField(base, getter.name) || this.findMethod(base, getter.name)) {
                  this.typeError(`Extern getter '${getter.name}' conflicts with an inherited field or method`, getter.span);
                }
                const inherited = this.findGetter(base, getter.name);
                const own = this.resolveValidatedExternAnnotation(getter.type, statement.source, classNames);
                if (inherited && !sameType(inherited.type, own)) {
                  this.typeError(`Extern getter override '${getter.name}' must keep the base result ${describeType(inherited.type)}`, getter.span);
                }
              }
              for (const method of declaration.methods.filter((item) => !item.static)) {
                if (this.findField(base, method.name) || this.findGetter(base, method.name)) {
                  this.typeError(`Extern method '${method.name}' conflicts with an inherited field or getter`, method.span);
                }
                const inherited = this.findMethod(base, method.name);
                const own = this.externFunctionType(method, (reference) => this.resolveValidatedExternAnnotation(reference, statement.source, classNames));
                if (inherited && !sameTypeIgnoringCallableParameterNames(inherited.type, own)) {
                  this.typeError(`Extern override '${method.name}' must keep the base method signature ${describeType(inherited.type)}`, method.span);
                }
              }
            }
          }
        }
        for (const declaration of statement.functions) {
          this.checkTypeParameterDeclarations(declaration.typeParameters);
          this.withTypeParameterFrame(this.typeParameterFrame(declaration.typeParameters), () => {
            for (const parameter of declaration.parameters) {
              const classNames = new Set(statement.classes.map((item) => item.name));
              const type = this.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames);
              const valid = !parameter.type || !this.invalidExternTypeReferences.has(parameter.type);
              if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
            }
            const classNames = new Set(statement.classes.map((item) => item.name));
            const result = this.resolveValidatedExternAnnotation(declaration.returnType, statement.source, classNames);
            if (declaration.returnType) {
              const valid = !this.invalidExternTypeReferences.has(declaration.returnType);
              if (valid && declaration.asynchronous && this.asyncResultContainsPromise(result)) {
                this.diagnostics.push(diagnostic("VEL4018", "An async result annotation names the resolved value; write '-> T', not '-> Promise<T>'", declaration.returnType.span));
              } else if (valid) {
                if (declaration.asynchronous) this.reportPromiseResolutionHazard(result, declaration.returnType.span);
                else this.reportPromiseCarrierHazard(result, declaration.returnType.span);
              }
            }
          });
        }
        break;
      case "TypeDeclaration":
        // Shapes are only registered from module scope (registerTypeShapes
        // walks program.body), so a nested declaration would analyze against
        // a missing — or worse, a same-named module-level — shape.
        if (this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "Types can only be declared at module scope", statement.span));
        }
        this.analyzeTypeDeclaration(statement);
        break;
      case "TypeAliasDeclaration":
        if (this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "Types can only be declared at module scope", statement.span));
        }
        this.analyzeTypeAliasDeclaration(statement);
        break;
      case "EnumDeclaration": {
        if (this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "Enums can only be declared at module scope", statement.span));
        }
        const seen = new Set<string>();
        const serializedValues = new Map<string, string>();
        for (const member of statement.members) {
          if (member.name === "is" || member.name === "parse" || member.name === "values") {
            this.diagnostics.push(diagnostic("VEL4014", `Enum member '${member.name}' is reserved for the enum's runtime surface (is, parse, values)`, member.span));
          }
          if (member.name === "prototype" || member.name === "__proto__") {
            this.diagnostics.push(diagnostic("VEL4014", `Enum member '${member.name}' is unavailable because VelarScript does not expose prototype manipulation`, member.span));
          }
          if (seen.has(member.name)) {
            this.diagnostics.push(diagnostic("VEL4014", `Enum member '${member.name}' is declared more than once`, member.span));
          }
          seen.add(member.name);
          const previous = serializedValues.get(member.value);
          if (previous && previous !== member.name) {
            this.diagnostics.push(diagnostic(
              "VEL4014",
              `Enum members '${previous}' and '${member.name}' cannot share the runtime value ${JSON.stringify(member.value)}`,
              member.valueSpan ?? member.span,
            ));
          } else {
            serializedValues.set(member.value, member.name);
          }
        }
        break;
      }
      case "ClassDeclaration":
        // registerClassShapes only walks program.body, so a nested class body
        // would be analyzed against the module-level shape of the same name
        // (silent wrong types) and `export class` in a block emits invalid
        // JavaScript.
        if (this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "Classes can only be declared at module scope", statement.span));
        }
        this.analyzeClassDeclaration(statement);
        break;
      case "VariableDeclaration": {
        // MOD-D1: `export const`/`export let` below module scope emitted an
        // `export` statement inside a block — invalid JavaScript.
        if (statement.exported && this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "Exports can only be declared at module scope", statement.span));
        }
        const annotated = statement.type ? this.resolveAnnotation(statement.type) : null;
        const annotationValid = statement.type ? this.validateTypeReference(statement.type) : true;
        const aliasedBinding = !annotated && statement.initializer.kind === "IdentifierExpression"
          ? this.lookup(statement.initializer.name)
          : null;
        const actual = this.inferExpression(statement.initializer, annotationValid ? annotated ?? unknownType : invalidType);
        if (statement.exported && !statement.type && statement.pattern.kind === "NameBindingPattern"
          && statement.initializer.kind === "CallExpression"
          && statement.initializer.callee.kind === "IdentifierExpression"
          && statement.initializer.callee.name === "computed"
          && !this.lookup("computed")) {
          this.diagnostics.push(diagnostic(
            "VEL4025",
            `Exported computed accessors need an explicit contract at the export boundary; write 'export const ${statement.pattern.name}: () -> T = computed(...)'`,
            statement.span,
          ));
        }
        // D44 rule 71: an unannotated alias of an assignment-established fact
        // declares the source's domain and re-establishes the fact below, so
        // the alias keeps the declared question testable (`taken != null`
        // stays a real check) while reads still see the refined type.
        const aliasSource = !annotated ? this.assignedFactDomain(statement.initializer, actual) : actual;
        const inferredStorage = statement.binding === "let" && !annotated
          ? this.widenAggregateSingleton(aliasSource)
          : aliasSource;
        const declared = annotationValid ? annotated ?? inferredStorage : invalidType;
        const contract = annotationValid ? annotated ?? inferredStorage : invalidType;
        if (annotationValid) this.requireAssignable(actual, declared, statement.initializer.span);
        this.declarePattern(statement.pattern, statement.binding === "let", declared, contract);
        this.validateKnownBindingShape(statement.pattern, statement.initializer);
        // D44 rule 71: the initializer's type is a fact for each declared
        // binding — `const x: string? = "a"` reads as string until a write
        // says otherwise.
        if (annotationValid) this.establishAssignedPatternFacts(statement.pattern, actual);
        if (statement.pattern.kind === "NameBindingPattern") {
          const binding = this.scopes.at(-1)?.get(statement.pattern.name);
          if (binding?.span.start === statement.pattern.span.start && binding.span.end === statement.pattern.span.end) {
            if (!annotated) {
              const aliasedGroup = aliasedBinding ? this.collectionInferenceGroups.get(aliasedBinding) : null;
              if (aliasedGroup) this.joinCollectionInference(statement.pattern.name, binding, aliasedGroup);
              else if (this.isFreshUnresolvedCollection(statement.initializer, declared)) {
                this.joinCollectionInference(statement.pattern.name, binding, this.createCollectionInference(declared));
              }
            }
          }
        }
        break;
      }
      case "UsingDeclaration":
        this.analyzeUsingDeclaration(statement);
        break;
      case "TestDeclaration":
        this.analyzeTestDeclaration(statement);
        break;
      case "FunctionDeclaration":
        // MOD-D1: `export def` below module scope emitted invalid JavaScript.
        if (statement.exported && this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "Exports can only be declared at module scope", statement.span));
        }
        // D39 item 53: one spelling. `def test_*` discovery is retired, so the
        // name that used to mean "this is a test" gets pointed at the block.
        if (statement.name.startsWith("test_") && this.scopes.length === 1 && (this.modulePath ?? "").endsWith(".test.vel")) {
          this.diagnostics.push(diagnostic(
            "VEL3019",
            `Write 'test "${statement.name.slice("test_".length).replaceAll("_", " ")}":' and move the body into it; a test's name is a sentence the owner reads, and 'def test_*' discovery is retired`,
            statement.signatureSpan,
          ));
        }
        this.analyzeFunctionDeclaration(statement, null);
        break;
      case "ReturnStatement": {
        if (this.constructorDepth > 0) {
          this.diagnostics.push(diagnostic("VEL3014", "'return' cannot be used directly in a constructor", statement.span));
          break;
        }
        if (this.functionDepth === 0) {
          this.diagnostics.push(diagnostic("VEL3003", "'return' can only be used inside a function", statement.span));
          break;
        }
        if (this.finallyLoopDepths.length > 0) {
          this.diagnostics.push(diagnostic("VEL3015", "'return' cannot leave a finally block; assign a result before finally and return afterward", statement.span));
        }
        const returnContext = this.returnContexts.at(-1);
        const expected = returnContext?.expected ?? unknownType;
        const inferredReturns = returnContext?.inferredReturns ?? null;
        const actual = statement.value ? this.inferExpression(statement.value, inferredReturns ? unknownType : expected) : nullType;
        const asynchronous = this.asynchronousFunctions.at(-1) === true;
        const returned = asynchronous ? this.resolvedAsyncResult(actual) : actual;
        if (asynchronous && statement.value) {
          if (inferredReturns || !this.promiseResolutionHazard(expected)) {
            this.reportPromiseResolutionHazard(returned, statement.value.span);
          }
          if (this.promiseResolutionNeedsRuntimeGuard(returned)) {
            this.asyncResolvedValues.add(spanIdentity(statement.value.span));
          }
        }
        if (inferredReturns) {
          if (this.unreachableDiagnosticDepth === 0) inferredReturns.push(returned);
          break;
        }
        this.requireAssignable(returned, expected, statement.value?.span ?? statement.span);
        break;
      }
      case "ThrowStatement": {
        const thrown = this.inferExpression(statement.value);
        const throwable = (type: ValueType): boolean => type.kind === "class"
          ? this.isSubclassOf(type.identity ?? type.name, "Error")
          : type.kind === "union" && type.members.every(throwable);
        if (!throwable(thrown) && !isInvalidType(thrown)) {
          this.typeError(`Only Error values can be thrown, received ${describeType(thrown)}`, statement.value.span);
        }
        break;
      }
      case "AssertStatement": {
        const condition = this.inferExpression(statement.condition);
        this.requireCondition(condition, statement.condition);
        if (statement.message) {
          const baseline = this.snapshotFlowFacts();
          this.analyzeIsolatedFlow(baseline, () => {
            const message = this.inferNarrowedExpression(
              statement.message!,
              this.negativeNarrowingFor(statement.condition, condition),
              stringType,
            );
            this.requireAssignable(message, stringType, statement.message!.span);
          });
        }
        this.persistNarrowings(this.narrowingFor(statement.condition, condition));
        break;
      }
      case "IfStatement": {
        const condition = this.inferExpression(statement.condition);
        this.requireCondition(condition, statement.condition);
        const truthy = this.narrowingFor(statement.condition, condition);
        const falsy = this.negativeNarrowingFor(statement.condition, condition);
        const baseline = this.snapshotFlowFacts();
        const continuingInvalidations: FlowFactInvalidations[] = [];
        let thenFacts: ReadonlyMap<string, ValueType> = new Map();
        const thenInvalidations = this.analyzeIsolatedFlow(baseline, () => {
          thenFacts = this.analyzeBlock(statement.thenBody, truthy);
        });
        // A branch ending in return/throw never rejoins this flow; a branch
        // ending in break/continue never reaches the statement after the if
        // either — its writes are carried to the enclosing loop's merge points
        // by the break/continue capture instead.
        const thenExits = this.blockAlwaysExits(statement.thenBody);
        if (!thenExits) continuingInvalidations.push(thenInvalidations);
        let elseFacts: ReadonlyMap<string, ValueType> = new Map();
        let elseExits = false;
        if (statement.elseBody) {
          const elseInvalidations = this.analyzeIsolatedFlow(baseline, () => {
            elseFacts = this.analyzeBlock(statement.elseBody!, falsy);
          });
          elseExits = this.blockAlwaysExits(statement.elseBody);
          if (!elseExits) continuingInvalidations.push(elseInvalidations);
        }
        this.applyFlowInvalidations(continuingInvalidations, !statement.elseBody);
        if (!statement.elseBody && thenExits) this.persistNarrowings(falsy);
        else if (statement.elseBody && thenExits && !elseExits) this.persistNarrowings(elseFacts);
        else if (statement.elseBody && elseExits && !thenExits) this.persistNarrowings(thenFacts);
        else if (statement.elseBody && !thenExits && !elseExits) {
          this.persistNarrowings(this.commonNarrowings([thenFacts, elseFacts]));
        }
        break;
      }
      case "MatchStatement": {
        const matched = this.inferExpression(statement.value);
        if (matched.kind === "unknown" && !isInvalidType(matched)) {
          this.typeError("Validate an unknown value before matching it", statement.value.span);
        }
        const flowBaseline = this.snapshotFlowFacts();
        const visibleAtMatch = this.visibleBindings();
        const continuingInvalidations: FlowFactInvalidations[] = [];
        const continuingFacts: ReadonlyMap<string, ValueType>[] = [];
        const fallthroughInvalidations: FlowFactInvalidations[] = [];
        const coveredValues = new Set<string>();
        const coveredEnumMembers = new Set<string>();
        const guardedEnumMembers = new Set<string>();
        const coveredTypes: ValueType[] = [];
        const coveredListLengths = new Set<number>();
        let coveredListMinimum: number | null = null;
        let universalCovered = false;
        let fallthroughType = matched;
        let fallthroughNarrowings = this.matchLocationNarrowing(statement.value, matched);
        for (const branch of statement.cases) {
          const branchReachable = !universalCovered;
          if (!branchReachable) {
            this.diagnostics.push(diagnostic("VEL4014", "This match branch is already covered", branch.pattern.span));
          }
          const bindings = new Map<string, { readonly type: ValueType; readonly span: Span }>();
          let patternNarrowings: ReadonlyMap<string, ValueType> = new Map();
          let patternSurviving: ReadonlyMap<string, ValueType> = new Map();
          const patternBaseline = this.flowSnapshotAfterInvalidations(flowBaseline, fallthroughInvalidations);
          const patternInvalidations = this.analyzeIsolatedFlow(patternBaseline, () => {
            this.enterScope();
            try {
              this.applyNarrowings(fallthroughNarrowings, branch.pattern.span);
              const narrowedMatch = this.analyzeMatchPattern(branch.pattern, fallthroughType, bindings);
              patternSurviving = this.survivingNarrowings(fallthroughNarrowings);
              patternNarrowings = this.combineNarrowings(
                patternSurviving,
                this.matchLocationNarrowing(statement.value, narrowedMatch),
              );
            } finally {
              this.exitScope();
            }
          });
          if (branchReachable) fallthroughInvalidations.push(patternInvalidations);
          const rootPattern = this.unwrapMatchAs(branch.pattern);
          if (rootPattern.kind === "MatchValuePattern") {
            for (const value of rootPattern.values) {
              const key = this.matchValueKey(value);
              if (!branch.guard && coveredValues.has(key)) {
                this.diagnostics.push(diagnostic("VEL4013", `Match value '${this.matchValueDisplay(value)}' is declared more than once`, value.span));
              }
              if (!branch.guard) coveredValues.add(key);
              const valueType = this.inferredExpressionTypes.get(spanIdentity(value.span));
              if (!branch.guard && valueType?.kind === "enumMember") {
                coveredEnumMembers.add(this.enumMemberCoverageKey(valueType.identity, valueType.member));
              }
              if (branch.guard && valueType?.kind === "enumMember") {
                guardedEnumMembers.add(this.enumMemberCoverageKey(valueType.identity, valueType.member));
              }
            }
          } else if (rootPattern.kind === "MatchTypePattern") {
            const checked = this.resolveAnnotation(rootPattern.type);
            if (!branch.guard && !typeContainsParameter(checked) && !this.runtimeTypeCheckMayExecute(fallthroughType, checked)) {
              if (coveredTypes.some((covered) => isAssignable(checked, covered, this))) {
                this.diagnostics.push(diagnostic("VEL4014", `Type pattern ${describeType(checked)} is already covered`, rootPattern.span));
              }
              coveredTypes.push(checked);
              // ENM-I5: a parenthesized singleton pattern `case (S.a):` is a
              // type pattern of enumMember kind; it matches exactly that
              // member, so it counts toward member coverage.
              this.creditEnumMemberCoverage(checked, coveredEnumMembers);
              if (this.matchPatternCoversWholeType(rootPattern, matched)) universalCovered = true;
            }
          } else if (rootPattern.kind === "MatchWildcardPattern" && !branch.guard) {
            universalCovered = true;
          } else if (rootPattern.kind === "MatchListPattern" && !branch.guard
            && rootPattern.elements.every((element) => this.matchPatternIsIrrefutable(element))
            && !this.matchPatternReflectionMayExecute(rootPattern, fallthroughType)) {
            if (rootPattern.rest) {
              coveredListMinimum = coveredListMinimum === null
                ? rootPattern.elements.length
                : Math.min(coveredListMinimum, rootPattern.elements.length);
            } else {
              coveredListLengths.add(rootPattern.elements.length);
            }
          } else if (rootPattern.kind === "MatchObjectPattern" && !branch.guard) {
            for (const candidate of this.matchObjectCandidates(matched)) {
              if (candidate.kind !== "any" && this.matchPatternCoversType(rootPattern, candidate)
                && !coveredTypes.some((covered) => sameType(covered, candidate))) {
                coveredTypes.push(candidate);
              }
            }
          }
          if (!branch.guard && !universalCovered && this.matchTypeFullyCovered(
            matched,
            coveredTypes,
            coveredValues,
            coveredEnumMembers,
            coveredListLengths,
            coveredListMinimum,
          )) {
            universalCovered = true;
          }

          let guardNarrowings: ReadonlyMap<string, ValueType> = new Map();
          let guardFallthroughNarrowings: ReadonlyMap<string, ValueType> = patternSurviving;
          if (branch.guard) {
            const patternAlwaysMatches = this.matchPatternCoversWholeType(rootPattern, fallthroughType);
            const guardBaseline = this.flowSnapshotAfterInvalidations(flowBaseline, fallthroughInvalidations);
            const guardInvalidations = this.analyzeIsolatedFlow(guardBaseline, () => {
              this.enterScope();
              try {
                for (const [name, binding] of bindings) {
                  this.declareBinding(name, false, binding.type, binding.span);
                }
                const guard = this.inferConditionWithNarrowings(branch.guard!, patternNarrowings);
                guardNarrowings = this.combineNarrowings(guard.surviving, guard.truthy);
                const surviving = this.retargetNarrowings(guard.surviving, fallthroughType);
                guardFallthroughNarrowings = patternAlwaysMatches
                  ? this.combineNarrowings(surviving, guard.falsy)
                  : surviving;
              } finally {
                this.exitScope();
              }
            });
            if (branchReachable) fallthroughInvalidations.push(guardInvalidations);
          }

          const bodyBaseline = this.flowSnapshotAfterInvalidations(flowBaseline, fallthroughInvalidations);
          let branchFacts: ReadonlyMap<string, ValueType> = new Map();
          const branchInvalidations = this.analyzeIsolatedFlow(bodyBaseline, () => {
            this.enterScope();
            try {
              for (const [name, binding] of bindings) {
                this.declareBinding(name, false, binding.type, binding.span);
              }
              this.applyNarrowings(branch.guard ? guardNarrowings : patternNarrowings, branch.body[0]?.span ?? branch.span);
              this.analyzeStatements(branch.body);
              branchFacts = this.narrowingsForVisibleBindings(visibleAtMatch);
            } finally {
              this.exitScope();
            }
          });
          if (branchReachable && !this.blockAlwaysExits(branch.body)) {
            continuingInvalidations.push(...fallthroughInvalidations, branchInvalidations);
            continuingFacts.push(branchFacts);
          }
          if (branchReachable) {
            if (branch.guard) {
              fallthroughNarrowings = guardFallthroughNarrowings;
            } else {
              fallthroughType = this.matchFallthroughType(fallthroughType, rootPattern);
              fallthroughNarrowings = this.combineNarrowings(
                patternSurviving,
                this.matchLocationNarrowing(statement.value, fallthroughType),
              );
            }
          }
        }
        const exhaustive = universalCovered || this.matchTypeFullyCovered(
          matched,
          coveredTypes,
          coveredValues,
          coveredEnumMembers,
          coveredListLengths,
          coveredListMinimum,
        );
        const enumSubject = this.enumMatchSubject(matched);
        if (exhaustive) {
          this.exhaustiveMatches.add(statement.span.start);
        } else if (enumSubject !== null) {
          // ENM-I6: an optional enum subject carries the same exhaustiveness
          // contract as the bare enum — every member plus `case null`.
          const target = enumSubject.target;
          const missing = [...(this.enums.get(target.identity)?.members ?? this.enums.get(target.name)?.members ?? [])]
            .filter((member) => !coveredEnumMembers.has(this.enumMemberCoverageKey(target.identity, member)));
          const guarded = missing.filter((member) => guardedEnumMembers.has(this.enumMemberCoverageKey(target.identity, member)));
          if (enumSubject.optional && !coveredValues.has("null")) missing.push("null");
          if (missing.length > 0) {
            const note = guarded.length > 0
              ? "; a guarded case matches only when its condition holds, so it does not count — add an unguarded case or 'case _:'"
              : "";
            this.diagnostics.push(diagnostic("VEL4015", `Match on ${describeType(matched)} is missing: ${missing.join(", ")}${note}`, statement.span));
          }
        } else if (!isInvalidType(matched)) {
          // D45 rule 77: a match over a class (or a union containing one) must
          // be provably exhaustive, exactly as strict as the enum rule. A
          // subclass instance still satisfies its base pattern, so a base (or
          // wildcard) tail proves it; an extern class check may fail at
          // runtime, so only the wildcard proves an extern subject.
          const expandedSubject = this.expandAliases(matched);
          const classArms = this.classArmsOf(expandedSubject);
          if (classArms.length > 0) {
            const closing = expandedSubject.kind === "class" && !(expandedSubject.identity ?? expandedSubject.name).startsWith("js:")
              ? `end with 'case ${expandedSubject.name}:' or 'case _:'`
              : expandedSubject.kind === "class"
                ? "end with 'case _:'"
                : "cover every member or end with 'case _:'";
            this.diagnostics.push(diagnostic(
              "VEL4015",
              `Match on ${describeType(matched)} is missing a fallback; class hierarchies are open — ${closing}`,
              statement.span,
            ));
          }
        }
        if (!exhaustive) {
          const unmatched = this.flowSnapshotAfterInvalidations(flowBaseline, fallthroughInvalidations);
          continuingInvalidations.push(...fallthroughInvalidations);
          continuingFacts.push(this.combineNarrowings(
            this.narrowingsInSnapshot(unmatched, visibleAtMatch, flowBaseline),
            fallthroughNarrowings,
          ));
        }
        this.restoreFlowFacts(flowBaseline);
        this.applyFlowInvalidations(continuingInvalidations);
        if (continuingFacts.length > 0) {
          this.persistNarrowings(this.commonNarrowings(continuingFacts));
        }
        break;
      }
      case "ForStatement": {
        // The emitted loop head evaluates the iterable inside the loop
        // binding's temporal dead zone, so an iterable reference to a name
        // the pattern declares cannot reach the outer binding the analyzer
        // resolves. The names are pending only while the iterable is
        // inferred: the loop binding owns its name in the loop head and
        // body alone, so earlier statements of the same scope still read
        // the outer binding.
        const pendingLoopNames: string[] = [];
        {
          const pending = this.pendingScopeDeclarations.at(-1)!;
          for (const pattern of [statement.pattern, statement.secondPattern]) {
            if (!pattern) continue;
            this.collectPatternNames(pattern, (name) => {
              if (!pending.has(name)) {
                pending.set(name, { span: pattern.span, loopHead: true });
                pendingLoopNames.push(name);
              }
            });
          }
        }
        const iterable = this.inferExpression(statement.iterable);
        for (const name of pendingLoopNames) this.pendingScopeDeclarations.at(-1)!.delete(name);
        let first: ValueType;
        let second: ValueType;
        if (statement.asynchronous) {
          const invalidConstructorAwait = this.constructorDepth > 0;
          const invalidFunctionAwait = this.functionDepth > 0 && !this.asynchronousFunctions.at(-1);
          const invalidExtensionAwait = this.functionDepth === 0 && this.invalidExtensionAwaitContext();
          if (invalidConstructorAwait || invalidFunctionAwait || invalidExtensionAwait) {
            this.diagnostics.push(diagnostic(
              "VEL4007",
              invalidConstructorAwait
                ? "'async for' cannot be used directly in a constructor"
                : invalidExtensionAwait
                ? this.invalidExtensionAwaitMessage() ?? "'async for' is not valid in this synchronous extension context"
                : "'async for' can only be used in an async function or at module scope",
              statement.span,
            ));
          }
          first = this.asyncPullElementType(iterable, statement.iterable.span);
          second = numberType;
          this.asyncForStatements.add(statement.span.start);
        } else {
          first = iterable.kind === "list" || iterable.kind === "set"
            ? iterable.readonlyView ? this.readonlyDataViewOf(iterable.element) : iterable.element
            : iterable.kind === "map" ? iterable.readonlyView ? this.readonlyDataViewOf(iterable.key) : iterable.key
              : iterable.kind === "record" || iterable.kind === "string" ? stringType : unknownType;
          second = iterable.kind === "map" || iterable.kind === "record"
            ? iterable.readonlyView ? this.readonlyDataViewOf(iterable.value) : iterable.value
            : iterable.kind === "list" || iterable.kind === "set" || iterable.kind === "string" ? numberType
              : unknownType;
          if (iterable.kind !== "list" && iterable.kind !== "set" && iterable.kind !== "map" && iterable.kind !== "record" && iterable.kind !== "string" && iterable.kind !== "any") {
            this.typeError(iterable.kind === "enumObject"
              ? `Cannot iterate over the enum itself; ${iterable.name}.values() returns the members as a List — for member in ${iterable.name}.values():`
              : `Cannot iterate over ${describeType(iterable)}`, statement.iterable.span);
          }
        }
        const baseline = this.snapshotFlowFacts();
        this.loopFlowContexts.push({ baseline, carried: [], backEdges: [], sawBreak: false });
        const diagnosticStart = this.diagnostics.length;
        const bodyInvalidations = this.analyzeIsolatedFlow(baseline, () => {
          this.enterScope();
          try {
            this.declarePattern(statement.pattern, false, first);
            if (statement.secondPattern) this.declarePattern(statement.secondPattern, false, second);
            if (!statement.asynchronous && statement.iterable.kind === "ListExpression"
              && statement.iterable.elements.every((item) => item.kind !== "SpreadExpression")) {
              for (const item of statement.iterable.elements) {
                this.validateKnownBindingShape(statement.pattern, item);
              }
            }
            this.loopDepth += 1;
            this.analyzeStatements(statement.body);
            this.loopDepth -= 1;
          } finally {
            this.exitScope();
          }
        });
        const loopFlow = this.loopFlowContexts.pop()!;
        const backEdges = [
          ...(!this.blockAlwaysExits(statement.body) ? [bodyInvalidations] : []),
          ...loopFlow.backEdges,
        ];
        this.reanalyzeLoopBackEdge(baseline, backEdges, statement.body, diagnosticStart, () => {
          this.enterScope();
          try {
            this.declarePattern(statement.pattern, false, first);
            if (statement.secondPattern) this.declarePattern(statement.secondPattern, false, second);
            if (!statement.asynchronous && statement.iterable.kind === "ListExpression"
              && statement.iterable.elements.every((item) => item.kind !== "SpreadExpression")) {
              for (const item of statement.iterable.elements) {
                this.validateKnownBindingShape(statement.pattern, item);
              }
            }
            this.loopDepth += 1;
            this.analyzeStatements(statement.body);
            this.loopDepth -= 1;
          } finally {
            this.exitScope();
          }
        });
        if (this.blockAlwaysReturns(statement.body)) this.applyFlowInvalidations(loopFlow.carried);
        else this.applyFlowInvalidations([bodyInvalidations, ...loopFlow.carried]);
        break;
      }
      case "WhileStatement": {
        const condition = this.inferExpression(statement.condition);
        this.requireCondition(condition, statement.condition);
        const truthy = this.narrowingFor(statement.condition, condition);
        const falsy = this.negativeNarrowingFor(statement.condition, condition);
        const baseline = this.snapshotFlowFacts();
        this.loopFlowContexts.push({ baseline, carried: [], backEdges: [], sawBreak: false });
        const diagnosticStart = this.diagnostics.length;
        const bodyInvalidations = this.analyzeIsolatedFlow(baseline, () => {
          this.loopDepth += 1;
          this.analyzeBlock(statement.body, truthy);
          this.loopDepth -= 1;
        });
        const loopFlow = this.loopFlowContexts.pop()!;
        const backEdges = [
          ...(!this.blockAlwaysExits(statement.body) ? [bodyInvalidations] : []),
          ...loopFlow.backEdges,
        ];
        this.reanalyzeLoopBackEdge(baseline, backEdges, statement.body, diagnosticStart, () => {
          this.clearCachedFlowTypesInSpan(statement.condition.span);
          const repeatedCondition = this.inferExpression(statement.condition);
          this.requireCondition(repeatedCondition, statement.condition);
          const repeatedTruthy = this.narrowingFor(statement.condition, repeatedCondition);
          this.loopDepth += 1;
          this.analyzeBlock(statement.body, repeatedTruthy);
          this.loopDepth -= 1;
        });
        if (statement.condition.kind === "LiteralExpression"
          && statement.condition.value === true
          && !loopFlow.sawBreak) {
          this.nonFallthroughWhileStatements.add(statement.span.start);
        }
        if (this.blockAlwaysReturns(statement.body)) {
          // The loop can only be left through a captured break/continue arm or
          // by the condition failing, so only the carried writes escape it.
          this.applyFlowInvalidations(loopFlow.carried);
          if (!loopFlow.sawBreak) this.persistNarrowings(falsy);
        } else {
          this.applyFlowInvalidations([bodyInvalidations, ...loopFlow.carried]);
        }
        break;
      }
      case "BreakStatement":
      case "ContinueStatement":
        if (this.loopDepth === 0) {
          this.diagnostics.push(diagnostic("VEL3005", `'${statement.kind === "BreakStatement" ? "break" : "continue"}' can only be used in a loop`, statement.span));
        } else if (this.finallyLoopDepths.some((depth) => this.loopDepth <= depth)) {
          this.diagnostics.push(diagnostic("VEL3015", `'${statement.kind === "BreakStatement" ? "break" : "continue"}' cannot leave a finally block`, statement.span));
        } else {
          const context = this.loopFlowContexts.at(-1);
          if (context && this.loopFlowContexts.length > this.loopCaptureFloor) {
            const invalidations = this.flowInvalidationsSince(context.baseline);
            context.carried.push(invalidations);
            if (statement.kind === "ContinueStatement") context.backEdges.push(invalidations);
            if (statement.kind === "BreakStatement") context.sawBreak = true;
          }
        }
        break;
      case "TryStatement": {
        const baseline = this.snapshotFlowFacts();
        let tryFacts: ReadonlyMap<string, ValueType> = new Map();
        const tryInvalidations = this.analyzeIsolatedFlow(baseline, () => {
          tryFacts = this.analyzeBlock(statement.tryBody);
        });
        const continuingInvalidations: FlowFactInvalidations[][] = [];
        const continuingFacts: ReadonlyMap<string, ValueType>[] = [];
        if (!this.blockAlwaysReturns(statement.tryBody)) {
          continuingInvalidations.push([tryInvalidations]);
          continuingFacts.push(tryFacts);
        }

        let catchInvalidations: FlowFactInvalidations | null = null;
        if (statement.catchBody) {
          const catchBaseline = this.flowSnapshotAfterInvalidations(baseline, [tryInvalidations]);
          let catchFacts: ReadonlyMap<string, ValueType> = new Map();
          catchInvalidations = this.analyzeIsolatedFlow(catchBaseline, () => {
            const visible = this.visibleBindings();
            this.enterScope();
            try {
              if (statement.catchName) {
                this.declareBinding(statement.catchName, false, { kind: "class", name: "Error" }, statement.span);
              }
              this.analyzeStatements(statement.catchBody!);
              catchFacts = this.narrowingsForVisibleBindings(visible);
            } finally {
              this.exitScope();
            }
          });
          if (!this.blockAlwaysReturns(statement.catchBody)) {
            continuingInvalidations.push([tryInvalidations, catchInvalidations]);
            continuingFacts.push(catchFacts);
          }
        }

        if (statement.finallyBody) {
          const beforeFinally = this.flowSnapshotAfterInvalidations(
            baseline,
            catchInvalidations ? [tryInvalidations, catchInvalidations] : [tryInvalidations],
          );
          let finallyFacts: ReadonlyMap<string, ValueType> = new Map();
          const finallyInvalidations = this.analyzeIsolatedFlow(beforeFinally, () => {
            this.finallyLoopDepths.push(this.loopDepth);
            try {
              finallyFacts = this.analyzeBlock(statement.finallyBody!);
            } finally {
              this.finallyLoopDepths.pop();
            }
          });
          if (!this.blockAlwaysReturns(statement.finallyBody) && continuingFacts.length > 0) {
            this.restoreFlowFacts(beforeFinally);
            this.applyFlowInvalidations([finallyInvalidations]);
            this.persistNarrowings(finallyFacts);
          } else {
            this.restoreFlowFacts(baseline);
          }
        } else {
          this.restoreFlowFacts(baseline);
          this.applyFlowInvalidations(continuingInvalidations.flat());
          if (continuingFacts.length > 0) {
            this.persistNarrowings(this.commonNarrowings(continuingFacts));
          }
        }
        break;
      }
      case "PassStatement":
        break;
      case "AssignmentStatement":
        this.analyzeAssignment(statement);
        break;
      case "ExpressionStatement": {
        // D39 item 51: a bare `try` statement is a swallow nobody can see. The
        // result has to be consumed; deliberately ignoring a failure is
        // try/catch, which says so.
        if (statement.expression.kind === "TryExpression") {
          this.diagnostics.push(diagnostic(
            "VEL4034",
            "A 'try' result must be consumed — bind it, test it, or supply a fallback with '??'; to run something and ignore its failure on purpose, use a try/catch block",
            statement.span,
          ));
          // One mistake, one diagnostic: the generic discarded-result message
          // would repeat this in weaker words.
          this.inferExpression(statement.expression);
          break;
        }
        const type = this.inferExpression(statement.expression);
        this.checkFloatingPromiseStatement(type, statement.expression);
        this.checkDiscardedExpressionResult(statement.expression, type);
        this.checkDiscardedPureResult(statement.expression);
        break;
      }
      case "AsyncStatement":
        this.analyzeAsyncStatement(statement);
        break;
    }
  }

  // D32 item 30: a Promise-typed expression statement is a floating promise —
  // nothing waits for it and nothing owns its failure. The diagnostic teaches
  // both current spellings: 'await' waits, the 'async' statement detaches.
  private checkFloatingPromiseStatement(type: ValueType, expression: Expression): void {
    if (isInvalidType(type)) return;
    if (!this.carriesPromise(this.expandAliases(type))) return;
    const spelling = this.callSpelling(expression);
    this.diagnostics.push(diagnostic(
      "VEL4027",
      spelling
        ? `This call returns ${describeType(type)}; 'await ${spelling}' to wait for it, or 'async ${spelling}' to run it detached`
        : `This expression is ${describeType(type)}; 'await' it to wait for it, or prefix it with 'async' to run it detached`,
      expression.span,
    ));
  }

  // D30 item 17: the only general expression statements are shapes whose top
  // level may perform an effect. A call remains legal (D29 separately rejects
  // compiler-proven pure methods), and `await` owns asynchronous completion.
  // Every other result is a likely `=`/`==` typo, a Python docstring reflex,
  // or a value accidentally left on its own line.
  private checkDiscardedExpressionResult(expression: Expression, type: ValueType): void {
    if (isInvalidType(type) || this.carriesPromise(this.expandAliases(type))
      || expression.kind === "CallExpression" || expression.kind === "AssignmentExpression") return;
    if (expression.kind === "UnaryExpression" && expression.operator === "await") return;
    let message: string;
    if (expression.kind === "LiteralExpression" && typeof expression.value === "string") {
      message = "A bare string is not a docstring; use '//' for a comment, or use the string value";
    } else if (expression.kind === "ComparisonChainExpression"
      || expression.kind === "IsExpression"
      || (expression.kind === "BinaryExpression"
        && (expression.operator === "==" || expression.operator === "!=" || expression.operator === "<"
          || expression.operator === "<=" || expression.operator === ">" || expression.operator === ">="
          || expression.operator === "in" || expression.operator === "not in"))) {
      message = "This comparison result is discarded; use '=' to assign, or use the result";
    } else if (expression.kind === "UnaryExpression"
      && (expression.operator === "+" || expression.operator === "-")
      && expression.operand.kind === "UnaryExpression"
      && expression.operand.operator === expression.operator
      && expression.operand.operand.kind === "IdentifierExpression") {
      message = expression.operator === "+"
        ? `VelarScript has no '++' operator; write '${expression.operand.operand.name} += 1'`
        : `VelarScript has no '--' operator; write '${expression.operand.operand.name} -= 1'`;
    } else {
      message = "This expression result is discarded; call a function, assign the value, or use the result";
    }
    this.diagnostics.push(diagnostic("VEL4030", message, expression.span));
  }

  private carriesPromise(type: ValueType): boolean {
    if (type.kind === "promise") return true;
    if (type.kind === "optional") return this.carriesPromise(this.expandAliases(type.inner));
    if (type.kind === "union") return type.members.some((member) => this.carriesPromise(this.expandAliases(member)));
    return false;
  }

  // D29 item 14: an expression statement whose top level calls a
  // compiler-owned pure value/collection method throws its only product away.
  // The operation tables already prove which method the call lowered to, so
  // the check needs no user-function purity analysis.
  private checkDiscardedPureResult(expression: Expression): void {
    if (expression.kind !== "CallExpression" || expression.callee.kind !== "MemberExpression") return;
    const collectionOperation = this.collectionCalls.get(expression.callee.span.end);
    const primitiveOperation = this.primitiveCalls.get(expression.callee.span.end);
    const pure = (collectionOperation !== undefined && discardedPureCollectionOperations.has(collectionOperation))
      || (primitiveOperation !== undefined && discardedPurePrimitiveOperations.has(primitiveOperation));
    if (!pure) return;
    this.diagnostics.push(diagnostic(
      "VEL4029",
      `'${expression.callee.property}' does not modify its receiver, so the result is discarded; keep the returned value or remove the call`,
      expression.span,
    ));
  }

  // Reconstructs a call spelling such as "boom()" or "user.save(...)" for the
  // floating-promise teaching message; complex callees use generic phrasing.
  private callSpelling(expression: Expression): string | null {
    if (expression.kind !== "CallExpression") return null;
    const path = (value: Expression): string | null => {
      if (value.kind === "IdentifierExpression") return value.name;
      if (value.kind === "MemberExpression") {
        const object = path(value.object);
        return object === null ? null : `${object}${value.optional ? "?." : "."}${value.property}`;
      }
      return null;
    };
    const callee = path(expression.callee);
    return callee === null ? null : `${callee}(${expression.arguments.length > 0 ? "..." : ""})`;
  }

  // D32 item 30: 'async <expression>' runs detached, so only Promise<null>
  // may detach — a non-null resolved value would be lost silently, and a
  // non-Promise value has nothing to detach.
  private analyzeAsyncStatement(statement: AsyncStatement): void {
    const type = this.inferExpression(statement.expression);
    if (isInvalidType(type)) return;
    const expanded = this.expandAliases(type);
    if (expanded.kind !== "promise") {
      this.diagnostics.push(diagnostic(
        "VEL4028",
        `'async' runs a Promise<null> expression detached; this expression is ${describeType(type)}`,
        statement.expression.span,
      ));
      return;
    }
    const resolved = this.expandAliases(expanded.value);
    if (resolved.kind === "null" || isInvalidType(resolved)) return;
    this.diagnostics.push(diagnostic(
      "VEL4028",
      "The result would be lost; await it, or discard it explicitly in an async def",
      statement.expression.span,
    ));
  }

  private analyzeTypeDeclaration(statement: TypeDeclaration): void {
    if (!this.predeclared.has(statement)) this.declareBinding(statement.name, false, { kind: "typeObject", name: statement.name }, statement.span);
    const seen = new Set<string>();
    for (const field of statement.fields) {
      if (seen.has(field.name)) {
        this.diagnostics.push(diagnostic("VEL4004", `Type '${statement.name}' declares '${field.name}' more than once`, field.span));
      }
      seen.add(field.name);
    }
  }

  private analyzeTypeAliasDeclaration(statement: TypeAliasDeclaration): void {
    if (!this.predeclared.has(statement)) this.declareBinding(statement.name, false, { kind: "typeObject", name: statement.name }, statement.span);
  }

  private analyzeClassDeclaration(statement: ClassDeclaration): void {
    const outerConstructorDepth = this.constructorDepth;
    const outerClass = this.currentClass;
    const outerSuperMemberContext = this.superMemberContext;
    const outerAllowedSuperCall = this.allowedSuperCall;
    this.constructorDepth = 0;
    this.allowedSuperCall = null;
    this.currentClass = statement.name;
    this.superMemberContext = null;
    for (const member of [...statement.fields, ...statement.getters, ...statement.methods]) {
      this.validateClassMemberName(member.name, member.span);
    }
    if (!this.predeclared.has(statement)) this.declareBinding(statement.name, false, { kind: "classConstructor", name: statement.name }, statement.span);
    const baseName = statement.base?.name ?? null;
    if (baseName) {
      const baseBinding = this.lookup(baseName) ?? this.builtin(baseName);
      if (baseName === "ValidationError" || baseName === "NarrowingError" || baseName === "IndexError") {
        // The compiler-raised error types are leaf contracts: user subclasses
        // would dilute what a caught ValidationError/NarrowingError/IndexError
        // proves. Extend Error for custom hierarchies.
        this.typeError(`The builtin error type '${baseName}' cannot be extended; extend Error and declare your own fields`, statement.base!.span);
      } else if (baseBinding?.type.kind !== "classConstructor" || !this.classes.has(baseName)) {
        this.typeError(`Unknown base class '${baseName}'`, statement.base!.span);
      } else if (baseName === statement.name || this.isSubclassOf(baseName, statement.name)) {
        this.typeError(`Class '${statement.name}' has a cyclic inheritance relationship`, statement.base!.span);
      } else {
        // `extends` evaluates the base when this class statement runs, so a
        // base declared later in the module would fail to load (CLS-D8).
        const baseDeclaredAt = this.hoistedClassDeclarations.get(baseBinding.storageBinding ?? baseBinding);
        if (baseDeclaredAt !== undefined && baseDeclaredAt > statement.span.start) {
          this.diagnostics.push(diagnostic(
            "VEL3001",
            `Class '${statement.name}' extends '${baseName}' before it is declared; move '${baseName}' above this class`,
            statement.base!.span,
          ));
        }
      }
    }

    this.enterScope();
    this.flowFrameDepth += 1;
    this.superMemberContext = "instance";
    for (const parameter of statement.parameters) {
      const type = this.resolveAnnotation(parameter.type);
      const valid = parameter.type ? this.validateTypeReference(parameter.type) : true;
      if (parameter.defaultValue && valid) {
        this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      }
      const declared = valid ? type : invalidType;
      this.declareBinding(parameter.name, false, parameter.rest ? { kind: "list", element: declared } : declared, parameter.span);
    }
    if (statement.base?.arguments.length) {
      this.typeError("Base constructor arguments belong in 'super(...)' inside the constructor", statement.base.span);
    }
    for (const field of statement.fields) {
      if (field.static) continue;
      const declared = this.resolveAnnotation(field.type);
      const valid = this.validateTypeReference(field.type);
      if (field.initializer) {
        this.classFieldInitializerDepth += 1;
        // Instance field initializers run per construction, not while the
        // module evaluates, so they are not module-initialization positions.
        this.instanceFieldInitializerDepth += 1;
        const actual = this.inferExpression(field.initializer, valid ? declared : invalidType);
        this.instanceFieldInitializerDepth -= 1;
        this.classFieldInitializerDepth -= 1;
        if (valid) this.requireAssignable(actual, declared, field.initializer.span);
      }
    }
    this.validateConstructorShape(statement);
    if (statement.initialization) this.analyzeClassInitialization(statement);
    if (statement.dispose) this.analyzeClassDispose(statement, statement.dispose);
    this.superMemberContext = null;
    this.flowFrameDepth -= 1;
    this.exitScope();
    const initializedStaticFields = new Set<string>();
    for (const field of statement.fields) {
      if (!field.static) continue;
      const declared = this.resolveAnnotation(field.type);
      const valid = this.validateTypeReference(field.type);
      if (!field.initializer) {
        this.typeError(`Static field '${field.name}' requires an initializer`, field.span);
        continue;
      }
      const outerStaticFieldInitialization = this.staticFieldInitialization;
      this.staticFieldInitialization = { className: statement.name, initialized: initializedStaticFields };
      this.superMemberContext = "static";
      this.classFieldInitializerDepth += 1;
      const actual = this.inferExpression(field.initializer, valid ? declared : invalidType);
      this.classFieldInitializerDepth -= 1;
      this.superMemberContext = null;
      this.staticFieldInitialization = outerStaticFieldInitialization;
      if (valid) this.requireAssignable(actual, declared, field.initializer.span);
      initializedStaticFields.add(field.name);
    }

    const ownFields = new Set<string>();
    const instanceFields = [
      ...statement.parameters.filter((parameter) => parameter.binding).map((parameter) => ({
        name: parameter.name,
        mutable: parameter.binding === "let",
        type: this.resolveAnnotation(parameter.type),
        span: parameter.span,
        private: parameter.private,
      })),
      ...statement.fields.filter((field) => !field.static).map((field) => ({
        name: field.name,
        mutable: field.binding === "let",
        type: this.resolveAnnotation(field.type),
        span: field.span,
        private: field.private,
      })),
    ];
    for (const field of instanceFields) {
      if (ownFields.has(field.name)) this.typeError(`Class '${statement.name}' declares field '${field.name}' more than once`, field.span);
      ownFields.add(field.name);
      const inheritedField = baseName ? this.findField(baseName, field.name) : null;
      const inheritedGetter = baseName ? this.findGetter(baseName, field.name) : null;
      const inheritedMethod = baseName ? this.findMethod(baseName, field.name) : null;
      if (field.private && (inheritedField || inheritedGetter || inheritedMethod)) {
        this.typeError(`Private field '${field.name}' conflicts with an inherited public member`, field.span);
        continue;
      }
      if (inheritedGetter || inheritedMethod) {
        this.typeError(`Field '${field.name}' conflicts with an inherited ${inheritedGetter ? "getter" : "method"}`, field.span);
      }
      if (inheritedField) {
        if (inheritedField.mutable !== field.mutable || !sameType(inheritedField.type, field.type)) {
          this.typeError(`Inherited field '${field.name}' must keep its ${inheritedField.mutable ? "let" : "const"} ${describeType(inheritedField.type)} contract`, field.span);
        }
      }
    }

    const ownStaticFields = new Set<string>();
    for (const field of statement.fields.filter((candidate) => candidate.static)) {
      if (ownStaticFields.has(field.name)) this.typeError(`Class '${statement.name}' declares static field '${field.name}' more than once`, field.span);
      ownStaticFields.add(field.name);
      const inheritedMethod = baseName ? this.findStaticMethod(baseName, field.name) : null;
      const inheritedGetter = baseName ? this.findStaticGetter(baseName, field.name) : null;
      const inheritedField = baseName ? this.findStaticField(baseName, field.name) : null;
      if (field.private && (inheritedField || inheritedGetter || inheritedMethod)) {
        this.typeError(`Private static field '${field.name}' conflicts with an inherited public static member`, field.span);
        continue;
      }
      if (inheritedGetter || inheritedMethod) this.typeError(`Static field '${field.name}' conflicts with an inherited static ${inheritedGetter ? "getter" : "method"}`, field.span);
      if (!field.private && inheritedField) this.typeError(`Static field '${field.name}' conflicts with an inherited static field; static fields cannot be overridden`, field.span);
    }

    const privateNames = new Set<string>();
    for (const member of [
      ...statement.parameters.filter((parameter) => parameter.private),
      ...statement.fields.filter((field) => field.private),
      ...statement.getters.filter((getter) => getter.private),
      ...statement.methods.filter((method) => method.private),
    ]) {
      if (privateNames.has(member.name)) {
        this.typeError(`Class '${statement.name}' declares private member '${member.name}' more than once`, member.span);
      }
      privateNames.add(member.name);
    }

    const ownGetterNames = new Set<string>();
    for (const getter of statement.getters) {
      const key = `${getter.static ? "static:" : "instance:"}${getter.name}`;
      if (ownGetterNames.has(key)) this.typeError(`Class '${statement.name}' declares getter '${getter.name}' more than once`, getter.span);
      ownGetterNames.add(key);
      if ((!getter.static && ownFields.has(getter.name)) || (getter.static && ownStaticFields.has(getter.name))) {
        this.typeError(`${getter.static ? "Static g" : "G"}etter '${getter.name}' conflicts with a field declared by class '${statement.name}'`, getter.span);
      }
      if (statement.methods.some((method) => method.name === getter.name && method.static === getter.static)) {
        this.typeError(`${getter.static ? "Static g" : "G"}etter '${getter.name}' conflicts with a method declared by class '${statement.name}'`, getter.span);
      }
      const inheritedField = baseName ? (getter.static ? this.findStaticField(baseName, getter.name) : this.findField(baseName, getter.name)) : null;
      const inheritedMethod = baseName ? (getter.static ? this.findStaticMethod(baseName, getter.name) : this.findMethod(baseName, getter.name)) : null;
      const inheritedGetter = baseName ? (getter.static
        ? this.findStaticGetter(baseName, getter.name)
        : this.findGetter(baseName, getter.name)) : null;
      const inheritedGetterType = getter.static
        ? inheritedGetter as ValueType | null
        : (inheritedGetter as { readonly type: ValueType } | null)?.type ?? null;
      if (getter.private && (inheritedField || inheritedMethod || inheritedGetter)) {
        this.typeError(`Private${getter.static ? " static" : ""} getter '${getter.name}' conflicts with an inherited public member`, getter.span);
      }
      if (!getter.private && (inheritedField || inheritedMethod)) {
        this.typeError(`Getter '${getter.name}' conflicts with an inherited ${inheritedField ? "field" : "method"}`, getter.span);
      }
      if (getter.abstract && !statement.abstract) {
        this.typeError(`Concrete class '${statement.name}' cannot declare abstract getter '${getter.name}'`, getter.span);
      }
      if (getter.abstract && getter.static) this.typeError(`Abstract getter '${getter.name}' cannot be static`, getter.span);
      if (getter.abstract && getter.override) this.typeError(`Abstract getter '${getter.name}' cannot also be an override`, getter.span);
      if (getter.private && getter.abstract) this.typeError(`Private getter '${getter.name}' cannot be abstract`, getter.span);
      if (getter.private && getter.override) this.typeError(`Private getter '${getter.name}' cannot use 'override'`, getter.span);
      if (!getter.private) {
        if (getter.override && !inheritedGetter) {
          this.typeError(`${getter.static ? "Static g" : "G"}etter '${getter.name}' uses 'override' but no base getter exists`, getter.span);
        } else if (!getter.override && inheritedGetter && !getter.abstract) {
          this.typeError(`${getter.static ? "Static g" : "G"}etter '${getter.name}' overrides a base getter and must use 'override'`, getter.span);
        }
        if (getter.override && inheritedGetterType && !sameType(this.resolveResult(getter.returnType), inheritedGetterType)) {
          this.typeError(`Getter override '${getter.name}' must keep the base result ${describeType(inheritedGetterType)}`, getter.span);
        }
      }
      if (getter.abstract) this.validateMethodSignature(getter);
      else this.analyzeFunctionDeclaration(getter, statement.name, true, !getter.static, false, "Getter");
    }

    const ownMethods = new Set<string>();
    for (const method of statement.methods) {
      if (!method.static && ownFields.has(method.name)) {
        this.typeError(`Method '${method.name}' conflicts with a field declared by class '${statement.name}'`, method.span);
      }
      if (method.static && ownStaticFields.has(method.name)) {
        this.typeError(`Static method '${method.name}' conflicts with a static field declared by class '${statement.name}'`, method.span);
      }
      if (!method.private && baseName && (method.static
        ? this.findStaticField(baseName, method.name) || this.findStaticGetter(baseName, method.name)
        : this.findField(baseName, method.name) || this.findGetter(baseName, method.name))) {
        this.typeError(`${method.static ? "Static m" : "M"}ethod '${method.name}' conflicts with an inherited ${method.static ? "static " : ""}field or getter`, method.span);
      }
      if (method.private && baseName && (method.static
        ? this.findStaticField(baseName, method.name) || this.findStaticGetter(baseName, method.name) || this.findStaticMethod(baseName, method.name)
        : this.findField(baseName, method.name) || this.findGetter(baseName, method.name) || this.findMethod(baseName, method.name))) {
        this.typeError(`Private${method.static ? " static" : ""} method '${method.name}' conflicts with an inherited public member`, method.span);
      }
      if (ownMethods.has(`${method.static ? "static:" : "instance:"}${method.name}`)) {
        this.typeError(`Class '${statement.name}' declares method '${method.name}' more than once`, method.span);
      }
      ownMethods.add(`${method.static ? "static:" : "instance:"}${method.name}`);
      if (method.abstract && !statement.abstract) {
        this.typeError(`Concrete class '${statement.name}' cannot declare abstract method '${method.name}'`, method.span);
      }
      if (method.abstract && method.static) {
        this.typeError(`Abstract method '${method.name}' cannot be static`, method.span);
      }
      if (method.abstract && method.override) {
        this.typeError(`Abstract method '${method.name}' cannot also be an override`, method.span);
      }
      if (method.private && method.abstract) {
        this.typeError(`Private method '${method.name}' cannot be abstract`, method.span);
      }
      if (method.private && method.override) {
        this.typeError(`Private method '${method.name}' cannot use 'override'`, method.span);
      }
      const inherited = baseName && !method.private
        ? method.static ? this.findStaticMethod(baseName, method.name) : this.findMethod(baseName, method.name)
        : null;
      const inheritedType = method.static
        ? inherited as ValueType | null
        : (inherited as { readonly type: ValueType } | null)?.type ?? null;
      if (method.override && !inherited) {
        this.typeError(`${method.static ? "Static m" : "M"}ethod '${method.name}' uses 'override' but no base method exists`, method.span);
      } else if (!method.override && inherited && !method.abstract) {
        this.typeError(`${method.static ? "Static m" : "M"}ethod '${method.name}' overrides a base method and must use 'override'`, method.span);
      }
      if (method.override && inheritedType && !sameTypeIgnoringCallableParameterNames(this.functionType(method), inheritedType)) {
        this.typeError(`Override '${method.name}' must keep the base method signature ${describeType(inheritedType)}`, method.span);
      }
      if (method.abstract) this.validateMethodSignature(method);
      else this.analyzeFunctionDeclaration(method, statement.name, true, !method.static, false, "Method");
    }

    if (!statement.abstract) {
      const missing = this.unimplementedAbstractMethods(statement.name);
      if (missing.length > 0) {
        this.typeError(`Concrete class '${statement.name}' must implement abstract method${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`, statement.span);
      }
    }
    this.constructorDepth = outerConstructorDepth;
    this.allowedSuperCall = outerAllowedSuperCall;
    this.currentClass = outerClass;
    this.superMemberContext = outerSuperMemberContext;
  }

  private validateClassMemberName(name: string, memberSpan: Span, external = false): void {
    const label = external ? "Extern class member" : "Class member";
    if (name === "constructor") {
      this.diagnostics.push(diagnostic("VEL4014", `${label} 'constructor' is reserved for the constructor(...) declaration`, memberSpan));
    } else if (name === "prototype" || name === "__proto__") {
      this.diagnostics.push(diagnostic("VEL4014", `${label} '${name}' is unavailable because VelarScript does not expose prototype manipulation`, memberSpan));
    }
  }

  private analyzeClassInitialization(statement: ClassDeclaration): void {
    const initialization = statement.initialization;
    if (!initialization) return;
    this.enterScope();
    this.flowFrameDepth += 1;
    this.functionDepth += 1;
    const previousLoopDepth = this.loopDepth;
    this.loopDepth = 0;
    const previousFinallyLoopDepths = this.finallyLoopDepths;
    this.finallyLoopDepths = [];
    const previousUnreachableDiagnosticDepth = this.unreachableDiagnosticDepth;
    this.unreachableDiagnosticDepth = 0;
    const previousClass = this.currentClass;
    const previousSuperMemberContext = this.superMemberContext;
    this.currentClass = statement.name;
    this.superMemberContext = "instance";
    this.asynchronousFunctions.push(false);
    this.returnContexts.push({ expected: nullType, inferredReturns: null, declarationKind: "Function" });
    this.constructorDepth += 1;
    const outerAllowedSuperCall = this.allowedSuperCall;
    const first = initialization.body[0];
    this.allowedSuperCall = first?.kind === "ExpressionStatement"
      && first.expression.kind === "CallExpression"
      && first.expression.callee.kind === "SuperExpression"
      ? spanIdentity(first.expression.span)
      : null;
    this.declareBinding("self", false, { kind: "class", name: statement.name }, initialization.span, true);
    this.analyzeStatements(initialization.body);
    this.allowedSuperCall = outerAllowedSuperCall;
    this.constructorDepth -= 1;
    this.returnContexts.pop();
    this.asynchronousFunctions.pop();
    this.currentClass = previousClass;
    this.superMemberContext = previousSuperMemberContext;
    this.loopDepth = previousLoopDepth;
    this.finallyLoopDepths = previousFinallyLoopDepths;
    this.unreachableDiagnosticDepth = previousUnreachableDiagnosticDepth;
    this.functionDepth -= 1;
    this.flowFrameDepth -= 1;
    this.exitScope();
  }

  /**
   * D39 item 53: `test "name":` is one test. Its body is an async frame — a
   * test awaits its own work — and its name is the product specification a
   * person reads, so it must be present, unique in the module, and declared
   * where the runner actually looks.
   */
  private analyzeTestDeclaration(statement: TestDeclaration): void {
    if (!this.inModuleInitializationPosition() || this.scopes.length !== 1) {
      this.diagnostics.push(diagnostic("VEL3019", "A test is declared at module top level", statement.span));
    } else if (!(this.modulePath ?? "").endsWith(".test.vel")) {
      this.diagnostics.push(diagnostic(
        "VEL3019",
        "Tests live in a '*.test.vel' module, which is where the runner looks; move this test beside the code it specifies",
        statement.span,
      ));
    }
    if (statement.title.trim() === "") {
      this.diagnostics.push(diagnostic("VEL3019", "A test name states what the code must do; this one is empty", statement.titleSpan));
    } else if (this.declaredTestTitles.has(statement.title)) {
      this.diagnostics.push(diagnostic(
        "VEL3019",
        `This module already declares a test named ${JSON.stringify(statement.title)}; a report has to be able to name one failing test`,
        statement.titleSpan,
      ));
    }
    this.declaredTestTitles.add(statement.title);

    this.enterScope();
    this.flowFrameDepth += 1;
    this.functionDepth += 1;
    const previousLoopDepth = this.loopDepth;
    this.loopDepth = 0;
    const previousFinallyLoopDepths = this.finallyLoopDepths;
    this.finallyLoopDepths = [];
    this.asynchronousFunctions.push(true);
    this.returnContexts.push({ expected: nullType, inferredReturns: null, declarationKind: "Function" });
    this.analyzeStatements(statement.body);
    this.returnContexts.pop();
    this.asynchronousFunctions.pop();
    this.loopDepth = previousLoopDepth;
    this.finallyLoopDepths = previousFinallyLoopDepths;
    this.functionDepth -= 1;
    this.flowFrameDepth -= 1;
    this.exitScope();
  }

  /**
   * D43 item 69: `using name = expression` claims ownership of a resource for
   * the enclosing scope. The value's type must declare the release contract,
   * the scope must be able to run it, and the module top level — which lives
   * until the process ends — has no scope exit to release at.
   */
  private analyzeUsingDeclaration(statement: UsingDeclaration): void {
    const value = this.inferExpression(statement.initializer);
    const rejection = this.ownershipScopeRejection();
    if (rejection !== null) this.diagnostics.push(diagnostic("VEL3018", rejection, statement.span));
    const contract = this.disposalContract(value);
    if (contract === null) {
      if (!isInvalidType(this.expandAliases(value)) && this.expandAliases(value).kind !== "any") {
        this.diagnostics.push(diagnostic(
          "VEL4032",
          `'using' releases a value whose type declares '@dispose'; ${describeType(value)} does not${this.disposalGuidance(value)}`,
          statement.initializer.span,
        ));
      }
    } else {
      if (contract.asynchronous && this.asynchronousFunctions.at(-1) !== true) {
        this.diagnostics.push(diagnostic(
          "VEL4033",
          `Releasing ${describeType(value)} awaits, so its 'using' needs an async scope; declare the enclosing function 'async def'`,
          statement.span,
        ));
      }
      this.usingDisposals.set(spanIdentity(statement.span), contract);
    }
    this.declareBinding(statement.name, false, value, statement.nameSpan);
  }

  /**
   * The release contract of a value's type: a class's own `@dispose:` block, or
   * a standard capability handle, which delegates to the verb it already
   * publishes (`close()` or `stop()`) rather than being renamed for `using`.
   */
  private disposalContract(source: ValueType): DisposalContract | null {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    if (type.kind === "class") {
      let current: string | null = type.identity ?? type.name;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const info: ClassInfo | undefined = this.classes.get(current);
        if (info?.dispose) return { member: disposeMemberKey, asynchronous: info.dispose === "async", owner: "class" };
        current = info?.base ?? null;
      }
      return null;
    }
    if (type.kind !== "named") return null;
    // A standard capability module owns its handle types (`velar/fs#type:...`);
    // a module's own `type` declaration is identified as `velar:<path>#...`, so
    // a plain record can never reach the built-in contract.
    const identity = type.identity ?? type.name;
    if (!identity.startsWith("velar/")) return null;
    const fields = this.fieldsOf(identity);
    if (!fields) return null;
    for (const verb of ["close", "stop"]) {
      const member = fields.get(verb);
      if (!member || (member.kind !== "function" && member.kind !== "action" && member.kind !== "intrinsic")) continue;
      if (member.requiredParameters > 0) continue;
      const result = this.expandAliases(member.result);
      if (result.kind === "null") return { member: verb, asynchronous: false, owner: "capability" };
      if (result.kind === "promise" && this.expandAliases(result.value).kind === "null") {
        return { member: verb, asynchronous: true, owner: "capability" };
      }
    }
    return null;
  }

  /**
   * D43 item 69 rule 6: `using` needs a scope exit to release at. The module
   * top level has none — it lives until the process ends. An extension whose
   * body is not an ordinary scope adds its own answer.
   */
  protected ownershipScopeRejection(): string | null {
    return this.inModuleInitializationPosition()
      ? "A module lives until the process ends, so a module-level 'using' has no scope to release at; own the resource inside a function, or use 'const' and release it explicitly"
      : null;
  }

  private disposalGuidance(source: ValueType): string {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    if (type.kind === "promise") {
      return this.disposalContract(type.value) === null
        ? ""
        : "; acquisition is ordinary async work — write 'using name = await ...' so the scope owns the handle, not the Promise";
    }
    if (type.kind === "class") return "; declare an '@dispose:' block on the class to say how it releases itself";
    if (type.kind === "named" || type.kind === "object" || type.kind === "record") {
      return "; a record is data, so it has nothing to release — own the handle it came from instead";
    }
    return "";
  }

  /**
   * D43 item 69: the `@dispose:` body is a release contract, not a method. It
   * runs with `self` in scope and may `await`; whether it actually does is what
   * decides that a `using` of this class needs an async scope.
   */
  private analyzeClassDispose(statement: ClassDeclaration, block: ClassDisposeBlock): void {
    this.enterScope();
    this.flowFrameDepth += 1;
    this.functionDepth += 1;
    const previousLoopDepth = this.loopDepth;
    this.loopDepth = 0;
    const previousFinallyLoopDepths = this.finallyLoopDepths;
    this.finallyLoopDepths = [];
    const previousClass = this.currentClass;
    const previousSuperMemberContext = this.superMemberContext;
    this.currentClass = statement.name;
    this.superMemberContext = "instance";
    this.asynchronousFunctions.push(true);
    this.returnContexts.push({ expected: nullType, inferredReturns: null, declarationKind: "Function" });
    this.declareBinding("self", false, { kind: "class", name: statement.name }, block.span, true);
    this.analyzeStatements(block.body);
    this.returnContexts.pop();
    this.asynchronousFunctions.pop();
    this.currentClass = previousClass;
    this.superMemberContext = previousSuperMemberContext;
    this.loopDepth = previousLoopDepth;
    this.finallyLoopDepths = previousFinallyLoopDepths;
    this.functionDepth -= 1;
    this.flowFrameDepth -= 1;
    this.exitScope();
  }

  private validateConstructorShape(statement: ClassDeclaration): void {
    const body = statement.initialization?.body ?? [];
    const isSuperCall = (item: Statement | undefined): boolean => item?.kind === "ExpressionStatement"
      && item.expression.kind === "CallExpression"
      && item.expression.callee.kind === "SuperExpression";
    if (statement.base && statement.initialization && !isSuperCall(body[0])) {
      this.typeError(`Derived constructor for '${statement.name}' must call 'super(...)' first`, statement.initialization.span);
    }
    if (statement.base && !statement.initialization) {
      const base = this.classes.get(statement.base.name);
      if ((base?.requiredParameters ?? 0) > 0) {
        this.typeError(`Class '${statement.name}' requires a constructor that calls 'super(...)'`, statement.span);
      }
    }
    if (!statement.base && isSuperCall(body[0])) {
      this.typeError(`Base class '${statement.name}' cannot call 'super(...)'`, body[0]!.span);
    }
    const ownFields = new Map(statement.fields
      .filter((field) => !field.static)
      .map((field) => [field.name, field] as const));
    const initialized = new Set([...ownFields]
      .filter(([, field]) => field.initializer !== null)
      .map(([name]) => name));
    for (const item of body.slice(statement.base ? 1 : 0)) {
      if (item.kind !== "AssignmentStatement" || item.operator !== "=" || item.target.kind !== "MemberExpression"
        || item.target.object.kind !== "IdentifierExpression" || item.target.object.name !== "self") continue;
      const field = ownFields.get(item.target.property);
      if (!field) continue;
      if (initialized.has(item.target.property)) {
        this.typeError(`Constructor initializes field '${item.target.property}' more than once`, item.target.span);
        this.constructorFieldInitializations.add(item.target.span.start);
        continue;
      }
      initialized.add(item.target.property);
      this.constructorFieldInitializations.add(item.target.span.start);
    }
    for (const field of statement.fields) {
      if (!field.static && !field.initializer && !initialized.has(field.name)) {
        this.typeError(`Field '${field.name}' requires an initializer or one direct 'self.${field.name} = ...' constructor assignment`, field.span);
      }
    }
  }

  private validateMethodSignature(method: ClassDeclaration["methods"][number]): void {
    this.checkTypeParameterDeclarations(method.typeParameters);
    if (!method.returnType) {
      this.diagnostics.push(diagnostic(
        "VEL4023",
        `Abstract method '${method.name}' requires an explicit result annotation because it has no body to infer`,
        method.signatureSpan,
      ));
    }
    this.withTypeParameterFrame(this.typeParameterFrame(method.typeParameters), () => {
      for (const parameter of method.parameters) {
        const type = this.resolveAnnotation(parameter.type);
        const valid = parameter.type ? this.validateTypeReference(parameter.type) : true;
        if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      }
      if (method.returnType) {
        const result = this.resolveAnnotation(method.returnType);
        const valid = this.validateTypeReference(method.returnType);
        if (valid && method.asynchronous && this.asyncResultContainsPromise(result)) {
          this.diagnostics.push(diagnostic("VEL4018", "An async result annotation names the resolved value; write '-> T', not '-> Promise<T>'", method.returnType.span));
        } else if (valid) {
          if (method.asynchronous) this.reportPromiseResolutionHazard(result, method.returnType.span);
          else this.reportPromiseCarrierHazard(result, method.returnType.span);
        }
      }
    });
  }

  private findField(className: string, name: string): ClassField | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      const field = info?.getters.has(name) ? null : info?.fields.get(name);
      if (field) return field;
      current = info?.base ?? null;
    }
    return null;
  }

  private findGetter(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      const getter = info?.getters.has(name) ? info.fields.get(name) : null;
      if (getter) return { owner: current, type: getter.type, abstract: info?.abstractGetters.has(name) ?? false };
      current = info?.base ?? null;
    }
    return null;
  }

  private findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      const method = info?.methods.get(name);
      if (method) return { owner: current, type: method, abstract: info?.abstractMethods.has(name) ?? false };
      current = info?.base ?? null;
    }
    return null;
  }

  private asyncPullElementType(source: ValueType, sourceSpan: Span): ValueType {
    const expanded = this.resolveNamedClasses(this.expandAliases(source));
    if (expanded.kind === "any") return anyType;
    if (isInvalidType(expanded)) return invalidType;

    let next: ValueType | null = null;
    if (expanded.kind === "object") {
      next = expanded.optionalFields?.has("next") ? null : expanded.fields.get("next") ?? null;
    } else if (expanded.kind === "named") {
      const identity = expanded.identity ?? expanded.name;
      next = this.findMethod(identity, "next")?.type
        ?? this.fieldsOf(identity)?.get("next")
        ?? null;
    } else if (expanded.kind === "class") {
      const identity = expanded.identity ?? expanded.name;
      next = this.findField(identity, "next")?.type
        ?? this.findField(expanded.name, "next")?.type
        ?? (!identity.startsWith("js:") ? this.findMethod(identity, "next")?.type : null)
        ?? (!identity.startsWith("js:") ? this.findMethod(expanded.name, "next")?.type : null)
        ?? null;
    }

    const callable = next ? this.expandAliases(next) : null;
    if (!callable || callable.kind !== "function" || callable.requiredParameters > 0 || (callable.typeParameterNames?.length ?? 0) > 0) {
      this.typeError(
        `async for requires next() -> Promise<T?>; ${describeType(source)} does not expose that pull contract`,
        sourceSpan,
      );
      return unknownType;
    }
    const result = this.expandAliases(callable.result);
    if (result.kind !== "promise") {
      this.typeError(
        `async for requires next() -> Promise<T?>; next() returns ${describeType(callable.result)}`,
        sourceSpan,
      );
      return unknownType;
    }
    const resolved = this.expandAliases(result.value);
    if (resolved.kind !== "optional") {
      this.typeError(
        `async for requires next() -> Promise<T?>; next() resolves to ${describeType(result.value)} without an exhaustion value`,
        sourceSpan,
      );
      return unknownType;
    }
    return resolved.inner;
  }

  private findStaticField(className: string, name: string): ClassField | null {
    return this.findStaticFieldOwner(className, name)?.field ?? null;
  }

  private findStaticFieldOwner(className: string, name: string): {
    readonly field: ClassField;
    readonly depth: number;
  } | null {
    let current: string | null = className;
    const visited = new Set<string>();
    let depth = 0;
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      const field = info?.staticGetters.has(name) ? null : info?.staticFields.get(name);
      if (field) return { field, depth };
      current = info?.base ?? null;
      depth += 1;
    }
    return null;
  }

  private findStaticGetter(className: string, name: string): ValueType | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      const getter = info?.staticGetters.has(name) ? info.staticFields.get(name) : null;
      if (getter) return getter.type;
      current = info?.base ?? null;
    }
    return null;
  }

  private findStaticMethod(className: string, name: string): ValueType | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      const method = info?.staticMethods.get(name);
      if (method) return method;
      current = info?.base ?? null;
    }
    return null;
  }

  private privateFieldForAccess(className: string, name: string, staticMember: boolean): ClassField | null {
    if (!this.currentClass) return null;
    const accessible = staticMember
      ? className === this.currentClass
      : this.isSubclassOf(className, this.currentClass);
    if (!accessible) return null;
    return (staticMember ? this.privateStaticFields : this.privateFields).get(this.currentClass)?.get(name) ?? null;
  }

  private privateMethodForAccess(className: string, name: string, staticMember: boolean): ValueType | null {
    if (!this.currentClass) return null;
    const accessible = staticMember
      ? className === this.currentClass
      : this.isSubclassOf(className, this.currentClass);
    if (!accessible) return null;
    return (staticMember ? this.privateStaticMethods : this.privateMethods).get(this.currentClass)?.get(name) ?? null;
  }

  private declaresPrivateMember(className: string, name: string, staticMember: boolean): boolean {
    const fields = (staticMember ? this.privateStaticFields : this.privateFields).get(className);
    const methods = (staticMember ? this.privateStaticMethods : this.privateMethods).get(className);
    return fields?.has(name) === true || methods?.has(name) === true;
  }

  private unimplementedAbstractMethods(className: string): string[] {
    const chain: ClassInfo[] = [];
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.classes.get(current);
      if (!info) break;
      chain.unshift(info);
      current = info.base;
    }
    const missing = new Set<string>();
    for (const info of chain) {
      for (const name of info.abstractMethods) missing.add(name);
      for (const name of info.methods.keys()) if (!info.abstractMethods.has(name)) missing.delete(name);
      for (const name of info.abstractGetters) missing.add(name);
      for (const name of info.getters) if (!info.abstractGetters.has(name)) missing.delete(name);
    }
    return [...missing].sort();
  }

  protected analyzeFunctionDeclaration(
    statement: AnalyzableFunctionDeclaration,
    className: string | null,
    method = false,
    declareSelf = Boolean(className),
    forceAsynchronous = false,
    declarationKind = "accessor" in statement ? "Getter" : method ? "Method" : "Function",
  ): void {
    const outerConstructorDepth = this.constructorDepth;
    if (!method && !className && !this.predeclared.has(statement)) {
      this.declareBinding(statement.name, false, this.functionType(statement as FunctionDeclaration), statement.span);
    }
    const candidateBinding = className === null ? this.lookup(statement.name) : null;
    const callableBinding = candidateBinding?.span.start === statement.span.start ? candidateBinding : null;
    this.checkTypeParameterDeclarations(statement.typeParameters);
    this.typeParameterFrames.push(this.typeParameterFrame(statement.typeParameters));
    this.enterScope();
    this.flowFrameDepth += 1;
    this.functionDepth += 1;
    const previousLoopDepth = this.loopDepth;
    this.loopDepth = 0;
    const previousFinallyLoopDepths = this.finallyLoopDepths;
    this.finallyLoopDepths = [];
    const previousClass = this.currentClass;
    const previousSuperMemberContext = this.superMemberContext;
    this.currentClass = className ?? previousClass;
    this.superMemberContext = method && className
      ? "static" in statement && statement.static === true ? "static" : "instance"
      : null;
    const asynchronous = forceAsynchronous || statement.asynchronous === true;
    this.asynchronousFunctions.push(asynchronous);
    const inferredReturns = statement.returnType === null ? [] : null;
    const declaredReturn = statement.returnType ? this.resolveResult(statement.returnType) : unknownType;
    const returnValid = statement.returnType ? this.validateTypeReference(statement.returnType) : true;
    if (asynchronous && statement.returnType && returnValid && this.asyncResultContainsPromise(declaredReturn)) {
      this.diagnostics.push(diagnostic("VEL4018", "An async result annotation names the resolved value; write '-> T', not '-> Promise<T>'", statement.returnType.span));
    } else if (statement.returnType && returnValid) {
      if (asynchronous) this.reportPromiseResolutionHazard(declaredReturn, statement.returnType.span);
      else this.reportPromiseCarrierHazard(declaredReturn, statement.returnType.span);
    }
    const expectedReturn = returnValid
      ? asynchronous ? this.resolvedAsyncResult(declaredReturn) : declaredReturn
      : invalidType;
    const returnContext: ReturnContext = {
      expected: expectedReturn,
      inferredReturns,
      declarationKind,
    };
    this.returnContexts.push(returnContext);
    if (className && declareSelf) {
      const selfType: ValueType = { kind: "class", name: className };
      this.declareBinding("self", false, selfType, statement.span, true);
    }
    for (const parameter of statement.parameters) {
      const type = this.resolveAnnotation(parameter.type);
      const valid = parameter.type ? this.validateTypeReference(parameter.type) : true;
      if (parameter.defaultValue && valid) {
        this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      }
      const declared = valid ? type : invalidType;
      this.declareBinding(parameter.name, false, parameter.rest ? { kind: "list", element: declared } : declared, parameter.span);
    }
    this.constructorDepth = 0;
    this.analyzeStatements(statement.body);
    const resultKey = this.functionResultKey(statement as FunctionDeclaration);
    if (inferredReturns) {
      const inferred = this.inferCollectedFunctionResult(inferredReturns, !this.blockAlwaysReturns(statement.body));
      this.inferredFunctionResultTypes.set(resultKey, inferred);
      const seeded = this.inferredFunctionResultSeeds.get(resultKey) ?? inferredResultPlaceholderType;
      if (this.finalizeFunctionResultInference
        && (containsInferredResultPlaceholder(inferred) || isInvalidType(inferred) || !sameInferredResult(seeded, inferred))) {
        this.diagnostics.push(diagnostic(
          "VEL4025",
          `${declarationKind} '${statement.name}' result inference did not converge; add an explicit result annotation to this recursive contract`,
          statement.signatureSpan,
        ));
      }
      this.updateInferredCallableResult(statement, className, callableBinding, inferred, asynchronous);
    } else {
      const effectiveResult = returnValid ? declaredReturn : invalidType;
      this.inferredFunctionResultTypes.set(resultKey, effectiveResult);
      this.updateInferredCallableResult(statement, className, callableBinding, effectiveResult, asynchronous);
    }
    if (statement.returnType && returnValid && expectedReturn.kind !== "null" && !this.blockAlwaysReturns(statement.body)) {
      this.diagnostics.push(diagnostic("VEL4006", `${declarationKind} '${statement.name}' can finish without returning ${describeType(expectedReturn)}`, statement.span));
    }
    this.returnContexts.pop();
    this.asynchronousFunctions.pop();
    this.currentClass = previousClass;
    this.superMemberContext = previousSuperMemberContext;
    this.loopDepth = previousLoopDepth;
    this.finallyLoopDepths = previousFinallyLoopDepths;
    this.functionDepth -= 1;
    this.flowFrameDepth -= 1;
    this.exitScope();
    this.typeParameterFrames.pop();
    this.constructorDepth = outerConstructorDepth;
  }

  protected analyzeBlock(
    statements: readonly Statement[],
    narrowed: ReadonlyMap<string, ValueType> = new Map(),
  ): ReadonlyMap<string, ValueType> {
    const visible = this.visibleBindings();
    this.enterScope();
    this.applyNarrowings(narrowed, statements[0]?.span ?? { start: 0, end: 0 });
    this.analyzeStatements(statements);
    const surviving = this.narrowingsForVisibleBindings(visible);
    this.exitScope();
    return surviving;
  }

  private survivingNarrowings(narrowed: ReadonlyMap<string, ValueType>): ReadonlyMap<string, ValueType> {
    const surviving = new Map<string, ValueType>();
    const scope = this.scopes.at(-1)!;
    const memberScope = this.memberNarrowings.at(-1)!;
    for (const [key, type] of narrowed) {
      if (key.startsWith(memberNarrowingPrefix)) {
        const current = memberScope.get(key.slice(memberNarrowingPrefix.length));
        if (current?.frame === this.flowFrameDepth && sameType(current.type, type)) surviving.set(key, type);
      } else {
        const current = scope.get(key);
        if (current?.narrowingFrame === this.flowFrameDepth && sameType(current.type, type)) surviving.set(key, type);
      }
    }
    return surviving;
  }

  protected analyzeStatements(statements: readonly Statement[]): void {
    this.prescanScopeDeclarations(statements);
    let completedFlow: FlowFactsSnapshot | null = null;
    for (const statement of statements) {
      if (completedFlow) {
        // Statements after an unconditional exit are analyzed for diagnostics
        // only; a break or continue in that dead tail must not carry writes to
        // an enclosing loop's reachable merge points.
        const previousFloor = this.loopCaptureFloor;
        this.loopCaptureFloor = Math.max(previousFloor, this.loopFlowContexts.length);
        this.unreachableDiagnosticDepth += 1;
        this.analyzeStatement(statement);
        this.unreachableDiagnosticDepth -= 1;
        this.loopCaptureFloor = previousFloor;
      } else {
        this.analyzeStatement(statement);
        if (this.statementAlwaysExitsBlock(statement)) {
          completedFlow = this.snapshotFlowFacts();
        }
      }
    }
    if (completedFlow) this.restoreFlowFacts(completedFlow);
  }

  private analyzeAssignment(statement: AssignmentStatement): void {
    const operator = statement.operator;
    let targetType = unknownType;
    let targetBinding: Binding | null = null;
    let targetWritable = true;

    if (statement.target.kind !== "IdentifierExpression" && continuesOptionalChain(statement.target)) {
      this.diagnostics.push(diagnostic("VEL3002", "Optional chains cannot be assignment targets", statement.target.span));
      targetWritable = false;
    }

    if (statement.target.kind === "IdentifierExpression") {
      const binding = this.lookup(statement.target.name);
      if (!binding) {
        this.diagnostics.push(diagnostic("VEL3001", `Unknown name '${statement.target.name}'`, statement.target.span));
        return;
      }
      this.checkShadowedRead(statement.target.name, statement.target.span);
      if (binding.reactiveKind) this.reactiveReferences.set(spanIdentity(statement.target.span), binding.reactiveKind);
      if (!binding.mutable) {
        // MOD-I3: an import is not a const declaration; every import (.vel
        // and JavaScript alike) says so and names the owning module.
        const importOrigin = this.importedBindingOrigins.get(binding.storageBinding ?? binding)
          ?? this.importedBindingOrigins.get(binding);
        this.diagnostics.push(diagnostic(
          "VEL3002",
          importOrigin !== undefined
            ? `Cannot assign to imported binding '${statement.target.name}'; imports are read-only. Change the value in its owning module (${JSON.stringify(importOrigin)}), or copy it into a local 'let' first`
            : `Cannot assign to const binding '${statement.target.name}'`,
          statement.target.span,
        ));
        targetWritable = false;
      }
      targetBinding = binding;
      targetType = operator !== "=" ? binding.type : (binding.storageBinding ?? binding).declaredType;
    } else if (statement.target.kind === "MemberExpression") {
      targetType = this.inferMember(
        statement.target.object,
        statement.target.property,
        statement.target.optional,
        statement.target.span,
        operator !== "=",
        operator !== "=",
      );
      const owner = nonOptional(this.expandAliases(this.inferredOrAnalyze(statement.target.object)));
      if (owner.kind === "union" && this.dataFieldIsReadonly(owner, statement.target.property)) {
        this.diagnostics.push(diagnostic(
          "VEL3002",
          `Cannot assign field '${statement.target.property}' through ${describeType(owner)} because at least one variant exposes it as read-only; narrow the owner first`,
          statement.target.span,
        ));
        targetWritable = false;
      } else if (owner.kind === "class") {
        const key = owner.identity ?? owner.name;
        const info = this.classes.get(key) ?? this.classes.get(owner.name);
        const privateField = this.privateFieldForAccess(key, statement.target.property, false);
        const privateMethod = this.privateMethodForAccess(key, statement.target.property, false);
        const field = this.findField(key, statement.target.property);
        const getter = this.findGetter(key, statement.target.property);
        const method = this.findMethod(key, statement.target.property);
        if (privateField && (this.privateGetters.get(this.currentClass ?? "")?.has(statement.target.property) ?? false)) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private getter '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        } else if (privateField && !privateField.mutable && !this.constructorFieldInitializations.has(statement.target.span.start)) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private const field '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        } else if (privateMethod) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private method '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        } else if (field && !field.mutable && !this.constructorFieldInitializations.has(statement.target.span.start)) {
          const label = info?.identity ? "read-only member" : "const field";
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to ${label} '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        } else if (getter) {
          const label = info?.identity?.startsWith("js:") ? "read-only member" : "getter";
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to ${label} '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        } else if (method) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only member '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        }
      } else if (owner.kind === "classConstructor") {
        const key = owner.identity ?? owner.name;
        const privateField = this.privateFieldForAccess(key, statement.target.property, true);
        const privateMethod = this.privateMethodForAccess(key, statement.target.property, true);
        const field = this.findStaticField(key, statement.target.property);
        const getter = this.findStaticGetter(key, statement.target.property);
        const method = this.findStaticMethod(key, statement.target.property);
        if ((privateField && !privateField.mutable) || privateMethod) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private static member '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        } else if ((field && !field.mutable) || getter || method) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only static member '${statement.target.property}'`, statement.target.span));
          targetWritable = false;
        }
      } else if (owner.kind === "object" && owner.readonlyFields?.has(statement.target.property)) {
        this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only field '${statement.target.property}'`, statement.target.span));
        targetWritable = false;
      } else if ((owner.kind === "object" || owner.kind === "named") && isReadonlyView(owner)) {
        this.diagnostics.push(diagnostic("VEL3002", `Cannot assign through ${describeType(owner)}; it is a read-only view`, statement.target.span));
        targetWritable = false;
      } else if (owner.kind === "named" && this.readonlyFieldsOf(owner.identity ?? owner.name)?.has(statement.target.property)) {
        this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only field '${statement.target.property}'`, statement.target.span));
        targetWritable = false;
      } else if (owner.kind === "named" && this.primitiveNames.has(owner.name)
        && this.fieldsOf(owner.identity ?? owner.name)?.has(statement.target.property)
        && !this.primitiveFieldWritable(owner.name, statement.target.property)) {
        this.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only member '${statement.target.property}'`, statement.target.span));
        targetWritable = false;
      } else if (owner.kind === "object" && owner.optionalFields?.has(statement.target.property)) {
        targetType = owner.fields.get(statement.target.property) ?? targetType;
      }
    } else {
      const objectType = this.inferExpression(statement.target.object);
      const indexType = this.inferExpression(statement.target.index);
      if (objectType.kind === "list") {
        this.requireAssignable(indexType, numberType, statement.target.index.span);
        targetType = objectType.element;
        if (objectType.readonlyView) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot index-assign through ${describeType(objectType)}; it is a read-only view`, statement.target.span));
          targetWritable = false;
        }
      } else if (objectType.kind === "map") {
        this.typeError("Use Map.set(key, value) instead of bracket assignment", statement.target.span);
        targetWritable = false;
      } else if (objectType.kind === "record") {
        this.requireAssignable(indexType, stringType, statement.target.index.span);
        targetType = objectType.value;
        if (objectType.readonlyView) {
          this.diagnostics.push(diagnostic("VEL3002", `Cannot index-assign through ${describeType(objectType)}; it is a read-only view`, statement.target.span));
          targetWritable = false;
        }
        if (operator !== "=") {
          this.typeError("Record keys may be absent; read and check the value before a compound assignment", statement.target.span);
          targetWritable = false;
        }
      } else {
        this.typeError(`Cannot index-assign ${describeType(objectType)}`, statement.target.span);
        targetWritable = false;
      }
    }

    const valueType = this.inferExpression(statement.value, operator === "=" ? targetType : unknownType);

    if (operator !== "=" && targetType.kind !== "number" && !(operator === "+=" && targetType.kind === "string")) {
      this.typeError(`Operator '${operator}' is not valid for ${describeType(targetType)}`, statement.span);
    }
    const assignmentValid = this.contextuallyAssignable(valueType, targetType, statement.value.span);
    this.requireAssignable(valueType, targetType, statement.value.span);
    if (targetWritable && assignmentValid) {
      if (statement.target.kind === "MemberExpression") {
        // D44 rules 71 and 73: invalidate first, then establish, so the new
        // fact for the written path survives its own invalidation.
        this.invalidateAliasableMemberNarrowings(statement.target);
        if (operator === "=") this.establishAssignedMemberFact(statement.target, valueType, targetType);
      } else if (operator === "=") {
        this.invalidateAssignmentNarrowings(statement.target, targetBinding);
        if (targetBinding?.mutable) {
          const storageBinding = targetBinding.storageBinding ?? targetBinding;
          const rebound = storageBinding.declaredType.kind !== "unknown" ? storageBinding.declaredType : valueType;
          storageBinding.storageType = rebound;
          if (storageBinding.narrowingFrame === null) storageBinding.type = rebound;
          targetBinding.storageType = rebound;
          targetBinding.type = rebound;
          this.rebindCollectionInference(statement.target.kind === "IdentifierExpression" ? statement.target.name : "", targetBinding, statement.value, valueType);
        }
        // D44 rule 71: the assignment establishes the right-hand side's type
        // as the location's fact (`x = maybeNull()` establishes nothing —
        // the assigned type must actually refine the declared one).
        if (statement.target.kind === "IdentifierExpression") {
          this.establishAssignedFact(statement.target.name, valueType);
        }
      }
    }
  }

  private primitiveFieldWritable(name: string, field: string): boolean {
    const pending = [name];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (this.primitiveMutableFields.get(current)?.has(field)) return true;
      for (const parent of this.primitiveParents.get(current) ?? []) pending.push(parent);
    }
    return false;
  }

  protected inferExpression(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    let type = this.inferExpressionType(expression, contextualType);
    // D45 rule 75: a class name is not a value. It may be called directly and
    // its statics may be read; every other expression position — aliasing,
    // argument passing, collections, returning, printing — rejects with the
    // arrow-factory teaching. Type positions, `extends`, `is`/`case` patterns,
    // and export declarations never reach expression inference.
    if (type.kind === "classConstructor"
      && (expression.kind === "IdentifierExpression" || expression.kind === "MemberExpression")) {
      const key = spanIdentity(expression.span);
      if (!this.callExpressionCallees.has(key) && !this.memberAccessReceivers.has(key)) {
        this.typeError(
          `A class name is not a value; call '${type.name}()' directly, or wrap a factory as an arrow '() => ${type.name}()'`,
          expression.span,
        );
        type = invalidType;
      }
    }
    this.inferredExpressionTypes.set(spanIdentity(expression.span), type);
    const expanded = this.expandAliases(type);
    if (expanded.kind === "promise") {
      this.normalizedPromiseValues.add(spanIdentity(expression.span));
    } else if (this.shouldNormalizeNullish(expression, expanded)) {
      this.normalizedUndefinedExpressions.add(spanIdentity(expression.span));
    }
    this.recordSemanticExpression(expression, type);
    return type;
  }

  private inferredOrAnalyze(expression: Expression): ValueType {
    return this.inferredExpressionTypes.get(spanIdentity(expression.span)) ?? this.inferExpression(expression);
  }

  private hasNullishContract(type: ValueType): boolean {
    return type.kind === "null" || type.kind === "optional" || type.kind === "unknown"
      || type.kind === "union" && type.members.some((member) => this.hasNullishContract(this.expandAliases(member)));
  }

  private expressionAlreadyNormalizesUndefined(expression: Expression): boolean {
    if (expression.kind === "UnaryExpression" && expression.operator === "await") {
      return this.normalizedPromiseValues.has(spanIdentity(expression.operand.span));
    }
    if (expression.kind === "CallExpression") {
      return this.optionalCalls.has(spanIdentity(expression.span))
        || this.optionalCallees.has(spanIdentity(expression.span));
    }
    if (expression.kind === "IndexExpression") return this.optionalIndexes.has(spanIdentity(expression.span));
    return expression.kind === "MemberExpression" && this.optionalMembers.has(spanIdentity(expression.span));
  }

  private shouldNormalizeNullish(expression: Expression, type: ValueType): boolean {
    if (!this.hasNullishContract(type) || this.expressionAlreadyNormalizesUndefined(expression)) return false;
    return expression.kind !== "LiteralExpression";
  }

  private recordSemanticExpression(expression: Expression, type: ValueType): void {
    const indexable = (expression.kind !== "IdentifierExpression"
      || expression.name === "self"
      || this.privateSemanticContext(type) !== null)
      && expression.kind !== "LiteralExpression"
      && expression.kind !== "SuperExpression";
    if (indexable) {
      const members = this.semanticMembersOf(type);
      const callable = type.kind === "function" || type.kind === "intrinsic" || type.kind === "action";
      if (members.size > 0 || callable || expression.kind === "MemberExpression"
        || this.semanticExpressionContexts.has(spanIdentity(expression.span))) {
        const key = spanIdentity(expression.span);
        this.semanticExpressionTypes.set(key, type);
        this.semanticExpressionMembers.set(key, members);
      }
    }
  }

  private inferExpressionType(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    const extensionType = this.inferExtensionExpression(expression, contextualType);
    if (extensionType) return extensionType;
    const coreDuration = this.inferCoreDurationExpression(expression);
    if (coreDuration) return coreDuration;
    switch (expression.kind) {
      case "LiteralExpression":
        return expression.value === null ? nullType : typeof expression.value === "string" ? stringType : typeof expression.value === "number" ? numberType : boolType;
      case "FStringExpression":
        for (const part of expression.parts) {
          if (part.kind !== "expression") continue;
          this.requireTextConvertible(this.inferExpression(part.value), part.value.span, "f-string");
        }
        return stringType;
      case "IdentifierExpression": {
        const lexical = this.lookup(expression.name);
        const binding = lexical ?? this.builtin(expression.name);
        if (!binding) {
          const guidance = this.globalGuidance.get(expression.name);
          this.diagnostics.push(diagnostic(guidance ? "VEL3008" : "VEL3001", guidance ?? `Unknown name '${expression.name}'`, expression.span));
          return unknownType;
        }
        if (!lexical && (expression.name === "Json" || expression.name === "Promise" || expression.name === "Look" || expression.name === "range")) {
          this.builtinValueReferences.set(spanIdentity(expression.span), expression.name);
        }
        this.checkShadowedRead(expression.name, expression.span);
        this.recordInitializationImportRead(binding, expression.name, expression.span);
        {
          // The class name is hoisted for analysis, but the emitted `class`
          // statement evaluates in place. A read that runs during module
          // evaluation before that point would load into a raw
          // ReferenceError; deferred positions (function and method bodies,
          // arrows, field initializers, parameter defaults) stay legal.
          const declaredAt = this.hoistedClassDeclarations.get(binding.storageBinding ?? binding);
          if (declaredAt !== undefined && expression.span.start < declaredAt && this.inModuleInitializationPosition()) {
            this.diagnostics.push(diagnostic(
              "VEL3001",
              `Class '${expression.name}' is used before its declaration; move this line after the class, or into a function that runs after the module loads`,
              expression.span,
            ));
          }
        }
        if (binding.reactiveKind) this.reactiveReferences.set(spanIdentity(expression.span), binding.reactiveKind);
        if (binding.narrowingFrame !== null) {
          this.runtimeNarrowings.set(spanIdentity(expression.span), {
            expected: binding.type,
            description: expression.name,
          });
        }
        if (binding.type.kind === "typeObject" && !binding.type.value) {
          return {
            ...binding.type,
            value: this.runtimeTypeObjectValue(binding.type),
          };
        }
        return binding.type;
      }
      case "SuperExpression":
        this.typeError("'super' must be followed by a base method name", expression.span);
        return unknownType;
      case "DynamicImportExpression":
        return { kind: "promise", value: this.dynamicImports.get(expression.source) ?? unknownType };
      case "ListExpression": {
        const collectionContext = this.contextualCollectionType(contextualType);
        let element = unknownType;
        const expectedElement = collectionContext?.kind === "list" ? collectionContext.element : unknownType;
        let matchesContext = collectionContext?.kind === "list";
        for (const item of expression.elements) {
          const itemType = this.inferExpression(item, expectedElement);
          if (item.kind === "SpreadExpression") {
            if (itemType.kind === "list") {
              const spreadElement = itemType.readonlyView ? this.readonlyDataViewOf(itemType.element) : itemType.element;
              element = mergeTypes(element, spreadElement);
              if (expectedElement.kind !== "unknown") {
                if (!isAssignable(spreadElement, expectedElement, this)) matchesContext = false;
                this.requireAssignable(spreadElement, expectedElement, item.span);
              }
            }
            else if (itemType.kind === "enumObject") this.typeError(`Cannot spread the enum itself; spread its member List instead — [...${itemType.name}.values()]`, item.span);
            else if (itemType.kind !== "any") this.typeError(`Cannot spread ${describeType(itemType)} into a list`, item.span);
          } else {
            element = mergeTypes(element, expectedElement.kind === "unknown" ? this.widenAggregateSingleton(itemType) : itemType);
            if (expectedElement.kind !== "unknown") {
              if (!this.contextuallyAssignable(itemType, expectedElement, item.span)) matchesContext = false;
              this.requireAssignable(itemType, expectedElement, item.span);
            }
          }
        }
        const inferredList: ValueType = { kind: "list", element };
        if (matchesContext && collectionContext?.kind === "list") {
          return collectionContext;
        }
        return inferredList;
      }
      case "ObjectExpression": {
        const objectContext = this.contextualObjectType(contextualType, expression);
        if (objectContext?.kind === "named") {
          const contextKey = spanIdentity(expression.span);
          this.semanticExpressionContexts.set(contextKey, objectContext);
          this.semanticExpressionContextMembers.set(contextKey, this.semanticMembersOf(objectContext));
        }
        const fields = new Map<string, ValueType>();
        const optionalFields = new Set<string>();
        const explicitFields = new Set<string>();
        let containsSpread = false;
        const expectedRecordValue = objectContext?.kind === "record" ? objectContext.value : null;
        const expectedFields = objectContext?.kind === "object"
          ? objectContext.fields
          : objectContext?.kind === "named" ? this.fieldsOf(objectContext.identity ?? objectContext.name) : null;
        const expectedOptionalFields = objectContext?.kind === "object" ? objectContext.optionalFields : undefined;
        for (const property of expression.properties) {
          if (property.kind === "ObjectProperty") {
            if (explicitFields.has(property.name)) {
              this.diagnostics.push(diagnostic("VEL4004", `Object field '${property.name}' is declared more than once`, property.span));
            }
            explicitFields.add(property.name);
            optionalFields.delete(property.name);
            if (objectContext?.kind === "named" && expectedFields?.has(property.name)) {
              this.semanticObjectPropertyOwners.set(`${property.span.start}:${property.name}`, objectContext);
            }
            const expected = expectedFields?.get(property.name) ?? expectedRecordValue ?? unknownType;
            const actual = this.inferExpression(property.value, expected.kind === "optional" ? expected.inner : expected);
            fields.set(property.name, expected.kind === "unknown" ? this.widenAggregateSingleton(actual) : actual);
            if (expected.kind !== "unknown") this.requireAssignable(actual, expected, property.value.span);
          } else {
            containsSpread = true;
            const spread = this.inferExpression(property.value);
            // COL-D2: spreading a named (open) record into a Record<T>
            // context smuggles undeclared fields past the value contract —
            // the exact reason the direct assignment is rejected — so the
            // spread spelling is rejected the same way, teaching explicit
            // field copies.
            if (expectedRecordValue && spread.kind === "named" && this.fieldsOf(spread.identity ?? spread.name)) {
              const declaredFields = [...this.fieldsOf(spread.identity ?? spread.name)!.keys()];
              const example = declaredFields.slice(0, 2).map((field) => `${field}: value.${field}`).join(", ") + (declaredFields.length > 2 ? ", ..." : "");
              this.typeError(
                `Cannot spread ${describeType(spread)} into a Record value: a named record is open, so the value may carry fields beyond its declaration; copy the declared fields explicitly — {${example}}`,
                property.span,
              );
              continue;
            }
            const spreadFields = spread.kind === "object" ? spread.fields : spread.kind === "named" ? this.fieldsOf(spread.identity ?? spread.name) : null;
            if (spreadFields) {
              for (const [name, type] of spreadFields) {
                const readonly = isReadonlyView(spread)
                  || spread.kind === "object" && spread.readonlyFields?.has(name) === true
                  || spread.kind === "named" && this.readonlyFieldsOf(spread.identity ?? spread.name)?.has(name) === true;
                const shared = readonly ? this.readonlyDataViewOf(type) : type;
                if (expectedRecordValue) this.requireAssignable(shared, expectedRecordValue, property.span);
                const alreadyRequired = fields.has(name) && !optionalFields.has(name);
                fields.set(name, shared);
                if (!alreadyRequired && spread.kind === "object" && spread.optionalFields?.has(name)) optionalFields.add(name);
                else optionalFields.delete(name);
              }
            } else if (spread.kind === "record" && expectedRecordValue) {
              this.requireAssignable(spread.value, expectedRecordValue, property.span);
            } else if (spread.kind !== "any") {
              this.typeError(`Cannot spread ${describeType(spread)} into an object`, property.span);
            }
          }
        }
        if (expectedFields && !containsSpread) {
          for (const [name, expected] of expectedFields) {
            if (!explicitFields.has(name) && expected.kind !== "optional" && !expectedOptionalFields?.has(name)) {
              this.typeError(`Object is missing required field '${name}'`, expression.span);
            }
          }
          this.contextualAssignments.set(spanIdentity(expression.span), contextualType);
        }
        return expectedRecordValue
          ? { kind: "record", value: expectedRecordValue }
          : { kind: "object", fields, ...(optionalFields.size > 0 ? { optionalFields } : {}) };
      }
      case "SpreadExpression":
        return this.inferExpression(expression.value);
      case "UnaryExpression": {
        const operand = this.inferExpression(expression.operand);
        if (expression.operator === "await") {
          if (this.parameterDefaultDepth > 0) {
            this.diagnostics.push(diagnostic("VEL4007", "'await' cannot be used in a parameter default value", expression.span));
          } else if (this.classFieldInitializerDepth > 0) {
            this.diagnostics.push(diagnostic("VEL4007", "'await' cannot be used in a class field initializer", expression.span));
          } else if (this.constructorDepth > 0) {
            this.diagnostics.push(diagnostic("VEL4007", "'await' cannot be used directly in a constructor", expression.span));
          }
          const invalidFunctionAwait = this.functionDepth > 0 && !this.asynchronousFunctions.at(-1);
          const invalidExtensionAwait = this.functionDepth === 0 && this.invalidExtensionAwaitContext();
          if (this.parameterDefaultDepth === 0 && this.constructorDepth === 0 && (invalidFunctionAwait || invalidExtensionAwait)) {
            this.diagnostics.push(diagnostic(
              "VEL4007",
              invalidExtensionAwait
                ? this.invalidExtensionAwaitMessage() ?? "'await' is not valid in this synchronous extension context"
                : "'await' can only be used in an async function or at module scope",
              expression.span,
            ));
          }
          const awaited = this.expandAliases(operand);
          if (isInvalidType(awaited)) return invalidType;
          if (awaited.kind === "promise") {
            this.reportPromiseResolutionHazard(awaited.value, expression.operand.span);
            const result = resolvedAsyncType(awaited.value);
            if (result.kind === "null" && !this.normalizedPromiseValues.has(spanIdentity(expression.operand.span))) {
              this.normalizedNullResults.add(spanIdentity(expression.span));
            }
            return result;
          }
          // ASY-U2: awaiting `any` adopts a foreign thenable — its hooks run
          // here and a raw undefined result skips null normalization — so the
          // unchecked domain is rejected exactly like `unknown`.
          this.typeError(
            awaited.kind === "any"
              ? "Cannot await any; validate the value into a checked Promise first — an unchecked thenable runs foreign hooks and can leak raw undefined"
              : `Cannot await ${describeType(operand)}`,
            expression.span,
          );
          return unknownType;
        }
        if (isInvalidType(operand)) return invalidType;
        if (expression.operator === "not") {
          this.requireCondition(operand, expression.operand);
          return boolType;
        }
        this.requireAssignable(operand, numberType, expression.operand.span);
        return numberType;
      }
      case "TryExpression": {
        // D39 item 51: an expected failure is an optional. The inner
        // expression is checked against the non-optional shape of whatever the
        // consumer wants, because failure is what supplies the null.
        if (expression.value.kind === "TryExpression") {
          this.diagnostics.push(diagnostic(
            "VEL4034",
            "'try try' says nothing the first 'try' has not already said; one 'try' turns any failure in the whole chain into null",
            expression.span,
          ));
        }
        const attempted = this.inferExpression(expression.value, nonOptional(this.expandAliases(contextualType)));
        if (isInvalidType(attempted)) return invalidType;
        const resolved = this.expandAliases(attempted);
        if (resolved.kind === "null") {
          this.diagnostics.push(diagnostic(
            "VEL4034",
            "This expression produces null on success, so a 'try' result cannot tell success from failure; use try/catch to handle the failure",
            expression.span,
          ));
          return invalidType;
        }
        if (resolved.kind === "promise") {
          this.diagnostics.push(diagnostic(
            "VEL4034",
            `'try' catches a failure while the expression runs, but this expression is ${describeType(attempted)}; write 'try await ...' so the rejection is what is caught`,
            expression.span,
          ));
        }
        return optionalOf(attempted);
      }
      case "BinaryExpression":
        return this.inferBinary(expression.left, expression.operator, expression.right, expression.span, contextualType);
      case "AssignmentExpression": {
        // A parser-recovered assignment-in-expression: both sides are analyzed
        // so their own guidance still surfaces, and the recovery produces no
        // value because assignment is a statement.
        const target = this.inferExpression(expression.target);
        this.inferExpression(expression.value, isInvalidType(target) ? unknownType : target);
        return nullType;
      }
      case "ComparisonChainExpression": {
        const types: ValueType[] = [this.inferExpression(expression.operands[0]!)];
        let successful = new Map<string, ValueType>();
        for (let index = 0; index < expression.operators.length; index += 1) {
          const left = expression.operands[index]!;
          const right = expression.operands[index + 1]!;
          const operator = expression.operators[index]!;
          this.enterScope();
          try {
            this.applyNarrowings(successful, right.span);
            const rightType = this.inferExpression(right);
            types.push(rightType);
            const surviving = this.survivingNarrowings(successful);
            if (operator !== "==" && operator !== "!=") {
              this.requireOrderedComparison(types[index]!, rightType, left, right, expression.span);
            } else if (this.rejectFreshCollectionEquality(index === 0 ? left : right, right, operator)) {
              // A fresh literal chain link is already constant; nothing else to learn.
            } else if (this.equalityOperandMayBeNaN(left, types[index]!) && this.equalityOperandMayBeNaN(right, rightType)) {
              this.sameValueZeroEqualities.add(spanIdentity({ start: left.span.start, end: right.span.end }));
            }
            const link: Expression = {
              kind: "BinaryExpression",
              left,
              operator,
              right,
              span: { start: left.span.start, end: right.span.end },
            };
            successful = new Map([...surviving, ...this.narrowingFor(link, boolType)]);
          } finally {
            this.exitScope();
          }
        }
        this.logicalConditionNarrowings.set(spanIdentity(expression.span), { truthy: successful, falsy: new Map() });
        return types.some(isInvalidType) ? invalidType : boolType;
      }
      case "ConditionalExpression":
        {
          const condition = this.inferExpression(expression.condition);
          this.requireCondition(condition, expression.condition);
          const baseline = this.snapshotFlowFacts();
          let thenType = unknownType;
          const thenInvalidations = this.analyzeIsolatedFlow(baseline, () => {
            thenType = this.inferNarrowedExpression(
              expression.thenValue,
              this.narrowingFor(expression.condition, condition),
              contextualType,
            );
          });
          let elseType = unknownType;
          const elseInvalidations = this.analyzeIsolatedFlow(baseline, () => {
            elseType = this.inferNarrowedExpression(
              expression.elseValue,
              this.negativeNarrowingFor(expression.condition, condition),
              contextualType,
            );
          });
          this.applyFlowInvalidations([thenInvalidations, elseInvalidations], false);
          if (this.contextualObjectType(contextualType)
            && this.contextuallyAssignable(thenType, contextualType, expression.thenValue.span)
            && this.contextuallyAssignable(elseType, contextualType, expression.elseValue.span)) {
            this.contextualAssignments.set(spanIdentity(expression.span), contextualType);
          }
          return mergeTypes(thenType, elseType);
        }
      case "IsExpression": {
        const subject = this.inferExpression(expression.value);
        const checked = this.resolveAnnotation(expression.type);
        const valid = this.validateTypeReference(expression.type);
        if (valid && this.rejectErasedRuntimeCheck(checked, expression.type.span)) return invalidType;
        if (valid && checked.kind === "class") {
          this.classChecks.add(spanIdentity(expression.span));
        }
        if (valid) {
          // GRM-D1 second half: bool is a closed primitive, so an `is` whose
          // subject is statically bool is decided at compile time — the same
          // constant-test reasoning as D42 item 64.
          const expandedSubject = this.expandAliases(subject);
          if (expandedSubject.kind === "bool") {
            const matches = this.expandAliases(checked).kind === "bool";
            const constant = (expression.operator === "is") === matches;
            this.typeError(
              `The subject is already statically bool, so '${expression.operator} ${describeType(checked)}' is always ${constant}; drop the constant test`,
              expression.span,
            );
          } else {
            this.rejectDisjointEnumTest(subject, checked, expression.operator, expression.span);
          }
        }
        return valid ? boolType : invalidType;
      }
      case "ArrowFunctionExpression":
        return this.inferArrow(expression, contextualType);
      case "CallExpression": {
        const result = this.inferCall(expression.callee, expression.arguments, expression.argumentNames, expression.span, contextualType, expression.optional);
        if (this.expandAliases(result).kind === "null") this.normalizedNullResults.add(spanIdentity(expression.span));
        return result;
      }
      case "MemberExpression":
        return this.inferMember(expression.object, expression.property, expression.optional, expression.span);
      case "IndexExpression": {
        const original = this.expandAliases(this.inferExpression(expression.object));
        const guarded = expression.optional && (original.kind === "optional" || original.kind === "null");
        if (!expression.optional && original.kind === "optional") {
          this.typeError(`Use optional index '?.[...]' for ${describeType(original)}`, expression.span);
        }
        if (original.kind === "null" && expression.optional) {
          const baseline = this.snapshotFlowFacts();
          this.analyzeIsolatedFlow(baseline, () => {
            this.inferExpression(expression.index);
          });
          this.optionalIndexes.add(spanIdentity(expression.span));
          return optionalOf(unknownType);
        }
        const object = guarded && original.kind === "optional" ? original.inner : original;
        const index = guarded
          ? this.withTemporaryNarrowings(
            this.optionalExecutionNarrowings(expression.object),
            expression.index.span,
            () => this.inferExpression(expression.index),
          )
          : this.inferExpression(expression.index);
        if (isInvalidType(object)) return invalidType;
        if (object.kind === "list") {
          this.requireAssignable(index, numberType, expression.index.span);
          const element = object.readonlyView ? this.readonlyDataViewOf(object.element) : object.element;
          if (guarded) {
            this.optionalIndexes.add(spanIdentity(expression.span));
            return optionalOf(element);
          }
          return element;
        }
        if (object.kind === "map") {
          this.typeError("Use Map.get(key) instead of bracket access", expression.span);
          return object.value;
        }
        if (object.kind === "record") {
          this.requireAssignable(index, stringType, expression.index.span);
          if (guarded) this.optionalIndexes.add(spanIdentity(expression.span));
          return optionalOf(object.readonlyView ? this.readonlyDataViewOf(object.value) : object.value);
        }
        if (object.kind === "string") {
          this.typeError("Use '.char(index)'; strings are not indexable and string positions count Unicode code points", expression.span);
          return unknownType;
        }
        if (object.kind !== "any") {
          this.typeError(`Cannot index ${describeType(object)}`, expression.span);
        }
        return object.kind === "any" ? anyType : unknownType;
      }
      default:
        return unknownType;
    }
  }

  private isCoreDurationLiteral(expression: Expression): boolean {
    return expression.kind === "ExtensionExpression:core:duration";
  }

  private containsCoreDuration(expression: Expression): boolean {
    if (this.isCoreDurationLiteral(expression)) return true;
    if (expression.kind === "UnaryExpression") return this.containsCoreDuration(expression.operand);
    return expression.kind === "BinaryExpression"
      && (this.containsCoreDuration(expression.left) || this.containsCoreDuration(expression.right));
  }

  private inferCoreDurationExpression(expression: Expression): ValueType | null {
    if (this.isCoreDurationLiteral(expression)) return durationType;
    if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")
      && this.containsCoreDuration(expression.operand)) {
      const operand = this.inferExpression(expression.operand);
      if (!isAssignable(operand, durationType, this)) this.typeError(`Duration unary '${expression.operator}' requires Duration, received ${describeType(operand)}`, expression.span);
      this.extensionCalls.set(spanIdentity(expression.span), "core.duration-arithmetic");
      return durationType;
    }
    if (expression.kind !== "BinaryExpression" || !["+", "-", "*", "/"].includes(expression.operator)
      || !this.containsCoreDuration(expression)) return null;
    const left = this.inferExpression(expression.left);
    const right = this.inferExpression(expression.right);
    const leftDuration = isAssignable(left, durationType, this);
    const rightDuration = isAssignable(right, durationType, this);
    const valid = (expression.operator === "+" || expression.operator === "-")
      ? leftDuration && rightDuration
      : leftDuration && right.kind === "number" || expression.operator === "*" && left.kind === "number" && rightDuration;
    if (!valid) {
      this.typeError(`Duration arithmetic cannot apply '${expression.operator}' to ${describeType(left)} and ${describeType(right)}`, expression.span);
      return invalidType;
    }
    if (expression.operator === "/" && expression.right.kind === "LiteralExpression" && expression.right.value === 0) {
      this.typeError("Duration arithmetic cannot divide by zero", expression.span);
      return invalidType;
    }
    this.extensionCalls.set(spanIdentity(expression.span), "core.duration-arithmetic");
    return durationType;
  }

  private inferBinary(
    leftExpression: Expression,
    operator: string,
    rightExpression: Expression,
    operationSpan: Span,
    contextualType: ValueType,
  ): ValueType {
    const left = this.inferExpression(leftExpression);
    if (operator === "and" || operator === "or") {
      this.requireCondition(left, leftExpression);
      const leftTruthy = this.narrowingFor(leftExpression, left);
      const leftFalsy = this.negativeNarrowingFor(leftExpression, left);
      const rightContext = operator === "and" ? leftTruthy : leftFalsy;
      const rightCondition = this.inferConditionWithNarrowings(rightExpression, rightContext);
      this.logicalConditionNarrowings.set(spanIdentity(operationSpan), {
        truthy: operator === "and" ? this.combineNarrowings(rightCondition.surviving, rightCondition.truthy) : new Map(),
        falsy: operator === "or" ? this.combineNarrowings(rightCondition.surviving, rightCondition.falsy) : new Map(),
      });
      return isInvalidType(left) || isInvalidType(rightCondition.type) ? invalidType : boolType;
    }
    if (operator === "??") {
      const expandedLeft = this.expandAliases(left);
      const fallbackContext = this.coalescingFallbackContext(expandedLeft, contextualType);
      const right = this.inferNarrowedExpression(
        rightExpression,
        this.negativeNarrowingFor(leftExpression, left),
        fallbackContext,
      );
      if (isInvalidType(left) || isInvalidType(right)) return invalidType;
      // D44 rule 71: `??` is a presence test, so an assignment-established
      // fact never makes it a rejected constant — the operand is judged (and
      // runtime-guarded) as its declared domain, exactly like `== null`.
      const domainLeft = this.assignedFactDomain(leftExpression, left);
      const expandedDomain = domainLeft === left ? expandedLeft : this.expandAliases(domainLeft);
      if (domainLeft !== left) this.runtimeNarrowings.delete(spanIdentity(leftExpression.span));
      if (expandedDomain.kind !== "optional" && expandedDomain.kind !== "null" && expandedDomain.kind !== "any") {
        this.typeError(`Left side of '??' is not optional: ${describeType(domainLeft)}`, leftExpression.span);
      }
      return mergeTypes(nonOptional(expandedLeft), right);
    }
    const right = this.inferExpression(rightExpression);
    if (isInvalidType(left) || isInvalidType(right)) return invalidType;
    if (operator === "in" || operator === "not in") {
      if (right.kind === "list" || right.kind === "set") {
        this.requireMembershipIntersection(left, this.readonlyDataViewOf(right.element), leftExpression.span, operator);
      } else if (right.kind === "map") {
        this.requireMembershipIntersection(left, this.readonlyDataViewOf(right.key), leftExpression.span, operator);
      } else if (right.kind === "record") {
        this.requireMembershipIntersection(left, stringType, leftExpression.span, operator);
      } else if (right.kind === "string") {
        this.requireMembershipIntersection(left, stringType, leftExpression.span, operator);
      } else if (right.kind !== "any") {
        this.typeError(`Membership requires a List, Set, Map, Record, or string, received ${describeType(right)}`, rightExpression.span);
      }
      return boolType;
    }
    if (operator === "==" || operator === "!=") {
      if (this.rejectFreshCollectionEquality(leftExpression, rightExpression, operator)) return boolType;
      this.requireIntersectingEquality(left, right, operator, leftExpression, rightExpression, operationSpan);
      if (this.equalityOperandMayBeNaN(leftExpression, left) && this.equalityOperandMayBeNaN(rightExpression, right)) {
        this.sameValueZeroEqualities.add(spanIdentity(operationSpan));
      }
      return boolType;
    }
    if (["<", "<=", ">", ">="].includes(operator)) {
      this.requireOrderedComparison(left, right, leftExpression, rightExpression, operationSpan);
      return boolType;
    }
    if (operator === "+" && (left.kind === "string" || right.kind === "string")) {
      if (left.kind === "string" && right.kind === "string") return stringType;
      this.typeError(
        `String concatenation requires two strings; use an f-string or str(value), received ${describeType(left)} and ${describeType(right)}`,
        operationSpan,
      );
      return stringType;
    }
    this.requireAssignable(left, numberType, leftExpression.span);
    this.requireAssignable(right, numberType, rightExpression.span);
    return numberType;
  }

  // D42 item 64: `==`/`!=` require the operand types to intersect. Strict
  // equality between two types that no single value inhabits is constant, so
  // the tightening converts a silent logic bug into a compile error. Runtime
  // lowering is untouched — this is purely static.
  private requireIntersectingEquality(
    leftType: ValueType,
    rightType: ValueType,
    operator: string,
    leftExpression: Expression,
    rightExpression: Expression,
    operationSpan: Span,
  ): void {
    // D44 rule 71: an assignment-established fact refines reads, but it never
    // turns a later test into a constant — `const x: string? = "a"` followed
    // by `x == null` is still the declared question about string?, not a
    // rejected string-versus-null comparison. Checked (condition) facts keep
    // participating: re-testing something the flow just proved stays an error.
    const left = this.assignedFactDomain(leftExpression, leftType);
    const right = this.assignedFactDomain(rightExpression, rightType);
    // The equality itself re-asks the question at runtime and is total over
    // its domain, so an assigned-fact operand must not carry a read guard —
    // the guard would throw on the stale value the test is there to detect.
    if (left !== leftType) this.runtimeNarrowings.delete(spanIdentity(leftExpression.span));
    if (right !== rightType) this.runtimeNarrowings.delete(spanIdentity(rightExpression.span));
    if (this.equalityTypesIntersect(left, right)) return;
    const errorSpan = { start: leftExpression.span.start, end: Math.max(rightExpression.span.end, operationSpan.end) };
    // When only the enum/string veto separated the operands, the comparison is
    // not constant — an enum member and a raw string can match wire text at
    // runtime. That silent match is exactly the read path around `Enum.parse`
    // the veto exists to close, so the message names the boundary instead of
    // claiming a constant result (ENM-I2).
    if (this.typesIntersect(left, right, false)) {
      this.typeError(
        `${describeType(left)} and ${describeType(right)} can meet only where an enum member matches a raw string, and the enum and string domains never meet in '${operator}'${this.equalityGuidance(left, right)}`,
        errorSpan,
      );
      return;
    }
    const constant = operator === "==" ? "false" : "true";
    this.typeError(
      `${describeType(left)} and ${describeType(right)} have no values in common, so '${operator}' is always ${constant}${this.equalityGuidance(left, right)}`,
      errorSpan,
    );
  }

  // COL-I3 first half: collection `==` is reference identity (the runtime
  // follows the mother language), so a freshly constructed literal operand
  // can never be identical to anything — the comparison is provably constant,
  // which is D42's own reason to reject it. Content comparison has a spelling
  // now: equals(a, b).
  private rejectFreshCollectionEquality(left: Expression, right: Expression, operator: string): boolean {
    const fresh = this.freshCollectionOperand(left) ?? this.freshCollectionOperand(right);
    if (!fresh) return false;
    const constant = operator === "==" ? "false" : "true";
    this.typeError(
      `A ${fresh.description} built inside the comparison is a new object, and '${operator}' compares collection identity, so the result is always ${constant}; compare contents with equals(a, b)`,
      fresh.span,
    );
    return true;
  }

  private freshCollectionOperand(expression: Expression): { readonly description: string; readonly span: Span } | null {
    if (expression.kind === "ListExpression") return { description: "List literal", span: expression.span };
    if (expression.kind === "ObjectExpression") return { description: "record literal", span: expression.span };
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression"
      && (expression.callee.name === "Map" || expression.callee.name === "Set")
      && !this.lookup(expression.callee.name)) {
      return { description: `${expression.callee.name}(...) construction`, span: expression.span };
    }
    return null;
  }

  // ENM-I3: the membership vocabulary — `in`, `has`, `index`, `count`,
  // `remove`, and the Map.get key — asks the question `==` asks, one element
  // at a time, so the probe carries the same intersection requirement and
  // the same enum/string boundary as D42 item 64.
  private requireMembershipIntersection(probe: ValueType, domain: ValueType, span: Span, operation: string): void {
    if (isInvalidType(probe) || isInvalidType(domain)) return;
    if (this.equalityTypesIntersect(probe, domain)) return;
    this.typeError(
      this.typesIntersect(probe, domain, false)
        ? `${describeType(probe)} can match ${describeType(domain)} only as an enum member against a raw string, and the enum and string domains never meet in '${operation}'${this.equalityGuidance(probe, domain)}`
        : `${describeType(probe)} and ${describeType(domain)} have no values in common, so '${operation}' can never match${this.equalityGuidance(probe, domain)}`,
      span,
    );
  }

  // ENM-I1: `is` / `is not` between statically disjoint enum domains is the
  // last equality surface that could launder one enum's member into another
  // (`==` and `case` already reject). The test is constant only when both
  // sides live purely in the enum/null domain; any string, unknown, or other
  // arm makes the runtime check a real validation and keeps it legal.
  private rejectDisjointEnumTest(subjectSource: ValueType, checked: ValueType, operator: "is" | "is not", span: Span): void {
    const subjectArms = this.pureEnumDomainArms(subjectSource);
    const checkedArms = this.pureEnumDomainArms(checked);
    if (!subjectArms || !checkedArms) return;
    if (!subjectArms.some((arm) => arm.kind !== "null") || !checkedArms.some((arm) => arm.kind !== "null")) return;
    const meets = subjectArms.some((subjectArm) => checkedArms.some((checkedArm) =>
      subjectArm.kind === "null"
        ? checkedArm.kind === "null"
        : checkedArm.kind !== "null" && this.equalityTypesIntersect(subjectArm, checkedArm)));
    if (meets) return;
    const constant = operator === "is" ? "false" : "true";
    this.typeError(
      `${describeType(subjectSource)} and ${describeType(checked)} have no values in common, so '${operator}' is always ${constant}`,
      span,
    );
  }

  /** The enum/null arms of a type, or null when any arm falls outside that domain. */
  private pureEnumDomainArms(source: ValueType): Extract<ValueType, { kind: "enum" | "enumMember" | "null" }>[] | null {
    const arms: Extract<ValueType, { kind: "enum" | "enumMember" | "null" }>[] = [];
    const visit = (current: ValueType): boolean => {
      const type = this.resolveNamedClasses(this.expandAliases(current));
      if (type.kind === "enum" || type.kind === "enumMember" || type.kind === "null") {
        arms.push(type);
        return true;
      }
      if (type.kind === "optional") return visit(type.inner) && visit(nullType);
      if (type.kind === "union") return type.members.every(visit);
      return false;
    };
    return visit(source) ? arms : null;
  }

  // ENM-I1's call spelling: `B.is(value)` — the stored-validator form charter
  // section 6 blesses — must agree with the `is` operator, so a probe that is
  // statically another enum's member is rejected the same way.
  private rejectDisjointEnumValidatorProbe(calleeExpression: Expression, arguments_: readonly Expression[]): void {
    if (calleeExpression.kind !== "MemberExpression" || calleeExpression.property !== "is" || arguments_.length !== 1) return;
    const target = this.enumTargetOfValidatorObject(calleeExpression.object);
    if (!target) return;
    const argument = arguments_[0]!;
    if (argument.kind === "SpreadExpression") return;
    const probe = this.inferredExpressionTypes.get(spanIdentity(argument.span));
    if (!probe) return;
    this.rejectDisjointEnumTest(probe, target, "is", argument.span);
  }

  private enumTargetOfValidatorObject(object: Expression): Extract<ValueType, { kind: "enum" }> | null {
    if (object.kind !== "IdentifierExpression") return null;
    const type = this.lookup(object.name)?.type;
    if (!type) return null;
    if (type.kind === "enumObject") return { kind: "enum", name: type.name, identity: type.identity };
    if (type.kind === "typeObject") {
      const aliased = this.aliasedEnumTarget(type.name);
      if (aliased) return { kind: "enum", name: aliased.name, identity: aliased.identity };
    }
    return null;
  }

  /** The enum behind a type alias name, or null when the alias does not resolve to an enum. */
  private aliasedEnumTarget(name: string): { readonly name: string; readonly identity: string; readonly members: ReadonlySet<string> } | null {
    if (!this.typeAliases.has(name)) return null;
    const expanded = this.expandAliases({ kind: "named", name });
    if (expanded.kind === "enum") {
      const info = this.enums.get(expanded.identity) ?? this.enums.get(expanded.name);
      return info ? { name: expanded.name, identity: expanded.identity, members: info.members } : null;
    }
    if (expanded.kind === "named") {
      const info = this.enums.get(expanded.name);
      return info ? { name: expanded.name, identity: info.identity, members: info.members } : null;
    }
    return null;
  }

  // ENM-D1: an enum member is a bare string at runtime, so a Set element or
  // Map key type whose union mixes members of different enums — or an enum
  // with `string` — would collapse nominally distinct keys into one slot.
  // The same no-intersection principle as D42 item 64, applied where the
  // collection would silently unify what the type system keeps apart.
  private rejectCollidingKeyDomain(keySource: ValueType, span: Span, position: string): void {
    const enumIdentities = new Set<string>();
    let enumName: string | null = null;
    let sawString = false;
    const visit = (source: ValueType): void => {
      const type = this.expandAliases(source);
      if (type.kind === "enum" || type.kind === "enumMember") {
        enumIdentities.add(type.identity);
        enumName ??= type.name;
      } else if (type.kind === "string") {
        sawString = true;
      } else if (type.kind === "optional") {
        visit(type.inner);
      } else if (type.kind === "union") {
        for (const member of type.members) visit(member);
      }
    };
    visit(keySource);
    if (enumIdentities.size === 0 || (enumIdentities.size === 1 && !sawString)) return;
    const collision = sawString
      ? `mixes ${enumName ?? "an enum"} with string, and an enum member is a bare string at runtime`
      : "mixes members of different enums, which are bare strings at runtime";
    this.typeError(
      `A ${position} of ${describeType(keySource)} ${collision}, so nominally distinct keys would collapse into one slot; keep the domains in separate collections, or store wire strings deliberately with str(member)`,
      span,
    );
  }

  /**
   * The declared domain behind an assignment-established fact: what a test
   * (`== null`, `??`) judges, and what an unannotated alias declares. Returns
   * the inferred type unchanged when the expression's narrowing came from a
   * check (or from nothing).
   */
  private assignedFactDomain(expression: Expression, inferred: ValueType): ValueType {
    if (expression.kind === "IdentifierExpression") {
      const binding = this.lookup(expression.name);
      if (binding && binding.narrowingFrame !== null && binding.assignedFact === true) {
        return (binding.storageBinding ?? binding).storageType;
      }
      return inferred;
    }
    if (expression.kind === "MemberExpression") {
      const path = this.stableMemberAccessPath(expression);
      const narrowing = path ? this.lookupMemberNarrowingEntry(path) : null;
      if (narrowing?.assigned === true && narrowing.domain) return narrowing.domain;
    }
    return inferred;
  }

  // Intersection is decided by assignability in either direction, never by
  // name, so structurally identical records declared in different modules
  // still compare. Aliases, optionals, and unions are opened first so a
  // partial overlap (`(string | number) == string`) is enough.
  private equalityTypesIntersect(leftSource: ValueType, rightSource: ValueType): boolean {
    return this.typesIntersect(leftSource, rightSource, true);
  }

  private typesIntersect(leftSource: ValueType, rightSource: ValueType, enumStringVeto: boolean): boolean {
    const left = this.resolveNamedClasses(this.expandAliases(leftSource));
    const right = this.resolveNamedClasses(this.expandAliases(rightSource));
    if (isInvalidType(left) || isInvalidType(right)) return true;
    // Unchecked boundary values and unresolved type parameters carry no domain
    // this rule could contradict, so they keep their existing freedom.
    if (left.kind === "any" || right.kind === "any") return true;
    if (left.kind === "unknown" || right.kind === "unknown") return true;
    if (left.kind === "parameter" || right.kind === "parameter") return true;
    // D42 item 65's one documented exception to "assignability decides
    // intersection": enum -> `string` assignability is a one-way exit that
    // exists so a wire value can be sent out. Equality is symmetric, so
    // honoring it here would open a read path around `Enum.parse` and undo
    // charter section 6's promise that an open string never silently becomes
    // an enum member. The veto runs before union arms distribute (ENM-I2):
    // a `Status | string` operand still puts a raw string and an enum member
    // into the same comparison, so the two domains never meet — not even
    // through a union arm — and the author narrows first.
    if (enumStringVeto
      && ((this.valueLevelEnum(left) !== null && this.hasValueLevelString(right))
        || (this.hasValueLevelString(left) && this.valueLevelEnum(right) !== null))) return false;
    if (left.kind === "union") return left.members.some((member) => this.typesIntersect(member, right, enumStringVeto));
    if (right.kind === "union") return right.members.some((member) => this.typesIntersect(left, member, enumStringVeto));
    if (left.kind === "optional") {
      return this.typesIntersect(left.inner, right, enumStringVeto) || this.typesIntersect(nullType, right, enumStringVeto);
    }
    if (right.kind === "optional") {
      return this.typesIntersect(left, right.inner, enumStringVeto) || this.typesIntersect(left, nullType, enumStringVeto);
    }
    return isAssignable(left, right, this) || isAssignable(right, left, this);
  }

  private equalityGuidance(leftSource: ValueType, rightSource: ValueType): string {
    const left = this.resolveNamedClasses(this.expandAliases(leftSource));
    const right = this.resolveNamedClasses(this.expandAliases(rightSource));
    const leftEnum = this.valueLevelEnum(left);
    const rightEnum = this.valueLevelEnum(right);
    const enumSide = leftEnum ?? rightEnum;
    // A union operand that mixes the enum domain with raw strings has no
    // deliberate comparison to teach until the author knows which domain the
    // value is in, so the way out is narrowing first (ENM-I2).
    const mixedUnion = (leftEnum !== null && this.hasValueLevelString(left)) ? leftEnum
      : (rightEnum !== null && this.hasValueLevelString(right)) ? rightEnum
        : null;
    if (mixedUnion !== null) {
      return `; narrow the union first — 'if value is ${mixedUnion.name}:' — and compare inside the branch`;
    }
    // The rejection itself needs an exact enum-versus-string pair, but the
    // guidance is worth giving whenever one side can hold a bare string and
    // the other an enum member — that is the mistake, wrapped or not.
    // MIG-1: both spellings are honest, but they behave differently on an
    // unknown value — parse throws, str compares — so the message states the
    // choosing rule instead of ranking one first. Recommending parse alone
    // broke a forward-compatible protocol handler in the referee migration:
    // it compiled clean and then threw on the first unknown wire tag.
    if (enumSide !== null && this.hasValueLevelString(leftEnum === null ? left : right)) {
      const member = enumSide.kind === "enumMember" ? `${enumSide.name}.${enumSide.member}` : `${enumSide.name}.member`;
      return `; an enum member converts to string only as a one-way wire exit, so choose by what an unknown value means here:`
        + ` write ${enumSide.name}.parse(text) == ${member} when the text must name a member — ${enumSide.name}.parse throws on anything else —`
        + ` or str(${member}) == text when unknown values are expected and must be ignored, as on an open wire protocol`;
    }
    if (left.kind === "null" || right.kind === "null") {
      const value = left.kind === "null" ? right : left;
      return `; ${describeType(value)} is never null — drop the check, or declare the value ${describeType(value)}? if absence is real`;
    }
    return "";
  }

  private valueLevelEnum(source: ValueType): Extract<ValueType, { kind: "enum" | "enumMember" }> | null {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    if (type.kind === "enum" || type.kind === "enumMember") return type;
    if (type.kind === "optional") return this.valueLevelEnum(type.inner);
    if (type.kind === "union") {
      for (const member of type.members) {
        const found = this.valueLevelEnum(member);
        if (found) return found;
      }
    }
    return null;
  }

  private hasValueLevelString(source: ValueType): boolean {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    if (type.kind === "string") return true;
    if (type.kind === "optional") return this.hasValueLevelString(type.inner);
    if (type.kind === "union") return type.members.some((member) => this.hasValueLevelString(member));
    return false;
  }

  // D36 item 41: `==`/`!=` are SameValueZero, but the repair only matters
  // when both operands can be NaN at runtime. NaN lives exclusively inside
  // JavaScript numbers, so any operand whose static type excludes number
  // (and the unchecked kinds that could hide one) proves the repair away and
  // the emitter keeps plain `===`. A numeric literal operand is the value
  // check's degenerate case: NaN has no literal spelling, so the literal
  // itself can never be NaN.
  private equalityOperandMayBeNaN(expression: Expression, type: ValueType): boolean {
    if (expression.kind === "LiteralExpression" && typeof expression.value === "number") return false;
    if (expression.kind === "UnaryExpression"
      && (expression.operator === "-" || expression.operator === "+")
      && expression.operand.kind === "LiteralExpression"
      && typeof expression.operand.value === "number") return false;
    return this.equalityMayCompareNaN(type);
  }

  private equalityMayCompareNaN(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    switch (expanded.kind) {
      case "number":
      case "any":
      case "unknown":
      case "parameter":
        return true;
      case "optional":
        return this.equalityMayCompareNaN(expanded.inner);
      case "union":
        return expanded.members.some((member) => this.equalityMayCompareNaN(member));
      case "named":
        return expanded.name === "number";
      default:
        return false;
    }
  }

  private coalescingFallbackContext(left: ValueType, contextualType: ValueType): ValueType {
    const expandedContext = this.expandAliases(contextualType);
    if (expandedContext.kind !== "unknown" && !isInvalidType(expandedContext)) return contextualType;
    return left.kind === "optional" ? left.inner : unknownType;
  }

  private requireOrderedComparison(
    leftType: ValueType,
    rightType: ValueType,
    leftExpression: Expression,
    rightExpression: Expression,
    operationSpan: Span,
  ): void {
    const left = this.expandAliases(leftType);
    const right = this.expandAliases(rightType);
    if (isInvalidType(left) || isInvalidType(right)) return;
    if (left.kind === "any" || right.kind === "any") return;
    const category = this.orderedTypeCategory(left);
    if (category !== null && category !== "dynamic" && category === this.orderedTypeCategory(right)) {
      // TXT-D1: a string ordering lowers through the code-point comparator.
      // Both the binary span and the chain-link span are recorded because
      // the two emitters key their lookups differently (exactly as the
      // SameValueZero hint does).
      const marked = category === "string" ? this.stringOrderings : category === "comparable" ? this.dynamicOrderings : null;
      if (marked) {
        marked.add(spanIdentity(operationSpan));
        marked.add(spanIdentity({ start: leftExpression.span.start, end: rightExpression.span.end }));
      }
      return;
    }
    this.typeError(
      `Ordered comparison requires two numbers or two strings, received ${describeType(leftType)} and ${describeType(rightType)}${this.unorderedTypeGuidance(left, right)}`,
      { start: leftExpression.span.start, end: Math.max(rightExpression.span.end, operationSpan.end) },
    );
  }

  // Diagnostic-only companion to `orderedTypeCategory`: an enum reaching an
  // ordering site is the one rejection with a non-obvious way out, because the
  // runtime value is a bare string and the order the author means is never the
  // member-name alphabet (D42 item 65).
  private unorderedTypeGuidance(...types: readonly ValueType[]): string {
    return types.some((type) => this.mentionsEnumType(type))
      ? "; an enum carries no runtime order, so state the order explicitly with sorted(by=rank) or a string-backed enum whose values encode it"
      : "";
  }

  private mentionsEnumType(source: ValueType): boolean {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    if (type.kind === "enum" || type.kind === "enumMember") return true;
    if (type.kind === "optional") return this.mentionsEnumType(type.inner);
    if (type.kind === "union") return type.members.some((member) => this.mentionsEnumType(member));
    if (type.kind === "list" || type.kind === "set") return this.mentionsEnumType(type.element);
    return false;
  }

  protected inferParameterDefault(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    this.parameterDefaultDepth += 1;
    const result = this.inferExpression(expression, contextualType);
    this.parameterDefaultDepth -= 1;
    return result;
  }

  protected resolvedAsyncResult(type: ValueType): ValueType {
    const expanded = this.expandAliases(type);
    const resolved = resolvedAsyncType(expanded);
    return sameType(expanded, resolved) ? type : resolved;
  }

  private asyncResultContainsPromise(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    return !sameType(expanded, resolvedAsyncType(expanded));
  }

  private callableThenMember(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "any" || expanded.kind === "unknown") return !isInvalidType(expanded);
    if (expanded.kind === "optional") return this.callableThenMember(expanded.inner);
    if (expanded.kind === "union") return expanded.members.some((member) => this.callableThenMember(member));
    return expanded.kind === "function"
      || expanded.kind === "action"
      || expanded.kind === "intrinsic"
      || expanded.kind === "classConstructor";
  }

  private promiseResolutionHazard(type: ValueType): string | null {
    const expanded = this.resolveNamedClasses(this.expandAliases(type));
    if (expanded.kind === "optional") return this.promiseResolutionHazard(expanded.inner);
    if (expanded.kind === "union") {
      for (const member of expanded.members) {
        const hazard = this.promiseResolutionHazard(member);
        if (hazard) return hazard;
      }
      return null;
    }
    if (expanded.kind === "object") {
      const then = expanded.fields.get("then");
      return then && this.callableThenMember(then) ? "its 'then' data field may be callable" : null;
    }
    if (expanded.kind === "named") {
      const identity = expanded.identity ?? expanded.name;
      const then = this.fieldsOf(identity)?.get("then");
      return then && this.callableThenMember(then) ? `type '${expanded.name}' exposes a callable 'then' data field` : null;
    }
    if (expanded.kind !== "class") return null;
    const identity = expanded.identity ?? expanded.name;
    if (this.findGetter(identity, "then") || this.findGetter(expanded.name, "then")) {
      return `class '${expanded.name}' exposes a 'then' getter that Promise resolution would execute`;
    }
    if (this.findMethod(identity, "then") || this.findMethod(expanded.name, "then")) {
      return `class '${expanded.name}' exposes a callable 'then' method`;
    }
    const field = this.findField(identity, "then") ?? this.findField(expanded.name, "then");
    return field && this.callableThenMember(field.type)
      ? `class '${expanded.name}' exposes a callable 'then' field`
      : null;
  }

  private promiseResolutionNeedsRuntimeGuard(type: ValueType): boolean {
    if (isInvalidType(type)) return false;
    const expanded = this.resolveNamedClasses(this.expandAliases(type));
    if (expanded.kind === "optional") return this.promiseResolutionNeedsRuntimeGuard(expanded.inner);
    if (expanded.kind === "union") return expanded.members.some((member) => this.promiseResolutionNeedsRuntimeGuard(member));
    return expanded.kind !== "null"
      && expanded.kind !== "string"
      && expanded.kind !== "number"
      && expanded.kind !== "bool"
      && expanded.kind !== "enum"
      && expanded.kind !== "enumMember"
      && expanded.kind !== "promise";
  }

  private reportPromiseResolutionHazard(type: ValueType, errorSpan: Span): void {
    const hazard = this.promiseResolutionHazard(type);
    if (!hazard) return;
    const key = spanIdentity(errorSpan);
    if (this.reportedPromiseResolutionHazards.has(key)) return;
    this.reportedPromiseResolutionHazards.add(key);
    this.diagnostics.push(diagnostic(
      "VEL4024",
      `A Promise cannot resolve to ${describeType(type)} because ${hazard}; JavaScript would treat the value as a magic thenable. Rename 'then' or keep this value outside an async result`,
      errorSpan,
    ));
  }

  private reportPromiseCarrierHazard(type: ValueType, errorSpan: Span): void {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "promise") this.reportPromiseResolutionHazard(expanded.value, errorSpan);
    else if (expanded.kind === "optional") this.reportPromiseCarrierHazard(expanded.inner, errorSpan);
    else if (expanded.kind === "union") {
      for (const member of expanded.members) this.reportPromiseCarrierHazard(member, errorSpan);
    }
  }

  private inferArrow(expression: ArrowFunctionExpression, contextualType: ValueType): ValueType {
    const expandedContext = this.expandAliases(contextualType);
    const expected = expandedContext.kind === "function"
      ? expandedContext
      : expandedContext.kind === "optional" && expandedContext.inner.kind === "function"
        ? expandedContext.inner
        : null;
    const outerClassFieldInitializerDepth = this.classFieldInitializerDepth;
    const outerStaticFieldInitialization = this.staticFieldInitialization;
    this.classFieldInitializerDepth = 0;
    this.staticFieldInitialization = null;
    this.enterScope();
    this.flowFrameDepth += 1;
    this.functionDepth += 1;
    const previousFinallyLoopDepths = this.finallyLoopDepths;
    this.finallyLoopDepths = [];
    this.asynchronousFunctions.push(expression.asynchronous);
    const parameterTypes: ValueType[] = [];
    let rest: ValueType | undefined;
    let fixedIndex = 0;
    for (const parameter of expression.parameters) {
      const contextualParameter = parameter.rest ? expected?.rest : expected?.parameters[fixedIndex];
      const annotated = parameter.type ? this.resolveAnnotation(parameter.type) : null;
      const annotationValid = parameter.type ? this.validateTypeReference(parameter.type) : true;
      const defaultType = !annotated && !contextualParameter && parameter.defaultValue
        ? this.inferParameterDefault(parameter.defaultValue)
        : null;
      const type = annotationValid ? annotated ?? contextualParameter ?? defaultType ?? unknownType : invalidType;
      if (parameter.defaultValue && !defaultType && annotationValid) {
        const actualDefault = this.inferParameterDefault(parameter.defaultValue, type);
        this.requireAssignable(actualDefault, type, parameter.defaultValue.span);
      }
      this.declareBinding(parameter.name, false, parameter.rest ? { kind: "list", element: type } : type, parameter.span);
      if (parameter.rest) rest = type;
      else {
        parameterTypes.push(type);
        fixedIndex += 1;
      }
    }
    const expectedResult = expected?.result ?? unknownType;
    const expandedExpectedResult = this.expandAliases(expectedResult);
    const contextualResult = expression.asynchronous && expandedExpectedResult.kind === "promise"
      ? resolvedAsyncType(expandedExpectedResult.value)
      : expectedResult;
    const outerParameterDefaultDepth = this.parameterDefaultDepth;
    const outerConstructorDepth = this.constructorDepth;
    this.parameterDefaultDepth = 0;
    this.constructorDepth = 0;
    const bodyResult = this.inferExpression(expression.body, contextualResult);
    this.parameterDefaultDepth = outerParameterDefaultDepth;
    this.constructorDepth = outerConstructorDepth;
    const checkedBodyResult = expected
      && expandedExpectedResult.kind !== "unknown"
      && expandedExpectedResult.kind !== "any"
      && this.contextuallyAssignable(bodyResult, contextualResult, expression.body.span)
      ? contextualResult
      : bodyResult;
    const result = expression.asynchronous
      ? { kind: "promise", value: this.resolvedAsyncResult(checkedBodyResult) } satisfies ValueType
      : checkedBodyResult;
    if (expression.asynchronous) {
      const contextualHazard = expandedExpectedResult.kind === "promise"
        ? this.promiseResolutionHazard(expandedExpectedResult.value)
        : null;
      if (!contextualHazard) this.reportPromiseCarrierHazard(result, expression.body.span);
      if (result.kind === "promise" && this.promiseResolutionNeedsRuntimeGuard(result.value)) {
        this.asyncResolvedValues.add(spanIdentity(expression.body.span));
      }
    }
    this.asynchronousFunctions.pop();
    this.finallyLoopDepths = previousFinallyLoopDepths;
    this.functionDepth -= 1;
    this.flowFrameDepth -= 1;
    this.exitScope();
    this.classFieldInitializerDepth = outerClassFieldInitializerDepth;
    this.staticFieldInitialization = outerStaticFieldInitialization;
    return {
      kind: "function",
      parameters: parameterTypes,
      parameterNames: expression.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
      requiredParameters: expression.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { rest } : {}),
      result,
    };
  }

  private inferCall(
    calleeExpression: Expression,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    contextualType: ValueType = unknownType,
    optionalCall = false,
  ): ValueType {
    const hasNamed = argumentNames?.some((name) => name !== null) ?? false;
    const javaScriptBoundary = this.javaScriptBoundaryCallee(calleeExpression);
    if (javaScriptBoundary) {
      this.javaScriptCallBoundaries.add(spanIdentity(callSpan));
      // BRG-U10: at module initialization, a synchronous non-Error throw
      // from an extern call would reach the host raw; the emitter wraps
      // these sites so the value is normalized through the owned channel.
      if (this.functionDepth === 0) this.moduleTopLevelHostCalls.add(spanIdentity(callSpan));
    }
    if (calleeExpression.kind === "SuperExpression") {
      if (optionalCall) this.typeError("A base constructor call cannot be optional", callSpan);
      const baseName = this.currentClass ? this.classes.get(this.currentClass)?.base ?? null : null;
      if (this.constructorDepth === 0 || !baseName || spanIdentity(callSpan) !== this.allowedSuperCall) {
        this.typeError("'super(...)' is only available as the first statement of a derived constructor", callSpan);
        for (const argument of arguments_) this.inferExpression(argument);
        return nullType;
      }
      const base = this.classes.get(baseName);
      this.checkArguments(arguments_, base?.parameters ?? [], callSpan, base?.requiredParameters, base?.constructorRest, argumentNames, base?.parameterNames);
      return nullType;
    }
    if (optionalCall) {
      const original = this.inferExpression(calleeExpression);
      const resolvedOriginal = this.expandAliases(original);
      const callee = resolvedOriginal.kind === "optional" ? resolvedOriginal.inner : resolvedOriginal;
      if (isInvalidType(callee)) return invalidType;
      if (callee.kind === "function" || callee.kind === "action") {
        const result = this.withTemporaryNarrowings(this.optionalExecutionNarrowings(calleeExpression), callSpan, () => {
          if (callee.typeParameterNames?.length) return this.inferGenericCall(callee, arguments_, argumentNames, callSpan);
          this.checkArguments(arguments_, callee.parameters, callSpan, callee.requiredParameters, callee.rest, argumentNames, callee.parameterNames);
          return callee.result;
        });
        this.optionalCallees.add(spanIdentity(callSpan));
        return optionalOf(result);
      }
      if (callee.kind === "any") {
        this.withTemporaryNarrowings(this.optionalExecutionNarrowings(calleeExpression), callSpan, () => {
          for (const argument of arguments_) this.inferExpression(argument);
        });
        this.optionalCallees.add(spanIdentity(callSpan));
        return anyType;
      }
      this.typeError(`Optional call requires a function, received ${describeType(original)}`, callSpan);
      for (const argument of arguments_) this.inferExpression(argument);
      return unknownType;
    }
    // The built-in str() shares the f-string text-conversion contract: its
    // argument is checked against the conversion whitelist instead of the
    // declared 'any' parameter. A user binding named 'str' shadows the
    // builtin and keeps its own declared parameter checking.
    if (calleeExpression.kind === "IdentifierExpression" && calleeExpression.name === "str"
      && !this.lookup("str") && arguments_.length === 1
      && arguments_[0]!.kind !== "SpreadExpression"
      && (argumentNames?.[0] == null || argumentNames[0] === "value")) {
      const argument = arguments_[0]!;
      this.requireTextConvertible(this.inferExpression(argument), argument.span, "str");
      return stringType;
    }
    if (calleeExpression.kind === "IdentifierExpression" && calleeExpression.name === "Map") {
      const collectionContext = this.contextualCollectionType(contextualType);
      const expectedMap = collectionContext?.kind === "map" ? collectionContext : null;
      const named = this.planNamedArguments(arguments_, argumentNames, [unknownType], ["source"], 0, callSpan);
      if (named && !named.valid) {
        for (const argument of arguments_) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
        return expectedMap ?? { kind: "map", key: unknownType, value: unknownType };
      }
      const ordered = named?.ordered ?? arguments_;
      if (ordered.length > 1) this.typeError(`Expected 0-1 arguments but received ${ordered.length}`, callSpan);
      const argument = ordered[0];
      if (!argument || (argument.kind === "IdentifierExpression" && argument.name === "\u0000omitted-named-argument")) {
        return expectedMap ?? { kind: "map", key: unknownType, value: unknownType };
      }
      if (argument.kind === "ListExpression") {
        let key = unknownType;
        let value = unknownType;
        for (const entry of argument.elements) {
          if (entry.kind !== "ListExpression" || entry.elements.length !== 2 || entry.elements.some((item) => item.kind === "SpreadExpression")) {
            this.inferExpression(entry);
            this.typeError("Map entry construction requires each List item to contain exactly [key, value]", entry.span);
            continue;
          }
          const entryKey = this.inferExpression(entry.elements[0]!, expectedMap?.key ?? unknownType);
          const entryValue = this.inferExpression(entry.elements[1]!, expectedMap?.value ?? unknownType);
          if (expectedMap) {
            this.requireAssignable(entryKey, expectedMap.key, entry.elements[0]!.span);
            this.requireAssignable(entryValue, expectedMap.value, entry.elements[1]!.span);
          }
          key = mergeTypes(key, entryKey);
          value = mergeTypes(value, entryValue);
        }
        for (const extra of ordered.slice(1)) this.inferExpression(extra);
        if (argument.elements.length > 0) this.rejectCollidingKeyDomain(key, argument.span, "Map key type");
        return argument.elements.length === 0 && expectedMap ? expectedMap : { kind: "map", key, value };
      }
      const source = this.inferExpression(argument, expectedMap ?? unknownType);
      for (const extra of ordered.slice(1)) this.inferExpression(extra);
      if (source.kind === "map") return {
        kind: "map",
        key: source.readonlyView ? this.readonlyDataViewOf(source.key) : source.key,
        value: source.readonlyView ? this.readonlyDataViewOf(source.value) : source.value,
      };
      if (source.kind === "list") {
        const sourceElement = source.readonlyView ? this.readonlyDataViewOf(source.element) : source.element;
        if (sourceElement.kind === "list") {
          const entryElement = sourceElement.readonlyView ? this.readonlyDataViewOf(sourceElement.element) : sourceElement.element;
          this.rejectCollidingKeyDomain(entryElement, argument.span, "Map key type");
          return { kind: "map", key: entryElement, value: entryElement };
        }
      }
      if (source.kind === "object") {
        let value = unknownType;
        for (const field of source.fields.values()) value = mergeTypes(value, source.readonlyView ? this.readonlyDataViewOf(field) : field);
        if (expectedMap) {
          this.requireAssignable(stringType, expectedMap.key, argument.span);
          for (const field of source.fields.values()) {
            this.requireAssignable(source.readonlyView ? this.readonlyDataViewOf(field) : field, expectedMap.value, argument.span);
          }
        }
        return source.fields.size === 0 && expectedMap ? expectedMap : { kind: "map", key: stringType, value };
      }
      if (source.kind === "any") return { kind: "map", key: anyType, value: anyType };
      this.typeError(`Map construction requires a Map, a List of [key, value] Lists, or a record, received ${describeType(source)}`, argument.span);
      return { kind: "map", key: unknownType, value: unknownType };
    }
    if (calleeExpression.kind === "IdentifierExpression" && calleeExpression.name === "Set") {
      const collectionContext = this.contextualCollectionType(contextualType);
      const named = this.planNamedArguments(arguments_, argumentNames, [unknownType], ["source"], 0, callSpan);
      if (named && !named.valid) {
        for (const argument of arguments_) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
        return collectionContext?.kind === "set" ? collectionContext : { kind: "set", element: unknownType };
      }
      const ordered = named?.ordered ?? arguments_;
      if (ordered.length > 1) this.typeError(`Expected 0-1 arguments but received ${ordered.length}`, callSpan);
      const argument = ordered[0];
      if (!argument || (argument.kind === "IdentifierExpression" && argument.name === "\u0000omitted-named-argument")) {
        return collectionContext?.kind === "set" ? collectionContext : { kind: "set", element: unknownType };
      }
      const source = this.inferExpression(argument, collectionContext?.kind === "set" ? { kind: "list", element: collectionContext.element } : unknownType);
      for (const extra of ordered.slice(1)) this.inferExpression(extra);
      if (source.kind === "list" || source.kind === "set") {
        const element = source.readonlyView ? this.readonlyDataViewOf(source.element) : source.element;
        this.rejectCollidingKeyDomain(element, argument.span, "Set element type");
        return { kind: "set", element };
      }
      if (source.kind === "any") return { kind: "set", element: anyType };
      this.typeError(`Set construction requires a List or Set, received ${describeType(source)}`, argument.span);
      return { kind: "set", element: unknownType };
    }

    if (calleeExpression.kind === "MemberExpression" && calleeExpression.object.kind !== "SuperExpression") {
      // The collection/primitive call paths infer the receiver before
      // inferMember can sanction it, so a class-name receiver (`P.make(...)`)
      // is sanctioned here first (D45 rule 75).
      this.memberAccessReceivers.add(spanIdentity(calleeExpression.object.span));
      const primitiveResult = this.inferPrimitiveCall(calleeExpression, arguments_, argumentNames, callSpan);
      if (primitiveResult) return primitiveResult;
      const collectionResult = this.inferCollectionCall(calleeExpression, arguments_, argumentNames, callSpan);
      if (collectionResult) {
        this.invalidateMutableCollectionCallReceiver(calleeExpression);
        return collectionResult;
      }
    }

    // A direct call is a sanctioned class-name position (D45 rule 75), and a
    // member callee is a method call rather than a method-value read (D44
    // rule 74). Both facts are recorded before the callee is inferred.
    this.callExpressionCallees.add(spanIdentity(calleeExpression.span));
    const diagnosticsBeforeCallee = this.diagnostics.length;
    const inferredCallee = this.inferExpression(calleeExpression);
    const callee = this.expandAliases(inferredCallee);
    const calleeAlreadyDiagnosed = this.diagnostics.length > diagnosticsBeforeCallee;
    if (callee.kind === "classConstructor") {
      this.constructorCalls.add(spanIdentity(callSpan));
      const info = this.classes.get(callee.identity ?? callee.name) ?? this.classes.get(callee.name);
      if (info?.abstract) this.typeError(`Cannot instantiate abstract class '${callee.name}'`, callSpan);
      // A field initializer runs on every construction, so constructing the
      // declaring class (or one of its subclasses, whose construction runs
      // these same initializers) can never finish — it overflows the stack at
      // the first construction. Arrows inside the initializer stay legal:
      // they defer the construction (classFieldInitializerDepth is zeroed).
      if (this.classFieldInitializerDepth > 0 && this.instanceFieldInitializerDepth > 0 && this.currentClass
        && (callee.name === this.currentClass || this.isSubclassOf(callee.name, this.currentClass))) {
        this.typeError(
          `Field initializer constructs '${callee.name}' on every '${this.currentClass}' construction and can never finish; assign it in the constructor from a parameter, or create it lazily`,
          callSpan,
        );
      }
      // BRG-U6: extern constructors are not inherited (a derived extern
      // class without its own `constructor(...)` takes zero arguments —
      // opposite of JavaScript), so calling one with arguments teaches the
      // redeclaration instead of a bare arity mismatch.
      if (info && callee.identity?.startsWith("js:") === true && info.base !== null
        && info.parameters.length === 0 && info.requiredParameters === 0 && !info.constructorRest
        && arguments_.length > 0 && !argumentNames?.some((name) => name !== null)) {
        for (const argument of arguments_) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
        this.typeError(
          `Extern class '${callee.name}' declares no constructor, and extern constructors are not inherited from the base class; redeclare 'constructor(...)' on '${callee.name}' with the base signature`,
          callSpan,
        );
        return {
          kind: "class",
          name: callee.name,
          ...(callee.identity ? { identity: callee.identity } : {}),
        };
      }
      this.checkArguments(arguments_, info?.parameters ?? [], callSpan, info?.requiredParameters, info?.constructorRest, argumentNames, info?.parameterNames);
      return {
        kind: "class",
        name: callee.name,
        ...(callee.identity ? { identity: callee.identity } : {}),
      };
    }
    if (callee.kind === "intrinsic") {
      const result = this.inferIntrinsicCall(callee, arguments_, argumentNames, callSpan);
      return result;
    }
    if (callee.kind === "extension") {
      const extensionResult = this.inferExtensionCall(callee, arguments_, argumentNames, callSpan);
      if (extensionResult) return extensionResult;
    }
    if (callee.kind === "function" || callee.kind === "action") {
      if (callee.typeParameterNames?.length) {
        const result = this.inferGenericCall(callee, arguments_, argumentNames, callSpan);
        this.reportPromiseCarrierHazard(result, callSpan);
        if (result.kind === "optional") this.optionalCalls.add(spanIdentity(callSpan));
        return result;
      }
      if (calleeExpression.kind === "MemberExpression" && calleeExpression.property === "parse"
        && arguments_[0]?.kind === "ObjectExpression" && callee.result.kind === "named") {
        this.recordRuntimeObjectShape(arguments_[0], callee.result);
      }
      this.checkArguments(arguments_, callee.parameters, callSpan, callee.requiredParameters, callee.rest, argumentNames, callee.parameterNames);
      this.rejectDisjointEnumValidatorProbe(calleeExpression, arguments_);
      this.reportPromiseCarrierHazard(callee.result, callSpan);
      if (callee.result.kind === "optional") this.optionalCalls.add(spanIdentity(callSpan));
      return callee.result;
    }
    if (callee.kind === "optional" && (callee.inner.kind === "function" || callee.inner.kind === "action")) {
      const inner = callee.inner;
      const result = this.withTemporaryNarrowings(this.optionalExecutionNarrowings(calleeExpression), callSpan, () => {
        if (inner.typeParameterNames?.length) return this.inferGenericCall(inner, arguments_, argumentNames, callSpan);
        this.checkArguments(arguments_, inner.parameters, callSpan, inner.requiredParameters, inner.rest, argumentNames, inner.parameterNames);
        return inner.result;
      });
      this.reportPromiseCarrierHazard(result, callSpan);
      if (!continuesOptionalChain(calleeExpression)) {
        this.typeError("Use a presence check or an optional access chain before calling an optional function", calleeExpression.span);
      }
      this.optionalCalls.add(spanIdentity(callSpan));
      this.optionalCallees.add(spanIdentity(callSpan));
      return optionalOf(result);
    }
    if (callee.kind === "any") {
      if (hasNamed) this.typeError("Named arguments require a statically known callable signature", callSpan);
      for (const argument of arguments_) {
        this.inferExpression(argument);
      }
      return anyType;
    }
    if (callee.kind === "unknown") {
      if (isInvalidType(callee)) return invalidType;
      if (!calleeAlreadyDiagnosed) {
        if (hasNamed) this.typeError("Named arguments require a statically known callable signature", callSpan);
        for (const argument of arguments_) {
          this.inferExpression(argument);
        }
        this.typeError("Cannot call an unknown JavaScript value without a declaration or validation", callSpan);
      }
      return unknownType;
    }
    if (callee.kind === "typeObject") {
      for (const argument of arguments_) {
        this.inferExpression(argument);
      }
      this.typeError(
        `Use a record literal '{field: value, ...}' to build a '${callee.name}' value; a 'type' declares a shape, not a constructor`,
        callSpan,
      );
      return this.invalidDeclaredTypes.has(callee.name)
        ? invalidType
        : this.typeAliases.get(callee.name) ?? { kind: "named", name: callee.name };
    }
    for (const argument of arguments_) {
      this.inferExpression(argument);
    }
    this.typeError(`${describeType(callee)} is not callable`, callSpan);
    return unknownType;
  }

  private javaScriptBoundaryCallee(expression: Expression): boolean {
    if (expression.kind === "IdentifierExpression") {
      if (this.javaScriptBindings.has(expression.name)) return true;
      const type = this.lookup(expression.name)?.type;
      return (type?.kind === "class" || type?.kind === "classConstructor") && type.identity?.startsWith("js:") === true;
    }
    if (expression.kind !== "MemberExpression") return false;
    if (this.javaScriptBoundaryCallee(expression.object)) return true;
    const type = expression.object.kind === "IdentifierExpression" ? this.lookup(expression.object.name)?.type : null;
    return (type?.kind === "class" || type?.kind === "classConstructor") && type.identity?.startsWith("js:") === true;
  }

  // Two-phase call-site unification for generic callables: phase 1 infers
  // non-arrow arguments and collects bindings; phase 2 gives arrows contextual
  // types with the phase-1 substitution applied, then unifies their results.
  // Unsolved type parameters substitute unknown.
  private inferGenericCall(
    callee: Extract<ValueType, { kind: "function" | "action" }>,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType {
    const bindings: (ValueType | null)[] = Array.from({ length: callee.typeParameterNames?.length ?? 0 }, () => null);
    const fieldsOf = (identity: string): ReadonlyMap<string, ValueType> | null => this.fieldsOf(identity);
    const substitute = (declared: ValueType): ValueType => substituteTypeParameters(declared, bindings);
    const solvedContext = (declared: ValueType): ValueType =>
      typeContainsParameter(declared, (parameter) => bindings[parameter.index] == null) ? unknownType : substitute(declared);

    interface PlannedArgument {
      readonly value: Expression;
      readonly declared: ValueType | null;
      readonly errorSpan: Span;
      readonly spreadList: boolean;
    }
    const planned: PlannedArgument[] = [];
    const plan = this.planNamedArguments(arguments_, argumentNames, callee.parameters, callee.parameterNames, callee.requiredParameters, callSpan, callee.rest);
    if (plan) {
      for (const [source, target] of plan.targets.entries()) {
        const argument = arguments_[source]!;
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        planned.push({ value, declared: target === null ? null : callee.parameters[target] ?? callee.rest ?? null, errorSpan: argument.span, spreadList: false });
      }
      if (!plan.valid) {
        for (const item of planned) this.inferExpression(item.value, item.declared ? solvedContext(item.declared) : unknownType);
        return substitute(callee.result);
      }
    } else {
      const hasSpread = arguments_.some((argument) => argument.kind === "SpreadExpression");
      if (!hasSpread && (arguments_.length < callee.requiredParameters || (!callee.rest && arguments_.length > callee.parameters.length))) {
        const expected = callee.rest
          ? `at least ${callee.requiredParameters}`
          : callee.requiredParameters === callee.parameters.length ? String(callee.parameters.length) : `${callee.requiredParameters}-${callee.parameters.length}`;
        this.typeError(`Expected ${expected} ${argumentNoun(expected)} but received ${arguments_.length}`, callSpan);
      }
      let fixedIndex = 0;
      let sawSpread = false;
      for (const argument of arguments_) {
        if (argument.kind === "SpreadExpression") {
          sawSpread = true;
          if (!callee.rest) this.typeError("Call spread requires a callable with a rest parameter", argument.span);
          else if (fixedIndex < callee.parameters.length) {
            this.typeError(`Provide all ${callee.parameters.length} fixed argument${callee.parameters.length === 1 ? "" : "s"} before a call spread`, argument.span);
          }
          planned.push({ value: argument.value, declared: callee.rest ?? null, errorSpan: argument.span, spreadList: true });
          fixedIndex = callee.parameters.length;
          continue;
        }
        const declared = sawSpread ? callee.rest ?? null : callee.parameters[fixedIndex] ?? callee.rest ?? null;
        planned.push({ value: argument, declared, errorSpan: argument.span, spreadList: false });
        if (!sawSpread && fixedIndex < callee.parameters.length) fixedIndex += 1;
      }
    }

    const actuals = new Map<PlannedArgument, ValueType>();
    const deferredArrows: PlannedArgument[] = [];
    for (const item of planned) {
      if (item.value.kind === "ArrowFunctionExpression") {
        deferredArrows.push(item);
        continue;
      }
      const context = item.declared
        ? solvedContext(item.spreadList ? { kind: "list", element: item.declared } : item.declared)
        : unknownType;
      const actual = this.inferExpression(item.value, context);
      actuals.set(item, actual);
      if (!item.declared) continue;
      if (item.spreadList) {
        const expanded = this.expandAliases(actual);
        if (expanded.kind === "list") unifyTypeParameters(item.declared, expanded.element, bindings, fieldsOf);
      } else {
        unifyTypeParameters(item.declared, actual, bindings, fieldsOf);
      }
    }
    for (const item of deferredArrows) {
      const context = item.declared ? substitute(item.declared) : unknownType;
      const actual = this.inferExpression(item.value, context);
      actuals.set(item, actual);
      if (item.declared) unifyTypeParameters(item.declared, actual, bindings, fieldsOf);
    }
    this.reportGenericBoundViolations(callee, bindings, planned, callSpan);
    for (const item of planned) {
      const actual = actuals.get(item) ?? unknownType;
      if (!item.declared) continue;
      if (item.spreadList) {
        const expanded = this.expandAliases(actual);
        if (expanded.kind === "list") this.requireAssignable(expanded.element, substitute(item.declared), item.errorSpan);
        else if (expanded.kind !== "any") this.typeError(`Call spread requires a List, received ${describeType(actual)}`, item.errorSpan);
        continue;
      }
      this.requireAssignable(actual, substitute(item.declared), item.errorSpan);
    }
    return substitute(callee.result);
  }

  /**
   * D41 item 61 check site 1: once the two-phase inference has solved the
   * bindings, every bound is verified before the ordinary assignability loop
   * runs, so a rejected type argument is reported once, at its cause.
   */
  private reportGenericBoundViolations(
    callee: Extract<ValueType, { kind: "function" | "action" | "intrinsic" }>,
    bindings: readonly (ValueType | null)[],
    planned: readonly { readonly declared: ValueType | null; readonly errorSpan: Span }[],
    callSpan: Span,
  ): void {
    const violations = collectGenericBoundViolations(callee, bindings, (type, bound) => this.satisfiesBound(type, bound));
    for (const violation of violations) {
      // "Report at the cause" (D31 item 27). The one shape it cannot serve is
      // a parameter several arguments merged into: there is no single cause,
      // so the call itself reports and names the type that was solved.
      const causes = planned.filter((item) => item.declared !== null
        && typeContainsParameter(item.declared, (parameter) => parameter.index === violation.index));
      const guidance = boundVocabularyGuidance[violation.bound];
      this.diagnostics.push(causes.length === 1
        ? diagnostic(
          "VEL4031",
          `Type parameter '${violation.name}' is bound by ${violation.bound}, so this argument cannot be ${describeType(violation.solved)}; ${guidance}`,
          causes[0]!.errorSpan,
        )
        : diagnostic(
          "VEL4031",
          `Type parameter '${violation.name}' is bound by ${violation.bound} but the arguments solve it to ${describeType(violation.solved)}; ${guidance}`,
          callSpan,
        ));
    }
  }

  /**
   * D41 item 61 check site 2: a generic callable used as a value is solved and
   * erased silently, so the wrapper re-asks the bound question and turns the
   * rejection into a directed message at the value's own span.
   */
  private genericBoundViolation(actual: ValueType, expected: ValueType): GenericBoundViolation | null {
    if (actual.kind !== "function" && actual.kind !== "action" && actual.kind !== "intrinsic") return null;
    if (!actual.typeParameterBounds?.some((bound) => bound !== null)) return null;
    if (expected.kind !== "function" && expected.kind !== "action" && expected.kind !== "intrinsic") return null;
    if (expected.typeParameterNames?.length) return null;
    const violations: GenericBoundViolation[] = [];
    instantiateGenericCallable(actual, expected, this, violations);
    return violations[0] ?? null;
  }

  // A generic callable used where a concrete callback is expected must not
  // leak its parameter kinds into surrounding inference; instantiate it
  // against the expected shape before reading its result.
  private concreteCallableFor(actual: ValueType, expected: ValueType, errorSpan?: Span): ValueType {
    if (actual.kind !== "function" && actual.kind !== "action" && actual.kind !== "intrinsic") return actual;
    if (!actual.typeParameterNames?.length) return actual;
    if (expected.kind !== "function" && expected.kind !== "action" && expected.kind !== "intrinsic") return actual;
    // The erasure happens here, so this is the last place a rejected bound is
    // still visible; without the report the callback would silently compile.
    if (errorSpan) this.reportFirstClassBoundViolation(actual, expected, errorSpan);
    return instantiateGenericCallable(actual, expected, this);
  }

  /** One diagnostic per site, whichever of the two value paths reaches it first. */
  private reportFirstClassBoundViolation(actual: ValueType, expected: ValueType, errorSpan: Span): boolean {
    const violation = this.genericBoundViolation(actual, expected);
    if (!violation) return false;
    const site = spanIdentity(errorSpan);
    if (this.reportedBoundViolations.has(site)) return true;
    this.reportedBoundViolations.add(site);
    this.diagnostics.push(diagnostic(
      "VEL4031",
      `Type parameter '${violation.name}' is bound by ${violation.bound}, but this ${describeType(expected)} contract solves it to ${describeType(violation.solved)}; ${boundVocabularyGuidance[violation.bound]}`,
      errorSpan,
    ));
    return true;
  }

  private inferIntrinsicCall(
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType {
    if (intrinsic.name === "collections.range") {
      return this.inferRangeCall(intrinsic, sourceArguments, argumentNames, callSpan);
    }
    if (intrinsic.name === "core.equals") {
      return this.inferEqualsCall(intrinsic, sourceArguments, argumentNames, callSpan);
    }
    let arguments_ = sourceArguments;
    let namedPreanalyzed = false;
    const deferredNamedArrows = new Set<Expression>();
    const named = this.planNamedArguments(
      sourceArguments,
      argumentNames,
      intrinsic.parameters,
      intrinsic.parameterNames,
      intrinsic.requiredParameters,
      callSpan,
      intrinsic.rest,
    );
    if (named) {
      for (const [source, target] of named.targets.entries()) {
        const argument = sourceArguments[source]!;
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        if (value.kind === "ArrowFunctionExpression") deferredNamedArrows.add(value);
        else this.inferExpression(value, target === null ? unknownType : intrinsic.parameters[target] ?? intrinsic.rest ?? unknownType);
      }
      if (!named.valid) {
        for (const argument of deferredNamedArrows) this.inferExpression(argument);
        return intrinsic.result;
      }
      arguments_ = named.ordered;
      namedPreanalyzed = true;
    }
    const omitted = (argument: Expression | undefined): boolean => argument?.kind === "IdentifierExpression" && argument.name === "\u0000omitted-named-argument";
    const argumentAt = (index: number): Expression | null => {
      const argument = arguments_[index];
      return !argument || omitted(argument) ? null : argument;
    };
    const suppliedCount = arguments_.reduce((count, argument) => count + (omitted(argument) ? 0 : 1), 0);
    const arity = (minimum = intrinsic.requiredParameters, maximum = intrinsic.parameters.length): void => {
      if (suppliedCount < minimum || suppliedCount > maximum) {
        const expected = maximum === Number.POSITIVE_INFINITY
          ? `at least ${minimum}`
          : minimum === maximum ? String(minimum) : `${minimum}-${maximum}`;
        this.typeError(`Expected ${expected} ${argumentNoun(expected)} but received ${suppliedCount}`, callSpan);
      }
    };
    const inferAt = (index: number, expected: ValueType = unknownType): ValueType => {
      const argument = argumentAt(index);
      if (!argument) return unknownType;
      const deferred = deferredNamedArrows.has(argument);
      const actual = namedPreanalyzed && !deferred
        ? this.inferredExpressionType(argument)
        : this.inferExpression(argument, expected);
      if (deferred) deferredNamedArrows.delete(argument);
      if (expected.kind !== "unknown") this.requireAssignable(actual, expected, argument.span);
      return actual;
    };
    const arrayAt = (index: number): { readonly type: ValueType; readonly element: ValueType } => {
      const type = inferAt(index);
      if (type.kind === "list") return { type, element: type.element };
      if (type.kind === "any") return { type, element: anyType };
      const argument = argumentAt(index);
      if (argument) this.typeError(`Expected a List, received ${describeType(type)}`, argument.span);
      return { type, element: unknownType };
    };
    const callbackAt = (index: number, parameters: readonly ValueType[], result: ValueType): ValueType => {
      const expected: ValueType = { kind: "function", parameters, requiredParameters: parameters.length, result };
      return this.concreteCallableFor(inferAt(index, expected), expected, argumentAt(index)?.span);
    };
    const callbackResult = (type: ValueType): ValueType => type.kind === "function" || type.kind === "action" || type.kind === "intrinsic" ? type.result : type.kind === "any" ? anyType : unknownType;
    const promiseValue = (type: ValueType, index: number): ValueType => {
      if (type.kind === "promise") return type.value;
      if (type.kind === "any") return anyType;
      const argument = argumentAt(index);
      if (argument) this.typeError(`Expected a Promise, received ${describeType(type)}`, argument.span);
      return unknownType;
    };
    const runtimeTypeAt = (index: number): ValueType => {
      const type = inferAt(index);
      if (type.kind === "typeObject") return this.runtimeTypeObjectValue(type);
      if (type.kind === "enumObject") return { kind: "enum", name: type.name, identity: type.identity };
      if (type.kind === "runtimeType") return type.value;
      if (type.kind === "any") return anyType;
      const argument = argumentAt(index);
      if (argument) this.typeError("Runtime parsing requires a VelarScript runtime type", argument.span);
      return unknownType;
    };

    for (const extension of this.analysisExtensions) {
      const result = extension.inferIntrinsic?.({
        intrinsic,
        argumentAt,
        callSpan,
        arity,
        inferAt,
        callbackAt,
        runtimeTypeAt,
        typeError: (message, errorSpan) => this.typeError(message, errorSpan),
        isAssignable: (actual, expected) => isAssignable(actual, expected, this),
        expandAliases: (type) => this.expandAliases(type),
        jsonSerializable: (type) => this.jsonSerializable(type),
        isHttpFormBody: (type) => this.isHttpFormBody(type),
        declaredFieldsOf: (name) => this.namedTypes.get(name) ?? null,
        formReadField: (name, type, fieldSpan) => this.formReadField(name, type, fieldSpan),
        recordFormRead: (sourceSpan, fields) => this.formReads.set(spanIdentity(sourceSpan), fields),
      });
      if (result) return result;
    }

    switch (intrinsic.name) {
      case "collections.enumerate": {
        arity(1, 2);
        const { element } = arrayAt(0);
        inferAt(1, numberType);
        return { kind: "list", element: { kind: "object", fields: new Map([["index", numberType], ["value", element]]) } };
      }
      case "collections.zip": {
        arity(2, 2);
        const left = arrayAt(0).element;
        const right = arrayAt(1).element;
        return { kind: "list", element: { kind: "object", fields: new Map([["first", left], ["second", right]]) } };
      }
      case "collections.unique":
      case "collections.reversed":
      case "collections.compact": {
        arity(1, 1);
        const { element } = arrayAt(0);
        return { kind: "list", element: intrinsic.name === "collections.compact" ? nonOptional(element) : element };
      }
      case "collections.repeat": {
        arity(2, 2);
        const element = inferAt(0);
        inferAt(1, numberType);
        return { kind: "list", element };
      }
      case "collections.has":
      case "collections.count": {
        arity(2, 2);
        const element = arrayAt(0).element;
        inferAt(1, element);
        return intrinsic.name === "collections.has" ? boolType : numberType;
      }
      case "collections.take":
      case "collections.drop": {
        arity(2, 2);
        const { element } = arrayAt(0);
        inferAt(1, numberType);
        return { kind: "list", element };
      }
      case "collections.chunk": {
        arity(2, 2);
        const { element } = arrayAt(0);
        inferAt(1, numberType);
        return { kind: "list", element: { kind: "list", element } };
      }
      case "collections.flatten": {
        arity(1, 1);
        const outer = arrayAt(0).element;
        if (outer.kind === "list") return outer;
        if (outer.kind === "any") return { kind: "list", element: anyType };
        const argument = argumentAt(0);
        if (argument) this.typeError(`flatten expects a List of Lists, received List<${describeType(outer)}>`, argument.span);
        return { kind: "list", element: unknownType };
      }
      case "collections.groupBy":
      case "collections.keyBy":
      case "collections.countBy": {
        arity(2, 2);
        const element = arrayAt(0).element;
        const key = callbackResult(callbackAt(1, [element], unknownType));
        if (intrinsic.name === "collections.groupBy") return { kind: "map", key, value: { kind: "list", element } };
        if (intrinsic.name === "collections.countBy") return { kind: "map", key, value: numberType };
        return { kind: "map", key, value: element };
      }
      case "collections.sortBy": {
        arity(2, 3);
        const element = arrayAt(0).element;
        const key = callbackResult(callbackAt(1, [element], unknownType));
        const keyArgument = argumentAt(1);
        if (this.orderedTypeCategory(key) === null && keyArgument) {
          this.typeError(`sortBy key must return only string or only number, received ${describeType(key)}${this.unorderedTypeGuidance(key)}`, keyArgument.span);
        }
        inferAt(2, boolType);
        return { kind: "list", element };
      }
      case "collections.partition": {
        arity(2, 2);
        const element = arrayAt(0).element;
        callbackAt(1, [element], boolType);
        const list: ValueType = { kind: "list", element };
        return { kind: "object", fields: new Map([["matches", list], ["rest", list]]) };
      }
      case "collections.find": {
        arity(2, 2);
        const element = arrayAt(0).element;
        callbackAt(1, [element], boolType);
        return optionalOf(element);
      }
      case "collections.some":
      case "collections.every": {
        arity(2, 2);
        const element = arrayAt(0).element;
        callbackAt(1, [element], boolType);
        return boolType;
      }
      case "collections.index": {
        arity(2, 2);
        const element = arrayAt(0).element;
        inferAt(1, element);
        return optionalOf(numberType);
      }
      case "collections.first":
      case "collections.last": {
        arity(1, 1);
        return optionalOf(arrayAt(0).element);
      }
      case "collections.minBy":
      case "collections.maxBy": {
        arity(2, 2);
        const element = arrayAt(0).element;
        const key = callbackResult(callbackAt(1, [element], unknownType));
        const keyArgument = argumentAt(1);
        if (this.orderedTypeCategory(key) === null && keyArgument) {
          this.typeError(`${intrinsic.name === "collections.minBy" ? "minBy" : "maxBy"} key must return only string or only number, received ${describeType(key)}${this.unorderedTypeGuidance(key)}`, keyArgument.span);
        }
        return optionalOf(element);
      }
      case "collections.sum": {
        arity(1, 1);
        const element = arrayAt(0).element;
        if (!isAssignable(element, numberType, this) && element.kind !== "any") {
          this.typeError(`sum expects List<number>, received List<${describeType(element)}>`, argumentAt(0)?.span ?? callSpan);
        }
        return numberType;
      }
      case "collections.join": {
        arity(1, 2);
        const element = arrayAt(0).element;
        if (!isAssignable(element, stringType, this) && element.kind !== "any") {
          this.typeError(`join expects List<string>, received List<${describeType(element)}>`, argumentAt(0)?.span ?? callSpan);
        }
        inferAt(1, stringType);
        return stringType;
      }
      case "json.parse": {
        arity(1, 2);
        inferAt(0, stringType);
        return argumentAt(1) ? runtimeTypeAt(1) : unknownType;
      }
      case "json.tryParse": {
        arity(1, 3);
        inferAt(0, stringType);
        const parsed = argumentAt(1) ? runtimeTypeAt(1) : unknownType;
        if (argumentAt(2)) {
          inferAt(2, parsed);
          return parsed;
        }
        return optionalOf(parsed);
      }
      case "json.stringify":
      case "json.stableStringify": {
        arity(1, 2);
        const value = inferAt(0);
        const serializable = this.jsonSerializable(value);
        const argument = argumentAt(0);
        if (serializable === false && argument) {
          this.typeError(`JSON accepts only records, Lists, enums, primitives, and optionals; received ${describeType(value)}`, argument.span);
        }
        inferAt(1, { kind: "union", members: [boolType, numberType] });
        return stringType;
      }
      case "json.clone": {
        arity(1, 2);
        const original = inferAt(0);
        const argument = argumentAt(0);
        if (this.jsonSerializable(original) === false && argument) {
          this.typeError(`JSON accepts only records, Lists, enums, primitives, and optionals; received ${describeType(original)}`, argument.span);
        }
        return argumentAt(1) ? runtimeTypeAt(1) : original;
      }
      case "runtime.parseAsync": {
        arity();
        const parsed = runtimeTypeAt(0);
        for (let index = 1; index < intrinsic.parameters.length; index += 1) {
          inferAt(index, intrinsic.parameters[index]);
        }
        this.reportPromiseResolutionHazard(parsed, argumentAt(0)?.span ?? callSpan);
        return { kind: "promise", value: parsed };
      }
      case "async.all":
      case "async.race": {
        arity(1, 1);
        const argument = argumentAt(0);
        const input = inferAt(0);
        const unwrap = (source: ValueType): ValueType | null => {
          const expanded = this.expandAliases(source);
          if (expanded.kind === "promise") return expanded.value;
          if (expanded.kind === "any") return anyType;
          if (expanded.kind === "union") {
            const members = expanded.members.map(unwrap);
            return members.every((member): member is ValueType => member !== null) ? unionOf(members) : null;
          }
          return null;
        };
        if (intrinsic.name === "async.all" && (input.kind === "object" || input.kind === "record"
          || input.kind === "named" && this.fieldsOf(input.identity ?? input.name) !== null)) {
          if (input.kind === "record") {
            const resolved = unwrap(input.value);
            if (!resolved) this.typeError(`Promise.all requires every record field to be a Promise, received ${describeType(input)}`, argument?.span ?? callSpan);
            return { kind: "promise", value: { kind: "record", value: resolved ?? unknownType } };
          }
          const fields = input.kind === "object" ? input.fields : this.fieldsOf(input.identity ?? input.name) ?? new Map();
          const output = new Map<string, ValueType>();
          for (const [name, field] of fields) {
            const resolved = unwrap(field);
            if (!resolved) this.typeError(`Promise.all record field '${name}' must be a Promise, received ${describeType(field)}`, argument?.span ?? callSpan);
            output.set(name, resolved ?? unknownType);
          }
          return { kind: "promise", value: { kind: "object", fields: output } };
        }
        if (input.kind !== "list" && input.kind !== "any") {
          this.typeError(`Expected a List of Promises${intrinsic.name === "async.all" ? " or a record of Promises" : ""}, received ${describeType(input)}`, argument?.span ?? callSpan);
          return { kind: "promise", value: intrinsic.name === "async.all" ? { kind: "list", element: unknownType } : unknownType };
        }
        const value = input.kind === "list" ? input.element : anyType;
        const resolved = unwrap(value);
        if (!resolved) this.typeError(`Expected a List of Promises, received List<${describeType(value)}>`, argument?.span ?? callSpan);
        if (intrinsic.name === "async.all" && this.expandAliases(value).kind === "union") {
          this.typeError("Mixed result types need named fields; use Promise.all({name: loadName(), count: loadCount()})", argument?.span ?? callSpan);
        }
        const result = resolved ?? unknownType;
        if (intrinsic.name === "async.race") this.reportPromiseResolutionHazard(result, argument?.span ?? callSpan);
        return { kind: "promise", value: intrinsic.name === "async.all" ? { kind: "list", element: result } : result };
      }
      case "async.timeout": {
        arity(2, 3);
        const value = promiseValue(inferAt(0), 0);
        this.reportPromiseResolutionHazard(value, argumentAt(0)?.span ?? callSpan);
        inferAt(1, durationType);
        inferAt(2, stringType);
        return { kind: "promise", value };
      }
      case "async.retry": {
        arity(1, 3);
        const task = callbackAt(0, [], unknownType);
        inferAt(1, numberType);
        inferAt(2, durationType);
        const result = callbackResult(task);
        const resolved = result.kind === "promise" ? result.value : result;
        this.reportPromiseResolutionHazard(resolved, argumentAt(0)?.span ?? callSpan);
        return { kind: "promise", value: resolved };
      }
      case "async.map": {
        arity(2, 3);
        const element = arrayAt(0).element;
        const worker = callbackAt(1, [element], unknownType);
        inferAt(2, numberType);
        const result = callbackResult(worker);
        return { kind: "promise", value: { kind: "list", element: result.kind === "promise" ? result.value : result } };
      }
      case "async.series": {
        arity(1, 1);
        const task = arrayAt(0).element;
        if (task.kind !== "function" && task.kind !== "intrinsic" && task.kind !== "any") {
          this.typeError(`series expects a List of functions, received List<${describeType(task)}>`, argumentAt(0)?.span ?? callSpan);
        }
        const result = callbackResult(task);
        return { kind: "promise", value: { kind: "list", element: result.kind === "promise" ? result.value : result } };
      }
      case "url.join": {
        arity(1, Number.POSITIVE_INFINITY);
        for (let index = 0; index < arguments_.length; index += 1) inferAt(index, stringType);
        return stringType;
      }
      case "math.min":
      case "math.max": {
        arity(1, Number.POSITIVE_INFINITY);
        for (let index = 0; index < arguments_.length; index += 1) inferAt(index, numberType);
        return numberType;
      }
      case "test.expect": {
        arity(1, 1);
        const actual = inferAt(0);
        const matched = this.expandAliases(actual);
        const dynamic = matched.kind === "any" || matched.kind === "unknown";
        const fields = new Map<string, ValueType>([
          ["toBe", { kind: "function", parameterNames: ["expected"], parameters: [actual], requiredParameters: 1, result: nullType }],
          ["toEqual", { kind: "function", parameterNames: ["expected"], parameters: [actual], requiredParameters: 1, result: nullType }],
        ]);
        if (matched.kind === "bool" || dynamic) {
          fields.set("toBeTruthy", { kind: "function", parameters: [], requiredParameters: 0, result: nullType });
          fields.set("toBeFalsy", { kind: "function", parameters: [], requiredParameters: 0, result: nullType });
        }
        if (matched.kind === "list" || matched.kind === "string" || dynamic) {
          const contained = matched.kind === "list" ? matched.element : matched.kind === "string" ? stringType : anyType;
          fields.set("toContain", { kind: "function", parameterNames: ["expected"], parameters: [contained], requiredParameters: 1, result: nullType });
          fields.set("toHaveLength", { kind: "function", parameterNames: ["length"], parameters: [numberType], requiredParameters: 1, result: nullType });
        }
        if (matched.kind === "string" || dynamic) {
          fields.set("toMatch", { kind: "function", parameterNames: ["expression"], parameters: [stringType], requiredParameters: 1, result: nullType });
        }
        const callable = matched.kind === "function" || matched.kind === "intrinsic" || matched.kind === "action";
        if (callable || dynamic) fields.set("toThrow", { kind: "function", parameters: [], requiredParameters: 0, result: nullType });
        if (matched.kind === "promise" || dynamic || (callable && matched.result.kind === "promise")) {
          fields.set("toReject", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: nullType } });
        }
        return { kind: "object", fields };
      }
      default:
        this.checkArguments(arguments_, intrinsic.parameters, callSpan, intrinsic.requiredParameters, intrinsic.rest);
        return intrinsic.result;
    }
  }

  private inferRangeCall(
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType {
    const hasNamed = argumentNames?.some((name) => name !== null) ?? false;
    if (!hasNamed) {
      if (arguments_.length < 1 || arguments_.length > 3) {
        this.typeError(`Expected 1-3 arguments but received ${arguments_.length}`, callSpan);
      }
      for (const argument of arguments_) {
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        if (argument.kind === "SpreadExpression") this.typeError("range does not accept a call spread", argument.span);
        this.requireAssignable(this.inferExpression(value, numberType), numberType, value.span);
      }
      return intrinsic.result;
    }

    const plan = this.planNamedArguments(
      arguments_,
      argumentNames,
      intrinsic.parameters,
      intrinsic.parameterNames,
      0,
      callSpan,
    );
    if (!plan) return intrinsic.result;
    for (const [source, target] of plan.targets.entries()) {
      const argument = arguments_[source]!;
      const value = argument.kind === "SpreadExpression" ? argument.value : argument;
      const expected = target === null ? unknownType : numberType;
      const actual = this.inferExpression(value, expected);
      if (target !== null) this.requireAssignable(actual, numberType, value.span);
    }
    if (!plan.valid) return intrinsic.result;

    const sources = Array<number>(3).fill(-1);
    for (const [source, target] of plan.targets.entries()) if (target !== null) sources[target] = source;
    const hasStart = sources[0] !== -1;
    const hasEnd = sources[1] !== -1;
    const hasStep = sources[2] !== -1;
    if (!hasEnd || (!hasStart && hasStep)) {
      this.typeError(
        "Named range calls use range(end = ...), range(start = ..., end = ...), or range(start = ..., end = ..., step = ...)",
        callSpan,
      );
      return intrinsic.result;
    }
    this.namedArgumentOrders.set(
      spanIdentity(callSpan),
      trimTrailingOmittedArguments(hasStart ? [sources[0]!, sources[1]!, sources[2]!] : [sources[1]!]),
    );
    return intrinsic.result;
  }

  // D47 rule 81: equals(a, b) is deep structural comparison over data, so the
  // call site enforces the data domain — class instances compare by identity
  // ('=='), functions and Promises have no structural content, unknown/any
  // must be validated first — and the two operands must intersect, D42's own
  // constant-comparison principle.
  private inferEqualsCall(
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType {
    const plan = this.planNamedArguments(
      sourceArguments,
      argumentNames,
      intrinsic.parameters,
      intrinsic.parameterNames,
      intrinsic.requiredParameters,
      callSpan,
    );
    const operands: { type: ValueType; span: Span }[] = [];
    if (plan) {
      for (const [source, target] of plan.targets.entries()) {
        const argument = sourceArguments[source]!;
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        if (argument.kind === "SpreadExpression") this.typeError("equals does not accept a call spread", argument.span);
        const type = this.inferExpression(value);
        if (target === 0 || target === 1) operands[target] = { type, span: value.span };
      }
      if (!plan.valid) return intrinsic.result;
      this.namedArgumentOrders.set(spanIdentity(callSpan), trimTrailingOmittedArguments(
        [0, 1].map((target) => {
          for (const [source, mapped] of plan.targets.entries()) if (mapped === target) return source;
          return -1;
        }),
      ));
    } else {
      if (sourceArguments.length !== 2) {
        this.typeError(`Expected 2 arguments but received ${sourceArguments.length}`, callSpan);
      }
      for (const argument of sourceArguments) {
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        if (argument.kind === "SpreadExpression") this.typeError("equals does not accept a call spread", argument.span);
        const type = this.inferExpression(value);
        if (operands.length < 2) operands.push({ type, span: value.span });
      }
      if (sourceArguments.length !== 2) return intrinsic.result;
    }
    let violated = false;
    for (const operand of operands) {
      if (!operand) continue;
      const violation = this.equalsDomainViolation(operand.type);
      if (violation) {
        this.typeError(`equals compares data structurally, and ${violation}`, operand.span);
        violated = true;
      }
    }
    if (!violated && operands[0] && operands[1] && !this.equalityTypesIntersect(operands[0].type, operands[1].type)) {
      this.typeError(
        this.typesIntersect(operands[0].type, operands[1].type, false)
          ? `${describeType(operands[0].type)} and ${describeType(operands[1].type)} can meet only where an enum member matches a raw string, and the enum and string domains never meet in equals${this.equalityGuidance(operands[0].type, operands[1].type)}`
          : `${describeType(operands[0].type)} and ${describeType(operands[1].type)} have no values in common, so equals(a, b) is always false${this.equalityGuidance(operands[0].type, operands[1].type)}`,
        callSpan,
      );
    }
    this.equalsCalls.add(spanIdentity(callSpan));
    return intrinsic.result;
  }

  /** The reason a type cannot participate in equals(a, b), or null when it is pure data. */
  private equalsDomainViolation(source: ValueType, seen: Set<string> = new Set()): string | null {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    switch (type.kind) {
      case "class":
      case "classConstructor":
        return `${type.name} is a class instance; behavior objects compare by identity — use '=='`;
      case "function":
      case "action":
      case "intrinsic":
        return "a function has no structural content to compare";
      case "promise":
        return "a Promise has no structural content to compare; await it first";
      case "unknown":
        return "unknown must be validated first — parse it with a Type before comparing";
      case "any":
        return "any must be validated first — parse it with a Type before comparing";
      case "optional":
        return this.equalsDomainViolation(type.inner, seen);
      case "union": {
        for (const member of type.members) {
          const violation = this.equalsDomainViolation(member, seen);
          if (violation) return violation;
        }
        return null;
      }
      case "list":
      case "set":
        return this.equalsDomainViolation(type.element, seen);
      case "map":
        return this.equalsDomainViolation(type.key, seen) ?? this.equalsDomainViolation(type.value, seen);
      case "record":
        return this.equalsDomainViolation(type.value, seen);
      case "object": {
        for (const field of type.fields.values()) {
          const violation = this.equalsDomainViolation(field, seen);
          if (violation) return violation;
        }
        return null;
      }
      case "named": {
        const identity = type.identity ?? type.name;
        if (seen.has(identity)) return null;
        seen.add(identity);
        const fields = this.fieldsOf(identity);
        if (!fields) return null;
        for (const field of fields.values()) {
          const violation = this.equalsDomainViolation(field, seen);
          if (violation) return violation;
        }
        return null;
      }
      default:
        return null;
    }
  }

  private inferCollectionCall(
    member: Extract<Expression, { kind: "MemberExpression" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType | null {
    const object = this.inferredOrAnalyze(member.object);
    if (object.kind !== "list" && object.kind !== "map" && object.kind !== "set" && object.kind !== "record") return null;
    const mutating = object.kind === "list"
      ? new Set(["append", "extend", "insert", "remove", "pop", "clear"])
      : object.kind === "map" ? new Set(["set", "update", "remove", "clear"])
        : object.kind === "set" ? new Set(["add", "update", "remove", "clear"])
          : new Set(["set", "remove", "clear"]);
    if (object.readonlyView && mutating.has(member.property)) {
      for (const argument of sourceArguments) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.typeError(`Cannot call mutating method '${member.property}' through ${describeType(object)}; it is a read-only view`, member.span);
      return invalidType;
    }
    const readonlyElement = (object.kind === "list" || object.kind === "set") && object.readonlyView
      ? this.readonlyDataViewOf(object.element)
      : object.kind === "list" || object.kind === "set" ? object.element : null;
    const comparisonElement = object.kind === "list" || object.kind === "set" ? this.readonlyDataViewOf(object.element) : null;
    const readonlyKey = object.kind === "map" && object.readonlyView ? this.readonlyDataViewOf(object.key) : object.kind === "map" ? object.key : null;
    const comparisonKey = object.kind === "map" ? this.readonlyDataViewOf(object.key) : null;
    const readonlyValue = (object.kind === "map" || object.kind === "record") && object.readonlyView
      ? this.readonlyDataViewOf(object.value)
      : object.kind === "map" || object.kind === "record" ? object.value : null;
    this.semanticExpressionOwners.set(`${member.span.start}:${member.span.end}`, nonOptional(object));
    const memberType = object.kind === "list" ? this.listMember(object, member.property)
      : object.kind === "map" ? this.mapMember(object, member.property)
        : object.kind === "set" ? this.setMember(object, member.property)
          : object.kind === "record" ? this.recordMember(object, member.property)
          : unknownType;
    this.recordSemanticExpression(member, memberType ?? unknownType);
    let arguments_ = sourceArguments;
    let namedPreanalyzed = false;
    const callableMember: CallableValueType | null = memberType
      && (memberType.kind === "function" || memberType.kind === "action" || memberType.kind === "intrinsic")
      ? memberType
      : null;
    const named = callableMember
      ? this.planNamedArguments(
        sourceArguments,
        argumentNames,
        callableMember.parameters,
        callableMember.parameterNames,
        callableMember.requiredParameters,
        callSpan,
        callableMember.rest,
      )
      : null;
    if (named) {
      const inferSource = (contextForTarget: (target: number) => ValueType): void => {
        for (const [source, target] of named.targets.entries()) {
          const argument = sourceArguments[source]!;
          this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument, target === null ? unknownType : contextForTarget(target));
        }
      };
      if (!named.valid) {
        inferSource((target) => callableMember!.parameters[target] ?? unknownType);
        return callableMember!.result;
      }
      if (object.kind === "list" && member.property === "reduce") {
        let initial = unknownType;
        let deferred: ArrowFunctionExpression | null = null;
        for (const [source, target] of named.targets.entries()) {
          const argument = sourceArguments[source]!;
          if (target === 0 && argument.kind === "ArrowFunctionExpression") deferred = argument;
          else if (target === 1) initial = this.inferExpression(argument);
          else this.inferExpression(argument);
        }
        if (deferred) {
          this.inferExpression(deferred, {
            kind: "function",
            parameters: [initial, readonlyElement!],
            requiredParameters: 2,
            result: initial,
          });
        }
      } else {
        inferSource((target) => callableMember!.parameters[target] ?? unknownType);
      }
      arguments_ = named.ordered;
      namedPreanalyzed = true;
    }
    const omitted = (argument: Expression | undefined): boolean => argument?.kind === "IdentifierExpression" && argument.name === "\u0000omitted-named-argument";
    const argumentAt = (index: number): Expression | null => {
      const argument = arguments_[index];
      return !argument || omitted(argument) ? null : argument;
    };
    const inferArgument = (index: number, contextualType: ValueType = unknownType): ValueType => {
      const argument = argumentAt(index);
      if (!argument) return unknownType;
      return namedPreanalyzed ? this.inferredExpressionType(argument) : this.inferExpression(argument, contextualType);
    };
    const checkCollectionArguments = (parameters: readonly ValueType[], requiredParameters = parameters.length): void => {
      if (!namedPreanalyzed) {
        this.checkArguments(arguments_, parameters, callSpan, requiredParameters);
        return;
      }
      for (const [index, expected] of parameters.entries()) {
        const argument = argumentAt(index);
        if (argument) this.requireAssignable(this.inferredExpressionType(argument), expected, argument.span);
      }
    };
    const requireCount = (count: number): void => {
      if (!namedPreanalyzed && arguments_.length !== count) this.typeError(`Expected ${count} argument${count === 1 ? "" : "s"} but received ${arguments_.length}`, callSpan);
    };
    // ENM-I3: a membership probe (`has`, `index`, `count`, `remove`, and the
    // Map/Record key of `get`) is judged by intersection with the element or
    // key domain — the per-element `==` question — rather than assignability,
    // whose enum -> string one-way exit would launder a bare-string match.
    const checkProbeArgument = (domain: ValueType, operation: string): void => {
      requireCount(1);
      const argument = argumentAt(0);
      if (!argument) return;
      if (argument.kind === "SpreadExpression") {
        this.inferExpression(argument.value);
        return;
      }
      const probe = namedPreanalyzed ? this.inferredExpressionType(argument) : this.inferExpression(argument, domain);
      this.requireMembershipIntersection(probe, domain, argument.span, operation);
      if (!namedPreanalyzed) {
        for (const extra of arguments_.slice(1)) {
          if (!omitted(extra)) this.inferExpression(extra.kind === "SpreadExpression" ? extra.value : extra);
        }
      }
    };
    const lowered = object.kind === "list"
      ? ["get", "slice", "append", "extend", "insert", "remove", "pop", "clear", "copy", "has", "count", "index", "find", "some", "every", "map", "flatMap", "filter", "reduce", "join", "sorted", "reversed", "sum", "min", "max"].includes(member.property)
      : object.kind === "map" ? ["get", "set", "update", "has", "remove", "clear", "copy", "keys", "values", "entries"].includes(member.property)
        : object.kind === "set" ? ["add", "update", "has", "remove", "clear", "copy", "values", "union", "intersection", "difference"].includes(member.property)
          : object.kind === "record" ? ["get", "set", "has", "remove", "clear", "copy", "keys", "values", "entries"].includes(member.property) : false;
    if (lowered && arguments_.some((argument) => argument.kind === "SpreadExpression")) {
      this.typeError(`Spread arguments are not supported by ${describeType(object)}.${member.property}`, callSpan);
    }
    if (object.kind === "list") {
      if (member.property === "map" || member.property === "flatMap") {
        const flat = member.property === "flatMap";
        this.collectionCalls.set(member.span.end, flat ? "listFlatMap" : "listMap");
        const callbackExpected: ValueType = { kind: "function", parameters: [readonlyElement!], requiredParameters: 1, result: unknownType };
        const callbackArgument = argumentAt(0);
        // COL-U9: `(x, i) => ...` is the Python/JS index habit; the arity
        // mismatch would only say "cannot assign" — teach the two-slot loop.
        // The body still analyzes with honest slot types so the teaching is
        // the one diagnostic, not the head of a cascade.
        if (callbackArgument?.kind === "ArrowFunctionExpression" && callbackArgument.parameters.length === 2) {
          this.inferExpression(callbackArgument, {
            kind: "function",
            parameters: [readonlyElement!, numberType],
            requiredParameters: 2,
            result: unknownType,
          });
          requireCount(1);
          this.typeError(
            `List.${member.property} callbacks receive one value; for index-aware iteration write the two-slot loop — for value, index in values`,
            callbackArgument.span,
          );
          return { kind: "list", element: unknownType };
        }
        const callback = this.concreteCallableFor(inferArgument(0, callbackExpected), callbackExpected, callbackArgument?.span);
        if (callbackArgument) this.requireAssignable(callback, callbackExpected, callbackArgument.span);
        const result = callback.kind === "function" ? callback.result : unknownType;
        requireCount(1);
        if (flat) {
          // COL-U1: flatMap flattens exactly one level, so the transform
          // must produce a List; the element of that List is the result
          // element.
          const expandedResult = this.expandAliases(result);
          if (callbackArgument && expandedResult.kind !== "list" && expandedResult.kind !== "any" && expandedResult.kind !== "unknown" && !isInvalidType(expandedResult)) {
            this.typeError(
              `List.flatMap transform must return a List, received ${describeType(expandedResult)}; use map for one-value transforms`,
              callbackArgument.span,
            );
          }
          return { kind: "list", element: expandedResult.kind === "list" ? expandedResult.element : unknownType };
        }
        return { kind: "list", element: result };
      }
      if (member.property === "filter") {
        this.collectionCalls.set(member.span.end, "listFilter");
        const callbackExpected: ValueType = { kind: "function", parameters: [readonlyElement!], requiredParameters: 1, result: boolType };
        const callbackArgument = argumentAt(0);
        if (callbackArgument) {
          const callback = inferArgument(0, callbackExpected);
          this.requireAssignable(callback, callbackExpected, callbackArgument.span);
        }
        requireCount(1);
        // COL-U3: the exact predicate shape `x => x != null` narrows
        // List<T?> to List<T>. This is a closed-vocabulary special case (the
        // NaN twin is already taught); user predicate types stay unanalyzed.
        if (this.isNullExclusionPredicate(argumentAt(0)) && this.expandAliases(readonlyElement!).kind === "optional") {
          return { kind: "list", element: nonOptional(this.expandAliases(readonlyElement!)) };
        }
        return { kind: "list", element: readonlyElement! };
      }
      if (member.property === "reduce") {
        this.collectionCalls.set(member.span.end, "listReduce");
        const callbackArgument = argumentAt(0);
        const deferredArrow = callbackArgument?.kind === "ArrowFunctionExpression";
        let callback = callbackArgument && !deferredArrow ? inferArgument(0) : unknownType;
        const initial = inferArgument(1);
        const callbackExpected: ValueType = { kind: "function", parameters: [initial, readonlyElement!], requiredParameters: 2, result: initial };
        if (callbackArgument) {
          if (deferredArrow) callback = inferArgument(0, callbackExpected);
          this.requireAssignable(callback, callbackExpected, callbackArgument.span);
        }
        requireCount(2);
        return initial;
      }
      if (member.property === "append") {
        this.collectionCalls.set(member.span.end, "listAppend");
        const argument = argumentAt(0);
        const value = inferArgument(0, object.element);
        if (argument && object.element.kind === "unknown") {
          if (!this.refineCollectionInference(object, { kind: "list", element: value })) this.requireAssignable(value, object.element, argument.span);
        } else if (argument) this.requireAssignable(value, object.element, argument.span);
        requireCount(1);
        return nullType;
      }
      if (member.property === "extend") {
        this.collectionCalls.set(member.span.end, "listExtend");
        const argument = argumentAt(0);
        const source = argument ? this.expandAliases(inferArgument(0)) : unknownType;
        let inferred = false;
        if (argument && source.kind === "list" && object.element.kind === "unknown") {
          inferred = this.refineCollectionInference(object, source);
        }
        if (argument && !inferred) this.requireAssignable(source, object, argument.span);
        requireCount(1);
        return nullType;
      }
      if (member.property === "insert") {
        this.collectionCalls.set(member.span.end, "listInsert");
        const indexArgument = argumentAt(0);
        if (indexArgument) this.requireAssignable(inferArgument(0, numberType), numberType, indexArgument.span);
        const argument = argumentAt(1);
        const value = inferArgument(1, object.element);
        if (argument && object.element.kind === "unknown") {
          if (!this.refineCollectionInference(object, { kind: "list", element: value })) this.requireAssignable(value, object.element, argument.span);
        } else if (argument) this.requireAssignable(value, object.element, argument.span);
        requireCount(2);
        return nullType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.end, "listRemove");
        checkProbeArgument(comparisonElement!, "List.remove");
        return boolType;
      }
      if (member.property === "pop") {
        this.collectionCalls.set(member.span.end, "listPop");
        checkCollectionArguments([numberType], 0);
        return object.element;
      }
      if (member.property === "clear" || member.property === "copy" || member.property === "reversed") {
        this.collectionCalls.set(member.span.end, member.property === "clear" ? "clear" : member.property === "copy" ? "listCopy" : "listReversed");
        checkCollectionArguments([]);
        return member.property === "clear" ? nullType : { kind: "list", element: readonlyElement! };
      }
      if (member.property === "has" || member.property === "count") {
        this.collectionCalls.set(member.span.end, member.property === "has" ? "has" : "listCount");
        checkProbeArgument(comparisonElement!, `List.${member.property}`);
        return member.property === "has" ? boolType : numberType;
      }
      if (member.property === "sorted") {
        this.collectionCalls.set(member.span.end, "listSorted");
        const comparator: ValueType = { kind: "function", parameters: [readonlyElement!, readonlyElement!], requiredParameters: 2, result: numberType };
        const selector: ValueType = { kind: "function", parameters: [readonlyElement!], requiredParameters: 1, result: unionOf([numberType, stringType]) };
        // D42 item 65 / D41 item 61: the selector's shape is what assignability
        // judges; whether its key is ordered is asked once below, by the single
        // ordering authority — otherwise a `Comparable`-bounded key would be
        // refused by the union spelling that predates bounds.
        const selectorShape: ValueType = { kind: "function", parameters: [readonlyElement!], requiredParameters: 1, result: unknownType };
        const compareArgument = argumentAt(0);
        const byArgument = argumentAt(1);
        const positionalSelector = !namedPreanalyzed
          && compareArgument?.kind === "ArrowFunctionExpression"
          && compareArgument.parameters.length === 1
          && !argumentNames?.some((name) => name !== null);
        let byType: ValueType | null = null;
        if (!namedPreanalyzed) {
          if (compareArgument) this.requireAssignable(inferArgument(0, positionalSelector ? selector : comparator), positionalSelector ? selector : comparator, compareArgument.span);
          if (byArgument) {
            byType = inferArgument(1, selector);
            this.requireAssignable(byType, selectorShape, byArgument.span);
          }
          if (arguments_.length > 2) {
            for (const extra of arguments_.slice(2)) this.inferExpression(extra);
            this.typeError(`Expected 0-2 arguments but received ${arguments_.length}`, callSpan);
          }
        } else {
          if (compareArgument) this.requireAssignable(this.inferredExpressionType(compareArgument), comparator, compareArgument.span);
          if (byArgument) {
            byType = this.inferredExpressionType(byArgument);
            this.requireAssignable(byType, selectorShape, byArgument.span);
          }
        }
        // ORD-3: assignability admits an enum key, because an enum member is
        // assignable to `string`, so the ordered-key question has to be asked
        // separately at the one decision point. A literal selector reports the
        // contextual `number | string` rather than its own key type once the
        // body checks out, so the body's recorded type is the honest source
        // for an inline arrow.
        const byCallable = byType === null ? null : this.expandAliases(byType);
        const byKey = byArgument?.kind === "ArrowFunctionExpression"
          ? this.inferredExpressionType(byArgument.body)
          : byCallable !== null && (byCallable.kind === "function" || byCallable.kind === "action" || byCallable.kind === "intrinsic")
            ? byCallable.result
            : null;
        if (byArgument && byKey !== null && isAssignable(byType!, selectorShape, this) && this.orderedTypeCategory(byKey) === null) {
          this.typeError(
            `sorted(by=) key must return only string or only number, received ${describeType(byKey)}${this.unorderedTypeGuidance(byKey)}`,
            byArgument.span,
          );
        }
        if (byArgument && !argumentNames?.includes("by")) {
          this.typeError("Use 'sorted(by=selector)'; the key-function alternative is named", byArgument.span);
        }
        if (positionalSelector) this.typeError("Use 'sorted(by=selector)'; the key-function alternative is named", compareArgument.span);
        if (compareArgument && byArgument) {
          this.typeError("sorted accepts either a comparator or 'by=selector', not both", callSpan);
        }
        if (!compareArgument && !byArgument && this.orderedTypeCategory(object.element) === null) {
          this.typeError(
            `List<${describeType(object.element)}>.sorted() requires an explicit comparator${this.unorderedTypeGuidance(object.element)}`,
            callSpan,
          );
        }
        return { kind: "list", element: readonlyElement! };
      }
      if (member.property === "sum") {
        this.collectionCalls.set(member.span.end, "listSum");
        checkCollectionArguments([]);
        if (object.element.kind !== "any" && object.element.kind !== "unknown" && !isAssignable(object.element, numberType, this)) {
          this.typeError(`List.sum requires List<number>, received ${describeType(object)}`, member.span);
        }
        return numberType;
      }
      if (member.property === "min" || member.property === "max") {
        this.collectionCalls.set(member.span.end, member.property === "min" ? "listMin" : "listMax");
        checkCollectionArguments([]);
        if (this.orderedTypeCategory(object.element) === null) {
          this.typeError(
            `List.${member.property} requires List<number> or List<string>, received ${describeType(object)}${this.unorderedTypeGuidance(object.element)}`,
            member.span,
          );
        }
        return optionalOf(readonlyElement!);
      }
      if (["some", "every", "find"].includes(member.property)) {
        const callbackExpected: ValueType = { kind: "function", parameters: [readonlyElement!], requiredParameters: 1, result: boolType };
        const callbackArgument = argumentAt(0);
        if (callbackArgument) {
          const callback = inferArgument(0, callbackExpected);
          this.requireAssignable(callback, callbackExpected, callbackArgument.span);
        }
        requireCount(1);
        if (member.property === "find") {
          this.collectionCalls.set(member.span.end, "listFind");
          return optionalOf(readonlyElement!);
        }
        this.collectionCalls.set(member.span.end, member.property === "some" ? "listSome" : "listEvery");
        return boolType;
      }
      if (member.property === "index") {
        this.collectionCalls.set(member.span.end, "listIndex");
        checkProbeArgument(comparisonElement!, "List.index");
        return optionalOf(numberType);
      }
      if (member.property === "join") {
        this.collectionCalls.set(member.span.end, "listJoin");
        checkCollectionArguments([stringType], 0);
        if (object.element.kind !== "any" && object.element.kind !== "unknown" && !isAssignable(object.element, stringType, this)) {
          this.typeError(`List.join requires List<string>, received ${describeType(object)}`, member.span);
        }
        return stringType;
      }
      if (member.property === "get") {
        this.collectionCalls.set(member.span.end, "get");
        checkCollectionArguments([numberType]);
        return optionalOf(readonlyElement!);
      }
      if (member.property === "slice") {
        this.collectionCalls.set(member.span.end, "slice");
        checkCollectionArguments([numberType, numberType], 0);
        return { kind: "list", element: readonlyElement! };
      }
    }

    if (object.kind === "map") {
      if (member.property === "set") {
        this.collectionCalls.set(member.span.end, "mapSet");
        const keyArgument = argumentAt(0);
        const valueArgument = argumentAt(1);
        const key = inferArgument(0);
        const value = inferArgument(1);
        if (object.key.kind === "unknown" && object.value.kind === "unknown") {
          this.refineCollectionInference(object, { kind: "map", key, value });
        }
        if (keyArgument) this.requireAssignable(key, object.key, keyArgument.span);
        if (valueArgument) this.requireAssignable(value, object.value, valueArgument.span);
        requireCount(2);
        return nullType;
      }
      if (member.property === "update") {
        this.collectionCalls.set(member.span.end, "mapUpdate");
        const argument = argumentAt(0);
        const source = argument ? this.expandAliases(inferArgument(0)) : unknownType;
        let inferred = false;
        if (argument && source.kind === "map" && object.key.kind === "unknown" && object.value.kind === "unknown") {
          inferred = this.refineCollectionInference(object, source);
        }
        if (argument && !inferred) this.requireAssignable(source, object, argument.span);
        requireCount(1);
        return nullType;
      }
      if (member.property === "get") {
        this.collectionCalls.set(member.span.end, "get");
        if (!namedPreanalyzed && sourceArguments.length === 2 && !sourceArguments.some((argument) => argument.kind === "SpreadExpression")) {
          const key = inferArgument(0, comparisonKey!);
          const keyArgument = argumentAt(0);
          if (keyArgument) this.requireMembershipIntersection(key, comparisonKey!, keyArgument.span, "Map.get");
          inferArgument(1);
          this.typeError("Use 'get(key) ?? fallback'; Map.get has one optional-result contract", callSpan);
          return optionalOf(readonlyValue!);
        }
        checkProbeArgument(comparisonKey!, "Map.get");
        return optionalOf(readonlyValue!);
      }
      if (member.property === "keys") {
        this.collectionCalls.set(member.span.end, "keys");
        checkCollectionArguments([]);
        return { kind: "list", element: readonlyKey! };
      }
      if (member.property === "values") {
        this.collectionCalls.set(member.span.end, "values");
        checkCollectionArguments([]);
        return { kind: "list", element: readonlyValue! };
      }
      if (member.property === "entries") {
        this.collectionCalls.set(member.span.end, "entries");
        checkCollectionArguments([]);
        return { kind: "list", element: { kind: "object", fields: new Map([["key", readonlyKey!], ["value", readonlyValue!]]) } };
      }
      if (member.property === "has") {
        this.collectionCalls.set(member.span.end, "has");
        checkProbeArgument(comparisonKey!, "Map.has");
        return boolType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.end, "remove");
        checkProbeArgument(comparisonKey!, "Map.remove");
        return boolType;
      }
      if (member.property === "clear") {
        this.collectionCalls.set(member.span.end, "clear");
        checkCollectionArguments([]);
        return nullType;
      }
      if (member.property === "copy") {
        this.collectionCalls.set(member.span.end, "mapCopy");
        checkCollectionArguments([]);
        return { kind: "map", key: readonlyKey!, value: readonlyValue! };
      }
    }
    if (object.kind === "record") {
      if (member.property === "set") {
        this.collectionCalls.set(member.span.end, "recordSet");
        checkCollectionArguments([stringType, object.value]);
        return nullType;
      }
      if (member.property === "get") {
        this.collectionCalls.set(member.span.end, "get");
        checkProbeArgument(stringType, "Record.get");
        return optionalOf(readonlyValue!);
      }
      if (member.property === "keys") {
        this.collectionCalls.set(member.span.end, "keys");
        checkCollectionArguments([]);
        return { kind: "list", element: stringType };
      }
      if (member.property === "values") {
        this.collectionCalls.set(member.span.end, "values");
        checkCollectionArguments([]);
        return { kind: "list", element: readonlyValue! };
      }
      if (member.property === "entries") {
        this.collectionCalls.set(member.span.end, "entries");
        checkCollectionArguments([]);
        return { kind: "list", element: { kind: "object", fields: new Map([["key", stringType], ["value", readonlyValue!]]) } };
      }
      if (member.property === "has") {
        this.collectionCalls.set(member.span.end, "has");
        checkProbeArgument(stringType, "Record.has");
        return boolType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.end, "remove");
        checkProbeArgument(stringType, "Record.remove");
        return boolType;
      }
      if (member.property === "clear") {
        this.collectionCalls.set(member.span.end, "clear");
        checkCollectionArguments([]);
        return nullType;
      }
      if (member.property === "copy") {
        this.collectionCalls.set(member.span.end, "recordCopy");
        checkCollectionArguments([]);
        return { kind: "record", value: readonlyValue! };
      }
    }
    if (object.kind === "set") {
      if (member.property === "add") {
        this.collectionCalls.set(member.span.end, "setAdd");
        const argument = argumentAt(0);
        const value = inferArgument(0, object.element);
        requireCount(1);
        if (argument && object.element.kind === "unknown") {
          if (!this.refineCollectionInference(object, { kind: "set", element: value })) this.requireAssignable(value, object.element, argument.span);
        } else if (argument) this.requireAssignable(value, object.element, argument.span);
        return nullType;
      }
      if (member.property === "update") {
        this.collectionCalls.set(member.span.end, "setUpdate");
        const argument = argumentAt(0);
        const source = argument ? this.expandAliases(inferArgument(0)) : unknownType;
        let inferred = false;
        if (argument && (source.kind === "set" || source.kind === "list") && object.element.kind === "unknown") {
          inferred = this.refineCollectionInference(object, { kind: "set", element: source.element });
        }
        if (argument && !inferred) {
          this.requireAssignable(source, { kind: "union", members: [object, { kind: "list", element: object.element }] }, argument.span);
        }
        requireCount(1);
        return nullType;
      }
      if (member.property === "has") {
        this.collectionCalls.set(member.span.end, "has");
        checkProbeArgument(comparisonElement!, "Set.has");
        return boolType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.end, "remove");
        checkProbeArgument(comparisonElement!, "Set.remove");
        return boolType;
      }
      if (member.property === "clear") {
        this.collectionCalls.set(member.span.end, "clear");
        checkCollectionArguments([]);
        return nullType;
      }
      if (member.property === "values") {
        this.collectionCalls.set(member.span.end, "values");
        checkCollectionArguments([]);
        return { kind: "list", element: readonlyElement! };
      }
      if (member.property === "copy") {
        this.collectionCalls.set(member.span.end, "setCopy");
        checkCollectionArguments([]);
        return { kind: "set", element: readonlyElement! };
      }
      if (member.property === "union" || member.property === "intersection" || member.property === "difference") {
        // COL-U2: the Set algebra. Each copies; the other operand's element
        // domain must intersect this Set's (the same per-member `==`
        // question the probes ask), so an enum Set never meets a bare-string
        // Set here.
        this.collectionCalls.set(
          member.span.end,
          member.property === "union" ? "setUnion" : member.property === "intersection" ? "setIntersection" : "setDifference",
        );
        const argument = argumentAt(0);
        const source = argument ? this.expandAliases(inferArgument(0, { kind: "set", element: comparisonElement! })) : unknownType;
        requireCount(1);
        if (argument && source.kind === "set") {
          this.requireMembershipIntersection(source.element, comparisonElement!, argument.span, `Set.${member.property}`);
        } else if (argument && source.kind !== "any" && !isInvalidType(source)) {
          this.typeError(`Set.${member.property} requires a Set, received ${describeType(source)}`, argument.span);
        }
        if (member.property === "union" && argument && source.kind === "set") {
          return { kind: "set", element: mergeTypes(readonlyElement!, this.readonlyDataViewOf(source.element)) };
        }
        return { kind: "set", element: readonlyElement! };
      }
    }
    return null;
  }

  private inferPrimitiveCall(
    member: Extract<Expression, { kind: "MemberExpression" }>,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType | null {
    const object = this.inferredOrAnalyze(member.object);
    if (object.kind !== "string" && object.kind !== "number") return null;
    const memberType = object.kind === "string" ? this.stringMember(member.property) : this.numberMember(member.property);
    if (!memberType || memberType.kind !== "function") return null;
    this.semanticExpressionOwners.set(`${member.span.start}:${member.span.end}`, object);
    this.recordSemanticExpression(member, memberType);
    const operation = object.kind === "string"
      ? stringPrimitiveOperations.get(member.property)
      : numberPrimitiveOperations.get(member.property);
    if (operation) this.primitiveCalls.set(member.span.end, operation);
    this.checkArguments(
      arguments_,
      memberType.parameters,
      callSpan,
      memberType.requiredParameters,
      memberType.rest,
      argumentNames,
      memberType.parameterNames,
    );
    return memberType.result;
  }

  private planNamedArguments(
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    parameters: readonly ValueType[],
    parameterNames: readonly string[] | undefined,
    requiredParameters: number,
    callSpan: Span,
    rest?: ValueType,
  ): NamedArgumentPlan | null {
    if (!argumentNames?.some((name) => name !== null)) return null;
    if (!parameterNames || parameterNames.length !== parameters.length || parameterNames.some((name) => !name)) {
      this.typeError("This callable does not expose stable parameter names", callSpan);
      return {
        ordered: arguments_,
        targets: arguments_.map(() => null),
        valid: false,
      };
    }

    const sources = Array<number>(parameters.length).fill(-1);
    const targets: (number | null)[] = [];
    let nextPositional = 0;
    let valid = !arguments_.some((argument) => argument.kind === "SpreadExpression");
    if (!valid) this.typeError("Named arguments cannot be combined with a call spread", callSpan);
    for (const [source, argument] of arguments_.entries()) {
      const name = argumentNames[source] ?? null;
      let target: number;
      if (name === null) {
        while (nextPositional < sources.length && sources[nextPositional] !== -1) nextPositional += 1;
        target = nextPositional++;
      } else {
        target = parameterNames.indexOf(name);
        if (target === -1) {
          this.typeError(`Unknown named argument '${name}'`, argument.span);
          targets.push(null);
          valid = false;
          continue;
        }
      }
      if (target >= sources.length) {
        this.typeError(rest
          ? "Named calls cannot pass values to a rest parameter"
          : "This fixed-arity call has no position for another argument", argument.span);
        targets.push(null);
        valid = false;
        continue;
      }
      if (sources[target] !== -1) {
        this.typeError(`Parameter '${parameterNames[target]}' is provided more than once`, argument.span);
        targets.push(null);
        valid = false;
        continue;
      }
      sources[target] = source;
      targets.push(target);
    }
    const missing = parameterNames.filter((_, index) => index < requiredParameters && sources[index] === -1);
    if (missing.length > 0) {
      this.typeError(`Missing required named argument${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`, callSpan);
      valid = false;
    }
    this.namedArgumentOrders.set(spanIdentity(callSpan), trimTrailingOmittedArguments(sources));
    return {
      ordered: sources.map((source) => source === -1
        ? { kind: "IdentifierExpression", name: "\u0000omitted-named-argument", span: callSpan } satisfies Expression
        : arguments_[source]!),
      targets,
      valid,
    };
  }

  private inferMember(
    objectExpression: Expression,
    property: string,
    optional: boolean,
    memberSpan: Span,
    useNarrowing = true,
    readValue = true,
  ): ValueType {
    if (objectExpression.kind === "SuperExpression") {
      if (optional) this.typeError("Optional access is not valid on 'super'", memberSpan);
      const base = this.currentClass ? this.classes.get(this.currentClass)?.base ?? null : null;
      if (!base || !this.superMemberContext) {
        this.typeError("'super' member access is only available directly inside a derived constructor, method, getter, field initializer, or nested arrow", objectExpression.span);
        return unknownType;
      }
      const staticMember = this.superMemberContext === "static";
      const method = staticMember ? this.findStaticMethod(base, property) : this.findMethod(base, property);
      const methodType = staticMember ? method as ValueType | null : (method as { readonly type: ValueType } | null)?.type ?? null;
      const getter = staticMember ? this.findStaticGetter(base, property) : this.findGetter(base, property);
      const getterType = staticMember ? getter as ValueType | null : (getter as { readonly type: ValueType } | null)?.type ?? null;
      const field = staticMember ? this.findStaticField(base, property) : null;
      if (!method && !getter && !field) {
        this.typeError(`Base class '${base}' has no ${staticMember ? "static " : ""}method${staticMember ? ", getter, or field" : " or getter"} '${property}'`, memberSpan);
        return unknownType;
      }
      this.semanticExpressionOwners.set(
        `${memberSpan.start}:${memberSpan.end}`,
        staticMember ? { kind: "classConstructor", name: base } : { kind: "class", name: base },
      );
      // D44 rule 74: reading a base method as a value binds at the reference
      // site. `super` cannot be captured by a receiver temporary, so the
      // emitter binds it to `this` directly.
      if (method && !getter && !field && readValue
        && !this.callExpressionCallees.has(spanIdentity(memberSpan))) {
        this.classMethodReferences.add(spanIdentity(memberSpan));
      }
      return methodType ?? getterType ?? field!.type;
    }
    // A member access is a sanctioned class-name position (D45 rule 75).
    this.memberAccessReceivers.add(spanIdentity(objectExpression.span));
    const original = this.inferredOrAnalyze(objectExpression);
    this.semanticExpressionOwners.set(`${memberSpan.start}:${memberSpan.end}`, nonOptional(original));
    const resolvedOriginal = this.expandAliases(original);
    const object = nonOptional(resolvedOriginal);
    const guardedCollectionOperation = object.kind === "list"
      ? listCollectionOperations.get(property) ?? null
      : object.kind === "map"
        ? mapCollectionOperations.get(property) ?? null
      : object.kind === "set"
          ? setCollectionOperations.get(property) ?? null
          : object.kind === "record"
            ? recordCollectionOperations.get(property) ?? null
          : null;
    if (guardedCollectionOperation) {
      this.collectionCalls.set(memberSpan.end, guardedCollectionOperation);
    }
    const guardedPrimitiveOperation = object.kind === "string"
      ? stringPrimitiveOperations.get(property) ?? null
      : object.kind === "number"
        ? numberPrimitiveOperations.get(property) ?? null
        : null;
    if (guardedPrimitiveOperation) this.primitiveCalls.set(memberSpan.end, guardedPrimitiveOperation);
    const basePath = this.stableMemberAccessPath(objectExpression);
    const narrowedMember = basePath ? this.lookupMemberNarrowing(`${basePath}.${property}`) : null;
    let result = unknownType;

    if (object.kind === "any") {
      result = anyType;
    } else if (object.kind === "unknown") {
      if (isInvalidType(object)) result = invalidType;
      else this.typeError(`Cannot access '${property}' on unknown without validation`, memberSpan);
    } else if (object.kind === "string") {
      result = this.stringMember(property) ?? unknownType;
      if (property === "size") this.stringSizes.add(memberSpan.end);
      if (result.kind === "unknown") this.typeError(stringMemberGuidance(property) ?? `${describeType(object)} has no member '${property}'`, memberSpan);
    } else if (object.kind === "number") {
      result = this.numberMember(property) ?? unknownType;
      if (result.kind === "unknown") {
        this.typeError(property === "toString"
          ? "Use 'str(value)' or an f-string; VelarScript has one explicit text conversion spelling"
          : `${describeType(object)} has no member '${property}'`, memberSpan);
      }
    } else if (object.kind === "list") {
      result = this.listMember(object, property) ?? unknownType;
      if (property === "size") this.collectionSizes.add(memberSpan.end);
      if (result.kind === "unknown") this.typeError(this.collectionMemberError("List", property), memberSpan);
    } else if (object.kind === "set") {
      result = this.setMember(object, property) ?? unknownType;
      if (property === "size") this.collectionSizes.add(memberSpan.end);
      if (result.kind === "unknown") this.typeError(this.collectionMemberError("Set", property), memberSpan);
    } else if (object.kind === "map") {
      result = this.mapMember(object, property) ?? unknownType;
      if (property === "size") this.collectionSizes.add(memberSpan.end);
      if (result.kind === "unknown") this.typeError(this.collectionMemberError("Map", property), memberSpan);
    } else if (object.kind === "record") {
      result = this.recordMember(object, property) ?? unknownType;
      if (property === "size") this.collectionSizes.add(memberSpan.end);
      if (result.kind === "unknown") this.typeError(`Record fields are dynamic; use ${describeType(object)}[${JSON.stringify(property)}]`, memberSpan);
    } else if (object.kind === "action") {
      if (property === "pending") result = boolType;
      else if (property === "error") result = optionalOf({ kind: "class", name: "Error" });
      else this.typeError(`Action has no member '${property}'`, memberSpan);
    } else if (object.kind === "union") {
      const candidates = object.members.map((member) => this.discriminatedDataField(member, property));
      if (candidates.every((candidate): candidate is ValueType => candidate !== null)) {
        if (!readValue && !candidates.every((candidate) => sameType(candidate, candidates[0]!))) {
          this.typeError(
            `Cannot assign field '${property}' through ${describeType(object)} because its variants require different field types; narrow the owner first`,
            memberSpan,
          );
          result = invalidType;
        } else {
          result = readValue ? unionOf(candidates) : candidates[0]!;
        }
      } else {
        this.typeError(`${describeType(object)} has no common field '${property}'`, memberSpan);
      }
    } else if (object.kind === "object") {
      result = object.fields.get(property) ?? unknownType;
      if (object.optionalFields?.has(property) && result.kind !== "unknown") result = optionalOf(result);
      if (object.readonlyFields?.has(property) && result.kind !== "unknown") result = this.readonlyDataViewOf(result);
      if (!object.fields.has(property)) {
        this.typeError(`Object has no field '${property}'`, memberSpan);
      }
    } else if (object.kind === "extension") {
      let owned = false;
      for (const extension of this.analysisExtensions) {
        const member = extension.memberType?.(object, property);
        if (member === undefined) continue;
        owned = true;
        if (member) result = member;
        else this.typeError(`${describeType(object)} has no member '${property}'`, memberSpan);
        break;
      }
      if (!owned) this.typeError(`${describeType(object)} has no member '${property}'`, memberSpan);
    } else if (object.kind === "named") {
      const fields = this.fieldsOf(object.identity ?? object.name);
      result = fields?.get(property) ?? unknownType;
      if (this.readonlyFieldsOf(object.identity ?? object.name)?.has(property) && result.kind !== "unknown") result = this.readonlyDataViewOf(result);
      if (!fields?.has(property)) {
        this.typeError(`Type '${object.name}' has no field '${property}'`, memberSpan);
      }
    } else if (object.kind === "class") {
      const classKey = object.identity ?? object.name;
      const privateField = this.privateFieldForAccess(classKey, property, false);
      const privateMethod = this.privateMethodForAccess(classKey, property, false);
      const field = this.findField(classKey, property);
      const getter = this.findGetter(classKey, property);
      const method = this.findMethod(classKey, property);
      result = privateField?.type ?? privateMethod ?? field?.type ?? getter?.type ?? method?.type ?? unknownType;
      const privateGetter = Boolean(privateField && (this.privateGetters.get(this.currentClass ?? "")?.has(property) ?? false));
      if (privateField || privateMethod) {
        this.privateMembers.add(spanIdentity(memberSpan));
      } else if (!field && !getter && !method && this.declaresPrivateMember(classKey, property, false)) {
        this.typeError(`Member '${property}' is private to class '${object.name}'`, memberSpan);
      } else if (!field && !getter && !method) {
        this.typeError(`Class '${object.name}' has no member '${property}'`, memberSpan);
      }
      if (readValue && field && !classKey.startsWith("js:")
        && !(property === "cause" && this.isSubclassOf(classKey, "Error"))) {
        // Error's `cause` is host-managed and legitimately absent (ASY-U3);
        // the read normalizes undefined to null instead of tripping the
        // initialization guard.
        this.instanceFieldReads.add(spanIdentity(memberSpan));
      }
      if (readValue && privateField
        && !(this.privateGetters.get(this.currentClass ?? "")?.has(property) ?? false)) {
        this.privateInstanceFieldReads.add(spanIdentity(memberSpan));
      }
      // D44 rule 74: methods live on the prototype, so reading one as a value
      // (`const read = a.read`) evaluates the receiver once and binds at the
      // reference site — the collection-method rule of charter section 8.
      if (readValue && (method || privateMethod) && !field && !getter && !privateField
        && !this.callExpressionCallees.has(spanIdentity(memberSpan))) {
        this.classMethodReferences.add(spanIdentity(memberSpan));
      }
      // CLS-D9: while a constructor runs, derived state does not exist yet,
      // so a constructor body may only observe members its own class fully
      // owns. An abstract member always resolves to a derived implementation,
      // and a member some visible subclass overrides may — either observes
      // fields that are not initialized until the derived constructor runs.
      if (this.constructorDepth > 0
        && objectExpression.kind === "IdentifierExpression" && objectExpression.name === "self"
        && this.currentClass && classKey === this.currentClass) {
        const abstractMember = (getter?.abstract ?? false) || (method?.abstract ?? false);
        const overrider = !abstractMember && (getter || method)
          ? [...this.classes.keys()].find((candidate) => candidate !== classKey
            && this.isSubclassOf(candidate, classKey)
            && (this.classes.get(candidate)?.methods.has(property) || this.classes.get(candidate)?.getters.has(property)))
          : undefined;
        if (abstractMember) {
          this.typeError(
            `Constructor of '${object.name}' cannot use abstract member '${property}': the derived implementation would run before the derived constructor initializes its state. Move this use into the derived constructor`,
            memberSpan,
          );
        } else if (overrider !== undefined) {
          this.typeError(
            `Constructor of '${object.name}' cannot use '${property}': '${overrider}' overrides it, so the override would run before '${overrider}' initializes its state. Move this use into the derived constructor`,
            memberSpan,
          );
        }
      }
    } else if (object.kind === "classConstructor") {
      const key = object.identity ?? object.name;
      const privateField = this.privateFieldForAccess(key, property, true);
      const privateMethod = this.privateMethodForAccess(key, property, true);
      const fieldOwner = this.findStaticFieldOwner(key, property);
      const field = fieldOwner?.field ?? null;
      const getter = this.findStaticGetter(key, property);
      const method = this.findStaticMethod(key, property);
      result = privateField?.type ?? privateMethod ?? field?.type ?? getter ?? method ?? unknownType;
      if (privateField || privateMethod) {
        this.privateMembers.add(spanIdentity(memberSpan));
      } else if (!field && !getter && !method && this.declaresPrivateMember(key, property, true)) {
        this.typeError(`Static member '${property}' is private to class '${object.name}'`, memberSpan);
      } else if (!field && !getter && !method) {
        this.typeError(`Class '${object.name}' has no static member '${property}'`, memberSpan);
      }
      if (readValue && (field || privateField)) {
        const initialization = this.staticFieldInitialization;
        const ownField = initialization?.className === key
          && (this.classes.get(key)?.staticFields.has(property)
            || this.privateStaticFields.get(key)?.has(property));
        if (ownField && !initialization.initialized.has(property)) {
          this.typeError(
            `Static field '${property}' is read before it is initialized; declare it earlier or defer the read`,
            memberSpan,
          );
        }
        if (field && fieldOwner && !key.startsWith("js:")) {
          this.staticFieldReads.set(spanIdentity(memberSpan), fieldOwner.depth);
        }
      }
      // D44 rule 74: a static method read as a value binds its class at the
      // reference site, the same rule instance method references follow.
      if (readValue && (method || privateMethod) && !field && !getter && !privateField
        && !this.callExpressionCallees.has(spanIdentity(memberSpan))) {
        this.classMethodReferences.add(spanIdentity(memberSpan));
      }
    } else if (object.kind === "enumObject") {
      const enumResult = this.enumRuntimeMember(object.name, object.identity, object.members, property);
      if (enumResult) {
        result = enumResult;
      } else {
        this.typeError(
          `Enum '${object.name}' has no member '${property}'; ${object.name}.values() lists the members in declaration order`,
          memberSpan,
        );
      }
    } else if (object.kind === "typeObject") {
      // ENM-I4: identities follow aliases (charter section 12), so an alias
      // whose target is an enum answers member access, values(), is, and
      // parse exactly as the enum itself does.
      const aliasedEnum = this.aliasedEnumTarget(object.name);
      if (aliasedEnum) {
        const enumResult = this.enumRuntimeMember(aliasedEnum.name, aliasedEnum.identity, aliasedEnum.members, property);
        if (enumResult) {
          result = enumResult;
        } else {
          this.typeError(
            `Enum '${aliasedEnum.name}' has no member '${property}'; ${object.name}.values() lists the members in declaration order`,
            memberSpan,
          );
        }
      } else if (property === "is") {
        result = { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType };
      } else if (property === "parse") {
        result = {
          kind: "function",
          parameterNames: ["value"],
          parameters: [unknownType],
          requiredParameters: 1,
          result: this.invalidDeclaredTypes.has(object.name)
            ? invalidType
            : this.runtimeTypeObjectValue(object),
        };
      } else {
        this.typeError(`Type '${object.name}' has no runtime member '${property}'`, memberSpan);
      }
    } else if (object.kind === "runtimeType") {
      if (property === "is") {
        result = { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType };
      } else if (property === "parse") {
        result = { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: object.value };
      } else {
        this.typeError(`${describeType(object)} has no runtime member '${property}'`, memberSpan);
      }
    } else {
      this.typeError(`${describeType(object)} has no member '${property}'`, memberSpan);
    }

    if (isReadonlyView(object) && result.kind !== "unknown" && result.kind !== "any") {
      result = this.readonlyDataViewOf(result);
    }
    result = this.displayExternalClasses(result);
    if (useNarrowing && narrowedMember) {
      result = narrowedMember;
      this.runtimeNarrowings.set(spanIdentity(memberSpan), {
        expected: narrowedMember,
        description: `.${property}`,
      });
    }

    if (optional) {
      const finalType = resolvedOriginal.kind === "optional" || resolvedOriginal.kind === "null" ? optionalOf(result) : result;
      if (finalType.kind === "optional") this.optionalMembers.add(spanIdentity(memberSpan));
      return finalType;
    }
    if (resolvedOriginal.kind === "optional") {
      this.typeError(`Use optional access '?.' for ${describeType(original)}`, memberSpan);
    }
    if (result.kind === "optional") this.optionalMembers.add(spanIdentity(memberSpan));
    return result;
  }

  private recordRuntimeObjectShape(expression: Extract<Expression, { kind: "ObjectExpression" }>, owner: Extract<ValueType, { kind: "named" }>): void {
    const fields = this.fieldsOf(owner.identity ?? owner.name);
    if (!fields) return;
    for (const property of expression.properties) {
      if (property.kind !== "ObjectProperty") continue;
      const field = fields.get(property.name);
      if (!field) continue;
      this.semanticObjectPropertyOwners.set(`${property.span.start}:${property.name}`, owner);
      const nested = nonOptional(field);
      if (property.value.kind === "ObjectExpression" && nested.kind === "named") {
        this.recordRuntimeObjectShape(property.value, nested);
      }
    }
  }

  private listMember(list: Extract<ValueType, { kind: "list" }>, property: string): ValueType | null {
    const element = list.readonlyView ? this.readonlyDataViewOf(list.element) : list.element;
    const comparison = this.readonlyDataViewOf(list.element);
    const owned: ValueType = { kind: "list", element };
    const callable = (
      parameterNames: readonly string[],
      parameters: readonly ValueType[],
      result: ValueType,
      requiredParameters = parameters.length,
    ): ValueType => ({ kind: "function", parameterNames, parameters, requiredParameters, result });
    const test: ValueType = { kind: "function", parameters: [element], requiredParameters: 1, result: boolType };
    const transform: ValueType = { kind: "function", parameters: [element], requiredParameters: 1, result: unknownType };
    const compare: ValueType = { kind: "function", parameters: [element, element], requiredParameters: 2, result: numberType };
    const orderedKey: ValueType = unionOf([numberType, stringType]);
    const selectKey: ValueType = { kind: "function", parameters: [element], requiredParameters: 1, result: orderedKey };
    switch (property) {
      case "size":
        return numberType;
      case "get":
        return callable(["index"], [numberType], optionalOf(element));
      case "slice":
        return callable(["start", "end"], [numberType, numberType], owned, 0);
      case "append":
        if (list.readonlyView) return null;
        return callable(["value"], [list.element], nullType);
      case "extend":
        if (list.readonlyView) return null;
        return callable(["values"], [list], nullType);
      case "insert":
        if (list.readonlyView) return null;
        return callable(["index", "value"], [numberType, list.element], nullType);
      case "remove":
        if (list.readonlyView) return null;
        return callable(["value"], [comparison], boolType);
      case "pop":
        if (list.readonlyView) return null;
        return callable(["index"], [numberType], list.element, 0);
      case "clear":
        if (list.readonlyView) return null;
        return callable([], [], nullType);
      case "copy":
      case "reversed":
        return callable([], [], owned);
      case "has":
        return callable(["value"], [comparison], boolType);
      case "count":
        return callable(["value"], [comparison], numberType);
      case "sorted":
        return callable(["compare", "by"], [compare, selectKey], owned, 0);
      case "sum":
        return callable([], [], numberType);
      case "min":
      case "max":
        return callable([], [], optionalOf(element));
      case "map":
        return callable(["transform"], [transform], { kind: "list", element: unknownType });
      case "flatMap":
        return callable(
          ["transform"],
          [{ kind: "function", parameters: [element], requiredParameters: 1, result: { kind: "list", element: unknownType } }],
          { kind: "list", element: unknownType },
        );
      case "filter":
        return callable(["test"], [test], owned);
      case "reduce":
        return callable(["combine", "initial"], [unknownType, unknownType], unknownType);
      case "some":
      case "every":
        return callable(["test"], [test], boolType);
      case "find":
        return callable(["test"], [test], optionalOf(element));
      case "index":
        return callable(["value"], [comparison], optionalOf(numberType));
      case "join":
        return callable(["separator"], [stringType], stringType, 0);
      default:
        return null;
    }
  }

  private stringMember(property: string): ValueType | null {
    const callable = (
      parameterNames: readonly string[],
      parameters: readonly ValueType[],
      result: ValueType,
      requiredParameters = parameters.length,
    ): ValueType => ({ kind: "function", parameterNames, parameters, requiredParameters, result });
    switch (property) {
      case "size": return numberType;
      case "trim":
      case "upper":
      case "lower": return callable([], [], stringType);
      case "slice": return callable(["start", "end"], [numberType, numberType], stringType, 0);
      case "char": return callable(["index"], [numberType], optionalOf(stringType));
      case "has": return callable(["text"], [stringType], boolType);
      case "index": return callable(["text", "start"], [stringType, numberType], optionalOf(numberType), 1);
      case "count": return callable(["text"], [stringType], numberType);
      case "startsWith":
      case "endsWith": return callable(["text"], [stringType], boolType);
      case "split": return callable(["separator"], [stringType], { kind: "list", element: stringType });
      case "replace":
      case "replaceAll": return callable(["from", "to"], [stringType, stringType], stringType);
      case "padStart":
      case "padEnd": return callable(["size", "fill"], [numberType, stringType], stringType, 1);
      case "repeat": return callable(["count"], [numberType], stringType);
      case "isBlank": return callable([], [], boolType);
      default: return null;
    }
  }

  private numberMember(property: string): ValueType | null {
    const callable = (parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType): ValueType => ({
      kind: "function", parameterNames, parameters, requiredParameters: parameters.length, result,
    });
    switch (property) {
      case "abs":
      case "round":
      case "floor":
      case "ceil": return callable([], [], numberType);
      case "toFixed": return callable(["digits"], [numberType], stringType);
      case "isInteger":
      case "isNaN":
      case "isFinite": return callable([], [], boolType);
      default: return null;
    }
  }

  private collectionMemberError(kind: CollectionKind, property: string): string {
    const guidance = collectionMemberGuidance(kind, property);
    return `${kind} has no member '${property}'${guidance ? `; ${guidance.message}` : ""}`;
  }

  // COL-U3: exactly the predicate `x => x != null` (either operand order).
  // The closed shape keeps this a vocabulary rule, not a predicate-type
  // system: any other body — even `x => not (x == null)` — filters without
  // narrowing.
  private isNullExclusionPredicate(argument: Expression | null): boolean {
    if (argument?.kind !== "ArrowFunctionExpression" || argument.asynchronous) return false;
    const parameter = argument.parameters[0];
    if (argument.parameters.length !== 1 || !parameter || parameter.rest || parameter.defaultValue) return false;
    const body = argument.body;
    if (body.kind !== "BinaryExpression" || body.operator !== "!=") return false;
    const matches = (name: Expression, literal: Expression): boolean =>
      name.kind === "IdentifierExpression" && name.name === parameter.name
      && literal.kind === "LiteralExpression" && literal.value === null;
    return matches(body.left, body.right) || matches(body.right, body.left);
  }

  private mapMember(map: Extract<ValueType, { kind: "map" }>, property: string): ValueType | null {
    const key = map.readonlyView ? this.readonlyDataViewOf(map.key) : map.key;
    const comparisonKey = this.readonlyDataViewOf(map.key);
    const value = map.readonlyView ? this.readonlyDataViewOf(map.value) : map.value;
    const copy: ValueType = { kind: "map", key, value };
    const callable = (parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType): ValueType => ({
      kind: "function", parameterNames, parameters, requiredParameters: parameters.length, result,
    });
    switch (property) {
      case "size":
        return numberType;
      case "get":
        return callable(["key"], [comparisonKey], optionalOf(value));
      case "set":
        if (map.readonlyView) return null;
        return callable(["key", "value"], [map.key, map.value], nullType);
      case "update":
        if (map.readonlyView) return null;
        return callable(["values"], [map], nullType);
      case "has":
        return callable(["key"], [comparisonKey], boolType);
      case "remove":
        if (map.readonlyView) return null;
        return callable(["key"], [comparisonKey], boolType);
      case "clear":
        if (map.readonlyView) return null;
        return callable([], [], nullType);
      case "copy":
        return callable([], [], copy);
      case "keys":
        return callable([], [], { kind: "list", element: key });
      case "values":
        return callable([], [], { kind: "list", element: value });
      case "entries":
        return callable([], [], { kind: "list", element: { kind: "object", fields: new Map([["key", key], ["value", value]]) } });
      default:
        return null;
    }
  }

  private recordMember(record: Extract<ValueType, { kind: "record" }>, property: string): ValueType | null {
    const value = record.readonlyView ? this.readonlyDataViewOf(record.value) : record.value;
    const copy: ValueType = { kind: "record", value };
    const callable = (parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType): ValueType => ({
      kind: "function", parameterNames, parameters, requiredParameters: parameters.length, result,
    });
    switch (property) {
      case "size": return numberType;
      case "get": return callable(["key"], [stringType], optionalOf(value));
      case "set": return record.readonlyView ? null : callable(["key", "value"], [stringType, record.value], nullType);
      case "has": return callable(["key"], [stringType], boolType);
      case "remove": return record.readonlyView ? null : callable(["key"], [stringType], boolType);
      case "clear": return record.readonlyView ? null : callable([], [], nullType);
      case "copy": return callable([], [], copy);
      case "keys": return callable([], [], { kind: "list", element: stringType });
      case "values": return callable([], [], { kind: "list", element: value });
      case "entries": return callable([], [], { kind: "list", element: { kind: "object", fields: new Map([["key", stringType], ["value", value]]) } });
      default: return null;
    }
  }

  private setMember(set: Extract<ValueType, { kind: "set" }>, property: string): ValueType | null {
    const element = set.readonlyView ? this.readonlyDataViewOf(set.element) : set.element;
    const comparison = this.readonlyDataViewOf(set.element);
    const copy: ValueType = { kind: "set", element };
    const callable = (parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType): ValueType => ({
      kind: "function", parameterNames, parameters, requiredParameters: parameters.length, result,
    });
    switch (property) {
      case "size":
        return numberType;
      case "add":
        if (set.readonlyView) return null;
        return callable(["value"], [set.element], nullType);
      case "update":
        if (set.readonlyView) return null;
        return callable(["values"], [{ kind: "union", members: [set, { kind: "list", element: set.element }] }], nullType);
      case "has":
        return callable(["value"], [comparison], boolType);
      case "remove":
        if (set.readonlyView) return null;
        return callable(["value"], [comparison], boolType);
      case "clear":
        if (set.readonlyView) return null;
        return callable([], [], nullType);
      case "copy":
        return callable([], [], copy);
      case "values":
        return callable([], [], { kind: "list", element });
      case "union":
      case "intersection":
      case "difference":
        // COL-U2: the Set algebra copies — like sorted — and never mutates
        // either operand. The other operand is judged by the same
        // element-domain comparison question the membership probes use.
        return callable(["other"], [{ kind: "set", element: comparison }], copy);
      default:
        return null;
    }
  }

  private inferredExpressionType(expression: Expression): ValueType {
    const source = expression.kind === "SpreadExpression" ? expression.value : expression;
    return this.inferredExpressionTypes.get(spanIdentity(source.span)) ?? unknownType;
  }

  private checkArguments(
    arguments_: readonly Expression[],
    parameters: readonly ValueType[],
    callSpan: Span,
    requiredParameters = parameters.length,
    rest?: ValueType,
    argumentNames?: readonly (string | null)[],
    parameterNames?: readonly string[],
  ): void {
    if (argumentNames?.some((name) => name !== null)) {
      this.orderNamedArguments(arguments_, argumentNames, parameters, parameterNames, requiredParameters, callSpan, rest);
      return;
    }
    const firstSpread = arguments_.findIndex((argument) => argument.kind === "SpreadExpression");
    if (firstSpread >= 0) {
      let fixedIndex = 0;
      let sawSpread = false;
      for (const argument of arguments_) {
        if (argument.kind === "SpreadExpression") {
          sawSpread = true;
          const type = this.inferExpression(argument.value);
          if (!rest) this.typeError("Call spread requires a callable with a rest parameter", argument.span);
          else if (fixedIndex < parameters.length) {
            this.typeError(`Provide all ${parameters.length} fixed argument${parameters.length === 1 ? "" : "s"} before a call spread`, argument.span);
          } else if (type.kind === "list") this.requireAssignable(type.element, rest, argument.span);
          if (type.kind !== "list" && type.kind !== "any") {
            this.typeError(`Call spread requires a List, received ${describeType(type)}`, argument.span);
          }
          fixedIndex = parameters.length;
          continue;
        }

        const expected = sawSpread ? rest : parameters[fixedIndex] ?? rest;
        const actual = this.inferExpression(argument, expected ?? unknownType);
        if (expected) this.requireAssignable(actual, expected, argument.span);
        else this.typeError("This fixed-arity call has no position for another argument", argument.span);
        if (!sawSpread && fixedIndex < parameters.length) fixedIndex += 1;
      }
      return;
    }

    if (arguments_.length < requiredParameters || (!rest && arguments_.length > parameters.length)) {
      const expected = rest
        ? `at least ${requiredParameters}`
        : requiredParameters === parameters.length ? String(parameters.length) : `${requiredParameters}-${parameters.length}`;
      this.typeError(`Expected ${expected} ${argumentNoun(expected)} but received ${arguments_.length}`, callSpan);
    }
    for (let index = 0; index < arguments_.length; index += 1) {
      const expected = parameters[index] ?? rest ?? unknownType;
      const actual = this.inferExpression(arguments_[index]!, expected);
      this.requireAssignable(actual, expected, arguments_[index]!.span);
    }
  }

  private orderNamedArguments(
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    parameters: readonly ValueType[],
    parameterNames: readonly string[] | undefined,
    requiredParameters: number,
    callSpan: Span,
    rest?: ValueType,
  ): readonly Expression[] | null {
    const plan = this.planNamedArguments(
      arguments_,
      argumentNames,
      parameters,
      parameterNames,
      requiredParameters,
      callSpan,
      rest,
    );
    if (!plan) return null;
    for (const [source, target] of plan.targets.entries()) {
      const argument = arguments_[source]!;
      const value = argument.kind === "SpreadExpression" ? argument.value : argument;
      const expected = target === null ? unknownType : parameters[target] ?? rest ?? unknownType;
      const actual = this.inferExpression(value, expected);
      if (target !== null) this.requireAssignable(actual, expected, argument.span);
    }
    return plan.valid ? plan.ordered : null;
  }

  private callableWithInferredResult(type: ValueType, result: ValueType, asynchronous: boolean): ValueType {
    if (type.kind !== "function" && type.kind !== "action" && type.kind !== "intrinsic") return type;
    return { ...type, result: asynchronous ? { kind: "promise", value: result } : result };
  }

  private updateInferredCallableResult(
    statement: AnalyzableFunctionDeclaration,
    className: string | null,
    binding: Binding | null,
    result: ValueType,
    asynchronous: boolean,
  ): void {
    if (binding) {
      const type = this.callableWithInferredResult(binding.declaredType, result, asynchronous);
      binding.type = type;
      binding.declaredType = type;
      binding.storageType = type;
      this.recordSemanticBinding(`${binding.span.start}:${statement.name}`, type);
    }
    if (!className) return;
    const method = statement as FunctionDeclaration & { readonly static?: boolean; readonly private?: boolean; readonly accessor?: boolean };
    const info = this.classes.get(className);
    if (!info) return;
    if ("accessor" in method) {
      const fields: ReadonlyMap<string, ClassField> | undefined = method.private
        ? (method.static ? this.privateStaticFields : this.privateFields).get(className)
        : method.static ? info.staticFields : info.fields;
      const current = fields?.get(statement.name);
      if (current && fields instanceof Map) {
        fields.set(statement.name, {
          ...current,
          type: asynchronous ? { kind: "promise", value: result } : result,
        });
      }
      return;
    }
    const table: ReadonlyMap<string, ValueType> | undefined = method.private
      ? (method.static ? this.privateStaticMethods : this.privateMethods).get(className)
      : method.static ? info.staticMethods : info.methods;
    const current = table?.get(statement.name);
    if (current && table instanceof Map) {
      table.set(statement.name, this.callableWithInferredResult(current, result, asynchronous));
    }
  }

  private functionResultKey(statement: Pick<FunctionDeclaration, "signatureSpan">): string {
    return spanIdentity(statement.signatureSpan);
  }

  protected inferredFunctionResult(
    statement: Pick<FunctionDeclaration, "returnType" | "signatureSpan"> & { readonly abstract?: boolean },
  ): ValueType {
    if (statement.returnType) {
      return this.resolveValidatedResult(statement.returnType);
    }
    if (statement.abstract === true) return invalidType;
    const key = this.functionResultKey(statement);
    return this.inferredFunctionResultTypes.get(key)
      ?? this.inferredFunctionResultSeeds.get(key)
      ?? inferredResultPlaceholderType;
  }

  private inferCollectedFunctionResult(returned: readonly ValueType[], fallsThrough: boolean): ValueType {
    const concrete = returned.filter((type) => !containsInferredResultPlaceholder(type));
    const candidates = concrete.length > 0 ? concrete : [...returned];
    if (fallsThrough || candidates.length === 0) candidates.push(nullType);
    if (candidates.some(isInvalidType)) return invalidType;
    return candidates.reduce((result, candidate) => mergeTypes(result, candidate));
  }

  private functionType(statement: FunctionDeclaration): ValueType {
    const frame = this.typeParameterFrame(statement.typeParameters);
    const bounds = this.typeParameterBoundVector(statement.typeParameters);
    return this.withTypeParameterFrame(frame, () => {
      const result = this.inferredFunctionResult(statement);
      const rest = statement.parameters.find((parameter) => parameter.rest);
      return {
        kind: "function",
        ...(frame.size > 0 ? { typeParameterNames: [...frame.keys()] } : {}),
        ...(frame.size > 0 && bounds ? { typeParameterBounds: bounds } : {}),
        parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.resolveValidatedAnnotation(parameter.type)),
        parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
        requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
        ...(rest ? { rest: this.resolveValidatedAnnotation(rest.type) } : {}),
        result: statement.asynchronous ? { kind: "promise", value: this.resolvedAsyncResult(result) } : result,
      };
    });
  }

  private externFunctionType(
    statement: ExternFunctionDeclaration,
    resolve: (reference: TypeReference | null) => ValueType = (reference) => this.resolveAnnotation(reference),
  ): ValueType {
    const frame = this.typeParameterFrame(statement.typeParameters);
    const bounds = this.typeParameterBoundVector(statement.typeParameters);
    return this.withTypeParameterFrame(frame, () => {
      const result = statement.returnType ? resolve(statement.returnType) : invalidType;
      const rest = statement.parameters.find((parameter) => parameter.rest);
      const parameters = statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => resolve(parameter.type));
      return {
        kind: "function",
        ...(frame.size > 0 ? { typeParameterNames: [...frame.keys()] } : {}),
        ...(frame.size > 0 && bounds ? { typeParameterBounds: bounds } : {}),
        parameters,
        parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
        requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
        ...(rest ? { rest: resolve(rest.type) } : {}),
        result: statement.asynchronous ? { kind: "promise", value: this.resolvedAsyncResult(result) } : result,
      };
    });
  }

  private externConstantType(statement: ExternConstantDeclaration): ValueType {
    return this.resolveAnnotation(statement.type);
  }

  private externClassIdentity(source: string, name: string): string {
    return `js:${source}#${name}`;
  }

  private resolveExternAnnotation(reference: TypeReference | null, source: string, classNames: ReadonlySet<string>): ValueType {
    const resolve = (type: ValueType): ValueType => {
      if (type.kind === "named" && classNames.has(type.name)) {
        return { kind: "class", name: type.name, identity: this.externClassIdentity(source, type.name) };
      }
      if (type.kind === "named" && !type.identity) {
        const crossBlock = this.crossBlockExternClassType(type.name);
        if (crossBlock) return crossBlock;
      }
      if (type.kind === "optional") return optionalOf(resolve(type.inner));
      if (type.kind === "list") return { ...type, element: resolve(type.element) };
      if (type.kind === "set") return { ...type, element: resolve(type.element) };
      if (type.kind === "map") return { ...type, key: resolve(type.key), value: resolve(type.value) };
      if (type.kind === "record") return { ...type, value: resolve(type.value) };
      if (type.kind === "promise") return { kind: "promise", value: resolve(type.value) };
      if (type.kind === "runtimeType") return { kind: "runtimeType", value: resolve(type.value) };
      if (type.kind === "typeObject") return type.value ? { ...type, value: resolve(type.value) } : type;
      if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, resolve(value)])) };
      if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
        ...type,
        parameters: type.parameters.map(resolve),
        ...(type.rest ? { rest: resolve(type.rest) } : {}),
        result: resolve(type.result),
      };
      if (type.kind === "union") return { kind: "union", members: type.members.map(resolve) };
      return this.resolveNamedClasses(type);
    };
    return reference ? resolve(this.expandAliases(resolveTypeReference(reference))) : unknownType;
  }

  // An extern class carries one nominal identity per JavaScript source and
  // class name, so a reference from another extern block (or through an
  // 'import js' alias) resolves to the declaring source's class instead of
  // freezing into a structural named type that can never match it.
  private crossBlockExternClassType(name: string): ValueType | null {
    if (this.typeParameterFrames.at(-1)?.has(name)) return null;
    if (this.namedTypes.has(name)
      || this.namedTypeIdentities.has(name)
      || this.typeAliases.has(name)
      || this.classes.has(name)
      || this.enums.has(name)) return null;
    const imported = this.externTypeImports.get(name);
    if (imported?.kind === "class") return imported;
    const sources = this.externClassDeclarations.get(name);
    if (sources?.size !== 1) return null;
    const [declaringSource] = sources;
    return { kind: "class", name, identity: this.externClassIdentity(declaringSource!, name) };
  }

  private resolveValidatedExternAnnotation(reference: TypeReference | null, source: string, classNames: ReadonlySet<string>): ValueType {
    if (!reference) return unknownType;
    return this.invalidExternTypeReferences.has(reference)
      ? invalidType
      : this.resolveExternAnnotation(reference, source, classNames);
  }

  private importType(statement: Extract<Statement, { kind: "ImportDeclaration" }>, local: string, imported: string, namespace: boolean, importSpan: Span): ValueType {
    if (!statement.javascript) {
      const type = this.importBindings.get(local) ?? unknownType;
      if (type.kind === "classConstructor" && type.identity) this.classDisplayNames.set(type.identity, local);
      return type;
    }
    if (statement.unsafe) return anyType;
    const declarations = this.externModules.get(statement.source);
    if (namespace) return declarations
      ? { kind: "object", fields: declarations, readonlyFields: new Set(declarations.keys()) }
      : this.importBindings.get(local) ?? unknownType;
    // BRG-N1: a manual extern block owns the whole source contract, so an
    // imported name it does not declare is a check-time error — the same
    // stance a .vel module already takes — instead of silently binding
    // unknown (which is how a typo used to disappear).
    if (declarations && !declarations.has(imported)) {
      this.typeError(
        `Extern module '${statement.source}' does not declare '${imported}'; add it to the extern block, or fix the imported name`,
        importSpan,
      );
      return unknownType;
    }
    const type = declarations?.get(imported) ?? this.importBindings.get(local) ?? unknownType;
    if (type.kind === "classConstructor" && type.identity) {
      this.classDisplayNames.set(type.identity, local);
      return { ...type, name: local };
    }
    return type;
  }

  protected narrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType> {
    return this.conditionNarrowing(expression, true, knownType);
  }

  protected negativeNarrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType> {
    return this.conditionNarrowing(expression, false, knownType);
  }

  private conditionNarrowing(expression: Expression, truthy: boolean, knownType?: ValueType): ReadonlyMap<string, ValueType> {
    const logical = this.logicalConditionNarrowings.get(spanIdentity(expression.span));
    if (logical) return truthy ? logical.truthy : logical.falsy;
    const narrowed = new Map<string, ValueType>();
    if (expression.kind === "UnaryExpression" && expression.operator === "not") {
      return this.conditionNarrowing(expression.operand, !truthy);
    }
    if (expression.kind === "BinaryExpression" && (expression.operator === "==" || expression.operator === "!=")) {
      const leftIsNone = expression.left.kind === "LiteralExpression" && expression.left.value === null;
      const rightIsNone = expression.right.kind === "LiteralExpression" && expression.right.value === null;
      if (leftIsNone !== rightIsNone) {
        const candidate = leftIsNone ? expression.right : expression.left;
        const candidateType = this.inferredExpressionTypes.get(spanIdentity(candidate.span));
        if (candidateType?.kind === "optional") {
          const equalToNone = expression.operator === "==" ? truthy : !truthy;
          this.addLocationNarrowing(narrowed, candidate, equalToNone ? nullType : candidateType.inner);
        }
      }
      const leftType = this.inferredExpressionTypes.get(spanIdentity(expression.left.span));
      const rightType = this.inferredExpressionTypes.get(spanIdentity(expression.right.span));
      const leftPath = this.narrowableLocation(expression.left);
      const rightPath = this.narrowableLocation(expression.right);
      const singleton = rightType?.kind === "enumMember" && leftPath
        ? { candidate: expression.left, current: leftType, singleton: rightType }
        : leftType?.kind === "enumMember" && rightPath
          ? { candidate: expression.right, current: rightType, singleton: leftType }
          : null;
      if (singleton?.current) {
        const equal = expression.operator === "==" ? truthy : !truthy;
        const narrowedType = this.narrowEnumMember(singleton.current, singleton.singleton, equal);
        if (narrowedType) this.addLocationNarrowing(narrowed, singleton.candidate, narrowedType);
      }
      return narrowed;
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "MemberExpression"
      && expression.callee.property === "is" && expression.arguments.length === 1
      && expression.arguments[0]!.kind !== "SpreadExpression") {
      const target = this.validatorTargetOf(expression.callee.object);
      const value = expression.arguments[0]!;
      if (target) {
        const current = this.inferredExpressionTypes.get(spanIdentity(value.span)) ?? unknownType;
        if (truthy) this.addLocationNarrowing(narrowed, value, this.runtimeCheckedType(current, target));
        else {
          const remaining = this.excludeCheckedType(current, target);
          if (remaining) this.addLocationNarrowing(narrowed, value, remaining);
        }
      }
    } else if (expression.kind === "IdentifierExpression") {
      const type = this.lookup(expression.name)?.type;
      if (type?.kind === "optional") {
        const fact = this.bareConditionNarrowing(type, truthy);
        if (fact) narrowed.set(expression.name, fact);
      }
    } else if (expression.kind === "MemberExpression" && !expression.optional) {
      const path = this.stableMemberAccessPath(expression);
      const type = knownType ?? this.inferredExpressionTypes.get(spanIdentity(expression.span));
      if (path && type?.kind === "optional") {
        const fact = this.bareConditionNarrowing(type, truthy);
        if (fact) narrowed.set(`${memberNarrowingPrefix}${path}`, fact);
      }
    } else if (expression.kind === "IsExpression") {
      const checked = this.resolveAnnotation(expression.type);
      const matches = expression.operator === "is" ? truthy : !truthy;
      if (matches) {
        const current = this.inferredExpressionTypes.get(spanIdentity(expression.value.span)) ?? unknownType;
        this.addLocationNarrowing(narrowed, expression.value, this.runtimeCheckedType(current, checked));
      } else {
        const current = this.inferredExpressionTypes.get(spanIdentity(expression.value.span));
        const remaining = current ? this.excludeCheckedType(current, checked) : null;
        if (remaining) this.addLocationNarrowing(narrowed, expression.value, remaining);
      }
    }
    return narrowed;
  }

  /** The concrete checked value behind `Kind.is(value)`, when Kind is a runtime validator. */
  private validatorTargetOf(object: Expression): ValueType | null {
    if (object.kind !== "IdentifierExpression") return null;
    const type = this.lookup(object.name)?.type ?? this.builtin(object.name)?.type;
    if (!type) return null;
    if (type.kind === "enumObject") return { kind: "enum", name: type.name, identity: type.identity };
    if (type.kind === "typeObject") return this.runtimeTypeObjectValue(type);
    if (type.kind === "runtimeType") return type.value;
    return null;
  }

  // A bare optional condition is legal only for 'bool?', where it judges truth:
  // the true branch proves 'true', and the else branch learns nothing because
  // both 'false' and an absent value reach it. Every other optional is rejected
  // in condition position; those keep the old presence fact so one rejected
  // line does not also cascade optional-access errors through its own body.
  private bareConditionNarrowing(type: Extract<ValueType, { kind: "optional" }>, truthy: boolean): ValueType | null {
    if (this.expandAliases(type.inner).kind === "bool") return truthy ? boolType : null;
    return truthy ? type.inner : nullType;
  }

  private excludeCheckedType(current: ValueType, checked: ValueType): ValueType | null {
    if (current.kind === "optional") {
      const innerExcluded = isAssignable(current.inner, checked, this);
      const noneExcluded = isAssignable(nullType, checked, this);
      if (innerExcluded && !noneExcluded) return nullType;
      if (noneExcluded && !innerExcluded) return current.inner;
      return null;
    }
    if (current.kind !== "union") return null;
    const remaining = current.members.filter((member) => !isAssignable(member, checked, this));
    return remaining.length > 0 && remaining.length < current.members.length ? unionOf(remaining) : null;
  }

  private addLocationNarrowing(target: Map<string, ValueType>, expression: Expression, type: ValueType): void {
    if (expression.kind === "IdentifierExpression") {
      if (this.lookup(expression.name)) target.set(expression.name, type);
      return;
    }
    const path = this.stableMemberAccessPath(expression);
    if (path) {
      target.set(`${memberNarrowingPrefix}${path}`, type);
      if (expression.kind === "MemberExpression") {
        const owner = this.inferredExpressionTypes.get(spanIdentity(expression.object.span));
        const narrowedOwner = owner ? this.narrowDiscriminatedOwner(owner, expression.property, type) : null;
        if (narrowedOwner) this.addLocationNarrowing(target, expression.object, narrowedOwner);
      }
    }
  }

  private narrowableLocation(expression: Expression): boolean {
    return expression.kind === "IdentifierExpression"
      ? this.lookup(expression.name) !== null
      : this.stableMemberAccessPath(expression) !== null;
  }

  private narrowEnumMember(current: ValueType, singleton: Extract<ValueType, { kind: "enumMember" }>, equal: boolean): ValueType | null {
    const source = this.expandAliases(current);
    const sameSingleton = (candidate: ValueType): boolean => candidate.kind === "enumMember"
      && candidate.identity === singleton.identity
      && candidate.member === singleton.member;
    if (equal) {
      if (source.kind === "enum" && source.identity === singleton.identity) return singleton;
      if (source.kind === "enumMember") return sameSingleton(source) ? source : null;
      if (source.kind === "union") return source.members.some(sameSingleton) ? singleton : null;
      return null;
    }
    if (source.kind === "union") {
      const remaining = source.members.filter((member) => !sameSingleton(member));
      return remaining.length > 0 && remaining.length < source.members.length ? unionOf(remaining) : null;
    }
    if (source.kind === "enum" && source.identity === singleton.identity) {
      const members = this.enums.get(source.identity)?.members ?? this.enums.get(source.name)?.members;
      if (!members) return null;
      const remaining = [...members]
        .filter((member) => member !== singleton.member)
        .map((member): ValueType => ({ kind: "enumMember", name: source.name, identity: source.identity, member }));
      return remaining.length > 0 ? unionOf(remaining) : null;
    }
    return null;
  }

  private narrowDiscriminatedOwner(owner: ValueType, property: string, narrowedField: ValueType): ValueType | null {
    const source = this.expandAliases(owner);
    if (source.kind !== "union") return null;
    const candidates = source.members.filter((member) => {
      const field = this.discriminatedDataField(member, property);
      return field !== null && this.matchTypesOverlap(field, narrowedField);
    });
    return candidates.length > 0 && candidates.length < source.members.length ? unionOf(candidates) : null;
  }

  private inferNarrowedExpression(
    expression: Expression,
    narrowed: ReadonlyMap<string, ValueType>,
    contextualType: ValueType,
  ): ValueType {
    return this.withTemporaryNarrowings(narrowed, expression.span, () => this.inferExpression(expression, contextualType));
  }

  private withTemporaryNarrowings<T>(
    narrowed: ReadonlyMap<string, ValueType>,
    narrowingSpan: Span,
    analyze: () => T,
  ): T {
    if (narrowed.size === 0) return analyze();
    this.enterScope();
    try {
      this.applyNarrowings(narrowed, narrowingSpan);
      return analyze();
    } finally {
      this.exitScope();
    }
  }

  private optionalExecutionNarrowings(expression: Expression): ReadonlyMap<string, ValueType> {
    const narrowed = new Map<string, ValueType>();
    const visit = (candidate: Expression): void => {
      const known = this.inferredExpressionTypes.get(spanIdentity(candidate.span));
      const expanded = known ? this.expandAliases(known) : null;
      if (expanded?.kind === "optional") {
        if (candidate.kind === "IdentifierExpression" && this.lookup(candidate.name)) {
          narrowed.set(candidate.name, expanded.inner);
        } else if (candidate.kind === "MemberExpression") {
          const path = this.stableOptionalMemberAccessPath(candidate);
          if (path) narrowed.set(`${memberNarrowingPrefix}${path}`, expanded.inner);
        }
      }
      if (candidate.kind === "MemberExpression" || candidate.kind === "IndexExpression") {
        visit(candidate.object);
      } else if (candidate.kind === "CallExpression") {
        visit(candidate.callee);
      }
    };
    visit(expression);
    return narrowed;
  }

  private inferConditionWithNarrowings(
    expression: Expression,
    narrowed: ReadonlyMap<string, ValueType>,
  ): {
    readonly type: ValueType;
    readonly truthy: ReadonlyMap<string, ValueType>;
    readonly falsy: ReadonlyMap<string, ValueType>;
    readonly surviving: ReadonlyMap<string, ValueType>;
  } {
    if (narrowed.size === 0) {
      const type = this.inferExpression(expression);
      this.requireCondition(type, expression);
      return {
        type,
        truthy: this.narrowingFor(expression, type),
        falsy: this.negativeNarrowingFor(expression, type),
        surviving: new Map(),
      };
    }
    this.enterScope();
    try {
      this.applyNarrowings(narrowed, expression.span);
      const type = this.inferExpression(expression);
      this.requireCondition(type, expression);
      return {
        type,
        truthy: this.narrowingFor(expression, type),
        falsy: this.negativeNarrowingFor(expression, type),
        surviving: this.survivingNarrowings(narrowed),
      };
    } finally {
      this.exitScope();
    }
  }

  private combineNarrowings(
    first: ReadonlyMap<string, ValueType>,
    second: ReadonlyMap<string, ValueType>,
  ): ReadonlyMap<string, ValueType> {
    return new Map([...first, ...second]);
  }

  // A condition judges truth, never presence. 'bool' and 'bool?' both ask
  // whether the value is true, so 'false' and null take the same else path and
  // 'if flag:' stays the spelling for both. Any other optional has to say
  // which question it asks, because "holds a value" and "is true" are
  // different tests. BRG-N4: `any` is rejected too — raw JavaScript
  // truthiness would judge 0 and "" false, which breaks the owner's ruling
  // that a condition judges only bool; validate the boundary value first.
  protected requireCondition(type: ValueType, condition: Expression): void {
    if (isInvalidType(type)) return;
    const expanded = this.expandAliases(type);
    if (expanded.kind === "bool") return;
    if (expanded.kind === "any") {
      this.typeError(
        "A condition judges only bool, and an unchecked any would ride JavaScript truthiness (0 and \"\" become false); validate the value first, or compare it explicitly",
        condition.span,
      );
      return;
    }
    if (expanded.kind === "optional") {
      if (this.expandAliases(expanded.inner).kind === "bool") {
        this.truthConditions.add(spanIdentity(condition.span));
        return;
      }
      const subject = this.conditionSubjectText(condition);
      this.typeError(
        subject
          ? `A condition judges truth, not presence; write '${subject} != null' to test ${describeType(type)} for a value`
          : `A condition judges truth, not presence; add '!= null' to test ${describeType(type)} for a value`,
        condition.span,
      );
      return;
    }
    this.typeError(`Condition must be bool, received ${describeType(type)}`, condition.span);
  }

  // Presence guidance names the exact spelling to write whenever the condition
  // is a plain name or a plain member path; anything else is taught the
  // operator without inventing source text for it.
  private conditionSubjectText(condition: Expression): string | null {
    if (condition.kind === "IdentifierExpression") return condition.name;
    if (condition.kind === "MemberExpression" && !condition.optional) {
      const owner = this.conditionSubjectText(condition.object);
      return owner === null ? null : `${owner}.${condition.property}`;
    }
    return null;
  }

  protected requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void {
    if (this.contextuallyAssignable(actual, expected, valueSpan)) {
      this.freezeEscapedCollectionInference(actual, expected);
      return;
    }
    const expandedActual = this.expandAliases(actual);
    const expandedExpected = this.expandAliases(expected);
    const expectedCore = expandedExpected.kind === "optional" ? this.expandAliases(expandedExpected.inner) : expandedExpected;
    // COL-I5: a named record type is open — a User value may carry fields
    // beyond its declaration (validation admits extras), so it cannot flow
    // into Record<T> wholesale; the spread spelling is rejected for the same
    // reason (COL-D2).
    if (expandedActual.kind === "named" && expectedCore.kind === "record"
      && this.fieldsOf(expandedActual.identity ?? expandedActual.name)) {
      const fields = [...this.fieldsOf(expandedActual.identity ?? expandedActual.name)!.keys()];
      const example = fields.slice(0, 2).map((field) => `${field}: value.${field}`).join(", ") + (fields.length > 2 ? ", ..." : "");
      this.typeError(
        `Cannot assign ${describeType(actual)} to ${describeType(expected)}: a named record is open, so a ${describeType(actual)} value may carry fields beyond its declaration; copy the declared fields explicitly — {${example}}`,
        valueSpan,
      );
      return;
    }
    if (expandedActual.kind === "object" && expectedCore.kind === "map") {
      this.typeError(expandedActual.fields.size === 0
        ? "Use 'Map()' to create an empty Map; a record literal '{}' builds a record, not a Map"
        : "Use 'Map({...})' to convert record fields into string-keyed entries; a record literal '{...}' builds a record, not a Map", valueSpan);
      return;
    }
    // D41 item 61: a bounded generic used as a first-class value fails
    // assignability for one specific reason worth naming.
    if (this.reportFirstClassBoundViolation(expandedActual, expectedCore, valueSpan)) return;
    const actualDescription = describeType(actual);
    const expectedDescription = describeType(expected);
    if (actualDescription !== expectedDescription) {
      // COL-U10: a value of one collection family in another family's
      // position gets the bridge spelling, not a bare mismatch.
      const bridge = this.collectionBridgeGuidance(expandedActual, expectedCore);
      this.typeError(`Cannot assign ${actualDescription} to ${expectedDescription}${bridge ? `; ${bridge}` : ""}`, valueSpan);
      return;
    }
    // Same-named contracts read identically, so name the declaring sources
    // when the identities show where each contract actually comes from.
    const actualCore = expandedActual.kind === "optional" ? this.expandAliases(expandedActual.inner) : expandedActual;
    const actualOrigin = contractOrigin(actualCore);
    const expectedOrigin = contractOrigin(expectedCore);
    const origins = actualOrigin !== expectedOrigin && (actualOrigin !== null || expectedOrigin !== null)
      ? ` (the value is ${actualOrigin ?? "a structural type"} and the target is ${expectedOrigin ?? "a structural type"})`
      : "";
    this.typeError(`Cannot assign ${actualDescription} to a different ${expectedDescription} contract${origins}`, valueSpan);
  }

  // COL-U10: the collection families never assign across each other; each
  // rejected pair has one blessed bridge spelling worth naming.
  private collectionBridgeGuidance(actual: ValueType, expectedCore: ValueType): string | null {
    if (expectedCore.kind === "list") {
      if (actual.kind === "set") return "Set.values() returns the members as a List";
      if (actual.kind === "map") return "Map.keys(), Map.values(), or Map.entries() return the entries as Lists";
      if (actual.kind === "record") return "Record.keys(), Record.values(), or Record.entries() return the fields as Lists";
    }
    if (expectedCore.kind === "set" && (actual.kind === "list")) return "Set(values) builds a Set from a List";
    if (expectedCore.kind === "map") {
      if (actual.kind === "record") return "Map(record) builds a string-keyed Map from a record";
      if (actual.kind === "list") return "Map(entries) builds a Map from a List of [key, value] Lists";
    }
    return null;
  }

  private freezeEscapedCollectionInference(actual: ValueType, expected: ValueType, seen: WeakMap<object, WeakSet<object>> = new WeakMap()): void {
    const inference = this.collectionInferenceTypes.get(actual);
    const expectedInference = this.collectionInferenceTypes.get(expected);
    if (inference && actual !== expected && !expectedInference) inference.open = false;

    const expandedActual = this.expandAliases(actual);
    const expandedExpected = this.expandAliases(expected);
    const expectedSeen = seen.get(expandedActual) ?? new WeakSet<object>();
    if (expectedSeen.has(expandedExpected)) return;
    expectedSeen.add(expandedExpected);
    seen.set(expandedActual, expectedSeen);

    if (expandedExpected.kind === "optional") {
      if (expandedActual.kind === "optional") this.freezeEscapedCollectionInference(expandedActual.inner, expandedExpected.inner, seen);
      else if (expandedActual.kind !== "null") this.freezeEscapedCollectionInference(expandedActual, expandedExpected.inner, seen);
      return;
    }
    if (expandedExpected.kind === "union") {
      const target = expandedExpected.members.find((member) => isAssignable(expandedActual, member, this));
      if (target) this.freezeEscapedCollectionInference(expandedActual, target, seen);
      return;
    }
    if (expandedActual.kind === "union") {
      for (const member of expandedActual.members) this.freezeEscapedCollectionInference(member, expandedExpected, seen);
      return;
    }
    if ((expandedActual.kind === "list" && expandedExpected.kind === "list")
      || (expandedActual.kind === "set" && expandedExpected.kind === "set")) {
      this.freezeEscapedCollectionInference(expandedActual.element, expandedExpected.element, seen);
      return;
    }
    if (expandedActual.kind === "map" && expandedExpected.kind === "map") {
      this.freezeEscapedCollectionInference(expandedActual.key, expandedExpected.key, seen);
      this.freezeEscapedCollectionInference(expandedActual.value, expandedExpected.value, seen);
      return;
    }
    if (expandedActual.kind === "record" && expandedExpected.kind === "record") {
      this.freezeEscapedCollectionInference(expandedActual.value, expandedExpected.value, seen);
      return;
    }
    const actualFields = expandedActual.kind === "object" ? expandedActual.fields
      : expandedActual.kind === "named" ? this.fieldsOf(expandedActual.identity ?? expandedActual.name)
        : null;
    const expectedFields = expandedExpected.kind === "object" ? expandedExpected.fields
      : expandedExpected.kind === "named" ? this.fieldsOf(expandedExpected.identity ?? expandedExpected.name)
        : null;
    if (actualFields && expectedFields) {
      for (const [name, expectedField] of expectedFields) {
        const actualField = actualFields.get(name);
        if (actualField) this.freezeEscapedCollectionInference(actualField, expectedField, seen);
      }
    }
  }

  private contextuallyAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): boolean {
    if (isAssignable(actual, expected, this)) return true;
    const expandedActual = this.expandAliases(actual);
    const expandedExpected = this.expandAliases(expected);
    if ((expandedActual !== actual || expandedExpected !== expected)
      && isAssignable(expandedActual, expandedExpected, this)) return true;
    const contextual = this.contextualAssignments.get(spanIdentity(valueSpan));
    return Boolean(contextual && isAssignable(this.expandAliases(contextual), expandedExpected, this));
  }

  private contextualObjectType(
    type: ValueType,
    expression?: Extract<Expression, { kind: "ObjectExpression" }>,
  ): Extract<ValueType, { kind: "named" | "object" | "record" }> | null {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "named") return this.primitiveNames.has(expanded.name) ? null : expanded;
    if (expanded.kind === "object") return expanded;
    if (expanded.kind === "record") return expanded;
    if (expanded.kind === "optional") return this.contextualObjectType(expanded.inner, expression);
    if (expanded.kind === "union") {
      const candidates = expanded.members
        .map((member) => this.contextualObjectType(member, expression))
        .filter((member): member is Extract<ValueType, { kind: "named" | "object" | "record" }> => member !== null);
      if (candidates.length === 1) return candidates[0]!;
      if (expression) {
        const matching = candidates.filter((candidate) => this.contextualObjectDiscriminantsMatch(candidate, expression));
        if (matching.length === 1) return matching[0]!;
      }
    }
    return null;
  }

  private contextualObjectDiscriminantsMatch(
    candidate: Extract<ValueType, { kind: "named" | "object" | "record" }>,
    expression: Extract<Expression, { kind: "ObjectExpression" }>,
  ): boolean {
    if (candidate.kind === "record") return true;
    const fields = candidate.kind === "object"
      ? candidate.fields
      : this.fieldsOf(candidate.identity ?? candidate.name);
    if (!fields) return false;
    for (const property of expression.properties) {
      if (property.kind !== "ObjectProperty") continue;
      const expected = fields.get(property.name);
      if (expected?.kind !== "enumMember") continue;
      const actual = this.knownEnumSingleton(property.value);
      if (actual && (actual.identity !== expected.identity || actual.member !== expected.member)) return false;
    }
    return true;
  }

  private knownEnumSingleton(expression: Expression): Extract<ValueType, { kind: "enumMember" }> | null {
    const inferred = this.inferredExpressionTypes.get(spanIdentity(expression.span));
    if (inferred?.kind === "enumMember") return inferred;
    if (expression.kind === "IdentifierExpression") {
      const type = this.expandAliases(this.lookup(expression.name)?.type ?? unknownType);
      return type.kind === "enumMember" ? type : null;
    }
    if (expression.kind !== "MemberExpression" || expression.object.kind !== "IdentifierExpression") return null;
    const owner = this.lookup(expression.object.name)?.type ?? this.importBindings.get(expression.object.name);
    return owner?.kind === "enumObject" && owner.members.has(expression.property)
      ? { kind: "enumMember", name: owner.name, identity: owner.identity, member: expression.property }
      : null;
  }

  private widenAggregateSingleton(type: ValueType): ValueType {
    return type.kind === "enumMember"
      ? { kind: "enum", name: type.name, identity: type.identity }
      : type;
  }

  private contextualCollectionType(type: ValueType): Extract<ValueType, { kind: "list" | "map" | "set" }> | null {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "list" || expanded.kind === "map" || expanded.kind === "set") return expanded;
    if (expanded.kind === "optional") return this.contextualCollectionType(expanded.inner);
    return null;
  }

  private formReadField(name: string, source: ValueType, fieldSpan: Span): FormReadField | null {
    const expanded = this.expandAliases(source);
    const optional = expanded.kind === "optional";
    const type = optional ? expanded.inner : expanded;
    if (type.kind === "string" || type.kind === "number") {
      return { name, kind: type.kind, optional };
    }
    if (type.kind === "bool" && !optional) {
      return { name, kind: "bool", optional: false };
    }
    if (type.kind === "enum") {
      const values = this.enums.get(type.identity)?.members ?? this.enums.get(type.name)?.members;
      if (values) return { name, kind: "enum", optional, enumValues: [...values] };
    }
    if (type.kind === "enumMember") {
      return { name, kind: "enum", optional, enumValues: [type.member] };
    }
    if (type.kind === "list" && type.element.kind === "string" && !optional) {
      return { name, kind: "strings", optional: false };
    }
    this.typeError(`Form field '${name}' cannot decode ${describeType(expanded)}; use string, number, bool, an enum, an optional scalar, or List<string>`, fieldSpan);
    return null;
  }

  private jsonSerializable(source: ValueType, seen: ReadonlySet<string> = new Set()): boolean | null {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    if (type.kind === "unknown" || type.kind === "any") return null;
    if (type.kind === "null" || type.kind === "string" || type.kind === "number" || type.kind === "bool" || type.kind === "enum" || type.kind === "enumMember") return true;
    if (type.kind === "optional") return this.jsonSerializable(type.inner, seen);
    if (type.kind === "list") return this.jsonSerializable(type.element, seen);
    if (type.kind === "record") return this.jsonSerializable(type.value, seen);
    if (type.kind === "union") return this.combineJsonStatuses(type.members.map((member) => this.jsonSerializable(member, seen)));
    if (type.kind === "object") return this.combineJsonStatuses([...type.fields.values()].map((field) => this.jsonSerializable(field, seen)));
    // D41 item 61: a `Data`-bounded parameter promises a strict JSON shape.
    if (type.kind === "parameter") return boundGrants(this.boundOf(type), "data");
    if (type.kind === "named") {
      const identity = type.identity ?? type.name;
      if (seen.has(identity)) return true;
      const fields = this.fieldsOf(identity);
      if (!fields) return false;
      const next = new Set([...seen, identity]);
      return this.combineJsonStatuses([...fields.values()].map((field) => this.jsonSerializable(field, next)));
    }
    return false;
  }

  private isHttpFormBody(source: ValueType): boolean {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    return type.kind === "object"
      && ["field", "file", "files", "remove", "has", "names"].every((name) => type.fields.has(name));
  }

  // D42 item 65: the single place in the compiler that answers "is this
  // ordered". Every ordering site — direct `<` `<=` `>` `>=`, `min`/`max`,
  // default `sorted()`, `sorted(by=)`, `sortBy`, `minBy`, `maxBy` — asks this
  // one question, because four mechanisms giving three answers was the
  // structural root of ORD-1/2/3. `Comparable` is exactly `number`, `string`,
  // and single-category unions of them: enums are bare strings at runtime, so
  // ordering them silently yields member-name alphabetical order. `any` and
  // `unknown` answer "dynamic" instead of an order, and each caller decides
  // whether an unchecked boundary value is admissible there.
  private orderedTypeCategory(source: ValueType): "number" | "string" | "comparable" | "dynamic" | null {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    if (type.kind === "any" || type.kind === "unknown") return "dynamic";
    if (type.kind === "number") return "number";
    if (type.kind === "string") return "string";
    // D41 item 61: a `Comparable`-bounded parameter has an order, but not one
    // category statically — two of them compare through the runtime
    // comparator, which keeps string ordering by code point (TXT-D1).
    if (type.kind === "parameter") return boundGrants(this.boundOf(type), "order") ? "comparable" : null;
    if (type.kind !== "union" || type.members.length === 0) return null;
    let category: "number" | "string" | null = null;
    for (const member of type.members) {
      const memberCategory = this.orderedTypeCategory(member);
      // A union mixing a bounded parameter with a concrete category has no
      // single order, exactly as a number/string union has none.
      if (memberCategory === null || memberCategory === "dynamic" || memberCategory === "comparable") return null;
      if (category !== null && category !== memberCategory) return null;
      category = memberCategory;
    }
    return category;
  }

  private combineJsonStatuses(statuses: readonly (boolean | null)[]): boolean | null {
    if (statuses.some((status) => status === false)) return false;
    return statuses.some((status) => status === null) ? null : true;
  }

  // The frame comes from the declaration that owns the annotation being
  // resolved, never from ambient scope, so predeclare-time resolution works.
  private typeParameterFrame(declarations: readonly TypeParameterDeclaration[] | undefined): ReadonlyMap<string, ValueType> {
    const frame = new Map<string, ValueType>();
    const bounds = new Map<string, TypeParameterBound>();
    for (const declaration of declarations ?? []) {
      if (frame.has(declaration.name)) continue;
      frame.set(declaration.name, { kind: "parameter", name: declaration.name, index: frame.size });
      if (declaration.bound && isTypeParameterBound(declaration.bound)) bounds.set(declaration.name, declaration.bound);
    }
    // D41 item 61 risk 2: the bounds ride alongside the frame instead of
    // inside the `parameter` type, and every push/pop of a frame carries them
    // automatically because they are keyed by the frame itself.
    if (bounds.size > 0) this.typeParameterFrameBounds.set(frame, bounds);
    return frame;
  }

  /** D41 item 61: the ordered bound vector of a declaration, for its callable type. */
  private typeParameterBoundVector(
    declarations: readonly TypeParameterDeclaration[] | undefined,
  ): readonly (TypeParameterBound | null)[] | null {
    const bounds: (TypeParameterBound | null)[] = [];
    const seen = new Set<string>();
    for (const declaration of declarations ?? []) {
      if (seen.has(declaration.name)) continue;
      seen.add(declaration.name);
      bounds.push(declaration.bound && isTypeParameterBound(declaration.bound) ? declaration.bound : null);
    }
    return bounds.some((bound) => bound !== null) ? bounds : null;
  }

  /**
   * D41 item 61 risk 2: only the innermost frame is consulted. A nested `def`
   * may not name an enclosing declaration's type parameter (VEL4021 rejects
   * it), so one frame is the whole visible scope.
   */
  boundOf(type: Extract<ValueType, { kind: "parameter" }>): TypeParameterBound | null {
    const frame = this.typeParameterFrames.at(-1);
    if (!frame || frame.get(type.name)?.kind !== "parameter") return null;
    return this.typeParameterFrameBounds.get(frame)?.get(type.name) ?? null;
  }

  /**
   * The one decision procedure for "does this solved type argument satisfy
   * this bound", shared by the call site and the first-class value path. Each
   * bound reuses the predicate that already governs its capability.
   */
  satisfiesBound(type: ValueType, bound: TypeParameterBound): boolean {
    const expanded = this.expandAliases(type);
    if (isInvalidType(expanded)) return true;
    // `any` is the declared escape hatch every capability site already admits;
    // `unknown` is the unvalidated boundary value none of them admit.
    if (expanded.kind === "any") return true;
    if (expanded.kind === "unknown") return false;
    switch (bound) {
      case "Text":
        return this.isTextConvertible(expanded);
      case "Comparable":
        return this.orderedTypeCategory(expanded) !== null;
      case "Data":
        return this.jsonSerializable(expanded) !== false;
    }
  }

  private withTypeParameterFrame<T>(frame: ReadonlyMap<string, ValueType>, action: () => T): T {
    this.typeParameterFrames.push(frame);
    try {
      return action();
    } finally {
      this.typeParameterFrames.pop();
    }
  }

  private enclosingTypeParameterName(name: string): boolean {
    return this.typeParameterFrames.slice(0, -1).some((frame) => frame.has(name));
  }

  private checkTypeParameterDeclarations(declarations: readonly TypeParameterDeclaration[] | undefined): void {
    const seen = new Set<string>();
    for (const declaration of declarations ?? []) {
      if (seen.has(declaration.name)) {
        this.diagnostics.push(diagnostic("VEL4021", `Type parameter '${declaration.name}' is declared more than once`, declaration.span));
        continue;
      }
      seen.add(declaration.name);
      if (this.isDeclaredTypeName(declaration.name)) {
        this.diagnostics.push(diagnostic("VEL4021", `Type parameter '${declaration.name}' shadows an existing type name; choose another name`, declaration.span));
      }
      if (declaration.bound !== undefined && !isTypeParameterBound(declaration.bound)) {
        const vocabulary = typeParameterBoundNames.join(", ");
        this.diagnostics.push(diagnostic(
          "VEL4021",
          this.isDeclaredTypeName(declaration.bound)
            ? `'${declaration.bound}' cannot bound a type parameter; a bound is one of the compiler's own names — ${vocabulary} — never an arbitrary type`
            : `Unknown type parameter bound '${declaration.bound}'; the bounds are ${vocabulary}`,
          declaration.boundSpan ?? declaration.span,
        ));
      }
    }
  }

  private isDeclaredTypeName(name: string): boolean {
    return builtinTypeNames.has(name)
      || this.primitiveNames.has(name)
      || this.namedTypes.has(name)
      || this.namedTypeIdentities.has(name)
      || this.typeAliases.has(name)
      || this.classes.has(name)
      || this.enums.has(name)
      || this.externTypeImports.has(name);
  }

  private rejectErasedRuntimeCheck(checked: ValueType, errorSpan: Span): boolean {
    if (typeContainsRuntimeTypeCheck(checked)) {
      this.diagnostics.push(diagnostic(
        "VEL4022",
        "Type<T> is a static runtime-Type carrier and cannot itself be checked at runtime; call the concrete Type object's '.is(value)' instead",
        errorSpan,
      ));
      return true;
    }
    let name = "";
    if (!typeContainsParameter(checked, (parameter) => {
      name = parameter.name;
      return true;
    })) return false;
    this.diagnostics.push(diagnostic("VEL4022", `Type parameter '${name}' is erased at runtime and cannot be checked; check against a concrete type instead`, errorSpan));
    return true;
  }

  protected resolveAnnotation(reference: TypeReference | null): ValueType {
    return reference ? this.resolveNamedClasses(this.expandAliases(this.resolveRawTypeReference(reference))) : unknownType;
  }

  protected resolveRawTypeReference(reference: TypeReference): ValueType {
    return resolveTypeReference(reference, (syntax, resolve) => {
      for (const extension of this.analysisExtensions) {
        const resolved = extension.resolveTypeSyntax?.(syntax, resolve);
        if (resolved) return resolved;
      }
      return undefined;
    });
  }

  protected resolveValidatedAnnotation(reference: TypeReference | null): ValueType {
    if (!reference) return unknownType;
    return this.validateTypeReference(reference) ? this.resolveAnnotation(reference) : invalidType;
  }

  protected resolveResult(reference: TypeReference | null): ValueType {
    return reference ? this.resolveAnnotation(reference) : nullType;
  }

  protected resolveValidatedResult(reference: TypeReference | null): ValueType {
    return reference ? this.resolveValidatedAnnotation(reference) : nullType;
  }

  private resolveNamedClasses(type: ValueType): ValueType {
    if (type.kind === "named" && !type.identity) {
      const parameter = this.typeParameterFrames.at(-1)?.get(type.name);
      if (parameter) return parameter;
    }
    if (type.kind === "named" && this.enums.has(type.name)) {
      return { kind: "enum", name: type.name, identity: this.enums.get(type.name)!.identity };
    }
    if (type.kind === "enumMember") {
      const local = this.enums.get(type.name);
      if (local) return { ...type, identity: local.identity };
      const imported = this.lookup(type.name)?.type ?? this.importBindings.get(type.name);
      if (imported?.kind === "enumObject") return { ...type, identity: imported.identity };
    }
    if (type.kind === "named") {
      const imported = this.lookup(type.name)?.type ?? this.importBindings.get(type.name) ?? this.externTypeImports.get(type.name);
      if (imported?.kind === "classConstructor") {
        return {
          kind: "class",
          name: type.name,
          ...(imported.identity ? { identity: imported.identity } : {}),
        };
      }
    }
    if (type.kind === "named" && this.classes.has(type.name)) {
      const info = this.classes.get(type.name);
      return {
        kind: "class",
        name: type.name,
        ...(info?.identity ? { identity: info.identity } : {}),
      };
    }
    if (type.kind === "named" && !type.identity && this.namedTypeIdentities.has(type.name)) {
      return { ...type, identity: this.namedTypeIdentities.get(type.name)! };
    }
    if (type.kind === "optional") {
      return optionalOf(this.resolveNamedClasses(type.inner));
    }
    if (type.kind === "list") {
      return { ...type, element: this.resolveNamedClasses(type.element) };
    }
    if (type.kind === "set") {
      return { ...type, element: this.resolveNamedClasses(type.element) };
    }
    if (type.kind === "map") {
      return { ...type, key: this.resolveNamedClasses(type.key), value: this.resolveNamedClasses(type.value) };
    }
    if (type.kind === "record") {
      return { ...type, value: this.resolveNamedClasses(type.value) };
    }
    if (type.kind === "promise") {
      return { kind: "promise", value: this.resolveNamedClasses(type.value) };
    }
    if (type.kind === "runtimeType") {
      return { kind: "runtimeType", value: this.resolveNamedClasses(type.value) };
    }
    if (type.kind === "typeObject" && type.value) {
      return { ...type, value: this.resolveNamedClasses(type.value) };
    }
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") {
      return {
        ...type,
        parameters: type.parameters.map((parameter) => this.resolveNamedClasses(parameter)),
        ...(type.rest ? { rest: this.resolveNamedClasses(type.rest) } : {}),
        result: this.resolveNamedClasses(type.result),
      };
    }
    if (type.kind === "extension") {
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, this.resolveNamedClasses(value)])),
        arguments: type.arguments.map((argument) => this.resolveNamedClasses(argument)),
      };
    }
    if (type.kind === "union") {
      return { kind: "union", members: type.members.map((member) => this.resolveNamedClasses(member)) };
    }
    return type;
  }

  protected validateTypeReference(
    reference: TypeReference,
    resolve?: (reference: TypeReference) => ValueType,
  ): boolean {
    if (!resolve) {
      const cached = this.typeReferenceValidity.get(reference);
      if (cached !== undefined) return cached;
    }
    const resolver = resolve ?? ((value: TypeReference) => this.resolveAnnotation(value));
    const validate = (syntax: TypeSyntax): boolean => {
      const extensionResult = this.validateExtensionTypeSyntax(syntax, validate, resolver);
      if (extensionResult !== undefined) return extensionResult;
      switch (syntax.kind) {
        case "NamedTypeSyntax": {
          if (syntax.name === "any") {
            this.typeError("'any' is reserved for explicit unsafe JavaScript boundaries; use 'unknown' in VelarScript", syntax.span);
            return false;
          }
          if (this.invalidDeclaredTypes.has(syntax.name)) return false;
          if (syntax.name === "Promise" || syntax.name === "Function") return true;
          if (this.typeParameterFrames.at(-1)?.has(syntax.name)) return true;
          if (this.primitiveNames.has(syntax.name)
            || this.namedTypes.has(syntax.name)
            || this.namedTypeIdentities.has(syntax.name)
            || this.typeAliases.has(syntax.name)
            || this.classes.has(syntax.name)
            || this.enums.has(syntax.name)
            || this.externTypeImports.has(syntax.name)) return true;
          const resolved = resolver({ syntax, span: syntax.span });
          if (resolved.kind !== "named"
            || (resolved.identity && this.namedTypes.has(resolved.identity))) return true;
          if (this.enclosingTypeParameterName(syntax.name)) {
            this.diagnostics.push(diagnostic("VEL4021", `Type parameter '${syntax.name}' belongs to the enclosing function; declare '<${syntax.name}>' on this def`, syntax.span));
            return false;
          }
          const externSources = this.externClassDeclarations.get(syntax.name);
          if (externSources && externSources.size > 1) {
            const sources = [...externSources].map((source) => `"${source}"`).join(", ");
            this.typeError(`Extern class '${syntax.name}' is declared by more than one extern module (${sources}); import the intended class with 'import js' to name it here`, syntax.span);
            return false;
          }
          this.typeError(`Unknown type '${syntax.name}'`, syntax.span);
          return false;
        }
        case "EnumMemberTypeSyntax": {
          const info = this.enums.get(syntax.enumName);
          const imported = this.lookup(syntax.enumName)?.type ?? this.importBindings.get(syntax.enumName);
          const members = info?.members ?? (imported?.kind === "enumObject" ? imported.members : null);
          if (!members) {
            // ENM-I9 first half: a namespace import in a type position is the
            // common way here; the old "'m' is not an enum" text answered a
            // question nobody asked.
            const namespaceSource = this.namespaceImportLocals.get(syntax.enumName);
            if (namespaceSource !== undefined) {
              this.typeError(
                `Namespace members cannot be written in type positions; import '${syntax.member}' by name — import {${syntax.member}} from ${JSON.stringify(namespaceSource)} — or bind an enum object first with const ${syntax.member} = ${syntax.enumName}.${syntax.member}`,
                syntax.enumNameSpan,
              );
              return false;
            }
            this.typeError(`'${syntax.enumName}' is not an enum and cannot qualify a singleton type`, syntax.enumNameSpan);
            return false;
          }
          if (!members.has(syntax.member)) {
            this.typeError(`Enum '${syntax.enumName}' has no member '${syntax.member}'`, syntax.memberSpan);
            return false;
          }
          return true;
        }
        case "GenericTypeSyntax": {
          let valid = true;
          if (syntax.name !== "List" && syntax.name !== "Set" && syntax.name !== "Map" && syntax.name !== "Record" && syntax.name !== "Promise" && syntax.name !== "Function" && syntax.name !== "Type") {
            const resolved = resolver({ syntax, span: syntax.span });
            if (resolved.kind === "named") {
              this.typeError(`Unknown type '${syntax.name}'`, syntax.nameSpan);
              valid = false;
            }
          }
          const argumentsValid = syntax.arguments.map(validate).every(Boolean);
          if (syntax.name === "Function" && syntax.arguments.length === 0) {
            this.typeError("Write bare 'Function' for () -> null, or provide at least one type argument whose final type is the result", syntax.span);
            valid = false;
          }
          if (valid && argumentsValid && syntax.name === "Promise") {
            this.reportPromiseCarrierHazard(resolver({ syntax, span: syntax.span }), syntax.span);
          }
          if (valid && argumentsValid && (syntax.name === "Set" || syntax.name === "Map") && syntax.arguments.length > 0) {
            const keySyntax = syntax.arguments[0]!;
            this.rejectCollidingKeyDomain(
              resolver({ syntax: keySyntax, span: keySyntax.span }),
              keySyntax.span,
              syntax.name === "Set" ? "Set element type" : "Map key type",
            );
          }
          return valid && argumentsValid;
        }
        case "ReadonlyTypeSyntax": {
          const innerValid = validate(syntax.inner);
          if (!innerValid) return false;
          if (syntax.inner.kind === "ReadonlyTypeSyntax") {
            this.typeError("A readonly view is already read-only; remove the duplicate 'readonly'", syntax.span);
            return false;
          }
          const resolved = resolver({ syntax, span: syntax.span });
          const supported = (type: ValueType): boolean => {
            if (type.kind === "null") return true;
            if (type.kind === "optional") return supported(type.inner);
            if (type.kind === "union") return type.members.every(supported);
            if (type.kind === "named") {
              return !this.isPrimitiveType(type.name)
                && this.fieldsOf(type.identity ?? type.name) !== null
                && isReadonlyView(type);
            }
            return (type.kind === "list" || type.kind === "set" || type.kind === "map" || type.kind === "record"
              || type.kind === "object") && isReadonlyView(type);
          };
          const containsData = (type: ValueType): boolean => type.kind === "optional" ? containsData(type.inner)
            : type.kind === "union" ? type.members.some(containsData)
              : isReadonlyView(type);
          if (supported(resolved) && containsData(resolved)) {
            // D44 rule 72: the surface check above admits only data shapes;
            // this closes the same boundary at every reachable depth.
            const violation = this.findClassInReadonlyData(resolved);
            if (violation) {
              this.typeError(
                `'readonly' accepts only pure data at every depth; '${describeType(mutableViewOf(resolved))}${violation.suffix}' is class '${violation.className}' — model it as a data record, or drop 'readonly'`,
                syntax.span,
              );
              return false;
            }
            return true;
          }
          this.typeError(`'readonly' applies only to data records, structural objects, List, Set, Map, and Record values; ${describeType(resolved)} is outside that boundary`, syntax.span);
          return false;
        }
        case "OptionalTypeSyntax":
          return validate(syntax.inner);
        case "UnionTypeSyntax":
          return syntax.members.map(validate).every(Boolean);
        case "FunctionTypeSyntax": {
          const parametersValid = syntax.parameters.map((parameter) => validate(parameter.type)).every(Boolean);
          const resultValid = validate(syntax.result);
          return parametersValid && resultValid;
        }
      }
    };
    const valid = validate(reference.syntax);
    if (!resolve) this.typeReferenceValidity.set(reference, valid);
    return valid;
  }

  protected typeError(message: string, errorSpan: Span): void {
    this.diagnostics.push(diagnostic("VEL4001", message, errorSpan));
  }

  private analyzeMatchPattern(
    pattern: MatchPattern,
    input: ValueType,
    bindings: Map<string, { readonly type: ValueType; readonly span: Span }>,
  ): ValueType {
    switch (pattern.kind) {
      case "MatchAsPattern": {
        const narrowed = this.analyzeMatchPattern(pattern.pattern, input, bindings);
        this.addMatchBinding(bindings, pattern.binding.name, narrowed, pattern.binding.span);
        return narrowed;
      }
      case "MatchWildcardPattern":
        return input;
      case "MatchCapturePattern":
        this.addMatchBinding(bindings, pattern.binding.name, input, pattern.binding.span);
        return input;
      case "MatchValuePattern": {
        const values: ValueType[] = [];
        for (const value of pattern.values) {
          const literal = this.inferExpression(value);
          values.push(literal);
          if (input.kind !== "unknown" && !this.matchLiteralCompatible(this.expandAliases(input), literal)) {
            this.typeError(`Cannot match ${describeType(input)} against ${describeType(literal)}`, value.span);
          }
          // ENM-D2: when the subject and this candidate can both be NaN, the
          // branch test lowers to SameValueZero so it agrees with `==`
          // (charter section 8). A literal candidate can never be NaN, so
          // ordinary matches keep plain `===`.
          if (this.equalityMayCompareNaN(input) && this.equalityOperandMayBeNaN(value, literal)) {
            this.sameValueZeroMatchValues.add(spanIdentity(value.span));
          }
        }
        return values.length > 0 ? unionOf(values) : unknownType;
      }
      case "MatchTypePattern": {
        // ENM-U2's other half: a bare identifier is never a value pattern —
        // dotted paths are values, bare names are types — so a name that
        // resolves to an ordinary binding gets the real teaching instead of
        // "Unknown type".
        const syntax = pattern.type.syntax;
        if (syntax.kind === "NamedTypeSyntax") {
          const binding = this.lookup(syntax.name);
          const bindingKind = binding?.type.kind;
          if (binding && bindingKind !== "typeObject" && bindingKind !== "enumObject"
            && bindingKind !== "classConstructor" && bindingKind !== "runtimeType"
            && !this.typeAliases.has(syntax.name) && !this.namedTypes.has(syntax.name)
            && !this.enums.has(syntax.name) && !this.classes.has(syntax.name)
            && !this.primitiveNames.has(syntax.name)) {
            this.typeError(
              `'${syntax.name}' is a binding, and bindings cannot be matched directly; match a dotted path (case owner.${syntax.name}:) or use a guard (case _ if value == ${syntax.name}:)`,
              pattern.span,
            );
            return invalidType;
          }
        }
        const checked = this.resolveAnnotation(pattern.type);
        const valid = this.validateTypeReference(pattern.type);
        if (valid && this.rejectErasedRuntimeCheck(checked, pattern.type.span)) return invalidType;
        if (valid && input.kind !== "unknown" && !this.matchTypesOverlap(this.expandAliases(input), checked)) {
          this.typeError(`Type pattern ${describeType(checked)} can never match ${describeType(input)}`, pattern.span);
        }
        return valid ? this.narrowMatchType(input, checked) : invalidType;
      }
      case "MatchListPattern": {
        const candidates = this.matchListCandidates(input);
        if (candidates.length === 0) {
          this.typeError(`A List pattern can never match ${describeType(input)}`, pattern.span);
        }
        const elementTypes = candidates.map((candidate) => candidate.kind === "list"
          ? candidate.readonlyView ? this.readonlyDataViewOf(candidate.element) : candidate.element
          : anyType);
        const element = elementTypes.length > 0 ? unionOf(elementTypes) : unknownType;
        for (const child of pattern.elements) this.analyzeMatchPattern(child, element, bindings);
        if (pattern.rest) {
          this.addMatchBinding(bindings, pattern.rest.name, { kind: "list", element }, pattern.rest.span);
        }
        return candidates.length > 0 ? unionOf(candidates) : unknownType;
      }
      case "MatchObjectPattern": {
        const candidates = this.matchObjectCandidates(input);
        if (candidates.length === 0) {
          this.typeError(`An object pattern can never match ${describeType(input)}`, pattern.span);
        }
        const seen = new Set<string>();
        const eligible = candidates.filter((candidate) => candidate.kind === "any"
          || pattern.entries.every((entry) => {
            const field = this.matchObjectField(candidate, entry.property);
            return field !== null && this.matchPatternMayMatchType(entry.pattern, field);
          }));
        if (candidates.length > 0 && eligible.length === 0) {
          this.typeError(`Object pattern fields cannot occur together on ${describeType(input)}`, pattern.span);
        }
        for (const entry of pattern.entries) {
          if (seen.has(entry.property)) {
            this.diagnostics.push(diagnostic("VEL4019", `Object pattern field '${entry.property}' is declared more than once`, entry.span));
          }
          seen.add(entry.property);
          const fieldCandidates = eligible
            .map((candidate) => this.matchObjectField(candidate, entry.property))
            .filter((field): field is ValueType => field !== null);
          if (fieldCandidates.length === 0 && candidates.length > 0
            && !candidates.some((candidate) => this.matchObjectField(candidate, entry.property) !== null)) {
            this.typeError(`Object pattern field '${entry.property}' does not exist on ${describeType(input)}`, entry.span);
          }
          const owners = eligible.filter((candidate): candidate is Extract<ValueType, { kind: "named" }> => candidate.kind === "named"
            && this.matchObjectField(candidate, entry.property) !== null);
          if (owners.length === 1) {
            this.semanticBindingEntryOwners.set(`${entry.span.start}:${entry.property}`, owners[0]!);
          }
          this.analyzeMatchPattern(
            entry.pattern,
            fieldCandidates.length > 0 ? unionOf(fieldCandidates) : unknownType,
            bindings,
          );
        }
        if (pattern.rest) {
          this.addMatchBinding(bindings, pattern.rest.name, this.matchObjectRestType(eligible, seen), pattern.rest.span);
        }
        return eligible.length > 0 ? unionOf(eligible) : unknownType;
      }
    }
  }

  private matchLocationNarrowing(expression: Expression, type: ValueType): ReadonlyMap<string, ValueType> {
    const narrowed = new Map<string, ValueType>();
    this.addLocationNarrowing(narrowed, expression, type);
    return narrowed;
  }

  private retargetNarrowings(source: ReadonlyMap<string, ValueType>, type: ValueType): ReadonlyMap<string, ValueType> {
    return new Map([...source.keys()].map((key) => [key, type]));
  }

  private matchFallthroughType(input: ValueType, pattern: MatchPattern): ValueType {
    const source = this.expandAliases(input);
    const members = source.kind === "union" ? source.members
      : source.kind === "optional" ? [source.inner, nullType]
        : null;
    if (!members) return input;
    const remaining = members.filter((member) => !this.matchPatternCoversWholeType(pattern, member));
    return remaining.length > 0 && remaining.length < members.length ? unionOf(remaining) : input;
  }

  private matchPatternCoversWholeType(pattern: MatchPattern, input: ValueType): boolean {
    if (pattern.kind === "MatchAsPattern") return this.matchPatternCoversWholeType(pattern.pattern, input);
    if (pattern.kind === "MatchWildcardPattern" || pattern.kind === "MatchCapturePattern") return true;
    if (pattern.kind === "MatchTypePattern") {
      const checked = this.resolveAnnotation(pattern.type);
      return !this.runtimeTypeCheckMayExecute(input, checked) && isAssignable(input, checked, this);
    }
    if (pattern.kind === "MatchValuePattern") {
      if (input.kind === "null") {
        return pattern.values.some((value) => value.kind === "LiteralExpression" && value.value === null);
      }
      if (input.kind === "enumMember") {
        return pattern.values.some((value) => {
          const candidate = this.inferredExpressionTypes.get(spanIdentity(value.span));
          return candidate?.kind === "enumMember"
            && candidate.identity === input.identity
            && candidate.member === input.member;
        });
      }
      if (input.kind === "bool") {
        const values = new Set<boolean>();
        for (const value of pattern.values) {
          if (value.kind === "LiteralExpression" && typeof value.value === "boolean") values.add(value.value);
        }
        return values.has(true) && values.has(false);
      }
      return false;
    }
    return this.matchPatternCoversType(pattern, input);
  }

  private unwrapMatchAs(pattern: MatchPattern): MatchPattern {
    return pattern.kind === "MatchAsPattern" ? this.unwrapMatchAs(pattern.pattern) : pattern;
  }

  private matchPatternIsIrrefutable(pattern: MatchPattern): boolean {
    if (pattern.kind === "MatchWildcardPattern" || pattern.kind === "MatchCapturePattern") return true;
    return pattern.kind === "MatchAsPattern" && this.matchPatternIsIrrefutable(pattern.pattern);
  }

  private matchPatternCoversType(pattern: MatchPattern, input: ValueType): boolean {
    if (pattern.kind === "MatchWildcardPattern" || pattern.kind === "MatchCapturePattern") return true;
    if (pattern.kind === "MatchAsPattern") return this.matchPatternCoversType(pattern.pattern, input);
    if (this.matchPatternReflectionMayExecute(pattern, input)) return false;
    const type = this.expandAliases(input);
    if (type.kind === "union") return type.members.every((member) => this.matchPatternCoversType(pattern, member));
    if (pattern.kind === "MatchValuePattern") return this.matchPatternCoversWholeType(pattern, type);
    if (pattern.kind === "MatchTypePattern") {
      const checked = this.resolveAnnotation(pattern.type);
      return !this.runtimeTypeCheckMayExecute(type, checked) && isAssignable(type, checked, this);
    }
    if (pattern.kind === "MatchListPattern") {
      return type.kind === "list" && pattern.rest !== null && pattern.elements.length === 0;
    }
    if (pattern.kind !== "MatchObjectPattern") return false;
    const fields = type.kind === "object"
      ? type.fields
      : type.kind === "named" ? this.fieldsOf(type.identity ?? type.name) : null;
    if (!fields) return false;
    return pattern.entries.every((entry) => {
      if (type.kind === "object" && type.optionalFields?.has(entry.property)) return false;
      const field = fields.get(entry.property);
      return Boolean(field && field.kind !== "optional" && this.matchPatternCoversType(entry.pattern, field));
    });
  }

  private addMatchBinding(
    bindings: Map<string, { readonly type: ValueType; readonly span: Span }>,
    name: string,
    type: ValueType,
    bindingSpan: Span,
  ): void {
    if (name === "_") return;
    if (bindings.has(name)) {
      this.diagnostics.push(diagnostic("VEL4019", `Match binding '${name}' is declared more than once`, bindingSpan));
      return;
    }
    bindings.set(name, { type, span: bindingSpan });
  }

  private matchListCandidates(input: ValueType): ValueType[] {
    const type = this.expandAliases(input);
    if (type.kind === "union") return type.members.flatMap((member) => this.matchListCandidates(member));
    if (type.kind === "optional") return this.matchListCandidates(type.inner);
    return type.kind === "list" || type.kind === "any" ? [type] : [];
  }

  private matchObjectCandidates(input: ValueType): ValueType[] {
    const type = this.expandAliases(input);
    if (type.kind === "union") return type.members.flatMap((member) => this.matchObjectCandidates(member));
    if (type.kind === "optional") return this.matchObjectCandidates(type.inner);
    if (type.kind === "object" || type.kind === "any") return [type];
    return type.kind === "named" && this.fieldsOf(type.identity ?? type.name) ? [type] : [];
  }

  private matchObjectField(candidate: ValueType, property: string): ValueType | null {
    if (candidate.kind === "any") return anyType;
    const fields = candidate.kind === "object"
      ? candidate.fields
      : candidate.kind === "named" ? this.fieldsOf(candidate.identity ?? candidate.name) : null;
    const field = fields?.get(property) ?? null;
    const readonly = isReadonlyView(candidate)
      || candidate.kind === "object" && candidate.readonlyFields?.has(property) === true
      || candidate.kind === "named" && this.readonlyFieldsOf(candidate.identity ?? candidate.name)?.has(property) === true;
    return field && readonly ? this.readonlyDataViewOf(field) : field;
  }

  private matchPatternMayMatchType(pattern: MatchPattern, input: ValueType): boolean {
    if (pattern.kind === "MatchAsPattern") return this.matchPatternMayMatchType(pattern.pattern, input);
    if (pattern.kind !== "MatchValuePattern") return true;
    return pattern.values.some((value) => this.matchLiteralCompatible(
      this.expandAliases(input),
      this.inferredOrAnalyze(value),
    ));
  }

  private matchObjectRestType(candidates: readonly ValueType[], selected: ReadonlySet<string>): ValueType {
    if (candidates.some((candidate) => candidate.kind === "any")) return anyType;
    const rests = candidates.map((candidate): ValueType => {
      const fields = candidate.kind === "object"
        ? candidate.fields
        : candidate.kind === "named" ? this.fieldsOf(candidate.identity ?? candidate.name) : null;
      const remaining = new Map([...(fields ?? [])].filter(([name]) => !selected.has(name)));
      for (const [name, field] of remaining) {
        const readonly = isReadonlyView(candidate)
          || candidate.kind === "object" && candidate.readonlyFields?.has(name) === true
          || candidate.kind === "named" && this.readonlyFieldsOf(candidate.identity ?? candidate.name)?.has(name) === true;
        if (readonly) remaining.set(name, this.readonlyDataViewOf(field));
      }
      const optionalFields = candidate.kind === "object"
        ? new Set([...(candidate.optionalFields ?? [])].filter((name) => !selected.has(name)))
        : new Set<string>();
      return {
        kind: "object",
        fields: remaining,
        ...(optionalFields.size > 0 ? { optionalFields } : {}),
      };
    });
    return rests.length > 0 ? unionOf(rests) : { kind: "object", fields: new Map() };
  }

  private narrowMatchType(input: ValueType, checked: ValueType): ValueType {
    const source = this.expandAliases(input);
    if (source.kind === "any" || source.kind === "unknown") return checked;
    if (source.kind === "union") {
      const members = source.members
        .filter((member) => this.matchTypesOverlap(member, checked))
        .map((member) => this.narrowMatchType(member, checked));
      return members.length > 0 ? unionOf(members) : checked;
    }
    if (source.kind === "optional") {
      const members = [source.inner, nullType]
        .filter((member) => this.matchTypesOverlap(member, checked))
        .map((member) => this.narrowMatchType(member, checked));
      return members.length > 0 ? unionOf(members) : checked;
    }
    if (isAssignable(source, checked, this)
      || (isReadonlyView(source) && isAssignable(mutableViewOf(source), mutableViewOf(checked), this))) return source;
    return this.runtimeCheckedType(source, checked);
  }

  private matchLiteralCompatible(matched: ValueType, literal: ValueType): boolean {
    if (matched.kind === "any") return true;
    if (matched.kind === "union") return matched.members.some((member) => this.matchLiteralCompatible(member, literal));
    if (matched.kind === "optional") {
      return literal.kind === "null" || this.matchLiteralCompatible(matched.inner, literal);
    }
    if (matched.kind === "enum") return (literal.kind === "enum" || literal.kind === "enumMember") && matched.identity === literal.identity;
    if (matched.kind === "enumMember") {
      return literal.kind === "enumMember" && matched.identity === literal.identity && matched.member === literal.member;
    }
    return matched.kind === literal.kind
      && (matched.kind === "string" || matched.kind === "number" || matched.kind === "bool" || matched.kind === "null");
  }

  private matchValueKey(value: MatchValue): string {
    return value.kind === "LiteralExpression"
      ? value.value === null ? "null" : `${typeof value.value}:${String(value.value)}`
      : `path:${this.matchValueDisplay(value)}`;
  }

  // ENM-U6: diagnostics render the value the way the author spelled it —
  // never the internal typed key ("number:5") — including full dotted paths.
  private matchValueDisplay(value: MatchValue): string {
    if (value.kind === "LiteralExpression") return String(value.value);
    const path = (expression: Expression): string => expression.kind === "IdentifierExpression"
      ? expression.name
      : expression.kind === "MemberExpression"
        ? `${path(expression.object)}.${expression.property}`
        : "?";
    return path(value);
  }

  private matchTypesOverlap(left: ValueType, right: ValueType): boolean {
    if (left.kind === "any" || right.kind === "any" || right.kind === "unknown") return true;
    if (left.kind === "unknown") return false;
    if (left.kind === "union") return left.members.some((member) => this.matchTypesOverlap(member, right));
    if (right.kind === "union") return right.members.some((member) => this.matchTypesOverlap(left, member));
    if (left.kind === "optional") return this.matchTypesOverlap(left.inner, right) || this.matchTypesOverlap(nullType, right);
    if (right.kind === "optional") return this.matchTypesOverlap(left, right.inner) || this.matchTypesOverlap(left, nullType);
    return isAssignable(left, right, this) || isAssignable(right, left, this);
  }

  private runtimeTypeCheckMayExecute(input: ValueType, checkedInput: ValueType): boolean {
    const checked = this.expandAliases(checkedInput);
    if (checked.kind === "optional") return this.runtimeTypeCheckMayExecute(input, checked.inner);
    if (checked.kind === "union") return checked.members.some((member) => this.runtimeTypeCheckMayExecute(input, member));
    if (checked.kind === "class" && (checked.identity ?? checked.name).startsWith("js:")) return true;
    const aggregateCheck = checked.kind === "named" || checked.kind === "object" || checked.kind === "list"
      || checked.kind === "set" || checked.kind === "map" || checked.kind === "record";
    if (!aggregateCheck) return false;
    const source = this.expandAliases(input);
    return source.kind === "unknown" || source.kind === "any";
  }

  private matchTypeFullyCovered(
    target: ValueType,
    coveredTypes: readonly ValueType[],
    coveredValues: ReadonlySet<string>,
    coveredEnumMembers: ReadonlySet<string>,
    coveredListLengths: ReadonlySet<number>,
    coveredListMinimum: number | null,
  ): boolean {
    if (coveredTypes.some((covered) => isAssignable(target, covered, this))) return true;
    if (target.kind === "union") {
      return target.members.every((member) => this.matchTypeFullyCovered(
        member,
        coveredTypes,
        coveredValues,
        coveredEnumMembers,
        coveredListLengths,
        coveredListMinimum,
      ));
    }
    if (target.kind === "optional") {
      return this.matchTypeFullyCovered(target.inner, coveredTypes, coveredValues, coveredEnumMembers, coveredListLengths, coveredListMinimum)
        && this.matchTypeFullyCovered(nullType, coveredTypes, coveredValues, coveredEnumMembers, coveredListLengths, coveredListMinimum);
    }
    if (target.kind === "enum") {
      const members = this.enums.get(target.identity)?.members ?? this.enums.get(target.name)?.members ?? new Set<string>();
      return [...members].every((member) => coveredEnumMembers.has(this.enumMemberCoverageKey(target.identity, member)));
    }
    if (target.kind === "enumMember") {
      return coveredEnumMembers.has(this.enumMemberCoverageKey(target.identity, target.member));
    }
    if (target.kind === "bool") return coveredValues.has("boolean:true") && coveredValues.has("boolean:false");
    if (target.kind === "null") return coveredValues.has("null");
    if (target.kind === "list" && coveredListMinimum !== null) {
      for (let length = 0; length < coveredListMinimum; length += 1) {
        if (!coveredListLengths.has(length)) return false;
      }
      return true;
    }
    return false;
  }

  private enumMemberCoverageKey(identity: string, member: string): string {
    return `${identity}\u0000${member}`;
  }

  /** ENM-I5: enum members reached through a type pattern (parenthesized singletons, unions of them) credit member coverage. */
  private creditEnumMemberCoverage(checked: ValueType, covered: Set<string>): void {
    const type = this.expandAliases(checked);
    if (type.kind === "enumMember") {
      covered.add(this.enumMemberCoverageKey(type.identity, type.member));
    } else if (type.kind === "enum") {
      for (const member of this.enums.get(type.identity)?.members ?? this.enums.get(type.name)?.members ?? []) {
        covered.add(this.enumMemberCoverageKey(type.identity, member));
      }
    } else if (type.kind === "optional") {
      this.creditEnumMemberCoverage(type.inner, covered);
    } else if (type.kind === "union") {
      for (const member of type.members) this.creditEnumMemberCoverage(member, covered);
    }
  }

  /** ENM-I6: the enum behind a match subject - bare or optional - that carries the exhaustiveness contract. */
  private enumMatchSubject(matched: ValueType): { readonly target: Extract<ValueType, { kind: "enum" }>; readonly optional: boolean } | null {
    const expanded = this.expandAliases(matched);
    if (expanded.kind === "enum") return { target: expanded, optional: false };
    if (expanded.kind === "optional") {
      const inner = this.expandAliases(expanded.inner);
      if (inner.kind === "enum") return { target: inner, optional: true };
    }
    return null;
  }

  /** The class arms of a match subject: the type itself, or the class members of its optional/union spellings. */
  private classArmsOf(expanded: ValueType): Extract<ValueType, { kind: "class" }>[] {
    if (expanded.kind === "class") return [expanded];
    if (expanded.kind === "optional") return this.classArmsOf(this.expandAliases(expanded.inner));
    if (expanded.kind === "union") return expanded.members.flatMap((member) => this.classArmsOf(this.expandAliases(member)));
    return [];
  }

  private blockAlwaysReturns(statements: readonly Statement[]): boolean {
    for (const statement of statements) {
      if (statement.kind === "ReturnStatement" || statement.kind === "ThrowStatement") return true;
      if (statement.kind === "WhileStatement" && this.nonFallthroughWhileStatements.has(statement.span.start)) return true;
      if (statement.kind === "IfStatement" && statement.elseBody
        && this.blockAlwaysReturns(statement.thenBody) && this.blockAlwaysReturns(statement.elseBody)) return true;
      if (statement.kind === "MatchStatement" && this.exhaustiveMatches.has(statement.span.start)
        && statement.cases.every((branch) => this.blockAlwaysReturns(branch.body))) return true;
      if (statement.kind === "TryStatement") {
        if (statement.finallyBody && this.blockAlwaysReturns(statement.finallyBody)) return true;
        if (this.blockAlwaysReturns(statement.tryBody)
          && (!statement.catchBody || this.blockAlwaysReturns(statement.catchBody))) return true;
      }
    }
    return false;
  }

  private statementAlwaysExitsBlock(statement: Statement): boolean {
    if (statement.kind === "ReturnStatement" || statement.kind === "ThrowStatement"
      || statement.kind === "BreakStatement" || statement.kind === "ContinueStatement") return true;
    if (statement.kind === "WhileStatement" && this.nonFallthroughWhileStatements.has(statement.span.start)) return true;
    if (statement.kind === "IfStatement" && statement.elseBody) {
      return this.blockAlwaysExits(statement.thenBody) && this.blockAlwaysExits(statement.elseBody);
    }
    if (statement.kind === "MatchStatement" && this.exhaustiveMatches.has(statement.span.start)) {
      return statement.cases.every((branch) => this.blockAlwaysExits(branch.body));
    }
    if (statement.kind !== "TryStatement") return false;
    if (statement.finallyBody && this.blockAlwaysExits(statement.finallyBody)) return true;
    return this.blockAlwaysExits(statement.tryBody)
      && (!statement.catchBody || this.blockAlwaysExits(statement.catchBody));
  }

  private blockAlwaysExits(statements: readonly Statement[]): boolean {
    return statements.some((statement) => this.statementAlwaysExitsBlock(statement));
  }

  private builtin(name: string): Binding | null {
    const functions = new Map<string, ValueType>([
      ["number", { kind: "function", parameterNames: ["text"], parameters: [stringType], requiredParameters: 1, result: optionalOf(numberType) }],
      // D32 item 29: `str` is compiler-owned text conversion, so its parameter
      // carries the conversion domain rather than `any`. A bare `str` stays a
      // legal first-class value, and every indirect call site — `const c = str`,
      // `values.map(str)` — is checked against the same whitelist the direct
      // call form uses instead of executing a 'toString' hook.
      ["str", { kind: "function", parameterNames: ["value"], parameters: [textConvertibleType], requiredParameters: 1, result: stringType }],
      // `print` inspects any value by contract and keeps the `any` domain.
      ["print", { kind: "function", parameterNames: ["value"], parameters: [anyType], requiredParameters: 1, result: nullType }],
      // D47 rule 81: equals(a, b) — deep structural comparison over data.
      // Pure computation, so it lives in the prelude beside str/print; the
      // call site owns the domain checks (inferEqualsCall).
      ["equals", { kind: "intrinsic", name: "core.equals", parameterNames: ["a", "b"], parameters: [unknownType, unknownType], requiredParameters: 2, result: boolType }],
      ["range", { kind: "intrinsic", name: "collections.range", parameterNames: ["start", "end", "step"], parameters: [numberType, numberType, numberType], requiredParameters: 1, result: { kind: "list", element: numberType } }],
      ["Json", jsonNamespaceType],
      ["Promise", promiseNamespaceType],
    ]);
    const type = this.extensionGlobals.get(name) ?? functions.get(name)
      ?? (name === "Error" || name === "ValidationError" || name === "NarrowingError" || name === "IndexError"
        ? { kind: "classConstructor", name } satisfies ValueType
        : null)
      ?? (name === "Map" || name === "Set" ? anyType : null);
    return type ? {
      mutable: false,
      type,
      declaredType: type,
      storageType: type,
      span: { start: 0, end: 0 },
      narrowingFrame: null,
    } : null;
  }

  private isFreshUnresolvedCollection(expression: Expression, type: ValueType): boolean {
    const unresolved = type.kind === "list" ? type.element.kind === "unknown"
      : type.kind === "set" ? type.element.kind === "unknown"
        : type.kind === "map" ? type.key.kind === "unknown" && type.value.kind === "unknown"
          : false;
    if (!unresolved) return false;
    if (expression.kind === "ListExpression") return true;
    return expression.kind === "CallExpression"
      && expression.callee.kind === "IdentifierExpression"
      && (expression.callee.name === "Map" || expression.callee.name === "Set");
  }

  private joinCollectionInference(name: string, binding: Binding, group: CollectionInferenceGroup): void {
    group.bindings.set(binding, name);
    this.collectionInferenceGroups.set(binding, group);
  }

  private createCollectionInference(type: ValueType): CollectionInferenceGroup {
    const group = { type, bindings: new Map<Binding, string>(), open: true };
    this.collectionInferenceTypes.set(type, group);
    return group;
  }

  private refineCollectionInference(current: ValueType, next: ValueType): boolean {
    const group = this.collectionInferenceTypes.get(current);
    if (!group?.open) return false;
    if (group.type.kind === "list" && next.kind === "list") {
      (group.type as { kind: "list"; element: ValueType }).element = next.element;
    } else if (group.type.kind === "set" && next.kind === "set") {
      (group.type as { kind: "set"; element: ValueType }).element = next.element;
    } else if (group.type.kind === "map" && next.kind === "map") {
      (group.type as { kind: "map"; key: ValueType; value: ValueType }).key = next.key;
      (group.type as { kind: "map"; key: ValueType; value: ValueType }).value = next.value;
    } else return false;
    for (const [member, name] of group.bindings) {
      this.recordSemanticBinding(`${member.span.start}:${name}`, group.type);
    }
    return true;
  }

  private rebindCollectionInference(name: string, binding: Binding, value: Expression, valueType: ValueType): void {
    const previous = this.collectionInferenceGroups.get(binding);
    if (!previous) return;
    const aliasedBinding = value.kind === "IdentifierExpression" ? this.lookup(value.name) : null;
    const aliasedGroup = aliasedBinding ? this.collectionInferenceGroups.get(aliasedBinding) : null;
    if (previous === aliasedGroup && aliasedGroup) return;
    previous?.bindings.delete(binding);
    this.collectionInferenceGroups.delete(binding);
    if (aliasedGroup) {
      binding.type = aliasedGroup.type;
      binding.declaredType = aliasedGroup.type;
      binding.storageType = aliasedGroup.type;
      this.joinCollectionInference(name, binding, aliasedGroup);
    }
    else if (this.isFreshUnresolvedCollection(value, valueType)) {
      binding.type = valueType;
      binding.declaredType = valueType;
      binding.storageType = valueType;
      this.joinCollectionInference(name, binding, this.createCollectionInference(valueType));
    } else {
      binding.type = valueType;
      binding.declaredType = valueType;
      binding.storageType = valueType;
    }
    this.recordSemanticBinding(`${binding.span.start}:${name}`, binding.type);
  }

  protected declareBinding(
    name: string,
    mutable: boolean,
    type: ValueType,
    declarationSpan: Span,
    internal = false,
    declaredType = type,
    importSource?: string,
  ): void {
    this.pendingScopeDeclarations.at(-1)?.delete(name);
    if (!internal) {
      const restriction = bindingNameRestriction(name, undefined, this.extensionReservedBindings);
      if (restriction && restriction !== "invalid" && restriction !== "keyword" && restriction !== "source") {
        const message = restriction === "javascript"
          ? name === "arguments"
            ? "Use named parameters; VelarScript does not expose the JavaScript 'arguments' binding"
            : `'${name}' is reserved by JavaScript and cannot be used as a VelarScript binding`
          : restriction === "compiler"
            ? `'${name}' uses a reserved compiler prefix ('$velar' or '__velar')`
            : restriction === "core"
              ? `'${name}' is a reserved Core binding`
              : restriction === "extension"
                ? `'${name}' is a reserved extension binding`
                : `'${name}' is not available as a VelarScript binding`;
        this.diagnostics.push(diagnostic("VEL3007", message, declarationSpan));
        return;
      }
    }
    const scope = this.scopes.at(-1)!;
    if (scope.has(name)) {
      // MOD-I4: an import/local collision blames the declaration that comes
      // later in the source and names the earlier one's origin. Imports are
      // predeclared before locals analyze, so the earlier-vs-later question
      // is answered from the spans, not from the call order.
      const existing = scope.get(name)!;
      const existingImport = this.importedBindingOrigins.get(existing);
      if (existingImport !== undefined && existing.span.start > declarationSpan.start) {
        this.diagnostics.push(diagnostic(
          "VEL3004",
          `Import '${name}' collides with the earlier declaration in this module; alias it — import {${name} as other} from ${JSON.stringify(existingImport)}`,
          existing.span,
        ));
      } else if (existingImport !== undefined) {
        this.diagnostics.push(diagnostic(
          "VEL3004",
          importSource !== undefined
            ? `Name '${name}' is already imported from ${JSON.stringify(existingImport)}; alias one of the imports — import {${name} as other}`
            : `Name '${name}' is already imported from ${JSON.stringify(existingImport)}; rename this declaration, or alias the import — import {${name} as other}`,
          declarationSpan,
        ));
      } else if (importSource !== undefined && existing.span.start < declarationSpan.start) {
        this.diagnostics.push(diagnostic(
          "VEL3004",
          `Import '${name}' collides with the earlier declaration in this module; alias it — import {${name} as other} from ${JSON.stringify(importSource)}`,
          declarationSpan,
        ));
      } else {
        this.diagnostics.push(diagnostic("VEL3004", `Name '${name}' is already declared in this scope`, declarationSpan));
      }
      return;
    }
    const binding: Binding = {
      mutable,
      type,
      declaredType,
      storageType: type,
      span: declarationSpan,
      narrowingFrame: null,
    };
    scope.set(name, binding);
    if (this.scopes.length === 1 && type.kind === "typeObject") this.runtimeTypeObjectNames.add(name);
    this.recordSemanticBinding(`${declarationSpan.start}:${name}`, type);
  }

  // Imported bindings remember their module specifier so identifier reads can
  // be classified against the project module graph (D31 item 23). JavaScript
  // imports never participate: only .vel modules join initialization cycles.
  private recordImportedBindingSource(javascript: boolean, source: string, local: string, imported: string | null): void {
    if (javascript) return;
    const binding = this.scopes.at(-1)?.get(local);
    if (binding) this.importedBindingSources.set(binding, { source, imported });
  }

  private recordImportedBindingOrigin(local: string, source: string, specifierSpan: Span): void {
    const binding = this.scopes.at(-1)?.get(local);
    // A failed declaration (collision) leaves the earlier binding in the
    // scope; tagging that one would misattribute the origin.
    if (binding && binding.span.start === specifierSpan.start && binding.span.end === specifierSpan.end) {
      this.importedBindingOrigins.set(binding, source);
    }
  }

  private recordInitializationImportRead(binding: Binding, local: string, span: Span): void {
    const origin = this.importedBindingSources.get(binding);
    if (origin === undefined || !this.inModuleInitializationPosition()) return;
    const key = spanIdentity(span);
    if (!this.initializationImportReadSites.has(key)) {
      this.initializationImportReadSites.set(key, { local, source: origin.source, imported: origin.imported, span });
    }
  }

  // True while code at this point runs during module evaluation itself:
  // top-level initializers and expression statements (including nested
  // top-level blocks), static class fields, and extension top-level
  // initializers. Function, action, method, arrow, constructor, and component
  // bodies — and per-construction positions such as parameter defaults and
  // instance field initializers — are deferred.
  /** True while analysis is directly in a declaration body rather than a function frame. */
  protected inComponentSetupPosition(): boolean {
    return this.functionDepth === 0;
  }

  protected inModuleInitializationPosition(): boolean {
    return this.functionDepth === 0
      && this.parameterDefaultDepth === 0
      && this.instanceFieldInitializerDepth === 0
      && this.deferredExecutionDepth === 0;
  }

  /** Initialization-position reads of imported bindings, for the project module-cycle check. */
  moduleInitializationImportReads(): readonly InitializationImportRead[] {
    return [...this.initializationImportReadSites.values()];
  }

  // D32 item 29: the language-wide text-conversion contract (charter
  // section 14) shared by f-strings, str(), and target-owned render sites.
  // Text conversion accepts only values whose text form is total and
  // hook-free — string, number, bool, enums, and null, plus optionals and
  // unions of those. Everything else (records, collections, functions, class
  // instances, unknown, any) is rejected at compile time so a data value
  // never reaches JavaScript string coercion, which would execute 'toString'
  // conversion hooks.
  private requireTextConvertible(type: ValueType, span: Span, site: "f-string" | "str"): void {
    if (isInvalidType(type) || this.isTextConvertible(type)) return;
    const lead = site === "f-string" ? "An f-string renders" : "str() converts";
    const exit = this.extensionTextForm(this.expandAliases(type)) === false
      ? "print(value) to inspect it"
      : "print(value) to inspect it, or Json.stringify(value) for data text";
    this.diagnostics.push(diagnostic(
      "VEL4026",
      `${lead} strings, numbers, bools, enums, null, and extension values with a declared text form; format ${describeType(type)} explicitly — ${exit}`,
      span,
    ));
  }

  private isTextConvertible(type: ValueType): boolean {
    return isTextConvertibleType(type, this);
  }

  /**
   * The `TypeEnvironment` view of alias expansion. Assignability needs it to
   * decide the text-conversion parameter domain on the expanded shape, exactly
   * as the direct `str()` check does.
   */
  expandTypeAliases(type: ValueType): ValueType {
    return this.expandAliases(type);
  }

  // A reactive state declaration owns its resolved lexical binding identity,
  // even when an outer reactive binding uses the same spelling.
  protected markDeclaredBindingReactive(name: string, kind: "state" | "prop" = "state"): void {
    const binding = this.scopes.at(-1)?.get(name);
    if (binding) {
      binding.reactiveKind = kind;
    }
  }

  protected reactiveBindingKind(name: string): "state" | "prop" | null {
    return this.lookup(name)?.reactiveKind ?? null;
  }

  private recordSemanticBinding(key: string, type: ValueType): void {
    this.semanticBindingTypes.set(key, type);
    this.semanticBindingMembers.set(key, this.semanticMembersOf(type));
  }

  protected semanticMembersOf(original: ValueType): ReadonlyMap<string, ValueType> {
    const privateContext = this.privateSemanticContext(original);
    const key = `${semanticTypeIdentity(original)}:private:${privateContext ?? ""}`;
    const cached = this.semanticMemberCache.get(key);
    if (cached) return cached;
    const members = this.createSemanticMembersOf(original);
    this.semanticMemberCache.set(key, members);
    return members;
  }

  private privateSemanticContext(original: ValueType): string | null {
    if (!this.currentClass) return null;
    const type = nonOptional(this.expandAliases(original));
    if (type.kind === "class") {
      const key = type.identity ?? type.name;
      return this.isSubclassOf(key, this.currentClass) ? this.currentClass : null;
    }
    if (type.kind === "classConstructor") {
      return (type.identity ?? type.name) === this.currentClass ? this.currentClass : null;
    }
    return null;
  }

  private createSemanticMembersOf(original: ValueType): ReadonlyMap<string, ValueType> {
    const type = nonOptional(this.expandAliases(original));
    const available = (names: readonly string[], member: (name: string) => ValueType | null): ReadonlyMap<string, ValueType> => new Map(
      names.flatMap((name) => {
        const value = member(name);
        return value ? [[name, value] as const] : [];
      }),
    );
    if (type.kind === "union") {
      if (type.members.length === 0) return new Map();
      const memberMaps = type.members.map((member) => this.createSemanticMembersOf(member));
      const common = new Map<string, ValueType>();
      for (const [name] of memberMaps[0]!) {
        const candidates = memberMaps.map((members) => members.get(name));
        if (candidates.every((candidate): candidate is ValueType => candidate !== undefined)) {
          common.set(name, unionOf(candidates));
        }
      }
      return common;
    }
    if (type.kind === "string") return new Map(["size", "trim", "upper", "lower", "slice", "char", "has", "index", "count", "startsWith", "endsWith", "split", "replace", "replaceAll", "padStart", "padEnd", "repeat", "isBlank"]
      .map((name) => [name, this.stringMember(name)!]));
    if (type.kind === "number") return new Map(["abs", "round", "floor", "ceil", "toFixed", "isInteger", "isNaN", "isFinite"]
      .map((name) => [name, this.numberMember(name)!]));
    if (type.kind === "list") return available(["size", "get", "slice", "append", "extend", "insert", "has", "remove", "pop", "clear", "copy", "count", "index", "sorted", "reversed", "map", "flatMap", "filter", "reduce", "some", "every", "find", "join", "sum", "min", "max"], (name) => this.listMember(type, name));
    if (type.kind === "map") return available(["size", "get", "set", "update", "has", "remove", "clear", "copy", "keys", "values", "entries"], (name) => this.mapMember(type, name));
    if (type.kind === "record") return available(["size", "get", "set", "has", "remove", "clear", "copy", "keys", "values", "entries"], (name) => this.recordMember(type, name));
    if (type.kind === "set") return available(["size", "add", "update", "has", "remove", "clear", "copy", "values", "union", "intersection", "difference"], (name) => this.setMember(type, name));
    if (type.kind === "action") return new Map([
      ["pending", boolType],
      ["error", optionalOf({ kind: "class", name: "Error" })],
    ]);
    if (type.kind === "object") return new Map([...type.fields].map(([name, value]) => {
      const readable = type.readonlyView || type.readonlyFields?.has(name) ? this.readonlyDataViewOf(value) : value;
      return [name, type.optionalFields?.has(name) ? optionalOf(readable) : readable];
    }));
    if (type.kind === "extension") return type.properties;
    if (type.kind === "named") {
      const identity = type.identity ?? type.name;
      const fields = this.fieldsOf(identity) ?? new Map();
      const readonlyFields = this.readonlyFieldsOf(identity);
      return new Map([...fields].map(([name, value]) => [name, type.readonlyView || readonlyFields?.has(name) ? this.readonlyDataViewOf(value) : value]));
    }
    if (type.kind === "class") {
      const members = new Map<string, ValueType>();
      let current: string | null = type.identity ?? type.name;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const info = this.classes.get(current);
        for (const [name, field] of info?.fields ?? []) if (!members.has(name)) members.set(name, this.displayExternalClasses(field.type));
        for (const [name, method] of info?.methods ?? []) if (!members.has(name)) members.set(name, this.displayExternalClasses(method));
        current = info?.base ?? null;
      }
      const privateContext = this.privateSemanticContext(type);
      if (privateContext) {
        for (const [name, field] of this.privateFields.get(privateContext) ?? []) members.set(name, this.displayExternalClasses(field.type));
        for (const [name, method] of this.privateMethods.get(privateContext) ?? []) members.set(name, this.displayExternalClasses(method));
      }
      return members;
    }
    if (type.kind === "classConstructor") {
      const members = new Map<string, ValueType>();
      let current: string | null = type.identity ?? type.name;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const info = this.classes.get(current);
        for (const [name, field] of info?.staticFields ?? []) if (!members.has(name)) members.set(name, this.displayExternalClasses(field.type));
        for (const [name, method] of info?.staticMethods ?? []) if (!members.has(name)) members.set(name, this.displayExternalClasses(method));
        current = info?.base ?? null;
      }
      const privateContext = this.privateSemanticContext(type);
      if (privateContext) {
        for (const [name, field] of this.privateStaticFields.get(privateContext) ?? []) members.set(name, this.displayExternalClasses(field.type));
        for (const [name, method] of this.privateStaticMethods.get(privateContext) ?? []) members.set(name, this.displayExternalClasses(method));
      }
      return members;
    }
    if (type.kind === "enumObject") {
      const members = new Map<string, ValueType>();
      for (const name of type.members) members.set(name, { kind: "enumMember", name: type.name, identity: type.identity, member: name });
      members.set("is", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType });
      members.set("parse", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: { kind: "enum", name: type.name, identity: type.identity } });
      members.set("values", { kind: "function", parameterNames: [], parameters: [], requiredParameters: 0, result: { kind: "list", element: { kind: "enum", name: type.name, identity: type.identity } } });
      return members;
    }
    if (type.kind === "typeObject") return new Map([
      ["is", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType }],
      ["parse", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: this.runtimeTypeObjectValue(type) }],
    ]);
    if (type.kind === "runtimeType") return new Map([
      ["is", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType }],
      ["parse", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: type.value }],
    ]);
    return new Map();
  }

  /** The runtime surface of an enum object: its members plus is, parse, and values() (ENM-U1). */
  private enumRuntimeMember(name: string, identity: string, members: ReadonlySet<string>, property: string): ValueType | null {
    if (members.has(property)) return { kind: "enumMember", name, identity, member: property };
    if (property === "is") return { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType };
    if (property === "parse") return { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: { kind: "enum", name, identity } };
    // ENM-U1 (D47-approved): values() returns the members in declaration
    // order as a fresh mutable List on every call, like split and friends.
    if (property === "values") return { kind: "function", parameterNames: [], parameters: [], requiredParameters: 0, result: { kind: "list", element: { kind: "enum", name, identity } } };
    return null;
  }

  private runtimeTypeObjectValue(type: Extract<ValueType, { kind: "typeObject" }>): ValueType {
    // A named import or local transparent alias owns a useful source spelling;
    // keep it while ordinary alias expansion supplies the underlying shape.
    // Namespace access has no local alias binding, so it uses the precise
    // exported target carried by the module interface instead.
    if (this.typeAliases.has(type.name)) return { kind: "named", name: type.name };
    if (type.value) return type.value;
    const identity = this.namedTypeIdentities.get(type.name);
    return {
      kind: "named",
      name: type.name,
      ...(identity ? { identity } : {}),
    };
  }

  private displayExternalClasses(type: ValueType): ValueType {
    if ((type.kind === "class" || type.kind === "classConstructor") && type.identity) {
      return { ...type, name: this.classDisplayNames.get(type.identity) ?? type.name };
    }
    if (type.kind === "optional") return optionalOf(this.displayExternalClasses(type.inner));
    if (type.kind === "list") return { ...type, element: this.displayExternalClasses(type.element) };
    if (type.kind === "set") return { ...type, element: this.displayExternalClasses(type.element) };
    if (type.kind === "map") return { ...type, key: this.displayExternalClasses(type.key), value: this.displayExternalClasses(type.value) };
    if (type.kind === "record") return { ...type, value: this.displayExternalClasses(type.value) };
    if (type.kind === "promise") return { kind: "promise", value: this.displayExternalClasses(type.value) };
    if (type.kind === "runtimeType") return { kind: "runtimeType", value: this.displayExternalClasses(type.value) };
    if (type.kind === "typeObject") return type.value ? { ...type, value: this.displayExternalClasses(type.value) } : type;
    if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, this.displayExternalClasses(value)])) };
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
      ...type,
      parameters: type.parameters.map((parameter) => this.displayExternalClasses(parameter)),
      ...(type.rest ? { rest: this.displayExternalClasses(type.rest) } : {}),
      result: this.displayExternalClasses(type.result),
    };
    if (type.kind === "union") return { kind: "union", members: type.members.map((member) => this.displayExternalClasses(member)) };
    return type;
  }

  // Emitted JavaScript preserves binding names, so a const or let shadow owns
  // its name for its whole emitted block: any reference in that block that the
  // analyzer resolves to the outer binding — an earlier statement or the
  // shadow's own initializer — lands in the shadow's temporal dead zone (or,
  // inside an arrow, captures the shadow instead of the outer binding). Each
  // scope therefore pre-registers the names its statements will declare, and a
  // reference that resolves past a scope still pending the same name is
  // reported as the ambiguity it is.
  protected prescanScopeDeclarations(statements: readonly Statement[]): void {
    const pending = this.pendingScopeDeclarations.at(-1)!;
    for (const statement of statements) {
      if (statement.kind === "VariableDeclaration") {
        this.collectPatternNames(statement.pattern, (name) => {
          if (!pending.has(name)) pending.set(name, { span: statement.span, loopHead: false });
        });
      } else {
        const extension = this.prescanExtensionScopeDeclaration(statement);
        if (extension && !pending.has(extension.name)) pending.set(extension.name, { span: extension.span, loopHead: false });
      }
    }
  }

  private collectPatternNames(pattern: BindingPattern, add: (name: string) => void): void {
    if (pattern.kind === "NameBindingPattern") {
      add(pattern.name);
      return;
    }
    if (pattern.kind === "ListBindingPattern") {
      for (const element of pattern.elements) if (element) this.collectPatternNames(element, add);
      if (pattern.rest) add(pattern.rest.name);
      return;
    }
    for (const entry of pattern.entries) this.collectPatternNames(entry.pattern, add);
    if (pattern.rest) add(pattern.rest.name);
  }

  private checkShadowedRead(name: string, span: Span): void {
    let resolvedIndex = -1;
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      if (this.scopes[index]?.has(name)) {
        resolvedIndex = index;
        break;
      }
    }
    // A Core or extension global resolves by its own emission rules, not by a
    // lexical name the shadow could capture.
    if (resolvedIndex === -1) return;
    for (let index = this.scopes.length - 1; index >= resolvedIndex; index -= 1) {
      const declaration = this.pendingScopeDeclarations[index]?.get(name);
      // A pending loop binding lives in the loop's own scope, so it also
      // captures a read that resolves to the scope holding the loop
      // statement; a pending declaration in the resolution scope itself is
      // a same-scope redeclaration, reported on its own.
      if (!declaration || (index === resolvedIndex && !declaration.loopHead)) continue;
      const identity = spanIdentity(span);
      if (!this.reportedShadowedReads.has(identity)) {
        this.reportedShadowedReads.add(identity);
        const insideDeclaration = span.start >= declaration.span.start && span.end <= declaration.span.end;
        this.diagnostics.push(diagnostic(
          "VEL3017",
          declaration.loopHead
            ? `The iterable of this for-loop cannot reference the outer '${name}' its loop binding shadows; rename the loop binding, or read the iterable into a differently named binding first`
            : insideDeclaration
              ? `The initializer of shadowing declaration '${name}' cannot reference the outer '${name}' it shadows; rename the new binding to keep the outer '${name}' readable`
              : `'${name}' is shadowed by a declaration later in this scope, so this reference cannot reach the outer '${name}'; rename the shadowing declaration to keep the outer '${name}' readable`,
          span,
        ));
      }
      return;
    }
  }

  private declarePattern(pattern: BindingPattern, mutable: boolean, type: ValueType, declaredType = type): void {
    if (pattern.kind === "NameBindingPattern") {
      this.declareBinding(pattern.name, mutable, type, pattern.span, false, declaredType);
      return;
    }
    if (pattern.kind === "ListBindingPattern") {
      const element = type.kind === "list" ? type.readonlyView ? this.readonlyDataViewOf(type.element) : type.element
        : type.kind === "any" ? anyType : unknownType;
      const declaredElement = declaredType.kind === "list" ? declaredType.readonlyView ? this.readonlyDataViewOf(declaredType.element) : declaredType.element
        : declaredType.kind === "any" ? anyType : unknownType;
      if (type.kind !== "list" && type.kind !== "any") {
        this.typeError(`Cannot list-destructure ${describeType(type)}`, pattern.span);
      }
      for (const child of pattern.elements) if (child) this.declarePattern(child, mutable, element, declaredElement);
      if (pattern.rest) this.declareBinding(
        pattern.rest.name,
        mutable,
        { kind: "list", element },
        pattern.rest.span,
        false,
        { kind: "list", element: declaredElement },
      );
      return;
    }

    const fields = type.kind === "object" ? type.fields : type.kind === "named" ? this.fieldsOf(type.identity ?? type.name) : null;
    const declaredFields = declaredType.kind === "object" ? declaredType.fields
      : declaredType.kind === "named" ? this.fieldsOf(declaredType.identity ?? declaredType.name) : null;
    if (!fields && type.kind !== "any") {
      this.typeError(`Cannot object-destructure ${describeType(type)}`, pattern.span);
    }
    const selected = new Set<string>();
    for (const entry of pattern.entries) {
      if (selected.has(entry.property)) {
        this.diagnostics.push(diagnostic("VEL4019", `Object binding field '${entry.property}' is declared more than once`, entry.span));
      }
      selected.add(entry.property);
      if (type.kind === "named" && fields?.has(entry.property)) {
        this.semanticBindingEntryOwners.set(`${entry.span.start}:${entry.property}`, type);
      }
      const rawFieldValue = fields?.get(entry.property) ?? (type.kind === "any" ? anyType : unknownType);
      const readonlyField = isReadonlyView(type)
        || type.kind === "object" && type.readonlyFields?.has(entry.property) === true
        || type.kind === "named" && this.readonlyFieldsOf(type.identity ?? type.name)?.has(entry.property) === true;
      const fieldValue = readonlyField ? this.readonlyDataViewOf(rawFieldValue) : rawFieldValue;
      const structurallyOptional = type.kind === "object" && type.optionalFields?.has(entry.property);
      const field = structurallyOptional ? optionalOf(fieldValue) : fieldValue;
      if (structurallyOptional || this.expandAliases(fieldValue).kind === "optional") {
        this.optionalBindingEntries.add(entry.span.start);
      }
      if (fields && !fields.has(entry.property)) this.typeError(`Object has no field '${entry.property}'`, entry.span);
      const rawDeclaredFieldValue = declaredFields?.get(entry.property) ?? (declaredType.kind === "any" ? anyType : unknownType);
      const declaredReadonlyField = isReadonlyView(declaredType)
        || declaredType.kind === "object" && declaredType.readonlyFields?.has(entry.property) === true
        || declaredType.kind === "named" && this.readonlyFieldsOf(declaredType.identity ?? declaredType.name)?.has(entry.property) === true;
      const declaredFieldValue = declaredReadonlyField ? this.readonlyDataViewOf(rawDeclaredFieldValue) : rawDeclaredFieldValue;
      const declaredStructurallyOptional = declaredType.kind === "object" && declaredType.optionalFields?.has(entry.property);
      this.declarePattern(
        entry.pattern,
        mutable,
        field,
        declaredStructurallyOptional ? optionalOf(declaredFieldValue) : declaredFieldValue,
      );
    }
    if (pattern.rest) {
      const remaining = new Map<string, ValueType>();
      for (const [name, field] of fields ?? []) {
        if (selected.has(name)) continue;
        const readonlyField = isReadonlyView(type)
          || type.kind === "object" && type.readonlyFields?.has(name) === true
          || type.kind === "named" && this.readonlyFieldsOf(type.identity ?? type.name)?.has(name) === true;
        remaining.set(name, readonlyField ? this.readonlyDataViewOf(field) : field);
      }
      const remainingOptional = type.kind === "object"
        ? new Set([...type.optionalFields ?? []].filter((name) => !selected.has(name)))
        : new Set<string>();
      const declaredRemaining = new Map<string, ValueType>();
      for (const [name, field] of declaredFields ?? []) {
        if (selected.has(name)) continue;
        const readonlyField = isReadonlyView(declaredType)
          || declaredType.kind === "object" && declaredType.readonlyFields?.has(name) === true
          || declaredType.kind === "named" && this.readonlyFieldsOf(declaredType.identity ?? declaredType.name)?.has(name) === true;
        declaredRemaining.set(name, readonlyField ? this.readonlyDataViewOf(field) : field);
      }
      const declaredRemainingOptional = declaredType.kind === "object"
        ? new Set([...declaredType.optionalFields ?? []].filter((name) => !selected.has(name)))
        : new Set<string>();
      this.declareBinding(pattern.rest.name, mutable, type.kind === "any" ? anyType : {
        kind: "object",
        fields: remaining,
        ...(remainingOptional.size > 0 ? { optionalFields: remainingOptional } : {}),
      }, pattern.rest.span, false, declaredType.kind === "any" ? anyType : {
        kind: "object",
        fields: declaredRemaining,
        ...(declaredRemainingOptional.size > 0 ? { optionalFields: declaredRemainingOptional } : {}),
      });
    }
  }

  private validateKnownBindingShape(pattern: BindingPattern, value: Expression): void {
    if (pattern.kind === "NameBindingPattern") return;
    if (pattern.kind === "ListBindingPattern") {
      if (value.kind !== "ListExpression" || value.elements.some((element) => element.kind === "SpreadExpression")) return;
      const valid = pattern.rest ? value.elements.length >= pattern.elements.length : value.elements.length === pattern.elements.length;
      if (!valid) {
        const expected = `${pattern.rest ? "at least " : "exactly "}${pattern.elements.length} ${pattern.elements.length === 1 ? "item" : "items"}`;
        this.diagnostics.push(diagnostic(
          "VEL4020",
          `List binding requires ${expected}, but this literal contains ${value.elements.length}`,
          pattern.span,
        ));
        return;
      }
      pattern.elements.forEach((element, index) => {
        if (element) this.validateKnownBindingShape(element, value.elements[index]!);
      });
      return;
    }
    if (value.kind !== "ObjectExpression") return;
    for (const entry of pattern.entries) {
      const property = [...value.properties].reverse().find((candidate) => candidate.kind === "ObjectProperty" && candidate.name === entry.property);
      if (property?.kind === "ObjectProperty") this.validateKnownBindingShape(entry.pattern, property.value);
    }
  }

  protected lookup(name: string): Binding | null {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const binding = this.scopes[index]?.get(name);
      if (binding) {
        return binding.narrowingFrame !== null && binding.narrowingFrame < this.flowFrameDepth
          ? { ...binding, type: binding.storageType, narrowingFrame: null }
          : binding;
      }
    }
    return null;
  }

  protected isBuiltinValueReference(expression: Expression, name: "Json" | "Promise" | "Look" | "range"): boolean {
    return this.builtinValueReferences.get(spanIdentity(expression.span)) === name;
  }

  protected applyNarrowings(narrowed: ReadonlyMap<string, ValueType>, narrowingSpan: Span): void {
    const memberScope = this.memberNarrowings.at(-1)!;
    for (const [key, type] of narrowed) {
      if (key.startsWith(memberNarrowingPrefix)) {
        memberScope.set(key.slice(memberNarrowingPrefix.length), { type, frame: this.flowFrameDepth });
      } else {
        const binding = this.lookup(key);
        this.scopes.at(-1)!.set(key, {
          mutable: binding?.mutable ?? false,
          type,
          declaredType: binding?.declaredType ?? type,
          storageType: binding?.storageType ?? type,
          ...(binding ? { storageBinding: binding.storageBinding ?? binding } : {}),
          span: binding?.span ?? narrowingSpan,
          narrowingFrame: this.flowFrameDepth,
          ...(binding?.reactiveKind ? { reactiveKind: binding.reactiveKind } : {}),
        });
      }
    }
  }

  private persistNarrowings(narrowed: ReadonlyMap<string, ValueType>): void {
    const scope = this.scopes.at(-1)!;
    const memberScope = this.memberNarrowings.at(-1)!;
    for (const [key, type] of narrowed) {
      if (key.startsWith(memberNarrowingPrefix)) {
        memberScope.set(key.slice(memberNarrowingPrefix.length), { type, frame: this.flowFrameDepth });
        continue;
      }
      const binding = this.lookup(key);
      if (!binding) continue;
      const local = scope.get(key);
      if (local) {
        local.type = type;
        local.narrowingFrame = this.flowFrameDepth;
        // A persisted (checked or merged) fact is not assignment-established.
        local.assignedFact = false;
      } else {
        scope.set(key, {
          mutable: binding.mutable,
          type,
          declaredType: binding.declaredType,
          storageType: binding.storageType,
          storageBinding: binding.storageBinding ?? binding,
          span: binding.span,
          narrowingFrame: this.flowFrameDepth,
          ...(binding.reactiveKind ? { reactiveKind: binding.reactiveKind } : {}),
        });
      }
    }
  }

  // D44 rule 71: an assignment (including a declaration initializer)
  // establishes the right-hand side's type as a fact for the assigned
  // location — after an assignment the value there is the assigned value, so
  // this is the most reliable fact the system carries. The fact is spelled as
  // the declared arm the value inhabits when exactly one arm fits, so reads
  // keep the declared vocabulary. No fact is established when the assignment
  // adds nothing (`x = maybeNull()` keeps `string?`), when the declared type
  // is not a refinable domain (only optionals, unions, and `unknown` are),
  // when the value is `null` (the declaration `let x: string? = null` leaves
  // the declared question open), or when either side is an escape hatch.
  private assignedFactType(assigned: ValueType, storage: ValueType): ValueType | null {
    if (isInvalidType(assigned) || isInvalidType(storage)) return null;
    if (assigned.kind === "any" || assigned.kind === "null") return null;
    if (containsInferredResultPlaceholder(assigned)) return null;
    const expandedStorage = this.expandAliases(storage);
    if (expandedStorage.kind !== "optional" && expandedStorage.kind !== "union" && expandedStorage.kind !== "unknown") return null;
    if (expandedStorage.kind === "unknown" && expandedStorage.restricted) return null;
    if (!isAssignable(assigned, storage, this)) return null;
    if (isAssignable(storage, assigned, this)) return null;
    if (expandedStorage.kind === "unknown") return assigned;
    const arms = expandedStorage.kind === "optional" ? [expandedStorage.inner] : expandedStorage.members;
    const matching = arms.filter((arm) => isAssignable(assigned, arm, this));
    return matching.length === 1 ? matching[0]! : null;
  }

  private establishAssignedFact(name: string, assigned: ValueType): void {
    const binding = this.lookup(name);
    if (!binding) return;
    const fact = this.assignedFactType(assigned, (binding.storageBinding ?? binding).storageType);
    if (fact === null) return;
    const scope = this.scopes.at(-1)!;
    const local = scope.get(name);
    if (local) {
      local.type = fact;
      local.narrowingFrame = this.flowFrameDepth;
      local.assignedFact = true;
    } else {
      scope.set(name, {
        mutable: binding.mutable,
        type: fact,
        declaredType: binding.declaredType,
        storageType: binding.storageType,
        storageBinding: binding.storageBinding ?? binding,
        span: binding.span,
        narrowingFrame: this.flowFrameDepth,
        assignedFact: true,
        ...(binding.reactiveKind ? { reactiveKind: binding.reactiveKind } : {}),
      });
    }
  }

  /** Rule 71 for member targets: establish after invalidation so the new fact survives its own write. */
  private establishAssignedMemberFact(
    target: Extract<Expression, { kind: "MemberExpression" }>,
    assigned: ValueType,
    declaredMemberType: ValueType,
  ): void {
    const fact = this.assignedFactType(assigned, declaredMemberType);
    if (fact === null) return;
    const path = this.stableMemberAccessPath(target);
    if (!path) return;
    this.memberNarrowings.at(-1)!.set(path, {
      type: fact,
      frame: this.flowFrameDepth,
      assigned: true,
      domain: declaredMemberType,
    });
  }

  /** Rule 71 for destructuring declarations: each binding learns its own initializer piece. */
  private establishAssignedPatternFacts(pattern: BindingPattern, assigned: ValueType): void {
    if (pattern.kind === "NameBindingPattern") {
      this.establishAssignedFact(pattern.name, assigned);
      return;
    }
    const expanded = this.expandAliases(assigned);
    if (pattern.kind === "ListBindingPattern") {
      if (expanded.kind !== "list") return;
      const element = expanded.readonlyView ? this.readonlyDataViewOf(expanded.element) : expanded.element;
      for (const child of pattern.elements) if (child) this.establishAssignedPatternFacts(child, element);
      return;
    }
    const fields = expanded.kind === "object" ? expanded.fields
      : expanded.kind === "named" ? this.fieldsOf(expanded.identity ?? expanded.name) : null;
    if (!fields) return;
    for (const entry of pattern.entries) {
      const field = fields.get(entry.property);
      if (!field) continue;
      const piece = expanded.kind === "object" && expanded.optionalFields?.has(entry.property)
        ? optionalOf(field)
        : field;
      this.establishAssignedPatternFacts(entry.pattern, piece);
    }
  }

  private stableMemberAccessPath(expression: Expression): string | null {
    if (expression.kind === "IdentifierExpression") {
      const binding = this.lookup(expression.name);
      return binding ? `${binding.span.start}:${expression.name}` : null;
    }
    if (expression.kind !== "MemberExpression" || expression.optional) return null;
    const base = this.stableMemberAccessPath(expression.object);
    if (!base || !this.stableDataMember(expression.object, expression.property)) return null;
    return `${base}.${expression.property}`;
  }

  private stableOptionalMemberAccessPath(expression: Expression): string | null {
    if (expression.kind === "IdentifierExpression") {
      const binding = this.lookup(expression.name);
      return binding ? `${binding.span.start}:${expression.name}` : null;
    }
    if (expression.kind !== "MemberExpression") return null;
    const base = this.stableOptionalMemberAccessPath(expression.object);
    if (!base || !this.stableDataMember(expression.object, expression.property)) return null;
    return `${base}.${expression.property}`;
  }

  private stableDataMember(objectExpression: Expression, property: string): boolean {
    const inferred = this.inferredExpressionTypes.get(spanIdentity(objectExpression.span))
      ?? (objectExpression.kind === "IdentifierExpression" ? this.lookup(objectExpression.name)?.type : null);
    if (!inferred) return false;
    const owner = nonOptional(this.expandAliases(inferred));
    if (owner.kind === "union") return owner.members.length > 0
      && owner.members.every((member) => this.discriminatedDataField(member, property) !== null);
    if (owner.kind === "object") return owner.fields.has(property);
    if (owner.kind === "named") return this.fieldsOf(owner.identity ?? owner.name)?.has(property) ?? false;
    if (owner.kind === "class") {
      const key = owner.identity ?? owner.name;
      if (this.findGetter(key, property)) return false;
      if (this.privateGetters.get(this.currentClass ?? "")?.has(property)) return false;
      return Boolean(this.findField(key, property) || this.privateFieldForAccess(key, property, false));
    }
    if (owner.kind !== "classConstructor") return false;
    const key = owner.identity ?? owner.name;
    if (this.findStaticGetter(key, property)) return false;
    if (this.privateStaticGetters.get(this.currentClass ?? "")?.has(property)) return false;
    return Boolean(this.findStaticField(key, property) || this.privateFieldForAccess(key, property, true));
  }

  private discriminatedDataField(original: ValueType, property: string): ValueType | null {
    const type = nonOptional(this.expandAliases(original));
    if (type.kind === "object") {
      const raw = type.fields.get(property);
      const field = raw && (type.readonlyView || type.readonlyFields?.has(property)) ? this.readonlyDataViewOf(raw) : raw;
      return field && type.optionalFields?.has(property) ? optionalOf(field) : field ?? null;
    }
    if (type.kind === "named") {
      const field = this.fieldsOf(type.identity ?? type.name)?.get(property) ?? null;
      return field && (type.readonlyView || this.readonlyFieldsOf(type.identity ?? type.name)?.has(property)) ? this.readonlyDataViewOf(field) : field;
    }
    return null;
  }

  private dataFieldIsReadonly(original: ValueType, property: string): boolean {
    const type = nonOptional(this.expandAliases(original));
    if (type.kind === "union") return type.members.some((member) => this.dataFieldIsReadonly(member, property));
    if (type.kind === "object") {
      return type.fields.has(property) && (type.readonlyView === true || type.readonlyFields?.has(property) === true);
    }
    if (type.kind === "named") {
      return (this.fieldsOf(type.identity ?? type.name)?.has(property) ?? false)
        && (type.readonlyView === true || this.readonlyFieldsOf(type.identity ?? type.name)?.has(property) === true);
    }
    return false;
  }

  private lookupMemberNarrowing(path: string): ValueType | null {
    return this.lookupMemberNarrowingEntry(path)?.type ?? null;
  }

  private lookupMemberNarrowingEntry(path: string): MemberNarrowing | null {
    for (let index = this.memberNarrowings.length - 1; index >= 0; index -= 1) {
      const narrowing = this.memberNarrowings[index]?.get(path);
      if (narrowing && narrowing.frame === this.flowFrameDepth) return narrowing;
    }
    return null;
  }

  private invalidateAssignmentNarrowings(target: AssignmentStatement["target"], binding: Binding | null): void {
    if (target.kind === "IdentifierExpression") {
      if (binding && binding.narrowingFrame !== null) {
        binding.type = binding.storageType;
        binding.narrowingFrame = null;
        binding.assignedFact = false;
      }
      if (binding) this.invalidateMemberNarrowings(`${binding.span.start}:${target.name}`);
      return;
    }
    if (target.kind !== "MemberExpression") return;
    const path = this.stableMemberAccessPath(target);
    if (path) this.invalidateMemberNarrowings(path);
  }

  private invalidateMemberNarrowings(path: string): void {
    for (const scope of this.memberNarrowings) {
      for (const [candidate, narrowing] of scope) {
        if (narrowing.frame === this.flowFrameDepth
          && (candidate === path || candidate.startsWith(`${path}.`))) scope.delete(candidate);
      }
    }
  }

  private invalidateMemberDescendantNarrowings(path: string): void {
    for (const scope of this.memberNarrowings) {
      for (const [candidate, narrowing] of scope) {
        if (narrowing.frame === this.flowFrameDepth && candidate.startsWith(`${path}.`)) scope.delete(candidate);
      }
    }
  }

  private invalidateMutableCollectionCallReceiver(callee: Extract<Expression, { kind: "MemberExpression" }>): void {
    const owner = nonOptional(this.expandAliases(this.inferredExpressionType(callee.object)));
    const mutating = owner.kind === "list"
      ? new Set(["append", "extend", "insert", "remove", "pop", "clear"])
      : owner.kind === "map" ? new Set(["set", "update", "remove", "clear"])
        : owner.kind === "set" ? new Set(["add", "update", "remove", "clear"])
          : owner.kind === "record" ? new Set(["set", "remove", "clear"])
            : null;
    if (!mutating?.has(callee.property)) return;
    const path = this.stableMemberAccessPath(callee.object);
    if (path) this.invalidateMemberDescendantNarrowings(path);
  }

  private invalidateCurrentMemberNarrowings(): void {
    for (const scope of this.memberNarrowings) {
      for (const [path, narrowing] of scope) {
        if (narrowing.frame === this.flowFrameDepth) scope.delete(path);
      }
    }
  }

  // D44 rule 73: a member write invalidates the facts whose root could alias
  // an object the write mutates. Two roots whose types have no values in
  // common cannot be the same object, so unrelated roots keep their facts;
  // same-type roots still invalidate each other. Every receiver along the
  // written path is compared — `outer.inner.value = x` mutates the object at
  // `outer.inner`, which a fact root of that type may alias even when the
  // outermost roots' types are unrelated.
  private invalidateAliasableMemberNarrowings(target: Extract<Expression, { kind: "MemberExpression" }>): void {
    const receiverTypes: ValueType[] = [];
    let receiver: Expression = target.object;
    for (;;) {
      const inferred = this.inferredExpressionTypes.get(spanIdentity(receiver.span))
        ?? (receiver.kind === "IdentifierExpression" ? this.lookup(receiver.name)?.type ?? null : null);
      if (!inferred) {
        // An unresolvable receiver keeps the previous conservative behavior.
        this.invalidateCurrentMemberNarrowings();
        return;
      }
      receiverTypes.push(inferred);
      if (receiver.kind !== "MemberExpression") break;
      receiver = receiver.object;
    }
    for (const scope of this.memberNarrowings) {
      for (const [path, narrowing] of scope) {
        if (narrowing.frame !== this.flowFrameDepth) continue;
        const rootType = this.memberNarrowingRootType(path);
        if (rootType !== null
          && !receiverTypes.some((receiverType) => this.equalityTypesIntersect(receiverType, rootType))) continue;
        scope.delete(path);
      }
    }
  }

  /** The current type of the binding a member-narrowing path is rooted at, or null when it cannot be resolved. */
  private memberNarrowingRootType(path: string): ValueType | null {
    const dot = path.indexOf(".");
    const root = dot === -1 ? path : path.slice(0, dot);
    const colon = root.indexOf(":");
    if (colon === -1) return null;
    const start = Number(root.slice(0, colon));
    const name = root.slice(colon + 1);
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const binding = this.scopes[index]?.get(name);
      if (binding && binding.span.start === start) return binding.type;
    }
    return null;
  }

  private runtimeCheckedType(input: ValueType, checked: ValueType): ValueType {
    const source = this.expandAliases(input);
    const candidates = source.kind === "union" ? source.members
      : source.kind === "optional" ? [source.inner, nullType]
        : [source];
    const mutableChecked = mutableViewOf(checked);
    const matching = candidates.filter((candidate) => this.matchTypesOverlap(mutableViewOf(candidate), mutableChecked));
    return matching.length > 0 && matching.every((candidate) => isReadonlyView(candidate))
      ? this.readonlyDataViewOf(checked)
      : checked;
  }

  private matchPatternReflectionMayExecute(pattern: MatchPattern, input: ValueType): boolean {
    if (pattern.kind === "MatchAsPattern") return this.matchPatternReflectionMayExecute(pattern.pattern, input);
    const type = this.expandAliases(input);
    if (type.kind === "union") {
      return type.members.some((member) => this.matchPatternReflectionMayExecute(pattern, member));
    }
    if (type.kind === "optional") return this.matchPatternReflectionMayExecute(pattern, type.inner);
    if (pattern.kind === "MatchTypePattern") {
      return this.runtimeTypeCheckMayExecute(type, this.resolveAnnotation(pattern.type));
    }
    if (pattern.kind === "MatchListPattern") {
      if (type.kind === "any") return true;
      const element = type.kind === "list" ? type.element : unknownType;
      return pattern.elements.some((child) => this.matchPatternReflectionMayExecute(child, element));
    }
    if (pattern.kind !== "MatchObjectPattern") return false;
    if (type.kind === "any") return true;
    const fields = type.kind === "object" ? type.fields
      : type.kind === "named" ? this.fieldsOf(type.identity ?? type.name)
        : null;
    return pattern.entries.some((entry) => this.matchPatternReflectionMayExecute(
      entry.pattern,
      fields?.get(entry.property) ?? unknownType,
    ));
  }

  private snapshotFlowFacts(): FlowFactsSnapshot {
    const bindings = new Map<Binding, {
      readonly type: ValueType;
      readonly storageType: ValueType;
      readonly frame: number | null;
      readonly assigned: boolean;
    }>();
    for (const scope of this.scopes) {
      for (const binding of scope.values()) {
        bindings.set(binding, {
          type: binding.type,
          storageType: binding.storageType,
          frame: binding.narrowingFrame,
          assigned: binding.assignedFact === true,
        });
      }
    }
    return {
      bindings,
      members: this.memberNarrowings.map((scope) => new Map(scope)),
    };
  }

  private restoreFlowFacts(snapshot: FlowFactsSnapshot): void {
    for (const [binding, state] of snapshot.bindings) {
      binding.type = state.type;
      binding.storageType = state.storageType;
      binding.narrowingFrame = state.frame;
      binding.assignedFact = state.assigned;
    }
    snapshot.members.forEach((source, index) => {
      const target = this.memberNarrowings[index];
      if (!target) return;
      target.clear();
      for (const [path, narrowing] of source) target.set(path, narrowing);
    });
  }

  private analyzeIsolatedFlow(snapshot: FlowFactsSnapshot, analyze: () => void): FlowFactInvalidations {
    this.restoreFlowFacts(snapshot);
    analyze();
    const invalidations = this.flowInvalidationsSince(snapshot);
    this.restoreFlowFacts(snapshot);
    return invalidations;
  }

  private flowInvalidationsSince(snapshot: FlowFactsSnapshot): FlowFactInvalidations {
    const bindings = new Set<Binding>();
    const storageTypes = new Map<Binding, ValueType>();
    for (const [binding, state] of snapshot.bindings) {
      if (state.frame !== null
        && (binding.narrowingFrame !== state.frame || !sameType(binding.type, state.type))) bindings.add(binding);
      storageTypes.set(binding, binding.storageType);
    }
    const members = new Map<number, ReadonlySet<string>>();
    snapshot.members.forEach((source, index) => {
      const current = this.memberNarrowings[index];
      const invalidated = new Set<string>();
      for (const [path, narrowing] of source) {
        const after = current?.get(path);
        if (!after || after.frame !== narrowing.frame || !sameType(after.type, narrowing.type)) invalidated.add(path);
      }
      if (invalidated.size > 0) members.set(index, invalidated);
    });
    return { bindings, members, storageTypes };
  }

  private reanalyzeLoopBackEdge(
    baseline: FlowFactsSnapshot,
    backEdges: readonly FlowFactInvalidations[],
    body: readonly Statement[],
    diagnosticStart: number,
    analyze: () => void,
  ): void {
    if (!this.flowInvalidationsAffectFacts(backEdges)) return;
    const loopHead = this.flowSnapshotAfterInvalidations(baseline, backEdges);
    this.loopFlowContexts.push({ baseline: loopHead, carried: [], backEdges: [], sawBreak: false });
    const secondDiagnosticStart = this.diagnostics.length;
    this.clearCachedFlowTypes(body);
    try {
      this.analyzeIsolatedFlow(loopHead, analyze);
      this.deduplicateDiagnostics(diagnosticStart, secondDiagnosticStart);
    } finally {
      this.loopFlowContexts.pop();
      this.restoreFlowFacts(baseline);
    }
  }

  private flowInvalidationsAffectFacts(invalidations: readonly FlowFactInvalidations[]): boolean {
    return invalidations.some((item) => item.bindings.size > 0
      || [...item.members.values()].some((paths) => paths.size > 0));
  }

  private deduplicateDiagnostics(firstStart: number, secondStart: number): void {
    const repeated = this.diagnostics.splice(secondStart);
    const seen = new Set(this.diagnostics.slice(firstStart).map((item) =>
      `${item.code}\u0000${item.message}\u0000${item.span.start}\u0000${item.span.end}`));
    for (const item of repeated) {
      const key = `${item.code}\u0000${item.message}\u0000${item.span.start}\u0000${item.span.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.diagnostics.push(item);
    }
  }

  private clearCachedFlowTypes(statements: readonly Statement[]): void {
    const first = statements[0];
    const last = statements.at(-1);
    if (!first || !last) return;
    this.clearCachedFlowTypesInSpan({ start: first.span.start, end: last.span.end });
  }

  private clearCachedFlowTypesInSpan(sourceSpan: Span): void {
    const insideBody = (key: string): boolean => {
      const separator = key.indexOf(":");
      if (separator < 0) return false;
      const start = Number(key.slice(0, separator));
      const end = Number(key.slice(separator + 1));
      return start >= sourceSpan.start && end <= sourceSpan.end;
    };
    for (const key of this.inferredExpressionTypes.keys()) {
      if (insideBody(key)) this.inferredExpressionTypes.delete(key);
    }
    for (const key of this.logicalConditionNarrowings.keys()) {
      if (insideBody(key)) this.logicalConditionNarrowings.delete(key);
    }
    // Runtime narrowing guards recorded by the first pass are re-derived by
    // the reanalysis. A guard kept from the first pass while the second pass
    // no longer proves its fact would throw NarrowingError on later loop
    // iterations of perfectly legal code (the fact holds on iteration one,
    // the back edge invalidates it, and the stale guard still expects it).
    for (const key of this.runtimeNarrowings.keys()) {
      if (insideBody(key)) this.runtimeNarrowings.delete(key);
    }
  }

  private flowSnapshotAfterInvalidations(
    baseline: FlowFactsSnapshot,
    invalidations: readonly FlowFactInvalidations[],
  ): FlowFactsSnapshot {
    this.restoreFlowFacts(baseline);
    this.applyFlowInvalidations(invalidations);
    const result = this.snapshotFlowFacts();
    this.restoreFlowFacts(baseline);
    return result;
  }

  private visibleBindings(): ReadonlyMap<string, Binding> {
    const visible = new Map<string, Binding>();
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      for (const [name, binding] of this.scopes[index]!) {
        if (!visible.has(name)) visible.set(name, binding);
      }
    }
    return visible;
  }

  private narrowingsForVisibleBindings(visible: ReadonlyMap<string, Binding>): ReadonlyMap<string, ValueType> {
    const narrowed = new Map<string, ValueType>();
    const roots = new Set<string>();
    for (const [name, original] of visible) {
      roots.add(`${original.span.start}:${name}`);
      const current = this.lookup(name);
      if (current?.narrowingFrame === this.flowFrameDepth
        && current.span.start === original.span.start
        && current.span.end === original.span.end) narrowed.set(name, current.type);
    }
    for (let index = this.memberNarrowings.length - 1; index >= 0; index -= 1) {
      for (const [path, fact] of this.memberNarrowings[index]!) {
        if (fact.frame !== this.flowFrameDepth || narrowed.has(`${memberNarrowingPrefix}${path}`)) continue;
        if ([...roots].some((root) => path === root || path.startsWith(`${root}.`))) {
          narrowed.set(`${memberNarrowingPrefix}${path}`, fact.type);
        }
      }
    }
    return narrowed;
  }

  private narrowingsInSnapshot(
    snapshot: FlowFactsSnapshot,
    visible: ReadonlyMap<string, Binding>,
    restore: FlowFactsSnapshot,
  ): ReadonlyMap<string, ValueType> {
    this.restoreFlowFacts(snapshot);
    const narrowed = this.narrowingsForVisibleBindings(visible);
    this.restoreFlowFacts(restore);
    return narrowed;
  }

  private commonNarrowings(branches: readonly ReadonlyMap<string, ValueType>[]): ReadonlyMap<string, ValueType> {
    const first = branches[0];
    if (!first) return new Map();
    const common = new Map<string, ValueType>();
    for (const [key, type] of first) {
      if (branches.slice(1).every((branch) => {
        const candidate = branch.get(key);
        return candidate !== undefined && sameType(candidate, type);
      })) common.set(key, type);
    }
    return common;
  }

  private applyFlowInvalidations(branches: readonly FlowFactInvalidations[], includeBaseline = true): void {
    if (branches.length > 0) {
      const bindings = new Set(branches.flatMap((branch) => [...branch.storageTypes.keys()]));
      for (const binding of bindings) {
        const candidates = branches.map((branch) => branch.storageTypes.get(binding) ?? binding.storageType);
        if (includeBaseline) candidates.unshift(binding.storageType);
        binding.storageType = candidates.reduce((merged, candidate) => mergeTypes(merged, candidate));
        if (binding.narrowingFrame === null) binding.type = binding.storageType;
      }
    }
    for (const branch of branches) {
      for (const binding of branch.bindings) {
        binding.type = binding.storageType;
        binding.narrowingFrame = null;
        binding.assignedFact = false;
      }
      for (const [index, paths] of branch.members) {
        const scope = this.memberNarrowings[index];
        if (!scope) continue;
        for (const path of paths) scope.delete(path);
      }
    }
  }

  protected enterScope(): void {
    this.scopes.push(new Map());
    this.memberNarrowings.push(new Map());
    this.pendingScopeDeclarations.push(new Map());
  }

  protected exitScope(): void {
    this.scopes.pop();
    this.memberNarrowings.pop();
    this.pendingScopeDeclarations.pop();
  }
}
