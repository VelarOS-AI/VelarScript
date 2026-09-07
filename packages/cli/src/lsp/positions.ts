/**
 * D115 P4 R4c — text, position, range, and edit arithmetic.
 *
 * Every answer here depends on the position encoding the client negotiated in
 * `initialize`, which used to be a mutable module-level `activePositionEncoding`
 * these helpers read behind the caller's back. It is now a session field, and
 * each helper takes the session (as `PositionContext`) and reads it at the call,
 * so the value in force is the one the current request negotiated.
 */
import { pathToFileURL } from "node:url";
import { isSourceIdentifierPart, type SourceText, type Span } from "@velarscript/compiler";
import type { ProjectResult } from "../project.ts";
import type { WorkspaceIndexPosition } from "../workspace-index.ts";
import type { ContentChange, Position, Range } from "./protocol.ts";

export type PositionEncoding = "utf-16" | "utf-32";

/** What a position answer needs from the session, read live rather than captured. */
export interface PositionContext {
  readonly positionEncoding: PositionEncoding;
}

export function applyContentChanges(context: PositionContext, text: string, changes: readonly ContentChange[]): string {
  let result = text;
  for (const change of changes) {
    if (!change.range) result = change.text;
    else {
      const start = offsetAt(context, result, change.range.start);
      const end = offsetAt(context, result, change.range.end);
      result = result.slice(0, start) + change.text + result.slice(end);
    }
  }
  return result;
}

export function offsetAt(context: PositionContext, text: string, position: Position): number {
  const requestedLine = Number.isSafeInteger(position?.line) && position.line >= 0
    ? position.line
    : 0;
  const requestedCharacter = Number.isSafeInteger(position?.character) && position.character >= 0
    ? position.character
    : 0;
  let offset = 0;
  for (let line = 0; line < requestedLine && offset < text.length; line += 1) {
    const next = nextLineStart(text, offset);
    offset = next === null ? text.length : next;
  }
  const end = lineEndAt(text, offset);
  return context.positionEncoding === "utf-16"
    ? Math.min(end, offset + requestedCharacter)
    : codeUnitOffsetAt(text, offset, end, requestedCharacter);
}

function positionAt(context: PositionContext, text: string, requestedOffset: number): Position {
  const offset = Math.max(0, Math.min(text.length, requestedOffset));
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    const character = text[index];
    if (character === "\r") {
      const breakEnd = text[index + 1] === "\n" ? index + 2 : index + 1;
      if (breakEnd > offset) break;
      line += 1;
      lineStart = breakEnd;
      index = breakEnd - 1;
    } else if (character === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, character: context.positionEncoding === "utf-16" ? offset - lineStart : codePointCount(text, lineStart, offset) };
}

export function requestedPositionEncoding(params: Record<string, unknown> | undefined): PositionEncoding {
  const capabilities = params?.capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return "utf-16";
  const general = (capabilities as Record<string, unknown>).general;
  if (!general || typeof general !== "object" || Array.isArray(general)) return "utf-16";
  const encodings = (general as Record<string, unknown>).positionEncodings;
  return Array.isArray(encodings) && encodings.includes("utf-32") ? "utf-32" : "utf-16";
}

export function workspacePosition(context: PositionContext, position: WorkspaceIndexPosition): Position {
  return {
    line: position.line,
    character: context.positionEncoding === "utf-16" ? position.utf16Character : position.utf32Character,
  };
}

export function lspLocation(context: PositionContext, project: ProjectResult, path: string, span: Span): unknown {
  return { uri: pathToFileURL(path).href, range: lspRange(context, sourceFor(project, path), span) };
}

export function lspRange(context: PositionContext, source: SourceText, span: Span): Range {
  return { start: lspSourcePosition(context, source, span.start), end: lspSourcePosition(context, source, span.end) };
}

export function sourceFor(project: ProjectResult, path: string): SourceText {
  const module = project.modules.find((item) => item.inputPath === path);
  if (!module) throw new Error(`VelarScript project has no source for ${path}`);
  return module.result.source;
}

export function workspaceEdit(context: PositionContext, project: ProjectResult, edits: readonly { readonly path: string; readonly span: Span; readonly replacement?: string }[], newText: string): unknown {
  const changes: Record<string, Array<{ range: Range; newText: string }>> = {};
  for (const edit of edits) {
    const uri = pathToFileURL(edit.path).href;
    (changes[uri] ??= []).push({ range: lspRange(context, sourceFor(project, edit.path), edit.span), newText: edit.replacement ?? newText });
  }
  return { changes };
}

export function sameLspRange(left: Range, right: Range): boolean {
  return left.start.line === right.start?.line && left.start.character === right.start?.character
    && left.end.line === right.end?.line && left.end.character === right.end?.character;
}

export function lspSourcePosition(context: PositionContext, source: SourceText, offset: number): Position {
  const location = source.location(offset);
  const line = location.line - 1;
  const start = source.lineStarts[line] ?? 0;
  const bounded = Math.max(start, Math.min(offset, source.text.length));
  return {
    line,
    character: context.positionEncoding === "utf-16" ? bounded - start : codePointCount(source.text, start, bounded),
  };
}

function codePointCount(text: string, start: number, end: number): number {
  let count = 0;
  for (let index = start; index < end; count += 1) {
    const point = text.codePointAt(index);
    index += point !== undefined && point > 0xffff ? 2 : 1;
  }
  return count;
}

function codeUnitOffsetAt(text: string, start: number, end: number, requested: number): number {
  let index = start;
  for (let count = 0; count < requested && index < end; count += 1) {
    const point = text.codePointAt(index);
    index += point !== undefined && point > 0xffff ? 2 : 1;
  }
  return index;
}

function nextLineStart(text: string, start: number): number | null {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\r") return index + (text[index + 1] === "\n" ? 2 : 1);
    if (text[index] === "\n") return index + 1;
  }
  return null;
}

export function lineEndAt(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\r" || text[index] === "\n") return index;
  }
  return text.length;
}

export function wordAt(text: string, offset: number): string {
  let start = offset;
  let end = offset;
  while (start > 0 && isSourceIdentifierPart(text[start - 1]!)) start -= 1;
  while (end < text.length && isSourceIdentifierPart(text[end]!)) end += 1;
  return text.slice(start, end);
}

export function fullRange(context: PositionContext, text: string): Range {
  return { start: { line: 0, character: 0 }, end: positionAt(context, text, text.length) };
}
