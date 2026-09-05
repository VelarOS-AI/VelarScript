/**
 * What the analyzer records for the emitter: one side table per lowering
 * decision, keyed by node offset or by span identity.
 *
 * D114 R1a: these tables were 52 private fields on `Analyzer`, interleaved with
 * its inference state. They are one cohesive thing — the analyzer's half of the
 * `LoweringHints` contract — so they live in one collaborator the analyzer owns
 * as `this.lowering`. The recorder holds no analyzer reference: the only thing
 * it needs from its host arrives as the argument to `hints`.
 *
 * Three tables of the contract are not here. `enumValueBindings`,
 * `extensionLiterals` and `extensionCalls` are `protected` members of
 * `Analyzer` that the Web analyzer writes, so they stay on the class whose seam
 * they belong to and reach the assembly through `AnalyzerOwnedHints`. The other
 * four entries of `LoweringHints` are not tables at all — `classNames`,
 * `errorSubclassNames`, `enumNames` and `genericTypeNames` are derived at
 * assembly time from the analyzer's class, enum and generic rosters.
 */
import { type Expression } from "../ast.ts";
import { type PermanentNamespaceName } from "../core-vocabulary.ts";
import {
  type CollectionOperation,
  type CollectionRuntimeKind,
  type DisposalContract,
  type FormReadField,
  type LoweringHints,
  type PrimitiveOperation,
  type RecordFromHint,
  type RecordMapFromHint,
  type RecordTypeField,
  type RuntimeNarrowingGuard,
} from "../contracts.ts";
import { spanIdentity } from "../source.ts";
import { type BinaryStorageKind } from "../types.ts";

/**
 * The part of `LoweringHints` the recorder cannot answer: the three
 * `protected` tables that belong to the analyzer's subclass seam, and the four
 * entries derived from the analyzer's own class, enum and generic rosters.
 */
export interface AnalyzerOwnedHints {
  readonly classNames: ReadonlySet<string>;
  readonly errorSubclassNames: ReadonlySet<string>;
  readonly enumNames: ReadonlySet<string>;
  readonly genericTypeNames: ReadonlySet<string>;
  readonly enumValueBindings: ReadonlyMap<number, string>;
  readonly extensionLiterals: ReadonlyMap<string, string>;
  readonly extensionCalls: ReadonlyMap<string, string>;
}

export class LoweringRecorder {
  readonly collectionCalls = new Map<number, CollectionOperation>();
  readonly collectionSizes = new Map<number, CollectionRuntimeKind>();
  readonly collectionIndexes = new Map<string, "list" | "record">();
  readonly collectionMemberships = new Map<string, CollectionRuntimeKind | "string">();
  readonly collectionIterations = new Map<number, CollectionRuntimeKind | "string" | "binary">();
  readonly recordFromCalls = new Map<string, RecordFromHint>();
  readonly recordMapFromCalls = new Map<string, RecordMapFromHint>();
  readonly binaryCalls = new Map<number, "bufferCopy" | "bufferSlice" | "bufferToBytes" | "bufferValues">();
  readonly binarySizes = new Map<number, BinaryStorageKind>();
  readonly binaryIndexes = new Map<string, BinaryStorageKind>();
  readonly primitiveCalls = new Map<number, PrimitiveOperation>();
  readonly stringSizes = new Set<number>();
  readonly constructorCalls = new Set<string>();
  readonly javaScriptCallBoundaries = new Set<string>();
  readonly classChecks = new Set<string>();
  readonly privateMembers = new Set<string>();
  /** Module-scope names bound to runtime Type objects (local and imported); see LoweringHints.runtimeTypeObjectNames. */
  readonly runtimeTypeObjectNames = new Set<string>();
  /** Analyzer-owned complete field tables passed to the emitter for runtime validation. */
  readonly typeDeclarationFields = new Map<number, readonly RecordTypeField[]>();
  readonly optionalMembers = new Set<string>();
  readonly optionalCalls = new Set<string>();
  readonly optionalIndexes = new Set<string>();
  readonly optionalCallees = new Set<string>();
  readonly truthConditions = new Set<string>();
  readonly normalizedNullResults = new Set<string>();
  readonly normalizedPromiseValues = new Set<string>();
  readonly asyncResolvedValues = new Set<string>();
  readonly asyncForStatements = new Set<number>();
  readonly nativeRangeForStatements = new Set<number>();
  readonly normalizedUndefinedExpressions = new Set<string>();
  readonly instanceFieldReads = new Set<string>();
  // D50 rule 89: member spans that read `code` on an Error contract. The
  // emitter projects the declared class name rather than reading a property,
  // so a host object carrying its own unrelated `code` cannot impersonate one.
  readonly errorCodeReads = new Set<string>();
  readonly privateInstanceFieldReads = new Set<string>();
  readonly staticFieldReads = new Map<string, number>();
  // D44 rule 74: member spans that read a class method as a value (not as a
  // call's callee). The emitter binds these at the reference site, the same
  // rule collection method values follow (charter section 8).
  readonly classMethodReferences = new Set<string>();
  readonly optionalBindingEntries = new Set<number>();
  readonly reactiveReferences = new Map<string, "state" | "prop">();
  readonly exhaustiveMatches = new Set<number>();
  readonly formReads = new Map<string, readonly FormReadField[]>();
  readonly namedArgumentOrders = new Map<string, readonly number[]>();
  readonly builtinValueReferences = new Map<string, PermanentNamespaceName | "range">();
  readonly runtimeNarrowings = new Map<string, RuntimeNarrowingGuard>();
  readonly sameValueZeroEqualities = new Set<string>();
  readonly sameValueZeroMatchValues = new Set<string>();
  readonly equalsCalls = new Set<string>();
  readonly stringOrderings = new Set<string>();
  readonly dynamicOrderings = new Set<string>();
  readonly usingDisposals = new Map<string, DisposalContract>();
  readonly classDisposeChains = new Map<string, "sync" | "async">();
  /** D68 rule 177: expression spans a consumer iterates through `@iterate:`. */
  readonly iterationContracts = new Set<string>();
  /** D90 R18: `async for` statements pulling a declared asynchronous `@iterate:`. */
  readonly asyncIterationStatements = new Set<number>();
  /** D90 R18: `@iterate:` blocks that are the asynchronous pull form, by keyword span. */
  readonly asyncIterateBlocks = new Set<string>();
  readonly moduleTopLevelHostCalls = new Set<string>();

  /** True when this expression was accepted using a flow fact from its branch. */
  expressionUsesRuntimeNarrowing(expression: Expression): boolean {
    for (const key of this.runtimeNarrowings.keys()) {
      const separator = key.indexOf(":");
      if (separator < 0) continue;
      const start = Number(key.slice(0, separator));
      const end = Number(key.slice(separator + 1));
      if (start >= expression.span.start && end <= expression.span.end) return true;
    }
    return false;
  }

  expressionAlreadyNormalizesUndefined(expression: Expression): boolean {
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

  hints(owned: AnalyzerOwnedHints): LoweringHints {
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
      classNames: owned.classNames,
      errorSubclassNames: owned.errorSubclassNames,
      enumNames: owned.enumNames,
      runtimeTypeObjectNames: this.runtimeTypeObjectNames,
      genericTypeNames: owned.genericTypeNames,
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
      enumValueBindings: owned.enumValueBindings,
      exhaustiveMatches: this.exhaustiveMatches,
      formReads: this.formReads,
      namedArgumentOrders: this.namedArgumentOrders,
      extensionLiterals: owned.extensionLiterals,
      extensionCalls: owned.extensionCalls,
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
}
