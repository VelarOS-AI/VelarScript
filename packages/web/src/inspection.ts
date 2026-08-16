import {
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
import { isWebJsx, isWebKeyframes, isWebLook, isWebStatement, isWebUnit } from "./ast.ts";
import { isWebComponentConstructor, isWebComputedExport, WEB_COMPUTED_EXPORT, webComponentConstructor, webNodeType } from "./types.ts";

function contributeInterface(statement: Statement, context: CompilerInterfaceContext): boolean {
  if (!isWebStatement(statement)) return false;
  if (statement.kind === "ExtensionStatement:web:action") {
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
  if (statement.kind === "ExtensionStatement:web:state" || statement.kind === "ExtensionStatement:web:computed") {
    context.exports.set(
      statement.name,
      context.bindingType(statement.name, statement.span.start)
        ?? (statement.type ? context.resolve(statement.type) : context.inferPublicExpression(statement.initializer)),
    );
    // D71 rule 184: both halves of the reactive row cross the module boundary
    // as live values, so both lower an imported bare read through .get(). The
    // annotation below is what keeps the derived one read-only there.
    context.reactiveExports.set(statement.name, "state");
    if (statement.kind === "ExtensionStatement:web:computed") context.extensionExports.set(statement.name, WEB_COMPUTED_EXPORT);
    return true;
  }
  if (statement.kind === "ExtensionStatement:web:component") {
    const analyzed = context.bindingType(statement.name, statement.span.start);
    if (analyzed && isWebComponentConstructor(analyzed)) {
      context.exports.set(statement.name, analyzed);
      return true;
    }
    const props = new Map(statement.parameters.map((parameter) => [parameter.name, context.resolve(parameter.type)]));
    if (!props.has("class")) props.set("class", optionalOf({ kind: "string" }));
    if (!props.has("look")) props.set("look", optionalOf({ kind: "named", name: "Look" }));
    context.exports.set(statement.name, webComponentConstructor(
      statement.name,
      props,
      new Set(statement.parameters.filter((parameter) => !parameter.defaultValue).map((parameter) => parameter.name)),
      statement.handleType ? context.resolve(statement.handleType) : null,
    ));
    return true;
  }
  return false;
}

export const velarWebInspectionExtension: CompilerInspectionExtension = Object.freeze({
  contributeInterface,
  exportAnnotations: exportedLookStaticValues,
  interfaceExportIdentity: (_name: string, value: unknown) => isWebComputedExport(value) ? "web:computed" : lookStaticIdentity(value),
  resources(program: Program) {
    const resources: { source: string; kind: string }[] = [];
    for (const statement of program.body) {
      if (isWebStatement(statement) && statement.kind === "ExtensionStatement:web:unsafe-css") {
        if (statement.source.kind === "external") resources.push({ source: statement.source.path, kind: "unsafe CSS" });
      }
    }
    return resources;
  },
  inferPublicExpression(expression: Expression): ValueType | undefined {
    if (isWebJsx(expression)) return webNodeType;
    if (isWebLook(expression)) return { kind: "named", name: "Look" };
    if (isWebKeyframes(expression)) return { kind: "named", name: "Keyframes" };
    if (isWebUnit(expression)) {
      const name = LOOK_UNIT_TYPES.get(expression.unit);
      return name ? { kind: "named", name } : undefined;
    }
    return undefined;
  },
});
