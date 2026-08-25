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

function documentKeyword(statement: Statement, keyword: string, context: SemanticExtensionContext): void {
  context.documentSyntax(context.nameSpan(statement.span, keyword), keyword);
}

function documentedPrefix(
  context: SemanticExtensionContext,
  span: { readonly start: number; readonly end: number },
  spelling: string,
  key = spelling,
): void {
  if (!context.source.startsWith(spelling, span.start)) return;
  context.documentSyntax({ start: span.start, end: span.start + spelling.length }, key);
}

function jsxDocumentationKey(name: string): string | null {
  if (name.startsWith("on:")) return "jsx:on:*";
  if (name === "bind:value" || name === "bind:checked" || name === "bind:group") return `jsx:${name}`;
  if (name.startsWith("class:")) return "jsx:class:*";
  if (name.startsWith("look:")) return "jsx:look:*";
  if (name.startsWith("style:")) return "jsx:style:*";
  if (name === "look" || name === "ref" || name === "key" || name === "host" || name === "unsafe:html") return `jsx:${name}`;
  return null;
}

function visitJsx(expression: JsxExpression, context: SemanticExtensionContext): void {
  if (/^[A-Z]/u.test(expression.tag)) {
    context.reference(expression.tag, expression.tagSpan);
  }
  for (const attribute of expression.attributes) {
    const documentationKey = jsxDocumentationKey(attribute.name);
    if (documentationKey) documentedPrefix(context, attribute.span, attribute.name, documentationKey);
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
      documentKeyword(statement, "action", context);
      context.declare(statement, statement.name, "extension:function:web-action", statement.span, context.nameSpan(statement.span, statement.name), { exported: statement.exported });
      return true;
    }
    if (statement.kind === "ExtensionStatement:web:component") {
      documentKeyword(statement, "component", context);
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
      context.documentSyntax(context.nameSpan(expression.span, "look"), "look");
      const visit = (entries: typeof expression.entries): void => {
        for (const entry of entries) {
          if (entry.kind === "LookProperty" || entry.kind === "LookSpread") context.visitExpression(entry.value);
          else if (entry.kind === "LookIf") {
            context.visitExpression(entry.condition);
            visit(entry.thenEntries);
            visit(entry.elseEntries);
          } else {
            const target = `@${entry.name}`;
            documentedPrefix(context, entry.span, target);
            if (context.source.startsWith(target, entry.span.start)) {
              context.syntaxToken({ start: entry.span.start, end: entry.span.start + target.length }, "decorator");
            }
            visit(entry.entries);
          }
        }
      };
      visit(expression.entries);
      return true;
    }
    if (isWebKeyframes(expression)) {
      context.documentSyntax(context.nameSpan(expression.span, "keyframes"), "keyframes");
      for (const stop of expression.stops) for (const entry of stop.entries) context.visitExpression(entry.value);
      return true;
    }
    if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") {
      documentedPrefix(context, expression.span, `@${expression.name}`);
      context.syntaxToken(expression.span, "decorator");
      return true;
    }
    return isWebUnit(expression);
  },

  visitStatement(statement: Statement, context: SemanticExtensionContext) {
    if (!isWebStatement(statement)) return false;
    switch (statement.kind) {
      case "ExtensionStatement:web:unsafe-css":
        documentKeyword(statement, "css", context);
        // Its payload is opaque CSS for editor language injection, never a
        // VelarScript expression or reference graph.
        return true;
      case "ExtensionStatement:web:component":
        documentKeyword(statement, "component", context);
        if (statement.handleType) documentKeyword(statement, "exposes", context);
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
          if (item.kind === "ExtensionStatement:web:mounted" || item.kind === "ExtensionStatement:web:cleanup") {
            const role = item.kind === "ExtensionStatement:web:mounted" ? "@mounted" : "@cleanup";
            documentedPrefix(context, item.span, role);
            if (context.source.startsWith(role, item.span.start)) {
              context.syntaxToken({ start: item.span.start, end: item.span.start + role.length }, "decorator");
            }
            context.visitBlock(item.body, item.span);
          } else if (item.kind === "ExtensionStatement:web:expose") {
            documentKeyword(item, "expose", context);
            context.visitExpression(item.value);
          }
          else context.visitStatement(item);
        }
        context.exitScope();
        return true;
      case "ExtensionStatement:web:state": {
        documentKeyword(statement, "state", context);
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
        documentKeyword(statement, "computed", context);
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
        documentKeyword(statement, "resource", context);
        context.visitExpression(statement.initializer);
        context.typeReferences(statement.type);
        context.declare(statement, statement.name, "extension:variable:web-resource", statement.span, context.nameSpan(statement.span, statement.name));
        return true;
      case "ExtensionStatement:web:action":
        documentKeyword(statement, "action", context);
        if (!context.hasDeclaration(statement)) context.declare(statement, statement.name, "extension:function:web-action", statement.span, context.nameSpan(statement.span, statement.name), { exported: statement.exported });
        context.visitFunction(statement);
        return true;
      case "ExtensionStatement:web:watch":
        documentKeyword(statement, "watch", context);
        visitWatch(statement, context);
        return true;
      default:
        return false;
    }
  },
});
