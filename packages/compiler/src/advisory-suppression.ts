import { diagnostic, mechanicalFix, type Advisory, type Diagnostic } from "./diagnostic.ts";
import { span, type SourceText, type Span } from "./source.ts";

/**
 * D89: an advisory is suppressed in place by a trailing line comment that
 * names the advisory and says why the spelling is intended:
 *
 *     const step = total // 2   // velar-allow A1: 2 is a step number
 *
 * The three rules are all enforced, and two of them are `diagnostics`, not
 * advisories, so a suppression that is not answerable fails the build:
 *
 * 1. A suppression names one advisory. There is no blanket form, because a
 *    blanket one would also cover the next advisory to be reported on that
 *    line, which nobody read when they wrote it.
 * 2. A suppression without a reason is `VEL1011`. The reason is the whole
 *    mechanism: it lands in the diff, a reviewer reads it, and writing one
 *    forces the author to check the spelling before claiming it is right.
 * 3. A suppression whose advisory is not reported on its line is `VEL1012`,
 *    with the mechanical rewrite that deletes it. This follows TypeScript's
 *    `@ts-expect-error` rather than eslint's `eslint-disable`: a suppression
 *    may not rot in the file and mislead the next reader.
 */
const SUPPRESSION_MARKER = "velar-allow";

/**
 * The advisory roster's spelling. A suppression names one of these and nothing
 * else: a diagnostic code cannot be suppressed, and a word that is not a code
 * at all is the blanket form the first rule refuses.
 */
const ADVISORY_CODE = /^A[0-9]+$/u;

/** The canonical spelling, quoted by both suppression diagnostics. */
function suppressionForm(code: string): string {
  return `// ${SUPPRESSION_MARKER} ${code}: why this spelling is intended`;
}

export interface AdvisorySuppression {
  /** The advisory code this clause names, such as `A1`. */
  readonly code: string;
  /** The reason written after the colon, with the surrounding whitespace removed. */
  readonly reason: string;
  /** The clause itself, from `velar-allow` through the end of the reason. */
  readonly span: Span;
  /**
   * The range a deletion takes with it, which is wider than `span`: the
   * whitespace ahead of the clause, the `//` when the clause owns the whole
   * comment, and the line itself when the comment owns the whole line.
   */
  readonly removal: Span;
}

export interface AdvisorySuppressionScan {
  readonly suppressions: readonly AdvisorySuppression[];
  readonly diagnostics: readonly Diagnostic[];
  /**
   * Where the comment's own text ends: the start of its first `velar-allow`
   * clause when it carries one, and the trimmed end of the comment otherwise.
   * An advisory that reads comment text — A1 reads it to decide whether the
   * tail of the line is a bare arithmetic expression — must read
   * `[bodyStart, contentEnd)` rather than the whole comment. D89's own example
   * shows why:
   *
   *     const step = total // 2   // velar-allow A1: 2 is a step number
   *
   * There is one comment there, not two, so A1 measured over the whole comment
   * would see letters, refuse to fire, and turn the suppression that was
   * written for it into a stale one. `contentEnd` cuts at the clause, and the
   * `//` an author writes to set the clause apart goes with it.
   */
  readonly contentEnd: number;
}

/**
 * Reads the `velar-allow` clauses of one line comment. `commentStart` is the
 * comment's first character, `bodyStart` the first character of its text, and
 * `commentEnd` the end of the physical line.
 */
export function scanAdvisorySuppressions(
  text: string,
  commentStart: number,
  bodyStart: number,
  commentEnd: number,
): AdvisorySuppressionScan {
  const clauseStarts = markerOffsets(text, bodyStart, commentEnd);
  if (clauseStarts.length === 0) return { suppressions: [], diagnostics: [], contentEnd: trimmedEnd(text, bodyStart, commentEnd) };

  const suppressions: AdvisorySuppression[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const [position, clauseStart] of clauseStarts.entries()) {
    const clauseEnd = trimmedEnd(text, clauseStart, clauseStarts[position + 1] ?? commentEnd);
    const clauseSpan = span(clauseStart, clauseEnd);
    const parsed = parseClause(text, clauseStart + SUPPRESSION_MARKER.length, clauseEnd);
    if (!ADVISORY_CODE.test(parsed.code)) {
      diagnostics.push(diagnostic(
        "VEL1011",
        `A '${SUPPRESSION_MARKER}' comment must name the advisory it suppresses ('A1', 'A2', …) and say why: write '${suppressionForm("A1")}'. There is no blanket form`,
        clauseSpan,
      ));
      continue;
    }
    if (parsed.reason === "") {
      diagnostics.push(diagnostic(
        "VEL1011",
        `A '${SUPPRESSION_MARKER}' comment must give a reason: write '${suppressionForm(parsed.code)}'`,
        clauseSpan,
      ));
      continue;
    }
    suppressions.push({
      code: parsed.code,
      reason: parsed.reason,
      span: clauseSpan,
      removal: removalSpan(text, commentStart, bodyStart, commentEnd, clauseStart, clauseEnd),
    });
  }

  return { suppressions, diagnostics, contentEnd: clauseOpeningStart(text, bodyStart, clauseStarts[0]!) };
}

export interface AdvisoryResolution {
  /** The advisories that survived; a suppressed one is gone rather than marked. */
  readonly advisories: readonly Advisory[];
  /** The stale-suppression failures, which belong to the diagnostic channel. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Applies the suppressions of a compile to its advisories. A suppression
 * matches an advisory by line and by code, so it sits on the line the advisory
 * points at and covers nothing else.
 *
 * `reportStale` is false where a stage that would have reported the advisory
 * did not run — an earlier failure kept analysis from starting, or the caller
 * only lexed and parsed. Answering "this advisory did not fire" there would
 * blame the author for the compile stopping short.
 */
export function resolveAdvisorySuppressions(
  source: SourceText,
  advisories: readonly Advisory[],
  suppressions: readonly AdvisorySuppression[],
  options: { readonly reportStale: boolean },
): AdvisoryResolution {
  if (suppressions.length === 0) return { advisories, diagnostics: [] };

  const byLineAndCode = new Map<string, AdvisorySuppression[]>();
  for (const suppression of suppressions) {
    const key = `${source.location(suppression.span.start).line}\0${suppression.code}`;
    const existing = byLineAndCode.get(key);
    if (existing) existing.push(suppression);
    else byLineAndCode.set(key, [suppression]);
  }

  const used = new Set<AdvisorySuppression>();
  const kept = advisories.filter((item) => {
    const matched = byLineAndCode.get(`${source.location(item.span.start).line}\0${item.code}`);
    if (!matched) return true;
    for (const suppression of matched) used.add(suppression);
    return false;
  });

  if (!options.reportStale) return { advisories: kept, diagnostics: [] };
  const diagnostics = suppressions.filter((suppression) => !used.has(suppression)).map((suppression) => diagnostic(
    "VEL1012",
    `No ${suppression.code} advisory is reported on this line, so this '${SUPPRESSION_MARKER}' suppresses nothing; delete it`,
    suppression.span,
    mechanicalFix(suppression.removal, "", `Delete the stale '${SUPPRESSION_MARKER} ${suppression.code}' comment`),
  ));
  return { advisories: kept, diagnostics };
}

/** Every `velar-allow` written as a whole word, in source order. */
function markerOffsets(text: string, from: number, to: number): number[] {
  const offsets: number[] = [];
  let index = text.indexOf(SUPPRESSION_MARKER, from);
  while (index >= 0 && index + SUPPRESSION_MARKER.length <= to) {
    if (!isMarkerPart(text[index - 1]) && !isMarkerPart(text[index + SUPPRESSION_MARKER.length])) offsets.push(index);
    index = text.indexOf(SUPPRESSION_MARKER, index + SUPPRESSION_MARKER.length);
  }
  return offsets;
}

function isMarkerPart(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}_-]/u.test(character);
}

function parseClause(text: string, from: number, to: number): { readonly code: string; readonly reason: string } {
  let index = skipBlanks(text, from, to);
  const codeStart = index;
  if (index < to && /[A-Za-z]/u.test(text[index]!)) {
    index += 1;
    while (index < to && /[A-Za-z0-9]/u.test(text[index]!)) index += 1;
  }
  const code = text.slice(codeStart, index);
  if (code === "") return { code: "", reason: "" };
  index = skipBlanks(text, index, to);
  if (text[index] !== ":") return { code, reason: "" };
  return { code, reason: text.slice(index + 1, to).trim() };
}

function skipBlanks(text: string, from: number, to: number): number {
  let index = from;
  while (index < to && (text[index] === " " || text[index] === "\t")) index += 1;
  return index;
}

function trimmedEnd(text: string, from: number, to: number): number {
  let end = to;
  while (end > from && (text[end - 1] === " " || text[end - 1] === "\t")) end -= 1;
  return end;
}

/**
 * Where a clause begins once the whitespace ahead of it counts as part of it,
 * along with the `//` an author writes to set the clause apart from the
 * comment it rides on. The comment's own `//` is never taken: it sits below
 * `bodyStart`.
 */
function clauseOpeningStart(text: string, bodyStart: number, clauseStart: number): number {
  const trimmed = trimmedEnd(text, bodyStart, clauseStart);
  return trimmed - 2 >= bodyStart && text.startsWith("//", trimmed - 2)
    ? trimmedEnd(text, bodyStart, trimmed - 2)
    : trimmed;
}

/**
 * What deleting one clause takes with it. A clause that shares its comment
 * with real prose loses only itself; a clause that owns the comment loses the
 * `//` as well, and a comment that owns its line loses the line.
 */
function removalSpan(
  text: string,
  commentStart: number,
  bodyStart: number,
  commentEnd: number,
  clauseStart: number,
  clauseEnd: number,
): Span {
  const start = clauseOpeningStart(text, bodyStart, clauseStart);
  if (start > bodyStart || clauseEnd !== trimmedEnd(text, bodyStart, commentEnd)) return span(start, clauseEnd);

  let lineStart = commentStart;
  while (lineStart > 0 && text[lineStart - 1] !== "\n" && text[lineStart - 1] !== "\r") lineStart -= 1;
  if (text.slice(lineStart, commentStart).trim() === "") {
    const lineFeed = text[commentEnd] === "\r" && text[commentEnd + 1] === "\n" ? 2
      : text[commentEnd] === "\n" || text[commentEnd] === "\r" ? 1
        : 0;
    return span(lineStart, commentEnd + lineFeed);
  }

  let codeEnd = commentStart;
  while (codeEnd > lineStart && (text[codeEnd - 1] === " " || text[codeEnd - 1] === "\t")) codeEnd -= 1;
  return span(codeEnd, commentEnd);
}
