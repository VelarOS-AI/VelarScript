import type {
  CompilerInspectionExtension,
  CompilerInterfaceContext,
  Statement,
} from "@velarscript/compiler/extension";
import { isNodeServerStatement } from "./server-ast.ts";
import { serveAppType } from "./server-types.ts";

export const velarNodeInspectionExtension: CompilerInspectionExtension = Object.freeze({
  contributeInterface(statement: Statement, context: CompilerInterfaceContext): boolean {
    if (!isNodeServerStatement(statement)) return false;
    if (statement.exported) context.exports.set(statement.name, serveAppType);
    return true;
  },
});
