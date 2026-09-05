/**
 * The three comment spellings: `//` to the end of the line, `/* … *' + '/` across
 * lines, and the `#` a Python author reaches for. A comment is also where a
 * `velar-allow` suppression is written, so this is where they are collected.
 *
 * D115 §三 / D114 R1f: the comment half of `lexer.ts`.
 */
import { scanAdvisorySuppressions, type AdvisorySuppression } from "../advisory-suppression.ts";
import { diagnostic, mechanicalFix, recoveredDiagnostic, type Diagnostic } from "../diagnostic.ts";
import { span } from "../source.ts";
import { type Token } from "../token.ts";

/** Everything this half of the lexer asks of the scanner that hosts it, and nothing more. */
export interface CommentScannerHost {
  advance(): string;
  adviseFloorDivisionComment(start: number, bodyStart: number, contentEnd: number): void;
  readonly diagnostics: { push(...reports: readonly Diagnostic[]): void };
  index: number;
  isAtEnd(): boolean;
  lineEnd(from: number): number;
  lineStart(offset: number): number;
  peek(offset?: number): string;
  readonly suppressions: AdvisorySuppression[];
  readonly text: string;
  readonly tokens: Token[];
}

export class CommentScanner {
  private readonly host: CommentScannerHost;

  constructor(host: CommentScannerHost) {
    this.host = host;
  }

  // D89: a line comment carries no token, but it may carry a `velar-allow`
  // suppression, so its text is read once here. A malformed suppression is a
  // diagnostic rather than an advisory: an unreasoned one may not pass.
  readComment(): void {
    const start = this.host.index;
    const bodyStart = this.host.text.startsWith("//", start) ? start + 2 : start;
    while (!this.host.isAtEnd() && this.host.peek() !== "\n" && this.host.peek() !== "\r") {
      this.host.advance();
    }
    const scanned = scanAdvisorySuppressions(this.host.text, start, bodyStart, this.host.index);
    this.host.suppressions.push(...scanned.suppressions);
    this.host.diagnostics.push(...scanned.diagnostics);
    if (bodyStart !== start) this.host.adviseFloorDivisionComment(start, bodyStart, scanned.contentEnd);
  }

  readBlockComment(): void {
    const start = this.host.index;
    const openingLineStart = this.host.lineStart(start);
    const openingStandalone = this.host.text.slice(openingLineStart, start).trim().length === 0;
    this.host.index += 2;
    let depth = 1;
    let firstNewline = -1;
    while (!this.host.isAtEnd() && depth > 0) {
      if (this.host.text.startsWith("/*", this.host.index)) {
        depth += 1;
        this.host.index += 2;
      } else if (this.host.text.startsWith("*/", this.host.index)) {
        depth -= 1;
        this.host.index += 2;
      } else {
        if (firstNewline < 0 && (this.host.peek() === "\n" || this.host.peek() === "\r")) firstNewline = this.host.index;
        this.host.advance();
      }
    }
    if (depth > 0) {
      this.host.diagnostics.push(diagnostic("VEL1003", "Unterminated block comment; close it with '*/'", span(start, this.host.index)));
      return;
    }
    if (firstNewline < 0) return;

    const closeStart = this.host.index - 2;
    const closingLineStart = this.host.lineStart(closeStart);
    const closingPrefixEmpty = this.host.text.slice(closingLineStart, closeStart).trim().length === 0;
    let closingLineEnd = this.host.index;
    while (closingLineEnd < this.host.text.length && this.host.text[closingLineEnd] !== "\n" && this.host.text[closingLineEnd] !== "\r") closingLineEnd += 1;
    const closingSuffixEmpty = this.host.text.slice(this.host.index, closingLineEnd).trim().length === 0;
    const openingSuffixEmpty = this.host.text.slice(start + 2, firstNewline).trim().length === 0;
    if (!openingStandalone || !openingSuffixEmpty || !closingPrefixEmpty || !closingSuffixEmpty) {
      this.host.diagnostics.push(diagnostic(
        "VEL1010",
        "A multiline block comment must occupy whole lines: write only '/*' on its opening line and only '*/' on its closing line",
        span(start, this.host.index),
      ));
    }
  }

  blockCommentOwnsLine(): boolean {
    if (this.host.peek() !== "/" || this.host.peek(1) !== "*") return false;
    let cursor = this.host.index + 2;
    let depth = 1;
    while (cursor < this.host.text.length && this.host.text[cursor] !== "\n" && this.host.text[cursor] !== "\r") {
      if (this.host.text.startsWith("/*", cursor)) {
        depth += 1;
        cursor += 2;
      } else if (this.host.text.startsWith("*/", cursor)) {
        depth -= 1;
        cursor += 2;
        if (depth === 0) return this.host.text.slice(cursor, this.host.lineEnd(cursor)).trim().length === 0;
      } else {
        cursor += 1;
      }
    }
    return true;
  }

  // A '#' that starts a line is a Python-style comment: it receives "use //"
  // guidance and the rest of the line is skipped like a comment, so the
  // commented text never produces its own error cascade. Bare hex colors were
  // already consumed by readHexColor before this check runs.
  readHashComment(start: number): boolean {
    const previous = this.host.tokens.at(-1)?.kind;
    const lineStart = previous === undefined || previous === "newline" || previous === "indent" || previous === "dedent";
    if (!lineStart) return false;
    this.host.diagnostics.push(recoveredDiagnostic("VEL1005", "Use '//' for comments; VelarScript comments start with '//'", span(start, start + 1),
      mechanicalFix(span(start, start + 1), "//", "Use '//' to start the comment")));
    this.host.index = start;
    this.host.advance();
    this.readComment();
    return true;
  }
}
