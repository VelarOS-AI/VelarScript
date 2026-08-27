import { type Advisory, type Diagnostic, type DiagnosticFix, type Span } from "@velarscript/compiler";
import {
  Parser,
  type CompilerLexicalExtension,
  type Parameter,
  type Statement,
  type Token,
  type TypeReference,
  type TypeSyntax,
} from "@velarscript/compiler/extension";
import {
  NODE_HTTP_METHODS,
  type NodeHttpMethodName,
  type NodeNotFoundDeclaration,
  type NodeRouteDeclaration,
  type NodeResponseDeclaration,
  type NodeServerDeclaration,
  type NodeServerItem,
} from "./server-ast.ts";
import { compileRoutePattern, type CompiledRoutePattern, type RoutePatternCapture } from "./route-pattern.ts";
import { isNodePathPatternSyntax, NODE_PATH_PATTERN_TOKEN } from "./server-lexer.ts";

const span = (start: number, end: number): Span => ({ start, end });
const diagnostic = (code: string, message: string, sourceSpan: Span, fix?: DiagnosticFix): Diagnostic =>
  fix ? { code, message, span: sourceSpan, fix } : { code, message, span: sourceSpan };
const advisory = (code: string, message: string, sourceSpan: Span, fix: DiagnosticFix): Advisory =>
  ({tier: "advisory", code, message, span: sourceSpan, fix});
const methods = new Set<string>(NODE_HTTP_METHODS);
const routeRoles = new Set<string>([...methods, "websocket"]);

export class VelarNodeParser extends Parser {
  constructor(tokens: readonly Token[], lexicalExtensions: readonly CompilerLexicalExtension[]) {
    super(tokens, lexicalExtensions);
  }

  protected override createNestedParser(tokens: readonly Token[]): Parser {
    return new VelarNodeParser(tokens, this.lexicalExtensions);
  }

  protected override parseExtensionExpression(token: Token) {
    if (token.kind !== "extensionToken" || token.value !== NODE_PATH_PATTERN_TOKEN || !isNodePathPatternSyntax(token.payload)) return undefined;
    const syntax = token.payload;
    const compiled = compileRoutePattern(syntax.value, syntax.contentSpan.start);
    for (const issue of compiled.issues) this.diagnostics.push(diagnostic("VEL6005", issue.message, issue.span));
    for (const capture of compiled.pattern.query) {
      if (!capture.explicitWireName || capture.wireName !== capture.name) continue;
      const shorthand = `{${capture.name}:${capture.typeName}${capture.optional ? "?" : ""}}`;
      // 显式同名映射没有歧义，所以保持为合法语法；同时机械删除 `name=`
      // 即可得到唯一的简写，不需要猜测作者意图。
      const redundantPrefix = {start: capture.span.start - capture.wireName.length - 1, end: capture.span.start};
      this.advisories.push(advisory(
        "A11",
        `Query wire name '${capture.wireName}' repeats its field name; use the shorter '${shorthand}' contract`,
        {start: redundantPrefix.start, end: capture.span.end},
        {title: `Use query shorthand '${shorthand}'`, edits: [{span: redundantPrefix, text: ""}]},
      ));
    }
    return {kind: "ExtensionExpression:node:path-pattern", pattern: compiled.pattern, span: token.span} as const;
  }

  protected override parseExtensionStatement(
    start: number,
    modifiers: { readonly exported: boolean; readonly abstract: boolean; readonly asynchronous: boolean },
  ): Statement | null | undefined {
    if (this.serverDeclarationAhead()) {
      this.advance();
      if (modifiers.abstract) this.diagnostics.push(diagnostic("VEL6001", "A server is a concrete route table and cannot be abstract", this.previous().span));
      if (modifiers.asynchronous) this.diagnostics.push(diagnostic("VEL6001", "A server declaration is static and is not prefixed with 'async'; route bodies already allow await", this.previous().span));
      return this.parseServer(start, modifiers.exported);
    }
    if (this.check("at")) {
      const marker = this.advance();
      const name = this.check("identifier") ? this.advance() : null;
      this.diagnostics.push(diagnostic(
        "VEL6002",
        name
          ? `Compiler-owned route '@${name.value}' is valid only directly inside a server block`
          : "Expected a compiler-owned route name after '@'; routes are valid only directly inside a server block",
        span(marker.span.start, (name ?? marker).span.end),
      ));
      this.skipMistypedDeclaration();
      return { kind: "PassStatement", span: span(start, this.previous().span.end) };
    }
    return undefined;
  }

  private serverDeclarationAhead(): boolean {
    return this.checkWord("server") && this.peekKind(1) === "identifier" && this.peekKind(2) === "colon";
  }

  private parseServer(start: number, exported: boolean): NodeServerDeclaration {
    const name = this.expect("identifier", "Expected a server name");
    this.expect("colon", "Expected ':' before server routes");
    this.expect("newline", "Expected a newline before server routes");
    this.consumeNewlines();
    this.expect("indent", "Expected an indented server body");
    const items: NodeServerItem[] = [];
    this.consumeNewlines();

    while (!this.check("dedent") && !this.check("eof")) {
      const itemStart = this.current().span.start;
      let item: NodeServerItem | null = null;
      if (this.check("at")) item = this.peekValue(1) === "notFound"
        ? this.parseNotFound(itemStart)
        : this.peekValue(1) === "response" ? this.parseResponse(itemStart) : this.parseRoute(itemStart);
      else if (this.match("ellipsis")) {
        const value = this.parseExpression();
        item = { kind: "NodeServerSpread", value, span: span(itemStart, value.span.end) };
      } else {
        this.diagnostics.push(diagnostic(
          "VEL6003",
          "A server body contains only HTTP/WebSocket routes, one @notFound fallback, one @response policy, or '...app' composition entries; put ordinary declarations outside the server",
          this.current().span,
        ));
        this.skipMistypedDeclaration();
      }
      if (item) items.push(item);
      if (this.previous().kind !== "dedent") this.expectStatementBoundary();
      this.consumeNewlines();
    }
    const close = this.expect("dedent", "Expected the end of the server body");
    return {
      kind: "ExtensionStatement:node:server",
      exported,
      name: name.value,
      items,
      span: span(start, items.at(-1)?.span.end ?? close.span.end),
    };
  }

  private parseRoute(start: number): NodeRouteDeclaration | null {
    const marker = this.expect("at", "Expected '@'");
    const name = this.check("identifier") ? this.advance() : null;
    if (!name || !routeRoles.has(name.value)) {
      this.diagnostics.push(diagnostic(
        "VEL6002",
        name
          ? `Unknown compiler-owned name '@${name.value}' in a server; use an HTTP route name, @websocket, @notFound, or @response`
          : "Expected a compiler-owned server name after '@'; use an HTTP route name, @websocket, @notFound, or @response",
        span(marker.span.start, (name ?? marker).span.end),
      ));
      this.skipMistypedDeclaration();
      return null;
    }

    const methodName = name.value as NodeHttpMethodName | "websocket";
    // `@get operationName(...)` 中的名字是协议身份，不会成为源码绑定；省略时
    // 保持普通局部服务的简写，由 OpenAPI 根据方法与路径生成展示用身份。
    const operation = this.check("identifier") ? this.advance() : null;
    this.expect("leftParen", `Expected '(' after '${operation ? operation.value : `@${methodName}`}'`);
    const legacyPath = this.check("identifier") && this.current().value === "path" && this.peekKind(1) === "assign";
    const legacyStart = legacyPath ? this.advance().span.start : null;
    if (legacyPath) this.advance();
    const pathExpression = this.parseExpression();
    const directPattern = pathExpression.kind === "ExtensionExpression:node:path-pattern"
      ? pathExpression as typeof pathExpression & {readonly pattern: CompiledRoutePattern}
      : null;
    let routeBinding: {readonly name: string; readonly span: Span} | null = null;
    if (this.matchWord("as")) {
      const binding = this.expectBindingName("Expected a route match name after 'as'", "route match binding");
      routeBinding = {name: binding.value, span: binding.span};
    } else if (legacyPath) {
      routeBinding = {name: "path", span: span(legacyStart!, legacyStart! + 4)};
      this.diagnostics.push(diagnostic(
        "VEL6005",
        "A route pattern is positional; use p\"...\" for direct captures or p\"...\" as route for the complete match",
        span(legacyStart!, pathExpression.span.end),
        {
          title: "Bind the complete route match explicitly",
          edits: [
            {span: span(legacyStart!, pathExpression.span.start), text: ""},
            {span: {start: pathExpression.span.end, end: pathExpression.span.end}, text: " as path"},
          ],
        },
      ));
    } else if (!directPattern) {
      this.diagnostics.push(diagnostic(
        "VEL6005",
        "A referenced RoutePattern cannot introduce hidden names; bind its complete match with 'as route'",
        pathExpression.span,
      ));
    }

    const projectedCaptures = routeBinding === null && directPattern
      ? directPattern.pattern.path.concat(directPattern.pattern.query)
      : [];
    const inputParameters: Parameter[] = [];
    let sawDefault = false;
    if (this.match("comma")) {
      while (!this.check("rightParen") && !this.check("eof")) {
        const parameterStart = this.current().span.start;
        const rest = this.match("ellipsis");
        const parameterName = this.expectBindingName("Expected a route parameter name", "route parameter name");
        const type = this.match("colon") ? this.parseTypeReference() : null;
        const defaultValue = this.match("assign") ? this.parseExpression() : null;
        const parameterSpan = span(parameterStart, defaultValue?.span.end ?? type?.span.end ?? parameterName.span.end);
        if (rest) this.diagnostics.push(diagnostic("VEL6004", "Routes have a fixed HTTP input contract and do not support rest parameters", parameterSpan));
        if (!defaultValue && sawDefault) {
          this.diagnostics.push(diagnostic("VEL2016", "A required route parameter cannot follow a parameter with a default value", parameterSpan));
        }
        inputParameters.push({ name: parameterName.value, type, defaultValue, rest, span: parameterSpan });
        sawDefault ||= defaultValue !== null;
        if (!this.match("comma")) break;
      }
    }
    const close = this.expect("rightParen", "Expected ')' after route parameters");
    const parameterListEnd = close.span.end;

    const { returnType, resultAnnotationSpan, expressionBody, body } = this.parseHandlerBody(parameterListEnd);
    const transport = methodName === "websocket" ? "websocket" : "http";
    const method = methodName.toUpperCase() as Uppercase<NodeHttpMethodName> | "WEBSOCKET";
    const end = body.at(-1)?.span.end ?? returnType?.span.end ?? close.span.end;
    const contextParameters: Parameter[] = routeBinding
      ? [{name: routeBinding.name, type: null, defaultValue: pathExpression, rest: false, span: routeBinding.span}]
      : projectedCaptures.map(routeCaptureParameter);
    return {
      kind: "NodeRouteDeclaration",
      name: `${method} ${directPattern?.pattern.definition ?? "<route>"}`,
      operationId: operation?.value ?? null,
      operationSpan: operation?.span ?? null,
      method,
      transport,
      pathExpression,
      path: directPattern?.pattern.definition ?? "",
      pathSpan: pathExpression.span,
      routeBinding,
      projectedCaptures,
      inputParameters,
      parameters: contextParameters.concat(inputParameters),
      returnType,
      ...(resultAnnotationSpan ? { resultAnnotationSpan } : {}),
      signatureSpan: span(start, returnType?.span.end ?? close.span.end),
      body,
      expressionBody,
      span: span(start, end),
    };
  }

  private parseNotFound(start: number): NodeNotFoundDeclaration {
    this.expect("at", "Expected '@'");
    this.expect("identifier", "Expected 'notFound' after '@'");
    const parameters = this.parseParameters();
    const parameterListEnd = this.previous().span.end;
    const { returnType, resultAnnotationSpan, expressionBody, body } = this.parseHandlerBody(parameterListEnd);
    const end = body.at(-1)?.span.end ?? returnType?.span.end ?? parameterListEnd;
    return {
      kind: "NodeNotFoundDeclaration",
      name: "notFound",
      parameters,
      returnType,
      ...(resultAnnotationSpan ? { resultAnnotationSpan } : {}),
      signatureSpan: span(start, returnType?.span.end ?? parameterListEnd),
      body,
      expressionBody,
      span: span(start, end),
    };
  }

  private parseResponse(start: number): NodeResponseDeclaration {
    this.expect("at", "Expected '@'");
    this.expect("identifier", "Expected 'response' after '@'");
    const parameters = this.parseParameters();
    const parameterListEnd = this.previous().span.end;
    const {returnType, resultAnnotationSpan, expressionBody, body} = this.parseHandlerBody(parameterListEnd);
    const end = body.at(-1)?.span.end ?? returnType?.span.end ?? parameterListEnd;
    return {
      kind: "NodeResponseDeclaration",
      name: "response",
      parameters,
      returnType,
      ...(resultAnnotationSpan ? {resultAnnotationSpan} : {}),
      signatureSpan: span(start, returnType?.span.end ?? parameterListEnd),
      body,
      expressionBody,
      span: span(start, end),
    };
  }

  private parseHandlerBody(parameterListEnd: number): {
    readonly returnType: TypeReference | null;
    readonly resultAnnotationSpan?: Span;
    readonly expressionBody: boolean;
    readonly body: readonly Statement[];
  } {
    let returnType: TypeReference | null = null;
    let resultAnnotationSpan: Span | undefined;
    let expressionBody = false;
    let body: readonly Statement[];
    if (this.match("fatArrow")) {
      expressionBody = true;
      const value = this.parseExpression();
      body = [{ kind: "ReturnStatement", value, span: value.span }];
    } else {
      if (this.match("arrow")) {
        returnType = this.parseTypeReference();
        resultAnnotationSpan = span(parameterListEnd, returnType.span.end);
      }
      body = this.parseBlock();
    }
    return { returnType, ...(resultAnnotationSpan ? { resultAnnotationSpan } : {}), expressionBody, body };
  }

}

function routeCaptureParameter(capture: RoutePatternCapture): Parameter {
  const scalar: TypeSyntax = {kind: "NamedTypeSyntax", name: capture.typeName, span: capture.typeSpan};
  const syntax: TypeSyntax = capture.optional
    ? {kind: "OptionalTypeSyntax", inner: scalar, span: capture.typeSpan}
    : scalar;
  return {
    name: capture.name,
    type: {syntax, span: capture.typeSpan},
    defaultValue: null,
    rest: false,
    span: capture.span,
  };
}
