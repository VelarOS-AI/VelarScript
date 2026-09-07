import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { compileWeb as compile } from "./compile.ts";

/**
 * D115 P5 — the one copy of "emit this Web source and run the emitted module
 * under Node", from `tests/web/reactive-graph-and-runtime-abi.slow.test.ts`
 * before it was split at 881 lines.
 *
 * The reactive graph is a runtime data structure, so the probes that measure it
 * read it where it lives: the emitted module is fed to `node` on stdin with a
 * JavaScript probe appended, and the probe prints one JSON line the caller
 * parses. `mountInChromium` is the same idea one level up, for the paths whose
 * evidence is a document rather than a graph.
 */
export function compiled(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.code);
  return result.code;
}

/** Runs an emitted Web module under Node with a JavaScript probe appended to it. */
export function probeModule(source: string, probe: string, flags: readonly string[] = [], environment: Record<string, string> = {}) {
  const execution = spawnSync(process.execPath, [...flags, "--input-type=module"], {
    encoding: "utf8",
    input: `${compiled(source)}\n${probe}`,
    env: { ...process.env, ...environment },
  });
  assert.equal(execution.status, 0, String(execution.stderr || execution.error));
  return execution;
}

/** The last line the probe printed, parsed as the measurement it is. */
export function measurement<T>(execution: { stdout: string }): T {
  const line = execution.stdout.trim().split("\n").at(-1) ?? "";
  return JSON.parse(line) as T;
}
