/**
 * The semantic index: what the editor is told about one module, and the four
 * questions a position asks of a built index.
 *
 * D115 §三 / D114 R1f: the walk and its vocabulary moved into `semantic/` —
 * `symbols.ts` (the shapes), `declarations.ts` (what a declaration publishes),
 * `references.ts` (what a read records), `documentation.ts` (syntax tokens and
 * doc comments), `indexer.ts` (the walk) and `queries.ts` (reading an index
 * back). Every name this module published is still published here, so an
 * existing `from "./semantic.ts"` import is unchanged.
 */
import { type Program } from "./ast.ts";
import { type SourceText } from "./source.ts";
import { type Token } from "./token.ts";
import { type ValueType } from "./types.ts";
import { SemanticIndexBuilder } from "./semantic/indexer.ts";
import { type CompilerSemanticExtension, type SemanticIndex } from "./semantic/symbols.ts";

export { semanticBindingKey } from "./semantic/symbols.ts";
export type {
  CompilerSemanticExtension,
  SemanticDeclareOptions,
  SemanticExpression,
  SemanticExtensionContext,
  SemanticFunctionLike,
  SemanticImport,
  SemanticIndex,
  SemanticMember,
  SemanticMemberReference,
  SemanticModuleReference,
  SemanticReference,
  SemanticScope,
  SemanticSymbol,
  SemanticSymbolKind,
  SemanticSyntaxDocumentation,
  SemanticSyntaxToken,
  SemanticSyntaxTokenKind,
} from "./semantic/symbols.ts";
export {
  semanticImportAt,
  semanticModuleReferenceAt,
  semanticSymbolAt,
  semanticVisibleSymbolsAt,
} from "./semantic/queries.ts";

export function buildSemanticIndex(
  program: Program,
  source: SourceText,
  bindingTypes: ReadonlyMap<string, ValueType> = new Map(),
  bindingMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  expressionTypes: ReadonlyMap<string, ValueType> = new Map(),
  expressionMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  expressionOwners: ReadonlyMap<string, ValueType> = new Map(),
  objectPropertyOwners: ReadonlyMap<string, ValueType> = new Map(),
  bindingEntryOwners: ReadonlyMap<string, ValueType> = new Map(),
  jsxAttributeOwners: ReadonlyMap<string, ValueType> = new Map(),
  expressionContexts: ReadonlyMap<string, ValueType> = new Map(),
  expressionContextMembers: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  semanticExtensions: readonly CompilerSemanticExtension[] = [],
  lexicalTokens: readonly Token[] = [],
): SemanticIndex {
  return new SemanticIndexBuilder(
    program,
    source,
    bindingTypes,
    bindingMembers,
    expressionTypes,
    expressionMembers,
    expressionOwners,
    objectPropertyOwners,
    bindingEntryOwners,
    jsxAttributeOwners,
    expressionContexts,
    expressionContextMembers,
    semanticExtensions,
    lexicalTokens,
  ).build();
}
