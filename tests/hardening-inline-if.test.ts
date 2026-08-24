import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile, formatSource } from "@velarscript/compiler";

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

test("the shorthand stays on if and refuses a nested block header", () => {
  const loop = compile("while false: print(1)\n");
  assert.ok(loop.diagnostics.some((item) => /Expected a newline before an indented block/u.test(item.message)));

  const nested = compile("if true: while false:\n    print(1)\n");
  assert.deepEqual(nested.diagnostics.map((item) => item.code), ["VEL2001"]);
  assert.match(nested.diagnostics[0]?.message ?? "", /inline 'if' branch accepts one non-block statement/u);
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
  assert.match(nested.diagnostics[0]?.message ?? "", /inline 'match' case accepts one non-block statement/u);
});
