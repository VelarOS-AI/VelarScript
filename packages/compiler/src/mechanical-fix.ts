import type { Diagnostic, DiagnosticEdit } from "./diagnostic.ts";
import type { Span } from "./source.ts";

export interface AppliedMechanicalFix {
  readonly code: string;
  readonly title: string;
  /** The offset in the original text where the rewrite starts, for reporting a location. */
  readonly offset: number;
}

export interface MechanicalFixResult {
  readonly text: string;
  readonly applied: readonly AppliedMechanicalFix[];
  /** Fixes withheld because another fix in the same pass already rewrote overlapping text. */
  readonly deferred: number;
}

/**
 * D38 §48: applies every mechanical rewrite a compile reported. Each edit is a
 * spelling change the diagnostic itself named, so the result is the source the
 * author meant to write — nothing here decides anything the diagnostic left
 * open.
 *
 * Two fixes that touch the same text cannot both be applied against one
 * snapshot, so the later one is deferred to the next pass rather than applied
 * blind. `velar fix` recompiles until no pass applies anything, which is also
 * what makes the command idempotent: a second run finds no fixes to apply.
 */
export function applyMechanicalFixes(text: string, diagnostics: readonly Diagnostic[]): MechanicalFixResult {
  const candidates: { readonly code: string; readonly title: string; readonly edits: readonly DiagnosticEdit[] }[] = [];
  const seen = new Set<string>();
  for (const item of diagnostics) {
    if (!item.fix || item.fix.edits.length === 0) continue;
    if (item.fix.edits.some((edit) => !isApplicableEdit(text, edit))) continue;
    if (!belongsToDiagnostic(text, item.span, item.fix.edits)) continue;
    if (item.fix.edits.every((edit) => text.slice(edit.span.start, edit.span.end) === edit.text)) continue;
    const identity = `${item.code}\0${item.fix.edits.map((edit) => `${edit.span.start}:${edit.span.end}:${edit.text}`).join("\0")}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    candidates.push({ code: item.code, title: item.fix.title, edits: item.fix.edits });
  }

  const ordered = [...candidates].sort((left, right) => firstOffset(left.edits) - firstOffset(right.edits));
  const applied: AppliedMechanicalFix[] = [];
  const accepted: DiagnosticEdit[] = [];
  let deferred = 0;
  for (const candidate of ordered) {
    if (candidate.edits.some((edit) => accepted.some((other) => overlaps(edit, other)))) {
      deferred += 1;
      continue;
    }
    accepted.push(...candidate.edits);
    applied.push({ code: candidate.code, title: candidate.title, offset: firstOffset(candidate.edits) });
  }

  const sorted = [...accepted].sort((left, right) => right.span.start - left.span.start);
  let output = text;
  for (const edit of sorted) output = `${output.slice(0, edit.span.start)}${edit.text}${output.slice(edit.span.end)}`;
  return { text: output, applied, deferred };
}

/**
 * D90: a fix is spliced into the text the diagnostic was reported against, so
 * its edits have to be in that text's coordinates. Nothing else in the
 * pipeline notices when they are not — a fix computed inside an f-string
 * interpolation and applied at module offsets rewrites whatever happens to sit
 * there — so the relation is checked before anything is written.
 *
 * A fix belongs to its diagnostic when one of its edits sits at the report:
 * overlapping it, or with nothing but whitespace between the two. The one
 * legitimate rewrite that happens away from the report is the import a
 * diagnostic asks for (`analyzer.ts` VEL3008), so a fix whose edits are all
 * elsewhere is still accepted when every one of them rewrites whole lines.
 * Mid-line surgery far from the report is never a spelling the diagnostic
 * named.
 */
function belongsToDiagnostic(text: string, reported: Span, edits: readonly DiagnosticEdit[]): boolean {
  if (edits.some((edit) => nothingButWhitespaceBetween(text, reported, edit.span))) return true;
  return edits.every((edit) => rewritesWholeLines(text, edit.span));
}

function nothingButWhitespaceBetween(text: string, left: Span, right: Span): boolean {
  const gap = left.start <= right.start ? text.slice(left.end, right.start) : text.slice(right.end, left.start);
  return gap.trim().length === 0;
}

function rewritesWholeLines(text: string, edited: Span): boolean {
  return startsLine(text, edited.start) && endsLine(text, edited.end);
}

function startsLine(text: string, index: number): boolean {
  return text.slice(text.lastIndexOf("\n", Math.max(0, index - 1)) + 1, index).trim().length === 0;
}

function endsLine(text: string, index: number): boolean {
  if (index === 0 || text[index - 1] === "\n") return true;
  const lineEnd = text.indexOf("\n", index);
  return text.slice(index, lineEnd === -1 ? text.length : lineEnd).trim().length === 0;
}

function isApplicableEdit(text: string, edit: DiagnosticEdit): boolean {
  return Number.isSafeInteger(edit.span.start) && Number.isSafeInteger(edit.span.end)
    && edit.span.start >= 0 && edit.span.start <= edit.span.end && edit.span.end <= text.length;
}

function firstOffset(edits: readonly DiagnosticEdit[]): number {
  return edits.reduce((lowest, edit) => Math.min(lowest, edit.span.start), Number.MAX_SAFE_INTEGER);
}

function overlaps(left: DiagnosticEdit, right: DiagnosticEdit): boolean {
  // Zero-width insertions conflict with any edit that contains their position,
  // and with another insertion at the same position.
  if (left.span.start === left.span.end || right.span.start === right.span.end) {
    return left.span.start <= right.span.end && right.span.start <= left.span.end;
  }
  return left.span.start < right.span.end && right.span.start < left.span.end;
}
