import type { AnalysisContext, ClassInfo, FormReadField, LoweringHints } from "./analyzer.ts";
import type { Analyzer } from "./analyzer.ts";
import type { Expression, Program, Statement, TypeReference } from "./ast.ts";
import type { Diagnostic } from "./diagnostic.ts";
import type { Parser } from "./parser.ts";
import type { SourceText, Span } from "./source.ts";
import type { CompilerSemanticExtension, SemanticSymbol } from "./semantic.ts";
import type { Token } from "./token.ts";
import type { EnumInfo, ValueType } from "./types.ts";

export { expressionContainsDirectAwait } from "./ast.ts";
export { JavaScriptEmitter } from "./emitter.ts";
export { VELAR_ERROR_NORMALIZATION_RUNTIME } from "./error-runtime.ts";
export { Analyzer } from "./analyzer.ts";
export type {
  Expression,
  Program,
  Statement,
} from "./ast.ts";
export type { AnalysisContext, ClassField, ClassInfo, FormReadField, LoweringHints } from "./analyzer.ts";
export { Parser } from "./parser.ts";
export { spanIdentity } from "./source.ts";
export type { ParseResult } from "./parser.ts";
export type { CompilerSemanticExtension, SemanticDeclareOptions, SemanticExtensionContext, SemanticFunctionLike } from "./semantic.ts";
export type { Token, TokenKind } from "./token.ts";
export {
  anyType,
  boolType,
  describeType,
  isInvalidType,
  isAssignable,
  nullType,
  nonOptional,
  numberType,
  optionalOf,
  stringType,
  unknownType,
} from "./types.ts";
export type { ValueType } from "./types.ts";

export interface CompilerEmitter {
  emit(program: Program): string;
  sourceMap(source: SourceText): string;
  css?(): string;
  styleSegments?(): CompilerStyleSegments;
}

export interface CompilerStyleSegments {
  readonly before: string;
  readonly controlled: string;
  readonly after: string;
}

export interface CompilerLexicalExtension {
  readonly keywords?: Readonly<Record<string, string>>;
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

export interface CompilerDependencyContext {
  readonly visitExpression: (expression: Expression) => void;
  readonly visitStatement: (statement: Statement) => void;
  readonly visitBlock: (body: readonly Statement[]) => void;
}

export interface CompilerInterfaceContext {
  readonly exports: Map<string, ValueType>;
  readonly reactiveExports: Map<string, "state" | "computed">;
  readonly extensionExports: Map<string, unknown>;
  readonly resolve: (reference: TypeReference | null) => ValueType;
  readonly inferPublicExpression: (expression: Expression) => ValueType;
  readonly bindingType: (name: string, spanStart: number) => ValueType | null;
}

export interface CompilerInspectionExtension {
  readonly visitDependencyExpression?: (expression: Expression, context: CompilerDependencyContext) => boolean;
  readonly visitDependencyStatement?: (statement: Statement, context: CompilerDependencyContext) => boolean;
  readonly contributeInterface?: (statement: Statement, context: CompilerInterfaceContext) => boolean;
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

export interface ModuleInterface {
  readonly exports: ReadonlyMap<string, ValueType>;
  readonly mutableExports: ReadonlySet<string>;
  readonly reactiveExports: ReadonlyMap<string, "state" | "computed">;
  readonly namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>>;
  readonly namedTypeIdentities: ReadonlyMap<string, string>;
  readonly typeAliases: ReadonlyMap<string, ValueType>;
  readonly enums: ReadonlyMap<string, EnumInfo>;
  readonly classes: ReadonlyMap<string, ClassInfo>;
  readonly testFunctions: readonly string[];
  readonly extensionExports: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  readonly extensionData: ReadonlyMap<string, unknown>;
}

export interface CompilerExtension {
  readonly id: string;
  readonly capabilities?: readonly string[];
  readonly lexical?: CompilerLexicalExtension;
  readonly analysis?: CompilerAnalysisExtension;
  readonly modules?: CompilerModuleExtension;
  readonly editor?: CompilerEditorExtension;
  readonly parser?: CompilerParserFactory;
  readonly analyzer?: CompilerAnalyzerFactory;
  readonly semantic?: CompilerSemanticExtension;
  readonly inspection?: CompilerInspectionExtension;
  createEmitter?(
    hints: LoweringHints,
    forcedFunctionExports: ReadonlySet<string>,
    resourceContents: ReadonlyMap<string, string>,
    extensionImports: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
  ): CompilerEmitter;
}
