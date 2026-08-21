import { scanAdvisorySuppressions, type AdvisorySuppression } from "./advisory-suppression.ts";
import { CORE_NUMERIC_SUFFIXES } from "./core-vocabulary.ts";
import { advisory, diagnostic, mechanicalFix, recoveredDiagnostic, type Advisory, type Diagnostic, type DiagnosticFix } from "./diagnostic.ts";
import { scanEmbeddedJavaScriptLiteral, type EmbeddedJavaScriptTokenPayload } from "./embedded-javascript.ts";
import type { CompilerLexicalExtension } from "./extension.ts";
import { findInterpolatedExpressionEnd, scanStringEscape, scanStringLiteral, type StringLiteralScan, type StringTokenPayload } from "./interpolated-string.ts";
import { webNumericUnitOwner } from "./language-guidance.ts";
import { MAX_LEX_DIAGNOSTICS } from "./limits.ts";
import { forbiddenSourceIdentifiers, isForbiddenPrototypeMember, isSourceIdentifierPart, isSourceIdentifierStart } from "./source-names.ts";
import { span, type Span } from "./source.ts";
import { keywordKinds, type NumberTokenPayload, type Token, type TokenKind } from "./token.ts";
const MAX_TOKENS = 250000;
const MAX_NESTING = 512;
/**
 * D51 rule 104: all twelve `Bidi_Control` code points. LRM/RLM/ALM were the
 * three missing, and CVE-2021-42574 names them in the same breath as the nine
 * that were already banned — three open doors is the same as no door. ZWJ and
 * the variation selectors stay legal: they compose emoji, they do not reorder
 * a reviewer's line.
 */
const bidirectionalControls = new Set([
  0x061c, 0x200e, 0x200f,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2066, 0x2067, 0x2068, 0x2069,
]);

// A logical line may continue onto the next physical line when that line's
// first token is '.' or '?.' member access (a leading-dot method chain). The
// previous line must end with a token that can end an expression, so block
// headers, operators, and empty lines never join accidentally.
const chainContinuationEndKinds = new Set<TokenKind>([
  "identifier", "number", "unitNumber", "string", "fstring",
  "true", "false", "null", "super", "rightParen", "rightBracket", "rightBrace",
  "extensionToken",
]);

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

// The tokens that end one logical line's token run, and the words a class
// header may carry ahead of `class`. Both are read when a block opens, to
// decide whether the block being entered is a class body.
const lineBoundaryKinds = new Set<TokenKind>(["newline", "indent", "dedent"]);
const classHeaderModifierKinds = new Set<TokenKind>(["export", "abstract"]);
/** How far back the receiver-parameter walk reads before giving the name up. */
const RECEIVER_PARAMETER_SCAN_LIMIT = 4096;

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
      if (this.bracketLineStart) {
        this.bracketLineStart = false;
        this.recoverUnclosedBrackets();
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

      // D53 rule 117: only the two complete statement-head shapes claim a
      // multiline backtick. Ordinary backtick strings keep their existing
      // inline-only scanner and diagnostics everywhere else.
      const embeddedJavaScript = scanEmbeddedJavaScriptLiteral(this.text, start);
      if (embeddedJavaScript) {
        this.readEmbeddedJavaScript(embeddedJavaScript);
        continue;
      }

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
          this.openBracket(start);
          break;
        case ")":
          this.simple("rightParen", start, 1);
          this.closeBracket();
          break;
        case "[":
          this.simple("leftBracket", start, 1);
          this.openBracket(start);
          break;
        case "]":
          this.simple("rightBracket", start, 1);
          this.closeBracket();
          break;
        case "{":
          this.simple("leftBrace", start, 1);
          this.openBracket(start);
          break;
        case "}":
          this.simple("rightBrace", start, 1);
          this.closeBracket();
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
              this.wordOperatorFix(start, start + 2, "and", "Use readable 'and'")));
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
              this.wordOperatorFix(start, start + 2, "or", "Use readable 'or'")));
            this.simple("or", start, 2);
          } else this.operator("pipe", "bitOrAssign", start);
          break;
        // The embedded scanner follows the same rule as the main scanner:
        // `@` selects the contextual compiler namespace and nothing else.
        case "@":
          this.simple("at", start, 1);
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
    const comment = (this.peek() === "/" && this.peek(1) === "/") || this.blockCommentOwnsLine();
    this.atLineStart = false;

    if (blank || comment) {
      return;
    }

    // A leading-dot line continues the previous logical line: the newline
    // tokens that ended it are withdrawn and this line's indentation does not
    // open or close a block, so '.filter(...)' chains span physical lines.
    const dotWidth = this.leadingDotWidth();
    if (dotWidth > 0) {
      if (this.isChainContinuation(width)) {
        this.tokens.pop();
        return;
      }
      // The line looked like a continuation and is not one, so it is read as
      // its own statement — which it cannot be, because no statement begins
      // with a member step. Saying so here is the whole point of tightening
      // the rule: the alternative is the silent reattachment this replaces.
      this.diagnostics.push(diagnostic(
        "VEL1004",
        `A line beginning with '${dotWidth === 2 ? "?." : "."}' continues the line above it, so it must follow that line directly and be indented past the statement it continues`,
        span(start, this.index + dotWidth),
      ));
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
      this.tokens.push({ kind: "indent", value: "", span: span(start, this.index) });
      return;
    }

    if (width < current) {
      while (this.indentStack.length > 1 && width < (this.indentStack.at(-1) ?? 0)) {
        this.indentStack.pop();
        this.classBodyStack.pop();
        this.tokens.push({ kind: "dedent", value: "", span: span(start, this.index) });
      }

      if (width !== (this.indentStack.at(-1) ?? 0)) {
        this.diagnostics.push(diagnostic("VEL1004", "Indentation does not match an outer block", span(start, this.index)));
      }
    }
  }

  /** The width of a leading member step, or 0 where the line does not open with one. */
  private leadingDotWidth(): number {
    const width = this.peek() === "." ? 1 : this.peek() === "?" && this.peek(1) === "." ? 2 : 0;
    // '.5' is a decimal literal with its leading digit missing, not a member
    // step, and it carries its own diagnostic.
    return width > 0 && this.isIdentifierStart(this.peek(width)) ? width : 0;
  }

  /**
   * Whether the leading-dot line at `width` joins the line above it. Two
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
  private isChainContinuation(width: number): boolean {
    const index = this.tokens.length - 1;
    if (this.tokens[index]?.kind !== "newline") return false;
    if (this.tokens[index - 1]?.kind === "newline") return false;
    const previous = this.tokens[index - 1];
    if (previous === undefined || !chainContinuationEndKinds.has(previous.kind)) return false;
    return width > this.logicalLineIndent;
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
  private recoverUnclosedBrackets(): void {
    const opening = this.openBrackets[0];
    if (opening === undefined) return;
    let cursor = this.index;
    let width = 0;
    while (cursor < this.text.length && (this.text[cursor] === " " || this.text[cursor] === "\t")) {
      width += this.text[cursor] === "\t" ? 4 : 1;
      cursor += 1;
    }
    // An arrow body's statements are the parser's to report: VEL2030 names the
    // remedy, and a '}' one line down means the bracket was never unclosed in
    // the first place. Recovering here would trade a teaching diagnostic for a
    // structural one.
    if (opening.arrowBody) return;
    if (width > opening.lineIndent) return;
    let end = cursor;
    while (end < this.text.length && this.isIdentifierPart(this.text[end] ?? "")) end += 1;
    if (!statementHeadWords.has(this.text.slice(cursor, end))) return;
    // Two of those words are ordinary names as well — `type` and `match` are
    // contextual keywords the charter keeps available (section 3) — and any of
    // them may spell a record key. What follows the word tells a declaration
    // from a read: a declaration continues with its subject (`type Name =`,
    // `match value:`, `const x`), while a read is finished, so the next thing
    // it can carry is the punctuation that separates or closes it. A statement
    // head is never followed by one of those, which is what makes withholding
    // on them cost nothing.
    if (statementReadFollowers.has(this.text[this.skipHorizontalWhitespace(end)] ?? "")) return;

    this.diagnostics.push(diagnostic(
      "VEL1003",
      `Unclosed '${opening.text}'; the line below it starts a new declaration, so VelarScript reads on from there rather than to the end of the module`,
      opening.span,
    ));
    this.openBrackets.length = 0;
    this.nesting = 0;
    this.tokens.push({ kind: "newline", value: "", span: span(this.index, this.index) });
    this.atLineStart = true;
  }

  private openBracket(start: number): void {
    this.nesting += 1;
    if (this.bracketFragment) return;
    const lineStart = this.lineStart(start);
    let width = 0;
    for (let cursor = lineStart; cursor < start; cursor += 1) {
      if (this.text[cursor] === " ") width += 1;
      else if (this.text[cursor] === "\t") width += 4;
      else break;
    }
    // A '{' straight after '=>' is an arrow body, and a statement inside one is
    // exactly what VEL2030 exists to report — a message that names the fix
    // ("move multi-statement logic into a named 'def'") where VEL1003 only
    // reports structure. Recovery yields to it; see recoverUnclosedBrackets.
    // The '{' token is pushed by the caller before this runs, so the arrow — if
    // there is one — sits one further back.
    const arrowBody = (this.text[start] ?? "") === "{" && this.tokens[this.tokens.length - 2]?.kind === "fatArrow";
    this.openBrackets.push({ span: span(start, start + 1), text: this.text[start] ?? "(", lineIndent: width, arrowBody });
  }

  private closeBracket(): void {
    this.nesting = Math.max(0, this.nesting - 1);
    this.openBrackets.pop();
  }

  // D89: a line comment carries no token, but it may carry a `velar-allow`
  // suppression, so its text is read once here. A malformed suppression is a
  // diagnostic rather than an advisory: an unreasoned one may not pass.
  private readComment(): void {
    const start = this.index;
    const bodyStart = this.text.startsWith("//", start) ? start + 2 : start;
    while (!this.isAtEnd() && this.peek() !== "\n" && this.peek() !== "\r") {
      this.advance();
    }
    const scanned = scanAdvisorySuppressions(this.text, start, bodyStart, this.index);
    this.suppressions.push(...scanned.suppressions);
    this.diagnostics.push(...scanned.diagnostics);
    if (bodyStart !== start) this.adviseFloorDivisionComment(start, bodyStart, scanned.contentEnd);
  }

  /**
   * D89 A1: `//` is VelarScript's only comment spelling, so a Python author's
   * floor division reads as a finished line followed by a comment and the
   * compiler has nothing to object to. The spelling cannot be removed — `#`
   * already means something else (VEL1005) — so an advisory is the only
   * remaining move.
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
  private adviseFloorDivisionComment(start: number, bodyStart: number, contentEnd: number): void {
    if (this.bracketFragment) return;
    const lineStart = this.lineStart(start);
    if (this.text.slice(lineStart, start).trim() === "") return;
    const previous = this.tokens.at(-1);
    if (!previous || previous.span.end <= lineStart || !floorDivisionDividendEndKinds.has(previous.kind)) return;
    if (this.hasBracketOpenedOnLine(lineStart)) return;
    const body = this.text.slice(bodyStart, contentEnd).trim();
    if (!/[0-9]/u.test(body) || !/^[0-9\s+\-*/%()]+$/u.test(body)) return;
    const division = floorDivisionRewrite(body);
    if (division === null) return;

    const dividend = this.dividendBeforeComment(lineStart, start);
    if (!dividend) return;
    const rewrite = `(${dividend.value} / ${division.divisor}).floor()${division.tail}`;
    this.advisories.push(advisory(
      "A1",
      dividend.target === null
        ? `'//' is VelarScript's comment spelling, so the rest of this line is a comment and nothing divides '${dividend.value}'; write '${rewrite}' for Python's floor division`
        : `'//' is VelarScript's comment spelling, so '${dividend.target}' receives '${dividend.value}' and the rest of this line is a comment; write '${rewrite}' for Python's floor division`,
      span(start, contentEnd),
    ));
  }

  /**
   * Whether a bracket opened on this physical line is still open at the
   * comment. This is the "syntactically complete" half of A1's trigger that
   * `nesting` was standing in for: `nesting` also counts a bracket opened three
   * lines up, whose text before the `//` is complete all the same.
   */
  private hasBracketOpenedOnLine(lineStart: number): boolean {
    const innermost = this.openBrackets.at(-1);
    return innermost !== undefined && innermost.span.start >= lineStart;
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
    let index = this.tokens.length - 1;
    let depth = 0;
    while (index >= 0 && this.tokens[index]!.span.end > lineStart) {
      const kind = this.tokens[index]!.kind;
      if (kind === "rightParen" || kind === "rightBracket" || kind === "rightBrace") depth += 1;
      else if (kind === "leftParen" || kind === "leftBracket" || kind === "leftBrace") {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0 && !primaryTailKinds.has(kind)) break;
      index -= 1;
    }
    if (depth !== 0) return null;
    const sign = this.tokens[index];
    if (sign !== undefined && sign.span.end > lineStart && (sign.kind === "minus" || sign.kind === "plus")) {
      const before = this.tokens[index - 1];
      const operandStandsBefore = before !== undefined
        && before.span.end > lineStart
        && !lineBoundaryKinds.has(before.kind)
        && (floorDivisionDividendEndKinds.has(before.kind) || before.kind === "rightBrace");
      if (!operandStandsBefore) index -= 1;
    }

    const first = this.tokens[index + 1];
    if (!first || first.span.end <= lineStart) return null;
    // A leading-dot continuation line holds only the tail of its dividend: the
    // walk is bounded by this physical line, so on `const c = xs` / `.size // 2`
    // it stops at the line's own first token, the `.`. Quoting from there gave
    // `'.size'` and suggested `(.size / 2).floor()`, which does not parse. The
    // head lives on a line this advisory does not read, so there is no rewrite
    // to name and D89's admission bar withholds the advisory (D90).
    if (first.kind === "dot" || first.kind === "optionalDot") return null;
    const value = this.text.slice(first.span.start, commentStart).trim();
    if (value === "") return null;
    const boundary = this.tokens[index];
    const name = this.tokens[index - 1];
    const assigned = boundary !== undefined && boundary.span.end > lineStart && boundary.kind === "assign";
    return { target: assigned && name?.kind === "identifier" ? name.value : null, value };
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
    const previous = this.tokens.at(-1)?.kind;
    // D90 (compiler-front-9): a rule's ban is on the spelling as a binding, a
    // parameter and a type; some of them are ordinary member names and record
    // keys. `int` remains forbidden as a type, but velar/random owns the method
    // spelling Random.int(...); `with` remains forbidden as the infix record
    // update, but `Array.prototype.with` and every builder API spelled that way
    // must be callable, and `{with: 1}` must be writable. The exemption is a
    // property of the rule (`memberLegal`) rather than a name spelled here, so
    // `eval` — which the charter keeps unavailable through direct member
    // syntax — does not travel with them.
    const declared = forbiddenSourceIdentifiers.get(value);
    // D90 (coherence): `def close(this)` used to earn two mechanical fixes on
    // one span — this rule's `this` -> `self` rewrite and the analyzer's
    // delete-the-implicit-receiver rewrite — whose texts contradict each
    // other. Applying the first produces `def close(self)`, which is itself an
    // error, so a `velar fix` pass never reaches a clean source. The receiver
    // parameter is the analyzer's report to make: it knows the declaration has
    // an implicit receiver, and its fix deletes the parameter outright. The
    // recovery token is still emitted, so the parameter arrives as `self` and
    // lands on exactly that report.
    const receiverParameter = value === "this" && this.isReceiverParameterPosition(previous);
    const rule = declared?.memberLegal === true && this.isMemberNamePosition(previous) ? undefined : declared;
    const extensionGuidance = rule ? undefined : this.extensionForbiddenIdentifiers.get(value);
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
        if (!receiverParameter) this.diagnostics.push(recoveredDiagnostic("VEL1005", rule.guidance, span(start, this.index),
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

  /**
   * The three positions in which a name is a member name rather than a binding:
   * after a member step, as a record-literal key, and as the name of a member
   * declared in a class body. The first two are the reads — `q.with("cte")`,
   * `{with: 1}` — and the third is the declaration an extern module needs to
   * describe such an API at all.
   *
   * A class body is the only place the declaration is legal: `def with(...)`
   * outside one binds a name, and the generated module would say
   * `function with`, which is not JavaScript.
   */
  private isMemberNamePosition(previous: TokenKind | undefined): boolean {
    if (previous === "dot" || previous === "optionalDot") return true;
    // A record key is followed by ':' — `{with: 1}` and `{a: 1, with: 2}`. The
    // preceding '{' or ',' is what separates a key from an argument in a call.
    if ((previous === "leftBrace" || previous === "comma")
      && this.text[this.skipHorizontalWhitespace(this.index)] === ":") return true;
    const declaring = previous === "def"
      || (previous === "identifier" && (this.tokens.at(-1)?.value === "get" || this.tokens.at(-1)?.value === "set"));
    return declaring && (this.classBodyStack.at(-1) ?? false);
  }

  /**
   * D90 (coherence): the one position where `this` is the Python receiver
   * reflex rather than JavaScript's dynamic receiver — a parameter name in the
   * list of an instance method or a constructor inside a class body. The
   * analyzer owns that report, because only it knows the declaration carries
   * an implicit receiver, and its rewrite deletes the parameter instead of
   * renaming it to a spelling that is an error in the same position.
   *
   * The walk is paren-balanced so a default value cannot be mistaken for the
   * list that encloses it — `def m(a = f(this))` is an ordinary receiver read
   * — and `static def make(this)` is excluded because a static method has no
   * receiver to delete, so the rename is still the honest answer there.
   */
  private isReceiverParameterPosition(previous: TokenKind | undefined): boolean {
    if (previous !== "leftParen" && previous !== "comma") return false;
    if (!(this.classBodyStack.at(-1) ?? false)) return false;
    let depth = 0;
    let index = this.tokens.length - 1;
    for (let steps = 0; index >= 0 && steps < RECEIVER_PARAMETER_SCAN_LIMIT; steps += 1, index -= 1) {
      const kind = this.tokens[index]!.kind;
      if (kind === "rightParen") depth += 1;
      else if (kind === "leftParen") {
        if (depth === 0) break;
        depth -= 1;
      } else if (lineBoundaryKinds.has(kind) && depth === 0 && kind !== "newline") return false;
    }
    if (index < 0 || this.tokens[index]?.kind !== "leftParen") return false;
    let head = index - 1;
    // A generic method writes its parameters after the type parameter list, so
    // `def m<T>(this)` has to walk back over a balanced '<...>' to reach the
    // name that says which declaration this list belongs to.
    if (this.tokens[head]?.kind === "greater") {
      let angle = 0;
      for (let steps = 0; head >= 0 && steps < RECEIVER_PARAMETER_SCAN_LIMIT; steps += 1, head -= 1) {
        const kind = this.tokens[head]!.kind;
        if (kind === "greater") angle += 1;
        else if (kind === "less" && (angle -= 1) === 0) {
          head -= 1;
          break;
        }
      }
    }
    const name = this.tokens[head];
    if (name?.kind !== "identifier") return false;
    if (name.value === "constructor") return true;
    return this.tokens[head - 1]?.kind === "def" && this.tokens[head - 2]?.kind !== "static";
  }

  private readNumber(): void {
    const start = this.index;
    if (this.peek() === "0" && ["x", "X", "b", "B", "o", "O"].includes(this.peek(1))) {
      this.readRadixNumber();
      return;
    }
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
    // LOK-I5: where the percentage unit does not exist, Core still reads `50%`
    // as the percentage shape in the positions where no remainder operand can
    // follow — end of line, `)`, `]`, `,` — so the author gets the unit's own
    // guidance instead of a statement-continuation error about a spelling they
    // never meant as arithmetic. `10 % 3` and `10%3` both keep a right operand
    // and stay remainder in Core.
    if (this.peek() === "%" && (this.numericSuffixes.has("%") || this.isPercentUnitPosition())) this.advance();
    else while (this.isIdentifierPart(this.peek())) this.advance();
    const suffix = this.text.slice(numberEnd, this.index);
    if (suffix && this.numericSuffixes.has(suffix)) {
      this.pushNumber("unitNumber", `${value}${suffix}`, span(start, this.index));
      return;
    }
    if (suffix) {
      const radix = integer === "0" && suffix.length > 1 ? suffix[0]?.toLowerCase() : null;
      const radixName = radix === "x" ? "Hexadecimal" : radix === "b" ? "Binary" : radix === "o" ? "Octal" : null;
      // The unit vocabulary is the Web extension's. A Core file that spells a
      // Look unit names the extension that owns it and how to enable it —
      // D37 rule 45's cross-extension voice — instead of calling a perfectly
      // good spelling unknown.
      const owner = webNumericUnitOwner(suffix);
      this.diagnostics.push(diagnostic(
        "VEL1007",
        radixName
          ? `${radixName} literals are not part of VelarScript; write the decimal value`
          : owner
            ? `The numeric unit '${suffix}' belongs to ${owner}; add "${owner}" to velar.json extensions, or move this module into a Web project`
            : this.numericSuffixes.size > 0
              ? `Unknown numeric unit '${suffix}'`
              : `Unexpected characters '${suffix}' after a number`,
        span(numberEnd, this.index),
      ));
    }
    this.pushNumber("number", value, span(start, numberEnd));
  }

  private readRadixNumber(): void {
    const start = this.index;
    const prefix = this.peek(1).toLowerCase();
    const radix = prefix === "x" ? 16 : prefix === "b" ? 2 : 8;
    const radixName = radix === 16 ? "hexadecimal" : radix === 2 ? "binary" : "octal";
    this.advance();
    this.advance();
    let digits = "";
    let sawDigit = false;
    while (this.isIdentifierPart(this.peek())) {
      const character = this.peek();
      if (character === "_") {
        const separator = this.index;
        const previous = this.text[this.index - 1] ?? "";
        const next = this.peek(1);
        this.advance();
        if (!this.isRadixDigit(previous, radix) || !this.isRadixDigit(next, radix)) {
          this.diagnostics.push(diagnostic("VEL1007", "Numeric separators must appear only between digits", span(separator, this.index)));
        }
        continue;
      }
      if (!this.isRadixDigit(character, radix)) {
        const invalidStart = this.index;
        while (this.isIdentifierPart(this.peek())) this.advance();
        this.diagnostics.push(diagnostic("VEL1007", `Invalid digit in ${radixName} integer literal`, span(invalidStart, this.index)));
        break;
      }
      sawDigit = true;
      digits += this.advance();
    }
    if (!sawDigit) {
      this.diagnostics.push(diagnostic("VEL1007", `${radixName[0]!.toUpperCase()}${radixName.slice(1)} integer literals require at least one digit`, span(start, this.index)));
      digits = "0";
    }
    this.pushNumber("number", `0${prefix}${digits}`, span(start, this.index));
  }

  /**
   * A number token, carrying the author's own spelling whenever the value it
   * holds is spelled differently — `1_000` loses its separators and `0X20`
   * loses its uppercase prefix on the way to the token. D90 R6 quotes the
   * literal back when it is not exactly representable, and it must quote what
   * was written: reporting `'10000000000000000001'` for a source line that
   * reads `1_000_000_000_000_000_000_1` sends the author looking for text that
   * is not there.
   */
  private pushNumber(kind: "number" | "unitNumber", value: string, tokenSpan: Span): void {
    const written = this.text.slice(tokenSpan.start, tokenSpan.end);
    if (written === value) {
      this.tokens.push({ kind, value, span: tokenSpan });
      return;
    }
    this.tokens.push({ kind, value, span: tokenSpan, payload: { written } satisfies NumberTokenPayload });
  }

  private isRadixDigit(character: string, radix: number): boolean {
    if (character >= "0" && character <= "9") return Number(character) < radix;
    if (radix !== 16) return false;
    const lower = character.toLowerCase();
    return lower >= "a" && lower <= "f";
  }

  /**
   * LOK-I5: `%` right after a number is the percentage unit only where a
   * remainder operator could not stand — the operator always takes a right
   * operand, so a `%` followed by a line end, a closing bracket, or a
   * separator is a unit spelling and nothing else.
   */
  private isPercentUnitPosition(): boolean {
    const next = this.peek(1);
    return next === "\0" || next === "\n" || next === "\r" || next === ")" || next === "]" || next === "}" || next === "," || next === ";" || next === ":";
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
    this.pushNumber("number", value, span(start, this.index));
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

  private readEmbeddedJavaScript(scanned: NonNullable<ReturnType<typeof scanEmbeddedJavaScriptLiteral>>): void {
    this.index = scanned.end;
    if (!scanned.openingLineBreak) {
      this.diagnostics.push(diagnostic(
        "VEL1003",
        "An inline JavaScript source block begins on the line after its opening backtick",
        span(scanned.start, Math.min(this.text.length, scanned.start + 1)),
      ));
    }
    if (!scanned.closed) {
      this.diagnostics.push(diagnostic(
        "VEL1003",
        scanned.kind === "checked"
          ? "Unterminated checked JavaScript source block; close it with '`:' alone at the declaration's indentation"
          : "Unterminated unsafe JavaScript source block; close it with '`' alone at the declaration's indentation",
        span(scanned.start, scanned.end),
      ));
    }
    const sourceSpan = span(scanned.sourceStart, scanned.sourceEnd);
    this.tokens.push({
      kind: "string",
      value: this.text.slice(sourceSpan.start, sourceSpan.end),
      span: span(scanned.start, scanned.end),
      payload: {
        embeddedJavaScript: true,
        kind: scanned.kind,
        sourceSpan,
      } satisfies EmbeddedJavaScriptTokenPayload,
    });
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
      this.advisories.push(...result.advisories ?? []);
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
      const point = codePoint.toString(16).toUpperCase().padStart(4, "0");
      this.diagnostics.push(diagnostic(
        "VEL1009",
        `Bidirectional control U+${point} cannot appear directly in VelarScript source; write it inside a string as '\\u{${point}}' so the source remains reviewable`,
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

  private invalidCharacter(character: string, start: number): void {
    this.advance();
    if (this.diagnosedBidirectionalOffsets.has(start) || this.isBidirectionalControl(character.codePointAt(0)!)) return;
    this.diagnostics.push(diagnostic(
      "VEL1001",
      character === "\uFEFF"
        ? "Unexpected UTF-8 BOM (U+FEFF); remove the BOM or save the file as UTF-8 without BOM"
        : `Unexpected character '${character}'`,
      span(start, this.index),
    ));
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
