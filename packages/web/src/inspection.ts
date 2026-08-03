import type {
  CompilerDependencyContext,
  CompilerInspectionExtension,
  CompilerInterfaceContext,
  Expression,
  Statement,
  ValueType,
} from "@velarscript/compiler/extension";

function visitDependencyExpression(expression: Expression, context: CompilerDependencyContext): boolean {
  if (expression.kind !== "JSXElementExpression") return false;
  for (const attribute of expression.attributes) {
    if (attribute.value && typeof attribute.value !== "string") context.visitExpression(attribute.value);
  }
  for (const child of expression.children) {
    if (child.kind === "JSXExpressionChild") context.visitExpression(child.expression);
    else if (child.kind === "JSXElementExpression") context.visitExpression(child);
  }
  return true;
}

function visitDependencyStatement(statement: Statement, context: CompilerDependencyContext): boolean {
  switch (statement.kind) {
    case "ComponentDeclaration":
      for (const parameter of statement.parameters) if (parameter.defaultValue) context.visitExpression(parameter.defaultValue);
      for (const item of statement.body) {
        if (item.kind === "MountedBlock" || item.kind === "CleanupBlock") context.visitBlock(item.body);
        else if (item.kind !== "StyleBlock") context.visitStatement(item);
      }
      return true;
    case "StateDeclaration":
    case "ComputedDeclaration":
    case "ResourceDeclaration":
      context.visitExpression(statement.initializer);
      return true;
    case "ActionDeclaration":
      for (const parameter of statement.parameters) if (parameter.defaultValue) context.visitExpression(parameter.defaultValue);
      context.visitBlock(statement.body);
      return true;
    case "WatchDeclaration":
      context.visitExpression(statement.expression);
      context.visitBlock(statement.body);
      return true;
    default:
      return false;
  }
}

function contributeInterface(statement: Statement, context: CompilerInterfaceContext): boolean {
  if (statement.kind === "StateDeclaration" || statement.kind === "ComputedDeclaration") {
    context.exports.set(statement.name, statement.type ? context.resolve(statement.type) : context.inferPublicExpression(statement.initializer));
    context.reactiveExports.set(statement.name, statement.kind === "StateDeclaration" ? "state" : "computed");
    return true;
  }
  if (statement.kind === "ComponentDeclaration") {
    context.exports.set(statement.name, {
      kind: "componentConstructor",
      name: statement.name,
      props: new Map(statement.parameters.map((parameter) => [parameter.name, context.resolve(parameter.type)])),
      requiredProps: new Set(statement.parameters.filter((parameter) => !parameter.defaultValue).map((parameter) => parameter.name)),
    });
    return true;
  }
  return false;
}

export const velarWebInspectionExtension: CompilerInspectionExtension = Object.freeze({
  visitDependencyExpression,
  visitDependencyStatement,
  contributeInterface,
  inferPublicExpression(expression: Expression): ValueType | undefined {
    return expression.kind === "JSXElementExpression" ? { kind: "node" } : undefined;
  },
});
