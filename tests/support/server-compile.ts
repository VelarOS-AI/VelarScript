import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileProject } from "../../packages/cli/src/project.ts";
import { velarCompilerExtension as velarServerCompilerExtension } from "@velarscript/server/compiler";

/**
 * D115 §一.6 — the one copy of "compile this source as a one-module project
 * with the Server extension loaded".
 *
 * `velar/server` is a project-level extension rather than a bare compiler one,
 * so its tests compile a project rather than a source; this is the five-line
 * declaration `tests/node/node-server-framework.test.ts` carried, shared by the
 * two `tests/server/` files that inherited its Server-owned subjects.
 */
export async function compileServer(source: string) {
  const path = join(tmpdir(), "velar-server-compile.vel");
  const project = await compileProject(path, new Map([[path, source.trimStart()]]), {extensions: [velarServerCompilerExtension]});
  return project.modules[0]!.result;
}
