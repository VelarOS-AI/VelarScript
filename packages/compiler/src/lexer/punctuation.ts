/**
 * The punctuation half of the scan: the delimiters that open and close a
 * nesting, the separators that stand between two things, the operators, and
 * the two characters left over. Each family answers for the characters it
 * claims in the order the switch it came from read them, and hands the rest to
 * the next one, so a character reaches exactly the arm it always did.
 *
 * D115 §三 / D114 R1f: `lexer.ts` keeps the loop, the budgets and the cascade
 * of shape scanners; this is the character switch that was the rest of `lex`.
 */
import { mechanicalFix, recoveredDiagnostic, type Diagnostic, type DiagnosticFix } from "../diagnostic.ts";
import { span } from "../source.ts";
import { type TokenKind } from "../token.ts";

/** Everything this half of the lexer asks of the scanner that hosts it, and nothing more. */
export interface PunctuationScannerHost {
  advance(): string;
  closeBracket(): void;
  readonly diagnostics: { push(...reports: readonly Diagnostic[]): void };
  invalidCharacter(character: string, start: number): void;
  isDigit(character: string): boolean;
  openBracket(start: number): void;
  operator(single: TokenKind, compound: TokenKind, start: number): void;
  peek(distance?: number): string;
  readHashComment(start: number): boolean;
  readHexColor(start: number): boolean;
  readJavaScriptPrivateIdentifier(start: number): boolean;
  readLeadingDotNumber(): void;
  simple(kind: TokenKind, start: number, length: number): void;
  trailingSemicolonFix(start: number): DiagnosticFix | undefined;
  wordOperatorFix(start: number, end: number, word: string, title: string): DiagnosticFix;
}

export class PunctuationScanner {
  private readonly host: PunctuationScannerHost;

  constructor(host: PunctuationScannerHost) {
    this.host = host;
  }

  /** One punctuation character read as the token it spells, or refused as invalid. */
  readPunctuation(character: string, start: number): void {
    if (this.readDelimiter(character, start)) return;
    if (this.readSeparator(character, start)) return;
    if (this.readOperator(character, start)) return;
    this.readRemaining(character, start);
  }

  /** The three bracket pairs, each also moving the nesting the rest of the scan reads. */
  private readDelimiter(character: string, start: number): boolean {
    switch (character) {
      case "(":
        this.host.simple("leftParen", start, 1);
        this.host.openBracket(start);
        break;
      case ")":
        this.host.simple("rightParen", start, 1);
        this.host.closeBracket();
        break;
      case "[":
        this.host.simple("leftBracket", start, 1);
        this.host.openBracket(start);
        break;
      case "]":
        this.host.simple("rightBracket", start, 1);
        this.host.closeBracket();
        break;
      case "{":
        this.host.simple("leftBrace", start, 1);
        this.host.openBracket(start);
        break;
      case "}":
        this.host.simple("rightBrace", start, 1);
        this.host.closeBracket();
        break;
      default:
        return false;
    }
    return true;
  }

  /** What stands between two things: ':', ';', ',', '@', '.' and '?'. */
  private readSeparator(character: string, start: number): boolean {
    switch (character) {
      case ":":
        if (this.host.peek(1) === "=") {
          // ':=' reads as the walrus operator to authors from the father
          // language; recovery as '=' keeps 'x := 5' one diagnostic.
          this.host.diagnostics.push(recoveredDiagnostic("VEL1005", "VelarScript has no ':=' binding operator; declare with 'const x = ...' or assign with 'x = ...'", span(start, start + 2)));
          this.host.simple("assign", start, 2);
        } else {
          this.host.simple("colon", start, 1);
        }
        break;
      case ";":
        this.host.diagnostics.push(recoveredDiagnostic(
          "VEL1005",
          "A statement ends at its newline; VelarScript does not use ';'",
          span(start, start + 1),
          // Only a semicolon the line ends with is mechanical: deleting it
          // leaves the same one statement. A semicolon between two
          // statements asks for a line break instead, which is a change of
          // layout rather than of spelling, so it stays advice.
          this.host.trailingSemicolonFix(start),
        ));
        this.host.advance();
        break;
      case ",":
        this.host.simple("comma", start, 1);
        break;
      // '@' has one job: qualify the next name into the compiler-owned
      // namespace of the current syntax context. It is not an identifier
      // character, so compiler roles cannot collide with author names.
      case "@":
        this.host.simple("at", start, 1);
        break;
      case ".":
        if (this.host.isDigit(this.host.peek(1))) {
          this.host.readLeadingDotNumber();
        } else if (this.host.peek(1) === "." && this.host.peek(2) === ".") {
          this.host.simple("ellipsis", start, 3);
        } else {
          this.host.simple("dot", start, 1);
        }
        break;
      case "?":
        if (this.host.peek(1) === ".") {
          this.host.simple("optionalDot", start, 2);
        } else if (this.host.peek(1) === "?") {
          this.host.simple("nullish", start, 2);
        } else {
          this.host.simple("question", start, 1);
        }
        break;
      default:
        return false;
    }
    return true;
  }

  /** The arithmetic, comparison, bitwise and logical operators, with the guidance the refused spellings carry. */
  private readOperator(character: string, start: number): boolean {
    switch (character) {
      case "+":
        this.host.operator("plus", "plusAssign", start);
        break;
      case "-":
        if (this.host.peek(1) === ">") {
          this.host.simple("arrow", start, 2);
        } else {
          this.host.operator("minus", "minusAssign", start);
        }
        break;
      case "*":
        if (this.host.peek(1) === "*") this.host.simple("starStar", start, 2);
        else this.host.operator("star", "starAssign", start);
        break;
      case "/":
        this.host.operator("slash", "slashAssign", start);
        break;
      case "%":
        this.host.operator("percent", "percentAssign", start);
        break;
      case "=":
        if (this.host.peek(1) === ">") {
          this.host.simple("fatArrow", start, 2);
        } else if (this.host.peek(1) === "=" && this.host.peek(2) === "=") {
          this.host.diagnostics.push(recoveredDiagnostic("VEL1005", "Use '=='; equality is already strict in VelarScript", span(start, start + 3),
            mechanicalFix(span(start, start + 3), "==", "Use VelarScript strict equality '=='")));
          this.host.simple("equal", start, 3);
        } else {
          this.host.simple(this.host.peek(1) === "=" ? "equal" : "assign", start, this.host.peek(1) === "=" ? 2 : 1);
        }
        break;
      case "!":
        if (this.host.peek(1) === "=" && this.host.peek(2) === "=") {
          // D86 rule 212: `!=` keeps winning by longest match, so `!==` is
          // the one spelling the required-value unwrap cannot claim. The
          // JavaScript reading is the common one and keeps the fix; the
          // message names the other reading so an author who meant the
          // unwrap learns that `==` needs its space.
          this.host.diagnostics.push(recoveredDiagnostic("VEL1005",
            "Use '!='; inequality is already strict in VelarScript — and if the '!' unwraps the value before it, give '==' its space: 'value! == other'",
            span(start, start + 3),
            mechanicalFix(span(start, start + 3), "!=", "Use VelarScript strict inequality '!='")));
          this.host.simple("notEqual", start, 3);
        } else if (this.host.peek(1) === "=") {
          this.host.simple("notEqual", start, 2);
        } else {
          // D86 rule 212: `!` reads as the required-value unwrap after an
          // operand and as JavaScript negation before one, and only the
          // parser knows which position this is. The guidance for the
          // negation reading therefore moves to the parser; `!=` still wins
          // by longest match above, so `x! == y` needs its space.
          this.host.simple("bang", start, 1);
        }
        break;
      case "&":
        if (this.host.peek(1) === "&") {
          this.host.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'and'; VelarScript uses readable logical operators", span(start, start + 2),
            this.host.wordOperatorFix(start, start + 2, "and", "Use readable 'and'")));
          this.host.simple("and", start, 2);
        } else this.host.operator("amp", "bitAndAssign", start);
        break;
      case "^":
        this.host.operator("caret", "bitXorAssign", start);
        break;
      case "~":
        this.host.simple("tilde", start, 1);
        break;
      case "<":
        if (this.host.peek(1) === "<") this.host.simple(this.host.peek(2) === "=" ? "leftShiftAssign" : "leftShift", start, this.host.peek(2) === "=" ? 3 : 2);
        else this.host.simple(this.host.peek(1) === "=" ? "lessEqual" : "less", start, this.host.peek(1) === "=" ? 2 : 1);
        break;
      case ">":
        if (this.host.peek(1) === ">" && this.host.peek(2) === ">") this.host.simple(this.host.peek(3) === "=" ? "unsignedRightShiftAssign" : "unsignedRightShift", start, this.host.peek(3) === "=" ? 4 : 3);
        else if (this.host.peek(1) === ">") this.host.simple(this.host.peek(2) === "=" ? "rightShiftAssign" : "rightShift", start, this.host.peek(2) === "=" ? 3 : 2);
        else this.host.simple(this.host.peek(1) === "=" ? "greaterEqual" : "greater", start, this.host.peek(1) === "=" ? 2 : 1);
        break;
      case "|":
        if (this.host.peek(1) === "|") {
          this.host.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'or'; VelarScript uses readable logical operators", span(start, start + 2),
            this.host.wordOperatorFix(start, start + 2, "or", "Use readable 'or'")));
          this.host.simple("or", start, 2);
        } else this.host.operator("pipe", "bitOrAssign", start);
        break;
      default:
        return false;
    }
    return true;
  }

  /** '#', which four scanners compete for, and every character none of them claims. */
  private readRemaining(character: string, start: number): void {
    switch (character) {
      case "#":
        if (this.host.readJavaScriptPrivateIdentifier(start)) break;
        if (this.host.readHexColor(start)) break;
        if (this.host.readHashComment(start)) break;
        this.host.invalidCharacter(character, start);
        break;
      default:
        this.host.invalidCharacter(character, start);
        break;
    }
  }
}
