import type { ProjectResult } from "../project.ts";
import { enumMemberLocations, enumMemberTargetAt } from "./enums.ts";
import { localLocations, moduleAt, uniqueLocations } from "./locations.ts";
import { memberLocations } from "./members.ts";
import { accessibleMemberTargetAt, exportedLocations, targetAt } from "./targets.ts";
import type { ProjectLocation } from "./types.ts";

export function projectReferencesAt(
  project: ProjectResult,
  path: string,
  offset: number,
  includeDeclaration = false,
): readonly ProjectLocation[] {
  const module = moduleAt(project, path);
  if (!module) return [];
  const enumMember = enumMemberTargetAt(project, module, offset);
  if (enumMember) return enumMemberLocations(project, enumMember, includeDeclaration);
  const member = accessibleMemberTargetAt(project, module, offset);
  if (member) return memberLocations(project, member, includeDeclaration);
  const target = targetAt(project, module, offset, "references");
  if (!target) return [];
  const locations = target.kind === "export"
    ? exportedLocations(project, target, includeDeclaration)
    : localLocations(target, includeDeclaration);
  return uniqueLocations(locations);
}
