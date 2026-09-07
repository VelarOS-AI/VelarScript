/**
 * The Web parser's composition root. `parser.ts` was one 1,050-line module;
 * D115 P4 R3e split the syntax families into `parser/` and left the class that
 * the Web extension registers here — its one field, the eight `protected` seams,
 * and the host every collaborator reaches back through.
 *
 * Where to look:
 *
 *  - `parser/spans.ts`                    span shifting, the three diagnostic constructors
 *  - `parser/look-source.ts`              a `look:` block's own indented source
 *  - `parser/keyframes-source.ts`         a `keyframes:` block's own indented source
 *  - `parser/statements/heads.ts`         whether a contextual word is a declaration head
 *  - `parser/statements/components.ts`    props, lifecycle names, the component item loop
 *  - `parser/statements/reactive.ts`      state, computed, resource, action, watch
 *  - `parser/statements/imports.ts`       `import css unsafe`
 *  - `parser/statements/unsafe-css.ts`    the inline `unsafe css` block and its placement
 *  - `parser/expressions/jsx.ts`          the JSX token and its interpolations
 *  - `parser/expressions/look.ts`         `look:` as a value
 *  - `parser/expressions/keyframes.ts`    `keyframes:` as a value
 *  - `parser/expressions/visual-block.ts` consuming the block those two are written in
 *
 * A collaborator never names `VelarWebParser`: it declares the interface it
 * needs, and that interface is the record of what it depends on. The host's
 * properties are live reads of the parser, because the token cursor moves under
 * a collaborator while it runs.
 */
import { type Span } from "@velarscript/compiler";
import {
  Parser,
  type CompilerLexicalExtension,
  type Expression,
  type Parameter,
  type Statement,
  type Token,
  type TypeSyntax,
} from "@velarscript/compiler/extension";
import { WEB_JSX_TOKEN } from "./lexer.ts";
import { parseJsxExpression, type JsxParserHost } from "./parser/expressions/jsx.ts";
import { parseKeyframesExpression, type KeyframesExpressionParserHost } from "./parser/expressions/keyframes.ts";
import { parseLookExpression, type LookExpressionParserHost } from "./parser/expressions/look.ts";
import { parseComponent, parseComponentProps, type ComponentParserHost } from "./parser/statements/components.ts";
import {
  actionHeaderShapes,
  blockHeaderAhead,
  componentHeaderShapes,
  exposeItemAhead,
  namedDeclarationAhead,
  reactiveBindingShapes,
} from "./parser/statements/heads.ts";
import { parseCssImport, type ImportParserHost } from "./parser/statements/imports.ts";
import {
  parseActionDeclaration,
  parseComputedDeclaration,
  parseResourceDeclaration,
  parseStateDeclaration,
  parseWatchDeclaration,
} from "./parser/statements/reactive.ts";
import { parseUnsafeCssStatement, type UnsafeCssParserHost } from "./parser/statements/unsafe-css.ts";
import { diagnostic, span } from "./parser/spans.ts";

/** Everything the Web parser's collaborators, together, read off the parser. */
type WebParserHost = ComponentParserHost
  & ImportParserHost
  & JsxParserHost
  & KeyframesExpressionParserHost
  & LookExpressionParserHost
  & UnsafeCssParserHost;

export class VelarWebParser extends Parser {
  private insideComponentProps = 0;

  private readonly host: WebParserHost;

  /**
   * The one object every collaborator is handed. Its properties are live reads
   * of the parser: the cursor moves under a collaborator, so `current()`, the
   * diagnostics array and `insideComponentProps` must be the parser's own and
   * not a snapshot taken when the host was built. `insideComponentProps` is
   * `private` here, so it arrives as an accessor pair — the component body loop
   * raises it, the prop list reads it back.
   */
  private webParserHost(): WebParserHost {
    const parser = this;
    return {
      advance: () => parser.advance(),
      check: (kind) => parser.check(kind),
      checkWord: (value) => parser.checkWord(value),
      consumeNewlines: () => parser.consumeNewlines(),
      current: () => parser.current(),
      get diagnostics() { return parser.diagnostics; },
      expect: (kind, message) => parser.expect(kind, message),
      expectStatementBoundary: () => parser.expectStatementBoundary(),
      get insideComponentProps() { return parser.insideComponentProps; },
      set insideComponentProps(value) { parser.insideComponentProps = value; },
      match: (kind) => parser.match(kind),
      matchExtensionKeyword: (value) => parser.matchExtensionKeyword(value),
      matchWord: (value) => parser.matchWord(value),
      parseBlock: () => parser.parseBlock(),
      parseExpression: (minimumPrecedence) => parser.parseExpression(minimumPrecedence),
      parseNestedExpression: (fragment, offset, bracketFragment, sourceOffsets) => parser.parseNestedExpression(fragment, offset, bracketFragment, sourceOffsets),
      parseParameters: () => parser.parseParameters(),
      parseStatement: () => parser.parseStatement(),
      parseTypeParameters: () => parser.parseTypeParameters(),
      parseTypeReference: (allowTrailingOptional) => parser.parseTypeReference(allowTrailingOptional),
      peekKind: (distance) => parser.peekKind(distance),
      peekValue: (distance) => parser.peekValue(distance),
      previous: () => parser.previous(),
      skipMistypedDeclaration: () => parser.skipMistypedDeclaration(),
    };
  }

  constructor(tokens: readonly Token[], lexicalExtensions: readonly CompilerLexicalExtension[]) {
    super(tokens, lexicalExtensions);
    this.host = this.webParserHost();
  }

  /**
   * WEB-N4: a component prop list is where a Web author reaches for the HTML
   * names, and Core's own list is what every other parameter list is read with.
   */
  protected override parseParameters(): readonly Parameter[] {
    if (this.insideComponentProps === 0) return super.parseParameters();
    return parseComponentProps(this.host);
  }

  protected override createNestedParser(tokens: readonly Token[]): Parser {
    return new VelarWebParser(tokens, this.lexicalExtensions);
  }

  protected override validateExtensionTypeArguments(name: string, arguments_: readonly TypeSyntax[], nameSpan: Span): boolean {
    if (name !== "Component") return false;
    if (arguments_.length !== 1 && arguments_.length !== 2) {
      this.diagnostics.push(diagnostic("VEL2012", "Type 'Component' expects 1 or 2 type arguments", nameSpan));
    }
    return true;
  }

  protected override parseExtensionNumericLiteral(token: Token, value: number, unit: string): Expression {
    const core = super.parseExtensionNumericLiteral(token, value, unit);
    if (core) return core;
    const expression = { kind: "ExtensionExpression:web:unit", value, unit, raw: token.value, span: token.span } as const;
    return expression;
  }

  protected override parseExtensionStatement(
    start: number,
    modifiers: { readonly exported: boolean; readonly abstract: boolean; readonly asynchronous: boolean },
  ): Statement | null | undefined {
    if (this.checkWord("look") && this.peekKind(1) === "identifier" && this.peekKind(2) === "colon") {
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
    if (namedDeclarationAhead(this.host, "component", componentHeaderShapes)) {
      this.advance();
      if (modifiers.abstract) this.diagnostics.push(diagnostic("VEL2013", "Only classes can be declared with 'abstract'", this.previous().span));
      if (modifiers.asynchronous) this.diagnostics.push(diagnostic("VEL2013", "Components are not declared with 'async'", this.previous().span));
      return parseComponent(this.host, start, modifiers.exported);
    }
    if (modifiers.abstract || modifiers.asynchronous) return undefined;
    if (namedDeclarationAhead(this.host, "state", reactiveBindingShapes)) {
      this.advance();
      return parseStateDeclaration(this.host, start, modifiers.exported);
    }
    if (namedDeclarationAhead(this.host, "computed", reactiveBindingShapes)) {
      this.advance();
      return parseComputedDeclaration(this.host, start, modifiers.exported);
    }
    if (namedDeclarationAhead(this.host, "resource", reactiveBindingShapes)) {
      this.advance();
      if (modifiers.exported) this.diagnostics.push(diagnostic("VEL2018", "A resource is component-owned and cannot be exported", this.previous().span));
      return parseResourceDeclaration(this.host, start, modifiers.exported);
    }
    if (namedDeclarationAhead(this.host, "action", actionHeaderShapes)) {
      this.advance();
      return parseActionDeclaration(this.host, start, modifiers.exported);
    }
    if (blockHeaderAhead(this.host, "watch")) {
      this.advance();
      if (modifiers.exported) this.diagnostics.push(diagnostic("VEL2001", "A watch block cannot be exported", this.previous().span));
      return parseWatchDeclaration(this.host, start);
    }
    if (exposeItemAhead(this.host)) {
      this.advance();
      const value = this.parseExpression();
      this.diagnostics.push(diagnostic("VEL5056", "'expose' is only valid as a top-level component item; declare 'exposes HandleType' on that component", span(start, value.span.end)));
      return { kind: "PassStatement", span: span(start, value.span.end) };
    }
    return undefined;
  }

  protected override parseUnsafeExtensionStatement(start: number): Statement | null | undefined {
    return parseUnsafeCssStatement(this.host, start);
  }

  protected override parseExtensionImport(start: number): Statement | null | undefined {
    return parseCssImport(this.host, start);
  }

  protected override parseExtensionExpression(token: Token): Expression | undefined {
    if (token.kind === "extensionToken" && token.value === WEB_JSX_TOKEN) return parseJsxExpression(this.host, token);
    if (token.kind !== "identifier") return undefined;
    // `look:` and `keyframes:` open a block-valued expression. Without the ':'
    // the word is an ordinary name, so `const saved = look` reads a binding.
    if (!this.check("colon")) return undefined;
    if (token.value === "keyframes") return parseKeyframesExpression(this.host, token);
    if (token.value !== "look") return undefined;
    return parseLookExpression(this.host, token);
  }
}
