import type { Diagnostic, Span } from "@velarscript/compiler";
import {
  Parser,
  type CompilerLexicalExtension,
  type Expression,
  type Statement,
  type Token,
} from "@velarscript/compiler/extension";

type ComponentDeclaration = Extract<Statement, { kind: "ComponentDeclaration" }>;
type ComponentItem = ComponentDeclaration["body"][number];
type StateDeclaration = Extract<Statement, { kind: "StateDeclaration" }>;
type ComputedDeclaration = Extract<Statement, { kind: "ComputedDeclaration" }>;
type ResourceDeclaration = Extract<Statement, { kind: "ResourceDeclaration" }>;
type ActionDeclaration = Extract<Statement, { kind: "ActionDeclaration" }>;
type WatchDeclaration = Extract<Statement, { kind: "WatchDeclaration" }>;
type JSXElementExpression = Extract<Expression, { kind: "JSXElementExpression" }>;
type JSXAttribute = JSXElementExpression["attributes"][number];
type JSXChild = JSXElementExpression["children"][number];

const span = (start: number, end: number): Span => ({ start, end });
const diagnostic = (code: string, message: string, sourceSpan: Span): Diagnostic => ({ code, message, span: sourceSpan });

export class VelarWebParser extends Parser {
  constructor(tokens: readonly Token[], lexicalExtensions: readonly CompilerLexicalExtension[]) {
    super(tokens, lexicalExtensions);
  }

  protected override createNestedParser(tokens: readonly Token[]): Parser {
    return new VelarWebParser(tokens, this.lexicalExtensions);
  }

  protected override parseExtensionStatement(
    start: number,
    modifiers: { readonly exported: boolean; readonly abstract: boolean; readonly asynchronous: boolean },
  ): Statement | null | undefined {
    if (this.matchExtensionKeyword("component")) {
      if (modifiers.abstract) this.diagnostics.push(diagnostic("VEL2013", "Only classes can be declared with 'abstract'", this.previous().span));
      if (modifiers.asynchronous) this.diagnostics.push(diagnostic("VEL2013", "Components are not declared with 'async'", this.previous().span));
      return this.parseComponent(start, modifiers.exported);
    }
    if (modifiers.abstract || modifiers.asynchronous) return undefined;
    if (this.matchExtensionKeyword("state")) return this.parseStateDeclaration(start, modifiers.exported);
    if (this.matchExtensionKeyword("computed")) return this.parseComputedDeclaration(start, modifiers.exported);
    if (this.matchExtensionKeyword("resource")) {
      if (modifiers.exported) this.diagnostics.push(diagnostic("VEL2018", "A resource is component-owned and cannot be exported", this.previous().span));
      return this.parseResourceDeclaration(start, modifiers.exported);
    }
    if (this.matchExtensionKeyword("action")) {
      if (modifiers.exported) this.diagnostics.push(diagnostic("VEL2019", "An action is component-owned and cannot be exported", this.previous().span));
      return this.parseActionDeclaration(start, modifiers.exported);
    }
    if (this.matchExtensionKeyword("watch")) {
      if (modifiers.exported) this.diagnostics.push(diagnostic("VEL2001", "A watch block cannot be exported", this.previous().span));
      return this.parseWatchDeclaration(start);
    }
    return undefined;
  }

  protected override parseExtensionExpression(token: Token): Expression | undefined {
    if (token.kind !== "jsx") return undefined;
    return new JsxSourceParser(
      token.value,
      token.span.start,
      (text, offset) => this.parseNestedExpression(text, offset),
      (item) => this.diagnostics.push(item),
    ).parse();
  }

  private parseStateDeclaration(start: number, exported: boolean): StateDeclaration {
    const name = this.expect("identifier", "Expected a state name");
    const type = this.match("colon") ? this.parseTypeReference() : null;
    this.expect("assign", "Expected '=' after state name");
    const initializer = this.parseExpression();
    return { kind: "StateDeclaration", exported, name: name.value, type, initializer, span: span(start, initializer.span.end) };
  }

  private parseComputedDeclaration(start: number, exported: boolean): ComputedDeclaration {
    const name = this.expect("identifier", "Expected a computed name");
    const type = this.match("colon") ? this.parseTypeReference() : null;
    this.expect("assign", "Expected '=' after computed name");
    const initializer = this.parseExpression();
    return { kind: "ComputedDeclaration", exported, name: name.value, type, initializer, span: span(start, initializer.span.end) };
  }

  private parseResourceDeclaration(start: number, exported: boolean): ResourceDeclaration {
    const name = this.expect("identifier", "Expected a resource name");
    const type = this.match("colon") ? this.parseTypeReference() : null;
    this.expect("assign", "Expected '=' after resource name");
    const initializer = this.parseExpression();
    return { kind: "ResourceDeclaration", exported, name: name.value, type, initializer, span: span(start, initializer.span.end) };
  }

  private parseActionDeclaration(start: number, exported: boolean): ActionDeclaration {
    const name = this.expect("identifier", "Expected an action name");
    const parameters = this.parseParameters();
    const returnType = this.match("arrow") ? this.parseTypeReference() : null;
    const body = this.parseBlock();
    const end = body.at(-1)?.span.end ?? returnType?.span.end ?? name.span.end;
    return { kind: "ActionDeclaration", exported, name: name.value, parameters, returnType, body, span: span(start, end) };
  }

  private parseWatchDeclaration(start: number): WatchDeclaration {
    const expression = this.parseExpression();
    let currentName: string | null = null;
    let previousName: string | null = null;
    if (this.match("as")) {
      currentName = this.expect("identifier", "Expected the current watch value name").value;
      this.expect("comma", "Expected ',' between watch value names");
      previousName = this.expect("identifier", "Expected the previous watch value name").value;
    }
    const body = this.parseBlock();
    return { kind: "WatchDeclaration", expression, currentName, previousName, body, span: span(start, body.at(-1)?.span.end ?? expression.span.end) };
  }

  private parseComponent(start: number, exported: boolean): ComponentDeclaration {
    const name = this.expect("identifier", "Expected a component name");
    const parameters = this.check("leftParen") ? this.parseParameters() : [];
    for (const parameter of parameters) {
      if (parameter.rest) {
        this.diagnostics.push(diagnostic("VEL2016", "Components use named props and do not support rest parameters", parameter.span));
      }
    }
    this.expect("colon", "Expected ':' before component body");
    this.expect("newline", "Expected a newline before component body");
    this.consumeNewlines();
    this.expect("indent", "Expected an indented component body");
    const body: ComponentItem[] = [];
    this.consumeNewlines();

    while (!this.check("dedent") && !this.check("eof")) {
      const itemStart = this.current().span.start;
      let item: ComponentItem | null = null;
      if (this.matchExtensionKeyword("state")) {
        item = this.parseStateDeclaration(itemStart, false);
      } else if (this.matchExtensionKeyword("computed")) {
        item = this.parseComputedDeclaration(itemStart, false);
      } else if (this.matchExtensionKeyword("resource")) {
        item = this.parseResourceDeclaration(itemStart, false);
      } else if (this.matchExtensionKeyword("action")) {
        item = this.parseActionDeclaration(itemStart, false);
      } else if (this.matchExtensionKeyword("watch")) {
        item = this.parseWatchDeclaration(itemStart);
      } else if (this.matchExtensionKeyword("mounted")) {
        const body = this.parseBlock();
        item = { kind: "MountedBlock", body, span: span(itemStart, body.at(-1)?.span.end ?? itemStart) };
      } else if (this.matchExtensionKeyword("cleanup")) {
        const body = this.parseBlock();
        item = { kind: "CleanupBlock", body, span: span(itemStart, body.at(-1)?.span.end ?? itemStart) };
      } else if (this.matchExtensionKeyword("style")) {
        const global = this.matchExtensionKeyword("global");
        this.expect("colon", "Expected ':' after style");
        this.expect("newline", "Expected a newline before component CSS");
        this.consumeNewlines();
        this.expect("indent", "Expected indented component CSS");
        const css = this.expect("css", "Expected component CSS");
        this.consumeNewlines();
        this.expect("dedent", "Expected the end of component CSS");
        item = { kind: "StyleBlock", global, css: css.value, span: span(itemStart, css.span.end) };
      } else {
        item = this.parseStatement();
      }
      if (item) body.push(item);
      if (this.previous().kind !== "dedent") this.expectStatementEnd();
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of component body");
    return { kind: "ComponentDeclaration", exported, name: name.value, parameters, body, span: span(start, body.at(-1)?.span.end ?? close.span.end) };
  }
}

class JsxSourceParser {
  private index = 0;
  private readonly voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  private readonly text: string;
  private readonly offset: number;
  private readonly parseExpression: (text: string, offset: number) => Expression;
  private readonly report: (item: Diagnostic) => void;

  constructor(
    text: string,
    offset: number,
    parseExpression: (text: string, offset: number) => Expression,
    report: (item: Diagnostic) => void,
  ) {
    this.text = text;
    this.offset = offset;
    this.parseExpression = parseExpression;
    this.report = report;
  }

  parse(): JSXElementExpression {
    this.skipWhitespace();
    return this.parseElement();
  }

  private parseElement(): JSXElementExpression {
    const start = this.index;
    this.expectCharacter("<", "Expected '<' to start JSX");
    const tag = this.readName();
    const fragment = !tag && this.peek() === ">";
    if (!tag && !fragment) this.report(diagnostic("VEL5001", "Expected a JSX tag name or fragment", this.absoluteSpan(start, this.index)));
    const attributes: JSXAttribute[] = [];
    let selfClosing = false;

    while (this.index < this.text.length) {
      this.skipWhitespace();
      if (this.text.startsWith("/>", this.index)) {
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
        this.report(diagnostic("VEL5002", "Expected a JSX attribute", this.absoluteSpan(this.index, this.index + 1)));
        this.index += 1;
        continue;
      }
      this.skipWhitespace();
      let value: string | Expression | null = null;
      if (this.peek() === "=") {
        this.index += 1;
        this.skipWhitespace();
        if (this.peek() === '"' || this.peek() === "'") {
          value = this.readQuoted();
        } else if (this.peek() === "{") {
          const embedded = this.readEmbedded();
          value = this.parseExpression(embedded.text, this.offset + embedded.start);
        } else {
          this.report(diagnostic("VEL5003", "JSX attribute values use quotes or '{...}'", this.absoluteSpan(this.index, this.index + 1)));
        }
      }
      attributes.push({ name, value, span: this.absoluteSpan(attributeStart, this.index) });
    }

    const children: JSXChild[] = [];
    if (!selfClosing && !(tag === tag.toLowerCase() && this.voidTags.has(tag))) {
      while (this.index < this.text.length && !this.text.startsWith("</", this.index)) {
        if (this.peek() === "<") {
          children.push(this.parseElement());
        } else if (this.peek() === "{") {
          const childStart = this.index;
          const embedded = this.readEmbedded();
          children.push({
            kind: "JSXExpressionChild",
            expression: this.parseExpression(embedded.text, this.offset + embedded.start),
            span: this.absoluteSpan(childStart, this.index),
          });
        } else {
          const textStart = this.index;
          while (this.index < this.text.length && this.peek() !== "<" && this.peek() !== "{") this.index += 1;
          children.push({ kind: "JSXText", value: this.text.slice(textStart, this.index), span: this.absoluteSpan(textStart, this.index) });
        }
      }
      if (!this.text.startsWith("</", this.index)) {
        this.report(diagnostic("VEL5004", `JSX ${fragment ? "fragment" : `element '<${tag}>'`} is not closed`, this.absoluteSpan(start, this.index)));
      } else {
        this.index += 2;
        const closing = this.readName();
        if (closing !== tag) this.report(diagnostic("VEL5005", fragment ? "Expected '</>' to close the JSX fragment" : `Expected '</${tag}>' but received '</${closing}>'`, this.absoluteSpan(this.index - closing.length, this.index)));
        this.skipWhitespace();
        this.expectCharacter(">", "Expected '>' after JSX closing tag");
      }
    }

    return { kind: "JSXElementExpression", tag, attributes, children, span: this.absoluteSpan(start, this.index) };
  }

  private readEmbedded(): { text: string; start: number } {
    this.expectCharacter("{", "Expected '{'");
    const start = this.index;
    let depth = 1;
    let quote = "";
    while (this.index < this.text.length) {
      const character = this.text[this.index++]!;
      if (quote) {
        if (character === "\\") this.index += 1;
        else if (character === quote) quote = "";
      } else if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) return { text: this.text.slice(start, this.index - 1), start };
      }
    }
    this.report(diagnostic("VEL5006", "Unclosed JSX expression", this.absoluteSpan(start - 1, this.index)));
    return { text: this.text.slice(start), start };
  }

  private readQuoted(): string {
    const quote = this.text[this.index++]!;
    let value = "";
    while (this.index < this.text.length) {
      const character = this.text[this.index++]!;
      if (character === quote) return value;
      if (character === "\\" && this.index < this.text.length) value += this.text[this.index++]!;
      else value += character;
    }
    this.report(diagnostic("VEL5007", "Unclosed JSX attribute string", this.absoluteSpan(this.index, this.index)));
    return value;
  }

  private readName(): string {
    const start = this.index;
    while (/[A-Za-z0-9_.:-]/u.test(this.peek())) this.index += 1;
    return this.text.slice(start, this.index);
  }

  private readAttributeName(): string {
    const start = this.index;
    while (/[A-Za-z0-9_.:-]/u.test(this.peek())) this.index += 1;
    return this.text.slice(start, this.index);
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.peek())) this.index += 1;
  }

  private expectCharacter(character: string, message: string): void {
    if (this.peek() === character) this.index += 1;
    else this.report(diagnostic("VEL5001", message, this.absoluteSpan(this.index, this.index + 1)));
  }

  private peek(): string {
    return this.text[this.index] ?? "\0";
  }

  private absoluteSpan(start: number, end: number): Span {
    return span(this.offset + start, this.offset + end);
  }
}
