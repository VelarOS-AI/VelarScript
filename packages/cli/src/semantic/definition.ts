import { dirname, extname, resolve } from "node:path";
import { semanticModuleReferenceAt } from "@velarscript/compiler";
import { projectImportKey, type ProjectResult } from "../project.ts";
import { importForSymbol, locationOf, moduleAt } from "./locations.ts";
import { enumMemberAt } from "./symbol-lookup.ts";
import { accessibleMemberTargetAt, exportedTarget, targetAt } from "./targets.ts";
import type { ProjectLocation } from "./types.ts";

export function projectDefinitionAt(project: ProjectResult, path: string, offset: number): ProjectLocation | null {
  const module = moduleAt(project, path);
  if (!module) return null;
  const enumMember = enumMemberAt(project, module, offset);
  if (enumMember) return locationOf(enumMember);
  const member = accessibleMemberTargetAt(project, module, offset);
  if (member) return locationOf(member.symbol);
  const moduleReference = semanticModuleReferenceAt(module.result.semanticIndex, offset);
  if (moduleReference) {
    const targetPath = moduleReference.source.startsWith(".") && extname(moduleReference.source) === ".vel"
      ? resolve(dirname(module.inputPath), moduleReference.source)
      : project.velarImports.get(projectImportKey(module.inputPath, moduleReference.source));
    const target = targetPath ? moduleAt(project, targetPath) : null;
    if (target) return { path: target.inputPath, span: { start: 0, end: 0 } };
  }
  const target = targetAt(project, module, offset, "definition");
  if (!target) return null;
  if (target.kind === "local" && target.symbol.kind === "import") {
    const imported = importForSymbol(module.result.semanticIndex, target.symbol.id);
    const exported = imported ? exportedTarget(project, module, imported) : null;
    if (exported) return locationOf(exported.symbol);
  }
  return locationOf(target.symbol);
}
