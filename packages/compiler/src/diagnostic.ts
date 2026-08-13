import type { SourceText, Span } from "./source.ts";

/**
 * D38 §48: the mechanical rewrite a diagnostic already knows. A fix is
 * registered only where the diagnostic names one correct replacement and no
 * judgment is involved, so applying it is a spelling change and never a guess
 * about intent. `velar fix` applies these, and an editor offers each one as a
 * quick fix; every other diagnostic stays advice the author acts on.
 */
export interface DiagnosticEdit {
  /** The replaced range. It may be wider than the diagnostic span (surrounding whitespace a deletion should take with it), and empty to insert. */
  readonly span: Span;
  /** The exact replacement text; the empty string deletes the range. */
  readonly text: string;
}

export interface DiagnosticFix {
  /** The edits of one rewrite; they never overlap and are applied together or not at all. */
  readonly edits: readonly DiagnosticEdit[];
  /** Imperative editor title, e.g. "Use VelarScript strict equality '=='". */
  readonly title: string;
}

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
  /** The mechanical rewrite this diagnostic names, when it names exactly one. */
  readonly fix?: DiagnosticFix;
}

export function diagnostic(code: string, message: string, span: Span, fix?: DiagnosticFix): Diagnostic {
  return fix ? { code, message, span, fix } : { code, message, span };
}

export function recoveredDiagnostic(code: string, message: string, span: Span, fix?: DiagnosticFix): Diagnostic {
  return fix ? { code, message, span, recovered: true, fix } : { code, message, span, recovered: true };
}

/** Builds the one-edit mechanical rewrite of `span` to `text`. */
export function mechanicalFix(span: Span, text: string, title: string): DiagnosticFix {
  return { edits: [{ span, text }], title };
}

/** Builds a mechanical rewrite whose one spelling change needs more than one edit. */
export function mechanicalEdits(edits: readonly DiagnosticEdit[], title: string): DiagnosticFix {
  return { edits, title };
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
