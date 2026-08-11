import {
  type CompilerDependencyContext,
  type CompilerInspectionExtension,
  type CompilerInterfaceContext,
  type Expression,
  type Statement,
  type ValueType,
  type Program,
} from "@velarscript/compiler/extension";
import { optionalOf } from "@velarscript/compiler";
import { LOOK_UNIT_TYPES } from "./look.ts";
import { exportedLookStaticValues, lookStaticIdentity } from "./look-static.ts";

function visitDependencyExpression(expression: Expression, context: CompilerDependencyContext): boolean {
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
  if (expression.kind === "LookHookExpression") return true;
  if (expression.kind === "UnitLiteralExpression") return true;
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
        else context.visitStatement(item);
      }
      return true;
    case "StateDeclaration":
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
    case "UnsafeCssImportDeclaration":
      return true;
    default:
      return false;
  }
}

function contributeInterface(statement: Statement, context: CompilerInterfaceContext): boolean {
  if (statement.kind === "ActionDeclaration") {
    // An exported module action travels as its analyzed action type, so the
    // importing module can call it and read its reactive pending/error fields.
    // Unlike state exports it needs no reactiveExports entry: the
    // action value is an ordinary function whose reactive cells live behind
    // its own property getters, so imported reads never lower through .get().
    const rest = statement.parameters.find((parameter) => parameter.rest);
    context.exports.set(
      statement.name,
      context.bindingType(statement.name, statement.span.start) ?? {
        kind: "action",
        parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => context.resolve(parameter.type)),
        parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
        requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
        ...(rest ? { rest: context.resolve(rest.type) } : {}),
        result: { kind: "promise", value: statement.returnType ? context.resolve(statement.returnType) : context.unresolvedInferredResult },
      },
    );
    return true;
  }
  if (statement.kind === "StateDeclaration") {
    context.exports.set(
      statement.name,
      context.bindingType(statement.name, statement.span.start)
        ?? (statement.type ? context.resolve(statement.type) : context.inferPublicExpression(statement.initializer)),
    );
    context.reactiveExports.set(statement.name, "state");
    return true;
  }
  if (statement.kind === "ComponentDeclaration") {
    const analyzed = context.bindingType(statement.name, statement.span.start);
    if (analyzed?.kind === "componentConstructor") {
      context.exports.set(statement.name, analyzed);
      return true;
    }
    const props = new Map(statement.parameters.map((parameter) => [parameter.name, context.resolve(parameter.type)]));
    if (!props.has("class")) props.set("class", optionalOf({ kind: "string" }));
    if (!props.has("look")) props.set("look", optionalOf({ kind: "named", name: "Look" }));
    context.exports.set(statement.name, {
      kind: "componentConstructor",
      name: statement.name,
      props,
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
  exportAnnotations: exportedLookStaticValues,
  interfaceExportIdentity: (_name: string, value: unknown) => lookStaticIdentity(value),
  resources(program: Program) {
    const resources: { source: string; kind: string }[] = [];
    for (const statement of program.body) {
      if (statement.kind === "UnsafeCssImportDeclaration") {
        resources.push({ source: statement.source, kind: "unsafe CSS" });
      }
    }
    return resources;
  },
  inferPublicExpression(expression: Expression): ValueType | undefined {
    if (expression.kind === "JSXElementExpression") return { kind: "node" };
    if (expression.kind === "LookExpression") return { kind: "named", name: "Look" };
    if (expression.kind === "UnitLiteralExpression") {
      const name = LOOK_UNIT_TYPES.get(expression.unit);
      return name ? { kind: "named", name } : undefined;
    }
    return undefined;
  },
});
