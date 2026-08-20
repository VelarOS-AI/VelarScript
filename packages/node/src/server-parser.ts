import { mechanicalFix, type Diagnostic, type DiagnosticFix, type Span } from "@velarscript/compiler";
import {
  Parser,
  type CompilerLexicalExtension,
  type Parameter,
  type Statement,
  type Token,
  type TypeReference,
} from "@velarscript/compiler/extension";
import {
  NODE_HTTP_METHODS,
  type NodeHttpMethodName,
  type NodeNotFoundDeclaration,
  type NodeRouteDeclaration,
  type NodeServerDeclaration,
  type NodeServerItem,
} from "./server-ast.ts";
import { isNodePathPatternSyntax, NODE_PATH_PATTERN_TOKEN, type NodePathPatternSyntax } from "./server-lexer.ts";

const span = (start: number, end: number): Span => ({ start, end });
const diagnostic = (code: string, message: string, sourceSpan: Span, fix?: DiagnosticFix): Diagnostic =>
  fix ? { code, message, span: sourceSpan, fix } : { code, message, span: sourceSpan };
const methods = new Set<string>(NODE_HTTP_METHODS);

export class VelarNodeParser extends Parser {
  constructor(tokens: readonly Token[], lexicalExtensions: readonly CompilerLexicalExtension[]) {
    super(tokens, lexicalExtensions);
  }

  protected override createNestedParser(tokens: readonly Token[]): Parser {
    return new VelarNodeParser(tokens, this.lexicalExtensions);
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
        : this.parseRoute(itemStart);
      else if (this.match("ellipsis")) {
        const value = this.parseExpression();
        item = { kind: "NodeServerSpread", value, span: span(itemStart, value.span.end) };
      } else {
        this.diagnostics.push(diagnostic(
          "VEL6003",
          "A server body contains only HTTP routes, one @notFound fallback, or '...app' composition entries; put ordinary declarations outside the server",
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
    if (!name || !methods.has(name.value)) {
      this.diagnostics.push(diagnostic(
        "VEL6002",
        name
          ? `Unknown compiler-owned name '@${name.value}' in a server; use an HTTP route name or @notFound`
          : "Expected a compiler-owned server name after '@'; use an HTTP route name or @notFound",
        span(marker.span.start, (name ?? marker).span.end),
      ));
      this.skipMistypedDeclaration();
      return null;
    }

    const methodName = name.value as NodeHttpMethodName;
    this.expect("leftParen", `Expected '(' after '@${methodName}'`);
    const path = this.check("extensionToken")
      ? this.advance()
      : this.advanceWithPathPatternDiagnostic(methodName);
    const pathSyntax = path.value === NODE_PATH_PATTERN_TOKEN && isNodePathPatternSyntax(path.payload)
      ? path.payload
      : null;
    if (path.kind === "extensionToken" && !pathSyntax) {
      this.diagnostics.push(diagnostic(
        "VEL6005",
        `The first @${methodName} item must be a p\"/...\" path pattern`,
        path.span,
      ));
    }
    const parameters: Parameter[] = pathSyntax ? this.pathParameters(pathSyntax) : [];
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
        parameters.push({ name: parameterName.value, type, defaultValue, rest, span: parameterSpan });
        sawDefault ||= defaultValue !== null;
        if (!this.match("comma")) break;
      }
    }
    const close = this.expect("rightParen", "Expected ')' after route parameters");
    const parameterListEnd = close.span.end;

    const { returnType, resultAnnotationSpan, expressionBody, body } = this.parseHandlerBody(parameterListEnd);
    const method = methodName.toUpperCase() as Uppercase<NodeHttpMethodName>;
    const end = body.at(-1)?.span.end ?? returnType?.span.end ?? close.span.end;
    return {
      kind: "NodeRouteDeclaration",
      name: `${method} ${pathSyntax?.value ?? ""}`,
      method,
      path: pathSyntax?.value ?? "",
      pathSpan: path.span,
      parameters,
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

  private advanceWithPathPatternDiagnostic(methodName: NodeHttpMethodName): Token {
    const token = this.current();
    this.diagnostics.push(diagnostic(
      "VEL6005",
      `The first @${methodName} item must be a Node path pattern such as p\"/articles/{id:string}\"`,
      token.span,
    ));
    return this.advance();
  }

  private pathParameters(path: NodePathPatternSyntax): Parameter[] {
    const parameters: Parameter[] = [];
    let segmentStart = 0;
    for (const segment of path.value.split("/")) {
      const sourceSpan = span(path.contentSpan.start + segmentStart, path.contentSpan.start + segmentStart + segment.length);
      segmentStart += segment.length + 1;
      if (!segment.includes("{") && !segment.includes("}")) continue;
      if (!(segment.startsWith("{") && segment.endsWith("}")) || segment.slice(1, -1).includes("{") || segment.slice(1, -1).includes("}")) {
        this.diagnostics.push(diagnostic("VEL6005", "A path capture must occupy one complete segment as '{name:type}'", sourceSpan));
        continue;
      }
      const declaration = segment.slice(1, -1);
      if (declaration.includes("：")) {
        const separatorStart = sourceSpan.start + 1 + declaration.indexOf("：");
        const separatorSpan = span(separatorStart, separatorStart + 1);
        this.diagnostics.push(diagnostic(
          "VEL6005",
          "A path capture uses the half-width ':' in '{name:type}'",
          separatorSpan,
          mechanicalFix(separatorSpan, ":", "Use the half-width ':'"),
        ));
        continue;
      }
      const separator = declaration.indexOf(":");
      if (separator <= 0 || separator !== declaration.lastIndexOf(":")) {
        this.diagnostics.push(diagnostic("VEL6005", "A path capture declares its name and type as '{name:type}'", sourceSpan));
        continue;
      }
      const parameterName = declaration.slice(0, separator);
      const typeName = declaration.slice(separator + 1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(parameterName)) {
        this.diagnostics.push(diagnostic("VEL6005", `Path capture name '${parameterName}' must be an identifier`, sourceSpan));
        continue;
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(typeName)) {
        this.diagnostics.push(diagnostic("VEL6005", `Path capture '${parameterName}' must use a named scalar type`, sourceSpan));
        continue;
      }
      const nameStart = sourceSpan.start + 1;
      const typeSpan = span(nameStart + separator + 1, sourceSpan.end - 1);
      const type: TypeReference = {
        syntax: { kind: "NamedTypeSyntax", name: typeName, span: typeSpan },
        span: typeSpan,
      };
      parameters.push({
        name: parameterName,
        type,
        defaultValue: null,
        rest: false,
        span: span(nameStart, sourceSpan.end - 1),
      });
    }
    return parameters;
  }
}
