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
import { isNodeServerStatement, type NodeRouteDeclaration, type NodeServerDeclaration } from "./server-ast.ts";
import { parseRouteParameterHint, parseRouteResultHint } from "./server-analyzer.ts";

export class NodeJavaScriptEmitter extends JavaScriptEmitter {
  private nodeServerOutput = false;
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
    this.nodeServerOutput = program.body.some(isNodeServerStatement);
    return super.emit(program);
  }

  protected override additionalHelpers(program: Program): readonly string[] {
    const helpers = [...super.additionalHelpers(program)];
    if (!this.nodeServerOutput) return helpers;
    this.requireRuntimeModule("velar/serve");
    helpers.push('import { ServeApp as __velarServeAppType } from "velar/serve";');
    helpers.push("const { createApp: __velarCreateServeApp, createRoute: __velarCreateServeRoute } = __velarServeAppType.__velarCompilerBridge;");
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
      for (const parameter of item.parameters) {
        if (parameter.defaultValue) visitExpression(parameter.defaultValue);
        if (parameter.type) visitExpression(runtimeTypeUse(parameter.type));
      }
      item.body.forEach(visitStatement);
    }
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

  private emitServer(statement: NodeServerDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const itemIndent = "  ".repeat(depth + 1);
    const items = statement.items.map((item) => item.kind === "NodeServerSpread"
      ? `${itemIndent}${this.emitMappedExpression(item.value)}`
      : `${itemIndent}${this.emitRoute(item, depth + 1)}`);
    return [
      `${indentation}${statement.exported ? "export " : ""}const ${statement.name} = __velarCreateServeApp(${JSON.stringify(statement.name)}, [`,
      items.join(",\n"),
      `${indentation}]);`,
    ].join("\n");
  }

  private emitRoute(route: NodeRouteDeclaration, depth: number): string {
    const indentation = "  ".repeat(depth);
    const parameters = route.parameters.map((parameter) => {
      const hint = parseRouteParameterHint(this.hints.extensionCalls.get(spanIdentity(parameter.span)));
      return this.emitParameter(parameter.name, hint?.descriptor ? null : parameter.defaultValue, false);
    }).join(", ");
    const descriptors = route.parameters.map((parameter) => this.emitRouteParameter(parameter.type, parameter.name, parameter.defaultValue, parameter.span)).join(", ");
    const response = parseRouteResultHint(this.hints.extensionCalls.get(spanIdentity(route.signatureSpan))) ?? {schema: {}, contentTypes: ["application/json"], status: null};
    const description = this.routeDocumentation(route.span.start);
    const bodyLines = [...this.emitStatementLines(route.body, depth + 1)];
    if (!this.blockAlwaysReturns(route.body)) bodyLines.push(`${"  ".repeat(depth + 1)}return null;`);
    const body = bodyLines.join("\n");
    return `__velarCreateServeRoute(${JSON.stringify(route.method)}, ${JSON.stringify(route.path)}, [${descriptors}], async (${parameters}) => {${body ? `\n${body}\n${indentation}` : ""}}, {responseSchema:${JSON.stringify(response.schema)},responseContentTypes:${JSON.stringify(response.contentTypes)},status:${JSON.stringify(response.status)},description:${JSON.stringify(description)}})`;
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
    const check = type ? this.emitTypeCheck(routeValueType(type.syntax), "value") : "true";
    const input = hint.descriptor && defaultValue ? `,input:${this.emitMappedExpression(defaultValue)}` : "";
    const required = hint.descriptor ? "true" : defaultValue ? "false" : "true";
    return `{name:${JSON.stringify(name)},source:${JSON.stringify(hint.source)},kind:${JSON.stringify(hint.kind)},required:${required},check:(value)=>${check},schema:${JSON.stringify(hint.schema)}${input}}`;
  }
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
