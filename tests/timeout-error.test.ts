import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { runVelarProject } from "./velar-project-harness.ts";

/**
 * D114 item 8 / AS-I2: one concept, one identity. `Promise.timeout` rejected
 * with a bare `Error` and `velar/task`'s `withTimeout` with its own
 * `TaskTimeoutError`, so charter §11's rule — "an error has exactly one
 * classification: its class" — was false of the one capability failure that
 * has a recovery of its own. Both raise the Core built-in `TimeoutError` now,
 * and the old spelling retires with the rewrite that carries a module across.
 */

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

/** The `code: message` line of every diagnostic a project check reports. */
async function projectDiagnostics(source: string): Promise<readonly string[]> {
  const result = await runVelarProject({ "src/main.vel": source.trimStart() }, { command: "check", prefix: "velar-timeout-" });
  return `${result.stdout}${result.stderr}`.split("\n")
    .flatMap((line) => /\berror (VEL\d+): (.*)$/u.exec(line) ? [/\berror (VEL\d+): (.*)$/u.exec(line)!.slice(1, 3).join(" ")] : []);
}

async function run(source: string): Promise<string> {
  const result = await runVelarProject({ "src/main.vel": source.trimStart() }, { prefix: "velar-timeout-" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result.stdout;
}

test("[AS-I2] Promise.timeout rejects with TimeoutError, carrying the message it was given", async () => {
  assert.equal(await run(`
async def slow() -> string:
    await Promise.sleep(80ms)
    return "done"

@main:
    try:
        const value = await Promise.timeout(slow(), 5ms, "load took too long")
        print(value)
    catch error:
        print(f"code={error.code} is={error is TimeoutError} msg={error.message}")
`), "code=TimeoutError is=true msg=load took too long\n");
});

test("[AS-I2] velar/task's withTimeout raises the same class", async () => {
  assert.equal(await run(`
import {task, withTimeout} from "velar/task"

async def slow() -> string:
    await Promise.sleep(80ms)
    return "done"

@main:
    const work = task(cancellation => slow())
    try:
        const value = await withTimeout(work, 5ms)
        print(value)
    catch error:
        print(f"code={error.code} is={error is TimeoutError}")
`), "code=TimeoutError is=true\n");
});

test("[AS-I2] a timeout is told apart from the task's own failure", async () => {
  assert.equal(await run(`
async def broken() -> string:
    throw Error("the task itself failed")

@main:
    try:
        const value = await Promise.timeout(broken(), 1s)
        print(value)
    catch error:
        print(f"timeout={error is TimeoutError} msg={error.message}")
`), "timeout=false msg=the task itself failed\n");
});

test("[AS-I2] TimeoutError needs no import and cannot be extended", () => {
  assert.deepEqual(messages(`
class SlowError extends TimeoutError:
    constructor(message: string):
        super(message)

@main:
    print("x")
`), ["VEL4001 The builtin error type 'TimeoutError' cannot be extended; extend Error and declare your own fields"]);
});

test("[AS-I2] importing the retired TaskTimeoutError spelling reports once and names TimeoutError", async () => {
  assert.deepEqual(await projectDiagnostics(`
import {task, withTimeout, TaskTimeoutError} from "velar/task"

@main:
    const work = task(cancellation => Promise.sleep(1ms))
    try:
        await withTimeout(work, 5ms)
    catch error:
        if error is TaskTimeoutError:
            print("slow")
`), ["VEL3008 Use TimeoutError directly; a timeout raises the Core error class, which needs no import"]);
});

test("[AS-I2] the retirement's fix rewrites the import and every use, and the result compiles", async () => {
  const source = `import {task, withTimeout, TaskTimeoutError} from "velar/task"

def describe(failure: TaskTimeoutError) -> string:
    return failure.message

@main:
    const work = task(cancellation => Promise.sleep(1ms))
    try:
        await withTimeout(work, 5ms)
    catch error:
        if error is TaskTimeoutError:
            print(describe(error))
`;
  const result = compile(source);
  const fix = result.diagnostics.find((item) => item.code === "VEL3008")?.fix;
  assert.ok(fix, "the retirement carries a mechanical rewrite");
  let rewritten = source;
  for (const edit of [...fix.edits].sort((left, right) => right.span.start - left.span.start)) {
    rewritten = rewritten.slice(0, edit.span.start) + edit.text + rewritten.slice(edit.span.end);
  }
  assert.ok(!rewritten.includes("TaskTimeoutError"), rewritten);
  // Checked as a project, because the rewritten module imports `velar/task`
  // and only a project resolves a standard module's interface.
  const checked = await runVelarProject({ "src/main.vel": rewritten }, { command: "check", prefix: "velar-timeout-fix-" });
  assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
});
