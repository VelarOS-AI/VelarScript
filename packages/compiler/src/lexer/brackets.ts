/**
 * Bracket nesting: what an open bracket suspends (newlines and indentation are
 * insignificant inside one), and the recovery when a bracket is never closed —
 * without which one mistyped `(` swallowed every declaration below it.
 *
 * D115 §三 / D114 R1f: the bracket half of `lexer.ts`.
 */
import { diagnostic, type Diagnostic } from "../diagnostic.ts";
import { span, type Span } from "../source.ts";
import { type Token } from "../token.ts";

// D90 (compiler-front-14): the words that open a declaration or a statement.
// A physical line inside an open bracket that begins with one of these, at or
// below the indentation of the line that opened the bracket, is the evidence
// that the bracket was never closed rather than still being filled in.
const statementHeadWords = new Set([
  "export", "def", "class", "const", "let", "enum", "import", "return",
  "if", "for", "while", "match", "type",
]);

// What may stand after one of those words when the line is *not* a statement
// head: a record key's ':', the separators and closers that finish a read of a
// binding named `type` or `match`, the '=' of a named argument written
// `type=1`, and the '.' of a member step. None of them can follow a real
// declaration keyword, so withholding recovery on them refuses nothing.
const statementReadFollowers = new Set([":", ",", ")", "]", "}", "=", "."]);

/** Everything this half of the lexer asks of the scanner that hosts it, and nothing more. */
export interface BracketNestingHost {
  atLineStart: boolean;
  readonly bracketFragment: boolean;
  readonly diagnostics: { push(...reports: readonly Diagnostic[]): void };
  index: number;
  isIdentifierPart(character: string): boolean;
  lineStart(offset: number): number;
  nesting: number;
  readonly openBrackets: { readonly span: Span; readonly text: string; readonly lineIndent: number; readonly arrowBody: boolean }[];
  skipHorizontalWhitespace(from: number): number;
  readonly text: string;
  readonly tokens: Token[];
}

export class BracketNesting {
  private readonly host: BracketNestingHost;

  constructor(host: BracketNestingHost) {
    this.host = host;
  }

  /**
   * D90 (compiler-front-14): an unclosed bracket used to swallow the rest of
   * the module. While `nesting > 0` no newline token is emitted and no
   * indentation is read, so one mistyped `(` turned every declaration below it
   * into a continuation of one logical line — a file of fifty exports became
   * one symbol, and none of the reported diagnostics named the bracket.
   *
   * Recovery is narrow because line breaks inside brackets really are
   * insignificant: `compute(` with its arguments at column 0 is legal and must
   * keep compiling, so indentation alone decides nothing. What decides is a
   * physical line that begins a declaration or a statement — a word no
   * bracketed expression can continue with — at or below the indentation of the
   * line that opened the bracket. An indentation-significant language can read
   * on from there; a brace language cannot.
   */
  recoverUnclosedBrackets(): void {
    const opening = this.host.openBrackets[0];
    if (opening === undefined) return;
    let cursor = this.host.index;
    let width = 0;
    while (cursor < this.host.text.length && (this.host.text[cursor] === " " || this.host.text[cursor] === "\t")) {
      width += this.host.text[cursor] === "\t" ? 4 : 1;
      cursor += 1;
    }
    // An arrow body's statements are the parser's to report: VEL2030 names the
    // remedy, and a '}' one line down means the bracket was never unclosed in
    // the first place. Recovering here would trade a teaching diagnostic for a
    // structural one.
    if (opening.arrowBody) return;
    if (width > opening.lineIndent) return;
    let end = cursor;
    while (end < this.host.text.length && this.host.isIdentifierPart(this.host.text[end] ?? "")) end += 1;
    if (!statementHeadWords.has(this.host.text.slice(cursor, end))) return;
    // Two of those words are ordinary names as well — `type` and `match` are
    // contextual keywords the charter keeps available (section 3) — and any of
    // them may spell a record key. What follows the word tells a declaration
    // from a read: a declaration continues with its subject (`type Name =`,
    // `match value:`, `const x`), while a read is finished, so the next thing
    // it can carry is the punctuation that separates or closes it. A statement
    // head is never followed by one of those, which is what makes withholding
    // on them cost nothing.
    if (statementReadFollowers.has(this.host.text[this.host.skipHorizontalWhitespace(end)] ?? "")) return;

    this.host.diagnostics.push(diagnostic(
      "VEL1003",
      `Unclosed '${opening.text}'; the line below it starts a new declaration, so VelarScript reads on from there rather than to the end of the module`,
      opening.span,
    ));
    this.host.openBrackets.length = 0;
    this.host.nesting = 0;
    this.host.tokens.push({ kind: "newline", value: "", span: span(this.host.index, this.host.index) });
    this.host.atLineStart = true;
  }

  openBracket(start: number): void {
    this.host.nesting += 1;
    if (this.host.bracketFragment) return;
    const lineStart = this.host.lineStart(start);
    let width = 0;
    for (let cursor = lineStart; cursor < start; cursor += 1) {
      if (this.host.text[cursor] === " ") width += 1;
      else if (this.host.text[cursor] === "\t") width += 4;
      else break;
    }
    // A '{' straight after '=>' is an arrow body, and a statement inside one is
    // exactly what VEL2030 exists to report — a message that names the fix
    // ("move multi-statement logic into a named 'def'") where VEL1003 only
    // reports structure. Recovery yields to it; see recoverUnclosedBrackets.
    // The '{' token is pushed by the caller before this runs, so the arrow — if
    // there is one — sits one further back.
    const arrowBody = (this.host.text[start] ?? "") === "{" && this.host.tokens[this.host.tokens.length - 2]?.kind === "fatArrow";
    this.host.openBrackets.push({ span: span(start, start + 1), text: this.host.text[start] ?? "(", lineIndent: width, arrowBody });
  }

  closeBracket(): void {
    this.host.nesting = Math.max(0, this.host.nesting - 1);
    this.host.openBrackets.pop();
  }

  /**
   * Whether a bracket opened on this physical line is still open at the
   * comment. This is the "syntactically complete" half of A1's trigger that
   * `nesting` was standing in for: `nesting` also counts a bracket opened three
   * lines up, whose text before the `//` is complete all the same.
   */
  hasBracketOpenedOnLine(lineStart: number): boolean {
    const innermost = this.host.openBrackets.at(-1);
    return innermost !== undefined && innermost.span.start >= lineStart;
  }
}
