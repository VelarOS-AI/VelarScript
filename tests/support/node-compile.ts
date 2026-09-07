import { compile as compileCore } from "@velarscript/compiler";
import { velarNodeCompilerExtension } from "@velarscript/node/compiler";

/**
 * D115 §一.6 — the one copy of "compile this source with the Node extension
 * loaded".
 *
 * It was a three-line declaration at the top of
 * `tests/node/node-server-framework.test.ts`; the six files that file became
 * all need it, so §一.6 puts the one copy here rather than in any of them.
 * `trimStart` drops the newline a `` ` `` literal opens with, and `app.vel` is
 * the path the diagnostics of every caller are written against.
 */
export function compileNode(source: string): ReturnType<typeof compileCore> {
  return compileCore(source.trimStart(), { path: "app.vel", extensions: [velarNodeCompilerExtension] });
}
