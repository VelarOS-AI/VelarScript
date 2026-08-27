import type {
  CompilerSemanticExtension,
  SemanticExtensionContext,
  Statement,
} from "@velarscript/compiler/extension";
import { isNodeServerStatement, type NodePathPatternExpression } from "./server-ast.ts";

export const velarNodeSemanticExtension: CompilerSemanticExtension = Object.freeze({
  predeclare(statement: Statement, context: SemanticExtensionContext) {
    if (!isNodeServerStatement(statement)) return false;
    const keyword = context.nameSpan(statement.span, "server");
    context.syntaxToken(keyword, "keyword");
    context.documentSyntax(keyword, "server");
    context.declare(
      statement,
      statement.name,
      "extension:variable:node-server",
      statement.span,
      context.nameSpan(statement.span, statement.name),
      { exported: statement.exported },
    );
    return true;
  },

  visitStatement(statement: Statement, context: SemanticExtensionContext) {
    if (!isNodeServerStatement(statement)) return false;
    for (const item of statement.items) {
      if (item.kind === "NodeServerSpread") {
        context.visitExpression(item.value);
        continue;
      }
      const role = item.kind === "NodeNotFoundDeclaration" ? "notFound"
        : item.kind === "NodeResponseDeclaration" ? "response" : item.method.toLowerCase();
      const roleSpan = { start: item.signatureSpan.start, end: item.signatureSpan.start + role.length + 1 };
      context.syntaxToken(roleSpan, "decorator");
      context.documentSyntax(roleSpan, `@${role}`);
      if (item.kind === "NodeRouteDeclaration" && item.operationSpan !== null) {
        // 操作名属于对外协议身份，不在处理器作用域中声明变量；编辑器使用
        // 函数色表达“可调用能力”，同时避免把它误导成捕获参数。
        context.syntaxToken(item.operationSpan, "function");
      }
      if (item.kind === "NodeRouteDeclaration" && context.source[item.pathSpan.start] === "p") {
        context.documentSyntax({ start: item.pathSpan.start, end: item.pathSpan.start + 1 }, "p");
      }
      if (item.kind === "NodeRouteDeclaration" && item.pathExpression.kind === "ExtensionExpression:node:path-pattern") {
        const pattern = (item.pathExpression as NodePathPatternExpression).pattern;
        for (const capture of pattern.path.concat(pattern.query)) {
          // 未使用 `as` 时，字段在这里就是处理器参数的声明位置；对象模式
          // 只声明 RouteMatch 的属性，编辑器据此给出不同的颜色和补全入口。
          if (item.routeBinding !== null) {
            context.syntaxToken({start: capture.span.start + 1, end: capture.span.start + 1 + capture.name.length}, "property");
          }
          context.syntaxToken(capture.typeSpan, "type");
        }
      }
      context.enterScope(item.span);
      if (item.kind === "NodeRouteDeclaration" && item.routeBinding === null) {
        for (const [index, parameter] of item.parameters.slice(0, item.projectedCaptures.length).entries()) {
          const capture = item.projectedCaptures[index]!;
          context.typeReferences(parameter.type);
          context.declare(
            parameter,
            parameter.name,
            "parameter",
            parameter.span,
            {start: capture.span.start + 1, end: capture.span.start + 1 + capture.name.length},
            {container: item.name},
          );
        }
      } else if (item.kind === "NodeRouteDeclaration" && item.routeBinding !== null) {
        const parameter = item.parameters[0]!;
        context.declare(
          parameter,
          parameter.name,
          "parameter",
          parameter.span,
          item.routeBinding.span,
          {container: item.name},
        );
      }
      const parameters = item.kind === "NodeRouteDeclaration" ? item.inputParameters : item.parameters;
      for (const parameter of parameters) {
        if (parameter.defaultValue) context.visitExpression(parameter.defaultValue);
        context.typeReferences(parameter.type);
        const nameSpan = { start: parameter.span.start, end: parameter.span.start + parameter.name.length };
        context.declare(
          parameter,
          parameter.name,
          "parameter",
          parameter.span,
          nameSpan,
          { container: item.name },
        );
      }
      for (const child of item.body) context.visitStatement(child);
      context.exitScope();
    }
    return true;
  },
});
