import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { run } from "../../support/core-program.ts";

/**
 * D115 P5 — D44 rule 70, one subject of the file that was
 * `class-and-core-correctness.test.ts` before it reached 1,167 lines.
 *
 * Batch N-1 (audit fix wave, core correctness): the D44 ruling 70 (records
 * accept only plain data objects). What a record contract admits is the whole
 * subject: a class instance and an `Error` are refused wherever they appear,
 * and a plain object from another realm is not. The bodies below are the
 * bodies that file had.
 */

/** Compiles cleanly but fails at runtime; returns stdout and stderr. */
function runFailing(source: string): { readonly stdout: string; readonly stderr: string } {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => item.message), [], source);
  assert.ok(result.code, source);
  const execution = executeModule(result.code);
  assert.notEqual(execution.status, 0, `expected a runtime failure\n${String(execution.stdout)}`);
  return { stdout: String(execution.stdout), stderr: String(execution.stderr) };
}

// ---------------------------------------------------------------------------
// D44 rule 70: record validation accepts only plain data objects.
// ---------------------------------------------------------------------------

test("[D44 70] a class instance no longer satisfies a record contract, so const fields cannot be written through", () => {
  // Before: Point.is(instance) was true, Point.parse returned a record view
  // aliasing the live instance, and `point.x = 99` wrote through the class's
  // const field. Now `is` answers false and `parse` throws with the
  // projection teaching.
  const failing = runFailing(`
type Point:
    x: number

class P:
    const x: number = 1

    def read() -> number:
        return self.x

const instance = P()
const raw: unknown = instance
print(str(Point.is(raw)))
const point = Point.parse(raw)
point.x = 99
print(str(instance.read()))
`);
  assert.equal(failing.stdout, "false\n");
  assert.match(failing.stderr, /Value does not match Point — the value is not a record; a record accepts only plain data objects — project the fields into a record first, for example \{x: instance\.x\}/u);
  assert.doesNotMatch(failing.stdout, /99/u);
});

test("[D44 70] Error instances and nested field positions are rejected; parsed JSON passes", () => {
  const fromJsonSource = Buffer.from("export const fromJson = JSON.parse('{\"x\": 3}');", "utf8").toString("base64");
  const output = run(`
import js unsafe {fromJson} from "data:text/javascript;base64,${fromJsonSource}"

type Point:
    x: number

type Wrap:
    inner: Point

class P:
    const x: number = 1

print(str(Point.is(fromJson)))
const errorValue: unknown = Error("boom")
print(str(Point.is(errorValue)))
const nested: unknown = {inner: errorValue}
print(str(Wrap.is(nested)))
const nestedInstance: unknown = {inner: P()}
print(str(Wrap.is(nestedInstance)))
`);
  assert.equal(output, "true\nfalse\nfalse\nfalse\n");
});

test("[D44 70] a plain object from another realm still validates", () => {
  // The check is structural (prototype null, or prototype whose own
  // prototype is null), never an identity comparison against this realm's
  // Object.prototype.
  const foreignSource = Buffer.from("import vm from 'node:vm'; export const foreign = vm.runInNewContext('({x: 3})');", "utf8").toString("base64");
  const output = run(`
import js unsafe {foreign} from "data:text/javascript;base64,${foreignSource}"

type Point:
    x: number

print(str(Point.is(foreign)))
const parsed = Point.parse(foreign)
print(str(parsed.x))
`);
  assert.equal(output, "true\n3\n");
});
