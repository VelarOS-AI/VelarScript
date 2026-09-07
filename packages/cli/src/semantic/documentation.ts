import { semanticSymbolAt, type SemanticExpression, type SemanticSymbol } from "@velarscript/compiler";
import type { ProjectModule, ProjectResult } from "../project.ts";
import {
  standardContainerMemberDocumentation,
  standardIdentityMemberDocumentation,
  standardImportedMemberDocumentation,
  standardNamespaceMemberDocumentation,
} from "../standard-api-documentation.ts";
import { contains, importForSymbol, memberAccessAt, moduleAt } from "./locations.ts";
import type { ProjectSyntaxDocumentation } from "./types.ts";

/** Returns the smallest compiler-recognized documented syntax at an offset. */
export function projectSyntaxDocumentationAt(
  project: ProjectResult,
  path: string,
  offset: number,
): ProjectSyntaxDocumentation | null {
  const module = moduleAt(project, path);
  if (!module) return null;
  return module.result.semanticIndex.syntaxDocumentation
    .filter((item) => contains(item.span, offset))
    .sort((left, right) => (left.span.end - left.span.start) - (right.span.end - right.span.start))[0] ?? null;
}

/** Documentation for compiler-owned standard members that have no physical declaration to resolve. */
export function projectMemberDocumentationAt(project: ProjectResult, path: string, offset: number): string | null {
  const module = moduleAt(project, path);
  if (!module) return null;
  const expression = module.result.semanticIndex.expressions
    .filter((candidate) => candidate.selectionSpan && contains(candidate.selectionSpan, offset))
    .sort((left, right) => (left.selectionSpan!.end - left.selectionSpan!.start)
      - (right.selectionSpan!.end - right.selectionSpan!.start))[0];
  const reference = module.result.semanticIndex.memberReferences.find((candidate) => contains(candidate.span, offset));
  const member = expression?.memberName ?? reference?.name;
  if (!member) return null;
  const access = memberAccessAt(module.result.source.text, offset);
  const ownerExpression = access
    ? module.result.semanticIndex.expressions
        .filter((candidate) => candidate.span.end === access.ownerEnd)
        .sort((left, right) => right.span.start - left.span.start)[0]
    : undefined;
  const ownerSymbol = access?.ownerOffset === null || access === null
    ? null
    : semanticSymbolAt(module.result.semanticIndex, access.ownerOffset);
  const memberType = expression?.type
    ?? ownerExpression?.members.find((candidate) => candidate.name === member)?.type
    ?? ownerSymbol?.members.find((candidate) => candidate.name === member)?.type;
  if (!memberType) return null;
  return standardMemberDocumentation(
    project,
    module,
    access,
    ownerSymbol,
    member,
    memberType,
    expression?.ownerKind ?? reference?.ownerKind,
    expression?.ownerIdentity ?? reference?.ownerIdentity,
  );
}

export function standardMemberDocumentation(
  project: ProjectResult,
  module: ProjectModule,
  access: { readonly ownerOffset: number | null; readonly ownerEnd: number } | null,
  ownerSymbol: SemanticSymbol | null,
  member: string,
  memberType: string,
  ownerKind?: SemanticExpression["ownerKind"],
  ownerIdentity?: string,
): string | null {
  const imported = ownerSymbol?.kind === "import" ? importForSymbol(module.result.semanticIndex, ownerSymbol.id) : null;
  if (imported) {
    const documentation = standardImportedMemberDocumentation(imported, member, memberType, project.compilerExtensions);
    if (documentation) return documentation;
  }

  if (!ownerSymbol && bareMemberOwner(module.result.source.text, access)) {
    const namespace = module.result.source.text.slice(access.ownerOffset!, access.ownerEnd);
    const documentation = standardNamespaceMemberDocumentation(namespace, member, project.compilerExtensions);
    if (documentation) return documentation;
  }

  if (ownerKind === "list" || ownerKind === "map" || ownerKind === "record"
    || ownerKind === "set" || ownerKind === "string" || ownerKind === "number") {
    return standardContainerMemberDocumentation(ownerKind, member, memberType);
  }
  return ownerIdentity
    ? standardIdentityMemberDocumentation(ownerIdentity, member, memberType, project.compilerExtensions)
    : null;
}

export function bareMemberOwner(
  source: string,
  access: { readonly ownerOffset: number | null; readonly ownerEnd: number } | null,
): access is { readonly ownerOffset: number; readonly ownerEnd: number } {
  if (access?.ownerOffset === null || access === null) return false;
  let previous = access.ownerOffset - 1;
  while (previous >= 0 && /\s/u.test(source[previous]!)) previous -= 1;
  return source[previous] !== ".";
}
