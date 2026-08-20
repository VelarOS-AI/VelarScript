import type {
  CompilerSemanticExtension,
  SemanticExtensionContext,
  Statement,
} from "@velarscript/compiler/extension";
import { isNodeServerStatement } from "./server-ast.ts";

export const velarNodeSemanticExtension: CompilerSemanticExtension = Object.freeze({
  predeclare(statement: Statement, context: SemanticExtensionContext) {
    if (!isNodeServerStatement(statement)) return false;
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
