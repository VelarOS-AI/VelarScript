import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

test("#1 loop back edges invalidate optional facts before the next condition or body", () => {
  const forLoop = compile(`
let value: string? = "first"
if value != null:
    for index in [1, 2]:
        print(value + "!")
        value = null
`.trimStart());
  assert.ok(forLoop.diagnostics.some((item) =>
    item.code === "VEL4001" && /received string\? and string/u.test(item.message)));
  assert.equal(forLoop.code, null);

  const whileCondition = compile(`
let value: string? = "first"
if value != null:
    while value.size > 0:
        value = null
`.trimStart());
  assert.ok(whileCondition.diagnostics.some((item) =>
    item.code === "VEL4001" && /optional access/u.test(item.message)));
  assert.equal(whileCondition.code, null);

  const nestedLoop = compile(`
let value: string? = "first"
if value != null:
    for outer in [1, 2]:
        print(value.upper())
        for inner in [1]:
            value = null
`.trimStart());
  assert.ok(nestedLoop.diagnostics.some((item) =>
    item.code === "VEL4001" && /optional access/u.test(item.message)));
  assert.equal(nestedLoop.code, null);

  const reestablishedAtHead = compile(`
let value: string? = "first"
while value != null:
    print(value.upper())
    value = null
`.trimStart());
  assert.deepEqual(reestablishedAtHead.diagnostics, []);
});

test("#5 a loop back edge cannot leak null through a non-null function result", () => {
  const result = compile(`
def pick(initial: string?) -> string:
    let value = initial
    if value == null:
        return "fallback"
    for index in [1, 2]:
        if index == 2:
            return value
        value = null
    return "fallback"
`.trimStart());

  assert.ok(result.diagnostics.some((item) =>
    item.code === "VEL4001" && item.message === "Cannot assign string? to string"));
  assert.equal(result.code, null);
});

test("#6 a loop back edge cannot retain a record fact after unknown is reassigned", () => {
  const result = compile(`
type User:
    name: string

let raw: unknown = {name: "Ada"}
if raw is User:
    for index in [1, 2]:
        print(f"name={raw.name}")
        raw = 5
`.trimStart());

  assert.ok(result.diagnostics.some((item) =>
    item.code === "VEL4001" && /has no member 'name'|without validation/u.test(item.message)));
  assert.equal(result.code, null);
});

test("#23 try return with a non-exiting finally satisfies the function result contract", () => {
  const result = compile(`
def value() -> string:
    try:
        return "a"
    finally:
        print("cleanup")

print(value())
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "cleanup\na\n");
});

test("#24 keyword-named record keys work in binding, for, and match object patterns", () => {
  const result = compile(`
type Row:
    class: string
    id: number

const rows: List<Row> = [{class: "alpha", id: 1}, {class: "beta", id: 2}]
const {class: direct, id} = rows[0]
let joined = ""
for {class: label} in rows:
    joined += label
let matched = ""
match rows[0]:
    case {class: label}:
        matched = label

print(f"{direct}:{id}")
print(joined)
print(matched)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "alpha:1\nalphabeta\nalpha\n");

  const shorthand = compile("const {class} = {class: 1}\n");
  assert.ok(shorthand.diagnostics.some((item) =>
    item.code === "VEL2011" && /requires ': name'/u.test(item.message)));
});
