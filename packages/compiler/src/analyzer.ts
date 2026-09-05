import { blockContainsDirectAwait } from "./ast.ts";
import type {
  ArrowFunctionExpression,
  AssignmentStatement,
  DetachStatement,
  BindingPattern,
  ClassDeclaration,
  ClassDisposeBlock,
  ClassIterateBlock,
  Expression,
  ExternClassDeclaration,
  ExternFunctionDeclaration,
  ExternConstantDeclaration,
  ForStatement,
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
import { isPermanentNamespaceName, type CoreVocabularyName, type PermanentNamespaceName } from "./core-vocabulary.ts";
import { advisory, diagnostic, mechanicalEdits, mechanicalFix, recoveredDiagnostic, type Advisory, type Diagnostic, type DiagnosticEdit, type DiagnosticFix } from "./diagnostic.ts";
import { VELAR_HOST_ERROR_NAMES, VELAR_HOST_ERROR_PATH_NAMES } from "./error-runtime.ts";
import type { CompilerAnalysisExtension, RetiredNamespace } from "./extension.ts";
import { collectionMemberGuidance, removedGlobalFunctionGuidance, stringMemberGuidance, REST_PARAMETER_ELEMENT_TYPE_MESSAGE, type CollectionKind } from "./language-guidance.ts";
import { bindingNameRestriction } from "./source-names.ts";
import { span, spanIdentity, type Span } from "./source.ts";
import {
  analysisTypeIdentity,
  anyType,
  binaryStorageKind,
  boolType,
  boundGrants,
  boundaryUnknownType,
  collectGenericBoundViolations,
  collectTypeArgumentBoundViolations,
  describeType,
  genericApplicationType,
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
  typeContainsAnyOutput,
  typeContainsParameter,
  typeContainsRuntimeTypeCheck,
  unifyTypeParameters,
  unionOf,
  unknownType,
  type EnumInfo,
  type BinaryStorageKind,
  type ExtensionValueType,
  type GenericApplication,
  type GenericBoundViolation,
  type GenericTypeInfo,
  type TypeEnvironment,
  type TypeParameterBound,
  type ValueType,
} from "./types.ts";

/**
 * The mutable binding an assignment writes into, for the one refusal whose fix
 * lives on the declaration line rather than the assignment line. See
 * `enumSingletonCellGuidance`.
 */
interface MutableCellTarget {
  readonly name: string;
  readonly keyword: "let" | "state";
}

interface Binding {
  readonly mutable: boolean;
  /** 由普通 `const` 变量声明拥有的一次性值副本；参数、导入和响应式绑定不具备。 */
  stableOptionalCopy?: boolean;
  type: ValueType;
  declaredType: ValueType;
  storageType: ValueType;
  readonly storageBinding?: Binding;
  readonly span: Span;
  narrowingFrame: number | null;
  /**
   * The scope depth this binding was created at. A flow snapshot only visits
   * bindings whose facts have actually moved, and this is how the set of those
   * is emptied again when the scope holding them exits.
   */
  readonly flowScope?: number;
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
  /**
   * D51 rule 101: the binding holds — or carries — a resource this scope owns
   * and releases at its exit. `handle` is the `using` name to blame, and
   * `depth` is the scope nesting level that releases it, so a store into any
   * shallower binding is a store into something that outlives the release.
   */
  ownedResource?: { readonly handle: string; readonly depth: number };
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

/** The four flow-analysis fields of a binding, as of one moment. */
interface FlowFactState {
  readonly type: ValueType;
  readonly storageType: ValueType;
  readonly frame: number | null;
  readonly assigned: boolean;
}

interface FlowFactsSnapshot {
  readonly bindings: ReadonlyMap<Binding, FlowFactState>;
  readonly members: readonly ReadonlyMap<string, MemberNarrowing>[];
}

interface FlowFactInvalidations {
  readonly bindings: ReadonlySet<Binding>;
  readonly members: ReadonlyMap<number, ReadonlySet<string>>;
  readonly storageTypes: ReadonlyMap<Binding, ValueType>;
}

/**
 * The scope chain as it stood at one point, read back on demand. Flattening
 * every live scope into a fresh Map made each block, loop and match cost
 * O(names in the module), which is most of what made whole-module analysis
 * quadratic in module size. The depth is enough: scopes are a stack, so the
 * scopes below a construct's own are exactly the ones that were there, and
 * nothing adds a name to them while the construct is being analyzed.
 */
type VisibleScopeDepth = number;

/**
 * How many back-edge passes may be running at once. One is what a single-level
 * loop needs, and three covers a loop nest three deep — the deepest anyone
 * writes on purpose — with every level analyzed exactly as before. Past that
 * the count stops doubling per level: fourteen levels went from 3.2 seconds to
 * 0.2, and seventeen from 30 seconds to 0.4.
 */
const maximumLoopReanalysisDepth = 3;

/** What a loop's back-edge pass answered: its context, or that the budget widened the exit. */
interface LoopBackEdgeOutcome {
  readonly repeated: LoopFlowContext | null;
  /** True when the pass was skipped, so the loop's exit may keep no unconfirmed fact. */
  readonly widened: boolean;
}

interface LoopFlowContext {
  readonly baseline: FlowFactsSnapshot;
  /** The scopes visible outside the loop, so a break's facts can be stated in their terms. */
  readonly visible: VisibleScopeDepth;
  readonly carried: FlowFactInvalidations[];
  readonly backEdges: FlowFactInvalidations[];
  /** FLW-N6: the facts holding at each `break`, one entry per break edge. */
  readonly breakFacts: ReadonlyMap<string, ValueType>[];
  sawBreak: boolean;
}

interface ReturnContext {
  readonly expected: ValueType;
  readonly inferredReturns: ValueType[] | null;
  /**
   * D58 correction 2: the results a body returns while an annotation is
   * written, collected only where that annotation is the `-> null` rule 139
   * refuses. `inferredReturns` is null in that case — the declared result is
   * the contract — so the deletion's precondition needs its own observation.
   */
  readonly observedReturns: ValueType[] | null;
  readonly declarationKind: string;
  /**
   * D85 rule 209: a `return []` that VEL4039 already reported contributes
   * `invalidType` so no caller reports the same hole again. That makes the
   * collected result invalid, which is otherwise a convergence failure — but
   * here the author has already been told exactly what to write, so VEL4025
   * would be the second report of one mistake.
   */
  unsettledResult?: boolean;
  /**
   * D85 rule 209: the result keys of the local functions this body returns the
   * result of. A callee's hole can be reported after its caller is analyzed,
   * so a call contributes a cause here and the whole module decides.
   */
  resultHoleCauses?: Set<string>;
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
  readonly resultAnnotationSpan?: FunctionDeclaration["resultAnnotationSpan"];
  readonly signatureSpan: FunctionDeclaration["signatureSpan"];
  readonly body: FunctionDeclaration["body"];
  readonly span: Span;
  readonly asynchronous?: boolean;
  // Optional because only a module-level declaration can carry it. A method
  // never does — which is why D90 R12 goes through `recordExportedAny` rather
  // than reading this flag: a public member of a class this module publishes
  // leaves the module just as an exported `def` does, with no keyword of its
  // own.
  readonly exported?: boolean;
  // Class members only. A `private` member is module-internal, and R12 leaves
  // module-internal `any` legal.
  readonly private?: boolean;
}

/**
 * D90 R12: the class and record names a consumer can read a value *out of*
 * this type, collected into two frontiers so `exportReachableClasses` can walk
 * a record's fields without recursing through a cyclic record here.
 *
 * It visits output positions for the reason `typeContainsAnyOutput` (types.ts)
 * does: an input position accepts a value *from* the consumer, so a class
 * named there is one the consumer already had. The one deliberate difference
 * is an extension type's `properties`, documented at that case.
 */
function collectOutputTypeNames(type: ValueType, classes: string[], records: string[]): void {
  switch (type.kind) {
    case "class":
    case "classConstructor":
      classes.push(type.name);
      return;
    case "optional":
      collectOutputTypeNames(type.inner, classes, records);
      return;
    case "list":
    case "set":
      collectOutputTypeNames(type.element, classes, records);
      return;
    case "map":
      collectOutputTypeNames(type.key, classes, records);
      collectOutputTypeNames(type.value, classes, records);
      return;
    case "record":
    case "promise":
    case "runtimeType":
      collectOutputTypeNames(type.value, classes, records);
      return;
    case "object":
      for (const field of type.fields.values()) collectOutputTypeNames(field, classes, records);
      return;
    case "named":
    case "typeObject":
      // A `named` may still denote a class before resolveNamedClasses runs, so
      // the name joins both frontiers; the one that does not match a
      // declaration simply finds nothing.
      classes.push(type.name);
      records.push(type.name);
      for (const argument of type.kind === "named" ? type.application?.arguments ?? [] : []) {
        collectOutputTypeNames(argument, classes, records);
      }
      return;
    case "extension":
      // An extension family's `properties` are its *named parameters* — a Web
      // component's props are supplied by whoever renders it — so they are the
      // `function` case's `parameters` under another spelling, and are skipped
      // for the same reason. Walking them made `export component Panel(inner:
      // Inner)` report `Inner`'s inferred member while `export def take(box:
      // Inner)` stayed silent: one question, two answers. `arguments` carry
      // the family's payload — a component's exposed Handle, a route input's
      // validated value, a provider's result — which a consumer does read out.
      for (const argument of type.arguments) collectOutputTypeNames(argument, classes, records);
      return;
    case "function":
    case "action":
    case "intrinsic":
      collectOutputTypeNames(type.result, classes, records);
      return;
    case "union":
      for (const member of type.members) collectOutputTypeNames(member, classes, records);
      return;
    default:
  }
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
  /**
   * D68 rule 177: the collection the class's own `@iterate:` block answers
   * with. Absent when the class declares no block — a derived class reads its
   * base's answer instead of copying it, because overriding replaces rather
   * than composes.
   */
  readonly iterate?: ValueType;
  /**
   * D90 R18: the element the class's asynchronous `@iterate:` form answers
   * with. The block is the declared spelling of the pull contract `async for`
   * consumes — pulled once per element, it may await, it answers `T?`, and
   * null is exhaustion. A class declares one form or the other; the answer's
   * shape (a collection against `T?`) is what tells them apart.
   */
  readonly iterateAsync?: ValueType;
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

export type CollectionRuntimeKind = "list" | "map" | "set" | "record";

export type CollectionOperation = "listGet" | "mapGet" | "recordGet" | "slice" | "listAppend" | "listExtend" | "listInsert" | "listRemove" | "listPop" | "listClear" | "listCopy" | "listHas" | "listCount" | "listIndex" | "listFind" | "listSome" | "listEvery" | "listMap" | "listFilter" | "listFlatMap" | "listReduce" | "listJoin" | "listSorted" | "listReversed" | "listSum" | "listMin" | "listMax" | "setAdd" | "setUpdate" | "setHas" | "setRemove" | "setClear" | "setValues" | "setCopy" | "setUnion" | "setIntersection" | "setDifference" | "mapSet" | "mapGetOrSet" | "mapGetOrSetWith" | "mapUpdate" | "mapHas" | "mapRemove" | "mapClear" | "mapIterator" | "mapKeys" | "mapValues" | "mapEntries" | "mapCopy" | "recordSet" | "recordHas" | "recordRemove" | "recordClear" | "recordKeys" | "recordValues" | "recordEntries" | "recordCopy";

export type PrimitiveOperation = "stringTrim" | "stringUpper" | "stringLower" | "stringSlice" | "stringChar" | "stringHas" | "stringIndex" | "stringCount" | "stringStartsWith" | "stringEndsWith" | "stringSplit" | "stringReplace" | "stringReplaceAll" | "stringPadStart" | "stringPadEnd" | "stringRepeat" | "stringIsBlank" | "numberAbs" | "numberRound" | "numberFloor" | "numberCeil" | "numberSign" | "numberTrunc" | "numberToFixed" | "numberIsInteger" | "numberIsNaN" | "numberIsFinite";

const listCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "listGet"], ["slice", "slice"], ["append", "listAppend"], ["extend", "listExtend"],
  ["insert", "listInsert"], ["remove", "listRemove"], ["pop", "listPop"],
  ["clear", "listClear"], ["copy", "listCopy"], ["has", "listHas"], ["count", "listCount"],
  ["index", "listIndex"], ["find", "listFind"], ["some", "listSome"], ["every", "listEvery"],
  ["map", "listMap"], ["filter", "listFilter"], ["flatMap", "listFlatMap"], ["reduce", "listReduce"], ["join", "listJoin"],
  ["sorted", "listSorted"], ["reversed", "listReversed"], ["sum", "listSum"], ["min", "listMin"], ["max", "listMax"],
]);
const mapCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "mapGet"], ["set", "mapSet"], ["getOrSet", "mapGetOrSet"], ["getOrSetWith", "mapGetOrSetWith"], ["update", "mapUpdate"], ["has", "mapHas"],
  ["remove", "mapRemove"], ["clear", "mapClear"], ["copy", "mapCopy"], ["iterator", "mapIterator"],
  ["keys", "mapKeys"], ["values", "mapValues"], ["entries", "mapEntries"],
]);
const setCollectionOperations = new Map<string, CollectionOperation>([
  ["add", "setAdd"], ["update", "setUpdate"], ["has", "setHas"], ["remove", "setRemove"],
  ["clear", "setClear"], ["copy", "setCopy"], ["values", "setValues"],
  ["union", "setUnion"], ["intersection", "setIntersection"], ["difference", "setDifference"],
]);
const recordCollectionOperations = new Map<string, CollectionOperation>([
  ["get", "recordGet"], ["set", "recordSet"], ["has", "recordHas"], ["remove", "recordRemove"],
  ["clear", "recordClear"], ["copy", "recordCopy"], ["keys", "recordKeys"], ["values", "recordValues"], ["entries", "recordEntries"],
]);
const stringPrimitiveOperations = new Map<string, PrimitiveOperation>([
  ["trim", "stringTrim"], ["upper", "stringUpper"], ["lower", "stringLower"], ["slice", "stringSlice"],
  ["char", "stringChar"], ["has", "stringHas"], ["index", "stringIndex"], ["count", "stringCount"], ["startsWith", "stringStartsWith"], ["endsWith", "stringEndsWith"],
  ["split", "stringSplit"], ["replace", "stringReplace"], ["replaceAll", "stringReplaceAll"],
  ["padStart", "stringPadStart"], ["padEnd", "stringPadEnd"], ["repeat", "stringRepeat"], ["isBlank", "stringIsBlank"],
]);
const numberPrimitiveOperations = new Map<string, PrimitiveOperation>([
  ["abs", "numberAbs"], ["round", "numberRound"], ["floor", "numberFloor"], ["ceil", "numberCeil"], ["sign", "numberSign"], ["trunc", "numberTrunc"], ["toFixed", "numberToFixed"],
  ["isInteger", "numberIsInteger"], ["isNaN", "numberIsNaN"], ["isFinite", "numberIsFinite"],
]);

// D29 item 14: compiler-owned value/collection methods that return a fresh
// value without mutating their receiver. An expression statement that calls
// one of these and drops the result is always a bug. Mutate-and-return
// operations (pop/remove) and null-returning mutators stay legal,
// and user-function purity is deliberately never analyzed (D26 retired that).
const discardedPureCollectionOperations = new Set<CollectionOperation>([
  "listGet", "mapGet", "recordGet", "slice", "listCopy", "listCount", "listIndex", "listFind", "listSome", "listEvery",
  "listMap", "listFilter", "listFlatMap", "listReduce", "listJoin", "listSorted", "listReversed",
  "listSum", "listMin", "listMax", "setCopy", "setUnion", "setIntersection", "setDifference", "mapCopy", "recordCopy",
  "listHas", "mapHas", "setHas", "recordHas", "mapIterator", "mapKeys", "recordKeys", "mapValues", "setValues", "recordValues", "mapEntries", "recordEntries",
]);
const discardedPurePrimitiveOperations = new Set<PrimitiveOperation>([
  "stringTrim", "stringUpper", "stringLower", "stringSlice", "stringChar",
  "stringStartsWith", "stringEndsWith", "stringReplace", "stringReplaceAll",
  "stringPadStart", "stringPadEnd", "stringRepeat", "stringSplit", "stringIsBlank",
  "numberAbs", "numberRound", "numberFloor", "numberCeil", "numberSign", "numberTrunc", "numberToFixed",
  "numberIsInteger", "numberIsNaN", "numberIsFinite",
]);
const CORE_LIST_METHOD_NAMES = Object.freeze([
  "get", "slice", "append", "extend", "insert", "remove", "pop", "clear", "copy", "has", "count", "index",
  "find", "some", "every", "map", "flatMap", "filter", "reduce", "join", "sorted", "reversed", "sum", "min", "max",
] as const);
const CORE_MAP_METHOD_NAMES = Object.freeze([
  "get", "set", "getOrSet", "getOrSetWith", "update", "has", "remove", "clear", "copy", "iterator", "keys", "values", "entries",
] as const);
const CORE_SET_METHOD_NAMES = Object.freeze([
  "add", "update", "has", "remove", "clear", "copy", "values", "union", "intersection", "difference",
] as const);
const CORE_RECORD_METHOD_NAMES = Object.freeze([
  "get", "set", "has", "remove", "clear", "copy", "keys", "values", "entries",
] as const);
export interface FormReadField {
  readonly name: string;
  readonly kind: "string" | "number" | "bool" | "enum" | "strings";
  readonly optional: boolean;
  readonly enumValues?: readonly string[];
}

export interface RecordTypeField {
  readonly name: string;
  readonly type: ValueType;
}

export interface RecordFromHint {
  readonly target: string;
  readonly fields: readonly {
    readonly name: string;
    readonly optional: boolean;
  }[];
}

/** Concrete `Target.mapFrom(source, transform)` calls lowered as mapped record projections. */
export type RecordMapFromHint = RecordFromHint;

export interface LoweringHints {
  readonly collectionCalls: ReadonlyMap<number, CollectionOperation>;
  readonly collectionSizes: ReadonlyMap<number, CollectionRuntimeKind>;
  readonly collectionIndexes: ReadonlyMap<string, "list" | "record">;
  readonly collectionMemberships: ReadonlyMap<string, CollectionRuntimeKind | "string">;
  readonly collectionIterations: ReadonlyMap<number, CollectionRuntimeKind | "string" | "binary">;
  /** Concrete `Target.from(source, overrides?)` calls lowered as exact record projections. */
  readonly recordFromCalls: ReadonlyMap<string, RecordFromHint>;
  /** Concrete `Target.mapFrom(source, transform)` calls lowered as mapped record projections. */
  readonly recordMapFromCalls: ReadonlyMap<string, RecordMapFromHint>;
  /** Binary members and indexes lower directly against their typed-array storage. */
  readonly binaryCalls: ReadonlyMap<number, "bufferCopy" | "bufferSlice" | "bufferToBytes" | "bufferValues">;
  readonly binarySizes: ReadonlyMap<number, BinaryStorageKind>;
  readonly binaryIndexes: ReadonlyMap<string, BinaryStorageKind>;
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
  /**
   * D55 rule 121: module-scope names bound to a generic record's instantiation
   * factory, local or imported. A generic name is *not* a Type object — it
   * answers `.of(...)`, never `.is(...)` — so the emitter has to tell the two
   * apart before it writes either into the output.
   */
  readonly genericTypeNames: ReadonlySet<string>;
  /** Complete inherited-plus-local record fields for each `type` declaration, keyed by declaration start. */
  readonly typeDeclarationFields: ReadonlyMap<number, readonly RecordTypeField[]>;
  readonly optionalMembers: ReadonlySet<string>;
  readonly optionalCalls: ReadonlySet<string>;
  readonly optionalIndexes: ReadonlySet<string>;
  readonly optionalCallees: ReadonlySet<string>;
  readonly truthConditions: ReadonlySet<string>;
  readonly normalizedNullResults: ReadonlySet<string>;
  readonly normalizedPromiseValues: ReadonlySet<string>;
  readonly asyncResolvedValues: ReadonlySet<string>;
  readonly asyncForStatements: ReadonlySet<number>;
  /** Direct, unshadowed `for name in range(...)` loops that can use a counted loop. */
  readonly nativeRangeForStatements: ReadonlySet<number>;
  readonly normalizedUndefinedExpressions: ReadonlySet<string>;
  readonly instanceFieldReads: ReadonlySet<string>;
  readonly errorCodeReads: ReadonlySet<string>;
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
  readonly builtinValueReferences: ReadonlyMap<string, PermanentNamespaceName | "range">;
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
   * Class declarations whose `@dispose:` must forward to an inherited one
   * (D51 rule 102), keyed by the declaration's span identity. The value is the
   * inherited release's async-ness, which decides whether the forward awaits.
   */
  readonly classDisposeChains: ReadonlyMap<string, "sync" | "async">;
  /**
   * D68 rule 177: span identities of the expressions a consumer iterates
   * through a class's `@iterate:` contract — the eight sites that consume an
   * iterable. The emitter projects each one through the contract member, so
   * what the runtime receives is the List, Set, Map, or Record the block
   * returns and every consumer keeps the lowering it already had.
   */
  readonly iterationContracts: ReadonlySet<string>;
  /**
   * D90 R18: start offsets of `async for` statements whose source's class
   * declares the asynchronous `@iterate:` form. The emitter pulls these
   * through the declared member instead of capturing a structural `next`.
   */
  readonly asyncIterationStatements: ReadonlySet<number>;
  /**
   * D90 R18: span identities of the `@iterate:` blocks that are the
   * asynchronous pull form, keyed by their keyword span, so the emitter lands
   * each one as an async method under its own key.
   */
  readonly asyncIterateBlocks: ReadonlySet<string>;
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
  /** The module source, used only to withhold mechanical rewrites that would erase comments. */
  readonly sourceText?: string;
  readonly imports?: ReadonlyMap<string, ValueType>;
  readonly dynamicImports?: ReadonlyMap<string, ValueType>;
  readonly reactiveImports?: ReadonlyMap<string, "state">;
  readonly namedTypes?: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  readonly namedTypeReadonlyFields?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly namedTypeIdentities?: ReadonlyMap<string, string>;
  /** Direct record inheritance edges by local name or canonical identity. */
  readonly namedTypeBases?: ReadonlyMap<string, ValueType>;
  /** D55: imported generic record declarations, by the name this module writes. */
  readonly genericTypes?: ReadonlyMap<string, GenericTypeInfo>;
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
  /** 当前模块是否是一次程序编译的执行入口；普通依赖仍检查 `@main`，但不把它当作模块初始化。 */
  readonly executeMain?: boolean;
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

/**
 * A deferred body — a module-local `def` or an arrow bound to a module-local
 * name — with the imported bindings it reads and the local functions it calls.
 * Calls are held as bindings rather than as resolved frames because a `def` is
 * hoisted: `const x = pull()` may be analyzed before `def pull()` is.
 */
interface DeferredReadFrame {
  readonly reads: InitializationImportRead[];
  readonly calls: Binding[];
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

/** The furthest a suggestion may be from what was written. */
const nearestNameLimit = 2;

/**
 * Edit distance, abandoned as soon as it is known to exceed `nearestNameLimit`.
 * Only cells within that many steps of the diagonal can hold a value inside the
 * limit, so each row is a fixed-width band rather than the whole right operand,
 * and a row whose every cell is already over the limit ends the walk.
 */
function boundedEditDistance(left: string, right: string): number {
  const over = nearestNameLimit + 1;
  if (Math.abs(left.length - right.length) > nearestNameLimit) return over;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1).fill(over);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const from = Math.max(1, leftIndex - nearestNameLimit);
    const to = Math.min(right.length, leftIndex + nearestNameLimit);
    current[from - 1] = from === 1 ? leftIndex : over;
    let rowBest = current[from - 1]!;
    for (let rightIndex = from; rightIndex <= to; rightIndex += 1) {
      const cell = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      current[rightIndex] = cell;
      if (cell < rowBest) rowBest = cell;
    }
    if (to < right.length) current[to + 1] = over;
    if (rowBest > nearestNameLimit) return over;
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[right.length]!;
}

/** Returns the sole nearest spelling within two edits, never an ambiguous guess. */
function uniqueNearestName(requested: string, candidates: Iterable<string>): string | null {
  // A Set argument is already deduplicated; copying it again cost one full
  // rebuild per unresolved name for nothing.
  const unique = candidates instanceof Set ? (candidates as ReadonlySet<string>) : new Set(candidates);
  let best: string | null = null;
  let bestDistance = nearestNameLimit + 1;
  let tied = false;
  for (const candidate of unique) {
    if (candidate === requested || Math.abs(candidate.length - requested.length) > nearestNameLimit) continue;
    const candidateDistance = boundedEditDistance(requested, candidate);
    if (candidateDistance < bestDistance) {
      best = candidate;
      bestDistance = candidateDistance;
      tied = false;
    } else if (candidateDistance === bestDistance) {
      tied = true;
    }
  }
  return bestDistance <= nearestNameLimit && !tied ? best : null;
}

/**
 * The roster a "did you mean" reads. It used to be rebuilt — core vocabulary,
 * extension globals, imports, and every name in every live scope — and then run
 * through a full edit-distance pass, once per unresolved name, which made a
 * module of typos quadratic in its own size. The roster is now maintained as
 * scopes come and go, and each name is filed under the strings left by deleting
 * up to two of its characters: two spellings within two edits always share one
 * of those, so a query reads a few buckets instead of the whole roster.
 */
class NearestNameRoster {
  private readonly counts = new Map<string, number>();
  /** Filled on the first question asked of the roster; a module with no typo never pays for it. */
  private buckets: Map<string, Set<string>> | null = null;

  add(name: string): void {
    const seen = this.counts.get(name) ?? 0;
    this.counts.set(name, seen + 1);
    if (seen === 0) this.file(name);
  }

  remove(name: string): void {
    const seen = this.counts.get(name) ?? 0;
    if (seen === 0) return;
    if (seen > 1) {
      this.counts.set(name, seen - 1);
      return;
    }
    this.counts.delete(name);
    if (!this.buckets) return;
    for (const key of deletionKeys(name)) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      bucket.delete(name);
      if (bucket.size === 0) this.buckets.delete(key);
    }
  }

  nearest(requested: string): string | null {
    if (!this.buckets) {
      this.buckets = new Map();
      for (const name of this.counts.keys()) this.file(name);
    }
    const candidates = new Set<string>();
    for (const key of deletionKeys(requested)) {
      for (const candidate of this.buckets.get(key) ?? []) candidates.add(candidate);
    }
    return uniqueNearestName(requested, candidates);
  }

  private file(name: string): void {
    if (!this.buckets) return;
    for (const key of deletionKeys(name)) {
      const bucket = this.buckets.get(key);
      if (bucket) bucket.add(name);
      else this.buckets.set(key, new Set([name]));
    }
  }
}

/** `name` with up to `nearestNameLimit` characters deleted, the shared key of any two near spellings. */
function deletionKeys(name: string): readonly string[] {
  const keys = [name];
  for (let first = 0; first < name.length; first += 1) {
    const once = name.slice(0, first) + name.slice(first + 1);
    keys.push(once);
    for (let second = first; second < once.length; second += 1) {
      keys.push(once.slice(0, second) + once.slice(second + 1));
    }
  }
  return keys;
}

const corePrimitiveNames = new Set(["string", "number", "bool", "null", "unknown", "Duration"]);
// D114 ③ retired `Function` as a type *spelling*, but it stays a recognized
// reserved type name: the parser has to know it to report the retirement, and
// this roster is what tells a wrong type-parameter bound apart from an unknown
// one, so `<T: Function>` still says which kind of mistake it is.
const builtinTypeNames = new Set(["string", "number", "bool", "null", "unknown", "any", "List", "Set", "Map", "Record", "Promise", "Function", "Type", "Duration"]);

/**
 * The declaration positions that also introduce a *type* name, named for the
 * one sentence that refuses a built-in spelling in any of them.
 */
type BuiltinTypeNamePosition = "type" | "class" | "enum" | "imported name" | "import alias";

/**
 * D72 rule 186 over the Core roster, and charter §5 and §7: the built-in type
 * names are reserved. A user declaration spelled with one used to be accepted
 * where it was written and then lose at every use — `type Duration:` compiled,
 * and `const d: Duration = {label: "a"}` was told it could not assign to a type
 * the author had just declared. Half the roster lost the other way and shadowed
 * the built-in for bare uses only, so `type List:` left `List` meaning the user
 * record and `List<string>` on the next line still meaning the built-in. D51
 * rule 109 puts the refusal at the declaration, the only place a rename is
 * cheap.
 *
 * Two refusals already say this sentence about smaller rosters:
 * `rejectReservedTypeNames` for the three type-parameter bounds (D51 rule 109,
 * VEL4021) and `rejectWebOwnedTypeNames` in packages/web/src/analyzer.ts for
 * the Web type names (VEL5065). This is the same sentence over Core's own
 * roster, so all three read alike. Before it, only `number`, `Set`, `Map` and
 * `Promise` were refused, and only incidentally — they are *also* reserved Core
 * bindings — so one rule reached four of fourteen names by accident.
 *
 * Unlike its two siblings this is asked from `declareBinding` rather than from
 * a pass over `program.body`, because those four names carry both answers and
 * only the declaration site can decide which sentence the author earns: the
 * reserved-binding report and this one are the two arms of one `if`, so a name
 * that is a built-in type and a reserved Core binding is still one mistake with
 * one report. The roster is `builtinTypeNames`, which `isDeclaredTypeName`
 * already reads, so a built-in added there is covered here without a new
 * branch.
 */
function builtinTypeNameDeclarationMessage(name: string, position: BuiltinTypeNamePosition): string {
  const article = /^[aeiou]/iu.test(position) ? "an" : "a";
  return `'${name}' is a Core type name, so it cannot also name ${article} ${position}`
    + "; every use of it resolves to the built-in. Rename this declaration";
}

/**
 * Which reserved-type-name question an import specifier asks. A standard-module
 * import of the name under itself *is* the built-in surface — `velar/look`
 * republishes `Duration`, and the tour imports it that way — so only a binding
 * that would make the name mean something else is refused. That is the carve-out
 * D72 rule 186 already makes for `import {Color} from "velar/look"`; a module
 * scope import and a block-scoped one ask it here rather than each deciding it.
 */
function importTypeNamePosition(
  statement: Extract<Statement, { kind: "ImportDeclaration" }>,
  specifier: { readonly imported: string; readonly local: string },
): BuiltinTypeNamePosition | undefined {
  if (specifier.local !== specifier.imported) return "import alias";
  return statement.source.startsWith("velar/") ? undefined : "imported name";
}

/**
 * D64 rule 163: the scope in this sentence is load-bearing, and it is also why
 * the sentence is written once instead of in each of the four declaration
 * positions that report it. A *declaration* carries `async`, so its result
 * annotation names the resolved value; a function *type* carries no `async`
 * and describes the value the call hands back, which is a Promise. Stated
 * without "in a declaration" this reads as a rule about the whole language,
 * and an author who obeys it in a function type is refused by VEL4001 for
 * doing what it said — `asyncResultSpellingGuidance` is the other half.
 */
const asyncResultAnnotationMessage =
  "An async result annotation in a declaration names the resolved value; write '-> T', not '-> Promise<T>'";
const memberNarrowingPrefix = "\u0000member:";
/**
 * The emitted member behind a class's `@dispose:` block. The key is not a
 * source-shaped identifier, so no author member can collide with it:
 * `@dispose` is compiler-owned, not part of the author's namespace.
 */
export const disposeMemberKey = "__velar:dispose";
/**
 * The emitted member behind a class's `@iterate:` block, under the same kind of
 * key and for the same reason: `@iterate` is compiler-owned, so no author
 * member can answer it by accident and no author call can reach it.
 */
export const iterateMemberKey = "__velar:iterate";
/**
 * The emitted member behind the asynchronous `@iterate:` form (D90 R18). It is
 * a separate key because the two forms answer different questions — the
 * synchronous member returns the finished collection once, this one is an
 * async method `async for` pulls once per element — so no lowering can confuse
 * one for the other.
 */
export const iterateAsyncMemberKey = "__velar:iterateAsync";

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
  // D52 rule 116: `Math` is a permanent namespace of its own now, so it
  // resolves as a value and never reaches this table.
  ["Date", "Use velar/time instead of the Date global"],
  ["Boolean", "Use an explicit boolean comparison; VelarScript does not expose JavaScript truthiness conversion"],
  ["Number", "Use number(text), typed forms, or validated data instead of JavaScript Number coercion"],
  ["String", "Use str(value) instead of the JavaScript String global"],
  // COL-U8: Set() and Map() are real constructors, so the List/Array
  // asymmetry is a trap worth naming: a List is built with a literal.
  ["List", "Lists are created with a '[]' literal (or [...values] to copy); 'List<T>' is a type name, not a constructor"],
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
  // — `zip` even earned a "did you mean 'Map'?". `enumerate` has a spelling
  // that needs no import, so the loop is named first; `zip` has none, so its
  // guidance is the import that makes it exist.
  ["enumerate", "Use the two-slot loop — 'for value, index in values:' — which binds the value first; 'enumerate' is an import from \"velar/collections\" when you want the '{index, value}' List itself"],
  ["zip", "Import the builder — 'import {zip} from \"velar/collections\"' — it pairs two Lists as '{first, second}' up to the shorter length"],
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

/**
 * D90 (coherence): the foreign builtins — Python's and the host's — that a
 * model writes from prior knowledge. A "did you mean" is an edit-distance
 * guess over names this module can actually see, and on a foreign builtin it
 * is confidently wrong: `sum` earned `str`, `max` and `map` earned `Map`,
 * `dir` earned `str`. docs/ai-skill.md tells the model to do exactly what the
 * diagnostic says, so a wrong successor is worse than none.
 *
 * Every name that has a Vel answer is in `coreGlobalGuidance` above, which is
 * consulted first and short-circuits the guess on its own. This roster is the
 * floor under the rest: a foreign builtin with no successor reads as a bare
 * unknown name and stops there. It is deliberately a suppression rather than a
 * change to `uniqueNearestName`, whose threshold and roster serve the field-
 * name hints too.
 */
const foreignBuiltinNames: ReadonlySet<string> = new Set([
  // Python
  "sum", "min", "max", "sorted", "reversed", "any", "all", "isinstance", "input", "open",
  "filter", "map", "repr", "dir", "type", "id", "next", "iter", "format", "divmod", "pow",
  "bytes", "tuple", "frozenset", "globals", "locals", "vars", "hasattr", "getattr", "setattr",
  "callable", "issubclass", "abs", "round", "ord", "chr", "hex", "oct", "bin", "hash",
  // Node and browser hosts
  "setTimeout", "setInterval", "clearTimeout", "clearInterval", "structuredClone", "queueMicrotask",
  "URL", "URLSearchParams", "RegExp", "TextEncoder", "TextDecoder", "AbortController", "AbortSignal",
  "Symbol", "Proxy", "Reflect", "WeakMap", "WeakSet", "BigInt", "Intl", "globalThis",
  "process", "Buffer", "require", "__dirname", "__filename", "module", "exports", "global",
  "localStorage", "sessionStorage", "fetch", "document", "window", "navigator", "alert",
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
/**
 * A synchronous cursor returns an optional wrapper rather than `T?` directly.
 * The wrapper keeps exhaustion distinct from a legitimate `null` collection
 * value: `null` means there is no next item, while `{value: null}` is an item.
 */
const iteratorOf = (value: ValueType): ValueType => {
  const step: ValueType = {
    kind: "object",
    fields: new Map([["value", value]]),
    readonlyFields: new Set(["value"]),
  };
  return {
    kind: "object",
    fields: new Map([["next", {kind: "function", parameters: [], requiredParameters: 0, result: optionalOf(step)}]]),
    readonlyFields: new Set(["next"]),
  };
};
const jsonNamespaceType: ValueType = {
  kind: "object",
  fields: new Map([
    ["parse", namespaceFunction("json.parse", ["text", "target"], [stringType, unknownType], unknownType, 1)],
    ["tryParse", namespaceFunction("json.tryParse", ["text", "target", "fallback"], [stringType, unknownType, unknownType], unknownType, 1)],
    ["stringify", namespaceFunction("json.stringify", ["value", "pretty"], [unknownType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["stableStringify", namespaceFunction("json.stableStringify", ["value", "pretty"], [unknownType, { kind: "union", members: [boolType, numberType] }], stringType, 1)],
    ["clone", namespaceFunction("json.clone", ["value", "target"], [unknownType, unknownType], unknownType, 1)],
    ["isSerializable", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType }],
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
const coreVocabularyTypes: Record<CoreVocabularyName, ValueType> = {
  number: { kind: "function", parameterNames: ["text"], parameters: [stringType], requiredParameters: 1, result: optionalOf(numberType) },
  // D32 item 29: `str` is compiler-owned text conversion, so its parameter
  // carries the conversion domain rather than `any`. A bare `str` stays a
  // legal first-class value, and every indirect call site — `const c = str`,
  // `values.map(str)` — is checked against the same whitelist the direct
  // call form uses instead of executing a 'toString' hook.
  str: { kind: "function", parameterNames: ["value"], parameters: [textConvertibleType], requiredParameters: 1, result: stringType },
  // `print` inspects any value by contract; its domain is the top type for
  // assignment targets (D90 R17 keeps `any` for boundary declarations only).
  print: { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: nullType },
  // D47 rule 81: equals(a, b) — deep structural comparison over data.
  // Pure computation, so it lives in the prelude beside str/print; the
  // call site owns the domain checks (inferEqualsCall).
  equals: { kind: "intrinsic", name: "core.equals", parameterNames: ["a", "b"], parameters: [unknownType, unknownType], requiredParameters: 2, result: boolType },
  range: { kind: "intrinsic", name: "collections.range", parameterNames: ["start", "end", "step"], parameters: [numberType, numberType, numberType], requiredParameters: 1, result: { kind: "list", element: numberType } },
  Json: jsonNamespaceType,
  Promise: promiseNamespaceType,
  Text: textNamespaceType,
  Math: mathNamespaceType,
};

function coreVocabularyType(name: string): ValueType | null {
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
const permanentNamespaceImportRosters: ReadonlyMap<string, { readonly namespace: PermanentNamespaceName | null; readonly members: ReadonlySet<string> }> = new Map([
  ["velar/json", { namespace: "Json", members: namespaceMemberNames(jsonNamespaceType) }],
  ["velar/async", { namespace: "Promise", members: namespaceMemberNames(promiseNamespaceType) }],
  ["velar/text", { namespace: "Text", members: namespaceMemberNames(textNamespaceType) }],
  ["velar/math", { namespace: "Math", members: namespaceMemberNames(mathNamespaceType) }],
  ["velar/collections", { namespace: null, members: new Set(["range"]) }],
]);

function namespaceMemberNames(namespace: ValueType): ReadonlySet<string> {
  return new Set(namespace.kind === "object" ? namespace.fields.keys() : []);
}

function permanentNamespaceImportRoster(source: string): { readonly namespace: PermanentNamespaceName | null; readonly members: ReadonlySet<string> } | null {
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
/**
 * A class declared in an `extern module` block carries the `js:` identity
 * scheme; a VelarScript class carries `velar:`. The prefix is the only thing
 * that separates "this name is not a class" from "this class lives on the
 * other side of the bridge" (CLS-I4).
 */
function isExternClassIdentity(identity: string | null): boolean {
  return identity !== null && identity.startsWith("js:");
}

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

// D89 A2's two rosters. They are deliberately short: every name here is one a
// Python author reaches for without thinking, and a name that has to be argued
// for is a name the advisory would be guessing about.
const loopIndexSlotNames = new Set(["i", "idx", "index", "pos", "position"]);
const loopValueSlotNames = new Set(["v", "value", "item", "el", "element"]);

/**
 * The singular of the iterated collection's own name, so `for i, user in
 * users` reads as the same swap as `for i, v in users`. Only a plain name is
 * read; an arbitrary expression has no name to make singular.
 */
function singularIterableName(iterable: Expression): string | null {
  const name = iterable.kind === "IdentifierExpression" ? iterable.name
    : iterable.kind === "MemberExpression" ? iterable.property
      : null;
  if (name === null || !name.endsWith("s") || name.endsWith("ss")) return null;
  if (name.endsWith("ies")) return `${name.slice(0, -3)}y`;
  if (/(?:ch|sh|[sxz])es$/u.test(name)) return name.slice(0, -2);
  return name.slice(0, -1);
}

/**
 * D85 rule 207: does this type still carry an unsettled collection — a List or
 * Set element, or a Map's key and value together, that stayed `unknown`?
 *
 * This is the gate on the walk below, and it is what makes rule 208's boundary
 * fall out of the semantics instead of out of a syntax list. `Set().size` is a
 * number: nothing the empty `Set()` failed to say reaches the name, so the walk
 * never descends to it. `[["a"], []]` is a `List<List<string>>`: the sibling
 * element already said what the empty one holds, so there is nothing left to
 * report. Only a hole that survives all the way out to the binding is a hole
 * the author has to close.
 */
function carriesUnsettledCollection(type: ValueType, seen: Set<ValueType> = new Set()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  switch (type.kind) {
    case "list":
    case "set":
      return type.element.kind === "unknown" || carriesUnsettledCollection(type.element, seen);
    case "map":
      // A Map settles when either half does: `Map<string, unknown>` says its
      // keys are strings, and only `Map()` with nothing at all is unsettled.
      return (type.key.kind === "unknown" && type.value.kind === "unknown")
        || carriesUnsettledCollection(type.key, seen)
        || carriesUnsettledCollection(type.value, seen);
    case "optional":
      return carriesUnsettledCollection(type.inner, seen);
    case "record":
    case "promise":
      return carriesUnsettledCollection(type.value, seen);
    case "object":
      return [...type.fields.values()].some((field) => carriesUnsettledCollection(field, seen));
    case "union":
      return type.members.some((member) => carriesUnsettledCollection(member, seen));
    default:
      return false;
  }
}

/**
 * D85 rule 207: the sub-expressions whose value becomes part of this
 * expression's value, so each of them is a position that has to say what an
 * empty collection written there holds.
 *
 * A receiver and an argument are here, but the caller only asks for them once
 * `carriesUnsettledCollection` has said the enclosing value still has the hole
 * in it — so `const a = [].copy()` and `const a = id([])` report at the `[]`
 * that made the hole, while `print(Set().size)` and `const n = Set().size`
 * never reach the receiver at all. That is rule 208 stated as a property of the
 * value rather than as a list of node kinds.
 */
function settlingValuePositions(expression: Expression): readonly Expression[] {
  switch (expression.kind) {
    case "ConditionalExpression":
      return [expression.thenValue, expression.elseValue];
    case "ListExpression":
      return expression.elements.map((element) => element.kind === "SpreadExpression" ? element.value : element);
    case "ObjectExpression":
      return expression.properties.map((entry) => entry.value);
    case "BinaryExpression":
      return expression.operator === "??" ? [expression.left, expression.right] : [];
    case "CallExpression":
      return [
        ...(expression.callee.kind === "MemberExpression" ? [expression.callee.object] : []),
        ...expression.arguments.map((argument) => argument.kind === "SpreadExpression" ? argument.value : argument),
      ];
    case "MemberExpression":
      return [expression.object];
    case "IndexExpression":
      return [expression.object];
    default:
      return [];
  }
}

/** D102 ruling 1: the two wire-value domains an enum can exit to. */
const STRING_WIRE_KIND: ReadonlySet<"string" | "number"> = new Set(["string"]);
const NUMBER_WIRE_KIND: ReadonlySet<"string" | "number"> = new Set(["number"]);

/**
 * Every lowering hint names its owner before it names itself, so that owners
 * who never met cannot pick the same word. Both spellings in use are accepted —
 * a bare owner (`core.duration-arithmetic`, `node.route-param:{...}`) and a
 * scoped package (`@velarscript/web:jsx-scalar-text`) — and only the prefix is
 * constrained, because node's route hints carry a JSON payload after theirs.
 */
const EXTENSION_CALL_OWNER = /^(?:@[a-z0-9][a-z0-9-]*\/)?[a-z][a-z0-9-]*[.:][a-z][a-z0-9-]*/u;

/**
 * The lowering-hint channel: keyed by span identity, an open string vocabulary,
 * written by three independent owners (core's duration arithmetic, web's look
 * arithmetic and scalar-text fast path, node's route hints) and by any
 * third-party extension that subclasses `Analyzer`. Nothing but convention kept
 * two owners from claiming one span, and the loser's hint vanished in silence —
 * the emitter then lowered that expression the other way with no diagnostic
 * anywhere saying a decision had been dropped.
 *
 * The protocol shape is deliberately unchanged: `Analyzer` is exported from
 * `@velarscript/compiler/extension` and `LoweringHints` publishes the map back
 * as a `ReadonlyMap<string, string>`, so both sides stay `Map<string, string>`
 * and every existing `.set(identity, value)` writer keeps working verbatim.
 * What changes is that `set` now enforces the invariant those writers assumed:
 *
 *   - the same value written twice is idempotent and legal — a span can be
 *     re-analyzed, and deciding it the same way twice says nothing new;
 *   - a DIFFERENT value onto a claimed span is an invariant violation. Two
 *     owners disagree about how one expression lowers, and arrival order is not
 *     an answer to that, so it is reported as the compiler defect it is and the
 *     first claim stands;
 *   - a value with no owner prefix is refused on the same ground, since the
 *     namespace is the only reason independent owners cannot collide by accident.
 *
 * An owner that must YIELD to an existing claim still says so exactly the way
 * web's scalar-text fast path always has — `if (!has(identity)) set(...)`. That
 * stays legal because it never overwrites, and it is now the ONLY way to lose a
 * span: every other second write is heard.
 */
class ExtensionCallMap extends Map<string, string> {
  private readonly report: (message: string, span: Span) => void;

  constructor(report: (message: string, span: Span) => void) {
    super();
    this.report = report;
  }

  override set(identity: string, value: string): this {
    const existing = this.get(identity);
    if (existing === value) return this;
    if (existing !== undefined) {
      this.report(
        `Internal compiler error: lowering hints '${existing}' and '${value}' both claim one expression, and only one of them can be emitted; please report this module`,
        spanFromIdentity(identity),
      );
      return this;
    }
    if (!EXTENSION_CALL_OWNER.test(value)) {
      this.report(
        `Internal compiler error: lowering hint '${value}' does not name an owner — write '<owner>.<name>' or '@scope/<owner>:<name>'; please report this module`,
        spanFromIdentity(identity),
      );
      return this;
    }
    return super.set(identity, value);
  }
}

/** The inverse of `spanIdentity`, so a hint collision can point at the source. */
function spanFromIdentity(identity: string): Span {
  const [start, end] = identity.split(":", 2).map((part) => Number.parseInt(part, 10));
  return start !== undefined && end !== undefined && Number.isSafeInteger(start) && Number.isSafeInteger(end)
    ? { start, end }
    : { start: 0, end: 0 };
}

export class Analyzer implements TypeEnvironment {
  protected readonly diagnostics: Diagnostic[] = [];
  protected readonly advisories: Advisory[] = [];
  private readonly advisedIdentities = new Set<string>();
  private readonly scopes: Map<string, Binding>[] = [new Map()];
  private readonly memberNarrowings: Map<string, MemberNarrowing>[] = [new Map()];
  /** Per scope depth, the names a narrowing has written there; see `narrowingsForVisibleBindings`. */
  private readonly narrowedNames: Set<string>[] = [new Set()];
  /** How many loop back-edge passes are running; see `reanalyzeLoopBackEdge`. */
  private loopReanalysisDepth = 0;
  /** The "did you mean" roster, and the names each scope depth contributed to it. */
  private readonly nearestNames = new NearestNameRoster();
  private readonly scopedNames: string[][] = [[]];
  private nearestNamesSeeded = false;
  /** Per scope depth, the bindings flow analysis has written; see `snapshotFlowFacts`. */
  private readonly flowTouched: Set<Binding>[] = [new Set()];
  /** What each of those held before its first write, or null for a shadow born mid-flow. */
  private readonly flowOrigins = new Map<Binding, FlowFactState | null>();
  private readonly namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly namedTypeReadonlyFields = new Map<string, ReadonlySet<string>>();
  private readonly namedTypeIdentities = new Map<string, string>();
  /** Direct record bases by local name or canonical identity. Field tables remain flattened separately. */
  private readonly namedTypeBases = new Map<string, ValueType>();
  /** Fields contributed by a base, used to reject redeclaration in the child body. */
  private readonly inheritedTypeFields = new WeakMap<TypeDeclaration, ReadonlySet<string>>();
  /** Analyzer-owned complete field tables passed to the emitter for runtime validation. */
  private readonly typeDeclarationFields = new Map<number, readonly RecordTypeField[]>();
  /** D55: generic record declarations in scope, by the name this module writes. */
  private readonly genericTypes = new Map<string, GenericTypeInfo>();
  /** The same declarations by identity, so a substituted application can be re-instantiated. */
  private readonly genericTypesByIdentity = new Map<string, GenericTypeInfo>();
  /** Every instantiation seen, by identity, waiting for its field table to be asked for. */
  private readonly genericApplications = new Map<string, GenericApplication>();
  /** One canonical object per instantiation, so identity-keyed cycle guards still cut. */
  private readonly canonicalGenericApplications = new Map<string, ValueType>();
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
  private readonly collectionSizes = new Map<number, CollectionRuntimeKind>();
  private readonly collectionIndexes = new Map<string, "list" | "record">();
  private readonly collectionMemberships = new Map<string, CollectionRuntimeKind | "string">();
  private readonly collectionIterations = new Map<number, CollectionRuntimeKind | "string" | "binary">();
  private readonly recordFromCalls = new Map<string, RecordFromHint>();
  private readonly recordMapFromCalls = new Map<string, RecordMapFromHint>();
  private readonly binaryCalls = new Map<number, "bufferCopy" | "bufferSlice" | "bufferToBytes" | "bufferValues">();
  private readonly binarySizes = new Map<number, BinaryStorageKind>();
  private readonly binaryIndexes = new Map<string, BinaryStorageKind>();
  private readonly primitiveCalls = new Map<number, PrimitiveOperation>();
  private readonly sameValueZeroEqualities = new Set<string>();
  private readonly sameValueZeroMatchValues = new Set<string>();
  private readonly equalsCalls = new Set<string>();
  private readonly stringOrderings = new Set<string>();
  private readonly dynamicOrderings = new Set<string>();
  private readonly reportedBoundViolations = new Set<string>();
  private readonly usingDisposals = new Map<string, DisposalContract>();
  private readonly classDisposeChains = new Map<string, "sync" | "async">();
  /** D68 rule 177: expression spans a consumer iterates through `@iterate:`. */
  private readonly iterationContracts = new Set<string>();
  /** D90 R18: `async for` statements pulling a declared asynchronous `@iterate:`. */
  private readonly asyncIterationStatements = new Set<number>();
  /** D90 R18: `@iterate:` blocks that are the asynchronous pull form, by keyword span. */
  private readonly asyncIterateBlocks = new Set<string>();
  /** D51 rule 101: arrows that read a `using`-owned binding, by arrow span. */
  private readonly arrowOwnedCaptures = new Map<string, { readonly handle: string; readonly depth: number }>();
  private readonly arrowCaptureFrames: { captured: { readonly handle: string; readonly depth: number } | null }[] = [];
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
  private readonly nativeRangeForStatements = new Set<number>();
  // A literal-true loop with no reachable break is a synchronization boundary:
  // control cannot continue after it even when the body itself can iterate.
  private readonly nonFallthroughWhileStatements = new Set<number>();
  private readonly reportedPromiseResolutionHazards = new Set<string>();
  private readonly normalizedUndefinedExpressions = new Set<string>();
  private readonly instanceFieldReads = new Set<string>();
  // D50 rule 89: member spans that read `code` on an Error contract. The
  // emitter projects the declared class name rather than reading a property,
  // so a host object carrying its own unrelated `code` cannot impersonate one.
  private readonly errorCodeReads = new Set<string>();
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
  protected readonly extensionCalls: Map<string, string> = new ExtensionCallMap(
    (message, span) => this.diagnostics.push(diagnostic("VEL9004", message, span)),
  );
  private readonly builtinValueReferences = new Map<string, PermanentNamespaceName | "range">();
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
  /**
   * D85 rule 209: one mistake is reported once. A reported VEL4039 hands its
   * position `invalidType`, and an invalid body-inferred result is otherwise a
   * convergence failure — so the four collections below carry the *reported*
   * hole forward, and only that hole, to the place VEL4025 is decided.
   * `reportedCollectionHoles` are the names bound to one, `reportedResultHoles`
   * the local function results that are one, `functionResultKeys` maps a
   * callable name to the result a call to it reaches, and
   * `deferredConvergenceReports` holds the reports whose answer needs a callee
   * that may be declared further down the module.
   */
  private readonly reportedCollectionHoles = new Set<Binding>();
  private readonly bindingHoleCauses = new Map<Binding, ReadonlySet<string>>();
  private readonly reportedResultHoles = new Set<string>();
  private readonly functionResultKeys = new Map<Binding, string>();
  private readonly deferredConvergenceReports: {
    readonly report: Diagnostic;
    readonly resultKey: string;
    readonly causes: ReadonlySet<string>;
  }[] = [];
  private readonly logicalConditionNarrowings = new Map<string, {
    readonly truthy: ReadonlyMap<string, ValueType>;
    readonly falsy: ReadonlyMap<string, ValueType>;
  }>();
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
  private readonly loopFlowContexts: LoopFlowContext[] = [];
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
  /**
   * D31 item 23's recorded residual: a top-level call of a module-local
   * function runs that body during module evaluation, so a read of an imported
   * binding inside it is an initialization-position read reached through one
   * hop. The stack is the function frame a deferred read belongs to; the map
   * is that frame by the name it was bound to, so a call resolves to it after
   * the whole module is analyzed and hoisting order stops mattering.
   */
  private readonly deferredReadFrames: DeferredReadFrame[] = [];
  private readonly localFunctionFrames = new Map<Binding, DeferredReadFrame>();
  private readonly arrowDeferredFrames = new Map<string, DeferredReadFrame>();
  private readonly initializationLocalCalls: { readonly binding: Binding; readonly span: Span }[] = [];
  /** Local class bindings mapped to the source offset where their `class` statement evaluates (CLS-D8). */
  private readonly hoistedClassDeclarations = new Map<Binding, number>();
  /**
   * D90 R12: public class members whose omitted annotation inferred an output
   * `any`. Whether the member is at an export position depends on whether a
   * consumer can reach its class, which is not settled until the whole module
   * is analyzed, so the report waits for reportExportPositionAny.
   */
  private readonly exportPositionCandidates: {
    readonly className: string;
    readonly member: string;
    readonly span: Span;
  }[] = [];
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
  private readonly scopedGlobalGuidance = new Map<string, Map<string, string>>();
  private readonly analysisExtensions: readonly CompilerAnalysisExtension[];
  private readonly sourceText: string;
  private readonly executeMain: boolean;
  // D52 rule 114: the namespace prefixes an extension has withdrawn, and the
  // module their members went back to.
  private readonly retiredNamespaces = new Map<string, RetiredNamespace>();
  /** Every `Retired.member` read, collected so one migration can carry the whole rewrite. */
  private readonly retiredNamespaceUses: { readonly namespace: string; readonly member: string | null; readonly span: Span; readonly memberEnd: number; readonly bare: boolean }[] = []; 
  /** The property each member access asks for, keyed by the receiver's span. */
  private readonly memberAccessProperties = new Map<string, { readonly property: string; readonly end: number }>();
  /** Every name this module declares anywhere, so a rewrite can prove it collides with nothing. */
  private readonly declaredNames = new Set<string>();
  private readonly promiseInitializerBindings = new WeakSet<Binding>();
  private readonly testExpectOperands = new Map<string, ValueType>();
  /** D52 rule 116: reads of a name imported from a module that has a permanent namespace. */
  private readonly permanentNamespaceImportReads: { readonly local: string; readonly source: string; readonly imported: string; readonly span: Span }[] = [];
  /** The import each such local came from, keyed by the local name. */
  private readonly permanentNamespaceImportOrigins = new Map<string, { readonly source: string; readonly imported: string; readonly specifier: Span }>();

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    this.analysisExtensions = extensions;
    this.sourceText = context.sourceText ?? "";
    this.executeMain = context.executeMain !== false;
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
        // D50 rule 89: the string form of the same identity `is` discriminates
        // on — the declared class name — so a log line or a JSON payload can
        // carry an error's class across a boundary that classes cannot cross.
        ["code", { mutable: false, type: stringType }],
      ]),
      getters: new Set(),
      abstractGetters: new Set(),
      methods: new Map(),
      abstractMethods: new Set(),
      staticFields: new Map(),
      staticGetters: new Set(),
      staticMethods: new Map(),
    });
    // ENM-U4 + COL-U5: the compiler-raised error types are nameable —
    // catchable, `is`-narrowable, and constructible — wired exactly like
    // Error. ValidationError additionally carries the failure detail its
    // parse sites report (path, field, reason). AssertionError joins the
    // roster because the charter already promises it does: "A `catch` block
    // still receives all three, because a `catch` is explicit: the author
    // wrote code to handle it, and `is` names which one it was."
    const builtinErrorDetails: readonly (readonly [string, readonly (readonly [string, ClassField])[]])[] = [
      ["ValidationError", [
        ["path", { mutable: false, type: optionalOf(stringType) }],
        ["field", { mutable: false, type: optionalOf(stringType) }],
        ["reason", { mutable: false, type: optionalOf(stringType) }],
      ]],
      ["AssertionError", []],
      ["NarrowingError", []],
      ["IndexError", []],
      // D50 rule 89: the capability failures a caller recovers from
      // differently. Each carries the resource that failed, because every
      // recovery — create it, request access, choose another name — starts by
      // asking which one it was.
      ...VELAR_HOST_ERROR_NAMES.map((name) => [
        name,
        VELAR_HOST_ERROR_PATH_NAMES.includes(name) ? [["path", { mutable: false, type: optionalOf(stringType) }] as const] : [],
      ] as const),
    ];
    for (const [name, detailFields] of builtinErrorDetails) {
      this.classes.set(name, {
        parameters: [stringType],
        parameterNames: ["message"],
        requiredParameters: 0,
        base: "Error",
        abstract: false,
        fields: new Map(detailFields),
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
    for (const [name, base] of context.namedTypeBases ?? []) this.namedTypeBases.set(name, base);
    for (const [name, info] of context.genericTypes ?? []) {
      // The context carries each template twice — under the name this module
      // writes, and under its identity for the modules reached without an
      // import line. Only the first is a name; keeping identities out of the
      // by-name map is what lets `genericTypeNames` mean what it says.
      this.genericTypesByIdentity.set(info.identity, info);
      if (name !== info.identity) this.genericTypes.set(name, info);
    }
    for (const [name, type] of context.typeAliases ?? []) this.typeAliases.set(name, type);
    for (const [name, members] of context.enums ?? []) this.enums.set(name, members);
    for (const [name, info] of context.classes ?? []) this.classes.set(name, info);
    // D55: an instantiation can arrive already built — in an imported
    // signature, an imported record's field, an alias. Noting them here is what
    // lets `fieldsOf` answer for `Box<string>` in a module that never wrote it.
    for (const type of this.importBindings.values()) this.noteGenericApplications(type);
    for (const type of this.dynamicImports.values()) this.noteGenericApplications(type);
    for (const type of this.typeAliases.values()) this.noteGenericApplications(type);
    for (const fields of this.namedTypes.values()) for (const type of fields.values()) this.noteGenericApplications(type);
    for (const info of this.classes.values()) {
      for (const field of info.fields.values()) this.noteGenericApplications(field.type);
      for (const type of info.methods.values()) this.noteGenericApplications(type);
      for (const field of info.staticFields.values()) this.noteGenericApplications(field.type);
      for (const type of info.staticMethods.values()) this.noteGenericApplications(type);
    }
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
      for (const [name, retired] of extension.retiredNamespaces ?? []) this.retiredNamespaces.set(name, retired);
      for (const [suffix, guidance] of extension.globalGuidanceByPathSuffix ?? []) {
        const collected = this.scopedGlobalGuidance.get(suffix) ?? new Map<string, string>();
        for (const [name, message] of guidance) collected.set(name, message);
        this.scopedGlobalGuidance.set(suffix, collected);
      }
    }
  }

  /**
   * D113: the surface-version gate reads the same member resolvers that type
   * checking uses. Placeholder types retain every parameter/result position,
   * and mutable plus read-only receivers expose the presence boundary too.
   */
  static coreCollectionMemberContracts(): ReadonlyMap<string, ValueType> {
    const analyzer = new Analyzer();
    const item: ValueType = { kind: "named", name: "T", identity: "surface:T" };
    const key: ValueType = { kind: "named", name: "K", identity: "surface:K" };
    const value: ValueType = { kind: "named", name: "V", identity: "surface:V" };
    const contracts = new Map<string, ValueType>();
    const collect = (
      label: string,
      names: readonly string[],
      member: (name: string) => ValueType | null,
    ): void => {
      for (const name of ["size", ...names]) {
        const contract = member(name);
        if (contract !== null) contracts.set(`${label}.${name}`, contract);
      }
    };
    collect("List", CORE_LIST_METHOD_NAMES, (name) => analyzer.listMember({ kind: "list", element: item }, name));
    collect("readonly List", CORE_LIST_METHOD_NAMES, (name) => analyzer.listMember({ kind: "list", element: item, readonlyView: true }, name));
    collect("Map", CORE_MAP_METHOD_NAMES, (name) => analyzer.mapMember({ kind: "map", key, value }, name));
    collect("readonly Map", CORE_MAP_METHOD_NAMES, (name) => analyzer.mapMember({ kind: "map", key, value, readonlyView: true }, name));
    collect("Set", CORE_SET_METHOD_NAMES, (name) => analyzer.setMember({ kind: "set", element: item }, name));
    collect("readonly Set", CORE_SET_METHOD_NAMES, (name) => analyzer.setMember({ kind: "set", element: item, readonlyView: true }, name));
    collect("Record", CORE_RECORD_METHOD_NAMES, (name) => analyzer.recordMember({ kind: "record", value }, name));
    collect("readonly Record", CORE_RECORD_METHOD_NAMES, (name) => analyzer.recordMember({ kind: "record", value, readonlyView: true }, name));
    return contracts;
  }

  /**
   * The guidance a reserved global earns where it was written. A module path
   * suffix selects the door that is actually open there before the module-wide
   * answer applies.
   */
  private guidanceForGlobal(name: string): string | undefined {
    if (this.modulePath !== null) {
      for (const [suffix, guidance] of this.scopedGlobalGuidance) {
        if (!this.modulePath.endsWith(suffix)) continue;
        const message = guidance.get(name);
        if (message !== undefined) return message;
      }
    }
    return this.globalGuidance.get(name);
  }

  /**
   * D90 (coherence): the one report an unresolved name earns, wherever it was
   * written. A reserved global names the module that replaced it, a foreign
   * builtin with no successor stops at the bare message rather than guessing,
   * and everything else may carry the nearest visible name. Both unresolved-
   * name sites reach this, because `exports = {run: run}` is the same mistake
   * as `const value = exports` and used to earn a strictly worse answer for
   * standing on the left of the `=`.
   */
  private reportUnresolvedName(name: string, span: Span): void {
    const guidance = this.guidanceForGlobal(name);
    const nearest = guidance || foreignBuiltinNames.has(name) ? null : this.nearestVisibleBindingName(name);
    this.diagnostics.push(diagnostic(
      guidance ? "VEL3008" : "VEL3001",
      guidance ?? `Unknown name '${name}'${nearest ? `; did you mean '${nearest}'?` : ""}`,
      span,
    ));
  }

  private nearestVisibleBindingName(name: string): string | null {
    if (!this.nearestNamesSeeded) {
      this.nearestNamesSeeded = true;
      for (const candidate of [
        ...Object.keys(coreVocabularyTypes),
        ...this.extensionGlobals.keys(),
        ...this.importBindings.keys(),
        "Map", "Set", "Error", "ValidationError", "AssertionError", "NarrowingError", "IndexError",
        ...VELAR_HOST_ERROR_NAMES,
      ]) this.nearestNames.add(candidate);
    }
    return this.nearestNames.nearest(name);
  }

  /** Files a scope's name in the "did you mean" roster and takes it back out when the scope exits. */
  private recordScopedName(name: string): void {
    this.nearestNames.add(name);
    this.scopedNames.at(-1)!.push(name);
  }

  private readonly modulePath: string | null;
  private readonly importBindings: ReadonlyMap<string, ValueType>;
  private readonly dynamicImports: ReadonlyMap<string, ValueType>;

  analyze(program: Program): readonly Diagnostic[] {
    this.rejectReservedTypeNames(program);
    this.registerEnumShapes(program);
    this.registerAliasShapes(program);
    // Class identities must exist before record fields are resolved. Otherwise a
    // record field annotated with a class is frozen as a structural named type.
    this.registerClassNames(program);
    this.registerExternTypeImports(program);
    this.registerTypeShapes(program);
    this.rejectPolymorphicRecursion(program);
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
    this.registerPermanentNamespaceImports(program);
    this.predeclareTopLevel(program);
    let previous: Statement | null = null;
    for (const statement of program.body) {
      this.analyzeStatement(statement);
      this.adviseManualCollectionConversion(previous, statement);
      this.adviseManualListPipeline(previous, statement);
      this.adviseManualListQuery(previous, statement);
      previous = statement;
    }
    // D90 R12 reports last for the same reason: whether a class member is at
    // an export position is a question about the module's whole export
    // surface, which no single declaration can answer as it is analyzed.
    this.reportExportPositionAny(program);
    // D52 rules 114/116: both namespace migrations report last, because both
    // rewrites need the whole module before they can be written down — one has
    // to know every name the new import would have to clear, and the other has
    // to know every read the retiring import leaves behind.
    this.reportRetiredNamespaceUses(program);
    this.reportPermanentNamespaceImports(program);
    this.reportPermanentNamespaceReExports(program);
    // D85 rule 209 reports last for the same reason: a hole reaches a caller
    // through a callee the module may not declare until later, so the second
    // report is deleted once every hole in the module is on record.
    this.resolveDeferredConvergenceReports();
    return this.diagnostics;
  }

  /**
   * D89: the advisories this analysis raised. `analyze` keeps returning the
   * diagnostics alone, so the caller reads the two channels separately and the
   * cursor arithmetic over `this.diagnostics` stays exact.
   */
  analyzedAdvisories(): readonly Advisory[] {
    return this.advisories;
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
      // D55 rule 120: a generic record's own parameters are in scope for every
      // rule that reads its field annotations, exactly as a `def`'s are inside
      // its signature.
      const withParameters = <T>(action: () => T): T => declaration.kind === "TypeDeclaration" && declaration.typeParameters?.length
        ? this.withTypeParameterFrame(this.typeParameterFrame(declaration.typeParameters), action)
        : action();
      let valid = withParameters(() => declaration.kind === "TypeAliasDeclaration"
        ? this.validateTypeReference(declaration.target)
        : [
          ...(declaration.base ? [this.validateTypeReference(declaration.base)] : []),
          ...declaration.fields.map((field) => this.validateTypeReference(field.type)),
        ].every(Boolean));
      if (valid && declaration.kind === "TypeDeclaration" && declaration.base) {
        withParameters(() => {
          const base = this.resolveAnnotation(declaration.base);
          const fields = base.kind === "named" && !base.readonlyView
            ? this.fieldsOf(base.identity ?? base.name)
            : null;
          if (base.kind === "named" && fields !== null && !this.isPrimitiveType(base.name)) return;
          this.typeError(
            `Type '${declaration.name}' can only extend one concrete record type; ${describeType(base)} is not a record declaration`,
            declaration.base!.span,
          );
          valid = false;
        });
      }
      if (valid) {
        withParameters(() => {
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
        });
      }
      // D44 rule 72: a `readonly` field modifier and a `readonly type`
      // declaration make the same deep promise as a `readonly T` annotation,
      // so both obey the same pure-data rule.
      if (valid && declaration.kind === "TypeDeclaration") {
        withParameters(() => {
          const declaredFields = new Map(declaration.fields.map((field) => [field.name, field]));
          const fields = declaration.readonly
            ? [...(this.fieldsOf(this.namedTypeIdentities.get(declaration.name) ?? declaration.name) ?? new Map())]
              .map(([name, type]) => ({ name, type, span: declaredFields.get(name)?.span ?? declaration.span }))
            : declaration.fields.filter((field) => field.readonly)
              .map((field) => ({ name: field.name, type: this.resolveAnnotation(field.type), span: field.span }));
          for (const field of fields) {
            const violation = this.findClassInReadonlyData(field.type);
            if (!violation) continue;
            this.typeError(
              `'readonly' accepts only pure data at every depth; '${declaration.name}.${field.name}${violation.suffix}' is class '${violation.className}' — model it as a data record, or drop 'readonly'`,
              field.span,
            );
            valid = false;
          }
        });
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
          : [
            ...(declaration.base ? [declaration.base.syntax] : []),
            ...declaration.fields.map((field) => field.type.syntax),
          ];
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
      // D55: an instantiation stands for its declaration here — `Tree<T>` is
      // productive exactly when `Tree` is, and the finite-value question is the
      // same question for every argument it could be applied to.
      if (type.kind === "named" && type.application) {
        const name = type.application.name;
        return !declarations.has(name) || productive.has(name);
      }
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
        const fields = this.namedTypes.get(name) ?? this.genericTypes.get(name)?.fields;
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
            importTypeNamePosition(statement, specifier),
          );
          this.recordImportedBindingSource(statement.javascript, statement.source, specifier.local, specifier.namespace ? null : specifier.imported);
          this.recordImportedBindingOrigin(specifier.local, statement.source, specifier.span);
          const reactive = this.reactiveBindings.get(specifier.local);
          if (reactive) this.markDeclaredBindingReactive(specifier.local, reactive);
        }
        this.predeclared.add(statement);
      } else if (statement.kind === "TypeDeclaration" || statement.kind === "TypeAliasDeclaration") {
        this.declareTypeNameBinding(statement.name, { kind: "typeObject", name: statement.name }, statement.span, "type");
        this.predeclared.add(statement);
      } else if (statement.kind === "EnumDeclaration") {
        const info = this.enums.get(statement.name) ?? {
          identity: statement.name,
          members: new Set(statement.members.map((member) => member.name)),
          wireValues: new Map(statement.members.map((member) => [member.name, member.value])),
        };
        this.declareTypeNameBinding(statement.name, { kind: "enumObject", name: statement.name, identity: info.identity, members: info.members }, statement.span, "enum");
        this.predeclared.add(statement);
      } else if (statement.kind === "ClassDeclaration") {
        this.declareTypeNameBinding(statement.name, { kind: "classConstructor", name: statement.name }, statement.span, "class");
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
        // D85 rule 209: the result a call to this name reaches, recorded before
        // any body is analyzed so a call to a function declared further down
        // the module still resolves to it.
        const callable = this.scopes.at(-1)?.get(statement.name);
        if (callable) this.functionResultKeys.set(callable, this.functionResultKey(statement));
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
      collectionIndexes: this.collectionIndexes,
      collectionMemberships: this.collectionMemberships,
      collectionIterations: this.collectionIterations,
      recordFromCalls: this.recordFromCalls,
      recordMapFromCalls: this.recordMapFromCalls,
      binaryCalls: this.binaryCalls,
      binarySizes: this.binarySizes,
      binaryIndexes: this.binaryIndexes,
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
      genericTypeNames: new Set(this.genericTypes.keys()),
      typeDeclarationFields: this.typeDeclarationFields,
      optionalMembers: this.optionalMembers,
      optionalCalls: this.optionalCalls,
      optionalIndexes: this.optionalIndexes,
      optionalCallees: this.optionalCallees,
      truthConditions: this.truthConditions,
      normalizedNullResults: this.normalizedNullResults,
      normalizedPromiseValues: this.normalizedPromiseValues,
      asyncResolvedValues: this.asyncResolvedValues,
      asyncForStatements: this.asyncForStatements,
      nativeRangeForStatements: this.nativeRangeForStatements,
      normalizedUndefinedExpressions: this.normalizedUndefinedExpressions,
      instanceFieldReads: this.instanceFieldReads,
      errorCodeReads: this.errorCodeReads,
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
      classDisposeChains: this.classDisposeChains,
      iterationContracts: this.iterationContracts,
      asyncIterationStatements: this.asyncIterationStatements,
      asyncIterateBlocks: this.asyncIterateBlocks,
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

  analyzedNamedTypes(): ReadonlyMap<string, ReadonlyMap<string, ValueType>> {
    return this.namedTypes;
  }

  analyzedNamedTypeReadonlyFields(): ReadonlyMap<string, ReadonlySet<string>> {
    return this.namedTypeReadonlyFields;
  }

  analyzedNamedTypeBases(): ReadonlyMap<string, ValueType> {
    return this.namedTypeBases;
  }

  analyzedGenericTypes(): ReadonlyMap<string, GenericTypeInfo> {
    return this.genericTypes;
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
    const known = this.namedTypes.get(identity);
    if (known) return known;
    const instantiated = this.instantiateGenericFields(identity);
    if (instantiated) return instantiated;
    return this.extensionFieldsOf(identity);
  }

  /**
   * D102 ruling 1: the declared wire value of each member, by identity first
   * and local name second — `this.enums` is keyed by the name the module sees,
   * and an imported enum's identity is its declaring module's.
   */
  enumWireValuesOf(identity: string, name: string): ReadonlyMap<string, string | number> | null {
    return (this.enums.get(identity) ?? this.enums.get(name))?.wireValues ?? null;
  }

  enumValuesOf(identity: string): readonly (string | number)[] | null {
    const info = this.enums.get(identity);
    if (!info) return null;
    // OpenAPI、路由参数和其他线协议消费的是枚举真正序列化的值，不是源码成员名。
    // 按成员声明顺序读取映射，既与 Enum.values() 一致，也避免 Map 构造顺序漂移。
    return [...info.members].map((member) => info.wireValues.get(member)!);
  }

  /**
   * D55 rule 121: an instantiation's field table is the declaration's fields
   * with the arguments substituted, registered under the instantiation's own
   * identity. Computing it on demand rather than at the point the application
   * was written is what makes `type Tree<T>: kids: List<Tree<T>>` terminate:
   * the application is *noted* while the declaration is still being read, and
   * substituted only once someone asks, by which time the template is whole.
   * Substitution rebuilds nested applications through the same constructor, so
   * each one is noted in turn and the walk is finite in the number of distinct
   * instantiations — homogeneous recursion reaches its fixed point, and rule
   * 125's declaration-site rule is what stops a polymorphic one from existing.
   */
  private instantiateGenericFields(identity: string): ReadonlyMap<string, ValueType> | null {
    if (this.namedTypes.has(identity)) return this.namedTypes.get(identity)!;
    const application = this.genericApplications.get(identity);
    if (!application) return null;
    const info = this.genericTypesByIdentity.get(application.declaration);
    if (!info) return null;
    const bindings = info.parameterNames.map((_, index) => application.arguments[index] ?? unknownType);
    const fields = new Map<string, ValueType>();
    // Registered before the field types are walked: a field that mentions this
    // very instantiation finds the entry instead of recurring into it.
    this.namedTypes.set(identity, fields);
    for (const [name, type] of info.fields) {
      const substituted = substituteTypeParameters(type, bindings);
      this.noteGenericApplications(substituted);
      fields.set(name, substituted);
    }
    if (info.readonlyFields?.size) this.namedTypeReadonlyFields.set(identity, info.readonlyFields);
    return fields;
  }

  /**
   * Records every generic application inside a type so its field table can be
   * built on demand. Called wherever an application can first become visible —
   * a resolved annotation, an imported binding, a substituted field — because a
   * missed site is an instantiation whose fields silently read as "not a
   * record" (the batch M failure shape, one layer out).
   */
  private noteGenericApplications(type: ValueType, seen = new Set<string>()): void {
    switch (type.kind) {
      case "named": {
        const application = type.application;
        if (!application || !type.identity || seen.has(type.identity)) return;
        seen.add(type.identity);
        if (this.genericTypesByIdentity.has(application.declaration)) this.genericApplications.set(type.identity, application);
        for (const argument of application.arguments) this.noteGenericApplications(argument, seen);
        return;
      }
      case "optional":
        return this.noteGenericApplications(type.inner, seen);
      case "list":
      case "set":
        return this.noteGenericApplications(type.element, seen);
      case "map":
        this.noteGenericApplications(type.key, seen);
        return this.noteGenericApplications(type.value, seen);
      case "record":
      case "promise":
      case "runtimeType":
        return this.noteGenericApplications(type.value, seen);
      case "typeObject":
        if (type.value) this.noteGenericApplications(type.value, seen);
        return;
      case "object":
        for (const field of type.fields.values()) this.noteGenericApplications(field, seen);
        return;
      case "extension":
        for (const property of type.properties.values()) this.noteGenericApplications(property, seen);
        for (const argument of type.arguments) this.noteGenericApplications(argument, seen);
        return;
      case "function":
      case "action":
      case "intrinsic":
        for (const parameter of type.parameters) this.noteGenericApplications(parameter, seen);
        if (type.rest) this.noteGenericApplications(type.rest, seen);
        return this.noteGenericApplications(type.result, seen);
      case "union":
        for (const member of type.members) this.noteGenericApplications(member, seen);
        return;
      default:
        return;
    }
  }

  /** The generic record a name in this module refers to, local or imported. */
  protected genericTypeInfo(name: string): GenericTypeInfo | null {
    return this.genericTypes.get(name) ?? null;
  }

  /**
   * D55 rule 121: the one place an application written in this module becomes
   * canonical — declaration identity, display text, instantiation identity, and
   * the note that lets its field table be built. Every path that can be the
   * first to see an application calls this, so none of them can produce a
   * half-resolved one.
   */
  private resolveGenericApplication(
    type: Extract<ValueType, { kind: "named" }>,
    resolveArgument: (argument: ValueType) => ValueType = (argument) => this.resolveNamedClasses(argument),
  ): ValueType | null {
    const application = type.application;
    if (!application || type.identity) return null;
    const info = this.genericTypes.get(application.name);
    if (!info) return null;
    const built = genericApplicationType(
      info.identity,
      info.name,
      application.arguments.map(resolveArgument),
      type.readonlyView === true,
    );
    // One object per instantiation, not one per resolution. A recursive
    // generic re-enters resolution, so handing back a fresh equal object each
    // time would defeat any traversal that memoizes by type identity and recur
    // without end.
    const key = `${built.identity}${built.readonlyView ? "\u0000readonly" : ""}`;
    const cached = this.canonicalGenericApplications.get(key);
    if (cached) return cached;
    this.canonicalGenericApplications.set(key, built);
    this.noteGenericApplications(built);
    return built;
  }

  /**
   * D55 rules 124 and 126: everything an instantiation has to answer for at the
   * place it is written — arity, the declared bounds, and the one argument
   * shape a runtime-validated record can never hold.
   */
  private validateGenericApplication(info: GenericTypeInfo, syntax: Extract<TypeSyntax, { kind: "GenericTypeSyntax" }>): boolean {
    const arity = info.parameterNames.length;
    if (syntax.arguments.length !== arity) {
      this.typeError(
        `Generic type '${info.name}' takes ${arity === 1 ? "1 type argument" : `${arity} type arguments`}, not ${syntax.arguments.length}; write '${info.name}<${info.parameterNames.join(", ")}>'`,
        syntax.span,
      );
      return false;
    }
    const arguments_ = syntax.arguments.map((argument) => this.resolveAnnotation({ syntax: argument, span: argument.span }));
    let valid = true;
    for (const [index, argument] of arguments_.entries()) {
      // D55 rule 124: `Box<Type<User>>` puts a static carrier in a field the
      // record validates at runtime, which is the existing VEL4022 refusal
      // reaching the position that actually caused it.
      if (!typeContainsRuntimeTypeCheck(argument)) continue;
      this.diagnostics.push(diagnostic(
        "VEL4022",
        `Type<T> is a static runtime-Type carrier and cannot be a type argument of '${info.name}', whose fields are validated at runtime; keep it in a function, class, or ordinary value instead`,
        syntax.arguments[index]!.span,
      ));
      valid = false;
    }
    if (!valid) return false;
    // D44 rule 72 reaching the instantiation: a bare `T` under `readonly` is
    // legal at the declaration — opacity is as good as immutability there — but
    // the argument is what decides whether the promise holds, and only this
    // site knows it. Without this, `type Held<T>: readonly value: T` applied to
    // a class kept a `readonly` view that could be written through.
    if (info.readonlyFields?.size) {
      const instantiated = this.resolveAnnotation({ syntax, span: syntax.span });
      const fields = instantiated.kind === "named" && instantiated.identity ? this.fieldsOf(instantiated.identity) : null;
      for (const name of info.readonlyFields) {
        const field = fields?.get(name);
        const violation = field ? this.findClassInReadonlyData(this.readonlyDataViewOf(field)) : null;
        if (!violation) continue;
        this.typeError(
          `'readonly' accepts only pure data at every depth; '${describeType(instantiated)}.${name}${violation.suffix}' is class '${violation.className}' — model it as a data record, or drop 'readonly'`,
          syntax.span,
        );
        valid = false;
      }
    }
    if (!valid) return false;
    // D55 rule 124: the same grant table, the same decision procedure, the same
    // violation shape a call site reports — only the declaration form differs.
    const violations = collectTypeArgumentBoundViolations(
      info.parameterNames,
      info.parameterBounds,
      arguments_,
      (type, bound) => this.satisfiesBound(type, bound),
    );
    for (const violation of violations) {
      this.diagnostics.push(diagnostic(
        "VEL4031",
        `Type parameter '${violation.name}' of '${info.name}' is bound by ${violation.bound}, so this argument cannot be ${describeType(violation.solved)}; ${boundVocabularyGuidance[violation.bound]}`,
        syntax.arguments[violation.index]?.span ?? syntax.span,
      ));
    }
    return violations.length === 0;
  }

  /**
   * D55 rule 125: a generic record's reference to a declaration in its own
   * recursive group must pass that group's parameters straight through.
   * `type Tree<T>: kids: List<Tree<T>>` is homogeneous — `Tree<string>` needs
   * only `Tree<string>`, and monomorphization reaches its fixed point. The
   * refused shape, `type Bad<T>: next: Bad<List<T>>?`, demands
   * `Bad<List<string>>`, `Bad<List<List<string>>>`, without end. The rule is
   * checked here, on the line that declares it, because an instantiation-depth
   * limit could only say "too deep" at some later call — the undirected
   * diagnostic family D42 spent its length removing.
   */
  private rejectPolymorphicRecursion(program: Program): void {
    const declarations = program.body.filter((statement): statement is TypeDeclaration =>
      statement.kind === "TypeDeclaration" && (statement.typeParameters?.length ?? 0) > 0);
    if (declarations.length === 0) return;
    const local = new Set(declarations.map((statement) => statement.name));
    const applications = (statement: TypeDeclaration): Extract<TypeSyntax, { kind: "GenericTypeSyntax" }>[] => {
      const found: Extract<TypeSyntax, { kind: "GenericTypeSyntax" }>[] = [];
      const visit = (syntax: TypeSyntax): void => {
        switch (syntax.kind) {
          case "GenericTypeSyntax":
            if (local.has(syntax.name)) found.push(syntax);
            syntax.arguments.forEach(visit);
            return;
          case "ReadonlyTypeSyntax":
          case "OptionalTypeSyntax":
            return visit(syntax.inner);
          case "UnionTypeSyntax":
            return syntax.members.forEach(visit);
          case "FunctionTypeSyntax":
            syntax.parameters.forEach((parameter) => visit(parameter.type));
            return visit(syntax.result);
          default:
            return;
        }
      };
      for (const field of statement.fields) visit(field.type.syntax);
      return found;
    };
    const mentions = new Map(declarations.map((statement) =>
      [statement.name, new Set(applications(statement).map((syntax) => syntax.name))] as const));
    // The reachable set, to a fixed point: a group is every declaration that
    // reaches this one and is reached by it, which is what makes the rule catch
    // `A<T>` -> `B<List<T>>` -> `A<T>` as surely as it catches direct self-use.
    const reaches = new Map([...mentions].map(([name, direct]) => [name, new Set(direct)] as const));
    for (let changed = true; changed;) {
      changed = false;
      for (const [, reachable] of reaches) {
        for (const name of [...reachable]) {
          for (const next of reaches.get(name) ?? []) {
            if (reachable.has(next)) continue;
            reachable.add(next);
            changed = true;
          }
        }
      }
    }
    for (const statement of declarations) {
      const group = new Set([...reaches.get(statement.name) ?? []]
        .filter((name) => name === statement.name || reaches.get(name)?.has(statement.name)));
      const parameters = statement.typeParameters!.map((parameter) => parameter.name);
      for (const syntax of applications(statement)) {
        if (!group.has(syntax.name)) continue;
        const passesThrough = syntax.arguments.length === parameters.length
          && syntax.arguments.every((argument, index) =>
            argument.kind === "NamedTypeSyntax" && argument.name === parameters[index]);
        if (passesThrough) continue;
        this.diagnostics.push(diagnostic(
          "VEL4021",
          `Recursive generic type '${statement.name}' must use its own type parameters where it refers to '${syntax.name}'; write '${syntax.name}<${parameters.join(", ")}>' — arguments that change with the depth would need a new instantiation at every depth, without end`,
          syntax.span,
        ));
      }
    }
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
    const known = this.namedTypeReadonlyFields.get(identity);
    if (known) return known;
    // D55 rule 122: an instantiation's readonly fields are its declaration's,
    // and they are registered alongside the substituted field table. Asking for
    // them first — variance is decided per field, so a caller may — must build
    // it, or the covariant reading would silently become the invariant one.
    if (this.genericApplications.has(identity)) {
      this.instantiateGenericFields(identity);
      return this.namedTypeReadonlyFields.get(identity) ?? null;
    }
    return null;
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

  protected extensionExpressionContainsDirectAwait(
    expression: Expression,
    contains: (expression: Expression) => boolean,
  ): boolean | undefined {
    for (const extension of this.analysisExtensions) {
      const result = extension.directAwaitExpression?.(expression, contains);
      if (result !== undefined) return result;
    }
    return undefined;
  }

  protected extensionStatementContainsDirectAwait(
    statement: Statement,
    containsExpression: (expression: Expression) => boolean,
    containsBlock: (statements: readonly Statement[]) => boolean,
  ): boolean | undefined {
    for (const extension of this.analysisExtensions) {
      const result = extension.directAwaitStatement?.(statement, containsExpression, containsBlock);
      if (result !== undefined) return result;
    }
    return undefined;
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

  /**
   * D51 rule 109: `Comparable`, `Text`, and `Data` are the compiler's own
   * closed bound vocabulary (D41 item 61). A user type of the same name used to
   * be accepted and then silently ignored at every `<T: Data>` — the bound won,
   * so `save(42)` passed a function whose author had declared a record. The
   * name is rejected where it is introduced, which is the only place a rename
   * is cheap; the use site could only report an ambiguity nobody can fix.
   */
  private rejectReservedTypeNames(program: Program): void {
    const vocabulary = typeParameterBoundNames.join(", ");
    const reject = (name: string, errorSpan: Span, noun: string): void => {
      if (!isTypeParameterBound(name)) return;
      this.diagnostics.push(diagnostic(
        "VEL4021",
        `'${name}' is a reserved type-parameter bound — the bounds are ${vocabulary} — so it cannot also name a ${noun}; rename this declaration`,
        errorSpan,
      ));
    };
    for (const statement of program.body) {
      switch (statement.kind) {
        case "TypeDeclaration":
        case "TypeAliasDeclaration":
          reject(statement.name, statement.span, "type");
          break;
        case "ClassDeclaration":
          reject(statement.name, statement.span, "class");
          break;
        case "EnumDeclaration":
          reject(statement.name, statement.span, "enum");
          break;
        case "ExternModuleDeclaration":
          for (const declaration of statement.classes) reject(declaration.name, declaration.span, "extern class");
          break;
        case "ImportDeclaration":
          for (const specifier of statement.specifiers) {
            reject(specifier.local, statement.span, specifier.local === specifier.imported ? "imported name" : "import alias");
          }
          break;
        default:
          break;
      }
    }
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
    // D55 rule 121: an alias is transparent inside a type argument too, so
    // `Box<Id>` and `Box<string>` reach the identity step already agreeing.
    // Expansion also canonicalizes: an alias registered before the generic
    // declarations were read — `type Boxed = Box<string>` above `type Box<T>` —
    // stored an application with no identity, and every reader of an alias goes
    // through here.
    if (type.kind === "named" && type.application) {
      const arguments_ = type.application.arguments.map((argument) => this.expandAliases(argument, seen));
      const changed = arguments_.some((argument, index) => argument !== type.application!.arguments[index]);
      if (!changed && type.identity) return type;
      const expanded = changed ? { ...type, application: { ...type.application, arguments: arguments_ } } : type;
      return this.resolveGenericApplication(expanded) ?? expanded;
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
    const declarations = new Map<string, TypeDeclaration>();
    const concrete = new Map<string, { readonly fields: Map<string, ValueType>; readonly readonlyFields: Set<string> }>();
    const generic = new Map<string, { readonly info: GenericTypeInfo; readonly fields: Map<string, ValueType>; readonly readonlyFields: Set<string> }>();

    // Register every name and mutable placeholder first. A base may be declared
    // later, and a generic base may mention the child's own parameters.
    for (const statement of program.body) {
      if (statement.kind !== "TypeDeclaration") continue;
      declarations.set(statement.name, statement);
      const fields = new Map<string, ValueType>();
      const readonlyFields = new Set<string>();
      if (statement.typeParameters?.length) {
        const info: GenericTypeInfo = {
          identity: this.namedTypeIdentities.get(statement.name) ?? statement.name,
          name: statement.name,
          parameterNames: statement.typeParameters.map((parameter) => parameter.name),
          parameterBounds: statement.typeParameters.map((parameter) =>
            parameter.bound && isTypeParameterBound(parameter.bound) ? parameter.bound : null),
          fields,
          readonlyFields,
        };
        this.genericTypes.set(statement.name, info);
        this.genericTypesByIdentity.set(info.identity, info);
        generic.set(statement.name, { info, fields, readonlyFields });
      } else {
        this.namedTypes.set(statement.name, fields);
        this.namedTypeReadonlyFields.set(statement.name, readonlyFields);
        concrete.set(statement.name, { fields, readonlyFields });
      }
    }

    const resolved = new Set<string>();
    const resolving: string[] = [];
    const localIdentity = (name: string): string => this.namedTypeIdentities.get(name)
      ?? (this.modulePath ? `velar:${this.modulePath}#type:${name}` : name);
    const declarationName = (type: ValueType): string | null => type.kind === "named"
      ? type.application?.name ?? type.name
      : null;
    const declarationKey = (type: ValueType): string | null => {
      if (type.kind !== "named") return null;
      const name = type.application?.name ?? type.name;
      if (declarations.has(name)) return localIdentity(name);
      return type.application?.declaration ?? type.identity ?? type.name;
    };

    const resolveDeclaration = (statement: TypeDeclaration): void => {
      if (resolved.has(statement.name)) return;
      if (resolving.includes(statement.name)) return;
      resolving.push(statement.name);
      const target = concrete.get(statement.name) ?? generic.get(statement.name)!;
      const withParameters = <T>(action: () => T): T => statement.typeParameters?.length
        ? this.withTypeParameterFrame(this.typeParameterFrame(statement.typeParameters), action)
        : action();
      withParameters(() => {
        let inherited = new Map<string, ValueType>();
        let inheritedReadonly = new Set<string>();
        if (statement.base) {
          let base = this.resolveAnnotation(statement.base);
          const baseName = declarationName(base);
          const localBase = baseName ? declarations.get(baseName) : undefined;
          if (localBase && !resolving.includes(localBase.name)) {
            resolveDeclaration(localBase);
            base = this.resolveAnnotation(statement.base);
          }
          this.namedTypeBases.set(statement.name, base);
          this.namedTypeBases.set(localIdentity(statement.name), base);
          const baseFields = base.kind === "named" ? this.fieldsOf(base.identity ?? base.name) : null;
          if (baseFields) inherited = new Map(baseFields);
          const readonly = base.kind === "named" ? this.readonlyFieldsOf(base.identity ?? base.name) : null;
          if (readonly) inheritedReadonly = new Set(readonly);
        }
        this.inheritedTypeFields.set(statement, new Set(inherited.keys()));
        for (const [name, type] of inherited) target.fields.set(name, type);
        for (const name of inheritedReadonly) target.readonlyFields.add(name);
        for (const field of statement.fields) {
          target.fields.set(field.name, this.resolveAnnotation(field.type));
          if (field.readonly) target.readonlyFields.add(field.name);
        }
        if (statement.readonly) {
          for (const name of target.fields.keys()) target.readonlyFields.add(name);
        }
        this.typeDeclarationFields.set(statement.span.start, [...target.fields].map(([name, type]) => ({ name, type })));
      });
      resolving.pop();
      resolved.add(statement.name);
    };

    for (const statement of declarations.values()) resolveDeclaration(statement);

    // The direct edge is preserved separately from the flattened fields, so a
    // cycle that crosses module boundaries cannot stabilize into an apparently
    // valid structural map during the project interface fixed point.
    for (const statement of declarations.values()) {
      if (!statement.base) continue;
      const start = localIdentity(statement.name);
      const path = [start];
      let current = start;
      const seen = new Set([start]);
      while (true) {
        const base = this.namedTypeBases.get(current);
        const next = base ? declarationKey(base) : null;
        if (!next) break;
        path.push(next);
        if (next === start) {
          const display = path.map((identity) => identity.replace(/^.*#type:/u, "")).join(" -> ");
          this.diagnostics.push(diagnostic("VEL4017", `Type inheritance is cyclic: ${display}`, statement.base.span));
          this.invalidDeclaredTypes.add(statement.name);
          break;
        }
        if (seen.has(next)) break;
        seen.add(next);
        current = next;
      }
    }
  }

  private registerEnumShapes(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "EnumDeclaration") continue;
      this.enums.set(statement.name, {
        identity: statement.name,
        members: new Set(statement.members.map((member) => member.name)),
        wireValues: new Map(statement.members.map((member) => [member.name, member.value])),
      });
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
          ? {
            dispose: blockContainsDirectAwait(
              statement.dispose.body,
              (expression, contains) => this.extensionExpressionContainsDirectAwait(expression, contains),
              (owned, containsExpression, containsBlock) => this.extensionStatementContainsDirectAwait(owned, containsExpression, containsBlock),
            ) ? "async" : "sync",
          }
          : {}),
        // D68 rule 177: `@iterate:` carries no annotation, so its answer comes
        // from the body — the same shape as an omitted function result, and it
        // rides the same seeded convergence passes. The shape pre-pass seeds
        // what the previous pass learned so a use written above the class sees
        // the real collection instead of the placeholder. D90 R18: an optional
        // seed is the asynchronous pull form — a collection can never validate
        // to `T?` — so the seed's shape says which field it belongs in.
        ...(statement.iterate ? this.seededIterationInfo(statement.iterate) : {}),
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
              importTypeNamePosition(statement, specifier),
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
                    this.diagnostics.push(diagnostic("VEL4018", asyncResultAnnotationMessage, method.returnType.span));
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
                this.diagnostics.push(diagnostic("VEL4018", asyncResultAnnotationMessage, declaration.returnType.span));
              } else if (valid) {
                if (declaration.asynchronous) this.reportPromiseResolutionHazard(result, declaration.returnType.span);
                else this.reportPromiseCarrierHazard(result, declaration.returnType.span);
              }
            }
          });
        }
        break;
      case "EmbeddedJavaScriptDeclaration": {
        if (this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic(
            "VEL3011",
            "Inline JavaScript blocks can only be declared at module scope",
            statement.span,
          ));
        }
        for (const capture of statement.captures) {
          const annotationValid = this.validateTypeReference(capture.type);
          const declared = this.resolveValidatedAnnotation(capture.type);
          const value: Expression = {
            kind: "IdentifierExpression",
            name: capture.name,
            span: capture.nameSpan,
          };
          const actual = this.inferExpression(value, declared);
          if (annotationValid) this.requireAssignable(actual, declared, capture.nameSpan);
        }
        break;
      }
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
        // D102 ruling 1: wire values are unique by *value identity*, across the
        // string and integer kinds alike. Keying on the value itself is exactly
        // that rule — a Map separates the string `"2"` from the number `2`, so
        // both may stand in one enum, which is right because neither parses as
        // the other. `JSON.stringify` in the report keeps the two spellings
        // apart on the page as well.
        const serializedValues = new Map<string | number, string>();
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
        const actual = this.inferExpression(statement.initializer, annotationValid ? annotated ?? unknownType : invalidType);
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
        // D85 rule 209: the construction that just reported is invalid from
        // here on. Binding the name to the hole instead would reproduce
        // `Cannot assign List<unknown> to ...` on a later line that has no
        // `[]` in it — the second, contradicting report the ruling deletes.
        // D90 R12: `any` may not cross a module boundary. The written spelling
        // is already refused by validateTypeReference above, so only the
        // inferred one reaches here — and that asymmetry was the defect, since
        // the spelling that got refused is the honest one. Checking the
        // settled type before declarePattern covers every pattern shape at
        // once, including `export const {a, b} = thing`.
        if (statement.exported && annotationValid && typeContainsAnyOutput(declared)) {
          const exported: string[] = [];
          this.collectPatternNames(statement.pattern, (name) => exported.push(name));
          this.reportExportedAny(exported, statement.span);
        }
        const unsettled = this.requireSettledCollectionElement(statement.initializer, declared, annotated !== null);
        this.declarePattern(statement.pattern, statement.binding === "let", unsettled ? invalidType : declared, unsettled ? invalidType : contract);
        if (statement.binding === "const" && statement.pattern.kind === "NameBindingPattern") {
          const declaredBinding = this.scopes.at(-1)?.get(statement.pattern.name);
          if (declaredBinding) declaredBinding.stableOptionalCopy = true;
        }
        if (annotated === null) this.recordBindingHoleSource(statement.pattern, statement.initializer, unsettled);
        this.claimArrowDeferredFrame(statement.pattern, statement.initializer);
        // D51 rule 101: an alias of an owned handle — or a closure over one —
        // is the same resource under a second name, so it inherits the
        // ownership and the escape check follows it.
        if (statement.pattern.kind === "NameBindingPattern") {
          const carried = this.carriedOwnedResource(statement.initializer);
          const declaredBinding = carried ? this.scopes.at(-1)?.get(statement.pattern.name) : null;
          if (carried && declaredBinding) declaredBinding.ownedResource = carried;
        }
        this.validateKnownBindingShape(statement.pattern, statement.initializer);
        // D44 rule 71: the initializer's type is a fact for each declared
        // binding — `const x: string? = "a"` reads as string until a write
        // says otherwise.
        if (annotationValid) this.establishAssignedPatternFacts(statement.pattern, actual);
        if (statement.pattern.kind === "NameBindingPattern") {
          const binding = this.scopes.at(-1)?.get(statement.pattern.name);
          if (binding?.span.start === statement.pattern.span.start && binding.span.end === statement.pattern.span.end) {
            if (this.expandAliases(actual).kind === "promise") this.promiseInitializerBindings.add(binding);
          }
        }
        break;
      }
      case "MainBlock": {
        if (this.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "'@main' can only be declared at module scope", statement.keywordSpan));
        }
        if ((this.modulePath ?? "").endsWith(".test.vel")) {
          this.diagnostics.push(diagnostic(
            "VEL3011",
            "A test module declares named 'test' blocks and cannot also declare an '@main' program entry",
            statement.keywordSpan,
          ));
        }
        // 依赖模块的正文仍要完整类型检查，但它不会在这次程序中执行，所以其中的
        // 导入读取不能被误记成依赖模块的初始化读取。入口模块则保留真实的初始化
        // 语义，继续参与循环导入检查和宿主错误归一化。
        if (!this.executeMain) this.deferredExecutionDepth += 1;
        try {
          this.analyzeBlock(statement.body);
        } finally {
          if (!this.executeMain) this.deferredExecutionDepth -= 1;
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
        // D51 rule 101: a return always leaves the scope that releases.
        if (statement.value) this.rejectOwnedResourceEscape(statement.value, "returning it", statement.value.span);
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
          // D85 rule 207: a body-inferred result has no annotation to settle
          // an empty collection, and the name that reads it can be in another
          // module — `export def make(): return []` publishes `List<unknown>`
          // across the interface. An annotated result is a contextual type and
          // settles the construction before it ever gets here. Rule 209: a
          // reported hole contributes `invalidType`, so the caller's
          // `const values: List<string> = make()` does not report the same
          // mistake a second time in a line that has no `[]` in it.
          const unsettled = statement.value !== null && this.requireSettledCollectionElement(statement.value, actual, false);
          if (returnContext) {
            // The hole reaches the result through whatever the author wrote
            // between it and the `return` — a name, a chain of them, or a call
            // to a local function whose own VEL4039 already reported. Each of
            // those is the same one mistake, so the convergence failure it
            // produces below is not a second problem to report.
            const causes = returnContext.resultHoleCauses ?? new Set<string>();
            const carried = statement.value !== null && this.collectResultHoleSources(statement.value, causes);
            if (causes.size > 0) returnContext.resultHoleCauses = causes;
            if (unsettled || carried) returnContext.unsettledResult = true;
          }
          if (this.unreachableDiagnosticDepth === 0) inferredReturns.push(unsettled ? invalidType : returned);
          break;
        }
        if (this.unreachableDiagnosticDepth === 0) returnContext?.observedReturns?.push(returned);
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
        const inferredIterable = this.inferExpression(statement.iterable);
        if (!statement.asynchronous
          && statement.secondPattern === null
          && statement.pattern.kind === "NameBindingPattern"
          && statement.iterable.kind === "CallExpression"
          && statement.iterable.callee.kind === "IdentifierExpression"
          && this.builtinValueReferences.get(spanIdentity(statement.iterable.callee.span)) === "range") {
          this.nativeRangeForStatements.add(statement.span.start);
        }
        // D68 rule 177 + D90 R18: the eight plain consumers project through
        // the synchronous `@iterate:` answer; `async for` reads the
        // asynchronous form's declaration inside asyncPullElementType, so the
        // asynchronous side takes the operand unprojected.
        const iterable = statement.asynchronous ? inferredIterable : this.iterationSource(statement.iterable, inferredIterable);
        const binaryIterable = !statement.asynchronous && binaryStorageKind(iterable) !== null;
        if (!statement.asynchronous
          && (iterable.kind === "list" || iterable.kind === "map" || iterable.kind === "set" || iterable.kind === "record" || iterable.kind === "string")) {
          this.collectionIterations.set(statement.span.start, iterable.kind);
        } else if (binaryIterable) {
          this.collectionIterations.set(statement.span.start, "binary");
        }
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
          first = this.asyncPullElementType(iterable, statement.iterable.span, statement.span.start);
          second = numberType;
          this.asyncForStatements.add(statement.span.start);
        } else {
          first = binaryIterable ? numberType
            : iterable.kind === "list" || iterable.kind === "set"
            ? iterable.readonlyView ? this.readonlyDataViewOf(iterable.element) : iterable.element
            : iterable.kind === "map" ? iterable.readonlyView ? this.readonlyDataViewOf(iterable.key) : iterable.key
              : iterable.kind === "record" || iterable.kind === "string" ? stringType : unknownType;
          second = binaryIterable ? numberType
            : iterable.kind === "map" || iterable.kind === "record"
            ? iterable.readonlyView ? this.readonlyDataViewOf(iterable.value) : iterable.value
            : iterable.kind === "list" || iterable.kind === "set" || iterable.kind === "string" ? numberType
              : unknownType;
          if (!binaryIterable && iterable.kind !== "list" && iterable.kind !== "set" && iterable.kind !== "map" && iterable.kind !== "record" && iterable.kind !== "string" && iterable.kind !== "any") {
            this.typeError(iterable.kind === "enumObject"
              ? `Cannot iterate over the enum itself; ${iterable.name}.values() returns the members as a List — for member in ${iterable.name}.values():`
              : `Cannot iterate over ${describeType(iterable)}${this.iterationGuidance(iterable)}`, statement.iterable.span);
          }
        }
        if (!statement.asynchronous) this.adviseSwappedLoopSlots(statement, iterable);
        const baseline = this.snapshotFlowFacts();
        this.loopFlowContexts.push({ baseline, visible: this.visibleBindings(), carried: [], backEdges: [], breakFacts: [], sawBreak: false });
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
        this.reanalyzeLoopBackEdge(baseline, loopFlow.visible, backEdges, statement.body, diagnosticStart, () => {
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
        this.loopFlowContexts.push({ baseline, visible: this.visibleBindings(), carried: [], backEdges: [], breakFacts: [], sawBreak: false });
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
        // FLW-S1: a loop the body can re-enter tests its condition again in
        // the back-edge state, so the exit fact is what both tests agree on.
        let repeatedFalsy: ReadonlyMap<string, ValueType> | null = null;
        const backEdgePass = this.reanalyzeLoopBackEdge(baseline, loopFlow.visible, backEdges, statement.body, diagnosticStart, () => {
          this.clearCachedFlowTypesInSpan(statement.condition.span);
          const repeatedCondition = this.inferExpression(statement.condition);
          this.requireCondition(repeatedCondition, statement.condition);
          const repeatedTruthy = this.narrowingFor(statement.condition, repeatedCondition);
          repeatedFalsy = this.negativeNarrowingFor(statement.condition, repeatedCondition);
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
        } else {
          this.applyFlowInvalidations([bodyInvalidations, ...loopFlow.carried]);
        }
        // FLW-S1 (charter section 9): without a break the only way out is the
        // condition failing, so its negated fact holds after the loop — for
        // the common body that neither returns nor breaks, not just the body
        // that always returns. A break can leave while the condition still
        // holds, so one break drops the fact entirely.
        if (!loopFlow.sawBreak) {
          // A widened exit confirmed nothing about the back edge, so it keeps
          // nothing: the condition's fact holds only if the second test agrees.
          this.persistNarrowings(backEdgePass.widened
            ? new Map()
            : repeatedFalsy === null ? falsy : this.joinedNarrowings(falsy, repeatedFalsy));
        } else if (statement.condition.kind === "LiteralExpression" && statement.condition.value === true) {
          // FLW-N6: `while true:` has no failing condition, so its breaks are
          // its only exits, and what every one of them proves holds after the
          // loop. A loop whose condition can also fail keeps nothing: that
          // exit proves none of it.
          const breakFacts = [...loopFlow.breakFacts, ...(backEdgePass.repeated?.breakFacts ?? [])];
          if (breakFacts.length > 0 && !backEdgePass.widened) this.persistNarrowings(this.commonNarrowings(breakFacts));
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
            if (statement.kind === "BreakStatement") {
              context.sawBreak = true;
              // FLW-N6: this break is one of the loop's exits, so record what
              // it proves. The merge after the loop keeps only what every
              // exit agrees on.
              context.breakFacts.push(this.narrowingsForVisibleBindings(context.visible));
            }
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
      case "DetachStatement":
        this.analyzeDetachStatement(statement);
        break;
    }
  }

  /**
   * D89 A2: the two-slot `for` over a List, Set, or string binds
   * `value, index`, which matches JavaScript's `forEach((v, i) => …)` and
   * inverts Python's `enumerate`. Python's own spelling is already a loud
   * error, so nothing silent comes from it; the silence happens when a model
   * writes `for i, v in nums`, a hybrid neither language has, and both names
   * quietly hold the other one's value.
   *
   * Both rosters must hit. One name alone proves nothing — `for index, total
   * in scores` may be counting exactly what it says — and a wrong guess here
   * would tell a correct author to break working code. The value slot also
   * accepts the singular of the collection's own name, because `for i, user
   * in users` is the same reflex spelled from the data instead of a letter.
   */
  private adviseSwappedLoopSlots(statement: ForStatement, iterable: ValueType): void {
    if (iterable.kind !== "list" && iterable.kind !== "set" && iterable.kind !== "string") return;
    const indexSlot = statement.pattern;
    const valueSlot = statement.secondPattern;
    if (indexSlot.kind !== "NameBindingPattern" || valueSlot?.kind !== "NameBindingPattern") return;
    if (!loopIndexSlotNames.has(indexSlot.name)) return;
    if (!loopValueSlotNames.has(valueSlot.name) && valueSlot.name !== singularIterableName(statement.iterable)) return;
    this.advise(
      "A2",
      `A two-slot 'for' binds 'value, index', so '${indexSlot.name}' receives the element and '${valueSlot.name}' receives the position; write 'for ${valueSlot.name}, ${indexSlot.name} in ...' to bind them the way the names read`,
      span(indexSlot.span.start, valueSlot.span.end),
      mechanicalEdits(
        [{ span: indexSlot.span, text: valueSlot.name }, { span: valueSlot.span, text: indexSlot.name }],
        `Swap '${indexSlot.name}' and '${valueSlot.name}'`,
      ),
    );
  }

  /**
   * A7: an adjacent empty collection plus an identity-only copy loop has one
   * compiler-owned spelling. Unlike A1-A6 this is not a foreign-language
   * spelling with different semantics; it is the deliberately narrow
   * canonicalization exception admitted after those advisories. The trigger
   * proves the replacement is the same fresh collection in the same order:
   *
   *     const result: List<string> = []
   *     for value in values:
   *         result.append(value)
   *
   * becomes an initialization from `values.values()`. Any intervening
   * statement, non-name source, transform, filter, second body statement, or
   * non-empty destination withholds the advisory. Those shapes need judgment,
   * and a canonicalization warning that guesses is only lint noise.
   */
  private adviseManualCollectionConversion(previous: Statement | null, statement: Statement): void {
    if (previous?.kind !== "VariableDeclaration" || statement.kind !== "ForStatement") return;
    if (statement.asynchronous || previous.pattern.kind !== "NameBindingPattern") return;
    if (statement.iterable.kind !== "IdentifierExpression") return;

    const targetName = previous.pattern.name;
    if (statement.iterable.name === targetName) return;
    let shadowsTarget = false;
    this.collectPatternNames(statement.pattern, (name) => { if (name === targetName) shadowsTarget = true; });
    if (statement.secondPattern) this.collectPatternNames(statement.secondPattern, (name) => { if (name === targetName) shadowsTarget = true; });
    if (shadowsTarget) return;
    const targetBinding = this.lookup(targetName);
    if (!targetBinding || targetBinding.span.start !== previous.pattern.span.start || targetBinding.span.end !== previous.pattern.span.end) return;
    const target = this.expandAliases(targetBinding.storageType);
    if (!this.isEmptyCollectionInitializer(previous.initializer, target.kind)) return;

    if (statement.body.length !== 1 || statement.body[0]!.kind !== "ExpressionStatement") return;
    const call = statement.body[0]!.expression;
    if (call.kind !== "CallExpression" || call.optional || call.callee.kind !== "MemberExpression" || call.callee.optional) return;
    if (call.callee.object.kind !== "IdentifierExpression" || call.callee.object.name !== targetName) return;

    const source = this.expandAliases(this.inferredExpressionType(statement.iterable));
    const operation = this.collectionCalls.get(call.callee.span.end);
    const replacement = this.manualCollectionReplacement(target.kind, source.kind, operation, call, statement, statement.iterable.name);
    if (replacement === null) return;

    this.advise(
      "A7",
      `This empty ${describeType(target)} is filled only by copying '${statement.iterable.name}' in iteration order; '${replacement}' already creates the same fresh ${describeType(target)}. Initialize '${targetName}' with '${replacement}' instead of writing this loop`,
      statement.iterable.span,
      this.commentPreservingMechanicalFix(
        span(previous.initializer.span.start, statement.span.end),
        replacement,
        `Initialize '${targetName}' with '${replacement}'`,
      ),
    );
  }

  private isEmptyCollectionInitializer(initializer: Expression, targetKind: ValueType["kind"]): boolean {
    if (targetKind === "list") return initializer.kind === "ListExpression" && initializer.elements.length === 0;
    if (targetKind !== "set" && targetKind !== "map") return false;
    return initializer.kind === "CallExpression"
      && !initializer.optional
      && initializer.arguments.length === 0
      && initializer.callee.kind === "IdentifierExpression"
      && initializer.callee.name === (targetKind === "set" ? "Set" : "Map");
  }

  private manualCollectionReplacement(
    targetKind: ValueType["kind"],
    sourceKind: ValueType["kind"],
    operation: CollectionOperation | undefined,
    call: Extract<Expression, { kind: "CallExpression" }>,
    loop: ForStatement,
    sourceName: string,
  ): string | null {
    if (targetKind === "list" && operation === "listAppend") {
      const [value] = this.orderedDirectCallArguments(call, ["value"]);
      const slot = value ? this.manualCollectionLoopSlot(loop, value) : null;
      if (slot === null) return null;
      if (sourceKind === "list" && slot === "first") return `${sourceName}.copy()`;
      if (sourceKind === "set" && slot === "first") return `${sourceName}.values()`;
      if ((sourceKind === "map" || sourceKind === "record") && slot === "first") return `${sourceName}.keys()`;
      if ((sourceKind === "map" || sourceKind === "record") && slot === "second") return `${sourceName}.values()`;
      return null;
    }

    if (targetKind === "set" && operation === "setAdd") {
      const [value] = this.orderedDirectCallArguments(call, ["value"]);
      const slot = value ? this.manualCollectionLoopSlot(loop, value) : null;
      if (slot === null) return null;
      if (sourceKind === "list" && slot === "first") return `Set(${sourceName})`;
      if (sourceKind === "set" && slot === "first") return `${sourceName}.copy()`;
      if ((sourceKind === "map" || sourceKind === "record") && slot === "first") return `Set(${sourceName}.keys())`;
      if ((sourceKind === "map" || sourceKind === "record") && slot === "second") return `Set(${sourceName}.values())`;
      return null;
    }

    if (targetKind === "map" && operation === "mapSet" && (sourceKind === "map" || sourceKind === "record")) {
      const [key, value] = this.orderedDirectCallArguments(call, ["key", "value"]);
      if (!key || !value || this.manualCollectionLoopSlot(loop, key) !== "first" || this.manualCollectionLoopSlot(loop, value) !== "second") return null;
      return sourceKind === "map" ? `${sourceName}.copy()` : `Map(${sourceName})`;
    }

    return null;
  }

  private orderedDirectCallArguments(
    call: Extract<Expression, { kind: "CallExpression" }>,
    parameterNames: readonly string[],
  ): readonly (Expression | null)[] {
    if (call.arguments.length !== parameterNames.length || call.arguments.some((argument) => argument.kind === "SpreadExpression")) {
      return parameterNames.map(() => null);
    }
    const ordered: (Expression | null)[] = parameterNames.map(() => null);
    let positional = 0;
    for (const [index, argument] of call.arguments.entries()) {
      const named = call.argumentNames?.[index] ?? null;
      const target = named === null ? positional++ : parameterNames.indexOf(named);
      if (target < 0 || target >= ordered.length || ordered[target] !== null) return parameterNames.map(() => null);
      ordered[target] = argument;
    }
    return ordered;
  }

  private manualCollectionLoopSlot(loop: ForStatement, expression: Expression): "first" | "second" | null {
    if (expression.kind !== "IdentifierExpression") return null;
    if (loop.pattern.kind === "NameBindingPattern" && expression.name === loop.pattern.name) return "first";
    if (loop.secondPattern?.kind === "NameBindingPattern" && expression.name === loop.secondPattern.name) return "second";
    return null;
  }

  /**
   * A13: a fresh List filled by one pure projection, with an optional pure
   * guard, is the expanded form of List.map or List.filter(...).map(...).
   *
   * This stays deliberately narrower than a general loop-style lint. List
   * pipelines snapshot their input while a `for` observes live growth, so the
   * proof accepts only stable List data, stable data reads/operators, and the
   * compiler-owned pure `Type.from(value)` projection. Calls, getters, index
   * reads, writes, a second body statement, two-slot loops, and reads from the
   * destination keep the loop silent.
  */
  private adviseManualListPipeline(previous: Statement | null, statement: Statement): void {
    if (previous?.kind !== "VariableDeclaration" || statement.kind !== "ForStatement") return;
    if (statement.asynchronous || statement.pattern.kind !== "NameBindingPattern") return;
    if (statement.secondPattern !== null && statement.secondPattern.kind !== "NameBindingPattern") return;
    if (previous.pattern.kind !== "NameBindingPattern") return;

    const targetName = previous.pattern.name;
    const itemName = statement.pattern.name;
    const indexName = statement.secondPattern?.name ?? null;
    if (itemName === targetName) return;
    if (indexName === targetName || indexName === itemName) return;
    const targetBinding = this.lookup(targetName);
    if (!targetBinding || targetBinding.span.start !== previous.pattern.span.start || targetBinding.span.end !== previous.pattern.span.end) return;
    const target = this.expandAliases(targetBinding.storageType);
    if (target.kind !== "list" || !this.isEmptyCollectionInitializer(previous.initializer, "list")) return;

    const source = this.expandAliases(this.inferredExpressionType(statement.iterable));
    if (source.kind !== "list") return;
    const sourceSpelling = this.manualListPipelineSourceSpelling(statement.iterable, targetName);
    if (sourceSpelling === null) return;

    let predicate: string | null = null;
    let appendStatement: Statement | null = statement.body[0] ?? null;
    if (statement.body.length !== 1) return;
    if (appendStatement?.kind === "IfStatement") {
      // Filtering changes the position seen by a following map. Keep an
      // indexed guarded loop explicit until one pipeline operator can preserve
      // the original position across both steps.
      if (indexName !== null) return;
      if (appendStatement.elseBody !== null || appendStatement.thenBody.length !== 1) return;
      const condition = this.expandAliases(this.inferredExpressionType(appendStatement.condition));
      if (!sameType(condition, boolType)) return;
      predicate = this.manualListPipelineExpressionSpelling(appendStatement.condition, new Set([targetName]));
      if (predicate === null) return;
      appendStatement = appendStatement.thenBody[0] ?? null;
    }

    const write = this.manualListPipelineWrite(appendStatement, targetName);
    if (write === null) return;
    const transform = this.manualListPipelineExpressionSpelling(write.value, new Set([targetName]));
    if (transform === null) return;
    // The `if` body can read a value under a flow fact, while a later `map`
    // callback is analyzed independently from the preceding `filter`. Keep the
    // conservative boundary at every narrowed projection: some facts may come
    // from an enclosing branch and survive the rewrite, but admitting those
    // would require proving their origin. This guarantees the advertised
    // pipeline compiles (notably for `row.label != null` then `row.label`).
    if (predicate !== null && this.expressionUsesRuntimeNarrowing(write.value)) return;

    const identity = write.operation === "append"
      && write.value.kind === "IdentifierExpression"
      && write.value.name === itemName;
    // A7 already owns the unfiltered identity copy and names List.copy().
    if (predicate === null && identity) return;
    const filtered = predicate === null ? sourceSpelling : `${sourceSpelling}.filter(${itemName} => ${predicate})`;
    const projection = write.operation === "extend" ? "flatMap" : "map";
    const parameters = indexName === null ? itemName : `(${itemName}, ${indexName})`;
    const replacement = identity ? filtered : `${filtered}.${projection}(${parameters} => ${transform})`;
    const operation = predicate === null
      ? `List.${projection}`
      : identity ? "List.filter" : `List.filter(...).${projection}`;
    this.advise(
      "A13",
      `This empty List is filled only by a pure per-item ${predicate === null ? "projection" : "filter and projection"}; ${operation} is the canonical collection pipeline. Initialize '${targetName}' with '${replacement}' instead of writing this loop`,
      statement.iterable.span,
      this.commentPreservingMechanicalFix(
        span(previous.initializer.span.start, statement.span.end),
        replacement,
        `Initialize '${targetName}' with a collection pipeline`,
      ),
    );
  }

  private manualListPipelineSourceSpelling(expression: Expression, targetName: string): string | null {
    if (expression.kind === "IdentifierExpression") return expression.name === targetName ? null : expression.name;
    if (expression.kind !== "MemberExpression" || expression.optional || !this.stableDataMember(expression.object, expression.property)) return null;
    const object = this.manualListPipelineSourceSpelling(expression.object, targetName);
    return object === null ? null : `${object}.${expression.property}`;
  }

  private manualListPipelineWrite(
    statement: Statement | null,
    targetName: string,
  ): { readonly operation: "append" | "extend"; readonly value: Expression } | null {
    if (statement?.kind !== "ExpressionStatement") return null;
    const call = statement.expression;
    if (call.kind !== "CallExpression" || call.optional || call.callee.kind !== "MemberExpression" || call.callee.optional) return null;
    if (call.callee.object.kind !== "IdentifierExpression" || call.callee.object.name !== targetName) return null;
    const operation = this.collectionCalls.get(call.callee.span.end);
    if (operation !== "listAppend" && operation !== "listExtend") return null;
    const [value] = this.orderedDirectCallArguments(call, [operation === "listAppend" ? "value" : "values"]);
    return value ? { operation: operation === "listAppend" ? "append" : "extend", value } : null;
  }

  /** True when this expression was accepted using a flow fact from its branch. */
  private expressionUsesRuntimeNarrowing(expression: Expression): boolean {
    for (const key of this.runtimeNarrowings.keys()) {
      const separator = key.indexOf(":");
      if (separator < 0) continue;
      const start = Number(key.slice(0, separator));
      const end = Number(key.slice(separator + 1));
      if (start >= expression.span.start && end <= expression.span.end) return true;
    }
    return false;
  }

  /** Rebuilds the pure data-expression subset admitted inside an A13 pipeline. */
  private manualListPipelineExpressionSpelling(
    expression: Expression,
    forbiddenNames: ReadonlySet<string>,
    nested = false,
  ): string | null {
    switch (expression.kind) {
      case "LiteralExpression":
        return expression.raw;
      case "IdentifierExpression":
        return forbiddenNames.has(expression.name) ? null : expression.name;
      case "MemberExpression": {
        if (!this.canonicalCollectionMemberReadIsStable(expression)) return null;
        const object = this.manualListPipelineExpressionSpelling(expression.object, forbiddenNames, true);
        return object === null ? null : `${object}${expression.optional ? "?." : "."}${expression.property}`;
      }
      case "UnaryExpression": {
        if (expression.operator === "await") return null;
        const operand = this.manualListPipelineExpressionSpelling(expression.operand, forbiddenNames, true);
        if (operand === null) return null;
        const spelling = `${expression.operator === "not" ? "not " : expression.operator}${operand}`;
        return nested ? `(${spelling})` : spelling;
      }
      case "BinaryExpression": {
        const left = this.manualListPipelineExpressionSpelling(expression.left, forbiddenNames, true);
        const right = this.manualListPipelineExpressionSpelling(expression.right, forbiddenNames, true);
        if (left === null || right === null) return null;
        const spelling = `${left} ${expression.operator} ${right}`;
        return nested ? `(${spelling})` : spelling;
      }
      case "ComparisonChainExpression": {
        const operands = expression.operands.map((operand) => this.manualListPipelineExpressionSpelling(operand, forbiddenNames, true));
        if (operands.some((operand) => operand === null)) return null;
        let spelling = operands[0]!;
        for (let index = 0; index < expression.operators.length; index += 1) {
          spelling += ` ${expression.operators[index]} ${operands[index + 1]}`;
        }
        return nested ? `(${spelling})` : spelling;
      }
      case "ConditionalExpression": {
        const condition = this.manualListPipelineExpressionSpelling(expression.condition, forbiddenNames, true);
        const thenValue = this.manualListPipelineExpressionSpelling(expression.thenValue, forbiddenNames, true);
        const elseValue = this.manualListPipelineExpressionSpelling(expression.elseValue, forbiddenNames, true);
        if (condition === null || thenValue === null || elseValue === null) return null;
        const spelling = `${condition} ? ${thenValue} : ${elseValue}`;
        return nested ? `(${spelling})` : spelling;
      }
      case "FStringExpression": {
        for (const part of expression.parts) {
          if (part.kind === "expression" && this.manualListPipelineExpressionSpelling(part.value, forbiddenNames) === null) return null;
        }
        const written = this.sourceText.slice(expression.span.start, expression.span.end);
        return written.length > 0 ? written : null;
      }
      case "CallExpression": {
        if (expression.optional || expression.arguments.length !== 1 || expression.argumentNames?.some((name) => name !== null)) return null;
        if (expression.callee.kind === "IdentifierExpression" && expression.callee.name === "str") {
          const argument = this.manualListPipelineExpressionSpelling(expression.arguments[0]!, forbiddenNames);
          return argument === null ? null : `str(${argument})`;
        }
        if (!this.recordFromCalls.has(spanIdentity(expression.span))) return null;
        if (expression.callee.kind !== "MemberExpression" || expression.callee.optional
          || expression.callee.property !== "from" || expression.callee.object.kind !== "IdentifierExpression") return null;
        const argument = this.manualListPipelineExpressionSpelling(expression.arguments[0]!, forbiddenNames);
        return argument === null ? null : `${expression.callee.object.name}.from(${argument})`;
      }
      default: {
        for (const extension of this.analysisExtensions) {
          const accepted = extension.canonicalCollectionProjection?.(
            expression,
            (child) => this.manualListPipelineExpressionSpelling(child, forbiddenNames) !== null,
          );
          if (accepted === undefined) continue;
          if (!accepted) return null;
          const written = this.sourceText.slice(expression.span.start, expression.span.end);
          return written.length > 0 ? written : null;
        }
        return null;
      }
    }
  }

  /**
   * A8: the exact early-return List queries have compiler-owned spellings:
   * `some`, `every`, and `find`. This is a proof, not a general loop-style
   * preference. The source is a plain List binding, the loop has one name
   * slot, and the predicate is a non-optional bool made only from data reads
   * and operators. A call or class member can hide a mutation/getter, and List
   * iteration is live while query methods snapshot their inputs, so either
   * shape keeps the expanded loop silent.
   */
  private adviseManualListQuery(previous: Statement | null, statement: Statement): void {
    if (previous?.kind !== "ForStatement" || statement.kind !== "ReturnStatement") return;
    if (this.functionDepth === 0 || this.constructorDepth > 0 || this.finallyLoopDepths.length > 0) return;
    if (previous.asynchronous || previous.secondPattern !== null || previous.pattern.kind !== "NameBindingPattern") return;
    if (previous.iterable.kind !== "IdentifierExpression" || previous.iterable.name === previous.pattern.name) return;
    const iterable = this.expandAliases(this.inferredExpressionType(previous.iterable));
    if (iterable.kind !== "list") return;

    if (previous.body.length !== 1 || previous.body[0]!.kind !== "IfStatement") return;
    const branch = previous.body[0]!;
    if (branch.elseBody !== null || branch.thenBody.length !== 1 || branch.thenBody[0]!.kind !== "ReturnStatement") return;
    const condition = this.expandAliases(this.inferredExpressionType(branch.condition));
    if (!sameType(condition, boolType)) return;
    const predicate = this.manualListQueryPredicateSpelling(branch.condition);
    if (predicate === null) return;

    const sourceName = previous.iterable.name;
    const itemName = previous.pattern.name;
    const branchReturn = branch.thenBody[0]!;
    let member: "some" | "every" | "find";
    let callback = predicate;
    if (this.isBooleanLiteralReturn(branchReturn, true) && this.isBooleanLiteralReturn(statement, false)) {
      member = "some";
    } else if (this.isBooleanLiteralReturn(branchReturn, false) && this.isBooleanLiteralReturn(statement, true)) {
      member = "every";
      callback = branch.condition.kind === "UnaryExpression" && branch.condition.operator === "not"
        ? this.manualListQueryPredicateSpelling(branch.condition.operand) ?? ""
        : `not (${predicate})`;
      if (callback === "") return;
    } else if (this.isLoopSlotReturn(branchReturn, itemName) && this.isNullLiteralReturn(statement)) {
      member = "find";
    } else {
      return;
    }

    const replacement = `return ${sourceName}.${member}(${itemName} => ${callback})`;
    this.advise(
      "A8",
      `This loop is exactly a List.${member} query written as early returns. Write '${replacement}' instead`,
      previous.iterable.span,
      this.commentPreservingMechanicalFix(
        span(previous.span.start, statement.span.end),
        replacement,
        `Use '${sourceName}.${member}(...)'`,
      ),
    );
  }

  private isBooleanLiteralReturn(statement: Statement, expected: boolean): boolean {
    return statement.kind === "ReturnStatement"
      && statement.value?.kind === "LiteralExpression"
      && statement.value.value === expected;
  }

  private isNullLiteralReturn(statement: Statement): boolean {
    return statement.kind === "ReturnStatement"
      && statement.value?.kind === "LiteralExpression"
      && statement.value.value === null;
  }

  private isLoopSlotReturn(statement: Statement, itemName: string): boolean {
    return statement.kind === "ReturnStatement"
      && statement.value?.kind === "IdentifierExpression"
      && statement.value.name === itemName;
  }

  /**
   * Rebuilds only the expression subset whose evaluation cannot hide a call,
   * write, await, dynamic import, or class getter. Parenthesizing nested
   * operators preserves their AST grouping without needing the source text.
   */
  private manualListQueryPredicateSpelling(expression: Expression, nested = false): string | null {
    switch (expression.kind) {
      case "LiteralExpression":
        return expression.raw;
      case "IdentifierExpression":
        return expression.name;
      case "MemberExpression": {
        if (!this.canonicalCollectionMemberReadIsStable(expression)) return null;
        const object = this.manualListQueryPredicateSpelling(expression.object, true);
        return object === null ? null : `${object}${expression.optional ? "?." : "."}${expression.property}`;
      }
      case "UnaryExpression": {
        if (expression.operator === "await") return null;
        const operand = this.manualListQueryPredicateSpelling(expression.operand, true);
        if (operand === null) return null;
        const spelling = `${expression.operator === "not" ? "not " : expression.operator}${operand}`;
        return nested ? `(${spelling})` : spelling;
      }
      case "BinaryExpression": {
        const left = this.manualListQueryPredicateSpelling(expression.left, true);
        const right = this.manualListQueryPredicateSpelling(expression.right, true);
        if (left === null || right === null) return null;
        const spelling = `${left} ${expression.operator} ${right}`;
        return nested ? `(${spelling})` : spelling;
      }
      case "ComparisonChainExpression": {
        const operands = expression.operands.map((operand) => this.manualListQueryPredicateSpelling(operand, true));
        if (operands.some((operand) => operand === null)) return null;
        let spelling = operands[0]!;
        for (let index = 0; index < expression.operators.length; index += 1) {
          spelling += ` ${expression.operators[index]} ${operands[index + 1]}`;
        }
        return nested ? `(${spelling})` : spelling;
      }
      case "ConditionalExpression": {
        const condition = this.manualListQueryPredicateSpelling(expression.condition, true);
        const thenValue = this.manualListQueryPredicateSpelling(expression.thenValue, true);
        const elseValue = this.manualListQueryPredicateSpelling(expression.elseValue, true);
        if (condition === null || thenValue === null || elseValue === null) return null;
        const spelling = `${condition} ? ${thenValue} : ${elseValue}`;
        return nested ? `(${spelling})` : spelling;
      }
      default:
        return null;
    }
  }

  private canonicalCollectionMemberReadIsStable(expression: Extract<Expression, { kind: "MemberExpression" }>): boolean {
    const stableOwner = (type: ValueType): boolean => {
      const owner = this.expandAliases(nonOptional(type));
      if (owner.kind === "union") return owner.members.every(stableOwner);
      if (owner.kind === "object") return owner.fields.has(expression.property);
      if (owner.kind === "named") return this.fieldsOf(owner.identity ?? owner.name)?.has(expression.property) === true;
      if (owner.kind === "record") return true;
      if (owner.kind === "enumObject") return true;
      if (owner.kind === "list" || owner.kind === "set" || owner.kind === "map" || owner.kind === "string") {
        return expression.property === "size";
      }
      return false;
    };
    return stableOwner(this.inferredExpressionType(expression.object));
  }

  /**
   * A9: a closed target literal that merely mirrors the same record field by
   * field has the exact projection spelling `Target.from(source, overrides)`.
   *
   * This is intentionally narrower than a visual resemblance check. An
   * override call could mutate the source before a later manual field read,
   * so the advisory requires every target field, two or more same-name data
   * reads from one identifier, and only identifiers or literals for the
   * remaining fields. Optional omissions, computed values, calls, spreads,
   * and mixed sources all remain ordinary object literals. Authored key order
   * may differ: the report calls out that `.from` deliberately canonicalizes
   * the result to target declaration order, so an intentional wire order has
   * one honest reason to suppress it.
   */
  private adviseManualRecordProjection(
    expression: Extract<Expression, { kind: "ObjectExpression" }>,
    target: ValueType | null,
    writtenTarget: ValueType,
  ): void {
    if (target?.kind !== "named") return;
    const shape = this.recordProjectionShape(target);
    if (!shape || expression.properties.some((property) => property.kind !== "ObjectProperty")) return;
    const properties = expression.properties as readonly Extract<(typeof expression.properties)[number], { kind: "ObjectProperty" }>[];
    const targetFields = [...shape.fields.keys()];
    if (properties.length !== targetFields.length || targetFields.some((name) => !properties.some((property) => property.name === name))) return;

    let sourceName: string | null = null;
    let mirrors = 0;
    const overrides: string[] = [];
    for (const property of properties) {
      const value = property.value;
      if (value.kind === "MemberExpression"
        && !value.optional
        && value.object.kind === "IdentifierExpression"
        && value.property === property.name
        && this.stableDataMember(value.object, value.property)) {
        if (sourceName !== null && sourceName !== value.object.name) return;
        sourceName = value.object.name;
        mirrors += 1;
        continue;
      }
      if (value.kind === "IdentifierExpression") {
        overrides.push(value.name === property.name ? property.name : `${property.name}: ${value.name}`);
        continue;
      }
      if (value.kind === "LiteralExpression") {
        overrides.push(`${property.name}: ${value.raw}`);
        continue;
      }
      return;
    }
    if (sourceName === null || mirrors < 2) return;
    const sourceBinding = this.lookup(sourceName);
    if (!sourceBinding || !this.recordProjectionShape(sourceBinding.type)) return;

    const targetName = this.recordProjectionTypeName(target, writtenTarget);
    const replacement = `${targetName}.from(${sourceName}${overrides.length > 0 ? `, {${overrides.join(", ")}}` : ""})`;
    this.advise(
      "A9",
      `This ${targetName} literal mirrors ${mirrors} same-name fields from '${sourceName}'; '${replacement}' is the canonical exact projection and keeps ${targetName}'s declared field set and declaration order. Write that instead of copying the fields one by one; suppress A9 only when this literal's authored Record order is intentional`,
      expression.span,
      this.commentPreservingMechanicalFix(
        expression.span,
        replacement,
        `Use '${targetName}.from(...)'`,
      ),
    );
  }

  /**
   * A10: a large closed record literal that applies one transform to every
   * same-name field is the long form of `Target.mapFrom(source, transform)`.
   *
   * Four fields is the deliberately conservative threshold: below it the
   * literal is often clearer, while a larger block is maintenance-heavy and
   * likely to drift. Because the transform may have effects, this proof also
   * requires authored property order to equal target declaration order.
   */
  private adviseManualMappedRecordProjection(
    expression: Extract<Expression, { kind: "ObjectExpression" }>,
    target: ValueType | null,
    writtenTarget: ValueType,
  ): void {
    if (target?.kind !== "named") return;
    const shape = this.recordProjectionShape(target);
    if (!shape || expression.properties.some((property) => property.kind !== "ObjectProperty")) return;
    const properties = expression.properties as readonly Extract<(typeof expression.properties)[number], { kind: "ObjectProperty" }>[];
    const targetFields = [...shape.fields.keys()];
    if (targetFields.length < 4 || properties.length !== targetFields.length) return;
    if (properties.some((property, index) => property.name !== targetFields[index])) return;

    let sourceName: string | null = null;
    let transformName: string | null = null;
    for (const property of properties) {
      const value = property.value;
      if (value.kind !== "CallExpression"
        || value.optional
        || value.callee.kind !== "IdentifierExpression"
        || value.arguments.length !== 1
        || value.argumentNames?.some((name) => name !== null)) return;
      const argument = value.arguments[0];
      if (!argument || argument.kind !== "MemberExpression"
        || argument.optional
        || argument.object.kind !== "IdentifierExpression"
        || argument.property !== property.name
        || !this.stableDataMember(argument.object, argument.property)) return;
      if (sourceName !== null && sourceName !== argument.object.name) return;
      if (transformName !== null && transformName !== value.callee.name) return;
      sourceName = argument.object.name;
      transformName = value.callee.name;
    }
    if (sourceName === null || transformName === null) return;
    const sourceBinding = this.lookup(sourceName);
    const transformBinding = this.lookup(transformName);
    if (!sourceBinding || !this.recordProjectionShape(sourceBinding.type)) return;
    const transformType = transformBinding ? this.expandAliases(transformBinding.type) : null;
    if (!transformType || (transformType.kind !== "function" && transformType.kind !== "action")) return;

    const targetName = this.recordProjectionTypeName(target, writtenTarget);
    const replacement = `${targetName}.mapFrom(${sourceName}, ${transformName})`;
    this.advise(
      "A10",
      `This ${targetName} literal repeats '${transformName}(${sourceName}.field)' for all ${targetFields.length} fields; '${replacement}' maps the complete target field table in declaration order. Write that instead of maintaining one conversion per field`,
      expression.span,
      this.commentPreservingMechanicalFix(
        expression.span,
        replacement,
        `Use '${targetName}.mapFrom(...)'`,
      ),
    );
  }

  /** Returns a name that is legal in the Type-object position of the fix. */
  private recordProjectionTypeName(target: Extract<ValueType, { kind: "named" }>, writtenTarget: ValueType): string {
    if (writtenTarget.kind === "named" && this.lookup(writtenTarget.name)?.type.kind === "typeObject") {
      return writtenTarget.name;
    }
    for (const [name, alias] of this.typeAliases) {
      if (sameType(this.expandAliases(alias), target)) return name;
    }
    return target.name;
  }

  /**
   * A canonical-form advisory may offer an editor fix only when replacing its
   * proven-equivalent syntax cannot silently discard an authored comment.
   * Both line and block comments conservatively withhold the fix, which is
   * preferable to erasing prose.
   */
  private commentPreservingMechanicalFix(rewriteSpan: Span, replacement: string, title: string): DiagnosticFix | undefined {
    const written = this.sourceText.slice(rewriteSpan.start, rewriteSpan.end);
    if (written.includes("//") || written.includes("/*")) return undefined;
    return mechanicalFix(rewriteSpan, replacement, title);
  }

  /**
   * A15: `{name: name}` and `{name}` are the same record entry when both
   * occurrences are ordinary identifiers. Quoted and keyword-named keys are
   * deliberately excluded: the AST keeps their decoded value, so comparing
   * names alone would erase syntax the author actually wrote. Parenthesized,
   * member, call, and every different-name value remain ordinary mappings.
   *
   * The edit owns only the entry, never its comma or surrounding layout. A
   * comment between the key and value withholds the edit rather than dropping
   * prose; a trailing comment sits outside the entry span and is preserved.
   */
  private adviseRedundantObjectProperty(
    property: Extract<Expression, { kind: "ObjectExpression" }>["properties"][number] & { kind: "ObjectProperty" },
  ): void {
    if (!property.sameNameIdentifierValue) return;
    this.advise(
      "A15",
      `Object field '${property.name}' repeats the same-name identifier it reads; use the shorthand '{${property.name}}'`,
      property.span,
      this.commentPreservingMechanicalFix(property.span, property.name, `Use object shorthand '${property.name}'`),
    );
  }

  /**
   * D114 ⑤ — A17: Python's `return a, b` and JavaScript's `return [a, b]` both
   * land here as a List literal whose elements are of different types. Vel
   * accepts it and types it `List<string | number>`, so the author does not
   * learn anything until a member read three lines later reports "no common
   * field". The record is the spelling this language has for a fixed group of
   * differently typed values, and it gives each value a name.
   *
   * The admission is deliberately narrow, at D89's near-zero-false-positive
   * bar. Two or more written elements, every one of them in a primitive
   * category — string, number, bool, or enum — and at least two different
   * categories among them. A `null` element is ignored rather than counted:
   * `["a", null]` is a `List<string?>`, which is one element type. Anything
   * else in the literal — a spread, a record, a class, a collection, a
   * function, a union, `unknown` — keeps the whole literal silent, because a
   * heterogeneous list of records is a real data shape and this advisory may
   * not guess. Two different enums are one category, so `[Kind.a, Status.b]`
   * is silent as well.
   *
   * The literal must also stand where nothing declared its element type. An
   * annotated binding, a declared result, an annotated field, and an argument
   * to a `List<string | number>` parameter all arrive here with a contextual
   * type: the author wrote the union, and the advisory has nothing to say. An
   * unannotated binding, a body-inferred `return`, and an arrow body with no
   * contextual function type arrive with none.
   *
   * There is no mechanical fix. The rewrite has to invent a field name for
   * each value, which is a judgement, exactly as A7's is.
   */
  private adviseTupleShapedListLiteral(
    expression: Extract<Expression, { kind: "ListExpression" }>,
    contextualType: ValueType,
    writtenElementTypes: readonly ValueType[],
    element: ValueType,
  ): void {
    if (contextualType.kind !== "unknown" || contextualType.boundary === true) return;
    if (expression.elements.length < 2 || writtenElementTypes.length !== expression.elements.length) return;

    const categories = new Set<string>();
    for (const type of writtenElementTypes) {
      const category = this.tupleElementCategory(type);
      if (category === null) return;
      if (category !== "") categories.add(category);
    }
    if (categories.size < 2) return;

    const quoted = this.boundedSourceQuote(expression.span);
    const record = this.tupleRecordSpelling(expression, writtenElementTypes);
    this.advise(
      "A17",
      `A List holds one element type, so every value read back out of ${quoted} is '${describeType(element)}'. VelarScript spells a fixed group of differently typed values as a record, which gives each one a name — ${record === null ? "write '{name: value, ...}' with a field per value" : `write '${record}'`}, or declare a type for it`,
      expression.span,
    );
  }

  /**
   * A17's element classification. Answers the primitive category an element
   * contributes, `""` for an element that is ignored (`null`, and the `null`
   * arm of an optional), and `null` for one that keeps the whole literal
   * silent.
   */
  private tupleElementCategory(type: ValueType): string | null {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "optional") return this.tupleElementCategory(expanded.inner);
    switch (expanded.kind) {
      case "null": return "";
      case "string": return "string";
      case "number": return "number";
      case "bool": return "bool";
      case "enum":
      case "enumMember": return "enum";
      default: return null;
    }
  }

  /** The record an A17 literal would be written as, or null when it is too long to quote. */
  private tupleRecordSpelling(
    expression: Extract<Expression, { kind: "ListExpression" }>,
    writtenElementTypes: readonly ValueType[],
  ): string | null {
    const names: string[] = [];
    for (const [index, item] of expression.elements.entries()) {
      const name = this.tupleFieldName(item, writtenElementTypes[index]!);
      names.push(names.includes(name) ? `${name}${index + 1}` : name);
    }
    const entries = expression.elements.map((item, index) => {
      const written = this.sourceText.slice(item.span.start, item.span.end);
      return written.includes("\n") || written.includes("//") || written.includes("/*") ? null : `${names[index]}: ${written}`;
    });
    if (entries.some((entry) => entry === null)) return null;
    const spelling = `{${entries.join(", ")}}`;
    return spelling.length > 72 ? null : spelling;
  }

  /** The field name a value suggests: the name it already reads, else its category. */
  private tupleFieldName(item: Expression, type: ValueType): string {
    if (item.kind === "IdentifierExpression") return item.name;
    if (item.kind === "MemberExpression" && !item.optional) return item.property;
    if (item.kind === "CallExpression" && !item.optional && item.callee.kind === "MemberExpression" && !item.callee.optional) {
      return item.callee.property;
    }
    const category = this.tupleElementCategory(type);
    return category === "string" ? "text" : category === "number" ? "count" : category === "bool" ? "flag" : "value";
  }

  /** One written expression, quoted for a message and clipped when it runs long. */
  private boundedSourceQuote(quoted: Span): string {
    const written = this.sourceText.slice(quoted.start, quoted.end).replaceAll(/\s+/gu, " ").trim();
    return written.length === 0 ? "this literal"
      : written.length > 60 ? `'${written.slice(0, 59)}…'`
        : `'${written}'`;
  }

  // D32 item 30: a Promise-typed expression statement is a floating promise —
  // nothing waits for it and nothing owns its failure. The diagnostic teaches
  // both current spellings: 'await' waits, while 'detach' owns a detached task.
  private checkFloatingPromiseStatement(type: ValueType, expression: Expression): void {
    if (isInvalidType(type)) return;
    if (!this.carriesPromise(this.expandAliases(type))) return;
    const spelling = this.callSpelling(expression);
    this.diagnostics.push(diagnostic(
      "VEL4027",
      spelling
        ? `This call returns ${describeType(type)}; 'await ${spelling}' to wait for it, or 'detach ${spelling}' to run it detached`
        : `This expression is ${describeType(type)}; 'await' it to wait for it, or prefix it with 'detach' to run it detached`,
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
    if (expression.kind !== "CallExpression") return;
    // D29 item 14's own rationale reaches `expect(...)` with no matcher:
    // building an expectation object and never asking it anything throws the
    // only product away, and the statement reads as an assertion that passes.
    // D30 item 17's general CallExpression exemption is untouched — a bare
    // call may perform an effect — because `testExpectOperands` already
    // proves this one call lowered to `test.expect`, which performs none.
    if (this.testExpectOperands.has(spanIdentity(expression.span))) {
      this.diagnostics.push(diagnostic(
        "VEL4030",
        "'expect(...)' builds an expectation and asserts nothing on its own; add a matcher such as '.toBe(expected)'",
        expression.span,
      ));
      return;
    }
    if (expression.callee.kind !== "MemberExpression") return;
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

  // D32 item 30: 'detach <expression>' runs detached, so only Promise<null>
  // may detach — a non-null resolved value would be lost silently, and a
  // non-Promise value has nothing to detach.
  private analyzeDetachStatement(statement: DetachStatement): void {
    const type = this.inferExpression(statement.expression);
    if (isInvalidType(type)) return;
    const expanded = this.expandAliases(type);
    if (expanded.kind !== "promise") {
      this.diagnostics.push(diagnostic(
        "VEL4028",
        `'detach' requires a Promise<null> expression; this expression is ${describeType(type)}`,
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
    if (!this.predeclared.has(statement)) this.declareTypeNameBinding(statement.name, { kind: "typeObject", name: statement.name }, statement.span, "type");
    // D55 rule 124: the parameter-list rules — duplicate names, a reserved
    // bound name used as a parameter, shadowing a declared type, an unknown
    // bound — are about the list and not about which declaration carries it,
    // so a `type` is judged by the same procedure a `def` is.
    this.checkTypeParameterDeclarations(statement.typeParameters);
    const seen = new Set<string>();
    const inherited = this.inheritedTypeFields.get(statement) ?? new Set<string>();
    for (const field of statement.fields) {
      if (inherited.has(field.name)) {
        this.diagnostics.push(diagnostic(
          "VEL4004",
          `Type '${statement.name}' cannot redeclare inherited field '${field.name}'; inherited record fields keep their original contract`,
          field.span,
        ));
      }
      if (seen.has(field.name)) {
        this.diagnostics.push(diagnostic("VEL4004", `Type '${statement.name}' declares '${field.name}' more than once`, field.span));
      }
      seen.add(field.name);
    }
  }

  private analyzeTypeAliasDeclaration(statement: TypeAliasDeclaration): void {
    if (!this.predeclared.has(statement)) this.declareTypeNameBinding(statement.name, { kind: "typeObject", name: statement.name }, statement.span, "type");
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
    if (!this.predeclared.has(statement)) this.declareTypeNameBinding(statement.name, { kind: "classConstructor", name: statement.name }, statement.span, "class");
    const baseName = statement.base?.name ?? null;
    if (baseName) {
      const baseBinding = this.lookup(baseName) ?? this.builtin(baseName);
      if (baseName === "ValidationError" || baseName === "AssertionError" || baseName === "NarrowingError"
        || baseName === "IndexError"
        || (VELAR_HOST_ERROR_NAMES as readonly string[]).includes(baseName)) {
        // The compiler-raised error types are leaf contracts: user subclasses
        // would dilute what a caught ValidationError/AssertionError/
        // NarrowingError/IndexError proves. Extend Error for custom
        // hierarchies.
        this.typeError(`The builtin error type '${baseName}' cannot be extended; extend Error and declare your own fields`, statement.base!.span);
      } else if (baseBinding?.type.kind === "classConstructor" && !this.classes.has(baseName)
        && isExternClassIdentity(baseBinding.type.identity ?? null)) {
        // D45 rule 78 (CLS-I4): the name resolves perfectly well — it is an
        // extern class, and extending one would need a construction chain
        // across the JavaScript bridge. Section 19 lists the absence; the
        // author needs the shape that does work, not "Unknown base class",
        // which reads as a typo.
        this.typeError(
          `Extern class '${baseName}' cannot be extended; wrap the instance by composition — hold it in a field and expose the behavior as methods or functions`,
          statement.base!.span,
        );
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
    for (const [index, parameter] of statement.parameters.entries()) {
      // D89 (message correction): `constructor(self, ...)` is the same Python
      // receiver reflex a method's `self` parameter is, and it used to land on
      // the bare reserved-binding refusal, which names no fix. A field-binding
      // spelling (`const self`) is excluded because its `const`/`private`
      // prefix sits outside the parameter span, so the deletion this report
      // carries would leave the prefix stranded — and D38 §48 admits only
      // rewrites that land on working source.
      if (parameter.name === "self" && !parameter.rest && parameter.binding === null && statement.initialization !== null) {
        this.reportImplicitSelfParameter(statement.parameters, index);
        continue;
      }
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
    if (statement.dispose) {
      this.analyzeClassDispose(statement, statement.dispose);
      this.checkDisposalChain(statement, baseName);
    }
    if (statement.iterate) this.analyzeClassIterate(statement, statement.iterate, baseName);
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
      const reserved = this.errorContractMemberRejection(baseName, field.name);
      if (reserved) {
        this.typeError(reserved, field.span);
        continue;
      }
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

  /**
   * D51 item NEW-D7: `name`, `code`, `message`, `stack`, and `cause` are the
   * Error contract's own members, not names a subclass may reuse. The generic
   * inherited-field check let a `const` through whenever it restated the same
   * type — and that spelling forged `code` (charter 2070 promises `code` and
   * `name` never disagree) or silently discarded the constructed message.
   */
  private errorContractMemberRejection(baseName: string | null, member: string): string | null {
    if (!baseName || !this.isSubclassOf(baseName, "Error")) return null;
    switch (member) {
      case "name":
      case "code":
        return `'${member}' is the Error contract's own member: both report the declared class name, so a subclass cannot redeclare either — rename this field, or rename the class`;
      case "message":
        return "'message' is the Error contract's own member; pass the text to 'super(...)' instead of redeclaring the field";
      case "stack":
      case "cause":
        return `'${member}' is the Error contract's own member, filled in where the failure happens; a subclass cannot redeclare it`;
      default:
        return null;
    }
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
    this.returnContexts.push({ expected: nullType, inferredReturns: null, observedReturns: null, declarationKind: "Function" });
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
    this.returnContexts.push({ expected: nullType, inferredReturns: null, observedReturns: null, declarationKind: "Function" });
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
      // D51 item NEW-D5: `any` used to be exempt here, so `using` over an
      // unsafe JavaScript value compiled to a plain `const` — no release, no
      // diagnostic. `any` is an escape hatch for *values*; it can never answer
      // "how does this release", which is the whole content of `using`.
      if (!isInvalidType(this.expandAliases(value))) {
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
    const binding = this.scopes.at(-1)?.get(statement.name);
    if (binding) binding.ownedResource = { handle: statement.name, depth: this.scopes.length };
  }

  /**
   * D51 rule 101: an owned resource may not leave the scope that releases it.
   * `using` means "this scope owns it and guarantees the release", so letting
   * the value out hands back a reference that is already known to be dead —
   * which is the construct's definition, not a restriction on top of it. The
   * judgement is *storage and return*, never use: passing the handle to a
   * function stays legal, because a callee borrows and must not assume
   * ownership. Returns the owned binding an expression carries, or null.
   */
  private carriedOwnedResource(expression: Expression | null): { readonly handle: string; readonly depth: number } | null {
    if (!expression) return null;
    switch (expression.kind) {
      case "IdentifierExpression":
        return this.lookup(expression.name)?.ownedResource ?? null;
      case "ListExpression":
        for (const element of expression.elements) {
          const carried = this.carriedOwnedResource(element.kind === "SpreadExpression" ? element.value : element);
          if (carried) return carried;
        }
        return null;
      case "ObjectExpression":
        for (const property of expression.properties) {
          const carried = this.carriedOwnedResource(property.value);
          if (carried) return carried;
        }
        return null;
      case "ConditionalExpression":
        return this.carriedOwnedResource(expression.thenValue) ?? this.carriedOwnedResource(expression.elseValue);
      case "ArrowFunctionExpression":
        // A closure that captured the handle carries it wherever the closure
        // goes. The captures were recorded by the arrow's own analysis, so the
        // answer respects shadowing exactly as name resolution does.
        return this.arrowOwnedCaptures.get(spanIdentity(expression.span)) ?? null;
      default:
        // Member reads, index reads, and call results are data read *out of*
        // the handle — the diagnostic's own second exit — so they never carry.
        return null;
    }
  }

  /** The scope nesting level a name is declared at, or 0 when it is not a local. */
  private bindingScopeDepth(name: string): number {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      if (this.scopes[index]!.has(name)) return index + 1;
    }
    return 0;
  }

  private rejectOwnedResourceEscape(expression: Expression | null, action: string, errorSpan: Span): boolean {
    const carried = this.carriedOwnedResource(expression);
    if (!carried) return false;
    this.diagnostics.push(diagnostic(
      "VEL4036",
      `'${carried.handle}' is owned by this scope, which releases it on the way out, so ${action} would hand on an already-released handle; move the 'using' up to the scope that really owns it, or ${action.startsWith("returning") ? "return" : "store"} the data you read from it instead`,
      errorSpan,
    ));
    return true;
  }

  /**
   * The release contract of a value's type: a class's own `@dispose:` block, or
   * a standard capability handle, which delegates to the verb it already
   * publishes (`close()` or `stop()`) rather than being renamed for `using`.
   */
  private disposalContract(source: ValueType): DisposalContract | null {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    if (type.kind === "class") {
      // D51 rule 102: every `@dispose:` in the chain runs, so the contract's
      // async-ness is the chain's, not the most-derived block's. Rule NEW-D4
      // keeps that answer sound through a supertype: a subclass may not add
      // awaiting where an ancestor's release does not await, so no subclass
      // below the static type can raise the answer computed here.
      const chain = this.disposalChain(type.identity ?? type.name);
      if (chain.length === 0) return null;
      return { member: disposeMemberKey, asynchronous: chain.includes("async"), owner: "class" };
    }
    // D51 (audit 12): charter section 16 promises the compiler supplies the
    // contract for *every* standard capability handle. Some targets declare a
    // handle structurally rather than as a named type — a socket, an event
    // stream, a terminal — and the named rule could never match those, so a
    // live WebSocket was reported as "a record, which is data". The extension
    // marks its own handles; nothing here detects a shape.
    const fields = type.kind === "object" && type.capabilityHandle === true
      ? type.fields
      : type.kind === "named" && (type.identity ?? type.name).startsWith("velar/")
        // A standard capability module owns its handle types
        // (`velar/fs#type:...`); a module's own `type` declaration is
        // identified as `velar:<path>#...`, so a plain record can never reach
        // the built-in contract.
        ? this.fieldsOf(type.identity ?? type.name)
        : null;
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
   * D51 rule 102 + item NEW-D4. Rule 102 makes the compiler chain a derived
   * `@dispose:` into its base's, so the emitter is told which classes forward
   * and whether the forwarded release awaits. NEW-D4 is the soundness half:
   * `using` reads the release contract off the *static* type, so a subclass
   * that starts awaiting where its ancestors do not would be released without
   * an await through a base-typed binding — an unhandled rejection that kills
   * the process. Adding `await` downward is therefore rejected at the subclass;
   * an ancestor that already awaits carries every descendant with it.
   */
  private checkDisposalChain(statement: ClassDeclaration, baseName: string | null): void {
    const inherited = baseName ? this.disposalChain(baseName) : [];
    if (inherited.length === 0) return;
    this.classDisposeChains.set(spanIdentity(statement.span), inherited.includes("async") ? "async" : "sync");
    const own = this.classes.get(statement.name)?.dispose ?? "sync";
    if (own === "async" && !inherited.includes("async")) {
      this.diagnostics.push(diagnostic(
        "VEL4035",
        `Class '${statement.name}' awaits in '@dispose', but '${baseName}' releases without awaiting; a 'using' that owns this value through '${baseName}' would not await the release — move the awaiting work into the base's '@dispose', or release it there`,
        statement.dispose!.span,
      ));
    }
  }

  /** Every `@dispose:` a class releases through, most derived first (D51 rule 102). */
  private disposalChain(className: string): readonly ("sync" | "async")[] {
    const chain: ("sync" | "async")[] = [];
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info: ClassInfo | undefined = this.classes.get(current);
      if (info?.dispose) chain.push(info.dispose);
      current = info?.base ?? null;
    }
    return chain;
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
    // D51 item NEW-D5: the three JavaScript-boundary shapes get the spelling
    // that actually works. An extern class cannot grow an '@dispose:' block —
    // an extern body declares, it has no statements — so the old guidance named
    // a fix that is a parse error. Composition is the answer the bridge already
    // gives for every other extern-class need (D45 rule 78).
    const wrapperGuidance = "; hold it in a field of a VelarScript class whose '@dispose:' block releases it, then own that wrapper";
    if (type.kind === "any" || type.kind === "unknown") {
      return `; a JavaScript value carries no release contract${wrapperGuidance}`;
    }
    if ((type.kind === "class" || type.kind === "classConstructor") && isExternClassIdentity(type.identity ?? null)) {
      return `; an extern class declares the foreign shape and cannot declare '@dispose:'${wrapperGuidance}`;
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
    this.returnContexts.push({ expected: nullType, inferredReturns: null, observedReturns: null, declarationKind: "Function" });
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

  /** D68 rule 177: the convergence key of one `@iterate:` block. */
  private iterationResultKey(block: ClassIterateBlock): string {
    return spanIdentity(block.keywordSpan);
  }

  /**
   * D68 rule 177: `@iterate:` carries no result annotation — the block *is* the
   * answer — so the class shape pre-pass reads what the previous convergence
   * pass learned. Without the seed, a use written above the class would see an
   * unresolved placeholder, which is the same problem an omitted function
   * result has and gets the same solution.
   */
  private seededIterationSource(block: ClassIterateBlock): ValueType {
    return this.inferredFunctionResultSeeds.get(this.iterationResultKey(block)) ?? inferredResultPlaceholderType;
  }

  /**
   * D90 R18: the seed routed to the field its form owns. An optional seed can
   * only have come from the asynchronous pull form — the synchronous form
   * never validates to `T?` — so the shape pre-pass reads the form off the
   * seed the previous convergence pass learned.
   */
  private seededIterationInfo(block: ClassIterateBlock): { readonly iterate: ValueType } | { readonly iterateAsync: ValueType } {
    const seed = this.seededIterationSource(block);
    const expanded = this.expandAliases(seed);
    return expanded.kind === "optional" ? { iterateAsync: expanded.inner } : { iterate: seed };
  }

  /**
   * `@iterate:` answers the compiler's question "what does
   * iterating you mean?". It shares `@dispose:`'s compiler-name path, then
   * supplies its own role: it is a contract, not a method, and it produces a
   * value. D90 R18 gives it two forms, told apart by the answer's shape the
   * same way `@dispose:`'s async-ness is read off its own body: the
   * synchronous form answers a collection the language already iterates and
   * the eight plain consumers read it once; the asynchronous pull form
   * answers `T?` — `async for` drives it once per element, it may await, and
   * null is exhaustion.
   */
  private analyzeClassIterate(statement: ClassDeclaration, block: ClassIterateBlock, baseName: string | null): void {
    const awaits = blockContainsDirectAwait(
      block.body,
      (expression, contains) => this.extensionExpressionContainsDirectAwait(expression, contains),
      (owned, containsExpression, containsBlock) => this.extensionStatementContainsDirectAwait(owned, containsExpression, containsBlock),
    );
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
    // A block that awaits is the asynchronous form (the same reading
    // `@dispose:` gets), so its awaits are legal; a block without one has
    // nothing for the flag to allow.
    this.asynchronousFunctions.push(awaits);
    const inferredReturns: ValueType[] = [];
    this.returnContexts.push({ expected: unknownType, inferredReturns, observedReturns: null, declarationKind: "Iteration contract" });
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
    const answered = this.inferCollectedFunctionResult(inferredReturns, !this.blockAlwaysReturns(block.body));
    const validated = this.validatedIterationSource(statement, block, answered, baseName, awaits);
    // D90 R12: `@iterate:` is the class's other inferred public contract. A
    // consumer writing `for item in box` reads the element straight out of
    // this block, so an element the compiler makes no promise about crosses
    // the boundary exactly as a method result does. The block has no
    // annotation to refuse and no `private` spelling, so the class's own
    // reachability is the whole question.
    if (typeContainsAnyOutput(validated.source)) {
      this.exportPositionCandidates.push({ className: statement.name, member: "@iterate", span: block.span });
    }
    // The stored result keeps the optional wrapper for the asynchronous form
    // so the convergence seed round-trips carrying the form (see
    // seededIterationInfo).
    this.inferredFunctionResultTypes.set(
      this.iterationResultKey(block),
      validated.form === "async" && !isInvalidType(validated.source) ? optionalOf(validated.source) : validated.source,
    );
    if (validated.form === "async") this.asyncIterateBlocks.add(spanIdentity(block.keywordSpan));
    const info = this.classes.get(statement.name);
    if (info) {
      // Drop the other form's field: an earlier pass may have seeded it before
      // this pass's answer settled which form the block is.
      const { iterate: _sync, iterateAsync: _async, ...rest } = info;
      this.classes.set(statement.name, validated.form === "async"
        ? { ...rest, iterateAsync: validated.source }
        : { ...rest, iterate: validated.source });
    }
  }

  /**
   * The answer space is the four collections plus `T?` (D90 R18): the
   * synchronous form says "iterating me is iterating this", and the language
   * already fixed what iterating a List, Set, Map, or Record means; the
   * asynchronous pull form answers one element per pull, null for exhaustion.
   * Anything else would be a second iteration semantics, which is the thing
   * charter section 19 keeps out.
   */
  private validatedIterationSource(
    statement: ClassDeclaration,
    block: ClassIterateBlock,
    answered: ValueType,
    baseName: string | null,
    awaits: boolean,
  ): { readonly form: "sync" | "async"; readonly source: ValueType } {
    if (isInvalidType(answered) || containsInferredResultPlaceholder(answered)) return { form: "sync", source: invalidType };
    const expanded = this.expandAliases(answered);
    // The override rule every other member already carries (a getter or method
    // override keeps the base result). `@iterate:` replaces rather than chains,
    // but the answer still has to be the one a base-typed binding was promised:
    // `for item in bag` inside a function taking the base would otherwise walk
    // a different element type — or a different form — at runtime.
    const inherited = baseName ? this.inheritedIterationSource(baseName) : null;
    const inheritedAsync = baseName ? this.inheritedAsyncIterationSource(baseName) : null;
    if (expanded.kind === "optional") {
      const element = expanded.inner;
      if (inherited && !isInvalidType(inherited)) {
        this.diagnostics.push(diagnostic(
          "VEL4038",
          `'@iterate' override in '${statement.name}' must keep the base form; '${baseName}' answers ${describeType(inherited)} to the plain 'for', and this block answers ${describeType(answered)} — the asynchronous pull form — so a base-typed binding would stream where it was promised a collection`,
          block.keywordSpan,
        ));
        return { form: "sync", source: inherited };
      }
      if (inheritedAsync && !isInvalidType(inheritedAsync) && !sameType(this.expandAliases(element), this.expandAliases(inheritedAsync))) {
        this.diagnostics.push(diagnostic(
          "VEL4038",
          `'@iterate' override in '${statement.name}' must keep the base answer ${describeType(inheritedAsync)}?; '${baseName}' already promised every caller that pulling one of these yields ${describeType(inheritedAsync)}, and a derived value is still one of those`,
          block.keywordSpan,
        ));
        return { form: "async", source: inheritedAsync };
      }
      return { form: "async", source: element };
    }
    if (expanded.kind !== "list" && expanded.kind !== "set" && expanded.kind !== "map" && expanded.kind !== "record") {
      this.diagnostics.push(diagnostic(
        "VEL4038",
        `'@iterate' says what iterating '${statement.name}' means: the synchronous form returns a List, Set, Map, or Record — the shapes the language already knows how to iterate — and the asynchronous pull form answers 'T?', one element per pull with null as exhaustion; this block returns ${describeType(answered)}`,
        block.keywordSpan,
      ));
      return { form: "sync", source: invalidType };
    }
    if (awaits) {
      this.diagnostics.push(diagnostic(
        "VEL4038",
        `'@iterate' in '${statement.name}' awaits but answers ${describeType(answered)}; the synchronous form is read whole by the plain consumers, so await the work before construction and hold the finished collection — or answer 'T?' to be the asynchronous pull form 'async for' drives once per element`,
        block.keywordSpan,
      ));
      return { form: "sync", source: invalidType };
    }
    if (inheritedAsync && !isInvalidType(inheritedAsync)) {
      this.diagnostics.push(diagnostic(
        "VEL4038",
        `'@iterate' override in '${statement.name}' must keep the base form; '${baseName}' answers ${describeType(inheritedAsync)}? — the asynchronous pull form — and this block answers ${describeType(answered)}, so a base-typed binding would read a collection where it was promised a stream`,
        block.keywordSpan,
      ));
      return { form: "async", source: inheritedAsync };
    }
    if (inherited && !isInvalidType(inherited) && !sameType(expanded, this.expandAliases(inherited))) {
      this.diagnostics.push(diagnostic(
        "VEL4038",
        `'@iterate' override in '${statement.name}' must keep the base answer ${describeType(inherited)}; '${baseName}' already promised every caller that iterating one of these walks ${describeType(inherited)}, and a derived value is still one of those`,
        block.keywordSpan,
      ));
      return { form: "sync", source: inherited };
    }
    return { form: "sync", source: expanded };
  }

  /** The `@iterate:` answer a class inherits, most derived ancestor first. */
  private inheritedIterationSource(className: string): ValueType | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info: ClassInfo | undefined = this.classes.get(current);
      if (info?.iterate) return info.iterate;
      current = info?.base ?? null;
    }
    return null;
  }

  /** D90 R18: the asynchronous `@iterate:` element a class inherits, most derived ancestor first. */
  private inheritedAsyncIterationSource(className: string): ValueType | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info: ClassInfo | undefined = this.classes.get(current);
      if (info?.iterateAsync) return info.iterateAsync;
      current = info?.base ?? null;
    }
    return null;
  }

  /**
   * D90 R18: what pulling this value under `async for` means. A class answers
   * through the asynchronous `@iterate:` form — its own, or the one it
   * inherits, mirroring the synchronous contract exactly.
   */
  private asyncIterationContract(type: ValueType): ValueType | null {
    const resolved = this.resolveNamedClasses(this.expandAliases(type));
    if (resolved.kind !== "class") return null;
    return this.inheritedAsyncIterationSource(resolved.identity ?? resolved.name);
  }

  /**
   * D68 rule 177: what iterating this value means. A class answers through
   * `@iterate:` — its own, or the one it inherits, because overriding replaces
   * a single answer instead of composing a chain the way `@dispose:` does.
   */
  private iterationContract(type: ValueType): ValueType | null {
    const resolved = this.resolveNamedClasses(this.expandAliases(type));
    if (resolved.kind !== "class") return null;
    return this.inheritedIterationSource(resolved.identity ?? resolved.name);
  }

  /**
   * Projects one consumer's operand through `@iterate:` and records the span so
   * the emitter projects it too. Every consumer of an iterable calls this, so
   * `for item in bag` and `item in bag` can never disagree about whether a
   * class participates — D68 names that split as the trap this design exists to
   * avoid.
   */
  private iterationSource(expression: Expression, type: ValueType): ValueType {
    const contract = this.iterationContract(type);
    if (contract === null || isInvalidType(contract)) return type;
    this.iterationContracts.add(spanIdentity(expression.span));
    return contract;
  }

  /**
   * The one sentence that teaches the contract, appended wherever a consumer
   * refuses a class. A class that already declares `@iterate:` gets nothing:
   * its own block carries the precise diagnostic.
   */
  private iterationGuidance(type: ValueType): string {
    const resolved = this.resolveNamedClasses(this.expandAliases(type));
    if (resolved.kind !== "class") return "";
    if (isExternClassIdentity(resolved.identity ?? null)) {
      return "; an extern class declares the foreign shape and cannot declare '@iterate:' — read the collection out of it and iterate that";
    }
    if (this.iterationContract(resolved) !== null) return "";
    // D90 R18: the refusal is symmetric with `async for` refusing the
    // synchronous form — each names the other, so the author is one message
    // away from the loop that fits the declaration.
    if (this.asyncIterationContract(resolved) !== null) {
      return "; '@iterate' on this class is the asynchronous pull form, which 'async for' drives — use 'async for', or answer a List, Set, Map, or Record to iterate here";
    }
    return "; declare an '@iterate:' block on the class to say which List, Set, Map, or Record iterating it means";
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
          this.diagnostics.push(diagnostic("VEL4018", asyncResultAnnotationMessage, method.returnType.span));
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

  private asyncPullElementType(source: ValueType, sourceSpan: Span, statementStart: number): ValueType {
    const expanded = this.resolveNamedClasses(this.expandAliases(source));
    if (expanded.kind === "any") return anyType;
    if (isInvalidType(expanded)) return invalidType;

    // D90 R18: a VelarScript class declares itself an asynchronous stream
    // through the asynchronous `@iterate:` form, exactly as it declares the
    // synchronous one — `async for` reads the declaration, never a structural
    // resemblance. The structural `next() -> Promise<T?>` pull below stays the
    // contract of the declared foreign shapes: capability handles (a reply
    // stream, a child process, a watcher) and extern classes whose own
    // contract declares the pull as a function-valued field.
    if (expanded.kind === "class" && !isExternClassIdentity(expanded.identity ?? null)) {
      const declared = this.asyncIterationContract(expanded);
      if (declared !== null) {
        if (isInvalidType(declared)) return invalidType;
        this.asyncIterationStatements.add(statementStart);
        return declared;
      }
      const identity = expanded.identity ?? expanded.name;
      const synchronous = this.iterationContract(expanded);
      if (synchronous !== null) {
        this.typeError(
          `async for pulls a declared asynchronous '@iterate:'; '@iterate' on ${describeType(source)} ${isInvalidType(synchronous) ? "answers the plain 'for'" : `answers ${describeType(synchronous)} to the plain 'for'`} — declare the asynchronous form instead: a block that answers 'T?', one element per pull, null as exhaustion`,
          sourceSpan,
        );
        return unknownType;
      }
      const structuralNext = this.findMethod(identity, "next")?.type ?? this.findMethod(expanded.name, "next")?.type ?? null;
      this.typeError(
        `async for pulls a declared asynchronous '@iterate:'; ${describeType(source)} does not declare one — a block that answers 'T?' (it may await; one element per pull, null is exhaustion)${structuralNext ? "; 'next()' is a method of the author's namespace, not the contract — move its body into the '@iterate:' block" : ""}`,
        sourceSpan,
      );
      return unknownType;
    }

    let next: ValueType | null = null;
    if (expanded.kind === "object") {
      next = expanded.optionalFields?.has("next") ? null : expanded.fields.get("next") ?? null;
    } else if (expanded.kind === "named") {
      const identity = expanded.identity ?? expanded.name;
      next = this.findMethod(identity, "next")?.type
        ?? this.fieldsOf(identity)?.get("next")
        ?? null;
    } else if (expanded.kind === "class") {
      // An extern class: its own contract may declare the pull as a
      // function-valued field; an extern method is never captured (charter
      // section 12 trusts a checked declaration's member kinds, and only a
      // field promises a function standing on the value).
      next = this.findField(expanded.identity ?? expanded.name, "next")?.type
        ?? this.findField(expanded.name, "next")?.type
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

  /**
   * D58 rule 139: `-> null` is the one result annotation that names nothing a
   * caller can use — a caller that ignores a result already knows as much — so
   * where a body infers exactly that, the annotation is two spellings of one
   * declaration and the written one is refused. `extern` declarations,
   * abstract methods, and function types have no body to infer from and keep
   * declaring it (VEL4023, VEL2001), and a getter's result is the property's
   * type, which the parser requires outright (VEL2023).
   *
   * Deleting an annotation the compiler would infer identically is provably
   * equivalent, so it is a mechanical fix under D50 rule 95 — but only there.
   * D58 correction 2: where the body returns a value, the deletion is not
   * equivalent, it widens the signature and takes VEL4001 down with it, so the
   * refusal is reported without a fix and the author decides whether the body
   * or the intent was wrong. `velar fix` runs unattended because it never does
   * the second kind of thing.
   *
   * D64 rule 162: dropping the fix was only half of that correction. The
   * message still said "delete the annotation" — the one move the ruling had
   * just refused to make — so the diagnostic taught an exit it rejects on the
   * next step, which is the D57 rule 136 shape. The two cases now carry two
   * messages: where the body does infer null the deletion is the answer, and
   * where it does not, the disagreement between the body and the annotation is
   * the answer, and deleting would only widen the signature to hide it.
   */
  private inferredNullResultAnnotation(statement: AnalyzableFunctionDeclaration): TypeReference | null {
    const reference = statement.returnType;
    if (!reference || reference.syntax.kind !== "NamedTypeSyntax" || reference.syntax.name !== "null") return null;
    if ("accessor" in statement) return null;
    return reference;
  }

  private reportInferredNullResult(
    statement: AnalyzableFunctionDeclaration,
    declarationKind: string,
    inferred: ValueType,
  ): void {
    const reference = this.inferredNullResultAnnotation(statement);
    if (!reference) return;
    if (inferred.kind !== "null") {
      this.diagnostics.push(diagnostic(
        "VEL4037",
        `${declarationKind} '${statement.name}' takes its result from its body, which returns ${describeType(inferred)}, not null; change the body or the result you meant — deleting the annotation would widen the signature`,
        reference.span,
      ));
      return;
    }
    const deletion = statement.resultAnnotationSpan;
    this.diagnostics.push(diagnostic(
      "VEL4037",
      `${declarationKind} '${statement.name}' infers '-> null' from its body; delete the annotation, and write it only where 'extern', 'abstract', or a function type leaves no body to infer`,
      reference.span,
      deletion ? mechanicalFix(deletion, "", "Delete the inferred '-> null'") : undefined,
    ));
  }

  /**
   * D89 (message correction): the one report a `self` parameter earns, and the
   * deletion it names. The removed range reaches to the next parameter's start
   * (or back to the previous one's end), so the separating comma and its
   * whitespace come with it without reading the source text — the rewrite is a
   * spelling change with no judgment in it, which is what D38 §48 requires of
   * a registered fix.
   */
  private reportImplicitSelfParameter(
    parameters: readonly { readonly name: string; readonly span: Span }[],
    index: number,
  ): void {
    const parameter = parameters[index]!;
    const next = parameters[index + 1];
    const previous = parameters[index - 1];
    const removal = next
      ? span(parameter.span.start, next.span.start)
      : previous
        ? span(previous.span.end, parameter.span.end)
        : parameter.span;
    this.diagnostics.push(diagnostic(
      "VEL3007",
      "'self' is the receiver a method body already has, not a parameter; delete it from the parameter list",
      parameter.span,
      mechanicalFix(removal, "", "Delete the implicit 'self' parameter"),
    ));
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
    // D85 rule 209: the same registration the top-level predeclaration makes,
    // for a `def` nested in a body, which nothing predeclares.
    if (callableBinding && !this.functionResultKeys.has(callableBinding)) {
      this.functionResultKeys.set(callableBinding, this.functionResultKey(statement as FunctionDeclaration));
    }
    this.checkTypeParameterDeclarations(statement.typeParameters);
    this.typeParameterFrames.push(this.typeParameterFrame(statement.typeParameters));
    this.enterScope();
    this.flowFrameDepth += 1;
    this.functionDepth += 1;
    // D31 item 23: this body is deferred, so its reads of imported bindings
    // become initialization-position reads only when something runs it during
    // module evaluation. Collect them here and let a top-level call decide.
    const deferredFrame: DeferredReadFrame = { reads: [], calls: [] };
    this.deferredReadFrames.push(deferredFrame);
    if (callableBinding) this.localFunctionFrames.set(callableBinding, deferredFrame);
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
      this.diagnostics.push(diagnostic("VEL4018", asyncResultAnnotationMessage, statement.returnType.span));
    } else if (statement.returnType && returnValid) {
      if (asynchronous) this.reportPromiseResolutionHazard(declaredReturn, statement.returnType.span);
      else this.reportPromiseCarrierHazard(declaredReturn, statement.returnType.span);
    }
    // D58 correction 2: whether the deletion is provably equivalent is a fact
    // about the body, so the refusal waits until the body has been read.
    const observedReturns: ValueType[] | null = inferredReturns === null && this.inferredNullResultAnnotation(statement)
      ? []
      : null;
    const expectedReturn = returnValid
      ? asynchronous ? this.resolvedAsyncResult(declaredReturn) : declaredReturn
      : invalidType;
    const returnContext: ReturnContext = {
      expected: expectedReturn,
      inferredReturns,
      observedReturns,
      declarationKind,
    };
    this.returnContexts.push(returnContext);
    if (className && declareSelf) {
      const selfType: ValueType = { kind: "class", name: className };
      this.declareBinding("self", false, selfType, statement.span, true);
    }
    for (const [index, parameter] of statement.parameters.entries()) {
      // D89 (message correction): a method body already has `self`, so writing
      // it as a parameter is Python's explicit receiver. It used to earn two
      // reports — "already declared in this scope" and "reserved Core binding"
      // — neither of which named the fix. Only a declaration that really has
      // an implicit receiver takes this branch; a plain or static function's
      // `self` keeps the reserved-binding refusal, which is the truth there.
      // A rest spelling is not the receiver reflex, and its '...' sits outside
      // the parameter span, so deleting the name alone would leave a stray one.
      if (parameter.name === "self" && !parameter.rest && className !== null && declareSelf) {
        this.reportImplicitSelfParameter(statement.parameters, index);
        continue;
      }
      const contextualType = !parameter.type && parameter.defaultValue
        ? this.contextualFunctionParameterDefault(statement, parameter)
        : null;
      const type = contextualType ?? this.resolveAnnotation(parameter.type);
      const valid = contextualType !== null || (parameter.type ? this.validateTypeReference(parameter.type) : true);
      if (parameter.defaultValue && valid && contextualType === null) {
        this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      }
      const declared = valid ? type : invalidType;
      this.declareBinding(parameter.name, false, parameter.rest ? { kind: "list", element: declared } : declared, parameter.span);
    }
    this.constructorDepth = 0;
    this.analyzeStatements(statement.body);
    if (observedReturns) {
      const inferred = this.inferCollectedFunctionResult(observedReturns, !this.blockAlwaysReturns(statement.body));
      this.reportInferredNullResult(statement, declarationKind, inferred);
    }
    const resultKey = this.functionResultKey(statement as FunctionDeclaration);
    if (inferredReturns) {
      const inferred = this.inferCollectedFunctionResult(inferredReturns, !this.blockAlwaysReturns(statement.body));
      this.inferredFunctionResultTypes.set(resultKey, inferred);
      const seeded = this.inferredFunctionResultSeeds.get(resultKey) ?? inferredResultPlaceholderType;
      if (returnContext.unsettledResult === true) {
        this.reportedResultHoles.add(resultKey);
      } else if (this.finalizeFunctionResultInference
        && (containsInferredResultPlaceholder(inferred) || isInvalidType(inferred) || !sameInferredResult(seeded, inferred))) {
        const report = diagnostic(
          "VEL4025",
          `${declarationKind} '${statement.name}' result inference did not converge; add an explicit result annotation to this recursive contract`,
          statement.signatureSpan,
        );
        this.diagnostics.push(report);
        // D85 rule 209: a callee whose hole is reported after this caller is
        // analyzed is a hole nobody can know about yet, so the report waits
        // for the whole module before it is kept or deleted as the second
        // half of one mistake.
        const causes = returnContext.resultHoleCauses;
        if (causes && causes.size > 0) this.deferredConvergenceReports.push({ report, resultKey, causes });
      }
      // D90 R12: an omitted result annotation publishes whatever the body
      // inferred, so an exported `def` leaks `any` exactly as an exported
      // `const` does. Deliberately not gated on finalizeFunctionResultInference:
      // a probe pass is discarded whole — the driver keeps the first pass's
      // diagnostics only when nothing was left to converge — which is why the
      // VEL4006 below is ungated too.
      if (typeContainsAnyOutput(inferred)) this.recordExportedAny(statement, className, statement.signatureSpan);
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
    this.deferredReadFrames.pop();
    this.functionDepth -= 1;
    this.flowFrameDepth -= 1;
    this.exitScope();
    this.typeParameterFrames.pop();
    this.constructorDepth = outerConstructorDepth;
  }

  /**
   * A target-owned declaration may use an ordinary default expression as a
   * typed input descriptor. The target analyzes that expression and returns
   * the value type visible inside the body; Core owns only the function-scope
   * plumbing and never learns the descriptor vocabulary.
   */
  protected contextualFunctionParameterDefault(
    _statement: AnalyzableFunctionDeclaration,
    _parameter: AnalyzableFunctionDeclaration["parameters"][number],
  ): ValueType | null {
    return null;
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
    let previous: Statement | null = null;
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
      this.adviseManualCollectionConversion(previous, statement);
      this.adviseManualListPipeline(previous, statement);
      this.adviseManualListQuery(previous, statement);
      previous = statement;
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
        this.reportUnresolvedName(statement.target.name, statement.target.span);
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
      const objectType = this.expandAliases(this.inferExpression(statement.target.object));
      const indexType = this.inferExpression(statement.target.index);
      const binaryKind = binaryStorageKind(objectType);
      if (binaryKind) {
        this.requireAssignable(indexType, numberType, statement.target.index.span);
        targetType = numberType;
        this.binaryIndexes.set(spanIdentity(statement.target.span), binaryKind);
        if (binaryKind === "bytes") {
          this.diagnostics.push(diagnostic(
            "VEL3002",
            "Cannot index-assign Bytes; it is a read-only binary snapshot",
            statement.target.span,
          ));
          targetWritable = false;
        }
      } else if (objectType.kind === "list") {
        this.requireAssignable(indexType, numberType, statement.target.index.span);
        targetType = objectType.element;
        this.collectionIndexes.set(spanIdentity(statement.target.span), "list");
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
        this.collectionIndexes.set(spanIdentity(statement.target.span), "record");
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
    // D51 rule 101: a store into a member, an index, or any binding declared
    // outside the owning scope outlives the release. A store into a binding at
    // or inside the owning scope dies with it, so it stays legal.
    const carriedValue = this.carriedOwnedResource(statement.value);
    if (carriedValue) {
      const targetDepth = statement.target.kind === "IdentifierExpression"
        ? this.bindingScopeDepth(statement.target.name)
        : 0;
      if (targetDepth < carriedValue.depth) {
        this.rejectOwnedResourceEscape(statement.value, "storing it here", statement.value.span);
      }
    }

    if (operator !== "=" && targetType.kind !== "number" && !(operator === "+=" && targetType.kind === "string")) {
      this.typeError(`Operator '${operator}' is not valid for ${describeType(targetType)}`, statement.span);
    }
    const assignmentValid = this.contextuallyAssignable(valueType, targetType, statement.value.span);
    const mutableCell: MutableCellTarget | null = statement.target.kind === "IdentifierExpression"
      && targetBinding?.mutable === true && targetBinding.reactiveKind !== "prop"
      ? { name: statement.target.name, keyword: targetBinding.reactiveKind === "state" ? "state" : "let" }
      : null;
    this.requireAssignable(valueType, targetType, statement.value.span, mutableCell);
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
          this.recordFlowFactOrigin(storageBinding);
          this.recordFlowFactOrigin(targetBinding);
          storageBinding.storageType = rebound;
          if (storageBinding.narrowingFrame === null) storageBinding.type = rebound;
          targetBinding.storageType = rebound;
          targetBinding.type = rebound;
        }
        // D44 rule 71: the assignment establishes the right-hand side's type
        // as the location's fact (`x = maybeNull()` establishes nothing —
        // the assigned type must actually refine the declared one).
        if (statement.target.kind === "IdentifierExpression") {
          this.invalidateShadowedNarrowings(statement.target.name, targetBinding);
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
    // D51 rule 106: a permanent namespace is vocabulary, not a value. It exists
    // so pure computation needs no import; letting it be passed, stored,
    // spread, or destructured invents a second and third spelling of the same
    // functions (rule 3) and buys nothing. The one legal position is the head
    // of a member access — the same shape D45 rule 75 leaves a class name.
    if (expression.kind === "IdentifierExpression") {
      const namespace = this.builtinValueReferences.get(spanIdentity(expression.span));
      if (namespace && namespace !== "range" && !this.memberAccessReceivers.has(spanIdentity(expression.span))) {
        this.typeError(
          `'${namespace}' is a namespace, not a value; name the member you need — '${namespace}.${this.firstNamespaceMember(namespace)}(...)' — a namespace cannot be called, passed, stored, spread, or destructured`,
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

  /**
   * CLS-I1: the positions where `self` does not exist, and why. A field
   * initializer runs while the instance is still being assembled, so there is
   * no complete `self` to read; a static member belongs to the class and has
   * no instance at all. Outside a class the word is simply an unknown name and
   * keeps the ordinary message.
   */
  private unavailableSelfGuidance(): string | null {
    // A static field initializer is both positions at once; "no instance" is
    // the reason that keeps being true no matter when the initializer runs.
    if (this.superMemberContext === "static" && this.currentClass) {
      return `'self' is available in constructor, method, and getter bodies; a static member has no instance — reach class-owned members through the class name, as in '${this.currentClass}.member'`;
    }
    if (this.classFieldInitializerDepth > 0) {
      return "'self' is available in constructor, method, and getter bodies; a field initializer runs before the instance is complete, so assign this field in the constructor instead";
    }
    return null;
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
          // CLS-I1: `self` is not an unknown name — it is a name with a
          // position rule, and the two positions where it does not exist each
          // have a reason worth saying. The invalid type stops the two
          // cascades ("cannot access 'x' on unknown", "cannot assign unknown
          // to T") that used to bury the one message that mattered.
          const selfGuidance = expression.name === "self" ? this.unavailableSelfGuidance() : null;
          if (selfGuidance) {
            this.diagnostics.push(diagnostic("VEL3001", selfGuidance, expression.span));
            return invalidType;
          }
          // D52 rule 114: a retired namespace prefix is reported once the whole
          // module is known, so the one migration can carry the whole rewrite —
          // the prefix comes off here and the import goes on at the top.
          if (this.retiredNamespaces.has(expression.name)) {
            const access = this.memberAccessProperties.get(spanIdentity(expression.span));
            this.retiredNamespaceUses.push({
              namespace: expression.name,
              member: access?.property ?? null,
              span: expression.span,
              memberEnd: access?.end ?? expression.span.end,
              bare: false,
            });
            return invalidType;
          }
          // The bare name is the other half of the same migration: once the
          // prefix comes off, `spacing(...)` is a name this module has not
          // imported yet, and the import it needs is the one the prefixed form
          // would have added. Carrying the rewrite here too is what makes the
          // answer survive whatever order the edits land in.
          {
            const owner = this.retiredNamespaceOwning(expression.name);
            if (owner) {
              this.retiredNamespaceUses.push({
                namespace: owner,
                member: expression.name,
                span: expression.span,
                memberEnd: expression.span.end,
                bare: true,
              });
              return unknownType;
            }
          }
          this.reportUnresolvedName(expression.name, expression.span);
          return unknownType;
        }
        if (lexical) {
          // D52 rule 116: a read of a name imported from a module that has a
          // permanent namespace is part of that import's migration — the one
          // rewrite moves the prefix onto every one of them. The span identity
          // is what proves the read reached the import and not a local of the
          // same name shadowing it, so a shadowed read is left alone.
          const origin = this.permanentNamespaceImportOrigins.get(expression.name);
          if (origin && lexical.span.start === origin.specifier.start && lexical.span.end === origin.specifier.end) {
            this.permanentNamespaceImportReads.push({ local: expression.name, source: origin.source, imported: origin.imported, span: expression.span });
          }
        }
        if (!lexical && (isPermanentNamespaceName(expression.name) || expression.name === "range")) {
          this.builtinValueReferences.set(spanIdentity(expression.span), expression.name);
        }
        // D51 rule 101: every arrow frame this read sits inside captures the
        // owned handle, so a nested arrow taints its enclosing arrows too.
        if (binding.ownedResource && this.arrowCaptureFrames.length > 0) {
          for (const frame of this.arrowCaptureFrames) frame.captured ??= binding.ownedResource;
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
        if (binding.narrowingFrame !== null && !this.isStableOptionalValueCopy(binding)) {
          this.runtimeNarrowings.set(spanIdentity(expression.span), {
            expected: binding.type,
            description: expression.name,
          });
        }
        if (binding.type.kind === "typeObject" && !binding.type.value) {
          // D55 rule 126: a generic record has no Type object of its own — it
          // has one per instantiation. Rule 123's idiom is the answer, and it
          // is one this language already teaches for `List<Item>`.
          const generic = this.genericTypes.get(expression.name);
          if (generic) {
            this.typeError(
              `'${expression.name}' is a generic type, not a value; name one instantiation first — type ${expression.name}Of${generic.parameterNames[0] ?? "T"} = ${expression.name}<${generic.parameterNames.join(", ")}> with concrete types — and read that`,
              expression.span,
            );
            return invalidType;
          }
          return {
            ...binding.type,
            value: this.runtimeTypeObjectValue(binding.type),
          };
        }
        return binding.type;
      }
      case "SuperExpression":
        // CLS-C2: `super` reaches base methods and getters, and the message
        // that names what may follow it must name both.
        this.typeError("'super' must be followed by a base method or getter name", expression.span);
        return unknownType;
      case "DynamicImportExpression":
        return { kind: "promise", value: this.dynamicImports.get(expression.source) ?? unknownType };
      case "ListExpression": {
        const collectionContext = this.contextualCollectionType(contextualType);
        let element = unknownType;
        const expectedElement = collectionContext?.kind === "list" ? collectionContext.element : unknownType;
        let matchesContext = collectionContext?.kind === "list";
        const writtenElementTypes: ValueType[] = [];
        for (const item of expression.elements) {
          const inferredItem = this.inferExpression(item, expectedElement);
          if (item.kind !== "SpreadExpression") writtenElementTypes.push(inferredItem);
          // D68 rule 177: `[...bag]` spreads what `@iterate:` answers, exactly
          // as `[...bag.items]` would — including the refusal when the answer
          // is not a List, which is the same refusal the field would get.
          const itemType = item.kind === "SpreadExpression" ? this.iterationSource(item.value, inferredItem) : inferredItem;
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
            else if (itemType.kind !== "any") this.typeError(`Cannot spread ${describeType(itemType)} into a list${this.iterationGuidance(itemType)}`, item.span);
          } else {
            element = mergeTypes(element, expectedElement.kind === "unknown" ? this.widenAggregateSingleton(itemType) : itemType);
            if (expectedElement.kind !== "unknown") {
              if (!this.contextuallyAssignable(itemType, expectedElement, item.span)) matchesContext = false;
              this.requireAssignable(itemType, expectedElement, item.span);
            }
          }
        }
        const inferredList: ValueType = { kind: "list", element };
        this.adviseTupleShapedListLiteral(expression, contextualType, writtenElementTypes, element);
        if (matchesContext && collectionContext?.kind === "list") {
          return collectionContext;
        }
        return inferredList;
      }
      case "ObjectExpression": {
        const diagnosticsBefore = this.diagnostics.length;
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
            if (this.checkShorthandReservedName(property)) {
              fields.set(property.name, unknownType);
              continue;
            }
            if (objectContext?.kind === "named" && expectedFields?.has(property.name)) {
              this.semanticObjectPropertyOwners.set(`${property.span.start}:${property.name}`, objectContext);
            }
            // D90 R11: a literal written at a type-annotated position is
            // closed. Every one of its keys is in front of the compiler here,
            // so an unrecognised one is a misspelling rather than a value that
            // happens to be wider — which is why the openness a non-literal
            // keeps is untouched. Only written keys are checked, so a spread's
            // surplus fields stay legal and this sits outside the
            // missing-field guard below rather than inside it. A `Record<T>`
            // context declares every string key, and leaves `expectedFields`
            // null, so no key of one is ever unrecognised.
            if (objectContext && expectedFields && !expectedFields.has(property.name)) {
              const nearest = uniqueNearestName(property.name, expectedFields.keys());
              const owner = objectContext.kind === "named" ? `Type '${objectContext.name}'` : "Object";
              this.typeError(
                `${owner} has no field '${property.name}'${nearest ? `; did you mean '${nearest}'?` : ""}`,
                property.span,
              );
            }
            const expected = expectedFields?.get(property.name) ?? expectedRecordValue ?? unknownType;
            const actual = this.inferExpression(property.value, expected.kind === "optional" ? expected.inner : expected);
            fields.set(property.name, expected.kind === "unknown" ? this.widenAggregateSingleton(actual) : actual);
            if (expected.kind !== "unknown") this.requireAssignable(actual, expected, property.value.span);
            this.adviseRedundantObjectProperty(property);
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
            } else if (spread.kind !== "any" && !isInvalidType(spread)) {
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
        if (this.diagnostics.length === diagnosticsBefore) {
          this.adviseManualRecordProjection(expression, objectContext, contextualType);
          this.adviseManualMappedRecordProjection(expression, objectContext, contextualType);
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
              // D90 R18: an `@iterate:` block that awaits is the asynchronous
              // pull form, so awaiting inside one is never refused here — the
              // form's own validation owns the answer-shape question.
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
          // ASY-U2 + D90 R17: awaiting an unchecked boundary value adopts a
          // foreign thenable — its hooks run here and a raw undefined result
          // skips null normalization — so `any` and `unknown` share one
          // refusal, and it teaches the way in: a declared contract.
          this.typeError(
            awaited.kind === "any" || awaited.kind === "unknown"
              ? `Cannot await ${describeType(operand)}; an unchecked thenable runs foreign hooks and can leak raw undefined — declare the source in an extern contract so the result is a checked Promise, or validate the resolved data at the edge with 'Type.parse'`
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
      case "RequiredExpression": {
        // D86 rule 212: `value!` answers "absent here is a bug", so it takes
        // `T?` to `T` and has nothing to say about a value that already holds
        // one. The contextual type is the optional of what the consumer wants,
        // since the unwrap is what removes the question.
        const value = this.inferExpression(expression.value, optionalOf(this.expandAliases(contextualType)));
        if (isInvalidType(value)) return invalidType;
        const resolved = this.expandAliases(value);
        if (resolved.kind === "any") return value;
        if (resolved.kind === "optional") return resolved.inner;
        const message = resolved.kind === "unknown"
          ? `'!' unwraps an optional, and ${describeType(value)} is not one; validate it with 'is' or 'parse' before reading it`
          : resolved.kind === "promise"
            // The same mistake `try` guards against: the unwrap reached the
            // Promise rather than the value it resolves to.
            ? `'!' unwraps an optional, and this expression is ${describeType(value)}; write '(await ...)!' so the unwrap reaches the resolved value`
            : `'!' unwraps an optional, and this value is already ${describeType(value)}; remove the '!'`;
        this.diagnostics.push(diagnostic(
          "VEL4040",
          message,
          expression.span,
          ...(resolved.kind === "unknown" || resolved.kind === "promise"
            ? []
            : [mechanicalFix({ start: expression.span.end - 1, end: expression.span.end }, "", "Remove the redundant '!'")]),
        ));
        return value;
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
        this.recordDeferredCallEdge(expression.callee, expression.span);
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
        const binaryKind = binaryStorageKind(object);
        if (binaryKind) {
          this.requireAssignable(index, numberType, expression.index.span);
          this.binaryIndexes.set(spanIdentity(expression.span), binaryKind);
          if (guarded) {
            this.optionalIndexes.add(spanIdentity(expression.span));
            return optionalOf(numberType);
          }
          return numberType;
        }
        if (object.kind === "list") {
          this.requireAssignable(index, numberType, expression.index.span);
          this.collectionIndexes.set(spanIdentity(expression.span), "list");
          const element = object.readonlyView ? this.readonlyDataViewOf(object.element) : object.element;
          if (guarded) {
            this.optionalIndexes.add(spanIdentity(expression.span));
            return optionalOf(element);
          }
          return element;
        }
        if (object.kind === "map") {
          this.typeError("Use Map.get(key) instead of bracket access", expression.span);
          // The rejected bracket form has no trustworthy result type. Giving
          // it the Map value type made `owners[key] ?? fallback` claim the
          // fallback was unnecessary, contradicting the very `.get()` rewrite
          // whose result is optional.
          return invalidType;
        }
        if (object.kind === "record") {
          this.requireAssignable(index, stringType, expression.index.span);
          this.collectionIndexes.set(spanIdentity(expression.span), "record");
          if (guarded) this.optionalIndexes.add(spanIdentity(expression.span));
          return optionalOf(object.readonlyView ? this.readonlyDataViewOf(object.value) : object.value);
        }
        if (object.kind === "string") {
          this.typeError("Use '.char(index)'; strings are not indexable and string positions count Unicode code points", expression.span);
          return unknownType;
        }
        if (object.kind !== "any") {
          // D90 R17: an unknown is a boundary value, so the refusal teaches
          // the validation ritual instead of restating the kind.
          this.typeError(`Cannot index ${describeType(object)}${object.kind === "unknown" && !isInvalidType(object) ? this.boundaryValidationGuidance(expression.object, null) : ""}`, expression.span);
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
      // D68 rule 177: `item in bag` and `for item in bag` consume the same
      // contract. Letting one work while the other refused is the trap the
      // ruling names — the author would have no way to see where the line is.
      const container = this.iterationSource(rightExpression, right);
      if (container.kind === "list" || container.kind === "map" || container.kind === "set" || container.kind === "record" || container.kind === "string") {
        this.collectionMemberships.set(spanIdentity(operationSpan), container.kind);
      }
      if (container.kind === "list" || container.kind === "set") {
        // COL-I3 second half: `in` is the thirteenth membership probe and the
        // one that does not route through `checkProbeArgument`, so it carries
        // the fresh-literal rejection itself — against the probe only, never
        // the container, because the fresh List in `x in [1, 2, 3]` is the
        // domain being searched rather than the question being asked.
        if (!this.requireMembershipIntersection(left, this.readonlyDataViewOf(container.element), leftExpression.span, operator)) {
          this.rejectFreshCollectionProbe(leftExpression, operator, "element");
        }
      } else if (container.kind === "map") {
        if (!this.requireMembershipIntersection(left, this.readonlyDataViewOf(container.key), leftExpression.span, operator)) {
          this.rejectFreshCollectionProbe(leftExpression, operator, "key");
        }
      } else if (container.kind === "record") {
        this.requireMembershipIntersection(left, stringType, leftExpression.span, operator);
      } else if (container.kind === "string") {
        this.requireMembershipIntersection(left, stringType, leftExpression.span, operator);
      } else if (container.kind !== "any") {
        this.typeError(
          `Membership requires a List, Set, Map, Record, or string, received ${describeType(container)}${this.iterationGuidance(container)}`,
          rightExpression.span,
        );
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
    if (operator === "%") this.adviseNegativeLiteralModulo(leftExpression, rightExpression, operationSpan);
    this.requireAssignable(left, numberType, leftExpression.span);
    this.requireAssignable(right, numberType, rightExpression.span);
    return numberType;
  }

  /**
   * D89 A3: `%` follows JavaScript and keeps the dividend's sign, so `-7 % 3`
   * is `-1` where Python answers `2`. Nothing here reports an error — both
   * languages accept the spelling, they just disagree about the result.
   *
   * Only a literal negative dividend triggers. A variable's sign is not
   * knowable, and advising every `%` whose left side might go negative would
   * be the noise the tier exists to avoid. The shape matched is a unary minus
   * wrapping a numeric literal, because that is what `-7` parses as; there is
   * no negative-valued literal for a value test to find.
   *
   * The admission bar is "Vel accepts the spelling as a different meaning", so
   * every shape whose two answers are the same is silent rather than advised:
   * a remainder of zero (`-6 % 3`) agrees, `% 0` answers NaN here and raises
   * in Python so there is no Python answer to name, and a non-finite dividend
   * answers NaN on both sides. A message that states a disagreement and then
   * prints the same number twice is a new defect, not a weaker advisory.
   */
  private adviseNegativeLiteralModulo(leftExpression: Expression, rightExpression: Expression, operationSpan: Span): void {
    if (leftExpression.kind !== "UnaryExpression" || leftExpression.operator !== "-") return;
    const dividend = leftExpression.operand;
    if (dividend.kind !== "LiteralExpression" || typeof dividend.value !== "number") return;
    const divisor = rightExpression.kind === "LiteralExpression" && typeof rightExpression.value === "number"
      ? rightExpression
      : null;
    if (divisor !== null) {
      const divisorValue = Number(divisor.value);
      if (divisorValue === 0) return;
      // `-0` renders as `0`, so a zero remainder would print one number on
      // both sides of a sentence claiming they differ.
      const remainder = -Number(dividend.value) % divisorValue;
      if (!Number.isFinite(remainder) || remainder === 0) return;
      // A literal divisor is always positive — a negative one parses as a
      // unary minus, not a literal — so Python's answer, which takes the
      // divisor's sign, is this remainder lifted by one divisor.
      const python = remainder + divisorValue;
      // The rewrite the message advertises is its own remedy, so quoting an
      // answer that rewrite does not produce would be false. The two part ways
      // only when the lift rounds back onto the divisor; the general sentence
      // below covers that without naming a number.
      if ((remainder + divisorValue) % divisorValue === python) {
        this.advise(
          "A3",
          `VelarScript's '%' follows JavaScript and keeps the dividend's sign, so '-${dividend.raw} % ${divisor.raw}' is ${remainder} where Python answers ${python}; write '((a % b) + b) % b' for the Python answer`,
          operationSpan,
        );
        return;
      }
    }
    this.advise(
      "A3",
      "VelarScript's '%' follows JavaScript and keeps the dividend's sign, so a negative dividend leaves a remainder that is negative or zero, where Python's takes the divisor's sign; write '((a % b) + b) % b' for the Python answer",
      operationSpan,
    );
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
        `${describeType(left)} and ${describeType(right)} can meet only where an enum member matches a raw ${this.enumMeetDomain(left, right)},`
          + ` and the enum and ${this.enumMeetDomain(left, right)} domains never meet in '${operator}'${this.equalityGuidance(left, right)}`,
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
  private requireMembershipIntersection(probe: ValueType, domain: ValueType, span: Span, operation: string): boolean {
    if (isInvalidType(probe) || isInvalidType(domain)) return false;
    if (this.equalityTypesIntersect(probe, domain)) return false;
    this.typeError(
      this.typesIntersect(probe, domain, false)
        ? `${describeType(probe)} can match ${describeType(domain)} only as an enum member against a raw string, and the enum and string domains never meet in '${operation}'${this.equalityGuidance(probe, domain)}`
        : `${describeType(probe)} and ${describeType(domain)} have no values in common, so '${operation}' can never match${this.equalityGuidance(probe, domain)}`,
      span,
    );
    return true;
  }

  // COL-I3 second half: the same ruling that rejects a freshly built literal
  // as an `==` operand governs the membership vocabulary, because a membership
  // test asks the `==` question one element at a time. A literal written
  // inside the probe is a new object no element can be identical to, so the
  // answer is provable from the literal alone.
  //
  // Only the probe side is closed, deliberately. The container side is an
  // ordinary spelling — `x in [1, 2, 3]` builds the fresh List as the domain,
  // not as the question — and `Set.add`, `Set<Record>` and `Map<Record, V>`
  // are left alone for the same reason: an identity-keyed container of records
  // is a legitimate program (adding the same object twice, holding a record as
  // an identity token), so a diagnostic there would refuse correct code. A
  // false positive on a correct program is worse than silence; the probe is
  // the one position where the always-false answer is provable.
  private rejectFreshCollectionProbe(probe: Expression, operation: string, probes: "element" | "key"): boolean {
    const fresh = this.freshCollectionOperand(probe);
    if (!fresh) return false;
    this.typeError(
      `A ${fresh.description} built inside the probe is a new object, and '${operation}' compares ${probes} identity, so it can never match; ${probes === "key"
        ? "hold the key in a binding and probe with that binding, or compare contents with equals(a, b)"
        : "compare contents with equals(a, b) — 'values.some(item => equals(item, probe))' asks the same question one element at a time"}`,
      fresh.span,
    );
    return true;
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

  /**
   * D59 rule 141 settled that `toBe` *is* `==` ("toBe 必须用语言自己的 `==`")
   * and rule 141.1 settled that `toContain` *is* `values.has(item)`. The
   * runtime half of both landed; the compile-time half did not travel with
   * them, so `expect([1]).toBe([1])` compiled and failed at run time with
   * both operands rendering byte-identically, while `[1] == [1]` is refused
   * where it is written. This runs the operator's own two gates on the
   * matcher: D42 item 64's intersection requirement, and COL-I3's rejection
   * of a freshly built literal in an identity comparison.
   *
   * `toBe` and `toEqual` deliberately part company on the fresh-literal gate.
   * `toBe` asks the `==` question, where a new object can never be identical
   * to anything, so the literal proves the answer. `toEqual` asks the
   * `equals(a, b)` question, where a fresh literal is the normal and correct
   * spelling of the expected value — rejecting it there would refuse the very
   * repair the `toBe` message teaches. The intersection gate has no such
   * split: two types with no values in common never deeply equal either.
   *
   * `toHaveLength` and `toMatch` are left alone. Neither takes a comparand:
   * `toHaveLength` takes a count, and `toMatch` takes a regular-expression
   * pattern whose relation to the subject is matching, not equality.
   */
  private checkTestMatcherComparand(calleeExpression: Expression, arguments_: readonly Expression[]): void {
    if (calleeExpression.kind !== "MemberExpression" || arguments_.length !== 1) return;
    const matcher = calleeExpression.property;
    if (matcher !== "toBe" && matcher !== "toEqual" && matcher !== "toContain") return;
    const receiver = calleeExpression.object;
    if (receiver.kind !== "CallExpression") return;
    const operand = this.testExpectOperands.get(spanIdentity(receiver.span));
    if (operand === undefined) return;
    const argument = arguments_[0]!;
    if (argument.kind === "SpreadExpression") return;
    const probe = this.inferredExpressionTypes.get(spanIdentity(argument.span));
    if (!probe) return;
    // `==` leaves through `inferBinary`'s invalid-type exit before either of
    // these gates runs, so the matcher that inherits the gates leaves there
    // too: an operand the compiler already refused has been named once, and
    // the always-false reading of a program that does not yet type-check is
    // not a second mistake to report.
    if (isInvalidType(operand) || isInvalidType(probe)) return;
    if (matcher === "toContain") {
      // The membership vocabulary's own pair (ENM-I3 and COL-I3's second
      // half), asked one element at a time. Only a List receiver compares
      // element identity; text containment is code-point containment, and a
      // dynamic receiver proves nothing about which of the two it will be.
      if (operand.kind !== "list") return;
      const contained = this.readonlyDataViewOf(operand.element);
      if (!this.requireMembershipIntersection(probe, contained, argument.span, matcher)) {
        this.rejectFreshCollectionProbe(argument, matcher, "element");
      }
      return;
    }
    if (this.requireMembershipIntersection(probe, operand, argument.span, matcher)) return;
    if (matcher !== "toBe") return;
    // Either side settles it: `expect([1]).toBe(list)` is as constant as
    // `expect(list).toBe([1])`, exactly as `==` treats its two operands.
    const actualExpression = receiver.arguments[0];
    const fresh = this.freshCollectionOperand(argument)
      ?? (actualExpression && actualExpression.kind !== "SpreadExpression" ? this.freshCollectionOperand(actualExpression) : null);
    if (!fresh) return;
    this.typeError(
      `A ${fresh.description} built inside the expectation is a new object, and 'toBe' compares collection identity, so it can never match; compare contents with 'toEqual(expected)'`,
      fresh.span,
    );
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

  // ENM-D1: an enum member is a bare wire value at runtime, so a Set element or
  // Map key type whose union mixes members of different enums — or an enum
  // with the scalar its own wire values are — would collapse nominally distinct
  // keys into one slot. The same no-intersection principle as D42 item 64,
  // applied where the collection would silently unify what the type system
  // keeps apart. D102 ruling 1: the scalar to watch for follows the wire value,
  // so `Map<Proto | number, T>` collides exactly as `Map<Kind | string, T>`
  // does, and a string-backed enum beside `number` collides with neither.
  private rejectCollidingKeyDomain(keySource: ValueType, span: Span, position: string): void {
    const enumIdentities = new Set<string>();
    let enumName: string | null = null;
    const enumScalars = new Set<"string" | "number">();
    const scalars = new Set<"string" | "number">();
    const visit = (source: ValueType): void => {
      const type = this.expandAliases(source);
      if (type.kind === "enum" || type.kind === "enumMember") {
        enumIdentities.add(type.identity);
        enumName ??= type.name;
        for (const kind of this.enumWireScalarKinds(type)) enumScalars.add(kind);
      } else if (type.kind === "string" || type.kind === "number") {
        scalars.add(type.kind);
      } else if (type.kind === "optional") {
        visit(type.inner);
      } else if (type.kind === "union") {
        for (const member of type.members) visit(member);
      }
    };
    visit(keySource);
    const collidingScalar = [...scalars].find((kind) => enumScalars.has(kind)) ?? null;
    if (enumIdentities.size === 0 || (enumIdentities.size === 1 && collidingScalar === null)) return;
    const collision = collidingScalar !== null
      ? `mixes ${enumName ?? "an enum"} with ${collidingScalar}, and an enum member is a bare ${collidingScalar} at runtime`
      : "mixes members of different enums, which are bare wire values at runtime";
    // The deliberate spelling is the enum's own exit, and only the string one
    // has a function to name: an integer wire value leaves through assignment.
    const deliberate = collidingScalar === "number"
      ? "or bind each member to a number first and store that deliberately"
      : "or store wire strings deliberately with str(member)";
    this.typeError(
      `A ${position} of ${describeType(keySource)} ${collision}, so nominally distinct keys would collapse into one slot; keep the domains in separate collections, ${deliberate}`,
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
    // D102 ruling 1: the exit now leads to whichever scalar the wire value is,
    // so the veto follows it there. `code == Proto.v2` against a bare number is
    // the same mistake as `text == Kind.textDelta` against a bare string, and
    // an enum that pins integers would otherwise be the one enum an open value
    // could walk into unchallenged.
    if (enumStringVeto) {
      const leftEnum = this.valueLevelEnum(left);
      if (leftEnum !== null && this.hasValueLevelScalar(right, this.enumWireScalarKinds(leftEnum))) return false;
      const rightEnum = this.valueLevelEnum(right);
      if (rightEnum !== null && this.hasValueLevelScalar(left, this.enumWireScalarKinds(rightEnum))) return false;
    }
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
    const enumKinds = enumSide === null ? STRING_WIRE_KIND : this.enumWireScalarKinds(enumSide);
    const mixedUnion = (leftEnum !== null && this.hasValueLevelScalar(left, this.enumWireScalarKinds(leftEnum))) ? leftEnum
      : (rightEnum !== null && this.hasValueLevelScalar(right, this.enumWireScalarKinds(rightEnum))) ? rightEnum
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
    if (enumSide !== null && this.hasValueLevelScalar(leftEnum === null ? left : right, enumKinds)) {
      const member = enumSide.kind === "enumMember" ? `${enumSide.name}.${enumSide.member}` : `${enumSide.name}.member`;
      // D102 ruling 1: a member pinned to an integer exits to `number`, and the
      // way back is `parse` there too. The escape half differs because the
      // numeric exit is plain assignability — there is no `str` to name — so it
      // says what to write instead of naming a conversion that does not exist.
      if (!enumKinds.has("string")) {
        return `; an enum member converts to number only as a one-way wire exit, so choose by what an unknown value means here:`
          + ` write ${enumSide.name}.parse(value) == ${member} when the value must name a member — ${enumSide.name}.parse throws on anything else —`
          + ` or bind ${member} to a number first and compare that, when unknown values are expected and must be ignored, as on an open wire protocol`;
      }
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

  /**
   * D102 ruling 1: the boundary the veto names is the one the wire value
   * crosses — a string-backed member meets raw strings, an integer-pinned one
   * meets raw numbers. The wording follows the value, so the report never
   * sends an author looking for a string in a line that holds a number.
   */
  private enumMeetDomain(left: ValueType, right: ValueType): "string" | "number" {
    const enumSide = this.valueLevelEnum(left) ?? this.valueLevelEnum(right);
    if (enumSide === null) return "string";
    return this.enumWireScalarKinds(enumSide).has("string") ? "string" : "number";
  }

  private hasValueLevelString(source: ValueType): boolean {
    return this.hasValueLevelScalar(source, STRING_WIRE_KIND);
  }

  /**
   * D102 ruling 1: the scalar kinds an enum's wire values exit to. A member
   * answers for itself; the whole enum answers with every kind its members
   * declare, so a mixed enum vetoes both domains and the author narrows to a
   * member before comparing. An enum this analyzer cannot see keeps the
   * pre-D102 answer, which is the right one for every string-backed enum.
   */
  private enumWireScalarKinds(source: Extract<ValueType, { kind: "enum" | "enumMember" }>): ReadonlySet<"string" | "number"> {
    const wireValues = this.enumWireValuesOf(source.identity, source.name);
    if (!wireValues || wireValues.size === 0) return STRING_WIRE_KIND;
    if (source.kind === "enumMember") {
      return typeof wireValues.get(source.member) === "number" ? NUMBER_WIRE_KIND : STRING_WIRE_KIND;
    }
    const kinds = new Set<"string" | "number">();
    for (const value of wireValues.values()) kinds.add(typeof value === "number" ? "number" : "string");
    return kinds;
  }

  private hasValueLevelScalar(source: ValueType, kinds: ReadonlySet<"string" | "number">): boolean {
    const type = this.resolveNamedClasses(this.expandAliases(source));
    if (type.kind === "string" || type.kind === "number") return kinds.has(type.kind);
    if (type.kind === "optional") return this.hasValueLevelScalar(type.inner, kinds);
    if (type.kind === "union") return type.members.some((member) => this.hasValueLevelScalar(member, kinds));
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
    // D31 item 23: an arrow bound to a module-local name is the other deferred
    // body a top-level call can run, and the binding does not exist until the
    // declaration finishes, so the frame is filed by the arrow's own span and
    // the declaration claims it afterwards.
    const deferredFrame: DeferredReadFrame = { reads: [], calls: [] };
    this.deferredReadFrames.push(deferredFrame);
    this.arrowDeferredFrames.set(spanIdentity(expression.span), deferredFrame);
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
      // D65 rule 170: the parser let an unannotated rest through so the
      // context could type it the way it types the fixed parameters beside it.
      // If no context arrived, the refusal it deferred is due now.
      if (parameter.rest && !parameter.type && !contextualParameter) {
        this.diagnostics.push(diagnostic("VEL2016", REST_PARAMETER_ELEMENT_TYPE_MESSAGE, parameter.span));
      }
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
    this.arrowCaptureFrames.push({ captured: null });
    const bodyResult = this.inferExpression(expression.body, contextualResult);
    const captured = this.arrowCaptureFrames.pop()?.captured ?? null;
    if (captured) this.arrowOwnedCaptures.set(spanIdentity(expression.span), captured);
    this.parameterDefaultDepth = outerParameterDefaultDepth;
    this.constructorDepth = outerConstructorDepth;
    let checkedBodyResult = expected
      && expandedExpectedResult.kind !== "unknown"
      && expandedExpectedResult.kind !== "any"
      && this.contextuallyAssignable(bodyResult, contextualResult, expression.body.span)
      ? contextualResult
      : bodyResult;
    // D85 rule 207: with no contextual result the arrow's body is the only
    // thing that says what it returns, so an empty collection written there
    // has nothing settling it — the same position a body-inferred `return`
    // occupies, reported the same way. Rule 209: once reported, the arrow's
    // result is invalid rather than a `List<unknown>` a caller reports again.
    if (expandedExpectedResult.kind === "unknown"
      && this.requireSettledCollectionElement(expression.body, checkedBodyResult, false)) {
      checkedBodyResult = invalidType;
    }
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
    this.deferredReadFrames.pop();
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
    if (calleeExpression.kind === "MemberExpression"
      && !calleeExpression.optional
      && calleeExpression.object.kind === "IdentifierExpression"
      && calleeExpression.object.name === "Math"
      && (calleeExpression.property === "sign" || calleeExpression.property === "trunc")
      && arguments_.length === 1
      && arguments_[0]!.kind !== "SpreadExpression") {
      const argument = arguments_[0]!;
      this.requireAssignable(this.inferExpression(argument), numberType, argument.span);
      const method = calleeExpression.property;
      const replacement = `(${this.sourceText.slice(argument.span.start, argument.span.end)}).${method}()`;
      this.diagnostics.push(recoveredDiagnostic(
        "VEL3008",
        `Use '${replacement}'; '${method}' is a number method, not a Math namespace member`,
        callSpan,
        this.commentPreservingMechanicalFix(callSpan, replacement, `Use number method '.${method}()'`),
      ));
      return numberType;
    }
    const hasNamed = argumentNames?.some((name) => name !== null) ?? false;
    const javaScriptBoundary = this.javaScriptBoundaryCallee(calleeExpression);
    if (javaScriptBoundary) {
      this.javaScriptCallBoundaries.add(spanIdentity(callSpan));
      // BRG-U10: at module initialization, a synchronous non-Error throw
      // from an extern call would reach the host raw; the emitter wraps
      // these sites so the value is normalized through the owned channel.
      if (this.inModuleInitializationPosition()) this.moduleTopLevelHostCalls.add(spanIdentity(callSpan));
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
          if (callee.typeParameterNames?.length) {
            return this.inferGenericCall(callee, arguments_, argumentNames, callSpan, nonOptional(this.expandAliases(contextualType)));
          }
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
      // D68 rule 177: `Map(bag)` reads what `@iterate:` answers, so a class
      // that iterates as a Map converts like the Map it names.
      const source = this.iterationSource(argument, this.inferExpression(argument, expectedMap ?? unknownType));
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
      // The same hole one shape further out: a `type` declaration is the most
      // ordinary record the language has, and it arrives as `named`, so
      // `Map(pair)` was refused with a message that listed "a record" among the
      // forms it takes. `fieldsOf` is what tells a record-shaped name from an
      // extension host scalar or an erased generic, exactly as `Promise.all`
      // asks it. The runtime has read ordinary records all along.
      if (source.kind === "named") {
        const fields = this.fieldsOf(source.identity ?? source.name);
        if (fields) {
          let value = unknownType;
          const fieldType = (field: ValueType): ValueType => source.readonlyView ? this.readonlyDataViewOf(field) : field;
          for (const field of fields.values()) value = mergeTypes(value, fieldType(field));
          if (expectedMap) {
            this.requireAssignable(stringType, expectedMap.key, argument.span);
            for (const field of fields.values()) this.requireAssignable(fieldType(field), expectedMap.value, argument.span);
          }
          return fields.size === 0 && expectedMap ? expectedMap : { kind: "map", key: stringType, value };
        }
      }
      // A `Record<V>` is the dynamic-key record, and `__velarCreateMap` has
      // always read it. Only the structural `object` shape was accepted here,
      // so the diagnostic below listed "a record" among the forms it takes and
      // then refused one. Keys of a record are strings by construction.
      if (source.kind === "record") {
        const value = source.readonlyView ? this.readonlyDataViewOf(source.value) : source.value;
        if (expectedMap) {
          this.requireAssignable(stringType, expectedMap.key, argument.span);
          this.requireAssignable(value, expectedMap.value, argument.span);
        }
        return { kind: "map", key: stringType, value };
      }
      if (source.kind === "any") return { kind: "map", key: anyType, value: anyType };
      this.typeError(`Map construction requires a Map, a List of [key, value] Lists, or a record, received ${describeType(source)}${this.iterationGuidance(source)}`, argument.span);
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
      // D68 rule 177: `Set(bag)` reads the same contract every other consumer
      // reads, so the eight sites never disagree about what a class iterates as.
      const source = this.iterationSource(
        argument,
        this.inferExpression(argument, collectionContext?.kind === "set" ? { kind: "list", element: collectionContext.element } : unknownType),
      );
      for (const extra of ordered.slice(1)) this.inferExpression(extra);
      if (source.kind === "list" || source.kind === "set") {
        const element = source.readonlyView ? this.readonlyDataViewOf(source.element) : source.element;
        this.rejectCollidingKeyDomain(element, argument.span, "Set element type");
        return { kind: "set", element };
      }
      if (source.kind === "any") return { kind: "set", element: anyType };
      this.typeError(`Set construction requires a List or Set, received ${describeType(source)}${this.iterationGuidance(source)}`, argument.span);
      return { kind: "set", element: unknownType };
    }

    if (calleeExpression.kind === "MemberExpression" && calleeExpression.object.kind !== "SuperExpression") {
      // The collection/primitive call paths infer the receiver before
      // inferMember can sanction it, so a class-name receiver (`P.make(...)`)
      // is sanctioned here first (D45 rule 75).
      this.memberAccessReceivers.add(spanIdentity(calleeExpression.object.span));
      this.recordMemberAccessProperty(calleeExpression);
      const recordFromResult = this.inferRecordFromCall(calleeExpression, arguments_, argumentNames, callSpan);
      if (recordFromResult) return recordFromResult;
      const recordMapFromResult = this.inferRecordMapFromCall(calleeExpression, arguments_, argumentNames, callSpan);
      if (recordMapFromResult) return recordMapFromResult;
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
        const result = this.inferGenericCall(callee, arguments_, argumentNames, callSpan, contextualType);
        this.reportPromiseCarrierHazard(result, callSpan);
        if (result.kind === "optional") this.optionalCalls.add(spanIdentity(callSpan));
        return result;
      }
      if (calleeExpression.kind === "MemberExpression" && calleeExpression.property === "parse"
        && arguments_[0]?.kind === "ObjectExpression" && callee.result.kind === "named") {
        this.recordRuntimeObjectShape(arguments_[0], callee.result);
      }
      const diagnosticsBeforeArguments = this.diagnostics.length;
      this.checkArguments(arguments_, callee.parameters, callSpan, callee.requiredParameters, callee.rest, argumentNames, callee.parameterNames);
      this.rejectDisjointEnumValidatorProbe(calleeExpression, arguments_);
      // One mistake, one diagnostic: the matcher gate speaks only when the
      // argument itself checked out, because an unassignable comparand has
      // already been named in the words the author needs.
      if (this.diagnostics.length === diagnosticsBeforeArguments) {
        this.checkTestMatcherComparand(calleeExpression, arguments_);
      }
      this.reportPromiseCarrierHazard(callee.result, callSpan);
      if (callee.result.kind === "optional") this.optionalCalls.add(spanIdentity(callSpan));
      return callee.result;
    }
    if (callee.kind === "optional" && (callee.inner.kind === "function" || callee.inner.kind === "action")) {
      const inner = callee.inner;
      const result = this.withTemporaryNarrowings(this.optionalExecutionNarrowings(calleeExpression), callSpan, () => {
        if (inner.typeParameterNames?.length) {
          return this.inferGenericCall(inner, arguments_, argumentNames, callSpan, nonOptional(this.expandAliases(contextualType)));
        }
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
        // D90 R17: a call needs a declared signature — `Type.parse` validates
        // data, so the way in for a callable is the extern contract.
        const receiver = calleeExpression ? this.boundaryReceiverText(calleeExpression) : null;
        this.typeError(
          `Cannot call an unknown JavaScript value without a declaration or validation; declare the signature — an 'extern module' contract or a contracted 'extern js' block gives ${receiver ? `'${receiver}'` : "the value"} a checked type — or validate the data it came from with 'Type.parse' first`,
          callSpan,
        );
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

  // Three-phase call-site unification for generic callables: phase 1 infers
  // non-arrow arguments and collects bindings; phase 2 gives arrows contextual
  // types with the phase-1 substitution applied, then unifies their results;
  // phase 3 (D114 item ①) matches the declared result against the type the
  // position expects and seeds whatever the arguments left open. Type
  // parameters no phase solved substitute unknown.
  private inferGenericCall(
    callee: Extract<ValueType, { kind: "function" | "action" }>,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    contextualType: ValueType = unknownType,
  ): ValueType {
    const bindings: (ValueType | null)[] = Array.from({ length: callee.typeParameterNames?.length ?? 0 }, () => null);
    // NEW-D3: parameters an `unknown` argument reached are solved-to-unknown,
    // which no bound admits; they are tracked apart from `bindings` so that
    // `unknown` still never poisons a merge with a concrete argument.
    const unknownParameters = new Set<number>();
    const fieldsOf = (identity: string): ReadonlyMap<string, ValueType> | null => this.fieldsOf(identity);
    // A solved type argument is canonicalized the same way an annotation's is;
    // see the `parameter` branch of `unifyInto` for why the `Type<T>` path is
    // the one that would otherwise carry an unexpanded alias into `Channel<T>`.
    const expandAliases = (type: ValueType): ValueType => this.expandAliases(type);
    // D55 rule 121: substituting into `Box<T>` produces an instantiation this
    // module may never have written down, and it still has to have a field
    // table — otherwise `def unwrap<T>(box: Box<T>)` would solve T correctly
    // and then fail to accept the very record that solved it.
    const substitute = (declared: ValueType): ValueType => {
      const substituted = substituteTypeParameters(declared, bindings);
      this.noteGenericApplications(substituted);
      return substituted;
    };
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
      // D68 rule 177: a call spread consumes an iterable, so it reads the
      // `@iterate:` answer — `f(...bag)` is `f(...bag.items)`, refusal included.
      const actual = item.spreadList
        ? this.iterationSource(item.value, this.inferExpression(item.value, context))
        : this.inferExpression(item.value, context);
      actuals.set(item, actual);
      if (!item.declared) continue;
      if (item.spreadList) {
        const expanded = this.expandAliases(actual);
        if (expanded.kind === "list") unifyTypeParameters(item.declared, expanded.element, bindings, fieldsOf, unknownParameters, expandAliases);
      } else {
        unifyTypeParameters(item.declared, actual, bindings, fieldsOf, unknownParameters, expandAliases);
      }
    }
    for (const item of deferredArrows) {
      const context = item.declared ? substitute(item.declared) : unknownType;
      const actual = this.inferExpression(item.value, context);
      actuals.set(item, actual);
      if (item.declared) unifyTypeParameters(item.declared, actual, bindings, fieldsOf, unknownParameters, expandAliases);
    }
    const seeded = this.seedTypeParametersFromPosition(callee.result, bindings, unknownParameters, contextualType, fieldsOf, expandAliases);
    this.reportGenericBoundViolations(callee, bindings, planned, callSpan, unknownParameters, seeded);
    for (const item of planned) {
      const actual = actuals.get(item) ?? unknownType;
      if (!item.declared) continue;
      if (item.spreadList) {
        const expanded = this.expandAliases(actual);
        if (expanded.kind === "list") this.requireAssignable(expanded.element, substitute(item.declared), item.errorSpan);
        else if (expanded.kind !== "any") this.typeError(`Call spread requires a List, received ${describeType(actual)}${this.iterationGuidance(actual)}`, item.errorSpan);
        continue;
      }
      this.requireAssignable(actual, substitute(item.declared), item.errorSpan);
    }
    return substitute(callee.result);
  }

  /**
   * D114 item ①, the ruling D77 rule 194 left open: a type parameter the
   * arguments leave open is solved from the position the call is written in.
   * The position is the one `contextualType` already carries — the same
   * channel section 8 reads to settle an empty `[]`, `Set()`, or `Map()` — so
   * "what is a contextual type" has one definition and cannot drift into
   * `const names: List<string> = []` passing while `= empty()` does not.
   *
   * Two disciplines make this seeding and never a guess:
   *
   * - It never overrides. Candidates are unified into a separate table and
   *   copied back only where the arguments solved nothing, so a disagreement
   *   between an argument and the annotation stays the ordinary mismatch the
   *   position already reported (D114 item ①), not a new diagnostic. A
   *   parameter only an `unknown` argument reached counts as reached: its
   *   bound violation is the argument's, and seeding over it would move that
   *   report to the position and change its words.
   * - It matches structurally, through `unifyTypeParameters` — the same walk
   *   an argument takes, so the shapes a type argument can be read out of are
   *   one list rather than two: a container's element, a Map's key and value,
   *   a Record's or a Promise's value, an optional's inner type, a callable's
   *   parameters and result, one generic record application's arguments
   *   against the same declaration, and so on down. A shape that walk does not
   *   pair leaves the parameter open, and phase 4 substitutes `unknown` as
   *   before.
   *
   * The `readonly` qualifier belongs to the position rather than to the type
   * argument: `readonly List<string>` seeds `T = string`, and a bare `T` in
   * result position takes the mutable spelling of the expected type, which is
   * the only one a type argument can be written with. An optional annotation
   * is read through for the same reason section 8 reads it through
   * (`contextualCollectionType` recurses on `optional`, so `const tags:
   * Set<string>? = Set()` keeps its element contract): a result that is itself
   * optional pairs with it directly, and any other result shape matches the
   * type the annotation holds.
   */
  private seedTypeParametersFromPosition(
    result: ValueType,
    bindings: (ValueType | null)[],
    unknownParameters: ReadonlySet<number>,
    contextualType: ValueType,
    fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
    expandAliases: (type: ValueType) => ValueType,
  ): ReadonlySet<number> {
    const seeded = new Set<number>();
    const open = (parameter: Extract<ValueType, { kind: "parameter" }>): boolean =>
      bindings[parameter.index] == null && !unknownParameters.has(parameter.index);
    if (!typeContainsParameter(result, open)) return seeded;
    const expected = expandAliases(mutableViewOf(contextualType));
    // `unknown` and `any` are the two positions that say nothing about the
    // value they receive, which is why section 8 refuses to settle an empty
    // collection at either; a type argument reads them the same way.
    if (expected.kind === "unknown" || expected.kind === "any" || isInvalidType(expected)) return seeded;
    const match = (against: ValueType): (ValueType | null)[] => {
      const table: (ValueType | null)[] = bindings.map(() => null);
      unifyTypeParameters(result, against, table, fieldsOf, undefined, expandAliases);
      return table;
    };
    let candidates = match(expected);
    if (expected.kind === "optional" && candidates.every((candidate) => candidate === null)) {
      candidates = match(expandAliases(expected.inner));
    }
    for (const [index, candidate] of candidates.entries()) {
      if (!candidate || bindings[index] != null || unknownParameters.has(index)) continue;
      if (candidate.kind === "unknown" || isInvalidType(candidate)) continue;
      bindings[index] = candidate;
      seeded.add(index);
    }
    return seeded;
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
    unknownParameters?: ReadonlySet<number>,
    seeded?: ReadonlySet<number>,
  ): void {
    const violations = collectGenericBoundViolations(callee, bindings, (type, bound) => this.satisfiesBound(type, bound), unknownParameters);
    for (const violation of violations) {
      // "Report at the cause" (D31 item 27). The one shape it cannot serve is
      // a parameter several arguments merged into: there is no single cause,
      // so the call itself reports and names the type that was solved.
      // A seeded parameter (D114 item ①) has no argument cause at all — the
      // position solved it — so it reports at the call and names the solver
      // it actually had. Same sentence, true subject.
      const causes = seeded?.has(violation.index)
        ? []
        : planned.filter((item) => item.declared !== null
          && typeContainsParameter(item.declared, (parameter) => parameter.index === violation.index));
      const solver = seeded?.has(violation.index) ? "the expected type solves" : "the arguments solve";
      const guidance = boundVocabularyGuidance[violation.bound];
      this.diagnostics.push(causes.length === 1
        ? diagnostic(
          "VEL4031",
          `Type parameter '${violation.name}' is bound by ${violation.bound}, so this argument cannot be ${describeType(violation.solved)}; ${guidance}`,
          causes[0]!.errorSpan,
        )
        : diagnostic(
          "VEL4031",
          `Type parameter '${violation.name}' is bound by ${violation.bound} but ${solver} it to ${describeType(violation.solved)}; ${guidance}`,
          callSpan,
        ));
    }
  }

  /**
   * D41 item 61 check site 2: a generic callable used as a value is solved and
   * erased silently, so the wrapper re-asks the bound question and turns the
   * rejection into a directed message at the value's own span.
   */
  private instantiateCallable<T extends Extract<ValueType, { kind: "function" | "action" | "intrinsic" }>>(actual: T, expected: T, violations?: GenericBoundViolation[]): T {
    const instantiated = instantiateGenericCallable(actual, expected, this, violations) as T;
    this.noteGenericApplications(instantiated);
    return instantiated;
  }

  private genericBoundViolation(actual: ValueType, expected: ValueType): GenericBoundViolation | null {
    if (actual.kind !== "function" && actual.kind !== "action" && actual.kind !== "intrinsic") return null;
    if (!actual.typeParameterBounds?.some((bound) => bound !== null)) return null;
    if (expected.kind !== "function" && expected.kind !== "action" && expected.kind !== "intrinsic") return null;
    if (expected.typeParameterNames?.length) return null;
    const violations: GenericBoundViolation[] = [];
    this.instantiateCallable(actual, expected, violations);
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
    return this.instantiateCallable(actual, expected);
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
        else {
          const declared = target === null ? unknownType : intrinsic.parameters[target] ?? intrinsic.rest ?? unknownType;
          // D90 R17: an accept-anything parameter is spelled `List<unknown>`
          // in the vocabulary tables, and that spelling carries no element
          // information — preanalyzing a literal against it would launder
          // `[1, 2]` into a list the handler can read no numbers from, so the
          // literal keeps its own inferred element and the handler's own
          // expected type does the checking.
          const context = declared.kind === "list" && declared.element.kind === "unknown" ? unknownType : declared;
          this.inferExpression(value, context);
        }
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
      if (argument) {
        this.typeError(
          "Runtime parsing requires a VelarScript runtime type: pass a declared type, enum, or alias name — 'type Saved = List<Item>' makes 'Saved' one. A primitive spelling ('string') and a generic spelling ('List<Item>') are types, not values",
          argument.span,
        );
      }
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
        this.testExpectOperands.set(spanIdentity(callSpan), matched);
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
          // D90 R17: an accept-anything parameter position is `unknown`, the
          // top type for assignment targets; `any` stays a value kind only.
          const contained = matched.kind === "list" ? matched.element : matched.kind === "string" ? stringType : unknownType;
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
          ? `${describeType(operands[0].type)} and ${describeType(operands[1].type)} can meet only where an enum member matches a raw ${this.enumMeetDomain(operands[0].type, operands[1].type)},`
            + ` and the enum and ${this.enumMeetDomain(operands[0].type, operands[1].type)} domains never meet in equals${this.equalityGuidance(operands[0].type, operands[1].type)}`
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
    const object = this.expandAliases(this.inferredOrAnalyze(member.object));
    if (object.kind !== "list" && object.kind !== "map" && object.kind !== "set" && object.kind !== "record") return null;
    const mutating = object.kind === "list"
      ? new Set(["append", "extend", "insert", "remove", "pop", "clear"])
      : object.kind === "map" ? new Set(["set", "getOrSet", "getOrSetWith", "update", "remove", "clear"])
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
    const inferListCallback = (index: number, result: ValueType): ValueType => {
      const argument = argumentAt(index);
      if (!argument) return unknownType;
      const single: ValueType = { kind: "function", parameters: [readonlyElement!], requiredParameters: 1, result };
      const indexed: ValueType = { kind: "function", parameters: [readonlyElement!, numberType], requiredParameters: 2, result };
      let callback = namedPreanalyzed
        ? this.inferredExpressionType(argument)
        : inferArgument(index, argument.kind === "ArrowFunctionExpression" && argument.parameters.length >= 2 ? indexed : single);
      const expanded = this.expandAliases(callback);
      const expected = (expanded.kind === "function" || expanded.kind === "action" || expanded.kind === "intrinsic")
        && (expanded.parameters.length >= 2 || expanded.rest)
        ? indexed
        : single;
      callback = this.concreteCallableFor(callback, expected, argument.span);
      this.requireAssignable(callback, expected, argument.span);
      return callback;
    };
    // ENM-I3: a membership probe (`has`, `index`, `count`, `remove`, and the
    // Map/Record key of `get`) is judged by intersection with the element or
    // key domain — the per-element `==` question — rather than assignability,
    // whose enum -> string one-way exit would launder a bare-string match.
    const checkProbeArgument = (domain: ValueType, operation: string, probes: "element" | "key" = "element"): void => {
      requireCount(1);
      const argument = argumentAt(0);
      if (!argument) return;
      if (argument.kind === "SpreadExpression") {
        this.inferExpression(argument.value);
        return;
      }
      const probe = namedPreanalyzed ? this.inferredExpressionType(argument) : this.inferExpression(argument, domain);
      // The domain mismatch is the more precise answer where both apply, so
      // the fresh-literal rejection speaks only when the probe's type is right
      // and identity is the sole reason it can never match.
      if (!this.requireMembershipIntersection(probe, domain, argument.span, operation)) {
        this.rejectFreshCollectionProbe(argument, operation, probes);
      }
      if (!namedPreanalyzed) {
        for (const extra of arguments_.slice(1)) {
          if (!omitted(extra)) this.inferExpression(extra.kind === "SpreadExpression" ? extra.value : extra);
        }
      }
    };
    const lowered = object.kind === "list"
      ? (CORE_LIST_METHOD_NAMES as readonly string[]).includes(member.property)
      : object.kind === "map" ? (CORE_MAP_METHOD_NAMES as readonly string[]).includes(member.property)
        : object.kind === "set" ? (CORE_SET_METHOD_NAMES as readonly string[]).includes(member.property)
          : object.kind === "record" ? (CORE_RECORD_METHOD_NAMES as readonly string[]).includes(member.property) : false;
    if (lowered && arguments_.some((argument) => argument.kind === "SpreadExpression")) {
      this.typeError(`Spread arguments are not supported by ${describeType(object)}.${member.property}`, callSpan);
    }
    if (object.kind === "list") {
      if (member.property === "map" || member.property === "flatMap") {
        const flat = member.property === "flatMap";
        this.collectionCalls.set(member.span.end, flat ? "listFlatMap" : "listMap");
        const callbackArgument = argumentAt(0);
        const callback = inferListCallback(0, unknownType);
        const concrete = this.expandAliases(callback);
        const result = concrete.kind === "function" ? concrete.result : unknownType;
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
        const callbackArgument = argumentAt(0);
        if (callbackArgument) inferListCallback(0, boolType);
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
        if (argument) this.requireAssignable(value, object.element, argument.span);
        requireCount(1);
        return nullType;
      }
      if (member.property === "extend") {
        this.collectionCalls.set(member.span.end, "listExtend");
        const argument = argumentAt(0);
        const source = argument ? this.expandAliases(inferArgument(0)) : unknownType;
        if (argument) this.requireAssignable(source, object, argument.span);
        requireCount(1);
        return nullType;
      }
      if (member.property === "insert") {
        this.collectionCalls.set(member.span.end, "listInsert");
        const indexArgument = argumentAt(0);
        if (indexArgument) this.requireAssignable(inferArgument(0, numberType), numberType, indexArgument.span);
        const argument = argumentAt(1);
        const value = inferArgument(1, object.element);
        if (argument) this.requireAssignable(value, object.element, argument.span);
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
        this.collectionCalls.set(member.span.end, member.property === "clear" ? "listClear" : member.property === "copy" ? "listCopy" : "listReversed");
        checkCollectionArguments([]);
        return member.property === "clear" ? nullType : { kind: "list", element: readonlyElement! };
      }
      if (member.property === "has" || member.property === "count") {
        this.collectionCalls.set(member.span.end, member.property === "has" ? "listHas" : "listCount");
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
        const callbackArgument = argumentAt(0);
        if (callbackArgument) inferListCallback(0, boolType);
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
        this.collectionCalls.set(member.span.end, "listGet");
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
        // D85 rule 211: the receiver's declared key and value types are the
        // contextual types of this call, exactly as `List.append` passes its
        // element type. Without them an empty `[]`, an arrow, or any other
        // value that reads its shape from context arrives as `unknown`.
        const key = inferArgument(0, object.key);
        const value = inferArgument(1, object.value);
        if (keyArgument) this.requireAssignable(key, object.key, keyArgument.span);
        if (valueArgument) this.requireAssignable(value, object.value, valueArgument.span);
        requireCount(2);
        return nullType;
      }
      if (member.property === "getOrSet") {
        this.collectionCalls.set(member.span.end, "mapGetOrSet");
        const keyArgument = argumentAt(0);
        const valueArgument = argumentAt(1);
        const key = inferArgument(0, object.key);
        const value = inferArgument(1, object.value);
        if (keyArgument) this.requireAssignable(key, object.key, keyArgument.span);
        if (valueArgument) this.requireAssignable(value, object.value, valueArgument.span);
        requireCount(2);
        return object.value;
      }
      if (member.property === "getOrSetWith") {
        this.collectionCalls.set(member.span.end, "mapGetOrSetWith");
        const keyArgument = argumentAt(0);
        const factoryArgument = argumentAt(1);
        const key = inferArgument(0, object.key);
        const factoryType: ValueType = {
          kind: "function",
          parameterNames: [],
          parameters: [],
          requiredParameters: 0,
          result: object.value,
        };
        const factory = inferArgument(1, factoryType);
        if (keyArgument) this.requireAssignable(key, object.key, keyArgument.span);
        if (factoryArgument) this.requireAssignable(factory, factoryType, factoryArgument.span);
        requireCount(2);
        return object.value;
      }
      if (member.property === "update") {
        this.collectionCalls.set(member.span.end, "mapUpdate");
        const argument = argumentAt(0);
        const source = argument ? this.expandAliases(inferArgument(0)) : unknownType;
        if (argument) this.requireAssignable(source, object, argument.span);
        requireCount(1);
        return nullType;
      }
      if (member.property === "get") {
        this.collectionCalls.set(member.span.end, "mapGet");
        if (!namedPreanalyzed && sourceArguments.length === 2 && !sourceArguments.some((argument) => argument.kind === "SpreadExpression")) {
          const key = inferArgument(0, comparisonKey!);
          const keyArgument = argumentAt(0);
          if (keyArgument) this.requireMembershipIntersection(key, comparisonKey!, keyArgument.span, "Map.get");
          inferArgument(1);
          this.typeError("Use 'get(key) ?? fallback'; Map.get has one optional-result contract", callSpan);
          return optionalOf(readonlyValue!);
        }
        checkProbeArgument(comparisonKey!, "Map.get", "key");
        return optionalOf(readonlyValue!);
      }
      if (member.property === "iterator") {
        this.collectionCalls.set(member.span.end, "mapIterator");
        checkCollectionArguments([]);
        return iteratorOf(readonlyKey!);
      }
      if (member.property === "keys") {
        this.collectionCalls.set(member.span.end, "mapKeys");
        checkCollectionArguments([]);
        return { kind: "list", element: readonlyKey! };
      }
      if (member.property === "values") {
        this.collectionCalls.set(member.span.end, "mapValues");
        checkCollectionArguments([]);
        return { kind: "list", element: readonlyValue! };
      }
      if (member.property === "entries") {
        this.collectionCalls.set(member.span.end, "mapEntries");
        checkCollectionArguments([]);
        return { kind: "list", element: { kind: "object", fields: new Map([["key", readonlyKey!], ["value", readonlyValue!]]) } };
      }
      if (member.property === "has") {
        this.collectionCalls.set(member.span.end, "mapHas");
        checkProbeArgument(comparisonKey!, "Map.has", "key");
        return boolType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.end, "mapRemove");
        checkProbeArgument(comparisonKey!, "Map.remove", "key");
        return boolType;
      }
      if (member.property === "clear") {
        this.collectionCalls.set(member.span.end, "mapClear");
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
        this.collectionCalls.set(member.span.end, "recordGet");
        checkProbeArgument(stringType, "Record.get", "key");
        return optionalOf(readonlyValue!);
      }
      if (member.property === "keys") {
        this.collectionCalls.set(member.span.end, "recordKeys");
        checkCollectionArguments([]);
        return { kind: "list", element: stringType };
      }
      if (member.property === "values") {
        this.collectionCalls.set(member.span.end, "recordValues");
        checkCollectionArguments([]);
        return { kind: "list", element: readonlyValue! };
      }
      if (member.property === "entries") {
        this.collectionCalls.set(member.span.end, "recordEntries");
        checkCollectionArguments([]);
        return { kind: "list", element: { kind: "object", fields: new Map([["key", stringType], ["value", readonlyValue!]]) } };
      }
      if (member.property === "has") {
        this.collectionCalls.set(member.span.end, "recordHas");
        checkProbeArgument(stringType, "Record.has", "key");
        return boolType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.end, "recordRemove");
        checkProbeArgument(stringType, "Record.remove", "key");
        return boolType;
      }
      if (member.property === "clear") {
        this.collectionCalls.set(member.span.end, "recordClear");
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
        if (argument) this.requireAssignable(value, object.element, argument.span);
        return nullType;
      }
      if (member.property === "update") {
        this.collectionCalls.set(member.span.end, "setUpdate");
        const argument = argumentAt(0);
        const accepted: ValueType = { kind: "union", members: [object, { kind: "list", element: object.element }] };
        const source = argument ? this.expandAliases(inferArgument(0)) : unknownType;
        if (argument) this.requireAssignable(source, accepted, argument.span);
        requireCount(1);
        return nullType;
      }
      if (member.property === "has") {
        this.collectionCalls.set(member.span.end, "setHas");
        checkProbeArgument(comparisonElement!, "Set.has");
        return boolType;
      }
      if (member.property === "remove") {
        this.collectionCalls.set(member.span.end, "setRemove");
        checkProbeArgument(comparisonElement!, "Set.remove");
        return boolType;
      }
      if (member.property === "clear") {
        this.collectionCalls.set(member.span.end, "setClear");
        checkCollectionArguments([]);
        return nullType;
      }
      if (member.property === "values") {
        this.collectionCalls.set(member.span.end, "setValues");
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

  /**
   * A concrete record Type owns one compiler-only constructor:
   *
   *     Response.from(source, {worldId})
   *
   * The source is already typed; this is not validation and therefore never
   * accepts unknown/any. The target field table is the authority. Overrides
   * must be a literal so every exception to same-name projection is visible
   * to the analyzer, and lowering can copy only declared target fields without
   * exposing an open source record's surplus runtime data.
   */
  private inferRecordFromCall(
    member: Extract<Expression, { kind: "MemberExpression" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType | null {
    if (member.property !== "from" || member.optional || member.object.kind !== "IdentifierExpression") return null;
    const binding = this.lookup(member.object.name);
    if (binding?.type.kind !== "typeObject") return null;
    const diagnosticsBefore = this.diagnostics.length;

    this.callExpressionCallees.add(spanIdentity(member.span));
    const receiver = this.inferExpression(member.object);
    if (isInvalidType(receiver) || receiver.kind !== "typeObject") {
      for (const argument of sourceArguments) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      return invalidType;
    }

    const target = this.runtimeTypeObjectValue(receiver);
    const targetShape = this.recordProjectionShape(target);
    const callable: ValueType = {
      kind: "function",
      parameterNames: ["source", "overrides"],
      parameters: [unknownType, unknownType],
      requiredParameters: 1,
      result: target,
    };
    this.semanticExpressionOwners.set(`${member.span.start}:${member.span.end}`, receiver);
    this.recordSemanticExpression(member, callable);
    if (!targetShape) {
      for (const argument of sourceArguments) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.typeError(
        `Type '${receiver.name}' is not a concrete record, so it cannot use '.from'; declare a record type whose fields define the projection`,
        member.span,
      );
      return invalidType;
    }

    const named = this.planNamedArguments(
      sourceArguments,
      argumentNames,
      [unknownType, unknownType],
      ["source", "overrides"],
      1,
      callSpan,
    );
    if (named && !named.valid) {
      for (const argument of sourceArguments) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      return target;
    }
    if (!named && (sourceArguments.length < 1 || sourceArguments.length > 2)) {
      for (const argument of sourceArguments) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.typeError(`Expected 1-2 arguments but received ${sourceArguments.length}`, callSpan);
      return target;
    }

    const ordered = named?.ordered ?? sourceArguments;
    const omitted = (expression: Expression | undefined): boolean => expression?.kind === "IdentifierExpression"
      && expression.name === "\u0000omitted-named-argument";
    const sourceExpression = ordered[0];
    const overridesExpression = omitted(ordered[1]) ? undefined : ordered[1];
    if (!sourceExpression || omitted(sourceExpression)) return target;
    if (sourceExpression.kind === "SpreadExpression") {
      this.inferExpression(sourceExpression.value);
      if (overridesExpression) this.inferExpression(overridesExpression.kind === "SpreadExpression" ? overridesExpression.value : overridesExpression);
      this.typeError("A record projection takes one source value; call spread cannot decide that source", sourceExpression.span);
      return target;
    }

    const source = this.inferExpression(sourceExpression);
    const sourceShape = this.recordProjectionShape(source);
    if (!isInvalidType(source) && (source.kind === "unknown" || source.kind === "any")) {
      this.typeError(
        `Cannot build ${describeType(target)} from ${describeType(source)}; validate untrusted data with 'Type.parse' before projecting a typed record`,
        sourceExpression.span,
      );
    } else if (!isInvalidType(source) && !sourceShape) {
      this.typeError(
        `Cannot build ${describeType(target)} from ${describeType(source)}; '.from' requires a typed record source`,
        sourceExpression.span,
      );
    }

    const overridden = new Set<string>();
    if (overridesExpression) {
      if (overridesExpression.kind === "SpreadExpression") {
        this.inferExpression(overridesExpression.value);
        this.typeError("Record projection overrides must be one explicit record literal, not a call spread", overridesExpression.span);
      } else if (overridesExpression.kind !== "ObjectExpression") {
        this.inferExpression(overridesExpression);
        this.typeError(
          `Overrides for ${describeType(target)}.from must be a record literal so every replacement field is visible`,
          overridesExpression.span,
        );
      } else {
        for (const property of overridesExpression.properties) {
          if (property.kind === "ObjectSpread") {
            this.typeError(
              `Overrides for ${describeType(target)}.from must name fields explicitly; an override spread can hide extra or misspelled fields`,
              property.span,
            );
          } else {
            overridden.add(property.name);
          }
        }
        this.inferExpression(overridesExpression, {
          kind: "object",
          fields: targetShape.fields,
          optionalFields: new Set(targetShape.fields.keys()),
        });
      }
    }

    if (sourceShape) {
      for (const [name, expected] of targetShape.fields) {
        if (overridden.has(name)) continue;
        let actual = sourceShape.fields.get(name);
        if (!actual) {
          if (targetShape.optionalFields.has(name)) continue;
          this.typeError(
            `${describeType(target)}.from cannot fill required field '${name}' from ${describeType(source)}; provide '${name}' in the overrides literal`,
            sourceExpression.span,
          );
          continue;
        }
        if (sourceShape.optionalFields.has(name) && actual.kind !== "optional") actual = optionalOf(actual);
        if (sourceShape.readonlyFields.has(name) || sourceShape.readonlyView) actual = this.readonlyDataViewOf(actual);
        if (!isAssignable(actual, expected, this)) {
          this.typeError(
            `${describeType(target)}.from cannot fill field '${name}': ${describeType(source)} provides ${describeType(actual)}, but the target requires ${describeType(expected)}; override '${name}' explicitly`,
            sourceExpression.span,
          );
        }
      }
    }

    if (this.diagnostics.length === diagnosticsBefore) {
      this.recordFromCalls.set(spanIdentity(callSpan), {
        target: receiver.name,
        fields: [...targetShape.fields].map(([name, type]) => ({
          name,
          optional: targetShape.optionalFields.has(name) || type.kind === "optional",
        })),
      });
    }
    return target;
  }

  /**
   * A mapped projection keeps the target record's field table as the sole
   * authority while converting every same-name source value with one
   * callback:
   *
   *     RuntimePalette.mapFrom(identityPalette, resolve)
   *
   * This is intentionally a concrete-record operation rather than
   * `Record.map`: the analyzer can prove that every required target field is
   * present, the emitter can preserve target declaration order, and callers
   * retain named-field completion on the returned value.
   */
  private inferRecordMapFromCall(
    member: Extract<Expression, { kind: "MemberExpression" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType | null {
    if (member.property !== "mapFrom" || member.optional || member.object.kind !== "IdentifierExpression") return null;
    const binding = this.lookup(member.object.name);
    if (binding?.type.kind !== "typeObject") return null;
    const diagnosticsBefore = this.diagnostics.length;

    this.callExpressionCallees.add(spanIdentity(member.span));
    const receiver = this.inferExpression(member.object);
    if (isInvalidType(receiver) || receiver.kind !== "typeObject") {
      for (const argument of sourceArguments) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      return invalidType;
    }

    const target = this.runtimeTypeObjectValue(receiver);
    const targetShape = this.recordProjectionShape(target);
    const callable: ValueType = {
      kind: "function",
      parameterNames: ["source", "transform"],
      parameters: [unknownType, { kind: "function", parameters: [unknownType], requiredParameters: 1, result: unknownType }],
      requiredParameters: 2,
      result: target,
    };
    this.semanticExpressionOwners.set(`${member.span.start}:${member.span.end}`, receiver);
    this.recordSemanticExpression(member, callable);
    if (!targetShape) {
      for (const argument of sourceArguments) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.typeError(
        `Type '${receiver.name}' is not a concrete record, so it cannot use '.mapFrom'; declare a record type whose fields define the mapped projection`,
        member.span,
      );
      return invalidType;
    }

    const named = this.planNamedArguments(
      sourceArguments,
      argumentNames,
      [unknownType, unknownType],
      ["source", "transform"],
      2,
      callSpan,
    );
    if (named && !named.valid) {
      for (const argument of sourceArguments) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      return target;
    }
    if (!named && sourceArguments.length !== 2) {
      for (const argument of sourceArguments) this.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.typeError(`Expected 2 arguments but received ${sourceArguments.length}`, callSpan);
      return target;
    }

    const ordered = named?.ordered ?? sourceArguments;
    const omitted = (expression: Expression | undefined): boolean => expression?.kind === "IdentifierExpression"
      && expression.name === "\u0000omitted-named-argument";
    const sourceExpression = ordered[0];
    const transformExpression = ordered[1];
    if (!sourceExpression || !transformExpression || omitted(sourceExpression) || omitted(transformExpression)) return target;
    if (sourceExpression.kind === "SpreadExpression" || transformExpression.kind === "SpreadExpression") {
      this.inferExpression(sourceExpression.kind === "SpreadExpression" ? sourceExpression.value : sourceExpression);
      this.inferExpression(transformExpression.kind === "SpreadExpression" ? transformExpression.value : transformExpression);
      this.typeError("A mapped record projection does not accept call spreads", callSpan);
      return target;
    }

    const source = this.inferExpression(sourceExpression);
    const sourceShape = this.recordProjectionShape(source);
    if (!isInvalidType(source) && (source.kind === "unknown" || source.kind === "any")) {
      this.typeError(
        `Cannot build ${describeType(target)} from ${describeType(source)}; validate untrusted data with 'Type.parse' before mapping a typed record`,
        sourceExpression.span,
      );
    } else if (!isInvalidType(source) && !sourceShape) {
      this.typeError(
        `Cannot build ${describeType(target)} from ${describeType(source)}; '.mapFrom' requires a typed record source`,
        sourceExpression.span,
      );
    }

    const sourceFieldTypes: ValueType[] = [];
    if (sourceShape) {
      for (const [name] of targetShape.fields) {
        let actual = sourceShape.fields.get(name);
        if (!actual) {
          if (targetShape.optionalFields.has(name)) continue;
          this.typeError(
            `${describeType(target)}.mapFrom cannot fill required field '${name}' from ${describeType(source)}`,
            sourceExpression.span,
          );
          continue;
        }
        if (sourceShape.optionalFields.has(name) && !targetShape.optionalFields.has(name)) {
          this.typeError(
            `${describeType(target)}.mapFrom cannot fill required field '${name}' from optional field '${name}' on ${describeType(source)}`,
            sourceExpression.span,
          );
        }
        if (sourceShape.optionalFields.has(name) && actual.kind !== "optional") actual = optionalOf(actual);
        if (sourceShape.readonlyFields.has(name) || sourceShape.readonlyView) actual = this.readonlyDataViewOf(actual);
        sourceFieldTypes.push(actual);
      }
    }

    const sourceFieldType = unionOf(sourceFieldTypes);
    const transformExpected: ValueType = {
      kind: "function",
      parameters: [sourceFieldType],
      parameterNames: ["value"],
      requiredParameters: 1,
      result: unknownType,
    };
    const transform = this.concreteCallableFor(
      this.inferExpression(transformExpression, transformExpected),
      transformExpected,
      transformExpression.span,
    );
    this.requireAssignable(transform, transformExpected, transformExpression.span);
    const result = transform.kind === "function" ? transform.result : unknownType;
    const checkedTargetTypes: ValueType[] = [];
    for (const expected of targetShape.fields.values()) {
      if (checkedTargetTypes.some((existing) => sameType(existing, expected))) continue;
      checkedTargetTypes.push(expected);
      if (!isAssignable(result, expected, this)) {
        this.typeError(
          `${describeType(target)}.mapFrom transform returns ${describeType(result)}, but target fields require ${describeType(expected)}`,
          transformExpression.span,
        );
      }
    }

    if (this.diagnostics.length === diagnosticsBefore) {
      this.recordMapFromCalls.set(spanIdentity(callSpan), {
        target: receiver.name,
        fields: [...targetShape.fields].map(([name, type]) => ({
          name,
          optional: targetShape.optionalFields.has(name) || type.kind === "optional",
        })),
      });
    }
    return target;
  }

  private recordProjectionShape(type: ValueType): {
    readonly fields: ReadonlyMap<string, ValueType>;
    readonly optionalFields: ReadonlySet<string>;
    readonly readonlyFields: ReadonlySet<string>;
    readonly readonlyView: boolean;
  } | null {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "object") {
      return {
        fields: expanded.fields,
        optionalFields: expanded.optionalFields ?? new Set(),
        readonlyFields: expanded.readonlyFields ?? new Set(),
        readonlyView: expanded.readonlyView === true,
      };
    }
    if (expanded.kind !== "named") return null;
    const identity = expanded.identity ?? expanded.name;
    const fields = this.fieldsOf(identity);
    if (!fields) return null;
    return {
      fields,
      optionalFields: new Set([...fields].filter(([, field]) => field.kind === "optional").map(([name]) => name)),
      readonlyFields: this.readonlyFieldsOf(identity) ?? new Set(),
      readonlyView: expanded.readonlyView === true,
    };
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
    this.memberAccessProperties.set(spanIdentity(objectExpression.span), { property, end: memberSpan.end });
    const original = this.inferredOrAnalyze(objectExpression);
    this.semanticExpressionOwners.set(`${memberSpan.start}:${memberSpan.end}`, nonOptional(original));
    const resolvedOriginal = this.expandAliases(original);
    const object = nonOptional(resolvedOriginal);
    const binaryKind = binaryStorageKind(object);
    if (binaryKind && property === "size") this.binarySizes.set(memberSpan.end, binaryKind);
    if (binaryKind && binaryKind !== "bytes") {
      if (property === "copy") this.binaryCalls.set(memberSpan.end, "bufferCopy");
      if (property === "slice") this.binaryCalls.set(memberSpan.end, "bufferSlice");
      if (property === "toBytes") this.binaryCalls.set(memberSpan.end, "bufferToBytes");
      if (property === "values") this.binaryCalls.set(memberSpan.end, "bufferValues");
    }
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
      else this.typeError(`Cannot access '${property}' on unknown without validation${this.boundaryValidationGuidance(objectExpression, property)}`, memberSpan);
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
      if (property === "size") this.collectionSizes.set(memberSpan.end, "list");
      if (result.kind === "unknown") {
        const guidance = collectionMemberGuidance("List", property);
        const recovered = guidance?.replacement ? this.listMember(object, guidance.replacement) : null;
        const nearest = guidance ? null : uniqueNearestName(property, this.semanticMembersOf(object).keys());
        const message = `${this.collectionMemberError("List", property)}${nearest ? `; did you mean '${nearest}'?` : ""}`;
        if (recovered) {
          this.recoveredTypeError(message, memberSpan, this.collectionMemberFix("List", property, memberSpan));
          result = recovered;
        } else this.typeError(message, memberSpan, this.collectionMemberFix("List", property, memberSpan));
      }
    } else if (object.kind === "set") {
      result = this.setMember(object, property) ?? unknownType;
      if (property === "size") this.collectionSizes.set(memberSpan.end, "set");
      if (result.kind === "unknown") {
        const nearest = collectionMemberGuidance("Set", property) ? null : uniqueNearestName(property, this.semanticMembersOf(object).keys());
        this.typeError(`${this.collectionMemberError("Set", property)}${nearest ? `; did you mean '${nearest}'?` : ""}`, memberSpan, this.collectionMemberFix("Set", property, memberSpan));
      }
    } else if (object.kind === "map") {
      result = this.mapMember(object, property) ?? unknownType;
      if (property === "size") this.collectionSizes.set(memberSpan.end, "map");
      if (result.kind === "unknown") {
        const nearest = collectionMemberGuidance("Map", property) ? null : uniqueNearestName(property, this.semanticMembersOf(object).keys());
        this.typeError(`${this.collectionMemberError("Map", property)}${nearest ? `; did you mean '${nearest}'?` : ""}`, memberSpan, this.collectionMemberFix("Map", property, memberSpan));
      }
    } else if (object.kind === "record") {
      result = this.recordMember(object, property) ?? unknownType;
      if (property === "size") this.collectionSizes.set(memberSpan.end, "record");
      if (result.kind === "unknown") this.typeError(`Record fields are dynamic; use ${describeType(object)}[${JSON.stringify(property)}]`, memberSpan);
    } else if (object.kind === "promise") {
      const awaited = this.expandAliases(object.value);
      const memberAfterAwait = this.semanticMembersOf(awaited).get(property);
      const receiverName = objectExpression.kind === "IdentifierExpression" ? objectExpression.name : null;
      const binding = receiverName ? this.lookup(receiverName) : null;
      const canAwait = this.functionDepth === 0 || this.asynchronousFunctions.at(-1) === true;
      if (memberAfterAwait && receiverName && binding && this.promiseInitializerBindings.has(binding) && canAwait) {
        this.typeError(
          `${describeType(object)} has no member '${property}'; add 'await' at the initializer — 'const ${receiverName} = await ...' — then read '${receiverName}.${property}'`,
          memberSpan,
        );
      } else {
        this.typeError(`${describeType(object)} has no member '${property}'`, memberSpan);
      }
      result = invalidType;
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
        const expectOperand = objectExpression.kind === "CallExpression"
          ? this.testExpectOperands.get(spanIdentity(objectExpression.span))
          : undefined;
        if (property === "toHaveLength" && expectOperand?.kind === "set") {
          this.typeError("Set has no length matcher; write 'expect(set.size).toBe(expected)'", memberSpan);
        } else {
          const nearest = uniqueNearestName(property, object.fields.keys());
          this.typeError(`Object has no field '${property}'${nearest ? `; did you mean '${nearest}'?` : ""}`, memberSpan);
        }
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
      // D50 rule 89: `code` is not stored anywhere. The read recovers the
      // declared class name the lowering wrote into `.name`, so the string and
      // the class identity cannot drift apart, and a host error no Velar class
      // declared answers the contract it does satisfy: "Error".
      // An extern class declares its own JavaScript members, so a 'code' it
      // publishes is that host property and stays an ordinary read.
      const errorCodeRead = property === "code" && !classKey.startsWith("js:") && this.isSubclassOf(classKey, "Error");
      if (readValue && errorCodeRead) this.errorCodeReads.add(spanIdentity(memberSpan));
      if (readValue && field && !classKey.startsWith("js:") && !errorCodeRead
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
      // FLW-S2: '?.' on a getter would compute it a second time, so the
      // receiver decides which of the two fixes is the honest one.
      const getter = this.getterAccessProperty(objectExpression);
      const text = getter ? this.conditionSubjectText(objectExpression) : null;
      this.typeError(getter
        ? `'${getter}' is a getter, so '?.' would compute it a second time`
          + `; bind it once with 'const ${getter} = ${text ?? `...${getter}`}' and read that name instead`
        : `Use optional access '?.' for ${describeType(original)}`, memberSpan);
    }
    if (result.kind === "optional") this.optionalMembers.add(spanIdentity(memberSpan));
    return result;
  }

  /**
   * A record shorthand names a binding. Reserved names have no binding to name,
   * so `{computed}` and `{print}` used to reach past the author entirely and
   * capture the runtime entry point. The shorthand is refused with the explicit
   * spelling, which is the only way to mean either thing on purpose — and it
   * puts the reserved names on the same footing as every softened word, whose
   * shorthand now resolves to an ordinary binding.
   */
  private checkShorthandReservedName(property: Extract<Expression, { kind: "ObjectExpression" }>["properties"][number] & { kind: "ObjectProperty" }): boolean {
    if (!property.shorthand || this.lookup(property.name)) return false;
    const restriction = bindingNameRestriction(property.name, this.extensionReservedBindings);
    if (restriction !== "core" && restriction !== "extension" && restriction !== "javascript") return false;
    const owner = restriction === "core" ? "reserved Core binding" : restriction === "extension" ? "reserved extension binding" : "name JavaScript reserves";
    this.diagnostics.push(diagnostic(
      "VEL3007",
      `Write '${property.name}: value'; '${property.name}' is a ${owner}, so the shorthand has no binding of that name to read`,
      property.span,
    ));
    return true;
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
    const test: ValueType = { kind: "function", parameters: [element, numberType], requiredParameters: 1, result: boolType };
    const transform: ValueType = { kind: "function", parameters: [element, numberType], requiredParameters: 1, result: unknownType };
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
          [{ kind: "function", parameters: [element, numberType], requiredParameters: 1, result: { kind: "list", element: unknownType } }],
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
      case "ceil":
      case "sign":
      case "trunc": return callable([], [], numberType);
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

  /**
   * D38 §48: a retired collection member whose guidance names one successor
   * member is a mechanical rename of the member name itself.
   */
  private collectionMemberFix(kind: CollectionKind, property: string, memberSpan: Span): DiagnosticFix | undefined {
    const guidance = collectionMemberGuidance(kind, property);
    if (!guidance?.replacement || !guidance.title || memberSpan.end - memberSpan.start < property.length) return undefined;
    return mechanicalFix(span(memberSpan.end - property.length, memberSpan.end), guidance.replacement, guidance.title);
  }

  // COL-U3: exactly the predicate `x => x != null` (either operand order).
  // An optional second index parameter does not participate in the proof and
  // therefore preserves the same narrowing contract.
  // The closed shape keeps this a vocabulary rule, not a predicate-type
  // system: any other body — even `x => not (x == null)` — filters without
  // narrowing.
  private isNullExclusionPredicate(argument: Expression | null): boolean {
    if (argument?.kind !== "ArrowFunctionExpression" || argument.asynchronous) return false;
    const parameter = argument.parameters[0];
    const index = argument.parameters[1];
    if (argument.parameters.length < 1 || argument.parameters.length > 2 || !parameter || parameter.rest || parameter.defaultValue) return false;
    if (index?.rest || index?.defaultValue) return false;
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
      case "getOrSet":
        if (map.readonlyView) return null;
        return callable(["key", "fallback"], [map.key, map.value], map.value);
      case "getOrSetWith":
        if (map.readonlyView) return null;
        return callable(["key", "factory"], [map.key, callable([], [], map.value)], map.value);
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
      case "iterator":
        return callable([], [], iteratorOf(key));
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

  /** Lets target analyzers inspect a child type already proven in this pass without analyzing it twice. */
  protected inferredExpressionType(expression: Expression): ValueType {
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
          const type = this.iterationSource(argument.value, this.inferExpression(argument.value));
          if (!rest) this.typeError("Call spread requires a callable with a rest parameter", argument.span);
          else if (fixedIndex < parameters.length) {
            this.typeError(`Provide all ${parameters.length} fixed argument${parameters.length === 1 ? "" : "s"} before a call spread`, argument.span);
          } else if (type.kind === "list") this.requireAssignable(type.element, rest, argument.span);
          if (type.kind !== "list" && type.kind !== "any") {
            this.typeError(`Call spread requires a List, received ${describeType(type)}${this.iterationGuidance(type)}`, argument.span);
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
      this.recordFlowFactOrigin(binding);
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
      || this.genericTypes.has(name)
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
    if (statement.resource === "json") return unknownType;
    if (!statement.javascript) {
      const type = this.importBindings.get(local) ?? unknownType;
      if (type.kind === "classConstructor" && type.identity) this.classDisplayNames.set(type.identity, local);
      return type;
    }
    // D90 R17: an undeclared foreign value arrives as unknown — R12 refused
    // `any` at export positions, and this closes the entry. The value must be
    // validated into a concrete type (`Type.parse`) before members, calls, or
    // operators touch it; `unsafe` names the missing declaration, not a
    // license to chain through the boundary. A host-injected binding is a
    // declaration — the host answered for the name — so it still wins. The
    // boundary marker matters: a bare `unknown` is the inference seed a merge
    // absorbs, while this value is *known to be unchecked*, so `[mystery, 5]`
    // must stay `List<unknown | number>` instead of laundering into
    // `List<number>`.
    if (statement.unsafe) return this.importBindings.get(local) ?? boundaryUnknownType;
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
    // FLW-N4: a membership test asks the `==` question one element at a time
    // (section 4), so a true answer means one element matched — and every
    // element is of the container's element or key type. The false answer
    // proves nothing: any element could be the one that failed to match.
    if (expression.kind === "BinaryExpression"
      && (expression.operator === "in" || expression.operator === "not in")
      && (expression.operator === "in") === truthy) {
      const container = this.inferredExpressionTypes.get(spanIdentity(expression.right.span));
      const contained = container ? this.membershipElementType(this.expandAliases(container)) : null;
      const current = this.inferredExpressionTypes.get(spanIdentity(expression.left.span));
      if (contained && current && this.narrowableLocation(expression.left)) {
        const narrowedType = this.runtimeCheckedType(current, contained);
        if (!sameType(narrowedType, this.expandAliases(current))) {
          this.addLocationNarrowing(narrowed, expression.left, narrowedType);
        }
      }
      return narrowed;
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
          // FLW-N2: an optional chain that produced a non-null value proves
          // every link along it was present — an absent link is exactly what
          // the chain short-circuits on. The `== null` arm proves nothing,
          // because any one absent link produces the same null.
          if (!equalToNone) {
            for (const [path, type] of this.optionalExecutionNarrowings(candidate)) {
              if (!narrowed.has(path)) narrowed.set(path, type);
            }
          }
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
      // FLW-N7: `true` and `false` are the two members of bool, so equality
      // with either literal carries the singleton fact back to its owner
      // exactly as an enum member does. Only the branch that proves equality
      // learns anything: `flag != true` still admits both `false` and an
      // absent value, which is the same reason `if flag:` teaches its else
      // arm nothing.
      const leftIsBoolean = expression.left.kind === "LiteralExpression" && typeof expression.left.value === "boolean";
      const rightIsBoolean = expression.right.kind === "LiteralExpression" && typeof expression.right.value === "boolean";
      if (leftIsBoolean !== rightIsBoolean && (expression.operator === "==") === truthy) {
        const candidate = leftIsBoolean ? expression.right : expression.left;
        const candidateType = leftIsBoolean ? rightType : leftType;
        const narrowedType = candidateType ? this.narrowToBoolean(candidateType) : null;
        if (narrowedType) this.addLocationNarrowing(narrowed, candidate, narrowedType);
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

  /** What one element of a membership probe's container is, matching the `in` operand rules. */
  private membershipElementType(container: ValueType): ValueType | null {
    // D68 rule 177: the narrowing a membership test proves must read the same
    // container the test itself read, so it walks `@iterate:` too.
    const source = this.iterationContract(container) ?? container;
    if (source.kind === "list" || source.kind === "set") return source.element;
    if (source.kind === "map") return source.key;
    if (source.kind === "record" || source.kind === "string") return stringType;
    return null;
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

  /**
   * FLW-N7: the fact a boolean-literal comparison proves about its owner.
   * A location already typed `bool` learns nothing, so no fact is recorded
   * for it — a needless fact would only buy a runtime recheck on every later
   * read.
   */
  private narrowToBoolean(current: ValueType): ValueType | null {
    const source = this.expandAliases(current);
    if (source.kind === "optional") return this.expandAliases(source.inner).kind === "bool" ? boolType : null;
    if (source.kind !== "union") return null;
    const matching = source.members.filter((member) => this.expandAliases(member).kind === "bool");
    return matching.length > 0 && matching.length < source.members.length ? boolType : null;
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
  // different tests. BRG-N4 + D90 R17: an unchecked boundary value — `any` or
  // `unknown` — is rejected with one message: raw JavaScript truthiness would
  // judge 0 and "" false, which breaks the owner's ruling that a condition
  // judges only bool, so the boundary value is validated first.
  protected requireCondition(type: ValueType, condition: Expression): void {
    this.checkGetterNarrowingTest(condition);
    if (isInvalidType(type)) return;
    const expanded = this.expandAliases(type);
    if (expanded.kind === "bool") return;
    if (expanded.kind === "any" || expanded.kind === "unknown") {
      this.typeError(
        `A condition judges only bool, and an unchecked ${describeType(type)} would ride JavaScript truthiness (0 and "" become false); validate the value at the edge — 'Type.parse' — and judge the checked result, or compare it explicitly`,
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

  /**
   * FLW-S2: a getter is a computed value, not a stable location, so a check on
   * one establishes no fact — the guard reads exactly like every other
   * narrowing check and silently does nothing. Say so where it is written,
   * and name the one spelling that works: bind the getter to a `const` and
   * check that. Following `?.` instead would compute the getter twice.
   */
  private checkGetterNarrowingTest(condition: Expression): void {
    const subject = this.narrowingSubjectExpression(condition);
    if (!subject) return;
    const property = this.getterAccessProperty(subject);
    if (!property) return;
    const subjectType = this.inferredExpressionTypes.get(spanIdentity(subject.span));
    if (!subjectType) return;
    // Only a shape a check could have narrowed is worth naming. A getter
    // returning one concrete type is tested, not narrowed, and stays silent.
    const shape = this.expandAliases(subjectType).kind;
    if (shape !== "optional" && !(shape === "union" && subject !== condition)) return;
    const text = this.conditionSubjectText(subject);
    this.typeError(
      `'${property}' is a getter, so it is computed again on every read and this check narrows nothing`
      + `; bind it once with 'const ${property} = ${text ?? `...${property}`}' and check that name instead`,
      condition.span,
    );
  }

  /** The location a condition would narrow, for the forms that narrow one. */
  private narrowingSubjectExpression(condition: Expression): Expression | null {
    if (condition.kind === "UnaryExpression" && condition.operator === "not") {
      return this.narrowingSubjectExpression(condition.operand);
    }
    if (condition.kind === "IsExpression") return condition.value;
    if (condition.kind === "MemberExpression") return condition;
    if (condition.kind !== "BinaryExpression") return null;
    if (condition.operator === "in" || condition.operator === "not in") return condition.left;
    if (condition.operator !== "==" && condition.operator !== "!=") return null;
    // The literal forms that carry a fact back: a null test and, since `true`
    // and `false` are the two members of bool, a boolean-literal comparison.
    const narrowingLiteral = (side: Expression): boolean => side.kind === "LiteralExpression"
      && (side.value === null || typeof side.value === "boolean");
    const leftIsLiteral = narrowingLiteral(condition.left);
    const rightIsLiteral = narrowingLiteral(condition.right);
    return leftIsLiteral === rightIsLiteral ? null : leftIsLiteral ? condition.right : condition.left;
  }

  /** The property name when an expression reads a getter rather than a stored field. */
  private getterAccessProperty(expression: Expression): string | null {
    if (expression.kind !== "MemberExpression" || expression.optional) return null;
    const inferred = this.inferredExpressionTypes.get(spanIdentity(expression.object.span))
      ?? (expression.object.kind === "IdentifierExpression" ? this.lookup(expression.object.name)?.type : null);
    if (!inferred) return null;
    const owner = nonOptional(this.expandAliases(inferred));
    if (owner.kind === "class") {
      const key = owner.identity ?? owner.name;
      const found = this.findGetter(key, expression.property) !== null
        || (this.privateGetters.get(this.currentClass ?? "")?.has(expression.property) ?? false);
      return found ? expression.property : null;
    }
    if (owner.kind === "classConstructor") {
      const key = owner.identity ?? owner.name;
      const found = this.findStaticGetter(key, expression.property) !== null
        || (this.privateStaticGetters.get(this.currentClass ?? "")?.has(expression.property) ?? false);
      return found ? expression.property : null;
    }
    return null;
  }

  /**
   * D90 R17: the author's own spelling of a boundary value, for the
   * diagnostics that teach `Type.parse`. Identifier and member paths render
   * exactly, a simple call renders as `name(...)`, and anything else answers
   * null so the caller falls back to the word `value`.
   */
  private boundaryReceiverText(expression: Expression): string | null {
    if (expression.kind === "IdentifierExpression") return expression.name;
    if (expression.kind === "MemberExpression" && !expression.optional) {
      const owner = this.boundaryReceiverText(expression.object);
      return owner === null ? null : `${owner}.${expression.property}`;
    }
    if (expression.kind === "CallExpression") {
      const callee = this.boundaryReceiverText(expression.callee);
      return callee === null ? null : `${callee}(...)`;
    }
    return null;
  }

  /** A type name suggested from the receiver's last name segment, or 'X' when none reads naturally. */
  private boundaryTypeNameSuggestion(receiver: string | null): string {
    const segment = receiver?.replace(/\(\.\.\.\)$/u, "").split(".").at(-1) ?? "";
    return /^[a-zA-Z]/u.test(segment) ? segment[0]!.toUpperCase() + segment.slice(1) : "X";
  }

  /**
   * D90 R17: an undeclared foreign value arrives as unknown, and the way into
   * the typed world is `Type.parse` at the edge. Every refusal on an unknown
   * teaches that ritual with the author's own expression spelled into it.
   */
  private boundaryValidationGuidance(expression: Expression | null, property: string | null): string {
    const receiver = expression ? this.boundaryReceiverText(expression) : null;
    const name = this.boundaryTypeNameSuggestion(receiver);
    const spelled = receiver ?? "value";
    const declared = property === null
      ? `declare a type naming the shape you rely on — 'type ${name}:'`
      : `declare a type naming the fields you rely on — 'type ${name}:' with the '${property}' field`;
    const read = property === null ? "use 'checked' from there" : `read 'checked.${property}'`;
    return `; ${declared} — then validate first: 'const checked = ${name}.parse(${spelled})' and ${read}`;
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

  /**
   * A mutable cell declared without an annotation takes the exact member its
   * initializer named, so the second member ever stored into it is refused
   * against the first — `Cannot assign Locale to Locale.zhCN`, reported at the
   * assignment while the line that has to change is the declaration. The
   * refusal is right; naming the annotation is what turns it into one edit.
   */
  private enumSingletonCellGuidance(
    actual: ValueType,
    expected: ValueType,
    target: MutableCellTarget | null,
  ): string | null {
    if (target === null || expected.kind !== "enumMember") return null;
    if (actual.kind !== "enum" && actual.kind !== "enumMember") return null;
    if ((actual.identity ?? actual.name) !== (expected.identity ?? expected.name)) return null;
    if (actual.kind === "enumMember" && actual.member === expected.member) return null;
    return `'${target.name}' has no annotation, so it took the one member its initializer named; declare the enum to hold any of them — '${target.keyword} ${target.name}: ${expected.name} = ...'`;
  }

  protected requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell: MutableCellTarget | null = null): void {
    if (this.contextuallyAssignable(actual, expected, valueSpan)) return;
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
      // The mutable cell that inferred a member singleton: the fix is on a
      // different line from the report, so the report carries it.
      const singletonCell = this.enumSingletonCellGuidance(
        expandedActual.kind === "optional" ? this.expandAliases(expandedActual.inner) : expandedActual,
        expectedCore,
        mutableCell,
      );
      if (singletonCell !== null) {
        this.typeError(`Cannot assign ${actualDescription} to ${expectedDescription}; ${singletonCell}`, valueSpan);
        return;
      }
      // A readonly projection is refused for one reason and has one fix, and
      // the fix is a signature the author has to write somewhere else. Naming
      // the mismatch without naming that signature is what made component
      // props cost two rounds of rework in a blind test.
      const projection = this.readonlyProjectionGuidance(expandedActual, expected, expandedExpected, expectedCore);
      if (projection !== null) {
        this.typeError(`Cannot assign ${actualDescription} to ${expectedDescription}; ${projection}`, valueSpan);
        return;
      }
      // D64 rule 163: the one mismatch an author reaches by obeying VEL4018.
      const asyncResult = this.asyncResultSpellingGuidance(expandedActual, expectedCore);
      if (asyncResult !== null) {
        this.typeError(`Cannot assign ${actualDescription} to ${expectedDescription}; ${asyncResult}`, valueSpan);
        return;
      }
      // D90 R17: an undeclared foreign value is unknown until validated, so
      // the mismatch teaches the entry ritual instead of restating the kinds.
      if (expandedActual.kind === "unknown" && !isInvalidType(expandedActual)) {
        const named = expectedCore.kind === "named" || expectedCore.kind === "enum"
          ? `'const checked = ${describeType(expectedCore)}.parse(value)'`
          : expectedCore.kind === "string" || expectedCore.kind === "number" || expectedCore.kind === "bool"
            ? `narrow it with 'value is ${describeType(expectedCore)}', or parse a declared shape`
            : "declare a type naming the shape you rely on and call 'Type.parse' on the value";
        this.typeError(`Cannot assign ${actualDescription} to ${expectedDescription}; a boundary value stays unknown until validated at the edge — ${named}`, valueSpan);
        return;
      }
      // D114 S7: section 12 rules that a class instance never satisfies a
      // record contract, and section 10 rules that behavior passes as function
      // values. The idiom the two imply — a record of bound methods — was
      // written nowhere, so the refusal an author actually meets is where it
      // is taught.
      const boundMethods = this.boundMethodRecordGuidance(expandedActual, expectedCore, valueSpan);
      if (boundMethods !== null) {
        this.typeError(`Cannot assign ${actualDescription} to ${expectedDescription}; ${boundMethods}`, valueSpan);
        return;
      }
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

  /**
   * D114 S7: the one idiom that carries a class's behavior into a structural
   * contract. A record type whose fields are function types is what a caller
   * states when it wants behavior rather than a nominal type; a class instance
   * does not satisfy it (section 12), and a class name is not a value
   * (section 10). What passes is a record of *bound methods* —
   * `{close: terminal.close}` — where each method value binds its receiver
   * once at the reference site (section 18).
   *
   * The guidance is built from the names actually in front of the compiler:
   * the target's own function-typed fields that the class answers with a
   * method or a getter, in the target's declaration order, at most three
   * before the ellipsis. Nothing here changes assignability; the refusal is
   * the same refusal, and the message is the whole change.
   */
  private boundMethodRecordGuidance(actual: ValueType, expected: ValueType, valueSpan: Span): string | null {
    // An extern class is registered under its bridged identity rather than its
    // written name, and it reaches the idiom the same way a VelarScript class
    // does: reading its method as a value binds the receiver (section 18).
    let className: string | null = null;
    if (actual.kind === "class") {
      const identity = actual.identity ?? actual.name;
      className = this.classes.has(identity) ? identity : this.classes.has(actual.name) ? actual.name : null;
    } else if (actual.kind === "named" && this.classes.has(actual.name)) {
      className = actual.name;
    }
    if (className === null) return null;

    const fields = expected.kind === "object" ? expected.fields
      : expected.kind === "named" ? this.fieldsOf(expected.identity ?? expected.name)
        : null;
    if (!fields || fields.size === 0) return null;

    const matched: string[] = [];
    for (const [name, type] of fields) {
      if (this.expandAliases(type).kind !== "function") continue;
      if (this.findMethod(className, name) || this.findGetter(className, name)) matched.push(name);
    }
    if (matched.length === 0) return null;

    const receiver = this.simpleBindingSpelling(valueSpan) ?? "value";
    const shown = matched.slice(0, 3);
    const ellipsis = shown.length < fields.size ? ", …" : "";
    const spelling = `{${shown.map((name) => `${name}: ${receiver}.${name}`).join(", ")}${ellipsis}}`;
    return `a class instance never satisfies a record contract; pass its behavior as bound methods — '${spelling}' — each of which binds its receiver once where it is read`;
  }

  /** The written value when it is one ordinary binding name, for a message that reads it back. */
  private simpleBindingSpelling(valueSpan: Span): string | null {
    const written = this.sourceText.slice(valueSpan.start, valueSpan.end);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(written)) return null;
    return this.lookup(written) ? written : null;
  }

  /**
   * D44 rule 72's readonly view refuses exactly one shape of assignment: the
   * value is the target type with readonly added. Component props arrive that
   * way — the body of `component List(items: List<Item>)` sees a readonly
   * projection — so the helper that would accept the value has a signature the
   * author never wrote, and the diagnostic is the only place to hand it over.
   * The return shape matters as much as the parameter: a List built from a
   * readonly List carries readonly elements.
   */
  private readonlyProjectionGuidance(
    actual: ValueType,
    expected: ValueType,
    expandedExpected: ValueType,
    expectedCore: ValueType,
  ): string | null {
    if (describeType(this.readonlyDataViewOf(expandedExpected)) !== describeType(actual)) return null;
    const parameter = describeType(this.readonlyDataViewOf(expected));
    const family = expectedCore.kind === "list" ? "List" : expectedCore.kind === "set" ? "Set" : null;
    let built = "";
    if (family !== null && (expectedCore.kind === "list" || expectedCore.kind === "set")) {
      const element = describeType(expectedCore.element);
      const projected = describeType(this.readonlyDataViewOf(expectedCore.element));
      if (projected !== element) built = `, and a ${family} built from it is '${family}<${projected}>'`;
    }
    return `a readonly projection stays readonly through every hop, so the value never widens — declare the receiving parameter as '${parameter}'${built}`;
  }

  /**
   * D64 rule 163: the async result annotation is spelled two ways in two
   * positions, and both are right. A *declaration* annotates the resolved
   * value — `async def load(id: string) -> string` — because the `async` is
   * standing right there; VEL4018 refuses `-> Promise<T>` for that reason. A
   * function *type* has no `async` on it and describes the value the call
   * hands back, which is a Promise, so `-> Promise<T>` is the spelling there.
   *
   * An author who has just been taught VEL4018 therefore writes `-> string` in
   * the type position and is refused for obeying it. Naming only the mismatch
   * leaves that author with two diagnostics that contradict each other, so the
   * refusal names the spelling the type position wants. The check is exact:
   * the mismatch has to disappear when the result is wrapped, which is what
   * makes the named spelling a fact rather than a guess.
   */
  private asyncResultSpellingGuidance(actual: ValueType, expectedCore: ValueType): string | null {
    if (actual.kind !== "function" && actual.kind !== "action" && actual.kind !== "intrinsic") return null;
    if (expectedCore.kind !== "function" && expectedCore.kind !== "action" && expectedCore.kind !== "intrinsic") return null;
    if (this.expandAliases(actual.result).kind !== "promise") return null;
    const expectedResult = this.expandAliases(expectedCore.result);
    if (expectedResult.kind === "promise" || expectedResult.kind === "unknown" || expectedResult.kind === "any") return null;
    const wrapped: ValueType = { ...expectedCore, result: { kind: "promise", value: expectedCore.result } };
    // The guidance is only true when the result spelling is the whole quarrel,
    // so the wrapped target has to accept the value outright.
    if (!isAssignable(actual, wrapped, this)) return null;
    return `an async function's type describes the value the call produces, so its result is a Promise — write '-> ${describeType(wrapped.result)}' here, and '-> ${describeType(expectedCore.result)}' on the 'async def' declaration itself`;
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
      // D51 rule 109: the same closed vocabulary, at the other place a name is
      // introduced. `def f<Data, T: Data>` would otherwise read one word two
      // ways in one signature.
      if (isTypeParameterBound(declaration.name)) {
        this.diagnostics.push(diagnostic(
          "VEL4021",
          `'${declaration.name}' is a reserved type-parameter bound — the bounds are ${typeParameterBoundNames.join(", ")} — so it cannot also name a type parameter; rename it`,
          declaration.span,
        ));
      } else if (this.isDeclaredTypeName(declaration.name)) {
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
      || this.genericTypes.has(name)
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
    // D55 rule 121: an application written in this module arrives carrying the
    // source name and unresolved arguments. Canonicalizing it here — the one
    // step that already turns names into identities — is what makes `Box<Id>`
    // and `Box<string>` one identity when `Id` is an alias, and what notes the
    // instantiation so its field table can be built when asked for.
    if (type.kind === "named" && type.application) {
      const resolved = this.resolveGenericApplication(type, (argument) => this.resolveNamedClasses(argument));
      if (resolved) return resolved;
    }
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
      // CLS-I4, found while checking that the composition the diagnostic
      // recommends actually works: the extern type import records the class
      // type itself, not its constructor, so this branch used to fall through
      // and a class field or record field annotated with an extern class froze
      // into a structural named type. The declaration looked fine and the
      // member read failed with "has no field", which is the same silent
      // degradation the bridge is not allowed to have. Only the extern table
      // may answer with a `class` type — a local binding that merely holds an
      // instance must never become a type name.
      if (imported && imported === this.externTypeImports.get(type.name) && imported.kind === "class") return imported;
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
          // D90 R17 removed the boundary that used to produce `any`, so the
          // old reason clause ("reserved for explicit unsafe JavaScript
          // boundaries") named a producer that no longer exists. The refusal
          // now teaches the same entrance every other unknown refusal teaches.
          if (syntax.name === "any") {
            this.typeError(
              `'any' is not a VelarScript type; a foreign value arrives as 'unknown', which is what you annotate${this.boundaryValidationGuidance(null, null)}`,
              syntax.span,
            );
            return false;
          }
          if (this.invalidDeclaredTypes.has(syntax.name)) return false;
          if (syntax.name === "Promise") return true;
          if (this.typeParameterFrames.at(-1)?.has(syntax.name)) return true;
          // D55 rule 126: a bare generic record has no identity, no field
          // table, and no validator — it is a type constructor. The refusal
          // teaches the arity rather than quietly reading it as
          // `Box<unknown>`, which would hand back a validator that accepts
          // everything the author forgot to describe.
          if (this.genericTypes.has(syntax.name)) {
            const info = this.genericTypes.get(syntax.name)!;
            this.typeError(
              `Generic type '${syntax.name}' needs ${info.parameterNames.length === 1 ? "a type argument" : `${info.parameterNames.length} type arguments`}; write '${syntax.name}<${info.parameterNames.join(", ")}>' with concrete types`,
              syntax.span,
            );
            return false;
          }
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
          const generic = this.genericTypes.get(syntax.name);
          if (generic) {
            const argumentsValid = syntax.arguments.map(validate).every(Boolean);
            return argumentsValid && this.validateGenericApplication(generic, syntax);
          }
          if (syntax.name !== "List" && syntax.name !== "Set" && syntax.name !== "Map" && syntax.name !== "Record" && syntax.name !== "Promise" && syntax.name !== "Type") {
            const resolved = resolver({ syntax, span: syntax.span });
            if (resolved.kind === "named") {
              this.typeError(`Unknown type '${syntax.name}'`, syntax.nameSpan);
              valid = false;
            }
          }
          const argumentsValid = syntax.arguments.map(validate).every(Boolean);
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

  /**
   * The retired namespace whose module exports this bare name, when exactly one
   * does and no permanent namespace claims the same spelling. `min`, `max`, and
   * `clamp` are claimed by `Math.` as well, so those keep the guidance and lose
   * only the automatic rewrite — a fix has to be provably the author's meaning,
   * and there the meaning is genuinely ambiguous.
   */
  private retiredNamespaceOwning(name: string): string | null {
    let owner: string | null = null;
    for (const [namespace, retired] of this.retiredNamespaces) {
      if (!retired.members.has(name)) continue;
      if (owner) return null;
      owner = namespace;
    }
    if (!owner) return null;
    for (const roster of permanentNamespaceImportRosters.values()) if (roster.members.has(name)) return null;
    return owner;
  }

  private recordMemberAccessProperty(expression: Extract<Expression, { kind: "MemberExpression" }>): void {
    this.memberAccessProperties.set(spanIdentity(expression.object.span), { property: expression.property, end: expression.span.end });
  }

  /** The import line a migration writes, in the sorted shape every module here already uses. */
  private renderNamedImport(source: string, specifiers: readonly { readonly imported: string; readonly local: string }[]): string {
    const rendered = [...specifiers]
      .sort((left, right) => (left.imported < right.imported ? -1 : left.imported > right.imported ? 1 : 0))
      .map((specifier) => (specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`));
    return `import {${rendered.join(", ")}} from ${JSON.stringify(source)}`;
  }

  /** Where a module that has no import of `source` yet should grow one. */
  private importInsertion(program: Program, line: string): DiagnosticEdit {
    let lastImport: Span | null = null;
    for (const statement of program.body) if (statement.kind === "ImportDeclaration") lastImport = statement.span;
    if (lastImport) return { span: { start: lastImport.end, end: lastImport.end }, text: `\n${line}` };
    const offset = program.body[0]?.span.start ?? 0;
    return { span: { start: offset, end: offset }, text: `${line}\n\n` };
  }

  private registerPermanentNamespaceImports(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration" || statement.javascript) continue;
      const roster = permanentNamespaceImportRoster(statement.source);
      if (!roster) continue;
      for (const specifier of statement.specifiers) {
        if (specifier.namespace || !roster.members.has(specifier.imported)) continue;
        this.permanentNamespaceImportOrigins.set(specifier.local, {
          source: statement.source,
          imported: specifier.imported,
          specifier: specifier.span,
        });
      }
    }
  }

  /**
   * D52 rule 114: the migration off a namespace prefix the language withdrew.
   * It is the mirror of the one below — that one takes an import away and puts
   * a prefix on, this one takes the prefix off and puts an import back — and
   * both answer in one step, because a migration that needs a second compile to
   * find the working spelling has taught a loop rather than a spelling.
   */
  private reportRetiredNamespaceUses(program: Program): void {
    if (this.retiredNamespaceUses.length === 0) return;
    const grouped = new Map<string, typeof this.retiredNamespaceUses>();
    for (const use of this.retiredNamespaceUses) {
      const collected = grouped.get(use.namespace) ?? [];
      collected.push(use);
      grouped.set(use.namespace, collected);
    }
    for (const [namespace, uses] of grouped) {
      const retired = this.retiredNamespaces.get(namespace);
      if (!retired) continue;
      const quoted = JSON.stringify(retired.module);
      const example = [...retired.members][0] ?? "member";
      const existing = program.body.find((statement) =>
        statement.kind === "ImportDeclaration" && statement.source === retired.module
        && !statement.javascript && statement.specifiers.every((specifier) => !specifier.namespace)) as
        Extract<Statement, { kind: "ImportDeclaration" }> | undefined;
      const bound = new Map<string, string>();
      const taken = new Set<string>();
      for (const specifier of existing?.specifiers ?? []) {
        bound.set(specifier.imported, specifier.local);
        taken.add(specifier.local);
      }
      const seen = new Set<string>();
      const ordered = [...uses]
        .sort((left, right) => left.span.start - right.span.start)
        .filter((use) => {
          const key = spanIdentity(use.span);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      const added: string[] = [];
      const entries: { readonly span: Span; readonly message: string; readonly edit: DiagnosticEdit | null; readonly contributes: boolean }[] = [];
      for (const use of ordered) {
        const member = use.member;
        if (member === null) {
          entries.push({
            span: use.span,
            message: this.guidanceForGlobal(namespace)
              ?? `'${namespace}' is not a value; import the names you need from ${quoted} and call them without a prefix`,
            edit: null,
            contributes: false,
          });
          continue;
        }
        if (!retired.members.has(member)) {
          entries.push({
            span: use.span,
            message: `'${namespace}' is not a namespace; ${quoted} exports its names directly — import {${example}} from ${quoted}`,
            edit: null,
            contributes: false,
          });
          continue;
        }
        if (use.bare) {
          // The prefix is already gone here; only the import is missing.
          const free = !this.declaredNames.has(member) && !taken.has(member);
          if (free && !added.includes(member)) added.push(member);
          entries.push({
            span: use.span,
            message: this.guidanceForGlobal(member)
              ?? `Import the builder — import {${member}} from ${quoted} — then call ${member}(...)`,
            edit: null,
            contributes: free,
          });
          continue;
        }
        const local = bound.get(member);
        if (local !== undefined) {
          entries.push({
            span: use.span,
            message: `Use ${local}(...); the '${namespace}.' prefix is retired, and this module already imports ${member} from ${quoted}`,
            edit: { span: { start: use.span.start, end: use.memberEnd }, text: local },
            contributes: false,
          });
          continue;
        }
        if (this.declaredNames.has(member) || taken.has(member)) {
          entries.push({
            span: use.span,
            message: `The '${namespace}.' prefix is retired, and this module already binds '${member}' — import the builder under another name, 'import {${member} as other} from ${quoted}', and call other(...)`,
            edit: null,
            contributes: false,
          });
          continue;
        }
        if (!added.includes(member)) added.push(member);
        entries.push({
          span: use.span,
          message: `Use ${member}(...); the '${namespace}.' prefix is retired — import {${member}} from ${quoted}`,
          edit: { span: { start: use.span.start, end: use.memberEnd }, text: member },
          contributes: true,
        });
      }
      let importEdit: DiagnosticEdit | null = null;
      if (added.length > 0) {
        const specifiers = [
          ...(existing?.specifiers ?? []).map((specifier) => ({ imported: specifier.imported, local: specifier.local })),
          ...added.map((member) => ({ imported: member, local: member })),
        ];
        const line = this.renderNamedImport(retired.module, specifiers);
        importEdit = existing ? { span: existing.span, text: line } : this.importInsertion(program, line);
      }
      let importAttached = importEdit === null;
      for (const entry of entries) {
        if (!importAttached && entry.contributes) {
          importAttached = true;
          this.diagnostics.push(diagnostic("VEL3008", entry.message, entry.span, mechanicalEdits(
            entry.edit ? [importEdit!, entry.edit] : [importEdit!],
            `Import ${added.join(", ")} from ${retired.module}`,
          )));
          continue;
        }
        if (!entry.edit) {
          this.diagnostics.push(diagnostic("VEL3008", entry.message, entry.span));
          continue;
        }
        this.diagnostics.push(diagnostic("VEL3008", entry.message, entry.span, mechanicalFix(
          entry.edit.span,
          entry.edit.text,
          `Drop the retired '${namespace}.' prefix`,
        )));
      }
    }
  }

  /**
   * D52 rule 116 / D50 rule 90: a permanent namespace needs no import, so the
   * import spelling retires. The rewrite is the import's own inverse — take the
   * specifier out, put the prefix on every read it left behind — and it is
   * carried whole so the author never sees a half-migrated module.
   */
  private reportPermanentNamespaceImports(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration" || statement.javascript) continue;
      const roster = permanentNamespaceImportRoster(statement.source);
      if (!roster) continue;
      const retired = statement.specifiers.filter((specifier) => specifier.namespace
        ? roster.namespace !== null
        : roster.members.has(specifier.imported));
      if (retired.length === 0) continue;
      const survivors = statement.specifiers.filter((specifier) => !retired.includes(specifier));
      const edits: DiagnosticEdit[] = [];
      let rewritable = true;
      for (const specifier of retired) {
        if (specifier.namespace) {
          // D50 rule 97.3: the namespace form reaches every retired member at
          // once, so it retires with them. Which member each `local.member`
          // read wanted is a rewrite this migration does not claim to know.
          rewritable = false;
          continue;
        }
        const replacement = roster.namespace === null ? specifier.imported : `${roster.namespace}.${specifier.imported}`;
        for (const read of this.permanentNamespaceImportReads) {
          if (read.span.start === statement.span.start) continue;
          if (read.local !== specifier.local || read.source !== statement.source || read.imported !== specifier.imported) continue;
          if (replacement === specifier.local) continue;
          edits.push({ span: read.span, text: replacement });
        }
      }
      if (rewritable) {
        edits.push(survivors.length === 0
          ? { span: { start: statement.span.start, end: statement.span.end + 1 }, text: "" }
          : {
            span: statement.span,
            text: this.renderNamedImport(statement.source, survivors.map((specifier) => ({ imported: specifier.imported, local: specifier.local }))),
          });
      }
      let fixAttached = !rewritable;
      for (const specifier of retired) {
        const message = specifier.namespace
          ? `Use ${roster.namespace} directly; VelarScript's pure namespaces need no import`
          : roster.namespace === null
            ? `Use ${specifier.imported}(...) directly; the Core prelude needs no import`
            : `Use ${roster.namespace}.${specifier.imported} directly; VelarScript's pure namespaces need no import`;
        if (fixAttached) {
          this.diagnostics.push(diagnostic("VEL3008", message, specifier.span));
          continue;
        }
        fixAttached = true;
        this.diagnostics.push(diagnostic("VEL3008", message, specifier.span, mechanicalEdits(
          edits,
          roster.namespace === null
            ? "Drop the import; the Core prelude needs none"
            : `Drop the import and read through ${roster.namespace}`,
        )));
      }
    }
  }

  /**
   * D50 rule 97.3: a retirement that leaves one surviving spelling did not
   * happen. `export {stringify} from "velar/json"` is an import spelling with
   * an export in front of it — the barrel republishes the retired bare name
   * and every downstream `import {stringify} from "./barrel.vel"` is clean
   * forever after. No mechanical fix: which reads in which other modules
   * wanted the name is not a rewrite this module can make.
   */
  private reportPermanentNamespaceReExports(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind !== "ReExportDeclaration") continue;
      const roster = permanentNamespaceImportRoster(statement.source);
      if (!roster) continue;
      for (const specifier of statement.specifiers) {
        if (!roster.members.has(specifier.imported)) continue;
        this.diagnostics.push(diagnostic(
          "VEL3008",
          roster.namespace === null
            ? `Use ${specifier.imported}(...) directly; a re-export cannot restore a retired import spelling, and the Core prelude needs none`
            : `Use ${roster.namespace}.${specifier.imported} directly; a re-export cannot restore a retired import spelling`,
          specifier.span,
        ));
      }
    }
  }

  /** A member name to show in the rule 106 guidance, so the fix is concrete. */
  private firstNamespaceMember(namespace: PermanentNamespaceName): string {
    const binding = this.builtin(namespace);
    const type = binding ? this.expandAliases(binding.type) : null;
    if (type?.kind === "object") {
      for (const name of type.fields.keys()) return name;
    }
    return "member";
  }

  protected typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void {
    this.diagnostics.push(diagnostic("VEL4001", message, errorSpan, fix));
  }

  protected recoveredTypeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void {
    this.diagnostics.push(recoveredDiagnostic("VEL4001", message, errorSpan, fix));
  }

  /**
   * D89: raises a roster advisory. It cannot reach `this.diagnostics`, so it
   * cannot fail a build and cannot shift the diagnostic cursors this analyzer
   * reads as array lengths.
   *
   * One report per code and span. `reanalyzeLoopBackEdge` runs a loop body a
   * second time whenever the back edge invalidates a fact, and its diagnostic
   * answer is `deduplicateDiagnostics`, which only ever touches
   * `this.diagnostics`. Deduplicating where the advisory is raised covers that
   * pass and every other re-analysis without a second pair of cursors, which
   * is the whole reason the two channels are separate arrays.
   */
  protected advise(code: string, message: string, adviceSpan: Span, fix?: DiagnosticFix): void {
    const identity = `${code}\u0000${adviceSpan.start}\u0000${adviceSpan.end}`;
    if (this.advisedIdentities.has(identity)) return;
    this.advisedIdentities.add(identity);
    this.advisories.push(advisory(code, message, adviceSpan, fix));
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
    const type = this.extensionGlobals.get(name) ?? coreVocabularyType(name)
      ?? (name === "Error" || name === "ValidationError" || name === "AssertionError"
        || name === "NarrowingError" || name === "IndexError"
        || (VELAR_HOST_ERROR_NAMES as readonly string[]).includes(name)
        ? { kind: "classConstructor", name } satisfies ValueType
        : null)
      // D90 R17: `Map`/`Set` as bare values are collection constructors the
      // call path special-cases; the bare binding itself carries no members,
      // so it is unknown, never a silent `any`.
      ?? (name === "Map" || name === "Set" ? unknownType : null);
    return type ? {
      mutable: false,
      type,
      declaredType: type,
      storageType: type,
      span: { start: 0, end: 0 },
      narrowingFrame: null,
    } : null;
  }

  /**
   * D85 rule 207: an empty collection's element type must be settled where the
   * collection is written — by an annotation, a contextual type, or the
   * constructor's own arguments. Nothing infers it from a later mutation, so a
   * binding left with no source is reported at the construction rather than
   * kept as `unknown` for a following line to fill in.
   *
   * The value written at this position is not always the construction itself.
   * A ternary arm, a list element or its spread, a record-literal field, a
   * `??` fallback, a receiver and an argument all become part of the value the
   * name holds, so each is its own settling position and each reports at its
   * own `[]`. What stops the walk is the value, not the syntax: it descends
   * only while `carriesUnsettledCollection` still sees the hole in the type
   * arriving here, so `print(Set().size)` and `const n = Set().size` stay
   * legal per rule 208 — neither of those names holds a collection — while a
   * spread whose `unknown` the merge absorbs (`["x", ...[]]`) leaves nothing
   * to report. A sibling settles nothing for its neighbour: `[["a"], []]`
   * merges through `unionOf`, so the union still carries the hole and the
   * empty `[]` reports on its own.
   *
   * Returns whether it reported, so the caller can hand the name `invalidType`
   * instead of the hole. Rule 209 requires one mistake to be reported once,
   * and `List<unknown>` reaching a later line is what produces the second,
   * contradicting report the ruling exists to delete.
   */
  protected requireSettledCollectionElement(initializer: Expression, declared: ValueType, annotated: boolean): boolean {
    if (annotated) return false;
    return this.reportUnsettledCollection(initializer, this.expandAliases(declared));
  }

  /**
   * D85 rule 209: where the value at this position came from, when it came
   * from a hole VEL4039 already reported. The answer is two-part because a
   * callee can be declared after its caller: `true` is a hole already on
   * record, and `causes` are the local results that make this position a hole
   * too if theirs turn out to be one.
   *
   * Only a name and a call to a local name are modelled — the two shapes an
   * author writes between an empty collection and the `return` that publishes
   * it. Anything else contributes nothing, so an unmodelled position keeps the
   * report it has today rather than losing one.
   */
  private collectResultHoleSources(expression: Expression, causes: Set<string>): boolean {
    if (expression.kind === "IdentifierExpression") {
      const binding = this.lookup(expression.name);
      if (!binding) return false;
      for (const cause of this.bindingHoleCauses.get(binding) ?? []) causes.add(cause);
      return this.reportedCollectionHoles.has(binding);
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression") {
      const binding = this.lookup(expression.callee.name);
      const resultKey = binding ? this.functionResultKeys.get(binding) : undefined;
      // An imported, dynamically dispatched, or method call resolves to no
      // local result. Its hole — if it has one — was reported in the module
      // that owns it, and nothing here can say so, so the call is not a cause.
      if (resultKey === undefined) return false;
      if (this.reportedResultHoles.has(resultKey)) return true;
      causes.add(resultKey);
      return false;
    }
    return false;
  }

  /**
   * D85 rule 209: a name bound to a reported hole carries it, so `const a = []`
   * followed by `return a` is the same one mistake `return []` is. Only an
   * unannotated `const`/`let` of a single name carries anything: an annotation
   * settles the construction, and a destructuring pattern takes the hole apart
   * rather than passing it on.
   */
  private recordBindingHoleSource(pattern: BindingPattern, initializer: Expression, reported: boolean): void {
    if (pattern.kind !== "NameBindingPattern") return;
    const binding = this.scopes.at(-1)?.get(pattern.name);
    if (!binding) return;
    const causes = new Set<string>();
    if (reported || this.collectResultHoleSources(initializer, causes)) {
      this.reportedCollectionHoles.add(binding);
      return;
    }
    if (causes.size > 0) this.bindingHoleCauses.set(binding, causes);
  }

  /**
   * D85 rule 209: delete the convergence report of every function whose result
   * is invalid only because a hole VEL4039 already explained reached it through
   * a local call. The set grows until it stops growing, because a chain of
   * forwarding functions is still one mistake however long it is — and a cycle
   * with no empty collection anywhere in it never enters the set, so a genuine
   * convergence failure still reports on both of its halves.
   */
  private resolveDeferredConvergenceReports(): void {
    if (this.deferredConvergenceReports.length === 0) return;
    const suppressed = new Set<Diagnostic>();
    for (let growing = true; growing;) {
      growing = false;
      for (const entry of this.deferredConvergenceReports) {
        if (suppressed.has(entry.report)) continue;
        if (![...entry.causes].some((cause) => this.reportedResultHoles.has(cause))) continue;
        suppressed.add(entry.report);
        this.reportedResultHoles.add(entry.resultKey);
        growing = true;
      }
    }
    for (let index = this.diagnostics.length - 1; index >= 0; index -= 1) {
      const report = this.diagnostics[index];
      if (report && suppressed.has(report)) this.diagnostics.splice(index, 1);
    }
  }

  private reportUnsettledCollection(expression: Expression, type: ValueType | null): boolean {
    if (type !== null) {
      if (this.isFreshUnresolvedCollection(expression, type)) {
        const [spelling, holds, example] = type.kind === "list"
          ? ["[]", "what the List holds", "let items: List<string> = []"]
          : type.kind === "set"
            ? ["Set()", "what the Set holds", "const tags: Set<string> = Set()"]
            : ["Map()", "what the Map holds", "const users: Map<string, User> = Map()"];
        this.diagnostics.push(diagnostic(
          "VEL4039",
          `Empty '${spelling}' requires an explicit type; nothing at this position says ${holds} — write '${example}'`,
          expression.span,
        ));
        return true;
      }
      if (!carriesUnsettledCollection(type)) return false;
    }
    let reported = false;
    for (const part of settlingValuePositions(expression)) {
      // A part analyzed under a contextual type that settled it never reaches
      // here as `unknown`; one that was analyzed at all has its answer on
      // record. A part with no answer on record was never inferred as a whole
      // — `Map([[key, value]])` reads the entry's two leaves and never the
      // entry list itself — so the walk carries on through the gap rather
      // than stopping at one it did not make.
      const partType = this.inferredExpressionTypes.get(spanIdentity(part.span));
      if (this.reportUnsettledCollection(part, partType ? this.expandAliases(partType) : null)) reported = true;
    }
    return reported;
  }

  private isFreshUnresolvedCollection(expression: Expression, type: ValueType): boolean {
    const unresolved = type.kind === "list" ? type.element.kind === "unknown"
      : type.kind === "set" ? type.element.kind === "unknown"
        : type.kind === "map" ? type.key.kind === "unknown" && type.value.kind === "unknown"
          : false;
    if (!unresolved) return false;
    // Only a genuinely empty construction is unsettled. A populated one whose
    // items happen to be `unknown` (`[value]` over an unchecked boundary
    // value) says what it holds; the element type is simply that.
    if (expression.kind === "ListExpression") return expression.elements.length === 0;
    return expression.kind === "CallExpression"
      && expression.arguments.length === 0
      // `Set<string>()` already told the author where the element type goes
      // (VEL2031); reporting the missing one here would name the same mistake
      // twice and contradict the fix the first report offers.
      && expression.typeArgumentsRemoved !== true
      && expression.callee.kind === "IdentifierExpression"
      && (expression.callee.name === "Map" || expression.callee.name === "Set");
  }

  /**
   * A `type`, `class` or `enum` name. Every one of them declares a binding and
   * a type name at once, so they ask `declareBinding` the reserved-type-name
   * question here rather than each repeating the argument list that carries it.
   */
  private declareTypeNameBinding(name: string, type: ValueType, declarationSpan: Span, position: BuiltinTypeNamePosition): void {
    this.declareBinding(name, false, type, declarationSpan, false, undefined, undefined, position);
  }

  protected declareBinding(
    name: string,
    mutable: boolean,
    type: ValueType,
    declarationSpan: Span,
    internal = false,
    declaredType = type,
    importSource?: string,
    /**
     * Set when this binding also introduces a *type* name, which is the one
     * question `builtinTypeNameDeclarationMessage` answers. A `const` or a
     * parameter leaves it unset: naming a local `List` shadows the built-in
     * value, but `List` in a type position still means the built-in there, so
     * the reserved-type-name rule has nothing to say about it.
     */
    typeNamePosition?: BuiltinTypeNamePosition,
  ): void {
    this.pendingScopeDeclarations.at(-1)?.delete(name);
    if (!internal) {
      // One mistake, one report: `type Promise:` is a reserved Core binding and
      // a built-in type name both, and the built-in type name is what the
      // author wrote it as, so that sentence is the one it earns.
      if (typeNamePosition !== undefined && builtinTypeNames.has(name)) {
        this.diagnostics.push(diagnostic("VEL3007", builtinTypeNameDeclarationMessage(name, typeNamePosition), declarationSpan));
      } else {
        const restriction = bindingNameRestriction(name, this.extensionReservedBindings);
        if (restriction && restriction !== "invalid" && restriction !== "keyword" && restriction !== "source") {
          const message = restriction === "javascript"
            ? name === "arguments"
              ? "Use named parameters; VelarScript does not expose the JavaScript 'arguments' binding"
              : `'${name}' is reserved by JavaScript and cannot be used as a VelarScript binding`
            : restriction === "compiler"
              ? `'${name}' uses a reserved compiler prefix '__velar'`
              : restriction === "core"
                ? `'${name}' is a reserved Core binding`
                : restriction === "extension"
                  ? `'${name}' is a reserved extension binding`
                  : `'${name}' is not available as a VelarScript binding`;
          // The name is still declared after the report: a rejected parameter or
          // loop binding whose body reads it would otherwise add an "Unknown
          // name" for every use of the one mistake. No code is emitted from a
          // module that reported a diagnostic, so the invalid spelling never
          // reaches generated JavaScript.
          this.diagnostics.push(diagnostic("VEL3007", message, declarationSpan));
        }
      }
    }
    // D52 rules 114/116: every name the module binds anywhere. A migration
    // rewrite that would introduce an import only claims to be equivalent when
    // the name it introduces collides with nothing in the module.
    this.declaredNames.add(name);
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
        const laterSpan = existing.span.start > declarationSpan.start ? existing.span : declarationSpan;
        this.diagnostics.push(diagnostic("VEL3004", `Name '${name}' is already declared in this scope`, laterSpan));
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
      flowScope: this.scopes.length - 1,
    };
    this.recordScopedName(name);
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
    if (origin === undefined) return;
    const read: InitializationImportRead = { local, source: origin.source, imported: origin.imported, span };
    // D31 item 23: a read inside a deferred body belongs to that body, not to
    // the module. Whether it runs during module evaluation is decided by
    // `moduleInitializationImportReads`, once the top-level calls are known.
    const frame = this.deferredReadFrames.at(-1);
    if (frame) {
      frame.reads.push(read);
      return;
    }
    if (!this.inModuleInitializationPosition()) return;
    const key = spanIdentity(span);
    if (!this.initializationImportReadSites.has(key)) this.initializationImportReadSites.set(key, read);
  }

  /**
   * D31 item 23: the call edge. Inside a deferred body it is an edge of the
   * reachability graph; at module top level it is a root, because that call
   * runs the callee while the module itself evaluates. The callee is held as
   * a binding, not as a frame — a `def` is hoisted, so `const x = pull()` can
   * be analyzed before `def pull()` is.
   */
  private recordDeferredCallEdge(callee: Expression, span: Span): void {
    if (callee.kind !== "IdentifierExpression") return;
    // The two cheap questions first: every other call would pay for a scope
    // lookup whose answer nothing reads.
    const frame = this.deferredReadFrames.at(-1);
    if (!frame && !this.inModuleInitializationPosition()) return;
    const binding = this.lookup(callee.name);
    if (!binding) return;
    if (frame) frame.calls.push(binding);
    else this.initializationLocalCalls.push({ binding, span });
  }

  /** Files an arrow's deferred frame under the module-local name it was bound to. */
  private claimArrowDeferredFrame(pattern: BindingPattern, initializer: Expression): void {
    if (initializer.kind !== "ArrowFunctionExpression" || pattern.kind !== "NameBindingPattern") return;
    const frame = this.arrowDeferredFrames.get(spanIdentity(initializer.span));
    const binding = this.scopes.at(-1)?.get(pattern.name);
    if (frame && binding) this.localFunctionFrames.set(binding, frame);
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

  /**
   * Initialization-position reads of imported bindings, for the project
   * module-cycle check.
   *
   * D31 item 23 recorded the indirect shape as a v1 residual: a top-level call
   * of a module-local function runs that body while the module evaluates, so
   * an imported binding read inside it is an initialization-position read too
   * — and following VEL3019's own remediation ("Move this read into a
   * function") and then calling that function at top level re-created the bare
   * `ReferenceError` the check exists to delete. The closure below is the
   * intra-module reachability pass that closes it: one module, one walk over
   * the call edges already collected, no cross-module analysis.
   *
   * An indirect read is reported at the *call*, not at the read. The call is
   * the line that runs during module evaluation and the line an author can
   * move; the read inside the body is already in a function, which is what the
   * remediation asks for.
   */
  moduleInitializationImportReads(): readonly InitializationImportRead[] {
    const sites = new Map(this.initializationImportReadSites);
    const visited = new Set<DeferredReadFrame>();
    const collect = (frame: DeferredReadFrame, callSpan: Span): void => {
      if (visited.has(frame)) return;
      visited.add(frame);
      for (const read of frame.reads) {
        const key = `${spanIdentity(callSpan)}\0${read.local}\0${read.source}`;
        if (!sites.has(key)) sites.set(key, { ...read, span: callSpan });
      }
      for (const called of frame.calls) {
        const next = this.localFunctionFrames.get(called);
        if (next) collect(next, callSpan);
      }
    };
    for (const call of this.initializationLocalCalls) {
      const frame = this.localFunctionFrames.get(call.binding);
      // One root at a time: two roots reaching the same body must each report,
      // so the visited set is per root rather than per module.
      if (frame) {
        visited.clear();
        collect(frame, call.span);
      }
    }
    return [...sites.values()];
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
    if (type.kind === "number") return new Map(["abs", "round", "floor", "ceil", "sign", "trunc", "toFixed", "isInteger", "isNaN", "isFinite"]
      .map((name) => [name, this.numberMember(name)!]));
    if (type.kind === "list") return available(["size", "get", "slice", "append", "extend", "insert", "has", "remove", "pop", "clear", "copy", "count", "index", "sorted", "reversed", "map", "flatMap", "filter", "reduce", "some", "every", "find", "join", "sum", "min", "max"], (name) => this.listMember(type, name));
    if (type.kind === "map") return available(["size", "get", "set", "getOrSet", "getOrSetWith", "update", "has", "remove", "clear", "copy", "iterator", "keys", "values", "entries"], (name) => this.mapMember(type, name));
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
    if (type.kind === "typeObject") {
      const value = this.runtimeTypeObjectValue(type);
      const members = new Map<string, ValueType>([
        ["is", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType }],
        ["parse", { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: value }],
      ]);
      if (this.recordProjectionShape(value)) {
        members.set("from", {
          kind: "function",
          parameterNames: ["source", "overrides"],
          parameters: [unknownType, unknownType],
          requiredParameters: 1,
          result: value,
        });
      }
      return members;
    }
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
    // JavaScript block functions are available throughout their lexical
    // block, and module-level VelarScript defs already follow that rule. Make
    // every lexical block coherent: only defs are predeclared; const/let and
    // owned bindings retain declaration order and TDZ diagnostics.
    for (const statement of statements) {
      if (statement.kind !== "FunctionDeclaration") continue;
      this.declareBinding(statement.name, false, this.functionType(statement), statement.span);
      const binding = this.scopes.at(-1)!.get(statement.name);
      if (binding?.span.start === statement.span.start && binding.span.end === statement.span.end) {
        this.functionResultKeys.set(binding, this.functionResultKey(statement));
      }
      this.predeclared.add(statement);
    }
    for (const statement of statements) {
      if (statement.kind === "VariableDeclaration") {
        this.collectPatternNames(statement.pattern, (name) => {
          if (!pending.has(name)) pending.set(name, { span: statement.span, loopHead: false });
        });
      } else if (statement.kind === "UsingDeclaration") {
        // An owned binding declares a name in this scope exactly as `const`
        // does, so a read above it is the same shadow hazard.
        if (!pending.has(statement.name)) pending.set(statement.name, { span: statement.span, loopHead: false });
      } else {
        const extension = this.prescanExtensionScopeDeclaration(statement);
        if (extension && !pending.has(extension.name)) pending.set(extension.name, { span: extension.span, loopHead: false });
      }
    }
  }

  /**
   * D90 R12: "exported" is a property of the declaration a consumer can reach,
   * not of the `def` keyword. A module-level declaration carries the flag
   * itself and is judged here and now. A class member carries none — a public
   * member of a class this module publishes is read by a consumer exactly as
   * an exported `const` is — but whether the class is published is a question
   * about the whole module, so the member waits for reportExportPositionAny. A
   * `private` member is never reachable, and R12's boundary does not move:
   * module-internal `any` stays legal.
   */
  private recordExportedAny(statement: AnalyzableFunctionDeclaration, className: string | null, span: Span): void {
    if (statement.exported === true) {
      this.reportExportedAny([statement.name], span);
      return;
    }
    if (className === null || statement.private === true) return;
    this.exportPositionCandidates.push({ className, member: statement.name, span });
  }

  /**
   * D90 R12: the class members that turned out to be at an export position.
   * Reported once the module is analyzed, because the answer is reachability
   * and reachability is a property of the module, not of the declaration.
   */
  private reportExportPositionAny(program: Program): void {
    if (this.exportPositionCandidates.length === 0) return;
    const reachable = this.exportReachableClasses(program);
    for (const candidate of this.exportPositionCandidates) {
      if (reachable.has(candidate.className)) {
        this.reportExportedAny([`${candidate.className}.${candidate.member}`], candidate.span);
      }
    }
  }

  /**
   * D90 R12: which class declarations a consuming module can reach. Exported
   * classes seed the set; from there it follows every position a consumer can
   * read a value *out of* — the type of anything else this module exports, the
   * base a reachable class names, and the public surface of a class already
   * reachable. `export class Box extends Base:` publishes `Base`'s members,
   * and `def make() -> Inner` publishes `Inner`'s, whether or not either name
   * is exported.
   *
   * Input positions are deliberately absent, for the same reason
   * `typeContainsAnyOutput` omits them: a consumer that has to *supply* an
   * instance obtained it from an output position first, and that position is
   * what makes the class reachable.
   */
  private exportReachableClasses(program: Program): ReadonlySet<string> {
    const classes: string[] = [];
    const records: string[] = [];
    const reach = (type: ValueType | undefined): void => {
      if (type) collectOutputTypeNames(type, classes, records);
    };
    // The same walk validateReExports makes over the module's export surface,
    // so the two cannot disagree about what "this module exports" means.
    const publish = (name: string): void => {
      reach(this.scopes[0]!.get(name)?.type);
      records.push(name);
    };
    for (const statement of program.body) {
      if (statement.kind === "ReExportDeclaration" || !("exported" in statement) || !statement.exported) continue;
      if (statement.kind === "ClassDeclaration") classes.push(statement.name);
      else if (statement.kind === "VariableDeclaration") this.collectPatternNames(statement.pattern, publish);
      else if ("name" in statement && typeof statement.name === "string") publish(statement.name);
    }
    const reachable = new Set<string>();
    const visitedRecords = new Set<string>();
    while (classes.length > 0 || records.length > 0) {
      if (records.length > 0) {
        const name = records.pop()!;
        if (visitedRecords.has(name)) continue;
        visitedRecords.add(name);
        // A record a consumer holds is read field by field, so a class in a
        // field is reachable even when the record type itself is not exported.
        for (const field of this.namedTypes.get(name)?.values() ?? []) reach(field);
        reach(this.typeAliases.get(name));
        continue;
      }
      const name = classes.pop()!;
      if (reachable.has(name)) continue;
      reachable.add(name);
      const info = this.classes.get(name);
      if (!info) continue;
      if (info.base) classes.push(info.base);
      reach(info.iterate);
      // ClassInfo is exactly the public surface — private members live in
      // their own tables — and `fields` carries the getters' result types.
      // The constructor's parameters are inputs, so they are not followed.
      for (const field of info.fields.values()) reach(field.type);
      for (const field of info.staticFields.values()) reach(field.type);
      for (const method of info.methods.values()) reach(method);
      for (const method of info.staticMethods.values()) reach(method);
    }
    return reachable;
  }

  /**
   * D90 R12: the diagnostic has to teach the way out, not only refuse. A
   * consuming module never writes `unsafe`, so an exported `any` hands it a
   * value carrying no guarantee at all; the escape is to validate the value
   * into a declared type in the module that owns the boundary, which is what
   * `Type.parse` exists for. No new diagnostic code and no unsafe marker: this
   * is the rule at validateTypeReference finished, not a second rule.
   */
  private reportExportedAny(exported: readonly string[], span: Span): void {
    const names = exported.map((name) => `'${name}'`).join(", ");
    this.typeError(
      `${exported.length === 1 ? "Export" : "Exports"} ${names} ${exported.length === 1 ? "is" : "are"} 'any', which cannot cross a module boundary; validate the value into a declared type in this module first — 'const settled = Config.parse(candidate)' — and export that`,
      span,
    );
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
      // An invalid source has already been reported where it went wrong —
      // D85 rule 209's "one mistake, one report" — and `describeType` would
      // render it as the bare `unknown` nobody wrote.
      if (type.kind !== "list" && type.kind !== "any" && !isInvalidType(type)) {
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
    if (!fields && type.kind !== "any" && !isInvalidType(type)) {
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

  /**
   * `const value = map.get(key); if value == null: ...` 之后，`value` 是一次读取
   * 得到的稳定副本。它不能被重新赋值，存在性检查得到的类型又恰好是原
   * optional 的非空分支，因此后续读取无需再运行一次完整的 Type 检查。
   *
   * 这个证明只回答“这个局部副本还会不会变回 null”，与它指向的
   * List、Map 或记录内容是否可变无关。别名可以修改对象内容，却无法把这个
   * `const` 绑定本身改成 null；因此用整个记录的 Type 遍历去重复证明非空，
   * 会把普通 Map 更新意外变成二次复杂度。
   *
   * 参数、`let`、类实例、响应式值和导入的实时绑定仍会生成运行时收窄
   * 守卫；从 unknown/union 通过 `is` 得到的更具体类型也仍会深度复验。
   * 这些形状证明的不只是存在性，不能借用这条快路。
   */
  private isStableOptionalValueCopy(binding: Binding): boolean {
    const storage = binding.storageBinding ?? binding;
    if (storage.stableOptionalCopy !== true || storage.mutable || storage.reactiveKind || this.importedBindingOrigins.has(storage)) return false;
    const original = this.expandAliases(storage.storageType);
    if (original.kind !== "optional") return false;
    const inner = this.expandAliases(original.inner);
    return sameType(inner, this.expandAliases(binding.type));
  }

  protected isBuiltinValueReference(expression: Expression, name: PermanentNamespaceName | "range"): boolean {
    return this.builtinValueReferences.get(spanIdentity(expression.span)) === name;
  }

  protected applyNarrowings(narrowed: ReadonlyMap<string, ValueType>, narrowingSpan: Span): void {
    const memberScope = this.memberNarrowings.at(-1)!;
    for (const [key, type] of narrowed) {
      if (key.startsWith(memberNarrowingPrefix)) {
        memberScope.set(key.slice(memberNarrowingPrefix.length), { type, frame: this.flowFrameDepth });
      } else {
        const binding = this.lookup(key);
        const shadow: Binding = {
          mutable: binding?.mutable ?? false,
          type,
          declaredType: binding?.declaredType ?? type,
          storageType: binding?.storageType ?? type,
          ...(binding ? { storageBinding: binding.storageBinding ?? binding } : {}),
          span: binding?.span ?? narrowingSpan,
          narrowingFrame: this.flowFrameDepth,
          flowScope: this.scopes.length - 1,
          ...(binding?.reactiveKind ? { reactiveKind: binding.reactiveKind } : {}),
        };
        this.trackNarrowingShadow(shadow);
        this.narrowedNames.at(-1)!.add(key);
        if (!this.scopes.at(-1)!.has(key)) this.recordScopedName(key);
        this.scopes.at(-1)!.set(key, shadow);
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
      this.narrowedNames.at(-1)!.add(key);
      if (local) {
        this.recordFlowFactOrigin(local);
        local.type = type;
        local.narrowingFrame = this.flowFrameDepth;
        // A persisted (checked or merged) fact is not assignment-established.
        local.assignedFact = false;
      } else {
        const shadow: Binding = {
          mutable: binding.mutable,
          type,
          declaredType: binding.declaredType,
          storageType: binding.storageType,
          storageBinding: binding.storageBinding ?? binding,
          span: binding.span,
          narrowingFrame: this.flowFrameDepth,
          flowScope: this.scopes.length - 1,
          ...(binding.reactiveKind ? { reactiveKind: binding.reactiveKind } : {}),
        };
        this.trackNarrowingShadow(shadow);
        this.recordScopedName(key);
        scope.set(key, shadow);
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

  /**
   * A check that narrows a location installs a shadow of the binding in the
   * scope it entered, so nested checks leave one shadow per enclosing scope.
   * Clearing only the innermost shadow lets an outer scope keep a fact this
   * write just falsified — visible after a `while` whose condition narrows
   * the same name its body assigns, where the body's shadow is discarded with
   * the body scope and the loop's own shadow never learns of the write.
   */
  private invalidateShadowedNarrowings(name: string, target: Binding | null): void {
    if (!target) return;
    const storage = target.storageBinding ?? target;
    for (const scope of this.scopes) {
      const shadow = scope.get(name);
      if (!shadow || shadow === target || (shadow.storageBinding ?? shadow) !== storage) continue;
      this.recordFlowFactOrigin(shadow);
      shadow.storageType = storage.storageType;
      shadow.type = storage.storageType;
      shadow.narrowingFrame = null;
      shadow.assignedFact = false;
    }
  }

  private establishAssignedFact(name: string, assigned: ValueType): void {
    const binding = this.lookup(name);
    if (!binding) return;
    const fact = this.assignedFactType(assigned, (binding.storageBinding ?? binding).storageType);
    if (fact === null) return;
    const scope = this.scopes.at(-1)!;
    const local = scope.get(name);
    this.narrowedNames.at(-1)!.add(name);
    if (local) {
      this.recordFlowFactOrigin(local);
      local.type = fact;
      local.narrowingFrame = this.flowFrameDepth;
      local.assignedFact = true;
    } else {
      const shadow: Binding = {
        mutable: binding.mutable,
        type: fact,
        declaredType: binding.declaredType,
        storageType: binding.storageType,
        storageBinding: binding.storageBinding ?? binding,
        span: binding.span,
        narrowingFrame: this.flowFrameDepth,
        assignedFact: true,
        flowScope: this.scopes.length - 1,
        ...(binding.reactiveKind ? { reactiveKind: binding.reactiveKind } : {}),
      };
      this.trackNarrowingShadow(shadow);
      this.recordScopedName(name);
      scope.set(name, shadow);
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
        this.recordFlowFactOrigin(binding);
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
    // D85 rule 210: `unknown` is the one checked domain that proves nothing,
    // so a check against it leaves the subject's own type alone. Without this
    // a membership probe against a container whose element or key type is
    // `unknown` replaced a `string` subject with `unknown`, which is a
    // widening — every later read of it then failed for the wrong reason.
    if (this.expandAliases(checked).kind === "unknown") return source;
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

  /**
   * A snapshot used to copy every binding of every live scope, which made a
   * branch cost O(names in the module) and whole-module analysis quadratic in
   * module size. A binding nothing ever narrows cannot differ between two
   * moments, so only the bindings flow analysis has actually written are
   * visited — `flowTouched`, kept per scope depth so an exiting scope drops
   * its own, and `flowOrigins`, which remembers what each one held before its
   * first write. `flowOrigins` answers for a binding a *later* write touched
   * than the snapshot being restored: the snapshot has no entry, and its
   * pre-write state is exactly the state that snapshot recorded. A narrowing
   * shadow born after the snapshot stores `null` instead, because a full-scope
   * snapshot had nothing to restore it to either.
   */
  private flowFactState(binding: Binding): FlowFactState {
    return {
      type: binding.type,
      storageType: binding.storageType,
      frame: binding.narrowingFrame,
      assigned: binding.assignedFact === true,
    };
  }

  /** Called immediately before flow analysis writes a binding, so the recorded state is the pre-write one. */
  private recordFlowFactOrigin(binding: Binding): void {
    if (this.flowOrigins.has(binding)) return;
    this.flowOrigins.set(binding, this.flowFactState(binding));
    this.trackFlowBinding(binding);
  }

  /** A narrowing shadow created mid-flow: no older snapshot has a state for it. */
  private trackNarrowingShadow(shadow: Binding): void {
    this.flowOrigins.set(shadow, null);
    this.trackFlowBinding(shadow);
  }

  private trackFlowBinding(binding: Binding): void {
    const depth = Math.min(binding.flowScope ?? 0, this.flowTouched.length - 1);
    this.flowTouched[depth]!.add(binding);
  }

  /** Every binding whose flow facts may differ from another moment's, outermost scope first. */
  private *touchedFlowBindings(): Generator<Binding> {
    for (const level of this.flowTouched) yield* level;
  }

  /** The state `snapshot` recorded for `binding`, or null when it did not exist yet. */
  private flowStateIn(snapshot: FlowFactsSnapshot, binding: Binding): FlowFactState | null {
    return snapshot.bindings.get(binding) ?? this.flowOrigins.get(binding) ?? null;
  }

  private snapshotFlowFacts(): FlowFactsSnapshot {
    const bindings = new Map<Binding, FlowFactState>();
    for (const binding of this.touchedFlowBindings()) bindings.set(binding, this.flowFactState(binding));
    return {
      bindings,
      members: this.memberNarrowings.map((scope) => new Map(scope)),
    };
  }

  private restoreFlowFacts(snapshot: FlowFactsSnapshot): void {
    for (const binding of this.touchedFlowBindings()) {
      const state = this.flowStateIn(snapshot, binding);
      if (!state) continue;
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
    // Only a written binding can carry a storage type this branch moved. One
    // nothing wrote merges its own storage type with itself, which is the
    // identity, so leaving it out of the set is what the merge already did.
    for (const binding of this.touchedFlowBindings()) {
      const state = this.flowStateIn(snapshot, binding);
      if (!state) continue;
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

  /**
   * A loop's back-edge pass re-runs the whole body, and a nested loop inside
   * that pass runs its own, so the work doubled with every level of loop
   * nesting: fourteen levels of `while` in a 91-line file took 2.4 seconds and
   * seventeen took 35. The passes are budgeted by how many back-edge passes
   * are already running. Past the budget a loop analyzes its body once and its
   * exit keeps nothing — `widened` — which is what the loop would answer if
   * its back edge had falsified every fact, so the degradation only ever
   * removes a fact, never invents one. Real code does not nest loops four
   * deep, so nothing reachable by hand reaches the budget.
   */
  private reanalyzeLoopBackEdge(
    baseline: FlowFactsSnapshot,
    visible: VisibleScopeDepth,
    backEdges: readonly FlowFactInvalidations[],
    body: readonly Statement[],
    diagnosticStart: number,
    analyze: () => void,
  ): LoopBackEdgeOutcome {
    if (!this.flowInvalidationsAffectFacts(backEdges)) return { repeated: null, widened: false };
    if (this.loopReanalysisDepth >= maximumLoopReanalysisDepth) return { repeated: null, widened: true };
    const loopHead = this.flowSnapshotAfterInvalidations(baseline, backEdges);
    this.loopFlowContexts.push({ baseline: loopHead, visible, carried: [], backEdges: [], breakFacts: [], sawBreak: false });
    const secondDiagnosticStart = this.diagnostics.length;
    this.clearCachedFlowTypes(body);
    let repeated: LoopFlowContext | null = null;
    this.loopReanalysisDepth += 1;
    try {
      this.analyzeIsolatedFlow(loopHead, analyze);
      this.deduplicateDiagnostics(diagnosticStart, secondDiagnosticStart);
    } finally {
      this.loopReanalysisDepth -= 1;
      repeated = this.loopFlowContexts.pop() ?? null;
      this.restoreFlowFacts(baseline);
    }
    return { repeated, widened: false };
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

  private visibleBindings(): VisibleScopeDepth {
    return this.scopes.length;
  }

  /** The binding a name resolved to when `visible` was captured. */
  private visibleBinding(visible: VisibleScopeDepth, name: string): Binding | null {
    for (let index = Math.min(visible, this.scopes.length) - 1; index >= 0; index -= 1) {
      const binding = this.scopes[index]?.get(name);
      if (binding) return binding;
    }
    return null;
  }

  /**
   * Only a name a narrowing has written can carry a fact, and `narrowedNames`
   * is the roster of those per scope — so this walks the narrowings rather
   * than every name in scope. The member half matches a dotted path against
   * the binding its root names instead of spreading the whole root set per
   * path, which is O(one lookup) rather than O(names in the module).
   */
  private narrowingsForVisibleBindings(visible: VisibleScopeDepth): ReadonlyMap<string, ValueType> {
    const narrowed = new Map<string, ValueType>();
    const seen = new Set<string>();
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      for (const name of this.narrowedNames[index]!) {
        if (seen.has(name)) continue;
        seen.add(name);
        const original = this.visibleBinding(visible, name);
        if (!original) continue;
        const current = this.lookup(name);
        if (current?.narrowingFrame === this.flowFrameDepth
          && current.span.start === original.span.start
          && current.span.end === original.span.end) narrowed.set(name, current.type);
      }
    }
    for (let index = this.memberNarrowings.length - 1; index >= 0; index -= 1) {
      for (const [path, fact] of this.memberNarrowings[index]!) {
        if (fact.frame !== this.flowFrameDepth || narrowed.has(`${memberNarrowingPrefix}${path}`)) continue;
        if (this.memberNarrowingRootIsVisible(visible, path)) {
          narrowed.set(`${memberNarrowingPrefix}${path}`, fact.type);
        }
      }
    }
    return narrowed;
  }

  /** Whether a member path's root — `<declaration offset>:<name>` — names a binding visible then. */
  private memberNarrowingRootIsVisible(visible: VisibleScopeDepth, path: string): boolean {
    const separator = path.indexOf(":");
    if (separator < 0) return false;
    const dot = path.indexOf(".");
    const start = Number(path.slice(0, separator));
    const name = path.slice(separator + 1, dot < 0 ? path.length : dot);
    return this.visibleBinding(visible, name)?.span.start === start;
  }

  private narrowingsInSnapshot(
    snapshot: FlowFactsSnapshot,
    visible: VisibleScopeDepth,
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

  /**
   * FLW-S1: a `while` is left through the condition test taken either on
   * entry or after the back edge, so the fact that holds afterwards is the
   * union of what the two tests prove. A location only one of them names is
   * dropped, because the other test proves nothing about it.
   */
  private joinedNarrowings(
    first: ReadonlyMap<string, ValueType>,
    second: ReadonlyMap<string, ValueType>,
  ): ReadonlyMap<string, ValueType> {
    const joined = new Map<string, ValueType>();
    for (const [key, type] of first) {
      const other = second.get(key);
      if (other !== undefined) joined.set(key, sameType(other, type) ? type : mergeTypes(type, other));
    }
    return joined;
  }

  private applyFlowInvalidations(branches: readonly FlowFactInvalidations[], includeBaseline = true): void {
    if (branches.length > 0) {
      const bindings = new Set(branches.flatMap((branch) => [...branch.storageTypes.keys()]));
      for (const binding of bindings) {
        const candidates = branches.map((branch) => branch.storageTypes.get(binding) ?? binding.storageType);
        if (includeBaseline) candidates.unshift(binding.storageType);
        this.recordFlowFactOrigin(binding);
        binding.storageType = candidates.reduce((merged, candidate) => mergeTypes(merged, candidate));
        if (binding.narrowingFrame === null) binding.type = binding.storageType;
      }
    }
    for (const branch of branches) {
      for (const binding of branch.bindings) {
        this.recordFlowFactOrigin(binding);
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
    this.narrowedNames.push(new Set());
    this.scopedNames.push([]);
    this.flowTouched.push(new Set());
  }

  protected exitScope(): void {
    this.scopes.pop();
    this.memberNarrowings.pop();
    this.pendingScopeDeclarations.pop();
    this.narrowedNames.pop();
    for (const name of this.scopedNames.pop() ?? []) this.nearestNames.remove(name);
    // The bindings this scope created are unreachable now, so the flow-fact
    // working set shrinks with it rather than growing across the module.
    for (const binding of this.flowTouched.pop() ?? []) this.flowOrigins.delete(binding);
  }
}
