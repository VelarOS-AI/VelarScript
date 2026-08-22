import type {
  CompilerSemanticExtension,
  Expression,
  SemanticExtensionContext,
  Statement,
} from "@velarscript/compiler/extension";
import {
  isWebExpression,
  isWebJsx,
  isWebKeyframes,
  isWebLook,
  isWebStatement,
  isWebUnit,
  type WebJsxElementExpression as JsxExpression,
  type WebWatchDeclaration,
} from "./ast.ts";

function visitJsx(expression: JsxExpression, context: SemanticExtensionContext): void {
  if (/^[A-Z]/u.test(expression.tag)) {
    context.reference(expression.tag, expression.tagSpan);
  }
  for (const attribute of expression.attributes) {
    const owner = context.jsxAttributeOwner(attribute.span, attribute.name);
    if (owner) {
      context.recordMemberReference(
        attribute.name,
        { start: attribute.span.start, end: attribute.span.start + attribute.name.length },
        owner,
        "extension-property",
      );
    }
    if (attribute.value && typeof attribute.value !== "string") context.visitExpression(attribute.value);
  }
  for (const child of expression.children) {
    if (child.kind === "JSXExpressionChild") context.visitExpression(child.expression);
    else if (child.kind === "ExtensionExpression:web:jsx") context.visitExpression(child);
  }
}

function visitWatch(statement: WebWatchDeclaration, context: SemanticExtensionContext): void {
  context.visitExpression(statement.expression);
  // D90 R16: a `writes` target names a state of the enclosing scope, so it is
  // recorded before the watch's own scope opens and go-to-definition, find-all
  // -references and rename follow it exactly as they follow a read of the name.
  for (const target of statement.writes) context.reference(target.name, target.span);
  context.enterScope(statement.span);
  let cursor = statement.expression.span.end;
  if (statement.currentName) {
    const selection = context.nameSpan(statement.span, statement.currentName, cursor);
    context.declare({ statement, role: "current" }, statement.currentName, "extension:parameter:web-watch-value", statement.span, selection);
    cursor = selection.end;
  }
  if (statement.previousName) {
    const selection = context.nameSpan(statement.span, statement.previousName, cursor);
    context.declare({ statement, role: "previous" }, statement.previousName, "extension:parameter:web-watch-value", statement.span, selection);
  }
  for (const child of statement.body) context.visitStatement(child);
  context.exitScope();
}

export const velarWebSemanticExtension: CompilerSemanticExtension = Object.freeze({
  predeclare(statement: Statement, context: SemanticExtensionContext) {
    if (!isWebStatement(statement)) return false;
    if (statement.kind === "ExtensionStatement:web:action") {
      context.declare(statement, statement.name, "extension:function:web-action", statement.span, context.nameSpan(statement.span, statement.name), { exported: statement.exported });
      return true;
    }
    if (statement.kind === "ExtensionStatement:web:component") {
      context.declare(statement, statement.name, "extension:function:web-component", statement.span, context.nameSpan(statement.span, statement.name), {
        exported: statement.exported,
        presentationKind: "class",
      });
      return true;
    }
    return false;
  },

  visitExpression(expression: Expression, context: SemanticExtensionContext) {
    if (isWebJsx(expression)) {
      visitJsx(expression, context);
      return true;
    }
    if (isWebLook(expression)) {
      const visit = (entries: typeof expression.entries): void => {
        for (const entry of entries) {
          if (entry.kind === "LookProperty" || entry.kind === "LookSpread") context.visitExpression(entry.value);
          else if (entry.kind === "LookIf") {
            context.visitExpression(entry.condition);
            visit(entry.thenEntries);
            visit(entry.elseEntries);
          } else visit(entry.entries);
        }
      };
      visit(expression.entries);
      return true;
    }
    if (isWebKeyframes(expression)) {
      for (const stop of expression.stops) for (const entry of stop.entries) context.visitExpression(entry.value);
      return true;
    }
    return isWebUnit(expression) || (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook");
  },

  visitStatement(statement: Statement, context: SemanticExtensionContext) {
    if (!isWebStatement(statement)) return false;
    switch (statement.kind) {
      case "ExtensionStatement:web:unsafe-css":
        // Its payload is opaque CSS for editor language injection, never a
        // VelarScript expression or reference graph.
        return true;
      case "ExtensionStatement:web:component":
        context.enterScope(statement.span);
        context.typeReferences(statement.handleType);
        for (const parameter of statement.parameters) {
          if (parameter.defaultValue) context.visitExpression(parameter.defaultValue);
          context.typeReferences(parameter.type);
          context.declare(
            parameter,
            parameter.name,
            "parameter",
            parameter.span,
            { start: parameter.span.start, end: parameter.span.start + parameter.name.length },
            { container: statement.name },
          );
        }
        for (const item of statement.body) {
          if (item.kind === "ExtensionStatement:web:mounted" || item.kind === "ExtensionStatement:web:cleanup") context.visitBlock(item.body, item.span);
          else if (item.kind === "ExtensionStatement:web:expose") context.visitExpression(item.value);
          else context.visitStatement(item);
        }
        context.exitScope();
        return true;
      case "ExtensionStatement:web:state": {
        context.visitExpression(statement.initializer);
        context.typeReferences(statement.type);
        context.declare(statement, statement.name, "extension:variable:web-state", statement.span, context.nameSpan(statement.span, statement.name), {
          exported: statement.exported,
          mutable: true,
          sourceTypeHint: true,
        });
        return true;
      }
      case "ExtensionStatement:web:computed": {
        context.visitExpression(statement.initializer);
        context.typeReferences(statement.type);
        context.declare(statement, statement.name, "extension:variable:web-computed", statement.span, context.nameSpan(statement.span, statement.name), {
          exported: statement.exported,
          mutable: false,
          sourceTypeHint: true,
        });
        return true;
      }
      case "ExtensionStatement:web:resource":
        context.visitExpression(statement.initializer);
        context.typeReferences(statement.type);
        context.declare(statement, statement.name, "extension:variable:web-resource", statement.span, context.nameSpan(statement.span, statement.name));
        return true;
      case "ExtensionStatement:web:action":
        if (!context.hasDeclaration(statement)) context.declare(statement, statement.name, "extension:function:web-action", statement.span, context.nameSpan(statement.span, statement.name), { exported: statement.exported });
        context.visitFunction(statement);
        return true;
      case "ExtensionStatement:web:watch":
        visitWatch(statement, context);
        return true;
      default:
        return false;
    }
  },
});
