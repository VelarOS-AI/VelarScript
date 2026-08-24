import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile, formatSource } from "@velarscript/compiler";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";

function run(source: string): ReturnType<typeof spawnSync> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.code);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: result.code,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution;
}

test("an if branch accepts one non-block statement after its colon", () => {
  const source = [
    "type Render:",
    "    animation: string?",
    "",
    "const render: Render = {animation: \"idle\"}",
    "const animations: Set<string> = Set()",
    "if render.animation != null: animations.add(render.animation)",
    "print(animations.has(\"idle\"))",
    "",
  ].join("\n");

  const execution = run(source);
  assert.equal(execution.stdout, "true\n");
});

test("inline if, else if, and else branches retain return analysis and execution order", () => {
  const source = [
    "def grade(score: number) -> string:",
    "    if score >= 90: return \"A\"",
    "    else if score >= 80: return \"B\"",
    "    else: return \"C\"",
    "",
    "print(grade(95) + grade(85) + grade(75))",
    "",
  ].join("\n");

  assert.equal(formatSource(source), source);
  const execution = run(source);
  assert.equal(execution.stdout, "ABC\n");
});

test("a comment after the colon keeps the ordinary indented if body", () => {
  const source = [
    "if true: // the body remains below",
    "    print(\"yes\")",
    "",
  ].join("\n");

  const execution = run(source);
  assert.equal(execution.stdout, "yes\n");
});

test("the formatter settles and round-trips the inline if spelling", () => {
  const compact = "if render.animation!=null:animations.add(render.animation)\n";
  const canonical = "if render.animation != null: animations.add(render.animation)\n";
  const formatted = formatSource(compact);

  assert.equal(formatted, canonical);
  assert.equal(formatSource(formatted), canonical);
});

test("the formatter settles and round-trips inline match cases", () => {
  const compact = [
    "enum Status:",
    " pending",
    " done",
    "const status=Status.parse(\"done\")",
    "match status:",
    " case Status.pending:print(\"pending\")",
    " case _:print(\"done\")",
    "",
  ].join("\n");
  const canonical = [
    "enum Status:",
    "    pending",
    "    done",
    "const status = Status.parse(\"done\")",
    "match status:",
    "    case Status.pending: print(\"pending\")",
    "    case _: print(\"done\")",
    "",
  ].join("\n");
  const formatted = formatSource(compact);

  assert.equal(formatted, canonical);
  assert.equal(formatSource(formatted), canonical);
  assert.deepEqual(compile(formatted).diagnostics, []);
});

test("an inline branch still owns exactly one statement", () => {
  const result = compile("if true: print(1) print(2)\nprint(3)\n");

  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2032"]);
  assert.match(result.diagnostics[0]?.message ?? "", /A statement ends at its newline; move 'print' to its own line/u);
});

test("ordinary executable suites align on the same single-statement rule", () => {
  const source = [
    "def doubled(value: number) -> number: return value * 2",
    "let total = 0",
    "for value in [1, 2, 3]: total += value",
    "let spins = 0",
    "while spins < 2: spins += 1",
    "let caught = \"\"",
    "try: throw Error(\"boom\")",
    "catch error: caught = error.code",
    "finally: total += 1",
    "print(f\"{doubled(total + spins)} {caught}\")",
    "",
  ].join("\n");

  assert.equal(formatSource(source), source);
  const execution = run(source);
  assert.equal(execution.stdout, "18 Error\n");
});

test("declaration and class-member executable suites share the rule", () => {
  const source = [
    "test \"one line\": pass",
    "class Box:",
    "    def value() -> number: return 1",
    "    constructor(): pass",
    "    @dispose: pass",
    "",
  ].join("\n");

  assert.equal(formatSource(source), source);
  assert.deepEqual(compile(source, { path: "inline-suite.test.vel" }).diagnostics, []);
});

test("extension-owned executable suites share the rule", () => {
  const source = [
    "component App():",
    "    action save(): return",
    "    @mounted: pass",
    "    return <button on:click={save}>Save</button>",
    "",
  ].join("\n");
  const options = { extensions: [webCompilerExtension] } as const;

  assert.equal(formatSource(source, options), source);
  assert.deepEqual(compile(source, options).diagnostics, []);
});

test("an inline suite refuses a nested block header", () => {
  const nested = compile("if true: while false:\n    print(1)\n");
  assert.deepEqual(nested.diagnostics.map((item) => item.code), ["VEL2001"]);
  assert.match(nested.diagnostics[0]?.message ?? "", /inline suite accepts one non-block statement/u);
});

test("formatting compacts simple one-statement suites", () => {
  const source = [
    "def inline(): return",
    "def indented():",
    "    return",
    "if true: print(\"inline\")",
    "if true:",
    "    print(\"indented\")",
    "",
  ].join("\n");
  const canonical = [
    "def inline(): return",
    "def indented(): return",
    "if true: print(\"inline\")",
    "if true: print(\"indented\")",
    "",
  ].join("\n");

  assert.equal(formatSource(source), canonical);
  assert.equal(formatSource(canonical), canonical);
});

test("formatting expands an inline suite when the complete line exceeds 120 columns", () => {
  const condition = Array.from({ length: 13 }, () => "true").join(" and ");
  const inline = `if ${condition}: print(\"ready\")\n`;
  const canonical = `if ${condition}:\n    print(\"ready\")\n`;

  assert.ok(inline.trimEnd().length > 120);
  assert.ok(`if ${condition}:`.length <= 120);
  assert.equal(formatSource(inline), canonical);
  assert.equal(formatSource(canonical), canonical);
});

test("a match case accepts one non-block statement after its colon", () => {
  const source = [
    "enum Status:",
    "    pending",
    "    active",
    "    done",
    "",
    "def label(status: Status) -> string:",
    "    match status:",
    "        case Status.pending: return \"pending\"",
    "        case Status.active if true: return \"active\"",
    "        case _: return \"done\"",
    "",
    "print(label(Status.pending) + \" \" + label(Status.active) + \" \" + label(Status.done))",
    "",
  ].join("\n");

  const execution = run(source);
  assert.equal(execution.stdout, "pending active done\n");
});

test("an inline match case still owns exactly one statement and no nested block", () => {
  const extra = compile([
    "match true:",
    "    case true: print(1) print(2)",
    "    case _: print(3)",
    "",
  ].join("\n"));
  assert.deepEqual(extra.diagnostics.map((item) => item.code), ["VEL2032"]);

  const nested = compile([
    "match true:",
    "    case true: if true:",
    "        print(1)",
    "    case _: print(2)",
    "",
  ].join("\n"));
  assert.deepEqual(nested.diagnostics.map((item) => item.code), ["VEL2001"]);
  assert.match(nested.diagnostics[0]?.message ?? "", /inline suite accepts one non-block statement/u);
});
