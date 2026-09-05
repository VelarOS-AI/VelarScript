import { type AdvisorySuppression } from "./advisory-suppression.ts";
import { scanEmbeddedJavaScriptLiteral } from "./embedded-javascript.ts";
import { CORE_NUMERIC_SUFFIXES } from "./core-vocabulary.ts";
import { advisory, diagnostic, mechanicalFix, recoveredDiagnostic, type Advisory, type Diagnostic, type DiagnosticFix } from "./diagnostic.ts";
import type { CompilerLexicalExtension } from "./extension.ts";
import { scanStringLiteral } from "./interpolated-string.ts";
import { MAX_LEX_DIAGNOSTICS } from "./limits.ts";
import { isSourceIdentifierPart, isSourceIdentifierStart } from "./source-names.ts";
import { span, type Span } from "./source.ts";
import { type Token, type TokenKind } from "./token.ts";
import { BracketNesting, type BracketNestingHost } from "./lexer/brackets.ts";
import { CommentScanner, type CommentScannerHost } from "./lexer/comments.ts";
import { LineContinuation, type LineContinuationHost } from "./lexer/continuation.ts";
import { EmbeddedScanners, type EmbeddedScannersHost } from "./lexer/embedded.ts";
import { SourceHygiene, type SourceHygieneHost } from "./lexer/hygiene.ts";
import { IdentifierScanner, type IdentifierScannerHost } from "./lexer/identifiers.ts";
import { NumberScanner, type NumberScannerHost } from "./lexer/numbers.ts";
import { StringScanner, type StringScannerHost } from "./lexer/strings.ts";
import { lineBoundaryKinds } from "./lexer/tokens.ts";
const MAX_TOKENS = 250000;
const MAX_NESTING = 512;
const classHeaderModifierKinds = new Set<TokenKind>(["export", "abstract"]);
/**
 * The diagnostics of one lex, capped. Pathological input reports once per
 * character — a minified JavaScript file pasted into a `.vel` buffer that the
 * language server re-lexes on every keystroke — and millions of retained
 * reports help nobody. The cap never drops the tail silently: its last slot
 * says that it closed, so a real error can never hide behind the truncation.
 */
class DiagnosticLog {
  private readonly entries: Diagnostic[] = [];
  private closed = false;

  push(...reports: readonly Diagnostic[]): void {
    for (const report of reports) {
      if (this.entries.length < MAX_LEX_DIAGNOSTICS - 1) {
        this.entries.push(report);
        continue;
      }
      if (this.closed) return;
      this.closed = true;
      this.entries.push(diagnostic(
        "VEL1013",
        `This module reported ${MAX_LEX_DIAGNOSTICS - 1} lexical errors, which is as many as VelarScript reports at once; fix these and compile again to see the rest`,
        report.span,
      ));
      return;
    }
  }

  get reports(): readonly Diagnostic[] {
    return this.entries;
  }
}

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
  /** D89: the advisory channel, accumulated beside the diagnostics and never merged into them. */
  readonly advisories: readonly Advisory[];
  /** D89: the reasoned `velar-allow` suppressions this module's line comments carry. */
  readonly suppressions: readonly AdvisorySuppression[];
}

export class Lexer {
  private readonly text: string;
  private readonly extensionForbiddenIdentifiers = new Map<string, string>();
  private readonly extensionScanners: NonNullable<CompilerLexicalExtension["scan"]>[] = [];
  // D39-52: milliseconds and seconds are Core duration literals. Extensions
  // may add visual units, but Core owns these two spellings. D62 rule 158:
  // the pair is read from Core's roster rather than spelled here, so a gate
  // that reverse-queries the language surface can see them without an
  // extension republishing them.
  private readonly numericSuffixes = new Set<string>(CORE_NUMERIC_SUFFIXES);
  private readonly tokens: Token[] = [];
  private readonly diagnostics = new DiagnosticLog();
  private readonly advisories: Advisory[] = [];
  private readonly suppressions: AdvisorySuppression[] = [];
  private readonly diagnosedBidirectionalOffsets = new Set<number>();
  private readonly indentStack = [0];
  // D90 (compiler-front-9): whether each open block is a class body, kept in
  // step with `indentStack`. A member may be spelled `with` or `int`; a binding
  // may not, and `def with(...)` at module scope would emit `function with`,
  // which is not JavaScript. Only the enclosing block tells the two apart.
  private readonly classBodyStack = [false];
  // Record-type fields are member declarations too. Keep their block identity
  // beside the class identity so a forbidden bare spelling such as `none`
  // remains rejected as a value/type name while `none: string` is lexed as
  // the field the declaration actually defines.
  private readonly typeBodyStack = [false];
  // D90 (compiler-front-14): the brackets still open, with the indentation of
  // the physical line each one was opened on.
  private readonly openBrackets: { readonly span: Span; readonly text: string; readonly lineIndent: number; readonly arrowBody: boolean }[] = [];
  private index = 0;
  private atLineStart = true;
  // A physical line began while brackets were open, where no newline token is
  // emitted and no indentation is read. The unclosed-bracket recovery is the
  // only thing that looks at those lines.
  private bracketLineStart = false;
  private nesting = 0;
  // The indentation of the physical line that opened the current logical line.
  // A leading-dot continuation is measured against this rather than against the
  // previous physical line, so every line of one chain answers to one rule.
  private logicalLineIndent = 0;
  // The forward line scan `lineStart` and `lineEnd` share; see `lineStart`.
  private scannedLineStart = 0;
  private scannedTo = 0;
  private cachedLineEndFrom = -1;
  private cachedLineEnd = -1;
  // The end of the run of semicolons and blanks a trailing-semicolon fix last
  // measured. Every semicolon in one run reaches the same offset, so the run is
  // walked once rather than once per semicolon.
  private semicolonRunEnd = -1;
  // A bracket fragment is an expression lexed inside an enclosing bracket
  // context, such as an extension-owned bracket interpolation: newlines are insignificant
  // and physical-line indentation never opens or closes blocks, exactly as
  // between ordinary parentheses.
  private readonly bracketFragment: boolean;
  private readonly scanSourceHygiene: boolean;

  /**
   * D115 §三 / D114 R1f: the eight halves of the scan. Each declares the narrow
   * face it needs, and all eight read this lexer through the single
   * `scannerHost()` object whose type is the union of those faces. The cursor
   * moves under them, so every piece of state on it is a live accessor.
   */
  private readonly brackets: BracketNesting;
  private readonly comments: CommentScanner;
  private readonly continuation: LineContinuation;
  private readonly embedded: EmbeddedScanners;
  private readonly hygiene: SourceHygiene;
  private readonly identifiers: IdentifierScanner;
  private readonly numbers: NumberScanner;
  private readonly strings: StringScanner;

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
    const host = this.scannerHost();
    this.brackets = new BracketNesting(host);
    this.comments = new CommentScanner(host);
    this.continuation = new LineContinuation(host);
    this.embedded = new EmbeddedScanners(host);
    this.hygiene = new SourceHygiene(host);
    this.identifiers = new IdentifierScanner(host);
    this.numbers = new NumberScanner(host);
    this.strings = new StringScanner(host);
  }

  /**
   * The one object the eight halves are handed. Every property is a live read
   * of this lexer: the cursor moves, the token array grows and the bracket
   * stack is rewritten while a half is running, so none of it can be a value
   * captured when the halves were built.
   */
  private scannerHost(): BracketNestingHost & CommentScannerHost & EmbeddedScannersHost
    & IdentifierScannerHost & LineContinuationHost & NumberScannerHost & SourceHygieneHost
    & StringScannerHost {
    const lexer = this;
    return {
      advance: () => lexer.advance(),
      adviseFloorDivisionComment: (start, bodyStart, contentEnd) => { lexer.continuation.adviseFloorDivisionComment(start, bodyStart, contentEnd); },
      get advisories() { return lexer.advisories; },
      get atLineStart() { return lexer.atLineStart; },
      set atLineStart(value) { lexer.atLineStart = value; },
      get bracketFragment() { return lexer.bracketFragment; },
      get classBodyStack() { return lexer.classBodyStack; },
      get diagnosedBidirectionalOffsets() { return lexer.diagnosedBidirectionalOffsets; },
      get diagnostics() { return lexer.diagnostics; },
      get extensionForbiddenIdentifiers() { return lexer.extensionForbiddenIdentifiers; },
      get extensionScanners() { return lexer.extensionScanners; },
      hasBracketOpenedOnLine: (start) => lexer.brackets.hasBracketOpenedOnLine(start),
      get indentStack() { return lexer.indentStack; },
      get index() { return lexer.index; },
      set index(value) { lexer.index = value; },
      isAtEnd: () => lexer.isAtEnd(),
      isBidirectionalControl: (codePoint) => lexer.hygiene.isBidirectionalControl(codePoint),
      isDigit: (character) => lexer.isDigit(character),
      isForbiddenLiteralControl: (codePoint) => lexer.hygiene.isForbiddenLiteralControl(codePoint),
      isIdentifierPart: (character) => lexer.isIdentifierPart(character),
      isIdentifierStart: (character) => lexer.isIdentifierStart(character),
      lineEnd: (from) => lexer.lineEnd(from),
      lineStart: (offset) => lexer.lineStart(offset),
      get logicalLineIndent() { return lexer.logicalLineIndent; },
      get nesting() { return lexer.nesting; },
      set nesting(value) { lexer.nesting = value; },
      get numericSuffixes() { return lexer.numericSuffixes; },
      get openBrackets() { return lexer.openBrackets; },
      peek: (offset) => lexer.peek(offset),
      skipHorizontalWhitespace: (from) => lexer.skipHorizontalWhitespace(from),
      get suppressions() { return lexer.suppressions; },
      get text() { return lexer.text; },
      get tokens() { return lexer.tokens; },
      get typeBodyStack() { return lexer.typeBodyStack; },
    };
  }

  lex(): LexResult {
    if (this.scanSourceHygiene) this.hygiene.diagnoseForbiddenSourceCharacters();
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
      if (this.bracketLineStart) {
        this.bracketLineStart = false;
        this.brackets.recoverUnclosedBrackets();
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
        this.comments.readComment();
        continue;
      }

      if (character === "/" && this.peek(1) === "*") {
        this.comments.readBlockComment();
        continue;
      }

      if (this.embedded.readExtensionToken()) continue;

      // D53 rule 117: only the two complete statement-head shapes claim a
      // multiline backtick. Ordinary backtick strings keep their existing
      // inline-only scanner and diagnostics everywhere else.
      const embeddedJavaScript = scanEmbeddedJavaScriptLiteral(this.text, start);
      if (embeddedJavaScript) {
        this.embedded.readEmbeddedJavaScript(embeddedJavaScript);
        continue;
      }

      // A raw inline string may legally start with a doubled delimiter:
      // r"""quoted"" text". Prefer that unambiguous current spelling over
      // the removed triple-quote migration scanner.
      const rawString = scanStringLiteral(this.text, start);
      if (rawString?.raw && rawString.closed && !rawString.layout) {
        this.strings.readString(rawString);
        continue;
      }

      const legacyTriple = this.strings.legacyTripleQuotePrefix();
      if (legacyTriple) {
        this.strings.readLegacyTripleQuote(legacyTriple);
        continue;
      }

      const string = scanStringLiteral(this.text, start);
      if (string) {
        this.strings.readString(string);
        continue;
      }

      if (this.isIdentifierStart(character)) {
        this.identifiers.readIdentifier();
        continue;
      }

      if (this.isDigit(character)) {
        this.numbers.readNumber();
        continue;
      }

      switch (character) {
        case "(":
          this.simple("leftParen", start, 1);
          this.brackets.openBracket(start);
          break;
        case ")":
          this.simple("rightParen", start, 1);
          this.brackets.closeBracket();
          break;
        case "[":
          this.simple("leftBracket", start, 1);
          this.brackets.openBracket(start);
          break;
        case "]":
          this.simple("rightBracket", start, 1);
          this.brackets.closeBracket();
          break;
        case "{":
          this.simple("leftBrace", start, 1);
          this.brackets.openBracket(start);
          break;
        case "}":
          this.simple("rightBrace", start, 1);
          this.brackets.closeBracket();
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
        // '@' has one job: qualify the next name into the compiler-owned
        // namespace of the current syntax context. It is not an identifier
        // character, so compiler roles cannot collide with author names.
        case "@":
          this.simple("at", start, 1);
          break;
        case ".":
          if (this.isDigit(this.peek(1))) {
            this.numbers.readLeadingDotNumber();
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
            // D86 rule 212: `!=` keeps winning by longest match, so `!==` is
            // the one spelling the required-value unwrap cannot claim. The
            // JavaScript reading is the common one and keeps the fix; the
            // message names the other reading so an author who meant the
            // unwrap learns that `==` needs its space.
            this.diagnostics.push(recoveredDiagnostic("VEL1005",
              "Use '!='; inequality is already strict in VelarScript — and if the '!' unwraps the value before it, give '==' its space: 'value! == other'",
              span(start, start + 3),
              mechanicalFix(span(start, start + 3), "!=", "Use VelarScript strict inequality '!='")));
            this.simple("notEqual", start, 3);
          } else if (this.peek(1) === "=") {
            this.simple("notEqual", start, 2);
          } else {
            // D86 rule 212: `!` reads as the required-value unwrap after an
            // operand and as JavaScript negation before one, and only the
            // parser knows which position this is. The guidance for the
            // negation reading therefore moves to the parser; `!=` still wins
            // by longest match above, so `x! == y` needs its space.
            this.simple("bang", start, 1);
          }
          break;
        case "&":
          if (this.peek(1) === "&") {
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'and'; VelarScript uses readable logical operators", span(start, start + 2),
              this.identifiers.wordOperatorFix(start, start + 2, "and", "Use readable 'and'")));
            this.simple("and", start, 2);
          } else this.operator("amp", "bitAndAssign", start);
          break;
        case "^":
          this.operator("caret", "bitXorAssign", start);
          break;
        case "~":
          this.simple("tilde", start, 1);
          break;
        case "<":
          if (this.peek(1) === "<") this.simple(this.peek(2) === "=" ? "leftShiftAssign" : "leftShift", start, this.peek(2) === "=" ? 3 : 2);
          else this.simple(this.peek(1) === "=" ? "lessEqual" : "less", start, this.peek(1) === "=" ? 2 : 1);
          break;
        case ">":
          if (this.peek(1) === ">" && this.peek(2) === ">") this.simple(this.peek(3) === "=" ? "unsignedRightShiftAssign" : "unsignedRightShift", start, this.peek(3) === "=" ? 4 : 3);
          else if (this.peek(1) === ">") this.simple(this.peek(2) === "=" ? "rightShiftAssign" : "rightShift", start, this.peek(2) === "=" ? 3 : 2);
          else this.simple(this.peek(1) === "=" ? "greaterEqual" : "greater", start, this.peek(1) === "=" ? 2 : 1);
          break;
        case "|":
          if (this.peek(1) === "|") {
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'or'; VelarScript uses readable logical operators", span(start, start + 2),
              this.identifiers.wordOperatorFix(start, start + 2, "or", "Use readable 'or'")));
            this.simple("or", start, 2);
          } else this.operator("pipe", "bitOrAssign", start);
          break;
        // The embedded scanner follows the same rule as the main scanner:
        // `@` selects the contextual compiler namespace and nothing else.
        case "@":
          this.simple("at", start, 1);
          break;
        case "#":
          if (this.embedded.readJavaScriptPrivateIdentifier(start)) break;
          if (this.numbers.readHexColor(start)) break;
          if (this.comments.readHashComment(start)) break;
          this.hygiene.invalidCharacter(character, start);
          break;
        default:
          this.hygiene.invalidCharacter(character, start);
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
    return { tokens: this.tokens, diagnostics: this.diagnostics.reports, advisories: this.advisories, suppressions: this.suppressions };
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
    const comment = (this.peek() === "/" && this.peek(1) === "/") || this.comments.blockCommentOwnsLine();
    this.atLineStart = false;

    if (blank || comment) {
      return;
    }

    // A leading member step or binary operator continues the previous logical
    // line: the newline token that ended it is withdrawn and this line's
    // indentation does not open or close a block. This admits readable chains
    // and boolean/arithmetic expressions without making every indented line a
    // continuation.
    const dotWidth = this.continuation.leadingDotWidth();
    const binaryOperator = this.continuation.leadingBinaryOperator();
    if (dotWidth > 0 || binaryOperator !== null) {
      if (this.continuation.isChainContinuation(width)) {
        this.tokens.pop();
        return;
      }
      // The line looked like a continuation and is not one, so it is read as
      // its own statement — which it cannot be, because no statement begins
      // with a member step. Saying so here is the whole point of tightening
      // the rule: the alternative is the silent reattachment this replaces.
      if (dotWidth > 0) {
        this.diagnostics.push(diagnostic(
          "VEL1004",
          `A line beginning with '${dotWidth === 2 ? "?." : "."}' continues the line above it, so it must follow that line directly and be indented past the statement it continues`,
          span(start, this.index + dotWidth),
        ));
      }
    }

    const current = this.indentStack.at(-1) ?? 0;
    this.logicalLineIndent = width;
    if (width > current) {
      if (this.indentStack.length > MAX_NESTING) {
        this.diagnostics.push(diagnostic("VEL1006", `Indentation nesting cannot exceed ${MAX_NESTING} levels`, span(start, this.index)));
        this.index = this.text.length;
        return;
      }
      this.indentStack.push(width);
      this.classBodyStack.push(this.opensClassBody());
      this.typeBodyStack.push(this.opensTypeBody());
      this.tokens.push({ kind: "indent", value: "", span: span(start, this.index) });
      return;
    }

    if (width < current) {
      while (this.indentStack.length > 1 && width < (this.indentStack.at(-1) ?? 0)) {
        this.indentStack.pop();
        this.classBodyStack.pop();
        this.typeBodyStack.pop();
        this.tokens.push({ kind: "dedent", value: "", span: span(start, this.index) });
      }

      if (width !== (this.indentStack.at(-1) ?? 0)) {
        this.diagnostics.push(diagnostic("VEL1004", "Indentation does not match an outer block", span(start, this.index)));
      }
    }
  }

  /**
   * Whether the logical line that just ended opens a class body. Read by the
   * member-name exemption: `def with(...)` declares a member here and a binding
   * anywhere else, and only the enclosing block distinguishes them.
   */
  private opensClassBody(): boolean {
    let index = this.tokens.length - 1;
    while (index >= 0 && this.tokens[index]!.kind === "newline") index -= 1;
    if (this.tokens[index]?.kind !== "colon") return false;
    while (index >= 0 && !lineBoundaryKinds.has(this.tokens[index]!.kind)) index -= 1;
    let head = index + 1;
    while (classHeaderModifierKinds.has(this.tokens[head]?.kind ?? "eof")) head += 1;
    return this.tokens[head]?.kind === "class";
  }

  /** Whether the logical line that just ended opens a record-type body. */
  private opensTypeBody(): boolean {
    let index = this.tokens.length - 1;
    while (index >= 0 && this.tokens[index]!.kind === "newline") index -= 1;
    if (this.tokens[index]?.kind !== "colon") return false;
    while (index >= 0 && !lineBoundaryKinds.has(this.tokens[index]!.kind)) index -= 1;
    let head = index + 1;
    while (classHeaderModifierKinds.has(this.tokens[head]?.kind ?? "eof")) head += 1;
    return this.tokens[head]?.kind === "identifier" && this.tokens[head]?.value === "type";
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
    } else if (!this.bracketFragment) {
      this.bracketLineStart = true;
    }
  }

  private operator(single: TokenKind, compound: TokenKind, start: number): void {
    this.simple(this.peek(1) === "=" ? compound : single, start, this.peek(1) === "=" ? 2 : 1);
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
    if (end < this.semicolonRunEnd) {
      end = this.semicolonRunEnd;
    } else {
      while (this.text[end] === ";" || this.text[end] === " " || this.text[end] === "\t") end += 1;
      this.semicolonRunEnd = end;
    }
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

  /**
   * The start of the physical line `index` sits on. D90 (compiler-front-2): the
   * backward scan this used to be is O(column) per call, and its callers — A1,
   * the block-comment reader, the semicolon fix, and every opening bracket —
   * run once per token, so one long physical line cost O(n²). A line of 20000
   * semicolons took 673 ms and a 4 MiB one would have taken hours, with nothing
   * to stop it: a ';' produces no token, so `MAX_TOKENS` never fires.
   *
   * The offsets those callers ask about only move forward, so the scan is
   * carried across the file once and each call pays for the characters since
   * the last one. An earlier offset still falls back to the backward scan,
   * which is correct and, being off the hot path, is not the cost.
   */
  private lineStart(index: number): number {
    if (index < this.scannedTo) {
      let cursor = index;
      while (cursor > 0 && this.text[cursor - 1] !== "\n" && this.text[cursor - 1] !== "\r") cursor -= 1;
      return cursor;
    }
    while (this.scannedTo < index) {
      const character = this.text[this.scannedTo];
      this.scannedTo += 1;
      if (character === "\n" || character === "\r") this.scannedLineStart = this.scannedTo;
    }
    return this.scannedLineStart;
  }

  /**
   * The end of the physical line `index` sits on. Every offset between a line's
   * start and its end shares that end, so one line answers every call about it
   * once — which is what keeps a line of N semicolons from paying N forward
   * scans of its own tail.
   */
  private lineEnd(index: number): number {
    if (index >= this.cachedLineEndFrom && index <= this.cachedLineEnd) return this.cachedLineEnd;
    let cursor = index;
    while (cursor < this.text.length && this.text[cursor] !== "\n" && this.text[cursor] !== "\r") cursor += 1;
    this.cachedLineEndFrom = index;
    this.cachedLineEnd = cursor;
    return cursor;
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
