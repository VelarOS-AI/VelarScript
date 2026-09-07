import { resolve } from "node:path";
import {
  isSourceIdentifierPart,
  isSourceIdentifierStart,
  semanticImportAt,
  type SemanticImport,
  type SemanticIndex,
  type SemanticSymbol,
  type Span,
} from "@velarscript/compiler";
import type { ProjectModule, ProjectResult } from "../project.ts";
import { byCodeUnit } from "../stable-order.ts";
import type { LocalTarget, ProjectLocation, ProjectTextEdit } from "./types.ts";

export function memberAccessAt(source: string, offset: number): { readonly ownerOffset: number | null; readonly ownerEnd: number } | null {
  let cursor = Math.min(Math.max(0, offset), source.length);
  while (cursor > 0 && isSourceIdentifierPart(source[cursor - 1]!)) cursor -= 1;
  let dot = cursor - 1;
  while (dot >= 0 && /\s/u.test(source[dot]!)) dot -= 1;
  if (source[dot] !== ".") return null;
  let ownerEnd = dot;
  if (source[ownerEnd - 1] === "?") ownerEnd -= 1;
  while (ownerEnd > 0 && /\s/u.test(source[ownerEnd - 1]!)) ownerEnd -= 1;
  let ownerStart = ownerEnd;
  while (ownerStart > 0 && isSourceIdentifierPart(source[ownerStart - 1]!)) ownerStart -= 1;
  const ownerOffset = ownerStart < ownerEnd && isSourceIdentifierStart(source[ownerStart]!) ? ownerStart : null;
  return { ownerOffset, ownerEnd };
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function localLocations(target: LocalTarget, includeDeclaration: boolean): ProjectLocation[] {
  return [
    ...(includeDeclaration ? [locationOf(target.symbol)] : []),
    ...referencesFor(target.module, target.symbol),
  ];
}

export function referencesFor(module: ProjectModule, symbol: SemanticSymbol): ProjectLocation[] {
  return module.result.semanticIndex.references
    .filter((reference) => reference.symbolId === symbol.id)
    .map((reference) => ({ path: module.inputPath, span: reference.span }));
}

export function scopeHasName(index: SemanticIndex, target: SemanticSymbol, newName: string): boolean {
  return index.symbols.some((symbol) => symbol.id !== target.id && symbol.scopeId === target.scopeId && symbol.name === newName);
}

export function renameSelectionAt(index: SemanticIndex, offset: number, fallback: SemanticSymbol): Span {
  const imported = semanticImportAt(index, offset);
  if (imported) {
    if (contains(imported.localSpan, offset)) return imported.localSpan;
    if (contains(imported.importedSpan, offset)) return imported.importedSpan;
  }
  const reference = index.references.find((item) => contains(item.span, offset));
  return reference?.span ?? fallback.selectionSpan;
}

export function importForSymbol(index: SemanticIndex, symbolId: string): SemanticImport | null {
  return index.imports.find((item) => item.localSymbolId === symbolId) ?? null;
}

export function moduleAt(project: ProjectResult, path: string): ProjectModule | null {
  const absolute = resolve(path);
  return project.modules.find((module) => module.inputPath === absolute) ?? null;
}

export function locationOf(symbol: SemanticSymbol): ProjectLocation {
  return { path: symbol.path, span: symbol.selectionSpan };
}

export function uniqueLocations(locations: readonly ProjectLocation[]): readonly ProjectLocation[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = `${location.path}:${location.span.start}:${location.span.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => byCodeUnit(left.path, right.path) || left.span.start - right.span.start);
}

export function uniqueTextEdits(edits: readonly ProjectTextEdit[]): readonly ProjectTextEdit[] {
  const seen = new Set<string>();
  return edits.filter((edit) => {
    const key = `${edit.path}:${edit.span.start}:${edit.span.end}:${edit.replacement ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => byCodeUnit(left.path, right.path) || left.span.start - right.span.start);
}

export function renameable(symbol: SemanticSymbol): boolean {
  return symbol.kind !== "field" && symbol.kind !== "method" && symbol.kind !== "enum-member";
}

export function contains(span: Span, offset: number): boolean {
  return offset >= span.start && offset < span.end;
}

export function wordSpanAt(source: string, offset: number): Span | null {
  let start = Math.min(Math.max(0, offset), source.length);
  if (start === source.length || !isSourceIdentifierPart(source[start]!)) start -= 1;
  if (start < 0 || !isSourceIdentifierPart(source[start]!)) return null;
  let end = start + 1;
  while (start > 0 && isSourceIdentifierPart(source[start - 1]!)) start -= 1;
  while (end < source.length && isSourceIdentifierPart(source[end]!)) end += 1;
  return { start, end };
}

export function callAt(source: string, offset: number): { readonly calleeOffset: number; readonly activeParameter: number } | null {
  let depth = 0;
  let activeParameter = 0;
  let quote: string | null = null;
  for (let index = Math.min(offset, source.length) - 1; index >= 0; index -= 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; continue; }
    if (character === ")" || character === "]" || character === "}") { depth += 1; continue; }
    if (character === "(" || character === "[" || character === "{") {
      if (depth > 0) { depth -= 1; continue; }
      if (character !== "(") return null;
      let end = index;
      while (end > 0 && /\s/u.test(source[end - 1]!)) end -= 1;
      let start = end;
      while (start > 0 && isSourceIdentifierPart(source[start - 1]!)) start -= 1;
      return start === end ? null : { calleeOffset: start, activeParameter };
    }
    if (character === "," && depth === 0) activeParameter += 1;
    if ((character === "\n" || character === "\r") && depth === 0) return null;
  }
  return null;
}
