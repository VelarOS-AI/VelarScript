import { diagnostic, recoveredDiagnostic, type Diagnostic } from "./diagnostic.ts";
import type { CompilerLexicalExtension } from "./extension.ts";
import { findInterpolatedExpressionEnd, scanStringLiteral, type StringLiteralScan, type StringTokenPayload } from "./interpolated-string.ts";
import { span } from "./source.ts";
import { keywordKinds, type Token, type TokenKind } from "./token.ts";

interface ForbiddenIdentifierRule {
  readonly guidance: string;
  /**
   * Tokens to emit as if the guided spelling had been written, letting the
   * parser and analyzer report their own guidance in the same compile. A rule
   * without recovery has no unambiguous guided form, so it keeps the current
   * behavior: the diagnostic gates parsing entirely.
   */
  readonly recovery: readonly { readonly kind: TokenKind; readonly value: string }[] | null;
}

function forbidden(guidance: string, recovery: ForbiddenIdentifierRule["recovery"]): ForbiddenIdentifierRule {
  return { guidance, recovery };
}

const forbiddenSourceIdentifiers = new Map<string, ForbiddenIdentifierRule>([
  ["var", forbidden("Use 'let' or 'const'; VelarScript does not expose 'var'", [{ kind: "let", value: "let" }])],
  ["undefined", forbidden("Use 'null'; VelarScript does not expose 'undefined'", [{ kind: "null", value: "null" }])],
  ["none", forbidden("Use 'null'; VelarScript uses the Web-native empty value spelling", [{ kind: "null", value: "null" }])],
  ["None", forbidden("Use 'null'; VelarScript keywords are lowercase and Web-native", [{ kind: "null", value: "null" }])],
  ["True", forbidden("Use 'true'; VelarScript keywords are lowercase", [{ kind: "true", value: "true" }])],
  ["False", forbidden("Use 'false'; VelarScript keywords are lowercase", [{ kind: "false", value: "false" }])],
  ["elif", forbidden("Use 'else if'; VelarScript keeps ordinary readable if chains", [{ kind: "else", value: "else" }, { kind: "if", value: "if" }])],
  ["int", forbidden("Use 'number'; VelarScript has one JavaScript numeric type", [{ kind: "identifier", value: "number" }])],
  ["float", forbidden("Use 'number'; VelarScript has one JavaScript numeric type", [{ kind: "identifier", value: "number" }])],
  ["switch", forbidden("Use 'match' for strict pattern dispatch", [{ kind: "match", value: "match" }])],
  ["this", forbidden("Use explicit 'self' inside methods; VelarScript does not expose dynamic 'this'", [{ kind: "identifier", value: "self" }])],
  ["new", forbidden("Call a class directly; VelarScript does not expose 'new'", [])],
  ["eval", forbidden("VelarScript does not expose 'eval'", null)],
  ["with", forbidden("Use a record spread such as '{...value, field: next}' to build an updated record; VelarScript does not expose 'with'", null)],
]);

const forbiddenPrototypeMembers = new Set(["prototype", "__proto__"]);
const MAX_TOKENS = 250000;
const MAX_NESTING = 512;

// A logical line may continue onto the next physical line when that line's
// first token is '.' or '?.' member access (a leading-dot method chain). The
// previous line must end with a token that can end an expression, so block
// headers, operators, and empty lines never join accidentally.
const chainContinuationEndKinds = new Set<TokenKind>([
  "identifier", "extensionKeyword", "number", "unitNumber", "string", "fstring",
  "true", "false", "null", "super", "rightParen", "rightBracket", "rightBrace",
  "extensionToken",
]);

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

export class Lexer {
  private readonly text: string;
  private readonly extensionKeywords = new Map<string, string>();
  private readonly extensionForbiddenIdentifiers = new Map<string, string>();
  private readonly extensionScanners: NonNullable<CompilerLexicalExtension["scan"]>[] = [];
  private readonly numericSuffixes = new Set<string>();
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];
  private readonly indentStack = [0];
  private index = 0;
  private atLineStart = true;
  private nesting = 0;
  // A bracket fragment is an expression lexed inside an enclosing bracket
  // context, such as a JSX interpolation '{...}': newlines are insignificant
  // and physical-line indentation never opens or closes blocks, exactly as
  // between ordinary parentheses.
  private readonly bracketFragment: boolean;

  constructor(
    text: string,
    extensions: readonly CompilerLexicalExtension[] = [],
    options: { readonly bracketFragment?: boolean } = {},
  ) {
    this.text = text;
    this.bracketFragment = options.bracketFragment ?? false;
    for (const extension of extensions) {
      for (const [keyword, value] of Object.entries(extension.keywords ?? {})) {
        const existing = this.extensionKeywords.get(keyword);
        if (existing && existing !== value) throw new Error(`Compiler extensions define conflicting keyword '${keyword}'`);
        this.extensionKeywords.set(keyword, value);
      }
      for (const [name, guidance] of Object.entries(extension.forbiddenIdentifiers ?? {})) {
        this.extensionForbiddenIdentifiers.set(name, guidance);
      }
      for (const suffix of extension.numericSuffixes ?? []) this.numericSuffixes.add(suffix);
      if (extension.scan) this.extensionScanners.push(extension.scan);
    }
  }

  lex(): LexResult {
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

      if (character === "f" && this.peek(1) === "`") {
        this.readLegacyBacktick(true);
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

      if (character === "`") {
        this.readLegacyBacktick(false);
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
          this.simple("colon", start, 1);
          break;
        case ",":
          this.simple("comma", start, 1);
          break;
        case ".":
          if (this.peek(1) === "." && this.peek(2) === ".") {
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
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use '=='; equality is already strict in VelarScript", span(start, start + 3)));
            this.simple("equal", start, 3);
          } else {
            this.simple(this.peek(1) === "=" ? "equal" : "assign", start, this.peek(1) === "=" ? 2 : 1);
          }
          break;
        case "!":
          if (this.peek(1) === "=" && this.peek(2) === "=") {
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use '!='; inequality is already strict in VelarScript", span(start, start + 3)));
            this.simple("notEqual", start, 3);
          } else if (this.peek(1) === "=") {
            this.simple("notEqual", start, 2);
          } else {
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'not'; VelarScript uses readable logical operators", span(start, start + 1)));
            this.simple("not", start, 1);
          }
          break;
        case "&":
          if (this.peek(1) === "&") {
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'and'; VelarScript uses readable logical operators", span(start, start + 2)));
            this.simple("and", start, 2);
          } else {
            this.invalidCharacter(character, start);
          }
          break;
        case "<":
          this.simple(this.peek(1) === "=" ? "lessEqual" : "less", start, this.peek(1) === "=" ? 2 : 1);
          break;
        case ">":
          this.simple(this.peek(1) === "=" ? "greaterEqual" : "greater", start, this.peek(1) === "=" ? 2 : 1);
          break;
        case "|":
          if (this.peek(1) === "|") {
            this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'or'; VelarScript uses readable logical operators", span(start, start + 2)));
            this.simple("or", start, 2);
          } else {
            this.simple("pipe", start, 1);
          }
          break;
        case "#":
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
        this.diagnostics.push(diagnostic("VEL1002", "Tabs are not allowed for indentation", span(this.index, this.index + 1)));
        width += 4;
        this.advance();
      } else {
        break;
      }
    }

    const blank = this.peek() === "\n" || this.peek() === "\r" || this.isAtEnd();
    const comment = this.peek() === "/" && this.peek(1) === "/";
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

  private readIdentifier(): void {
    const start = this.index;
    while (this.isIdentifierPart(this.peek())) {
      this.advance();
    }
    const value = this.text.slice(start, this.index);
    const rule = forbiddenSourceIdentifiers.get(value);
    const extensionGuidance = rule ? undefined : this.extensionForbiddenIdentifiers.get(value);
    const previous = this.tokens.at(-1)?.kind;
    if (rule) {
      if (rule.recovery) {
        this.diagnostics.push(recoveredDiagnostic("VEL1005", rule.guidance, span(start, this.index)));
        for (const item of rule.recovery) {
          this.tokens.push({ kind: item.kind, value: item.value, span: span(start, this.index) });
        }
        return;
      }
      this.diagnostics.push(diagnostic("VEL1005", rule.guidance, span(start, this.index)));
    } else if (extensionGuidance) {
      this.diagnostics.push(diagnostic("VEL1005", extensionGuidance, span(start, this.index)));
    } else if (forbiddenPrototypeMembers.has(value) && (previous === "dot" || previous === "optionalDot")) {
      this.diagnostics.push(diagnostic("VEL1005", "VelarScript does not expose prototype manipulation", span(start, this.index)));
    }
    const extensionKeyword = this.extensionKeywords.get(value);
    const keyword = Object.hasOwn(keywordKinds, value) ? keywordKinds[value] : undefined;
    this.tokens.push({ kind: keyword ?? (extensionKeyword ? "extensionKeyword" : "identifier"), value: extensionKeyword ?? value, span: span(start, this.index) });
  }

  private readNumber(): void {
    const start = this.index;
    while (this.isDigit(this.peek())) {
      this.advance();
    }
    if (this.peek() === "." && this.isDigit(this.peek(1))) {
      this.advance();
      while (this.isDigit(this.peek())) {
        this.advance();
      }
    }
    if ((this.peek() === "e" || this.peek() === "E")
      && (this.isDigit(this.peek(1)) || ((this.peek(1) === "+" || this.peek(1) === "-") && this.isDigit(this.peek(2))))) {
      this.advance();
      if (this.peek() === "+" || this.peek() === "-") this.advance();
      while (this.isDigit(this.peek())) this.advance();
    }
    const numberEnd = this.index;
    if (this.peek() === "%" && this.numericSuffixes.has("%")) this.advance();
    else while (this.isIdentifierPart(this.peek())) this.advance();
    const suffix = this.text.slice(numberEnd, this.index);
    if (suffix && this.numericSuffixes.has(suffix)) {
      this.tokens.push({ kind: "unitNumber", value: this.text.slice(start, this.index), span: span(start, this.index) });
      return;
    }
    if (suffix) {
      this.diagnostics.push(diagnostic("VEL1007", `Unknown numeric unit '${suffix}'`, span(numberEnd, this.index)));
    }
    this.tokens.push({ kind: "number", value: this.text.slice(start, numberEnd), span: span(start, numberEnd) });
  }

  private readString(scanned: StringLiteralScan): void {
    const start = this.index;
    this.index = scanned.end;
    this.diagnoseUnknownStringEscapes(scanned);
    if (!scanned.closed) {
      const message = scanned.layout
        ? "Unterminated layout string; close it with a quote at the opening line's indentation"
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
      this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use 'rf' rather than 'fr' for raw interpolated strings", span(start, start + scanned.prefixLength)));
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
    if (scanned.recoverAtLineStart) this.atLineStart = true;
  }

  private diagnoseUnknownStringEscapes(scanned: StringLiteralScan): void {
    if (scanned.raw) return;
    const known = new Set(["\\", scanned.quote, "n", "r", "t"]);
    const sourceOffset = (index: number): number => scanned.contentOffsets?.[index] ?? scanned.contentStart + index;
    for (let index = 0; index < scanned.content.length; index += 1) {
      const character = scanned.content[index]!;
      const next = scanned.content[index + 1];
      if (character === "\\") {
        if (next !== undefined && !known.has(next)) {
          const start = sourceOffset(index);
          const shown = next === "\n" || next === "\r" ? "line break" : `\\${next}`;
          this.diagnostics.push(diagnostic(
            "VEL1008",
            `Unknown string escape '${shown}'; use '\\\\' for a literal backslash or an r\"...\" raw string`,
            span(start, sourceOffset(index + 2)),
          ));
        }
        index += Math.min(1, scanned.content.length - index - 1);
        continue;
      }
      if (!scanned.interpolated || character !== "{") continue;
      if (next === "{") {
        index += 1;
        continue;
      }
      const close = findInterpolatedExpressionEnd(scanned.content, index + 1);
      if (close < 0) break;
      index = close;
    }
  }

  private decodeStringText(value: string, raw: boolean, quote: "\"" | "'", layout: boolean): string {
    let decoded = "";
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index]!;
      const next = value[index + 1];
      if (raw && !layout && character === quote && next === quote) {
        decoded += quote;
        index += 1;
      } else if (!raw && character === "\\" && next !== undefined) {
        decoded += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next;
        index += 1;
      } else {
        decoded += character;
      }
    }
    return decoded;
  }

  private readLegacyBacktick(interpolated: boolean): void {
    const start = this.index;
    this.index += interpolated ? 2 : 1;
    const contentStart = this.index;
    while (!this.isAtEnd()) {
      const character = this.advance();
      if (character === "\\" && !this.isAtEnd()) this.advance();
      else if (character === "`") break;
    }
    const closed = this.text[this.index - 1] === "`";
    const contentEnd = closed ? this.index - 1 : this.index;
    this.diagnostics.push(recoveredDiagnostic(
      "VEL1005",
      `Use a ${interpolated ? "'f\"'" : "'\"'"} layout string; put the opening quote at the end of its line and close it after the indented text block`,
      span(start, this.index),
    ));
    if (!closed) this.diagnostics.push(diagnostic("VEL1003", "Unterminated legacy backtick string", span(start, this.index)));
    this.tokens.push({
      kind: interpolated ? "fstring" : "string",
      value: this.text.slice(contentStart, contentEnd),
      span: span(start, this.index),
      ...(interpolated ? { payload: { prefixLength: 1, quote: '"', raw: true, layout: true } satisfies StringTokenPayload } : {}),
    });
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
    ));
    this.tokens.push({ kind: "string", value: text, span: span(start, end) });
    this.index = end;
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
    this.diagnostics.push(recoveredDiagnostic("VEL1005", "Use '//' for comments; VelarScript comments start with '//'", span(start, start + 1)));
    this.index = start;
    this.advance();
    this.readComment();
    return true;
  }

  private invalidCharacter(character: string, start: number): void {
    this.advance();
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
    return /[A-Za-z_$]/.test(character);
  }

  private isIdentifierPart(character: string): boolean {
    return /[A-Za-z0-9_$]/.test(character);
  }

  private isDigit(character: string): boolean {
    return character >= "0" && character <= "9";
  }
}
