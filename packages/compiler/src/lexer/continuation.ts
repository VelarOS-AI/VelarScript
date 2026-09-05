/**
 * What joins two physical lines into one logical line: a leading `.` that
 * continues a call chain, a leading binary operator, and the A1 read-back that
 * decides whether the `//` starting a line is a comment or the floor division
 * a Python author meant.
 *
 * D115 §三 / D114 R1f: the continuation half of `lexer.ts`.
 */
import { advisory, type Advisory } from "../diagnostic.ts";
import { span } from "../source.ts";
import { type Token, type TokenKind } from "../token.ts";
import { lineBoundaryKinds } from "./tokens.ts";

// A logical line may continue onto the next physical line when that line's
// first token is '.' / '?.' member access or a binary operator. The previous
// line must end with a token that can end an expression, so block headers,
// operators, and empty lines never join accidentally.
const chainContinuationEndKinds = new Set<TokenKind>([
  "identifier", "number", "unitNumber", "string", "fstring",
  "true", "false", "null", "super", "rightParen", "rightBracket", "rightBrace",
  "extensionToken", "bang",
]);

// Word operators need a source-word boundary; punctuation operators are
// ordered longest-first so `>>` is not mistaken for `>`, and assignment forms
// such as `+=` never become expression continuations.
const leadingBinaryOperatorWords = new Set(["and", "or", "in", "is"]);
const leadingBinaryOperatorPunctuation = [
  ">>>", "<<", ">>", "??", "==", "!=", "<=", ">=", "|", "^", "&", "<", ">", "+", "-", "*", "/", "%",
] as const;
// D89 A1 reads back the primary expression its comment follows. These are the
// kinds a primary tail is made of outside brackets — names, literals, member
// steps, and the two postfix marks; brackets themselves are matched by depth.
// Anything else ends the walk, which is what keeps the advisory's rewrite from
// reaching across an operator that binds looser than `//` does.
//
// A literal is here for its interior reading, not its final one: `"abc".size`
// and `f"{a}".size` are dividends whose walk passes back through the literal
// on the way to the name that ends them. What may *end* a dividend is the
// narrower question `floorDivisionDividendEndKinds` answers.
const primaryTailKinds = new Set<TokenKind>([
  "identifier", "number", "unitNumber", "string", "fstring", "extensionToken",
  "true", "false", "null", "super", "dot", "optionalDot", "bang",
]);

// D90: the token a floor-division mistake can actually stand on. A1 used to
// borrow `chainContinuationEndKinds`, which answers a different question — a
// string, an f-string, `true`, `false`, `null`, `super` and a record's `}` all
// end an expression that a leading-dot line may continue, and none of them can
// be divided, so `const s = "x" // 2` drew an advisory suggesting
// `("x" / 2).floor()`, which the author cannot act on. D89 admits an advisory
// only when its trigger narrows to near-zero false positives, which makes that
// disqualifying. What remains: a name, a plain numeric literal, `)` closing a
// call or a group, `]` closing an index (`xs[0] // 2`), and `!` closing a
// required-value unwrap (`total! // 2`).
//
// A unit number is not here either. `10s` is a Duration, `(10s / 2).floor()`
// does not typecheck (Duration has no `floor`), and nobody reaches for Python's
// floor division on a duration literal — so the rewrite would be one the author
// cannot use, which is the same disqualification the string tail carried.
const floorDivisionDividendEndKinds = new Set<TokenKind>([
  "identifier", "number", "rightParen", "rightBracket", "bang",
]);
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
/**
 * D89 A1's comment body, split into what Python's `//` would have divided by
 * and what it would have gone on to do. `//` binds as tightly as `*`, so the
 * Python author who wrote `total // 2 + 3` divided by 2 and *then* added 3.
 * Both readings that came before this were wrong: quoting the body verbatim
 * gave `(total / 2 + 3).floor()`, and wrapping the whole body gave
 * `(total / (2 + 3)).floor()`, which for `total = 10` answers 2 where Python
 * answers 8. The divisor is the leading primary alone — a number or an
 * already-parenthesised group — and the tail is re-emitted after `.floor()`,
 * where it binds exactly as it did after Python's `//`.
 *
 * `null` withholds the advisory. D89's admission bar, item 4, requires that a
 * zero-cost rewrite exist and that the advisory name that one unambiguous
 * spelling, which makes an advisory that cannot name a correct rewrite
 * inadmissible. A body this cannot translate by a single substitution therefore
 * reports nothing at all: unbalanced parentheses (`// 2)` is as
 * likely a stray keystroke as a divisor), a body that does not open with a
 * primary (`// 2 3` does not parse either way), a tail that is not one
 * arithmetic step (`+`, `-`, `*` and then something), and a second `/` or `%`
 * anywhere in the tail — a second floor division or a modulo cannot be
 * expressed by one substitution, and `//` inside the suggested text would open
 * a comment in the very line it is telling the author to write. Silence is the
 * safe half of that trade; a wrong suggestion is a new defect.
 */
function floorDivisionRewrite(body: string): { readonly divisor: string; readonly tail: string } | null {
  let depth = 0;
  let primaryEnd = -1;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "(") depth += 1;
    else if (body[index] === ")") {
      depth -= 1;
      if (depth < 0) return null;
      if (depth === 0 && primaryEnd < 0 && body.startsWith("(")) primaryEnd = index + 1;
    }
  }
  if (depth !== 0) return null;
  if (!body.startsWith("(")) {
    const primary = /^[0-9]+(?:\.[0-9]+)?/u.exec(body);
    if (primary === null) return null;
    primaryEnd = primary[0].length;
  }

  const divisor = body.slice(0, primaryEnd);
  if (divisor.includes("//")) return null;
  const rest = body.slice(primaryEnd).trim();
  if (rest === "") return { divisor, tail: "" };
  if (!/^[+\-*]\s*\S/u.test(rest) || rest.includes("/") || rest.includes("%")) return null;
  return { divisor, tail: ` ${rest[0]} ${rest.slice(1).trim().replace(/\s+/gu, " ")}` };
}

/** Everything this half of the lexer asks of the scanner that hosts it, and nothing more. */
export interface LineContinuationHost {
  readonly advisories: Advisory[];
  readonly bracketFragment: boolean;
  hasBracketOpenedOnLine(start: number): boolean;
  readonly index: number;
  isIdentifierPart(character: string): boolean;
  isIdentifierStart(character: string): boolean;
  lineStart(offset: number): number;
  readonly logicalLineIndent: number;
  peek(offset?: number): string;
  readonly text: string;
  readonly tokens: Token[];
}

export class LineContinuation {
  private readonly host: LineContinuationHost;

  constructor(host: LineContinuationHost) {
    this.host = host;
  }

  /** The width of a leading member step, or 0 where the line does not open with one. */
  leadingDotWidth(): number {
    const width = this.host.peek() === "." ? 1 : this.host.peek() === "?" && this.host.peek(1) === "." ? 2 : 0;
    // '.5' is a decimal literal with its leading digit missing, not a member
    // step, and it carries its own diagnostic.
    return width > 0 && this.host.isIdentifierStart(this.host.peek(width)) ? width : 0;
  }

  /** The binary operator starting this physical line, or null for a statement head. */
  leadingBinaryOperator(): string | null {
    if (this.host.isIdentifierStart(this.host.peek())) {
      let end = this.host.index + 1;
      while (this.host.isIdentifierPart(this.host.text[end] ?? "\0")) end += 1;
      const word = this.host.text.slice(this.host.index, end);
      if (leadingBinaryOperatorWords.has(word)) return word;
      if (word !== "not") return null;
      while (this.host.text[end] === " " || this.host.text[end] === "\t") end += 1;
      if (!this.host.text.startsWith("in", end) || this.host.isIdentifierPart(this.host.text[end + 2] ?? "\0")) return null;
      return "not in";
    }

    for (const operator of leadingBinaryOperatorPunctuation) {
      if (!this.host.text.startsWith(operator, this.host.index)) continue;
      const following = this.host.text[this.host.index + operator.length] ?? "";
      if ((operator === "+" || operator === "-" || operator === "*" || operator === "/" || operator === "%" || operator === "|" || operator === "^" || operator === "&")
        && following === "=") return null;
      if (operator === "*" && following === "*") return null;
      if (operator === "/" && (following === "/" || following === "*")) return null;
      return operator;
    }
    return null;
  }

  /**
   * Whether the leading continuation line at `width` joins the line above it. Two
   * conditions, and the file's own contract has always claimed both:
   *
   * - It is the *next* line. The backward walk used to skip an unbounded run of
   *   `newline` tokens, so a chain joined a value that appeared any number of
   *   blank lines and whole-line comments earlier — the case the header comment
   *   says "never join accidentally" (D90, compiler-front-10). One `newline`
   *   token is the line that ended the statement; a second is a blank or
   *   comment line, and the statement ended there.
   * - It is indented past the statement it continues. The charter called the
   *   deeper indentation canonical and nothing enforced it, so a column-0
   *   `.sorted()` dedented out of a function body and silently became part of
   *   it. `logicalLineIndent` is the *statement's* indentation rather than the
   *   previous physical line's, so every line of one chain answers to one rule.
   */
  isChainContinuation(width: number): boolean {
    const index = this.host.tokens.length - 1;
    if (this.host.tokens[index]?.kind !== "newline") return false;
    if (this.host.tokens[index - 1]?.kind === "newline") return false;
    const previous = this.host.tokens[index - 1];
    if (previous === undefined || !chainContinuationEndKinds.has(previous.kind)) return false;
    return width > this.host.logicalLineIndent;
  }

  /**
   * D89 A1: `//` is VelarScript's only comment spelling, so a Python author's
   * floor division reads as a finished line followed by a comment and the
   * compiler has nothing to object to. `#` cannot take the comment role over:
   * of the branches the `#` dispatch reads (`readJavaScriptPrivateIdentifier`,
   * `readHexColor`, `readHashComment`), `readHexColor` carries bare
   * hexadecimal colors — a hot path in a language with `look:` — and a `#`
   * that opened a comment would swallow `#ff0000` and the rest of its line
   * instead of guiding it to the quoted spelling. With no comment spelling
   * left to give up, an advisory is the only remaining move.
   *
   * The trigger is narrow on both sides. D89 asks for a syntactically complete
   * expression or assignment ahead of the `//`, which here means three things:
   * the line carries code, every bracket *this physical line* opened is closed
   * before the comment (an unclosed one leaves the line unfinished, so
   * `print(   // 2` is silent), and the last token can end a dividend. The
   * bracket test counts opens and closes on the line itself rather than reading
   * `nesting`: a bracket opened on an earlier line and closed on a later one
   * leaves the text before `//` complete, so `print(` / `    total // 2` / `)`
   * is exactly the mistake this advisory exists for and used to compile in
   * silence (D90). The comment's own text — with any `velar-allow` clause
   * removed, which is what `contentEnd` is for — must then be a bare arithmetic
   * body carrying a digit and no letter anywhere, so `// TODO`,
   * `// 2. then handle X`, a bare `//`, and a whole-line comment are all
   * silent.
   *
   * A bracket fragment is exempt because its lexer holds the fragment's text
   * rather than the module's: `lineStart` there answers with the fragment's own
   * beginning, and "the rest of this line is a comment" would be a claim about
   * an interpolation rather than about a physical line.
   *
   * No mechanical fix is registered: deciding that the comment really was a
   * divisor is the judgment D38 §48 keeps out of the fix registry.
   */
  adviseFloorDivisionComment(start: number, bodyStart: number, contentEnd: number): void {
    if (this.host.bracketFragment) return;
    const lineStart = this.host.lineStart(start);
    if (this.host.text.slice(lineStart, start).trim() === "") return;
    const previous = this.host.tokens.at(-1);
    if (!previous || previous.span.end <= lineStart || !floorDivisionDividendEndKinds.has(previous.kind)) return;
    if (this.host.hasBracketOpenedOnLine(lineStart)) return;
    const body = this.host.text.slice(bodyStart, contentEnd).trim();
    if (!/[0-9]/u.test(body) || !/^[0-9\s+\-*/%()]+$/u.test(body)) return;
    const division = floorDivisionRewrite(body);
    if (division === null) return;

    const dividend = this.dividendBeforeComment(lineStart, start);
    if (!dividend) return;
    const rewrite = `(${dividend.value} / ${division.divisor}).floor()${division.tail}`;
    this.host.advisories.push(advisory(
      "A1",
      dividend.target === null
        ? `'//' is VelarScript's comment spelling, so the rest of this line is a comment and nothing divides '${dividend.value}'; write '${rewrite}' for Python's floor division`
        : `'//' is VelarScript's comment spelling, so '${dividend.target}' receives '${dividend.value}' and the rest of this line is a comment; write '${rewrite}' for Python's floor division`,
      span(start, contentEnd),
    ));
  }

  /**
   * What Python's `//` would have divided: the primary expression the comment
   * follows, read back from the source so the advisory quotes the author's own
   * spelling. The walk stops at the first operator or keyword outside brackets,
   * because `//` binds as tightly as `*` — in `a + b // 2` the dividend is `b`,
   * and naming `a + b` would hand back a rewrite that changes the result.
   *
   * A leading unary sign belongs to the dividend. Python's `-7 // 2` is -4, so
   * quoting `7` and suggesting `(7 / 2).floor()` — which answers 3 — is the same
   * class of wrong rewrite the divisor side used to hand back. The sign is unary
   * exactly when nothing that could end an operand stands in front of it, which
   * keeps the binary reading in `a - 7 // 2`, where the dividend is still `7`.
   *
   * `target` is the name the value lands in, and only a plain `=` produces one:
   * a compound assignment reads its target as well as writing it, so calling it
   * the receiver would be a second claim this advisory has not checked.
   */
  private dividendBeforeComment(lineStart: number, commentStart: number): { readonly target: string | null; readonly value: string } | null {
    let index = this.host.tokens.length - 1;
    let depth = 0;
    while (index >= 0 && this.host.tokens[index]!.span.end > lineStart) {
      const kind = this.host.tokens[index]!.kind;
      if (kind === "rightParen" || kind === "rightBracket" || kind === "rightBrace") depth += 1;
      else if (kind === "leftParen" || kind === "leftBracket" || kind === "leftBrace") {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0 && !primaryTailKinds.has(kind)) break;
      index -= 1;
    }
    if (depth !== 0) return null;
    const sign = this.host.tokens[index];
    if (sign !== undefined && sign.span.end > lineStart && (sign.kind === "minus" || sign.kind === "plus")) {
      const before = this.host.tokens[index - 1];
      const operandStandsBefore = before !== undefined
        && before.span.end > lineStart
        && !lineBoundaryKinds.has(before.kind)
        && (floorDivisionDividendEndKinds.has(before.kind) || before.kind === "rightBrace");
      if (!operandStandsBefore) index -= 1;
    }

    const first = this.host.tokens[index + 1];
    if (!first || first.span.end <= lineStart) return null;
    // A leading-dot continuation line holds only the tail of its dividend: the
    // walk is bounded by this physical line, so on `const c = xs` / `.size // 2`
    // it stops at the line's own first token, the `.`. Quoting from there gave
    // `'.size'` and suggested `(.size / 2).floor()`, which does not parse. The
    // head lives on a line this advisory does not read, so there is no rewrite
    // to name and D89's admission bar withholds the advisory (D90).
    if (first.kind === "dot" || first.kind === "optionalDot") return null;
    const value = this.host.text.slice(first.span.start, commentStart).trim();
    if (value === "") return null;
    const boundary = this.host.tokens[index];
    const name = this.host.tokens[index - 1];
    const assigned = boundary !== undefined && boundary.span.end > lineStart && boundary.kind === "assign";
    return { target: assigned && name?.kind === "identifier" ? name.value : null, value };
  }
}
