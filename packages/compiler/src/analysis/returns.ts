/**
 * The `return` statements one frame owns.
 *
 * D115 §一.1: this lives beside its one reader rather than in `ast.ts`, whose
 * recorded ceiling the file budget holds at what it measured.
 */
import { type CoreStatement, type ReturnStatement, type Statement } from "../ast.ts";

/**
 * The `return` statements one frame owns: every return the enclosing
 * declaration answers with, and none belonging to a nested declaration or test,
 * which have frames of their own. An extension statement's own blocks are left
 * to their owner, so this under-reports rather than claiming a return it cannot
 * place.
 *
 * AS-D1 reads it: an asynchronous `@iterate:` block spends `null` on
 * exhaustion, so *which* return produced the optionality is the whole question,
 * and the block's merged answer — `T?` either way — cannot say.
 */
export function blockReturnStatements(statements: readonly Statement[]): readonly ReturnStatement[] {
  const found: ReturnStatement[] = [];
  const walk = (values: readonly Statement[]): void => {
    for (const statement of values) {
      if (statement.kind.startsWith("ExtensionStatement:")) continue;
      const core = statement as CoreStatement;
      switch (core.kind) {
        case "ReturnStatement": found.push(core); break;
        case "MainBlock": walk(core.body); break;
        case "IfStatement": walk(core.thenBody); if (core.elseBody !== null) walk(core.elseBody); break;
        case "MatchStatement": for (const branch of core.cases) walk(branch.body); break;
        case "ForStatement": walk(core.body); break;
        case "WhileStatement": walk(core.body); break;
        case "TryStatement":
          walk(core.tryBody);
          if (core.catchBody !== null) walk(core.catchBody);
          if (core.finallyBody !== null) walk(core.finallyBody);
          break;
        default: break;
      }
    }
  };
  walk(statements);
  return found;
}

