import { diagnostic, mechanicalFix, recoveredDiagnostic, type Diagnostic, type DiagnosticFix } from "./diagnostic.ts";
import type { CompilerLexicalExtension } from "./extension.ts";
import { findInterpolatedExpressionEnd, scanStringEscape, scanStringLiteral, type StringLiteralScan, type StringTokenPayload } from "./interpolated-string.ts";
import { forbiddenSourceIdentifiers, isForbiddenPrototypeMember, isSourceIdentifierPart, isSourceIdentifierStart } from "./source-names.ts";
import { span } from "./source.ts";
import { keywordKinds, type Token, type TokenKind } from "./token.ts";
const MAX_TOKENS = 250000;
const MAX_NESTING = 512;
const bidirectionalControls = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

// A logical line may continue onto the next physical line when that line's
// first token is '.' or '?.' member access (a leading-dot method chain). The
// previous line must end with a token that can end an expression, so block
// headers, operators, and empty lines never join accidentally.
const chainContinuationEndKinds = new Set<TokenKind>([
  "identifier", "number", "unitNumber", "string", "fstring",
  "true", "false", "null", "super", "rightParen", "rightBracket", "rightBrace",
  "extensionToken",
]);

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

export class Lexer {
  private readonly text: string;
  private readonly extensionForbiddenIdentifiers = new Map<string, string>();
  private readonly extensionScanners: NonNullable<CompilerLexicalExtension["scan"]>[] = [];
  // D39-52: milliseconds and seconds are Core duration literals. Extensions
  // may add visual units, but Core owns these two spellings.
  private readonly numericSuffixes = new Set<string>(["ms", "s"]);
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];
  private readonly diagnosedBidirectionalOffsets = new Set<number>();
  private readonly indentStack = [0];
  private index = 0;
  private atLineStart = true;
  private nesting = 0;
  // A bracket fragment is an expression lexed inside an enclosing bracket
  // context, such as an extension-owned bracket interpolation: newlines are insignificant
  // and physical-line indentation never opens or closes blocks, exactly as
  // between ordinary parentheses.
  private readonly bracketFragment: boolean;
  private readonly scanSourceHygiene: boolean;

  constructor(
    text: string,
    extensions: readonly CompilerLexicalExtension[] = [],
    options: { readonly bracketFragment?: boolean; readonly scanSourceHygiene?: boolean } = {},
  ) {
    this.text = text;
    this.bracketFragment = options.bracketFragment ?? false;
    this.scanSourceHygiene = options.scanSourceHygiene ?? true;
    for (const extension of extensions) {
      for (const [name, guidance] of Object.entries(extension.forbiddenIdentifiers ?? {})) {
        this.extensionForbiddenIdentifiers.set(name, guidance);
      }
      for (const suffix of extension.numericSuffixes ?? []) this.numericSuffixes.add(suffix);
      if (extension.scan) this.extensionScanners.push(extension.scan);
    }
  }

  lex(): LexResult {
    if (this.scanSourceHygiene) this.diagnoseForbiddenSourceCharacters();
    while (!this.isAtEnd()) {
      if (this.tokens.length >= MAX_TOKENS) {
        this.diagnostics.push(diagnostic("VEL1005", `A VelarScript module cannot exceed ${MAX_TOKENS} tokens`, span(this.index, this.index)));
        this.index = this.text.length;
        break;
      }
      if (this.nesting > MAX_NESTING) {
        this.diagnostics.push(diagnostic("VEL1006", `Delimiter nesting cannot exceed ${MAX_NESTING} levels`, span(this.index, this.index)));
        this.index = this.text.length;
        break;
      }
      if (this.atLineStart && this.nesting === 0 && !this.bracketFragment) {
        this.readIndentation();
      }

      if (this.isAtEnd()) {
        break;
      }

      const start = this.index;
      const character = this.peek();

      if (character === " " || character === "\t") {
        this.advance();
        continue;
      }

      if (character === "\n" || character === "\r") {
        this.readNewline();
        continue;
      }

      if (character === "/" && this.peek(1) === "/") {
        this.readComment();
        continue;
      }

      if (character === "/" && this.peek(1) === "*") {
        this.readBlockComment();
        continue;
      }

      if (this.readExtensionToken()) continue;

      // A raw inline string may legally start with a doubled delimiter:
      // r"""quoted"" text". Prefer that unambiguous current spelling over
      // the removed triple-quote migration scanner.
      const rawString = scanStringLiteral(this.text, start);
      if (rawString?.raw && rawString.closed && !rawString.layout) {
        this.readString(rawString);
        continue;
      }

      const legacyTriple = this.legacyTripleQuotePrefix();
      if (legacyTriple) {
        this.readLegacyTripleQuote(legacyTriple);
        continue;
      }

      const string = scanStringLiteral(this.text, start);
      if (string) {
        this.readString(string);
        continue;
      }

      if (this.isIdentifierStart(character)) {
        this.readIdentifier();
        continue;
      }

      if (this.isDigit(character)) {
        this.readNumber();
        continue;
      }

      switch (character) {
        case "(":
          this.simple("leftParen", start, 1);
          this.nesting += 1;
          break;
        case ")":
          this.simple("rightParen", start, 1);
          this.nesting = Math.max(0, this.nesting - 1);
          break;
        case "[":
          this.simple("leftBracket", start, 1);
          this.nesting += 1;
          break;
        case "]":
          this.simple("rightBracket", start, 1);
          this.nesting = Math.max(0, this.nesting - 1);
          break;
        case "{":
          this.simple("leftBrace", start, 1);
          this.nesting += 1;
          break;
        case "}":
          this.simple("rightBrace", start, 1);
          this.nesting = Math.max(0, this.nesting - 1);
          break;
        case ":":
          if (this.peek(1) === "=") {
            // ':=' reads as the walrus operator to authors from the father
            // language; recovery as '=' keeps 'x := 5' one diagnostic.
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "VelarScript has no ':=' binding operator; declare with 'const x = ...' or assign with 'x = ...'", span(start, start + 2)));
            this.simple("assign", start, 2);
          } else {
            this.simple("colon", start, 1);
          }
          break;
        case ";":
          this.diagnostics.push(recoveredDiagnostic(
            "VEL1005",
            "A statement ends at its newline; VelarScript does not use ';'",
            span(start, start + 1),
            // Only a semicolon the line ends with is mechanical: deleting it
            // leaves the same one statement. A semicolon between two
            // statements asks for a line break instead, which is a change of
            // layout rather than of spelling, so it stays advice.
            this.trailingSemicolonFix(start),
          ));
          this.advance();
          break;
        case ",":
          this.simple("comma", start, 1);
          break;
        // D43 item 67: '@name' marks a name the language owns, in the very
        // positions where a user's own names also appear — class and component
        // members. '@' is not an identifier character, so the two namespaces
        // cannot collide however the surrounding words are softened.
        case "@":
          this.simple("at", start, 1);
          break;
        case ".":
          if (this.isDigit(this.peek(1))) {
            this.readLeadingDotNumber();
          } else if (this.peek(1) === "." && this.peek(2) === ".") {
            this.simple("ellipsis", start, 3);
          } else {
            this.simple("dot", start, 1);
          }
          break;
        case "?":
          if (this.peek(1) === ".") {
            this.simple("optionalDot", start, 2);
          } else if (this.peek(1) === "?") {
            this.simple("nullish", start, 2);
          } else {
            this.simple("question", start, 1);
          }
          break;
        case "+":
          this.operator("plus", "plusAssign", start);
          break;
        case "-":
          if (this.peek(1) === ">") {
            this.simple("arrow", start, 2);
          } else {
            this.operator("minus", "minusAssign", start);
          }
          break;
        case "*":
          if (this.peek(1) === "*") this.simple("starStar", start, 2);
          else this.operator("star", "starAssign", start);
          break;
        case "/":
          this.operator("slash", "slashAssign", start);
          break;
        case "%":
          this.operator("percent", "percentAssign", start);
          break;
        case "=":
          if (this.peek(1) === ">") {
            this.simple("fatArrow", start, 2);
          } else if (this.peek(1) === "=" && this.peek(2) === "=") {
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use '=='; equality is already strict in VelarScript", span(start, start + 3),
              mechanicalFix(span(start, start + 3), "==", "Use VelarScript strict equality '=='")));
            this.simple("equal", start, 3);
          } else {
            this.simple(this.peek(1) === "=" ? "equal" : "assign", start, this.peek(1) === "=" ? 2 : 1);
          }
          break;
        case "!":
          if (this.peek(1) === "=" && this.peek(2) === "=") {
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use '!='; inequality is already strict in VelarScript", span(start, start + 3),
              mechanicalFix(span(start, start + 3), "!=", "Use VelarScript strict inequality '!='")));
            this.simple("notEqual", start, 3);
          } else if (this.peek(1) === "=") {
            this.simple("notEqual", start, 2);
          } else {
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'not'; VelarScript uses readable logical operators", span(start, start + 1),
              this.wordOperatorFix(start, start + 1, "not", "Use readable 'not'")));
            this.simple("not", start, 1);
          }
          break;
        case "&":
          if (this.peek(1) === "&") {
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'and'; VelarScript uses readable logical operators", span(start, start + 2),
              this.wordOperatorFix(start, start + 2, "and", "Use readable 'and'")));
            this.simple("and", start, 2);
          } else {
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Combine conditions with 'and'; VelarScript has no bitwise '&'", span(start, start + 1)));
            this.simple("and", start, 1);
          }
          break;
        case "^":
          this.diagnostics.push(recoveredDiagnostic("VEL1005", "Write '**' for exponentiation; VelarScript has no bitwise '^'", span(start, start + 1)));
          this.simple("starStar", start, 1);
          break;
        case "<":
          this.simple(this.peek(1) === "=" ? "lessEqual" : "less", start, this.peek(1) === "=" ? 2 : 1);
          break;
        case ">":
          this.simple(this.peek(1) === "=" ? "greaterEqual" : "greater", start, this.peek(1) === "=" ? 2 : 1);
          break;
        case "|":
          if (this.peek(1) === "|") {
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'or'; VelarScript uses readable logical operators", span(start, start + 2),
              this.wordOperatorFix(start, start + 2, "or", "Use readable 'or'")));
            this.simple("or", start, 2);
          } else {
            this.simple("pipe", start, 1);
          }
          break;
        case "#":
          if (this.readJavaScriptPrivateIdentifier(start)) break;
          if (this.readHexColor(start)) break;
          if (this.readHashComment(start)) break;
          this.invalidCharacter(character, start);
          break;
        default:
          this.invalidCharacter(character, start);
          break;
      }
    }

    if (this.tokens.at(-1)?.kind !== "newline") {
      this.tokens.push({ kind: "newline", value: "", span: span(this.index, this.index) });
    }

    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.tokens.push({ kind: "dedent", value: "", span: span(this.index, this.index) });
    }

    this.tokens.push({ kind: "eof", value: "", span: span(this.index, this.index) });
    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  private readIndentation(): void {
    const start = this.index;
    let width = 0;

    while (!this.isAtEnd()) {
      if (this.peek() === " ") {
        width += 1;
        this.advance();
      } else if (this.peek() === "\t") {
        this.diagnostics.push(diagnostic("VEL1002", "Tabs are not allowed for indentation", span(this.index, this.index + 1),
          mechanicalFix(span(this.index, this.index + 1), "    ", "Replace the indentation tab with four spaces")));
        width += 4;
        this.advance();
      } else {
        break;
      }
    }

    const blank = this.peek() === "\n" || this.peek() === "\r" || this.isAtEnd();
    const comment = (this.peek() === "/" && this.peek(1) === "/") || this.blockCommentOwnsLine();
    this.atLineStart = false;

    if (blank || comment) {
      return;
    }

    // A leading-dot line continues the previous logical line: the newline
    // tokens that ended it are withdrawn and this line's indentation does not
    // open or close a block, so '.filter(...)' chains span physical lines.
    if (this.isChainContinuation()) {
      while (this.tokens.at(-1)?.kind === "newline") this.tokens.pop();
      return;
    }

    const current = this.indentStack.at(-1) ?? 0;
    if (width > current) {
      if (this.indentStack.length > MAX_NESTING) {
        this.diagnostics.push(diagnostic("VEL1006", `Indentation nesting cannot exceed ${MAX_NESTING} levels`, span(start, this.index)));
        this.index = this.text.length;
        return;
      }
      this.indentStack.push(width);
      this.tokens.push({ kind: "indent", value: "", span: span(start, this.index) });
      return;
    }

    if (width < current) {
      while (this.indentStack.length > 1 && width < (this.indentStack.at(-1) ?? 0)) {
        this.indentStack.pop();
        this.tokens.push({ kind: "dedent", value: "", span: span(start, this.index) });
      }

      if (width !== (this.indentStack.at(-1) ?? 0)) {
        this.diagnostics.push(diagnostic("VEL1004", "Indentation does not match an outer block", span(start, this.index)));
      }
    }
  }

  private isChainContinuation(): boolean {
    const dotWidth = this.peek() === "." ? 1 : this.peek() === "?" && this.peek(1) === "." ? 2 : 0;
    if (dotWidth === 0 || !this.isIdentifierStart(this.peek(dotWidth))) return false;
    let index = this.tokens.length - 1;
    if (this.tokens[index]?.kind !== "newline") return false;
    while (this.tokens[index]?.kind === "newline") index -= 1;
    const previous = this.tokens[index];
    return previous !== undefined && chainContinuationEndKinds.has(previous.kind);
  }

  private readNewline(): void {
    const start = this.index;
    if (this.peek() === "\r" && this.peek(1) === "\n") {
      this.index += 2;
    } else {
      this.index += 1;
    }

    if (this.nesting === 0 && !this.bracketFragment) {
      this.tokens.push({ kind: "newline", value: "", span: span(start, this.index) });
      this.atLineStart = true;
    }
  }

  private readComment(): void {
    while (!this.isAtEnd() && this.peek() !== "\n" && this.peek() !== "\r") {
      this.advance();
    }
  }

  private readBlockComment(): void {
    const start = this.index;
    const openingLineStart = this.lineStart(start);
    const openingStandalone = this.text.slice(openingLineStart, start).trim().length === 0;
    this.index += 2;
    let depth = 1;
    let firstNewline = -1;
    while (!this.isAtEnd() && depth > 0) {
      if (this.text.startsWith("/*", this.index)) {
        depth += 1;
        this.index += 2;
      } else if (this.text.startsWith("*/", this.index)) {
        depth -= 1;
        this.index += 2;
      } else {
        if (firstNewline < 0 && (this.peek() === "\n" || this.peek() === "\r")) firstNewline = this.index;
        this.advance();
      }
    }
    if (depth > 0) {
      this.diagnostics.push(diagnostic("VEL1003", "Unterminated block comment; close it with '*/'", span(start, this.index)));
      return;
    }
    if (firstNewline < 0) return;

    const closeStart = this.index - 2;
    const closingLineStart = this.lineStart(closeStart);
    const closingPrefixEmpty = this.text.slice(closingLineStart, closeStart).trim().length === 0;
    let closingLineEnd = this.index;
    while (closingLineEnd < this.text.length && this.text[closingLineEnd] !== "\n" && this.text[closingLineEnd] !== "\r") closingLineEnd += 1;
    const closingSuffixEmpty = this.text.slice(this.index, closingLineEnd).trim().length === 0;
    const openingSuffixEmpty = this.text.slice(start + 2, firstNewline).trim().length === 0;
    if (!openingStandalone || !openingSuffixEmpty || !closingPrefixEmpty || !closingSuffixEmpty) {
      this.diagnostics.push(diagnostic(
        "VEL1010",
        "A multiline block comment must occupy whole lines: write only '/*' on its opening line and only '*/' on its closing line",
        span(start, this.index),
      ));
    }
  }

  private blockCommentOwnsLine(): boolean {
    if (this.peek() !== "/" || this.peek(1) !== "*") return false;
    let cursor = this.index + 2;
    let depth = 1;
    while (cursor < this.text.length && this.text[cursor] !== "\n" && this.text[cursor] !== "\r") {
      if (this.text.startsWith("/*", cursor)) {
        depth += 1;
        cursor += 2;
      } else if (this.text.startsWith("*/", cursor)) {
        depth -= 1;
        cursor += 2;
        if (depth === 0) return this.text.slice(cursor, this.lineEnd(cursor)).trim().length === 0;
      } else {
        cursor += 1;
      }
    }
    return true;
  }

  private readIdentifier(): void {
    const start = this.index;
    while (this.isIdentifierPart(this.peek())) {
      this.advance();
    }
    const value = this.text.slice(start, this.index);
    const rule = forbiddenSourceIdentifiers.get(value);
    const extensionGuidance = rule ? undefined : this.extensionForbiddenIdentifiers.get(value);
    const previous = this.tokens.at(-1)?.kind;
    if ((value === "Infinity" || value === "NaN") && previous !== "dot" && previous !== "optionalDot") {
      this.diagnostics.push(diagnostic(
        "VEL1007",
        value === "Infinity"
          ? "Infinity is not a literal in VelarScript; produce it with arithmetic such as 1 / 0"
          : "NaN is not a literal in VelarScript; produce it with arithmetic such as 0 / 0 and detect it with value.isNaN()",
        span(start, this.index),
      ));
      this.tokens.push({ kind: "number", value: "0", span: span(start, this.index) });
      return;
    }
    if (rule) {
      if (rule.recovery) {
        // The rule carries its successor only when the guidance names exactly
        // one ('var' names 'let' or 'const', so it names none).
        this.diagnostics.push(recoveredDiagnostic("VEL1005", rule.guidance, span(start, this.index),
          rule.fix === null ? undefined : mechanicalFix(
            span(start, rule.fix === "" ? this.skipHorizontalWhitespace(this.index) : this.index),
            rule.fix,
            rule.fix === "" ? `Remove '${value}'` : `Use '${rule.fix}'`,
          )));
        for (const item of rule.recovery) {
          this.tokens.push({ kind: item.kind, value: item.value, span: span(start, this.index) });
        }
        return;
      }
      this.diagnostics.push(diagnostic("VEL1005", rule.guidance, span(start, this.index)));
    } else if (extensionGuidance) {
      this.diagnostics.push(diagnostic("VEL1005", extensionGuidance, span(start, this.index)));
    } else if (isForbiddenPrototypeMember(value) && (previous === "dot" || previous === "optionalDot")) {
      this.diagnostics.push(diagnostic("VEL1005", "VelarScript does not expose prototype manipulation", span(start, this.index)));
    }
    const keyword = Object.hasOwn(keywordKinds, value) ? keywordKinds[value] : undefined;
    this.tokens.push({ kind: keyword ?? "identifier", value, span: span(start, this.index) });
  }

  private readNumber(): void {
    const start = this.index;
    const integer = this.readDigitsWithSeparators();
    if (integer.length > 1 && integer.startsWith("0")) {
      this.diagnostics.push(diagnostic(
        "VEL1007",
        "Remove the leading zeros; octal literals are not part of VelarScript",
        span(start, this.index),
      ));
    }
    let value = integer;
    if (this.peek() === "." && (this.isDigit(this.peek(1)) || this.peek(1) === "_")) {
      this.advance();
      value += `.${this.readDigitsWithSeparators()}`;
    } else if (this.peek() === "." && !this.isIdentifierStart(this.peek(1)) && this.peek(1) !== ".") {
      const point = this.index;
      this.advance();
      value += ".0";
      this.diagnostics.push(recoveredDiagnostic(
        "VEL1007",
        `Write '${integer}.0'; decimal literals require a digit after the point`,
        span(point, this.index),
        mechanicalFix(span(point, this.index), ".0", `Write '${integer}.0'`),
      ));
    }
    if ((this.peek() === "e" || this.peek() === "E")
      && (this.isDigit(this.peek(1)) || this.peek(1) === "_"
        || ((this.peek(1) === "+" || this.peek(1) === "-") && (this.isDigit(this.peek(2)) || this.peek(2) === "_")))) {
      const exponent = this.advance();
      value += exponent;
      if (this.peek() === "+" || this.peek() === "-") value += this.advance();
      value += this.readDigitsWithSeparators();
    }
    const numberEnd = this.index;
    if (this.peek() === "%" && this.numericSuffixes.has("%")) this.advance();
    else while (this.isIdentifierPart(this.peek())) this.advance();
    const suffix = this.text.slice(numberEnd, this.index);
    if (suffix && this.numericSuffixes.has(suffix)) {
      this.tokens.push({ kind: "unitNumber", value: `${value}${suffix}`, span: span(start, this.index) });
      return;
    }
    if (suffix) {
      const radix = integer === "0" && suffix.length > 1 ? suffix[0]?.toLowerCase() : null;
      const radixName = radix === "x" ? "Hexadecimal" : radix === "b" ? "Binary" : radix === "o" ? "Octal" : null;
      this.diagnostics.push(diagnostic(
        "VEL1007",
        radixName
          ? `${radixName} literals are not part of VelarScript; write the decimal value`
          : this.numericSuffixes.size > 0
            ? `Unknown numeric unit '${suffix}'`
            : `Unexpected characters '${suffix}' after a number`,
        span(numberEnd, this.index),
      ));
    }
    this.tokens.push({ kind: "number", value, span: span(start, numberEnd) });
  }

  private readLeadingDotNumber(): void {
    const start = this.index;
    this.advance();
    let value = `0.${this.readDigitsWithSeparators()}`;
    if ((this.peek() === "e" || this.peek() === "E")
      && (this.isDigit(this.peek(1)) || this.peek(1) === "_"
        || ((this.peek(1) === "+" || this.peek(1) === "-") && (this.isDigit(this.peek(2)) || this.peek(2) === "_")))) {
      value += this.advance();
      if (this.peek() === "+" || this.peek() === "-") value += this.advance();
      value += this.readDigitsWithSeparators();
    }
    this.diagnostics.push(recoveredDiagnostic(
      "VEL1007",
      `Write '${value}'; decimal literals require a digit before the point`,
      span(start, this.index),
      mechanicalFix(span(start, this.index), value, `Write '${value}'`),
    ));
    this.tokens.push({ kind: "number", value, span: span(start, this.index) });
  }

  private readDigitsWithSeparators(): string {
    let value = "";
    while (this.isDigit(this.peek()) || this.peek() === "_") {
      if (this.isDigit(this.peek())) {
        value += this.advance();
        continue;
      }
      const separator = this.index;
      const valid = this.isDigit(this.text[this.index - 1] ?? "") && this.isDigit(this.peek(1));
      this.advance();
      if (!valid) {
        this.diagnostics.push(diagnostic(
          "VEL1007",
          "Numeric separators must appear only between digits",
          span(separator, this.index),
        ));
      }
    }
    return value;
  }

  private readString(scanned: StringLiteralScan): void {
    const start = this.index;
    this.index = scanned.end;
    this.diagnoseStringContents(scanned);
    if (!scanned.closed) {
      const message = scanned.layout
        ? "Unterminated layout string; close it with a quote at the opening line's indentation"
        : scanned.quote === "`"
          ? "Inline strings cannot contain a line break; use a double-quoted layout string with the opening quote at the end of its line"
          : `Unterminated ${scanned.interpolated ? "interpolated " : ""}string literal before the end of the line`;
      this.diagnostics.push(diagnostic("VEL1003", message, span(start, this.index)));
    }
    if (scanned.indentationError) {
      this.diagnostics.push(diagnostic(
        "VEL1004",
        "Layout string lines must keep the indentation established by the first content line",
        span(scanned.indentationError.start, scanned.indentationError.end),
      ));
    }
    if (!scanned.canonical) {
      this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'rf' rather than 'fr' for raw interpolated strings", span(start, start + scanned.prefixLength),
        mechanicalFix(span(start, start + scanned.prefixLength), "rf", "Use the 'rf' raw interpolated string prefix")));
    }
    if (scanned.quote === "'") {
      this.diagnostics.push(diagnostic(
        "VEL1005",
        "Use double quotes or backticks for strings; single-quoted strings are not part of VelarScript",
        span(start + scanned.prefixLength, Math.min(this.index, start + scanned.prefixLength + 1)),
      ));
    }
    const payload: StringTokenPayload = {
      prefixLength: scanned.prefixLength,
      quote: scanned.quote,
      raw: scanned.raw,
      layout: scanned.layout,
      ...(scanned.contentOffsets ? { contentOffsets: scanned.contentOffsets } : {}),
    };
    this.tokens.push({
      kind: scanned.interpolated ? "fstring" : "string",
      value: scanned.interpolated ? scanned.content : this.decodeStringText(scanned.content, scanned.raw, scanned.quote, scanned.layout),
      span: span(start, this.index),
      payload,
    });
    // An unterminated layout string swallows its line breaks, so recovery also
    // closes the logical line. Without this the next physical line would be
    // read as a leftover token on the broken line, and the statement-boundary
    // rule would report it instead of letting it declare its own names.
    if (scanned.recoverAtLineStart) {
      this.atLineStart = true;
      this.tokens.push({ kind: "newline", value: "", span: span(this.index, this.index) });
    }
  }

  private diagnoseStringContents(scanned: StringLiteralScan): void {
    const sourceOffset = (index: number): number => scanned.contentOffsets?.[index] ?? scanned.contentStart + index;
    for (let index = 0; index < scanned.content.length; index += 1) {
      const character = scanned.content[index]!;
      const next = scanned.content[index + 1];
      if (!scanned.raw && character === "\\") {
        const escaped = scanStringEscape(scanned.content, index);
        if (escaped.error !== null) {
          const start = sourceOffset(index);
          const messages = {
            legacyUnicode: "Use a braced Unicode escape such as '\\u{E9}'; '\\uXXXX' escapes are not part of VelarScript",
            hex: "Use a braced Unicode escape such as '\\u{E9}'; '\\xNN' escapes are not part of VelarScript",
            unicodeForm: "A Unicode escape must be '\\u{' followed by 1 to 6 hexadecimal digits and '}'",
            unicodeRange: "A Unicode escape cannot exceed U+10FFFF",
            unicodeSurrogate: "A Unicode escape cannot encode a surrogate from U+D800 through U+DFFF",
            unknown: `Unknown string escape '${next === "\n" || next === "\r" ? "line break" : `\\${next ?? ""}`}'; use '\\\\' for a literal backslash or an r\"...\" raw string`,
          } as const;
          this.diagnostics.push(diagnostic("VEL1008", messages[escaped.error], span(start, sourceOffset(escaped.end))));
        }
        index = escaped.end - 1;
        continue;
      }
      const codePoint = character.codePointAt(0)!;
      if (!this.isBidirectionalControl(codePoint) && this.isForbiddenLiteralControl(codePoint)) {
        const start = sourceOffset(index);
        this.diagnostics.push(diagnostic(
          "VEL1009",
          `Control character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} must be written with a '\\u{...}' escape inside a string literal`,
          span(start, sourceOffset(index + 1)),
        ));
      }
      if (!scanned.interpolated || character !== "{") continue;
      if (scanned.content[index - 1] === "$") continue;
      if (next === "{") {
        index += 1;
        continue;
      }
      const close = findInterpolatedExpressionEnd(scanned.content, index + 1);
      if (close < 0) break;
      index = close;
    }
  }

  private decodeStringText(value: string, raw: boolean, quote: "\"" | "'" | "`", layout: boolean): string {
    let decoded = "";
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index]!;
      const next = value[index + 1];
      if (raw && !layout && character === quote && next === quote) {
        decoded += quote;
        index += 1;
      } else if (!raw && character === "\\" && next !== undefined) {
        const escaped = scanStringEscape(value, index);
        decoded += escaped.value ?? next;
        index = escaped.end - 1;
      } else {
        decoded += character;
      }
    }
    return decoded;
  }

  private legacyTripleQuotePrefix(): { readonly prefix: "" | "f" | "r" | "rf" | "fr"; readonly interpolated: boolean; readonly raw: boolean } | null {
    for (const prefix of ["rf", "fr", "f", "r", ""] as const) {
      if (!this.text.startsWith(`${prefix}\"\"\"`, this.index)) continue;
      return {
        prefix,
        interpolated: prefix === "f" || prefix === "rf" || prefix === "fr",
        raw: prefix === "r" || prefix === "rf" || prefix === "fr",
      };
    }
    return null;
  }

  private readLegacyTripleQuote(options: { readonly prefix: "" | "f" | "r" | "rf" | "fr"; readonly interpolated: boolean; readonly raw: boolean }): void {
    const start = this.index;
    this.index += options.prefix.length + 3;
    const contentStart = this.index;
    while (!this.isAtEnd() && !this.text.startsWith('\"\"\"', this.index)) this.index += 1;
    const closed = !this.isAtEnd();
    const contentEnd = this.index;
    if (closed) this.index += 3;
    const canonicalPrefix = options.prefix === "fr" ? "rf" : options.prefix;
    this.diagnostics.push(recoveredDiagnostic(
      "VEL1005",
      `Use a ${canonicalPrefix ? `'${canonicalPrefix}\"'` : "'\"'"} layout string; VelarScript uses indentation rather than triple-quote delimiters`,
      span(start, this.index),
    ));
    if (!closed) this.diagnostics.push(diagnostic("VEL1003", "Unterminated legacy triple-quoted string", span(start, this.index)));
    this.tokens.push({
      kind: options.interpolated ? "fstring" : "string",
      value: this.text.slice(contentStart, contentEnd),
      span: span(start, this.index),
      ...(options.interpolated ? {
        payload: { prefixLength: options.prefix.length, quote: '"', raw: options.raw, layout: true } satisfies StringTokenPayload,
      } : {}),
    });
  }

  private readExtensionToken(): boolean {
    for (const scanner of this.extensionScanners) {
      const result = scanner({
        source: this.text,
        offset: this.index,
        currentIndent: this.indentStack.at(-1) ?? 0,
        tokens: this.tokens,
      });
      if (!result) continue;
      if (result.token.kind !== "extensionToken" || result.nextOffset <= this.index || result.nextOffset > this.text.length) {
        throw new Error("A compiler lexical extension returned an invalid token boundary");
      }
      this.tokens.push(result.token);
      this.diagnostics.push(...result.diagnostics ?? []);
      this.index = result.nextOffset;
      this.atLineStart = result.startsLine ?? false;
      return true;
    }
    return false;
  }

  private operator(single: TokenKind, compound: TokenKind, start: number): void {
    this.simple(this.peek(1) === "=" ? compound : single, start, this.peek(1) === "=" ? 2 : 1);
  }

  /**
   * The rewrite of a symbol operator to its word spelling. A word needs air on
   * either side that a symbol did not: 'a&&b' becomes 'a and b', while
   * 'a && b' keeps the spacing it already had.
   */
  private wordOperatorFix(start: number, end: number, word: string, title: string): DiagnosticFix {
    const before = this.text[start - 1];
    const after = this.text[end];
    const left = before !== undefined && !/[\s([{,]/u.test(before) ? " " : "";
    const right = after !== undefined && !/[\s)\]},]/u.test(after) ? " " : "";
    return mechanicalFix(span(start, end), `${left}${word}${right}`, title);
  }

  private skipHorizontalWhitespace(index: number): number {
    let end = index;
    while (this.text[end] === " " || this.text[end] === "\t") end += 1;
    return end;
  }

  /**
   * The deletion of a line-ending semicolon, including the blank space it would
   * leave behind. A semicolon followed by anything except further semicolons,
   * spaces, or a comment separates two statements: putting those on their own
   * lines is a change of layout rather than of spelling, so it carries no fix.
   */
  private trailingSemicolonFix(start: number): DiagnosticFix | undefined {
    let end = start + 1;
    while (this.text[end] === ";" || this.text[end] === " " || this.text[end] === "\t") end += 1;
    const rest = this.text.slice(end, this.lineEnd(end));
    if (rest.length > 0 && !rest.startsWith("//") && !rest.startsWith("/*")) return undefined;
    let from = start;
    while (from > 0 && (this.text[from - 1] === " " || this.text[from - 1] === "\t")) from -= 1;
    // Indentation is not the semicolon's whitespace to take.
    return mechanicalFix(span(Math.max(from, this.lineStart(start)), start + 1), "", "Remove the semicolon");
  }

  private simple(kind: TokenKind, start: number, length: number): void {
    this.index += length;
    this.tokens.push({ kind, value: this.text.slice(start, this.index), span: span(start, this.index) });
  }

  // A bare hex color such as '#3478f6' is guided to its quoted-string
  // spelling and recovered as that string token, so the digits never fall
  // into number lexing and produce a misleading unknown-numeric-unit error.
  private readHexColor(start: number): boolean {
    let length = 0;
    while (/[0-9a-fA-F]/.test(this.peek(1 + length))) length += 1;
    if ((length !== 3 && length !== 4 && length !== 6 && length !== 8) || this.isIdentifierPart(this.peek(1 + length))) {
      return false;
    }
    const end = start + 1 + length;
    const text = this.text.slice(start, end);
    this.diagnostics.push(recoveredDiagnostic(
      "VEL1005",
      `Use '"${text}"'; VelarScript writes hex colors as quoted strings or color builders such as rgb(...)`,
      span(start, end),
      mechanicalFix(span(start, end), `"${text}"`, `Quote the hex color as '"${text}"'`),
    ));
    this.tokens.push({ kind: "string", value: text, span: span(start, end) });
    this.index = end;
    return true;
  }

  private readJavaScriptPrivateIdentifier(start: number): boolean {
    const previous = this.tokens.at(-1);
    const memberAccess = previous?.kind === "dot" || previous?.kind === "optionalDot";
    const declaration = previous?.kind === "let" || previous?.kind === "const" || previous?.kind === "def"
      || (previous?.kind === "identifier" && previous.value === "get");
    if ((!memberAccess && !declaration) || !this.isIdentifierStart(this.peek(1))) return false;
    this.index = start + 1;
    const nameStart = this.index;
    while (this.isIdentifierPart(this.peek())) this.advance();
    this.diagnostics.push(recoveredDiagnostic(
      "VEL1005",
      "Remove '#'; VelarScript owns class privacy and does not expose JavaScript private identifiers",
      span(start, start + 1),
      mechanicalFix(span(start, start + 1), "", "Remove the JavaScript private marker"),
    ));
    this.tokens.push({ kind: "identifier", value: this.text.slice(nameStart, this.index), span: span(nameStart, this.index) });
    return true;
  }

  // A '#' that starts a line is a Python-style comment: it receives "use //"
  // guidance and the rest of the line is skipped like a comment, so the
  // commented text never produces its own error cascade. Bare hex colors were
  // already consumed by readHexColor before this check runs.
  private readHashComment(start: number): boolean {
    const previous = this.tokens.at(-1)?.kind;
    const lineStart = previous === undefined || previous === "newline" || previous === "indent" || previous === "dedent";
    if (!lineStart) return false;
    this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use '//' for comments; VelarScript comments start with '//'", span(start, start + 1),
      mechanicalFix(span(start, start + 1), "//", "Use '//' to start the comment")));
    this.index = start;
    this.advance();
    this.readComment();
    return true;
  }

  private diagnoseForbiddenSourceCharacters(): void {
    for (let index = 0; index < this.text.length; index += 1) {
      const codePoint = this.text.codePointAt(index)!;
      if (!this.isBidirectionalControl(codePoint)) {
        if (codePoint > 0xffff) index += 1;
        continue;
      }
      this.diagnosedBidirectionalOffsets.add(index);
      this.diagnostics.push(diagnostic(
        "VEL1009",
        `Bidirectional control U+${codePoint.toString(16).toUpperCase()} cannot appear directly in VelarScript source; write it inside a string as '\\u{${codePoint.toString(16).toUpperCase()}}' so the source remains reviewable`,
        span(index, index + 1),
      ));
    }
  }

  private isBidirectionalControl(codePoint: number): boolean {
    return bidirectionalControls.has(codePoint);
  }

  private isForbiddenLiteralControl(codePoint: number): boolean {
    // Physical CR/LF are structural content in layout strings. Every other C0
    // control, DEL, and the C1 block must use the visible escape spelling.
    return (codePoint >= 0 && codePoint <= 0x1f && codePoint !== 0x0a && codePoint !== 0x0d)
      || (codePoint >= 0x7f && codePoint <= 0x9f);
  }

  private lineStart(index: number): number {
    while (index > 0 && this.text[index - 1] !== "\n" && this.text[index - 1] !== "\r") index -= 1;
    return index;
  }

  private lineEnd(index: number): number {
    while (index < this.text.length && this.text[index] !== "\n" && this.text[index] !== "\r") index += 1;
    return index;
  }

  private invalidCharacter(character: string, start: number): void {
    this.advance();
    if (this.diagnosedBidirectionalOffsets.has(start) || this.isBidirectionalControl(character.codePointAt(0)!)) return;
    this.diagnostics.push(diagnostic("VEL1001", `Unexpected character '${character}'`, span(start, this.index)));
  }

  private isAtEnd(): boolean {
    return this.index >= this.text.length;
  }

  private peek(distance = 0): string {
    return this.text[this.index + distance] ?? "\0";
  }

  private advance(): string {
    const character = this.peek();
    this.index += 1;
    return character;
  }

  private isIdentifierStart(character: string): boolean {
    return isSourceIdentifierStart(character);
  }

  private isIdentifierPart(character: string): boolean {
    return isSourceIdentifierPart(character);
  }

  private isDigit(character: string): boolean {
    return character >= "0" && character <= "9";
  }
}
