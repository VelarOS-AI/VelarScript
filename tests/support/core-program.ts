import assert from "node:assert/strict";
import { compile } from "@velarscript/compiler";
import { executeModule } from "./execute-module.ts";

/**
 * D115 P5 — "compile it with Core alone, then run it or read the refusal".
 *
 * `tests/compiler/analysis/class-and-core-correctness.test.ts` split into five
 * subject files, and these two are what four of them share. The audit
 * regressions state their case as a whole program, so what they need is the
 * pair: *this compiles and prints that*, and *this is refused with that code*.
 * Both compile through `@velarscript/compiler` with no extension loaded, which
 * is the point — the rulings they pin are Core's, not a target's. The bodies
 * are the bodies that file had.
 */

/** Compiles cleanly and runs to completion; returns stdout. */
export function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => item.message), [], source);
  assert.ok(result.code, source);
  const execution = executeModule(result.code);
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

export function rejects(source: string, code: string, pattern: RegExp): void {
  const result = compile(source.trimStart());
  assert.equal(result.code, null, source);
  const matched = result.diagnostics.find((item) => item.code === code && pattern.test(item.message));
  assert.ok(
    matched,
    `${source}\nexpected ${code} ${String(pattern)}, received ${JSON.stringify(result.diagnostics.map((item) => `${item.code}: ${item.message}`))}`,
  );
}
