import { dirname, extname, resolve } from "node:path";
import {
  semanticImportAt,
  semanticSymbolAt,
  type SemanticExpression,
  type SemanticImport,
  type SemanticMemberReference,
  type SemanticSymbol,
} from "@velarscript/compiler";
import { projectImportKey, type ProjectModule, type ProjectResult } from "../project.ts";
import { contains, importForSymbol, locationOf, moduleAt, referencesFor, scopeHasName } from "./locations.ts";
import type { ExportTarget, MemberTarget, ProjectLocation, ProjectTarget } from "./types.ts";

export function targetAt(
  project: ProjectResult,
  module: ProjectModule,
  offset: number,
  purpose: "definition" | "references" | "rename",
): ProjectTarget | null {
  const index = module.result.semanticIndex;
  const imported = semanticImportAt(index, offset);
  if (imported && !imported.namespace) {
    const onImported = contains(imported.importedSpan, offset);
    const aliased = imported.local !== imported.imported;
    if (onImported && (!aliased || !contains(imported.localSpan, offset))) {
      return exportedTarget(project, module, imported);
    }
    const local = index.symbols.find((symbol) => symbol.id === imported.localSymbolId);
    if (local) {
      if (!aliased) return exportedTarget(project, module, imported) ?? { kind: "local", module, symbol: local };
      return { kind: "local", module, symbol: local };
    }
  }
  const symbol = semanticSymbolAt(index, offset);
  if (!symbol) return null;
  if (symbol.kind === "import") {
    const specifier = importForSymbol(index, symbol.id);
    if (specifier && specifier.local === specifier.imported) {
      return exportedTarget(project, module, specifier) ?? { kind: "local", module, symbol };
    }
  }
  return symbol.exported ? { kind: "export", module, symbol } : { kind: "local", module, symbol };
}

function memberTargetAt(project: ProjectResult, module: ProjectModule, offset: number): MemberTarget | null {
  const reference = module.result.semanticIndex.memberReferences.find((item) => contains(item.span, offset));
  if (reference) return memberTargetForReference(project, module, reference);
  const declared = semanticSymbolAt(module.result.semanticIndex, offset);
  if (declared && (declared.kind === "field" || declared.kind === "method" || declared.kind === "parameter") && declared.container) {
    return { module, symbol: declared };
  }
  const expression = module.result.semanticIndex.expressions.find((item) => item.selectionSpan && contains(item.selectionSpan, offset));
  return expression ? memberTargetForExpression(project, module, expression) : null;
}

export function accessibleMemberTargetAt(project: ProjectResult, module: ProjectModule, offset: number): MemberTarget | null {
  const target = memberTargetAt(project, module, offset);
  if (!target?.symbol.private) return target;
  if (target.module.inputPath !== module.inputPath || !target.symbol.container) return null;
  const owner = module.result.semanticIndex.symbols.find((symbol) => symbol.kind === "class"
    && symbol.name === target.symbol.container);
  return owner && contains(owner.span, offset) ? target : null;
}

function memberTargetForExpression(project: ProjectResult, module: ProjectModule, expression: SemanticExpression): MemberTarget | null {
  if (!expression.memberName || !expression.ownerType || !expression.ownerKind) return null;
  return memberTargetForOwner(project, module, expression.memberName, expression.ownerType, expression.ownerKind, expression.ownerIdentity, expression.ownerSymbolKind);
}

export function memberTargetForReference(project: ProjectResult, module: ProjectModule, reference: SemanticMemberReference): MemberTarget | null {
  return memberTargetForOwner(project, module, reference.name, reference.ownerType, reference.ownerKind, reference.ownerIdentity, reference.ownerSymbolKind);
}

function memberTargetForOwner(
  project: ProjectResult,
  module: ProjectModule,
  memberName: string,
  ownerType: string,
  ownerKind: SemanticExpression["ownerKind"],
  ownerIdentity?: string,
  ownerSymbolKind?: SemanticSymbol["kind"],
): MemberTarget | null {
  if (ownerKind !== "named" && ownerKind !== "class" && ownerKind !== "typeObject"
    && ownerKind !== "classConstructor" && ownerKind !== "extension") return null;
  if (ownerKind === "extension" && !ownerSymbolKind) return null;
  const owner = ownerTarget(project, module, ownerType, ownerKind, ownerIdentity, new Set(), ownerSymbolKind);
  return owner ? findDeclaredMember(project, owner, memberName, ownerKind === "classConstructor", new Set()) : null;
}

export function ownerTarget(
  project: ProjectResult,
  module: ProjectModule,
  name: string,
  ownerKind: SemanticExpression["ownerKind"],
  ownerIdentity?: string,
  visited: Set<string> = new Set(),
  ownerSymbolKind?: SemanticSymbol["kind"],
): MemberTarget | null {
  const expected = ownerKind === "class" || ownerKind === "classConstructor" ? "class"
    : ownerKind === "extension" && ownerSymbolKind ? ownerSymbolKind : "type";
  const key = `${module.inputPath}:${expected}:${name}`;
  if (visited.has(key)) return null;
  visited.add(key);
  const identity = ownerIdentity ?? (expected === "class" ? name : null);
  if (identity && (expected === "class" || expected === "type")) {
    const identified = declaredOwnerByIdentity(project, identity, expected);
    if (identified) return identified;
  }
  const symbol = module.result.semanticIndex.symbols.find((item) => item.name === name
    && (item.kind === expected || item.kind === "import"));
  if (!symbol) return null;
  if (symbol.kind === "import") {
    const imported = importForSymbol(module.result.semanticIndex, symbol.id);
    const exported = imported ? exportedTarget(project, module, imported) : null;
    return exported && exported.symbol.kind === expected
      ? ownerTarget(project, exported.module, exported.symbol.name, ownerKind, ownerIdentity, visited, ownerSymbolKind)
      : null;
  }
  if (symbol.kind === "type" && symbol.typeTarget && symbol.typeTarget !== symbol.name) {
    return ownerTarget(project, module, symbol.typeTarget, "named", undefined, visited) ?? { module, symbol };
  }
  return { module, symbol };
}

function declaredOwnerByIdentity(project: ProjectResult, identity: string, kind: "class" | "type"): MemberTarget | null {
  for (const candidate of project.modules) {
    const declarations = kind === "class"
      ? [...candidate.result.moduleInterface.classes].map(([name, info]) => [name, info.identity] as const)
      : [...candidate.result.moduleInterface.namedTypeIdentities];
    for (const [name, declarationIdentity] of declarations) {
      if (declarationIdentity !== identity) continue;
      const symbol = candidate.result.semanticIndex.symbols.find((item) => item.kind === kind && item.name === name);
      if (symbol) return { module: candidate, symbol };
    }
  }
  return null;
}

export function findDeclaredMember(
  project: ProjectResult,
  owner: MemberTarget,
  name: string,
  staticMember: boolean,
  visited: Set<string>,
  allowPrivate = true,
): MemberTarget | null {
  const key = `${owner.symbol.id}:${name}:${staticMember}`;
  if (visited.has(key)) return null;
  visited.add(key);
  const direct = owner.module.result.semanticIndex.symbols.find((symbol) => symbol.container === owner.symbol.name
    && symbol.name === name
    && (allowPrivate || !symbol.private)
    && (owner.symbol.kind.startsWith("extension:function:") || owner.symbol.kind.startsWith("extension:class:")
      ? symbol.kind === "parameter"
      : (symbol.kind === "field" || symbol.kind === "method") && Boolean(symbol.static) === staticMember));
  if (direct) return { module: owner.module, symbol: direct };
  if (owner.symbol.kind !== "class") return null;
  const base = owner.module.result.moduleInterface.classes.get(owner.symbol.name)?.base;
  if (!base) return null;
  const baseOwner = ownerTarget(project, owner.module, base, "class");
  return baseOwner ? findDeclaredMember(project, baseOwner, name, staticMember, visited, false) : null;
}

export function exportedTarget(
  project: ProjectResult,
  importer: ProjectModule,
  imported: SemanticImport,
  visited: Set<string> = new Set(),
): ExportTarget | null {
  const targetModule = importedModule(project, importer, imported);
  if (!targetModule) return null;
  const symbol = targetModule.result.semanticIndex.symbols.find((item) => item.exported && item.name === imported.imported);
  if (!symbol) return null;
  if (symbol.kind === "import") {
    // An exported import symbol is a named re-export; follow the chain to the
    // module that actually declares the value.
    const forwarded = targetModule.result.semanticIndex.imports.find((item) => item.localSymbolId === symbol.id);
    const key = `${targetModule.inputPath}\0${symbol.id}`;
    if (forwarded && !visited.has(key)) {
      visited.add(key);
      const origin = exportedTarget(project, targetModule, forwarded, visited);
      if (origin) return origin;
    }
  }
  return { kind: "export", module: targetModule, symbol };
}

function importedModule(project: ProjectResult, importer: ProjectModule, imported: SemanticImport): ProjectModule | null {
  const target = imported.source.startsWith(".") && extname(imported.source) === ".vel"
    ? resolve(dirname(importer.inputPath), imported.source)
    : project.velarImports.get(projectImportKey(importer.inputPath, imported.source));
  return target ? moduleAt(project, target) : null;
}

export function exportedLocations(project: ProjectResult, target: ExportTarget, includeDeclaration: boolean): ProjectLocation[] {
  const locations = includeDeclaration ? [locationOf(target.symbol)] : [];
  locations.push(...referencesFor(target.module, target.symbol));
  for (const module of project.modules) {
    for (const imported of module.result.semanticIndex.imports) {
      const importedTarget = exportedTarget(project, module, imported);
      if (!importedTarget || importedTarget.symbol.id !== target.symbol.id) continue;
      locations.push({ path: module.inputPath, span: imported.importedSpan });
      if (imported.local === imported.imported) {
        const local = module.result.semanticIndex.symbols.find((symbol) => symbol.id === imported.localSymbolId);
        if (local) locations.push(...referencesFor(module, local));
      }
    }
  }
  return locations;
}

export function renameCollides(project: ProjectResult, target: ProjectTarget, newName: string): boolean {
  if (scopeHasName(target.module.result.semanticIndex, target.symbol, newName)) return true;
  if (target.kind !== "export") return false;
  for (const module of project.modules) {
    for (const imported of module.result.semanticIndex.imports) {
      if (imported.local !== imported.imported) continue;
      const importedTarget = exportedTarget(project, module, imported);
      if (!importedTarget || importedTarget.symbol.id !== target.symbol.id) continue;
      const local = module.result.semanticIndex.symbols.find((symbol) => symbol.id === imported.localSymbolId);
      if (local && scopeHasName(module.result.semanticIndex, local, newName)) return true;
    }
  }
  return false;
}
