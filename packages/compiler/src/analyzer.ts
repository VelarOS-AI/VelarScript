import { Advisories, type AdvisoryHost } from "./analysis/advisories.ts";
import { Assignability, type AssignabilityHost } from "./analysis/expressions/assignability.ts";
import { AssignmentAnalysis, type AssignmentAnalysisHost } from "./analysis/expressions/assignment.ts";
import { BinaryExpressions, type BinaryExpressionsHost } from "./analysis/expressions/binary.ts";
import { ContextualTyping, type ContextualTypingHost } from "./analysis/expressions/contextual.ts";
import { EqualityRules, type EqualityRulesHost } from "./analysis/expressions/equality.ts";
import { ExpressionGuidance, type ExpressionGuidanceHost } from "./analysis/expressions/guidance.ts";
import { IdentifierExpressions, type IdentifierExpressionsHost } from "./analysis/expressions/identifiers.ts";
import { LiteralExpressions, type LiteralExpressionsHost } from "./analysis/expressions/literals.ts";
import { OperatorExpressions, type OperatorExpressionsHost } from "./analysis/expressions/operators.ts";
import { RecordProjections, type RecordProjectionsHost } from "./analysis/expressions/projections.ts";
import { TextConversion, type TextConversionHost } from "./analysis/expressions/text.ts";
import { SemanticIndexRecorder, type SemanticIndexRecorderHost } from "./analysis/semantic-index.ts";
import { boundVocabularyGuidance } from "./analysis/calls/generic-calls.ts";
import { CallInference, continuesOptionalChain, type CallInferenceHost } from "./analysis/calls/inference.ts";
import { argumentNoun } from "./analysis/calls/named-arguments.ts";
import { discardedPurePrimitiveOperations, MemberAccess, type MemberAccessHost } from "./analysis/members.ts";
import { type CollectionInferenceHost } from "./analysis/collections/call.ts";
import { CollectionInference } from "./analysis/collections/inference.ts";
import {
  CORE_LIST_METHOD_NAMES,
  CORE_MAP_METHOD_NAMES,
  CORE_RECORD_METHOD_NAMES,
  CORE_SET_METHOD_NAMES,
  discardedPureCollectionOperations,
  mutatingCollectionMethods,
} from "./analysis/collections/operations.ts";
import { durationType } from "./analysis/vocabulary.ts";
import { LoweringRecorder } from "./analysis/lowering-recorder.ts";
import { ModuleExports, type ModuleExportsHost } from "./analysis/modules/exports.ts";
import { ModuleInitialization, type DeferredReadFrame, type ModuleInitializationHost } from "./analysis/modules/initialization.ts";
import { ModuleImports, type ModuleImportsHost } from "./analysis/modules/imports.ts";
import { ClassInheritance, type ClassInheritanceHost } from "./analysis/classes/inheritance.ts";
import { ClassMembers, type ClassMembersHost } from "./analysis/classes/members.ts";
import { ClassRegistry, type ClassRegistryHost } from "./analysis/classes/registry.ts";
import { ClassRoles, type ClassRolesHost } from "./analysis/classes/roles.ts";
import { TypeAliases, type TypeAliasesHost } from "./analysis/declarations/aliases.ts";
import { EnumDeclarations, type EnumDeclarationsHost } from "./analysis/declarations/enums.ts";
import { GenericDeclarations, type GenericDeclarationsHost } from "./analysis/declarations/generics.ts";
import { TypeRecords, type TypeRecordsHost } from "./analysis/declarations/records.ts";
import { TypeReferences, type TypeReferencesHost } from "./analysis/declarations/references.ts";
import {
  type AnalyzableFunctionDeclaration,
  asyncResultAnnotationMessage,
  containsInferredResultPlaceholder,
  inferredResultPlaceholderType,
  type ReturnContext,
  sameInferredResult,
} from "./analysis/functions.ts";
import { MatchCoverageRules, type MatchCoverageHost } from "./analysis/match-coverage.ts";
import { MatchAnalysis, type MatchAnalysisHost } from "./analysis/matching.ts";
import { uniqueNearestName } from "./analysis/nearest-names.ts";
import { FlowFacts, type FlowFactInvalidations, type FlowFactsHost, type FlowFactsSnapshot } from "./analysis/flow/facts.ts";
import { LoopFlow, type LoopFlowHost } from "./analysis/flow/loops.ts";
import { FlowMerge, type FlowMergeHost } from "./analysis/flow/merge.ts";
import { MemberLocations, type MemberLocationsHost } from "./analysis/flow/locations.ts";
import { Narrowing, type NarrowingHost } from "./analysis/flow/narrowing.ts";
import {
  type Binding,
  builtinTypeNameDeclarationMessage,
  builtinTypeNames,
  type BuiltinTypeNamePosition,
  type MutableCellTarget,
  ScopeStack,
  type ScopeStackHost,
} from "./analysis/scopes.ts";
import { PermanentNamespaceImports } from "./analysis/retired-imports.ts";
import type {
  ArrowFunctionExpression,
  AssignmentStatement,
  DetachStatement,
  BindingPattern,
  ClassDeclaration,
  ClassDisposeBlock,
  ClassIterateBlock,
  Expression,
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
import {
  disposeMemberKey,
  type AnalysisContext,
  type ClassField,
  type ClassInfo,
  type CompilerAnalysisExtension,
  type DisposalContract,
  type FormReadField,
  type InitializationImportRead,
  type LoweringHints,
  type RetiredNamespace,
} from "./contracts.ts";
import { isPermanentNamespaceName, type PermanentNamespaceName } from "./core-vocabulary.ts";
import {
  advisory,
  diagnostic,
  mechanicalFix,
  recoveredDiagnostic,
  type Advisory,
  type Diagnostic,
  type DiagnosticFix,
} from "./diagnostic.ts";
import { VELAR_HOST_ERROR_NAMES, VELAR_HOST_ERROR_PATH_NAMES } from "./error-runtime.ts";
import { removedGlobalFunctionGuidance, REST_PARAMETER_ELEMENT_TYPE_MESSAGE } from "./language-guidance.ts";
import { bindingNameRestriction } from "./source-names.ts";
import { span, spanIdentity, type Span } from "./source.ts";
import {
  anyType,
  binaryStorageKind,
  boolType,
  boundGrants,
  classApplicationType,
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
  typeContainsAnyOutput,
  typeContainsParameter,
  typeContainsRuntimeTypeCheck,
  unionOf,
  unknownType,
  type EnumInfo,
  type ExtensionValueType,
  type GenericApplication,
  type GenericBoundViolation,
  type GenericTypeInfo,
  type TypeEnvironment,
  type TypeParameterBound,
  type ValueType,
} from "./types.ts";

// D114 R1a: the stage-to-stage contract moved to `./contracts.ts` so the
// emitter and the extension protocol can read it without importing the
// analyzer. Every name it holds is re-exported here, so an existing
// `from "./analyzer.ts"` import of any of them keeps working unchanged.
export {
  disposeMemberKey,
  iterateAsyncMemberKey,
  iterateMemberKey,
} from "./contracts.ts";
export type {
  AnalysisContext,
  ClassField,
  ClassInfo,
  CollectionOperation,
  CollectionRuntimeKind,
  DisposalContract,
  FormReadField,
  InitializationImportRead,
  LoweringHints,
  PrimitiveOperation,
  RecordFromHint,
  RecordMapFromHint,
  RecordTypeField,
  RuntimeNarrowingGuard,
} from "./contracts.ts";
// D114 R1b: the collection vocabulary and its checking moved to
// `./analysis/collections/` (D115 §三 split it into a roster, a per-call
// object, four operation families and the member resolvers).
// `mutatingCollectionMethods` is the one name of that cluster this module
// published, so it is re-exported here and an existing
// `from "./analyzer.ts"` import of it keeps working unchanged.
export { mutatingCollectionMethods } from "./analysis/collections/operations.ts";
// D114 R1b: the permanent Core vocabulary moved to `./analysis/vocabulary.ts`,
// and the three names of it this module published are re-exported here.
export { MATH_NAMESPACE_MEMBERS, permanentNamespaceCoveringModule, TEXT_NAMESPACE_MEMBERS } from "./analysis/vocabulary.ts";
// D114 R1d: the function-declaration vocabulary moved to `./analysis/functions.ts`;
// the one name of it this module published is re-exported here.
export { inferredResultPlaceholderType } from "./analysis/functions.ts";


const corePrimitiveNames = new Set(["string", "number", "bool", "null", "unknown", "Duration"]);
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

export function isCorePrimitiveName(name: string): boolean {
  return corePrimitiveNames.has(name);
}

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

/**
 * D115 §三: the union of the twelve narrow faces the expression cluster
 * declares. `Analyzer.expressionHost` builds one object that satisfies it; the
 * two `Pick`s below name the halves that object is composed from, so each half
 * is checked against the same declarations rather than against an inferred
 * object type.
 */
type ExpressionHostFace = AssignabilityHost & AssignmentAnalysisHost & BinaryExpressionsHost
  & ContextualTypingHost & EqualityRulesHost & ExpressionGuidanceHost & IdentifierExpressionsHost
  & LiteralExpressionsHost & OperatorExpressionsHost & RecordProjectionsHost
  & SemanticIndexRecorderHost & TextConversionHost;

/** Everything the cluster asks this analyzer to answer. */
type ExpressionQueryFace = Pick<ExpressionHostFace,
  "allowBareGenericClassName" | "assignedFactDomain" | "asyncResultSpellingGuidance" | "awaitedOperandContext" |
  "bindingScopeDepth" | "boundMethodRecordGuidance" | "boundOf" | "boundaryValidationGuidance" | "builtin" |
  "carriedOwnedResource" | "classInfo" | "coalescingFallbackContext" | "coalescingSubjectContext" |
  "collectionBridgeGuidance" | "combineNarrowings" | "concreteCallableFor" | "contextualCollectionType" |
  "contextualObjectType" | "contextuallyAssignable" | "dataFieldIsReadonly" | "displayExternalClasses" |
  "enumSingletonCellGuidance" | "enumTargetOfValidatorObject" | "enumWireValuesOf" | "equalityOperandMayBeNaN" |
  "expandAliases" | "extensionTextForm" | "fieldsOf" | "findField" | "findGetter" | "findMethod" |
  "findStaticField" | "findStaticGetter" | "findStaticMethod" | "inModuleInitializationPosition" |
  "inferConditionWithNarrowings" | "inferExpression" | "inferMember" | "inferNarrowedExpression" |
  "inferredOrAnalyze" | "instantiateGenericCallableHere" | "invalidExtensionAwaitContext" |
  "invalidExtensionAwaitMessage" | "isAssignableHere" | "isSubclassOf" | "isTextConvertibleHere" |
  "iterationGuidance" | "iterationSource" | "listMember" | "lookup" | "lookupMemberNarrowingEntry" | "mapMember" |
  "narrowingFor" | "negativeNarrowingFor" | "numberMember" | "optionalExecutionNarrowings" | "planNamedArguments"
  | "privateFieldForAccess" | "privateMethodForAccess" | "readonlyDataViewOf" | "readonlyFieldsOf" |
  "readonlyProjectionGuidance" | "resolveAnnotation" | "resolveNamedClasses" | "retiredNamespaceOwning" |
  "runtimeTypeObjectValue" | "semanticMembersOf" | "setMember" | "stableMemberAccessPath" | "stringMember" |
  "survivingNarrowings" | "unavailableSelfGuidance" | "validateTypeReference" | "widenAggregateSingleton">;

/** Everything it tells this analyzer: a diagnostic, an advisory, a lowering fact, a flow fact. */
type ExpressionReportFace = Pick<ExpressionHostFace,
  "adviseManualMappedRecordProjection" | "adviseManualRecordProjection" | "adviseNegativeLiteralModulo" |
  "adviseRedundantObjectProperty" | "adviseTupleShapedListLiteral" | "analyzeIsolatedFlow" |
  "applyFlowInvalidations" | "applyNarrowings" | "checkShadowedRead" | "enterScope" | "establishAssignedFact" |
  "establishAssignedMemberFact" | "exitScope" | "invalidateAliasableMemberNarrowings" |
  "invalidateAssignmentNarrowings" | "invalidateShadowedNarrowings" | "noteGenericApplications" |
  "recordFlowFactOrigin" | "recordInitializationImportRead" | "recordMember" | "recordProjectionShape" |
  "recordSemanticExpression" | "rejectDisjointEnumTest" | "rejectErasedRuntimeCheck" |
  "rejectFreshCollectionEquality" | "rejectFreshCollectionProbe" | "rejectOwnedResourceEscape" |
  "reportPromiseResolutionHazard" | "reportUnresolvedName" | "requireAssignable" | "requireCondition" |
  "requireIntersectingEquality" | "requireMembershipIntersection" | "requireOrderedComparison" |
  "snapshotFlowFacts" | "typeError" | "withTemporaryNarrowings">;

export class Analyzer implements TypeEnvironment {
  protected readonly diagnostics: Diagnostic[] = [];
  protected readonly advisories: Advisory[] = [];
  private readonly advisedIdentities = new Set<string>();
  private readonly namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly namedTypeReadonlyFields = new Map<string, ReadonlySet<string>>();
  private readonly namedTypeIdentities = new Map<string, string>();
  /** Direct record bases by local name or canonical identity. Field tables remain flattened separately. */
  private readonly namedTypeBases = new Map<string, ValueType>();
  /** Fields contributed by a base, used to reject redeclaration in the child body. */
  private readonly inheritedTypeFields = new WeakMap<TypeDeclaration, ReadonlySet<string>>();
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
  /**
   * D55 rule 120 layer two: every class instantiation seen, by identity,
   * waiting for its member table to be asked for. It is the class-side twin of
   * `genericApplications` and is read only through `classInfo`, so no lookup
   * can find a generic class's members unsubstituted.
   */
  private readonly classApplications = new Map<string, GenericApplication>();
  /** Built instantiations, by identity. Kept apart from `this.classes` so no declaration roster ever sees one. */
  private readonly classInstantiations = new Map<string, ClassInfo>();
  /** The declarations behind the class entries, for the type parameters a member is checked under. */
  private readonly classDeclarations = new Map<string, ClassDeclaration>();
  /** Whether `registerClassShapes` has run, so an instantiation built before it is never cached. */
  private classShapesRegistered = false;
  /**
   * The `is`/`case` type syntaxes a bare generic class name may stand in. The
   * runtime check is `instanceof`, which knows nothing about type arguments, so
   * `is Stack` is the whole of what can be asked there — while a type position
   * still refuses the bare name for having no arity (D55 rule 126).
   */
  private readonly bareGenericClassPositions = new WeakSet<TypeSyntax>();
  /** Calls whose written `<...>` VEL2031 already reported, so no second report names the same mistake. */
  private readonly typeArgumentsRemovedCalls = new Set<string>();
  /**
   * While a static member of a generic class is being read: the class's type
   * parameter names. A static member belongs to the class, not to an
   * instantiation, so naming one there is refused where it is written.
   */
  private staticMemberTypeParameters: { readonly className: string; readonly names: ReadonlySet<string> } | null = null;
  private readonly classDisplayNames = new Map<string, string>();
  private readonly externModules = new Map<string, ReadonlyMap<string, ValueType>>();
  private readonly externTypeImports = new Map<string, ValueType>();
  private readonly externClassDeclarations = new Map<string, ReadonlySet<string>>();
  private readonly returnContexts: ReturnContext[] = [];
  private readonly asynchronousFunctions: boolean[] = [];
  /**
   * D114 R1a: the side tables the analyzer records for the emitter — what each
   * span lowers to. They are the analyzer's half of `LoweringHints`, so they
   * live together in one collaborator rather than among the analyzer's own
   * inference state. The three `protected` tables the Web analyzer writes
   * (`enumValueBindings`, `extensionLiterals`, `extensionCalls`) stay fields of
   * this class: they are part of the subclass seam.
   */
  private readonly lowering = new LoweringRecorder();
  /**
   * D114 R1a: the A roster — every `advise*` proof — lives in one collaborator.
   * It reaches this analyzer only through the `AdvisoryHost` interface built in
   * the constructor, which is the exact list of what the proofs depend on.
   */
  private readonly advisoryRoster: Advisories;
  /**
   * D114 R1b: the compiler-owned collection vocabulary — what a List, Map, Set
   * or Record publishes, what one call of a member means, and the migration off
   * the `velar/collections` module those members replaced. It reaches this
   * analyzer only through the `CollectionInferenceHost` interface built in the
   * constructor, which is the exact list of what the cluster depends on.
   */
  private readonly collections: CollectionInference;
  /**
   * D114 R1b: everything that happens between a call's parentheses — the
   * callee's kind, the generic solver, the standard-module intrinsics and the
   * named-argument plan. It reaches this analyzer only through the
   * `CallInferenceHost` interface built in the constructor.
   */
  private readonly calls: CallInference;
  /**
   * D114 R1b: what a receiver publishes under a name — every member access, and
   * the checked value methods a string or a number carries. It reaches this
   * analyzer only through the `MemberAccessHost` interface built in the
   * constructor.
   */
  private readonly members: MemberAccess;
  /**
   * D114 R1d: the flow cluster. `flowFacts` is the store — what every binding
   * and member path is believed to hold, and the snapshots one moment is
   * compared against another with; `narrowing` is what a check proves and what
   * a write retracts; `loops` is the back-edge pass; `flowMerge` is what a
   * construct's arms agree on. All four are built over one shared host object,
   * because the four halves call each other as much as they call the analyzer.
   */
  /**
   * D114 R1d: the declaration cluster — what a `type`, alias, `enum` or
   * generic template name means, and whether a written type reference is
   * legal. The tables these read (`namedTypes`, `typeAliases`, `enums`,
   * `genericTypes`) stay fields of this class, because the member, call and
   * class clusters read them too; they arrive through the shared host.
   */
  /**
   * D114 R1d: the class cluster — the shape a class name stands for, its
   * members, what it inherits, and the `@dispose` / `@iterate` roles it may
   * declare. The tables stay fields of this class; the collaborators read
   * them through the shared class host.
   */
  /**
   * D114 R1d: the module cluster — what a module brings in, what it
   * publishes, and which reads run while the module itself evaluates.
   */
  /**
   * D114 R1d: the scope stack — the chain a lookup walks, the roster behind
   * "did you mean", and the rules a declaration passes to enter a scope.
   */
  /**
   * D114 R1d: `match` — the arms, the pattern walk, the coverage ledger and
   * the exhaustiveness report.
   */
  private readonly matching: MatchAnalysis;
  private readonly matchCoverage: MatchCoverageRules;
  private readonly scopeStack: ScopeStack;
  private readonly moduleImports: ModuleImports;
  private readonly moduleExports: ModuleExports;
  private readonly moduleInitialization: ModuleInitialization;
  private readonly classRegistry: ClassRegistry;
  private readonly classMembers: ClassMembers;
  private readonly classInheritance: ClassInheritance;
  private readonly classRoles: ClassRoles;
  private readonly typeRecords: TypeRecords;
  private readonly aliases: TypeAliases;
  private readonly enumDeclarations: EnumDeclarations;
  private readonly generics: GenericDeclarations;
  private readonly typeReferences: TypeReferences;
  private readonly flowFacts: FlowFacts;
  private readonly narrowing: Narrowing;
  private readonly locations: MemberLocations;
  private readonly loops: LoopFlow;
  private readonly flowMerge: FlowMerge;
  private readonly reportedBoundViolations = new Set<string>();
  /** D51 rule 101: arrows that read a `using`-owned binding, by arrow span. */
  private readonly arrowOwnedCaptures = new Map<string, { readonly handle: string; readonly depth: number }>();
  private readonly arrowCaptureFrames: { captured: { readonly handle: string; readonly depth: number } | null }[] = [];
  private readonly declaredTestTitles = new Set<string>();
  private readonly javaScriptBindings = new Set<string>();
  private readonly constructorFieldInitializations = new Set<number>();
  // A literal-true loop with no reachable break is a synchronization boundary:
  // control cannot continue after it even when the body itself can iterate.
  private readonly nonFallthroughWhileStatements = new Set<number>();
  private readonly reportedPromiseResolutionHazards = new Set<string>();
  // D45 rule 75: the only expression positions where a class name may appear —
  // as the callee of a direct call and as the receiver of a member access.
  // Everything else rejects the class name as a value.
  private readonly callExpressionCallees = new Set<string>();
  private readonly memberAccessReceivers = new Set<string>();
  // D44 rule 72: memoized per-identity verdicts for the deep readonly class
  // scan. Only cycle-free computations are cached; a verdict found through a
  // cycle cut stays local to that traversal.
  private readonly readonlyClassScanVerdicts = new Map<string, { readonly suffix: string; readonly className: string } | null>();
  protected readonly reactiveBindings = new Map<string, "state">();
  protected readonly enumValueBindings = new Map<number, string>();
  protected readonly extensionLiterals = new Map<string, string>();
  protected readonly extensionCalls: Map<string, string> = new ExtensionCallMap(
    (message, span) => this.diagnostics.push(diagnostic("VEL9004", message, span)),
  );
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
  private readonly promiseInitializerBindings = new WeakSet<Binding>();
  private readonly testExpectOperands = new Map<string, ValueType>();
  /**
   * D114 F2: the migration off the import spellings a permanent namespace
   * replaced — the reads it has to rewrite, and the reports it earns. Its own
   * module under D115 §三; it reaches this analyzer only through the two names
   * `PermanentNamespaceImportHost` declares.
   */
  private readonly namespaceImports = new PermanentNamespaceImports({
    diagnostics: this.diagnostics,
    renderNamedImport: (source, specifiers) => this.moduleImports.renderNamedImport(source, specifiers),
  });


  /**
   * D115 §三: the expression cluster. Twelve collaborators own what an
   * expression means — the literals, the operators, the binary rules, the
   * equality and ordering domains, contextual typing, assignability, the
   * guidance a refusal ends with, an identifier read, the text conversion, the
   * record projections, an assignment, and the semantic index the editor reads.
   * All twelve reach this analyzer through one object, `expressionHost()`,
   * whose members are the union of the narrow faces each of them declares.
   */
  private readonly assignability: Assignability;
  private readonly assignment: AssignmentAnalysis;
  private readonly binary: BinaryExpressions;
  private readonly contextual: ContextualTyping;
  private readonly equality: EqualityRules;
  private readonly guidance: ExpressionGuidance;
  private readonly identifiers: IdentifierExpressions;
  private readonly literals: LiteralExpressions;
  private readonly operators: OperatorExpressions;
  private readonly projections: RecordProjections;
  private readonly semanticIndex: SemanticIndexRecorder;
  private readonly text: TextConversion;

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    this.analysisExtensions = extensions;
    this.sourceText = context.sourceText ?? "";
    this.advisoryRoster = new Advisories(this.advisoryHost());
    this.collections = new CollectionInference(this.collectionHost());
    this.calls = new CallInference(this.callHost());
    this.members = new MemberAccess(this.memberHost());
    this.scopeStack = new ScopeStack(this.scopeHost());
    const matchHost = this.matchHost();
    this.matchCoverage = new MatchCoverageRules(matchHost);
    this.matching = new MatchAnalysis(matchHost);
    const moduleHost = this.moduleHost();
    this.moduleImports = new ModuleImports(moduleHost);
    this.moduleExports = new ModuleExports(moduleHost);
    this.moduleInitialization = new ModuleInitialization(moduleHost);
    const classHost = this.classHost();
    this.classRegistry = new ClassRegistry(classHost);
    this.classMembers = new ClassMembers(classHost);
    this.classInheritance = new ClassInheritance(classHost);
    this.classRoles = new ClassRoles(classHost);
    const declarationHost = this.declarationHost();
    this.typeRecords = new TypeRecords(declarationHost);
    this.aliases = new TypeAliases(declarationHost);
    this.enumDeclarations = new EnumDeclarations(declarationHost);
    this.generics = new GenericDeclarations(declarationHost);
    this.typeReferences = new TypeReferences(declarationHost);
    const flowHost = this.flowHost();
    this.flowFacts = new FlowFacts(flowHost);
    this.locations = new MemberLocations(flowHost);
    this.narrowing = new Narrowing(flowHost);
    this.loops = new LoopFlow(flowHost);
    this.flowMerge = new FlowMerge(flowHost);
    const expressionHost = this.expressionHost();
    this.assignability = new Assignability(expressionHost);
    this.assignment = new AssignmentAnalysis(expressionHost);
    this.binary = new BinaryExpressions(expressionHost);
    this.contextual = new ContextualTyping(expressionHost);
    this.equality = new EqualityRules(expressionHost);
    this.guidance = new ExpressionGuidance(expressionHost);
    this.identifiers = new IdentifierExpressions(expressionHost);
    this.literals = new LiteralExpressions(expressionHost);
    this.operators = new OperatorExpressions(expressionHost);
    this.projections = new RecordProjections(expressionHost);
    this.semanticIndex = new SemanticIndexRecorder(expressionHost);
    this.text = new TextConversion(expressionHost);
    this.executeMain = context.executeMain !== false;
    this.inferredFunctionResultSeeds = context.inferredFunctionResults ?? new Map();
    this.finalizeFunctionResultInference = context.finalizeFunctionResultInference === true;
    this.registerBuiltinErrorClasses();
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
    for (const type of this.importBindings.values()) this.generics.noteGenericApplications(type);
    for (const type of this.dynamicImports.values()) this.generics.noteGenericApplications(type);
    for (const type of this.typeAliases.values()) this.generics.noteGenericApplications(type);
    for (const fields of this.namedTypes.values()) for (const type of fields.values()) this.generics.noteGenericApplications(type);
    for (const info of this.classes.values()) {
      for (const field of info.fields.values()) this.generics.noteGenericApplications(field.type);
      for (const type of info.methods.values()) this.generics.noteGenericApplications(type);
      for (const field of info.staticFields.values()) this.generics.noteGenericApplications(field.type);
      for (const type of info.staticMethods.values()) this.generics.noteGenericApplications(type);
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
   * The error classes the language itself raises, registered before any source
   * is read so `catch`, `is` and construction all see them.
   *
   * D114 R1d: lifted out of the constructor unchanged during the flow-cluster
   * move. The constructor gained the four flow collaborators, and D115 §一.1
   * caps a function at 120 lines; this block is the part of it that is a table
   * rather than wiring, so it is what left.
   */
  private registerBuiltinErrorClasses(): void {
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
  }

  /** D114 R1a: what the A roster is allowed to ask of this analyzer. */
  private advisoryHost(): AdvisoryHost {
    return {
      sourceText: this.sourceText,
      analysisExtensions: this.analysisExtensions,
      typeAliases: this.typeAliases,
      lowering: this.lowering,
      advise: (code, message, adviceSpan, fix) => { this.advise(code, message, adviceSpan, fix); },
      expandAliases: (type) => this.expandAliases(type),
      inferredExpressionType: (expression) => this.inferredExpressionType(expression),
      lookup: (name) => this.lookup(name),
      collectPatternNames: (pattern, add) => { this.scopeStack.collectPatternNames(pattern, add); },
      commentPreservingMechanicalFix: (rewriteSpan, replacement, title) => this.commentPreservingMechanicalFix(rewriteSpan, replacement, title),
      canonicalCollectionMemberReadIsStable: (expression) => this.canonicalCollectionMemberReadIsStable(expression),
      recordProjectionShape: (type) => this.projections.recordProjectionShape(type),
      stableDataMember: (objectExpression, property) => this.locations.stableDataMember(objectExpression, property),
    };
  }

  /** D114 R1b: what the collection cluster is allowed to ask of this analyzer. */
  private collectionHost(): CollectionInferenceHost {
    return {
      sourceText: this.sourceText,
      diagnostics: this.diagnostics,
      lowering: this.lowering,
      semanticExpressionOwners: this.semanticExpressionOwners,
      typeError: (message, errorSpan, fix) => { this.typeError(message, errorSpan, fix); },
      requireAssignable: (actual, expected, valueSpan) => { this.requireAssignable(actual, expected, valueSpan); },
      requireMembershipIntersection: (probe, domain, probeSpan, operation) => this.equality.requireMembershipIntersection(probe, domain, probeSpan, operation),
      rejectFreshCollectionProbe: (probe, operation, probes) => this.equality.rejectFreshCollectionProbe(probe, operation, probes),
      rejectCollidingKeyDomain: (keySource, keySpan, position) => { this.equality.rejectCollidingKeyDomain(keySource, keySpan, position); },
      expandAliases: (type) => this.expandAliases(type),
      readonlyDataViewOf: (type) => this.readonlyDataViewOf(type),
      inferExpression: (expression, contextualType) => this.inferExpression(expression, contextualType),
      inferredOrAnalyze: (expression) => this.inferredOrAnalyze(expression),
      inferredExpressionType: (expression) => this.inferredExpressionType(expression),
      recordSemanticExpression: (expression, type) => { this.semanticIndex.recordSemanticExpression(expression, type); },
      concreteCallableFor: (actual, expected, errorSpan) => this.assignability.concreteCallableFor(actual, expected, errorSpan),
      isAssignableHere: (actual, expected) => isAssignable(actual, expected, this),
      checkArguments: (arguments_, parameters, callSpan, requiredParameters) => { this.checkArguments(arguments_, parameters, callSpan, requiredParameters); },
      planNamedArguments: (arguments_, argumentNames, parameters, parameterNames, requiredParameters, callSpan, rest) =>
        this.calls.planNamedArguments(arguments_, argumentNames, parameters, parameterNames, requiredParameters, callSpan, rest),
      orderedTypeCategory: (source) => this.equality.orderedTypeCategory(source),
      unorderedTypeGuidance: (...types) => this.equality.unorderedTypeGuidance(...types),
      renderNamedImport: (source, specifiers) => this.moduleImports.renderNamedImport(source, specifiers),
    };
  }

  /** D114 R1b: what the call cluster is allowed to ask of this analyzer. */
  private callHost(): CallInferenceHost {
    // A call reads the analyzer's live walk state — the class under analysis,
    // the constructor and field-initializer depths, the sanctioned `super(...)`
    // site — so those arrive as getters rather than as values captured here.
    const analyzer = this;
    return {
      get allowedSuperCall() { return analyzer.allowedSuperCall; },
      analysisExtensions: analyzer.analysisExtensions,
      boundaryReceiverText: (expression) => analyzer.guidance.boundaryReceiverText(expression),
      callExpressionCallees: analyzer.callExpressionCallees,
      checkArguments: (arguments_, parameters, callSpan, requiredParameters, rest, argumentNames, parameterNames) => { analyzer.checkArguments(arguments_, parameters, callSpan, requiredParameters, rest, argumentNames, parameterNames); },
      checkTestMatcherComparand: (calleeExpression, arguments_) => { analyzer.equality.checkTestMatcherComparand(calleeExpression, arguments_); },
      get classFieldInitializerDepth() { return analyzer.classFieldInitializerDepth; },
      classInfo: (key) => analyzer.classRegistry.classInfo(key),
      classes: analyzer.classes,
      collections: analyzer.collections,
      commentPreservingMechanicalFix: (rewriteSpan, replacement, title) => analyzer.commentPreservingMechanicalFix(rewriteSpan, replacement, title),
      concreteCallableFor: (actual, expected, errorSpan) => analyzer.assignability.concreteCallableFor(actual, expected, errorSpan),
      get constructorDepth() { return analyzer.constructorDepth; },
      contextualCollectionType: (type) => analyzer.contextual.contextualCollectionType(type),
      get currentClass() { return analyzer.currentClass; },
      diagnostics: analyzer.diagnostics,
      enumMeetDomain: (left, right) => analyzer.equality.enumMeetDomain(left, right),
      equalityGuidance: (leftSource, rightSource) => analyzer.equality.equalityGuidance(leftSource, rightSource),
      equalityTypesIntersect: (leftSource, rightSource) => analyzer.equality.equalityTypesIntersect(leftSource, rightSource),
      equalsDomainViolation: (source, seen) => analyzer.equality.equalsDomainViolation(source, seen),
      expandAliases: (type, seen) => analyzer.expandAliases(type, seen),
      fieldsOf: (identity) => analyzer.fieldsOf(identity),
      formReadField: (name, source, fieldSpan) => analyzer.formReadField(name, source, fieldSpan),
      inAnnotationFreeHead: () => analyzer.inAnnotationFreeHead(),
      inModuleInitializationPosition: () => analyzer.inModuleInitializationPosition(),
      inferExpression: (expression, contextualType) => analyzer.inferExpression(expression, contextualType),
      inferExtensionCall: (_callee, _arguments, _argumentNames, _callSpan) => analyzer.inferExtensionCall(_callee, _arguments, _argumentNames, _callSpan),
      inferPrimitiveCall: (member, arguments_, argumentNames, callSpan) => analyzer.members.inferPrimitiveCall(member, arguments_, argumentNames, callSpan),
      inferRecordFromCall: (member, sourceArguments, argumentNames, callSpan) => analyzer.projections.inferRecordFromCall(member, sourceArguments, argumentNames, callSpan),
      inferRecordMapFromCall: (member, sourceArguments, argumentNames, callSpan) => analyzer.projections.inferRecordMapFromCall(member, sourceArguments, argumentNames, callSpan),
      inferredExpressionType: (expression) => analyzer.inferredExpressionType(expression),
      get instanceFieldInitializerDepth() { return analyzer.instanceFieldInitializerDepth; },
      invalidDeclaredTypes: analyzer.invalidDeclaredTypes,
      invalidateMutableCollectionCallReceiver: (callee) => { analyzer.locations.invalidateMutableCollectionCallReceiver(callee); },
      isHttpFormBody: (source) => analyzer.isHttpFormBody(source),
      isSubclassOf: (actual, expected) => analyzer.isSubclassOf(actual, expected),
      iterationGuidance: (type) => analyzer.classRoles.iterationGuidance(type),
      iterationSource: (expression, type) => analyzer.classRoles.iterationSource(expression, type),
      javaScriptBindings: analyzer.javaScriptBindings,
      jsonSerializable: (source, seen) => analyzer.jsonSerializable(source, seen),
      lookup: (name) => analyzer.lookup(name),
      lowering: analyzer.lowering,
      memberAccessReceivers: analyzer.memberAccessReceivers,
      namedTypes: analyzer.namedTypes,
      noteGenericApplications: (type, seen) => { analyzer.generics.noteGenericApplications(type, seen); },
      optionalExecutionNarrowings: (expression) => analyzer.narrowing.optionalExecutionNarrowings(expression),
      readonlyDataViewOf: (type) => analyzer.readonlyDataViewOf(type),
      recordMemberAccessProperty: (expression) => { analyzer.members.recordMemberAccessProperty(expression); },
      recordRuntimeObjectShape: (expression, owner) => { analyzer.literals.recordRuntimeObjectShape(expression, owner); },
      rejectCollidingKeyDomain: (keySource, span, position) => { analyzer.equality.rejectCollidingKeyDomain(keySource, span, position); },
      rejectDisjointEnumValidatorProbe: (calleeExpression, arguments_) => { analyzer.equality.rejectDisjointEnumValidatorProbe(calleeExpression, arguments_); },
      reportPromiseCarrierHazard: (type, errorSpan) => { analyzer.reportPromiseCarrierHazard(type, errorSpan); },
      reportPromiseResolutionHazard: (type, errorSpan) => { analyzer.reportPromiseResolutionHazard(type, errorSpan); },
      requireAssignable: (actual, expected, valueSpan) => { analyzer.requireAssignable(actual, expected, valueSpan); },
      requireTextConvertible: (type, span, site) => { analyzer.text.requireTextConvertible(type, span, site); },
      runtimeTypeObjectValue: (type) => analyzer.runtimeTypeObjectValue(type),
      satisfiesBound: (type, bound) => analyzer.satisfiesBound(type, bound),
      sourceText: analyzer.sourceText,
      testExpectOperands: analyzer.testExpectOperands,
      typeAliases: analyzer.typeAliases,
      typeArgumentsRemovedCalls: analyzer.typeArgumentsRemovedCalls,
      typeError: (message, errorSpan, fix) => { analyzer.typeError(message, errorSpan, fix); },
      typesIntersect: (leftSource, rightSource, enumStringVeto) => analyzer.equality.typesIntersect(leftSource, rightSource, enumStringVeto),
      withTemporaryNarrowings: (narrowed, narrowingSpan, analyze) => analyzer.narrowing.withTemporaryNarrowings(narrowed, narrowingSpan, analyze),
      isAssignableHere: (actual, expected) => isAssignable(actual, expected, analyzer),
    };
  }

  /** D114 R1b: what the member cluster is allowed to ask of this analyzer. */
  /** The one object the match cluster is handed; every entry is a live read. */
  private matchHost(): MatchAnalysisHost & MatchCoverageHost {
    const analyzer = this;
    return {
      get coverage() { return analyzer.matchCoverage; },
      isAssignableHere: (actual, expected) => isAssignable(actual, expected, analyzer),
      allowBareGenericClassName: (reference) => { analyzer.allowBareGenericClassName(reference); },
      analyzeStatements: (statements) => { analyzer.analyzeStatements(statements); },
      applyNarrowings: (narrowed, narrowingSpan) => { analyzer.applyNarrowings(narrowed, narrowingSpan); },
      get classRegistry() { return analyzer.classRegistry; },
      get classes() { return analyzer.classes; },
      declareBinding: (name, mutable, type, declarationSpan, internal, declaredType, importSource, typeNamePosition) => { analyzer.declareBinding(name, mutable, type, declarationSpan, internal, declaredType, importSource, typeNamePosition); },
      get diagnostics() { return analyzer.diagnostics; },
      enterScope: () => { analyzer.enterScope(); },
      get enums() { return analyzer.enums; },
      equalityMayCompareNaN: (type) => analyzer.equality.equalityMayCompareNaN(type),
      equalityOperandMayBeNaN: (expression, type) => analyzer.equality.equalityOperandMayBeNaN(expression, type),
      erasedClassCheckType: (source, checked) => analyzer.erasedClassCheckType(source, checked),
      exitScope: () => { analyzer.exitScope(); },
      expandAliases: (type, seen) => analyzer.expandAliases(type, seen),
      fieldsOf: (identity) => analyzer.fieldsOf(identity),
      get flowFacts() { return analyzer.flowFacts; },
      get flowMerge() { return analyzer.flowMerge; },
      inferExpression: (expression, contextualType) => analyzer.inferExpression(expression, contextualType),
      get inferredExpressionTypes() { return analyzer.inferredExpressionTypes; },
      inferredOrAnalyze: (expression) => analyzer.inferredOrAnalyze(expression),
      isSubclassOf: (className, base) => analyzer.isSubclassOf(className, base),
      lookup: (name) => analyzer.lookup(name),
      get lowering() { return analyzer.lowering; },
      get namedTypes() { return analyzer.namedTypes; },
      get narrowing() { return analyzer.narrowing; },
      get nonFallthroughWhileStatements() { return analyzer.nonFallthroughWhileStatements; },
      get primitiveNames() { return analyzer.primitiveNames; },
      readonlyDataViewOf: (type) => analyzer.readonlyDataViewOf(type),
      readonlyFieldsOf: (identity) => analyzer.readonlyFieldsOf(identity),
      rejectErasedRuntimeCheck: (checked, errorSpan) => analyzer.rejectErasedRuntimeCheck(checked, errorSpan),
      resolveAnnotation: (reference) => analyzer.resolveAnnotation(reference),
      get semanticBindingEntryOwners() { return analyzer.semanticBindingEntryOwners; },
      get typeAliases() { return analyzer.typeAliases; },
      typeError: (message, errorSpan, fix) => { analyzer.typeError(message, errorSpan, fix); },
      validateTypeReference: (reference, resolve) => analyzer.validateTypeReference(reference, resolve),
    };
  }

  /** The one object the scope stack is handed; every entry is a live read. */
  private scopeHost(): ScopeStackHost {
    const analyzer = this;
    return {
      get diagnostics() { return analyzer.diagnostics; },
      expandAliases: (type, seen) => analyzer.expandAliases(type, seen),
      get extensionGlobals() { return analyzer.extensionGlobals; },
      get extensionReservedBindings() { return analyzer.extensionReservedBindings; },
      fieldsOf: (identity) => analyzer.fieldsOf(identity),
      get flowFrameDepth() { return analyzer.flowFrameDepth; },
      functionResultKey: (statement) => analyzer.functionResultKey(statement),
      get functionResultKeys() { return analyzer.functionResultKeys; },
      functionType: (statement, classParameters) => analyzer.functionType(statement, classParameters),
      get globalGuidance() { return analyzer.globalGuidance; },
      get importBindings() { return analyzer.importBindings; },
      get importedBindingOrigins() { return analyzer.importedBindingOrigins; },
      get lowering() { return analyzer.lowering; },
      get modulePath() { return analyzer.modulePath; },
      get namespaceImports() { return analyzer.namespaceImports; },
      get predeclared() { return analyzer.predeclared; },
      prescanExtensionScopeDeclaration: (_statement) => analyzer.prescanExtensionScopeDeclaration(_statement),
      readonlyDataViewOf: (type) => analyzer.readonlyDataViewOf(type),
      readonlyFieldsOf: (identity) => analyzer.readonlyFieldsOf(identity),
      recordSemanticBinding: (key, type) => { analyzer.semanticIndex.recordSemanticBinding(key, type); },
      get scopedGlobalGuidance() { return analyzer.scopedGlobalGuidance; },
      get semanticBindingEntryOwners() { return analyzer.semanticBindingEntryOwners; },
      typeError: (message, errorSpan, fix) => { analyzer.typeError(message, errorSpan, fix); },
    };
  }

  /**
   * The one object the three module collaborators are handed.
   */
  private moduleHost(): ModuleImportsHost & ModuleExportsHost & ModuleInitializationHost {
    const analyzer = this;
    return {
      get arrowDeferredFrames() { return analyzer.arrowDeferredFrames; },
      builtin: (name) => analyzer.scopeStack.builtin(name),
      get classDisplayNames() { return analyzer.classDisplayNames; },
      get classRegistry() { return analyzer.classRegistry; },
      get classes() { return analyzer.classes; },
      collectPatternNames: (pattern, add) => { analyzer.scopeStack.collectPatternNames(pattern, add); },
      get declaredNames() { return analyzer.scopeStack.declaredNames; },
      get deferredReadFrames() { return analyzer.deferredReadFrames; },
      get diagnostics() { return analyzer.diagnostics; },
      get enums() { return analyzer.enums; },
      expandAliases: (type, seen) => analyzer.expandAliases(type, seen),
      get exportPositionCandidates() { return analyzer.exportPositionCandidates; },
      get externClassDeclarations() { return analyzer.externClassDeclarations; },
      get externModules() { return analyzer.externModules; },
      get externTypeImports() { return analyzer.externTypeImports; },
      get genericTypes() { return analyzer.genericTypes; },
      guidanceForGlobal: (name) => analyzer.scopeStack.guidanceForGlobal(name),
      get importBindings() { return analyzer.importBindings; },
      get importedBindingOrigins() { return analyzer.importedBindingOrigins; },
      get importedBindingSources() { return analyzer.importedBindingSources; },
      inModuleInitializationPosition: () => analyzer.inModuleInitializationPosition(),
      get initializationImportReadSites() { return analyzer.initializationImportReadSites; },
      get initializationLocalCalls() { return analyzer.initializationLocalCalls; },
      get invalidExternTypeReferences() { return analyzer.invalidExternTypeReferences; },
      get localFunctionFrames() { return analyzer.localFunctionFrames; },
      lookup: (name) => analyzer.lookup(name),
      get namedTypeIdentities() { return analyzer.namedTypeIdentities; },
      get namedTypes() { return analyzer.namedTypes; },
      resolveAnnotation: (reference) => analyzer.resolveAnnotation(reference),
      resolvedAsyncResult: (type) => analyzer.resolvedAsyncResult(type),
      get retiredNamespaceUses() { return analyzer.retiredNamespaceUses; },
      get retiredNamespaces() { return analyzer.retiredNamespaces; },
      get scopes() { return analyzer.scopeStack.scopes; },
      get typeAliases() { return analyzer.typeAliases; },
      typeError: (message, errorSpan, fix) => { analyzer.typeError(message, errorSpan, fix); },
      typeParameterBoundVector: (declarations) => analyzer.typeParameterBoundVector(declarations),
      typeParameterFrame: (declarations) => analyzer.typeParameterFrame(declarations),
      get typeParameterFrames() { return analyzer.typeParameterFrames; },
      get typeReferences() { return analyzer.typeReferences; },
      withTypeParameterFrame: (frame, action) => analyzer.withTypeParameterFrame(frame, action),
    };
  }

  /**
   * The one object the four class collaborators are handed. Every entry is a
   * live read of the analyzer: the walk depths, the class under analysis and
   * the `super` context all move while a class body is analyzed.
   */
  private classHost(): ClassRegistryHost & ClassMembersHost & ClassInheritanceHost & ClassRolesHost {
    const analyzer = this;
    return {
      get allowedSuperCall() { return analyzer.allowedSuperCall; },
      set allowedSuperCall(value) { analyzer.allowedSuperCall = value; },
      analyzeClassDispose: (statement, block) => { analyzer.classRoles.analyzeClassDispose(statement, block); },
      analyzeClassIterate: (statement, block, baseName) => { analyzer.classRoles.analyzeClassIterate(statement, block, baseName); },
      analyzeFunctionDeclaration: (statement, className, method, declareSelf, forceAsynchronous, declarationKind) => { analyzer.analyzeFunctionDeclaration(statement, className, method, declareSelf, forceAsynchronous, declarationKind); },
      analyzeStatements: (statements) => { analyzer.analyzeStatements(statements); },
      get arrowOwnedCaptures() { return analyzer.arrowOwnedCaptures; },
      asyncResultContainsPromise: (type) => analyzer.asyncResultContainsPromise(type),
      get asynchronousFunctions() { return analyzer.asynchronousFunctions; },
      blockAlwaysReturns: (statements) => analyzer.matchCoverage.blockAlwaysReturns(statements),
      builtin: (name) => analyzer.scopeStack.builtin(name),
      checkDisposalChain: (statement, baseName) => { analyzer.classRoles.checkDisposalChain(statement, baseName); },
      checkTypeParameterDeclarations: (declarations) => { analyzer.checkTypeParameterDeclarations(declarations); },
      classApplicationFor: (receiverKey, declarationKey) => analyzer.classRegistry.classApplicationFor(receiverKey, declarationKey),
      get classApplications() { return analyzer.classApplications; },
      get classDeclarations() { return analyzer.classDeclarations; },
      get classFieldInitializerDepth() { return analyzer.classFieldInitializerDepth; },
      set classFieldInitializerDepth(value) { analyzer.classFieldInitializerDepth = value; },
      classInfo: (key) => analyzer.classRegistry.classInfo(key),
      get classInstantiations() { return analyzer.classInstantiations; },
      classMethodType: (statement, method) => analyzer.classRegistry.classMethodType(statement, method),
      get classShapesRegistered() { return analyzer.classShapesRegistered; },
      set classShapesRegistered(value) { analyzer.classShapesRegistered = value; },
      get classes() { return analyzer.classes; },
      get constructorDepth() { return analyzer.constructorDepth; },
      set constructorDepth(value) { analyzer.constructorDepth = value; },
      get constructorFieldInitializations() { return analyzer.constructorFieldInitializations; },
      get currentClass() { return analyzer.currentClass; },
      set currentClass(value) { analyzer.currentClass = value; },
      declareBinding: (name, mutable, type, declarationSpan, internal, declaredType, importSource, typeNamePosition) => { analyzer.declareBinding(name, mutable, type, declarationSpan, internal, declaredType, importSource, typeNamePosition); },
      declareTypeNameBinding: (name, type, declarationSpan, position) => { analyzer.scopeStack.declareTypeNameBinding(name, type, declarationSpan, position); },
      get diagnostics() { return analyzer.diagnostics; },
      enterScope: () => { analyzer.enterScope(); },
      exitScope: () => { analyzer.exitScope(); },
      expandAliases: (type, seen) => analyzer.expandAliases(type, seen),
      get exportPositionCandidates() { return analyzer.exportPositionCandidates; },
      extensionExpressionContainsDirectAwait: (expression, contains) => analyzer.extensionExpressionContainsDirectAwait(expression, contains),
      extensionStatementContainsDirectAwait: (statement, containsExpression, containsBlock) => analyzer.extensionStatementContainsDirectAwait(statement, containsExpression, containsBlock),
      get externClassDeclarations() { return analyzer.externClassDeclarations; },
      fieldsOf: (identity) => analyzer.fieldsOf(identity),
      get finallyLoopDepths() { return analyzer.finallyLoopDepths; },
      set finallyLoopDepths(value) { analyzer.finallyLoopDepths = value; },
      findField: (className, name) => analyzer.classInheritance.findField(className, name),
      findGetter: (className, name) => analyzer.classInheritance.findGetter(className, name),
      findMethod: (className, name) => analyzer.classInheritance.findMethod(className, name),
      findStaticField: (className, name) => analyzer.classInheritance.findStaticField(className, name),
      findStaticGetter: (className, name) => analyzer.classInheritance.findStaticGetter(className, name),
      findStaticMethod: (className, name) => analyzer.classInheritance.findStaticMethod(className, name),
      get flowFrameDepth() { return analyzer.flowFrameDepth; },
      set flowFrameDepth(value) { analyzer.flowFrameDepth = value; },
      get functionDepth() { return analyzer.functionDepth; },
      set functionDepth(value) { analyzer.functionDepth = value; },
      functionType: (statement, classParameters) => analyzer.functionType(statement, classParameters),
      get generics() { return analyzer.generics; },
      get hoistedClassDeclarations() { return analyzer.hoistedClassDeclarations; },
      inferAnnotationFreeHead: (expression) => analyzer.contextual.inferAnnotationFreeHead(expression),
      inferCollectedFunctionResult: (returned, fallsThrough) => analyzer.inferCollectedFunctionResult(returned, fallsThrough),
      inferExpression: (expression, contextualType) => analyzer.inferExpression(expression, contextualType),
      inferParameterDefault: (expression, contextualType) => analyzer.inferParameterDefault(expression, contextualType),
      get inferredFunctionResultSeeds() { return analyzer.inferredFunctionResultSeeds; },
      get inferredFunctionResultTypes() { return analyzer.inferredFunctionResultTypes; },
      get instanceFieldInitializerDepth() { return analyzer.instanceFieldInitializerDepth; },
      set instanceFieldInitializerDepth(value) { analyzer.instanceFieldInitializerDepth = value; },
      get invalidExternTypeReferences() { return analyzer.invalidExternTypeReferences; },
      isSubclassOf: (actual, expected) => analyzer.classInheritance.isSubclassOf(actual, expected),
      lookup: (name) => analyzer.lookup(name),
      get loopDepth() { return analyzer.loopDepth; },
      set loopDepth(value) { analyzer.loopDepth = value; },
      get lowering() { return analyzer.lowering; },
      ownershipScopeRejection: () => analyzer.ownershipScopeRejection(),
      get predeclared() { return analyzer.predeclared; },
      get privateFields() { return analyzer.privateFields; },
      get privateGetters() { return analyzer.privateGetters; },
      get privateMethods() { return analyzer.privateMethods; },
      get privateStaticFields() { return analyzer.privateStaticFields; },
      get privateStaticGetters() { return analyzer.privateStaticGetters; },
      get privateStaticMethods() { return analyzer.privateStaticMethods; },
      reportImplicitSelfParameter: (parameters, index) => { analyzer.reportImplicitSelfParameter(parameters, index); },
      reportPromiseCarrierHazard: (type, errorSpan) => { analyzer.reportPromiseCarrierHazard(type, errorSpan); },
      reportPromiseResolutionHazard: (type, errorSpan) => { analyzer.reportPromiseResolutionHazard(type, errorSpan); },
      requireAssignable: (actual, expected, valueSpan, mutableCell) => { analyzer.requireAssignable(actual, expected, valueSpan, mutableCell); },
      resolveAnnotation: (reference) => analyzer.resolveAnnotation(reference),
      resolveExternAnnotation: (reference, source, classNames) => analyzer.moduleImports.resolveExternAnnotation(reference, source, classNames),
      resolveResult: (reference) => analyzer.resolveResult(reference),
      resolveValidatedAnnotation: (reference) => analyzer.resolveValidatedAnnotation(reference),
      resolveValidatedResult: (reference) => analyzer.resolveValidatedResult(reference),
      get returnContexts() { return analyzer.returnContexts; },
      get scopes() { return analyzer.scopeStack.scopes; },
      seededIterationInfo: (block) => analyzer.classRoles.seededIterationInfo(block),
      selfClassType: (className) => analyzer.classRegistry.selfClassType(className),
      get staticFieldInitialization() { return analyzer.staticFieldInitialization; },
      set staticFieldInitialization(value) { analyzer.staticFieldInitialization = value; },
      get staticMemberTypeParameters() { return analyzer.staticMemberTypeParameters; },
      set staticMemberTypeParameters(value) { analyzer.staticMemberTypeParameters = value; },
      substituteClassMemberType: (type, bindings) => analyzer.classRegistry.substituteClassMemberType(type, bindings),
      get superMemberContext() { return analyzer.superMemberContext; },
      set superMemberContext(value) { analyzer.superMemberContext = value; },
      typeError: (message, errorSpan, fix) => { analyzer.typeError(message, errorSpan, fix); },
      typeParameterBoundVector: (declarations) => analyzer.typeParameterBoundVector(declarations),
      typeParameterFrame: (declarations) => analyzer.typeParameterFrame(declarations),
      get typeParameterFrames() { return analyzer.typeParameterFrames; },
      get typeReferences() { return analyzer.typeReferences; },
      unimplementedAbstractMethods: (className) => analyzer.classInheritance.unimplementedAbstractMethods(className),
      get unreachableDiagnosticDepth() { return analyzer.unreachableDiagnosticDepth; },
      set unreachableDiagnosticDepth(value) { analyzer.unreachableDiagnosticDepth = value; },
      validateTypeReference: (reference, resolve) => analyzer.validateTypeReference(reference, resolve),
      withTypeParameterFrame: (frame, action) => analyzer.withTypeParameterFrame(frame, action),
    };
  }

  /**
   * The one object the five declaration collaborators are handed. Every entry
   * is a live read: the tables fill while the module is being analyzed.
   */
  private declarationHost(): TypeRecordsHost & TypeAliasesHost & EnumDeclarationsHost
    & GenericDeclarationsHost & TypeReferencesHost {
    const analyzer = this;
    return {
      get bareGenericClassPositions() { return analyzer.bareGenericClassPositions; },
      boundaryValidationGuidance: (expression, property) => analyzer.guidance.boundaryValidationGuidance(expression, property),
      get canonicalGenericApplications() { return analyzer.canonicalGenericApplications; },
      checkTypeParameterDeclarations: (declarations) => { analyzer.checkTypeParameterDeclarations(declarations); },
      classInfo: (key) => analyzer.classRegistry.classInfo(key),
      get classes() { return analyzer.classes; },
      declareTypeNameBinding: (name, type, declarationSpan, position) => { analyzer.scopeStack.declareTypeNameBinding(name, type, declarationSpan, position); },
      get diagnostics() { return analyzer.diagnostics; },
      enclosingTypeParameterName: (name) => analyzer.enclosingTypeParameterName(name),
      get enums() { return analyzer.enums; },
      expandAliases: (type, seen) => analyzer.aliases.expandAliases(type, seen),
      get externClassDeclarations() { return analyzer.externClassDeclarations; },
      get externTypeImports() { return analyzer.externTypeImports; },
      fieldsOf: (identity) => analyzer.fieldsOf(identity),
      findClassInReadonlyData: (type, seen, sawCycle) => analyzer.findClassInReadonlyData(type, seen, sawCycle),
      get genericApplications() { return analyzer.genericApplications; },
      get genericTypes() { return analyzer.genericTypes; },
      get genericTypesByIdentity() { return analyzer.genericTypesByIdentity; },
      get importBindings() { return analyzer.importBindings; },
      get inheritedTypeFields() { return analyzer.inheritedTypeFields; },
      get invalidDeclaredTypes() { return analyzer.invalidDeclaredTypes; },
      isPrimitiveType: (name) => analyzer.isPrimitiveType(name),
      lookup: (name) => analyzer.lookup(name),
      get lowering() { return analyzer.lowering; },
      markTypeNameRefused: (name) => { analyzer.markTypeNameRefused(name); },
      memberTypeParameterFrame: (classParameters, ownParameters) => analyzer.classRegistry.memberTypeParameterFrame(classParameters, ownParameters),
      get modulePath() { return analyzer.modulePath; },
      get namedTypeBases() { return analyzer.namedTypeBases; },
      get namedTypeIdentities() { return analyzer.namedTypeIdentities; },
      get namedTypeReadonlyFields() { return analyzer.namedTypeReadonlyFields; },
      get namedTypes() { return analyzer.namedTypes; },
      get namespaceImportLocals() { return analyzer.namespaceImportLocals; },
      noteClassApplication: (identity, application) => { analyzer.classRegistry.noteClassApplication(identity, application); },
      get predeclared() { return analyzer.predeclared; },
      get primitiveNames() { return analyzer.primitiveNames; },
      readonlyDataViewOf: (type) => analyzer.readonlyDataViewOf(type),
      readonlyFieldsOf: (identity) => analyzer.readonlyFieldsOf(identity),
      rejectCollidingKeyDomain: (keySource, span, position) => { analyzer.equality.rejectCollidingKeyDomain(keySource, span, position); },
      reportPromiseCarrierHazard: (type, errorSpan) => { analyzer.reportPromiseCarrierHazard(type, errorSpan); },
      resolveAnnotation: (reference) => analyzer.resolveAnnotation(reference),
      resolveGenericApplication: (type, resolveArgument) => analyzer.generics.resolveGenericApplication(type, resolveArgument),
      resolveGenericClassApplication: (type) => analyzer.generics.resolveGenericClassApplication(type),
      resolveNamedClasses: (type) => analyzer.typeReferences.resolveNamedClasses(type),
      resolveRawTypeReference: (reference) => analyzer.resolveRawTypeReference(reference),
      satisfiesBound: (type, bound) => analyzer.satisfiesBound(type, bound),
      get staticMemberTypeParameters() { return analyzer.staticMemberTypeParameters; },
      set staticMemberTypeParameters(value) { analyzer.staticMemberTypeParameters = value; },
      get typeAliases() { return analyzer.typeAliases; },
      typeError: (message, errorSpan, fix) => { analyzer.typeError(message, errorSpan, fix); },
      typeParameterFrame: (declarations) => analyzer.typeParameterFrame(declarations),
      get typeParameterFrames() { return analyzer.typeParameterFrames; },
      get typeReferenceValidity() { return analyzer.typeReferenceValidity; },
      validateExtensionTypeSyntax: (_syntax, _validate, _resolve) => analyzer.validateExtensionTypeSyntax(_syntax, _validate, _resolve),
      validateGenericApplication: (info, syntax) => analyzer.generics.validateGenericApplication(info, syntax),
      validateGenericClassApplication: (name, info, syntax) => analyzer.generics.validateGenericClassApplication(name, info, syntax),
      validateTypeReference: (reference, resolve) => analyzer.typeReferences.validateTypeReference(reference, resolve),
      withTypeParameterFrame: (frame, action) => analyzer.withTypeParameterFrame(frame, action),
    };
  }

  /**
   * The one object the four flow collaborators are handed. Every property is a
   * live read of the analyzer or of another flow collaborator: the scope stack
   * grows and shrinks, the flow frame depth moves, and the member-fact stack is
   * rewritten while a condition is being analyzed, so none of it can be a value
   * captured when the collaborators were built.
   */
  private flowHost(): FlowFactsHost & NarrowingHost & MemberLocationsHost & LoopFlowHost & FlowMergeHost {
    const analyzer = this;
    return {
      analyzeIsolatedFlow: (snapshot, analyze) => analyzer.flowFacts.analyzeIsolatedFlow(snapshot, analyze),
      applyFlowInvalidations: (branches, includeBaseline) => { analyzer.flowMerge.applyFlowInvalidations(branches, includeBaseline); },
      builtin: (name) => analyzer.scopeStack.builtin(name),
      conditionSubjectText: (condition) => analyzer.guidance.conditionSubjectText(condition),
      containsInferredResultPlaceholder: (type) => containsInferredResultPlaceholder(type),
      get currentClass() { return analyzer.currentClass; },
      get diagnostics() { return analyzer.diagnostics; },
      enterScope: () => { analyzer.enterScope(); },
      get enums() { return analyzer.enums; },
      equalityTypesIntersect: (left, right) => analyzer.equality.equalityTypesIntersect(left, right),
      erasedClassCheckType: (source, checked) => analyzer.erasedClassCheckType(source, checked),
      exitScope: () => { analyzer.exitScope(); },
      expandAliases: (type, seen) => analyzer.expandAliases(type, seen),
      fieldsOf: (identity) => analyzer.fieldsOf(identity),
      findField: (className, name) => analyzer.classInheritance.findField(className, name),
      findGetter: (className, name) => analyzer.classInheritance.findGetter(className, name),
      findStaticField: (className, name) => analyzer.classInheritance.findStaticField(className, name),
      findStaticGetter: (className, name) => analyzer.classInheritance.findStaticGetter(className, name),
      get flowFrameDepth() { return analyzer.flowFrameDepth; },
      flowSnapshotAfterInvalidations: (baseline, invalidations) => analyzer.flowFacts.flowSnapshotAfterInvalidations(baseline, invalidations),
      inferExpression: (expression, contextualType) => analyzer.inferExpression(expression, contextualType),
      inferredExpressionType: (expression) => analyzer.inferredExpressionType(expression),
      get inferredExpressionTypes() { return analyzer.inferredExpressionTypes; },
      isAssignableHere: (actual, expected) => isAssignable(actual, expected, analyzer),
      iterationContract: (type) => analyzer.classRoles.iterationContract(type),
      get locations() { return analyzer.locations; },
      get logicalConditionNarrowings() { return analyzer.narrowing.logicalConditionNarrowings; },
      lookup: (name) => analyzer.lookup(name),
      matchTypesOverlap: (left, right) => analyzer.matchCoverage.matchTypesOverlap(left, right),
      get memberNarrowings() { return analyzer.flowFacts.memberNarrowings; },
      get narrowedNames() { return analyzer.flowFacts.narrowedNames; },
      privateFieldForAccess: (className, name, staticMember) => analyzer.classInheritance.privateFieldForAccess(className, name, staticMember),
      get privateGetters() { return analyzer.privateGetters; },
      get privateStaticGetters() { return analyzer.privateStaticGetters; },
      readonlyDataViewOf: (type) => analyzer.readonlyDataViewOf(type),
      readonlyFieldsOf: (identity) => analyzer.readonlyFieldsOf(identity),
      recordFlowFactOrigin: (binding) => { analyzer.flowFacts.recordFlowFactOrigin(binding); },
      recordScopedName: (name) => { analyzer.scopeStack.recordScopedName(name); },
      requireCondition: (type, condition) => { analyzer.requireCondition(type, condition); },
      resolveAnnotation: (reference) => analyzer.resolveAnnotation(reference),
      restoreFlowFacts: (snapshot) => { analyzer.flowFacts.restoreFlowFacts(snapshot); },
      get runtimeNarrowings() { return analyzer.lowering.runtimeNarrowings; },
      runtimeTypeCheckMayExecute: (input, checkedInput) => analyzer.matchCoverage.runtimeTypeCheckMayExecute(input, checkedInput),
      runtimeTypeObjectValue: (type) => analyzer.runtimeTypeObjectValue(type),
      get scopes() { return analyzer.scopeStack.scopes; },
      survivingNarrowings: (narrowed) => analyzer.flowMerge.survivingNarrowings(narrowed),
      trackNarrowingShadow: (shadow) => { analyzer.flowFacts.trackNarrowingShadow(shadow); },
      typeError: (message, errorSpan) => { analyzer.typeError(message, errorSpan); },
    };
  }

  /**
   * D115 §三: what the expression cluster is allowed to ask of this analyzer.
   * One object satisfies all twelve narrow faces, and this declaration is where
   * that is checked. The walk state a rule reads mid-flight — the class under
   * analysis, the function and initializer depths, the annotation-free head —
   * is declared here rather than in either half below, because a getter is only
   * live while it stays a getter: spreading one evaluates it once and freezes
   * the read. The two halves have no name of their own; their type is the
   * object each returns.
   */
  private expressionHost(): ExpressionHostFace {
    const analyzer = this;
    return {
      ...this.expressionQueryHost(),
      ...this.expressionReportHost(),
      get annotationFreeHeads() { return analyzer.annotationFreeHeads; },
      set annotationFreeHeads(value) { analyzer.annotationFreeHeads = value; },
      get arrowCaptureFrames() { return analyzer.arrowCaptureFrames; },
      get asynchronousFunctions() { return analyzer.asynchronousFunctions; },
      get bindingHoleCauses() { return analyzer.bindingHoleCauses; },
      get callExpressionCallees() { return analyzer.callExpressionCallees; },
      get classFieldInitializerDepth() { return analyzer.classFieldInitializerDepth; },
      get classes() { return analyzer.classes; },
      get constructorDepth() { return analyzer.constructorDepth; },
      get constructorFieldInitializations() { return analyzer.constructorFieldInitializations; },
      get contextualAssignments() { return analyzer.contextualAssignments; },
      get currentClass() { return analyzer.currentClass; },
      get deferredConvergenceReports() { return analyzer.deferredConvergenceReports; },
      get diagnostics() { return analyzer.diagnostics; },
      get extensionCalls() { return analyzer.extensionCalls; },
      get extensionReservedBindings() { return analyzer.extensionReservedBindings; },
      get functionDepth() { return analyzer.functionDepth; },
      get functionResultKeys() { return analyzer.functionResultKeys; },
      get genericTypes() { return analyzer.genericTypes; },
      get hoistedClassDeclarations() { return analyzer.hoistedClassDeclarations; },
      get importBindings() { return analyzer.importBindings; },
      get importedBindingOrigins() { return analyzer.importedBindingOrigins; },
      get inferredExpressionTypes() { return analyzer.inferredExpressionTypes; },
      get logicalConditionNarrowings() { return analyzer.narrowing.logicalConditionNarrowings; },
      get lowering() { return analyzer.lowering; },
      get memberAccessProperties() { return analyzer.members.memberAccessProperties; },
      get parameterDefaultDepth() { return analyzer.parameterDefaultDepth; },
      get primitiveMutableFields() { return analyzer.primitiveMutableFields; },
      get primitiveNames() { return analyzer.primitiveNames; },
      get primitiveParents() { return analyzer.primitiveParents; },
      get privateFields() { return analyzer.privateFields; },
      get privateGetters() { return analyzer.privateGetters; },
      get privateMethods() { return analyzer.privateMethods; },
      get privateStaticFields() { return analyzer.privateStaticFields; },
      get privateStaticMethods() { return analyzer.privateStaticMethods; },
      get reportedBoundViolations() { return analyzer.reportedBoundViolations; },
      get reportedCollectionHoles() { return analyzer.reportedCollectionHoles; },
      get reportedResultHoles() { return analyzer.reportedResultHoles; },
      get retiredCollections() { return analyzer.collections.retired; },
      get retiredNamespaceImportOrigins() { return analyzer.namespaceImports.origins; },
      get retiredNamespaceImportReads() { return analyzer.namespaceImports.reads; },
      get retiredNamespaceUses() { return analyzer.retiredNamespaceUses; },
      get retiredNamespaces() { return analyzer.retiredNamespaces; },
      get scopes() { return analyzer.scopeStack.scopes; },
      get semanticBindingMembers() { return analyzer.semanticBindingMembers; },
      get semanticBindingTypes() { return analyzer.semanticBindingTypes; },
      get semanticExpressionContextMembers() { return analyzer.semanticExpressionContextMembers; },
      get semanticExpressionContexts() { return analyzer.semanticExpressionContexts; },
      get semanticExpressionMembers() { return analyzer.semanticExpressionMembers; },
      get semanticExpressionOwners() { return analyzer.semanticExpressionOwners; },
      get semanticExpressionTypes() { return analyzer.semanticExpressionTypes; },
      get semanticMemberCache() { return analyzer.semanticMemberCache; },
      get semanticObjectPropertyOwners() { return analyzer.semanticObjectPropertyOwners; },
      get sourceText() { return analyzer.sourceText; },
      get superMemberContext() { return analyzer.superMemberContext; },
      get testExpectOperands() { return analyzer.testExpectOperands; },
    };
  }

  /** Everything the expression cluster asks this analyzer to answer. */
  private expressionQueryHost(): ExpressionQueryFace {
    const analyzer = this;
    return {
      allowBareGenericClassName: (reference) => { analyzer.allowBareGenericClassName(reference); },
      assignedFactDomain: (expression, inferred) => analyzer.equality.assignedFactDomain(expression, inferred),
      asyncResultSpellingGuidance: (actual, expectedCore) => analyzer.guidance.asyncResultSpellingGuidance(actual, expectedCore),
      awaitedOperandContext: (contextualType) => analyzer.contextual.awaitedOperandContext(contextualType),
      bindingScopeDepth: (name) => analyzer.classRoles.bindingScopeDepth(name),
      boundMethodRecordGuidance: (actual, expected, valueSpan) => analyzer.guidance.boundMethodRecordGuidance(actual, expected, valueSpan),
      boundOf: (type) => analyzer.boundOf(type),
      boundaryValidationGuidance: (expression, property) => analyzer.guidance.boundaryValidationGuidance(expression, property),
      builtin: (name) => analyzer.scopeStack.builtin(name),
      carriedOwnedResource: (expression) => analyzer.classRoles.carriedOwnedResource(expression),
      classInfo: (key) => analyzer.classRegistry.classInfo(key),
      coalescingFallbackContext: (left, contextualType) => analyzer.contextual.coalescingFallbackContext(left, contextualType),
      coalescingSubjectContext: (operator, contextualType) => analyzer.contextual.coalescingSubjectContext(operator, contextualType),
      collectionBridgeGuidance: (actual, expectedCore) => analyzer.guidance.collectionBridgeGuidance(actual, expectedCore),
      combineNarrowings: (first, second) => analyzer.narrowing.combineNarrowings(first, second),
      concreteCallableFor: (actual, expected, errorSpan) => analyzer.assignability.concreteCallableFor(actual, expected, errorSpan),
      contextualCollectionType: (type) => analyzer.contextual.contextualCollectionType(type),
      contextualObjectType: (type, expression) => analyzer.contextual.contextualObjectType(type, expression),
      contextuallyAssignable: (actual, expected, valueSpan) => analyzer.contextual.contextuallyAssignable(actual, expected, valueSpan),
      dataFieldIsReadonly: (original, property) => analyzer.locations.dataFieldIsReadonly(original, property),
      displayExternalClasses: (type) => analyzer.moduleImports.displayExternalClasses(type),
      enumSingletonCellGuidance: (actual, expected, target) => analyzer.guidance.enumSingletonCellGuidance(actual, expected, target),
      enumTargetOfValidatorObject: (object) => analyzer.enumDeclarations.enumTargetOfValidatorObject(object),
      enumWireValuesOf: (identity, name) => analyzer.enumWireValuesOf(identity, name),
      equalityOperandMayBeNaN: (expression, type) => analyzer.equality.equalityOperandMayBeNaN(expression, type),
      expandAliases: (type, seen) => analyzer.expandAliases(type, seen),
      extensionTextForm: (type) => analyzer.extensionTextForm(type),
      fieldsOf: (identity) => analyzer.fieldsOf(identity),
      findField: (className, name) => analyzer.classInheritance.findField(className, name),
      findGetter: (className, name) => analyzer.classInheritance.findGetter(className, name),
      findMethod: (className, name) => analyzer.classInheritance.findMethod(className, name),
      findStaticField: (className, name) => analyzer.classInheritance.findStaticField(className, name),
      findStaticGetter: (className, name) => analyzer.classInheritance.findStaticGetter(className, name),
      findStaticMethod: (className, name) => analyzer.classInheritance.findStaticMethod(className, name),
      inModuleInitializationPosition: () => analyzer.inModuleInitializationPosition(),
      inferConditionWithNarrowings: (expression, narrowed) => analyzer.narrowing.inferConditionWithNarrowings(expression, narrowed),
      inferExpression: (expression, contextualType) => analyzer.inferExpression(expression, contextualType),
      inferMember: (objectExpression, property, optional, memberSpan, useNarrowing, readValue) => analyzer.members.inferMember(objectExpression, property, optional, memberSpan, useNarrowing, readValue),
      inferNarrowedExpression: (expression, narrowed, contextualType) => analyzer.narrowing.inferNarrowedExpression(expression, narrowed, contextualType),
      inferredOrAnalyze: (expression) => analyzer.inferredOrAnalyze(expression),
      instantiateGenericCallableHere: (actual, expected, violations) => instantiateGenericCallable(actual, expected, analyzer, violations),
      invalidExtensionAwaitContext: () => analyzer.invalidExtensionAwaitContext(),
      invalidExtensionAwaitMessage: () => analyzer.invalidExtensionAwaitMessage(),
      isAssignableHere: (actual, expected) => isAssignable(actual, expected, analyzer),
      isSubclassOf: (actual, expected) => analyzer.isSubclassOf(actual, expected),
      isTextConvertibleHere: (type) => isTextConvertibleType(type, analyzer),
      iterationGuidance: (type) => analyzer.classRoles.iterationGuidance(type),
      iterationSource: (expression, type) => analyzer.classRoles.iterationSource(expression, type),
      listMember: (list, property) => analyzer.collections.listMember(list, property),
      lookup: (name) => analyzer.lookup(name),
      lookupMemberNarrowingEntry: (path) => analyzer.locations.lookupMemberNarrowingEntry(path),
      mapMember: (map, property) => analyzer.collections.mapMember(map, property),
      narrowingFor: (expression, knownType) => analyzer.narrowingFor(expression, knownType),
      negativeNarrowingFor: (expression, knownType) => analyzer.negativeNarrowingFor(expression, knownType),
      numberMember: (property) => analyzer.members.numberMember(property),
      optionalExecutionNarrowings: (expression) => analyzer.narrowing.optionalExecutionNarrowings(expression),
      planNamedArguments: (arguments_, argumentNames, parameters, parameterNames, requiredParameters, callSpan, rest) => analyzer.calls.planNamedArguments(arguments_, argumentNames, parameters, parameterNames, requiredParameters, callSpan, rest),
      privateFieldForAccess: (className, name, staticMember) => analyzer.classInheritance.privateFieldForAccess(className, name, staticMember),
      privateMethodForAccess: (className, name, staticMember) => analyzer.classInheritance.privateMethodForAccess(className, name, staticMember),
      readonlyDataViewOf: (type) => analyzer.readonlyDataViewOf(type),
      readonlyFieldsOf: (identity) => analyzer.readonlyFieldsOf(identity),
      readonlyProjectionGuidance: (actual, expected, expandedExpected, expectedCore) => analyzer.guidance.readonlyProjectionGuidance(actual, expected, expandedExpected, expectedCore),
      resolveAnnotation: (reference) => analyzer.resolveAnnotation(reference),
      resolveNamedClasses: (type) => analyzer.typeReferences.resolveNamedClasses(type),
      retiredNamespaceOwning: (name) => analyzer.moduleImports.retiredNamespaceOwning(name),
      runtimeTypeObjectValue: (type) => analyzer.runtimeTypeObjectValue(type),
      semanticMembersOf: (original) => analyzer.semanticMembersOf(original),
      setMember: (set, property) => analyzer.collections.setMember(set, property),
      stableMemberAccessPath: (expression) => analyzer.locations.stableMemberAccessPath(expression),
      stringMember: (property) => analyzer.members.stringMember(property),
      survivingNarrowings: (narrowed) => analyzer.flowMerge.survivingNarrowings(narrowed),
      unavailableSelfGuidance: () => analyzer.guidance.unavailableSelfGuidance(),
      validateTypeReference: (reference, resolve) => analyzer.validateTypeReference(reference, resolve),
      widenAggregateSingleton: (type) => analyzer.contextual.widenAggregateSingleton(type),
    };
  }

  /** Everything it tells this analyzer: a diagnostic, an advisory, a lowering fact, a flow fact. */
  private expressionReportHost(): ExpressionReportFace {
    const analyzer = this;
    return {
      adviseManualMappedRecordProjection: (expression, target, writtenTarget) => { analyzer.advisoryRoster.adviseManualMappedRecordProjection(expression, target, writtenTarget); },
      adviseManualRecordProjection: (expression, target, writtenTarget) => { analyzer.advisoryRoster.adviseManualRecordProjection(expression, target, writtenTarget); },
      adviseNegativeLiteralModulo: (leftExpression, rightExpression, operationSpan) => { analyzer.advisoryRoster.adviseNegativeLiteralModulo(leftExpression, rightExpression, operationSpan); },
      adviseRedundantObjectProperty: (property) => { analyzer.advisoryRoster.adviseRedundantObjectProperty(property); },
      adviseTupleShapedListLiteral: (expression, contextualType, writtenElementTypes, element) => { analyzer.advisoryRoster.adviseTupleShapedListLiteral(expression, contextualType, writtenElementTypes, element); },
      analyzeIsolatedFlow: (snapshot, analyze) => analyzer.flowFacts.analyzeIsolatedFlow(snapshot, analyze),
      applyFlowInvalidations: (branches, includeBaseline) => { analyzer.flowMerge.applyFlowInvalidations(branches, includeBaseline); },
      applyNarrowings: (narrowed, narrowingSpan) => { analyzer.applyNarrowings(narrowed, narrowingSpan); },
      checkShadowedRead: (name, span) => { analyzer.scopeStack.checkShadowedRead(name, span); },
      enterScope: () => { analyzer.enterScope(); },
      establishAssignedFact: (name, assigned) => { analyzer.narrowing.establishAssignedFact(name, assigned); },
      establishAssignedMemberFact: (target, assigned, declaredMemberType) => { analyzer.narrowing.establishAssignedMemberFact(target, assigned, declaredMemberType); },
      exitScope: () => { analyzer.exitScope(); },
      invalidateAliasableMemberNarrowings: (target) => { analyzer.locations.invalidateAliasableMemberNarrowings(target); },
      invalidateAssignmentNarrowings: (target, binding) => { analyzer.locations.invalidateAssignmentNarrowings(target, binding); },
      invalidateShadowedNarrowings: (name, target) => { analyzer.locations.invalidateShadowedNarrowings(name, target); },
      noteGenericApplications: (type, seen) => { analyzer.generics.noteGenericApplications(type, seen); },
      recordFlowFactOrigin: (binding) => { analyzer.flowFacts.recordFlowFactOrigin(binding); },
      recordInitializationImportRead: (binding, local, span) => { analyzer.moduleInitialization.recordInitializationImportRead(binding, local, span); },
      recordMember: (record, property) => analyzer.collections.recordMember(record, property),
      recordProjectionShape: (type) => analyzer.projections.recordProjectionShape(type),
      recordSemanticExpression: (expression, type) => { analyzer.semanticIndex.recordSemanticExpression(expression, type); },
      rejectDisjointEnumTest: (subjectSource, checked, operator, span) => { analyzer.equality.rejectDisjointEnumTest(subjectSource, checked, operator, span); },
      rejectErasedRuntimeCheck: (checked, errorSpan) => analyzer.rejectErasedRuntimeCheck(checked, errorSpan),
      rejectFreshCollectionEquality: (left, right, operator) => analyzer.equality.rejectFreshCollectionEquality(left, right, operator),
      rejectFreshCollectionProbe: (probe, operation, probes) => analyzer.equality.rejectFreshCollectionProbe(probe, operation, probes),
      rejectOwnedResourceEscape: (expression, action, errorSpan) => analyzer.classRoles.rejectOwnedResourceEscape(expression, action, errorSpan),
      reportPromiseResolutionHazard: (type, errorSpan) => { analyzer.reportPromiseResolutionHazard(type, errorSpan); },
      reportUnresolvedName: (name, span) => { analyzer.scopeStack.reportUnresolvedName(name, span); },
      requireAssignable: (actual, expected, valueSpan, mutableCell) => { analyzer.requireAssignable(actual, expected, valueSpan, mutableCell); },
      requireCondition: (type, condition) => { analyzer.requireCondition(type, condition); },
      requireIntersectingEquality: (leftType, rightType, operator, leftExpression, rightExpression, operationSpan) => { analyzer.equality.requireIntersectingEquality(leftType, rightType, operator, leftExpression, rightExpression, operationSpan); },
      requireMembershipIntersection: (probe, domain, span, operation) => analyzer.equality.requireMembershipIntersection(probe, domain, span, operation),
      requireOrderedComparison: (leftType, rightType, leftExpression, rightExpression, operationSpan) => { analyzer.equality.requireOrderedComparison(leftType, rightType, leftExpression, rightExpression, operationSpan); },
      snapshotFlowFacts: () => analyzer.flowFacts.snapshotFlowFacts(),
      typeError: (message, errorSpan, fix) => { analyzer.typeError(message, errorSpan, fix); },
      withTemporaryNarrowings: (narrowed, narrowingSpan, analyze) => analyzer.narrowing.withTemporaryNarrowings(narrowed, narrowingSpan, analyze),
    };
  }

  // ── The four protected seams the expression cluster owns ────────────────
  // D114 R1: `Analyzer` is the only entry point Web and Node subclass, so every
  // `protected` member stays declared here with the signature it always had.
  // The bodies moved; these four forward to them.

  protected requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell: MutableCellTarget | null = null): void {
    this.assignability.requireAssignable(actual, expected, valueSpan, mutableCell);
  }

  protected inAnnotationFreeHead(): boolean {
    return this.contextual.inAnnotationFreeHead();
  }

  protected requireSettledCollectionElement(initializer: Expression, declared: ValueType, annotated: boolean): boolean {
    return this.contextual.requireSettledCollectionElement(initializer, declared, annotated);
  }

  protected semanticMembersOf(original: ValueType): ReadonlyMap<string, ValueType> {
    return this.semanticIndex.semanticMembersOf(original);
  }

  private memberHost(): MemberAccessHost {
    // The same live reads a call makes: the class under analysis, the `super`
    // context, the static-initialization frame, the walk depths.
    const analyzer = this;
    return {
      aliasedEnumTarget: (name) => analyzer.enumDeclarations.aliasedEnumTarget(name),
      get analysisExtensions() { return analyzer.analysisExtensions; },
      get asynchronousFunctions() { return analyzer.asynchronousFunctions; },
      boundaryValidationGuidance: (expression, property) => analyzer.guidance.boundaryValidationGuidance(expression, property),
      get callExpressionCallees() { return analyzer.callExpressionCallees; },
      checkArguments: (arguments_, parameters, callSpan, requiredParameters, rest, argumentNames, parameterNames) => { analyzer.checkArguments(arguments_, parameters, callSpan, requiredParameters, rest, argumentNames, parameterNames); },
      classInfo: (key) => analyzer.classRegistry.classInfo(key),
      get classes() { return analyzer.classes; },
      get collections() { return analyzer.collections; },
      conditionSubjectText: (condition) => analyzer.guidance.conditionSubjectText(condition),
      get constructorDepth() { return analyzer.constructorDepth; },
      get currentClass() { return analyzer.currentClass; },
      declaresPrivateMember: (className, name, staticMember) => analyzer.classInheritance.declaresPrivateMember(className, name, staticMember),
      discriminatedDataField: (original, property) => analyzer.locations.discriminatedDataField(original, property),
      displayExternalClasses: (type) => analyzer.moduleImports.displayExternalClasses(type),
      enumRuntimeMember: (name, identity, members, property) => analyzer.enumDeclarations.enumRuntimeMember(name, identity, members, property),
      expandAliases: (type, seen) => analyzer.expandAliases(type, seen),
      fieldsOf: (identity) => analyzer.fieldsOf(identity),
      findField: (className, name) => analyzer.classInheritance.findField(className, name),
      findGetter: (className, name) => analyzer.classInheritance.findGetter(className, name),
      findMethod: (className, name) => analyzer.classInheritance.findMethod(className, name),
      findStaticField: (className, name) => analyzer.classInheritance.findStaticField(className, name),
      findStaticFieldOwner: (className, name) => analyzer.classInheritance.findStaticFieldOwner(className, name),
      findStaticGetter: (className, name) => analyzer.classInheritance.findStaticGetter(className, name),
      findStaticMethod: (className, name) => analyzer.classInheritance.findStaticMethod(className, name),
      get functionDepth() { return analyzer.functionDepth; },
      getterAccessProperty: (expression) => analyzer.locations.getterAccessProperty(expression),
      inferredOrAnalyze: (expression) => analyzer.inferredOrAnalyze(expression),
      get invalidDeclaredTypes() { return analyzer.invalidDeclaredTypes; },
      isSubclassOf: (actual, expected) => analyzer.isSubclassOf(actual, expected),
      lookup: (name) => analyzer.lookup(name),
      lookupMemberNarrowing: (path) => analyzer.locations.lookupMemberNarrowing(path),
      get lowering() { return analyzer.lowering; },
      get memberAccessReceivers() { return analyzer.memberAccessReceivers; },
      privateFieldForAccess: (className, name, staticMember) => analyzer.classInheritance.privateFieldForAccess(className, name, staticMember),
      get privateGetters() { return analyzer.privateGetters; },
      privateMethodForAccess: (className, name, staticMember) => analyzer.classInheritance.privateMethodForAccess(className, name, staticMember),
      get privateStaticFields() { return analyzer.privateStaticFields; },
      get promiseInitializerBindings() { return analyzer.promiseInitializerBindings; },
      readonlyDataViewOf: (type) => analyzer.readonlyDataViewOf(type),
      readonlyFieldsOf: (identity) => analyzer.readonlyFieldsOf(identity),
      recordSemanticExpression: (expression, type) => { analyzer.semanticIndex.recordSemanticExpression(expression, type); },
      recoveredTypeError: (message, errorSpan, fix) => { analyzer.recoveredTypeError(message, errorSpan, fix); },
      runtimeTypeObjectValue: (type) => analyzer.runtimeTypeObjectValue(type),
      get semanticExpressionOwners() { return analyzer.semanticExpressionOwners; },
      semanticMembersOf: (original) => analyzer.semanticMembersOf(original),
      stableMemberAccessPath: (expression) => analyzer.locations.stableMemberAccessPath(expression),
      get staticFieldInitialization() { return analyzer.staticFieldInitialization; },
      get superMemberContext() { return analyzer.superMemberContext; },
      get testExpectOperands() { return analyzer.testExpectOperands; },
      typeError: (message, errorSpan, fix) => { analyzer.typeError(message, errorSpan, fix); },
      uniqueNearestName: (requested, candidates) => uniqueNearestName(requested, candidates),
    };
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
    collect("List", CORE_LIST_METHOD_NAMES, (name) => analyzer.collections.listMember({ kind: "list", element: item }, name));
    collect("readonly List", CORE_LIST_METHOD_NAMES, (name) => analyzer.collections.listMember({ kind: "list", element: item, readonlyView: true }, name));
    collect("Map", CORE_MAP_METHOD_NAMES, (name) => analyzer.collections.mapMember({ kind: "map", key, value }, name));
    collect("readonly Map", CORE_MAP_METHOD_NAMES, (name) => analyzer.collections.mapMember({ kind: "map", key, value, readonlyView: true }, name));
    collect("Set", CORE_SET_METHOD_NAMES, (name) => analyzer.collections.setMember({ kind: "set", element: item }, name));
    collect("readonly Set", CORE_SET_METHOD_NAMES, (name) => analyzer.collections.setMember({ kind: "set", element: item, readonlyView: true }, name));
    collect("Record", CORE_RECORD_METHOD_NAMES, (name) => analyzer.collections.recordMember({ kind: "record", value }, name));
    collect("readonly Record", CORE_RECORD_METHOD_NAMES, (name) => analyzer.collections.recordMember({ kind: "record", value, readonlyView: true }, name));
    return contracts;
  }

  private readonly modulePath: string | null;
  private readonly importBindings: ReadonlyMap<string, ValueType>;
  private readonly dynamicImports: ReadonlyMap<string, ValueType>;

  analyze(program: Program): readonly Diagnostic[] {
    // The namespace locals are read by every later pass that reports on a
    // dotted type reference, and record fields and alias targets are validated
    // among the first of them — collected below the type passes, `type Holder:
    // box: library.Box` answered "'library' is not an enum" while the same
    // annotation on a binding answered with the import-by-name guidance. One
    // question, one answer, so the roster exists before anything asks.
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration") continue;
      for (const specifier of statement.specifiers) {
        if (specifier.namespace) this.namespaceImportLocals.set(specifier.local, statement.source);
      }
    }
    this.typeRecords.rejectReservedTypeNames(program);
    this.enumDeclarations.registerEnumShapes(program);
    this.aliases.registerAliasShapes(program);
    // Class identities must exist before record fields are resolved. Otherwise a
    // record field annotated with a class is frozen as a structural named type.
    this.classRegistry.registerClassNames(program);
    this.moduleImports.registerExternTypeImports(program);
    this.typeRecords.registerTypeShapes(program);
    this.generics.rejectPolymorphicRecursion(program);
    this.generics.rejectPolymorphicClassRecursion(program);
    this.typeRecords.validateDataTypeDeclarations(program);
    this.typeRecords.validateCoreDeclarationSignatures(program);
    this.classRegistry.registerClassShapes(program);
    this.typeRecords.rejectUnproductiveRecursiveTypes(program);
    this.classRegistry.registerExternClassDeclarations(program);
    this.classRegistry.validateExternDeclarations(program);
    this.moduleImports.registerExternModules(program);
    this.moduleExports.validateReExports(program);
    this.namespaceImports.register(program);
    this.collections.retired.register(program);
    this.predeclareTopLevel(program);
    let previous: Statement | null = null;
    for (const statement of program.body) {
      this.analyzeStatement(statement);
      this.advisoryRoster.adviseManualCollectionConversion(previous, statement);
      this.advisoryRoster.adviseManualListPipeline(previous, statement);
      this.adviseManualListQuery(previous, statement);
      previous = statement;
    }
    // D90 R12 reports last for the same reason: whether a class member is at
    // an export position is a question about the module's whole export
    // surface, which no single declaration can answer as it is analyzed.
    this.moduleExports.reportExportPositionAny(program);
    // D52 rules 114/116: both namespace migrations report last, because both
    // rewrites need the whole module before they can be written down — one has
    // to know every name the new import would have to clear, and the other has
    // to know every read the retiring import leaves behind.
    this.moduleImports.reportRetiredNamespaceUses(program);
    this.namespaceImports.report(program);
    this.namespaceImports.reportReExports(program);
    this.collections.retired.report(program);
    // D85 rule 209 reports last for the same reason: a hole reaches a caller
    // through a callee the module may not declare until later, so the second
    // report is deleted once every hole in the module is on record.
    this.contextual.resolveDeferredConvergenceReports();
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

  private predeclareTopLevel(program: Program): void {
    for (const statement of program.body) {
      if (statement.kind === "ImportDeclaration") {
        for (const specifier of statement.specifiers) {
          if (statement.javascript) this.javaScriptBindings.add(specifier.local);
          this.declareBinding(
            specifier.local,
            false,
            this.moduleImports.importType(statement, specifier.local, specifier.imported, specifier.namespace, specifier.span),
            specifier.span,
            false,
            undefined,
            statement.source,
            importTypeNamePosition(statement, specifier),
          );
          this.moduleImports.recordImportedBindingSource(statement.javascript, statement.source, specifier.local, specifier.namespace ? null : specifier.imported);
          this.moduleImports.recordImportedBindingOrigin(specifier.local, statement.source, specifier.span);
          const reactive = this.reactiveBindings.get(specifier.local);
          if (reactive) this.markDeclaredBindingReactive(specifier.local, reactive);
        }
        this.predeclared.add(statement);
      } else if (statement.kind === "TypeDeclaration" || statement.kind === "TypeAliasDeclaration") {
        this.scopeStack.declareTypeNameBinding(statement.name, { kind: "typeObject", name: statement.name }, statement.span, "type");
        this.predeclared.add(statement);
      } else if (statement.kind === "EnumDeclaration") {
        const info = this.enums.get(statement.name) ?? {
          identity: statement.name,
          members: new Set(statement.members.map((member) => member.name)),
          wireValues: new Map(statement.members.map((member) => [member.name, member.value])),
        };
        this.scopeStack.declareTypeNameBinding(statement.name, { kind: "enumObject", name: statement.name, identity: info.identity, members: info.members }, statement.span, "enum");
        this.predeclared.add(statement);
      } else if (statement.kind === "ClassDeclaration") {
        this.scopeStack.declareTypeNameBinding(statement.name, { kind: "classConstructor", name: statement.name }, statement.span, "class");
        // The name is hoisted for analysis so deferred bodies may reference
        // classes declared later, but the emitted `class` statement is not
        // hoisted at runtime. Remember where the declaration evaluates so an
        // immediate earlier use is rejected instead of loading into a raw
        // ReferenceError.
        const hoisted = this.scopeStack.scopes.at(-1)?.get(statement.name);
        if (hoisted) this.hoistedClassDeclarations.set(hoisted, statement.span.start);
        this.predeclared.add(statement);
      } else if (statement.kind === "FunctionDeclaration") {
        this.declareBinding(statement.name, false, this.functionType(statement), statement.span);
        // D85 rule 209: the result a call to this name reaches, recorded before
        // any body is analyzed so a call to a function declared further down
        // the module still resolves to it.
        const callable = this.scopeStack.scopes.at(-1)?.get(statement.name);
        if (callable) this.functionResultKeys.set(callable, this.functionResultKey(statement));
        this.predeclared.add(statement);
      } else if (this.predeclareExtensionStatement(statement)) {
        this.predeclared.add(statement);
      }
    }
  }

  loweringHints(): LoweringHints {
    return this.lowering.hints({
      classNames: new Set([...this.classes.keys(), ...this.classDisplayNames.values()]),
      errorSubclassNames: new Set([...this.classes.keys()].filter((name) => name !== "Error" && this.isSubclassOf(name, "Error"))),
      enumNames: new Set(this.enums.keys()),
      genericTypeNames: new Set(this.genericTypes.keys()),
      enumValueBindings: this.enumValueBindings,
      extensionLiterals: this.extensionLiterals,
      extensionCalls: this.extensionCalls,
    });
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
    const instantiated = this.generics.instantiateGenericFields(identity);
    if (instantiated) return instantiated;
    return this.extensionFieldsOf(identity);
  }

  /** The generic record a name in this module refers to, local or imported. */
  protected expandAliases(type: ValueType, seen: ReadonlySet<string> = new Set()): ValueType {
    return this.aliases.expandAliases(type, seen);
  }

  expandTypeAliases(type: ValueType): ValueType {
    return this.aliases.expandTypeAliases(type);
  }

  protected validateTypeReference(
    reference: TypeReference,
    resolve?: (reference: TypeReference) => ValueType,
  ): boolean {
    return this.typeReferences.validateTypeReference(reference, resolve);
  }

  enumWireValuesOf(identity: string, name: string): ReadonlyMap<string, string | number> | null {
    return this.enumDeclarations.enumWireValuesOf(identity, name);
  }

  enumValuesOf(identity: string): readonly (string | number)[] | null {
    return this.enumDeclarations.enumValuesOf(identity);
  }

  protected genericTypeInfo(name: string): GenericTypeInfo | null {
    return this.genericTypes.get(name) ?? null;
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
      this.generics.instantiateGenericFields(identity);
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

  protected isPredeclared(statement: object): boolean {
    return this.predeclared.has(statement);
  }

  isSubclassOf(className: string, base: string): boolean {
    return this.classInheritance.isSubclassOf(className, base);
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

  protected analyzeStatement(statement: Statement): void {
    if (this.analyzeExtensionStatement(statement)) return;
    switch (statement.kind) {
      case "ImportDeclaration":
        return this.analyzeImportDeclaration(statement);
      case "ReExportDeclaration":
        if (this.scopeStack.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "Exports can only be declared at module scope", statement.span));
        }
        break;
      case "ExternModuleDeclaration":
        return this.analyzeExternModuleDeclaration(statement);
      case "EmbeddedJavaScriptDeclaration":
        return this.analyzeEmbeddedJavaScriptDeclaration(statement);
      case "TypeDeclaration":
        return this.analyzeTypeDeclaration(statement);
      case "TypeAliasDeclaration":
        if (this.scopeStack.scopes.length !== 1) {
          this.diagnostics.push(diagnostic("VEL3011", "Types can only be declared at module scope", statement.span));
        }
        this.aliases.analyzeTypeAliasDeclaration(statement);
        break;
      case "EnumDeclaration":
        return this.analyzeEnumDeclaration(statement);
      case "ClassDeclaration":
        return this.analyzeClassDeclaration(statement);
      case "VariableDeclaration":
        return this.analyzeVariableDeclaration(statement);
      case "MainBlock":
        return this.analyzeMainBlock(statement);
      case "UsingDeclaration":
        this.classRoles.analyzeUsingDeclaration(statement);
        break;
      case "TestDeclaration":
        this.analyzeTestDeclaration(statement);
        break;
      case "FunctionDeclaration":
        return this.analyzeFunctionDeclarationStatement(statement);
      case "ReturnStatement":
        return this.analyzeReturnStatement(statement);
      case "ThrowStatement":
        return this.analyzeThrowStatement(statement);
      case "AssertStatement":
        return this.analyzeAssertStatement(statement);
      case "IfStatement":
        return this.analyzeIfStatement(statement);
      case "MatchStatement":
        return this.matching.analyzeMatchStatement(statement);
      case "ForStatement":
        return this.analyzeForStatement(statement);
      case "WhileStatement":
        return this.analyzeWhileStatement(statement);
      case "BreakStatement":
      case "ContinueStatement":
        return this.analyzeBreakStatement(statement);
      case "TryStatement":
        return this.analyzeTryStatement(statement);
      case "PassStatement":
        break;
      case "AssignmentStatement":
        this.assignment.analyzeAssignment(statement);
        break;
      case "ExpressionStatement":
        return this.analyzeExpressionStatement(statement);
      case "DetachStatement":
        this.analyzeDetachStatement(statement);
        break;
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
  private analyzeImportDeclaration(statement: Extract<Statement, { kind: "ImportDeclaration" }>): void {
    // MOD-D1: the whole module-boundary family is module-top-level only.
    // A block-level import emitted invalid JavaScript, and a
    // function-body import silently bound `unknown` (the dependency walk
    // reads program.body only).
    if (this.scopeStack.scopes.length !== 1) {
      this.diagnostics.push(diagnostic("VEL3011", "Imports can only be declared at module scope", statement.span));
    }
    if (!this.predeclared.has(statement)) {
      for (const specifier of statement.specifiers) {
        this.declareBinding(
          specifier.local,
          false,
          this.moduleImports.importType(statement, specifier.local, specifier.imported, specifier.namespace, specifier.span),
          specifier.span,
          false,
          undefined,
          statement.source,
          importTypeNamePosition(statement, specifier),
        );
        this.moduleImports.recordImportedBindingSource(statement.javascript, statement.source, specifier.local, specifier.namespace ? null : specifier.imported);
        this.moduleImports.recordImportedBindingOrigin(specifier.local, statement.source, specifier.span);
        const reactive = this.reactiveBindings.get(specifier.local);
        if (reactive) this.markDeclaredBindingReactive(specifier.local, reactive);
      }
    }
  }

  private analyzeExternModuleDeclaration(statement: Extract<Statement, { kind: "ExternModuleDeclaration" }>): void {
    if (this.scopeStack.scopes.length !== 1) {
      this.diagnostics.push(diagnostic("VEL3011", "Extern modules can only be declared at module scope", statement.span));
    }
    this.checkExternModuleClasses(statement);
    for (const declaration of statement.functions) {
      this.checkTypeParameterDeclarations(declaration.typeParameters);
      this.withTypeParameterFrame(this.typeParameterFrame(declaration.typeParameters), () => {
        for (const parameter of declaration.parameters) {
          const classNames = new Set(statement.classes.map((item) => item.name));
          const type = this.moduleImports.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames);
          const valid = !parameter.type || !this.invalidExternTypeReferences.has(parameter.type);
          if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
        }
        const classNames = new Set(statement.classes.map((item) => item.name));
        const result = this.moduleImports.resolveValidatedExternAnnotation(declaration.returnType, statement.source, classNames);
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
  }

  /** Every `extern class` in one `extern module`: its base, its members, and its duplicates. */
  private checkExternModuleClasses(statement: Extract<Statement, { kind: "ExternModuleDeclaration" }>): void {
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
        const type = this.moduleImports.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames);
        const valid = !parameter.type || !this.invalidExternTypeReferences.has(parameter.type);
        if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
        if (parameter.binding) members.add(`instance:${parameter.name}`);
      }
      for (const field of declaration.fields) {
        this.classMembers.validateClassMemberName(field.name, field.span, true);
        const key = `${field.static ? "static" : "instance"}:${field.name}`;
        if (members.has(key)) this.typeError(`Extern class '${declaration.name}' declares member '${field.name}' more than once`, field.span);
        members.add(key);
      }
      for (const getter of declaration.getters) {
        this.classMembers.validateClassMemberName(getter.name, getter.span, true);
        const key = `${getter.static ? "static" : "instance"}:${getter.name}`;
        if (members.has(key)) this.typeError(`Extern class '${declaration.name}' declares member '${getter.name}' more than once`, getter.span);
        members.add(key);
      }
      for (const method of declaration.methods) {
        this.classMembers.validateClassMemberName(method.name, method.span, true);
        const key = `${method.static ? "static" : "instance"}:${method.name}`;
        if (members.has(key)) this.typeError(`Extern class '${declaration.name}' declares member '${method.name}' more than once`, method.span);
        members.add(key);
        this.checkTypeParameterDeclarations(method.typeParameters);
        this.withTypeParameterFrame(this.typeParameterFrame(method.typeParameters), () => {
          for (const parameter of method.parameters) {
            const type = this.moduleImports.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames);
            const valid = !parameter.type || !this.invalidExternTypeReferences.has(parameter.type);
            if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
          }
          if (method.returnType) {
            const result = this.moduleImports.resolveValidatedExternAnnotation(method.returnType, statement.source, classNames);
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
        const base = this.moduleImports.externClassIdentity(statement.source, declaration.base);
        const ownFields = [
          ...declaration.parameters.filter((parameter) => parameter.binding).map((parameter) => ({
            name: parameter.name,
            mutable: parameter.binding === "let",
            type: this.moduleImports.resolveValidatedExternAnnotation(parameter.type, statement.source, classNames),
            span: parameter.span,
          })),
          ...declaration.fields.filter((field) => !field.static).map((field) => ({
            name: field.name,
            mutable: field.mutable,
            type: this.moduleImports.resolveValidatedExternAnnotation(field.type, statement.source, classNames),
            span: field.span,
          })),
        ];
        for (const field of ownFields) {
          if (this.classInheritance.findMethod(base, field.name) || this.classInheritance.findGetter(base, field.name)) {
            this.typeError(`Extern field '${field.name}' conflicts with an inherited executable member`, field.span);
          }
          const inherited = this.classInheritance.findField(base, field.name);
          if (inherited && (inherited.mutable !== field.mutable || !sameType(inherited.type, field.type))) {
            this.typeError(`Inherited extern field '${field.name}' must keep its ${inherited.mutable ? "let" : "const"} ${describeType(inherited.type)} contract`, field.span);
          }
        }
        for (const getter of declaration.getters.filter((item) => !item.static)) {
          if (this.classInheritance.findField(base, getter.name) || this.classInheritance.findMethod(base, getter.name)) {
            this.typeError(`Extern getter '${getter.name}' conflicts with an inherited field or method`, getter.span);
          }
          const inherited = this.classInheritance.findGetter(base, getter.name);
          const own = this.moduleImports.resolveValidatedExternAnnotation(getter.type, statement.source, classNames);
          if (inherited && !sameType(inherited.type, own)) {
            this.typeError(`Extern getter override '${getter.name}' must keep the base result ${describeType(inherited.type)}`, getter.span);
          }
        }
        for (const method of declaration.methods.filter((item) => !item.static)) {
          if (this.classInheritance.findField(base, method.name) || this.classInheritance.findGetter(base, method.name)) {
            this.typeError(`Extern method '${method.name}' conflicts with an inherited field or getter`, method.span);
          }
          const inherited = this.classInheritance.findMethod(base, method.name);
          const own = this.moduleImports.externFunctionType(method, (reference) => this.moduleImports.resolveValidatedExternAnnotation(reference, statement.source, classNames));
          if (inherited && !sameTypeIgnoringCallableParameterNames(inherited.type, own)) {
            this.typeError(`Extern override '${method.name}' must keep the base method signature ${describeType(inherited.type)}`, method.span);
          }
        }
      }
    }
  }

  private analyzeEmbeddedJavaScriptDeclaration(statement: Extract<Statement, { kind: "EmbeddedJavaScriptDeclaration" }>): void {
    if (this.scopeStack.scopes.length !== 1) {
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
  }

  private analyzeTypeDeclaration(statement: Extract<Statement, { kind: "TypeDeclaration" }>): void {
    // Shapes are only registered from module scope (registerTypeShapes
    // walks program.body), so a nested declaration would analyze against
    // a missing — or worse, a same-named module-level — shape.
    if (this.scopeStack.scopes.length !== 1) {
      this.diagnostics.push(diagnostic("VEL3011", "Types can only be declared at module scope", statement.span));
    }
    this.typeRecords.analyzeTypeDeclaration(statement);
  }

  private analyzeEnumDeclaration(statement: Extract<Statement, { kind: "EnumDeclaration" }>): void {
    if (this.scopeStack.scopes.length !== 1) {
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
  }

  private analyzeClassDeclaration(statement: Extract<Statement, { kind: "ClassDeclaration" }>): void {
    // registerClassShapes only walks program.body, so a nested class body
    // would be analyzed against the module-level shape of the same name
    // (silent wrong types) and `export class` in a block emits invalid
    // JavaScript.
    if (this.scopeStack.scopes.length !== 1) {
      this.diagnostics.push(diagnostic("VEL3011", "Classes can only be declared at module scope", statement.span));
    }
    this.classMembers.analyzeClassDeclaration(statement);
  }

  private analyzeVariableDeclaration(statement: Extract<Statement, { kind: "VariableDeclaration" }>): void {
    // MOD-D1: `export const`/`export let` below module scope emitted an
    // `export` statement inside a block — invalid JavaScript.
    if (statement.exported && this.scopeStack.scopes.length !== 1) {
      this.diagnostics.push(diagnostic("VEL3011", "Exports can only be declared at module scope", statement.span));
    }
    const annotated = statement.type ? this.resolveAnnotation(statement.type) : null;
    const annotationValid = statement.type ? this.validateTypeReference(statement.type) : true;
    const actual = this.inferExpression(statement.initializer, annotationValid ? annotated ?? unknownType : invalidType);
    // D44 rule 71: an unannotated alias of an assignment-established fact
    // declares the source's domain and re-establishes the fact below, so
    // the alias keeps the declared question testable (`taken != null`
    // stays a real check) while reads still see the refined type.
    const aliasSource = !annotated ? this.equality.assignedFactDomain(statement.initializer, actual) : actual;
    const inferredStorage = statement.binding === "let" && !annotated
      ? this.contextual.widenAggregateSingleton(aliasSource)
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
      this.scopeStack.collectPatternNames(statement.pattern, (name) => exported.push(name));
      this.moduleExports.reportExportedAny(exported, statement.span);
    }
    const unsettled = this.requireSettledCollectionElement(statement.initializer, declared, annotated !== null);
    this.scopeStack.declarePattern(statement.pattern, statement.binding === "let", unsettled ? invalidType : declared, unsettled ? invalidType : contract);
    if (statement.binding === "const" && statement.pattern.kind === "NameBindingPattern") {
      const declaredBinding = this.scopeStack.scopes.at(-1)?.get(statement.pattern.name);
      if (declaredBinding) declaredBinding.stableOptionalCopy = true;
    }
    if (annotated === null) this.contextual.recordBindingHoleSource(statement.pattern, statement.initializer, unsettled);
    this.moduleInitialization.claimArrowDeferredFrame(statement.pattern, statement.initializer);
    // D51 rule 101: an alias of an owned handle — or a closure over one —
    // is the same resource under a second name, so it inherits the
    // ownership and the escape check follows it.
    if (statement.pattern.kind === "NameBindingPattern") {
      const carried = this.classRoles.carriedOwnedResource(statement.initializer);
      const declaredBinding = carried ? this.scopeStack.scopes.at(-1)?.get(statement.pattern.name) : null;
      if (carried && declaredBinding) declaredBinding.ownedResource = carried;
    }
    this.scopeStack.validateKnownBindingShape(statement.pattern, statement.initializer);
    // D44 rule 71: the initializer's type is a fact for each declared
    // binding — `const x: string? = "a"` reads as string until a write
    // says otherwise.
    if (annotationValid) this.narrowing.establishAssignedPatternFacts(statement.pattern, actual);
    if (statement.pattern.kind === "NameBindingPattern") {
      const binding = this.scopeStack.scopes.at(-1)?.get(statement.pattern.name);
      if (binding?.span.start === statement.pattern.span.start && binding.span.end === statement.pattern.span.end) {
        if (this.expandAliases(actual).kind === "promise") this.promiseInitializerBindings.add(binding);
      }
    }
  }

  private analyzeMainBlock(statement: Extract<Statement, { kind: "MainBlock" }>): void {
    if (this.scopeStack.scopes.length !== 1) {
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
  }

  private analyzeFunctionDeclarationStatement(statement: Extract<Statement, { kind: "FunctionDeclaration" }>): void {
    // MOD-D1: `export def` below module scope emitted invalid JavaScript.
    if (statement.exported && this.scopeStack.scopes.length !== 1) {
      this.diagnostics.push(diagnostic("VEL3011", "Exports can only be declared at module scope", statement.span));
    }
    // D39 item 53: one spelling. `def test_*` discovery is retired, so the
    // name that used to mean "this is a test" gets pointed at the block.
    if (statement.name.startsWith("test_") && this.scopeStack.scopes.length === 1 && (this.modulePath ?? "").endsWith(".test.vel")) {
      this.diagnostics.push(diagnostic(
        "VEL3019",
        `Write 'test "${statement.name.slice("test_".length).replaceAll("_", " ")}":' and move the body into it; a test's name is a sentence the owner reads, and 'def test_*' discovery is retired`,
        statement.signatureSpan,
      ));
    }
    this.analyzeFunctionDeclaration(statement, null);
  }

  private analyzeReturnStatement(statement: Extract<Statement, { kind: "ReturnStatement" }>): void {
    if (this.constructorDepth > 0) {
      this.diagnostics.push(diagnostic("VEL3014", "'return' cannot be used directly in a constructor", statement.span));
      return;
    }
    if (this.functionDepth === 0) {
      this.diagnostics.push(diagnostic("VEL3003", "'return' can only be used inside a function", statement.span));
      return;
    }
    if (this.finallyLoopDepths.length > 0) {
      this.diagnostics.push(diagnostic("VEL3015", "'return' cannot leave a finally block; assign a result before finally and return afterward", statement.span));
    }
    const returnContext = this.returnContexts.at(-1);
    const expected = returnContext?.expected ?? unknownType;
    const inferredReturns = returnContext?.inferredReturns ?? null;
    const actual = statement.value ? this.inferExpression(statement.value, inferredReturns ? unknownType : expected) : nullType;
    // D51 rule 101: a return always leaves the scope that releases.
    if (statement.value) this.classRoles.rejectOwnedResourceEscape(statement.value, "returning it", statement.value.span);
    const asynchronous = this.asynchronousFunctions.at(-1) === true;
    const returned = asynchronous ? this.resolvedAsyncResult(actual) : actual;
    if (asynchronous && statement.value) {
      if (inferredReturns || !this.promiseResolutionHazard(expected)) {
        this.reportPromiseResolutionHazard(returned, statement.value.span);
      }
      if (this.promiseResolutionNeedsRuntimeGuard(returned)) {
        this.lowering.asyncResolvedValues.add(spanIdentity(statement.value.span));
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
        const carried = statement.value !== null && this.contextual.collectResultHoleSources(statement.value, causes);
        if (causes.size > 0) returnContext.resultHoleCauses = causes;
        if (unsettled || carried) returnContext.unsettledResult = true;
      }
      if (this.unreachableDiagnosticDepth === 0) inferredReturns.push(unsettled ? invalidType : returned);
      return;
    }
    if (this.unreachableDiagnosticDepth === 0) returnContext?.observedReturns?.push(returned);
    this.requireAssignable(returned, expected, statement.value?.span ?? statement.span);
  }

  private analyzeThrowStatement(statement: Extract<Statement, { kind: "ThrowStatement" }>): void {
    const thrown = this.inferExpression(statement.value);
    const throwable = (type: ValueType): boolean => type.kind === "class"
      ? this.isSubclassOf(type.identity ?? type.name, "Error")
      : type.kind === "union" && type.members.every(throwable);
    if (!throwable(thrown) && !isInvalidType(thrown)) {
      this.typeError(`Only Error values can be thrown, received ${describeType(thrown)}`, statement.value.span);
    }
  }

  private analyzeAssertStatement(statement: Extract<Statement, { kind: "AssertStatement" }>): void {
    const condition = this.inferExpression(statement.condition);
    this.requireCondition(condition, statement.condition);
    if (statement.message) {
      const baseline = this.flowFacts.snapshotFlowFacts();
      this.flowFacts.analyzeIsolatedFlow(baseline, () => {
        const message = this.narrowing.inferNarrowedExpression(
          statement.message!,
          this.negativeNarrowingFor(statement.condition, condition),
          stringType,
        );
        this.requireAssignable(message, stringType, statement.message!.span);
      });
    }
    this.narrowing.persistNarrowings(this.narrowingFor(statement.condition, condition));
  }

  private analyzeIfStatement(statement: Extract<Statement, { kind: "IfStatement" }>): void {
    const condition = this.inferExpression(statement.condition);
    this.requireCondition(condition, statement.condition);
    const truthy = this.narrowingFor(statement.condition, condition);
    const falsy = this.negativeNarrowingFor(statement.condition, condition);
    const baseline = this.flowFacts.snapshotFlowFacts();
    const continuingInvalidations: FlowFactInvalidations[] = [];
    let thenFacts: ReadonlyMap<string, ValueType> = new Map();
    const thenInvalidations = this.flowFacts.analyzeIsolatedFlow(baseline, () => {
      thenFacts = this.analyzeBlock(statement.thenBody, truthy);
    });
    // A branch ending in return/throw never rejoins this flow; a branch
    // ending in break/continue never reaches the statement after the if
    // either — its writes are carried to the enclosing loop's merge points
    // by the break/continue capture instead.
    const thenExits = this.matchCoverage.blockAlwaysExits(statement.thenBody);
    if (!thenExits) continuingInvalidations.push(thenInvalidations);
    let elseFacts: ReadonlyMap<string, ValueType> = new Map();
    let elseExits = false;
    if (statement.elseBody) {
      const elseInvalidations = this.flowFacts.analyzeIsolatedFlow(baseline, () => {
        elseFacts = this.analyzeBlock(statement.elseBody!, falsy);
      });
      elseExits = this.matchCoverage.blockAlwaysExits(statement.elseBody);
      if (!elseExits) continuingInvalidations.push(elseInvalidations);
    }
    this.flowMerge.applyFlowInvalidations(continuingInvalidations, !statement.elseBody);
    if (!statement.elseBody && thenExits) this.narrowing.persistNarrowings(falsy);
    else if (statement.elseBody && thenExits && !elseExits) this.narrowing.persistNarrowings(elseFacts);
    else if (statement.elseBody && elseExits && !thenExits) this.narrowing.persistNarrowings(thenFacts);
    else if (statement.elseBody && !thenExits && !elseExits) {
      this.narrowing.persistNarrowings(this.flowMerge.commonNarrowings([thenFacts, elseFacts]));
    }
  }

  private analyzeForStatement(statement: Extract<Statement, { kind: "ForStatement" }>): void {
    // The emitted loop head evaluates the iterable inside the loop
    // binding's temporal dead zone, so an iterable reference to a name
    // the pattern declares cannot reach the outer binding the analyzer
    // resolves. The names are pending only while the iterable is
    // inferred: the loop binding owns its name in the loop head and
    // body alone, so earlier statements of the same scope still read
    // the outer binding.
    const pendingLoopNames: string[] = [];
    {
      const pending = this.scopeStack.pendingScopeDeclarations.at(-1)!;
      for (const pattern of [statement.pattern, statement.secondPattern]) {
        if (!pattern) continue;
        this.scopeStack.collectPatternNames(pattern, (name) => {
          if (!pending.has(name)) {
            pending.set(name, { span: pattern.span, loopHead: true });
            pendingLoopNames.push(name);
          }
        });
      }
    }
    const inferredIterable = this.contextual.inferAnnotationFreeHead(statement.iterable);
    if (!statement.asynchronous
      && statement.secondPattern === null
      && statement.pattern.kind === "NameBindingPattern"
      && statement.iterable.kind === "CallExpression"
      && statement.iterable.callee.kind === "IdentifierExpression"
      && this.lowering.builtinValueReferences.get(spanIdentity(statement.iterable.callee.span)) === "range") {
      this.lowering.nativeRangeForStatements.add(statement.span.start);
    }
    // D68 rule 177 + D90 R18: the eight plain consumers project through
    // the synchronous `@iterate:` answer; `async for` reads the
    // asynchronous form's declaration inside asyncPullElementType, so the
    // asynchronous side takes the operand unprojected.
    const iterable = statement.asynchronous ? inferredIterable : this.classRoles.iterationSource(statement.iterable, inferredIterable);
    const binaryIterable = !statement.asynchronous && binaryStorageKind(iterable) !== null;
    if (!statement.asynchronous
      && (iterable.kind === "list" || iterable.kind === "map" || iterable.kind === "set" || iterable.kind === "record" || iterable.kind === "string")) {
      this.lowering.collectionIterations.set(statement.span.start, iterable.kind);
    } else if (binaryIterable) {
      this.lowering.collectionIterations.set(statement.span.start, "binary");
    }
    for (const name of pendingLoopNames) this.scopeStack.pendingScopeDeclarations.at(-1)!.delete(name);
    const { first, second } = this.loopSlotTypes(statement, iterable, binaryIterable);
    if (!statement.asynchronous) this.advisoryRoster.adviseSwappedLoopSlots(statement, iterable);
    const baseline = this.flowFacts.snapshotFlowFacts();
    this.loops.contexts.push({ baseline, visible: this.flowMerge.visibleBindings(), carried: [], backEdges: [], breakFacts: [], sawBreak: false });
    const diagnosticStart = this.diagnostics.length;
    const bodyInvalidations = this.flowFacts.analyzeIsolatedFlow(baseline, () => {
      this.enterScope();
      try {
        this.scopeStack.declarePattern(statement.pattern, false, first);
        if (statement.secondPattern) this.scopeStack.declarePattern(statement.secondPattern, false, second);
        if (!statement.asynchronous && statement.iterable.kind === "ListExpression"
          && statement.iterable.elements.every((item) => item.kind !== "SpreadExpression")) {
          for (const item of statement.iterable.elements) {
            this.scopeStack.validateKnownBindingShape(statement.pattern, item);
          }
        }
        this.loopDepth += 1;
        this.analyzeStatements(statement.body);
        this.loopDepth -= 1;
      } finally {
        this.exitScope();
      }
    });
    const loopFlow = this.loops.contexts.pop()!;
    const backEdges = [
      ...(!this.matchCoverage.blockAlwaysExits(statement.body) ? [bodyInvalidations] : []),
      ...loopFlow.backEdges,
    ];
    this.loops.reanalyzeLoopBackEdge(baseline, loopFlow.visible, backEdges, statement.body, diagnosticStart, () => {
      this.enterScope();
      try {
        this.scopeStack.declarePattern(statement.pattern, false, first);
        if (statement.secondPattern) this.scopeStack.declarePattern(statement.secondPattern, false, second);
        if (!statement.asynchronous && statement.iterable.kind === "ListExpression"
          && statement.iterable.elements.every((item) => item.kind !== "SpreadExpression")) {
          for (const item of statement.iterable.elements) {
            this.scopeStack.validateKnownBindingShape(statement.pattern, item);
          }
        }
        this.loopDepth += 1;
        this.analyzeStatements(statement.body);
        this.loopDepth -= 1;
      } finally {
        this.exitScope();
      }
    });
    if (this.matchCoverage.blockAlwaysReturns(statement.body)) this.flowMerge.applyFlowInvalidations(loopFlow.carried);
    else this.flowMerge.applyFlowInvalidations([bodyInvalidations, ...loopFlow.carried]);
  }

  /**
   * What the two `for` slots hold: `value, index` for the synchronous forms, and
   * the pulled element with its ordinal for `async for`.
   */
  private loopSlotTypes(
    statement: Extract<Statement, { kind: "ForStatement" }>,
    iterable: ValueType,
    binaryIterable: boolean,
  ): { readonly first: ValueType; readonly second: ValueType } {
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
      first = this.classRoles.asyncPullElementType(iterable, statement.iterable.span, statement.span.start);
      second = numberType;
      this.lowering.asyncForStatements.add(statement.span.start);
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
          : `Cannot iterate over ${describeType(iterable)}${this.classRoles.iterationGuidance(iterable)}`, statement.iterable.span);
      }
    }
    return { first, second };
  }

  private analyzeWhileStatement(statement: Extract<Statement, { kind: "WhileStatement" }>): void {
    const condition = this.inferExpression(statement.condition);
    this.requireCondition(condition, statement.condition);
    const truthy = this.narrowingFor(statement.condition, condition);
    const falsy = this.negativeNarrowingFor(statement.condition, condition);
    const baseline = this.flowFacts.snapshotFlowFacts();
    this.loops.contexts.push({ baseline, visible: this.flowMerge.visibleBindings(), carried: [], backEdges: [], breakFacts: [], sawBreak: false });
    const diagnosticStart = this.diagnostics.length;
    const bodyInvalidations = this.flowFacts.analyzeIsolatedFlow(baseline, () => {
      this.loopDepth += 1;
      this.analyzeBlock(statement.body, truthy);
      this.loopDepth -= 1;
    });
    const loopFlow = this.loops.contexts.pop()!;
    const backEdges = [
      ...(!this.matchCoverage.blockAlwaysExits(statement.body) ? [bodyInvalidations] : []),
      ...loopFlow.backEdges,
    ];
    // FLW-S1: a loop the body can re-enter tests its condition again in
    // the back-edge state, so the exit fact is what both tests agree on.
    let repeatedFalsy: ReadonlyMap<string, ValueType> | null = null;
    const backEdgePass = this.loops.reanalyzeLoopBackEdge(baseline, loopFlow.visible, backEdges, statement.body, diagnosticStart, () => {
      this.loops.clearCachedFlowTypesInSpan(statement.condition.span);
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
    if (this.matchCoverage.blockAlwaysReturns(statement.body)) {
      // The loop can only be left through a captured break/continue arm or
      // by the condition failing, so only the carried writes escape it.
      this.flowMerge.applyFlowInvalidations(loopFlow.carried);
    } else {
      this.flowMerge.applyFlowInvalidations([bodyInvalidations, ...loopFlow.carried]);
    }
    // FLW-S1 (charter section 9): without a break the only way out is the
    // condition failing, so its negated fact holds after the loop — for
    // the common body that neither returns nor breaks, not just the body
    // that always returns. A break can leave while the condition still
    // holds, so one break drops the fact entirely.
    if (!loopFlow.sawBreak) {
      // A widened exit confirmed nothing about the back edge, so it keeps
      // nothing: the condition's fact holds only if the second test agrees.
      this.narrowing.persistNarrowings(backEdgePass.widened
        ? new Map()
        : repeatedFalsy === null ? falsy : this.flowMerge.joinedNarrowings(falsy, repeatedFalsy));
    } else if (statement.condition.kind === "LiteralExpression" && statement.condition.value === true) {
      // FLW-N6: `while true:` has no failing condition, so its breaks are
      // its only exits, and what every one of them proves holds after the
      // loop. A loop whose condition can also fail keeps nothing: that
      // exit proves none of it.
      const breakFacts = [...loopFlow.breakFacts, ...(backEdgePass.repeated?.breakFacts ?? [])];
      if (breakFacts.length > 0 && !backEdgePass.widened) this.narrowing.persistNarrowings(this.flowMerge.commonNarrowings(breakFacts));
    }
  }

  private analyzeBreakStatement(statement: Extract<Statement, { kind: "BreakStatement" }> | Extract<Statement, { kind: "ContinueStatement" }>): void {
    if (this.loopDepth === 0) {
      this.diagnostics.push(diagnostic("VEL3005", `'${statement.kind === "BreakStatement" ? "break" : "continue"}' can only be used in a loop`, statement.span));
    } else if (this.finallyLoopDepths.some((depth) => this.loopDepth <= depth)) {
      this.diagnostics.push(diagnostic("VEL3015", `'${statement.kind === "BreakStatement" ? "break" : "continue"}' cannot leave a finally block`, statement.span));
    } else {
      const context = this.loops.contexts.at(-1);
      if (context && this.loops.contexts.length > this.loopCaptureFloor) {
        const invalidations = this.flowFacts.flowInvalidationsSince(context.baseline);
        context.carried.push(invalidations);
        if (statement.kind === "ContinueStatement") context.backEdges.push(invalidations);
        if (statement.kind === "BreakStatement") {
          context.sawBreak = true;
          // FLW-N6: this break is one of the loop's exits, so record what
          // it proves. The merge after the loop keeps only what every
          // exit agrees on.
          context.breakFacts.push(this.flowMerge.narrowingsForVisibleBindings(context.visible));
        }
      }
    }
  }

  private analyzeTryStatement(statement: Extract<Statement, { kind: "TryStatement" }>): void {
    const baseline = this.flowFacts.snapshotFlowFacts();
    let tryFacts: ReadonlyMap<string, ValueType> = new Map();
    const tryInvalidations = this.flowFacts.analyzeIsolatedFlow(baseline, () => {
      tryFacts = this.analyzeBlock(statement.tryBody);
    });
    const continuingInvalidations: FlowFactInvalidations[][] = [];
    const continuingFacts: ReadonlyMap<string, ValueType>[] = [];
    if (!this.matchCoverage.blockAlwaysReturns(statement.tryBody)) {
      continuingInvalidations.push([tryInvalidations]);
      continuingFacts.push(tryFacts);
    }

    let catchInvalidations: FlowFactInvalidations | null = null;
    if (statement.catchBody) {
      const catchBaseline = this.flowFacts.flowSnapshotAfterInvalidations(baseline, [tryInvalidations]);
      let catchFacts: ReadonlyMap<string, ValueType> = new Map();
      catchInvalidations = this.flowFacts.analyzeIsolatedFlow(catchBaseline, () => {
        const visible = this.flowMerge.visibleBindings();
        this.enterScope();
        try {
          if (statement.catchName) {
            this.declareBinding(statement.catchName, false, { kind: "class", name: "Error" }, statement.span);
          }
          this.analyzeStatements(statement.catchBody!);
          catchFacts = this.flowMerge.narrowingsForVisibleBindings(visible);
        } finally {
          this.exitScope();
        }
      });
      if (!this.matchCoverage.blockAlwaysReturns(statement.catchBody)) {
        continuingInvalidations.push([tryInvalidations, catchInvalidations]);
        continuingFacts.push(catchFacts);
      }
    }

    if (statement.finallyBody) {
      const beforeFinally = this.flowFacts.flowSnapshotAfterInvalidations(
        baseline,
        catchInvalidations ? [tryInvalidations, catchInvalidations] : [tryInvalidations],
      );
      let finallyFacts: ReadonlyMap<string, ValueType> = new Map();
      const finallyInvalidations = this.flowFacts.analyzeIsolatedFlow(beforeFinally, () => {
        this.finallyLoopDepths.push(this.loopDepth);
        try {
          finallyFacts = this.analyzeBlock(statement.finallyBody!);
        } finally {
          this.finallyLoopDepths.pop();
        }
      });
      if (!this.matchCoverage.blockAlwaysReturns(statement.finallyBody) && continuingFacts.length > 0) {
        this.flowFacts.restoreFlowFacts(beforeFinally);
        this.flowMerge.applyFlowInvalidations([finallyInvalidations]);
        this.narrowing.persistNarrowings(finallyFacts);
      } else {
        this.flowFacts.restoreFlowFacts(baseline);
      }
    } else {
      this.flowFacts.restoreFlowFacts(baseline);
      this.flowMerge.applyFlowInvalidations(continuingInvalidations.flat());
      if (continuingFacts.length > 0) {
        this.narrowing.persistNarrowings(this.flowMerge.commonNarrowings(continuingFacts));
      }
    }
  }

  private analyzeExpressionStatement(statement: Extract<Statement, { kind: "ExpressionStatement" }>): void {
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
      return;
    }
    const type = this.inferExpression(statement.expression);
    this.checkFloatingPromiseStatement(type, statement.expression);
    this.checkDiscardedExpressionResult(statement.expression, type);
    this.checkDiscardedPureResult(statement.expression);
  }

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
    const collectionOperation = this.lowering.collectionCalls.get(expression.callee.span.end);
    const primitiveOperation = this.lowering.primitiveCalls.get(expression.callee.span.end);
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

  /**
   * D39 item 53: `test "name":` is one test. Its body is an async frame — a
   * test awaits its own work — and its name is the product specification a
   * person reads, so it must be present, unique in the module, and declared
   * where the runner actually looks.
   */
  private analyzeTestDeclaration(statement: TestDeclaration): void {
    if (!this.inModuleInitializationPosition() || this.scopeStack.scopes.length !== 1) {
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
   * D43 item 69 rule 6: `using` needs a scope exit to release at. The module
   * top level has none — it lives until the process ends. An extension whose
   * body is not an ordinary scope adds its own answer.
   */
  protected ownershipScopeRejection(): string | null {
    return this.inModuleInitializationPosition()
      ? "A module lives until the process ends, so a module-level 'using' has no scope to release at; own the resource inside a function, or use 'const' and release it explicitly"
      : null;
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
    // D55 rule 120 layer two: an instance member of a generic class is read
    // under the class's parameters as well as its own; a static one is not,
    // because it belongs to the class rather than to an instantiation.
    const memberClassParameters = declareSelf ? this.classRegistry.classTypeParameterDeclarations(className) : undefined;
    this.classMembers.rejectClassTypeParameterRedeclaration(memberClassParameters, statement.typeParameters, className);
    const outerStaticTypeParameters = this.staticMemberTypeParameters;
    if (!declareSelf && className) {
      const classParameters = this.classRegistry.classTypeParameterDeclarations(className);
      if (classParameters) {
        this.staticMemberTypeParameters = { className, names: new Set(classParameters.map((parameter) => parameter.name)) };
      }
    }
    this.typeParameterFrames.push(this.classRegistry.memberTypeParameterFrame(memberClassParameters, statement.typeParameters));
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
      this.declareBinding("self", false, this.classRegistry.selfClassType(className), statement.span, true);
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
      const inferred = this.inferCollectedFunctionResult(observedReturns, !this.matchCoverage.blockAlwaysReturns(statement.body));
      this.reportInferredNullResult(statement, declarationKind, inferred);
    }
    const resultKey = this.functionResultKey(statement as FunctionDeclaration);
    if (inferredReturns) {
      const inferred = this.inferCollectedFunctionResult(inferredReturns, !this.matchCoverage.blockAlwaysReturns(statement.body));
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
      if (typeContainsAnyOutput(inferred)) this.moduleExports.recordExportedAny(statement, className, statement.signatureSpan);
      this.updateInferredCallableResult(statement, className, callableBinding, inferred, asynchronous);
    } else {
      const effectiveResult = returnValid ? declaredReturn : invalidType;
      this.inferredFunctionResultTypes.set(resultKey, effectiveResult);
      this.updateInferredCallableResult(statement, className, callableBinding, effectiveResult, asynchronous);
    }
    if (statement.returnType && returnValid && expectedReturn.kind !== "null" && !this.matchCoverage.blockAlwaysReturns(statement.body)) {
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
    this.staticMemberTypeParameters = outerStaticTypeParameters;
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
    const visible = this.flowMerge.visibleBindings();
    this.enterScope();
    this.applyNarrowings(narrowed, statements[0]?.span ?? { start: 0, end: 0 });
    this.analyzeStatements(statements);
    const surviving = this.flowMerge.narrowingsForVisibleBindings(visible);
    this.exitScope();
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
        this.loopCaptureFloor = Math.max(previousFloor, this.loops.contexts.length);
        this.unreachableDiagnosticDepth += 1;
        this.analyzeStatement(statement);
        this.unreachableDiagnosticDepth -= 1;
        this.loopCaptureFloor = previousFloor;
      } else {
        this.analyzeStatement(statement);
        if (this.matchCoverage.statementAlwaysExitsBlock(statement)) {
          completedFlow = this.flowFacts.snapshotFlowFacts();
        }
      }
      this.advisoryRoster.adviseManualCollectionConversion(previous, statement);
      this.advisoryRoster.adviseManualListPipeline(previous, statement);
      this.adviseManualListQuery(previous, statement);
      previous = statement;
    }
    if (completedFlow) this.flowFacts.restoreFlowFacts(completedFlow);
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
      const namespace = this.lowering.builtinValueReferences.get(spanIdentity(expression.span));
      if (namespace && namespace !== "range" && !this.memberAccessReceivers.has(spanIdentity(expression.span))) {
        this.typeError(
          `'${namespace}' is a namespace, not a value; name the member you need — '${namespace}.${this.moduleImports.firstNamespaceMember(namespace)}(...)' — a namespace cannot be called, passed, stored, spread, or destructured`,
          expression.span,
        );
        type = invalidType;
      }
    }
    this.inferredExpressionTypes.set(spanIdentity(expression.span), type);
    const expanded = this.expandAliases(type);
    if (expanded.kind === "promise") {
      this.lowering.normalizedPromiseValues.add(spanIdentity(expression.span));
    } else if (this.shouldNormalizeNullish(expression, expanded)) {
      this.lowering.normalizedUndefinedExpressions.add(spanIdentity(expression.span));
    }
    this.semanticIndex.recordSemanticExpression(expression, type);
    return type;
  }

  private inferredOrAnalyze(expression: Expression): ValueType {
    return this.inferredExpressionTypes.get(spanIdentity(expression.span)) ?? this.inferExpression(expression);
  }

  private hasNullishContract(type: ValueType): boolean {
    return type.kind === "null" || type.kind === "optional" || type.kind === "unknown"
      || type.kind === "union" && type.members.some((member) => this.hasNullishContract(this.expandAliases(member)));
  }

  private shouldNormalizeNullish(expression: Expression, type: ValueType): boolean {
    if (!this.hasNullishContract(type) || this.lowering.expressionAlreadyNormalizesUndefined(expression)) return false;
    return expression.kind !== "LiteralExpression";
  }

  private inferExpressionType(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    const extensionType = this.inferExtensionExpression(expression, contextualType);
    if (extensionType) return extensionType;
    const coreDuration = this.binary.inferCoreDurationExpression(expression);
    if (coreDuration) return coreDuration;
    switch (expression.kind) {
      case "LiteralExpression":
        return expression.value === null ? nullType : typeof expression.value === "string" ? stringType : typeof expression.value === "number" ? numberType : boolType;
      case "FStringExpression":
        for (const part of expression.parts) {
          if (part.kind !== "expression") continue;
          this.text.requireTextConvertible(this.inferExpression(part.value), part.value.span, "f-string");
        }
        return stringType;
      case "IdentifierExpression":
        return this.identifiers.inferIdentifier(expression, contextualType);
      case "SuperExpression":
        // CLS-C2: `super` reaches base methods and getters, and the message
        // that names what may follow it must name both.
        this.typeError("'super' must be followed by a base method or getter name", expression.span);
        return unknownType;
      case "DynamicImportExpression":
        return { kind: "promise", value: this.dynamicImports.get(expression.source) ?? unknownType };
      case "ListExpression":
        return this.literals.inferList(expression, contextualType);
      case "ObjectExpression":
        return this.literals.inferObject(expression, contextualType);
      case "SpreadExpression":
        return this.inferExpression(expression.value);
      case "UnaryExpression":
        return this.operators.inferUnary(expression, contextualType);
      case "RequiredExpression":
        return this.operators.inferRequired(expression, contextualType);
      case "TryExpression":
        return this.operators.inferTry(expression, contextualType);
      case "BinaryExpression":
        return this.binary.inferBinary(expression.left, expression.operator, expression.right, expression.span, contextualType);
      case "AssignmentExpression": {
        // A parser-recovered assignment-in-expression: both sides are analyzed
        // so their own guidance still surfaces, and the recovery produces no
        // value because assignment is a statement.
        const target = this.inferExpression(expression.target);
        this.inferExpression(expression.value, isInvalidType(target) ? unknownType : target);
        return nullType;
      }
      case "ComparisonChainExpression":
        return this.binary.inferComparisonChain(expression, contextualType);
      case "ConditionalExpression":
        return this.operators.inferConditional(expression, contextualType);
      case "IsExpression":
        return this.operators.inferIs(expression, contextualType);
      case "ArrowFunctionExpression":
        return this.inferArrow(expression, contextualType);
      case "CallExpression":
        return this.inferCall(expression, contextualType);
      case "MemberExpression":
        return this.members.inferMember(expression.object, expression.property, expression.optional, expression.span);
      case "IndexExpression":
        return this.operators.inferIndex(expression, contextualType);
      default:
        return unknownType;
    }
  }

  private inferCall(expression: Extract<Expression, { kind: "CallExpression" }>, contextualType: ValueType): ValueType {
      if (expression.callee.kind === "IdentifierExpression" && this.collections.retired.importOrigins.has(expression.callee.name)) {
        this.collections.retired.calls.set(spanIdentity(expression.callee.span), expression);
      }
      this.moduleInitialization.recordDeferredCallEdge(expression.callee, expression.span);
      if (expression.typeArgumentsRemoved === true) this.typeArgumentsRemovedCalls.add(spanIdentity(expression.span));
      const result = this.calls.inferCall(expression.callee, expression.arguments, expression.argumentNames, expression.span, contextualType, expression.optional);
      if (this.expandAliases(result).kind === "null") this.lowering.normalizedNullResults.add(spanIdentity(expression.span));
      return result;
  }

  /**
   * D114 0.28.0 B-I2: the two statement heads that have no annotation slot.
   * VEL2036 refuses `using r: Res<number> = ...` — a `using` binding takes its
   * type from the initializer — and a `for value in ...:` head has no slot at
   * all, so "annotate the position" was a remedy neither one could carry out.
   * A head is marked while its expression is inferred, so every construction
   * anywhere inside it is in it, and the report that needs to know asks
   * `inAnnotationFreeHead`. A count rather than a flag: the mark is released by
   * the head that set it, on the way out of its own inference.
   */
  private annotationFreeHeads = 0;

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
    const expanded = this.typeReferences.resolveNamedClasses(this.expandAliases(type));
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
    if (this.classInheritance.findGetter(identity, "then") || this.classInheritance.findGetter(expanded.name, "then")) {
      return `class '${expanded.name}' exposes a 'then' getter that Promise resolution would execute`;
    }
    if (this.classInheritance.findMethod(identity, "then") || this.classInheritance.findMethod(expanded.name, "then")) {
      return `class '${expanded.name}' exposes a callable 'then' method`;
    }
    const field = this.classInheritance.findField(identity, "then") ?? this.classInheritance.findField(expanded.name, "then");
    return field && this.callableThenMember(field.type)
      ? `class '${expanded.name}' exposes a callable 'then' field`
      : null;
  }

  private promiseResolutionNeedsRuntimeGuard(type: ValueType): boolean {
    if (isInvalidType(type)) return false;
    const expanded = this.typeReferences.resolveNamedClasses(this.expandAliases(type));
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
      && this.contextual.contextuallyAssignable(bodyResult, contextualResult, expression.body.span)
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
        this.lowering.asyncResolvedValues.add(spanIdentity(expression.body.span));
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
          const type = this.classRoles.iterationSource(argument.value, this.inferExpression(argument.value));
          if (!rest) this.typeError("Call spread requires a callable with a rest parameter", argument.span);
          else if (fixedIndex < parameters.length) {
            this.typeError(`Provide all ${parameters.length} fixed argument${parameters.length === 1 ? "" : "s"} before a call spread`, argument.span);
          } else if (type.kind === "list") this.requireAssignable(type.element, rest, argument.span);
          if (type.kind !== "list" && type.kind !== "any") {
            this.typeError(`Call spread requires a List, received ${describeType(type)}${this.classRoles.iterationGuidance(type)}`, argument.span);
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
    const plan = this.calls.planNamedArguments(
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
      this.flowFacts.recordFlowFactOrigin(binding);
      binding.type = type;
      binding.declaredType = type;
      binding.storageType = type;
      this.semanticIndex.recordSemanticBinding(`${binding.span.start}:${statement.name}`, type);
    }
    if (!className) return;
    const method = statement as FunctionDeclaration & { readonly static?: boolean; readonly private?: boolean; readonly accessor?: boolean };
    const info = this.classRegistry.classInfo(className);
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

  private functionType(statement: FunctionDeclaration, classParameters?: readonly TypeParameterDeclaration[]): ValueType {
    // D55 rule 120 layer two: a method of a generic class is checked under its
    // own parameters *and* the class's, but only its own are solved at a call —
    // the class's are already fixed by the receiver. So the frame carries both
    // and the callable publishes the first ones only; everything above that
    // count is a class parameter, which `substituteClassMemberType` supplies
    // when the class is instantiated.
    const frame = this.classRegistry.memberTypeParameterFrame(classParameters, statement.typeParameters);
    const own = this.typeParameterFrame(statement.typeParameters);
    const bounds = this.typeParameterBoundVector(statement.typeParameters);
    return this.withTypeParameterFrame(frame, () => {
      const result = this.inferredFunctionResult(statement);
      const rest = statement.parameters.find((parameter) => parameter.rest);
      return {
        kind: "function",
        ...(own.size > 0 ? { typeParameterNames: [...own.keys()] } : {}),
        ...(own.size > 0 && bounds ? { typeParameterBounds: bounds } : {}),
        parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.resolveValidatedAnnotation(parameter.type)),
        parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
        requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
        ...(rest ? { rest: this.resolveValidatedAnnotation(rest.type) } : {}),
        result: statement.asynchronous ? { kind: "promise", value: this.resolvedAsyncResult(result) } : result,
      };
    });
  }

  protected narrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType> {
    return this.narrowing.conditionNarrowing(expression, true, knownType);
  }

  protected negativeNarrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType> {
    return this.narrowing.conditionNarrowing(expression, false, knownType);
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
    this.locations.checkGetterNarrowingTest(condition);
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
        this.lowering.truthConditions.add(spanIdentity(condition.span));
        return;
      }
      const subject = this.guidance.conditionSubjectText(condition);
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
    const type = this.typeReferences.resolveNamedClasses(this.expandAliases(source));
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
    const type = this.typeReferences.resolveNamedClasses(this.expandAliases(source));
    return type.kind === "object"
      && ["field", "file", "files", "remove", "has", "names"].every((name) => type.fields.has(name));
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
        return this.text.isTextConvertible(expanded);
      case "Comparable":
        return this.equality.orderedTypeCategory(expanded) !== null;
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
      } else if (builtinTypeNames.has(declaration.name)) {
        // D114 0.28.0 F-I1: the fifth position that introduces a type name.
        // The other four say *why* the name is taken — it is Core's, and every
        // use of it resolves to the built-in — while this one said only that
        // something already had it, in the same words a user type earns. One
        // sentence over one roster; the code stays this position's own VEL4021.
        this.diagnostics.push(diagnostic("VEL4021", builtinTypeNameDeclarationMessage(declaration.name, "type parameter"), declaration.span));
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
    // D77 rule 194 item 2: a class carries no per-instantiation validator —
    // `instanceof Stack` cannot tell `Stack<number>` from `Stack<string>` — so
    // the arguments are refused in the same words a type parameter is, and for
    // the same reason. A generic *record* is monomorphized and stays checkable.
    const erasedClass = this.erasedClassArgumentCheck(checked);
    if (erasedClass) {
      this.diagnostics.push(diagnostic(
        "VEL4022",
        `Type arguments are erased at runtime, so '${describeType(erasedClass)}' cannot be checked; check '${erasedClass.application!.name}' itself`,
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

  /** The first class instantiation inside a runtime-checked type, if the type carries one. */
  private erasedClassArgumentCheck(type: ValueType): Extract<ValueType, { kind: "class" }> | null {
    if (type.kind === "class") return type.application ? type : null;
    if (type.kind === "optional") return this.erasedClassArgumentCheck(type.inner);
    if (type.kind === "union") {
      for (const member of type.members) {
        const found = this.erasedClassArgumentCheck(member);
        if (found) return found;
      }
      return null;
    }
    if (type.kind === "list" || type.kind === "set") return this.erasedClassArgumentCheck(type.element);
    if (type.kind === "map") return this.erasedClassArgumentCheck(type.key) ?? this.erasedClassArgumentCheck(type.value);
    if (type.kind === "record") return this.erasedClassArgumentCheck(type.value);
    if (type.kind === "object") {
      for (const field of type.fields.values()) {
        const found = this.erasedClassArgumentCheck(field);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * D77 rule 194 item 2: `is Stack` and `case Stack:` are the two positions a
   * bare generic class name may stand in — the check is `instanceof`, which
   * says nothing about the arguments. Only the outermost name is allowed to be
   * bare; `is List<Stack>` still needs `Stack`'s arity, because that check does
   * read the argument.
   */
  private allowBareGenericClassName(reference: TypeReference): void {
    if (reference.syntax.kind === "NamedTypeSyntax") this.bareGenericClassPositions.add(reference.syntax);
  }

  /**
   * D77 rule 194 item 2: what a bare `is Stack` proves about the subject. The
   * check confirms the family and nothing else, so a subject that already names
   * its arguments keeps them, and one that does not gains the only arguments an
   * `instanceof` can prove — `unknown` at every position.
   */
  private erasedClassCheckType(source: ValueType, checked: ValueType): ValueType {
    if (checked.kind !== "class" || checked.application) return checked;
    const parameters = this.classRegistry.classInfo(checked.identity ?? checked.name)?.typeParameterNames;
    if (!parameters?.length) return checked;
    const known: ValueType[] = [];
    const collect = (candidate: ValueType): void => {
      const expanded = this.expandAliases(candidate);
      if (expanded.kind === "union") {
        for (const member of expanded.members) collect(member);
        return;
      }
      if (expanded.kind === "optional") return collect(expanded.inner);
      if (expanded.kind === "class" && expanded.application
        && this.isSubclassOf(expanded.identity ?? expanded.name, checked.identity ?? checked.name)) {
        known.push(expanded);
      }
    };
    collect(source);
    if (known.length > 0) return unionOf(known);
    const erased = classApplicationType(
      checked.identity ?? checked.name,
      checked.name,
      parameters.map(() => unknownType),
    );
    this.generics.noteGenericApplications(erased);
    return erased;
  }

  protected resolveAnnotation(reference: TypeReference | null): ValueType {
    return reference ? this.typeReferences.resolveNamedClasses(this.expandAliases(this.resolveRawTypeReference(reference))) : unknownType;
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

  moduleInitializationImportReads(): readonly InitializationImportRead[] {
    return this.moduleInitialization.moduleInitializationImportReads();
  }

  protected inModuleInitializationPosition(): boolean {
    return this.functionDepth === 0
      && this.parameterDefaultDepth === 0
      && this.instanceFieldInitializerDepth === 0
      && this.deferredExecutionDepth === 0;
  }

  // A reactive state declaration owns its resolved lexical binding identity,
  // even when an outer reactive binding uses the same spelling.
  protected markDeclaredBindingReactive(name: string, kind: "state" | "prop" = "state"): void {
    const binding = this.scopeStack.scopes.at(-1)?.get(name);
    if (binding) {
      binding.reactiveKind = kind;
    }
  }

  protected reactiveBindingKind(name: string): "state" | "prop" | null {
    return this.lookup(name)?.reactiveKind ?? null;
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

  protected isBuiltinValueReference(expression: Expression, name: PermanentNamespaceName | "range"): boolean {
    return this.lowering.builtinValueReferences.get(spanIdentity(expression.span)) === name;
  }

  protected applyNarrowings(narrowed: ReadonlyMap<string, ValueType>, narrowingSpan: Span): void {
    this.narrowing.applyNarrowings(narrowed, narrowingSpan);
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
    this.scopeStack.declareBinding(name, mutable, type, declarationSpan, internal, declaredType, importSource, typeNamePosition);
  }

  protected isTopLevelScope(): boolean {
    return this.scopeStack.isTopLevelScope();
  }

  protected markTypeNameRefused(name: string): void {
    this.scopeStack.markTypeNameRefused(name);
  }

  protected lookup(name: string): Binding | null {
    return this.scopeStack.lookup(name);
  }

  protected prescanScopeDeclarations(statements: readonly Statement[]): void {
    this.scopeStack.prescanScopeDeclarations(statements);
  }

  protected enterScope(): void {
    this.scopeStack.scopes.push(new Map());
    this.flowFacts.enterScope();
    this.scopeStack.pendingScopeDeclarations.push(new Map());
    this.scopeStack.scopedNames.push([]);
  }

  protected exitScope(): void {
    this.scopeStack.scopes.pop();
    this.scopeStack.pendingScopeDeclarations.pop();
    for (const name of this.scopeStack.scopedNames.pop() ?? []) this.scopeStack.nearestNames.remove(name);
    // The bindings this scope created are unreachable now, so the flow-fact
    // working set shrinks with it rather than growing across the module.
    this.flowFacts.exitScope();
  }
}
