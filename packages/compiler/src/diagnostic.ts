import type { SourceText, Span } from "./source.ts";

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly span: Span;
  /**
   * Marks a guidance diagnostic whose compile stage internally recovered as
   * the guided spelling, so later stages still run and can report their own
   * guidance in the same compile. Compilation still fails: recovered
   * diagnostics count toward the zero-diagnostics gate for code generation.
   */
  readonly recovered?: boolean;
}

export function diagnostic(code: string, message: string, span: Span): Diagnostic {
  return { code, message, span };
}

export function recoveredDiagnostic(code: string, message: string, span: Span): Diagnostic {
  return { code, message, span, recovered: true };
}

export function formatDiagnostic(source: SourceText, item: Diagnostic): string {
  const location = source.location(item.span.start);
  const maximumLine = 240;
  const rawLine = source.lineText(location.line);
  const rawLength = rawLine.length;
  const start = rawLength > maximumLine
    ? Math.max(0, Math.min(rawLength - maximumLine, location.column - 81))
    : 0;
  const clipped = rawLine.slice(start, start + maximumLine);
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
