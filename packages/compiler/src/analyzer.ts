import { Advisories, type AdvisoryHost } from "./analysis/advisories.ts";
import { argumentNoun, boundVocabularyGuidance, CallInference, continuesOptionalChain, type CallInferenceHost } from "./analysis/calls.ts";
import { discardedPurePrimitiveOperations, MemberAccess, type MemberAccessHost } from "./analysis/members.ts";
import {
  CollectionInference,
  type CollectionInferenceHost,
  CORE_LIST_METHOD_NAMES,
  CORE_MAP_METHOD_NAMES,
  CORE_RECORD_METHOD_NAMES,
  CORE_SET_METHOD_NAMES,
  discardedPureCollectionOperations,
  mutatingCollectionMethods,
} from "./analysis/collections.ts";
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
// `./analysis/collections.ts`. `mutatingCollectionMethods` is the one name of
// that cluster this module published, so it is re-exported here and an existing
// `from "./analyzer.ts"` import of it keeps working unchanged.
export { mutatingCollectionMethods } from "./analysis/collections.ts";
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
      recordProjectionShape: (type) => this.recordProjectionShape(type),
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
      requireMembershipIntersection: (probe, domain, probeSpan, operation) => this.requireMembershipIntersection(probe, domain, probeSpan, operation),
      rejectFreshCollectionProbe: (probe, operation, probes) => this.rejectFreshCollectionProbe(probe, operation, probes),
      rejectCollidingKeyDomain: (keySource, keySpan, position) => { this.rejectCollidingKeyDomain(keySource, keySpan, position); },
      expandAliases: (type) => this.expandAliases(type),
      readonlyDataViewOf: (type) => this.readonlyDataViewOf(type),
      inferExpression: (expression, contextualType) => this.inferExpression(expression, contextualType),
      inferredOrAnalyze: (expression) => this.inferredOrAnalyze(expression),
      inferredExpressionType: (expression) => this.inferredExpressionType(expression),
      recordSemanticExpression: (expression, type) => { this.recordSemanticExpression(expression, type); },
      concreteCallableFor: (actual, expected, errorSpan) => this.concreteCallableFor(actual, expected, errorSpan),
      isAssignableHere: (actual, expected) => isAssignable(actual, expected, this),
      checkArguments: (arguments_, parameters, callSpan, requiredParameters) => { this.checkArguments(arguments_, parameters, callSpan, requiredParameters); },
      planNamedArguments: (arguments_, argumentNames, parameters, parameterNames, requiredParameters, callSpan, rest) =>
        this.calls.planNamedArguments(arguments_, argumentNames, parameters, parameterNames, requiredParameters, callSpan, rest),
      orderedTypeCategory: (source) => this.orderedTypeCategory(source),
      unorderedTypeGuidance: (...types) => this.unorderedTypeGuidance(...types),
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
      boundaryReceiverText: (expression) => analyzer.boundaryReceiverText(expression),
      callExpressionCallees: analyzer.callExpressionCallees,
      checkArguments: (arguments_, parameters, callSpan, requiredParameters, rest, argumentNames, parameterNames) => { analyzer.checkArguments(arguments_, parameters, callSpan, requiredParameters, rest, argumentNames, parameterNames); },
      checkTestMatcherComparand: (calleeExpression, arguments_) => { analyzer.checkTestMatcherComparand(calleeExpression, arguments_); },
      get classFieldInitializerDepth() { return analyzer.classFieldInitializerDepth; },
      classInfo: (key) => analyzer.classRegistry.classInfo(key),
      classes: analyzer.classes,
      collections: analyzer.collections,
      commentPreservingMechanicalFix: (rewriteSpan, replacement, title) => analyzer.commentPreservingMechanicalFix(rewriteSpan, replacement, title),
      concreteCallableFor: (actual, expected, errorSpan) => analyzer.concreteCallableFor(actual, expected, errorSpan),
      get constructorDepth() { return analyzer.constructorDepth; },
      contextualCollectionType: (type) => analyzer.contextualCollectionType(type),
      get currentClass() { return analyzer.currentClass; },
      diagnostics: analyzer.diagnostics,
      enumMeetDomain: (left, right) => analyzer.enumMeetDomain(left, right),
      equalityGuidance: (leftSource, rightSource) => analyzer.equalityGuidance(leftSource, rightSource),
      equalityTypesIntersect: (leftSource, rightSource) => analyzer.equalityTypesIntersect(leftSource, rightSource),
      equalsDomainViolation: (source, seen) => analyzer.equalsDomainViolation(source, seen),
      expandAliases: (type, seen) => analyzer.expandAliases(type, seen),
      fieldsOf: (identity) => analyzer.fieldsOf(identity),
      formReadField: (name, source, fieldSpan) => analyzer.formReadField(name, source, fieldSpan),
      inAnnotationFreeHead: () => analyzer.inAnnotationFreeHead(),
      inModuleInitializationPosition: () => analyzer.inModuleInitializationPosition(),
      inferExpression: (expression, contextualType) => analyzer.inferExpression(expression, contextualType),
      inferExtensionCall: (_callee, _arguments, _argumentNames, _callSpan) => analyzer.inferExtensionCall(_callee, _arguments, _argumentNames, _callSpan),
      inferPrimitiveCall: (member, arguments_, argumentNames, callSpan) => analyzer.members.inferPrimitiveCall(member, arguments_, argumentNames, callSpan),
      inferRecordFromCall: (member, sourceArguments, argumentNames, callSpan) => analyzer.inferRecordFromCall(member, sourceArguments, argumentNames, callSpan),
      inferRecordMapFromCall: (member, sourceArguments, argumentNames, callSpan) => analyzer.inferRecordMapFromCall(member, sourceArguments, argumentNames, callSpan),
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
      recordRuntimeObjectShape: (expression, owner) => { analyzer.recordRuntimeObjectShape(expression, owner); },
      rejectCollidingKeyDomain: (keySource, span, position) => { analyzer.rejectCollidingKeyDomain(keySource, span, position); },
      rejectDisjointEnumValidatorProbe: (calleeExpression, arguments_) => { analyzer.rejectDisjointEnumValidatorProbe(calleeExpression, arguments_); },
      reportPromiseCarrierHazard: (type, errorSpan) => { analyzer.reportPromiseCarrierHazard(type, errorSpan); },
      reportPromiseResolutionHazard: (type, errorSpan) => { analyzer.reportPromiseResolutionHazard(type, errorSpan); },
      requireAssignable: (actual, expected, valueSpan) => { analyzer.requireAssignable(actual, expected, valueSpan); },
      requireTextConvertible: (type, span, site) => { analyzer.requireTextConvertible(type, span, site); },
      runtimeTypeObjectValue: (type) => analyzer.runtimeTypeObjectValue(type),
      satisfiesBound: (type, bound) => analyzer.satisfiesBound(type, bound),
      sourceText: analyzer.sourceText,
      testExpectOperands: analyzer.testExpectOperands,
      typeAliases: analyzer.typeAliases,
      typeArgumentsRemovedCalls: analyzer.typeArgumentsRemovedCalls,
      typeError: (message, errorSpan, fix) => { analyzer.typeError(message, errorSpan, fix); },
      typesIntersect: (leftSource, rightSource, enumStringVeto) => analyzer.typesIntersect(leftSource, rightSource, enumStringVeto),
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
      equalityMayCompareNaN: (type) => analyzer.equalityMayCompareNaN(type),
      equalityOperandMayBeNaN: (expression, type) => analyzer.equalityOperandMayBeNaN(expression, type),
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
      recordSemanticBinding: (key, type) => { analyzer.recordSemanticBinding(key, type); },
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
      inferAnnotationFreeHead: (expression) => analyzer.inferAnnotationFreeHead(expression),
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
      boundaryValidationGuidance: (expression, property) => analyzer.boundaryValidationGuidance(expression, property),
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
      rejectCollidingKeyDomain: (keySource, span, position) => { analyzer.rejectCollidingKeyDomain(keySource, span, position); },
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
      conditionSubjectText: (condition) => analyzer.conditionSubjectText(condition),
      containsInferredResultPlaceholder: (type) => containsInferredResultPlaceholder(type),
      get currentClass() { return analyzer.currentClass; },
      get diagnostics() { return analyzer.diagnostics; },
      enterScope: () => { analyzer.enterScope(); },
      get enums() { return analyzer.enums; },
      equalityTypesIntersect: (left, right) => analyzer.equalityTypesIntersect(left, right),
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

  private memberHost(): MemberAccessHost {
    // The same live reads a call makes: the class under analysis, the `super`
    // context, the static-initialization frame, the walk depths.
    const analyzer = this;
    return {
      aliasedEnumTarget: (name) => analyzer.enumDeclarations.aliasedEnumTarget(name),
      get analysisExtensions() { return analyzer.analysisExtensions; },
      get asynchronousFunctions() { return analyzer.asynchronousFunctions; },
      boundaryValidationGuidance: (expression, property) => analyzer.boundaryValidationGuidance(expression, property),
      get callExpressionCallees() { return analyzer.callExpressionCallees; },
      checkArguments: (arguments_, parameters, callSpan, requiredParameters, rest, argumentNames, parameterNames) => { analyzer.checkArguments(arguments_, parameters, callSpan, requiredParameters, rest, argumentNames, parameterNames); },
      classInfo: (key) => analyzer.classRegistry.classInfo(key),
      get classes() { return analyzer.classes; },
      get collections() { return analyzer.collections; },
      conditionSubjectText: (condition) => analyzer.conditionSubjectText(condition),
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
      recordSemanticExpression: (expression, type) => { analyzer.recordSemanticExpression(expression, type); },
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
        this.analyzeAssignment(statement);
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
      this.scopeStack.collectPatternNames(statement.pattern, (name) => exported.push(name));
      this.moduleExports.reportExportedAny(exported, statement.span);
    }
    const unsettled = this.requireSettledCollectionElement(statement.initializer, declared, annotated !== null);
    this.scopeStack.declarePattern(statement.pattern, statement.binding === "let", unsettled ? invalidType : declared, unsettled ? invalidType : contract);
    if (statement.binding === "const" && statement.pattern.kind === "NameBindingPattern") {
      const declaredBinding = this.scopeStack.scopes.at(-1)?.get(statement.pattern.name);
      if (declaredBinding) declaredBinding.stableOptionalCopy = true;
    }
    if (annotated === null) this.recordBindingHoleSource(statement.pattern, statement.initializer, unsettled);
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
        const carried = statement.value !== null && this.collectResultHoleSources(statement.value, causes);
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
    const inferredIterable = this.inferAnnotationFreeHead(statement.iterable);
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
        this.scopeStack.reportUnresolvedName(statement.target.name, statement.target.span);
        return;
      }
      this.scopeStack.checkShadowedRead(statement.target.name, statement.target.span);
      if (binding.reactiveKind) this.lowering.reactiveReferences.set(spanIdentity(statement.target.span), binding.reactiveKind);
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
      targetType = this.members.inferMember(
        statement.target.object,
        statement.target.property,
        statement.target.optional,
        statement.target.span,
        operator !== "=",
        operator !== "=",
      );
      const owner = nonOptional(this.expandAliases(this.inferredOrAnalyze(statement.target.object)));
      if (owner.kind === "union" && this.locations.dataFieldIsReadonly(owner, statement.target.property)) {
        this.diagnostics.push(diagnostic(
          "VEL3002",
          `Cannot assign field '${statement.target.property}' through ${describeType(owner)} because at least one variant exposes it as read-only; narrow the owner first`,
          statement.target.span,
        ));
        targetWritable = false;
      } else if (owner.kind === "class") {
        const key = owner.identity ?? owner.name;
        const info = this.classRegistry.classInfo(key) ?? this.classRegistry.classInfo(owner.name);
        const privateField = this.classInheritance.privateFieldForAccess(key, statement.target.property, false);
        const privateMethod = this.classInheritance.privateMethodForAccess(key, statement.target.property, false);
        const field = this.classInheritance.findField(key, statement.target.property);
        const getter = this.classInheritance.findGetter(key, statement.target.property);
        const method = this.classInheritance.findMethod(key, statement.target.property);
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
        const privateField = this.classInheritance.privateFieldForAccess(key, statement.target.property, true);
        const privateMethod = this.classInheritance.privateMethodForAccess(key, statement.target.property, true);
        const field = this.classInheritance.findStaticField(key, statement.target.property);
        const getter = this.classInheritance.findStaticGetter(key, statement.target.property);
        const method = this.classInheritance.findStaticMethod(key, statement.target.property);
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
        this.lowering.binaryIndexes.set(spanIdentity(statement.target.span), binaryKind);
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
        this.lowering.collectionIndexes.set(spanIdentity(statement.target.span), "list");
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
        this.lowering.collectionIndexes.set(spanIdentity(statement.target.span), "record");
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
    const carriedValue = this.classRoles.carriedOwnedResource(statement.value);
    if (carriedValue) {
      const targetDepth = statement.target.kind === "IdentifierExpression"
        ? this.classRoles.bindingScopeDepth(statement.target.name)
        : 0;
      if (targetDepth < carriedValue.depth) {
        this.classRoles.rejectOwnedResourceEscape(statement.value, "storing it here", statement.value.span);
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
        this.locations.invalidateAliasableMemberNarrowings(statement.target);
        if (operator === "=") this.narrowing.establishAssignedMemberFact(statement.target, valueType, targetType);
      } else if (operator === "=") {
        this.locations.invalidateAssignmentNarrowings(statement.target, targetBinding);
        if (targetBinding?.mutable) {
          const storageBinding = targetBinding.storageBinding ?? targetBinding;
          const rebound = storageBinding.declaredType.kind !== "unknown" ? storageBinding.declaredType : valueType;
          this.flowFacts.recordFlowFactOrigin(storageBinding);
          this.flowFacts.recordFlowFactOrigin(targetBinding);
          storageBinding.storageType = rebound;
          if (storageBinding.narrowingFrame === null) storageBinding.type = rebound;
          targetBinding.storageType = rebound;
          targetBinding.type = rebound;
        }
        // D44 rule 71: the assignment establishes the right-hand side's type
        // as the location's fact (`x = maybeNull()` establishes nothing —
        // the assigned type must actually refine the declared one).
        if (statement.target.kind === "IdentifierExpression") {
          this.locations.invalidateShadowedNarrowings(statement.target.name, targetBinding);
          this.narrowing.establishAssignedFact(statement.target.name, valueType);
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

  private shouldNormalizeNullish(expression: Expression, type: ValueType): boolean {
    if (!this.hasNullishContract(type) || this.lowering.expressionAlreadyNormalizesUndefined(expression)) return false;
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
      case "IdentifierExpression":
        return this.inferIdentifier(expression, contextualType);
      case "SuperExpression":
        // CLS-C2: `super` reaches base methods and getters, and the message
        // that names what may follow it must name both.
        this.typeError("'super' must be followed by a base method or getter name", expression.span);
        return unknownType;
      case "DynamicImportExpression":
        return { kind: "promise", value: this.dynamicImports.get(expression.source) ?? unknownType };
      case "ListExpression":
        return this.inferList(expression, contextualType);
      case "ObjectExpression":
        return this.inferObject(expression, contextualType);
      case "SpreadExpression":
        return this.inferExpression(expression.value);
      case "UnaryExpression":
        return this.inferUnary(expression, contextualType);
      case "RequiredExpression":
        return this.inferRequired(expression, contextualType);
      case "TryExpression":
        return this.inferTry(expression, contextualType);
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
      case "ComparisonChainExpression":
        return this.inferComparisonChain(expression, contextualType);
      case "ConditionalExpression":
        return this.inferConditional(expression, contextualType);
      case "IsExpression":
        return this.inferIs(expression, contextualType);
      case "ArrowFunctionExpression":
        return this.inferArrow(expression, contextualType);
      case "CallExpression":
        return this.inferCall(expression, contextualType);
      case "MemberExpression":
        return this.members.inferMember(expression.object, expression.property, expression.optional, expression.span);
      case "IndexExpression":
        return this.inferIndex(expression, contextualType);
      default:
        return unknownType;
    }
  }

  private inferIdentifier(expression: Extract<Expression, { kind: "IdentifierExpression" }>, contextualType: ValueType): ValueType {
      const lexical = this.lookup(expression.name);
      const binding = lexical ?? this.scopeStack.builtin(expression.name);
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
          const access = this.members.memberAccessProperties.get(spanIdentity(expression.span));
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
          const owner = this.moduleImports.retiredNamespaceOwning(expression.name);
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
        this.scopeStack.reportUnresolvedName(expression.name, expression.span);
        return unknownType;
      }
      if (lexical) {
        // D52 rule 116: a read of a name imported from a module that has a
        // permanent namespace is part of that import's migration — the one
        // rewrite moves the prefix onto every one of them. The span identity
        // is what proves the read reached the import and not a local of the
        // same name shadowing it, so a shadowed read is left alone.
        const origin = this.namespaceImports.origins.get(expression.name);
        if (origin && lexical.span.start === origin.specifier.start && lexical.span.end === origin.specifier.end) {
          this.namespaceImports.reads.push({ local: expression.name, source: origin.source, imported: origin.imported, span: expression.span });
        }
        // D114 S3: the same proof for the retired velar/collections names —
        // the specifier's span identity is what shows the read reached the
        // import rather than a local of the same name shadowing it.
        const retired = this.collections.retired.importOrigins.get(expression.name);
        if (retired && lexical.span.start === retired.specifier.start && lexical.span.end === retired.specifier.end) {
          this.collections.retired.importReads.push({ local: expression.name, imported: retired.imported, span: expression.span });
        }
      }
      if (!lexical && (isPermanentNamespaceName(expression.name) || expression.name === "range")) {
        this.lowering.builtinValueReferences.set(spanIdentity(expression.span), expression.name);
      }
      // D51 rule 101: every arrow frame this read sits inside captures the
      // owned handle, so a nested arrow taints its enclosing arrows too.
      if (binding.ownedResource && this.arrowCaptureFrames.length > 0) {
        for (const frame of this.arrowCaptureFrames) frame.captured ??= binding.ownedResource;
      }
      this.scopeStack.checkShadowedRead(expression.name, expression.span);
      this.moduleInitialization.recordInitializationImportRead(binding, expression.name, expression.span);
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
      if (binding.reactiveKind) this.lowering.reactiveReferences.set(spanIdentity(expression.span), binding.reactiveKind);
      if (binding.narrowingFrame !== null && !this.isStableOptionalValueCopy(binding)) {
        this.lowering.runtimeNarrowings.set(spanIdentity(expression.span), {
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

  private inferList(expression: Extract<Expression, { kind: "ListExpression" }>, contextualType: ValueType): ValueType {
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
        const itemType = item.kind === "SpreadExpression" ? this.classRoles.iterationSource(item.value, inferredItem) : inferredItem;
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
          else if (itemType.kind !== "any") this.typeError(`Cannot spread ${describeType(itemType)} into a list${this.classRoles.iterationGuidance(itemType)}`, item.span);
        } else {
          element = mergeTypes(element, expectedElement.kind === "unknown" ? this.widenAggregateSingleton(itemType) : itemType);
          if (expectedElement.kind !== "unknown") {
            if (!this.contextuallyAssignable(itemType, expectedElement, item.span)) matchesContext = false;
            this.requireAssignable(itemType, expectedElement, item.span);
          }
        }
      }
      const inferredList: ValueType = { kind: "list", element };
      this.advisoryRoster.adviseTupleShapedListLiteral(expression, contextualType, writtenElementTypes, element);
      if (matchesContext && collectionContext?.kind === "list") {
        return collectionContext;
      }
      return inferredList;
  }

  private inferObject(expression: Extract<Expression, { kind: "ObjectExpression" }>, contextualType: ValueType): ValueType {
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
          this.advisoryRoster.adviseRedundantObjectProperty(property);
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
        this.advisoryRoster.adviseManualRecordProjection(expression, objectContext, contextualType);
        this.advisoryRoster.adviseManualMappedRecordProjection(expression, objectContext, contextualType);
      }
      return expectedRecordValue
        ? { kind: "record", value: expectedRecordValue }
        : { kind: "object", fields, ...(optionalFields.size > 0 ? { optionalFields } : {}) };
  }

  private inferUnary(expression: Extract<Expression, { kind: "UnaryExpression" }>, contextualType: ValueType): ValueType {
      // D114 item ①: `await` adds no position of its own, it passes the
      // enclosing one through. The awaited operand is matched against
      // `Promise` of what the position expects — the only shape an operand
      // of `await` could have produced that value with — so `const rows:
      // List<string> = await loadAll(url)` solves the call's `T` exactly as
      // the unawaited spelling does. `try` is transparent the same way
      // already (its operand takes the non-optional part of the position)
      // and parentheses carry no node at all, so `try await (...)` composes
      // without any of the three knowing about the others.
      const operand = this.inferExpression(
        expression.operand,
        expression.operator === "await" ? this.awaitedOperandContext(contextualType) : unknownType,
      );
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
          if (result.kind === "null" && !this.lowering.normalizedPromiseValues.has(spanIdentity(expression.operand.span))) {
            this.lowering.normalizedNullResults.add(spanIdentity(expression.span));
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

  private inferRequired(expression: Extract<Expression, { kind: "RequiredExpression" }>, contextualType: ValueType): ValueType {
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

  private inferTry(expression: Extract<Expression, { kind: "TryExpression" }>, contextualType: ValueType): ValueType {
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

  private inferComparisonChain(expression: Extract<Expression, { kind: "ComparisonChainExpression" }>, contextualType: ValueType): ValueType {
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
          const surviving = this.flowMerge.survivingNarrowings(successful);
          if (operator !== "==" && operator !== "!=") {
            this.requireOrderedComparison(types[index]!, rightType, left, right, expression.span);
          } else if (this.rejectFreshCollectionEquality(index === 0 ? left : right, right, operator)) {
            // A fresh literal chain link is already constant; nothing else to learn.
          } else if (this.equalityOperandMayBeNaN(left, types[index]!) && this.equalityOperandMayBeNaN(right, rightType)) {
            this.lowering.sameValueZeroEqualities.add(spanIdentity({ start: left.span.start, end: right.span.end }));
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
      this.narrowing.logicalConditionNarrowings.set(spanIdentity(expression.span), { truthy: successful, falsy: new Map() });
      return types.some(isInvalidType) ? invalidType : boolType;
  }

  private inferConditional(expression: Extract<Expression, { kind: "ConditionalExpression" }>, contextualType: ValueType): ValueType {
      {
        const condition = this.inferExpression(expression.condition);
        this.requireCondition(condition, expression.condition);
        const baseline = this.flowFacts.snapshotFlowFacts();
        let thenType = unknownType;
        const thenInvalidations = this.flowFacts.analyzeIsolatedFlow(baseline, () => {
          thenType = this.narrowing.inferNarrowedExpression(
            expression.thenValue,
            this.narrowingFor(expression.condition, condition),
            contextualType,
          );
        });
        let elseType = unknownType;
        const elseInvalidations = this.flowFacts.analyzeIsolatedFlow(baseline, () => {
          elseType = this.narrowing.inferNarrowedExpression(
            expression.elseValue,
            this.negativeNarrowingFor(expression.condition, condition),
            contextualType,
          );
        });
        this.flowMerge.applyFlowInvalidations([thenInvalidations, elseInvalidations], false);
        if (this.contextualObjectType(contextualType)
          && this.contextuallyAssignable(thenType, contextualType, expression.thenValue.span)
          && this.contextuallyAssignable(elseType, contextualType, expression.elseValue.span)) {
          this.contextualAssignments.set(spanIdentity(expression.span), contextualType);
        }
        return mergeTypes(thenType, elseType);
      }
  }

  private inferIs(expression: Extract<Expression, { kind: "IsExpression" }>, contextualType: ValueType): ValueType {
      const subject = this.inferExpression(expression.value);
      this.allowBareGenericClassName(expression.type);
      const checked = this.resolveAnnotation(expression.type);
      const valid = this.validateTypeReference(expression.type);
      if (valid && this.rejectErasedRuntimeCheck(checked, expression.type.span)) return invalidType;
      if (valid && checked.kind === "class") {
        this.lowering.classChecks.add(spanIdentity(expression.span));
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

  private inferIndex(expression: Extract<Expression, { kind: "IndexExpression" }>, contextualType: ValueType): ValueType {
      const original = this.expandAliases(this.inferExpression(expression.object));
      const guarded = expression.optional && (original.kind === "optional" || original.kind === "null");
      if (!expression.optional && original.kind === "optional") {
        this.typeError(`Use optional index '?.[...]' for ${describeType(original)}`, expression.span);
      }
      if (original.kind === "null" && expression.optional) {
        const baseline = this.flowFacts.snapshotFlowFacts();
        this.flowFacts.analyzeIsolatedFlow(baseline, () => {
          this.inferExpression(expression.index);
        });
        this.lowering.optionalIndexes.add(spanIdentity(expression.span));
        return optionalOf(unknownType);
      }
      const object = guarded && original.kind === "optional" ? original.inner : original;
      const index = guarded
        ? this.narrowing.withTemporaryNarrowings(
          this.narrowing.optionalExecutionNarrowings(expression.object),
          expression.index.span,
          () => this.inferExpression(expression.index),
        )
        : this.inferExpression(expression.index);
      if (isInvalidType(object)) return invalidType;
      const binaryKind = binaryStorageKind(object);
      if (binaryKind) {
        this.requireAssignable(index, numberType, expression.index.span);
        this.lowering.binaryIndexes.set(spanIdentity(expression.span), binaryKind);
        if (guarded) {
          this.lowering.optionalIndexes.add(spanIdentity(expression.span));
          return optionalOf(numberType);
        }
        return numberType;
      }
      if (object.kind === "list") {
        this.requireAssignable(index, numberType, expression.index.span);
        this.lowering.collectionIndexes.set(spanIdentity(expression.span), "list");
        const element = object.readonlyView ? this.readonlyDataViewOf(object.element) : object.element;
        if (guarded) {
          this.lowering.optionalIndexes.add(spanIdentity(expression.span));
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
        this.lowering.collectionIndexes.set(spanIdentity(expression.span), "record");
        if (guarded) this.lowering.optionalIndexes.add(spanIdentity(expression.span));
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
    const left = this.inferExpression(leftExpression, this.coalescingSubjectContext(operator, contextualType));
    if (operator === "and" || operator === "or") {
      this.requireCondition(left, leftExpression);
      const leftTruthy = this.narrowingFor(leftExpression, left);
      const leftFalsy = this.negativeNarrowingFor(leftExpression, left);
      const rightContext = operator === "and" ? leftTruthy : leftFalsy;
      const rightCondition = this.narrowing.inferConditionWithNarrowings(rightExpression, rightContext);
      this.narrowing.logicalConditionNarrowings.set(spanIdentity(operationSpan), {
        truthy: operator === "and" ? this.narrowing.combineNarrowings(rightCondition.surviving, rightCondition.truthy) : new Map(),
        falsy: operator === "or" ? this.narrowing.combineNarrowings(rightCondition.surviving, rightCondition.falsy) : new Map(),
      });
      return isInvalidType(left) || isInvalidType(rightCondition.type) ? invalidType : boolType;
    }
    if (operator === "??") {
      const expandedLeft = this.expandAliases(left);
      const fallbackContext = this.coalescingFallbackContext(expandedLeft, contextualType);
      const right = this.narrowing.inferNarrowedExpression(
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
      if (domainLeft !== left) this.lowering.runtimeNarrowings.delete(spanIdentity(leftExpression.span));
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
      const container = this.classRoles.iterationSource(rightExpression, right);
      if (container.kind === "list" || container.kind === "map" || container.kind === "set" || container.kind === "record" || container.kind === "string") {
        this.lowering.collectionMemberships.set(spanIdentity(operationSpan), container.kind);
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
          `Membership requires a List, Set, Map, Record, or string, received ${describeType(container)}${this.classRoles.iterationGuidance(container)}`,
          rightExpression.span,
        );
      }
      return boolType;
    }
    if (operator === "==" || operator === "!=") {
      if (this.rejectFreshCollectionEquality(leftExpression, rightExpression, operator)) return boolType;
      this.requireIntersectingEquality(left, right, operator, leftExpression, rightExpression, operationSpan);
      if (this.equalityOperandMayBeNaN(leftExpression, left) && this.equalityOperandMayBeNaN(rightExpression, right)) {
        this.lowering.sameValueZeroEqualities.add(spanIdentity(operationSpan));
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
    if (operator === "%") this.advisoryRoster.adviseNegativeLiteralModulo(leftExpression, rightExpression, operationSpan);
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
    if (left !== leftType) this.lowering.runtimeNarrowings.delete(spanIdentity(leftExpression.span));
    if (right !== rightType) this.lowering.runtimeNarrowings.delete(spanIdentity(rightExpression.span));
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
      const type = this.typeReferences.resolveNamedClasses(this.expandAliases(current));
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
    const target = this.enumDeclarations.enumTargetOfValidatorObject(calleeExpression.object);
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
      const path = this.locations.stableMemberAccessPath(expression);
      const narrowing = path ? this.locations.lookupMemberNarrowingEntry(path) : null;
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
    const left = this.typeReferences.resolveNamedClasses(this.expandAliases(leftSource));
    const right = this.typeReferences.resolveNamedClasses(this.expandAliases(rightSource));
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
    const left = this.typeReferences.resolveNamedClasses(this.expandAliases(leftSource));
    const right = this.typeReferences.resolveNamedClasses(this.expandAliases(rightSource));
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
    const type = this.typeReferences.resolveNamedClasses(this.expandAliases(source));
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
    const type = this.typeReferences.resolveNamedClasses(this.expandAliases(source));
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

  private inferAnnotationFreeHead(expression: Expression): ValueType {
    this.annotationFreeHeads += 1;
    try {
      return this.inferExpression(expression);
    } finally {
      this.annotationFreeHeads -= 1;
    }
  }

  protected inAnnotationFreeHead(): boolean {
    return this.annotationFreeHeads > 0;
  }

  private coalescingFallbackContext(left: ValueType, contextualType: ValueType): ValueType {
    const expandedContext = this.expandAliases(contextualType);
    if (expandedContext.kind !== "unknown" && !isInvalidType(expandedContext)) return contextualType;
    return left.kind === "optional" ? left.inner : unknownType;
  }

  /**
   * D114 0.28.0 A-I1: the *subject* of `??` stands in the position the
   * annotation names, exactly as its fallback does. `const xs: List<string> =
   * empty() ?? []` settled the empty literal on the right and left the generic
   * call on the left at `List<unknown>` — one `??` under one annotation
   * answering two ways, while both arms of a ternary already receive it. The
   * subject may be null, so what it is offered is the optional spelling of the
   * expected type; every reader of a contextual type looks through `optional`
   * already (section 8's empty-collection rule and the type-argument seed
   * both do). Every other operator's operands stay context-free: `??` is the
   * one whose subject the position's own type reaches.
   */
  private coalescingSubjectContext(operator: string, contextualType: ValueType): ValueType {
    if (operator !== "??") return unknownType;
    const expanded = this.expandAliases(contextualType);
    if (expanded.kind === "unknown" || expanded.kind === "any" || isInvalidType(expanded)) return unknownType;
    return expanded.kind === "optional" ? contextualType : optionalOf(contextualType);
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
      const marked = category === "string" ? this.lowering.stringOrderings : category === "comparable" ? this.lowering.dynamicOrderings : null;
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
    const type = this.typeReferences.resolveNamedClasses(this.expandAliases(source));
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





  /**
   * D41 item 61 check site 2: a generic callable used as a value is solved and
   * erased silently, so the wrapper re-asks the bound question and turns the
   * rejection into a directed message at the value's own span.
   */
  private instantiateCallable<T extends Extract<ValueType, { kind: "function" | "action" | "intrinsic" }>>(actual: T, expected: T, violations?: GenericBoundViolation[]): T {
    const instantiated = instantiateGenericCallable(actual, expected, this, violations) as T;
    this.generics.noteGenericApplications(instantiated);
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


  /** The reason a type cannot participate in equals(a, b), or null when it is pure data. */
  private equalsDomainViolation(source: ValueType, seen: Set<string> = new Set()): string | null {
    const type = this.typeReferences.resolveNamedClasses(this.expandAliases(source));
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

    const named = this.calls.planNamedArguments(
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
      this.lowering.recordFromCalls.set(spanIdentity(callSpan), {
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

    const named = this.calls.planNamedArguments(
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
      this.lowering.recordMapFromCalls.set(spanIdentity(callSpan), {
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
      this.recordSemanticBinding(`${binding.span.start}:${statement.name}`, type);
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
      if (this.classInheritance.findMethod(className, name) || this.classInheritance.findGetter(className, name)) matched.push(name);
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

  /**
   * D114 item ①: what an `await` says to the expression it awaits. A position
   * that expects `T` is awaiting something that produces `Promise<T>`, and a
   * position that expects nothing keeps expecting nothing — silence has to stay
   * silence, because section 8's empty-collection rule reads this same channel
   * and `await []` must go on saying exactly what it said.
   */
  private awaitedOperandContext(contextualType: ValueType): ValueType {
    const expanded = this.expandAliases(contextualType);
    if (expanded.kind === "unknown" || expanded.kind === "any" || isInvalidType(expanded)) return unknownType;
    return { kind: "promise", value: contextualType };
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

  // D42 item 65: the single place in the compiler that answers "is this
  // ordered". Every ordering site — direct `<` `<=` `>` `>=`, `min()`/`max()`,
  // default `sorted()`, and the `sorted(by=)`, `min(by=)` and `max(by=)` keys —
  // asks this one question, because four mechanisms giving three answers was the
  // structural root of ORD-1/2/3. `Comparable` is exactly `number`, `string`,
  // and single-category unions of them: enums are bare strings at runtime, so
  // ordering them silently yields member-name alphabetical order. `any` and
  // `unknown` answer "dynamic" instead of an order, and each caller decides
  // whether an unchecked boundary value is admissible there.
  private orderedTypeCategory(source: ValueType): "number" | "string" | "comparable" | "dynamic" | null {
    const type = this.typeReferences.resolveNamedClasses(this.expandAliases(source));
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
    const binding = this.scopeStack.scopes.at(-1)?.get(pattern.name);
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
      .map((name) => [name, this.members.stringMember(name)!]));
    if (type.kind === "number") return new Map(["abs", "round", "floor", "ceil", "sign", "trunc", "toFixed", "isInteger", "isNaN", "isFinite"]
      .map((name) => [name, this.members.numberMember(name)!]));
    if (type.kind === "list") return available(["size", "get", "slice", "append", "extend", "insert", "has", "remove", "pop", "clear", "copy", "count", "index", "sorted", "reversed", "map", "flatMap", "filter", "reduce", "some", "every", "find", "join", "sum", "min", "max"], (name) => this.collections.listMember(type, name));
    if (type.kind === "map") return available(["size", "get", "set", "getOrSet", "getOrSetWith", "update", "has", "remove", "clear", "copy", "iterator", "keys", "values", "entries"], (name) => this.collections.mapMember(type, name));
    if (type.kind === "record") return available(["size", "get", "set", "has", "remove", "clear", "copy", "keys", "values", "entries"], (name) => this.collections.recordMember(type, name));
    if (type.kind === "set") return available(["size", "add", "update", "has", "remove", "clear", "copy", "values", "union", "intersection", "difference"], (name) => this.collections.setMember(type, name));
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
        const info = this.classRegistry.classInfo(current);
        for (const [name, field] of info?.fields ?? []) if (!members.has(name)) members.set(name, this.moduleImports.displayExternalClasses(field.type));
        for (const [name, method] of info?.methods ?? []) if (!members.has(name)) members.set(name, this.moduleImports.displayExternalClasses(method));
        current = info?.base ?? null;
      }
      const privateContext = this.privateSemanticContext(type);
      if (privateContext) {
        for (const [name, field] of this.privateFields.get(privateContext) ?? []) members.set(name, this.moduleImports.displayExternalClasses(field.type));
        for (const [name, method] of this.privateMethods.get(privateContext) ?? []) members.set(name, this.moduleImports.displayExternalClasses(method));
      }
      return members;
    }
    if (type.kind === "classConstructor") {
      const members = new Map<string, ValueType>();
      let current: string | null = type.identity ?? type.name;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const info = this.classRegistry.classInfo(current);
        for (const [name, field] of info?.staticFields ?? []) if (!members.has(name)) members.set(name, this.moduleImports.displayExternalClasses(field.type));
        for (const [name, method] of info?.staticMethods ?? []) if (!members.has(name)) members.set(name, this.moduleImports.displayExternalClasses(method));
        current = info?.base ?? null;
      }
      const privateContext = this.privateSemanticContext(type);
      if (privateContext) {
        for (const [name, field] of this.privateStaticFields.get(privateContext) ?? []) members.set(name, this.moduleImports.displayExternalClasses(field.type));
        for (const [name, method] of this.privateStaticMethods.get(privateContext) ?? []) members.set(name, this.moduleImports.displayExternalClasses(method));
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
