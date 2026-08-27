import {
  JavaScriptEmitter,
  spanIdentity,
  type CompilerEmitterOptions,
  type Expression,
  type LoweringHints,
  type Program,
  type Statement,
  type TypeReference,
  type TypeSyntax,
  type ValueType,
} from "@velarscript/compiler/extension";
import { isNodeServerStatement, type NodeNotFoundDeclaration, type NodeResponseDeclaration, type NodeRouteDeclaration, type NodeServerDeclaration } from "./server-ast.ts";
import type { CompiledRoutePattern, RoutePatternCapture } from "./route-pattern.ts";
import { parseRouteCaptureHint, parseRouteParameterHint, parseRouteResultHint } from "./server-analyzer.ts";

export class NodeJavaScriptEmitter extends JavaScriptEmitter {
  private nodeServeOutput = false;
  private readonly source: CompilerEmitterOptions["source"];

  constructor(
    hints: LoweringHints,
    forcedFunctionExports: ReadonlySet<string> = new Set(),
    options: CompilerEmitterOptions = {},
  ) {
    super(hints, forcedFunctionExports, options);
    this.source = options.source;
  }

  override emit(program: Program): string {
    this.nodeServeOutput = program.body.some(isNodeServerStatement);
    return super.emit(program);
  }

  protected override additionalHelpers(program: Program): readonly string[] {
    const helpers = [...super.additionalHelpers(program)];
    if (!this.nodeServeOutput) return helpers;
    this.requireRuntimeModule("velar/serve");
    helpers.push('import { ServeApp as __velarServeAppType } from "velar/serve";');
    helpers.push("const { createApp: __velarCreateServeApp, createPattern: __velarCreateServePattern, createRoute: __velarCreateServeRoute, createWebSocket: __velarCreateServeWebSocket, createNotFound: __velarCreateServeNotFound, createResponse: __velarCreateServeResponse } = __velarServeAppType.__velarCompilerBridge;");
    return helpers;
  }

  protected override visitExtensionRuntimeStatement(
    statement: Statement,
    visitExpression: (expression: Expression) => void,
    visitStatement: (statement: Statement) => void,
  ): boolean {
    if (!isNodeServerStatement(statement)) return false;
    for (const item of statement.items) {
      if (item.kind === "NodeServerSpread") {
        visitExpression(item.value);
        continue;
      }
      if (item.kind === "NodeRouteDeclaration") visitExpression(item.pathExpression);
      for (const parameter of item.kind === "NodeRouteDeclaration" ? item.inputParameters : item.parameters) {
        if (parameter.defaultValue) visitExpression(parameter.defaultValue);
        if (parameter.type) visitExpression(runtimeTypeUse(parameter.type));
      }
      item.body.forEach(visitStatement);
    }
    return true;
  }

  protected override visitExtensionRuntimeExpression(expression: Expression, visitExpression: (expression: Expression) => void): boolean {
    if (expression.kind !== "ExtensionExpression:node:path-pattern") return false;
    this.nodeServeOutput = true;
    const pattern = (expression as typeof expression & {readonly pattern: CompiledRoutePattern}).pattern;
    for (const capture of [...pattern.path, ...pattern.query]) visitExpression(runtimeTypeUse(captureTypeReference(capture)));
    return true;
  }

  protected override extensionStatementContainsDirectAwait(
    statement: Statement,
    _containsExpression: (expression: Expression) => boolean,
    _containsBlock: (statements: readonly Statement[]) => boolean,
  ): boolean | undefined {
    return isNodeServerStatement(statement) ? false : undefined;
  }

  protected override emitStatement(statement: Statement, depth: number): string {
    if (isNodeServerStatement(statement)) return this.emitServer(statement, depth);
    return super.emitStatement(statement, depth);
  }

  protected override emitExpression(expression: Expression): string {
    if (expression.kind !== "ExtensionExpression:node:path-pattern") return super.emitExpression(expression);
    const pattern = (expression as typeof expression & {readonly pattern: CompiledRoutePattern}).pattern;
    return `__velarCreateServePattern(${this.emitPattern(pattern)})`;
  }

  private emitServer(statement: NodeServerDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const itemIndent = "  ".repeat(depth + 1);
    const items = statement.items.map((item) => item.kind === "NodeServerSpread"
      ? `${itemIndent}${this.emitMappedExpression(item.value)}`
      : item.kind === "NodeNotFoundDeclaration"
        ? `${itemIndent}${this.emitNotFound(item, depth + 1)}`
        : item.kind === "NodeResponseDeclaration"
          ? `${itemIndent}${this.emitResponse(item, depth + 1)}`
          : `${itemIndent}${this.emitRoute(item, depth + 1)}`);
    return [
      `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarCreateServeApp(${JSON.stringify(statement.name)}, [`,
      items.join(",\n"),
      `${indentation}]);`,
    ].join("\n");
  }

  private emitNotFound(fallback: NodeNotFoundDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const parameters = fallback.parameters.map((parameter) => this.emitParameter(parameter.name, parameter.defaultValue, false)).join(", ");
    const bodyLines = [...this.emitStatementLines(fallback.body, depth + 1)];
    if (!this.blockAlwaysReturns(fallback.body)) bodyLines.push(`${"  ".repeat(depth + 1)}return null;`);
    const body = bodyLines.join("\n");
    return `__velarCreateServeNotFound(async (${parameters}) => {${body ? `\n${body}\n${indentation}` : ""}})`;
  }

  private emitResponse(handler: NodeResponseDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const parameters = handler.parameters.map((parameter) => this.emitParameter(parameter.name, null, false)).join(", ");
    const bodyLines = [...this.emitStatementLines(handler.body, depth + 1)];
    if (!this.blockAlwaysReturns(handler.body)) bodyLines.push(`${"  ".repeat(depth + 1)}return null;`);
    const body = bodyLines.join("\n");
    const response = parseRouteResultHint(this.hints.extensionCalls.get(spanIdentity(handler.signatureSpan)))
      ?? {schema: {}, contentTypes: ["application/json"], status: null};
    return `__velarCreateServeResponse(async (${parameters}) => {${body ? `\n${body}\n${indentation}` : ""}}, {responseSchema:${JSON.stringify(response.schema)},responseContentTypes:${JSON.stringify(response.contentTypes)}})`;
  }

  private emitRoute(route: NodeRouteDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const inputParameters = route.inputParameters.map((parameter) => {
      const hint = parseRouteParameterHint(this.hints.extensionCalls.get(spanIdentity(parameter.span)));
      return this.emitParameter(parameter.name, hint?.descriptor ? null : parameter.defaultValue, false);
    });
    const bindRoute = route.routeBinding !== null || route.projectedCaptures.length > 0;
    const routeParameter = route.routeBinding?.name ?? this.emitProjectedRouteParameter(route);
    const parameters = [...(bindRoute ? [routeParameter] : []), ...inputParameters].join(", ");
    const descriptors = route.inputParameters
      .map((parameter) => this.emitRouteParameter(parameter.type, parameter.name, parameter.defaultValue, parameter.span)).join(", ");
    if (route.transport === "websocket") {
      const bodyLines = [...this.emitStatementLines(route.body, depth + 1)];
      if (!this.blockAlwaysReturns(route.body)) bodyLines.push(`${"  ".repeat(depth + 1)}return null;`);
      const body = bodyLines.join("\n");
      return `__velarCreateServeWebSocket(${this.emitMappedExpression(route.pathExpression)}, [${descriptors}], async (${parameters}) => {${body ? `\n${body}\n${indentation}` : ""}}, {operationId:${JSON.stringify(route.operationId)}}, ${bindRoute})`;
    }
    const response = parseRouteResultHint(this.hints.extensionCalls.get(spanIdentity(route.signatureSpan))) ?? {schema: {}, contentTypes: ["application/json"], status: null};
    const description = this.routeDocumentation(route.span.start);
    const bodyLines = [...this.emitStatementLines(route.body, depth + 1)];
    if (!this.blockAlwaysReturns(route.body)) bodyLines.push(`${"  ".repeat(depth + 1)}return null;`);
    const body = bodyLines.join("\n");
    return `__velarCreateServeRoute(${JSON.stringify(route.method)}, ${this.emitMappedExpression(route.pathExpression)}, [${descriptors}], async (${parameters}) => {${body ? `\n${body}\n${indentation}` : ""}}, {operationId:${JSON.stringify(route.operationId)},responseSchema:${JSON.stringify(response.schema)},responseContentTypes:${JSON.stringify(response.contentTypes)},status:${JSON.stringify(response.status)},description:${JSON.stringify(description)}}, ${bindRoute})`;
  }

  private emitProjectedRouteParameter(route: NodeRouteDeclaration): string {
    if (route.pathExpression.kind !== "ExtensionExpression:node:path-pattern") return `__velarRoute${route.span.start}`;
    const pattern = (route.pathExpression as typeof route.pathExpression & {readonly pattern: CompiledRoutePattern}).pattern;
    const fields = (captures: readonly RoutePatternCapture[]): string => captures.map((capture) => capture.name).join(",");
    if (pattern.path.length === 0 && pattern.query.length === 0) return `__velarRoute${route.span.start}`;
    return `{params:{${fields(pattern.path)}},query:{${fields(pattern.query)}}}`;
  }

  private emitPattern(pattern: CompiledRoutePattern): string {
    const capture = (item: RoutePatternCapture): string => {
      const type = routeValueType(captureTypeReference(item).syntax);
      const hint = parseRouteCaptureHint(this.hints.extensionCalls.get(spanIdentity(item.typeSpan)));
      const kind = hint?.kind ?? scalarRouteKind(type);
      const schema = hint?.schema ?? routeSchema(type);
      return `{name:${JSON.stringify(item.name)},wireName:${JSON.stringify(item.wireName)},explicitWireName:${item.explicitWireName},typeName:${JSON.stringify(item.typeName)},optional:${item.optional},kind:${JSON.stringify(kind)},check:(value)=>${this.emitTypeCheck(type, "value")},schema:${JSON.stringify(schema)}}`;
    };
    return `{definition:${JSON.stringify(pattern.definition)},pathname:${JSON.stringify(pattern.pathname)},path:[${pattern.path.map(capture).join(",")}],query:[${pattern.query.map(capture).join(",")}]}`;
  }

  private routeDocumentation(start: number): string | null {
    if (!this.source) return null;
    const location = this.source.location(start);
    const lineStart = this.source.lineStarts[location.line - 1] ?? 0;
    const indentation = this.source.text.slice(lineStart, start);
    if (!/^[ \t]*$/u.test(indentation)) return null;
    const lines: string[] = [];
    for (let line = location.line - 1; line > 0; line -= 1) {
      const sourceLine = this.source.lineText(line);
      if (!sourceLine.startsWith(`${indentation}///`)) break;
      const suffix = sourceLine.slice(indentation.length + 3);
      lines.unshift(suffix.startsWith(" ") ? suffix.slice(1) : suffix);
    }
    while (lines[0] === "") lines.shift();
    while (lines.at(-1) === "") lines.pop();
    const value = lines.join("\n");
    if (value.length === 0) return null;
    return value.length <= 16_384 ? value : `${value.slice(0, 16_383)}…`;
  }

  private emitRouteParameter(type: TypeReference | null, name: string, defaultValue: Expression | null, sourceSpan: { readonly start: number; readonly end: number }): string {
    const hint = parseRouteParameterHint(this.hints.extensionCalls.get(spanIdentity(sourceSpan)))
      ?? { source: "body" as const, kind: "data" as const, schema: {}, descriptor: false };
    if (hint.source === "request") {
      return `{name:${JSON.stringify(name)},source:"request",kind:"request",required:true,schema:{}}`;
    }
    if (hint.source === "connection") {
      return `{name:${JSON.stringify(name)},source:"connection",kind:"connection",required:true,schema:{}}`;
    }
    const check = type ? this.emitTypeCheck(routeValueType(type.syntax), "value") : "true";
    const input = hint.descriptor && defaultValue ? `,input:${this.emitMappedExpression(defaultValue)}` : "";
    const required = hint.descriptor ? "true" : defaultValue ? "false" : "true";
    return `{name:${JSON.stringify(name)},source:${JSON.stringify(hint.source)},kind:${JSON.stringify(hint.kind)},required:${required},check:(value)=>${check},schema:${JSON.stringify(hint.schema)}${input}}`;
  }
}

function captureTypeReference(capture: RoutePatternCapture): TypeReference {
  return {syntax: {kind: "NamedTypeSyntax", name: capture.typeName, span: capture.typeSpan}, span: capture.typeSpan};
}

function scalarRouteKind(type: ValueType): "string" | "number" | "bool" | "enum" {
  if (type.kind === "number") return "number";
  if (type.kind === "bool") return "bool";
  if (type.kind === "enum" || type.kind === "enumMember" || type.kind === "named") return "enum";
  return "string";
}

function routeSchema(type: ValueType): Readonly<Record<string, unknown>> {
  if (type.kind === "number") return {type: "number"};
  if (type.kind === "bool") return {type: "boolean"};
  return {type: "string"};
}

function runtimeTypeUse(type: TypeReference): Expression {
  const value: Expression = { kind: "LiteralExpression", value: null, raw: "null", span: type.span };
  return { kind: "IsExpression", value, operator: "is", type, span: type.span };
}

function routeValueType(syntax: TypeSyntax): ValueType {
  const nested = (value: TypeSyntax): ValueType => routeValueType(value);
  switch (syntax.kind) {
    case "NamedTypeSyntax":
      if (syntax.name === "string" || syntax.name === "number") return { kind: syntax.name };
      if (syntax.name === "bool") return { kind: "bool" };
      if (syntax.name === "null") return { kind: "null" };
      if (syntax.name === "unknown" || syntax.name === "any") return { kind: syntax.name };
      return { kind: "named", name: syntax.name };
    case "EnumMemberTypeSyntax":
      return { kind: "enumMember", name: syntax.enumName, identity: syntax.enumName, member: syntax.member };
    case "GenericTypeSyntax": {
      const arguments_ = syntax.arguments.map(nested);
      if (syntax.name === "List") return { kind: "list", element: arguments_[0] ?? { kind: "unknown" } };
      if (syntax.name === "Set") return { kind: "set", element: arguments_[0] ?? { kind: "unknown" } };
      if (syntax.name === "Map") return { kind: "map", key: arguments_[0] ?? { kind: "unknown" }, value: arguments_[1] ?? { kind: "unknown" } };
      if (syntax.name === "Record") return { kind: "record", value: arguments_[0] ?? { kind: "unknown" } };
      if (syntax.name === "Promise") return { kind: "promise", value: arguments_[0] ?? { kind: "unknown" } };
      return { kind: "named", name: syntax.name, application: { declaration: syntax.name, name: syntax.name, arguments: arguments_ } };
    }
    case "ReadonlyTypeSyntax":
      return nested(syntax.inner);
    case "OptionalTypeSyntax":
      return { kind: "optional", inner: nested(syntax.inner) };
    case "UnionTypeSyntax":
      return { kind: "union", members: syntax.members.map(nested) };
    case "FunctionTypeSyntax": {
      const parameters = syntax.parameters.filter((parameter) => !parameter.rest);
      const rest = syntax.parameters.find((parameter) => parameter.rest);
      return {
        kind: "function",
        parameters: parameters.map((parameter) => nested(parameter.type)),
        requiredParameters: parameters.filter((parameter) => !parameter.optional).length,
        ...(rest ? { rest: nested(rest.type) } : {}),
        result: nested(syntax.result),
      };
    }
  }
}
