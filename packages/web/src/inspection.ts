import type {
  CompilerDependencyContext,
  CompilerInspectionExtension,
  CompilerInterfaceContext,
  Expression,
  Statement,
  ValueType,
  Program,
} from "@velarscript/compiler/extension";

const publicBuilderTypes = new Map<string, ValueType>([
  ...["color", "rgb", "rgba", "hsl", "alpha", "lighten", "darken"].map((name) => [name, { kind: "named", name: "Color" } as ValueType] as const),
  ["border", { kind: "named", name: "Border" }],
  ["shadow", { kind: "named", name: "Shadow" }],
  ["linearGradient", { kind: "named", name: "Image" }],
  ["asset", { kind: "named", name: "Image" }],
  ["minmax", { kind: "named", name: "Track" }],
  ["repeat", { kind: "named", name: "TrackList" }],
  ["tracks", { kind: "named", name: "TrackList" }],
  ["transition", { kind: "named", name: "Transition" }],
  ["spacing", { kind: "named", name: "Spacing" }],
  ["min", { kind: "named", name: "Length" }],
  ["max", { kind: "named", name: "Length" }],
  ["clamp", { kind: "named", name: "Length" }],
]);

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
    case "UnsafeCssImportDeclaration":
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
    const props = new Map(statement.parameters.map((parameter) => [parameter.name, context.resolve(parameter.type)]));
    if (!props.has("class")) props.set("class", { kind: "optional", inner: { kind: "string" } });
    if (!props.has("look")) props.set("look", { kind: "optional", inner: { kind: "named", name: "Look" } });
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
      if (["ms", "s"].includes(expression.unit)) return { kind: "named", name: "Duration" };
      if (["deg", "turn"].includes(expression.unit)) return { kind: "named", name: "Angle" };
      if (expression.unit === "%") return { kind: "named", name: "Percentage" };
      return { kind: "named", name: "Length" };
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression") {
      return publicBuilderTypes.get(expression.callee.name);
    }
    return undefined;
  },
});
