/**
 * What the editor is told: the symbol, member, reference, import, scope and
 * syntax-token shapes a semantic index publishes, plus the extension protocol
 * a target uses to add its own.
 *
 * D115 §三 / D114 R1f: the vocabulary of `semantic.ts`. Nothing here decides
 * anything, so every other module of this directory may read it.
 */
import type { Expression, FunctionDeclaration, Statement, TypeReference } from "../ast.ts";
import { type Span } from "../source.ts";
import { keywordKinds } from "../token.ts";
import { type ValueType } from "../types.ts";

export type SemanticSymbolKind =
  | "import"
  | "type"
  | "enum"
  | "enum-member"
  | "class"
  | "function"
  | "variable"
  | "parameter"
  | "field"
  | "method"
  | "catch"
  | `extension:${"type" | "class" | "function" | "variable" | "parameter"}:${string}`;

export interface SemanticSymbol {
  readonly id: string;
  readonly name: string;
  readonly kind: SemanticSymbolKind;
  readonly path: string;
  readonly span: Span;
  readonly selectionSpan: Span;
  readonly scopeId: number;
  readonly exported: boolean;
  readonly mutable: boolean;
  readonly private: boolean;
  readonly type: string | null;
  /** Exact analyzed kind retained for editor features that must not infer identity from display text. */
  readonly typeKind?: ValueType["kind"];
  /** Compiler-owned nominal identity; absent for structural and primitive types. */
  readonly typeIdentity?: string;
  readonly documentation: string | null;
  /** Optional Core-owned business context carried only as compile-time metadata. */
  readonly context?: string;
  readonly members: readonly SemanticMember[];
  readonly callable?: true;
  readonly typeTarget?: string;
  readonly container?: string;
  readonly static?: boolean;
  readonly sourceTypeHint?: true;
  readonly presentationKind?: "type" | "class" | "function" | "variable" | "parameter";
}

export interface SemanticMember {
  readonly name: string;
  readonly kind: "field" | "method";
  readonly type: string;
}

export interface SemanticExpression {
  readonly span: Span;
  readonly type: string;
  readonly members: readonly SemanticMember[];
  readonly callable?: true;
  readonly memberName?: string;
  readonly selectionSpan?: Span;
  readonly ownerType?: string;
  readonly ownerKind?: ValueType["kind"];
  readonly ownerIdentity?: string;
  readonly ownerSymbolKind?: SemanticSymbolKind;
  readonly contextType?: string;
  readonly contextMembers?: readonly SemanticMember[];
}

export interface SemanticReference {
  readonly name: string;
  readonly path: string;
  readonly span: Span;
  readonly symbolId: string | null;
  readonly write: boolean;
  /** The source site directly invokes the referenced value, through a call expression or component instantiation. */
  readonly call?: true;
}

export interface SemanticMemberReference {
  readonly name: string;
  readonly path: string;
  readonly span: Span;
  readonly ownerType: string;
  readonly ownerKind: ValueType["kind"];
  readonly ownerIdentity?: string;
  readonly ownerSymbolKind?: SemanticSymbolKind;
  readonly syntax: "access" | "object-key" | "binding-key" | "extension-property";
  readonly shorthand: boolean;
}

export interface SemanticImport {
  readonly source: string;
  readonly imported: string;
  readonly importedSpan: Span;
  readonly local: string;
  readonly localSpan: Span;
  readonly localSymbolId: string;
  readonly namespace: boolean;
}

export interface SemanticModuleReference {
  readonly source: string;
  readonly span: Span;
  readonly dynamic: boolean;
}

export interface SemanticScope {
  readonly id: number;
  readonly parentId: number | null;
  readonly span: Span;
}

/**
 * Compiler-recognized source syntax that should participate in an editor's
 * semantic highlighting. Core's hard keywords come from the authoritative
 * lexer token stream; contextual extension forms arrive through the semantic
 * extension that successfully parsed them.
 */
export type SemanticSyntaxTokenKind = "keyword" | "decorator" | "function" | "parameter" | "property" | "type";

export interface SemanticSyntaxToken {
  readonly span: Span;
  readonly kind: SemanticSyntaxTokenKind;
}

/**
 * A compiler-owned source form that has editor documentation at this exact
 * location. The key is resolved against Core or the active compiler
 * extension's editor documentation; it need not equal the source text, which
 * lets a concrete extension spelling such as `on:click` share the `on:*`
 * contract.
 */
export interface SemanticSyntaxDocumentation {
  readonly span: Span;
  readonly key: string;
}

export interface SemanticIndex {
  readonly path: string;
  readonly symbols: readonly SemanticSymbol[];
  readonly references: readonly SemanticReference[];
  readonly memberReferences: readonly SemanticMemberReference[];
  readonly imports: readonly SemanticImport[];
  readonly moduleReferences: readonly SemanticModuleReference[];
  readonly scopes: readonly SemanticScope[];
  readonly expressions: readonly SemanticExpression[];
  readonly syntaxTokens: readonly SemanticSyntaxToken[];
  readonly syntaxDocumentation: readonly SemanticSyntaxDocumentation[];
}

export interface SemanticDeclareOptions {
  readonly exported?: boolean;
  readonly mutable?: boolean;
  readonly lexical?: boolean;
  readonly container?: string;
  readonly explicitType?: string;
  readonly typeTarget?: string;
  readonly static?: boolean;
  readonly documentationStart?: number;
  readonly private?: boolean;
  /** The declared runtime type is also a valid source annotation for editor hints. */
  readonly sourceTypeHint?: boolean;
  /** Optional editor presentation when an extension symbol has a richer role than its semantic category. */
  readonly presentationKind?: SemanticSymbol["presentationKind"];
}

export interface SemanticFunctionLike {
  readonly name: string;
  readonly parameters: FunctionDeclaration["parameters"];
  readonly returnType: FunctionDeclaration["returnType"];
  readonly body: FunctionDeclaration["body"];
  readonly span: Span;
}

export interface SemanticExtensionContext {
  readonly source: string;
  readonly declare: (owner: object, name: string, kind: SemanticSymbolKind, declarationSpan: Span, selectionSpan: Span, options?: SemanticDeclareOptions) => SemanticSymbol;
  readonly hasDeclaration: (owner: object) => boolean;
  readonly nameSpan: (span: Span, name: string, from?: number) => Span;
  readonly typeReferences: (type: TypeReference | null) => void;
  readonly reference: (name: string, span: Span, write?: boolean) => void;
  readonly callReference: (name: string, span: Span) => void;
  readonly recordMemberReference: (name: string, span: Span, owner: ValueType, syntax: SemanticMemberReference["syntax"], shorthand?: boolean) => void;
  readonly jsxAttributeOwner: (span: Span, name: string) => ValueType | undefined;
  readonly enterScope: (span: Span) => void;
  readonly exitScope: () => void;
  readonly visitExpression: (expression: Expression) => void;
  readonly visitStatement: (statement: Statement) => void;
  readonly visitBlock: (body: readonly Statement[], fallbackSpan: Span) => void;
  readonly visitFunction: (statement: SemanticFunctionLike) => void;
  readonly syntaxToken: (span: Span, kind: SemanticSyntaxTokenKind) => void;
  readonly documentSyntax: (span: Span, key: string) => void;
}

export interface CompilerSemanticExtension {
  readonly predeclare?: (statement: Statement, context: SemanticExtensionContext) => boolean;
  readonly visitExpression?: (expression: Expression, context: SemanticExtensionContext) => boolean;
  readonly visitStatement?: (statement: Statement, context: SemanticExtensionContext) => boolean;
}

export interface Scope extends SemanticScope {
  readonly bindings: Map<string, SemanticSymbol>;
}

export const MAX_SEMANTIC_MEMBERS = 10_000;
export const HARD_KEYWORD_TOKEN_KINDS = new Set(Object.values(keywordKinds));

export function semanticBindingKey(span: Span, name: string): string {
  return `${span.start}:${name}`;
}

/**
 * The optional facts a declaration carries beyond its name, kind and spans.
 * `boundedTypeParameters` is the declaration/type distinction D114 F2 settled:
 * a *declaration* hover shows the type-parameter list the author wrote, bounds
 * included, while every other display keeps `describeType`'s erased form.
 */
export interface DeclareOptions {
  readonly documentationStart?: number;
  readonly private?: boolean;
  readonly typeTarget?: string;
  readonly sourceTypeHint?: boolean;
  readonly presentationKind?: SemanticSymbol["presentationKind"];
  readonly boundedTypeParameters?: boolean;
}
