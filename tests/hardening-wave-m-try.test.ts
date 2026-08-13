import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile, describeType } from "@velarscript/compiler";

// D39 item 51 — the `try` expression: an expected failure is an optional.

function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: result.code ?? "",
    timeout: 5_000,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

function diagnostics(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[D39 51] a failure becomes null and a success keeps its value", () => {
  const output = run(`
type User:
    name: string

def main() -> null:
    const parsed = try User.parse({ name: "ada" })
    const rejected = try User.parse(5)
    print(parsed?.name ?? "none")
    print(rejected?.name ?? "none")

main()
`);
  assert.equal(output, "ada\nnone\n");
});

test("[D39 51] 'try' reaches the whole postfix chain, exactly as 'await' does", () => {
  const output = run(`
def measure(text: string) -> number:
    if text == "":
        throw Error("empty")
    return text.size

def main() -> null:
    const good = try measure("abcd").toFixed(1)
    const failed = try measure("").toFixed(1)
    print(good ?? "none")
    print(failed ?? "none")

main()
`);
  assert.equal(output, "4.0\nnone\n");
});

test("[D39 51] 'try await' catches a rejection", () => {
  const output = run(`
async def load(fail: bool) -> string:
    if fail:
        throw Error("nope")
    return "loaded"

async def main() -> null:
    print(try await load(false) ?? "none")
    print(try await load(true) ?? "none")

await main()
`);
  assert.equal(output, "loaded\nnone\n");
});

test("[D39 51] the result type is T?, and an already-optional result stays itself", () => {
  const result = compile(`
type User:
    name: string

def find(id: string) -> User?:
    if id == "":
        throw Error("empty id")
    return null

export def probe(id: string) -> User?:
    return try find(id)

export def parse(raw: unknown) -> User?:
    return try User.parse(raw)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.equal(describeExport(result, "probe"), "(id: string) -> User?");
  assert.equal(describeExport(result, "parse"), "(raw: unknown) -> User?");
});

function describeExport(result: ReturnType<typeof compile>, name: string): string {
  const type = result.moduleInterface.exports.get(name);
  assert.ok(type, `missing export ${name}`);
  return describeType(type);
}

test("[D39 51] a bare 'try' statement is rejected: a swallow needs a visible consumer", () => {
  const reported = diagnostics(`
type User:
    name: string

def main() -> null:
    try User.parse(5)
`);
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /^VEL4034 A 'try' result must be consumed/u);
  assert.match(reported[0]!, /use a try\/catch block/u);
});

test("[D39 51] 'try try' and a null-producing attempt are each rejected", () => {
  assert.ok(diagnostics(`
type User:
    name: string

def main() -> null:
    const value = try try User.parse(5)
    print(value?.name ?? "x")
`).some((item) => /^VEL4034 'try try' says nothing the first 'try' has not already said/u.test(item)));

  assert.ok(diagnostics(`
def act() -> null:
    pass

def main() -> null:
    const value = try act()
    print("x")
`).some((item) => /^VEL4034 This expression produces null on success/u.test(item)));
});

test("[D39 51] a Promise-valued attempt is directed to 'try await'", () => {
  const reported = diagnostics(`
async def load() -> string:
    return "x"

async def main() -> null:
    const value = try load()
    print(value ?? "none")
`);
  assert.ok(reported.some((item) => /^VEL4034 'try' catches a failure while the expression runs.*write 'try await/u.test(item)), reported.join("\n"));
});

test("[D39 51] the statement 'try' block keeps its meaning", () => {
  const output = run(`
def main() -> null:
    try:
        throw Error("boom")
    catch error:
        print(error.message)
    finally:
        print("cleaned")

main()
`);
  assert.equal(output, "boom\ncleaned\n");
});

test("[D39 51] 'try' binds tighter than '??' so the fallback applies to the attempt", () => {
  const output = run(`
def measure(text: string) -> number:
    if text == "":
        throw Error("empty")
    return text.size

def main() -> null:
    const value = try measure("") ?? -1
    print(f"{value}")

main()
`);
  assert.equal(output, "-1\n");
});

test("[D39 51] the attempt does not swallow anything outside its own chain", () => {
  const output = run(`
def measure(text: string) -> number:
    if text == "":
        throw Error("empty")
    return text.size

def main() -> null:
    let seen = 0
    for text in ["a", "", "abc"]:
        const size = try measure(text)
        if size != null:
            seen += size
    print(f"{seen}")
    // A throw after the attempt still propagates.
    const value = try measure("")
    if value == null:
        throw Error("propagates")

try:
    main()
catch error:
    print(error.message)
`);
  assert.equal(output, "4\npropagates\n");
});
