import assert from "node:assert/strict";
import test from "node:test";
import { compile, type ValueType } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";

/** Optional host fields remain writable unless their owner promises readonly. */
function callDiagnostics(body: string, readonly: boolean) {
  const options: ValueType = {
    kind: "object", fields: new Map([["title", { kind: "optional", inner: { kind: "string" } }]]),
    optionalFields: new Set(["title"]), ...(readonly ? { readonlyView: true } : {}),
  };
  const inspect: ValueType = { kind: "function", parameters: [options], parameterNames: ["options"], requiredParameters: 1, result: { kind: "null" } };
  return compile(`import {inspect} from "./host.vel"\n\n@main:\n    ${body}\n`, {
    analysis: { imports: new Map([["inspect", inspect]]) },
  }).diagnostics;
}

test("fresh records adopt optional writable fields while a shared narrower binding cannot", () => {
  assert.deepEqual(callDiagnostics('inspect({title: "safe"})', false), []);
  const reports = callDiagnostics('const value = {title: "safe"}\n    inspect(value)', false);
  assert.equal(reports.length, 1);
  assert.match(reports[0]!.message, /Cannot assign \{ title: string \} to \{ title\?: string\? \}/);
  assert.deepEqual(callDiagnostics('const value = {title: "safe"}\n    inspect(value)', true), []);
});

test("readonly optional receivers cannot mutate a required source field", () => {
  const source = `type Options:\n    title: string?\n\ndef erase(options: readonly Options):\n    options.title = null\n\n@main:\n    const source = {title: "safe"}\n    erase(source)\n`;
  const reports = compile(source).diagnostics;
  assert.equal(reports.length, 1, JSON.stringify(reports));
  assert.match(reports[0]!.message, /read-only/);
});

test("the mutable alias counterexample is refused and an explicit fresh value remains safe", () => {
  const prefix = `type Options:\n    title: string?\n\ndef erase(options: Options):\n    options.title = null\n\n@main:\n    const source = {title: "safe"}\n`;
  const unsafe = compile(prefix + '    erase(source)\n    print(source.title.size)\n');
  assert.equal(unsafe.diagnostics.length, 1, JSON.stringify(unsafe.diagnostics));
  assert.match(unsafe.diagnostics[0]!.message, /Cannot assign/);
  const safe = compile(prefix + '    erase({title: source.title})\n    print(source.title)\n');
  assert.deepEqual(safe.diagnostics, []);
  const executed = executeModule(safe.code!);
  assert.equal(executed.status, 0, String(executed.stderr));
  assert.equal(executed.stdout, "safe\n");
});
