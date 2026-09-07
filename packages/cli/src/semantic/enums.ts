import { semanticSymbolAt, type SemanticSymbol } from "@velarscript/compiler";
import type { ProjectModule, ProjectResult } from "../project.ts";
import { escapeRegExp, locationOf, moduleAt, uniqueLocations } from "./locations.ts";
import { enumMemberAt } from "./symbol-lookup.ts";
import type { ProjectLocation } from "./types.ts";

export function enumMemberTargetAt(project: ProjectResult, module: ProjectModule, offset: number): SemanticSymbol | null {
  const qualified = enumMemberAt(project, module, offset);
  if (qualified) return qualified;
  const local = semanticSymbolAt(module.result.semanticIndex, offset);
  return local?.kind === "enum-member" ? local : null;
}

export function enumMemberLocations(
  project: ProjectResult,
  target: SemanticSymbol,
  includeDeclaration: boolean,
): readonly ProjectLocation[] {
  const locations: ProjectLocation[] = includeDeclaration ? [locationOf(target)] : [];
  const pattern = new RegExp(`\\b${escapeRegExp(target.name)}\\b`, "gu");
  for (const module of project.modules) {
    const source = module.result.source.text;
    pattern.lastIndex = 0;
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
      const member = enumMemberAt(project, module, match.index);
      if (member?.id === target.id && member.path === target.path) {
        locations.push({ path: module.inputPath, span: { start: match.index, end: match.index + target.name.length } });
      }
    }
  }
  return uniqueLocations(locations);
}

export function enumMemberRenameCollides(project: ProjectResult, target: SemanticSymbol, newName: string): boolean {
  const module = moduleAt(project, target.path);
  return module?.result.semanticIndex.symbols.some((symbol) => symbol.kind === "enum-member"
    && symbol.id !== target.id
    && symbol.container === target.container
    && symbol.name === newName) ?? false;
}
