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

/**
 * D89: the second diagnostic channel. An advisory names a spelling VelarScript
 * accepts with a different meaning than the Python or JavaScript reflex that
 * wrote it, so it can be neither silenced nor rejected. It never blocks code
 * generation: `index.ts` gates emission on `diagnostics.length === 0`, and an
 * advisory is physically incapable of reaching that expression.
 *
 * This is a separate type rather than a `severity` field on `Diagnostic`
 * because the analyzer reads `this.diagnostics.length` as a cursor:
 * `analyzer.ts:3496` and `:3549` hand the length to `reanalyzeLoopBackEdge` as
 * the first diagnostic of a loop body, `:6964`/`:6967` compare two lengths to
 * decide `calleeAlreadyDiagnosed` (which suppresses three reports at `:7058`),
 * `:12573` pairs with `deduplicateDiagnostics`, and `web/analyzer.ts:1063`
 * rewrites message text by index over the same range. Every one of those reads
 * the array's length or index, never the items, so a severity field cannot
 * keep an interleaved advisory from being mistaken for a diagnostic and
 * deleting the real error behind it. Separate arrays make that impossible.
 *
 * The `tier` discriminant is required so TypeScript rejects an advisory passed
 * into any `readonly Diagnostic[]` in the repository, which is what keeps the
 * two channels from merging by accident.
 */
export interface Advisory {
  readonly tier: "advisory";
  /** The advisory roster id, e.g. "A1". Deliberately not the VELxxxx family. */
  readonly code: string;
  readonly message: string;
  readonly span: Span;
  /** The mechanical rewrite this advisory names, when it names exactly one. */
  readonly fix?: DiagnosticFix;
}

export function advisory(code: string, message: string, span: Span, fix?: DiagnosticFix): Advisory {
  return fix ? { tier: "advisory", code, message, span, fix } : { tier: "advisory", code, message, span };
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
  return formatReport(source, item, "error");
}

/** The diagnostic block with `advisory` where the label reads `error`. */
export function formatAdvisory(source: SourceText, item: Advisory): string {
  return formatReport(source, item, "advisory");
}

function formatReport(source: SourceText, item: Diagnostic | Advisory, label: string): string {
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
  const localColumn = Math.max(0, location.column - 1 - start);
  const markerSource = clipped.slice(localColumn, localColumn + Math.max(1, item.span.end - item.span.start));
  const marker = `${" ".repeat(terminalTextWidth(prefix + clipped.slice(0, localColumn)))}${"^".repeat(Math.max(1, terminalTextWidth(markerSource)))}`;

  return [
    `${source.path.replaceAll("\\", "/")}:${location.line}:${location.column} ${label} ${item.code}: ${item.message}`,
    line,
    marker,
  ].join("\n");
}

const graphemeSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

/** Terminal-cell width, distinct from the UTF-16 columns used by LSP. */
function terminalTextWidth(value: string): number {
  const graphemes = graphemeSegmenter
    ? [...graphemeSegmenter.segment(value)].map((entry) => entry.segment)
    : [...value];
  let width = 0;
  for (const grapheme of graphemes) {
    if (/^[\p{Mark}\p{Cf}]*$/u.test(grapheme)) continue;
    const codePoint = grapheme.codePointAt(0) ?? 0;
    width += /\p{Extended_Pictographic}/u.test(grapheme) || isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

function isWideCodePoint(value: number): boolean {
  return value >= 0x1100 && (
    value <= 0x115f
    || value === 0x2329 || value === 0x232a
    || (value >= 0x2e80 && value <= 0xa4cf && value !== 0x303f)
    || (value >= 0xac00 && value <= 0xd7a3)
    || (value >= 0xf900 && value <= 0xfaff)
    || (value >= 0xfe10 && value <= 0xfe19)
    || (value >= 0xfe30 && value <= 0xfe6f)
    || (value >= 0xff00 && value <= 0xff60)
    || (value >= 0xffe0 && value <= 0xffe6)
    || (value >= 0x1b000 && value <= 0x1ffff)
    || (value >= 0x20000 && value <= 0x3fffd)
  );
}
