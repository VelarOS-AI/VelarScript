import { bindingNameRestriction, memberNameRestriction } from "@velarscript/compiler";
import type { ProjectResult } from "../project.ts";
import { enumMemberLocations, enumMemberRenameCollides, enumMemberTargetAt } from "./enums.ts";
import { localLocations, moduleAt, renameSelectionAt, renameable, uniqueLocations, wordSpanAt } from "./locations.ts";
import {
  extensionRenameProtection,
  memberOwnerKind,
  memberRenameCollides,
  memberRenameEdits,
  renameableMember,
} from "./members.ts";
import { accessibleMemberTargetAt, exportedLocations, renameCollides, targetAt } from "./targets.ts";
import type { ProjectRename, ProjectRenameFailure } from "./types.ts";

function bindingRenameRestrictionMessage(project: ProjectResult, name: string): string | null {
  const extensionReservedBindings = new Set(project.compilerExtensions.flatMap((extension) => [...extension.analysis?.reservedBindings ?? []]));
  const restriction = bindingNameRestriction(name, extensionReservedBindings);
  if (!restriction) return null;
  if (restriction === "invalid") return "The new name is not a valid VelarScript identifier";
  if (restriction === "keyword") return "The new name is reserved by VelarScript";
  if (restriction === "source") return `The source spelling '${name}' is unavailable in VelarScript`;
  if (restriction === "javascript") return `The new name '${name}' is reserved by JavaScript for lexical bindings`;
  if (restriction === "compiler") return "The new name uses a reserved compiler prefix '__velar'";
  if (restriction === "core") return `The new name '${name}' is a reserved Core binding`;
  return `The new name '${name}' is a reserved extension binding`;
}

function memberRenameRestrictionMessage(name: string, owner: "class" | "enum" | "data"): string | null {
  const restriction = memberNameRestriction(name, owner);
  if (!restriction) return null;
  if (restriction === "invalid") return "The new name is not a valid VelarScript identifier";
  if (restriction === "source") return `The source spelling '${name}' is unavailable in VelarScript`;
  if (restriction === "prototype") return "VelarScript does not expose prototype manipulation";
  if (restriction === "constructor") return "Class member 'constructor' is reserved for the constructor(...) declaration";
  return `Enum member '${name}' is reserved for runtime validation`;
}

export function projectPrepareRenameAt(project: ProjectResult, path: string, offset: number): ProjectRename | null {
  const module = moduleAt(project, path);
  if (!module) return null;
  const enumMember = enumMemberTargetAt(project, module, offset);
  if (enumMember) {
    const selection = wordSpanAt(module.result.source.text, offset) ?? enumMember.selectionSpan;
    return { edits: [{ path: module.inputPath, span: selection }], placeholder: enumMember.name };
  }
  const member = accessibleMemberTargetAt(project, module, offset);
  if (member) {
    if (extensionRenameProtection(project, member) || !renameableMember(member)) return null;
    const selection = wordSpanAt(module.result.source.text, offset) ?? member.symbol.selectionSpan;
    return { edits: [{ path: module.inputPath, span: selection }], placeholder: member.symbol.name };
  }
  const target = targetAt(project, module, offset, "rename");
  if (!target || !renameable(target.symbol)) return null;
  const selection = renameSelectionAt(module.result.semanticIndex, offset, target.symbol);
  return { edits: [{ path: module.inputPath, span: selection }], placeholder: target.symbol.name };
}

export function projectRenameAt(
  project: ProjectResult,
  path: string,
  offset: number,
  newName: string,
): ProjectRename | ProjectRenameFailure {
  const module = moduleAt(project, path);
  if (!module) return "No renameable VelarScript symbol at this position";
  const enumMember = enumMemberTargetAt(project, module, offset);
  if (enumMember) {
    const restriction = memberRenameRestrictionMessage(newName, "enum");
    if (restriction) return restriction;
    if (enumMember.name === newName) return { edits: [], placeholder: enumMember.name };
    if (enumMemberRenameCollides(project, enumMember, newName)) return "The new name collides with another declaration";
    return { edits: enumMemberLocations(project, enumMember, true), placeholder: enumMember.name };
  }
  const member = accessibleMemberTargetAt(project, module, offset);
  if (member) {
    const restriction = member.symbol.kind === "parameter"
      ? bindingRenameRestrictionMessage(project, newName)
      : memberRenameRestrictionMessage(newName, memberOwnerKind(member));
    if (restriction) return restriction;
    const protection = extensionRenameProtection(project, member);
    if (protection) return protection;
    if (!renameableMember(member)) return "No renameable VelarScript symbol at this position";
    if (member.symbol.name === newName) return { edits: [], placeholder: member.symbol.name };
    if (memberRenameCollides(project, member, newName)) return "The new name collides with another declaration";
    return { edits: memberRenameEdits(project, member, newName), placeholder: member.symbol.name };
  }
  const target = targetAt(project, module, offset, "rename");
  if (!target || !renameable(target.symbol)) return "No renameable VelarScript symbol at this position";
  const restriction = bindingRenameRestrictionMessage(project, newName);
  if (restriction) return restriction;
  if (target.symbol.name === newName) return { edits: [], placeholder: target.symbol.name };
  if (renameCollides(project, target, newName)) return "The new name collides with another declaration";
  const locations = target.kind === "export"
    ? exportedLocations(project, target, true)
    : localLocations(target, true);
  return { edits: uniqueLocations(locations), placeholder: target.symbol.name };
}
