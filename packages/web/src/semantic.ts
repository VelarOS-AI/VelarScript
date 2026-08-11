import type {
  CompilerSemanticExtension,
  Expression,
  SemanticExtensionContext,
  Statement,
} from "@velarscript/compiler/extension";

type JsxExpression = Extract<Expression, { kind: "JSXElementExpression" }>;

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
        "jsx-prop",
      );
    }
    if (attribute.value && typeof attribute.value !== "string") context.visitExpression(attribute.value);
  }
  for (const child of expression.children) {
    if (child.kind === "JSXExpressionChild") context.visitExpression(child.expression);
    else if (child.kind === "JSXElementExpression") context.visitExpression(child);
  }
}

function visitWatch(statement: Extract<Statement, { kind: "WatchDeclaration" }>, context: SemanticExtensionContext): void {
  context.visitExpression(statement.expression);
  context.enterScope(statement.span);
  let cursor = statement.expression.span.end;
  if (statement.currentName) {
    const selection = context.nameSpan(statement.span, statement.currentName, cursor);
    context.declare({ statement, role: "current" }, statement.currentName, "watch-value", statement.span, selection);
    cursor = selection.end;
  }
  if (statement.previousName) {
    const selection = context.nameSpan(statement.span, statement.previousName, cursor);
    context.declare({ statement, role: "previous" }, statement.previousName, "watch-value", statement.span, selection);
  }
  for (const child of statement.body) context.visitStatement(child);
  context.exitScope();
}

export const velarWebSemanticExtension: CompilerSemanticExtension = Object.freeze({
  predeclare(statement: Statement, context: SemanticExtensionContext) {
    if (statement.kind === "ActionDeclaration") {
      context.declare(statement, statement.name, "action", statement.span, context.nameSpan(statement.span, statement.name), { exported: statement.exported });
      return true;
    }
    if (statement.kind === "ComponentDeclaration") {
      context.declare(statement, statement.name, "component", statement.span, context.nameSpan(statement.span, statement.name), { exported: statement.exported });
      return true;
    }
    return false;
  },

  visitExpression(expression: Expression, context: SemanticExtensionContext) {
    if (expression.kind === "JSXElementExpression") {
      visitJsx(expression, context);
      return true;
    }
    if (expression.kind === "LookExpression") {
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
    return expression.kind === "UnitLiteralExpression" || expression.kind === "LookHookExpression";
  },

  visitStatement(statement: Statement, context: SemanticExtensionContext) {
    switch (statement.kind) {
      case "UnsafeCssImportDeclaration":
        return true;
      case "ComponentDeclaration":
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
          if (item.kind === "MountedBlock" || item.kind === "CleanupBlock") context.visitBlock(item.body, item.span);
          else if (item.kind === "ExposeDeclaration") context.visitExpression(item.value);
          else context.visitStatement(item);
        }
        context.exitScope();
        return true;
      case "StateDeclaration": {
        context.visitExpression(statement.initializer);
        context.typeReferences(statement.type);
        context.declare(statement, statement.name, "state", statement.span, context.nameSpan(statement.span, statement.name), {
          exported: statement.exported,
          mutable: true,
        });
        return true;
      }
      case "ResourceDeclaration":
        context.visitExpression(statement.initializer);
        context.typeReferences(statement.type);
        context.declare(statement, statement.name, "resource", statement.span, context.nameSpan(statement.span, statement.name));
        return true;
      case "ActionDeclaration":
        if (!context.hasDeclaration(statement)) context.declare(statement, statement.name, "action", statement.span, context.nameSpan(statement.span, statement.name), { exported: statement.exported });
        context.visitFunction(statement);
        return true;
      case "WatchDeclaration":
        visitWatch(statement, context);
        return true;
      default:
        return false;
    }
  },
});
