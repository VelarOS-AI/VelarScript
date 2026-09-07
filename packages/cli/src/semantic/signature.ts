import { isSourceIdentifierPart, isSourceIdentifierStart, type SemanticSymbol } from "@velarscript/compiler";
import type { ProjectModule, ProjectResult } from "../project.ts";
import { callAt, contains, moduleAt, wordSpanAt } from "./locations.ts";
import { projectSymbolAt } from "./symbol-lookup.ts";
import type { ProjectSignature } from "./types.ts";

export function projectSignatureAt(project: ProjectResult, path: string, offset: number): ProjectSignature | null {
  const module = moduleAt(project, path);
  if (!module) return null;
  const source = module.result.source.text;
  const call = callAt(source, offset);
  if (!call) return null;
  const symbol = projectSymbolAt(project, path, call.calleeOffset);
  if (symbol?.callable && symbol.type) return { label: `${symbol.name}${symbol.type}`, activeParameter: call.activeParameter };
  const expression = module.result.semanticIndex.expressions.find((item) => item.selectionSpan && contains(item.selectionSpan, call.calleeOffset));
  if (expression?.memberName && expression.callable) {
    return { label: `${expression.memberName}${expression.type}`, activeParameter: call.activeParameter };
  }
  const member = memberCallAt(project, module, source, call.calleeOffset);
  return member?.kind === "method"
    ? { label: `${member.name}${member.type}`, activeParameter: call.activeParameter }
    : null;
}

function memberCallAt(
  project: ProjectResult,
  module: ProjectModule,
  source: string,
  calleeOffset: number,
): SemanticSymbol["members"][number] | null {
  const callee = wordSpanAt(source, calleeOffset);
  if (!callee) return null;
  let dot = callee.start - 1;
  while (dot >= 0 && /\s/u.test(source[dot]!)) dot -= 1;
  if (source[dot] !== ".") return null;
  let ownerEnd = dot;
  if (source[ownerEnd - 1] === "?") ownerEnd -= 1;
  while (ownerEnd > 0 && /\s/u.test(source[ownerEnd - 1]!)) ownerEnd -= 1;
  let ownerStart = ownerEnd;
  while (ownerStart > 0 && isSourceIdentifierPart(source[ownerStart - 1]!)) ownerStart -= 1;
  if (ownerStart === ownerEnd || !isSourceIdentifierStart(source[ownerStart]!)) return null;
  const owner = projectSymbolAt(project, module.inputPath, ownerStart);
  const memberName = source.slice(callee.start, callee.end);
  return owner?.members.find((member) => member.name === memberName) ?? null;
}
