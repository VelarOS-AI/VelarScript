/**
 * The contract the analyzer publishes and the emitter and the extension
 * protocol consume: the compiler-owned member keys behind `@dispose:` and
 * `@iterate:`, the `LoweringHints` side tables the emitter reads, and the
 * class, analysis-context, and initialization-read shapes the project driver
 * and the extension protocol name.
 *
 * D114 R1a: these declarations lived in `analyzer.ts`, which made
 * `emitter.ts -> analyzer.ts` a value edge of the five-module import ring
 * (`analyzer -> emitter -> extension -> parser -> lexer`). They are a contract
 * between stages, not analyzer state, so they live in their own module and
 * `analyzer.ts` re-exports every one of them: nothing that imported a name
 * from `./analyzer.ts` has to change.
 */
import { type PermanentNamespaceName } from "./core-vocabulary.ts";
import { type Span } from "./source.ts";
import {
  type BinaryStorageKind,
  type EnumInfo,
  type GenericApplication,
  type GenericTypeInfo,
  type TypeParameterBound,
  type ValueType,
} from "./types.ts";

export interface ClassField {
  readonly mutable: boolean;
  readonly type: ValueType;
}

export interface ClassInfo {
  readonly identity?: string;
  /**
   * D55 rule 120 layer two: the class's own type parameters, present on the
   * declaration entry and absent from every instantiation of it. Their absence
   * is what tells a written `Stack<number>` from the type constructor `Stack`,
   * which is not a type at all (rule 126).
   */
  readonly typeParameterNames?: readonly string[];
  readonly typeParameterBounds?: readonly (TypeParameterBound | null)[];
  /**
   * The application this entry is — `Stack<number>` records the declaration it
   * instantiates and the arguments it applied, so substitution, the module
   * interface, and the emitted `instanceof` receiver all read one place.
   */
  readonly application?: GenericApplication;
  /**
   * The application this class's `extends` writes, when the base is generic.
   * `base` is already the instantiated key; this keeps the parts so
   * instantiating *this* class can rebuild the base key with the arguments
   * substituted (`class MyStack<T> extends Stack<T>` at `T := number`).
   */
  readonly baseApplication?: GenericApplication;
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

export type CollectionOperation = "listGet" | "mapGet" | "recordGet" | "slice" | "listAppend" | "listExtend" | "listInsert" | "listRemove" | "listPop" | "listClear" | "listCopy" | "listHas" | "listCount" | "listIndex" | "listFind" | "listSome" | "listEvery" | "listMap" | "listFilter" | "listFlatMap" | "listReduce" | "listJoin" | "listSorted" | "listReversed" | "listSum" | "listMin" | "listMax" | "listUnique" | "listCompact" | "listFlatten" | "listChunk" | "listPartition" | "listGroupBy" | "listKeyBy" | "listCountBy" | "listZip" | "listRepeat" | "setAdd" | "setUpdate" | "setHas" | "setRemove" | "setClear" | "setValues" | "setCopy" | "setUnion" | "setIntersection" | "setDifference" | "mapSet" | "mapGetOrSet" | "mapGetOrSetWith" | "mapUpdate" | "mapHas" | "mapRemove" | "mapClear" | "mapIterator" | "mapKeys" | "mapValues" | "mapEntries" | "mapCopy" | "recordSet" | "recordHas" | "recordRemove" | "recordClear" | "recordKeys" | "recordValues" | "recordEntries" | "recordCopy";

export type PrimitiveOperation = "stringTrim" | "stringUpper" | "stringLower" | "stringSlice" | "stringChar" | "stringHas" | "stringIndex" | "stringCount" | "stringStartsWith" | "stringEndsWith" | "stringSplit" | "stringReplace" | "stringReplaceAll" | "stringPadStart" | "stringPadEnd" | "stringRepeat" | "stringIsBlank" | "numberAbs" | "numberRound" | "numberFloor" | "numberCeil" | "numberSign" | "numberTrunc" | "numberToFixed" | "numberIsInteger" | "numberIsNaN" | "numberIsFinite";

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
