import type { Diagnostic, Span } from "@velarscript/compiler";
import { findInterpolatedExpressionEnd } from "@velarscript/compiler/extension";
import type { CompilerLexicalScanContext, CompilerLexicalScanResult, Token } from "@velarscript/compiler/extension";
import { WEB_VOID_ELEMENTS } from "./elements.ts";

export const WEB_JSX_TOKEN = "@velarscript/web:jsx";
export const WEB_LOOK_TOKEN = "@velarscript/web:look";
export const WEB_KEYFRAMES_TOKEN = "@velarscript/web:keyframes";

export interface WebExpressionSource {
  readonly source: string;
  readonly span: Span;
  readonly openingIndent: string;
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
  readonly tagSpan: Span;
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
  readonly openingIndent: string;
}

export interface WebLookBlockSyntax {
  readonly kind: "WebLookBlockSyntax";
  readonly lines: readonly WebLookLineSyntax[];
  readonly span: Span;
}

export interface WebKeyframesBlockSyntax {
  readonly kind: "WebKeyframesBlockSyntax";
  readonly lines: readonly WebLookLineSyntax[];
  readonly span: Span;
}

export function scanWebToken(context: CompilerLexicalScanContext): CompilerLexicalScanResult | null {
  const visualBlock = visualBlockKeyword(context.tokens);
  if (visualBlock) return scanVisualBlock(context, visualBlock);
  if (context.source[context.offset] !== "<" || !shouldStartJsx(context)) return null;
  const scanner = new WebJsxScanner(context.source, context.offset);
  const syntax = scanner.scan();
  return {
    token: extensionToken(WEB_JSX_TOKEN, syntax.span, syntax),
    nextOffset: syntax.span.end,
    diagnostics: scanner.diagnostics,
  };
}

/**
 * The token kinds a JSX element may follow. `<` is otherwise the less-than
 * operator, so the decision is made from the previous token: every kind here is
 * a position where a value begins and a comparison cannot. The list is published
 * in charter §14 (GRM-A3); `nullish` and `and` joined it so `{name ?? <Fallback
 * />}` parses and `{ready and <Panel />}` reaches its type rejection instead of
 * an untargeted parse cascade.
 */
export const WEB_JSX_PREVIOUS_TOKEN_KINDS: readonly string[] = [
  "assign", "return", "fatArrow", "leftParen", "leftBracket", "leftBrace",
  "comma", "colon", "question", "newline", "indent", "nullish", "and", "or",
];

function shouldStartJsx(context: CompilerLexicalScanContext): boolean {
  if (!/[A-Za-z>]/u.test(context.source[context.offset + 1] ?? "")) return false;
  const previous = context.tokens.at(-1)?.kind;
  return previous === undefined || WEB_JSX_PREVIOUS_TOKEN_KINDS.includes(previous);
}

// A Look block opens at the first indented line after `look:`. Blank lines and
// comment lines between the two produce their own newline tokens (a comment
// leaves no token of its own), so every newline in between is skipped; without
// that, a comment as the first line inside a Look block left the block
// untokenized and unravelled into a five-diagnostic cascade.
function visualBlockKeyword(tokens: readonly Token[]): "look" | "keyframes" | null {
  if (tokens.at(-1)?.kind !== "indent") return null;
  let index = tokens.length - 2;
  if (tokens[index]?.kind !== "newline") return null;
  while (tokens[index]?.kind === "newline") index -= 1;
  if (tokens[index]?.kind !== "colon") return null;
  index -= 1;
  if (tokens[index]?.kind !== "extensionKeyword") return null;
  return tokens[index]?.value === "look" || tokens[index]?.value === "keyframes" ? tokens[index]!.value as "look" | "keyframes" : null;
}

function scanVisualBlock(context: CompilerLexicalScanContext, keyword: "look" | "keyframes"): CompilerLexicalScanResult {
  const lines: WebLookLineSyntax[] = [];
  const diagnostics: Diagnostic[] = [];
  let cursor = context.offset;
  let first = true;

  while (cursor < context.source.length) {
    const physicalStart = cursor;
    const physicalLineStart = previousPhysicalLineStart(context.source, physicalStart);
    const lineBreak = nextPhysicalLineBreak(context.source, physicalStart);
    const physicalEnd = lineBreak?.start ?? context.source.length;
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
    const raw = context.source.slice(content, physicalEnd);
    const blank = raw.trim().length === 0;
    if (!first && !blank && width < context.currentIndent) break;
    if (!blank) {
      const leading = /^\s*/u.exec(raw)?.[0] ?? "";
      const text = raw.slice(leading.length).trimEnd();
      if (text && !text.startsWith("//")) {
        const start = content + leading.length;
        const openingIndent = leadingWhitespace(context.source.slice(physicalLineStart, start));
        const layout = /^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)*)\s*=\s*(?:rf|fr|f|r)?(["'])$/u.exec(text);
        const close = layout && lineBreak
          ? findLookLayoutClose(context.source, lineBreak.end, openingIndent, layout[2]!)
          : null;
        if (close) {
          lines.push({
            indent: Math.max(0, width - context.currentIndent),
            text: context.source.slice(start, close.lineEnd),
            start,
            end: close.lineEnd,
            openingIndent,
          });
          cursor = close.nextStart;
          first = false;
          continue;
        }
        lines.push({
          indent: Math.max(0, width - context.currentIndent),
          text,
          start,
          end: content + raw.length,
          openingIndent,
        });
      }
    }
    if (!lineBreak) {
      cursor = context.source.length;
      break;
    }
    cursor = lineBreak.end;
    first = false;
  }

  const tokenSpan = { start: context.offset, end: cursor };
  return {
    token: keyword === "look"
      ? extensionToken(WEB_LOOK_TOKEN, tokenSpan, { kind: "WebLookBlockSyntax", lines, span: tokenSpan } satisfies WebLookBlockSyntax)
      : extensionToken(WEB_KEYFRAMES_TOKEN, tokenSpan, { kind: "WebKeyframesBlockSyntax", lines, span: tokenSpan } satisfies WebKeyframesBlockSyntax),
    nextOffset: cursor,
    diagnostics,
    startsLine: cursor < context.source.length,
  };
}

function findLookLayoutClose(
  source: string,
  start: number,
  openingIndent: string,
  quote: string,
): { readonly lineEnd: number; readonly nextStart: number } | null {
  const openingWidth = indentationWidth(openingIndent);
  let cursor = start;
  while (cursor < source.length) {
    const lineBreak = nextPhysicalLineBreak(source, cursor);
    const lineEnd = lineBreak?.start ?? source.length;
    const line = source.slice(cursor, lineEnd);
    const indent = leadingWhitespace(line);
    const body = line.slice(indent.length);
    if (body.length > 0 && indentationWidth(indent) <= openingWidth) {
      if (indent === openingIndent && body.startsWith(quote)) {
        return { lineEnd, nextStart: lineBreak?.end ?? source.length };
      }
      return null;
    }
    if (!lineBreak) return null;
    cursor = lineBreak.end;
  }
  return null;
}

function previousPhysicalLineStart(source: string, index: number): number {
  while (index > 0 && source[index - 1] !== "\n" && source[index - 1] !== "\r") index -= 1;
  return index;
}

function leadingWhitespace(value: string): string {
  return /^[ \t]*/u.exec(value)?.[0] ?? "";
}

function indentationWidth(value: string): number {
  let width = 0;
  for (const character of value) width += character === "\t" ? 4 : 1;
  return width;
}

function nextPhysicalLineBreak(source: string, start: number): { readonly start: number; readonly end: number } | null {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "\r") return { start: index, end: index + (source[index + 1] === "\n" ? 2 : 1) };
    if (source[index] === "\n") return { start: index, end: index + 1 };
  }
  return null;
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
    const tagStart = this.index;
    const tag = this.readName();
    const tagSpan = { start: tagStart, end: this.index };
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
    if (!selfClosing && !(tag === tag.toLowerCase() && WEB_VOID_ELEMENTS.has(tag))) {
      while (this.index < this.source.length && !this.source.startsWith("</", this.index)) {
        // WEB-U13: an HTML comment inside markup is the first thing a Web author
        // reaches for. It has no JSX spelling, so it is skipped with one message
        // rather than unravelling into a five-diagnostic tag cascade.
        if (this.source.startsWith("<!--", this.index)) {
          const commentStart = this.index;
          const close = this.source.indexOf("-->", this.index + 4);
          this.index = close < 0 ? this.source.length : close + 3;
          this.report("VEL5002", "JSX has no comment form; write a '//' comment on its own line outside the markup", commentStart, this.index);
          continue;
        }
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

    return { kind: "WebJsxElementSyntax", tag, tagSpan, attributes, children, span: { start, end: this.index } };
  }

  private readEmbedded(): WebExpressionSource {
    this.expect("{", "Expected '{'");
    const start = this.index;
    const openingIndent = leadingWhitespace(this.source.slice(previousPhysicalLineStart(this.source, start), start));
    const close = findInterpolatedExpressionEnd(this.source, start);
    if (close >= 0) {
      this.index = close + 1;
      return { source: this.source.slice(start, close), span: { start, end: close }, openingIndent };
    }
    this.index = this.source.length;
    this.report("VEL5006", "Unclosed JSX expression", start - 1, this.index);
    return { source: this.source.slice(start), span: { start, end: this.index }, openingIndent };
  }

  private readQuoted(): string {
    const quote = this.source[this.index++]!;
    let value = "";
    while (this.index < this.source.length) {
      const character = this.source[this.index++]!;
      if (character === quote) return value;
      if (character === "\\" && this.index < this.source.length) value += character + this.source[this.index++]!;
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
