import { diagnostic, recoveredDiagnostic, type Diagnostic } from "./diagnostic.ts";
import type { CompilerLexicalExtension } from "./extension.ts";
import { scanInterpolatedString } from "./interpolated-string.ts";
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
  ["arguments", forbidden("Use named parameters; VelarScript does not expose 'arguments'", null)],
  ["schema", forbidden("Use 'type'; VelarScript has no separate schema declaration", [{ kind: "type", value: "type" }])],
]);

const forbiddenPrototypeMembers = new Set(["prototype", "__proto__"]);
const MAX_TOKENS = 250000;
const MAX_NESTING = 512;

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

  constructor(text: string, extensions: readonly CompilerLexicalExtension[] = []) {
    this.text = text;
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
      if (this.atLineStart && this.nesting === 0) {
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

      if (character === "f" && (this.peek(1) === '"' || this.peek(1) === "'")) {
        this.readFString();
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

      if (character === '"' || character === "'") {
        this.readString(character);
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
          if (!this.readHexColor(start)) this.invalidCharacter(character, start);
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

  private readNewline(): void {
    const start = this.index;
    if (this.peek() === "\r" && this.peek(1) === "\n") {
      this.index += 2;
    } else {
      this.index += 1;
    }

    if (this.nesting === 0) {
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

  private readString(quote: string): void {
    const start = this.index;
    this.advance();
    let value = "";
    let closed = false;

    while (!this.isAtEnd()) {
      const character = this.advance();
      if (character === quote) {
        closed = true;
        break;
      }
      if (character === "\n" || character === "\r") {
        this.index -= 1;
        break;
      }
      if (character === "\\") {
        if (this.isAtEnd() || this.peek() === "\n" || this.peek() === "\r") break;
        const escaped = this.advance();
        value += escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped;
      } else {
        value += character;
      }
    }

    if (!closed) {
      this.diagnostics.push(diagnostic("VEL1003", "Unterminated string literal", span(start, this.index)));
    }
    this.tokens.push({ kind: "string", value, span: span(start, this.index) });
  }

  private readFString(): void {
    const start = this.index;
    const scanned = scanInterpolatedString(this.text, start);
    this.index = scanned.end;

    if (!scanned.closed) {
      this.diagnostics.push(diagnostic("VEL1003", "Unterminated interpolated string literal", span(start, this.index)));
    }
    this.tokens.push({
      kind: "fstring",
      value: this.text.slice(scanned.contentStart, scanned.contentEnd),
      span: span(start, this.index),
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
    return /[A-Za-z_]/.test(character);
  }

  private isIdentifierPart(character: string): boolean {
    return /[A-Za-z0-9_]/.test(character);
  }

  private isDigit(character: string): boolean {
    return character >= "0" && character <= "9";
  }
}
