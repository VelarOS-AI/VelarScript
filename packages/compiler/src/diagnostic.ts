import type { SourceText, Span } from "./source.ts";

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly span: Span;
}

export function diagnostic(code: string, message: string, span: Span): Diagnostic {
  return { code, message, span };
}

export function formatDiagnostic(source: SourceText, item: Diagnostic): string {
  const location = source.location(item.span.start);
  const maximumLine = 240;
  const lineStart = source.lineStarts[location.line - 1] ?? 0;
  const nextBreak = item.code === "VEL1003" ? -1 : source.text.indexOf("\n", lineStart);
  const rawEnd = nextBreak === -1 ? source.text.length : nextBreak;
  const lineEnd = rawEnd > lineStart && source.text[rawEnd - 1] === "\r" ? rawEnd - 1 : rawEnd;
  const rawLength = lineEnd - lineStart;
  const start = rawLength > maximumLine
    ? Math.max(0, Math.min(rawLength - maximumLine, location.column - 81))
    : 0;
  const clipped = source.text.slice(lineStart + start, Math.min(lineEnd, lineStart + start + maximumLine));
  const prefix = start > 0 ? "…" : "";
  const suffix = start + maximumLine < rawLength ? "…" : "";
  const line = `${prefix}${clipped}${suffix}`;
  const displayColumn = Math.max(1, location.column - start + (prefix ? 1 : 0));
  const markerLength = Math.max(1, Math.min(item.span.end - item.span.start, Math.max(1, line.length - displayColumn + 1)));
  const marker = `${" ".repeat(displayColumn - 1)}${"^".repeat(markerLength)}`;

  return [
    `${source.path}:${location.line}:${location.column} error ${item.code}: ${item.message}`,
    line,
    marker,
  ].join("\n");
}
