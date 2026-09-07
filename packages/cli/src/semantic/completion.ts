import {
  semanticSymbolAt,
  semanticVisibleSymbolsAt,
  type SemanticExpression,
  type SemanticIndex,
} from "@velarscript/compiler";
import type { ProjectModule, ProjectResult } from "../project.ts";
import { standardContainerKindFromDisplay, standardNamespaceMembers } from "../standard-api-documentation.ts";
import { bareMemberOwner, standardMemberDocumentation } from "./documentation.ts";
import { memberAccessAt, moduleAt } from "./locations.ts";
import { projectSymbolAt } from "./symbol-lookup.ts";
import { findDeclaredMember, ownerTarget, targetAt } from "./targets.ts";
import type { MemberTarget, ProjectCompletion, ProjectCompletionContext } from "./types.ts";

export function projectCompletionsAt(project: ProjectResult, path: string, offset: number): readonly ProjectCompletion[] {
  const module = moduleAt(project, path);
  if (!module) return [];
  const extensionCompletion = extensionCompletionAt(project, module, offset);
  if (extensionCompletion) return extensionCompletion.completions;
  const memberAccess = memberAccessAt(module.result.source.text, offset);
  if (memberAccess) {
    const owner = memberAccess.ownerOffset === null ? null : projectSymbolAt(project, module.inputPath, memberAccess.ownerOffset);
    const ownerSymbol = memberAccess.ownerOffset === null
      ? null
      : semanticSymbolAt(module.result.semanticIndex, memberAccess.ownerOffset);
    const ownerExpression = module.result.semanticIndex.expressions
      .filter((expression) => expression.span.end === memberAccess.ownerEnd)
      .sort((left, right) => right.span.start - left.span.start)[0];
    const namespaceMembers = !ownerSymbol && bareMemberOwner(module.result.source.text, memberAccess)
      ? standardNamespaceMembers(
          module.result.source.text.slice(memberAccess.ownerOffset, memberAccess.ownerEnd),
          project.compilerExtensions,
        )
      : [];
    const members = ownerExpression?.members ?? owner?.members ?? namespaceMembers;
    const documentationOwner = completionOwnerTarget(project, module, memberAccess.ownerOffset, ownerExpression?.type ?? owner?.type ?? null);
    return members.map((member) => {
      const declared = documentationOwner
        ? findDeclaredMember(project, documentationOwner.target, member.name, documentationOwner.staticMember, new Set())
        : null;
      const standardDocumentation = standardMemberDocumentation(
        project,
        module,
        memberAccess,
        ownerSymbol,
        member.name,
        member.type,
        ownerExpression?.ownerKind
          ?? ownerSymbol?.typeKind
          ?? standardContainerKindFromDisplay(ownerExpression?.type ?? owner?.type ?? null)
          ?? undefined,
        ownerExpression?.ownerIdentity ?? ownerSymbol?.typeIdentity,
      );
      return {
        label: member.name,
        detail: member.type,
        kind: member.kind,
        ...(declared?.symbol.documentation
          ? { documentation: declared.symbol.documentation }
          : standardDocumentation ? { documentation: standardDocumentation } : {}),
      };
    });
  }
  const object = objectFieldContextAt(module.result.semanticIndex, module.result.source.text, offset);
  if (object) {
    const contextOwner = object.expression.contextType
      ? ownerTarget(project, module, object.expression.contextType, "named")
      : null;
    return (object.expression.contextMembers ?? []).filter((member) => !object.used.has(member.name)).map((member) => {
      const declared = contextOwner ? findDeclaredMember(project, contextOwner, member.name, false, new Set()) : null;
      return {
        label: member.name,
        detail: member.type,
        kind: member.kind,
        ...(declared?.symbol.documentation ? { documentation: declared.symbol.documentation } : {}),
      };
    });
  }
  return semanticVisibleSymbolsAt(module.result.semanticIndex, offset).map((symbol) => {
    const resolved = projectSymbolAt(project, module.inputPath, symbol.selectionSpan.start) ?? symbol;
    return {
      label: symbol.name,
      detail: symbol.type ?? symbol.kind,
      kind: symbol.kind,
      ...(resolved.presentationKind ? { presentationKind: resolved.presentationKind } : {}),
      ...(resolved.documentation ? { documentation: resolved.documentation } : {}),
    };
  });
}

function completionOwnerTarget(
  project: ProjectResult,
  module: ProjectModule,
  ownerOffset: number | null,
  displayedType: string | null,
): { readonly target: MemberTarget; readonly staticMember: boolean } | null {
  if (ownerOffset !== null) {
    const direct = targetAt(project, module, ownerOffset, "definition");
    if (direct?.symbol.kind === "class") return { target: direct, staticMember: true };
    if (direct?.symbol.kind.startsWith("extension:function:") || direct?.symbol.kind.startsWith("extension:class:")) {
      return { target: direct, staticMember: false };
    }
  }
  if (!displayedType) return null;
  const classTarget = ownerTarget(project, module, displayedType, "class");
  if (classTarget) return { target: classTarget, staticMember: false };
  const recordTarget = ownerTarget(project, module, displayedType, "named");
  return recordTarget ? { target: recordTarget, staticMember: false } : null;
}

export function projectCompletionContextAt(project: ProjectResult, path: string, offset: number): ProjectCompletionContext {
  const module = moduleAt(project, path);
  if (!module) return "ordinary";
  const source = module.result.source.text;
  const extension = extensionCompletionAt(project, module, offset);
  if (extension) return `extension:${extension.extensionId}:${extension.context}`;
  if (memberAccessAt(source, offset)) return "member";
  if (objectFieldContextAt(module.result.semanticIndex, source, offset)) return "object-field";
  return "ordinary";
}

function extensionCompletionAt(project: ProjectResult, module: ProjectModule, offset: number): {
  readonly extensionId: string;
  readonly context: string;
  readonly completions: readonly ProjectCompletion[];
} | null {
  const extensions = project.compilerExtensions.filter((extension) => extension.editor?.project?.complete);
  if (extensions.length === 0) return null;
  const importsBySymbol = new Map(module.result.semanticIndex.imports.map((item) => [item.localSymbolId, item] as const));
  const visibleSymbols = semanticVisibleSymbolsAt(module.result.semanticIndex, offset).map((symbol) => {
    const resolved = projectSymbolAt(project, module.inputPath, symbol.selectionSpan.start) ?? symbol;
    const imported = importsBySymbol.get(symbol.id);
    return {
      label: symbol.name,
      detail: symbol.type ?? symbol.kind,
      kind: symbol.kind,
      ...(resolved.presentationKind ? { presentationKind: resolved.presentationKind } : {}),
      ...(resolved.documentation ? { documentation: resolved.documentation } : {}),
      ...(imported ? { importSource: imported.source, importedName: imported.imported } : {}),
    };
  });
  const membersAt = (memberOffset: number): readonly ProjectCompletion[] => {
    const target = targetAt(project, module, memberOffset, "definition");
    if (!target) return [];
    return target.symbol.members.map((member) => {
      const declared = findDeclaredMember(project, target, member.name, false, new Set());
      return {
        label: member.name,
        detail: member.type,
        kind: member.kind,
        ...(declared?.symbol.documentation ? { documentation: declared.symbol.documentation } : {}),
      };
    });
  };
  for (const extension of extensions) {
    const result = extension.editor!.project!.complete!({
      source: module.result.source.text,
      offset,
      visibleSymbols,
      membersAt,
    });
    if (result) return { extensionId: extension.id, context: result.context, completions: result.completions };
  }
  return null;
}

function objectFieldContextAt(index: SemanticIndex, source: string, offset: number): {
  readonly expression: SemanticExpression;
  readonly used: ReadonlySet<string>;
} | null {
  const expression = index.expressions
    .filter((item) => item.contextMembers && offset > item.span.start && offset <= item.span.end)
    .sort((left, right) => right.span.start - left.span.start)[0];
  if (!expression) return null;
  const fragment = source.slice(expression.span.start + 1, Math.min(offset, expression.span.end));
  let quote: string | null = null;
  let escaped = false;
  let depth = 0;
  let visible = "";
  for (const character of fragment) {
    if (quote) {
      visible += " ";
      if (!escaped && character === quote) quote = null;
      escaped = !escaped && character === "\\";
      if (character !== "\\") escaped = false;
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; visible += " "; continue; }
    if (character === "{" || character === "[" || character === "(") { depth += 1; visible += " "; continue; }
    if (character === "}" || character === "]" || character === ")") { depth = Math.max(0, depth - 1); visible += " "; continue; }
    visible += depth === 0 ? character : " ";
  }
  if (quote || depth > 0) return null;
  const segments = visible.split(",");
  const current = segments.at(-1) ?? "";
  if (current.includes(":")) return null;
  const used = new Set<string>();
  for (const segment of segments) {
    const match = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)/u.exec(segment);
    if (match) used.add(match[1]!);
  }
  return { expression, used };
}
