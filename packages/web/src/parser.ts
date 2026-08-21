import { typeParameterDeclarationFormsPhrase, type Diagnostic, type Span } from "@velarscript/compiler";
import {
  Parser,
  scanStringLiteral,
  type CompilerLexicalExtension,
  type Expression,
  type Parameter,
  type Statement,
  type Token,
  type TypeSyntax,
} from "@velarscript/compiler/extension";
import type {
  WebActionDeclaration as ActionDeclaration,
  WebComponentDeclaration as ComponentDeclaration,
  WebComponentItem as ComponentItem,
  WebComputedDeclaration as ComputedDeclaration,
  WebExposeDeclaration as ExposeDeclaration,
  WebJsxElementExpression as JSXElementExpression,
  WebKeyframeStop,
  WebLookEntry as LookEntry,
  WebResourceDeclaration as ResourceDeclaration,
  WebStateDeclaration as StateDeclaration,
  WebUnsafeCssDeclaration as UnsafeCssDeclaration,
  WebWatchDeclaration as WatchDeclaration,
} from "./ast.ts";
import {
  WEB_JSX_TOKEN,
  WEB_KEYFRAMES_TOKEN,
  WEB_LOOK_TOKEN,
  WEB_UNSAFE_CSS_TOKEN,
  type WebExpressionSource,
  type WebJsxElementSyntax,
  type WebKeyframesBlockSyntax,
  type WebLookBlockSyntax,
  type WebLookLineSyntax,
  type WebUnsafeCssBlockSyntax,
} from "./lexer.ts";

const span = (start: number, end: number): Span => ({ start, end });
const diagnostic = (code: string, message: string, sourceSpan: Span): Diagnostic => ({ code, message, span: sourceSpan });
const recoveredDiagnostic = (code: string, message: string, sourceSpan: Span): Diagnostic => ({ code, message, span: sourceSpan, recovered: true });
const renderBlockSpellings = new Set(["render", "show", "view"]);
const lifecycleHookSpellings = new Set(["mounted", "cleanup"]);
// The tokens that may follow the declared name in each Web declaration head.
const componentHeaderShapes = new Set(["leftParen", "colon", "less", "identifier"]);
const reactiveBindingShapes = new Set(["assign", "colon"]);
const actionHeaderShapes = new Set(["leftParen"]);
// Tokens that open a fresh value rather than continuing the expression before
// them; only these make `expose` the component's expose item.
const exposeValueStartKinds = new Set([
  "identifier", "string", "fstring", "number", "unitNumber", "true", "false", "null", "super", "leftBrace", "extensionToken",
]);

export class VelarWebParser extends Parser {
  private insideComponentProps = 0;

  constructor(tokens: readonly Token[], lexicalExtensions: readonly CompilerLexicalExtension[]) {
    super(tokens, lexicalExtensions);
  }

  /**
   * WEB-N4: a component prop list is where a Web author reaches for the HTML
   * names, and `class`, `look`, and the Core keywords are all tokens rather than
   * identifiers. Recovering the keyword as the prop name turns an eleven-message
   * parser cascade into one directed message, and a declaration-position `?`
   * teaches the default value that actually makes a prop omittable.
   */
  protected override parseParameters(): readonly Parameter[] {
    if (this.insideComponentProps === 0) return super.parseParameters();
    this.expect("leftParen", "Expected '('");
    const parameters: Parameter[] = [];
    if (!this.check("rightParen")) {
      do {
        if (this.match("ellipsis")) this.diagnostics.push(diagnostic("VEL2016", "Components use named props and do not support rest parameters", this.previous().span));
        // 'class' and 'look' are the props every component already carries, so
        // the same message answers both the keyword token and the now-ordinary
        // name.
        const universalProp = this.checkWord("look") || this.check("class");
        if (universalProp) {
          const token = this.advance();
          this.diagnostics.push(diagnostic(
            "VEL2016",
            `Every component already accepts '${token.value}'; remove it from the prop list and pass it at the call site with ${token.value}={...}`,
            token.span,
          ));
        }
        const nameToken = universalProp ? this.previous() : this.check("identifier") ? this.advance() : this.componentPropKeyword();
        if (!nameToken) {
          this.diagnostics.push(diagnostic("VEL2016", "A component prop list holds 'name: Type' props separated by commas", this.current().span));
          break;
        }
        let optionalMarker = false;
        if (this.check("question")) {
          this.advance();
          optionalMarker = true;
        }
        const type = this.match("colon") ? this.parseTypeReference() : null;
        let defaultValue = this.match("assign") ? this.parseExpression() : null;
        if (optionalMarker) {
          this.diagnostics.push(diagnostic(
            "VEL2016",
            `A component prop becomes omittable through its default value, not through '?': write '${nameToken.value}: Type = default' for a real default, or '${nameToken.value}: Type? = null' when absence is the value`,
            span(nameToken.span.start, (defaultValue ?? type ?? nameToken).span.end),
          ));
          defaultValue ??= { kind: "LiteralExpression", value: null, raw: "null", span: nameToken.span };
        }
        parameters.push({
          name: nameToken.value,
          type: optionalMarker && type ? { syntax: { kind: "OptionalTypeSyntax", inner: type.syntax, span: type.span }, span: type.span } : type,
          defaultValue,
          rest: false,
          span: span(nameToken.span.start, (defaultValue ?? type ?? nameToken).span.end),
        });
      } while (this.match("comma") && !this.check("rightParen"));
    }
    this.expect("rightParen", "Expected ')' after parameters");
    return parameters;
  }

  /**
   * Consumes a keyword standing where a prop name belongs and reports the one
   * message that names it, or returns null when the token cannot be a name.
   */
  private componentPropKeyword(): Token | null {
    const token = this.current();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(token.value)) return null;
    if (token.kind === "identifier" || token.kind === "eof" || token.kind === "newline") return null;
    this.advance();
    this.diagnostics.push(diagnostic("VEL2016", `'${token.value}' is a VelarScript keyword and cannot name a component prop; choose another name`, token.span));
    return token;
  }

  protected override createNestedParser(tokens: readonly Token[]): Parser {
    return new VelarWebParser(tokens, this.lexicalExtensions);
  }

  /**
   * `@` selects the component's closed compiler namespace. The role names are
   * `mounted` and `cleanup`; neither is found through author-name lookup.
   */
  private matchLifecycleHook(name: string): boolean {
    if (!this.check("at") || this.peekKind(1) !== "identifier" || this.peekValue(1) !== name) return false;
    this.advance();
    this.advance();
    return true;
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
    if (this.namedDeclarationAhead("component", componentHeaderShapes)) {
      this.advance();
      if (modifiers.abstract) this.diagnostics.push(diagnostic("VEL2013", "Only classes can be declared with 'abstract'", this.previous().span));
      if (modifiers.asynchronous) this.diagnostics.push(diagnostic("VEL2013", "Components are not declared with 'async'", this.previous().span));
      return this.parseComponent(start, modifiers.exported);
    }
    if (modifiers.abstract || modifiers.asynchronous) return undefined;
    if (this.namedDeclarationAhead("state", reactiveBindingShapes)) {
      this.advance();
      return this.parseStateDeclaration(start, modifiers.exported);
    }
    if (this.namedDeclarationAhead("computed", reactiveBindingShapes)) {
      this.advance();
      return this.parseComputedDeclaration(start, modifiers.exported);
    }
    if (this.namedDeclarationAhead("resource", reactiveBindingShapes)) {
      this.advance();
      if (modifiers.exported) this.diagnostics.push(diagnostic("VEL2018", "A resource is component-owned and cannot be exported", this.previous().span));
      return this.parseResourceDeclaration(start, modifiers.exported);
    }
    if (this.namedDeclarationAhead("action", actionHeaderShapes)) {
      this.advance();
      return this.parseActionDeclaration(start, modifiers.exported);
    }
    if (this.blockHeaderAhead("watch")) {
      this.advance();
      if (modifiers.exported) this.diagnostics.push(diagnostic("VEL2001", "A watch block cannot be exported", this.previous().span));
      return this.parseWatchDeclaration(start);
    }
    if (this.exposeItemAhead()) {
      this.advance();
      const value = this.parseExpression();
      this.diagnostics.push(diagnostic("VEL5056", "'expose' is only valid as a top-level component item; declare 'exposes HandleType' on that component", span(start, value.span.end)));
      return { kind: "PassStatement", span: span(start, value.span.end) };
    }
    return undefined;
  }

  protected override parseUnsafeExtensionStatement(start: number): Statement | null | undefined {
    if (!this.checkWord("css") || this.peekKind(1) !== "extensionToken"
      || this.peekValue(1) !== WEB_UNSAFE_CSS_TOKEN) return undefined;
    this.advance();
    const token = this.advance();
    const payload = token.payload as WebUnsafeCssBlockSyntax | undefined;
    if (!payload || payload.kind !== "WebUnsafeCssBlockSyntax") {
      this.diagnostics.push(diagnostic("VEL5037", "The inline unsafe CSS token is missing its raw source", token.span));
      return { kind: "PassStatement", span: token.span };
    }
    const placement = this.parseUnsafeCssPlacement();
    const declaration: UnsafeCssDeclaration = {
      kind: "ExtensionStatement:web:unsafe-css",
      source: { kind: "inline", css: payload.css, span: payload.contentSpan },
      placement,
      span: span(start, this.previous().span.end),
    };
    return declaration;
  }

  /**
   * D30 item 16: a Web declaration head is claimed only in its own declaration
   * shape — the word, a name, and one of the tokens that can follow it there.
   * `state = 1`, `state(x)`, and `state.field` all keep the identifier reading.
   */
  private namedDeclarationAhead(word: string, shapes: ReadonlySet<string>): boolean {
    return this.checkWord(word) && this.peekKind(1) === "identifier" && shapes.has(this.peekKind(2));
  }

  /**
   * `watch` opens a block: its header line ends in ':' and an indented body
   * follows. No expression statement can end in ':', so the lookahead is exact
   * and `watch = 1` / `watch(value)` stay ordinary code.
   */
  private blockHeaderAhead(word: string): boolean {
    if (!this.checkWord(word)) return false;
    let depth = 0;
    let offset = 1;
    for (; ; offset += 1) {
      const kind = this.peekKind(offset);
      if (kind === "leftParen" || kind === "leftBracket" || kind === "leftBrace") depth += 1;
      else if (kind === "rightParen" || kind === "rightBracket" || kind === "rightBrace") depth -= 1;
      else if (kind === "eof") return false;
      else if (depth === 0 && (kind === "newline" || kind === "dedent")) break;
    }
    if (offset < 3 || this.peekKind(offset - 1) !== "colon") return false;
    while (this.peekKind(offset) === "newline") offset += 1;
    return this.peekKind(offset) === "indent";
  }

  /**
   * `expose value` is the one Web statement head followed by a bare expression
   * rather than by a name and a shape token. It is claimed only when the next
   * token opens a fresh value, so `expose(handle)` reads as a call and
   * `expose = handle` as an assignment — the identifier reading wins wherever
   * the two could compete.
   */
  private exposeItemAhead(): boolean {
    return this.checkWord("expose") && exposeValueStartKinds.has(this.peekKind(1));
  }

  protected override parseExtensionImport(start: number): Statement | null | undefined {
    // `import css unsafe "./file.css"` against `import css from "./module.vel"`:
    // the CSS boundary is claimed only when the word is followed by the
    // boundary marker or by the path itself, so a module named `css` still
    // imports by name.
    if (!this.checkWord("css") || !(this.peekKind(1) === "unsafe" || this.peekKind(1) === "string")) return undefined;
    this.advance();
    this.expect("unsafe", "Native CSS is an unsafe boundary; write 'import css unsafe'");
    const source = this.expect("string", "Expected a relative .css path after 'import css unsafe'");
    const placement = this.parseUnsafeCssPlacement();
    if ((!source.value.startsWith("./") && !source.value.startsWith("../")) || !source.value.endsWith(".css")) {
      this.diagnostics.push(diagnostic("VEL5037", "Unsafe CSS imports require an explicit relative path ending in '.css'", source.span));
    }
    const declaration: UnsafeCssDeclaration = {
      kind: "ExtensionStatement:web:unsafe-css",
      source: { kind: "external", path: source.value, span: source.span },
      placement,
      span: span(start, this.previous().span.end),
    };
    return declaration;
  }

  private parseUnsafeCssPlacement(): "before" | "after" {
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
    return placement;
  }

  protected override parseExtensionExpression(token: Token): Expression | undefined {
    if (token.kind === "extensionToken" && token.value === WEB_JSX_TOKEN) {
      const payload = token.payload as WebJsxElementSyntax | undefined;
      if (!payload || payload.kind !== "WebJsxElementSyntax") {
        this.diagnostics.push(diagnostic("VEL5001", "The Web JSX token is missing its structured syntax", token.span));
        return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
      }
      const syntax = shiftJsxSyntax(payload, token.span.start - payload.span.start);
      return jsxExpression(syntax, (source) => this.parseJsxEmbedded(source), (item) => this.diagnostics.push(item));
    }
    if (token.kind !== "identifier") return undefined;
    // `look:` and `keyframes:` open a block-valued expression. Without the ':'
    // the word is an ordinary name, so `const saved = look` reads a binding.
    if (!this.check("colon")) return undefined;
    if (token.value === "keyframes") return this.parseKeyframesExpression(token);
    if (token.value !== "look") return undefined;
    // LOK-I3: an unfinished Look value used to unravel into six diagnostics as
    // each expectation failed in turn. The shape is checked up front so the
    // reader gets one message naming the whole spelling.
    if (!this.check("colon") || this.peekKind(1) !== "newline") {
      this.diagnostics.push(diagnostic("VEL5038", "A Look value is written as 'look:' followed by an indented block of 'property = value' entries", token.span));
      this.skipMistypedDeclaration();
      return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
    }
    let ahead = 1;
    while (this.peekKind(ahead) === "newline") ahead += 1;
    if (this.peekKind(ahead) !== "indent") {
      // The colon stays unconsumed so the surrounding statement still ends at
      // its own newline; only this one message describes the missing block.
      this.diagnostics.push(diagnostic("VEL5038", "A Look block requires at least one indented 'property = value' entry", token.span));
      this.advance();
      return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
    }
    this.advance();
    this.consumeNewlines();
    this.advance();
    const block = this.expect("extensionToken", "Expected Look entries");
    const payload = block.value === WEB_LOOK_TOKEN ? block.payload as WebLookBlockSyntax | undefined : undefined;
    if (!payload || payload.kind !== "WebLookBlockSyntax") {
      this.diagnostics.push(diagnostic("VEL5038", "The Look block is missing its structured syntax", block.span));
    }
    const syntax = payload?.kind === "WebLookBlockSyntax"
      ? shiftLookSyntax(payload, block.span.start - payload.span.start)
      : undefined;
    this.consumeNewlines();
    this.expect("dedent", "Expected the end of the Look block");
    const entries = new LookSourceParser(
      syntax ?? { kind: "WebLookBlockSyntax", lines: [], span: block.span },
      (text, offset, openingIndent) => openingIndent
        ? this.parseNestedExpression(openingIndent + text, offset - openingIndent.length, true)
        : this.parseNestedExpression(text, offset),
      (item) => this.diagnostics.push(item),
    ).parse();
    const expression = { kind: "ExtensionExpression:web:look", entries, span: span(token.span.start, block.span.end) } as const;
    return expression;
  }

  private parseKeyframesExpression(token: Token): Expression {
    if (!this.check("colon") || this.peekKind(1) !== "newline") {
      this.diagnostics.push(diagnostic("VEL5060", "A keyframes value is written as 'keyframes:' followed by indented 'from:', 'to:', or 'N%:' stops", token.span));
      this.skipMistypedDeclaration();
      return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
    }
    let ahead = 1;
    while (this.peekKind(ahead) === "newline") ahead += 1;
    if (this.peekKind(ahead) !== "indent") {
      this.diagnostics.push(diagnostic("VEL5060", "A keyframes block requires at least one indented stop", token.span));
      this.advance();
      return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
    }
    this.advance();
    this.consumeNewlines();
    this.advance();
    const block = this.expect("extensionToken", "Expected keyframe stops");
    const payload = block.value === WEB_KEYFRAMES_TOKEN ? block.payload as WebKeyframesBlockSyntax | undefined : undefined;
    if (!payload || payload.kind !== "WebKeyframesBlockSyntax") {
      this.diagnostics.push(diagnostic("VEL5060", "The keyframes block is missing its structured syntax", block.span));
    }
    const syntax = payload?.kind === "WebKeyframesBlockSyntax"
      ? shiftKeyframesSyntax(payload, block.span.start - payload.span.start)
      : undefined;
    this.consumeNewlines();
    this.expect("dedent", "Expected the end of the keyframes block");
    const stops = new KeyframesSourceParser(
      syntax ?? { kind: "WebKeyframesBlockSyntax", lines: [], span: block.span },
      (text, offset, openingIndent) => openingIndent
        ? this.parseNestedExpression(openingIndent + text, offset - openingIndent.length, true)
        : this.parseNestedExpression(text, offset),
      (item) => this.diagnostics.push(item),
    ).parse();
    const expression = { kind: "ExtensionExpression:web:keyframes", stops, span: span(token.span.start, block.span.end) } as const;
    return expression;
  }

  // A '{for item in items: ...}' block inside JSX gets targeted guidance to
  // '.map(...)' instead of an expression-parse cascade; there is no magic JSX
  // control flow. The child recovers as an inert null literal so the rest of
  // the module still analyzes and reports its own guidance in the same compile.
  private parseJsxEmbedded(source: WebExpressionSource): Expression {
    // WEB-U13: '{/* ... */}' is the JSX comment habit. VelarScript has no block
    // comment at all, so the interpolation gets one message naming '//' instead
    // of two 'Expected an expression' failures.
    if (/^\s*\/[*/]/u.test(source.source)) {
      this.diagnostics.push(recoveredDiagnostic(
        "VEL5002",
        "JSX has no comment form; write a '//' comment on its own line outside the markup",
        source.span,
      ));
      return { kind: "LiteralExpression", value: null, raw: "null", span: source.span };
    }
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
    return { kind: "ExtensionStatement:web:state", exported, name: name.value, type, initializer, span: span(start, initializer.span.end) };
  }

  /**
   * D71 rule 182: `computed` parses exactly where `state` parses, through the
   * same shape lookahead — the two halves of the reactive row differ in what
   * they mean, not in how they are written.
   */
  private parseComputedDeclaration(start: number, exported: boolean): ComputedDeclaration {
    const name = this.expect("identifier", "Expected a computed name");
    const type = this.match("colon") ? this.parseTypeReference() : null;
    this.expect("assign", "Expected '=' after computed name");
    const initializer = this.parseExpression();
    return { kind: "ExtensionStatement:web:computed", exported, name: name.value, type, initializer, span: span(start, initializer.span.end) };
  }

  private parseResourceDeclaration(start: number, exported: boolean): ResourceDeclaration {
    const name = this.expect("identifier", "Expected a resource name");
    const type = this.match("colon") ? this.parseTypeReference() : null;
    this.expect("assign", "Expected '=' after resource name");
    const initializer = this.parseExpression();
    return { kind: "ExtensionStatement:web:resource", exported, name: name.value, type, initializer, span: span(start, initializer.span.end) };
  }

  private parseActionDeclaration(start: number, exported: boolean): ActionDeclaration {
    const name = this.expect("identifier", "Expected an action name");
    const parameters = this.parseParameters();
    const parameterListEnd = this.previous().span.end;
    const returnType = this.match("arrow") ? this.parseTypeReference() : null;
    const body = this.parseBlock();
    const end = body.at(-1)?.span.end ?? returnType?.span.end ?? name.span.end;
    return {
      kind: "ExtensionStatement:web:action",
      exported,
      name: name.value,
      parameters,
      returnType,
      ...(returnType ? { resultAnnotationSpan: span(parameterListEnd, returnType.span.end) } : {}),
      signatureSpan: span(start, returnType?.span.end ?? parameterListEnd),
      body,
      span: span(start, end),
    };
  }

  private parseWatchDeclaration(start: number): WatchDeclaration {
    const expression = this.parseExpression();
    let currentName: string | null = null;
    let previousName: string | null = null;
    if (this.matchWord("as")) {
      currentName = this.expect("identifier", "Expected the current watch value name").value;
      this.expect("comma", "Expected ',' between watch value names");
      previousName = this.expect("identifier", "Expected the previous watch value name").value;
    }
    const body = this.parseBlock();
    return { kind: "ExtensionStatement:web:watch", expression, currentName, previousName, body, span: span(start, body.at(-1)?.span.end ?? expression.span.end) };
  }

  private parseComponent(start: number, exported: boolean): ComponentDeclaration {
    const name = this.expect("identifier", "Expected a component name");
    if (this.check("less")) {
      this.parseTypeParameters();
      this.diagnostics.push(diagnostic("VEL2025", `Component '${name.value}' cannot declare type parameters; ${typeParameterDeclarationFormsPhrase()} take '<T>'`, name.span));
    }
    this.insideComponentProps += 1;
    const parameters = this.check("leftParen") ? this.parseParameters() : [];
    this.insideComponentProps -= 1;
    for (const parameter of parameters) {
      if (parameter.rest) {
        this.diagnostics.push(diagnostic("VEL2016", "Components use named props and do not support rest parameters", parameter.span));
      }
    }
    const handleType = this.matchExtensionKeyword("exposes") ? this.parseTypeReference() : null;
    this.expect("colon", "Expected ':' before component body");
    this.expect("newline", "Expected a newline before component body");
    this.consumeNewlines();
    this.expect("indent", "Expected an indented component body");
    const body: ComponentItem[] = [];
    this.consumeNewlines();

    while (!this.check("dedent") && !this.check("eof")) {
      const itemStart = this.current().span.start;
      let item: ComponentItem | null = null;
      if (this.exposeItemAhead()) {
        this.advance();
        const value = this.parseExpression();
        item = { kind: "ExtensionStatement:web:expose", value, span: span(itemStart, value.span.end) } satisfies ExposeDeclaration;
      } else if (this.namedDeclarationAhead("state", reactiveBindingShapes)) {
        this.advance();
        item = this.parseStateDeclaration(itemStart, false);
      } else if (this.namedDeclarationAhead("computed", reactiveBindingShapes)) {
        this.advance();
        item = this.parseComputedDeclaration(itemStart, false);
      } else if (this.namedDeclarationAhead("resource", reactiveBindingShapes)) {
        this.advance();
        item = this.parseResourceDeclaration(itemStart, false);
      } else if (this.namedDeclarationAhead("action", actionHeaderShapes)) {
        this.advance();
        item = this.parseActionDeclaration(itemStart, false);
      } else if (this.blockHeaderAhead("watch")) {
        this.advance();
        item = this.parseWatchDeclaration(itemStart);
      } else if (this.matchLifecycleHook("mounted")) {
        const body = this.parseBlock();
        item = { kind: "ExtensionStatement:web:mounted", body, span: span(itemStart, body.at(-1)?.span.end ?? itemStart) };
      } else if (this.matchLifecycleHook("cleanup")) {
        const body = this.parseBlock();
        item = { kind: "ExtensionStatement:web:cleanup", body, span: span(itemStart, body.at(-1)?.span.end ?? itemStart) };
      } else if (this.check("at")) {
        const marker = this.advance();
        const name = this.check("identifier") ? this.advance() : null;
        this.diagnostics.push(diagnostic(
          "VEL5061",
          name
            ? `Unknown compiler-owned name '@${name.value}' in a component; the component namespace contains only '@mounted:' and '@cleanup:'`
            : "Expected a compiler-owned component name after '@'; the component namespace contains only '@mounted:' and '@cleanup:'",
          span(marker.span.start, (name ?? marker).span.end),
        ));
        this.skipMistypedDeclaration();
      } else if (this.check("identifier") && lifecycleHookSpellings.has(this.current().value) && this.peekKind(1) === "colon") {
        // The bare words are ordinary author names. Recover as the one accepted
        // compiler-owned spelling so the body keeps analyzing, while retaining
        // a diagnostic: recovery is not a second alias.
        const keyword = this.advance();
        this.diagnostics.push(recoveredDiagnostic(
          "VEL5061",
          `Use '@${keyword.value}:'; it is a compiler-owned component name, which leaves '${keyword.value}' free for your own method`,
          keyword.span,
        ));
        const body = this.parseBlock();
        item = keyword.value === "mounted"
          ? { kind: "ExtensionStatement:web:mounted", body, span: span(itemStart, body.at(-1)?.span.end ?? itemStart) }
          : { kind: "ExtensionStatement:web:cleanup", body, span: span(itemStart, body.at(-1)?.span.end ?? itemStart) };
      } else if (this.check("identifier") && renderBlockSpellings.has(this.current().value) && this.peekKind(1) === "colon") {
        const keyword = this.advance();
        this.diagnostics.push(diagnostic(
          "VEL5048",
          `Use 'return <...>'; a component returns its JSX directly and has no '${keyword.value}:' block`,
          keyword.span,
        ));
        this.skipMistypedDeclaration();
      } else {
        item = this.parseStatement() as ComponentItem | null;
      }
      if (item) body.push(item);
      if (this.previous().kind !== "dedent") this.expectStatementBoundary();
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of component body");
    return { kind: "ExtensionStatement:web:component", exported, name: name.value, parameters, handleType, body, span: span(start, body.at(-1)?.span.end ?? close.span.end) };
  }
}

function shiftSourceSpan(sourceSpan: Span, offset: number): Span {
  return offset === 0 ? sourceSpan : span(sourceSpan.start + offset, sourceSpan.end + offset);
}

function shiftExpressionSource(source: WebExpressionSource, offset: number): WebExpressionSource {
  return offset === 0 ? source : { ...source, span: shiftSourceSpan(source.span, offset) };
}

function shiftJsxSyntax(syntax: WebJsxElementSyntax, offset: number): WebJsxElementSyntax {
  if (offset === 0) return syntax;
  return {
    ...syntax,
    span: shiftSourceSpan(syntax.span, offset),
    tagSpan: shiftSourceSpan(syntax.tagSpan, offset),
    attributes: syntax.attributes.map((attribute) => ({
      ...attribute,
      span: shiftSourceSpan(attribute.span, offset),
      value: typeof attribute.value === "object" && attribute.value !== null
        ? shiftExpressionSource(attribute.value, offset)
        : attribute.value,
    })),
    children: syntax.children.map((child) => {
      if (child.kind === "WebJsxElementSyntax") return shiftJsxSyntax(child, offset);
      if (child.kind === "WebJsxExpressionSyntax") {
        return {
          ...child,
          span: shiftSourceSpan(child.span, offset),
          expression: shiftExpressionSource(child.expression, offset),
        };
      }
      return { ...child, span: shiftSourceSpan(child.span, offset) };
    }),
  };
}

function shiftLookSyntax(syntax: WebLookBlockSyntax, offset: number): WebLookBlockSyntax {
  if (offset === 0) return syntax;
  return {
    ...syntax,
    span: shiftSourceSpan(syntax.span, offset),
    lines: syntax.lines.map((line) => ({
      ...line,
      start: line.start + offset,
      end: line.end + offset,
    })),
  };
}

function shiftKeyframesSyntax(syntax: WebKeyframesBlockSyntax, offset: number): WebKeyframesBlockSyntax {
  if (offset === 0) return syntax;
  return {
    ...syntax,
    span: shiftSourceSpan(syntax.span, offset),
    lines: syntax.lines.map((line) => ({ ...line, start: line.start + offset, end: line.end + offset })),
  };
}

function jsxExpression(
  syntax: WebJsxElementSyntax,
  parseExpression: (source: WebExpressionSource) => Expression,
  report: (item: Diagnostic) => void,
): JSXElementExpression {
  return {
    kind: "ExtensionExpression:web:jsx",
    tag: syntax.tag,
    tagSpan: syntax.tagSpan,
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
    // Every rewrite here is length-preserving, because `hooks` is keyed by an
    // offset into `text` and `replaceLookHooks` looks those keys up against
    // spans parsed out of `rewritten`. `@name` becomes `_name` and a string
    // literal is copied verbatim, so the two offsets stay equal.
    for (let index = 0; index < text.length;) {
      // A string literal is Core's to define — prefixes, escapes, raw content
      // and every delimiter — so the `@` rewrite steps over whatever Core
      // scans rather than keeping a second spelling of string lexing here.
      const literal = scanStringLiteral(text, index);
      if (literal) {
        const end = Math.max(literal.end, index + 1);
        rewritten += text.slice(index, end);
        index = end;
        continue;
      }
      const match = /^@([A-Za-z][A-Za-z0-9]*)/u.exec(text.slice(index));
      if (match) {
        hooks.set(absoluteOffset + index, match[1]!);
        rewritten += `_${match[1]}`;
        index += match[0].length;
        continue;
      }
      rewritten += text[index]!;
      index += 1;
    }
    const parsed = this.parseExpression(rewritten, absoluteOffset);
    return replaceLookHooks(parsed, hooks);
  }

  private lineSpan(line: { start: number; end: number }): Span {
    return span(line.start, line.end);
  }
}

class KeyframesSourceParser {
  private readonly lines: readonly WebLookLineSyntax[];
  private readonly blockSpan: Span;
  private readonly parseExpression: (text: string, offset: number, openingIndent?: string) => Expression;
  private readonly report: (item: Diagnostic) => void;
  private readonly seenOffsets = new Set<number>();
  private index = 0;
  private previousGroupStart = -1;

  constructor(
    block: WebKeyframesBlockSyntax,
    parseExpression: (text: string, offset: number, openingIndent?: string) => Expression,
    report: (item: Diagnostic) => void,
  ) {
    this.lines = block.lines;
    this.blockSpan = block.span;
    this.parseExpression = parseExpression;
    this.report = report;
  }

  parse(): readonly WebKeyframeStop[] {
    if (this.lines.length === 0) {
      this.report(diagnostic("VEL5060", "A keyframes block requires at least one stop", this.blockSpan));
      return [];
    }
    const indent = this.lines[0]!.indent;
    const stops: WebKeyframeStop[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]!;
      if (line.indent !== indent) {
        this.report(diagnostic("VEL5060", "Unexpected keyframes indentation; stops share one indentation level", this.lineSpan(line)));
        this.index += 1;
        continue;
      }
      this.index += 1;
      const label = /^(.+):$/u.exec(line.text)?.[1]?.trim();
      if (!label) {
        this.report(diagnostic("VEL5060", "A keyframe stop uses 'from:', 'to:', or a percentage such as '50%:'", this.lineSpan(line)));
        continue;
      }
      const offsets = this.parseOffsets(label, line);
      const next = this.lines[this.index];
      if (!next || next.indent <= line.indent) {
        this.report(diagnostic("VEL5060", `Keyframe stop '${label}' requires an indented property body`, this.lineSpan(line)));
        continue;
      }
      const entries = this.parseEntries(next.indent, line.indent);
      if (offsets.length > 0) stops.push({
        offsets,
        entries,
        span: span(line.start, entries.at(-1)?.span.end ?? line.end),
      });
    }
    if (stops.length === 0) this.report(diagnostic("VEL5060", "A keyframes block requires at least one valid stop", this.blockSpan));
    return stops;
  }

  private parseOffsets(label: string, line: WebLookLineSyntax): readonly number[] {
    const parts = label.split(",").map((part) => part.trim());
    const offsets: number[] = [];
    for (const part of parts) {
      let offset: number | null = part === "from" ? 0 : part === "to" ? 100 : null;
      const percentage = /^(\d+(?:\.\d+)?)%$/u.exec(part);
      if (percentage) {
        offset = Number(percentage[1]);
        if (offset === 0 || offset === 100) {
          this.report(diagnostic("VEL5060", `Use '${offset === 0 ? "from" : "to"}:'; ${offset}% has one canonical keyframe spelling`, this.lineSpan(line)));
          continue;
        }
        if (!(offset > 0 && offset < 100)) {
          this.report(diagnostic("VEL5060", `Keyframe percentage '${part}' must be greater than 0% and less than 100%`, this.lineSpan(line)));
          continue;
        }
      }
      if (offset === null) {
        this.report(diagnostic("VEL5060", `Unknown keyframe stop '${part}'; use from, to, or a percentage between them`, this.lineSpan(line)));
        continue;
      }
      if (this.seenOffsets.has(offset)) {
        this.report(diagnostic("VEL5060", `Keyframe stop '${part}' duplicates ${offset === 0 ? "from" : offset === 100 ? "to" : `${offset}%`}`, this.lineSpan(line)));
        continue;
      }
      this.seenOffsets.add(offset);
      offsets.push(offset);
    }
    const groupStart = offsets.length > 0 ? Math.min(...offsets) : this.previousGroupStart;
    if (groupStart < this.previousGroupStart) {
      this.report(diagnostic("VEL5060", "Keyframe stops must be declared in ascending order", this.lineSpan(line)));
    } else this.previousGroupStart = groupStart;
    return offsets;
  }

  private parseEntries(indent: number, stopIndent: number): WebKeyframeStop["entries"] {
    const entries: Extract<LookEntry, { kind: "LookProperty" }>[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]!;
      if (line.indent <= stopIndent) break;
      this.index += 1;
      if (line.indent !== indent) {
        this.report(diagnostic("VEL5060", "Keyframe stop bodies cannot contain nested targets, conditions, or blocks", this.lineSpan(line)));
        continue;
      }
      if (line.text.startsWith("if ") || line.text.startsWith("@") || line.text.startsWith("...") || line.text === "look:") {
        this.report(diagnostic("VEL5060", "Keyframe stops contain only direct Look properties; conditions, targets, composition, and spreads are not allowed", this.lineSpan(line)));
        continue;
      }
      const kebab = /^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)+)\s*=\s*([\s\S]+)$/u.exec(line.text);
      const property = kebab ? null : /^([A-Za-z][A-Za-z0-9]*)\s*=\s*([\s\S]+)$/u.exec(line.text);
      if (!kebab && !property) {
        this.report(diagnostic("VEL5060", "A keyframe property is written as 'property = value'", this.lineSpan(line)));
        continue;
      }
      const name = kebab
        ? kebab[1]!.replace(/-+([A-Za-z])/gu, (_, letter: string) => letter.toUpperCase())
        : property![1]!;
      if (kebab) this.report(recoveredDiagnostic("VEL5038", `Use '${name}'; Look properties use the DOM camelCase spelling`, this.lineSpan(line)));
      const assignment = line.text.indexOf("=");
      const afterAssignment = line.text.slice(assignment + 1);
      const valueText = afterAssignment.trim();
      const valueStart = line.start + assignment + 1 + (afterAssignment.length - afterAssignment.trimStart().length);
      entries.push({
        kind: "LookProperty",
        name,
        value: this.parseExpression(valueText, valueStart, /[\r\n]/u.test(valueText) ? line.openingIndent : undefined),
        span: this.lineSpan(line),
      });
    }
    return entries;
  }

  private lineSpan(line: { start: number; end: number }): Span {
    return span(line.start, line.end);
  }
}

function replaceLookHooks(expression: Expression, hooks: ReadonlyMap<number, string>): Expression {
  if (expression.kind === "IdentifierExpression" && hooks.has(expression.span.start)) {
    const hook = { kind: "ExtensionExpression:web:look-hook", name: hooks.get(expression.span.start)!, span: expression.span } as const;
    return hook;
  }
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (record.kind === "IdentifierExpression" && typeof record.span === "object" && record.span) {
      const sourceSpan = record.span as Span;
      const name = hooks.get(sourceSpan.start);
      if (name) return { kind: "ExtensionExpression:web:look-hook", name, span: sourceSpan };
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, key === "span" ? child : visit(child)]));
  };
  return visit(expression) as Expression;
}
