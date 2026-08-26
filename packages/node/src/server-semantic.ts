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
      if (item.kind === "NodeRouteDeclaration" && context.source[item.pathSpan.start] === "p") {
        context.documentSyntax({ start: item.pathSpan.start, end: item.pathSpan.start + 1 }, "p");
      }
      if (item.kind === "NodeRouteDeclaration" && item.pathExpression.kind === "ExtensionExpression:node:path-pattern") {
        // 捕获已经不再伪装成处理函数参数，但编辑器仍应把协议里的字段和类型
        // 标成 parameter/type，阅读路由目录时才能直接看懂它的输入契约。
        const pattern = (item.pathExpression as NodePathPatternExpression).pattern;
        for (const capture of pattern.path.concat(pattern.query)) {
          context.syntaxToken({start: capture.span.start + 1, end: capture.span.start + 1 + capture.name.length}, "parameter");
          context.syntaxToken(capture.typeSpan, "type");
        }
      }
      context.enterScope(item.span);
      for (const parameter of item.parameters) {
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
