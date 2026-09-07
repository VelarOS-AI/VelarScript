import {
  isSourceIdentifierPart,
  isSourceIdentifierStart,
  semanticSymbolAt,
  type SemanticExpression,
  type SemanticSymbol,
} from "@velarscript/compiler";
import type { ProjectModule, ProjectResult } from "../project.ts";
import { standardImportDocumentation } from "../standard-api-documentation.ts";
import { contains, importForSymbol, moduleAt, wordSpanAt } from "./locations.ts";
import { accessibleMemberTargetAt, exportedTarget } from "./targets.ts";

export function projectSymbolAt(project: ProjectResult, path: string, offset: number): SemanticSymbol | null {
  const module = moduleAt(project, path);
  if (!module) return null;
  const enumMember = enumMemberAt(project, module, offset);
  if (enumMember) return enumMember;
  const symbol = semanticSymbolAt(module.result.semanticIndex, offset);
  if (!symbol) return null;
  if (symbol.kind !== "import") return symbol;
  const imported = importForSymbol(module.result.semanticIndex, symbol.id);
  if (!imported) return symbol;
  const exported = exportedTarget(project, module, imported)?.symbol;
  if (exported) return exported;
  const documentation = standardImportDocumentation(imported, project.compilerExtensions);
  return documentation ? { ...symbol, documentation } : symbol;
}

export function projectExpressionAt(project: ProjectResult, path: string, offset: number): SemanticExpression | null {
  const module = moduleAt(project, path);
  if (!module) return null;
  return module.result.semanticIndex.expressions
    .filter((expression) => expression.selectionSpan && contains(expression.selectionSpan, offset))
    .sort((left, right) => (left.selectionSpan!.end - left.selectionSpan!.start)
      - (right.selectionSpan!.end - right.selectionSpan!.start))[0] ?? null;
}

/** True when the analyzer consumed the word as a value but it is not a user or imported binding. */
export function projectUnresolvedValueReferenceAt(project: ProjectResult, path: string, offset: number): boolean {
  const module = moduleAt(project, path);
  const reference = module?.result.semanticIndex.references.find((candidate) => contains(candidate.span, offset));
  return reference?.symbolId === null;
}

export function projectMemberSymbolAt(project: ProjectResult, path: string, offset: number): SemanticSymbol | null {
  const module = moduleAt(project, path);
  return module ? accessibleMemberTargetAt(project, module, offset)?.symbol ?? null : null;
}

export function enumMemberAt(project: ProjectResult, module: ProjectModule, offset: number): SemanticSymbol | null {
  const source = module.result.source.text;
  const property = wordSpanAt(source, offset);
  if (!property) return null;
  let dot = property.start - 1;
  while (dot >= 0 && /\s/u.test(source[dot]!)) dot -= 1;
  if (source[dot] !== ".") return null;
  let ownerEnd = dot;
  while (ownerEnd > 0 && /\s/u.test(source[ownerEnd - 1]!)) ownerEnd -= 1;
  let ownerStart = ownerEnd;
  while (ownerStart > 0 && isSourceIdentifierPart(source[ownerStart - 1]!)) ownerStart -= 1;
  if (ownerStart === ownerEnd || !isSourceIdentifierStart(source[ownerStart]!)) return null;
  const owner = projectSymbolAt(project, module.inputPath, ownerStart);
  if (owner?.kind !== "enum") return null;
  const target = moduleAt(project, owner.path);
  if (!target) return null;
  const name = source.slice(property.start, property.end);
  return target.result.semanticIndex.symbols.find((symbol) => symbol.kind === "enum-member" && symbol.container === owner.name && symbol.name === name) ?? null;
}
