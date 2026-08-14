import type { AnalysisContext, ClassInfo, FormReadField, LoweringHints } from "./analyzer.ts";
import type { Analyzer } from "./analyzer.ts";
import type { CoreExpression, CoreStatement, Expression, Parameter, Program, Statement, TypeReference, TypeSyntax } from "./ast.ts";
import type { Diagnostic } from "./diagnostic.ts";
import type { Parser } from "./parser.ts";
import type { SourceText, Span } from "./source.ts";
import type { CompilerSemanticExtension, SemanticSymbol } from "./semantic.ts";
import type { Token } from "./token.ts";
import type { EnumInfo, ExtensionTypeSyntaxResolver, ExtensionValueType, ValueType } from "./types.ts";

export { expressionContainsDirectAwait } from "./ast.ts";
export { VELAR_CLASS_FIELD_MODULE, VELAR_CLASS_FIELD_MODULE_SOURCE, VELAR_CLASS_FIELD_RUNTIME } from "./class-runtime.ts";
export { VELAR_COLLECTION_HOST_EXPORTS, VELAR_COLLECTION_HOST_MODULE, VELAR_COLLECTION_HOST_MODULE_SOURCE, VELAR_COLLECTION_IDENTITY_RUNTIME, VELAR_COLLECTION_LIST_RUNTIME, VELAR_COLLECTION_RECORD_RUNTIME, VELAR_COLLECTION_SET_MAP_RUNTIME, VELAR_COLLECTION_TYPE_RUNTIME } from "./collection-runtime.ts";
export { VELAR_COLLECTION_LOWERING_DEPENDENCIES, VELAR_COLLECTION_LOWERING_EXPORTS, VELAR_COLLECTION_LOWERING_MODULE, VELAR_COLLECTION_LOWERING_MODULE_SOURCE, VELAR_COLLECTION_LOWERING_RUNTIME } from "./collection-lowering-runtime.ts";
export { JavaScriptEmitter } from "./emitter.ts";
export { findInterpolatedExpressionEnd, scanStringLiteral } from "./interpolated-string.ts";
export { VELAR_ERROR_NORMALIZATION_MODULE, VELAR_ERROR_NORMALIZATION_MODULE_SOURCE, VELAR_ERROR_NORMALIZATION_RUNTIME, VELAR_HOST_ERROR_NAMES, VELAR_HOST_ERROR_PATH_NAMES, VELAR_HOST_ERROR_RUNTIME } from "./error-runtime.ts";
export { VELAR_STRICT_JSON_RUNTIME } from "./json-runtime.ts";
export { VELAR_NUMBER_METHOD_RUNTIME } from "./number-runtime.ts";
export { VELAR_NARROWING_MODULE, VELAR_NARROWING_MODULE_SOURCE, VELAR_NARROWING_RUNTIME } from "./narrowing-runtime.ts";
export { VELAR_PRIMITIVE_METHOD_MODULE, VELAR_PRIMITIVE_METHOD_MODULE_SOURCE } from "./primitive-runtime.ts";
export { VELAR_PROMISE_NORMALIZATION_MODULE, VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE, VELAR_PROMISE_NORMALIZATION_RUNTIME } from "./promise-runtime.ts";
export { VELAR_REACTIVE_BRIDGE_MODULE, VELAR_REACTIVE_BRIDGE_MODULE_SOURCE, VELAR_REACTIVE_BRIDGE_RUNTIME, VELAR_REACTIVE_COLLECTION_BRIDGE_RUNTIME } from "./reactive-bridge-runtime.ts";
export { VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY, VELAR_RUNTIME_REGISTRY_KEY, VELAR_RUNTIME_SCHEMA_VERSION, VELAR_TYPE_REGISTRY_KEY } from "./runtime-abi.ts";
export { VELAR_TYPE_REGISTRY_RUNTIME } from "./type-registry-runtime.ts";
export {
  VELAR_RUNTIME_TYPE_COLLECTION_RUNTIME,
  VELAR_TYPE_VALIDATION_MODULE,
  VELAR_TYPE_VALIDATION_MODULE_SOURCE,
  VELAR_TYPE_VALIDATION_RUNTIME,
  VELAR_VALIDATION_ERROR_RUNTIME,
} from "./type-validation-runtime.ts";
export { VELAR_TEXT_METHOD_RUNTIME } from "./text-runtime.ts";
export { VELAR_UTF8_RUNTIME } from "./utf8-runtime.ts";
export { Analyzer, TEXT_NAMESPACE_MEMBERS } from "./analyzer.ts";
export type {
  CoreExpression,
  CoreStatement,
  Expression,
  Parameter,
  Program,
  Statement,
  TypeReference,
  TypeSyntax,
} from "./ast.ts";
export type { AnalysisContext, ClassField, ClassInfo, FormReadField, LoweringHints } from "./analyzer.ts";
export { Parser } from "./parser.ts";
export { spanIdentity } from "./source.ts";
export type { Span } from "./source.ts";
export type { ParseResult } from "./parser.ts";
export type { CompilerSemanticExtension, SemanticDeclareOptions, SemanticExtensionContext, SemanticFunctionLike } from "./semantic.ts";
export type { Token, TokenKind } from "./token.ts";
export {
  anyType,
  boolType,
  describeType,
  invalidType,
  isInvalidType,
  isAssignable,
  isReadonlyView,
  nullType,
  nonOptional,
  numberType,
  optionalOf,
  readonlyViewOf,
  stringType,
  unionOf,
  unknownType,
} from "./types.ts";
export type { ExtensionTypeSyntaxResolver, ExtensionValueType, ExtensionTypeDisplay, ValueType } from "./types.ts";

export const VELAR_EXTENSION_PROTOCOL_VERSION = 1 as const;

export type VelarExtensionKind = "application" | "capability" | "language";

/**
 * Semantic identity of an installed Velar extension. npm owns package
 * acquisition and version resolution; this contract owns compiler/runtime
 * composition and therefore uses an API version independent of npm semver.
 */
export interface VelarExtensionContract {
  readonly protocolVersion: typeof VELAR_EXTENSION_PROTOCOL_VERSION;
  readonly apiVersion: string;
  readonly kind: VelarExtensionKind;
  readonly extends: Readonly<Record<string, string>>;
  /**
   * Application targets whose public compiler/runtime layers are assembled
   * into this extension. Composition does not activate another application
   * extension in the project graph; it records ownership and API provenance.
   */
  readonly composes?: Readonly<Record<string, string>>;
}

export interface CompilerEmitter {
  emit(program: Program): string;
  sourceMap(source: SourceText): string;
  runtimeModules?(): readonly string[];
  css?(): string;
  styleSegments?(): CompilerStyleSegments;
}

export interface CompilerEmitterOptions {
  readonly sharedRuntimeModules?: boolean;
}

export interface CompilerStyleSegments {
  readonly before: string;
  readonly controlled: string;
  readonly after: string;
}

export interface CompilerLexicalExtension {
  /**
   * Statement- and expression-head words the extension owns. D30 item 16 made
   * them contextual: the lexer leaves them ordinary identifiers, so each stays
   * available as a binding, parameter, field, or argument name, and the
   * extension's parser claims one only where its declaration shape is
   * unmistakable. Declaring the vocabulary here is what lets Core recognize an
   * indentation-owned extension block and an editor document the word.
   */
  readonly contextualKeywords?: ReadonlySet<string>;
  readonly forbiddenIdentifiers?: Readonly<Record<string, string>>;
  readonly numericSuffixes?: ReadonlySet<string>;
  readonly scan?: (context: CompilerLexicalScanContext) => CompilerLexicalScanResult | null;
}

export interface CompilerLexicalScanContext {
  readonly source: string;
  readonly offset: number;
  readonly currentIndent: number;
  readonly tokens: readonly Token[];
}

export interface CompilerLexicalScanResult {
  readonly token: Token;
  readonly nextOffset: number;
  readonly diagnostics?: readonly Diagnostic[];
  readonly startsLine?: boolean;
}

export interface CompilerAnalysisExtension {
  readonly primitiveTypes?: ReadonlySet<string>;
  readonly primitiveParents?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly primitiveMutableFields?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly globals?: ReadonlyMap<string, ValueType>;
  readonly reservedBindings?: ReadonlySet<string>;
  readonly globalGuidance?: ReadonlyMap<string, string>;
  /**
   * Guidance that replaces `globalGuidance` inside a module whose path ends
   * with the keyed suffix. The right door for a reserved global depends on
   * where the author is standing: `document` inside a component means JSX and
   * refs, and inside a `.browser.test.vel` it means `velar/web-test`.
   */
  readonly globalGuidanceByPathSuffix?: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Resolve target-owned type syntax without teaching Core the target's types. */
  readonly resolveTypeSyntax?: ExtensionTypeSyntaxResolver;
  /** Decide compatibility inside a target-owned type family. */
  readonly isTypeAssignable?: (
    actual: ExtensionValueType,
    expected: ExtensionValueType,
    assign: (actual: ValueType, expected: ValueType) => boolean,
  ) => boolean | undefined;
  /** Resolve target-owned runtime members; null means the target owns the type but the member is absent. */
  readonly memberType?: (type: ExtensionValueType, property: string) => ValueType | null | undefined;
  /**
   * Declare whether a target-owned value has a total, hook-free text form.
   * `true` admits the value to f-strings and `str()`, `false` records an owned
   * rejection, and `undefined` leaves the type for another extension or Core.
   */
  readonly textForm?: (type: ValueType) => boolean | undefined;
  readonly inferIntrinsic?: (context: CompilerIntrinsicAnalysisContext) => ValueType | undefined;
}

export interface CompilerIntrinsicAnalysisContext {
  readonly intrinsic: Extract<ValueType, { kind: "intrinsic" }>;
  readonly argumentAt: (index: number) => Expression | null;
  readonly callSpan: Span;
  readonly arity: (minimum?: number, maximum?: number) => void;
  readonly inferAt: (index: number, expected?: ValueType) => ValueType;
  readonly callbackAt: (index: number, parameters: readonly ValueType[], result: ValueType) => ValueType;
  readonly runtimeTypeAt: (index: number) => ValueType;
  readonly typeError: (message: string, span: Span) => void;
  readonly isAssignable: (actual: ValueType, expected: ValueType) => boolean;
  readonly expandAliases: (type: ValueType) => ValueType;
  readonly jsonSerializable: (type: ValueType) => boolean | null;
  readonly isHttpFormBody: (type: ValueType) => boolean;
  readonly declaredFieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null;
  readonly formReadField: (name: string, type: ValueType, span: Span) => FormReadField | null;
  readonly recordFormRead: (sourceSpan: Span, fields: readonly FormReadField[]) => void;
}

export interface CompilerModuleExtension {
  readonly apiVersion?: string;
  readonly interfaces: ReadonlyMap<string, ModuleInterface>;
  readonly sources: ReadonlyMap<string, string>;
  /**
   * Runtime-module dependencies owned by the same extension module source.
   * The CLI materializes this graph transitively for unbundled targets; a
   * dependency is an implementation detail and does not publish an interface.
   */
  readonly dependencies?: ReadonlyMap<string, readonly string[]>;
  readonly source?: (specifier: string, projectConfig: unknown) => string | null;
}

export interface CompilerEditorCompletion {
  readonly label: string;
  readonly kind: number;
  readonly detail?: string;
}

export interface CompilerProjectEditorCompletion {
  readonly label: string;
  readonly detail: string;
  readonly kind: SemanticSymbol["kind"];
  readonly documentation?: string;
  readonly presentationKind?: SemanticSymbol["presentationKind"];
}

export interface CompilerProjectEditorCompletionContext {
  readonly source: string;
  readonly offset: number;
  readonly visibleSymbols: readonly CompilerProjectEditorCompletion[];
  readonly membersAt: (offset: number) => readonly CompilerProjectEditorCompletion[];
}

export interface CompilerProjectEditorCompletionResult {
  readonly context: string;
  readonly completions: readonly CompilerProjectEditorCompletion[];
}

export interface CompilerProjectEditorRenameContext {
  readonly name: string;
  readonly kind: SemanticSymbol["kind"];
  readonly container: string | null;
  readonly containerKind: SemanticSymbol["kind"] | null;
}

export interface CompilerProjectEditorExtension {
  readonly complete?: (context: CompilerProjectEditorCompletionContext) => CompilerProjectEditorCompletionResult | undefined;
  readonly protectRename?: (context: CompilerProjectEditorRenameContext) => string | undefined;
}

export interface CompilerEditorExtension {
  readonly keywordDocumentation?: Readonly<Record<string, string>>;
  readonly typeDocumentation?: Readonly<Record<string, string>>;
  readonly completions?: readonly CompilerEditorCompletion[];
  readonly project?: CompilerProjectEditorExtension;
}

export interface CompilerFormattingExtension {
  /** Preserve one target-owned angle-bracket embedding while formatting its host line. */
  readonly angleBracketEmbedding?: {
    readonly voidElements?: ReadonlySet<string>;
  };
}

export interface CompilerDependencyContext {
  readonly visitExpression: (expression: Expression) => void;
  readonly visitStatement: (statement: Statement) => void;
  readonly visitBlock: (body: readonly Statement[]) => void;
}

export interface CompilerInterfaceContext {
  readonly exports: Map<string, ValueType>;
  readonly reactiveExports: Map<string, "state">;
  readonly extensionExports: Map<string, unknown>;
  readonly resolve: (reference: TypeReference | null) => ValueType;
  readonly inferPublicExpression: (expression: Expression) => ValueType;
  readonly bindingType: (name: string, spanStart: number) => ValueType | null;
  readonly unresolvedInferredResult: ValueType;
}

export interface CompilerInspectionExtension {
  readonly visitDependencyExpression?: (expression: Expression, context: CompilerDependencyContext) => boolean;
  readonly visitDependencyStatement?: (statement: Statement, context: CompilerDependencyContext) => boolean;
  readonly contributeInterface?: (statement: Statement, context: CompilerInterfaceContext) => boolean;
  /**
   * Whole-program annotations for exported names, merged into the module
   * interface's extension exports under this extension's id. Unlike
   * contributeInterface, this hook also reaches exports the core interface
   * builder owns (functions, consts), so an extension can attach metadata —
   * such as purity markers — without taking over their typing.
   */
  readonly exportAnnotations?: (program: Program) => ReadonlyMap<string, unknown>;
  readonly interfaceExportIdentity?: (name: string, value: unknown) => string;
  readonly inferPublicExpression?: (expression: Expression) => ValueType | undefined;
  readonly resources?: (program: Program) => readonly CompilerResourceDependency[];
  readonly moduleData?: (program: Program, path: string) => unknown;
}

export interface CompilerResourceDependency {
  readonly source: string;
  readonly kind: string;
}

export interface CompilerParserFactory {
  readonly create: (tokens: readonly Token[], lexicalExtensions: readonly CompilerLexicalExtension[]) => Parser;
}

export interface CompilerAnalyzerFactory {
  readonly create: (context: AnalysisContext, extensions: readonly CompilerAnalysisExtension[]) => Analyzer;
}

export interface ModuleTest {
  readonly name: string;
  readonly title: string;
}

export interface ModuleInterface {
  readonly exports: ReadonlyMap<string, ValueType>;
  /** Pure exports retired from source imports and exposed through one permanent namespace. */
  readonly permanentNamespace?: { readonly name: string; readonly members: ReadonlySet<string> };
  readonly mutableExports: ReadonlySet<string>;
  readonly reactiveExports: ReadonlyMap<string, "state">;
  /** Named re-exports (`export {name} from "source"`), keyed by the exported alias. */
  readonly reExports: ReadonlyMap<string, { readonly source: string; readonly imported: string }>;
  /**
   * Exports whose emitted binding is hoisted and initialized when the module is
   * linked rather than when its body runs — function declarations only. A
   * cycle member may read one of these before the defining module evaluates;
   * every other export shape is in its temporal dead zone until then (D31
   * item 23).
   */
  readonly hoistedExports?: ReadonlySet<string>;
  readonly namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  readonly namedTypeReadonlyFields?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly namedTypeIdentities: ReadonlyMap<string, string>;
  readonly typeAliases: ReadonlyMap<string, ValueType>;
  readonly enums: ReadonlyMap<string, EnumInfo>;
  readonly classes: ReadonlyMap<string, ClassInfo>;
  /**
   * D39 item 53: the module's `test "name":` declarations. `name` is the
   * emitted function the runner calls; `title` is the author's name for the
   * test, which the reporter quotes verbatim.
   */
  readonly tests: readonly ModuleTest[];
  readonly extensionExports: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  readonly extensionData: ReadonlyMap<string, unknown>;
}

export interface CompilerExtension {
  readonly id: string;
  readonly contract?: VelarExtensionContract;
  readonly capabilities?: readonly string[];
  readonly lexical?: CompilerLexicalExtension;
  readonly analysis?: CompilerAnalysisExtension;
  readonly modules?: CompilerModuleExtension;
  readonly editor?: CompilerEditorExtension;
  readonly formatting?: CompilerFormattingExtension;
  readonly parser?: CompilerParserFactory;
  readonly analyzer?: CompilerAnalyzerFactory;
  readonly semantic?: CompilerSemanticExtension;
  readonly inspection?: CompilerInspectionExtension;
  createEmitter?(
    hints: LoweringHints,
    forcedFunctionExports: ReadonlySet<string>,
    resourceContents: ReadonlyMap<string, string>,
    extensionImports: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
    options: CompilerEmitterOptions,
  ): CompilerEmitter;
}
