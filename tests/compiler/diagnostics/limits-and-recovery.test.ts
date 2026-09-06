import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compile as compileCore, formatDiagnostic, formatSource, MAX_VELAR_SOURCE_CODE_UNITS, SourceText } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { compile, inspectModule } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("rejects untyped browser globals with official module guidance", () => {
  const cases = new Map([
    ["fetch(\"/api\")\n", /velar\/http.*raw fetch/],
    ["const body = document.body\n", /JSX.*refs.*velar\/browser/],
    ["const value = JSON.parse(\"{}\")\n", /Json\.parse/],
    ["const value = Date.now()\n", /velar\/time/],
  ]);
  for (const [source, message] of cases) {
    const result = compile(source);
    assert.equal(result.code, null, source);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3008" && message.test(item.message)));
  }
});

test("rejects reassignment of const bindings", () => {
  const result = compile(`
const name = "Velar"
name = "Other"
`.trimStart());

  assert.equal(result.code, null);
  assert.equal(result.diagnostics[0]?.code, "VEL3002");
  assert.match(result.diagnostics[0]?.message ?? "", /Cannot assign to const/);
});

test("enforces parameter, condition, coercion, and object-shape contracts", () => {
  const parameter = compile("def change(value: number):\n    value = 2\n");
  assert.ok(parameter.diagnostics.some((item) => item.code === "VEL3002"));

  const truthiness = compile("if 1:\n    print(1)\n");
  assert.ok(truthiness.diagnostics.some((item) => /Condition must be bool, received number/.test(item.message)));

  const logical = compile("const visible = 1 and true\n");
  assert.ok(logical.diagnostics.some((item) => /Condition must be bool, received number/.test(item.message)));

  const coercion = compile("const label = \"Score: \" + 10\n");
  assert.ok(coercion.diagnostics.some((item) => /f-string or str\(value\)/.test(item.message)));

  const shape = compile("const user = {name: \"Ada\"}\nuser.age = 24\n");
  assert.ok(shape.diagnostics.some((item) => /Object has no field 'age'/.test(item.message)));
});

test("reports unknown names", () => {
  const result = compile("const answer = missing\n");

  assert.equal(result.code, null);
  assert.equal(result.diagnostics[0]?.code, "VEL3001");
});

test("reports indentation that does not match an outer block", () => {
  const result = compile(`
def value():
    const first = 1
  return first
`.trimStart());

  assert.equal(result.code, null);
  assert.ok(result.diagnostics.some((item) => item.code === "VEL1004"));
});

test("source locations treat LF, CRLF, and standalone CR as line boundaries", () => {
  const source = new SourceText("newlines.vel", "first\rsecond\r\nthird\nfourth");
  assert.deepEqual(source.location(source.text.indexOf("second")), { line: 2, column: 1 });
  assert.deepEqual(source.location(source.text.indexOf("third")), { line: 3, column: 1 });
  assert.deepEqual(source.location(source.text.indexOf("fourth")), { line: 4, column: 1 });
  assert.equal(source.lineText(1), "first");
  assert.equal(source.lineText(2), "second");
  assert.equal(source.lineText(3), "third");
  assert.equal(source.lineText(4), "fourth");
  const missingOffset = source.text.indexOf("second");
  const rendered = formatDiagnostic(source, { code: "VEL3001", message: "Unknown name", span: { start: missingOffset, end: missingOffset + 6 } });
  assert.match(rendered, /^newlines\.vel:2:1 error VEL3001: Unknown name\nsecond\n\^{6}$/u);

  const documented = compileCore("/// Standalone CR documentation\rconst value = 1\r", { path: "documented.vel" });
  assert.equal(documented.semanticIndex.symbols.find((item) => item.name === "value")?.documentation, "Standalone CR documentation");
});

test("compiler and CLI reject oversized source modules before parsing", async () => {
  const oversized = " ".repeat(MAX_VELAR_SOURCE_CODE_UNITS + 1);
  const result = compile(oversized, { path: "oversized.vel" });
  assert.equal(result.code, null);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.code, "VEL1003");
  assert.match(result.diagnostics[0]?.message ?? "", /cannot exceed 4 MiB/u);
  assert.throws(() => formatSource(oversized), /cannot exceed 4 MiB/u);

  const unaryNesting = compile(`${"not ".repeat(10000)}true\n`);
  assert.equal(unaryNesting.code, null);
  assert.ok(unaryNesting.diagnostics.some((item) => item.code === "VEL2008"));
  const powerNesting = compileCore(`${"1 ** ".repeat(1_000)}1\n`);
  assert.equal(powerNesting.code, null);
  assert.ok(powerNesting.diagnostics.some((item) => item.code === "VEL2008"));
  const typeNesting = compileCore(`type Deep = ${"List<".repeat(1_000)}number${">".repeat(1_000)}\n`);
  assert.equal(typeNesting.code, null);
  assert.ok(typeNesting.diagnostics.some((item) => item.code === "VEL2008"));
  const delimiterNesting = compile(`${"(".repeat(513)}1${")".repeat(513)}\n`);
  assert.equal(delimiterNesting.code, null);
  assert.ok(delimiterNesting.diagnostics.some((item) => item.code === "VEL1006"));
  let extensionParserCalled = false;
  const limitedBeforeExtension = compileCore(`${"(".repeat(513)}1${")".repeat(513)}\n`, {
    extensions: [{
      id: "fixture-terminal-lexer-limit",
      parser: { create() { extensionParserCalled = true; throw new Error("parser should not run"); } },
    }],
  });
  assert.ok(limitedBeforeExtension.diagnostics.some((item) => item.code === "VEL1006"));
  assert.equal(extensionParserCalled, false);

  const directory = await makeTemporaryDirectory("velar-source-limit-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, oversized, "utf8");
  const execution = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "check", entry], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /exceeds the 4 MiB VelarScript source-module limit/u);
});

test("compiler complexity diagnostics never hide extension RangeErrors", () => {
  const lexicalFailure = new RangeError("lexical extension failed");
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [{
      id: "fixture-lexical-range",
      lexical: { scan() { throw lexicalFailure; } },
    }],
  }), (error) => error === lexicalFailure);

  const parserFailure = new RangeError("parser extension failed");
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [{
      id: "fixture-parser-range",
      parser: { create() { throw parserFailure; } },
    }],
  }), (error) => error === parserFailure);
});

test("compiler APIs contain deterministic malformed input without escaping internal exceptions", () => {
  let state = 0x5eed1234;
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_ \t\n\r()[]{}<>:,.?+-*/%=!|\\\"'😀\0";
  for (let sample = 0; sample < 2_000; sample += 1) {
    let source = "";
    const length = next() % 500;
    for (let index = 0; index < length; index += 1) source += alphabet[next() % alphabet.length];
    const path = `malformed-${sample}.vel`;
    const compiled = compile(source, { path });
    const inspected = inspectModule(source, { path });
    assert.ok(Array.isArray(compiled.diagnostics));
    assert.ok(Array.isArray(inspected.diagnostics));
    for (const item of [...compiled.diagnostics, ...inspected.diagnostics]) {
      assert.ok(item.span.start >= 0 && item.span.start <= item.span.end && item.span.end <= source.length, `${path}: ${JSON.stringify(item)}`);
    }
    assert.equal(typeof formatSource(source), "string");
  }

  for (const source of ['const value = "unterminated\\', 'const value = f"unterminated\\']) {
    const result = compile(source);
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.every((item) => item.span.end <= source.length));
  }
});
