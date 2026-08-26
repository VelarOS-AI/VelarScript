import type {
  CompilerInspectionExtension,
  CompilerInterfaceContext,
  Expression,
  Statement,
} from "@velarscript/compiler/extension";
import { isNodeServerStatement } from "./server-ast.ts";
import { exportedRoutePatternValues, routePatternStaticIdentity } from "./route-pattern.ts";
import { routePatternType, serveAppType } from "./server-types.ts";

export const velarNodeInspectionExtension: CompilerInspectionExtension = Object.freeze({
  contributeInterface(statement: Statement, context: CompilerInterfaceContext): boolean {
    if (!isNodeServerStatement(statement)) return false;
    if (statement.exported) context.exports.set(statement.name, serveAppType);
    return true;
  },
  exportAnnotations: exportedRoutePatternValues,
  interfaceExportIdentity: (_name: string, value: unknown) => routePatternStaticIdentity(value),
  inferPublicExpression(expression: Expression) {
    return expression.kind === "ExtensionExpression:node:path-pattern" ? routePatternType : undefined;
  },
});
