import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile, semanticTypeIdentity, type ValueType } from "@velarscript/compiler";

// The type-core half of the D90 audit wave: what a merge is allowed to do with
// a written `unknown`, what a call site solves a type parameter to when it
// reaches it through a readonly container, and the two identity/assignability
// costs that made ordinary source compile in tens of seconds.
//
// The two performance cases assert a wall-clock ceiling. The numbers in each
// comment are what this checkout measured before and after the fix, and the
// ceilings are set an order of magnitude above the fixed number so a loaded
// machine cannot redden them while still catching a return of the cliff.

function execute(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: code, timeout: 20_000 });
}

function diagnostics(source: string): string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("a written unknown survives every merge instead of being absorbed by the other branch", () => {
  const coalesce = diagnostics(`
type Config:
    host: string
    port: number

def loadConfig(raw: unknown) -> Config:
    return raw ?? { host: "localhost", port: 8080 }
`);
  assert.ok(
    coalesce.some((item) => item.startsWith("VEL4001") && /unknown \| \{ host: string, port: number \}/u.test(item)),
    coalesce.join("\n"),
  );

  const ternary = diagnostics(`
def pick(flag: bool, raw: unknown) -> string:
    return flag ? raw : "fallback"
`);
  assert.ok(ternary.some((item) => item.startsWith("VEL4001") && /unknown \| string/u.test(item)), ternary.join("\n"));

  const branches = diagnostics(`
def choose(flag: bool, raw: unknown) -> string:
    if flag:
        return raw
    return "fallback"
`);
  assert.ok(branches.some((item) => /Cannot assign unknown to string/u.test(item)), branches.join("\n"));

  // The element of a list literal is a merge too, so one unchecked entry can no
  // longer take the type of its neighbour.
  const listLiteral = diagnostics(`
def collect(raw: unknown) -> List<string>:
    return [raw, "text"]
`);
  assert.ok(
    listLiteral.some((item) => /Cannot assign List<unknown \| string> to List<string>/u.test(item)),
    listLiteral.join("\n"),
  );
});

test("the unknown fence is only about unchecked data: validation and inference are untouched", () => {
  // Narrowing is the way through, and it still works.
  assert.deepEqual(diagnostics(`
def label(raw: unknown) -> string:
    if raw is string:
        return raw
    return "fallback"
`), []);

  // `unknown` still accepts anything as a destination.
  assert.deepEqual(diagnostics(`
def keep(value: string) -> unknown:
    return value
`), []);

  // The inference seed is not boundary data: an empty collection beside a
  // populated one still merges to the populated element type.
  assert.deepEqual(diagnostics(`
def main():
    const rows: List<List<number>> = [[], [1]]
    print(rows.size)
`), []);

  assert.deepEqual(diagnostics(`
type User:
    id: string

def main():
    const user: User = { id: "u-1" }
    const users = [user]
    print(users.size)
`), []);
});

test("a type parameter solved through a readonly container keeps the readonly view", () => {
  const listView = diagnostics(`
type Check:
    id: string

def first<T>(items: readonly List<T>) -> T?:
    return items.get(0)

def push(row: List<Check>):
    row.append({ id: "leak" })

def inspect<T>(items: readonly List<T>, visit: (T) -> null):
    for item in items:
        visit(item)

def main():
    const rows: List<List<Check>> = [[]]
    const view: readonly List<List<Check>> = rows
    const head = first(view)
    if head != null:
        head.append({ id: "via first" })
    inspect(view, push)
    print(rows[0].size)
`);
  assert.ok(
    listView.some((item) => /Cannot call mutating method 'append' through readonly List<Check>/u.test(item)),
    listView.join("\n"),
  );
  assert.ok(
    listView.some((item) => /Cannot assign \(row: List<Check>\) -> null to \(readonly List<Check>\) -> null/u.test(item)),
    listView.join("\n"),
  );

  // A Map view solves both of its parameters the same way.
  const mapView = diagnostics(`
type Check:
    id: string

def valueAt<K, V>(entries: readonly Map<K, V>, key: K) -> V?:
    return entries.get(key)

def main():
    const rows: Map<string, List<Check>> = Map()
    rows.set("a", [])
    const view: readonly Map<string, List<Check>> = rows
    const found = valueAt(view, "a")
    if found != null:
        found.append({ id: "leak" })
`);
  assert.ok(
    mapView.some((item) => /Cannot call mutating method 'append' through readonly List<Check>/u.test(item)),
    mapView.join("\n"),
  );
});

test("the readonly signature stays legal and a mutable container still solves a mutable element", () => {
  // D44-AUDIT-RULINGS.md:142 — an opaque element offers no member to mutate, so
  // `readonly List<T>` is a legal signature. Only the call site changed.
  assert.deepEqual(diagnostics(`
def first<T>(items: readonly List<T>) -> T?:
    return items.get(0)

def inspect<T>(items: readonly List<T>, visit: (T) -> null):
    for item in items:
        visit(item)
`), []);

  const mutable = compile(`
type Check:
    id: string

def first<T>(items: List<T>) -> T?:
    return items.get(0)

def main():
    const rows: List<List<Check>> = [[]]
    const head = first(rows)
    if head != null:
        head.append({ id: "ok" })
    print(rows[0].size)

main()
`.trimStart());
  assert.deepEqual(mutable.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = execute(mutable.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(String(execution.stdout).trim(), "1");
});

test("structural assignability is memoized instead of exponential in record nesting", () => {
  const depth = 12;
  const lines = ["type A0:", "    v: string", "", "type B0:", "    v: string", ""];
  for (let index = 1; index <= depth; index += 1) {
    lines.push(`type A${index}:`, `    a: A${index - 1}`, `    b: A${index - 1}`, "");
    lines.push(`type B${index}:`, `    a: B${index - 1}`, `    b: B${index - 1}`, "");
  }
  lines.push(`def take(x: B${depth}):`, "    print(\"ok\")", "");
  lines.push(`def main(value: A${depth}):`, "    take(value)", "");
  const source = lines.join("\n");

  // 108 lines. Before the decision memo this took 37s on the audit checkout
  // (d=10 2.4s, d=14 did not finish); after it, 3ms.
  const started = Date.now();
  const result = compile(source);
  const elapsed = Date.now() - started;
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  assert.ok(elapsed < 5_000, `depth ${depth} took ${elapsed}ms`);

  // The memo must not turn the deep check into a rubber stamp: one mismatched
  // leaf at the bottom of the same tree is still refused.
  const mismatched = compile(source.replace("type B0:\n    v: string", "type B0:\n    v: number"));
  assert.ok(
    mismatched.diagnostics.some((item) => item.code === "VEL4001"),
    mismatched.diagnostics.map((item) => item.code).join(","),
  );
});

test("the memo leaves coinduction over recursive records exactly as it was", () => {
  // Two mutually recursive declarations agree only by assuming the pair they
  // are in the middle of deciding; the memo records decisions, never that
  // assumption, so both the accepting and the refusing answer stay correct.
  assert.deepEqual(diagnostics(`
type EvenA:
    tail: OddA?

type OddA:
    head: string
    tail: EvenA?

type EvenB:
    tail: OddB?

type OddB:
    head: string
    tail: EvenB?

def take(node: EvenB):
    print("ok")

def main(value: EvenA):
    take(value)
`), []);

  const mismatched = diagnostics(`
type EvenA:
    tail: OddA?

type OddA:
    head: string
    tail: EvenA?

type EvenB:
    tail: OddB?

type OddB:
    head: number
    tail: EvenB?

def take(node: EvenB):
    print("ok")

def main(value: EvenA):
    take(value)
`);
  assert.ok(mismatched.some((item) => /Cannot assign EvenA to EvenB/u.test(item)), mismatched.join("\n"));
});

test("type identity is built once per type object", () => {
  const functions: string[] = [];
  for (let index = 0; index < 400; index += 1) {
    functions.push(
      `def total${index}(values: List<number>) -> number:`,
      "    let sum = 0",
      "    for value in values:",
      "        sum = sum + value",
      "    return sum",
      "",
    );
  }
  // Before the identity cache this module took 0.45s and 800 of the same
  // function took 1.9s — superlinear, with two thirds of the samples inside the
  // identity string builder. After it, 0.11s.
  const started = Date.now();
  const result = compile(functions.join("\n"));
  const elapsed = Date.now() - started;
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  assert.ok(elapsed < 5_000, `400 functions took ${elapsed}ms`);

  // The cache is keyed on the type object, so two structurally identical but
  // distinct objects still agree, and a rebuilt object is never served the
  // identity of the one it was built from.
  const list = (element: ValueType): ValueType => ({ kind: "list", element });
  const strings = list({ kind: "string" });
  assert.equal(semanticTypeIdentity(strings), semanticTypeIdentity(list({ kind: "string" })));
  assert.notEqual(semanticTypeIdentity(strings), semanticTypeIdentity(list({ kind: "number" })));
  assert.equal(semanticTypeIdentity(strings), semanticTypeIdentity(strings));
  const readonlyStrings: ValueType = { ...strings, readonlyView: true } as ValueType;
  assert.notEqual(semanticTypeIdentity(strings), semanticTypeIdentity(readonlyStrings));
});
