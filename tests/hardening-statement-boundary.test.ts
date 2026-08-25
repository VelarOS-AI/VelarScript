import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

function compileWeb(source: string) {
  return compile(source, { extensions: [velarCompilerExtension] });
}

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

function runClean(source: string): ReturnType<typeof spawnSync> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution;
}

const BOUNDARY = "VEL2032";

test("a leftover token after a complete statement is one diagnostic and the next line still parses", () => {
  const result = compile(`
const price = 4
const quantity = 5
const total = price quantity
print(total)
`.trimStart());

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.code, BOUNDARY);
  assert.match(result.diagnostics[0]?.message ?? "", /A statement ends at its newline; move 'quantity' to its own line/u);
  // The broken line does not cascade: 'total' is still declared, so 'print(total)'
  // resolves instead of adding an unknown-name error.
  assert.ok(result.semanticIndex.symbols.some((item) => item.name === "total"));
});

test("a second literal on a declaration line is diagnosed", () => {
  const result = compile("const a = 5 7\nprint(a)\n");

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.code, BOUNDARY);
});

test("the statement boundary is enforced inside indented bodies", () => {
  const result = compile(`
def total(price: number, quantity: number) -> number:
    const value = price quantity
    return value
`.trimStart());

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.code, BOUNDARY);
});

test("a percentage literal abutting a second number teaches the spaced remainder spelling", () => {
  const result = compileWeb("const packedModulo = 10%3\n");

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.code, BOUNDARY);
  assert.equal(
    result.diagnostics[0]?.message,
    "'10%' is a percentage literal, so '3' starts a second statement; write '10 % 3' with spaces for the remainder operator",
  );
});

test("web percentage literals and the spaced remainder operator both stay valid", () => {
  assert.deepEqual(compileWeb("const p: Percentage = 100%\n").diagnostics, []);
  assert.deepEqual(compileWeb("const m = 10 % 3\n").diagnostics, []);
});

test("Core has no percent suffix, so both remainder spellings evaluate to 1", () => {
  const execution = runClean("const packed = 10%3\nconst spaced = 10 % 3\nprint(packed)\nprint(spaced)\n");
  assert.equal(execution.stdout, "1\n1\n");
});

test("leading-dot continuations, multi-line brackets, and headers keep spanning physical lines", () => {
  const chain = compile(`
const names = ["b", "a"]
const sorted = names
    .sorted((left, right) => left < right ? -1 : 1)
    .map((value) => value.upper())
print(sorted.size)
`.trimStart());
  assert.deepEqual(chain.diagnostics, []);

  const brackets = compile(`
def add(first: number, second: number) -> number:
    return first + second

const total = add(
    1,
    2,
)
const grouped = (
    1
    + 2
)
const rows = [
    total,
    grouped,
]
const shape = {
    name: "a",
    size: rows.size,
}
print(shape.name)
`.trimStart());
  assert.deepEqual(brackets.diagnostics, []);

  const headers = compile(`
enum Status:
    pending
    active
    done

def describe(status: Status, amount: number) -> string:
    match status:
        case Status.pending, Status.active:
            return "open"
        case _:
            return 0 < amount <= 100 ? "closed" : "archived"

def label(value: string, prefix: string = "-") -> string:
    return prefix + value

def check(ready: bool) -> number:
    assert ready else "not ready"
    return 1

print(describe(Status.active, 4))
print(label("a", prefix="#"))
print(check(true))
`.trimStart());
  assert.deepEqual(headers.diagnostics, []);
});

test("an indented leading binary operator continues the expression above it", () => {
  const execution = runClean(`
def samePosition(
    chunkX: number,
    localX: number,
    chunkY: number,
    localY: number,
    chunkZ: number,
    localZ: number,
    edge: number,
    positionX: number,
    positionY: number,
    positionZ: number,
) -> bool:
    return chunkX * edge + localX == positionX
        and chunkY * edge + localY == positionY
        and chunkZ * edge + localZ == positionZ

const arithmetic = 1
    + 2
    * 3
const absent = 4
    not in [1, 2, 3]
print(samePosition(2, 3, 4, 5, 6, 7, 16, 35, 69, 103))
print(arithmetic)
print(absent)
`.trimStart());

  assert.equal(execution.stdout, "true\n7\ntrue\n");
});

test("a leading operator does not cross a blank line or continue without deeper indentation", () => {
  const blank = compile("const ready = true\n\n    and false\n");
  assert.notDeepEqual(blank.diagnostics, []);

  const aligned = compile("const ready = true\nand false\n");
  assert.notDeepEqual(aligned.diagnostics, []);
});

test("the newly landed negative operators are not read as leftover tokens", () => {
  const result = compile(`
const list = [1, 2]

def probe(value: string | number) -> bool:
    return value is not string

print(3 not in list)
print(probe(1))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
});

test("the removed 'is not null' spelling recovers as one equality test, not a leftover token", () => {
  const result = compile(`
def check(value: string?) -> bool:
    return value is not null

const after = 1
print(after)
`.trimStart());

  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2033"]);
  assert.match(result.diagnostics[0]?.message ?? "", /Use '!= null' to test for a value/u);
  assert.ok(result.semanticIndex.symbols.some((item) => item.name === "after"));
});

test("look blocks and multi-line JSX with interpolation stay one logical line each", () => {
  const result = compileWeb(`
const cardLook = look:
    color = "#3478f6"
    padding = 8px
    if viewport.width <= 720px:
        padding = 4px
    if @hover:
        padding = 12px

component Probe(name: string):
    return <section look={cardLook}>
        <h1>{name.upper()}</h1>
        <p>
            {name}
        </p>
    </section>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
});

test("two broken lines report exactly twice and later declarations still resolve", () => {
  const result = compile(`
const a = 1 2
const b = 3 4
const good = 5
print(good)
`.trimStart());

  assert.equal(result.diagnostics.length, 2);
  assert.deepEqual(result.diagnostics.map((item) => item.code), [BOUNDARY, BOUNDARY]);
  assert.ok(result.semanticIndex.symbols.some((item) => item.name === "good"));
  assert.ok(result.semanticIndex.symbols.some((item) => item.name === "a"));
  assert.ok(result.semanticIndex.symbols.some((item) => item.name === "b"));
});
