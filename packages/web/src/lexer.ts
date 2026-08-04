import type { Diagnostic, Span } from "@velarscript/compiler";
import type { CompilerLexicalScanContext, CompilerLexicalScanResult, Token } from "@velarscript/compiler/extension";

export const WEB_JSX_TOKEN = "@velarscript/web:jsx";
export const WEB_LOOK_TOKEN = "@velarscript/web:look";

export interface WebExpressionSource {
  readonly source: string;
  readonly span: Span;
}

export interface WebJsxAttributeSyntax {
  readonly name: string;
  readonly value: string | WebExpressionSource | null;
  readonly span: Span;
}

export type WebJsxChildSyntax = WebJsxElementSyntax | WebJsxTextSyntax | WebJsxExpressionSyntax;

export interface WebJsxElementSyntax {
  readonly kind: "WebJsxElementSyntax";
  readonly tag: string;
  readonly attributes: readonly WebJsxAttributeSyntax[];
  readonly children: readonly WebJsxChildSyntax[];
  readonly span: Span;
}

export interface WebJsxTextSyntax {
  readonly kind: "WebJsxTextSyntax";
  readonly value: string;
  readonly span: Span;
}

export interface WebJsxExpressionSyntax {
  readonly kind: "WebJsxExpressionSyntax";
  readonly expression: WebExpressionSource;
  readonly span: Span;
}

export interface WebLookLineSyntax {
  readonly indent: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface WebLookBlockSyntax {
  readonly kind: "WebLookBlockSyntax";
  readonly lines: readonly WebLookLineSyntax[];
  readonly span: Span;
}

const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

export function scanWebToken(context: CompilerLexicalScanContext): CompilerLexicalScanResult | null {
  if (isLookBlockStart(context.tokens)) return scanLookBlock(context);
  if (context.source[context.offset] !== "<" || !shouldStartJsx(context)) return null;
  const scanner = new WebJsxScanner(context.source, context.offset);
  const syntax = scanner.scan();
  return {
    token: extensionToken(WEB_JSX_TOKEN, syntax.span, syntax),
    nextOffset: syntax.span.end,
    diagnostics: scanner.diagnostics,
  };
}

function shouldStartJsx(context: CompilerLexicalScanContext): boolean {
  if (!/[A-Za-z>]/u.test(context.source[context.offset + 1] ?? "")) return false;
  const previous = context.tokens.at(-1)?.kind;
  return previous === undefined || [
    "assign", "return", "fatArrow", "leftParen", "leftBracket", "leftBrace",
    "comma", "colon", "question", "newline", "indent",
  ].includes(previous);
}

function isLookBlockStart(tokens: readonly Token[]): boolean {
  if (tokens.at(-1)?.kind !== "indent") return false;
  let index = tokens.length - 2;
  if (tokens[index]?.kind !== "newline") return false;
  index -= 1;
  if (tokens[index]?.kind !== "colon") return false;
  index -= 1;
  return tokens[index]?.kind === "extensionKeyword" && tokens[index]?.value === "look";
}

function scanLookBlock(context: CompilerLexicalScanContext): CompilerLexicalScanResult {
  const lines: WebLookLineSyntax[] = [];
  const diagnostics: Diagnostic[] = [];
  let cursor = context.offset;
  let first = true;

  while (cursor < context.source.length) {
    const physicalStart = cursor;
    const lineEndIndex = context.source.indexOf("\n", physicalStart);
    const physicalEnd = lineEndIndex === -1 ? context.source.length : lineEndIndex;
    let content = physicalStart;
    let width = first ? context.currentIndent : 0;
    if (!first) {
      while (content < physicalEnd && (context.source[content] === " " || context.source[content] === "\t")) {
        if (context.source[content] === "\t") {
          diagnostics.push(diagnostic("VEL1002", "Tabs are not allowed for indentation", { start: content, end: content + 1 }));
          width += 4;
        } else width += 1;
        content += 1;
      }
    }
    const raw = context.source.slice(content, physicalEnd).replace(/\r$/u, "");
    const blank = raw.trim().length === 0;
    if (!first && !blank && width < context.currentIndent) break;
    if (!blank) {
      const leading = /^\s*/u.exec(raw)?.[0] ?? "";
      const text = raw.slice(leading.length).trimEnd();
      if (text && !text.startsWith("//")) {
        lines.push({
          indent: Math.max(0, width - context.currentIndent),
          text,
          start: content + leading.length,
          end: content + raw.length,
        });
      }
    }
    if (lineEndIndex === -1) {
      cursor = context.source.length;
      break;
    }
    cursor = lineEndIndex + 1;
    first = false;
  }

  const tokenSpan = { start: context.offset, end: cursor };
  return {
    token: extensionToken(WEB_LOOK_TOKEN, tokenSpan, { kind: "WebLookBlockSyntax", lines, span: tokenSpan } satisfies WebLookBlockSyntax),
    nextOffset: cursor,
    diagnostics,
    startsLine: cursor < context.source.length,
  };
}

class WebJsxScanner {
  readonly diagnostics: Diagnostic[] = [];
  private readonly source: string;
  private index: number;

  constructor(source: string, start: number) {
    this.source = source;
    this.index = start;
  }

  scan(): WebJsxElementSyntax {
    this.skipWhitespace();
    return this.scanElement();
  }

  private scanElement(): WebJsxElementSyntax {
    const start = this.index;
    this.expect("<", "Expected '<' to start JSX");
    const tag = this.readName();
    const fragment = !tag && this.peek() === ">";
    if (!tag && !fragment) this.report("VEL5001", "Expected a JSX tag name or fragment", start, this.index);
    const attributes: WebJsxAttributeSyntax[] = [];
    let selfClosing = false;

    while (this.index < this.source.length) {
      this.skipWhitespace();
      if (this.index >= this.source.length) {
        this.report("VEL5004", `JSX ${fragment ? "fragment" : `element '<${tag}>'`} is not closed`, start, this.index);
        break;
      }
      if (this.source.startsWith("/>", this.index)) {
        this.index += 2;
        selfClosing = true;
        break;
      }
      if (this.peek() === ">") {
        this.index += 1;
        break;
      }
      const attributeStart = this.index;
      const name = this.readAttributeName();
      if (!name) {
        this.report("VEL5002", "Expected a JSX attribute", this.index, this.index + 1);
        this.index += 1;
        continue;
      }
      this.skipWhitespace();
      let value: string | WebExpressionSource | null = null;
      if (this.peek() === "=") {
        this.index += 1;
        this.skipWhitespace();
        if (this.peek() === '"' || this.peek() === "'") value = this.readQuoted();
        else if (this.peek() === "{") value = this.readEmbedded();
        else this.report("VEL5003", "JSX attribute values use quotes or '{...}'", this.index, this.index + 1);
      }
      attributes.push({ name, value, span: { start: attributeStart, end: this.index } });
    }

    const children: WebJsxChildSyntax[] = [];
    if (!selfClosing && !(tag === tag.toLowerCase() && voidTags.has(tag))) {
      while (this.index < this.source.length && !this.source.startsWith("</", this.index)) {
        if (this.peek() === "<") children.push(this.scanElement());
        else if (this.peek() === "{") {
          const childStart = this.index;
          const expression = this.readEmbedded();
          children.push({ kind: "WebJsxExpressionSyntax", expression, span: { start: childStart, end: this.index } });
        } else {
          const textStart = this.index;
          while (this.index < this.source.length && this.peek() !== "<" && this.peek() !== "{") this.index += 1;
          children.push({ kind: "WebJsxTextSyntax", value: this.source.slice(textStart, this.index), span: { start: textStart, end: this.index } });
        }
      }
      if (!this.source.startsWith("</", this.index)) {
        this.report("VEL5004", `JSX ${fragment ? "fragment" : `element '<${tag}>'`} is not closed`, start, this.index);
      } else {
        this.index += 2;
        const closingStart = this.index;
        const closing = this.readName();
        if (closing !== tag) {
          this.report("VEL5005", fragment ? "Expected '</>' to close the JSX fragment" : `Expected '</${tag}>' but received '</${closing}>'`, closingStart, this.index);
        }
        this.skipWhitespace();
        this.expect(">", "Expected '>' after JSX closing tag");
      }
    }

    return { kind: "WebJsxElementSyntax", tag, attributes, children, span: { start, end: this.index } };
  }

  private readEmbedded(): WebExpressionSource {
    this.expect("{", "Expected '{'");
    const start = this.index;
    let depth = 1;
    let quote = "";
    while (this.index < this.source.length) {
      const character = this.source[this.index++]!;
      if (quote) {
        if (character === "\\" && this.index < this.source.length) this.index += 1;
        else if (character === quote) quote = "";
      } else if (character === '"' || character === "'" || character === "`") quote = character;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) return { source: this.source.slice(start, this.index - 1), span: { start, end: this.index - 1 } };
      }
    }
    this.report("VEL5006", "Unclosed JSX expression", start - 1, this.index);
    return { source: this.source.slice(start), span: { start, end: this.index } };
  }

  private readQuoted(): string {
    const quote = this.source[this.index++]!;
    let value = "";
    while (this.index < this.source.length) {
      const character = this.source[this.index++]!;
      if (character === quote) return value;
      if (character === "\\" && this.index < this.source.length) value += this.source[this.index++]!;
      else value += character;
    }
    this.report("VEL5007", "Unclosed JSX attribute string", this.index, this.index);
    return value;
  }

  private readName(): string {
    const start = this.index;
    while (/[A-Za-z0-9_.:-]/u.test(this.peek())) this.index += 1;
    return this.source.slice(start, this.index);
  }

  private readAttributeName(): string {
    return this.readName();
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.peek())) this.index += 1;
  }

  private expect(character: string, message: string): void {
    if (this.peek() === character) this.index += 1;
    else this.report("VEL5001", message, this.index, this.index + 1);
  }

  private peek(): string {
    return this.source[this.index] ?? "\0";
  }

  private report(code: string, message: string, start: number, end: number): void {
    this.diagnostics.push(diagnostic(code, message, {
      start: Math.min(start, this.source.length),
      end: Math.min(Math.max(start, end), this.source.length),
    }));
  }
}

function extensionToken(value: string, tokenSpan: Span, payload: unknown): Token {
  return { kind: "extensionToken", value, span: tokenSpan, payload };
}

function diagnostic(code: string, message: string, sourceSpan: Span): Diagnostic {
  return { code, message, span: sourceSpan };
}
