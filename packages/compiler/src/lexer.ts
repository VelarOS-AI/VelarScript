import { diagnostic, type Diagnostic } from "./diagnostic.ts";
import { span } from "./source.ts";
import { keywordKinds, type Token, type TokenKind } from "./token.ts";

const forbiddenSourceIdentifiers = new Map<string, string>([
  ["var", "Use 'let' or 'const'; VelarScript does not expose 'var'"],
  ["undefined", "Use 'none'; VelarScript does not expose 'undefined'"],
  ["null", "Use 'none'; VelarScript does not expose 'null'"],
  ["this", "Use explicit 'self' inside methods; VelarScript does not expose dynamic 'this'"],
  ["new", "Call a class directly; VelarScript does not expose 'new'"],
  ["eval", "VelarScript does not expose 'eval'"],
  ["with", "VelarScript does not expose 'with'"],
  ["arguments", "Use named parameters; VelarScript does not expose 'arguments'"],
  ["schema", "Use 'type'; VelarScript has no separate schema declaration"],
  ["effect", "Effects are compiler-internal; use watch, mounted, or cleanup"],
  ["onMount", "Use the component-level 'mounted:' block"],
  ["onMounted", "Use the component-level 'mounted:' block"],
  ["on_mount", "Use the component-level 'mounted:' block"],
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
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];
  private readonly indentStack = [0];
  private index = 0;
  private atLineStart = true;
  private nesting = 0;

  constructor(text: string) {
    this.text = text;
  }

  lex(): LexResult {
    while (!this.isAtEnd()) {
      if (this.tokens.length >= MAX_TOKENS) {
        this.diagnostics.push(diagnostic("VEL1005", `A Velar module cannot exceed ${MAX_TOKENS} tokens`, span(this.index, this.index)));
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
        if (this.isCssBlockStart()) {
          this.readCssBlock();
          continue;
        }
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

      if (character === "<" && this.shouldReadJsx()) {
        this.readJsx();
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
            this.diagnostics.push(diagnostic("VEL1005", "Use '=='; equality is already strict in VelarScript", span(start, start + 3)));
            this.simple("equal", start, 3);
          } else {
            this.simple(this.peek(1) === "=" ? "equal" : "assign", start, this.peek(1) === "=" ? 2 : 1);
          }
          break;
        case "!":
          if (this.peek(1) === "=" && this.peek(2) === "=") {
            this.diagnostics.push(diagnostic("VEL1005", "Use '!='; inequality is already strict in VelarScript", span(start, start + 3)));
            this.simple("notEqual", start, 3);
          } else if (this.peek(1) === "=") {
            this.simple("notEqual", start, 2);
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
          this.simple("pipe", start, 1);
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
    const forbidden = forbiddenSourceIdentifiers.get(value);
    const previous = this.tokens.at(-1)?.kind;
    if (forbidden) {
      this.diagnostics.push(diagnostic("VEL1005", forbidden, span(start, this.index)));
    } else if (forbiddenPrototypeMembers.has(value) && (previous === "dot" || previous === "optionalDot")) {
      this.diagnostics.push(diagnostic("VEL1005", "VelarScript does not expose prototype manipulation", span(start, this.index)));
    }
    this.tokens.push({ kind: keywordKinds[value] ?? "identifier", value, span: span(start, this.index) });
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
    this.tokens.push({ kind: "number", value: this.text.slice(start, this.index), span: span(start, this.index) });
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
        break;
      }
      if (character === "\\") {
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
    this.advance();
    const quote = this.advance();
    let value = "";
    let closed = false;

    while (!this.isAtEnd()) {
      const character = this.advance();
      if (character === quote) {
        closed = true;
        break;
      }
      if (character === "\n" || character === "\r") {
        break;
      }
      if (character === "\\") {
        const escaped = this.advance();
        value += escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped;
      } else {
        value += character;
      }
    }

    if (!closed) {
      this.diagnostics.push(diagnostic("VEL1003", "Unterminated interpolated string literal", span(start, this.index)));
    }
    this.tokens.push({ kind: "fstring", value, span: span(start, this.index) });
  }

  private shouldReadJsx(): boolean {
    if (!/[A-Za-z>]/u.test(this.peek(1))) return false;
    const previous = this.tokens.at(-1)?.kind;
    return previous === undefined || [
      "assign", "return", "fatArrow", "leftParen", "leftBracket", "leftBrace",
      "comma", "colon", "question", "newline", "indent",
    ].includes(previous);
  }

  private readJsx(): void {
    const start = this.index;
    let depth = 0;
    let finished = false;
    const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

    while (!this.isAtEnd()) {
      if (this.peek() === "{") {
        this.skipJsxExpression();
        continue;
      }
      if (this.peek() !== "<") {
        this.advance();
        continue;
      }
      if (this.text.startsWith("<!--", this.index)) {
        const close = this.text.indexOf("-->", this.index + 4);
        this.index = close === -1 ? this.text.length : close + 3;
        continue;
      }

      const tagStart = this.index;
      this.advance();
      const closing = this.peek() === "/";
      if (closing) this.advance();
      const nameStart = this.index;
      while (/[A-Za-z0-9_.:-]/u.test(this.peek())) this.advance();
      const name = this.text.slice(nameStart, this.index);
      let quote = "";
      let braces = 0;
      while (!this.isAtEnd()) {
        const character = this.advance();
        if (quote) {
          if (character === "\\") this.advance();
          else if (character === quote) quote = "";
          continue;
        }
        if (character === '"' || character === "'") quote = character;
        else if (character === "{") braces += 1;
        else if (character === "}") braces = Math.max(0, braces - 1);
        else if (character === ">" && braces === 0) break;
      }
      const tagText = this.text.slice(tagStart, this.index);
      const selfClosing = /\/\s*>$/u.test(tagText) || (name === name.toLowerCase() && voidTags.has(name));
      if (closing) depth -= 1;
      else if (!selfClosing) depth += 1;

      if ((closing || selfClosing) && depth === 0) {
        finished = true;
        break;
      }
    }

    if (!finished) {
      this.diagnostics.push(diagnostic("VEL1010", "Unterminated JSX element", span(start, this.index)));
    }
    this.tokens.push({ kind: "jsx", value: this.text.slice(start, this.index), span: span(start, this.index) });
    this.atLineStart = false;
  }

  private isCssBlockStart(): boolean {
    if (this.tokens.at(-1)?.kind !== "indent") return false;
    const beforeIndent = this.tokens.slice(0, -1);
    let index = beforeIndent.length - 1;
    if (beforeIndent[index]?.kind !== "newline") return false;
    index -= 1;
    if (beforeIndent[index]?.kind !== "colon") return false;
    index -= 1;
    if (beforeIndent[index]?.kind === "global") index -= 1;
    return beforeIndent[index]?.kind === "style";
  }

  private readCssBlock(): void {
    const contentIndent = this.indentStack.at(-1) ?? 0;
    const start = this.index;
    const lines: string[] = [];
    let cursor = this.index;

    while (cursor < this.text.length) {
      const end = this.text.indexOf("\n", cursor);
      const lineEnd = end === -1 ? this.text.length : end;
      lines.push(this.text.slice(cursor, lineEnd).replace(/\r$/u, ""));
      if (end === -1) {
        cursor = this.text.length;
        break;
      }
      const nextLine = end + 1;
      let width = 0;
      let content = nextLine;
      while (content < this.text.length && (this.text[content] === " " || this.text[content] === "\t")) {
        width += this.text[content] === "\t" ? 4 : 1;
        content += 1;
      }
      const blank = this.text[content] === "\n" || this.text[content] === "\r";
      if (!blank && width < contentIndent) {
        cursor = nextLine;
        break;
      }
      cursor = blank ? content : nextLine + Math.min(contentIndent, width);
    }

    this.index = cursor;
    this.tokens.push({ kind: "css", value: lines.join("\n").trimEnd(), span: span(start, cursor) });
    this.atLineStart = cursor < this.text.length;
  }

  private skipJsxExpression(): void {
    let depth = 0;
    let quote = "";
    while (!this.isAtEnd()) {
      const character = this.advance();
      if (quote) {
        if (character === "\\") this.advance();
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'" || character === "`") quote = character;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) return;
      }
    }
  }

  private operator(single: TokenKind, compound: TokenKind, start: number): void {
    this.simple(this.peek(1) === "=" ? compound : single, start, this.peek(1) === "=" ? 2 : 1);
  }

  private simple(kind: TokenKind, start: number, length: number): void {
    this.index += length;
    this.tokens.push({ kind, value: this.text.slice(start, this.index), span: span(start, this.index) });
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
