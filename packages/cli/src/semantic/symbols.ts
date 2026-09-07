import type { ProjectResult } from "../project.ts";
import { byCodeUnit } from "../stable-order.ts";
import { moduleAt } from "./locations.ts";
import type { ProjectDocumentSymbol, ProjectWorkspaceSymbol } from "./types.ts";

export function projectDocumentSymbols(project: ProjectResult, path: string): readonly ProjectDocumentSymbol[] {
  const module = moduleAt(project, path);
  if (!module) return [];
  return module.result.semanticIndex.symbols.map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    path: symbol.path,
    span: symbol.span,
    selectionSpan: symbol.selectionSpan,
    type: symbol.type,
    ...(symbol.presentationKind ? { presentationKind: symbol.presentationKind } : {}),
  }));
}

export function projectWorkspaceSymbols(
  project: ProjectResult,
  query: string,
  maximum = 10_000,
): readonly ProjectWorkspaceSymbol[] {
  const normalized = query.toLowerCase();
  const symbols: Array<ProjectWorkspaceSymbol & { readonly score: number }> = [];
  for (const module of project.modules) {
    for (const symbol of module.result.semanticIndex.symbols) {
      if (symbol.kind === "import" || symbol.kind === "parameter" || symbol.kind === "catch") continue;
      if (symbol.scopeId !== 0 && !symbol.container) continue;
      const name = symbol.name.toLowerCase();
      const match = normalized === "" ? 0 : name.indexOf(normalized);
      if (match < 0) continue;
      symbols.push({
        name: symbol.name,
        kind: symbol.kind,
        path: symbol.path,
        span: symbol.span,
        selectionSpan: symbol.selectionSpan,
        type: symbol.type,
        ...(symbol.container ? { containerName: symbol.container } : {}),
        ...(symbol.presentationKind ? { presentationKind: symbol.presentationKind } : {}),
        score: match === 0 ? name.length === normalized.length ? 0 : 1 : 2,
      });
      if (symbols.length >= maximum) break;
    }
    if (symbols.length >= maximum) break;
  }
  return symbols
    .sort((left, right) => left.score - right.score || byName(left.name, right.name)
      || byCodeUnit(left.path, right.path) || left.selectionSpan.start - right.selectionSpan.start)
    .map(({ score: _score, ...symbol }) => symbol);
}

/**
 * The order a person reads this list in: `apple` before `Banana`, the way the
 * collation this used to call gave in every Latin locale. `toLowerCase` is the
 * Unicode default case mapping rather than `toLocaleLowerCase`'s tailored one,
 * so unlike `localeCompare` it does not follow the machine's `LC_ALL`; the code
 * unit order breaks the remaining ties so two machines still agree.
 */
function byName(left: string, right: string): number {
  return byCodeUnit(left.toLowerCase(), right.toLowerCase()) || byCodeUnit(left, right);
}
