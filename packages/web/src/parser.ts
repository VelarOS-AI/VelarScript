import type { Diagnostic, Span } from "@velarscript/compiler";
import {
  Parser,
  type CompilerLexicalExtension,
  type Expression,
  type Statement,
  type Token,
} from "@velarscript/compiler/extension";
import {
  WEB_JSX_TOKEN,
  WEB_LOOK_TOKEN,
  type WebExpressionSource,
  type WebJsxElementSyntax,
  type WebLookBlockSyntax,
  type WebLookLineSyntax,
} from "./lexer.ts";

type ComponentDeclaration = Extract<Statement, { kind: "ComponentDeclaration" }>;
type ComponentItem = ComponentDeclaration["body"][number];
type StateDeclaration = Extract<Statement, { kind: "StateDeclaration" }>;
type ComputedDeclaration = Extract<Statement, { kind: "ComputedDeclaration" }>;
type ResourceDeclaration = Extract<Statement, { kind: "ResourceDeclaration" }>;
type ActionDeclaration = Extract<Statement, { kind: "ActionDeclaration" }>;
type WatchDeclaration = Extract<Statement, { kind: "WatchDeclaration" }>;
type UnsafeCssImportDeclaration = Extract<Statement, { kind: "UnsafeCssImportDeclaration" }>;
type LookExpression = Extract<Expression, { kind: "LookExpression" }>;
type LookEntry = LookExpression["entries"][number];
type JSXElementExpression = Extract<Expression, { kind: "JSXElementExpression" }>;

const span = (start: number, end: number): Span => ({ start, end });
const diagnostic = (code: string, message: string, sourceSpan: Span): Diagnostic => ({ code, message, span: sourceSpan });
const recoveredDiagnostic = (code: string, message: string, sourceSpan: Span): Diagnostic => ({ code, message, span: sourceSpan, recovered: true });
const renderBlockSpellings = new Set(["render", "show", "view"]);

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
    if (this.current().kind === "extensionKeyword" && this.current().value === "look"
      && this.peekKind(1) === "identifier" && this.peekKind(2) === "colon") {
      const keyword = this.advance();
      const name = this.advance();
      this.diagnostics.push(diagnostic(
        "VEL5038",
        `Use 'const ${name.value} = look:'; Look is a value that is attached to an element with look={${name.value}}`,
        span(keyword.span.start, name.span.end),
      ));
      this.skipMistypedDeclaration();
      return { kind: "PassStatement", span: span(keyword.span.start, name.span.end) };
    }
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
      return this.parseActionDeclaration(start, modifiers.exported);
    }
    if (this.matchExtensionKeyword("watch")) {
      if (modifiers.exported) this.diagnostics.push(diagnostic("VEL2001", "A watch block cannot be exported", this.previous().span));
      return this.parseWatchDeclaration(start);
    }
    return undefined;
  }

  protected override parseExtensionImport(start: number): Statement | null | undefined {
    if (!this.matchExtensionKeyword("css")) return undefined;
    this.expect("unsafe", "Native CSS is an unsafe boundary; write 'import css unsafe'");
    const source = this.expect("string", "Expected a relative .css path after 'import css unsafe'");
    let placement: "before" | "after" = "before";
    if (this.current().kind === "identifier" && this.current().value === "before") {
      this.expect("identifier", "Expected 'before'");
      placement = "before";
    } else if (this.current().kind === "identifier" && this.current().value === "after") {
      this.expect("identifier", "Expected 'after'");
      placement = "after";
    } else this.diagnostics.push(diagnostic("VEL5037", "Unsafe CSS must explicitly declare 'before look' or 'after look'", this.current().span));
    if (!this.matchExtensionKeyword("look")) {
      this.diagnostics.push(diagnostic("VEL5037", "Unsafe CSS order must end with 'look'", this.current().span));
    }
    if ((!source.value.startsWith("./") && !source.value.startsWith("../")) || !source.value.endsWith(".css")) {
      this.diagnostics.push(diagnostic("VEL5037", "Unsafe CSS imports require an explicit relative path ending in '.css'", source.span));
    }
    return { kind: "UnsafeCssImportDeclaration", source: source.value, placement, span: span(start, this.previous().span.end) } satisfies UnsafeCssImportDeclaration;
  }

  protected override parseExtensionExpression(token: Token): Expression | undefined {
    if (token.kind === "extensionToken" && token.value === WEB_JSX_TOKEN) {
      const syntax = token.payload as WebJsxElementSyntax | undefined;
      if (!syntax || syntax.kind !== "WebJsxElementSyntax") {
        this.diagnostics.push(diagnostic("VEL5001", "The Web JSX token is missing its structured syntax", token.span));
        return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
      }
      return jsxExpression(syntax, (source) => this.parseJsxEmbedded(source), (item) => this.diagnostics.push(item));
    }
    if (token.kind !== "extensionKeyword" || token.value !== "look") return undefined;
    this.expect("colon", "Expected ':' after 'look'");
    this.expect("newline", "Expected a newline before Look entries");
    this.consumeNewlines();
    this.expect("indent", "Expected an indented Look block");
    const block = this.expect("extensionToken", "Expected Look entries");
    const syntax = block.value === WEB_LOOK_TOKEN ? block.payload as WebLookBlockSyntax | undefined : undefined;
    if (!syntax || syntax.kind !== "WebLookBlockSyntax") {
      this.diagnostics.push(diagnostic("VEL5038", "The Look block is missing its structured syntax", block.span));
    }
    this.consumeNewlines();
    this.expect("dedent", "Expected the end of the Look block");
    const entries = new LookSourceParser(
      syntax ?? { kind: "WebLookBlockSyntax", lines: [], span: block.span },
      (text, offset, openingIndent) => openingIndent
        ? this.parseNestedExpression(openingIndent + text, offset - openingIndent.length, true)
        : this.parseNestedExpression(text, offset),
      (item) => this.diagnostics.push(item),
    ).parse();
    return { kind: "LookExpression", entries, span: span(token.span.start, block.span.end) };
  }

  // A '{for item in items: ...}' block inside JSX gets targeted guidance to
  // '.map(...)' instead of an expression-parse cascade; there is no magic JSX
  // control flow. The child recovers as an inert null literal so the rest of
  // the module still analyzes and reports its own guidance in the same compile.
  private parseJsxEmbedded(source: WebExpressionSource): Expression {
    if (/^\s*for\b/u.test(source.source)) {
      const detail = /^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^:{\n]+):/u.exec(source.source);
      const binding = detail?.[1] ?? "item";
      const iterable = detail?.[2]?.trim() || "items";
      this.diagnostics.push({
        code: "VEL5049",
        message: `Use '{${iterable}.map((${binding}) => ...)}'; JSX has no 'for' blocks, so lists render with '.map(...)'`,
        span: source.span,
        recovered: true,
      });
      return { kind: "LiteralExpression", value: null, raw: "null", span: source.span };
    }
    // JSX interpolation braces are a bracket context: the expression inside
    // '{...}' continues across physical lines exactly as inside parentheses.
    const layoutAtStart = /^[ \t]*(?:rf|fr|f|r)?["'](?:\r\n|\r|\n)/u.test(source.source);
    return layoutAtStart
      ? this.parseNestedExpression(
        source.openingIndent + source.source,
        source.span.start - source.openingIndent.length,
        true,
      )
      : this.parseNestedExpression(source.source, source.span.start, true);
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
    if (this.check("less")) {
      this.parseTypeParameters();
      this.diagnostics.push(diagnostic("VEL2025", `Component '${name.value}' cannot declare type parameters; only 'def' functions take '<T>'`, name.span));
    }
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
      } else if (this.check("identifier") && renderBlockSpellings.has(this.current().value) && this.peekKind(1) === "colon") {
        const keyword = this.advance();
        this.diagnostics.push(diagnostic(
          "VEL5048",
          `Use 'return <...>'; a component returns its JSX directly and has no '${keyword.value}:' block`,
          keyword.span,
        ));
        this.skipMistypedDeclaration();
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

function jsxExpression(
  syntax: WebJsxElementSyntax,
  parseExpression: (source: WebExpressionSource) => Expression,
  report: (item: Diagnostic) => void,
): JSXElementExpression {
  return {
    kind: "JSXElementExpression",
    tag: syntax.tag,
    attributes: syntax.attributes.map((attribute) => ({
      name: attribute.name,
      value: typeof attribute.value === "object" && attribute.value !== null
        ? parseExpression(attribute.value)
        : attribute.value,
      span: attribute.span,
    })),
    children: syntax.children.map((child) => {
      if (child.kind === "WebJsxElementSyntax") return jsxExpression(child, parseExpression, report);
      if (child.kind === "WebJsxExpressionSyntax") {
        return { kind: "JSXExpressionChild", expression: parseExpression(child.expression), span: child.span };
      }
      // A bare (unbraced) 'for name in expr:' line written directly as JSX
      // content receives the same .map() guidance as its braced spelling;
      // there is no magic JSX control flow.
      const bareFor = /(?:^|\n)[ \t]*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^:{<\n]+):/u.exec(child.value);
      if (bareFor) {
        const offset = child.span.start + (bareFor.index + bareFor[0].indexOf("for"));
        report(recoveredDiagnostic(
          "VEL5049",
          `Use '{${bareFor[2]!.trim()}.map((${bareFor[1]}) => ...)}'; JSX has no 'for' blocks, so lists render with '.map(...)'`,
          span(offset, offset + (bareFor[0].length - bareFor[0].indexOf("for"))),
        ));
      }
      return { kind: "JSXText", value: child.value, span: child.span };
    }),
    span: syntax.span,
  };
}

class LookSourceParser {
  private readonly lines: readonly WebLookLineSyntax[];
  private readonly blockSpan: Span;
  private readonly parseExpression: (text: string, offset: number, openingIndent?: string) => Expression;
  private readonly report: (item: Diagnostic) => void;
  private index = 0;

  constructor(
    block: WebLookBlockSyntax,
    parseExpression: (text: string, offset: number, openingIndent?: string) => Expression,
    report: (item: Diagnostic) => void,
  ) {
    this.blockSpan = block.span;
    this.parseExpression = parseExpression;
    this.report = report;
    this.lines = block.lines;
  }

  parse(): readonly LookEntry[] {
    if (this.lines.length === 0) {
      this.report(diagnostic("VEL5038", "A Look block requires at least one entry", this.blockSpan));
      return [];
    }
    return this.parseEntries(this.lines[0]!.indent);
  }

  private parseEntries(indent: number): readonly LookEntry[] {
    const entries: LookEntry[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]!;
      if (line.indent < indent) break;
      if (line.indent > indent) {
        this.report(diagnostic("VEL5038", "Unexpected Look indentation", this.lineSpan(line)));
        this.index += 1;
        continue;
      }
      this.index += 1;
      if (line.text.startsWith("if ") && line.text.endsWith(":")) {
        entries.push(this.parseIf(line, indent, "if "));
        continue;
      }
      if (line.text === "else:" || line.text.startsWith("else if ")) {
        this.report(diagnostic("VEL5038", "Look 'else' must immediately follow an 'if' at the same indentation", this.lineSpan(line)));
        continue;
      }
      // A kebab-case property receives camelCase guidance and recovers as the
      // camelCase entry, so semantic analysis still checks its value and every
      // other Look and JSX diagnostic co-reports in the same compile.
      const kebab = /^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)+)\s*=(.*)$/u.exec(line.text);
      const property = kebab
        ? null
        : /^([A-Za-z][A-Za-z0-9]*)\s*=\s*([\s\S]+)$/u.exec(line.text);
      if (kebab && kebab[2]!.trim().length === 0) {
        const camel = kebab[1]!.replace(/-+([A-Za-z])/gu, (_, letter: string) => letter.toUpperCase());
        this.report(diagnostic("VEL5038", `Use '${camel}'; Look properties use the DOM camelCase spelling`, this.lineSpan(line)));
        continue;
      }
      if (kebab || property) {
        const propertyName = kebab
          ? kebab[1]!.replace(/-+([A-Za-z])/gu, (_, letter: string) => letter.toUpperCase())
          : property![1]!;
        if (kebab) {
          this.report(recoveredDiagnostic("VEL5038", `Use '${propertyName}'; Look properties use the DOM camelCase spelling`, this.lineSpan(line)));
        }
        const assignment = line.text.indexOf("=");
        const afterAssignment = line.text.slice(assignment + 1);
        const valueText = afterAssignment.trim();
        const valueStart = line.start + assignment + 1 + (afterAssignment.length - afterAssignment.trimStart().length);
        if (/^(?:margin|padding|inset)/u.test(propertyName) && /^[+-]?\d[\w.%]*(?:\s+[+-]?\d[\w.%]*)+$/u.test(valueText)) {
          const builderArguments = valueText
            .split(/\s+/u)
            .map((token) => (/^[+-]?\d+(?:\.\d+)?$/u.test(token) ? `${token}px` : token))
            .join(", ");
          this.report(recoveredDiagnostic("VEL5038", `Use 'spacing(${builderArguments})'; Look multi-value shorthand is written with the spacing builder`, this.lineSpan(line)));
          entries.push({
            kind: "LookProperty",
            name: propertyName,
            value: { kind: "LiteralExpression", value: null, raw: "null", span: span(valueStart, valueStart + valueText.length) },
            span: this.lineSpan(line),
          });
          continue;
        }
        entries.push({
          kind: "LookProperty",
          name: propertyName,
          value: this.parseExpression(valueText, valueStart, /[\r\n]/u.test(valueText) ? line.openingIndent : undefined),
          span: this.lineSpan(line),
        });
        continue;
      }
      if (line.text.startsWith("...")) {
        const afterSpread = line.text.slice(3);
        const valueText = afterSpread.trim();
        if (!valueText) {
          this.report(diagnostic("VEL5038", "Look composition requires a value after '...'", this.lineSpan(line)));
          continue;
        }
        entries.push({
          kind: "LookSpread",
          value: this.parseExpression(valueText, line.start + 3 + (afterSpread.length - afterSpread.trimStart().length)),
          span: this.lineSpan(line),
        });
        continue;
      }
      const target = /^@([A-Za-z][A-Za-z0-9]*):$/u.exec(line.text)?.[1];
      if (!target) {
        this.report(diagnostic("VEL5038", "Look entries use 'property = value', 'if condition:', '@target:', or composition with '...'", this.lineSpan(line)));
        continue;
      }
      const next = this.lines[this.index];
      if (!next || next.indent <= line.indent) {
        this.report(diagnostic("VEL5038", `Look target '@${target}' requires an indented body`, this.lineSpan(line)));
        continue;
      }
      const children = this.parseEntries(next.indent);
      entries.push({ kind: "LookTarget", name: target, entries: children, span: span(line.start, children.at(-1)?.span.end ?? line.end) });
    }
    return entries;
  }

  private parseIf(
    line: { indent: number; text: string; start: number; end: number },
    indent: number,
    prefix: "if " | "else if ",
  ): Extract<LookEntry, { kind: "LookIf" }> {
    const conditionSource = line.text.slice(prefix.length, -1);
    const conditionText = conditionSource.trim();
    const conditionOffset = line.start + prefix.length + (conditionSource.length - conditionSource.trimStart().length);
    const condition = this.parseLookCondition(conditionText, conditionOffset);
    const next = this.lines[this.index];
    let thenEntries: readonly LookEntry[] = [];
    if (!next || next.indent <= line.indent) {
      this.report(diagnostic("VEL5038", "A Look if branch requires an indented body", this.lineSpan(line)));
    } else {
      thenEntries = this.parseEntries(next.indent);
    }

    let elseEntries: readonly LookEntry[] = [];
    const alternate = this.lines[this.index];
    if (alternate?.indent === indent && alternate.text.startsWith("else if ") && alternate.text.endsWith(":")) {
      this.index += 1;
      elseEntries = [this.parseIf(alternate, indent, "else if ")];
    } else if (alternate?.indent === indent && alternate.text === "else:") {
      this.index += 1;
      const elseBody = this.lines[this.index];
      if (!elseBody || elseBody.indent <= alternate.indent) {
        this.report(diagnostic("VEL5038", "A Look else branch requires an indented body", this.lineSpan(alternate)));
      } else {
        elseEntries = this.parseEntries(elseBody.indent);
      }
    }
    return {
      kind: "LookIf",
      condition,
      thenEntries,
      elseEntries,
      span: span(line.start, elseEntries.at(-1)?.span.end ?? thenEntries.at(-1)?.span.end ?? line.end),
    };
  }

  private parseLookCondition(text: string, absoluteOffset: number): Expression {
    const hooks = new Map<number, string>();
    let rewritten = "";
    let quote = "";
    for (let index = 0; index < text.length;) {
      const character = text[index]!;
      if (quote) {
        rewritten += character;
        if (character === "\\" && index + 1 < text.length) {
          rewritten += text[index + 1]!;
          index += 2;
          continue;
        }
        if (character === quote) quote = "";
        index += 1;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        rewritten += character;
        index += 1;
        continue;
      }
      const match = /^@([A-Za-z][A-Za-z0-9]*)/u.exec(text.slice(index));
      if (match) {
        hooks.set(absoluteOffset + index, match[1]!);
        rewritten += `_${match[1]}`;
        index += match[0].length;
        continue;
      }
      rewritten += character;
      index += 1;
    }
    const parsed = this.parseExpression(rewritten, absoluteOffset);
    return replaceLookHooks(parsed, hooks);
  }

  private lineSpan(line: { start: number; end: number }): Span {
    return span(line.start, line.end);
  }
}

function replaceLookHooks(expression: Expression, hooks: ReadonlyMap<number, string>): Expression {
  if (expression.kind === "IdentifierExpression" && hooks.has(expression.span.start)) {
    return { kind: "LookHookExpression", name: hooks.get(expression.span.start)!, span: expression.span };
  }
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (record.kind === "IdentifierExpression" && typeof record.span === "object" && record.span) {
      const sourceSpan = record.span as Span;
      const name = hooks.get(sourceSpan.start);
      if (name) return { kind: "LookHookExpression", name, span: sourceSpan };
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, key === "span" ? child : visit(child)]));
  };
  return visit(expression) as Expression;
}
