import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";

// Wave N-2b-1 — the semantic core fixes from the completeness audits
// (docs/decisions/archive/COMPLETENESS-AUDITS.md; ledger ids in test names), plus the
// D47 rule 81 `equals` prelude function. Execution-level wherever the ledger
// evidence was execution-level.

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

function runFailing(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.notEqual(execution.status, 0, String(execution.stdout));
  return String(execution.stderr);
}

function accepts(source: string): void {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, [], source);
}

function rejects(source: string, pattern: RegExp): void {
  const result = compile(source.trimStart());
  assert.equal(result.code, null, source);
  const matched = result.diagnostics.find((item) => pattern.test(item.message));
  assert.ok(matched, `${source}\nexpected ${String(pattern)}, received ${JSON.stringify(result.diagnostics.map((item) => item.message))}`);
}

const AB = "enum A:\n    x\n    y\nenum B:\n    x\n    z\n";
const STATUS = "enum Status:\n    pending\n    done\n";

// ---------------------------------------------------------------------------
// A. The bare-string identity closure
// ---------------------------------------------------------------------------

test("[ENM-D1] Map and Set key domains reject unions that collapse at runtime", () => {
  rejects(`${AB}const m: Map<A | B, string> = Map()\n`, /Map key type of A \| B mixes members of different enums/u);
  rejects(`${AB}const s: Set<A | B> = Set()\n`, /Set element type of A \| B mixes members of different enums/u);
  rejects(`${AB}const m: Map<A | string, number> = Map()\nprint("x")\n`, /mixes A with string, and an enum member is a bare string at runtime/u);
  // Inferred constructions carry the same rule.
  rejects(`${AB}const s = Set([A.x, B.x])\n`, /mixes members of different enums/u);
  rejects(`${AB}const m = Map([[A.x, 1], [B.z, 2]])\n`, /mixes members of different enums/u);
  // A single enum, an optional enum, and an ordinary mixed-kind union stay legal.
  accepts(`${AB}const m: Map<A, string> = Map()\nprint(str(m.size))\n`);
  accepts(`${AB}const m: Map<A?, string> = Map()\nprint(str(m.size))\n`);
  accepts("const s: Set<number | string> = Set()\nprint(str(s.size))\n");

  // D102 ruling 1: the scalar that collides follows the wire value. An enum
  // pinned to integers collapses against `number` and not against `string`;
  // a string-backed one keeps the opposite pair, so neither rule reaches past
  // the domain its members actually occupy at run time.
  const PROTO = "enum Proto:\n    v1 = 1\n    v2 = 2\n";
  rejects(`${PROTO}const m: Map<Proto | number, string> = Map()\nprint("x")\n`, /mixes Proto with number, and an enum member is a bare number at runtime/u);
  rejects(`${PROTO}const s: Set<Proto | number> = Set()\nprint("x")\n`, /mixes Proto with number, and an enum member is a bare number at runtime/u);
  rejects(`${PROTO}const m: Map<Proto | number, string> = Map()\nprint("x")\n`, /bind each member to a number first and store that deliberately/u);
  accepts(`${PROTO}const m: Map<Proto | string, number> = Map()\nprint(str(m.size))\n`);
  accepts(`${AB}const m: Map<A | number, string> = Map()\nprint(str(m.size))\n`);
});

test("[ENM-I3] the membership vocabulary requires the probe to intersect the element or key", () => {
  const boundary = /enum and string domains never meet/u;
  rejects(`${AB}print(str(A.x in ["x"]))\n`, boundary);
  rejects(`${AB}const v: List<string> = ["x"]\nprint(str(v.has(A.x)))\n`, boundary);
  rejects(`${AB}const v: List<string> = ["x"]\nprint(str(v.index(A.x) == null))\n`, boundary);
  rejects(`${AB}const v: List<string> = ["x"]\nprint(str(v.count(A.x)))\n`, boundary);
  rejects(`${AB}let v: List<string> = ["x"]\nprint(str(v.remove(A.x)))\n`, boundary);
  rejects(`${AB}const m: Map<string, number> = Map([["x", 1]])\nprint(str(m.get(A.x) == null))\n`, boundary);
  rejects(`${AB}const m: Map<string, number> = Map([["x", 1]])\nprint(str(m.has(A.x)))\n`, boundary);
  rejects(`${AB}const s: Set<string> = Set(["x"])\nprint(str(s.has(A.x)))\n`, boundary);
  rejects(`${AB}const r: Record<number> = {x: 1}\nprint(str(A.x in r))\n`, boundary);
  rejects(`${AB}print(str(A.x in "text"))\n`, boundary);
  // Disjoint non-enum probes are constant too.
  rejects("const v: List<string> = [\"x\"]\nprint(str(v.has(5)))\n", /have no values in common/u);
  // The probe widens to intersection: a union probe with one intersecting arm is a real question.
  accepts("def f(probe: string | number) -> bool:\n    const v: List<string> = [\"x\"]\n    return v.has(probe)\nprint(str(f(\"x\")))\n");
  // The enum's own collections keep working, including NaN semantics.
  assert.equal(run(`${AB}const v: List<A> = [A.x]\nprint(str(v.has(A.x)))\nprint(str(v.has(A.y)))\n`), "true\nfalse\n");
});

test("[ENM-I2] the enum-versus-string boundary holds through union arms", () => {
  const meet = /can meet only where an enum member matches a raw string/u;
  rejects(`${STATUS}def f(w: Status | string) -> bool:\n    return w == Status.done\nprint(str(f(Status.done)))\n`, meet);
  rejects(`${STATUS}def f(w: Status | string) -> bool:\n    return Status.done == w\nprint(str(f(Status.done)))\n`, meet);
  rejects(`${STATUS}def f(w: Status | string, raw: string) -> bool:\n    return w == raw\nprint(str(f(Status.done, "done")))\n`, meet);
  // The rejection teaches narrowing, and the narrowed comparison is legal.
  rejects(`${STATUS}def f(w: Status | string) -> bool:\n    return w == Status.done\nprint(str(f(Status.done)))\n`, /narrow the union first — 'if value is Status:'/u);
  // Narrowing legitimizes the comparison; a raw string that IS a wire value
  // validates into the enum domain, which is exactly the taught path.
  assert.equal(run(`${STATUS}def f(w: Status | string) -> bool:\n    if w is Status:\n        return w == Status.done\n    return false\nprint(str(f(Status.done)))\nprint(str(f("other")))\n`), "true\nfalse\n");
});

test("[ENM-I1] `is` / `is not` between statically disjoint enum domains is a compile error", () => {
  rejects(`${AB}const v: A = A.x\nif v is B:\n    print("laundered")\n`, /A and B have no values in common, so 'is' is always false/u);
  rejects(`${AB}const v: A = A.x\nif v is not B:\n    print("always")\n`, /'is not' is always true/u);
  rejects(`${AB}print(str(B.is(A.x)))\n`, /A\.x and B have no values in common/u);
  // Real validations stay legal: unknown, string, and intersecting unions.
  accepts(`${AB}def f(v: unknown) -> bool:\n    return v is B\nprint(str(f("z")))\n`);
  accepts(`${AB}def f(v: string) -> bool:\n    return v is B\nprint(str(f("z")))\n`);
  accepts(`${AB}def f(v: A | B) -> bool:\n    return v is B\nprint(str(f(A.x)))\n`);
  accepts(`${AB}def f(v: unknown) -> bool:\n    return B.is(v)\nprint(str(f("z")))\n`);
});

test("[COL-I3 first half] a fresh collection literal is never an equality operand", () => {
  const identity = /is a new object, and '==' compares collection identity/u;
  rejects("print(str([1] == [1]))\n", identity);
  rejects("const v: List<number> = [1]\nprint(str(v == [1]))\n", identity);
  rejects("const u = {name: \"a\"}\nprint(str(u == {name: \"a\"}))\n", identity);
  rejects("const s = Set([1])\nprint(str(s == Set([1])))\n", /Set\(\.\.\.\) construction/u);
  rejects("const m = Map([[1, 2]])\nprint(str(Map([[1, 2]]) == m))\n", /Map\(\.\.\.\) construction/u);
  rejects("const v: List<number> = [1]\nprint(str(v != [1]))\n", /always true/u);
  // The rejection teaches the content spelling.
  rejects("print(str([1] == [1]))\n", /compare contents with equals\(a, b\)/u);
  // Alias identity comparison stays legal and true.
  assert.equal(run("const a = [1]\nconst b = a\nprint(str(a == b))\n"), "true\n");
});

// ---------------------------------------------------------------------------
// B. equals(a, b) — D47 rule 81
// ---------------------------------------------------------------------------

test("[D47 81] equals compares data deeply with SameValueZero leaves", () => {
  assert.equal(run(`
const nested = {name: "a", tags: [1, 2], meta: {ok: true}}
print(str(equals(nested, {meta: {ok: true}, name: "a", tags: [1, 2]})))
print(str(equals([1, 2], [2, 1])))
print(str(equals(0 / 0, 0 / 0)))
print(str(equals([0 / 0], [0 / 0])))
print(str(equals(-0, 0)))
print(str(equals(Set([1, 2]), Set([2, 1]))))
print(str(equals(Set([{a: 1}]), Set([{a: 1}]))))
print(str(equals(Map([["k", [1]]]), Map([["k", [1]]]))))
print(str(equals(Map([["k", 1]]), Map([["k", 2]]))))
print(str(equals({a: 1}, {a: 1, b: 2})))
`), "true\nfalse\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\nfalse\nfalse\n");
});

test("[D47 81] equals rejects the non-data domains and non-intersecting operands", () => {
  rejects("class P:\n    pass\nconst a = P()\nconst b = P()\nprint(str(equals(a, b)))\n", /class instance; behavior objects compare by identity — use '=='/u);
  rejects("const f = (x: number) => x\nconst g = (x: number) => x\nprint(str(equals(f, g)))\n", /a function has no structural content/u);
  rejects("def f(v: unknown) -> bool:\n    return equals(v, [1])\nprint(str(f([1])))\n", /unknown must be validated first/u);
  rejects("print(str(equals([1], [\"a\"])))\n", /List<number> and List<string> have no values in common, so equals\(a, b\) is always false/u);
  rejects("print(str(equals([1])))\n", /Expected 2 arguments/u);
  // Class identity comparison — the taught alternative — still works.
  assert.equal(run("class P:\n    pass\nconst a = P()\nconst b = a\nprint(str(a == b))\n"), "true\n");
});

test("[D47 81] equals throws on cyclic structures instead of overflowing", () => {
  const cyclic = `
type Node:
    next: Node?
let a: Node = {next: null}
a.next = a
let b: Node = {next: null}
b.next = b
`;
  const stderr = runFailing(`${cyclic}print(str(equals(a, b)))\n`);
  assert.match(stderr, /equals cannot compare cyclic data/u);
  // Identity short-circuits before the cycle is entered.
  assert.equal(run(`${cyclic}print(str(equals(a, a)))\n`), "true\n");
});

// ---------------------------------------------------------------------------
// C. Enum and match correctness
// ---------------------------------------------------------------------------

test("[ENM-D2] match value patterns agree with '==' on NaN", () => {
  assert.equal(run(`
type Box:
    nan: number
const box: Box = {nan: 0 / 0}
match 0 / 0:
    case box.nan:
        print("match agrees")
    case _:
        print("match disagrees")
print(str(0 / 0 == box.nan))
`), "match agrees\ntrue\n");
  // Ordinary literal patterns keep plain strict comparison.
  assert.equal(run("match 5:\n    case 5:\n        print(\"five\")\n    case _:\n        pass\n"), "five\n");
});

test("[ENM-I5] parenthesized singleton patterns credit enum member coverage", () => {
  accepts(`${STATUS}const v: Status = Status.pending\nmatch v:\n    case (Status.pending):\n        print("p")\n    case (Status.done):\n        print("d")\n`);
  assert.equal(run(`${STATUS}const v: Status = Status.done\nmatch v:\n    case (Status.pending):\n        print("p")\n    case (Status.done):\n        print("d")\n`), "d\n");
});

test("[ENM-I6] an optional enum subject carries the same exhaustiveness contract", () => {
  rejects(`${STATUS}def f(v: Status?):\n    match v:\n        case Status.pending:\n            print("p")\n    return null\nf(Status.pending)\n`, /Match on Status\? is missing: done, null/u);
  rejects(`${STATUS}def f(v: Status?):\n    match v:\n        case Status.pending:\n            pass\n        case Status.done:\n            pass\n    return null\nf(null)\n`, /Match on Status\? is missing: null/u);
  assert.equal(run(`${STATUS}def f(v: Status?) -> string:\n    match v:\n        case Status.pending:\n            return "p"\n        case Status.done:\n            return "d"\n        case null:\n            return "none"\nprint(f(null))\nprint(f(Status.done))\n`), "none\nd\n");
});

test("[ENM-I7] keyword member names parse in match patterns", () => {
  assert.equal(run("enum S:\n    null = \"n\"\n    match = \"m\"\n    a\nmatch S.parse(\"n\"):\n    case S.null:\n        print(\"null member\")\n    case S.match, S.a:\n        print(\"other\")\n"), "null member\n");
  rejects("enum S:\n    a\nmatch S.a:\n    case S.pass:\n        pass\n    case _:\n        pass\n", /'pass' is the placeholder line/u);
});

test("[ENM-I8] a bare pass line in an enum body is the placeholder, never a member", () => {
  assert.equal(run("enum S:\n    pass\n    a\nprint(str(S.parse(\"a\") == S.a))\nprint(str(S.values().size))\n"), "true\n1\n");
  rejects("enum S:\n    pass\nprint(\"x\")\n", /Enum 'S' requires at least one member/u);
  rejects("enum S:\n    pass = \"p\"\n    a\nprint(\"x\")\n", /'pass' is the placeholder line and cannot be declared as an enum member/u);
});

test("[ENM-I4] enum member access follows type aliases", () => {
  assert.equal(run(`${STATUS}type S2 = Status\nprint(str(S2.done))\nprint(str(S2.done == Status.done))\nprint(str(S2.parse("done") == Status.done))\nprint(str(S2.values().size))\n`), "done\ntrue\ntrue\n2\n");
  // Chained aliases resolve to the same enum object.
  assert.equal(run(`${STATUS}type S2 = Status\ntype S3 = S2\nprint(str(S3.pending == Status.pending))\n`), "true\n");
  rejects(`${STATUS}type S2 = Status\nprint(str(S2.missing))\n`, /Enum 'Status' has no member 'missing'; S2\.values\(\) lists the members/u);
});

test("[ENM-U1] Status.values() returns a fresh mutable declaration-order List", () => {
  assert.equal(run(`${STATUS}const all = Status.values()\nprint(str(all.size))\nfor member in Status.values():\n    print(str(member))\n`), "2\npending\ndone\n");
  // Fresh per call: mutating one call's List cannot leak into the next.
  assert.equal(run(`${STATUS}let first = Status.values()\nfirst.pop(-1)\nprint(str(first.size))\nprint(str(Status.values().size))\n`), "1\n2\n");
  rejects(`${STATUS}for s in Status:\n    print(str(s))\n`, /Status\.values\(\) returns the members as a List/u);
  rejects(`${STATUS}const all = [...Status]\n`, /spread its member List instead — \[\.\.\.Status\.values\(\)\]/u);
  rejects(`${STATUS}print(str(Status.missing))\n`, /Status\.values\(\) lists the members in declaration order/u);
  rejects("enum S:\n    values\nprint(\"x\")\n", /reserved for the enum's runtime surface/u);
});

test("[ENM-U2] dotted value patterns work at arbitrary depth and compare by SameValueZero", () => {
  assert.equal(run(`
type Limits:
    max: number
type Config:
    limits: Limits
const config: Config = {limits: {max: 5}}
match 5:
    case config.limits.max:
        print("deep hit")
    case _:
        print("miss")
`), "deep hit\n");
  assert.equal(run(`
type Limits:
    sentinel: number
type Config:
    limits: Limits
const config: Config = {limits: {sentinel: 0 / 0}}
match 0 / 0:
    case config.limits.sentinel:
        print("nan deep")
    case _:
        print("miss")
`), "nan deep\n");
  rejects("const limit = 5\nmatch 5:\n    case limit:\n        pass\n    case _:\n        pass\n", /'limit' is a binding, and bindings cannot be matched directly; match a dotted path/u);
});

test("[ENM-U3] `case a | b:` teaches the comma spelling", () => {
  rejects("match 1:\n    case 1 | 2:\n        print(\"x\")\n    case _:\n        pass\n", /Combine match alternatives with a comma — 'case a, b:'/u);
});

test("[ENM-U4 + COL-U5] the builtin error types are nameable and ValidationError carries detail", () => {
  assert.equal(run(`
type User:
    name: string
def f(value: unknown):
    try:
        const user = User.parse(value)
    catch error:
        if error is ValidationError:
            print(error.message)
            print(error.path ?? "-")
            print(error.field ?? "-")
            print(error.reason ?? "-")
    return null
f({age: 1})
`), "Value does not match User — field 'name' is missing\nUser.name\nname\nfield 'name' is missing\n");
  assert.equal(run(`
const items = [1]
try:
    print(str(items[5]))
catch error:
    if error is IndexError:
        print("index error caught")
`), "index error caught\n");
  assert.equal(run(`
try:
    throw NarrowingError("stale")
catch error:
    if error is NarrowingError:
        print("narrowing caught")
    if error is ValidationError:
        print("wrong class")
`), "narrowing caught\n");
  // Wrong-type parse detail: reason names the field and its declared type.
  assert.equal(run(`
type User:
    name: string
try:
    const user = User.parse({name: 5})
catch error:
    if error is ValidationError:
        print(error.reason ?? "-")
`), "field 'name' does not match string\n");
  rejects("class Mine extends ValidationError:\n    pass\nprint(\"x\")\n", /builtin error type 'ValidationError' cannot be extended/u);
  rejects("class ValidationError extends Error:\n    pass\nprint(\"x\")\n", /reserved Core binding/u);
  rejects("const IndexError = 5\nprint(str(IndexError))\n", /reserved Core binding/u);
});

// ---------------------------------------------------------------------------
// D. Grammar and emission
// ---------------------------------------------------------------------------

test("[GRM-D1] nested `is` operands parenthesize, and a bool subject is a constant test", () => {
  rejects("const x = true\nprint(str((x is number) is bool))\n", /already statically bool, so 'is number' is always false/u);
  rejects("const x = true\nprint(str(x is bool))\n", /'is bool' is always true; drop the constant test/u);
  // A unary operand still emits under its own parentheses and runs correctly.
  assert.equal(run("const value = 3\nprint(str(-value is number))\n"), "true\n");
  const emitted = compile("const value = 3\nprint(str(-value is number))\n");
  assert.match(emitted.code ?? "", /typeof \(-\(value\)\) === "number"/u);
  // bool? subjects ask a real presence question and stay legal.
  accepts("def f(flag: bool?) -> bool:\n    return flag is bool\nprint(str(f(null)))\n");
});

test("[ASY-U2 + D90 R17] awaiting an unchecked boundary value is rejected toward validation", () => {
  // D90 R17: the unsafe import arrives as unknown, and the refusal is the
  // one boundary message `any` and `unknown` now share.
  rejects(
    "import js unsafe {mystery} from \"node:process\"\nasync def f():\n    await mystery\ndef g():\n    async f()\ng()\n",
    /Cannot await unknown; an unchecked thenable runs foreign hooks and can leak raw undefined/u,
  );
});

test("[ASY-U3] checked Error carries a readable unknown `cause`", () => {
  assert.equal(run("try:\n    throw Error(\"x\")\ncatch error:\n    print(str(error.cause == null))\n"), "true\n");
  // The member is unknown, so it narrows through validation like any boundary value.
  accepts("try:\n    throw Error(\"x\")\ncatch error:\n    if error.cause is string:\n        print(error.cause)\n");
});

test("[BRG-N4 + D90 R17] an unchecked boundary value in a condition position is rejected toward validation", () => {
  rejects(
    "import js unsafe {mystery} from \"node:process\"\nif mystery:\n    print(\"t\")\n",
    /A condition judges only bool, and an unchecked unknown would ride JavaScript truthiness/u,
  );
});

test("[audit 4 micro-ruling] Error subclasses report under their declared name", () => {
  assert.equal(run(`
class TimeoutError extends Error:
    constructor(message: string):
        super(message)
try:
    throw TimeoutError("late")
catch error:
    print(error.name)
    print(error.message)
`), "TimeoutError\nlate\n");
});

// ---------------------------------------------------------------------------
// E. The message batch
// ---------------------------------------------------------------------------

test("[ENM-I9] namespace type-position misuse teaches import-by-name", () => {
  rejects(
    "import * as m from \"./other.vel\"\ndef f(u: m.User):\n    return null\n",
    /Namespace members cannot be written in type positions; import 'User' by name/u,
  );
});

test("[ENM-U5] record field defaults teach the absence", () => {
  rejects("type User:\n    name: string = \"x\"\nprint(\"y\")\n", /Record fields do not take default values/u);
});

test("[ENM-U6] duplicate match values render as the author spelled them", () => {
  rejects("match 5:\n    case 5:\n        pass\n    case 5:\n        pass\n    case _:\n        pass\n", /Match value '5' is declared more than once/u);
  rejects("match \"a\":\n    case \"a\":\n        pass\n    case \"a\":\n        pass\n    case _:\n        pass\n", /Match value 'a' is declared more than once/u);
  rejects(
    "type C:\n    m: number\nconst c: C = {m: 1}\nmatch 5:\n    case c.m:\n        pass\n    case c.m:\n        pass\n    case _:\n        pass\n",
    /Match value 'c\.m' is declared more than once/u,
  );
});

test("[ENM-U6] a guarded case does not count toward exhaustiveness, and the diagnostic says so", () => {
  rejects(
    `${STATUS}const v: Status = Status.pending\nmatch v:\n    case Status.pending:\n        pass\n    case Status.done if v == Status.done:\n        pass\n`,
    /a guarded case matches only when its condition holds, so it does not count/u,
  );
});

test("[COL-I4] the stringify teachings carry the permanent namespace", () => {
  rejects("const items = [1]\nprint(f\"{items}\")\n", /Json\.stringify\(value\)/u);
  rejects("const items = [1]\nprint(stringify(items))\n", /Json\.stringify/u);
});

test("[COL-I5] a named record into Record<T> explains the open-record reason", () => {
  rejects(
    "type User:\n    name: string\nconst u: User = {name: \"a\"}\nconst r: Record<string> = u\n",
    /a named record is open, so a User value may carry fields beyond its declaration; copy the declared fields explicitly/u,
  );
});

test("[GRM-D2] increment spellings teach the compound assignment", () => {
  rejects("let i = 1\n++i\nprint(str(i))\n", /VelarScript has no '\+\+'; write 'i \+= 1'/u);
  rejects("let i = 1\ni++\nprint(str(i))\n", /VelarScript has no '\+\+'; write 'i \+= 1'/u);
  rejects("let i = 1\ni--\nprint(str(i))\n", /VelarScript has no '--'; write 'i -= 1'/u);
});

test("[GRM-T1] named-argument diagnostics say what to write and where", () => {
  rejects("def f(x: number) -> number:\n    return x\nprint(str(f(x: 1)))\n", /Write '=' between the name and value for named argument 'x'/u);
  const chained = compile("def f(x: number) -> number:\n    return x\nprint(str(f(x=y=2)))\n");
  const messages = chained.diagnostics.map((item) => item.message);
  assert.ok(messages.some((message) => /A named argument takes one value; remove the extra '='/u.test(message)), JSON.stringify(messages));
  assert.ok(!messages.some((message) => /Expected '\)' after arguments/u.test(message)), JSON.stringify(messages));
});

test("[grammar vocabulary] ;, boolean bitwise misuse, function, and := each get one taught message", () => {
  rejects("const a = 1;\nprint(str(a))\n", /A statement ends at its newline; VelarScript does not use ';'/u);
  rejects("const a = true\nconst b = false\nif a | b:\n    print(\"x\")\n", /Cannot assign bool to number/u);
  rejects("const a = true\nconst b = false\nif a & b:\n    print(\"x\")\n", /Cannot assign bool to number/u);
  accepts("print(str(2 ^ 8))\n");
  rejects("const f = function() { return 1 }\nprint(\"x\")\n", /VelarScript has no 'function' expressions; declare 'def name\(\.\.\.\)' or write an arrow/u);
  rejects("let x = 1\nx := 5\nprint(str(x))\n", /VelarScript has no ':=' binding operator/u);
});

test("[GRM generic recovery] explicit type arguments are taught beyond the same-file name list", () => {
  rejects(
    "def id<T>(value: T) -> T:\n    return value\nconst f = id\nprint(str(f<number>(1)))\n",
    /Type arguments are inferred at each call site; write 'f\(\.\.\.\)' without '<\.\.\.>'/u,
  );
});

test("[GRM-A5] an operator at line end teaches parenthesized continuation without leaking token kinds", () => {
  const result = compile("const total = 1 +\n    2\nprint(str(total))\n");
  const messages = result.diagnostics.map((item) => item.message);
  assert.ok(messages.some((message) => /A statement ends at its newline; parenthesize the expression to continue it across lines/u.test(message)), JSON.stringify(messages));
  assert.ok(!messages.some((message) => /move 'indent'/u.test(message)), JSON.stringify(messages));
  // The parenthesized continuation the message teaches compiles and runs.
  assert.equal(run("const total = (1 +\n    2)\nprint(str(total))\n"), "3\n");
});
