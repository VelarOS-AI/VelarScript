/**
 * Reading a built index back: the symbol at a position, the import at one, the
 * module reference at one, and every symbol visible from one.
 *
 * D115 §三 / D114 R1f: the query half of `semantic.ts`. It answers from a
 * finished index and never builds one.
 */
import { type Span } from "../source.ts";
import {
  type SemanticImport,
  type SemanticIndex,
  type SemanticModuleReference,
  type SemanticScope,
  type SemanticSymbol,
  type SemanticSymbolKind,
} from "./symbols.ts";

export function semanticVisibleSymbolsAt(index: SemanticIndex, offset: number): readonly SemanticSymbol[] {
  const scopesById = new Map(index.scopes.map((scope) => [scope.id, scope]));
  const depths = new Map<number, number>();
  const depthOf = (scope: SemanticScope): number => {
    const cached = depths.get(scope.id);
    if (cached !== undefined) return cached;
    const parent = scope.parentId === null ? null : scopesById.get(scope.parentId) ?? null;
    const depth = parent ? depthOf(parent) + 1 : 0;
    depths.set(scope.id, depth);
    return depth;
  };
  let active = scopesById.get(0);
  let activeDepth = active ? depthOf(active) : -1;
  for (const scope of index.scopes) {
    if (offset < scope.span.start || offset > scope.span.end) continue;
    const depth = depthOf(scope);
    if (depth > activeDepth) {
      active = scope;
      activeDepth = depth;
    }
  }
  if (!active) return [];

  const activeScopeIds: number[] = [];
  for (let scope: SemanticScope | undefined = active; scope;) {
    activeScopeIds.push(scope.id);
    scope = scope.parentId === null ? undefined : scopesById.get(scope.parentId);
  }

  const lexicalKinds = new Set<SemanticSymbolKind>([
    "import", "type", "enum", "class", "function", "variable", "parameter", "catch",
  ]);
  const rootHoistedKinds = new Set<SemanticSymbolKind>(["import", "type", "enum", "class", "function"]);
  const names = new Set<string>();
  const output: SemanticSymbol[] = [];
  const activeSet = new Set(activeScopeIds);
  const symbolsByScope = new Map<number, SemanticSymbol[]>();
  for (const symbol of index.symbols) {
    if (!activeSet.has(symbol.scopeId)) continue;
    const bucket = symbolsByScope.get(symbol.scopeId) ?? [];
    bucket.push(symbol);
    symbolsByScope.set(symbol.scopeId, bucket);
  }
  for (const scopeId of activeScopeIds) {
    for (const symbol of symbolsByScope.get(scopeId) ?? []) {
      const extensionKind = symbol.kind.startsWith("extension:");
      if ((!lexicalKinds.has(symbol.kind) && !extensionKind) || names.has(symbol.name)) continue;
      const hoisted = rootHoistedKinds.has(symbol.kind)
        || symbol.kind.startsWith("extension:function:")
        || symbol.kind.startsWith("extension:class:");
      if (symbol.selectionSpan.start > offset && !(scopeId === 0 && hoisted)) continue;
      names.add(symbol.name);
      output.push(symbol);
    }
  }
  return output;
}

export function semanticSymbolAt(index: SemanticIndex, offset: number): SemanticSymbol | null {
  const declaration = index.symbols.find((symbol) => contains(symbol.selectionSpan, offset));
  if (declaration) return declaration;
  const reference = index.references.find((item) => contains(item.span, offset));
  return reference?.symbolId ? index.symbols.find((symbol) => symbol.id === reference.symbolId) ?? null : null;
}

export function semanticImportAt(index: SemanticIndex, offset: number): SemanticImport | null {
  return index.imports.find((item) => contains(item.importedSpan, offset) || contains(item.localSpan, offset)) ?? null;
}

export function semanticModuleReferenceAt(index: SemanticIndex, offset: number): SemanticModuleReference | null {
  return index.moduleReferences.find((item) => contains(item.span, offset)) ?? null;
}

function contains(span: Span, offset: number): boolean {
  return offset >= span.start && offset < span.end;
}
