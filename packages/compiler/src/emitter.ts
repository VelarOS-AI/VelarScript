import type {
  BindingPattern,
  EmbeddedJavaScriptDeclaration,
  EnumDeclaration,
  Expression,
  ImportDeclaration,
  Program,
  Statement,
  TypeAliasDeclaration,
  TypeDeclaration,
  TypeSyntax,
  UsingDeclaration,
} from "./ast.ts";
import { VELAR_CLASS_FIELD_MODULE, VELAR_CLASS_FIELD_RUNTIME } from "./class-runtime.ts";
import { VELAR_COLLECTION_HOST_EXPORTS, VELAR_COLLECTION_HOST_MODULE, VELAR_COLLECTION_IDENTITY_RUNTIME, VELAR_COLLECTION_LIST_RUNTIME, VELAR_COLLECTION_RECORD_RUNTIME, VELAR_COLLECTION_SET_MAP_RUNTIME, VELAR_COLLECTION_TYPE_RUNTIME } from "./collection-runtime.ts";
import { VELAR_COLLECTION_LOWERING_EXPORTS, VELAR_COLLECTION_LOWERING_MODULE, VELAR_COLLECTION_LOWERING_RUNTIME } from "./collection-lowering-runtime.ts";
import { VELAR_RANGE_MODULE } from "./range-runtime.ts";
import { expressionContainsDirectAwait as containsDirectAwait } from "./ast.ts";
import { describeType, type ValueType } from "./types.ts";
import { iterateMemberKey, type LoweringHints } from "./contracts.ts";
import { type GeneratedMapping, type JavaScriptNode, type PreparedEmbeddedJavaScriptModule } from "./emit/javascript.ts";
import { ClassEmitter, type ClassEmitterHost } from "./emit/classes.ts";
import { ExpressionEmitter, type ExpressionEmitterHost } from "./emit/expressions.ts";
import { RuntimeHelperNames, type RuntimeHelperNameHost } from "./emit/helper-names.ts";
import { MatchEmitter, type MatchEmitterHost } from "./emit/matching.ts";
import { RuntimeImportEmitter, type RuntimeImportEmitterHost } from "./emit/runtime-imports.ts";
import { SourceMapRecorder, type SourceMapRecorderHost } from "./emit/source-map.ts";
import { StatementEmitter, type StatementEmitterHost } from "./emit/statements.ts";
import { TypeCheckEmitter, type TypeCheckEmitterHost } from "./emit/type-checks.ts";
import { TypeValidatorEmitter, type TypeValidatorEmitterHost } from "./emit/validators.ts";
import { VELAR_ASSERTION_ERROR_RUNTIME, VELAR_ERROR_NORMALIZATION_MODULE, VELAR_ERROR_NORMALIZATION_RUNTIME, VELAR_HOST_ERROR_RUNTIME } from "./error-runtime.ts";
import type { CompilerEmbeddedJavaScriptModule, CompilerEmitterOptions } from "./extension.ts";
import { VELAR_NARROWING_MODULE, VELAR_NARROWING_RUNTIME } from "./narrowing-runtime.ts";
import { VELAR_NUMBER_METHOD_RUNTIME } from "./number-runtime.ts";
import { VELAR_PRIMITIVE_METHOD_MODULE } from "./primitive-runtime.ts";
import { VELAR_PROMISE_NORMALIZATION_MODULE, VELAR_PROMISE_NORMALIZATION_RUNTIME } from "./promise-runtime.ts";
import { spanIdentity, type SourceText, type Span } from "./source.ts";
import { VELAR_TEXT_METHOD_RUNTIME } from "./text-runtime.ts";
import { VELAR_TYPE_REGISTRY_RUNTIME } from "./type-registry-runtime.ts";
import {
  VELAR_RUNTIME_TYPE_COLLECTION_RUNTIME,
  VELAR_TYPE_VALIDATION_MODULE,
  VELAR_TYPE_VALIDATION_RUNTIME,
  VELAR_VALIDATION_ERROR_RUNTIME,
} from "./type-validation-runtime.ts";








/**
 * What a family of emission may ask the emitter for. It is the intersection of
 * the eight collaborator host interfaces, so adding a member to any one of them
 * is a compile error here until `emitterHost` supplies it.
 */
type EmitterCollaboratorHost = RuntimeHelperNameHost
    & StatementEmitterHost
    & ExpressionEmitterHost
    & ClassEmitterHost
    & MatchEmitterHost
    & TypeValidatorEmitterHost
    & TypeCheckEmitterHost
    & RuntimeImportEmitterHost
    & SourceMapRecorderHost;

/**
 * The half of that host which is a plain function value rather than a live read
 * of emitter state — everything a family *calls*.
 */
type EmitterCallHost = {
  [Key in keyof EmitterCollaboratorHost as EmitterCollaboratorHost[Key] extends (...args: never[]) => unknown ? Key : never]: EmitterCollaboratorHost[Key];
};

/**
 * What the emitted statements turned out to use, carried between the phases
 * that select the module's runtime imports. `helpers` is the growing list of
 * import and helper lines; everything else is a fact about the emitted code
 * that a later phase reads rather than recomputing.
 */
interface HelperSelection {
  readonly helpers: string[];
  readonly needsDirectCollectionInfrastructure: boolean;
  readonly generatedIdentifiers: ReadonlySet<string>;
  readonly usesGeneratedName: (name: string) => boolean;
  readonly needsRecordFromHelper: boolean;
  readonly needsRecordMapFromHelper: boolean;
  readonly needsCreateRecordHelper: boolean;
  readonly needsCreateRecordAsyncHelper: boolean;
  readonly needsControlledRecordConstruction: boolean;
}

export class JavaScriptEmitter {
  private readonly typeDeclarations = new Map<string, TypeDeclaration | TypeAliasDeclaration>();
  private readonly runtimeTypes = new Set<string>();
  private readonly expandedRuntimeTypes = new Set<string>();
  /** Whether a runtime Type can revisit the same value through its declared type graph. */
  private readonly runtimeTypeTraversalGuards = new Map<string, boolean>();
  /**
   * D55 rule 121: the type parameters of the generic record currently being
   * emitted. Inside that body a `T`-typed position is checked by the argument
   * predicate the instantiation supplied, which is the only reading of `T` a
   * validator can have once the type is erased.
   */
  private genericTypeParameters: readonly string[] | null = null;
  /** Hoisted `function __velarTypeOf_N()` bodies for instantiations written outside a generic. */
  private readonly hoistedGenericInstances = new Map<string, string>();
  /**
   * D90 rule R5: one hoisted `function __velarCopyPlanN` per distinct copy
   * plan, found by the plan's own emitted text. The memo a copy keeps is keyed
   * by source object *and* plan, so a plan needs an identity that is the same
   * object at every visit; a module-level function declaration is that identity
   * and the element callback in one, and it hoists past any temporal dead zone.
   */
  private readonly copyPlans = new Map<string, string>();
  private readonly copyPlanDeclarations: string[] = [];
  /**
   * The copy plans of the generic record currently being emitted. A plan that
   * reads `__velarArguments` cannot hoist to module level and must not be
   * shared between instantiations, so it is interned onto the instantiation's
   * own arguments object instead — one array per instantiation, built once.
   */
  private genericCopyPlans: string[] | null = null;
  private genericCopyPlanNames: Map<string, string> | null = null;
  /**
   * The plan array the generic record whose copy was emitted last needs on its
   * arguments object, empty when every one of its plans hoisted to module level.
   */
  private pendingGenericCopyPlans: readonly string[] = [];
  /** Whether a copy plan is being asked about rather than emitted, so nothing is interned. */
  private copyPlanProbe = false;
  private readonly externModuleExports = new Map<string, ReadonlySet<string>>();
  private needsExternExportHelper = false;
  protected readonly hints: LoweringHints;
  private readonly forcedFunctionExports: ReadonlySet<string>;
  private readonly sharedRuntimeModules: boolean;
  private readonly requiredRuntimeModules = new Set<string>();
  private needsIndexHelpers = false;
  private needsBinaryHelpers = false;
  private needsBitwiseHelpers = false;
  private needsCollectionHelpers = false;
  private needsPrimitiveHelpers = false;
  private needsRecordHelpers = false;
  private needsObjectBindingHelpers = false;
  private needsListBindingHelpers = false;
  private needsDirectCollectionInfrastructure = false;
  private needsRuntimeTypeHelpers = false;
  private needsNumberHelper = false;
  private needsThrownValueHelper = false;
  private needsErrorCodeHelper = false;
  private readonly requiredHostErrorClasses = new Set<string>();
  private needsDetachedTaskHelper = false;
  private needsDisposalHelper = false;
  private needsIntegrityFailureHelper = false;
  private needsRequiredValueHelper = false;
  private needsNarrowingErrorClass = false;
  private needsAssertionErrorClass = false;
  private readonly suppressedPromiseValues = new Set<string>();
  private nextJavaScriptNodeId = 0;
  private readonly javaScriptNodeSpans = new Map<number, Span>();
  private readonly structuralFieldChecks = new Set<ValueType>();
  private generatedMappings: readonly GeneratedMapping[] = [];
  private generatedCode = "";
  private readonly sourcePath: string;
  private readonly executeMain: boolean;
  private readonly embeddedJavaScript = new Map<EmbeddedJavaScriptDeclaration, PreparedEmbeddedJavaScriptModule>();

  // D114 R1c: the eight emission families the emitter owns as collaborators
  // rather than as more of itself. `JavaScriptEmitter` stays the class Web and
  // Node subclass — every `protected` member is still declared here, forwarding
  // to the family that owns its body — and each collaborator reaches back
  // through the interface it declared.
  private readonly statements: StatementEmitter;
  private readonly expressions: ExpressionEmitter;
  private readonly helperNames: RuntimeHelperNames;
  private readonly classEmitter: ClassEmitter;
  private readonly matching: MatchEmitter;
  private readonly validators: TypeValidatorEmitter;
  private readonly typeChecks: TypeCheckEmitter;
  private readonly runtimeImports: RuntimeImportEmitter;
  private readonly sourceMapper: SourceMapRecorder;

  /**
   * The one object every collaborator is handed. Its properties are live reads
   * and writes of the emitter: a family that records "this module needs the
   * collection helpers" must set the emitter's own flag, because `emit()` reads
   * it after every family has run.
   */
  private emitterHost(): EmitterCollaboratorHost {
    const emitter = this;
    return {
      ...this.emitterCallHost(),
      get copyPlanDeclarations() { return emitter.copyPlanDeclarations; },
      get copyPlanProbe() { return emitter.copyPlanProbe; },
      set copyPlanProbe(value) { emitter.copyPlanProbe = value; },
      get copyPlans() { return emitter.copyPlans; },
      get embeddedJavaScript() { return emitter.embeddedJavaScript; },
      get executeMain() { return emitter.executeMain; },
      get expandedRuntimeTypes() { return emitter.expandedRuntimeTypes; },
      get externModuleExports() { return emitter.externModuleExports; },
      get forcedFunctionExports() { return emitter.forcedFunctionExports; },
      get genericCopyPlanNames() { return emitter.genericCopyPlanNames; },
      set genericCopyPlanNames(value) { emitter.genericCopyPlanNames = value; },
      get genericCopyPlans() { return emitter.genericCopyPlans; },
      set genericCopyPlans(value) { emitter.genericCopyPlans = value; },
      get genericTypeParameters() { return emitter.genericTypeParameters; },
      set genericTypeParameters(value) { emitter.genericTypeParameters = value; },
      get hints() { return emitter.hints; },
      get hoistedGenericInstances() { return emitter.hoistedGenericInstances; },
      get javaScriptNodeSpans() { return emitter.javaScriptNodeSpans; },
      get needsAssertionErrorClass() { return emitter.needsAssertionErrorClass; },
      set needsAssertionErrorClass(value) { emitter.needsAssertionErrorClass = value; },
      get needsBinaryHelpers() { return emitter.needsBinaryHelpers; },
      set needsBinaryHelpers(value) { emitter.needsBinaryHelpers = value; },
      get needsBitwiseHelpers() { return emitter.needsBitwiseHelpers; },
      set needsBitwiseHelpers(value) { emitter.needsBitwiseHelpers = value; },
      get needsCollectionHelpers() { return emitter.needsCollectionHelpers; },
      set needsCollectionHelpers(value) { emitter.needsCollectionHelpers = value; },
      get needsDetachedTaskHelper() { return emitter.needsDetachedTaskHelper; },
      set needsDetachedTaskHelper(value) { emitter.needsDetachedTaskHelper = value; },
      get needsDirectCollectionInfrastructure() { return emitter.needsDirectCollectionInfrastructure; },
      set needsDirectCollectionInfrastructure(value) { emitter.needsDirectCollectionInfrastructure = value; },
      get needsDisposalHelper() { return emitter.needsDisposalHelper; },
      set needsDisposalHelper(value) { emitter.needsDisposalHelper = value; },
      get needsErrorCodeHelper() { return emitter.needsErrorCodeHelper; },
      set needsErrorCodeHelper(value) { emitter.needsErrorCodeHelper = value; },
      get needsExternExportHelper() { return emitter.needsExternExportHelper; },
      set needsExternExportHelper(value) { emitter.needsExternExportHelper = value; },
      get needsIndexHelpers() { return emitter.needsIndexHelpers; },
      set needsIndexHelpers(value) { emitter.needsIndexHelpers = value; },
      get needsIntegrityFailureHelper() { return emitter.needsIntegrityFailureHelper; },
      set needsIntegrityFailureHelper(value) { emitter.needsIntegrityFailureHelper = value; },
      get needsNarrowingErrorClass() { return emitter.needsNarrowingErrorClass; },
      set needsNarrowingErrorClass(value) { emitter.needsNarrowingErrorClass = value; },
      get needsNumberHelper() { return emitter.needsNumberHelper; },
      set needsNumberHelper(value) { emitter.needsNumberHelper = value; },
      get needsPrimitiveHelpers() { return emitter.needsPrimitiveHelpers; },
      set needsPrimitiveHelpers(value) { emitter.needsPrimitiveHelpers = value; },
      get needsRecordHelpers() { return emitter.needsRecordHelpers; },
      set needsRecordHelpers(value) { emitter.needsRecordHelpers = value; },
      get needsRequiredValueHelper() { return emitter.needsRequiredValueHelper; },
      set needsRequiredValueHelper(value) { emitter.needsRequiredValueHelper = value; },
      get needsRuntimeTypeHelpers() { return emitter.needsRuntimeTypeHelpers; },
      set needsRuntimeTypeHelpers(value) { emitter.needsRuntimeTypeHelpers = value; },
      get needsThrownValueHelper() { return emitter.needsThrownValueHelper; },
      set needsThrownValueHelper(value) { emitter.needsThrownValueHelper = value; },
      get nextJavaScriptNodeId() { return emitter.nextJavaScriptNodeId; },
      set nextJavaScriptNodeId(value) { emitter.nextJavaScriptNodeId = value; },
      get pendingGenericCopyPlans() { return emitter.pendingGenericCopyPlans; },
      set pendingGenericCopyPlans(value) { emitter.pendingGenericCopyPlans = value; },
      get requiredHostErrorClasses() { return emitter.requiredHostErrorClasses; },
      get requiredRuntimeModules() { return emitter.requiredRuntimeModules; },
      get runtimeTypeTraversalGuards() { return emitter.runtimeTypeTraversalGuards; },
      get runtimeTypes() { return emitter.runtimeTypes; },
      get sharedRuntimeModules() { return emitter.sharedRuntimeModules; },
      get sourcePath() { return emitter.sourcePath; },
      get structuralFieldChecks() { return emitter.structuralFieldChecks; },
      get typeDeclarations() { return emitter.typeDeclarations; },
    };
  }

  /**
   * The half of the host that is plain function values: every call a family
   * makes back into the emitter or into another family. They are values, not
   * accessors, so `emitterHost` spreads them; the state half has to stay
   * accessors there, because the emitter's flags move while a family runs.
   */
  private emitterCallHost(): EmitterCallHost {
    const emitter = this;
    return {
      binaryHelper: (expression) => emitter.helperNames.binaryHelper(expression),
      binaryIndexHelper: (kind) => emitter.helperNames.binaryIndexHelper(kind),
      binarySetIndexHelper: (kind) => emitter.helperNames.binarySetIndexHelper(kind),
      blockAlwaysReturns: (statements) => emitter.blockAlwaysReturns(statements),
      builtinErrorRuntimeName: (name) => emitter.typeChecks.builtinErrorRuntimeName(name),
      collectionHelper: (expression) => emitter.helperNames.collectionHelper(expression),
      collectionIteratorHelper: (kind, pair) => emitter.helperNames.collectionIteratorHelper(kind, pair),
      collectionSizeHelper: (kind) => emitter.helperNames.collectionSizeHelper(kind),
      emitBindingPatternStatements: (pattern, value, binding, exported, depth, label) => emitter.emitBindingPatternStatements(pattern, value, binding, exported, depth, label),
      emitClass: (statement, depth) => emitter.classEmitter.emitClass(statement, depth),
      emitCondition: (expression) => emitter.emitCondition(expression),
      emitEnumDeclaration: (statement, depth) => emitter.validators.emitEnumDeclaration(statement, depth),
      emitIsCheck: (type, value) => emitter.emitIsCheck(type, value),
      emitMappedAssignmentTarget: (expression) => emitter.emitMappedAssignmentTarget(expression),
      emitMappedExpression: (expression, normalizeNull) => emitter.emitMappedExpression(expression, normalizeNull),
      emitMappedJavaScript: (sourceSpan, render) => emitter.emitMappedJavaScript(sourceSpan, render),
      emitMappedStatement: (statement, depth) => emitter.emitMappedStatement(statement, depth),
      emitMatchPatternAttempt: (pattern, valueName, indentation) => emitter.matching.emitMatchPatternAttempt(pattern, valueName, indentation),
      emitObjectKey: (name) => emitter.emitObjectKey(name),
      emitParameter: (name, defaultValue, rest) => emitter.emitParameter(name, defaultValue, rest),
      emitStatementLines: (statements, depth) => emitter.emitStatementLines(statements, depth),
      emitTypeAliasDeclaration: (statement, depth) => emitter.validators.emitTypeAliasDeclaration(statement, depth),
      emitTypeCheck: (type, value, state) => emitter.emitTypeCheck(type, value, state),
      emitTypeDeclaration: (statement, depth) => emitter.validators.emitTypeDeclaration(statement, depth),
      enumAliasTarget: (name, seen) => emitter.typeChecks.enumAliasTarget(name, seen),
      expressionContainsDirectAwait: (expression) => emitter.expressionContainsDirectAwait(expression),
      extensionExpressionContainsDirectAwait: (_expression, _contains) => emitter.extensionExpressionContainsDirectAwait(_expression, _contains),
      extensionStatementContainsDirectAwait: (_statement, _containsExpression, _containsBlock) => emitter.extensionStatementContainsDirectAwait(_statement, _containsExpression, _containsBlock),
      genericInstanceExpression: (application) => emitter.typeChecks.genericInstanceExpression(application),
      genericTypeBinding: (name) => emitter.genericTypeBinding(name),
      markRuntimeNarrowingType: (type, structural) => emitter.validators.markRuntimeNarrowingType(type, structural),
      markRuntimeType: (type) => emitter.validators.markRuntimeType(type),
      primitiveHelper: (expression) => emitter.helperNames.primitiveHelper(expression),
      nominalRuntimeReceiver: (type) => emitter.nominalRuntimeReceiver(type),
      resolveDeclarationType: (reference) => emitter.typeChecks.resolveDeclarationType(reference),
      runtimeTypeBinding: (name) => emitter.runtimeTypeBinding(name),
      runtimeTypeCheckName: (name) => emitter.typeChecks.runtimeTypeCheckName(name),
      runtimeTypeNeedsTraversalGuard: (name) => emitter.typeChecks.runtimeTypeNeedsTraversalGuard(name),
      runtimeTypeObjectExpression: (type) => emitter.typeChecks.runtimeTypeObjectExpression(type),
      typeTextExpression: (type: ValueType, syntax: TypeSyntax | null) => emitter.typeChecks.typeTextExpression(type, syntax),
      visitExtensionRuntimeExpression: (_expression: Expression, _visitExpression: (expression: Expression) => void) => emitter.visitExtensionRuntimeExpression(_expression, _visitExpression),
      visitExtensionRuntimeStatement: (_statement: Statement, _visitExpression: (expression: Expression) => void, _visitStatement: (statement: Statement) => void) => emitter.visitExtensionRuntimeStatement(_statement, _visitExpression, _visitStatement),
    };
  }

  constructor(hints: LoweringHints, forcedFunctionExports: ReadonlySet<string> = new Set(), options: CompilerEmitterOptions = {}) {
    this.hints = hints;
    this.forcedFunctionExports = forcedFunctionExports;
    this.sharedRuntimeModules = options.sharedRuntimeModules === true;
    this.sourcePath = options.sourcePath ?? "<source>";
    this.executeMain = options.executeMain !== false;
    const host = this.emitterHost();
    this.statements = new StatementEmitter(host);
    this.expressions = new ExpressionEmitter(host);
    this.helperNames = new RuntimeHelperNames(host);
    this.classEmitter = new ClassEmitter(host);
    this.matching = new MatchEmitter(host);
    this.validators = new TypeValidatorEmitter(host);
    this.typeChecks = new TypeCheckEmitter(host);
    this.runtimeImports = new RuntimeImportEmitter(host);
    this.sourceMapper = new SourceMapRecorder(host);
  }

  emit(program: Program): string {
    this.nextJavaScriptNodeId = 0;
    this.javaScriptNodeSpans.clear();
    this.requiredRuntimeModules.clear();
    this.requiredHostErrorClasses.clear();
    this.runtimeTypeTraversalGuards.clear();
    this.statements.prepareEmbeddedJavaScript(program);
    this.validators.collectDeclarations(program);
    this.runtimeImports.collectRuntimeUses(program);
    const emittedStatements = program.body
      .map((statement) => ({
        statement,
        node: this.sourceMapper.emitJavaScriptNode(statement.span, () => this.emitStatement(statement, 0)),
      }))
      .filter((item) => item.node.code.length > 0);
    // VelarScript types are real runtime values only when emitted code uses
    // them (`Type.is`, `Type.parse`, `Type.from`, a runtime validator, and so
    // on). An annotation by itself is erased. Keep evaluating the imported
    // module, but do not ask the JavaScript linker for named exports which the
    // generated module never reads.
    const runtimeStatementIdentifiers = javaScriptIdentifiers(emittedStatements
      .filter(({ statement }) => statement.kind !== "ImportDeclaration")
      .map(({ node }) => node.code)
      .concat(
        this.copyPlanDeclarations,
        [...this.hoistedGenericInstances.keys()],
      ));
    const statements = emittedStatements.map(({ statement, node }) => {
      if (statement.kind !== "ImportDeclaration" || statement.javascript || statement.resource === "json") return node;
      const specifiers = statement.specifiers.filter((specifier) => runtimeStatementIdentifiers.has(specifier.local));
      if (specifiers.length === statement.specifiers.length) return node;
      const code = specifiers.length === 0
        ? `import ${JSON.stringify(statement.source.endsWith(".vel") ? `${statement.source.slice(0, -4)}.js` : statement.source)};`
        : this.statements.emitImport({ ...statement, specifiers }, "");
      return { ...node, code };
    });
    const selection = this.selectSourceHelpers(program, statements);
    this.selectFieldAndNarrowingHelpers(selection);
    this.selectErrorAndTaskHelpers(selection);
    this.selectCollectionHelpers(program, selection);
    this.selectRecordAndBindingHelpers(selection);
    const helpers = selection.helpers;

    // D55 rule 121: one memoized accessor per instantiation written outside a
    // generic body. They are `function` declarations so that
    // `type Boxed = Box<string>` above the declaration of `Box` still reads a
    // hoisted name instead of a `const` in its temporal dead zone.
    const instances = [...this.hoistedGenericInstances].map(([expression, name]) => `function ${name}() {\n  return ${expression};\n}`);
    const chunks: readonly { readonly code: string; readonly mappings: readonly GeneratedMapping[] }[] = [
      ...helpers.map((code) => ({ code, mappings: [] })),
      ...instances.map((code) => ({ code, mappings: [] })),
      // D90 rule R5: the interned copy plans. They are `function` declarations
      // for the same reason the instantiation accessors are — a plan names the
      // Type objects declared below it and is only ever called after they exist.
      ...this.copyPlanDeclarations.map((code) => ({ code, mappings: [] })),
      ...statements.map((node) => this.sourceMapper.renderJavaScriptNode(node)),
    ];
    let output = "";
    const mappings: GeneratedMapping[] = [];
    for (const chunk of chunks) {
      if (output.length > 0) output += "\n\n";
      const offset = output.length;
      output += chunk.code;
      mappings.push(...chunk.mappings.map((mapping) => ({ ...mapping, offset: offset + mapping.offset })));
    }
    this.generatedCode = `${output}${output.length > 0 ? "\n" : ""}`;
    this.generatedMappings = mappings.sort((left, right) => left.offset - right.offset);
    return this.generatedCode;
  }

  /**
   * Phase one of the runtime-import selection: the namespaces a builtin value
   * reference imports, the binary, bitwise and duration helpers, the reactive
   * bridge and its closure, and the scan of emitted identifiers every later
   * phase asks its questions of.
   */
  private selectSourceHelpers(program: Program, statements: readonly JavaScriptNode[]): HelperSelection {
    const needsDirectCollectionInfrastructure = this.needsDirectCollectionInfrastructure
      || this.needsRecordHelpers
      || this.needsObjectBindingHelpers
      || this.needsListBindingHelpers;
    const helpers: string[] = [...this.additionalHelpers(program)];
    const statementIdentifiers = javaScriptIdentifiers(statements.map((statement) => statement.code));
    const builtinValues = new Set(this.hints.builtinValueReferences.values());
    if (builtinValues.has("Json")) {
      helpers.push('import * as __velarJsonNamespace from "velar/json";');
      this.requiredRuntimeModules.add("velar/json");
    }
    if (builtinValues.has("Promise")) {
      helpers.push('import * as __velarPromiseNamespace from "velar/async";');
      this.requiredRuntimeModules.add("velar/async");
    }
    if (builtinValues.has("Text")) {
      helpers.push('import * as __velarTextNamespace from "velar/text";');
      this.requiredRuntimeModules.add("velar/text");
    }
    if (builtinValues.has("Math")) {
      helpers.push('import * as __velarMathNamespace from "velar/math";');
      this.requiredRuntimeModules.add("velar/math");
    }
    // A direct one-slot `for value in range(...)` lowers to the counted-range
    // owner below and never calls the ordinary List-producing function. The
    // analyzer still records the source-level `range` reference, so select the
    // value import from emitted identifiers instead of that broader fact.
    if (builtinValues.has("range") && statementIdentifiers.has("__velarRange")) {
      helpers.push(`import { range as __velarRange } from ${JSON.stringify(VELAR_RANGE_MODULE)};`);
      this.requiredRuntimeModules.add(VELAR_RANGE_MODULE);
    }
    if (this.hints.nativeRangeForStatements.size > 0) {
      helpers.push(`import { range as __velarCountedRangeOwner } from ${JSON.stringify(VELAR_RANGE_MODULE)};`);
      this.requiredRuntimeModules.add(VELAR_RANGE_MODULE);
    }
    if (this.needsBinaryHelpers) {
      helpers.push('import { Bytes as __velarBinaryRuntime } from "velar/binary";');
      this.requiredRuntimeModules.add("velar/binary");
    }
    if (this.needsBitwiseHelpers) {
      helpers.push([
        "const __velarBitwiseApply = Reflect.apply;",
        "const __velarBitwiseNumber = Number;",
        "const __velarBitwiseNumberIsInteger = Number.isInteger;",
        "const __velarBitwiseTypeError = TypeError;",
        "const __velarBitwiseRangeError = RangeError;",
        "function __velarBitwiseOperand(value, operator) {",
        "  if (typeof value !== \"number\" || !__velarBitwiseApply(__velarBitwiseNumberIsInteger, __velarBitwiseNumber, [value])) throw new __velarBitwiseTypeError(\"Bitwise '\" + operator + \"' requires integer operands\");",
        "  if (value < -2147483648 || value > 4294967295) throw new __velarBitwiseRangeError(\"Bitwise '\" + operator + \"' requires 32-bit integer operands\");",
        "  return value;",
        "}",
        "function __velarBitwiseUnary(value) { value = __velarBitwiseOperand(value, \"~\"); return ~value; }",
        "function __velarBitwiseBinary(left, operator, right) {",
        "  left = __velarBitwiseOperand(left, operator);",
        "  if (operator === \"<<\" || operator === \">>\" || operator === \">>>\") {",
        "    if (typeof right !== \"number\" || !__velarBitwiseApply(__velarBitwiseNumberIsInteger, __velarBitwiseNumber, [right])) throw new __velarBitwiseTypeError(\"Bitwise '\" + operator + \"' requires an integer shift count\");",
        "    if (right < 0 || right > 31) throw new __velarBitwiseRangeError(\"Bitwise '\" + operator + \"' requires a shift count from 0 to 31\");",
        "    return operator === \"<<\" ? left << right : operator === \">>\" ? left >> right : left >>> right;",
        "  }",
        "  right = __velarBitwiseOperand(right, operator);",
        "  return operator === \"&\" ? left & right : operator === \"|\" ? left | right : left ^ right;",
        "}",
      ].join("\n"));
    }
    this.selectDurationHelpers(helpers);
    const reactiveBridgeIdentifiers = new Set(javaScriptIdentifiers([
      ...statements.map((statement) => statement.code),
      ...helpers,
    ]));
    // Record projection/construction and binding helpers are emitted after the
    // bridge import is selected, so state their small reactive dependency
    // closure explicitly. Direct structural-match operations are already
    // present in `statements` and therefore need no extra entry here.
    if (statementIdentifiers.has("__velarRecordFrom") || statementIdentifiers.has("__velarRecordMapFrom")) {
      reactiveBridgeIdentifiers.add("__velarReactiveCollectionRead");
    }
    if (statementIdentifiers.has("__velarCreateRecord")
      || statementIdentifiers.has("__velarCreateRecordAsync")
      || this.needsObjectBindingHelpers
      || this.needsListBindingHelpers) {
      reactiveBridgeIdentifiers.add("__velarReactiveCollectionTrack");
      reactiveBridgeIdentifiers.add("__velarReactiveCollectionRead");
    }
    helpers.push(...this.reactiveBridgeHelpers(
      this.hints.javaScriptCallBoundaries.size > 0,
      this.sharedRuntimeModules ? needsDirectCollectionInfrastructure : this.needsCollectionHelpers,
      reactiveBridgeIdentifiers,
    ));
    // Runtime imports are selected from JavaScript identifier tokens, not raw
    // substrings. Raw text produces two wrong answers: a user string such as
    // "__velarStringTrim" looks like a call, and a real
    // __velarStringReplaceAll call also looks like __velarStringReplace.
    // Generated helper names are reserved, so an identifier token is an exact
    // compiler-owned use once string/comment/template text has been skipped.
    const generatedIdentifiers = javaScriptIdentifiers([
      ...statements.map((statement) => statement.code),
      ...helpers,
    ]);
    const usesGeneratedName = (name: string): boolean => generatedIdentifiers.has(name);
    const needsRecordFromHelper = usesGeneratedName("__velarRecordFrom");
    const needsRecordMapFromHelper = usesGeneratedName("__velarRecordMapFrom");
    const needsCreateRecordHelper = usesGeneratedName("__velarCreateRecord");
    const needsCreateRecordAsyncHelper = usesGeneratedName("__velarCreateRecordAsync");
    const needsControlledRecordConstruction = needsCreateRecordHelper || needsCreateRecordAsyncHelper;
    return {
      helpers, needsDirectCollectionInfrastructure, generatedIdentifiers, usesGeneratedName,
      needsRecordFromHelper, needsRecordMapFromHelper, needsCreateRecordHelper,
      needsCreateRecordAsyncHelper, needsControlledRecordConstruction,
    };
  }

  /**
   * Phase two: the helpers a lowering needs to read a field through its guard,
   * narrow at run time, normalize a Promise, or expose an extern module's
   * exports.
   */
  private selectFieldAndNarrowingHelpers(selection: HelperSelection): void {
    const { helpers, usesGeneratedName } = selection;
    if (this.needsExternExportHelper) {
      // W-22: an extern module declaration is trusted for shapes, but the
      // declared export must actually exist. The bridge verifies presence at
      // module initialization with one property probe per imported name; a
      // declared export that legitimately holds undefined stays importable
      // because the boundary is membership in the module namespace, not the
      // value.
      helpers.push([
        "function __velarExternExport(namespace, name, source) {",
        "  const value = namespace[name];",
        "  if (value === undefined && !(name in namespace)) {",
        "    throw new TypeError(name === \"default\"",
        "      ? `Extern module '${source}' declares 'default', but the JavaScript module has no default export; declare the module's real named exports instead`",
        "      : `Extern module '${source}' declares '${name}', but the JavaScript module has no such export; prototype methods and instance members belong on a declared class or singleton const, not module exports`);",
        "  }",
        "  return value;",
        "}",
      ].join("\n"));
    }
    if (this.needsPrimitiveHelpers) {
      if (this.sharedRuntimeModules) {
        this.requiredRuntimeModules.add(VELAR_PRIMITIVE_METHOD_MODULE);
        const imports = [
          ["stringSize", "__velarStringSize"], ["stringTrim", "__velarStringTrim"], ["stringUpper", "__velarStringUpper"], ["stringLower", "__velarStringLower"],
          ["stringSlice", "__velarStringSlice"], ["stringChar", "__velarStringChar"], ["stringHas", "__velarStringHas"], ["stringIndex", "__velarStringIndex"],
          ["stringCount", "__velarStringCount"], ["stringStartsWith", "__velarStringStartsWith"], ["stringEndsWith", "__velarStringEndsWith"],
          ["stringSplit", "__velarStringSplit"], ["stringReplace", "__velarStringReplace"], ["stringReplaceAll", "__velarStringReplaceAll"],
          ["stringPadStart", "__velarStringPadStart"], ["stringPadEnd", "__velarStringPadEnd"], ["stringRepeat", "__velarStringRepeat"],
          ["stringIsBlank", "__velarStringIsBlank"], ["stringCompare", "__velarStringCompare"], ["orderCompare", "__velarOrderCompare"],
          ["numberAbs", "__velarNumberAbs"], ["numberRound", "__velarNumberRound"], ["numberFloor", "__velarNumberFloor"],
          ["numberCeil", "__velarNumberCeil"], ["numberSign", "__velarNumberSign"], ["numberTrunc", "__velarNumberTrunc"], ["numberToFixed", "__velarNumberToFixed"],
          ["numberIsInteger", "__velarNumberIsInteger"], ["numberIsNaN", "__velarNumberIsNaN"], ["numberIsFinite", "__velarNumberIsFinite"],
        ].filter(([, local]) => usesGeneratedName(local!));
        helpers.push(`import { ${imports.map(([exported, local]) => `${exported} as ${local}`).join(", ")} } from ${JSON.stringify(VELAR_PRIMITIVE_METHOD_MODULE)};`);
      } else {
        helpers.push(VELAR_TEXT_METHOD_RUNTIME);
        helpers.push(VELAR_NUMBER_METHOD_RUNTIME);
      }
    }
    if (this.hints.instanceFieldReads.size > 0 || this.hints.privateInstanceFieldReads.size > 0 || this.hints.staticFieldReads.size > 0) {
      if (this.sharedRuntimeModules) {
        this.requiredRuntimeModules.add(VELAR_CLASS_FIELD_MODULE);
        const imports = [
          ["readInstanceField", "__velarReadInstanceField"],
          ["readPrivateField", "__velarReadPrivateField"],
          ["readStaticField", "__velarReadStaticField"],
        ].filter(([, local]) => usesGeneratedName(local!));
        helpers.push(`import { ${imports.map(([exported, local]) => `${exported} as ${local}`).join(", ")} } from ${JSON.stringify(VELAR_CLASS_FIELD_MODULE)};`);
      } else {
        helpers.push(VELAR_CLASS_FIELD_RUNTIME);
      }
    }
    if (this.hints.runtimeNarrowings.size > 0 || this.needsNarrowingErrorClass) {
      if (this.sharedRuntimeModules) {
        this.requireRuntimeModule(VELAR_NARROWING_MODULE);
        const imports = [
          ...(this.hints.runtimeNarrowings.size > 0 ? ["narrow as __velarNarrow"] : []),
          ...(this.needsNarrowingErrorClass ? ["NarrowingError as __VelarNarrowingError"] : []),
        ];
        helpers.push(`import { ${imports.join(", ")} } from ${JSON.stringify(VELAR_NARROWING_MODULE)};`);
      } else {
        helpers.push(VELAR_NARROWING_RUNTIME);
      }
    }
    const needsPromiseNormalization = this.hints.normalizedPromiseValues.size > 0
      || this.hints.asyncResolvedValues.size > 0
      || this.hints.asyncForStatements.size > 0;
    if (needsPromiseNormalization) {
      if (this.sharedRuntimeModules) {
        this.requireRuntimeModule(VELAR_PROMISE_NORMALIZATION_MODULE);
        const imports = [
          ...(this.hints.normalizedPromiseValues.size > 0 || this.hints.asyncForStatements.size > 0
            ? ["normalizePromiseValue as __velarNormalizePromiseValue"]
            : []),
          ...(this.hints.asyncResolvedValues.size > 0
            ? ["asyncResolvedValue as __velarAsyncResolvedValue"]
            : []),
        ];
        helpers.push(`import { ${imports.join(", ")} } from ${JSON.stringify(VELAR_PROMISE_NORMALIZATION_MODULE)};`);
      } else {
        helpers.push(VELAR_PROMISE_NORMALIZATION_RUNTIME);
      }
    }
  }

  /**
   * Phase three: the error and task channel — structural async pull, detached
   * tasks, disposal, the three compiler-raised error classes, error
   * normalization, and the named capability errors a source reference names.
   */
  private selectErrorAndTaskHelpers(selection: HelperSelection): void {
    const { helpers, usesGeneratedName } = selection;
    // D90 R18: the structural-pull helpers serve only the capability-handle
    // shapes; an `async for` over a declared asynchronous `@iterate:` calls
    // the emitted member directly and needs none of them.
    if ([...this.hints.asyncForStatements].some((start) => !this.hints.asyncIterationStatements.has(start))) {
      helpers.push([
        "const __velarAsyncPullGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;",
        "const __velarAsyncPullGetPrototypeOf = Object.getPrototypeOf;",
        "const __velarAsyncPullApply = Reflect.apply;",
        "const __velarAsyncPullArguments = [];",
        "const __velarAsyncPullTypeError = TypeError;",
        // Class methods live on the prototype (charter section 18), so the
        // capture walks the chain with descriptor reads. The first level that
        // declares 'next' decides: only a data-valued function is accepted,
        // and an accessor is rejected without ever being invoked.
        "function __velarAsyncPullNext(source) {",
        "  if ((typeof source !== \"object\" && typeof source !== \"function\") || source === null) {",
        "    throw new __velarAsyncPullTypeError(\"async for requires a data-valued next method\");",
        "  }",
        "  for (let owner = source; owner !== null; owner = __velarAsyncPullGetPrototypeOf(owner)) {",
        "    const descriptor = __velarAsyncPullGetOwnPropertyDescriptor(owner, \"next\");",
        "    if (!descriptor) continue;",
        "    if (!(\"value\" in descriptor) || typeof descriptor.value !== \"function\") {",
        "      throw new __velarAsyncPullTypeError(\"async for requires a data-valued next method\");",
        "    }",
        "    return descriptor.value;",
        "  }",
        "  throw new __velarAsyncPullTypeError(\"async for requires a data-valued next method\");",
        "}",
        "function __velarAsyncPullCall(source, next) {",
        "  return __velarAsyncPullApply(next, source, __velarAsyncPullArguments);",
        "}",
      ].join("\n"));
    }
    if (this.needsDetachedTaskHelper) {
      helpers.push(...this.detachedTaskHelpers());
    }
    if (this.needsDisposalHelper) {
      helpers.push(...this.disposalHelpers());
    }
    // D86 rule 212: `assert` and `value!` raise one compiler-owned class, so
    // the class is emitted wherever either lowering is, independently of the
    // error-normalization runtime a module may or may not also need.
    if (this.needsAssertionErrorClass) {
      if (this.sharedRuntimeModules) {
        this.requireRuntimeModule(VELAR_ERROR_NORMALIZATION_MODULE);
        helpers.push(`import { AssertionError as __VelarAssertionError } from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)};`);
      } else {
        helpers.push(VELAR_ASSERTION_ERROR_RUNTIME);
      }
    }
    if (this.needsIntegrityFailureHelper) {
      helpers.push(...this.integrityFailureHelpers());
    }
    if (this.needsRequiredValueHelper) {
      helpers.push(...this.requiredValueHelpers());
    }
    const needsErrorNormalizationRuntime = this.needsThrownValueHelper || this.needsErrorCodeHelper;
    if (needsErrorNormalizationRuntime && !this.includesErrorNormalizationRuntime()) {
      if (this.sharedRuntimeModules) {
        this.requireRuntimeModule(VELAR_ERROR_NORMALIZATION_MODULE);
        const imports = [
          ...(this.needsErrorCodeHelper ? ["errorCode as __velarErrorCode"] : []),
          ...(this.needsThrownValueHelper ? ["normalizeError as __velarNormalizeError"] : []),
        ];
        helpers.push(`import { ${imports.join(", ")} } from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)};`);
      } else {
        helpers.push(VELAR_ERROR_NORMALIZATION_RUNTIME);
      }
    }
    // D50 rule 89: a named capability error is a leaf class the compiler owns,
    // so a source reference resolves to the one runtime class every capability
    // constructs — the same wiring the three compiler-raised errors use.
    if (this.requiredHostErrorClasses.size > 0) {
      const imports = [...this.requiredHostErrorClasses].sort().map((name) => `${name} as __Velar${name}`);
      if (this.sharedRuntimeModules) {
        this.requireRuntimeModule(VELAR_ERROR_NORMALIZATION_MODULE);
        helpers.push(`import { ${imports.join(", ")} } from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)};`);
      } else {
        helpers.push(VELAR_HOST_ERROR_RUNTIME);
      }
    }
  }

  /**
   * Phase four: the collection and runtime-`Type` infrastructure, whether it
   * arrives as a shared runtime module or as helpers emitted into this module.
   */
  private selectCollectionHelpers(program: Program, selection: HelperSelection): void {
    const { helpers, needsDirectCollectionInfrastructure, generatedIdentifiers, usesGeneratedName,
      needsRecordFromHelper, needsRecordMapFromHelper, needsCreateRecordHelper,
      needsCreateRecordAsyncHelper, needsControlledRecordConstruction } = selection;
    const needsRuntimeTypeRuntime = this.needsRuntimeTypeHelpers || this.runtimeTypes.size > 0
      || program.body.some((statement) => statement.kind === "EnumDeclaration");
    if (needsDirectCollectionInfrastructure && this.sharedRuntimeModules) {
      // Direct match/binding/record helpers are module-local algorithms over
      // the captured collection host ABI. Import only the operations the
      // emitted statements and selected local helpers actually reference;
      // importing the entire ABI made a two-field `Type.from(...)` projection
      // pull dozens of unrelated List, Set, and Map names into generated code.
      const directUses = new Set(generatedIdentifiers);
      const include = (...names: readonly string[]): void => { for (const name of names) directUses.add(name); };
      if (needsRecordFromHelper || needsRecordMapFromHelper || needsControlledRecordConstruction) {
        include(
          "__velarCollectionRecordGetOwnPropertyDescriptor",
          "__velarCollectionRecordNativeRangeError",
          "__velarCollectionRecordDefineProperty",
          "__velarCollectionListIsArray",
          "__velarCollectionNativeTypeError",
        );
      }
      if (needsRecordFromHelper || needsRecordMapFromHelper) include("__velarReactiveCollectionRead");
      if (needsControlledRecordConstruction) {
        include(
          "__velarCollectionRecordOwnSymbols",
          "__velarCollectionRecordOwnNames",
          "__velarReactiveCollectionTrack",
          "__velarReactiveCollectionRead",
        );
      }
      if (this.needsObjectBindingHelpers) {
        include(
          "__velarCollectionListIsArray",
          "__velarCollectionNativeTypeError",
          "__velarCollectionRecordGetOwnPropertyDescriptor",
          "__velarCollectionRecordOwnSymbols",
          "__velarCollectionRecordOwnNames",
          "__velarCollectionRecordNativeRangeError",
          "__velarCollectionRecordDefineProperty",
          "__velarReactiveCollectionTrack",
          "__velarReactiveCollectionRead",
        );
      }
      if (this.needsListBindingHelpers) {
        include(
          "__velarCollectionListNativeRangeError",
          "__velarCollectionListGetOwnPropertyDescriptor",
          "__velarCollectionNativeArray",
          "__velarReactiveCollectionTrack",
          "__velarReactiveCollectionRead",
        );
      }
      const imports = VELAR_COLLECTION_HOST_EXPORTS.filter((name) => directUses.has(name));
      if (imports.length > 0) {
        this.requireRuntimeModule(VELAR_COLLECTION_HOST_MODULE);
        helpers.push([
          "import {",
          ...imports.map((name) => `  ${name},`),
          `} from ${JSON.stringify(VELAR_COLLECTION_HOST_MODULE)};`,
        ].join("\n"));
      }
    } else if (!this.sharedRuntimeModules && (this.needsCollectionHelpers || needsRuntimeTypeRuntime)) {
      helpers.push(VELAR_COLLECTION_IDENTITY_RUNTIME);
    }
    if (needsRuntimeTypeRuntime) {
      if (this.sharedRuntimeModules) {
        const imports = [
          ["registerRuntimeType", "__velarRegisterRuntimeType"], ["ValidationError", "__VelarValidationError"],
          ["validationState", "__velarValidationState"], ["validationSet", "__velarValidationSet"],
          ["validationWeakMapGet", "__velarValidationWeakMapGet"], ["validationWeakMapSet", "__velarValidationWeakMapSet"], ["validationWeakMapDelete", "__velarValidationWeakMapDelete"],
          ["validationSetHas", "__velarValidationSetHas"], ["validationSetAdd", "__velarValidationSetAdd"], ["validationSetDelete", "__velarValidationSetDelete"], ["validationSetSize", "__velarValidationSetSize"],
          ["validationIsArray", "__velarValidationIsArray"], ["validationOwnDescriptor", "__velarValidationOwnDescriptor"],
          ["validationIsInstance", "__velarValidationIsInstance"], ["validationIsPromise", "__velarValidationIsPromise"],
          ["validationIsPlainObject", "__velarValidationIsPlainObject"], ["validationRejectionHint", "__velarValidationRejectionHint"],
          ["validationFreeze", "__velarValidationFreeze"],
          ["listTypeIs", "__velarListTypeIs"], ["setTypeIs", "__velarSetTypeIs"], ["mapTypeIs", "__velarMapTypeIs"], ["recordTypeIs", "__velarRecordTypeIs"],
        ].filter(([, local]) => usesGeneratedName(local!));
        if (imports.length > 0) {
          this.requireRuntimeModule(VELAR_TYPE_VALIDATION_MODULE);
          helpers.push(`import { ${imports.map(([exported, local]) => `${exported} as ${local}`).join(", ")} } from ${JSON.stringify(VELAR_TYPE_VALIDATION_MODULE)};`);
        }
      } else {
        helpers.push(VELAR_COLLECTION_TYPE_RUNTIME);
        helpers.push(VELAR_TYPE_REGISTRY_RUNTIME);
        helpers.push(VELAR_TYPE_VALIDATION_RUNTIME);
        helpers.push(VELAR_RUNTIME_TYPE_COLLECTION_RUNTIME);
        helpers.push(VELAR_VALIDATION_ERROR_RUNTIME);
      }
    }
    if (this.needsCollectionHelpers) {
      if (this.sharedRuntimeModules) {
        const imports = VELAR_COLLECTION_LOWERING_EXPORTS.filter((name) => usesGeneratedName(name)
          || (this.needsListBindingHelpers && name === "__velarValidateDenseList"));
        if (imports.length > 0) {
          this.requireRuntimeModule(VELAR_COLLECTION_LOWERING_MODULE);
          helpers.push([
            "import {",
            ...imports.map((name) => `  ${name},`),
            `} from ${JSON.stringify(VELAR_COLLECTION_LOWERING_MODULE)};`,
          ].join("\n"));
        }
      } else {
        helpers.push(VELAR_COLLECTION_LIST_RUNTIME);
        helpers.push(VELAR_COLLECTION_SET_MAP_RUNTIME);
        helpers.push(VELAR_COLLECTION_RECORD_RUNTIME);
        helpers.push(VELAR_COLLECTION_LOWERING_RUNTIME);
      }
    }
  }

  /**
   * Phase five: record construction and projection, the two binding-pattern
   * helpers, and the number helper — the lowerings whose helpers depend on
   * which record and binding names the emitted code actually used.
   */
  private selectRecordAndBindingHelpers(selection: HelperSelection): void {
    const { helpers, needsDirectCollectionInfrastructure, generatedIdentifiers, usesGeneratedName,
      needsRecordFromHelper, needsRecordMapFromHelper, needsCreateRecordHelper,
      needsCreateRecordAsyncHelper, needsControlledRecordConstruction } = selection;
    if (this.needsRecordHelpers) {
      const recordHelpers = [
        "const __velarMaxRecordFields = 1000000;",
        "",
        "function __velarSetRecordField(output, field, value, count) {",
        "  const present = __velarCollectionRecordGetOwnPropertyDescriptor(output, field) !== undefined;",
        "  if (!present && count >= __velarMaxRecordFields) throw new __velarCollectionRecordNativeRangeError(\"A record cannot exceed 1000000 fields\");",
        "  __velarCollectionRecordDefineProperty(output, field, { value: value ?? null, writable: true, enumerable: true, configurable: true });",
        "  return present ? count : count + 1;",
        "}",
      ];
      if (needsControlledRecordConstruction) {
        recordHelpers.push(
          "function __velarSpreadRecord(output, value, count) {",
          "  if (value === null || typeof value !== \"object\" || __velarCollectionListIsArray(value)) throw new __velarCollectionNativeTypeError(\"Object spread requires a record object\");",
          "  if (__velarCollectionRecordOwnSymbols(value).length > 0) throw new __velarCollectionNativeTypeError(\"Object spread cannot copy symbol fields\");",
          "  __velarReactiveCollectionTrack(value);",
          "  const fields = __velarCollectionRecordOwnNames(value);",
          "  if (fields.length > __velarMaxRecordFields) throw new __velarCollectionRecordNativeRangeError(\"Object spread cannot inspect more than 1000000 fields\");",
          "  for (let index = 0; index < fields.length; index += 1) {",
          "    const field = fields[index];",
          "    const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, field);",
          "    if (!descriptor) throw new __velarCollectionNativeTypeError(\"Object spread source changed while it was being copied\");",
          "    if (!descriptor.enumerable) continue;",
          "    if (!(\"value\" in descriptor)) throw new __velarCollectionNativeTypeError(\"Object spread cannot copy accessor field '\" + field + \"'\");",
          "    count = __velarSetRecordField(output, field, __velarReactiveCollectionRead(value, field, descriptor.value), count);",
          "  }",
          "  return count;",
          "}",
        );
      }
      if (needsRecordFromHelper) {
        recordHelpers.push(
          "function __velarRecordFrom(source, overrides, fields, target) {",
          "  if (source === null || typeof source !== \"object\" || __velarCollectionListIsArray(source)) throw new __velarCollectionNativeTypeError(target + \".from requires a record source\");",
          "  if (overrides !== null && (typeof overrides !== \"object\" || __velarCollectionListIsArray(overrides))) throw new __velarCollectionNativeTypeError(target + \".from overrides must be a record\");",
          "  const output = {};",
          "  let count = 0;",
          "  for (let index = 0; index < fields.length; index += 1) {",
          "    const field = fields[index][0];",
          "    const optional = fields[index][1];",
          "    let owner = overrides;",
          "    let descriptor = overrides === null ? undefined : __velarCollectionRecordGetOwnPropertyDescriptor(overrides, field);",
          "    if (descriptor === undefined) {",
          "      owner = source;",
          "      descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(source, field);",
          "    }",
          "    if (descriptor === undefined) {",
          "      if (optional) continue;",
          "      throw new __velarCollectionNativeTypeError(target + \".from source is missing required field '\" + field + \"'\");",
          "    }",
          "    if (!descriptor.enumerable || !(\"value\" in descriptor)) throw new __velarCollectionNativeTypeError(target + \".from cannot read non-data field '\" + field + \"'\");",
          "    count = __velarSetRecordField(output, field, __velarReactiveCollectionRead(owner, field, descriptor.value), count);",
          "  }",
          "  return output;",
          "}",
        );
      }
      if (needsRecordMapFromHelper) {
        recordHelpers.push(
          "function __velarRecordMapFrom(source, transform, fields, target) {",
          "  if (source === null || typeof source !== \"object\" || __velarCollectionListIsArray(source)) throw new __velarCollectionNativeTypeError(target + \".mapFrom requires a record source\");",
          "  if (typeof transform !== \"function\") throw new __velarCollectionNativeTypeError(target + \".mapFrom transform must be a function\");",
          "  const output = {};",
          "  let count = 0;",
          "  for (let index = 0; index < fields.length; index += 1) {",
          "    const field = fields[index][0];",
          "    const optional = fields[index][1];",
          "    const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(source, field);",
          "    if (descriptor === undefined) {",
          "      if (optional) continue;",
          "      throw new __velarCollectionNativeTypeError(target + \".mapFrom source is missing required field '\" + field + \"'\");",
          "    }",
          "    if (!descriptor.enumerable || !(\"value\" in descriptor)) throw new __velarCollectionNativeTypeError(target + \".mapFrom cannot read non-data field '\" + field + \"'\");",
          "    const value = __velarReactiveCollectionRead(source, field, descriptor.value);",
          "    count = __velarSetRecordField(output, field, transform(value), count);",
          "  }",
          "  return output;",
          "}",
        );
      }
      this.selectRecordConstructionHelpers(recordHelpers, selection);
      helpers.push(recordHelpers.join("\n"));
    }
    this.selectBindingHelpers(selection);
  }

  /**
   * The two record constructors: the plain one, and the asynchronous one that
   * awaits its field values before the record is sealed.
   */
  private selectRecordConstructionHelpers(recordHelpers: string[], selection: HelperSelection): void {
    const { needsCreateRecordHelper, needsCreateRecordAsyncHelper } = selection;
    if (needsCreateRecordHelper) {
      recordHelpers.push(
        "function __velarCreateRecord(parts) {",
        "  const output = {};",
        "  let count = 0;",
        "  for (let index = 0; index < parts.length; index += 1) {",
        "    const spread = parts[index][0];",
        "    const field = parts[index][1];",
        "    const read = parts[index][2];",
        "    if (spread) count = __velarSpreadRecord(output, read(), count);",
        "    else count = __velarSetRecordField(output, field, read(), count);",
        "  }",
        "  return output;",
        "}",
      );
    }
    if (needsCreateRecordAsyncHelper) {
      recordHelpers.push(
        "async function __velarCreateRecordAsync(parts) {",
        "  const output = {};",
        "  let count = 0;",
        "  for (let index = 0; index < parts.length; index += 1) {",
        "    const spread = parts[index][0];",
        "    const field = parts[index][1];",
        "    const asynchronous = parts[index][2];",
        "    const read = parts[index][3];",
        "    if (spread) count = __velarSpreadRecord(output, asynchronous ? await read() : read(), count);",
        "    else count = __velarSetRecordField(output, field, asynchronous ? await read() : read(), count);",
        "  }",
        "  return output;",
        "}",
      );
    }
  }

  /**
   * The duration arithmetic an extension lowered: one helper pair emitted
   * whenever any call in the module was resolved to it.
   */
  private selectDurationHelpers(helpers: string[]): void {
    if ([...this.hints.extensionCalls.values()].includes("core.duration-arithmetic")) helpers.push([
      "const __velarDurationApply = Reflect.apply;",
      "const __velarDurationPattern = /^([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))(ms|s)$/;",
      "const __velarDurationRegExpExec = RegExp.prototype.exec;",
      "const __velarDurationNumber = Number;",
      "const __velarDurationNumberIsFinite = Number.isFinite;",
      "const __velarDurationObjectIs = Object.is;",
      "const __velarDurationString = String;",
      "const __velarDurationTypeError = TypeError;",
      "const __velarDurationRangeError = RangeError;",
      "function __velarDurationMilliseconds(value) {",
      "  if (typeof value !== \"string\") throw new __velarDurationTypeError(\"Duration arithmetic requires Duration values\");",
      "  const match = __velarDurationApply(__velarDurationRegExpExec, __velarDurationPattern, [value]);",
      "  if (!match) throw new __velarDurationTypeError(\"Duration arithmetic requires Duration values\");",
      "  const milliseconds = __velarDurationNumber(match[1]) * (match[2] === \"s\" ? 1000 : 1);",
      "  if (!__velarDurationNumberIsFinite(milliseconds)) throw new __velarDurationRangeError(\"Duration arithmetic must produce a finite value\");",
      "  return milliseconds;",
      "}",
      "function __velarDurationValue(milliseconds) {",
      "  if (!__velarDurationNumberIsFinite(milliseconds)) throw new __velarDurationRangeError(\"Duration arithmetic must produce a finite value\");",
      "  return __velarDurationString(__velarDurationObjectIs(milliseconds, -0) ? 0 : milliseconds) + \"ms\";",
      "}",
      "function __velarDurationUnary(operator, value) { const milliseconds = __velarDurationMilliseconds(value); return __velarDurationValue(operator === \"-\" ? -milliseconds : milliseconds); }",
      "function __velarDurationMath(operator, left, right) {",
      "  if (operator === \"+\" || operator === \"-\") { const a = __velarDurationMilliseconds(left), b = __velarDurationMilliseconds(right); return __velarDurationValue(operator === \"+\" ? a + b : a - b); }",
      "  if (operator === \"*\" && typeof left === \"number\") return __velarDurationValue(left * __velarDurationMilliseconds(right));",
      "  const milliseconds = __velarDurationMilliseconds(left);",
      "  if (typeof right !== \"number\" || !__velarDurationNumberIsFinite(right)) throw new __velarDurationTypeError(\"Duration scaling requires a finite number\");",
      "  if (operator === \"/\" && right === 0) throw new __velarDurationRangeError(\"Duration arithmetic cannot divide by zero\");",
      "  return __velarDurationValue(operator === \"*\" ? milliseconds * right : milliseconds / right);",
      "}",
    ].join("\n"));
  }

  /**
   * The two binding-pattern helpers a destructuring emits, and the number
   * helper a numeric method lowers through.
   */
  private selectBindingHelpers(selection: HelperSelection): void {
    const { helpers } = selection;
    if (this.needsObjectBindingHelpers) {
      helpers.push([
        "const __velarMaxBindingFields = 1000000;",
        "",
        "function __velarRequireBindingObject(value, name) {",
        "  if (value === null || typeof value !== \"object\" || __velarCollectionListIsArray(value)) throw new __velarCollectionNativeTypeError(name + \" object binding requires a record object\");",
        "  return value;",
        "}",
        "function __velarReadBindingField(value, field, optional, name) {",
        "  __velarReactiveCollectionTrack(value, field);",
        "  const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, field);",
        "  if (descriptor === undefined) {",
        "    if (optional) return null;",
        "    throw new __velarCollectionNativeTypeError(name + \" object binding requires own data field '\" + field + \"'\");",
        "  }",
        "  if (!descriptor.enumerable || !(\"value\" in descriptor)) throw new __velarCollectionNativeTypeError(name + \" object binding requires enumerable data field '\" + field + \"'\");",
        "  return __velarReactiveCollectionRead(value, field, descriptor.value) ?? null;",
        "}",
        "function __velarBindingObjectRest(value, excluded, name) {",
        "  if (__velarCollectionRecordOwnSymbols(value).length > 0) throw new __velarCollectionNativeTypeError(name + \" object rest cannot copy symbol fields\");",
        "  __velarReactiveCollectionTrack(value);",
        "  const fields = __velarCollectionRecordOwnNames(value);",
        "  if (fields.length > __velarMaxBindingFields) throw new __velarCollectionRecordNativeRangeError(name + \" object rest cannot copy more than 1000000 fields\");",
        "  const output = {};",
        "  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {",
        "    const field = fields[fieldIndex];",
        "    let selected = false;",
        "    for (let index = 0; index < excluded.length; index += 1) if (excluded[index] === field) { selected = true; break; }",
        "    if (selected) continue;",
        "    const descriptor = __velarCollectionRecordGetOwnPropertyDescriptor(value, field);",
        "    if (!descriptor?.enumerable) continue;",
        "    if (!(\"value\" in descriptor)) throw new __velarCollectionNativeTypeError(name + \" object rest cannot copy accessor field '\" + field + \"'\");",
        "    __velarCollectionRecordDefineProperty(output, field, { value: __velarReactiveCollectionRead(value, field, descriptor.value) ?? null, writable: true, enumerable: true, configurable: true });",
        "  }",
        "  return output;",
        "}",
      ].join("\n"));
    }
    if (this.needsListBindingHelpers) {
      helpers.push([
        "function __velarRequireBindingList(value, size, hasRest, name) {",
        "  __velarValidateDenseList(value, name + \" List binding\");",
        "  __velarReactiveCollectionTrack(value);",
        "  const valid = hasRest ? value.length >= size : value.length === size;",
        "  if (!valid) throw new __velarCollectionListNativeRangeError(name + \" List binding\" + (hasRest ? \" requires at least \" : \" requires exactly \") + size + (size === 1 ? \" item\" : \" items\") + \", received \" + value.length);",
        "  return value;",
        "}",
        "function __velarReadBindingListItem(value, index) {",
        "  return __velarReactiveCollectionRead(value, index, __velarCollectionListGetOwnPropertyDescriptor(value, index).value) ?? null;",
        "}",
        "function __velarBindingListRest(value, start) {",
        "  const output = new __velarCollectionNativeArray(value.length - start);",
        "  for (let index = start; index < value.length; index += 1) output[index - start] = __velarReactiveCollectionRead(value, index, __velarCollectionListGetOwnPropertyDescriptor(value, index).value) ?? null;",
        "  return output;",
        "}",
      ].join("\n"));
    }
    if (this.needsNumberHelper) {
      helpers.push([
        "function __velarNumber(value) {",
        "  if (typeof value !== \"string\") throw new TypeError(\"number(text) requires a string\");",
        "  const text = value.trim();",
        "  if (!/^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?$/u.test(text)) return null;",
        "  const parsed = Number(text);",
        "  return Number.isFinite(parsed) ? parsed : null;",
        "}",
      ].join("\n"));
    }
  }

  sourceMap(source: SourceText): string {
    return sourceMapFor(this.generatedCode, this.generatedMappings, source);
  }

  embeddedModules(source: SourceText, emitSourceMap = true): readonly CompilerEmbeddedJavaScriptModule[] {
    return [...this.embeddedJavaScript.values()].map((module) => ({
      specifier: module.specifier,
      code: module.code,
      sourceMap: emitSourceMap ? sourceMapFor(module.code, module.mappings, source) : "",
      sourceSpan: module.statement.sourceSpan,
    }));
  }

  runtimeModules(): readonly string[] {
    return [...this.requiredRuntimeModules].sort();
  }

  protected emitMappedJavaScript(sourceSpan: Span, render: () => string): string {
    return this.sourceMapper.markJavaScriptNode(this.sourceMapper.emitJavaScriptNode(sourceSpan, render));
  }

  protected additionalHelpers(_program: Program): readonly string[] {
    return [];
  }


  protected reactiveBridgeHelpers(
    needsJavaScriptCallBoundary: boolean,
    needsCollections: boolean,
    usedIdentifiers: ReadonlySet<string> = new Set(),
  ): readonly string[] {
    return this.runtimeImports.reactiveBridgeHelpers(needsJavaScriptCallBoundary, needsCollections, usedIdentifiers);
  }

  protected usesSharedRuntimeModules(): boolean {
    return this.sharedRuntimeModules;
  }


  // The compiler-owned observer behind the 'detach <expression>' statement
  // (docs/contributing/runtime-boundary.md, B-DETACHED-TASK). The Promise and Reflect
  // operations and the console channel are captured at module initialization;
  // rejection is normalized to Error and reported on the host error channel
  // without ending the process. Hosts with their own error chain override
  // this (the Web emitter routes the report through the velar/app chain).
  //
  // The reporter itself must never fail outward: a rejection value carries a
  // foreign error object whose 'stack' or 'message' may be a throwing getter,
  // and a throw inside a rejection handler becomes an unhandled rejection that
  // ends the Node process — the exact program termination this boundary
  // forbids. Every foreign read is therefore guarded, and the Promise derived
  // from adopting the task is observed rather than discarded.
  protected detachedTaskHelpers(): readonly string[] {
    return this.runtimeImports.detachedTaskHelpers();
  }


  /**
   * D43 item 69 rule 8: a release that fails while an error is already in
   * flight must not replace it. The original error keeps the throw; the release
   * failure is normalized and reported through the host channel. The reporter
   * itself never fails outward, for the same reason the detached-task reporter
   * does not — a throw inside it would end the process.
   */
  protected disposalHelpers(): readonly string[] {
    return this.runtimeImports.disposalHelpers();
  }


  /**
   * D51 rule 103: the three failures that mean "this program has a bug", by the
   * one name each of them stamps on itself. A forged name can only make a
   * failure propagate instead of becoming `null`, which is the safe direction:
   * `try` never hides a guard, and `catch` still receives everything.
   */
  protected integrityFailureHelpers(): readonly string[] {
    return this.runtimeImports.integrityFailureHelpers();
  }


  /**
   * D86 rule 212: `value!` raises the same `AssertionError` an
   * `assert value != null` raises, so the integrity check above keeps letting
   * it through `try` — a broken assertion is a bug, never a "not found".
   */
  protected requiredValueHelpers(): readonly string[] {
    return this.runtimeImports.requiredValueHelpers();
  }

  protected requireRuntimeModule(source: string): void {
    this.requiredRuntimeModules.add(source);
  }

  protected includesErrorNormalizationRuntime(): boolean {
    return false;
  }

  protected visitExtensionRuntimeExpression(_expression: Expression, _visitExpression: (expression: Expression) => void): boolean {
    return false;
  }

  protected visitExtensionRuntimeStatement(
    _statement: Statement,
    _visitExpression: (expression: Expression) => void,
    _visitStatement: (statement: Statement) => void,
  ): boolean {
    return false;
  }

  protected extensionExpressionContainsDirectAwait(
    _expression: Expression,
    _contains: (expression: Expression) => boolean,
  ): boolean | undefined {
    return undefined;
  }

  protected extensionStatementContainsDirectAwait(
    _statement: Statement,
    _containsExpression: (expression: Expression) => boolean,
    _containsBlock: (statements: readonly Statement[]) => boolean,
  ): boolean | undefined {
    return undefined;
  }

  protected emitMappedStatement(statement: Statement, depth: number): string {
    return this.emitMappedJavaScript(statement.span, () => this.emitStatement(statement, depth));
  }

  /**
   * D43 item 69: a `using` binding owns the rest of its block, so a statement
   * list is emitted as a whole. Everything after the binding moves inside the
   * release frame; a second `using` nests inside the first, which is what makes
   * release order the reverse of declaration order.
   */
  protected emitStatementLines(statements: readonly Statement[], depth: number): readonly string[] {
    const owned = statements.findIndex((statement) => statement.kind === "UsingDeclaration");
    const plain = (values: readonly Statement[]): string[] =>
      values.map((child) => this.emitMappedStatement(child, depth)).filter(Boolean);
    if (owned < 0) return plain(statements);
    return [
      ...plain(statements.slice(0, owned)),
      ...this.statements.emitUsingScope(statements[owned] as UsingDeclaration, statements.slice(owned + 1), depth),
    ];
  }


  protected emitStatement(statement: Statement, depth: number): string {
    return this.statements.emitStatement(statement, depth);
  }


  protected emitTypeCheck(type: ValueType, value: string, state = "undefined"): string {
    return this.typeChecks.emitTypeCheck(type, value, state);
  }


  protected emitIsCheck(type: ValueType, value: string): string {
    return this.typeChecks.emitIsCheck(type, value);
  }


  protected emitNarrowingCheck(type: ValueType, value: string, state = "undefined"): string {
    return this.typeChecks.emitNarrowingCheck(type, value, state);
  }

  /**
   * D55 rule 121: the name a module writes for a generic record is a JavaScript
   * binding holding its instantiation factory — declared here, or imported from
   * the module that declares it. Nothing else may be written into `.of(...)`.
   */
  protected genericTypeBinding(name: string): boolean {
    if (this.hints.genericTypeNames.has(name)) return true;
    const declaration = this.typeDeclarations.get(name);
    return declaration?.kind === "TypeDeclaration" && (declaration.typeParameters?.length ?? 0) > 0;
  }

  /**
   * D60 rule 148: a `named` ValueType carries the type's *display* name, which
   * is a runtime binding only when this module really has a Type object under
   * it — a local `type` declaration, an imported one, an enum, or a class. An
   * unresolved generic formats to type text (`Component<(label: string) ->
   * WebNode>`) that is not even a JavaScript identifier, and an extension host
   * scalar (`Color`, `Length`, `WebNode`) has no binding at all. Writing either
   * into the output is how `velar check` passed and `velar build` then failed
   * to parse its own emission; the narrowing path (FLW-U1) already asks this
   * question, and every other check path now asks it too.
   */
  protected runtimeTypeBinding(name: string): boolean {
    return this.hints.enumNames.has(name)
      || this.hints.classNames.has(name)
      || this.typeDeclarations.has(name)
      || this.hints.runtimeTypeObjectNames.has(name);
  }

  /**
   * D60 rule 148 for the nominal kinds. `class`, `enum`, and `enumMember` carry
   * a *display* name the same way `named` does, and that name belongs to the
   * module that **declared** the type, not to the module now emitting. A module
   * reaches a type through an imported signature alone — `def maybeKind() ->
   * Kind?` imported without `Kind` — as often as it imports the name, and
   * writing the display name there produced a check that passed `velar check`,
   * bundled without complaint, and threw `ReferenceError: Kind is not defined`
   * the first time it evaluated. Every writer of a nominal receiver asks here,
   * so there is one gate rather than one per call site.
   *
   * A builtin error class answers under the runtime name the emitter imports
   * for it, so it is reachable from every module regardless of what the source
   * named.
   */
  protected nominalRuntimeReceiver(type: Extract<ValueType, { readonly kind: "class" | "enum" | "enumMember" }>): string | null {
    if (type.kind === "class") {
      const builtin = this.typeChecks.builtinErrorRuntimeName(type.name);
      if (builtin !== null) return builtin;
      // D77 rule 194 item 2: type arguments are erased, so the receiver behind
      // `Stack<number>` is the class binding `Stack` — the only name the
      // instance check can be spelled against. The display text keeps the
      // arguments; only the emitted receiver drops them.
      if (type.application) return this.runtimeTypeBinding(type.application.name) ? type.application.name : null;
    }
    return this.runtimeTypeBinding(type.name) ? type.name : null;
  }

  protected emitParameter(name: string, defaultValue: Expression | null, rest = false): string {
    if (rest) return `...${name}`;
    return defaultValue ? `${name} = ${this.emitMappedExpression(defaultValue)}` : name;
  }

  protected emitMappedExpression(expression: Expression, normalizeNull = true): string {
    return this.emitMappedJavaScript(expression.span, () => {
      const key = spanIdentity(expression.span);
      // The wrapper covers exactly the value it wraps, so suppression follows
      // the value rather than the whole subtree: an `await` in an argument
      // position produces a *different* Promise and keeps its own boundary,
      // which is what makes `await use(await supply())` check both of them.
      const suppressed = this.suppressedPromiseValues.delete(key);
      const normalizePromise = normalizeNull && !suppressed && this.hints.normalizedPromiseValues.has(key);
      const passThrough = normalizePromise || suppressed
        ? promiseValuePassThrough(expression).map((item) => spanIdentity(item.span))
        : [];
      for (const item of passThrough) this.suppressedPromiseValues.add(item);
      let emitted: string;
      try {
        emitted = this.emitExpression(expression);
      } finally {
        for (const item of passThrough) this.suppressedPromiseValues.delete(item);
      }
      const narrowing = this.hints.runtimeNarrowings.get(key);
      if (narrowing) {
        emitted = `(__velarValue => __velarNarrow(__velarValue, ${this.emitNarrowingCheck(narrowing.expected, "__velarValue")}, ${JSON.stringify(describeType(narrowing.expected))}, ${JSON.stringify(narrowing.description)}, ${expression.span.start}))(${emitted})`;
      }
      // D68 rule 177: the projection lives here rather than in each of the
      // eight consumers, because "iterating a class means iterating what
      // `@iterate:` answers" is one fact about the operand, and the consumers'
      // own lowerings then receive the List, Set, Map, or Record they already
      // knew how to handle.
      if (this.hints.iterationContracts.has(key)) emitted = `(${emitted})[${JSON.stringify(iterateMemberKey)}]()`;
      if (!normalizeNull) return emitted;
      if (normalizePromise) return `__velarNormalizePromiseValue(${emitted})`;
      if (this.hints.normalizedNullResults.has(key)) return `(${emitted}, null)`;
      if (this.hints.normalizedUndefinedExpressions.has(key)) return `(${emitted} ?? null)`;
      return emitted;
    });
  }

  private emitMappedAssignmentTarget(expression: Extract<Expression, { kind: "IdentifierExpression" | "MemberExpression" }>): string {
    return this.emitMappedJavaScript(expression.span, () => {
      if (expression.kind === "IdentifierExpression") return this.emitExpression(expression);
      const property = `${this.hints.privateMembers.has(spanIdentity(expression.span)) ? "#" : ""}${expression.property}`;
      return `${this.expressions.emitPostfixReceiver(expression.object)}.${property}`;
    });
  }


  protected emitExpression(expression: Expression): string {
    return this.expressions.emitExpression(expression);
  }

  // A 'bool?' condition asks whether the value is true, so it lowers to an
  // explicit '=== true'. Both 'false' and an absent value then take the same
  // else path instead of riding on JavaScript truthiness.
  protected emitCondition(expression: Expression): string {
    const value = this.emitMappedExpression(expression);
    return this.hints.truthConditions.has(spanIdentity(expression.span)) ? `(${value} === true)` : value;
  }

  protected expressionContainsDirectAwait(expression: Expression): boolean {
    return containsDirectAwait(expression, (value, contains) => this.extensionExpressionContainsDirectAwait(value, contains));
  }

  protected emitObjectKey(name: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
  }

  protected emitBindingPatternStatements(
    pattern: BindingPattern,
    value: string,
    binding: "const" | "let",
    exported: boolean,
    depth: number,
    label: string,
  ): readonly string[] {
    const lines: string[] = [];
    const indentation = "  ".repeat(depth);
    let temporary = 0;
    const nextTemporary = (kind: string, current: BindingPattern): string => `__velarBinding${kind}${current.span.start}_${temporary++}`;
    const declare = (name: string, expression: string): void => {
      lines.push(`${indentation}${exported ? "export " : ""}${binding} ${name} = ${expression};`);
    };
    const emit = (current: BindingPattern, currentValue: string): void => {
      if (current.kind === "NameBindingPattern") {
        declare(current.name, currentValue);
        return;
      }
      if (current.kind === "ObjectBindingPattern") {
        this.needsCollectionHelpers = true;
        this.needsObjectBindingHelpers = true;
        const object = nextTemporary("Object", current);
        lines.push(`${indentation}const ${object} = __velarRequireBindingObject(${currentValue}, ${JSON.stringify(label)});`);
        for (const entry of current.entries) {
          const read = `__velarReadBindingField(${object}, ${JSON.stringify(entry.property)}, ${this.hints.optionalBindingEntries.has(entry.span.start)}, ${JSON.stringify(label)})`;
          if (entry.pattern.kind === "NameBindingPattern") {
            declare(entry.pattern.name, read);
          } else {
            const field = nextTemporary("Field", entry.pattern);
            lines.push(`${indentation}const ${field} = ${read};`);
            emit(entry.pattern, field);
          }
        }
        if (current.rest) {
          declare(
            current.rest.name,
            `__velarBindingObjectRest(${object}, ${JSON.stringify(current.entries.map((entry) => entry.property))}, ${JSON.stringify(label)})`,
          );
        }
        return;
      }

      this.needsCollectionHelpers = true;
      this.needsListBindingHelpers = true;
      const list = nextTemporary("List", current);
      lines.push(`${indentation}const ${list} = __velarRequireBindingList(${currentValue}, ${current.elements.length}, ${current.rest !== null}, ${JSON.stringify(label)});`);
      current.elements.forEach((element, index) => {
        if (!element) return;
        const read = `__velarReadBindingListItem(${list}, ${index})`;
        if (element.kind === "NameBindingPattern") {
          declare(element.name, read);
        } else {
          const item = nextTemporary("Item", element);
          lines.push(`${indentation}const ${item} = ${read};`);
          emit(element, item);
        }
      });
      if (current.rest) {
        declare(current.rest.name, `__velarBindingListRest(${list}, ${current.elements.length})`);
      }
    };

    emit(pattern, value);
    return lines;
  }

  protected blockAlwaysReturns(statements: readonly Statement[]): boolean {
    for (const statement of statements) {
      if (statement.kind === "ReturnStatement" || statement.kind === "ThrowStatement") return true;
      if (statement.kind === "IfStatement" && statement.elseBody
        && this.blockAlwaysReturns(statement.thenBody) && this.blockAlwaysReturns(statement.elseBody)) return true;
      if (statement.kind === "MatchStatement" && this.hints.exhaustiveMatches.has(statement.span.start)
        && statement.cases.every((branch) => this.blockAlwaysReturns(branch.body))) return true;
      if (statement.kind === "TryStatement") {
        if (statement.finallyBody && this.blockAlwaysReturns(statement.finallyBody)) return true;
        if (statement.catchBody && this.blockAlwaysReturns(statement.tryBody) && this.blockAlwaysReturns(statement.catchBody)) return true;
      }
    }
    return false;
  }
}

/**
 * The sub-expressions whose value *is* this expression's value. A Promise
 * wrapper on the outer node already normalizes whatever these produce, so they
 * skip a second one; every other position — an argument, a receiver, a
 * function body — carries a Promise of its own and keeps its own boundary.
 */
function promiseValuePassThrough(expression: Expression): readonly Expression[] {
  if (expression.kind === "ConditionalExpression") return [expression.thenValue, expression.elseValue];
  if (expression.kind === "BinaryExpression" && expression.operator === "??") return [expression.left, expression.right];
  return [];
}


function javaScriptIdentifiers(sources: readonly string[]): ReadonlySet<string> {
  const identifiers = new Set<string>();
  // 生成代码里的合法裸标识符只会使用 ASCII。这里位于每个模块的发射热路径，
  // 逐字符创建字符串再跑两个正则会产生大量短命对象；直接判断 UTF-16 码元既
  // 保留完全相同的词法范围，也让扫描成本稳定为一次 charCodeAt 和整数比较。
  const identifierStart = (code: number): boolean =>
    (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 36 || code === 95;
  const identifierPart = (code: number): boolean => identifierStart(code) || (code >= 48 && code <= 57);

  for (const source of sources) {
    let index = 0;
    const skipQuoted = (quote: "'" | '"'): void => {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index] === quote) { index += 1; return; }
        else index += 1;
      }
    };
    const skipLineComment = (): void => {
      index += 2;
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
    };
    const skipBlockComment = (): void => {
      index += 2;
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") { index += 2; return; }
        index += 1;
      }
    };

    let scanCode!: (templateExpression: boolean) => void;
    const skipTemplate = (): void => {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index] === "`") { index += 1; return; }
        else if (source[index] === "$" && source[index + 1] === "{") {
          index += 2;
          scanCode(true);
        } else index += 1;
      }
    };
    scanCode = (templateExpression: boolean): void => {
      let braceDepth = 0;
      while (index < source.length) {
        const character = source[index]!;
        if (character === "'" || character === '"') { skipQuoted(character); continue; }
        if (character === "`") { skipTemplate(); continue; }
        if (character === "/" && source[index + 1] === "/") { skipLineComment(); continue; }
        if (character === "/" && source[index + 1] === "*") { skipBlockComment(); continue; }
        if (character === "{") { braceDepth += 1; index += 1; continue; }
        if (character === "}" && templateExpression) {
          if (braceDepth === 0) { index += 1; return; }
          braceDepth -= 1;
          index += 1;
          continue;
        }
        if (identifierStart(source.charCodeAt(index))) {
          const start = index;
          index += 1;
          while (index < source.length && identifierPart(source.charCodeAt(index))) index += 1;
          identifiers.add(source.slice(start, index));
          continue;
        }
        index += 1;
      }
    };
    scanCode(false);
  }
  return identifiers;
}

const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeVlq(value: number): string {
  let remaining = value < 0 ? ((-value) << 1) | 1 : value << 1;
  let output = "";
  do {
    let digit = remaining & 31;
    remaining >>>= 5;
    if (remaining > 0) digit |= 32;
    output += base64[digit];
  } while (remaining > 0);
  return output;
}

function generatedLineAt(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle]! <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

function sourceMapFor(code: string, generatedMappings: readonly GeneratedMapping[], source: SourceText): string {
  const lineStarts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] === "\n") lineStarts.push(index + 1);
  }
  const byLine = new Map<number, Array<{ column: number; span: Span }>>();
  for (const mapping of generatedMappings) {
    const line = generatedLineAt(lineStarts, mapping.offset);
    const entries = byLine.get(line) ?? [];
    entries.push({ column: mapping.offset - lineStarts[line]!, span: mapping.sourceSpan });
    byLine.set(line, entries);
  }
  let previousSource = 0;
  let previousLine = 0;
  let previousColumn = 0;
  const mappings = lineStarts.map((_, line) => {
    let previousGeneratedColumn = 0;
    return (byLine.get(line) ?? []).sort((left, right) => left.column - right.column).map((mapped) => {
      const location = source.location(mapped.span.start);
      const originalLine = location.line - 1;
      const originalColumn = location.column - 1;
      const segment = [
        encodeVlq(mapped.column - previousGeneratedColumn),
        encodeVlq(-previousSource),
        encodeVlq(originalLine - previousLine),
        encodeVlq(originalColumn - previousColumn),
      ].join("");
      previousGeneratedColumn = mapped.column;
      previousSource = 0;
      previousLine = originalLine;
      previousColumn = originalColumn;
      return segment;
    }).join(",");
  }).join(";");
  return JSON.stringify({
    version: 3,
    // Source-map sources are URLs, not host path strings. A Windows drive path
    // starts with what URL parsers treat as a scheme (`C:`), so Node cannot
    // map the generated frame back to VelarScript unless the drive path is a
    // real file URL. POSIX and project-relative paths keep their existing form.
    sources: [/^[A-Za-z]:[\\/]/u.test(source.path)
      ? `file:///${source.path.replaceAll("\\", "/")}`
      : source.path.replaceAll("\\", "/")],
    sourcesContent: [source.text],
    names: [],
    mappings,
  });
}




