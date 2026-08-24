import type {
  CompilerSemanticExtension,
  SemanticExtensionContext,
  Statement,
} from "@velarscript/compiler/extension";
import { isNodeServerStatement } from "./server-ast.ts";

export const velarNodeSemanticExtension: CompilerSemanticExtension = Object.freeze({
  predeclare(statement: Statement, context: SemanticExtensionContext) {
    if (!isNodeServerStatement(statement)) return false;
    context.syntaxToken(context.nameSpan(statement.span, "server"), "keyword");
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
      const role = item.kind === "NodeNotFoundDeclaration" ? "notFound" : item.method.toLowerCase();
      context.syntaxToken({ start: item.signatureSpan.start, end: item.signatureSpan.start + role.length + 1 }, "keyword");
      if (item.kind === "NodeRouteDeclaration" && context.source[item.pathSpan.start] === "p") {
        context.syntaxToken({ start: item.pathSpan.start, end: item.pathSpan.start + 1 }, "keyword");
      }
      context.enterScope(item.span);
      for (const parameter of item.parameters) {
        if (parameter.defaultValue) context.visitExpression(parameter.defaultValue);
        context.typeReferences(parameter.type);
        context.declare(
          parameter,
          parameter.name,
          "parameter",
          parameter.span,
          { start: parameter.span.start, end: parameter.span.start + parameter.name.length },
          { container: item.name },
        );
      }
      for (const child of item.body) context.visitStatement(child);
      context.exitScope();
    }
    return true;
  },
});
